import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { BrokerWalletLiveFetchService } from '../src/api/services/BrokerWalletLiveFetchService';
import { FundsSchedulerService } from '../src/api/services/FundsSchedulerService';
import { env } from '../src/env';

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function testFundsFunctionalChecklistBaseline(): void {
  const findings: string[] = [];

  const checklist = read('FUNDS_SYNC_FUNCTIONAL_CHECKLIST.md');
  for (const marker of [
    'Scheduler key: `funds-sync`',
    'Product route base: `/wallet`',
    'Internal execution route: `/internal/funds/snapshot`',
    '## 5. Scheduler And Cron All-Users Execution Scope',
    '## 8. Summary, Coverage, Recovery, And Product Read Boundary',
    '## 14. Time And Timezone Checks',
  ]) {
    if (!checklist.includes(marker)) {
      findings.push(`FUNDS_SYNC_FUNCTIONAL_CHECKLIST.md: missing marker ${marker}`);
    }
  }

  const readme = read('README.md');
  if (!readme.includes('FUNDS_SYNC_FUNCTIONAL_CHECKLIST.md')) {
    findings.push('README.md: missing funds functional checklist reference');
  }

  assert.equal(findings.length, 0, `Funds functional checklist guard failed:\n${findings.join('\n')}`);
}

async function testBrokerWalletLiveFetchServiceUsesRuntimeAdapters(): Promise<void> {
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
  } as any;
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
  } as any;

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
}

async function testFundsSchedulerBootstrapsFirstSnapshotFromLiveFunds(): Promise<void> {
  const service = new FundsSchedulerService() as any;
  const snapshotWrites: Array<Record<string, unknown>> = [];

  service.brokerAccountRepository = {
    async getActiveBrokerAccounts(userId: string) {
      assert.equal(userId, 'user-1');
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
      assert.fail('owner-specific bootstrap should not query system accounts');
    },
    async getAllActiveBrokerAccounts() {
      assert.fail('owner-specific bootstrap should not query infra-all accounts');
    },
  } as any;
  service.brokerWalletLiveFetchService = {
    async fetchAccountFunds(userId: string, brokerKey: string, accountId: string) {
      assert.equal(userId, 'user-1');
      assert.equal(brokerKey, 'mudrex');
      assert.equal(accountId, 'acct-1');
      return {
        userId,
        brokerKey,
        accountId,
        walletFunds: {
          total: 1000,
          withdrawable: 875,
        },
        futuresFunds: {
          balance: '220.00',
          locked_amount: '10.00',
          first_time_user: false,
        },
      };
    },
  } as any;
  service.fundsSnapshotRepository = {
    async createSnapshot(payload: Record<string, unknown>) {
      snapshotWrites.push(payload);
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

  assert.deepEqual(result, {
    totalAccounts: 1,
    successCount: 1,
    insertedCount: 1,
    updatedCount: 0,
    failureCount: 0,
    failures: [],
  });
  assert.equal(snapshotWrites.length, 1);
  assert.equal(snapshotWrites[0].userId, 'user-1');
  assert.equal(snapshotWrites[0].brokerKey, 'mudrex');
  assert.equal(snapshotWrites[0].accountId, 'acct-1');
  assert.deepEqual(snapshotWrites[0].walletFunds, {
    total: 1000,
    withdrawable: 875,
  });
  assert.deepEqual(snapshotWrites[0].futuresFunds, {
    balance: '220.00',
    locked_amount: '10.00',
    first_time_user: false,
  });
  assert.ok(snapshotWrites[0].computedAt instanceof Date);
}

async function testFundsSchedulerInfraRunSkipsOwnerlessSystemAccounts(): Promise<void> {
  const service = new FundsSchedulerService() as any;
  const fetchCalls: Array<Record<string, unknown>> = [];
  const snapshotWrites: Array<Record<string, unknown>> = [];

  service.brokerAccountRepository = {
    async getAllActiveBrokerAccounts() {
      return [
        {
          id: 'acct-delta-admin',
          userId: 'admin-user',
          brokerKey: 'delta_exchange',
          status: 'Connected',
        },
        {
          id: 'acct-delta-codeanik',
          userId: 'codeanik-user',
          brokerKey: 'delta_exchange',
          status: 'Connected',
        },
        {
          id: 'acct-mudrex-admin',
          userId: 'admin-user',
          brokerKey: 'mudrex',
          status: 'Connected',
        },
        {
          id: 'acct-mudrex-codeanik',
          userId: 'codeanik-user',
          brokerKey: 'mudrex',
          status: 'Connected',
        },
        {
          id: 'acct-system-delta',
          userId: null,
          brokerKey: 'delta_exchange',
          status: 'Connected',
        },
        {
          id: 'acct-system-mudrex',
          userId: null,
          brokerKey: 'mudrex',
          status: 'Connected',
        },
      ];
    },
    async getActiveBrokerAccounts() {
      assert.fail('infra-all run should not query per-user account lists');
    },
    async getActiveSystemBrokerAccounts() {
      assert.fail('infra-all run should not query legacy system-only account lists');
    },
  } as any;
  service.brokerWalletLiveFetchService = {
    async fetchAccountFunds(userId: string, brokerKey: string, accountId: string) {
      fetchCalls.push({ userId, brokerKey, accountId });
      return {
        userId,
        brokerKey,
        accountId,
        walletFunds: {
          total: 300,
        },
        futuresFunds: {
          balance: '40.00',
          locked_amount: '0.00',
          first_time_user: false,
        },
      };
    },
  } as any;
  service.fundsSnapshotRepository = {
    async createSnapshot(payload: Record<string, unknown>) {
      snapshotWrites.push(payload);
      return {
        inserted: String(payload.accountId || '').includes('delta'),
        updated: String(payload.accountId || '').includes('mudrex'),
      };
    },
  } as any;

  const result = await service.runSnapshotBatch({
    targetUserIds: [env.scheduler.systemUserId],
    brokerKeys: [],
    accountIds: [],
  });

  assert.deepEqual(fetchCalls, [
    {
      userId: 'admin-user',
      brokerKey: 'delta_exchange',
      accountId: 'acct-delta-admin',
    },
    {
      userId: 'admin-user',
      brokerKey: 'mudrex',
      accountId: 'acct-mudrex-admin',
    },
    {
      userId: 'codeanik-user',
      brokerKey: 'delta_exchange',
      accountId: 'acct-delta-codeanik',
    },
    {
      userId: 'codeanik-user',
      brokerKey: 'mudrex',
      accountId: 'acct-mudrex-codeanik',
    },
  ]);
  assert.equal(snapshotWrites.length, 4);
  assert.deepEqual(
    snapshotWrites.map((entry) => ({
      userId: entry.userId,
      brokerKey: entry.brokerKey,
      accountId: entry.accountId,
    })),
    fetchCalls
  );
  assert.equal(result.totalAccounts, 4);
  assert.equal(result.successCount, 4);
  assert.equal(result.insertedCount, 2);
  assert.equal(result.updatedCount, 2);
  assert.equal(result.failureCount, 0);
  assert.deepEqual(result.failures, []);
}

async function run(): Promise<void> {
  testFundsFunctionalChecklistBaseline();
  await testBrokerWalletLiveFetchServiceUsesRuntimeAdapters();
  await testFundsSchedulerBootstrapsFirstSnapshotFromLiveFunds();
  await testFundsSchedulerInfraRunSkipsOwnerlessSystemAccounts();
  console.log('Funds scheduler phase 1 assertions passed.');
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
