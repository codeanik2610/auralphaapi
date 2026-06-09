import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { InternalBrokerReconciliationController } from '../src/api/controllers/InternalBrokerReconciliationController';
import { BrokerReconciliationBatchResponse } from '../src/api/contracts/BrokerReconciliation';
import { BrokerReconciliationBatchService } from '../src/api/services/BrokerReconciliationBatchService';
import { BrokerAccount } from '../src/database/entities/BrokerAccount';

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function createSuccess<T>(data: T) {
  return { success: true as const, data };
}

function account(overrides: Partial<BrokerAccount>): BrokerAccount {
  return {
    id: 'acct-1',
    userId: 'user-1',
    brokerKey: 'mudrex',
    connectionId: 'connection-1',
    brokerId: null,
    accountKey: 'account-key',
    accountName: 'Account',
    status: 'Connected',
    mode: null,
    lastSyncAt: null,
    purpose: null,
    capabilities: null,
    settings: null,
    isDefault: false,
    createdAt: new Date('2026-06-09T00:00:00.000Z'),
    updatedAt: new Date('2026-06-09T00:00:00.000Z'),
    ...overrides,
  };
}

function createMatchResult(runId: string, brokerKey: string, accountId: string) {
  return {
    runId,
    brokerKey,
    accountId,
    startedAt: '2026-06-09T10:00:00.000Z',
    finishedAt: '2026-06-09T10:00:01.000Z',
    matchBreakdown: {
      fillsMatchedByExecutionOrderId: 0,
      fillsMatchedBySubmissionOrderId: 0,
      fillsMatchedByPositionId: 0,
      fillsMatchedBySymbolTimeSide: 0,
      feeEntriesLinked: 0,
      fundingEntriesLinked: 0,
      walletTransactionsLinked: 0,
    },
    coverage: {
      appTradeCount: 0,
      appMatchedTradeCount: 0,
      brokerFillCount: 0,
      brokerMatchedFillCount: 0,
      brokerUnmatchedFillCount: 0,
      matchedFillCoveragePct: 0,
      matchedAppTradeCoveragePct: 0,
    },
    pnlComparison: {
      appGrossPnl: 0,
      appMatchedGrossPnl: 0,
      brokerGrossPnl: 0,
      brokerFeeTotal: 0,
      brokerFundingTotal: 0,
      brokerNetPnl: 0,
      grossDelta: 0,
      netDeltaVsAppGross: 0,
      unmatchedBrokerNotional: 0,
      unmatchedBrokerFillCount: 0,
      explanation: [],
    },
    latestSourceRun: null,
  };
}

