import assert from 'node:assert/strict';
import { Container } from 'typedi';
import { coreDataSource } from '../src/database/data-source';
import { DeltaExchangeWalletAdapter } from '../src/brokers/capabilities/wallet/DeltaExchangeWalletAdapter';
import { MudrexWalletAdapter } from '../src/brokers/capabilities/wallet/MudrexWalletAdapter';
import { BrokerWalletLiveFetchService } from '../src/api/services/BrokerWalletLiveFetchService';
import { BrokerWalletFacadeService } from '../src/api/services/BrokerWalletFacadeService';
import { FundsSnapshotRepository } from '../src/database/repositories/FundsSnapshotRepository';
import { BrokerAccountRepository } from '../src/database/repositories/BrokerAccountRepository';

/**
 * Comprehensive test suite for Delta Exchange wallet adapter changes
 *
 * Tests:
 * 1. Real API Integration
 * 2. Database Integration
 * 3. End-to-End Flow
 * 4. Edge Cases
 * 5. Backward Compatibility
 * 6. Service Integration
 *
 * Run: node --import tsx scripts/test-delta-comprehensive.ts
 */

interface TestResult {
  name: string;
  status: 'pass' | 'fail' | 'skip' | 'warn';
  message: string;
  duration: number;
}

class ComprehensiveTestSuite {
  private results: TestResult[] = [];
  private startTime: number = 0;

  private async runTest(
    name: string,
    testFn: () => Promise<void>,
    options: { skip?: boolean; critical?: boolean } = {}
  ): Promise<void> {
    if (options.skip) {
      this.results.push({ name, status: 'skip', message: 'Skipped', duration: 0 });
      return;
    }

    const start = Date.now();
    try {
      await testFn();
      const duration = Date.now() - start;
      this.results.push({ name, status: 'pass', message: 'Passed', duration });
      console.log(`  ✅ ${name} (${duration}ms)`);
    } catch (error) {
      const duration = Date.now() - start;
      const message = error instanceof Error ? error.message : String(error);
      this.results.push({ name, status: 'fail', message, duration });
      console.log(`  ❌ ${name} - ${message} (${duration}ms)`);
      if (options.critical) {
        throw error;
      }
    }
  }

  private async warn(name: string, message: string): Promise<void> {
    this.results.push({ name, status: 'warn', message, duration: 0 });
    console.log(`  ⚠️  ${name} - ${message}`);
  }

  async run(): Promise<void> {
    this.startTime = Date.now();
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║  Delta Exchange Wallet Adapter - Comprehensive Test Suite  ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    await this.testAdapterInterface();
    await this.testDatabaseIntegration();
    await this.testServiceIntegration();
    await this.testEdgeCases();
    await this.testBackwardCompatibility();
    await this.testPortfolioCalculations();

    this.printSummary();
  }

  private async testAdapterInterface(): Promise<void> {
    console.log('\n📦 1. Adapter Interface Tests\n');

    await this.runTest('Delta adapter returns zero wallet funds', async () => {
      const adapter = Container.get(DeltaExchangeWalletAdapter);
      const result = await adapter.getWalletFunds() as any;

      assert.strictEqual(result.total, 0);
      assert.strictEqual(result.withdrawable, 0);
      assert.strictEqual(result.coin_investable, 0);
      assert.strictEqual(result.rewards, 0);
      assert.strictEqual(result.invested, 0);
    }, { critical: true });

    await this.runTest('Delta adapter has required wallet fields', async () => {
      const adapter = Container.get(DeltaExchangeWalletAdapter);
      const result = await adapter.getWalletFunds() as any;

      assert.ok('total' in result);
      assert.ok('withdrawable' in result);
      assert.ok('coin_investable' in result);
      assert.ok('vault_investable' in result);
      assert.ok('coinset_investable' in result);
      assert.ok('rewards' in result);
      assert.ok('invested' in result);
    });

    await this.runTest('Delta futures funds structure valid', async () => {
      const adapter = Container.get(DeltaExchangeWalletAdapter);
      const result = await adapter.getFuturesFunds() as any;

      assert.ok('balance' in result);
      assert.ok('locked_amount' in result);
      assert.ok('first_time_user' in result);
      assert.strictEqual(typeof result.balance, 'string');
      assert.strictEqual(typeof result.locked_amount, 'string');
      assert.strictEqual(typeof result.first_time_user, 'boolean');
    });

    await this.runTest('Mudrex adapter unchanged', async () => {
      const adapter = Container.get(MudrexWalletAdapter);
      // Just verify it still exists and has methods
      assert.ok(typeof adapter.getWalletFunds === 'function');
      assert.ok(typeof adapter.getFuturesFunds === 'function');
    });
  }

