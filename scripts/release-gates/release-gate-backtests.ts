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
  Number(process.env.BACKTESTS_SOAK_DURATION_MINUTES || 0)
);
const SOAK_POLL_SECONDS = Math.max(
  10,
  Number(process.env.BACKTESTS_SOAK_POLL_SECONDS || 60)
);
const MAX_STALE_RUNNING_RUNS = Math.max(
  0,
  Number(process.env.BACKTESTS_MAX_STALE_RUNNING_RUNS || 0)
);
const MAX_INCOMPLETE_TRADE_HISTORY_RUNS = Math.max(
  0,
  Number(process.env.BACKTESTS_MAX_INCOMPLETE_TRADE_HISTORY_RUNS || 0)
);
const MAX_OPEN_BACKTEST_ALERTS = Math.max(
  0,
  Number(process.env.BACKTESTS_MAX_OPEN_ALERTS || 0)
);
const MAX_RECOVERABLE_RUNS_RAW = process.env.BACKTESTS_MAX_RECOVERABLE_RUNS;
const MAX_RECOVERABLE_RUNS =
  MAX_RECOVERABLE_RUNS_RAW === undefined || MAX_RECOVERABLE_RUNS_RAW === ''
    ? null
    : Math.max(0, Number(MAX_RECOVERABLE_RUNS_RAW));
const RUN_LIFECYCLE_SMOKE =
  String(process.env.BACKTESTS_RELEASE_GATE_RUN_SMOKE || 'true')
    .trim()
    .toLowerCase() !== 'false';
const REQUIRE_FAILURE_ALERTS_ENABLED =
  String(process.env.BACKTESTS_REQUIRE_FAILURE_ALERTS_ENABLED || 'true')
    .trim()
    .toLowerCase() !== 'false';
const REQUIRE_CHART_IN_LIFECYCLE_SMOKE =
  String(process.env.BACKTESTS_RELEASE_GATE_REQUIRE_CHART || 'true')
    .trim()
    .toLowerCase() !== 'false';
const OUTPUT_FILE = String(process.env.BACKTESTS_RELEASE_GATE_OUTPUT_FILE || '').trim();
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
    staleRunningRuns: number;
    incompleteTradeHistoryRuns: number;
    openBacktestAlerts: number;
    recoverableRuns: number | null;
  };
  finalHealth: {
    status: string;
    staleRunningRuns: number;
    recoverableRuns: number;
    incompleteTradeHistoryRuns: number;
    totalRuns: number;
    activeRuns: number;
    detail: string;
  };
  finalAlerts: {
    openBacktestAlerts: number;
    ids: string[];
    messages: string[];
  };
}): Promise<void> {
  if (!STEP_SUMMARY_FILE) {
    return;
  }

  const lines = [
    '## Backtests release gate',
    '',
    `- Base URL: \`${summary.baseUrl}\``,
    `- Lifecycle smoke ran: ${summary.smokeRan ? 'yes' : 'no'}`,
    `- Soak duration: ${summary.soakDurationMinutes} minute(s)`,
    `- Samples: ${summary.samples}`,
    '',
    '### Thresholds',
    '',
    `- staleRunningRuns <= ${summary.thresholds.staleRunningRuns}`,
    `- incompleteTradeHistoryRuns <= ${summary.thresholds.incompleteTradeHistoryRuns}`,
    `- openBacktestAlerts <= ${summary.thresholds.openBacktestAlerts}`,
    `- recoverableRuns <= ${summary.thresholds.recoverableRuns === null ? 'unbounded' : summary.thresholds.recoverableRuns}`,
    '',
    '### Final health',
    '',
    `- status: ${summary.finalHealth.status}`,
    `- staleRunningRuns: ${summary.finalHealth.staleRunningRuns}`,
    `- recoverableRuns: ${summary.finalHealth.recoverableRuns}`,
    `- incompleteTradeHistoryRuns: ${summary.finalHealth.incompleteTradeHistoryRuns}`,
    `- totalRuns: ${summary.finalHealth.totalRuns}`,
    `- activeRuns: ${summary.finalHealth.activeRuns}`,
    `- detail: ${summary.finalHealth.detail || 'n/a'}`,
    '',
    '### Final alerts',
    '',
    `- openBacktestAlerts: ${summary.finalAlerts.openBacktestAlerts}`,
    `- ids: ${summary.finalAlerts.ids.length > 0 ? summary.finalAlerts.ids.join(', ') : 'none'}`,
    `- messages: ${summary.finalAlerts.messages.length > 0 ? summary.finalAlerts.messages.join(' | ') : 'none'}`,
    '',
  ];

  await writeFile(STEP_SUMMARY_FILE, `${lines.join('\n')}\n`, 'utf8');
}

