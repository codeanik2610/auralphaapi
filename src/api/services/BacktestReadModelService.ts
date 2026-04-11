import { Service } from 'typedi';
import {
  BacktestExecutionAssumptions,
  BacktestItem,
  BacktestLineage,
  BacktestPortfolioSummary,
  BacktestProgress,
  BacktestResumeCheckpoint,
  BacktestRunStatus,
  BacktestTemplateDiffSummary,
} from '../contracts/Backtest';
import { buildStrategyTemplateAutomationProfile } from '../utils/strategyTemplateAutomation';
import { Backtest } from '../../database';

@Service()
export class BacktestReadModelService {
  private static readonly ACTIVE_RUN_STATUSES = new Set([
    'queued',
    'running',
    'started',
    'processing',
    'in_progress',
    'in-progress',
  ]);

  mapBacktest(
    backtest: Backtest,
    options: { includeSurface?: boolean; storedTradeCount?: number | null } = {}
  ): BacktestItem {
    const runStatus = this.resolveRunStatus(backtest);
    const assessmentStatus = this.resolveAssessmentStatus(backtest);
    const config = this.parseConfig(backtest.result?.config) ?? {};
    const inputSnapshot = this.parseConfig(config.inputSnapshot) ?? {};
    const templateDiffSummary = this.parseTemplateDiffSummary(
      inputSnapshot.templateDiffSummary ?? config.templateDiffSummary
    );
    const template =
      this.parseConfig(inputSnapshot.template) ??
      this.parseConfig(config.template) ??
      {};
    const templateId =
      typeof inputSnapshot.templateId === 'string'
        ? inputSnapshot.templateId
        : typeof config.templateId === 'string'
          ? config.templateId
          : typeof template.id === 'string'
            ? template.id
            : null;
    const libraryName =
      typeof inputSnapshot.libraryName === 'string'
        ? inputSnapshot.libraryName
        : typeof config.libraryName === 'string'
          ? config.libraryName
          : null;
    const templateName =
      typeof inputSnapshot.templateName === 'string'
        ? inputSnapshot.templateName
        : typeof template.name === 'string'
        ? template.name
        : typeof config.templateName === 'string'
          ? config.templateName
          : null;
    const templateVersion =
      typeof inputSnapshot.templateVersion === 'number'
        ? inputSnapshot.templateVersion
        : typeof config.templateVersion === 'number'
          ? config.templateVersion
          : typeof template.templateVersion === 'number'
            ? template.templateVersion
            : null;
    const sourceTemplateId =
      typeof inputSnapshot.sourceTemplateId === 'string'
        ? inputSnapshot.sourceTemplateId
        : typeof config.sourceTemplateId === 'string'
          ? config.sourceTemplateId
          : null;
    const sourceTemplateVersion =
      typeof inputSnapshot.sourceTemplateVersion === 'number'
        ? inputSnapshot.sourceTemplateVersion
        : typeof config.sourceTemplateVersion === 'number'
          ? config.sourceTemplateVersion
          : null;
    const sourceTemplateName =
      typeof inputSnapshot.sourceTemplateName === 'string'
        ? inputSnapshot.sourceTemplateName
        : typeof config.sourceTemplateName === 'string'
          ? config.sourceTemplateName
          : null;
    const dateRangeStart = this.resolveDateRangeValue(inputSnapshot, config, [
      'start',
      'startDate',
      'from',
    ]);
    const dateRangeEnd = this.resolveDateRangeValue(inputSnapshot, config, [
      'end',
      'endDate',
      'to',
    ]);
    const projectVersion =
      typeof inputSnapshot.projectVersion === 'number'
        ? inputSnapshot.projectVersion
        : typeof config.projectVersion === 'number'
          ? config.projectVersion
          : null;
    const sourceType =
      typeof inputSnapshot.sourceType === 'string'
        ? inputSnapshot.sourceType
        : typeof config.sourceType === 'string'
          ? config.sourceType
          : null;
    const sourceId =
      typeof inputSnapshot.sourceId === 'string'
        ? inputSnapshot.sourceId
        : typeof config.sourceId === 'string'
          ? config.sourceId
          : null;
    const libraryId =
      typeof inputSnapshot.libraryId === 'string'
        ? inputSnapshot.libraryId
        : typeof config.libraryId === 'string'
          ? config.libraryId
          : null;
    const projectId =
      typeof inputSnapshot.projectId === 'string'
        ? inputSnapshot.projectId
        : typeof config.projectId === 'string'
          ? config.projectId
          : null;
    const lineage = this.buildBacktestLineage({
      sourceType,
      sourceId,
      libraryId,
      libraryName,
      projectId,
      projectVersion,
      templateId,
      templateName,
      templateVersion,
      sourceTemplateId,
      sourceTemplateName,
      sourceTemplateVersion,
      templateDiffSummary,
    });
    const templateAutomationProfile = buildStrategyTemplateAutomationProfile(template);
    const expectedTradeEvents = this.getExpectedTradeEventCount(
      backtest.result?.tradeEventCount ?? null,
      config
    );
    const storedTradeEvents =
      typeof options.storedTradeCount === 'number' && Number.isFinite(options.storedTradeCount)
        ? Math.max(0, Math.trunc(options.storedTradeCount))
        : null;
    const progress = this.parseBacktestProgress(config.progress);
    const resumeCheckpoint = this.parseBacktestResumeCheckpoint(config.resumeCheckpoint);
    const executionAssumptions = this.parseBacktestExecutionAssumptions(
      config.executionAssumptions ??
        this.parseConfig(config.performanceSurface)?.executionAssumptions
    );
    const portfolioSummary = this.parseBacktestPortfolioSummary(
      config.portfolioSummary ??
        this.parseConfig(config.performanceSurface)?.portfolioSummary
    );
    const hasIncompleteTradeHistory =
      expectedTradeEvents !== null &&
      storedTradeEvents !== null &&
      expectedTradeEvents > storedTradeEvents;

    return {
      id: backtest.id,
      name: backtest.name,
      strategy: backtest.strategy,
      symbol: backtest.symbol,
      parameter: backtest.parameter,
      cagr: this.formatPercent(backtest.result?.cagr ?? null),
      sharpe: this.formatNumber(backtest.result?.sharpe ?? null),
      drawdown: this.formatPercent(backtest.result?.drawdown ?? null),
      trades: backtest.trades,
      status: backtest.status,
      runStatus,
      assessmentStatus: assessmentStatus || '--',
      winRate: this.formatPercent(backtest.result?.winRate ?? null),
      profitFactor: this.formatNumber(backtest.result?.profitFactor ?? null),
      stability: assessmentStatus || '--',
      sourceType,
      sourceId,
      libraryId,
      libraryName,
      projectId,
      projectVersion,
      templateId,
      templateName,
      templateVersion,
      sourceTemplateId,
      sourceTemplateVersion,
      sourceTemplateName,
      lineage,
      dateRangeStart,
      dateRangeEnd,
      templateDiffSummary,
      templateAutomationReady: templateAutomationProfile.automationReady,
      templateAutomationReasons: templateAutomationProfile.readinessReasons,
      expectedTradeEvents,
      storedTradeEvents,
      hasIncompleteTradeHistory,
      progress,
      resumeCheckpoint,
      executionAssumptions,
      portfolioSummary,
      performanceSurface: options.includeSurface ? this.getPerformanceSurface(backtest) : undefined,
      createdAt: backtest.createdAt.toISOString(),
    };
  }

