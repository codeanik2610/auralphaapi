import { Container } from 'typedi';
import { BrokerWalletLiveFetchService } from '../src/api/services/BrokerWalletLiveFetchService';
import { BrokerAccountRepository } from '../src/database/repositories/BrokerAccountRepository';
import { FundsSnapshotRepository } from '../src/database/repositories/FundsSnapshotRepository';
import { coreDataSource } from '../src/database/data-source';

/**
 * Real Delta Exchange Account Test
 *
 * This script tests with REAL Delta Exchange API credentials
 * to verify the adapter works with actual broker data.
 *
 * Prerequisites:
 * 1. Have a Delta Exchange account connected in the system
 * 2. Account must have valid API credentials
 * 3. Database must be accessible
 *
 * Run: node --import tsx scripts/test-delta-real-account.ts [userId]
 *
 * Example: node --import tsx scripts/test-delta-real-account.ts 21d144c4-30c7-11f1-9717-4dce254b0a53
 */

interface TestConfig {
  userId: string;
  brokerKey: string;
  accountId?: string;
}

class RealAccountTester {
  private liveFetchService!: BrokerWalletLiveFetchService;
  private accountRepository!: BrokerAccountRepository;
  private snapshotRepository!: FundsSnapshotRepository;

  async initialize(): Promise<void> {
    console.log('🔌 Initializing services...\n');
    this.liveFetchService = Container.get(BrokerWalletLiveFetchService);
    this.accountRepository = Container.get(BrokerAccountRepository);
    this.snapshotRepository = Container.get(FundsSnapshotRepository);

    if (!coreDataSource.isInitialized) {
      throw new Error('Database not initialized');
    }
    console.log('✅ Services initialized\n');
  }

  async findDeltaAccounts(userId: string): Promise<any[]> {
    console.log(`🔍 Finding Delta Exchange accounts for user: ${userId}\n`);

    const accounts = await this.accountRepository.getConnectedBrokerAccounts(
      userId,
      'delta_exchange'
    );

    if (accounts.length === 0) {
      console.log('⚠️  No Delta Exchange accounts found for this user\n');
      console.log('Checking all broker accounts...\n');

      const allAccounts = await this.accountRepository.getConnectedBrokerAccounts(userId);
      console.log(`Found ${allAccounts.length} total accounts:\n`);
      allAccounts.forEach(acc => {
        console.log(`  • ${acc.brokerKey}: ${acc.accountName} (${acc.id})`);
      });
      console.log('');
    } else {
      console.log(`✅ Found ${accounts.length} Delta Exchange account(s):\n`);
      accounts.forEach(acc => {
        console.log(`  • ${acc.accountName} (${acc.id})`);
      });
      console.log('');
    }

    return accounts;
  }

