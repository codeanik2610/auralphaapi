import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { InternalBrokerReconciliationController } from '../src/api/controllers/InternalBrokerReconciliationController';
import {
  MudrexFeeHistoryItem,
  MudrexFuturesFunds,
  MudrexOrder,
  MudrexPositionHistoryItem,
  MudrexWalletFunds,
} from '../src/api/contracts/Mudrex';
import { MudrexBrokerReconciliationSyncService } from '../src/api/services/MudrexBrokerReconciliationSyncService';
import { FeesService } from '../src/brokers/providers/mudrex/FeesService';

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function createSuccess<T>(data: T) {
  return { success: true as const, data };
}

function createFilledMudrexOrder(overrides: Partial<MudrexOrder> = {}): MudrexOrder {
  return {
    created_at: '2026-06-08T10:00:00.000Z',
    updated_at: '2026-06-08T10:05:00.000Z',
    reason: null,
    actual_amount: 1000,
    quantity: 0.01,
    filled_quantity: 0.01,
    price: 100000,
    filled_price: 100000,
    leverage: 1,
    trade_currency: 'USDT',
    order_type: 'LONG',
    trigger_type: 'MARKET',
    status: 'COMPLETED',
    id: 'mudrex-order-1',
    asset_uuid: 'btc-asset',
    symbol: 'BTCUSDT',
    ...overrides,
  };
}

function createPositionHistoryItem(
  overrides: Partial<MudrexPositionHistoryItem> = {}
): MudrexPositionHistoryItem {
  return {
    id: 'mudrex-position-history-1',
    position_type: 'LONG',
    status: 'CLOSED',
    leverage: '1',
    entry_price: '100000',
    closed_price: '100800',
    quantity: '0.01',
    pnl: '8.5',
    created_at: '2026-06-08T10:00:00.000Z',
    updated_at: '2026-06-08T10:20:00.000Z',
    asset_uuid: 'btc-asset',
    symbol: 'BTCUSDT',
    trade_currency: 'USDT',
    ...overrides,
  };
}

async function runFeesServiceAssertions(): Promise<void> {
  const service: any = new FeesService();
  const calls: Array<Record<string, unknown>> = [];
  const payload: MudrexFeeHistoryItem[] = [
    {
      symbol: 'BTCUSDT',
      fee_amount: '0.40',
      fee_perc: '0.04',
      fee_type: 'TRANSACTION',
      created_at: '2026-06-08T10:05:00.000Z',
      transaction_amount: '1000',
    },
  ];

  service.mudrexHttpClient = {
    async authenticatedGet(userId: string, accountId: string, route: string, params: unknown) {
      calls.push({ userId, accountId, route, params });
      return payload;
    },
  };

  const response = await service.getFuturesFeeHistory(
    { limit: '25', offset: '10' },
    'user-1',
    'acct-1'
  );
  assert.deepEqual(response, createSuccess(payload));
  assert.deepEqual(calls, [
    {
      userId: 'user-1',
      accountId: 'acct-1',
      route: '/fapi/v1/futures/fee/history',
      params: { limit: 25, offset: 10 },
    },
  ]);

  await assert.rejects(
    () => service.getFuturesFeeHistory({ limit: '0' }, 'user-1', 'acct-1'),
    /limit must be an integer between 1 and 50000/
  );
  await assert.rejects(
    () => service.getFuturesFeeHistory({ offset: '-1' }, 'user-1', 'acct-1'),
    /offset must be a non-negative integer/
  );
}

