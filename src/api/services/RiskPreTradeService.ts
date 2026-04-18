import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import {
  RiskPreTradeAppliedPolicyItem,
  RiskPreTradeCheckResult,
  RiskPreTradeFreshnessState,
  RiskPreTradeRuleResult,
  RiskPreTradeScopeImpactItem,
} from '../contracts/Risk';
import { BadRequestAppError, NotFoundAppError } from '../errors/AppError';
import { successResponse } from '../utils/response';
import { ValidatedRiskPreTradeCheckBody } from '../validators/risk.validator';
import {
  BrokerAccountRepository,
  RiskAccountSnapshotRepository,
  RiskAssetSnapshotRepository,
  RiskBrokerAssetSnapshotRepository,
  RiskBrokerSnapshotRepository,
  RiskPolicyRepository,
  RiskRepository,
  RiskRequestCheckRepository,
  RiskRequestRuleEvaluationRepository,
  RiskRequestScopeImpactRepository,
  RiskSnapshotPolicyContextRepository,
  RiskSnapshotSourceCoverageRepository,
  SuggestedTradeRepository,
} from '../../database';
import { RiskAccountSnapshot } from '../../database/entities/RiskAccountSnapshot';
import { RiskAssetSnapshot } from '../../database/entities/RiskAssetSnapshot';
import { RiskBrokerAssetSnapshot } from '../../database/entities/RiskBrokerAssetSnapshot';
import { RiskBrokerSnapshot } from '../../database/entities/RiskBrokerSnapshot';
import { RiskRequestCheck } from '../../database/entities/RiskRequestCheck';
import { RiskRequestRuleEvaluation } from '../../database/entities/RiskRequestRuleEvaluation';
import { RiskRequestScopeImpact } from '../../database/entities/RiskRequestScopeImpact';
import { RiskSnapshot } from '../../database/entities/RiskSnapshot';
import { RiskSnapshotPolicyContext } from '../../database/entities/RiskSnapshotPolicyContext';
import { RiskSnapshotSourceCoverage } from '../../database/entities/RiskSnapshotSourceCoverage';
import { SuggestedTrade } from '../../database/entities/SuggestedTrade';
import { UserTimeZoneService } from './UserTimeZoneService';
import {
  buildApiTimeContract,
  formatApiDisplayTime,
  formatApiRawIso,
} from '../utils/apiTimeContract';

interface ThresholdProfile {
  marginUsageWarnPct: number;
  marginUsageCriticalPct: number;
  concentrationWarnPct: number;
  concentrationCriticalPct: number;
  dailyLossLimitPct: number;
  weeklyLossLimitPct: number;
  monthlyLossLimitPct: number;
  maxLeverage: number;
  maxOrderAllocation: number | null;
  maxTotalAllocation: number;
  maxAvgLeverage: number;
}

interface ResolvedPreTradeRoute {
  routeMode: ValidatedRiskPreTradeCheckBody['routing']['routeMode'];
  brokerKey: string | null;
  accountId: string | null;
  accountName: string | null;
}

interface ResolvedPreTradeOrder {
  symbol: string;
  timeframe: string | null;
  side: 'BUY' | 'SELL';
  orderType: ValidatedRiskPreTradeCheckBody['order']['orderType'];
  timeInForce: 'GTC' | 'IOC' | 'FOK' | null;
  quantityMode: ValidatedRiskPreTradeCheckBody['order']['quantityMode'];
  quantity: number | null;
  notional: number | null;
  riskPercent: number | null;
  entryPrice: number | null;
  stopLossPrice: number | null;
  takeProfitTargets: number[] | null;
  leverage: number | null;
  reduceOnly: boolean;
}

interface EffectivePreTradeRequest {
  snapshotId: string | null;
  suggestedTradeId: string | null;
  automationId: string | null;
  automationRunId: string | null;
  sourceType: string;
  executionMode: ValidatedRiskPreTradeCheckBody['executionMode'];
  approvalMode: ValidatedRiskPreTradeCheckBody['approvalMode'];
  route: ResolvedPreTradeRoute;
  order: ResolvedPreTradeOrder;
}

interface FreshnessSummary {
  freshnessState: RiskPreTradeFreshnessState;
  snapshotLagMinutes: number | null;
  blocking: boolean;
  message: string;
}

interface ScopeImpactDraft {
  scopeType: string;
  scopeKey: string;
  scopeLabel?: string | null;
  brokerKey?: string | null;
  accountId?: string | null;
  symbol?: string | null;
  beforeGrossExposure?: number | null;
  beforeNetExposure?: number | null;
  beforeOpenOrderExposure?: number | null;
  beforeReservedOrderMargin?: number | null;
  beforeMarginUsagePct?: number | null;
  beforeAllocationPct?: number | null;
  beforeRiskScore?: number | null;
  beforeRiskState?: string | null;
  deltaGrossExposure?: number | null;
  deltaNetExposure?: number | null;
  deltaOpenOrderExposure?: number | null;
  deltaReservedOrderMargin?: number | null;
  afterGrossExposure?: number | null;
  afterNetExposure?: number | null;
  afterOpenOrderExposure?: number | null;
  afterReservedOrderMargin?: number | null;
  afterMarginUsagePct?: number | null;
  afterAllocationPct?: number | null;
  afterRiskScore?: number | null;
  afterRiskState?: string | null;
  sortOrder: number;
}

interface RuleEvaluationDraft {
  policyContextId?: string | null;
  scopeType: string;
  scopeKey: string;
  scopeLabel?: string | null;
  brokerKey?: string | null;
  accountId?: string | null;
  symbol?: string | null;
  ruleCode: string;
  metricName?: string | null;
  actualValue?: number | null;
  basisValue?: number | null;
  warnThresholdValue?: number | null;
  criticalThresholdValue?: number | null;
  status: 'ok' | 'warning' | 'critical';
  blocking: boolean;
  message: string;
  sortOrder: number;
}

@Service()
export class RiskPreTradeService {
  @Inject(() => RiskRepository)
  private riskRepository!: RiskRepository;

  @Inject(() => RiskAccountSnapshotRepository)
  private riskAccountSnapshotRepository!: RiskAccountSnapshotRepository;

  @Inject(() => RiskAssetSnapshotRepository)
  private riskAssetSnapshotRepository!: RiskAssetSnapshotRepository;

  @Inject(() => RiskBrokerAssetSnapshotRepository)
  private riskBrokerAssetSnapshotRepository!: RiskBrokerAssetSnapshotRepository;

  @Inject(() => RiskBrokerSnapshotRepository)
  private riskBrokerSnapshotRepository!: RiskBrokerSnapshotRepository;

  @Inject(() => RiskSnapshotPolicyContextRepository)
  private riskSnapshotPolicyContextRepository!: RiskSnapshotPolicyContextRepository;

  @Inject(() => RiskSnapshotSourceCoverageRepository)
  private riskSnapshotSourceCoverageRepository!: RiskSnapshotSourceCoverageRepository;

  @Inject(() => RiskPolicyRepository)
  private riskPolicyRepository!: RiskPolicyRepository;

  @Inject(() => BrokerAccountRepository)
  private brokerAccountRepository!: BrokerAccountRepository;

  @Inject(() => SuggestedTradeRepository)
  private suggestedTradeRepository!: SuggestedTradeRepository;

  @Inject(() => RiskRequestCheckRepository)
  private riskRequestCheckRepository!: RiskRequestCheckRepository;

  @Inject(() => RiskRequestScopeImpactRepository)
  private riskRequestScopeImpactRepository!: RiskRequestScopeImpactRepository;

  @Inject(() => RiskRequestRuleEvaluationRepository)
  private riskRequestRuleEvaluationRepository!: RiskRequestRuleEvaluationRepository;

  @Inject(() => UserTimeZoneService)
  private userTimeZoneService!: UserTimeZoneService;

