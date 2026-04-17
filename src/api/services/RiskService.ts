import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import {
  ReviewRiskPolicyVersionBody,
  RiskKillSwitchBody,
  RiskKillSwitchResult,
  RiskPoliciesResponse,
  RiskPolicyApprovalMode,
  RiskPolicyApprovalState,
  RiskAlertsResponse,
  RiskAlertsSummary,
  RiskAlertItem,
  RiskAccountsResponse,
  RiskAccountItem,
  RiskOrdersResponse,
  RiskOrderItem,
  RiskPositionsResponse,
  RiskPositionItem,
  RiskSnapshotDetailResponse,
  RiskControlsResponse,
  RiskControlItem,
  RiskScenariosResponse,
  RiskScenarioItem,
  RiskBatchRecomputeResult,
  RiskPolicyVersionItem,
  RiskPolicyVersionsResponse,
  RiskPolicyVersionOperation,
  RiskPolicyWriteResult,
  RiskPolicyReviewResult,
  RiskRecomputeResult,
  RiskPolicyRollbackResult,
  RiskPolicy as RiskPolicyContract,
  RollbackRiskPolicyBody,
  UpsertRiskPolicyBody,
  RiskSummary,
} from '../contracts/Risk';
import { PositionRecord } from '../contracts/Positions';
import { successResponse } from '../utils/response';
import {
  validateRiskAlertsQuery,
  validateRiskControlsQuery,
  validateRiskScenariosQuery,
  validateRiskKillSwitchBody,
  validateRollbackRiskPolicyBody,
  validateUpsertRiskPolicyBody,
} from '../validators/risk.validator';
import { BadRequestAppError, ConflictAppError, NotFoundAppError } from '../errors/AppError';
import { RiskRepository } from '../../database';
import { RiskAlertRepository } from '../../database';
import { RiskControlRepository } from '../../database';
import { RiskScenarioRepository } from '../../database';
import { RiskPolicyRepository } from '../../database';
import { BrokerAccountRepository } from '../../database';
import { FundsSnapshotRepository, FundsSnapshotRow } from '../../database/repositories/FundsSnapshotRepository';
import {
  PositionAccountFreshnessRow,
  PositionReadModelRepository,
} from '../../database/repositories/PositionReadModelRepository';
import { ComputedRiskSnapshotPayload } from '../../database/repositories/RiskRepository';
import {
  ComputedRiskAccountSnapshotPayload,
  RiskAccountSnapshotRepository,
} from '../../database/repositories/RiskAccountSnapshotRepository';
import {
  OpenOrderSnapshotSourceRow,
  OrdersSnapshotSourceRepository,
} from '../../database/repositories/OrdersSnapshotSourceRepository';
import {
  ComputedRiskPositionSnapshotPayload,
  RiskPositionSnapshotRepository,
} from '../../database/repositories/RiskPositionSnapshotRepository';
import {
  ComputedRiskOrderSnapshotPayload,
  RiskOrderSnapshotRepository,
} from '../../database/repositories/RiskOrderSnapshotRepository';
import { ComputedRiskAlertPayload } from '../../database/repositories/RiskAlertRepository';
import { ComputedRiskControlPayload } from '../../database/repositories/RiskControlRepository';
import { ComputedRiskScenarioPayload } from '../../database/repositories/RiskScenarioRepository';
import { OperationalEventService } from './OperationalEventService';
import { BrokerRouteResolution } from '../../brokers/core/BrokerAccountRoutingService';
import { getUtcDateRangeFromLocalDates } from '../utils/timezone';
import { UserTimeZoneService } from './UserTimeZoneService';
import { PortfolioService } from './PortfolioService';
import {
  buildApiTimeContract,
  formatApiDisplayTime,
  formatApiRawIso,
} from '../utils/apiTimeContract';

interface PreTradeOrderInput {
  assetId: string;
  quantity: number;
  orderPrice?: number;
  leverage?: number;
}

interface PreTradeOrderResult {
  allowed: boolean;
  blocked: boolean;
  policyId?: string;
  breaches: string[];
  reason?: string;
}

interface StoredRiskPolicyVersionPayload {
  snapshot?: Record<string, unknown>;
  lifecycle?: {
    operation?: string;
    reason?: string;
    approvalMode?: string;
    approvalState?: string;
    approvedAt?: string;
    approvedByUserId?: string;
    reviewReason?: string;
    reviewedAt?: string;
    reviewedByUserId?: string;
    rollbackFromVersionId?: string;
  };
}

interface ParsedRiskPolicyVersionRecord {
  id: string;
  actorUserId: string;
  operation: RiskPolicyVersionOperation;
  reason?: string;
  approvalMode: RiskPolicyApprovalMode;
  approvalState: RiskPolicyApprovalState;
  approvedAt?: string;
  approvedByUserId?: string;
  reviewReason?: string;
  reviewedAt?: string;
  reviewedByUserId?: string;
  rollbackFromVersionId?: string;
  snapshot: RiskPolicyContract;
  createdAt: string;
}

interface RiskPolicyGovernanceSummary {
  currentVersionId?: string;
  pendingVersionId?: string;
  pendingVersionCount: number;
  approvalMode: RiskPolicyApprovalMode;
  currentApprovalState: RiskPolicyApprovalState;
}

interface RiskThresholdProfile {
  marginUsageWarnPct: number;
  marginUsageCriticalPct: number;
  concentrationWarnPct: number;
  concentrationCriticalPct: number;
  dailyLossLimitPct: number;
  weeklyLossLimitPct: number;
  monthlyLossLimitPct: number;
  maxLeverage: number;
  maxTotalAllocation: number;
  maxAvgLeverage: number;
}

interface RiskThresholdProfileInput {
  marginUsageWarnPct?: number | null;
  marginUsageCriticalPct?: number | null;
  concentrationWarnPct?: number | null;
  concentrationCriticalPct?: number | null;
  dailyLossLimitPct?: number | null;
  weeklyLossLimitPct?: number | null;
  monthlyLossLimitPct?: number | null;
  maxLeverage?: number | null;
  maxTotalAllocation?: number | null;
  maxAvgLeverage?: number | null;
}

interface LossWindowUsage {
  dailyUsagePct: number;
  weeklyUsagePct: number;
  monthlyUsagePct: number;
}

interface AccountRiskSnapshotInput {
  accountId: string;
  brokerKey: string;
  accountName: string;
  fundsSnapshot: FundsSnapshotRow | null;
  walletBalance: number | null;
  futuresBalance: number | null;
  balance: number | null;
  positions: PositionRecord[];
  positionsFreshness: PositionAccountFreshnessRow | null;
  thresholds: RiskThresholdProfile;
}

interface PositionRiskEvaluation {
  positionId: string;
  symbol: string;
  brokerKey: string;
  accountId: string;
  accountName: string;
  exposure: number;
  leverage: number | null;
  unrealizedPnl: number | null;
  liquidationDistancePct: number | null;
  concentrationPct: number | null;
  statuses: Array<'ok' | 'watch' | 'critical'>;
  notes: string[];
}

interface ComputedRiskOrderAccountSummary {
  openOrders: number;
  openOrderExposure: number;
  reservedOrderMargin: number;
}

interface RiskComputationResult {
  snapshot: ComputedRiskSnapshotPayload;
  accountSnapshots: ComputedRiskAccountSnapshotPayload[];
  orderSnapshots: ComputedRiskOrderSnapshotPayload[];
  positionSnapshots: ComputedRiskPositionSnapshotPayload[];
  alerts: ComputedRiskAlertPayload[];
  controls: ComputedRiskControlPayload[];
  scenarios: ComputedRiskScenarioPayload[];
  equity: number;
  accountCount: number;
  livePositionCount: number;
  topHoldings: Array<{
    id: string;
    symbol: string;
    allocationPct: number;
    marketValue: number;
    dayPnL: number;
    strategy: string;
    riskState: string;
  }>;
}

interface FundsBalanceBreakdown {
  walletBalance: number | null;
  futuresBalance: number | null;
  trackedBalance: number | null;
}

@Service()
export class RiskService {
  @Inject(() => RiskRepository)
  private riskRepository!: RiskRepository;

  @Inject(() => RiskAlertRepository)
  private riskAlertRepository!: RiskAlertRepository;

  @Inject(() => RiskAccountSnapshotRepository)
  private riskAccountSnapshotRepository!: RiskAccountSnapshotRepository;

  @Inject(() => RiskPositionSnapshotRepository)
  private riskPositionSnapshotRepository!: RiskPositionSnapshotRepository;

  @Inject(() => RiskOrderSnapshotRepository)
  private riskOrderSnapshotRepository!: RiskOrderSnapshotRepository;

  @Inject(() => RiskControlRepository)
  private riskControlRepository!: RiskControlRepository;

  @Inject(() => RiskScenarioRepository)
  private riskScenarioRepository!: RiskScenarioRepository;

  @Inject(() => RiskPolicyRepository)
  private riskPolicyRepository!: RiskPolicyRepository;

  @Inject(() => BrokerAccountRepository)
  private brokerAccountRepository!: BrokerAccountRepository;

  @Inject(() => FundsSnapshotRepository)
  private fundsSnapshotRepository!: FundsSnapshotRepository;

  @Inject(() => PositionReadModelRepository)
  private positionReadModelRepository!: PositionReadModelRepository;

  @Inject(() => OrdersSnapshotSourceRepository)
  private ordersSnapshotSourceRepository!: OrdersSnapshotSourceRepository;

  @Inject(() => OperationalEventService)
  private operationalEventService!: OperationalEventService;

  @Inject(() => UserTimeZoneService)
  private userTimeZoneService!: UserTimeZoneService;

  @Inject(() => PortfolioService)
  private portfolioService!: PortfolioService;

  async getRiskSummary(userId: string): Promise<ApiSuccessResponse<RiskSummary>> {
    const snapshot = await this.riskRepository.getLatestSnapshot(userId);

    if (!snapshot) {
      return successResponse({
        portfolioRisk: '--',
        breachedRules: 0,
        liquidationWatch: 0,
        capitalAtRisk: 0,
      });
    }

    return successResponse({
      snapshotId: snapshot.id,
      portfolioRisk: snapshot.portfolioRisk ?? '--',
      breachedRules: snapshot.breachedRules,
      liquidationWatch: snapshot.liquidationWatch,
      capitalAtRisk: snapshot.capitalAtRisk,
      denominatorBasis: snapshot.denominatorBasis ?? undefined,
      portfolioEquity: snapshot.portfolioEquity,
      grossExposure: snapshot.grossExposure,
      netExposure: snapshot.netExposure,
      longExposure: snapshot.longExposure,
      shortExposure: snapshot.shortExposure,
      openOrders: snapshot.openOrders,
      openOrderExposure: snapshot.openOrderExposure,
      reservedOrderMargin: snapshot.reservedOrderMargin,
      marginUsage: snapshot.marginUsage ?? '--',
      drawdownBudgetUsed: snapshot.drawdownBudgetUsed ?? '--',
      weeklyDrawdownBudgetUsed: snapshot.weeklyDrawdownBudgetUsed ?? '--',
      monthlyDrawdownBudgetUsed: snapshot.monthlyDrawdownBudgetUsed ?? '--',
      atRiskPositions: snapshot.atRiskPositions,
      ruleViolations: snapshot.ruleViolations,
      portfolioRiskScore: snapshot.portfolioRiskScore ?? '--',
      primaryConcern: snapshot.primaryConcern ?? '--',
      riskByPosition: snapshot.riskByPosition ?? '--',
      riskByStrategy: snapshot.riskByStrategy ?? '--',
      riskByGuardrail: snapshot.riskByGuardrail ?? '--',
      guardrailOne: snapshot.guardrailOne ?? '--',
      guardrailTwo: snapshot.guardrailTwo ?? '--',
      guardrailThree: snapshot.guardrailThree ?? '--',
      actionOne: snapshot.actionOne ?? '--',
      actionTwo: snapshot.actionTwo ?? '--',
      actionThree: snapshot.actionThree ?? '--',
      fundsObservedAtIso: this.formatRawIso(snapshot.fundsObservedAt) || undefined,
      positionsObservedAtIso: this.formatRawIso(snapshot.positionsObservedAt) || undefined,
      ordersObservedAtIso: this.formatRawIso(snapshot.ordersObservedAt) || undefined,
    });
  }

  async getRiskAccounts(userId: string): Promise<ApiSuccessResponse<RiskAccountsResponse>> {
    const [snapshot, timeZone] = await Promise.all([
      this.riskRepository.getLatestSnapshot(userId),
      this.userTimeZoneService.resolveUserTimeZone(userId),
    ]);

    if (!snapshot) {
      return successResponse({
        items: [],
        total: 0,
        time: buildApiTimeContract(timeZone),
      });
    }

    const accountSnapshots = await this.riskAccountSnapshotRepository.listBySnapshotId(snapshot.id);

    const items: RiskAccountItem[] = accountSnapshots.map((item) => ({
      id: item.id,
      snapshotId: item.snapshotId,
      brokerKey: item.brokerKey,
      accountId: item.accountId,
      accountName: item.accountName,
      denominatorBasis: item.denominatorBasis ?? undefined,
      walletBalance: item.walletBalance,
      futuresBalance: item.futuresBalance,
      trackedBalance: item.trackedBalance,
      grossExposure: item.grossExposure,
      netExposure: item.netExposure,
      longExposure: item.longExposure,
      shortExposure: item.shortExposure,
      openOrders: item.openOrders,
      openOrderExposure: item.openOrderExposure,
      reservedOrderMargin: item.reservedOrderMargin,
      marginUsagePct: item.marginUsagePct,
      portfolioConcentrationPct: item.portfolioConcentrationPct,
      dailyLossUsagePct: item.dailyLossUsagePct,
      unrealizedPnl: item.unrealizedPnl,
      openPositions: item.openPositions,
      maxPositionLeverage: item.maxPositionLeverage,
      closestLiquidationDistancePct: item.closestLiquidationDistancePct,
      marginUsageWarnPct: item.marginUsageWarnPct,
      marginUsageCriticalPct: item.marginUsageCriticalPct,
      concentrationWarnPct: item.concentrationWarnPct,
      concentrationCriticalPct: item.concentrationCriticalPct,
      dailyLossLimitPct: item.dailyLossLimitPct,
      weeklyLossLimitPct: item.weeklyLossLimitPct,
      monthlyLossLimitPct: item.monthlyLossLimitPct,
      maxLeverage: item.maxLeverage,
      maxTotalAllocation: item.maxTotalAllocation,
      maxAvgLeverage: item.maxAvgLeverage,
      fundsObservedAt: this.formatDisplayTime(item.fundsObservedAt, timeZone) || null,
      fundsObservedAtIso: this.formatRawIso(item.fundsObservedAt) || null,
      positionsObservedAt: this.formatDisplayTime(item.positionsObservedAt, timeZone) || null,
      positionsObservedAtIso: this.formatRawIso(item.positionsObservedAt) || null,
      ordersObservedAt: this.formatDisplayTime(item.ordersObservedAt, timeZone) || null,
      ordersObservedAtIso: this.formatRawIso(item.ordersObservedAt) || null,
      createdAt: this.formatDisplayTime(item.createdAt, timeZone) || item.createdAt.toISOString(),
      createdAtIso: this.formatRawIso(item.createdAt) || undefined,
    }));

    return successResponse({
      items,
      total: items.length,
      snapshotId: snapshot.id,
      denominatorBasis: snapshot.denominatorBasis ?? undefined,
      portfolioEquity: snapshot.portfolioEquity,
      grossExposure: snapshot.grossExposure,
      netExposure: snapshot.netExposure,
      longExposure: snapshot.longExposure,
      shortExposure: snapshot.shortExposure,
      openOrders: snapshot.openOrders,
      openOrderExposure: snapshot.openOrderExposure,
      reservedOrderMargin: snapshot.reservedOrderMargin,
      fundsObservedAt: this.formatDisplayTime(snapshot.fundsObservedAt, timeZone) || null,
      fundsObservedAtIso: this.formatRawIso(snapshot.fundsObservedAt) || null,
      positionsObservedAt: this.formatDisplayTime(snapshot.positionsObservedAt, timeZone) || null,
      positionsObservedAtIso: this.formatRawIso(snapshot.positionsObservedAt) || null,
      ordersObservedAt: this.formatDisplayTime(snapshot.ordersObservedAt, timeZone) || null,
      ordersObservedAtIso: this.formatRawIso(snapshot.ordersObservedAt) || null,
      time: buildApiTimeContract(timeZone),
    });
  }

  async getRiskPositions(userId: string): Promise<ApiSuccessResponse<RiskPositionsResponse>> {
    const [snapshot, timeZone] = await Promise.all([
      this.riskRepository.getLatestSnapshot(userId),
      this.userTimeZoneService.resolveUserTimeZone(userId),
    ]);

    if (!snapshot) {
      return successResponse({
        items: [],
        total: 0,
        time: buildApiTimeContract(timeZone),
      });
    }

    const positionSnapshots = await this.riskPositionSnapshotRepository.listBySnapshotId(snapshot.id);
    const items: RiskPositionItem[] = positionSnapshots.map((item) => ({
      id: item.id,
      snapshotId: item.snapshotId,
      brokerKey: item.brokerKey,
      accountId: item.accountId,
      accountName: item.accountName,
      positionId: item.positionId,
      symbol: item.symbol,
      side: item.side,
      sideKey: item.sideKey,
      status: item.status,
      statusKey: item.statusKey,
      quantity: item.quantity,
      entryPrice: item.entryPrice,
      currentPrice: item.currentPrice,
      exposure: item.exposure,
      unrealizedPnl: item.unrealizedPnl,
      realizedPnl: item.realizedPnl,
      leverage: item.leverage,
      liquidationPrice: item.liquidationPrice,
      liquidationDistancePct: item.liquidationDistancePct,
      concentrationPct: item.concentrationPct,
      riskState: item.riskState,
      notes: Array.isArray(item.riskNotesJson) ? item.riskNotesJson : [],
      positionOpenedAt: this.formatDisplayTime(item.positionOpenedAt, timeZone) || null,
      positionOpenedAtIso: this.formatRawIso(item.positionOpenedAt) || null,
      sourceUpdatedAt: this.formatDisplayTime(item.sourceUpdatedAt, timeZone) || null,
      sourceUpdatedAtIso: this.formatRawIso(item.sourceUpdatedAt) || null,
      createdAt: this.formatDisplayTime(item.createdAt, timeZone) || item.createdAt.toISOString(),
      createdAtIso: this.formatRawIso(item.createdAt) || undefined,
    }));

    return successResponse({
      items,
      total: items.length,
      snapshotId: snapshot.id,
      time: buildApiTimeContract(timeZone),
    });
  }

