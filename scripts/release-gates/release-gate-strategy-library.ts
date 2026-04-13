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
const SOAK_DURATION_MINUTES = Math.max(
  0,
  Number(process.env.STRATEGY_LIBRARY_SOAK_DURATION_MINUTES || 0)
);
const SOAK_POLL_SECONDS = Math.max(
  10,
  Number(process.env.STRATEGY_LIBRARY_SOAK_POLL_SECONDS || 60)
);
const MAX_FAILED_ACTIVITIES = Math.max(
  0,
  Number(process.env.STRATEGY_LIBRARY_MAX_FAILED_ACTIVITIES || 0)
);
const MAX_OPEN_ALERTS = Math.max(
  0,
  Number(process.env.STRATEGY_LIBRARY_MAX_OPEN_ALERTS || 0)
);
const RUN_LINEAGE_SMOKE =
  String(process.env.STRATEGY_LIBRARY_RELEASE_GATE_RUN_SMOKE || 'true')
    .trim()
    .toLowerCase() !== 'false';
const REQUIRE_FAILURE_ALERTS_ENABLED =
  String(process.env.STRATEGY_LIBRARY_REQUIRE_FAILURE_ALERTS_ENABLED || 'true')
    .trim()
    .toLowerCase() !== 'false';
const OUTPUT_FILE = String(process.env.STRATEGY_LIBRARY_RELEASE_GATE_OUTPUT_FILE || '').trim();
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function persistSummary(summary: Record<string, unknown>): Promise<void> {
  if (!OUTPUT_FILE) {
    return;
  }

  const absoluteOutputPath = path.resolve(process.cwd(), OUTPUT_FILE);
  await mkdir(path.dirname(absoluteOutputPath), { recursive: true });
  await writeFile(`${absoluteOutputPath}`, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
}

async function writeStepSummary(summary: {
  baseUrl: string;
  smokeRan: boolean;
  soakDurationMinutes: number;
  samples: number;
  thresholds: {
    failedActivities: number;
    openAlerts: number;
  };
  finalActivity: {
    totalStrategyLibraryActivity: number;
    failedStrategyLibraryActivity: number;
    latestFailedTitles: string[];
  };
  finalAlerts: {
    openStrategyLibraryAlerts: number;
    ids: string[];
    messages: string[];
  };
  observability: {
    emitFailureAlertsEnabled: boolean;
  };
}): Promise<void> {
  if (!STEP_SUMMARY_FILE) {
    return;
  }

  const lines = [
    '## Strategy Library release gate',
    '',
    `- Base URL: \`${summary.baseUrl}\``,
    `- Lineage smoke ran: ${summary.smokeRan ? 'yes' : 'no'}`,
    `- Soak duration: ${summary.soakDurationMinutes} minute(s)`,
    `- Samples: ${summary.samples}`,
    '',
    '### Thresholds',
    '',
    `- failedStrategyLibraryActivity <= ${summary.thresholds.failedActivities}`,
    `- openStrategyLibraryAlerts <= ${summary.thresholds.openAlerts}`,
    '',
    '### Final activity',
    '',
    `- totalStrategyLibraryActivity: ${summary.finalActivity.totalStrategyLibraryActivity}`,
    `- failedStrategyLibraryActivity: ${summary.finalActivity.failedStrategyLibraryActivity}`,
    `- latestFailedTitles: ${summary.finalActivity.latestFailedTitles.length ? summary.finalActivity.latestFailedTitles.join(' | ') : 'none'}`,
    '',
    '### Final alerts',
    '',
    `- openStrategyLibraryAlerts: ${summary.finalAlerts.openStrategyLibraryAlerts}`,
    `- ids: ${summary.finalAlerts.ids.length ? summary.finalAlerts.ids.join(', ') : 'none'}`,
    `- messages: ${summary.finalAlerts.messages.length ? summary.finalAlerts.messages.join(' | ') : 'none'}`,
    '',
    '### Observability',
    '',
    `- emitFailureAlertsEnabled: ${summary.observability.emitFailureAlertsEnabled ? 'yes' : 'no'}`,
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

async function runLineageSmoke(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', 'scripts/smokes/smoke-strategy-library-lineage.ts'],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          SMOKE_BASE_URL: BASE_URL,
          SMOKE_LOGIN_EMAIL: LOGIN_EMAIL,
          SMOKE_LOGIN_PASSWORD: LOGIN_PASSWORD,
        },
        stdio: 'inherit',
      }
    );

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`strategy-library lineage smoke exited with code ${String(code)}`));
    });
  });
}