  resolveRunStatus(backtest: Backtest): BacktestRunStatus {
    const fromStatus = this.normalizeRunStatus(backtest.status);
    if (fromStatus) {
      return fromStatus;
    }

    const fromStability = this.normalizeRunStatus(backtest.stability);
    if (fromStability) {
      return fromStability;
    }

    const hasAssessment =
      Boolean(this.cleanStatusValue(backtest.stability)) || Boolean(this.cleanStatusValue(backtest.status));

    return hasAssessment ? 'Completed' : 'Queued';
  }

  private resolveAssessmentStatus(backtest: Backtest): string | null {
    const stability = this.cleanStatusValue(backtest.stability);
    if (stability && !this.normalizeRunStatus(stability)) {
      return stability;
    }

    const status = this.cleanStatusValue(backtest.status);
    if (status && !this.normalizeRunStatus(status)) {
      return status;
    }

    return null;
  }

  private normalizeRunStatus(value: unknown): BacktestRunStatus | null {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return null;
    if (normalized === 'failed' || normalized === 'error') {
      return 'Failed';
    }
    if (BacktestReadModelService.ACTIVE_RUN_STATUSES.has(normalized)) {
      return normalized === 'queued' ? 'Queued' : 'Running';
    }
    if (['completed', 'complete', 'finished', 'done', 'success', 'succeeded'].includes(normalized)) {
      return 'Completed';
    }
    return null;
  }

