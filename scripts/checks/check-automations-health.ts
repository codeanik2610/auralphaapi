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
  String(process.env.AUTOMATIONS_REQUIRE_FAILURE_ALERTS_ENABLED || 'true')
    .trim()
    .toLowerCase() !== 'false';
const MAX_FAILED_RUNS_24H = Math.max(
  0,
  Number(process.env.AUTOMATIONS_MAX_FAILED_RUNS_24H || 0)
);
const MAX_OVERLAP_SKIPS_24H = Math.max(
  0,
  Number(process.env.AUTOMATIONS_MAX_OVERLAP_SKIPS_24H || 0)
);
const MAX_STALE_CURSORS = Math.max(0, Number(process.env.AUTOMATIONS_MAX_STALE_CURSORS || 0));
const MAX_OPEN_ALERTS = Math.max(0, Number(process.env.AUTOMATIONS_MAX_OPEN_ALERTS || 0));
const MAX_OPEN_CONTROL_ALERTS = Math.max(
  0,
  Number(process.env.AUTOMATIONS_MAX_OPEN_CONTROL_ALERTS || MAX_OPEN_ALERTS)
);
const MAX_OPEN_RECOVERY_ALERTS = Math.max(
  0,
  Number(process.env.AUTOMATIONS_MAX_OPEN_RECOVERY_ALERTS || MAX_OPEN_ALERTS)
);
const MAX_OPEN_EXECUTION_ALERTS = Math.max(
  0,
  Number(process.env.AUTOMATIONS_MAX_OPEN_EXECUTION_ALERTS || MAX_OPEN_ALERTS)
);

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

function readString(value: unknown): string {
  return String(value || '').trim();
}

function readNumber(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

async function run(): Promise<void> {
  assert.ok(API_KEY, 'APP_API_KEY or API_KEY is required to poll /health/automations');

  const automationsHealthResponse = await requestJson('/health/automations');
  const opsHealthResponse = await requestJson('/health/ops');
  const health = asRecord(automationsHealthResponse.data);
  const ops = asRecord(opsHealthResponse.data);
  const opsConfig = asRecord(ops.config);

  const snapshot = {
    baseUrl: BASE_URL,
    status: readString(health.status || 'unknown'),
    workerStatus: readString(health.workerStatus || 'unknown'),
    queueStatus: readString(health.queueStatus || 'unknown'),
    failedRuns24h: readNumber(health.failedRuns24h),
    overlapSkips24h: readNumber(health.overlapSkips24h),
    staleCursorCount: readNumber(health.staleCursorCount),
    openAlerts: readNumber(health.openAlerts),
    openControlAlerts: readNumber(health.openControlAlerts),
    openRecoveryAlerts: readNumber(health.openRecoveryAlerts),
    openExecutionAlerts: readNumber(health.openExecutionAlerts),
    emitFailureAlerts: Boolean(opsConfig.emitFailureAlerts),
    detail: readString(health.detail) || null,
  };

  console.log('automations-health-check:', JSON.stringify(snapshot));

  if (snapshot.status.toLowerCase() === 'down') {
    throw new Error('automations health is down');
  }
  if (snapshot.queueStatus.toLowerCase() !== 'ok') {
    throw new Error(`automation queue status is ${snapshot.queueStatus || 'unknown'}`);
  }
  if (snapshot.workerStatus.toLowerCase() !== 'ok') {
    throw new Error(`automation worker status is ${snapshot.workerStatus || 'unknown'}`);
  }
  if (REQUIRE_FAILURE_ALERTS_ENABLED && snapshot.emitFailureAlerts !== true) {
    throw new Error('observability failure alerts are disabled');
  }
  if (snapshot.failedRuns24h > MAX_FAILED_RUNS_24H) {
    throw new Error(
      `failed runs in 24h ${snapshot.failedRuns24h} exceeds ${MAX_FAILED_RUNS_24H}`
    );
  }
  if (snapshot.overlapSkips24h > MAX_OVERLAP_SKIPS_24H) {
    throw new Error(
      `overlap skips in 24h ${snapshot.overlapSkips24h} exceeds ${MAX_OVERLAP_SKIPS_24H}`
    );
  }
  if (snapshot.staleCursorCount > MAX_STALE_CURSORS) {
    throw new Error(
      `stale cursor count ${snapshot.staleCursorCount} exceeds ${MAX_STALE_CURSORS}`
    );
  }
  if (snapshot.openAlerts > MAX_OPEN_ALERTS) {
    throw new Error(`open automation alerts ${snapshot.openAlerts} exceeds ${MAX_OPEN_ALERTS}`);
  }
  if (snapshot.openControlAlerts > MAX_OPEN_CONTROL_ALERTS) {
    throw new Error(
      `open control alerts ${snapshot.openControlAlerts} exceeds ${MAX_OPEN_CONTROL_ALERTS}`
    );
  }
  if (snapshot.openRecoveryAlerts > MAX_OPEN_RECOVERY_ALERTS) {
    throw new Error(
      `open recovery alerts ${snapshot.openRecoveryAlerts} exceeds ${MAX_OPEN_RECOVERY_ALERTS}`
    );
  }
  if (snapshot.openExecutionAlerts > MAX_OPEN_EXECUTION_ALERTS) {
    throw new Error(
      `open execution alerts ${snapshot.openExecutionAlerts} exceeds ${MAX_OPEN_EXECUTION_ALERTS}`
    );
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
