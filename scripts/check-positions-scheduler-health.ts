import assert from 'node:assert/strict';
import { env } from '../src/env';

type JsonRecord = Record<string, unknown>;

const resolvedHost = env.app.host === '0.0.0.0' ? '127.0.0.1' : env.app.host;
const BASE_URL =
  process.env.HEALTH_BASE_URL ||
  process.env.SMOKE_BASE_URL ||
  `http://${resolvedHost}:${env.app.port}${env.app.routePrefix}`;
const ADMIN_EMAIL = String(
  process.env.POSITIONS_SCHEDULER_ADMIN_EMAIL ||
    process.env.SMOKE_LOGIN_EMAIL ||
    process.env.AUTH_SEED_EMAIL ||
    env.auth.seedEmail
).trim();
const ADMIN_PASSWORD = String(
  process.env.POSITIONS_SCHEDULER_ADMIN_PASSWORD ||
    process.env.SMOKE_LOGIN_PASSWORD ||
    process.env.AUTH_SEED_PASSWORD ||
    env.auth.seedPassword
).trim();
const USER_EMAIL = String(
  process.env.POSITIONS_SCHEDULER_USER_EMAIL || ADMIN_EMAIL
).trim();
const USER_PASSWORD = String(
  process.env.POSITIONS_SCHEDULER_USER_PASSWORD || ADMIN_PASSWORD
).trim();
const RUN_PRODUCT_DESK_CHECKS =
  String(process.env.POSITIONS_SCHEDULER_RUN_PRODUCT_DESK_CHECKS || 'true')
    .trim()
    .toLowerCase() !== 'false';
const TRIGGER_PRODUCT_REFRESH =
  String(process.env.POSITIONS_SCHEDULER_TRIGGER_PRODUCT_REFRESH || 'false')
    .trim()
    .toLowerCase() === 'true';
const VERIFY_OWNER_FILTER =
  String(process.env.POSITIONS_SCHEDULER_VERIFY_OWNER_FILTER || 'true')
    .trim()
    .toLowerCase() !== 'false';
