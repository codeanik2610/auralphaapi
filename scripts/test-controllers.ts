import assert from 'node:assert/strict';

import { ActivityController } from '../src/api/controllers/ActivityController';
import { AutomationsController } from '../src/api/controllers/AutomationsController';
import { AlertsController } from '../src/api/controllers/AlertsController';
import { AssetPriceSchedulerController } from '../src/api/controllers/AssetPriceSchedulerController';
import { BacktestsController } from '../src/api/controllers/BacktestsController';
import { BinanceAssetsSchedulerController } from '../src/api/controllers/BinanceAssetsSchedulerController';
import { BrokerDefinitionsController } from '../src/api/controllers/BrokerDefinitionsController';
import { CandlesSchedulerController } from '../src/api/controllers/CandlesSchedulerController';
import { ConnectionsController } from '../src/api/controllers/ConnectionsController';
import { DiscoveryController } from '../src/api/controllers/DiscoveryController';
import { EmailDeliveriesController } from '../src/api/controllers/EmailDeliveriesController';
import { FundsSchedulerController } from '../src/api/controllers/FundsSchedulerController';
import { HealthController } from '../src/api/controllers/HealthController';
import { HealthCheckSchedulerController } from '../src/api/controllers/HealthCheckSchedulerController';
import { InternalFundsSchedulerController } from '../src/api/controllers/InternalFundsSchedulerController';
import { InternalSignalsSchedulerController } from '../src/api/controllers/InternalSignalsSchedulerController';
import { MarketController } from '../src/api/controllers/MarketController';
import { OrdersController } from '../src/api/controllers/OrdersController';
import { OrdersOverviewController } from '../src/api/controllers/OrdersOverviewController';
import { OrdersSchedulerController } from '../src/api/controllers/OrdersSchedulerController';
import { PortfolioController } from '../src/api/controllers/PortfolioController';
import { PositionsController } from '../src/api/controllers/PositionsController';
import { PositionsSchedulerController } from '../src/api/controllers/PositionsSchedulerController';
import { RiskController } from '../src/api/controllers/RiskController';
import { RiskSchedulerController } from '../src/api/controllers/RiskSchedulerController';
import { SchedulerController } from '../src/api/controllers/SchedulerController';
import { SchedulerOverviewController } from '../src/api/controllers/SchedulerOverviewController';
import { SignalsAutomationController } from '../src/api/controllers/SignalsAutomationController';
import { SignalsController } from '../src/api/controllers/SignalsController';
import { SignalsOverviewController } from '../src/api/controllers/SignalsOverviewController';
import { SettingsController } from '../src/api/controllers/SettingsController';
import { StrategyController } from '../src/api/controllers/StrategyController';
import { StrategyLabController } from '../src/api/controllers/StrategyLabController';
import { StrategyLibraryController } from '../src/api/controllers/StrategyLibraryController';
import { StrategyTemplatesController } from '../src/api/controllers/StrategyTemplatesController';
import { SuggestedTradesController } from '../src/api/controllers/SuggestedTradesController';
import { SuggestedTradesOverviewController } from '../src/api/controllers/SuggestedTradesOverviewController';
import { WatchlistsController } from '../src/api/controllers/WatchlistsController';
import { env } from '../src/env';
import { RedisClient } from '../src/lib/RedisClient';

function createSuccess<T>(data: T) {
  return { success: true as const, data };
}

const authReq = { authUser: { sub: 'user-1' } } as any;
const adminAuthReq = { authUser: { sub: 'user-1', role: 'admin' } } as any;
const apiKeyReq = { apiKeyAuthenticated: true } as any;
const unauthReq = {} as any;

async function assertAdminRoleRequired(
  run: () => Promise<unknown>,
  message = 'Admin role is required'
): Promise<void> {
  await assert.rejects(
    run,
    (error: unknown) =>
      error instanceof Error &&
      error.message === message &&
      (error as { httpCode?: number }).httpCode === 403
  );
}

async function assertAuthRequired(
  run: () => Promise<unknown>,
  message = 'Authentication required'
): Promise<void> {
  await assert.rejects(
    run,
    (error: unknown) =>
      error instanceof Error &&
      error.message === message &&
      (error as { httpCode?: number }).httpCode === 401
  );
}

async function assertBadRequest(run: () => Promise<unknown>, message: string): Promise<void> {
  await assert.rejects(
    run,
    (error: unknown) =>
      error instanceof Error &&
      error.message === message &&
      (error as { httpCode?: number }).httpCode === 400
  );
}

async function runSignalsControllerAssertions(): Promise<void> {
  const controller: any = new SignalsController();

  controller.signalsService = {
    getSignals: async (...args: unknown[]) => createSuccess({ args }),
    getSignalsSummary: async () => createSuccess({ ok: true }),
    getSignalById: async (...args: unknown[]) => createSuccess({ args }),
    acknowledgeSignal: async (...args: unknown[]) => createSuccess({ args }),
    muteSignal: async (...args: unknown[]) => createSuccess({ args }),
    promoteSignal: async (...args: unknown[]) => createSuccess({ args }),
  };

  assert.deepEqual(
    (
      await controller.getSignals(
        authReq,
        undefined,
        undefined,
        'Triggered',
        undefined,
        undefined,
        undefined,
        'BTC'
      )
    ).data.args,
    [
      'user-1',
      {
        limit: undefined,
        offset: undefined,
        status: 'Triggered',
        symbol: undefined,
        source: undefined,
        timeframe: undefined,
        search: 'BTC',
        view: undefined,
      },
    ]
  );
  assert.deepEqual((await controller.getSignalsSummary(authReq)).data, { ok: true });
  assert.deepEqual((await controller.getSignalById(authReq, 'sig-1')).data.args, [
    'user-1',
    'sig-1',
  ]);
  assert.deepEqual(
    (await controller.acknowledgeSignal(authReq, 'sig-1', { note: 'reviewed' })).data.args,
    ['user-1', 'sig-1', { note: 'reviewed' }]
  );
  assert.deepEqual((await controller.muteSignal(authReq, 'sig-2', { reason: 'noise' })).data.args, [
    'user-1',
    'sig-2',
    { reason: 'noise' },
  ]);
  assert.deepEqual(
    (await controller.promoteSignal(authReq, 'sig-3', { target: 'execution_queue' })).data.args,
    ['user-1', 'sig-3', { target: 'execution_queue' }]
  );
}

async function runSignalsOverviewControllerAssertions(): Promise<void> {
  const controller: any = new SignalsOverviewController();

  controller.signalsOverviewService = {
    getOverview: async (...args: unknown[]) => createSuccess({ args }),
  };

  assert.deepEqual(
    (
      await controller.getOverview(
        authReq,
        '25',
        '10',
        'Triggered',
        'BTCUSDT',
        'Momentum Engine',
        '1h',
        'breakout',
        'muted'
      )
    ).data.args,
    [
      'user-1',
      {
        limit: '25',
        offset: '10',
        status: 'Triggered',
        symbol: 'BTCUSDT',
        source: 'Momentum Engine',
        timeframe: '1h',
        search: 'breakout',
        view: 'muted',
      },
    ]
  );
}

async function runInternalSignalsSchedulerControllerAssertions(): Promise<void> {
  const controller: any = new InternalSignalsSchedulerController();
  const calls: unknown[][] = [];

  controller.signalScanService = {
    runSignalScan: async (...args: unknown[]) => {
      calls.push(args);
      return createSuccess({ args });
    },
  };

  await assertBadRequest(() => controller.scan({}), 'actorUserId is required');
  assert.equal(calls.length, 0, 'internal signals scan should reject missing actor user ids');

  const response = await controller.scan({
    actorUserId: 'user-1',
    includeStrategyLibrary: true,
    includeStrategyLab: false,
    maxSources: 5,
  });
  assert.deepEqual(response.data.args, [
    'user-1',
    {
      includeStrategyLibrary: true,
      includeStrategyLab: false,
      maxSources: 5,
    },
  ]);
  assert.equal(calls.length, 1, 'internal signals scan should pass the actor through');
}

async function runInternalFundsSchedulerControllerAssertions(): Promise<void> {
  const controller: any = new InternalFundsSchedulerController();
  const calls: unknown[][] = [];

  controller.fundsSchedulerService = {
    runSnapshotBatch: async (...args: unknown[]) => {
      calls.push(args);
      return {
        totalAccounts: 2,
        successCount: 1,
        insertedCount: 1,
        updatedCount: 0,
        failureCount: 1,
        failures: [],
      };
    },
  };

  const response = await controller.snapshot({
    targetUserIds: ['user-1'],
    brokerKeys: ['mudrex'],
    accountIds: ['account-1'],
    runLogId: '  run-1  ',
  });
  assert.deepEqual(response.data, {
    totalAccounts: 2,
    successCount: 1,
    insertedCount: 1,
    updatedCount: 0,
    failureCount: 1,
    failures: [],
  });
  assert.deepEqual(calls, [
    [
      {
        targetUserIds: ['user-1'],
        brokerKeys: ['mudrex'],
        accountIds: ['account-1'],
        runLogId: 'run-1',
      },
    ],
  ]);

  const fallbackResponse = await controller.snapshot({});
  assert.equal(fallbackResponse.data.totalAccounts, 2);
  assert.deepEqual(calls.at(-1), [
    {
      targetUserIds: [],
      brokerKeys: [],
      accountIds: [],
      runLogId: undefined,
    },
  ]);
}