  async getRiskOrders(userId: string): Promise<ApiSuccessResponse<RiskOrdersResponse>> {
    const [snapshot, timeZone] = await Promise.all([
      this.riskRepository.getLatestSnapshot(userId),
      this.userTimeZoneService.resolveUserTimeZone(userId),
    ]);

    if (!snapshot) {
      return successResponse({
        items: [],
        total: 0,
        time: buildApiTimeContract(timeZone),
      });
    }

    const orderSnapshots = await this.riskOrderSnapshotRepository.listBySnapshotId(snapshot.id);
    const items: RiskOrderItem[] = orderSnapshots.map((item) => ({
      id: item.id,
      snapshotId: item.snapshotId,
      brokerKey: item.brokerKey,
      accountId: item.accountId,
      accountName: item.accountName,
      externalId: item.externalId,
      orderId: item.orderId,
      symbol: item.symbol,
      side: item.side,
      status: item.status,
      orderType: item.orderType,
      triggerType: item.triggerType,
      quantity: item.quantity,
      filledQuantity: item.filledQuantity,
      remainingQuantity: item.remainingQuantity,
      price: item.price,
      orderPrice: item.orderPrice,
      triggerPrice: item.triggerPrice,
      filledPrice: item.filledPrice,
      lastPrice: item.lastPrice,
      stoplossPrice: item.stoplossPrice,
      takeprofitPrice: item.takeprofitPrice,
      leverage: item.leverage,
      reduceOnly: item.reduceOnly,
      snapshotStatusRank: item.snapshotStatusRank,
      notional: item.notional,
      reservedMargin: item.reservedMargin,
      orderCreatedAt: this.formatDisplayTime(item.orderCreatedAt, timeZone) || null,
      orderCreatedAtIso: this.formatRawIso(item.orderCreatedAt) || null,
      orderUpdatedAt: this.formatDisplayTime(item.orderUpdatedAt, timeZone) || null,
      orderUpdatedAtIso: this.formatRawIso(item.orderUpdatedAt) || null,
      orderCanceledAt: this.formatDisplayTime(item.orderCanceledAt, timeZone) || null,
      orderCanceledAtIso: this.formatRawIso(item.orderCanceledAt) || null,
      firstSeenAt: this.formatDisplayTime(item.firstSeenAt, timeZone) || null,
      firstSeenAtIso: this.formatRawIso(item.firstSeenAt) || null,
      lastSeenAt: this.formatDisplayTime(item.lastSeenAt, timeZone) || null,
      lastSeenAtIso: this.formatRawIso(item.lastSeenAt) || null,
      createdAt: this.formatDisplayTime(item.createdAt, timeZone) || item.createdAt.toISOString(),
      createdAtIso: this.formatRawIso(item.createdAt) || undefined,
    }));

    return successResponse({
      items,
      total: items.length,
      snapshotId: snapshot.id,
      time: buildApiTimeContract(timeZone),
    });
  }

  async getRiskSnapshotDetail(
    userId: string,
    snapshotId: string
  ): Promise<ApiSuccessResponse<RiskSnapshotDetailResponse>> {
    const [snapshot, timeZone] = await Promise.all([
      this.riskRepository.getSnapshotById(userId, snapshotId),
      this.userTimeZoneService.resolveUserTimeZone(userId),
    ]);

    if (!snapshot) {
      throw new NotFoundAppError('Risk snapshot not found');
    }

    const [
      previousSnapshot,
      accountSnapshots,
      positionSnapshots,
      orderSnapshots,
      controlRows,
      alertRows,
      scenarioRows,
    ] = await Promise.all([
      this.riskRepository.getPreviousSnapshot(userId, snapshot),
      this.riskAccountSnapshotRepository.listBySnapshotId(snapshot.id),
      this.riskPositionSnapshotRepository.listBySnapshotId(snapshot.id),
      this.riskOrderSnapshotRepository.listBySnapshotId(snapshot.id),
      this.riskControlRepository.listBySnapshotId(userId, snapshot.id),
      this.riskAlertRepository.listBySnapshotId(userId, snapshot.id),
      this.riskScenarioRepository.listBySnapshotId(userId, snapshot.id),
    ]);

    const summary: RiskSummary = {
      portfolioRisk: snapshot.portfolioRisk ?? '--',
      breachedRules: snapshot.breachedRules,
      liquidationWatch: snapshot.liquidationWatch,
      capitalAtRisk: snapshot.capitalAtRisk,
      denominatorBasis: snapshot.denominatorBasis ?? undefined,
      portfolioEquity: snapshot.portfolioEquity,
      grossExposure: snapshot.grossExposure,
      netExposure: snapshot.netExposure,
      longExposure: snapshot.longExposure,
      shortExposure: snapshot.shortExposure,
      openOrders: snapshot.openOrders,
      openOrderExposure: snapshot.openOrderExposure,
      reservedOrderMargin: snapshot.reservedOrderMargin,
      marginUsage: snapshot.marginUsage ?? '--',
      drawdownBudgetUsed: snapshot.drawdownBudgetUsed ?? '--',
      weeklyDrawdownBudgetUsed: snapshot.weeklyDrawdownBudgetUsed ?? '--',
      monthlyDrawdownBudgetUsed: snapshot.monthlyDrawdownBudgetUsed ?? '--',
      atRiskPositions: snapshot.atRiskPositions,
      ruleViolations: snapshot.ruleViolations,
      portfolioRiskScore: snapshot.portfolioRiskScore ?? '--',
      primaryConcern: snapshot.primaryConcern ?? '--',
      riskByPosition: snapshot.riskByPosition ?? '--',
      riskByStrategy: snapshot.riskByStrategy ?? '--',
      riskByGuardrail: snapshot.riskByGuardrail ?? '--',
      guardrailOne: snapshot.guardrailOne ?? '--',
      guardrailTwo: snapshot.guardrailTwo ?? '--',
      guardrailThree: snapshot.guardrailThree ?? '--',
      actionOne: snapshot.actionOne ?? '--',
      actionTwo: snapshot.actionTwo ?? '--',
      actionThree: snapshot.actionThree ?? '--',
      fundsObservedAtIso: this.formatRawIso(snapshot.fundsObservedAt) || undefined,
      positionsObservedAtIso: this.formatRawIso(snapshot.positionsObservedAt) || undefined,
      ordersObservedAtIso: this.formatRawIso(snapshot.ordersObservedAt) || undefined,
    };

    const accounts: RiskAccountItem[] = accountSnapshots.map((item) => ({
      id: item.id,
      snapshotId: item.snapshotId,
      brokerKey: item.brokerKey,
      accountId: item.accountId,
      accountName: item.accountName,
      denominatorBasis: item.denominatorBasis ?? undefined,
      walletBalance: item.walletBalance,
      futuresBalance: item.futuresBalance,
      trackedBalance: item.trackedBalance,
      grossExposure: item.grossExposure,
      netExposure: item.netExposure,
      longExposure: item.longExposure,
      shortExposure: item.shortExposure,
      openOrders: item.openOrders,
      openOrderExposure: item.openOrderExposure,
      reservedOrderMargin: item.reservedOrderMargin,
      marginUsagePct: item.marginUsagePct,
      portfolioConcentrationPct: item.portfolioConcentrationPct,
      dailyLossUsagePct: item.dailyLossUsagePct,
      unrealizedPnl: item.unrealizedPnl,
      openPositions: item.openPositions,
      maxPositionLeverage: item.maxPositionLeverage,
      closestLiquidationDistancePct: item.closestLiquidationDistancePct,
      marginUsageWarnPct: item.marginUsageWarnPct,
      marginUsageCriticalPct: item.marginUsageCriticalPct,
      concentrationWarnPct: item.concentrationWarnPct,
      concentrationCriticalPct: item.concentrationCriticalPct,
      dailyLossLimitPct: item.dailyLossLimitPct,
      weeklyLossLimitPct: item.weeklyLossLimitPct,
      monthlyLossLimitPct: item.monthlyLossLimitPct,
      maxLeverage: item.maxLeverage,
      maxTotalAllocation: item.maxTotalAllocation,
      maxAvgLeverage: item.maxAvgLeverage,
      fundsObservedAt: this.formatDisplayTime(item.fundsObservedAt, timeZone) || null,
      fundsObservedAtIso: this.formatRawIso(item.fundsObservedAt) || null,
      positionsObservedAt: this.formatDisplayTime(item.positionsObservedAt, timeZone) || null,
      positionsObservedAtIso: this.formatRawIso(item.positionsObservedAt) || null,
      ordersObservedAt: this.formatDisplayTime(item.ordersObservedAt, timeZone) || null,
      ordersObservedAtIso: this.formatRawIso(item.ordersObservedAt) || null,
      createdAt: this.formatDisplayTime(item.createdAt, timeZone) || item.createdAt.toISOString(),
      createdAtIso: this.formatRawIso(item.createdAt) || undefined,
    }));

    const positions: RiskPositionItem[] = positionSnapshots.map((item) => ({
      id: item.id,
      snapshotId: item.snapshotId,
      brokerKey: item.brokerKey,
      accountId: item.accountId,
      accountName: item.accountName,
      positionId: item.positionId,
      symbol: item.symbol,
      side: item.side,
      sideKey: item.sideKey,
      status: item.status,
      statusKey: item.statusKey,
      quantity: item.quantity,
      entryPrice: item.entryPrice,
      currentPrice: item.currentPrice,
      exposure: item.exposure,
      unrealizedPnl: item.unrealizedPnl,
      realizedPnl: item.realizedPnl,
      leverage: item.leverage,
      liquidationPrice: item.liquidationPrice,
      liquidationDistancePct: item.liquidationDistancePct,
      concentrationPct: item.concentrationPct,
      riskState: item.riskState,
      notes: Array.isArray(item.riskNotesJson) ? item.riskNotesJson : [],
      positionOpenedAt: this.formatDisplayTime(item.positionOpenedAt, timeZone) || null,
      positionOpenedAtIso: this.formatRawIso(item.positionOpenedAt) || null,
      sourceUpdatedAt: this.formatDisplayTime(item.sourceUpdatedAt, timeZone) || null,
      sourceUpdatedAtIso: this.formatRawIso(item.sourceUpdatedAt) || null,
      createdAt: this.formatDisplayTime(item.createdAt, timeZone) || item.createdAt.toISOString(),
      createdAtIso: this.formatRawIso(item.createdAt) || undefined,
    }));

    const orders: RiskOrderItem[] = orderSnapshots.map((item) => ({
      id: item.id,
      snapshotId: item.snapshotId,
      brokerKey: item.brokerKey,
      accountId: item.accountId,
      accountName: item.accountName,
      externalId: item.externalId,
      orderId: item.orderId,
      symbol: item.symbol,
      side: item.side,
      status: item.status,
      orderType: item.orderType,
      triggerType: item.triggerType,
      quantity: item.quantity,
      filledQuantity: item.filledQuantity,
      remainingQuantity: item.remainingQuantity,
      price: item.price,
      orderPrice: item.orderPrice,
      triggerPrice: item.triggerPrice,
      filledPrice: item.filledPrice,
      lastPrice: item.lastPrice,
      stoplossPrice: item.stoplossPrice,
      takeprofitPrice: item.takeprofitPrice,
      leverage: item.leverage,
      reduceOnly: item.reduceOnly,
      snapshotStatusRank: item.snapshotStatusRank,
      notional: item.notional,
      reservedMargin: item.reservedMargin,
      orderCreatedAt: this.formatDisplayTime(item.orderCreatedAt, timeZone) || null,
      orderCreatedAtIso: this.formatRawIso(item.orderCreatedAt) || null,
      orderUpdatedAt: this.formatDisplayTime(item.orderUpdatedAt, timeZone) || null,
      orderUpdatedAtIso: this.formatRawIso(item.orderUpdatedAt) || null,
      orderCanceledAt: this.formatDisplayTime(item.orderCanceledAt, timeZone) || null,
      orderCanceledAtIso: this.formatRawIso(item.orderCanceledAt) || null,
      firstSeenAt: this.formatDisplayTime(item.firstSeenAt, timeZone) || null,
      firstSeenAtIso: this.formatRawIso(item.firstSeenAt) || null,
      lastSeenAt: this.formatDisplayTime(item.lastSeenAt, timeZone) || null,
      lastSeenAtIso: this.formatRawIso(item.lastSeenAt) || null,
      createdAt: this.formatDisplayTime(item.createdAt, timeZone) || item.createdAt.toISOString(),
      createdAtIso: this.formatRawIso(item.createdAt) || undefined,
    }));

    const controls: RiskControlItem[] = controlRows.map((item) => ({
      id: item.id,
      snapshotId: item.snapshotId,
      bucket: item.bucket,
      exposure: item.exposure,
      threshold: item.threshold,
      status: item.status,
      action: item.action,
      createdAt: this.formatDisplayTime(item.createdAt, timeZone) || String(item.createdAt),
      createdAtIso: this.formatRawIso(item.createdAt) || undefined,
    }));

    const alerts: RiskAlertItem[] = alertRows.map((item) => ({
      id: item.id,
      snapshotId: item.snapshotId,
      severity: item.severity,
      message: item.message,
      symbol: item.symbol,
      channel: item.channel ?? undefined,
      status: item.status ?? undefined,
      createdAt: this.formatDisplayTime(item.createdAt, timeZone) || String(item.createdAt),
      createdAtIso: this.formatRawIso(item.createdAt) || undefined,
    }));

    const scenarios: RiskScenarioItem[] = scenarioRows.map((item) => ({
      id: item.id,
      snapshotId: item.snapshotId,
      scenario: item.scenario,
      impact: item.impact,
      commentary: item.commentary,
      createdAt: this.formatDisplayTime(item.createdAt, timeZone) || String(item.createdAt),
      createdAtIso: this.formatRawIso(item.createdAt) || undefined,
    }));

    return successResponse({
      snapshotId: snapshot.id,
      createdAt: this.formatDisplayTime(snapshot.createdAt, timeZone) || snapshot.createdAt.toISOString(),
      createdAtIso: this.formatRawIso(snapshot.createdAt) || undefined,
      previousSnapshotId: previousSnapshot?.id || undefined,
      previousSnapshotCreatedAt:
        this.formatDisplayTime(previousSnapshot?.createdAt || null, timeZone) || null,
      previousSnapshotCreatedAtIso:
        this.formatRawIso(previousSnapshot?.createdAt || null) || null,
      summary,
      accounts,
      positions,
      orders,
      controls,
      alerts,
      scenarios,
      counts: {
        accounts: accounts.length,
        positions: positions.length,
        orders: orders.length,
        controls: controls.length,
        alerts: alerts.length,
        scenarios: scenarios.length,
      },
      time: buildApiTimeContract(timeZone),
    });
  }

  async getRiskAlerts(
    userId: string,
    query: { limit?: string; offset?: string; status?: string; scope?: string }
  ): Promise<ApiSuccessResponse<RiskAlertsResponse>> {
    const params = validateRiskAlertsQuery(query);
    const { items, total } = await this.riskAlertRepository.listRiskAlerts(userId, params);
    const timeZone = await this.userTimeZoneService.resolveUserTimeZone(userId);

    const mapped: RiskAlertItem[] = items.map((item) => ({
      id: item.id,
      snapshotId: item.snapshotId,
      severity: item.severity,
      message: item.message,
      symbol: item.symbol,
      channel: item.channel ?? undefined,
      status: item.status ?? undefined,
      createdAt: this.formatDisplayTime(item.createdAt, timeZone) || String(item.createdAt),
      createdAtIso: this.formatRawIso(item.createdAt) || undefined,
    }));

    return successResponse({
      items: mapped,
      total,
      limit: params.limit,
      offset: params.offset,
      time: buildApiTimeContract(timeZone),
    });
  }

  async getRiskAlertsSummary(
    userId: string,
    query: { status?: string; scope?: string } = {}
  ): Promise<ApiSuccessResponse<RiskAlertsSummary>> {
    const params = validateRiskAlertsQuery({
      limit: '1',
      offset: '0',
      status: query.status,
      scope: query.scope,
    });
    const summary = await this.riskAlertRepository.getRiskAlertsSummary(userId, params);

    return successResponse(summary);
  }

  async getRiskControls(
    userId: string,
    query: { limit?: string; offset?: string; status?: string; scope?: string }
  ): Promise<ApiSuccessResponse<RiskControlsResponse>> {
    const params = validateRiskControlsQuery(query);
    const { items, total } = await this.riskControlRepository.listRiskControls(userId, params);
    const timeZone = await this.userTimeZoneService.resolveUserTimeZone(userId);

    const mapped: RiskControlItem[] = items.map((item) => ({
      id: item.id,
      snapshotId: item.snapshotId,
      bucket: item.bucket,
      exposure: item.exposure,
      threshold: item.threshold,
      status: item.status,
      action: item.action,
      createdAt: this.formatDisplayTime(item.createdAt, timeZone) || String(item.createdAt),
      createdAtIso: this.formatRawIso(item.createdAt) || undefined,
    }));

    return successResponse({
      items: mapped,
      total,
      limit: params.limit,
      offset: params.offset,
      time: buildApiTimeContract(timeZone),
    });
  }

