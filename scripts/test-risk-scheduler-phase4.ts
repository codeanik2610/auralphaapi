import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { RiskSchedulerService } from '../src/api/services/RiskSchedulerService';

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
  if (!readme.includes('test:risk-scheduler-phase4')) {
    findings.push('README.md: missing risk scheduler Phase 4 verification command');
  }
  if (!readme.includes('Phase 4 runtime proof and failure isolation for `risk-recompute-sync`')) {
    findings.push('README.md: missing risk scheduler Phase 4 baseline summary');
  }

  const packageSource = read('package.json');
  if (!packageSource.includes('"test:risk-scheduler-phase4"')) {
    findings.push('package.json: missing risk scheduler Phase 4 test script');
  }
  if (!packageSource.includes('npm run test:risk-scheduler-phase4')) {
    findings.push('package.json: risk scheduler Phase 4 guard must stay wired');
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

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