  async createPreTradeCheck(
    userId: string,
    body: ValidatedRiskPreTradeCheckBody
  ): Promise<ApiSuccessResponse<RiskPreTradeCheckResult>> {
    const suggestedTrade = body.suggestedTradeId
      ? await this.loadSuggestedTrade(userId, body.suggestedTradeId)
      : null;
    const snapshot = await this.loadSnapshot(userId, body.snapshotId);
    const request = this.resolveRequest(body, suggestedTrade, snapshot);
    const route = await this.resolveRoute(userId, request.route);
    request.route = route;

    const [timeZone, accountSnapshots, brokerSnapshots, assetSnapshots, brokerAssetSnapshots, policyContexts, sourceCoverage] =
      await Promise.all([
        this.userTimeZoneService.resolveUserTimeZone(userId),
        snapshot ? this.riskAccountSnapshotRepository.listBySnapshotId(snapshot.id) : Promise.resolve([]),
        snapshot ? this.riskBrokerSnapshotRepository.listBySnapshotId(snapshot.id) : Promise.resolve([]),
        snapshot ? this.riskAssetSnapshotRepository.listBySnapshotId(snapshot.id) : Promise.resolve([]),
        snapshot ? this.riskBrokerAssetSnapshotRepository.listBySnapshotId(snapshot.id) : Promise.resolve([]),
        snapshot ? this.riskSnapshotPolicyContextRepository.listBySnapshotId(snapshot.id) : Promise.resolve([]),
        snapshot ? this.riskSnapshotSourceCoverageRepository.listBySnapshotId(snapshot.id) : Promise.resolve([]),
      ]);

    const activePolicy = await this.riskPolicyRepository.getEffectivePolicy(userId, route.brokerKey);
    const fallbackThresholds = this.buildThresholdProfile(activePolicy);
    const globalThresholds = this.buildGlobalThresholdProfile(policyContexts, fallbackThresholds);
    const routePolicyContext = this.resolvePolicyContext(policyContexts, route.brokerKey);
    const routeThresholds = this.buildThresholdProfile(routePolicyContext || activePolicy);
    const accountSnapshot = route.accountId
      ? accountSnapshots.find((item) => item.accountId === route.accountId) || null
      : null;
    const brokerSnapshot = route.brokerKey
      ? brokerSnapshots.find((item) => item.brokerKey === route.brokerKey) || null
      : null;
    const assetSnapshot =
      assetSnapshots.find((item) => item.symbol === request.order.symbol) || null;
    const brokerAssetSnapshot =
      route.brokerKey
        ? brokerAssetSnapshots.find(
            (item) =>
              item.brokerKey === route.brokerKey && item.symbol === request.order.symbol
          ) || null
        : null;
    const coverage =
      route.accountId
        ? sourceCoverage.find((item) => item.accountId === route.accountId) || null
        : null;

    const notional = this.resolveRequestedNotional(request.order, snapshot);
    const grossExposureDelta = notional;
    const netExposureDelta = request.order.side === 'BUY' ? notional : -notional;
    const openOrderExposureDelta = notional;
    const reservedOrderMarginDelta = this.resolveReservedOrderMarginDelta(
      notional,
      request.order.leverage
    );

    const freshness = this.resolveFreshness(snapshot, coverage);
    const scopeImpactDrafts = this.buildScopeImpactDrafts({
      snapshot,
      route,
      accountSnapshot,
      brokerSnapshot,
      assetSnapshot,
      brokerAssetSnapshot,
      grossExposureDelta,
      netExposureDelta,
      openOrderExposureDelta,
      reservedOrderMarginDelta,
    });

    const ruleDrafts = this.buildRuleEvaluationDrafts({
      snapshot,
      route,
      order: request.order,
      coverage,
      freshness,
      globalThresholds,
      routePolicyContext,
      routeThresholds,
      accountSnapshot,
      brokerSnapshot,
      assetSnapshot,
      brokerAssetSnapshot,
      grossExposureDelta,
      netExposureDelta,
      openOrderExposureDelta,
      reservedOrderMarginDelta,
      notional,
    });

    this.applyProjectedScopeStates(scopeImpactDrafts, ruleDrafts);

    const blockingRuleCount = ruleDrafts.filter((item) => item.blocking).length;
    const warningRuleCount = ruleDrafts.filter(
      (item) => !item.blocking && item.status !== 'ok'
    ).length;
    const blocked = blockingRuleCount > 0;
    const approvalRequired = !blocked && request.approvalMode === 'manual_review';
    const status = this.resolveCheckStatus(blocked, freshness.freshnessState, warningRuleCount);
    const summary = this.buildCheckSummary({
      blocked,
      approvalRequired,
      warningRuleCount,
      blockingRules: ruleDrafts.filter((item) => item.blocking),
      freshness,
    });
    const checkedAt = new Date();
    const expiresAt =
      snapshot && freshness.freshnessState !== 'unavailable'
        ? new Date(checkedAt.getTime() + 30 * 60 * 1000)
        : null;

    const createdCheck = await this.riskRequestCheckRepository.createCheck({
      userId,
      snapshotId: snapshot?.id ?? null,
      suggestedTradeId: request.suggestedTradeId,
      automationId: request.automationId,
      automationRunId: request.automationRunId,
      sourceType: request.sourceType,
      executionMode: request.executionMode,
      approvalMode: request.approvalMode,
      routeMode: route.routeMode,
      brokerKey: route.brokerKey,
      accountId: route.accountId,
      symbol: request.order.symbol,
      timeframe: request.order.timeframe,
      side: request.order.side,
      orderType: request.order.orderType,
      timeInForce: request.order.timeInForce,
      quantityMode: request.order.quantityMode,
      quantity: request.order.quantity,
      notional: request.order.notional,
      riskPercent: request.order.riskPercent,
      entryPrice: request.order.entryPrice,
      stopLossPrice: request.order.stopLossPrice,
      takeProfitTargetsJson: request.order.takeProfitTargets,
      leverage: request.order.leverage,
      reduceOnly: request.order.reduceOnly,
      status,
      freshnessState: freshness.freshnessState,
      snapshotLagMinutes: freshness.snapshotLagMinutes,
      checkedAt,
      expiresAt,
      allowed: !blocked,
      blocked,
      approvalRequired,
      blockingRuleCount,
      warningRuleCount,
      summary,
      grossExposureDelta,
      netExposureDelta,
      openOrderExposureDelta,
      reservedOrderMarginDelta,
    });

    const scopeRows = await this.riskRequestScopeImpactRepository.createScopeImpacts(
      userId,
      createdCheck.id,
      snapshot?.id ?? null,
      scopeImpactDrafts
    );
    const ruleRows = await this.riskRequestRuleEvaluationRepository.createRuleEvaluations(
      userId,
      createdCheck.id,
      snapshot?.id ?? null,
      ruleDrafts
    );

    return successResponse(
      this.mapPreTradeCheckResult(
        createdCheck,
        scopeRows,
        ruleRows,
        snapshot,
        policyContexts,
        timeZone
      )
    );
  }

  async getPreTradeCheck(
    userId: string,
    checkId: string
  ): Promise<ApiSuccessResponse<RiskPreTradeCheckResult>> {
    const check = await this.riskRequestCheckRepository.getById(userId, checkId);
    if (!check) {
      throw new NotFoundAppError('Pre-trade check not found');
    }

    const [timeZone, snapshot, scopeRows, ruleRows, policyContexts] = await Promise.all([
      this.userTimeZoneService.resolveUserTimeZone(userId),
      check.snapshotId ? this.riskRepository.getSnapshotById(userId, check.snapshotId) : Promise.resolve(null),
      this.riskRequestScopeImpactRepository.listByCheckId(check.id),
      this.riskRequestRuleEvaluationRepository.listByCheckId(check.id),
      check.snapshotId
        ? this.riskSnapshotPolicyContextRepository.listBySnapshotId(check.snapshotId)
        : Promise.resolve([]),
    ]);

    return successResponse(
      this.mapPreTradeCheckResult(check, scopeRows, ruleRows, snapshot, policyContexts, timeZone)
    );
  }

  private async loadSuggestedTrade(
    userId: string,
    suggestedTradeId: string
  ): Promise<SuggestedTrade> {
    const suggestedTrade = await this.suggestedTradeRepository.getSuggestedTradeById(
      userId,
      suggestedTradeId
    );
    if (!suggestedTrade) {
      throw new NotFoundAppError('Suggested trade not found');
    }
    return suggestedTrade;
  }

  private async loadSnapshot(
    userId: string,
    requestedSnapshotId?: string
  ): Promise<RiskSnapshot | null> {
    const snapshotId = String(requestedSnapshotId || '').trim();
    if (!snapshotId) {
      return this.riskRepository.getLatestSnapshot(userId);
    }

    const snapshot = await this.riskRepository.getSnapshotById(userId, snapshotId);
    if (!snapshot) {
      throw new NotFoundAppError('Risk snapshot not found');
    }
    return snapshot;
  }

  private resolveRequest(
    body: ValidatedRiskPreTradeCheckBody,
    suggestedTrade: SuggestedTrade | null,
    snapshot: RiskSnapshot | null
  ): EffectivePreTradeRequest {
    const symbol = String(body.order.symbol || suggestedTrade?.symbol || '')
      .trim()
      .toUpperCase();
    if (!symbol) {
      throw new BadRequestAppError('order.symbol is required when suggestedTradeId is not provided');
    }

    const side = this.resolveOrderSide(body.order.side, suggestedTrade?.side);
    const timeframe =
      String(body.order.timeframe || suggestedTrade?.timeframe || '').trim() || null;
    const entryPrice =
      this.toFiniteNumber(body.order.entryPrice, null) ??
      this.toFiniteNumber(suggestedTrade?.entryPrice, null);
    const stopLossPrice =
      this.toFiniteNumber(body.order.stopLossPrice, null) ??
      this.toFiniteNumber(suggestedTrade?.stopLossPrice, null);
    const takeProfitTargets = body.order.takeProfitTargets?.length
      ? body.order.takeProfitTargets
      : Array.isArray(suggestedTrade?.takeProfitTargets)
        ? suggestedTrade.takeProfitTargets
            .map((item) => this.toFiniteNumber(item, null))
            .filter((item): item is number => item !== null)
        : null;

    const request: EffectivePreTradeRequest = {
      snapshotId: snapshot?.id ?? null,
      suggestedTradeId: suggestedTrade?.id ?? body.suggestedTradeId ?? null,
      automationId: body.automationId || suggestedTrade?.automationId || null,
      automationRunId: body.automationRunId || suggestedTrade?.automationRunId || null,
      sourceType: body.sourceType,
      executionMode: body.executionMode,
      approvalMode: body.approvalMode,
      route: {
        routeMode: body.routing.routeMode,
        brokerKey: body.routing.brokerKey ?? null,
        accountId: body.routing.accountId ?? null,
        accountName: null,
      },
      order: {
        symbol,
        timeframe,
        side,
        orderType: body.order.orderType,
        timeInForce: body.order.timeInForce ?? null,
        quantityMode: body.order.quantityMode,
        quantity: body.order.quantity ?? null,
        notional: body.order.notional ?? null,
        riskPercent: body.order.riskPercent ?? null,
        entryPrice,
        stopLossPrice,
        takeProfitTargets: takeProfitTargets?.length ? takeProfitTargets : null,
        leverage: body.order.leverage ?? null,
        reduceOnly: body.order.reduceOnly,
      },
    };

    if (
      request.order.quantityMode === 'risk_percent' &&
      !((this.toFiniteNumber(snapshot?.portfolioEquity, 0) ?? 0) > 0)
    ) {
      throw new BadRequestAppError(
        'A positive portfolio equity snapshot is required when quantityMode is risk_percent'
      );
    }

    return request;
  }

