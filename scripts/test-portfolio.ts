import assert from 'node:assert/strict';
import { runSuiteSteps } from './_support/run-script-suite';

// Consolidated module suite.

async function portfolioGuard01(): Promise<void> {
  const { PortfolioService } = await import("../src/api/services/PortfolioService");

const RealDate = Date;

class MockDate extends Date {
  constructor(value?: string | number | Date) {
    super(value ?? '2026-04-09T12:00:00.000Z');
  }

  static now(): number {
    return new RealDate('2026-04-09T12:00:00.000Z').getTime();
  }
}

function createPortfolioService() {
  const service = new PortfolioService() as any;

  service.brokerAccountRepository = {
    async getConnectedBrokerAccounts() {
      return [
        { id: 'acct-1' },
        { id: 'acct-2' },
      ];
    },
  };

  service.appSettingsRepository = {
    async getSettings() {
      return {
        timezone: 'Asia/Kolkata',
      };
    },
  };

  service.portfolioRepository = {
    async getPortfolioSummary() {
      return null;
    },
    async listPerformancePoints() {
      return [];
    },
  };

  return service;
}

async function runSummaryAssertions(): Promise<void> {
  const service = createPortfolioService();

  service.portfolioRepository.getPortfolioSummary = async () => ({
    id: 'snapshot-1',
    equity: 18250,
    dayPnL: 415,
    netExposure: '42%',
    diversification: 'Balanced',
    assetAllocation: 'Core majors',
    strategyMix: 'Trend / Carry',
    riskPosture: 'Healthy',
    accountCurve: 'Rising',
    monthlyPace: '+5%',
    createdAt: new RealDate('2026-04-09T10:05:00.000Z'),
    holdings: [
      { symbol: 'BTCUSDT', allocationPct: 35 },
      { symbol: 'ETHUSDT', allocationPct: 20 },
    ],
  });

  const response = await service.getPortfolioSummary('user-1');
  assert.equal(response.data.source, 'portfolio_snapshots');
  assert.equal(response.data.observedAt, '2026-04-09T10:05:00.000Z');
  assert.equal(response.data.definition, 'Latest stored portfolio snapshot summary.');
  assert.equal(response.data.portfolioValue, '$18,250');
  assert.equal(response.data.largestWeight, '35%');
  assert.equal(response.data.largestWeightLabel, 'BTCUSDT');
}

async function runPnLAssertions(): Promise<void> {
  const service = createPortfolioService();
  const capturedRanges: Array<{ startIso: string; endIso: string }> = [];
  let callIndex = 0;
  const responses = [
    [
      { accountId: 'acct-1', brokerKey: 'mudrex', payload: { pnl: '15' } },
      { accountId: 'acct-1', brokerKey: 'mudrex', payload: { realized_pnl: '-5' } },
    ],
    [
      { accountId: 'acct-1', brokerKey: 'mudrex', payload: { pnl: '15' } },
      { accountId: 'acct-1', brokerKey: 'mudrex', payload: { realized_pnl: '-5' } },
      { accountId: 'acct-2', brokerKey: 'delta_exchange', payload: { net_pnl: '25' } },
    ],
    [
      { accountId: 'acct-1', brokerKey: 'mudrex', payload: { pnl: '15' } },
      { accountId: 'acct-1', brokerKey: 'mudrex', payload: { realized_pnl: '-5' } },
      { accountId: 'acct-2', brokerKey: 'delta_exchange', payload: { net_pnl: '25' } },
      { accountId: 'acct-1', brokerKey: 'mudrex', payload: { realized: '-7' } },
    ],
  ];

  service.queryClosedPositionSnapshotsByPayloadDateRange = async (
    _userId: string,
    _accountIds: string[],
    startUtc: Date,
    endUtc: Date
  ) => {
    capturedRanges.push({
      startIso: startUtc.toISOString(),
      endIso: endUtc.toISOString(),
    });
    return responses[callIndex++] || [];
  };

  const response = await service.getPortfolioPnL('user-1');
  assert.equal(response.data.dailyPnL, 10);
  assert.equal(response.data.weeklyPnL, 35);
  assert.equal(response.data.monthlyPnL, 28);
  assert.equal(response.data.source, 'scheduler_positions_snapshots');
  assert.equal(response.data.measurement, 'realized_pnl');
  assert.deepEqual(response.data.windows, {
    timezone: 'Asia/Kolkata',
    daily: 'Today (Asia/Kolkata)',
    weekly: 'Trailing 7 days (Asia/Kolkata)',
    monthly: 'Trailing 30 days (Asia/Kolkata)',
  });
  assert.equal(capturedRanges[0]?.startIso, '2026-04-08T18:30:00.000Z');
  assert.equal(capturedRanges[0]?.endIso, '2026-04-09T18:30:00.000Z');
  assert.equal(
    (new RealDate(capturedRanges[1]?.endIso).getTime() -
      new RealDate(capturedRanges[1]?.startIso).getTime()) /
      (24 * 60 * 60 * 1000),
    7
  );
  assert.equal(
    (new RealDate(capturedRanges[2]?.endIso).getTime() -
      new RealDate(capturedRanges[2]?.startIso).getTime()) /
      (24 * 60 * 60 * 1000),
    30
  );
}

async function runPerformanceAssertions(): Promise<void> {
  const service = createPortfolioService();
  let capturedRange: { startIso: string; endIso: string } | null = null;

  service.queryClosedPositionSnapshotsByPayloadDateRange = async (
    _userId: string,
    _accountIds: string[],
    startUtc: Date,
    endUtc: Date
  ) => {
    capturedRange = {
      startIso: startUtc.toISOString(),
      endIso: endUtc.toISOString(),
    };

    return [
      {
        accountId: 'acct-1',
        brokerKey: 'mudrex',
        payload: {
          closedAt: '2026-04-03T03:00:00.000Z',
          pnl: '8',
          notional: '120',
        },
      },
      {
        accountId: 'acct-1',
        brokerKey: 'mudrex',
        payload: {
          closedAt: '2026-04-07T03:00:00.000Z',
          realized_pnl: '-4',
          notional: '80',
        },
      },
      {
        accountId: 'acct-2',
        brokerKey: 'delta_exchange',
        payload: {
          closedAt: '2026-04-09T03:00:00.000Z',
          net_pnl: '12',
          notional: '100',
        },
      },
    ];
  };

  service.portfolioRepository.listPerformancePoints = async () => [
    {
      equity: 15000,
      createdAt: new RealDate('2026-04-03T06:00:00.000Z'),
    },
    {
      equity: 18000,
      createdAt: new RealDate('2026-04-09T05:00:00.000Z'),
    },
  ];

  const response = await service.getPortfolioPerformance('user-1', 'weekly');
  const pointsByDate = Object.fromEntries(
    response.data.points.map((point: (typeof response.data.points)[number]) => [point.date, point])
  );

  assert.equal(response.data.timeframe, 'weekly');
  assert.equal(response.data.mode, 'closed-position-activity');
  assert.equal(response.data.source, 'scheduler_positions_snapshots');
  assert.equal(response.data.measurement, 'realized_pnl');
  assert.equal(response.data.windowLabel, 'Trailing 7 days (Asia/Kolkata)');
  assert.equal(response.data.bucketLabel, 'day');
  assert.equal(response.data.points.length, 7);
  assert.equal(pointsByDate['2026-04-03']?.equity, 15000);
  assert.equal(pointsByDate['2026-04-03']?.pnl, 8);
  assert.equal(pointsByDate['2026-04-07']?.pnl, -4);
  assert.equal(pointsByDate['2026-04-09']?.equity, 18000);
  assert.equal(pointsByDate['2026-04-09']?.totalTrades, 1);
  assert.equal(response.data.summary.totalEquity, 18000);
  assert.equal(response.data.summary.totalPnl, 16);
  assert.equal(response.data.summary.totalProfit, 20);
  assert.equal(response.data.summary.totalLoss, 4);
  assert.equal(response.data.summary.totalTrades, 3);
  if (!capturedRange) {
    throw new Error('Expected a captured performance range');
  }
  const range = capturedRange as { startIso: string; endIso: string };
  assert.equal(range.startIso, '2026-04-02T18:30:00.000Z');
  assert.equal(range.endIso, '2026-04-09T18:30:00.000Z');

  await assert.rejects(
    () => service.getPortfolioPerformance('user-1', 'quarterly'),
    /timeframe must be one of daily, weekly, or monthly/
  );
}

async function main(): Promise<void> {
  (globalThis as { Date: DateConstructor }).Date = MockDate as unknown as DateConstructor;

  try {
    await runSummaryAssertions();
    await runPnLAssertions();
    await runPerformanceAssertions();
    console.log('Portfolio Phase 1 assertions passed');
  } finally {
    (globalThis as { Date: DateConstructor }).Date = RealDate;
  }
}

  await main();
}