async function runMudrexSyncServiceAssertions(): Promise<void> {
  const service: any = new MudrexBrokerReconciliationSyncService();
  const walletFunds: MudrexWalletFunds = {
    total: 100,
    rewards: 0,
    invested: 0,
    withdrawable: 95,
    coin_investable: 0,
    coinset_investable: 0,
    vault_investable: 0,
  };
  const futuresFunds: MudrexFuturesFunds = {
    balance: '40',
    locked_amount: '5',
    first_time_user: false,
  };
  const orderQueries: unknown[] = [];
  const positionQueries: unknown[] = [];
  const feeQueries: unknown[] = [];
  const repositoryCalls: Array<{ method: string; args: unknown[] }> = [];

  service.walletService = {
    async getWalletFunds(userId: string, accountId: string) {
      assert.equal(userId, 'user-1');
      assert.equal(accountId, 'acct-1');
      return createSuccess(walletFunds);
    },
    async getFuturesFunds(userId: string, accountId: string) {
      assert.equal(userId, 'user-1');
      assert.equal(accountId, 'acct-1');
      return createSuccess(futuresFunds);
    },
  };

  service.ordersService = {
    async getFuturesOrderHistory(query: unknown, userId: string, accountId: string) {
      orderQueries.push(query);
      assert.equal(userId, 'user-1');
      assert.equal(accountId, 'acct-1');
      return createSuccess([
        {
          ...createFilledMudrexOrder(),
          future_position_uuid: 'future-position-1',
        } as MudrexOrder,
        createFilledMudrexOrder({
          id: 'mudrex-order-unfilled',
          filled_quantity: 0,
          filled_price: 0,
        }),
      ]);
    },
  };

  service.positionsService = {
    async getPositionHistory(query: unknown, userId: string, accountId: string) {
      positionQueries.push(query);
      assert.equal(userId, 'user-1');
      assert.equal(accountId, 'acct-1');
      return createSuccess([
        createPositionHistoryItem({ pnl: '8.5' }),
        createPositionHistoryItem({ id: 'mudrex-position-history-2', pnl: '-2' }),
      ]);
    },
  };

  service.feesService = {
    async fetchFuturesFeeHistory(
      query: { limit: number; offset: number },
      userId: string,
      accountId: string
    ) {
      feeQueries.push(query);
      assert.equal(userId, 'user-1');
      assert.equal(accountId, 'acct-1');
      if (query.offset > 0) {
        return [];
      }
      return [
        {
          symbol: 'BTCUSDT',
          fee_amount: '0.40',
          fee_perc: '0.04',
          fee_type: 'TRANSACTION',
          created_at: '2026-06-08T10:05:00.000Z',
          transaction_amount: '1000',
        },
        {
          symbol: 'BTCUSDT',
          fee_amount: '0.15',
          fee_perc: '0.01',
          fee_type: 'FUNDING',
          created_at: '2026-06-08T11:00:00.000Z',
          transaction_amount: '1000',
        },
      ] satisfies MudrexFeeHistoryItem[];
    },
  };

  service.brokerReconciliationRepository = {
    async createReconciliationRun(...args: unknown[]) {
      repositoryCalls.push({ method: 'createReconciliationRun', args });
      return 'run-1';
    },
    async upsertBalanceSnapshot(...args: unknown[]) {
      repositoryCalls.push({ method: 'upsertBalanceSnapshot', args });
      return { inserted: true, updated: false };
    },
    async upsertFill(...args: unknown[]) {
      repositoryCalls.push({ method: 'upsertFill', args });
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
    accountId: 'acct-1',
    startDate: '2026-06-08T10:00:00.000Z',
    endDate: '2026-06-09T10:00:00.000Z',
    feeLimit: 2,
    maxFeePages: 2,
    orderLimit: 3,
    positionLimit: 4,
  });

  assert.equal(result.runId, 'run-1');
  assert.equal(result.brokerKey, 'mudrex');
  assert.equal(result.feeRowsFetched, 2);
  assert.equal(result.feeEntriesUpserted, 1);
  assert.equal(result.fundingEntriesUpserted, 1);
  assert.equal(result.fillRowsFetched, 2);
  assert.equal(result.fillsUpserted, 1);
  assert.equal(result.positionRowsFetched, 2);
  assert.equal(result.balanceSnapshotsUpserted, 1);
  assert.equal(result.grossPnl, 6.5);
  assert.equal(result.feeTotal, -0.4);
  assert.equal(result.fundingTotal, -0.15);
  assert.deepEqual(orderQueries, [
    {
      limit: '3',
      startDate: '2026-06-08',
      endDate: '2026-06-09',
    },
  ]);
  assert.deepEqual(positionQueries, [
    {
      limit: '4',
      startDate: '2026-06-08',
      endDate: '2026-06-09',
    },
  ]);
  assert.deepEqual(feeQueries, [
    { limit: 2, offset: 0 },
    { limit: 2, offset: 2 },
  ]);

  const balanceRow = repositoryCalls.find((call) => call.method === 'upsertBalanceSnapshot')
    ?.args[0] as Record<string, unknown>;
  assert.equal(balanceRow.brokerKey, 'mudrex');
  assert.equal(balanceRow.accountId, 'acct-1');
  assert.equal(balanceRow.walletBalance, 100);
  assert.equal(balanceRow.futuresBalance, '40');
  assert.equal(balanceRow.totalBalance, 140);
  assert.equal(balanceRow.availableBalance, 95);
  assert.equal(balanceRow.lockedAmount, '5');
  assert.equal(balanceRow.source, 'mudrex_funds');

  const fillRow = repositoryCalls.find((call) => call.method === 'upsertFill')?.args[0] as Record<
    string,
    unknown
  >;
  assert.equal(fillRow.externalId, 'mudrex:order-fill:mudrex-order-1');
  assert.equal(fillRow.positionId, 'future-position-1');
  assert.equal(fillRow.symbol, 'BTCUSDT');
  assert.equal(fillRow.side, 'long');
  assert.equal(fillRow.source, 'mudrex_order_history');

  const feeRow = repositoryCalls.find((call) => call.method === 'upsertFeeEntry')
    ?.args[0] as Record<string, unknown>;
  assert.equal(feeRow.amount, -0.4);
  assert.equal(feeRow.feeType, 'TRANSACTION');
  assert.match(String(feeRow.externalId), /^mudrex:fee:[0-9a-f]{24}$/);

  const fundingRow = repositoryCalls.find((call) => call.method === 'upsertFundingEntry')
    ?.args[0] as Record<string, unknown>;
  assert.equal(fundingRow.amount, -0.15);
  assert.equal(fundingRow.fundingRatePct, '0.01');
  assert.match(String(fundingRow.externalId), /^mudrex:fee:[0-9a-f]{24}$/);

  const finishCall = repositoryCalls
    .filter((call) => call.method === 'finishReconciliationRun')
    .at(-1);
  assert.equal(finishCall?.args[0], 'run-1');
  const finishPayload = finishCall?.args[1] as Record<string, unknown>;
  assert.equal(finishPayload.status, 'completed');
  assert.equal(finishPayload.fillsCount, 1);
  assert.equal(finishPayload.feeEntriesCount, 1);
  assert.equal(finishPayload.fundingEntriesCount, 1);
  assert.equal(Number(finishPayload.netPnl).toFixed(2), '5.95');
}