async function runServiceBatchAssertions(): Promise<void> {
  const service: any = new BrokerReconciliationBatchService();
  const calls: Array<{ method: string; args: unknown[] }> = [];

  service.brokerAccountRepository = {
    async getAllActiveBrokerAccounts() {
      calls.push({ method: 'getAllActiveBrokerAccounts', args: [] });
      return [
        account({ id: 'mudrex-1', userId: 'user-1', brokerKey: 'mudrex' }),
        account({ id: 'delta-1', userId: 'user-2', brokerKey: 'delta_exchange' }),
        account({ id: 'paper-1', userId: 'user-3', brokerKey: 'paper' }),
        account({ id: 'system-null-1', userId: null, brokerKey: 'mudrex' }),
      ];
    },
  };
  service.mudrexBrokerReconciliationSyncService = {
    async syncAccount(input: unknown) {
      calls.push({ method: 'mudrex.syncAccount', args: [input] });
      return {
        runId: 'mudrex-sync-run-1',
        brokerKey: 'mudrex',
        accountId: 'mudrex-1',
      };
    },
  };
  service.deltaBrokerReconciliationSyncService = {
    async syncAccount(input: unknown) {
      calls.push({ method: 'delta.syncAccount', args: [input] });
      return {
        runId: 'delta-sync-run-1',
        brokerKey: 'delta_exchange',
        accountId: 'delta-1',
      };
    },
  };
  service.brokerReconciliationMatchService = {
    async matchAndCompare(input: any) {
      calls.push({ method: 'matchAndCompare', args: [input] });
      return createMatchResult(`${input.brokerKey}-match-run-1`, input.brokerKey, input.accountId);
    },
  };

  const result: BrokerReconciliationBatchResponse = await service.runBatch({
    startDate: '2026-06-08',
    endDate: '2026-06-09',
    fallbackWindowMinutes: 45,
  });

  assert.equal(result.summary.totalAccounts, 4);
  assert.equal(result.summary.completedAccounts, 2);
  assert.equal(result.summary.skippedAccounts, 1);
  assert.equal(result.summary.unsupportedBrokerAccounts, 1);
  assert.equal(result.summary.syncFailedAccounts, 0);
  assert.equal(result.summary.matchFailedAccounts, 0);
  assert.equal(result.requested.sync, true);
  assert.equal(result.requested.match, true);
  assert.equal(result.requested.fallbackWindowMinutes, 45);
  assert.equal(
    result.results.find((item) => item.accountId === 'mudrex-1')?.sync.runId,
    'mudrex-sync-run-1'
  );
  assert.equal(
    result.results.find((item) => item.accountId === 'delta-1')?.match.runId,
    'delta_exchange-match-run-1'
  );
  assert.equal(
    result.results.find((item) => item.accountId === 'paper-1')?.status,
    'unsupported_broker'
  );
  assert.equal(
    result.results.find((item) => item.accountId === 'system-null-1')?.status,
    'skipped'
  );

  assert.deepEqual(calls.find((call) => call.method === 'mudrex.syncAccount')?.args[0], {
    userId: 'user-1',
    accountId: 'mudrex-1',
    startDate: '2026-06-08',
    endDate: '2026-06-09',
  });
  assert.deepEqual(calls.find((call) => call.method === 'delta.syncAccount')?.args[0], {
    userId: 'user-2',
    accountId: 'delta-1',
    startDate: '2026-06-08',
    endDate: '2026-06-09',
  });
  assert.deepEqual(calls.find((call) => call.method === 'matchAndCompare')?.args[0], {
    userId: 'user-1',
    brokerKey: 'mudrex',
    accountId: 'mudrex-1',
    startDate: '2026-06-08',
    endDate: '2026-06-09',
    fallbackWindowMinutes: 45,
  });
}

async function runServiceFailureAssertions(): Promise<void> {
  const service: any = new BrokerReconciliationBatchService();
  const calls: Array<{ method: string; args: unknown[] }> = [];

  service.brokerAccountRepository = {};
  service.mudrexBrokerReconciliationSyncService = {
    async syncAccount(input: unknown) {
      calls.push({ method: 'mudrex.syncAccount', args: [input] });
      throw new Error('mudrex unavailable');
    },
  };
  service.deltaBrokerReconciliationSyncService = {
    async syncAccount(input: unknown) {
      calls.push({ method: 'delta.syncAccount', args: [input] });
      return { runId: 'delta-sync-run-2', brokerKey: 'delta_exchange', accountId: 'delta-2' };
    },
  };
  service.brokerReconciliationMatchService = {
    async matchAndCompare(input: unknown) {
      calls.push({ method: 'matchAndCompare', args: [input] });
      throw new Error('match comparison failed');
    },
  };

  const result: BrokerReconciliationBatchResponse = await service.runBatch({
    accounts: [
      { userId: 'user-1', brokerKey: 'mudrex', accountId: 'mudrex-2' },
      { userId: 'user-2', brokerKey: 'delta_exchange', accountId: 'delta-2' },
    ],
  });

  assert.equal(result.summary.totalAccounts, 2);
  assert.equal(result.summary.syncFailedAccounts, 1);
  assert.equal(result.summary.matchFailedAccounts, 1);
  assert.equal(result.results.find((item) => item.accountId === 'mudrex-2')?.status, 'sync_failed');
  assert.equal(
    result.results.find((item) => item.accountId === 'mudrex-2')?.sync.errorMessage,
    'mudrex unavailable'
  );
  assert.equal(result.results.find((item) => item.accountId === 'delta-2')?.status, 'match_failed');
  assert.equal(
    result.results.find((item) => item.accountId === 'delta-2')?.match.errorMessage,
    'match comparison failed'
  );
  assert.equal(calls.filter((call) => call.method === 'matchAndCompare').length, 1);
}

