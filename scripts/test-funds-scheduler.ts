import { runSuiteSteps } from './_support/run-script-suite';

// Consolidated module suite.

async function funds_schedulerGuard01(): Promise<void> {
  const { default: assert } = await import("node:assert/strict");
  const { default: fs } = await import("node:fs");
  const { default: path } = await import("node:path");
  const { BrokerWalletLiveFetchService } = await import("../src/api/services/BrokerWalletLiveFetchService");
  const { FundsSchedulerService } = await import("../src/api/services/FundsSchedulerService");
  const { env } = await import("../src/env");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function testFundsFunctionalChecklistBaseline(): void {
  const findings: string[] = [];

  const checklist = read('FUNDS_SYNC_FUNCTIONAL_CHECKLIST.md');
  for (const marker of [
    'Scheduler key: `funds-sync`',
    'Product route base: `/wallet`',
    'Internal execution route: `/internal/funds/snapshot`',
    '## 5. Scheduler And Cron All-Users Execution Scope',
    '## 8. Summary, Coverage, Recovery, And Product Read Boundary',
    '## 14. Time And Timezone Checks',
  ]) {
    if (!checklist.includes(marker)) {
      findings.push(`FUNDS_SYNC_FUNCTIONAL_CHECKLIST.md: missing marker ${marker}`);
    }
  }

  const readme = read('README.md');
  if (!readme.includes('FUNDS_SYNC_FUNCTIONAL_CHECKLIST.md')) {
    findings.push('README.md: missing funds functional checklist reference');
  }

  assert.equal(findings.length, 0, `Funds functional checklist guard failed:\n${findings.join('\n')}`);
}

async function testBrokerWalletLiveFetchServiceUsesRuntimeAdapters(): Promise<void> {
  const service = new BrokerWalletLiveFetchService() as any;
  const contexts: Array<Record<string, unknown>> = [];

  service.brokerAccountRoutingService = {
    async resolve(userId: string, brokerKey?: string, accountId?: string, fallbackBrokerKey?: string) {
      assert.equal(userId, 'user-1');
      assert.equal(brokerKey, 'mudrex');
      assert.equal(accountId, 'acct-1');
      assert.equal(fallbackBrokerKey, 'mudrex');
      return {
        userId,
        brokerKey: 'mudrex',
        accountId: 'acct-1',
      };
    },
  } as any;
  service.brokerRuntimeRegistry = {
    getWalletAdapter(brokerKey: string) {
      assert.equal(brokerKey, 'mudrex');
      return {
        async getWalletFunds(context: Record<string, unknown>) {
          contexts.push({ kind: 'wallet', ...context });
          return {
            success: true,
            data: {
              total: 1250,
              withdrawable: 900,
            },
          };
        },
        async getFuturesFunds(context: Record<string, unknown>) {
          contexts.push({ kind: 'futures', ...context });
          return {
            data: {
              balance: '320.00',
              locked_amount: '15.00',
              first_time_user: false,
            },
          };
        },
      };
    },
  } as any;

  const result = await service.fetchAccountFunds('user-1', 'mudrex', 'acct-1');
  assert.deepEqual(result, {
    userId: 'user-1',
    brokerKey: 'mudrex',
    accountId: 'acct-1',
    walletFunds: {
      total: 1250,
      withdrawable: 900,
    },
    futuresFunds: {
      balance: '320.00',
      locked_amount: '15.00',
      first_time_user: false,
    },
  });
  assert.deepEqual(contexts, [
    {
      kind: 'wallet',
      userId: 'user-1',
      brokerKey: 'mudrex',
      accountId: 'acct-1',
    },
    {
      kind: 'futures',
      userId: 'user-1',
      brokerKey: 'mudrex',
      accountId: 'acct-1',
    },
  ]);
}

async function testFundsSchedulerBootstrapsFirstSnapshotFromLiveFunds(): Promise<void> {
  const service = new FundsSchedulerService() as any;
  const snapshotWrites: Array<Record<string, unknown>> = [];

  service.brokerAccountRepository = {
    async getActiveBrokerAccounts(userId: string) {
      assert.equal(userId, 'user-1');
      return [
        {
          id: 'acct-1',
          userId: 'user-1',
          brokerKey: 'mudrex',
          status: 'Connected',
        },
      ];
    },
    async getActiveSystemBrokerAccounts() {
      assert.fail('owner-specific bootstrap should not query system accounts');
    },
    async getAllActiveBrokerAccounts() {
      assert.fail('owner-specific bootstrap should not query infra-all accounts');
    },
  } as any;
  service.brokerWalletLiveFetchService = {
    async fetchAccountFunds(userId: string, brokerKey: string, accountId: string) {
      assert.equal(userId, 'user-1');
      assert.equal(brokerKey, 'mudrex');
      assert.equal(accountId, 'acct-1');
      return {
        userId,
        brokerKey,
        accountId,
        walletFunds: {
          total: 1000,
          withdrawable: 875,
        },
        futuresFunds: {
          balance: '220.00',
          locked_amount: '10.00',
          first_time_user: false,
        },
      };
    },
  } as any;
  service.fundsSnapshotRepository = {
    async createSnapshot(payload: Record<string, unknown>) {
      snapshotWrites.push(payload);
      return {
        inserted: true,
        updated: false,
      };
    },
  } as any;

  const result = await service.runSnapshotBatch({
    targetUserIds: ['user-1'],
    brokerKeys: [],
    accountIds: [],
  });

  assert.deepEqual(result, {
    totalAccounts: 1,
    successCount: 1,
    insertedCount: 1,
    updatedCount: 0,
    failureCount: 0,
    failures: [],
  });
  assert.equal(snapshotWrites.length, 1);
  assert.equal(snapshotWrites[0].userId, 'user-1');
  assert.equal(snapshotWrites[0].brokerKey, 'mudrex');
  assert.equal(snapshotWrites[0].accountId, 'acct-1');
  assert.deepEqual(snapshotWrites[0].walletFunds, {
    total: 1000,
    withdrawable: 875,
  });
  assert.deepEqual(snapshotWrites[0].futuresFunds, {
    balance: '220.00',
    locked_amount: '10.00',
    first_time_user: false,
  });
  assert.ok(snapshotWrites[0].computedAt instanceof Date);
}

async function testFundsSchedulerInfraRunSkipsOwnerlessSystemAccounts(): Promise<void> {
  const service = new FundsSchedulerService() as any;
  const fetchCalls: Array<Record<string, unknown>> = [];
  const snapshotWrites: Array<Record<string, unknown>> = [];

  service.brokerAccountRepository = {
    async getAllActiveBrokerAccounts() {
      return [
        {
          id: 'acct-delta-admin',
          userId: 'admin-user',
          brokerKey: 'delta_exchange',
          status: 'Connected',
        },
        {
          id: 'acct-delta-codeanik',
          userId: 'codeanik-user',
          brokerKey: 'delta_exchange',
          status: 'Connected',
        },
        {
          id: 'acct-mudrex-admin',
          userId: 'admin-user',
          brokerKey: 'mudrex',
          status: 'Connected',
        },
        {
          id: 'acct-mudrex-codeanik',
          userId: 'codeanik-user',
          brokerKey: 'mudrex',
          status: 'Connected',
        },
        {
          id: 'acct-system-delta',
          userId: null,
          brokerKey: 'delta_exchange',
          status: 'Connected',
        },
        {
          id: 'acct-system-mudrex',
          userId: null,
          brokerKey: 'mudrex',
          status: 'Connected',
        },
      ];
    },
    async getActiveBrokerAccounts() {
      assert.fail('infra-all run should not query per-user account lists');
    },
    async getActiveSystemBrokerAccounts() {
      assert.fail('infra-all run should not query legacy system-only account lists');
    },
  } as any;
  service.brokerWalletLiveFetchService = {
    async fetchAccountFunds(userId: string, brokerKey: string, accountId: string) {
      fetchCalls.push({ userId, brokerKey, accountId });
      return {
        userId,
        brokerKey,
        accountId,
        walletFunds: {
          total: 300,
        },
        futuresFunds: {
          balance: '40.00',
          locked_amount: '0.00',
          first_time_user: false,
        },
      };
    },
  } as any;
  service.fundsSnapshotRepository = {
    async createSnapshot(payload: Record<string, unknown>) {
      snapshotWrites.push(payload);
      return {
        inserted: String(payload.accountId || '').includes('delta'),
        updated: String(payload.accountId || '').includes('mudrex'),
      };
    },
  } as any;

  const result = await service.runSnapshotBatch({
    targetUserIds: [env.scheduler.systemUserId],
    brokerKeys: [],
    accountIds: [],
  });

  assert.deepEqual(fetchCalls, [
    {
      userId: 'admin-user',
      brokerKey: 'delta_exchange',
      accountId: 'acct-delta-admin',
    },
    {
      userId: 'admin-user',
      brokerKey: 'mudrex',
      accountId: 'acct-mudrex-admin',
    },
    {
      userId: 'codeanik-user',
      brokerKey: 'delta_exchange',
      accountId: 'acct-delta-codeanik',
    },
    {
      userId: 'codeanik-user',
      brokerKey: 'mudrex',
      accountId: 'acct-mudrex-codeanik',
    },
  ]);
  assert.equal(snapshotWrites.length, 4);
  assert.deepEqual(
    snapshotWrites.map((entry) => ({
      userId: entry.userId,
      brokerKey: entry.brokerKey,
      accountId: entry.accountId,
    })),
    fetchCalls
  );
  assert.equal(result.totalAccounts, 4);
  assert.equal(result.successCount, 4);
  assert.equal(result.insertedCount, 2);
  assert.equal(result.updatedCount, 2);
  assert.equal(result.failureCount, 0);
  assert.deepEqual(result.failures, []);
}

async function run(): Promise<void> {
  testFundsFunctionalChecklistBaseline();
  await testBrokerWalletLiveFetchServiceUsesRuntimeAdapters();
  await testFundsSchedulerBootstrapsFirstSnapshotFromLiveFunds();
  await testFundsSchedulerInfraRunSkipsOwnerlessSystemAccounts();
  console.log('Funds scheduler phase 1 assertions passed.');
}

  await run();
}

async function funds_schedulerGuard02(): Promise<void> {
  const { default: assert } = await import("node:assert/strict");
  const { FundsSchedulerService } = await import("../src/api/services/FundsSchedulerService");
  const { env } = await import("../src/env");

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

  await run();
}

