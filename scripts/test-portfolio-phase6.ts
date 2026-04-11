import assert from 'node:assert/strict';

import { PortfolioOverviewService } from '../src/api/services/PortfolioOverviewService';
import { PortfolioService } from '../src/api/services/PortfolioService';
import { PortfolioTimeframe } from '../src/api/validators/portfolio.validator';
import {
  buildApiTimeContract,
  formatApiDisplayTime,
} from '../src/api/utils/apiTimeContract';

function createSuccess<T>(data: T) {
  return { success: true as const, data };
}

function createWorkspaceReviewStubs(service: PortfolioService & Record<string, unknown>) {
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
    const resolvedTimeframe: PortfolioTimeframe =
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
  const service = new PortfolioService() as PortfolioService & Record<string, unknown>;
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
  assert.ok(review.highlights.some((item) => item.label === 'Selected holding'));
  assert.ok(review.actions.some((item) => item.code === 'review_watchlist'));
  assert.ok(review.actions.some((item) => item.code === 'align_capital_routes'));
  assert.ok(review.actions.some((item) => item.code === 'review_recent_activity'));
  assert.equal(activityLogCalls.length, 1);
  assert.equal(activityLogCalls[0]?.userId, 'user-1');
}

async function runWorkspaceReportAssertions(): Promise<void> {
  const service = new PortfolioService() as PortfolioService & Record<string, unknown>;
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
  const service = new PortfolioOverviewService() as PortfolioOverviewService & Record<string, unknown>;
  const timeZone = 'Asia/Calcutta';

  (service as any).userTimeZoneService = {
    async resolveUserTimeZone() {
      return timeZone;
    },
  };

  (service as any).portfolioService = {
    async getPortfolioPnL() {
      return createSuccess({
        dailyPnL: 0,
        weeklyPnL: 0,
        monthlyPnL: 0,
        source: 'scheduler_positions_snapshots',
        measurement: 'realized_pnl',
        freshnessModel: 'windowed_activity',
        observedAt: '2026-04-09T10:06:00.000Z',
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
        definition:
          'Closed-position activity aggregated from scheduler snapshots for the selected portfolio timeframe.',
        windowLabel: 'Today (Asia/Kolkata)',
      });
    },
    async getPortfolioSummary() {
      return createSuccess({
        equity: 18000,
        dayPnL: 250,
        netExposure: '42%',
        diversification: 'Balanced',
        observedAt: '2026-04-09T10:05:00.000Z',
        definition: 'Latest stored portfolio snapshot summary.',
      });
    },
    async getPortfolioHoldings() {
      return createSuccess({
        source: 'portfolio_snapshots',
        observedAt: '2026-04-09T10:05:00.000Z',
        definition:
          'Largest holdings ordered by market value from the latest stored portfolio snapshot.',
        items: [],
        total: 0,
        limit: 100,
        offset: 0,
      });
    },
    async getPortfolioSnapshots() {
      return createSuccess({
        source: 'portfolio_snapshots',
        observedAt: '2026-04-09T10:05:00.000Z',
        definition: 'Stored portfolio snapshot history ordered from newest to oldest capture.',
        items: [],
        total: 0,
        limit: 20,
        offset: 0,
      });
    },
  };

  (service as any).brokerWalletFacadeService = {
    async getWalletFundsForActiveAccounts() {
      return {
        items: [
          {
            accountId: 'wallet-1',
            brokerKey: 'mudrex',
            observedAt: '2026-04-09T10:07:00.000Z',
            error: null,
            funds: { balance: 900 },
          },
        ],
      };
    },
    async getFuturesFundsForActiveAccounts() {
      return {
        items: [
          {
            accountId: 'futures-1',
            brokerKey: 'delta_exchange',
            observedAt: '2026-04-09T10:08:00.000Z',
            error: null,
            funds: { balance: 100 },
          },
        ],
      };
    },
  };

  const response = await service.getOverview('user-1', {
    timeframe: 'daily',
    holdingsLimit: '100',
    snapshotsLimit: '20',
    snapshotsOffset: '0',
  });

  assert.equal(response.data.meta.contractVersion, 'portfolio-overview-phase6-2026-04-10');
  assert.equal(response.data.meta.capabilities.shareableWorkspaceState, true);
  assert.equal(response.data.meta.capabilities.rebalanceReviewWorkflow, true);
  assert.equal(response.data.meta.capabilities.workspaceReportGeneration, true);
  assert.equal(response.data.meta.capabilities.liveSnapshotReconciliationPolicy, true);
  assert.equal(response.data.meta.capabilities.exportReport, true);
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
    formatApiDisplayTime('2026-04-09T10:05:00.000Z', timeZone)
  );
  assert.equal(response.data.meta.sections.summary.observedAtIso, '2026-04-09T10:05:00.000Z');
  assert.match(
    response.data.meta.summary,
    /manual reconciliation\/reporting workflow/i
  );
}

async function main(): Promise<void> {
  await runWorkspaceReviewAssertions();
  await runWorkspaceReportAssertions();
  await runOverviewCapabilityAssertions();
  console.log('Portfolio Phase 6 assertions passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
