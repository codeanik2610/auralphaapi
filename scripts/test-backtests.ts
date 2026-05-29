import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { BacktestsController } from '../src/api/controllers/BacktestsController';
import { BacktestChartService } from '../src/api/services/BacktestChartService';
import { BacktestPromotionService } from '../src/api/services/BacktestPromotionService';
import { BacktestReadModelService } from '../src/api/services/BacktestReadModelService';
import { BacktestRecoveryService } from '../src/api/services/BacktestRecoveryService';
import { BacktestSnapshotService } from '../src/api/services/BacktestSnapshotService';
import { BacktestTopSetupsService } from '../src/api/services/BacktestTopSetupsService';
import { BacktestsService } from '../src/api/services/BacktestsService';
import type { BacktestPromotionRules } from '../src/api/contracts/Settings';
import { buildSignedSchedulerHeaders } from '../src/api/utils/schedulerRequestAuth';
import { createDefaultBacktestPromotionRules } from '../src/api/utils/backtestPromotionRules';
import { validateUpdateBacktestResultBody } from '../src/api/validators/backtests.validator';
import { strategyDataSource } from '../src/database/pg-data-source';
import { BacktestRepository } from '../src/database/repositories/BacktestRepository';
import { RedisClient } from '../src/lib/RedisClient';

function createSuccess<T>(data: T) {
  return { success: true as const, data };
}

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function createBacktestsService(): any {
  const service = new BacktestsService() as any;
  service.backtestReadModelService = new BacktestReadModelService();
  service.appSettingsRepository = {
    async getSettings() {
      return null;
    },
  };
  return service;
}

function createOperationalMock() {
  const activityCalls: Array<{ userId: string; payload: Record<string, unknown> }> = [];
  const alertCalls: Array<{ userId: string; payload: Record<string, unknown> }> = [];

  return {
    activityCalls,
    alertCalls,
    service: {
      async logActivity(userId: string, payload: Record<string, unknown>) {
        activityCalls.push({ userId, payload });
      },
      async emitFailureAlert(userId: string, payload: Record<string, unknown>) {
        alertCalls.push({ userId, payload });
      },
    },
  };
}

const authReq = { authUser: { sub: 'user-1' } } as any;

async function runBacktestsControllerAssertions(): Promise<void> {
  const controller: any = new BacktestsController();

  controller.backtestsService = {
    getBacktests: async (...args: unknown[]) => createSuccess({ args }),
    getBacktestsSummary: async (...args: unknown[]) => createSuccess({ args }),
    getTopSetups: async (...args: unknown[]) => createSuccess({ args }),
    getBacktestById: async (...args: unknown[]) => createSuccess({ args }),
    getBacktestInputSnapshot: async (...args: unknown[]) => createSuccess({ args }),
    getBacktestChart: async (...args: unknown[]) => createSuccess({ args }),
    createBacktest: async (...args: unknown[]) => createSuccess({ args }),
    updateBacktestResults: async (...args: unknown[]) => createSuccess({ args }),
    recoverBacktestFromCheckpoint: async (...args: unknown[]) => createSuccess({ args }),
    syncBacktestAutomationLifecycle: async (...args: unknown[]) => createSuccess({ args }),
    promoteBacktestToAutomation: async (...args: unknown[]) => createSuccess({ args }),
    promoteBacktestBatchToAutomation: async (...args: unknown[]) => createSuccess({ args }),
  };

  assert.deepEqual(
    (await controller.getBacktests(authReq, undefined, undefined, 'Stable', 'BTC')).data.args,
    ['user-1', { limit: undefined, offset: undefined, status: 'Stable', search: 'BTC' }]
  );
  assert.deepEqual((await controller.getBacktestsSummary(authReq)).data.args, ['user-1']);
  assert.deepEqual(
    (await controller.getTopSetups(authReq, '24', '5', 'Momentum', '1h', '0.8', '9', 'true')).data
      .args,
    [
      'user-1',
      {
        limit: '24',
        offset: '5',
        search: 'Momentum',
        timeframe: '1h',
        minScore: '0.8',
        minTrades: '9',
        eligibleOnly: 'true',
      },
    ]
  );
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

  const createBody = { universe: 'Momentum', benchmark: 'BTCUSDT' };
  assert.deepEqual((await controller.createBacktest(authReq, createBody)).data.args, [
    'user-1',
    createBody,
  ]);

  const updateBody = {
    runStatus: 'Completed',
    assessmentStatus: 'Review',
    trades: 10,
  };
  assert.deepEqual(
    (await controller.updateBacktestResults(authReq, 'bt-1', updateBody)).data.args,
    ['user-1', 'bt-1', updateBody]
  );
  assert.deepEqual((await controller.recoverBacktestFromCheckpoint(authReq, 'bt-1')).data.args, [
    'user-1',
    'bt-1',
  ]);
  assert.deepEqual(
    (await controller.promoteBacktestToAutomation(authReq, 'bt-1', { status: 'Draft' })).data.args,
    ['user-1', 'bt-1', { status: 'Draft' }]
  );
  assert.deepEqual(
    (
      await controller.promoteBacktestBatchToAutomation(authReq, 'bt-1', {
        status: 'Running',
        items: [{ symbol: 'BTCUSDT', timeframe: '1h' }],
      })
    ).data.args,
    ['user-1', 'bt-1', { status: 'Running', items: [{ symbol: 'BTCUSDT', timeframe: '1h' }] }]
  );

  const originalGetConnection = RedisClient.getConnection;
  (RedisClient as any).getConnection = () => ({
    set: async () => 'OK',
  });

  try {
    const signedHeaders = buildSignedSchedulerHeaders({
      method: 'POST',
      url: '/api/v1/backtests/bt-1/automation-sync',
    });
    const headerMap = new Map(
      Object.entries(signedHeaders).map(([key, value]) => [key.toLowerCase(), value])
    );
    const signedRequest = {
      method: 'POST',
      originalUrl: '/api/v1/backtests/bt-1/automation-sync',
      url: '/api/v1/backtests/bt-1/automation-sync',
      header(name: string) {
        return headerMap.get(name.toLowerCase());
      },
      ip: '127.0.0.1',
      socket: { remoteAddress: '127.0.0.1' },
    } as any;

    assert.deepEqual(
      (await controller.syncBacktestAutomationLifecycle(signedRequest, 'bt-1')).data.args,
      ['bt-1']
    );
  } finally {
    (RedisClient as any).getConnection = originalGetConnection;
  }
}

async function runBacktestsOperationalAssertions(): Promise<void> {
  const service = createBacktestsService();
  const operational = createOperationalMock();

  service.operationalEventService = operational.service;
  service.backtestRepository = {
    async createQueuedBacktest() {
      return {
        id: 'bt-1',
        name: 'Momentum 1h',
        symbol: 'BTCUSDT',
        status: 'Queued',
        createdAt: new Date('2026-04-04T08:00:00.000Z'),
      };
    },
  };

  const response = await service.createBacktest('user-1', {
    universe: 'Momentum',
    interval: '1h',
    capital: '10000',
    fees: '0.02',
    slippage: '0.05',
    dateRange: '90d',
    benchmark: 'BTCUSDT',
    includeExtended: true,
    usePaperGate: false,
  });

  assert.equal(response.data.message, 'Backtest created');
  assert.equal(response.data.backtest.id, 'bt-1');
  assert.equal(response.data.backtest.status, 'Queued');
  assert.equal(operational.activityCalls.length, 1);
  assert.equal(operational.alertCalls.length, 0);
  assert.equal(operational.activityCalls[0].payload.title, 'Backtest created: Momentum 1h');
}

function runBacktestStatusMappingAssertions(): void {
  const service = new BacktestReadModelService() as any;
  const stableMapped = service.mapBacktest({
    id: 'backtest-status-1',
    name: 'Stable Run',
    strategy: 'Momentum Core',
    symbol: 'BTCUSDT',
    parameter: 'Momentum Core | BTCUSDT | 1h',
    status: 'Stable',
    stability: null,
    trades: 12,
    result: {
      cagr: 12.3,
      sharpe: 1.45,
      drawdown: 8.1,
      winRate: 57,
      profitFactor: 1.7,
      config: null,
    },
    createdAt: new Date('2026-04-02T00:00:00.000Z'),
  });

  assert.equal(stableMapped.status, 'Stable');
  assert.equal(stableMapped.runStatus, 'Completed');
  assert.equal(stableMapped.assessmentStatus, 'Stable');
  assert.equal(stableMapped.stability, 'Stable');
  assert.equal(stableMapped.lineage, null);

  const runningMapped = service.mapBacktest({
    id: 'backtest-status-2',
    name: 'Queued Run',
    strategy: 'Breakout Core',
    symbol: 'ETHUSDT',
    parameter: 'Breakout Core | ETHUSDT | 15m',
    status: 'Running',
    stability: 'Queued',
    trades: 0,
    result: {
      cagr: null,
      sharpe: null,
      drawdown: null,
      winRate: null,
      profitFactor: null,
      config: null,
    },
    createdAt: new Date('2026-04-02T00:00:00.000Z'),
  });

  assert.equal(runningMapped.runStatus, 'Running');
  assert.equal(runningMapped.assessmentStatus, '--');
  assert.equal(runningMapped.stability, '--');

  const diffMapped = service.mapBacktest({
    id: 'backtest-status-3',
    name: 'Diff Run',
    strategy: 'Momentum Core',
    symbol: 'SOLUSDT',
    parameter: 'Momentum Core | SOLUSDT | 15m',
    status: 'Completed',
    stability: 'Stable',
    trades: 5,
    result: {
      cagr: 7.2,
      sharpe: 1.2,
      drawdown: 4.5,
      winRate: 55,
      profitFactor: 1.4,
      config: {
        inputSnapshot: {
          templateDiffSummary: {
            changedCount: 3,
            inheritedCount: 9,
            changedFields: ['Long entry logic', 'Max risk', 'AI filter'],
          },
        },
      },
    },
    createdAt: new Date('2026-04-02T00:00:00.000Z'),
  });

  assert.equal(diffMapped.templateDiffSummary?.changedCount, 3);
  assert.equal(diffMapped.lineage?.templateDiffSummary?.changedFields?.[0], 'Long entry logic');

  const validated = validateUpdateBacktestResultBody({
    runStatus: 'Completed',
    assessmentStatus: 'Review',
    trades: 10,
  });
  assert.equal(validated.status, 'Completed');
  assert.equal(validated.stability, 'Review');
}

