import { Service } from 'typedi';
import {
  BacktestItem,
  BacktestPortfolioPressure,
  BacktestRobustness,
  BacktestTopSetupItem,
  BacktestsTopSetupsResponse,
} from '../contracts/Backtest';
import {
  BacktestTopSetupsQuery,
  ValidatedBacktestTopSetupsQuery,
  validateBacktestTopSetupsQuery,
} from '../validators/backtests.validator';
import type { BacktestPromotionRules } from '../contracts/Settings';
import { createDefaultBacktestPromotionRules } from '../utils/backtestPromotionRules';

@Service()
export class BacktestTopSetupsService {
  buildResponse(
    backtests: BacktestItem[],
    query: BacktestTopSetupsQuery | ValidatedBacktestTopSetupsQuery,
    promotionRules: BacktestPromotionRules = createDefaultBacktestPromotionRules()
  ): BacktestsTopSetupsResponse {
    const params = validateBacktestTopSetupsQuery(query);
    const search = String(params.search || '').trim().toLowerCase();

    const flattened = backtests.flatMap((backtest) =>
      this.extractTopSetupItems(backtest, promotionRules)
    );

    const filtered = flattened
      .filter((item) => {
        if (params.timeframe && item.timeframe !== params.timeframe) {
          return false;
        }
        if (params.minScore !== undefined) {
          const score = Number(item.score);
          if (!Number.isFinite(score) || score < params.minScore) {
            return false;
          }
        }
        if (params.minTrades !== undefined && item.trades < params.minTrades) {
          return false;
        }
        if (search) {
          const haystack = [
            item.symbol,
            item.timeframe,
            item.strategy,
            item.parameter,
            item.backtestName,
            item.libraryName,
            item.sourceId,
            item.projectId,
            item.templateId,
            item.templateName,
            item.sourceTemplateId,
            item.sourceTemplateName,
          ]
            .map((value) => String(value || '').trim().toLowerCase())
            .filter(Boolean)
            .join(' ');
          if (!haystack.includes(search)) {
            return false;
          }
        }
        if (params.eligibleOnly && !item.eligibleForAutomation) {
          return false;
        }
        return true;
      })
      .sort((left, right) => this.compareTopSetupItems(left, right));

    const deduped = this.dedupeTopSetupItems(filtered);
    const page = deduped.slice(params.offset, params.offset + params.limit);

    return {
      items: page,
      total: deduped.length,
      limit: params.limit,
      offset: params.offset,
    };
  }

  rankBacktestTopSetups(
    backtest: BacktestItem,
    promotionRules: BacktestPromotionRules = createDefaultBacktestPromotionRules()
  ): BacktestTopSetupItem[] {
    return this.extractTopSetupItems(backtest, promotionRules).sort((left, right) =>
      this.compareTopSetupItems(left, right)
    );
  }