async function runSuggestedTradesControllerAssertions(): Promise<void> {
  const controller: any = new SuggestedTradesController();
  const originalRolloutEnabled = env.suggestedTrades.rolloutEnabled;

  controller.suggestedTradesService = {
    getSuggestedTrades: async (...args: unknown[]) => createSuccess({ args }),
    getSuggestedTradesSummary: async (...args: unknown[]) => createSuccess({ args }),
    reconcileSuggestedTradesExecution: async (...args: unknown[]) => createSuccess({ args }),
    getSuggestedTradeById: async (...args: unknown[]) => createSuccess({ args }),
    reviewSuggestedTrade: async (...args: unknown[]) => createSuccess({ args }),
    acceptSuggestedTrade: async (...args: unknown[]) => createSuccess({ args }),
    dismissSuggestedTrade: async (...args: unknown[]) => createSuccess({ args }),
    linkSuggestedTradeOrder: async (...args: unknown[]) => createSuccess({ args }),
    reconcileSuggestedTradeExecution: async (...args: unknown[]) => createSuccess({ args }),
  };

  assert.deepEqual(
    (
      await controller.getSuggestedTrades(
        authReq,
        undefined,
        undefined,
        'Accepted',
        'working',
        'BTCUSDT',
        '1h',
        'auto-1',
        'run-1',
        'SELL',
        'breakout'
      )
    ).data.args,
    [
      'user-1',
      {
        limit: undefined,
        offset: undefined,
        status: 'Accepted',
        executionState: 'working',
        symbol: 'BTCUSDT',
        timeframe: '1h',
        automationId: 'auto-1',
        automationRunId: 'run-1',
        side: 'SELL',
        search: 'breakout',
      },
    ]
  );
  assert.deepEqual(
    (
      await controller.getSuggestedTradesSummary(
        authReq,
        'Accepted',
        'working',
        'BTCUSDT',
        '1h',
        'auto-1',
        'run-1',
        'SELL',
        'breakout'
      )
    ).data.args,
    [
      'user-1',
      {
        status: 'Accepted',
        executionState: 'working',
        symbol: 'BTCUSDT',
        timeframe: '1h',
        automationId: 'auto-1',
        automationRunId: 'run-1',
        side: 'SELL',
        search: 'breakout',
      },
    ]
  );
  assert.deepEqual(
    (
      await controller.reconcileSuggestedTradesExecution(authReq, {
        staleOnly: true,
        limit: 25,
        executionState: 'working',
      })
    ).data.args,
    [
      'user-1',
      {
        staleOnly: true,
        limit: 25,
        executionState: 'working',
      },
    ]
  );
  assert.deepEqual((await controller.getSuggestedTradeById(authReq, 'st-1')).data.args, [
    'user-1',
    'st-1',
  ]);
  assert.deepEqual(
    (await controller.reviewSuggestedTrade(authReq, 'st-1', { note: 'reviewed' })).data.args,
    ['user-1', 'st-1', { note: 'reviewed' }]
  );
  assert.deepEqual(
    (await controller.acceptSuggestedTrade(authReq, 'st-2', { note: 'accepted' })).data.args,
    ['user-1', 'st-2', { note: 'accepted' }]
  );
  assert.deepEqual(
    (await controller.dismissSuggestedTrade(authReq, 'st-3', { note: 'skip' })).data.args,
    ['user-1', 'st-3', { note: 'skip' }]
  );
  assert.deepEqual(
    (
      await controller.linkSuggestedTradeOrder(authReq, 'st-4', {
        executionMode: 'paper',
        paperOrderId: 'paper-1',
      })
    ).data.args,
    [
      'user-1',
      'st-4',
      {
        executionMode: 'paper',
        paperOrderId: 'paper-1',
      },
    ]
  );
  assert.deepEqual((await controller.reconcileSuggestedTradeExecution(authReq, 'st-4')).data.args, [
    'user-1',
    'st-4',
  ]);

  env.suggestedTrades.rolloutEnabled = false;
  await assert.rejects(
    () =>
      controller.reconcileSuggestedTradesExecution(authReq, {
        staleOnly: true,
      }),
    (error: unknown) =>
      error instanceof Error && error.message === 'Suggested trades rollout controls are disabled'
  );
  env.suggestedTrades.rolloutEnabled = originalRolloutEnabled;
}

async function runSuggestedTradesOverviewControllerAssertions(): Promise<void> {
  const controller: any = new SuggestedTradesOverviewController();
  const originalRolloutEnabled = env.suggestedTrades.rolloutEnabled;

  controller.suggestedTradesOverviewService = {
    getOverview: async (...args: unknown[]) => createSuccess({ args }),
  };

  assert.deepEqual(
    (
      await controller.getOverview(
        authReq,
        '25',
        '10',
        'Accepted',
        'working',
        'BTCUSDT',
        '1h',
        'auto-1',
        'run-1',
        'SELL',
        'breakout'
      )
    ).data.args,
    [
      'user-1',
      {
        limit: '25',
        offset: '10',
        status: 'Accepted',
        executionState: 'working',
        symbol: 'BTCUSDT',
        timeframe: '1h',
        automationId: 'auto-1',
        automationRunId: 'run-1',
        side: 'SELL',
        search: 'breakout',
      },
    ]
  );

  env.suggestedTrades.rolloutEnabled = false;
  await assert.rejects(
    () => controller.getOverview(authReq),
    (error: unknown) =>
      error instanceof Error && error.message === 'Suggested trades overview rollout is disabled'
  );
  env.suggestedTrades.rolloutEnabled = originalRolloutEnabled;
}

async function runAutomationsControllerAssertions(): Promise<void> {
  const controller: any = new AutomationsController();

  controller.automationsService = {
    getAutomations: async (...args: unknown[]) => createSuccess({ args }),
    getAutomationsSummary: async () => createSuccess({ ok: true }),
    getAutomationById: async (...args: unknown[]) => createSuccess({ args }),
    runAutomationNow: async (...args: unknown[]) => createSuccess({ args }),
    pauseAutomation: async (...args: unknown[]) => createSuccess({ args }),
    resumeAutomation: async (...args: unknown[]) => createSuccess({ args }),
    reconcileAutomationState: async (...args: unknown[]) => createSuccess({ args }),
  };

  assert.deepEqual(
    (await controller.getAutomations(authReq, undefined, undefined, 'Running', 'BTC')).data.args,
    ['user-1', { limit: undefined, offset: undefined, status: 'Running', search: 'BTC' }]
  );
  assert.deepEqual((await controller.getAutomationsSummary(authReq)).data, { ok: true });
  assert.deepEqual((await controller.getAutomationById(authReq, 'bot-1')).data.args, [
    'user-1',
    'bot-1',
  ]);
  assert.deepEqual((await controller.runAutomationNow(authReq, 'bot-1')).data.args, [
    'user-1',
    'bot-1',
  ]);
  assert.deepEqual(
    (await controller.pauseAutomation(authReq, 'bot-1', { reason: 'pause' })).data.args,
    ['user-1', 'bot-1', { reason: 'pause' }]
  );
  assert.deepEqual(
    (await controller.resumeAutomation(authReq, 'bot-2', { reason: 'resume' })).data.args,
    ['user-1', 'bot-2', { reason: 'resume' }]
  );
  assert.deepEqual(
    (await controller.reconcileAutomationState(authReq, 'bot-3', { reason: 'repair' })).data.args,
    ['user-1', 'bot-3', { reason: 'repair' }]
  );
}

async function runDiscoveryControllerAssertions(): Promise<void> {
  const controller: any = new DiscoveryController();

  controller.discoveryFeedService = {
    getFeed: async (...args: unknown[]) => ({ args }),
  };
  controller.discoverySummaryService = {
    getSummary: async (...args: unknown[]) => ({ args }),
  };

  const request = {
    ...authReq,
    headers: {
      authorization: 'Bearer discovery-token',
    },
  } as any;

  assert.deepEqual((await controller.getFeed(request, '25', 'bot-1')).data.args, [
    'Bearer discovery-token',
    { limit: '25', botId: 'bot-1' },
  ]);
  assert.deepEqual((await controller.getSummary(request)).data.args, ['Bearer discovery-token']);
}

async function runBacktestsControllerAssertions(): Promise<void> {
  const controller: any = new BacktestsController();

  controller.backtestsService = {
    getBacktests: async (...args: unknown[]) => createSuccess({ args }),
    getBacktestsSummary: async (...args: unknown[]) => createSuccess({ args }),
    getBacktestById: async (...args: unknown[]) => createSuccess({ args }),
    getBacktestInputSnapshot: async (...args: unknown[]) => createSuccess({ args }),
    getBacktestChart: async (...args: unknown[]) => createSuccess({ args }),
    createBacktest: async (...args: unknown[]) => createSuccess({ args }),
  };

  assert.deepEqual(
    (await controller.getBacktests(authReq, undefined, undefined, 'Stable', 'BTC')).data.args,
    ['user-1', { limit: undefined, offset: undefined, status: 'Stable', search: 'BTC' }]
  );
  assert.deepEqual((await controller.getBacktestsSummary(authReq)).data.args, ['user-1']);
  assert.deepEqual((await controller.getBacktestById(authReq, 'bt-1')).data.args, [
    'user-1',
    'bt-1',
  ]);
  assert.deepEqual((await controller.getBacktestInputSnapshot(authReq, 'bt-1')).data.args, [
    'user-1',
    'bt-1',
  ]);
  assert.deepEqual(
    (
      await controller.getBacktestChart(
        authReq,
        'bt-1',
        'BTCUSDT',
        '1h',
        '250',
        '90',
        '2026-04-04T00:00:00.000Z'
      )
    ).data.args,
    [
      'user-1',
      'bt-1',
      {
        symbol: 'BTCUSDT',
        interval: '1h',
        limit: '250',
        lookbackDays: '90',
        endTime: '2026-04-04T00:00:00.000Z',
      },
    ]
  );
  const body = { universe: 'Momentum', benchmark: 'BTCUSDT' };
  assert.deepEqual((await controller.createBacktest(authReq, body)).data.args, ['user-1', body]);
}

async function runOrdersControllerAssertions(): Promise<void> {
  const controller: any = new OrdersController();

  controller.ordersService = {
    getFuturesOrders: async (...args: unknown[]) => createSuccess({ args }),
    requestOrdersRefresh: async (...args: unknown[]) => createSuccess({ args }),
    getOrdersSyncStatus: async (...args: unknown[]) => createSuccess({ args }),
    createFuturesOrder: async (...args: unknown[]) => createSuccess({ args }),
    getFuturesOrder: async (...args: unknown[]) => createSuccess({ args }),
    getFuturesOrderHistory: async (...args: unknown[]) => createSuccess({ args }),
    cancelFuturesOrder: async (...args: unknown[]) => createSuccess({ args }),
  };

  assert.deepEqual(
    (await controller.getFuturesOrders(authReq, '5', undefined, undefined)).data.args,
    [
      'user-1',
      {
        limit: '5',
        brokerKey: undefined,
        accountId: undefined,
        startDate: undefined,
        endDate: undefined,
      },
    ]
  );
  assert.deepEqual(
    (
      await controller.requestFuturesOrdersRefresh(authReq, {
        brokerKey: 'mudrex',
        accountId: 'acc-1',
      })
    ).data.args,
    ['user-1', { brokerKey: 'mudrex', accountId: 'acc-1' }]
  );
  assert.deepEqual(
    (await controller.getFuturesOrdersSyncStatus(authReq, 'mudrex', 'acc-1')).data.args,
    ['user-1', { brokerKey: 'mudrex', accountId: 'acc-1' }]
  );
  assert.deepEqual(
    (
      await controller.createFuturesOrder(authReq, 'BTCUSDT', {
        leverage: 10,
      })
    ).data.args,
    ['user-1', 'BTCUSDT', { leverage: 10 }]
  );
  assert.deepEqual(
    (await controller.getFuturesOrder(authReq, 'ord-1', undefined, undefined)).data.args,
    ['user-1', 'ord-1', { brokerKey: undefined, accountId: undefined }]
  );
  assert.deepEqual(
    (await controller.getFuturesOrderHistory(authReq, '3', undefined, undefined)).data.args,
    [
      'user-1',
      {
        limit: '3',
        brokerKey: undefined,
        accountId: undefined,
        startDate: undefined,
        endDate: undefined,
      },
    ]
  );
  assert.deepEqual(
    (await controller.cancelFuturesOrder(authReq, 'ord-1', undefined, undefined)).data.args,
    ['user-1', 'ord-1', { brokerKey: undefined, accountId: undefined }]
  );
}

async function runOrdersOverviewControllerAssertions(): Promise<void> {
  const controller: any = new OrdersOverviewController();

  controller.ordersOverviewService = {
    getOverview: async (...args: unknown[]) => createSuccess({ args }),
  };

  assert.deepEqual(
    (await controller.getOverview(authReq, 'mudrex', 'acct-2', '2026-04-01', '2026-04-09')).data
      .args,
    [
      'user-1',
      {
        brokerKey: 'mudrex',
        accountId: 'acct-2',
        startDate: '2026-04-01',
        endDate: '2026-04-09',
      },
    ]
  );
}

