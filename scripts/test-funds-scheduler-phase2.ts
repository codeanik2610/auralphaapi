import assert from 'node:assert/strict';
import { FundsSchedulerService } from '../src/api/services/FundsSchedulerService';
import { env } from '../src/env';

async function run(): Promise<void> {
  const service = new FundsSchedulerService() as any;
  const originalExecutionMode = env.scheduler.executionMode;
  env.scheduler.executionMode = 'queue';

  const storedAnchorConfig = {
    id: 'anchor-1',
    key: 'funds-sync',
    name: 'Funds Snapshot Sync',
    description: 'Captures wallet and futures funds for connected broker accounts.',
    enabled: false,
    cronExpression: '0 1 * * *',
    timezone: 'UTC',
    runAt: '01:00',
    intervalDays: 1,
    batchSize: 200,
    schedulerType: 'user',
    config: {
      sources: ['funds'],
      retentionDays: 30,
    },
  };

  let storedUserConfig: Record<string, unknown> | null = null;
  let runningState = false;
  let runLookupResult: Record<string, unknown> | null = {
    id: 'run-1',
    schedulerKey: 'funds-sync',
    actorUserId: 'user-1',
    status: 'Completed',
    startedAt: new Date('2026-04-10T08:00:00.000Z'),
    finishedAt: new Date('2026-04-10T08:02:00.000Z'),
    durationMs: 120000,
    processedAccounts: 2,
    insertedAssets: 1,
    updatedAssets: 1,
    skippedAssets: 0,
    errorMessage: null,
    meta: null,
  };

  const calls = {
    createAnchor: 0,
    updateAnchor: [] as Array<Record<string, unknown>>,
    createUserConfig: [] as Array<Record<string, unknown>>,
    updateUserConfig: [] as Array<Record<string, unknown>>,
    createRun: [] as Array<Record<string, unknown>>,
    createCommand: [] as Array<Record<string, unknown>>,
    cancelPendingActor: [] as Array<Record<string, unknown>>,
    cancelPendingTypeActor: [] as Array<Record<string, unknown>>,
    cancelQueuedRunsActor: [] as Array<Record<string, unknown>>,
    listRuns: [] as Array<Record<string, unknown>>,
    findRun: [] as Array<Record<string, unknown>>,
    listUpdates: [] as Array<Record<string, unknown>>,
    deleteRunLogs: [] as Array<Record<string, unknown>>,
    deleteUpdateLogs: [] as Array<Record<string, unknown>>,
  };

  service.userTimeZoneService = {
    async resolveUserTimeZone(userId: string) {
      assert.equal(userId, 'user-1');
      return 'UTC';
    },
  };

  service.schedulerConfigRepository = {
    async createIfMissing(payload: Record<string, unknown>) {
      calls.createAnchor += 1;
      return {
        ...storedAnchorConfig,
        ...payload,
      };
    },
    async updateByKey(_key: string, payload: Record<string, unknown>) {
      calls.updateAnchor.push(payload);
      Object.assign(storedAnchorConfig, payload);
      return { ...storedAnchorConfig };
    },
  };

  service.schedulerRuntimeSchemaService = {
    async assertFundsRuntimeSchemaReady() {
      return;
    },
    async inspectFundsRuntimeSchema() {
      return {
        status: 'ready',
        migrationName: '1770707000000-HardenFundsSnapshotsRuntime',
        requiredTables: ['funds_snapshots'],
        requiredColumns: ['funds_snapshots.snapshot_date'],
      };
    },
  };

  service.schedulerUserConfigRepository = {
    async createIfMissing(payload: Record<string, unknown>) {
      calls.createUserConfig.push(payload);
      if (!storedUserConfig) {
        storedUserConfig = {
          id: 'funds-user-config-1',
          ...payload,
        };
      }
      return { ...storedUserConfig };
    },
    async updateBySchedulerKeyAndUserId(
      schedulerKey: string,
      userId: string,
      payload: Record<string, unknown>
    ) {
      calls.updateUserConfig.push({ schedulerKey, userId, payload });
      storedUserConfig = {
        ...(storedUserConfig || {
          id: 'funds-user-config-1',
          schedulerKey,
          userId,
          name: 'Funds Snapshot Sync',
          description: 'Captures wallet and futures funds for connected broker accounts.',
          enabled: false,
          cronExpression: '0 1 * * *',
          timezone: 'UTC',
          runAt: '01:00',
          intervalDays: 1,
          batchSize: 200,
          schedulerType: 'user',
          config: {
            sources: ['funds'],
            retentionDays: 30,
          },
          lastStartedAt: null,
          lastFinishedAt: null,
          lastStatus: null,
          lastError: null,
          runningLockUntil: null,
        }),
        ...payload,
      };
      return { ...storedUserConfig };
    },
  };

  service.schedulerCommandRepository = {
    async findLatestBySchedulerKeyAndTypeAndActorInStatuses(
      schedulerKey: string,
      commandType: string,
      actorUserId: string,
      statuses: string[]
    ) {
      assert.equal(schedulerKey, 'funds-sync');
      assert.equal(commandType, 'run_now');
      assert.equal(actorUserId, 'user-1');
      assert.deepEqual(statuses, ['Pending', 'Processing']);
      return null;
    },
    async createCommand(payload: Record<string, unknown>) {
      calls.createCommand.push(payload);
      return {
        id: `command-${calls.createCommand.length}`,
        ...payload,
      };
    },
    async cancelPendingBySchedulerKeyAndActor(
      schedulerKey: string,
      actorUserId: string,
      reason: string
    ) {
      calls.cancelPendingActor.push({ schedulerKey, actorUserId, reason });
      return 0;
    },
    async cancelPendingBySchedulerKeyAndTypeAndActor(
      schedulerKey: string,
      commandType: string,
      actorUserId: string,
      reason: string
    ) {
      calls.cancelPendingTypeActor.push({ schedulerKey, commandType, actorUserId, reason });
      return 1;
    },
  };

  service.schedulerRunLogRepository = {
    async hasRunningRunBySchedulerKeyAndActor(schedulerKey: string, actorUserId: string) {
      assert.equal(schedulerKey, 'funds-sync');
      assert.equal(actorUserId, 'user-1');
      return runningState;
    },
    async createRun(payload: Record<string, unknown>) {
      calls.createRun.push(payload);
      return payload;
    },
    async cancelQueuedRunsBySchedulerKeyAndActor(
      schedulerKey: string,
      actorUserId: string,
      reason: string
    ) {
      calls.cancelQueuedRunsActor.push({ schedulerKey, actorUserId, reason });
      return 0;
    },
    async listRunsBySchedulerKeyAndActor(
      schedulerKey: string,
      actorUserId: string,
      limit: number,
      offset: number
    ) {
      calls.listRuns.push({ schedulerKey, actorUserId, limit, offset });
      return {
        items: [],
        total: 0,
      };
    },
    async findByIdAndSchedulerKeyAndActor(runId: string, schedulerKey: string, actorUserId: string) {
      calls.findRun.push({ runId, schedulerKey, actorUserId });
      return runLookupResult;
    },
    async deleteOlderThanDaysBySchedulerKeyAndActor(
      schedulerKey: string,
      actorUserId: string,
      retentionDays: number
    ) {
      calls.deleteRunLogs.push({ schedulerKey, actorUserId, retentionDays });
      return 4;
    },
    async countOlderThanDaysBySchedulerKeyAndActor() {
      return 2;
    },
  };

  service.exchangeAssetUpdateLogRepository = {
    async listByRunLogId(
      runLogId: string,
      limit: number,
      offset: number,
      filters: Record<string, unknown>
    ) {
      calls.listUpdates.push({ runLogId, limit, offset, filters });
      return {
        items: [],
        total: 0,
      };
    },
    async deleteOlderThanDaysBySchedulerKeyAndActor(
      schedulerKey: string,
      actorUserId: string,
      retentionDays: number
    ) {
      calls.deleteUpdateLogs.push({ schedulerKey, actorUserId, retentionDays });
      return 6;
    },
    async countOlderThanDaysBySchedulerKeyAndActor() {
      return 3;
    },
  };

  service.activityRepository = {
    async createActivityLog() {
      return;
    },
  };

  service.alertRepository = {
    async findRecentOpenAlertBySource() {
      return null;
    },
    async createAlert() {
      return;
    },
  };

  try {
    const configResponse = await service.getSchedulerConfig('user-1');
    assert.equal(configResponse.data.key, 'funds-sync');
    assert.equal(configResponse.data.schedulerType, 'user');
    assert.equal(calls.createAnchor, 1);
    assert.equal(calls.createUserConfig.length, 1);
    assert.equal(calls.createUserConfig[0]?.userId, 'user-1');

    const updateResponse = await service.updateSchedulerConfig('user-1', {
      enabled: true,
      retentionDays: 14,
      sources: ['funds'],
    });
    assert.equal(updateResponse.data.schedulerType, 'user');
    assert.equal(calls.updateUserConfig.length > 0, true);
    assert.equal(calls.updateUserConfig.at(-1)?.schedulerKey, 'funds-sync');
    assert.equal(calls.updateUserConfig.at(-1)?.userId, 'user-1');
    assert.equal(calls.updateAnchor.length, 0);

    const runResponse = await service.runNow('user-1');
    assert.equal(runResponse.data.queued, true);
    assert.equal(calls.createRun.length, 1);
    assert.equal(calls.createRun[0].actorUserId, 'user-1');
    assert.equal(calls.createCommand[0].actorUserId, 'user-1');
    assert.equal(calls.createCommand[0].commandType, 'run_now');

    const pauseResponse = await service.pauseScheduler('user-1');
    assert.equal(pauseResponse.data.state, 'applied');
    assert.equal(
      (calls.updateUserConfig.at(-1)?.payload as Record<string, unknown> | undefined)?.enabled,
      false
    );
    assert.equal(calls.cancelPendingActor.at(-1)?.actorUserId, 'user-1');
    assert.equal(calls.cancelQueuedRunsActor.at(-1)?.actorUserId, 'user-1');

    const resumeResponse = await service.resumeScheduler('user-1');
    assert.equal(resumeResponse.data.state, 'applied');
    assert.equal(
      (calls.updateUserConfig.at(-1)?.payload as Record<string, unknown> | undefined)?.enabled,
      true
    );

    runningState = true;
    const stopResponse = await service.stopScheduler('user-1');
    assert.equal(stopResponse.data.action, 'stop');
    assert.equal(calls.cancelPendingTypeActor.at(-1)?.actorUserId, 'user-1');
    assert.equal(calls.createCommand[1].actorUserId, 'user-1');
    assert.equal(calls.createCommand[1].commandType, 'stop_now');

    const restartResponse = await service.restartScheduler('user-1');
    assert.equal(restartResponse.data.action, 'restart');
    assert.equal(calls.createCommand[2].actorUserId, 'user-1');
    assert.equal(calls.createCommand[2].commandType, 'stop_now');
    assert.equal(calls.createCommand[3].actorUserId, 'user-1');
    assert.equal(calls.createCommand[3].commandType, 'run_now');

    await service.listSchedulerRuns('user-1', { limit: '10', offset: '0' });
    assert.deepEqual(calls.listRuns, [
      {
        schedulerKey: 'funds-sync',
        actorUserId: 'user-1',
        limit: 10,
        offset: 0,
      },
    ]);

    await service.getSchedulerRunProgress('user-1', 'run-1');
    await service.listSchedulerRunUpdates('user-1', 'run-1', {
      limit: '5',
      offset: '0',
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });
    assert.deepEqual(calls.findRun.slice(0, 2), [
      {
        runId: 'run-1',
        schedulerKey: 'funds-sync',
        actorUserId: 'user-1',
      },
      {
        runId: 'run-1',
        schedulerKey: 'funds-sync',
        actorUserId: 'user-1',
      },
    ]);
    assert.equal(calls.listUpdates.length, 1);
    assert.equal(calls.listUpdates[0].runLogId, 'run-1');

    const purgeResponse = await service.purgeSchedulerLogs('user-1');
    assert.equal(purgeResponse.data.runLogsDeleted, 4);
    assert.equal(purgeResponse.data.updateLogsDeleted, 6);
    assert.deepEqual(calls.deleteRunLogs, [
      {
        schedulerKey: 'funds-sync',
        actorUserId: 'user-1',
        retentionDays: 14,
      },
    ]);
    assert.deepEqual(calls.deleteUpdateLogs, [
      {
        schedulerKey: 'funds-sync',
        actorUserId: 'user-1',
        retentionDays: 14,
      },
    ]);

    runLookupResult = null;
    await assert.rejects(
      () => service.listSchedulerRunUpdates('user-1', 'missing-run', { limit: '5', offset: '0' }),
      /Funds scheduler run not found/
    );

    console.log('Funds scheduler phase-2 assertions passed.');
  } finally {
    env.scheduler.executionMode = originalExecutionMode;
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
