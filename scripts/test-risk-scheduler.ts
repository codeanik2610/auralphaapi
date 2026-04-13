import assert from 'node:assert/strict';
import { runSuiteSteps } from './_support/run-script-suite';

// Consolidated module suite.

async function risk_schedulerGuard01(): Promise<void> {
  const { default: fs } = await import("node:fs");
  const { default: path } = await import("node:path");
  const { RiskSchedulerService } = await import("../src/api/services/RiskSchedulerService");
  const { SchedulerOverviewService } = await import("../src/api/services/SchedulerOverviewService");
  const { coreDataSource } = await import("../src/database/data-source");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function createAnchorConfig(overrides: Record<string, unknown> = {}) {
  return {
    key: 'risk-recompute-sync',
    name: 'Legacy Risk Scheduler',
    description: 'Legacy risk scheduler config',
    enabled: true,
    cronExpression: '0 1 * * *',
    timezone: 'UTC',
    runAt: '01:00',
    intervalDays: 1,
    batchSize: 200,
    schedulerType: 'global',
    config: {
      sources: ['risk'],
      retentionDays: 30,
    },
    lastStartedAt: null,
    lastFinishedAt: null,
    lastStatus: null,
    lastError: null,
    runningLockUntil: null,
    createdAt: new Date('2026-04-10T00:00:00.000Z'),
    updatedAt: new Date('2026-04-10T00:00:00.000Z'),
    ...overrides,
  };
}

function createUserConfig(overrides: Record<string, unknown> = {}) {
  return {
    id: 'risk-user-config-1',
    schedulerKey: 'risk-recompute-sync',
    userId: 'admin-user-1',
    name: '',
    description: null,
    enabled: true,
    cronExpression: '',
    timezone: '',
    runAt: '',
    intervalDays: 0,
    batchSize: 0,
    schedulerType: 'global',
    config: {},
    lastStartedAt: null,
    lastFinishedAt: null,
    lastStatus: null,
    lastError: null,
    runningLockUntil: null,
    createdAt: new Date('2026-04-10T00:00:00.000Z'),
    updatedAt: new Date('2026-04-10T00:00:00.000Z'),
    ...overrides,
  };
}

async function testRiskSchedulerOwnershipNormalization(): Promise<void> {
  const service = new RiskSchedulerService() as any;
  const storedAnchor = createAnchorConfig();
  let storedUserConfig = createUserConfig();
  const anchorUpdateCalls: Array<Record<string, unknown>> = [];
  const userUpdateCalls: Array<Record<string, unknown>> = [];
  const createdRunPayloads: Array<Record<string, unknown>> = [];
  const createdCommandPayloads: Array<Record<string, unknown>> = [];
  let globalPendingChecks = 0;
  let actorPendingChecks = 0;
  let globalRunningChecks = 0;
  let actorRunningChecks = 0;

  service.schedulerConfigRepository = {
    async createIfMissing() {
      return storedAnchor as any;
    },
    async updateByKey(key: string, payload: Record<string, unknown>) {
      assert.equal(key, 'risk-recompute-sync');
      anchorUpdateCalls.push(payload);
      Object.assign(storedAnchor, payload);
      return storedAnchor as any;
    },
  } as any;
  service.schedulerUserConfigRepository = {
    async createIfMissing(payload: Record<string, unknown>) {
      assert.equal(payload.schedulerKey, 'risk-recompute-sync');
      assert.equal(payload.userId, 'admin-user-1');
      return storedUserConfig as any;
    },
    async updateBySchedulerKeyAndUserId(
      schedulerKey: string,
      userId: string,
      payload: Record<string, unknown>
    ) {
      assert.equal(schedulerKey, 'risk-recompute-sync');
      assert.equal(userId, 'admin-user-1');
      userUpdateCalls.push(payload);
      Object.assign(storedUserConfig, payload);
      return storedUserConfig as any;
    },
  } as any;
  service.schedulerCommandRepository = {
    async findLatestBySchedulerKeyAndTypeInStatuses() {
      globalPendingChecks += 1;
      return null;
    },
    async findLatestBySchedulerKeyAndTypeAndActorInStatuses(
      schedulerKey: string,
      commandType: string,
      actorUserId: string,
      statuses: string[]
    ) {
      actorPendingChecks += 1;
      assert.equal(schedulerKey, 'risk-recompute-sync');
      assert.equal(commandType, 'run_now');
      assert.equal(actorUserId, 'admin-user-1');
      assert.deepEqual(statuses, ['Pending', 'Processing']);
      return null;
    },
    async createCommand(payload: Record<string, unknown>) {
      createdCommandPayloads.push(payload);
      return { id: 'cmd-1', ...payload };
    },
    async cancelPendingBySchedulerKeyAndActor() {
      return 0;
    },
  } as any;
  service.schedulerRunLogRepository = {
    async hasRunningRun() {
      globalRunningChecks += 1;
      return false;
    },
    async hasRunningRunBySchedulerKeyAndActor(
      schedulerKey: string,
      actorUserId: string
    ) {
      actorRunningChecks += 1;
      assert.equal(schedulerKey, 'risk-recompute-sync');
      assert.equal(actorUserId, 'admin-user-1');
      return false;
    },
    async createRun(payload: Record<string, unknown>) {
      createdRunPayloads.push(payload);
      return payload;
    },
    async cancelQueuedRunsBySchedulerKeyAndActor() {
      return 0;
    },
  } as any;
  service.userTimeZoneService = {
    async resolveUserTimeZone(userId: string) {
      assert.equal(userId, 'admin-user-1');
      return 'UTC';
    },
  } as any;
  service.activityRepository = {} as any;
  service.alertRepository = {} as any;
  service.exchangeAssetUpdateLogRepository = {} as any;
  service.brokerAccountRepository = {} as any;
  service.fundsSnapshotRepository = {} as any;
  service.positionSnapshotRepository = {} as any;
  service.riskRepository = {} as any;
  service.riskControlRepository = {} as any;
  service.riskAlertRepository = {} as any;
  service.riskScenarioRepository = {} as any;
  service.logSchedulerActivity = async () => {};
  service.emitSchedulerFailureAlert = async () => {};

  const getResponse = await service.getSchedulerConfig('admin-user-1');
  assert.equal(getResponse.data.schedulerType, 'user');
  assert.equal(storedAnchor.schedulerType, 'user');
  assert.equal(storedUserConfig.schedulerType, 'user');
  assert.equal(storedAnchor.description, 'Admin-owned scheduler for background risk snapshot refresh and risk-center diagnostics across all user-owned connections.');
  assert.equal(storedUserConfig.name, 'Risk Snapshot Refresh');
  assert.equal(storedUserConfig.description, 'Admin-owned scheduler for background risk snapshot refresh and risk-center diagnostics across all user-owned connections.');
  assert.equal(storedUserConfig.cronExpression, '0 1 * * *');
  assert.equal(storedUserConfig.timezone, 'UTC');
  assert.equal(storedUserConfig.runAt, '01:00');
  assert.equal(storedUserConfig.intervalDays, 1);
  assert.equal(storedUserConfig.batchSize, 200);
  assert.deepEqual(storedUserConfig.config, {
    sources: ['risk'],
    retentionDays: 30,
  });
  assert.ok(
    anchorUpdateCalls.some(
      (payload) => String(payload.schedulerType || '').trim().toLowerCase() === 'user'
    ),
    'getSchedulerConfig should normalize the legacy scheduler anchor back to user scope'
  );
  assert.ok(
    userUpdateCalls.some(
      (payload) => String(payload.schedulerType || '').trim().toLowerCase() === 'user'
    ),
    'getSchedulerConfig should normalize the actor-owned scheduler row back to user scope'
  );

  await assert.rejects(
    () =>
      service.updateSchedulerConfig('admin-user-1', {
        schedulerType: 'global',
      } as any),
    /user scheduler/
  );

  const runResponse = await service.runNow('admin-user-1');
  assert.equal(runResponse.data.queued, true);
  assert.equal(globalPendingChecks, 0);
  assert.equal(actorPendingChecks, 1);
  assert.equal(globalRunningChecks, 0);
  assert.equal(actorRunningChecks, 1);

  const createdRun = createdRunPayloads[0] || {};
  const createdRunMeta =
    createdRun.meta && typeof createdRun.meta === 'object' && !Array.isArray(createdRun.meta)
      ? (createdRun.meta as Record<string, unknown>)
      : {};
  assert.equal(createdRun.actorUserId, 'admin-user-1');
  assert.equal(createdRun.executionContext, 'user');
  assert.equal(createdRun.initiatedByType, 'manual');
  assert.equal(createdRun.initiatedByUserId, 'admin-user-1');
  assert.equal(createdRunMeta.actorUserId, 'admin-user-1');
  assert.equal(createdRunMeta.executionContext, 'user');

  const createdCommand = createdCommandPayloads[0] || {};
  const createdCommandBody =
    createdCommand.payload &&
    typeof createdCommand.payload === 'object' &&
    !Array.isArray(createdCommand.payload)
      ? (createdCommand.payload as Record<string, unknown>)
      : {};
  assert.equal(createdCommand.actorUserId, 'admin-user-1');
  assert.equal(createdCommand.executionContext, 'user');
  assert.equal(createdCommand.initiatedByType, 'manual');
  assert.equal(createdCommand.initiatedByUserId, 'admin-user-1');
  assert.equal(createdCommandBody.actorUserId, 'admin-user-1');
  assert.equal(createdCommandBody.executionContext, 'user');
}

async function testSchedulerOverviewUsesRiskUserOverlay(): Promise<void> {
  const service = new SchedulerOverviewService() as any;
  service.userTimeZoneService = {
    async resolveUserTimeZone(userId: string) {
      assert.equal(userId, 'admin-user-9');
      return 'UTC';
    },
  } as any;

  const originalQuery = (coreDataSource as any).query;

  (coreDataSource as any).query = async (sql: string, params: unknown[] = []) => {
    if (sql.includes('FROM scheduler_configs')) {
      return [
        {
          key: 'risk-recompute-sync',
          name: 'Risk Snapshot Refresh',
          enabled: 0,
          last_finished_at: '2026-04-10T01:00:00.000Z',
          last_status: 'Completed',
          last_error: null,
          scheduler_type: 'user',
        },
      ];
    }

    if (sql.includes('FROM scheduler_user_configs')) {
      assert.deepEqual(params, ['admin-user-9']);
      return [
        {
          key: 'risk-recompute-sync',
          name: 'Risk Snapshot Refresh Personal',
          enabled: 1,
          last_finished_at: '2026-04-09T01:00:00.000Z',
          last_status: 'Failed',
          last_error: 'User overlay should win',
          scheduler_type: 'user',
        },
      ];
    }

    if (sql.includes('FROM scheduler_run_logs') && sql.includes('WHERE actor_user_id = ?')) {
      return [
        {
          id: 'risk-run-1',
          schedulerKey: 'risk-recompute-sync',
          status: 'Completed',
          startedAt: '2026-04-10T01:05:00.000Z',
          finishedAt: '2026-04-10T01:06:00.000Z',
          durationMs: 60000,
          processedAccounts: 4,
          insertedAssets: 4,
          updatedAssets: 0,
          skippedAssets: 0,
          errorMessage: null,
          meta: JSON.stringify({
            initiatedByType: 'manual',
            initiatedByUserId: 'admin-user-9',
            initiatedByLabel: 'admin-user-9',
            executionContext: 'user',
          }),
          initiatedByType: 'manual',
          initiatedByUserId: 'admin-user-9',
          initiatedByLabel: 'admin-user-9',
          executionContext: 'user',
        },
      ];
    }

    return [];
  };

  try {
    const response = await service.getOverview('admin-user-9');
    const item = response.data.items.find((entry: any) => entry.key === 'risk-recompute-sync');
    assert.ok(item, 'risk-recompute-sync should remain present in scheduler overview');
    assert.equal(item?.name, 'Risk Snapshot Refresh Personal');
    assert.equal(item?.enabled, true);
    assert.equal(item?.status, 'failed');
    assert.equal(item?.lastStatus, 'Failed');
    assert.equal(item?.lastError, 'User overlay should win');
    assert.equal(item?.initiatedBy?.type, 'manual');
    assert.equal(item?.initiatedBy?.userId, 'admin-user-9');
    assert.equal(item?.executionContext, 'user');
  } finally {
    (coreDataSource as any).query = originalQuery;
  }
}

function testPhaseOneDocAndWorkflowMarkers(): void {
  const findings: string[] = [];

  const phaseDoc = read('RISK_SCHEDULER_PHASE1.md');
  for (const marker of [
    '`risk-recompute-sync`',
    '`schedulerType = user`',
    'scheduler or cron execution fans out across all eligible user-owned connections in the system',
    '`/risk/recompute` stays own-user only',
    '`userId = null` connections are excluded',
    'Phase 1 does not change the all-users scheduler recompute path or the own-user product recompute path.',
  ]) {
    if (!phaseDoc.includes(marker)) {
      findings.push(`RISK_SCHEDULER_PHASE1.md: missing contract marker ${marker}`);
    }
  }

  const checklist = read('RISK_SCHEDULER_FUNCTIONAL_CHECKLIST.md');
  for (const marker of [
    'scheduler or cron execution fans out across all eligible users and all eligible user connections',
    'internal or product-triggered execution stays limited to the requesting user\'s own connections',
    'Scheduler or cron runs only consider real user-owned connections with a non-null `userId`.',
  ]) {
    if (!checklist.includes(marker)) {
      findings.push(`RISK_SCHEDULER_FUNCTIONAL_CHECKLIST.md: missing marker ${marker}`);
    }
  }

  const readme = read('README.md');
  if (!readme.includes('RISK_SCHEDULER_PHASE1.md')) {
    findings.push('README.md: missing risk scheduler Phase 1 baseline link');
  }
  if (!readme.includes('test:risk-scheduler')) {
    findings.push('README.md: missing risk scheduler module verification command');
  }
  if (!readme.includes('frozen Phase 1 contract for `risk-recompute-sync`')) {
    findings.push('README.md: missing risk scheduler Phase 1 baseline summary');
  }

  const serviceSource = read('src/api/services/RiskSchedulerService.ts');
  for (const marker of [
    "const RISK_SCHEDULER_OWNERSHIP = 'user' as const;",
    'Risk Snapshot Refresh is a user scheduler and cannot be switched to global scope.',
    'findLatestBySchedulerKeyAndTypeAndActorInStatuses',
    'hasRunningRunBySchedulerKeyAndActor',
    'listRunsBySchedulerKeyAndActor',
    'findByIdAndSchedulerKeyAndActor',
  ]) {
    if (!serviceSource.includes(marker)) {
      findings.push(`RiskSchedulerService.ts: missing Phase 1 marker ${marker}`);
    }
  }

  const healthSource = read('scripts/checks/check-risk-scheduler-health.ts');
  if (!healthSource.includes("assert.equal(readString(configData.schedulerType), 'user');")) {
    findings.push('check-risk-scheduler-health.ts: missing user-scoped config assertion');
  }

  const packageSource = read('package.json');
  if (!packageSource.includes('"test:risk-scheduler"')) {
    findings.push('package.json: missing risk scheduler module test script');
  }
  if (!packageSource.includes('"test:risk-scheduler"')) {
    findings.push('package.json: risk scheduler module guard must stay wired');
  }

  assert.equal(
    findings.length,
    0,
    `Risk scheduler Phase 1 guard failed:\n${findings.join('\n')}`
  );
}

async function run(): Promise<void> {
  await testRiskSchedulerOwnershipNormalization();
  await testSchedulerOverviewUsesRiskUserOverlay();
  testPhaseOneDocAndWorkflowMarkers();
  console.log('Risk scheduler phase 1 assertions passed.');
}

  await run();
}