async function runBacktestChartServiceAssertions(): Promise<void> {
  const service = new BacktestChartService() as any;
  const backtest = {
    id: 'backtest-chart-1',
    userId: 'user-1',
    name: 'Chart Coverage',
    strategy: 'Momentum Core',
    symbol: 'BTCUSDT',
    parameter: 'Momentum Core / BTCUSDT / 1h',
    status: 'Completed',
    stability: 'Stable',
    trades: 3,
    createdAt: new Date('2026-04-03T10:00:00.000Z'),
    updatedAt: new Date('2026-04-03T10:10:00.000Z'),
    result: {
      config: {
        inputSnapshot: {
          start: '2026-04-01T00:00:00.000Z',
          end: '2026-04-03T00:00:00.000Z',
        },
        performanceSurface: {
          results: [
            { symbol: 'BTCUSDT', timeframe: '1h', total_trades: 5 },
            { symbol: 'ETHUSDT', timeframe: '1h', total_trades: 8 },
          ],
        },
      },
    },
  };

  service.backtestRepository = {
    getBacktestById: async (userId: string, backtestId: string) => {
      assert.equal(userId, 'user-1');
      assert.equal(backtestId, 'backtest-chart-1');
      return backtest;
    },
  };
  service.backtestTradeRepository = {
    listTrades: async (params: Record<string, unknown>) => {
      assert.deepEqual(params, {
        userId: 'user-1',
        backtestId: 'backtest-chart-1',
        symbol: 'BTCUSDT',
        interval: '1h',
      });
      return [
        {
          id: 'trade-1',
          symbol: 'BTCUSDT',
          interval: '1h',
          side: 'BUY',
          entryTime: new Date('2026-04-01T04:00:00.000Z'),
          entryPrice: '100.5',
          exitTime: new Date('2026-04-01T06:00:00.000Z'),
          exitPrice: '105.5',
        },
        {
          id: 'trade-2',
          symbol: 'BTCUSDT',
          interval: '1h',
          side: 'SELL',
          entryTime: new Date('2026-04-02T10:00:00.000Z'),
          entryPrice: '110.25',
          exitTime: null,
          exitPrice: null,
        },
        {
          id: 'trade-3',
          symbol: 'BTCUSDT',
          interval: '1h',
          side: 'BUY',
          entryTime: new Date('2026-03-20T10:00:00.000Z'),
          entryPrice: '90',
          exitTime: new Date('2026-03-20T12:00:00.000Z'),
          exitPrice: '93',
        },
      ];
    },
  };
  service.fetchCandles = async (
    symbol: string,
    intervalSeconds: number,
    window: { startTime: Date | null; lookbackDays: number; endTime: Date },
    limit?: number
  ) => {
    assert.equal(symbol, 'BTCUSDT');
    assert.equal(intervalSeconds, 3600);
    assert.equal(window.startTime?.toISOString(), '2026-04-01T00:00:00.000Z');
    assert.equal(window.endTime.toISOString(), '2026-04-03T00:00:00.000Z');
    assert.equal(window.lookbackDays, 2);
    assert.equal(limit, 250);
    return [
      {
        openTime: Date.parse('2026-04-01T00:00:00.000Z'),
        open: '100',
        high: '110',
        low: '95',
        close: '108',
        volume: '1000',
      },
    ];
  };

  const response = await service.getBacktestChart('user-1', 'backtest-chart-1', {
    symbol: 'btcusdt',
    interval: '1h',
    limit: '250',
  });

  assert.equal(response.data.symbol, 'BTCUSDT');
  assert.equal(response.data.interval, '1h');
  assert.equal(response.data.tradeCoverage.expectedTradeEvents, 5);
  assert.equal(response.data.tradeCoverage.storedTradeEvents, 3);
  assert.equal(response.data.tradeCoverage.chartTradeEvents, 2);
  assert.equal(response.data.tradeCoverage.missingTradeEvents, 2);
  assert.equal(response.data.tradeCoverage.hasIncompleteTradeHistory, true);
  assert.equal(response.data.trades.length, 2);
}

async function runBacktestChartWarehouseSymbolResolutionAssertions(): Promise<void> {
  const service = new BacktestChartService() as any;
  const originalQuery = strategyDataSource.query.bind(strategyDataSource);
  const originalInitialized = strategyDataSource.isInitialized;
  const capturedQueries: Array<{ sql: string; params: unknown[] }> = [];

  (strategyDataSource as any).isInitialized = true;
  (strategyDataSource as any).query = async (sql: string, params: unknown[]) => {
    capturedQueries.push({ sql, params });
    return [{ symbol: 'PAXGUSDT' }];
  };

  try {
    const resolved = await service.resolveWarehouseSymbol(
      'PAXGUSD',
      new Date('2026-04-13T23:59:59.999Z')
    );

    assert.equal(resolved, 'PAXGUSDT');
    assert.equal(capturedQueries.length, 1);
    assert.match(capturedQueries[0].sql, /symbol = ANY/);
    assert.deepEqual(capturedQueries[0].params, [
      ['PAXGUSD', 'PAXGUSDT'],
      new Date('2026-04-13T23:59:59.999Z'),
      'PAXGUSD',
    ]);
  } finally {
    (strategyDataSource as any).query = originalQuery;
    (strategyDataSource as any).isInitialized = originalInitialized;
  }
}

async function runBacktestRepositorySearchAssertions(): Promise<void> {
  const repository = new BacktestRepository();
  const originalGetRepository = strategyDataSource.getRepository.bind(strategyDataSource);
  const capturedWhereClauses: Array<{ clause: string; params?: Record<string, unknown> }> = [];
  const builder = {
    leftJoinAndSelect() {
      return this;
    },
    where(clause: string, params?: Record<string, unknown>) {
      capturedWhereClauses.push({ clause, params });
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
    andWhere(clause: string, params?: Record<string, unknown>) {
      capturedWhereClauses.push({ clause, params });
      return this;
    },
    async getManyAndCount() {
      return [[], 0] as const;
    },
  };

  (strategyDataSource as any).getRepository = () => ({
    createQueryBuilder: () => builder,
  });

  try {
    const response = await repository.listBacktests('user-1', {
      limit: 20,
      offset: 5,
      status: 'Failed',
      search: ' BTC_100% ',
    });

    assert.equal(response.total, 0);
    assert.equal(capturedWhereClauses.length, 3);
    assert.equal(capturedWhereClauses[0].clause, 'backtest.userId = :userId');
    assert.deepEqual(capturedWhereClauses[1], {
      clause: 'backtest.status = :status',
      params: { status: 'Failed' },
    });
    assert.deepEqual(capturedWhereClauses[2]?.params, {
      search: '%btc\\_100\\%%',
    });
  } finally {
    (strategyDataSource as any).getRepository = originalGetRepository;
  }
}

async function runBacktestTopSetupCandidateQueryAssertions(): Promise<void> {
  const repository = new BacktestRepository();
  const originalGetRepository = strategyDataSource.getRepository.bind(strategyDataSource);
  const capturedWhereClauses: Array<{ clause: string; params?: Record<string, unknown> }> = [];
  const builder = {
    leftJoinAndSelect() {
      return this;
    },
    where(clause: string, params?: Record<string, unknown>) {
      capturedWhereClauses.push({ clause, params });
      return this;
    },
    andWhere(clause: string, params?: Record<string, unknown>) {
      capturedWhereClauses.push({ clause, params });
      return this;
    },
    orderBy() {
      return this;
    },
    async getMany() {
      return [];
    },
  };

  (strategyDataSource as any).getRepository = () => ({
    createQueryBuilder: () => builder,
  });

  try {
    const response = await repository.listTopSetupCandidateBacktests('user-99', {
      timeframe: '4h',
      minScore: 0.8,
      minTrades: 9,
      search: ' Momentum_100% ',
    });

    assert.deepEqual(response, []);
    assert.equal(capturedWhereClauses[0].clause, 'backtest.userId = :userId');
    assert.deepEqual(capturedWhereClauses[0].params, { userId: 'user-99' });
    assert.equal(
      capturedWhereClauses[2].clause,
      "LOWER(COALESCE(backtest.status, '')) IN (:...completedStatuses)"
    );
    assert.match(capturedWhereClauses[3].clause, /jsonb_array_length/);
    assert.equal(capturedWhereClauses.length, 4);
  } finally {
    (strategyDataSource as any).getRepository = originalGetRepository;
  }
}

async function runBacktestSummaryQueryAssertions(): Promise<void> {
  const repository = new BacktestRepository();
  const originalQuery = strategyDataSource.query.bind(strategyDataSource);
  let capturedSql = '';
  let capturedParams: unknown[] = [];

  (strategyDataSource as any).query = async (sql: string, params: unknown[]) => {
    capturedSql = sql;
    capturedParams = params;
    return [
      {
        active_runs: '3',
        best_cagr: '17.8',
        best_cagr_label: 'Momentum Core / BTCUSDT',
        best_sharpe: '1.66',
        max_drawdown: '9.4',
      },
    ];
  };

  try {
    const summary = await repository.getBacktestsSummary('user-summary-1');

    assert.equal(summary.activeRuns, 3);
    assert.equal(summary.bestCagr, 17.8);
    assert.equal(summary.bestSharpe, 1.66);
    assert.equal(summary.maxDrawdown, 9.4);
    assert.deepEqual(capturedParams, ['user-summary-1']);
    assert.match(capturedSql, /WITH scoped_backtests AS/);
    assert.match(capturedSql, /best_cagr AS/);
    assert.match(capturedSql, /best_sharpe AS/);
    assert.match(capturedSql, /max_drawdown AS/);
  } finally {
    (strategyDataSource as any).query = originalQuery;
  }
}

function runBacktestOperationalColumnExtractionAssertions(): void {
  const repository = new BacktestRepository() as any;

  const populated = repository.buildOperationalResultColumns({
    tradeEventCount: '24',
    progress: {
      state: 'running',
      processed: '7',
      total: 18,
      percent: '38.9',
    },
    resumeCheckpoint: {
      state: 'failed',
    },
    performanceSurface: {
      results: [{ symbol: 'BTCUSDT' }, { symbol: 'ETHUSDT' }],
    },
  });

  assert.deepEqual(populated, {
    progressState: 'running',
    progressProcessed: 7,
    progressTotal: 18,
    progressPercent: 38.9,
    resumeCheckpointState: 'failed',
    tradeEventCount: 24,
    performanceSurfaceResultCount: 2,
  });

  assert.deepEqual(repository.buildOperationalResultColumns(null), {
    progressState: null,
    progressProcessed: null,
    progressTotal: null,
    progressPercent: null,
    resumeCheckpointState: null,
    tradeEventCount: null,
    performanceSurfaceResultCount: null,
  });
}

async function runBacktestChartDelegationAssertions(): Promise<void> {
  const service = createBacktestsService();
  const capturedCalls: unknown[][] = [];

  service.backtestChartService = {
    getBacktestChart: async (...args: unknown[]) => {
      capturedCalls.push(args);
      return {
        success: true as const,
        data: {
          symbol: 'BTCUSDT',
          interval: '1h',
          window: {
            startTime: null,
            endTime: '2026-04-04T00:00:00.000Z',
            lookbackDays: 90,
          },
          candles: [],
          trades: [],
          tradeCoverage: {
            symbol: 'BTCUSDT',
            interval: '1h',
            expectedTradeEvents: null,
            storedTradeEvents: 0,
            chartTradeEvents: 0,
            missingTradeEvents: null,
            hasIncompleteTradeHistory: false,
          },
        },
      };
    },
  };

  const response = await service.getBacktestChart('user-1', 'backtest-1', {
    symbol: 'BTCUSDT',
    interval: '1h',
  });

  assert.deepEqual(capturedCalls, [
    ['user-1', 'backtest-1', { symbol: 'BTCUSDT', interval: '1h' }],
  ]);
  assert.equal(response.data.tradeCoverage.storedTradeEvents, 0);
}

function runBacktestTopSetupsServiceAssertions(): void {
  const service = new BacktestTopSetupsService();
  const primaryBacktest = {
    id: 'backtest-top-1',
    name: 'Momentum Winner',
    strategy: 'Momentum Core',
    symbol: 'BTCUSDT',
    parameter: 'Momentum Core / BTCUSDT / 1h',
    runStatus: 'Completed',
    sourceType: 'strategy_library',
    sourceId: 'library-1',
    libraryId: 'library-1',
    templateId: 'template-1',
    templateName: 'Momentum Template',
    templateVersion: 3,
    hasIncompleteTradeHistory: false,
    createdAt: '2026-04-05T00:00:00.000Z',
    performanceSurface: {
      generatedAt: '2026-04-05T00:15:00.000Z',
      results: [
        {
          symbol: 'BTCUSDT',
          timeframe: '1h',
          score: 0.91,
          total_trades: 12,
          win_rate: 58,
          profit_factor: 1.84,
          total_return_pct: 14.2,
          max_drawdown_pct: 5.1,
          robustness: {
            evaluationMethod: 'walk-forward-multi-split',
            robustnessScore: 0.88,
            walkForwardPassRate: 0.72,
            outOfSampleReturnPct: 9.1,
            averageOutOfSampleReturnPct: 8.4,
            worstOutOfSampleReturnPct: 2.2,
            promotionReady: true,
            reasons: [],
          },
          portfolioPressure: {
            pressureScore: 0.93,
            executedTradeRatio: 0.84,
            pressureState: 'healthy',
          },
        },
        {
          symbol: 'ETHUSDT',
          timeframe: '4h',
          score: 0.42,
          total_trades: 3,
          win_rate: 49,
          profit_factor: 1.1,
          total_return_pct: 3.8,
          max_drawdown_pct: 8.7,
        },
      ],
    },
  } as any;
  const duplicateBacktest = {
    ...primaryBacktest,
    id: 'backtest-top-2',
    name: 'Momentum Runner-Up',
    createdAt: '2026-04-04T00:00:00.000Z',
    performanceSurface: {
      generatedAt: '2026-04-04T00:15:00.000Z',
      results: [
        {
          symbol: 'BTCUSDT',
          timeframe: '1h',
          score: 0.73,
          total_trades: 9,
          win_rate: 54,
          profit_factor: 1.46,
          total_return_pct: 8.9,
          max_drawdown_pct: 6.4,
          robustness: {
            evaluationMethod: 'walk-forward-multi-split',
            robustnessScore: 0.74,
            walkForwardPassRate: 0.61,
            outOfSampleReturnPct: 5.4,
            averageOutOfSampleReturnPct: 5.1,
            worstOutOfSampleReturnPct: 1.2,
            promotionReady: true,
            reasons: [],
          },
          portfolioPressure: {
            pressureScore: 0.82,
            executedTradeRatio: 0.78,
            pressureState: 'moderate-pressure',
          },
        },
      ],
    },
  } as any;
  const reviewBacktest = {
    ...primaryBacktest,
    id: 'backtest-top-review',
    name: 'Dog Review Candidate',
    status: 'Review',
    assessmentStatus: 'Review',
    symbol: 'DOGEUSD',
    parameter: 'Alert Confirm / DOGEUSD / 15m',
    performanceSurface: {
      generatedAt: '2026-04-05T00:30:00.000Z',
      results: [
        {
          symbol: 'DOGEUSD',
          timeframe: '15m',
          score: 0.5469,
          total_trades: 4,
          win_rate: 52,
          profit_factor: 1.21,
          total_return_pct: 6.2,
          max_drawdown_pct: 8.4,
        },
      ],
    },
  } as any;

  const ranked = service.rankBacktestTopSetups(primaryBacktest);
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].symbol, 'BTCUSDT');
  assert.equal(ranked[0].eligibleForAutomation, true);
  assert.equal(ranked[0].lineage?.libraryId, 'library-1');
  assert.equal(ranked[1].eligibleForAutomation, false);
  assert.deepEqual(ranked[1].automationEligibilityReasons, [
    'low-score',
    'low-trade-count',
    'missing-robustness-validation',
  ]);

  const relaxedRanked = service.rankBacktestTopSetups(primaryBacktest, {
    ...createDefaultBacktestPromotionRules(),
    minScore: 0.4,
    minTrades: 3,
    requireRobustness: false,
  });
  const relaxedEthSetup = relaxedRanked.find((item) => item.symbol === 'ETHUSDT');
  assert.equal(relaxedEthSetup?.eligibleForAutomation, true);

  const response = service.buildResponse([primaryBacktest, duplicateBacktest], {
    limit: '10',
    offset: '0',
    eligibleOnly: 'true',
  });
  assert.equal(response.total, 1);
  assert.equal(response.items[0].backtestId, 'backtest-top-1');

  const limitedResponse = service.buildResponse([primaryBacktest, duplicateBacktest], {
    limit: '1',
    offset: '0',
  });
  assert.equal(limitedResponse.total, 2);
  assert.equal(limitedResponse.items.length, 1);

  const allResponse = service.buildResponse([primaryBacktest, duplicateBacktest], {
    limit: 'all',
    offset: '0',
  });
  assert.equal(allResponse.total, 2);
  assert.equal(allResponse.items.length, 2);
  assert.equal(allResponse.limit, 2);

  const dogResponse = service.buildResponse([reviewBacktest], {
    limit: '10',
    offset: '0',
    search: 'DOG',
  });
  assert.equal(dogResponse.total, 1);
  assert.equal(dogResponse.items[0]?.symbol, 'DOGEUSD');
}

