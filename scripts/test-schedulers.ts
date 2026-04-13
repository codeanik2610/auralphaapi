import { runSuiteSteps } from './_support/run-script-suite';

// Consolidated module suite.

async function schedulersGuard02(): Promise<void> {
  const { default: assert } = await import("node:assert/strict");
  const { OrdersSchedulerController } = await import("../src/api/controllers/OrdersSchedulerController");
  const { OrdersSchedulerService } = await import("../src/api/services/OrdersSchedulerService");
  const { validateOrdersSchedulerConfigBody, validateOrdersSchedulerSyncStateQuery, } = await import("../src/api/validators/scheduler.validator");
  const { coreDataSource } = await import("../src/database/data-source");

function createSuccess<T>(data: T) {
  return { success: true as const, data };
}

function createOrdersConfig(overrides: Record<string, unknown> = {}) {
  return {
    key: 'orders-sync',
    name: 'Orders Sync',
    description:
      'Reconciles orders in monitor mode with pending-first checkpoints and data-loss guards.',
    enabled: true,
    cronExpression: '0 1 * * *',
    timezone: 'UTC',
    runAt: '01:00',
    intervalDays: 1,
    batchSize: 200,
    schedulerType: 'global',
    config: {
      sources: ['orders'],
      retentionDays: 30,
      lookbackDays: 90,
    },
    lastStartedAt: null,
    lastFinishedAt: null,
    lastStatus: null,
    lastError: null,
    createdAt: new Date('2026-04-10T00:00:00.000Z'),
    updatedAt: new Date('2026-04-10T00:00:00.000Z'),
    ...overrides,
  };
}

async function testOrdersConfigValidationRejectsAssetLeakage(): Promise<void> {
  assert.deepEqual(
    validateOrdersSchedulerConfigBody({
      sources: ['orders'],
      scheduleMode: 'every_n_minutes',
      intervalMinutes: 5,
      batchSize: 200,
      retentionDays: 30,
    }),
    {
      sources: ['orders'],
      scheduleMode: 'every_n_minutes',
      intervalMinutes: 5,
      batchSize: 200,
      retentionDays: 30,
    }
  );

  assert.throws(
    () => validateOrdersSchedulerConfigBody({ sources: ['mudrex'] }),
    /Orders scheduler sources must be exactly \["orders"\] when provided/
  );
  assert.throws(
    () => validateOrdersSchedulerConfigBody({ selectionMode: 'custom' }),
    /Orders scheduler does not support asset selection controls/
  );
  assert.throws(
    () => validateOrdersSchedulerConfigBody({ maxLookbackDays: 30 }),
    /Orders scheduler lookback is fixed server-side/
  );
}

async function testOrdersSyncStateQueryUsesExplicitOwnerSemantics(): Promise<void> {
  assert.deepEqual(
    validateOrdersSchedulerSyncStateQuery({
      limit: '25',
      offset: '5',
      ownerUserId: 'owner-1',
      brokerKey: 'DELTA_EXCHANGE',
    }),
    {
      limit: 25,
      offset: 5,
      ownerUserId: 'owner-1',
      brokerKey: 'delta_exchange',
    }
  );

  assert.deepEqual(
    validateOrdersSchedulerSyncStateQuery({
      limit: '10',
      offset: '0',
      userId: 'legacy-owner-1',
    }),
    {
      limit: 10,
      offset: 0,
      ownerUserId: 'legacy-owner-1',
    }
  );

  assert.throws(
    () =>
      validateOrdersSchedulerSyncStateQuery({
        ownerUserId: 'owner-1',
        userId: 'owner-2',
      }),
    /ownerUserId and userId must match/
  );
}

async function testOrdersSyncStateServiceFiltersByOwnerUserId(): Promise<void> {
  const service = new OrdersSchedulerService() as any;
  const originalQuery = (coreDataSource as any).query;
  const capturedQueries: Array<{ sql: string; params: unknown[] }> = [];

  service.userTimeZoneService = {
    async resolveUserTimeZone() {
      return 'UTC';
    },
  };
  service.schedulerRuntimeSchemaService = {
    async inspectOrdersRuntimeSchema() {
      return {
        status: 'ready',
        migrationName: '1770706000000-CreateOrdersSchedulerRuntimeTables',
        requiredTables: ['scheduler_sync_checkpoints', 'scheduler_orders_snapshots'],
        requiredColumns: ['scheduler_orders_snapshots.payload_hash'],
      };
    },
  };

  (coreDataSource as any).query = async (sql: string, params: unknown[] = []) => {
    capturedQueries.push({ sql, params });
    if (sql.includes('GROUP BY ba.id')) {
      return [
        {
          accountId: 'account-1',
          userId: 'owner-42',
          brokerKey: 'delta_exchange',
          checkpointAt: '2026-04-10T01:00:00.000Z',
          pendingRecords: 1,
          failedRecords: 0,
          resolvedRecords: 2,
          nextRetryAt: '2026-04-10T01:05:00.000Z',
          lastPendingUpdateAt: '2026-04-10T01:03:00.000Z',
        },
      ];
    }
    if (sql.includes('SELECT COUNT(*) AS total')) {
      return [{ total: 1 }];
    }
    throw new Error(`Unexpected SQL in schedulers phase 2 test: ${sql}`);
  };

  try {
    const response = await service.listSchedulerSyncState('admin-user-1', {
      limit: '20',
      offset: '0',
      ownerUserId: 'owner-42',
    });

    assert.equal(response.data.items.length, 1);
    assert.equal(response.data.items[0].userId, 'owner-42');
    assert.equal(response.data.items[0].ownerUserId, 'owner-42');
    assert.ok(
      capturedQueries.some(
        (entry) => entry.sql.includes('ba.user_id = ?') && entry.params.includes('owner-42')
      ),
      'orders sync-state should filter explicitly by ownerUserId'
    );
    assert.ok(
      capturedQueries.every((entry) => entry.sql.includes('ba.user_id IS NOT NULL')),
      'orders sync-state should exclude ownerless system accounts by default'
    );
  } finally {
    (coreDataSource as any).query = originalQuery;
  }
}

async function testOrdersRunUpdatesStayOrdersScoped(): Promise<void> {
  const service = new OrdersSchedulerService() as any;
  let listByRunLogIdCalls = 0;

  service.schedulerRunLogRepository = {
    async findByIdAndSchedulerKey(runId: string, schedulerKey: string) {
      assert.equal(runId, 'missing-run');
      assert.equal(schedulerKey, 'orders-sync');
      return null;
    },
  };
  service.exchangeAssetUpdateLogRepository = {
    async listByRunLogId() {
      listByRunLogIdCalls += 1;
      return { items: [], total: 0 };
    },
  };

  await assert.rejects(
    () =>
      service.listSchedulerRunUpdates('admin-user-1', 'missing-run', {
        limit: '20',
        offset: '0',
      }),
    /Orders scheduler run not found/
  );
  await assert.rejects(
    () =>
      service.exportSchedulerRunUpdates('admin-user-1', 'missing-run', {
        sortBy: 'createdAt',
        sortOrder: 'desc',
      }),
    /Orders scheduler run not found/
  );
  assert.equal(listByRunLogIdCalls, 0);
}

async function testOrdersControllerForwardsOwnerUserId(): Promise<void> {
  const controller = new OrdersSchedulerController() as any;
  controller.ordersSchedulerService = {
    async listSchedulerSyncState(...args: unknown[]) {
      return createSuccess({ args });
    },
  };
  const adminReq = { authUser: { sub: 'admin-user-1', role: 'admin' } } as any;

  const response = await controller.listSyncState(
    adminReq,
    '25',
    '5',
    'account-1',
    'owner-99',
    'legacy-owner-99',
    'mudrex'
  );

  assert.deepEqual(response.data.args, [
    'admin-user-1',
    {
      limit: '25',
      offset: '5',
      accountId: 'account-1',
      ownerUserId: 'owner-99',
      userId: 'legacy-owner-99',
      brokerKey: 'mudrex',
    },
  ]);
}

async function testOrdersServiceNormalizesFixedSourcesAndResolvedSchedule(): Promise<void> {
  const service = new OrdersSchedulerService() as any;
  let persistedConfig: { config?: Record<string, unknown> } | null = null;

  service.userTimeZoneService = {
    async resolveUserTimeZone() {
      return 'UTC';
    },
  };
  service.schedulerConfigRepository = {
    async createIfMissing() {
      return createOrdersConfig({
        config: {
          sources: ['wrong-source'],
          retentionDays: 30,
          lookbackDays: 90,
          scheduleMode: 'every_n_minutes',
          intervalMinutes: 5,
        },
      }) as any;
    },
    async updateByKey(_schedulerKey: string, payload: Record<string, unknown>) {
      persistedConfig = payload;
      return {
        ...createOrdersConfig(),
        ...payload,
      } as any;
    },
  };
  service.schedulerCommandRepository = {
    async cancelPendingBySchedulerKey() {
      return 0;
    },
  };
  service.activityRepository = {
    async createActivityLog() {
      return null;
    },
  };

  const response = await service.updateSchedulerConfig('admin-user-1', {
    scheduleMode: 'every_n_minutes',
    intervalMinutes: 10,
    batchSize: 250,
    retentionDays: 45,
  });

  const persistedPayload = persistedConfig as { config?: Record<string, unknown> } | null;
  assert.deepEqual(persistedPayload?.config?.sources, ['orders']);
  assert.equal(persistedPayload?.config?.lookbackDays, 90);
  assert.deepEqual(response.data.sources, ['orders']);
}

async function run(): Promise<void> {
  await testOrdersConfigValidationRejectsAssetLeakage();
  await testOrdersSyncStateQueryUsesExplicitOwnerSemantics();
  await testOrdersSyncStateServiceFiltersByOwnerUserId();
  await testOrdersRunUpdatesStayOrdersScoped();
  await testOrdersControllerForwardsOwnerUserId();
  await testOrdersServiceNormalizesFixedSourcesAndResolvedSchedule();
  console.log('Schedulers Phase 2 assertions passed.');
}

  await run();
}