async function runMudrexSyncFailureAssertions(): Promise<void> {
  const service: any = new MudrexBrokerReconciliationSyncService();
  const finishPayloads: Array<Record<string, unknown>> = [];

  service.brokerReconciliationRepository = {
    async createReconciliationRun() {
      return 'failed-run-1';
    },
    async upsertBalanceSnapshot() {
      return { inserted: true, updated: false };
    },
    async finishReconciliationRun(_runId: string, payload: Record<string, unknown>) {
      finishPayloads.push(payload);
      return 1;
    },
  };
  service.walletService = {
    async getWalletFunds() {
      return createSuccess({
        total: 0,
        rewards: 0,
        invested: 0,
        withdrawable: 0,
        coin_investable: 0,
        coinset_investable: 0,
        vault_investable: 0,
      } satisfies MudrexWalletFunds);
    },
    async getFuturesFunds() {
      return createSuccess({
        balance: '0',
        locked_amount: '0',
        first_time_user: false,
      } satisfies MudrexFuturesFunds);
    },
  };
  service.ordersService = {
    async getFuturesOrderHistory() {
      return createSuccess([]);
    },
  };
  service.positionsService = {
    async getPositionHistory() {
      return createSuccess([]);
    },
  };
  service.feesService = {
    async fetchFuturesFeeHistory() {
      throw new Error('Mudrex fee history unavailable');
    },
  };

  await assert.rejects(
    () => service.syncAccount({ userId: 'user-1', accountId: 'acct-1' }),
    /Mudrex fee history unavailable/
  );
  assert.equal(finishPayloads.at(-1)?.status, 'failed');
  assert.equal(finishPayloads.at(-1)?.errorMessage, 'Mudrex fee history unavailable');
}

