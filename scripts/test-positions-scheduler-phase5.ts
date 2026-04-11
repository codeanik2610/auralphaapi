import assert from 'node:assert/strict';
import { PositionsSchedulerService } from '../src/api/services/PositionsSchedulerService';
import { validatePositionsSchedulerReadModelRebuildBody } from '../src/api/validators/scheduler.validator';
import { coreDataSource } from '../src/database/data-source';

async function testValidatePositionsReadModelRebuildBody(): Promise<void> {
  const payload = validatePositionsSchedulerReadModelRebuildBody({
    accountId: ' acct-1 ',
    ownerUserId: ' owner-1 ',
    brokerKey: ' DELTA_EXCHANGE ',
    onlyDrifted: false,
    limit: 25,
  });

  assert.deepEqual(payload, {
    accountId: 'acct-1',
    ownerUserId: 'owner-1',
    brokerKey: 'delta_exchange',
    onlyDrifted: false,
    limit: 25,
  });

  const rebuildAllPayload = validatePositionsSchedulerReadModelRebuildBody({
    rebuildAll: true,
  });
  assert.equal(rebuildAllPayload.rebuildAll, true);
  assert.equal(rebuildAllPayload.onlyDrifted, true);

  assert.throws(
    () =>
      validatePositionsSchedulerReadModelRebuildBody({
        ownerUserId: 'owner-1',
        rebuildAll: true,
      }),
    /rebuildAll cannot be combined/i
  );
  assert.throws(
    () => validatePositionsSchedulerReadModelRebuildBody({}),
    /accountId, ownerUserId, brokerKey, or rebuildAll=true is required/i
  );
}