async function schedulersGuard03(): Promise<void> {
  const { default: assert } = await import("node:assert/strict");
  const { OrdersSchedulerService } = await import("../src/api/services/OrdersSchedulerService");

function createOrdersConfig(overrides: Record<string, unknown> = {}) {
  return {
    key: 'orders-sync',
    name: 'Orders Sync',
    description:
      'Reconciles orders in monitor mode with pending-first checkpoints and data-loss guards.',
    enabled: true,
    cronExpression: '0 1 * * *',
    timezone: 'UTC',
    runAt: '01:00',
    intervalDays: 1,
    batchSize: 200,
    schedulerType: 'global',
    config: {
      sources: ['orders'],
      retentionDays: 30,
      lookbackDays: 90,
    },
    lastStartedAt: null,
    lastFinishedAt: null,
    lastStatus: null,
    lastError: null,
    createdAt: new Date('2026-04-10T00:00:00.000Z'),
    updatedAt: new Date('2026-04-10T00:00:00.000Z'),
    ...overrides,
  };
}

async function testOrdersPurgePreviewIncludesUpdateLogs(): Promise<void> {
  const service = new OrdersSchedulerService() as any;

  service.userTimeZoneService = {
    async resolveUserTimeZone() {
      return 'UTC';
    },
  };
  service.schedulerConfigRepository = {
    async createIfMissing() {
      return createOrdersConfig({
        config: {
          sources: ['orders'],
          retentionDays: 45,
          lookbackDays: 90,
        },
      });
    },
  };
  service.schedulerRunLogRepository = {
    async countOlderThanDays(schedulerKey: string, retentionDays: number) {
      assert.equal(schedulerKey, 'orders-sync');
      assert.equal(retentionDays, 45);
      return 5;
    },
  };
  service.exchangeAssetUpdateLogRepository = {
    async countOlderThanDaysBySchedulerKey(schedulerKey: string, retentionDays: number) {
      assert.equal(schedulerKey, 'orders-sync');
      assert.equal(retentionDays, 45);
      return 8;
    },
  };

  const response = await service.getSchedulerPurgePreview('admin-user-1');

  assert.deepEqual(response.data, {
    retentionDays: 45,
    runLogsToDelete: 5,
    updateLogsToDelete: 8,
  });
}

async function testOrdersPurgeDeletesUpdateLogsBeforeRunLogs(): Promise<void> {
  const service = new OrdersSchedulerService() as any;
  const callOrder: string[] = [];
  const activityCalls: Array<Record<string, unknown>> = [];

  service.userTimeZoneService = {
    async resolveUserTimeZone() {
      return 'UTC';
    },
  };
  service.schedulerConfigRepository = {
    async createIfMissing() {
      return createOrdersConfig({
        config: {
          sources: ['orders'],
          retentionDays: 60,
          lookbackDays: 90,
        },
      });
    },
  };
  service.exchangeAssetUpdateLogRepository = {
    async deleteOlderThanDaysBySchedulerKey(schedulerKey: string, retentionDays: number) {
      callOrder.push('update');
      assert.equal(schedulerKey, 'orders-sync');
      assert.equal(retentionDays, 60);
      return 7;
    },
  };
  service.schedulerRunLogRepository = {
    async deleteOlderThanDays(schedulerKey: string, retentionDays: number) {
      callOrder.push('run');
      assert.equal(schedulerKey, 'orders-sync');
      assert.equal(retentionDays, 60);
      return 4;
    },
  };
  service.activityRepository = {
    async createActivityLog(payload: Record<string, unknown>) {
      activityCalls.push(payload);
      return null;
    },
  };

  const response = await service.purgeSchedulerLogs('admin-user-1');

  assert.deepEqual(callOrder, ['update', 'run']);
  assert.deepEqual(response.data, {
    message: 'Orders scheduler logs purged. Deleted 4 run logs and 7 update logs.',
    retentionDays: 60,
    runLogsDeleted: 4,
    updateLogsDeleted: 7,
  });
  assert.equal(activityCalls.length, 1);
  assert.equal(activityCalls[0].status, 'Success');
  assert.equal(activityCalls[0].title, 'Orders scheduler logs purged');
  assert.match(String(activityCalls[0].description || ''), /4 run logs and 7 update logs/);
}

async function testOrdersPurgeLogsFailureWhenUpdateDeletionFails(): Promise<void> {
  const service = new OrdersSchedulerService() as any;
  const activityCalls: Array<Record<string, unknown>> = [];
  let runDeleteCalls = 0;

  service.userTimeZoneService = {
    async resolveUserTimeZone() {
      return 'UTC';
    },
  };
  service.schedulerConfigRepository = {
    async createIfMissing() {
      return createOrdersConfig();
    },
  };
  service.exchangeAssetUpdateLogRepository = {
    async deleteOlderThanDaysBySchedulerKey() {
      throw new Error('update log delete failed');
    },
  };
  service.schedulerRunLogRepository = {
    async deleteOlderThanDays() {
      runDeleteCalls += 1;
      return 0;
    },
  };
  service.activityRepository = {
    async createActivityLog(payload: Record<string, unknown>) {
      activityCalls.push(payload);
      return null;
    },
  };

  await assert.rejects(
    () => service.purgeSchedulerLogs('admin-user-1'),
    /update log delete failed/
  );

  assert.equal(runDeleteCalls, 0);
  assert.equal(activityCalls.length, 1);
  assert.equal(activityCalls[0].status, 'Failed');
  assert.equal(activityCalls[0].title, 'Orders scheduler logs purge failed');
  assert.match(String(activityCalls[0].description || ''), /update log delete failed/);
}

async function run(): Promise<void> {
  await testOrdersPurgePreviewIncludesUpdateLogs();
  await testOrdersPurgeDeletesUpdateLogsBeforeRunLogs();
  await testOrdersPurgeLogsFailureWhenUpdateDeletionFails();
  console.log('Schedulers Phase 3 assertions passed.');
}

  await run();
}

