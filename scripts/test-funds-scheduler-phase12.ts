import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FundsSchedulerService } from '../src/api/services/FundsSchedulerService';

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
  const checkScriptPath = path.join(process.cwd(), 'scripts', 'check-funds-scheduler-health.ts');
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
    path.join(process.cwd(), 'scripts', 'release-gate-funds-scheduler.ts'),
    'utf8'
  );
  const signoffSource = await readFile(
    path.join(process.cwd(), 'scripts', 'signoff-funds-scheduler.ts'),
    'utf8'
  );
  const healthSource = await readFile(
    path.join(process.cwd(), 'scripts', 'check-funds-scheduler-health.ts'),
    'utf8'
  );
  const packageSource = await readFile(path.join(process.cwd(), 'package.json'), 'utf8');

  assert.equal(
    releaseGateSource.includes('backend-funds-scheduler-phase12'),
    true,
    'release gate must include the Phase 12 funds scheduler suite'
  );
  assert.equal(
    signoffSource.includes('backend-funds-scheduler-phase12'),
    true,
    'signoff must require the Phase 12 gate result'
  );
  assert.equal(
    healthSource.includes('buildConfiguredThresholds'),
    true,
    'funds scheduler health must derive thresholds from persisted config with optional env overrides'
  );
  assert.equal(
    packageSource.includes('"test:funds-scheduler-phase12"'),
    true,
    'package.json must include the Phase 12 funds scheduler script'
  );
}

async function main(): Promise<void> {
  await testFundsThresholdsPersistAndSurfaceInSummary();
  await testHealthCheckUsesPersistedThresholdsByDefault();
  await testHealthCheckAllowsEnvOverridesAbovePersistedThresholds();
  await runSourceMarkerAssertions();
  console.log('Funds scheduler phase 12 assertions passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
