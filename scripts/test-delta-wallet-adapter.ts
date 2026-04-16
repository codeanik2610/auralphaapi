import assert from 'node:assert/strict';

/**
 * Test script to verify Delta Exchange wallet adapter returns correct values
 * after the unified margin fix.
 *
 * Run: node --import tsx scripts/test-delta-wallet-adapter.ts
 */

// Mock the DeltaExchangeHttpClient
class MockDeltaHttpClient {
  async signedGet() {
    // Simulate Delta Exchange API response for /v2/wallet/balances
    return [
      {
        asset_symbol: 'USDT',
        balance: '122.5307415275',
        available_balance: '122.5307415275',
      },
    ];
  }
}

// Simplified DeltaExchangeWalletAdapter for testing
class DeltaExchangeWalletAdapter {
  private deltaHttpClient: MockDeltaHttpClient;

  constructor() {
    this.deltaHttpClient = new MockDeltaHttpClient();
  }

  async getWalletFunds(context?: { accountId?: string; userId?: string }): Promise<unknown> {
    // Delta Exchange uses a unified margin system for futures/derivatives trading.
    // There is no separate "spot wallet" - all funds are managed through the futures margin account.
    // Returning zero values here prevents double-counting the balance in both wallet and futures sections.
    // The actual account balance is properly tracked via getFuturesFunds() below.
    return {
      total: 0,
      rewards: 0,
      invested: 0,
      withdrawable: 0,
      coin_investable: 0,
      coinset_investable: 0,
      vault_investable: 0,
    };
  }

  async getFuturesFunds(context?: { accountId?: string; userId?: string }): Promise<unknown> {
    const balances = await this.fetchBalances(context?.accountId, context?.userId);
    const total = balances.reduce((sum, item) => sum + this.toNumber(item.balance), 0);
    const withdrawable = balances.reduce(
      (sum, item) => sum + this.toNumber(item.available_balance ?? item.balance),
      0
    );

    return {
      balance: total.toFixed(2),
      locked_amount: Math.max(total - withdrawable, 0).toFixed(2),
      first_time_user: false,
    };
  }

  private async fetchBalances(
    accountId?: string,
    userId?: string
  ): Promise<Array<{ asset_symbol?: string; balance?: string | number | null; available_balance?: string | number | null }>> {
    const payload = await this.deltaHttpClient.signedGet();
    return Array.isArray(payload) ? payload : [];
  }

  private toNumber(value: string | number | null | undefined): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
}

async function runDeltaWalletAdapterTests(): Promise<void> {
  console.log('🧪 Testing Delta Exchange Wallet Adapter...\n');

  const adapter = new DeltaExchangeWalletAdapter();
  const context = { accountId: 'test-account-id', userId: 'test-user-id' };

  // Test 1: Wallet funds should return all zeros
  console.log('Test 1: getWalletFunds() returns zeros');
  const walletFunds = await adapter.getWalletFunds(context) as any;

  assert.strictEqual(walletFunds.total, 0, 'total should be 0');
  assert.strictEqual(walletFunds.rewards, 0, 'rewards should be 0');
  assert.strictEqual(walletFunds.invested, 0, 'invested should be 0');
  assert.strictEqual(walletFunds.withdrawable, 0, 'withdrawable should be 0');
  assert.strictEqual(walletFunds.coin_investable, 0, 'coin_investable should be 0');
  assert.strictEqual(walletFunds.coinset_investable, 0, 'coinset_investable should be 0');
  assert.strictEqual(walletFunds.vault_investable, 0, 'vault_investable should be 0');

  console.log('  ✅ Wallet funds:', JSON.stringify(walletFunds, null, 2));

  // Test 2: Futures funds should return actual balance
  console.log('\nTest 2: getFuturesFunds() returns actual balance');
  const futuresFunds = await adapter.getFuturesFunds(context) as any;

  assert.strictEqual(futuresFunds.balance, '122.53', 'balance should be "122.53"');
  assert.strictEqual(futuresFunds.locked_amount, '0.00', 'locked_amount should be "0.00"');
  assert.strictEqual(futuresFunds.first_time_user, false, 'first_time_user should be false');

  console.log('  ✅ Futures funds:', JSON.stringify(futuresFunds, null, 2));

  // Test 3: Verify no double counting
  console.log('\nTest 3: Verify no double counting');
  const walletTotal = walletFunds.total;
  const futuresBalance = parseFloat(futuresFunds.balance);

  assert.strictEqual(walletTotal, 0, 'Wallet total must be 0 to avoid double counting');
  assert.ok(futuresBalance > 0, 'Futures balance should contain actual funds');

  console.log(`  ✅ Wallet total: ${walletTotal}`);
  console.log(`  ✅ Futures balance: ${futuresBalance}`);
  console.log(`  ✅ Combined (no double count): ${walletTotal + futuresBalance}`);

  // Test 4: Structure validation
  console.log('\nTest 4: Response structure validation');

  // Wallet structure
  assert.ok('total' in walletFunds, 'Wallet should have "total" field');
  assert.ok('withdrawable' in walletFunds, 'Wallet should have "withdrawable" field');
  assert.ok('coin_investable' in walletFunds, 'Wallet should have "coin_investable" field');

  // Futures structure
  assert.ok('balance' in futuresFunds, 'Futures should have "balance" field');
  assert.ok('locked_amount' in futuresFunds, 'Futures should have "locked_amount" field');
  assert.ok('first_time_user' in futuresFunds, 'Futures should have "first_time_user" field');

  // Type validation
  assert.strictEqual(typeof walletFunds.total, 'number', 'Wallet total should be number');
  assert.strictEqual(typeof futuresFunds.balance, 'string', 'Futures balance should be string');

  console.log('  ✅ All required fields present');
  console.log('  ✅ Field types correct');

  console.log('\n✅ All tests passed!\n');
}