async function schedulersGuard04(): Promise<void> {
  const { default: assert } = await import("node:assert/strict");
  const { OrdersSchedulerService } = await import("../src/api/services/OrdersSchedulerService");
  const { coreDataSource } = await import("../src/database/data-source");
  const { env } = await import("../src/env");

function createOrdersConfig(overrides: Record<string, unknown> = {}) {
  return {
    key: 'orders-sync',
    name: 'Orders Sync',
    description:
      'Reconciles orders in monitor mode with pending-first checkpoints and data-loss guards.',
    enabled: true,
    cronExpression: '0 1 * * *',
    timezone: 'UTC',
    runAt: '01:00',
    intervalDays: 1,
    batchSize: 200,
    schedulerType: 'global',
    config: {
      sources: ['orders'],
      retentionDays: 30,
      lookbackDays: 90,
    },
    lastStartedAt: null,
    lastFinishedAt: null,
    lastStatus: null,
    lastError: null,
    createdAt: new Date('2026-04-10T00:00:00.000Z'),
    updatedAt: new Date('2026-04-10T00:00:00.000Z'),
    ...overrides,
  };
}

async function testOrdersConfigAcceptsLookbackAndMapsPolicy(): Promise<void> {
  const service = new OrdersSchedulerService() as any;
  let persistedPayload: any = null;

  service.userTimeZoneService = {
    async resolveUserTimeZone() {
      return 'UTC';
    },
  };
  service.schedulerConfigRepository = {
    async createIfMissing() {
      return createOrdersConfig();
    },
    async updateByKey(_schedulerKey: string, payload: Record<string, unknown>) {
      persistedPayload = payload;
      return createOrdersConfig({
        ...payload,
        config: {
          sources: ['orders'],
          retentionDays: 45,
          lookbackDays: 45,
          ...(payload.config as Record<string, unknown>),
        },
      });
    },
  };
  service.schedulerCommandRepository = {
    async cancelPendingBySchedulerKey() {
      return 0;
    },
  };
  service.activityRepository = {
    async createActivityLog() {
      return null;
    },
  };

  const response = await service.updateSchedulerConfig('admin-user-1', {
    retentionDays: 45,
    lookbackDays: 45,
    batchSize: 250,
  });

  const persistedConfig = (persistedPayload?.config || {}) as Record<string, unknown>;
  assert.equal(persistedConfig.lookbackDays, 45);
  assert.equal(response.data.lookbackDays, 45);
  assert.equal(response.data.ordersPolicy?.lookbackDays, 45);
  assert.equal(response.data.ordersPolicy?.maxLookbackDays, 90);
  assert.equal(response.data.ordersPolicy?.historyWindowDays, 7);
  assert.equal(response.data.ordersPolicy?.incrementalCheckpointOverlapDays, 1);
  assert.equal(response.data.ordersPolicy?.replayMode, 'checkpoint_reset_then_scoped_run');
}

async function testOrdersGlobalManualRunUsesSystemExecutionActor(): Promise<void> {
  const service = new OrdersSchedulerService() as any;
  let createdRun: any = null;
  let createdCommand: any = null;

  service.userTimeZoneService = {
    async resolveUserTimeZone() {
      return 'UTC';
    },
  };
  service.schedulerConfigRepository = {
    async createIfMissing() {
      return createOrdersConfig({
        enabled: true,
        schedulerType: 'global',
      });
    },
  };
  service.schedulerCommandRepository = {
    async findLatestBySchedulerKeyAndTypeInStatuses() {
      return null;
    },
    async createCommand(payload: Record<string, unknown>) {
      createdCommand = payload;
      return { id: 'command-1' };
    },
  };
  service.schedulerRunLogRepository = {
    async hasRunningRun() {
      return false;
    },
    async createRun(payload: Record<string, unknown>) {
      createdRun = payload;
      return payload;
    },
  };
  service.activityRepository = {
    async createActivityLog() {
      return null;
    },
  };
  service.alertRepository = {
    async findRecentOpenAlertBySource() {
      return null;
    },
    async createAlert() {
      return null;
    },
  };
  service.schedulerRuntimeSchemaService = {
    async assertOrdersRuntimeSchemaReady() {
      return undefined;
    },
  };

  const response = await service.runNow('admin-user-1');

  assert.equal((createdRun?.meta as Record<string, unknown>)?.actorUserId, env.scheduler.systemUserId);
  assert.equal(
    (createdRun?.meta as Record<string, unknown>)?.requestedByUserId,
    'admin-user-1'
  );
  assert.equal(
    (createdCommand?.payload as Record<string, unknown>)?.actorUserId,
    env.scheduler.systemUserId
  );
  assert.equal(
    (createdCommand?.payload as Record<string, unknown>)?.requestedByUserId,
    'admin-user-1'
  );
  assert.equal(response.data.message, 'Orders scheduler command queued');
}

async function testOrdersReplayRunResetsCheckpointAndQueuesScopedReplay(): Promise<void> {
  const service = new OrdersSchedulerService() as any;
  let createdRun: any = null;
  let createdCommand: any = null;
  const originalQuery = (coreDataSource as any).query;
  const capturedQueries: Array<{ sql: string; params: unknown[] }> = [];

  service.userTimeZoneService = {
    async resolveUserTimeZone() {
      return 'UTC';
    },
  };
  service.schedulerConfigRepository = {
    async createIfMissing() {
      return createOrdersConfig({
        enabled: true,
        schedulerType: 'global',
        config: {
          sources: ['orders'],
          retentionDays: 30,
          lookbackDays: 45,
        },
      });
    },
  };
  service.brokerAccountRepository = {
    async getAllActiveBrokerAccounts(brokerKey?: string) {
      assert.equal(brokerKey, 'delta_exchange');
      return [
        {
          id: 'acct-1',
          userId: 'owner-1',
          brokerKey: 'delta_exchange',
          status: 'Connected',
        },
        {
          id: 'acct-system',
          userId: null,
          brokerKey: 'delta_exchange',
          status: 'Connected',
        },
      ];
    },
  };
  service.schedulerCommandRepository = {
    async createCommand(payload: Record<string, unknown>) {
      createdCommand = payload;
      return { id: 'command-replay-1' };
    },
  };
  service.schedulerRunLogRepository = {
    async createRun(payload: Record<string, unknown>) {
      createdRun = payload;
      return payload;
    },
  };
  service.activityRepository = {
    async createActivityLog() {
      return null;
    },
  };
  service.alertRepository = {
    async findRecentOpenAlertBySource() {
      return null;
    },
    async createAlert() {
      return null;
    },
  };
  service.schedulerRuntimeSchemaService = {
    async assertOrdersRuntimeSchemaReady() {
      return undefined;
    },
  };

  (coreDataSource as any).query = async (sql: string, params: unknown[] = []) => {
    capturedQueries.push({ sql, params });
    return [{ affectedRows: 1 }];
  };

  try {
    const response = await service.runNow('admin-user-1', {
      accountId: 'acct-1',
      brokerKey: 'DELTA_EXCHANGE',
      resetCheckpoint: true,
    });

    assert.ok(
      capturedQueries.some(
        (entry) =>
          entry.sql.includes('DELETE FROM scheduler_sync_checkpoints') &&
          entry.params[0] === 'orders-sync' &&
          entry.params[1] === 'acct-1'
      ),
      'replay should clear the scoped orders checkpoint before queueing the run'
    );
    assert.equal(
      (createdCommand?.payload as Record<string, unknown>)?.actorUserId,
      env.scheduler.systemUserId
    );
    assert.equal(
      (createdCommand?.payload as Record<string, unknown>)?.requestedByUserId,
      'admin-user-1'
    );
    assert.deepEqual((createdCommand?.payload as Record<string, unknown>)?.scope, {
      accountIds: ['acct-1'],
      brokerKeys: ['delta_exchange'],
    });
    assert.deepEqual((createdCommand?.payload as Record<string, unknown>)?.replay, {
      mode: 'checkpoint_reset_then_scoped_run',
      accountId: 'acct-1',
      brokerKey: 'delta_exchange',
      checkpointReset: true,
      lookbackDays: 45,
    });
    assert.equal((createdRun?.meta as Record<string, unknown>)?.trigger, 'repair-replay');
    assert.match(
      response.data.message,
      /Orders replay queued for acct-1 \(delta_exchange\)\. Checkpoint reset; next run will backfill up to 45 days\./
    );
  } finally {
    (coreDataSource as any).query = originalQuery;
  }
}

async function run(): Promise<void> {
  await testOrdersConfigAcceptsLookbackAndMapsPolicy();
  await testOrdersGlobalManualRunUsesSystemExecutionActor();
  await testOrdersReplayRunResetsCheckpointAndQueuesScopedReplay();
  console.log('Schedulers Phase 4 assertions passed.');
}

  await run();
}