async function funds_schedulerGuard03(): Promise<void> {
  const { default: assert } = await import("node:assert/strict");
  const { FundsSchedulerService } = await import("../src/api/services/FundsSchedulerService");
  const { FundsSnapshotRepository } = await import("../src/database/repositories/FundsSnapshotRepository");
  const { coreDataSource } = await import("../src/database/data-source");
  const { HardenFundsSnapshotsRuntime1770707000000 } = await import("../src/database/migrations/1770707000000-HardenFundsSnapshotsRuntime");

function createMigrationQueryRunner(options: {
  hasTable?: Record<string, boolean>;
  hasColumn?: Record<string, boolean>;
  existingIndexes?: Record<string, string[]>;
}) {
  const queries: Array<{ sql: string; params?: unknown[] }> = [];

  const queryRunner = {
    async hasTable(tableName: string) {
      return options.hasTable?.[tableName] ?? false;
    },
    async hasColumn(tableName: string, columnName: string) {
      return options.hasColumn?.[`${tableName}.${columnName}`] ?? false;
    },
    async query(sql: string, params?: unknown[]) {
      queries.push({ sql, params });

      if (sql.startsWith('SHOW INDEX FROM ')) {
        const indexName = String(params?.[0] || '');
        const indexes = options.existingIndexes?.funds_snapshots || [];
        return indexes.includes(indexName) ? [{ Key_name: indexName }] : [];
      }

      return [];
    },
  };

  return { queryRunner, queries };
}

async function testFundsSnapshotMigrationRepairsRuntimeColumnsAndIndexes(): Promise<void> {
  const migration = new HardenFundsSnapshotsRuntime1770707000000();
  const { queryRunner, queries } = createMigrationQueryRunner({
    hasTable: {
      funds_snapshots: true,
    },
    hasColumn: {
      'funds_snapshots.snapshot_date': false,
      'funds_snapshots.observed_at': false,
      'funds_snapshots.last_attempt_at': false,
      'funds_snapshots.fetch_status': false,
      'funds_snapshots.error_message': false,
      'funds_snapshots.source': false,
    },
    existingIndexes: {
      funds_snapshots: ['idx_funds_snapshots_user_computed', 'idx_funds_snapshots_user_broker_account'],
    },
  });

  await migration.up(queryRunner as any);

  assert.ok(
    queries.some((entry) => entry.sql.includes('ADD COLUMN snapshot_date date NULL AFTER computed_at')),
    'Phase 3 migration should add snapshot_date'
  );
  assert.ok(
    queries.some((entry) => entry.sql.includes('ADD COLUMN last_attempt_at timestamp NULL AFTER observed_at')),
    'Phase 3 migration should add last_attempt_at'
  );
  assert.ok(
    queries.some((entry) => entry.sql.includes('UPDATE funds_snapshots')),
    'Phase 3 migration should backfill structured metadata'
  );
  assert.ok(
    queries.some((entry) => entry.sql.includes('DELETE older')),
    'Phase 3 migration should deduplicate daily rows before uniqueness is enforced'
  );
  assert.ok(
    queries.some((entry) =>
      entry.sql.includes('ADD UNIQUE KEY uidx_funds_snapshots_user_account_day')
    ),
    'Phase 3 migration should enforce one row per user, account, and snapshot_date'
  );
  assert.ok(
    queries.some((entry) =>
      entry.sql.includes('ADD KEY idx_funds_snapshots_user_status_attempt')
    ),
    'Phase 3 migration should add the status/attempt read-path index'
  );
}

async function testFundsSnapshotRepositoryUsesAtomicUpsertAndCoverageQuery(): Promise<void> {
  const repository = new FundsSnapshotRepository();
  const originalQuery = (coreDataSource as any).query;
  const capturedQueries: Array<{ sql: string; params: unknown[] }> = [];

  (coreDataSource as any).query = async (sql: string, params: unknown[] = []) => {
    capturedQueries.push({ sql, params });

    if (sql.includes('ON DUPLICATE KEY UPDATE')) {
      return { affectedRows: 1 };
    }

    if (sql.includes('FROM broker_accounts ba')) {
      return [
        {
          user_id: 'user-1',
          broker_key: 'mudrex',
          account_id: 'acct-1',
          account_name: 'Primary Mudrex',
          account_key: 'mudrex-primary',
          account_status: 'Connected',
          latest_snapshot_id: 'snap-1',
          latest_snapshot_date: '2026-04-10',
          latest_observed_at: new Date('2026-04-10T09:58:00.000Z'),
          latest_last_attempt_at: new Date('2026-04-10T10:00:00.000Z'),
          latest_fetch_status: 'failed',
          latest_error_message: 'Broker timeout',
          latest_source: 'broker_runtime',
          latest_computed_at: new Date('2026-04-10T09:58:00.000Z'),
          latest_wallet_available: 1,
          latest_futures_available: 0,
          latest_success_snapshot_id: 'snap-1',
          latest_success_snapshot_date: '2026-04-10',
          latest_success_observed_at: new Date('2026-04-10T09:58:00.000Z'),
          latest_success_computed_at: new Date('2026-04-10T09:58:00.000Z'),
          latest_success_source: 'broker_runtime',
        },
      ];
    }

    throw new Error(`Unexpected SQL in funds scheduler phase 3 repository test: ${sql}`);
  };

  try {
    const mutation = await repository.createSnapshot({
      userId: 'user-1',
      brokerKey: 'mudrex',
      accountId: 'acct-1',
      walletFunds: { total: 1200 },
      futuresFunds: { balance: '320.00' },
      computedAt: new Date('2026-04-10T10:00:00.000Z'),
      observedAt: new Date('2026-04-10T09:58:00.000Z'),
      source: 'broker_runtime',
    });

    assert.deepEqual(mutation, {
      inserted: true,
      updated: false,
    });
    assert.ok(
      capturedQueries.some(
        (entry) =>
          entry.sql.includes('ON DUPLICATE KEY UPDATE') &&
          entry.params.includes('2026-04-10')
      ),
      'createSnapshot should use an atomic upsert keyed by snapshot_date'
    );

    const coverage = await repository.listLatestAccountCoverage('user-1');
    assert.equal(coverage.length, 1);
    assert.equal(coverage[0].latest_fetch_status, 'failed');
    assert.equal(coverage[0].latest_wallet_available, true);
    assert.equal(coverage[0].latest_futures_available, false);
    assert.equal(coverage[0].latest_success_snapshot_date, '2026-04-10');
  } finally {
    (coreDataSource as any).query = originalQuery;
  }
}

async function testFundsSnapshotRepositoryLatestReadSkipsFailureOnlyRows(): Promise<void> {
  const repository = new FundsSnapshotRepository();
  const originalQuery = (coreDataSource as any).query;
  let latestQuerySeen = false;

  (coreDataSource as any).query = async (sql: string) => {
    if (sql.includes('FROM funds_snapshots') && sql.includes('wallet_funds_json IS NOT NULL')) {
      latestQuerySeen = true;
      return [
        {
          id: 'snap-success',
          user_id: 'user-1',
          broker_key: 'mudrex',
          account_id: 'acct-1',
          wallet_funds_json: JSON.stringify({ total: 800 }),
          futures_funds_json: null,
          computed_at: new Date('2026-04-09T08:00:00.000Z'),
          snapshot_date: '2026-04-09',
          observed_at: new Date('2026-04-09T08:00:00.000Z'),
          last_attempt_at: new Date('2026-04-10T10:00:00.000Z'),
          fetch_status: 'failed',
          error_message: 'Latest refresh failed',
          source: 'broker_runtime',
          created_at: new Date('2026-04-09T08:00:00.000Z'),
        },
      ];
    }

    throw new Error(`Unexpected SQL in funds scheduler phase 3 latest-read test: ${sql}`);
  };

  try {
    const snapshot = await repository.getLatestSnapshot('user-1', 'mudrex', 'acct-1');
    assert.equal(latestQuerySeen, true);
    assert.equal(snapshot?.id, 'snap-success');
    assert.equal(snapshot?.fetch_status, 'failed');
    assert.equal(snapshot?.snapshot_date, '2026-04-09');
  } finally {
    (coreDataSource as any).query = originalQuery;
  }
}

async function testFundsSchedulerPersistsFailureMetadataWithoutMaskingRunResult(): Promise<void> {
  const service = new FundsSchedulerService() as any;
  const recordedFailures: Array<Record<string, unknown>> = [];

  service.brokerAccountRepository = {
    async getActiveBrokerAccounts() {
      return [
        {
          id: 'acct-1',
          userId: 'user-1',
          brokerKey: 'mudrex',
          status: 'Connected',
        },
      ];
    },
    async getActiveSystemBrokerAccounts() {
      assert.fail('owner-specific Phase 3 failure test should not read system accounts');
    },
    async getAllActiveBrokerAccounts() {
      assert.fail('owner-specific Phase 3 failure test should not read infra accounts');
    },
  } as any;
  service.brokerWalletLiveFetchService = {
    async fetchAccountFunds() {
      throw new Error('Broker timeout');
    },
  } as any;
  service.fundsSnapshotRepository = {
    async createSnapshot() {
      assert.fail('createSnapshot should not run for a failed broker fetch');
    },
    async recordFetchFailure(payload: Record<string, unknown>) {
      recordedFailures.push(payload);
      return {
        inserted: true,
        updated: false,
      };
    },
  } as any;

  const result = await service.runSnapshotBatch({
    targetUserIds: ['user-1'],
    brokerKeys: [],
    accountIds: [],
  });

  assert.equal(result.failureCount, 1);
  assert.equal(result.successCount, 0);
  assert.equal(recordedFailures.length, 1);
  assert.equal(recordedFailures[0].userId, 'user-1');
  assert.equal(recordedFailures[0].brokerKey, 'mudrex');
  assert.equal(recordedFailures[0].accountId, 'acct-1');
  assert.equal(recordedFailures[0].source, 'broker_runtime');
  assert.equal(recordedFailures[0].errorMessage, 'Broker timeout');
  assert.ok(recordedFailures[0].attemptedAt instanceof Date);
}

async function run(): Promise<void> {
  await testFundsSnapshotMigrationRepairsRuntimeColumnsAndIndexes();
  await testFundsSnapshotRepositoryUsesAtomicUpsertAndCoverageQuery();
  await testFundsSnapshotRepositoryLatestReadSkipsFailureOnlyRows();
  await testFundsSchedulerPersistsFailureMetadataWithoutMaskingRunResult();
  console.log('Funds scheduler phase 3 assertions passed.');
}

  await run();
}

