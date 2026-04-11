import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { BrokerOrdersFacadeService } from '../src/api/services/BrokerOrdersFacadeService';
import { BrokerPositionsFacadeService } from '../src/api/services/BrokerPositionsFacadeService';
import { InternalOrdersSchedulerController } from '../src/api/controllers/InternalOrdersSchedulerController';
import { InternalPositionsSchedulerController } from '../src/api/controllers/InternalPositionsSchedulerController';
import { InternalOrdersSyncService } from '../src/api/services/InternalOrdersSyncService';
import { InternalPositionsSyncService } from '../src/api/services/InternalPositionsSyncService';
import { PositionsSchedulerService } from '../src/api/services/PositionsSchedulerService';
import { env } from '../src/env';

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function testPhase3Markers(): void {
  const findings: string[] = [];

  const phaseDoc = read('POSITIONS_ORDERS_SYNC_PHASE3.md');
  for (const marker of [
    '`positions-sync`',
    '`orders-sync`',
    'user-scoped scheduler record',
    'scheduler_user_configs',
    'legacy scheduler anchor',
    '`/positions`',
    '`/orders`',
    'Phase 4 Entry Checklist',
  ]) {
    if (!phaseDoc.includes(marker)) {
      findings.push(`POSITIONS_ORDERS_SYNC_PHASE3.md: missing marker ${marker}`);
    }
  }

  const readme = read('README.md');
  if (!readme.includes('POSITIONS_ORDERS_SYNC_PHASE3.md')) {
    findings.push('README.md: missing positions/orders sync Phase 3 baseline link');
  }
  if (!readme.includes('test:positions-orders-sync-phase3')) {
    findings.push('README.md: missing positions/orders sync Phase 3 verification command');
  }

  assert.equal(
    findings.length,
    0,
    `Positions/orders sync Phase 3 markers failed:\n${findings.join('\n')}`
  );
}

async function testPositionsSchedulerRuntimeMigratesToUserScope(): Promise<void> {
  const service = new PositionsSchedulerService() as any;
  const anchorConfig: any = {
    key: 'positions-sync',
    name: 'Positions Sync',
    description:
      'System reconciliation scheduler for broker position snapshots, checkpoints, and read-model hydration.',
    enabled: false,
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
  };
  const userConfig: any = {
    schedulerKey: 'positions-sync',
    userId: 'ops-admin',
    name: 'Positions Sync',
    description:
      'System reconciliation scheduler for broker position snapshots, checkpoints, and read-model hydration.',
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
  };
  const anchorUpdates: Array<Record<string, unknown>> = [];
  const createdRuns: Array<Record<string, unknown>> = [];
  const createdCommands: Array<Record<string, unknown>> = [];
  let actorPendingChecks = 0;
  let actorRunningChecks = 0;
  let actorCancelChecks = 0;
  let actorQueuedCancels = 0;

  service.userTimeZoneService = {
    async resolveUserTimeZone() {
      return 'UTC';
    },
  };
  service.schedulerConfigRepository = {
    async createIfMissing() {
      return anchorConfig;
    },
    async updateByKey(key: string, payload: Record<string, unknown>) {
      assert.equal(key, 'positions-sync');
      anchorUpdates.push(payload);
      Object.assign(anchorConfig, payload);
      return anchorConfig;
    },
  };
  service.schedulerUserConfigRepository = {
    async createIfMissing(payload: Record<string, unknown>) {
      assert.equal(payload.schedulerKey, 'positions-sync');
      assert.equal(payload.userId, 'ops-admin');
      return userConfig;
    },
    async updateBySchedulerKeyAndUserId(
      schedulerKey: string,
      userId: string,
      payload: Record<string, unknown>
    ) {
      assert.equal(schedulerKey, 'positions-sync');
      assert.equal(userId, 'ops-admin');
      Object.assign(userConfig, payload);
      return userConfig;
    },
  };
  service.schedulerCommandRepository = {
    async findLatestBySchedulerKeyAndTypeAndActorInStatuses(
      schedulerKey: string,
      commandType: string,
      actorUserId: string,
      statuses: string[]
    ) {
      actorPendingChecks += 1;
      assert.equal(schedulerKey, 'positions-sync');
      assert.equal(commandType, 'run_now');
      assert.equal(actorUserId, 'ops-admin');
      assert.deepEqual(statuses, ['Pending', 'Processing']);
      return null;
    },
    async createCommand(payload: Record<string, unknown>) {
      createdCommands.push(payload);
      return { id: `cmd-${createdCommands.length}`, ...payload };
    },
    async cancelPendingBySchedulerKeyAndActor(
      schedulerKey: string,
      actorUserId: string
    ) {
      actorCancelChecks += 1;
      assert.equal(schedulerKey, 'positions-sync');
      assert.equal(actorUserId, 'ops-admin');
      return 0;
    },
  };
  service.schedulerRunLogRepository = {
    async hasRunningRunBySchedulerKeyAndActor(schedulerKey: string, actorUserId: string) {
      actorRunningChecks += 1;
      assert.equal(schedulerKey, 'positions-sync');
      assert.equal(actorUserId, 'ops-admin');
      return false;
    },
    async createRun(payload: Record<string, unknown>) {
      createdRuns.push(payload);
      return payload;
    },
    async cancelQueuedRunsBySchedulerKeyAndActor(
      schedulerKey: string,
      actorUserId: string
    ) {
      actorQueuedCancels += 1;
      assert.equal(schedulerKey, 'positions-sync');
      assert.equal(actorUserId, 'ops-admin');
      return 0;
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
      return undefined;
    },
  };
  (service as any).emitSchedulerFailureAlert = async () => {};

  const configResponse = await service.getSchedulerConfig('ops-admin');
  assert.equal(configResponse.data.schedulerType, 'user');
  assert.equal(configResponse.data.key, 'positions-sync');
  assert.ok(
    anchorUpdates.some(
      (payload) => String(payload.schedulerType || '').trim().toLowerCase() === 'user'
    ),
    'Phase 3 should normalize the legacy positions scheduler anchor to user scope'
  );

  await assert.rejects(
    () =>
      service.updateSchedulerConfig('ops-admin', {
        schedulerType: 'global',
      } as any),
    /cannot be switched to global scope/
  );

  const runResponse = await service.runNow('ops-admin');
  assert.equal(runResponse.data.queued, true);
  assert.equal(actorPendingChecks, 1);
  assert.equal(actorRunningChecks, 1);
  assert.equal(createdRuns[0]?.actorUserId, 'ops-admin');
  assert.equal(createdRuns[0]?.executionContext, 'system');
  assert.equal(createdCommands[0]?.actorUserId, 'ops-admin');
  assert.equal((createdCommands[0]?.payload as Record<string, unknown>)?.actorUserId, 'ops-admin');

  await service.pauseScheduler('ops-admin');
  assert.equal(actorCancelChecks >= 1, true);
  assert.equal(actorQueuedCancels, 1);
}