async function runWatchlistsControllerAssertions(): Promise<void> {
  const controller: any = new WatchlistsController();

  controller.watchlistsService = {
    getWatchlists: async (...args: unknown[]) => createSuccess({ args }),
    getWatchlistsSummary: async (...args: unknown[]) => createSuccess({ args }),
    updateWatchlist: async (...args: unknown[]) => createSuccess({ args }),
    getWatchlistById: async (...args: unknown[]) => createSuccess({ args }),
    getWatchlistItems: async (...args: unknown[]) => createSuccess({ args }),
  };

  assert.deepEqual((await controller.getWatchlists(authReq)).data.args, ['user-1']);
  assert.deepEqual((await controller.getWatchlistsSummary(authReq)).data.args, ['user-1']);
  assert.deepEqual(
    (await controller.updateWatchlist(authReq, 'wl-1', { name: 'Priority majors' })).data.args,
    ['user-1', 'wl-1', { name: 'Priority majors' }]
  );
  assert.deepEqual((await controller.getWatchlistById(authReq, 'wl-1')).data.args, [
    'user-1',
    'wl-1',
  ]);
  assert.deepEqual(
    (await controller.getWatchlistItems(authReq, 'wl-1', '5', '10', 'btc')).data.args,
    ['user-1', 'wl-1', { limit: '5', offset: '10', search: 'btc' }]
  );
}

async function runMarketControllerAssertions(): Promise<void> {
  const controller: any = new MarketController();

  controller.marketService = {
    getCandles: async (...args: unknown[]) => createSuccess({ args }),
  };

  const body = { symbol: 'BTCUSDT', interval: '1h', limit: '50' };
  assert.deepEqual((await controller.getCandles(authReq, body)).data.args, ['user-1', body]);
}

async function runPortfolioControllerAssertions(): Promise<void> {
  const controller: any = new PortfolioController();

  controller.portfolioService = {
    getPortfolioHoldings: async (...args: unknown[]) => createSuccess({ args }),
    getPortfolioSummary: async (...args: unknown[]) => createSuccess({ args }),
    getPortfolioHoldingById: async (...args: unknown[]) => createSuccess({ args }),
    rebalancePortfolio: async (...args: unknown[]) => createSuccess({ args }),
  };

  assert.deepEqual(
    (await controller.getPortfolioHoldings(authReq, undefined, undefined, 'BTC', 'Core', 'Long'))
      .data.args,
    ['user-1', { limit: undefined, offset: undefined, search: 'BTC', sleeve: 'Core', side: 'Long' }]
  );
  assert.deepEqual((await controller.getPortfolioSummary(authReq)).data.args, ['user-1']);
  assert.deepEqual((await controller.getPortfolioHoldingById(authReq, 'hold-1')).data.args, [
    'user-1',
    'hold-1',
  ]);
  assert.deepEqual(
    (await controller.rebalancePortfolio(authReq, { note: 'rebalance' })).data.args,
    ['user-1', { note: 'rebalance' }]
  );
}

async function runStrategyLabControllerAssertions(): Promise<void> {
  const controller: any = new StrategyLabController();

  controller.strategyLabService = {
    saveStrategyLabDraft: async (...args: unknown[]) => createSuccess({ args }),
    getStrategyLabProjectById: async (...args: unknown[]) => createSuccess({ args }),
    updateStrategyLabProject: async (...args: unknown[]) => createSuccess({ args }),
    deleteStrategyLabProject: async (...args: unknown[]) => createSuccess({ args }),
    moveStrategyLabProjectToTemplate: async (...args: unknown[]) => createSuccess({ args }),
    validateStrategyLabProject: async (...args: unknown[]) => createSuccess({ args }),
    sendStrategyLabToBacktests: async (...args: unknown[]) => createSuccess({ args }),
  };

  const createBody = {
    name: 'Draft',
    market: 'crypto-futures',
    timeframe: '1h',
    objective: 'probability-alpha',
    universe: 'top-25-liquidity',
    authoringMode: 'no_code',
    codeTarget: null,
    visualDefinition: { identity: { name: 'Draft', objective: 'probability-alpha' } },
    codeDefinition: null,
    parameters: {},
    riskConfig: {},
  };
  assert.deepEqual((await controller.saveStrategyLabDraft(authReq, createBody)).data.args, [
    'user-1',
    createBody,
  ]);
  assert.deepEqual((await controller.getStrategyLabProjectById(authReq, 'proj-1')).data.args, [
    'user-1',
    'proj-1',
  ]);

  const updateBody = {
    ...createBody,
    authoringMode: 'code',
    codeTarget: 'dsl',
    visualDefinition: null,
    codeDefinition:
      'STRATEGY Draft\nMARKET crypto-futures\nTIMEFRAME 1h\nUNIVERSE top-25-liquidity\nENTRY breakout\nEXIT reversal\nRISK max_per_trade 1.5%',
  };
  assert.deepEqual(
    (await controller.updateStrategyLabProject(authReq, 'proj-1', updateBody)).data.args,
    ['user-1', 'proj-1', updateBody]
  );
  assert.deepEqual((await controller.validateStrategyLabProject(authReq, 'proj-1')).data.args, [
    'user-1',
    'proj-1',
  ]);
  assert.deepEqual((await controller.deleteStrategyLabProject(authReq, 'proj-1')).data.args, [
    'user-1',
    'proj-1',
  ]);
  assert.deepEqual(
    (await controller.moveStrategyLabProjectToTemplate(authReq, 'proj-1')).data.args,
    ['user-1', 'proj-1']
  );

  const handoffBody = { projectId: 'proj-1' };
  assert.deepEqual((await controller.sendStrategyLabToBacktests(authReq, handoffBody)).data.args, [
    'user-1',
    handoffBody,
  ]);
}

async function runStrategyLibraryControllerAssertions(): Promise<void> {
  const controller: any = new StrategyLibraryController();

  controller.strategyLibraryService = {
    listLibrary: async (...args: unknown[]) => createSuccess({ args }),
    getLibraryById: async (...args: unknown[]) => createSuccess({ args }),
    getLibraryRuns: async (...args: unknown[]) => createSuccess({ args }),
    importTemplate: async (...args: unknown[]) => createSuccess({ args }),
    updateLibrary: async (...args: unknown[]) => createSuccess({ args }),
    updateLibraryStatus: async (...args: unknown[]) => createSuccess({ args }),
    deleteLibrary: async (...args: unknown[]) => createSuccess({ args }),
    runLibraryStrategy: async (...args: unknown[]) => createSuccess({ args }),
  };

  assert.deepEqual(
    (
      await controller.listLibrary(
        authReq,
        '10',
        '20',
        'Active',
        'momentum',
        'name_asc',
        'true',
        'false',
        'true',
        'false',
        'true'
      )
    ).data.args,
    [
      'user-1',
      {
        limit: '10',
        offset: '20',
        status: 'Active',
        search: 'momentum',
        sort: 'name_asc',
        hasAssets: 'true',
        hasTimeframes: 'false',
        scopeReady: 'true',
        automationReady: 'false',
        lastRunFailed: 'true',
      },
    ]
  );
  assert.deepEqual((await controller.getLibraryById(authReq, 'lib-1')).data.args, [
    'user-1',
    'lib-1',
  ]);
  assert.deepEqual((await controller.getLibraryRuns(authReq, 'lib-1', '5')).data.args, [
    'user-1',
    'lib-1',
    { limit: '5' },
  ]);
  assert.deepEqual(
    (await controller.importTemplate(authReq, { templateId: 'tpl-1', name: 'Runner' })).data.args,
    ['user-1', { templateId: 'tpl-1', name: 'Runner' }]
  );
  assert.deepEqual(
    (
      await controller.updateLibrary(authReq, 'lib-1', {
        name: 'Runner v2',
        assets: [{ symbol: 'BTCUSDT' }],
      })
    ).data.args,
    ['user-1', 'lib-1', { name: 'Runner v2', assets: [{ symbol: 'BTCUSDT' }] }]
  );
  assert.deepEqual(
    (await controller.updateLibraryStatus(authReq, 'lib-1', { status: 'Paused' })).data.args,
    ['user-1', 'lib-1', { status: 'Paused' }]
  );
  assert.deepEqual((await controller.deleteLibrary(authReq, 'lib-1')).data.args, [
    'user-1',
    'lib-1',
  ]);
  assert.deepEqual(
    (
      await controller.runLibraryStrategy(authReq, 'lib-1', {
        assets: [{ symbol: 'BTCUSDT' }],
      })
    ).data.args,
    ['user-1', 'lib-1', { assets: [{ symbol: 'BTCUSDT' }] }]
  );
}

async function runRiskControllerAssertions(): Promise<void> {
  const controller: any = new RiskController();

  controller.riskService = {
    getRiskSummary: async (...args: unknown[]) => createSuccess({ args }),
    triggerKillSwitch: async (...args: unknown[]) => createSuccess({ args }),
    getRiskPolicies: async (...args: unknown[]) => createSuccess({ args }),
    getRiskPolicyVersions: async (...args: unknown[]) => createSuccess({ args }),
    createRiskPolicy: async (...args: unknown[]) => createSuccess({ args }),
    updateRiskPolicy: async (...args: unknown[]) => createSuccess({ args }),
    rollbackRiskPolicy: async (...args: unknown[]) => createSuccess({ args }),
    approveRiskPolicyVersion: async (...args: unknown[]) => createSuccess({ args }),
    rejectRiskPolicyVersion: async (...args: unknown[]) => createSuccess({ args }),
    recomputeRiskSnapshot: async (...args: unknown[]) => createSuccess({ args }),
  };

  assert.deepEqual((await controller.getRiskSummary(authReq)).data.args, ['user-1']);
  assert.deepEqual((await controller.triggerKillSwitch(authReq, { scope: 'global' })).data.args, [
    'user-1',
    { scope: 'global' },
  ]);
  assert.deepEqual((await controller.getRiskPolicies(authReq)).data.args, ['user-1']);
  assert.deepEqual((await controller.getRiskPolicyVersions(authReq, 'pol-1')).data.args, [
    'user-1',
    'pol-1',
  ]);
  assert.deepEqual((await controller.recomputeRiskSnapshot(authReq)).data.args, ['user-1']);
  const createBody = {
    scope: 'user',
    enabled: true,
    monitorOnly: true,
    enforceHardBlock: false,
    marginUsageWarnPct: 70,
    marginUsageCriticalPct: 85,
    concentrationWarnPct: 30,
    concentrationCriticalPct: 45,
  };
  assert.deepEqual((await controller.createRiskPolicy(authReq, createBody)).data.args, [
    'user-1',
    'user-1',
    {
      ...createBody,
      brokerKey: undefined,
      dailyLossLimitPct: 5,
      weeklyLossLimitPct: 12,
      monthlyLossLimitPct: 20,
      maxLeverage: undefined,
      minLeverage: undefined,
      minNotionalPerTrade: undefined,
      maxOrderAllocation: undefined,
      maxTotalAllocation: undefined,
      maxAvgLeverage: undefined,
    },
  ]);
  const updateBody = {
    ...createBody,
    monitorOnly: false,
    enforceHardBlock: true,
    maxLeverage: 5,
  };
  assert.deepEqual((await controller.updateRiskPolicy(authReq, 'pol-1', updateBody)).data.args, [
    'user-1',
    'user-1',
    'pol-1',
    {
      ...updateBody,
      brokerKey: undefined,
      dailyLossLimitPct: 5,
      weeklyLossLimitPct: 12,
      monthlyLossLimitPct: 20,
      maxOrderAllocation: undefined,
      maxTotalAllocation: undefined,
      maxAvgLeverage: undefined,
      minLeverage: undefined,
      minNotionalPerTrade: undefined,
    },
  ]);
  assert.deepEqual(
    (
      await controller.rollbackRiskPolicy(authReq, 'pol-1', {
        versionId: 'ver-1',
        reason: 'Restore previous thresholds',
      })
    ).data.args,
    ['user-1', 'user-1', 'pol-1', { versionId: 'ver-1', reason: 'Restore previous thresholds' }]
  );
  assert.deepEqual(
    (
      await controller.approveRiskPolicyVersion(authReq, 'pol-1', 'ver-2', {
        reason: 'Safe to activate',
      })
    ).data.args,
    ['user-1', 'user-1', 'pol-1', 'ver-2', { reason: 'Safe to activate' }]
  );
  assert.deepEqual(
    (
      await controller.rejectRiskPolicyVersion(authReq, 'pol-1', 'ver-2', {
        reason: 'Needs a second review',
      })
    ).data.args,
    ['user-1', 'user-1', 'pol-1', 'ver-2', { reason: 'Needs a second review' }]
  );
}

