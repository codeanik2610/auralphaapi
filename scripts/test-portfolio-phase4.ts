import assert from 'node:assert/strict';

import { PortfolioOverviewService } from '../src/api/services/PortfolioOverviewService';

function createSuccess<T>(data: T) {
  return { success: true as const, data };
}

async function runPortfolioPhase4ContractAssertions(): Promise<void> {
  const service = new PortfolioOverviewService() as any;
  const staleSnapshotObservedAt = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString();
  const staleFundsObservedAt = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();

  service.portfolioService = {
    async getPortfolioPnL() {
      return createSuccess({
        dailyPnL: 12,
        weeklyPnL: 24,
        monthlyPnL: 48,
        source: 'scheduler_positions_snapshots',
        measurement: 'realized_pnl',
        freshnessModel: 'windowed_activity',
        observedAt: staleSnapshotObservedAt,
        definition:
          'Realized PnL aggregated from closed-position scheduler snapshots across active accounts.',
        windows: {
          timezone: 'Asia/Kolkata',
          daily: 'Today (Asia/Kolkata)',
          weekly: 'Trailing 7 days (Asia/Kolkata)',
          monthly: 'Trailing 30 days (Asia/Kolkata)',
        },
      });
    },
    async getPortfolioPerformance() {
      return createSuccess({
        timeframe: 'daily',
        source: 'scheduler_positions_snapshots',
        measurement: 'realized_pnl',
        freshnessModel: 'windowed_activity',
        observedAt: staleSnapshotObservedAt,
        definition:
          'Closed-position activity aggregated from scheduler snapshots for the selected portfolio timeframe.',
        points: [],
        summary: {
          totalEquity: 18000,
          totalPnl: 12,
          totalProfit: 18,
          totalLoss: 6,
          totalTrades: 3,
          brokers: {},
        },
      });
    },
    async getPortfolioSummary() {
      return createSuccess({
        source: 'portfolio_snapshots',
        observedAt: staleSnapshotObservedAt,
        definition: 'Latest stored portfolio snapshot summary.',
        portfolioValue: '$18,000',
        equity: 18000,
        holdings: 3,
      });
    },
    async getPortfolioHoldings() {
      return createSuccess({
        source: 'portfolio_snapshots',
        observedAt: staleSnapshotObservedAt,
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
        limit: 80,
        offset: 0,
      });
    },
    async getPortfolioSnapshots() {
      return createSuccess({
        source: 'portfolio_snapshots',
        observedAt: staleSnapshotObservedAt,
        definition: 'Stored portfolio snapshot history ordered from newest to oldest capture.',
        items: [
          {
            id: 'snapshot-1',
            equity: 18000,
            createdAt: staleSnapshotObservedAt,
          },
        ],
        total: 1,
        limit: 10,
        offset: 0,
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
            accountKey: 'wallet-main',
            brokerKey: 'mudrex',
            status: 'connected',
            observedAt: staleFundsObservedAt,
            funds: {
              data: {
                balance: '200',
                withdrawable: '150',
                used_margin: '25',
              },
            },
            error: null,
          },
          {
            accountId: 'wallet-2',
            accountName: 'Missing Wallet',
            accountKey: 'wallet-missing',
            brokerKey: 'delta_exchange',
            status: 'connected',
            observedAt: null,
            funds: null,
            error: 'No snapshot available',
          },
        ],
      };
    },
    async getFuturesFundsForActiveAccounts() {
      return {
        items: [
          {
            accountId: 'futures-1',
            accountName: 'Delta Futures',
            accountKey: 'futures-main',
            brokerKey: 'delta_exchange',
            status: 'connected',
            observedAt: staleFundsObservedAt,
            funds: {
              futures_equity: '320',
              free_balance: '140',
              margin_used: '80',
            },
            error: null,
          },
        ],
      };
    },
  };

  const response = await service.getOverview('user-1', {
    timeframe: 'daily',
    snapshotsLimit: '10',
    snapshotsOffset: '0',
    holdingsLimit: '80',
  });

  assert.equal(response.data.meta.contractVersion, 'portfolio-overview-phase6-2026-04-10');
  assert.equal(response.data.meta.purpose, 'operator_portfolio_workspace');
  assert.deepEqual(response.data.meta.query.resolved, {
    timeframe: 'daily',
    snapshots: {
      limit: 10,
      offset: 0,
    },
    holdings: {
      limit: 80,
      offset: 0,
      filterMode: 'loaded_overview_slice_client_side',
    },
  });
  assert.equal(
    response.data.meta.sections.summary.freshness?.state,
    'stale'
  );
  assert.equal(response.data.meta.sections.activeFunds.availability, 'partial');
  assert.equal(
    response.data.meta.sections.activeFunds.freshness?.state,
    'critical'
  );
  assert.deepEqual(
    response.data.meta.warnings.map((warning: { code: string }) => warning.code),
    ['stored_snapshot_stale', 'funds_snapshot_attention']
  );
  assert.equal(response.data.activeFunds.walletItems[0].observedAt, staleFundsObservedAt);
  assert.equal(response.data.activeFunds.walletItems[1].error, 'No snapshot available');
  assert.equal(response.data.activeFunds.latestObservedAt, staleFundsObservedAt);
  assert.equal(response.data.activeFunds.oldestObservedAt, staleFundsObservedAt);
}

async function main(): Promise<void> {
  await runPortfolioPhase4ContractAssertions();
  console.log('Portfolio Phase 4 assertions passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
