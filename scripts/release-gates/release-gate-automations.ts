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
  Number(process.env.AUTOMATIONS_SOAK_DURATION_MINUTES || 0)
);
const SOAK_POLL_SECONDS = Math.max(
  10,
  Number(process.env.AUTOMATIONS_SOAK_POLL_SECONDS || 60)
);
const MAX_FAILED_RUNS_24H = Math.max(
  0,
  Number(process.env.AUTOMATIONS_MAX_FAILED_RUNS_24H || 0)
);
const MAX_OVERLAP_SKIPS_24H = Math.max(
  0,
  Number(process.env.AUTOMATIONS_MAX_OVERLAP_SKIPS_24H || 0)
);
const MAX_STALE_CURSORS = Math.max(0, Number(process.env.AUTOMATIONS_MAX_STALE_CURSORS || 0));
const MAX_OPEN_AUTOMATION_ALERTS = Math.max(
  0,
  Number(process.env.AUTOMATIONS_MAX_OPEN_ALERTS || 0)
);
const MAX_OPEN_CONTROL_ALERTS = Math.max(
  0,
  Number(process.env.AUTOMATIONS_MAX_OPEN_CONTROL_ALERTS || MAX_OPEN_AUTOMATION_ALERTS)
);
const MAX_OPEN_RECOVERY_ALERTS = Math.max(
  0,
  Number(process.env.AUTOMATIONS_MAX_OPEN_RECOVERY_ALERTS || MAX_OPEN_AUTOMATION_ALERTS)
);
const MAX_OPEN_EXECUTION_ALERTS = Math.max(
  0,
  Number(process.env.AUTOMATIONS_MAX_OPEN_EXECUTION_ALERTS || MAX_OPEN_AUTOMATION_ALERTS)
);
const RUN_LIFECYCLE_SMOKE =
  String(process.env.AUTOMATIONS_RELEASE_GATE_RUN_SMOKE || 'true')
    .trim()
    .toLowerCase() !== 'false';
const REQUIRE_FAILURE_ALERTS_ENABLED =
  String(process.env.AUTOMATIONS_REQUIRE_FAILURE_ALERTS_ENABLED || 'true')
    .trim()
    .toLowerCase() !== 'false';
const OUTPUT_FILE = String(process.env.AUTOMATIONS_RELEASE_GATE_OUTPUT_FILE || '').trim();
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
    failedRuns24h: number;
    overlapSkips24h: number;
    staleCursorCount: number;
    openAutomationAlerts: number;
    openControlAlerts: number;
    openRecoveryAlerts: number;
    openExecutionAlerts: number;
  };
  finalHealth: {
    status: string;
    workerStatus: string;
    queueStatus: string;
    failedRuns24h: number;
    overlapSkips24h: number;
    staleCursorCount: number;
    totalAutomations: number;
    runningAutomations: number;
    pausedAutomations: number;
    detail: string;
  };
  finalAlerts: {
    openAutomationAlerts: number;
    ids: string[];
    messages: string[];
  };
}): Promise<void> {
  if (!STEP_SUMMARY_FILE) {
    return;
  }

  const lines = [
    '## Automations release gate',
    '',
    `- Base URL: \`${summary.baseUrl}\``,
    `- Lifecycle smoke ran: ${summary.smokeRan ? 'yes' : 'no'}`,
    `- Soak duration: ${summary.soakDurationMinutes} minute(s)`,
    `- Samples: ${summary.samples}`,
    '',
    '### Thresholds',
    '',
    `- failedRuns24h <= ${summary.thresholds.failedRuns24h}`,
    `- overlapSkips24h <= ${summary.thresholds.overlapSkips24h}`,
    `- staleCursorCount <= ${summary.thresholds.staleCursorCount}`,
    `- openAutomationAlerts <= ${summary.thresholds.openAutomationAlerts}`,
    `- openControlAlerts <= ${summary.thresholds.openControlAlerts}`,
    `- openRecoveryAlerts <= ${summary.thresholds.openRecoveryAlerts}`,
    `- openExecutionAlerts <= ${summary.thresholds.openExecutionAlerts}`,
    '',
    '### Final health',
    '',
    `- status: ${summary.finalHealth.status}`,
    `- workerStatus: ${summary.finalHealth.workerStatus}`,
    `- queueStatus: ${summary.finalHealth.queueStatus}`,
    `- failedRuns24h: ${summary.finalHealth.failedRuns24h}`,
    `- overlapSkips24h: ${summary.finalHealth.overlapSkips24h}`,
    `- staleCursorCount: ${summary.finalHealth.staleCursorCount}`,
    `- totalAutomations: ${summary.finalHealth.totalAutomations}`,
    `- runningAutomations: ${summary.finalHealth.runningAutomations}`,
    `- pausedAutomations: ${summary.finalHealth.pausedAutomations}`,
    `- detail: ${summary.finalHealth.detail || 'n/a'}`,
    '',
    '### Final alerts',
    '',
    `- openAutomationAlerts: ${summary.finalAlerts.openAutomationAlerts}`,
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
      ['--import', 'tsx', 'scripts/smokes/smoke-automations-lifecycle.ts'],
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
      reject(new Error(`automations lifecycle smoke exited with code ${String(code)}`));
    });
  });
}