async function runPositionsControllerAssertions(): Promise<void> {
  const controller: any = new PositionsController();

  controller.positionsService = {
    getFuturesPositions: async (...args: unknown[]) => createSuccess({ args }),
    getFuturesPositionsForActiveAccounts: async (...args: unknown[]) => createSuccess({ args }),
    requestPositionsRefresh: async (...args: unknown[]) => createSuccess({ args }),
    getPositionsSyncStatus: async (...args: unknown[]) => createSuccess({ args }),
    getPositionLifecycle: async (...args: unknown[]) => createSuccess({ args }),
    getPositionLiquidationPrice: async (...args: unknown[]) => createSuccess({ args }),
    addPositionMargin: async (...args: unknown[]) => createSuccess({ args }),
    createPositionRiskOrder: async (...args: unknown[]) => createSuccess({ args }),
    updatePositionRiskOrder: async (...args: unknown[]) => createSuccess({ args }),
    reversePosition: async (...args: unknown[]) => createSuccess({ args }),
    closePositionPartial: async (...args: unknown[]) => createSuccess({ args }),
    closePosition: async (...args: unknown[]) => createSuccess({ args }),
    getPositionHistory: async (...args: unknown[]) => createSuccess({ args }),
    getPositionHistoryForActiveAccounts: async (...args: unknown[]) => createSuccess({ args }),
  };

  assert.deepEqual(
    (await controller.getFuturesPositions(authReq, undefined, undefined)).data.args,
    [
      'user-1',
      undefined,
      undefined,
      { brokerKey: undefined, accountId: undefined, limit: undefined },
    ]
  );
  assert.deepEqual(
    (await controller.getFuturesPositionsForActiveAccounts(authReq, undefined)).data.args,
    ['user-1', undefined]
  );
  assert.deepEqual(
    (
      await controller.requestFuturesPositionsRefresh(authReq, {
        brokerKey: 'mudrex',
        accountId: 'acc-1',
      })
    ).data.args,
    ['user-1', { brokerKey: 'mudrex', accountId: 'acc-1' }]
  );
  assert.deepEqual(
    (await controller.getFuturesPositionsSyncStatus(authReq, 'mudrex', 'acc-1')).data.args,
    ['user-1', { brokerKey: 'mudrex', accountId: 'acc-1' }]
  );
  assert.deepEqual(
    (await controller.getPositionLifecycle(authReq, 'pos-1', undefined, 'acc-1')).data.args,
    ['user-1', 'pos-1', undefined, 'acc-1']
  );
  assert.deepEqual(
    (await controller.getPositionLiquidationPrice(authReq, 'pos-1', '100', undefined, undefined))
      .data.args,
    [
      'pos-1',
      { ext_margin: '100', brokerKey: undefined, accountId: undefined },
      'user-1',
      undefined,
      undefined,
    ]
  );
  assert.deepEqual(
    (await controller.addPositionMargin(authReq, 'pos-1', undefined, undefined, { margin: 50 }))
      .data.args,
    ['pos-1', { margin: 50 }, 'user-1', undefined, undefined]
  );
  assert.deepEqual(
    (
      await controller.createPositionRiskOrder(authReq, 'pos-1', undefined, undefined, {
        stoploss_price: '1',
      })
    ).data.args,
    ['pos-1', { stoploss_price: '1' }, 'user-1', undefined, undefined]
  );
  assert.deepEqual(
    (
      await controller.updatePositionRiskOrder(authReq, 'pos-1', undefined, undefined, {
        order_price: 10,
      })
    ).data.args,
    ['pos-1', { order_price: 10 }, 'user-1', undefined, undefined]
  );
  assert.deepEqual(
    (await controller.reversePosition(authReq, 'pos-1', undefined, undefined)).data.args,
    ['pos-1', 'user-1', undefined, undefined]
  );
  assert.deepEqual(
    (await controller.closePositionPartial(authReq, 'pos-1', undefined, undefined, { size: 0.5 }))
      .data.args,
    ['pos-1', { size: 0.5 }, 'user-1', undefined, undefined]
  );
  assert.deepEqual(
    (await controller.closePosition(authReq, 'pos-1', undefined, undefined)).data.args,
    ['pos-1', 'user-1', undefined, undefined]
  );
  assert.deepEqual(
    (await controller.getPositionHistory(authReq, undefined, undefined, '10')).data.args,
    [
      {
        limit: undefined,
        brokerKey: undefined,
        accountId: '10',
        startDate: undefined,
        endDate: undefined,
      },
      'user-1',
      undefined,
      '10',
    ]
  );
  assert.deepEqual(
    (await controller.getPositionHistoryForActiveAccounts(authReq, undefined, undefined, undefined))
      .data.args,
    [
      { limit: undefined, brokerKey: undefined, startDate: undefined, endDate: undefined },
      'user-1',
      undefined,
    ]
  );
}

async function runActivityControllerAssertions(): Promise<void> {
  const controller: any = new ActivityController();

  controller.activityService = {
    getScopedActivitySummary: async (...args: unknown[]) => createSuccess({ args }),
    getActivity: async (...args: unknown[]) => createSuccess({ args }),
    listActivitySavedViews: async (...args: unknown[]) => createSuccess({ args }),
    createActivitySavedView: async (...args: unknown[]) => createSuccess({ args }),
    updateActivitySavedView: async (...args: unknown[]) => createSuccess({ args }),
    deleteActivitySavedView: async (...args: unknown[]) => createSuccess({ args }),
    getActivityById: async (...args: unknown[]) => createSuccess({ args }),
    markActivityRead: async (...args: unknown[]) => createSuccess({ args }),
    markActivityUnread: async (...args: unknown[]) => createSuccess({ args }),
    markAllActivityRead: async (...args: unknown[]) => createSuccess({ args }),
    listActivityExports: async (...args: unknown[]) => createSuccess({ args }),
    getActivityExportById: async (...args: unknown[]) => createSuccess({ args }),
    getActivityExportDownload: async (...args: unknown[]) => ({
      filePath: '/tmp/activity-export-1.json',
      fileName: 'activity-export-1.json',
      contentType: 'application/json',
      args,
    }),
    exportActivity: async (...args: unknown[]) => createSuccess({ args }),
  };

  assert.deepEqual(
    (
      await controller.getActivitySummary(
        authReq,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        'unread',
        'Connections',
        'Success',
        'delta',
        'controls',
        'Brokers data',
        'conn-1',
        'corr-1',
        'delta_exchange',
        'view-1'
      )
    ).data.args,
    [
      'user-1',
      {
        type: 'Connections',
        status: 'Success',
        search: 'delta',
        stream: 'controls',
        route: 'Brokers data',
        referenceId: 'conn-1',
        correlationId: 'corr-1',
        related: 'delta_exchange',
        readState: 'unread',
        savedViewId: 'view-1',
      },
    ]
  );
  assert.deepEqual(
    (
      await controller.getActivity(
        authReq,
        '25',
        '5',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        'Connections',
        'Success',
        'delta',
        'controls',
        'Brokers data',
        'conn-1',
        'corr-1',
        'delta_exchange',
        undefined
      )
    ).data.args,
    [
      'user-1',
      {
        limit: '25',
        offset: '5',
        type: 'Connections',
        status: 'Success',
        search: 'delta',
        stream: 'controls',
        route: 'Brokers data',
        referenceId: 'conn-1',
        correlationId: 'corr-1',
        related: 'delta_exchange',
      },
    ]
  );
  assert.deepEqual((await controller.getActivityById(authReq, 'activity-1')).data.args, [
    'user-1',
    'activity-1',
  ]);
  assert.deepEqual((await controller.getActivitySavedViews(authReq)).data.args, ['user-1']);
  const viewBody = { name: 'Unread controls', readState: 'unread' };
  assert.deepEqual((await controller.createActivitySavedView(authReq, viewBody)).data.args, [
    'user-1',
    viewBody,
  ]);
  assert.deepEqual(
    (await controller.updateActivitySavedView(authReq, 'view-1', viewBody)).data.args,
    ['user-1', 'view-1', viewBody]
  );
  assert.deepEqual((await controller.deleteActivitySavedView(authReq, 'view-1')).data.args, [
    'user-1',
    'view-1',
  ]);
  assert.deepEqual((await controller.markActivityRead(authReq, 'activity-1')).data.args, [
    'user-1',
    'activity-1',
  ]);
  assert.deepEqual((await controller.markActivityUnread(authReq, 'activity-1')).data.args, [
    'user-1',
    'activity-1',
  ]);
  assert.deepEqual(
    (
      await controller.markAllActivityRead(
        authReq,
        {
          type: 'Connections',
          status: 'Success',
          search: 'delta',
          stream: 'controls',
          route: 'Brokers data',
          referenceId: 'conn-1',
          correlationId: 'corr-1',
          related: 'delta_exchange',
          readState: 'unread',
          savedViewId: 'view-1',
        },
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined
      )
    ).data.args,
    [
      'user-1',
      {
        type: 'Connections',
        status: 'Success',
        search: 'delta',
        stream: 'controls',
        route: 'Brokers data',
        referenceId: 'conn-1',
        correlationId: 'corr-1',
        related: 'delta_exchange',
        readState: 'unread',
        savedViewId: 'view-1',
      },
    ]
  );
  assert.deepEqual((await controller.getActivityExports(authReq, '10', '2')).data.args, [
    'user-1',
    {
      limit: '10',
      offset: '2',
    },
  ]);
  assert.deepEqual((await controller.getActivityExportById(authReq, 'export-1')).data.args, [
    'user-1',
    'export-1',
  ]);
  const responseMock: any = {
    headers: {} as Record<string, string>,
    type(contentType: string) {
      this.headers.type = contentType;
      return this;
    },
    download(filePath: string, fileName: string) {
      this.downloadArgs = { filePath, fileName };
      return this;
    },
  };
  const downloadResponse = await controller.downloadActivityExport(
    authReq,
    'export-1',
    responseMock
  );
  assert.equal(downloadResponse, responseMock);
  assert.equal(responseMock.headers.type, 'application/json');
  assert.deepEqual(responseMock.downloadArgs, {
    filePath: '/tmp/activity-export-1.json',
    fileName: 'activity-export-1.json',
  });
  const exportBody = {
    scope: 'controls',
    format: 'csv',
    route: 'Brokers data',
  };
  assert.deepEqual((await controller.exportActivity(authReq, exportBody)).data.args, [
    'user-1',
    exportBody,
  ]);
}