async function runBacktestTopSetupsDelegationAssertions(): Promise<void> {
  const service = createBacktestsService();
  const capturedCalls: Array<{
    backtests: Record<string, unknown>[];
    query: Record<string, unknown>;
    promotionRules?: Record<string, unknown>;
  }> = [];
  const capturedRepositoryQueries: Array<Record<string, unknown>> = [];

  service.appSettingsRepository = {
    async getSettings() {
      return {
        backtestPromotionRules: {
          minScore: 0.82,
          minTrades: 7,
          requireRobustness: false,
        },
      };
    },
  };

  const backtest = {
    id: 'backtest-delegate-1',
    name: 'Delegated Top Setup',
    strategy: 'Momentum Core',
    symbol: 'BTCUSDT',
    parameter: 'Momentum Core / BTCUSDT / 1h',
    status: 'Completed',
    stability: 'Stable',
    trades: 12,
    createdAt: new Date('2026-04-05T00:00:00.000Z'),
    result: {
      cagr: 10.5,
      sharpe: 1.3,
      drawdown: 6.1,
      winRate: 57,
      profitFactor: 1.7,
      config: {
        sourceType: 'strategy_library',
        sourceId: 'library-1',
        libraryId: 'library-1',
        inputSnapshot: {
          templateId: 'template-7',
          templateName: 'Momentum Template',
          templateVersion: 7,
        },
        performanceSurface: {
          generatedAt: '2026-04-05T00:15:00.000Z',
          results: [],
        },
        tradeEventCount: 11,
      },
    },
  };

  service.backtestRepository = {
    listTopSetupCandidateBacktests: async (_userId: string, query: Record<string, unknown>) => {
      capturedRepositoryQueries.push(query);
      return [backtest];
    },
  };
  service.backtestTradeRepository = {
    getTradeCountsByBacktest: async () => new Map([[backtest.id, 9]]),
  };
  service.backtestTopSetupsService = {
    buildResponse: (
      mappedBacktests: Record<string, unknown>[],
      query: Record<string, unknown>,
      promotionRules?: Record<string, unknown>
    ) => {
      capturedCalls.push({ backtests: mappedBacktests, query, promotionRules });
      return { items: [], total: 0, limit: 5, offset: 0 };
    },
  };

  const response = await service.getTopSetups('user-1', {
    limit: 5,
    offset: 0,
    eligibleOnly: true,
  });

  assert.equal(response.data.total, 0);
  assert.equal(capturedRepositoryQueries[0].minTrades, undefined);
  assert.equal(capturedCalls[0].promotionRules?.minScore, 0.82);
  assert.equal(capturedCalls[0].promotionRules?.minTrades, 7);
  assert.equal(capturedCalls[0].promotionRules?.requireRobustness, false);
  assert.equal(capturedCalls[0].backtests[0].templateId, 'template-7');
  assert.equal(capturedCalls[0].query.minTrades, undefined);
}

async function runBacktestRecoveryServiceAssertions(): Promise<void> {
  const service = new BacktestRecoveryService();
  const backtest = {
    id: 'backtest-recovery-1',
    result: {
      config: {
        progress: {
          state: 'failed',
          processed: 4,
          total: 10,
          startedAt: '2026-04-02T10:00:00.000Z',
          failedCount: 1,
          resumedFromCheckpoint: 'false',
        },
        resumeCheckpoint: {
          state: 'failed',
          startedAt: '2026-04-02T10:00:00.000Z',
          lastUpdatedAt: '2026-04-02T10:10:00.000Z',
          completedCombinations: 6,
          totalCombinations: 12,
          tradeEventCount: 15,
          resumeCount: 2,
          resumedFromCheckpoint: true,
          resultsSummary: {
            okCount: 5,
            failedCount: 1,
            noDataCount: 0,
            skippedCount: 0,
          },
        },
      },
    },
  } as any;

  const plan = service.buildRecoveryPlan(backtest, 'Failed', new Date('2026-04-05T08:00:00.000Z'));

  assert.equal(plan.message, 'Backtest re-queued from checkpoint');
  assert.equal(plan.status, 'Queued');
  assert.equal(plan.stability, 'Queued');
  assert.equal((plan.nextConfig.progress as Record<string, unknown>).processed, 6);
  assert.equal((plan.nextConfig.progress as Record<string, unknown>).total, 12);
  assert.equal((plan.nextConfig.progress as Record<string, unknown>).percent, 50);
  assert.equal((plan.nextConfig.progress as Record<string, unknown>).resumeCount, 2);
}

