import assert from 'node:assert/strict';
import { FundsSchedulerService } from '../src/api/services/FundsSchedulerService';
import { env } from '../src/env';

function createEnabledConfig() {
  return {
    enabled: true,
    schedulerType: 'user',
    timezone: 'UTC',
    config: {
      sources: ['funds'],
      retentionDays: 30,
    },
  };
}

async function testRunNowReturnsExistingQueuedCommand(): Promise<void> {
  const service = new FundsSchedulerService() as any;
  const originalExecutionMode = env.scheduler.executionMode;
  env.scheduler.executionMode = 'queue';

  service.userTimeZoneService = {
    async resolveUserTimeZone(userId: string) {
      assert.equal(userId, 'user-1');
      return 'UTC';
    },
  };
  service.ensureSchedulerConfig = async (actorUserId: string, timeZone: string) => {
    assert.equal(actorUserId, 'user-1');
    assert.equal(timeZone, 'UTC');
    return createEnabledConfig();
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
      return {
        id: 'command-1',
        payload: {
          runId: 'run-1',
        },
      };
    },
    async createCommand() {
      assert.fail('runNow should not create a new command when a pending command already exists');
    },
  };
  service.schedulerRuntimeSchemaService = {
    async assertFundsRuntimeSchemaReady() {
      return;
    },
  };
  service.schedulerRunLogRepository = {
    async hasRunningRunBySchedulerKeyAndActor() {
      assert.fail('runNow should short-circuit before checking running state when already queued');
    },
    async createRun() {
      assert.fail('runNow should not create a new run when a pending command already exists');
    },
  };

  try {
    const response = await service.runNow('user-1');
    assert.equal(response.data.queued, true);
    assert.equal(response.data.started, false);
    assert.equal(response.data.executionMode, 'queue');
    assert.equal(response.data.runId, 'run-1');
    assert.equal(response.data.jobId, 'command-1');
    assert.equal(response.data.message, 'Funds scheduler run already queued');
  } finally {
    env.scheduler.executionMode = originalExecutionMode;
  }
}

async function testStopSchedulerReturnsNoopWhenNothingIsQueuedOrRunning(): Promise<void> {
  const service = new FundsSchedulerService() as any;
  const originalExecutionMode = env.scheduler.executionMode;
  const activityLogs: Array<Record<string, unknown>> = [];
  env.scheduler.executionMode = 'queue';

  service.userTimeZoneService = {
    async resolveUserTimeZone(userId: string) {
      assert.equal(userId, 'user-1');
      return 'UTC';
    },
  };
  service.schedulerCommandRepository = {
    async cancelPendingBySchedulerKeyAndTypeAndActor(
      schedulerKey: string,
      commandType: string,
      actorUserId: string,
      reason: string
    ) {
      assert.equal(schedulerKey, 'funds-sync');
      assert.equal(commandType, 'run_now');
      assert.equal(actorUserId, 'user-1');
      assert.match(reason, /Cancelled by stop request/);
      return 0;
    },
    async createCommand() {
      assert.fail('stopScheduler should not create stop_now when nothing is running');
    },
  };
  service.schedulerRunLogRepository = {
    async cancelQueuedRunsBySchedulerKeyAndActor(
      schedulerKey: string,
      actorUserId: string,
      reason: string
    ) {
      assert.equal(schedulerKey, 'funds-sync');
      assert.equal(actorUserId, 'user-1');
      assert.match(reason, /Cancelled by stop request/);
      return 0;
    },
    async hasRunningRunBySchedulerKeyAndActor(schedulerKey: string, actorUserId: string) {
      assert.equal(schedulerKey, 'funds-sync');
      assert.equal(actorUserId, 'user-1');
      return false;
    },
  };
  service.activityRepository = {
    async createActivityLog(payload: Record<string, unknown>) {
      activityLogs.push(payload);
    },
  };

  try {
    const response = await service.stopScheduler('user-1');
    assert.equal(response.data.action, 'stop');
    assert.equal(response.data.queued, false);
    assert.equal(response.data.state, 'noop');
    assert.equal(response.data.message, 'No active or queued funds scheduler run to stop');
    assert.deepEqual(response.data.commandIds, []);
    assert.equal(activityLogs.length, 1);
    assert.equal(activityLogs[0].status, 'Success');
    assert.match(String(activityLogs[0].description || ''), /activeStop=not-required/);
  } finally {
    env.scheduler.executionMode = originalExecutionMode;
  }
}

async function testRunNowFailureLogsAndEmitsAlert(): Promise<void> {
  const service = new FundsSchedulerService() as any;
  const originalExecutionMode = env.scheduler.executionMode;
  const activityLogs: Array<Record<string, unknown>> = [];
  const alerts: Array<Record<string, unknown>> = [];
  env.scheduler.executionMode = 'queue';

  service.userTimeZoneService = {
    async resolveUserTimeZone(userId: string) {
      assert.equal(userId, 'user-1');
      return 'UTC';
    },
  };
  service.ensureSchedulerConfig = async () => createEnabledConfig();
  service.schedulerRuntimeSchemaService = {
    async assertFundsRuntimeSchemaReady() {
      throw new Error('Funds scheduler runtime schema is missing funds_snapshots.snapshot_date.');
    },
  };
  service.activityRepository = {
    async createActivityLog(payload: Record<string, unknown>) {
      activityLogs.push(payload);
    },
  };
  service.alertRepository = {
    async findRecentOpenAlertBySource(payload: Record<string, unknown>) {
      assert.equal(payload.userId, 'user-1');
      assert.equal(payload.channel, 'Scheduler');
      assert.equal(payload.source, 'funds-sync');
      return null;
    },
    async createAlert(payload: Record<string, unknown>) {
      alerts.push(payload);
    },
  };

  try {
    await assert.rejects(
      () => service.runNow('user-1'),
      /Funds scheduler runtime schema is missing/
    );
    assert.equal(activityLogs.length, 1);
    assert.equal(activityLogs[0].title, 'Funds scheduler run failed');
    assert.equal(activityLogs[0].status, 'Failed');
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].channel, 'Scheduler');
    assert.equal(alerts[0].source, 'funds-sync');
    assert.equal(alerts[0].symbol, 'FUNDS');
    assert.match(String(alerts[0].message || ''), /runtime schema is missing/i);
  } finally {
    env.scheduler.executionMode = originalExecutionMode;
  }
}

async function testFailureAlertIsThrottled(): Promise<void> {
  const service = new FundsSchedulerService() as any;
  const alerts: Array<Record<string, unknown>> = [];

  service.alertRepository = {
    async findRecentOpenAlertBySource(payload: Record<string, unknown>) {
      assert.equal(payload.userId, 'user-1');
      assert.equal(payload.channel, 'Scheduler');
      assert.equal(payload.source, 'funds-sync');
      return {
        id: 'alert-1',
      };
    },
    async createAlert(payload: Record<string, unknown>) {
      alerts.push(payload);
    },
  };

  await service.emitSchedulerFailureAlert('user-1', 'Funds scheduler run failed', 'Broker timeout');
  assert.equal(alerts.length, 0);
}

async function run(): Promise<void> {
  await testRunNowReturnsExistingQueuedCommand();
  await testStopSchedulerReturnsNoopWhenNothingIsQueuedOrRunning();
  await testRunNowFailureLogsAndEmitsAlert();
  await testFailureAlertIsThrottled();
  console.log('Funds scheduler phase 6 assertions passed.');
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