async function requestJson(
  path: string,
  init: RequestInit = {},
  accessToken = ''
): Promise<JsonRecord> {
  const headers = new Headers(init.headers || {});
  if (accessToken) {
    headers.set('authorization', `Bearer ${accessToken}`);
  }

  const response = await fetch(`${BASE_URL}${path}`, {
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
      `${init.method || 'GET'} ${path} -> HTTP ${response.status}: ${JSON.stringify(payload)}`
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

async function runLifecycleSmoke(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', 'scripts/smokes/smoke-backtests-lifecycle.ts'],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          SMOKE_BASE_URL: BASE_URL,
          SMOKE_LOGIN_EMAIL: LOGIN_EMAIL,
          SMOKE_LOGIN_PASSWORD: LOGIN_PASSWORD,
          SMOKE_REQUIRE_BACKTEST_CHART: REQUIRE_CHART_IN_LIFECYCLE_SMOKE ? 'true' : 'false',
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
      reject(new Error(`backtests lifecycle smoke exited with code ${String(code)}`));
    });
  });
}

async function readBacktestHealth(accessToken: string): Promise<JsonRecord> {
  const response = await requestJson('/health/backtests', {}, accessToken);
  const data = asRecord(response.data);
  assert.notEqual(readString(data.status), 'down', 'backtests health should not be down');
  return data;
}

async function readObservability(accessToken: string): Promise<JsonRecord> {
  const response = await requestJson('/health/ops', {}, accessToken);
  const data = asRecord(response.data);
  const config = asRecord(data.config);
  if (REQUIRE_FAILURE_ALERTS_ENABLED) {
    assert.equal(
      Boolean(config.emitFailureAlerts),
      true,
      'observability failure alerts must be enabled for release gate'
    );
  }
  return data;
}

async function readOpenBacktestAlerts(accessToken: string): Promise<{
  total: number;
  items: JsonRecord[];
}> {
  const response = await requestJson(
    '/alerts/overview?status=Open&channel=Backtests&limit=20&offset=0',
    {},
    accessToken
  );
  const data = asRecord(response.data);
  const alerts = asRecord(data.alerts);
  const items = asArray(alerts.items);
  return {
    total: Number(alerts.total || items.length || 0),
    items,
  };
}

function assertGateSnapshot(params: {
  health: JsonRecord;
  openAlerts: number;
  sampleLabel: string;
}): void {
  const { health, openAlerts, sampleLabel } = params;
  const staleRunningRuns = Number(health.staleRunningRuns || 0);
  const incompleteTradeHistoryRuns = Number(health.incompleteTradeHistoryRuns || 0);
  const recoverableRuns = Number(health.recoverableRuns || 0);
  const status = readString(health.status).toLowerCase();

  assert.notEqual(status, 'down', `${sampleLabel}: backtests health is down`);
  assert.ok(
    staleRunningRuns <= MAX_STALE_RUNNING_RUNS,
    `${sampleLabel}: stale running runs ${staleRunningRuns} exceeds ${MAX_STALE_RUNNING_RUNS}`
  );
  assert.ok(
    incompleteTradeHistoryRuns <= MAX_INCOMPLETE_TRADE_HISTORY_RUNS,
    `${sampleLabel}: incomplete trade history runs ${incompleteTradeHistoryRuns} exceeds ${MAX_INCOMPLETE_TRADE_HISTORY_RUNS}`
  );
  if (MAX_RECOVERABLE_RUNS !== null) {
    assert.ok(
      recoverableRuns <= MAX_RECOVERABLE_RUNS,
      `${sampleLabel}: recoverable runs ${recoverableRuns} exceeds ${MAX_RECOVERABLE_RUNS}`
    );
  }
  assert.ok(
    openAlerts <= MAX_OPEN_BACKTEST_ALERTS,
    `${sampleLabel}: open backtests alerts ${openAlerts} exceeds ${MAX_OPEN_BACKTEST_ALERTS}`
  );
}