async function testInternalPositionsControllerForcesSystemScope(): Promise<void> {
  const controller = new InternalPositionsSchedulerController() as any;
  let capturedPayload: Record<string, unknown> | null = null;

  controller.internalPositionsSyncService = {
    async runBatch(payload: Record<string, unknown>) {
      capturedPayload = payload;
      return { processedUsers: 1 };
    },
  };

  await controller.sync({
    targetUserIds: ['user-1', 'user-2'],
    brokerKeys: ['mudrex'],
    accountIds: ['account-1'],
    runLogId: '  run-1  ',
  });

  assert.deepEqual(capturedPayload, {
    executionScope: 'system_scheduler',
    requestUserId: env.scheduler.systemUserId,
    targetUserIds: [env.scheduler.systemUserId],
    brokerKeys: ['mudrex'],
    accountIds: ['account-1'],
    runLogId: 'run-1',
  });
}

async function testInternalOrdersControllerForcesSystemScope(): Promise<void> {
  const controller = new InternalOrdersSchedulerController() as any;
  let capturedPayload: Record<string, unknown> | null = null;

  controller.internalOrdersSyncService = {
    async runBatch(payload: Record<string, unknown>) {
      capturedPayload = payload;
      return { processedUsers: 1 };
    },
  };

  await controller.sync({
    targetUserIds: ['user-9'],
    brokerKeys: ['delta_exchange'],
    accountIds: ['account-9'],
    runLogId: '  run-9  ',
  });

  assert.deepEqual(capturedPayload, {
    executionScope: 'system_scheduler',
    requestUserId: env.scheduler.systemUserId,
    targetUserIds: [env.scheduler.systemUserId],
    brokerKeys: ['delta_exchange'],
    accountIds: ['account-9'],
    runLogId: 'run-9',
  });
}

async function testPositionsProductRefreshUsesSignedInUserScope(): Promise<void> {
  const service = new BrokerPositionsFacadeService() as any;
  let capturedPayload: Record<string, unknown> | null = null;

  service.userTimeZoneService = {
    async resolveUserTimeZone() {
      return 'UTC';
    },
  };
  service.brokerAccountRepository = {
    async getActiveBrokerAccounts(userId: string, brokerKey?: string) {
      assert.equal(userId, 'user-1');
      assert.equal(brokerKey, 'mudrex');
      return [
        {
          id: 'account-1',
          brokerKey: 'mudrex',
          status: 'Connected',
        },
      ];
    },
  };
  service.internalPositionsSyncService = {
    async runBatch(payload: Record<string, unknown>) {
      capturedPayload = payload;
      return {
        processedAccounts: 1,
        failedAccounts: 0,
        fetchedRecords: 0,
        insertedRecords: 0,
        updatedRecords: 0,
        skippedRecords: 0,
        failures: [],
      };
    },
  };

  const response = await service.requestPositionsRefresh('user-1', {
    brokerKey: 'mudrex',
    accountId: 'account-1',
  });

  assert.equal(response.requested, true);
  assert.deepEqual(capturedPayload, {
    executionScope: 'product_user',
    requestUserId: 'user-1',
    targetUserIds: ['user-1'],
    brokerKeys: ['mudrex'],
    accountIds: ['account-1'],
  });
}

