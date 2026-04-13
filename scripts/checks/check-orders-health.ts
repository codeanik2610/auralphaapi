import assert from 'node:assert/strict';
import path from 'node:path';
import { env } from '../../src/env';

type JsonRecord = Record<string, unknown>;

export type OrdersSyncSnapshot = {
  state: string | null;
  label: string | null;
  summary: string | null;
  scope: string | null;
  totalAccounts: number;
  pendingRecords: number;
  failedRecords: number;
  latestSnapshotAt: string | null;
  items: number;
  refreshResponse: JsonRecord | null;
};

export type OrdersLiveDetailSummary = {
  id: string;
  source: string;
  brokerKey: string;
  accountId: string;
  snapshotLastSeenAt: string | null;
  detailSourceKind: string;
};

export type OrdersPaperDetailSummary = {
  id: string;
  source: string;
  lifecycleStage: string | null;
  lifecycleTerminal: boolean;
  lastTransitionType: string | null;
  detailSourceKind: string;
  executionHistoryCount: number;
};

export type OrdersHealthSnapshot = {
  baseUrl: string;
  contractVersion: string | null;
  purpose: string | null;
  embeddedSyncStatus: boolean;
  overviewDurationMs: number;
  paperDurationMs: number;
  productSyncDurationMs: number | null;
  productRefreshDurationMs: number | null;
  openRows: number;
  historyRows: number;
  paperRows: number;
  openRowModel: string | null;
  historyRowModel: string | null;
  latestOpenSnapshotAt: string | null;
  openSnapshotAgeMs: number | null;
  overviewSyncStatusState: string | null;
  overviewSyncStatusSummary: string | null;
  overviewSyncStatusItems: number;
  overviewSyncStatusScope: string | null;
  detailDrawerSource: string | null;
  liveWriteFlow: string | null;
  paperWriteFlow: string | null;
  canonicalDetailFetchUsedByPage: boolean;
  localPaperWriteReconciliationUsedByPage: boolean;
  targetedLiveSyncPollingUsedByPage: boolean;
  firstOpenOrderId: string | null;
  firstPaperOrderId: string | null;
  productSyncSnapshot: OrdersSyncSnapshot | null;
  liveDetailSummary: OrdersLiveDetailSummary | null;
  paperDetailSummary: OrdersPaperDetailSummary | null;
};

export type OrdersHealthAssertionOptions = {
  maxOverviewMs?: number;
  maxPaperMs?: number;
  maxSyncStatusMs?: number;
  maxRefreshMs?: number;
  maxOpenSnapshotAgeMs?: number;
  requireNormalizedOverview?: boolean;
  requirePhase5WriteFlows?: boolean;
  requireDetailConsistencyIfOpen?: boolean;
  requirePaperLifecycleIfPresent?: boolean;
  requireProductSyncChecks?: boolean;
};

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
const MAX_OVERVIEW_MS = Math.max(0, Number(process.env.ORDERS_MAX_OVERVIEW_MS || 1500));
const MAX_PAPER_MS = Math.max(0, Number(process.env.ORDERS_MAX_PAPER_MS || 1500));
const MAX_SYNC_STATUS_MS = Math.max(
  0,
  Number(process.env.ORDERS_MAX_SYNC_STATUS_MS || 1500)
);
const MAX_REFRESH_MS = Math.max(0, Number(process.env.ORDERS_MAX_REFRESH_MS || 1500));
const MAX_OPEN_SNAPSHOT_AGE_MS = Math.max(
  0,
  Number(process.env.ORDERS_MAX_OPEN_SNAPSHOT_AGE_MS || 0)
);
const RUN_PRODUCT_SYNC_CHECKS =
  String(process.env.ORDERS_RUN_PRODUCT_SYNC_CHECKS || 'true')
    .trim()
    .toLowerCase() !== 'false';
const TRIGGER_PRODUCT_REFRESH =
  String(process.env.ORDERS_TRIGGER_PRODUCT_REFRESH || 'false')
    .trim()
    .toLowerCase() === 'true';