async function runServiceFilterAssertions(): Promise<void> {
  const service: any = new BrokerReconciliationBatchService();
  const calls: Array<{ method: string; args: unknown[] }> = [];

  service.brokerAccountRepository = {};
  service.mudrexBrokerReconciliationSyncService = {
    async syncAccount(input: unknown) {
      calls.push({ method: 'mudrex.syncAccount', args: [input] });
      return { runId: 'mudrex-sync-run-3', brokerKey: 'mudrex', accountId: 'mudrex-3' };
    },
  };
  service.deltaBrokerReconciliationSyncService = {
    async syncAccount(input: unknown) {
      calls.push({ method: 'delta.syncAccount', args: [input] });
      return { runId: 'delta-sync-run-3', brokerKey: 'delta_exchange', accountId: 'delta-3' };
    },
  };
  service.brokerReconciliationMatchService = {
    async matchAndCompare(input: any) {
      calls.push({ method: 'matchAndCompare', args: [input] });
      return createMatchResult('mudrex-match-run-3', input.brokerKey, input.accountId);
    },
  };

  const result: BrokerReconciliationBatchResponse = await service.runBatch({
    accounts: [
      { userId: 'user-1', brokerKey: 'mudrex', accountId: 'mudrex-3' },
      { userId: 'user-1', brokerKey: 'mudrex', accountId: 'mudrex-3' },
      { userId: 'user-2', brokerKey: 'delta_exchange', accountId: 'delta-3' },
    ],
    brokerKeys: ['mudrex'],
    accountIds: ['mudrex-3'],
    sync: false,
  });

  assert.equal(result.summary.totalAccounts, 1);
  assert.equal(result.summary.completedAccounts, 1);
  assert.equal(result.results[0].accountId, 'mudrex-3');
  assert.equal(result.results[0].sync.status, 'skipped');
  assert.equal(result.results[0].match.status, 'completed');
  assert.equal(
    calls.some((call) => call.method === 'mudrex.syncAccount'),
    false
  );
  assert.equal(calls.filter((call) => call.method === 'matchAndCompare').length, 1);
}

async function runInternalControllerAssertions(): Promise<void> {
  const controller: any = new InternalBrokerReconciliationController();
  const input = { targetUserIds: ['user-1'], brokerKeys: ['mudrex'] };
  const output = {
    startedAt: '2026-06-09T10:00:00.000Z',
    finishedAt: '2026-06-09T10:00:01.000Z',
    requested: {
      sync: true,
      match: true,
      startDate: null,
      endDate: null,
      fallbackWindowMinutes: null,
    },
    summary: {
      totalAccounts: 0,
      completedAccounts: 0,
      skippedAccounts: 0,
      unsupportedBrokerAccounts: 0,
      syncFailedAccounts: 0,
      matchFailedAccounts: 0,
    },
    results: [],
  };

  controller.brokerReconciliationBatchService = {
    async runBatch(body: unknown) {
      assert.deepEqual(body, input);
      return output;
    },
  };

  assert.deepEqual(await controller.runBatch(input), createSuccess(output));
}

function runScriptAndSourceWiringAssertions(): void {
  const packageJson = JSON.parse(read('package.json')) as { scripts?: Record<string, string> };
  assert.equal(
    packageJson.scripts?.['test:broker-reconciliation-batch'],
    'node --import tsx scripts/_support/run-doc-aware-test.ts scripts/test-broker-reconciliation-batch.ts'
  );

  const suiteSource = read('scripts/_support/run-package-suite.ts');
  assert.match(suiteSource, /'broker-reconciliation-batch':\s*'baseline'/);
  assert.match(
    suiteSource,
    /'broker-reconciliation-batch':\s*\['test:broker-reconciliation-batch'\]/
  );
  assert.match(suiteSource, /'test:broker-reconciliation-batch'/);

  const controllerSource = read('src/api/controllers/InternalBrokerReconciliationController.ts');
  assert.match(controllerSource, /@Post\('\/batch'\)/);

  const serviceSource = read('src/api/services/BrokerReconciliationBatchService.ts');
  assert.match(serviceSource, /MudrexBrokerReconciliationSyncService/);
  assert.match(serviceSource, /DeltaBrokerReconciliationSyncService/);
  assert.match(serviceSource, /matchAndCompare/);
  assert.match(serviceSource, /unsupported_broker/);
}

async function main(): Promise<void> {
  await runServiceBatchAssertions();
  await runServiceFailureAssertions();
  await runServiceFilterAssertions();
  await runInternalControllerAssertions();
  runScriptAndSourceWiringAssertions();
  console.log('Broker reconciliation batch assertions passed.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