async function portfolioGuard02(): Promise<void> {
  const { PortfolioOverviewService } = await import("../src/api/services/PortfolioOverviewService");

function createSuccess<T>(data: T) {
  return { success: true as const, data };
}

async function runOverviewHydrationAssertions(): Promise<void> {
  const service = new PortfolioOverviewService() as any;
  let requestedActivityTimeframe: string | null = null;
  let requestedPositionsQuery: { limit?: string | number; offset?: string | number } | null = null;
  const freshObservedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();

  service.portfolioService = {
    async getFuturesSummary() {
      return createSuccess({
        source: 'funds_snapshots_plus_position_read_models',
        observedAt: freshObservedAt,
        observedAtIso: freshObservedAt,
        positionsObservedAt: freshObservedAt,
        positionsObservedAtIso: freshObservedAt,
        capitalObservedAt: freshObservedAt,
        capitalObservedAtIso: freshObservedAt,
        definition:
          'Futures summary built from live capital routes in funds snapshots plus open-position exposure in the positions read model.',
        futuresEquity: 320,
        availableCollateral: 140,
        usedMargin: 80,
        walletCollateral: 200,
        openPositions: 1,
        grossExposure: 12000,
        longExposure: 12000,
        shortExposure: 0,
        unrealizedPnl: 1800,
      });
    },
    async getOpenPositionsOverview(
      _userId: string,
      query: { limit?: string | number; offset?: string | number }
    ) {
      requestedPositionsQuery = query;
      return createSuccess({
        source: 'position_read_models',
        observedAt: freshObservedAt,
        observedAtIso: freshObservedAt,
        latestObservedAt: freshObservedAt,
        latestObservedAtIso: freshObservedAt,
        oldestObservedAt: freshObservedAt,
        oldestObservedAtIso: freshObservedAt,
        definition:
          'Open futures positions across connected accounts, normalized from the positions read model.',
        items: [
          {
            id: 'position-1',
            accountId: 'account-1',
            accountName: 'Delta Futures',
            accountKey: 'delta-futures',
            brokerKey: 'delta_exchange',
            symbol: 'BTCUSDT',
            quantity: 0.45,
            exposure: 12000,
            unrealizedPnl: 1800,
            side: 'Long',
            sideKey: 'long',
            status: 'Open',
            statusKey: 'open',
            entryPrice: 62000,
            currentPrice: 62400,
            closedPrice: null,
            realizedPnl: null,
            leverage: 5,
            liquidationPrice: 54000,
            freshness: {
              state: 'fresh',
              observedAt: freshObservedAt,
              freshnessMs: 60_000,
              staleAfterMs: 300_000,
              criticalAfterMs: 900_000,
              isStale: false,
              isCritical: false,
              source: 'position_read_models',
            },
            observedAt: freshObservedAt,
            observedAtIso: freshObservedAt,
          },
        ],
        total: 1,
        limit: Number(query.limit || 0),
        offset: 0,
      });
    },
    async getCapitalOverview() {
      return createSuccess({
        source: 'funds_snapshots via broker_wallet_facade',
        definition:
          'Wallet and futures capital routes normalized from the latest funds snapshot for each connected account.',
        freshnessModel: 'funds_snapshot_timestamp',
        latestObservedAt: freshObservedAt,
        latestObservedAtIso: freshObservedAt,
        oldestObservedAt: freshObservedAt,
        oldestObservedAtIso: freshObservedAt,
        walletItems: [
          {
            accountId: 'wallet-1',
            accountName: 'Mudrex Wallet',
            accountKey: '',
            brokerKey: 'mudrex',
            status: 'connected',
            observedAt: freshObservedAt,
            observedAtIso: freshObservedAt,
            error: null,
            funds: {
              balance: 200,
              available: 150,
              invested: 25,
            },
          },
        ],
        futuresItems: [
          {
            accountId: 'futures-1',
            accountName: 'Delta Futures',
            accountKey: '',
            brokerKey: 'delta_exchange',
            status: 'connected',
            observedAt: freshObservedAt,
            observedAtIso: freshObservedAt,
            error: null,
            funds: {
              balance: 320,
              available: 140,
              invested: 80,
            },
          },
        ],
        walletTotal: 200,
        futuresTotal: 320,
        totalVisibleCapital: 520,
        walletSharePct: 38.46,
        futuresSharePct: 61.54,
        driftPct: 23.08,
      });
    },
    async getActivityOverview(_userId: string, timeframe: string) {
      requestedActivityTimeframe = timeframe;
      return createSuccess({
        source: 'scheduler_positions_snapshots',
        definition:
          'Portfolio activity combines realized PnL windows and performance buckets from scheduler position snapshots.',
        freshnessModel: 'windowed_activity',
        observedAt: freshObservedAt,
        observedAtIso: freshObservedAt,
        pnl: {
          dailyPnL: 12,
          weeklyPnL: 24,
          monthlyPnL: 48,
          source: 'scheduler_positions_snapshots',
          measurement: 'realized_pnl',
          freshnessModel: 'windowed_activity',
          observedAt: freshObservedAt,
          observedAtIso: freshObservedAt,
          windows: {
            timezone: 'Asia/Kolkata',
            daily: 'Today (Asia/Kolkata)',
            weekly: 'Trailing 7 days (Asia/Kolkata)',
            monthly: 'Trailing 30 days (Asia/Kolkata)',
          },
        },
        performance: {
          timeframe,
          mode: 'closed-position-activity',
          source: 'scheduler_positions_snapshots',
          measurement: 'realized_pnl',
          freshnessModel: 'windowed_activity',
          observedAt: freshObservedAt,
          observedAtIso: freshObservedAt,
          windowLabel: 'Trailing 7 days (Asia/Kolkata)',
          bucketLabel: 'day',
          points: [],
          summary: {
            totalEquity: 18000,
            totalPnl: 24,
            totalProfit: 30,
            totalLoss: 6,
            totalTrades: 4,
            brokers: {},
          },
        },
      });
    },
  };

  const response = await service.getOverview('user-1', {
    timeframe: 'weekly',
    snapshotsLimit: '5',
    snapshotsOffset: '10',
  });

  assert.equal(requestedActivityTimeframe, 'weekly');
  assert.deepEqual(requestedPositionsQuery, {
    limit: '100',
    offset: '0',
  });
  assert.equal(response.data.meta.contractVersion, 'portfolio-overview-phase7-futures-2026-04-14');
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
    summary: 'funds_snapshots_plus_position_read_models (legacy alias)',
    holdings: 'position_read_models (legacy alias)',
    snapshots: 'deprecated legacy placeholder',
    activeFunds: 'funds_snapshots via broker_wallet_facade',
    futuresSummary: 'funds_snapshots_plus_position_read_models',
    positions: 'position_read_models',
    capital: 'funds_snapshots via broker_wallet_facade',
    activity: 'scheduler_positions_snapshots',
  });
  assert.equal(response.data.meta.capabilities.singleRequestHydration, true);
  assert.equal(response.data.meta.capabilities.holdingsIncludedInOverview, false);
  assert.equal(response.data.meta.capabilities.positionsIncludedInOverview, true);
  assert.equal(response.data.meta.warnings.length, 0);
  assert.equal(
    response.data.meta.sections.capital.sourceLabel,
    'Capital routes'
  );
  assert.equal(response.data.holdings.source, 'portfolio_overview_futures_legacy_alias');
  assert.equal(response.data.holdings.items.length, 1);
  assert.equal(response.data.activeFunds.source, 'funds_snapshots via broker_wallet_facade');
  assert.equal(
    response.data.activeFunds.definition,
    'Deprecated alias for capital routes. Use `capital` for wallet and futures route totals in the futures-only portfolio workspace.'
  );
  assert.equal(response.data.activeFunds.freshnessModel, 'funds_snapshot_timestamp');
  assert.equal(response.data.positions?.items[0]?.symbol, 'BTCUSDT');
  assert.equal(response.data.capital?.walletTotal, 200);
  assert.equal(response.data.futuresSummary?.futuresEquity, 320);
  assert.deepEqual(response.data.activeFunds.walletItems, [
    {
      accountId: 'wallet-1',
      accountName: 'Mudrex Wallet',
      accountKey: '',
      brokerKey: 'mudrex',
      status: 'connected',
      observedAt: freshObservedAt,
      observedAtIso: freshObservedAt,
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
      observedAtIso: freshObservedAt,
      error: null,
      funds: {
        balance: 320,
        available: 140,
        invested: 80,
      },
    },
  ]);
  assert.equal(response.data.snapshots.items.length, 0);
  assert.equal(response.data.snapshots.limit, 5);
  assert.equal(response.data.snapshots.offset, 10);
}

async function main(): Promise<void> {
  await runOverviewHydrationAssertions();
  console.log('Portfolio Phase 2 assertions passed');
}

  await main();
}