async function runBacktestInputSnapshotServiceAssertions(): Promise<void> {
  const service = new BacktestSnapshotService() as any;
  const backtest = {
    id: 'backtest-snapshot-1',
    name: 'Momentum Snapshot',
    strategy: 'Momentum Core',
    symbol: 'BTCUSDT',
    parameter: 'Momentum Core / BTCUSDT / 1h',
    status: 'Failed',
    stability: 'Needs review',
    trades: 14,
    createdAt: new Date('2026-04-03T10:00:00.000Z'),
    result: {
      cagr: 12.4,
      sharpe: 1.42,
      drawdown: 8.6,
      winRate: 57,
      profitFactor: 1.68,
      config: {
        sourceType: 'strategy_library',
        sourceId: 'library-1',
        libraryId: 'library-1',
        market: 'crypto-futures',
        benchmark: 'BTCUSDT',
        inputSnapshot: {
          sourceType: 'strategy_library',
          sourceId: 'library-1',
          libraryId: 'library-1',
          templateId: 'template-9',
          templateName: 'Momentum Template',
          templateVersion: 4,
          start: '2026-02-01T00:00:00.000Z',
          end: '2026-04-01T23:59:59.999Z',
        },
        templateDiffSummary: {
          changedCount: 2,
          inheritedCount: 11,
          changedFields: ['Long entry logic', 'Max risk'],
        },
        executionAssumptions: {
          spreadPct: 0.05,
          latencyBars: 1,
          fillPolicy: 'conservative-stop-first',
        },
        progress: {
          state: 'failed',
          processed: 9,
          total: 24,
        },
        resumeCheckpoint: {
          state: 'failed',
          completedCombinations: 9,
          totalCombinations: 24,
        },
        performanceSurface: {
          generatedAt: '2026-04-03T11:00:00.000Z',
        },
        portfolioSummary: {
          peakConcurrentTrades: 3,
        },
        tradeEventCount: 88,
      },
    },
  };

  const mappedBacktest = {
    id: 'backtest-snapshot-1',
    name: 'Momentum Snapshot',
    strategy: 'Momentum Core',
    symbol: 'BTCUSDT',
    parameter: 'Momentum Core / BTCUSDT / 1h',
    cagr: '12.4%',
    sharpe: '1.42',
    drawdown: '8.6%',
    trades: 14,
    status: 'Failed',
    runStatus: 'Failed',
    assessmentStatus: 'Needs review',
    winRate: '57%',
    profitFactor: '1.68',
    stability: 'Needs review',
    sourceType: 'strategy_library',
    sourceId: 'library-1',
    libraryId: 'library-1',
    templateId: 'template-9',
    templateName: 'Momentum Template',
    templateVersion: 4,
    dateRangeStart: '2026-02-01T00:00:00.000Z',
    dateRangeEnd: '2026-04-01T23:59:59.999Z',
    templateDiffSummary: {
      changedCount: 2,
      inheritedCount: 11,
      changedFields: ['Long entry logic', 'Max risk'],
    },
    executionAssumptions: {
      spreadPct: 0.05,
      latencyBars: 1,
      fillPolicy: 'conservative-stop-first',
    },
    createdAt: '2026-04-03T10:00:00.000Z',
  } as any;

  const response = service.buildInputSnapshotResponse(
    backtest,
    mappedBacktest,
    '2026-04-05T07:30:00.000Z'
  );

  assert.equal(response.snapshot.backtest.runStatus, 'Failed');
  assert.equal(response.snapshot.lineage.libraryId, 'library-1');
  assert.equal(response.snapshot.executionAssumptions?.fillPolicy, 'conservative-stop-first');
  assert.equal(
    (response.snapshot.inputs.inputSnapshot as Record<string, unknown>)?.templateId,
    'template-9'
  );
  assert.equal(response.snapshot.inputs.progress, undefined);
}

async function runBacktestInputSnapshotDelegationAssertions(): Promise<void> {
  const service = createBacktestsService();
  const backtest = {
    id: 'backtest-snapshot-2',
    name: 'Recovery Snapshot',
    strategy: 'Trend Continuation',
    symbol: 'ETHUSDT',
    parameter: 'Trend Continuation / ETHUSDT / 4h',
    status: 'Failed',
    stability: 'Needs review',
    trades: 9,
    createdAt: new Date('2026-04-04T10:00:00.000Z'),
    result: {
      config: {
        sourceType: 'strategy_library',
        sourceId: 'library-2',
        libraryId: 'library-2',
        inputSnapshot: {
          templateId: 'template-21',
          templateName: 'Trend Continuation',
          templateVersion: 2,
          start: '2026-03-01T00:00:00.000Z',
          end: '2026-04-01T23:59:59.999Z',
        },
        executionAssumptions: {
          fillPolicy: 'best-effort',
        },
      },
    },
  };
  const capturedCalls: Array<{ backtest: unknown; mappedBacktest: any }> = [];

  service.backtestRepository = {
    getBacktestById: async () => backtest,
  };
  service.backtestSnapshotService = {
    buildInputSnapshotResponse: (
      capturedBacktest: unknown,
      mappedBacktest: Record<string, unknown>
    ) => {
      capturedCalls.push({ backtest: capturedBacktest, mappedBacktest });
      return {
        backtestId: 'backtest-snapshot-2',
        fileName: 'delegated.json',
        generatedAt: '2026-04-05T08:00:00.000Z',
        snapshot: {
          schemaVersion: 1,
          exportedAt: '2026-04-05T08:00:00.000Z',
          backtest: {
            id: 'backtest-snapshot-2',
            name: 'Recovery Snapshot',
            parameter: 'Trend Continuation / ETHUSDT / 4h',
            strategy: 'Trend Continuation',
            symbol: 'ETHUSDT',
            status: 'Failed',
            runStatus: 'Failed',
            assessmentStatus: 'Needs review',
            createdAt: '2026-04-04T10:00:00.000Z',
          },
          lineage: {},
          dateRange: {},
          executionAssumptions: null,
          inputs: {},
        },
      };
    },
  };

  const response = await service.getBacktestInputSnapshot('user-1', 'backtest-snapshot-2');

  assert.equal(response.data.fileName, 'delegated.json');
  assert.equal(capturedCalls.length, 1);
  assert.equal(capturedCalls[0].mappedBacktest.id, 'backtest-snapshot-2');
  assert.equal(capturedCalls[0].mappedBacktest.templateId, 'template-21');
  assert.equal(capturedCalls[0].mappedBacktest.lineage?.libraryId, 'library-2');
}

async function runBacktestRecoveryDelegationAssertions(): Promise<void> {
  const service = createBacktestsService();
  const capturedRecoveryCalls: Array<{ backtest: unknown; runStatus: unknown }> = [];
  const backtest = {
    id: 'backtest-recovery-3',
    name: 'Recovery Runner',
    strategy: 'Trend Continuation',
    symbol: 'ETHUSDT',
    parameter: 'Trend Continuation / ETHUSDT / 4h',
    status: 'Failed',
    stability: 'Needs review',
    trades: 9,
    createdAt: new Date('2026-04-04T10:00:00.000Z'),
    result: {
      cagr: null,
      sharpe: null,
      drawdown: null,
      winRate: null,
      profitFactor: null,
      config: {
        resumeCheckpoint: {
          state: 'failed',
        },
      },
    },
  };
  const updatedBacktest = {
    ...backtest,
    status: 'Queued',
    stability: 'Queued',
    result: {
      ...backtest.result,
      config: {
        progress: {
          state: 'queued',
        },
        resumeCheckpoint: {
          state: 'queued',
        },
      },
    },
  };
  const activities: Array<Record<string, unknown>> = [];

  service.backtestRepository = {
    getBacktestById: async () => backtest,
    updateBacktestResult: async (
      userId: string,
      targetBacktestId: string,
      payload: Record<string, unknown>
    ) => {
      assert.equal(userId, 'user-1');
      assert.equal(targetBacktestId, 'backtest-recovery-3');
      assert.equal(payload.status, 'Queued');
      assert.equal(payload.stability, 'Queued');
      return updatedBacktest;
    },
  };
  service.backtestTradeRepository = {
    getTradeCountsByBacktest: async () => new Map([['backtest-recovery-3', 3]]),
  };
  service.backtestRecoveryService = {
    buildRecoveryPlan: (capturedBacktest: unknown, runStatus: unknown) => {
      capturedRecoveryCalls.push({ backtest: capturedBacktest, runStatus });
      return {
        message: 'Backtest re-queued from checkpoint',
        status: 'Queued',
        stability: 'Queued',
        nextConfig: {
          progressProcessed: 4,
          progressTotal: 10,
          progress: { state: 'queued' },
          resumeCheckpoint: { state: 'queued' },
        },
      };
    },
  };
  service.operationalEventService = {
    logActivity: async (userId: string, payload: Record<string, unknown>) => {
      activities.push({ userId, ...payload });
    },
  };
  service.mapBacktest = (record: Record<string, unknown>) => ({
    id: record.id,
    runStatus: 'Queued',
    assessmentStatus: '--',
    status: 'Queued',
  });

  const response = await service.recoverBacktestFromCheckpoint('user-1', 'backtest-recovery-3');

  assert.equal(response.data.message, 'Backtest re-queued from checkpoint');
  assert.equal(response.data.backtest.id, 'backtest-recovery-3');
  assert.equal(capturedRecoveryCalls[0].runStatus, 'Failed');
  assert.equal(activities[0].referenceId, 'backtest-recovery-3');
}

async function runBacktestRecoveryFailureAlertAssertions(): Promise<void> {
  const service = createBacktestsService();
  const activities: Array<Record<string, unknown>> = [];
  const alerts: Array<Record<string, unknown>> = [];
  const backtest = {
    id: 'backtest-recovery-failure-1',
    name: 'Recovery Failure Candidate',
    status: 'Failed',
    stability: 'Failed',
    result: {
      config: {
        resumeCheckpoint: {
          state: 'failed',
        },
      },
    },
  };

  service.backtestRepository = {
    getBacktestById: async () => backtest,
  };
  service.backtestRecoveryService = {
    buildRecoveryPlan: () => {
      throw new Error('Checkpoint payload is corrupted');
    },
  };
  service.operationalEventService = {
    logActivity: async (userId: string, payload: Record<string, unknown>) => {
      activities.push({ userId, ...payload });
    },
    emitFailureAlert: async (userId: string, payload: Record<string, unknown>) => {
      alerts.push({ userId, ...payload });
    },
  };

  await assert.rejects(
    () => service.recoverBacktestFromCheckpoint('user-1', 'backtest-recovery-failure-1'),
    /Checkpoint payload is corrupted/
  );

  assert.equal(activities[0].title, 'Backtest recovery failed');
  assert.equal(alerts[0].channel, 'Backtests');
  assert.equal(alerts[0].source, 'backtests:recovery');
}

async function runBacktestUpdateResultsAssertions(): Promise<void> {
  const service = createBacktestsService();
  const insertedTrades: Array<Record<string, unknown>> = [];
  let syncedBacktestId: string | null = null;

  service.backtestRepository = {
    updateBacktestResult: async (
      userId: string,
      backtestId: string,
      payload: Record<string, unknown>
    ) => {
      assert.equal(userId, 'user-1');
      assert.equal(backtestId, 'backtest-update-1');
      assert.equal(payload.status, 'Completed');
      assert.equal(payload.stability, 'Review');
      assert.equal(payload.trades, 2);
      return {
        id: backtestId,
        status: 'Completed',
        stability: 'Review',
        result: {
          config: {
            performanceSurface: {
              results: [],
            },
          },
        },
      };
    },
  };
  service.backtestTradeRepository = {
    insertTrades: async (payload: Record<string, unknown>[]) => {
      insertedTrades.push(...payload);
    },
  };
  service.automationExecutionService = {
    syncBacktestRunnerLifecycleByBacktestId: async (backtestId: string) => {
      syncedBacktestId = backtestId;
      return { synced: true };
    },
  };
  service.mapBacktest = (record: Record<string, unknown>) => ({
    id: record.id,
    runStatus: 'Completed',
    assessmentStatus: 'Review',
    performanceSurface: {
      results: [],
    },
  });

  const tradeEvents = [
    {
      symbol: 'BTCUSDT',
      interval: '1h',
      side: 'BUY',
      entryTime: Date.parse('2026-04-04T00:00:00.000Z'),
      entryPrice: 100,
      exitTime: Date.parse('2026-04-04T01:00:00.000Z'),
      exitPrice: 104,
    },
    {
      symbol: 'BTCUSDT',
      interval: '1h',
      side: 'SELL',
      entryTime: Date.parse('2026-04-04T02:00:00.000Z'),
      entryPrice: 110,
      exitTime: Date.parse('2026-04-04T03:00:00.000Z'),
      exitPrice: 107,
    },
  ];

  const response = await service.updateBacktestResults('user-1', 'backtest-update-1', {
    runStatus: 'Completed',
    assessmentStatus: 'Review',
    tradeEvents,
  });

  assert.equal(response.data.id, 'backtest-update-1');
  assert.equal(insertedTrades.length, 2);
  assert.equal(insertedTrades[0].userId, 'user-1');
  assert.equal(insertedTrades[0].backtestId, 'backtest-update-1');
  assert.equal(syncedBacktestId, 'backtest-update-1');
}