  private cleanStatusValue(value: unknown): string | null {
    const trimmed = String(value || '').trim();
    return trimmed || null;
  }

  private buildBacktestLineage(lineage: BacktestLineage): BacktestLineage | null {
    return Object.values(lineage).some((item) => item !== null && item !== undefined && item !== '')
      ? lineage
      : null;
  }

  private getPerformanceSurface(backtest: Backtest): unknown {
    const config = this.parseConfig(backtest.result?.config);
    if (!config) {
      return null;
    }
    return config.performanceSurface ?? null;
  }

  private getExpectedTradeEventCount(
    storedTradeEventCount: number | null,
    config: Record<string, unknown> | null
  ): number | null {
    if (
      typeof storedTradeEventCount === 'number' &&
      Number.isFinite(storedTradeEventCount) &&
      storedTradeEventCount >= 0
    ) {
      return Math.max(0, Math.trunc(storedTradeEventCount));
    }

    if (!config) {
      return null;
    }

    const directCount = Number(config.tradeEventCount);
    if (Number.isFinite(directCount) && directCount >= 0) {
      return Math.max(0, Math.trunc(directCount));
    }

    const surface = this.parseConfig(config.performanceSurface);
    const results = Array.isArray(surface?.results) ? surface.results : [];
    let total = 0;
    let found = false;

    results.forEach((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return;
      }
      const row = item as Record<string, unknown>;
      const rawCount = Number(row.total_trades ?? row.trades);
      if (!Number.isFinite(rawCount) || rawCount < 0) {
        return;
      }
      total += Math.max(0, Math.trunc(rawCount));
      found = true;
    });

