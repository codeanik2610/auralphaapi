import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { InternalBrokerReconciliationController } from '../src/api/controllers/InternalBrokerReconciliationController';
import { BrokerReconciliationMatchService } from '../src/api/services/BrokerReconciliationMatchService';
import { coreDataSource } from '../src/database/data-source';
import { BrokerReconciliationRepository } from '../src/database/repositories/BrokerReconciliationRepository';

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function createSuccess<T>(data: T) {
  return { success: true as const, data };
}

async function runRepositoryMatchingAssertions(): Promise<void> {
  const repository = new BrokerReconciliationRepository();
  const originalQuery = (coreDataSource as any).query;
  const capturedQueries: Array<{ sql: string; params: unknown[] }> = [];
  const affectedRows = [2, 1, 1, 3, 4, 5, 6];

  (coreDataSource as any).query = async (sql: string, params: unknown[] = []) => {
    capturedQueries.push({ sql, params });
    return { affectedRows: affectedRows.shift() ?? 0 };
  };

  try {
    const result = await repository.runAppBrokerMatching({
      userId: 'user-1',
      brokerKey: 'delta_exchange',
      accountId: 'acct-1',
      windowStartAt: '2026-06-08T00:00:00.000Z',
      windowEndAt: '2026-06-09T00:00:00.000Z',
      fallbackWindowMinutes: 45,
    });

    assert.deepEqual(result, {
      fillsMatchedByExecutionOrderId: 2,
      fillsMatchedBySubmissionOrderId: 1,
      fillsMatchedByPositionId: 1,
      fillsMatchedBySymbolTimeSide: 3,
      feeEntriesLinked: 4,
      fundingEntriesLinked: 5,
      walletTransactionsLinked: 6,
    });
    assert.equal(capturedQueries.length, 7);
    assert.match(capturedQueries[0].sql, /JOIN suggested_trade_executions ste/);
    assert.match(capturedQueries[0].sql, /ste\.order_id = bf\.order_id/);
    assert.match(capturedQueries[1].sql, /JOIN order_submission_requests osr/);
    assert.match(capturedQueries[1].sql, /osr\.broker_order_id = bf\.order_id/);
    assert.match(capturedQueries[2].sql, /ste\.position_id = bf\.position_id/);
    assert.match(capturedQueries[3].sql, /TIMESTAMPDIFF\(MINUTE/);
    assert.match(capturedQueries[3].sql, /match_confidence = 'medium'/);
    assert.match(capturedQueries[4].sql, /UPDATE broker_fee_entries fee/);
    assert.match(capturedQueries[5].sql, /UPDATE broker_funding_entries funding/);
    assert.match(capturedQueries[6].sql, /UPDATE broker_wallet_transactions wallet/);
    assert.ok(capturedQueries[3].params.includes(45), 'fallback window should be parameterized');
    assert.ok(capturedQueries.every((entry) => entry.params.includes('user-1')));
    assert.ok(capturedQueries.every((entry) => entry.params.includes('delta_exchange')));
    assert.ok(capturedQueries.every((entry) => entry.params.includes('acct-1')));
  } finally {
    (coreDataSource as any).query = originalQuery;
  }
}

async function runRepositoryComparisonAssertions(): Promise<void> {
  const repository = new BrokerReconciliationRepository();
  const originalQuery = (coreDataSource as any).query;
  const capturedQueries: Array<{ sql: string; params: unknown[] }> = [];

  (coreDataSource as any).query = async (sql: string, params: unknown[] = []) => {
    capturedQueries.push({ sql, params });
    if (sql.includes('appTradeCount')) {
      return [
        {
          appTradeCount: '3',
          appMatchedTradeCount: '2',
          appGrossPnl: '8.5',
          appMatchedGrossPnl: '7.25',
        },
      ];
    }
    if (sql.includes('brokerFillCount')) {
      return [
        {
          brokerFillCount: '5',
          brokerMatchedFillCount: '4',
          brokerUnmatchedFillCount: '1',
          brokerNotional: '1200',
          brokerMatchedNotional: '1000',
        },
      ];
    }
    if (sql.includes('brokerFeeTotal')) {
      return [{ brokerFeeTotal: '-0.4', brokerMatchedFeeTotal: '-0.35' }];
    }
    if (sql.includes('brokerFundingTotal')) {
      return [{ brokerFundingTotal: '0.12', brokerMatchedFundingTotal: '0.12' }];
    }
    if (sql.includes('brokerWalletTransactionTotal')) {
      return [
        { brokerWalletTransactionTotal: '24.72', brokerMatchedWalletTransactionTotal: '-0.4' },
      ];
    }
    if (sql.includes('FROM broker_reconciliation_runs')) {
      return [
        {
          id: 'source-run-1',
          brokerKey: 'delta_exchange',
          accountId: 'acct-1',
          runType: 'delta_reconciliation_sync',
          startedAt: new Date('2026-06-08T10:00:00.000Z'),
          finishedAt: new Date('2026-06-08T10:01:00.000Z'),
          grossPnl: '9',
          feesTotal: '-0.4',
          fundingTotal: '0.12',
          netPnl: '8.72',
        },
      ];
    }
    throw new Error(`Unexpected SQL in comparison test: ${sql}`);
  };

  try {
    const totals = await repository.readComparisonTotals({
      userId: 'user-1',
      brokerKey: 'delta_exchange',
      accountId: 'acct-1',
      windowStartAt: '2026-06-08T00:00:00.000Z',
      windowEndAt: '2026-06-09T00:00:00.000Z',
    });
    assert.deepEqual(totals, {
      appTradeCount: 3,
      appMatchedTradeCount: 2,
      appGrossPnl: 8.5,
      appMatchedGrossPnl: 7.25,
      brokerFillCount: 5,
      brokerMatchedFillCount: 4,
      brokerUnmatchedFillCount: 1,
      brokerNotional: 1200,
      brokerMatchedNotional: 1000,
      brokerFeeTotal: -0.4,
      brokerMatchedFeeTotal: -0.35,
      brokerFundingTotal: 0.12,
      brokerMatchedFundingTotal: 0.12,
      brokerWalletTransactionTotal: 24.72,
      brokerMatchedWalletTransactionTotal: -0.4,
    });

    const latestSourceRun = await repository.readLatestCompletedSourceRun({
      userId: 'user-1',
      brokerKey: 'delta_exchange',
      accountId: 'acct-1',
    });
    assert.equal(latestSourceRun?.id, 'source-run-1');
    assert.equal(latestSourceRun?.grossPnl, 9);
    assert.equal(latestSourceRun?.netPnl, 8.72);
    assert.equal(
      capturedQueries.some((entry) =>
        entry.sql.includes(
          "run_type IN ('mudrex_reconciliation_sync', 'delta_reconciliation_sync')"
        )
      ),
      true
    );
  } finally {
    (coreDataSource as any).query = originalQuery;
  }
}

async function runServiceAssertions(): Promise<void> {
  const service: any = new BrokerReconciliationMatchService();
  const calls: Array<{ method: string; args: unknown[] }> = [];
  service.brokerReconciliationRepository = {
    async createReconciliationRun(...args: unknown[]) {
      calls.push({ method: 'createReconciliationRun', args });
      return 'phase5-run-1';
    },
    async runAppBrokerMatching(...args: unknown[]) {
      calls.push({ method: 'runAppBrokerMatching', args });
      return {
        fillsMatchedByExecutionOrderId: 2,
        fillsMatchedBySubmissionOrderId: 1,
        fillsMatchedByPositionId: 1,
        fillsMatchedBySymbolTimeSide: 1,
        feeEntriesLinked: 2,
        fundingEntriesLinked: 1,
        walletTransactionsLinked: 3,
      };
    },
    async readComparisonTotals(...args: unknown[]) {
      calls.push({ method: 'readComparisonTotals', args });
      return {
        appTradeCount: 4,
        appMatchedTradeCount: 3,
        appGrossPnl: 8,
        appMatchedGrossPnl: 6,
        brokerFillCount: 5,
        brokerMatchedFillCount: 4,
        brokerUnmatchedFillCount: 1,
        brokerNotional: 1200,
        brokerMatchedNotional: 1000,
        brokerFeeTotal: -0.5,
        brokerMatchedFeeTotal: -0.4,
        brokerFundingTotal: 0.25,
        brokerMatchedFundingTotal: 0.2,
        brokerWalletTransactionTotal: -0.25,
        brokerMatchedWalletTransactionTotal: -0.2,
      };
    },
    async readLatestCompletedSourceRun(...args: unknown[]) {
      calls.push({ method: 'readLatestCompletedSourceRun', args });
      return {
        id: 'source-run-1',
        brokerKey: 'delta_exchange',
        accountId: 'acct-1',
        runType: 'delta_reconciliation_sync',
        startedAt: new Date('2026-06-08T10:00:00.000Z'),
        finishedAt: new Date('2026-06-08T10:01:00.000Z'),
        grossPnl: 9,
        feesTotal: -0.5,
        fundingTotal: 0.25,
        netPnl: 8.75,
      };
    },
    async finishReconciliationRun(...args: unknown[]) {
      calls.push({ method: 'finishReconciliationRun', args });
      return 1;
    },
  };

  const response = await service.matchAndCompare({
    userId: 'user-1',
    brokerKey: 'DELTA_EXCHANGE',
    accountId: 'acct-1',
    startDate: '2026-06-08',
    endDate: '2026-06-09',
    fallbackWindowMinutes: 45,
  });

  assert.equal(response.runId, 'phase5-run-1');
  assert.equal(response.brokerKey, 'delta_exchange');
  assert.equal(response.accountId, 'acct-1');
  assert.deepEqual(response.coverage, {
    appTradeCount: 4,
    appMatchedTradeCount: 3,
    brokerFillCount: 5,
    brokerMatchedFillCount: 4,
    brokerUnmatchedFillCount: 1,
    matchedFillCoveragePct: 80,
    matchedAppTradeCoveragePct: 75,
  });
  assert.equal(response.pnlComparison.appGrossPnl, 8);
  assert.equal(response.pnlComparison.brokerGrossPnl, 9);
  assert.equal(response.pnlComparison.brokerNetPnl, 8.75);
  assert.equal(response.pnlComparison.grossDelta, 1);
  assert.equal(response.pnlComparison.netDeltaVsAppGross, 0.75);
  assert.equal(response.pnlComparison.unmatchedBrokerNotional, 200);
  assert.equal(response.latestSourceRun?.id, 'source-run-1');
  assert.ok(
    response.pnlComparison.explanation.some((line: string) => line.includes('matched exactly'))
  );

  const createCall = calls.find((call) => call.method === 'createReconciliationRun');
  const createPayload = createCall?.args[0] as Record<string, unknown>;
  assert.equal(createPayload.brokerKey, 'delta_exchange');
  assert.equal(createPayload.runType, 'broker_app_match');

  const finishCall = calls.filter((call) => call.method === 'finishReconciliationRun').at(-1);
  assert.equal(finishCall?.args[0], 'phase5-run-1');
  const finishPayload = finishCall?.args[1] as Record<string, unknown>;
  assert.equal(finishPayload.status, 'completed');
  assert.equal(finishPayload.grossPnl, 9);
  assert.equal(finishPayload.netPnl, 8.75);
  assert.equal(finishPayload.unmatchedDelta, 0.75);
}

async function runServiceFailureAssertions(): Promise<void> {
  const service: any = new BrokerReconciliationMatchService();
  const finishPayloads: Array<Record<string, unknown>> = [];
  service.brokerReconciliationRepository = {
    async createReconciliationRun() {
      return 'failed-phase5-run-1';
    },
    async runAppBrokerMatching() {
      throw new Error('matching failed');
    },
    async finishReconciliationRun(_runId: string, payload: Record<string, unknown>) {
      finishPayloads.push(payload);
      return 1;
    },
  };

  await assert.rejects(
    () => service.matchAndCompare({ userId: 'user-1', brokerKey: 'mudrex' }),
    /matching failed/
  );
  assert.equal(finishPayloads.at(-1)?.status, 'failed');
  assert.equal(finishPayloads.at(-1)?.errorMessage, 'matching failed');
}

async function runInternalControllerAssertions(): Promise<void> {
  const controller: any = new InternalBrokerReconciliationController();
  const input = { userId: 'user-1', brokerKey: 'delta_exchange', accountId: 'acct-1' };
  const output = {
    runId: 'phase5-run-1',
    brokerKey: 'delta_exchange',
    accountId: 'acct-1',
    startedAt: '2026-06-08T10:00:00.000Z',
    finishedAt: '2026-06-08T10:00:01.000Z',
    matchBreakdown: {
      fillsMatchedByExecutionOrderId: 1,
      fillsMatchedBySubmissionOrderId: 0,
      fillsMatchedByPositionId: 0,
      fillsMatchedBySymbolTimeSide: 0,
      feeEntriesLinked: 1,
      fundingEntriesLinked: 0,
      walletTransactionsLinked: 1,
    },
    coverage: {
      appTradeCount: 1,
      appMatchedTradeCount: 1,
      brokerFillCount: 1,
      brokerMatchedFillCount: 1,
      brokerUnmatchedFillCount: 0,
      matchedFillCoveragePct: 100,
      matchedAppTradeCoveragePct: 100,
    },
    pnlComparison: {
      appGrossPnl: 1,
      appMatchedGrossPnl: 1,
      brokerGrossPnl: 1,
      brokerFeeTotal: -0.1,
      brokerFundingTotal: 0,
      brokerNetPnl: 0.9,
      grossDelta: 0,
      netDeltaVsAppGross: -0.1,
      unmatchedBrokerNotional: 0,
      unmatchedBrokerFillCount: 0,
      explanation: [],
    },
    latestSourceRun: null,
  };

  controller.brokerReconciliationMatchService = {
    async matchAndCompare(body: unknown) {
      assert.deepEqual(body, input);
      return output;
    },
  };

  assert.deepEqual(await controller.matchAndCompare(input), createSuccess(output));
}

function runScriptAndSourceWiringAssertions(): void {
  const packageJson = JSON.parse(read('package.json')) as { scripts?: Record<string, string> };
  assert.equal(
    packageJson.scripts?.['test:broker-reconciliation-match'],
    'node --import tsx scripts/_support/run-doc-aware-test.ts scripts/test-broker-reconciliation-match.ts'
  );

  const suiteSource = read('scripts/_support/run-package-suite.ts');
  assert.match(suiteSource, /'broker-reconciliation-match':\s*'baseline'/);
  assert.match(
    suiteSource,
    /'broker-reconciliation-match':\s*\['test:broker-reconciliation-match'\]/
  );
  assert.match(suiteSource, /'test:broker-reconciliation-match'/);

  const contractBarrel = read('src/api/contracts/index.ts');
  assert.match(contractBarrel, /export \* from '\.\/BrokerReconciliation'/);

  const serviceSource = read('src/api/services/BrokerReconciliationMatchService.ts');
  assert.match(serviceSource, /broker_app_match/);
  assert.match(serviceSource, /netDeltaVsAppGross/);
  assert.match(serviceSource, /matchedFillCoveragePct/);

  const repositorySource = read('src/database/repositories/BrokerReconciliationRepository.ts');
  assert.match(repositorySource, /linkFillsByExecutionOrderId/);
  assert.match(repositorySource, /linkFillsBySymbolTimeSide/);
  assert.match(repositorySource, /readComparisonTotals/);

  const internalControllerSource = read(
    'src/api/controllers/InternalBrokerReconciliationController.ts'
  );
  assert.match(internalControllerSource, /@Post\('\/match'\)/);
}

async function main(): Promise<void> {
  await runRepositoryMatchingAssertions();
  await runRepositoryComparisonAssertions();
  await runServiceAssertions();
  await runServiceFailureAssertions();
  await runInternalControllerAssertions();
  runScriptAndSourceWiringAssertions();
  console.log('Broker reconciliation match assertions passed.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
