import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SchedulerRuntimeSchemaService } from '../src/api/services/SchedulerRuntimeSchemaService';
import { FundsSchedulerService } from '../src/api/services/FundsSchedulerService';
import { coreDataSource } from '../src/database/data-source';

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
      total: 17,
      passed: 17,
      failed: 0,
      skipped: 0,
    },
    results: [
      'backend-funds-scheduler-phase1',
      'backend-funds-scheduler-phase2',
      'backend-funds-scheduler-phase3',
      'backend-funds-scheduler-phase4',
      'backend-funds-scheduler-phase6',
      'backend-funds-scheduler-phase7',
      'backend-funds-scheduler-phase8',
      'backend-funds-scheduler-phase10',
      'backend-funds-scheduler-phase11',
      'backend-funds-scheduler-phase12',
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
    ['--import', 'tsx', 'scripts/signoff-funds-scheduler.ts'],
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

run().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
