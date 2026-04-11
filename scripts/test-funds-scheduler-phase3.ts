import assert from 'node:assert/strict';
import { FundsSchedulerService } from '../src/api/services/FundsSchedulerService';
import { FundsSnapshotRepository } from '../src/database/repositories/FundsSnapshotRepository';
import { coreDataSource } from '../src/database/data-source';
import { HardenFundsSnapshotsRuntime1770707000000 } from '../src/database/migrations/1770707000000-HardenFundsSnapshotsRuntime';

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

run().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
