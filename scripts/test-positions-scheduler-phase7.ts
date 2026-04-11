import assert from 'node:assert/strict';
import { PositionsSchedulerService } from '../src/api/services/PositionsSchedulerService';
import { coreDataSource } from '../src/database/data-source';

async function testLegacyUserIdAliasNoLongerFiltersSyncState(): Promise<void> {
  const service = new PositionsSchedulerService() as any;
  const originalQuery = (coreDataSource as any).query;
  const capturedQueries: Array<{ sql: string; params: unknown[] }> = [];

  service.positionReadModelRepository = {
    async getReadModelCoverageByAccountIds() {
      return new Map();
    },
  };

  (coreDataSource as any).query = async (sql: string, params: unknown[] = []) => {
    capturedQueries.push({ sql, params });
    if (sql.includes('GROUP BY ba.id')) {
      return [];
    }
    if (sql.includes('SELECT COUNT(*) AS total')) {
      return [{ total: 0 }];
    }
    throw new Error(`Unexpected SQL in positions scheduler phase 7 test: ${sql}`);
  };

  try {
    const response = await service.listSchedulerSyncState('admin-user-1', {
      limit: '20',
      offset: '0',
      userId: 'legacy-user-42' as unknown as string,
    });

    assert.equal(response.data.items.length, 0);
    assert.ok(
      capturedQueries.every((entry) => !entry.sql.includes('ba.user_id = ?')),
      'legacy userId alias should no longer apply an owner filter to sync-state diagnostics'
    );
    assert.ok(
      capturedQueries.every((entry) => !entry.params.includes('legacy-user-42')),
      'legacy userId alias should be ignored once ownerUserId is the explicit diagnostics filter'
    );
    assert.ok(
      capturedQueries.every((entry) => entry.sql.includes('ba.user_id IS NOT NULL')),
      'default positions sync-state diagnostics should exclude ownerless system accounts'
    );
  } finally {
    (coreDataSource as any).query = originalQuery;
  }
}

async function testOwnerUserIdFilterStillWorks(): Promise<void> {
  const service = new PositionsSchedulerService() as any;
  const originalQuery = (coreDataSource as any).query;
  const capturedQueries: Array<{ sql: string; params: unknown[] }> = [];

  service.positionReadModelRepository = {
    async getReadModelCoverageByAccountIds() {
      return new Map();
    },
  };

  (coreDataSource as any).query = async (sql: string, params: unknown[] = []) => {
    capturedQueries.push({ sql, params });
    if (sql.includes('GROUP BY ba.id')) {
      return [
        {
          accountId: 'acc-1',
          userId: 'user-42',
          brokerKey: 'mudrex',
          checkpointAt: '2026-04-10T02:00:00.000Z',
          pendingRecords: 0,
          failedRecords: 0,
          resolvedRecords: 0,
          nextRetryAt: null,
          lastPendingUpdateAt: null,
        },
      ];
    }
    if (sql.includes('SELECT COUNT(*) AS total')) {
      return [{ total: 1 }];
    }
    throw new Error(`Unexpected SQL in positions scheduler phase 7 test: ${sql}`);
  };

  try {
    const response = await service.listSchedulerSyncState('admin-user-1', {
      limit: '20',
      offset: '0',
      ownerUserId: 'user-42',
    });

    assert.equal(response.data.items.length, 1);
    assert.equal(response.data.items[0].ownerUserId, 'user-42');
    assert.ok(
      capturedQueries.some(
        (entry) => entry.sql.includes('ba.user_id = ?') && entry.params.includes('user-42')
      ),
      'ownerUserId should remain the explicit account-owner diagnostics filter'
    );
    assert.ok(
      capturedQueries.every((entry) => entry.sql.includes('ba.user_id IS NOT NULL')),
      'positions sync-state diagnostics should keep excluding ownerless system accounts even when owner filters are applied'
    );
  } finally {
    (coreDataSource as any).query = originalQuery;
  }
}

