import assert from 'node:assert/strict';
import { PositionsSchedulerService } from '../src/api/services/PositionsSchedulerService';
import { coreDataSource } from '../src/database/data-source';
import { PositionReadModelRepository } from '../src/database/repositories/PositionReadModelRepository';

async function testPositionsSchedulerConfigExposesRecoveryPolicy(): Promise<void> {
  const service = new PositionsSchedulerService() as any;

  service.schedulerConfigRepository = {
    async createIfMissing() {
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
        lastStartedAt: null,
        lastFinishedAt: null,
        lastStatus: null,
        lastError: null,
        config: {
          sources: ['positions'],
          retentionDays: 30,
        },
      };
    },
  };

  const response = await service.getSchedulerConfig('admin-user');
  assert.equal(response.data.key, 'positions-sync');
  assert.equal(response.data.readModelRecoveryPolicy?.supported, true);
  assert.equal(response.data.readModelRecoveryPolicy?.defaultOnlyDrifted, true);
  assert.equal(response.data.readModelRecoveryPolicy?.allowRebuildAll, true);
  assert.equal(response.data.readModelRecoveryPolicy?.confirmationRequiredAboveAccounts, 2);
  assert.deepEqual(response.data.readModelRecoveryPolicy?.confirmationRequiredScopes, [
    'owner',
    'broker',
    'all',
  ]);
  assert.match(
    String(response.data.readModelRecoveryPolicy?.runbookPath || ''),
    /POSITIONS_SCHEDULER_PRODUCT_SPLIT_PHASE6\.md$/
  );
  assert.equal(
    response.data.readModelRecoveryPolicy?.cliCommand,
    'npm run rebuild:positions-read-model'
  );
}

async function testReadModelCoverageAggregation(): Promise<void> {
  const repository = new PositionReadModelRepository();
  const originalQuery = (coreDataSource as any).query;

  (coreDataSource as any).query = async (sql: string) => {
    if (sql.includes('FROM scheduler_positions_snapshots s')) {
      return [
        {
          accountId: 'acc-1',
          snapshotRows: 4,
          latestSnapshotSeenAt: '2026-04-10T01:00:00.000Z',
          rowsMissingFromReadModel: 1,
          rowsBehindSnapshot: 2,
        },
      ];
    }
    if (sql.includes('FROM position_read_models prm')) {
      return [
        {
          accountId: 'acc-1',
          readModelRows: 3,
          latestReadModelSeenAt: '2026-04-10T00:45:00.000Z',
          orphanReadModelRows: 1,
        },
      ];
    }
    throw new Error(`Unexpected SQL in positions scheduler phase 6 coverage test: ${sql}`);
  };

  try {
    const coverage = await repository.getReadModelCoverageByAccountIds(['acc-1', 'acc-2']);
    assert.equal(coverage.get('acc-1')?.snapshotRows, 4);
    assert.equal(coverage.get('acc-1')?.readModelRows, 3);
    assert.equal(coverage.get('acc-1')?.rowsMissingFromReadModel, 1);
    assert.equal(coverage.get('acc-1')?.rowsBehindSnapshot, 2);
    assert.equal(coverage.get('acc-1')?.orphanReadModelRows, 1);
    assert.equal(coverage.get('acc-2')?.snapshotRows, 0);
    assert.equal(coverage.get('acc-2')?.readModelRows, 0);

    const summary = await repository.summarizeReadModelCoverageByAccountIds(['acc-1', 'acc-2']);
    assert.equal(summary.totalAccounts, 2);
    assert.equal(summary.accountsWithSnapshotData, 1);
    assert.equal(summary.accountsWithReadModel, 1);
    assert.equal(summary.accountsWithReadModelDrift, 1);
    assert.equal(summary.snapshotRows, 4);
    assert.equal(summary.readModelRows, 3);
    assert.equal(summary.rowsMissingFromReadModel, 1);
    assert.equal(summary.rowsBehindSnapshot, 2);
    assert.equal(summary.orphanReadModelRows, 1);
  } finally {
    (coreDataSource as any).query = originalQuery;
  }
}

