import assert from 'node:assert/strict';
import { PositionsSchedulerService } from '../src/api/services/PositionsSchedulerService';
import { SchedulerOverviewService } from '../src/api/services/SchedulerOverviewService';
import { coreDataSource } from '../src/database/data-source';

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

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
