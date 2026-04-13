import assert from 'node:assert/strict';
import { runSuiteSteps } from './_support/run-script-suite';

// Consolidated module suite.
// Coverage note: queue payload execution for manual positions runs now follows the
// same system-actor model as orders/funds while keeping the scheduler record user-owned.

async function positions_schedulerGuard01(): Promise<void> {
  const { PositionsSchedulerService } = await import("../src/api/services/PositionsSchedulerService");
  const { SchedulerOverviewService } = await import("../src/api/services/SchedulerOverviewService");
  const { coreDataSource } = await import("../src/database/data-source");

function createConfig(overrides: Record<string, unknown> = {}) {
  return {
    key: 'positions-sync',
    name: 'Positions Sync',
    description: 'Legacy positions scheduler config',
    enabled: true,
    cronExpression: '0 1 * * *',
    timezone: 'UTC',
    runAt: '01:00',
    intervalDays: 1,
    batchSize: 200,
    schedulerType: 'user',
    config: {
      sources: ['positions'],
      retentionDays: 30,
      lookbackDays: 90,
    },
    lastStartedAt: null,
    lastFinishedAt: null,
    lastStatus: null,
    lastError: null,
    runningLockUntil: null,
    createdAt: new Date('2026-04-09T00:00:00.000Z'),
    updatedAt: new Date('2026-04-09T00:00:00.000Z'),
    ...overrides,
  };
}

async function testPositionsSchedulerOwnershipNormalization(): Promise<void> {
  const service = new PositionsSchedulerService() as any;
  const storedConfig = createConfig();
  const updateCalls: Array<Record<string, unknown>> = [];
  let globalPendingChecks = 0;
  let actorPendingChecks = 0;
  let globalRunningChecks = 0;
  let actorRunningChecks = 0;

  service.schedulerConfigRepository = {
    async createIfMissing() {
      return storedConfig as any;
    },
    async updateByKey(key: string, payload: Record<string, unknown>) {
      assert.equal(key, 'positions-sync');
      updateCalls.push(payload);
      Object.assign(storedConfig, payload);
      return storedConfig as any;
    },
  } as any;
  service.schedulerCommandRepository = {
    async findLatestBySchedulerKeyAndTypeInStatuses(
      schedulerKey: string,
      commandType: string,
      statuses: string[]
    ) {
      globalPendingChecks += 1;
      assert.equal(schedulerKey, 'positions-sync');
      assert.equal(commandType, 'run_now');
      assert.deepEqual(statuses, ['Pending', 'Processing']);
      return null;
    },
    async findLatestBySchedulerKeyAndTypeAndActorInStatuses() {
      actorPendingChecks += 1;
      return null;
    },
    async createCommand(payload: Record<string, unknown>) {
      return { id: 'cmd-1', ...payload };
    },
    async cancelPendingBySchedulerKey() {
      return 0;
    },
  } as any;
  service.schedulerRunLogRepository = {
    async hasRunningRun(schedulerKey: string) {
      globalRunningChecks += 1;
      assert.equal(schedulerKey, 'positions-sync');
      return false;
    },
    async hasRunningRunBySchedulerKeyAndActor() {
      actorRunningChecks += 1;
      return false;
    },
    async createRun(payload: Record<string, unknown>) {
      return payload;
    },
  } as any;
  service.activityRepository = {} as any;
  service.alertRepository = {} as any;
  (service as any).logSchedulerActivity = async () => {};
  (service as any).emitSchedulerFailureAlert = async () => {};

  const getResponse = await service.getSchedulerConfig('user-1');
  assert.equal(getResponse.data.schedulerType, 'global');
  assert.equal(storedConfig.schedulerType, 'global');
  assert.ok(
    updateCalls.some(
      (payload) => String(payload.schedulerType || '').trim().toLowerCase() === 'global'
    ),
    'getSchedulerConfig should normalize legacy positions ownership back to global'
  );

  await assert.rejects(
    () =>
      service.updateSchedulerConfig('user-1', {
        schedulerType: 'user',
      } as any),
    /global system scheduler/
  );

  const runResponse = await service.runNow('user-1');
  assert.equal(runResponse.data.queued, true);
  assert.equal(globalPendingChecks, 1);
  assert.equal(actorPendingChecks, 0);
  assert.equal(globalRunningChecks, 1);
  assert.equal(actorRunningChecks, 0);
}

async function testSchedulerOverviewKeepsPositionsGlobal(): Promise<void> {
  const service = new SchedulerOverviewService() as any;
  service.userTimeZoneService = {
    async resolveUserTimeZone(userId: string) {
      assert.equal(userId, 'user-7');
      return 'UTC';
    },
  } as any;

  const originalQuery = (coreDataSource as any).query;
  const capturedQueries: Array<{ sql: string; params: unknown[] }> = [];

  (coreDataSource as any).query = async (sql: string, params: unknown[] = []) => {
    capturedQueries.push({ sql, params });

    if (sql.includes('FROM scheduler_configs')) {
      return [
        {
          key: 'positions-sync',
          name: 'Positions Sync',
          enabled: 1,
          last_finished_at: '2026-04-09T01:00:00.000Z',
          last_status: 'Completed',
          last_error: null,
          scheduler_type: 'user',
        },
      ];
    }

    if (sql.includes('FROM scheduler_user_configs')) {
      assert.deepEqual(params, ['user-7']);
      return [
        {
          key: 'positions-sync',
          name: 'Positions Sync Personal',
          enabled: 0,
          last_finished_at: '2026-04-08T01:00:00.000Z',
          last_status: 'Failed',
          last_error: 'Should not override',
          scheduler_type: 'user',
        },
      ];
    }

    return [];
  };

  try {
    const response = await service.getOverview('user-7');
    const item = response.data.items.find((entry: any) => entry.key === 'positions-sync');
    assert.ok(item, 'positions-sync should remain present in scheduler overview');
    assert.equal(item?.enabled, true);
    assert.equal(item?.name, 'Positions Sync');
    assert.equal(item?.status, 'idle');
    assert.equal(
      item?.lastStatus,
      'Completed',
      'positions-sync should keep the global scheduler row rather than a user overlay'
    );
    assert.ok(
      capturedQueries.some((entry) => entry.sql.includes('FROM scheduler_user_configs')),
      'overview should still inspect user rows for other schedulers'
    );
  } finally {
    (coreDataSource as any).query = originalQuery;
  }
}

async function run(): Promise<void> {
  await testPositionsSchedulerOwnershipNormalization();
  await testSchedulerOverviewKeepsPositionsGlobal();
  console.log('Positions scheduler phase 1 assertions passed.');
}

  await run();
}

