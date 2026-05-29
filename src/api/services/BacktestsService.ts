import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import {
  BacktestAutomationSyncResult,
  BacktestChartResponse,
  BacktestInputSnapshotResponse,
  BacktestItem,
  BacktestTopSetupItem,
  RecoverBacktestResult,
  BacktestRunStatus,
  BacktestsListResponse,
  BacktestsSummary,
  BacktestsTopSetupsResponse,
  CreateBacktestBody,
  PromoteBacktestBatchBody,
  PromoteBacktestBatchResult,
  CreateBacktestResult,
  PromoteBacktestBody,
  PromoteBacktestResult,
  UpdateBacktestResultBody,
} from '../contracts/Backtest';
import {
  BadRequestAppError,
  NotFoundAppError,
} from '../errors/AppError';
import { successResponse } from '../utils/response';
import {
  BacktestChartQuery,
  BacktestTopSetupsQuery,
  BacktestsQuery,
  validateBacktestId,
  validateBacktestTopSetupsQuery,
  validateBacktestsQuery,
  validateCreateBacktestBody,
  validatePromoteBacktestBatchBody,
  validatePromoteBacktestBody,
  validateUpdateBacktestResultBody,
} from '../validators/backtests.validator';
import {
  Backtest,
  AppSettingsRepository,
  BacktestRepository,
  BacktestTradeRepository,
} from '../../database';
import type { BacktestTradeInsertPayload } from '../../database/repositories/BacktestTradeRepository';
import { OperationalEventService } from './OperationalEventService';
import { AutomationExecutionService } from './AutomationExecutionService';
import { BacktestChartService } from './BacktestChartService';
import { BacktestPromotionService } from './BacktestPromotionService';
import { BacktestReadModelService } from './BacktestReadModelService';
import { BacktestRecoveryService } from './BacktestRecoveryService';
import { BacktestSnapshotService } from './BacktestSnapshotService';
import { BacktestTopSetupsService } from './BacktestTopSetupsService';
import type { BacktestPromotionRules } from '../contracts/Settings';
import type { SolSmcOnePositionStrategyResult } from '../contracts/Strategy';
import { resolveBacktestPromotionRules } from '../utils/backtestPromotionRules';
import {
  SOL_SMC_ONE_POSITION_BACKTEST_STRATEGY,
  SOL_SMC_ONE_POSITION_STRATEGY_ID,
  runSolSmcOnePositionBacktest,
} from '../strategies/implementations/SolSmcOnePositionStrategy';

@Service()
export class BacktestsService {
  @Inject(() => AppSettingsRepository)
  private appSettingsRepository!: AppSettingsRepository;

  @Inject(() => BacktestRepository)
  private backtestRepository!: BacktestRepository;

  @Inject(() => BacktestTradeRepository)
  private backtestTradeRepository!: BacktestTradeRepository;

  @Inject(() => OperationalEventService)
  private operationalEventService!: OperationalEventService;

  @Inject(() => AutomationExecutionService)
  private automationExecutionService!: AutomationExecutionService;

  @Inject(() => BacktestChartService)
  private backtestChartService!: BacktestChartService;

  @Inject(() => BacktestPromotionService)
  private backtestPromotionService!: BacktestPromotionService;

  @Inject(() => BacktestReadModelService)
  private backtestReadModelService!: BacktestReadModelService;

  @Inject(() => BacktestRecoveryService)
  private backtestRecoveryService!: BacktestRecoveryService;

  @Inject(() => BacktestSnapshotService)
  private backtestSnapshotService!: BacktestSnapshotService;

  @Inject(() => BacktestTopSetupsService)
  private backtestTopSetupsService!: BacktestTopSetupsService;

  async getBacktests(userId: string, query: BacktestsQuery): Promise<ApiSuccessResponse<BacktestsListResponse>> {
    const params = validateBacktestsQuery(query);
    const { data, total } = await this.backtestRepository.listBacktests(userId, params);
    const storedTradeCounts = await this.backtestTradeRepository.getTradeCountsByBacktest(
      userId,
      data.map((backtest) => backtest.id)
    );

    return successResponse({
      items: data.map((backtest) =>
        this.mapBacktest(backtest, {
          storedTradeCount: storedTradeCounts.get(backtest.id) ?? 0,
        })
      ),
      total,
      limit: params.limit,
      offset: params.offset,
    });
  }