async function testScopedPositionsReadModelRebuild(): Promise<void> {
  const service = new PositionsSchedulerService() as any;
  const originalQuery = (coreDataSource as any).query;
  const activityLogEntries: Array<Record<string, unknown>> = [];
  const rebuildAccountCalls: string[][] = [];
  let targetedSummaryCalls = 0;

  service.positionReadModelRepository = {
    async summarizeReadModelCoverageByAccountIds(accountIds: string[]) {
      if (accountIds.length === 2) {
        assert.deepEqual(accountIds, ['acc-1', 'acc-2']);
        return {
          totalAccounts: 2,
          accountsWithSnapshotData: 2,
          accountsWithoutSnapshotData: 0,
          accountsWithReadModel: 2,
          accountsWithoutReadModel: 0,
          accountsWithReadModelDrift: 1,
          snapshotRows: 10,
          readModelRows: 9,
          rowsMissingFromReadModel: 1,
          rowsBehindSnapshot: 1,
          orphanReadModelRows: 0,
          latestSnapshotSeenAt: new Date('2026-04-10T05:05:00.000Z'),
          latestReadModelSeenAt: new Date('2026-04-10T05:03:00.000Z'),
        };
      }
      assert.deepEqual(accountIds, ['acc-1']);
      targetedSummaryCalls += 1;
      return targetedSummaryCalls === 1
        ? {
            totalAccounts: 1,
            accountsWithSnapshotData: 1,
            accountsWithoutSnapshotData: 0,
            accountsWithReadModel: 1,
            accountsWithoutReadModel: 0,
            accountsWithReadModelDrift: 1,
            snapshotRows: 6,
            readModelRows: 5,
            rowsMissingFromReadModel: 1,
            rowsBehindSnapshot: 1,
            orphanReadModelRows: 0,
            latestSnapshotSeenAt: new Date('2026-04-10T05:05:00.000Z'),
            latestReadModelSeenAt: new Date('2026-04-10T05:03:00.000Z'),
          }
        : {
            totalAccounts: 1,
            accountsWithSnapshotData: 1,
            accountsWithoutSnapshotData: 0,
            accountsWithReadModel: 1,
            accountsWithoutReadModel: 0,
            accountsWithReadModelDrift: 0,
            snapshotRows: 6,
            readModelRows: 6,
            rowsMissingFromReadModel: 0,
            rowsBehindSnapshot: 0,
            orphanReadModelRows: 0,
            latestSnapshotSeenAt: new Date('2026-04-10T05:05:00.000Z'),
            latestReadModelSeenAt: new Date('2026-04-10T05:05:00.000Z'),
          };
    },
    async getReadModelCoverageByAccountIds(accountIds: string[]) {
      assert.deepEqual(accountIds, ['acc-1', 'acc-2']);
      return new Map([
        [
          'acc-1',
          {
            accountId: 'acc-1',
            snapshotRows: 6,
            readModelRows: 5,
            rowsMissingFromReadModel: 1,
            rowsBehindSnapshot: 1,
            orphanReadModelRows: 0,
            latestSnapshotSeenAt: new Date('2026-04-10T05:05:00.000Z'),
            latestReadModelSeenAt: new Date('2026-04-10T05:03:00.000Z'),
          },
        ],
        [
          'acc-2',
          {
            accountId: 'acc-2',
            snapshotRows: 4,
            readModelRows: 4,
            rowsMissingFromReadModel: 0,
            rowsBehindSnapshot: 0,
            orphanReadModelRows: 0,
            latestSnapshotSeenAt: new Date('2026-04-10T05:05:00.000Z'),
            latestReadModelSeenAt: new Date('2026-04-10T05:05:00.000Z'),
          },
        ],
      ]);
    },
    async rebuildReadModelsFromSnapshots(accountIds: string[]) {
      rebuildAccountCalls.push(accountIds);
      assert.deepEqual(accountIds, ['acc-1']);
      return {
        requestedAccounts: 1,
        processedAccounts: 1,
        skippedAccounts: 0,
        deletedReadModelRows: 5,
        insertedReadModelRows: 6,
        snapshotRowsProcessed: 6,
        skippedAccountIds: [],
        scopes: [
          {
            userId: 'owner-1',
            accountId: 'acc-1',
            brokerKey: 'delta_exchange',
            snapshotRows: 6,
            deletedReadModelRows: 5,
            insertedReadModelRows: 6,
          },
        ],
      };
    },
  };
  service.activityRepository = {
    async createActivityLog(entry: Record<string, unknown>) {
      activityLogEntries.push(entry);
    },
  };
  service.alertRepository = {
    async findRecentOpenAlertBySource() {
      return null;
    },
    async createAlert() {
      throw new Error('createAlert should not be called on successful rebuild');
    },
  };

  (coreDataSource as any).query = async (sql: string) => {
    if (sql.includes('FROM broker_accounts ba') && sql.includes('ORDER BY ba.updatedAt DESC, ba.id DESC')) {
      return [
        {
          accountId: 'acc-1',
          ownerUserId: 'owner-1',
          brokerKey: 'delta_exchange',
        },
        {
          accountId: 'acc-2',
          ownerUserId: 'owner-1',
          brokerKey: 'delta_exchange',
        },
      ];
    }
    throw new Error(`Unexpected SQL in positions scheduler phase 5 scoped rebuild test: ${sql}`);
  };

  try {
    const response = await service.rebuildReadModel('admin-1', {
      ownerUserId: 'owner-1',
      brokerKey: 'delta_exchange',
    });

    assert.equal(response.data.state, 'applied');
    assert.equal(response.data.scope, 'owner');
    assert.equal(response.data.onlyDrifted, true);
    assert.equal(response.data.requestedAccounts, 2);
    assert.equal(response.data.targetedAccounts, 1);
    assert.equal(response.data.beforeCoverage.accountsWithReadModelDrift, 1);
    assert.equal(response.data.afterCoverage.accountsWithReadModelDrift, 0);
    assert.equal(response.data.rebuildResult.processedAccounts, 1);
    assert.equal(response.data.rebuildResult.insertedReadModelRows, 6);
    assert.deepEqual(rebuildAccountCalls, [['acc-1']]);
    assert.match(response.data.message, /owner owner-1/i);
    assert.match(response.data.message, /targeted 1 drifted account/i);
    assert.equal(activityLogEntries.length, 1);
    assert.equal(activityLogEntries[0]?.title, 'Positions read-model rebuild completed');
  } finally {
    (coreDataSource as any).query = originalQuery;
  }
}

