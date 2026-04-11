import assert from 'node:assert/strict';

import { env } from '../src/env';

type JsonRecord = Record<string, unknown>;

const ORDERS_RUNTIME_SCHEMA_MIGRATION =
  '1770706000000-CreateOrdersSchedulerRuntimeTables';
const resolvedHost = env.app.host === '0.0.0.0' ? '127.0.0.1' : env.app.host;
const BASE_URL =
  process.env.HEALTH_BASE_URL ||
  process.env.SMOKE_BASE_URL ||
  `http://${resolvedHost}:${env.app.port}${env.app.routePrefix}`;
const ADMIN_EMAIL = String(
  process.env.ORDERS_SCHEDULER_ADMIN_EMAIL ||
    process.env.SMOKE_LOGIN_EMAIL ||
    process.env.AUTH_SEED_EMAIL ||
    env.auth.seedEmail
).trim();
const ADMIN_PASSWORD = String(
  process.env.ORDERS_SCHEDULER_ADMIN_PASSWORD ||
    process.env.SMOKE_LOGIN_PASSWORD ||
    process.env.AUTH_SEED_PASSWORD ||
    env.auth.seedPassword
).trim();
const USER_EMAIL = String(
  process.env.ORDERS_SCHEDULER_USER_EMAIL || ADMIN_EMAIL
).trim();
const USER_PASSWORD = String(
  process.env.ORDERS_SCHEDULER_USER_PASSWORD || ADMIN_PASSWORD
).trim();
const RUN_PRODUCT_DESK_CHECKS =
  String(process.env.ORDERS_SCHEDULER_RUN_PRODUCT_DESK_CHECKS || 'true')
    .trim()
    .toLowerCase() !== 'false';
const TRIGGER_PRODUCT_REFRESH =
  String(process.env.ORDERS_SCHEDULER_TRIGGER_PRODUCT_REFRESH || 'false')
    .trim()
    .toLowerCase() === 'true';
const VERIFY_OWNER_FILTER =
  String(process.env.ORDERS_SCHEDULER_VERIFY_OWNER_FILTER || 'true')
    .trim()
    .toLowerCase() !== 'false';
const MAX_CONFIG_MS = Math.max(
  0,
  Number(process.env.ORDERS_SCHEDULER_MAX_CONFIG_MS || 1500)
);
const MAX_SYNC_SUMMARY_MS = Math.max(
  0,
  Number(process.env.ORDERS_SCHEDULER_MAX_SYNC_SUMMARY_MS || 1500)
);
const MAX_SYNC_STATE_MS = Math.max(
  0,
  Number(process.env.ORDERS_SCHEDULER_MAX_SYNC_STATE_MS || 1500)
);
const MAX_RUNS_MS = Math.max(0, Number(process.env.ORDERS_SCHEDULER_MAX_RUNS_MS || 1500));
const MAX_QUEUE_MS = Math.max(0, Number(process.env.ORDERS_SCHEDULER_MAX_QUEUE_MS || 1500));
const MAX_WORKER_MS = Math.max(0, Number(process.env.ORDERS_SCHEDULER_MAX_WORKER_MS || 1500));
const MAX_PRODUCT_SYNC_STATUS_MS = Math.max(
  0,
  Number(process.env.ORDERS_SCHEDULER_MAX_PRODUCT_SYNC_STATUS_MS || 1500)
);
const MAX_PRODUCT_OVERVIEW_MS = Math.max(
  0,
  Number(process.env.ORDERS_SCHEDULER_MAX_PRODUCT_OVERVIEW_MS || 1500)
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
  const normalized = readString(value);
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

async function login(email: string, password: string): Promise<string> {
  assert.ok(email && password, 'orders scheduler health checks require admin credentials');

  const response = await requestJson('/auth/login', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      email,
      password,
    }),
  });
  const accessToken = readString(asRecord(response.data).accessToken);
  assert.ok(accessToken, `login should return an access token for ${email}`);
  return accessToken;
}

