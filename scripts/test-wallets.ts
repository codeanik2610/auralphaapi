import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { LeverageController } from '../src/api/controllers/LeverageController';
import { WalletController } from '../src/api/controllers/WalletController';
import { BrokerWalletFacadeService } from '../src/api/services/BrokerWalletFacadeService';
import { BrokerWalletLiveFetchService } from '../src/api/services/BrokerWalletLiveFetchService';

function createSuccess<T>(data: T) {
  return { success: true as const, data };
}

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

async function runWalletControllerAssertions(): Promise<void> {
  const controller: any = new WalletController();

  controller.walletService = {
    getWalletFunds: async (...args: unknown[]) => createSuccess({ args }),
    getWalletFundsForActiveAccounts: async (...args: unknown[]) => createSuccess({ args }),
    getFuturesFunds: async (...args: unknown[]) => createSuccess({ args }),
    getFuturesFundsForActiveAccounts: async (...args: unknown[]) => createSuccess({ args }),
  };

  assert.deepEqual((await controller.getWalletFunds(authReq, 'mudrex', 'acct-1')).data.args, [
    'user-1',
    'mudrex',
    'acct-1',
  ]);
  assert.deepEqual((await controller.getActiveWalletFunds(authReq, 'mudrex')).data.args, [
    'user-1',
    'mudrex',
  ]);
  assert.deepEqual((await controller.getFuturesFunds(authReq, 'mudrex', 'acct-1')).data.args, [
    'user-1',
    'mudrex',
    'acct-1',
  ]);
  assert.deepEqual((await controller.getActiveFuturesFunds(authReq, 'mudrex')).data.args, [
    'user-1',
    'mudrex',
  ]);

  await assertAuthRequired(() => controller.getWalletFunds(unauthReq));
  await assertAuthRequired(() => controller.getActiveWalletFunds(unauthReq));
  await assertAuthRequired(() => controller.getFuturesFunds(unauthReq));
  await assertAuthRequired(() => controller.getActiveFuturesFunds(unauthReq));
}

async function runLeverageControllerAssertions(): Promise<void> {
  const controller: any = new LeverageController();

  controller.brokerReferenceDataService = {
    getLeverageByAssetId: async (...args: unknown[]) => createSuccess({ args }),
    getLeverageBySymbol: async (...args: unknown[]) => createSuccess({ args }),
  };

  assert.deepEqual(
    (await controller.getFuturesLeverageByAssetId(authReq, 'mudrex', 'asset-1')).data.args,
    ['mudrex', 'asset-1']
  );
  assert.deepEqual(
    (await controller.getFuturesLeverageBySymbol(authReq, 'mudrex', 'BTCUSDT')).data.args,
    ['mudrex', 'BTCUSDT']
  );

  await assertAuthRequired(() =>
    controller.getFuturesLeverageByAssetId(unauthReq, 'mudrex', 'asset-1')
  );
  await assertAuthRequired(() =>
    controller.getFuturesLeverageBySymbol(unauthReq, 'mudrex', 'BTCUSDT')
  );
}

async function runBrokerWalletFacadeServiceAssertions(): Promise<void> {
  const service = new BrokerWalletFacadeService() as any;

  service.brokerAccountRoutingService = {
    async resolve(userId: string, brokerKey?: string, accountId?: string, fallbackBrokerKey?: string) {
      return {
        userId,
        brokerKey: brokerKey || fallbackBrokerKey || 'mudrex',
        accountId: accountId || 'acct-1',
      };
    },
  };
  service.fundsSnapshotRepository = {
    async getLatestSnapshot(_userId: string, brokerKey: string, accountId: string) {
      return {
        wallet_funds_json: { total: 1250, brokerKey, accountId },
        futures_funds_json: JSON.stringify({ balance: '320.00', brokerKey, accountId }),
        observed_at: new Date('2026-04-13T02:15:00.000Z'),
        computed_at: new Date('2026-04-13T02:16:00.000Z'),
        created_at: new Date('2026-04-13T02:16:30.000Z'),
      };
    },
  };
  service.brokerAccountRepository = {
    async getConnectedBrokerAccounts() {
      return [
        {
          id: 'acct-1',
          accountName: 'Primary wallet',
          accountKey: 'primary',
          brokerKey: 'mudrex',
          status: 'Connected',
        },
        {
          id: 'acct-2',
          accountName: 'Backup wallet',
          accountKey: 'backup',
          brokerKey: 'mudrex',
          status: 'Connected',
        },
      ];
    },
  };

  const directWalletFunds = await service.getWalletFunds('user-1', 'mudrex', 'acct-1');
  assert.deepEqual(directWalletFunds, {
    total: 1250,
    brokerKey: 'mudrex',
    accountId: 'acct-1',
  });

  const directFuturesFunds = await service.getFuturesFunds('user-1', 'mudrex', 'acct-1');
  assert.deepEqual(directFuturesFunds, {
    balance: '320.00',
    brokerKey: 'mudrex',
    accountId: 'acct-1',
  });

  service.brokerAccountRoutingService = {
    async resolve(_userId: string, _brokerKey?: string, accountId?: string, fallbackBrokerKey?: string) {
      if (accountId === 'acct-2') {
        throw new Error('No snapshot available');
      }
      return {
        brokerKey: fallbackBrokerKey || 'mudrex',
        accountId: accountId || 'acct-1',
      };
    },
  };

  const activeWallets = await service.getWalletFundsForActiveAccounts('user-1', 'mudrex');
  assert.equal((activeWallets as any).totalActiveAccounts, 2);
  assert.equal((activeWallets as any).successCount, 1);
  assert.equal((activeWallets as any).failureCount, 1);
  assert.equal((activeWallets as any).items[0].observedAt, '2026-04-13T02:15:00.000Z');
  assert.equal((activeWallets as any).items[1].error, 'No snapshot available');

  const activeFutures = await service.getFuturesFundsForActiveAccounts('user-1', 'mudrex');
  assert.equal((activeFutures as any).successCount, 1);
  assert.equal((activeFutures as any).failureCount, 1);
  assert.equal((activeFutures as any).items[0].funds.balance, '320.00');
}