async function runBacktestAutomationSyncAssertions(): Promise<void> {
  const service = createBacktestsService();

  service.backtestRepository = {
    getBacktestByIdAny: async () => null,
  };
  service.automationExecutionService = {
    syncBacktestRunnerLifecycleByBacktestId: async (backtestId: string) => {
      assert.equal(backtestId, 'backtest-sync-1');
      return {
        synced: true,
        automationId: 'automation-1',
        automationRunId: 'run-1',
      };
    },
  };

  const response = await service.syncBacktestAutomationLifecycle('backtest-sync-1');
  assert.equal(response.data.synced, true);
  assert.equal(response.data.backtestId, 'backtest-sync-1');
  assert.equal(response.data.automationId, 'automation-1');
  assert.equal(response.data.automationRunId, 'run-1');
}

function runRegisteredSmcBacktestPayloadAssertions(): void {
  const service = createBacktestsService();
  const backtest = {
    id: 'smc-backtest-1',
    userId: 'user-1',
    name: 'SMC - advanced - 3m',
    strategy: 'SMC - advanced',
    symbol: 'SOLUSDT',
    parameter: 'SMC - advanced - 3m | SOLUSDT | 3m',
  };
  const config = {
    templateName: 'SMC - advanced',
    templateVersion: 4,
    timeframes: ['3m'],
    template: {
      name: 'SMC - advanced',
      config: {
        codeDefinition: 'class SMCAdvanced(Strategy): pass',
        notes: 'Same model, one-position only',
      },
    },
  };
  const result = {
    strategyId: 'solusdt-smc-one-position',
    strategy: 'solusdt-3m-smc-one-position-sidehour',
    symbol: 'SOLUSDT',
    interval: '3m',
    limit: 0,
    windowStart: '2026-04-29T08:24:00.000Z',
    windowEnd: '2026-05-29T08:24:00.000Z',
    validationStart: '2026-05-19T08:24:00.000Z',
    candles: 14400,
    settings: { rewardR: 8 },
    full: {
      trades: 29,
      targets: 10,
      stops: 19,
      breakeven: 0,
      expired: 0,
      winRate: 0.3448,
      totalR: 83.18,
      avgR: 2.87,
      maxLosingStreak: 3,
    },
    train: {
      trades: 20,
      targets: 7,
      stops: 13,
      breakeven: 0,
      expired: 0,
      winRate: 0.35,
      totalR: 61.38,
      avgR: 3.07,
      maxLosingStreak: 3,
    },
    validation: {
      trades: 9,
      targets: 3,
      stops: 6,
      breakeven: 0,
      expired: 0,
      winRate: 0.3333,
      totalR: 21.8,
      avgR: 2.42,
      maxLosingStreak: 2,
    },
    stats: {
      maxDrawdownR: 3,
      profitFactor: 4.04,
      maxOpenTrades: 1,
    },
    comparison: {
      matches: true,
      expectedFrom: 'proof',
      metrics: {
        trades: { expected: 29, actual: 29, matches: true },
      },
    },
    trades: [
      {
        side: 'long',
        outcome: 'target',
        realizedR: 8,
        sweepTime: '2026-05-01T00:00:00.000Z',
        mssTime: '2026-05-01T00:06:00.000Z',
        entryTime: '2026-05-01T00:09:00.000Z',
        exitTime: '2026-05-01T01:00:00.000Z',
        entryPrice: 150,
        stopLoss: 149,
        oneRStopMove: 151,
        rewardR: 8,
        targetR: 158,
        exitPrice: 158,
      },
    ],
    charts: {},
    artifacts: { summaryPath: null, strategyPath: null },
  };

  assert.equal(service.isSolSmcRegisteredBacktest(backtest, config), true);
  assert.equal(service.resolveBacktestTimeframe(backtest, config), '3m');
  assert.equal(
    service.isSolSmcRegisteredBacktest(backtest, {
      ...config,
      symbols: ['SOLUSDT', 'BTCUSDT'],
    }),
    false
  );
  assert.equal(
    service.isSolSmcRegisteredBacktest(backtest, {
      ...config,
      symbols: ['SOLUSDT'],
    }),
    true
  );
  assert.equal(
    service.isSolSmcRegisteredBacktest(backtest, {
      ...config,
      inputSnapshot: {
        selectedAssets: [{ symbol: 'SOLUSDT' }, { symbol: 'ETHUSDT' }],
      },
    }),
    false
  );

  const payload = service.buildRegisteredSolSmcResultPayload(backtest, config, result);
  assert.equal(payload.status, 'Stable');
  assert.equal(payload.trades, 29);
  assert.equal(payload.cagr, 83.18);
  assert.equal(payload.sharpe, 21.8);
  assert.equal(payload.drawdown, 3);
  assert.equal(payload.winRate, 34.48);
  assert.equal(payload.config.registeredStrategyId, 'solusdt-smc-one-position');
  assert.equal((payload.config.smcMetrics as any).actualOutput.maxOpenTrades, 1);
  assert.equal((payload.performanceSurface.results as any[])[0].total_r, 83.18);
  assert.equal((payload.performanceSurface.results as any[])[0].validation_r, 21.8);
  assert.equal((payload.performanceSurface.results as any[])[0].units, 'R');

  const trades = service.mapSmcTradesToBacktestTrades('user-1', 'smc-backtest-1', result);
  assert.equal(trades.length, 1);
  assert.equal(trades[0].side, 'BUY');
  assert.equal(trades[0].entryPrice, 150);
}

async function runBacktestCreateFailureAlertAssertions(): Promise<void> {
  const service = createBacktestsService();
  const operational = createOperationalMock();

  service.operationalEventService = operational.service;
  service.backtestRepository = {
    createQueuedBacktest: async () => {
      throw new Error('Backtest queue unavailable');
    },
  };

  await assert.rejects(
    () =>
      service.createBacktest('user-1', {
        universe: 'Momentum',
        interval: '1h',
        capital: '10000',
        fees: '0.02',
        slippage: '0.05',
        dateRange: '90d',
        benchmark: 'BTCUSDT',
        includeExtended: true,
        usePaperGate: false,
      }),
    /Backtest queue unavailable/
  );

  assert.equal(operational.activityCalls[0].payload.title, 'Backtest create failed');
  assert.equal(operational.alertCalls[0].payload.channel, 'Backtests');
  assert.equal(operational.alertCalls[0].payload.route, 'Risk review');
}

async function runBacktestPromotionSnapshotAssertions(): Promise<void> {
  const service = new BacktestPromotionService() as any;
  const createdAutomations: Array<Record<string, unknown>> = [];
  const createdEvents: Array<Record<string, unknown>> = [];
  const backtest = {
    id: 'backtest-2',
    name: 'Snapshot Winner',
    strategy: 'Momentum Template',
    symbol: 'BTCUSDT',
    parameter: 'Momentum Runner | BTCUSDT | 15m',
    createdAt: new Date('2026-04-02T00:00:00.000Z'),
    result: {
      config: {
        inputSnapshot: {
          sourceType: 'strategy_library',
          sourceId: 'library-1',
          libraryId: 'library-1',
          templateId: 'template-1',
          templateVersion: 8,
          templateDiffSummary: {
            changedCount: 2,
            inheritedCount: 14,
            changedFields: ['Long entry logic', 'Max risk'],
          },
          market: 'crypto-futures',
          assets: [{ symbol: 'BTCUSDT', brokerKey: 'paper' }],
          timeframes: ['15m'],
          template: {
            id: 'template-1',
            name: 'Momentum Template',
            templateVersion: 8,
            config: {
              market: 'crypto-futures',
              codeTarget: 'python',
            },
          },
        },
      },
    },
  };
  const selectedTopSetup = {
    id: 'setup-1',
    dedupeKey: 'setup-1',
    backtestId: 'backtest-2',
    backtestName: 'Snapshot Winner',
    strategy: 'Momentum Template',
    parameter: 'Momentum Runner | BTCUSDT | 15m',
    symbol: 'BTCUSDT',
    timeframe: '15m',
    score: 0.91,
    trades: 10,
    winRate: 60,
    profitFactor: 1.8,
    returnPct: 12.5,
    maxDrawdownPct: 4.2,
    hasIncompleteTradeHistory: false,
    eligibleForAutomation: true,
    automationEligibilityReasons: [],
    templateAutomationReady: true,
    templateAutomationReasons: [],
    robustness: {
      robustnessScore: 0.88,
      walkForwardPassRate: 0.75,
      averageOutOfSampleReturnPct: 9.1,
      worstOutOfSampleReturnPct: 2.4,
    },
    createdAt: '2026-04-02T00:00:00.000Z',
  };

  service.automationRepository = {
    findTradeSuggestionAutomationByScope: async () => null,
    createAutomation: async (payload: Record<string, unknown>) => {
      createdAutomations.push(payload);
      return {
        id: 'automation-1',
        status: payload.status,
        createdAt: new Date('2026-04-02T00:00:00.000Z'),
      };
    },
    createAutomationEvent: async (payload: Record<string, unknown>) => {
      createdEvents.push(payload);
      return payload;
    },
  };
  service.operationalEventService = {
    logActivity: async () => undefined,
  };
  service.userTimeZoneService = {
    resolveUserTimeZone: async () => 'Asia/Kolkata',
  };

  const response = await service.promoteResolvedTopSetup({
    userId: 'user-1',
    backtest,
    payload: {
      status: 'Draft',
      timeZone: 'Asia/Kolkata',
      executionPolicy: {
        executionMode: 'paper_trade_auto',
        approvalMode: 'auto_if_safe',
        routing: {
          routeMode: 'fixed',
          brokerKey: 'mudrex',
          accountId: 'account-1',
        },
      },
    },
    selectedTopSetup,
  });

  assert.equal(response.data.automation.id, 'automation-1');
  assert.equal(createdAutomations[0]?.timeZone, 'Asia/Kolkata');
  assert.equal(createdAutomations[0]?.trigger, 'timeframe:15m');
  const automationConfig = createdAutomations[0]?.config as Record<string, unknown>;
  const execution = (automationConfig?.tradeSuggestion as Record<string, unknown>)
    ?.execution as Record<string, unknown>;
  const routing = execution?.routing as Record<string, unknown>;
  assert.equal(execution?.executionMode, 'paper_trade_auto');
  assert.equal(execution?.approvalMode, 'auto_if_safe');
  assert.equal(routing?.routeMode, 'fixed');
  assert.equal(routing?.brokerKey, 'mudrex');
  assert.equal(routing?.accountId, 'account-1');
  const config = automationConfig?.config as Record<string, unknown>;
  assert.equal(config?.libraryId, 'library-1');
  assert.equal(config?.templateVersion, 8);
  assert.equal(createdEvents.length, 1);
}