async function schedulersGuard05(): Promise<void> {
  const { default: assert } = await import("node:assert/strict");
  const { InternalOrdersSyncService } = await import("../src/api/services/InternalOrdersSyncService");
  const { OrdersSchedulerService } = await import("../src/api/services/OrdersSchedulerService");
  const { SchedulerRuntimeSchemaService } = await import("../src/api/services/SchedulerRuntimeSchemaService");
  const { coreDataSource } = await import("../src/database/data-source");
  const { CreateOrdersSchedulerRuntimeTables1770706000000 } = await import("../src/database/migrations/1770706000000-CreateOrdersSchedulerRuntimeTables");

function createOrdersConfig(overrides: Record<string, unknown> = {}) {
  return {
    key: 'orders-sync',
    name: 'Orders Sync',
    description:
      'System reconciliation scheduler for broker order snapshots, checkpoints, and repair replay tooling.',
    enabled: true,
    cronExpression: '0 1 * * *',
    timezone: 'UTC',
    runAt: '01:00',
    intervalDays: 1,
    batchSize: 200,
    schedulerType: 'global',
    config: {
      sources: ['orders'],
      retentionDays: 30,
      lookbackDays: 45,
    },
    lastStartedAt: null,
    lastFinishedAt: null,
    lastStatus: null,
    lastError: null,
    createdAt: new Date('2026-04-10T00:00:00.000Z'),
    updatedAt: new Date('2026-04-10T00:00:00.000Z'),
    ...overrides,
  };
}

function createMigrationQueryRunner(options: {
  hasTable?: Record<string, boolean>;
  hasColumn?: Record<string, boolean>;
  existingIndexes?: Record<string, string[]>;
}) {
  const queries: Array<{ sql: string; params?: unknown[] }> = [];

  const queryRunner = {
    async hasTable(tableName: string) {
      return options.hasTable?.[tableName] ?? false;
    },
    async hasColumn(tableName: string, columnName: string) {
      return options.hasColumn?.[`${tableName}.${columnName}`] ?? false;
    },
    async query(sql: string, params?: unknown[]) {
      queries.push({ sql, params });

      if (sql.startsWith('SHOW INDEX FROM ')) {
        const tableName = sql.includes('scheduler_orders_snapshots')
          ? 'scheduler_orders_snapshots'
          : 'scheduler_sync_checkpoints';
        const indexName = String(params?.[0] || '');
        const indexes = options.existingIndexes?.[tableName] || [];
        return indexes.includes(indexName) ? [{ Key_name: indexName }] : [];
      }

      return [];
    },
  };

  return { queryRunner, queries };
}

async function testOrdersRuntimeMigrationCreatesTablesAndNormalizesOwnership(): Promise<void> {
  const migration = new CreateOrdersSchedulerRuntimeTables1770706000000();
  const { queryRunner, queries } = createMigrationQueryRunner({
    hasTable: {
      scheduler_configs: true,
      scheduler_user_configs: true,
      scheduler_sync_checkpoints: false,
      scheduler_orders_snapshots: false,
    },
    hasColumn: {
      'scheduler_configs.scheduler_type': true,
    },
  });

  await migration.up(queryRunner as any);

  assert.ok(
    queries.some(
      (entry) =>
        entry.sql.includes('UPDATE scheduler_configs') &&
        entry.sql.includes("scheduler_type = 'global'") &&
        entry.sql.includes('repair replay tooling')
    ),
    'Phase 5 migration should normalize orders scheduler ownership in scheduler_configs'
  );
  assert.ok(
    queries.some(
      (entry) =>
        entry.sql.includes('DELETE FROM scheduler_user_configs') &&
        entry.sql.includes("scheduler_key = 'orders-sync'")
    ),
    'Phase 5 migration should retire any user-scoped orders scheduler config rows'
  );
  assert.ok(
    queries.some((entry) =>
      entry.sql.includes('CREATE TABLE IF NOT EXISTS scheduler_sync_checkpoints')
    ),
    'Phase 5 migration should create the shared checkpoint table when missing'
  );
  assert.ok(
    queries.some((entry) =>
      entry.sql.includes('CREATE TABLE IF NOT EXISTS scheduler_orders_snapshots')
    ),
    'Phase 5 migration should create the orders snapshot table when missing'
  );
  assert.ok(
    queries.some((entry) =>
      entry.sql.includes('idx_scheduler_orders_user_account_status_seen')
    ),
    'Phase 5 migration should create the orders read-path status/seen index'
  );
}

async function testOrdersRuntimeMigrationRepairsDriftedTables(): Promise<void> {
  const migration = new CreateOrdersSchedulerRuntimeTables1770706000000();
  const { queryRunner, queries } = createMigrationQueryRunner({
    hasTable: {
      scheduler_sync_checkpoints: true,
      scheduler_orders_snapshots: true,
    },
    hasColumn: {
      'scheduler_orders_snapshots.payload_hash': false,
    },
    existingIndexes: {
      scheduler_sync_checkpoints: [],
      scheduler_orders_snapshots: ['uidx_scheduler_orders_snapshot'],
    },
  });

  await migration.up(queryRunner as any);

  assert.ok(
    queries.some((entry) =>
      entry.sql.includes('ADD UNIQUE KEY uidx_sync_checkpoint')
    ),
    'Phase 5 migration should restore the shared checkpoint uniqueness guard'
  );
  assert.ok(
    queries.some((entry) =>
      entry.sql.includes('ADD COLUMN payload_hash char(64) NULL AFTER payload_json')
    ),
    'Phase 5 migration should repair payload_hash drift on orders snapshots'
  );
  assert.ok(
    queries.some((entry) =>
      entry.sql.includes('ADD KEY idx_scheduler_orders_user_account_status_updated')
    ),
    'Phase 5 migration should add the orders updated-at read-path index when missing'
  );
}

async function testOrdersRuntimeMigrationDownKeepsSharedCheckpointFoundation(): Promise<void> {
  const migration = new CreateOrdersSchedulerRuntimeTables1770706000000();
  const { queryRunner, queries } = createMigrationQueryRunner({
    hasTable: {
      scheduler_configs: true,
      scheduler_orders_snapshots: true,
      scheduler_sync_checkpoints: true,
    },
  });

  await migration.down(queryRunner as any);

  assert.ok(
    queries.some(
      (entry) =>
        entry.sql.includes('UPDATE scheduler_configs') &&
        entry.sql.includes('pending-first checkpoints and data-loss guards')
    ),
    'Phase 5 migration down should restore the legacy orders scheduler description'
  );
  assert.ok(
    queries.some((entry) =>
      entry.sql.includes('DROP TABLE IF EXISTS scheduler_orders_snapshots')
    ),
    'Phase 5 migration down should retire the orders snapshot table'
  );
  assert.equal(
    queries.some((entry) =>
      entry.sql.includes('DROP TABLE IF EXISTS scheduler_sync_checkpoints')
    ),
    false,
    'Phase 5 migration down should keep the shared checkpoint foundation in place'
  );
}

async function testOrdersRuntimeSchemaServiceCachesReadyState(): Promise<void> {
  const service = new SchedulerRuntimeSchemaService();
  const originalQuery = (coreDataSource as any).query;
  const capturedQueries: Array<{ sql: string; params: unknown[] }> = [];

  (coreDataSource as any).query = async (sql: string, params: unknown[] = []) => {
    capturedQueries.push({ sql, params });
    if (sql.includes('FROM information_schema.tables')) {
      return [
        { tableName: 'scheduler_sync_checkpoints' },
        { tableName: 'scheduler_orders_snapshots' },
      ];
    }
    if (sql.includes('FROM information_schema.columns')) {
      return [{ columnName: 'payload_hash' }];
    }
    throw new Error(`Unexpected SQL in schedulers phase 5 schema-ready test: ${sql}`);
  };

  try {
    await service.assertOrdersRuntimeSchemaReady();
    await service.assertOrdersRuntimeSchemaReady();

    assert.equal(capturedQueries.length, 2);
  } finally {
    (coreDataSource as any).query = originalQuery;
  }
}

async function testOrdersRuntimeSchemaServiceFailsFastWithMigrationHint(): Promise<void> {
  const service = new SchedulerRuntimeSchemaService();
  const originalQuery = (coreDataSource as any).query;

  (coreDataSource as any).query = async (sql: string) => {
    if (sql.includes('FROM information_schema.tables')) {
      return [{ tableName: 'scheduler_sync_checkpoints' }];
    }
    if (sql.includes('FROM information_schema.columns')) {
      return [];
    }
    throw new Error(`Unexpected SQL in schedulers phase 5 schema-missing test: ${sql}`);
  };

  try {
    await assert.rejects(
      () => service.assertOrdersRuntimeSchemaReady(),
      (error: unknown) => {
        assert.equal(
          String((error as { code?: string }).code || ''),
          'ORDERS_SCHEDULER_SCHEMA_MISSING'
        );
        return true;
      }
    );
  } finally {
    (coreDataSource as any).query = originalQuery;
  }
}

async function testOrdersReplayResetCheckpointSkipsRuntimeDdl(): Promise<void> {
  const service = new OrdersSchedulerService() as any;
  const originalQuery = (coreDataSource as any).query;
  const capturedQueries: Array<{ sql: string; params: unknown[] }> = [];
  let schemaReadyCalls = 0;

  service.userTimeZoneService = {
    async resolveUserTimeZone() {
      return 'UTC';
    },
  };
  service.schedulerRuntimeSchemaService = {
    async assertOrdersRuntimeSchemaReady() {
      schemaReadyCalls += 1;
    },
  };
  service.schedulerConfigRepository = {
    async createIfMissing() {
      return createOrdersConfig();
    },
  };
  service.brokerAccountRepository = {
    async getAllActiveBrokerAccounts(brokerKey?: string) {
      assert.equal(brokerKey, 'delta_exchange');
      return [
        {
          id: 'acct-1',
          userId: 'owner-1',
          brokerKey: 'delta_exchange',
          status: 'Connected',
        },
        {
          id: 'acct-system',
          userId: null,
          brokerKey: 'delta_exchange',
          status: 'Connected',
        },
      ];
    },
  };
  service.schedulerCommandRepository = {
    async createCommand(payload: Record<string, unknown>) {
      return { id: 'command-1', payload };
    },
  };
  service.schedulerRunLogRepository = {
    async createRun(payload: Record<string, unknown>) {
      return payload;
    },
  };
  service.activityRepository = {
    async createActivityLog() {
      return null;
    },
  };
  service.alertRepository = {
    async findRecentOpenAlertBySource() {
      return null;
    },
    async createAlert() {
      return null;
    },
  };

  (coreDataSource as any).query = async (sql: string, params: unknown[] = []) => {
    capturedQueries.push({ sql, params });
    return [{ affectedRows: 1 }];
  };

  try {
    const response = await service.runNow('admin-user-1', {
      accountId: 'acct-1',
      brokerKey: 'DELTA_EXCHANGE',
      resetCheckpoint: true,
    });

    assert.equal(schemaReadyCalls, 1);
    assert.equal(
      capturedQueries.some((entry) =>
        entry.sql.includes('CREATE TABLE IF NOT EXISTS scheduler_sync_checkpoints')
      ),
      false
    );
    assert.ok(
      capturedQueries.some(
        (entry) =>
          entry.sql.includes('DELETE FROM scheduler_sync_checkpoints') &&
          entry.params[0] === 'orders-sync' &&
          entry.params[1] === 'acct-1'
      ),
      'Phase 5 replay should delete the checkpoint without issuing runtime DDL'
    );
    assert.match(
      response.data.message,
      /Orders replay queued for acct-1 \(delta_exchange\)\. Checkpoint reset; next run will backfill up to 45 days\./
    );
  } finally {
    (coreDataSource as any).query = originalQuery;
  }
}

async function testInternalOrdersSyncSkipsRuntimeDdlWhenSchemaIsReady(): Promise<void> {
  const service = new InternalOrdersSyncService() as any;
  const originalQuery = (coreDataSource as any).query;
  const capturedQueries: Array<{ sql: string; params: unknown[] }> = [];
  let schemaReadyCalls = 0;
  const activityCalls: Array<{ userId: string; payload: Record<string, unknown> }> = [];

  service.schedulerRuntimeSchemaService = {
    async assertOrdersRuntimeSchemaReady() {
      schemaReadyCalls += 1;
    },
  };
  service.operationalEventService = {
    async logActivity(userId: string, payload: Record<string, unknown>) {
      activityCalls.push({ userId, payload });
    },
    async emitFailureAlert() {
      return null;
    },
  };

  (coreDataSource as any).query = async (sql: string, params: unknown[] = []) => {
    capturedQueries.push({ sql, params });
    return [];
  };

  try {
    const response = await service.runBatch({
      targetUserIds: [],
    });

    assert.equal(schemaReadyCalls, 1);
    assert.equal(response.processedUsers, 0);
    assert.equal(
      capturedQueries.some((entry) => entry.sql.includes('CREATE TABLE IF NOT EXISTS')),
      false
    );
    assert.equal(activityCalls.length, 1);
    assert.equal(activityCalls[0].payload.title, 'Orders sync completed');
  } finally {
    (coreDataSource as any).query = originalQuery;
  }
}

async function run(): Promise<void> {
  await testOrdersRuntimeMigrationCreatesTablesAndNormalizesOwnership();
  await testOrdersRuntimeMigrationRepairsDriftedTables();
  await testOrdersRuntimeMigrationDownKeepsSharedCheckpointFoundation();
  await testOrdersRuntimeSchemaServiceCachesReadyState();
  await testOrdersRuntimeSchemaServiceFailsFastWithMigrationHint();
  await testOrdersReplayResetCheckpointSkipsRuntimeDdl();
  await testInternalOrdersSyncSkipsRuntimeDdlWhenSchemaIsReady();
  console.log('Schedulers Phase 5 assertions passed.');
}

  await run();
}