async function runAlertsControllerAssertions(): Promise<void> {
  const controller: any = new AlertsController();

  controller.alertsService = {
    getAlerts: async (...args: unknown[]) => createSuccess({ args }),
    getAlertsSummary: async (...args: unknown[]) => createSuccess({ args }),
    getAlertById: async (...args: unknown[]) => createSuccess({ args }),
    acknowledgeAlert: async (...args: unknown[]) => createSuccess({ args }),
    muteAlert: async (...args: unknown[]) => createSuccess({ args }),
    routeAlert: async (...args: unknown[]) => createSuccess({ args }),
  };

  assert.deepEqual(
    (await controller.getAlerts(authReq, undefined, undefined, 'Open', 'Critical', 'Risk')).data
      .args,
    [
      'user-1',
      {
        limit: undefined,
        offset: undefined,
        status: 'Open',
        search: 'Critical',
        severity: 'Risk',
        channel: undefined,
      },
    ]
  );
  assert.deepEqual((await controller.getAlertsSummary(authReq)).data.args, ['user-1']);
  assert.deepEqual((await controller.getAlertById(authReq, 'alert-1')).data.args, [
    'user-1',
    'alert-1',
  ]);
  assert.deepEqual(
    (await controller.acknowledgeAlert(authReq, 'alert-1', { note: 'Reviewed' })).data.args,
    ['user-1', 'alert-1', { note: 'Reviewed' }]
  );
  assert.deepEqual(
    (await controller.muteAlert(authReq, 'alert-1', { reason: 'Duplicate alert' })).data.args,
    ['user-1', 'alert-1', { reason: 'Duplicate alert' }]
  );
  assert.deepEqual(
    (await controller.routeAlert(authReq, 'alert-1', { target: 'risk', note: 'Risk team first' }))
      .data.args,
    ['user-1', 'alert-1', { target: 'risk', note: 'Risk team first' }]
  );
}

async function runConnectionsControllerAssertions(): Promise<void> {
  const controller: any = new ConnectionsController();

  controller.connectionsService = {
    getConnections: async (...args: unknown[]) => createSuccess({ args }),
    getConnectionsSummary: async (...args: unknown[]) => createSuccess({ args }),
    getBrokerCatalog: async (...args: unknown[]) => createSuccess({ args }),
    getConnectionWorkspace: async (...args: unknown[]) => createSuccess({ args }),
    createConnection: async (...args: unknown[]) => createSuccess({ args }),
    updateConnectionDetails: async (...args: unknown[]) => createSuccess({ args }),
    getConnectionById: async (...args: unknown[]) => createSuccess({ args }),
    reconnectConnection: async (...args: unknown[]) => createSuccess({ args }),
    testConnection: async (...args: unknown[]) => createSuccess({ args }),
    deleteConnection: async (...args: unknown[]) => createSuccess({ args }),
  };

  assert.deepEqual(
    (await controller.getConnections(authReq, undefined, undefined, 'Connected', undefined)).data
      .args,
    ['user-1', { limit: undefined, offset: undefined, type: 'Connected', search: undefined }]
  );
  assert.deepEqual((await controller.getConnectionsSummary(authReq)).data.args, ['user-1']);
  assert.deepEqual((await controller.getBrokerCatalog(authReq)).data.args, ['user-1']);
  assert.deepEqual(
    (
      await controller.getConnectionWorkspace(
        authReq,
        'con-1',
        '10',
        '20',
        'primary',
        '4',
        'acct-1'
      )
    ).data.args,
    [
      'user-1',
      'con-1',
      {
        accountLimit: '10',
        accountOffset: '20',
        accountSearch: 'primary',
        activityLimit: '4',
        selectedAccountId: 'acct-1',
      },
    ]
  );
  assert.deepEqual(
    (
      await controller.createConnection(authReq, {
        name: 'Delta route',
        brokerKey: 'delta_exchange',
      })
    ).data.args,
    ['user-1', { name: 'Delta route', brokerKey: 'delta_exchange' }]
  );
  assert.deepEqual(
    (
      await controller.updateConnectionDetails(authReq, 'con-1', {
        name: 'Delta backup route',
        brokerKey: 'delta_exchange',
      })
    ).data.args,
    ['user-1', 'con-1', { name: 'Delta backup route', brokerKey: 'delta_exchange' }]
  );
  assert.deepEqual((await controller.getConnectionById(authReq, 'con-1')).data.args, [
    'user-1',
    'con-1',
  ]);
  assert.deepEqual((await controller.reconnectConnection(authReq, 'con-1')).data.args, [
    'user-1',
    'con-1',
    undefined,
  ]);
  assert.deepEqual((await controller.testConnection(authReq, 'con-1', { ping: true })).data.args, [
    'user-1',
    'con-1',
    { ping: true },
  ]);
  assert.deepEqual((await controller.deleteConnection(authReq, 'con-1')).data.args, [
    'user-1',
    'con-1',
  ]);
}

async function runSettingsControllerAssertions(): Promise<void> {
  const controller: any = new SettingsController();

  controller.settingsService = {
    getSettings: async (...args: unknown[]) => createSuccess({ args }),
    getSettingsAudit: async (...args: unknown[]) => createSuccess({ args }),
    updateSettings: async (...args: unknown[]) => createSuccess({ args }),
  };

  assert.deepEqual((await controller.getSettings(authReq)).data.args, ['user-1']);
  assert.deepEqual((await controller.getSettingsAudit(authReq, '10', '5')).data.args, [
    'user-1',
    { limit: '10', offset: '5' },
  ]);
  assert.deepEqual(
    (
      await controller.updateSettings(authReq, {
        timezone: 'Asia/Kolkata',
        notificationChannel: 'email',
        expectedUpdatedAt: '2026-04-04T00:05:00.000Z',
      })
    ).data.args,
    [
      'user-1',
      {
        timezone: 'Asia/Kolkata',
        notificationChannel: 'email',
        expectedUpdatedAt: '2026-04-04T00:05:00.000Z',
      },
    ]
  );
}

async function runEmailDeliveriesControllerAssertions(): Promise<void> {
  const controller: any = new EmailDeliveriesController();

  controller.emailDeliveriesService = {
    getEmailDeliveries: async (...args: unknown[]) => createSuccess({ args }),
    getEmailDeliveriesSummary: async (...args: unknown[]) => createSuccess({ args }),
    getEmailDeliveryFilterOptions: async (...args: unknown[]) => createSuccess({ args }),
    exportEmailDeliveries: async (...args: unknown[]) => createSuccess({ args }),
    previewMatchingFailedEmailDeliveries: async (...args: unknown[]) => createSuccess({ args }),
    retryAllFailedEmailDeliveries: async (...args: unknown[]) => createSuccess({ args }),
    retryMatchingFailedEmailDeliveries: async (...args: unknown[]) => createSuccess({ args }),
    previewCleanupEmailDeliveries: async (...args: unknown[]) => createSuccess({ args }),
    previewMatchingCleanupEmailDeliveries: async (...args: unknown[]) => createSuccess({ args }),
    getLatestCleanupActivity: async (...args: unknown[]) => createSuccess({ args }),
    getEmailDeliveryById: async (...args: unknown[]) => createSuccess({ args }),
    cleanupEmailDeliveries: async (...args: unknown[]) => createSuccess({ args }),
    cleanupMatchingEmailDeliveries: async (...args: unknown[]) => createSuccess({ args }),
    sendTestEmailDelivery: async (...args: unknown[]) => createSuccess({ args }),
    retryEmailDelivery: async (...args: unknown[]) => createSuccess({ args }),
    resendEmailDelivery: async (...args: unknown[]) => createSuccess({ args }),
  };

  assert.deepEqual(
    (
      await controller.getEmailDeliveries(
        adminAuthReq,
        '10',
        '5',
        'Failed',
        'smtp',
        'user-2',
        'ops@auralpha.com',
        'High',
        'Scheduler',
        'email-worker'
      )
    ).data.args,
    [
      {
        userId: 'user-1',
        role: 'admin',
      },
      {
        limit: '10',
        offset: '5',
        status: 'Failed',
        search: 'smtp',
        userId: 'user-2',
        recipient: 'ops@auralpha.com',
        severity: 'High',
        channel: 'Scheduler',
        source: 'email-worker',
      },
    ]
  );
  assert.deepEqual((await controller.getEmailDeliveriesSummary(adminAuthReq)).data.args, [
    { userId: 'user-1', role: 'admin' },
  ]);
  assert.deepEqual((await controller.getEmailDeliveryFilterOptions(adminAuthReq)).data.args, [
    { userId: 'user-1', role: 'admin' },
  ]);
  assert.deepEqual((await controller.getLatestCleanupActivity(adminAuthReq)).data.args, [
    { userId: 'user-1', role: 'admin' },
  ]);
  assert.deepEqual(
    (
      await controller.exportEmailDeliveries(adminAuthReq, {
        format: 'csv',
        status: 'Failed',
      })
    ).data.args,
    [
      { userId: 'user-1', role: 'admin' },
      { format: 'csv', status: 'Failed' },
    ]
  );
  assert.deepEqual(
    (
      await controller.previewMatchingFailedEmailDeliveries(
        adminAuthReq,
        'Failed',
        'smtp',
        'user-2',
        'ops@auralpha.com',
        'High',
        'Scheduler',
        'email-worker'
      )
    ).data.args,
    [
      { userId: 'user-1', role: 'admin' },
      {
        status: 'Failed',
        search: 'smtp',
        userId: 'user-2',
        recipient: 'ops@auralpha.com',
        severity: 'High',
        channel: 'Scheduler',
        source: 'email-worker',
      },
    ]
  );
  assert.deepEqual((await controller.retryAllFailedEmailDeliveries(adminAuthReq)).data.args, [
    { userId: 'user-1', role: 'admin' },
  ]);
  assert.deepEqual(
    (
      await controller.retryMatchingFailedEmailDeliveries(
        adminAuthReq,
        'Failed',
        'smtp',
        'user-2',
        'ops@auralpha.com',
        'High',
        'Scheduler',
        'email-worker'
      )
    ).data.args,
    [
      { userId: 'user-1', role: 'admin' },
      {
        status: 'Failed',
        search: 'smtp',
        userId: 'user-2',
        recipient: 'ops@auralpha.com',
        severity: 'High',
        channel: 'Scheduler',
        source: 'email-worker',
      },
    ]
  );
  assert.deepEqual((await controller.previewCleanupEmailDeliveries(adminAuthReq, '30')).data.args, [
    { userId: 'user-1', role: 'admin' },
    '30',
  ]);
  assert.deepEqual(
    (
      await controller.previewMatchingCleanupEmailDeliveries(
        adminAuthReq,
        'Failed',
        'smtp',
        'user-2',
        'ops@auralpha.com',
        'High',
        'Scheduler',
        'email-worker'
      )
    ).data.args,
    [
      { userId: 'user-1', role: 'admin' },
      {
        status: 'Failed',
        search: 'smtp',
        userId: 'user-2',
        recipient: 'ops@auralpha.com',
        severity: 'High',
        channel: 'Scheduler',
        source: 'email-worker',
      },
    ]
  );
  assert.deepEqual((await controller.getEmailDeliveryById(adminAuthReq, 'delivery-1')).data.args, [
    { userId: 'user-1', role: 'admin' },
    'delivery-1',
  ]);
  assert.deepEqual((await controller.cleanupEmailDeliveries(adminAuthReq, '30')).data.args, [
    { userId: 'user-1', role: 'admin' },
    '30',
  ]);
  assert.deepEqual(
    (
      await controller.cleanupMatchingEmailDeliveries(
        adminAuthReq,
        'Failed',
        'smtp',
        'user-2',
        'ops@auralpha.com',
        'High',
        'Scheduler',
        'email-worker'
      )
    ).data.args,
    [
      { userId: 'user-1', role: 'admin' },
      {
        status: 'Failed',
        search: 'smtp',
        userId: 'user-2',
        recipient: 'ops@auralpha.com',
        severity: 'High',
        channel: 'Scheduler',
        source: 'email-worker',
      },
    ]
  );
  assert.deepEqual((await controller.sendTestEmailDelivery(adminAuthReq)).data.args, [
    { userId: 'user-1', role: 'admin' },
  ]);
  assert.deepEqual((await controller.retryEmailDelivery(adminAuthReq, 'delivery-1')).data.args, [
    { userId: 'user-1', role: 'admin' },
    'delivery-1',
  ]);
  assert.deepEqual((await controller.resendEmailDelivery(adminAuthReq, 'delivery-1')).data.args, [
    { userId: 'user-1', role: 'admin' },
    'delivery-1',
  ]);
}

