import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { RiskSchedulerService } from '../src/api/services/RiskSchedulerService';
import {
  formatSchedulerDisplayTime,
  formatSchedulerRawIso,
} from '../src/api/utils/schedulerTimeContract';

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
  if (!readme.includes('test:risk-scheduler-phase6')) {
    findings.push('README.md: missing risk scheduler Phase 6 verification command');
  }

  const packageSource = read('package.json');
  if (!packageSource.includes('"test:risk-scheduler-phase6"')) {
    findings.push('package.json: missing risk scheduler Phase 6 test script');
  }
  if (!packageSource.includes('npm run test:risk-scheduler-phase6')) {
    findings.push('package.json: risk scheduler Phase 6 guard must stay wired');
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

  const healthSource = read('scripts/check-risk-scheduler-health.ts');
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

  const releaseGateSource = read('scripts/release-gate-risk-scheduler.ts');
  for (const marker of ['backend-risk-scheduler-phase6', 'test:risk-scheduler-phase6']) {
    if (!releaseGateSource.includes(marker)) {
      findings.push(`release-gate-risk-scheduler.ts: missing Phase 6 marker ${marker}`);
    }
  }

  const signoffSource = read('scripts/signoff-risk-scheduler.ts');
  if (!signoffSource.includes('backend-risk-scheduler-phase6')) {
    findings.push('signoff-risk-scheduler.ts: missing Phase 6 gate requirement');
  }

  assert.equal(
    findings.length,
    0,
    `Risk scheduler Phase 6 guard failed:\n${findings.join('\n')}`
  );
  console.log('Risk scheduler phase 6 assertions passed.');
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