function assertMaxDuration(label: string, durationMs: number, maxMs: number): void {
  if (maxMs > 0 && durationMs > maxMs) {
    throw new Error(`${label} latency ${durationMs}ms exceeds ${maxMs}ms`);
  }
}

async function run(): Promise<void> {
  const adminToken = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  const adminMe = await requestJson('/auth/me', {}, adminToken);
  assert.equal(
    readString(asRecord(adminMe.data).role).toLowerCase(),
    'admin',
    'orders scheduler health checks require an admin login'
  );

  const configStartedAt = Date.now();
  const configResponse = await requestJson('/scheduler/orders/config', {}, adminToken);
  const configDurationMs = Date.now() - configStartedAt;
  const configData = asRecord(configResponse.data);
  const configSources = readArray(configData.sources).map(readString).filter(Boolean);
  const ordersPolicy = asRecord(configData.ordersPolicy);
  assert.equal(readString(configData.key), 'orders-sync');
  assert.equal(readString(configData.schedulerType), 'global');
  assert.deepEqual(configSources, ['orders']);
  assert.equal(readNumber(ordersPolicy.maxLookbackDays), 90);
  assert.equal(
    readString(ordersPolicy.replayMode),
    'checkpoint_reset_then_scoped_run'
  );

  const summaryStartedAt = Date.now();
  const summaryResponse = await requestJson(
    '/scheduler/orders/sync-state/summary',
    {},
    adminToken
  );
  const summaryDurationMs = Date.now() - summaryStartedAt;
  const summaryData = asRecord(summaryResponse.data);
  const runtimeFoundation = asRecord(summaryData.runtimeFoundation);
  assert.equal(readString(summaryData.schedulerKey), 'orders-sync');
  assert.ok(
    'accountsWithCheckpoint' in summaryData,
    'orders scheduler summary must expose checkpoint coverage counters'
  );
  assert.ok(
    'accountsWithPending' in summaryData,
    'orders scheduler summary must expose retry backlog counters'
  );
  assert.equal(
    readString(runtimeFoundation.status),
    'ready',
    'orders scheduler summary must report a ready runtime foundation before promotion'
  );
  assert.equal(
    readString(runtimeFoundation.migrationName),
    ORDERS_RUNTIME_SCHEMA_MIGRATION,
    'orders scheduler summary must advertise the Phase 5 migration foundation'
  );
  assert.ok(
    readArray(runtimeFoundation.requiredTables).map(readString).includes('scheduler_orders_snapshots'),
    'orders scheduler summary must expose the required snapshot table'
  );

  const stateStartedAt = Date.now();
  const stateResponse = await requestJson(
    '/scheduler/orders/sync-state?limit=25&offset=0',
    {},
    adminToken
  );
  const stateDurationMs = Date.now() - stateStartedAt;
  const stateData = asRecord(stateResponse.data);
  const stateItems = readArray(stateData.items).map(asRecord);
  const firstStateItem = asRecord(stateItems[0]);
  assert.ok(Array.isArray(stateItems), 'orders scheduler sync-state must return an items array');
  if (stateItems.length > 0) {
    assert.ok(
      'ownerUserId' in firstStateItem,
      'orders scheduler sync-state items must expose ownerUserId'
    );
    assert.ok(
      'pendingRecords' in firstStateItem,
      'orders scheduler sync-state items must expose retry backlog counts'
    );
  }

  let ownerScopedCount: number | null = null;
  const firstOwnerUserId = readString(firstStateItem.ownerUserId);
  if (VERIFY_OWNER_FILTER && firstOwnerUserId) {
    const ownerScopedResponse = await requestJson(
      `/scheduler/orders/sync-state?limit=25&offset=0&ownerUserId=${encodeURIComponent(firstOwnerUserId)}`,
      {},
      adminToken
    );
    const ownerScopedItems = readArray(asRecord(ownerScopedResponse.data).items).map(asRecord);
    ownerScopedCount = ownerScopedItems.length;
    assert.ok(
      ownerScopedItems.every((item) => readString(item.ownerUserId) === firstOwnerUserId),
      'ownerUserId filter should keep orders sync-state diagnostics on the selected owner only'
    );
  }

  const runsStartedAt = Date.now();
  const runsResponse = await requestJson('/scheduler/orders/runs?limit=5&offset=0', {}, adminToken);
  const runsDurationMs = Date.now() - runsStartedAt;
  const runsData = asRecord(runsResponse.data);
  const runItems = readArray(runsData.items).map(asRecord);
  assert.ok(Array.isArray(runItems), 'orders scheduler runs must return an items array');

  const queueStartedAt = Date.now();
  const queueResponse = await requestJson('/health/queue', {}, adminToken);
  const queueDurationMs = Date.now() - queueStartedAt;
  const queueData = asRecord(queueResponse.data);

  const workerStartedAt = Date.now();
  const workerResponse = await requestJson('/health/worker', {}, adminToken);
  const workerDurationMs = Date.now() - workerStartedAt;
  const workerData = asRecord(workerResponse.data);

  let productSnapshot: JsonRecord | null = null;
  if (RUN_PRODUCT_DESK_CHECKS) {
    const userToken =
      USER_EMAIL === ADMIN_EMAIL && USER_PASSWORD === ADMIN_PASSWORD
        ? adminToken
        : await login(USER_EMAIL, USER_PASSWORD);

    const productSyncStartedAt = Date.now();
    const productSyncResponse = await requestJson('/orders/futures/sync-status', {}, userToken);
    const productSyncDurationMs = Date.now() - productSyncStartedAt;
    const productSyncData = asRecord(productSyncResponse.data);
    assert.ok(
      Array.isArray(productSyncData.items),
      'orders sync status must return grouped route items'
    );

    const overviewStartedAt = Date.now();
    const overviewResponse = await requestJson('/orders/overview', {}, userToken);
    const overviewDurationMs = Date.now() - overviewStartedAt;
    const overviewData = asRecord(overviewResponse.data);
    const overviewMeta = asRecord(overviewData.meta);
    const overviewCapabilities = asRecord(overviewMeta.capabilities);
    const overviewSyncStatus = asRecord(overviewData.syncStatus);
    const openOrders = asRecord(overviewData.openOrders);

    assert.equal(
      overviewCapabilities.embeddedSyncStatus === true,
      true,
      'orders overview must advertise embedded sync status in scheduler health checks'
    );
    assert.ok(
      Array.isArray(overviewSyncStatus.items),
      'orders overview must embed syncStatus items as an array'
    );
    assert.ok(
      Array.isArray(openOrders.items),
      'orders overview must return grouped open order rows'
    );

    let refreshResponseData: JsonRecord | null = null;
    let refreshDurationMs: number | null = null;
    if (TRIGGER_PRODUCT_REFRESH) {
      const refreshStartedAt = Date.now();
      const refreshResponse = await requestJson(
        '/orders/futures/refresh',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({}),
        },
        userToken
      );
      refreshDurationMs = Date.now() - refreshStartedAt;
      refreshResponseData = asRecord(refreshResponse.data);
      assert.equal(
        typeof refreshResponseData.requested,
        'boolean',
        'orders refresh should return an explicit requested flag'
      );
    }

    productSnapshot = {
      syncStatusState: readNullableString(productSyncData.state),
      syncStatusSummary: readNullableString(productSyncData.summary),
      syncStatusItems: readArray(productSyncData.items).length,
      overviewSyncStatusState: readNullableString(overviewSyncStatus.state),
      overviewSyncStatusSummary: readNullableString(overviewSyncStatus.summary),
      overviewSyncStatusItems: readArray(overviewSyncStatus.items).length,
      overviewOpenRows: readArray(openOrders.items).length,
      overviewContractVersion: readNullableString(overviewMeta.contractVersion),
      refreshResponse: refreshResponseData,
      productSyncDurationMs,
      overviewDurationMs,
      refreshDurationMs,
    };

    assertMaxDuration(
      'orders product sync-status',
      productSyncDurationMs,
      MAX_PRODUCT_SYNC_STATUS_MS
    );
    assertMaxDuration(
      'orders product overview',
      overviewDurationMs,
      MAX_PRODUCT_OVERVIEW_MS
    );
  }

  assertMaxDuration('orders scheduler config', configDurationMs, MAX_CONFIG_MS);
  assertMaxDuration(
    'orders scheduler sync-state summary',
    summaryDurationMs,
    MAX_SYNC_SUMMARY_MS
  );
  assertMaxDuration(
    'orders scheduler sync-state list',
    stateDurationMs,
    MAX_SYNC_STATE_MS
  );
  assertMaxDuration('orders scheduler runs', runsDurationMs, MAX_RUNS_MS);
  assertMaxDuration('scheduler queue health', queueDurationMs, MAX_QUEUE_MS);
  assertMaxDuration('scheduler worker health', workerDurationMs, MAX_WORKER_MS);

  console.log(
    'orders-scheduler-health:',
    JSON.stringify({
      baseUrl: BASE_URL,
      configDurationMs,
      summaryDurationMs,
      stateDurationMs,
      runsDurationMs,
      queueDurationMs,
      workerDurationMs,
      runtimeFoundation: {
        status: readNullableString(runtimeFoundation.status),
        migrationName: readNullableString(runtimeFoundation.migrationName),
        requiredTables: readArray(runtimeFoundation.requiredTables).map(readString),
        requiredColumns: readArray(runtimeFoundation.requiredColumns).map(readString),
        missingParts: readArray(runtimeFoundation.missingParts).map(readString),
      },
      summary: {
        totalAccounts: readNumber(summaryData.totalAccounts),
        accountsWithCheckpoint: readNumber(summaryData.accountsWithCheckpoint),
        accountsWithoutCheckpoint: readNumber(summaryData.accountsWithoutCheckpoint),
        accountsWithPending: readNumber(summaryData.accountsWithPending),
        accountsWithFailed: readNumber(summaryData.accountsWithFailed),
        accountsWithRetryScheduled: readNumber(summaryData.accountsWithRetryScheduled),
        pendingRecords: readNumber(summaryData.pendingRecords),
        failedRecords: readNumber(summaryData.failedRecords),
        resolvedRecords: readNumber(summaryData.resolvedRecords),
        oldestCheckpointAt: toIsoString(summaryData.oldestCheckpointAt),
        latestCheckpointAt: toIsoString(summaryData.latestCheckpointAt),
        latestPendingUpdateAt: toIsoString(summaryData.latestPendingUpdateAt),
        nextRetryAt: toIsoString(summaryData.nextRetryAt),
      },
      firstSyncStateItem:
        stateItems.length > 0
          ? {
              accountId: readNullableString(firstStateItem.accountId),
              ownerUserId: readNullableString(firstStateItem.ownerUserId),
              brokerKey: readNullableString(firstStateItem.brokerKey),
              checkpointAt: toIsoString(firstStateItem.checkpointAt),
              pendingRecords: readNumber(firstStateItem.pendingRecords),
              failedRecords: readNumber(firstStateItem.failedRecords),
              resolvedRecords: readNumber(firstStateItem.resolvedRecords),
              nextRetryAt: toIsoString(firstStateItem.nextRetryAt),
            }
          : null,
      ownerScopedCount,
      firstRun:
        runItems.length > 0
          ? {
              runId: readNullableString(runItems[0].id),
              status: readNullableString(runItems[0].status),
              startedAt: toIsoString(runItems[0].startedAt),
              finishedAt: toIsoString(runItems[0].finishedAt),
            }
          : null,
      queue: {
        status: readNullableString(queueData.status),
        detail: readNullableString(queueData.detail),
      },
      worker: {
        status: readNullableString(workerData.status),
        detail: readNullableString(workerData.detail),
        lastHeartbeatAt: toIsoString(workerData.lastHeartbeatAt),
      },
      product: productSnapshot,
    })
  );
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