  private resolveOrderSide(
    side?: 'BUY' | 'SELL',
    suggestedTradeSide?: string | null
  ): 'BUY' | 'SELL' {
    const normalized =
      side ||
      (String(suggestedTradeSide || '').trim().toUpperCase() === 'SELL' ? 'SELL' : undefined) ||
      (String(suggestedTradeSide || '').trim().toUpperCase() === 'BUY' ? 'BUY' : undefined);
    if (!normalized) {
      throw new BadRequestAppError(
        'order.side is required when suggestedTradeId does not provide a side'
      );
    }
    return normalized;
  }

  private async resolveRoute(
    userId: string,
    route: ResolvedPreTradeRoute
  ): Promise<ResolvedPreTradeRoute> {
    const requestedBrokerKey = String(route.brokerKey || '').trim().toLowerCase() || null;
    const requestedAccountId = String(route.accountId || '').trim() || null;

    if (requestedAccountId) {
      const account = await this.brokerAccountRepository.getBrokerAccountById(
        userId,
        requestedAccountId
      );
      if (!account) {
        throw new NotFoundAppError('Broker account not found');
      }
      if (requestedBrokerKey && requestedBrokerKey !== String(account.brokerKey || '').trim().toLowerCase()) {
        throw new BadRequestAppError(
          'Selected broker account does not belong to the requested broker'
        );
      }
      return {
        routeMode: route.routeMode,
        brokerKey: String(account.brokerKey || '').trim().toLowerCase() || null,
        accountId: account.id,
        accountName: String(account.accountName || account.accountKey || account.id || '').trim() || null,
      };
    }

    if (requestedBrokerKey) {
      const preferredAccount = await this.brokerAccountRepository.getPreferredBrokerAccountByBrokerKey(
        userId,
        requestedBrokerKey
      );
      return {
        routeMode: route.routeMode,
        brokerKey: requestedBrokerKey,
        accountId: preferredAccount?.id || null,
        accountName:
          String(
            preferredAccount?.accountName ||
              preferredAccount?.accountKey ||
              preferredAccount?.id ||
              ''
          ).trim() || null,
      };
    }

    const connectedAccounts = await this.brokerAccountRepository.getConnectedBrokerAccounts(userId);
    const preferredAccount = connectedAccounts[0] || null;
    return {
      routeMode: route.routeMode,
      brokerKey: preferredAccount
        ? String(preferredAccount.brokerKey || '').trim().toLowerCase() || null
        : null,
      accountId: preferredAccount?.id || null,
      accountName:
        String(preferredAccount?.accountName || preferredAccount?.accountKey || '').trim() || null,
    };
  }

  private buildThresholdProfile(
    value:
      | RiskSnapshotPolicyContext
      | {
          marginUsageWarnPct?: number | null;
          marginUsageCriticalPct?: number | null;
          concentrationWarnPct?: number | null;
          concentrationCriticalPct?: number | null;
          dailyLossLimitPct?: number | null;
          weeklyLossLimitPct?: number | null;
          monthlyLossLimitPct?: number | null;
          maxLeverage?: number | null;
          maxOrderAllocation?: number | null;
          maxTotalAllocation?: number | null;
          maxAvgLeverage?: number | null;
        }
      | null
      | undefined
  ): ThresholdProfile {
    return {
      marginUsageWarnPct: this.toFiniteNumber(value?.marginUsageWarnPct, 70) ?? 70,
      marginUsageCriticalPct: this.toFiniteNumber(value?.marginUsageCriticalPct, 85) ?? 85,
      concentrationWarnPct: this.toFiniteNumber(value?.concentrationWarnPct, 30) ?? 30,
      concentrationCriticalPct: this.toFiniteNumber(value?.concentrationCriticalPct, 45) ?? 45,
      dailyLossLimitPct: this.toFiniteNumber(value?.dailyLossLimitPct, 5) ?? 5,
      weeklyLossLimitPct: this.toFiniteNumber(value?.weeklyLossLimitPct, 12) ?? 12,
      monthlyLossLimitPct: this.toFiniteNumber(value?.monthlyLossLimitPct, 20) ?? 20,
      maxLeverage: this.toFiniteNumber(value?.maxLeverage, 5) ?? 5,
      maxOrderAllocation: this.toFiniteNumber(value?.maxOrderAllocation, null),
      maxTotalAllocation: this.toFiniteNumber(value?.maxTotalAllocation, 80) ?? 80,
      maxAvgLeverage: this.toFiniteNumber(value?.maxAvgLeverage, 4) ?? 4,
    };
  }

  private buildGlobalThresholdProfile(
    rows: RiskSnapshotPolicyContext[],
    fallback: ThresholdProfile
  ): ThresholdProfile {
    if (!rows.length) {
      return fallback;
    }

    return rows.reduce<ThresholdProfile>(
      (accumulator, row) => {
        const next = this.buildThresholdProfile(row);
        return {
          marginUsageWarnPct: Math.min(accumulator.marginUsageWarnPct, next.marginUsageWarnPct),
          marginUsageCriticalPct: Math.min(
            accumulator.marginUsageCriticalPct,
            next.marginUsageCriticalPct
          ),
          concentrationWarnPct: Math.min(
            accumulator.concentrationWarnPct,
            next.concentrationWarnPct
          ),
          concentrationCriticalPct: Math.min(
            accumulator.concentrationCriticalPct,
            next.concentrationCriticalPct
          ),
          dailyLossLimitPct: Math.min(accumulator.dailyLossLimitPct, next.dailyLossLimitPct),
          weeklyLossLimitPct: Math.min(accumulator.weeklyLossLimitPct, next.weeklyLossLimitPct),
          monthlyLossLimitPct: Math.min(
            accumulator.monthlyLossLimitPct,
            next.monthlyLossLimitPct
          ),
          maxLeverage: Math.min(accumulator.maxLeverage, next.maxLeverage),
          maxOrderAllocation:
            accumulator.maxOrderAllocation === null
              ? next.maxOrderAllocation
              : next.maxOrderAllocation === null
                ? accumulator.maxOrderAllocation
                : Math.min(accumulator.maxOrderAllocation, next.maxOrderAllocation),
          maxTotalAllocation: Math.min(accumulator.maxTotalAllocation, next.maxTotalAllocation),
          maxAvgLeverage: Math.min(accumulator.maxAvgLeverage, next.maxAvgLeverage),
        };
      },
      fallback
    );
  }

  private resolvePolicyContext(
    rows: RiskSnapshotPolicyContext[],
    brokerKey?: string | null
  ): RiskSnapshotPolicyContext | null {
    const normalizedBrokerKey = String(brokerKey || '').trim().toLowerCase();
    if (normalizedBrokerKey) {
      const brokerPolicy = rows.find(
        (row) =>
          String(row.policyScope || '').trim().toLowerCase() === 'broker' &&
          String(row.policyTargetKey || '').trim().toLowerCase() === normalizedBrokerKey
      );
      if (brokerPolicy) {
        return brokerPolicy;
      }
    }

    return (
      rows.find((row) => String(row.policyScope || '').trim().toLowerCase() === 'user') || null
    );
  }

  private resolveRequestedNotional(
    order: ResolvedPreTradeOrder,
    snapshot: RiskSnapshot | null
  ): number {
    if (order.quantityMode === 'notional') {
      const notional = this.toFiniteNumber(order.notional, null);
      if (!(notional && notional > 0)) {
        throw new BadRequestAppError('order.notional must be greater than 0');
      }
      return this.roundNumber(Math.abs(notional), 2);
    }

    if (order.quantityMode === 'risk_percent') {
      const riskPercent = this.toFiniteNumber(order.riskPercent, null);
      const equity = this.toFiniteNumber(snapshot?.portfolioEquity, null);
      if (!(riskPercent && riskPercent > 0 && equity && equity > 0)) {
        throw new BadRequestAppError(
          'A positive snapshot equity and riskPercent are required for quantityMode risk_percent'
        );
      }
      return this.roundNumber((equity * riskPercent) / 100, 2);
    }

    const quantity = this.toFiniteNumber(order.quantity, null);
    const entryPrice = this.toFiniteNumber(order.entryPrice, null);
    if (!(quantity && quantity > 0 && entryPrice && entryPrice > 0)) {
      throw new BadRequestAppError(
        'order.quantity and order.entryPrice are required for quantityMode quantity'
      );
    }
    return this.roundNumber(Math.abs(quantity * entryPrice), 2);
  }