async function portfolioGuard03(): Promise<void> {
  const { PortfolioService } = await import("../src/api/services/PortfolioService");
  const { PortfolioOverviewService } = await import("../src/api/services/PortfolioOverviewService");

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
  let requestedPositionsLimit: string | number | null = null;
  const freshObservedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();

  service.portfolioService = {
    async getFuturesSummary() {
      return createSuccess({
        source: 'funds_snapshots_plus_position_read_models',
        observedAt: freshObservedAt,
        observedAtIso: freshObservedAt,
        positionsObservedAt: freshObservedAt,
        positionsObservedAtIso: freshObservedAt,
        capitalObservedAt: freshObservedAt,
        capitalObservedAtIso: freshObservedAt,
        definition:
          'Futures summary built from live capital routes in funds snapshots plus open-position exposure in the positions read model.',
        futuresEquity: 18000,
        availableCollateral: 12000,
        usedMargin: 4000,
        walletCollateral: 0,
        openPositions: 1,
        grossExposure: 12000,
        longExposure: 12000,
        shortExposure: 0,
        unrealizedPnl: 1800,
      });
    },
    async getOpenPositionsOverview(
      _userId: string,
      query: { limit?: string | number; offset?: string | number }
    ) {
      requestedPositionsLimit = query.limit || null;
      return createSuccess({
        observedAt: freshObservedAt,
        observedAtIso: freshObservedAt,
        latestObservedAt: freshObservedAt,
        latestObservedAtIso: freshObservedAt,
        oldestObservedAt: freshObservedAt,
        oldestObservedAtIso: freshObservedAt,
        source: 'position_read_models',
        definition:
          'Open futures positions across connected accounts, normalized from the positions read model.',
        items: [
          {
            id: 'position-1',
            accountId: 'account-1',
            accountName: 'Delta Futures',
            accountKey: 'delta-futures',
            brokerKey: 'delta_exchange',
            symbol: 'BTCUSDT',
            quantity: 0.45,
            exposure: 12000,
            unrealizedPnl: 1800,
            side: 'Long',
            sideKey: 'long',
            status: 'Open',
            statusKey: 'open',
            entryPrice: 62000,
            currentPrice: 62400,
            leverage: 5,
            liquidationPrice: 54000,
            freshness: {
              state: 'fresh',
              observedAt: freshObservedAt,
              freshnessMs: 10_000,
              staleAfterMs: 300_000,
              criticalAfterMs: 900_000,
              isStale: false,
              isCritical: false,
              source: 'position_read_models',
            },
            observedAt: freshObservedAt,
            observedAtIso: freshObservedAt,
          },
        ],
        total: 1,
        limit: Number(query.limit || 0),
        offset: 0,
      });
    },
    async getCapitalOverview() {
      return createSuccess({
        source: 'funds_snapshots via broker_wallet_facade',
        definition:
          'Wallet and futures capital routes normalized from the latest funds snapshot for each connected account.',
        freshnessModel: 'funds_snapshot_timestamp',
        latestObservedAt: freshObservedAt,
        latestObservedAtIso: freshObservedAt,
        oldestObservedAt: freshObservedAt,
        oldestObservedAtIso: freshObservedAt,
        walletItems: [],
        futuresItems: [],
        walletTotal: 0,
        futuresTotal: 18000,
        totalVisibleCapital: 18000,
        walletSharePct: 0,
        futuresSharePct: 100,
        driftPct: 100,
      });
    },
    async getActivityOverview() {
      return createSuccess({
        source: 'scheduler_positions_snapshots',
        definition:
          'Portfolio activity combines realized PnL windows and performance buckets from scheduler position snapshots.',
        freshnessModel: 'windowed_activity',
        observedAt: freshObservedAt,
        observedAtIso: freshObservedAt,
        pnl: {
          dailyPnL: 12,
          weeklyPnL: 24,
          monthlyPnL: 48,
          source: 'scheduler_positions_snapshots',
          measurement: 'realized_pnl',
          freshnessModel: 'windowed_activity',
          observedAt: freshObservedAt,
          observedAtIso: freshObservedAt,
        },
        performance: {
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
        },
      });
    },
  };

  const response = await service.getOverview('user-1', {
    timeframe: 'daily',
    holdingsLimit: '80',
  });

  assert.equal(requestedPositionsLimit, '80');
  assert.equal(response.data.meta.query.supported.includes('holdingsLimit'), true);
  assert.equal(response.data.meta.sources.holdings, 'position_read_models (legacy alias)');
  assert.equal(response.data.meta.capabilities.holdingsIncludedInOverview, false);
  assert.equal(
    response.data.meta.sections.holdings.sourceLabel,
    'Legacy holdings alias'
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

  await main();
}

async function portfolioGuard04(): Promise<void> {
  const { PortfolioOverviewService } = await import("../src/api/services/PortfolioOverviewService");

function createSuccess<T>(data: T) {
  return { success: true as const, data };
}

async function runPortfolioPhase4ContractAssertions(): Promise<void> {
  const service = new PortfolioOverviewService() as any;
  const staleSnapshotObservedAt = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString();
  const staleFundsObservedAt = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();

  service.portfolioService = {
    async getFuturesSummary() {
      return createSuccess({
        source: 'funds_snapshots_plus_position_read_models',
        observedAt: staleSnapshotObservedAt,
        observedAtIso: staleSnapshotObservedAt,
        positionsObservedAt: staleSnapshotObservedAt,
        positionsObservedAtIso: staleSnapshotObservedAt,
        capitalObservedAt: staleFundsObservedAt,
        capitalObservedAtIso: staleFundsObservedAt,
        definition:
          'Futures summary built from live capital routes in funds snapshots plus open-position exposure in the positions read model.',
        futuresEquity: 320,
        availableCollateral: 140,
        usedMargin: 80,
        walletCollateral: 200,
        openPositions: 1,
        grossExposure: 12000,
        longExposure: 12000,
        shortExposure: 0,
        unrealizedPnl: 1800,
      });
    },
    async getOpenPositionsOverview() {
      return createSuccess({
        source: 'position_read_models',
        observedAt: staleSnapshotObservedAt,
        observedAtIso: staleSnapshotObservedAt,
        latestObservedAt: staleSnapshotObservedAt,
        latestObservedAtIso: staleSnapshotObservedAt,
        oldestObservedAt: staleSnapshotObservedAt,
        oldestObservedAtIso: staleSnapshotObservedAt,
        definition:
          'Open futures positions across connected accounts, normalized from the positions read model.',
        items: [
          {
            id: 'position-1',
            accountId: 'futures-1',
            accountName: 'Delta Futures',
            accountKey: 'futures-main',
            brokerKey: 'delta_exchange',
            symbol: 'BTCUSDT',
            quantity: 0.45,
            exposure: 12000,
            unrealizedPnl: 1800,
            side: 'Long',
            sideKey: 'long',
            status: 'Open',
            statusKey: 'open',
            entryPrice: 62000,
            currentPrice: 62400,
            leverage: 5,
            liquidationPrice: 54000,
            freshness: {
              state: 'critical',
              observedAt: staleSnapshotObservedAt,
              freshnessMs: 7 * 60 * 60 * 1000,
              staleAfterMs: 300_000,
              criticalAfterMs: 900_000,
              isStale: true,
              isCritical: true,
              source: 'position_read_models',
            },
            observedAt: staleSnapshotObservedAt,
            observedAtIso: staleSnapshotObservedAt,
          },
        ],
        total: 1,
        limit: 80,
        offset: 0,
      });
    },
    async getCapitalOverview() {
      return createSuccess({
        source: 'funds_snapshots via broker_wallet_facade',
        definition:
          'Wallet and futures capital routes normalized from the latest funds snapshot for each connected account.',
        freshnessModel: 'funds_snapshot_timestamp',
        latestObservedAt: staleFundsObservedAt,
        latestObservedAtIso: staleFundsObservedAt,
        oldestObservedAt: staleFundsObservedAt,
        oldestObservedAtIso: staleFundsObservedAt,
        walletItems: [
          {
            accountId: 'wallet-1',
            accountName: 'Mudrex Wallet',
            accountKey: 'wallet-main',
            brokerKey: 'mudrex',
            status: 'connected',
            observedAt: staleFundsObservedAt,
            observedAtIso: staleFundsObservedAt,
            funds: {
              balance: 200,
              available: 150,
              invested: 25,
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
            observedAtIso: null,
            funds: {
              balance: 0,
              available: 0,
              invested: 0,
            },
            error: 'No snapshot available',
          },
        ],
        futuresItems: [
          {
            accountId: 'futures-1',
            accountName: 'Delta Futures',
            accountKey: 'futures-main',
            brokerKey: 'delta_exchange',
            status: 'connected',
            observedAt: staleFundsObservedAt,
            observedAtIso: staleFundsObservedAt,
            funds: {
              balance: 320,
              available: 140,
              invested: 80,
            },
            error: null,
          },
        ],
        walletTotal: 200,
        futuresTotal: 320,
        totalVisibleCapital: 520,
        walletSharePct: 38.46,
        futuresSharePct: 61.54,
        driftPct: 23.08,
      });
    },
    async getActivityOverview() {
      return createSuccess({
        source: 'scheduler_positions_snapshots',
        definition:
          'Portfolio activity combines realized PnL windows and performance buckets from scheduler position snapshots.',
        freshnessModel: 'windowed_activity',
        observedAt: staleSnapshotObservedAt,
        observedAtIso: staleSnapshotObservedAt,
        pnl: {
          dailyPnL: 12,
          weeklyPnL: 24,
          monthlyPnL: 48,
          source: 'scheduler_positions_snapshots',
          measurement: 'realized_pnl',
          freshnessModel: 'windowed_activity',
          observedAt: staleSnapshotObservedAt,
          observedAtIso: staleSnapshotObservedAt,
          definition:
            'Realized PnL aggregated from closed-position scheduler snapshots across active accounts.',
          windows: {
            timezone: 'Asia/Kolkata',
            daily: 'Today (Asia/Kolkata)',
            weekly: 'Trailing 7 days (Asia/Kolkata)',
            monthly: 'Trailing 30 days (Asia/Kolkata)',
          },
        },
        performance: {
          timeframe: 'daily',
          source: 'scheduler_positions_snapshots',
          measurement: 'realized_pnl',
          freshnessModel: 'windowed_activity',
          observedAt: staleSnapshotObservedAt,
          observedAtIso: staleSnapshotObservedAt,
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
        },
      });
    },
  };

  const response = await service.getOverview('user-1', {
    timeframe: 'daily',
    snapshotsLimit: '10',
    snapshotsOffset: '0',
    holdingsLimit: '80',
  });

  assert.equal(response.data.meta.contractVersion, 'portfolio-overview-phase7-futures-2026-04-14');
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
    'critical'
  );
  assert.equal(response.data.meta.sections.capital.availability, 'partial');
  assert.equal(
    response.data.meta.sections.capital.freshness?.state,
    'critical'
  );
  assert.deepEqual(
    response.data.meta.warnings.map((warning: { code: string }) => warning.code),
    ['funds_snapshot_attention', 'positions_snapshot_attention', 'futures_summary_attention']
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

  await main();
}

async function portfolioGuard05(): Promise<void> {
  const { PortfolioOverviewService } = await import("../src/api/services/PortfolioOverviewService");
  const { PortfolioService } = await import("../src/api/services/PortfolioService");
  const { buildPositionReadModelUpsert } = await import("../src/api/utils/positionsReadModel");
  const { coreDataSource } = await import("../src/database/data-source");
  const { PortfolioHolding } = await import("../src/database/entities/PortfolioHolding");
  const { PortfolioSnapshot } = await import("../src/database/entities/PortfolioSnapshot");
  const { PortfolioRepository } = await import("../src/database/repositories/PortfolioRepository");
  const { PositionReadModelRepository } = await import("../src/database/repositories/PositionReadModelRepository");

function createSuccess<T>(data: T) {
  return { success: true as const, data };
}

function isDate(value: unknown): value is Date {
  return value instanceof Date;
}

async function runReadModelUpsertAssertions(): Promise<void> {
  const row = buildPositionReadModelUpsert({
    userId: 'user-1',
    accountId: 'acc-1',
    brokerKey: 'mudrex',
    externalId: 'pos-1',
    statusRank: 3,
    payload: {
      id: 'pos-1',
      symbol: 'BTCUSDT',
      status: 'closed',
      quantity: '0.25',
      entry_price: '50000',
      updated_at: '2026-04-09T10:20:00.000Z',
      realized_pnl: '42',
    },
  });

  assert.ok(row, 'expected a read-model upsert row');
  assert.equal(row?.positionClosedAt, '2026-04-09T10:20:00.000Z');
  assert.equal(row?.realizedPnl, 42);
}

async function runReadModelRepositoryDateNormalizationAssertions(): Promise<void> {
  const repository = new PositionReadModelRepository();
  const originalQuery = coreDataSource.query.bind(coreDataSource);
  let capturedParams: unknown[] | null = null;

  const row = buildPositionReadModelUpsert({
    userId: 'user-1',
    accountId: 'acc-1',
    brokerKey: 'mudrex',
    externalId: 'pos-1',
    statusRank: 3,
    firstSeenAt: '2026-04-09T10:00:00.000Z',
    lastSeenAt: '2026-04-09T10:30:00.000Z',
    payload: {
      id: 'pos-1',
      symbol: 'BTCUSDT',
      status: 'closed',
      quantity: '0.25',
      entry_price: '50000',
      created_at: '2026-04-09T10:05:00.000Z',
      updated_at: '2026-04-09T10:20:00.000Z',
      closed_at: '2026-04-09T10:25:00.000Z',
      realized_pnl: '42',
    },
  });

  assert.ok(row, 'expected a read-model upsert row for repository normalization');

  (coreDataSource as any).query = async (sql: string, params?: unknown[]) => {
    assert.match(sql, /INSERT INTO position_read_models/);
    capturedParams = Array.isArray(params) ? params : [];
    return [];
  };

  try {
    await repository.upsertReadModels([row]);
  } finally {
    (coreDataSource as any).query = originalQuery;
  }

  assert.ok(capturedParams, 'expected the repository upsert to capture SQL params');
  const normalizedCapturedParams = capturedParams as unknown[];
  const positionCreatedAt = normalizedCapturedParams[27];
  const positionUpdatedAt = normalizedCapturedParams[28];
  const positionClosedAt = normalizedCapturedParams[29];

  if (!isDate(positionCreatedAt)) {
    throw new Error('positionCreatedAt should be normalized to Date');
  }
  if (!isDate(positionUpdatedAt)) {
    throw new Error('positionUpdatedAt should be normalized to Date');
  }
  if (!isDate(positionClosedAt)) {
    throw new Error('positionClosedAt should be normalized to Date');
  }
  assert.equal(
    positionCreatedAt.toISOString(),
    '2026-04-09T10:05:00.000Z'
  );
  assert.equal(
    positionUpdatedAt.toISOString(),
    '2026-04-09T10:20:00.000Z'
  );
  assert.equal(
    positionClosedAt.toISOString(),
    '2026-04-09T10:25:00.000Z'
  );
}

async function runReadModelQueryAssertions(): Promise<void> {
  const service = new PortfolioService() as any;
  const originalQuery = coreDataSource.query.bind(coreDataSource);
  let hydratedArgs: { userId: string; accountIds: string[] } | null = null;

  service.positionReadModelRepository = {
    async ensureHydratedFromSnapshots(userId: string, accountIds: string[]) {
      hydratedArgs = { userId, accountIds };
    },
  };

  (coreDataSource as any).query = async (sql: string, params?: unknown[]) => {
    assert.match(sql, /FROM position_read_models/);
    assert.deepEqual(params, [
      'user-1',
      'acc-1',
      new Date('2026-04-09T00:00:00.000Z'),
      new Date('2026-04-10T00:00:00.000Z'),
    ]);
    return [
      {
        accountId: 'acc-1',
        brokerKey: 'mudrex',
        realizedPnl: '14.5',
        exposure: '1250',
        positionClosedAt: '2026-04-09T10:30:00.000Z',
        lastSeenAt: '2026-04-09T10:32:00.000Z',
      },
    ];
  };

  try {
    const rows = await service.queryClosedPositionSnapshotsByPayloadDateRange(
      'user-1',
      ['acc-1'],
      new Date('2026-04-09T00:00:00.000Z'),
      new Date('2026-04-10T00:00:00.000Z')
    );

    assert.deepEqual(hydratedArgs, {
      userId: 'user-1',
      accountIds: ['acc-1'],
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].brokerKey, 'mudrex');
    assert.equal(rows[0].payload.realized_pnl, 14.5);
    assert.equal(rows[0].payload.notional, 1250);
    assert.equal(rows[0].payload.closedAt, '2026-04-09T10:30:00.000Z');
    assert.equal(rows[0].payload.updatedAt, '2026-04-09T10:32:00.000Z');
  } finally {
    (coreDataSource as any).query = originalQuery;
  }
}

async function runSchedulerFallbackAssertions(): Promise<void> {
  const service = new PortfolioService() as any;
  const originalQuery = coreDataSource.query.bind(coreDataSource);

  service.positionReadModelRepository = {
    async ensureHydratedFromSnapshots() {
      const error = new Error("position_read_models doesn't exist") as Error & {
        code?: string;
      };
      error.code = 'ER_NO_SUCH_TABLE';
      throw error;
    },
  };

  (coreDataSource as any).query = async (sql: string) => {
    assert.match(sql, /FROM scheduler_positions_snapshots/);
    return [
      {
        accountId: 'acc-1',
        brokerKey: 'mudrex',
        payload: JSON.stringify({
          closedAt: '2026-04-09T11:00:00.000Z',
          realized_pnl: '7',
          notional: '80',
        }),
      },
    ];
  };

  try {
    const rows = await service.queryClosedPositionSnapshotsByPayloadDateRange(
      'user-1',
      ['acc-1'],
      new Date('2026-04-09T00:00:00.000Z'),
      new Date('2026-04-10T00:00:00.000Z')
    );

    assert.equal(rows.length, 1);
    assert.equal(rows[0].payload.realized_pnl, '7');
    assert.equal(rows[0].payload.closedAt, '2026-04-09T11:00:00.000Z');
  } finally {
    (coreDataSource as any).query = originalQuery;
  }
}

async function runSnapshotRepositoryAssertions(): Promise<void> {
  const repository = new PortfolioRepository();
  const originalGetRepository = coreDataSource.getRepository.bind(coreDataSource);
  let latestSnapshotJoinedHoldings = 0;
  let latestSnapshotSelectedColumns: string[] | null = null;

  function createSnapshotQueryBuilder() {
    return {
      select(columns: string[]) {
        latestSnapshotSelectedColumns = columns;
        return this;
      },
      where() {
        return this;
      },
      orderBy() {
        return this;
      },
      leftJoinAndSelect() {
        latestSnapshotJoinedHoldings += 1;
        return this;
      },
      addOrderBy() {
        return this;
      },
      async getOne() {
        return {
          id: 'snapshot-1',
          createdAt: new Date('2026-04-09T10:05:00.000Z'),
        };
      },
    };
  }

  function createHoldingQueryBuilder() {
    return {
      where() {
        return this;
      },
      andWhere() {
        return this;
      },
      orderBy() {
        return this;
      },
      skip() {
        return this;
      },
      take() {
        return this;
      },
      async getManyAndCount() {
        return [[], 0] as const;
      },
    };
  }

  (coreDataSource as any).getRepository = (entity: unknown) => {
    if (entity === PortfolioSnapshot) {
      return {
        createQueryBuilder: () => createSnapshotQueryBuilder(),
      };
    }
    if (entity === PortfolioHolding) {
      return {
        createQueryBuilder: () => createHoldingQueryBuilder(),
      };
    }
    throw new Error(`Unexpected repository request: ${String(entity)}`);
  };

  try {
    const result = await repository.listHoldings('user-1', {
      limit: 25,
      offset: 0,
    });

    assert.equal(latestSnapshotJoinedHoldings, 0);
    assert.deepEqual(latestSnapshotSelectedColumns, ['snapshot.id', 'snapshot.createdAt']);
    assert.equal(result.snapshot?.id, 'snapshot-1');
  } finally {
    (coreDataSource as any).getRepository = originalGetRepository;
  }
}

async function runOverviewCapabilityAssertions(): Promise<void> {
  const service = new PortfolioOverviewService() as any;

  service.userTimeZoneService = {
    async resolveUserTimeZone() {
      return 'Asia/Kolkata';
    },
  };

  service.portfolioService = {
    async getFuturesSummary() {
      return createSuccess({
        source: 'funds_snapshots_plus_position_read_models',
        observedAt: '2026-04-09T10:05:00.000Z',
        observedAtIso: '2026-04-09T10:05:00.000Z',
        positionsObservedAt: '2026-04-09T10:05:00.000Z',
        positionsObservedAtIso: '2026-04-09T10:05:00.000Z',
        capitalObservedAt: '2026-04-09T10:05:00.000Z',
        capitalObservedAtIso: '2026-04-09T10:05:00.000Z',
        definition:
          'Futures summary built from live capital routes in funds snapshots plus open-position exposure in the positions read model.',
        futuresEquity: 0,
        availableCollateral: 0,
        usedMargin: 0,
        walletCollateral: 0,
        openPositions: 0,
        grossExposure: 0,
        longExposure: 0,
        shortExposure: 0,
        unrealizedPnl: 0,
      });
    },
    async getOpenPositionsOverview() {
      return createSuccess({
        source: 'position_read_models',
        observedAt: null,
        observedAtIso: null,
        latestObservedAt: null,
        latestObservedAtIso: null,
        oldestObservedAt: null,
        oldestObservedAtIso: null,
        definition:
          'Open futures positions across connected accounts, normalized from the positions read model.',
        items: [],
        total: 0,
        limit: 25,
        offset: 0,
      });
    },
    async getCapitalOverview() {
      return createSuccess({
        source: 'funds_snapshots via broker_wallet_facade',
        definition:
          'Wallet and futures capital routes normalized from the latest funds snapshot for each connected account.',
        freshnessModel: 'funds_snapshot_timestamp',
        latestObservedAt: null,
        latestObservedAtIso: null,
        oldestObservedAt: null,
        oldestObservedAtIso: null,
        walletItems: [],
        futuresItems: [],
        walletTotal: 0,
        futuresTotal: 0,
        totalVisibleCapital: 0,
        walletSharePct: 0,
        futuresSharePct: 0,
        driftPct: 0,
      });
    },
    async getActivityOverview() {
      return createSuccess({
        source: 'scheduler_positions_snapshots',
        definition:
          'Portfolio activity combines realized PnL windows and performance buckets from scheduler position snapshots.',
        freshnessModel: 'windowed_activity',
        observedAt: null,
        observedAtIso: null,
        pnl: {
          dailyPnL: 0,
          weeklyPnL: 0,
          monthlyPnL: 0,
          source: 'scheduler_positions_snapshots',
          measurement: 'realized_pnl',
          freshnessModel: 'windowed_activity',
          observedAt: null,
          definition:
            'Realized PnL aggregated from closed-position scheduler snapshots across active accounts.',
          windows: {
            timezone: 'Asia/Kolkata',
            daily: 'Today (Asia/Kolkata)',
            weekly: 'Trailing 7 days (Asia/Kolkata)',
            monthly: 'Trailing 30 days (Asia/Kolkata)',
          },
        },
        performance: {
          timeframe: 'daily',
          source: 'scheduler_positions_snapshots',
          measurement: 'realized_pnl',
          freshnessModel: 'windowed_activity',
          observedAt: null,
          definition:
            'Closed-position activity aggregated from scheduler snapshots for the selected portfolio timeframe.',
          points: [],
          summary: {
            totalEquity: 0,
            totalPnl: 0,
            totalProfit: 0,
            totalLoss: 0,
            totalTrades: 0,
            brokers: {},
          },
        },
      });
    },
  };

  const response = await service.getOverview('user-1', {
    timeframe: 'daily',
    snapshotsLimit: '10',
    holdingsLimit: '25',
  });

  assert.equal(response.data.meta.capabilities.indexedSnapshotReads, false);
  assert.equal(response.data.meta.capabilities.activityReadModelAcceleration, true);
  assert.equal(response.data.meta.capabilities.portfolioHealthChecks, true);
  assert.equal(response.data.meta.capabilities.futuresOverview, true);
  assert.equal(response.data.meta.capabilities.positionsIncludedInOverview, true);
  assert.equal(response.data.meta.capabilities.legacyFieldsAreCompatibilityAliases, true);
}

async function main(): Promise<void> {
  await runReadModelUpsertAssertions();
  await runReadModelRepositoryDateNormalizationAssertions();
  await runReadModelQueryAssertions();
  await runSchedulerFallbackAssertions();
  await runSnapshotRepositoryAssertions();
  await runOverviewCapabilityAssertions();
  console.log('Portfolio Phase 5 assertions passed');
}

  await main();
}

async function portfolioGuard06(): Promise<void> {
  const { PortfolioOverviewService } = await import("../src/api/services/PortfolioOverviewService");
  const { PortfolioService } = await import("../src/api/services/PortfolioService");
  const { buildApiTimeContract, formatApiDisplayTime, } = await import("../src/api/utils/apiTimeContract");

function createSuccess<T>(data: T) {
  return { success: true as const, data };
}

function createWorkspaceReviewStubs(service: Record<string, any>) {
  const activityLogCalls: Array<{ userId: string; payload: unknown }> = [];

  (service as any).appSettingsRepository = {
    async getSettings() {
      return {
        timezone: 'Asia/Calcutta',
      };
    },
  };

  service.getPortfolioSummary = async () =>
    createSuccess({
      equity: 18000,
      dayPnL: 250,
      netExposure: '42%',
      diversification: 'Balanced',
      observedAt: '2026-04-09T10:05:00.000Z',
      definition: 'Latest stored portfolio snapshot summary.',
      source: 'portfolio_snapshots',
      portfolioValue: '$18,000',
      holdings: 2,
      largestWeight: '55%',
      largestWeightLabel: 'BTCUSDT',
    });

  service.getPortfolioHoldings = async () =>
    createSuccess({
      source: 'portfolio_snapshots',
      observedAt: '2026-04-09T10:05:00.000Z',
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
          contribution: 'Core trend exposure',
        },
        {
          id: 'holding-2',
          symbol: 'ETHUSDT',
          quantity: 2.2,
          marketValue: 6000,
          allocationPct: 27,
          dayPnL: -120,
          unrealizedPnL: 420,
          side: 'Long',
          strategy: 'Carry',
          riskState: 'Watch',
          sleeve: 'Majors',
          contribution: 'Yield sleeve',
        },
      ],
      total: 2,
      limit: 100,
      offset: 0,
    });

  service.getPortfolioPerformance = async (_userId: string, timeframe: string) => {
    const resolvedTimeframe: 'daily' | 'weekly' | 'monthly' =
      timeframe === 'weekly' || timeframe === 'monthly' ? timeframe : 'daily';
    return createSuccess({
      timeframe: resolvedTimeframe,
      windowLabel:
        resolvedTimeframe === 'weekly'
          ? 'Trailing 7 days (Asia/Kolkata)'
          : resolvedTimeframe === 'monthly'
            ? 'Trailing 30 days (Asia/Kolkata)'
            : 'Today (Asia/Kolkata)',
      observedAt: '2026-04-09T10:06:00.000Z',
      source: 'scheduler_positions_snapshots',
      mode: 'closed-position-activity',
      summary: {
        totalEquity: 18000,
        totalPnl: resolvedTimeframe === 'weekly' ? -72 : -12,
        totalProfit: 25,
        totalLoss: 84,
        totalTrades: 3,
        brokers: {},
      },
      points: [],
    });
  };

  (service as any).brokerWalletFacadeService = {
    async getWalletFundsForActiveAccounts() {
      return {
        items: [
          {
            accountId: 'wallet-1',
            accountName: 'Main wallet',
            brokerKey: 'mudrex',
            observedAt: '2026-04-09T10:07:00.000Z',
            error: null,
            funds: {
              balance: 900,
            },
          },
        ],
      };
    },
    async getFuturesFundsForActiveAccounts() {
      return {
        items: [
          {
            accountId: 'futures-1',
            accountName: 'Main futures',
            brokerKey: 'delta_exchange',
            observedAt: '2026-04-09T10:08:00.000Z',
            error: null,
            funds: {
              balance: 100,
            },
          },
        ],
      };
    },
  };

  (service as any).operationalEventService = {
    async logActivity(userId: string, payload: unknown) {
      activityLogCalls.push({ userId, payload });
    },
    async emitFailureAlert() {
      throw new Error('emitFailureAlert should not be called in the success path');
    },
  };

  return { activityLogCalls };
}

async function runWorkspaceReviewAssertions(): Promise<void> {
  const service = new PortfolioService() as Record<string, any>;
  const { activityLogCalls } = createWorkspaceReviewStubs(service);

  const response = await service.rebalancePortfolio('user-1', {
    scope: 'workspace',
    mode: 'review',
    timeframe: 'weekly',
    holdingsFocus: 'watch',
    holdingsSearch: 'yield',
    selectedHoldingId: 'holding-2',
  });

  const review = response.data.review;

  assert.equal(response.data.message, 'Rebalance review generated');
  assert.equal(review.context.timeframe, 'weekly');
  assert.equal(review.context.holdingsFocus, 'watch');
  assert.equal(review.context.holdingsSearch, 'yield');
  assert.equal(review.context.selectedHoldingId, 'holding-2');
  assert.equal(review.context.selectedHoldingSymbol, 'ETHUSDT');
  assert.match(review.summary, /watch holdings workspace/i);
  assert.match(review.note, /manual/i);
  assert.ok(review.highlights.some((item: { label: string }) => item.label === 'Selected holding'));
  assert.ok(review.actions.some((item: { code: string }) => item.code === 'review_watchlist'));
  assert.ok(review.actions.some((item: { code: string }) => item.code === 'align_capital_routes'));
  assert.ok(review.actions.some((item: { code: string }) => item.code === 'review_recent_activity'));
  assert.equal(activityLogCalls.length, 1);
  assert.equal(activityLogCalls[0]?.userId, 'user-1');
}

async function runWorkspaceReportAssertions(): Promise<void> {
  const service = new PortfolioService() as Record<string, any>;
  createWorkspaceReviewStubs(service);

  const markdownResponse = await service.generateWorkspaceReport('user-1', {
    timeframe: 'daily',
    holdingsFocus: 'watch',
    holdingsSearch: 'yield',
    selectedHoldingId: 'holding-2',
    format: 'markdown',
  });
  const markdownReport = markdownResponse.data.report;

  assert.equal(markdownResponse.data.message, 'Workspace report generated');
  assert.equal(markdownReport.format, 'markdown');
  assert.equal(markdownReport.contentType, 'text/markdown; charset=utf-8');
  assert.match(markdownReport.fileName, /^portfolio-workspace-daily-.*\.md$/);
  assert.match(markdownReport.content, /^# Portfolio workspace report/m);
  assert.match(markdownReport.content, /## Recommended actions/m);

  const jsonResponse = await service.generateWorkspaceReport('user-1', {
    timeframe: 'daily',
    holdingsFocus: 'watch',
    holdingsSearch: 'yield',
    selectedHoldingId: 'holding-2',
    format: 'json',
  });
  const jsonReport = jsonResponse.data.report;
  const parsed = JSON.parse(jsonReport.content);

  assert.equal(jsonReport.format, 'json');
  assert.equal(jsonReport.contentType, 'application/json; charset=utf-8');
  assert.match(jsonReport.fileName, /^portfolio-workspace-daily-.*\.json$/);
  assert.equal(parsed.context.selectedHoldingSymbol, 'ETHUSDT');
  assert.ok(Array.isArray(parsed.actions));
  assert.ok(parsed.actions.some((item: { code: string }) => item.code === 'review_watchlist'));
}

async function runOverviewCapabilityAssertions(): Promise<void> {
  const service = new PortfolioOverviewService() as Record<string, any>;
  const timeZone = 'Asia/Calcutta';

  (service as any).userTimeZoneService = {
    async resolveUserTimeZone() {
      return timeZone;
    },
  };

  (service as any).portfolioService = {
    async getFuturesSummary() {
      return createSuccess({
        source: 'funds_snapshots_plus_position_read_models',
        observedAt: '2026-04-09T10:05:00.000Z',
        observedAtIso: '2026-04-09T10:05:00.000Z',
        positionsObservedAt: '2026-04-09T10:05:00.000Z',
        positionsObservedAtIso: '2026-04-09T10:05:00.000Z',
        capitalObservedAt: '2026-04-09T10:07:00.000Z',
        capitalObservedAtIso: '2026-04-09T10:07:00.000Z',
        definition:
          'Futures summary built from live capital routes in funds snapshots plus open-position exposure in the positions read model.',
        futuresEquity: 100,
        availableCollateral: 60,
        usedMargin: 40,
        walletCollateral: 900,
        openPositions: 0,
        grossExposure: 0,
        longExposure: 0,
        shortExposure: 0,
        unrealizedPnl: 0,
      });
    },
    async getOpenPositionsOverview() {
      return createSuccess({
        source: 'position_read_models',
        observedAt: null,
        observedAtIso: null,
        latestObservedAt: null,
        latestObservedAtIso: null,
        oldestObservedAt: null,
        oldestObservedAtIso: null,
        definition:
          'Open futures positions across connected accounts, normalized from the positions read model.',
        items: [],
        total: 0,
        limit: 100,
        offset: 0,
      });
    },
    async getCapitalOverview() {
      return createSuccess({
        source: 'funds_snapshots via broker_wallet_facade',
        definition:
          'Wallet and futures capital routes normalized from the latest funds snapshot for each connected account.',
        freshnessModel: 'funds_snapshot_timestamp',
        latestObservedAt: '2026-04-09T10:08:00.000Z',
        latestObservedAtIso: '2026-04-09T10:08:00.000Z',
        oldestObservedAt: '2026-04-09T10:07:00.000Z',
        oldestObservedAtIso: '2026-04-09T10:07:00.000Z',
        walletItems: [
          {
            accountId: 'wallet-1',
            accountName: 'Mudrex Wallet',
            accountKey: '',
            brokerKey: 'mudrex',
            status: 'connected',
            observedAt: '2026-04-09T10:07:00.000Z',
            observedAtIso: '2026-04-09T10:07:00.000Z',
            error: null,
            funds: { balance: 900, available: 900, invested: 0 },
          },
        ],
        futuresItems: [
          {
            accountId: 'futures-1',
            accountName: 'Delta Futures',
            accountKey: '',
            brokerKey: 'delta_exchange',
            status: 'connected',
            observedAt: '2026-04-09T10:08:00.000Z',
            observedAtIso: '2026-04-09T10:08:00.000Z',
            error: null,
            funds: { balance: 100, available: 60, invested: 40 },
          },
        ],
        walletTotal: 900,
        futuresTotal: 100,
        totalVisibleCapital: 1000,
        walletSharePct: 90,
        futuresSharePct: 10,
        driftPct: 80,
      });
    },
    async getActivityOverview() {
      return createSuccess({
        source: 'scheduler_positions_snapshots',
        definition:
          'Portfolio activity combines realized PnL windows and performance buckets from scheduler position snapshots.',
        freshnessModel: 'windowed_activity',
        observedAt: '2026-04-09T10:06:00.000Z',
        observedAtIso: '2026-04-09T10:06:00.000Z',
        pnl: {
          dailyPnL: 0,
          weeklyPnL: 0,
          monthlyPnL: 0,
          source: 'scheduler_positions_snapshots',
          measurement: 'realized_pnl',
          freshnessModel: 'windowed_activity',
          observedAt: '2026-04-09T10:06:00.000Z',
          observedAtIso: '2026-04-09T10:06:00.000Z',
          definition:
            'Realized PnL aggregated from closed-position scheduler snapshots across active accounts.',
          windows: {
            timezone: 'Asia/Kolkata',
            daily: 'Today (Asia/Kolkata)',
            weekly: 'Trailing 7 days (Asia/Kolkata)',
            monthly: 'Trailing 30 days (Asia/Kolkata)',
          },
        },
        performance: {
          timeframe: 'daily',
          points: [],
          summary: {
            totalEquity: 18000,
            totalPnl: 0,
            totalProfit: 0,
            totalLoss: 0,
            totalTrades: 0,
            brokers: {},
          },
          observedAt: '2026-04-09T10:06:00.000Z',
          observedAtIso: '2026-04-09T10:06:00.000Z',
          definition:
            'Closed-position activity aggregated from scheduler snapshots for the selected portfolio timeframe.',
          windowLabel: 'Today (Asia/Kolkata)',
        },
      });
    },
  };

  const response = await service.getOverview('user-1', {
    timeframe: 'daily',
    holdingsLimit: '100',
    snapshotsLimit: '20',
    snapshotsOffset: '0',
  });

  assert.equal(response.data.meta.contractVersion, 'portfolio-overview-phase7-futures-2026-04-14');
  assert.equal(response.data.meta.capabilities.shareableWorkspaceState, true);
  assert.equal(response.data.meta.capabilities.rebalanceReviewWorkflow, true);
  assert.equal(response.data.meta.capabilities.workspaceReportGeneration, true);
  assert.equal(response.data.meta.capabilities.liveSnapshotReconciliationPolicy, true);
  assert.equal(response.data.meta.capabilities.exportReport, true);
  assert.equal(response.data.meta.capabilities.futuresOverview, true);
  assert.equal(response.data.meta.capabilities.legacyFieldsAreCompatibilityAliases, true);
  assert.equal(response.data.meta.reconciliationPolicy.mode, 'manual_workspace_review');
  assert.deepEqual(response.data.time, buildApiTimeContract(timeZone));
  assert.deepEqual(response.data.meta.time, buildApiTimeContract(timeZone));
  assert.equal(
    response.data.meta.generatedAtIso ? Boolean(response.data.meta.generatedAt) : false,
    true
  );
  assert.equal(
    response.data.activeFunds.latestObservedAt,
    formatApiDisplayTime('2026-04-09T10:08:00.000Z', timeZone)
  );
  assert.equal(response.data.activeFunds.latestObservedAtIso, '2026-04-09T10:08:00.000Z');
  assert.equal(
    response.data.meta.sections.summary.observedAt,
    formatApiDisplayTime('2026-04-09T10:07:00.000Z', timeZone)
  );
  assert.equal(response.data.meta.sections.summary.observedAtIso, '2026-04-09T10:07:00.000Z');
  assert.match(
    response.data.meta.summary,
    /futures-first/i
  );
}

async function main(): Promise<void> {
  await runWorkspaceReviewAssertions();
  await runWorkspaceReportAssertions();
  await runOverviewCapabilityAssertions();
  console.log('Portfolio Phase 6 assertions passed.');
}

  await main();
}

async function portfolioGuard07(): Promise<void> {
  const { spawn } = await import("node:child_process");
  const { mkdtemp, readFile, writeFile } = await import("node:fs/promises");
  const { default: os } = await import("node:os");
  const { default: path } = await import("node:path");
  const { assertPortfolioHealthSnapshot, buildPortfolioHealthSnapshot, } = await import("./checks/check-portfolio-health");

async function runCommand(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv
): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env,
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', (code) => resolve(code));
  });
}

async function runHealthAssertionChecks(): Promise<void> {
  const snapshot = buildPortfolioHealthSnapshot({
    baseUrl: 'http://127.0.0.1:3000/api/v1',
    overviewDurationMs: 1200,
    performanceDurationMs: 800,
    overviewPayload: {
      data: {
        meta: {
          contractVersion: 'portfolio-overview-phase7-futures-2026-04-14',
          purpose: 'operator_portfolio_workspace',
          pageHydration: 'single-request',
          capabilities: {
            indexedSnapshotReads: false,
            activityReadModelAcceleration: true,
            portfolioHealthChecks: true,
            shareableWorkspaceState: true,
            rebalanceReviewWorkflow: true,
            workspaceReportGeneration: true,
            liveSnapshotReconciliationPolicy: true,
            exportReport: true,
            futuresOverview: true,
            positionsIncludedInOverview: true,
            legacyFieldsAreCompatibilityAliases: true,
          },
          reconciliationPolicy: {
            mode: 'manual_workspace_review',
          },
          warnings: [],
        },
        futuresSummary: {
          source: 'funds_snapshots_plus_position_read_models',
        },
        positions: {
          source: 'position_read_models',
          total: 2,
        },
        capital: {
          source: 'funds_snapshots via broker_wallet_facade',
          walletItems: [{ accountId: 'wallet-1' }],
          futuresItems: [{ accountId: 'futures-1' }],
        },
        activity: {
          source: 'scheduler_positions_snapshots',
        },
      },
    },
    performancePayload: {
      data: {
        source: 'scheduler_positions_snapshots',
        points: [{ date: '2026-04-10', pnl: 12 }],
        summary: {
          totalTrades: 3,
        },
      },
    },
  });

  assert.equal(snapshot.shareableWorkspaceState, true);
  assert.equal(snapshot.rebalanceReviewWorkflow, true);
  assert.equal(snapshot.workspaceReportGeneration, true);
  assert.equal(snapshot.liveSnapshotReconciliationPolicy, true);
  assert.equal(snapshot.exportReport, true);
  assert.equal(snapshot.reconciliationMode, 'manual_workspace_review');
  assert.equal(snapshot.futuresOverview, true);
  assert.equal(snapshot.positionsIncludedInOverview, true);
  assert.equal(snapshot.legacyFieldsAreCompatibilityAliases, true);

  assertPortfolioHealthSnapshot(snapshot, {
    maxOverviewMs: 1500,
    maxPerformanceMs: 1000,
  });
}

async function runSignoffChecks(): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'portfolio-phase7-'));
  const gateFile = path.join(tempDir, 'portfolio-release-gate.json');
  const outputFile = path.join(tempDir, 'portfolio-signoff.json');

  const gateSummary = {
    decision: 'ready',
    startedAt: '2026-04-10T12:00:00.000Z',
    finishedAt: '2026-04-10T12:05:00.000Z',
    liveChecksEnabled: false,
    totals: {
      total: 5,
      passed: 5,
      failed: 0,
      skipped: 0,
    },
    results: [
      'backend-portfolio-suite',
      'backend-portfolio-eslint',
      'frontend-portfolio-eslint',
      'frontend-portfolio-ui',
      'frontend-portfolio-build',
    ].map((key) => ({
      key,
      label: key,
      status: 'passed',
    })),
  };

  await writeFile(gateFile, `${JSON.stringify(gateSummary, null, 2)}\n`, 'utf8');

  const exitCode = await runCommand(process.execPath, ['--import', 'tsx', 'scripts/signoffs/signoff-portfolio.ts'], {
    ...process.env,
    PORTFOLIO_SIGNOFF_GATE_FILE: gateFile,
    PORTFOLIO_SIGNOFF_OUTPUT_FILE: outputFile,
    PORTFOLIO_SIGNOFF_MANUAL_REVIEW_WORKFLOW_VERIFIED: 'true',
    PORTFOLIO_SIGNOFF_REPORT_EXPORT_VERIFIED: 'true',
    PORTFOLIO_SIGNOFF_SHAREABLE_WORKSPACE_VERIFIED: 'true',
    PORTFOLIO_SIGNOFF_RECONCILIATION_RUNBOOK_VERIFIED: 'true',
    PORTFOLIO_SIGNOFF_APPROVER: 'codex-test',
  });

  assert.equal(exitCode, 0, 'portfolio signoff script should succeed against a ready gate');

  const rawOutput = await readFile(outputFile, 'utf8');
  const summary = JSON.parse(rawOutput) as {
    decision: string;
    approver: string;
    checks: Record<string, boolean>;
  };

  assert.equal(summary.decision, 'ready');
  assert.equal(summary.approver, 'codex-test');
  assert.equal(summary.checks.manualReviewWorkflowVerified, true);
  assert.equal(summary.checks.reportExportVerified, true);
  assert.equal(summary.checks.shareableWorkspaceVerified, true);
  assert.equal(summary.checks.reconciliationRunbookVerified, true);
}

