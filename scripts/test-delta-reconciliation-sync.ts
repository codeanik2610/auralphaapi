import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { InternalBrokerReconciliationController } from '../src/api/controllers/InternalBrokerReconciliationController';
import {
  DeltaExchangeFill,
  DeltaExchangeProduct,
  DeltaExchangeWalletTransaction,
} from '../src/api/contracts/DeltaExchange';
import { DeltaBrokerReconciliationSyncService } from '../src/api/services/DeltaBrokerReconciliationSyncService';

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function createSuccess<T>(data: T) {
  return { success: true as const, data };
}

async function runDeltaSyncServiceAssertions(): Promise<void> {
  const service: any = new DeltaBrokerReconciliationSyncService();
  const repositoryCalls: Array<{ method: string; args: unknown[] }> = [];
  const signedQueries: Array<{
    path: string;
    query: Record<string, unknown> | undefined;
    userId: string | undefined;
    accountId: string | undefined;
  }> = [];
  const positionHistoryQueries: unknown[] = [];
  const walletContexts: unknown[] = [];

  const products: DeltaExchangeProduct[] = [
    {
      id: '27',
      symbol: 'BTCUSD',
      contract_value: '0.001',
      contract_unit_currency: 'BTC',
    },
  ];

  const fills: DeltaExchangeFill[] = [
    {
      id: 'fill-1',
      product_id: '27',
      product_symbol: 'BTCUSD',
      side: 'buy',
      size: '2',
      price: '100000',
      fill_type: 'normal',
      role: 'taker',
      commission: '0.40',
      order_id: 'order-1',
      settling_asset_symbol: 'USD',
      created_at: '2026-06-08T10:05:00.000Z',
    },
    {
      id: 'fill-2',
      product_id: '27',
      product_symbol: 'BTCUSD',
      side: 'sell',
      size: '1',
      price: '100500',
      fill_type: 'normal',
      role: 'maker',
      commission: '-0.05',
      order_id: 'order-2',
      settling_asset_symbol: 'USD',
      created_at: '2026-06-08T10:10:00.000Z',
    },
  ];

  const walletTransactions: DeltaExchangeWalletTransaction[] = [
    {
      id: 'txn-commission-1',
      transaction_type: 'commission',
      amount: '-0.40',
      balance: '149.60',
      asset_symbol: 'USD',
      product_id: '27',
      created_at: '2026-06-08T10:05:01.000Z',
      meta_data: {
        product_symbol: 'BTCUSD',
        order_id: 'order-1',
        fill_id: 'fill-1',
      },
    },
    {
      id: 'txn-funding-1',
      transaction_type: 'funding',
      amount: '0.12',
      balance: '149.72',
      asset_symbol: 'USD',
      product_id: '27',
      created_at: '2026-06-08T11:00:00.000Z',
      meta_data: {
        product_symbol: 'BTCUSD',
      },
    },
    {
      id: 'txn-deposit-1',
      transaction_type: 'deposit',
      amount: '25',
      balance: '174.72',
      asset_symbol: 'USD',
      created_at: '2026-06-08T12:00:00.000Z',
    },
  ];

  service.deltaWalletAdapter = {
    async getWalletFunds(context: unknown) {
      walletContexts.push(context);
      return {
        total: 0,
        withdrawable: 0,
      };
    },
    async getFuturesFunds(context: unknown) {
      walletContexts.push(context);
      return {
        balance: '150.25',
        available_balance: '140.25',
        locked_amount: '10',
        asset_symbol: 'USD',
      };
    },
  };

  service.deltaPositionsAdapter = {
    async getPositionHistory(query: unknown, context: unknown) {
      positionHistoryQueries.push({ query, context });
      return [
        {
          id: 'position-history-1',
          symbol: 'BTCUSD',
          pnl: '7',
        },
        {
          id: 'position-history-2',
          symbol: 'BTCUSD',
          realized: '-2',
        },
      ];
    },
  };

  service.deltaHttpClient = {
    async publicGet(pathname: string) {
      assert.equal(pathname, '/v2/products');
      return products;
    },
    async signedGetEnvelope(
      accountId: string | undefined,
      pathname: string,
      query: Record<string, unknown> | undefined,
      userId: string | undefined
    ) {
      signedQueries.push({ path: pathname, query, userId, accountId });

      if (pathname === '/v2/fills') {
        if (query?.after) {
          return { success: true, result: [], meta: { after: null } };
        }
        return { success: true, result: fills, meta: { after: 'fills-cursor-2' } };
      }

      if (pathname === '/v2/wallet/transactions') {
        if (query?.after) {
          return { success: true, result: [], meta: { after: null } };
        }
        return {
          success: true,
          result: walletTransactions,
          meta: { after: 'wallet-cursor-2' },
        };
      }

      throw new Error(`Unexpected Delta path ${pathname}`);
    },
  };

  service.brokerReconciliationRepository = {
    async createReconciliationRun(...args: unknown[]) {
      repositoryCalls.push({ method: 'createReconciliationRun', args });
      return 'delta-run-1';
    },
    async upsertBalanceSnapshot(...args: unknown[]) {
      repositoryCalls.push({ method: 'upsertBalanceSnapshot', args });
      return { inserted: true, updated: false };
    },
    async upsertFill(...args: unknown[]) {
      repositoryCalls.push({ method: 'upsertFill', args });
      return { inserted: true, updated: false };
    },
    async upsertWalletTransaction(...args: unknown[]) {
      repositoryCalls.push({ method: 'upsertWalletTransaction', args });
      return { inserted: true, updated: false };
    },
    async upsertFeeEntry(...args: unknown[]) {
      repositoryCalls.push({ method: 'upsertFeeEntry', args });
      return { inserted: true, updated: false };
    },
    async upsertFundingEntry(...args: unknown[]) {
      repositoryCalls.push({ method: 'upsertFundingEntry', args });
      return { inserted: true, updated: false };
    },
    async finishReconciliationRun(...args: unknown[]) {
      repositoryCalls.push({ method: 'finishReconciliationRun', args });
      return 1;
    },
  };

  const result = await service.syncAccount({
    userId: 'user-1',
    accountId: 'delta-acct-1',
    startDate: '2026-06-08',
    endDate: '2026-06-09',
    fillPageSize: 2,
    maxFillPages: 2,
    walletTransactionPageSize: 3,
    maxWalletTransactionPages: 2,
    positionLimit: 4,
  });

  assert.equal(result.runId, 'delta-run-1');
  assert.equal(result.brokerKey, 'delta_exchange');
  assert.equal(result.accountId, 'delta-acct-1');
  assert.equal(result.fillRowsFetched, 2);
  assert.equal(result.fillsUpserted, 2);
  assert.equal(result.positionRowsFetched, 2);
  assert.equal(result.walletTransactionRowsFetched, 3);
  assert.equal(result.walletTransactionsUpserted, 3);
  assert.equal(result.feeEntriesUpserted, 1);
  assert.equal(result.fundingEntriesUpserted, 1);
  assert.equal(result.balanceSnapshotsUpserted, 1);
  assert.equal(result.grossPnl, 5);
  assert.equal(result.feeTotal, -0.4);
  assert.equal(result.fundingTotal, 0.12);
  assert.equal(result.walletTransactionTotal, 24.72);

  assert.deepEqual(walletContexts, [
    {
      userId: 'user-1',
      accountId: 'delta-acct-1',
      brokerKey: 'delta_exchange',
    },
    {
      userId: 'user-1',
      accountId: 'delta-acct-1',
      brokerKey: 'delta_exchange',
    },
  ]);
  assert.deepEqual(positionHistoryQueries, [
    {
      query: {
        limit: '4',
        startDate: '2026-06-08',
        endDate: '2026-06-09',
      },
      context: {
        userId: 'user-1',
        accountId: 'delta-acct-1',
        brokerKey: 'delta_exchange',
      },
    },
  ]);

  assert.equal(signedQueries.length, 4);
  assert.equal(signedQueries[0].path, '/v2/fills');
  assert.equal(signedQueries[0].query?.page_size, 2);
  assert.equal(signedQueries[0].query?.contract_types, 'perpetual_futures');
  assert.equal(signedQueries[0].query?.start_time, Date.parse('2026-06-08T00:00:00.000Z') * 1000);
  assert.equal(signedQueries[0].query?.end_time, Date.parse('2026-06-09T23:59:59.999Z') * 1000);
  assert.equal(signedQueries[1].query?.after, 'fills-cursor-2');
  assert.equal(signedQueries[2].path, '/v2/wallet/transactions');
  assert.equal(signedQueries[2].query?.page_size, 3);
  assert.equal(signedQueries[3].query?.after, 'wallet-cursor-2');

  const runCreate = repositoryCalls.find((call) => call.method === 'createReconciliationRun')
    ?.args[0] as Record<string, unknown>;
  assert.equal(runCreate.brokerKey, 'delta_exchange');
  assert.equal(runCreate.runType, 'delta_reconciliation_sync');

  const balanceRow = repositoryCalls.find((call) => call.method === 'upsertBalanceSnapshot')
    ?.args[0] as Record<string, unknown>;
  assert.equal(balanceRow.brokerKey, 'delta_exchange');
  assert.equal(balanceRow.walletBalance, 0);
  assert.equal(balanceRow.futuresBalance, 150.25);
  assert.equal(balanceRow.totalBalance, 150.25);
  assert.equal(balanceRow.availableBalance, 140.25);
  assert.equal(balanceRow.lockedAmount, 10);
  assert.equal(balanceRow.currency, 'USD');
  assert.equal(balanceRow.source, 'delta_wallet_balances');

  const fillRows = repositoryCalls
    .filter((call) => call.method === 'upsertFill')
    .map((call) => call.args[0] as Record<string, unknown>);
  assert.equal(fillRows.length, 2);
  assert.equal(fillRows[0].externalId, 'delta_exchange:fill:fill-1');
  assert.equal(fillRows[0].orderId, 'order-1');
  assert.equal(fillRows[0].positionId, '27');
  assert.equal(fillRows[0].symbol, 'BTCUSD');
  assert.equal(fillRows[0].side, 'buy');
  assert.equal(fillRows[0].quantity, 0.002);
  assert.equal(fillRows[0].price, 100000);
  assert.equal(fillRows[0].notional, 200);
  assert.equal(fillRows[0].commissionAmount, 0.4);
  assert.equal(fillRows[0].commissionCurrency, 'USD');
  assert.equal(fillRows[0].source, 'delta_fills');
  assert.equal(fillRows[1].commissionAmount, -0.05);

  const walletRows = repositoryCalls.filter((call) => call.method === 'upsertWalletTransaction');
  assert.equal(walletRows.length, 3);

  const feeRow = repositoryCalls.find((call) => call.method === 'upsertFeeEntry')
    ?.args[0] as Record<string, unknown>;
  assert.equal(feeRow.externalId, 'delta_exchange:fee:txn-commission-1');
  assert.equal(feeRow.symbol, 'BTCUSD');
  assert.equal(feeRow.orderId, 'order-1');
  assert.equal(feeRow.feeType, 'commission');
  assert.equal(feeRow.amount, -0.4);
  assert.equal(feeRow.currency, 'USD');

  const fundingRow = repositoryCalls.find((call) => call.method === 'upsertFundingEntry')
    ?.args[0] as Record<string, unknown>;
  assert.equal(fundingRow.externalId, 'delta_exchange:funding:txn-funding-1');
  assert.equal(fundingRow.symbol, 'BTCUSD');
  assert.equal(fundingRow.positionId, '27');
  assert.equal(fundingRow.amount, 0.12);
  assert.equal(fundingRow.currency, 'USD');

  const finishCall = repositoryCalls
    .filter((call) => call.method === 'finishReconciliationRun')
    .at(-1);
  assert.equal(finishCall?.args[0], 'delta-run-1');
  const finishPayload = finishCall?.args[1] as Record<string, unknown>;
  assert.equal(finishPayload.status, 'completed');
  assert.equal(finishPayload.fillsCount, 2);
  assert.equal(finishPayload.feeEntriesCount, 1);
  assert.equal(finishPayload.fundingEntriesCount, 1);
  assert.equal(finishPayload.walletTransactionsCount, 3);
  assert.equal(Number(finishPayload.netPnl).toFixed(2), '4.72');
}