  private resolveReservedOrderMarginDelta(notional: number, leverage?: number | null): number {
    const normalizedLeverage = this.toFiniteNumber(leverage, null);
    if (normalizedLeverage && normalizedLeverage > 0) {
      return this.roundNumber(notional / normalizedLeverage, 2);
    }
    return this.roundNumber(notional, 2);
  }

  private resolveFreshness(
    snapshot: RiskSnapshot | null,
    coverage: RiskSnapshotSourceCoverage | null
  ): FreshnessSummary {
    if (!snapshot) {
      return {
        freshnessState: 'unavailable',
        snapshotLagMinutes: null,
        blocking: true,
        message: 'No persisted risk snapshot is available for this pre-trade check.',
      };
    }

    const snapshotLagMinutes = this.roundNumber(
      (Date.now() - snapshot.createdAt.getTime()) / 60000,
      2
    );

    if (!coverage) {
      return {
        freshnessState: 'partial',
        snapshotLagMinutes,
        blocking: true,
        message: 'The selected route does not have source coverage in the current risk snapshot.',
      };
    }

    const hasFunds =
      Boolean(coverage.latestSuccessWalletAvailable) ||
      Boolean(coverage.latestSuccessFuturesAvailable);
    const hasPositionCoverage =
      Boolean(coverage.positionsObservedAt) ||
      Boolean(coverage.latestPositionSnapshotSeenAt) ||
      Boolean(coverage.latestPositionReadModelSeenAt) ||
      coverage.positionSnapshotRows > 0 ||
      coverage.positionReadModelRows > 0;

    if (!hasFunds || !hasPositionCoverage) {
      return {
        freshnessState: 'partial',
        snapshotLagMinutes,
        blocking: true,
        message: 'Snapshot-backed source coverage is incomplete for the selected route.',
      };
    }

    if (snapshotLagMinutes > 60) {
      return {
        freshnessState: 'lagging',
        snapshotLagMinutes,
        blocking: false,
        message: 'The latest risk snapshot is older than 60 minutes and should be refreshed.',
      };
    }

    return {
      freshnessState: 'fresh',
      snapshotLagMinutes,
      blocking: false,
      message: 'Risk snapshot freshness is within the expected decision window.',
    };
  }

