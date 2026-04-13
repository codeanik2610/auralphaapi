import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../../src/env';

type JsonRecord = Record<string, unknown>;

const resolvedHost = env.app.host === '0.0.0.0' ? '127.0.0.1' : env.app.host;
const BASE_URL =
  process.env.SMOKE_BASE_URL || `http://${resolvedHost}:${env.app.port}${env.app.routePrefix}`;
const LOGIN_EMAIL =
  process.env.SMOKE_LOGIN_EMAIL || process.env.AUTH_SEED_EMAIL || 'admin@auralpha.com';
const LOGIN_PASSWORD =
  process.env.SMOKE_LOGIN_PASSWORD || process.env.AUTH_SEED_PASSWORD || 'Admin@123';
const RUN_DEPENDENCY_SMOKE =
  String(process.env.DISCOVERY_RELEASE_GATE_RUN_DEPENDENCY_SMOKE || 'true')
    .trim()
    .toLowerCase() !== 'false';
const RUN_CONTRACT_SMOKE =
  String(process.env.DISCOVERY_RELEASE_GATE_RUN_CONTRACT_SMOKE || 'true')
    .trim()
    .toLowerCase() !== 'false';
const OUTPUT_FILE = String(
  process.env.DISCOVERY_RELEASE_GATE_OUTPUT_FILE || 'artifacts/discovery-release-gate.json'
).trim();
const STEP_SUMMARY_FILE = String(process.env.GITHUB_STEP_SUMMARY || '').trim();

function asRecord(value: unknown): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as JsonRecord;
}

function asArray(value: unknown): JsonRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (item): item is JsonRecord => Boolean(item) && typeof item === 'object' && !Array.isArray(item)
  );
}

function readString(value: unknown): string {
  return String(value || '').trim();
}

function readNumber(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    throw new Error(`Expected finite number, received ${String(value)}`);
  }
  return numeric;
}

async function persistSummary(summary: Record<string, unknown>): Promise<void> {
  if (!OUTPUT_FILE) {
    return;
  }

  const absoluteOutputPath = path.resolve(process.cwd(), OUTPUT_FILE);
  await mkdir(path.dirname(absoluteOutputPath), { recursive: true });
  await writeFile(absoluteOutputPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
}

async function writeStepSummary(summary: {
  baseUrl: string;
  dependencySmokeRan: boolean;
  contractSmokeRan: boolean;
  dependencyStatus: string;
  contractStatus: string;
  summary: {
    botsTotal: number;
    botsActive: number;
    strategiesTotal: number;
    pendingReview: number;
    suggestionsTotal: number;
    runsTotal: number;
  };
  feed: {
    checkedAt: string;
    itemCount: number;
  };
}): Promise<void> {
  if (!STEP_SUMMARY_FILE) {
    return;
  }

  const lines = [
    '## Discovery release gate',
    '',
    `- Base URL: \`${summary.baseUrl}\``,
    `- Dependency smoke ran: ${summary.dependencySmokeRan ? 'yes' : 'no'}`,
    `- Contract smoke ran: ${summary.contractSmokeRan ? 'yes' : 'no'}`,
    `- Dependency status: ${summary.dependencyStatus}`,
    `- Contract status: ${summary.contractStatus}`,
    '',
    '### Summary',
    '',
    `- botsTotal: ${summary.summary.botsTotal}`,
    `- botsActive: ${summary.summary.botsActive}`,
    `- strategiesTotal: ${summary.summary.strategiesTotal}`,
    `- pendingReview: ${summary.summary.pendingReview}`,
    `- suggestionsTotal: ${summary.summary.suggestionsTotal}`,
    `- runsTotal: ${summary.summary.runsTotal}`,
    '',
    '### Feed',
    '',
    `- checkedAt: ${summary.feed.checkedAt || 'n/a'}`,
    `- itemCount: ${summary.feed.itemCount}`,
    '',
  ];

  await writeFile(STEP_SUMMARY_FILE, `${lines.join('\n')}\n`, 'utf8');
}

async function requestJson(
  pathName: string,
  init: RequestInit = {},
  accessToken = ''
): Promise<JsonRecord> {
  const headers = new Headers(init.headers || {});
  if (accessToken) {
    headers.set('authorization', `Bearer ${accessToken}`);
  }

  const response = await fetch(`${BASE_URL}${pathName}`, {
    ...init,
    headers,
  });
  const text = await response.text();
  let payload: JsonRecord = {};

  try {
    payload = text ? (JSON.parse(text) as JsonRecord) : {};
  } catch {
    payload = { raw: text };
  }

  if (!response.ok) {
    throw new Error(
      `${init.method || 'GET'} ${pathName} -> HTTP ${response.status}: ${JSON.stringify(payload)}`
    );
  }

  return payload;
}

async function login(): Promise<string> {
  const response = await requestJson('/auth/login', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      email: LOGIN_EMAIL,
      password: LOGIN_PASSWORD,
    }),
  });
  const data = asRecord(response.data);
  const accessToken = readString(data.accessToken);
  assert.ok(accessToken, 'login should return an access token');
  return accessToken;
}