  async getBacktestsSummary(userId: string): Promise<ApiSuccessResponse<BacktestsSummary>> {
    const summary = await this.backtestRepository.getBacktestsSummary(userId);

    return successResponse({
      activeRuns: summary.activeRuns,
      bestCagr: this.formatPercent(summary.bestCagr),
      bestCagrLabel: summary.bestCagrLabel ?? '--',
      bestSharpe: this.formatNumber(summary.bestSharpe),
      maxDrawdown: this.formatPercent(summary.maxDrawdown),
    });
  }

  async getTopSetups(
    userId: string,
    query: BacktestTopSetupsQuery
  ): Promise<ApiSuccessResponse<BacktestsTopSetupsResponse>> {
    const params = validateBacktestTopSetupsQuery(query || {});
    const [backtests, promotionRules] = await Promise.all([
      this.backtestRepository.listTopSetupCandidateBacktests(userId, params),
      this.getUserBacktestPromotionRules(userId),
    ]);
    const storedTradeCounts = await this.backtestTradeRepository.getTradeCountsByBacktest(
      userId,
      backtests.map((backtest) => backtest.id)
    );
    const mappedBacktests = backtests.map((backtest) =>
      this.mapBacktest(backtest, {
        includeSurface: true,
        storedTradeCount: storedTradeCounts.get(backtest.id) ?? 0,
      })
    );

    return successResponse(
      this.backtestTopSetupsService.buildResponse(
        mappedBacktests,
        params,
        promotionRules
      )
    );
  }

  async getBacktestById(userId: string, backtestId: string): Promise<ApiSuccessResponse<BacktestItem>> {
    const backtest = await this.requireBacktest(userId, backtestId);
    const storedTradeCounts = await this.backtestTradeRepository.getTradeCountsByBacktest(userId, [
      backtest.id,
    ]);
    return successResponse(
      this.mapBacktest(backtest, {
        includeSurface: true,
        storedTradeCount: storedTradeCounts.get(backtest.id) ?? 0,
      })
    );
  }

  async getBacktestInputSnapshot(
    userId: string,
    backtestId: string
  ): Promise<ApiSuccessResponse<BacktestInputSnapshotResponse>> {
    const backtest = await this.requireBacktest(userId, backtestId);

    return successResponse(
      this.backtestSnapshotService.buildInputSnapshotResponse(backtest, this.mapBacktest(backtest))
    );
  }

  async getBacktestChart(
    userId: string,
    backtestId: string,
    query: BacktestChartQuery
  ): Promise<ApiSuccessResponse<BacktestChartResponse>> {
    return this.backtestChartService.getBacktestChart(userId, backtestId, query);
  }

  async updateBacktestResults(
    userId: string,
    backtestId: string,
    body: UpdateBacktestResultBody
  ): Promise<ApiSuccessResponse<BacktestItem>> {
    const validatedId = validateBacktestId(backtestId);
    const validatedBody = validateUpdateBacktestResultBody(body || {});
    const { tradeEvents, ...resultPayload } = validatedBody;
    const payload = { ...resultPayload } as UpdateBacktestResultBody;

    if (payload.trades === undefined && tradeEvents?.length) {
      payload.trades = tradeEvents.length;
    }

    const updated = await this.backtestRepository.updateBacktestResult(
      userId,
      validatedId,
      payload
    );

    if (!updated) {
      throw new NotFoundAppError('Backtest not found');
    }

    if (tradeEvents?.length) {
      await this.backtestTradeRepository.insertTrades(
        tradeEvents.map((event) => ({
          ...event,
          userId,
          backtestId: validatedId,
        }))
      );
    }

    await this.automationExecutionService.syncBacktestRunnerLifecycleByBacktestId(validatedId);

    return successResponse(this.mapBacktest(updated, { includeSurface: true }));
  }