  private buildScopeImpactDrafts(input: {
    snapshot: RiskSnapshot | null;
    route: ResolvedPreTradeRoute;
    accountSnapshot: RiskAccountSnapshot | null;
    brokerSnapshot: RiskBrokerSnapshot | null;
    assetSnapshot: RiskAssetSnapshot | null;
    brokerAssetSnapshot: RiskBrokerAssetSnapshot | null;
    grossExposureDelta: number;
    netExposureDelta: number;
    openOrderExposureDelta: number;
    reservedOrderMarginDelta: number;
  }): ScopeImpactDraft[] {
    const scopes: ScopeImpactDraft[] = [];
    const portfolioEquity = this.toFiniteNumber(input.snapshot?.portfolioEquity, null);

    scopes.push({
      scopeType: 'portfolio',
      scopeKey: 'portfolio',
      scopeLabel: 'Portfolio',
      beforeGrossExposure: this.toFiniteNumber(input.snapshot?.grossExposure, null),
      beforeNetExposure: this.toFiniteNumber(input.snapshot?.netExposure, null),
      beforeOpenOrderExposure: this.toFiniteNumber(input.snapshot?.openOrderExposure, null),
      beforeReservedOrderMargin: this.toFiniteNumber(input.snapshot?.reservedOrderMargin, null),
      beforeMarginUsagePct: this.toRatioPct(
        input.snapshot?.grossExposure,
        input.snapshot?.portfolioEquity
      ),
      beforeAllocationPct: this.toRatioPct(
        input.snapshot?.grossExposure,
        input.snapshot?.portfolioEquity
      ),
      beforeRiskScore: this.parseRiskScore(input.snapshot?.portfolioRiskScore),
      beforeRiskState: this.normalizeRiskState(input.snapshot?.portfolioRisk),
      deltaGrossExposure: input.grossExposureDelta,
      deltaNetExposure: input.netExposureDelta,
      deltaOpenOrderExposure: input.openOrderExposureDelta,
      deltaReservedOrderMargin: input.reservedOrderMarginDelta,
      afterGrossExposure: this.roundNumber(
        (this.toFiniteNumber(input.snapshot?.grossExposure, 0) ?? 0) + input.grossExposureDelta,
        2
      ),
      afterNetExposure: this.roundNumber(
        (this.toFiniteNumber(input.snapshot?.netExposure, 0) ?? 0) + input.netExposureDelta,
        2
      ),
      afterOpenOrderExposure: this.roundNumber(
        (this.toFiniteNumber(input.snapshot?.openOrderExposure, 0) ?? 0) + input.openOrderExposureDelta,
        2
      ),
      afterReservedOrderMargin: this.roundNumber(
        (this.toFiniteNumber(input.snapshot?.reservedOrderMargin, 0) ?? 0) +
          input.reservedOrderMarginDelta,
        2
      ),
      afterMarginUsagePct: portfolioEquity
        ? this.toRatioPct(
            (this.toFiniteNumber(input.snapshot?.grossExposure, 0) ?? 0) +
              input.grossExposureDelta,
            portfolioEquity
          )
        : null,
      afterAllocationPct: portfolioEquity
        ? this.toRatioPct(
            (this.toFiniteNumber(input.snapshot?.grossExposure, 0) ?? 0) +
              input.grossExposureDelta,
            portfolioEquity
          )
        : null,
      afterRiskScore: this.parseRiskScore(input.snapshot?.portfolioRiskScore),
      afterRiskState: this.normalizeRiskState(input.snapshot?.portfolioRisk),
      sortOrder: 0,
    });

    if (input.route.brokerKey) {
      const trackedBalance = this.toFiniteNumber(
        input.brokerSnapshot?.trackedBalance,
        this.toFiniteNumber(input.accountSnapshot?.trackedBalance, null)
      );
      scopes.push({
        scopeType: 'broker',
        scopeKey: input.route.brokerKey,
        scopeLabel: input.route.brokerKey,
        brokerKey: input.route.brokerKey,
        beforeGrossExposure: this.toFiniteNumber(input.brokerSnapshot?.grossExposure, 0),
        beforeNetExposure: this.toFiniteNumber(input.brokerSnapshot?.netExposure, 0),
        beforeOpenOrderExposure: this.toFiniteNumber(input.brokerSnapshot?.openOrderExposure, 0),
        beforeReservedOrderMargin: this.toFiniteNumber(
          input.brokerSnapshot?.reservedOrderMargin,
          0
        ),
        beforeMarginUsagePct: this.toRatioPct(input.brokerSnapshot?.grossExposure, trackedBalance),
        beforeAllocationPct: this.toRatioPct(
          input.brokerSnapshot?.grossExposure,
          portfolioEquity
        ),
        beforeRiskScore: this.toFiniteNumber(input.brokerSnapshot?.riskScore, null),
        beforeRiskState: this.normalizeRiskState(input.brokerSnapshot?.riskState),
        deltaGrossExposure: input.grossExposureDelta,
        deltaNetExposure: input.netExposureDelta,
        deltaOpenOrderExposure: input.openOrderExposureDelta,
        deltaReservedOrderMargin: input.reservedOrderMarginDelta,
        afterGrossExposure: this.roundNumber(
          (this.toFiniteNumber(input.brokerSnapshot?.grossExposure, 0) ?? 0) +
            input.grossExposureDelta,
          2
        ),
        afterNetExposure: this.roundNumber(
          (this.toFiniteNumber(input.brokerSnapshot?.netExposure, 0) ?? 0) +
            input.netExposureDelta,
          2
        ),
        afterOpenOrderExposure: this.roundNumber(
          (this.toFiniteNumber(input.brokerSnapshot?.openOrderExposure, 0) ?? 0) +
            input.openOrderExposureDelta,
          2
        ),
        afterReservedOrderMargin: this.roundNumber(
          (this.toFiniteNumber(input.brokerSnapshot?.reservedOrderMargin, 0) ?? 0) +
            input.reservedOrderMarginDelta,
          2
        ),
        afterMarginUsagePct: this.toRatioPct(
          (this.toFiniteNumber(input.brokerSnapshot?.grossExposure, 0) ?? 0) +
            input.grossExposureDelta,
          trackedBalance
        ),
        afterAllocationPct: this.toRatioPct(
          (this.toFiniteNumber(input.brokerSnapshot?.grossExposure, 0) ?? 0) +
            input.grossExposureDelta,
          portfolioEquity
        ),
        afterRiskScore: this.toFiniteNumber(input.brokerSnapshot?.riskScore, null),
        afterRiskState: this.normalizeRiskState(input.brokerSnapshot?.riskState),
        sortOrder: scopes.length,
      });
    }

    if (input.route.accountId) {
      const trackedBalance = this.toFiniteNumber(input.accountSnapshot?.trackedBalance, null);
      scopes.push({
        scopeType: 'account',
        scopeKey: input.route.accountId,
        scopeLabel: input.route.accountName || input.route.accountId,
        brokerKey: input.route.brokerKey,
        accountId: input.route.accountId,
        beforeGrossExposure: this.toFiniteNumber(input.accountSnapshot?.grossExposure, 0),
        beforeNetExposure: this.toFiniteNumber(input.accountSnapshot?.netExposure, 0),
        beforeOpenOrderExposure: this.toFiniteNumber(input.accountSnapshot?.openOrderExposure, 0),
        beforeReservedOrderMargin: this.toFiniteNumber(
          input.accountSnapshot?.reservedOrderMargin,
          0
        ),
        beforeMarginUsagePct: this.toRatioPct(input.accountSnapshot?.grossExposure, trackedBalance),
        beforeAllocationPct: this.toFiniteNumber(
          input.accountSnapshot?.portfolioConcentrationPct,
          null
        ),
        beforeRiskScore: null,
        beforeRiskState: null,
        deltaGrossExposure: input.grossExposureDelta,
        deltaNetExposure: input.netExposureDelta,
        deltaOpenOrderExposure: input.openOrderExposureDelta,
        deltaReservedOrderMargin: input.reservedOrderMarginDelta,
        afterGrossExposure: this.roundNumber(
          (this.toFiniteNumber(input.accountSnapshot?.grossExposure, 0) ?? 0) +
            input.grossExposureDelta,
          2
        ),
        afterNetExposure: this.roundNumber(
          (this.toFiniteNumber(input.accountSnapshot?.netExposure, 0) ?? 0) +
            input.netExposureDelta,
          2
        ),
        afterOpenOrderExposure: this.roundNumber(
          (this.toFiniteNumber(input.accountSnapshot?.openOrderExposure, 0) ?? 0) +
            input.openOrderExposureDelta,
          2
        ),
        afterReservedOrderMargin: this.roundNumber(
          (this.toFiniteNumber(input.accountSnapshot?.reservedOrderMargin, 0) ?? 0) +
            input.reservedOrderMarginDelta,
          2
        ),
        afterMarginUsagePct: this.toRatioPct(
          (this.toFiniteNumber(input.accountSnapshot?.grossExposure, 0) ?? 0) +
            input.grossExposureDelta,
          trackedBalance
        ),
        afterAllocationPct: portfolioEquity
          ? this.toRatioPct(
              (this.toFiniteNumber(input.accountSnapshot?.grossExposure, 0) ?? 0) +
                input.grossExposureDelta,
              portfolioEquity
            )
          : null,
        afterRiskScore: null,
        afterRiskState: null,
        sortOrder: scopes.length,
      });
    }

    scopes.push({
      scopeType: 'asset',
      scopeKey: input.assetSnapshot?.symbol || input.brokerAssetSnapshot?.symbol || '',
      scopeLabel: input.assetSnapshot?.symbol || input.brokerAssetSnapshot?.symbol || '',
      symbol: input.assetSnapshot?.symbol || input.brokerAssetSnapshot?.symbol || null,
      beforeGrossExposure: this.toFiniteNumber(input.assetSnapshot?.grossExposure, 0),
      beforeNetExposure: this.toFiniteNumber(input.assetSnapshot?.netExposure, 0),
      beforeOpenOrderExposure: this.toFiniteNumber(input.assetSnapshot?.openOrderExposure, 0),
      beforeReservedOrderMargin: this.toFiniteNumber(input.assetSnapshot?.reservedOrderMargin, 0),
      beforeMarginUsagePct: null,
      beforeAllocationPct: this.toRatioPct(input.assetSnapshot?.grossExposure, portfolioEquity),
      beforeRiskScore: this.toFiniteNumber(input.assetSnapshot?.riskScore, null),
      beforeRiskState: this.normalizeRiskState(input.assetSnapshot?.riskState),
      deltaGrossExposure: input.grossExposureDelta,
      deltaNetExposure: input.netExposureDelta,
      deltaOpenOrderExposure: input.openOrderExposureDelta,
      deltaReservedOrderMargin: input.reservedOrderMarginDelta,
      afterGrossExposure: this.roundNumber(
        (this.toFiniteNumber(input.assetSnapshot?.grossExposure, 0) ?? 0) +
          input.grossExposureDelta,
        2
      ),
      afterNetExposure: this.roundNumber(
        (this.toFiniteNumber(input.assetSnapshot?.netExposure, 0) ?? 0) + input.netExposureDelta,
        2
      ),
      afterOpenOrderExposure: this.roundNumber(
        (this.toFiniteNumber(input.assetSnapshot?.openOrderExposure, 0) ?? 0) +
          input.openOrderExposureDelta,
        2
      ),
      afterReservedOrderMargin: this.roundNumber(
        (this.toFiniteNumber(input.assetSnapshot?.reservedOrderMargin, 0) ?? 0) +
          input.reservedOrderMarginDelta,
        2
      ),
      afterMarginUsagePct: null,
      afterAllocationPct: this.toRatioPct(
        (this.toFiniteNumber(input.assetSnapshot?.grossExposure, 0) ?? 0) +
          input.grossExposureDelta,
        portfolioEquity
      ),
      afterRiskScore: this.toFiniteNumber(input.assetSnapshot?.riskScore, null),
      afterRiskState: this.normalizeRiskState(input.assetSnapshot?.riskState),
      sortOrder: scopes.length,
    });

    if (input.route.brokerKey) {
      const trackedBalance = this.toFiniteNumber(
        input.brokerSnapshot?.trackedBalance,
        this.toFiniteNumber(input.accountSnapshot?.trackedBalance, null)
      );
      scopes.push({
        scopeType: 'broker_asset',
        scopeKey: `${input.route.brokerKey}|${input.assetSnapshot?.symbol || input.brokerAssetSnapshot?.symbol || ''}`,
        scopeLabel: `${input.route.brokerKey} / ${input.assetSnapshot?.symbol || input.brokerAssetSnapshot?.symbol || ''}`,
        brokerKey: input.route.brokerKey,
        symbol: input.assetSnapshot?.symbol || input.brokerAssetSnapshot?.symbol || null,
        beforeGrossExposure: this.toFiniteNumber(input.brokerAssetSnapshot?.grossExposure, 0),
        beforeNetExposure: this.toFiniteNumber(input.brokerAssetSnapshot?.netExposure, 0),
        beforeOpenOrderExposure: this.toFiniteNumber(
          input.brokerAssetSnapshot?.openOrderExposure,
          0
        ),
        beforeReservedOrderMargin: this.toFiniteNumber(
          input.brokerAssetSnapshot?.reservedOrderMargin,
          0
        ),
        beforeMarginUsagePct: this.toRatioPct(
          input.brokerAssetSnapshot?.grossExposure,
          trackedBalance
        ),
        beforeAllocationPct: this.toRatioPct(
          input.brokerAssetSnapshot?.grossExposure,
          portfolioEquity
        ),
        beforeRiskScore: this.toFiniteNumber(input.brokerAssetSnapshot?.riskScore, null),
        beforeRiskState: this.normalizeRiskState(input.brokerAssetSnapshot?.riskState),
        deltaGrossExposure: input.grossExposureDelta,
        deltaNetExposure: input.netExposureDelta,
        deltaOpenOrderExposure: input.openOrderExposureDelta,
        deltaReservedOrderMargin: input.reservedOrderMarginDelta,
        afterGrossExposure: this.roundNumber(
          (this.toFiniteNumber(input.brokerAssetSnapshot?.grossExposure, 0) ?? 0) +
            input.grossExposureDelta,
          2
        ),
        afterNetExposure: this.roundNumber(
          (this.toFiniteNumber(input.brokerAssetSnapshot?.netExposure, 0) ?? 0) +
            input.netExposureDelta,
          2
        ),
        afterOpenOrderExposure: this.roundNumber(
          (this.toFiniteNumber(input.brokerAssetSnapshot?.openOrderExposure, 0) ?? 0) +
            input.openOrderExposureDelta,
          2
        ),
        afterReservedOrderMargin: this.roundNumber(
          (this.toFiniteNumber(input.brokerAssetSnapshot?.reservedOrderMargin, 0) ?? 0) +
            input.reservedOrderMarginDelta,
          2
        ),
        afterMarginUsagePct: this.toRatioPct(
          (this.toFiniteNumber(input.brokerAssetSnapshot?.grossExposure, 0) ?? 0) +
            input.grossExposureDelta,
          trackedBalance
        ),
        afterAllocationPct: this.toRatioPct(
          (this.toFiniteNumber(input.brokerAssetSnapshot?.grossExposure, 0) ?? 0) +
            input.grossExposureDelta,
          portfolioEquity
        ),
        afterRiskScore: this.toFiniteNumber(input.brokerAssetSnapshot?.riskScore, null),
        afterRiskState: this.normalizeRiskState(input.brokerAssetSnapshot?.riskState),
        sortOrder: scopes.length,
      });
    }

    return scopes.filter((item) => String(item.scopeKey || '').trim());
  }