async function risk_schedulerGuard02(): Promise<void> {
  const { default: fs } = await import("node:fs");
  const { default: path } = await import("node:path");
  const { RiskSchedulerService } = await import("../src/api/services/RiskSchedulerService");
  const { RiskService } = await import("../src/api/services/RiskService");
  const { env } = await import("../src/env");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

async function runRealRecomputeAssertions(): Promise<void> {
  const service = new RiskService() as any;
  const createdSnapshots: Array<Record<string, unknown>> = [];
  const createdControls: Array<Record<string, unknown>> = [];
  const createdAlerts: Array<Record<string, unknown>> = [];
  const createdScenarios: Array<Record<string, unknown>> = [];
  const activities: Array<Record<string, unknown>> = [];

  service.brokerAccountRepository = {
    async getConnectedBrokerAccounts(userId: string) {
      assert.equal(userId, 'user-1');
      return [
        {
          id: 'acc-1',
          brokerKey: 'mudrex',
          accountName: 'Mudrex Prime',
          accountKey: 'mudrex-prime',
        },
        {
          id: 'acc-2',
          brokerKey: 'delta_exchange',
          accountName: 'Delta Futures',
          accountKey: 'delta-futures',
        },
      ];
    },
  };
  service.fundsSnapshotRepository = {
    async getLatestSnapshot(userId: string, brokerKey: string, accountId: string) {
      assert.equal(userId, 'user-1');
      if (String(brokerKey).toLowerCase() === 'mudrex' && accountId === 'acc-1') {
        return {
          futures_funds_json: JSON.stringify({ equity: 10000 }),
          wallet_funds_json: null,
          computed_at: new Date('2026-04-10T09:00:00.000Z'),
          created_at: new Date('2026-04-10T09:00:00.000Z'),
        };
      }
      if (String(brokerKey).toLowerCase() === 'delta_exchange' && accountId === 'acc-2') {
        return {
          futures_funds_json: null,
          wallet_funds_json: JSON.stringify({ total: 5000 }),
          computed_at: new Date('2026-04-10T09:05:00.000Z'),
          created_at: new Date('2026-04-10T09:05:00.000Z'),
        };
      }
      return null;
    },
  };
  service.positionReadModelRepository = {
    async listLivePositionsForAccounts(userId: string, accountIds: string[]) {
      assert.equal(userId, 'user-1');
      assert.deepEqual(accountIds, ['acc-1', 'acc-2']);
      return new Map([
        [
          'acc-1',
          [
            {
              id: 'pos-1',
              symbol: 'BTCUSDT',
              leverage: 7,
              current_price: 100,
              liquidation_price: 94,
              unrealized_pnl: -900,
              exposure: 5200,
              positionSummary: {
                id: 'pos-1',
                symbol: 'BTCUSDT',
                exposure: 5200,
                leverage: 7,
                currentPrice: 100,
                liquidationPrice: 94,
                unrealizedPnl: -900,
              },
            },
          ],
        ],
        [
          'acc-2',
          [
            {
              id: 'pos-2',
              symbol: 'ETHUSDT',
              leverage: 3,
              current_price: 50,
              liquidation_price: 40,
              unrealized_pnl: -120,
              exposure: 1800,
              positionSummary: {
                id: 'pos-2',
                symbol: 'ETHUSDT',
                exposure: 1800,
                leverage: 3,
                currentPrice: 50,
                liquidationPrice: 40,
                unrealizedPnl: -120,
              },
            },
          ],
        ],
      ]);
    },
  };
  service.riskPolicyRepository = {
    async getEffectivePolicy(userId: string, brokerKey?: string) {
      assert.equal(userId, 'user-1');
      if (String(brokerKey).toLowerCase() === 'mudrex') {
        return {
          marginUsageWarnPct: 60,
          marginUsageCriticalPct: 75,
          concentrationWarnPct: 20,
          concentrationCriticalPct: 35,
          dailyLossLimitPct: 4,
          maxLeverage: 5,
          maxTotalAllocation: 55,
          maxAvgLeverage: 3,
        };
      }
      return {
        marginUsageWarnPct: 70,
        marginUsageCriticalPct: 85,
        concentrationWarnPct: 25,
        concentrationCriticalPct: 40,
        dailyLossLimitPct: 5,
        maxLeverage: 6,
        maxTotalAllocation: 65,
        maxAvgLeverage: 4,
      };
    },
  };
  service.riskRepository = {
    async createComputedSnapshot(userId: string, payload: Record<string, unknown>) {
      assert.equal(userId, 'user-1');
      createdSnapshots.push(payload);
      return {
        id: 'snapshot-1',
        createdAt: new Date('2026-04-10T09:10:00.000Z'),
      };
    },
  };
  service.riskControlRepository = {
    async createComputedControls(userId: string, snapshotId: string, items: Record<string, unknown>[]) {
      assert.equal(userId, 'user-1');
      assert.equal(snapshotId, 'snapshot-1');
      createdControls.push(...items);
      return items.length;
    },
  };
  service.riskAlertRepository = {
    async createComputedAlerts(userId: string, snapshotId: string, items: Record<string, unknown>[]) {
      assert.equal(userId, 'user-1');
      assert.equal(snapshotId, 'snapshot-1');
      createdAlerts.push(...items);
      return items.length;
    },
  };
  service.riskScenarioRepository = {
    async createComputedScenarios(userId: string, snapshotId: string, items: Record<string, unknown>[]) {
      assert.equal(userId, 'user-1');
      assert.equal(snapshotId, 'snapshot-1');
      createdScenarios.push(...items);
      return items.length;
    },
  };
  service.operationalEventService = {
    async logActivity(userId: string, payload: Record<string, unknown>) {
      assert.equal(userId, 'user-1');
      activities.push(payload);
    },
  };

  const response = await service.recomputeRiskSnapshot('user-1');

  assert.equal(response.data.message, 'Risk snapshot recomputed');
  assert.equal(response.data.snapshotId, 'snapshot-1');
  assert.equal(response.data.equity, 15000);
  assert.equal(response.data.accountCount, 2);
  assert.equal(response.data.livePositionCount, 2);
  assert.equal(response.data.portfolioRisk, 'Critical');
  assert.equal(response.data.controlsCreated, createdControls.length);
  assert.equal(response.data.alertsCreated, createdAlerts.length);
  assert.equal(response.data.scenariosCreated, createdScenarios.length);
  assert.ok(createdSnapshots.length === 1);
  assert.equal(createdSnapshots[0].portfolioRisk, 'Critical');
  assert.equal(createdSnapshots[0].capitalAtRisk, 7000);
  assert.equal(createdSnapshots[0].marginUsage, '47%');
  assert.equal(createdSnapshots[0].drawdownBudgetUsed, '6.8%');
  assert.ok(createdControls.length >= 5, 'expected multiple persisted controls');
  assert.ok(
    createdControls.some((item) => item.bucket === 'Portfolio margin usage' && item.status === 'Ok')
  );
  assert.ok(
    createdControls.some((item) => item.bucket === 'BTCUSDT concentration' && item.status === 'Watch')
  );
  assert.ok(
    createdAlerts.some(
      (item) =>
        String(item.symbol) === 'BTCUSDT' && String(item.message).toLowerCase().includes('btcusdt')
    )
  );
  assert.ok(createdScenarios.some((item) => item.scenario === '5% adverse move'));
  assert.equal(activities.length, 1);
  assert.equal(activities[0].title, 'Risk snapshot recomputed');
}

async function runBatchAggregationAssertions(): Promise<void> {
  const service = new RiskService() as any;
  const activities: Array<Record<string, unknown>> = [];

  service.recomputeRiskSnapshot = async (userId: string) => {
    if (userId === 'user-2') {
      throw new Error('Synthetic recompute failure');
    }
    return {
      success: true,
      data: {
        snapshotId: `snapshot-${userId}`,
        controlsCreated: userId === 'user-1' ? 3 : 2,
        alertsCreated: userId === 'user-1' ? 2 : 1,
        scenariosCreated: 1,
      },
    };
  };
  service.operationalEventService = {
    async logActivity(userId: string, payload: Record<string, unknown>) {
      assert.equal(userId, 'admin-1');
      activities.push(payload);
    },
  };

  const response = await service.recomputeRiskSnapshotBatch('admin-1', [
    'user-1',
    'user-2',
    'user-3',
  ]);

  assert.equal(response.data.processed, 3);
  assert.equal(response.data.succeeded, 2);
  assert.equal(response.data.failed, 1);
  assert.equal(response.data.snapshotsCreated, 2);
  assert.equal(response.data.controlsCreated, 5);
  assert.equal(response.data.alertsCreated, 3);
  assert.equal(response.data.scenariosCreated, 2);
  assert.deepEqual(response.data.failures, [
    {
      userId: 'user-2',
      error: 'Synthetic recompute failure',
    },
  ]);
  assert.equal(activities.length, 1);
  assert.equal(activities[0].title, 'Risk batch recompute completed');
  assert.equal(activities[0].status, 'Watch');
}

async function runAdminSurfaceAssertions(): Promise<void> {
  const service = new RiskSchedulerService() as any;
  const originalExecutionMode = env.scheduler.executionMode;
  env.scheduler.executionMode = 'queue';

  const storedAnchorConfig = {
    id: 'anchor-1',
    key: 'risk-recompute-sync',
    name: 'Risk Snapshot Refresh',
    description:
      'Admin-owned scheduler for background risk snapshot refresh and risk-center diagnostics across all user-owned connections.',
    enabled: false,
    cronExpression: '0 1 * * *',
    timezone: 'UTC',
    runAt: '01:00',
    intervalDays: 1,
    batchSize: 200,
    schedulerType: 'user',
    config: {
      sources: ['risk'],
      retentionDays: 30,
    },
  };

  let storedUserConfig: Record<string, unknown> | null = null;
  let runningState = false;
  const createdCommands: Array<Record<string, unknown>> = [];
  const runLookupResult = {
    id: 'run-1',
    schedulerKey: 'risk-recompute-sync',
    actorUserId: 'admin-1',
    status: 'Completed',
    startedAt: new Date('2026-04-10T08:00:00.000Z'),
    finishedAt: new Date('2026-04-10T08:02:00.000Z'),
    durationMs: 120000,
    processedAccounts: 4,
    insertedAssets: 3,
    updatedAssets: 0,
    skippedAssets: 1,
    errorMessage: null,
    initiatedByType: 'manual',
    initiatedByUserId: 'admin-1',
    initiatedByLabel: 'admin-1',
    executionContext: 'user',
    meta: {
      progress: {
        total: 4,
        processed: 4,
        percent: 100,
      },
    },
  };
  const calls = {
    updateUserConfig: [] as Array<Record<string, unknown>>,
    cancelPendingActor: [] as Array<Record<string, unknown>>,
    cancelPendingTypeActor: [] as Array<Record<string, unknown>>,
    cancelQueuedRunsActor: [] as Array<Record<string, unknown>>,
    deleteRunLogs: [] as Array<Record<string, unknown>>,
    deleteUpdateLogs: [] as Array<Record<string, unknown>>,
    listRuns: [] as Array<Record<string, unknown>>,
    findRun: [] as Array<Record<string, unknown>>,
    listUpdates: [] as Array<Record<string, unknown>>,
  };

  service.userTimeZoneService = {
    async resolveUserTimeZone(userId: string) {
      assert.equal(userId, 'admin-1');
      return 'UTC';
    },
  };
  service.schedulerConfigRepository = {
    async createIfMissing() {
      return { ...storedAnchorConfig };
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
          id: 'risk-user-config-1',
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
          id: 'risk-user-config-1',
          schedulerKey,
          userId,
          name: storedAnchorConfig.name,
          description: storedAnchorConfig.description,
          enabled: false,
          cronExpression: storedAnchorConfig.cronExpression,
          timezone: storedAnchorConfig.timezone,
          runAt: storedAnchorConfig.runAt,
          intervalDays: storedAnchorConfig.intervalDays,
          batchSize: storedAnchorConfig.batchSize,
          schedulerType: 'user',
          config: storedAnchorConfig.config,
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
    async findLatestBySchedulerKeyAndTypeAndActorInStatuses() {
      return null;
    },
    async createCommand(payload: Record<string, unknown>) {
      createdCommands.push(payload);
      return {
        id: `command-${createdCommands.length}`,
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
      assert.equal(schedulerKey, 'risk-recompute-sync');
      assert.equal(actorUserId, 'admin-1');
      return runningState;
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
        items: [runLookupResult],
        total: 1,
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
        items: [
          {
            id: 'update-1',
            runLogId,
            source: 'risk',
            accountId: null,
            connectionId: null,
            actionType: 'updated',
            symbol: 'RISK',
            externalId: null,
            assetId: null,
            message: 'Risk recompute completed',
            detail: null,
            createdAt: new Date('2026-04-10T08:01:00.000Z'),
          },
        ],
        total: 1,
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
      return null;
    },
  };

  try {
    const pauseResponse = await service.pauseScheduler('admin-1');
    assert.equal(pauseResponse.data.action, 'pause');
    assert.equal(
      (calls.updateUserConfig[0]?.payload as Record<string, unknown> | undefined)?.enabled,
      false
    );
    assert.equal(calls.cancelPendingActor[0]?.actorUserId, 'admin-1');
    assert.equal(calls.cancelQueuedRunsActor[0]?.actorUserId, 'admin-1');

    const resumeResponse = await service.resumeScheduler('admin-1');
    assert.equal(resumeResponse.data.action, 'resume');
    assert.equal(
      (calls.updateUserConfig[1]?.payload as Record<string, unknown> | undefined)?.enabled,
      true
    );

    runningState = true;
    createdCommands.length = 0;
    const stopResponse = await service.stopScheduler('admin-1');
    assert.equal(stopResponse.data.action, 'stop');
    assert.equal(stopResponse.data.queued, true);
    assert.equal(createdCommands[0]?.commandType, 'stop_now');
    assert.equal(createdCommands[0]?.actorUserId, 'admin-1');
    assert.equal(createdCommands[0]?.executionContext, 'user');
    assert.equal((createdCommands[0]?.payload as Record<string, unknown>)?.actorUserId, 'admin-1');

    createdCommands.length = 0;
    const restartResponse = await service.restartScheduler('admin-1');
    assert.equal(restartResponse.data.action, 'restart');
    assert.equal(restartResponse.data.queued, true);
    assert.equal(createdCommands.length, 2);
    assert.equal(createdCommands[0]?.commandType, 'stop_now');
    assert.equal(createdCommands[1]?.commandType, 'run_now');
    assert.equal(createdCommands[1]?.actorUserId, 'admin-1');
    assert.equal((createdCommands[1]?.payload as Record<string, unknown>)?.trigger, 'manual');

    const previewResponse = await service.getSchedulerPurgePreview('admin-1');
    assert.equal(previewResponse.data.retentionDays, 30);
    assert.equal(previewResponse.data.runLogsToDelete, 2);
    assert.equal(previewResponse.data.updateLogsToDelete, 3);

    const purgeResponse = await service.purgeSchedulerLogs('admin-1');
    assert.equal(purgeResponse.data.runLogsDeleted, 4);
    assert.equal(purgeResponse.data.updateLogsDeleted, 6);
    assert.equal(calls.deleteRunLogs[0]?.actorUserId, 'admin-1');
    assert.equal(calls.deleteUpdateLogs[0]?.actorUserId, 'admin-1');

    const runsResponse = await service.listSchedulerRuns('admin-1', {
      limit: '10',
      offset: '0',
    });
    assert.equal(runsResponse.data.total, 1);
    assert.deepEqual(calls.listRuns[0], {
      schedulerKey: 'risk-recompute-sync',
      actorUserId: 'admin-1',
      limit: 10,
      offset: 0,
    });

    const progressResponse = await service.getSchedulerRunProgress('admin-1', 'run-1');
    assert.equal(progressResponse.data.run?.id, 'run-1');

    const updatesResponse = await service.listSchedulerRunUpdates('admin-1', 'run-1', {
      limit: '25',
      offset: '0',
      actionType: 'updated',
      source: 'risk',
      symbol: 'RISK',
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });
    assert.equal(updatesResponse.data.total, 1);
    assert.equal(
      (calls.listUpdates[0]?.filters as Record<string, unknown> | undefined)?.actionType,
      'updated'
    );
    assert.equal(
      (calls.listUpdates[0]?.filters as Record<string, unknown> | undefined)?.source,
      'risk'
    );

    const exportResponse = await service.exportSchedulerRunUpdates('admin-1', 'run-1', {
      actionType: 'updated',
      source: 'risk',
      symbol: 'RISK',
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });
    assert.equal(exportResponse.data.fileName, 'scheduler-run-run-1-updates.csv');
    assert.equal(exportResponse.data.rowCount, 1);
    assert.ok(exportResponse.data.csv.includes('"updated"'));
    assert.deepEqual(
      calls.findRun.map((item) => item.actorUserId),
      ['admin-1', 'admin-1', 'admin-1']
    );
  } finally {
    env.scheduler.executionMode = originalExecutionMode;
  }
}

function runPhaseTwoDocAssertions(): void {
  const findings: string[] = [];

  const phaseDoc = read('RISK_SCHEDULER_PHASE2.md');
  for (const marker of [
    'Phase 2 freezes the admin scheduler surface for `risk-recompute-sync`.',
    '`/scheduler/risk/config`',
    '`/scheduler/risk/run`',
    '`/scheduler/risk/pause`',
    '`/scheduler/risk/resume`',
    '`/scheduler/risk/stop`',
    '`/scheduler/risk/restart`',
    '`/scheduler/risk/purge-logs`',
    '`/scheduler/risk/purge-logs/preview`',
    '`/scheduler/risk/summary`',
    '`/scheduler/risk/runs`',
    '`/scheduler/risk/runs/:runId/progress`',
    '`/scheduler/risk/runs/:runId/updates`',
    '`/scheduler/risk/runs/:runId/updates/export`',
    'Phase 3 should focus on the internal execution contract rather than admin route churn.',
  ]) {
    if (!phaseDoc.includes(marker)) {
      findings.push(`RISK_SCHEDULER_PHASE2.md: missing Phase 2 marker ${marker}`);
    }
  }

  const controllerSource = read('src/api/controllers/RiskSchedulerController.ts');
  for (const marker of [
    "@JsonController('/scheduler/risk')",
    "@Get('/config')",
    "@Put('/config')",
    "@Post('/run')",
    "@Post('/pause')",
    "@Post('/resume')",
    "@Post('/stop')",
    "@Post('/restart')",
    "@Post('/purge-logs')",
    "@Get('/purge-logs/preview')",
    "@Get('/summary')",
    "@Get('/runs')",
    "@Get('/runs/:runId/progress')",
    "@Get('/runs/:runId/updates')",
    "@Get('/runs/:runId/updates/export')",
  ]) {
    if (!controllerSource.includes(marker)) {
      findings.push(`RiskSchedulerController.ts: missing Phase 2 route marker ${marker}`);
    }
  }

  const serviceSource = read('src/api/services/RiskSchedulerService.ts');
  for (const marker of [
    'cancelPendingBySchedulerKeyAndActor',
    'cancelPendingBySchedulerKeyAndTypeAndActor',
    'cancelQueuedRunsBySchedulerKeyAndActor',
    'deleteOlderThanDaysBySchedulerKeyAndActor',
    'countOlderThanDaysBySchedulerKeyAndActor',
    'listRunsBySchedulerKeyAndActor',
    'findByIdAndSchedulerKeyAndActor',
  ]) {
    if (!serviceSource.includes(marker)) {
      findings.push(`RiskSchedulerService.ts: missing Phase 2 admin-surface marker ${marker}`);
    }
  }

  const readme = read('README.md');
  if (!readme.includes('RISK_SCHEDULER_PHASE2.md')) {
    findings.push('README.md: missing risk scheduler Phase 2 baseline link');
  }
  if (!readme.includes('test:risk-scheduler')) {
    findings.push('README.md: missing risk scheduler module verification command');
  }
  if (!readme.includes('Phase 2 admin scheduler surface for `risk-recompute-sync`')) {
    findings.push('README.md: missing risk scheduler Phase 2 baseline summary');
  }

  const packageSource = read('package.json');
  if (!packageSource.includes('"test:risk-scheduler"')) {
    findings.push('package.json: missing risk scheduler module test script');
  }
  if (!packageSource.includes('"test:risk-scheduler"')) {
    findings.push('package.json: risk scheduler module guard must stay wired');
  }

  assert.equal(
    findings.length,
    0,
    `Risk scheduler Phase 2 guard failed:\n${findings.join('\n')}`
  );
}

async function main(): Promise<void> {
  await runRealRecomputeAssertions();
  await runBatchAggregationAssertions();
  await runAdminSurfaceAssertions();
  runPhaseTwoDocAssertions();
  console.log('Risk scheduler phase 2 assertions passed.');
}

  await main();
}

async function risk_schedulerGuard03(): Promise<void> {
  const { default: fs } = await import("node:fs");
  const { default: path } = await import("node:path");
  const { InternalRiskSchedulerController } = await import("../src/api/controllers/InternalRiskSchedulerController");
  const { RiskController } = await import("../src/api/controllers/RiskController");
  const { RiskService } = await import("../src/api/services/RiskService");
  const { env } = await import("../src/env");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function createSuccess(data: Record<string, unknown>) {
  return {
    success: true,
    data,
  };
}

async function runProductRouteOwnUserAssertions(): Promise<void> {
  const controller = new RiskController() as any;
  const capturedUserIds: string[] = [];

  controller.riskService = {
    async recomputeRiskSnapshot(userId: string) {
      capturedUserIds.push(userId);
      return createSuccess({
        message: 'Risk snapshot recomputed',
        snapshotId: 'snapshot-1',
      });
    },
  };

  const response = await controller.recomputeRiskSnapshot({
    authUser: {
      sub: 'user-1',
      role: 'user',
    },
  } as any);

  assert.deepEqual(capturedUserIds, ['user-1']);
  assert.equal(response.data.snapshotId, 'snapshot-1');
}

async function runInternalBatchRouteAssertions(): Promise<void> {
  const controller = new InternalRiskSchedulerController() as any;
  const calls: Array<{ actorUserId: string; targetUserIds?: string[] }> = [];

  controller.riskService = {
    async recomputeRiskSnapshotBatch(actorUserId: string, targetUserIds?: string[]) {
      calls.push({ actorUserId, targetUserIds });
      return createSuccess({
        message: 'Risk batch recompute completed',
        processed: targetUserIds?.length || 0,
        succeeded: targetUserIds?.length || 0,
        failed: 0,
        completedAt: '2026-04-11T00:00:00.000Z',
        failures: [],
      });
    },
  };

  const normalizedResponse = await controller.recomputeBatch({
    actorUserId: ' admin-1 ',
    targetUserIds: ['user-1', '', ' user-2 ', 'user-1', '   '],
  });

  await controller.recomputeBatch({
    actorUserId: '   ',
    targetUserIds: ['   '],
  });

  assert.deepEqual(calls, [
    {
      actorUserId: 'admin-1',
      targetUserIds: ['user-1', 'user-2'],
    },
    {
      actorUserId: env.scheduler.systemUserId,
      targetUserIds: undefined,
    },
  ]);
  assert.equal(normalizedResponse.data.processed, 2);
}

async function runBatchServiceNormalizationAssertions(): Promise<void> {
  const service = new RiskService() as any;
  const recomputedUserIds: string[] = [];
  const activityLogs: Array<{ actorUserId: string; payload: Record<string, unknown> }> = [];

  service.recomputeRiskSnapshot = async (userId: string) => {
    recomputedUserIds.push(userId);
    return createSuccess({
      snapshotId: `snapshot-${userId}`,
      controlsCreated: userId === 'user-1' ? 2 : 1,
      alertsCreated: 1,
      scenariosCreated: 1,
    });
  };
  service.operationalEventService = {
    async logActivity(actorUserId: string, payload: Record<string, unknown>) {
      activityLogs.push({ actorUserId, payload });
    },
  };

  const response = await service.recomputeRiskSnapshotBatch('admin-1', [
    ' user-1 ',
    '',
    'user-2',
    'user-1',
    '   ',
  ] as any);

  assert.deepEqual(recomputedUserIds, ['user-1', 'user-2']);
  assert.equal(response.data.processed, 2);
  assert.equal(response.data.succeeded, 2);
  assert.equal(response.data.failed, 0);
  assert.equal(response.data.snapshotsCreated, 2);
  assert.equal(response.data.controlsCreated, 3);
  assert.equal(response.data.alertsCreated, 2);
  assert.equal(response.data.scenariosCreated, 2);
  assert.equal(activityLogs.length, 1);
  assert.equal(activityLogs[0]?.actorUserId, 'admin-1');
  assert.equal(activityLogs[0]?.payload.title, 'Risk batch recompute completed');
}

function runPhaseThreeDocAssertions(): void {
  const findings: string[] = [];

  const phaseDoc = read('RISK_SCHEDULER_PHASE3.md');
  for (const marker of [
    'Phase 3 freezes the internal execution contract for `risk-recompute-sync`.',
    '`/risk/recompute` remains signed-in-user only.',
    '`/internal/risk/recompute`',
    '`targetUserIds`',
    '`actorUserId`',
    'scheduler or cron execution still fans out across all real user-owned connections.',
    '`userId = null` connections are excluded from the scheduler target set.',
    'Phase 4 should focus on runtime proof and failure isolation rather than reopening the execution split.',
  ]) {
    if (!phaseDoc.includes(marker)) {
      findings.push(`RISK_SCHEDULER_PHASE3.md: missing Phase 3 marker ${marker}`);
    }
  }

  const productControllerSource = read('src/api/controllers/RiskController.ts');
  for (const marker of [
    "@Post('/recompute')",
    'return this.riskService.recomputeRiskSnapshot(requireAuthUserId(request));',
  ]) {
    if (!productControllerSource.includes(marker)) {
      findings.push(`RiskController.ts: missing Phase 3 product-route marker ${marker}`);
    }
  }

  const internalControllerSource = read('src/api/controllers/InternalRiskSchedulerController.ts');
  for (const marker of [
    "@JsonController('/internal/risk')",
    "@Post('/recompute')",
    'String(body.actorUserId || \'\').trim() || env.scheduler.systemUserId',
    'body.targetUserIds',
    'targetUserIds?.length ? targetUserIds : undefined',
  ]) {
    if (!internalControllerSource.includes(marker)) {
      findings.push(`InternalRiskSchedulerController.ts: missing Phase 3 marker ${marker}`);
    }
  }

  const serviceSource = read('src/api/services/RiskService.ts');
  for (const marker of [
    'targetUserIds',
    '.map((item) => String(item || \'\').trim())',
    'new Set(',
    'this.recomputeRiskSnapshot(userId)',
    'await this.operationalEventService.logActivity(actorUserId, {',
  ]) {
    if (!serviceSource.includes(marker)) {
      findings.push(`RiskService.ts: missing Phase 3 marker ${marker}`);
    }
  }

  const workerExecutionSource = read('../aurAlphaSchedulerWorker/src/scheduler/services/SchedulerExecutionService.ts');
  for (const marker of [
    'executeRiskRecomputeSync(',
    'resolveRiskRecomputeTargetUserIds(',
    'listActorConnectedAccounts(',
    'env.scheduler.systemUserId',
    "/internal/risk/recompute",
    'actorUserId,',
    '...(targetUserIds.length > 0 ? { targetUserIds } : {}),',
  ]) {
    if (!workerExecutionSource.includes(marker)) {
      findings.push(`Worker SchedulerExecutionService.ts: missing Phase 3 marker ${marker}`);
    }
  }

  const workerPollerSource = read('../aurAlphaSchedulerWorker/src/scheduler/queue/SchedulerCommandPoller.ts');
  for (const marker of [
    'buildRiskScheduledScope(',
    'listRiskTargetUserIds(',
    'user_id IS NOT NULL',
    "TRIM(user_id) <> ''",
    'userIds: targetUserIds',
  ]) {
    if (!workerPollerSource.includes(marker)) {
      findings.push(`Worker SchedulerCommandPoller.ts: missing Phase 3 marker ${marker}`);
    }
  }

  const readme = read('README.md');
  if (!readme.includes('RISK_SCHEDULER_PHASE3.md')) {
    findings.push('README.md: missing risk scheduler Phase 3 baseline link');
  }
  if (!readme.includes('test:risk-scheduler')) {
    findings.push('README.md: missing risk scheduler module verification command');
  }
  if (!readme.includes('Phase 3 internal execution contract for `risk-recompute-sync`')) {
    findings.push('README.md: missing risk scheduler Phase 3 baseline summary');
  }

  const packageSource = read('package.json');
  if (!packageSource.includes('"test:risk-scheduler"')) {
    findings.push('package.json: missing risk scheduler module test script');
  }
  if (!packageSource.includes('"test:risk-scheduler"')) {
    findings.push('package.json: risk scheduler module guard must stay wired');
  }

  assert.equal(
    findings.length,
    0,
    `Risk scheduler Phase 3 guard failed:\n${findings.join('\n')}`
  );
}

async function main(): Promise<void> {
  await runProductRouteOwnUserAssertions();
  await runInternalBatchRouteAssertions();
  await runBatchServiceNormalizationAssertions();
  runPhaseThreeDocAssertions();
  console.log('Risk scheduler phase 3 assertions passed.');
}

  await main();
}

async function risk_schedulerGuard04(): Promise<void> {
  const { default: fs } = await import("node:fs");
  const { default: path } = await import("node:path");
  const { RiskSchedulerService } = await import("../src/api/services/RiskSchedulerService");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

async function loadWorkerSchedulerExecutionService(): Promise<new () => any> {
  const workerModulePath = path.resolve(
    process.cwd(),
    '../aurAlphaSchedulerWorker/src/scheduler/services/SchedulerExecutionService.ts'
  );
  const workerModule = (await import(workerModulePath)) as Record<string, unknown>;
  return workerModule.SchedulerExecutionService as new () => any;
}

async function runRiskSchedulerRuntimeAssertions(): Promise<void> {
  const service = new RiskSchedulerService() as any;
  const runDate = new Date('2026-04-11T01:00:00.000Z');
  const finishDate = new Date('2026-04-11T01:04:00.000Z');
  const updateDate = new Date('2026-04-11T01:02:00.000Z');
  const updateQueryFilters: Array<Record<string, unknown>> = [];

  service.userTimeZoneService = {
    async resolveUserTimeZone(userId: string) {
      assert.equal(userId, 'admin-1');
      return 'UTC';
    },
  };
  service.schedulerUserConfigRepository = {
    async createIfMissing(payload: Record<string, unknown>) {
      assert.equal(payload.schedulerKey, 'risk-recompute-sync');
      assert.equal(payload.userId, 'admin-1');
      return {
        id: 'risk-user-config-1',
        ...payload,
        name: 'Risk Snapshot Refresh',
        description:
          'Admin-owned scheduler for background risk snapshot refresh and risk-center diagnostics across all user-owned connections.',
        enabled: true,
        cronExpression: '0 1 * * *',
        timezone: 'UTC',
        runAt: '01:00',
        intervalDays: 1,
        batchSize: 200,
        schedulerType: 'user',
        config: {
          sources: ['risk'],
          retentionDays: 30,
        },
        lastStartedAt: runDate,
        lastFinishedAt: finishDate,
        lastStatus: 'Completed',
        lastError: null,
        runningLockUntil: null,
      };
    },
    async updateBySchedulerKeyAndUserId() {
      return null;
    },
  };
  service.schedulerConfigRepository = {
    async createIfMissing() {
      return {
        key: 'risk-recompute-sync',
        name: 'Risk Snapshot Refresh',
        description:
          'Admin-owned scheduler for background risk snapshot refresh and risk-center diagnostics across all user-owned connections.',
        enabled: true,
        cronExpression: '0 1 * * *',
        timezone: 'UTC',
        runAt: '01:00',
        intervalDays: 1,
        batchSize: 200,
        schedulerType: 'user',
        config: {
          sources: ['risk'],
          retentionDays: 30,
        },
        lastStartedAt: runDate,
        lastFinishedAt: finishDate,
        lastStatus: 'Completed',
        lastError: null,
        runningLockUntil: null,
      };
    },
    async updateByKey() {
      return null;
    },
  };
  service.schedulerRunLogRepository = {
    async listRunsBySchedulerKeyAndActor(
      schedulerKey: string,
      actorUserId: string,
      limit: number,
      offset: number
    ) {
      assert.equal(schedulerKey, 'risk-recompute-sync');
      assert.equal(actorUserId, 'admin-1');
      assert.equal(limit, 10);
      assert.equal(offset, 0);
      return {
        items: [
          {
            id: 'risk-run-1',
            schedulerKey,
            status: 'Completed',
            startedAt: runDate,
            finishedAt: finishDate,
            durationMs: 240000,
            processedAccounts: 3,
            insertedAssets: 2,
            updatedAssets: 0,
            skippedAssets: 1,
            errorMessage: null,
            initiatedByType: 'manual',
            initiatedByUserId: 'admin-1',
            initiatedByLabel: 'admin-1',
            executionContext: 'user',
            meta: {
              progress: {
                total: 3,
                processed: 3,
                percent: 100,
                currentItem: {
                  id: 'risk-recompute',
                },
              },
            },
          },
        ],
        total: 1,
      };
    },
    async findByIdAndSchedulerKeyAndActor(runId: string, schedulerKey: string, actorUserId: string) {
      assert.equal(runId, 'risk-run-1');
      assert.equal(schedulerKey, 'risk-recompute-sync');
      assert.equal(actorUserId, 'admin-1');
      return {
        id: 'risk-run-1',
        schedulerKey,
        status: 'Completed',
        startedAt: runDate,
        finishedAt: finishDate,
        durationMs: 240000,
        processedAccounts: 3,
        insertedAssets: 2,
        updatedAssets: 0,
        skippedAssets: 1,
        errorMessage: null,
        initiatedByType: 'manual',
        initiatedByUserId: 'admin-1',
        initiatedByLabel: 'admin-1',
        executionContext: 'user',
        meta: {
          progress: {
            total: 3,
            processed: 3,
            percent: 100,
            currentItem: {
              id: 'risk-recompute',
            },
          },
        },
      };
    },
  };
  service.exchangeAssetUpdateLogRepository = {
    async listByRunLogId(
      runLogId: string,
      limit: number,
      offset: number,
      filters: Record<string, unknown>
    ) {
      assert.equal(runLogId, 'risk-run-1');
      updateQueryFilters.push({ limit, offset, ...filters });
      return {
        items: [
          {
            id: 'update-1',
            runLogId,
            source: 'risk',
            accountId: null,
            connectionId: null,
            actionType: 'partial',
            symbol: 'risk-recompute',
            externalId: null,
            assetId: null,
            message: 'Risk recompute processed 3, succeeded 2, failed 1',
            detail: {
              actorUserId: 'admin-1',
              targetUserIds: ['user-1', 'user-2', 'user-3'],
              processed: 3,
              succeeded: 2,
              failed: 1,
            },
            createdAt: updateDate,
          },
        ],
        total: 1,
      };
    },
  };

  const configResponse = await service.getSchedulerConfig('admin-1');
  assert.equal(configResponse.data.lastStartedAtIso, '2026-04-11T01:00:00.000Z');
  assert.equal(configResponse.data.lastFinishedAtIso, '2026-04-11T01:04:00.000Z');

  const runsResponse = await service.listSchedulerRuns('admin-1', {
    limit: '10',
    offset: '0',
  });
  assert.equal(runsResponse.data.items[0].initiatedBy?.type, 'manual');
  assert.equal(runsResponse.data.items[0].initiatedBy?.userId, 'admin-1');
  assert.equal(runsResponse.data.items[0].executionContext, 'user');
  assert.equal(runsResponse.data.items[0].startedAtIso, '2026-04-11T01:00:00.000Z');
  assert.equal(runsResponse.data.items[0].finishedAtIso, '2026-04-11T01:04:00.000Z');
  assert.equal(runsResponse.data.items[0].progress?.currentItem?.id, 'risk-recompute');

  const progressResponse = await service.getSchedulerRunProgress('admin-1', 'risk-run-1');
  assert.equal(progressResponse.data.run?.initiatedBy?.label, 'admin-1');
  assert.equal(progressResponse.data.run?.executionContext, 'user');
  assert.equal(progressResponse.data.run?.progress?.currentItem?.id, 'risk-recompute');

  const updatesResponse = await service.listSchedulerRunUpdates('admin-1', 'risk-run-1', {
    limit: '25',
    offset: '0',
    actionType: 'partial',
    source: 'risk',
    symbol: 'risk-recompute',
  });
  assert.equal(updatesResponse.data.items[0].initiatedBy?.type, 'manual');
  assert.equal(updatesResponse.data.items[0].executionContext, 'user');
  assert.equal(updatesResponse.data.items[0].createdAtIso, '2026-04-11T01:02:00.000Z');
  assert.deepEqual(
    (updatesResponse.data.items[0].detail as Record<string, unknown>)?.targetUserIds,
    ['user-1', 'user-2', 'user-3']
  );
  assert.deepEqual(updateQueryFilters[0], {
    limit: 25,
    offset: 0,
    actionType: 'partial',
    source: 'risk',
    symbol: 'risk-recompute',
    sortBy: 'createdAt',
    sortOrder: 'desc',
  });

  const exportResponse = await service.exportSchedulerRunUpdates('admin-1', 'risk-run-1', {
    actionType: 'partial',
    source: 'risk',
    symbol: 'risk-recompute',
  });
  assert.equal(exportResponse.data.fileName, 'scheduler-run-risk-run-1-updates.csv');
  assert.equal(exportResponse.data.rowCount, 1);
  assert.equal(exportResponse.data.csv.includes('initiatedByType'), true);
  assert.equal(exportResponse.data.csv.includes('executionContext'), true);
  assert.equal(exportResponse.data.csv.includes('createdAtIso'), true);
  assert.equal(exportResponse.data.csv.includes('admin-1'), true);
  assert.equal(exportResponse.data.csv.includes('partial'), true);
}

async function runWorkerPartialFailureAssertions(): Promise<void> {
  const SchedulerExecutionService = await loadWorkerSchedulerExecutionService();
  const executionService = new SchedulerExecutionService() as any;
  const progressUpdates: Array<{ input: Record<string, unknown>; force: boolean | undefined }> = [];
  let requestBody: Record<string, unknown> | null = null;
  let scopeLookup: Record<string, unknown> | null = null;

  executionService.syncStopSignal = async () => {};
  executionService.throwIfStopRequested = () => {};
  executionService.listActorConnectedAccounts = async (
    _connection: unknown,
    _actorUserId: string,
    scope: Record<string, unknown>
  ) => {
    scopeLookup = scope;
    return [
      {
        id: 'account-1',
        userId: 'user-1',
        brokerKey: 'mudrex',
        accountKey: 'mudrex-main',
        settings: null,
        createdAt: '2026-04-10T00:00:00.000Z',
      },
      {
        id: 'account-2',
        userId: 'user-2',
        brokerKey: 'delta_exchange',
        accountKey: 'delta-main',
        settings: null,
        createdAt: '2026-04-10T00:05:00.000Z',
      },
      {
        id: 'account-3',
        userId: 'user-2',
        brokerKey: 'mudrex',
        accountKey: 'mudrex-alt',
        settings: null,
        createdAt: '2026-04-10T00:10:00.000Z',
      },
    ];
  };

  const originalFetch = global.fetch;
  global.fetch = async (_endpoint, options) => {
    requestBody = JSON.parse(String(options?.body || '{}'));
    return {
      ok: true,
      async text() {
        return JSON.stringify({
          data: {
            processed: 2,
            succeeded: 1,
            failed: 1,
            capacityItemsTotal: 4,
            capacityUsersWithCapacity: 1,
            capacityComputedAt: '2026-04-11T01:05:00.000Z',
          },
        });
      },
    } as Response;
  };

  try {
    const summary = await executionService.executeRiskRecomputeSync(
      {},
      'risk-run-1',
      {
        schedulerKey: 'risk-recompute-sync',
        trigger: 'scheduled',
        actorUserId: 'admin-1',
        requestedAt: '2026-04-11T01:00:00.000Z',
      },
      async (input: Record<string, unknown>, force?: boolean) => {
        progressUpdates.push({ input, force });
      }
    );

    assert.deepEqual(scopeLookup, {
      userIds: [],
      brokerKeys: [],
      accountIds: [],
    });
    assert.deepEqual(requestBody, {
      actorUserId: 'admin-1',
      targetUserIds: ['user-1', 'user-2'],
    });
    assert.equal(progressUpdates[0]?.input.total, 2);
    assert.deepEqual(progressUpdates[0]?.input.currentItem, { id: 'risk-recompute' });
    assert.equal(progressUpdates.at(-1)?.input.processed, 2);
    assert.equal(progressUpdates.at(-1)?.input.inserted, 1);
    assert.equal(progressUpdates.at(-1)?.input.skipped, 1);
    assert.equal(summary.processedUnits, 2);
    assert.equal(summary.inserted, 1);
    assert.equal(summary.updated, 0);
    assert.equal(summary.skipped, 1);
    assert.equal(summary.updateLogs[0][5], 'partial');
    assert.equal(String(summary.updateLogs[0][9]).includes('capacity items 4'), true);
    const detail = JSON.parse(String(summary.updateLogs[0][10] || '{}'));
    assert.equal(detail.actorUserId, 'admin-1');
    assert.deepEqual(detail.targetUserIds, ['user-1', 'user-2']);
    assert.equal(detail.failed, 1);
    assert.equal(detail.targetUsers, 2);
    assert.equal(detail.capacityItemsTotal, 4);
    assert.equal(detail.capacityUsersWithCapacity, 1);
    assert.equal(detail.capacityComputedAt, '2026-04-11T01:05:00.000Z');
  } finally {
    global.fetch = originalFetch;
  }
}

async function runWorkerNoTargetSkipAssertions(): Promise<void> {
  const SchedulerExecutionService = await loadWorkerSchedulerExecutionService();
  const executionService = new SchedulerExecutionService() as any;
  const progressUpdates: Array<Record<string, unknown>> = [];
  let fetchCalled = false;

  executionService.syncStopSignal = async () => {};
  executionService.throwIfStopRequested = () => {};
  executionService.listActorConnectedAccounts = async () => [
    {
      id: 'account-system-1',
      userId: null,
      brokerKey: 'mudrex',
      accountKey: 'system-main',
      settings: null,
      createdAt: '2026-04-10T00:00:00.000Z',
    },
    {
      id: 'account-system-2',
      userId: '',
      brokerKey: 'delta_exchange',
      accountKey: 'system-alt',
      settings: null,
      createdAt: '2026-04-10T00:05:00.000Z',
    },
  ];

  const originalFetch = global.fetch;
  global.fetch = async () => {
    fetchCalled = true;
    throw new Error('fetch should not run when no real target users are resolved');
  };

  try {
    const summary = await executionService.executeRiskRecomputeSync(
      {},
      'risk-run-no-targets',
      {
        schedulerKey: 'risk-recompute-sync',
        trigger: 'scheduled',
        actorUserId: 'admin-1',
        requestedAt: '2026-04-11T01:10:00.000Z',
      },
      async (input: Record<string, unknown>) => {
        progressUpdates.push(input);
      }
    );

    assert.equal(fetchCalled, false);
    assert.equal(progressUpdates[0]?.total, 1);
    assert.equal(progressUpdates[0]?.processed, 1);
    assert.equal(summary.processedUnits, 0);
    assert.equal(summary.inserted, 0);
    assert.equal(summary.updated, 0);
    assert.equal(summary.skipped, 0);
    assert.equal(summary.updateLogs[0][5], 'skipped');
    assert.equal(
      String(summary.updateLogs[0][9]),
      'Risk recompute skipped: no real connected target users were resolved'
    );
  } finally {
    global.fetch = originalFetch;
  }
}

function runPhaseFourDocAssertions(): void {
  const findings: string[] = [];

  const phaseDoc = read('RISK_SCHEDULER_PHASE4.md');
  for (const marker of [
    'Phase 4 freezes runtime proof and failure isolation for `risk-recompute-sync`.',
    '`lastStartedAtIso`',
    '`lastFinishedAtIso`',
    '`initiatedBy`',
    '`executionContext`',
    '`createdAtIso`',
    '`currentItem.id`',
    '`partial` update log outcome',
    'Risk recompute skipped: no real connected target users were resolved',
    'Phase 5 should focus on diagnostics summary and blocker truth rather than runtime audit shape.',
  ]) {
    if (!phaseDoc.includes(marker)) {
      findings.push(`RISK_SCHEDULER_PHASE4.md: missing Phase 4 marker ${marker}`);
    }
  }

  const riskSchedulerSource = read('src/api/services/RiskSchedulerService.ts');
  for (const marker of [
    'lastStartedAtIso: formatSchedulerRawIso(config.lastStartedAt)',
    'lastFinishedAtIso: formatSchedulerRawIso(config.lastFinishedAt)',
    'createdAtIso: formatSchedulerRawIso(item.createdAt)',
    'id: String(currentItemRaw.id || \'\').trim()',
    'currentItem: currentItem && Object.keys(currentItem).length ? currentItem : undefined',
  ]) {
    if (!riskSchedulerSource.includes(marker)) {
      findings.push(`RiskSchedulerService.ts: missing Phase 4 runtime marker ${marker}`);
    }
  }

  const workerSource = read('../aurAlphaSchedulerWorker/src/scheduler/services/SchedulerExecutionService.ts');
  for (const marker of [
    "failed > 0 ? 'partial' : 'updated'",
    'Risk recompute skipped: no real connected target users were resolved',
    'capacityItemsTotal',
    'capacityUsersWithCapacity',
    'capacityComputedAt',
    '...(targetUserIds.length > 0 ? { targetUserIds } : {}),',
  ]) {
    if (!workerSource.includes(marker)) {
      findings.push(`Worker SchedulerExecutionService.ts: missing Phase 4 marker ${marker}`);
    }
  }

  const readme = read('README.md');
  if (!readme.includes('RISK_SCHEDULER_PHASE4.md')) {
    findings.push('README.md: missing risk scheduler Phase 4 baseline link');
  }
  if (!readme.includes('test:risk-scheduler')) {
    findings.push('README.md: missing risk scheduler module verification command');
  }
  if (!readme.includes('Phase 4 runtime proof and failure isolation for `risk-recompute-sync`')) {
    findings.push('README.md: missing risk scheduler Phase 4 baseline summary');
  }

  const packageSource = read('package.json');
  if (!packageSource.includes('"test:risk-scheduler"')) {
    findings.push('package.json: missing risk scheduler module test script');
  }
  if (!packageSource.includes('"test:risk-scheduler"')) {
    findings.push('package.json: risk scheduler module guard must stay wired');
  }

  assert.equal(
    findings.length,
    0,
    `Risk scheduler Phase 4 guard failed:\n${findings.join('\n')}`
  );
}

async function main(): Promise<void> {
  await runRiskSchedulerRuntimeAssertions();
  await runWorkerPartialFailureAssertions();
  await runWorkerNoTargetSkipAssertions();
  runPhaseFourDocAssertions();
  console.log('Risk scheduler phase 4 assertions passed.');
}

  await main();
}

async function risk_schedulerGuard05(): Promise<void> {
  const { default: fs } = await import("node:fs");
  const { default: path } = await import("node:path");
  const { RiskSchedulerService } = await import("../src/api/services/RiskSchedulerService");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function createSchedulerConfig() {
  return {
    key: 'risk-recompute-sync',
    name: 'Risk Snapshot Refresh',
    description:
      'Admin-owned scheduler for background risk snapshot refresh and risk-center diagnostics across all user-owned connections.',
    enabled: false,
    cronExpression: '0 1 * * *',
    timezone: 'UTC',
    runAt: '01:00',
    intervalDays: 1,
    batchSize: 200,
    schedulerType: 'user',
    config: {
      sources: ['risk'],
      retentionDays: 30,
    },
  };
}

function createUserConfig() {
  return {
    id: 'risk-user-config-1',
    schedulerKey: 'risk-recompute-sync',
    userId: 'admin-1',
    ...createSchedulerConfig(),
  };
}

async function runRiskDiagnosticsSummaryAssertions(): Promise<void> {
  const service = new RiskSchedulerService() as any;
  const originalDateNow = Date.now;

  Date.now = () => new Date('2026-04-10T10:30:00.000Z').getTime();

  try {
    service.brokerAccountRepository = {
      async getAllActiveBrokerAccounts() {
        return [
          { id: 'acc-1', userId: 'user-1', brokerKey: 'mudrex', status: 'Connected' },
          { id: 'acc-2', userId: 'user-1', brokerKey: 'delta_exchange', status: 'Idle' },
          { id: 'acc-3', userId: 'user-2', brokerKey: 'mudrex', status: 'Connected' },
          { id: 'acc-4', userId: 'user-3', brokerKey: 'binance', status: 'Connected' },
          { id: 'acc-system', userId: null, brokerKey: 'mudrex', status: 'Connected' },
        ];
      },
    };
    service.schedulerRunLogRepository = {
      async listRunsBySchedulerKeyAndActor(
        schedulerKey: string,
        actorUserId: string,
        limit: number,
        offset: number
      ) {
        assert.equal(schedulerKey, 'risk-recompute-sync');
        assert.equal(actorUserId, 'admin-1');
        assert.equal(limit, 1);
        assert.equal(offset, 0);
        return {
          items: [
            {
              id: 'run-1',
              status: 'Completed',
              initiatedByType: 'cron',
              initiatedByUserId: 'admin-1',
              initiatedByLabel: 'admin-1',
              executionContext: 'user',
              startedAt: new Date('2026-04-10T10:00:00.000Z'),
              finishedAt: new Date('2026-04-10T10:08:00.000Z'),
              processedAccounts: 3,
              insertedAssets: 2,
              skippedAssets: 1,
            },
          ],
          total: 1,
        };
      },
    };
    service.schedulerUserConfigRepository = {
      async createIfMissing(payload: Record<string, unknown>) {
        assert.equal(payload.schedulerKey, 'risk-recompute-sync');
        assert.equal(payload.userId, 'admin-1');
        return createUserConfig();
      },
      async updateBySchedulerKeyAndUserId() {
        return null;
      },
    };
    service.schedulerConfigRepository = {
      async createIfMissing() {
        return createSchedulerConfig();
      },
      async updateByKey() {
        return null;
      },
    };
    service.userTimeZoneService = {
      async resolveUserTimeZone(userId: string) {
        assert.equal(userId, 'admin-1');
        return 'UTC';
      },
    };
    service.riskRepository = {
      async listLatestSnapshotsForUsers(userIds: string[]) {
        assert.deepEqual(userIds, ['user-1', 'user-2', 'user-3']);
        return new Map([
          [
            'user-1',
            {
              userId: 'user-1',
              snapshotId: 'snap-1',
              createdAt: new Date('2026-04-10T10:00:00.000Z'),
            },
          ],
          [
            'user-3',
            {
              userId: 'user-3',
              snapshotId: 'snap-3',
              createdAt: new Date('2026-04-10T10:20:00.000Z'),
            },
          ],
        ]);
      },
    };
    service.riskControlRepository = {
      async getLatestCreatedAtForUsers(userIds: string[]) {
        assert.deepEqual(userIds, ['user-1', 'user-2', 'user-3']);
        return new Date('2026-04-10T10:21:00.000Z');
      },
    };
    service.riskAlertRepository = {
      async getLatestCreatedAtForUsers(userIds: string[]) {
        assert.deepEqual(userIds, ['user-1', 'user-2', 'user-3']);
        return new Date('2026-04-10T10:22:00.000Z');
      },
    };
    service.riskScenarioRepository = {
      async getLatestCreatedAtForUsers(userIds: string[]) {
        assert.deepEqual(userIds, ['user-1', 'user-2', 'user-3']);
        return new Date('2026-04-10T10:23:00.000Z');
      },
    };
    service.fundsSnapshotRepository = {
      async getLatestSnapshot(userId: string, brokerKey: string, accountId: string) {
        const key = `${userId}:${brokerKey}:${accountId}`;
        switch (key) {
          case 'user-1:mudrex:acc-1':
            return {
              computed_at: new Date('2026-04-10T09:55:00.000Z'),
              created_at: new Date('2026-04-10T09:55:00.000Z'),
            };
          case 'user-1:delta_exchange:acc-2':
            return {
              computed_at: new Date('2026-04-10T10:10:00.000Z'),
              created_at: new Date('2026-04-10T10:10:00.000Z'),
            };
          case 'user-3:binance:acc-4':
            return {
              computed_at: new Date('2026-04-10T10:18:00.000Z'),
              created_at: new Date('2026-04-10T10:18:00.000Z'),
            };
          default:
            return null;
        }
      },
    };
    service.positionSnapshotRepository = {
      async getAccountOpenPositionSummary(userId: string, accountIds: string[]) {
        if (userId === 'user-1') {
          assert.deepEqual(accountIds, ['acc-1', 'acc-2']);
          return new Map([
            [
              'acc-1',
              {
                accountId: 'acc-1',
                openPositions: 2,
                observedAt: new Date('2026-04-10T09:50:00.000Z'),
                hasSnapshotHistory: true,
              },
            ],
            [
              'acc-2',
              {
                accountId: 'acc-2',
                openPositions: 1,
                observedAt: new Date('2026-04-10T10:15:00.000Z'),
                hasSnapshotHistory: true,
              },
            ],
          ]);
        }
        if (userId === 'user-2') {
          assert.deepEqual(accountIds, ['acc-3']);
          return new Map([
            [
              'acc-3',
              {
                accountId: 'acc-3',
                openPositions: 0,
                observedAt: null,
                hasSnapshotHistory: false,
              },
            ],
          ]);
        }
        assert.deepEqual(accountIds, ['acc-4']);
        return new Map([
          [
            'acc-4',
            {
              accountId: 'acc-4',
              openPositions: 1,
              observedAt: new Date('2026-04-10T10:19:00.000Z'),
              hasSnapshotHistory: true,
            },
          ],
        ]);
      },
    };

    const response = await service.getSchedulerDiagnosticsSummary('admin-1');

    assert.equal(response.data.schedulerKey, 'risk-recompute-sync');
    assert.equal(response.data.usersTargeted, 3);
    assert.equal(response.data.usersWithFreshSnapshot, 1);
    assert.equal(response.data.usersMissingSnapshot, 1);
    assert.equal(response.data.usersWithSourceBlockers, 2);
    assert.match(String(response.data.latestSnapshotAt || ''), /^2026-04-10T10:20:00/);
    assert.equal(response.data.latestSnapshotAgeMinutes, 10);
    assert.match(String(response.data.latestControlAt || ''), /^2026-04-10T10:21:00/);
    assert.match(String(response.data.latestAlertAt || ''), /^2026-04-10T10:22:00/);
    assert.match(String(response.data.latestScenarioAt || ''), /^2026-04-10T10:23:00/);
    assert.equal(response.data.latestRun?.id, 'run-1');
    assert.equal(response.data.latestRun?.status, 'Completed');
    assert.deepEqual(response.data.latestRun?.initiatedBy, {
      type: 'cron',
      userId: 'admin-1',
      label: 'admin-1',
    });
    assert.equal(response.data.latestRun?.executionContext, 'user');
    assert.match(String(response.data.latestRun?.startedAt || ''), /^2026-04-10T10:00:00/);
    assert.match(String(response.data.latestRun?.finishedAt || ''), /^2026-04-10T10:08:00/);
    assert.equal(response.data.latestRun?.targetedUsers, 3);
    assert.equal(response.data.latestRun?.refreshedUsers, 2);
    assert.equal(response.data.latestRun?.failedUsers, 1);
    assert.deepEqual(response.data.blockers, [
      {
        blocker: 'missing_snapshot',
        label: 'Missing risk snapshot',
        count: 1,
      },
      {
        blocker: 'missing_funds_snapshot',
        label: 'Missing funds snapshot coverage',
        count: 1,
      },
      {
        blocker: 'missing_positions_snapshot',
        label: 'Missing positions snapshot coverage',
        count: 1,
      },
      {
        blocker: 'stale_snapshot',
        label: 'Risk snapshot is behind source snapshots',
        count: 1,
      },
    ]);
  } finally {
    Date.now = originalDateNow;
  }
}

async function runRiskDiagnosticsSummaryNoTargetsAssertions(): Promise<void> {
  const service = new RiskSchedulerService() as any;
  let snapshotCalls = 0;
  let controlCalls = 0;
  let alertCalls = 0;
  let scenarioCalls = 0;

  service.brokerAccountRepository = {
    async getAllActiveBrokerAccounts() {
      return [
        { id: 'acc-system-1', userId: null, brokerKey: 'mudrex', status: 'Connected' },
        { id: 'acc-system-2', userId: '', brokerKey: 'delta_exchange', status: 'Idle' },
      ];
    },
  };
  service.schedulerRunLogRepository = {
    async listRunsBySchedulerKeyAndActor(
      schedulerKey: string,
      actorUserId: string,
      limit: number,
      offset: number
    ) {
      assert.equal(schedulerKey, 'risk-recompute-sync');
      assert.equal(actorUserId, 'admin-1');
      assert.equal(limit, 1);
      assert.equal(offset, 0);
      return {
        items: [
          {
            id: 'run-empty',
            status: 'Completed',
            initiatedByType: 'manual',
            initiatedByUserId: 'admin-1',
            initiatedByLabel: 'admin-1',
            executionContext: 'user',
            startedAt: new Date('2026-04-10T09:00:00.000Z'),
            finishedAt: new Date('2026-04-10T09:01:00.000Z'),
            processedAccounts: 0,
            insertedAssets: 0,
            skippedAssets: 0,
          },
        ],
        total: 1,
      };
    },
  };
  service.schedulerUserConfigRepository = {
    async createIfMissing() {
      return createUserConfig();
    },
    async updateBySchedulerKeyAndUserId() {
      return null;
    },
  };
  service.schedulerConfigRepository = {
    async createIfMissing() {
      return createSchedulerConfig();
    },
    async updateByKey() {
      return null;
    },
  };
  service.userTimeZoneService = {
    async resolveUserTimeZone(userId: string) {
      assert.equal(userId, 'admin-1');
      return 'UTC';
    },
  };
  service.riskRepository = {
    async listLatestSnapshotsForUsers() {
      snapshotCalls += 1;
      return new Map();
    },
  };
  service.riskControlRepository = {
    async getLatestCreatedAtForUsers() {
      controlCalls += 1;
      return null;
    },
  };
  service.riskAlertRepository = {
    async getLatestCreatedAtForUsers() {
      alertCalls += 1;
      return null;
    },
  };
  service.riskScenarioRepository = {
    async getLatestCreatedAtForUsers() {
      scenarioCalls += 1;
      return null;
    },
  };
  service.fundsSnapshotRepository = {
    async getLatestSnapshot() {
      throw new Error('funds snapshots should not be read when there are no targeted users');
    },
  };
  service.positionSnapshotRepository = {
    async getAccountOpenPositionSummary() {
      throw new Error('position snapshots should not be read when there are no targeted users');
    },
  };

  const response = await service.getSchedulerDiagnosticsSummary('admin-1');

  assert.equal(snapshotCalls, 0);
  assert.equal(controlCalls, 0);
  assert.equal(alertCalls, 0);
  assert.equal(scenarioCalls, 0);
  assert.equal(response.data.usersTargeted, 0);
  assert.equal(response.data.usersWithFreshSnapshot, 0);
  assert.equal(response.data.usersMissingSnapshot, 0);
  assert.equal(response.data.usersWithSourceBlockers, 0);
  assert.equal(response.data.latestSnapshotAt, undefined);
  assert.equal(response.data.latestSnapshotAgeMinutes, undefined);
  assert.equal(response.data.latestControlAt, undefined);
  assert.equal(response.data.latestAlertAt, undefined);
  assert.equal(response.data.latestScenarioAt, undefined);
  assert.deepEqual(response.data.blockers, []);
  assert.equal(response.data.latestRun?.id, 'run-empty');
  assert.equal(response.data.latestRun?.status, 'Completed');
  assert.deepEqual(response.data.latestRun?.initiatedBy, {
    type: 'manual',
    userId: 'admin-1',
    label: 'admin-1',
  });
  assert.equal(response.data.latestRun?.executionContext, 'user');
  assert.match(String(response.data.latestRun?.startedAt || ''), /^2026-04-10T09:00:00/);
  assert.match(String(response.data.latestRun?.finishedAt || ''), /^2026-04-10T09:01:00/);
  assert.equal(response.data.latestRun?.targetedUsers, 0);
  assert.equal(response.data.latestRun?.refreshedUsers, 0);
  assert.equal(response.data.latestRun?.failedUsers, 0);
}

function runPhaseFiveDocAssertions(): void {
  const findings: string[] = [];

  const phaseDoc = read('RISK_SCHEDULER_PHASE5.md');
  for (const marker of [
    'Phase 5 freezes diagnostics summary and blocker truth for `risk-recompute-sync`.',
    '`usersTargeted`',
    '`usersWithFreshSnapshot`',
    '`usersMissingSnapshot`',
    '`usersWithSourceBlockers`',
    '`latestRun.initiatedBy`',
    '`latestRun.executionContext`',
    'zero-target diagnostics summaries skip downstream snapshot lookups',
    'Phase 6 should focus on localized display rendering for diagnostics timestamps rather than changing diagnostics truth fields.',
  ]) {
    if (!phaseDoc.includes(marker)) {
      findings.push(`RISK_SCHEDULER_PHASE5.md: missing Phase 5 marker ${marker}`);
    }
  }

  const contractSource = read('src/api/contracts/Scheduler.ts');
  for (const marker of [
    'export interface SchedulerRiskDiagnosticsLatestRunSummary {',
    'initiatedBy?: SchedulerInitiator;',
    'executionContext?: SchedulerExecutionContext;',
    'usersTargeted: number;',
    'usersWithFreshSnapshot: number;',
    'usersMissingSnapshot: number;',
    'usersWithSourceBlockers: number;',
  ]) {
    if (!contractSource.includes(marker)) {
      findings.push(`Scheduler.ts: missing Phase 5 diagnostics marker ${marker}`);
    }
  }

  const serviceSource = read('src/api/services/RiskSchedulerService.ts');
  for (const marker of [
    'const targetUsers = await this.listRiskTargetUsers();',
    'if (userIds.length > 0) {',
    'const latestRunAudit = latestRun',
    'initiatedBy: latestRunAudit.initiatedBy',
    'executionContext: latestRunAudit.executionContext',
    'usersWithSourceBlockers: coverage.filter((item) => item.blockers.size > 0).length',
  ]) {
    if (!serviceSource.includes(marker)) {
      findings.push(`RiskSchedulerService.ts: missing Phase 5 summary marker ${marker}`);
    }
  }

  const healthSource = read('scripts/checks/check-risk-scheduler-health.ts');
  for (const marker of [
    'const latestRunInitiatedBy = asRecord(latestRun.initiatedBy);',
    'latest risk scheduler run initiatedBy must expose type when present',
    'executionContext: readNullableString(latestRun.executionContext),',
    'blockers: blockers.map((item) => ({',
  ]) {
    if (!healthSource.includes(marker)) {
      findings.push(`check-risk-scheduler-health.ts: missing Phase 5 diagnostics marker ${marker}`);
    }
  }

  const readme = read('README.md');
  if (!readme.includes('RISK_SCHEDULER_PHASE5.md')) {
    findings.push('README.md: missing risk scheduler Phase 5 baseline link');
  }
  if (!readme.includes('test:risk-scheduler')) {
    findings.push('README.md: missing risk scheduler module verification command');
  }
  if (!readme.includes('Phase 5 diagnostics summary and blocker truth for `risk-recompute-sync`')) {
    findings.push('README.md: missing risk scheduler Phase 5 baseline summary');
  }

  const packageSource = read('package.json');
  if (!packageSource.includes('"test:risk-scheduler"')) {
    findings.push('package.json: missing risk scheduler module test script');
  }
  if (!packageSource.includes('"test:risk-scheduler"')) {
    findings.push('package.json: risk scheduler module guard must stay wired');
  }

  assert.equal(
    findings.length,
    0,
    `Risk scheduler Phase 5 guard failed:\n${findings.join('\n')}`
  );
}

async function main(): Promise<void> {
  await runRiskDiagnosticsSummaryAssertions();
  await runRiskDiagnosticsSummaryNoTargetsAssertions();
  runPhaseFiveDocAssertions();
  console.log('Risk scheduler phase 5 assertions passed.');
}

  await main();
}

async function risk_schedulerGuard06(): Promise<void> {
  const { default: fs } = await import("node:fs");
  const { default: path } = await import("node:path");
  const { RiskSchedulerService } = await import("../src/api/services/RiskSchedulerService");
  const { formatSchedulerDisplayTime, formatSchedulerRawIso, } = await import("../src/api/utils/schedulerTimeContract");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function createSchedulerConfig(timezone = 'Asia/Calcutta') {
  return {
    key: 'risk-recompute-sync',
    name: 'Risk Snapshot Refresh',
    description:
      'Admin-owned scheduler for background risk snapshot refresh and risk-center diagnostics across all user-owned connections.',
    enabled: true,
    cronExpression: '0 1 * * *',
    timezone,
    runAt: '01:00',
    intervalDays: 1,
    batchSize: 200,
    schedulerType: 'user',
    config: {
      sources: ['risk'],
      retentionDays: 30,
    },
  };
}

function createUserConfig(timezone = 'Asia/Calcutta') {
  return {
    id: 'risk-user-config-1',
    schedulerKey: 'risk-recompute-sync',
    userId: 'admin-1',
    ...createSchedulerConfig(timezone),
  };
}

async function runRiskDiagnosticsTimezoneAssertions(): Promise<void> {
  const service = new RiskSchedulerService() as any;
  const timeZone = 'Asia/Calcutta';
  const latestSnapshotAt = new Date('2026-04-10T10:20:00.000Z');
  const latestControlAt = new Date('2026-04-10T10:21:00.000Z');
  const latestAlertAt = new Date('2026-04-10T10:22:00.000Z');
  const latestScenarioAt = new Date('2026-04-10T10:23:00.000Z');
  const runStartedAt = new Date('2026-04-10T10:00:00.000Z');
  const runFinishedAt = new Date('2026-04-10T10:08:00.000Z');
  const originalDateNow = Date.now;

  Date.now = () => new Date('2026-04-10T10:30:00.000Z').getTime();

  try {
    service.brokerAccountRepository = {
      async getAllActiveBrokerAccounts() {
        return [
          { id: 'acc-1', userId: 'user-1', brokerKey: 'mudrex', status: 'Connected' },
          { id: 'acc-system', userId: null, brokerKey: 'mudrex', status: 'Connected' },
        ];
      },
    };
    service.schedulerRunLogRepository = {
      async listRunsBySchedulerKeyAndActor(
        schedulerKey: string,
        actorUserId: string,
        limit: number,
        offset: number
      ) {
        assert.equal(schedulerKey, 'risk-recompute-sync');
        assert.equal(actorUserId, 'admin-1');
        assert.equal(limit, 1);
        assert.equal(offset, 0);
        return {
          items: [
            {
              id: 'run-1',
              status: 'Completed',
              initiatedByType: 'manual',
              initiatedByUserId: 'admin-1',
              initiatedByLabel: 'admin-1',
              executionContext: 'user',
              startedAt: runStartedAt,
              finishedAt: runFinishedAt,
              processedAccounts: 1,
              insertedAssets: 1,
              skippedAssets: 0,
            },
          ],
          total: 1,
        };
      },
    };
    service.schedulerUserConfigRepository = {
      async createIfMissing(payload: Record<string, unknown>) {
        assert.equal(payload.schedulerKey, 'risk-recompute-sync');
        assert.equal(payload.userId, 'admin-1');
        return createUserConfig(timeZone);
      },
      async updateBySchedulerKeyAndUserId() {
        return null;
      },
    };
    service.schedulerConfigRepository = {
      async createIfMissing() {
        return createSchedulerConfig(timeZone);
      },
      async updateByKey() {
        return null;
      },
    };
    service.userTimeZoneService = {
      async resolveUserTimeZone(userId: string) {
        assert.equal(userId, 'admin-1');
        return timeZone;
      },
    };
    service.riskRepository = {
      async listLatestSnapshotsForUsers(userIds: string[]) {
        assert.deepEqual(userIds, ['user-1']);
        return new Map([
          [
            'user-1',
            {
              userId: 'user-1',
              snapshotId: 'snap-1',
              createdAt: latestSnapshotAt,
            },
          ],
        ]);
      },
    };
    service.riskControlRepository = {
      async getLatestCreatedAtForUsers(userIds: string[]) {
        assert.deepEqual(userIds, ['user-1']);
        return latestControlAt;
      },
    };
    service.riskAlertRepository = {
      async getLatestCreatedAtForUsers(userIds: string[]) {
        assert.deepEqual(userIds, ['user-1']);
        return latestAlertAt;
      },
    };
    service.riskScenarioRepository = {
      async getLatestCreatedAtForUsers(userIds: string[]) {
        assert.deepEqual(userIds, ['user-1']);
        return latestScenarioAt;
      },
    };
    service.fundsSnapshotRepository = {
      async getLatestSnapshot(userId: string, brokerKey: string, accountId: string) {
        assert.equal(userId, 'user-1');
        assert.equal(brokerKey, 'mudrex');
        assert.equal(accountId, 'acc-1');
        return {
          computed_at: new Date('2026-04-10T10:18:00.000Z'),
          created_at: new Date('2026-04-10T10:18:00.000Z'),
        };
      },
    };
    service.positionSnapshotRepository = {
      async getAccountOpenPositionSummary(userId: string, accountIds: string[]) {
        assert.equal(userId, 'user-1');
        assert.deepEqual(accountIds, ['acc-1']);
        return new Map([
          [
            'acc-1',
            {
              accountId: 'acc-1',
              openPositions: 1,
              observedAt: new Date('2026-04-10T10:19:00.000Z'),
              hasSnapshotHistory: true,
            },
          ],
        ]);
      },
    };

    const response = await service.getSchedulerDiagnosticsSummary('admin-1');

    assert.equal(response.data.time?.displayTimeZone, timeZone);
    assert.equal(response.data.time?.storageTimeZone, 'UTC');
    assert.equal(response.data.usersTargeted, 1);
    assert.equal(response.data.usersWithFreshSnapshot, 1);
    assert.equal(response.data.usersMissingSnapshot, 0);
    assert.equal(response.data.usersWithSourceBlockers, 0);
    assert.equal(
      response.data.latestSnapshotAt,
      formatSchedulerDisplayTime(latestSnapshotAt, timeZone)
    );
    assert.equal(response.data.latestSnapshotAtIso, formatSchedulerRawIso(latestSnapshotAt));
    assert.equal(
      response.data.latestControlAt,
      formatSchedulerDisplayTime(latestControlAt, timeZone)
    );
    assert.equal(response.data.latestControlAtIso, formatSchedulerRawIso(latestControlAt));
    assert.equal(
      response.data.latestAlertAt,
      formatSchedulerDisplayTime(latestAlertAt, timeZone)
    );
    assert.equal(response.data.latestAlertAtIso, formatSchedulerRawIso(latestAlertAt));
    assert.equal(
      response.data.latestScenarioAt,
      formatSchedulerDisplayTime(latestScenarioAt, timeZone)
    );
    assert.equal(response.data.latestScenarioAtIso, formatSchedulerRawIso(latestScenarioAt));
    assert.equal(
      response.data.latestRun?.startedAt,
      formatSchedulerDisplayTime(runStartedAt, timeZone)
    );
    assert.equal(response.data.latestRun?.startedAtIso, formatSchedulerRawIso(runStartedAt));
    assert.equal(
      response.data.latestRun?.finishedAt,
      formatSchedulerDisplayTime(runFinishedAt, timeZone)
    );
    assert.equal(response.data.latestRun?.finishedAtIso, formatSchedulerRawIso(runFinishedAt));
    assert.deepEqual(response.data.latestRun?.initiatedBy, {
      type: 'manual',
      userId: 'admin-1',
      label: 'admin-1',
    });
    assert.equal(response.data.latestRun?.executionContext, 'user');
    assert.deepEqual(response.data.blockers, []);
  } finally {
    Date.now = originalDateNow;
  }
}

async function runRiskDiagnosticsTimezoneNoTargetAssertions(): Promise<void> {
  const service = new RiskSchedulerService() as any;
  const timeZone = 'Asia/Calcutta';
  const runStartedAt = new Date('2026-04-10T09:00:00.000Z');
  const runFinishedAt = new Date('2026-04-10T09:01:00.000Z');

  service.brokerAccountRepository = {
    async getAllActiveBrokerAccounts() {
      return [
        { id: 'acc-system-1', userId: null, brokerKey: 'mudrex', status: 'Connected' },
        { id: 'acc-system-2', userId: '', brokerKey: 'delta_exchange', status: 'Idle' },
      ];
    },
  };
  service.schedulerRunLogRepository = {
    async listRunsBySchedulerKeyAndActor() {
      return {
        items: [
          {
            id: 'run-empty',
            status: 'Completed',
            initiatedByType: 'cron',
            executionContext: 'user',
            startedAt: runStartedAt,
            finishedAt: runFinishedAt,
            processedAccounts: 0,
            insertedAssets: 0,
            skippedAssets: 0,
          },
        ],
        total: 1,
      };
    },
  };
  service.schedulerUserConfigRepository = {
    async createIfMissing() {
      return createUserConfig(timeZone);
    },
    async updateBySchedulerKeyAndUserId() {
      return null;
    },
  };
  service.schedulerConfigRepository = {
    async createIfMissing() {
      return createSchedulerConfig(timeZone);
    },
    async updateByKey() {
      return null;
    },
  };
  service.userTimeZoneService = {
    async resolveUserTimeZone() {
      return timeZone;
    },
  };
  service.riskRepository = {
    async listLatestSnapshotsForUsers() {
      throw new Error('no-target timezone assertions should not load risk snapshots');
    },
  };
  service.riskControlRepository = {
    async getLatestCreatedAtForUsers() {
      throw new Error('no-target timezone assertions should not load risk controls');
    },
  };
  service.riskAlertRepository = {
    async getLatestCreatedAtForUsers() {
      throw new Error('no-target timezone assertions should not load risk alerts');
    },
  };
  service.riskScenarioRepository = {
    async getLatestCreatedAtForUsers() {
      throw new Error('no-target timezone assertions should not load risk scenarios');
    },
  };

  const response = await service.getSchedulerDiagnosticsSummary('admin-1');

  assert.equal(response.data.time?.displayTimeZone, timeZone);
  assert.equal(response.data.usersTargeted, 0);
  assert.equal(response.data.latestSnapshotAt, undefined);
  assert.equal(response.data.latestSnapshotAtIso, undefined);
  assert.equal(
    response.data.latestRun?.startedAt,
    formatSchedulerDisplayTime(runStartedAt, timeZone)
  );
  assert.equal(response.data.latestRun?.startedAtIso, formatSchedulerRawIso(runStartedAt));
  assert.equal(
    response.data.latestRun?.finishedAt,
    formatSchedulerDisplayTime(runFinishedAt, timeZone)
  );
  assert.equal(response.data.latestRun?.finishedAtIso, formatSchedulerRawIso(runFinishedAt));
}

async function run(): Promise<void> {
  const findings: string[] = [];

  await runRiskDiagnosticsTimezoneAssertions();
  await runRiskDiagnosticsTimezoneNoTargetAssertions();

  const phaseDoc = read('RISK_SCHEDULER_PHASE6.md');
  for (const marker of [
    'Phase 6 localizes diagnostics display timestamps for `risk-recompute-sync`.',
    '`latestSnapshotAt` plus `latestSnapshotAtIso`',
    '`latestRun.startedAt` plus `latestRun.startedAtIso`',
    '`time.displayTimeZone`',
    '`Asia/Calcutta`',
    'Phase 8 and final signoff must keep this timezone contract in the release gate.',
  ]) {
    if (!phaseDoc.includes(marker)) {
      findings.push(`RISK_SCHEDULER_PHASE6.md: missing Phase 6 marker ${marker}`);
    }
  }

  const readme = read('README.md');
  if (!readme.includes('RISK_SCHEDULER_PHASE6.md')) {
    findings.push('README.md: missing risk scheduler Phase 6 baseline link');
  }
  if (!readme.includes('test:risk-scheduler')) {
    findings.push('README.md: missing risk scheduler module verification command');
  }

  const packageSource = read('package.json');
  if (!packageSource.includes('"test:risk-scheduler"')) {
    findings.push('package.json: missing risk scheduler module test script');
  }
  if (!packageSource.includes('"test:risk-scheduler"')) {
    findings.push('package.json: risk scheduler module guard must stay wired');
  }

  const serviceSource = read('src/api/services/RiskSchedulerService.ts');
  for (const marker of [
    'latestSnapshotAtIso',
    'latestControlAtIso',
    'latestAlertAtIso',
    'latestScenarioAtIso',
    'startedAtIso',
    'finishedAtIso',
    'time: buildSchedulerTimeContract(timeZone)',
  ]) {
    if (!serviceSource.includes(marker)) {
      findings.push(`RiskSchedulerService.ts: missing Phase 6 marker ${marker}`);
    }
  }

  const healthSource = read('scripts/checks/check-risk-scheduler-health.ts');
  for (const marker of [
    "assertTimeContract('risk scheduler summary'",
    'summaryDisplayTimeZone',
    'latestSnapshotAtIso',
    'startedAtIso',
    'finishedAtIso',
  ]) {
    if (!healthSource.includes(marker)) {
      findings.push(`check-risk-scheduler-health.ts: missing Phase 6 marker ${marker}`);
    }
  }

  const releaseGateSource = read('scripts/release-gates/release-gate-risk-scheduler.ts');
  for (const marker of ['backend-risk-scheduler-suite', 'test:risk-scheduler']) {
    if (!releaseGateSource.includes(marker)) {
      findings.push(`release-gate-risk-scheduler.ts: missing Phase 6 marker ${marker}`);
    }
  }

  const signoffSource = read('scripts/signoffs/signoff-risk-scheduler.ts');
  if (!signoffSource.includes('backend-risk-scheduler-suite')) {
    findings.push('signoff-risk-scheduler.ts: missing Phase 6 gate requirement');
  }

  assert.equal(
    findings.length,
    0,
    `Risk scheduler Phase 6 guard failed:\n${findings.join('\n')}`
  );
  console.log('Risk scheduler phase 6 assertions passed.');
}

  await run();
}

async function risk_schedulerGuard08(): Promise<void> {
  const { mkdtemp, readFile, rm, writeFile } = await import("node:fs/promises");
  const { default: os } = await import("node:os");
  const { default: path } = await import("node:path");
  const { spawnSync } = await import("node:child_process");
  const { RiskSchedulerController } = await import("../src/api/controllers/RiskSchedulerController");

function createSuccess<T>(data: T) {
  return { success: true as const, data };
}

const adminAuthReq = { authUser: { sub: 'user-1', role: 'admin' } } as any;
const authReq = { authUser: { sub: 'user-1', role: 'user' } } as any;
const unauthReq = {} as any;

async function assertAdminRoleRequired(
  run: () => Promise<unknown>,
  message = 'Admin role is required'
): Promise<void> {
  await assert.rejects(
    run,
    (error: unknown) =>
      error instanceof Error &&
      error.message === message &&
      (error as { httpCode?: number }).httpCode === 403
  );
}

async function assertAuthRequired(
  run: () => Promise<unknown>,
  message = 'Authentication required'
): Promise<void> {
  await assert.rejects(
    run,
    (error: unknown) =>
      error instanceof Error &&
      error.message === message &&
      (error as { httpCode?: number }).httpCode === 401
  );
}

async function testRiskSchedulerControllerStaysAdminOnly(): Promise<void> {
  const controller = new RiskSchedulerController() as any;
  const calls: Array<{ method: string; args: unknown[] }> = [];

  controller.riskSchedulerService = {
    async getSchedulerConfig(...args: unknown[]) {
      calls.push({ method: 'getSchedulerConfig', args });
      return createSuccess({ args });
    },
    async updateSchedulerConfig(...args: unknown[]) {
      calls.push({ method: 'updateSchedulerConfig', args });
      return createSuccess({ args });
    },
    async runNow(...args: unknown[]) {
      calls.push({ method: 'runNow', args });
      return createSuccess({ args });
    },
    async pauseScheduler(...args: unknown[]) {
      calls.push({ method: 'pauseScheduler', args });
      return createSuccess({ args });
    },
    async resumeScheduler(...args: unknown[]) {
      calls.push({ method: 'resumeScheduler', args });
      return createSuccess({ args });
    },
    async stopScheduler(...args: unknown[]) {
      calls.push({ method: 'stopScheduler', args });
      return createSuccess({ args });
    },
    async restartScheduler(...args: unknown[]) {
      calls.push({ method: 'restartScheduler', args });
      return createSuccess({ args });
    },
    async purgeSchedulerLogs(...args: unknown[]) {
      calls.push({ method: 'purgeSchedulerLogs', args });
      return createSuccess({ args });
    },
    async getSchedulerPurgePreview(...args: unknown[]) {
      calls.push({ method: 'getSchedulerPurgePreview', args });
      return createSuccess({ args });
    },
    async getSchedulerDiagnosticsSummary(...args: unknown[]) {
      calls.push({ method: 'getSchedulerDiagnosticsSummary', args });
      return createSuccess({ args });
    },
    async listSchedulerRuns(...args: unknown[]) {
      calls.push({ method: 'listSchedulerRuns', args });
      return createSuccess({ args });
    },
    async getSchedulerRunProgress(...args: unknown[]) {
      calls.push({ method: 'getSchedulerRunProgress', args });
      return createSuccess({ args });
    },
    async listSchedulerRunUpdates(...args: unknown[]) {
      calls.push({ method: 'listSchedulerRunUpdates', args });
      return createSuccess({ args });
    },
    async exportSchedulerRunUpdates(...args: unknown[]) {
      calls.push({ method: 'exportSchedulerRunUpdates', args });
      return createSuccess({ args });
    },
  };

  const cases: Array<{
    label: string;
    method: string;
    args?: unknown[];
    expectedArgs: unknown[];
  }> = [
    { label: 'config', method: 'getConfig', expectedArgs: ['user-1'] },
    {
      label: 'update',
      method: 'updateConfig',
      args: [{ enabled: true }],
      expectedArgs: ['user-1', { enabled: true }],
    },
    { label: 'run', method: 'runNow', expectedArgs: ['user-1'] },
    { label: 'pause', method: 'pause', expectedArgs: ['user-1'] },
    { label: 'resume', method: 'resume', expectedArgs: ['user-1'] },
    { label: 'stop', method: 'stop', expectedArgs: ['user-1'] },
    { label: 'restart', method: 'restart', expectedArgs: ['user-1'] },
    { label: 'purge logs', method: 'purgeLogs', expectedArgs: ['user-1'] },
    { label: 'purge preview', method: 'purgeLogsPreview', expectedArgs: ['user-1'] },
    { label: 'summary', method: 'getSummary', expectedArgs: ['user-1'] },
    {
      label: 'runs',
      method: 'listRuns',
      args: ['10', '5'],
      expectedArgs: ['user-1', { limit: '10', offset: '5' }],
    },
    {
      label: 'run progress',
      method: 'getRunProgress',
      args: ['run-1'],
      expectedArgs: ['user-1', 'run-1'],
    },
    {
      label: 'run updates',
      method: 'listRunUpdates',
      args: ['run-1', '25', '0', 'upsert', 'risk', 'BTCUSDT', 'symbol', 'desc'],
      expectedArgs: [
        'user-1',
        'run-1',
        {
          limit: '25',
          offset: '0',
          actionType: 'upsert',
          source: 'risk',
          symbol: 'BTCUSDT',
          sortBy: 'symbol',
          sortOrder: 'desc',
        },
      ],
    },
    {
      label: 'run updates export',
      method: 'exportRunUpdates',
      args: ['run-1', 'upsert', 'risk', 'BTCUSDT', 'symbol', 'desc'],
      expectedArgs: [
        'user-1',
        'run-1',
        {
          actionType: 'upsert',
          source: 'risk',
          symbol: 'BTCUSDT',
          sortBy: 'symbol',
          sortOrder: 'desc',
        },
      ],
    },
  ];

  for (const testCase of cases) {
    const beforeCalls = calls.length;
    await assertAuthRequired(() => controller[testCase.method](unauthReq, ...(testCase.args || [])));
    assert.equal(
      calls.length,
      beforeCalls,
      `${testCase.label} should not call the service when authentication is missing`
    );

    await assertAdminRoleRequired(() =>
      controller[testCase.method](authReq, ...(testCase.args || []))
    );
    assert.equal(
      calls.length,
      beforeCalls,
      `${testCase.label} should not call the service for non-admin users`
    );

    const response = await controller[testCase.method](adminAuthReq, ...(testCase.args || []));
    assert.deepEqual(
      response.data.args,
      testCase.expectedArgs,
      `${testCase.label} should pass the canonical admin args through`
    );
    assert.equal(
      calls.length,
      beforeCalls + 1,
      `${testCase.label} should call the service exactly once for admin users`
    );
  }
}

async function testFinalSignoffScriptCanProduceReadyArtifact(): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'risk-scheduler-phase8-'));
  const gateFile = path.join(tempDir, 'gate.json');
  const outputFile = path.join(tempDir, 'signoff.json');

  try {
    await writeFile(
      gateFile,
      `${JSON.stringify(
        {
          decision: 'ready',
          startedAt: '2026-04-10T00:00:00.000Z',
          finishedAt: '2026-04-10T00:10:00.000Z',
          liveChecksEnabled: false,
          totals: {
            total: 7,
            passed: 7,
            failed: 0,
            skipped: 0,
          },
          results: [
            'backend-risk-scheduler-suite',
            'backend-risk-center-suite',
            'backend-controllers',
            'backend-operational-audit',
            'backend-risk-scheduler-eslint',
            'frontend-schedulers-risk-ui',
            'frontend-schedulers-risk-eslint',
          ].map((key) => ({
            key,
            label: key,
            status: 'passed',
          })),
        },
        null,
        2
      )}\n`,
      'utf8'
    );

    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'scripts/signoffs/signoff-risk-scheduler.ts'],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          RISK_SCHEDULER_SIGNOFF_GATE_FILE: gateFile,
          RISK_SCHEDULER_SIGNOFF_OUTPUT_FILE: outputFile,
          RISK_SCHEDULER_SIGNOFF_DIAGNOSTICS_VERIFIED: 'true',
          RISK_SCHEDULER_SIGNOFF_PRODUCT_TRUST_VERIFIED: 'true',
          RISK_SCHEDULER_SIGNOFF_RECOMPUTE_WRITES_VERIFIED: 'true',
          RISK_SCHEDULER_SIGNOFF_ACCESS_REVIEW_VERIFIED: 'true',
          RISK_SCHEDULER_SIGNOFF_APPROVER: 'Codex',
        },
        encoding: 'utf8',
      }
    );

    assert.equal(result.status, 0, result.stderr || result.stdout || 'signoff script should succeed');
    const output = JSON.parse(await readFile(outputFile, 'utf8')) as Record<string, unknown>;
    assert.equal(output.decision, 'ready');
    assert.equal(output.approver, 'Codex');
    assert.equal((output.checks as Record<string, unknown>).recomputeWritesVerified, true);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function run(): Promise<void> {
  await testRiskSchedulerControllerStaysAdminOnly();
  await testFinalSignoffScriptCanProduceReadyArtifact();
  console.log('Risk scheduler phase 8 assertions passed.');
}

  await run();
}

const suiteSteps = {
  "01": risk_schedulerGuard01,
  "02": risk_schedulerGuard02,
  "03": risk_schedulerGuard03,
  "04": risk_schedulerGuard04,
  "05": risk_schedulerGuard05,
  "06": risk_schedulerGuard06,
  "08": risk_schedulerGuard08,
} as const;

export async function runRiskSchedulerSuite(): Promise<void> {
  await runSuiteSteps("Risk scheduler module", "scripts/test-risk-scheduler.ts", ["01", "02", "03", "04", "05", "06", "08"]);
  console.log("Risk scheduler module assertions passed.");
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
