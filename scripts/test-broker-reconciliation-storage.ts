import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { coreDataSource } from '../src/database/data-source';
import {
  BrokerBalanceSnapshot,
  BrokerFeeEntry,
  BrokerFill,
  BrokerFundingEntry,
  BrokerReconciliationRun,
  BrokerWalletTransaction,
} from '../src/database/entities';
import { BrokerReconciliationRepository } from '../src/database/repositories/BrokerReconciliationRepository';
import { AddBrokerReconciliationStorage1800002100000 } from '../src/database/migrations_baseline/1800002100000-AddBrokerReconciliationStorage';

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

async function runMigrationAssertions(): Promise<void> {
  const migration = new AddBrokerReconciliationStorage1800002100000();
  const createdSql: string[] = [];
  const droppedTables: string[] = [];
  const queryRunner = {
    async query(sql: string) {
      createdSql.push(sql);
    },
    async hasTable() {
      return true;
    },
    async dropTable(tableName: string) {
      droppedTables.push(tableName);
    },
  };

  await migration.up(queryRunner as any);
  assert.equal(createdSql.length, 6);
  for (const table of [
    'broker_fills',
    'broker_fee_entries',
    'broker_funding_entries',
    'broker_wallet_transactions',
    'broker_balance_snapshots',
    'broker_reconciliation_runs',
  ]) {
    assert.ok(
      createdSql.some((sql) => sql.includes(`CREATE TABLE IF NOT EXISTS ${table}`)),
      `${table} should be created by the migration`
    );
  }
  assert.ok(
    createdSql.some((sql) => sql.includes('uq_broker_fills_user_broker_account_external')),
    'fills need a stable idempotency key'
  );

  await migration.down(queryRunner as any);
  assert.deepEqual(droppedTables, [
    'broker_reconciliation_runs',
    'broker_balance_snapshots',
    'broker_wallet_transactions',
    'broker_funding_entries',
    'broker_fee_entries',
    'broker_fills',
  ]);
}