async function schedulersGuard07(): Promise<void> {
  const { default: assert } = await import("node:assert/strict");
  const { OrdersSchedulerService } = await import("../src/api/services/OrdersSchedulerService");
  const { SchedulerRuntimeSchemaService } = await import("../src/api/services/SchedulerRuntimeSchemaService");
  const { coreDataSource } = await import("../src/database/data-source");

async function testRuntimeSchemaServiceReportsReadyFoundation(): Promise<void> {
  const service = new SchedulerRuntimeSchemaService();
  const originalQuery = (coreDataSource as any).query;

  (coreDataSource as any).query = async (sql: string) => {
    if (sql.includes('FROM information_schema.tables')) {
      return [
        { tableName: 'scheduler_sync_checkpoints' },
        { tableName: 'scheduler_orders_snapshots' },
      ];
    }
    if (sql.includes('FROM information_schema.columns')) {
      return [{ columnName: 'payload_hash' }];
    }
    throw new Error(`Unexpected SQL in schedulers phase 7 runtime-ready test: ${sql}`);
  };

  try {
    const status = await service.inspectOrdersRuntimeSchema();

    assert.equal(status.status, 'ready');
    assert.equal(
      status.migrationName,
      '1770706000000-CreateOrdersSchedulerRuntimeTables'
    );
    assert.deepEqual(status.requiredTables, [
      'scheduler_sync_checkpoints',
      'scheduler_orders_snapshots',
    ]);
    assert.deepEqual(status.requiredColumns, ['scheduler_orders_snapshots.payload_hash']);
    assert.equal(status.missingParts, undefined);
  } finally {
    (coreDataSource as any).query = originalQuery;
  }
}

async function testRuntimeSchemaServiceReportsMissingFoundation(): Promise<void> {
  const service = new SchedulerRuntimeSchemaService();
  const originalQuery = (coreDataSource as any).query;

  (coreDataSource as any).query = async (sql: string) => {
    if (sql.includes('FROM information_schema.tables')) {
      return [{ tableName: 'scheduler_sync_checkpoints' }];
    }
    if (sql.includes('FROM information_schema.columns')) {
      return [];
    }
    throw new Error(`Unexpected SQL in schedulers phase 7 runtime-missing test: ${sql}`);
  };

  try {
    const status = await service.inspectOrdersRuntimeSchema();

    assert.equal(status.status, 'missing');
    assert.deepEqual(status.missingParts, ['scheduler_orders_snapshots']);
    assert.match(
      String(status.note || ''),
      /Run migration 1770706000000-CreateOrdersSchedulerRuntimeTables/
    );
  } finally {
    (coreDataSource as any).query = originalQuery;
  }
}

async function testOrdersSyncSummaryIncludesRuntimeFoundationStatus(): Promise<void> {
  const service = new OrdersSchedulerService() as any;
  const originalQuery = (coreDataSource as any).query;

  service.userTimeZoneService = {
    async resolveUserTimeZone() {
      return 'UTC';
    },
  };
  service.schedulerRuntimeSchemaService = {
    async inspectOrdersRuntimeSchema() {
      return {
        status: 'ready',
        migrationName: '1770706000000-CreateOrdersSchedulerRuntimeTables',
        requiredTables: ['scheduler_sync_checkpoints', 'scheduler_orders_snapshots'],
        requiredColumns: ['scheduler_orders_snapshots.payload_hash'],
        note: 'Orders runtime foundation is ready.',
      };
    },
  };

  (coreDataSource as any).query = async (sql: string) => {
    if (sql.includes('COUNT(*) AS totalAccounts') && sql.includes('pendingAgg')) {
      return [
        {
          totalAccounts: 3,
          accountsWithCheckpoint: 2,
          accountsWithoutCheckpoint: 1,
          accountsWithPending: 1,
          accountsWithFailed: 0,
          accountsWithRetryScheduled: 1,
          pendingRecords: 2,
          failedRecords: 0,
          resolvedRecords: 5,
          oldestCheckpointAt: '2026-04-10T01:00:00.000Z',
          latestCheckpointAt: '2026-04-10T03:00:00.000Z',
          latestPendingUpdateAt: '2026-04-10T03:05:00.000Z',
          nextRetryAt: '2026-04-10T03:10:00.000Z',
        },
      ];
    }
    throw new Error(`Unexpected SQL in schedulers phase 7 summary-foundation test: ${sql}`);
  };

  try {
    const response = await service.getSchedulerSyncStateSummary('admin-user-1');

    assert.equal(response.data.schedulerKey, 'orders-sync');
    assert.equal(response.data.totalAccounts, 3);
    assert.equal(response.data.runtimeFoundation?.status, 'ready');
    assert.equal(
      response.data.runtimeFoundation?.migrationName,
      '1770706000000-CreateOrdersSchedulerRuntimeTables'
    );
  } finally {
    (coreDataSource as any).query = originalQuery;
  }
}

async function testOrdersSyncSummaryFallsBackCleanlyWhenRuntimeFoundationMissing(): Promise<void> {
  const service = new OrdersSchedulerService() as any;
  const originalQuery = (coreDataSource as any).query;
  const capturedQueries: string[] = [];

  service.userTimeZoneService = {
    async resolveUserTimeZone() {
      return 'UTC';
    },
  };
  service.schedulerRuntimeSchemaService = {
    async inspectOrdersRuntimeSchema() {
      return {
        status: 'missing',
        migrationName: '1770706000000-CreateOrdersSchedulerRuntimeTables',
        requiredTables: ['scheduler_sync_checkpoints', 'scheduler_orders_snapshots'],
        requiredColumns: ['scheduler_orders_snapshots.payload_hash'],
        missingParts: ['scheduler_orders_snapshots'],
        note: 'Run migration first.',
      };
    },
  };

  (coreDataSource as any).query = async (sql: string) => {
    capturedQueries.push(sql);
    if (sql.includes('SELECT COUNT(*) AS totalAccounts') && !sql.includes('pendingAgg')) {
      return [{ totalAccounts: 2 }];
    }
    throw new Error(`Unexpected SQL in schedulers phase 7 summary-fallback test: ${sql}`);
  };

  try {
    const response = await service.getSchedulerSyncStateSummary('admin-user-1');

    assert.equal(response.data.totalAccounts, 2);
    assert.equal(response.data.runtimeFoundation?.status, 'missing');
    assert.deepEqual(response.data.runtimeFoundation?.missingParts, [
      'scheduler_orders_snapshots',
    ]);
    assert.equal(
      capturedQueries.some((sql) => sql.includes('pendingAgg')),
      false,
      'orders summary should avoid querying missing runtime tables once runtime foundation is known missing'
    );
  } finally {
    (coreDataSource as any).query = originalQuery;
  }
}

async function run(): Promise<void> {
  await testRuntimeSchemaServiceReportsReadyFoundation();
  await testRuntimeSchemaServiceReportsMissingFoundation();
  await testOrdersSyncSummaryIncludesRuntimeFoundationStatus();
  await testOrdersSyncSummaryFallsBackCleanlyWhenRuntimeFoundationMissing();
  console.log('Schedulers Phase 7 assertions passed.');
}

  await run();
}