async function testScopedReadModelRebuildUsesSnapshotTruth(): Promise<void> {
  const repository = new PositionReadModelRepository();
  const originalQuery = (coreDataSource as any).query;
  const originalCreateQueryRunner = (coreDataSource as any).createQueryRunner;
  const statements: Array<{ sql: string; params?: unknown[] }> = [];
  let committed = false;

  (coreDataSource as any).query = async (sql: string) => {
    if (sql.includes('FROM scheduler_positions_snapshots') && sql.includes('ORDER BY account_id ASC')) {
      return [
        {
          userId: 'user-1',
          accountId: 'acc-1',
          brokerKey: 'mudrex',
          externalId: 'pos-1',
          statusRank: 1,
          payloadJson: {
            symbol: 'BTCUSDT',
            position_type: 'long',
            quantity: '0.25',
            entry_price: '70000',
            current_price: '70100',
            status: 'open',
            created_at: '2026-04-10T00:00:00.000Z',
            updated_at: '2026-04-10T00:30:00.000Z',
          },
          payloadHash: 'hash-1',
          firstSeenAt: '2026-04-10T00:00:00.000Z',
          lastSeenAt: '2026-04-10T00:30:00.000Z',
        },
        {
          userId: 'user-1',
          accountId: 'acc-1',
          brokerKey: 'mudrex',
          externalId: 'pos-2',
          statusRank: 3,
          payloadJson: {
            symbol: 'ETHUSDT',
            position_type: 'short',
            quantity: '-1',
            entry_price: '3200',
            closed_price: '3150',
            pnl: '50',
            status: 'closed',
            created_at: '2026-04-09T20:00:00.000Z',
            updated_at: '2026-04-09T21:00:00.000Z',
          },
          payloadHash: 'hash-2',
          firstSeenAt: '2026-04-09T20:00:00.000Z',
          lastSeenAt: '2026-04-09T21:00:00.000Z',
        },
      ];
    }
    throw new Error(`Unexpected SQL in positions scheduler phase 6 rebuild test: ${sql}`);
  };

  (coreDataSource as any).createQueryRunner = () => ({
    connect: async () => undefined,
    startTransaction: async () => undefined,
    query: async (sql: string, params?: unknown[]) => {
      statements.push({ sql, params });
      if (sql.includes('SELECT COUNT(*) AS totalRows')) {
        return [{ totalRows: 5 }];
      }
      return [];
    },
    commitTransaction: async () => {
      committed = true;
    },
    rollbackTransaction: async () => undefined,
    release: async () => undefined,
  });

  try {
    const result = await repository.rebuildReadModelsFromSnapshots(['acc-1', 'acc-2']);
    assert.equal(result.requestedAccounts, 2);
    assert.equal(result.processedAccounts, 1);
    assert.equal(result.skippedAccounts, 1);
    assert.deepEqual(result.skippedAccountIds, ['acc-2']);
    assert.equal(result.deletedReadModelRows, 5);
    assert.equal(result.insertedReadModelRows, 2);
    assert.equal(result.snapshotRowsProcessed, 2);
    assert.equal(result.scopes[0].accountId, 'acc-1');
    assert.equal(committed, true);
    assert.ok(
      statements.some((entry) => entry.sql.includes('DELETE FROM position_read_models')),
      'rebuild should clear the scoped read-model rows before repopulating'
    );
    assert.ok(
      statements.some((entry) => entry.sql.includes('INSERT INTO position_read_models')),
      'rebuild should repopulate the scoped read-model rows from snapshots'
    );
  } finally {
    (coreDataSource as any).query = originalQuery;
    (coreDataSource as any).createQueryRunner = originalCreateQueryRunner;
  }
}