async function runHealthControllerAssertions(): Promise<void> {
  const controller: any = new HealthController();
  const originalGetConnection = RedisClient.getConnection;
  const originalEmailEnabled = env.email.enabled;
  const originalSmtpHost = env.email.smtp.host;
  const originalSmtpFrom = env.email.smtp.from;
  const originalDateNow = Date.now;

  controller.readWorkerHttpHealth = async () => ({ status: 'ok' });
  controller.emailDeliveryRepository = {
    async getOperationalSnapshot() {
      return {
        queued: 4,
        sending: 1,
        failed: 2,
        active: 7,
        oldestPendingAt: new Date('2026-04-04T08:00:00.000Z'),
        oldestPendingAgeMs: 90_000,
      };
    },
  };

  env.email.enabled = true;
  env.email.smtp.host = 'smtp.example.com';
  env.email.smtp.from = 'alerts@example.com';
  Date.now = () => new Date('2026-04-04T08:01:30.000Z').getTime();
  (RedisClient as any).getConnection = () => ({
    async get(key: string) {
      assert.equal(key, env.redis.emailWorkerHeartbeatKey);
      return JSON.stringify({
        workerId: 'email-worker-1',
        timestamp: '2026-04-04T08:01:00.000Z',
        status: 'idle',
        pollIntervalMs: 5000,
        lastBatchCompletedAt: '2026-04-04T08:00:30.000Z',
      });
    },
  });

  try {
    controller.discoveryDependencyService = {
      async getDependencyHealth(...args: unknown[]) {
        return {
          status: 'ok',
          checkedAt: '2026-04-06T06:00:00.000Z',
          baseUrl: 'http://localhost:8000/api/v1/discovery',
          service: {
            key: 'service',
            label: 'Discovery engine health',
            status: 'ok',
          },
          readiness: {
            key: 'readiness',
            label: 'Discovery engine readiness',
            status: 'ok',
          },
          auth: {
            key: 'auth',
            label: 'Auth bridge',
            status: 'ok',
          },
          contract: {
            key: 'contract',
            label: 'External API contract',
            status: 'ok',
            checkedEndpoints: ['bots', 'runs', 'preferences'],
          },
          endpoints: [],
          args,
        };
      },
    };

    const discoveryDependencyHealth = await controller.getDiscoveryDependencyHealth({
      authUser: { sub: 'user-1' },
      headers: {
        authorization: 'Bearer token-1',
      },
    } as any);
    assert.equal(discoveryDependencyHealth.data.status, 'ok');
    assert.equal(discoveryDependencyHealth.data.baseUrl, 'http://localhost:8000/api/v1/discovery');
    assert.deepEqual(discoveryDependencyHealth.data.args, ['Bearer token-1']);

    const response = await controller.getEmailWorkerHealth(adminAuthReq);
    assert.equal(response.data.status, 'ok');
    assert.equal(response.data.workerId, 'email-worker-1');
    assert.equal(response.data.queuedCount, 4);
    assert.equal(response.data.sendingCount, 1);
    assert.equal(response.data.failedCount, 2);
    assert.equal(response.data.activeCount, 7);
    assert.equal(response.data.oldestPendingAt, '2026-04-04T08:00:00.000Z');
    assert.equal(response.data.oldestPendingAgeMs, 90_000);
    assert.equal(response.data.heartbeatAgeMs, 30_000);
    assert.equal(response.data.heartbeatLagMs, 25_000);
    assert.equal(response.data.heartbeatStaleThresholdMs, 30_000);
    assert.equal(response.data.isHeartbeatStale, false);
    assert.equal(response.data.lastBatchAgeMs, 60_000);
  } finally {
    (RedisClient as any).getConnection = originalGetConnection;
    env.email.enabled = originalEmailEnabled;
    env.email.smtp.host = originalSmtpHost;
    env.email.smtp.from = originalSmtpFrom;
    Date.now = originalDateNow;
  }

  await assert.rejects(
    () => controller.getEmailWorkerHealth(authReq),
    (error: unknown) => error instanceof Error && error.message === 'Admin role is required'
  );

  await assert.rejects(
    () => controller.getDiscoveryDependencyHealth({ headers: {} } as any),
    (error: unknown) => error instanceof Error && error.message === 'Authentication required'
  );

  controller.backtestRepository = {
    async getOperationalSnapshot(staleThresholdMinutes: number) {
      assert.equal(staleThresholdMinutes, 30);
      return {
        totalRuns: 12,
        activeRuns: 3,
        queuedRuns: 1,
        runningRuns: 2,
        staleRunningRuns: 1,
        recoverableRuns: 2,
        incompleteTradeHistoryRuns: 4,
        oldestActiveCreatedAt: new Date('2026-04-04T06:00:00.000Z'),
        oldestStaleUpdatedAt: new Date('2026-04-04T05:30:00.000Z'),
      };
    },
  };
  controller.alertRepository = {
    async getOpenChannelSnapshot(channel: string, sources: string[]) {
      assert.equal(channel, 'Backtests');
      assert.deepEqual(sources, ['backtests', 'backtests:recovery', 'backtests:promotion']);
      return {
        openAlerts: 5,
        openAlertsBySource: {
          backtests: 2,
          'backtests:recovery': 1,
          'backtests:promotion': 2,
        },
      };
    },
  };

  const backtestHealth = await controller.getBacktestHealth(adminAuthReq);
  assert.equal(backtestHealth.data.status, 'degraded');
  assert.equal(backtestHealth.data.totalRuns, 12);
  assert.equal(backtestHealth.data.activeRuns, 3);
  assert.equal(backtestHealth.data.queuedRuns, 1);
  assert.equal(backtestHealth.data.runningRuns, 2);
  assert.equal(backtestHealth.data.staleRunningRuns, 1);
  assert.equal(backtestHealth.data.recoverableRuns, 2);
  assert.equal(backtestHealth.data.incompleteTradeHistoryRuns, 4);
  assert.equal(backtestHealth.data.openAlerts, 5);
  assert.equal(backtestHealth.data.openRuntimeAlerts, 2);
  assert.equal(backtestHealth.data.openRecoveryAlerts, 1);
  assert.equal(backtestHealth.data.openPromotionAlerts, 2);
  assert.equal(backtestHealth.data.oldestActiveCreatedAt, '2026-04-04T06:00:00.000Z');
  assert.equal(backtestHealth.data.oldestStaleUpdatedAt, '2026-04-04T05:30:00.000Z');
  assert.match(String(backtestHealth.data.detail || ''), /running backtest/);
  assert.match(String(backtestHealth.data.detail || ''), /stored trade events/);
  assert.match(String(backtestHealth.data.detail || ''), /open Backtests alert/);

  const apiKeyBacktestHealth = await controller.getBacktestHealth(apiKeyReq);
  assert.equal(apiKeyBacktestHealth.data.status, 'degraded');
  assert.equal(apiKeyBacktestHealth.data.totalRuns, 12);
  assert.equal(apiKeyBacktestHealth.data.staleRunningRuns, 1);
  assert.equal(apiKeyBacktestHealth.data.incompleteTradeHistoryRuns, 4);
  assert.equal(apiKeyBacktestHealth.data.openAlerts, 5);

  await assert.rejects(
    () => controller.getBacktestHealth(authReq),
    (error: unknown) => error instanceof Error && error.message === 'Admin role is required'
  );

  controller.automationsService = {
    async getAutomationOperationalSnapshot() {
      return {
        total: 9,
        running: 4,
        paused: 2,
        failed: 1,
        draft: 2,
        connectedAccounts: 6,
        health: 'Degraded',
        healthStatus: 'degraded',
        detail: '1 automation run failed in the last 24h 1 stale cursor older than 120 minutes',
        summary: {
          workerStatus: 'ok',
          workerHttpStatus: 'ok',
          heartbeatStatus: 'ok',
          workerDetail: '1 automation run failed in the last 24h',
          workerHeartbeatAgeMs: 2500,
          commandPollLagMs: 1200,
          queueStatus: 'ok',
          queueLatencyMs: 9,
          activeRuns: 2,
          failedRuns24h: 1,
          overlapSkips24h: 2,
          staleCursorCount: 1,
          totalCursorCount: 3,
          staleCursorThresholdMinutes: 120,
          lastCursorAt: '2026-04-04T11:00:00.000Z',
          lastTriggeredSignalAt: '2026-04-04T10:45:00.000Z',
        },
      };
    },
  };
  controller.alertRepository = {
    async getOpenChannelSnapshot(channel: string, sources: string[]) {
      assert.equal(channel, 'Automation');
      assert.deepEqual(sources, ['automations', 'automations:recovery', 'automation-execution']);
      return {
        openAlerts: 4,
        openAlertsBySource: {
          automations: 1,
          'automations:recovery': 1,
          'automation-execution': 2,
        },
      };
    },
  };

  const automationHealth = await controller.getAutomationHealth(adminAuthReq);
  assert.equal(automationHealth.data.status, 'degraded');
  assert.equal(automationHealth.data.totalAutomations, 9);
  assert.equal(automationHealth.data.runningAutomations, 4);
  assert.equal(automationHealth.data.pausedAutomations, 2);
  assert.equal(automationHealth.data.failedAutomations, 1);
  assert.equal(automationHealth.data.draftAutomations, 2);
  assert.equal(automationHealth.data.connectedAccounts, 6);
  assert.equal(automationHealth.data.workerStatus, 'ok');
  assert.equal(automationHealth.data.queueStatus, 'ok');
  assert.equal(automationHealth.data.activeRuns, 2);
  assert.equal(automationHealth.data.failedRuns24h, 1);
  assert.equal(automationHealth.data.overlapSkips24h, 2);
  assert.equal(automationHealth.data.staleCursorCount, 1);
  assert.equal(automationHealth.data.totalCursorCount, 3);
  assert.equal(automationHealth.data.openAlerts, 4);
  assert.equal(automationHealth.data.openControlAlerts, 1);
  assert.equal(automationHealth.data.openRecoveryAlerts, 1);
  assert.equal(automationHealth.data.openExecutionAlerts, 2);
  assert.match(String(automationHealth.data.detail || ''), /open Automation alert/);

  const apiKeyAutomationHealth = await controller.getAutomationHealth(apiKeyReq);
  assert.equal(apiKeyAutomationHealth.data.status, 'degraded');
  assert.equal(apiKeyAutomationHealth.data.totalAutomations, 9);
  assert.equal(apiKeyAutomationHealth.data.openAlerts, 4);

  await assert.rejects(
    () => controller.getAutomationHealth(authReq),
    (error: unknown) => error instanceof Error && error.message === 'Admin role is required'
  );

  controller.suggestedTradesHealthService = {
    async getOperationalSnapshot(payload: { probeUserId?: string | null }) {
      assert.equal(payload.probeUserId, 'user-1');
      return {
        status: 'degraded',
        timestamp: '2026-04-04T12:00:00.000Z',
        rolloutEnabled: true,
        rolloutStage: 'internal',
        backgroundSyncEnabled: true,
        syncState: 'attention',
        syncLabel: 'Needs Attention',
        syncSummary: '1 tracked trade needs refresh.',
        trackedTrades: 3,
        staleTrackedTrades: 1,
        terminalTrackedTrades: 1,
        totalSuggestedTrades: 11,
        openSuggestions: 2,
        reviewedSuggestions: 1,
        acceptedSuggestions: 5,
        dismissedSuggestions: 3,
        readyForOrderCount: 2,
        convertedToOrderCount: 3,
        linkedSuggestions: 1,
        workingSuggestions: 1,
        filledSuggestions: 1,
        closedSuggestions: 1,
        queueToOrderConversionRate: 0.6,
        queueToOrderSuccess24h: 2,
        summaryRuns24h: 3,
        suggestedTradesCreated24h: 7,
        duplicateSuggestions24h: 1,
        refreshFailures24h: 1,
        stateTransitionFailures24h: 0,
        openAlerts: 1,
        openActionAlerts: 1,
        openExecutionAlerts: 0,
        probeUserId: 'user-1',
        overviewLatencyMs: 40,
        listLatencyMs: 15,
        summaryLatencyMs: 10,
        syncStatusLatencyMs: 12,
        latencyProbeError: null,
        detail: '1 tracked trade needs refresh.',
      };
    },
  };

  const suggestedTradeHealth = await controller.getSuggestedTradeHealth(adminAuthReq);
  assert.equal(suggestedTradeHealth.data.status, 'degraded');
  assert.equal(suggestedTradeHealth.data.rolloutEnabled, true);
  assert.equal(suggestedTradeHealth.data.staleTrackedTrades, 1);
  assert.equal(suggestedTradeHealth.data.queueToOrderConversionRate, 0.6);
  assert.equal(suggestedTradeHealth.data.overviewLatencyMs, 40);

  controller.suggestedTradesHealthService = {
    async getOperationalSnapshot(payload: { probeUserId?: string | null }) {
      assert.equal(payload.probeUserId, null);
      return {
        status: 'disabled',
        timestamp: '2026-04-04T12:00:00.000Z',
        rolloutEnabled: false,
        rolloutStage: 'paused',
        syncState: 'paused',
        syncLabel: 'Paused',
        syncSummary: 'Background execution sync is paused.',
        trackedTrades: 0,
        staleTrackedTrades: 0,
        terminalTrackedTrades: 0,
        totalSuggestedTrades: 0,
        openSuggestions: 0,
        reviewedSuggestions: 0,
        acceptedSuggestions: 0,
        dismissedSuggestions: 0,
        readyForOrderCount: 0,
        convertedToOrderCount: 0,
        linkedSuggestions: 0,
        workingSuggestions: 0,
        filledSuggestions: 0,
        closedSuggestions: 0,
        queueToOrderConversionRate: null,
        queueToOrderSuccess24h: 0,
        summaryRuns24h: 0,
        suggestedTradesCreated24h: 0,
        duplicateSuggestions24h: 0,
        refreshFailures24h: 0,
        stateTransitionFailures24h: 0,
        openAlerts: 0,
        openActionAlerts: 0,
        openExecutionAlerts: 0,
        probeUserId: null,
        overviewLatencyMs: null,
        listLatencyMs: null,
        summaryLatencyMs: null,
        syncStatusLatencyMs: null,
        latencyProbeError: null,
      };
    },
  };

  const apiKeySuggestedTradeHealth = await controller.getSuggestedTradeHealth(apiKeyReq);
  assert.equal(apiKeySuggestedTradeHealth.data.status, 'disabled');
  assert.equal(apiKeySuggestedTradeHealth.data.rolloutEnabled, false);
  assert.equal(apiKeySuggestedTradeHealth.data.probeUserId, null);

  await assert.rejects(
    () => controller.getSuggestedTradeHealth(authReq),
    (error: unknown) => error instanceof Error && error.message === 'Admin role is required'
  );
}

