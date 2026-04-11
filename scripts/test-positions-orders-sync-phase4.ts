import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { OrdersSchedulerService } from '../src/api/services/OrdersSchedulerService';
import { InternalOrdersSyncService } from '../src/api/services/InternalOrdersSyncService';
import { InternalPositionsSyncService } from '../src/api/services/InternalPositionsSyncService';
import { coreDataSource } from '../src/database/data-source';

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
    'findByIdAndSchedulerKeyAndActor',
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
  if (!readme.includes('test:positions-orders-sync-phase4')) {
    findings.push('README.md: missing positions/orders sync Phase 4 verification command');
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
    async cancelPendingBySchedulerKeyAndActor() {
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
    async cancelQueuedRunsBySchedulerKeyAndActor() {
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
}

async function testPositionsSystemSchedulerCoversMudrexAndDeltaWithFailureIsolation(): Promise<void> {
  const service = new InternalPositionsSyncService() as any;
  const originalQuery = (coreDataSource as any).query;
  const routingCalls: Array<{ userId: string; brokerKey: string; accountId: string }> = [];
  const adapterCalls: string[] = [];
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
    async upsertReadModels() {
      return undefined;
    },
    async markPositionsClosed() {
      return undefined;
    },
  };
  service.suggestedTradesService = {
    async syncExecutionForPositionUpdates() {
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
  service.upsertPositionSnapshotsFromItems = async (
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

async function run(): Promise<void> {
  testPhase4Markers();
  await testOrdersSchedulerRuntimeMigratesToUserScope();
  await testPositionsSystemSchedulerCoversMudrexAndDeltaWithFailureIsolation();
  await testOrdersSystemSchedulerCoversMudrexAndDeltaWithFailureIsolation();
  console.log('Positions/orders sync Phase 4 assertions passed.');
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