  private buildRuleEvaluationDrafts(input: {
    snapshot: RiskSnapshot | null;
    route: ResolvedPreTradeRoute;
    order: ResolvedPreTradeOrder;
    coverage: RiskSnapshotSourceCoverage | null;
    freshness: FreshnessSummary;
    globalThresholds: ThresholdProfile;
    routePolicyContext: RiskSnapshotPolicyContext | null;
    routeThresholds: ThresholdProfile;
    accountSnapshot: RiskAccountSnapshot | null;
    brokerSnapshot: RiskBrokerSnapshot | null;
    assetSnapshot: RiskAssetSnapshot | null;
    brokerAssetSnapshot: RiskBrokerAssetSnapshot | null;
    grossExposureDelta: number;
    netExposureDelta: number;
    openOrderExposureDelta: number;
    reservedOrderMarginDelta: number;
    notional: number;
  }): RuleEvaluationDraft[] {
    const drafts: RuleEvaluationDraft[] = [];
    let sortOrder = 0;
    const pushRule = (draft: Omit<RuleEvaluationDraft, 'sortOrder'>) => {
      drafts.push({ ...draft, sortOrder });
      sortOrder += 1;
    };

    if (input.freshness.freshnessState === 'unavailable' || input.freshness.freshnessState === 'partial') {
      pushRule({
        scopeType: input.route.accountId ? 'account' : 'portfolio',
        scopeKey: input.route.accountId || 'portfolio',
        scopeLabel: input.route.accountName || 'Portfolio',
        brokerKey: input.route.brokerKey,
        accountId: input.route.accountId,
        symbol: null,
        ruleCode: 'source_coverage_gap',
        metricName: 'coverage',
        actualValue: null,
        basisValue: null,
        warnThresholdValue: null,
        criticalThresholdValue: null,
        status: 'critical',
        blocking: true,
        message: input.freshness.message,
      });
    } else if (input.freshness.freshnessState === 'lagging') {
      pushRule({
        scopeType: 'portfolio',
        scopeKey: 'portfolio',
        scopeLabel: 'Portfolio',
        ruleCode: 'risk_snapshot_freshness',
        metricName: 'snapshotLagMinutes',
        actualValue: input.freshness.snapshotLagMinutes,
        basisValue: null,
        warnThresholdValue: 60,
        criticalThresholdValue: null,
        status: 'warning',
        blocking: false,
        message: input.freshness.message,
      });
    }

    const afterPortfolioMarginUsage = this.toRatioPct(
      (this.toFiniteNumber(input.snapshot?.grossExposure, 0) ?? 0) + input.grossExposureDelta,
      input.snapshot?.portfolioEquity
    );
    if (afterPortfolioMarginUsage !== null) {
      const status = this.resolveThresholdStatus(
        afterPortfolioMarginUsage,
        input.globalThresholds.marginUsageWarnPct,
        input.globalThresholds.marginUsageCriticalPct
      );
      pushRule({
        scopeType: 'portfolio',
        scopeKey: 'portfolio',
        scopeLabel: 'Portfolio',
        policyContextId: input.routePolicyContext?.id ?? null,
        ruleCode: 'portfolio_margin_usage',
        metricName: 'marginUsagePct',
        actualValue: afterPortfolioMarginUsage,
        basisValue: this.toFiniteNumber(input.snapshot?.portfolioEquity, null),
        warnThresholdValue: input.globalThresholds.marginUsageWarnPct,
        criticalThresholdValue: input.globalThresholds.marginUsageCriticalPct,
        status,
        blocking:
          status === 'critical' && Boolean(input.routePolicyContext?.enforceHardBlock),
        message:
          status === 'critical'
            ? 'Projected portfolio margin usage exceeds the configured critical threshold.'
            : status === 'warning'
              ? 'Projected portfolio margin usage enters the warning band.'
              : 'Projected portfolio margin usage remains within tolerance.',
      });
    }

    if (input.route.brokerKey) {
      const afterBrokerAllocation = this.toRatioPct(
        (this.toFiniteNumber(input.brokerSnapshot?.grossExposure, 0) ?? 0) +
          input.grossExposureDelta,
        input.snapshot?.portfolioEquity
      );
      const brokerCriticalLimit = Math.min(100, input.routeThresholds.maxTotalAllocation);
      if (afterBrokerAllocation !== null) {
        const status = this.resolveThresholdStatus(
          afterBrokerAllocation,
          input.routeThresholds.concentrationWarnPct,
          brokerCriticalLimit
        );
        pushRule({
          scopeType: 'broker',
          scopeKey: input.route.brokerKey,
          scopeLabel: input.route.brokerKey,
          brokerKey: input.route.brokerKey,
          policyContextId: input.routePolicyContext?.id ?? null,
          ruleCode: 'broker_total_allocation',
          metricName: 'allocationPct',
          actualValue: afterBrokerAllocation,
          basisValue: this.toFiniteNumber(input.snapshot?.portfolioEquity, null),
          warnThresholdValue: input.routeThresholds.concentrationWarnPct,
          criticalThresholdValue: brokerCriticalLimit,
          status,
          blocking:
            status === 'critical' && Boolean(input.routePolicyContext?.enforceHardBlock),
          message:
            status === 'critical'
              ? `Projected ${input.route.brokerKey} allocation exceeds the configured critical threshold.`
              : status === 'warning'
                ? `Projected ${input.route.brokerKey} allocation enters the warning band.`
                : `${input.route.brokerKey} allocation remains within tolerance after this request.`,
        });
      }
    }

    if (input.route.accountId) {
      const trackedBalance = this.toFiniteNumber(input.accountSnapshot?.trackedBalance, null);
      const afterAccountMarginUsage = this.toRatioPct(
        (this.toFiniteNumber(input.accountSnapshot?.grossExposure, 0) ?? 0) +
          input.grossExposureDelta,
        trackedBalance
      );
      if (afterAccountMarginUsage !== null) {
        const status = this.resolveThresholdStatus(
          afterAccountMarginUsage,
          input.routeThresholds.marginUsageWarnPct,
          input.routeThresholds.marginUsageCriticalPct
        );
        pushRule({
          scopeType: 'account',
          scopeKey: input.route.accountId,
          scopeLabel: input.route.accountName || input.route.accountId,
          brokerKey: input.route.brokerKey,
          accountId: input.route.accountId,
          policyContextId: input.routePolicyContext?.id ?? null,
          ruleCode: 'account_margin_usage',
          metricName: 'marginUsagePct',
          actualValue: afterAccountMarginUsage,
          basisValue: trackedBalance,
          warnThresholdValue: input.routeThresholds.marginUsageWarnPct,
          criticalThresholdValue: input.routeThresholds.marginUsageCriticalPct,
          status,
          blocking:
            status === 'critical' && Boolean(input.routePolicyContext?.enforceHardBlock),
          message:
            status === 'critical'
              ? 'Projected account margin usage exceeds the configured critical threshold.'
              : status === 'warning'
                ? 'Projected account margin usage enters the warning band.'
                : 'Projected account margin usage remains within tolerance.',
        });
      }

      if (trackedBalance && trackedBalance > 0 && input.routeThresholds.maxOrderAllocation !== null) {
        const orderAllocationPct = this.toRatioPct(input.notional, trackedBalance);
        if (orderAllocationPct !== null) {
          const warnThresholdValue = this.roundNumber(
            input.routeThresholds.maxOrderAllocation * 0.8,
            2
          );
          const status = this.resolveThresholdStatus(
            orderAllocationPct,
            warnThresholdValue,
            input.routeThresholds.maxOrderAllocation
          );
          pushRule({
            scopeType: 'account',
            scopeKey: input.route.accountId,
            scopeLabel: input.route.accountName || input.route.accountId,
            brokerKey: input.route.brokerKey,
            accountId: input.route.accountId,
            policyContextId: input.routePolicyContext?.id ?? null,
            ruleCode: 'order_allocation',
            metricName: 'orderAllocationPct',
            actualValue: orderAllocationPct,
            basisValue: trackedBalance,
            warnThresholdValue,
            criticalThresholdValue: input.routeThresholds.maxOrderAllocation,
            status,
            blocking:
              status === 'critical' && Boolean(input.routePolicyContext?.enforceHardBlock),
            message:
              status === 'critical'
                ? 'Requested order allocation exceeds the configured maximum for this account.'
                : status === 'warning'
                  ? 'Requested order allocation is approaching the configured maximum for this account.'
                  : 'Requested order allocation remains within tolerance.',
          });
        }
      }
    }

    const afterAssetAllocation = this.toRatioPct(
      (this.toFiniteNumber(input.assetSnapshot?.grossExposure, 0) ?? 0) + input.grossExposureDelta,
      input.snapshot?.portfolioEquity
    );
    if (afterAssetAllocation !== null) {
      const status = this.resolveThresholdStatus(
        afterAssetAllocation,
        input.routeThresholds.concentrationWarnPct,
        input.routeThresholds.concentrationCriticalPct
      );
      pushRule({
        scopeType: 'asset',
        scopeKey: input.order.symbol,
        scopeLabel: input.order.symbol,
        brokerKey: input.route.brokerKey,
        accountId: input.route.accountId,
        symbol: input.order.symbol,
        policyContextId: input.routePolicyContext?.id ?? null,
        ruleCode: 'asset_concentration',
        metricName: 'allocationPct',
        actualValue: afterAssetAllocation,
        basisValue: this.toFiniteNumber(input.snapshot?.portfolioEquity, null),
        warnThresholdValue: input.routeThresholds.concentrationWarnPct,
        criticalThresholdValue: input.routeThresholds.concentrationCriticalPct,
        status,
        blocking: status === 'critical' && Boolean(input.routePolicyContext?.enforceHardBlock),
        message:
          status === 'critical'
            ? `Projected ${input.order.symbol} concentration exceeds the configured critical threshold.`
            : status === 'warning'
              ? `Projected ${input.order.symbol} concentration enters the warning band.`
              : `${input.order.symbol} concentration remains within tolerance after this request.`,
      });
    }

    if (input.route.brokerKey) {
      const afterBrokerAssetAllocation = this.toRatioPct(
        (this.toFiniteNumber(input.brokerAssetSnapshot?.grossExposure, 0) ?? 0) +
          input.grossExposureDelta,
        input.snapshot?.portfolioEquity
      );
      if (afterBrokerAssetAllocation !== null) {
        const status = this.resolveThresholdStatus(
          afterBrokerAssetAllocation,
          input.routeThresholds.concentrationWarnPct,
          input.routeThresholds.concentrationCriticalPct
        );
        pushRule({
          scopeType: 'broker_asset',
          scopeKey: `${input.route.brokerKey}|${input.order.symbol}`,
          scopeLabel: `${input.route.brokerKey} / ${input.order.symbol}`,
          brokerKey: input.route.brokerKey,
          accountId: input.route.accountId,
          symbol: input.order.symbol,
          policyContextId: input.routePolicyContext?.id ?? null,
          ruleCode: 'broker_asset_concentration',
          metricName: 'allocationPct',
          actualValue: afterBrokerAssetAllocation,
          basisValue: this.toFiniteNumber(input.snapshot?.portfolioEquity, null),
          warnThresholdValue: input.routeThresholds.concentrationWarnPct,
          criticalThresholdValue: input.routeThresholds.concentrationCriticalPct,
          status,
          blocking: status === 'critical' && Boolean(input.routePolicyContext?.enforceHardBlock),
          message:
            status === 'critical'
              ? `Projected ${input.order.symbol} concentration on ${input.route.brokerKey} exceeds the configured critical threshold.`
              : status === 'warning'
                ? `Projected ${input.order.symbol} concentration on ${input.route.brokerKey} enters the warning band.`
                : `${input.order.symbol} concentration on ${input.route.brokerKey} remains within tolerance.`,
        });
      }
    }

    if (input.order.leverage !== null) {
      const status =
        input.order.leverage >= input.routeThresholds.maxLeverage ? 'critical' : 'ok';
      pushRule({
        scopeType: input.route.brokerKey ? 'broker_asset' : 'asset',
        scopeKey: input.route.brokerKey
          ? `${input.route.brokerKey}|${input.order.symbol}`
          : input.order.symbol,
        scopeLabel: input.route.brokerKey
          ? `${input.route.brokerKey} / ${input.order.symbol}`
          : input.order.symbol,
        brokerKey: input.route.brokerKey,
        accountId: input.route.accountId,
        symbol: input.order.symbol,
        policyContextId: input.routePolicyContext?.id ?? null,
        ruleCode: 'order_leverage',
        metricName: 'leverage',
        actualValue: input.order.leverage,
        basisValue: null,
        warnThresholdValue: null,
        criticalThresholdValue: input.routeThresholds.maxLeverage,
        status,
        blocking: status === 'critical' && Boolean(input.routePolicyContext?.enforceHardBlock),
        message:
          status === 'critical'
            ? 'Requested leverage exceeds the configured maximum.'
            : 'Requested leverage remains within the configured maximum.',
      });
    }

    return drafts;
  }