  private extractTopSetupItems(
    backtest: BacktestItem,
    promotionRules: BacktestPromotionRules
  ): BacktestTopSetupItem[] {
    if (backtest.runStatus !== 'Completed') {
      return [];
    }

    const surface =
      backtest.performanceSurface &&
      typeof backtest.performanceSurface === 'object' &&
      !Array.isArray(backtest.performanceSurface)
        ? (backtest.performanceSurface as Record<string, unknown>)
        : null;
    const generatedAt = this.readTrimmedString(surface?.generatedAt);
    const results = Array.isArray(surface?.results) ? surface.results : [];

    return results.flatMap((item, index) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return [];
      }

      const row = item as Record<string, unknown>;
      const symbol = this.readTrimmedString(row.symbol);
      const timeframe = this.readTrimmedString(row.timeframe);

      if (!symbol || !timeframe) {
        return [];
      }

      const score = this.readFiniteNumber(row.score);
      const trades =
        this.readNonNegativeInteger(row.total_trades ?? row.trades ?? row.totalTrades) ?? 0;
      const winRate = this.readFiniteNumber(row.win_rate ?? row.winRate);
      const profitFactor = this.readFiniteNumber(row.profit_factor ?? row.profitFactor);
      const returnPct = this.readFiniteNumber(
        row.total_return_pct ?? row.cagr ?? row.returnPct
      );
      const maxDrawdownPct = this.readFiniteNumber(
        row.max_drawdown_pct ?? row.drawdown ?? row.maxDrawdownPct
      );
      const robustness = this.parseBacktestRobustness(row.robustness);
      const portfolioAdjustedScore = this.readFiniteNumber(
        row.portfolioAdjustedScore ?? row.portfolio_adjusted_score
      );
      const portfolioPressure = this.parseBacktestPortfolioPressure(
        row.portfolioPressure ?? row.portfolio_pressure
      );

      if (score === null || trades <= 0) {
        return [];
      }

      const dedupeKey = this.buildTopSetupDedupeKey({ backtest, symbol, timeframe });
      const automationEligibilityReasons = this.getAutomationEligibilityReasons({
        backtest,
        score,
        trades,
        robustness,
        portfolioPressure,
        promotionRules,
      });
      const eligibleForAutomation = automationEligibilityReasons.length === 0;
      const lineage = backtest.lineage ?? this.buildBacktestLineageFallback(backtest);

      return [
        {
          id: `${backtest.id}:${symbol}:${timeframe}:${index}`,
          dedupeKey,
          backtestId: backtest.id,
          backtestName: backtest.name,
          strategy: backtest.strategy,
          parameter: backtest.parameter,
          symbol,
          timeframe,
          score,
          trades,
          winRate,
          profitFactor,
          returnPct,
          maxDrawdownPct,
          sourceType: backtest.sourceType ?? null,
          sourceId: backtest.sourceId ?? null,
          libraryId: backtest.libraryId ?? null,
          libraryName: backtest.libraryName ?? null,
          projectId: backtest.projectId ?? null,
          projectVersion: backtest.projectVersion ?? null,
          templateId: backtest.templateId ?? null,
          templateName: backtest.templateName ?? null,
          templateVersion: backtest.templateVersion ?? null,
          sourceTemplateId: backtest.sourceTemplateId ?? null,
          sourceTemplateName: backtest.sourceTemplateName ?? null,
          sourceTemplateVersion: backtest.sourceTemplateVersion ?? null,
          lineage,
          dateRangeStart: backtest.dateRangeStart ?? null,
          dateRangeEnd: backtest.dateRangeEnd ?? null,
          hasIncompleteTradeHistory: Boolean(backtest.hasIncompleteTradeHistory),
          templateAutomationReady:
            backtest.templateAutomationReady === undefined
              ? undefined
              : Boolean(backtest.templateAutomationReady),
          templateAutomationReasons: Array.isArray(backtest.templateAutomationReasons)
            ? backtest.templateAutomationReasons
            : [],
          eligibleForAutomation,
          automationEligibilityReasons,
          generatedAt,
          createdAt: backtest.createdAt ?? null,
          robustness,
          portfolioAdjustedScore,
          portfolioPressure,
        },
      ];
    });
  }

  private buildBacktestLineageFallback(
    backtest: BacktestItem
  ): BacktestTopSetupItem['lineage'] {
    const lineage = {
      sourceType: backtest.sourceType ?? null,
      sourceId: backtest.sourceId ?? null,
      libraryId: backtest.libraryId ?? null,
      libraryName: backtest.libraryName ?? null,
      projectId: backtest.projectId ?? null,
      projectVersion: backtest.projectVersion ?? null,
      templateId: backtest.templateId ?? null,
      templateName: backtest.templateName ?? null,
      templateVersion: backtest.templateVersion ?? null,
      sourceTemplateId: backtest.sourceTemplateId ?? null,
      sourceTemplateName: backtest.sourceTemplateName ?? null,
      sourceTemplateVersion: backtest.sourceTemplateVersion ?? null,
      templateDiffSummary: backtest.templateDiffSummary ?? null,
    };

    return Object.values(lineage).some((item) => item !== null && item !== undefined && item !== '')
      ? lineage
      : null;
  }

  private dedupeTopSetupItems(items: BacktestTopSetupItem[]): BacktestTopSetupItem[] {
    const bestByKey = new Map<string, BacktestTopSetupItem>();

    items.forEach((item) => {
      const existing = bestByKey.get(item.dedupeKey);
      if (!existing || this.compareTopSetupItems(item, existing) < 0) {
        bestByKey.set(item.dedupeKey, item);
      }
    });

    return Array.from(bestByKey.values()).sort((left, right) =>
      this.compareTopSetupItems(left, right)
    );
  }

  private compareTopSetupItems(
    left: BacktestTopSetupItem,
    right: BacktestTopSetupItem
  ): number {
    if (left.eligibleForAutomation !== right.eligibleForAutomation) {
      return left.eligibleForAutomation ? -1 : 1;
    }

    const scoreDelta =
      (right.score ?? Number.NEGATIVE_INFINITY) - (left.score ?? Number.NEGATIVE_INFINITY);
    const robustnessDelta =
      (right.robustness?.robustnessScore ?? Number.NEGATIVE_INFINITY) -
      (left.robustness?.robustnessScore ?? Number.NEGATIVE_INFINITY);
    if (robustnessDelta !== 0) {
      return robustnessDelta;
    }

    const walkForwardPassDelta =
      (right.robustness?.walkForwardPassRate ?? Number.NEGATIVE_INFINITY) -
      (left.robustness?.walkForwardPassRate ?? Number.NEGATIVE_INFINITY);
    if (walkForwardPassDelta !== 0) {
      return walkForwardPassDelta;
    }

    const worstOutOfSampleDelta =
      (right.robustness?.worstOutOfSampleReturnPct ?? Number.NEGATIVE_INFINITY) -
      (left.robustness?.worstOutOfSampleReturnPct ?? Number.NEGATIVE_INFINITY);
    if (worstOutOfSampleDelta !== 0) {
      return worstOutOfSampleDelta;
    }

    const averageOutOfSampleDelta =
      (right.robustness?.averageOutOfSampleReturnPct ?? Number.NEGATIVE_INFINITY) -
      (left.robustness?.averageOutOfSampleReturnPct ?? Number.NEGATIVE_INFINITY);
    if (averageOutOfSampleDelta !== 0) {
      return averageOutOfSampleDelta;
    }

    const outOfSampleReturnDelta =
      (right.robustness?.outOfSampleReturnPct ?? Number.NEGATIVE_INFINITY) -
      (left.robustness?.outOfSampleReturnPct ?? Number.NEGATIVE_INFINITY);
    if (outOfSampleReturnDelta !== 0) {
      return outOfSampleReturnDelta;
    }

    const portfolioAdjustedScoreDelta =
      (right.portfolioAdjustedScore ?? Number.NEGATIVE_INFINITY) -
      (left.portfolioAdjustedScore ?? Number.NEGATIVE_INFINITY);
    if (portfolioAdjustedScoreDelta !== 0) {
      return portfolioAdjustedScoreDelta;
    }

    const portfolioPressureDelta =
      (right.portfolioPressure?.pressureScore ?? Number.NEGATIVE_INFINITY) -
      (left.portfolioPressure?.pressureScore ?? Number.NEGATIVE_INFINITY);
    if (portfolioPressureDelta !== 0) {
      return portfolioPressureDelta;
    }

    if (scoreDelta !== 0) {
      return scoreDelta;
    }

    const profitFactorDelta =
      (right.profitFactor ?? Number.NEGATIVE_INFINITY) -
      (left.profitFactor ?? Number.NEGATIVE_INFINITY);
    if (profitFactorDelta !== 0) {
      return profitFactorDelta;
    }

    const winRateDelta =
      (right.winRate ?? Number.NEGATIVE_INFINITY) - (left.winRate ?? Number.NEGATIVE_INFINITY);
    if (winRateDelta !== 0) {
      return winRateDelta;
    }

    const tradesDelta = right.trades - left.trades;
    if (tradesDelta !== 0) {
      return tradesDelta;
    }

    return (Date.parse(right.createdAt || '') || 0) - (Date.parse(left.createdAt || '') || 0);
  }

  private buildTopSetupDedupeKey({
    backtest,
    symbol,
    timeframe,
  }: {
    backtest: BacktestItem;
    symbol: string;
    timeframe: string;
  }): string {
    const lineageAnchor =
      backtest.sourceTemplateId ||
      backtest.templateId ||
      backtest.libraryId ||
      backtest.projectId ||
      backtest.sourceId ||
      backtest.strategy;
    const lineageType = backtest.sourceType || 'backtest';

    return [lineageType, lineageAnchor || 'unknown', symbol, timeframe]
      .map((value) => String(value || '').trim().toLowerCase())
      .join('::');
  }

  private getAutomationEligibilityReasons({
    backtest,
    score,
    trades,
    robustness,
    portfolioPressure,
    promotionRules,
  }: {
    backtest: BacktestItem;
    score: number | null;
    trades: number;
    robustness: BacktestRobustness | null;
    portfolioPressure: BacktestPortfolioPressure | null;
    promotionRules: BacktestPromotionRules;
  }): string[] {
    const reasons: string[] = [];

    if (promotionRules.requireCompleteHistory && backtest.hasIncompleteTradeHistory) {
      reasons.push('incomplete-history');
    }

    const hasLineage = Boolean(
      backtest.projectId ||
        backtest.templateId ||
        backtest.sourceTemplateId ||
        backtest.libraryId ||
        backtest.sourceId
    );
    if (promotionRules.requireLineage && !hasLineage) {
      reasons.push('missing-lineage');
    }

    if (
      promotionRules.requireTemplateAutomationReady &&
      backtest.templateAutomationReady === false
    ) {
      reasons.push('template-not-automation-ready');
    }

    if (score === null || score < promotionRules.minScore) {
      reasons.push('low-score');
    }

    if (trades < promotionRules.minTrades) {
      reasons.push('low-trade-count');
    }

    if (promotionRules.requireRobustness) {
      if (!robustness) {
        reasons.push('missing-robustness-validation');
      } else {
        if (robustness.evaluationMethod !== promotionRules.requiredRobustnessModel) {
          reasons.push('outdated-robustness-model');
        }
        if (robustness.promotionReady === false) {
          reasons.push(...(Array.isArray(robustness.reasons) ? robustness.reasons : []));
        }
      }
    }

    if (portfolioPressure) {
      if (
        portfolioPressure.pressureScore !== null &&
        portfolioPressure.pressureScore !== undefined &&
        portfolioPressure.pressureScore < promotionRules.minPortfolioPressureScore
      ) {
        reasons.push('high-portfolio-capital-pressure');
      }
      if (
        portfolioPressure.executedTradeRatio !== null &&
        portfolioPressure.executedTradeRatio !== undefined &&
        portfolioPressure.executedTradeRatio < promotionRules.minExecutedTradeRatio
      ) {
        reasons.push('portfolio-capital-skips');
      }
      if (promotionRules.blockCapitalDepletionRisk && portfolioPressure.capitalDepletionRisk) {
        reasons.push('capital-depletion-risk');
      }
    }

    return Array.from(new Set(reasons));
  }

  private parseBacktestPortfolioPressure(value: unknown): BacktestPortfolioPressure | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const raw = value as Record<string, unknown>;
    const setupKey = this.readTrimmedString(raw.setupKey ?? raw.setup_key);
    const templateId = this.readTrimmedString(raw.templateId ?? raw.template_id);
    const symbol = this.readTrimmedString(raw.symbol);
    const timeframe = this.readTrimmedString(raw.timeframe);
    const candidateTrades = this.readNonNegativeInteger(
      raw.candidateTrades ?? raw.candidate_trades
    );
    const executedTrades = this.readNonNegativeInteger(
      raw.executedTrades ?? raw.executed_trades
    );
    const skippedTrades = this.readNonNegativeInteger(
      raw.skippedTrades ?? raw.skipped_trades
    );
    const partialAllocationTrades = this.readNonNegativeInteger(
      raw.partialAllocationTrades ?? raw.partial_allocation_trades
    );
    const overlapTrades = this.readNonNegativeInteger(raw.overlapTrades ?? raw.overlap_trades);
    const blockedByDepletionCount = this.readNonNegativeInteger(
      raw.blockedByDepletionCount ?? raw.blocked_by_depletion_count
    );
    const averageAllocationFillRatio = this.readFiniteNumber(
      raw.averageAllocationFillRatio ?? raw.average_allocation_fill_ratio
    );
    const executedTradeRatio = this.readFiniteNumber(
      raw.executedTradeRatio ?? raw.executed_trade_ratio
    );
    const overlapTradeRatio = this.readFiniteNumber(
      raw.overlapTradeRatio ?? raw.overlap_trade_ratio
    );
    const partialAllocationRate = this.readFiniteNumber(
      raw.partialAllocationRate ?? raw.partial_allocation_rate
    );
    const pressureScore = this.readFiniteNumber(raw.pressureScore ?? raw.pressure_score);
    const pressureState = this.readTrimmedString(raw.pressureState ?? raw.pressure_state);
    const capitalDepletionRisk = this.readBoolean(
      raw.capitalDepletionRisk ?? raw.capital_depletion_risk
    );
    const reasons = Array.isArray(raw.reasons)
      ? raw.reasons.map((item) => String(item || '').trim()).filter(Boolean)
      : [];

    if (
      !setupKey &&
      !templateId &&
      !symbol &&
      !timeframe &&
      candidateTrades === null &&
      executedTrades === null &&
      skippedTrades === null &&
      partialAllocationTrades === null &&
      overlapTrades === null &&
      blockedByDepletionCount === null &&
      averageAllocationFillRatio === null &&
      executedTradeRatio === null &&
      overlapTradeRatio === null &&
      partialAllocationRate === null &&
      pressureScore === null &&
      !pressureState &&
      capitalDepletionRisk === null &&
      !reasons.length
    ) {
      return null;
    }

    return {
      setupKey,
      templateId,
      symbol,
      timeframe,
      candidateTrades,
      executedTrades,
      skippedTrades,
      partialAllocationTrades,
      overlapTrades,
      blockedByDepletionCount,
      averageAllocationFillRatio,
      executedTradeRatio,
      overlapTradeRatio,
      partialAllocationRate,
      pressureScore,
      pressureState,
      capitalDepletionRisk,
      reasons,
    };
  }

  private parseBacktestRobustness(value: unknown): BacktestRobustness | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const raw = value as Record<string, unknown>;
    const evaluationMethod = this.readTrimmedString(raw.evaluationMethod);
    const primarySplitRatio = this.readFiniteNumber(raw.primarySplitRatio);
    const splitMethod = this.readTrimmedString(raw.splitMethod);
    const splitTimestamp = this.readFiniteNumber(raw.splitTimestamp);
    const inSampleTrades = this.readNonNegativeInteger(raw.inSampleTrades);
    const inSampleReturnPct = this.readFiniteNumber(raw.inSampleReturnPct);
    const inSampleWinRate = this.readFiniteNumber(raw.inSampleWinRate);
    const inSampleProfitFactor = this.readFiniteNumber(raw.inSampleProfitFactor);
    const outOfSampleTrades = this.readNonNegativeInteger(raw.outOfSampleTrades);
    const outOfSampleReturnPct = this.readFiniteNumber(raw.outOfSampleReturnPct);
    const outOfSampleWinRate = this.readFiniteNumber(raw.outOfSampleWinRate);
    const outOfSampleProfitFactor = this.readFiniteNumber(raw.outOfSampleProfitFactor);
    const returnRetentionRatio = this.readFiniteNumber(raw.returnRetentionRatio);
    const walkForwardSplitCount = this.readNonNegativeInteger(raw.walkForwardSplitCount);
    const walkForwardPassingSplitCount = this.readNonNegativeInteger(
      raw.walkForwardPassingSplitCount
    );
    const walkForwardPassRate = this.readFiniteNumber(raw.walkForwardPassRate);
    const averageOutOfSampleTrades = this.readFiniteNumber(raw.averageOutOfSampleTrades);
    const averageOutOfSampleReturnPct = this.readFiniteNumber(raw.averageOutOfSampleReturnPct);
    const averageOutOfSampleProfitFactor = this.readFiniteNumber(
      raw.averageOutOfSampleProfitFactor
    );
    const averageReturnRetentionRatio = this.readFiniteNumber(
      raw.averageReturnRetentionRatio
    );
    const worstOutOfSampleReturnPct = this.readFiniteNumber(raw.worstOutOfSampleReturnPct);
    const positiveOutOfSampleSplitCount = this.readNonNegativeInteger(
      raw.positiveOutOfSampleSplitCount
    );
    const consistencyScore = this.readFiniteNumber(raw.consistencyScore);
    const robustnessScore = this.readFiniteNumber(raw.robustnessScore);
    const promotionReady =
      typeof raw.promotionReady === 'boolean' ? raw.promotionReady : null;
    const reasons = Array.isArray(raw.reasons)
      ? raw.reasons.map((item) => String(item || '').trim()).filter(Boolean)
      : [];
    const walkForwardSplits = Array.isArray(raw.walkForwardSplits)
      ? raw.walkForwardSplits
          .map((item) => this.parseBacktestRobustnessSplit(item))
          .filter((item): item is NonNullable<typeof item> => item !== null)
      : [];

    if (
      !evaluationMethod &&
      primarySplitRatio === null &&
      !splitMethod &&
      splitTimestamp === null &&
      inSampleTrades === null &&
      inSampleReturnPct === null &&
      inSampleWinRate === null &&
      inSampleProfitFactor === null &&
      outOfSampleTrades === null &&
      outOfSampleReturnPct === null &&
      outOfSampleWinRate === null &&
      outOfSampleProfitFactor === null &&
      returnRetentionRatio === null &&
      walkForwardSplitCount === null &&
      walkForwardPassingSplitCount === null &&
      walkForwardPassRate === null &&
      averageOutOfSampleTrades === null &&
      averageOutOfSampleReturnPct === null &&
      averageOutOfSampleProfitFactor === null &&
      averageReturnRetentionRatio === null &&
      worstOutOfSampleReturnPct === null &&
      positiveOutOfSampleSplitCount === null &&
      consistencyScore === null &&
      robustnessScore === null &&
      promotionReady === null &&
      !reasons.length &&
      !walkForwardSplits.length
    ) {
      return null;
    }

    return {
      evaluationMethod,
      primarySplitRatio,
      splitMethod,
      splitTimestamp,
      inSampleTrades,
      inSampleReturnPct,
      inSampleWinRate,
      inSampleProfitFactor,
      outOfSampleTrades,
      outOfSampleReturnPct,
      outOfSampleWinRate,
      outOfSampleProfitFactor,
      returnRetentionRatio,
      walkForwardSplitCount,
      walkForwardPassingSplitCount,
      walkForwardPassRate,
      averageOutOfSampleTrades,
      averageOutOfSampleReturnPct,
      averageOutOfSampleProfitFactor,
      averageReturnRetentionRatio,
      worstOutOfSampleReturnPct,
      positiveOutOfSampleSplitCount,
      consistencyScore,
      robustnessScore,
      promotionReady,
      reasons,
      walkForwardSplits,
    };
  }

  private parseBacktestRobustnessSplit(
    value: unknown
  ): NonNullable<BacktestRobustness['walkForwardSplits']>[number] | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const raw = value as Record<string, unknown>;
    const splitMethod = this.readTrimmedString(raw.splitMethod);
    const splitRatio = this.readFiniteNumber(raw.splitRatio);
    const splitTimestamp = this.readFiniteNumber(raw.splitTimestamp);
    const inSampleTrades = this.readNonNegativeInteger(raw.inSampleTrades);
    const inSampleReturnPct = this.readFiniteNumber(raw.inSampleReturnPct);
    const inSampleWinRate = this.readFiniteNumber(raw.inSampleWinRate);
    const inSampleProfitFactor = this.readFiniteNumber(raw.inSampleProfitFactor);
    const outOfSampleTrades = this.readNonNegativeInteger(raw.outOfSampleTrades);
    const outOfSampleReturnPct = this.readFiniteNumber(raw.outOfSampleReturnPct);
    const outOfSampleWinRate = this.readFiniteNumber(raw.outOfSampleWinRate);
    const outOfSampleProfitFactor = this.readFiniteNumber(raw.outOfSampleProfitFactor);
    const returnRetentionRatio = this.readFiniteNumber(raw.returnRetentionRatio);
    const promotionReady =
      typeof raw.promotionReady === 'boolean' ? raw.promotionReady : null;
    const reasons = Array.isArray(raw.reasons)
      ? raw.reasons.map((item) => String(item || '').trim()).filter(Boolean)
      : [];

    if (
      !splitMethod &&
      splitRatio === null &&
      splitTimestamp === null &&
      inSampleTrades === null &&
      inSampleReturnPct === null &&
      inSampleWinRate === null &&
      inSampleProfitFactor === null &&
      outOfSampleTrades === null &&
      outOfSampleReturnPct === null &&
      outOfSampleWinRate === null &&
      outOfSampleProfitFactor === null &&
      returnRetentionRatio === null &&
      promotionReady === null &&
      !reasons.length
    ) {
      return null;
    }

    return {
      splitMethod,
      splitRatio,
      splitTimestamp,
      inSampleTrades,
      inSampleReturnPct,
      inSampleWinRate,
      inSampleProfitFactor,
      outOfSampleTrades,
      outOfSampleReturnPct,
      outOfSampleWinRate,
      outOfSampleProfitFactor,
      returnRetentionRatio,
      promotionReady,
      reasons,
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
}