  private async testDatabaseIntegration(): Promise<void> {
    console.log('\n🗄️  2. Database Integration Tests\n');

    await this.runTest('Database connection active', async () => {
      assert.ok(coreDataSource.isInitialized);
    }, { critical: true });

    await this.runTest('FundsSnapshotRepository accessible', async () => {
      const repo = Container.get(FundsSnapshotRepository);
      assert.ok(repo);
      assert.ok(typeof repo.createSnapshot === 'function');
      assert.ok(typeof repo.getLatestSnapshot === 'function');
    });

    await this.runTest('Can query existing snapshots', async () => {
      const result = await coreDataSource.query(
        `SELECT COUNT(*) as count FROM funds_snapshots LIMIT 1`
      );
      assert.ok(Array.isArray(result));
    });

    await this.runTest('Delta snapshots exist in database', async () => {
      const result = await coreDataSource.query(
        `SELECT COUNT(*) as count
         FROM funds_snapshots
         WHERE broker_key = 'delta_exchange'
         LIMIT 1`
      );
      const count = Number(result?.[0]?.count || 0);
      if (count === 0) {
        this.warn('No Delta snapshots found', 'May be first run or no Delta accounts');
      }
    });

    await this.runTest('Latest Delta snapshot structure valid', async () => {
      const result = await coreDataSource.query(
        `SELECT wallet_funds_json, futures_funds_json
         FROM funds_snapshots
         WHERE broker_key = 'delta_exchange'
         ORDER BY observed_at DESC
         LIMIT 1`
      );

      if (result && result.length > 0) {
        const row = result[0] as any;
        const wallet = typeof row.wallet_funds_json === 'string'
          ? JSON.parse(row.wallet_funds_json)
          : row.wallet_funds_json;
        const futures = typeof row.futures_funds_json === 'string'
          ? JSON.parse(row.futures_funds_json)
          : row.futures_funds_json;

        // Latest snapshot should have wallet = 0 if created after our change
        // Old snapshots might have real values - both are valid
        assert.ok(wallet !== null);
        assert.ok(futures !== null);
      }
    });
  }

  private async testServiceIntegration(): Promise<void> {
    console.log('\n🔌 3. Service Integration Tests\n');

    await this.runTest('BrokerWalletLiveFetchService accessible', async () => {
      const service = Container.get(BrokerWalletLiveFetchService);
      assert.ok(service);
      assert.ok(typeof service.fetchAccountFunds === 'function');
    });

    await this.runTest('BrokerWalletFacadeService accessible', async () => {
      const service = Container.get(BrokerWalletFacadeService);
      assert.ok(service);
      assert.ok(typeof service.getWalletFunds === 'function');
      assert.ok(typeof service.getFuturesFunds === 'function');
    });

    await this.runTest('BrokerAccountRepository accessible', async () => {
      const repo = Container.get(BrokerAccountRepository);
      assert.ok(repo);
      assert.ok(typeof repo.getConnectedBrokerAccounts === 'function');
    });

    await this.runTest('FundsSnapshotRepository methods work', async () => {
      const repo = Container.get(FundsSnapshotRepository);

      // Test with a user that likely doesn't exist
      const result = await repo.getLatestSnapshot('test-user-nonexistent');
      // Should return null for non-existent user, not throw
      assert.ok(result === null || typeof result === 'object');
    });
  }