async function schedulersGuard08(): Promise<void> {
  const { default: assert } = await import("node:assert/strict");
  const { mkdtemp, readFile, rm, writeFile } = await import("node:fs/promises");
  const { default: os } = await import("node:os");
  const { default: path } = await import("node:path");
  const { spawnSync } = await import("node:child_process");
  const { OrdersSchedulerController } = await import("../src/api/controllers/OrdersSchedulerController");

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

async function testOrdersSchedulerControllerStaysAdminOnly(): Promise<void> {
  const controller = new OrdersSchedulerController() as any;
  const calls: Array<{ method: string; args: unknown[] }> = [];

  controller.ordersSchedulerService = {
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
      expectedArgs: ['user-1', {}],
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
      args: ['10', '5', 'acct-1', 'owner-1', 'legacy-owner-1', 'mudrex'],
      expectedArgs: [
        'user-1',
        {
          limit: '10',
          offset: '5',
          accountId: 'acct-1',
          ownerUserId: 'owner-1',
          userId: 'legacy-owner-1',
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
    await assertAuthRequired(() =>
      controller[testCase.method](unauthReq, ...(testCase.args || []))
    );
    assert.equal(
      calls.length,
      beforeCalls,
      `${testCase.label} should not call the service when authentication is missing`
    );

    await assertAdminRoleRequired(() =>
      controller[testCase.method](authReq, ...(testCase.args || []))
    );
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

async function testFinalSignoffScriptCanProduceReadyArtifact(): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'orders-scheduler-phase8-'));
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
            total: 6,
            passed: 6,
            failed: 0,
            skipped: 0,
          },
          results: [
            'backend-orders-scheduler-suite',
            'backend-orders-scheduler-controllers',
            'backend-orders-scheduler-eslint',
            'frontend-orders-scheduler-eslint',
            'frontend-orders-scheduler-ui',
            'frontend-orders-scheduler-e2e',
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
      ['--import', 'tsx', 'scripts/signoffs/signoff-orders-scheduler.ts'],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          ORDERS_SCHEDULER_SIGNOFF_GATE_FILE: gateFile,
          ORDERS_SCHEDULER_SIGNOFF_OUTPUT_FILE: outputFile,
          ORDERS_SCHEDULER_SIGNOFF_OPERATOR_WALKTHROUGH_VERIFIED: 'true',
          ORDERS_SCHEDULER_SIGNOFF_RUNBOOK_REVIEW_VERIFIED: 'true',
          ORDERS_SCHEDULER_SIGNOFF_RUNTIME_FOUNDATION_VERIFIED: 'true',
          ORDERS_SCHEDULER_SIGNOFF_ACCESS_REVIEW_VERIFIED: 'true',
          ORDERS_SCHEDULER_SIGNOFF_APPROVER: 'Codex',
          ORDERS_SCHEDULER_SIGNOFF_OPERATOR_WALKTHROUGH_URL: '/tmp/orders-walkthrough.md',
        },
        encoding: 'utf8',
      }
    );

    assert.equal(
      result.status,
      0,
      result.stderr || result.stdout || 'orders scheduler signoff script should succeed'
    );
    const output = JSON.parse(await readFile(outputFile, 'utf8')) as Record<string, unknown>;
    assert.equal(output.decision, 'ready');
    assert.equal(output.approver, 'Codex');
    assert.equal(
      (output.checks as Record<string, unknown>).accessReviewVerified,
      true
    );
    assert.equal(
      ((output.evidence as Record<string, unknown>).operatorWalkthroughUrl as string) || '',
      '/tmp/orders-walkthrough.md'
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function run(): Promise<void> {
  await testOrdersSchedulerControllerStaysAdminOnly();
  await testFinalSignoffScriptCanProduceReadyArtifact();
  console.log('Schedulers Phase 8 assertions passed.');
}

  await run();
}