async function runBacktestPromotionIdempotencyAssertions(): Promise<void> {
  const service = new BacktestPromotionService() as any;
  const activities: Array<Record<string, unknown>> = [];

  service.automationRepository = {
    findTradeSuggestionAutomationByScope: async () => ({
      id: 'automation-existing-1',
      status: 'Draft',
      createdAt: new Date('2026-04-03T09:00:00.000Z'),
      name: 'Existing ETH automation',
    }),
    createAutomation: async () => {
      throw new Error('createAutomation should not be called');
    },
    createAutomationEvent: async () => {
      throw new Error('createAutomationEvent should not be called');
    },
  };
  service.operationalEventService = {
    logActivity: async (_userId: string, payload: Record<string, unknown>) => {
      activities.push(payload);
    },
  };

  const response = await service.promoteResolvedTopSetup({
    userId: 'user-1',
    backtest: {
      id: 'backtest-3',
      name: 'Existing Automation Winner',
      strategy: 'Momentum Template',
      symbol: 'ETHUSDT',
      parameter: 'Momentum Runner | ETHUSDT | 4h',
      createdAt: new Date('2026-04-03T00:00:00.000Z'),
      result: {
        config: {
          inputSnapshot: {
            sourceType: 'strategy_library',
            sourceId: 'library-1',
            libraryId: 'library-1',
            templateId: 'template-1',
            templateVersion: 8,
            market: 'crypto-futures',
            assets: [{ symbol: 'ETHUSDT', brokerKey: 'paper' }],
            timeframes: ['4h'],
          },
        },
      },
    },
    payload: { status: 'Draft' },
    selectedTopSetup: {
      id: 'setup-1',
      dedupeKey: 'setup-1',
      backtestId: 'backtest-3',
      backtestName: 'Existing Automation Winner',
      strategy: 'Momentum Template',
      parameter: 'Momentum Runner | ETHUSDT | 4h',
      symbol: 'ETHUSDT',
      timeframe: '4h',
      score: 0.94,
      trades: 14,
      winRate: 62,
      profitFactor: 1.9,
      returnPct: 16.1,
      maxDrawdownPct: 4.8,
      hasIncompleteTradeHistory: false,
      eligibleForAutomation: true,
      automationEligibilityReasons: [],
      templateAutomationReady: true,
      templateAutomationReasons: [],
      robustness: {
        robustnessScore: 0.91,
        walkForwardPassRate: 0.8,
        averageOutOfSampleReturnPct: 10.4,
        worstOutOfSampleReturnPct: 3.1,
      },
      createdAt: '2026-04-03T00:00:00.000Z',
    },
  });

  assert.equal(response.data.message, 'Automation already exists for top setup');
  assert.equal(response.data.automation.id, 'automation-existing-1');
  assert.equal(activities.length, 1);
}

async function runBacktestPromotionServiceFailureAlertAssertions(): Promise<void> {
  const service = new BacktestPromotionService() as any;
  const activities: Array<Record<string, unknown>> = [];
  const alerts: Array<Record<string, unknown>> = [];

  service.automationRepository = {
    findTradeSuggestionAutomationByScope: async () => null,
    createAutomation: async () => {
      throw new Error('Automation create failed');
    },
  };
  service.operationalEventService = {
    logActivity: async (_userId: string, payload: Record<string, unknown>) => {
      activities.push(payload);
    },
    emitFailureAlert: async (_userId: string, payload: Record<string, unknown>) => {
      alerts.push(payload);
    },
  };
  service.userTimeZoneService = {
    resolveUserTimeZone: async () => 'UTC',
  };

  await assert.rejects(
    () =>
      service.promoteResolvedTopSetup({
        userId: 'user-1',
        backtest: {
          id: 'backtest-promotion-service-failure-1',
          name: 'Promotion Service Failure Candidate',
          strategy: 'Momentum Template',
          symbol: 'BTCUSDT',
          parameter: 'Momentum Runner | BTCUSDT | 1h',
          createdAt: new Date('2026-04-05T00:00:00.000Z'),
          result: {
            config: {
              inputSnapshot: {
                sourceType: 'strategy_library',
                sourceId: 'library-1',
                libraryId: 'library-1',
                templateId: 'template-1',
                templateVersion: 8,
                market: 'crypto-futures',
                assets: [{ symbol: 'BTCUSDT', brokerKey: 'paper' }],
                timeframes: ['1h'],
              },
            },
          },
        },
        payload: { status: 'Draft' },
        selectedTopSetup: {
          id: 'setup-promotion-service-failure-1',
          dedupeKey: 'setup-promotion-service-failure-1',
          backtestId: 'backtest-promotion-service-failure-1',
          backtestName: 'Promotion Service Failure Candidate',
          strategy: 'Momentum Template',
          parameter: 'Momentum Runner | BTCUSDT | 1h',
          symbol: 'BTCUSDT',
          timeframe: '1h',
          score: 0.9,
          trades: 12,
          winRate: 58,
          profitFactor: 1.7,
          returnPct: 10.4,
          maxDrawdownPct: 4.9,
          hasIncompleteTradeHistory: false,
          eligibleForAutomation: true,
          automationEligibilityReasons: [],
          templateAutomationReady: true,
          templateAutomationReasons: [],
          robustness: {
            robustnessScore: 0.87,
            walkForwardPassRate: 0.76,
            averageOutOfSampleReturnPct: 8.3,
            worstOutOfSampleReturnPct: 2.2,
          },
          createdAt: '2026-04-05T00:00:00.000Z',
        },
      }),
    /Automation create failed/
  );

  assert.equal(activities[0]?.title, 'Backtest promotion failed');
  assert.equal(alerts[0]?.channel, 'Automations');
  assert.equal(alerts[0]?.source, 'backtests:promotion-service');
}

async function runBacktestPromotionDelegationAssertions(): Promise<void> {
  const service = createBacktestsService();
  const capturedCalls: Array<Record<string, unknown>> = [];
  let capturedPromotionRules: BacktestPromotionRules | null = null;
  const backtest = {
    id: 'backtest-promotion-delegate-1',
    name: 'Delegated Promotion Winner',
    strategy: 'Momentum Template',
    symbol: 'BTCUSDT',
    parameter: 'Momentum Template / BTCUSDT / 1h',
    status: 'Completed',
    stability: 'Stable',
    trades: 18,
    createdAt: new Date('2026-04-05T00:00:00.000Z'),
    result: {
      cagr: 11.2,
      sharpe: 1.52,
      drawdown: 5.7,
      winRate: 59,
      profitFactor: 1.84,
      config: {
        sourceType: 'strategy_library',
        sourceId: 'library-1',
        libraryId: 'library-1',
        inputSnapshot: {
          sourceType: 'strategy_library',
          sourceId: 'library-1',
          libraryId: 'library-1',
          templateId: 'template-1',
          templateVersion: 8,
        },
        performanceSurface: {
          generatedAt: '2026-04-05T00:15:00.000Z',
          results: [],
        },
        tradeEventCount: 18,
      },
    },
  };

  service.backtestRepository = {
    getBacktestById: async () => backtest,
  };
  service.appSettingsRepository = {
    async getSettings() {
      return {
        backtestPromotionRules: {
          minScore: 0.82,
          minTrades: 7,
          requireRobustness: false,
        },
      };
    },
  };
  service.backtestTradeRepository = {
    getTradeCountsByBacktest: async () => new Map([[backtest.id, 18]]),
  };
  service.backtestTopSetupsService = {
    rankBacktestTopSetups: (
      _mappedBacktest: Record<string, unknown>,
      promotionRules?: BacktestPromotionRules
    ) => {
      capturedPromotionRules = promotionRules ?? null;
      return [
        {
          id: 'setup-delegate-1',
          dedupeKey: 'setup-delegate-1',
          backtestId: backtest.id,
          backtestName: backtest.name,
          strategy: backtest.strategy,
          parameter: backtest.parameter,
          symbol: 'BTCUSDT',
          timeframe: '1h',
          score: 0.93,
          trades: 18,
          winRate: 59,
          profitFactor: 1.84,
          returnPct: 14.6,
          maxDrawdownPct: 5.7,
          hasIncompleteTradeHistory: false,
          eligibleForAutomation: true,
          automationEligibilityReasons: [],
          templateAutomationReady: true,
          templateAutomationReasons: [],
          robustness: {
            robustnessScore: 0.9,
            walkForwardPassRate: 0.8,
            averageOutOfSampleReturnPct: 10.1,
            worstOutOfSampleReturnPct: 2.9,
          },
          createdAt: '2026-04-05T00:00:00.000Z',
        },
      ];
    },
  };
  service.backtestPromotionService = {
    promoteResolvedTopSetup: async (payload: Record<string, unknown>) => {
      capturedCalls.push(payload);
      return {
        success: true,
        data: {
          message: 'delegated',
          automation: {
            id: 'automation-delegated-1',
            status: 'Draft',
            createdAt: '2026-04-05T00:20:00.000Z',
          },
        },
      };
    },
  };

  const response = await service.promoteBacktestToAutomation('user-1', backtest.id, {
    status: 'Draft',
  });

  assert.equal(response.data.message, 'delegated');
  assert.equal(capturedCalls[0].userId, 'user-1');
  assert.equal((capturedCalls[0].selectedTopSetup as Record<string, unknown>).timeframe, '1h');
  assert.ok(capturedPromotionRules);
  const promotionRules = capturedPromotionRules as BacktestPromotionRules;
  assert.equal(promotionRules.minScore, 0.82);
  assert.equal(promotionRules.minTrades, 7);
}

async function runBacktestPromotionFailureAlertAssertions(): Promise<void> {
  const service = createBacktestsService();
  const activities: Array<Record<string, unknown>> = [];
  const alerts: Array<Record<string, unknown>> = [];
  const backtest = {
    id: 'backtest-promotion-failure-1',
    name: 'Promotion Failure Candidate',
    strategy: 'Momentum Template',
    symbol: 'BTCUSDT',
    parameter: 'Momentum Template / BTCUSDT / 1h',
    status: 'Completed',
    stability: 'Stable',
    trades: 18,
    createdAt: new Date('2026-04-05T00:00:00.000Z'),
    result: {
      cagr: 11.2,
      sharpe: 1.52,
      drawdown: 5.7,
      winRate: 59,
      profitFactor: 1.84,
      config: {
        performanceSurface: {
          generatedAt: '2026-04-05T00:15:00.000Z',
          results: [],
        },
        tradeEventCount: 18,
      },
    },
  };

  service.backtestRepository = {
    getBacktestById: async () => backtest,
  };
  service.backtestTradeRepository = {
    getTradeCountsByBacktest: async () => new Map([[backtest.id, 18]]),
  };
  service.mapBacktest = () => ({
    id: backtest.id,
    runStatus: 'Completed',
    performanceSurface: {
      generatedAt: '2026-04-05T00:15:00.000Z',
      results: [],
    },
    hasIncompleteTradeHistory: false,
  });
  service.backtestTopSetupsService = {
    rankBacktestTopSetups: () => [
      {
        id: 'setup-promotion-failure-1',
        dedupeKey: 'setup-promotion-failure-1',
        backtestId: backtest.id,
        backtestName: backtest.name,
        strategy: backtest.strategy,
        parameter: backtest.parameter,
        symbol: 'BTCUSDT',
        timeframe: '1h',
        score: 0.93,
        trades: 18,
        winRate: 59,
        profitFactor: 1.84,
        returnPct: 14.6,
        maxDrawdownPct: 5.7,
        hasIncompleteTradeHistory: false,
        eligibleForAutomation: true,
        automationEligibilityReasons: [],
        templateAutomationReady: true,
        templateAutomationReasons: [],
        robustness: {
          robustnessScore: 0.9,
          walkForwardPassRate: 0.8,
          averageOutOfSampleReturnPct: 10.1,
          worstOutOfSampleReturnPct: 2.9,
        },
        createdAt: '2026-04-05T00:00:00.000Z',
      },
    ],
  };
  service.backtestPromotionService = {
    promoteResolvedTopSetup: async () => {
      throw new Error('Automation persistence failed');
    },
  };
  service.operationalEventService = {
    logActivity: async (_userId: string, payload: Record<string, unknown>) => {
      activities.push(payload);
    },
    emitFailureAlert: async (_userId: string, payload: Record<string, unknown>) => {
      alerts.push(payload);
    },
  };

  await assert.rejects(
    () => service.promoteBacktestToAutomation('user-1', backtest.id, { status: 'Draft' }),
    /Automation persistence failed/
  );

  assert.equal(activities[0].title, 'Backtest promotion failed');
  assert.equal(alerts[0].channel, 'Backtests');
  assert.equal(alerts[0].source, 'backtests:promotion');
}

