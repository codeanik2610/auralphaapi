import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../../src/env';

type JsonRecord = Record<string, unknown>;

const resolvedHost = env.app.host === '0.0.0.0' ? '127.0.0.1' : env.app.host;
const BASE_URL =
  process.env.SMOKE_BASE_URL || `http://${resolvedHost}:${env.app.port}${env.app.routePrefix}`;
const API_KEY = String(process.env.APP_API_KEY || process.env.API_KEY || '').trim();
const LOGIN_EMAIL =
  process.env.SMOKE_LOGIN_EMAIL || process.env.AUTH_SEED_EMAIL || 'admin@auralpha.com';
const LOGIN_PASSWORD =
  process.env.SMOKE_LOGIN_PASSWORD || process.env.AUTH_SEED_PASSWORD || 'Admin@123';
const SOAK_DURATION_MINUTES = Math.max(
  0,
  Number(process.env.SUGGESTED_TRADES_SOAK_DURATION_MINUTES || 0)
);
const SOAK_POLL_SECONDS = Math.max(
  10,
  Number(process.env.SUGGESTED_TRADES_SOAK_POLL_SECONDS || 60)
);
const MAX_STALE_TRACKED_TRADES = Math.max(
  0,
  Number(process.env.SUGGESTED_TRADES_MAX_STALE_TRACKED_TRADES || 0)
);
const MAX_REFRESH_FAILURES_24H = Math.max(
  0,
  Number(process.env.SUGGESTED_TRADES_MAX_REFRESH_FAILURES_24H || 0)
);
const MAX_STATE_TRANSITION_FAILURES_24H = Math.max(
  0,
  Number(process.env.SUGGESTED_TRADES_MAX_STATE_TRANSITION_FAILURES_24H || 0)
);
const MAX_DUPLICATE_SUGGESTIONS_24H = Math.max(
  0,
  Number(process.env.SUGGESTED_TRADES_MAX_DUPLICATE_SUGGESTIONS_24H || 0)
);
const MAX_OPEN_ALERTS = Math.max(0, Number(process.env.SUGGESTED_TRADES_MAX_OPEN_ALERTS || 0));
const MAX_ACTION_ALERTS = Math.max(
  0,
  Number(process.env.SUGGESTED_TRADES_MAX_ACTION_ALERTS || MAX_OPEN_ALERTS)
);
const MAX_EXECUTION_ALERTS = Math.max(
  0,
  Number(process.env.SUGGESTED_TRADES_MAX_EXECUTION_ALERTS || MAX_OPEN_ALERTS)
);
const MAX_PROTECTION_FAILED_TRADES = Math.max(
  0,
  Number(process.env.SUGGESTED_TRADES_MAX_PROTECTION_FAILED_TRADES || 0)
);
const MAX_PROTECTION_MANUAL_ACTION_TRADES = Math.max(
  0,
  Number(process.env.SUGGESTED_TRADES_MAX_PROTECTION_MANUAL_ACTION_TRADES || 0)
);
const MAX_STALE_MANUAL_PROTECTION_TRADES = Math.max(
  0,
  Number(process.env.SUGGESTED_TRADES_MAX_STALE_MANUAL_PROTECTION_TRADES || 0)
);
const MAX_STALE_ATTACHING_PROTECTION_TRADES = Math.max(
  0,
  Number(process.env.SUGGESTED_TRADES_MAX_STALE_ATTACHING_PROTECTION_TRADES || 0)
);
const MAX_PROTECTION_ACTIONABLE_TRADES = Math.max(
  0,
  Number(process.env.SUGGESTED_TRADES_MAX_PROTECTION_ACTIONABLE_TRADES || 0)
);
const MAX_PROTECTION_UNRESOLVED_TRADES = Math.max(
  0,
  Number(process.env.SUGGESTED_TRADES_MAX_PROTECTION_UNRESOLVED_TRADES || 0)
);
const MAX_PROTECTION_RETRIABLE_FAILED_TRADES = Math.max(
  0,
  Number(process.env.SUGGESTED_TRADES_MAX_PROTECTION_RETRIABLE_FAILED_TRADES || 0)
);
const MIN_PROTECTION_ATTACHMENT_RATE = Math.max(
  0,
  Number(process.env.SUGGESTED_TRADES_MIN_PROTECTION_ATTACHMENT_RATE || 0)
);
const MIN_QUEUE_TO_ORDER_CONVERSION_RATE = Math.max(
  0,
  Number(process.env.SUGGESTED_TRADES_MIN_QUEUE_TO_ORDER_CONVERSION_RATE || 0)
);
const MAX_OVERVIEW_LATENCY_MS = Math.max(
  0,
  Number(process.env.SUGGESTED_TRADES_MAX_OVERVIEW_LATENCY_MS || 1500)
);
const MAX_LIST_LATENCY_MS = Math.max(
  0,
  Number(process.env.SUGGESTED_TRADES_MAX_LIST_LATENCY_MS || 1000)
);
const MAX_SUMMARY_LATENCY_MS = Math.max(
  0,
  Number(process.env.SUGGESTED_TRADES_MAX_SUMMARY_LATENCY_MS || 750)
);
const MAX_SYNC_STATUS_LATENCY_MS = Math.max(
  0,
  Number(process.env.SUGGESTED_TRADES_MAX_SYNC_STATUS_LATENCY_MS || 1000)
);
const RUN_LIFECYCLE_SMOKE =
  String(process.env.SUGGESTED_TRADES_RELEASE_GATE_RUN_SMOKE || 'true')
    .trim()
    .toLowerCase() !== 'false';
