import { Inject, Service } from 'typedi';
import {
  BrokerReconciliationMatchBody,
  BrokerReconciliationMatchResponse,
} from '../contracts/BrokerReconciliation';
import {
  BrokerReconciliationMatchCounts,
  BrokerReconciliationRepository,
} from '../../database/repositories/BrokerReconciliationRepository';

@Service()
export class BrokerReconciliationMatchService {
  @Inject(() => BrokerReconciliationRepository)
  private brokerReconciliationRepository!: BrokerReconciliationRepository;

  async matchAndCompare(
    input: BrokerReconciliationMatchBody
  ): Promise<BrokerReconciliationMatchResponse> {
    const userId = this.requiredString(input.userId, 'userId');
    const brokerKey = this.readString(input.brokerKey)?.toLowerCase() || null;
    const accountId = this.readString(input.accountId) || null;
    const windowStartAt = this.dateOrNull(input.startDate);
    const windowEndAt = this.dateOrNull(input.endDate);
    const fallbackWindowMinutes = this.resolveFallbackWindowMinutes(input.fallbackWindowMinutes);
    const startedAt = new Date();
    const runId = await this.brokerReconciliationRepository.createReconciliationRun({
      userId,
      brokerKey: brokerKey || 'all',
      accountId,
      runType: 'broker_app_match',
      windowStartAt,
      windowEndAt,
      startedAt,
      summaryPayload: {
        phase: 5,
        brokerKey,
        accountId,
        fallbackWindowMinutes,
      },
    });

    try {
      const matchBreakdown = await this.brokerReconciliationRepository.runAppBrokerMatching({
        userId,
        brokerKey,
        accountId,
        windowStartAt,
        windowEndAt,
        fallbackWindowMinutes,
      });
      const totals = await this.brokerReconciliationRepository.readComparisonTotals({
        userId,
        brokerKey,
        accountId,
        windowStartAt,
        windowEndAt,
      });
      const latestSourceRun =
        await this.brokerReconciliationRepository.readLatestCompletedSourceRun({
          userId,
          brokerKey,
          accountId,
          windowStartAt,
          windowEndAt,
        });

      const brokerGrossPnl = latestSourceRun?.grossPnl ?? 0;
      const brokerFeeTotal =
        latestSourceRun?.feesTotal ?? this.roundNumber(totals.brokerFeeTotal, 12);
      const brokerFundingTotal =
        latestSourceRun?.fundingTotal ?? this.roundNumber(totals.brokerFundingTotal, 12);
      const brokerNetPnl =
        latestSourceRun?.netPnl ??
        this.roundNumber(brokerGrossPnl + brokerFeeTotal + brokerFundingTotal, 12);
      const grossDelta = this.roundNumber(brokerGrossPnl - totals.appGrossPnl, 12);
      const netDeltaVsAppGross = this.roundNumber(brokerNetPnl - totals.appGrossPnl, 12);
      const coverage = {
        appTradeCount: totals.appTradeCount,
        appMatchedTradeCount: totals.appMatchedTradeCount,
        brokerFillCount: totals.brokerFillCount,
        brokerMatchedFillCount: totals.brokerMatchedFillCount,
        brokerUnmatchedFillCount: totals.brokerUnmatchedFillCount,
        matchedFillCoveragePct: this.percent(totals.brokerMatchedFillCount, totals.brokerFillCount),
        matchedAppTradeCoveragePct: this.percent(totals.appMatchedTradeCount, totals.appTradeCount),
      };
      const explanation = this.buildExplanation({
        matchBreakdown,
        appGrossPnl: totals.appGrossPnl,
        brokerGrossPnl,
        brokerFeeTotal,
        brokerFundingTotal,
        brokerNetPnl,
        grossDelta,
        netDeltaVsAppGross,
        brokerUnmatchedFillCount: totals.brokerUnmatchedFillCount,
        brokerMatchedFillCount: totals.brokerMatchedFillCount,
        sourceRunAvailable: Boolean(latestSourceRun),
      });
      const finishedAt = new Date();
      await this.brokerReconciliationRepository.finishReconciliationRun(runId, {
        status: 'completed',
        finishedAt,
        fillsCount: totals.brokerFillCount,
        feeEntriesCount: matchBreakdown.feeEntriesLinked,
        fundingEntriesCount: matchBreakdown.fundingEntriesLinked,
        walletTransactionsCount: matchBreakdown.walletTransactionsLinked,
        grossPnl: brokerGrossPnl,
        feesTotal: brokerFeeTotal,
        fundingTotal: brokerFundingTotal,
        netPnl: brokerNetPnl,
        unmatchedDelta: netDeltaVsAppGross,
        summaryPayload: {
          phase: 5,
          brokerKey,
          accountId,
          fallbackWindowMinutes,
          matchBreakdown,
          coverage,
          totals,
          latestSourceRun,
          explanation,
        },
      });

      return {
        runId,
        brokerKey,
        accountId,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        matchBreakdown,
        coverage,
        pnlComparison: {
          appGrossPnl: totals.appGrossPnl,
          appMatchedGrossPnl: totals.appMatchedGrossPnl,
          brokerGrossPnl,
          brokerFeeTotal,
          brokerFundingTotal,
          brokerNetPnl,
          grossDelta,
          netDeltaVsAppGross,
          unmatchedBrokerNotional: totals.brokerNotional - totals.brokerMatchedNotional,
          unmatchedBrokerFillCount: totals.brokerUnmatchedFillCount,
          explanation,
        },
        latestSourceRun: latestSourceRun
          ? {
              id: latestSourceRun.id,
              brokerKey: latestSourceRun.brokerKey,
              accountId: latestSourceRun.accountId,
              runType: latestSourceRun.runType,
              startedAt: latestSourceRun.startedAt?.toISOString() ?? null,
              finishedAt: latestSourceRun.finishedAt?.toISOString() ?? null,
              grossPnl: latestSourceRun.grossPnl,
              feesTotal: latestSourceRun.feesTotal,
              fundingTotal: latestSourceRun.fundingTotal,
              netPnl: latestSourceRun.netPnl,
            }
          : null,
      };
    } catch (error) {
      await this.brokerReconciliationRepository.finishReconciliationRun(runId, {
        status: 'failed',
        finishedAt: new Date(),
        errorMessage: error instanceof Error ? error.message : String(error),
        summaryPayload: {
          phase: 5,
          brokerKey,
          accountId,
          failure: true,
        },
      });
      throw error;
    }
  }