  async getRiskScenarios(
    userId: string,
    query: { limit?: string; offset?: string; status?: string; scope?: string }
  ): Promise<ApiSuccessResponse<RiskScenariosResponse>> {
    const params = validateRiskScenariosQuery(query);
    const { items, total } = await this.riskScenarioRepository.listRiskScenarios(userId, params);
    const timeZone = await this.userTimeZoneService.resolveUserTimeZone(userId);

    const mapped: RiskScenarioItem[] = items.map((item) => ({
      id: item.id,
      snapshotId: item.snapshotId,
      scenario: item.scenario,
      impact: item.impact,
      commentary: item.commentary,
      createdAt: this.formatDisplayTime(item.createdAt, timeZone) || String(item.createdAt),
      createdAtIso: this.formatRawIso(item.createdAt) || undefined,
    }));

    return successResponse({
      items: mapped,
      total,
      limit: params.limit,
      offset: params.offset,
      time: buildApiTimeContract(timeZone),
    });
  }

  async getRiskPolicies(userId: string): Promise<ApiSuccessResponse<RiskPoliciesResponse>> {
    const items = await this.riskPolicyRepository.listPolicies(userId);
    const timeZone = await this.userTimeZoneService.resolveUserTimeZone(userId);
    const mapped = await Promise.all(
      items.map(async (item) => {
        const versions = await this.riskPolicyRepository.listPolicyVersions(userId, item.id);
        const governance = this.summarizeRiskPolicyVersions(
          this.parsePolicyVersionRecords(versions)
        );
        return this.mapPolicy(item, governance, timeZone);
      })
    );

    return successResponse({
      items: mapped,
      total: mapped.length,
      time: buildApiTimeContract(timeZone),
    });
  }

  async getRiskPolicyVersions(
    userId: string,
    policyId: string
  ): Promise<ApiSuccessResponse<RiskPolicyVersionsResponse>> {
    const existing = await this.riskPolicyRepository.getPolicyById(userId, policyId);
    if (!existing) {
      throw new NotFoundAppError('Risk policy not found');
    }

    const versions = await this.riskPolicyRepository.listPolicyVersions(userId, policyId);
    const parsedVersions = this.parsePolicyVersionRecords(versions);
    const governance = this.summarizeRiskPolicyVersions(parsedVersions);
    const timeZone = await this.userTimeZoneService.resolveUserTimeZone(userId);
    const items = this.mapPolicyVersions(
      policyId,
      parsedVersions,
      governance.currentVersionId,
      timeZone
    );

    return successResponse({
      policyId,
      total: items.length,
      currentVersionId: governance.currentVersionId,
      pendingVersionId: governance.pendingVersionId,
      pendingVersionCount: governance.pendingVersionCount,
      approvalMode: governance.approvalMode,
      currentApprovalState: governance.currentApprovalState,
      items,
      time: buildApiTimeContract(timeZone),
    });
  }

  async createRiskPolicy(
    userId: string,
    actorUserId: string,
    body: UpsertRiskPolicyBody
  ): Promise<ApiSuccessResponse<RiskPolicyWriteResult>> {
    const validated = this.validateRiskPolicy(body);
    const timeZone = await this.userTimeZoneService.resolveUserTimeZone(userId);
    try {
      await this.assertNoDuplicateRiskPolicyTarget(userId, validated);
      const created = await this.riskPolicyRepository.createPolicy(userId, validated);
      const mappedPolicy = this.mapPolicy(created, {}, timeZone);
      const createdVersion = await this.riskPolicyRepository.createPolicyVersion(
        created.id,
        userId,
        actorUserId,
        this.buildRiskPolicyVersionPayload(mappedPolicy, actorUserId, 'create')
      );
      await this.operationalEventService.logActivity(userId, {
        type: 'Risk policy',
        title: 'Risk policy created',
        status: 'Success',
        route: 'Risk',
        stream: 'Policies',
        referenceId: created.id,
        related: this.buildPolicyTargetLabel(mappedPolicy),
        description: `Risk policy created (${created.scope})`,
      });
      return successResponse({
        message: 'Risk policy created.',
        policyId: created.id,
        policy: mappedPolicy,
        versionId: createdVersion.id,
        approvalMode: 'auto_approved',
        approvalState: 'approved',
        applied: true,
        activityPath: this.buildPolicyActivityPath(created.id),
        enforcementActivityPath: this.buildPolicyEnforcementActivityPath(created.id),
      });
    } catch (error) {
      const mappedError = this.mapRiskPolicyPersistenceError(error, validated);
      await this.operationalEventService.logActivity(userId, {
        type: 'Risk policy',
        title: 'Risk policy creation failed',
        status: 'Failed',
        route: 'Risk',
        stream: 'Policies',
        description: mappedError.message,
      });
      await this.operationalEventService.emitFailureAlert(userId, {
        channel: 'Risk',
        source: 'risk-policy',
        message: `Risk policy create failed: ${mappedError.message}`,
        route: 'Risk',
      });
      throw mappedError;
    }
  }

  async updateRiskPolicy(
    userId: string,
    actorUserId: string,
    policyId: string,
    body: UpsertRiskPolicyBody
  ): Promise<ApiSuccessResponse<RiskPolicyWriteResult>> {
    const validated = this.validateRiskPolicy(body);
    const timeZone = await this.userTimeZoneService.resolveUserTimeZone(userId);
    try {
      const existing = await this.riskPolicyRepository.getPolicyById(userId, policyId);
      if (!existing) {
        throw new NotFoundAppError('Risk policy not found');
      }

      await this.assertNoPendingRiskPolicyReview(userId, policyId);
      await this.assertNoDuplicateRiskPolicyTarget(userId, validated, policyId);
      const currentPolicy = this.mapPolicy(existing, {}, timeZone);
      const shouldRequireManualReview = this.requiresManualRiskPolicyReview(currentPolicy, validated);

      if (shouldRequireManualReview) {
        const pendingSnapshot = this.buildRequestedPolicySnapshot(policyId, validated);
        const createdVersion = await this.riskPolicyRepository.createPolicyVersion(
          policyId,
          userId,
          actorUserId,
          this.buildRiskPolicyVersionPayload(pendingSnapshot, actorUserId, 'update', {
            approvalMode: 'manual_review',
            approvalState: 'pending_review',
          })
        );

        await this.operationalEventService.logActivity(userId, {
          type: 'Risk policy',
          title: 'Risk policy change submitted for review',
          status: 'In progress',
          route: 'Risk',
          stream: 'Policies',
          referenceId: policyId,
          related: this.buildPolicyTargetLabel(pendingSnapshot),
          correlationId: createdVersion.id,
          description: `Risk policy update requires approval before it becomes effective (${pendingSnapshot.scope})`,
        });

        return successResponse({
          message: 'Risk policy change submitted for approval.',
          policyId,
          policy: this.mapPolicy({
            ...pendingSnapshot,
            approvalMode: 'manual_review',
            approvalState: 'pending_review',
            pendingVersionId: createdVersion.id,
            pendingVersionCount: 1,
          }, {}, timeZone),
          versionId: createdVersion.id,
          approvalMode: 'manual_review',
          approvalState: 'pending_review',
          applied: false,
          activityPath: this.buildPolicyActivityPath(policyId),
          enforcementActivityPath: this.buildPolicyEnforcementActivityPath(policyId),
        });
      }

      const updated = await this.riskPolicyRepository.updatePolicy(userId, policyId, validated);
      if (!updated) {
        throw new NotFoundAppError('Risk policy not found');
      }
      const mappedPolicy = this.mapPolicy(updated, {}, timeZone);
      const createdVersion = await this.riskPolicyRepository.createPolicyVersion(
        policyId,
        userId,
        actorUserId,
        this.buildRiskPolicyVersionPayload(mappedPolicy, actorUserId, 'update')
      );
      await this.operationalEventService.logActivity(userId, {
        type: 'Risk policy',
        title: 'Risk policy updated',
        status: 'Success',
        route: 'Risk',
        stream: 'Policies',
        referenceId: policyId,
        related: this.buildPolicyTargetLabel(mappedPolicy),
        correlationId: createdVersion.id,
        description: `Risk policy updated (${updated.scope})`,
      });
      return successResponse({
        message: 'Risk policy saved.',
        policyId,
        policy: mappedPolicy,
        versionId: createdVersion.id,
        approvalMode: 'auto_approved',
        approvalState: 'approved',
        applied: true,
        activityPath: this.buildPolicyActivityPath(policyId),
        enforcementActivityPath: this.buildPolicyEnforcementActivityPath(policyId),
      });
    } catch (error) {
      const mappedError = this.mapRiskPolicyPersistenceError(error, validated);
      await this.operationalEventService.logActivity(userId, {
        type: 'Risk policy',
        title: 'Risk policy update failed',
        status: 'Failed',
        route: 'Risk',
        stream: 'Policies',
        referenceId: policyId,
        description: mappedError.message,
      });
      await this.operationalEventService.emitFailureAlert(userId, {
        channel: 'Risk',
        source: 'risk-policy',
        message: `Risk policy update failed (${policyId}): ${mappedError.message}`,
        route: 'Risk',
      });
      throw mappedError;
    }
  }

  async rollbackRiskPolicy(
    userId: string,
    actorUserId: string,
    policyId: string,
    body: RollbackRiskPolicyBody
  ): Promise<ApiSuccessResponse<RiskPolicyRollbackResult>> {
    const validated = validateRollbackRiskPolicyBody(body);
    const timeZone = await this.userTimeZoneService.resolveUserTimeZone(userId);
    const existing = await this.riskPolicyRepository.getPolicyById(userId, policyId);
    if (!existing) {
      throw new NotFoundAppError('Risk policy not found');
    }

    const versions = await this.riskPolicyRepository.listPolicyVersions(userId, policyId);
    await this.assertNoPendingRiskPolicyReview(userId, policyId, versions);
    const parsedVersions = this.parsePolicyVersionRecords(versions);
    const governance = this.summarizeRiskPolicyVersions(parsedVersions);
    const currentVersionId = governance.currentVersionId;
    if (currentVersionId && currentVersionId === validated.versionId) {
      throw new BadRequestAppError('Selected version is already the current policy state');
    }

    const targetVersion = versions.find((item) => item.id === validated.versionId);
    if (!targetVersion) {
      throw new NotFoundAppError('Risk policy version not found');
    }

    const parsedVersion =
      parsedVersions.find((item) => item.id === targetVersion.id) ||
      this.parsePolicyVersionRecord(
        targetVersion,
        versions.length > 1 && versions[versions.length - 1]?.id === targetVersion.id ? 'create' : 'update'
      );
    const rollbackPayload = this.validateRiskPolicy(parsedVersion.snapshot);
    const currentPolicy = this.mapPolicy(existing, {}, timeZone);

    try {
      await this.assertNoDuplicateRiskPolicyTarget(userId, rollbackPayload, policyId);
      if (this.requiresManualRiskPolicyReview(currentPolicy, rollbackPayload)) {
        const pendingSnapshot = this.buildRequestedPolicySnapshot(policyId, rollbackPayload);
        const createdVersion = await this.riskPolicyRepository.createPolicyVersion(
          policyId,
          userId,
          actorUserId,
          this.buildRiskPolicyVersionPayload(pendingSnapshot, actorUserId, 'rollback', {
            reason: validated.reason,
            rollbackFromVersionId: targetVersion.id,
            approvalMode: 'manual_review',
            approvalState: 'pending_review',
          })
        );

        await this.operationalEventService.logActivity(userId, {
          type: 'Risk policy',
          title: 'Risk policy rollback submitted for review',
          status: 'In progress',
          route: 'Risk',
          stream: 'Policies',
          referenceId: policyId,
          related: targetVersion.id,
          correlationId: createdVersion.id,
          description: `Risk policy rollback to ${targetVersion.id} requires approval before it becomes effective`,
        });

        return successResponse({
          message: 'Risk policy rollback submitted for approval.',
          policyId,
          policy: this.mapPolicy({
            ...pendingSnapshot,
            approvalMode: 'manual_review',
            approvalState: 'pending_review',
            pendingVersionId: createdVersion.id,
            pendingVersionCount: 1,
          }, {}, timeZone),
          versionId: createdVersion.id,
          restoredVersionId: targetVersion.id,
          createdVersionId: createdVersion.id,
          approvalMode: 'manual_review',
          approvalState: 'pending_review',
          applied: false,
          activityPath: this.buildPolicyActivityPath(policyId),
          enforcementActivityPath: this.buildPolicyEnforcementActivityPath(policyId),
        });
      }

      const updated = await this.riskPolicyRepository.updatePolicy(userId, policyId, rollbackPayload);
      if (!updated) {
        throw new NotFoundAppError('Risk policy not found');
      }

      const mappedPolicy = this.mapPolicy(updated, {}, timeZone);
      const createdVersion = await this.riskPolicyRepository.createPolicyVersion(
        policyId,
        userId,
        actorUserId,
        this.buildRiskPolicyVersionPayload(mappedPolicy, actorUserId, 'rollback', {
          reason: validated.reason,
          rollbackFromVersionId: targetVersion.id,
        })
      );

      await this.operationalEventService.logActivity(userId, {
        type: 'Risk policy',
        title: 'Risk policy rolled back',
        status: 'Success',
        route: 'Risk',
        stream: 'Policies',
        referenceId: policyId,
        related: targetVersion.id,
        correlationId: createdVersion.id,
        description: `Risk policy restored from version ${targetVersion.id}`,
      });

      return successResponse({
        message: 'Risk policy rolled back.',
        policyId,
        policy: mappedPolicy,
        versionId: createdVersion.id,
        restoredVersionId: targetVersion.id,
        createdVersionId: createdVersion.id,
        approvalMode: 'auto_approved',
        approvalState: 'approved',
        applied: true,
        activityPath: this.buildPolicyActivityPath(policyId),
        enforcementActivityPath: this.buildPolicyEnforcementActivityPath(policyId),
      });
    } catch (error) {
      const mappedError = this.mapRiskPolicyPersistenceError(error, rollbackPayload);
      await this.operationalEventService.logActivity(userId, {
        type: 'Risk policy',
        title: 'Risk policy rollback failed',
        status: 'Failed',
        route: 'Risk',
        stream: 'Policies',
        referenceId: policyId,
        related: validated.versionId,
        description: mappedError.message,
      });
      await this.operationalEventService.emitFailureAlert(userId, {
        channel: 'Risk',
        source: 'risk-policy',
        message: `Risk policy rollback failed (${policyId}): ${mappedError.message}`,
        route: 'Risk',
      });
      throw mappedError;
    }
  }

  async approveRiskPolicyVersion(
    userId: string,
    actorUserId: string,
    policyId: string,
    versionId: string,
    body: ReviewRiskPolicyVersionBody
  ): Promise<ApiSuccessResponse<RiskPolicyReviewResult>> {
    const timeZone = await this.userTimeZoneService.resolveUserTimeZone(userId);
    const existing = await this.riskPolicyRepository.getPolicyById(userId, policyId);
    if (!existing) {
      throw new NotFoundAppError('Risk policy not found');
    }

    const version = await this.riskPolicyRepository.getPolicyVersionById(userId, policyId, versionId);
    if (!version) {
      throw new NotFoundAppError('Risk policy version not found');
    }

    const parsedVersion = this.parsePolicyVersionRecord(version, 'update');
    if (parsedVersion.approvalState !== 'pending_review') {
      throw new BadRequestAppError('Only pending-review versions can be approved');
    }

    const validatedBody = {
      reason: String(body.reason || '').trim() || 'Approved from Risk Center governance workflow',
    };
    const approvalPayload = this.validateRiskPolicy(parsedVersion.snapshot);

    await this.assertNoDuplicateRiskPolicyTarget(userId, approvalPayload, policyId);
    const updated = await this.riskPolicyRepository.updatePolicy(userId, policyId, approvalPayload);
    if (!updated) {
      throw new NotFoundAppError('Risk policy not found');
    }

    const mappedPolicy = this.mapPolicy(updated, {
      currentVersionId: versionId,
      pendingVersionCount: 0,
      approvalMode: 'manual_review',
      currentApprovalState: 'approved',
    }, timeZone);

    const updatedVersion = await this.riskPolicyRepository.updatePolicyVersionPayload(
      userId,
      policyId,
      versionId,
      this.buildReviewedPolicyVersionPayload(parsedVersion, {
        snapshot: mappedPolicy,
        approvalState: 'approved',
        actorUserId,
        reviewReason: validatedBody.reason,
      })
    );

    if (!updatedVersion) {
      throw new NotFoundAppError('Risk policy version not found');
    }

    await this.operationalEventService.logActivity(userId, {
      type: 'Risk policy',
      title: 'Risk policy change approved',
      status: 'Success',
      route: 'Risk',
      stream: 'Policies',
      referenceId: policyId,
      related: versionId,
      correlationId: versionId,
      description: `Pending risk policy version ${versionId} is now effective`,
    });

    return successResponse({
      message: 'Risk policy change approved.',
      policyId,
      versionId,
      approvalMode: 'manual_review',
      approvalState: 'approved',
      applied: true,
      policy: mappedPolicy,
      activityPath: this.buildPolicyActivityPath(policyId),
      enforcementActivityPath: this.buildPolicyEnforcementActivityPath(policyId),
    });
  }