async function positions_schedulerGuard02(): Promise<void> {
  const { InternalPositionsSyncService } = await import("../src/api/services/InternalPositionsSyncService");
  const { coreDataSource } = await import("../src/database/data-source");
  const { env } = await import("../src/env");

async function runSystemInfraCoverageAssertions(): Promise<void> {
  const service = new InternalPositionsSyncService();
  const routingCalls: Array<{ userId: string; brokerKey: string; accountId: string }> = [];
  const upsertCalls: Array<{ userId: string; accountId: string; brokerKey: string; items: unknown[] }> = [];
  let getAllActiveCalls = 0;
  let getActiveSystemCalls = 0;

  (service as any).brokerAccountRepository = {
    async getAllActiveBrokerAccounts() {
      getAllActiveCalls += 1;
      return [
        {
          id: 'account-1',
          userId: 'user-1',
          brokerKey: 'binance',
          createdAt: new Date('2026-04-01T00:00:00.000Z'),
        },
        {
          id: 'account-2',
          userId: 'user-2',
          brokerKey: 'binance',
          createdAt: new Date('2026-04-02T00:00:00.000Z'),
        },
        {
          id: 'account-system',
          userId: null,
          brokerKey: 'delta_exchange',
          createdAt: new Date('2026-04-03T00:00:00.000Z'),
        },
      ];
    },
    async getActiveSystemBrokerAccounts() {
      getActiveSystemCalls += 1;
      return [];
    },
    async getActiveBrokerAccounts() {
      throw new Error('runBatch should group infra-wide positions sync from getAllActiveBrokerAccounts');
    },
  };
  (service as any).brokerAccountRoutingService = {
    async resolve(userId: string, brokerKey: string, accountId: string) {
      routingCalls.push({ userId, brokerKey, accountId });
      return { userId, brokerKey, accountId };
    },
  };
  (service as any).brokerRuntimeRegistry = {
    getPositionsAdapter() {
      return {
        async getPositions() {
          return {
            data: [
              {
                id: 'position-1',
                symbol: 'BTCUSDT',
                status: 'open',
                quantity: '1',
                entry_price: '100',
              },
            ],
          };
        },
        async getPositionHistory() {
          return { data: [] };
        },
      };
    },
  };
  (service as any).exchangeAssetUpdateLogRepository = {
    async createMany() {},
  };
  (service as any).positionReadModelRepository = {
    async upsertReadModels() {},
    async markPositionsClosed() {},
  };
  (service as any).marketPriceBinanceRepository = {
    async getBySymbols() {
      return [];
    },
  };
  (service as any).operationalEventService = {
    async logActivity() {},
    async emitFailureAlert() {},
  };
  (service as any).suggestedTradesService = {
    async syncExecutionForPositionUpdates() {},
  };
  (service as any).ensureSyncPositionsSnapshotTable = async () => {};
  (service as any).ensureCheckpointTable = async () => {};
  (service as any).getCheckpoint = async () => null;
  (service as any).saveCheckpoint = async () => {};
  (service as any).upsertPositionSnapshotsFromItems = async (
    userId: string,
    accountId: string,
    brokerKey: string,
    items: unknown[]
  ) => {
    upsertCalls.push({ userId, accountId, brokerKey, items });
    return {
      inserted: items.length,
      updated: 0,
      skipped: 0,
      symbols: ['BTCUSDT'],
    };
  };

  const originalQuery = (coreDataSource as any).query;
  (coreDataSource as any).query = async (sql: string) => {
    const statement = String(sql || '');
    if (statement.includes('SELECT NOW() AS now')) {
      return [{ now: new Date('2026-04-09T00:00:00.000Z') }];
    }
    if (statement.includes('SELECT id, external_id, symbol, status, payload_json')) {
      return [];
    }
    if (statement.includes('UPDATE scheduler_positions_snapshots')) {
      return [{ affectedRows: 0 }];
    }
    throw new Error(`Unexpected SQL in positions scheduler phase 2 test: ${statement}`);
  };

  try {
    const result = await service.runBatch({
      targetUserIds: [env.scheduler.systemUserId],
      lookbackDays: 7,
      historyWindowDays: 1,
    });

    assert.equal(getAllActiveCalls, 1);
    assert.equal(getActiveSystemCalls, 0);
    assert.deepEqual(
      routingCalls.map((call) => call.userId),
      ['user-1', 'user-2']
    );
    assert.deepEqual(
      upsertCalls.map((call) => call.userId),
      ['user-1', 'user-2']
    );
    assert.equal(result.processedUsers, 2);
    assert.equal(result.succeededUsers, 2);
    assert.equal(result.failedUsers, 0);
    assert.equal(result.processedAccounts, 2);
    assert.equal(result.insertedRecords, 2);
    assert.equal(result.failures.length, 0);
  } finally {
    (coreDataSource as any).query = originalQuery;
  }
}

async function run(): Promise<void> {
  await runSystemInfraCoverageAssertions();
  console.log('Positions scheduler phase 2 assertions passed.');
}

  await run();
}