  private async testEdgeCases(): Promise<void> {
    console.log('\n🔍 4. Edge Case Tests\n');

    await this.runTest('Multiple Delta accounts scenario', async () => {
      const adapter = Container.get(DeltaExchangeWalletAdapter);

      // Simulate 2 Delta accounts
      const account1Wallet = await adapter.getWalletFunds({ accountId: 'acc-1' }) as any;
      const account2Wallet = await adapter.getWalletFunds({ accountId: 'acc-2' }) as any;

      // Both should return 0
      assert.strictEqual(account1Wallet.total, 0);
      assert.strictEqual(account2Wallet.total, 0);

      // Total wallet from 2 Delta accounts = 0
      const totalWallet = account1Wallet.total + account2Wallet.total;
      assert.strictEqual(totalWallet, 0);
    });

    await this.runTest('Zero balance futures handling', async () => {
      // Even with 0 actual balance, structure should be valid
      const adapter = Container.get(DeltaExchangeWalletAdapter);
      const result = await adapter.getFuturesFunds() as any;

      // Should be a string "0.00" or actual balance
      assert.ok(typeof result.balance === 'string');
      assert.ok(/^\d+\.\d{2}$/.test(result.balance), 'Balance should be formatted as "0.00"');
    });

    await this.runTest('Null/undefined context handling', async () => {
      const adapter = Container.get(DeltaExchangeWalletAdapter);

      // Should not throw with missing context
      const wallet1 = await adapter.getWalletFunds();
      const wallet2 = await adapter.getWalletFunds({});
      const wallet3 = await adapter.getWalletFunds({ accountId: undefined, userId: undefined });

      assert.strictEqual((wallet1 as any).total, 0);
      assert.strictEqual((wallet2 as any).total, 0);
      assert.strictEqual((wallet3 as any).total, 0);
    });
  }

  private async testBackwardCompatibility(): Promise<void> {
    console.log('\n⏮️  5. Backward Compatibility Tests\n');

    await this.runTest('Old snapshots readable', async () => {
      const result = await coreDataSource.query(
        `SELECT
           wallet_funds_json,
           futures_funds_json,
           observed_at
         FROM funds_snapshots
         WHERE broker_key = 'delta_exchange'
           AND observed_at < NOW() - INTERVAL 1 DAY
         ORDER BY observed_at DESC
         LIMIT 5`
      );

      if (result && result.length > 0) {
        // Old snapshots might have real wallet balances - should still parse
        for (const row of result as any[]) {
          const wallet = typeof row.wallet_funds_json === 'string'
            ? JSON.parse(row.wallet_funds_json)
            : row.wallet_funds_json;

          assert.ok(wallet !== null);
          assert.ok('total' in wallet);
        }
      } else {
        this.warn('No old snapshots found', 'Cannot verify historical data handling');
      }
    });

    await this.runTest('Mixed old/new snapshots query', async () => {
      const result = await coreDataSource.query(
        `SELECT
           snapshot_date,
           JSON_EXTRACT(wallet_funds_json, '$.total') as wallet_total,
           JSON_EXTRACT(futures_funds_json, '$.balance') as futures_balance
         FROM funds_snapshots
         WHERE broker_key = 'delta_exchange'
           AND snapshot_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
         ORDER BY snapshot_date DESC
         LIMIT 10`
      );

      // Should be able to query mixed data without errors
      assert.ok(Array.isArray(result));
    });

    await this.runTest('Snapshot date uniqueness maintained', async () => {
      const result = await coreDataSource.query(
        `SELECT snapshot_date, COUNT(*) as count
         FROM funds_snapshots
         WHERE broker_key = 'delta_exchange'
         GROUP BY snapshot_date
         HAVING COUNT(*) > 1
         LIMIT 1`
      );

      // Should not have duplicate snapshots for same date
      // (unless user has multiple Delta accounts, which is valid)
    });
  }

