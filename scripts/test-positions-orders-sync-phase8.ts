import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { OrdersSchedulerService } from '../src/api/services/OrdersSchedulerService';
import { BrokerOrdersFacadeService } from '../src/api/services/BrokerOrdersFacadeService';

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

async function runOrdersReplayRuntimeAssertions(): Promise<void> {
  const service = new OrdersSchedulerService() as any;
  const checkpointResetCalls: string[] = [];
  const createdRunPayloads: Array<Record<string, unknown>> = [];
  const createdCommandPayloads: Array<Record<string, unknown>> = [];
  const anchorConfig = {
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
    schedulerType: 'user',
    lastStartedAt: null,
    lastFinishedAt: null,
    lastStatus: null,
    lastError: null,
    config: {
      sources: ['orders'],
      retentionDays: 30,
      lookbackDays: 90,
    },
  };
  const userConfig = {
    schedulerKey: 'orders-sync',
    userId: 'ops-admin',
    name: 'Orders Sync',
    description:
      'System reconciliation scheduler for broker order snapshots, checkpoints, and repair replay tooling.',
    enabled: true,
    cronExpression: '0 1 * * *',
    timezone: 'UTC',
    runAt: '01:00',
    intervalDays: 1,
    batchSize: 200,
    schedulerType: 'user',
    lastStartedAt: null,
    lastFinishedAt: null,
    lastStatus: null,
    lastError: null,
    runningLockUntil: null,
    config: {
      sources: ['orders'],
      retentionDays: 30,
      lookbackDays: 90,
    },
  };

  service.userTimeZoneService = {
    async resolveUserTimeZone() {
      return 'Asia/Kolkata';
    },
  };
  service.schedulerConfigRepository = {
    async createIfMissing() {
      return anchorConfig;
    },
    async updateByKey(_key: string, payload: Record<string, unknown>) {
      Object.assign(anchorConfig, payload);
      return anchorConfig;
    },
  };
  service.schedulerUserConfigRepository = {
    async createIfMissing(payload: Record<string, unknown>) {
      assert.equal(payload.schedulerKey, 'orders-sync');
      assert.equal(payload.userId, 'ops-admin');
      return userConfig;
    },
    async updateBySchedulerKeyAndUserId(
      schedulerKey: string,
      userId: string,
      payload: Record<string, unknown>
    ) {
      assert.equal(schedulerKey, 'orders-sync');
      assert.equal(userId, 'ops-admin');
      Object.assign(userConfig, payload);
      return userConfig;
    },
  };
  service.brokerAccountRepository = {
    async getAllActiveBrokerAccounts(brokerKey?: string) {
      assert.equal(brokerKey, 'mudrex');
      return [
        {
          id: 'acct-1',
          userId: 'owner-1',
          brokerKey: 'mudrex',
        },
        {
          id: 'acct-system',
          userId: null,
          brokerKey: 'mudrex',
        },
      ];
    },
  };
  service.schedulerCommandRepository = {
    async findLatestBySchedulerKeyAndTypeAndActorInStatuses(
      schedulerKey: string,
      commandType: string,
      actorUserId: string
    ) {
      assert.equal(schedulerKey, 'orders-sync');
      assert.equal(commandType, 'run_now');
      assert.equal(actorUserId, 'ops-admin');
      return null;
    },
    async createCommand(payload: Record<string, unknown>) {
      createdCommandPayloads.push(payload);
      return {
        id: 'orders-command-1',
        ...payload,
      };
    },
  };
  service.schedulerRunLogRepository = {
    async hasRunningRunBySchedulerKeyAndActor(schedulerKey: string, actorUserId: string) {
      assert.equal(schedulerKey, 'orders-sync');
      assert.equal(actorUserId, 'ops-admin');
      return false;
    },
    async createRun(payload: Record<string, unknown>) {
      createdRunPayloads.push(payload);
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
  service.resetCheckpointForAccount = async (accountId: string) => {
    checkpointResetCalls.push(accountId);
  };

  const response = await service.runNow('ops-admin', {
    accountId: 'acct-1',
    brokerKey: 'mudrex',
    resetCheckpoint: true,
  });

  assert.equal(response.data.queued, true);
  assert.match(
    String(response.data.message || ''),
    /checkpoint reset/i
  );
  assert.deepEqual(checkpointResetCalls, ['acct-1']);

  const runMeta = (createdRunPayloads[0]?.meta || {}) as Record<string, unknown>;
  const commandPayload = (createdCommandPayloads[0]?.payload || {}) as Record<string, unknown>;
  assert.equal(runMeta.trigger, 'repair-replay');
  assert.equal((runMeta.replay as Record<string, unknown>).mode, 'checkpoint_reset_then_scoped_run');
  assert.equal((runMeta.replay as Record<string, unknown>).accountId, 'acct-1');
  assert.equal((commandPayload.replay as Record<string, unknown>).checkpointReset, true);
  assert.deepEqual((commandPayload.scope as Record<string, unknown>).accountIds, ['acct-1']);

  const configResponse = await service.getSchedulerConfig('ops-admin');
  assert.equal(configResponse.data.ordersPolicy?.replayMode, 'checkpoint_reset_then_scoped_run');
  assert.equal(configResponse.data.ordersPolicy?.maxLookbackDays, 90);
}

async function runOrdersReplayExcludesOwnerlessSystemAccounts(): Promise<void> {
  const service = new OrdersSchedulerService() as any;
  const createdCommandPayloads: Array<Record<string, unknown>> = [];
  const anchorConfig = {
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
    schedulerType: 'user',
    lastStartedAt: null,
    lastFinishedAt: null,
    lastStatus: null,
    lastError: null,
    config: {
      sources: ['orders'],
      retentionDays: 30,
      lookbackDays: 90,
    },
  };
  const userConfig = {
    schedulerKey: 'orders-sync',
    userId: 'ops-admin',
    name: 'Orders Sync',
    description:
      'System reconciliation scheduler for broker order snapshots, checkpoints, and repair replay tooling.',
    enabled: true,
    cronExpression: '0 1 * * *',
    timezone: 'UTC',
    runAt: '01:00',
    intervalDays: 1,
    batchSize: 200,
    schedulerType: 'user',
    lastStartedAt: null,
    lastFinishedAt: null,
    lastStatus: null,
    lastError: null,
    runningLockUntil: null,
    config: {
      sources: ['orders'],
      retentionDays: 30,
      lookbackDays: 90,
    },
  };

  service.userTimeZoneService = {
    async resolveUserTimeZone() {
      return 'Asia/Kolkata';
    },
  };
  service.schedulerConfigRepository = {
    async createIfMissing() {
      return anchorConfig;
    },
    async updateByKey(_key: string, payload: Record<string, unknown>) {
      Object.assign(anchorConfig, payload);
      return anchorConfig;
    },
  };
  service.schedulerUserConfigRepository = {
    async createIfMissing(payload: Record<string, unknown>) {
      assert.equal(payload.schedulerKey, 'orders-sync');
      assert.equal(payload.userId, 'ops-admin');
      return userConfig;
    },
    async updateBySchedulerKeyAndUserId(
      schedulerKey: string,
      userId: string,
      payload: Record<string, unknown>
    ) {
      assert.equal(schedulerKey, 'orders-sync');
      assert.equal(userId, 'ops-admin');
      Object.assign(userConfig, payload);
      return userConfig;
    },
  };
  service.brokerAccountRepository = {
    async getAllActiveBrokerAccounts(brokerKey?: string) {
      assert.equal(brokerKey, 'mudrex');
      return [
        {
          id: 'acct-1',
          userId: 'owner-1',
          brokerKey: 'mudrex',
        },
        {
          id: 'acct-2',
          userId: 'owner-2',
          brokerKey: 'mudrex',
        },
        {
          id: 'acct-system',
          userId: null,
          brokerKey: 'mudrex',
        },
      ];
    },
  };
  service.schedulerCommandRepository = {
    async findLatestBySchedulerKeyAndTypeAndActorInStatuses(
      schedulerKey: string,
      commandType: string,
      actorUserId: string
    ) {
      assert.equal(schedulerKey, 'orders-sync');
      assert.equal(commandType, 'run_now');
      assert.equal(actorUserId, 'ops-admin');
      return null;
    },
    async createCommand(payload: Record<string, unknown>) {
      createdCommandPayloads.push(payload);
      return {
        id: 'orders-command-2',
        ...payload,
      };
    },
  };
  service.schedulerRunLogRepository = {
    async hasRunningRunBySchedulerKeyAndActor(schedulerKey: string, actorUserId: string) {
      assert.equal(schedulerKey, 'orders-sync');
      assert.equal(actorUserId, 'ops-admin');
      return false;
    },
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
  service.schedulerRuntimeSchemaService = {
    async assertOrdersRuntimeSchemaReady() {
      return undefined;
    },
  };

  const response = await service.runNow('ops-admin', {
    brokerKey: 'mudrex',
  });

  assert.equal(response.data.queued, true);
  const commandPayload = (createdCommandPayloads[0]?.payload || {}) as Record<string, unknown>;
  assert.deepEqual((commandPayload.scope as Record<string, unknown>).accountIds, [
    'acct-1',
    'acct-2',
  ]);
}

async function runOrdersProductTrustBoundaryAssertions(): Promise<void> {
  const service = new BrokerOrdersFacadeService() as any;
  let capturedRequest: Record<string, unknown> | null = null;

  service.userTimeZoneService = {
    async resolveUserTimeZone() {
      return 'Asia/Kolkata';
    },
  };
  service.brokerAccountRepository = {
    async getActiveBrokerAccounts(userId: string, brokerKey?: string) {
      assert.equal(userId, 'desk-user-1');
      assert.equal(brokerKey, 'delta_exchange');
      return [
        { id: 'acct-7', brokerKey: 'delta_exchange' },
        { id: 'acct-8', brokerKey: 'delta_exchange' },
      ];
    },
  };
  service.internalOrdersSyncService = {
    async runBatch(request: Record<string, unknown>) {
      capturedRequest = request;
      return {
        processedAccounts: 1,
        failedAccounts: 0,
        fetchedRecords: 4,
        insertedRecords: 1,
        updatedRecords: 2,
        skippedRecords: 1,
        failures: [],
      };
    },
  };

  const response = await service.requestOrdersRefresh('desk-user-1', {
    brokerKey: 'delta_exchange',
    accountId: 'acct-7',
  });

  assert.equal(response.requested, true);
  assert.equal(response.scope, 'account');
  assert.ok(capturedRequest, 'product refresh should delegate to internal orders sync');
  const normalizedRequest = capturedRequest as Record<string, unknown>;
  assert.equal(normalizedRequest.executionScope, 'product_user');
  assert.equal(normalizedRequest.requestUserId, 'desk-user-1');
  assert.deepEqual(normalizedRequest.targetUserIds, ['desk-user-1']);
  assert.deepEqual(normalizedRequest.accountIds, ['acct-7']);
  assert.deepEqual(normalizedRequest.brokerKeys, ['delta_exchange']);
}

async function run(): Promise<void> {
  const findings: string[] = [];

  await runOrdersReplayRuntimeAssertions();
  await runOrdersReplayExcludesOwnerlessSystemAccounts();
  await runOrdersProductTrustBoundaryAssertions();

  const phaseDoc = read('POSITIONS_ORDERS_SYNC_PHASE8.md');
  for (const marker of [
    'Phase 8 closes the `orders-sync` operational contract',
    '`orders-sync`',
    'runtime foundation diagnostics',
    'scoped replay',
    'checkpoint reset handling',
    '`/scheduler/orders`',
    '`/orders`',
    '`targetUserIds: [userId]`',
    '`npm run test:schedulers-phase7`',
    '`npm run test:schedulers-phase8`',
    'Phase 9 should focus on proof, regression, and signoff',
  ]) {
    if (!phaseDoc.includes(marker)) {
      findings.push(`POSITIONS_ORDERS_SYNC_PHASE8.md: missing Phase 8 marker ${marker}`);
    }
  }

  const readme = read('README.md');
  if (!readme.includes('POSITIONS_ORDERS_SYNC_PHASE8.md')) {
    findings.push('README.md: missing positions/orders sync Phase 8 baseline link');
  }
  if (!readme.includes('orders-specific operational freeze')) {
    findings.push('README.md: missing positions/orders sync Phase 8 summary');
  }
  if (!readme.includes('test:positions-orders-sync-phase8')) {
    findings.push('README.md: missing positions/orders sync Phase 8 verification command');
  }

  const packageSource = read('package.json');
  if (!packageSource.includes('"test:positions-orders-sync-phase8"')) {
    findings.push('package.json: missing positions/orders sync Phase 8 test script');
  }
  if (!packageSource.includes('npm run test:positions-orders-sync-phase8')) {
    findings.push('package.json: positions/orders sync Phase 8 guard must stay wired');
  }
  if (
    !packageSource.includes(
      'npm run test:schedulers-phase7 && npm run test:schedulers-phase8 && node --import tsx scripts/test-positions-orders-sync-phase8.ts'
    )
  ) {
    findings.push(
      'package.json: positions/orders sync Phase 8 command should build on the dedicated orders scheduler Phase 7 and Phase 8 suites'
    );
  }

  const ordersServiceSource = read('src/api/services/OrdersSchedulerService.ts');
  for (const marker of [
    'async runNow(',
    'resetCheckpoint',
    "trigger = runRequest.resetCheckpoint",
    "mode: 'checkpoint_reset_then_scoped_run'",
    'private async resolveScopedOrdersRun(',
    'private async resetCheckpointForAccount(',
    'ordersPolicy: this.buildOrdersPolicy(lookbackDays)',
  ]) {
    if (!ordersServiceSource.includes(marker)) {
      findings.push(`OrdersSchedulerService.ts: missing Phase 8 marker ${marker}`);
    }
  }

  const ordersControllerSource = read('src/api/controllers/OrdersSchedulerController.ts');
  for (const marker of [
    "@Post('/run')",
    "@Get('/sync-state')",
    "@Get('/sync-state/summary')",
  ]) {
    if (!ordersControllerSource.includes(marker)) {
      findings.push(`OrdersSchedulerController.ts: missing Phase 8 marker ${marker}`);
    }
  }

  const ordersDeskSource = read('src/api/services/BrokerOrdersFacadeService.ts');
  for (const marker of [
    'buildProductOwnedOrdersSyncRequest',
    'targetUserIds: [userId]',
    'No connected or idle broker routes are available for orders refresh on this desk.',
  ]) {
    if (!ordersDeskSource.includes(marker)) {
      findings.push(`BrokerOrdersFacadeService.ts: missing Phase 8 marker ${marker}`);
    }
  }

  assert.equal(
    findings.length,
    0,
    `Positions/orders sync Phase 8 guard failed:\n${findings.join('\n')}`
  );
  console.log('Positions/orders sync Phase 8 guard passed.');
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