async function positions_schedulerGuard03(): Promise<void> {
  const { PositionsSchedulerService } = await import("../src/api/services/PositionsSchedulerService");
  const { coreDataSource } = await import("../src/database/data-source");

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

  await run();
}

async function positions_schedulerGuard04(): Promise<void> {
  const { BrokerPositionsFacadeService } = await import("../src/api/services/BrokerPositionsFacadeService");
  const { coreDataSource } = await import("../src/database/data-source");

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

  await run();
}

async function positions_schedulerGuard05(): Promise<void> {
  const { PositionsSchedulerService } = await import("../src/api/services/PositionsSchedulerService");
  const { validatePositionsSchedulerReadModelRebuildBody } = await import("../src/api/validators/scheduler.validator");
  const { coreDataSource } = await import("../src/database/data-source");

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

  await run();
}

async function positions_schedulerGuard06(): Promise<void> {
  const { PositionsSchedulerService } = await import("../src/api/services/PositionsSchedulerService");
  const { coreDataSource } = await import("../src/database/data-source");
  const { PositionReadModelRepository } = await import("../src/database/repositories/PositionReadModelRepository");

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

  await run();
}

async function positions_schedulerGuard07(): Promise<void> {
  const { PositionsSchedulerService } = await import("../src/api/services/PositionsSchedulerService");
  const { coreDataSource } = await import("../src/database/data-source");

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

  await run();
}