async function runDeltaSyncFailureAssertions(): Promise<void> {
  const service: any = new DeltaBrokerReconciliationSyncService();
  const finishPayloads: Array<Record<string, unknown>> = [];

  service.brokerReconciliationRepository = {
    async createReconciliationRun() {
      return 'failed-delta-run-1';
    },
    async upsertBalanceSnapshot() {
      return { inserted: true, updated: false };
    },
    async finishReconciliationRun(_runId: string, payload: Record<string, unknown>) {
      finishPayloads.push(payload);
      return 1;
    },
  };
  service.deltaWalletAdapter = {
    async getWalletFunds() {
      return { total: 0 };
    },
    async getFuturesFunds() {
      return { balance: '0', locked_amount: '0' };
    },
  };
  service.deltaHttpClient = {
    async publicGet() {
      return [];
    },
    async signedGetEnvelope() {
      throw new Error('Delta fills unavailable');
    },
  };
  service.deltaPositionsAdapter = {
    async getPositionHistory() {
      return [];
    },
  };

  await assert.rejects(
    () => service.syncAccount({ userId: 'user-1', accountId: 'delta-acct-1' }),
    /Delta fills unavailable/
  );
  assert.equal(finishPayloads.at(-1)?.status, 'failed');
  assert.equal(finishPayloads.at(-1)?.errorMessage, 'Delta fills unavailable');
}