async function testRecoveryHistoryMapsStructuredActivity(): Promise<void> {
  const service = new PositionsSchedulerService() as any;
  let capturedQuery:
    | {
        referenceId?: string;
        status?: string;
      }
    | null = null;

  service.activityRepository = {
    async listActivity(userId: string, query: Record<string, unknown>) {
      assert.equal(userId, 'admin-user-1');
      capturedQuery = query;
      return {
        items: [
          {
            id: 'activity-1',
            title: 'Positions read-model rebuild completed',
            status: 'Success',
            actor: 'admin-user-1',
            route: 'Schedulers',
            description: 'Positions read-model rebuild completed for owner owner-1.',
            referenceId: 'positions-read-model-recovery',
            correlationId: 'recovery-1',
            stream: 'Runs',
            related: 'positions-sync',
            createdAt: new Date('2026-04-10T10:30:00.000Z'),
            updatedAt: new Date('2026-04-10T10:30:00.000Z'),
            flags: [
              {
                id: 'scope',
                message: 'owner',
                channel: 'Recovery',
                time: '2026-04-10T10:30:00.000Z',
                status: 'Success',
              },
              {
                id: 'state',
                message: 'applied',
                channel: 'Recovery',
                time: '2026-04-10T10:30:00.000Z',
                status: 'Success',
              },
              {
                id: 'requested-accounts',
                message: '3',
                channel: 'Recovery',
                time: '2026-04-10T10:30:00.000Z',
                status: 'Success',
              },
              {
                id: 'targeted-accounts',
                message: '2',
                channel: 'Recovery',
                time: '2026-04-10T10:30:00.000Z',
                status: 'Success',
              },
              {
                id: 'processed-accounts',
                message: '1',
                channel: 'Recovery',
                time: '2026-04-10T10:30:00.000Z',
                status: 'Success',
              },
              {
                id: 'skipped-accounts',
                message: '1',
                channel: 'Recovery',
                time: '2026-04-10T10:30:00.000Z',
                status: 'Success',
              },
              {
                id: 'deleted-rows',
                message: '4',
                channel: 'Recovery',
                time: '2026-04-10T10:30:00.000Z',
                status: 'Success',
              },
              {
                id: 'inserted-rows',
                message: '5',
                channel: 'Recovery',
                time: '2026-04-10T10:30:00.000Z',
                status: 'Success',
              },
              {
                id: 'snapshot-rows-processed',
                message: '5',
                channel: 'Recovery',
                time: '2026-04-10T10:30:00.000Z',
                status: 'Success',
              },
              {
                id: 'before-drift-accounts',
                message: '2',
                channel: 'Recovery',
                time: '2026-04-10T10:30:00.000Z',
                status: 'Success',
              },
              {
                id: 'after-drift-accounts',
                message: '1',
                channel: 'Recovery',
                time: '2026-04-10T10:30:00.000Z',
                status: 'Success',
              },
              {
                id: 'filter-owner-user-id',
                message: 'owner-1',
                channel: 'Recovery',
                time: '2026-04-10T10:30:00.000Z',
                status: 'Success',
              },
              {
                id: 'next-step',
                message: 'Refresh sync truth and inspect remaining drift.',
                channel: 'Recovery guidance',
                time: '2026-04-10T10:30:00.000Z',
                status: 'Success',
              },
              {
                id: 'warning-1',
                message: '1 targeted account had no snapshot rows available for rebuild and was skipped.',
                channel: 'Recovery warning',
                time: '2026-04-10T10:30:00.000Z',
                status: 'Warning',
              },
            ],
          },
        ],
        total: 1,
      };
    },
  };

  const response = await service.listReadModelRecoveryHistory('admin-user-1', {
    limit: '10',
    offset: '0',
    status: 'success',
  });

  if (!capturedQuery) {
    throw new Error('expected recovery-history query arguments to be captured');
  }
  const normalizedCapturedQuery = capturedQuery as {
    referenceId?: string;
    status?: string;
  };
  assert.equal(normalizedCapturedQuery.referenceId, 'positions-read-model-recovery');
  assert.equal(normalizedCapturedQuery.status, 'Success');
  assert.equal(response.data.total, 1);
  assert.equal(response.data.items[0].recoveryId, 'recovery-1');
  assert.equal(response.data.items[0].scope, 'owner');
  assert.equal(response.data.items[0].requestedAccounts, 3);
  assert.equal(response.data.items[0].targetedAccounts, 2);
  assert.equal(response.data.items[0].beforeDriftAccounts, 2);
  assert.equal(response.data.items[0].afterDriftAccounts, 1);
  assert.equal(response.data.items[0].filters.ownerUserId, 'owner-1');
  assert.equal(
    response.data.items[0].recommendedNextStep,
    'Refresh sync truth and inspect remaining drift.'
  );
  assert.equal(response.data.items[0].warnings.length, 1);
}

async function run(): Promise<void> {
  await testLegacyUserIdAliasNoLongerFiltersSyncState();
  await testOwnerUserIdFilterStillWorks();
  await testRecoveryHistoryMapsStructuredActivity();
  console.log('Positions scheduler phase 7 assertions passed.');
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
