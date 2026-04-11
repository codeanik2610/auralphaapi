import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { RiskSchedulerService } from '../src/api/services/RiskSchedulerService';

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

  const healthSource = read('scripts/check-risk-scheduler-health.ts');
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
  if (!readme.includes('test:risk-scheduler-phase5')) {
    findings.push('README.md: missing risk scheduler Phase 5 verification command');
  }
  if (!readme.includes('Phase 5 diagnostics summary and blocker truth for `risk-recompute-sync`')) {
    findings.push('README.md: missing risk scheduler Phase 5 baseline summary');
  }

  const packageSource = read('package.json');
  if (!packageSource.includes('"test:risk-scheduler-phase5"')) {
    findings.push('package.json: missing risk scheduler Phase 5 test script');
  }
  if (!packageSource.includes('npm run test:risk-scheduler-phase5')) {
    findings.push('package.json: risk scheduler Phase 5 guard must stay wired');
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

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