async function runInternalControllerAssertions(): Promise<void> {
  const controller: any = new InternalBrokerReconciliationController();
  const input = { userId: 'user-1', accountId: 'delta-acct-1' };
  const output = {
    runId: 'delta-run-1',
    brokerKey: 'delta_exchange' as const,
    accountId: 'delta-acct-1',
    startedAt: '2026-06-08T10:00:00.000Z',
    finishedAt: '2026-06-08T10:00:01.000Z',
    fillRowsFetched: 1,
    fillsUpserted: 1,
    positionRowsFetched: 1,
    walletTransactionRowsFetched: 1,
    walletTransactionsUpserted: 1,
    feeEntriesUpserted: 1,
    fundingEntriesUpserted: 0,
    balanceSnapshotsUpserted: 1,
    grossPnl: 1,
    feeTotal: -0.1,
    fundingTotal: 0,
    walletTransactionTotal: -0.1,
  };
  controller.deltaBrokerReconciliationSyncService = {
    async syncAccount(body: unknown) {
      assert.deepEqual(body, input);
      return output;
    },
  };

  assert.deepEqual(await controller.syncDelta(input), createSuccess(output));
}

function runScriptAndSourceWiringAssertions(): void {
  const packageJson = JSON.parse(read('package.json')) as { scripts?: Record<string, string> };
  assert.equal(
    packageJson.scripts?.['test:delta-reconciliation-sync'],
    'node --import tsx scripts/_support/run-doc-aware-test.ts scripts/test-delta-reconciliation-sync.ts'
  );

  const suiteSource = read('scripts/_support/run-package-suite.ts');
  assert.match(suiteSource, /'delta-reconciliation-sync':\s*'baseline'/);
  assert.match(suiteSource, /'delta-reconciliation-sync':\s*\['test:delta-reconciliation-sync'\]/);
  assert.match(suiteSource, /'test:delta-reconciliation-sync'/);

  const contractsBarrel = read('src/api/contracts/index.ts');
  assert.match(contractsBarrel, /export \* from '\.\/DeltaExchange'/);

  const serviceSource = read('src/api/services/DeltaBrokerReconciliationSyncService.ts');
  assert.match(serviceSource, /\/v2\/fills/);
  assert.match(serviceSource, /\/v2\/wallet\/transactions/);
  assert.match(serviceSource, /delta_wallet_transactions/);
  assert.match(serviceSource, /delta_wallet_balances/);

  const internalControllerSource = read(
    'src/api/controllers/InternalBrokerReconciliationController.ts'
  );
  assert.match(internalControllerSource, /@Post\('\/delta\/sync'\)/);
}

async function main(): Promise<void> {
  await runDeltaSyncServiceAssertions();
  await runDeltaSyncFailureAssertions();
  await runInternalControllerAssertions();
  runScriptAndSourceWiringAssertions();
  console.log('Delta reconciliation sync assertions passed.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