const MAX_CONFIG_MS = Math.max(0, Number(process.env.POSITIONS_SCHEDULER_MAX_CONFIG_MS || 1500));
const MAX_SYNC_STATE_MS = Math.max(
  0,
  Number(process.env.POSITIONS_SCHEDULER_MAX_SYNC_STATE_MS || 1500)
);
const MAX_SYNC_SUMMARY_MS = Math.max(
  0,
  Number(process.env.POSITIONS_SCHEDULER_MAX_SYNC_SUMMARY_MS || 1500)
);
const MAX_RECOVERY_HISTORY_MS = Math.max(
  0,
  Number(process.env.POSITIONS_SCHEDULER_MAX_RECOVERY_HISTORY_MS || 1500)
);
const MAX_PRODUCT_SYNC_STATUS_MS = Math.max(
  0,
  Number(process.env.POSITIONS_SCHEDULER_MAX_PRODUCT_SYNC_STATUS_MS || 1500)
);
const MAX_PRODUCT_ACTIVE_MS = Math.max(
  0,
  Number(process.env.POSITIONS_SCHEDULER_MAX_PRODUCT_ACTIVE_MS || 1500)
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
  assert.ok(email && password, 'admin or user login credentials are required');
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

function readFirstPositionId(groupedResponse: JsonRecord): string | null {
  const items = readArray(asRecord(groupedResponse.data).items);
  const firstAccount = asRecord(items[0]);
  const positions = readArray(firstAccount.positions || firstAccount.data);
  const firstPosition = asRecord(positions[0]);
  return readString(firstPosition.id || firstPosition.external_id) || null;
}

async function run(): Promise<void> {
  const adminToken = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  const adminMe = await requestJson('/auth/me', {}, adminToken);
  assert.equal(
    readString(asRecord(adminMe.data).role).toLowerCase(),
    'admin',
    'positions scheduler health checks require an admin login'
  );

  const configStartedAt = Date.now();
  const configResponse = await requestJson('/scheduler/positions/config', {}, adminToken);
  const configDurationMs = Date.now() - configStartedAt;
  const configData = asRecord(configResponse.data);
  assert.equal(configData.key, 'positions-sync');
  assert.equal(configData.schedulerType, 'global');
  const recoveryPolicy = asRecord(configData.readModelRecoveryPolicy);
  assert.equal(
    recoveryPolicy.supported,
    true,
    'positions scheduler config must expose read-model recovery support metadata'
  );
  assert.ok(
    readString(recoveryPolicy.runbookPath).includes('POSITIONS_SCHEDULER_PRODUCT_SPLIT_PHASE6.md'),
    'positions scheduler config must expose the Phase 6 recovery runbook path'
  );
  assert.equal(
    readString(recoveryPolicy.cliCommand),
    'npm run rebuild:positions-read-model',
    'positions scheduler config must expose the canonical rebuild CLI command'
  );

  const summaryStartedAt = Date.now();
  const summaryResponse = await requestJson('/scheduler/positions/sync-state/summary', {}, adminToken);
  const summaryDurationMs = Date.now() - summaryStartedAt;
  const summaryData = asRecord(summaryResponse.data);
  assert.equal(summaryData.schedulerKey, 'positions-sync');
  assert.ok(
    'accountsWithSnapshotData' in summaryData,
    'positions scheduler summary must expose accountsWithSnapshotData'
  );
  assert.ok(
    'accountsWithReadModel' in summaryData,
    'positions scheduler summary must expose accountsWithReadModel'
  );
  assert.ok(
    'accountsWithReadModelDrift' in summaryData,
    'positions scheduler summary must expose accountsWithReadModelDrift'
  );

  const stateStartedAt = Date.now();
  const stateResponse = await requestJson(
    '/scheduler/positions/sync-state?limit=25&offset=0',
    {},
    adminToken
  );
  const stateDurationMs = Date.now() - stateStartedAt;
  const stateItems = readArray(asRecord(stateResponse.data).items).map(asRecord);
  assert.ok(Array.isArray(stateItems), 'sync-state must return an items array');

  const firstStateItem = asRecord(stateItems[0]);
  if (stateItems.length > 0) {
    assert.ok(
      'ownerUserId' in firstStateItem,
      'positions scheduler sync-state items must expose ownerUserId'
    );
    assert.ok(
      'readModelState' in firstStateItem,
      'positions scheduler sync-state items must expose readModelState'
    );
    assert.ok(
      'readModelNeedsRebuild' in firstStateItem,
      'positions scheduler sync-state items must expose readModelNeedsRebuild'
    );
  }

  let ownerScopedCount: number | null = null;
  const firstOwnerUserId = readString(firstStateItem.ownerUserId);
  if (VERIFY_OWNER_FILTER && firstOwnerUserId) {
    const ownerScopedResponse = await requestJson(
      `/scheduler/positions/sync-state?limit=25&offset=0&ownerUserId=${encodeURIComponent(firstOwnerUserId)}`,
      {},
      adminToken
    );
    const ownerScopedItems = readArray(asRecord(ownerScopedResponse.data).items).map(asRecord);
    ownerScopedCount = ownerScopedItems.length;
    assert.ok(
      ownerScopedItems.every((item) => readString(item.ownerUserId) === firstOwnerUserId),
      'ownerUserId filter should keep sync-state diagnostics on the selected owner only'
    );
  }

  const historyStartedAt = Date.now();
  const historyResponse = await requestJson(
    '/scheduler/positions/read-model/recovery-history?limit=10&offset=0',
    {},
    adminToken
  );
  const historyDurationMs = Date.now() - historyStartedAt;
  const historyItems = readArray(asRecord(historyResponse.data).items).map(asRecord);
  assert.ok(Array.isArray(historyItems), 'recovery history must return an items array');
  const firstHistoryItem = asRecord(historyItems[0]);
  if (historyItems.length > 0) {
    assert.ok(
      readString(firstHistoryItem.recoveryId),
      'recovery history entries must expose a recoveryId'
    );
    assert.ok(
      readString(firstHistoryItem.scope),
      'recovery history entries must expose a scope'
    );
    assert.ok(
      Array.isArray(firstHistoryItem.warnings || []),
      'recovery history entries must expose warnings as an array'
    );
  }

  let productSnapshot: JsonRecord | null = null;
  if (RUN_PRODUCT_DESK_CHECKS) {
    const userToken =
      USER_EMAIL === ADMIN_EMAIL && USER_PASSWORD === ADMIN_PASSWORD
        ? adminToken
        : await login(USER_EMAIL, USER_PASSWORD);

    const productSyncStartedAt = Date.now();
    const productSyncResponse = await requestJson('/positions/futures/sync-status', {}, userToken);
    const productSyncDurationMs = Date.now() - productSyncStartedAt;
    const productSyncData = asRecord(productSyncResponse.data);
    assert.ok(Array.isArray(productSyncData.items), 'positions sync status must return grouped route items');

    const productActiveStartedAt = Date.now();
    const productActiveResponse = await requestJson('/positions/futures/active', {}, userToken);
    const productActiveDurationMs = Date.now() - productActiveStartedAt;
    const productActiveData = asRecord(productActiveResponse.data);
    const groupedFreshness = asRecord(productActiveData.freshness);
    assert.ok(
      Array.isArray(productActiveData.items),
      'positions active desk must return grouped account items'
    );
    if (readArray(productActiveData.items).length > 0) {
      assert.ok(
        readNullableString(groupedFreshness.observedAt),
        'positions active desk must stay freshness-aware when grouped accounts are present'
      );
    }

    let refreshResponseData: JsonRecord | null = null;
    if (TRIGGER_PRODUCT_REFRESH) {
      const refreshResponse = await requestJson(
        '/positions/futures/refresh',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({}),
        },
        userToken
      );
      refreshResponseData = asRecord(refreshResponse.data);
      assert.ok(
        typeof refreshResponseData.requested === 'boolean',
        'positions refresh should return an explicit requested flag'
      );
    }

    productSnapshot = {
      syncStatusState: readNullableString(productSyncData.state),
      syncStatusSummary: readNullableString(productSyncData.summary),
      syncStatusItems: readArray(productSyncData.items).length,
      activeAccounts: readArray(productActiveData.items).length,
      groupedFreshnessState: readNullableString(groupedFreshness.state),
      groupedFreshnessObservedAt: readNullableString(groupedFreshness.observedAt),
      firstActivePositionId: readFirstPositionId(productActiveResponse),
      refreshResponse: refreshResponseData,
      productSyncDurationMs,
      productActiveDurationMs,
    };

    assertMaxDuration('positions product sync-status', productSyncDurationMs, MAX_PRODUCT_SYNC_STATUS_MS);
    assertMaxDuration('positions product active desk', productActiveDurationMs, MAX_PRODUCT_ACTIVE_MS);
  }

  assertMaxDuration('positions scheduler config', configDurationMs, MAX_CONFIG_MS);
  assertMaxDuration('positions scheduler sync-state summary', summaryDurationMs, MAX_SYNC_SUMMARY_MS);
  assertMaxDuration('positions scheduler sync-state list', stateDurationMs, MAX_SYNC_STATE_MS);
  assertMaxDuration(
    'positions scheduler recovery history',
    historyDurationMs,
    MAX_RECOVERY_HISTORY_MS
  );

  console.log(
    'positions-scheduler-health:',
    JSON.stringify({
      baseUrl: BASE_URL,
      configDurationMs,
      summaryDurationMs,
      stateDurationMs,
      historyDurationMs,
      summary: {
        totalAccounts: readNumber(summaryData.totalAccounts),
        accountsWithSnapshotData: readNumber(summaryData.accountsWithSnapshotData),
        accountsWithReadModel: readNumber(summaryData.accountsWithReadModel),
        accountsWithReadModelDrift: readNumber(summaryData.accountsWithReadModelDrift),
        pendingRecords: readNumber(summaryData.pendingRecords),
        failedRecords: readNumber(summaryData.failedRecords),
        latestCheckpointAt: toIsoString(summaryData.latestCheckpointAt),
        latestSnapshotSeenAt: toIsoString(summaryData.latestSnapshotSeenAt),
        latestReadModelSeenAt: toIsoString(summaryData.latestReadModelSeenAt),
      },
      firstSyncStateItem:
        stateItems.length > 0
          ? {
              accountId: readNullableString(firstStateItem.accountId),
              ownerUserId: readNullableString(firstStateItem.ownerUserId),
              readModelState: readNullableString(firstStateItem.readModelState),
              readModelNeedsRebuild:
                firstStateItem.readModelNeedsRebuild === true,
              snapshotRows: readNumber(firstStateItem.snapshotRows),
              readModelRows: readNumber(firstStateItem.readModelRows),
              rowsMissingFromReadModel: readNumber(firstStateItem.rowsMissingFromReadModel),
              rowsBehindSnapshot: readNumber(firstStateItem.rowsBehindSnapshot),
              orphanReadModelRows: readNumber(firstStateItem.orphanReadModelRows),
              checkpointAt: toIsoString(firstStateItem.checkpointAt),
            }
          : null,
      ownerScopedCount,
      latestRecoveryItem:
        historyItems.length > 0
          ? {
              recoveryId: readNullableString(firstHistoryItem.recoveryId),
              scope: readNullableString(firstHistoryItem.scope),
              status: readNullableString(firstHistoryItem.status),
              time: toIsoString(firstHistoryItem.time),
            }
          : null,
      productSnapshot,
    })
  );
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