async function readAutomationHealth(accessToken: string): Promise<JsonRecord> {
  const response = await requestJson('/health/automations', {}, accessToken);
  return asRecord(response.data);
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

async function readOpenAutomationAlerts(accessToken: string): Promise<{
  total: number;
  items: JsonRecord[];
}> {
  const response = await requestJson(
    '/alerts/overview?status=Open&channel=Automation&limit=20&offset=0',
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
  sampleLabel: string;
}): void {
  const { health, sampleLabel } = params;
  const status = readString(health.status).toLowerCase();
  const workerStatus = readString(health.workerStatus).toLowerCase();
  const queueStatus = readString(health.queueStatus).toLowerCase();
  const failedRuns24h = readNumber(health.failedRuns24h);
  const overlapSkips24h = readNumber(health.overlapSkips24h);
  const staleCursorCount = readNumber(health.staleCursorCount);
  const openAlerts = readNumber(health.openAlerts);
  const openControlAlerts = readNumber(health.openControlAlerts);
  const openRecoveryAlerts = readNumber(health.openRecoveryAlerts);
  const openExecutionAlerts = readNumber(health.openExecutionAlerts);

  assert.notEqual(status, 'down', `${sampleLabel}: automations health is down`);
  assert.equal(queueStatus, 'ok', `${sampleLabel}: automation queue status is ${queueStatus || 'unknown'}`);
  assert.equal(workerStatus, 'ok', `${sampleLabel}: automation worker status is ${workerStatus || 'unknown'}`);
  assert.ok(
    failedRuns24h <= MAX_FAILED_RUNS_24H,
    `${sampleLabel}: failed runs in 24h ${failedRuns24h} exceeds ${MAX_FAILED_RUNS_24H}`
  );
  assert.ok(
    overlapSkips24h <= MAX_OVERLAP_SKIPS_24H,
    `${sampleLabel}: overlap skips in 24h ${overlapSkips24h} exceeds ${MAX_OVERLAP_SKIPS_24H}`
  );
  assert.ok(
    staleCursorCount <= MAX_STALE_CURSORS,
    `${sampleLabel}: stale cursor count ${staleCursorCount} exceeds ${MAX_STALE_CURSORS}`
  );
  assert.ok(
    openAlerts <= MAX_OPEN_AUTOMATION_ALERTS,
    `${sampleLabel}: open automation alerts ${openAlerts} exceeds ${MAX_OPEN_AUTOMATION_ALERTS}`
  );
  assert.ok(
    openControlAlerts <= MAX_OPEN_CONTROL_ALERTS,
    `${sampleLabel}: open control alerts ${openControlAlerts} exceeds ${MAX_OPEN_CONTROL_ALERTS}`
  );
  assert.ok(
    openRecoveryAlerts <= MAX_OPEN_RECOVERY_ALERTS,
    `${sampleLabel}: open recovery alerts ${openRecoveryAlerts} exceeds ${MAX_OPEN_RECOVERY_ALERTS}`
  );
  assert.ok(
    openExecutionAlerts <= MAX_OPEN_EXECUTION_ALERTS,
    `${sampleLabel}: open execution alerts ${openExecutionAlerts} exceeds ${MAX_OPEN_EXECUTION_ALERTS}`
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
  console.log('automations-release-gate-observability:', JSON.stringify(observability));

  if (RUN_LIFECYCLE_SMOKE) {
    await runLifecycleSmoke();
  }

  const initialHealth = await readAutomationHealth(accessToken);
  const initialAlerts = await readOpenAutomationAlerts(accessToken);
  assertGateSnapshot({
    health: initialHealth,
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
      lastHealth = await readAutomationHealth(accessToken);
      lastAlerts = await readOpenAutomationAlerts(accessToken);
      samples += 1;
      assertGateSnapshot({
        health: lastHealth,
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
      failedRuns24h: MAX_FAILED_RUNS_24H,
      overlapSkips24h: MAX_OVERLAP_SKIPS_24H,
      staleCursorCount: MAX_STALE_CURSORS,
      openAutomationAlerts: MAX_OPEN_AUTOMATION_ALERTS,
      openControlAlerts: MAX_OPEN_CONTROL_ALERTS,
      openRecoveryAlerts: MAX_OPEN_RECOVERY_ALERTS,
      openExecutionAlerts: MAX_OPEN_EXECUTION_ALERTS,
    },
    finalHealth: {
      status: readString(lastHealth.status),
      workerStatus: readString(lastHealth.workerStatus),
      queueStatus: readString(lastHealth.queueStatus),
      failedRuns24h: readNumber(lastHealth.failedRuns24h),
      overlapSkips24h: readNumber(lastHealth.overlapSkips24h),
      staleCursorCount: readNumber(lastHealth.staleCursorCount),
      totalAutomations: readNumber(lastHealth.totalAutomations),
      runningAutomations: readNumber(lastHealth.runningAutomations),
      pausedAutomations: readNumber(lastHealth.pausedAutomations),
      detail: readString(lastHealth.detail),
    },
    finalAlerts: {
      openAutomationAlerts: readNumber(lastHealth.openAlerts),
      ids: lastAlerts.items.map((item) => readString(item.id)).filter(Boolean),
      messages: lastAlerts.items.map((item) => readString(item.message)).filter(Boolean),
    },
  };

  await persistSummary(summary);
  await writeStepSummary(summary);

  console.log('automations-release-gate:', JSON.stringify(summary));
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