  async recoverBacktestFromCheckpoint(
    userId: string,
    backtestId: string
  ): Promise<ApiSuccessResponse<RecoverBacktestResult>> {
    const validatedBacktestId = validateBacktestId(backtestId);

    try {
      const backtest = await this.requireBacktest(userId, validatedBacktestId);
      const runStatus = this.resolveRunStatus(backtest);
      const recoveryPlan = this.backtestRecoveryService.buildRecoveryPlan(backtest, runStatus);

      const updated = await this.backtestRepository.updateBacktestResult(userId, backtest.id, {
        status: recoveryPlan.status,
        stability: recoveryPlan.stability,
        config: recoveryPlan.nextConfig,
      });

      if (!updated) {
        throw new NotFoundAppError('Backtest not found');
      }

      const storedTradeCounts = await this.backtestTradeRepository.getTradeCountsByBacktest(
        userId,
        [updated.id]
      );

      await this.operationalEventService.logActivity(userId, {
        type: 'Backtest',
        title: `Backtest recovered: ${updated.name}`,
        status: 'Success',
        route: 'Backtests',
        stream: 'Runs',
        related: updated.symbol,
        referenceId: updated.id,
        description: 'Backtest re-queued from resume checkpoint',
      });

      return successResponse({
        message: recoveryPlan.message,
        backtest: this.mapBacktest(updated, {
          includeSurface: true,
          storedTradeCount: storedTradeCounts.get(updated.id) ?? 0,
        }),
      });
    } catch (error) {
      await this.operationalEventService.logActivity(userId, {
        type: 'Backtest',
        title: 'Backtest recovery failed',
        status: 'Failed',
        route: 'Backtests',
        stream: 'Runs',
        referenceId: validatedBacktestId,
        description: error instanceof Error ? error.message : String(error),
      });
      await this.operationalEventService.emitFailureAlert(userId, {
        channel: 'Backtests',
        source: 'backtests:recovery',
        message: `Backtest recovery failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        route: 'Backtests',
      });
      throw error;
    }
  }

  async syncBacktestAutomationLifecycle(
    backtestId: string
  ): Promise<ApiSuccessResponse<BacktestAutomationSyncResult>> {
    const validatedId = validateBacktestId(backtestId);

    await this.syncRegisteredStrategyBacktestResultIfNeeded(validatedId);

    const result = await this.automationExecutionService.syncBacktestRunnerLifecycleByBacktestId(
      validatedId
    );

    return successResponse({
      synced: result.synced,
      backtestId: validatedId,
      automationId: result.automationId ?? null,
      automationRunId: result.automationRunId ?? null,
      message: result.synced
        ? 'Backtest automation lifecycle synchronized'
        : 'No linked automation run found for this backtest',
    });
  }

  private async syncRegisteredStrategyBacktestResultIfNeeded(backtestId: string): Promise<void> {
    const backtest = await this.backtestRepository.getBacktestByIdAny(backtestId);
    if (!backtest?.result) {
      return;
    }

    const config = this.parseRecord(backtest.result.config) ?? {};
    if (!this.isSolSmcRegisteredBacktest(backtest, config)) {
      return;
    }

    const timeframe = this.resolveBacktestTimeframe(backtest, config);
    if (timeframe !== '3m') {
      return;
    }

    const execution = (await runSolSmcOnePositionBacktest({
      writeArtifacts: false,
      writeCharts: false,
    })) as Record<string, any>;
    const report = execution.report as Record<string, any>;
    const result = (Array.isArray(report.results) ? report.results[0] : null) as Record<
      string,
      any
    > | null;
    if (!result) {
      throw new BadRequestAppError('Registered SMC backtest produced no 3m result');
    }

    const smcResult = {
      strategyId: SOL_SMC_ONE_POSITION_STRATEGY_ID,
      strategy: SOL_SMC_ONE_POSITION_BACKTEST_STRATEGY,
      symbol: 'SOLUSDT',
      interval: '3m',
      limit: 0,
      windowStart: result.windowStart,
      windowEnd: result.windowEnd,
      validationStart: result.validationStart,
      candles: result.candles,
      settings: (report.strategy as Record<string, any>)?.settings ?? {},
      full: result.strategyResult.full,
      train: result.strategyResult.train,
      validation: result.strategyResult.validation,
      stats: result.strategyResult.stats,
      comparison: result.comparison,
      trades: result.strategyResult.trades,
      charts: result.strategyResult.charts,
      artifacts: {
        summaryPath: execution.summaryPath,
        strategyPath: execution.strategyPath,
      },
    } satisfies SolSmcOnePositionStrategyResult;

    const payload = this.buildRegisteredSolSmcResultPayload(backtest, config, smcResult);
    await this.backtestTradeRepository.deleteTradesForBacktest(backtest.userId, backtest.id);

    const updated = await this.backtestRepository.updateBacktestResult(backtest.userId, backtest.id, {
      status: payload.status,
      stability: payload.stability,
      trades: payload.trades,
      cagr: payload.cagr,
      sharpe: payload.sharpe,
      drawdown: payload.drawdown,
      winRate: payload.winRate,
      profitFactor: payload.profitFactor,
      performanceSurface: payload.performanceSurface,
      config: payload.config,
    });

    if (!updated) {
      throw new NotFoundAppError('Backtest not found');
    }

    await this.backtestTradeRepository.insertTrades(
      this.mapSmcTradesToBacktestTrades(backtest.userId, backtest.id, smcResult)
    );
  }

  private buildRegisteredSolSmcResultPayload(
    backtest: Backtest,
    config: Record<string, unknown>,
    result: SolSmcOnePositionStrategyResult
  ): {
    status: string;
    stability: string;
    trades: number;
    cagr: number;
    sharpe: number;
    drawdown: number;
    winRate: number;
    profitFactor: number;
    performanceSurface: Record<string, unknown>;
    config: Record<string, unknown>;
  } {
    const generatedAt = new Date().toISOString();
    const templateId = this.readString(config.templateId) ?? null;
    const templateName = this.readString(config.templateName) ?? backtest.strategy;
    const templateVersion = this.readNumber(config.templateVersion);
    const totalTrades = result.full.trades;
    const winRatePercent = Number((result.full.winRate * 100).toFixed(2));
    const comparisonMatches = Boolean(result.comparison?.matches);
    const surfaceResult = {
      status: comparisonMatches ? 'ok' : 'review',
      symbol: result.symbol,
      timeframe: result.interval,
      template_id: templateId,
      template_name: templateName,
      template_version: templateVersion,
      registered_strategy_id: SOL_SMC_ONE_POSITION_STRATEGY_ID,
      strategy: result.strategy,
      score: comparisonMatches ? 1 : 0.75,
      total_trades: totalTrades,
      trades: totalTrades,
      targets: result.full.targets,
      stops: result.full.stops,
      breakeven: result.full.breakeven,
      expired: result.full.expired,
      win_rate: result.full.winRate,
      win_rate_pct: winRatePercent,
      total_r: result.full.totalR,
      avg_r: result.full.avgR,
      validation_r: result.validation.totalR,
      train_r: result.train.totalR,
      max_drawdown_r: result.stats.maxDrawdownR,
      max_open_trades: result.stats.maxOpenTrades,
      profit_factor: result.stats.profitFactor,
      total_return_pct: result.full.totalR,
      max_drawdown_pct: result.stats.maxDrawdownR,
      candles: result.candles,
      window_start: result.windowStart,
      window_end: result.windowEnd,
      validation_start: result.validationStart,
      comparison: result.comparison,
      tradeEventCount: totalTrades,
      simulation_mode: 'registered-backend-r-engine',
      units: 'R',
    };
    const progress = {
      state: 'completed',
      processed: 1,
      total: 1,
      percent: 100,
      etaSeconds: 0,
      startedAt: generatedAt,
      updatedAt: generatedAt,
      finishedAt: generatedAt,
      assetsCount: 1,
      timeframesCount: 1,
      combinationsCount: 1,
      okCount: comparisonMatches ? 1 : 0,
      failedCount: 0,
      noDataCount: 0,
      skippedCount: 0,
      tradeEventCount: totalTrades,
      latestItem: {
        symbol: result.symbol,
        timeframe: result.interval,
        status: comparisonMatches ? 'ok' : 'review',
        totalTrades,
      },
      error: null,
      resumeCount: 0,
      resumedFromCheckpoint: false,
    };
    const resumeCheckpoint = {
      version: 1,
      state: 'completed',
      startedAt: generatedAt,
      lastUpdatedAt: generatedAt,
      finishedAt: generatedAt,
      resumeCount: 0,
      resumedFromCheckpoint: false,
      completedCombinations: 1,
      totalCombinations: 1,
      tradeEventCount: totalTrades,
      resultsSummary: {
        processed: 1,
        okCount: comparisonMatches ? 1 : 0,
        failedCount: 0,
        noDataCount: 0,
        skippedCount: 0,
      },
    };
    const performanceSurface = {
      best: surfaceResult,
      count: 1,
      results: [surfaceResult],
      generatedAt,
      source: 'registered-backend-strategy',
      units: 'R',
    };
    const smcMetrics = {
      desiredOutput: {
        trades: 29,
        winRatePct: 34.5,
        totalR: 83.18,
        validationR: 21.8,
        maxDrawdownR: 3,
        maxOpenTrades: 1,
      },
      actualOutput: {
        trades: totalTrades,
        winRatePct: winRatePercent,
        totalR: result.full.totalR,
        validationR: result.validation.totalR,
        maxDrawdownR: result.stats.maxDrawdownR,
        maxOpenTrades: result.stats.maxOpenTrades,
      },
      comparison: result.comparison,
    };

    return {
      status: comparisonMatches ? 'Stable' : 'Review',
      stability: comparisonMatches ? 'Stable' : 'Review',
      trades: totalTrades,
      cagr: result.full.totalR,
      sharpe: result.validation.totalR,
      drawdown: result.stats.maxDrawdownR,
      winRate: winRatePercent,
      profitFactor: result.stats.profitFactor,
      performanceSurface,
      config: {
        ...config,
        engine: 'registered-backend-strategy',
        registeredStrategyId: SOL_SMC_ONE_POSITION_STRATEGY_ID,
        registeredStrategy: SOL_SMC_ONE_POSITION_BACKTEST_STRATEGY,
        start: result.windowStart,
        end: result.windowEnd,
        limit: 0,
        progress,
        progressPercent: 100,
        progressProcessed: 1,
        progressTotal: 1,
        resumeCheckpoint,
        tradeEventCount: totalTrades,
        smcMetrics,
        performanceSurface,
      },
    };
  }

  private mapSmcTradesToBacktestTrades(
    userId: string,
    backtestId: string,
    result: SolSmcOnePositionStrategyResult
  ): BacktestTradeInsertPayload[] {
    return result.trades.map((trade) => ({
      userId,
      backtestId,
      symbol: result.symbol,
      interval: result.interval,
      side: trade.side === 'long' ? 'BUY' : 'SELL',
      entryTime: new Date(trade.entryTime).getTime(),
      entryPrice: trade.entryPrice,
      exitTime: new Date(trade.exitTime).getTime(),
      exitPrice: trade.exitPrice,
    }));
  }

  private isSolSmcRegisteredBacktest(
    backtest: Backtest,
    config: Record<string, unknown>
  ): boolean {
    const template = this.parseRecord(config.template);
    const inputSnapshot = this.parseRecord(config.inputSnapshot);
    const snapshotTemplate = this.parseRecord(inputSnapshot?.template);
    const templateConfig = this.parseRecord(template?.config) ?? {};
    const snapshotTemplateConfig = this.parseRecord(snapshotTemplate?.config) ?? {};
    const haystack = [
      backtest.name,
      backtest.strategy,
      backtest.parameter,
      config.templateName,
      config.registeredStrategyId,
      inputSnapshot?.templateName,
      template?.name,
      snapshotTemplate?.name,
      templateConfig.codeDefinition,
      snapshotTemplateConfig.codeDefinition,
      templateConfig.notes,
      snapshotTemplateConfig.notes,
    ]
      .map((item) => String(item || '').toLowerCase())
      .join(' ');

    return (
      String(backtest.symbol || '').toUpperCase() === 'SOLUSDT' &&
      (haystack.includes('smc - advanced') ||
        haystack.includes('smcadvanced') ||
        haystack.includes(SOL_SMC_ONE_POSITION_STRATEGY_ID))
    );
  }

  private resolveBacktestTimeframe(backtest: Backtest, config: Record<string, unknown>): string {
    const inputSnapshot = this.parseRecord(config.inputSnapshot);
    const candidates = [
      this.firstStringFromArray(config.timeframes),
      this.firstStringFromArray(inputSnapshot?.timeframes),
      this.extractTimeframe(backtest.parameter),
      this.extractTimeframe(backtest.name),
    ];

    return (
      candidates
        .map((item) => String(item || '').trim().toLowerCase())
        .find(Boolean) || ''
    );
  }

  private firstStringFromArray(value: unknown): string | null {
    if (!Array.isArray(value)) {
      return null;
    }
    const found = value.map((item) => String(item || '').trim()).find(Boolean);
    return found || null;
  }

  private extractTimeframe(value: unknown): string | null {
    const match = String(value || '').match(/\b(\d+\s*[mhd])\b/i);
    return match ? match[1].replace(/\s+/g, '').toLowerCase() : null;
  }

  private parseRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    return value as Record<string, unknown>;
  }

  private readString(value: unknown): string | null {
    const trimmed = String(value || '').trim();
    return trimmed || null;
  }

  private readNumber(value: unknown): number | null {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }

  async createBacktest(
    userId: string,
    body: CreateBacktestBody
  ): Promise<ApiSuccessResponse<CreateBacktestResult>> {
    try {
      const validatedBody = validateCreateBacktestBody(body);

      const backtest = await this.backtestRepository.createQueuedBacktest(userId, {
        name: `${validatedBody.universe} ${validatedBody.interval}`,
        strategy: 'Queued Strategy Run',
        symbol: validatedBody.benchmark,
        parameter: `${validatedBody.universe} / ${validatedBody.benchmark}`,
        status: 'Queued',
        stability: 'Queued',
        trades: 0,
        config: validatedBody as unknown as Record<string, unknown>,
      });

      await this.operationalEventService.logActivity(userId, {
        type: 'Backtest',
        title: `Backtest created: ${backtest.name}`,
        status: 'Success',
        route: 'Backtests',
        stream: 'Runs',
        related: backtest.symbol,
        referenceId: backtest.id,
        description: 'Backtest queued for execution',
      });

      return successResponse({
        message: 'Backtest created',
        backtest: {
          id: backtest.id,
          status: backtest.status as CreateBacktestResult['backtest']['status'],
          createdAt: backtest.createdAt.toISOString(),
        },
      });
    } catch (error) {
      await this.operationalEventService.logActivity(userId, {
        type: 'Backtest',
        title: 'Backtest create failed',
        status: 'Failed',
        route: 'Backtests',
        stream: 'Runs',
        description: error instanceof Error ? error.message : String(error),
      });
      await this.operationalEventService.emitFailureAlert(userId, {
        channel: 'Backtests',
        source: 'backtests',
        message: `Backtest create failed: ${error instanceof Error ? error.message : String(error)}`,
        route: 'Risk review',
      });
      throw error;
    }
  }

  async promoteBacktestToAutomation(
    userId: string,
    backtestId: string,
    body: PromoteBacktestBody = {}
  ): Promise<ApiSuccessResponse<PromoteBacktestResult>> {
    const validatedId = validateBacktestId(backtestId);
    const payload = validatePromoteBacktestBody(body || {});

    try {
      const { backtest, rankedTopSetups } = await this.buildPromotionContext(userId, validatedId);
      const selectedTopSetup = this.resolvePromotionTarget(rankedTopSetups, payload);

      return await this.backtestPromotionService.promoteResolvedTopSetup({
        userId,
        backtest,
        payload,
        selectedTopSetup,
      });
    } catch (error) {
      await this.operationalEventService.logActivity(userId, {
        type: 'Automation',
        title: 'Backtest promotion failed',
        status: 'Failed',
        route: 'Backtests',
        stream: 'Deployments',
        referenceId: validatedId,
        description: error instanceof Error ? error.message : String(error),
      });
      await this.operationalEventService.emitFailureAlert(userId, {
        channel: 'Backtests',
        source: 'backtests:promotion',
        message: `Backtest promotion failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        route: 'Backtests',
      });
      throw error;
    }
  }

