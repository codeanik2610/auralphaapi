import assert from 'node:assert/strict';

import { PortfolioOverviewService } from '../src/api/services/PortfolioOverviewService';

function createSuccess<T>(data: T) {
  return { success: true as const, data };
}

async function runOverviewHydrationAssertions(): Promise<void> {
  const service = new PortfolioOverviewService() as any;
  let requestedPerformanceTimeframe: string | null = null;
  let requestedSnapshotsQuery: { limit?: string; offset?: string } | null = null;
  const freshObservedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();

  service.portfolioService = {
    async getPortfolioPnL() {
      return createSuccess({
        dailyPnL: 12,
        weeklyPnL: 24,
        monthlyPnL: 48,
        source: 'scheduler_positions_snapshots',
        measurement: 'realized_pnl',
        windows: {
          timezone: 'Asia/Kolkata',
          daily: 'Today (Asia/Kolkata)',
          weekly: 'Trailing 7 days (Asia/Kolkata)',
          monthly: 'Trailing 30 days (Asia/Kolkata)',
        },
      });
    },
    async getPortfolioPerformance(_userId: string, timeframe: string) {
      requestedPerformanceTimeframe = timeframe;
      return createSuccess({
        timeframe,
        mode: 'closed-position-activity',
        source: 'scheduler_positions_snapshots',
        measurement: 'realized_pnl',
        windowLabel: 'Trailing 7 days (Asia/Kolkata)',
        bucketLabel: 'day',
        points: [],
        summary: {
          totalEquity: 18000,
          totalPnl: 24,
          totalProfit: 30,
          totalLoss: 6,
          totalTrades: 4,
        },
      });
    },
    async getPortfolioSummary() {
      return createSuccess({
        source: 'portfolio_snapshots',
        observedAt: freshObservedAt,
        definition: 'Latest stored portfolio snapshot summary.',
        portfolioValue: '$18,000',
        equity: 18000,
        holdings: 4,
      });
    },
    async getPortfolioHoldings() {
      return createSuccess({
        source: 'portfolio_snapshots',
        observedAt: freshObservedAt,
        definition:
          'Largest holdings ordered by market value from the latest stored portfolio snapshot.',
        items: [
          {
            id: 'holding-1',
            symbol: 'BTCUSDT',
            quantity: 0.45,
            marketValue: 12000,
            allocationPct: 55,
            dayPnL: 450,
            unrealizedPnL: 1800,
            side: 'Long',
            strategy: 'Core',
            riskState: 'Healthy',
            sleeve: 'Majors',
          },
        ],
        total: 1,
        limit: 100,
        offset: 0,
      });
    },
    async getPortfolioSnapshots(
      _userId: string,
      query: { limit?: string; offset?: string }
    ) {
      requestedSnapshotsQuery = query;
      return createSuccess({
        source: 'portfolio_snapshots',
        items: [
          {
            id: 'snapshot-1',
            equity: 18000,
            createdAt: freshObservedAt,
          },
        ],
        total: 1,
      });
    },
  };

  service.brokerWalletFacadeService = {
    async getWalletFundsForActiveAccounts() {
      return {
        items: [
          {
            accountId: 'wallet-1',
            accountName: 'Mudrex Wallet',
            brokerKey: 'mudrex',
            status: 'connected',
            observedAt: freshObservedAt,
            funds: {
              data: {
                balance: '200',
                withdrawable: '150',
                used_margin: '25',
              },
            },
          },
        ],
      };
    },
    async getFuturesFundsForActiveAccounts() {
      return {
        data: {
          items: [
            {
              accountId: 'futures-1',
              accountName: 'Delta Futures',
              brokerKey: 'delta_exchange',
              status: 'connected',
              observedAt: freshObservedAt,
              funds: {
                futures_equity: '320',
                free_balance: '140',
                margin_used: '80',
              },
            },
          ],
        },
      };
    },
  };

  const response = await service.getOverview('user-1', {
    timeframe: 'weekly',
    snapshotsLimit: '5',
    snapshotsOffset: '10',
  });

  assert.equal(requestedPerformanceTimeframe, 'weekly');
  assert.deepEqual(requestedSnapshotsQuery, {
    limit: '5',
    offset: '10',
  });
  assert.equal(response.data.meta.contractVersion, 'portfolio-overview-phase6-2026-04-10');
  assert.equal(response.data.meta.purpose, 'operator_portfolio_workspace');
  assert.equal(response.data.meta.primaryPageRoute, '/portfolio');
  assert.equal(response.data.meta.primaryEndpoint, '/portfolio/overview');
  assert.equal(response.data.meta.pageHydration, 'single-request');
  assert.deepEqual(response.data.meta.query.supported, [
    'timeframe',
    'snapshotsLimit',
    'snapshotsOffset',
    'holdingsLimit',
  ]);
  assert.deepEqual(response.data.meta.query.unsupported, ['brokerKey', 'accountId']);
  assert.deepEqual(response.data.meta.query.resolved, {
    timeframe: 'weekly',
    snapshots: {
      limit: 5,
      offset: 10,
    },
    holdings: {
      limit: 100,
      offset: 0,
      filterMode: 'loaded_overview_slice_client_side',
    },
  });
  assert.deepEqual(response.data.meta.sources, {
    pnl: 'scheduler_positions_snapshots',
    performance: 'scheduler_positions_snapshots',
    summary: 'portfolio_snapshots',
    holdings: 'portfolio_snapshots',
    snapshots: 'portfolio_snapshots',
    activeFunds: 'funds_snapshots via broker_wallet_facade',
  });
  assert.equal(response.data.meta.capabilities.singleRequestHydration, true);
  assert.equal(response.data.meta.capabilities.holdingsIncludedInOverview, true);
  assert.equal(response.data.meta.warnings.length, 0);
  assert.equal(
    response.data.meta.sections.activeFunds.sourceLabel,
    'Latest per-account funds snapshots'
  );
  assert.equal(response.data.holdings.source, 'portfolio_snapshots');
  assert.equal(response.data.holdings.items.length, 1);
  assert.equal(response.data.activeFunds.source, 'funds_snapshots via broker_wallet_facade');
  assert.equal(
    response.data.activeFunds.definition,
    'Latest stored funds snapshot per connected account, normalized for wallet and futures capital review.'
  );
  assert.equal(response.data.activeFunds.freshnessModel, 'funds_snapshot_timestamp');
  assert.deepEqual(response.data.activeFunds.walletItems, [
    {
      accountId: 'wallet-1',
      accountName: 'Mudrex Wallet',
      accountKey: '',
      brokerKey: 'mudrex',
      status: 'connected',
      observedAt: freshObservedAt,
      error: null,
      funds: {
        balance: 200,
        available: 150,
        invested: 25,
      },
    },
  ]);
  assert.deepEqual(response.data.activeFunds.futuresItems, [
    {
      accountId: 'futures-1',
      accountName: 'Delta Futures',
      accountKey: '',
      brokerKey: 'delta_exchange',
      status: 'connected',
      observedAt: freshObservedAt,
      error: null,
      funds: {
        balance: 320,
        available: 140,
        invested: 80,
      },
    },
  ]);
}

async function main(): Promise<void> {
  await runOverviewHydrationAssertions();
  console.log('Portfolio Phase 2 assertions passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
