import assert from 'node:assert/strict';
import { FundsSchedulerService } from '../src/api/services/FundsSchedulerService';

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

run().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