  async rejectRiskPolicyVersion(
    userId: string,
    actorUserId: string,
    policyId: string,
    versionId: string,
    body: ReviewRiskPolicyVersionBody
  ): Promise<ApiSuccessResponse<RiskPolicyReviewResult>> {
    const timeZone = await this.userTimeZoneService.resolveUserTimeZone(userId);
    const existing = await this.riskPolicyRepository.getPolicyById(userId, policyId);
    if (!existing) {
      throw new NotFoundAppError('Risk policy not found');
    }

    const version = await this.riskPolicyRepository.getPolicyVersionById(userId, policyId, versionId);
    if (!version) {
      throw new NotFoundAppError('Risk policy version not found');
    }

    const parsedVersion = this.parsePolicyVersionRecord(version, 'update');
    if (parsedVersion.approvalState !== 'pending_review') {
      throw new BadRequestAppError('Only pending-review versions can be rejected');
    }

    const validatedBody = {
      reason: String(body.reason || '').trim() || 'Rejected from Risk Center governance workflow',
    };

    const updatedVersion = await this.riskPolicyRepository.updatePolicyVersionPayload(
      userId,
      policyId,
      versionId,
      this.buildReviewedPolicyVersionPayload(parsedVersion, {
        approvalState: 'rejected',
        actorUserId,
        reviewReason: validatedBody.reason,
      })
    );

    if (!updatedVersion) {
      throw new NotFoundAppError('Risk policy version not found');
    }

    await this.operationalEventService.logActivity(userId, {
      type: 'Risk policy',
      title: 'Risk policy change rejected',
      status: 'Watch',
      route: 'Risk',
      stream: 'Policies',
      referenceId: policyId,
      related: versionId,
      correlationId: versionId,
      description: `Pending risk policy version ${versionId} was rejected`,
    });

    return successResponse({
      message: 'Risk policy change rejected.',
      policyId,
      versionId,
      approvalMode: 'manual_review',
      approvalState: 'rejected',
      applied: false,
      policy: this.mapPolicy(existing, {
        pendingVersionCount: 0,
        approvalMode: 'manual_review',
        currentApprovalState: 'approved',
      }, timeZone),
      activityPath: this.buildPolicyActivityPath(policyId),
      enforcementActivityPath: this.buildPolicyEnforcementActivityPath(policyId),
    });
  }

  async triggerKillSwitch(
    userId: string,
    body: RiskKillSwitchBody
  ): Promise<ApiSuccessResponse<RiskKillSwitchResult>> {
    const validated = validateRiskKillSwitchBody(body);
    const timeZone = await this.userTimeZoneService.resolveUserTimeZone(userId);

    await this.operationalEventService.logActivity(userId, {
      type: 'Risk control',
      title: 'Kill switch triggered',
      status: 'Success',
      route: 'Risk',
      stream: 'Controls',
      related: validated.scope,
      description: validated.reason,
    });

    const triggeredAtIso = new Date().toISOString();
    return successResponse({
      message: 'Kill switch triggered',
      triggeredAt: this.formatDisplayTime(triggeredAtIso, timeZone) || triggeredAtIso,
      triggeredAtIso,
      scope: validated.scope,
      time: buildApiTimeContract(timeZone),
    });
  }

  async recomputeRiskSnapshot(userId: string): Promise<ApiSuccessResponse<RiskRecomputeResult>> {
    const timeZone = await this.userTimeZoneService.resolveUserTimeZone(userId);
    const computed = await this.buildComputedRiskSnapshot(userId);
    const snapshot = await this.riskRepository.createComputedSnapshot(userId, computed.snapshot);
    const [
      accountSnapshotsCreated,
      orderSnapshotsCreated,
      positionSnapshotsCreated,
      controlsCreated,
      alertsCreated,
      scenariosCreated,
    ] = await Promise.all([
      this.riskAccountSnapshotRepository.createComputedAccountSnapshots(
        userId,
        snapshot.id,
        computed.accountSnapshots
      ),
      this.riskOrderSnapshotRepository.createComputedOrderSnapshots(
        userId,
        snapshot.id,
        computed.orderSnapshots
      ),
      this.riskPositionSnapshotRepository.createComputedPositionSnapshots(
        userId,
        snapshot.id,
        computed.positionSnapshots
      ),
      this.riskControlRepository.createComputedControls(userId, snapshot.id, computed.controls),
      this.riskAlertRepository.createComputedAlerts(userId, snapshot.id, computed.alerts),
      this.riskScenarioRepository.createComputedScenarios(userId, snapshot.id, computed.scenarios),
    ]);

    await this.operationalEventService.logActivity(userId, {
      type: 'Risk control',
      title: 'Risk snapshot recomputed',
      status: 'Success',
      route: 'Risk',
      stream: 'Controls',
      referenceId: snapshot.id,
      related: computed.snapshot.portfolioRisk,
      description: `Persisted risk snapshot with ${accountSnapshotsCreated} account rows, ${orderSnapshotsCreated} order rows, ${positionSnapshotsCreated} position rows, ${controlsCreated} controls, ${alertsCreated} alerts, and ${scenariosCreated} scenarios.`,
    });

    return successResponse({
      message: 'Risk snapshot recomputed',
      computedAt: this.formatDisplayTime(snapshot.createdAt, timeZone) || snapshot.createdAt.toISOString(),
      computedAtIso: this.formatRawIso(snapshot.createdAt) || undefined,
      equity: computed.equity,
      snapshotId: snapshot.id,
      portfolioRisk: computed.snapshot.portfolioRisk,
      orderSnapshotsCreated,
      controlsCreated,
      alertsCreated,
      scenariosCreated,
      accountCount: computed.accountCount,
      livePositionCount: computed.livePositionCount,
      holdings: computed.topHoldings,
      time: buildApiTimeContract(timeZone),
    });
  }