async function funds_schedulerGuard04(): Promise<void> {
  const { default: assert } = await import("node:assert/strict");
  const { FundsSchedulerService } = await import("../src/api/services/FundsSchedulerService");

function createAnchorConfig() {
  return {
    id: 'anchor-1',
    key: 'funds-sync',
    name: 'Funds Snapshot Sync',
    description: 'Captures wallet and futures funds for connected broker accounts.',
    enabled: true,
    cronExpression: '0 1 * * *',
    timezone: 'Asia/Kolkata',
    runAt: '01:00',
    intervalDays: 1,
    batchSize: 200,
    schedulerType: 'user',
    config: {
      sources: ['funds'],
      retentionDays: 30,
    },
  };
}

function createUserConfig() {
  return {
    id: 'funds-user-config-1',
    schedulerKey: 'funds-sync',
    userId: 'user-1',
    name: 'Funds Snapshot Sync',
    description: 'Captures wallet and futures funds for connected broker accounts.',
    enabled: true,
    cronExpression: '0 1 * * *',
    timezone: 'Asia/Kolkata',
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
  };
}

async function testFundsSchedulerSummaryUsesCoverageAndTimezone(): Promise<void> {
  const service = new FundsSchedulerService() as any;
  const originalDateNow = Date.now;
  Date.now = () => new Date('2026-04-10T19:00:00.000Z').getTime();

  service.userTimeZoneService = {
    async resolveUserTimeZone(userId: string) {
      assert.equal(userId, 'user-1');
      return 'Asia/Kolkata';
    },
  };
  service.schedulerConfigRepository = {
    async createIfMissing() {
      return createAnchorConfig();
    },
    async updateByKey() {
      return createAnchorConfig();
    },
  };
  service.schedulerUserConfigRepository = {
    async createIfMissing() {
      return createUserConfig();
    },
    async updateBySchedulerKeyAndUserId() {
      return createUserConfig();
    },
  };
  service.fundsSnapshotRepository = {
    async listLatestAccountCoverage(userId: string) {
      assert.equal(userId, 'user-1');
      return [
        {
          user_id: 'user-1',
          broker_key: 'mudrex',
          account_id: 'acct-fresh',
          account_name: 'Fresh Account',
          account_key: 'fresh-account',
          account_status: 'Connected',
          latest_snapshot_id: 'snap-fresh',
          latest_snapshot_date: '2026-04-11',
          latest_observed_at: new Date('2026-04-10T18:20:00.000Z'),
          latest_last_attempt_at: new Date('2026-04-10T18:22:00.000Z'),
          latest_fetch_status: 'success',
          latest_error_message: null,
          latest_source: 'broker_runtime',
          latest_computed_at: new Date('2026-04-10T18:20:00.000Z'),
          latest_wallet_available: true,
          latest_futures_available: true,
          latest_success_snapshot_id: 'snap-fresh',
          latest_success_snapshot_date: '2026-04-11',
          latest_success_observed_at: new Date('2026-04-10T18:20:00.000Z'),
          latest_success_computed_at: new Date('2026-04-10T18:20:00.000Z'),
          latest_success_source: 'broker_runtime',
          latest_success_wallet_available: true,
          latest_success_futures_available: true,
        },
        {
          user_id: 'user-1',
          broker_key: 'delta_exchange',
          account_id: 'acct-failed-fresh',
          account_name: 'Fresh But Failed Retry',
          account_key: 'fresh-failed',
          account_status: 'Connected',
          latest_snapshot_id: 'snap-failed',
          latest_snapshot_date: '2026-04-11',
          latest_observed_at: null,
          latest_last_attempt_at: new Date('2026-04-10T18:55:00.000Z'),
          latest_fetch_status: 'failed',
          latest_error_message: 'Broker timeout',
          latest_source: 'broker_runtime',
          latest_computed_at: new Date('2026-04-10T18:55:00.000Z'),
          latest_wallet_available: false,
          latest_futures_available: false,
          latest_success_snapshot_id: 'snap-failed-success',
          latest_success_snapshot_date: '2026-04-11',
          latest_success_observed_at: new Date('2026-04-10T18:10:00.000Z'),
          latest_success_computed_at: new Date('2026-04-10T18:10:00.000Z'),
          latest_success_source: 'broker_runtime',
          latest_success_wallet_available: true,
          latest_success_futures_available: false,
        },
        {
          user_id: 'user-1',
          broker_key: 'binance',
          account_id: 'acct-stale',
          account_name: 'Stale Account',
          account_key: 'stale-account',
          account_status: 'Idle',
          latest_snapshot_id: 'snap-stale',
          latest_snapshot_date: '2026-04-10',
          latest_observed_at: new Date('2026-04-10T02:00:00.000Z'),
          latest_last_attempt_at: new Date('2026-04-10T02:05:00.000Z'),
          latest_fetch_status: 'success',
          latest_error_message: null,
          latest_source: 'broker_runtime',
          latest_computed_at: new Date('2026-04-10T02:00:00.000Z'),
          latest_wallet_available: true,
          latest_futures_available: true,
          latest_success_snapshot_id: 'snap-stale',
          latest_success_snapshot_date: '2026-04-10',
          latest_success_observed_at: new Date('2026-04-10T02:00:00.000Z'),
          latest_success_computed_at: new Date('2026-04-10T02:00:00.000Z'),
          latest_success_source: 'broker_runtime',
          latest_success_wallet_available: true,
          latest_success_futures_available: true,
        },
        {
          user_id: 'user-1',
          broker_key: 'mudrex',
          account_id: 'acct-missing',
          account_name: 'Missing Account',
          account_key: 'missing-account',
          account_status: 'Connected',
          latest_snapshot_id: 'snap-missing',
          latest_snapshot_date: '2026-04-11',
          latest_observed_at: null,
          latest_last_attempt_at: new Date('2026-04-10T18:40:00.000Z'),
          latest_fetch_status: 'failed',
          latest_error_message: 'No snapshot yet',
          latest_source: 'broker_runtime',
          latest_computed_at: new Date('2026-04-10T18:40:00.000Z'),
          latest_wallet_available: false,
          latest_futures_available: false,
          latest_success_snapshot_id: null,
          latest_success_snapshot_date: null,
          latest_success_observed_at: null,
          latest_success_computed_at: null,
          latest_success_source: null,
          latest_success_wallet_available: false,
          latest_success_futures_available: false,
        },
      ];
    },
  };
  service.schedulerRuntimeSchemaService = {
    async inspectFundsRuntimeSchema() {
      return {
        status: 'ready',
        migrationName: '1770707000000-HardenFundsSnapshotsRuntime',
        requiredTables: ['funds_snapshots'],
        requiredColumns: [
          'funds_snapshots.snapshot_date',
          'funds_snapshots.observed_at',
          'funds_snapshots.last_attempt_at',
        ],
      };
    },
  };
  service.schedulerRunLogRepository = {
    async listRunsBySchedulerKeyAndActor(
      schedulerKey: string,
      actorUserId: string,
      limit: number,
      offset: number
    ) {
      assert.equal(schedulerKey, 'funds-sync');
      assert.equal(actorUserId, 'user-1');
      assert.equal(limit, 25);
      assert.equal(offset, 0);
      return {
        items: [
          {
            id: 'run-failed',
            status: 'Failed',
            startedAt: new Date('2026-04-10T18:50:00.000Z'),
            finishedAt: new Date('2026-04-10T18:51:00.000Z'),
            processedAccounts: 4,
            insertedAssets: 0,
            updatedAssets: 0,
            skippedAssets: 4,
          },
          {
            id: 'run-success',
            status: 'Completed',
            startedAt: new Date('2026-04-10T18:00:00.000Z'),
            finishedAt: new Date('2026-04-10T18:05:00.000Z'),
            processedAccounts: 4,
            insertedAssets: 2,
            updatedAssets: 1,
            skippedAssets: 1,
          },
        ],
        total: 2,
      };
    },
  };

  try {
    const response = await service.getSchedulerDiagnosticsSummary('user-1');

    assert.equal(response.data.schedulerKey, 'funds-sync');
    assert.equal(response.data.timezone, 'Asia/Kolkata');
    assert.equal(response.data.localDate, '2026-04-11');
    assert.equal(response.data.totalConnectedAccounts, 4);
    assert.equal(response.data.accountsWithFreshSnapshot, 2);
    assert.equal(response.data.accountsWithStaleSnapshot, 1);
    assert.equal(response.data.accountsMissingSnapshot, 1);
    assert.equal(response.data.accountsWithFailedLatestAttempt, 2);
    assert.equal(response.data.accountsWithSuccessfulLatestAttempt, 2);
    assert.equal(response.data.latestObservedSnapshotAt, '2026-04-10T18:20:00.000Z');
    assert.equal(response.data.latestObservedSnapshotAgeMinutes, 40);
    assert.equal(response.data.latestAttemptAt, '2026-04-10T18:55:00.000Z');
    assert.equal(response.data.latestAttemptAgeMinutes, 5);
    assert.deepEqual(response.data.lastSuccessfulRun, {
      id: 'run-success',
      status: 'Completed',
      startedAt: '2026-04-10T18:00:00.000Z',
      finishedAt: '2026-04-10T18:05:00.000Z',
      targetedAccounts: 4,
      refreshedAccounts: 3,
      failedAccounts: 1,
    });
    assert.equal(response.data.runtimeFoundation?.status, 'ready');
    assert.equal(response.data.recoveryRunSupported, true);
    assert.equal(response.data.recoveryRunScope, 'account');
    assert.equal(response.data.runUpdatesSupported, false);
    assert.equal(response.data.runUpdatesSupportState, 'not_emitted');
    assert.match(response.data.runUpdatesReason, /does not emit per-record update logs/);
  } finally {
    Date.now = originalDateNow;
  }
}

async function testFundsSchedulerCoverageFiltersAttentionStates(): Promise<void> {
  const service = new FundsSchedulerService() as any;
  const originalDateNow = Date.now;
  Date.now = () => new Date('2026-04-10T19:00:00.000Z').getTime();

  service.userTimeZoneService = {
    async resolveUserTimeZone() {
      return 'Asia/Kolkata';
    },
  };
  service.schedulerConfigRepository = {
    async createIfMissing() {
      return createAnchorConfig();
    },
    async updateByKey() {
      return createAnchorConfig();
    },
  };
  service.schedulerUserConfigRepository = {
    async createIfMissing() {
      return createUserConfig();
    },
    async updateBySchedulerKeyAndUserId() {
      return createUserConfig();
    },
  };
  service.fundsSnapshotRepository = {
    async listLatestAccountCoverage(userId: string, brokerKey?: string) {
      assert.equal(userId, 'user-1');
      assert.equal(brokerKey, 'delta_exchange');
      return [
        {
          user_id: 'user-1',
          broker_key: 'delta_exchange',
          account_id: 'acct-failed-fresh',
          account_name: 'Fresh But Failed Retry',
          account_key: 'fresh-failed',
          account_status: 'Connected',
          latest_snapshot_id: 'snap-failed',
          latest_snapshot_date: '2026-04-11',
          latest_observed_at: null,
          latest_last_attempt_at: new Date('2026-04-10T18:55:00.000Z'),
          latest_fetch_status: 'failed',
          latest_error_message: 'Broker timeout',
          latest_source: 'broker_runtime',
          latest_computed_at: new Date('2026-04-10T18:55:00.000Z'),
          latest_wallet_available: false,
          latest_futures_available: false,
          latest_success_snapshot_id: 'snap-failed-success',
          latest_success_snapshot_date: '2026-04-11',
          latest_success_observed_at: new Date('2026-04-10T18:10:00.000Z'),
          latest_success_computed_at: new Date('2026-04-10T18:10:00.000Z'),
          latest_success_source: 'broker_runtime',
          latest_success_wallet_available: true,
          latest_success_futures_available: false,
        },
        {
          user_id: 'user-1',
          broker_key: 'delta_exchange',
          account_id: 'acct-success',
          account_name: 'Healthy Account',
          account_key: 'healthy-account',
          account_status: 'Connected',
          latest_snapshot_id: 'snap-ok',
          latest_snapshot_date: '2026-04-11',
          latest_observed_at: new Date('2026-04-10T18:45:00.000Z'),
          latest_last_attempt_at: new Date('2026-04-10T18:45:00.000Z'),
          latest_fetch_status: 'success',
          latest_error_message: null,
          latest_source: 'broker_runtime',
          latest_computed_at: new Date('2026-04-10T18:45:00.000Z'),
          latest_wallet_available: true,
          latest_futures_available: true,
          latest_success_snapshot_id: 'snap-ok',
          latest_success_snapshot_date: '2026-04-11',
          latest_success_observed_at: new Date('2026-04-10T18:45:00.000Z'),
          latest_success_computed_at: new Date('2026-04-10T18:45:00.000Z'),
          latest_success_source: 'broker_runtime',
          latest_success_wallet_available: true,
          latest_success_futures_available: true,
        },
      ];
    },
  };
  service.schedulerRuntimeSchemaService = {
    async inspectFundsRuntimeSchema() {
      return {
        status: 'ready',
        migrationName: '1770707000000-HardenFundsSnapshotsRuntime',
        requiredTables: ['funds_snapshots'],
        requiredColumns: [
          'funds_snapshots.snapshot_date',
          'funds_snapshots.observed_at',
          'funds_snapshots.last_attempt_at',
        ],
      };
    },
  };

  try {
    const response = await service.listSchedulerCoverage('user-1', {
      limit: '10',
      offset: '0',
      brokerKey: 'delta_exchange',
      freshnessState: 'fresh',
      latestFetchStatus: 'failed',
    });

    assert.equal(response.data.total, 1);
    assert.equal(response.data.timezone, 'Asia/Kolkata');
    assert.equal(response.data.localDate, '2026-04-11');
    assert.deepEqual(response.data.items[0], {
      accountId: 'acct-failed-fresh',
      accountName: 'Fresh But Failed Retry',
      accountKey: 'fresh-failed',
      brokerKey: 'delta_exchange',
      accountStatus: 'Connected',
      freshnessState: 'fresh',
      latestSnapshotDate: '2026-04-11',
      latestObservedAt: '2026-04-10T18:10:00.000Z',
      latestObservedAgeMinutes: 50,
      latestFetchStatus: 'failed',
      latestAttemptAt: '2026-04-10T18:55:00.000Z',
      latestAttemptAgeMinutes: 5,
      latestError: 'Broker timeout',
      latestSource: 'broker_runtime',
      walletSnapshotAvailable: true,
      futuresSnapshotAvailable: false,
      needsAttention: true,
    });
  } finally {
    Date.now = originalDateNow;
  }
}

async function run(): Promise<void> {
  await testFundsSchedulerSummaryUsesCoverageAndTimezone();
  await testFundsSchedulerCoverageFiltersAttentionStates();
  console.log('Funds scheduler phase 4 assertions passed.');
}

  await run();
}

async function funds_schedulerGuard06(): Promise<void> {
  const { default: assert } = await import("node:assert/strict");
  const { FundsSchedulerService } = await import("../src/api/services/FundsSchedulerService");
  const { env } = await import("../src/env");

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

  await run();
}