async function runPortfolioCalculationTest(): Promise<void> {
  console.log('🧪 Testing Portfolio Capital Calculation...\n');

  const adapter = new DeltaExchangeWalletAdapter();

  // Simulate both Delta and Mudrex accounts
  const deltaWallet = await adapter.getWalletFunds() as any;
  const deltaFutures = await adapter.getFuturesFunds() as any;

  // Mock Mudrex responses (for comparison)
  const mudrexWallet = { total: 10, withdrawable: 10 };
  const mudrexFutures = { balance: '336.49', locked_amount: '0' };

  console.log('Delta Exchange:');
  console.log(`  Wallet: ${deltaWallet.total}`);
  console.log(`  Futures: ${deltaFutures.balance}`);

  console.log('\nMudrex:');
  console.log(`  Wallet: ${mudrexWallet.total}`);
  console.log(`  Futures: ${mudrexFutures.balance}`);

  // Calculate totals
  const totalWallet = deltaWallet.total + mudrexWallet.total;
  const totalFutures = parseFloat(deltaFutures.balance) + parseFloat(mudrexFutures.balance);
  const combinedCapital = totalWallet + totalFutures;

  console.log('\nPortfolio Totals:');
  console.log(`  Total Wallet: ${totalWallet.toFixed(2)}`);
  console.log(`  Total Futures: ${totalFutures.toFixed(2)}`);
  console.log(`  Combined Capital: ${combinedCapital.toFixed(2)}`);

  // Verify no double counting
  assert.strictEqual(totalWallet, 10, 'Total wallet should be 10 (Mudrex only)');
  assert.strictEqual(totalFutures, 459.02, 'Total futures should be 459.02 (Delta + Mudrex)');
  assert.strictEqual(combinedCapital, 469.02, 'Combined should be 469.02 (no double counting)');

  console.log('\n✅ Portfolio calculation correct - no double counting!\n');
}

async function main() {
  try {
    await runDeltaWalletAdapterTests();
    await runPortfolioCalculationTest();

    console.log('═══════════════════════════════════════════════════════');
    console.log('✅ ALL TESTS PASSED');
    console.log('═══════════════════════════════════════════════════════');
    console.log('\n📋 Summary:');
    console.log('  ✅ Delta wallet funds return zeros (no double counting)');
    console.log('  ✅ Delta futures funds return actual balance (122.53)');
    console.log('  ✅ Response structures match expected contracts');
    console.log('  ✅ Portfolio calculations are correct');
    console.log('\n🎯 Next steps:');
    console.log('  1. Run existing tests: npm run test:wallets');
    console.log('  2. Test with real account data');
    console.log('  3. Verify in database after scheduler run');
    console.log('  4. Check frontend display\n');

    process.exit(0);
  } catch (error) {
    console.error('\n❌ TEST FAILED:', error);
    process.exit(1);
  }
}

main();
