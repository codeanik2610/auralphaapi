import assert from 'node:assert/strict';
import { env } from '../../src/env';

type JsonRecord = Record<string, unknown>;

const resolvedHost = env.app.host === '0.0.0.0' ? '127.0.0.1' : env.app.host;
const BASE_URL =
  process.env.HEALTH_BASE_URL ||
  process.env.SMOKE_BASE_URL ||
  `http://${resolvedHost}:${env.app.port}${env.app.routePrefix}`;
const API_KEY = String(process.env.APP_API_KEY || process.env.API_KEY || '').trim();
const LOGIN_EMAIL =
  process.env.SMOKE_LOGIN_EMAIL || process.env.AUTH_SEED_EMAIL || 'admin@auralpha.com';
const LOGIN_PASSWORD =
  process.env.SMOKE_LOGIN_PASSWORD || process.env.AUTH_SEED_PASSWORD || 'Admin@123';
const REQUIRE_ROLLOUT_ENABLED =
  String(process.env.SUGGESTED_TRADES_REQUIRE_ROLLOUT_ENABLED || 'true')
    .trim()
    .toLowerCase() !== 'false';
const REQUIRE_LATENCY_PROBE =
  String(process.env.SUGGESTED_TRADES_REQUIRE_LATENCY_PROBE || 'false')
    .trim()
    .toLowerCase() === 'true';
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
  return Number.isFinite(numeric) ? numeric : 0;
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
    throw new Error(`${path} -> HTTP ${response.status}: ${JSON.stringify(payload)}`);
  }

  return payload;
}

async function loginIfPossible(): Promise<string> {
  if (!LOGIN_EMAIL || !LOGIN_PASSWORD) {
    return '';
  }

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
    return readString(asRecord(response.data).accessToken);
  } catch {
    return '';
  }
}