async function runBrokerWalletLiveFetchServiceAssertions(): Promise<void> {
  const service = new BrokerWalletLiveFetchService() as any;
  const contexts: Array<Record<string, unknown>> = [];

  service.brokerAccountRoutingService = {
    async resolve(userId: string, brokerKey?: string, accountId?: string, fallbackBrokerKey?: string) {
      assert.equal(userId, 'user-1');
      assert.equal(brokerKey, 'mudrex');
      assert.equal(accountId, 'acct-1');
      assert.equal(fallbackBrokerKey, 'mudrex');
      return {
        userId,
        brokerKey: 'mudrex',
        accountId: 'acct-1',
      };
    },
  };
  service.brokerRuntimeRegistry = {
    getWalletAdapter(brokerKey: string) {
      assert.equal(brokerKey, 'mudrex');
      return {
        async getWalletFunds(context: Record<string, unknown>) {
          contexts.push({ kind: 'wallet', ...context });
          return {
            success: true,
            data: {
              total: 1250,
              withdrawable: 900,
            },
          };
        },
        async getFuturesFunds(context: Record<string, unknown>) {
          contexts.push({ kind: 'futures', ...context });
          return {
            data: {
              balance: '320.00',
              locked_amount: '15.00',
              first_time_user: false,
            },
          };
        },
      };
    },
  };

  const result = await service.fetchAccountFunds('user-1', 'mudrex', 'acct-1');
  assert.deepEqual(result, {
    userId: 'user-1',
    brokerKey: 'mudrex',
    accountId: 'acct-1',
    walletFunds: {
      total: 1250,
      withdrawable: 900,
    },
    futuresFunds: {
      balance: '320.00',
      locked_amount: '15.00',
      first_time_user: false,
    },
  });
  assert.deepEqual(contexts, [
    {
      kind: 'wallet',
      userId: 'user-1',
      brokerKey: 'mudrex',
      accountId: 'acct-1',
    },
    {
      kind: 'futures',
      userId: 'user-1',
      brokerKey: 'mudrex',
      accountId: 'acct-1',
    },
  ]);

  service.brokerAccountRoutingService = {
    async resolve() {
      return {
        brokerKey: '',
        accountId: '',
      };
    },
  };

  await assert.rejects(
    () => service.fetchAccountFunds('user-1'),
    /Live funds fetch requires brokerKey and accountId/
  );
}

function runWalletsScriptWiringAssertions(): void {
  const packageSource = read('package.json');
  const packageJson = JSON.parse(packageSource) as { scripts?: Record<string, string> };
  const packageScripts = packageJson.scripts || {};
  const runPackageSuiteSource = read('scripts/_support/run-package-suite.ts');
  const smokeModulesSource = read('scripts/smokes/smoke-modules.sh');

  assert.equal(
    packageScripts['test:wallets'],
    'node --import tsx scripts/_support/run-doc-aware-test.ts scripts/test-wallets.ts'
  );
  assert.match(runPackageSuiteSource, /wallets:\s*\['test:wallets'\]/);
  assert.match(smokeModulesSource, /\/wallet\/funds\/active/);
  assert.match(smokeModulesSource, /\/wallet\/futures\/funds\/active/);
  assert.equal(
    packageScripts['check:wallets-health'],
    'node --import tsx scripts/checks/check-wallets-health.ts'
  );
}

async function main(): Promise<void> {
  await runWalletControllerAssertions();
  await runLeverageControllerAssertions();
  await runBrokerWalletFacadeServiceAssertions();
  await runBrokerWalletLiveFetchServiceAssertions();
  runWalletsScriptWiringAssertions();
  console.log('Wallets module assertions passed.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