async function main(): Promise<void> {
  await runHealthAssertionChecks();
  await runSignoffChecks();
  console.log('Portfolio Phase 7 assertions passed.');
}

  await main();
}

async function portfolioGuard08(): Promise<void> {
  const { spawn } = await import("node:child_process");
  const { mkdtemp, readFile, writeFile } = await import("node:fs/promises");
  const { default: os } = await import("node:os");
  const { default: path } = await import("node:path");

type JsonRecord = Record<string, unknown>;

async function runCommand(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv
): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env,
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', (code) => resolve(code));
  });
}

async function runPortfolioLiveProofAssertions(): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'portfolio-phase8-'));
  const gateFile = path.join(tempDir, 'portfolio-release-gate.json');
  const signoffFile = path.join(tempDir, 'portfolio-signoff.json');
  const proofFile = path.join(tempDir, 'portfolio-live-proof.json');
  const gateScript = path.join(tempDir, 'release-gate.stub.ts');
  const signoffScript = path.join(tempDir, 'signoff.stub.ts');

  const readyGateSummary = {
    decision: 'ready',
    generatedAt: '2026-04-10T12:00:00.000Z',
    liveChecksEnabled: true,
    totals: {
      total: 6,
      passed: 6,
      failed: 0,
      skipped: 0,
    },
    results: [
      'backend-portfolio-suite',
      'backend-portfolio-eslint',
      'frontend-portfolio-eslint',
      'frontend-portfolio-ui',
      'frontend-portfolio-build',
      'backend-portfolio-live-health',
    ].map((key) => ({
      key,
      label: key,
      status: 'passed',
    })),
  };

  const readySignoffSummary = {
    decision: 'ready',
    generatedAt: '2026-04-10T12:05:00.000Z',
    approver: 'codex-phase8',
    checks: {
      gateReady: true,
      requiredSuitesPassed: true,
      liveHealthReviewed: true,
      manualReviewWorkflowVerified: true,
      reportExportVerified: true,
      shareableWorkspaceVerified: true,
      reconciliationRunbookVerified: true,
    },
    evidence: {
      stagingWorkflowUrl: 'https://example.com/staging/portfolio',
      dashboardUrl: 'https://example.com/dashboard/portfolio',
      runbookUrl: 'https://example.com/runbooks/portfolio',
      releaseNoteUrl: 'https://example.com/releases/portfolio',
    },
  };

  await writeFile(
    gateScript,
    `import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const outputFile = path.resolve(process.cwd(), String(process.env.PORTFOLIO_RELEASE_GATE_OUTPUT_FILE || '').trim());

async function run(): Promise<void> {
  assert.equal(process.env.PORTFOLIO_RUN_LIVE_CHECKS, 'true');
  assert.ok(outputFile, 'PORTFOLIO_RELEASE_GATE_OUTPUT_FILE must be provided');
  await mkdir(path.dirname(outputFile), { recursive: true });
  const summary = ${JSON.stringify(readyGateSummary, null, 2)};
  await writeFile(outputFile, \`\${JSON.stringify(summary, null, 2)}\\n\`, 'utf8');
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
`,
    'utf8'
  );

  await writeFile(
    signoffScript,
    `import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const gateFile = path.resolve(process.cwd(), String(process.env.PORTFOLIO_SIGNOFF_GATE_FILE || '').trim());
const outputFile = path.resolve(process.cwd(), String(process.env.PORTFOLIO_SIGNOFF_OUTPUT_FILE || '').trim());

async function run(): Promise<void> {
  assert.equal(process.env.PORTFOLIO_SIGNOFF_REQUIRE_LIVE_HEALTH, 'true');
  const rawGate = await readFile(gateFile, 'utf8');
  const gate = JSON.parse(rawGate) as { decision?: string; liveChecksEnabled?: boolean };
  assert.equal(gate.decision, 'ready');
  assert.equal(gate.liveChecksEnabled, true);
  await mkdir(path.dirname(outputFile), { recursive: true });
  const summary = ${JSON.stringify(readySignoffSummary, null, 2)};
  await writeFile(outputFile, \`\${JSON.stringify(summary, null, 2)}\\n\`, 'utf8');
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
`,
    'utf8'
  );

  const exitCode = await runCommand(
    process.execPath,
    ['--import', 'tsx', 'scripts/proofs/proof-portfolio-live.ts'],
    {
      ...process.env,
      PORTFOLIO_PROOF_RELEASE_GATE_SCRIPT: gateScript,
      PORTFOLIO_PROOF_SIGNOFF_SCRIPT: signoffScript,
      PORTFOLIO_RELEASE_GATE_OUTPUT_FILE: gateFile,
      PORTFOLIO_SIGNOFF_OUTPUT_FILE: signoffFile,
      PORTFOLIO_PROOF_OUTPUT_FILE: proofFile,
      PORTFOLIO_SIGNOFF_APPROVER: 'codex-phase8',
      PORTFOLIO_SIGNOFF_MANUAL_REVIEW_WORKFLOW_VERIFIED: 'true',
      PORTFOLIO_SIGNOFF_REPORT_EXPORT_VERIFIED: 'true',
      PORTFOLIO_SIGNOFF_SHAREABLE_WORKSPACE_VERIFIED: 'true',
      PORTFOLIO_SIGNOFF_RECONCILIATION_RUNBOOK_VERIFIED: 'true',
    }
  );

  assert.equal(exitCode, 0, 'portfolio live proof should succeed against ready stub scripts');

  const rawProof = await readFile(proofFile, 'utf8');
  const summary = JSON.parse(rawProof) as JsonRecord;

  assert.equal(summary.decision, 'ready');
  assert.equal(summary.approver, 'codex-phase8');
  assert.equal(summary.gateDecision, 'ready');
  assert.equal(summary.signoffDecision, 'ready');
  assert.equal(summary.liveChecksEnabled, true);
  assert.equal(summary.releaseGateFile, path.resolve(process.cwd(), gateFile));
  assert.equal(summary.signoffFile, path.resolve(process.cwd(), signoffFile));
  assert.equal(summary.proofOutputFile, path.resolve(process.cwd(), proofFile));
  assert.deepEqual(summary.gateTotals, readyGateSummary.totals);

  const evidence = (summary.evidence || {}) as JsonRecord;
  assert.equal(evidence.runbookUrl, readySignoffSummary.evidence.runbookUrl);

  const checks = (summary.checks || {}) as JsonRecord;
  assert.equal(checks.liveHealthReviewed, true);
  assert.equal(checks.shareableWorkspaceVerified, true);
}

