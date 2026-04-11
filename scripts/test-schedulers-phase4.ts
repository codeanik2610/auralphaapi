import assert from 'node:assert/strict';
import { OrdersSchedulerService } from '../src/api/services/OrdersSchedulerService';
import { coreDataSource } from '../src/database/data-source';
import { env } from '../src/env';

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

run().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