  private applyProjectedScopeStates(
    scopes: ScopeImpactDraft[],
    rules: RuleEvaluationDraft[]
  ): void {
    const rulesByScope = new Map<string, RuleEvaluationDraft[]>();
    rules.forEach((rule) => {
      const key = `${rule.scopeType}:${rule.scopeKey}`;
      const existing = rulesByScope.get(key) || [];
      existing.push(rule);
      rulesByScope.set(key, existing);
    });

    scopes.forEach((scope) => {
      const scopeRules = rulesByScope.get(`${scope.scopeType}:${scope.scopeKey}`) || [];
      const worstStatus = scopeRules.some((item) => item.status === 'critical')
        ? 'critical'
        : scopeRules.some((item) => item.status === 'warning')
          ? 'watch'
          : scope.afterRiskState || scope.beforeRiskState || 'ok';
      scope.afterRiskState = worstStatus;

      const baselineScore = this.toFiniteNumber(scope.beforeRiskScore, 0) || 0;
      if (worstStatus === 'critical') {
        scope.afterRiskScore = Math.max(baselineScore, 100);
        return;
      }
      if (worstStatus === 'watch') {
        scope.afterRiskScore = Math.max(baselineScore, 55);
        return;
      }
      scope.afterRiskScore = baselineScore || null;
    });
  }

  private resolveCheckStatus(
    blocked: boolean,
    freshnessState: RiskPreTradeFreshnessState,
    warningRuleCount: number
  ): 'passed' | 'blocked' | 'warning' | 'stale' {
    if (blocked) {
      return 'blocked';
    }
    if (freshnessState === 'lagging') {
      return 'stale';
    }
    if (warningRuleCount > 0) {
      return 'warning';
    }
    return 'passed';
  }

  private buildCheckSummary(input: {
    blocked: boolean;
    approvalRequired: boolean;
    warningRuleCount: number;
    blockingRules: RuleEvaluationDraft[];
    freshness: FreshnessSummary;
  }): string {
    if (input.blocked) {
      return input.blockingRules[0]?.message || input.freshness.message;
    }
    if (input.freshness.freshnessState === 'lagging') {
      return input.warningRuleCount > 0
        ? `${input.freshness.message} ${input.warningRuleCount} additional warning(s) were recorded.`
        : input.freshness.message;
    }
    if (input.approvalRequired) {
      return input.warningRuleCount > 0
        ? `Pre-trade check completed with ${input.warningRuleCount} warning(s); manual review is required before execution.`
        : 'Pre-trade check passed and is ready for manual review.';
    }
    if (input.warningRuleCount > 0) {
      return `Pre-trade check passed with ${input.warningRuleCount} warning(s).`;
    }
    return 'Pre-trade check passed.';
  }

  private mapPreTradeCheckResult(
    check: RiskRequestCheck,
    scopeRows: RiskRequestScopeImpact[],
    ruleRows: RiskRequestRuleEvaluation[],
    snapshot: RiskSnapshot | null,
    policyContexts: RiskSnapshotPolicyContext[],
    timeZone: string
  ): RiskPreTradeCheckResult {
    const scopeItems = scopeRows.map((item) => this.mapScopeImpactItem(item, timeZone));
    const ruleItems = ruleRows.map((item) => this.mapRuleEvaluationItem(item, timeZone));
    const appliedPolicies = this.mapAppliedPolicies(policyContexts, ruleRows);

    return {
      checkId: check.id,
      status: this.normalizeCheckStatus(check.status),
      checkedAt: formatApiDisplayTime(check.checkedAt, timeZone) || check.checkedAt.toISOString(),
      checkedAtIso: formatApiRawIso(check.checkedAt) || undefined,
      expiresAt: formatApiDisplayTime(check.expiresAt, timeZone) || null,
      expiresAtIso: formatApiRawIso(check.expiresAt) || undefined,
      request: {
        suggestedTradeId: check.suggestedTradeId,
        automationId: check.automationId,
        automationRunId: check.automationRunId,
        sourceType: check.sourceType,
        executionMode: check.executionMode as 'paper' | 'live',
        approvalMode: check.approvalMode as 'manual_review' | 'auto_if_safe',
        routing: {
          routeMode: check.routeMode as 'strategy_default' | 'user_default' | 'fixed',
          brokerKey: check.brokerKey,
          accountId: check.accountId,
        },
        order: {
          symbol: check.symbol,
          timeframe: check.timeframe,
          side: check.side as 'BUY' | 'SELL',
          orderType: check.orderType as 'market' | 'limit',
          timeInForce: (check.timeInForce as 'GTC' | 'IOC' | 'FOK' | null) ?? null,
          quantityMode: check.quantityMode as 'quantity' | 'notional' | 'risk_percent',
          quantity: check.quantity,
          notional: check.notional,
          riskPercent: check.riskPercent,
          entryPrice: check.entryPrice,
          stopLossPrice: check.stopLossPrice,
          takeProfitTargets: check.takeProfitTargetsJson,
          leverage: check.leverage,
          reduceOnly: check.reduceOnly,
        },
      },
      snapshot: {
        snapshotId: check.snapshotId,
        freshnessState: this.normalizeFreshnessState(check.freshnessState),
        snapshotLagMinutes: check.snapshotLagMinutes,
        latestRiskSnapshotAt: formatApiDisplayTime(snapshot?.createdAt, timeZone) || null,
        latestRiskSnapshotAtIso: formatApiRawIso(snapshot?.createdAt) || undefined,
      },
      decision: {
        allowed: check.allowed,
        blocked: check.blocked,
        approvalRequired: check.approvalRequired,
        blockingRuleCount: check.blockingRuleCount,
        warningRuleCount: check.warningRuleCount,
        summary: check.summary,
      },
      before: {
        portfolio:
          scopeItems.find((item) => item.scopeType === 'portfolio' && item.scopeKey === 'portfolio') ||
          null,
        brokers: scopeItems.filter((item) => item.scopeType === 'broker'),
        assets: scopeItems.filter((item) => item.scopeType === 'asset'),
        brokerAssets: scopeItems.filter((item) => item.scopeType === 'broker_asset'),
      },
      delta: {
        grossExposureDelta: check.grossExposureDelta,
        netExposureDelta: check.netExposureDelta,
        openOrderExposureDelta: check.openOrderExposureDelta,
        reservedOrderMarginDelta: check.reservedOrderMarginDelta,
      },
      after: {
        portfolio:
          scopeItems.find((item) => item.scopeType === 'portfolio' && item.scopeKey === 'portfolio') ||
          null,
        brokers: scopeItems.filter((item) => item.scopeType === 'broker'),
        assets: scopeItems.filter((item) => item.scopeType === 'asset'),
        brokerAssets: scopeItems.filter((item) => item.scopeType === 'broker_asset'),
      },
      scopeImpacts: scopeItems,
      blockingRules: ruleItems.filter((item) => item.blocking),
      warningRules: ruleItems.filter((item) => !item.blocking && item.status !== 'ok'),
      evaluatedRules: ruleItems,
      appliedPolicies,
      time: buildApiTimeContract(timeZone),
    };
  }