async function testPositionsSchedulerDiagnosticsExposeReadModelState(): Promise<void> {
  const service = new PositionsSchedulerService() as any;
  const originalQuery = (coreDataSource as any).query;

  service.positionReadModelRepository = {
    async getReadModelCoverageByAccountIds(accountIds: string[]) {
      assert.deepEqual(accountIds, ['acc-1']);
      return new Map([
        [
          'acc-1',
          {
            accountId: 'acc-1',
            snapshotRows: 4,
            readModelRows: 3,
            rowsMissingFromReadModel: 1,
            rowsBehindSnapshot: 1,
            orphanReadModelRows: 0,
            latestSnapshotSeenAt: new Date('2026-04-10T01:00:00.000Z'),
            latestReadModelSeenAt: new Date('2026-04-10T00:45:00.000Z'),
          },
        ],
      ]);
    },
    async summarizeReadModelCoverageByAccountIds(accountIds: string[]) {
      assert.deepEqual(accountIds, ['acc-1']);
      return {
        totalAccounts: 1,
        accountsWithSnapshotData: 1,
        accountsWithoutSnapshotData: 0,
        accountsWithReadModel: 1,
        accountsWithoutReadModel: 0,
        accountsWithReadModelDrift: 1,
        snapshotRows: 4,
        readModelRows: 3,
        rowsMissingFromReadModel: 1,
        rowsBehindSnapshot: 1,
        orphanReadModelRows: 0,
        latestSnapshotSeenAt: new Date('2026-04-10T01:00:00.000Z'),
        latestReadModelSeenAt: new Date('2026-04-10T00:45:00.000Z'),
      };
    },
  };

  (coreDataSource as any).query = async (sql: string) => {
    if (sql.includes('LEFT JOIN scheduler_sync_checkpoints scp') && sql.includes('LIMIT ? OFFSET ?')) {
      return [
        {
          accountId: 'acc-1',
          userId: 'user-1',
          brokerKey: 'mudrex',
          checkpointAt: '2026-04-10T01:15:00.000Z',
          pendingRecords: 2,
          failedRecords: 1,
          resolvedRecords: 6,
          nextRetryAt: '2026-04-10T01:20:00.000Z',
          lastPendingUpdateAt: '2026-04-10T01:16:00.000Z',
        },
      ];
    }
    if (sql.includes('SELECT COUNT(*) AS total') && sql.includes('FROM broker_accounts ba')) {
      return [{ total: 1 }];
    }
    if (sql.includes('COUNT(*) AS totalAccounts')) {
      return [
        {
          totalAccounts: 1,
          accountsWithCheckpoint: 1,
          accountsWithoutCheckpoint: 0,
          accountsWithPending: 1,
          accountsWithFailed: 1,
          accountsWithRetryScheduled: 1,
          pendingRecords: 2,
          failedRecords: 1,
          resolvedRecords: 6,
          oldestCheckpointAt: '2026-04-10T01:15:00.000Z',
          latestCheckpointAt: '2026-04-10T01:15:00.000Z',
          latestPendingUpdateAt: '2026-04-10T01:16:00.000Z',
          nextRetryAt: '2026-04-10T01:20:00.000Z',
        },
      ];
    }
    if (sql.includes('SELECT ba.id AS accountId')) {
      return [{ accountId: 'acc-1' }];
    }
    throw new Error(`Unexpected SQL in positions scheduler phase 6 service test: ${sql}`);
  };

  try {
    const listResponse = await service.listSchedulerSyncState('admin-user', {
      limit: '20',
      offset: '0',
    });
    assert.equal(listResponse.data.items[0].readModelState, 'behind');
    assert.equal(listResponse.data.items[0].readModelNeedsRebuild, true);
    assert.equal(listResponse.data.items[0].snapshotRows, 4);
    assert.equal(listResponse.data.items[0].readModelRows, 3);
    assert.equal(listResponse.data.items[0].rowsMissingFromReadModel, 1);
    assert.equal(listResponse.data.items[0].rowsBehindSnapshot, 1);

    const summaryResponse = await service.getSchedulerSyncStateSummary('admin-user');
    assert.equal(summaryResponse.data.accountsWithSnapshotData, 1);
    assert.equal(summaryResponse.data.accountsWithReadModel, 1);
    assert.equal(summaryResponse.data.accountsWithReadModelDrift, 1);
    assert.equal(summaryResponse.data.snapshotRows, 4);
    assert.equal(summaryResponse.data.readModelRows, 3);
    assert.equal(summaryResponse.data.rowsMissingFromReadModel, 1);
    assert.equal(summaryResponse.data.rowsBehindSnapshot, 1);
  } finally {
    (coreDataSource as any).query = originalQuery;
  }
}

async function run(): Promise<void> {
  await testPositionsSchedulerConfigExposesRecoveryPolicy();
  await testReadModelCoverageAggregation();
  await testScopedReadModelRebuildUsesSnapshotTruth();
  await testPositionsSchedulerDiagnosticsExposeReadModelState();
  console.log('Positions scheduler phase 6 assertions passed.');
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