async function runInternalControllerAssertions(): Promise<void> {
  const controller: any = new InternalBrokerReconciliationController();
  const input = { userId: 'user-1', accountId: 'acct-1' };
  const output = {
    runId: 'run-1',
    brokerKey: 'mudrex' as const,
    accountId: 'acct-1',
    startedAt: '2026-06-08T10:00:00.000Z',
    finishedAt: '2026-06-08T10:00:01.000Z',
    feeRowsFetched: 1,
    feeEntriesUpserted: 1,
    fundingEntriesUpserted: 0,
    fillRowsFetched: 1,
    fillsUpserted: 1,
    positionRowsFetched: 1,
    balanceSnapshotsUpserted: 1,
    grossPnl: 1,
    feeTotal: -0.1,
    fundingTotal: 0,
  };
  controller.mudrexBrokerReconciliationSyncService = {
    async syncAccount(body: unknown) {
      assert.deepEqual(body, input);
      return output;
    },
  };

  assert.deepEqual(await controller.syncMudrex(input), createSuccess(output));
}

function runScriptAndSourceWiringAssertions(): void {
  const packageJson = JSON.parse(read('package.json')) as { scripts?: Record<string, string> };
  assert.equal(
    packageJson.scripts?.['test:mudrex-reconciliation-sync'],
    'node --import tsx scripts/_support/run-doc-aware-test.ts scripts/test-mudrex-reconciliation-sync.ts'
  );

  const suiteSource = read('scripts/_support/run-package-suite.ts');
  assert.match(suiteSource, /'mudrex-reconciliation-sync':\s*'baseline'/);
  assert.match(
    suiteSource,
    /'mudrex-reconciliation-sync':\s*\['test:mudrex-reconciliation-sync'\]/
  );
  assert.match(suiteSource, /'test:mudrex-reconciliation-sync'/);

  const mudrexHttpClientSource = read('src/brokers/providers/mudrex/MudrexHttpClient.ts');
  assert.match(mudrexHttpClientSource, /\/fapi\/v1\/futures\/fee\/history/);
  assert.match(mudrexHttpClientSource, /isMudrexFeeHistoryItem/);

  const mudrexProviderBarrel = read('src/brokers/providers/mudrex/index.ts');
  assert.match(mudrexProviderBarrel, /export \* from '\.\/FeesService'/);

  const internalControllerSource = read(
    'src/api/controllers/InternalBrokerReconciliationController.ts'
  );
  assert.match(internalControllerSource, /@JsonController\('\/internal\/broker-reconciliation'\)/);
  assert.match(internalControllerSource, /@Post\('\/mudrex\/sync'\)/);
}

async function main(): Promise<void> {
  await runFeesServiceAssertions();
  await runMudrexSyncServiceAssertions();
  await runMudrexSyncFailureAssertions();
  await runInternalControllerAssertions();
  runScriptAndSourceWiringAssertions();
  console.log('Mudrex reconciliation sync assertions passed.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