async function schedulersGuard09(): Promise<void> {
  const { default: assert } = await import("node:assert/strict");
  const { spawn } = await import("node:child_process");
  const { mkdtemp, readFile, writeFile } = await import("node:fs/promises");
  const { default: os } = await import("node:os");
  const { default: path } = await import("node:path");

type JsonRecord = Record<string, unknown>;

async function runCommand(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv
): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env,
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', (code) => resolve(code));
  });
}

async function runOrdersSchedulerLiveProofAssertions(): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'orders-scheduler-phase9-'));
  const gateFile = path.join(tempDir, 'orders-scheduler-release-gate.json');
  const signoffFile = path.join(tempDir, 'orders-scheduler-signoff.json');
  const proofFile = path.join(tempDir, 'orders-scheduler-live-proof.json');
  const gateScript = path.join(tempDir, 'release-gate.stub.ts');
  const signoffScript = path.join(tempDir, 'signoff.stub.ts');

  const readyGateSummary = {
    decision: 'ready',
    generatedAt: '2026-04-10T12:00:00.000Z',
    liveChecksEnabled: true,
    totals: {
      total: 7,
      passed: 7,
      failed: 0,
      skipped: 0,
    },
    results: [
      'backend-orders-scheduler-suite',
      'backend-orders-scheduler-controllers',
      'backend-orders-scheduler-eslint',
      'frontend-orders-scheduler-eslint',
      'frontend-orders-scheduler-ui',
      'frontend-orders-scheduler-e2e',
      'backend-orders-scheduler-live-health',
    ].map((key) => ({
      key,
      label: key,
      status: 'passed',
    })),
  };

  const readySignoffSummary = {
    decision: 'ready',
    generatedAt: '2026-04-10T12:05:00.000Z',
    approver: 'codex-phase9',
    checks: {
      gateReady: true,
      requiredSuitesPassed: true,
      liveHealthReviewed: true,
      operatorWalkthroughVerified: true,
      runbookReviewVerified: true,
      runtimeFoundationVerified: true,
      accessReviewVerified: true,
    },
    evidence: {
      stagingWorkflowUrl: 'https://example.com/staging/orders-scheduler',
      dashboardUrl: 'https://example.com/dashboard/orders-scheduler',
      runbookUrl: 'https://example.com/runbooks/orders-scheduler',
      releaseNoteUrl: 'https://example.com/releases/orders-scheduler',
      operatorWalkthroughUrl: 'https://example.com/walkthroughs/orders-scheduler',
    },
  };

  await writeFile(
    gateScript,
    `import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const outputFile = path.resolve(process.cwd(), String(process.env.ORDERS_SCHEDULER_RELEASE_GATE_OUTPUT_FILE || '').trim());

async function run(): Promise<void> {
  assert.equal(process.env.ORDERS_SCHEDULER_RUN_LIVE_CHECKS, 'true');
  assert.ok(outputFile, 'ORDERS_SCHEDULER_RELEASE_GATE_OUTPUT_FILE must be provided');
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

const gateFile = path.resolve(process.cwd(), String(process.env.ORDERS_SCHEDULER_SIGNOFF_GATE_FILE || '').trim());
const outputFile = path.resolve(process.cwd(), String(process.env.ORDERS_SCHEDULER_SIGNOFF_OUTPUT_FILE || '').trim());

async function run(): Promise<void> {
  assert.equal(process.env.ORDERS_SCHEDULER_SIGNOFF_REQUIRE_LIVE_HEALTH, 'true');
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

  const exitCode = await runCommand(
    process.execPath,
    ['--import', 'tsx', 'scripts/proofs/proof-orders-scheduler-live.ts'],
    {
      ...process.env,
      ORDERS_SCHEDULER_PROOF_RELEASE_GATE_SCRIPT: gateScript,
      ORDERS_SCHEDULER_PROOF_SIGNOFF_SCRIPT: signoffScript,
      ORDERS_SCHEDULER_RELEASE_GATE_OUTPUT_FILE: gateFile,
      ORDERS_SCHEDULER_SIGNOFF_OUTPUT_FILE: signoffFile,
      ORDERS_SCHEDULER_PROOF_OUTPUT_FILE: proofFile,
      ORDERS_SCHEDULER_SIGNOFF_APPROVER: 'codex-phase9',
      ORDERS_SCHEDULER_SIGNOFF_OPERATOR_WALKTHROUGH_VERIFIED: 'true',
      ORDERS_SCHEDULER_SIGNOFF_RUNBOOK_REVIEW_VERIFIED: 'true',
      ORDERS_SCHEDULER_SIGNOFF_RUNTIME_FOUNDATION_VERIFIED: 'true',
      ORDERS_SCHEDULER_SIGNOFF_ACCESS_REVIEW_VERIFIED: 'true',
    }
  );

  assert.equal(
    exitCode,
    0,
    'orders scheduler live proof should succeed against ready stub scripts'
  );

  const rawProof = await readFile(proofFile, 'utf8');
  const summary = JSON.parse(rawProof) as JsonRecord;

  assert.equal(summary.decision, 'ready');
  assert.equal(summary.approver, 'codex-phase9');
  assert.equal(summary.gateDecision, 'ready');
  assert.equal(summary.signoffDecision, 'ready');
  assert.equal(summary.liveChecksEnabled, true);
  assert.equal(summary.releaseGateFile, path.resolve(process.cwd(), gateFile));
  assert.equal(summary.signoffFile, path.resolve(process.cwd(), signoffFile));
  assert.equal(summary.proofOutputFile, path.resolve(process.cwd(), proofFile));
  assert.deepEqual(summary.gateTotals, readyGateSummary.totals);

  const evidence = (summary.evidence || {}) as JsonRecord;
  assert.equal(evidence.runbookUrl, readySignoffSummary.evidence.runbookUrl);

  const checks = (summary.checks || {}) as JsonRecord;
  assert.equal(checks.liveHealthReviewed, true);
  assert.equal(checks.runtimeFoundationVerified, true);
}

async function runSourceMarkerAssertions(): Promise<void> {
  const releaseGateSource = await readFile(
    path.join(process.cwd(), 'scripts', 'release-gates', 'release-gate-orders-scheduler.ts'),
    'utf8'
  );
  const signoffSource = await readFile(
    path.join(process.cwd(), 'scripts', 'signoffs', 'signoff-orders-scheduler.ts'),
    'utf8'
  );
  const packageSource = await readFile(path.join(process.cwd(), 'package.json'), 'utf8');
  const operationalAuditSource = await readFile(
    path.join(process.cwd(), 'scripts', 'test-operational-audit.ts'),
    'utf8'
  );

  assert.equal(
    releaseGateSource.includes('backend-orders-scheduler-suite'),
    true,
    'release gate must include the orders scheduler module suite'
  );
  assert.equal(
    releaseGateSource.includes('scripts/proofs/proof-orders-scheduler-live.ts'),
    true,
    'release gate lint coverage must include the orders scheduler proof script'
  );
  assert.equal(
    signoffSource.includes('backend-orders-scheduler-suite'),
    true,
    'orders scheduler signoff must require the module gate result'
  );
  assert.equal(
    packageSource.includes('"test:orders-scheduler"'),
    true,
    'package.json must include "test:orders-scheduler" for the orders scheduler workflow'
  );

  for (const marker of [
    '"proof:orders-scheduler-live"',
    '"check:orders-scheduler-health"',
    '"release-gate:orders-scheduler"',
    '"signoff:orders-scheduler"',
  ]) {
    assert.equal(
      packageSource.includes(marker),
      true,
      `package.json must include ${marker} for the orders scheduler Phase 9 workflow`
    );
    assert.equal(
      operationalAuditSource.includes(marker),
      true,
      `test-operational-audit.ts must guard ${marker} for the orders scheduler workflow`
    );
  }
}

async function main(): Promise<void> {
  await runOrdersSchedulerLiveProofAssertions();
  await runSourceMarkerAssertions();
  console.log('Schedulers Phase 9 assertions passed.');
}

  await main();
}

const suiteSteps = {
  "02": schedulersGuard02,
  "03": schedulersGuard03,
  "04": schedulersGuard04,
  "05": schedulersGuard05,
  "07": schedulersGuard07,
  "08": schedulersGuard08,
  "09": schedulersGuard09,
} as const;

export async function runSchedulersSuite(): Promise<void> {
  await runSuiteSteps("Orders scheduler module", "scripts/test-schedulers.ts", ["02", "03", "04", "05", "07", "08", "09"]);
  console.log("Orders scheduler module assertions passed.");
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
