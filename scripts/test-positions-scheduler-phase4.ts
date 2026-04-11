import assert from 'node:assert/strict';
import { BrokerPositionsFacadeService } from '../src/api/services/BrokerPositionsFacadeService';
import { coreDataSource } from '../src/database/data-source';

async function testRequestPositionsRefreshStaysProductScoped(): Promise<void> {
  const service = new BrokerPositionsFacadeService() as any;
  let capturedPayload: Record<string, unknown> | null = null;

  service.brokerAccountRepository = {
    async getActiveBrokerAccounts(userId: string, brokerKey?: string) {
      assert.equal(userId, 'user-1');
      assert.equal(brokerKey, 'mudrex');
      return [
        {
          id: 'acc-1',
          accountName: 'Main account',
          accountKey: 'main-account',
          brokerKey: 'mudrex',
          status: 'Connected',
        },
      ];
    },
  } as any;
  service.internalPositionsSyncService = {
    async runBatch(payload: Record<string, unknown>) {
      capturedPayload = payload;
      return {
        processedUsers: 1,
        succeededUsers: 1,
        failedUsers: 0,
        processedAccounts: 1,
        fetchedRecords: 12,
        insertedRecords: 3,
        updatedRecords: 5,
        skippedRecords: 4,
        failedAccounts: 0,
        failures: [],
      };
    },
  } as any;

  const response = await service.requestPositionsRefresh('user-1', {
    brokerKey: 'mudrex',
    accountId: 'acc-1',
  });

  assert.deepEqual(capturedPayload, {
    executionScope: 'product_user',
    requestUserId: 'user-1',
    targetUserIds: ['user-1'],
    brokerKeys: ['mudrex'],
    accountIds: ['acc-1'],
  });
  assert.equal(response.requested, true);
  assert.equal(response.scope, 'account');
  assert.equal(response.state, 'completed');
  assert.equal(response.processedAccounts, 1);
  assert.match(response.summary, /Reconciled 1 route/);
}

async function testPositionsSyncStatusUsesAccountFreshnessAndPendingState(): Promise<void> {
  const service = new BrokerPositionsFacadeService() as any;
  const originalQuery = (coreDataSource as any).query;

  service.brokerAccountRepository = {
    async getActiveBrokerAccounts(userId: string, brokerKey?: string) {
      assert.equal(userId, 'user-1');
      assert.equal(brokerKey, 'mudrex');
      return [
        {
          id: 'acc-1',
          accountName: 'Main account',
          accountKey: 'main-account',
          brokerKey: 'mudrex',
          status: 'Connected',
        },
      ];
    },
  } as any;
  service.positionReadModelRepository = {
    async ensureHydratedFromSnapshots(userId: string, accountIds: string[]) {
      assert.equal(userId, 'user-1');
      assert.deepEqual(accountIds, ['acc-1']);
    },
    async getAccountFreshness(userId: string, accountIds: string[]) {
      assert.equal(userId, 'user-1');
      assert.deepEqual(accountIds, ['acc-1']);
      return new Map([
        [
          'acc-1',
          {
            observedAt: new Date(Date.now() - 20 * 60 * 1000),
            checkpointAt: new Date(Date.now() - 5 * 60 * 1000),
            openPositions: 2,
            totalRows: 4,
          },
        ],
      ]);
    },
  } as any;

  (coreDataSource as any).query = async (sql: string) => {
    if (sql.includes('scheduler_sync_pending_records')) {
      return [
        {
          accountId: 'acc-1',
          pendingRecords: 2,
          failedRecords: 1,
          resolvedRecords: 4,
          nextRetryAt: '2026-04-09T06:40:00.000Z',
          lastPendingUpdateAt: '2026-04-09T06:35:00.000Z',
        },
      ];
    }
    throw new Error(`Unexpected SQL in positions scheduler phase 4 test: ${sql}`);
  };

  try {
    const response = await service.getPositionsSyncStatus('user-1', {
      brokerKey: 'mudrex',
    });

    assert.equal(response.scope, 'broker');
    assert.equal(response.totalAccounts, 1);
    assert.equal(response.pendingRecords, 2);
    assert.equal(response.failedRecords, 1);
    assert.equal(response.resolvedRecords, 4);
    assert.equal(response.state, 'attention');
    assert.equal(response.items[0].accountId, 'acc-1');
    assert.equal(response.items[0].failedRecords, 1);
    assert.match(String(response.items[0].warning || ''), /failed sync record/);
    assert.match(response.summary, /need operator attention/);
  } finally {
    (coreDataSource as any).query = originalQuery;
  }
}

async function run(): Promise<void> {
  await testRequestPositionsRefreshStaysProductScoped();
  await testPositionsSyncStatusUsesAccountFreshnessAndPendingState();
  console.log('Positions scheduler phase 4 assertions passed.');
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