async function funds_schedulerGuard07(): Promise<void> {
  const { default: assert } = await import("node:assert/strict");
  const { spawn } = await import("node:child_process");
  const { mkdtemp, readFile, writeFile } = await import("node:fs/promises");
  const { default: os } = await import("node:os");
  const { default: path } = await import("node:path");
  const { SchedulerRuntimeSchemaService } = await import("../src/api/services/SchedulerRuntimeSchemaService");
  const { FundsSchedulerService } = await import("../src/api/services/FundsSchedulerService");
  const { coreDataSource } = await import("../src/database/data-source");

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

async function testRuntimeSchemaServiceReportsReadyFundsFoundation(): Promise<void> {
  const service = new SchedulerRuntimeSchemaService();
  const originalQuery = (coreDataSource as any).query;

  (coreDataSource as any).query = async (sql: string) => {
    if (sql.includes('FROM information_schema.tables')) {
      return [{ tableName: 'funds_snapshots' }];
    }
    if (sql.includes('FROM information_schema.columns')) {
      return [
        { columnName: 'snapshot_date' },
        { columnName: 'observed_at' },
        { columnName: 'last_attempt_at' },
        { columnName: 'fetch_status' },
        { columnName: 'error_message' },
        { columnName: 'source' },
      ];
    }
    if (sql.includes('FROM information_schema.statistics')) {
      return [
        { indexName: 'uidx_funds_snapshots_user_account_day' },
        { indexName: 'idx_funds_snapshots_user_status_attempt' },
        { indexName: 'idx_funds_snapshots_user_broker_account_attempt' },
      ];
    }
    throw new Error(`Unexpected SQL in funds scheduler phase 7 runtime-ready test: ${sql}`);
  };

  try {
    const status = await service.inspectFundsRuntimeSchema();
    assert.equal(status.status, 'ready');
    assert.equal(status.migrationName, '1770707000000-HardenFundsSnapshotsRuntime');
    assert.deepEqual(status.requiredTables, ['funds_snapshots']);
    assert.ok(status.requiredColumns.includes('funds_snapshots.snapshot_date'));
    assert.equal(status.missingParts, undefined);
  } finally {
    (coreDataSource as any).query = originalQuery;
  }
}

async function testRuntimeSchemaServiceReportsMissingFundsFoundation(): Promise<void> {
  const service = new SchedulerRuntimeSchemaService();
  const originalQuery = (coreDataSource as any).query;

  (coreDataSource as any).query = async (sql: string) => {
    if (sql.includes('FROM information_schema.tables')) {
      return [];
    }
    throw new Error(`Unexpected SQL in funds scheduler phase 7 runtime-missing test: ${sql}`);
  };

  try {
    const status = await service.inspectFundsRuntimeSchema();
    assert.equal(status.status, 'missing');
    assert.deepEqual(status.missingParts, ['funds_snapshots']);
    assert.match(
      String(status.note || ''),
      /Run migration 1770707000000-HardenFundsSnapshotsRuntime/
    );
  } finally {
    (coreDataSource as any).query = originalQuery;
  }
}

async function testFundsSummaryFallsBackWhenRuntimeFoundationMissing(): Promise<void> {
  const service = new FundsSchedulerService() as any;

  service.userTimeZoneService = {
    async resolveUserTimeZone() {
      return 'UTC';
    },
  };
  service.ensureSchedulerConfig = async () => ({
    enabled: true,
    timezone: 'UTC',
    config: {
      sources: ['funds'],
      retentionDays: 30,
    },
  });
  service.schedulerRuntimeSchemaService = {
    async inspectFundsRuntimeSchema() {
      return {
        status: 'missing',
        migrationName: '1770707000000-HardenFundsSnapshotsRuntime',
        requiredTables: ['funds_snapshots'],
        requiredColumns: ['funds_snapshots.snapshot_date'],
        missingParts: ['funds_snapshots.snapshot_date'],
        note: 'Run migration 1770707000000-HardenFundsSnapshotsRuntime before using funds sync diagnostics or scoped recovery.',
      };
    },
  };
  service.brokerAccountRepository = {
    async getActiveBrokerAccounts(userId: string) {
      assert.equal(userId, 'user-1');
      return [
        {
          id: 'acct-1',
          accountName: 'Primary Wallet',
          accountKey: 'primary-wallet',
          brokerKey: 'mudrex',
          status: 'Connected',
        },
      ];
    },
  };
  service.fundsSnapshotRepository = {
    async listLatestAccountCoverage() {
      assert.fail('fallback summary should not query funds snapshots when runtime foundation is missing');
    },
  };
  service.schedulerRunLogRepository = {
    async listRunsBySchedulerKeyAndActor() {
      return {
        items: [],
        total: 0,
      };
    },
  };

  const response = await service.getSchedulerDiagnosticsSummary('user-1');
  assert.equal(response.data.totalConnectedAccounts, 1);
  assert.equal(response.data.accountsMissingSnapshot, 1);
  assert.equal(response.data.accountsWithFreshSnapshot, 0);
  assert.equal(response.data.runtimeFoundation?.status, 'missing');
  assert.equal(response.data.recoveryRunSupported, false);
  assert.equal(response.data.recoveryRunScope, 'account');
  assert.match(
    String(response.data.recoveryRunReason || ''),
    /Run migration 1770707000000-HardenFundsSnapshotsRuntime/
  );
}

async function testScopedFundsRunQueuesAccountRecovery(): Promise<void> {
  const service = new FundsSchedulerService() as any;
  const createdRuns: Array<Record<string, unknown>> = [];
  const createdCommands: Array<Record<string, unknown>> = [];
  service.userTimeZoneService = {
    async resolveUserTimeZone() {
      return 'UTC';
    },
  };
  service.ensureSchedulerConfig = async () => ({
    enabled: true,
    timezone: 'UTC',
    config: {
      sources: ['funds'],
      retentionDays: 30,
    },
  });
  service.schedulerRuntimeSchemaService = {
    async assertFundsRuntimeSchemaReady() {
      return;
    },
  };
  service.brokerAccountRepository = {
    async getActiveBrokerAccounts(userId: string, brokerKey?: string) {
      assert.equal(userId, 'user-1');
      assert.equal(brokerKey, 'mudrex');
      return [
        {
          id: 'acct-1',
          brokerKey: 'mudrex',
          status: 'Connected',
          accountName: 'Primary Wallet',
        },
      ];
    },
  };
  service.schedulerRunLogRepository = {
    async createRun(payload: Record<string, unknown>) {
      createdRuns.push(payload);
      return payload;
    },
    async hasRunningRunBySchedulerKeyAndActor() {
      assert.fail('scoped recovery should not consult the generic running dedupe');
    },
  };
  service.schedulerCommandRepository = {
    async createCommand(payload: Record<string, unknown>) {
      createdCommands.push(payload);
      return {
        id: 'command-1',
        ...payload,
      };
    },
    async findLatestBySchedulerKeyAndTypeAndActorInStatuses() {
      assert.fail('scoped recovery should not consult the generic pending dedupe');
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

  const response = await service.runNow('user-1', {
    accountId: 'acct-1',
    brokerKey: 'mudrex',
  });

  assert.equal(response.data.queued, true);
  assert.equal(response.data.executionMode, 'queue');
  assert.match(String(response.data.message || ''), /Scoped funds sync queued/);
  assert.equal(createdRuns.length, 1);
  assert.equal((createdRuns[0].meta as Record<string, unknown>)?.trigger, 'scoped-manual');
  assert.deepEqual((createdRuns[0].meta as Record<string, unknown>)?.scope, {
    accountIds: ['acct-1'],
    brokerKeys: ['mudrex'],
  });
  assert.equal(createdCommands.length, 1);
  assert.equal(createdCommands[0].actorUserId, 'user-1');
  assert.equal(createdCommands[0].commandType, 'run_now');
  assert.deepEqual((createdCommands[0].payload as Record<string, unknown>)?.scope, {
    accountIds: ['acct-1'],
    brokerKeys: ['mudrex'],
  });
}

async function testFundsSignoffRequiresRecoveryDrillVerification(): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'funds-phase7-'));
  const gateFile = path.join(tempDir, 'funds-release-gate.json');
  const outputFile = path.join(tempDir, 'funds-signoff.json');

  const gateSummary = {
    decision: 'ready',
    startedAt: '2026-04-10T12:00:00.000Z',
    finishedAt: '2026-04-10T12:05:00.000Z',
    liveChecksEnabled: false,
    totals: {
      total: 6,
      passed: 6,
      failed: 0,
      skipped: 0,
    },
    results: [
      'backend-funds-scheduler-suite',
      'backend-controllers',
      'backend-operational-audit',
      'backend-funds-scheduler-eslint',
      'frontend-schedulers-funds-ui',
      'frontend-schedulers-funds-eslint',
      'backend-funds-scheduler-health',
      'backend-portfolio-health',
    ].map((key) => ({
      key,
      label: key,
      status: 'passed',
    })),
  };

  await writeFile(gateFile, `${JSON.stringify(gateSummary, null, 2)}\n`, 'utf8');

  const exitCode = await runCommand(
    process.execPath,
    ['--import', 'tsx', 'scripts/signoffs/signoff-funds-scheduler.ts'],
    {
      ...process.env,
      FUNDS_SCHEDULER_SIGNOFF_GATE_FILE: gateFile,
      FUNDS_SCHEDULER_SIGNOFF_OUTPUT_FILE: outputFile,
      FUNDS_SCHEDULER_SIGNOFF_DIAGNOSTICS_VERIFIED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_COVERAGE_VERIFIED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_PRODUCT_TRUST_VERIFIED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_HEALTH_THRESHOLDS_VERIFIED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_RECOVERY_DRILL_VERIFIED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_ACCESS_REVIEW_VERIFIED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_APPROVER: 'codex-test',
      FUNDS_SCHEDULER_SIGNOFF_REQUIRE_LIVE_HEALTH: 'false',
      FUNDS_SCHEDULER_SIGNOFF_PLACEHOLDER_EVIDENCE_ACKNOWLEDGED: 'true',
    }
  );

  assert.equal(exitCode, 0, 'funds signoff script should succeed against a ready Phase 7 gate');

  const rawOutput = await readFile(outputFile, 'utf8');
  const summary = JSON.parse(rawOutput) as {
    decision: string;
    approver: string;
    checks: Record<string, boolean>;
  };

  assert.equal(summary.decision, 'ready');
  assert.equal(summary.approver, 'codex-test');
  assert.equal(summary.checks.recoveryDrillVerified, true);
}

async function run(): Promise<void> {
  await testRuntimeSchemaServiceReportsReadyFundsFoundation();
  await testRuntimeSchemaServiceReportsMissingFundsFoundation();
  await testFundsSummaryFallsBackWhenRuntimeFoundationMissing();
  await testScopedFundsRunQueuesAccountRecovery();
  await testFundsSignoffRequiresRecoveryDrillVerification();
  console.log('Funds scheduler phase 7 assertions passed.');
}

  await run();
}