async function testNoopPositionsReadModelRebuildWhenScopeIsHealthy(): Promise<void> {
  const service = new PositionsSchedulerService() as any;
  const originalQuery = (coreDataSource as any).query;
  let rebuildCalled = false;

  service.positionReadModelRepository = {
    async summarizeReadModelCoverageByAccountIds(accountIds: string[]) {
      assert.deepEqual(accountIds, ['acc-3']);
      return {
        totalAccounts: 1,
        accountsWithSnapshotData: 1,
        accountsWithoutSnapshotData: 0,
        accountsWithReadModel: 1,
        accountsWithoutReadModel: 0,
        accountsWithReadModelDrift: 0,
        snapshotRows: 3,
        readModelRows: 3,
        rowsMissingFromReadModel: 0,
        rowsBehindSnapshot: 0,
        orphanReadModelRows: 0,
        latestSnapshotSeenAt: new Date('2026-04-10T05:05:00.000Z'),
        latestReadModelSeenAt: new Date('2026-04-10T05:05:00.000Z'),
      };
    },
    async getReadModelCoverageByAccountIds(accountIds: string[]) {
      assert.deepEqual(accountIds, ['acc-3']);
      return new Map([
        [
          'acc-3',
          {
            accountId: 'acc-3',
            snapshotRows: 3,
            readModelRows: 3,
            rowsMissingFromReadModel: 0,
            rowsBehindSnapshot: 0,
            orphanReadModelRows: 0,
            latestSnapshotSeenAt: new Date('2026-04-10T05:05:00.000Z'),
            latestReadModelSeenAt: new Date('2026-04-10T05:05:00.000Z'),
          },
        ],
      ]);
    },
    async rebuildReadModelsFromSnapshots() {
      rebuildCalled = true;
      throw new Error('rebuildReadModelsFromSnapshots should not run for a healthy scope');
    },
  };
  service.activityRepository = {
    async createActivityLog() {
      return undefined;
    },
  };
  service.alertRepository = {
    async findRecentOpenAlertBySource() {
      return null;
    },
    async createAlert() {
      throw new Error('createAlert should not be called for noop rebuild');
    },
  };

  (coreDataSource as any).query = async (sql: string) => {
    if (sql.includes('FROM broker_accounts ba') && sql.includes('ORDER BY ba.updatedAt DESC, ba.id DESC')) {
      return [
        {
          accountId: 'acc-3',
          ownerUserId: 'owner-3',
          brokerKey: 'mudrex',
        },
      ];
    }
    throw new Error(`Unexpected SQL in positions scheduler phase 5 noop test: ${sql}`);
  };

  try {
    const response = await service.rebuildReadModel('admin-1', {
      accountId: 'acc-3',
      brokerKey: 'mudrex',
    });

    assert.equal(response.data.state, 'noop');
    assert.equal(response.data.scope, 'account');
    assert.equal(response.data.requestedAccounts, 1);
    assert.equal(response.data.targetedAccounts, 0);
    assert.equal(response.data.beforeCoverage.accountsWithReadModelDrift, 0);
    assert.equal(response.data.afterCoverage.accountsWithReadModelDrift, 0);
    assert.match(response.data.message, /Nothing was rebuilt/i);
    assert.equal(rebuildCalled, false);
  } finally {
    (coreDataSource as any).query = originalQuery;
  }
}

async function run(): Promise<void> {
  await testValidatePositionsReadModelRebuildBody();
  await testScopedPositionsReadModelRebuild();
  await testNoopPositionsReadModelRebuildWhenScopeIsHealthy();
  console.log('Positions scheduler phase 5 assertions passed.');
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