async function run(): Promise<void> {
  const accessToken = await loginIfPossible();
  assert.ok(
    accessToken || API_KEY,
    'Either admin login credentials or APP_API_KEY/API_KEY is required to poll /health/suggested-trades'
  );

  const healthResponse = await requestJson('/health/suggested-trades', {}, accessToken);
  const runtimeResponse = await requestJson('/health/runtime', {}, accessToken);
  const health = asRecord(healthResponse.data);
  const runtime = asRecord(runtimeResponse.data);
  const runtimeLoops = asArray(runtime.apiLoops).map((item) => readString(item.key)).filter(Boolean);

  const snapshot = {
    baseUrl: BASE_URL,
    status: readString(health.status || 'unknown'),
    runtimeStatus: readString(asRecord(runtime.automations).status || 'unknown'),
    rolloutEnabled: Boolean(health.rolloutEnabled),
    rolloutStage: readString(health.rolloutStage || 'unknown'),
    syncState: readString(health.syncState || 'unknown'),
    staleTrackedTrades: readNumber(health.staleTrackedTrades),
    refreshFailures24h: readNumber(health.refreshFailures24h),
    stateTransitionFailures24h: readNumber(health.stateTransitionFailures24h),
    duplicateSuggestions24h: readNumber(health.duplicateSuggestions24h),
    queueToOrderConversionRate:
      health.queueToOrderConversionRate === null || health.queueToOrderConversionRate === undefined
        ? null
        : readNumber(health.queueToOrderConversionRate),
    openAlerts: readNumber(health.openAlerts),
    openActionAlerts: readNumber(health.openActionAlerts),
    openExecutionAlerts: readNumber(health.openExecutionAlerts),
    overviewLatencyMs:
      health.overviewLatencyMs === null || health.overviewLatencyMs === undefined
        ? null
        : readNumber(health.overviewLatencyMs),
    listLatencyMs:
      health.listLatencyMs === null || health.listLatencyMs === undefined
        ? null
        : readNumber(health.listLatencyMs),
    summaryLatencyMs:
      health.summaryLatencyMs === null || health.summaryLatencyMs === undefined
        ? null
        : readNumber(health.summaryLatencyMs),
    syncStatusLatencyMs:
      health.syncStatusLatencyMs === null || health.syncStatusLatencyMs === undefined
        ? null
        : readNumber(health.syncStatusLatencyMs),
    runtimeLoops,
    probeUserId: readString(health.probeUserId) || null,
    detail: readString(health.detail) || null,
  };

  console.log('suggested-trades-health-check:', JSON.stringify(snapshot));

  if (snapshot.status.toLowerCase() === 'down') {
    throw new Error('suggested trades health is down');
  }
  if (snapshot.runtimeStatus.toLowerCase() === 'down') {
    throw new Error('runtime overview reports automations as down for suggested trades');
  }
  if (!snapshot.runtimeLoops.includes('suggested-trades-execution-sync')) {
    throw new Error('runtime overview is missing suggested-trades-execution-sync loop');
  }
  if (REQUIRE_ROLLOUT_ENABLED && snapshot.rolloutEnabled !== true) {
    throw new Error('suggested trades rollout is disabled');
  }
  if (snapshot.staleTrackedTrades > MAX_STALE_TRACKED_TRADES) {
    throw new Error(
      `stale tracked trades ${snapshot.staleTrackedTrades} exceeds ${MAX_STALE_TRACKED_TRADES}`
    );
  }
  if (snapshot.refreshFailures24h > MAX_REFRESH_FAILURES_24H) {
    throw new Error(
      `refresh failures in 24h ${snapshot.refreshFailures24h} exceeds ${MAX_REFRESH_FAILURES_24H}`
    );
  }
  if (snapshot.stateTransitionFailures24h > MAX_STATE_TRANSITION_FAILURES_24H) {
    throw new Error(
      `state transition failures in 24h ${snapshot.stateTransitionFailures24h} exceeds ${MAX_STATE_TRANSITION_FAILURES_24H}`
    );
  }
  if (snapshot.duplicateSuggestions24h > MAX_DUPLICATE_SUGGESTIONS_24H) {
    throw new Error(
      `duplicate suggestions in 24h ${snapshot.duplicateSuggestions24h} exceeds ${MAX_DUPLICATE_SUGGESTIONS_24H}`
    );
  }
  if (snapshot.openAlerts > MAX_OPEN_ALERTS) {
    throw new Error(`open suggested trade alerts ${snapshot.openAlerts} exceeds ${MAX_OPEN_ALERTS}`);
  }
  if (snapshot.openActionAlerts > MAX_ACTION_ALERTS) {
    throw new Error(
      `open suggested trade action alerts ${snapshot.openActionAlerts} exceeds ${MAX_ACTION_ALERTS}`
    );
  }
  if (snapshot.openExecutionAlerts > MAX_EXECUTION_ALERTS) {
    throw new Error(
      `open suggested trade execution alerts ${snapshot.openExecutionAlerts} exceeds ${MAX_EXECUTION_ALERTS}`
    );
  }
  if (
    snapshot.queueToOrderConversionRate !== null &&
    snapshot.queueToOrderConversionRate < MIN_QUEUE_TO_ORDER_CONVERSION_RATE
  ) {
    throw new Error(
      `queue-to-order conversion ${snapshot.queueToOrderConversionRate} is below ${MIN_QUEUE_TO_ORDER_CONVERSION_RATE}`
    );
  }
  if (snapshot.queueToOrderConversionRate === null && MIN_QUEUE_TO_ORDER_CONVERSION_RATE > 0) {
    throw new Error('queue-to-order conversion rate is unavailable for threshold enforcement');
  }

  if (REQUIRE_LATENCY_PROBE) {
    assert.ok(snapshot.probeUserId, 'latency probe user id is required');
    assert.notEqual(snapshot.overviewLatencyMs, null, 'overview latency probe is required');
    assert.notEqual(snapshot.listLatencyMs, null, 'list latency probe is required');
    assert.notEqual(snapshot.summaryLatencyMs, null, 'summary latency probe is required');
    assert.notEqual(snapshot.syncStatusLatencyMs, null, 'sync status latency probe is required');
  }

  if (snapshot.overviewLatencyMs !== null && snapshot.overviewLatencyMs > MAX_OVERVIEW_LATENCY_MS) {
    throw new Error(
      `overview latency ${snapshot.overviewLatencyMs}ms exceeds ${MAX_OVERVIEW_LATENCY_MS}ms`
    );
  }
  if (snapshot.listLatencyMs !== null && snapshot.listLatencyMs > MAX_LIST_LATENCY_MS) {
    throw new Error(`list latency ${snapshot.listLatencyMs}ms exceeds ${MAX_LIST_LATENCY_MS}ms`);
  }
  if (snapshot.summaryLatencyMs !== null && snapshot.summaryLatencyMs > MAX_SUMMARY_LATENCY_MS) {
    throw new Error(
      `summary latency ${snapshot.summaryLatencyMs}ms exceeds ${MAX_SUMMARY_LATENCY_MS}ms`
    );
  }
  if (
    snapshot.syncStatusLatencyMs !== null &&
    snapshot.syncStatusLatencyMs > MAX_SYNC_STATUS_LATENCY_MS
  ) {
    throw new Error(
      `sync status latency ${snapshot.syncStatusLatencyMs}ms exceeds ${MAX_SYNC_STATUS_LATENCY_MS}ms`
    );
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
