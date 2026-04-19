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
import { OperationalEventService } from './OperationalEventService';
import { AutomationExecutionService } from './AutomationExecutionService';
import { BacktestChartService } from './BacktestChartService';
import { BacktestPromotionService } from './BacktestPromotionService';
import { BacktestReadModelService } from './BacktestReadModelService';
import { BacktestRecoveryService } from './BacktestRecoveryService';
import { BacktestSnapshotService } from './BacktestSnapshotService';
import { BacktestTopSetupsService } from './BacktestTopSetupsService';
import type { BacktestPromotionRules } from '../contracts/Settings';
import { resolveBacktestPromotionRules } from '../utils/backtestPromotionRules';

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