async function runBrokerDefinitionsControllerAssertions(): Promise<void> {
  const controller: any = new BrokerDefinitionsController();

  controller.brokerDefinitionsService = {
    listDefinitions: async (...args: unknown[]) => createSuccess({ args }),
    getDefinition: async (...args: unknown[]) => createSuccess({ args }),
    upsertDefinition: async (...args: unknown[]) => createSuccess({ args }),
  };

  assert.deepEqual((await controller.listDefinitions(adminAuthReq)).data.args, [
    {
      userId: 'user-1',
      role: 'admin',
    },
  ]);
  assert.deepEqual((await controller.getDefinition(adminAuthReq, 'mudrex')).data.args, [
    {
      userId: 'user-1',
      role: 'admin',
    },
    'mudrex',
  ]);
  assert.deepEqual(
    (
      await controller.upsertDefinition(adminAuthReq, 'mudrex', {
        brokerKey: 'ignored-key',
        name: 'Mudrex',
        category: 'broker',
        status: 'active',
        providerType: 'broker',
        capabilities: ['market'],
        accountFields: [],
        expectedUpdatedAt: '2026-04-04T00:05:00.000Z',
      })
    ).data.args,
    [
      {
        userId: 'user-1',
        role: 'admin',
      },
      {
        brokerKey: 'mudrex',
        name: 'Mudrex',
        category: 'broker',
        status: 'active',
        providerType: 'broker',
        capabilities: ['market'],
        accountFields: [],
        expectedUpdatedAt: '2026-04-04T00:05:00.000Z',
      },
    ]
  );
}

async function runStrategyControllerAssertions(): Promise<void> {
  const controller: any = new StrategyController();

  controller.strategyService = {
    getStrategies: async (...args: unknown[]) => createSuccess({ args }),
    runStrategy: async (...args: unknown[]) => createSuccess({ args }),
  };

  assert.deepEqual((await controller.getStrategies()).data.args, []);
  assert.deepEqual(
    (
      await controller.runStrategy({
        strategyId: 'strat-1',
        symbols: 'BTCUSDT',
        interval: '1h',
        limit: '200',
      })
    ).data.args,
    [
      {
        strategyId: 'strat-1',
        symbols: 'BTCUSDT',
        interval: '1h',
        limit: '200',
      },
    ]
  );
}

async function runStrategyTemplatesControllerAssertions(): Promise<void> {
  const controller: any = new StrategyTemplatesController();

  controller.strategyTemplatesService = {
    listStrategyTemplates: async (...args: unknown[]) => createSuccess({ args }),
    getStrategyTemplateById: async (...args: unknown[]) => createSuccess({ args }),
    listStrategyTemplateVersions: async (...args: unknown[]) => createSuccess({ args }),
    createStrategyTemplate: async (...args: unknown[]) => createSuccess({ args }),
    updateStrategyTemplate: async (...args: unknown[]) => createSuccess({ args }),
    updateStrategyTemplateStatus: async (...args: unknown[]) => createSuccess({ args }),
    duplicateStrategyTemplate: async (...args: unknown[]) => createSuccess({ args }),
    deleteStrategyTemplate: async (...args: unknown[]) => createSuccess({ args }),
  };

  assert.deepEqual(
    (await controller.listStrategyTemplates(authReq, '25', '10', 'Active', 'momentum')).data.args,
    ['user-1', { limit: '25', offset: '10', status: 'Active', search: 'momentum' }]
  );
  assert.deepEqual((await controller.getStrategyTemplateById(authReq, 'template-1')).data.args, [
    'user-1',
    'template-1',
  ]);
  assert.deepEqual(
    (await controller.listStrategyTemplateVersions(authReq, 'template-1')).data.args,
    ['user-1', 'template-1']
  );

  const createBody = { name: 'Momentum Core', status: 'Draft' };
  assert.deepEqual((await controller.createStrategyTemplate(authReq, createBody)).data.args, [
    'user-1',
    createBody,
  ]);

  const updateBody = { name: 'Momentum Core v2' };
  assert.deepEqual(
    (await controller.updateStrategyTemplate(authReq, 'template-1', updateBody)).data.args,
    ['user-1', 'template-1', updateBody]
  );

  const statusBody = { status: 'Paused' };
  assert.deepEqual(
    (await controller.updateStrategyTemplateStatus(authReq, 'template-1', statusBody)).data.args,
    ['user-1', 'template-1', statusBody]
  );

  const duplicateBody = { name: 'Momentum Core Copy' };
  assert.deepEqual(
    (await controller.duplicateStrategyTemplate(authReq, 'template-1', duplicateBody)).data.args,
    ['user-1', 'template-1', duplicateBody]
  );

  assert.deepEqual((await controller.deleteStrategyTemplate(authReq, 'template-1')).data.args, [
    'user-1',
    'template-1',
  ]);
}