const REQUIRE_ROLLOUT_ENABLED =
  String(process.env.SUGGESTED_TRADES_REQUIRE_ROLLOUT_ENABLED || 'true')
    .trim()
    .toLowerCase() !== 'false';
const OUTPUT_FILE = String(
  process.env.SUGGESTED_TRADES_RELEASE_GATE_OUTPUT_FILE ||
    'artifacts/suggested-trades-release-gate.json'
).trim();
const STEP_SUMMARY_FILE = String(process.env.GITHUB_STEP_SUMMARY || '').trim();

function asRecord(value: unknown): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as JsonRecord;
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
    staleTrackedTrades: number;
    refreshFailures24h: number;
    stateTransitionFailures24h: number;
    duplicateSuggestions24h: number;
    openAlerts: number;
    openActionAlerts: number;
    openExecutionAlerts: number;
    protectionFailedTrades: number;
    protectionManualActionTrades: number;
    staleManualProtectionTrades: number;
    staleAttachingProtectionTrades: number;
    protectionActionableTrades: number;
    protectionUnresolvedTrades: number;
    protectionRetriableFailedTrades: number;
    minProtectionAttachmentRate: number;
    minQueueToOrderConversionRate: number;
    maxOverviewLatencyMs: number;
    maxListLatencyMs: number;
    maxSummaryLatencyMs: number;
    maxSyncStatusLatencyMs: number;
  };
  finalHealth: {
    status: string;
    rolloutEnabled: boolean;
    rolloutStage: string;
    syncState: string;
    staleTrackedTrades: number;
    refreshFailures24h: number;
    stateTransitionFailures24h: number;
    duplicateSuggestions24h: number;
    queueToOrderConversionRate: number | null;
    openAlerts: number;
    openActionAlerts: number;
    openExecutionAlerts: number;
    protectionTrackedTrades: number;
    protectionAttachedTrades: number;
    protectionFailedTrades: number;
    protectionManualActionTrades: number;
    protectionStaleManualActionTrades: number;
    protectionManualRecoveryStaleAfterMs: number;
    protectionStaleAttachingTrades: number;
    protectionAttachingStaleAfterMs: number;
    protectionActionableTrades: number;
    protectionUnresolvedTrades: number;
    protectionRetriableFailedTrades: number;
    protectionAttachmentRate: number | null;
    overviewLatencyMs: number | null;
    listLatencyMs: number | null;
    summaryLatencyMs: number | null;
    syncStatusLatencyMs: number | null;
    detail: string;
  };
}): Promise<void> {
  if (!STEP_SUMMARY_FILE) {
    return;
  }

  const lines = [
    '## Suggested Trades release gate',
    '',
    `- Base URL: \`${summary.baseUrl}\``,
    `- Lifecycle smoke ran: ${summary.smokeRan ? 'yes' : 'no'}`,
    `- Soak duration: ${summary.soakDurationMinutes} minute(s)`,
    `- Samples: ${summary.samples}`,
    '',
    '### Thresholds',
    '',
    `- staleTrackedTrades <= ${summary.thresholds.staleTrackedTrades}`,
    `- refreshFailures24h <= ${summary.thresholds.refreshFailures24h}`,
    `- stateTransitionFailures24h <= ${summary.thresholds.stateTransitionFailures24h}`,
    `- duplicateSuggestions24h <= ${summary.thresholds.duplicateSuggestions24h}`,
    `- openAlerts <= ${summary.thresholds.openAlerts}`,
    `- openActionAlerts <= ${summary.thresholds.openActionAlerts}`,
    `- openExecutionAlerts <= ${summary.thresholds.openExecutionAlerts}`,
    `- protectionFailedTrades <= ${summary.thresholds.protectionFailedTrades}`,
    `- protectionManualActionTrades <= ${summary.thresholds.protectionManualActionTrades}`,
    `- protectionStaleManualActionTrades <= ${summary.thresholds.staleManualProtectionTrades}`,
    `- protectionStaleAttachingTrades <= ${summary.thresholds.staleAttachingProtectionTrades}`,
    `- protectionActionableTrades <= ${summary.thresholds.protectionActionableTrades}`,
    `- protectionUnresolvedTrades <= ${summary.thresholds.protectionUnresolvedTrades}`,
    `- protectionRetriableFailedTrades <= ${summary.thresholds.protectionRetriableFailedTrades}`,
    `- protectionAttachmentRate >= ${summary.thresholds.minProtectionAttachmentRate}`,
    `- queueToOrderConversionRate >= ${summary.thresholds.minQueueToOrderConversionRate}`,
    `- overviewLatencyMs <= ${summary.thresholds.maxOverviewLatencyMs}`,
    `- listLatencyMs <= ${summary.thresholds.maxListLatencyMs}`,
    `- summaryLatencyMs <= ${summary.thresholds.maxSummaryLatencyMs}`,
    `- syncStatusLatencyMs <= ${summary.thresholds.maxSyncStatusLatencyMs}`,
    '',
    '### Final health',
    '',
    `- status: ${summary.finalHealth.status}`,
    `- rolloutEnabled: ${summary.finalHealth.rolloutEnabled ? 'yes' : 'no'}`,
    `- rolloutStage: ${summary.finalHealth.rolloutStage}`,
    `- syncState: ${summary.finalHealth.syncState}`,
    `- staleTrackedTrades: ${summary.finalHealth.staleTrackedTrades}`,
    `- refreshFailures24h: ${summary.finalHealth.refreshFailures24h}`,
    `- stateTransitionFailures24h: ${summary.finalHealth.stateTransitionFailures24h}`,
    `- duplicateSuggestions24h: ${summary.finalHealth.duplicateSuggestions24h}`,
    `- queueToOrderConversionRate: ${
      summary.finalHealth.queueToOrderConversionRate === null
        ? 'n/a'
        : summary.finalHealth.queueToOrderConversionRate
    }`,
    `- openAlerts: ${summary.finalHealth.openAlerts}`,
    `- openActionAlerts: ${summary.finalHealth.openActionAlerts}`,
    `- openExecutionAlerts: ${summary.finalHealth.openExecutionAlerts}`,
    `- protectionTrackedTrades: ${summary.finalHealth.protectionTrackedTrades}`,
    `- protectionAttachedTrades: ${summary.finalHealth.protectionAttachedTrades}`,
    `- protectionFailedTrades: ${summary.finalHealth.protectionFailedTrades}`,
    `- protectionManualActionTrades: ${summary.finalHealth.protectionManualActionTrades}`,
    `- protectionStaleManualActionTrades: ${summary.finalHealth.protectionStaleManualActionTrades}`,
    `- protectionManualRecoveryStaleAfterMs: ${summary.finalHealth.protectionManualRecoveryStaleAfterMs}`,
    `- protectionStaleAttachingTrades: ${summary.finalHealth.protectionStaleAttachingTrades}`,
    `- protectionAttachingStaleAfterMs: ${summary.finalHealth.protectionAttachingStaleAfterMs}`,
    `- protectionActionableTrades: ${summary.finalHealth.protectionActionableTrades}`,
    `- protectionUnresolvedTrades: ${summary.finalHealth.protectionUnresolvedTrades}`,
    `- protectionRetriableFailedTrades: ${summary.finalHealth.protectionRetriableFailedTrades}`,
    `- protectionAttachmentRate: ${
      summary.finalHealth.protectionAttachmentRate === null
        ? 'n/a'
        : summary.finalHealth.protectionAttachmentRate
    }`,
    `- overviewLatencyMs: ${summary.finalHealth.overviewLatencyMs ?? 'n/a'}`,
    `- listLatencyMs: ${summary.finalHealth.listLatencyMs ?? 'n/a'}`,
    `- summaryLatencyMs: ${summary.finalHealth.summaryLatencyMs ?? 'n/a'}`,
    `- syncStatusLatencyMs: ${summary.finalHealth.syncStatusLatencyMs ?? 'n/a'}`,
    `- detail: ${summary.finalHealth.detail || 'n/a'}`,
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
  } else if (API_KEY) {
    headers.set('x-api-key', API_KEY);
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

async function loginIfPossible(): Promise<string> {
  try {
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
    const accessToken = readString(asRecord(response.data).accessToken);
    assert.ok(accessToken, 'login should return an access token');
    return accessToken;
  } catch (error) {
    if (API_KEY) {
      return '';
    }
    throw error;
  }
}

async function runLifecycleSmoke(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', 'scripts/smokes/smoke-suggested-trades-lifecycle.ts'],
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
      reject(new Error(`suggested trades lifecycle smoke exited with code ${String(code)}`));
    });
  });
}