  async recomputeRiskSnapshotBatch(
    actorUserId: string,
    targetUserIds?: string[]
  ): Promise<ApiSuccessResponse<RiskBatchRecomputeResult>> {
    const timeZone = await this.userTimeZoneService.resolveUserTimeZone(actorUserId);
    const targets = Array.isArray(targetUserIds)
      ? Array.from(
          new Set(
            targetUserIds
              .map((item) => String(item || '').trim())
              .filter(Boolean)
          )
        )
      : [];
    let succeeded = 0;
    const failures: Array<{ userId: string; error: string }> = [];
    let snapshotsCreated = 0;
    let orderSnapshotsCreated = 0;
    let controlsCreated = 0;
    let alertsCreated = 0;
    let scenariosCreated = 0;

    for (const userId of targets) {
      try {
        const response = await this.recomputeRiskSnapshot(userId);
        succeeded += 1;
        if (response.data.snapshotId) {
          snapshotsCreated += 1;
        }
        orderSnapshotsCreated += Number(response.data.orderSnapshotsCreated || 0);
        controlsCreated += Number(response.data.controlsCreated || 0);
        alertsCreated += Number(response.data.alertsCreated || 0);
        scenariosCreated += Number(response.data.scenariosCreated || 0);
      } catch (error) {
        failures.push({
          userId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    await this.operationalEventService.logActivity(actorUserId, {
      type: 'Risk control',
      title: 'Risk batch recompute completed',
      status: failures.length ? 'Watch' : 'Success',
      route: 'Risk',
      stream: 'Controls',
      related: 'batch-recompute',
      description: failures.length
        ? `Failures: ${failures.length}`
        : 'All recomputes completed',
    });

    const completedAtIso = new Date().toISOString();
    return successResponse({
      message: 'Risk batch recompute completed',
      processed: targets.length,
      succeeded,
      failed: failures.length,
      snapshotsCreated,
      orderSnapshotsCreated,
      controlsCreated,
      alertsCreated,
      scenariosCreated,
      failures,
      completedAt: this.formatDisplayTime(completedAtIso, timeZone) || completedAtIso,
      completedAtIso,
      time: buildApiTimeContract(timeZone),
    });
  }

  async getRiskCapacity(
    userId: string,
    query: { brokerKey?: string; accountId?: string; startDate?: string; endDate?: string }
  ): Promise<ApiSuccessResponse<unknown>> {
    const brokerKey = String(query.brokerKey || '').trim();
    const accountId = String(query.accountId || '').trim();
    const timeZone = await this.userTimeZoneService.resolveUserTimeZone(userId);
    const { startUtc, endUtc } = getUtcDateRangeFromLocalDates(query.startDate, query.endDate, timeZone);

    return successResponse({ items: [], brokerKey, accountId, startDate: startUtc, endDate: endUtc });
  }

  async evaluatePreTradeOrder(
    userId: string,
    route: BrokerRouteResolution,
    input: PreTradeOrderInput
  ): Promise<PreTradeOrderResult> {
    const activePolicy = await this.riskPolicyRepository.getEffectivePolicy(userId, route.brokerKey);

    if (!activePolicy) {
      return { allowed: true, blocked: false, breaches: [] };
    }

    const breaches: string[] = [];
    if (activePolicy.maxLeverage && input.leverage && input.leverage > activePolicy.maxLeverage) {
      breaches.push(`Leverage exceeds max (${activePolicy.maxLeverage})`);
    }
    if (activePolicy.maxOrderAllocation && input.orderPrice && input.quantity) {
      const notional = input.orderPrice * input.quantity;
      const fundsSnapshot =
        route.brokerKey && route.accountId
          ? await this.fundsSnapshotRepository.getLatestSnapshot(
              userId,
              route.brokerKey,
              route.accountId
            )
          : null;
      const balance = this.extractFundsBalanceValue(fundsSnapshot);
      const allocationPct =
        balance && balance > 0 ? (Math.abs(notional) / balance) * 100 : null;
      if (allocationPct !== null && allocationPct > activePolicy.maxOrderAllocation) {
        breaches.push(
          `Order allocation exceeds max (${this.formatPercent(allocationPct)} vs ${this.formatPercent(
            activePolicy.maxOrderAllocation
          )} of account balance)`
        );
      }
    }

    const blocked = Boolean(activePolicy.enforceHardBlock && breaches.length);
    return {
      allowed: !blocked,
      blocked,
      policyId: activePolicy.id,
      breaches,
      reason: blocked ? breaches.join(' | ') : undefined,
    };
  }

  private async buildComputedRiskSnapshot(userId: string): Promise<RiskComputationResult> {
    const connectedAccounts = await this.brokerAccountRepository.getConnectedBrokerAccounts(userId);
    const uniqueAccounts = Array.from(
      new Map(
        connectedAccounts
          .filter((account) => String(account.id || '').trim())
          .map((account) => [String(account.id).trim(), account])
      ).values()
    );

    const accountIds = uniqueAccounts.map((account) => String(account.id || '').trim()).filter(Boolean);
    const [livePositionsByAccount, positionFreshnessByAccount, openOrdersByAccount] = accountIds.length
      ? await Promise.all([
          this.positionReadModelRepository.listLivePositionsForAccounts(userId, accountIds),
          this.positionReadModelRepository.getAccountFreshness(userId, accountIds),
          this.ordersSnapshotSourceRepository.listOpenOrdersForAccounts(userId, accountIds),
        ])
      : [
          new Map<string, PositionRecord[]>(),
          new Map<string, PositionAccountFreshnessRow>(),
          new Map<string, OpenOrderSnapshotSourceRow[]>(),
        ];

    const brokerPolicyCache = new Map<string, RiskThresholdProfile>();
    const accountInputs = await Promise.all(
      uniqueAccounts.map(async (account) => {
        const brokerKey = String(account.brokerKey || '').trim().toLowerCase();
        if (!brokerPolicyCache.has(brokerKey)) {
          brokerPolicyCache.set(
            brokerKey,
            this.buildRiskThresholdProfile(
              await this.riskPolicyRepository.getEffectivePolicy(userId, brokerKey)
            )
          );
        }

        const fundsSnapshot = await this.fundsSnapshotRepository.getLatestSnapshot(
          userId,
          account.brokerKey,
          account.id
        );
        const fundsBreakdown = this.extractFundsBalanceBreakdown(fundsSnapshot);
        return {
          accountId: String(account.id || '').trim(),
          brokerKey,
          accountName: String(account.accountName || account.accountKey || account.id || '--').trim(),
          fundsSnapshot,
          walletBalance: fundsBreakdown.walletBalance,
          futuresBalance: fundsBreakdown.futuresBalance,
          balance: fundsBreakdown.trackedBalance,
          positions: livePositionsByAccount.get(String(account.id || '').trim()) || [],
          positionsFreshness:
            positionFreshnessByAccount.get(String(account.id || '').trim()) || null,
          thresholds: brokerPolicyCache.get(brokerKey) || this.buildRiskThresholdProfile(null),
        } satisfies AccountRiskSnapshotInput;
      })
    );

    const equity = this.roundNumber(
      accountInputs.reduce((sum, account) => sum + Math.max(0, account.balance || 0), 0)
    );
    const livePositions = accountInputs.flatMap((account) => account.positions);
    const livePositionCount = livePositions.length;

    const accountExposureTotals = new Map<string, number>();
    const brokerExposureTotals = new Map<string, number>();
    const accountLongExposureTotals = new Map<string, number>();
    const accountShortExposureTotals = new Map<string, number>();
    const accountNetExposureTotals = new Map<string, number>();
    const positionEvaluations = accountInputs.flatMap((account) => {
      const totalForAccount = account.positions.reduce(
        (sum, position) => sum + this.resolvePositionExposure(position),
        0
      );
      const longExposure = account.positions.reduce((sum, position) => {
        return this.resolvePositionSideKey(position) === 'long'
          ? sum + this.resolvePositionExposure(position)
          : sum;
      }, 0);
      const shortExposure = account.positions.reduce((sum, position) => {
        return this.resolvePositionSideKey(position) === 'short'
          ? sum + this.resolvePositionExposure(position)
          : sum;
      }, 0);
      accountExposureTotals.set(account.accountId, totalForAccount);
      accountLongExposureTotals.set(account.accountId, longExposure);
      accountShortExposureTotals.set(account.accountId, shortExposure);
      accountNetExposureTotals.set(account.accountId, longExposure - shortExposure);
      brokerExposureTotals.set(
        account.brokerKey,
        (brokerExposureTotals.get(account.brokerKey) || 0) + totalForAccount
      );

      return account.positions.map((position) =>
        this.evaluatePositionRisk(position, account, equity || account.balance || totalForAccount)
      );
    });

    const capitalAtRisk = this.roundNumber(
      positionEvaluations.reduce((sum, evaluation) => sum + evaluation.exposure, 0)
    );
    const longExposure = this.roundNumber(
      Array.from(accountLongExposureTotals.values()).reduce((sum, value) => sum + value, 0)
    );
    const shortExposure = this.roundNumber(
      Array.from(accountShortExposureTotals.values()).reduce((sum, value) => sum + value, 0)
    );
    const netExposure = this.roundNumber(
      Array.from(accountNetExposureTotals.values()).reduce((sum, value) => sum + value, 0)
    );
    const marginUsagePct = equity > 0 ? (capitalAtRisk / equity) * 100 : 0;
    const unrealizedLoss = Math.abs(
      positionEvaluations.reduce((sum, evaluation) => {
        const pnl = evaluation.unrealizedPnl;
        return sum + (pnl !== null && pnl < 0 ? pnl : 0);
      }, 0)
    );
    const drawdownUsagePct = equity > 0 ? (unrealizedLoss / equity) * 100 : 0;
    const lossWindowUsage = await this.computeLossWindowUsage(userId, drawdownUsagePct, equity);
    const averageLeverage = this.average(
      positionEvaluations
        .map((evaluation) => evaluation.leverage)
        .filter((value): value is number => value !== null && Number.isFinite(value))
    );
    const liquidationWatch = positionEvaluations.filter((evaluation) => {
      const distance = evaluation.liquidationDistancePct;
      return distance !== null && distance <= 10;
    }).length;

    const controls = this.buildRiskControls(
      accountInputs,
      equity,
      capitalAtRisk,
      marginUsagePct,
      lossWindowUsage,
      averageLeverage,
      brokerExposureTotals,
      accountExposureTotals,
      positionEvaluations
    );
    const alerts = this.buildRiskAlerts(positionEvaluations, controls);
    const scenarios = this.buildRiskScenarios(
      equity,
      capitalAtRisk,
      averageLeverage,
      brokerExposureTotals,
      positionEvaluations
    );

    const criticalControls = controls.filter((item) => this.normalizeRiskState(item.status) === 'critical');
    const watchControls = controls.filter((item) => this.normalizeRiskState(item.status) === 'watch');
    const atRiskPositions = positionEvaluations.filter((evaluation) =>
      evaluation.statuses.some((status) => status !== 'ok')
    ).length;
    const riskScore = this.computeRiskScore({
      marginUsagePct,
      lossUsagePct: Math.max(
        lossWindowUsage.dailyUsagePct,
        lossWindowUsage.weeklyUsagePct,
        lossWindowUsage.monthlyUsagePct
      ),
      liquidationWatch,
      criticalControls: criticalControls.length,
      watchControls: watchControls.length,
      atRiskPositions,
    });
    const portfolioRisk = this.resolvePortfolioRiskLabel(riskScore, criticalControls.length, watchControls.length);
    const primaryConcern = this.resolvePrimaryConcern(criticalControls, watchControls, alerts, equity, livePositionCount);
    const topHolding = this.resolveTopHolding(positionEvaluations, equity);
    const topBroker = this.resolveTopBroker(brokerExposureTotals, capitalAtRisk);
    const positionEvaluationsById = new Map(
      positionEvaluations.map((evaluation) => [evaluation.positionId, evaluation] as const)
    );
    const {
      orderSnapshots,
      observedAtByAccount: ordersObservedAtByAccount,
      summaryByAccount: orderSummaryByAccount,
      latestObservedAt: ordersObservedAt,
    } = this.buildComputedRiskOrderSnapshots(accountInputs, openOrdersByAccount);
    const portfolioOpenOrders = Array.from(orderSummaryByAccount.values()).reduce(
      (sum, item) => sum + item.openOrders,
      0
    );
    const portfolioOpenOrderExposure = this.roundNumber(
      Array.from(orderSummaryByAccount.values()).reduce(
        (sum, item) => sum + item.openOrderExposure,
        0
      ),
      2
    );
    const portfolioReservedOrderMargin = this.roundNumber(
      Array.from(orderSummaryByAccount.values()).reduce(
        (sum, item) => sum + item.reservedOrderMargin,
        0
      ),
      2
    );
    const accountSnapshots = accountInputs.map((account) => {
      const grossExposure = this.roundNumber(accountExposureTotals.get(account.accountId) || 0);
      const accountLongExposure = this.roundNumber(accountLongExposureTotals.get(account.accountId) || 0);
      const accountShortExposure = this.roundNumber(accountShortExposureTotals.get(account.accountId) || 0);
      const accountNetExposure = this.roundNumber(accountNetExposureTotals.get(account.accountId) || 0);
      const trackedBalance = account.balance;
      const marginUsagePctForAccount =
        trackedBalance && trackedBalance > 0 ? (grossExposure / trackedBalance) * 100 : 0;
      const portfolioConcentrationPct = equity > 0 ? (grossExposure / equity) * 100 : 0;
      const unrealizedPnl = this.roundNumber(
        account.positions.reduce((sum, position) => {
          return sum + this.toFiniteNumber(position.positionSummary?.unrealizedPnl ?? position.unrealized_pnl, 0);
        }, 0),
        2
      );
      const dailyLossUsagePct =
        trackedBalance && trackedBalance > 0
          ? (Math.max(0, -unrealizedPnl) / trackedBalance) * 100
          : 0;
      const maxPositionLeverage = this.maxNumber(
        account.positions.map((position) =>
          this.toFiniteNumber(position.positionSummary?.leverage ?? position.leverage, null)
        )
      );
      const closestLiquidationDistancePct = this.minNumber(
        account.positions.map((position) => this.resolveLiquidationDistancePct(position))
      );
      const fundsObservedAt = this.resolveFundsObservedAt(account.fundsSnapshot);
      const positionsObservedAt = account.positionsFreshness?.observedAt || null;
      const accountOrdersObservedAt = ordersObservedAtByAccount.get(account.accountId) || null;
      const orderSummary = orderSummaryByAccount.get(account.accountId) || {
        openOrders: 0,
        openOrderExposure: 0,
        reservedOrderMargin: 0,
      };

      return {
        brokerKey: account.brokerKey,
        accountId: account.accountId,
        accountName: account.accountName,
        denominatorBasis: 'tracked_balance',
        walletBalance: account.walletBalance,
        futuresBalance: account.futuresBalance,
        trackedBalance,
        grossExposure,
        netExposure: accountNetExposure,
        longExposure: accountLongExposure,
        shortExposure: accountShortExposure,
        openOrders: orderSummary.openOrders,
        openOrderExposure: orderSummary.openOrderExposure,
        reservedOrderMargin: orderSummary.reservedOrderMargin,
        marginUsagePct: this.roundNumber(marginUsagePctForAccount, 2),
        portfolioConcentrationPct: this.roundNumber(portfolioConcentrationPct, 2),
        dailyLossUsagePct: this.roundNumber(dailyLossUsagePct, 2),
        unrealizedPnl,
        openPositions: account.positionsFreshness?.openPositions ?? account.positions.length,
        maxPositionLeverage,
        closestLiquidationDistancePct:
          closestLiquidationDistancePct === null
            ? null
            : this.roundNumber(closestLiquidationDistancePct, 2),
        marginUsageWarnPct: account.thresholds.marginUsageWarnPct,
        marginUsageCriticalPct: account.thresholds.marginUsageCriticalPct,
        concentrationWarnPct: account.thresholds.concentrationWarnPct,
        concentrationCriticalPct: account.thresholds.concentrationCriticalPct,
        dailyLossLimitPct: account.thresholds.dailyLossLimitPct,
        weeklyLossLimitPct: account.thresholds.weeklyLossLimitPct,
        monthlyLossLimitPct: account.thresholds.monthlyLossLimitPct,
        maxLeverage: account.thresholds.maxLeverage,
        maxTotalAllocation: account.thresholds.maxTotalAllocation,
        maxAvgLeverage: account.thresholds.maxAvgLeverage,
        fundsObservedAt,
        positionsObservedAt,
        ordersObservedAt: accountOrdersObservedAt,
      } satisfies ComputedRiskAccountSnapshotPayload;
    });
    const positionSnapshots = accountInputs.flatMap((account) =>
      account.positions.map((position) => {
        const positionId =
          String(position.id || position.externalId || position.external_id || '').trim() ||
          `${account.accountId}-${this.resolvePositionSymbol(position)}`;
        const evaluation = positionEvaluationsById.get(positionId);
        const summary = position.positionSummary;
        return {
          brokerKey: account.brokerKey,
          accountId: account.accountId,
          accountName: account.accountName,
          positionId,
          symbol: this.resolvePositionSymbol(position),
          side: this.readNullableString(summary?.side ?? position.side),
          sideKey: this.readNullableString(summary?.sideKey ?? position.sideKey),
          status: this.readNullableString(summary?.status ?? position.status),
          statusKey: this.readNullableString(summary?.statusKey ?? position.statusKey),
          quantity: this.toFiniteNumber(summary?.quantity ?? position.quantity, null),
          entryPrice: this.toFiniteNumber(summary?.entryPrice ?? position.entry_price, null),
          currentPrice: this.toFiniteNumber(summary?.currentPrice ?? position.current_price, null),
          exposure: this.roundNumber(evaluation?.exposure ?? this.resolvePositionExposure(position), 2),
          unrealizedPnl: this.toFiniteNumber(summary?.unrealizedPnl ?? position.unrealized_pnl, null),
          realizedPnl: this.toFiniteNumber(summary?.realizedPnl ?? position.realized_pnl ?? position.realized, null),
          leverage: this.toFiniteNumber(summary?.leverage ?? position.leverage, null),
          liquidationPrice: this.toFiniteNumber(summary?.liquidationPrice ?? position.liquidation_price, null),
          liquidationDistancePct:
            evaluation?.liquidationDistancePct === null || evaluation?.liquidationDistancePct === undefined
              ? this.resolveLiquidationDistancePct(position)
              : this.roundNumber(evaluation.liquidationDistancePct, 2),
          concentrationPct:
            evaluation?.concentrationPct === null || evaluation?.concentrationPct === undefined
              ? equity > 0
                ? this.roundNumber((this.resolvePositionExposure(position) / equity) * 100, 2)
                : 0
              : this.roundNumber(evaluation.concentrationPct, 2),
          riskState: evaluation ? this.resolveWorstRiskState(evaluation.statuses) : 'ok',
          riskNotesJson: evaluation?.notes?.length ? evaluation.notes : [],
          positionOpenedAt: this.parseDateLike(
            summary?.createdAt ?? position.created_at ?? position.first_seen_at
          ),
          sourceUpdatedAt: this.parseDateLike(
            position.last_seen_at ?? summary?.updatedAt ?? position.updated_at
          ),
        } satisfies ComputedRiskPositionSnapshotPayload;
      })
    );
    const fundsObservedAt = this.resolveLatestDate(
      accountSnapshots.map((account) => account.fundsObservedAt)
    );
    const positionsObservedAt = this.resolveLatestDate(
      accountSnapshots.map((account) => account.positionsObservedAt)
    );

    return {
      snapshot: {
        portfolioRisk,
        breachedRules: criticalControls.length,
        liquidationWatch,
        capitalAtRisk,
        denominatorBasis: 'tracked_balance',
        portfolioEquity: equity,
        grossExposure: capitalAtRisk,
        netExposure,
        longExposure,
        shortExposure,
        openOrders: portfolioOpenOrders,
        openOrderExposure: portfolioOpenOrderExposure,
        reservedOrderMargin: portfolioReservedOrderMargin,
        marginUsage: this.formatPercent(marginUsagePct),
        drawdownBudgetUsed: this.formatPercent(lossWindowUsage.dailyUsagePct),
        weeklyDrawdownBudgetUsed: this.formatPercent(lossWindowUsage.weeklyUsagePct),
        monthlyDrawdownBudgetUsed: this.formatPercent(lossWindowUsage.monthlyUsagePct),
        atRiskPositions,
        ruleViolations: criticalControls.length + watchControls.length,
        portfolioRiskScore: `${riskScore}/100`,
        primaryConcern,
        riskByPosition: topHolding
          ? `${topHolding.symbol} at ${this.formatPercent(topHolding.allocationPct)} of capital`
          : 'No live positions are currently open.',
        riskByStrategy: topBroker
          ? `Strategy attribution unavailable; top broker ${topBroker.label}`
          : 'Strategy attribution unavailable in the current backend contract.',
        riskByGuardrail:
          criticalControls[0]?.bucket ||
          watchControls[0]?.bucket ||
          'No active guardrail breach detected.',
        guardrailOne:
          controls[0]?.action ||
          'No configured risk controls were breached during this recompute.',
        guardrailTwo:
          controls[1]?.action ||
          'Funds and positions remain snapshot-backed, not broker-live.',
        guardrailThree:
          controls[2]?.action ||
          'Weekly and monthly loss windows are now backed by persisted closed-position activity.',
        actionOne:
          criticalControls[0]?.action ||
          watchControls[0]?.action ||
          'Review the highest-exposure route in Risk Center before adding new risk.',
        actionTwo:
          alerts[0]?.message ||
          'Confirm funds and positions snapshots are fresh before trusting the desk.',
        actionThree:
          scenarios[0]?.commentary ||
          'Use Risk Center scenario review to pressure-test the current posture.',
        fundsObservedAt,
        positionsObservedAt,
        ordersObservedAt,
      },
      accountSnapshots,
      orderSnapshots,
      positionSnapshots,
      alerts,
      controls,
      scenarios,
      equity,
      accountCount: accountInputs.length,
      livePositionCount,
      topHoldings: positionEvaluations
        .filter((evaluation) => evaluation.exposure > 0)
        .sort((left, right) => right.exposure - left.exposure)
        .slice(0, 5)
        .map((evaluation) => ({
          id: evaluation.positionId,
          symbol: evaluation.symbol,
          allocationPct: this.roundNumber(evaluation.concentrationPct || 0, 2),
          marketValue: this.roundNumber(evaluation.exposure),
          dayPnL: this.roundNumber(evaluation.unrealizedPnl || 0),
          strategy: 'Risk Center recompute',
          riskState: this.resolveWorstRiskState(evaluation.statuses),
        })),
    };
  }

  private buildComputedRiskOrderSnapshots(
    accounts: AccountRiskSnapshotInput[],
    openOrdersByAccount: Map<string, OpenOrderSnapshotSourceRow[]>
  ): {
    orderSnapshots: ComputedRiskOrderSnapshotPayload[];
    observedAtByAccount: Map<string, Date | null>;
    summaryByAccount: Map<string, ComputedRiskOrderAccountSummary>;
    latestObservedAt: Date | null;
  } {
    const observedAtByAccount = new Map<string, Date | null>();
    const summaryByAccount = new Map<string, ComputedRiskOrderAccountSummary>();
    const orderSnapshots = accounts.flatMap((account) => {
      const sourceRows = openOrdersByAccount.get(account.accountId) || [];
      const observedAt = this.resolveLatestDate(
        sourceRows.map((row) => row.lastSeenAt || row.firstSeenAt)
      );
      observedAtByAccount.set(account.accountId, observedAt);
      const accountOrderSnapshots = sourceRows.map((row) => this.mapOpenOrderSnapshot(account, row));
      summaryByAccount.set(account.accountId, {
        openOrders: sourceRows.length,
        openOrderExposure: this.roundNumber(
          accountOrderSnapshots.reduce((sum, item) => {
            if (item.reduceOnly) {
              return sum;
            }
            return sum + Math.abs(item.notional || 0);
          }, 0),
          2
        ),
        reservedOrderMargin: this.roundNumber(
          accountOrderSnapshots.reduce((sum, item) => {
            if (item.reduceOnly) {
              return sum;
            }
            return sum + Math.abs(item.reservedMargin || 0);
          }, 0),
          2
        ),
      });
      return accountOrderSnapshots;
    });

    return {
      orderSnapshots,
      observedAtByAccount,
      summaryByAccount,
      latestObservedAt: this.resolveLatestDate(Array.from(observedAtByAccount.values())),
    };
  }

  private buildRiskThresholdProfile(
    policy: RiskThresholdProfileInput | null | undefined
  ): RiskThresholdProfile {
    return {
      marginUsageWarnPct: this.toFiniteNumber(policy?.marginUsageWarnPct, 70),
      marginUsageCriticalPct: this.toFiniteNumber(policy?.marginUsageCriticalPct, 85),
      concentrationWarnPct: this.toFiniteNumber(policy?.concentrationWarnPct, 30),
      concentrationCriticalPct: this.toFiniteNumber(policy?.concentrationCriticalPct, 45),
      dailyLossLimitPct: this.toFiniteNumber(policy?.dailyLossLimitPct, 5),
      weeklyLossLimitPct: this.toFiniteNumber(policy?.weeklyLossLimitPct, 12),
      monthlyLossLimitPct: this.toFiniteNumber(policy?.monthlyLossLimitPct, 20),
      maxLeverage: this.toFiniteNumber(policy?.maxLeverage, 5),
      maxTotalAllocation: this.toFiniteNumber(policy?.maxTotalAllocation, 80),
      maxAvgLeverage: this.toFiniteNumber(policy?.maxAvgLeverage, 4),
    };
  }

  private buildRiskControls(
    accounts: AccountRiskSnapshotInput[],
    equity: number,
    capitalAtRisk: number,
    marginUsagePct: number,
    lossWindowUsage: LossWindowUsage,
    averageLeverage: number | null,
    brokerExposureTotals: Map<string, number>,
    accountExposureTotals: Map<string, number>,
    evaluations: PositionRiskEvaluation[]
  ): ComputedRiskControlPayload[] {
    const controls: ComputedRiskControlPayload[] = [];
    const globalThresholds = this.buildGlobalThresholdProfile(accounts);

    controls.push({
      bucket: 'Portfolio margin usage',
      exposure: this.formatPercent(marginUsagePct),
      threshold: `Warn ${this.formatPercent(globalThresholds.marginUsageWarnPct)} / Critical ${this.formatPercent(globalThresholds.marginUsageCriticalPct)}`,
      status: this.resolveThresholdState(
        marginUsagePct,
        globalThresholds.marginUsageWarnPct,
        globalThresholds.marginUsageCriticalPct
      ),
      action:
        marginUsagePct >= globalThresholds.marginUsageCriticalPct
          ? 'Reduce gross exposure or add margin before the next rebalance window.'
          : marginUsagePct >= globalThresholds.marginUsageWarnPct
            ? 'Review leverage-heavy routes before increasing exposure.'
            : 'Margin usage is within configured tolerance.',
    });

    controls.push({
      bucket: 'Daily drawdown usage',
      exposure: this.formatPercent(lossWindowUsage.dailyUsagePct),
      threshold: `Limit ${this.formatPercent(globalThresholds.dailyLossLimitPct)}`,
      status: this.resolveLossWindowState(
        lossWindowUsage.dailyUsagePct,
        globalThresholds.dailyLossLimitPct
      ),
      action:
        lossWindowUsage.dailyUsagePct >= globalThresholds.dailyLossLimitPct
          ? 'De-risk open positions or tighten losses before the daily budget is exhausted.'
          : lossWindowUsage.dailyUsagePct >= globalThresholds.dailyLossLimitPct * 0.8
            ? 'Watch daily drawdown closely; one more adverse move could hit the limit.'
            : 'Daily drawdown usage remains within the configured budget.',
    });

    controls.push({
      bucket: 'Weekly loss usage',
      exposure: this.formatPercent(lossWindowUsage.weeklyUsagePct),
      threshold: `Limit ${this.formatPercent(globalThresholds.weeklyLossLimitPct)}`,
      status: this.resolveLossWindowState(
        lossWindowUsage.weeklyUsagePct,
        globalThresholds.weeklyLossLimitPct
      ),
      action:
        lossWindowUsage.weeklyUsagePct >= globalThresholds.weeklyLossLimitPct
          ? 'Trailing 7-day realized losses have exhausted the weekly budget. Reduce risk and review recent closed-trade activity before adding exposure.'
          : lossWindowUsage.weeklyUsagePct >= globalThresholds.weeklyLossLimitPct * 0.8
            ? 'Weekly loss usage is nearing its limit. Review the last 7 days of realized losses before scaling up.'
            : 'Weekly loss usage remains within the configured budget.',
    });

    controls.push({
      bucket: 'Monthly loss usage',
      exposure: this.formatPercent(lossWindowUsage.monthlyUsagePct),
      threshold: `Limit ${this.formatPercent(globalThresholds.monthlyLossLimitPct)}`,
      status: this.resolveLossWindowState(
        lossWindowUsage.monthlyUsagePct,
        globalThresholds.monthlyLossLimitPct
      ),
      action:
        lossWindowUsage.monthlyUsagePct >= globalThresholds.monthlyLossLimitPct
          ? 'Trailing 30-day realized losses have exhausted the monthly budget. Pause new risk and review strategy quality before re-entering.'
          : lossWindowUsage.monthlyUsagePct >= globalThresholds.monthlyLossLimitPct * 0.8
            ? 'Monthly loss usage is approaching its limit. Inspect the last 30 days of realized losses before increasing risk.'
            : 'Monthly loss usage remains within the configured budget.',
    });

    if (averageLeverage !== null) {
      controls.push({
        bucket: 'Average leverage',
        exposure: `${this.roundNumber(averageLeverage, 2)}x`,
        threshold: `Max ${this.roundNumber(globalThresholds.maxAvgLeverage, 2)}x`,
        status: averageLeverage >= globalThresholds.maxAvgLeverage ? 'Critical' : 'Ok',
        action:
          averageLeverage >= globalThresholds.maxAvgLeverage
            ? 'Reduce average leverage across the book before adding new trades.'
            : 'Average leverage stays inside the configured guardrail.',
      });
    }

    brokerExposureTotals.forEach((exposure, brokerKey) => {
      const pct = equity > 0 ? (exposure / equity) * 100 : 0;
      const thresholds =
        accounts.find((account) => account.brokerKey === brokerKey)?.thresholds || globalThresholds;
      controls.push({
        bucket: `${brokerKey || 'broker'} total allocation`,
        exposure: this.formatPercent(pct),
        threshold: `Warn ${this.formatPercent(thresholds.concentrationWarnPct)} / Critical ${this.formatPercent(Math.min(100, thresholds.maxTotalAllocation))}`,
        status: this.resolveThresholdState(
          pct,
          thresholds.concentrationWarnPct,
          Math.min(100, thresholds.maxTotalAllocation)
        ),
        action:
          pct >= Math.min(100, thresholds.maxTotalAllocation)
            ? `Reduce ${brokerKey || 'broker'} concentration before it dominates portfolio risk.`
            : pct >= thresholds.concentrationWarnPct
              ? `Keep ${brokerKey || 'broker'} exposure under watch; it is becoming the dominant sleeve.`
              : `${brokerKey || 'Broker'} allocation remains inside the configured posture.`,
      });
    });

    accounts.forEach((account) => {
      const accountExposure = accountExposureTotals.get(account.accountId) || 0;
      const accountBalance = account.balance || 0;
      const accountMarginUsagePct = accountBalance > 0 ? (accountExposure / accountBalance) * 100 : 0;
      controls.push({
        bucket: `${account.accountName} margin usage`,
        exposure: this.formatPercent(accountMarginUsagePct),
        threshold: `Warn ${this.formatPercent(account.thresholds.marginUsageWarnPct)} / Critical ${this.formatPercent(account.thresholds.marginUsageCriticalPct)}`,
        status: this.resolveThresholdState(
          accountMarginUsagePct,
          account.thresholds.marginUsageWarnPct,
          account.thresholds.marginUsageCriticalPct
        ),
        action:
          accountMarginUsagePct >= account.thresholds.marginUsageCriticalPct
            ? `Add funds or trim exposure on ${account.accountName}.`
            : accountMarginUsagePct >= account.thresholds.marginUsageWarnPct
              ? `Monitor ${account.accountName}; margin usage is rising.`
              : `${account.accountName} remains comfortably within margin tolerance.`,
      });
    });

    evaluations
      .filter((evaluation) => evaluation.concentrationPct !== null)
      .sort((left, right) => (right.concentrationPct || 0) - (left.concentrationPct || 0))
      .slice(0, 3)
      .forEach((evaluation) => {
        const account = accounts.find((item) => item.accountId === evaluation.accountId);
        const thresholds = account?.thresholds || globalThresholds;
        controls.push({
          bucket: `${evaluation.symbol} concentration`,
          exposure: this.formatPercent(evaluation.concentrationPct || 0),
          threshold: `Warn ${this.formatPercent(thresholds.concentrationWarnPct)} / Critical ${this.formatPercent(thresholds.concentrationCriticalPct)}`,
          status: this.resolveThresholdState(
            evaluation.concentrationPct || 0,
            thresholds.concentrationWarnPct,
            thresholds.concentrationCriticalPct
          ),
          action:
            (evaluation.concentrationPct || 0) >= thresholds.concentrationCriticalPct
              ? `Cut ${evaluation.symbol} concentration or hedge the position.`
              : (evaluation.concentrationPct || 0) >= thresholds.concentrationWarnPct
                ? `Keep ${evaluation.symbol} under review; it is becoming oversized.`
                : `${evaluation.symbol} concentration remains inside the configured posture.`,
        });
      });

    return controls
      .filter((control) => control.bucket && control.exposure && control.threshold && control.action)
      .slice(0, 12);
  }

  private buildRiskAlerts(
    evaluations: PositionRiskEvaluation[],
    controls: ComputedRiskControlPayload[]
  ): ComputedRiskAlertPayload[] {
    const alerts: ComputedRiskAlertPayload[] = [];

    controls
      .filter((control) => this.normalizeRiskState(control.status) !== 'ok')
      .slice(0, 6)
      .forEach((control) => {
        const severity = this.normalizeRiskState(control.status) === 'critical' ? 'Critical' : 'Watch';
        alerts.push({
          severity,
          message: `${control.bucket}: ${control.action}`,
          symbol: 'PORTFOLIO',
          channel: 'Risk',
          status: 'Open',
        });
      });

    evaluations
      .filter((evaluation) => evaluation.statuses.some((status) => status !== 'ok'))
      .sort((left, right) => right.exposure - left.exposure)
      .slice(0, 6)
      .forEach((evaluation) => {
        const worstState = this.resolveWorstRiskState(evaluation.statuses);
        alerts.push({
          severity: worstState === 'critical' ? 'Critical' : 'Watch',
          message:
            evaluation.notes[0] ||
            `${evaluation.symbol} is carrying elevated position risk on ${evaluation.accountName}.`,
          symbol: evaluation.symbol,
          channel: 'Risk',
          status: 'Open',
        });
      });

    return alerts.slice(0, 10);
  }

  private buildRiskScenarios(
    equity: number,
    capitalAtRisk: number,
    averageLeverage: number | null,
    brokerExposureTotals: Map<string, number>,
    evaluations: PositionRiskEvaluation[]
  ): ComputedRiskScenarioPayload[] {
    const scenarios: ComputedRiskScenarioPayload[] = [];
    const fivePctMoveImpact = this.roundNumber(capitalAtRisk * 0.05);
    scenarios.push({
      scenario: '5% adverse move',
      impact: fivePctMoveImpact > equity * 0.03 ? 'Critical' : 'Watch',
      commentary:
        equity > 0
          ? `A 5% move against current exposure would impact roughly ${this.formatCurrency(fivePctMoveImpact)} (${this.formatPercent((fivePctMoveImpact / equity) * 100)}) of tracked equity.`
          : `A 5% move against current exposure would impact roughly ${this.formatCurrency(fivePctMoveImpact)}.`,
    });

    if (averageLeverage !== null) {
      scenarios.push({
        scenario: 'Leverage compression',
        impact: averageLeverage >= 4 ? 'Critical' : 'Watch',
        commentary:
          averageLeverage >= 4
            ? `Average leverage is ${this.roundNumber(averageLeverage, 2)}x, so a sharp volatility spike could trigger forced de-risking quickly.`
            : `Average leverage is ${this.roundNumber(averageLeverage, 2)}x and remains monitorable, but still amplifies intraday drawdowns.`,
      });
    }

    const topBroker = this.resolveTopBroker(brokerExposureTotals, capitalAtRisk);
    if (topBroker) {
      scenarios.push({
        scenario: 'Broker concentration shock',
        impact: topBroker.pct >= 50 ? 'Critical' : 'Watch',
        commentary: `${topBroker.label} means a routing or liquidity issue there would dominate the current book.`,
      });
    }

    const topLiquidation = evaluations
      .filter((evaluation) => evaluation.liquidationDistancePct !== null)
      .sort((left, right) => (left.liquidationDistancePct || Number.MAX_SAFE_INTEGER) - (right.liquidationDistancePct || Number.MAX_SAFE_INTEGER))[0];
    if (topLiquidation) {
      scenarios.push({
        scenario: 'Liquidation cascade',
        impact:
          (topLiquidation.liquidationDistancePct || Number.MAX_SAFE_INTEGER) <= 5 ? 'Critical' : 'Watch',
        commentary: `${topLiquidation.symbol} is only ${this.formatPercent(topLiquidation.liquidationDistancePct || 0)} away from its liquidation reference price.`,
      });
    }

    return scenarios.slice(0, 4);
  }

  private evaluatePositionRisk(
    position: PositionRecord,
    account: AccountRiskSnapshotInput,
    portfolioEquity: number
  ): PositionRiskEvaluation {
    const summary = position.positionSummary;
    const exposure = this.resolvePositionExposure(position);
    const leverage = this.toFiniteNumber(summary?.leverage ?? position.leverage, null);
    const unrealizedPnl = this.toFiniteNumber(summary?.unrealizedPnl ?? position.unrealized_pnl, null);
    const concentrationPct = portfolioEquity > 0 ? (exposure / portfolioEquity) * 100 : null;
    const liquidationDistancePct = this.resolveLiquidationDistancePct(position);
    const statuses: Array<'ok' | 'watch' | 'critical'> = [];
    const notes: string[] = [];

    if (concentrationPct !== null) {
      const state = this.resolveThresholdState(
        concentrationPct,
        account.thresholds.concentrationWarnPct,
        account.thresholds.concentrationCriticalPct
      );
      statuses.push(this.normalizeRiskState(state));
      if (this.normalizeRiskState(state) !== 'ok') {
        notes.push(
          `${this.resolvePositionSymbol(position)} concentration is ${this.formatPercent(concentrationPct)}, above the configured posture.`
        );
      }
    }

    if (leverage !== null && leverage >= account.thresholds.maxLeverage) {
      statuses.push('critical');
      notes.push(
        `${this.resolvePositionSymbol(position)} leverage is ${this.roundNumber(leverage, 2)}x, above the configured max leverage.`
      );
    }

    if (liquidationDistancePct !== null) {
      if (liquidationDistancePct <= 5) {
        statuses.push('critical');
        notes.push(
          `${this.resolvePositionSymbol(position)} is only ${this.formatPercent(liquidationDistancePct)} away from liquidation.`
        );
      } else if (liquidationDistancePct <= 10) {
        statuses.push('watch');
        notes.push(
          `${this.resolvePositionSymbol(position)} is ${this.formatPercent(liquidationDistancePct)} away from liquidation and should be watched.`
        );
      }
    }

    if (unrealizedPnl !== null && unrealizedPnl < 0 && account.balance && account.balance > 0) {
      const lossPct = Math.abs(unrealizedPnl) / account.balance * 100;
      if (lossPct >= account.thresholds.dailyLossLimitPct) {
        statuses.push('critical');
        notes.push(
          `${this.resolvePositionSymbol(position)} is consuming ${this.formatPercent(lossPct)} of the account balance in unrealized loss.`
        );
      } else if (lossPct >= account.thresholds.dailyLossLimitPct * 0.5) {
        statuses.push('watch');
        notes.push(
          `${this.resolvePositionSymbol(position)} already accounts for ${this.formatPercent(lossPct)} of the account balance in unrealized loss.`
        );
      }
    }

    return {
      positionId:
        String(position.id || position.externalId || position.external_id || '').trim() ||
        `${account.accountId}-${this.resolvePositionSymbol(position)}`,
      symbol: this.resolvePositionSymbol(position),
      brokerKey: account.brokerKey,
      accountId: account.accountId,
      accountName: account.accountName,
      exposure,
      leverage,
      unrealizedPnl,
      liquidationDistancePct,
      concentrationPct,
      statuses: statuses.length ? statuses : ['ok'],
      notes,
    };
  }

  private mapOpenOrderSnapshot(
    account: AccountRiskSnapshotInput,
    row: OpenOrderSnapshotSourceRow
  ): ComputedRiskOrderSnapshotPayload {
    const payload = this.parseSnapshotJson(row.payloadJson);
    const orderId =
      this.pickRecordNullableString(payload, ['order_id', 'orderId', 'id']) || null;
    const externalId =
      this.pickRecordString(payload, ['external_id', 'externalId', 'id', 'order_id', 'orderId']) ||
      String(row.externalId || '').trim() ||
      `${account.accountId}-open-order`;
    const quantity = this.pickRecordNumber(payload, ['quantity', 'actual_amount', 'desired_amount']);
    const filledQuantity = this.pickRecordNumber(payload, ['filled_quantity', 'filledQuantity']);
    const remainingQuantity = this.pickRecordNumber(payload, ['remaining_quantity', 'remainingQuantity']);
    const price = this.pickRecordNumber(payload, ['price', 'order_price', 'orderPrice']);
    const orderPrice = this.pickRecordNumber(payload, ['order_price', 'orderPrice', 'price']);
    const triggerPrice = this.pickRecordNumber(payload, ['trigger_price', 'triggerPrice']);
    const filledPrice = this.pickRecordNumber(payload, ['filled_price', 'filledPrice']);
    const lastPrice = this.pickRecordNumber(payload, ['last_price', 'lastPrice']);
    const referencePrice = orderPrice ?? price ?? triggerPrice ?? filledPrice ?? lastPrice;
    const notional =
      this.pickRecordNumber(payload, ['actual_amount', 'actualAmount', 'notional']) ??
      this.resolveOrderNotional(quantity, referencePrice);
    const reservedMargin = this.resolveOrderReservedMargin(payload, notional);

    return {
      brokerKey: account.brokerKey,
      accountId: account.accountId,
      accountName: account.accountName,
      externalId,
      orderId,
      symbol: this.pickRecordNullableString(payload, ['symbol']),
      side: this.pickRecordNullableString(payload, ['side']),
      status: this.pickRecordNullableString(payload, ['status']),
      orderType: this.pickRecordNullableString(payload, ['order_type', 'orderType']),
      triggerType: this.pickRecordNullableString(payload, ['trigger_type', 'triggerType']),
      quantity,
      filledQuantity,
      remainingQuantity,
      price,
      orderPrice,
      triggerPrice,
      filledPrice,
      lastPrice,
      stoplossPrice: this.pickRecordNumber(payload, ['stoploss_price', 'stopLossPrice']),
      takeprofitPrice: this.pickRecordNumber(payload, ['takeprofit_price', 'takeProfitPrice']),
      leverage: this.pickRecordNumber(payload, ['leverage']),
      reduceOnly: this.pickRecordBoolean(payload, ['reduce_only', 'reduceOnly']),
      snapshotStatusRank: Math.max(
        0,
        Math.trunc(
          this.pickRecordNumber(payload, ['snapshot_status_rank', 'snapshotStatusRank']) ??
            this.toFiniteNumber(row.statusRank, 0)
        )
      ),
      notional,
      reservedMargin,
      orderCreatedAt: this.pickRecordDate(payload, ['created_at', 'createdAt']) || row.firstSeenAt,
      orderUpdatedAt: this.pickRecordDate(payload, ['updated_at', 'updatedAt']) || row.lastSeenAt,
      orderCanceledAt: this.pickRecordDate(payload, ['canceled_at', 'canceledAt']),
      firstSeenAt: row.firstSeenAt,
      lastSeenAt: row.lastSeenAt,
    };
  }

  private resolvePrimaryConcern(
    criticalControls: ComputedRiskControlPayload[],
    watchControls: ComputedRiskControlPayload[],
    alerts: ComputedRiskAlertPayload[],
    equity: number,
    livePositionCount: number
  ): string {
    if (criticalControls[0]) {
      return criticalControls[0].bucket;
    }
    if (watchControls[0]) {
      return watchControls[0].bucket;
    }
    if (alerts[0]) {
      return alerts[0].message;
    }
    if (equity <= 0) {
      return 'No funds snapshot is available for connected accounts.';
    }
    if (livePositionCount <= 0) {
      return 'No live positions are currently open.';
    }
    return 'No acute risk breach detected in the latest recompute.';
  }

  private resolveTopHolding(
    evaluations: PositionRiskEvaluation[],
    equity: number
  ): { symbol: string; allocationPct: number } | null {
    const top = evaluations
      .filter((evaluation) => evaluation.exposure > 0)
      .sort((left, right) => right.exposure - left.exposure)[0];
    if (!top) {
      return null;
    }
    const allocationPct = equity > 0 ? (top.exposure / equity) * 100 : 0;
    return {
      symbol: top.symbol,
      allocationPct,
    };
  }

  private resolveTopBroker(
    brokerExposureTotals: Map<string, number>,
    capitalAtRisk: number
  ): { label: string; pct: number } | null {
    const top = Array.from(brokerExposureTotals.entries()).sort((left, right) => right[1] - left[1])[0];
    if (!top) {
      return null;
    }

    const pct = capitalAtRisk > 0 ? (top[1] / capitalAtRisk) * 100 : 0;
    return {
      label: `${top[0]} carries ${this.formatPercent(pct)} of portfolio exposure`,
      pct,
    };
  }

  private buildGlobalThresholdProfile(accounts: AccountRiskSnapshotInput[]): RiskThresholdProfile {
    if (!accounts.length) {
      return this.buildRiskThresholdProfile(null);
    }

    return accounts.reduce<RiskThresholdProfile>(
      (accumulator, account) => ({
        marginUsageWarnPct: Math.min(accumulator.marginUsageWarnPct, account.thresholds.marginUsageWarnPct),
        marginUsageCriticalPct: Math.min(accumulator.marginUsageCriticalPct, account.thresholds.marginUsageCriticalPct),
        concentrationWarnPct: Math.min(accumulator.concentrationWarnPct, account.thresholds.concentrationWarnPct),
        concentrationCriticalPct: Math.min(accumulator.concentrationCriticalPct, account.thresholds.concentrationCriticalPct),
        dailyLossLimitPct: Math.min(accumulator.dailyLossLimitPct, account.thresholds.dailyLossLimitPct),
        weeklyLossLimitPct: Math.min(accumulator.weeklyLossLimitPct, account.thresholds.weeklyLossLimitPct),
        monthlyLossLimitPct: Math.min(accumulator.monthlyLossLimitPct, account.thresholds.monthlyLossLimitPct),
        maxLeverage: Math.min(accumulator.maxLeverage, account.thresholds.maxLeverage),
        maxTotalAllocation: Math.min(accumulator.maxTotalAllocation, account.thresholds.maxTotalAllocation),
        maxAvgLeverage: Math.min(accumulator.maxAvgLeverage, account.thresholds.maxAvgLeverage),
      }),
      this.buildRiskThresholdProfile(null)
    );
  }

  private computeRiskScore(input: {
    marginUsagePct: number;
    lossUsagePct: number;
    liquidationWatch: number;
    criticalControls: number;
    watchControls: number;
    atRiskPositions: number;
  }): number {
    const rawScore =
      input.criticalControls * 22 +
      input.watchControls * 8 +
      input.liquidationWatch * 6 +
      input.atRiskPositions * 4 +
      Math.min(20, input.marginUsagePct / 4) +
      Math.min(20, input.lossUsagePct * 2);

    return Math.max(0, Math.min(100, Math.round(rawScore)));
  }

  private resolvePortfolioRiskLabel(
    score: number,
    criticalControls: number,
    watchControls: number
  ): string {
    if (criticalControls > 0 || score >= 70) {
      return 'Critical';
    }
    if (watchControls > 0 || score >= 35) {
      return 'Watch';
    }
    return 'Healthy';
  }

  private resolveThresholdState(value: number, warnThreshold: number, criticalThreshold: number): string {
    if (value >= criticalThreshold) {
      return 'Critical';
    }
    if (value >= warnThreshold) {
      return 'Watch';
    }
    return 'Ok';
  }

  private resolveLossWindowState(value: number, limit: number): string {
    if (value >= limit) {
      return 'Critical';
    }
    if (value >= limit * 0.8) {
      return 'Watch';
    }
    return 'Ok';
  }

  private async computeLossWindowUsage(
    userId: string,
    dailyUsagePct: number,
    equity: number
  ): Promise<LossWindowUsage> {
    const normalizedDailyUsage = this.roundNumber(Math.max(0, dailyUsagePct), 2);
    if (!(equity > 0)) {
      return {
        dailyUsagePct: normalizedDailyUsage,
        weeklyUsagePct: 0,
        monthlyUsagePct: 0,
      };
    }

    try {
      const pnlResponse = await this.portfolioService.getPortfolioPnL(userId);
      const pnl = pnlResponse.data ?? pnlResponse;
      const weeklyRealizedLoss = Math.max(0, -this.toFiniteNumber(pnl?.weeklyPnL, 0));
      const monthlyRealizedLoss = Math.max(0, -this.toFiniteNumber(pnl?.monthlyPnL, 0));

      return {
        dailyUsagePct: normalizedDailyUsage,
        weeklyUsagePct: this.roundNumber((weeklyRealizedLoss / equity) * 100, 2),
        monthlyUsagePct: this.roundNumber((monthlyRealizedLoss / equity) * 100, 2),
      };
    } catch {
      return {
        dailyUsagePct: normalizedDailyUsage,
        weeklyUsagePct: 0,
        monthlyUsagePct: 0,
      };
    }
  }

  private resolveWorstRiskState(statuses: Array<'ok' | 'watch' | 'critical'>): string {
    if (statuses.includes('critical')) {
      return 'critical';
    }
    if (statuses.includes('watch')) {
      return 'watch';
    }
    return 'ok';
  }

  private normalizeRiskState(value: string): 'ok' | 'watch' | 'critical' {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'critical' || normalized === 'breach') {
      return 'critical';
    }
    if (normalized === 'watch' || normalized === 'warning') {
      return 'watch';
    }
    return 'ok';
  }

  private resolvePositionExposure(position: PositionRecord): number {
    const summary = position.positionSummary;
    const explicitExposure = this.toFiniteNumber(summary?.exposure ?? position.exposure, null);
    if (explicitExposure !== null) {
      return Math.abs(explicitExposure);
    }

    const quantity = this.toFiniteNumber(summary?.quantity ?? position.quantity, null);
    const price = this.toFiniteNumber(
      summary?.currentPrice ?? position.current_price ?? summary?.entryPrice ?? position.entry_price,
      null
    );
    if (quantity !== null && price !== null) {
      return Math.abs(quantity * price);
    }

    return 0;
  }

  private resolvePositionSideKey(position: PositionRecord): 'long' | 'short' | null {
    const rawValue = String(
      position.positionSummary?.sideKey ||
        position.sideKey ||
        position.positionSummary?.side ||
        position.side ||
        ''
    )
      .trim()
      .toLowerCase();

    if (rawValue === 'long' || rawValue === 'buy') {
      return 'long';
    }
    if (rawValue === 'short' || rawValue === 'sell') {
      return 'short';
    }
    return null;
  }

  private resolveLiquidationDistancePct(position: PositionRecord): number | null {
    const summary = position.positionSummary;
    const liquidationPrice = this.toFiniteNumber(summary?.liquidationPrice ?? position.liquidation_price, null);
    const currentPrice = this.toFiniteNumber(
      summary?.currentPrice ?? position.current_price ?? summary?.entryPrice ?? position.entry_price,
      null
    );
    if (liquidationPrice === null || currentPrice === null || currentPrice === 0) {
      return null;
    }

    return Math.abs(currentPrice - liquidationPrice) / Math.abs(currentPrice) * 100;
  }

  private resolvePositionSymbol(position: PositionRecord): string {
    return String(position.positionSummary?.symbol || position.symbol || 'UNKNOWN').trim() || 'UNKNOWN';
  }

  private readNullableString(value: unknown): string | null {
    const normalized = String(value || '').trim();
    return normalized ? normalized : null;
  }

  private extractFundsBalanceValue(snapshot: FundsSnapshotRow | null): number | null {
    return this.extractFundsBalanceBreakdown(snapshot).trackedBalance;
  }

  private extractFundsBalanceBreakdown(snapshot: FundsSnapshotRow | null): FundsBalanceBreakdown {
    if (!snapshot) {
      return {
        walletBalance: null,
        futuresBalance: null,
        trackedBalance: null,
      };
    }

    const futuresFunds = this.parseSnapshotJson(snapshot.futures_funds_json);
    const walletFunds = this.parseSnapshotJson(snapshot.wallet_funds_json);
    const walletBalance = this.extractFundsBalanceFromPayload(walletFunds);
    const futuresBalance = this.extractFundsBalanceFromPayload(futuresFunds);

    return {
      walletBalance,
      futuresBalance,
      trackedBalance: futuresBalance ?? walletBalance,
    };
  }

  private resolveFundsObservedAt(snapshot: FundsSnapshotRow | null): Date | null {
    if (!snapshot) {
      return null;
    }

    return snapshot.observed_at || snapshot.computed_at || snapshot.created_at || null;
  }

  private extractFundsBalanceFromPayload(payload: Record<string, unknown> | null): number | null {
    if (!payload) {
      return null;
    }

    return this.toFiniteNumber(
      payload.balance ??
        payload.total ??
        payload.equity ??
        payload.wallet_balance ??
        payload.futures_equity ??
        payload.margin_balance,
      null
    );
  }

  private parseSnapshotJson(value: unknown): Record<string, unknown> | null {
    if (!value) {
      return null;
    }

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }

    try {
      const parsed = JSON.parse(String(value));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }

  private isPresentRecordValue(value: unknown): boolean {
    return (
      value !== undefined &&
      value !== null &&
      !(typeof value === 'string' && value.trim() === '')
    );
  }

  private pickRecordValue(
    record: Record<string, unknown> | null,
    keys: string[]
  ): unknown {
    if (!record) {
      return null;
    }

    for (const key of keys) {
      if (this.isPresentRecordValue(record[key])) {
        return record[key];
      }
    }

    return null;
  }

  private pickRecordString(
    record: Record<string, unknown> | null,
    keys: string[]
  ): string {
    const value = this.pickRecordValue(record, keys);
    return this.isPresentRecordValue(value) ? String(value).trim() : '';
  }

  private pickRecordNullableString(
    record: Record<string, unknown> | null,
    keys: string[]
  ): string | null {
    const normalized = this.pickRecordString(record, keys);
    return normalized || null;
  }

  private pickRecordNumber(
    record: Record<string, unknown> | null,
    keys: string[]
  ): number | null {
    const value = this.pickRecordValue(record, keys);
    if (!this.isPresentRecordValue(value)) {
      return null;
    }

    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }

  private pickRecordBoolean(
    record: Record<string, unknown> | null,
    keys: string[]
  ): boolean | null {
    const value = this.pickRecordValue(record, keys);
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'number') {
      return value !== 0;
    }
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (!normalized) {
        return null;
      }
      if (['true', '1', 'yes'].includes(normalized)) {
        return true;
      }
      if (['false', '0', 'no'].includes(normalized)) {
        return false;
      }
    }
    return null;
  }

  private pickRecordDate(
    record: Record<string, unknown> | null,
    keys: string[]
  ): Date | null {
    return this.parseDateLike(this.pickRecordValue(record, keys));
  }

  private resolveOrderNotional(quantity: number | null, price: number | null): number | null {
    if (quantity === null || price === null) {
      return null;
    }

    return this.roundNumber(Math.abs(quantity * price), 2);
  }

  private resolveOrderReservedMargin(
    payload: Record<string, unknown> | null,
    notional: number | null
  ): number | null {
    const explicit =
      this.pickRecordNumber(payload, [
        'reserved_margin',
        'reservedMargin',
        'margin_required',
        'marginRequired',
        'required_margin',
        'requiredMargin',
        'margin_reserved',
        'marginReserved',
        'order_margin',
        'orderMargin',
        'initial_margin',
        'initialMargin',
      ]) ??
      this.pickRecordNumber(payload, ['used_margin', 'usedMargin', 'margin_used', 'marginUsed']);

    if (explicit !== null) {
      return this.roundNumber(Math.abs(explicit), 2);
    }

    const leverage = this.pickRecordNumber(payload, ['leverage']);
    if (notional !== null && leverage !== null && leverage > 0) {
      return this.roundNumber(Math.abs(notional) / leverage, 2);
    }

    return null;
  }

  private formatPercent(value: number): string {
    return `${this.roundNumber(value, Math.abs(value) >= 10 ? 0 : 1)}%`;
  }

  private formatCurrency(value: number): string {
    return `${value < 0 ? '-' : ''}${Math.abs(this.roundNumber(value)).toLocaleString('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    })}`;
  }

  private roundNumber(value: number, digits = 0): number {
    if (!Number.isFinite(value)) {
      return 0;
    }
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
  }

  private resolveLatestDate(values: Array<Date | null | undefined>): Date | null {
    let latest: Date | null = null;
    values.forEach((value) => {
      if (!value || Number.isNaN(value.getTime())) {
        return;
      }
      if (!latest || value.getTime() > latest.getTime()) {
        latest = value;
      }
    });
    return latest;
  }

  private parseDateLike(value: unknown): Date | null {
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value;
    }

    const normalized = String(value || '').trim();
    if (!normalized) {
      return null;
    }

    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private average(values: number[]): number | null {
    if (!values.length) {
      return null;
    }
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  private maxNumber(values: Array<number | null | undefined>): number | null {
    const normalized = values.filter(
      (value): value is number => value !== null && value !== undefined && Number.isFinite(value)
    );
    if (!normalized.length) {
      return null;
    }
    return this.roundNumber(Math.max(...normalized), 2);
  }

  private minNumber(values: Array<number | null | undefined>): number | null {
    const normalized = values.filter(
      (value): value is number => value !== null && value !== undefined && Number.isFinite(value)
    );
    if (!normalized.length) {
      return null;
    }
    return Math.min(...normalized);
  }

  private toFiniteNumber<T extends number | null>(value: unknown, fallback: T): number | T {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
  }

  private validateRiskPolicy(body: UpsertRiskPolicyBody): UpsertRiskPolicyBody {
    return validateUpsertRiskPolicyBody(body);
  }

  private async assertNoDuplicateRiskPolicyTarget(
    userId: string,
    policy: UpsertRiskPolicyBody,
    excludePolicyId?: string
  ): Promise<void> {
    const duplicate = await this.riskPolicyRepository.findConflictingPolicy(
      userId,
      policy,
      excludePolicyId
    );

    if (duplicate) {
      throw new ConflictAppError(this.buildDuplicateRiskPolicyMessage(policy));
    }
  }

  private buildDuplicateRiskPolicyMessage(
    policy: Pick<UpsertRiskPolicyBody, 'scope' | 'brokerKey'>
  ): string {
    if (policy.scope === 'broker') {
      const brokerLabel = String(policy.brokerKey || '').trim().toLowerCase() || 'the selected broker';
      return `A broker risk policy already exists for "${brokerLabel}". Update the existing broker policy instead of creating another one.`;
    }

    return 'A user-default risk policy already exists. Update the existing default policy instead of creating another one.';
  }

  private mapRiskPolicyPersistenceError(
    error: unknown,
    policy?: Pick<UpsertRiskPolicyBody, 'scope' | 'brokerKey'>
  ): Error {
    if (error instanceof ConflictAppError || error instanceof NotFoundAppError) {
      return error;
    }

    if (this.riskPolicyRepository.isDuplicatePolicyTargetError(error)) {
      return new ConflictAppError(
        this.buildDuplicateRiskPolicyMessage(
          policy || {
            scope: 'user',
            brokerKey: undefined,
          }
        )
      );
    }

    return error instanceof Error ? error : new Error(String(error));
  }

  private formatDisplayTime(
    value: Date | string | null | undefined,
    timeZone?: string
  ): string | undefined {
    return formatApiDisplayTime(value, timeZone);
  }

  private formatRawIso(value: Date | string | null | undefined): string | undefined {
    return formatApiRawIso(value);
  }

  private mapPolicy(
    policy: any,
    governance: Partial<RiskPolicyGovernanceSummary> = {},
    timeZone?: string
  ): RiskPolicyContract {
    const updatedAtIso = this.formatRawIso(policy.updatedAt) || String(policy.updatedAt);
    return {
      id: policy.id,
      scope: policy.scope,
      brokerKey: policy.brokerKey ?? undefined,
      mode: this.resolvePolicyMode(policy),
      enabled: policy.enabled,
      monitorOnly: policy.monitorOnly,
      enforceHardBlock: policy.enforceHardBlock,
      marginUsageWarnPct: policy.marginUsageWarnPct,
      marginUsageCriticalPct: policy.marginUsageCriticalPct,
      concentrationWarnPct: policy.concentrationWarnPct,
      concentrationCriticalPct: policy.concentrationCriticalPct,
      dailyLossLimitPct: policy.dailyLossLimitPct ?? undefined,
      weeklyLossLimitPct: policy.weeklyLossLimitPct ?? undefined,
      monthlyLossLimitPct: policy.monthlyLossLimitPct ?? undefined,
      maxLeverage: policy.maxLeverage ?? undefined,
      maxOrderAllocation: policy.maxOrderAllocation ?? undefined,
      maxTotalAllocation: policy.maxTotalAllocation ?? undefined,
      maxAvgLeverage: policy.maxAvgLeverage ?? undefined,
      approvalMode: governance.approvalMode || 'auto_approved',
      approvalState: governance.currentApprovalState || 'approved',
      pendingVersionId: governance.pendingVersionId,
      pendingVersionCount: governance.pendingVersionCount || 0,
      updatedAt: this.formatDisplayTime(updatedAtIso, timeZone) || updatedAtIso,
      updatedAtIso,
    };
  }

  private buildRequestedPolicySnapshot(
    policyId: string,
    policy: UpsertRiskPolicyBody
  ): RiskPolicyContract {
    return {
      id: policyId,
      scope: policy.scope,
      brokerKey: policy.brokerKey,
      mode: this.resolvePolicyMode(policy),
      enabled: policy.enabled,
      monitorOnly: policy.monitorOnly,
      enforceHardBlock: policy.enforceHardBlock,
      marginUsageWarnPct: policy.marginUsageWarnPct,
      marginUsageCriticalPct: policy.marginUsageCriticalPct,
      concentrationWarnPct: policy.concentrationWarnPct,
      concentrationCriticalPct: policy.concentrationCriticalPct,
      dailyLossLimitPct: policy.dailyLossLimitPct,
      weeklyLossLimitPct: policy.weeklyLossLimitPct,
      monthlyLossLimitPct: policy.monthlyLossLimitPct,
      maxLeverage: policy.maxLeverage,
      maxOrderAllocation: policy.maxOrderAllocation,
      maxTotalAllocation: policy.maxTotalAllocation,
      maxAvgLeverage: policy.maxAvgLeverage,
      approvalMode: 'auto_approved',
      approvalState: 'approved',
      pendingVersionCount: 0,
      updatedAt: new Date().toISOString(),
    };
  }

  private buildRiskPolicyVersionPayload(
    snapshot: RiskPolicyContract,
    actorUserId: string,
    operation: RiskPolicyVersionOperation,
    options: {
      reason?: string;
      rollbackFromVersionId?: string;
      approvalMode?: RiskPolicyApprovalMode;
      approvalState?: RiskPolicyApprovalState;
      reviewReason?: string;
      reviewedAt?: string;
      reviewedByUserId?: string;
    } = {}
  ): Record<string, unknown> {
    const approvalMode = options.approvalMode || 'auto_approved';
    const approvalState = options.approvalState || 'approved';
    const reviewedAt =
      options.reviewedAt ||
      (approvalState === 'approved' ? new Date().toISOString() : undefined);

    return {
      snapshot,
      lifecycle: {
        operation,
        reason: options.reason || undefined,
        approvalMode,
        approvalState,
        approvedAt: approvalState === 'approved' ? reviewedAt : undefined,
        approvedByUserId: approvalState === 'approved' ? actorUserId : undefined,
        reviewReason: options.reviewReason || undefined,
        reviewedAt: approvalState === 'approved' ? reviewedAt : options.reviewedAt || undefined,
        reviewedByUserId:
          approvalState === 'approved'
            ? actorUserId
            : options.reviewedByUserId || undefined,
        rollbackFromVersionId: options.rollbackFromVersionId || undefined,
      },
    };
  }

  private buildReviewedPolicyVersionPayload(
    version: ParsedRiskPolicyVersionRecord,
    options: {
      snapshot?: RiskPolicyContract;
      approvalState: RiskPolicyApprovalState;
      actorUserId: string;
      reviewReason?: string;
    }
  ): Record<string, unknown> {
    const reviewedAt = new Date().toISOString();

    return {
      snapshot: options.snapshot || version.snapshot,
      lifecycle: {
        operation: version.operation,
        reason: version.reason || undefined,
        approvalMode: version.approvalMode,
        approvalState: options.approvalState,
        approvedAt: options.approvalState === 'approved' ? reviewedAt : undefined,
        approvedByUserId: options.approvalState === 'approved' ? options.actorUserId : undefined,
        reviewReason: options.reviewReason || undefined,
        reviewedAt,
        reviewedByUserId: options.actorUserId,
        rollbackFromVersionId: version.rollbackFromVersionId || undefined,
      },
    };
  }

  private parsePolicyVersionRecords(
    versions: Array<{
      id: string;
      actorUserId: string;
      versionPayload: string;
      createdAt: Date;
      policyId?: string;
    }>
  ): ParsedRiskPolicyVersionRecord[] {
    return versions.map((version, index) =>
      this.parsePolicyVersionRecord(
        version,
        index === versions.length - 1 ? 'create' : 'update'
      )
    );
  }

  private summarizeRiskPolicyVersions(
    versions: ParsedRiskPolicyVersionRecord[]
  ): RiskPolicyGovernanceSummary {
    const currentApprovedVersion = versions.find((item) => item.approvalState === 'approved');
    const pendingVersions = versions.filter((item) => item.approvalState === 'pending_review');

    return {
      currentVersionId: currentApprovedVersion?.id,
      pendingVersionId: pendingVersions[0]?.id,
      pendingVersionCount: pendingVersions.length,
      approvalMode: pendingVersions.length
        ? 'manual_review'
        : currentApprovedVersion?.approvalMode || 'auto_approved',
      currentApprovalState: pendingVersions.length
        ? 'pending_review'
        : currentApprovedVersion?.approvalState || 'approved',
    };
  }

  private mapPolicyVersions(
    policyId: string,
    versions: ParsedRiskPolicyVersionRecord[],
    currentVersionId?: string,
    timeZone?: string
  ): RiskPolicyVersionItem[] {
    return versions.map((current, index) => {
      const previous = versions[index + 1];
      const changedFields = this.diffPolicySnapshots(current.snapshot, previous?.snapshot);
      const effective = Boolean(currentVersionId && current.id === currentVersionId);
      const createdAtIso = this.formatRawIso(current.createdAt) || current.createdAt;
      const approvedAtIso = this.formatRawIso(current.approvedAt);
      const reviewedAtIso = this.formatRawIso(current.reviewedAt);

      return {
        id: current.id,
        policyId,
        actorUserId: current.actorUserId,
        operation: current.operation,
        summary: this.buildPolicyVersionSummary(
          current.operation,
          current.snapshot,
          changedFields,
          current.approvalState
        ),
        reason: current.reason,
        approvalMode: current.approvalMode,
        approvalState: current.approvalState,
        approvedByUserId: current.approvedByUserId,
        reviewReason: current.reviewReason,
        reviewedByUserId: current.reviewedByUserId,
        rollbackFromVersionId: current.rollbackFromVersionId,
        changedFields,
        canRollback: current.approvalState === 'approved' && !effective,
        canApprove: current.approvalState === 'pending_review',
        canReject: current.approvalState === 'pending_review',
        effective,
        snapshot: this.mapPolicy(current.snapshot, {
          approvalMode: current.approvalMode,
          currentApprovalState: current.approvalState,
          pendingVersionCount: current.approvalState === 'pending_review' ? 1 : 0,
          pendingVersionId:
            current.approvalState === 'pending_review' ? current.id : undefined,
        }, timeZone),
        links: {
          activityPath: this.buildPolicyActivityPath(policyId),
          enforcementActivityPath: this.buildPolicyEnforcementActivityPath(policyId),
        },
        createdAt: this.formatDisplayTime(createdAtIso, timeZone) || createdAtIso,
        createdAtIso,
        approvedAt: this.formatDisplayTime(approvedAtIso, timeZone) || current.approvedAt,
        approvedAtIso: approvedAtIso || undefined,
        reviewedAt: this.formatDisplayTime(reviewedAtIso, timeZone) || current.reviewedAt,
        reviewedAtIso: reviewedAtIso || undefined,
      };
    });
  }

  private parsePolicyVersionRecord(
    version: {
      id: string;
      actorUserId: string;
      versionPayload: string;
      createdAt: Date;
      policyId?: string;
    },
    fallbackOperation: RiskPolicyVersionOperation
  ): ParsedRiskPolicyVersionRecord {
    const parsed = this.safeParsePolicyVersionPayload(version.versionPayload);
    const parsedRecord: Record<string, unknown> =
      parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    const rawSnapshot: Record<string, unknown> =
      parsed?.snapshot && typeof parsed.snapshot === 'object'
        ? (parsed.snapshot as Record<string, unknown>)
        : parsedRecord;

    const validatedSnapshot = this.validateRiskPolicy({
      scope: this.readScope(rawSnapshot.scope),
      brokerKey: this.readOptionalString(rawSnapshot.brokerKey),
      enabled: this.readBoolean(rawSnapshot.enabled, true),
      monitorOnly: this.readBoolean(rawSnapshot.monitorOnly, true),
      enforceHardBlock: this.readBoolean(rawSnapshot.enforceHardBlock, false),
      marginUsageWarnPct: this.readNumber(rawSnapshot.marginUsageWarnPct, 70),
      marginUsageCriticalPct: this.readNumber(rawSnapshot.marginUsageCriticalPct, 85),
      concentrationWarnPct: this.readNumber(rawSnapshot.concentrationWarnPct, 30),
      concentrationCriticalPct: this.readNumber(rawSnapshot.concentrationCriticalPct, 45),
      dailyLossLimitPct: this.readNumber(rawSnapshot.dailyLossLimitPct, 5),
      weeklyLossLimitPct: this.readNumber(rawSnapshot.weeklyLossLimitPct, 12),
      monthlyLossLimitPct: this.readNumber(rawSnapshot.monthlyLossLimitPct, 20),
      maxLeverage: this.readNullableNumber(rawSnapshot.maxLeverage),
      maxOrderAllocation: this.readNullableNumber(rawSnapshot.maxOrderAllocation),
      maxTotalAllocation: this.readNullableNumber(rawSnapshot.maxTotalAllocation),
      maxAvgLeverage: this.readNullableNumber(rawSnapshot.maxAvgLeverage),
    });

    const lifecycle: Record<string, unknown> =
      parsed?.lifecycle && typeof parsed.lifecycle === 'object'
        ? (parsed.lifecycle as Record<string, unknown>)
        : {};
    const operation = this.readVersionOperation(lifecycle?.operation, fallbackOperation);
    const approvalMode = this.readApprovalMode(lifecycle?.approvalMode);
    const approvalState = this.readApprovalState(lifecycle?.approvalState);
    const createdAt =
      version.createdAt instanceof Date
        ? version.createdAt.toISOString()
        : new Date(String(version.createdAt)).toISOString();

    return {
      id: version.id,
      actorUserId: version.actorUserId,
      operation,
      reason: this.readOptionalString(lifecycle?.reason),
      approvalMode,
      approvalState,
      approvedAt: approvalState === 'approved'
        ? this.readOptionalString(lifecycle?.approvedAt) || createdAt
        : undefined,
      approvedByUserId: approvalState === 'approved'
        ? this.readOptionalString(lifecycle?.approvedByUserId) || version.actorUserId
        : undefined,
      reviewReason: this.readOptionalString(lifecycle?.reviewReason),
      reviewedAt: this.readOptionalString(lifecycle?.reviewedAt),
      reviewedByUserId: this.readOptionalString(lifecycle?.reviewedByUserId),
      rollbackFromVersionId: this.readOptionalString(lifecycle?.rollbackFromVersionId) || undefined,
      snapshot: {
        id: this.readOptionalString(rawSnapshot.id) || version.policyId || '',
        scope: validatedSnapshot.scope,
        brokerKey: validatedSnapshot.brokerKey,
        mode: this.resolvePolicyMode(validatedSnapshot),
        enabled: validatedSnapshot.enabled,
        monitorOnly: validatedSnapshot.monitorOnly,
        enforceHardBlock: validatedSnapshot.enforceHardBlock,
        marginUsageWarnPct: validatedSnapshot.marginUsageWarnPct,
        marginUsageCriticalPct: validatedSnapshot.marginUsageCriticalPct,
        concentrationWarnPct: validatedSnapshot.concentrationWarnPct,
        concentrationCriticalPct: validatedSnapshot.concentrationCriticalPct,
        dailyLossLimitPct: validatedSnapshot.dailyLossLimitPct,
        weeklyLossLimitPct: validatedSnapshot.weeklyLossLimitPct,
        monthlyLossLimitPct: validatedSnapshot.monthlyLossLimitPct,
        maxLeverage: validatedSnapshot.maxLeverage,
        maxOrderAllocation: validatedSnapshot.maxOrderAllocation,
        maxTotalAllocation: validatedSnapshot.maxTotalAllocation,
        maxAvgLeverage: validatedSnapshot.maxAvgLeverage,
        approvalMode,
        approvalState,
        pendingVersionId:
          approvalState === 'pending_review'
            ? version.id
            : undefined,
        pendingVersionCount: approvalState === 'pending_review' ? 1 : 0,
        updatedAt: this.readOptionalString(rawSnapshot.updatedAt) || createdAt,
      },
      createdAt,
    };
  }

  private resolvePolicyMode(policy: {
    enabled?: boolean | null;
    monitorOnly?: boolean | null;
    enforceHardBlock?: boolean | null;
  }): RiskPolicyContract['mode'] {
    if (!policy?.enabled) {
      return 'disabled';
    }
    if (policy.monitorOnly) {
      return 'monitor';
    }
    if (policy.enforceHardBlock) {
      return 'hard_block';
    }
    return 'warn';
  }

  private safeParsePolicyVersionPayload(raw: string): StoredRiskPolicyVersionPayload | Record<string, unknown> {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  private buildPolicyVersionSummary(
    operation: RiskPolicyVersionOperation,
    snapshot: Pick<RiskPolicyContract, 'scope' | 'brokerKey'>,
    changedFields: string[],
    approvalState: RiskPolicyApprovalState
  ): string {
    if (approvalState === 'rejected') {
      return changedFields.length
        ? `Rejected ${changedFields.slice(0, 2).join(', ')}`
        : 'Rejected pending policy change';
    }

    if (approvalState === 'pending_review') {
      if (operation === 'create') {
        return `Submitted ${this.buildPolicyTargetLabel(snapshot)} policy for review`;
      }

      if (operation === 'rollback') {
        return changedFields.length
          ? `Submitted rollback of ${changedFields.slice(0, 2).join(', ')}`
          : 'Submitted rollback for review';
      }

      return changedFields.length
        ? `Submitted ${changedFields.slice(0, 2).join(', ')} for review`
        : 'Submitted policy changes for review';
    }

    if (operation === 'create') {
      return `Created ${this.buildPolicyTargetLabel(snapshot)} policy`;
    }

    if (operation === 'rollback') {
      return changedFields.length
        ? `Rolled back ${changedFields.slice(0, 2).join(', ')}`
        : 'Rolled back policy settings';
    }

    return changedFields.length
      ? `Updated ${changedFields.slice(0, 2).join(', ')}`
      : 'Updated policy settings';
  }

  private diffPolicySnapshots(
    current: RiskPolicyContract,
    previous?: RiskPolicyContract
  ): string[] {
    if (!previous) {
      return ['Initial policy snapshot'];
    }

    const comparisons: Array<[label: string, currentValue: unknown, previousValue: unknown]> = [
      ['Scope', current.scope, previous.scope],
      ['Broker', current.brokerKey || '', previous.brokerKey || ''],
      ['Enabled', current.enabled, previous.enabled],
      ['Monitor mode', current.monitorOnly, previous.monitorOnly],
      ['Hard block', current.enforceHardBlock, previous.enforceHardBlock],
      ['Margin warning', current.marginUsageWarnPct, previous.marginUsageWarnPct],
      ['Margin critical', current.marginUsageCriticalPct, previous.marginUsageCriticalPct],
      ['Concentration warning', current.concentrationWarnPct, previous.concentrationWarnPct],
      ['Concentration critical', current.concentrationCriticalPct, previous.concentrationCriticalPct],
      ['Daily loss limit', current.dailyLossLimitPct, previous.dailyLossLimitPct],
      ['Weekly loss limit', current.weeklyLossLimitPct, previous.weeklyLossLimitPct],
      ['Monthly loss limit', current.monthlyLossLimitPct, previous.monthlyLossLimitPct],
      ['Max leverage', current.maxLeverage ?? null, previous.maxLeverage ?? null],
      ['Per-trade max allocation', current.maxOrderAllocation ?? null, previous.maxOrderAllocation ?? null],
      ['Max total allocation', current.maxTotalAllocation ?? null, previous.maxTotalAllocation ?? null],
      ['Max avg leverage', current.maxAvgLeverage ?? null, previous.maxAvgLeverage ?? null],
    ];

    const changed = comparisons
      .filter(([, currentValue, previousValue]) => currentValue !== previousValue)
      .map(([label]) => label);

    return changed.length ? changed : ['No threshold changes'];
  }

  private async assertNoPendingRiskPolicyReview(
    userId: string,
    policyId: string,
    versions?: Array<{ id: string; actorUserId: string; versionPayload: string; createdAt: Date; policyId?: string }>
  ): Promise<void> {
    const currentVersions =
      versions || (await this.riskPolicyRepository.listPolicyVersions(userId, policyId));
    const parsed = this.parsePolicyVersionRecords(currentVersions);
    const pendingVersion = parsed.find((item) => item.approvalState === 'pending_review');

    if (pendingVersion) {
      throw new ConflictAppError(
        'A risk policy change is already pending review. Approve or reject it before submitting another change.'
      );
    }
  }

  private requiresManualRiskPolicyReview(
    current: RiskPolicyContract,
    next: UpsertRiskPolicyBody
  ): boolean {
    if (current.scope !== next.scope) {
      return true;
    }

    if (String(current.brokerKey || '').trim().toLowerCase() !== String(next.brokerKey || '').trim().toLowerCase()) {
      return true;
    }

    if (!current.enforceHardBlock && next.enforceHardBlock) {
      return true;
    }

    if (!current.enabled && next.enabled) {
      return true;
    }

    return [
      this.hasTighterConstraint(current.marginUsageWarnPct, next.marginUsageWarnPct),
      this.hasTighterConstraint(current.marginUsageCriticalPct, next.marginUsageCriticalPct),
      this.hasTighterConstraint(current.concentrationWarnPct, next.concentrationWarnPct),
      this.hasTighterConstraint(current.concentrationCriticalPct, next.concentrationCriticalPct),
      this.hasTighterConstraint(current.dailyLossLimitPct, next.dailyLossLimitPct),
      this.hasTighterConstraint(current.maxLeverage, next.maxLeverage),
      this.hasTighterConstraint(current.maxOrderAllocation, next.maxOrderAllocation),
      this.hasTighterConstraint(current.maxTotalAllocation, next.maxTotalAllocation),
      this.hasTighterConstraint(current.maxAvgLeverage, next.maxAvgLeverage),
    ].some(Boolean);
  }

  private hasTighterConstraint(
    currentValue: number | undefined,
    nextValue: number | undefined
  ): boolean {
    if (nextValue === undefined || nextValue === null) {
      return false;
    }

    if (currentValue === undefined || currentValue === null) {
      return true;
    }

    return nextValue < currentValue;
  }

  private buildPolicyActivityPath(policyId: string): string {
    return `/activity?route=Risk&referenceId=${encodeURIComponent(policyId)}`;
  }

  private buildPolicyEnforcementActivityPath(policyId: string): string {
    return `/activity?route=Risk&stream=Controls&referenceId=${encodeURIComponent(policyId)}`;
  }

  private buildPolicyTargetLabel(
    policy: Pick<UpsertRiskPolicyBody, 'scope' | 'brokerKey'>
  ): string {
    return policy.scope === 'broker'
      ? policy.brokerKey || 'broker'
      : 'user-default';
  }

  private readScope(value: unknown): UpsertRiskPolicyBody['scope'] {
    return String(value || '').trim().toLowerCase() === 'broker' ? 'broker' : 'user';
  }

  private readOptionalString(value: unknown): string | undefined {
    const normalized = String(value || '').trim();
    return normalized || undefined;
  }

  private readBoolean(value: unknown, fallback: boolean): boolean {
    if (typeof value === 'boolean') {
      return value;
    }
    return fallback;
  }

  private readNumber(value: unknown, fallback: number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  private readNullableNumber(value: unknown): number | undefined {
    if (value === null || value === undefined || value === '') {
      return undefined;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  private readApprovalMode(value: unknown): RiskPolicyApprovalMode {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized === 'manual_review' ? 'manual_review' : 'auto_approved';
  }

  private readApprovalState(value: unknown): RiskPolicyApprovalState {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'pending_review' || normalized === 'rejected') {
      return normalized;
    }
    return 'approved';
  }

  private readVersionOperation(
    value: unknown,
    fallback: RiskPolicyVersionOperation
  ): RiskPolicyVersionOperation {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'create' || normalized === 'update' || normalized === 'rollback') {
      return normalized;
    }
    return fallback;
  }
}