async function funds_schedulerGuard08(): Promise<void> {
  const { default: assert } = await import("node:assert/strict");
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

async function runFundsSchedulerLiveProofAssertions(): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'funds-scheduler-phase8-'));
  const gateFile = path.join(tempDir, 'funds-release-gate.json');
  const signoffFile = path.join(tempDir, 'funds-signoff.json');
  const proofFile = path.join(tempDir, 'funds-live-proof.json');
  const evidenceFile = path.join(tempDir, 'funds-deployment-evidence.json');
  const gateScript = path.join(tempDir, 'release-gate.stub.ts');
  const signoffScript = path.join(tempDir, 'signoff.stub.ts');

  const readyGateSummary = {
    decision: 'ready',
    generatedAt: '2026-04-10T12:00:00.000Z',
    liveChecksEnabled: true,
    totals: {
      total: 8,
      passed: 8,
      failed: 0,
      skipped: 0,
    },
    results: [
      'backend-funds-scheduler-suite',
      'backend-controllers',
      'backend-operational-audit',
      'backend-funds-scheduler-eslint',
      'frontend-schedulers-funds-ui',
      'frontend-schedulers-funds-eslint',
      'backend-funds-scheduler-health',
      'backend-portfolio-health',
    ].map((key) => ({
      key,
      label: key,
      status: 'passed',
    })),
  };

  const readySignoffSummary = {
    decision: 'ready',
    generatedAt: '2026-04-10T12:05:00.000Z',
    approver: 'codex-phase8',
    checks: {
      gateReady: true,
      requiredSuitesPassed: true,
      liveHealthReviewed: true,
      diagnosticsVerified: true,
      coverageVerified: true,
      productTrustVerified: true,
      healthThresholdsVerified: true,
      recoveryDrillVerified: true,
      accessReviewVerified: true,
    },
    evidence: {
      workflowUrl: 'https://example.com/staging/funds-scheduler',
      dashboardUrl: 'https://example.com/dashboard/funds-scheduler',
      runbookUrl: 'https://example.com/runbooks/funds-scheduler',
      releaseNoteUrl: 'https://example.com/releases/funds-scheduler',
    },
  };

  await writeFile(
    gateScript,
    `import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const outputFile = path.resolve(process.cwd(), String(process.env.FUNDS_SCHEDULER_RELEASE_GATE_OUTPUT_FILE || '').trim());

async function run(): Promise<void> {
  assert.equal(process.env.FUNDS_SCHEDULER_RUN_LIVE_CHECKS, 'true');
  assert.ok(outputFile, 'FUNDS_SCHEDULER_RELEASE_GATE_OUTPUT_FILE must be provided');
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

const gateFile = path.resolve(process.cwd(), String(process.env.FUNDS_SCHEDULER_SIGNOFF_GATE_FILE || '').trim());
const outputFile = path.resolve(process.cwd(), String(process.env.FUNDS_SCHEDULER_SIGNOFF_OUTPUT_FILE || '').trim());

async function run(): Promise<void> {
  assert.equal(process.env.FUNDS_SCHEDULER_SIGNOFF_REQUIRE_LIVE_HEALTH, 'true');
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
    ['--import', 'tsx', 'scripts/proofs/proof-funds-scheduler-live.ts'],
    {
      ...process.env,
      FUNDS_SCHEDULER_PROOF_RELEASE_GATE_SCRIPT: gateScript,
      FUNDS_SCHEDULER_PROOF_SIGNOFF_SCRIPT: signoffScript,
      FUNDS_SCHEDULER_RELEASE_GATE_OUTPUT_FILE: gateFile,
      FUNDS_SCHEDULER_SIGNOFF_OUTPUT_FILE: signoffFile,
      FUNDS_SCHEDULER_PROOF_OUTPUT_FILE: proofFile,
      FUNDS_SCHEDULER_EVIDENCE_OUTPUT_FILE: evidenceFile,
      FUNDS_SCHEDULER_SIGNOFF_APPROVER: 'codex-phase8',
      FUNDS_SCHEDULER_SIGNOFF_DIAGNOSTICS_VERIFIED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_COVERAGE_VERIFIED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_PRODUCT_TRUST_VERIFIED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_HEALTH_THRESHOLDS_VERIFIED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_RECOVERY_DRILL_VERIFIED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_ACCESS_REVIEW_VERIFIED: 'true',
    }
  );

  assert.equal(
    exitCode,
    0,
    'funds scheduler live proof should succeed against ready stub scripts'
  );

  const rawProof = await readFile(proofFile, 'utf8');
  const summary = JSON.parse(rawProof) as JsonRecord;

  assert.equal(summary.decision, 'ready');
  assert.equal(summary.approver, 'codex-phase8');
  assert.equal(summary.gateDecision, 'ready');
  assert.equal(summary.signoffDecision, 'ready');
  assert.equal(summary.liveChecksEnabled, true);
  assert.equal(summary.releaseGateFile, path.resolve(process.cwd(), gateFile));
  assert.equal(summary.signoffFile, path.resolve(process.cwd(), signoffFile));
  assert.equal(summary.proofOutputFile, path.resolve(process.cwd(), proofFile));
  assert.equal(summary.deploymentEvidenceOutputFile, path.resolve(process.cwd(), evidenceFile));
  assert.deepEqual(summary.gateTotals, readyGateSummary.totals);

  const evidence = (summary.evidence || {}) as JsonRecord;
  assert.equal(evidence.runbookUrl, readySignoffSummary.evidence.runbookUrl);

  const checks = (summary.checks || {}) as JsonRecord;
  assert.equal(checks.liveHealthReviewed, true);
  assert.equal(checks.recoveryDrillVerified, true);
}

async function runSourceMarkerAssertions(): Promise<void> {
  const releaseGateSource = await readFile(
    path.join(process.cwd(), 'scripts', 'release-gates', 'release-gate-funds-scheduler.ts'),
    'utf8'
  );
  const signoffSource = await readFile(
    path.join(process.cwd(), 'scripts', 'signoffs', 'signoff-funds-scheduler.ts'),
    'utf8'
  );
  const operationalAuditSource = await readFile(
    path.join(process.cwd(), 'scripts', 'test-operational-audit.ts'),
    'utf8'
  );
  const packageSource = await readFile(path.join(process.cwd(), 'package.json'), 'utf8');
  const phaseDoc = await readFile(
    path.join(process.cwd(), 'FUNDS_SCHEDULER_PHASE8.md'),
    'utf8'
  );
  const readmeSource = await readFile(path.join(process.cwd(), 'README.md'), 'utf8');

  assert.equal(
    releaseGateSource.includes('backend-funds-scheduler-suite'),
    true,
    'release gate must include the funds scheduler module suite'
  );
  assert.equal(
    signoffSource.includes('backend-funds-scheduler-suite'),
    true,
    'funds scheduler signoff must require the module gate result'
  );
  assert.equal(
    operationalAuditSource.includes('"proof:funds-scheduler-live"'),
    true,
    'operational audit must treat the funds scheduler proof workflow as required'
  );
  assert.equal(
    packageSource.includes('"proof:funds-scheduler-live"'),
    true,
    'package.json must include the Phase 8 funds scheduler proof script'
  );
  assert.equal(
    phaseDoc.includes('## 4) Carry-Forward For Phase 9'),
    true,
    'FUNDS_SCHEDULER_PHASE8.md must include the Phase 9 handoff checklist'
  );
  assert.equal(
    readmeSource.includes('proof:funds-scheduler-live'),
    true,
    'README.md must reference the funds scheduler live proof workflow'
  );
}

async function main(): Promise<void> {
  await runFundsSchedulerLiveProofAssertions();
  await runSourceMarkerAssertions();
  console.log('Funds scheduler phase 8 assertions passed.');
}

  await main();
}

async function funds_schedulerGuard10(): Promise<void> {
  const { default: assert } = await import("node:assert/strict");
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

function buildReadyGateSummary(healthSnapshot: JsonRecord): JsonRecord {
  return {
    decision: 'ready',
    startedAt: '2026-04-10T12:00:00.000Z',
    finishedAt: '2026-04-10T12:05:00.000Z',
    liveChecksEnabled: true,
    healthSnapshotFile: '/tmp/funds-scheduler-health.json',
    healthSnapshot,
    totals: {
      total: 8,
      passed: 8,
      failed: 0,
      skipped: 0,
    },
    results: [
      'backend-funds-scheduler-suite',
      'backend-controllers',
      'backend-operational-audit',
      'backend-funds-scheduler-eslint',
      'frontend-schedulers-funds-ui',
      'frontend-schedulers-funds-eslint',
      'backend-funds-scheduler-health',
      'backend-portfolio-health',
    ].map((key) => ({
      key,
      label: key,
      status: 'passed',
    })),
  };
}

function buildUnboundedHealthSnapshot(): JsonRecord {
  return {
    baseUrl: 'http://127.0.0.1:3100/api/v1',
    scheduler: {
      totalConnectedAccounts: 2,
      accountsWithFreshSnapshot: 0,
      accountsWithStaleSnapshot: 0,
      accountsMissingSnapshot: 2,
      accountsWithFailedLatestAttempt: 0,
    },
    thresholds: {
      maxStaleAccounts: null,
      maxMissingAccounts: null,
      maxFailedLatestAttempts: null,
      maxLatestSnapshotAgeMinutes: null,
      maxLatestAttemptAgeMinutes: null,
    },
    thresholdProfile: {
      mode: 'unbounded',
      configuredThresholdCount: 0,
      requiredThresholdCount: 5,
      configuredKeys: [],
      missingKeys: [
        'maxStaleAccounts',
        'maxMissingAccounts',
        'maxFailedLatestAttempts',
        'maxLatestSnapshotAgeMinutes',
        'maxLatestAttemptAgeMinutes',
      ],
    },
  };
}

async function testSignoffCapturesPlaceholderEvidenceAndThresholdPosture(): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'funds-phase10-signoff-'));
  const gateFile = path.join(tempDir, 'funds-release-gate.json');
  const outputFile = path.join(tempDir, 'funds-signoff.json');

  await writeFile(
    gateFile,
    `${JSON.stringify(buildReadyGateSummary(buildUnboundedHealthSnapshot()), null, 2)}\n`,
    'utf8'
  );

  const exitCode = await runCommand(
    process.execPath,
    ['--import', 'tsx', 'scripts/signoffs/signoff-funds-scheduler.ts'],
    {
      ...process.env,
      FUNDS_SCHEDULER_SIGNOFF_GATE_FILE: gateFile,
      FUNDS_SCHEDULER_SIGNOFF_OUTPUT_FILE: outputFile,
      FUNDS_SCHEDULER_SIGNOFF_REQUIRE_LIVE_HEALTH: 'true',
      FUNDS_SCHEDULER_SIGNOFF_DIAGNOSTICS_VERIFIED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_COVERAGE_VERIFIED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_PRODUCT_TRUST_VERIFIED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_HEALTH_THRESHOLDS_VERIFIED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_RECOVERY_DRILL_VERIFIED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_ACCESS_REVIEW_VERIFIED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_PLACEHOLDER_EVIDENCE_ACKNOWLEDGED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_UNBOUNDED_THRESHOLDS_ACKNOWLEDGED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_APPROVER: 'codex-phase10',
      FUNDS_SCHEDULER_SIGNOFF_STAGING_WORKFLOW_URL:
        'http://127.0.0.1:3100/api/v1/scheduler/funds/summary',
      FUNDS_SCHEDULER_SIGNOFF_DASHBOARD_URL:
        'http://127.0.0.1:3100/api/v1/scheduler/funds/coverage?limit=200',
      FUNDS_SCHEDULER_SIGNOFF_RUNBOOK_URL:
        '/Users/apple/Documents/Project/Backend/aurAlpha/RUNBOOK.md',
      FUNDS_SCHEDULER_SIGNOFF_RELEASE_NOTE_URL:
        '/Users/apple/Documents/Project/Backend/aurAlpha/FUNDS_SCHEDULER_PHASE10.md',
    }
  );

  assert.equal(exitCode, 0, 'signoff should succeed when placeholder posture is acknowledged');

  const raw = await readFile(outputFile, 'utf8');
  const summary = JSON.parse(raw) as {
    checks: Record<string, boolean>;
    readiness: Record<string, unknown>;
    thresholdProfile: Record<string, unknown>;
    evidenceClassification: Record<string, string>;
  };

  assert.equal(summary.checks.thresholdPostureCaptured, true);
  assert.equal(summary.checks.placeholderEvidenceAcknowledged, true);
  assert.equal(summary.checks.unboundedThresholdsAcknowledged, true);
  assert.equal(summary.readiness.deploymentEvidenceReady, false);
  assert.equal(summary.readiness.productionPromotionReady, false);
  assert.equal(summary.thresholdProfile.mode, 'unbounded');
  assert.equal(summary.evidenceClassification.stagingWorkflowUrlKind, 'localhost_url');
  assert.equal(summary.evidenceClassification.releaseNoteUrlKind, 'local_path');
}

async function testSignoffRejectsPlaceholderEvidenceWithoutAcknowledgement(): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'funds-phase10-placeholder-'));
  const gateFile = path.join(tempDir, 'funds-release-gate.json');
  const outputFile = path.join(tempDir, 'funds-signoff.json');

  await writeFile(
    gateFile,
    `${JSON.stringify(buildReadyGateSummary(buildUnboundedHealthSnapshot()), null, 2)}\n`,
    'utf8'
  );

  const exitCode = await runCommand(
    process.execPath,
    ['--import', 'tsx', 'scripts/signoffs/signoff-funds-scheduler.ts'],
    {
      ...process.env,
      FUNDS_SCHEDULER_SIGNOFF_GATE_FILE: gateFile,
      FUNDS_SCHEDULER_SIGNOFF_OUTPUT_FILE: outputFile,
      FUNDS_SCHEDULER_SIGNOFF_REQUIRE_LIVE_HEALTH: 'true',
      FUNDS_SCHEDULER_SIGNOFF_DIAGNOSTICS_VERIFIED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_COVERAGE_VERIFIED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_PRODUCT_TRUST_VERIFIED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_HEALTH_THRESHOLDS_VERIFIED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_RECOVERY_DRILL_VERIFIED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_ACCESS_REVIEW_VERIFIED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_PLACEHOLDER_EVIDENCE_ACKNOWLEDGED: '',
      FUNDS_SCHEDULER_SIGNOFF_UNBOUNDED_THRESHOLDS_ACKNOWLEDGED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_APPROVER: 'codex-phase10',
      FUNDS_SCHEDULER_SIGNOFF_STAGING_WORKFLOW_URL:
        'http://127.0.0.1:3100/api/v1/scheduler/funds/summary',
      FUNDS_SCHEDULER_SIGNOFF_DASHBOARD_URL:
        'http://127.0.0.1:3100/api/v1/scheduler/funds/coverage?limit=200',
      FUNDS_SCHEDULER_SIGNOFF_RUNBOOK_URL:
        '/Users/apple/Documents/Project/Backend/aurAlpha/RUNBOOK.md',
      FUNDS_SCHEDULER_SIGNOFF_RELEASE_NOTE_URL:
        '/Users/apple/Documents/Project/Backend/aurAlpha/FUNDS_SCHEDULER_PHASE10.md',
    }
  );

  assert.notEqual(
    exitCode,
    0,
    'signoff should fail when localhost placeholder evidence is not acknowledged'
  );
}

async function testProofWritesDeploymentEvidencePackage(): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'funds-phase10-proof-'));
  const gateFile = path.join(tempDir, 'funds-release-gate.json');
  const signoffFile = path.join(tempDir, 'funds-signoff.json');
  const proofFile = path.join(tempDir, 'funds-live-proof.json');
  const evidenceFile = path.join(tempDir, 'funds-deployment-evidence.json');
  const gateScript = path.join(tempDir, 'release-gate.stub.ts');
  const signoffScript = path.join(tempDir, 'signoff.stub.ts');

  const readyGateSummary = buildReadyGateSummary({
    baseUrl: 'https://staging.example.com/api/v1',
    scheduler: {
      totalConnectedAccounts: 3,
      accountsWithFreshSnapshot: 3,
      accountsWithStaleSnapshot: 0,
      accountsMissingSnapshot: 0,
      accountsWithFailedLatestAttempt: 0,
    },
    thresholds: {
      maxStaleAccounts: 0,
      maxMissingAccounts: 0,
      maxFailedLatestAttempts: 0,
      maxLatestSnapshotAgeMinutes: 90,
      maxLatestAttemptAgeMinutes: 90,
    },
    thresholdProfile: {
      mode: 'bounded',
      configuredThresholdCount: 5,
      requiredThresholdCount: 5,
      configuredKeys: [
        'maxStaleAccounts',
        'maxMissingAccounts',
        'maxFailedLatestAttempts',
        'maxLatestSnapshotAgeMinutes',
        'maxLatestAttemptAgeMinutes',
      ],
      missingKeys: [],
    },
  });

  const readySignoffSummary = {
    decision: 'ready',
    generatedAt: '2026-04-10T12:05:00.000Z',
    approver: 'codex-phase10',
    checks: {
      gateReady: true,
      requiredSuitesPassed: true,
      liveHealthReviewed: true,
      thresholdPostureCaptured: true,
      placeholderEvidenceAcknowledged: true,
      unboundedThresholdsAcknowledged: true,
      diagnosticsVerified: true,
      coverageVerified: true,
      productTrustVerified: true,
      healthThresholdsVerified: true,
      recoveryDrillVerified: true,
      accessReviewVerified: true,
    },
    readiness: {
      deploymentEvidenceReady: true,
      thresholdProfileMode: 'bounded',
      productionPromotionReady: true,
    },
    thresholdProfile: {
      mode: 'bounded',
      configuredThresholdCount: 5,
      requiredThresholdCount: 5,
      configuredKeys: ['maxStaleAccounts'],
      missingKeys: [],
    },
    evidence: {
      stagingWorkflowUrl: 'https://example.com/staging/funds-sync',
      dashboardUrl: 'https://example.com/dashboards/funds-sync',
      runbookUrl: 'https://example.com/runbooks/funds-sync',
      releaseNoteUrl: 'https://example.com/releases/funds-sync',
    },
    evidenceClassification: {
      stagingWorkflowUrlKind: 'remote_url',
      dashboardUrlKind: 'remote_url',
      runbookUrlKind: 'remote_url',
      releaseNoteUrlKind: 'remote_url',
    },
  };

  await writeFile(
    gateScript,
    `import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const outputFile = path.resolve(process.cwd(), String(process.env.FUNDS_SCHEDULER_RELEASE_GATE_OUTPUT_FILE || '').trim());

async function run(): Promise<void> {
  assert.equal(process.env.FUNDS_SCHEDULER_RUN_LIVE_CHECKS, 'true');
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
    `import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const outputFile = path.resolve(process.cwd(), String(process.env.FUNDS_SCHEDULER_SIGNOFF_OUTPUT_FILE || '').trim());

async function run(): Promise<void> {
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
    ['--import', 'tsx', 'scripts/proofs/proof-funds-scheduler-live.ts'],
    {
      ...process.env,
      FUNDS_SCHEDULER_PROOF_RELEASE_GATE_SCRIPT: gateScript,
      FUNDS_SCHEDULER_PROOF_SIGNOFF_SCRIPT: signoffScript,
      FUNDS_SCHEDULER_RELEASE_GATE_OUTPUT_FILE: gateFile,
      FUNDS_SCHEDULER_SIGNOFF_OUTPUT_FILE: signoffFile,
      FUNDS_SCHEDULER_PROOF_OUTPUT_FILE: proofFile,
      FUNDS_SCHEDULER_EVIDENCE_OUTPUT_FILE: evidenceFile,
      FUNDS_SCHEDULER_SIGNOFF_APPROVER: 'codex-phase10',
      FUNDS_SCHEDULER_SIGNOFF_DIAGNOSTICS_VERIFIED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_COVERAGE_VERIFIED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_PRODUCT_TRUST_VERIFIED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_HEALTH_THRESHOLDS_VERIFIED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_RECOVERY_DRILL_VERIFIED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_ACCESS_REVIEW_VERIFIED: 'true',
    }
  );

  assert.equal(exitCode, 0, 'proof should succeed against ready Phase 10 stub scripts');

  const rawProof = await readFile(proofFile, 'utf8');
  const proofSummary = JSON.parse(rawProof) as JsonRecord;
  assert.equal(proofSummary.deploymentEvidenceOutputFile, path.resolve(process.cwd(), evidenceFile));

  const rawEvidence = await readFile(evidenceFile, 'utf8');
  const evidencePackage = JSON.parse(rawEvidence) as JsonRecord;
  assert.equal(evidencePackage.deploymentPromotionReady, true);
  assert.equal(evidencePackage.deploymentEvidenceReady, true);
  assert.equal(evidencePackage.thresholdProfileMode, 'bounded');
  assert.equal(evidencePackage.proofFile, path.resolve(process.cwd(), proofFile));
}

async function runSourceMarkerAssertions(): Promise<void> {
  const checkHealthSource = await readFile(
    path.join(process.cwd(), 'scripts', 'checks', 'check-funds-scheduler-health.ts'),
    'utf8'
  );
  const releaseGateSource = await readFile(
    path.join(process.cwd(), 'scripts', 'release-gates', 'release-gate-funds-scheduler.ts'),
    'utf8'
  );
  const signoffSource = await readFile(
    path.join(process.cwd(), 'scripts', 'signoffs', 'signoff-funds-scheduler.ts'),
    'utf8'
  );
  const proofSource = await readFile(
    path.join(process.cwd(), 'scripts', 'proofs', 'proof-funds-scheduler-live.ts'),
    'utf8'
  );
  const packageSource = await readFile(path.join(process.cwd(), 'package.json'), 'utf8');

  assert.equal(
    checkHealthSource.includes('FUNDS_SCHEDULER_HEALTH_OUTPUT_FILE'),
    true,
    'health check must support a persisted Phase 10 output snapshot'
  );
  assert.equal(
    checkHealthSource.includes('thresholdProfile'),
    true,
    'health check must include thresholdProfile in the Phase 10 snapshot'
  );
  assert.equal(
    releaseGateSource.includes('backend-funds-scheduler-suite'),
    true,
    'release gate must include the funds scheduler module suite'
  );
  assert.equal(
    signoffSource.includes('backend-funds-scheduler-suite'),
    true,
    'signoff must require the funds scheduler module gate result'
  );
  assert.equal(
    proofSource.includes('funds-scheduler-deployment-evidence.json'),
    true,
    'proof must write the Phase 10 deployment evidence package'
  );
  assert.equal(
    packageSource.includes('"test:funds-scheduler"'),
    true,
    'package.json must include the funds scheduler module script'
  );
}

async function main(): Promise<void> {
  await testSignoffCapturesPlaceholderEvidenceAndThresholdPosture();
  await testSignoffRejectsPlaceholderEvidenceWithoutAcknowledgement();
  await testProofWritesDeploymentEvidencePackage();
  await runSourceMarkerAssertions();
  console.log('Funds scheduler phase 10 assertions passed.');
}

  await main();
}

async function funds_schedulerGuard11(): Promise<void> {
  const { default: assert } = await import("node:assert/strict");
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

function buildReadyGateSummary(healthSnapshot: JsonRecord): JsonRecord {
  return {
    decision: 'ready',
    startedAt: '2026-04-10T12:00:00.000Z',
    finishedAt: '2026-04-10T12:05:00.000Z',
    liveChecksEnabled: true,
    healthSnapshotFile: '/tmp/funds-scheduler-health.json',
    healthSnapshot,
    totals: {
      total: 8,
      passed: 8,
      failed: 0,
      skipped: 0,
    },
    results: [
      'backend-funds-scheduler-suite',
      'backend-controllers',
      'backend-operational-audit',
      'backend-funds-scheduler-eslint',
      'frontend-schedulers-funds-ui',
      'frontend-schedulers-funds-eslint',
      'backend-funds-scheduler-health',
      'backend-portfolio-health',
    ].map((key) => ({
      key,
      label: key,
      status: 'passed',
    })),
  };
}

function buildBoundedHealthSnapshot(baseUrl: string): JsonRecord {
  return {
    baseUrl,
    scheduler: {
      totalConnectedAccounts: 3,
      accountsWithFreshSnapshot: 3,
      accountsWithStaleSnapshot: 0,
      accountsMissingSnapshot: 0,
      accountsWithFailedLatestAttempt: 0,
    },
    thresholds: {
      maxStaleAccounts: 0,
      maxMissingAccounts: 0,
      maxFailedLatestAttempts: 0,
      maxLatestSnapshotAgeMinutes: 90,
      maxLatestAttemptAgeMinutes: 90,
    },
    thresholdProfile: {
      mode: 'bounded',
      configuredThresholdCount: 5,
      requiredThresholdCount: 5,
      configuredKeys: [
        'maxStaleAccounts',
        'maxMissingAccounts',
        'maxFailedLatestAttempts',
        'maxLatestSnapshotAgeMinutes',
        'maxLatestAttemptAgeMinutes',
      ],
      missingKeys: [],
    },
  };
}

function buildSignoffEnv(
  gateFile: string,
  outputFile: string,
  extraEnv: Record<string, string> = {}
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    FUNDS_SCHEDULER_SIGNOFF_GATE_FILE: gateFile,
    FUNDS_SCHEDULER_SIGNOFF_OUTPUT_FILE: outputFile,
    FUNDS_SCHEDULER_SIGNOFF_REQUIRE_LIVE_HEALTH: 'true',
    FUNDS_SCHEDULER_SIGNOFF_REQUIRE_DEPLOYMENT_EVIDENCE: 'true',
    FUNDS_SCHEDULER_SIGNOFF_DIAGNOSTICS_VERIFIED: 'true',
    FUNDS_SCHEDULER_SIGNOFF_COVERAGE_VERIFIED: 'true',
    FUNDS_SCHEDULER_SIGNOFF_PRODUCT_TRUST_VERIFIED: 'true',
    FUNDS_SCHEDULER_SIGNOFF_HEALTH_THRESHOLDS_VERIFIED: 'true',
    FUNDS_SCHEDULER_SIGNOFF_RECOVERY_DRILL_VERIFIED: 'true',
    FUNDS_SCHEDULER_SIGNOFF_ACCESS_REVIEW_VERIFIED: 'true',
    FUNDS_SCHEDULER_SIGNOFF_APPROVER: 'codex-phase11',
    FUNDS_SCHEDULER_SIGNOFF_STAGING_WORKFLOW_URL:
      'https://staging.example.com/workflows/funds-sync',
    FUNDS_SCHEDULER_SIGNOFF_DASHBOARD_URL:
      'https://staging.example.com/dashboards/funds-sync',
    FUNDS_SCHEDULER_SIGNOFF_RUNBOOK_URL:
      'https://staging.example.com/runbooks/funds-sync',
    FUNDS_SCHEDULER_SIGNOFF_RELEASE_NOTE_URL:
      'https://staging.example.com/releases/funds-sync',
    FUNDS_SCHEDULER_SIGNOFF_PLACEHOLDER_EVIDENCE_ACKNOWLEDGED: '',
    FUNDS_SCHEDULER_SIGNOFF_UNBOUNDED_THRESHOLDS_ACKNOWLEDGED: '',
    ...extraEnv,
  };
}

async function testSignoffCapturesTargetEnvironmentReadiness(): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'funds-phase11-signoff-'));
  const gateFile = path.join(tempDir, 'funds-release-gate.json');
  const outputFile = path.join(tempDir, 'funds-signoff.json');

  await writeFile(
    gateFile,
    `${JSON.stringify(
      buildReadyGateSummary(buildBoundedHealthSnapshot('http://127.0.0.1:3100/api/v1')),
      null,
      2
    )}\n`,
    'utf8'
  );

  const exitCode = await runCommand(
    process.execPath,
    ['--import', 'tsx', 'scripts/signoffs/signoff-funds-scheduler.ts'],
    buildSignoffEnv(gateFile, outputFile)
  );

  assert.equal(
    exitCode,
    0,
    'signoff should stay ready when evidence is remote but the health base URL is still localhost'
  );

  const raw = await readFile(outputFile, 'utf8');
  const summary = JSON.parse(raw) as {
    decision: string;
    checks: Record<string, boolean>;
    readiness: Record<string, unknown>;
    acknowledgements: Record<string, boolean>;
    environment: Record<string, unknown>;
  };

  assert.equal(summary.decision, 'ready');
  assert.equal(summary.checks.placeholderEvidenceAcknowledged, true);
  assert.equal(summary.acknowledgements.placeholderEvidenceUsed, false);
  assert.equal(summary.acknowledgements.unboundedThresholdsUsed, false);
  assert.equal(summary.readiness.deploymentEvidenceReady, true);
  assert.equal(summary.readiness.targetEnvironmentReady, false);
  assert.equal(summary.readiness.healthBaseUrlKind, 'localhost_url');
  assert.equal(summary.readiness.productionPromotionReady, false);
  assert.equal(summary.environment.healthBaseUrl, 'http://127.0.0.1:3100/api/v1');
  assert.equal(summary.environment.healthBaseUrlKind, 'localhost_url');
  assert.equal(summary.environment.targetEnvironmentReady, false);
}

async function testSignoffPersistsBlockedSummaryWhenPromotionReadyIsRequired(): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'funds-phase11-signoff-blocked-'));
  const gateFile = path.join(tempDir, 'funds-release-gate.json');
  const outputFile = path.join(tempDir, 'funds-signoff.json');

  await writeFile(
    gateFile,
    `${JSON.stringify(
      buildReadyGateSummary(buildBoundedHealthSnapshot('http://127.0.0.1:3100/api/v1')),
      null,
      2
    )}\n`,
    'utf8'
  );

  const exitCode = await runCommand(
    process.execPath,
    ['--import', 'tsx', 'scripts/signoffs/signoff-funds-scheduler.ts'],
    buildSignoffEnv(gateFile, outputFile, {
      FUNDS_SCHEDULER_SIGNOFF_REQUIRE_PROMOTION_READY: 'true',
    })
  );

  assert.notEqual(
    exitCode,
    0,
    'signoff should block when strict promotion readiness is required but live health still points at localhost'
  );

  const raw = await readFile(outputFile, 'utf8');
  const summary = JSON.parse(raw) as {
    decision: string;
    readiness: Record<string, unknown>;
    environment: Record<string, unknown>;
  };

  assert.equal(summary.decision, 'blocked');
  assert.equal(summary.readiness.productionPromotionReady, false);
  assert.equal(summary.environment.healthBaseUrlKind, 'localhost_url');
  assert.equal(summary.environment.targetEnvironmentReady, false);
}

async function testPromotionProofWritesBlockedArtifactForLocalhostEvidence(): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'funds-phase11-proof-blocked-'));
  const gateFile = path.join(tempDir, 'funds-release-gate.json');
  const signoffFile = path.join(tempDir, 'funds-signoff.json');
  const promotionFile = path.join(tempDir, 'funds-promotion-proof.json');
  const gateScript = path.join(tempDir, 'release-gate.stub.ts');

  await writeFile(
    gateScript,
    `import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const outputFile = path.resolve(process.cwd(), String(process.env.FUNDS_SCHEDULER_RELEASE_GATE_OUTPUT_FILE || '').trim());

async function run(): Promise<void> {
  assert.equal(process.env.FUNDS_SCHEDULER_RUN_LIVE_CHECKS, 'true');
  await mkdir(path.dirname(outputFile), { recursive: true });
  const summary = ${JSON.stringify(
    buildReadyGateSummary(buildBoundedHealthSnapshot('http://127.0.0.1:3100/api/v1')),
    null,
    2
  )};
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
    ['--import', 'tsx', 'scripts/proofs/proof-funds-scheduler-promotion.ts'],
    {
      ...process.env,
      FUNDS_SCHEDULER_PROMOTION_RELEASE_GATE_SCRIPT: gateScript,
      FUNDS_SCHEDULER_RELEASE_GATE_OUTPUT_FILE: gateFile,
      FUNDS_SCHEDULER_SIGNOFF_OUTPUT_FILE: signoffFile,
      FUNDS_SCHEDULER_PROMOTION_OUTPUT_FILE: promotionFile,
      FUNDS_SCHEDULER_SIGNOFF_APPROVER: 'codex-phase11',
      FUNDS_SCHEDULER_SIGNOFF_DIAGNOSTICS_VERIFIED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_COVERAGE_VERIFIED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_PRODUCT_TRUST_VERIFIED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_HEALTH_THRESHOLDS_VERIFIED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_RECOVERY_DRILL_VERIFIED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_ACCESS_REVIEW_VERIFIED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_STAGING_WORKFLOW_URL:
        'https://staging.example.com/workflows/funds-sync',
      FUNDS_SCHEDULER_SIGNOFF_DASHBOARD_URL:
        'https://staging.example.com/dashboards/funds-sync',
      FUNDS_SCHEDULER_SIGNOFF_RELEASE_NOTE_URL:
        'https://staging.example.com/releases/funds-sync',
      FUNDS_SCHEDULER_SIGNOFF_PLACEHOLDER_EVIDENCE_ACKNOWLEDGED: '',
      FUNDS_SCHEDULER_SIGNOFF_UNBOUNDED_THRESHOLDS_ACKNOWLEDGED: '',
    }
  );

  assert.notEqual(
    exitCode,
    0,
    'promotion proof should block while funds health still points at localhost'
  );

  const raw = await readFile(promotionFile, 'utf8');
  const summary = JSON.parse(raw) as {
    decision: string;
    gateDecision: string | null;
    signoffDecision: string | null;
    readiness: Record<string, unknown>;
    environment: Record<string, unknown>;
  };

  assert.equal(summary.decision, 'blocked');
  assert.equal(summary.gateDecision, 'ready');
  assert.equal(summary.signoffDecision, 'blocked');
  assert.equal(summary.readiness.productionPromotionReady, false);
  assert.equal(summary.environment.healthBaseUrlKind, 'localhost_url');
  assert.equal(summary.environment.targetEnvironmentReady, false);
}

async function testPromotionProofSucceedsWhenTargetEnvironmentIsReady(): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'funds-phase11-proof-ready-'));
  const gateFile = path.join(tempDir, 'funds-release-gate.json');
  const signoffFile = path.join(tempDir, 'funds-signoff.json');
  const promotionFile = path.join(tempDir, 'funds-promotion-proof.json');
  const gateScript = path.join(tempDir, 'release-gate.stub.ts');
  const signoffScript = path.join(tempDir, 'signoff.stub.ts');

  const readyGateSummary = buildReadyGateSummary(
    buildBoundedHealthSnapshot('https://staging.example.com/api/v1')
  );
  const readySignoffSummary = {
    decision: 'ready',
    generatedAt: '2026-04-10T12:06:00.000Z',
    approver: 'codex-phase11',
    checks: {
      gateReady: true,
      requiredSuitesPassed: true,
      liveHealthReviewed: true,
      thresholdPostureCaptured: true,
      placeholderEvidenceAcknowledged: true,
      unboundedThresholdsAcknowledged: true,
      diagnosticsVerified: true,
      coverageVerified: true,
      productTrustVerified: true,
      healthThresholdsVerified: true,
      recoveryDrillVerified: true,
      accessReviewVerified: true,
    },
    readiness: {
      deploymentEvidenceReady: true,
      thresholdProfileMode: 'bounded',
      targetEnvironmentReady: true,
      healthBaseUrlKind: 'remote_url',
      productionPromotionReady: true,
    },
    acknowledgements: {
      placeholderEvidenceUsed: false,
      unboundedThresholdsUsed: false,
    },
    thresholdProfile: {
      mode: 'bounded',
      configuredThresholdCount: 5,
      requiredThresholdCount: 5,
      configuredKeys: [
        'maxStaleAccounts',
        'maxMissingAccounts',
        'maxFailedLatestAttempts',
        'maxLatestSnapshotAgeMinutes',
        'maxLatestAttemptAgeMinutes',
      ],
      missingKeys: [],
    },
    evidence: {
      stagingWorkflowUrl: 'https://staging.example.com/workflows/funds-sync',
      workflowUrl: 'https://staging.example.com/workflows/funds-sync',
      dashboardUrl: 'https://staging.example.com/dashboards/funds-sync',
      runbookUrl: 'https://staging.example.com/runbooks/funds-sync',
      releaseNoteUrl: 'https://staging.example.com/releases/funds-sync',
    },
    evidenceClassification: {
      stagingWorkflowUrlKind: 'remote_url',
      dashboardUrlKind: 'remote_url',
      runbookUrlKind: 'remote_url',
      releaseNoteUrlKind: 'remote_url',
    },
    environment: {
      healthBaseUrl: 'https://staging.example.com/api/v1',
      healthBaseUrlKind: 'remote_url',
      targetEnvironmentReady: true,
    },
  };

  await writeFile(
    gateScript,
    `import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const outputFile = path.resolve(process.cwd(), String(process.env.FUNDS_SCHEDULER_RELEASE_GATE_OUTPUT_FILE || '').trim());

async function run(): Promise<void> {
  assert.equal(process.env.FUNDS_SCHEDULER_RUN_LIVE_CHECKS, 'true');
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
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const outputFile = path.resolve(process.cwd(), String(process.env.FUNDS_SCHEDULER_SIGNOFF_OUTPUT_FILE || '').trim());

async function run(): Promise<void> {
  assert.equal(process.env.FUNDS_SCHEDULER_SIGNOFF_REQUIRE_LIVE_HEALTH, 'true');
  assert.equal(process.env.FUNDS_SCHEDULER_SIGNOFF_REQUIRE_DEPLOYMENT_EVIDENCE, 'true');
  assert.equal(process.env.FUNDS_SCHEDULER_SIGNOFF_REQUIRE_PROMOTION_READY, 'true');
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
    ['--import', 'tsx', 'scripts/proofs/proof-funds-scheduler-promotion.ts'],
    {
      ...process.env,
      FUNDS_SCHEDULER_PROMOTION_RELEASE_GATE_SCRIPT: gateScript,
      FUNDS_SCHEDULER_PROMOTION_SIGNOFF_SCRIPT: signoffScript,
      FUNDS_SCHEDULER_RELEASE_GATE_OUTPUT_FILE: gateFile,
      FUNDS_SCHEDULER_SIGNOFF_OUTPUT_FILE: signoffFile,
      FUNDS_SCHEDULER_PROMOTION_OUTPUT_FILE: promotionFile,
      FUNDS_SCHEDULER_SIGNOFF_APPROVER: 'codex-phase11',
      FUNDS_SCHEDULER_SIGNOFF_DIAGNOSTICS_VERIFIED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_COVERAGE_VERIFIED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_PRODUCT_TRUST_VERIFIED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_HEALTH_THRESHOLDS_VERIFIED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_RECOVERY_DRILL_VERIFIED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_ACCESS_REVIEW_VERIFIED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_STAGING_WORKFLOW_URL:
        'https://staging.example.com/workflows/funds-sync',
      FUNDS_SCHEDULER_SIGNOFF_DASHBOARD_URL:
        'https://staging.example.com/dashboards/funds-sync',
      FUNDS_SCHEDULER_SIGNOFF_RELEASE_NOTE_URL:
        'https://staging.example.com/releases/funds-sync',
      FUNDS_SCHEDULER_SIGNOFF_PLACEHOLDER_EVIDENCE_ACKNOWLEDGED: '',
      FUNDS_SCHEDULER_SIGNOFF_UNBOUNDED_THRESHOLDS_ACKNOWLEDGED: '',
    }
  );

  assert.equal(exitCode, 0, 'promotion proof should succeed against a target-ready stub');

  const raw = await readFile(promotionFile, 'utf8');
  const summary = JSON.parse(raw) as {
    decision: string;
    gateDecision: string | null;
    signoffDecision: string | null;
    acknowledgements: Record<string, boolean>;
    readiness: Record<string, unknown>;
    environment: Record<string, unknown>;
  };

  assert.equal(summary.decision, 'ready');
  assert.equal(summary.gateDecision, 'ready');
  assert.equal(summary.signoffDecision, 'ready');
  assert.equal(summary.acknowledgements.placeholderEvidenceUsed, false);
  assert.equal(summary.acknowledgements.unboundedThresholdsUsed, false);
  assert.equal(summary.readiness.productionPromotionReady, true);
  assert.equal(summary.environment.healthBaseUrlKind, 'remote_url');
  assert.equal(summary.environment.targetEnvironmentReady, true);
}

async function runSourceMarkerAssertions(): Promise<void> {
  const releaseGateSource = await readFile(
    path.join(process.cwd(), 'scripts', 'release-gates', 'release-gate-funds-scheduler.ts'),
    'utf8'
  );
  const signoffSource = await readFile(
    path.join(process.cwd(), 'scripts', 'signoffs', 'signoff-funds-scheduler.ts'),
    'utf8'
  );
  const proofSource = await readFile(
    path.join(process.cwd(), 'scripts', 'proofs', 'proof-funds-scheduler-promotion.ts'),
    'utf8'
  );
  const operationalAuditSource = await readFile(
    path.join(process.cwd(), 'scripts', 'test-operational-audit.ts'),
    'utf8'
  );
  const packageSource = await readFile(path.join(process.cwd(), 'package.json'), 'utf8');
  const docSource = await readFile(path.join(process.cwd(), 'FUNDS_SCHEDULER_PHASE11.md'), 'utf8');

  assert.equal(
    releaseGateSource.includes('backend-funds-scheduler-suite'),
    true,
    'release gate must include the funds scheduler module suite'
  );
  assert.equal(
    signoffSource.includes('FUNDS_SCHEDULER_SIGNOFF_REQUIRE_PROMOTION_READY'),
    true,
    'signoff must support a strict promotion-ready requirement'
  );
  assert.equal(
    proofSource.includes('funds-scheduler-promotion-proof.json'),
    true,
    'promotion proof must write the Phase 11 promotion artifact'
  );
  assert.equal(
    operationalAuditSource.includes('"proof:funds-scheduler-promotion"'),
    true,
    'operational audit must require the Phase 11 promotion proof workflow'
  );
  assert.equal(
    packageSource.includes('"test:funds-scheduler"'),
    true,
    'package.json must include the funds scheduler module suite'
  );
  assert.equal(
    packageSource.includes('"proof:funds-scheduler-promotion"'),
    true,
    'package.json must include the Phase 11 promotion proof script'
  );
  assert.equal(
    docSource.includes('proof:funds-scheduler-promotion'),
    true,
    'Phase 11 handoff doc must describe the strict promotion proof command'
  );
  assert.equal(
    docSource.includes('localhost'),
    true,
    'Phase 11 handoff doc must describe why localhost proofs do not count as promotion-ready evidence'
  );
}

async function main(): Promise<void> {
  await testSignoffCapturesTargetEnvironmentReadiness();
  await testSignoffPersistsBlockedSummaryWhenPromotionReadyIsRequired();
  await testPromotionProofWritesBlockedArtifactForLocalhostEvidence();
  await testPromotionProofSucceedsWhenTargetEnvironmentIsReady();
  await runSourceMarkerAssertions();
  console.log('Funds scheduler phase 11 assertions passed.');
}

  await main();
}

async function funds_schedulerGuard12(): Promise<void> {
  const { default: assert } = await import("node:assert/strict");
  const { spawn } = await import("node:child_process");
  const { mkdtemp, readFile, writeFile } = await import("node:fs/promises");
  const { default: os } = await import("node:os");
  const { default: path } = await import("node:path");
  const { FundsSchedulerService } = await import("../src/api/services/FundsSchedulerService");

const THRESHOLD_KEYS = [
  'maxStaleAccounts',
  'maxMissingAccounts',
  'maxFailedLatestAttempts',
  'maxLatestSnapshotAgeMinutes',
  'maxLatestAttemptAgeMinutes',
] as const;

function buildBoundedThresholds(overrides: Partial<Record<(typeof THRESHOLD_KEYS)[number], number>> = {}) {
  return {
    maxStaleAccounts: 0,
    maxMissingAccounts: 2,
    maxFailedLatestAttempts: 0,
    maxLatestSnapshotAgeMinutes: 180,
    maxLatestAttemptAgeMinutes: 180,
    ...overrides,
  };
}

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

async function testFundsThresholdsPersistAndSurfaceInSummary(): Promise<void> {
  const service = new FundsSchedulerService() as any;
  const boundedThresholds = buildBoundedThresholds();
  const clearedThresholds = Object.fromEntries(
    THRESHOLD_KEYS.map((key) => [key, null])
  ) as Record<(typeof THRESHOLD_KEYS)[number], null>;
  const storedAnchorConfig = {
    id: 'anchor-1',
    key: 'funds-sync',
    name: 'Funds Snapshot Sync',
    description: 'Captures wallet and futures funds for connected broker accounts.',
    enabled: true,
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
  const updateCalls: Array<Record<string, unknown>> = [];

  service.userTimeZoneService = {
    async resolveUserTimeZone() {
      return 'UTC';
    },
  };
  service.schedulerConfigRepository = {
    async createIfMissing() {
      return storedAnchorConfig;
    },
    async updateByKey(_key: string, payload: Record<string, unknown>) {
      Object.assign(storedAnchorConfig, payload);
      return { ...storedAnchorConfig };
    },
  };
  service.schedulerUserConfigRepository = {
    async createIfMissing(payload: Record<string, unknown>) {
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
      updateCalls.push({ schedulerKey, userId, payload });
      storedUserConfig = {
        ...(storedUserConfig || {}),
        ...payload,
      };
      return { ...storedUserConfig };
    },
  };
  service.schedulerRunLogRepository = {
    async listRunsBySchedulerKeyAndActor() {
      return { items: [], total: 0 };
    },
  };
  service.schedulerRuntimeSchemaService = {
    async inspectFundsRuntimeSchema() {
      return {
        status: 'ready',
        migrationName: '1770707000000-HardenFundsSnapshotsRuntime',
        requiredTables: ['funds_snapshots'],
        requiredColumns: ['funds_snapshots.snapshot_date'],
      };
    },
  };
  service.fundsSnapshotRepository = {
    async listLatestAccountCoverage() {
      return [
        {
          user_id: 'user-1',
          broker_key: 'mudrex',
          account_id: 'acct-1',
          account_name: 'Primary Wallet',
          account_key: 'primary-wallet',
          account_status: 'Connected',
          latest_snapshot_id: 'snap-1',
          latest_snapshot_date: '2026-04-11',
          latest_observed_at: new Date('2026-04-10T10:00:00.000Z'),
          latest_last_attempt_at: new Date('2026-04-10T10:05:00.000Z'),
          latest_fetch_status: 'success',
          latest_error_message: null,
          latest_source: 'broker_runtime',
          latest_computed_at: new Date('2026-04-10T10:05:00.000Z'),
          latest_wallet_available: true,
          latest_futures_available: true,
          latest_success_snapshot_id: 'snap-1',
          latest_success_snapshot_date: '2026-04-11',
          latest_success_observed_at: new Date('2026-04-10T10:00:00.000Z'),
          latest_success_computed_at: new Date('2026-04-10T10:00:00.000Z'),
          latest_success_source: 'broker_runtime',
          latest_success_wallet_available: true,
          latest_success_futures_available: true,
        },
      ];
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

  const updateResponse = await service.updateSchedulerConfig('user-1', {
    fundsHealthThresholds: boundedThresholds,
  });

  assert.deepEqual(updateResponse.data.fundsHealthThresholds, boundedThresholds);
  assert.deepEqual(
    ((updateCalls.at(-1)?.payload as Record<string, unknown>).config as Record<string, unknown>)
      .fundsHealthThresholds,
    boundedThresholds
  );

  const summaryResponse = await service.getSchedulerDiagnosticsSummary('user-1');
  assert.deepEqual(summaryResponse.data.fundsHealthThresholds, boundedThresholds);
  assert.deepEqual(summaryResponse.data.fundsHealthThresholdProfile, {
    mode: 'bounded',
    configuredThresholdCount: 5,
    requiredThresholdCount: 5,
    configuredKeys: [...THRESHOLD_KEYS],
    missingKeys: [],
  });

  const clearResponse = await service.updateSchedulerConfig('user-1', {
    fundsHealthThresholds: null,
  });
  assert.deepEqual(clearResponse.data.fundsHealthThresholds, clearedThresholds);

  const clearedSummary = await service.getSchedulerDiagnosticsSummary('user-1');
  assert.deepEqual(clearedSummary.data.fundsHealthThresholds, clearedThresholds);
  assert.deepEqual(clearedSummary.data.fundsHealthThresholdProfile, {
    mode: 'unbounded',
    configuredThresholdCount: 0,
    requiredThresholdCount: 5,
    configuredKeys: [],
    missingKeys: [...THRESHOLD_KEYS],
  });
}

async function withHealthFetchBootstrap(
  handler: (baseUrl: string, bootstrapFile: string) => Promise<void>
): Promise<void> {
  const thresholds = buildBoundedThresholds({
    maxMissingAccounts: 1,
    maxLatestSnapshotAgeMinutes: 90,
    maxLatestAttemptAgeMinutes: 90,
  });
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'funds-phase12-bootstrap-'));
  const bootstrapFile = path.join(tempDir, 'bootstrap.mjs');
  const baseUrl = 'https://phase12-health.local/api/v1';
  const checkScriptPath = path.join(process.cwd(), 'scripts', 'checks', 'check-funds-scheduler-health.ts');
  const stubPayloads = {
    login: {
      success: true,
      data: {
        accessToken: 'token-1',
      },
    },
    me: {
      success: true,
      data: {
        role: 'admin',
      },
    },
    config: {
      success: true,
      data: {
        key: 'funds-sync',
        schedulerType: 'user',
        sources: ['funds'],
        fundsHealthThresholds: thresholds,
      },
    },
    summary: {
      success: true,
      data: {
        schedulerKey: 'funds-sync',
        timezone: 'UTC',
        localDate: '2026-04-11',
        totalConnectedAccounts: 1,
        accountsWithFreshSnapshot: 1,
        accountsWithStaleSnapshot: 0,
        accountsMissingSnapshot: 0,
        accountsWithFailedLatestAttempt: 0,
        accountsWithSuccessfulLatestAttempt: 1,
        latestObservedSnapshotAt: '2026-04-10T10:00:00.000Z',
        latestObservedSnapshotAgeMinutes: 15,
        latestAttemptAt: '2026-04-10T10:05:00.000Z',
        latestAttemptAgeMinutes: 10,
        lastSuccessfulRun: null,
        fundsHealthThresholds: thresholds,
        fundsHealthThresholdProfile: {
          mode: 'bounded',
          configuredThresholdCount: 5,
          requiredThresholdCount: 5,
          configuredKeys: [...THRESHOLD_KEYS],
          missingKeys: [],
        },
        runtimeFoundation: {
          status: 'ready',
          migrationName: '1770707000000-HardenFundsSnapshotsRuntime',
          requiredTables: ['funds_snapshots'],
          requiredColumns: ['funds_snapshots.snapshot_date'],
        },
        recoveryRunSupported: true,
        recoveryRunScope: 'account',
        runUpdatesSupported: false,
        runUpdatesSupportState: 'not_emitted',
        runUpdatesReason:
          'Funds snapshot sync does not emit per-record update logs. Use /scheduler/funds/summary and /scheduler/funds/coverage instead.',
      },
    },
    coverage: {
      success: true,
      data: {
        items: [
          {
            accountId: 'acct-1',
            brokerKey: 'mudrex',
            freshnessState: 'fresh',
            latestFetchStatus: 'success',
            latestObservedAt: '2026-04-10T10:00:00.000Z',
            latestAttemptAt: '2026-04-10T10:05:00.000Z',
            walletSnapshotAvailable: true,
            futuresSnapshotAvailable: true,
            needsAttention: false,
          },
        ],
        total: 1,
        limit: 200,
        offset: 0,
        timezone: 'UTC',
        localDate: '2026-04-11',
      },
    },
    runs: {
      success: true,
      data: {
        items: [],
        total: 0,
        limit: 5,
        offset: 0,
      },
    },
    worker: {
      success: true,
      data: {
        status: 'ok',
      },
    },
  };

  await writeFile(
    bootstrapFile,
    `const payloads = ${JSON.stringify(stubPayloads, null, 2)};
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  const pathname = url.pathname;
  let payload = null;
  if (pathname === '/api/v1/auth/login') payload = payloads.login;
  if (pathname === '/api/v1/auth/me') payload = payloads.me;
  if (pathname === '/api/v1/scheduler/funds/config') payload = payloads.config;
  if (pathname === '/api/v1/scheduler/funds/summary') payload = payloads.summary;
  if (pathname === '/api/v1/scheduler/funds/coverage') payload = payloads.coverage;
  if (pathname === '/api/v1/scheduler/funds/runs') payload = payloads.runs;
  if (pathname === '/api/v1/health/queue' || pathname === '/api/v1/health/worker') payload = payloads.worker;
  if (!payload) {
    return new Response(JSON.stringify({ success: false, error: 'not found', pathname }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
await import(${JSON.stringify(checkScriptPath)});
`,
    'utf8'
  );

  await handler(baseUrl, bootstrapFile);
}

async function testHealthCheckUsesPersistedThresholdsByDefault(): Promise<void> {
  await withHealthFetchBootstrap(async (baseUrl, bootstrapFile) => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'funds-phase12-health-'));
    const outputFile = path.join(tempDir, 'funds-health.json');

    const exitCode = await runCommand(
      process.execPath,
      ['--import', 'tsx', bootstrapFile],
      {
        ...process.env,
        HEALTH_BASE_URL: baseUrl,
        FUNDS_SCHEDULER_ADMIN_EMAIL: 'admin@example.com',
        FUNDS_SCHEDULER_ADMIN_PASSWORD: 'secret',
        FUNDS_SCHEDULER_RUN_PRODUCT_DESK_CHECKS: 'false',
        FUNDS_SCHEDULER_HEALTH_OUTPUT_FILE: outputFile,
      }
    );

    assert.equal(exitCode, 0, 'health check should succeed against the Phase 12 stub server');

    const raw = await readFile(outputFile, 'utf8');
    const summary = JSON.parse(raw) as {
      thresholds: Record<string, number | null>;
      thresholdProfile: Record<string, unknown>;
    };

    assert.equal(summary.thresholds.maxMissingAccounts, 1);
    assert.equal(summary.thresholds.maxLatestSnapshotAgeMinutes, 90);
    assert.equal(summary.thresholdProfile.mode, 'bounded');
  });
}

async function testHealthCheckAllowsEnvOverridesAbovePersistedThresholds(): Promise<void> {
  await withHealthFetchBootstrap(async (baseUrl, bootstrapFile) => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'funds-phase12-health-env-'));
    const outputFile = path.join(tempDir, 'funds-health.json');

    const exitCode = await runCommand(
      process.execPath,
      ['--import', 'tsx', bootstrapFile],
      {
        ...process.env,
        HEALTH_BASE_URL: baseUrl,
        FUNDS_SCHEDULER_ADMIN_EMAIL: 'admin@example.com',
        FUNDS_SCHEDULER_ADMIN_PASSWORD: 'secret',
        FUNDS_SCHEDULER_RUN_PRODUCT_DESK_CHECKS: 'false',
        FUNDS_SCHEDULER_HEALTH_OUTPUT_FILE: outputFile,
        FUNDS_SCHEDULER_MAX_MISSING_ACCOUNTS: '5',
      }
    );

    assert.equal(exitCode, 0, 'health check should allow Phase 12 env overrides');

    const raw = await readFile(outputFile, 'utf8');
    const summary = JSON.parse(raw) as {
      thresholds: Record<string, number | null>;
      thresholdProfile: Record<string, unknown>;
    };

    assert.equal(summary.thresholds.maxMissingAccounts, 5);
    assert.equal(summary.thresholdProfile.mode, 'bounded');
  });
}

async function runSourceMarkerAssertions(): Promise<void> {
  const releaseGateSource = await readFile(
    path.join(process.cwd(), 'scripts', 'release-gates', 'release-gate-funds-scheduler.ts'),
    'utf8'
  );
  const signoffSource = await readFile(
    path.join(process.cwd(), 'scripts', 'signoffs', 'signoff-funds-scheduler.ts'),
    'utf8'
  );
  const healthSource = await readFile(
    path.join(process.cwd(), 'scripts', 'checks', 'check-funds-scheduler-health.ts'),
    'utf8'
  );
  const packageSource = await readFile(path.join(process.cwd(), 'package.json'), 'utf8');

  assert.equal(
    releaseGateSource.includes('backend-funds-scheduler-suite'),
    true,
    'release gate must include the funds scheduler module suite'
  );
  assert.equal(
    signoffSource.includes('backend-funds-scheduler-suite'),
    true,
    'signoff must require the funds scheduler module gate result'
  );
  assert.equal(
    healthSource.includes('buildConfiguredThresholds'),
    true,
    'funds scheduler health must derive thresholds from persisted config with optional env overrides'
  );
  assert.equal(
    packageSource.includes('"test:funds-scheduler"'),
    true,
    'package.json must include the funds scheduler module script'
  );
}

async function main(): Promise<void> {
  await testFundsThresholdsPersistAndSurfaceInSummary();
  await testHealthCheckUsesPersistedThresholdsByDefault();
  await testHealthCheckAllowsEnvOverridesAbovePersistedThresholds();
  await runSourceMarkerAssertions();
  console.log('Funds scheduler phase 12 assertions passed.');
}

  await main();
}

const suiteSteps = {
  "01": funds_schedulerGuard01,
  "02": funds_schedulerGuard02,
  "03": funds_schedulerGuard03,
  "04": funds_schedulerGuard04,
  "06": funds_schedulerGuard06,
  "07": funds_schedulerGuard07,
  "08": funds_schedulerGuard08,
  "10": funds_schedulerGuard10,
  "11": funds_schedulerGuard11,
  "12": funds_schedulerGuard12,
} as const;

export async function runFundsSchedulerSuite(): Promise<void> {
  await runSuiteSteps("Funds scheduler module", "scripts/test-funds-scheduler.ts", ["01", "02", "03", "04", "06", "07", "08", "10", "11", "12"]);
  console.log("Funds scheduler module assertions passed.");
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