async function readSuggestedTradeHealth(accessToken: string): Promise<JsonRecord> {
  const response = await requestJson('/health/suggested-trades', {}, accessToken);
  return asRecord(response.data);
}

function assertGateSnapshot(params: { health: JsonRecord; sampleLabel: string }): void {
  const { health, sampleLabel } = params;
  const status = readString(health.status).toLowerCase();
  const rolloutEnabled = Boolean(health.rolloutEnabled);
  const staleTrackedTrades = readNumber(health.staleTrackedTrades);
  const refreshFailures24h = readNumber(health.refreshFailures24h);
  const stateTransitionFailures24h = readNumber(health.stateTransitionFailures24h);
  const duplicateSuggestions24h = readNumber(health.duplicateSuggestions24h);
  const openAlerts = readNumber(health.openAlerts);
  const openActionAlerts = readNumber(health.openActionAlerts);
  const openExecutionAlerts = readNumber(health.openExecutionAlerts);
  const protectionFailedTrades = readNumber(health.protectionFailedTrades);
  const protectionManualActionTrades = readNumber(health.protectionManualActionTrades);
  const protectionStaleManualActionTrades = readNumber(health.protectionStaleManualActionTrades);
  const protectionStaleAttachingTrades = readNumber(health.protectionStaleAttachingTrades);
  const protectionActionableTrades = readNumber(health.protectionActionableTrades);
  const protectionUnresolvedTrades = readNumber(health.protectionUnresolvedTrades);
  const protectionRetriableFailedTrades = readNumber(health.protectionRetriableFailedTrades);
  const overviewLatencyMs =
    health.overviewLatencyMs === null || health.overviewLatencyMs === undefined
      ? null
      : readNumber(health.overviewLatencyMs);
  const listLatencyMs =
    health.listLatencyMs === null || health.listLatencyMs === undefined
      ? null
      : readNumber(health.listLatencyMs);
  const summaryLatencyMs =
    health.summaryLatencyMs === null || health.summaryLatencyMs === undefined
      ? null
      : readNumber(health.summaryLatencyMs);
  const syncStatusLatencyMs =
    health.syncStatusLatencyMs === null || health.syncStatusLatencyMs === undefined
      ? null
      : readNumber(health.syncStatusLatencyMs);
  const queueToOrderConversionRate =
    health.queueToOrderConversionRate === null || health.queueToOrderConversionRate === undefined
      ? null
      : readNumber(health.queueToOrderConversionRate);
  const protectionAttachmentRate =
    health.protectionAttachmentRate === null || health.protectionAttachmentRate === undefined
      ? null
      : readNumber(health.protectionAttachmentRate);

  assert.notEqual(status, 'down', `${sampleLabel}: suggested trades health is down`);
  if (REQUIRE_ROLLOUT_ENABLED) {
    assert.equal(rolloutEnabled, true, `${sampleLabel}: suggested trades rollout is disabled`);
  }
  assert.ok(
    staleTrackedTrades <= MAX_STALE_TRACKED_TRADES,
    `${sampleLabel}: stale tracked trades ${staleTrackedTrades} exceeds ${MAX_STALE_TRACKED_TRADES}`
  );
  assert.ok(
    refreshFailures24h <= MAX_REFRESH_FAILURES_24H,
    `${sampleLabel}: refresh failures in 24h ${refreshFailures24h} exceeds ${MAX_REFRESH_FAILURES_24H}`
  );
  assert.ok(
    stateTransitionFailures24h <= MAX_STATE_TRANSITION_FAILURES_24H,
    `${sampleLabel}: state transition failures in 24h ${stateTransitionFailures24h} exceeds ${MAX_STATE_TRANSITION_FAILURES_24H}`
  );
  assert.ok(
    duplicateSuggestions24h <= MAX_DUPLICATE_SUGGESTIONS_24H,
    `${sampleLabel}: duplicate suggestions in 24h ${duplicateSuggestions24h} exceeds ${MAX_DUPLICATE_SUGGESTIONS_24H}`
  );
  assert.ok(
    openAlerts <= MAX_OPEN_ALERTS,
    `${sampleLabel}: open suggested trade alerts ${openAlerts} exceeds ${MAX_OPEN_ALERTS}`
  );
  assert.ok(
    openActionAlerts <= MAX_ACTION_ALERTS,
    `${sampleLabel}: open action alerts ${openActionAlerts} exceeds ${MAX_ACTION_ALERTS}`
  );
  assert.ok(
    openExecutionAlerts <= MAX_EXECUTION_ALERTS,
    `${sampleLabel}: open execution alerts ${openExecutionAlerts} exceeds ${MAX_EXECUTION_ALERTS}`
  );
  assert.ok(
    protectionFailedTrades <= MAX_PROTECTION_FAILED_TRADES,
    `${sampleLabel}: protection failed trades ${protectionFailedTrades} exceeds ${MAX_PROTECTION_FAILED_TRADES}`
  );
  assert.ok(
    protectionManualActionTrades <= MAX_PROTECTION_MANUAL_ACTION_TRADES,
    `${sampleLabel}: protection manual-action trades ${protectionManualActionTrades} exceeds ${MAX_PROTECTION_MANUAL_ACTION_TRADES}`
  );
  assert.ok(
    protectionStaleManualActionTrades <= MAX_STALE_MANUAL_PROTECTION_TRADES,
    `${sampleLabel}: stale manual protection trades ${protectionStaleManualActionTrades} exceeds ${MAX_STALE_MANUAL_PROTECTION_TRADES}`
  );
  assert.ok(
    protectionStaleAttachingTrades <= MAX_STALE_ATTACHING_PROTECTION_TRADES,
    `${sampleLabel}: stale attaching protection trades ${protectionStaleAttachingTrades} exceeds ${MAX_STALE_ATTACHING_PROTECTION_TRADES}`
  );
  assert.ok(
    protectionActionableTrades <= MAX_PROTECTION_ACTIONABLE_TRADES,
    `${sampleLabel}: protection actionable trades ${protectionActionableTrades} exceeds ${MAX_PROTECTION_ACTIONABLE_TRADES}`
  );
  assert.ok(
    protectionUnresolvedTrades <= MAX_PROTECTION_UNRESOLVED_TRADES,
    `${sampleLabel}: protection unresolved trades ${protectionUnresolvedTrades} exceeds ${MAX_PROTECTION_UNRESOLVED_TRADES}`
  );
  assert.ok(
    protectionRetriableFailedTrades <= MAX_PROTECTION_RETRIABLE_FAILED_TRADES,
    `${sampleLabel}: protection retriable failed trades ${protectionRetriableFailedTrades} exceeds ${MAX_PROTECTION_RETRIABLE_FAILED_TRADES}`
  );
  if (protectionAttachmentRate !== null) {
    assert.ok(
      protectionAttachmentRate >= MIN_PROTECTION_ATTACHMENT_RATE,
      `${sampleLabel}: protection attachment rate ${protectionAttachmentRate} is below ${MIN_PROTECTION_ATTACHMENT_RATE}`
    );
  } else {
    assert.equal(
      MIN_PROTECTION_ATTACHMENT_RATE <= 0,
      true,
      `${sampleLabel}: protection attachment rate is unavailable`
    );
  }
  if (queueToOrderConversionRate !== null) {
    assert.ok(
      queueToOrderConversionRate >= MIN_QUEUE_TO_ORDER_CONVERSION_RATE,
      `${sampleLabel}: queue-to-order conversion ${queueToOrderConversionRate} is below ${MIN_QUEUE_TO_ORDER_CONVERSION_RATE}`
    );
  } else {
    assert.equal(
      MIN_QUEUE_TO_ORDER_CONVERSION_RATE <= 0,
      true,
      `${sampleLabel}: queue-to-order conversion rate is unavailable`
    );
  }
  if (overviewLatencyMs !== null) {
    assert.ok(
      overviewLatencyMs <= MAX_OVERVIEW_LATENCY_MS,
      `${sampleLabel}: overview latency ${overviewLatencyMs} exceeds ${MAX_OVERVIEW_LATENCY_MS}`
    );
  }
  if (listLatencyMs !== null) {
    assert.ok(
      listLatencyMs <= MAX_LIST_LATENCY_MS,
      `${sampleLabel}: list latency ${listLatencyMs} exceeds ${MAX_LIST_LATENCY_MS}`
    );
  }
  if (summaryLatencyMs !== null) {
    assert.ok(
      summaryLatencyMs <= MAX_SUMMARY_LATENCY_MS,
      `${sampleLabel}: summary latency ${summaryLatencyMs} exceeds ${MAX_SUMMARY_LATENCY_MS}`
    );
  }
  if (syncStatusLatencyMs !== null) {
    assert.ok(
      syncStatusLatencyMs <= MAX_SYNC_STATUS_LATENCY_MS,
      `${sampleLabel}: sync status latency ${syncStatusLatencyMs} exceeds ${MAX_SYNC_STATUS_LATENCY_MS}`
    );
  }
}