async function positions_schedulerGuard08(): Promise<void> {
  const { mkdtemp, readFile, rm, writeFile } = await import("node:fs/promises");
  const { default: os } = await import("node:os");
  const { default: path } = await import("node:path");
  const { spawnSync } = await import("node:child_process");
  const { PositionsSchedulerController } = await import("../src/api/controllers/PositionsSchedulerController");

function createSuccess<T>(data: T) {
  return { success: true as const, data };
}

const adminAuthReq = { authUser: { sub: 'user-1', role: 'admin' } } as any;
const authReq = { authUser: { sub: 'user-1', role: 'user' } } as any;
const unauthReq = {} as any;

async function assertAdminRoleRequired(
  run: () => Promise<unknown>,
  message = 'Admin role is required'
): Promise<void> {
  await assert.rejects(
    run,
    (error: unknown) =>
      error instanceof Error &&
      error.message === message &&
      (error as { httpCode?: number }).httpCode === 403
  );
}

async function assertAuthRequired(
  run: () => Promise<unknown>,
  message = 'Authentication required'
): Promise<void> {
  await assert.rejects(
    run,
    (error: unknown) =>
      error instanceof Error &&
      error.message === message &&
      (error as { httpCode?: number }).httpCode === 401
  );
}

async function testPositionsSchedulerControllerStaysAdminOnly(): Promise<void> {
  const controller = new PositionsSchedulerController() as any;
  const calls: Array<{ method: string; args: unknown[] }> = [];

  controller.positionsSchedulerService = {
    async getSchedulerConfig(...args: unknown[]) {
      calls.push({ method: 'getSchedulerConfig', args });
      return createSuccess({ args });
    },
    async updateSchedulerConfig(...args: unknown[]) {
      calls.push({ method: 'updateSchedulerConfig', args });
      return createSuccess({ args });
    },
    async runNow(...args: unknown[]) {
      calls.push({ method: 'runNow', args });
      return createSuccess({ args });
    },
    async listReadModelRecoveryHistory(...args: unknown[]) {
      calls.push({ method: 'listReadModelRecoveryHistory', args });
      return createSuccess({ args });
    },
    async pauseScheduler(...args: unknown[]) {
      calls.push({ method: 'pauseScheduler', args });
      return createSuccess({ args });
    },
    async resumeScheduler(...args: unknown[]) {
      calls.push({ method: 'resumeScheduler', args });
      return createSuccess({ args });
    },
    async stopScheduler(...args: unknown[]) {
      calls.push({ method: 'stopScheduler', args });
      return createSuccess({ args });
    },
    async restartScheduler(...args: unknown[]) {
      calls.push({ method: 'restartScheduler', args });
      return createSuccess({ args });
    },
    async purgeSchedulerLogs(...args: unknown[]) {
      calls.push({ method: 'purgeSchedulerLogs', args });
      return createSuccess({ args });
    },
    async getSchedulerPurgePreview(...args: unknown[]) {
      calls.push({ method: 'getSchedulerPurgePreview', args });
      return createSuccess({ args });
    },
    async listSchedulerRuns(...args: unknown[]) {
      calls.push({ method: 'listSchedulerRuns', args });
      return createSuccess({ args });
    },
    async listSchedulerSyncState(...args: unknown[]) {
      calls.push({ method: 'listSchedulerSyncState', args });
      return createSuccess({ args });
    },
    async getSchedulerSyncStateSummary(...args: unknown[]) {
      calls.push({ method: 'getSchedulerSyncStateSummary', args });
      return createSuccess({ args });
    },
    async getSchedulerRunProgress(...args: unknown[]) {
      calls.push({ method: 'getSchedulerRunProgress', args });
      return createSuccess({ args });
    },
    async listSchedulerRunUpdates(...args: unknown[]) {
      calls.push({ method: 'listSchedulerRunUpdates', args });
      return createSuccess({ args });
    },
    async exportSchedulerRunUpdates(...args: unknown[]) {
      calls.push({ method: 'exportSchedulerRunUpdates', args });
      return createSuccess({ args });
    },
  };

  const cases: Array<{
    label: string;
    method: string;
    args?: unknown[];
    expectedArgs: unknown[];
  }> = [
    {
      label: 'config',
      method: 'getConfig',
      expectedArgs: ['user-1'],
    },
    {
      label: 'update',
      method: 'updateConfig',
      args: [{ enabled: true }],
      expectedArgs: ['user-1', { enabled: true }],
    },
    {
      label: 'run',
      method: 'runNow',
      expectedArgs: ['user-1'],
    },
    {
      label: 'read model recovery history',
      method: 'listReadModelRecoveryHistory',
      args: ['10', '5', 'warning'],
      expectedArgs: [
        'user-1',
        {
          limit: '10',
          offset: '5',
          status: 'warning',
        },
      ],
    },
    {
      label: 'pause',
      method: 'pause',
      expectedArgs: ['user-1'],
    },
    {
      label: 'resume',
      method: 'resume',
      expectedArgs: ['user-1'],
    },
    {
      label: 'stop',
      method: 'stop',
      expectedArgs: ['user-1'],
    },
    {
      label: 'restart',
      method: 'restart',
      expectedArgs: ['user-1'],
    },
    {
      label: 'purge logs',
      method: 'purgeLogs',
      expectedArgs: ['user-1'],
    },
    {
      label: 'purge preview',
      method: 'purgeLogsPreview',
      expectedArgs: ['user-1'],
    },
    {
      label: 'runs',
      method: 'listRuns',
      args: ['10', '5'],
      expectedArgs: ['user-1', { limit: '10', offset: '5' }],
    },
    {
      label: 'sync state',
      method: 'listSyncState',
      args: ['10', '5', 'acc-1', 'owner-1', 'mudrex'],
      expectedArgs: [
        'user-1',
        {
          limit: '10',
          offset: '5',
          accountId: 'acc-1',
          ownerUserId: 'owner-1',
          brokerKey: 'mudrex',
        },
      ],
    },
    {
      label: 'sync state summary',
      method: 'getSyncStateSummary',
      expectedArgs: ['user-1'],
    },
    {
      label: 'run progress',
      method: 'getRunProgress',
      args: ['run-1'],
      expectedArgs: ['user-1', 'run-1'],
    },
    {
      label: 'run updates',
      method: 'listRunUpdates',
      args: ['run-1', '25', '0', 'upsert', 'checkpoint', 'BTCUSDT', 'symbol', 'desc'],
      expectedArgs: [
        'user-1',
        'run-1',
        {
          limit: '25',
          offset: '0',
          actionType: 'upsert',
          source: 'checkpoint',
          symbol: 'BTCUSDT',
          sortBy: 'symbol',
          sortOrder: 'desc',
        },
      ],
    },
    {
      label: 'run updates export',
      method: 'exportRunUpdates',
      args: ['run-1', 'upsert', 'checkpoint', 'BTCUSDT', 'symbol', 'desc'],
      expectedArgs: [
        'user-1',
        'run-1',
        {
          actionType: 'upsert',
          source: 'checkpoint',
          symbol: 'BTCUSDT',
          sortBy: 'symbol',
          sortOrder: 'desc',
        },
      ],
    },
  ];

  for (const testCase of cases) {
    const beforeCalls = calls.length;
    await assertAuthRequired(() => controller[testCase.method](unauthReq, ...(testCase.args || [])));
    assert.equal(
      calls.length,
      beforeCalls,
      `${testCase.label} should not call the service when authentication is missing`
    );

    await assertAdminRoleRequired(() => controller[testCase.method](authReq, ...(testCase.args || [])));
    assert.equal(
      calls.length,
      beforeCalls,
      `${testCase.label} should not call the service for non-admin users`
    );

    const response = await controller[testCase.method](adminAuthReq, ...(testCase.args || []));
    assert.deepEqual(
      response.data.args,
      testCase.expectedArgs,
      `${testCase.label} should pass the canonical admin args through`
    );
    assert.equal(
      calls.length,
      beforeCalls + 1,
      `${testCase.label} should call the service exactly once for admin users`
    );
  }
}

async function testDeprecatedPositionsSyncAliasIsRetired(): Promise<void> {
  const source = await readFile(path.join(process.cwd(), 'src', 'loaders', 'ExpressLoader.ts'), 'utf8');
  assert.ok(
    !source.includes('/scheduler/positions-sync'),
    'ExpressLoader should no longer rewrite the deprecated /scheduler/positions-sync alias'
  );
  assert.ok(
    source.includes('/scheduler/orders-sync'),
    'ExpressLoader should keep the remaining supported orders alias intact'
  );
}

async function testFinalSignoffScriptCanProduceReadyArtifact(): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'positions-scheduler-phase8-'));
  const gateFile = path.join(tempDir, 'gate.json');
  const outputFile = path.join(tempDir, 'signoff.json');

  try {
    await writeFile(
      gateFile,
      `${JSON.stringify(
        {
          decision: 'ready',
          startedAt: '2026-04-10T00:00:00.000Z',
          finishedAt: '2026-04-10T00:10:00.000Z',
          liveChecksEnabled: false,
          totals: {
            total: 3,
            passed: 3,
            failed: 0,
            skipped: 0,
          },
          results: [
            'backend-positions-scheduler-suite',
            'backend-positions-scheduler-operational-audit',
            'backend-positions-scheduler-eslint',
          ].map((key) => ({
            key,
            label: key,
            status: 'passed',
          })),
        },
        null,
        2
      )}\n`,
      'utf8'
    );

    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'scripts/signoffs/signoff-positions-scheduler.ts'],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          POSITIONS_SCHEDULER_SIGNOFF_GATE_FILE: gateFile,
          POSITIONS_SCHEDULER_SIGNOFF_OUTPUT_FILE: outputFile,
          POSITIONS_SCHEDULER_SIGNOFF_DIAGNOSTICS_VERIFIED: 'true',
          POSITIONS_SCHEDULER_SIGNOFF_PRODUCT_TRUST_VERIFIED: 'true',
          POSITIONS_SCHEDULER_SIGNOFF_REBUILD_DRILL_VERIFIED: 'true',
          POSITIONS_SCHEDULER_SIGNOFF_RECOVERY_HISTORY_VERIFIED: 'true',
          POSITIONS_SCHEDULER_SIGNOFF_ACCESS_REVIEW_VERIFIED: 'true',
          POSITIONS_SCHEDULER_SIGNOFF_APPROVER: 'Codex',
        },
        encoding: 'utf8',
      }
    );

    assert.equal(result.status, 0, result.stderr || result.stdout || 'signoff script should succeed');
    const output = JSON.parse(await readFile(outputFile, 'utf8')) as Record<string, unknown>;
    assert.equal(output.decision, 'ready');
    assert.equal(output.approver, 'Codex');
    assert.equal((output.checks as Record<string, unknown>).recoveryHistoryVerified, true);
    assert.equal((output.checks as Record<string, unknown>).accessReviewVerified, true);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function testPositionsSchedulerLiveProofCanProduceReadyArtifact(): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'positions-scheduler-proof-phase8-'));
  const gateFile = path.join(tempDir, 'gate.json');
  const signoffFile = path.join(tempDir, 'signoff.json');
  const proofFile = path.join(tempDir, 'proof.json');
  const gateScript = path.join(tempDir, 'release-gate.stub.ts');
  const signoffScript = path.join(tempDir, 'signoff.stub.ts');

  const readyGateSummary = {
    decision: 'ready',
    generatedAt: '2026-04-10T12:00:00.000Z',
    liveChecksEnabled: true,
    totals: {
      total: 5,
      passed: 5,
      failed: 0,
      skipped: 0,
    },
    results: [
      'backend-positions-scheduler-suite',
      'backend-positions-scheduler-operational-audit',
      'backend-positions-scheduler-eslint',
      'backend-positions-health',
      'backend-positions-scheduler-health',
    ].map((key) => ({
      key,
      label: key,
      status: 'passed',
    })),
  };

  const readySignoffSummary = {
    decision: 'ready',
    generatedAt: '2026-04-10T12:05:00.000Z',
    approver: 'codex-phase8',
    checks: {
      gateReady: true,
      requiredSuitesPassed: true,
      liveHealthReviewed: true,
      diagnosticsVerified: true,
      productTrustVerified: true,
      rebuildDrillVerified: true,
      recoveryHistoryVerified: true,
      accessReviewVerified: true,
    },
    evidence: {
      workflowUrl: 'https://example.com/workflows/positions-scheduler',
      dashboardUrl: 'https://example.com/dashboards/positions-scheduler',
      runbookUrl: 'https://example.com/runbooks/positions-scheduler',
      releaseNoteUrl: 'https://example.com/releases/positions-scheduler',
      recoveryEvidenceUrl: 'https://example.com/evidence/positions-read-model-recovery',
    },
  };

  try {
    await writeFile(
      gateScript,
      `import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const outputFile = path.resolve(process.cwd(), String(process.env.POSITIONS_SCHEDULER_RELEASE_GATE_OUTPUT_FILE || '').trim());

async function run(): Promise<void> {
  assert.equal(process.env.POSITIONS_SCHEDULER_RUN_LIVE_CHECKS, 'true');
  assert.ok(outputFile, 'POSITIONS_SCHEDULER_RELEASE_GATE_OUTPUT_FILE must be provided');
  await mkdir(path.dirname(outputFile), { recursive: true });
  const summary = ${JSON.stringify(readyGateSummary, null, 2)};
  await writeFile(outputFile, \`\${JSON.stringify(summary, null, 2)}\\n\`, 'utf8');
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
`,
      'utf8'
    );

    await writeFile(
      signoffScript,
      `import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const gateFile = path.resolve(process.cwd(), String(process.env.POSITIONS_SCHEDULER_SIGNOFF_GATE_FILE || '').trim());
const outputFile = path.resolve(process.cwd(), String(process.env.POSITIONS_SCHEDULER_SIGNOFF_OUTPUT_FILE || '').trim());

async function run(): Promise<void> {
  assert.equal(process.env.POSITIONS_SCHEDULER_SIGNOFF_REQUIRE_LIVE_HEALTH, 'true');
  assert.equal(
    process.env.POSITIONS_SCHEDULER_SIGNOFF_RECOVERY_EVIDENCE_URL,
    'https://example.com/evidence/positions-read-model-recovery'
  );
  const rawGate = await readFile(gateFile, 'utf8');
  const gate = JSON.parse(rawGate) as { decision?: string; liveChecksEnabled?: boolean };
  assert.equal(gate.decision, 'ready');
  assert.equal(gate.liveChecksEnabled, true);
  await mkdir(path.dirname(outputFile), { recursive: true });
  const summary = ${JSON.stringify(readySignoffSummary, null, 2)};
  await writeFile(outputFile, \`\${JSON.stringify(summary, null, 2)}\\n\`, 'utf8');
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
`,
      'utf8'
    );

    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'scripts/proofs/proof-positions-scheduler-live.ts'],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          POSITIONS_SCHEDULER_PROOF_RELEASE_GATE_SCRIPT: gateScript,
          POSITIONS_SCHEDULER_PROOF_SIGNOFF_SCRIPT: signoffScript,
          POSITIONS_SCHEDULER_RELEASE_GATE_OUTPUT_FILE: gateFile,
          POSITIONS_SCHEDULER_SIGNOFF_OUTPUT_FILE: signoffFile,
          POSITIONS_SCHEDULER_PROOF_OUTPUT_FILE: proofFile,
          POSITIONS_SCHEDULER_SIGNOFF_APPROVER: 'codex-phase8',
          POSITIONS_SCHEDULER_SIGNOFF_DIAGNOSTICS_VERIFIED: 'true',
          POSITIONS_SCHEDULER_SIGNOFF_PRODUCT_TRUST_VERIFIED: 'true',
          POSITIONS_SCHEDULER_SIGNOFF_REBUILD_DRILL_VERIFIED: 'true',
          POSITIONS_SCHEDULER_SIGNOFF_RECOVERY_HISTORY_VERIFIED: 'true',
          POSITIONS_SCHEDULER_SIGNOFF_ACCESS_REVIEW_VERIFIED: 'true',
          POSITIONS_SCHEDULER_SIGNOFF_RECOVERY_EVIDENCE_URL:
            'https://example.com/evidence/positions-read-model-recovery',
        },
        encoding: 'utf8',
      }
    );

    assert.equal(
      result.status,
      0,
      result.stderr || result.stdout || 'positions scheduler live proof should succeed'
    );

    const output = JSON.parse(await readFile(proofFile, 'utf8')) as Record<string, unknown>;
    assert.equal(output.decision, 'ready');
    assert.equal(output.approver, 'codex-phase8');
    assert.equal(output.gateDecision, 'ready');
    assert.equal(output.signoffDecision, 'ready');
    assert.equal(output.liveChecksEnabled, true);
    assert.equal(output.releaseGateFile, path.resolve(process.cwd(), gateFile));
    assert.equal(output.signoffFile, path.resolve(process.cwd(), signoffFile));
    assert.equal(output.proofOutputFile, path.resolve(process.cwd(), proofFile));
    assert.deepEqual(output.gateTotals, readyGateSummary.totals);

    const checks = (output.checks || {}) as Record<string, unknown>;
    assert.equal(checks.liveHealthReviewed, true);
    assert.equal(checks.recoveryHistoryVerified, true);

    const evidence = (output.evidence || {}) as Record<string, unknown>;
    assert.equal(
      evidence.recoveryEvidenceUrl,
      readySignoffSummary.evidence.recoveryEvidenceUrl
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function testPhase8SourceMarkersStayWired(): Promise<void> {
  const releaseGateSource = await readFile(
    path.join(process.cwd(), 'scripts', 'release-gates', 'release-gate-positions-scheduler.ts'),
    'utf8'
  );
  const signoffSource = await readFile(
    path.join(process.cwd(), 'scripts', 'signoffs', 'signoff-positions-scheduler.ts'),
    'utf8'
  );
  const operationalAuditSource = await readFile(
    path.join(process.cwd(), 'scripts', 'test-operational-audit.ts'),
    'utf8'
  );

  assert.equal(
    releaseGateSource.includes('backend-positions-scheduler-suite'),
    true,
    'release gate must include the positions scheduler module suite'
  );
  assert.equal(
    signoffSource.includes('backend-positions-scheduler-suite'),
    true,
    'positions scheduler signoff must require the module gate result'
  );
  assert.equal(
    operationalAuditSource.includes('"proof:positions-scheduler-live"'),
    true,
    'operational audit must treat the positions scheduler proof workflow as required'
  );
}

async function run(): Promise<void> {
  await testPositionsSchedulerControllerStaysAdminOnly();
  await testDeprecatedPositionsSyncAliasIsRetired();
  await testFinalSignoffScriptCanProduceReadyArtifact();
  await testPositionsSchedulerLiveProofCanProduceReadyArtifact();
  await testPhase8SourceMarkersStayWired();
  console.log('Positions scheduler phase 8 assertions passed.');
}

  await run();
}

const suiteSteps = {
  "01": positions_schedulerGuard01,
  "02": positions_schedulerGuard02,
  "03": positions_schedulerGuard03,
  "04": positions_schedulerGuard04,
  "05": positions_schedulerGuard05,
  "06": positions_schedulerGuard06,
  "07": positions_schedulerGuard07,
  "08": positions_schedulerGuard08,
} as const;

export async function runPositionsSchedulerSuite(): Promise<void> {
  await runSuiteSteps("Positions scheduler module", "scripts/test-positions-scheduler.ts", ["01", "02", "03", "04", "05", "06", "07", "08"]);
  console.log("Positions scheduler module assertions passed.");
}

async function runRequestedStep(): Promise<void> {
  const requestedStep = process.argv[3];
  if (!requestedStep) {
    return;
  }
  const step = suiteSteps[requestedStep as keyof typeof suiteSteps];
  if (!step) {
    throw new Error(`Unknown suite step: ${requestedStep}`);
  }
  await step();
}

if (process.argv[3]) {
  runRequestedStep().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : error);
    process.exit(1);
  });
}
