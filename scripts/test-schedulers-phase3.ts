import assert from 'node:assert/strict';
import { OrdersSchedulerService } from '../src/api/services/OrdersSchedulerService';

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

run().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