async function run(): Promise<void> {
  const accessToken = await loginIfPossible();
  assert.ok(
    accessToken || API_KEY,
    'Either admin login credentials or APP_API_KEY/API_KEY is required to run the suggested trades release gate'
  );

  if (accessToken) {
    const meResponse = await requestJson('/auth/me', {}, accessToken);
    const me = asRecord(meResponse.data);
    assert.equal(readString(me.email).toLowerCase(), LOGIN_EMAIL.toLowerCase());
  }

  if (RUN_LIFECYCLE_SMOKE) {
    await runLifecycleSmoke();
  }

  const initialHealth = await readSuggestedTradeHealth(accessToken);
  assertGateSnapshot({
    health: initialHealth,
    sampleLabel: 'initial gate',
  });

  const soakStartedAt = new Date();
  const soakDurationMs = SOAK_DURATION_MINUTES * 60 * 1000;
  let samples = 1;
  let lastHealth = initialHealth;

  if (soakDurationMs > 0) {
    const deadline = Date.now() + soakDurationMs;
    while (Date.now() < deadline) {
      await sleep(SOAK_POLL_SECONDS * 1000);
      lastHealth = await readSuggestedTradeHealth(accessToken);
      samples += 1;
      assertGateSnapshot({
        health: lastHealth,
        sampleLabel: `soak sample ${samples}`,
      });
    }
  }

  const finalQueueToOrderConversionRate =
    lastHealth.queueToOrderConversionRate === null ||
    lastHealth.queueToOrderConversionRate === undefined
      ? null
      : readNumber(lastHealth.queueToOrderConversionRate);

  const summary = {
    baseUrl: BASE_URL,
    smokeRan: RUN_LIFECYCLE_SMOKE,
    soakDurationMinutes: SOAK_DURATION_MINUTES,
    soakPollSeconds: SOAK_POLL_SECONDS,
    samples,
    startedAt: soakStartedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    thresholds: {
      staleTrackedTrades: MAX_STALE_TRACKED_TRADES,
      refreshFailures24h: MAX_REFRESH_FAILURES_24H,
      stateTransitionFailures24h: MAX_STATE_TRANSITION_FAILURES_24H,
      duplicateSuggestions24h: MAX_DUPLICATE_SUGGESTIONS_24H,
      openAlerts: MAX_OPEN_ALERTS,
      openActionAlerts: MAX_ACTION_ALERTS,
      openExecutionAlerts: MAX_EXECUTION_ALERTS,
      protectionFailedTrades: MAX_PROTECTION_FAILED_TRADES,
      protectionManualActionTrades: MAX_PROTECTION_MANUAL_ACTION_TRADES,
      staleManualProtectionTrades: MAX_STALE_MANUAL_PROTECTION_TRADES,
      staleAttachingProtectionTrades: MAX_STALE_ATTACHING_PROTECTION_TRADES,
      protectionActionableTrades: MAX_PROTECTION_ACTIONABLE_TRADES,
      protectionUnresolvedTrades: MAX_PROTECTION_UNRESOLVED_TRADES,
      protectionRetriableFailedTrades: MAX_PROTECTION_RETRIABLE_FAILED_TRADES,
      minProtectionAttachmentRate: MIN_PROTECTION_ATTACHMENT_RATE,
      minQueueToOrderConversionRate: MIN_QUEUE_TO_ORDER_CONVERSION_RATE,
      maxOverviewLatencyMs: MAX_OVERVIEW_LATENCY_MS,
      maxListLatencyMs: MAX_LIST_LATENCY_MS,
      maxSummaryLatencyMs: MAX_SUMMARY_LATENCY_MS,
      maxSyncStatusLatencyMs: MAX_SYNC_STATUS_LATENCY_MS,
    },
    finalHealth: {
      status: readString(lastHealth.status),
      rolloutEnabled: Boolean(lastHealth.rolloutEnabled),
      rolloutStage: readString(lastHealth.rolloutStage),
      syncState: readString(lastHealth.syncState),
      staleTrackedTrades: readNumber(lastHealth.staleTrackedTrades),
      refreshFailures24h: readNumber(lastHealth.refreshFailures24h),
      stateTransitionFailures24h: readNumber(lastHealth.stateTransitionFailures24h),
      duplicateSuggestions24h: readNumber(lastHealth.duplicateSuggestions24h),
      queueToOrderConversionRate: finalQueueToOrderConversionRate,
      openAlerts: readNumber(lastHealth.openAlerts),
      openActionAlerts: readNumber(lastHealth.openActionAlerts),
      openExecutionAlerts: readNumber(lastHealth.openExecutionAlerts),
      protectionTrackedTrades: readNumber(lastHealth.protectionTrackedTrades),
      protectionAttachedTrades: readNumber(lastHealth.protectionAttachedTrades),
      protectionFailedTrades: readNumber(lastHealth.protectionFailedTrades),
      protectionManualActionTrades: readNumber(lastHealth.protectionManualActionTrades),
      protectionStaleManualActionTrades: readNumber(lastHealth.protectionStaleManualActionTrades),
      protectionManualRecoveryStaleAfterMs: readNumber(
        lastHealth.protectionManualRecoveryStaleAfterMs
      ),
      protectionStaleAttachingTrades: readNumber(lastHealth.protectionStaleAttachingTrades),
      protectionAttachingStaleAfterMs: readNumber(lastHealth.protectionAttachingStaleAfterMs),
      protectionActionableTrades: readNumber(lastHealth.protectionActionableTrades),
      protectionUnresolvedTrades: readNumber(lastHealth.protectionUnresolvedTrades),
      protectionRetriableFailedTrades: readNumber(lastHealth.protectionRetriableFailedTrades),
      protectionAttachmentRate:
        lastHealth.protectionAttachmentRate === null ||
        lastHealth.protectionAttachmentRate === undefined
          ? null
          : readNumber(lastHealth.protectionAttachmentRate),
      overviewLatencyMs:
        lastHealth.overviewLatencyMs === null || lastHealth.overviewLatencyMs === undefined
          ? null
          : readNumber(lastHealth.overviewLatencyMs),
      listLatencyMs:
        lastHealth.listLatencyMs === null || lastHealth.listLatencyMs === undefined
          ? null
          : readNumber(lastHealth.listLatencyMs),
      summaryLatencyMs:
        lastHealth.summaryLatencyMs === null || lastHealth.summaryLatencyMs === undefined
          ? null
          : readNumber(lastHealth.summaryLatencyMs),
      syncStatusLatencyMs:
        lastHealth.syncStatusLatencyMs === null || lastHealth.syncStatusLatencyMs === undefined
          ? null
          : readNumber(lastHealth.syncStatusLatencyMs),
      detail: readString(lastHealth.detail),
    },
  };

  await persistSummary(summary);
  await writeStepSummary(summary);

  console.log('suggested-trades-release-gate:', JSON.stringify(summary));
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
