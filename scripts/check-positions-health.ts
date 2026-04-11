import assert from 'node:assert/strict';
import { env } from '../src/env';

type JsonRecord = Record<string, unknown>;

const resolvedHost = env.app.host === '0.0.0.0' ? '127.0.0.1' : env.app.host;
const BASE_URL =
  process.env.HEALTH_BASE_URL ||
  process.env.SMOKE_BASE_URL ||
  `http://${resolvedHost}:${env.app.port}${env.app.routePrefix}`;
const API_KEY = String(process.env.APP_API_KEY || process.env.API_KEY || '').trim();
const LOGIN_EMAIL = String(
  process.env.SMOKE_LOGIN_EMAIL || process.env.AUTH_SEED_EMAIL || env.auth.seedEmail
).trim();
const LOGIN_PASSWORD = String(
  process.env.SMOKE_LOGIN_PASSWORD || process.env.AUTH_SEED_PASSWORD || env.auth.seedPassword
).trim();
const MAX_ACTIVE_MS = Math.max(0, Number(process.env.POSITIONS_MAX_ACTIVE_MS || 1500));
const MAX_HISTORY_MS = Math.max(0, Number(process.env.POSITIONS_MAX_HISTORY_MS || 1500));
const MAX_LIFECYCLE_MS = Math.max(0, Number(process.env.POSITIONS_MAX_LIFECYCLE_MS || 1500));
const MAX_LIVE_SNAPSHOT_AGE_MS = Math.max(
  0,
  Number(process.env.POSITIONS_MAX_LIVE_SNAPSHOT_AGE_MS || 0)
);
const HISTORY_LIMIT = Math.max(1, Number(process.env.POSITIONS_HISTORY_LIMIT || 25));
const REQUIRE_LIFECYCLE_IF_OPEN =
  String(process.env.POSITIONS_REQUIRE_LIFECYCLE_IF_OPEN || 'true')
    .trim()
    .toLowerCase() !== 'false';

function asRecord(value: unknown): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as JsonRecord;
}

function readString(value: unknown): string {
  return String(value || '').trim();
}

function readNullableString(value: unknown): string | null {
  const normalized = readString(value);
  return normalized || null;
}

