import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { RiskSchedulerService } from '../src/api/services/RiskSchedulerService';
import { RiskService } from '../src/api/services/RiskService';
import { env } from '../src/env';

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
  if (!readme.includes('test:risk-scheduler-phase2')) {
    findings.push('README.md: missing risk scheduler Phase 2 verification command');
  }
  if (!readme.includes('Phase 2 admin scheduler surface for `risk-recompute-sync`')) {
    findings.push('README.md: missing risk scheduler Phase 2 baseline summary');
  }

  const packageSource = read('package.json');
  if (!packageSource.includes('"test:risk-scheduler-phase2"')) {
    findings.push('package.json: missing risk scheduler Phase 2 test script');
  }
  if (!packageSource.includes('npm run test:risk-scheduler-phase2')) {
    findings.push('package.json: risk scheduler Phase 2 guard must stay wired');
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

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
