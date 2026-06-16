import assert from 'node:assert/strict';
import { runSuiteSteps } from './_support/run-script-suite';

// Consolidated module suite.

async function positions_orders_syncGuard01(): Promise<void> {
  const { default: fs } = await import("node:fs");
  const { default: path } = await import("node:path");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function run(): void {
  const findings: string[] = [];

  const phaseDoc = read('POSITIONS_ORDERS_SYNC_PHASE1.md');
  for (const marker of [
    '`positions-sync`',
    '`orders-sync`',
    '`/scheduler/positions`',
    '`/scheduler/orders`',
    '`/positions/futures/refresh`',
    '`/orders/futures/refresh`',
    '`/internal/positions/sync`',
    '`/internal/orders/sync`',
    'Phase 1 does not change runtime execution semantics yet.',
    'target ownership is a user-scoped scheduler record',
    'Phase 2 Entry Checklist',
  ]) {
    if (!phaseDoc.includes(marker)) {
      findings.push(`POSITIONS_ORDERS_SYNC_PHASE1.md: missing contract marker ${marker}`);
    }
  }

  const positionsChecklist = read('POSITIONS_SYNC_FUNCTIONAL_CHECKLIST.md');
  for (const marker of [
    'Scheduler key: `positions-sync`',
    'Scheduler is normalized to `schedulerType = user`.',
    'Product route base: `/positions`',
    'Internal sync route: `/internal/positions/sync`',
    '## 5. Scheduler And Cron All-Users Execution Scope',
    '## 6. Product Page Own-User Execution Scope',
  ]) {
    if (!positionsChecklist.includes(marker)) {
      findings.push(`POSITIONS_SYNC_FUNCTIONAL_CHECKLIST.md: missing marker ${marker}`);
    }
  }

  const ordersChecklist = read('ORDERS_SYNC_FUNCTIONAL_CHECKLIST.md');
  for (const marker of [
    'Scheduler key: `orders-sync`',
    'Scheduler is normalized to `schedulerType = user`.',
    'Product route base: `/orders`',
    'Internal sync route: `/internal/orders/sync`',
    '## 5. Scheduler And Cron All-Users Execution Scope',
    '## 6. Product Page Own-User Execution Scope',
  ]) {
    if (!ordersChecklist.includes(marker)) {
      findings.push(`ORDERS_SYNC_FUNCTIONAL_CHECKLIST.md: missing marker ${marker}`);
    }
  }

  const contractSource = read('src/api/utils/positionsOrdersSyncScopeContract.ts');
  for (const marker of [
    "export const POSITIONS_SYNC_SCHEDULER_KEY = 'positions-sync';",
    "export const ORDERS_SYNC_SCHEDULER_KEY = 'orders-sync';",
    "export const POSITIONS_SYNC_SCHEDULER_OWNERSHIP = 'user' as const;",
    "export const ORDERS_SYNC_SCHEDULER_OWNERSHIP = 'user' as const;",
    "export const POSITIONS_SYNC_ADMIN_ROUTE = '/scheduler/positions';",
    "export const ORDERS_SYNC_ADMIN_ROUTE = '/scheduler/orders';",
    "export const POSITIONS_INTERNAL_SYNC_ROUTE = '/internal/positions/sync';",
    "export const ORDERS_INTERNAL_SYNC_ROUTE = '/internal/orders/sync';",
    'export const ALL_USERS_BATCH_SYNC_SCHEDULERS = [',
    'export const USER_OWNED_PRODUCT_REFRESH_SURFACES = [',
  ]) {
    if (!contractSource.includes(marker)) {
      findings.push(`positionsOrdersSyncScopeContract.ts: missing Phase 1 marker ${marker}`);
    }
  }

  const positionsFacadeSource = read('src/api/services/BrokerPositionsFacadeService.ts');
  if (!positionsFacadeSource.includes('targetUserIds: [userId],')) {
    findings.push(
      'BrokerPositionsFacadeService.ts: /positions refresh must remain user-owned in Phase 1'
    );
  }

  const ordersFacadeSource = read('src/api/services/BrokerOrdersFacadeService.ts');
  if (!ordersFacadeSource.includes('targetUserIds: [userId],')) {
    findings.push(
      'BrokerOrdersFacadeService.ts: /orders refresh must remain user-owned in Phase 1'
    );
  }

  const positionsControllerSource = read('src/api/controllers/PositionsSchedulerController.ts');
  if (!positionsControllerSource.includes("@JsonController('/scheduler/positions')")) {
    findings.push('PositionsSchedulerController.ts: missing canonical admin route marker');
  }

  const ordersControllerSource = read('src/api/controllers/OrdersSchedulerController.ts');
  if (!ordersControllerSource.includes("@JsonController('/scheduler/orders')")) {
    findings.push('OrdersSchedulerController.ts: missing canonical admin route marker');
  }

  const internalPositionsControllerSource = read(
    'src/api/controllers/InternalPositionsSchedulerController.ts'
  );
  if (!internalPositionsControllerSource.includes("@JsonController('/internal/positions')")) {
    findings.push(
      'InternalPositionsSchedulerController.ts: missing canonical internal positions route marker'
    );
  }

  const internalOrdersControllerSource = read(
    'src/api/controllers/InternalOrdersSchedulerController.ts'
  );
  if (!internalOrdersControllerSource.includes("@JsonController('/internal/orders')")) {
    findings.push(
      'InternalOrdersSchedulerController.ts: missing canonical internal orders route marker'
    );
  }

  const readme = read('README.md');
  if (!readme.includes('POSITIONS_ORDERS_SYNC_PHASE1.md')) {
    findings.push('README.md: missing positions/orders sync Phase 1 baseline link');
  }
  if (!readme.includes('test:positions-orders-sync')) {
    findings.push('README.md: missing positions/orders sync verification command');
  }
  if (!readme.includes('frozen Phase 1 trust contract for `positions-sync` and `orders-sync`')) {
    findings.push('README.md: missing positions/orders sync Phase 1 baseline summary');
  }
  if (!readme.includes('target user-owned scheduler contract')) {
    findings.push('README.md: missing positions/orders sync target-contract summary');
  }

  const packageSource = read('package.json');
  if (!packageSource.includes('"test:positions-orders-sync"')) {
    findings.push('package.json: missing positions/orders sync module test script');
  }
  if (!packageSource.includes('"test:positions-orders-sync"')) {
    findings.push('package.json: positions/orders sync module guard must stay wired');
  }

  assert.equal(
    findings.length,
    0,
    `Positions/orders sync Phase 1 guard failed:\n${findings.join('\n')}`
  );
  console.log('Positions/orders sync Phase 1 guard passed.');
}

  await run();
}

async function positions_orders_syncGuard02(): Promise<void> {
  const { default: fs } = await import("node:fs");
  const { default: path } = await import("node:path");
  const { env } = await import("../src/env");
  const { ALL_USERS_BATCH_SYNC_SCHEDULERS, buildProductOwnedOrdersSyncRequest, buildProductOwnedPositionsSyncRequest, buildSystemOwnedOrdersSyncRequest, buildSystemOwnedPositionsSyncRequest, ORDERS_SYNC_RUNTIME_OWNERSHIP_LEGACY, ORDERS_SYNC_SCHEDULER_OWNERSHIP, POSITIONS_ORDERS_PRODUCT_SYNC_SCOPE, POSITIONS_ORDERS_SYSTEM_SYNC_SCOPE, POSITIONS_SYNC_RUNTIME_OWNERSHIP_LEGACY, POSITIONS_SYNC_SCHEDULER_OWNERSHIP, } = await import("../src/api/utils/positionsOrdersSyncScopeContract");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function testSharedOwnershipContract(): void {
  assert.equal(POSITIONS_SYNC_SCHEDULER_OWNERSHIP, 'user');
  assert.equal(ORDERS_SYNC_SCHEDULER_OWNERSHIP, 'user');
  assert.equal(POSITIONS_SYNC_RUNTIME_OWNERSHIP_LEGACY, 'user');
  assert.equal(ORDERS_SYNC_RUNTIME_OWNERSHIP_LEGACY, 'user');
  assert.deepEqual(ALL_USERS_BATCH_SYNC_SCHEDULERS, ['positions-sync', 'orders-sync']);
}

function testSharedExecutionRequestBuilders(): void {
  const systemPositions = buildSystemOwnedPositionsSyncRequest({
    targetUserIds: ['someone-else'],
    brokerKeys: ['delta_exchange'],
    accountIds: ['acct-1'],
  });
  assert.equal(systemPositions.executionScope, POSITIONS_ORDERS_SYSTEM_SYNC_SCOPE);
  assert.deepEqual(systemPositions.targetUserIds, [env.scheduler.systemUserId]);
  assert.equal(systemPositions.requestUserId, env.scheduler.systemUserId);
  assert.deepEqual(systemPositions.brokerKeys, ['delta_exchange']);
  assert.deepEqual(systemPositions.accountIds, ['acct-1']);

  const systemOrders = buildSystemOwnedOrdersSyncRequest({
    targetUserIds: ['someone-else'],
    brokerKeys: ['mudrex'],
    accountIds: ['acct-2'],
  });
  assert.equal(systemOrders.executionScope, POSITIONS_ORDERS_SYSTEM_SYNC_SCOPE);
  assert.deepEqual(systemOrders.targetUserIds, [env.scheduler.systemUserId]);
  assert.equal(systemOrders.requestUserId, env.scheduler.systemUserId);
  assert.deepEqual(systemOrders.brokerKeys, ['mudrex']);
  assert.deepEqual(systemOrders.accountIds, ['acct-2']);

  const productPositions = buildProductOwnedPositionsSyncRequest('user-7', {
    targetUserIds: ['ignored-user'],
    brokerKeys: ['delta_exchange'],
  });
  assert.equal(productPositions.executionScope, POSITIONS_ORDERS_PRODUCT_SYNC_SCOPE);
  assert.deepEqual(productPositions.targetUserIds, ['user-7']);
  assert.equal(productPositions.requestUserId, 'user-7');

  const productOrders = buildProductOwnedOrdersSyncRequest('user-9', {
    targetUserIds: ['ignored-user'],
    accountIds: ['acct-9'],
  });
  assert.equal(productOrders.executionScope, POSITIONS_ORDERS_PRODUCT_SYNC_SCOPE);
  assert.deepEqual(productOrders.targetUserIds, ['user-9']);
  assert.equal(productOrders.requestUserId, 'user-9');
  assert.deepEqual(productOrders.accountIds, ['acct-9']);
}

function testPhase2Markers(): void {
  const findings: string[] = [];

  const phaseDoc = read('POSITIONS_ORDERS_SYNC_PHASE2.md');
  for (const marker of [
    '`orders-sync`',
    '`positions-sync`',
    'positionsOrdersSyncScopeContract.ts',
    'target user-owned scheduler',
    'shared contract layer',
    'Phase 3 Entry Checklist',
  ]) {
    if (!phaseDoc.includes(marker)) {
      findings.push(`POSITIONS_ORDERS_SYNC_PHASE2.md: missing marker ${marker}`);
    }
  }

  const contractSource = read('src/api/utils/positionsOrdersSyncScopeContract.ts');
  for (const marker of [
    "export const POSITIONS_SYNC_SCHEDULER_OWNERSHIP = 'user' as const;",
    "export const ORDERS_SYNC_SCHEDULER_OWNERSHIP = 'user' as const;",
    "export const POSITIONS_SYNC_RUNTIME_OWNERSHIP = 'user' as const;",
    "export const ORDERS_SYNC_RUNTIME_OWNERSHIP = 'user' as const;",
    'export const ALL_USERS_BATCH_SYNC_SCHEDULERS = [',
    'export const ALL_USERS_SYSTEM_SYNC_SCHEDULERS = [] as const;',
    'buildSystemOwnedPositionsSyncRequest(',
    'buildSystemOwnedOrdersSyncRequest(',
    'buildProductOwnedPositionsSyncRequest(',
    'buildProductOwnedOrdersSyncRequest(',
  ]) {
    if (!contractSource.includes(marker)) {
      findings.push(`positionsOrdersSyncScopeContract.ts: missing Phase 2 marker ${marker}`);
    }
  }

  const ordersServiceSource = read('src/api/services/OrdersSchedulerService.ts');
  for (const marker of [
    'ORDERS_SYNC_SCHEDULER_OWNERSHIP',
    'ORDERS_SYNC_SCHEDULER_NAME',
    'resolveSystemExecutionActorUserId(',
  ]) {
    if (!ordersServiceSource.includes(marker)) {
      findings.push(`OrdersSchedulerService.ts: missing Phase 2 transition marker ${marker}`);
    }
  }

  const readme = read('README.md');
  if (!readme.includes('POSITIONS_ORDERS_SYNC_PHASE2.md')) {
    findings.push('README.md: missing positions/orders sync Phase 2 baseline link');
  }
  if (!readme.includes('test:positions-orders-sync')) {
    findings.push('README.md: missing positions/orders sync verification command');
  }
  if (!readme.includes('shared contract alignment')) {
    findings.push('README.md: missing positions/orders sync Phase 2 shared-contract summary');
  }

  const packageSource = read('package.json');
  if (!packageSource.includes('"test:positions-orders-sync"')) {
    findings.push('package.json: missing positions/orders sync module test script');
  }
  if (!packageSource.includes('"test:positions-orders-sync"')) {
    findings.push('package.json: positions/orders sync module guard must stay wired');
  }

  assert.equal(
    findings.length,
    0,
    `Positions/orders sync Phase 2 markers failed:\n${findings.join('\n')}`
  );
}

async function run(): Promise<void> {
  testSharedOwnershipContract();
  testSharedExecutionRequestBuilders();
  testPhase2Markers();
  console.log('Positions/orders sync Phase 2 assertions passed.');
}

  await run();
}