function readNumber(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function toIsoString(value: unknown): string | null {
  if (!value) {
    return null;
  }
  const normalized = String(value).trim();
  if (!normalized) {
    return null;
  }
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? normalized : parsed.toISOString();
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

function readFirstRow(items: unknown[]): JsonRecord | null {
  const first = items[0];
  return first && typeof first === 'object' && !Array.isArray(first)
    ? (first as JsonRecord)
    : null;
}

async function run(): Promise<void> {
  const accessToken = await loginIfPossible();
  assert.ok(
    accessToken || API_KEY,
    'Either APP_API_KEY/API_KEY or admin login credentials are required to poll /positions endpoints'
  );

  const activeStartedAt = Date.now();
  const activeResponse = await requestJson('/positions/futures/active', {}, accessToken);
  const activeDurationMs = Date.now() - activeStartedAt;

  const historyStartedAt = Date.now();
  const historyResponse = await requestJson(
    `/positions/futures/history/active?limit=${encodeURIComponent(String(HISTORY_LIMIT))}`,
    {},
    accessToken
  );
  const historyDurationMs = Date.now() - historyStartedAt;

  const activeData = asRecord(activeResponse.data);
  const historyData = asRecord(historyResponse.data);
  const activeItems = readArray(activeData.items);
  const historyItems = readArray(historyData.items);
  const firstActiveAccount = readFirstRow(activeItems);
  const firstActiveRow = readFirstRow(readArray(firstActiveAccount?.positions || firstActiveAccount?.data));
  const firstHistoryAccount = readFirstRow(historyItems);
  const firstHistoryRow = readFirstRow(readArray(firstHistoryAccount?.history || firstHistoryAccount?.data));
  const liveFreshness = asRecord(activeData.freshness);
  const latestSnapshotAt = toIsoString(liveFreshness.observedAt);
  const liveSnapshotAgeMs = latestSnapshotAt
    ? Math.max(0, Date.now() - new Date(latestSnapshotAt).getTime())
    : null;

  let lifecycleSummary: JsonRecord | null = null;
  let lifecycleDurationMs: number | null = null;
  if (firstActiveRow && REQUIRE_LIFECYCLE_IF_OPEN) {
    const positionId =
      readString(firstActiveRow.id) || readString(firstActiveRow.external_id);
    const brokerKey = readString(firstActiveRow.brokerKey || firstActiveRow.broker_key);
    const accountId = readString(firstActiveRow.accountId || firstActiveRow.account_id);
    const lifecycleStartedAt = Date.now();
    const lifecycleResponse = await requestJson(
      `/positions/futures/${encodeURIComponent(positionId)}/lifecycle?brokerKey=${encodeURIComponent(
        brokerKey
      )}&accountId=${encodeURIComponent(accountId)}`,
      {},
      accessToken
    );
    lifecycleDurationMs = Date.now() - lifecycleStartedAt;
    const lifecycle = asRecord(lifecycleResponse.data);
    const lifecycleFreshness = asRecord(lifecycle.freshness);
    const lifecyclePositionFreshness = asRecord(lifecycleFreshness.position);

    lifecycleSummary = {
      id: readString(asRecord(lifecycle.position).id),
      accountId: readString(asRecord(lifecycle.account).id),
      relatedOrders: readNumber(asRecord(lifecycle.summary).relatedOrders),
      relatedAlerts: readArray(lifecycle.relatedAlerts).length,
      relatedSuggestedTrades: readArray(lifecycle.relatedSuggestedTrades).length,
      recentActivity: readArray(lifecycle.recentActivity).length,
      positionFreshnessState: readString(lifecyclePositionFreshness.state) || null,
      positionFreshnessSource: readString(lifecyclePositionFreshness.source) || null,
      lifecycleWarning: readNullableString(lifecycleFreshness.warning),
    };

    assert.equal(
      lifecycleSummary.id,
      positionId,
      'lifecycle response must resolve the selected position id'
    );
    assert.equal(
      lifecycleSummary.accountId,
      accountId,
      'lifecycle response must stay on the selected broker route'
    );
    assert.equal(
      lifecycleSummary.positionFreshnessSource,
      'position_snapshot',
      'lifecycle freshness must stay snapshot-backed'
    );
  }

  const snapshot = {
    baseUrl: BASE_URL,
    activeDurationMs,
    historyDurationMs,
    lifecycleDurationMs,
    liveAccountCount: activeItems.length,
    historyAccountCount: historyItems.length,
    firstLiveRowId:
      readString(firstActiveRow?.id) || readString(firstActiveRow?.external_id) || null,
    firstHistoryRowId:
      readString(firstHistoryRow?.id) || readString(firstHistoryRow?.external_id) || null,
    liveFreshnessState: readString(liveFreshness.state) || null,
    liveFreshnessObservedAt: latestSnapshotAt,
    liveFreshnessWarning: readNullableString(liveFreshness.warning),
    liveFreshnessCounts: {
      fresh: readNumber(liveFreshness.freshAccounts),
      stale: readNumber(liveFreshness.staleAccounts),
      critical: readNumber(liveFreshness.criticalAccounts),
      unknown: readNumber(liveFreshness.unknownAccounts),
    },
    liveSnapshotAgeMs,
    lifecycleSummary,
  };

  console.log('positions-health-check:', JSON.stringify(snapshot));

  assert.ok(Array.isArray(activeItems), 'active positions response must expose grouped items');
  assert.ok(Array.isArray(historyItems), 'history response must expose grouped items');
  assert.ok(
    latestSnapshotAt || activeItems.length === 0,
    'live positions response must expose freshness metadata when active accounts are present'
  );

  if (MAX_ACTIVE_MS > 0 && activeDurationMs > MAX_ACTIVE_MS) {
    throw new Error(`positions active latency ${activeDurationMs}ms exceeds ${MAX_ACTIVE_MS}ms`);
  }

  if (MAX_HISTORY_MS > 0 && historyDurationMs > MAX_HISTORY_MS) {
    throw new Error(`positions history latency ${historyDurationMs}ms exceeds ${MAX_HISTORY_MS}ms`);
  }

  if (
    MAX_LIFECYCLE_MS > 0 &&
    lifecycleDurationMs !== null &&
    lifecycleDurationMs > MAX_LIFECYCLE_MS
  ) {
    throw new Error(
      `positions lifecycle latency ${lifecycleDurationMs}ms exceeds ${MAX_LIFECYCLE_MS}ms`
    );
  }

  if (
    MAX_LIVE_SNAPSHOT_AGE_MS > 0 &&
    liveSnapshotAgeMs !== null &&
    liveSnapshotAgeMs > MAX_LIVE_SNAPSHOT_AGE_MS
  ) {
    throw new Error(
      `positions live snapshot age ${liveSnapshotAgeMs}ms exceeds ${MAX_LIVE_SNAPSHOT_AGE_MS}ms`
    );
  }

  if (firstActiveRow) {
    const rowFreshness = asRecord(firstActiveRow.freshness);
    assert.equal(
      readString(rowFreshness.source),
      'position_snapshot',
      'live position rows must remain snapshot-backed'
    );
    assert.ok(
      readString(firstActiveRow.side),
      'live position rows must expose normalized side values'
    );
    assert.ok(
      readString(firstActiveRow.status),
      'live position rows must expose normalized status values'
    );
  }

  if (firstHistoryRow) {
    const rowFreshness = asRecord(firstHistoryRow.freshness);
    assert.equal(
      readString(rowFreshness.source),
      'position_archive',
      'history rows must expose archive freshness metadata'
    );
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