  private buildExplanation(input: {
    matchBreakdown: BrokerReconciliationMatchCounts;
    appGrossPnl: number;
    brokerGrossPnl: number;
    brokerFeeTotal: number;
    brokerFundingTotal: number;
    brokerNetPnl: number;
    grossDelta: number;
    netDeltaVsAppGross: number;
    brokerMatchedFillCount: number;
    brokerUnmatchedFillCount: number;
    sourceRunAvailable: boolean;
  }): string[] {
    const exactMatches =
      input.matchBreakdown.fillsMatchedByExecutionOrderId +
      input.matchBreakdown.fillsMatchedBySubmissionOrderId +
      input.matchBreakdown.fillsMatchedByPositionId;
    const fallbackMatches = input.matchBreakdown.fillsMatchedBySymbolTimeSide;
    const explanation = [
      `${exactMatches} broker fills matched exactly by app execution/submission order id or position id.`,
      `${fallbackMatches} broker fills matched by symbol, side, and time-window fallback.`,
      `${input.brokerUnmatchedFillCount} broker fills remain unmatched after Phase 5 matching.`,
      `App gross PnL is ${this.formatNumber(input.appGrossPnl)}; broker gross PnL is ${this.formatNumber(input.brokerGrossPnl)}; gross delta is ${this.formatNumber(input.grossDelta)}.`,
      `Broker fees are ${this.formatNumber(input.brokerFeeTotal)} and funding is ${this.formatNumber(input.brokerFundingTotal)}, so broker net PnL is ${this.formatNumber(input.brokerNetPnl)}.`,
      `Broker net vs app gross delta is ${this.formatNumber(input.netDeltaVsAppGross)}.`,
    ];

    if (!input.sourceRunAvailable) {
      explanation.push(
        'No completed Mudrex/Delta source sync run was found for this scope, so broker gross PnL defaults to 0 until Phase 3/4 sync runs exist.'
      );
    }

    return explanation;
  }

  private percent(numerator: number, denominator: number): number {
    if (!(denominator > 0)) {
      return 0;
    }
    return this.roundNumber((numerator / denominator) * 100, 2);
  }

  private resolveFallbackWindowMinutes(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return 30;
    }
    return Math.min(parsed, 24 * 60);
  }

  private dateOrNull(value: unknown): Date | null {
    const text = this.readString(value);
    if (!text) {
      return null;
    }
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private requiredString(value: unknown, fieldName: string): string {
    const text = this.readString(value);
    if (!text) {
      throw new Error(`Broker reconciliation ${fieldName} is required`);
    }
    return text;
  }

  private readString(value: unknown): string {
    return value === null || value === undefined ? '' : String(value).trim();
  }

  private roundNumber(value: number, precision: number): number {
    const factor = 10 ** precision;
    return Math.round(value * factor) / factor;
  }

  private formatNumber(value: number): string {
    return this.roundNumber(value, 8).toString();
  }
}
