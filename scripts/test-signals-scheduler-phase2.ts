import assert from 'node:assert/strict';
import { SignalsSchedulerService } from '../src/api/services/SignalsSchedulerService';

async function run(): Promise<void> {
  const service = new SignalsSchedulerService() as any;
  const storedAnchorConfig = {
    id: 'anchor-1',
    key: 'signals-scan-sync',
    name: 'Signals Scan',
    description: 'Scans active strategy library entries to refresh the Signals inbox.',
    enabled: false,
    cronExpression: '0 1 * * *',
    timezone: 'UTC',
    runAt: '01:00',
    intervalDays: 1,
    batchSize: 12,
    schedulerType: 'global',
    config: {
      sources: ['strategy_library'],
      retentionDays: 30,
    },
  };
  let storedUserConfig: Record<string, unknown> | null = null;

  const calls = {
    createAnchor: 0,
    updateAnchor: [] as Array<Record<string, unknown>>,
    createUserConfig: [] as Array<Record<string, unknown>>,
    updateUserConfig: [] as Array<Record<string, unknown>>,
    listRuns: [] as Array<Record<string, unknown>>,
    findRun: [] as Array<Record<string, unknown>>,
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

  service.schedulerUserConfigRepository = {
    async createIfMissing(payload: Record<string, unknown>) {
      calls.createUserConfig.push(payload);
      if (!storedUserConfig) {
        storedUserConfig = {
          id: 'user-config-1',
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
          id: 'user-config-1',
          schedulerKey,
          userId,
          name: 'Signals Scan',
          description: 'Scans active strategy library entries to refresh the Signals inbox.',
          enabled: false,
          cronExpression: '0 1 * * *',
          timezone: 'UTC',
          runAt: '01:00',
          intervalDays: 1,
          batchSize: 12,
          schedulerType: 'user',
          config: {
            sources: ['strategy_library'],
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
      assert.equal(schedulerKey, 'signals-scan-sync');
      assert.equal(commandType, 'run_now');
      assert.equal(actorUserId, 'user-1');
      assert.deepEqual(statuses, ['Pending', 'Processing']);
      return null;
    },
    async createCommand(payload: Record<string, unknown>) {
      return {
        id: 'command-1',
        ...payload,
      };
    },
    async cancelPendingBySchedulerKeyAndActor() {
      return 0;
    },
    async cancelPendingBySchedulerKeyAndTypeAndActor() {
      return 0;
    },
  };

  service.schedulerRunLogRepository = {
    async hasRunningRunBySchedulerKeyAndActor(schedulerKey: string, actorUserId: string) {
      assert.equal(schedulerKey, 'signals-scan-sync');
      assert.equal(actorUserId, 'user-1');
      return false;
    },
    async createRun(payload: Record<string, unknown>) {
      return payload;
    },
    async cancelQueuedRunsBySchedulerKeyAndActor() {
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
      return {
        id: runId,
        schedulerKey,
        actorUserId,
        status: 'Completed',
        startedAt: new Date('2026-04-09T08:00:00.000Z'),
        finishedAt: new Date('2026-04-09T08:01:00.000Z'),
        durationMs: 60000,
        processedAccounts: 1,
        insertedAssets: 2,
        updatedAssets: 3,
        skippedAssets: 0,
        errorMessage: null,
        meta: null,
      };
    },
    async deleteOlderThanDaysBySchedulerKeyAndActor(
      schedulerKey: string,
      actorUserId: string,
      retentionDays: number
    ) {
      calls.deleteRunLogs.push({ schedulerKey, actorUserId, retentionDays });
      return 5;
    },
    async countOlderThanDaysBySchedulerKeyAndActor() {
      return 2;
    },
  };

  service.exchangeAssetUpdateLogRepository = {
    async listByRunLogId() {
      return { items: [], total: 0 };
    },
    async deleteOlderThanDaysBySchedulerKeyAndActor(
      schedulerKey: string,
      actorUserId: string,
      retentionDays: number
    ) {
      calls.deleteUpdateLogs.push({ schedulerKey, actorUserId, retentionDays });
      return 7;
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

  const configResponse = await service.getSchedulerConfig('user-1');
  assert.equal(configResponse.data.key, 'signals-scan-sync');
  assert.equal(configResponse.data.schedulerType, 'user');
  assert.equal(configResponse.data.enabled, false);
  assert.equal(calls.createAnchor, 1);
  assert.equal(calls.createUserConfig.length, 1);
  assert.equal(calls.createUserConfig[0]?.enabled, false);

  const updateResponse = await service.updateSchedulerConfig('user-1', {
    enabled: true,
    retentionDays: 14,
    sources: ['strategy_library'],
  });
  assert.equal(updateResponse.data.schedulerType, 'user');
  assert.equal(calls.updateUserConfig.length > 0, true);
  assert.equal(calls.updateUserConfig.at(-1)?.schedulerKey, 'signals-scan-sync');
  assert.equal(calls.updateUserConfig.at(-1)?.userId, 'user-1');
  assert.equal(calls.updateAnchor.length, 0);

  await service.listSchedulerRuns('user-1', { limit: '10', offset: '0' });
  assert.deepEqual(calls.listRuns, [
    {
      schedulerKey: 'signals-scan-sync',
      actorUserId: 'user-1',
      limit: 10,
      offset: 0,
    },
  ]);

  await service.getSchedulerRunProgress('user-1', 'run-1');
  assert.deepEqual(calls.findRun, [
    {
      runId: 'run-1',
      schedulerKey: 'signals-scan-sync',
      actorUserId: 'user-1',
    },
  ]);

  const purgeResponse = await service.purgeSchedulerLogs('user-1');
  assert.equal(purgeResponse.data.runLogsDeleted, 5);
  assert.equal(purgeResponse.data.updateLogsDeleted, 7);
  assert.deepEqual(calls.deleteRunLogs, [
    {
      schedulerKey: 'signals-scan-sync',
      actorUserId: 'user-1',
      retentionDays: 14,
    },
  ]);
  assert.deepEqual(calls.deleteUpdateLogs, [
    {
      schedulerKey: 'signals-scan-sync',
      actorUserId: 'user-1',
      retentionDays: 14,
    },
  ]);

  console.log('Signals scheduler phase-2 assertions passed.');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