async function positions_orders_syncGuard03(): Promise<void> {
  const { default: fs } = await import("node:fs");
  const { default: path } = await import("node:path");
  const { BrokerOrdersFacadeService } = await import("../src/api/services/BrokerOrdersFacadeService");
  const { BrokerPositionsFacadeService } = await import("../src/api/services/BrokerPositionsFacadeService");
  const { InternalOrdersSchedulerController } = await import("../src/api/controllers/InternalOrdersSchedulerController");
  const { InternalPositionsSchedulerController } = await import("../src/api/controllers/InternalPositionsSchedulerController");
  const { InternalOrdersSyncService } = await import("../src/api/services/InternalOrdersSyncService");
  const { InternalPositionsSyncService } = await import("../src/api/services/InternalPositionsSyncService");
  const { PositionsSchedulerService } = await import("../src/api/services/PositionsSchedulerService");
  const { env } = await import("../src/env");

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
  if (!readme.includes('test:positions-orders-sync')) {
    findings.push('README.md: missing positions/orders sync verification command');
  }

  const positionsSyncSource = read('src/api/services/InternalPositionsSyncService.ts');
  for (const marker of [
    'resolveHistoryOverlapDays(',
    'const historyOverlapDays = this.resolveHistoryOverlapDays(adapter);',
    'historyStart = this.addDays(checkpoint, -historyOverlapDays);',
  ]) {
    if (!positionsSyncSource.includes(marker)) {
      findings.push(`InternalPositionsSyncService.ts: missing positions history overlap marker ${marker}`);
    }
  }

  const positionsAdapterTypesSource = read('src/brokers/capabilities/positions/types.ts');
  if (!positionsAdapterTypesSource.includes('historyOverlapDays?: number;')) {
    findings.push('positions types: missing broker-specific history overlap contract marker');
  }

  const deltaAdapterSource = read('src/brokers/capabilities/positions/DeltaExchangePositionsAdapter.ts');
  for (const marker of [
    "readonly historyWindowMode = 'contiguous' as const;",
    'readonly historyOverlapDays = 30;',
  ]) {
    if (!deltaAdapterSource.includes(marker)) {
      findings.push(`DeltaExchangePositionsAdapter.ts: missing overlap marker ${marker}`);
    }
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
  const cancelledActors: string[] = [];
  const queuedCancelledActors: string[] = [];
  const bulkUserUpdates: Array<Record<string, unknown>> = [];

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
    async listBySchedulerKey(schedulerKey: string) {
      assert.equal(schedulerKey, 'positions-sync');
      return [
        { userId: 'ops-admin' },
        { userId: 'ops-user-2' },
      ];
    },
    async updateManyBySchedulerKey(schedulerKey: string, payload: Record<string, unknown>) {
      assert.equal(schedulerKey, 'positions-sync');
      bulkUserUpdates.push(payload);
      Object.assign(userConfig, payload);
      return 2;
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
      cancelledActors.push(actorUserId);
      assert.equal(schedulerKey, 'positions-sync');
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
      queuedCancelledActors.push(actorUserId);
      assert.equal(schedulerKey, 'positions-sync');
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
  assert.equal(
    (createdCommands[0]?.payload as Record<string, unknown>)?.actorUserId,
    env.scheduler.systemUserId
  );
  assert.equal(
    (createdCommands[0]?.payload as Record<string, unknown>)?.requestedByUserId,
    'ops-admin'
  );

  await service.pauseScheduler('ops-admin');
  assert.equal((bulkUserUpdates[0]?.enabled as boolean | undefined) ?? null, false);
  assert.equal(anchorUpdates.at(-1)?.enabled, false);
  assert.deepEqual(cancelledActors.sort(), ['ops-admin', 'ops-user-2']);
  assert.deepEqual(queuedCancelledActors.sort(), ['ops-admin', 'ops-user-2']);

  const resumeResponse = await service.resumeScheduler('ops-admin');
  assert.equal(resumeResponse.data.action, 'resume');
  assert.equal((bulkUserUpdates[1]?.enabled as boolean | undefined) ?? null, true);
  assert.equal(anchorUpdates.at(-1)?.enabled, true);
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

  await run();
}

async function positions_orders_syncGuard04(): Promise<void> {
  const { default: fs } = await import("node:fs");
  const { default: path } = await import("node:path");
  const { OrdersSchedulerService } = await import("../src/api/services/OrdersSchedulerService");
  const { InternalOrdersSyncService } = await import("../src/api/services/InternalOrdersSyncService");
  const { InternalPositionsSyncService } = await import("../src/api/services/InternalPositionsSyncService");
  const { coreDataSource } = await import("../src/database/data-source");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function testPhase4Markers(): void {
  const findings: string[] = [];

  const phaseDoc = read('POSITIONS_ORDERS_SYNC_PHASE4.md');
  for (const marker of [
    '`orders-sync`',
    '`positions-sync`',
    'user-scoped scheduler record',
    'scheduler_user_configs',
    'legacy scheduler anchor',
    'Mudrex',
    'Delta',
    'Phase 5 Entry Checklist',
  ]) {
    if (!phaseDoc.includes(marker)) {
      findings.push(`POSITIONS_ORDERS_SYNC_PHASE4.md: missing marker ${marker}`);
    }
  }

  const ordersServiceSource = read('src/api/services/OrdersSchedulerService.ts');
  for (const marker of [
    'ORDERS_SYNC_SCHEDULER_OWNERSHIP',
    'schedulerUserConfigRepository',
    'findLatestBySchedulerKeyAndTypeAndActorInStatuses',
    'hasRunningRunBySchedulerKeyAndActor',
    'updateBySchedulerKeyAndUserId',
    'findByIdAndSchedulerKey(',
    'cancelQueuedRunsBySchedulerKeyAndActor',
    'cancelPendingBySchedulerKeyAndActor',
    'ensureLegacySchedulerAnchor(',
    'ensureSchedulerConfig(',
    'cannot be switched to global scope',
    'resolveSystemExecutionActorUserId(',
  ]) {
    if (!ordersServiceSource.includes(marker)) {
      findings.push(`OrdersSchedulerService.ts: missing Phase 4 marker ${marker}`);
    }
  }

  const readme = read('README.md');
  if (!readme.includes('POSITIONS_ORDERS_SYNC_PHASE4.md')) {
    findings.push('README.md: missing positions/orders sync Phase 4 baseline link');
  }
  if (!readme.includes('test:positions-orders-sync')) {
    findings.push('README.md: missing positions/orders sync verification command');
  }
  if (!readme.includes('orders runtime migration')) {
    findings.push('README.md: missing positions/orders sync Phase 4 runtime summary');
  }

  assert.equal(
    findings.length,
    0,
    `Positions/orders sync Phase 4 markers failed:\n${findings.join('\n')}`
  );
}

async function testOrdersSchedulerRuntimeMigratesToUserScope(): Promise<void> {
  const service = new OrdersSchedulerService() as any;
  const anchorConfig: any = {
    key: 'orders-sync',
    name: 'Orders Sync',
    description:
      'System reconciliation scheduler for broker order snapshots, checkpoints, and repair replay tooling.',
    enabled: false,
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
  };
  const userConfig: any = {
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
    config: {
      sources: ['orders'],
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
  const cancelledActors: string[] = [];
  const queuedCancelledActors: string[] = [];
  const bulkUserUpdates: Array<Record<string, unknown>> = [];

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
      assert.equal(key, 'orders-sync');
      anchorUpdates.push(payload);
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
    async listBySchedulerKey(schedulerKey: string) {
      assert.equal(schedulerKey, 'orders-sync');
      return [
        { userId: 'ops-admin' },
        { userId: 'ops-user-2' },
      ];
    },
    async updateManyBySchedulerKey(schedulerKey: string, payload: Record<string, unknown>) {
      assert.equal(schedulerKey, 'orders-sync');
      bulkUserUpdates.push(payload);
      Object.assign(userConfig, payload);
      return 2;
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
      assert.equal(schedulerKey, 'orders-sync');
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
      _schedulerKey: string,
      actorUserId: string
    ) {
      cancelledActors.push(actorUserId);
      return 0;
    },
    async cancelPendingBySchedulerKeyAndTypeAndActor() {
      return 0;
    },
  };
  service.schedulerRunLogRepository = {
    async hasRunningRunBySchedulerKeyAndActor(schedulerKey: string, actorUserId: string) {
      actorRunningChecks += 1;
      assert.equal(schedulerKey, 'orders-sync');
      assert.equal(actorUserId, 'ops-admin');
      return false;
    },
    async createRun(payload: Record<string, unknown>) {
      createdRuns.push(payload);
      return payload;
    },
    async cancelQueuedRunsBySchedulerKeyAndActor(
      _schedulerKey: string,
      actorUserId: string
    ) {
      queuedCancelledActors.push(actorUserId);
      return 0;
    },
  };
  service.brokerAccountRepository = {
    async getAllActiveBrokerAccounts() {
      return [];
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
  service.schedulerRuntimeSchemaService = {
    async assertOrdersRuntimeSchemaReady() {
      return undefined;
    },
  };
  (service as any).emitSchedulerFailureAlert = async () => {};

  const configResponse = await service.getSchedulerConfig('ops-admin');
  assert.equal(configResponse.data.schedulerType, 'user');
  assert.equal(configResponse.data.ordersPolicy?.maxLookbackDays, 90);
  assert.ok(
    anchorUpdates.some(
      (payload) => String(payload.schedulerType || '').trim().toLowerCase() === 'user'
    ),
    'Phase 4 should normalize the legacy orders scheduler anchor to user scope'
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
  assert.equal(
    (createdCommands[0]?.payload as Record<string, unknown>)?.requestedByUserId,
    'ops-admin'
  );

  const pauseResponse = await service.pauseScheduler('ops-admin');
  assert.equal(pauseResponse.data.action, 'pause');
  assert.equal((bulkUserUpdates[0]?.enabled as boolean | undefined) ?? null, false);
  assert.equal(anchorUpdates.at(-1)?.enabled, false);
  assert.deepEqual(cancelledActors.sort(), ['ops-admin', 'ops-user-2']);
  assert.deepEqual(queuedCancelledActors.sort(), ['ops-admin', 'ops-user-2']);

  const resumeResponse = await service.resumeScheduler('ops-admin');
  assert.equal(resumeResponse.data.action, 'resume');
  assert.equal((bulkUserUpdates[1]?.enabled as boolean | undefined) ?? null, true);
  assert.equal(anchorUpdates.at(-1)?.enabled, true);
}

async function testPositionsSystemSchedulerCoversMudrexAndDeltaWithFailureIsolation(): Promise<void> {
  const service = new InternalPositionsSyncService() as any;
  const originalQuery = (coreDataSource as any).query;
  const routingCalls: Array<{ userId: string; brokerKey: string; accountId: string }> = [];
  const adapterCalls: string[] = [];
  const sameCycleEvents: string[] = [];
  const readModelRows: Array<Record<string, unknown>> = [];
  const protectionRefreshCalls: Array<{ userId: string; brokerKey: string; accountId: string }> = [];
  const suggestedTradePositionSyncCalls: Array<{
    userId: string;
    brokerKey: string;
    accountId: string;
    symbols: string[];
  }> = [];
  let getAllActiveCalls = 0;
  let getActiveSystemCalls = 0;

  service.ensureSyncPositionsSnapshotTable = async () => {};
  service.ensureCheckpointTable = async () => {};
  service.brokerAccountRepository = {
    async getAllActiveBrokerAccounts() {
      getAllActiveCalls += 1;
      return [
        {
          id: 'acct-mudrex',
          userId: 'user-1',
          brokerKey: 'mudrex',
          status: 'Connected',
        },
        {
          id: 'acct-delta',
          userId: 'user-2',
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
    async getActiveSystemBrokerAccounts() {
      getActiveSystemCalls += 1;
      return [];
    },
  };
  service.brokerAccountRoutingService = {
    async resolve(userId: string, brokerKey: string, accountId: string) {
      routingCalls.push({ userId, brokerKey, accountId });
      return { userId, brokerKey, accountId };
    },
  };
  service.brokerRuntimeRegistry = {
    getPositionsAdapter(brokerKey: string) {
      const normalizedBrokerKey = String(brokerKey || '').trim().toLowerCase();
      if (normalizedBrokerKey === 'mudrex') {
        return {
          async getPositions(_query: unknown, route: { userId: string; accountId: string }) {
            adapterCalls.push(`mudrex:open:${route.userId}:${route.accountId}`);
            return [
              {
                id: 'pos-1',
                external_id: 'pos-1',
                symbol: 'BTCUSDT',
                status: 'OPEN',
                side: 'LONG',
                entry_price: '100',
                quantity: '1',
              },
            ];
          },
          async getPositionHistory(_query: unknown, route: { userId: string; accountId: string }) {
            adapterCalls.push(`mudrex:history:${route.userId}:${route.accountId}`);
            return [];
          },
        };
      }
      if (normalizedBrokerKey === 'delta_exchange') {
        return {
          async getPositions(_query: unknown, route: { userId: string; accountId: string }) {
            adapterCalls.push(`delta_exchange:open:${route.userId}:${route.accountId}`);
            throw new Error('Delta open positions unavailable');
          },
          async getPositionHistory(
            _query: unknown,
            route: { userId: string; accountId: string }
          ) {
            adapterCalls.push(`delta_exchange:history:${route.userId}:${route.accountId}`);
            throw new Error('Delta position history unavailable');
          },
        };
      }
      throw new Error(`Unexpected positions adapter request for ${brokerKey}`);
    },
  };
  service.assetPriceRepository = {
    async getBySymbols() {
      return [];
    },
  };
  service.exchangeAssetUpdateLogRepository = {
    async createMany() {
      return [];
    },
  };
  service.positionReadModelRepository = {
    async upsertReadModels(rows: Array<Record<string, unknown>>) {
      sameCycleEvents.push(`read-model:${rows.map((row) => row.symbol).join(',')}`);
      readModelRows.push(...rows);
      return undefined;
    },
    async refreshOpenDeltaProtectionFromOrderSnapshots(input: {
      userId: string;
      brokerKey: string;
      accountId: string;
    }) {
      sameCycleEvents.push(`protection-refresh:${input.brokerKey}:${input.accountId}`);
      protectionRefreshCalls.push(input);
      return undefined;
    },
    async markPositionsClosed() {
      return undefined;
    },
  };
  service.suggestedTradesService = {
    async syncExecutionForPositionUpdates(
      userId: string,
      brokerKey: string,
      accountId: string,
      symbols: string[]
    ) {
      sameCycleEvents.push(`suggested-trades:${brokerKey}:${accountId}:${symbols.join(',')}`);
      suggestedTradePositionSyncCalls.push({ userId, brokerKey, accountId, symbols });
      return 1;
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
  service.upsertPositionSnapshotBatch = async (rows: Array<Record<string, unknown>>) => {
    sameCycleEvents.push(`snapshot-batch:${rows.map((row) => row.symbol).join(',')}`);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.userId, 'user-1');
    assert.equal(rows[0]?.accountId, 'acct-mudrex');
    assert.equal(rows[0]?.brokerKey, 'mudrex');
    assert.equal(rows[0]?.symbol, 'BTCUSDT');
    return {
      inserted: 1,
      updated: 0,
      skipped: 0,
      symbols: ['BTCUSDT'],
    };
  };
  service.getCheckpoint = async () => null;
  service.saveCheckpoint = async () => undefined;

  (coreDataSource as any).query = async (sql: string) => {
    const statement = String(sql || '');
    if (statement.includes('SELECT NOW() AS now')) {
      return [{ now: new Date('2026-04-11T00:00:00.000Z') }];
    }
    if (statement.includes('FROM scheduler_positions_snapshots')) {
      return [];
    }
    if (statement.includes('UPDATE scheduler_positions_snapshots')) {
      return [{ affectedRows: 0 }];
    }
    throw new Error(`Unexpected SQL in positions/orders sync phase 4 test: ${statement}`);
  };

  try {
    const result = await service.runBatch({
      executionScope: 'system_scheduler',
      requestUserId: 'admin-user-1',
      targetUserIds: ['user-overridden'],
      brokerKeys: ['mudrex', 'delta_exchange'],
      accountIds: ['acct-mudrex', 'acct-delta'],
      startDate: '2026-04-10',
      endDate: '2026-04-10',
    });

    assert.equal(getAllActiveCalls, 1);
    assert.equal(getActiveSystemCalls, 0);
    assert.deepEqual(
      routingCalls.map((call) => call.userId),
      ['user-1', 'user-2']
    );
    assert.equal(adapterCalls[0], 'mudrex:open:user-1:acct-mudrex');
    assert.ok(adapterCalls.includes('mudrex:history:user-1:acct-mudrex'));
    assert.ok(adapterCalls.includes('delta_exchange:open:user-2:acct-delta'));
    assert.ok(adapterCalls.includes('delta_exchange:history:user-2:acct-delta'));
    assert.equal(result.processedUsers, 2);
    assert.equal(result.succeededUsers, 1);
    assert.equal(result.failedUsers, 1);
    assert.equal(result.processedAccounts, 2);
    assert.equal(result.failedAccounts, 1);
    assert.equal(result.insertedRecords, 1);
    assert.equal(readModelRows.length, 1);
    assert.equal(readModelRows[0]?.userId, 'user-1');
    assert.equal(readModelRows[0]?.accountId, 'acct-mudrex');
    assert.equal(readModelRows[0]?.brokerKey, 'mudrex');
    assert.equal(readModelRows[0]?.symbol, 'BTCUSDT');
    assert.deepEqual(protectionRefreshCalls, [
      { userId: 'user-1', brokerKey: 'mudrex', accountId: 'acct-mudrex' },
    ]);
    assert.deepEqual(suggestedTradePositionSyncCalls, [
      {
        userId: 'user-1',
        brokerKey: 'mudrex',
        accountId: 'acct-mudrex',
        symbols: ['BTCUSDT'],
      },
    ]);
    assert.deepEqual(sameCycleEvents, [
      'snapshot-batch:BTCUSDT',
      'read-model:BTCUSDT',
      'protection-refresh:mudrex:acct-mudrex',
      'suggested-trades:mudrex:acct-mudrex:BTCUSDT',
    ]);
    assert.ok(
      result.failures.some((item: { error: string }) =>
        String(item.error || '').includes(
          'positions sync failed for account acct-delta (delta_exchange)'
        )
      )
    );
    assert.ok(
      result.failures.some((item: { error: string }) =>
        String(item.error || '').includes('All scoped broker accounts failed during positions sync')
      )
    );
  } finally {
    (coreDataSource as any).query = originalQuery;
  }
}

async function testOrdersSystemSchedulerCoversMudrexAndDeltaWithFailureIsolation(): Promise<void> {
  const service = new InternalOrdersSyncService() as any;
  const originalQuery = (coreDataSource as any).query;
  const routingCalls: Array<{ userId: string; brokerKey: string; accountId: string }> = [];
  const adapterCalls: string[] = [];
  let getAllActiveCalls = 0;
  let getActiveSystemCalls = 0;

  service.schedulerRuntimeSchemaService = {
    async assertOrdersRuntimeSchemaReady() {
      return undefined;
    },
  };
  service.brokerAccountRepository = {
    async getAllActiveBrokerAccounts() {
      getAllActiveCalls += 1;
      return [
        {
          id: 'acct-mudrex',
          userId: 'user-1',
          brokerKey: 'mudrex',
          status: 'Connected',
        },
        {
          id: 'acct-delta',
          userId: 'user-2',
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
    async getActiveSystemBrokerAccounts() {
      getActiveSystemCalls += 1;
      return [];
    },
  };
  service.brokerAccountRoutingService = {
    async resolve(userId: string, brokerKey: string, accountId: string) {
      routingCalls.push({ userId, brokerKey, accountId });
      return { userId, brokerKey, accountId };
    },
  };
  service.brokerRuntimeRegistry = {
    getOrdersAdapter(brokerKey: string) {
      const normalizedBrokerKey = String(brokerKey || '').trim().toLowerCase();
      if (normalizedBrokerKey === 'mudrex') {
        return {
          async listOpenOrders(_query: unknown, route: { userId: string; accountId: string }) {
            adapterCalls.push(`mudrex:open:${route.userId}:${route.accountId}`);
            return [
              {
                id: 'ord-1',
                order_id: 'ord-1',
                symbol: 'BTCUSDT',
                status: 'OPEN',
                price: '100',
                created_at: '2026-04-10T00:00:00.000Z',
              },
            ];
          },
          async getOrderHistory(_query: unknown, route: { userId: string; accountId: string }) {
            adapterCalls.push(`mudrex:history:${route.userId}:${route.accountId}`);
            return [];
          },
        };
      }
      if (normalizedBrokerKey === 'delta_exchange') {
        return {
          async listOpenOrders(_query: unknown, route: { userId: string; accountId: string }) {
            adapterCalls.push(`delta_exchange:open:${route.userId}:${route.accountId}`);
            throw new Error('Delta open orders unavailable');
          },
          async getOrderHistory(_query: unknown, route: { userId: string; accountId: string }) {
            adapterCalls.push(`delta_exchange:history:${route.userId}:${route.accountId}`);
            throw new Error('Delta order history unavailable');
          },
        };
      }
      throw new Error(`Unexpected orders adapter request for ${brokerKey}`);
    },
  };
  service.exchangeAssetUpdateLogRepository = {
    async createMany() {
      return [];
    },
  };
  service.suggestedTradesService = {
    async syncExecutionForOrderUpdates() {
      return undefined;
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
  service.upsertOrderSnapshotsFromItems = async (
    userId: string,
    accountId: string,
    brokerKey: string
  ) => {
    assert.equal(userId, 'user-1');
    assert.equal(accountId, 'acct-mudrex');
    assert.equal(brokerKey, 'mudrex');
    return {
      inserted: 1,
      updated: 0,
      skipped: 0,
      orderIds: ['ord-1'],
    };
  };
  service.getCheckpoint = async () => null;
  service.saveCheckpoint = async () => undefined;

  (coreDataSource as any).query = async (sql: string) => {
    const statement = String(sql || '');
    if (statement.includes('FROM scheduler_orders_snapshots')) {
      return [];
    }
    if (statement.includes('UPDATE scheduler_orders_snapshots')) {
      return [{ affectedRows: 0 }];
    }
    throw new Error(`Unexpected SQL in positions/orders sync phase 4 test: ${statement}`);
  };

  try {
    const result = await service.runBatch({
      executionScope: 'system_scheduler',
      requestUserId: 'admin-user-1',
      targetUserIds: ['user-overridden'],
      brokerKeys: ['mudrex', 'delta_exchange'],
      accountIds: ['acct-mudrex', 'acct-delta'],
      startDate: '2026-04-10',
      endDate: '2026-04-10',
    });

    assert.equal(getAllActiveCalls, 1);
    assert.equal(getActiveSystemCalls, 0);
    assert.deepEqual(
      routingCalls.map((call) => call.userId),
      ['user-1', 'user-2']
    );
    assert.equal(adapterCalls[0], 'mudrex:open:user-1:acct-mudrex');
    assert.ok(adapterCalls.includes('mudrex:history:user-1:acct-mudrex'));
    assert.ok(adapterCalls.includes('delta_exchange:open:user-2:acct-delta'));
    assert.ok(adapterCalls.includes('delta_exchange:history:user-2:acct-delta'));
    assert.equal(result.processedUsers, 2);
    assert.equal(result.succeededUsers, 1);
    assert.equal(result.failedUsers, 1);
    assert.equal(result.processedAccounts, 2);
    assert.equal(result.failedAccounts, 1);
    assert.equal(result.insertedRecords, 1);
    assert.ok(
      result.failures.some((item: { error: string }) =>
        String(item.error || '').includes('orders sync failed for account acct-delta (delta_exchange)')
      )
    );
    assert.ok(
      result.failures.some((item: { error: string }) =>
        String(item.error || '').includes('All scoped broker accounts failed during orders sync')
      )
    );
  } finally {
    (coreDataSource as any).query = originalQuery;
  }
}

async function testOrdersSyncBackfillsTrackedDeltaProtectiveOrdersById(): Promise<void> {
  const service = new InternalOrdersSyncService() as any;
  const originalQuery = (coreDataSource as any).query;
  const getOrderCalls: string[] = [];
  const syncedOrderIds: string[][] = [];
  let capturedItems: Array<Record<string, unknown>> = [];
  let protectedIdsFromReconciliation: string[] = [];
  const staleCloseParams: unknown[][] = [];

  service.schedulerRuntimeSchemaService = {
    async assertOrdersRuntimeSchemaReady() {
      return undefined;
    },
  };
  service.brokerAccountRepository = {
    async getActiveBrokerAccounts(userId: string) {
      assert.equal(userId, 'user-1');
      return [
        {
          id: 'acct-delta',
          userId,
          brokerKey: 'delta_exchange',
          status: 'Connected',
        },
      ];
    },
  };
  service.brokerAccountRoutingService = {
    async resolve(userId: string, brokerKey: string, accountId: string) {
      return { userId, brokerKey, accountId };
    },
  };
  service.brokerRuntimeRegistry = {
    getOrdersAdapter(brokerKey: string) {
      assert.equal(brokerKey, 'delta_exchange');
      return {
        async listOpenOrders() {
          return [];
        },
        async getOrderHistory() {
          return [
            {
              id: 'entry-1',
              order_id: 'entry-1',
              symbol: 'BTCUSD',
              status: 'CLOSED',
              created_at: '2026-04-20T06:12:19.000Z',
            },
          ];
        },
        async getOrder(orderId: string) {
          getOrderCalls.push(orderId);
          return {
            id: orderId,
            order_id: orderId,
            symbol: 'BTCUSD',
            status: 'PENDING',
            side: 'sell',
            stop_order_type: orderId.startsWith('sl-')
              ? 'stop_loss_order'
              : 'take_profit_order',
            reduce_only: true,
            created_at: '2026-04-20T06:12:20.000Z',
          };
        },
      };
    },
  };
  service.exchangeAssetUpdateLogRepository = {
    async createMany() {
      return [];
    },
  };
  service.suggestedTradesService = {
    async syncExecutionForOrderUpdates(
      _userId: string,
      _brokerKey: string,
      _accountId: string,
      orderIds: string[]
    ) {
      syncedOrderIds.push([...orderIds].sort());
    },
  };
  service.orderSubmissionRequestRepository = {
    async listReconciliationCandidatesByBrokerOrderIds() {
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
  service.getCheckpoint = async () => new Date('2026-04-19T06:00:00.000Z');
  service.saveCheckpoint = async () => undefined;
  service.upsertOrderSnapshotsFromItems = async (
    _userId: string,
    _accountId: string,
    _brokerKey: string,
    items: Array<Record<string, unknown>>
  ) => {
    capturedItems = items;
    return {
      inserted: items.length,
      updated: 0,
      skipped: 0,
      orderIds: items.map((item) => String(item.id || item.order_id || '')).filter(Boolean),
    };
  };
  service.reconcileTerminalHistoryWindow = async (
    _userId: string,
    _accountId: string,
    _brokerKey: string,
    _historyStart: Date,
    _historyEnd: Date,
    _historyOrders: unknown[],
    _runLogId?: string,
    protectedExternalIds?: string[]
  ) => {
    protectedIdsFromReconciliation = [...(protectedExternalIds || [])].sort();
    return {
      deletedOutsideLookback: 0,
      deletedMissingHistory: 0,
      orderIds: [],
    };
  };

  (coreDataSource as any).query = async (sql: string, params: unknown[]) => {
    const statement = String(sql || '');
    if (statement.includes('FROM order_submission_requests')) {
      assert.deepEqual(params, ['user-1', 'acct-delta', 'delta_exchange', 90]);
      return [
        {
          brokerOrderId: 'entry-1',
          stopLossOrderId: 'sl-1',
          takeProfitOrderId: 'tp-1',
        },
      ];
    }
    if (statement.includes('FROM suggested_trade_executions')) {
      assert.deepEqual(params, ['user-1', 'acct-delta', 'delta_exchange', 90]);
      return [
        {
          brokerOrderId: 'entry-1',
          stopLossOrderId: 'sl-2',
          takeProfitOrderId: 'tp-2',
        },
      ];
    }
    if (
      statement.includes('SELECT external_id, symbol, order_status') &&
      statement.includes('FROM scheduler_orders_snapshots')
    ) {
      staleCloseParams.push([...params]);
      assert.ok(statement.includes('external_id NOT IN (?, ?, ?, ?, ?)'));
      return [];
    }
    if (statement.includes('UPDATE scheduler_orders_snapshots')) {
      staleCloseParams.push([...params]);
      assert.ok(statement.includes('external_id NOT IN (?, ?, ?, ?, ?)'));
      return [{ affectedRows: 0 }];
    }
    if (statement.includes('FROM scheduler_orders_snapshots')) {
      return [];
    }
    throw new Error(`Unexpected SQL in Delta protective order backfill test: ${statement}`);
  };

  try {
    const result = await service.runBatch({
      executionScope: 'system_scheduler',
      targetUserIds: ['user-1'],
      brokerKeys: ['delta_exchange'],
      accountIds: ['acct-delta'],
    });

    assert.deepEqual(getOrderCalls.sort(), ['sl-1', 'sl-2', 'tp-1', 'tp-2']);
    assert.deepEqual(
      capturedItems.map((item) => String(item.id || item.order_id || '')).sort(),
      ['entry-1', 'sl-1', 'sl-2', 'tp-1', 'tp-2']
    );
    assert.deepEqual(protectedIdsFromReconciliation, [
      'entry-1',
      'sl-1',
      'sl-2',
      'tp-1',
      'tp-2',
    ]);
    assert.deepEqual(syncedOrderIds[0], ['entry-1', 'sl-1', 'sl-2', 'tp-1', 'tp-2']);
    assert.equal(staleCloseParams.length, 2);
    assert.equal((staleCloseParams[0][4] as Date).getMilliseconds(), 0);
    assert.equal((staleCloseParams[1][5] as Date).getMilliseconds(), 0);
    assert.deepEqual(staleCloseParams[0].slice(-5), [
      'entry-1',
      'sl-1',
      'tp-1',
      'sl-2',
      'tp-2',
    ]);
    assert.deepEqual(staleCloseParams[1].slice(-5), [
      'entry-1',
      'sl-1',
      'tp-1',
      'sl-2',
      'tp-2',
    ]);
    assert.equal(result.insertedRecords, 5);
    assert.equal(result.failedAccounts, 0);
  } finally {
    (coreDataSource as any).query = originalQuery;
  }
}

function testOrdersSyncStaleCutoffFloorsToSqlSecond(): void {
  const service = new InternalOrdersSyncService() as any;
  const cutoff = service.toSqlSecondSafeStaleCutoff(
    new Date('2026-05-05T16:43:33.987Z')
  ) as Date;

  assert.equal(cutoff.toISOString(), '2026-05-05T16:43:33.000Z');
}

function testOrdersSyncNormalizesMudrexPartialFilledAlias(): void {
  const service = new InternalOrdersSyncService() as any;
  const row = service.buildOrderRow('user-1', 'acct-1', 'mudrex', {
    id: 'mudrex-partial-entry',
    symbol: 'CFXUSDT',
    status: 'PARTIAL_FILLED',
    order_type: 'LONG',
    trigger_type: 'LIMIT',
    quantity: 3237,
    filled_quantity: 300,
  });

  assert.equal(row.orderStatus, 'PARTIALLY_FILLED');
  assert.equal(row.statusRank, 2);
}

function testOrdersSyncFiltersTerminalHistoryOutsideWindow(): void {
  const service = new InternalOrdersSyncService() as any;
  const filtered = service.filterHistoryOrdersForSnapshotWindow(
    [
      {
        id: 'old-filled',
        symbol: 'AVNTUSDT',
        status: 'FILLED',
        updated_at: '2026-04-10T09:00:00.000Z',
      },
      {
        id: 'inside-filled',
        symbol: 'AVNTUSDT',
        status: 'FILLED',
        updated_at: '2026-05-12T09:00:00.000Z',
      },
      {
        id: 'future-cancelled',
        symbol: 'AVNTUSDT',
        status: 'CANCELLED',
        updated_at: '2026-05-14T09:00:00.000Z',
      },
      {
        id: 'old-open',
        symbol: 'AVNTUSDT',
        status: 'OPEN',
        updated_at: '2026-04-10T09:00:00.000Z',
      },
      {
        id: 'terminal-without-time',
        symbol: 'AVNTUSDT',
        status: 'FILLED',
      },
    ],
    new Date('2026-05-12T00:00:00.000Z'),
    new Date('2026-05-13T00:00:00.000Z')
  ) as Array<Record<string, unknown>>;

  assert.deepEqual(
    filtered.map((item) => item.id),
    ['inside-filled', 'old-open', 'terminal-without-time']
  );
}

async function testOrdersSyncDoesNotWriteSkippedDetailLogs(): Promise<void> {
  const service = new InternalOrdersSyncService() as any;
  const originalQuery = (coreDataSource as any).query;
  const item = {
    id: 'unchanged-order',
    symbol: 'BTCUSDT',
    status: 'FILLED',
    updated_at: '2026-05-12T09:00:00.000Z',
  };
  const existingRow = service.buildOrderRow('user-1', 'acct-1', 'mudrex', item);
  const loggedEntries: Array<Record<string, unknown>> = [];

  service.exchangeAssetUpdateLogRepository = {
    async createMany(entries: Array<Record<string, unknown>>) {
      loggedEntries.push(...entries);
    },
  };

  (coreDataSource as any).query = async (sql: string) => {
    const statement = String(sql || '');
    if (statement.includes('SELECT external_id, order_status, payload_hash, status_rank')) {
      return [
        {
          external_id: 'unchanged-order',
          order_status: existingRow.orderStatus,
          payload_hash: existingRow.payloadHash,
          status_rank: existingRow.statusRank,
        },
      ];
    }
    if (statement.includes('INSERT INTO scheduler_orders_snapshots')) {
      return [{ affectedRows: 0 }];
    }
    throw new Error(`Unexpected SQL in skipped order log test: ${statement}`);
  };

  try {
    const result = await service.upsertOrderSnapshotsFromItems(
      'user-1',
      'acct-1',
      'mudrex',
      [item],
      'run-1'
    );

    assert.equal(result.skipped, 1);
    assert.deepEqual(loggedEntries, []);
  } finally {
    (coreDataSource as any).query = originalQuery;
  }
}

async function testOrdersSyncActiveOpenSnapshotReopensTerminalSnapshot(): Promise<void> {
  const service = new InternalOrdersSyncService() as any;
  const originalQuery = (coreDataSource as any).query;
  const insertStatements: string[] = [];

  (coreDataSource as any).query = async (sql: string) => {
    const statement = String(sql).replace(/\s+/g, ' ').trim();
    if (statement.includes('SELECT external_id, order_status, payload_hash, status_rank')) {
      return [
        {
          external_id: 'ord-live-open',
          order_status: 'CLOSED',
          payload_hash: 'closed-hash',
          status_rank: 4,
        },
      ];
    }
    if (statement.includes('INSERT INTO scheduler_orders_snapshots')) {
      insertStatements.push(statement);
      return [{ affectedRows: 1 }];
    }
    throw new Error(`Unexpected SQL in active-open snapshot test: ${statement}`);
  };

  try {
    const activeResult = await service.upsertOrderSnapshotsFromItems(
      'user-1',
      'acct-1',
      'mudrex',
      [
        {
          id: 'ord-live-open',
          order_id: 'ord-live-open',
          symbol: 'BTCUSDT',
          status: 'OPEN',
          updated_at: '2026-05-11T03:30:00.000Z',
        },
      ],
      undefined,
      { authoritativeActive: true }
    );

    assert.equal(activeResult.updated, 1);
    assert.equal(activeResult.skipped, 0);
    assert.deepEqual(activeResult.orderIds, ['ord-live-open']);
    assert.match(insertStatements[0], /order_status = VALUES\(order_status\)/);
    assert.match(insertStatements[0], /status_rank = VALUES\(status_rank\)/);
    assert.doesNotMatch(insertStatements[0], /GREATEST\(status_rank/);

    insertStatements.length = 0;
    const historyResult = await service.upsertOrderSnapshotsFromItems(
      'user-1',
      'acct-1',
      'mudrex',
      [
        {
          id: 'ord-live-open',
          order_id: 'ord-live-open',
          symbol: 'BTCUSDT',
          status: 'OPEN',
          updated_at: '2026-05-11T03:30:00.000Z',
        },
      ]
    );

    assert.equal(historyResult.updated, 0);
    assert.equal(historyResult.skipped, 1);
    assert.match(insertStatements[0], /GREATEST\(status_rank/);
  } finally {
    (coreDataSource as any).query = originalQuery;
  }
}

async function testOrdersHistoryReconciliationPrunesDriftedTerminalRows(): Promise<void> {
  const service = new InternalOrdersSyncService() as any;
  const deletedChunks: string[][] = [];
  const loggedEntries: Array<Record<string, unknown>> = [];

  service.exchangeAssetUpdateLogRepository = {
    async createMany(entries: Array<Record<string, unknown>>) {
      loggedEntries.push(...entries);
      return [];
    },
  };
  service.listTerminalSnapshotRowsBeforeObservedAt = async () => [
    {
      externalId: 'old-1',
      symbol: 'ETHUSDT',
      orderStatus: 'CLOSED',
    },
  ];
  service.listTerminalSnapshotRowsWithinObservedRange = async () => [
    {
      externalId: 'keep-1',
      symbol: 'BTCUSDT',
      orderStatus: 'FILLED',
    },
    {
      externalId: 'drop-1',
      symbol: 'SOLUSDT',
      orderStatus: 'CANCELLED',
    },
  ];
  service.deleteOrderSnapshotsByExternalIds = async (
    _userId: string,
    _accountId: string,
    _brokerKey: string,
    externalIds: string[]
  ) => {
    deletedChunks.push([...externalIds]);
    return externalIds.length;
  };

  const result = await service.reconcileTerminalHistoryWindow(
    'user-1',
    'acct-1',
    'mudrex',
    new Date('2026-04-01T00:00:00.000Z'),
    new Date('2026-04-14T00:00:00.000Z'),
    [
      {
        id: 'keep-1',
        order_id: 'keep-1',
        symbol: 'BTCUSDT',
        status: 'FILLED',
        created_at: '2026-04-10T00:00:00.000Z',
      },
    ],
    'run-1'
  );

  assert.equal(result.deletedOutsideLookback, 1);
  assert.equal(result.deletedMissingHistory, 1);
  assert.deepEqual(deletedChunks, [['old-1'], ['drop-1']]);
  assert.deepEqual(result.orderIds.sort(), ['drop-1', 'old-1']);
  assert.ok(
    loggedEntries.some(
      (entry) =>
        entry.externalId === 'old-1' &&
        String(entry.message || '').includes('removed outside lookback window')
    )
  );
  assert.ok(
    loggedEntries.some(
      (entry) =>
        entry.externalId === 'drop-1' &&
        String(entry.message || '').includes('broker history no longer reports the order')
    )
  );
}

async function testOrdersHistoryReconciliationKeepsProtectedTrackedRows(): Promise<void> {
  const service = new InternalOrdersSyncService() as any;
  const deletedChunks: string[][] = [];

  service.exchangeAssetUpdateLogRepository = {
    async createMany() {
      return [];
    },
  };
  service.listTerminalSnapshotRowsBeforeObservedAt = async () => [];
  service.listTerminalSnapshotRowsWithinObservedRange = async () => [
    {
      externalId: 'drop-terminal-1',
      symbol: 'SOLUSDT',
      orderStatus: 'CANCELLED',
    },
    {
      externalId: 'protected-sl-1',
      symbol: 'BTCUSD',
      orderStatus: 'CLOSED',
    },
  ];
  service.deleteOrderSnapshotsByExternalIds = async (
    _userId: string,
    _accountId: string,
    _brokerKey: string,
    externalIds: string[]
  ) => {
    deletedChunks.push([...externalIds]);
    return externalIds.length;
  };

  const result = await service.reconcileTerminalHistoryWindow(
    'user-1',
    'acct-1',
    'delta_exchange',
    new Date('2026-04-01T00:00:00.000Z'),
    new Date('2026-04-14T00:00:00.000Z'),
    [],
    'run-1',
    ['protected-sl-1']
  );

  assert.equal(result.deletedOutsideLookback, 0);
  assert.equal(result.deletedMissingHistory, 1);
  assert.deepEqual(deletedChunks, [[], ['drop-terminal-1']]);
  assert.deepEqual(result.orderIds, ['drop-terminal-1']);
}

async function run(): Promise<void> {
  testPhase4Markers();
  await testOrdersSchedulerRuntimeMigratesToUserScope();
  await testPositionsSystemSchedulerCoversMudrexAndDeltaWithFailureIsolation();
  await testOrdersSystemSchedulerCoversMudrexAndDeltaWithFailureIsolation();
  await testOrdersSyncBackfillsTrackedDeltaProtectiveOrdersById();
  testOrdersSyncStaleCutoffFloorsToSqlSecond();
  testOrdersSyncNormalizesMudrexPartialFilledAlias();
  testOrdersSyncFiltersTerminalHistoryOutsideWindow();
  await testOrdersSyncDoesNotWriteSkippedDetailLogs();
  await testOrdersSyncActiveOpenSnapshotReopensTerminalSnapshot();
  await testOrdersHistoryReconciliationPrunesDriftedTerminalRows();
  await testOrdersHistoryReconciliationKeepsProtectedTrackedRows();
  console.log('Positions/orders sync Phase 4 assertions passed.');
}

  await run();
}

async function positions_orders_syncGuard05(): Promise<void> {
  const { default: fs } = await import("node:fs");
  const { default: path } = await import("node:path");
  const { OrdersSchedulerService } = await import("../src/api/services/OrdersSchedulerService");
  const { PositionsSchedulerService } = await import("../src/api/services/PositionsSchedulerService");
  const { env } = await import("../src/env");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

async function runPositionsRuntimeAssertions(): Promise<void> {
  const service = new PositionsSchedulerService() as any;
  const runDate = new Date('2026-04-10T01:00:00.000Z');
  const finishDate = new Date('2026-04-10T01:05:00.000Z');
  const updateDate = new Date('2026-04-10T01:02:00.000Z');

  const anchorConfig: any = {
    key: 'positions-sync',
    name: 'Positions Sync',
    description: 'Positions reconciliation scheduler.',
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
  };
  const userConfig: any = {
    schedulerKey: 'positions-sync',
    userId: 'admin-user-1',
    name: 'Positions Sync',
    description: 'Positions reconciliation scheduler.',
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
    lastStartedAt: runDate,
    lastFinishedAt: finishDate,
    lastStatus: 'Completed',
    lastError: null,
    runningLockUntil: null,
  };

  const sampleRun: any = {
    id: 'positions-run-1',
    schedulerKey: 'positions-sync',
    status: 'Completed',
    startedAt: runDate,
    finishedAt: finishDate,
    durationMs: 300000,
    processedAccounts: 2,
    insertedAssets: 3,
    updatedAssets: 1,
    skippedAssets: 4,
    errorMessage: null,
    initiatedByType: 'manual',
    initiatedByUserId: 'admin-user-1',
    initiatedByLabel: 'admin-user-1',
    executionContext: 'system',
    meta: {
      progress: {
        total: 2,
        processed: 2,
        percent: 100,
        currentItem: {
          symbol: 'BTCUSDT',
          assetId: 'asset-1',
          id: 'current-1',
        },
      },
    },
  };

  const sampleUpdate: any = {
    id: 'positions-update-1',
    runLogId: 'positions-run-1',
    source: 'positions',
    accountId: 'acct-1',
    connectionId: null,
    actionType: 'updated',
    symbol: 'BTCUSDT',
    externalId: 'pos-1',
    assetId: 'asset-1',
    message: 'Position updated',
    detail: {
      reason: 'payload changed',
    },
    createdAt: updateDate,
    initiatedByType: null,
    initiatedByUserId: null,
    initiatedByLabel: null,
    executionContext: null,
  };

  let createdRunPayload: any = null;
  const createdCommands: any[] = [];
  let running = false;
  let updatePreviewCalls = 0;
  let updateDeleteCalls = 0;

  service.userTimeZoneService = {
    async resolveUserTimeZone() {
      return 'UTC';
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
      assert.equal(payload.schedulerKey, 'positions-sync');
      assert.equal(payload.userId, 'admin-user-1');
      return userConfig;
    },
    async updateBySchedulerKeyAndUserId(
      schedulerKey: string,
      userId: string,
      payload: Record<string, unknown>
    ) {
      assert.equal(schedulerKey, 'positions-sync');
      assert.equal(userId, 'admin-user-1');
      Object.assign(userConfig, payload);
      return userConfig;
    },
  };
  service.schedulerRunLogRepository = {
    async hasRunningRunBySchedulerKeyAndActor(schedulerKey: string, actorUserId: string) {
      assert.equal(schedulerKey, 'positions-sync');
      assert.equal(actorUserId, 'admin-user-1');
      return running;
    },
    async createRun(payload: Record<string, unknown>) {
      createdRunPayload = payload;
      return payload;
    },
    async listRunsBySchedulerKey(schedulerKey: string, limit: number, offset: number) {
      assert.equal(schedulerKey, 'positions-sync');
      assert.equal(limit, 10);
      assert.equal(offset, 0);
      return { items: [sampleRun], total: 1 };
    },
    async findByIdAndSchedulerKey(runId: string, schedulerKey: string) {
      assert.equal(schedulerKey, 'positions-sync');
      return runId === 'positions-run-1' ? sampleRun : null;
    },
    async countOlderThanDaysBySchedulerKeyAndActor(
      schedulerKey: string,
      actorUserId: string,
      retentionDays: number
    ) {
      assert.equal(schedulerKey, 'positions-sync');
      assert.equal(actorUserId, 'admin-user-1');
      assert.equal(retentionDays, 30);
      return 6;
    },
    async deleteOlderThanDaysBySchedulerKeyAndActor(
      schedulerKey: string,
      actorUserId: string,
      retentionDays: number
    ) {
      assert.equal(schedulerKey, 'positions-sync');
      assert.equal(actorUserId, 'admin-user-1');
      assert.equal(retentionDays, 30);
      return 4;
    },
    async cancelQueuedRunsBySchedulerKeyAndActor(
      schedulerKey: string,
      actorUserId: string
    ) {
      assert.equal(schedulerKey, 'positions-sync');
      assert.equal(actorUserId, 'admin-user-1');
      return 0;
    },
  };
  service.schedulerCommandRepository = {
    async findLatestBySchedulerKeyAndTypeAndActorInStatuses(
      schedulerKey: string,
      commandType: string,
      actorUserId: string
    ) {
      assert.equal(schedulerKey, 'positions-sync');
      assert.equal(commandType, 'run_now');
      assert.equal(actorUserId, 'admin-user-1');
      return null;
    },
    async createCommand(payload: Record<string, unknown>) {
      createdCommands.push(payload);
      return { id: `positions-command-${createdCommands.length}`, ...payload };
    },
    async cancelPendingBySchedulerKeyAndActor(
      schedulerKey: string,
      actorUserId: string
    ) {
      assert.equal(schedulerKey, 'positions-sync');
      assert.equal(actorUserId, 'admin-user-1');
      return 0;
    },
    async cancelPendingBySchedulerKeyAndTypeAndActor(
      schedulerKey: string,
      commandType: string,
      actorUserId: string
    ) {
      assert.equal(schedulerKey, 'positions-sync');
      assert.equal(commandType, 'run_now');
      assert.equal(actorUserId, 'admin-user-1');
      return 0;
    },
  };
  service.exchangeAssetUpdateLogRepository = {
    async listByRunLogId(runLogId: string, limit: number, offset: number) {
      assert.equal(runLogId, 'positions-run-1');
      assert.equal(limit >= 1, true);
      assert.equal(offset, 0);
      return { items: [sampleUpdate], total: 1 };
    },
    async countOlderThanDaysBySchedulerKeyAndActor(
      schedulerKey: string,
      actorUserId: string,
      retentionDays: number
    ) {
      updatePreviewCalls += 1;
      assert.equal(schedulerKey, 'positions-sync');
      assert.equal(actorUserId, 'admin-user-1');
      assert.equal(retentionDays, 30);
      return 7;
    },
    async deleteOlderThanDaysBySchedulerKeyAndActor(
      schedulerKey: string,
      actorUserId: string,
      retentionDays: number
    ) {
      updateDeleteCalls += 1;
      assert.equal(schedulerKey, 'positions-sync');
      assert.equal(actorUserId, 'admin-user-1');
      assert.equal(retentionDays, 30);
      return 5;
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

  const configResponse = await service.getSchedulerConfig('admin-user-1');
  assert.equal(configResponse.data.lastStartedAtIso, '2026-04-10T01:00:00.000Z');
  assert.equal(configResponse.data.lastFinishedAtIso, '2026-04-10T01:05:00.000Z');

  await service.runNow('admin-user-1');
  assert.equal(createdRunPayload.initiatedByType, 'manual');
  assert.equal(createdRunPayload.initiatedByUserId, 'admin-user-1');
  assert.equal(createdRunPayload.executionContext, 'system');
  assert.equal(createdRunPayload.meta.initiatedByType, 'manual');
  assert.equal(createdRunPayload.meta.actorUserId, env.scheduler.systemUserId);
  assert.equal(createdRunPayload.meta.requestedByUserId, 'admin-user-1');
  assert.equal(createdCommands[0].initiatedByType, 'manual');
  assert.equal(createdCommands[0].payload.actorUserId, env.scheduler.systemUserId);
  assert.equal(createdCommands[0].payload.requestedByUserId, 'admin-user-1');
  assert.equal(createdCommands[0].payload.executionContext, 'system');

  running = true;
  createdCommands.length = 0;
  await service.stopScheduler('admin-user-1');
  assert.equal(createdCommands[0].commandType, 'stop_now');
  assert.equal(createdCommands[0].initiatedByType, 'manual');

  createdCommands.length = 0;
  await service.restartScheduler('admin-user-1');
  assert.equal(createdCommands[0].commandType, 'stop_now');
  assert.equal(createdCommands[1].commandType, 'run_now');
  assert.equal(createdCommands[1].initiatedByType, 'manual');
  assert.equal(createdCommands[1].payload.actorUserId, env.scheduler.systemUserId);
  assert.equal(createdCommands[1].payload.requestedByUserId, 'admin-user-1');

  const runsResponse = await service.listSchedulerRuns('admin-user-1', {
    limit: '10',
    offset: '0',
  });
  assert.equal(runsResponse.data.items[0].initiatedBy?.type, 'manual');
  assert.equal(runsResponse.data.items[0].executionContext, 'system');
  assert.equal(runsResponse.data.items[0].startedAtIso, '2026-04-10T01:00:00.000Z');
  assert.equal(runsResponse.data.items[0].finishedAtIso, '2026-04-10T01:05:00.000Z');
  assert.equal(runsResponse.data.items[0].progress?.currentItem?.id, 'current-1');

  const progressResponse = await service.getSchedulerRunProgress('admin-user-1', 'positions-run-1');
  assert.equal(progressResponse.data.run?.initiatedBy?.userId, 'admin-user-1');
  assert.equal(progressResponse.data.run?.startedAtIso, '2026-04-10T01:00:00.000Z');

  const updatesResponse = await service.listSchedulerRunUpdates('admin-user-1', 'positions-run-1', {
    limit: '25',
    offset: '0',
  });
  assert.equal(updatesResponse.data.items[0].initiatedBy?.type, 'manual');
  assert.equal(updatesResponse.data.items[0].executionContext, 'system');
  assert.equal(updatesResponse.data.items[0].createdAtIso, '2026-04-10T01:02:00.000Z');

  const exportResponse = await service.exportSchedulerRunUpdates('admin-user-1', 'positions-run-1', {});
  assert.equal(exportResponse.data.csv.includes('initiatedByType'), true);
  assert.equal(exportResponse.data.csv.includes('executionContext'), true);
  assert.equal(exportResponse.data.csv.includes('createdAtIso'), true);
  assert.equal(exportResponse.data.csv.includes('admin-user-1'), true);

  const purgePreview = await service.getSchedulerPurgePreview('admin-user-1');
  assert.equal(purgePreview.data.runLogsToDelete, 6);
  assert.equal(purgePreview.data.updateLogsToDelete, 7);
  assert.equal(updatePreviewCalls, 1);

  const purgeResponse = await service.purgeSchedulerLogs('admin-user-1');
  assert.equal(purgeResponse.data.runLogsDeleted, 4);
  assert.equal(purgeResponse.data.updateLogsDeleted, 5);
  assert.equal(updateDeleteCalls, 1);
  assert.equal(
    purgeResponse.data.message,
    'Positions scheduler logs purged. Deleted 4 run logs and 5 update logs.'
  );
}

async function runOrdersRuntimeAssertions(): Promise<void> {
  const service = new OrdersSchedulerService() as any;
  const runDate = new Date('2026-04-10T03:00:00.000Z');
  const finishDate = new Date('2026-04-10T03:04:00.000Z');
  const updateDate = new Date('2026-04-10T03:02:00.000Z');

  const anchorConfig: any = {
    key: 'orders-sync',
    name: 'Orders Sync',
    description: 'Orders reconciliation scheduler.',
    enabled: true,
    cronExpression: '0 1 * * *',
    timezone: 'UTC',
    runAt: '01:00',
    intervalDays: 1,
    batchSize: 200,
    schedulerType: 'user',
    config: {
      sources: ['orders'],
      retentionDays: 30,
      lookbackDays: 90,
    },
  };
  const userConfig: any = {
    schedulerKey: 'orders-sync',
    userId: 'admin-user-1',
    name: 'Orders Sync',
    description: 'Orders reconciliation scheduler.',
    enabled: true,
    cronExpression: '0 1 * * *',
    timezone: 'UTC',
    runAt: '01:00',
    intervalDays: 1,
    batchSize: 200,
    schedulerType: 'user',
    config: {
      sources: ['orders'],
      retentionDays: 30,
      lookbackDays: 90,
    },
    lastStartedAt: runDate,
    lastFinishedAt: finishDate,
    lastStatus: 'Completed',
    lastError: null,
    runningLockUntil: null,
  };

  const sampleRun: any = {
    id: 'orders-run-1',
    schedulerKey: 'orders-sync',
    status: 'Completed',
    startedAt: runDate,
    finishedAt: finishDate,
    durationMs: 240000,
    processedAccounts: 3,
    insertedAssets: 2,
    updatedAssets: 5,
    skippedAssets: 1,
    errorMessage: null,
    initiatedByType: 'manual',
    initiatedByUserId: 'admin-user-1',
    initiatedByLabel: 'admin-user-1',
    executionContext: 'system',
    meta: {
      requestedByUserId: 'admin-user-1',
      progress: {
        total: 3,
        processed: 3,
        percent: 100,
        currentItem: {
          symbol: 'ETHUSDT',
          assetId: 'asset-2',
          id: 'order-1',
        },
      },
    },
  };

  const sampleUpdate: any = {
    id: 'orders-update-1',
    runLogId: 'orders-run-1',
    source: 'orders',
    accountId: 'acct-2',
    connectionId: null,
    actionType: 'updated',
    symbol: 'ETHUSDT',
    externalId: 'order-1',
    assetId: 'asset-2',
    message: 'Order updated',
    detail: {
      reason: 'status changed',
    },
    createdAt: updateDate,
    initiatedByType: null,
    initiatedByUserId: null,
    initiatedByLabel: null,
    executionContext: null,
  };

  let createdRunPayload: any = null;
  const createdCommands: any[] = [];
  let running = false;

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
      assert.equal(payload.userId, 'admin-user-1');
      return userConfig;
    },
    async updateBySchedulerKeyAndUserId(
      schedulerKey: string,
      userId: string,
      payload: Record<string, unknown>
    ) {
      assert.equal(schedulerKey, 'orders-sync');
      assert.equal(userId, 'admin-user-1');
      Object.assign(userConfig, payload);
      return userConfig;
    },
  };
  service.schedulerRunLogRepository = {
    async hasRunningRunBySchedulerKeyAndActor(schedulerKey: string, actorUserId: string) {
      assert.equal(schedulerKey, 'orders-sync');
      assert.equal(actorUserId, 'admin-user-1');
      return running;
    },
    async createRun(payload: Record<string, unknown>) {
      createdRunPayload = payload;
      return payload;
    },
    async listRunsBySchedulerKey(schedulerKey: string, limit: number, offset: number) {
      assert.equal(schedulerKey, 'orders-sync');
      assert.equal(limit, 10);
      assert.equal(offset, 0);
      return { items: [sampleRun], total: 1 };
    },
    async findByIdAndSchedulerKey(runId: string, schedulerKey: string) {
      assert.equal(schedulerKey, 'orders-sync');
      return runId === 'orders-run-1' ? sampleRun : null;
    },
    async cancelQueuedRunsBySchedulerKeyAndActor(
      schedulerKey: string,
      actorUserId: string
    ) {
      assert.equal(schedulerKey, 'orders-sync');
      assert.equal(actorUserId, 'admin-user-1');
      return 0;
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
      assert.equal(actorUserId, 'admin-user-1');
      return null;
    },
    async createCommand(payload: Record<string, unknown>) {
      createdCommands.push(payload);
      return { id: `orders-command-${createdCommands.length}`, ...payload };
    },
    async cancelPendingBySchedulerKeyAndActor(
      schedulerKey: string,
      actorUserId: string
    ) {
      assert.equal(schedulerKey, 'orders-sync');
      assert.equal(actorUserId, 'admin-user-1');
      return 0;
    },
    async cancelPendingBySchedulerKeyAndTypeAndActor(
      schedulerKey: string,
      commandType: string,
      actorUserId: string
    ) {
      assert.equal(schedulerKey, 'orders-sync');
      assert.equal(commandType, 'run_now');
      assert.equal(actorUserId, 'admin-user-1');
      return 0;
    },
  };
  service.exchangeAssetUpdateLogRepository = {
    async listByRunLogId(runLogId: string, limit: number, offset: number) {
      assert.equal(runLogId, 'orders-run-1');
      assert.equal(limit >= 1, true);
      assert.equal(offset, 0);
      return { items: [sampleUpdate], total: 1 };
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
  service.schedulerRuntimeSchemaService = {
    async assertOrdersRuntimeSchemaReady() {
      return;
    },
  };

  const configResponse = await service.getSchedulerConfig('admin-user-1');
  assert.equal(configResponse.data.lastStartedAtIso, '2026-04-10T03:00:00.000Z');
  assert.equal(configResponse.data.lastFinishedAtIso, '2026-04-10T03:04:00.000Z');

  await service.runNow('admin-user-1');
  assert.equal(createdRunPayload.initiatedByType, 'manual');
  assert.equal(createdRunPayload.initiatedByUserId, 'admin-user-1');
  assert.equal(createdRunPayload.executionContext, 'system');
  assert.equal(createdRunPayload.meta.requestedByUserId, 'admin-user-1');
  assert.equal(createdCommands[0].initiatedByType, 'manual');
  assert.equal(createdCommands[0].payload.initiatedByType, 'manual');
  assert.equal(createdCommands[0].payload.executionContext, 'system');

  running = true;
  createdCommands.length = 0;
  await service.stopScheduler('admin-user-1');
  assert.equal(createdCommands[0].commandType, 'stop_now');
  assert.equal(createdCommands[0].initiatedByType, 'manual');

  createdCommands.length = 0;
  await service.restartScheduler('admin-user-1');
  assert.equal(createdCommands[0].commandType, 'stop_now');
  assert.equal(createdCommands[1].commandType, 'run_now');
  assert.equal(createdCommands[1].payload.requestedByUserId, 'admin-user-1');
  assert.equal(createdCommands[1].payload.executionContext, 'system');

  const runsResponse = await service.listSchedulerRuns('admin-user-1', {
    limit: '10',
    offset: '0',
  });
  assert.equal(runsResponse.data.items[0].initiatedBy?.type, 'manual');
  assert.equal(runsResponse.data.items[0].executionContext, 'system');
  assert.equal(runsResponse.data.items[0].startedAtIso, '2026-04-10T03:00:00.000Z');
  assert.equal(runsResponse.data.items[0].progress?.currentItem?.id, 'order-1');

  const progressResponse = await service.getSchedulerRunProgress('admin-user-1', 'orders-run-1');
  assert.equal(progressResponse.data.run?.initiatedBy?.userId, 'admin-user-1');
  assert.equal(progressResponse.data.run?.finishedAtIso, '2026-04-10T03:04:00.000Z');

  const updatesResponse = await service.listSchedulerRunUpdates('admin-user-1', 'orders-run-1', {
    limit: '25',
    offset: '0',
  });
  assert.equal(updatesResponse.data.items[0].initiatedBy?.type, 'manual');
  assert.equal(updatesResponse.data.items[0].executionContext, 'system');
  assert.equal(updatesResponse.data.items[0].createdAtIso, '2026-04-10T03:02:00.000Z');

  const exportResponse = await service.exportSchedulerRunUpdates('admin-user-1', 'orders-run-1', {});
  assert.equal(exportResponse.data.csv.includes('initiatedByType'), true);
  assert.equal(exportResponse.data.csv.includes('executionContext'), true);
  assert.equal(exportResponse.data.csv.includes('createdAtIso'), true);
  assert.equal(exportResponse.data.csv.includes('admin-user-1'), true);
}

async function run(): Promise<void> {
  const findings: string[] = [];

  await runPositionsRuntimeAssertions();
  await runOrdersRuntimeAssertions();

  const phaseDoc = read('POSITIONS_ORDERS_SYNC_PHASE5.md');
  for (const marker of [
    '`positions-sync`',
    '`orders-sync`',
    'Manual queue, stop, and restart commands now stamp explicit `initiatedBy` and `executionContext` audit metadata.',
    'Update-log APIs and CSV export now carry inherited scheduler initiator data plus raw UTC `createdAtIso`.',
    '`positions-sync` purge preview and purge execution now include scheduler-scoped update logs instead of hardcoded zero values.',
    'Phase 6 should implement localized display timestamps and consistent user-timezone rendering on top of this stable audit/ops payload.',
  ]) {
    if (!phaseDoc.includes(marker)) {
      findings.push(`POSITIONS_ORDERS_SYNC_PHASE5.md: missing Phase 5 marker ${marker}`);
    }
  }

  const readme = read('README.md');
  if (!readme.includes('POSITIONS_ORDERS_SYNC_PHASE5.md')) {
    findings.push('README.md: missing positions/orders sync Phase 5 baseline link');
  }
  if (!readme.includes('test:positions-orders-sync')) {
    findings.push('README.md: missing positions/orders sync verification command');
  }

  const packageSource = read('package.json');
  if (!packageSource.includes('"test:positions-orders-sync"')) {
    findings.push('package.json: missing positions/orders sync module test script');
  }
  if (!packageSource.includes('"test:positions-orders-sync"')) {
    findings.push('package.json: positions/orders sync module guard must stay wired');
  }

  const positionsServiceSource = read('src/api/services/PositionsSchedulerService.ts');
  for (const marker of [
    'buildSystemSchedulerManualAudit',
    'toSchedulerAuditContract',
    'startedAtIso',
    'createdAtIso',
    'lastStartedAtIso',
    'countOlderThanDaysBySchedulerKey',
    'deleteOlderThanDaysBySchedulerKey',
    'private buildManualAudit(',
  ]) {
    if (!positionsServiceSource.includes(marker)) {
      findings.push(`PositionsSchedulerService.ts: missing Phase 5 marker ${marker}`);
    }
  }

  const ordersServiceSource = read('src/api/services/OrdersSchedulerService.ts');
  for (const marker of [
    'buildSystemSchedulerManualAudit',
    'toSchedulerAuditContract',
    'startedAtIso',
    'createdAtIso',
    'lastStartedAtIso',
    'initiatedByType: manualAudit.initiatedByType',
    'private buildManualAudit(',
  ]) {
    if (!ordersServiceSource.includes(marker)) {
      findings.push(`OrdersSchedulerService.ts: missing Phase 5 marker ${marker}`);
    }
  }

  assert.equal(
    findings.length,
    0,
    `Positions/orders sync Phase 5 guard failed:\n${findings.join('\n')}`
  );
  console.log('Positions/orders sync Phase 5 guard passed.');
}

  await run();
}

async function positions_orders_syncGuard06(): Promise<void> {
  const { default: fs } = await import("node:fs");
  const { default: path } = await import("node:path");
  const { PositionsSchedulerService } = await import("../src/api/services/PositionsSchedulerService");
  const { OrdersSchedulerService } = await import("../src/api/services/OrdersSchedulerService");
  const { coreDataSource } = await import("../src/database/data-source");
  const { formatSchedulerDisplayTime, formatSchedulerRawIso, } = await import("../src/api/utils/schedulerTimeContract");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

async function runPositionsRuntimeAssertions(): Promise<void> {
  const service = new PositionsSchedulerService() as any;
  const originalQuery = (coreDataSource as any).query;
  const timeZone = 'Asia/Kolkata';
  const runDate = new Date('2026-04-10T04:30:00.000Z');
  const finishDate = new Date('2026-04-10T04:35:00.000Z');
  const updateDate = new Date('2026-04-10T04:31:00.000Z');
  const checkpointDate = new Date('2026-04-10T04:45:00.000Z');
  const retryDate = new Date('2026-04-10T05:00:00.000Z');
  const pendingUpdateDate = new Date('2026-04-10T05:05:00.000Z');
  const latestSnapshotDate = new Date('2026-04-10T05:10:00.000Z');
  const latestReadModelDate = new Date('2026-04-10T05:12:00.000Z');

  const anchorConfig: any = {
    key: 'positions-sync',
    name: 'Positions Sync',
    description: 'Positions reconciliation scheduler.',
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
  };
  const userConfig: any = {
    schedulerKey: 'positions-sync',
    userId: 'admin-user-1',
    name: 'Positions Sync',
    description: 'Positions reconciliation scheduler.',
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
    lastStartedAt: runDate,
    lastFinishedAt: finishDate,
    lastStatus: 'Completed',
    lastError: null,
    runningLockUntil: null,
  };

  const sampleRun: any = {
    id: 'positions-run-1',
    schedulerKey: 'positions-sync',
    status: 'Completed',
    startedAt: runDate,
    finishedAt: finishDate,
    durationMs: 300000,
    processedAccounts: 2,
    insertedAssets: 3,
    updatedAssets: 1,
    skippedAssets: 4,
    errorMessage: null,
    initiatedByType: 'manual',
    initiatedByUserId: 'admin-user-1',
    initiatedByLabel: 'admin-user-1',
    executionContext: 'system',
    meta: {
      progress: {
        total: 2,
        processed: 2,
        percent: 100,
        currentItem: {
          symbol: 'BTCUSDT',
          assetId: 'asset-1',
          id: 'current-1',
        },
      },
    },
  };

  const sampleUpdate: any = {
    id: 'positions-update-1',
    runLogId: 'positions-run-1',
    source: 'positions',
    accountId: 'acct-1',
    connectionId: null,
    actionType: 'updated',
    symbol: 'BTCUSDT',
    externalId: 'pos-1',
    assetId: 'asset-1',
    message: 'Position updated',
    detail: { reason: 'payload changed' },
    createdAt: updateDate,
    initiatedByType: null,
    initiatedByUserId: null,
    initiatedByLabel: null,
    executionContext: null,
  };

  service.userTimeZoneService = {
    async resolveUserTimeZone() {
      return timeZone;
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
      assert.equal(payload.schedulerKey, 'positions-sync');
      assert.equal(payload.userId, 'admin-user-1');
      return userConfig;
    },
    async updateBySchedulerKeyAndUserId(
      schedulerKey: string,
      userId: string,
      payload: Record<string, unknown>
    ) {
      assert.equal(schedulerKey, 'positions-sync');
      assert.equal(userId, 'admin-user-1');
      Object.assign(userConfig, payload);
      return userConfig;
    },
  };
  service.schedulerRunLogRepository = {
    async listRunsBySchedulerKey(schedulerKey: string, limit: number, offset: number) {
      assert.equal(schedulerKey, 'positions-sync');
      assert.equal(limit, 10);
      assert.equal(offset, 0);
      return { items: [sampleRun], total: 1 };
    },
    async findByIdAndSchedulerKey(runId: string, schedulerKey: string) {
      assert.equal(schedulerKey, 'positions-sync');
      return runId === 'positions-run-1' ? sampleRun : null;
    },
  };
  service.exchangeAssetUpdateLogRepository = {
    async listByRunLogId(runLogId: string, limit: number, offset: number) {
      assert.equal(runLogId, 'positions-run-1');
      assert.equal(limit >= 1, true);
      assert.equal(offset, 0);
      return { items: [sampleUpdate], total: 1 };
    },
  };
  service.loadReadModelCoverageByAccountIds = async (rows: Array<Record<string, unknown>>) => {
    assert.equal(rows.length >= 1, true);
    return new Map([
      [
        'acct-1',
        {
          accountId: 'acct-1',
          snapshotRows: 4,
          readModelRows: 3,
          rowsMissingFromReadModel: 1,
          rowsBehindSnapshot: 1,
          orphanReadModelRows: 0,
          latestSnapshotSeenAt: latestSnapshotDate,
          latestReadModelSeenAt: latestReadModelDate,
        },
      ],
    ]);
  };
  service.loadReadModelCoverageSummaryForConnectedAccounts = async () => ({
    accountsWithSnapshotData: 1,
    accountsWithoutSnapshotData: 0,
    accountsWithReadModel: 1,
    accountsWithoutReadModel: 0,
    accountsWithReadModelDrift: 1,
    snapshotRows: 4,
    readModelRows: 3,
    rowsMissingFromReadModel: 1,
    rowsBehindSnapshot: 1,
    orphanReadModelRows: 0,
    latestSnapshotSeenAt: latestSnapshotDate,
    latestReadModelSeenAt: latestReadModelDate,
  });

  (coreDataSource as any).query = async (sql: string) => {
    const statement = String(sql || '');
    if (statement.includes('LEFT JOIN scheduler_sync_checkpoints scp') && statement.includes('LIMIT ? OFFSET ?')) {
      return [
        {
          accountId: 'acct-1',
          userId: 'user-1',
          brokerKey: 'mudrex',
          checkpointAt: checkpointDate,
          pendingRecords: 2,
          failedRecords: 1,
          resolvedRecords: 6,
          nextRetryAt: retryDate,
          lastPendingUpdateAt: pendingUpdateDate,
        },
      ];
    }
    if (statement.includes('SELECT COUNT(*) AS total') && statement.includes('FROM broker_accounts ba')) {
      return [{ total: 1 }];
    }
    if (statement.includes('accountsWithCheckpoint')) {
      return [
        {
          totalAccounts: 1,
          accountsWithCheckpoint: 1,
          accountsWithoutCheckpoint: 0,
          accountsWithPending: 1,
          accountsWithFailed: 1,
          accountsWithRetryScheduled: 1,
          pendingRecords: 2,
          failedRecords: 1,
          resolvedRecords: 6,
          oldestCheckpointAt: checkpointDate,
          latestCheckpointAt: checkpointDate,
          latestPendingUpdateAt: pendingUpdateDate,
          nextRetryAt: retryDate,
        },
      ];
    }
    throw new Error(`Unexpected SQL in positions/orders sync phase 6 positions test: ${statement}`);
  };

  try {
    const configResponse = await service.getSchedulerConfig('admin-user-1');
    assert.equal(configResponse.data.time?.displayTimeZone, timeZone);
    assert.equal(configResponse.data.lastStartedAt, formatSchedulerDisplayTime(runDate, timeZone));
    assert.equal(configResponse.data.lastStartedAtIso, formatSchedulerRawIso(runDate));
    assert.equal(configResponse.data.lastFinishedAt, formatSchedulerDisplayTime(finishDate, timeZone));

    const runsResponse = await service.listSchedulerRuns('admin-user-1', {
      limit: '10',
      offset: '0',
    });
    assert.equal(runsResponse.data.time?.displayTimeZone, timeZone);
    assert.equal(runsResponse.data.items[0]?.startedAt, formatSchedulerDisplayTime(runDate, timeZone));
    assert.equal(runsResponse.data.items[0]?.startedAtIso, formatSchedulerRawIso(runDate));
    assert.equal(runsResponse.data.items[0]?.finishedAt, formatSchedulerDisplayTime(finishDate, timeZone));

    const progressResponse = await service.getSchedulerRunProgress('admin-user-1', 'positions-run-1');
    assert.equal(progressResponse.data.time?.displayTimeZone, timeZone);
    assert.equal(progressResponse.data.run?.startedAt, formatSchedulerDisplayTime(runDate, timeZone));
    assert.equal(progressResponse.data.run?.finishedAtIso, formatSchedulerRawIso(finishDate));

    const updatesResponse = await service.listSchedulerRunUpdates('admin-user-1', 'positions-run-1', {
      limit: '25',
      offset: '0',
    });
    assert.equal(updatesResponse.data.time?.displayTimeZone, timeZone);
    assert.equal(
      updatesResponse.data.items[0]?.createdAt,
      formatSchedulerDisplayTime(updateDate, timeZone)
    );
    assert.equal(updatesResponse.data.items[0]?.createdAtIso, formatSchedulerRawIso(updateDate));

    const exportResponse = await service.exportSchedulerRunUpdates('admin-user-1', 'positions-run-1', {});
    assert.equal(
      exportResponse.data.csv.includes(formatSchedulerDisplayTime(updateDate, timeZone) || ''),
      true
    );
    assert.equal(exportResponse.data.csv.includes(formatSchedulerRawIso(updateDate) || ''), true);

    const syncStateResponse = await service.listSchedulerSyncState('admin-user-1', {
      limit: '10',
      offset: '0',
    });
    assert.equal(syncStateResponse.data.time?.displayTimeZone, timeZone);
    assert.equal(
      syncStateResponse.data.items[0]?.checkpointAt,
      formatSchedulerDisplayTime(checkpointDate, timeZone)
    );
    assert.equal(
      syncStateResponse.data.items[0]?.latestSnapshotSeenAt,
      formatSchedulerDisplayTime(latestSnapshotDate, timeZone)
    );
    assert.equal(
      syncStateResponse.data.items[0]?.lastPendingUpdateAt,
      formatSchedulerDisplayTime(pendingUpdateDate, timeZone)
    );

    const summaryResponse = await service.getSchedulerSyncStateSummary('admin-user-1');
    assert.equal(summaryResponse.data.time?.displayTimeZone, timeZone);
    assert.equal(
      summaryResponse.data.oldestCheckpointAt,
      formatSchedulerDisplayTime(checkpointDate, timeZone)
    );
    assert.equal(
      summaryResponse.data.latestSnapshotSeenAt,
      formatSchedulerDisplayTime(latestSnapshotDate, timeZone)
    );
    assert.equal(
      summaryResponse.data.nextRetryAt,
      formatSchedulerDisplayTime(retryDate, timeZone)
    );
  } finally {
    (coreDataSource as any).query = originalQuery;
  }
}

async function runOrdersRuntimeAssertions(): Promise<void> {
  const service = new OrdersSchedulerService() as any;
  const timeZone = 'Asia/Kolkata';
  const runDate = new Date('2026-04-10T06:30:00.000Z');
  const finishDate = new Date('2026-04-10T06:34:00.000Z');
  const updateDate = new Date('2026-04-10T06:31:00.000Z');
  const checkpointIso = '2026-04-10T06:45:00.000Z';
  const retryIso = '2026-04-10T07:00:00.000Z';
  const pendingUpdateIso = '2026-04-10T07:05:00.000Z';

  const anchorConfig: any = {
    key: 'orders-sync',
    name: 'Orders Sync',
    description: 'Orders reconciliation scheduler.',
    enabled: true,
    cronExpression: '0 1 * * *',
    timezone: 'UTC',
    runAt: '01:00',
    intervalDays: 1,
    batchSize: 200,
    schedulerType: 'user',
    config: {
      sources: ['orders'],
      retentionDays: 30,
      lookbackDays: 90,
    },
  };
  const userConfig: any = {
    schedulerKey: 'orders-sync',
    userId: 'admin-user-1',
    name: 'Orders Sync',
    description: 'Orders reconciliation scheduler.',
    enabled: true,
    cronExpression: '0 1 * * *',
    timezone: 'UTC',
    runAt: '01:00',
    intervalDays: 1,
    batchSize: 200,
    schedulerType: 'user',
    config: {
      sources: ['orders'],
      retentionDays: 30,
      lookbackDays: 90,
    },
    lastStartedAt: runDate,
    lastFinishedAt: finishDate,
    lastStatus: 'Completed',
    lastError: null,
    runningLockUntil: null,
  };

  const sampleRun: any = {
    id: 'orders-run-1',
    schedulerKey: 'orders-sync',
    status: 'Completed',
    startedAt: runDate,
    finishedAt: finishDate,
    durationMs: 240000,
    processedAccounts: 3,
    insertedAssets: 2,
    updatedAssets: 5,
    skippedAssets: 1,
    errorMessage: null,
    initiatedByType: 'manual',
    initiatedByUserId: 'admin-user-1',
    initiatedByLabel: 'admin-user-1',
    executionContext: 'system',
    meta: {
      progress: {
        total: 3,
        processed: 3,
        percent: 100,
        currentItem: {
          symbol: 'ETHUSDT',
          assetId: 'asset-2',
          id: 'order-1',
        },
      },
    },
  };

  const sampleUpdate: any = {
    id: 'orders-update-1',
    runLogId: 'orders-run-1',
    source: 'orders',
    accountId: 'acct-2',
    connectionId: null,
    actionType: 'updated',
    symbol: 'ETHUSDT',
    externalId: 'order-1',
    assetId: 'asset-2',
    message: 'Order updated',
    detail: { reason: 'status changed' },
    createdAt: updateDate,
    initiatedByType: null,
    initiatedByUserId: null,
    initiatedByLabel: null,
    executionContext: null,
  };

  service.userTimeZoneService = {
    async resolveUserTimeZone() {
      return timeZone;
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
      assert.equal(payload.userId, 'admin-user-1');
      return userConfig;
    },
    async updateBySchedulerKeyAndUserId(
      schedulerKey: string,
      userId: string,
      payload: Record<string, unknown>
    ) {
      assert.equal(schedulerKey, 'orders-sync');
      assert.equal(userId, 'admin-user-1');
      Object.assign(userConfig, payload);
      return userConfig;
    },
  };
  service.schedulerRunLogRepository = {
    async listRunsBySchedulerKey(schedulerKey: string, limit: number, offset: number) {
      assert.equal(schedulerKey, 'orders-sync');
      assert.equal(limit, 10);
      assert.equal(offset, 0);
      return { items: [sampleRun], total: 1 };
    },
    async findByIdAndSchedulerKey(runId: string, schedulerKey: string) {
      assert.equal(schedulerKey, 'orders-sync');
      return runId === 'orders-run-1' ? sampleRun : null;
    },
  };
  service.exchangeAssetUpdateLogRepository = {
    async listByRunLogId(runLogId: string, limit: number, offset: number) {
      assert.equal(runLogId, 'orders-run-1');
      assert.equal(limit >= 1, true);
      assert.equal(offset, 0);
      return { items: [sampleUpdate], total: 1 };
    },
  };
  service.schedulerRuntimeSchemaService = {
    async inspectOrdersRuntimeSchema() {
      return {
        status: 'ready',
        migrationName: 'test-migration',
        requiredTables: [],
        requiredColumns: [],
      };
    },
  };
  service.ordersSyncDiagnosticsService = {
    async listSchedulerSyncStateRecords() {
      return {
        items: [
          {
            accountId: 'acct-2',
            userId: 'user-2',
            brokerKey: 'delta_exchange',
            checkpointAt: checkpointIso,
            pendingRecords: 3,
            failedRecords: 1,
            resolvedRecords: 5,
            nextRetryAt: retryIso,
            lastPendingUpdateAt: pendingUpdateIso,
          },
        ],
        total: 1,
      };
    },
    async getSchedulerSyncStateSummaryRecord() {
      return {
        totalAccounts: 1,
        accountsWithCheckpoint: 1,
        accountsWithoutCheckpoint: 0,
        accountsWithPending: 1,
        accountsWithFailed: 1,
        accountsWithRetryScheduled: 1,
        pendingRecords: 3,
        failedRecords: 1,
        resolvedRecords: 5,
        oldestCheckpointAt: checkpointIso,
        latestCheckpointAt: checkpointIso,
        latestPendingUpdateAt: pendingUpdateIso,
        nextRetryAt: retryIso,
      };
    },
  };

  const configResponse = await service.getSchedulerConfig('admin-user-1');
  assert.equal(configResponse.data.time?.displayTimeZone, timeZone);
  assert.equal(configResponse.data.lastStartedAt, formatSchedulerDisplayTime(runDate, timeZone));
  assert.equal(configResponse.data.lastStartedAtIso, formatSchedulerRawIso(runDate));

  const runsResponse = await service.listSchedulerRuns('admin-user-1', {
    limit: '10',
    offset: '0',
  });
  assert.equal(runsResponse.data.time?.displayTimeZone, timeZone);
  assert.equal(runsResponse.data.items[0]?.startedAt, formatSchedulerDisplayTime(runDate, timeZone));
  assert.equal(runsResponse.data.items[0]?.finishedAt, formatSchedulerDisplayTime(finishDate, timeZone));

  const progressResponse = await service.getSchedulerRunProgress('admin-user-1', 'orders-run-1');
  assert.equal(progressResponse.data.time?.displayTimeZone, timeZone);
  assert.equal(progressResponse.data.run?.startedAtIso, formatSchedulerRawIso(runDate));
  assert.equal(progressResponse.data.run?.finishedAt, formatSchedulerDisplayTime(finishDate, timeZone));

  const updatesResponse = await service.listSchedulerRunUpdates('admin-user-1', 'orders-run-1', {
    limit: '25',
    offset: '0',
  });
  assert.equal(updatesResponse.data.time?.displayTimeZone, timeZone);
  assert.equal(
    updatesResponse.data.items[0]?.createdAt,
    formatSchedulerDisplayTime(updateDate, timeZone)
  );
  assert.equal(updatesResponse.data.items[0]?.createdAtIso, formatSchedulerRawIso(updateDate));

  const exportResponse = await service.exportSchedulerRunUpdates('admin-user-1', 'orders-run-1', {});
  assert.equal(
    exportResponse.data.csv.includes(formatSchedulerDisplayTime(updateDate, timeZone) || ''),
    true
  );
  assert.equal(exportResponse.data.csv.includes(formatSchedulerRawIso(updateDate) || ''), true);

  const syncStateResponse = await service.listSchedulerSyncState('admin-user-1', {
    limit: '10',
    offset: '0',
  });
  assert.equal(syncStateResponse.data.time?.displayTimeZone, timeZone);
  assert.equal(
    syncStateResponse.data.items[0]?.checkpointAt,
    formatSchedulerDisplayTime(checkpointIso, timeZone)
  );
  assert.equal(
    syncStateResponse.data.items[0]?.nextRetryAt,
    formatSchedulerDisplayTime(retryIso, timeZone)
  );

  const summaryResponse = await service.getSchedulerSyncStateSummary('admin-user-1');
  assert.equal(summaryResponse.data.time?.displayTimeZone, timeZone);
  assert.equal(
    summaryResponse.data.oldestCheckpointAt,
    formatSchedulerDisplayTime(checkpointIso, timeZone)
  );
  assert.equal(
    summaryResponse.data.latestPendingUpdateAt,
    formatSchedulerDisplayTime(pendingUpdateIso, timeZone)
  );
}

async function run(): Promise<void> {
  const findings: string[] = [];

  await runPositionsRuntimeAssertions();
  await runOrdersRuntimeAssertions();

  const phaseDoc = read('POSITIONS_ORDERS_SYNC_PHASE6.md');
  for (const marker of [
    '`positions-sync`',
    '`orders-sync`',
    'Config responses now expose localized `lastStartedAt` and `lastFinishedAt` values plus response-level `time` metadata.',
    'Run list, run progress, and update-log responses now render display timestamps in the resolved user timezone while keeping the raw UTC `*Iso` companions from Phase 5.',
    'Orders and positions sync-state list or summary responses now expose shared `time` metadata and localize checkpoint or retry or freshness timestamps.',
    'Phase 7 should build on this stable shared timezone contract',
  ]) {
    if (!phaseDoc.includes(marker)) {
      findings.push(`POSITIONS_ORDERS_SYNC_PHASE6.md: missing Phase 6 marker ${marker}`);
    }
  }

  const readme = read('README.md');
  if (!readme.includes('POSITIONS_ORDERS_SYNC_PHASE6.md')) {
    findings.push('README.md: missing positions/orders sync Phase 6 baseline link');
  }
  if (!readme.includes('test:positions-orders-sync')) {
    findings.push('README.md: missing positions/orders sync verification command');
  }

  const packageSource = read('package.json');
  if (!packageSource.includes('"test:positions-orders-sync"')) {
    findings.push('package.json: missing positions/orders sync module test script');
  }
  if (!packageSource.includes('"test:positions-orders-sync"')) {
    findings.push('package.json: positions/orders sync module guard must stay wired');
  }

  const contractSource = read('src/api/contracts/Scheduler.ts');
  for (const marker of [
    'export interface SchedulerRecordSyncStateListResponse {',
    'export interface SchedulerRecordSyncSummaryResponse {',
    'time?: SchedulerTimeContract;',
  ]) {
    if (!contractSource.includes(marker)) {
      findings.push(`Scheduler.ts: missing Phase 6 marker ${marker}`);
    }
  }

  const positionsServiceSource = read('src/api/services/PositionsSchedulerService.ts');
  for (const marker of [
    'buildSchedulerTimeContract',
    'formatSchedulerDisplayTime',
    'time: buildSchedulerTimeContract(timeZone)',
    'lastStartedAt: this.formatDisplayDate(config.lastStartedAt, timeZone)',
    'startedAt: this.formatDisplayDate(item.startedAt, timeZone)',
    'createdAt: this.formatDisplayDate(item.createdAt, timeZone)',
    'const checkpointAt =',
    'private async resolveUserTimeZone(',
  ]) {
    if (!positionsServiceSource.includes(marker)) {
      findings.push(`PositionsSchedulerService.ts: missing Phase 6 marker ${marker}`);
    }
  }

  const ordersServiceSource = read('src/api/services/OrdersSchedulerService.ts');
  for (const marker of [
    'buildSchedulerTimeContract',
    'formatSchedulerDisplayTime',
    'time: buildSchedulerTimeContract(timeZone)',
    'lastStartedAt: this.formatDisplayDate(config.lastStartedAt, timeZone)',
    'startedAt: this.formatDisplayDate(item.startedAt, timeZone)',
    'createdAt: this.formatDisplayDate(item.createdAt, timeZone)',
    'checkpointAt:',
    'private async resolveUserTimeZone(',
  ]) {
    if (!ordersServiceSource.includes(marker)) {
      findings.push(`OrdersSchedulerService.ts: missing Phase 6 marker ${marker}`);
    }
  }

  assert.equal(
    findings.length,
    0,
    `Positions/orders sync Phase 6 guard failed:\n${findings.join('\n')}`
  );
  console.log('Positions/orders sync Phase 6 guard passed.');
}

  await run();
}

async function positions_orders_syncGuard07(): Promise<void> {
  const { default: fs } = await import("node:fs");
  const { default: path } = await import("node:path");
  const { PositionsSchedulerService } = await import("../src/api/services/PositionsSchedulerService");
  const { BrokerPositionsFacadeService } = await import("../src/api/services/BrokerPositionsFacadeService");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

async function runPositionsRecoveryRuntimeAssertions(): Promise<void> {
  const service = new PositionsSchedulerService() as any;
  const anchorConfig = {
    key: 'positions-sync',
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
    lastStartedAt: null,
    lastFinishedAt: null,
    lastStatus: null,
    lastError: null,
    config: {
      sources: ['positions'],
      retentionDays: 30,
      lookbackDays: 90,
    },
  };
  const userConfig = {
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
    lastStartedAt: null,
    lastFinishedAt: null,
    lastStatus: null,
    lastError: null,
    runningLockUntil: null,
    config: {
      sources: ['positions'],
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
  service.activityRepository = {
    async listActivity(userId: string, query: Record<string, unknown>) {
      assert.equal(userId, 'ops-admin');
      assert.equal(query.referenceId, 'positions-read-model-recovery');
      return {
        items: [
          {
            id: 'activity-1',
            title: 'Positions read-model rebuild completed',
            status: 'Success',
            actor: 'ops-admin',
            route: 'Schedulers',
            description: 'Positions read-model rebuild completed for owner owner-1.',
            referenceId: 'positions-read-model-recovery',
            correlationId: 'recovery-1',
            stream: 'Runs',
            related: 'positions-sync',
            createdAt: new Date('2026-04-10T10:30:00.000Z'),
            updatedAt: new Date('2026-04-10T10:30:00.000Z'),
            flags: [
              { id: 'scope', message: 'owner' },
              { id: 'state', message: 'applied' },
              { id: 'requested-accounts', message: '3' },
              { id: 'targeted-accounts', message: '2' },
              { id: 'processed-accounts', message: '1' },
              { id: 'skipped-accounts', message: '1' },
              { id: 'deleted-rows', message: '4' },
              { id: 'inserted-rows', message: '5' },
              { id: 'snapshot-rows-processed', message: '5' },
              { id: 'before-drift-accounts', message: '2' },
              { id: 'after-drift-accounts', message: '1' },
              { id: 'filter-owner-user-id', message: 'owner-1' },
              {
                id: 'next-step',
                message: 'Refresh sync truth and inspect remaining drift.',
              },
              {
                id: 'warning-1',
                message:
                  '1 targeted account had no snapshot rows available for rebuild and was skipped.',
              },
            ],
          },
        ],
        total: 1,
      };
    },
  };

  const configResponse = await service.getSchedulerConfig('ops-admin');
  assert.equal(configResponse.data.readModelRecoveryPolicy?.supported, true);
  assert.equal(configResponse.data.readModelRecoveryPolicy?.productTrustSurface, '/positions');
  assert.deepEqual(configResponse.data.readModelRecoveryPolicy?.supportedScopes, [
    'account',
    'owner',
    'broker',
    'all',
  ]);

  const historyResponse = await service.listReadModelRecoveryHistory('ops-admin', {
    limit: '10',
    offset: '0',
    status: 'success',
  });
  assert.equal(historyResponse.data.total, 1);
  assert.equal(historyResponse.data.items[0]?.recoveryId, 'recovery-1');
  assert.equal(historyResponse.data.items[0]?.scope, 'owner');
  assert.equal(historyResponse.data.items[0]?.actor, 'ops-admin');
  assert.equal(historyResponse.data.items[0]?.filters.ownerUserId, 'owner-1');
  assert.equal(historyResponse.data.items[0]?.warnings.length, 1);
}

async function runProductTrustBoundaryAssertions(): Promise<void> {
  const service = new BrokerPositionsFacadeService() as any;
  let capturedRequest: Record<string, unknown> | null = null;

  service.userTimeZoneService = {
    async resolveUserTimeZone() {
      return 'Asia/Kolkata';
    },
  };
  service.brokerAccountRepository = {
    async getActiveBrokerAccounts(userId: string, brokerKey?: string) {
      assert.equal(userId, 'desk-user-1');
      assert.equal(brokerKey, 'mudrex');
      return [
        { id: 'acct-1', brokerKey: 'mudrex' },
        { id: 'acct-2', brokerKey: 'mudrex' },
      ];
    },
  };
  service.internalPositionsSyncService = {
    async runBatch(request: Record<string, unknown>) {
      capturedRequest = request;
      return {
        processedAccounts: 1,
        failedAccounts: 0,
        fetchedRecords: 2,
        insertedRecords: 1,
        updatedRecords: 1,
        skippedRecords: 0,
        failures: [],
      };
    },
  };

  const response = await service.requestPositionsRefresh('desk-user-1', {
    brokerKey: 'mudrex',
    accountId: 'acct-1',
  });

  assert.equal(response.requested, true);
  assert.equal(response.scope, 'account');
  assert.ok(capturedRequest, 'product refresh should delegate to internal sync');
  const normalizedRequest = capturedRequest as Record<string, unknown>;
  assert.equal(normalizedRequest.executionScope, 'product_user');
  assert.equal(normalizedRequest.requestUserId, 'desk-user-1');
  assert.deepEqual(normalizedRequest.targetUserIds, ['desk-user-1']);
  assert.deepEqual(normalizedRequest.accountIds, ['acct-1']);
  assert.deepEqual(normalizedRequest.brokerKeys, ['mudrex']);
}

async function run(): Promise<void> {
  const findings: string[] = [];

  await runPositionsRecoveryRuntimeAssertions();
  await runProductTrustBoundaryAssertions();

  const phaseDoc = read('POSITIONS_ORDERS_SYNC_PHASE7.md');
  for (const marker of [
    'Phase 7 closes the positions-specific operational contract',
    '`positions-sync`',
    'owner-aware sync-state diagnostics',
    'read-model recovery policy',
    'persisted recovery history',
    '`/positions`',
    '`targetUserIds: [userId]`',
    '`npm run test:positions-scheduler`',
    'Phase 8 should focus only on `orders-sync`',
  ]) {
    if (!phaseDoc.includes(marker)) {
      findings.push(`POSITIONS_ORDERS_SYNC_PHASE7.md: missing Phase 7 marker ${marker}`);
    }
  }

  const readme = read('README.md');
  if (!readme.includes('POSITIONS_ORDERS_SYNC_PHASE7.md')) {
    findings.push('README.md: missing positions/orders sync Phase 7 baseline link');
  }
  if (!readme.includes('positions-specific operational freeze')) {
    findings.push('README.md: missing positions/orders sync Phase 7 summary');
  }
  if (!readme.includes('test:positions-orders-sync')) {
    findings.push('README.md: missing positions/orders sync verification command');
  }

  const packageSource = read('package.json');
  if (!packageSource.includes('"test:positions-orders-sync"')) {
    findings.push('package.json: missing positions/orders sync module test script');
  }
  if (!packageSource.includes('"test:positions-orders-sync"')) {
    findings.push('package.json: positions/orders sync module guard must stay wired');
  }
  if (!packageSource.includes('"test:positions-scheduler"')) {
    findings.push('package.json: positions/orders sync Phase 7 should depend on the positions scheduler module suite');
  }

  const positionsServiceSource = read('src/api/services/PositionsSchedulerService.ts');
  for (const marker of [
    'async rebuildReadModel(',
    'async listReadModelRecoveryHistory(',
    "referenceId: POSITIONS_RECOVERY_ACTIVITY_REFERENCE_ID",
    "productTrustSurface: '/positions'",
    'readModelNeedsRebuild',
    'ownerUserId',
  ]) {
    if (!positionsServiceSource.includes(marker)) {
      findings.push(`PositionsSchedulerService.ts: missing Phase 7 marker ${marker}`);
    }
  }

  const positionsControllerSource = read('src/api/controllers/PositionsSchedulerController.ts');
  for (const marker of [
    "@Post('/read-model/rebuild')",
    "@Get('/read-model/recovery-history')",
    "@QueryParam('ownerUserId') ownerUserId?: string",
  ]) {
    if (!positionsControllerSource.includes(marker)) {
      findings.push(`PositionsSchedulerController.ts: missing Phase 7 marker ${marker}`);
    }
  }

  const positionsDeskSource = read('src/api/services/BrokerPositionsFacadeService.ts');
  for (const marker of [
    'buildProductOwnedPositionsSyncRequest',
    'targetUserIds: [userId]',
    'No connected or idle broker routes are available for positions refresh on this desk.',
  ]) {
    if (!positionsDeskSource.includes(marker)) {
      findings.push(`BrokerPositionsFacadeService.ts: missing Phase 7 marker ${marker}`);
    }
  }

  assert.equal(
    findings.length,
    0,
    `Positions/orders sync Phase 7 guard failed:\n${findings.join('\n')}`
  );
  console.log('Positions/orders sync Phase 7 guard passed.');
}

  await run();
}

async function positions_orders_syncGuard08(): Promise<void> {
  const { default: fs } = await import("node:fs");
  const { default: path } = await import("node:path");
  const { OrdersSchedulerService } = await import("../src/api/services/OrdersSchedulerService");
  const { BrokerOrdersFacadeService } = await import("../src/api/services/BrokerOrdersFacadeService");

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
    '`npm run test:orders-scheduler`',
    '`npm run test:schedulers`',
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
  if (!readme.includes('test:positions-orders-sync')) {
    findings.push('README.md: missing positions/orders sync verification command');
  }

  const packageSource = read('package.json');
  if (!packageSource.includes('"test:positions-orders-sync"')) {
    findings.push('package.json: missing positions/orders sync module test script');
  }
  if (!packageSource.includes('"test:positions-orders-sync"')) {
    findings.push('package.json: positions/orders sync module guard must stay wired');
  }
  if (!packageSource.includes('"test:orders-scheduler"')) {
    findings.push('package.json: positions/orders sync Phase 8 should depend on the orders scheduler module suite');
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

  await run();
}

async function positions_orders_syncGuard09(): Promise<void> {
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

async function runPositionsSchedulerLiveProofAssertions(): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'positions-orders-phase9-positions-'));
  const gateFile = path.join(tempDir, 'positions-scheduler-release-gate.json');
  const signoffFile = path.join(tempDir, 'positions-scheduler-signoff.json');
  const proofFile = path.join(tempDir, 'positions-scheduler-live-proof.json');
  const gateScript = path.join(tempDir, 'release-gate.stub.ts');
  const signoffScript = path.join(tempDir, 'signoff.stub.ts');

  const readyGateSummary = {
    decision: 'ready',
    generatedAt: '2026-04-10T12:00:00.000Z',
    liveChecksEnabled: true,
    totals: {
      total: 5,
      passed: 5,
      failed: 0,
      skipped: 0,
    },
    results: [
      'backend-positions-scheduler-suite',
      'backend-positions-scheduler-operational-audit',
      'backend-positions-scheduler-eslint',
      'backend-positions-health',
      'backend-positions-scheduler-health',
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
      diagnosticsVerified: true,
      productTrustVerified: true,
      rebuildDrillVerified: true,
      recoveryHistoryVerified: true,
      accessReviewVerified: true,
    },
    evidence: {
      workflowUrl: 'https://example.com/workflows/positions-scheduler',
      dashboardUrl: 'https://example.com/dashboards/positions-scheduler',
      runbookUrl: 'https://example.com/runbooks/positions-scheduler',
      releaseNoteUrl: 'https://example.com/releases/positions-scheduler',
      recoveryEvidenceUrl: 'https://example.com/evidence/positions-recovery',
    },
  };

  await writeFile(
    gateScript,
    `import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const outputFile = path.resolve(process.cwd(), String(process.env.POSITIONS_SCHEDULER_RELEASE_GATE_OUTPUT_FILE || '').trim());

async function run(): Promise<void> {
  assert.equal(process.env.POSITIONS_SCHEDULER_RUN_LIVE_CHECKS, 'true');
  assert.ok(outputFile, 'POSITIONS_SCHEDULER_RELEASE_GATE_OUTPUT_FILE must be provided');
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

const gateFile = path.resolve(process.cwd(), String(process.env.POSITIONS_SCHEDULER_SIGNOFF_GATE_FILE || '').trim());
const outputFile = path.resolve(process.cwd(), String(process.env.POSITIONS_SCHEDULER_SIGNOFF_OUTPUT_FILE || '').trim());

async function run(): Promise<void> {
  assert.equal(process.env.POSITIONS_SCHEDULER_SIGNOFF_REQUIRE_LIVE_HEALTH, 'true');
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
    ['--import', 'tsx', 'scripts/proofs/proof-positions-scheduler-live.ts'],
    {
      ...process.env,
      POSITIONS_SCHEDULER_PROOF_RELEASE_GATE_SCRIPT: gateScript,
      POSITIONS_SCHEDULER_PROOF_SIGNOFF_SCRIPT: signoffScript,
      POSITIONS_SCHEDULER_RELEASE_GATE_OUTPUT_FILE: gateFile,
      POSITIONS_SCHEDULER_SIGNOFF_OUTPUT_FILE: signoffFile,
      POSITIONS_SCHEDULER_PROOF_OUTPUT_FILE: proofFile,
      POSITIONS_SCHEDULER_SIGNOFF_APPROVER: 'codex-phase9',
      POSITIONS_SCHEDULER_SIGNOFF_DIAGNOSTICS_VERIFIED: 'true',
      POSITIONS_SCHEDULER_SIGNOFF_PRODUCT_TRUST_VERIFIED: 'true',
      POSITIONS_SCHEDULER_SIGNOFF_REBUILD_DRILL_VERIFIED: 'true',
      POSITIONS_SCHEDULER_SIGNOFF_RECOVERY_HISTORY_VERIFIED: 'true',
      POSITIONS_SCHEDULER_SIGNOFF_ACCESS_REVIEW_VERIFIED: 'true',
      POSITIONS_SCHEDULER_SIGNOFF_RECOVERY_EVIDENCE_URL:
        'https://example.com/evidence/positions-recovery',
    }
  );

  assert.equal(exitCode, 0, 'positions scheduler live proof should succeed against ready stub scripts');

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

  const checks = (summary.checks || {}) as JsonRecord;
  assert.equal(checks.liveHealthReviewed, true);
  assert.equal(checks.recoveryHistoryVerified, true);

  const evidence = (summary.evidence || {}) as JsonRecord;
  assert.equal(
    evidence.recoveryEvidenceUrl,
    readySignoffSummary.evidence.recoveryEvidenceUrl
  );
}

async function runOrdersSchedulerLiveProofAssertions(): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'positions-orders-phase9-orders-'));
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

  assert.equal(exitCode, 0, 'orders scheduler live proof should succeed against ready stub scripts');

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

  const checks = (summary.checks || {}) as JsonRecord;
  assert.equal(checks.runtimeFoundationVerified, true);
  assert.equal(checks.liveHealthReviewed, true);
}

async function runSourceMarkerAssertions(): Promise<void> {
  const packageSource = await readFile(path.join(process.cwd(), 'package.json'), 'utf8');
  const readmeSource = await readFile(path.join(process.cwd(), 'README.md'), 'utf8');
  const phase8Doc = await readFile(
    path.join(process.cwd(), 'POSITIONS_ORDERS_SYNC_PHASE8.md'),
    'utf8'
  );
  const phase9Doc = await readFile(
    path.join(process.cwd(), 'POSITIONS_ORDERS_SYNC_PHASE9.md'),
    'utf8'
  );
  const positionsProofSource = await readFile(
    path.join(process.cwd(), 'scripts', 'proofs', 'proof-positions-scheduler-live.ts'),
    'utf8'
  );
  const positionsSignoffSource = await readFile(
    path.join(process.cwd(), 'scripts', 'signoffs', 'signoff-positions-scheduler.ts'),
    'utf8'
  );
  const ordersProofSource = await readFile(
    path.join(process.cwd(), 'scripts', 'proofs', 'proof-orders-scheduler-live.ts'),
    'utf8'
  );
  const ordersSignoffSource = await readFile(
    path.join(process.cwd(), 'scripts', 'signoffs', 'signoff-orders-scheduler.ts'),
    'utf8'
  );
  const operationalAuditSource = await readFile(
    path.join(process.cwd(), 'scripts', 'test-operational-audit.ts'),
    'utf8'
  );
  const internalOrdersSyncServiceSource = await readFile(
    path.join(process.cwd(), 'src', 'api', 'services', 'InternalOrdersSyncService.ts'),
    'utf8'
  );
  const orderSubmissionRequestRepositorySource = await readFile(
    path.join(
      process.cwd(),
      'src',
      'database',
      'repositories',
      'OrderSubmissionRequestRepository.ts'
    ),
    'utf8'
  );
  const internalPositionsSyncServiceSource = await readFile(
    path.join(process.cwd(), 'src', 'api', 'services', 'InternalPositionsSyncService.ts'),
    'utf8'
  );
  const positionReadModelRepositorySource = await readFile(
    path.join(process.cwd(), 'src', 'database', 'repositories', 'PositionReadModelRepository.ts'),
    'utf8'
  );

  assert.equal(
    packageSource.includes('"test:positions-orders-sync"'),
    true,
    'package.json must expose the positions/orders shared module suite'
  );
  assert.equal(
    packageSource.includes('"test:positions-orders-sync"'),
    true,
    'test:all must include the positions/orders shared module suite'
  );

  for (const marker of [
    '"proof:positions-scheduler-live"',
    '"signoff:positions-scheduler"',
    '"release-gate:positions-scheduler"',
    '"check:positions-scheduler-health"',
    '"proof:orders-scheduler-live"',
    '"signoff:orders-scheduler"',
    '"release-gate:orders-scheduler"',
    '"check:orders-scheduler-health"',
  ]) {
    assert.equal(
      packageSource.includes(marker),
      true,
      `package.json must include ${marker} in the shared Phase 9 workflow`
    );
    assert.equal(
      operationalAuditSource.includes(marker),
      true,
      `test-operational-audit.ts must guard ${marker} in the shared Phase 9 workflow`
    );
  }

  assert.equal(
    readmeSource.includes('POSITIONS_ORDERS_SYNC_PHASE9.md'),
    true,
    'README.md must point to the shared Phase 9 positions/orders workflow note'
  );
  assert.equal(
    readmeSource.includes('proof:positions-scheduler-live'),
    true,
    'README.md must mention the positions scheduler proof command in the shared workflow'
  );
  assert.equal(
    readmeSource.includes('proof:orders-scheduler-live'),
    true,
    'README.md must mention the orders scheduler proof command in the shared workflow'
  );
  assert.equal(
    phase8Doc.includes('before Phase 9 proof/signoff work'),
    true,
    'POSITIONS_ORDERS_SYNC_PHASE8.md must keep the Phase 9 handoff note'
  );
  assert.equal(
    phase9Doc.includes('npm run proof:positions-scheduler-live'),
    true,
    'POSITIONS_ORDERS_SYNC_PHASE9.md must document the positions scheduler proof command'
  );
  assert.equal(
    phase9Doc.includes('npm run proof:orders-scheduler-live'),
    true,
    'POSITIONS_ORDERS_SYNC_PHASE9.md must document the orders scheduler proof command'
  );
  assert.equal(
    phase9Doc.includes('proof layer as frozen'),
    true,
    'POSITIONS_ORDERS_SYNC_PHASE9.md must freeze the shared proof posture'
  );
  assert.equal(
    positionsProofSource.includes('POSITIONS_SCHEDULER_SIGNOFF_RECOVERY_EVIDENCE_URL'),
    true,
    'proof-positions-scheduler-live.ts must keep the recovery evidence requirement'
  );
  assert.equal(
    positionsProofSource.includes('liveHealthReviewed'),
    true,
    'proof-positions-scheduler-live.ts must preserve live health review checks'
  );
  assert.equal(
    positionsSignoffSource.includes('recoveryHistoryVerified'),
    true,
    'signoff-positions-scheduler.ts must preserve recovery-history verification'
  );
  assert.equal(
    ordersProofSource.includes('ORDERS_SCHEDULER_SIGNOFF_RUNTIME_FOUNDATION_VERIFIED'),
    true,
    'proof-orders-scheduler-live.ts must keep the runtime foundation verification requirement'
  );
  assert.equal(
    ordersProofSource.includes('liveChecksEnabled'),
    true,
    'proof-orders-scheduler-live.ts must preserve live-check enablement in the summary'
  );
  assert.equal(
    ordersSignoffSource.includes('runtimeFoundationVerified'),
    true,
    'signoff-orders-scheduler.ts must preserve runtime foundation verification'
  );
  assert.equal(
    internalOrdersSyncServiceSource.includes('reconcileOrderSubmissionMatchesForOrderUpdates'),
    true,
    'InternalOrdersSyncService.ts must reconcile order submissions after broker order snapshots update'
  );
  assert.equal(
    internalOrdersSyncServiceSource.includes('listReconciliationCandidatesByBrokerOrderIds'),
    true,
    'InternalOrdersSyncService.ts must query submission reconciliation candidates by broker order id'
  );
  assert.equal(
    internalOrdersSyncServiceSource.includes('markReconciliationMatched'),
    true,
    'InternalOrdersSyncService.ts must mark matched order submissions during orders-sync reconciliation'
  );
  assert.equal(
    internalOrdersSyncServiceSource.includes('broker_order_snapshot_status_synced'),
    true,
    'InternalOrdersSyncService.ts must sync terminal broker order status for already-matched submissions'
  );
  assert.equal(
    orderSubmissionRequestRepositorySource.includes("states: ['pending', 'missing', 'matched']"),
    true,
    'OrderSubmissionRequestRepository.ts must include matched submissions in broker-order-id status sync candidates'
  );
  assert.equal(
    internalOrdersSyncServiceSource.includes('order submission reconciliation failed'),
    true,
    'InternalOrdersSyncService.ts must surface order submission reconciliation failures in sync results'
  );
  assert.equal(
    internalPositionsSyncServiceSource.includes(
      'enrichDeltaOpenPositionLeverageFromConfirmedOrders'
    ),
    true,
    'InternalPositionsSyncService.ts must enrich Delta open position leverage from confirmed order context'
  );
  assert.equal(
    internalPositionsSyncServiceSource.includes(
      'listLatestDeltaSubmissionLeverageContextByAssetId'
    ),
    true,
    'InternalPositionsSyncService.ts must keep the Delta leverage context query isolated'
  );
  assert.equal(
    internalPositionsSyncServiceSource.includes("AND placement_state IN ('placed', 'replayed')"),
    true,
    'InternalPositionsSyncService.ts must only use placed or replayed order submissions for leverage provenance'
  );
  assert.equal(
    internalPositionsSyncServiceSource.includes('confirmed_order_leverage'),
    true,
    'InternalPositionsSyncService.ts must retain confirmed order leverage provenance on enriched positions'
  );
  assert.equal(
    internalPositionsSyncServiceSource.includes('requested_order_submission'),
    true,
    'InternalPositionsSyncService.ts must label requested order leverage fallback provenance'
  );
  assert.equal(
    internalOrdersSyncServiceSource.includes(
      'refreshOpenDeltaProtectionFromOrderSnapshots?.'
    ),
    true,
    'InternalOrdersSyncService.ts must refresh Delta read-model protection after order snapshots update'
  );
  assert.equal(
    internalPositionsSyncServiceSource.includes(
      'refreshOpenDeltaProtectionFromOrderSnapshots?.'
    ),
    true,
    'InternalPositionsSyncService.ts must refresh Delta read-model protection after positions refreshes'
  );
  assert.equal(
    positionReadModelRepositorySource.includes('refreshOpenDeltaProtectionFromOrderSnapshots('),
    true,
    'PositionReadModelRepository.ts must expose the Delta protection refresh query'
  );
  assert.equal(
    positionReadModelRepositorySource.includes("LOWER(prm.broker_key) = 'delta_exchange'"),
    true,
    'PositionReadModelRepository.ts must scope protection refreshes to Delta open positions'
  );
}

async function main(): Promise<void> {
  await runPositionsSchedulerLiveProofAssertions();
  await runOrdersSchedulerLiveProofAssertions();
  await runSourceMarkerAssertions();
  console.log('Positions/orders sync Phase 9 guard passed.');
}

  await main();
}

async function positions_orders_syncGuard10(): Promise<void> {
  const { InternalPositionsSyncService } = await import("../src/api/services/InternalPositionsSyncService");

async function runMudrexPartialCloseAggregationAssertions(): Promise<void> {
  const service = new InternalPositionsSyncService() as any;
  const capturedPreparedRows: Array<Record<string, unknown>> = [];
  let capturedReadModelRows: Array<Record<string, unknown>> = [];

  service.positionReadModelRepository = {
    async upsertReadModels(rows: Array<Record<string, unknown>>) {
      capturedReadModelRows = rows;
    },
  };
  service.upsertPositionSnapshotBatch = async (rows: Array<Record<string, unknown>>) => {
    capturedPreparedRows.push(...rows);
    return {
      inserted: rows.length,
      updated: 0,
      skipped: 0,
      symbols: rows.map((row) => String(row.symbol || '')).filter(Boolean),
    };
  };
  service.listMudrexOrderSnapshotRowsForAggregation = async (
    userId: string,
    accountId: string,
    brokerKey: string,
    symbols: string[]
  ) => {
    assert.equal(userId, 'user-1');
    assert.equal(accountId, 'acct-mudrex');
    assert.equal(brokerKey, 'mudrex');
    assert.deepEqual(symbols, ['BTCUSDT']);
    return [
      orderPayload('entry-1', 'LONG', 0.023, 62890.7, '2026-06-09T03:16:19Z'),
      orderPayload('entry-2', 'LONG', 0.015, 62788.4, '2026-06-09T03:26:44Z'),
      orderPayload('close-1', 'SHORT', 0.02, 63244.4, '2026-06-09T04:35:36Z'),
      orderPayload('close-2', 'SHORT', 0.009, 63231.4, '2026-06-09T04:38:32Z'),
      orderPayload('close-3', 'SHORT', 0.009, 63220.2, '2026-06-09T04:42:08Z'),
    ];
  };

  const result = await service.upsertPositionSnapshotsFromItems(
    'user-1',
    'acct-mudrex',
    'mudrex',
    [
      {
        id: 'latest-close-slice',
        asset_uuid: 'asset-btc',
        symbol: 'BTCUSDT',
        status: 'CLOSED',
        position_type: 'LONG',
        quantity: '0.009',
        entry_price: '62850.31842105263',
        closed_price: '63220.2',
        pnl: '3.32893421',
        created_at: '2026-06-09T03:16:19Z',
        updated_at: '2026-06-09T04:42:08Z',
      },
    ]
  );

  assert.equal(result.inserted, 1);
  assert.equal(capturedPreparedRows.length, 1);
  assert.equal(capturedReadModelRows.length, 1);

  const payload = JSON.parse(String(capturedPreparedRows[0].payloadJson || '{}'));
  assert.equal(payload.aggregate_source, 'scheduler_orders_snapshots');
  assert.equal(payload.aggregate_future_position_uuid, 'future-btc-1');
  assert.equal(payload.aggregate_entry_order_count, 2);
  assert.equal(payload.aggregate_close_order_count, 3);
  assert.equal(payload.quantity, '0.038');
  assert.equal(Number(payload.entry_price).toFixed(8), '62850.31842105');
  assert.equal(Number(payload.closed_price).toFixed(8), '63235.58947368');
  assert.equal(Number(payload.realized_pnl).toFixed(8), '14.64030000');

  assert.equal(capturedReadModelRows[0].externalId, 'mudrex:asset-btc:2026-06-09T03:16:19Z:LONG');
  assert.equal(capturedReadModelRows[0].quantity, 0.038);
  assert.equal(Number(capturedReadModelRows[0].closedPrice).toFixed(8), '63235.58947368');
  assert.equal(Number(capturedReadModelRows[0].realizedPnl).toFixed(8), '14.64030000');
}

function runMudrexPartialLifecycleExternalIdAssertions(): void {
  const service = new InternalPositionsSyncService() as any;
  const base = {
    asset_uuid: 'asset-sol',
    symbol: 'SOLUSDT',
    position_type: 'long',
    created_at: '2026-06-16T04:00:00.000Z',
    entry_price: '73.18929104477611',
  };
  const closed = {
    ...base,
    id: 'closed-position-id',
    status: 'closed',
    quantity: '28.1',
    closed_price: '75.35',
    pnl: '19.62899999',
    updated_at: '2026-06-16T08:50:57.000Z',
  };
  const partial = {
    ...base,
    id: 'partial-position-id',
    status: 'partial',
    quantity: '16',
    closed_price: '73.67',
    pnl: '7.69134328',
    updated_at: '2026-06-16T05:26:55.000Z',
  };

  const closedRow = service.buildPositionRow('user-1', 'account-1', 'mudrex', { ...closed });
  const partialRow = service.buildPositionRow('user-1', 'account-1', 'mudrex', { ...partial });

  assert.equal(closedRow.externalId, 'mudrex:asset-sol:2026-06-16T04:00:00.000Z:LONG');
  assert.equal(
    partialRow.externalId,
    'mudrex:asset-sol:2026-06-16T04:00:00.000Z:LONG:PARTIAL:partial-position-id'
  );

  const deduped = service.deduplicateByExternalId([{ ...closed }, { ...partial }], 'mudrex');
  assert.equal(deduped.length, 2);
}

function orderPayload(
  id: string,
  orderType: string,
  quantity: number,
  filledPrice: number,
  createdAt: string
): Record<string, unknown> {
  return {
    externalId: id,
    symbol: 'BTCUSDT',
    orderStatus: 'FILLED',
    payloadJson: {
      id,
      symbol: 'BTCUSDT',
      asset_uuid: 'asset-btc',
      status: 'FILLED',
      order_type: orderType,
      quantity: String(quantity),
      filled_quantity: String(quantity),
      filled_price: String(filledPrice),
      actual_amount: String(quantity * filledPrice),
      future_position_uuid: 'future-btc-1',
      created_at: createdAt,
      updated_at: createdAt,
    },
    firstSeenAt: createdAt,
    lastSeenAt: createdAt,
  };
}

async function main(): Promise<void> {
  await runMudrexPartialCloseAggregationAssertions();
  runMudrexPartialLifecycleExternalIdAssertions();
  console.log('Positions/orders sync Phase 10 guard passed.');
}

  await main();
}

const suiteSteps = {
  "01": positions_orders_syncGuard01,
  "02": positions_orders_syncGuard02,
  "03": positions_orders_syncGuard03,
  "04": positions_orders_syncGuard04,
  "05": positions_orders_syncGuard05,
  "06": positions_orders_syncGuard06,
  "07": positions_orders_syncGuard07,
  "08": positions_orders_syncGuard08,
  "09": positions_orders_syncGuard09,
  "10": positions_orders_syncGuard10,
} as const;

export async function runPositionsOrdersSyncSuite(): Promise<void> {
  await runSuiteSteps("Positions/orders sync module", "scripts/test-positions-orders-sync.ts", ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10"]);
  console.log("Positions/orders sync module assertions passed.");
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