const PAPER_LIMIT = Math.max(1, Number(process.env.ORDERS_HEALTH_PAPER_LIMIT || 10));
const REQUIRE_NORMALIZED_OVERVIEW =
  String(process.env.ORDERS_REQUIRE_NORMALIZED_OVERVIEW || 'true')
    .trim()
    .toLowerCase() !== 'false';
const REQUIRE_PHASE5_WRITE_FLOWS =
  String(process.env.ORDERS_REQUIRE_PHASE5_WRITE_FLOWS || 'true')
    .trim()
    .toLowerCase() !== 'false';
const REQUIRE_DETAIL_CONSISTENCY_IF_OPEN =
  String(process.env.ORDERS_REQUIRE_DETAIL_CONSISTENCY_IF_OPEN || 'true')
    .trim()
    .toLowerCase() !== 'false';
const REQUIRE_PAPER_LIFECYCLE_IF_PRESENT =
  String(process.env.ORDERS_REQUIRE_PAPER_LIFECYCLE_IF_PRESENT || 'true')
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

function readFirstItem(items: unknown[]): JsonRecord | null {
  const first = items[0];
  return first && typeof first === 'object' && !Array.isArray(first)
    ? (first as JsonRecord)
    : null;
}

function unwrapRecordData(payload: unknown): JsonRecord {
  const record = asRecord(payload);
  if ('data' in record) {
    return asRecord(record.data);
  }
  return record;
}

function unwrapPaperItems(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  const record = asRecord(payload);
  if (Array.isArray(record.data)) {
    return record.data;
  }

  return [];
}