    return found ? total : null;
  }

  private parseConfig(value: unknown): Record<string, unknown> | null {
    if (!value) return null;
    if (typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        return null;
      }
    }
    return null;
  }

  private parseTemplateDiffSummary(value: unknown): BacktestTemplateDiffSummary | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    const summary = value as Record<string, unknown>;
    const changedCount = Number(summary.changedCount);
    const inheritedCount = Number(summary.inheritedCount);
    const changedFields = Array.isArray(summary.changedFields)
      ? summary.changedFields
          .map((item) => String(item || '').trim())
          .filter(Boolean)
      : [];

    if (!Number.isFinite(changedCount) && !Number.isFinite(inheritedCount) && !changedFields.length) {
      return null;
    }

    return {
      changedCount: Number.isFinite(changedCount)
        ? Math.max(0, Math.trunc(changedCount))
        : changedFields.length,
      inheritedCount: Number.isFinite(inheritedCount)
        ? Math.max(0, Math.trunc(inheritedCount))
        : 0,
      changedFields,
    };
  }

  private parseBacktestProgress(value: unknown): BacktestProgress | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const raw = value as Record<string, unknown>;
    const processed = this.readNonNegativeInteger(raw.processed);
    const total = this.readNonNegativeInteger(raw.total);
    const percent = this.readFiniteNumber(raw.percent);
    const state = this.readTrimmedString(raw.state);
    const etaSeconds = this.readNonNegativeInteger(raw.etaSeconds);
    const startedAt = this.readTrimmedString(raw.startedAt);
    const updatedAt = this.readTrimmedString(raw.updatedAt);
    const finishedAt = this.readTrimmedString(raw.finishedAt);
    const assetsCount = this.readNonNegativeInteger(raw.assetsCount);
    const timeframesCount = this.readNonNegativeInteger(raw.timeframesCount);
    const combinationsCount = this.readNonNegativeInteger(raw.combinationsCount);
    const okCount = this.readNonNegativeInteger(raw.okCount);
    const failedCount = this.readNonNegativeInteger(raw.failedCount);
    const noDataCount = this.readNonNegativeInteger(raw.noDataCount);
    const skippedCount = this.readNonNegativeInteger(raw.skippedCount);
    const tradeEventCount = this.readNonNegativeInteger(raw.tradeEventCount);
    const error = this.readTrimmedString(raw.error);
    const resumeCount = this.readNonNegativeInteger(raw.resumeCount);
    const resumedFromCheckpoint =
      typeof raw.resumedFromCheckpoint === 'boolean' ? raw.resumedFromCheckpoint : null;
    const latestItem = this.parseBacktestProgressItem(raw.latestItem);

    if (
      processed === null &&
      total === null &&
      percent === null &&
      !state &&
      etaSeconds === null &&
      !startedAt &&
      !updatedAt &&
      !finishedAt &&
      assetsCount === null &&
      timeframesCount === null &&
      combinationsCount === null &&
      okCount === null &&
      failedCount === null &&
      noDataCount === null &&
      skippedCount === null &&
      tradeEventCount === null &&
      resumeCount === null &&
      resumedFromCheckpoint === null &&
      !latestItem &&
      !error
    ) {
      return null;
    }

    return {
      state,
      processed: processed ?? 0,
      total: total ?? 0,
      percent,
      etaSeconds,
      startedAt,
      updatedAt,
      finishedAt,
      assetsCount,
      timeframesCount,
      combinationsCount,
      okCount,
      failedCount,
      noDataCount,
      skippedCount,
      tradeEventCount,
      latestItem,
      error,
      resumeCount,
      resumedFromCheckpoint,
    };
  }

  private parseBacktestExecutionAssumptions(
    value: unknown
  ): BacktestExecutionAssumptions | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const raw = value as Record<string, unknown>;
    const feesPct = this.readFiniteNumber(raw.feesPct);
    const slippagePct = this.readFiniteNumber(raw.slippagePct);
    const spreadPct = this.readFiniteNumber(raw.spreadPct);
    const latencyBars = this.readNonNegativeInteger(raw.latencyBars);
    const fillPolicy = this.readTrimmedString(raw.fillPolicy);
    const participationPct = this.readFiniteNumber(
      raw.participationPct ?? raw.participation_pct
    );
    const capitalUtilizationPct = this.readFiniteNumber(
      raw.capitalUtilizationPct ?? raw.capital_utilization_pct
    );
    const leverage = this.readFiniteNumber(raw.leverage ?? raw.leverage_multiple);
    const startingCapital = this.readFiniteNumber(
      raw.startingCapital ?? raw.starting_capital ?? raw.initialCapital ?? raw.initial_capital
    );
    const haltOnCapitalDepletion = this.readBoolean(
      raw.haltOnCapitalDepletion ?? raw.halt_on_capital_depletion
    );
    const simulationMode = this.readTrimmedString(raw.simulationMode);

    if (
      feesPct === null &&
      slippagePct === null &&
      spreadPct === null &&
      latencyBars === null &&
      participationPct === null &&
      capitalUtilizationPct === null &&
      leverage === null &&
      startingCapital === null &&
      haltOnCapitalDepletion === null &&
      !fillPolicy &&
      !simulationMode
    ) {
      return null;
    }

    return {
      feesPct,
      slippagePct,
      spreadPct,
      latencyBars,
      fillPolicy,
      participationPct,
      capitalUtilizationPct,
      leverage,
      startingCapital,
      haltOnCapitalDepletion,
      simulationMode,
    };
  }

  private parseBacktestPortfolioSummary(
    value: unknown
  ): BacktestPortfolioSummary | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const raw = value as Record<string, unknown>;
    const evaluationMethod = this.readTrimmedString(raw.evaluationMethod);
    const startingCapital = this.readFiniteNumber(raw.startingCapital ?? raw.starting_capital);
    const endingCapital = this.readFiniteNumber(raw.endingCapital ?? raw.ending_capital);
    const realizedPnlAmount = this.readFiniteNumber(
      raw.realizedPnlAmount ?? raw.realized_pnl_amount
    );
    const portfolioReturnPct = this.readFiniteNumber(
      raw.portfolioReturnPct ?? raw.portfolio_return_pct
    );
    const candidateTrades = this.readNonNegativeInteger(
      raw.candidateTrades ?? raw.candidate_trades
    );
    const executedTrades = this.readNonNegativeInteger(
      raw.executedTrades ?? raw.executed_trades
    );
    const skippedTrades = this.readNonNegativeInteger(raw.skippedTrades ?? raw.skipped_trades);
    const partialAllocationTrades = this.readNonNegativeInteger(
      raw.partialAllocationTrades ?? raw.partial_allocation_trades
    );
    const blockedByDepletionCount = this.readNonNegativeInteger(
      raw.blockedByDepletionCount ?? raw.blocked_by_depletion_count
    );
    const peakConcurrentTrades = this.readNonNegativeInteger(
      raw.peakConcurrentTrades ?? raw.peak_concurrent_trades
    );
    const peakReservedCapitalPct = this.readFiniteNumber(
      raw.peakReservedCapitalPct ?? raw.peak_reserved_capital_pct
    );
    const averageReservedCapitalPct = this.readFiniteNumber(
      raw.averageReservedCapitalPct ?? raw.average_reserved_capital_pct
    );
    const averageAllocationFillRatio = this.readFiniteNumber(
      raw.averageAllocationFillRatio ?? raw.average_allocation_fill_ratio
    );
    const capitalDepleted = this.readBoolean(raw.capitalDepleted ?? raw.capital_depleted);
    const haltOnCapitalDepletion = this.readBoolean(
      raw.haltOnCapitalDepletion ?? raw.halt_on_capital_depletion
    );

    if (
      !evaluationMethod &&
      startingCapital === null &&
      endingCapital === null &&
      realizedPnlAmount === null &&
      portfolioReturnPct === null &&
      candidateTrades === null &&
      executedTrades === null &&
      skippedTrades === null &&
      partialAllocationTrades === null &&
      blockedByDepletionCount === null &&
      peakConcurrentTrades === null &&
      peakReservedCapitalPct === null &&
      averageReservedCapitalPct === null &&
      averageAllocationFillRatio === null &&
      capitalDepleted === null &&
      haltOnCapitalDepletion === null
    ) {
      return null;
    }

    return {
      evaluationMethod,
      startingCapital,
      endingCapital,
      realizedPnlAmount,
      portfolioReturnPct,
      candidateTrades,
      executedTrades,
      skippedTrades,
      partialAllocationTrades,
      blockedByDepletionCount,
      peakConcurrentTrades,
      peakReservedCapitalPct,
      averageReservedCapitalPct,
      averageAllocationFillRatio,
      capitalDepleted,
      haltOnCapitalDepletion,
    };
  }

  private parseBacktestResumeCheckpoint(value: unknown): BacktestResumeCheckpoint | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const raw = value as Record<string, unknown>;
    const state = this.readTrimmedString(raw.state);
    const startedAt = this.readTrimmedString(raw.startedAt);
    const lastUpdatedAt = this.readTrimmedString(raw.lastUpdatedAt);
    const finishedAt = this.readTrimmedString(raw.finishedAt);
    const error = this.readTrimmedString(raw.error);
    const resumeCount = this.readNonNegativeInteger(raw.resumeCount);
    const resumedFromCheckpoint =
      typeof raw.resumedFromCheckpoint === 'boolean' ? raw.resumedFromCheckpoint : null;
    const completedCombinations = this.readNonNegativeInteger(raw.completedCombinations);
    const totalCombinations = this.readNonNegativeInteger(raw.totalCombinations);
    const tradeEventCount = this.readNonNegativeInteger(raw.tradeEventCount);
    const resultsSummary = this.parseBacktestResumeCheckpointSummary(raw);

    if (
      !state &&
      !startedAt &&
      !lastUpdatedAt &&
      !finishedAt &&
      !error &&
      resumeCount === null &&
      resumedFromCheckpoint === null &&
      completedCombinations === null &&
      totalCombinations === null &&
      tradeEventCount === null &&
      !resultsSummary
    ) {
      return null;
    }

    return {
      state,
      startedAt,
      lastUpdatedAt,
      finishedAt,
      error,
      resumeCount,
      resumedFromCheckpoint,
      completedCombinations,
      totalCombinations,
      tradeEventCount,
      resultsSummary,
    };
  }

  private parseBacktestResumeCheckpointSummary(
    value: Record<string, unknown>
  ): BacktestResumeCheckpoint['resultsSummary'] {
    const explicitSummary =
      value.resultsSummary && typeof value.resultsSummary === 'object' && !Array.isArray(value.resultsSummary)
        ? (value.resultsSummary as Record<string, unknown>)
        : null;

    const fallbackResults = Array.isArray(value.results)
      ? value.results.filter(
          (item): item is Record<string, unknown> =>
            Boolean(item) && typeof item === 'object' && !Array.isArray(item)
        )
      : [];

    const summary = {
      processed:
        this.readNonNegativeInteger(explicitSummary?.processed) ??
        (fallbackResults.length ? fallbackResults.length : null),
      okCount:
        this.readNonNegativeInteger(explicitSummary?.okCount) ??
        (fallbackResults.length
          ? fallbackResults.filter(
              (item) => this.readTrimmedString(item.status)?.toLowerCase() === 'ok'
            ).length
          : null),
      failedCount:
        this.readNonNegativeInteger(explicitSummary?.failedCount) ??
        (fallbackResults.length
          ? fallbackResults.filter(
              (item) => this.readTrimmedString(item.status)?.toLowerCase() === 'failed'
            ).length
          : null),
      noDataCount:
        this.readNonNegativeInteger(explicitSummary?.noDataCount) ??
        (fallbackResults.length
          ? fallbackResults.filter(
              (item) => this.readTrimmedString(item.status)?.toLowerCase() === 'no_data'
            ).length
          : null),
      skippedCount:
        this.readNonNegativeInteger(explicitSummary?.skippedCount) ??
        (fallbackResults.length
          ? fallbackResults.filter((item) => {
              const status = this.readTrimmedString(item.status)?.toLowerCase();
              return status ? !['ok', 'failed', 'no_data'].includes(status) : false;
            }).length
          : null),
    };

    if (
      summary.processed === null &&
      summary.okCount === null &&
      summary.failedCount === null &&
      summary.noDataCount === null &&
      summary.skippedCount === null
    ) {
      return null;
    }

    return summary;
  }

  private parseBacktestProgressItem(value: unknown): BacktestProgress['latestItem'] {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    const raw = value as Record<string, unknown>;
    const symbol = this.readTrimmedString(raw.symbol);
    const timeframe = this.readTrimmedString(raw.timeframe);
    const status = this.readTrimmedString(raw.status);
    const totalTrades = this.readNonNegativeInteger(raw.totalTrades);

    if (!symbol && !timeframe && !status && totalTrades === null) {
      return null;
    }

    return {
      symbol,
      timeframe,
      status,
      totalTrades,
    };
  }

  private readTrimmedString(value: unknown): string | null {
    const trimmed = String(value || '').trim();
    return trimmed || null;
  }

  private readNonNegativeInteger(value: unknown): number | null {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) {
      return null;
    }
    return Math.max(0, Math.trunc(numeric));
  }

  private readFiniteNumber(value: unknown): number | null {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return null;
    }
    return numeric;
  }

  private readBoolean(value: unknown): boolean | null {
    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === 'true') {
        return true;
      }
      if (normalized === 'false') {
        return false;
      }
    }

    return null;
  }

  private formatPercent(value: number | null): string {
    return value === null ? '--' : `${value}%`;
  }

  private formatNumber(value: number | null): string {
    return value === null ? '--' : String(value);
  }

  private parseOptionalDate(value: unknown): Date | null {
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value;
    }
    const trimmed = String(value || '').trim();
    if (!trimmed) {
      return null;
    }
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private resolveDateRangeValue(
    inputSnapshot: Record<string, unknown>,
    config: Record<string, unknown>,
    keys: string[]
  ): string | null {
    for (const key of keys) {
      const snapshotValue = this.normalizeOptionalDateValue(inputSnapshot[key]);
      if (snapshotValue) {
        return snapshotValue;
      }

      const configValue = this.normalizeOptionalDateValue(config[key]);
      if (configValue) {
        return configValue;
      }
    }

    return null;
  }

  private normalizeOptionalDateValue(value: unknown): string | null {
    const parsed = this.parseOptionalDate(value);
    if (parsed) {
      return parsed.toISOString();
    }

    const trimmed = String(value || '').trim();
    return trimmed || null;
  }
}