async function runBacktestBatchPromotionAssertions(): Promise<void> {
  const service = createBacktestsService();
  const activities: Array<Record<string, unknown>> = [];
  const alerts: Array<Record<string, unknown>> = [];
  const capturedCalls: Array<Record<string, unknown>> = [];
  const backtest = {
    id: 'backtest-batch-promotion-1',
    name: 'Batch Promotion Candidate',
    strategy: 'Momentum Template',
    symbol: 'BTCUSDT',
    parameter: 'Momentum Template / BTCUSDT / 1h',
    status: 'Completed',
    stability: 'Stable',
    trades: 42,
    createdAt: new Date('2026-04-05T00:00:00.000Z'),
    result: {
      cagr: 18.4,
      sharpe: 1.74,
      drawdown: 6.2,
      winRate: 61,
      profitFactor: 1.91,
      config: {
        performanceSurface: {
          generatedAt: '2026-04-05T00:15:00.000Z',
          results: [],
        },
        tradeEventCount: 42,
      },
    },
  };

  service.backtestRepository = {
    getBacktestById: async () => backtest,
  };
  service.backtestTradeRepository = {
    getTradeCountsByBacktest: async () => new Map([[backtest.id, 42]]),
  };
  service.mapBacktest = () => ({
    id: backtest.id,
    runStatus: 'Completed',
    performanceSurface: {
      generatedAt: '2026-04-05T00:15:00.000Z',
      results: [],
    },
    hasIncompleteTradeHistory: false,
  });
  service.backtestTopSetupsService = {
    rankBacktestTopSetups: () => [
      {
        id: 'setup-batch-1',
        dedupeKey: 'setup-batch-1',
        backtestId: backtest.id,
        backtestName: backtest.name,
        strategy: backtest.strategy,
        parameter: backtest.parameter,
        symbol: 'BTCUSDT',
        timeframe: '1h',
        score: 0.93,
        trades: 18,
        winRate: 59,
        profitFactor: 1.84,
        returnPct: 14.6,
        maxDrawdownPct: 5.7,
        hasIncompleteTradeHistory: false,
        eligibleForAutomation: true,
        automationEligibilityReasons: [],
        templateAutomationReady: true,
        templateAutomationReasons: [],
        robustness: {
          robustnessScore: 0.9,
        },
        createdAt: '2026-04-05T00:00:00.000Z',
      },
      {
        id: 'setup-batch-2',
        dedupeKey: 'setup-batch-2',
        backtestId: backtest.id,
        backtestName: backtest.name,
        strategy: backtest.strategy,
        parameter: backtest.parameter,
        symbol: 'ETHUSDT',
        timeframe: '4h',
        score: 0.88,
        trades: 12,
        winRate: 57,
        profitFactor: 1.54,
        returnPct: 9.3,
        maxDrawdownPct: 7.1,
        hasIncompleteTradeHistory: false,
        eligibleForAutomation: true,
        automationEligibilityReasons: [],
        templateAutomationReady: true,
        templateAutomationReasons: [],
        robustness: {
          robustnessScore: 0.82,
        },
        createdAt: '2026-04-05T00:00:00.000Z',
      },
      {
        id: 'setup-batch-3',
        dedupeKey: 'setup-batch-3',
        backtestId: backtest.id,
        backtestName: backtest.name,
        strategy: backtest.strategy,
        parameter: backtest.parameter,
        symbol: 'SOLUSDT',
        timeframe: '15m',
        score: 0.84,
        trades: 10,
        winRate: 55,
        profitFactor: 1.42,
        returnPct: 7.2,
        maxDrawdownPct: 8.4,
        hasIncompleteTradeHistory: false,
        eligibleForAutomation: true,
        automationEligibilityReasons: [],
        templateAutomationReady: true,
        templateAutomationReasons: [],
        robustness: {
          robustnessScore: 0.8,
        },
        createdAt: '2026-04-05T00:00:00.000Z',
      },
    ],
  };
  service.backtestPromotionService = {
    promoteResolvedTopSetup: async (payload: Record<string, unknown>) => {
      capturedCalls.push(payload);
      const selectedTopSetup = payload.selectedTopSetup as Record<string, unknown>;
      const symbol = String(selectedTopSetup.symbol || '');

      if (symbol === 'ETHUSDT') {
        return {
          success: true,
          data: {
            message: 'Automation already exists for this setup',
            automation: {
              id: 'automation-batch-reused-1',
              status: 'Running',
              createdAt: '2026-04-05T00:20:00.000Z',
            },
          },
        };
      }

      if (symbol === 'SOLUSDT') {
        throw new Error('Automation create failed');
      }

      return {
        success: true,
        data: {
          message: 'Automation created from top setup',
          automation: {
            id: 'automation-batch-created-1',
            status: 'Running',
            createdAt: '2026-04-05T00:20:00.000Z',
          },
        },
      };
    },
  };
  service.operationalEventService = {
    logActivity: async (_userId: string, payload: Record<string, unknown>) => {
      activities.push(payload);
    },
    emitFailureAlert: async (_userId: string, payload: Record<string, unknown>) => {
      alerts.push(payload);
    },
  };

  const response = await service.promoteBacktestBatchToAutomation('user-1', backtest.id, {
    name: 'Shared Automation Name',
    trigger: 'Top setups',
    status: 'Running',
    timeZone: 'Asia/Kolkata',
    executionPolicy: {
      executionMode: 'paper_trade_auto',
      approvalMode: 'auto_if_safe',
      routing: {
        routeMode: 'user_default',
      },
    },
    schedule: {
      interval: 'daily',
    },
    items: [
      {
        symbol: 'BTCUSDT',
        timeframe: '1h',
        name: 'BTC custom automation',
      },
      {
        symbol: 'ETHUSDT',
        timeframe: '4h',
      },
      {
        symbol: 'SOLUSDT',
        timeframe: '15m',
      },
    ],
  });

  assert.equal(
    response.data.message,
    'Batch deployment completed with 1 created, 1 reused, and 1 failed.'
  );
  assert.deepEqual(response.data.summary, {
    requested: 3,
    created: 1,
    reused: 1,
    failed: 1,
  });
  assert.deepEqual(
    response.data.results.map((item: any) => ({
      symbol: item.symbol,
      timeframe: item.timeframe,
      status: item.status,
    })),
    [
      { symbol: 'BTCUSDT', timeframe: '1h', status: 'created' },
      { symbol: 'ETHUSDT', timeframe: '4h', status: 'reused' },
      { symbol: 'SOLUSDT', timeframe: '15m', status: 'failed' },
    ]
  );
  assert.equal(capturedCalls.length, 3);
  assert.equal((capturedCalls[0].payload as Record<string, unknown>).name, 'BTC custom automation');
  assert.equal(
    (capturedCalls[1].payload as Record<string, unknown>).name,
    'Shared Automation Name'
  );
  assert.equal(
    (
      (capturedCalls[0].payload as Record<string, unknown>).executionPolicy as Record<
        string,
        unknown
      >
    )?.executionMode,
    'paper_trade_auto'
  );
  assert.equal(activities[0].title, 'Backtest batch promotion completed');
  assert.equal(activities[0].status, 'Success');
  assert.equal(alerts.length, 0);
}

async function runBacktestBatchPromotionAllFailedAlertAssertions(): Promise<void> {
  const service = createBacktestsService();
  const activities: Array<Record<string, unknown>> = [];
  const alerts: Array<Record<string, unknown>> = [];
  const backtest = {
    id: 'backtest-batch-promotion-failure-1',
    name: 'Batch Promotion Failure Candidate',
    strategy: 'Momentum Template',
    symbol: 'BTCUSDT',
    parameter: 'Momentum Template / BTCUSDT / 1h',
    status: 'Completed',
    stability: 'Stable',
    trades: 24,
    createdAt: new Date('2026-04-05T00:00:00.000Z'),
    result: {
      cagr: 10.4,
      sharpe: 1.42,
      drawdown: 7.4,
      winRate: 56,
      profitFactor: 1.63,
      config: {
        performanceSurface: {
          generatedAt: '2026-04-05T00:15:00.000Z',
          results: [],
        },
        tradeEventCount: 24,
      },
    },
  };

  service.backtestRepository = {
    getBacktestById: async () => backtest,
  };
  service.backtestTradeRepository = {
    getTradeCountsByBacktest: async () => new Map([[backtest.id, 24]]),
  };
  service.mapBacktest = () => ({
    id: backtest.id,
    runStatus: 'Completed',
    performanceSurface: {
      generatedAt: '2026-04-05T00:15:00.000Z',
      results: [],
    },
    hasIncompleteTradeHistory: false,
  });
  service.backtestTopSetupsService = {
    rankBacktestTopSetups: () => [
      {
        id: 'setup-batch-failure-1',
        dedupeKey: 'setup-batch-failure-1',
        backtestId: backtest.id,
        backtestName: backtest.name,
        strategy: backtest.strategy,
        parameter: backtest.parameter,
        symbol: 'BTCUSDT',
        timeframe: '1h',
        score: 0.8,
        trades: 12,
        winRate: 55,
        profitFactor: 1.4,
        returnPct: 8.1,
        maxDrawdownPct: 7.3,
        hasIncompleteTradeHistory: false,
        eligibleForAutomation: true,
        automationEligibilityReasons: [],
        templateAutomationReady: true,
        templateAutomationReasons: [],
        createdAt: '2026-04-05T00:00:00.000Z',
      },
      {
        id: 'setup-batch-failure-2',
        dedupeKey: 'setup-batch-failure-2',
        backtestId: backtest.id,
        backtestName: backtest.name,
        strategy: backtest.strategy,
        parameter: backtest.parameter,
        symbol: 'ETHUSDT',
        timeframe: '4h',
        score: 0.79,
        trades: 10,
        winRate: 53,
        profitFactor: 1.36,
        returnPct: 6.4,
        maxDrawdownPct: 8.8,
        hasIncompleteTradeHistory: false,
        eligibleForAutomation: true,
        automationEligibilityReasons: [],
        templateAutomationReady: true,
        templateAutomationReasons: [],
        createdAt: '2026-04-05T00:00:00.000Z',
      },
    ],
  };
  service.backtestPromotionService = {
    promoteResolvedTopSetup: async () => {
      throw new Error('Automation create failed');
    },
  };
  service.operationalEventService = {
    logActivity: async (_userId: string, payload: Record<string, unknown>) => {
      activities.push(payload);
    },
    emitFailureAlert: async (_userId: string, payload: Record<string, unknown>) => {
      alerts.push(payload);
    },
  };

  const response = await service.promoteBacktestBatchToAutomation('user-1', backtest.id, {
    status: 'Running',
    items: [
      { symbol: 'BTCUSDT', timeframe: '1h' },
      { symbol: 'ETHUSDT', timeframe: '4h' },
    ],
  });

  assert.deepEqual(response.data.summary, {
    requested: 2,
    created: 0,
    reused: 0,
    failed: 2,
  });
  assert.equal(activities[0].title, 'Backtest batch promotion completed');
  assert.equal(activities[0].status, 'Failed');
  assert.equal(alerts[0].channel, 'Backtests');
  assert.equal(alerts[0].source, 'backtests:promotion-batch');
}