async function runScript(scriptName: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', `scripts/${scriptName}`], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        SMOKE_BASE_URL: BASE_URL,
        SMOKE_LOGIN_EMAIL: LOGIN_EMAIL,
        SMOKE_LOGIN_PASSWORD: LOGIN_PASSWORD,
      },
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${scriptName} exited with code ${String(code)}`));
    });
  });
}

async function run(): Promise<void> {
  if (RUN_DEPENDENCY_SMOKE) {
    await runScript('smokes/smoke-discovery-dependency.ts');
  }

  if (RUN_CONTRACT_SMOKE) {
    await runScript('smokes/smoke-discovery-contract.ts');
  }

  const accessToken = await login();
  const dependencyHealthResponse = await requestJson('/health/discovery', {}, accessToken);
  const dependencyHealth = asRecord(dependencyHealthResponse.data);
  assert.equal(readString(dependencyHealth.status), 'ok');

  const contract = asRecord(dependencyHealth.contract);
  assert.equal(readString(contract.status), 'ok');

  const endpoints = asArray(dependencyHealth.endpoints);
  assert.ok(endpoints.length >= 8, 'discovery gate should see the checked endpoint probes');
  assert.equal(
    endpoints.every((endpoint) => readString(endpoint.status) === 'ok'),
    true,
    'all discovery dependency endpoint probes should be healthy'
  );

  const summaryResponse = await requestJson('/discovery/summary', {}, accessToken);
  const summary = asRecord(summaryResponse.data);
  const summaryBots = asRecord(summary.bots);
  const summaryStrategies = asRecord(summary.strategies);
  const summarySuggestions = asRecord(summary.suggestions);
  const summaryRuns = asRecord(summary.runs);

  assert.ok(readString(summary.checkedAt), 'discovery summary should expose checkedAt');
  assert.ok(readNumber(summaryBots.total) >= 0, 'discovery summary should expose total bots');
  assert.ok(readNumber(summaryStrategies.total) >= 0, 'discovery summary should expose total strategies');
  assert.ok(readNumber(summarySuggestions.total) >= 0, 'discovery summary should expose total suggestions');
  assert.ok(readNumber(summaryRuns.total) >= 0, 'discovery summary should expose total runs');

  const feedResponse = await requestJson('/discovery/feed?limit=10', {}, accessToken);
  const feed = asRecord(feedResponse.data);
  const feedItems = asArray(feed.items);
  assert.ok(readString(feed.checkedAt), 'discovery feed should expose checkedAt');

  const finalSummary = {
    baseUrl: BASE_URL,
    checkedAt: readString(summary.checkedAt),
    dependencySmokeRan: RUN_DEPENDENCY_SMOKE,
    contractSmokeRan: RUN_CONTRACT_SMOKE,
    dependencyStatus: readString(dependencyHealth.status),
    contractStatus: readString(contract.status),
    summary: {
      botsTotal: readNumber(summaryBots.total),
      botsActive: readNumber(summaryBots.active),
      strategiesTotal: readNumber(summaryStrategies.total),
      pendingReview: readNumber(summaryStrategies.pendingReview),
      suggestionsTotal: readNumber(summarySuggestions.total),
      runsTotal: readNumber(summaryRuns.total),
    },
    feed: {
      checkedAt: readString(feed.checkedAt),
      itemCount: feedItems.length,
    },
  };

  await persistSummary(finalSummary);
  await writeStepSummary(finalSummary);

  console.log('discovery-release-gate:', JSON.stringify(finalSummary));
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