async function runSourceMarkerAssertions(): Promise<void> {
  const releaseGateSource = await readFile(
    path.join(process.cwd(), 'scripts', 'release-gates', 'release-gate-portfolio.ts'),
    'utf8'
  );
  const signoffSource = await readFile(
    path.join(process.cwd(), 'scripts', 'signoffs', 'signoff-portfolio.ts'),
    'utf8'
  );

  assert.equal(
    releaseGateSource.includes('backend-portfolio-suite'),
    true,
    'release gate must include the portfolio module suite'
  );
  assert.equal(
    signoffSource.includes('backend-portfolio-suite'),
    true,
    'portfolio signoff must require the portfolio module gate result'
  );
}

async function main(): Promise<void> {
  await runPortfolioLiveProofAssertions();
  await runSourceMarkerAssertions();
  console.log('Portfolio Phase 8 assertions passed.');
}

  await main();
}

async function portfolioGuard09(): Promise<void> {
  const { PortfolioService } = await import("../src/api/services/PortfolioService");

function createSuccess<T>(data: T) {
  return { success: true as const, data };
}

function createService() {
  const service = new PortfolioService() as any;

  service.appSettingsRepository = {
    async getSettings() {
      return {
        timezone: 'Asia/Kolkata',
      };
    },
  };

  service.brokerAccountRepository = {
    async getConnectedBrokerAccounts(_userId: string, brokerKey?: string) {
      const accounts = [
        {
          id: 'acct-1',
          accountName: 'Delta Prime',
          accountKey: 'delta-prime',
          brokerKey: 'delta_exchange',
          status: 'connected',
        },
        {
          id: 'acct-2',
          accountName: 'Mudrex Desk',
          accountKey: 'mudrex-desk',
          brokerKey: 'mudrex',
          status: 'connected',
        },
      ];

      return brokerKey
        ? accounts.filter((account) => account.brokerKey === brokerKey)
        : accounts;
    },
  };

  service.brokerWalletFacadeService = {
    async getWalletFundsForActiveAccounts() {
      return {
        items: [
          {
            accountId: 'acct-1',
            accountName: 'Delta Prime',
            accountKey: 'delta-prime',
            brokerKey: 'delta_exchange',
            status: 'connected',
            observedAt: '2026-04-14T03:00:00.000Z',
            funds: {
              total: 200,
              withdrawable: 120,
              invested: 15,
            },
          },
          {
            accountId: 'acct-2',
            accountName: 'Mudrex Desk',
            accountKey: 'mudrex-desk',
            brokerKey: 'mudrex',
            status: 'connected',
            observedAt: '2026-04-14T03:02:00.000Z',
            funds: {
              total: 100,
              withdrawable: 60,
              invested: 5,
            },
          },
        ],
      };
    },
    async getFuturesFundsForActiveAccounts() {
      return {
        items: [
          {
            accountId: 'acct-1',
            accountName: 'Delta Prime',
            accountKey: 'delta-prime',
            brokerKey: 'delta_exchange',
            status: 'connected',
            observedAt: '2026-04-14T03:03:00.000Z',
            funds: {
              balance: 1000,
              available_balance: 700,
              used_margin: 300,
            },
          },
          {
            accountId: 'acct-2',
            accountName: 'Mudrex Desk',
            accountKey: 'mudrex-desk',
            brokerKey: 'mudrex',
            status: 'connected',
            observedAt: '2026-04-14T03:04:00.000Z',
            funds: {
              balance: 500,
              available_balance: 250,
              used_margin: 120,
            },
          },
        ],
      };
    },
  };

  service.positionReadModelRepository = {
    async ensureHydratedFromSnapshots() {
      return;
    },
    async getOpenPositionSummaryForAccounts() {
      return new Map([
        [
          'acct-1',
          {
            accountId: 'acct-1',
            openPositions: 1,
            grossExposure: 1200,
            longExposure: 1200,
            shortExposure: 0,
            unrealizedPnl: 80,
            latestObservedAt: new Date('2026-04-14T03:05:00.000Z'),
            oldestObservedAt: new Date('2026-04-14T03:05:00.000Z'),
          },
        ],
        [
          'acct-2',
          {
            accountId: 'acct-2',
            openPositions: 1,
            grossExposure: 400,
            longExposure: 0,
            shortExposure: 400,
            unrealizedPnl: -20,
            latestObservedAt: new Date('2026-04-14T03:06:00.000Z'),
            oldestObservedAt: new Date('2026-04-14T03:01:00.000Z'),
          },
        ],
      ]);
    },
    async listLivePositionsOverview() {
      return {
        items: [
          {
            id: 'pos-1',
            accountId: 'acct-1',
            brokerKey: 'delta_exchange',
            last_seen_at: '2026-04-14T03:05:00.000Z',
            positionSummary: {
              id: 'pos-1',
              externalId: 'ext-1',
              symbol: 'BTCUSDT',
              side: 'Long',
              sideKey: 'long',
              status: 'Open',
              statusKey: 'open',
              quantity: 0.25,
              entryPrice: 60000,
              currentPrice: 60400,
              closedPrice: null,
              unrealizedPnl: 100,
              realizedPnl: null,
              leverage: 5,
              liquidationPrice: 52000,
              exposure: 15000,
              createdAt: '2026-04-14T01:00:00.000Z',
              updatedAt: '2026-04-14T03:05:00.000Z',
              closedAt: undefined,
            },
          },
        ],
        total: 1,
        latestObservedAt: new Date('2026-04-14T03:05:00.000Z'),
        oldestObservedAt: new Date('2026-04-14T03:05:00.000Z'),
      };
    },
    async getAccountFreshness() {
      return new Map([
        [
          'acct-1',
          {
            accountId: 'acct-1',
            observedAt: new Date('2026-04-14T03:05:00.000Z'),
          },
        ],
      ]);
    },
  };

  return service;
}

async function runCapitalOverviewAssertions(): Promise<void> {
  const service = createService();
  const response = await service.getCapitalOverview('user-1');

  assert.equal(response.data.source, 'funds_snapshots via broker_wallet_facade');
  assert.equal(response.data.walletTotal, 300);
  assert.equal(response.data.futuresTotal, 1500);
  assert.equal(response.data.totalVisibleCapital, 1800);
  assert.equal(response.data.walletItems[0]?.funds.available, 120);
  assert.equal(response.data.futuresItems[1]?.funds.invested, 120);
  assert.equal(response.data.latestObservedAtIso, '2026-04-14T03:04:00.000Z');
  assert.equal(response.data.oldestObservedAtIso, '2026-04-14T03:00:00.000Z');
}

async function runFuturesSummaryAssertions(): Promise<void> {
  const service = createService();
  const response = await service.getFuturesSummary('user-1');

  assert.equal(response.data.source, 'funds_snapshots_plus_position_read_models');
  assert.equal(response.data.futuresEquity, 1500);
  assert.equal(response.data.availableCollateral, 950);
  assert.equal(response.data.usedMargin, 420);
  assert.equal(response.data.walletCollateral, 300);
  assert.equal(response.data.openPositions, 2);
  assert.equal(response.data.grossExposure, 1600);
  assert.equal(response.data.longExposure, 1200);
  assert.equal(response.data.shortExposure, 400);
  assert.equal(response.data.unrealizedPnl, 60);
  assert.equal(response.data.positionsObservedAtIso, '2026-04-14T03:06:00.000Z');
}

async function runOpenPositionsOverviewAssertions(): Promise<void> {
  const service = createService();
  const response = await service.getOpenPositionsOverview('user-1', {
    limit: '20',
    offset: '0',
    symbol: 'BTCUSDT',
  });

  assert.equal(response.data.source, 'position_read_models');
  assert.equal(response.data.total, 1);
  assert.equal(response.data.limit, 20);
  assert.equal(response.data.items[0]?.accountName, 'Delta Prime');
  assert.equal(response.data.items[0]?.brokerKey, 'delta_exchange');
  assert.equal(response.data.items[0]?.symbol, 'BTCUSDT');
  assert.equal(response.data.items[0]?.freshness?.state, 'fresh');
  assert.equal(response.data.latestObservedAtIso, '2026-04-14T03:05:00.000Z');
}

async function runActivityOverviewAssertions(): Promise<void> {
  const service = createService();
  service.getPortfolioPnL = async () =>
    createSuccess({
      observedAtIso: '2026-04-14T03:07:00.000Z',
      dailyPnL: 12,
      weeklyPnL: 40,
      monthlyPnL: 80,
      source: 'scheduler_positions_snapshots',
      measurement: 'realized_pnl',
      freshnessModel: 'windowed_activity',
      definition: 'PnL',
      windows: {
        timezone: 'Asia/Kolkata',
        daily: 'Today (Asia/Kolkata)',
        weekly: 'Trailing 7 days (Asia/Kolkata)',
        monthly: 'Trailing 30 days (Asia/Kolkata)',
      },
      connections: [],
    });
  service.getPortfolioPerformance = async () =>
    createSuccess({
      observedAtIso: '2026-04-14T03:09:00.000Z',
      timeframe: 'daily',
      mode: 'closed-position-activity',
      source: 'scheduler_positions_snapshots',
      measurement: 'realized_pnl',
      freshnessModel: 'windowed_activity',
      definition: 'Performance',
      windowLabel: 'Today (Asia/Kolkata)',
      bucketLabel: 'hour',
      points: [],
      summary: {
        totalEquity: 1000,
        totalPnl: 12,
        totalProfit: 18,
        totalLoss: 6,
        totalTrades: 3,
        brokers: {},
      },
    });

  const response = await service.getActivityOverview('user-1', 'daily');
  assert.equal(response.data.source, 'scheduler_positions_snapshots');
  assert.equal(response.data.observedAtIso, '2026-04-14T03:09:00.000Z');
  assert.equal(response.data.pnl.dailyPnL, 12);
  assert.equal(response.data.performance.summary.totalTrades, 3);
}

async function main(): Promise<void> {
  await runCapitalOverviewAssertions();
  await runFuturesSummaryAssertions();
  await runOpenPositionsOverviewAssertions();
  await runActivityOverviewAssertions();
  console.log('Portfolio Phase 9 assertions passed.');
}

  await main();
}

const suiteSteps = {
  "01": portfolioGuard01,
  "02": portfolioGuard02,
  "03": portfolioGuard03,
  "04": portfolioGuard04,
  "05": portfolioGuard05,
  "06": portfolioGuard06,
  "07": portfolioGuard07,
  "08": portfolioGuard08,
  "09": portfolioGuard09,
} as const;

export async function runPortfolioSuite(): Promise<void> {
  await runSuiteSteps("Portfolio module", "scripts/test-portfolio.ts", ["01", "02", "03", "04", "05", "06", "07", "08", "09"]);
  console.log("Portfolio module assertions passed.");
}

async function runRequestedStep(): Promise<void> {
  const requestedStep = process.argv[3];
  if (!requestedStep) {
    return;
  }
  const step = suiteSteps[requestedStep as keyof typeof suiteSteps];
  if (!step) {
    throw new Error(`Unknown suite step: ${requestedStep}`);
  }
  await step();
}

if (process.argv[3]) {
  runRequestedStep().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : error);
    process.exit(1);
  });
}