async function runSchedulerControllerAuthAssertions(): Promise<void> {
  const schedulerCases: Array<{
    label: string;
    controller: any;
    serviceProperty: string;
    serviceMethod: string;
    controllerMethod: string;
    args?: unknown[];
    expectedArgs?: unknown[];
    authMode?: 'admin' | 'user';
  }> = [
    {
      label: 'scheduler overview',
      controller: new SchedulerOverviewController(),
      serviceProperty: 'schedulerOverviewService',
      serviceMethod: 'getOverview',
      controllerMethod: 'getOverview',
      expectedArgs: ['user-1'],
    },
    {
      label: 'exchange assets scheduler config',
      controller: new SchedulerController(),
      serviceProperty: 'schedulerService',
      serviceMethod: 'getSchedulerConfig',
      controllerMethod: 'getConfig',
      expectedArgs: ['user-1'],
    },
    {
      label: 'exchange assets scheduler assets',
      controller: new SchedulerController(),
      serviceProperty: 'schedulerService',
      serviceMethod: 'listSchedulerAssets',
      controllerMethod: 'listAssets',
      args: ['10', '5', 'btc', 'asset-1'],
      expectedArgs: [{ limit: '10', offset: '5', search: 'btc', assetId: 'asset-1' }],
    },
    {
      label: 'asset price scheduler config',
      controller: new AssetPriceSchedulerController(),
      serviceProperty: 'assetPriceSchedulerService',
      serviceMethod: 'getSchedulerConfig',
      controllerMethod: 'getConfig',
      expectedArgs: ['user-1'],
    },
    {
      label: 'asset price scheduler assets',
      controller: new AssetPriceSchedulerController(),
      serviceProperty: 'assetPriceSchedulerService',
      serviceMethod: 'listSchedulerAssets',
      controllerMethod: 'listAssets',
      args: ['10', '5', 'btc', 'asset-1'],
      expectedArgs: [{ limit: '10', offset: '5', search: 'btc', assetId: 'asset-1' }],
    },
    {
      label: 'binance assets scheduler config',
      controller: new BinanceAssetsSchedulerController(),
      serviceProperty: 'binanceAssetsSchedulerService',
      serviceMethod: 'getSchedulerConfig',
      controllerMethod: 'getConfig',
      expectedArgs: ['user-1'],
    },
    {
      label: 'candles scheduler config',
      controller: new CandlesSchedulerController(),
      serviceProperty: 'candlesSchedulerService',
      serviceMethod: 'getSchedulerConfig',
      controllerMethod: 'getConfig',
      expectedArgs: ['user-1'],
    },
    {
      label: 'candles scheduler assets',
      controller: new CandlesSchedulerController(),
      serviceProperty: 'candlesSchedulerService',
      serviceMethod: 'listSchedulerAssets',
      controllerMethod: 'listAssets',
      args: ['10', '5', 'btc', 'asset-1'],
      expectedArgs: [{ limit: '10', offset: '5', search: 'btc', assetId: 'asset-1' }],
    },
    {
      label: 'funds scheduler config',
      controller: new FundsSchedulerController(),
      serviceProperty: 'fundsSchedulerService',
      serviceMethod: 'getSchedulerConfig',
      controllerMethod: 'getConfig',
      expectedArgs: ['user-1'],
    },
    {
      label: 'funds scheduler update config',
      controller: new FundsSchedulerController(),
      serviceProperty: 'fundsSchedulerService',
      serviceMethod: 'updateSchedulerConfig',
      controllerMethod: 'updateConfig',
      args: [{ enabled: true, retentionDays: 14 }],
      expectedArgs: ['user-1', { enabled: true, retentionDays: 14 }],
    },
    {
      label: 'funds scheduler run now',
      controller: new FundsSchedulerController(),
      serviceProperty: 'fundsSchedulerService',
      serviceMethod: 'runNow',
      controllerMethod: 'runNow',
      args: [{ accountId: 'account-1', brokerKey: 'mudrex' }],
      expectedArgs: ['user-1', { accountId: 'account-1', brokerKey: 'mudrex' }],
    },
    {
      label: 'funds scheduler pause',
      controller: new FundsSchedulerController(),
      serviceProperty: 'fundsSchedulerService',
      serviceMethod: 'pauseScheduler',
      controllerMethod: 'pause',
      expectedArgs: ['user-1'],
    },
    {
      label: 'funds scheduler resume',
      controller: new FundsSchedulerController(),
      serviceProperty: 'fundsSchedulerService',
      serviceMethod: 'resumeScheduler',
      controllerMethod: 'resume',
      expectedArgs: ['user-1'],
    },
    {
      label: 'funds scheduler stop',
      controller: new FundsSchedulerController(),
      serviceProperty: 'fundsSchedulerService',
      serviceMethod: 'stopScheduler',
      controllerMethod: 'stop',
      expectedArgs: ['user-1'],
    },
    {
      label: 'funds scheduler restart',
      controller: new FundsSchedulerController(),
      serviceProperty: 'fundsSchedulerService',
      serviceMethod: 'restartScheduler',
      controllerMethod: 'restart',
      expectedArgs: ['user-1'],
    },
    {
      label: 'funds scheduler purge logs',
      controller: new FundsSchedulerController(),
      serviceProperty: 'fundsSchedulerService',
      serviceMethod: 'purgeSchedulerLogs',
      controllerMethod: 'purgeLogs',
      expectedArgs: ['user-1'],
    },
    {
      label: 'funds scheduler purge preview',
      controller: new FundsSchedulerController(),
      serviceProperty: 'fundsSchedulerService',
      serviceMethod: 'getSchedulerPurgePreview',
      controllerMethod: 'purgeLogsPreview',
      expectedArgs: ['user-1'],
    },
    {
      label: 'funds scheduler summary',
      controller: new FundsSchedulerController(),
      serviceProperty: 'fundsSchedulerService',
      serviceMethod: 'getSchedulerDiagnosticsSummary',
      controllerMethod: 'getSummary',
      expectedArgs: ['user-1'],
    },
    {
      label: 'funds scheduler coverage',
      controller: new FundsSchedulerController(),
      serviceProperty: 'fundsSchedulerService',
      serviceMethod: 'listSchedulerCoverage',
      controllerMethod: 'listCoverage',
      args: ['10', '5', 'account-1', 'mudrex', 'stale', 'failed'],
      expectedArgs: [
        'user-1',
        {
          limit: '10',
          offset: '5',
          accountId: 'account-1',
          brokerKey: 'mudrex',
          freshnessState: 'stale',
          latestFetchStatus: 'failed',
        },
      ],
    },
    {
      label: 'funds scheduler runs',
      controller: new FundsSchedulerController(),
      serviceProperty: 'fundsSchedulerService',
      serviceMethod: 'listSchedulerRuns',
      controllerMethod: 'listRuns',
      args: ['10', '5'],
      expectedArgs: ['user-1', { limit: '10', offset: '5' }],
    },
    {
      label: 'funds scheduler run progress',
      controller: new FundsSchedulerController(),
      serviceProperty: 'fundsSchedulerService',
      serviceMethod: 'getSchedulerRunProgress',
      controllerMethod: 'getRunProgress',
      args: ['run-1'],
      expectedArgs: ['user-1', 'run-1'],
    },
    {
      label: 'funds scheduler run updates',
      controller: new FundsSchedulerController(),
      serviceProperty: 'fundsSchedulerService',
      serviceMethod: 'listSchedulerRunUpdates',
      controllerMethod: 'listRunUpdates',
      args: ['run-1', '10', '5', 'create', 'broker_runtime', 'BTC', 'createdAt', 'desc'],
      expectedArgs: [
        'user-1',
        'run-1',
        {
          limit: '10',
          offset: '5',
          actionType: 'create',
          source: 'broker_runtime',
          symbol: 'BTC',
          sortBy: 'createdAt',
          sortOrder: 'desc',
        },
      ],
    },
    {
      label: 'funds scheduler run updates export',
      controller: new FundsSchedulerController(),
      serviceProperty: 'fundsSchedulerService',
      serviceMethod: 'exportSchedulerRunUpdates',
      controllerMethod: 'exportRunUpdates',
      args: ['run-1', 'create', 'broker_runtime', 'BTC', 'createdAt', 'desc'],
      expectedArgs: [
        'user-1',
        'run-1',
        {
          actionType: 'create',
          source: 'broker_runtime',
          symbol: 'BTC',
          sortBy: 'createdAt',
          sortOrder: 'desc',
        },
      ],
    },
    {
      label: 'health check scheduler config',
      controller: new HealthCheckSchedulerController(),
      serviceProperty: 'healthCheckSchedulerService',
      serviceMethod: 'getSchedulerConfig',
      controllerMethod: 'getConfig',
      expectedArgs: ['user-1'],
    },
    {
      label: 'orders scheduler config',
      controller: new OrdersSchedulerController(),
      serviceProperty: 'ordersSchedulerService',
      serviceMethod: 'getSchedulerConfig',
      controllerMethod: 'getConfig',
      expectedArgs: ['user-1'],
    },
    {
      label: 'positions scheduler config',
      controller: new PositionsSchedulerController(),
      serviceProperty: 'positionsSchedulerService',
      serviceMethod: 'getSchedulerConfig',
      controllerMethod: 'getConfig',
      expectedArgs: ['user-1'],
    },
    {
      label: 'risk scheduler config',
      controller: new RiskSchedulerController(),
      serviceProperty: 'riskSchedulerService',
      serviceMethod: 'getSchedulerConfig',
      controllerMethod: 'getConfig',
      expectedArgs: ['user-1'],
    },
    {
      label: 'risk scheduler summary',
      controller: new RiskSchedulerController(),
      serviceProperty: 'riskSchedulerService',
      serviceMethod: 'getSchedulerDiagnosticsSummary',
      controllerMethod: 'getSummary',
      expectedArgs: ['user-1'],
    },
    {
      label: 'signals automation config',
      controller: new SignalsAutomationController(),
      serviceProperty: 'signalsAutomationService',
      serviceMethod: 'getSchedulerConfig',
      controllerMethod: 'getConfig',
      expectedArgs: ['user-1'],
      authMode: 'user',
    },
  ];

  for (const testCase of schedulerCases) {
    const calls: unknown[][] = [];
    testCase.controller[testCase.serviceProperty] = {
      [testCase.serviceMethod]: async (...args: unknown[]) => {
        calls.push(args);
        return createSuccess({ args });
      },
    };

    if (testCase.authMode === 'user') {
      await assertAuthRequired(() =>
        testCase.controller[testCase.controllerMethod](unauthReq, ...(testCase.args || []))
      );
      assert.equal(
        calls.length,
        0,
        `${testCase.label} should not call the service for unauthenticated users`
      );

      const response = await testCase.controller[testCase.controllerMethod](
        authReq,
        ...(testCase.args || [])
      );
      assert.deepEqual(
        response.data.args,
        testCase.expectedArgs,
        `${testCase.label} should pass signed-in args through`
      );
      assert.equal(
        calls.length,
        1,
        `${testCase.label} should call the service exactly once for signed-in users`
      );
      continue;
    }

    await assertAdminRoleRequired(() =>
      testCase.controller[testCase.controllerMethod](authReq, ...(testCase.args || []))
    );
    assert.equal(
      calls.length,
      0,
      `${testCase.label} should not call the service for non-admin users`
    );

    const response = await testCase.controller[testCase.controllerMethod](
      adminAuthReq,
      ...(testCase.args || [])
    );
    assert.deepEqual(
      response.data.args,
      testCase.expectedArgs,
      `${testCase.label} should pass admin args through`
    );
    assert.equal(
      calls.length,
      1,
      `${testCase.label} should call the service exactly once for admins`
    );
  }
}

async function runActivityStream(): Promise<void> {
  await runSignalsControllerAssertions();
  await runSignalsOverviewControllerAssertions();
  await runInternalFundsSchedulerControllerAssertions();
  await runInternalSignalsSchedulerControllerAssertions();
  await runSuggestedTradesControllerAssertions();
  await runSuggestedTradesOverviewControllerAssertions();
  await runAutomationsControllerAssertions();
  await runDiscoveryControllerAssertions();
  await runSchedulerControllerAuthAssertions();
  await runBacktestsControllerAssertions();
  await runOrdersControllerAssertions();
  await runOrdersOverviewControllerAssertions();
  await runWatchlistsControllerAssertions();
  await runMarketControllerAssertions();
  await runPortfolioControllerAssertions();
  await runStrategyLabControllerAssertions();
  await runStrategyLibraryControllerAssertions();
  await runRiskControllerAssertions();
  await runPositionsControllerAssertions();
  await runActivityControllerAssertions();
  await runAlertsControllerAssertions();
  await runConnectionsControllerAssertions();
  await runSettingsControllerAssertions();
  await runEmailDeliveriesControllerAssertions();
  await runHealthControllerAssertions();
  await runBrokerDefinitionsControllerAssertions();
  await runStrategyControllerAssertions();
  await runStrategyTemplatesControllerAssertions();

  console.log(
    'Controller assertions passed for signals, signals automation, internal funds scheduler, internal signals scheduler, signals overview, suggested trades, suggested trades overview, automations, discovery, scheduler auth, backtests, orders, orders overview, watchlists, market, portfolio, strategy lab, strategy templates, risk, positions, activity, alerts, connections, broker definitions, settings, and strategy.'
  );
}

runActivityStream().catch((error) => {
  console.error('Controller assertion failure:', error);
  process.exit(1);
});
