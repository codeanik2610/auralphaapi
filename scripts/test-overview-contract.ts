import assert from 'node:assert/strict';

import { OverviewController } from '../src/api/controllers/OverviewController';
import { OverviewService } from '../src/api/services/OverviewService';

function createSuccess<T>(data: T) {
  return { success: true as const, data };
}

async function runOverviewServiceAssertions(): Promise<void> {
  const originalDateNow = Date.now;
  Date.now = () => new Date('2026-04-09T10:20:00.000Z').getTime();

  try {
  const service = new OverviewService() as any;
  let capturedAssetsQuery: Record<string, string | undefined> | null = null;
  const selectedSymbols: string[] = [];
  const leverageSymbols: string[] = [];

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

  service.brokerWalletFacadeService = {
    async getWalletFunds(userId: string, brokerKey?: string, accountId?: string) {
      assert.equal(userId, 'user-1');
      assert.equal(brokerKey, 'mudrex');
      assert.equal(accountId, 'acct-default');
      return createSuccess({
        total: 12500,
        rewards: 120,
        invested: 6400,
        withdrawable: 6100,
        coin_investable: 1000,
        coinset_investable: 0,
        vault_investable: 300,
      });
    },
    async getFuturesFunds(userId: string, brokerKey?: string, accountId?: string) {
      assert.equal(userId, 'user-1');
      assert.equal(brokerKey, 'mudrex');
      assert.equal(accountId, 'acct-default');
      return createSuccess({
        balance: '8450.50',
        locked_amount: '250.25',
        first_time_user: false,
      });
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

  service.fundsSnapshotRepository = {
    async getLatestSnapshot() {
      return {
        computed_at: new Date('2026-04-09T10:15:00.000Z'),
      };
    },
  };

  service.brokerReferenceDataService = {
    async getFuturesAssets(
      brokerKey: string,
      query: Record<string, string | undefined>
    ) {
      assert.equal(brokerKey, 'mudrex');
      capturedAssetsQuery = query;
      return createSuccess([
        {
          id: 'asset-btc',
          name: 'Bitcoin',
          symbol: 'BTCUSDT',
          price: '64000',
          change_perc: '2.5',
          volume: '999999',
        },
        {
          id: 'asset-eth',
          name: 'Ethereum',
          symbol: 'ETHUSDT',
          price: '3200',
          change_perc: '-1.2',
          volume: '777777',
        },
      ]);
    },
    async getFuturesAssetDetailBySymbol(brokerKey: string, symbol: string) {
      assert.equal(brokerKey, 'mudrex');
      selectedSymbols.push(symbol);
      return createSuccess({
        id: `asset-${symbol.toLowerCase()}`,
        name: symbol === 'ETHUSDT' ? 'Ethereum' : 'Bitcoin',
        symbol,
        funding_interval: 8,
        price: symbol === 'ETHUSDT' ? '3200' : '64000',
        change_perc: symbol === 'ETHUSDT' ? '-1.2' : '2.5',
        volume: symbol === 'ETHUSDT' ? '777777' : '999999',
        '1d_high': symbol === 'ETHUSDT' ? 3300 : 65000,
        '1d_low': symbol === 'ETHUSDT' ? 3100 : 62000,
        '1d_volume': symbol === 'ETHUSDT' ? 777777 : 999999,
      });
    },
    async getLeverageBySymbol(brokerKey: string, symbol: string) {
      assert.equal(brokerKey, 'mudrex');
      leverageSymbols.push(symbol);
      return createSuccess({
        Leverage: '25x',
        MarginType: 'Isolated',
      });
    },
  };

  service.automationsService = {
    async getAutomations() {
      return createSuccess({
        items: [
          {
            id: 'auto-1',
            name: 'Momentum',
            status: 'Running',
          },
        ],
        total: 1,
        limit: 5,
        offset: 0,
      });
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
        items: [
          {
            id: 'alert-1',
            severity: 'High',
          },
        ],
        total: 1,
        limit: 5,
        offset: 0,
      });
    },
    async getAlertsSummary() {
      return createSuccess({
        openAlerts: 3,
        acknowledged: 1,
        highSeverityAlerts: 2,
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
      return createSuccess({
        equity: 18000,
        dayPnL: 420,
        netExposure: '42%',
        diversification: 'Balanced',
      });
    },
    async getPortfolioHoldings() {
      return createSuccess({
        items: [
          {
            id: 'holding-1',
            symbol: 'BTCUSDT',
            allocationPct: 35,
          },
        ],
        total: 1,
        limit: 5,
        offset: 0,
      });
    },
  };

  service.portfolioRepository = {
    async getLatestSnapshot() {
      return {
        createdAt: new Date('2026-04-09T10:05:00.000Z'),
      };
    },
  };

  const requestedResponse = await service.getOverview('user-1', {
    selectedSymbol: 'ETHUSDT',
    sort: 'volume',
    order: 'desc',
  });

  assert.deepEqual(capturedAssetsQuery, {
    sort: 'volume',
    order: 'desc',
    offset: '0',
    limit: '8',
  });
  assert.deepEqual(selectedSymbols, ['ETHUSDT']);
  assert.deepEqual(leverageSymbols, ['ETHUSDT']);
  assert.equal(requestedResponse.data.meta.contractVersion, 'overview-phase4-2026-04-09');
  assert.equal(requestedResponse.data.meta.purpose, 'operator_command_center');
  assert.equal(
    requestedResponse.data.meta.summary,
    'Phase 4 overview contract adds snapshot freshness, explicit operator warnings, automation diagnostics, live-reference cache fallback metadata, and request observability for the operator dashboard.'
  );
  assert.equal(requestedResponse.data.meta.query.supported.join(','), 'selectedSymbol,sort,order');
  assert.equal(requestedResponse.data.meta.query.ignored.join(','), 'brokerKey,accountId,limit');
  assert.equal(requestedResponse.data.meta.query.sectionLimits.assets, 8);
  assert.equal(requestedResponse.data.meta.query.sectionLimits.portfolioHoldings, 5);
  assert.equal(requestedResponse.data.meta.routing.brokerKey, 'mudrex');
  assert.equal(requestedResponse.data.meta.routing.accountId, 'acct-default');
  assert.equal(requestedResponse.data.meta.routing.resolution, 'resolved');
  assert.equal(
    requestedResponse.data.meta.routing.detail,
    'Resolved the default connected broker account for this overview request.'
  );
  assert.equal(requestedResponse.data.meta.resilience.status, 'full');
  assert.deepEqual(requestedResponse.data.meta.resilience.degradedSections, []);
  assert.deepEqual(requestedResponse.data.meta.resilience.timeoutSections, []);
  assert.equal(requestedResponse.data.meta.resilience.routingFallback, false);
  assert.equal(
    requestedResponse.data.meta.resilience.summary,
    'Overview payload assembled successfully from primary dependencies.'
  );
  assert.deepEqual(requestedResponse.data.meta.warnings, []);
  assert.equal(requestedResponse.data.meta.observability.totalMs, 0);
  assert.equal(requestedResponse.data.meta.observability.degradedSectionCount, 0);
  assert.equal(requestedResponse.data.meta.observability.timeoutSectionCount, 0);
  assert.equal(requestedResponse.data.meta.observability.staleSectionCount, 0);
  assert.equal(requestedResponse.data.meta.observability.criticalSectionCount, 0);
  assert.equal(requestedResponse.data.meta.observability.warningCount, 0);
  assert.equal(requestedResponse.data.meta.observability.referenceCache.assets, 'live');
  assert.equal(requestedResponse.data.meta.observability.referenceCache.selectedAsset, 'live');
  assert.equal(requestedResponse.data.meta.observability.referenceCache.leverage, 'live');
  assert.equal(
    requestedResponse.data.meta.observability.summary,
    'Overview assembled in 0ms with 0 degraded sections, 0 stale sections, and 0 operator warnings.'
  );
  assert.equal(requestedResponse.data.meta.selection.requestedSymbol, 'ETHUSDT');
  assert.equal(requestedResponse.data.meta.selection.resolvedSymbol, 'ETHUSDT');
  assert.equal(requestedResponse.data.meta.selection.mode, 'requested');
  assert.equal(requestedResponse.data.meta.sections.walletFunds.sourceType, 'db_snapshot');
  assert.equal(
    requestedResponse.data.meta.sections.walletFunds.observedAt,
    '2026-04-09T10:15:00.000Z'
  );
  assert.equal(requestedResponse.data.meta.sections.walletFunds.availability, 'available');
  assert.equal(requestedResponse.data.meta.sections.walletFunds.requestStatus, 'ok');
  assert.equal(requestedResponse.data.meta.sections.walletFunds.fetchMode, 'primary');
  assert.equal(requestedResponse.data.meta.sections.walletFunds.freshness?.state, 'fresh');
  assert.equal(requestedResponse.data.meta.sections.walletFunds.freshness?.ageMs, 5 * 60 * 1000);
  assert.equal(
    requestedResponse.data.meta.sections.walletFunds.statusDetail,
    'Loaded wallet funds from the resolved broker-account snapshot.'
  );
  assert.equal(requestedResponse.data.meta.sections.activeFunds.sourceLabel, 'Capital routes');
  assert.equal(requestedResponse.data.meta.sections.activeFunds.availability, 'available');
  assert.equal(requestedResponse.data.meta.sections.activeFunds.requestStatus, 'ok');
  assert.equal(requestedResponse.data.activeFunds.walletItems[0]?.funds.balance, 12500);
  assert.equal(requestedResponse.data.activeFunds.walletItems[0]?.funds.available, 6100);
  assert.equal(requestedResponse.data.activeFunds.futuresItems[0]?.funds.balance, 8450.5);
  assert.equal(requestedResponse.data.meta.sections.assets.sourceType, 'live_external');
  assert.equal(requestedResponse.data.meta.sections.assets.observedAt !== null, true);
  assert.equal(requestedResponse.data.meta.sections.assets.availability, 'available');
  assert.equal(requestedResponse.data.meta.sections.assets.requestStatus, 'ok');
  assert.equal(requestedResponse.data.meta.sections.assets.fetchMode, 'primary');
  assert.equal(requestedResponse.data.meta.sections.assets.freshness?.state, 'fresh');
  assert.equal(requestedResponse.data.meta.sections.assets.cache?.state, 'live');
  assert.equal(
    requestedResponse.data.meta.sections.portfolioSummary.uiUsage,
    'rendered'
  );
  assert.equal(
    requestedResponse.data.meta.sections.portfolioSummary.observedAt,
    '2026-04-09T10:05:00.000Z'
  );
  assert.equal(requestedResponse.data.meta.sections.portfolioSummary.freshness?.state, 'fresh');
  assert.equal(
    requestedResponse.data.meta.sections.portfolioSummary.freshness?.ageMs,
    15 * 60 * 1000
  );
  assert.equal(
    requestedResponse.data.meta.sections.signalsSummary.uiUsage,
    'rendered'
  );
  assert.equal(requestedResponse.data.health.scope, 'overview_request');
  assert.equal(requestedResponse.data.health.status, 'assembled');
  assert.deepEqual(requestedResponse.data.health.degradedSections, []);
  assert.deepEqual(requestedResponse.data.health.timeoutSections, []);
  assert.equal(
    requestedResponse.data.health.summary,
    'Overview payload assembled successfully from primary dependencies. This is a request-level overview status, not a platform-wide health signal.'
  );
  assert.equal(requestedResponse.data.portfolioSummary.dayPnL, 420);
  assert.equal(requestedResponse.data.selectedAsset?.symbol, 'ETHUSDT');

  const defaultResponse = await service.getOverview('user-1', {});
  assert.equal(defaultResponse.data.meta.selection.requestedSymbol, null);
  assert.equal(defaultResponse.data.meta.selection.resolvedSymbol, 'BTCUSDT');
  assert.equal(defaultResponse.data.meta.selection.mode, 'first_asset_default');
  } finally {
    Date.now = originalDateNow;
  }
}

async function runOverviewControllerAssertions(): Promise<void> {
  const controller = new OverviewController() as any;

  controller.overviewService = {
    async getOverview(...args: unknown[]) {
      return createSuccess({ args });
    },
  };

  const response = await controller.getOverview(
    { authUser: { sub: 'user-1' } },
    'ETHUSDT',
    'volume',
    'desc'
  );

  assert.deepEqual(response.data.args, [
    'user-1',
    {
      selectedSymbol: 'ETHUSDT',
      sort: 'volume',
      order: 'desc',
    },
  ]);
}

async function main(): Promise<void> {
  await runOverviewServiceAssertions();
  await runOverviewControllerAssertions();

  console.log('Overview contract assertions passed.');
}

main().catch((error) => {
  console.error('Overview contract assertion failure:', error);
  process.exit(1);
});