async function testOrdersProductRefreshUsesSignedInUserScope(): Promise<void> {
  const service = new BrokerOrdersFacadeService() as any;
  let capturedPayload: Record<string, unknown> | null = null;

  service.userTimeZoneService = {
    async resolveUserTimeZone() {
      return 'UTC';
    },
  };
  service.brokerAccountRepository = {
    async getActiveBrokerAccounts(userId: string, brokerKey?: string) {
      assert.equal(userId, 'user-1');
      assert.equal(brokerKey, 'mudrex');
      return [
        {
          id: 'account-1',
          brokerKey: 'mudrex',
          status: 'Connected',
        },
      ];
    },
  };
  service.internalOrdersSyncService = {
    async runBatch(payload: Record<string, unknown>) {
      capturedPayload = payload;
      return {
        processedAccounts: 1,
        failedAccounts: 0,
        fetchedRecords: 0,
        insertedRecords: 0,
        updatedRecords: 0,
        skippedRecords: 0,
        failures: [],
      };
    },
  };

  const response = await service.requestOrdersRefresh('user-1', {
    brokerKey: 'mudrex',
    accountId: 'account-1',
  });

  assert.equal(response.requested, true);
  assert.deepEqual(capturedPayload, {
    executionScope: 'product_user',
    requestUserId: 'user-1',
    targetUserIds: ['user-1'],
    brokerKeys: ['mudrex'],
    accountIds: ['account-1'],
  });
}

async function testPositionsServiceHonorsSystemExecutionScope(): Promise<void> {
  const service = new InternalPositionsSyncService() as any;
  let allActiveCalls = 0;
  let systemCalls = 0;
  const userCalls: string[] = [];

  service.ensureSyncPositionsSnapshotTable = async () => {};
  service.ensureCheckpointTable = async () => {};
  service.brokerAccountRepository = {
    async getAllActiveBrokerAccounts() {
      allActiveCalls += 1;
      return [];
    },
    async getActiveSystemBrokerAccounts() {
      systemCalls += 1;
      return [];
    },
    async getActiveBrokerAccounts(userId: string) {
      userCalls.push(userId);
      return [];
    },
  };
  service.exchangeAssetUpdateLogRepository = {
    async createMany() {
      return [];
    },
  };
  service.positionReadModelRepository = {
    async upsertReadModels() {
      return undefined;
    },
    async markPositionsClosed() {
      return undefined;
    },
  };
  service.assetPriceRepository = {
    async getBySymbols() {
      return [];
    },
  };
  service.operationalEventService = {
    async logActivity() {
      return undefined;
    },
    async emitFailureAlert() {
      return undefined;
    },
  };
  service.suggestedTradesService = {
    async syncExecutionForPositionUpdates() {
      return undefined;
    },
  };

  const result = await service.runBatch({
    executionScope: 'system_scheduler',
    requestUserId: 'admin-user-1',
    targetUserIds: ['user-1'],
    brokerKeys: ['mudrex'],
  });

  assert.equal(allActiveCalls, 1);
  assert.equal(systemCalls, 0);
  assert.deepEqual(userCalls, []);
  assert.equal(result.processedUsers, 1);
}

async function testOrdersServiceHonorsProductExecutionScope(): Promise<void> {
  const service = new InternalOrdersSyncService() as any;
  let systemCalls = 0;
  const userCalls: string[] = [];

  service.schedulerRuntimeSchemaService = {
    async assertOrdersRuntimeSchemaReady() {
      return undefined;
    },
  };
  service.brokerAccountRepository = {
    async getActiveSystemBrokerAccounts() {
      systemCalls += 1;
      return [];
    },
    async getActiveBrokerAccounts(userId: string) {
      userCalls.push(userId);
      return [];
    },
  };
  service.exchangeAssetUpdateLogRepository = {
    async createMany() {
      return [];
    },
  };
  service.operationalEventService = {
    async logActivity() {
      return undefined;
    },
    async emitFailureAlert() {
      return undefined;
    },
  };
  service.suggestedTradesService = {
    async syncExecutionForOrderUpdates() {
      return undefined;
    },
  };

  const result = await service.runBatch({
    executionScope: 'product_user',
    requestUserId: 'user-55',
    targetUserIds: [env.scheduler.systemUserId],
    brokerKeys: ['delta_exchange'],
  });

  assert.equal(systemCalls, 0);
  assert.deepEqual(userCalls, ['user-55']);
  assert.equal(result.processedUsers, 1);
  assert.equal(result.failedUsers, 1);
}

async function run(): Promise<void> {
  testPhase3Markers();
  await testPositionsSchedulerRuntimeMigratesToUserScope();
  await testInternalPositionsControllerForcesSystemScope();
  await testInternalOrdersControllerForcesSystemScope();
  await testPositionsProductRefreshUsesSignedInUserScope();
  await testOrdersProductRefreshUsesSignedInUserScope();
  await testPositionsServiceHonorsSystemExecutionScope();
  await testOrdersServiceHonorsProductExecutionScope();
  console.log('Positions/orders sync Phase 3 assertions passed.');
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