  async promoteBacktestBatchToAutomation(
    userId: string,
    backtestId: string,
    body: PromoteBacktestBatchBody
  ): Promise<ApiSuccessResponse<PromoteBacktestBatchResult>> {
    const validatedId = validateBacktestId(backtestId);
    const payload = validatePromoteBacktestBatchBody(body);

    try {
      const results: PromoteBacktestBatchResult['results'] = [];
      const contextCache = new Map<
        string,
        Promise<{ backtest: Backtest; rankedTopSetups: BacktestTopSetupItem[] }>
      >();
      contextCache.set(validatedId, this.buildPromotionContext(userId, validatedId));
      const getPromotionContext = (id: string) => {
        const scopedId = validateBacktestId(id);
        if (!contextCache.has(scopedId)) {
          contextCache.set(scopedId, this.buildPromotionContext(userId, scopedId));
        }
        return contextCache.get(scopedId)!;
      };
      const resolvedEntries: Array<{
        item: (typeof payload.items)[number];
        backtest: Backtest;
        selectedTopSetup: BacktestTopSetupItem;
      }> = [];

      for (const item of payload.items) {
        const itemBacktestId = item.backtestId || validatedId;
        const scopedPayload: PromoteBacktestBody = {
          name: item.name ?? payload.name,
          broker: payload.broker,
          trigger: payload.trigger,
          riskMode: payload.riskMode,
          status: payload.status,
          timeZone: payload.timeZone,
          executionPolicy: payload.executionPolicy,
          schedule: payload.schedule,
          symbol: item.symbol,
          timeframe: item.timeframe,
        };

        try {
          const { backtest, rankedTopSetups } = await getPromotionContext(itemBacktestId);
          const selectedTopSetup = this.resolvePromotionTarget(rankedTopSetups, scopedPayload);
          resolvedEntries.push({
            item,
            backtest,
            selectedTopSetup,
          });
        } catch (error) {
          results.push({
            symbol: item.symbol,
            symbols: [item.symbol],
            timeframe: item.timeframe,
            itemCount: 1,
            status: 'failed',
            message: error instanceof Error ? error.message : String(error),
            automation: null,
          });
        }
      }

      const timeframeGroups = resolvedEntries.reduce(
        (accumulator, entry) => {
          const key = String(entry.selectedTopSetup.timeframe || entry.item.timeframe || '').trim();
          if (!key) {
            return accumulator;
          }
          if (!accumulator[key]) {
            accumulator[key] = [];
          }
          accumulator[key].push(entry);
          return accumulator;
        },
        {} as Record<string, typeof resolvedEntries>
      );

      for (const [timeframe, entries] of Object.entries(timeframeGroups)) {
        const primaryEntry = entries[0];
        const symbols = Array.from(
          new Set(
            entries
              .map((entry) => String(entry.selectedTopSetup.symbol || entry.item.symbol || '').trim().toUpperCase())
              .filter(Boolean)
          )
        );
        const groupName = primaryEntry.item.name ?? payload.name;
        const groupPayload: PromoteBacktestBody = {
          name: groupName,
          broker: payload.broker,
          trigger: payload.trigger,
          riskMode: payload.riskMode,
          status: payload.status,
          timeZone: payload.timeZone,
          executionPolicy: payload.executionPolicy,
          schedule: payload.schedule,
          symbol: symbols[0],
          timeframe,
        };

        try {
          const response =
            entries.length === 1
              ? await this.backtestPromotionService.promoteResolvedTopSetup({
                  userId,
                  backtest: primaryEntry.backtest,
                  payload: groupPayload,
                  selectedTopSetup: primaryEntry.selectedTopSetup,
                })
              : await this.backtestPromotionService.promoteResolvedTopSetupGroup({
                  userId,
                  payload: groupPayload,
                  entries: entries.map((entry) => ({
                    backtest: entry.backtest,
                    selectedTopSetup: entry.selectedTopSetup,
                  })),
                });
          const message = String(
            response.data?.message || 'Automation created from timeframe group'
          );
          results.push({
            symbol: symbols[0],
            symbols,
            timeframe,
            itemCount: entries.length,
            status: /already exists/i.test(message) ? 'reused' : 'created',
            message,
            automation: response.data?.automation ?? null,
          });
        } catch (error) {
          results.push({
            symbol: symbols[0],
            symbols,
            timeframe,
            itemCount: entries.length,
            status: 'failed',
            message: error instanceof Error ? error.message : String(error),
            automation: null,
          });
        }
      }

      const summary = {
        requested: results.length,
        created: results.filter((item) => item.status === 'created').length,
        reused: results.filter((item) => item.status === 'reused').length,
        failed: results.filter((item) => item.status === 'failed').length,
      };
      const message =
        summary.failed > 0
          ? `Batch deployment completed with ${summary.created} created, ${summary.reused} reused, and ${summary.failed} failed.`
          : `Batch deployment completed with ${summary.created} created and ${summary.reused} reused.`;

      await this.operationalEventService.logActivity(userId, {
        type: 'Automation',
        title: 'Backtest batch promotion completed',
        status: summary.failed > 0 && !summary.created && !summary.reused ? 'Failed' : 'Success',
        route: 'Backtests',
        stream: 'Deployments',
        referenceId: validatedId,
        description: message,
      });

      if (summary.failed > 0 && !summary.created && !summary.reused) {
        await this.operationalEventService.emitFailureAlert(userId, {
          channel: 'Backtests',
          source: 'backtests:promotion-batch',
          message: `Backtest batch promotion failed for all ${summary.failed} timeframe group(s).`,
          route: 'Backtests',
        });
      }

      return successResponse({
        message,
        summary,
        results,
      });
    } catch (error) {
      await this.operationalEventService.logActivity(userId, {
        type: 'Automation',
        title: 'Backtest batch promotion failed',
        status: 'Failed',
        route: 'Backtests',
        stream: 'Deployments',
        referenceId: validatedId,
        description: error instanceof Error ? error.message : String(error),
      });
      await this.operationalEventService.emitFailureAlert(userId, {
        channel: 'Backtests',
        source: 'backtests:promotion-batch',
        message: `Backtest batch promotion failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        route: 'Backtests',
      });
      throw error;
    }
  }

  private async buildPromotionContext(
    userId: string,
    validatedId: string
  ): Promise<{ backtest: Backtest; rankedTopSetups: BacktestTopSetupItem[] }> {
    const backtest = await this.backtestRepository.getBacktestById(userId, validatedId);

    if (!backtest) {
      throw new NotFoundAppError('Backtest not found');
    }

    const storedTradeCount = (
      await this.backtestTradeRepository.getTradeCountsByBacktest(userId, [backtest.id])
    ).get(backtest.id) ?? 0;
    const promotionRules = await this.getUserBacktestPromotionRules(userId);
    const mappedBacktest = this.mapBacktest(backtest, {
      includeSurface: true,
      storedTradeCount,
    });
    const rankedTopSetups = this.backtestTopSetupsService.rankBacktestTopSetups(
      mappedBacktest,
      promotionRules
    );

    return { backtest, rankedTopSetups };
  }

  private resolvePromotionTarget(
    rankedTopSetups: BacktestTopSetupItem[],
    payload: PromoteBacktestBody
  ): BacktestTopSetupItem {
    const selectedTopSetup =
      payload.symbol && payload.timeframe
        ? rankedTopSetups.find(
            (item) => item.symbol === payload.symbol && item.timeframe === payload.timeframe
          ) || null
        : rankedTopSetups[0] || null;

    if (payload.symbol || payload.timeframe) {
      if (!payload.symbol || !payload.timeframe) {
        throw new BadRequestAppError(
          'symbol and timeframe must both be provided to scope automation to a top setup'
        );
      }
      if (!selectedTopSetup) {
        throw new NotFoundAppError('Selected top setup was not found on this backtest');
      }
    }

    if (!selectedTopSetup) {
      throw new BadRequestAppError(
        'No promotable top setup was found on this backtest yet. Review Top Setups or rerun the backtest with robustness validation.'
      );
    }

    if (!selectedTopSetup.eligibleForAutomation) {
      throw new BadRequestAppError(
        `Selected top setup is not automation-ready: ${selectedTopSetup.automationEligibilityReasons.join(', ')}`
      );
    }

    return selectedTopSetup;
  }

  private async requireBacktest(userId: string, backtestId: string): Promise<Backtest> {
    const validatedBacktestId = validateBacktestId(backtestId);
    const backtest = await this.backtestRepository.getBacktestById(userId, validatedBacktestId);

    if (!backtest) {
      throw new NotFoundAppError('Backtest not found');
    }

    return backtest;
  }

  private mapBacktest(
    backtest: Backtest,
    options: { includeSurface?: boolean; storedTradeCount?: number | null } = {}
  ): BacktestItem {
    return this.backtestReadModelService.mapBacktest(backtest, options);
  }

  private async getUserBacktestPromotionRules(
    userId: string
  ): Promise<BacktestPromotionRules> {
    const settings = await this.appSettingsRepository.getSettings(userId);
    return resolveBacktestPromotionRules(settings?.backtestPromotionRules);
  }

  private resolveRunStatus(backtest: Backtest): BacktestRunStatus {
    return this.backtestReadModelService.resolveRunStatus(backtest);
  }

  private formatPercent(value: number | null): string {
    return value === null ? '--' : `${value}%`;
  }

  private formatNumber(value: number | null): string {
    return value === null ? '--' : String(value);
  }
}
