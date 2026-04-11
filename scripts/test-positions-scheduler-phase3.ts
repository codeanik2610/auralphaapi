import assert from 'node:assert/strict';
import { PositionsSchedulerService } from '../src/api/services/PositionsSchedulerService';
import { coreDataSource } from '../src/database/data-source';

function createConfig(overrides: Record<string, unknown> = {}) {
  return {
    key: 'positions-sync',
    name: 'Positions Sync',
    description: 'System reconciliation scheduler for broker position snapshots, checkpoints, and read-model hydration.',
    enabled: true,
    cronExpression: '0 1 * * *',
    timezone: 'UTC',
    runAt: '01:00',
    intervalDays: 1,
    batchSize: 200,
    schedulerType: 'global',
    config: {
      sources: ['positions'],
      retentionDays: 30,
      lookbackDays: 90,
    },
    lastStartedAt: null,
    lastFinishedAt: null,
    lastStatus: null,
    lastError: null,
    createdAt: new Date('2026-04-09T00:00:00.000Z'),
    updatedAt: new Date('2026-04-09T00:00:00.000Z'),
    ...overrides,
  };
}

async function testGlobalDiagnosticsConfigRead(): Promise<void> {
  const service = new PositionsSchedulerService() as any;
  let createIfMissingCalls = 0;
  service.schedulerConfigRepository = {
    async createIfMissing() {
      createIfMissingCalls += 1;
      return createConfig() as any;
    },
  } as any;

  const response = await service.getSchedulerConfig('admin-user-1');
  assert.equal(createIfMissingCalls, 1);
  assert.equal(response.data.schedulerType, 'global');
  assert.equal(response.data.timezone, 'UTC');
}

async function testOwnerUserFilterIsExplicitAndResponseShapeStaysStable(): Promise<void> {
  const service = new PositionsSchedulerService() as any;
  const originalQuery = (coreDataSource as any).query;
  const capturedQueries: Array<{ sql: string; params: unknown[] }> = [];

  (coreDataSource as any).query = async (sql: string, params: unknown[] = []) => {
    capturedQueries.push({ sql, params });
    if (sql.includes('GROUP BY ba.id')) {
      return [
        {
          accountId: 'account-1',
          userId: 'user-42',
          brokerKey: 'binance',
          checkpointAt: '2026-04-09T01:00:00.000Z',
          pendingRecords: 1,
          failedRecords: 0,
          resolvedRecords: 2,
          nextRetryAt: null,
          lastPendingUpdateAt: '2026-04-09T01:05:00.000Z',
        },
      ];
    }
    if (sql.includes('SELECT COUNT(*) AS total')) {
      return [{ total: 1 }];
    }
    throw new Error(`Unexpected SQL in positions scheduler phase 3 test: ${sql}`);
  };

  try {
    const response = await service.listSchedulerSyncState('admin-user-1', {
      limit: '20',
      offset: '0',
      ownerUserId: 'user-42',
    });

    assert.equal(response.data.items.length, 1);
    assert.equal(response.data.items[0].userId, 'user-42');
    assert.equal(response.data.items[0].ownerUserId, 'user-42');
    assert.ok(
      capturedQueries.some(
        (entry) =>
          entry.sql.includes('ba.user_id = ?') &&
          entry.params.includes('user-42')
      ),
      'sync-state should filter explicitly by ownerUserId'
    );
  } finally {
    (coreDataSource as any).query = originalQuery;
  }
}

async function testRunUpdatesStayPositionsScoped(): Promise<void> {
  const service = new PositionsSchedulerService() as any;
  let listByRunLogIdCalls = 0;

  service.schedulerRunLogRepository = {
    async findByIdAndSchedulerKey(runId: string, schedulerKey: string) {
      assert.equal(runId, 'missing-run');
      assert.equal(schedulerKey, 'positions-sync');
      return null;
    },
  } as any;
  service.exchangeAssetUpdateLogRepository = {
    async listByRunLogId() {
      listByRunLogIdCalls += 1;
      return { items: [], total: 0 };
    },
  } as any;

  await assert.rejects(
    () =>
      service.listSchedulerRunUpdates('admin-user-1', 'missing-run', {
        limit: '20',
        offset: '0',
      }),
    /Positions scheduler run not found/
  );
  assert.equal(listByRunLogIdCalls, 0);
}

async function run(): Promise<void> {
  await testGlobalDiagnosticsConfigRead();
  await testOwnerUserFilterIsExplicitAndResponseShapeStaysStable();
  await testRunUpdatesStayPositionsScoped();
  console.log('Positions scheduler phase 3 assertions passed.');
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
