import assert from 'node:assert/strict';
import { env } from '../../src/env';

type JsonRecord = Record<string, unknown>;

const resolvedHost = env.app.host === '0.0.0.0' ? '127.0.0.1' : env.app.host;
const BASE_URL =
  process.env.HEALTH_BASE_URL ||
  process.env.SMOKE_BASE_URL ||
  `http://${resolvedHost}:${env.app.port}${env.app.routePrefix}`;
const API_KEY = String(process.env.APP_API_KEY || process.env.API_KEY || '').trim();
const REQUIRE_FAILURE_ALERTS_ENABLED =
  String(process.env.BACKTESTS_REQUIRE_FAILURE_ALERTS_ENABLED || 'true')
    .trim()
    .toLowerCase() !== 'false';
const MAX_STALE_RUNNING_RUNS = Math.max(
  0,
  Number(process.env.BACKTESTS_MAX_STALE_RUNNING_RUNS || 0)
);
const MAX_INCOMPLETE_TRADE_HISTORY_RUNS = Math.max(
  0,
  Number(process.env.BACKTESTS_MAX_INCOMPLETE_TRADE_HISTORY_RUNS || 0)
);
const MAX_OPEN_ALERTS = Math.max(0, Number(process.env.BACKTESTS_MAX_OPEN_ALERTS || 0));
const MAX_OPEN_RUNTIME_ALERTS = Math.max(
  0,
  Number(process.env.BACKTESTS_MAX_OPEN_RUNTIME_ALERTS || MAX_OPEN_ALERTS)
);
const MAX_OPEN_RECOVERY_ALERTS = Math.max(
  0,
  Number(process.env.BACKTESTS_MAX_OPEN_RECOVERY_ALERTS || MAX_OPEN_ALERTS)
);
const MAX_OPEN_PROMOTION_ALERTS = Math.max(
  0,
  Number(process.env.BACKTESTS_MAX_OPEN_PROMOTION_ALERTS || MAX_OPEN_ALERTS)
);
const MAX_RECOVERABLE_RUNS_RAW = process.env.BACKTESTS_MAX_RECOVERABLE_RUNS;
const MAX_RECOVERABLE_RUNS =
  MAX_RECOVERABLE_RUNS_RAW === undefined || MAX_RECOVERABLE_RUNS_RAW === ''
    ? null
    : Math.max(0, Number(MAX_RECOVERABLE_RUNS_RAW));

function asRecord(value: unknown): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as JsonRecord;
}

async function requestJson(path: string): Promise<JsonRecord> {
  const headers = new Headers();
  if (API_KEY) {
    headers.set('x-api-key', API_KEY);
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    method: 'GET',
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

function readNumber(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

async function run(): Promise<void> {
  assert.ok(API_KEY, 'APP_API_KEY or API_KEY is required to poll /health/backtests');

  const backtestsHealthResponse = await requestJson('/health/backtests');
  const opsHealthResponse = await requestJson('/health/ops');
  const health = asRecord(backtestsHealthResponse.data);
  const ops = asRecord(opsHealthResponse.data);
  const opsConfig = asRecord(ops.config);

  const snapshot = {
    baseUrl: BASE_URL,
    status: String(health.status || 'unknown'),
    staleRunningRuns: readNumber(health.staleRunningRuns),
    recoverableRuns: readNumber(health.recoverableRuns),
    incompleteTradeHistoryRuns: readNumber(health.incompleteTradeHistoryRuns),
    openAlerts: readNumber(health.openAlerts),
    openRuntimeAlerts: readNumber(health.openRuntimeAlerts),
    openRecoveryAlerts: readNumber(health.openRecoveryAlerts),
    openPromotionAlerts: readNumber(health.openPromotionAlerts),
    emitFailureAlerts: Boolean(opsConfig.emitFailureAlerts),
    detail: String(health.detail || '').trim() || null,
  };

  console.log('backtests-health-check:', JSON.stringify(snapshot));

  if (String(snapshot.status).toLowerCase() === 'down') {
    throw new Error('backtests health is down');
  }
  if (REQUIRE_FAILURE_ALERTS_ENABLED && snapshot.emitFailureAlerts !== true) {
    throw new Error('observability failure alerts are disabled');
  }
  if (snapshot.staleRunningRuns > MAX_STALE_RUNNING_RUNS) {
    throw new Error(
      `stale running runs ${snapshot.staleRunningRuns} exceeds ${MAX_STALE_RUNNING_RUNS}`
    );
  }
  if (snapshot.incompleteTradeHistoryRuns > MAX_INCOMPLETE_TRADE_HISTORY_RUNS) {
    throw new Error(
      `incomplete trade history runs ${snapshot.incompleteTradeHistoryRuns} exceeds ${MAX_INCOMPLETE_TRADE_HISTORY_RUNS}`
    );
  }
  if (snapshot.openAlerts > MAX_OPEN_ALERTS) {
    throw new Error(`open backtests alerts ${snapshot.openAlerts} exceeds ${MAX_OPEN_ALERTS}`);
  }
  if (snapshot.openRuntimeAlerts > MAX_OPEN_RUNTIME_ALERTS) {
    throw new Error(
      `open runtime alerts ${snapshot.openRuntimeAlerts} exceeds ${MAX_OPEN_RUNTIME_ALERTS}`
    );
  }
  if (snapshot.openRecoveryAlerts > MAX_OPEN_RECOVERY_ALERTS) {
    throw new Error(
      `open recovery alerts ${snapshot.openRecoveryAlerts} exceeds ${MAX_OPEN_RECOVERY_ALERTS}`
    );
  }
  if (snapshot.openPromotionAlerts > MAX_OPEN_PROMOTION_ALERTS) {
    throw new Error(
      `open promotion alerts ${snapshot.openPromotionAlerts} exceeds ${MAX_OPEN_PROMOTION_ALERTS}`
    );
  }
  if (MAX_RECOVERABLE_RUNS !== null && snapshot.recoverableRuns > MAX_RECOVERABLE_RUNS) {
    throw new Error(
      `recoverable runs ${snapshot.recoverableRuns} exceeds ${MAX_RECOVERABLE_RUNS}`
    );
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
