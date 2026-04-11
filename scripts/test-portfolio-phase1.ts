import assert from 'node:assert/strict';

import { PortfolioService } from '../src/api/services/PortfolioService';

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

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
