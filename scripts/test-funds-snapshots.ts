import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { FundsSnapshotsController } from '../src/api/controllers/FundsSnapshotsController';
import { FundsSnapshotRepository } from '../src/database/repositories/FundsSnapshotRepository';
import { coreDataSource } from '../src/database/data-source';

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

const authReq = { authUser: { sub: 'user-1' } } as any;
const unauthReq = {} as any;

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

async function runFundsSnapshotsControllerAssertions(): Promise<void> {
  const controller: any = new FundsSnapshotsController();
  const calls: Array<Record<string, unknown>> = [];

  controller.fundsSnapshotRepository = {
    async listSnapshots(userId: string, query: Record<string, unknown>) {
      calls.push({ method: 'listSnapshots', userId, query });
      return {
        items: [{ id: 'snap-1' }],
        total: 1,
      };
    },
    async getLatestSnapshot(userId: string, brokerKey?: string, accountId?: string) {
      calls.push({ method: 'getLatestSnapshot', userId, brokerKey, accountId });
      return {
        id: 'snap-1',
        broker_key: brokerKey || 'mudrex',
        account_id: accountId || 'acct-1',
      };
    },
  };

  const listResponse = await controller.listSnapshots(authReq, '10', '5');
  assert.deepEqual(listResponse.data, {
    items: [{ id: 'snap-1' }],
    total: 1,
    limit: 10,
    offset: 5,
  });

  const latestResponse = await controller.getLatest(authReq, 'mudrex', 'acct-1');
  assert.deepEqual(latestResponse.data, {
    id: 'snap-1',
    broker_key: 'mudrex',
    account_id: 'acct-1',
  });

  assert.deepEqual(calls, [
    {
      method: 'listSnapshots',
      userId: 'user-1',
      query: { limit: 10, offset: 5 },
    },
    {
      method: 'getLatestSnapshot',
      userId: 'user-1',
      brokerKey: 'mudrex',
      accountId: 'acct-1',
    },
  ]);

  await assertAuthRequired(() => controller.listSnapshots(unauthReq));
  await assertAuthRequired(() => controller.getLatest(unauthReq));
}

async function runFundsSnapshotRepositoryUsesAtomicUpsertAndCoverageQuery(): Promise<void> {
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

    throw new Error(`Unexpected SQL in funds snapshots repository test: ${sql}`);
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

async function runFundsSnapshotRepositoryLatestReadSkipsFailureOnlyRows(): Promise<void> {
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

    throw new Error(`Unexpected SQL in funds snapshots latest-read test: ${sql}`);
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

function runFundsSnapshotsScriptWiringAssertions(): void {
  const packageSource = read('package.json');
  const packageJson = JSON.parse(packageSource) as { scripts?: Record<string, string> };
  const packageScripts = packageJson.scripts || {};
  const runPackageSuiteSource = read('scripts/_support/run-package-suite.ts');
  const smokeModulesSource = read('scripts/smokes/smoke-modules.sh');

  assert.equal(
    packageScripts['test:funds-snapshots'],
    'node --import tsx scripts/_support/run-doc-aware-test.ts scripts/test-funds-snapshots.ts'
  );
  assert.match(runPackageSuiteSource, /'funds-snapshots':\s*\['test:funds-snapshots'\]/);
  assert.match(smokeModulesSource, /\/funds-snapshots\?limit=5&offset=0/);
  assert.match(smokeModulesSource, /\/funds-snapshots\/latest/);
  assert.equal(
    packageScripts['check:funds-snapshots-health'],
    'node --import tsx scripts/checks/check-funds-snapshots-health.ts'
  );
}

async function main(): Promise<void> {
  await runFundsSnapshotsControllerAssertions();
  await runFundsSnapshotRepositoryUsesAtomicUpsertAndCoverageQuery();
  await runFundsSnapshotRepositoryLatestReadSkipsFailureOnlyRows();
  runFundsSnapshotsScriptWiringAssertions();
  console.log('Funds snapshots module assertions passed.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