async function run(): Promise<void> {
  const accessToken = await login();
  const meResponse = await requestJson('/auth/me', {}, accessToken);
  const me = asRecord(meResponse.data);
  assert.equal(readString(me.email).toLowerCase(), LOGIN_EMAIL.toLowerCase());

  const apiHealth = asRecord((await requestJson('/health')).data);
  assert.equal(readString(apiHealth.status).toLowerCase(), 'ok');
  const observability = await readObservability(accessToken);
  console.log('release-gate-observability:', JSON.stringify(observability));

  if (RUN_LIFECYCLE_SMOKE) {
    await runLifecycleSmoke();
  }

  const initialHealth = await readBacktestHealth(accessToken);
  const initialAlerts = await readOpenBacktestAlerts(accessToken);
  assertGateSnapshot({
    health: initialHealth,
    openAlerts: initialAlerts.total,
    sampleLabel: 'initial gate',
  });

  const soakStartedAt = new Date();
  const soakDurationMs = SOAK_DURATION_MINUTES * 60 * 1000;
  let samples = 1;
  let lastHealth = initialHealth;
  let lastAlerts = initialAlerts;

  if (soakDurationMs > 0) {
    const deadline = Date.now() + soakDurationMs;
    while (Date.now() < deadline) {
      await sleep(SOAK_POLL_SECONDS * 1000);
      lastHealth = await readBacktestHealth(accessToken);
      lastAlerts = await readOpenBacktestAlerts(accessToken);
      samples += 1;
      assertGateSnapshot({
        health: lastHealth,
        openAlerts: lastAlerts.total,
        sampleLabel: `soak sample ${samples}`,
      });
    }
  }

  const summary = {
    baseUrl: BASE_URL,
    smokeRan: RUN_LIFECYCLE_SMOKE,
    soakDurationMinutes: SOAK_DURATION_MINUTES,
    soakPollSeconds: SOAK_POLL_SECONDS,
    samples,
    startedAt: soakStartedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    thresholds: {
      staleRunningRuns: MAX_STALE_RUNNING_RUNS,
      incompleteTradeHistoryRuns: MAX_INCOMPLETE_TRADE_HISTORY_RUNS,
      openBacktestAlerts: MAX_OPEN_BACKTEST_ALERTS,
      recoverableRuns: MAX_RECOVERABLE_RUNS,
    },
    finalHealth: {
      status: readString(lastHealth.status),
      staleRunningRuns: Number(lastHealth.staleRunningRuns || 0),
      recoverableRuns: Number(lastHealth.recoverableRuns || 0),
      incompleteTradeHistoryRuns: Number(lastHealth.incompleteTradeHistoryRuns || 0),
      totalRuns: Number(lastHealth.totalRuns || 0),
      activeRuns: Number(lastHealth.activeRuns || 0),
      detail: readString(lastHealth.detail || ''),
    },
    finalAlerts: {
      openBacktestAlerts: lastAlerts.total,
      ids: lastAlerts.items.map((item) => readString(item.id)).filter(Boolean),
      messages: lastAlerts.items.map((item) => readString(item.message)).filter(Boolean),
    },
  };

  await persistSummary(summary);
  await writeStepSummary(summary);
  console.log('backtests-release-gate:', JSON.stringify(summary));
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
