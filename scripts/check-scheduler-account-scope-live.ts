import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { coreDataSource } from '../src/database/data-source';
import { initializeCoreDataSource } from '../src/database/initializeCoreDataSource';
import { env } from '../src/env';

type JsonRecord = Record<string, unknown>;
export type SchedulerAccountScopeLiveSnapshot = {
  baseUrl: string;
  activeTotal: number;
  activeUserOwned: number;
  activeSystemOwned: number;
  ownerlessAccountIds: string[];
  orders: {
    summaryTotalAccounts: number;
    listTotalAccounts: number;
  };
  positions: {
    summaryTotalAccounts: number;
    listTotalAccounts: number;
  };
  funds: {
    batchTotalAccounts: number;
    batchFailureCount: number;
    ownerlessScopedTotalAccounts: number;
  };
};

const OUTPUT_FILE = String(
  process.env.SCHEDULER_ACCOUNT_SCOPE_OUTPUT_FILE || 'artifacts/scheduler-account-scope-live.json'
).trim();

function readString(value: unknown): string {
  return String(value || '').trim();
}

function readNumber(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function asRecord(value: unknown): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as JsonRecord;
}

async function readJson(url: string, init?: RequestInit): Promise<JsonRecord> {
  const response = await fetch(url, init);
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}: ${text}`);
  }

  return asRecord(JSON.parse(text));
}

async function login(baseUrl: string): Promise<string> {
  const loginResponse = await readJson(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      email: env.auth.seedEmail,
      password: env.auth.seedPassword,
    }),
  });

  const token = readString(asRecord(loginResponse.data).accessToken);
  assert.ok(token, 'auth/login must return an access token for the live account-scope check');
  return token;
}

async function persistSummary(filePath: string, summary: Record<string, unknown>): Promise<void> {
  if (!filePath) {
    return;
  }

  const absolutePath = path.resolve(process.cwd(), filePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
}

export function assertSchedulerAccountScopeLiveSnapshot(
  summary: SchedulerAccountScopeLiveSnapshot
): void {
  assert.equal(
    summary.orders.summaryTotalAccounts,
    summary.activeUserOwned,
    'orders sync-state summary must match the live user-owned broker-account count'
  );
  assert.equal(
    summary.orders.listTotalAccounts,
    summary.activeUserOwned,
    'orders sync-state list total must match the live user-owned broker-account count'
  );
  assert.equal(
    summary.positions.summaryTotalAccounts,
    summary.activeUserOwned,
    'positions sync-state summary must match the live user-owned broker-account count'
  );
  assert.equal(
    summary.positions.listTotalAccounts,
    summary.activeUserOwned,
    'positions sync-state list total must match the live user-owned broker-account count'
  );
  assert.equal(
    summary.funds.batchTotalAccounts,
    summary.activeUserOwned,
    'funds internal batch must process only the live user-owned broker accounts'
  );
  assert.equal(
    summary.funds.batchFailureCount,
    0,
    'funds internal batch must not treat ownerless system accounts as failures anymore'
  );

  if (summary.ownerlessAccountIds.length > 0) {
    assert.equal(
      summary.funds.ownerlessScopedTotalAccounts,
      0,
      'funds internal batch scoped only to ownerless accounts must ignore them completely'
    );
  }
}

export async function buildSchedulerAccountScopeLiveSnapshot(): Promise<SchedulerAccountScopeLiveSnapshot> {
  const baseUrl =
    readString(process.env.SCHEDULER_ACCOUNT_SCOPE_BASE_URL) ||
    `${env.app.schema}://${env.app.host}:${env.app.port}${env.app.routePrefix}`;
  const systemUserId = readString(env.scheduler.systemUserId) || 'system';
  const apiKey = readString(env.app.apiKey);

  assert.ok(env.auth.seedEmail, 'AUTH seed email must be configured for the live account-scope check');
  assert.ok(
    env.auth.seedPassword,
    'AUTH seed password must be configured for the live account-scope check'
  );
  assert.ok(apiKey, 'APP_API_KEY must be configured for the live account-scope check');

  const shouldDestroy = !coreDataSource.isInitialized;
  if (shouldDestroy) {
    await initializeCoreDataSource();
  }

  try {
    const countsRows = (await coreDataSource.query(
      `SELECT
         COUNT(*) AS activeTotal,
         COALESCE(SUM(CASE WHEN user_id IS NOT NULL THEN 1 ELSE 0 END), 0) AS activeUserOwned,
         COALESCE(SUM(CASE WHEN user_id IS NULL THEN 1 ELSE 0 END), 0) AS activeSystemOwned
       FROM broker_accounts
       WHERE LOWER(status) IN ('connected', 'idle')`
    )) as Array<Record<string, unknown>>;
    const countsRow = countsRows[0] || {};
    const activeTotal = readNumber(countsRow.activeTotal);
    const activeUserOwned = readNumber(countsRow.activeUserOwned);
    const activeSystemOwned = readNumber(countsRow.activeSystemOwned);

    const ownerlessRows = (await coreDataSource.query(
      `SELECT id
       FROM broker_accounts
       WHERE user_id IS NULL
         AND LOWER(status) IN ('connected', 'idle')
       ORDER BY id ASC`
    )) as Array<Record<string, unknown>>;
    const ownerlessAccountIds = ownerlessRows
      .map((row) => readString(row.id))
      .filter(Boolean);

    const accessToken = await login(baseUrl);
    const authHeaders = {
      authorization: `Bearer ${accessToken}`,
    };

    const ordersSummaryResponse = await readJson(`${baseUrl}/scheduler/orders/sync-state/summary`, {
      headers: authHeaders,
    });
    const ordersSummary = asRecord(ordersSummaryResponse.data);

    const ordersListResponse = await readJson(
      `${baseUrl}/scheduler/orders/sync-state?limit=20&offset=0`,
      { headers: authHeaders }
    );
    const ordersListData = asRecord(ordersListResponse.data);
    const ordersItems = Array.isArray(ordersListData.items) ? ordersListData.items : [];
    assert.equal(
      ordersItems.every((item) => {
        const record = asRecord(item);
        return Boolean(readString(record.ownerUserId) || readString(record.userId));
      }),
      true,
      'orders sync-state list must not contain ownerless system accounts'
    );

    const positionsSummaryResponse = await readJson(
      `${baseUrl}/scheduler/positions/sync-state/summary`,
      {
        headers: authHeaders,
      }
    );
    const positionsSummary = asRecord(positionsSummaryResponse.data);

    const positionsListResponse = await readJson(
      `${baseUrl}/scheduler/positions/sync-state?limit=20&offset=0`,
      { headers: authHeaders }
    );
    const positionsListData = asRecord(positionsListResponse.data);
    const positionsItems = Array.isArray(positionsListData.items) ? positionsListData.items : [];
    assert.equal(
      positionsItems.every((item) => {
        const record = asRecord(item);
        return Boolean(readString(record.ownerUserId) || readString(record.userId));
      }),
      true,
      'positions sync-state list must not contain ownerless system accounts'
    );

    const fundsBatchResponse = await readJson(`${baseUrl}/internal/funds/snapshot`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        targetUserIds: [systemUserId],
      }),
    });
    const fundsBatch = asRecord(fundsBatchResponse.data);

    let ownerlessScopedFunds: JsonRecord = {};
    if (ownerlessAccountIds.length > 0) {
      const ownerlessScopedResponse = await readJson(`${baseUrl}/internal/funds/snapshot`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
        },
        body: JSON.stringify({
          targetUserIds: [systemUserId],
          accountIds: ownerlessAccountIds,
        }),
      });
      ownerlessScopedFunds = asRecord(ownerlessScopedResponse.data);
      assert.equal(readNumber(ownerlessScopedFunds.successCount), 0);
      assert.equal(readNumber(ownerlessScopedFunds.failureCount), 0);
    }

    return {
      baseUrl,
      activeTotal,
      activeUserOwned,
      activeSystemOwned,
      ownerlessAccountIds,
      orders: {
        summaryTotalAccounts: readNumber(ordersSummary.totalAccounts),
        listTotalAccounts: readNumber(ordersListData.total),
      },
      positions: {
        summaryTotalAccounts: readNumber(positionsSummary.totalAccounts),
        listTotalAccounts: readNumber(positionsListData.total),
      },
      funds: {
        batchTotalAccounts: readNumber(fundsBatch.totalAccounts),
        batchFailureCount: readNumber(fundsBatch.failureCount),
        ownerlessScopedTotalAccounts: readNumber(ownerlessScopedFunds.totalAccounts),
      },
    };
  } finally {
    if (shouldDestroy && coreDataSource.isInitialized) {
      await coreDataSource.destroy();
    }
  }
}

async function run(): Promise<void> {
  const summary = await buildSchedulerAccountScopeLiveSnapshot();
  assertSchedulerAccountScopeLiveSnapshot(summary);
  await persistSummary(OUTPUT_FILE, summary);
  console.log('scheduler-account-scope-live:', JSON.stringify(summary));
}

const isMainModule =
  path.basename(String(process.argv[1] || '')) === 'check-scheduler-account-scope-live.ts';

if (isMainModule) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exit(1);
  });
}