async function readObservability(accessToken: string): Promise<{ emitFailureAlertsEnabled: boolean }> {
  const response = await requestJson('/health/ops', {}, accessToken);
  const data = asRecord(response.data);
  const config = asRecord(data.config);

  if (REQUIRE_FAILURE_ALERTS_ENABLED) {
    assert.equal(
      Boolean(config.emitFailureAlerts),
      true,
      'observability failure alerts must be enabled for strategy-library release gate'
    );
  }

  return {
    emitFailureAlertsEnabled: Boolean(config.emitFailureAlerts),
  };
}

async function readStrategyLibraryActivity(accessToken: string): Promise<{
  totalStrategyLibraryActivity: number;
  failedStrategyLibraryActivity: number;
  latestFailedTitles: string[];
}> {
  const allResponse = await requestJson(
    `/activity?limit=50&offset=0&route=${encodeURIComponent('Strategy Library')}`,
    {},
    accessToken
  );
  const failedResponse = await requestJson(
    `/activity?limit=50&offset=0&route=${encodeURIComponent('Strategy Library')}&status=${encodeURIComponent('Failed')}`,
    {},
    accessToken
  );

  const failedItems = asArray(asRecord(failedResponse.data).items);
  return {
    totalStrategyLibraryActivity: readNumber(asRecord(allResponse.data).total),
    failedStrategyLibraryActivity: readNumber(asRecord(failedResponse.data).total),
    latestFailedTitles: failedItems
      .slice(0, 5)
      .map((item) => readString(item.title))
      .filter(Boolean),
  };
}

async function readOpenStrategyLibraryAlerts(accessToken: string): Promise<{
  openStrategyLibraryAlerts: number;
  ids: string[];
  messages: string[];
}> {
  const response = await requestJson(
    `/alerts?limit=50&offset=0&status=${encodeURIComponent('Open')}&channel=${encodeURIComponent('Strategy Library')}`,
    {},
    accessToken
  );
  const data = asRecord(response.data);
  const items = asArray(data.items);

  return {
    openStrategyLibraryAlerts: readNumber(data.total),
    ids: items.map((item) => readString(item.id)).filter(Boolean),
    messages: items.map((item) => readString(item.message)).filter(Boolean),
  };
}

async function run(): Promise<void> {
  const startedAt = new Date().toISOString();

  if (RUN_LINEAGE_SMOKE) {
    await runLineageSmoke();
  }

  const accessToken = await login();
  const observability = await readObservability(accessToken);
  const samples: Array<{
    capturedAt: string;
    activity: Awaited<ReturnType<typeof readStrategyLibraryActivity>>;
    alerts: Awaited<ReturnType<typeof readOpenStrategyLibraryAlerts>>;
  }> = [];
  const deadline = Date.now() + SOAK_DURATION_MINUTES * 60 * 1000;
  let keepPolling = true;

  while (keepPolling) {
    samples.push({
      capturedAt: new Date().toISOString(),
      activity: await readStrategyLibraryActivity(accessToken),
      alerts: await readOpenStrategyLibraryAlerts(accessToken),
    });

    keepPolling = Date.now() < deadline;
    if (keepPolling) {
      await sleep(SOAK_POLL_SECONDS * 1000);
    }
  }

  const finalSample = samples[samples.length - 1];
  assert.ok(finalSample, 'strategy-library release gate should capture at least one sample');

  const summary = {
    baseUrl: BASE_URL,
    smokeRan: RUN_LINEAGE_SMOKE,
    soakDurationMinutes: SOAK_DURATION_MINUTES,
    samples: samples.length,
    startedAt,
    finishedAt: new Date().toISOString(),
    thresholds: {
      failedActivities: MAX_FAILED_ACTIVITIES,
      openAlerts: MAX_OPEN_ALERTS,
    },
    finalActivity: finalSample.activity,
    finalAlerts: finalSample.alerts,
    observability,
  };

  assert.ok(
    finalSample.activity.failedStrategyLibraryActivity <= MAX_FAILED_ACTIVITIES,
    `failed strategy-library activity ${String(finalSample.activity.failedStrategyLibraryActivity)} exceeds threshold ${String(MAX_FAILED_ACTIVITIES)}`
  );
  assert.ok(
    finalSample.alerts.openStrategyLibraryAlerts <= MAX_OPEN_ALERTS,
    `open strategy-library alerts ${String(finalSample.alerts.openStrategyLibraryAlerts)} exceeds threshold ${String(MAX_OPEN_ALERTS)}`
  );

  await persistSummary(summary);
  await writeStepSummary(summary);
  console.log('strategy-library-release-gate:', JSON.stringify(summary));
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
