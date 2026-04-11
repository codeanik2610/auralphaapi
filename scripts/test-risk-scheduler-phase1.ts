import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { RiskSchedulerService } from '../src/api/services/RiskSchedulerService';
import { SchedulerOverviewService } from '../src/api/services/SchedulerOverviewService';
import { coreDataSource } from '../src/database/data-source';

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
  if (!readme.includes('test:risk-scheduler-phase1')) {
    findings.push('README.md: missing risk scheduler Phase 1 verification command');
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

  const healthSource = read('scripts/check-risk-scheduler-health.ts');
  if (!healthSource.includes("assert.equal(readString(configData.schedulerType), 'user');")) {
    findings.push('check-risk-scheduler-health.ts: missing user-scoped config assertion');
  }

  const packageSource = read('package.json');
  if (!packageSource.includes('"test:risk-scheduler-phase1"')) {
    findings.push('package.json: missing risk scheduler Phase 1 test script');
  }
  if (!packageSource.includes('npm run test:risk-scheduler-phase1')) {
    findings.push('package.json: risk scheduler Phase 1 guard must stay wired');
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

run().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