  async testWithRealAccount(config: TestConfig): Promise<void> {
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║         Testing with Real Delta Exchange Account          ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    console.log('📋 Test Configuration:');
    console.log(`  User ID: ${config.userId}`);
    console.log(`  Broker: ${config.brokerKey}`);
    console.log(`  Account ID: ${config.accountId || 'auto-resolve'}\n`);

    try {
      // Test 1: Live Fetch
      console.log('🔴 Test 1: Live Fetch from Delta Exchange API\n');

      const startFetch = Date.now();
      const funds = await this.liveFetchService.fetchAccountFunds(
        config.userId,
        config.brokerKey,
        config.accountId
      );
      const fetchDuration = Date.now() - startFetch;

      console.log('✅ API call successful');
      console.log(`⏱️  Duration: ${fetchDuration}ms\n`);

      // Verify wallet funds
      console.log('📦 Wallet Funds Response:');
      console.log(JSON.stringify(funds.walletFunds, null, 2));
      console.log('');

      const wallet = funds.walletFunds as any;
      if (wallet.total !== 0) {
        console.log('❌ FAIL: Wallet total should be 0');
        console.log(`   Got: ${wallet.total}\n`);
      } else {
        console.log('✅ PASS: Wallet total is 0 (correct)\n');
      }

      // Verify futures funds
      console.log('📊 Futures Funds Response:');
      console.log(JSON.stringify(funds.futuresFunds, null, 2));
      console.log('');

      const futures = funds.futuresFunds as any;
      if (typeof futures.balance !== 'string') {
        console.log('❌ FAIL: Futures balance should be a string');
        console.log(`   Got type: ${typeof futures.balance}\n`);
      } else {
        console.log(`✅ PASS: Futures balance is "${futures.balance}" (string format)\n`);
      }

      // Test 2: Save Snapshot
      console.log('🔴 Test 2: Save to Database\n');

      const startSave = Date.now();
      const saveResult = await this.snapshotRepository.createSnapshot({
        userId: funds.userId,
        brokerKey: funds.brokerKey,
        accountId: funds.accountId,
        walletFunds: funds.walletFunds,
        futuresFunds: funds.futuresFunds,
        computedAt: new Date(),
        source: 'manual_test',
      });
      const saveDuration = Date.now() - startSave;

      console.log(`✅ Snapshot saved (inserted: ${saveResult.inserted}, updated: ${saveResult.updated})`);
      console.log(`⏱️  Duration: ${saveDuration}ms\n`);

      // Test 3: Retrieve from Database
      console.log('🔴 Test 3: Retrieve Latest Snapshot from Database\n');

      const snapshot = await this.snapshotRepository.getLatestSnapshot(
        funds.userId,
        funds.brokerKey,
        funds.accountId
      );

      if (!snapshot) {
        console.log('❌ FAIL: Could not retrieve snapshot from database\n');
        return;
      }

      console.log('✅ Snapshot retrieved');
      console.log(`📅 Snapshot Date: ${snapshot.snapshot_date}`);
      console.log(`🕐 Observed At: ${snapshot.observed_at}`);
      console.log(`📊 Status: ${snapshot.fetch_status}\n`);

      // Parse stored JSON
      const storedWallet = typeof snapshot.wallet_funds_json === 'string'
        ? JSON.parse(snapshot.wallet_funds_json)
        : snapshot.wallet_funds_json;

      const storedFutures = typeof snapshot.futures_funds_json === 'string'
        ? JSON.parse(snapshot.futures_funds_json)
        : snapshot.futures_funds_json;

      console.log('💾 Stored Wallet Funds:');
      console.log(JSON.stringify(storedWallet, null, 2));
      console.log('');

      console.log('💾 Stored Futures Funds:');
      console.log(JSON.stringify(storedFutures, null, 2));
      console.log('');

      // Verify stored data
      if (storedWallet.total !== 0) {
        console.log(`❌ FAIL: Stored wallet total should be 0, got ${storedWallet.total}\n`);
      } else {
        console.log('✅ PASS: Stored wallet total is 0\n');
      }

      // Test 4: Compare with Other Brokers
      console.log('🔴 Test 4: Compare with Mudrex (if available)\n');

      const mudrexAccounts = await this.accountRepository.getConnectedBrokerAccounts(
        config.userId,
        'mudrex'
      );

      if (mudrexAccounts.length > 0) {
        const mudrexAccount = mudrexAccounts[0];
        const mudrexFunds = await this.liveFetchService.fetchAccountFunds(
          config.userId,
          'mudrex',
          mudrexAccount.id
        );

        console.log('Mudrex Wallet:');
        console.log(JSON.stringify(mudrexFunds.walletFunds, null, 2));
        console.log('');

        console.log('Mudrex Futures:');
        console.log(JSON.stringify(mudrexFunds.futuresFunds, null, 2));
        console.log('');

        // Calculate totals
        const deltaWallet = (funds.walletFunds as any).total || 0;
        const deltaFutures = parseFloat((funds.futuresFunds as any).balance || '0');
        const mudrexWallet = (mudrexFunds.walletFunds as any).data?.total || 0;
        const mudrexFutures = parseFloat((mudrexFunds.futuresFunds as any).data?.balance || '0');

        console.log('📊 Portfolio Summary:');
        console.log('┌─────────────────┬──────────────┬──────────────┬──────────────┐');
        console.log('│ Broker          │ Wallet       │ Futures      │ Total        │');
        console.log('├─────────────────┼──────────────┼──────────────┼──────────────┤');
        console.log(`│ Delta Exchange  │ $${deltaWallet.toFixed(2).padStart(10)} │ $${deltaFutures.toFixed(2).padStart(10)} │ $${(deltaWallet + deltaFutures).toFixed(2).padStart(10)} │`);
        console.log(`│ Mudrex          │ $${mudrexWallet.toFixed(2).padStart(10)} │ $${mudrexFutures.toFixed(2).padStart(10)} │ $${(mudrexWallet + mudrexFutures).toFixed(2).padStart(10)} │`);
        console.log('├─────────────────┼──────────────┼──────────────┼──────────────┤');
        console.log(`│ Total           │ $${(deltaWallet + mudrexWallet).toFixed(2).padStart(10)} │ $${(deltaFutures + mudrexFutures).toFixed(2).padStart(10)} │ $${(deltaWallet + deltaFutures + mudrexWallet + mudrexFutures).toFixed(2).padStart(10)} │`);
        console.log('└─────────────────┴──────────────┴──────────────┴──────────────┘\n');

        if (deltaWallet === 0) {
          console.log('✅ PASS: Delta wallet is 0 (no double counting)\n');
        } else {
          console.log('❌ FAIL: Delta wallet should be 0\n');
        }
      } else {
        console.log('⏭️  Skipped - No Mudrex account found\n');
      }

      console.log('═══════════════════════════════════════════════════════════\n');
      console.log('✅ All Real Account Tests Completed\n');

    } catch (error) {
      console.log('\n❌ Test Failed:', error);
      throw error;
    }
  }
}

async function main() {
  const userId = process.argv[2];

  if (!userId) {
    console.log('❌ Error: User ID is required\n');
    console.log('Usage: node --import tsx scripts/test-delta-real-account.ts [userId]\n');
    console.log('Example: node --import tsx scripts/test-delta-real-account.ts 21d144c4-30c7-11f1-9717-4dce254b0a53\n');
    process.exit(1);
  }

  const tester = new RealAccountTester();

  try {
    await tester.initialize();

    const accounts = await tester.findDeltaAccounts(userId);

    if (accounts.length === 0) {
      console.log('❌ Cannot proceed without a Delta Exchange account\n');
      process.exit(1);
    }

    // Test with first Delta account
    const deltaAccount = accounts[0];

    await tester.testWithRealAccount({
      userId,
      brokerKey: 'delta_exchange',
      accountId: deltaAccount.id,
    });

    console.log('🎉 Test completed successfully!\n');
    process.exit(0);

  } catch (error) {
    console.error('\n💥 Test failed:', error);
    process.exit(1);
  }
}

main();
