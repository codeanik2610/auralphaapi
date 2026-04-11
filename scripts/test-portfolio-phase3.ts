import assert from 'node:assert/strict';

import { PortfolioService } from '../src/api/services/PortfolioService';
import { PortfolioOverviewService } from '../src/api/services/PortfolioOverviewService';

function createSuccess<T>(data: T) {
  return { success: true as const, data };
}

async function runHoldingsMetadataAssertions(): Promise<void> {
  const service = new PortfolioService() as any;

  service.portfolioRepository = {
    async listHoldings() {
      return {
        snapshot: {
          id: 'snapshot-1',
          createdAt: new Date('2026-04-09T10:05:00.000Z'),
        },
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
            contribution: 'Core trend exposure',
            lastRebalanceAt: new Date('2026-04-08T09:00:00.000Z'),
          },
        ],
        total: 1,
      };
    },
  };

  const response = await service.getPortfolioHoldings('user-1', {
    limit: '100',
    offset: '0',
  } as any);

  assert.equal(response.data.source, 'portfolio_snapshots');
  assert.equal(response.data.observedAt, '2026-04-09T10:05:00.000Z');
  assert.equal(
    response.data.definition,
    'Largest holdings ordered by market value from the latest stored portfolio snapshot.'
  );
  assert.equal(response.data.limit, 100);
  assert.equal(response.data.total, 1);
  assert.deepEqual(response.data.items[0], {
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
    contribution: 'Core trend exposure',
    lastRebalanceAt: '2026-04-08T09:00:00.000Z',
  });
}

async function runOverviewWorkspaceAssertions(): Promise<void> {
  const service = new PortfolioOverviewService() as any;
  let requestedHoldingsLimit: string | null = null;
  const freshObservedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();

  service.portfolioService = {
    async getPortfolioPnL() {
      return createSuccess({
        dailyPnL: 12,
        weeklyPnL: 24,
        monthlyPnL: 48,
      });
    },
    async getPortfolioPerformance() {
      return createSuccess({
        timeframe: 'daily',
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
        observedAt: freshObservedAt,
        portfolioValue: '$18,000',
        netExposure: '42%',
        diversification: 'Balanced',
        riskPosture: 'Healthy',
      });
    },
    async getPortfolioHoldings(
      _userId: string,
      query: { limit?: string; offset?: string }
    ) {
      requestedHoldingsLimit = query.limit || null;
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
        limit: Number(query.limit || 0),
        offset: 0,
      });
    },
    async getPortfolioSnapshots() {
      return createSuccess({
        source: 'portfolio_snapshots',
        items: [],
        total: 0,
        limit: 20,
        offset: 0,
      });
    },
  };

  service.brokerWalletFacadeService = {
    async getWalletFundsForActiveAccounts() {
      return { items: [] };
    },
    async getFuturesFundsForActiveAccounts() {
      return { items: [] };
    },
  };

  const response = await service.getOverview('user-1', {
    timeframe: 'daily',
    holdingsLimit: '80',
  });

  assert.equal(requestedHoldingsLimit, '80');
  assert.equal(response.data.meta.query.supported.includes('holdingsLimit'), true);
  assert.equal(response.data.meta.sources.holdings, 'portfolio_snapshots');
  assert.equal(response.data.meta.capabilities.holdingsIncludedInOverview, true);
  assert.equal(
    response.data.meta.sections.holdings.sourceLabel,
    'Latest stored holdings snapshot'
  );
  assert.equal(response.data.holdings.observedAt, freshObservedAt);
  assert.equal(response.data.holdings.limit, 80);
  assert.equal(response.data.holdings.items[0].symbol, 'BTCUSDT');
}

async function main(): Promise<void> {
  await runHoldingsMetadataAssertions();
  await runOverviewWorkspaceAssertions();
  console.log('Portfolio Phase 3 assertions passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