async function requestJson(
  targetPath: string,
  init: RequestInit = {},
  accessToken = ''
): Promise<JsonRecord> {
  const headers = new Headers(init.headers || {});

  if (accessToken) {
    headers.set('authorization', `Bearer ${accessToken}`);
  } else if (API_KEY) {
    headers.set('x-api-key', API_KEY);
  }

  const response = await fetch(`${BASE_URL}${targetPath}`, {
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
    throw new Error(`${targetPath} -> HTTP ${response.status}: ${JSON.stringify(payload)}`);
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

async function timedRequest(
  targetPath: string,
  accessToken: string,
  init: RequestInit = {}
): Promise<{ payload: JsonRecord; durationMs: number }> {
  const startedAt = Date.now();
  const payload = await requestJson(targetPath, init, accessToken);
  return {
    payload,
    durationMs: Date.now() - startedAt,
  };
}

export function buildOrdersHealthSnapshot(input: {
  baseUrl: string;
  overviewDurationMs: number;
  paperDurationMs: number;
  overviewPayload: JsonRecord;
  paperPayload: JsonRecord | unknown[];
  productSyncDurationMs?: number | null;
  productRefreshDurationMs?: number | null;
  productSyncPayload?: JsonRecord | null;
  productRefreshPayload?: JsonRecord | null;
  liveDetailPayload?: JsonRecord | null;
  paperDetailPayload?: JsonRecord | null;
  nowMs?: number;
}): OrdersHealthSnapshot {
  const nowMs = input.nowMs ?? Date.now();
  const overviewData = unwrapRecordData(input.overviewPayload);
  const meta = asRecord(overviewData.meta);
  const pageTruth = asRecord(meta.pageTruth);
  const capabilities = asRecord(meta.capabilities);
  const overviewSyncStatus = asRecord(overviewData.syncStatus);
  const openOrders = asRecord(overviewData.openOrders);
  const history = asRecord(overviewData.history);
  const openItems = readArray(openOrders.items);
  const historyItems = readArray(history.items);
  const paperItems = unwrapPaperItems(input.paperPayload);
  const firstOpenOrder = readFirstItem(openItems);
  const firstPaperOrder = readFirstItem(paperItems);
  const firstOpenOrderId =
    readNullableString(firstOpenOrder?.id) || readNullableString(firstOpenOrder?.order_id);
  const firstPaperOrderId =
    readNullableString(firstPaperOrder?.id) || readNullableString(firstPaperOrder?.order_id);
  const latestOpenSnapshotAt = toIsoString(openOrders.latestSnapshotAt);
  const openSnapshotAgeMs = latestOpenSnapshotAt
    ? Math.max(0, nowMs - new Date(latestOpenSnapshotAt).getTime())
    : null;

  const productSyncData = input.productSyncPayload
    ? unwrapRecordData(input.productSyncPayload)
    : null;
  const productRefreshData = input.productRefreshPayload
    ? unwrapRecordData(input.productRefreshPayload)
    : null;
  const liveDetail = input.liveDetailPayload ? unwrapRecordData(input.liveDetailPayload) : null;
  const paperDetail = input.paperDetailPayload
    ? unwrapRecordData(input.paperDetailPayload)
    : null;

  const productSyncSnapshot = productSyncData
    ? {
        state: readNullableString(productSyncData.state),
        label: readNullableString(productSyncData.label),
        summary: readNullableString(productSyncData.summary),
        scope: readNullableString(productSyncData.scope),
        totalAccounts: readNumber(productSyncData.totalAccounts),
        pendingRecords: readNumber(productSyncData.pendingRecords),
        failedRecords: readNumber(productSyncData.failedRecords),
        latestSnapshotAt: readNullableString(productSyncData.latestSnapshotAt),
        items: readArray(productSyncData.items).length,
        refreshResponse: productRefreshData,
      }
    : null;

  const liveDetailSummary = liveDetail
    ? {
        id: readString(liveDetail.id || liveDetail.order_id),
        source: readString(liveDetail.source),
        brokerKey: readString(liveDetail.brokerKey || liveDetail.broker_key),
        accountId: readString(liveDetail.accountId || liveDetail.account_id),
        snapshotLastSeenAt: readNullableString(
          asRecord(liveDetail.snapshot).lastSeenAt || liveDetail.last_seen_at
        ),
        detailSourceKind: readString(asRecord(liveDetail.detailMeta).sourceKind),
      }
    : null;

  const lifecycle = asRecord(paperDetail?.lifecycle);
  const paperDetailMeta = asRecord(paperDetail?.detailMeta);
  const paperExecutionHistory = readArray(paperDetail?.execution_history);
  const paperDetailSummary = paperDetail
    ? {
        id: readString(paperDetail.id || paperDetail.order_id),
        source: readString(paperDetail.source),
        lifecycleStage:
          readNullableString(paperDetail.lifecycle_stage) ||
          readNullableString(lifecycle.stage),
        lifecycleTerminal:
          paperDetail.lifecycle_terminal === true || lifecycle.terminal === true,
        lastTransitionType:
          readNullableString(paperDetail.lifecycle_last_transition_type) ||
          readNullableString(asRecord(lifecycle.lastTransition).type),
        detailSourceKind: readString(paperDetailMeta.sourceKind),
        executionHistoryCount: paperExecutionHistory.length,
      }
    : null;

  return {
    baseUrl: input.baseUrl,
    contractVersion: readString(meta.contractVersion) || null,
    purpose: readString(meta.purpose) || null,
    embeddedSyncStatus: capabilities.embeddedSyncStatus === true,
    overviewDurationMs: input.overviewDurationMs,
    paperDurationMs: input.paperDurationMs,
    productSyncDurationMs: input.productSyncDurationMs ?? null,
    productRefreshDurationMs: input.productRefreshDurationMs ?? null,
    openRows: openItems.length,
    historyRows: historyItems.length,
    paperRows: paperItems.length,
    openRowModel: readString(openOrders.rowModel) || null,
    historyRowModel: readString(history.rowModel) || null,
    latestOpenSnapshotAt,
    openSnapshotAgeMs,
    overviewSyncStatusState: readNullableString(overviewSyncStatus.state),
    overviewSyncStatusSummary: readNullableString(overviewSyncStatus.summary),
    overviewSyncStatusItems: readArray(overviewSyncStatus.items).length,
    overviewSyncStatusScope: readNullableString(overviewSyncStatus.scope),
    detailDrawerSource: readString(pageTruth.detailDrawerSource) || null,
    liveWriteFlow: readString(pageTruth.liveWriteFlow) || null,
    paperWriteFlow: readString(pageTruth.paperWriteFlow) || null,
    canonicalDetailFetchUsedByPage:
      capabilities.canonicalDetailFetchUsedByPage === true,
    localPaperWriteReconciliationUsedByPage:
      capabilities.localPaperWriteReconciliationUsedByPage === true,
    targetedLiveSyncPollingUsedByPage:
      capabilities.targetedLiveSyncPollingUsedByPage === true,
    firstOpenOrderId,
    firstPaperOrderId,
    productSyncSnapshot,
    liveDetailSummary,
    paperDetailSummary,
  };
}

export function assertOrdersHealthSnapshot(
  snapshot: OrdersHealthSnapshot,
  options: OrdersHealthAssertionOptions = {}
): void {
  const maxOverviewMs = Math.max(0, options.maxOverviewMs ?? MAX_OVERVIEW_MS);
  const maxPaperMs = Math.max(0, options.maxPaperMs ?? MAX_PAPER_MS);
  const maxSyncStatusMs = Math.max(0, options.maxSyncStatusMs ?? MAX_SYNC_STATUS_MS);
  const maxRefreshMs = Math.max(0, options.maxRefreshMs ?? MAX_REFRESH_MS);
  const maxOpenSnapshotAgeMs = Math.max(
    0,
    options.maxOpenSnapshotAgeMs ?? MAX_OPEN_SNAPSHOT_AGE_MS
  );
  const requireNormalizedOverview =
    options.requireNormalizedOverview ?? REQUIRE_NORMALIZED_OVERVIEW;
  const requirePhase5WriteFlows =
    options.requirePhase5WriteFlows ?? REQUIRE_PHASE5_WRITE_FLOWS;
  const requireDetailConsistencyIfOpen =
    options.requireDetailConsistencyIfOpen ?? REQUIRE_DETAIL_CONSISTENCY_IF_OPEN;
  const requirePaperLifecycleIfPresent =
    options.requirePaperLifecycleIfPresent ?? REQUIRE_PAPER_LIFECYCLE_IF_PRESENT;
  const requireProductSyncChecks =
    options.requireProductSyncChecks ?? RUN_PRODUCT_SYNC_CHECKS;

  assert.equal(
    snapshot.purpose,
    'global_execution_console',
    'orders overview purpose must remain global_execution_console'
  );
  assert.equal(
    snapshot.embeddedSyncStatus,
    true,
    'orders overview must advertise embedded sync status'
  );
  assert.ok(
    snapshot.overviewSyncStatusState,
    'orders overview must embed syncStatus.state'
  );
  assert.ok(
    Number.isInteger(snapshot.overviewSyncStatusItems),
    'orders overview must embed syncStatus.items as an array-backed count'
  );

  if (requireNormalizedOverview) {
    assert.equal(
      snapshot.openRowModel,
      'normalized_live_snapshot',
      'open orders must use normalized live snapshot rows'
    );
    assert.equal(
      snapshot.historyRowModel,
      'normalized_live_snapshot',
      'history must use normalized live snapshot rows'
    );
  }

  if (requirePhase5WriteFlows) {
    assert.equal(
      snapshot.detailDrawerSource,
      'canonical_detail_fetch_with_row_fallback',
      'orders page truth must advertise canonical detail fetches with row fallback'
    );
    assert.equal(
      snapshot.liveWriteFlow,
      'broker_write_with_snapshot_ack_polling',
      'orders page truth must advertise snapshot-ack polling for live writes'
    );
    assert.equal(
      snapshot.paperWriteFlow,
      'db_write_with_local_reconciliation',
      'orders page truth must advertise local paper reconciliation'
    );
    assert.equal(
      snapshot.canonicalDetailFetchUsedByPage,
      true,
      'orders capabilities must advertise canonical detail fetch usage'
    );
    assert.equal(
      snapshot.localPaperWriteReconciliationUsedByPage,
      true,
      'orders capabilities must advertise local paper reconciliation'
    );
    assert.equal(
      snapshot.targetedLiveSyncPollingUsedByPage,
      true,
      'orders capabilities must advertise live snapshot polling'
    );
  }

  if (requireProductSyncChecks) {
    assert.ok(
      snapshot.productSyncSnapshot,
      'orders sync status must be captured when product sync checks are enabled'
    );
    assert.ok(
      snapshot.productSyncSnapshot?.state,
      'orders sync status must expose a state'
    );
    assert.ok(
      Number.isInteger(snapshot.productSyncSnapshot?.items),
      'orders sync status must expose grouped route items'
    );
  }

  const refreshResponse = snapshot.productSyncSnapshot?.refreshResponse;
  if (refreshResponse) {
    assert.equal(
      typeof asRecord(refreshResponse).requested,
      'boolean',
      'orders refresh should return an explicit requested flag'
    );
  }

  if (maxOverviewMs > 0 && snapshot.overviewDurationMs > maxOverviewMs) {
    throw new Error(`orders overview latency ${snapshot.overviewDurationMs}ms exceeds ${maxOverviewMs}ms`);
  }

  if (maxPaperMs > 0 && snapshot.paperDurationMs > maxPaperMs) {
    throw new Error(`orders paper latency ${snapshot.paperDurationMs}ms exceeds ${maxPaperMs}ms`);
  }

  if (
    maxSyncStatusMs > 0 &&
    snapshot.productSyncDurationMs !== null &&
    snapshot.productSyncDurationMs > maxSyncStatusMs
  ) {
    throw new Error(
      `orders sync-status latency ${snapshot.productSyncDurationMs}ms exceeds ${maxSyncStatusMs}ms`
    );
  }

  if (
    maxRefreshMs > 0 &&
    snapshot.productRefreshDurationMs !== null &&
    snapshot.productRefreshDurationMs > maxRefreshMs
  ) {
    throw new Error(
      `orders refresh latency ${snapshot.productRefreshDurationMs}ms exceeds ${maxRefreshMs}ms`
    );
  }

  if (
    maxOpenSnapshotAgeMs > 0 &&
    snapshot.openSnapshotAgeMs !== null &&
    snapshot.openSnapshotAgeMs > maxOpenSnapshotAgeMs
  ) {
    throw new Error(
      `orders open snapshot age ${snapshot.openSnapshotAgeMs}ms exceeds ${maxOpenSnapshotAgeMs}ms`
    );
  }

  if (snapshot.firstOpenOrderId && requireDetailConsistencyIfOpen) {
    assert.equal(
      snapshot.liveDetailSummary?.id,
      snapshot.firstOpenOrderId,
      'live detail id must match the open order row'
    );
    assert.equal(
      snapshot.liveDetailSummary?.source,
      'scheduler_orders_snapshots',
      'live detail must remain snapshot-backed'
    );
    assert.equal(
      snapshot.liveDetailSummary?.detailSourceKind,
      'snapshot_backed_live',
      'live detail metadata must stay snapshot-backed'
    );
  }

  if (snapshot.firstPaperOrderId && requirePaperLifecycleIfPresent) {
    assert.equal(
      snapshot.paperDetailSummary?.source,
      'paper_orders',
      'paper detail must stay DB-backed'
    );
    assert.equal(
      snapshot.paperDetailSummary?.detailSourceKind,
      'paper_simulation',
      'paper detail metadata must stay simulation-backed'
    );
    assert.ok(
      snapshot.paperDetailSummary?.lifecycleStage,
      'paper detail must expose a lifecycle stage'
    );
    assert.ok(
      readNumber(snapshot.paperDetailSummary?.executionHistoryCount) >= 1,
      'paper detail must expose execution history entries'
    );
  }
}

async function run(): Promise<void> {
  const accessToken = await loginIfPossible();
  assert.ok(
    accessToken || API_KEY,
    'Either APP_API_KEY/API_KEY or admin login credentials are required to poll /orders endpoints'
  );

  const [overviewResponse, paperResponse] = await Promise.all([
    timedRequest('/orders/overview', accessToken),
    timedRequest(
      `/orders/paper?limit=${encodeURIComponent(String(PAPER_LIMIT))}`,
      accessToken
    ),
  ]);

  const overviewData = unwrapRecordData(overviewResponse.payload);
  const openOrders = asRecord(overviewData.openOrders);
  const openItems = readArray(openOrders.items);
  const paperItems = unwrapPaperItems(paperResponse.payload);
  const firstOpenOrder = readFirstItem(openItems);
  const firstPaperOrder = readFirstItem(paperItems);

  let productSyncDurationMs: number | null = null;
  let productRefreshDurationMs: number | null = null;
  let productSyncPayload: JsonRecord | null = null;
  let productRefreshPayload: JsonRecord | null = null;

  if (RUN_PRODUCT_SYNC_CHECKS) {
    const syncStatusResponse = await timedRequest('/orders/futures/sync-status', accessToken);
    productSyncDurationMs = syncStatusResponse.durationMs;
    productSyncPayload = syncStatusResponse.payload;

    if (TRIGGER_PRODUCT_REFRESH) {
      const refreshResponse = await timedRequest(
        '/orders/futures/refresh',
        accessToken,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({}),
        }
      );
      productRefreshDurationMs = refreshResponse.durationMs;
      productRefreshPayload = refreshResponse.payload;
    }
  }

  let liveDetailPayload: JsonRecord | null = null;
  if (firstOpenOrder && REQUIRE_DETAIL_CONSISTENCY_IF_OPEN) {
    const orderId =
      readString(firstOpenOrder.id) || readString(firstOpenOrder.order_id);
    const brokerKey = readString(firstOpenOrder.brokerKey || firstOpenOrder.broker_key);
    const accountId = readString(firstOpenOrder.accountId || firstOpenOrder.account_id);
    liveDetailPayload = await requestJson(
      `/orders/futures/detail/${encodeURIComponent(orderId)}?brokerKey=${encodeURIComponent(
        brokerKey
      )}&accountId=${encodeURIComponent(accountId)}`,
      {},
      accessToken
    );
  }

  let paperDetailPayload: JsonRecord | null = null;
  if (firstPaperOrder && REQUIRE_PAPER_LIFECYCLE_IF_PRESENT) {
    const paperOrderId =
      readString(firstPaperOrder.id) || readString(firstPaperOrder.order_id);
    paperDetailPayload = await requestJson(
      `/orders/paper/${encodeURIComponent(paperOrderId)}`,
      {},
      accessToken
    );
  }

  const snapshot = buildOrdersHealthSnapshot({
    baseUrl: BASE_URL,
    overviewDurationMs: overviewResponse.durationMs,
    paperDurationMs: paperResponse.durationMs,
    overviewPayload: overviewResponse.payload,
    paperPayload: paperResponse.payload,
    productSyncDurationMs,
    productRefreshDurationMs,
    productSyncPayload,
    productRefreshPayload,
    liveDetailPayload,
    paperDetailPayload,
  });

  console.log('orders-health-check:', JSON.stringify(snapshot));
  assertOrdersHealthSnapshot(snapshot, {
    maxOverviewMs: MAX_OVERVIEW_MS,
    maxPaperMs: MAX_PAPER_MS,
    maxSyncStatusMs: MAX_SYNC_STATUS_MS,
    maxRefreshMs: MAX_REFRESH_MS,
    maxOpenSnapshotAgeMs: MAX_OPEN_SNAPSHOT_AGE_MS,
    requireNormalizedOverview: REQUIRE_NORMALIZED_OVERVIEW,
    requirePhase5WriteFlows: REQUIRE_PHASE5_WRITE_FLOWS,
    requireDetailConsistencyIfOpen: REQUIRE_DETAIL_CONSISTENCY_IF_OPEN,
    requirePaperLifecycleIfPresent: REQUIRE_PAPER_LIFECYCLE_IF_PRESENT,
    requireProductSyncChecks: RUN_PRODUCT_SYNC_CHECKS,
  });
}

const isDirectRun = (() => {
  const executedFile = String(process.argv[1] || '');
  if (!executedFile) {
    return false;
  }

  return (
    executedFile.endsWith(path.join('scripts', 'checks', 'check-orders-health.ts')) ||
    executedFile.endsWith(path.join('scripts', 'checks', 'check-orders-health.js'))
  );
})();

if (isDirectRun) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
