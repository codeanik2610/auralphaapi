import assert from 'node:assert/strict';
import { OrdersSchedulerController } from '../src/api/controllers/OrdersSchedulerController';
import { OrdersSchedulerService } from '../src/api/services/OrdersSchedulerService';
import {
  validateOrdersSchedulerConfigBody,
  validateOrdersSchedulerSyncStateQuery,
} from '../src/api/validators/scheduler.validator';
import { coreDataSource } from '../src/database/data-source';

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

run().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