async function runRepositoryAssertions(): Promise<void> {
  const repository = new BrokerReconciliationRepository();
  const originalQuery = (coreDataSource as any).query;
  const captured: Array<{ sql: string; params: unknown[] }> = [];

  (coreDataSource as any).query = async (sql: string, params: unknown[] = []) => {
    captured.push({ sql, params });
    if (sql.includes('SELECT id, user_id, broker_key')) {
      return [
        {
          id: 'run-1',
          user_id: 'user-1',
          broker_key: 'mudrex',
          account_id: 'acct-1',
          run_type: 'backfill',
          status: 'completed',
          started_at: new Date('2026-06-09T08:00:00.000Z'),
          finished_at: new Date('2026-06-09T08:01:00.000Z'),
        },
      ];
    }
    return { affectedRows: 1 };
  };

  try {
    const fillMutation = await repository.upsertFill({
      userId: 'user-1',
      brokerKey: 'Mudrex',
      accountId: 'acct-1',
      externalId: 'fill-1',
      orderId: 'order-1',
      positionId: 'pos-1',
      suggestedTradeId: 'trade-1',
      symbol: 'btcusdt',
      side: 'long',
      quantity: '0.01',
      price: '63000',
      notional: '630',
      commissionAmount: '0.315',
      commissionCurrency: 'USDT',
      filledAt: '2026-06-09T08:00:00.000Z',
      rawPayload: { broker: 'mudrex' },
      matchState: 'matched',
      matchConfidence: 'exact',
    });
    assert.deepEqual(fillMutation, { inserted: true, updated: false });

    await repository.upsertFeeEntry({
      userId: 'user-1',
      brokerKey: 'mudrex',
      accountId: 'acct-1',
      externalId: 'fee-1',
      symbol: 'BTCUSDT',
      orderId: 'order-1',
      fillId: 'fill-1',
      feeType: 'TRANSACTION',
      amount: '-0.315',
      currency: 'USDT',
      transactionAmount: '630',
      feeRatePct: '0.05',
      occurredAt: '2026-06-09T08:00:01.000Z',
      rawPayload: { fee_type: 'TRANSACTION' },
    });

    await repository.upsertFundingEntry({
      userId: 'user-1',
      brokerKey: 'delta_exchange',
      accountId: 'acct-2',
      externalId: 'funding-1',
      symbol: 'SOLUSD',
      positionId: 'pos-2',
      side: 'short',
      amount: '0.12',
      currency: 'USD',
      notional: '500',
      fundingRatePct: '0.024',
      occurredAt: '2026-06-09T08:05:00.000Z',
      rawPayload: { transaction_type: 'funding' },
    });

    await repository.upsertWalletTransaction({
      userId: 'user-1',
      brokerKey: 'delta_exchange',
      accountId: 'acct-2',
      externalId: 'wallet-1',
      transactionType: 'commission',
      referenceId: 'order-2',
      orderId: 'order-2',
      amount: '-0.20',
      currency: 'USD',
      balanceAfter: '134.68',
      occurredAt: '2026-06-09T08:06:00.000Z',
      rawPayload: { transaction_type: 'commission' },
    });

    await repository.upsertBalanceSnapshot({
      userId: 'user-1',
      brokerKey: 'mudrex',
      accountId: 'acct-1',
      externalId: 'funds-snapshot-1',
      walletBalance: '0',
      futuresBalance: '134.6811',
      totalBalance: '134.6811',
      lockedAmount: '0',
      currency: 'USDT',
      sourceSnapshotId: 'snap-1',
      observedAt: '2026-06-09T08:07:00.000Z',
      rawPayload: { futures: { balance: '134.6811' } },
    });

    const runId = await repository.createReconciliationRun({
      userId: 'user-1',
      brokerKey: 'mudrex',
      accountId: 'acct-1',
      runType: 'backfill',
      windowStartAt: '2026-06-08T08:00:00.000Z',
      windowEndAt: '2026-06-09T08:00:00.000Z',
      summaryPayload: { phase: 2 },
    });
    assert.match(runId, /^[0-9a-f-]{36}$/);

    const updatedRows = await repository.finishReconciliationRun(runId, {
      status: 'completed',
      fillsCount: 1,
      feeEntriesCount: 1,
      fundingEntriesCount: 1,
      walletTransactionsCount: 1,
      balanceSnapshotsCount: 1,
      grossPnl: '5.35',
      feesTotal: '-2.1',
      fundingTotal: '0.12',
      netPnl: '3.47',
      balanceDelta: '-19.92',
      unmatchedDelta: '-23.39',
      summaryPayload: { complete: true },
    });
    assert.equal(updatedRows, 1);

    const runs = await repository.listRecentRuns({
      userId: 'user-1',
      brokerKey: 'MUDREX',
      accountId: 'acct-1',
      limit: 5,
    });
    assert.equal(runs[0].id, 'run-1');

    assert.ok(
      captured.some(
        (entry) =>
          entry.sql.includes('INSERT INTO broker_fills') &&
          entry.sql.includes('ON DUPLICATE KEY UPDATE') &&
          entry.params.includes('mudrex') &&
          entry.params.includes('BTCUSDT')
      ),
      'fill upsert should normalize broker key and symbol'
    );
    assert.ok(captured.some((entry) => entry.sql.includes('INSERT INTO broker_fee_entries')));
    assert.ok(captured.some((entry) => entry.sql.includes('INSERT INTO broker_funding_entries')));
    assert.ok(
      captured.some((entry) => entry.sql.includes('INSERT INTO broker_wallet_transactions'))
    );
    assert.ok(captured.some((entry) => entry.sql.includes('INSERT INTO broker_balance_snapshots')));
    assert.ok(captured.some((entry) => entry.sql.includes('broker_reconciliation_runs')));
  } finally {
    (coreDataSource as any).query = originalQuery;
  }
}

function runEntityRegistrationAssertions(): void {
  const entities = (coreDataSource.options.entities || []) as unknown[];
  for (const entity of [
    BrokerFill,
    BrokerFeeEntry,
    BrokerFundingEntry,
    BrokerWalletTransaction,
    BrokerBalanceSnapshot,
    BrokerReconciliationRun,
  ]) {
    assert.ok(entities.includes(entity), `${entity.name} should be registered in coreDataSource`);
  }
}

function runScriptWiringAssertions(): void {
  const packageJson = JSON.parse(read('package.json')) as { scripts?: Record<string, string> };
  assert.equal(
    packageJson.scripts?.['test:broker-reconciliation-storage'],
    'node --import tsx scripts/_support/run-doc-aware-test.ts scripts/test-broker-reconciliation-storage.ts'
  );
  assert.match(
    read('scripts/_support/run-package-suite.ts'),
    /'broker-reconciliation-storage':\s*\['test:broker-reconciliation-storage'\]/
  );
}

async function main(): Promise<void> {
  await runMigrationAssertions();
  await runRepositoryAssertions();
  runEntityRegistrationAssertions();
  runScriptWiringAssertions();
  console.log('Broker reconciliation storage assertions passed.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