async function runBacktestBatchPromotionTimeframeMergeAssertions(): Promise<void> {
  const service = createBacktestsService();
  const groupCalls: Array<Record<string, unknown>> = [];
  const singleCalls: Array<Record<string, unknown>> = [];
  const backtest = {
    id: 'backtest-batch-promotion-merge-1',
    name: 'Batch Promotion Merge Candidate',
    strategy: 'Momentum Template',
    parameter: 'Baseline',
    symbol: 'BTCUSDT',
    interval: '1h',
    status: 'Completed',
    stability: 'Stable',
    trades: 42,
    createdAt: new Date('2026-04-05T00:00:00.000Z'),
    result: {
      config: {
        performanceSurface: {
          generatedAt: '2026-04-05T00:15:00.000Z',
          results: [],
        },
      },
    },
  };
  const topSetups = [
    {
      id: 'setup-merge-1',
      dedupeKey: 'setup-merge-1',
      backtestId: backtest.id,
      backtestName: backtest.name,
      strategy: backtest.strategy,
      parameter: backtest.parameter,
      symbol: 'BTCUSDT',
      timeframe: '1h',
      score: 0.93,
      trades: 18,
      winRate: 59,
      profitFactor: 1.84,
      returnPct: 14.6,
      maxDrawdownPct: 5.7,
      hasIncompleteTradeHistory: false,
      eligibleForAutomation: true,
      automationEligibilityReasons: [],
      templateAutomationReady: true,
      templateAutomationReasons: [],
      createdAt: '2026-04-05T00:00:00.000Z',
    },
    {
      id: 'setup-merge-2',
      dedupeKey: 'setup-merge-2',
      backtestId: backtest.id,
      backtestName: backtest.name,
      strategy: backtest.strategy,
      parameter: backtest.parameter,
      symbol: 'ETHUSDT',
      timeframe: '1h',
      score: 0.88,
      trades: 12,
      winRate: 57,
      profitFactor: 1.54,
      returnPct: 9.3,
      maxDrawdownPct: 7.1,
      hasIncompleteTradeHistory: false,
      eligibleForAutomation: true,
      automationEligibilityReasons: [],
      templateAutomationReady: true,
      templateAutomationReasons: [],
      createdAt: '2026-04-05T00:00:00.000Z',
    },
    {
      id: 'setup-merge-3',
      dedupeKey: 'setup-merge-3',
      backtestId: backtest.id,
      backtestName: backtest.name,
      strategy: backtest.strategy,
      parameter: backtest.parameter,
      symbol: 'SOLUSDT',
      timeframe: '15m',
      score: 0.84,
      trades: 10,
      winRate: 55,
      profitFactor: 1.42,
      returnPct: 7.2,
      maxDrawdownPct: 8.4,
      hasIncompleteTradeHistory: false,
      eligibleForAutomation: true,
      automationEligibilityReasons: [],
      templateAutomationReady: true,
      templateAutomationReasons: [],
      createdAt: '2026-04-05T00:00:00.000Z',
    },
  ];

  service.backtestRepository = {
    getBacktestById: async () => backtest,
  };
  service.backtestTradeRepository = {
    getTradeCountsByBacktest: async () => new Map([[backtest.id, 42]]),
  };
  service.mapBacktest = () => ({
    id: backtest.id,
    runStatus: 'Completed',
    performanceSurface: {
      generatedAt: '2026-04-05T00:15:00.000Z',
      results: [],
    },
    hasIncompleteTradeHistory: false,
  });
  service.backtestTopSetupsService = {
    rankBacktestTopSetups: () => topSetups,
  };
  service.backtestPromotionService = {
    promoteResolvedTopSetup: async (payload: Record<string, unknown>) => {
      singleCalls.push(payload);
      return {
        success: true,
        data: {
          message: 'Automation created from top setup',
          automation: {
            id: 'automation-single-15m',
            status: 'Running',
            createdAt: '2026-04-05T00:20:00.000Z',
          },
        },
      };
    },
    promoteResolvedTopSetupGroup: async (payload: Record<string, unknown>) => {
      groupCalls.push(payload);
      return {
        success: true,
        data: {
          message: 'Automation created from timeframe group',
          automation: {
            id: 'automation-group-1h',
            status: 'Running',
            createdAt: '2026-04-05T00:20:00.000Z',
          },
        },
      };
    },
  };
  service.operationalEventService = {
    logActivity: async () => undefined,
    emitFailureAlert: async () => undefined,
  };

  const response = await service.promoteBacktestBatchToAutomation('user-1', backtest.id, {
    name: 'Merged Timeframe Automation',
    status: 'Running',
    items: [
      { backtestId: backtest.id, symbol: 'BTCUSDT', timeframe: '1h' },
      { backtestId: backtest.id, symbol: 'ETHUSDT', timeframe: '1h' },
      { backtestId: backtest.id, symbol: 'SOLUSDT', timeframe: '15m' },
    ],
  });

  assert.deepEqual(response.data.summary, {
    requested: 2,
    created: 2,
    reused: 0,
    failed: 0,
  });
  assert.equal(groupCalls.length, 1);
  assert.equal(((groupCalls[0].entries as unknown[]) || []).length, 2);
  assert.equal(singleCalls.length, 1);
  assert.deepEqual(
    response.data.results.map((item: any) => ({
      symbols: item.symbols,
      timeframe: item.timeframe,
      itemCount: item.itemCount,
      status: item.status,
    })),
    [
      {
        symbols: ['BTCUSDT', 'ETHUSDT'],
        timeframe: '1h',
        itemCount: 2,
        status: 'created',
      },
      {
        symbols: ['SOLUSDT'],
        timeframe: '15m',
        itemCount: 1,
        status: 'created',
      },
    ]
  );
}

function runBacktestsScriptWiringAssertions(): void {
  const packageSource = read('package.json');
  const packageJson = JSON.parse(packageSource) as { scripts?: Record<string, string> };
  const packageScripts = packageJson.scripts || {};
  const runPackageSuiteSource = read('scripts/_support/run-package-suite.ts');
  const proofSource = read('scripts/proofs/proof-backtests-live.ts');
  const smokeSource = read('scripts/smokes/smoke-backtests-lifecycle.ts');
  const checkSource = read('scripts/checks/check-backtests-health.ts');
  const releaseGateSource = read('scripts/release-gates/release-gate-backtests.ts');
  const signoffSource = read('scripts/signoffs/signoff-backtests.ts');

  assert.equal(
    packageScripts['test:backtests'],
    'node --import tsx scripts/_support/run-doc-aware-test.ts scripts/test-backtests.ts'
  );
  assert.equal(runPackageSuiteSource.includes("backtests: ['test:backtests']"), true);
  assert.equal(runPackageSuiteSource.includes("'test:backtests'"), true);
  assert.equal(packageScripts['proof:backtests-live'] !== undefined, true);
  assert.equal(packageScripts['release-gate:backtests'] !== undefined, true);
  assert.equal(packageScripts['signoff:backtests'] !== undefined, true);

  assert.equal(
    proofSource.includes('scripts/smokes/smoke-backtests-lifecycle.ts'),
    true,
    'backtests live proof must run lifecycle smoke'
  );
  assert.equal(
    proofSource.includes('scripts/checks/check-backtests-health.ts'),
    true,
    'backtests live proof must run health check'
  );
  assert.equal(
    smokeSource.includes('/auth/login') &&
      smokeSource.includes('/health/backtests') &&
      smokeSource.includes('/backtests'),
    true,
    'backtests smoke must exercise login, health, and backtests APIs'
  );
  assert.equal(
    checkSource.includes('/health/backtests') && checkSource.includes('/health/ops'),
    true,
    'backtests health check must read backtests and ops health endpoints'
  );
  assert.equal(
    releaseGateSource.includes('/health/backtests'),
    true,
    'backtests release gate must read backtests health endpoint'
  );
  assert.equal(
    releaseGateSource.includes('smoke-backtests-lifecycle.ts'),
    true,
    'backtests release gate must execute lifecycle smoke'
  );
  assert.equal(
    releaseGateSource.includes('/alerts/overview?status=Open&channel=Backtests'),
    true,
    'backtests release gate must inspect open backtests alerts'
  );
  assert.equal(
    signoffSource.includes('BACKTESTS_SIGNOFF_EXTERNAL_DASHBOARDS_VERIFIED'),
    true,
    'backtests signoff must require dashboard verification'
  );
  assert.equal(
    signoffSource.includes('BACKTESTS_SIGNOFF_UI_COMPOSURE_VERIFIED'),
    true,
    'backtests signoff must require UI composure verification'
  );
  assert.equal(
    signoffSource.includes('BACKTESTS_SIGNOFF_RESULTS_SCALING_VERIFIED'),
    true,
    'backtests signoff must require results scaling verification'
  );
}

async function main(): Promise<void> {
  await runBacktestsControllerAssertions();
  await runBacktestsOperationalAssertions();
  runBacktestStatusMappingAssertions();
  await runBacktestChartServiceAssertions();
  await runBacktestChartWarehouseSymbolResolutionAssertions();
  await runBacktestRepositorySearchAssertions();
  await runBacktestTopSetupCandidateQueryAssertions();
  await runBacktestSummaryQueryAssertions();
  runBacktestOperationalColumnExtractionAssertions();
  await runBacktestChartDelegationAssertions();
  runBacktestTopSetupsServiceAssertions();
  await runBacktestTopSetupsDelegationAssertions();
  await runBacktestRecoveryServiceAssertions();
  await runBacktestInputSnapshotServiceAssertions();
  await runBacktestInputSnapshotDelegationAssertions();
  await runBacktestRecoveryDelegationAssertions();
  await runBacktestRecoveryFailureAlertAssertions();
  await runBacktestUpdateResultsAssertions();
  await runBacktestAutomationSyncAssertions();
  runRegisteredSmcBacktestPayloadAssertions();
  await runBacktestCreateFailureAlertAssertions();
  await runBacktestPromotionSnapshotAssertions();
  await runBacktestPromotionIdempotencyAssertions();
  await runBacktestPromotionServiceFailureAlertAssertions();
  await runBacktestPromotionDelegationAssertions();
  await runBacktestPromotionFailureAlertAssertions();
  await runBacktestBatchPromotionAssertions();
  await runBacktestBatchPromotionAllFailedAlertAssertions();
  await runBacktestBatchPromotionTimeframeMergeAssertions();
  runBacktestsScriptWiringAssertions();
  console.log('Backtests module assertions passed.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