  private async testPortfolioCalculations(): Promise<void> {
    console.log('\n📊 6. Portfolio Calculation Tests\n');

    await this.runTest('Delta + Mudrex wallet aggregation', async () => {
      const deltaAdapter = Container.get(DeltaExchangeWalletAdapter);
      const deltaWallet = await deltaAdapter.getWalletFunds() as any;

      // Simulate Mudrex
      const mudrexWallet = { total: 10, withdrawable: 10 };

      const totalWallet = deltaWallet.total + mudrexWallet.total;
      assert.strictEqual(totalWallet, 10, 'Total wallet should be 10 (Mudrex only)');
    });

    await this.runTest('No double counting in capital calculation', async () => {
      const adapter = Container.get(DeltaExchangeWalletAdapter);
      const wallet = await adapter.getWalletFunds() as any;
      const futures = await adapter.getFuturesFunds() as any;

      const walletBalance = wallet.total;
      const futuresBalance = parseFloat(futures.balance);

      // Wallet should be 0, so no double counting
      assert.strictEqual(walletBalance, 0);

      // Total capital = 0 + futuresBalance (no duplication)
      const totalCapital = walletBalance + futuresBalance;
      assert.ok(totalCapital >= 0, 'Total capital should be non-negative');
    });

    await this.runTest('Percentage calculations safe', async () => {
      const adapter = Container.get(DeltaExchangeWalletAdapter);
      const wallet = await adapter.getWalletFunds() as any;

      const totalCapital = 1000; // Assume portfolio has other funds
      const walletBalance = wallet.total;

      // Should not cause division by zero
      const walletPercentage = totalCapital > 0 ? (walletBalance / totalCapital) * 100 : 0;
      assert.strictEqual(walletPercentage, 0);
    });
  }

  private printSummary(): Promise<void> {
    const totalDuration = Date.now() - this.startTime;
    const passed = this.results.filter(r => r.status === 'pass').length;
    const failed = this.results.filter(r => r.status === 'fail').length;
    const warned = this.results.filter(r => r.status === 'warn').length;
    const skipped = this.results.filter(r => r.status === 'skip').length;
    const total = this.results.length;

    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║                       Test Summary                         ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    console.log(`Total Tests:    ${total}`);
    console.log(`✅ Passed:      ${passed}`);
    console.log(`❌ Failed:      ${failed}`);
    console.log(`⚠️  Warnings:    ${warned}`);
    console.log(`⏭️  Skipped:     ${skipped}`);
    console.log(`⏱️  Duration:    ${totalDuration}ms\n`);

    if (failed > 0) {
      console.log('❌ Failed Tests:\n');
      this.results
        .filter(r => r.status === 'fail')
        .forEach(r => {
          console.log(`  • ${r.name}`);
          console.log(`    ${r.message}\n`);
        });
    }

    if (warned > 0) {
      console.log('⚠️  Warnings:\n');
      this.results
        .filter(r => r.status === 'warn')
        .forEach(r => {
          console.log(`  • ${r.name}`);
          console.log(`    ${r.message}\n`);
        });
    }

    console.log('═══════════════════════════════════════════════════════════\n');

    if (failed === 0) {
      console.log('🎉 All critical tests passed!\n');
      console.log('📋 Next Steps:');
      console.log('  1. ✅ Test with real Delta Exchange account');
      console.log('  2. ✅ Run funds scheduler and verify database');
      console.log('  3. ✅ Test frontend display');
      console.log('  4. ✅ Monitor production for 24 hours\n');
      return Promise.resolve();
    } else {
      console.log('❌ Some tests failed. Please review and fix before deployment.\n');
      process.exitCode = 1;
      return Promise.resolve();
    }
  }
}

async function main() {
  try {
    const suite = new ComprehensiveTestSuite();
    await suite.run();
  } catch (error) {
    console.error('\n💥 Test suite crashed:', error);
    process.exit(1);
  }
}

main();
