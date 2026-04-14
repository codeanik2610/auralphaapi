import assert from 'node:assert/strict';

import { OverviewService } from '../src/api/services/OverviewService';

function createSuccess<T>(data: T) {
  return { success: true as const, data };
}

async function main(): Promise<void> {
  const originalDateNow = Date.now;
  Date.now = () => new Date('2026-04-09T10:20:00.000Z').getTime();

  try {
  const service = new OverviewService() as any;
  service.externalSectionTimeoutMs = 5;

  service.brokerAccountRepository = {
    async getConnectedBrokerAccounts() {
      return [
        {
          id: 'acct-default',
          brokerKey: 'mudrex',
          isDefault: true,
        },
      ];
    },
  };

  service.fundsSnapshotRepository = {
    async getLatestSnapshot() {
      return {
        wallet_funds_json: JSON.stringify({
          total: 12500,
          rewards: 120,
          invested: 6400,
          withdrawable: 6100,
          coin_investable: 1000,
          coinset_investable: 0,
          vault_investable: 300,
        }),
        futures_funds_json: JSON.stringify({
          balance: '8450.50',
          locked_amount: '250.25',
          first_time_user: false,
        }),
        computed_at: new Date('2026-04-09T10:15:00.000Z'),
      };
    },
  };

  service.brokerWalletFacadeService = {
    async getWalletFunds() {
      throw new Error('wallet snapshot loader unavailable');
    },
    async getFuturesFunds() {
      throw new Error('futures snapshot loader unavailable');
    },
    async getWalletFundsForActiveAccounts() {
      return {
        items: [
          {
            accountId: 'acct-default',
            accountName: 'Primary wallet',
            accountKey: 'primary',
            brokerKey: 'mudrex',
            status: 'Connected',
            observedAt: '2026-04-09T10:15:00.000Z',
            funds: {
              total: 12500,
              withdrawable: 6100,
              invested: 6400,
            },
            error: null,
          },
        ],
      };
    },
    async getFuturesFundsForActiveAccounts() {
      return {
        items: [
          {
            accountId: 'acct-default',
            accountName: 'Primary wallet',
            accountKey: 'primary',
            brokerKey: 'mudrex',
            status: 'Connected',
            observedAt: '2026-04-09T10:15:00.000Z',
            funds: {
              balance: '8450.50',
              locked_amount: '250.25',
            },
            error: null,
          },
        ],
      };
    },
  };

  service.brokerReferenceDataService = {
    async getFuturesAssets() {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return createSuccess([
        {
          id: 'asset-btc',
          name: 'Bitcoin',
          symbol: 'BTCUSDT',
          price: '64000',
          change_perc: '2.5',
          volume: '999999',
        },
      ]);
    },
    async getFuturesAssetDetailBySymbol() {
      throw new Error('selected asset detail unavailable');
    },
    async getLeverageBySymbol() {
      return createSuccess({
        Leverage: '20x',
        MarginType: 'Cross',
      });
    },
  };

  service.automationsService = {
    async getAutomations() {
      throw new Error('automations digest unavailable');
    },
    async getAutomationsSummary() {
      return createSuccess({
        running: 1,
        paused: 0,
        connectedAccounts: 2,
        health: 'Healthy',
      });
    },
  };

  service.alertsService = {
    async getAlerts() {
      return createSuccess({
        items: [],
        total: 0,
        limit: 5,
        offset: 0,
      });
    },
    async getAlertsSummary() {
      return createSuccess({
        openAlerts: 1,
        acknowledged: 0,
        highSeverityAlerts: 1,
        criticalSeverity: 1,
        watchlistCapable: 'Yes',
      });
    },
  };

  service.signalsService = {
    async getSignals() {
      return createSuccess({
        items: [
          {
            id: 'signal-1',
            symbol: 'BTCUSDT',
            source: 'Momentum Engine',
            confidence: 0.82,
          },
        ],
        total: 1,
        limit: 3,
        offset: 0,
      });
    },
    async getSignalsSummary() {
      return createSuccess({
        liveSignals: 4,
        triggered: 2,
        watching: 1,
        queued: 1,
        muted: 0,
        highConfidence: 2,
        mutedOrQueued: 1,
      });
    },
  };

  service.portfolioService = {
    async getPortfolioSummary() {
      throw new Error('portfolio summary unavailable');
    },
    async getPortfolioHoldings() {
      throw new Error('portfolio holdings unavailable');
    },
  };

  service.portfolioRepository = {
    async getLatestSnapshot() {
      return {
        equity: 19000,
        dayPnL: 260,
        netExposure: '42%',
        diversification: 'Balanced',
        assetAllocation: 'BTC heavy',
        strategyMix: 'Momentum',
        riskPosture: 'Healthy',
        accountCurve: 'Uptrend',
        monthlyPace: '+5%',
        createdAt: new Date('2026-04-09T10:05:00.000Z'),
        holdings: [
          {
            id: 'holding-1',
            symbol: 'BTCUSDT',
            quantity: 0.25,
            marketValue: 12000,
            allocationPct: 63,
            dayPnL: 180,
            unrealizedPnL: 860,
            side: 'Long',
            strategy: 'Momentum',
            riskState: 'Healthy',
            sleeve: 'Core',
            contribution: 'Lead position',
            lastRebalanceAt: new Date('2026-04-08T10:05:00.000Z'),
          },
        ],
      };
    },
  };

  const response = await service.getOverview('user-1', {
    selectedSymbol: 'BTCUSDT',
  });

  assert.equal(response.success, true);
  assert.equal(response.data.health.status, 'degraded');
  assert.equal(response.data.meta.contractVersion, 'overview-phase4-2026-04-09');
  assert.equal(response.data.meta.resilience.status, 'partial');
  assert.equal(response.data.meta.resilience.routingFallback, false);
  assert.ok(response.data.meta.resilience.degradedSections.includes('walletFunds'));
  assert.ok(response.data.meta.resilience.degradedSections.includes('futuresFunds'));
  assert.ok(response.data.meta.resilience.degradedSections.includes('assets'));
  assert.ok(response.data.meta.resilience.degradedSections.includes('selectedAsset'));
  assert.ok(response.data.meta.resilience.degradedSections.includes('automations'));
  assert.ok(response.data.meta.resilience.degradedSections.includes('portfolioSummary'));
  assert.ok(response.data.meta.resilience.degradedSections.includes('portfolioHoldings'));
  assert.deepEqual(response.data.meta.resilience.timeoutSections, ['assets']);
  assert.deepEqual(response.data.health.timeoutSections, ['assets']);

  assert.equal(response.data.walletFunds?.total, 12500);
  assert.equal(response.data.futuresFunds?.balance, '8450.50');
  assert.equal(response.data.activeFunds.walletItems[0]?.funds.balance, 12500);
  assert.equal(response.data.meta.sections.walletFunds.requestStatus, 'degraded');
  assert.equal(response.data.meta.sections.walletFunds.fetchMode, 'fallback');
  assert.equal(response.data.meta.sections.walletFunds.availability, 'available');
  assert.equal(response.data.meta.sections.futuresFunds.fetchMode, 'fallback');
  assert.equal(response.data.meta.sections.activeFunds.requestStatus, 'ok');
  assert.equal(response.data.meta.sections.activeFunds.availability, 'available');

  assert.equal(response.data.assets.length, 0);
  assert.equal(response.data.meta.sections.assets.requestStatus, 'degraded');
  assert.equal(response.data.meta.sections.assets.availability, 'missing');
  assert.equal(response.data.meta.sections.assets.timeoutMs, 5);
  assert.equal(response.data.meta.sections.assets.cache?.state, 'unavailable');
  assert.match(response.data.meta.sections.assets.statusDetail, /timed out/i);

  assert.equal(response.data.selectedAsset, null);
  assert.equal(response.data.meta.sections.selectedAsset.requestStatus, 'degraded');
  assert.equal(response.data.meta.sections.selectedAsset.availability, 'missing');
  assert.equal(response.data.meta.sections.selectedAsset.cache?.state, 'unavailable');
  assert.equal(response.data.meta.sections.leverage.requestStatus, 'ok');
  assert.equal(response.data.leverage?.Leverage, '20x');
  assert.equal(response.data.meta.sections.leverage.cache?.state, 'live');

  assert.equal(response.data.automations.total, 0);
  assert.equal(response.data.meta.sections.automations.requestStatus, 'degraded');
  assert.equal(response.data.meta.sections.automations.availability, 'missing');
  assert.equal(response.data.meta.sections.automationsSummary.requestStatus, 'ok');

  assert.equal(response.data.portfolioSummary.equity, 19000);
  assert.equal(response.data.meta.sections.portfolioSummary.fetchMode, 'fallback');
  assert.equal(response.data.meta.sections.portfolioSummary.requestStatus, 'degraded');
  assert.equal(response.data.meta.sections.portfolioSummary.availability, 'available');
  assert.equal(response.data.portfolioHoldings.items[0]?.symbol, 'BTCUSDT');
  assert.equal(response.data.meta.sections.portfolioHoldings.fetchMode, 'fallback');
  assert.equal(response.data.meta.sections.portfolioHoldings.requestStatus, 'degraded');
  assert.equal(
    response.data.meta.warnings.some(
      (warning: { code: string }) => warning.code === 'live_reference_feed_attention'
    ),
    true
  );
  assert.equal(response.data.meta.observability.degradedSectionCount >= 1, true);

  console.log('Overview resilience assertions passed.');
  } finally {
    Date.now = originalDateNow;
  }
}

main().catch((error) => {
  console.error('Overview resilience assertion failure:', error);
  process.exit(1);
});
