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

  assert.equal(requestedResponse.data.meta.contractVersion, 'overview-phase4-2026-04-09');
  assert.equal(requestedResponse.data.meta.purpose, 'operator_command_center');
  assert.equal(
    requestedResponse.data.meta.summary,
    'Phase 4 overview contract focuses on snapshot-backed capital posture, portfolio state, automation diagnostics, and request observability for the operator dashboard.'
  );
  assert.equal(requestedResponse.data.meta.query.supported.join(','), 'selectedSymbol,sort,order');
  assert.equal(requestedResponse.data.meta.query.ignored.join(','), 'brokerKey,accountId,limit');
  assert.equal(requestedResponse.data.meta.query.sectionLimits.assets, 0);
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
  assert.equal(requestedResponse.data.meta.observability.referenceCache.assets, 'not_applicable');
  assert.equal(requestedResponse.data.meta.observability.referenceCache.selectedAsset, 'not_applicable');
  assert.equal(requestedResponse.data.meta.observability.referenceCache.leverage, 'not_applicable');
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
  assert.equal(requestedResponse.data.meta.sections.assets.sourceType, 'computed_summary');
  assert.equal(requestedResponse.data.meta.sections.assets.observedAt, null);
  assert.equal(requestedResponse.data.meta.sections.assets.availability, 'missing');
  assert.equal(requestedResponse.data.meta.sections.assets.requestStatus, 'ok');
  assert.equal(requestedResponse.data.meta.sections.assets.fetchMode, 'skipped');
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
  assert.deepEqual(requestedResponse.data.assets, []);
  assert.equal(requestedResponse.data.selectedAsset, null);
  assert.equal(requestedResponse.data.leverage, null);

  const defaultResponse = await service.getOverview('user-1', {});
  assert.equal(defaultResponse.data.meta.selection.requestedSymbol, null);
  assert.equal(defaultResponse.data.meta.selection.resolvedSymbol, null);
  assert.equal(defaultResponse.data.meta.selection.mode, 'none');

  service.portfolioService = {
    async getPortfolioSummary() {
      return createSuccess({
        equity: 0,
        dayPnL: 0,
        netExposure: '--',
        diversification: '--',
        observedAt: null,
        observedAtIso: null,
      });
    },
    async getPortfolioHoldings() {
      return createSuccess({
        items: [],
        total: 0,
        limit: 5,
        offset: 0,
        observedAt: null,
        observedAtIso: null,
      });
    },
  };

  service.portfolioRepository = {
    async getLatestSnapshot() {
      return null;
    },
  };

  service.portfolioOverviewService = {
    async getOverview() {
      return createSuccess({
        summary: {
          equity: 18450,
          dayPnL: 125,
          netExposure: '$0',
          diversification: 'No open futures positions',
          source: 'portfolio_overview_futures_legacy_alias',
          observedAt: '2026-04-09T10:15:00.000Z',
          observedAtIso: '2026-04-09T10:15:00.000Z',
        },
        holdings: {
          items: [],
          total: 0,
          limit: 5,
          offset: 0,
          source: 'portfolio_overview_futures_legacy_alias',
          observedAt: '2026-04-09T10:15:00.000Z',
          observedAtIso: '2026-04-09T10:15:00.000Z',
        },
      });
    },
  };

  const liveAliasFallbackResponse = await service.getOverview('user-1', {
    selectedSymbol: 'BTCUSDT',
  });
  assert.equal(
    liveAliasFallbackResponse.data.portfolioSummary.source,
    'portfolio_overview_futures_legacy_alias'
  );
  assert.equal(
    liveAliasFallbackResponse.data.meta.sections.portfolioSummary.observedAt,
    '2026-04-09T10:15:00.000Z'
  );
  assert.equal(
    liveAliasFallbackResponse.data.meta.sections.portfolioSummary.availability,
    'available'
  );
  assert.equal(
    liveAliasFallbackResponse.data.meta.sections.portfolioHoldings.availability,
    'available'
  );
  assert.equal(
    liveAliasFallbackResponse.data.meta.warnings.some(
      (warning: { code: string }) => warning.code === 'portfolio_snapshot_attention'
    ),
    false
  );
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