  private mapScopeImpactItem(
    item: RiskRequestScopeImpact,
    timeZone: string
  ): RiskPreTradeScopeImpactItem {
    return {
      id: item.id,
      checkId: item.checkId,
      snapshotId: item.snapshotId,
      scopeType: item.scopeType,
      scopeKey: item.scopeKey,
      scopeLabel: item.scopeLabel,
      brokerKey: item.brokerKey,
      accountId: item.accountId,
      symbol: item.symbol,
      beforeGrossExposure: item.beforeGrossExposure,
      beforeNetExposure: item.beforeNetExposure,
      beforeOpenOrderExposure: item.beforeOpenOrderExposure,
      beforeReservedOrderMargin: item.beforeReservedOrderMargin,
      beforeMarginUsagePct: item.beforeMarginUsagePct,
      beforeAllocationPct: item.beforeAllocationPct,
      beforeRiskScore: item.beforeRiskScore,
      beforeRiskState: item.beforeRiskState,
      deltaGrossExposure: item.deltaGrossExposure,
      deltaNetExposure: item.deltaNetExposure,
      deltaOpenOrderExposure: item.deltaOpenOrderExposure,
      deltaReservedOrderMargin: item.deltaReservedOrderMargin,
      afterGrossExposure: item.afterGrossExposure,
      afterNetExposure: item.afterNetExposure,
      afterOpenOrderExposure: item.afterOpenOrderExposure,
      afterReservedOrderMargin: item.afterReservedOrderMargin,
      afterMarginUsagePct: item.afterMarginUsagePct,
      afterAllocationPct: item.afterAllocationPct,
      afterRiskScore: item.afterRiskScore,
      afterRiskState: item.afterRiskState,
      sortOrder: item.sortOrder,
      createdAt: formatApiDisplayTime(item.createdAt, timeZone) || item.createdAt.toISOString(),
      createdAtIso: formatApiRawIso(item.createdAt) || undefined,
    };
  }

  private mapRuleEvaluationItem(
    item: RiskRequestRuleEvaluation,
    timeZone: string
  ): RiskPreTradeRuleResult {
    return {
      id: item.id,
      checkId: item.checkId,
      snapshotId: item.snapshotId,
      policyContextId: item.policyContextId,
      scopeType: item.scopeType,
      scopeKey: item.scopeKey,
      scopeLabel: item.scopeLabel,
      brokerKey: item.brokerKey,
      accountId: item.accountId,
      symbol: item.symbol,
      ruleCode: item.ruleCode,
      metricName: item.metricName,
      actualValue: item.actualValue,
      basisValue: item.basisValue,
      warnThresholdValue: item.warnThresholdValue,
      criticalThresholdValue: item.criticalThresholdValue,
      status: this.normalizeRuleStatus(item.status),
      blocking: item.blocking,
      message: item.message,
      sortOrder: item.sortOrder,
      createdAt: formatApiDisplayTime(item.createdAt, timeZone) || item.createdAt.toISOString(),
      createdAtIso: formatApiRawIso(item.createdAt) || undefined,
    };
  }

  private mapAppliedPolicies(
    policyContexts: RiskSnapshotPolicyContext[],
    ruleRows: RiskRequestRuleEvaluation[]
  ): RiskPreTradeAppliedPolicyItem[] {
    const referencedIds = new Set(
      ruleRows
        .map((item) => String(item.policyContextId || '').trim())
        .filter(Boolean)
    );

    return policyContexts
      .filter((item) => referencedIds.has(item.id))
      .map((item) => ({
        policyContextId: item.id,
        policyId: item.policyId,
        scope: item.policyScope,
        scopeKey: item.policyTargetKey,
        monitorOnly: item.monitorOnly,
        enforceHardBlock: item.enforceHardBlock,
      }))
      .sort((left, right) => {
        const scopeDiff = String(left.scope || '').localeCompare(String(right.scope || ''));
        if (scopeDiff !== 0) {
          return scopeDiff;
        }
        return String(left.scopeKey || '').localeCompare(String(right.scopeKey || ''));
      });
  }

  private normalizeRiskState(value: unknown): 'ok' | 'watch' | 'critical' | null {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) {
      return null;
    }
    if (normalized === 'critical' || normalized === 'breach') {
      return 'critical';
    }
    if (normalized === 'watch' || normalized === 'warning') {
      return 'watch';
    }
    if (normalized === 'healthy' || normalized === 'ok') {
      return 'ok';
    }
    return 'ok';
  }

  private normalizeCheckStatus(value: unknown): 'passed' | 'blocked' | 'warning' | 'stale' | 'error' {
    const normalized = String(value || '').trim().toLowerCase();
    if (
      normalized === 'passed' ||
      normalized === 'blocked' ||
      normalized === 'warning' ||
      normalized === 'stale' ||
      normalized === 'error'
    ) {
      return normalized;
    }
    return 'error';
  }

  private normalizeFreshnessState(value: unknown): RiskPreTradeFreshnessState {
    const normalized = String(value || '').trim().toLowerCase();
    if (
      normalized === 'fresh' ||
      normalized === 'lagging' ||
      normalized === 'partial' ||
      normalized === 'unavailable'
    ) {
      return normalized;
    }
    return 'unavailable';
  }

  private normalizeRuleStatus(value: unknown): 'ok' | 'warning' | 'critical' {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'critical') {
      return 'critical';
    }
    if (normalized === 'warning' || normalized === 'watch') {
      return 'warning';
    }
    return 'ok';
  }

  private resolveThresholdStatus(
    value: number,
    warnThresholdValue: number | null | undefined,
    criticalThresholdValue: number | null | undefined
  ): 'ok' | 'warning' | 'critical' {
    const warn = this.toFiniteNumber(warnThresholdValue, null);
    const critical = this.toFiniteNumber(criticalThresholdValue, null);
    if (critical !== null && value >= critical) {
      return 'critical';
    }
    if (warn !== null && value >= warn) {
      return 'warning';
    }
    return 'ok';
  }

  private parseRiskScore(value: unknown): number | null {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null;
    }
    if (typeof value === 'string') {
      const match = value.match(/-?\d+(?:\.\d+)?/);
      if (!match) {
        return null;
      }
      const numeric = Number(match[0]);
      return Number.isFinite(numeric) ? numeric : null;
    }
    return null;
  }

  private toRatioPct(
    numerator: unknown,
    denominator: unknown
  ): number | null {
    const normalizedNumerator = this.toFiniteNumber(numerator, null);
    const normalizedDenominator = this.toFiniteNumber(denominator, null);
    if (
      normalizedNumerator === null ||
      normalizedDenominator === null ||
      normalizedDenominator <= 0
    ) {
      return null;
    }
    return this.roundNumber((normalizedNumerator / normalizedDenominator) * 100, 2);
  }

  private toFiniteNumber(value: unknown, fallback: number | null): number | null {
    if (value === undefined || value === null || value === '') {
      return fallback;
    }
    const numeric = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
  }

  private roundNumber(value: number, digits = 0): number {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
  }
}
