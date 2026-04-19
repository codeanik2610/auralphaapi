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
  RiskAssetSnapshotItem,
  RiskAssetSnapshotsResponse,
  RiskAccountItem,
  RiskBrokerAssetSnapshotItem,
  RiskBrokerAssetSnapshotsResponse,
  RiskBrokerSnapshotItem,
  RiskBrokerSnapshotsResponse,
  RiskOrdersResponse,
  RiskOrderItem,
  RiskPositionsResponse,
  RiskPositionItem,
  RiskPolicyContextItem,
  RiskPolicyContextsResponse,
  RiskRuleEvaluationItem,
  RiskRuleEvaluationsResponse,
  RiskSnapshotDetailResponse,
  RiskSnapshotStorageDetail,
  RiskControlsResponse,
  RiskControlItem,
  RiskScenariosResponse,
  RiskScenarioItem,
  RiskSourceCoverageItem,
  RiskSourceCoverageResponse,
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
import {
  FundsSnapshotCoverageRow,
  FundsSnapshotRepository,
  FundsSnapshotRow,
} from '../../database/repositories/FundsSnapshotRepository';
import {
  PositionAccountFreshnessRow,
  PositionReadModelCoverageRow,
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
import {
  ComputedRiskAssetSnapshotPayload,
  RiskAssetSnapshotRepository,
} from '../../database/repositories/RiskAssetSnapshotRepository';
import { ComputedRiskAlertPayload } from '../../database/repositories/RiskAlertRepository';
import {
  ComputedRiskBrokerAssetSnapshotPayload,
  RiskBrokerAssetSnapshotRepository,
} from '../../database/repositories/RiskBrokerAssetSnapshotRepository';
import {
  ComputedRiskBrokerSnapshotPayload,
  RiskBrokerSnapshotRepository,
} from '../../database/repositories/RiskBrokerSnapshotRepository';
import { ComputedRiskControlPayload } from '../../database/repositories/RiskControlRepository';
import {
  ComputedRiskRuleEvaluationPayload,
  RiskRuleEvaluationRepository,
} from '../../database/repositories/RiskRuleEvaluationRepository';
import { ComputedRiskScenarioPayload } from '../../database/repositories/RiskScenarioRepository';
import {
  ComputedRiskSnapshotPolicyContextPayload,
  RiskSnapshotPolicyContextRepository,
} from '../../database/repositories/RiskSnapshotPolicyContextRepository';
import {
  ComputedRiskSnapshotSourceCoveragePayload,
  RiskSnapshotSourceCoverageRepository,
} from '../../database/repositories/RiskSnapshotSourceCoverageRepository';
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
import { RiskAccountSnapshot } from '../../database/entities/RiskAccountSnapshot';
import { RiskAssetSnapshot } from '../../database/entities/RiskAssetSnapshot';
import { RiskBrokerAssetSnapshot } from '../../database/entities/RiskBrokerAssetSnapshot';
import { RiskBrokerSnapshot } from '../../database/entities/RiskBrokerSnapshot';
import { RiskPolicy } from '../../database/entities/RiskPolicy';
import { RiskSnapshot } from '../../database/entities/RiskSnapshot';
import { RiskSnapshotPolicyContext } from '../../database/entities/RiskSnapshotPolicyContext';
import { RiskSnapshotSourceCoverage } from '../../database/entities/RiskSnapshotSourceCoverage';
import { RiskRuleEvaluation } from '../../database/entities/RiskRuleEvaluation';

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
  minLeverage: number | null;
  maxLeverage: number;
  minNotionalPerTrade: number | null;
  maxOrderAllocation: number | null;
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
  minLeverage?: number | null;
  maxLeverage?: number | null;
  minNotionalPerTrade?: number | null;
  maxOrderAllocation?: number | null;
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
  fundsCoverage: FundsSnapshotCoverageRow | null;
  walletBalance: number | null;
  futuresBalance: number | null;
  balance: number | null;
  positions: PositionRecord[];
  positionsFreshness: PositionAccountFreshnessRow | null;
  positionCoverage: PositionReadModelCoverageRow | null;
  thresholds: RiskThresholdProfile;
  policyContext: EffectiveRiskPolicyContext;
}

interface PositionRiskEvaluation {
  positionId: string;
  symbol: string;
  brokerKey: string;
  accountId: string;
  accountName: string;
  policyContextKey: string | null;
  sideKey: string | null;
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

interface EffectiveRiskPolicyContext {
  contextKey: string;
  policyId: string | null;
  policyScope: string;
  policyTargetKey: string;
  enabled: boolean;
  monitorOnly: boolean;
  enforceHardBlock: boolean;
  marginUsageWarnPct: number;
  marginUsageCriticalPct: number;
  concentrationWarnPct: number;
  concentrationCriticalPct: number;
  dailyLossLimitPct: number;
  weeklyLossLimitPct: number;
  monthlyLossLimitPct: number;
  minLeverage: number | null;
  maxLeverage: number | null;
  minNotionalPerTrade: number | null;
  maxOrderAllocation: number | null;
  maxTotalAllocation: number | null;
  maxAvgLeverage: number | null;
}

interface ComputedRiskBrokerSnapshotDraft extends Omit<ComputedRiskBrokerSnapshotPayload, 'policyContextId'> {
  policyContextKey: string | null;
}

interface ComputedRiskBrokerAssetSnapshotDraft
  extends Omit<ComputedRiskBrokerAssetSnapshotPayload, 'policyContextId'> {
  policyContextKey: string | null;
}

interface RiskComputationResult {
  snapshot: ComputedRiskSnapshotPayload;
  accountSnapshots: ComputedRiskAccountSnapshotPayload[];
  assetSnapshots: ComputedRiskAssetSnapshotPayload[];
  brokerSnapshots: ComputedRiskBrokerSnapshotDraft[];
  brokerAssetSnapshots: ComputedRiskBrokerAssetSnapshotDraft[];
  orderSnapshots: ComputedRiskOrderSnapshotPayload[];
  positionSnapshots: ComputedRiskPositionSnapshotPayload[];
  policyContexts: ComputedRiskSnapshotPolicyContextPayload[];
  sourceCoverage: ComputedRiskSnapshotSourceCoveragePayload[];
  ruleEvaluations: ComputedRiskRuleEvaluationPayload[];
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

  @Inject(() => RiskAssetSnapshotRepository)
  private riskAssetSnapshotRepository!: RiskAssetSnapshotRepository;

  @Inject(() => RiskBrokerAssetSnapshotRepository)
  private riskBrokerAssetSnapshotRepository!: RiskBrokerAssetSnapshotRepository;

  @Inject(() => RiskBrokerSnapshotRepository)
  private riskBrokerSnapshotRepository!: RiskBrokerSnapshotRepository;

  @Inject(() => RiskPositionSnapshotRepository)
  private riskPositionSnapshotRepository!: RiskPositionSnapshotRepository;

  @Inject(() => RiskOrderSnapshotRepository)
  private riskOrderSnapshotRepository!: RiskOrderSnapshotRepository;

  @Inject(() => RiskSnapshotPolicyContextRepository)
  private riskSnapshotPolicyContextRepository!: RiskSnapshotPolicyContextRepository;

  @Inject(() => RiskSnapshotSourceCoverageRepository)
  private riskSnapshotSourceCoverageRepository!: RiskSnapshotSourceCoverageRepository;

  @Inject(() => RiskControlRepository)
  private riskControlRepository!: RiskControlRepository;

  @Inject(() => RiskRuleEvaluationRepository)
  private riskRuleEvaluationRepository!: RiskRuleEvaluationRepository;

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

    const [accountSnapshots, policyContextRows, sourceCoverageRows] = await Promise.all([
      this.riskAccountSnapshotRepository.listBySnapshotId(snapshot.id),
      this.riskSnapshotPolicyContextRepository.listBySnapshotId(snapshot.id),
      this.riskSnapshotSourceCoverageRepository.listBySnapshotId(snapshot.id),
    ]);

    const items = this.mapRiskAccountItems(
      accountSnapshots,
      policyContextRows,
      sourceCoverageRows,
      timeZone
    );

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

  async getRiskBrokerSnapshots(
    userId: string,
    snapshotId?: string
  ): Promise<ApiSuccessResponse<RiskBrokerSnapshotsResponse>> {
    const [snapshot, timeZone] = await Promise.all([
      this.resolveRequestedRiskSnapshot(userId, snapshotId),
      this.userTimeZoneService.resolveUserTimeZone(userId),
    ]);

    if (!snapshot) {
      return successResponse({
        items: [],
        total: 0,
        time: buildApiTimeContract(timeZone),
      });
    }

    const rows = await this.riskBrokerSnapshotRepository.listBySnapshotId(snapshot.id);
    const items = this.mapRiskBrokerSnapshotItems(rows, snapshot, timeZone);

    return successResponse({
      items,
      total: items.length,
      snapshotId: snapshot.id,
      portfolioEquity: snapshot.portfolioEquity,
      time: buildApiTimeContract(timeZone),
    });
  }

  async getRiskAssetSnapshots(
    userId: string,
    snapshotId?: string
  ): Promise<ApiSuccessResponse<RiskAssetSnapshotsResponse>> {
    const [snapshot, timeZone] = await Promise.all([
      this.resolveRequestedRiskSnapshot(userId, snapshotId),
      this.userTimeZoneService.resolveUserTimeZone(userId),
    ]);

    if (!snapshot) {
      return successResponse({
        items: [],
        total: 0,
        time: buildApiTimeContract(timeZone),
      });
    }

    const rows = await this.riskAssetSnapshotRepository.listBySnapshotId(snapshot.id);
    const items = this.mapRiskAssetSnapshotItems(rows, snapshot, timeZone);

    return successResponse({
      items,
      total: items.length,
      snapshotId: snapshot.id,
      portfolioEquity: snapshot.portfolioEquity,
      time: buildApiTimeContract(timeZone),
    });
  }

  async getRiskBrokerAssetSnapshots(
    userId: string,
    snapshotId?: string
  ): Promise<ApiSuccessResponse<RiskBrokerAssetSnapshotsResponse>> {
    const [snapshot, timeZone] = await Promise.all([
      this.resolveRequestedRiskSnapshot(userId, snapshotId),
      this.userTimeZoneService.resolveUserTimeZone(userId),
    ]);

    if (!snapshot) {
      return successResponse({
        items: [],
        total: 0,
        time: buildApiTimeContract(timeZone),
      });
    }

    const [rows, brokerRows] = await Promise.all([
      this.riskBrokerAssetSnapshotRepository.listBySnapshotId(snapshot.id),
      this.riskBrokerSnapshotRepository.listBySnapshotId(snapshot.id),
    ]);
    const items = this.mapRiskBrokerAssetSnapshotItems(rows, brokerRows, snapshot, timeZone);

    return successResponse({
      items,
      total: items.length,
      snapshotId: snapshot.id,
      portfolioEquity: snapshot.portfolioEquity,
      time: buildApiTimeContract(timeZone),
    });
  }

  async getRiskPolicyContexts(
    userId: string,
    snapshotId?: string
  ): Promise<ApiSuccessResponse<RiskPolicyContextsResponse>> {
    const [snapshot, timeZone] = await Promise.all([
      this.resolveRequestedRiskSnapshot(userId, snapshotId),
      this.userTimeZoneService.resolveUserTimeZone(userId),
    ]);

    if (!snapshot) {
      return successResponse({
        items: [],
        total: 0,
        time: buildApiTimeContract(timeZone),
      });
    }

    const rows = await this.riskSnapshotPolicyContextRepository.listBySnapshotId(snapshot.id);
    const items = this.mapRiskPolicyContextItems(rows, timeZone);

    return successResponse({
      items,
      total: items.length,
      snapshotId: snapshot.id,
      time: buildApiTimeContract(timeZone),
    });
  }

  async getRiskSourceCoverage(
    userId: string,
    snapshotId?: string
  ): Promise<ApiSuccessResponse<RiskSourceCoverageResponse>> {
    const [snapshot, timeZone] = await Promise.all([
      this.resolveRequestedRiskSnapshot(userId, snapshotId),
      this.userTimeZoneService.resolveUserTimeZone(userId),
    ]);

    if (!snapshot) {
      return successResponse({
        items: [],
        total: 0,
        time: buildApiTimeContract(timeZone),
      });
    }

    const rows = await this.riskSnapshotSourceCoverageRepository.listBySnapshotId(snapshot.id);
    const items = this.mapRiskSourceCoverageItems(rows, timeZone);

    return successResponse({
      items,
      total: items.length,
      snapshotId: snapshot.id,
      time: buildApiTimeContract(timeZone),
    });
  }

  async getRiskRuleEvaluations(
    userId: string,
    snapshotId?: string
  ): Promise<ApiSuccessResponse<RiskRuleEvaluationsResponse>> {
    const [snapshot, timeZone] = await Promise.all([
      this.resolveRequestedRiskSnapshot(userId, snapshotId),
      this.userTimeZoneService.resolveUserTimeZone(userId),
    ]);

    if (!snapshot) {
      return successResponse({
        items: [],
        total: 0,
        time: buildApiTimeContract(timeZone),
      });
    }

    const rows = await this.riskRuleEvaluationRepository.listBySnapshotId(snapshot.id);
    const items = this.mapRiskRuleEvaluationItems(rows, timeZone);

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
      ruleEvaluationRows,
      brokerSnapshotRows,
      assetSnapshotRows,
      brokerAssetSnapshotRows,
      policyContextRows,
      sourceCoverageRows,
    ] = await Promise.all([
      this.riskRepository.getPreviousSnapshot(userId, snapshot),
      this.riskAccountSnapshotRepository.listBySnapshotId(snapshot.id),
      this.riskPositionSnapshotRepository.listBySnapshotId(snapshot.id),
      this.riskOrderSnapshotRepository.listBySnapshotId(snapshot.id),
      this.riskControlRepository.listBySnapshotId(userId, snapshot.id),
      this.riskAlertRepository.listBySnapshotId(userId, snapshot.id),
      this.riskScenarioRepository.listBySnapshotId(userId, snapshot.id),
      this.riskRuleEvaluationRepository.listBySnapshotId(snapshot.id),
      this.riskBrokerSnapshotRepository.listBySnapshotId(snapshot.id),
      this.riskAssetSnapshotRepository.listBySnapshotId(snapshot.id),
      this.riskBrokerAssetSnapshotRepository.listBySnapshotId(snapshot.id),
      this.riskSnapshotPolicyContextRepository.listBySnapshotId(snapshot.id),
      this.riskSnapshotSourceCoverageRepository.listBySnapshotId(snapshot.id),
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

    const accounts = this.mapRiskAccountItems(
      accountSnapshots,
      policyContextRows,
      sourceCoverageRows,
      timeZone
    );

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

    const controls =
      ruleEvaluationRows.length > 0
        ? this.mapRiskControlItemsFromEvaluations(ruleEvaluationRows, timeZone)
        : this.mapLegacyRiskControlItems(controlRows, timeZone);

    const alerts =
      ruleEvaluationRows.length > 0
        ? this.mapRiskAlertItemsFromEvaluations(ruleEvaluationRows, timeZone)
        : this.mapLegacyRiskAlertItems(alertRows, timeZone);

    const scenarios: RiskScenarioItem[] = scenarioRows.map((item) => ({
      id: item.id,
      snapshotId: item.snapshotId,
      scenario: item.scenario,
      impact: item.impact,
      commentary: item.commentary,
      createdAt: this.formatDisplayTime(item.createdAt, timeZone) || String(item.createdAt),
      createdAtIso: this.formatRawIso(item.createdAt) || undefined,
    }));

    const storage = this.buildRiskSnapshotStorageDetail(
      snapshot,
      brokerSnapshotRows,
      assetSnapshotRows,
      brokerAssetSnapshotRows,
      policyContextRows,
      sourceCoverageRows,
      ruleEvaluationRows,
      timeZone
    );

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
      storage,
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

  private mapRiskAccountItems(
    accountSnapshots: RiskAccountSnapshot[],
    policyContextRows: RiskSnapshotPolicyContext[],
    sourceCoverageRows: RiskSnapshotSourceCoverage[],
    timeZone: string
  ): RiskAccountItem[] {
    const { defaultPolicyContext, brokerPolicyContextByKey } =
      this.buildPolicyContextLookup(policyContextRows);
    const sourceCoverageByAccountId = new Map(
      sourceCoverageRows.map((item) => [String(item.accountId || '').trim(), item] as const)
    );

    return accountSnapshots.map((item) => {
      const brokerKey = String(item.brokerKey || '').trim().toLowerCase();
      const policyContext =
        brokerPolicyContextByKey.get(brokerKey) || defaultPolicyContext || null;
      const sourceCoverage =
        sourceCoverageByAccountId.get(String(item.accountId || '').trim()) || null;

      const fundsObservedAt = sourceCoverage?.latestFundsObservedAt ?? item.fundsObservedAt;
      const positionsObservedAt = sourceCoverage?.positionsObservedAt ?? item.positionsObservedAt;
      const ordersObservedAt = sourceCoverage?.latestOrderSeenAt ?? item.ordersObservedAt;

      return {
        id: item.id,
        snapshotId: item.snapshotId,
        brokerKey: item.brokerKey,
        accountId: item.accountId,
        accountName: sourceCoverage?.accountName || item.accountName,
        policyContextId: policyContext?.id ?? null,
        sourceCoverageId: sourceCoverage?.id ?? null,
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
        marginUsageWarnPct: policyContext?.marginUsageWarnPct ?? item.marginUsageWarnPct,
        marginUsageCriticalPct:
          policyContext?.marginUsageCriticalPct ?? item.marginUsageCriticalPct,
        concentrationWarnPct: policyContext?.concentrationWarnPct ?? item.concentrationWarnPct,
        concentrationCriticalPct:
          policyContext?.concentrationCriticalPct ?? item.concentrationCriticalPct,
        dailyLossLimitPct: policyContext?.dailyLossLimitPct ?? item.dailyLossLimitPct,
        weeklyLossLimitPct: policyContext?.weeklyLossLimitPct ?? item.weeklyLossLimitPct,
        monthlyLossLimitPct: policyContext?.monthlyLossLimitPct ?? item.monthlyLossLimitPct,
        maxLeverage: policyContext?.maxLeverage ?? item.maxLeverage,
        maxTotalAllocation: policyContext?.maxTotalAllocation ?? item.maxTotalAllocation,
        maxAvgLeverage: policyContext?.maxAvgLeverage ?? item.maxAvgLeverage,
        fundsObservedAt: this.formatDisplayTime(fundsObservedAt, timeZone) || null,
        fundsObservedAtIso: this.formatRawIso(fundsObservedAt) || null,
        positionsObservedAt: this.formatDisplayTime(positionsObservedAt, timeZone) || null,
        positionsObservedAtIso: this.formatRawIso(positionsObservedAt) || null,
        ordersObservedAt: this.formatDisplayTime(ordersObservedAt, timeZone) || null,
        ordersObservedAtIso: this.formatRawIso(ordersObservedAt) || null,
        createdAt: this.formatDisplayTime(item.createdAt, timeZone) || item.createdAt.toISOString(),
        createdAtIso: this.formatRawIso(item.createdAt) || undefined,
      };
    });
  }

  private mapRiskBrokerSnapshotItems(
    rows: RiskBrokerSnapshot[],
    snapshot: RiskSnapshot,
    timeZone: string
  ): RiskBrokerSnapshotItem[] {
    return rows
      .map((item) => ({
        id: item.id,
        snapshotId: item.snapshotId,
        brokerKey: item.brokerKey,
        policyContextId: item.policyContextId,
        accountCount: item.accountCount,
        trackedBalance: item.trackedBalance,
        walletBalance: item.walletBalance,
        futuresBalance: item.futuresBalance,
        grossExposure: item.grossExposure,
        netExposure: item.netExposure,
        longExposure: item.longExposure,
        shortExposure: item.shortExposure,
        openPositions: item.openPositions,
        openOrders: item.openOrders,
        openOrderExposure: item.openOrderExposure,
        reservedOrderMargin: item.reservedOrderMargin,
        unrealizedPnl: item.unrealizedPnl,
        realizedPnl: item.realizedPnl,
        weightedAvgLeverage: item.weightedAvgLeverage,
        maxLeverage: item.maxLeverage,
        worstLiquidationDistancePct: item.worstLiquidationDistancePct,
        marginUsagePct: this.toRatioPct(item.grossExposure, item.trackedBalance) ?? undefined,
        portfolioAllocationPct:
          this.toRatioPct(item.grossExposure, snapshot.portfolioEquity) ?? undefined,
        riskScore: item.riskScore,
        riskState: item.riskState,
        primaryConcern: item.primaryConcern,
        createdAt: this.formatDisplayTime(item.createdAt, timeZone) || item.createdAt.toISOString(),
        createdAtIso: this.formatRawIso(item.createdAt) || undefined,
      }))
      .sort((left, right) =>
        this.compareRiskSeverityRows(left, right, (item) => item.brokerKey)
      );
  }

  private mapRiskAssetSnapshotItems(
    rows: RiskAssetSnapshot[],
    snapshot: RiskSnapshot,
    timeZone: string
  ): RiskAssetSnapshotItem[] {
    return rows
      .map((item) => ({
        id: item.id,
        snapshotId: item.snapshotId,
        symbol: item.symbol,
        accountCount: item.accountCount,
        brokerCount: item.brokerCount,
        positionCount: item.positionCount,
        openOrders: item.openOrders,
        openOrderExposure: item.openOrderExposure,
        reservedOrderMargin: item.reservedOrderMargin,
        grossExposure: item.grossExposure,
        netExposure: item.netExposure,
        longExposure: item.longExposure,
        shortExposure: item.shortExposure,
        unrealizedPnl: item.unrealizedPnl,
        realizedPnl: item.realizedPnl,
        weightedAvgLeverage: item.weightedAvgLeverage,
        maxLeverage: item.maxLeverage,
        worstLiquidationDistancePct: item.worstLiquidationDistancePct,
        allocationPct: this.toRatioPct(item.grossExposure, snapshot.portfolioEquity) ?? undefined,
        riskScore: item.riskScore,
        riskState: item.riskState,
        primaryConcern: item.primaryConcern,
        createdAt: this.formatDisplayTime(item.createdAt, timeZone) || item.createdAt.toISOString(),
        createdAtIso: this.formatRawIso(item.createdAt) || undefined,
      }))
      .sort((left, right) =>
        this.compareRiskSeverityRows(left, right, (item) => item.symbol)
      );
  }

  private mapRiskBrokerAssetSnapshotItems(
    rows: RiskBrokerAssetSnapshot[],
    brokerRows: RiskBrokerSnapshot[],
    snapshot: RiskSnapshot,
    timeZone: string
  ): RiskBrokerAssetSnapshotItem[] {
    const brokerBalanceByKey = new Map(
      brokerRows.map((item) => [item.brokerKey, item.trackedBalance] as const)
    );

    return rows
      .map((item) => ({
        id: item.id,
        snapshotId: item.snapshotId,
        brokerKey: item.brokerKey,
        symbol: item.symbol,
        policyContextId: item.policyContextId,
        accountCount: item.accountCount,
        positionCount: item.positionCount,
        openOrders: item.openOrders,
        openOrderExposure: item.openOrderExposure,
        reservedOrderMargin: item.reservedOrderMargin,
        grossExposure: item.grossExposure,
        netExposure: item.netExposure,
        longExposure: item.longExposure,
        shortExposure: item.shortExposure,
        unrealizedPnl: item.unrealizedPnl,
        realizedPnl: item.realizedPnl,
        weightedAvgLeverage: item.weightedAvgLeverage,
        maxLeverage: item.maxLeverage,
        worstLiquidationDistancePct: item.worstLiquidationDistancePct,
        allocationPct: this.toRatioPct(item.grossExposure, snapshot.portfolioEquity) ?? undefined,
        marginUsagePct:
          this.toRatioPct(item.grossExposure, brokerBalanceByKey.get(item.brokerKey) ?? null) ??
          undefined,
        riskScore: item.riskScore,
        riskState: item.riskState,
        primaryConcern: item.primaryConcern,
        createdAt: this.formatDisplayTime(item.createdAt, timeZone) || item.createdAt.toISOString(),
        createdAtIso: this.formatRawIso(item.createdAt) || undefined,
      }))
      .sort((left, right) =>
        this.compareRiskSeverityRows(left, right, (item) => `${item.brokerKey}|${item.symbol}`)
      );
  }

  private mapRiskPolicyContextItems(
    rows: RiskSnapshotPolicyContext[],
    timeZone: string
  ): RiskPolicyContextItem[] {
    return [...rows]
      .sort((left, right) => {
        const scopeDiff =
          this.resolvePolicyScopeRank(left.policyScope) - this.resolvePolicyScopeRank(right.policyScope);
        if (scopeDiff !== 0) {
          return scopeDiff;
        }

        const targetDiff = String(left.policyTargetKey || '').localeCompare(
          String(right.policyTargetKey || '')
        );
        if (targetDiff !== 0) {
          return targetDiff;
        }

        return String(left.contextKey || '').localeCompare(String(right.contextKey || ''));
      })
      .map((item) => ({
        id: item.id,
        snapshotId: item.snapshotId,
        contextKey: item.contextKey,
        policyId: item.policyId,
        policyScope: item.policyScope,
        policyTargetKey: item.policyTargetKey,
        enabled: item.enabled,
        monitorOnly: item.monitorOnly,
        enforceHardBlock: item.enforceHardBlock,
        marginUsageWarnPct: item.marginUsageWarnPct,
        marginUsageCriticalPct: item.marginUsageCriticalPct,
        concentrationWarnPct: item.concentrationWarnPct,
        concentrationCriticalPct: item.concentrationCriticalPct,
        dailyLossLimitPct: item.dailyLossLimitPct,
        weeklyLossLimitPct: item.weeklyLossLimitPct,
        monthlyLossLimitPct: item.monthlyLossLimitPct,
        minLeverage: item.minLeverage,
        maxLeverage: item.maxLeverage,
        minNotionalPerTrade: item.minNotionalPerTrade,
        maxOrderAllocation: item.maxOrderAllocation,
        maxTotalAllocation: item.maxTotalAllocation,
        maxAvgLeverage: item.maxAvgLeverage,
        createdAt: this.formatDisplayTime(item.createdAt, timeZone) || item.createdAt.toISOString(),
        createdAtIso: this.formatRawIso(item.createdAt) || undefined,
      }));
  }

  private mapRiskSourceCoverageItems(
    rows: RiskSnapshotSourceCoverage[],
    timeZone: string
  ): RiskSourceCoverageItem[] {
    return [...rows]
      .sort((left, right) => {
        const brokerDiff = String(left.brokerKey || '').localeCompare(String(right.brokerKey || ''));
        if (brokerDiff !== 0) {
          return brokerDiff;
        }
        const accountDiff = String(left.accountName || '').localeCompare(String(right.accountName || ''));
        if (accountDiff !== 0) {
          return accountDiff;
        }
        return String(left.accountId || '').localeCompare(String(right.accountId || ''));
      })
      .map((item) => ({
        id: item.id,
        snapshotId: item.snapshotId,
        brokerKey: item.brokerKey,
        accountId: item.accountId,
        accountName: item.accountName,
        latestFundsSnapshotId: item.latestFundsSnapshotId,
        latestFundsSnapshotDate: item.latestFundsSnapshotDate,
        latestFundsObservedAt: this.formatDisplayTime(item.latestFundsObservedAt, timeZone) || null,
        latestFundsObservedAtIso: this.formatRawIso(item.latestFundsObservedAt) || null,
        latestFundsComputedAt: this.formatDisplayTime(item.latestFundsComputedAt, timeZone) || null,
        latestFundsComputedAtIso: this.formatRawIso(item.latestFundsComputedAt) || null,
        latestFundsLastAttemptAt:
          this.formatDisplayTime(item.latestFundsLastAttemptAt, timeZone) || null,
        latestFundsLastAttemptAtIso: this.formatRawIso(item.latestFundsLastAttemptAt) || null,
        latestFundsFetchStatus: item.latestFundsFetchStatus,
        latestFundsErrorMessage: item.latestFundsErrorMessage,
        latestFundsSource: item.latestFundsSource,
        latestWalletAvailable: item.latestWalletAvailable,
        latestFuturesAvailable: item.latestFuturesAvailable,
        latestSuccessFundsSnapshotId: item.latestSuccessFundsSnapshotId,
        latestSuccessFundsSnapshotDate: item.latestSuccessFundsSnapshotDate,
        latestSuccessFundsObservedAt:
          this.formatDisplayTime(item.latestSuccessFundsObservedAt, timeZone) || null,
        latestSuccessFundsObservedAtIso: this.formatRawIso(item.latestSuccessFundsObservedAt) || null,
        latestSuccessFundsComputedAt:
          this.formatDisplayTime(item.latestSuccessFundsComputedAt, timeZone) || null,
        latestSuccessFundsComputedAtIso:
          this.formatRawIso(item.latestSuccessFundsComputedAt) || null,
        latestSuccessFundsSource: item.latestSuccessFundsSource,
        latestSuccessWalletAvailable: item.latestSuccessWalletAvailable,
        latestSuccessFuturesAvailable: item.latestSuccessFuturesAvailable,
        positionsObservedAt: this.formatDisplayTime(item.positionsObservedAt, timeZone) || null,
        positionsObservedAtIso: this.formatRawIso(item.positionsObservedAt) || null,
        positionsCheckpointAt: this.formatDisplayTime(item.positionsCheckpointAt, timeZone) || null,
        positionsCheckpointAtIso: this.formatRawIso(item.positionsCheckpointAt) || null,
        openPositions: item.openPositions,
        positionTotalRows: item.positionTotalRows,
        positionSnapshotRows: item.positionSnapshotRows,
        positionReadModelRows: item.positionReadModelRows,
        rowsMissingFromReadModel: item.rowsMissingFromReadModel,
        rowsBehindSnapshot: item.rowsBehindSnapshot,
        orphanReadModelRows: item.orphanReadModelRows,
        latestPositionSnapshotSeenAt:
          this.formatDisplayTime(item.latestPositionSnapshotSeenAt, timeZone) || null,
        latestPositionSnapshotSeenAtIso:
          this.formatRawIso(item.latestPositionSnapshotSeenAt) || null,
        latestPositionReadModelSeenAt:
          this.formatDisplayTime(item.latestPositionReadModelSeenAt, timeZone) || null,
        latestPositionReadModelSeenAtIso:
          this.formatRawIso(item.latestPositionReadModelSeenAt) || null,
        openOrderRows: item.openOrderRows,
        latestOrderSeenAt: this.formatDisplayTime(item.latestOrderSeenAt, timeZone) || null,
        latestOrderSeenAtIso: this.formatRawIso(item.latestOrderSeenAt) || null,
        createdAt: this.formatDisplayTime(item.createdAt, timeZone) || item.createdAt.toISOString(),
        createdAtIso: this.formatRawIso(item.createdAt) || undefined,
      }));
  }

  private mapLegacyRiskControlItems(
    rows: Array<{
      id: string;
      snapshotId: string;
      bucket: string;
      exposure: string;
      threshold: string;
      status: string;
      action: string;
      createdAt: Date;
    }>,
    timeZone: string
  ): RiskControlItem[] {
    return rows.map((item) => ({
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
  }

  private mapLegacyRiskAlertItems(
    rows: Array<{
      id: string;
      snapshotId: string;
      severity: string;
      message: string;
      symbol: string;
      channel?: string | null;
      status?: string | null;
      createdAt: Date;
    }>,
    timeZone: string
  ): RiskAlertItem[] {
    return rows.map((item) => ({
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
  }

  private mapRiskRuleEvaluationItems(
    rows: RiskRuleEvaluation[],
    timeZone: string
  ): RiskRuleEvaluationItem[] {
    return rows.map((item) => ({
        id: item.id,
        snapshotId: item.snapshotId,
        policyContextId: item.policyContextId,
        sourceType: item.sourceType,
        scopeType: item.scopeType,
        scopeKey: item.scopeKey,
        scopeLabel: item.scopeLabel,
        brokerKey: item.brokerKey,
        accountId: item.accountId,
        positionId: item.positionId,
        symbol: item.symbol,
        ruleCode: item.ruleCode,
        metricName: item.metricName,
        actualValue: item.actualValue,
        basisValue: item.basisValue,
        warnThresholdValue: item.warnThresholdValue,
        criticalThresholdValue: item.criticalThresholdValue,
        status: item.status,
        bucket: item.bucket,
        exposure: item.exposure,
        threshold: item.threshold,
        action: item.action,
        alertSeverity: item.alertSeverity,
        alertMessage: item.alertMessage,
        alertSymbol: item.alertSymbol,
        alertChannel: item.alertChannel,
        alertStatus: item.alertStatus,
        sortOrder: item.sortOrder,
        createdAt: this.formatDisplayTime(item.createdAt, timeZone) || item.createdAt.toISOString(),
        createdAtIso: this.formatRawIso(item.createdAt) || undefined,
      }));
  }

  private mapRiskControlItemsFromEvaluations(
    rows: RiskRuleEvaluation[],
    timeZone: string
  ): RiskControlItem[] {
    return this.mapRiskRuleEvaluationItems(
      rows.filter((item) => String(item.sourceType || '').trim().toLowerCase() === 'control'),
      timeZone
    ).map((item) => ({
      id: item.id,
      snapshotId: item.snapshotId,
      bucket: item.bucket || '--',
      exposure: item.exposure || '--',
      threshold: item.threshold || '--',
      status: item.status,
      action: item.action || '--',
      createdAt: item.createdAt,
      createdAtIso: item.createdAtIso,
    }));
  }

  private mapRiskAlertItemsFromEvaluations(
    rows: RiskRuleEvaluation[],
    timeZone: string
  ): RiskAlertItem[] {
    return this.mapRiskRuleEvaluationItems(
      rows.filter(
        (item) =>
          String(item.alertSeverity || '').trim() &&
          String(item.alertMessage || '').trim()
      ),
      timeZone
    ).map((item) => ({
      id: item.id,
      snapshotId: item.snapshotId,
      severity: item.alertSeverity || '--',
      message: item.alertMessage || '--',
      symbol: item.alertSymbol || 'PORTFOLIO',
      channel: item.alertChannel || undefined,
      status: item.alertStatus || undefined,
      createdAt: item.createdAt,
      createdAtIso: item.createdAtIso,
    }));
  }

  private buildRiskSnapshotStorageDetail(
    snapshot: RiskSnapshot,
    brokerRows: RiskBrokerSnapshot[],
    assetRows: RiskAssetSnapshot[],
    brokerAssetRows: RiskBrokerAssetSnapshot[],
    policyContextRows: RiskSnapshotPolicyContext[],
    sourceCoverageRows: RiskSnapshotSourceCoverage[],
    ruleEvaluationRows: RiskRuleEvaluation[],
    timeZone: string
  ): RiskSnapshotStorageDetail {
    const brokers = this.mapRiskBrokerSnapshotItems(brokerRows, snapshot, timeZone);
    const assets = this.mapRiskAssetSnapshotItems(assetRows, snapshot, timeZone);
    const brokerAssets = this.mapRiskBrokerAssetSnapshotItems(
      brokerAssetRows,
      brokerRows,
      snapshot,
      timeZone
    );
    const policyContexts = this.mapRiskPolicyContextItems(policyContextRows, timeZone);
    const sourceCoverage = this.mapRiskSourceCoverageItems(sourceCoverageRows, timeZone);
    const ruleEvaluations = this.mapRiskRuleEvaluationItems(ruleEvaluationRows, timeZone);

    return {
      brokers,
      assets,
      brokerAssets,
      policyContexts,
      sourceCoverage,
      ruleEvaluations,
      counts: {
        brokers: brokers.length,
        assets: assets.length,
        brokerAssets: brokerAssets.length,
        policyContexts: policyContexts.length,
        sourceCoverage: sourceCoverage.length,
        ruleEvaluations: ruleEvaluations.length,
      },
    };
  }

  async getRiskAlerts(
    userId: string,
    query: { limit?: string; offset?: string; status?: string; scope?: string }
  ): Promise<ApiSuccessResponse<RiskAlertsResponse>> {
    const params = validateRiskAlertsQuery(query);
    const timeZone = await this.userTimeZoneService.resolveUserTimeZone(userId);
    const normalized = await this.riskRuleEvaluationRepository.listRiskAlerts(userId, params);
    const hasNormalizedAlerts =
      normalized.total > 0 ||
      Boolean(await this.riskRuleEvaluationRepository.getLatestCreatedAtForUsers([userId]));
    const legacy =
      hasNormalizedAlerts ? null : await this.riskAlertRepository.listRiskAlerts(userId, params);

    const mapped =
      hasNormalizedAlerts
        ? this.mapRiskAlertItemsFromEvaluations(normalized.items, timeZone)
        : this.mapLegacyRiskAlertItems(legacy?.items || [], timeZone);
    const total = hasNormalizedAlerts ? normalized.total : legacy?.total || 0;

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
    const summary = await this.riskRuleEvaluationRepository.getRiskAlertsSummary(userId, params);
    const hasNormalizedAlerts =
      summary.total > 0 ||
      Boolean(await this.riskRuleEvaluationRepository.getLatestCreatedAtForUsers([userId]));
    if (hasNormalizedAlerts) {
      return successResponse(summary);
    }

    return successResponse(await this.riskAlertRepository.getRiskAlertsSummary(userId, params));
  }

  async getRiskControls(
    userId: string,
    query: { limit?: string; offset?: string; status?: string; scope?: string }
  ): Promise<ApiSuccessResponse<RiskControlsResponse>> {
    const params = validateRiskControlsQuery(query);
    const timeZone = await this.userTimeZoneService.resolveUserTimeZone(userId);
    const normalized = await this.riskRuleEvaluationRepository.listRiskControls(userId, params);
    const hasNormalizedControls =
      normalized.total > 0 ||
      Boolean(await this.riskRuleEvaluationRepository.getLatestControlCreatedAtForUsers([userId]));
    const legacy =
      hasNormalizedControls ? null : await this.riskControlRepository.listRiskControls(userId, params);

    const mapped =
      hasNormalizedControls
        ? this.mapRiskControlItemsFromEvaluations(normalized.items, timeZone)
        : this.mapLegacyRiskControlItems(legacy?.items || [], timeZone);
    const total = hasNormalizedControls ? normalized.total : legacy?.total || 0;

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
    const createdPolicyContexts = await this.riskSnapshotPolicyContextRepository.createComputedPolicyContexts(
      userId,
      snapshot.id,
      computed.policyContexts
    );
    const policyContextIdByKey = new Map(
      createdPolicyContexts.map((context) => [context.contextKey, context.id] as const)
    );
    const [
      accountSnapshotsCreated,
      assetSnapshotsCreated,
      brokerSnapshotsCreated,
      brokerAssetSnapshotsCreated,
      orderSnapshotsCreated,
      positionSnapshotsCreated,
      sourceCoverageCreated,
      ruleEvaluationsCreated,
      controlsCreated,
      alertsCreated,
      scenariosCreated,
    ] = await Promise.all([
      this.riskAccountSnapshotRepository.createComputedAccountSnapshots(
        userId,
        snapshot.id,
        computed.accountSnapshots
      ),
      this.riskAssetSnapshotRepository.createComputedAssetSnapshots(
        userId,
        snapshot.id,
        computed.assetSnapshots
      ),
      this.riskBrokerSnapshotRepository.createComputedBrokerSnapshots(
        userId,
        snapshot.id,
        computed.brokerSnapshots.map(({ policyContextKey, ...item }) => ({
          ...item,
          policyContextId: policyContextKey
            ? policyContextIdByKey.get(policyContextKey) || null
            : null,
        }))
      ),
      this.riskBrokerAssetSnapshotRepository.createComputedBrokerAssetSnapshots(
        userId,
        snapshot.id,
        computed.brokerAssetSnapshots.map(({ policyContextKey, ...item }) => ({
          ...item,
          policyContextId: policyContextKey
            ? policyContextIdByKey.get(policyContextKey) || null
            : null,
        }))
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
      this.riskSnapshotSourceCoverageRepository.createComputedSourceCoverage(
        userId,
        snapshot.id,
        computed.sourceCoverage
      ),
      this.riskRuleEvaluationRepository.createComputedRuleEvaluations(
        userId,
        snapshot.id,
        computed.ruleEvaluations.map(({ policyContextKey, ...item }) => ({
          ...item,
          policyContextId:
            policyContextKey && policyContextIdByKey.has(policyContextKey)
              ? policyContextIdByKey.get(policyContextKey) || null
              : null,
        }))
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
      description: `Persisted risk snapshot with ${createdPolicyContexts.length} policy contexts, ${sourceCoverageCreated} source coverage rows, ${brokerSnapshotsCreated} broker rows, ${assetSnapshotsCreated} asset rows, ${brokerAssetSnapshotsCreated} broker-asset rows, ${accountSnapshotsCreated} account rows, ${orderSnapshotsCreated} order rows, ${positionSnapshotsCreated} position rows, ${ruleEvaluationsCreated} rule evaluations, ${controlsCreated} controls, ${alertsCreated} alerts, and ${scenariosCreated} scenarios.`,
    });

    return successResponse({
      message: 'Risk snapshot recomputed',
      computedAt: this.formatDisplayTime(snapshot.createdAt, timeZone) || snapshot.createdAt.toISOString(),
      computedAtIso: this.formatRawIso(snapshot.createdAt) || undefined,
      equity: computed.equity,
      snapshotId: snapshot.id,
      portfolioRisk: computed.snapshot.portfolioRisk,
      orderSnapshotsCreated,
      ruleEvaluationsCreated,
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
    const [fundsCoverageRows, livePositionsByAccount, positionCoverageByAccount, positionFreshnessByAccount, openOrdersByAccount] = accountIds.length
      ? await Promise.all([
          this.fundsSnapshotRepository.listLatestAccountCoverage(userId),
          this.positionReadModelRepository.listLivePositionsForAccounts(userId, accountIds),
          this.positionReadModelRepository.getReadModelCoverageByAccountIds(accountIds),
          this.positionReadModelRepository.getAccountFreshness(userId, accountIds),
          this.ordersSnapshotSourceRepository.listOpenOrdersForAccounts(userId, accountIds),
        ])
      : [
          [],
          new Map<string, PositionRecord[]>(),
          new Map<string, PositionReadModelCoverageRow>(),
          new Map<string, PositionAccountFreshnessRow>(),
          new Map<string, OpenOrderSnapshotSourceRow[]>(),
        ];

    const fundsCoverageByAccount = new Map(
      fundsCoverageRows.map((row) => [String(row.account_id || '').trim(), row] as const)
    );
    const brokerPolicyCache = new Map<string, EffectiveRiskPolicyContext>();
    const accountInputs = await Promise.all(
      uniqueAccounts.map(async (account) => {
        const brokerKey = String(account.brokerKey || '').trim().toLowerCase();
        if (!brokerPolicyCache.has(brokerKey)) {
          const effectivePolicy = await this.riskPolicyRepository.getEffectivePolicy(userId, brokerKey);
          brokerPolicyCache.set(
            brokerKey,
            this.buildEffectiveRiskPolicyContext(effectivePolicy, brokerKey)
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
          fundsCoverage: fundsCoverageByAccount.get(String(account.id || '').trim()) || null,
          walletBalance: fundsBreakdown.walletBalance,
          futuresBalance: fundsBreakdown.futuresBalance,
          balance: fundsBreakdown.trackedBalance,
          positions: livePositionsByAccount.get(String(account.id || '').trim()) || [],
          positionsFreshness:
            positionFreshnessByAccount.get(String(account.id || '').trim()) || null,
          positionCoverage:
            positionCoverageByAccount.get(String(account.id || '').trim()) || null,
          thresholds: this.buildRiskThresholdProfile(
            brokerPolicyCache.get(brokerKey) || this.buildEffectiveRiskPolicyContext(null, brokerKey)
          ),
          policyContext:
            brokerPolicyCache.get(brokerKey) || this.buildEffectiveRiskPolicyContext(null, brokerKey),
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
    const ruleEvaluations = this.buildComputedRiskRuleEvaluations(
      accountInputs,
      controls,
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
    const policyContexts = this.buildComputedRiskPolicyContexts(accountInputs);
    const sourceCoverage = this.buildComputedRiskSourceCoverage(
      accountInputs,
      ordersObservedAtByAccount,
      orderSummaryByAccount
    );
    const brokerSnapshots = this.buildComputedRiskBrokerSnapshots(
      accountInputs,
      positionEvaluations,
      orderSummaryByAccount,
      equity
    );
    const assetSnapshots = this.buildComputedRiskAssetSnapshots(
      accountInputs,
      positionEvaluations,
      orderSnapshots,
      equity
    );
    const brokerAssetSnapshots = this.buildComputedRiskBrokerAssetSnapshots(
      accountInputs,
      positionEvaluations,
      orderSnapshots,
      equity
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
      assetSnapshots,
      brokerSnapshots,
      brokerAssetSnapshots,
      orderSnapshots,
      positionSnapshots,
      policyContexts,
      sourceCoverage,
      ruleEvaluations,
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

  private async resolveRequestedRiskSnapshot(userId: string, snapshotId?: string) {
    const normalizedSnapshotId = String(snapshotId || '').trim();
    if (!normalizedSnapshotId) {
      return this.riskRepository.getLatestSnapshot(userId);
    }

    const snapshot = await this.riskRepository.getSnapshotById(userId, normalizedSnapshotId);
    if (!snapshot) {
      throw new NotFoundAppError('Risk snapshot not found');
    }
    return snapshot;
  }

  private buildPolicyContextLookup(rows: RiskSnapshotPolicyContext[]): {
    defaultPolicyContext: RiskSnapshotPolicyContext | null;
    brokerPolicyContextByKey: Map<string, RiskSnapshotPolicyContext>;
  } {
    let defaultPolicyContext: RiskSnapshotPolicyContext | null = null;
    const brokerPolicyContextByKey = new Map<string, RiskSnapshotPolicyContext>();

    rows.forEach((row) => {
      const scope = String(row.policyScope || '').trim().toLowerCase();
      if (scope === 'user') {
        defaultPolicyContext ??= row;
        return;
      }
      if (scope === 'broker') {
        const brokerKey = String(row.policyTargetKey || '').trim().toLowerCase();
        if (brokerKey && !brokerPolicyContextByKey.has(brokerKey)) {
          brokerPolicyContextByKey.set(brokerKey, row);
        }
      }
    });

    return {
      defaultPolicyContext,
      brokerPolicyContextByKey,
    };
  }

  private compareRiskSeverityRows<
    T extends {
      riskState?: string | null;
      riskScore?: number | null;
    },
  >(left: T, right: T, labelResolver: (item: T) => string): number {
    const leftRank = this.resolveRiskStateRank(left.riskState);
    const rightRank = this.resolveRiskStateRank(right.riskState);
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }

    const scoreDiff = this.toFiniteNumber(right.riskScore, 0) - this.toFiniteNumber(left.riskScore, 0);
    if (scoreDiff !== 0) {
      return scoreDiff;
    }

    return labelResolver(left).localeCompare(labelResolver(right));
  }

  private resolveRiskStateRank(state: unknown): number {
    const normalized = String(state || '').trim().toLowerCase();
    if (normalized === 'critical') {
      return 0;
    }
    if (normalized === 'watch') {
      return 1;
    }
    if (normalized === 'ok') {
      return 2;
    }
    return 3;
  }

  private resolvePolicyScopeRank(scope: unknown): number {
    const normalized = String(scope || '').trim().toLowerCase();
    if (normalized === 'user') {
      return 0;
    }
    if (normalized === 'broker') {
      return 1;
    }
    return 2;
  }

  private toRatioPct(numerator: unknown, denominator: unknown): number | null {
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

  private buildEffectiveRiskPolicyContext(
    policy: RiskPolicy | null | undefined,
    brokerKey?: string | null
  ): EffectiveRiskPolicyContext {
    const normalizedBrokerKey = String(brokerKey || policy?.brokerKey || '')
      .trim()
      .toLowerCase();
    const thresholds = this.buildRiskThresholdProfile(policy);

    if (policy?.scope === 'broker' && normalizedBrokerKey) {
      return {
        contextKey: `policy:broker:${normalizedBrokerKey}:${policy.id}`,
        policyId: policy.id,
        policyScope: 'broker',
        policyTargetKey: normalizedBrokerKey,
        enabled: Boolean(policy.enabled),
        monitorOnly: Boolean(policy.monitorOnly),
        enforceHardBlock: Boolean(policy.enforceHardBlock),
        marginUsageWarnPct: thresholds.marginUsageWarnPct,
        marginUsageCriticalPct: thresholds.marginUsageCriticalPct,
        concentrationWarnPct: thresholds.concentrationWarnPct,
        concentrationCriticalPct: thresholds.concentrationCriticalPct,
        dailyLossLimitPct: thresholds.dailyLossLimitPct,
        weeklyLossLimitPct: thresholds.weeklyLossLimitPct,
        monthlyLossLimitPct: thresholds.monthlyLossLimitPct,
        minLeverage: thresholds.minLeverage,
        maxLeverage: thresholds.maxLeverage,
        minNotionalPerTrade: thresholds.minNotionalPerTrade,
        maxOrderAllocation: thresholds.maxOrderAllocation,
        maxTotalAllocation: thresholds.maxTotalAllocation,
        maxAvgLeverage: thresholds.maxAvgLeverage,
      };
    }

    if (policy?.scope === 'user') {
      return {
        contextKey: `policy:user:__user__:${policy.id}`,
        policyId: policy.id,
        policyScope: 'user',
        policyTargetKey: '__user__',
        enabled: Boolean(policy.enabled),
        monitorOnly: Boolean(policy.monitorOnly),
        enforceHardBlock: Boolean(policy.enforceHardBlock),
        marginUsageWarnPct: thresholds.marginUsageWarnPct,
        marginUsageCriticalPct: thresholds.marginUsageCriticalPct,
        concentrationWarnPct: thresholds.concentrationWarnPct,
        concentrationCriticalPct: thresholds.concentrationCriticalPct,
        dailyLossLimitPct: thresholds.dailyLossLimitPct,
        weeklyLossLimitPct: thresholds.weeklyLossLimitPct,
        monthlyLossLimitPct: thresholds.monthlyLossLimitPct,
        minLeverage: thresholds.minLeverage,
        maxLeverage: thresholds.maxLeverage,
        minNotionalPerTrade: thresholds.minNotionalPerTrade,
        maxOrderAllocation: thresholds.maxOrderAllocation,
        maxTotalAllocation: thresholds.maxTotalAllocation,
        maxAvgLeverage: thresholds.maxAvgLeverage,
      };
    }

    return {
      contextKey: 'policy:default:__default__',
      policyId: null,
      policyScope: 'default',
      policyTargetKey: '__default__',
      enabled: true,
      monitorOnly: true,
      enforceHardBlock: false,
      marginUsageWarnPct: thresholds.marginUsageWarnPct,
      marginUsageCriticalPct: thresholds.marginUsageCriticalPct,
      concentrationWarnPct: thresholds.concentrationWarnPct,
      concentrationCriticalPct: thresholds.concentrationCriticalPct,
      dailyLossLimitPct: thresholds.dailyLossLimitPct,
      weeklyLossLimitPct: thresholds.weeklyLossLimitPct,
      monthlyLossLimitPct: thresholds.monthlyLossLimitPct,
      minLeverage: thresholds.minLeverage,
      maxLeverage: thresholds.maxLeverage,
      minNotionalPerTrade: thresholds.minNotionalPerTrade,
      maxOrderAllocation: thresholds.maxOrderAllocation,
      maxTotalAllocation: thresholds.maxTotalAllocation,
      maxAvgLeverage: thresholds.maxAvgLeverage,
    };
  }

  private buildComputedRiskPolicyContexts(
    accounts: AccountRiskSnapshotInput[]
  ): ComputedRiskSnapshotPolicyContextPayload[] {
    const byContextKey = new Map<string, ComputedRiskSnapshotPolicyContextPayload>();

    accounts.forEach((account) => {
      const context = account.policyContext;
      if (!context.contextKey || byContextKey.has(context.contextKey)) {
        return;
      }

      byContextKey.set(context.contextKey, {
        contextKey: context.contextKey,
        policyId: context.policyId,
        policyScope: context.policyScope,
        policyTargetKey: context.policyTargetKey,
        enabled: context.enabled,
        monitorOnly: context.monitorOnly,
        enforceHardBlock: context.enforceHardBlock,
        marginUsageWarnPct: context.marginUsageWarnPct,
        marginUsageCriticalPct: context.marginUsageCriticalPct,
        concentrationWarnPct: context.concentrationWarnPct,
        concentrationCriticalPct: context.concentrationCriticalPct,
        dailyLossLimitPct: context.dailyLossLimitPct,
        weeklyLossLimitPct: context.weeklyLossLimitPct,
        monthlyLossLimitPct: context.monthlyLossLimitPct,
        minLeverage: context.minLeverage,
        maxLeverage: context.maxLeverage,
        minNotionalPerTrade: context.minNotionalPerTrade,
        maxOrderAllocation: context.maxOrderAllocation,
        maxTotalAllocation: context.maxTotalAllocation,
        maxAvgLeverage: context.maxAvgLeverage,
      });
    });

    return Array.from(byContextKey.values()).sort((left, right) =>
      left.contextKey.localeCompare(right.contextKey)
    );
  }

  private buildComputedRiskSourceCoverage(
    accounts: AccountRiskSnapshotInput[],
    ordersObservedAtByAccount: Map<string, Date | null>,
    orderSummaryByAccount: Map<string, ComputedRiskOrderAccountSummary>
  ): ComputedRiskSnapshotSourceCoveragePayload[] {
    return accounts
      .map((account) => {
        const fundsCoverage = account.fundsCoverage;
        const positionCoverage = account.positionCoverage;
        const freshness = account.positionsFreshness;
        const orderSummary = orderSummaryByAccount.get(account.accountId) || {
          openOrders: 0,
          openOrderExposure: 0,
          reservedOrderMargin: 0,
        };

        return {
          brokerKey: account.brokerKey,
          accountId: account.accountId,
          accountName: account.accountName,
          latestFundsSnapshotId: fundsCoverage?.latest_snapshot_id || null,
          latestFundsSnapshotDate: fundsCoverage?.latest_snapshot_date || null,
          latestFundsObservedAt: fundsCoverage?.latest_observed_at || null,
          latestFundsComputedAt: fundsCoverage?.latest_computed_at || null,
          latestFundsLastAttemptAt: fundsCoverage?.latest_last_attempt_at || null,
          latestFundsFetchStatus: fundsCoverage?.latest_fetch_status || null,
          latestFundsErrorMessage: fundsCoverage?.latest_error_message || null,
          latestFundsSource: fundsCoverage?.latest_source || null,
          latestWalletAvailable: Boolean(fundsCoverage?.latest_wallet_available),
          latestFuturesAvailable: Boolean(fundsCoverage?.latest_futures_available),
          latestSuccessFundsSnapshotId: fundsCoverage?.latest_success_snapshot_id || null,
          latestSuccessFundsSnapshotDate: fundsCoverage?.latest_success_snapshot_date || null,
          latestSuccessFundsObservedAt: fundsCoverage?.latest_success_observed_at || null,
          latestSuccessFundsComputedAt: fundsCoverage?.latest_success_computed_at || null,
          latestSuccessFundsSource: fundsCoverage?.latest_success_source || null,
          latestSuccessWalletAvailable: Boolean(fundsCoverage?.latest_success_wallet_available),
          latestSuccessFuturesAvailable: Boolean(fundsCoverage?.latest_success_futures_available),
          positionsObservedAt: freshness?.observedAt || null,
          positionsCheckpointAt: freshness?.checkpointAt || null,
          openPositions: freshness?.openPositions ?? account.positions.length,
          positionTotalRows: freshness?.totalRows ?? account.positions.length,
          positionSnapshotRows: positionCoverage?.snapshotRows ?? 0,
          positionReadModelRows: positionCoverage?.readModelRows ?? 0,
          rowsMissingFromReadModel: positionCoverage?.rowsMissingFromReadModel ?? 0,
          rowsBehindSnapshot: positionCoverage?.rowsBehindSnapshot ?? 0,
          orphanReadModelRows: positionCoverage?.orphanReadModelRows ?? 0,
          latestPositionSnapshotSeenAt: positionCoverage?.latestSnapshotSeenAt ?? null,
          latestPositionReadModelSeenAt: positionCoverage?.latestReadModelSeenAt ?? null,
          openOrderRows: orderSummary.openOrders,
          latestOrderSeenAt: ordersObservedAtByAccount.get(account.accountId) || null,
        } satisfies ComputedRiskSnapshotSourceCoveragePayload;
      })
      .sort((left, right) => {
        if (left.brokerKey !== right.brokerKey) {
          return left.brokerKey.localeCompare(right.brokerKey);
        }
        return left.accountName.localeCompare(right.accountName);
      });
  }

  private buildComputedRiskBrokerSnapshots(
    accounts: AccountRiskSnapshotInput[],
    evaluations: PositionRiskEvaluation[],
    orderSummaryByAccount: Map<string, ComputedRiskOrderAccountSummary>,
    equity: number
  ): ComputedRiskBrokerSnapshotDraft[] {
    const brokers = Array.from(new Set(accounts.map((account) => account.brokerKey))).sort();

    return brokers.map((brokerKey) => {
      const scopedAccounts = accounts.filter((account) => account.brokerKey === brokerKey);
      const scopedEvaluations = evaluations.filter((evaluation) => evaluation.brokerKey === brokerKey);
      const thresholds = scopedAccounts[0]?.thresholds || this.buildRiskThresholdProfile(null);
      const trackedBalance = this.roundNumber(
        scopedAccounts.reduce((sum, account) => sum + this.toFiniteNumber(account.balance, 0), 0),
        4
      );
      const walletBalance = this.roundNumber(
        scopedAccounts.reduce((sum, account) => sum + this.toFiniteNumber(account.walletBalance, 0), 0),
        4
      );
      const futuresBalance = this.roundNumber(
        scopedAccounts.reduce((sum, account) => sum + this.toFiniteNumber(account.futuresBalance, 0), 0),
        4
      );
      const grossExposure = this.roundNumber(
        scopedEvaluations.reduce((sum, evaluation) => sum + evaluation.exposure, 0),
        2
      );
      const longExposure = this.roundNumber(
        scopedEvaluations.reduce((sum, evaluation) => {
          return evaluation.sideKey === 'long' ? sum + evaluation.exposure : sum;
        }, 0),
        2
      );
      const shortExposure = this.roundNumber(
        scopedEvaluations.reduce((sum, evaluation) => {
          return evaluation.sideKey === 'short' ? sum + evaluation.exposure : sum;
        }, 0),
        2
      );
      const netExposure = this.roundNumber(longExposure - shortExposure, 2);
      const openPositions = scopedAccounts.reduce(
        (sum, account) => sum + (account.positionsFreshness?.openPositions ?? account.positions.length),
        0
      );
      const openOrders = scopedAccounts.reduce(
        (sum, account) => sum + (orderSummaryByAccount.get(account.accountId)?.openOrders || 0),
        0
      );
      const openOrderExposure = this.roundNumber(
        scopedAccounts.reduce(
          (sum, account) => sum + (orderSummaryByAccount.get(account.accountId)?.openOrderExposure || 0),
          0
        ),
        2
      );
      const reservedOrderMargin = this.roundNumber(
        scopedAccounts.reduce(
          (sum, account) => sum + (orderSummaryByAccount.get(account.accountId)?.reservedOrderMargin || 0),
          0
        ),
        2
      );
      const unrealizedPnl = this.roundNumber(
        scopedEvaluations.reduce((sum, evaluation) => sum + this.toFiniteNumber(evaluation.unrealizedPnl, 0), 0),
        2
      );
      const weightedAvgLeverage = this.weightedAverage(
        scopedEvaluations.map((evaluation) => ({
          value: evaluation.leverage,
          weight: evaluation.exposure,
        }))
      );
      const maxLeverage = this.maxNumber(scopedEvaluations.map((evaluation) => evaluation.leverage));
      const worstLiquidationDistancePct = this.minNumber(
        scopedEvaluations.map((evaluation) => evaluation.liquidationDistancePct)
      );
      const allocationPct = equity > 0 ? (grossExposure / equity) * 100 : 0;
      const marginUsagePct = trackedBalance > 0 ? (grossExposure / trackedBalance) * 100 : 0;
      const assessment = this.buildScopedRiskAssessment({
        criticalSignals: [
          ...(marginUsagePct >= thresholds.marginUsageCriticalPct
            ? ['Broker margin usage exceeds the configured critical threshold.']
            : []),
          ...(allocationPct >= thresholds.maxTotalAllocation
            ? ['Broker total allocation exceeds the configured critical threshold.']
            : []),
          ...(weightedAvgLeverage !== null && weightedAvgLeverage >= thresholds.maxAvgLeverage
            ? ['Average leverage exceeds the configured broker threshold.']
            : []),
          ...(worstLiquidationDistancePct !== null && worstLiquidationDistancePct <= 5
            ? ['At least one position is within 5% of liquidation.']
            : []),
        ],
        watchSignals: [
          ...(marginUsagePct >= thresholds.marginUsageWarnPct &&
          marginUsagePct < thresholds.marginUsageCriticalPct
            ? ['Broker margin usage is approaching its warning band.']
            : []),
          ...(allocationPct >= thresholds.concentrationWarnPct &&
          allocationPct < thresholds.maxTotalAllocation
            ? ['Broker allocation is becoming concentrated.']
            : []),
          ...(weightedAvgLeverage !== null &&
          weightedAvgLeverage >= thresholds.maxAvgLeverage * 0.8 &&
          weightedAvgLeverage < thresholds.maxAvgLeverage
            ? ['Average leverage is close to the configured broker threshold.']
            : []),
          ...(worstLiquidationDistancePct !== null &&
          worstLiquidationDistancePct > 5 &&
          worstLiquidationDistancePct <= 10
            ? ['At least one position is within 10% of liquidation.']
            : []),
        ],
        fallbackCriticalSignal:
          scopedEvaluations.find((evaluation) => evaluation.statuses.includes('critical'))?.notes?.[0] || null,
        fallbackWatchSignal:
          scopedEvaluations.find((evaluation) => !evaluation.statuses.includes('critical') && evaluation.statuses.includes('watch'))?.notes?.[0] ||
          null,
        baseScore:
          Math.min(20, marginUsagePct / 4) +
          Math.min(20, allocationPct / 4) +
          (weightedAvgLeverage !== null ? Math.min(15, weightedAvgLeverage * 2) : 0) +
          (worstLiquidationDistancePct !== null
            ? worstLiquidationDistancePct <= 5
              ? 12
              : worstLiquidationDistancePct <= 10
                ? 6
                : 0
            : 0),
      });

      return {
        brokerKey,
        policyContextKey: scopedAccounts[0]?.policyContext.contextKey || null,
        accountCount: scopedAccounts.length,
        trackedBalance,
        walletBalance,
        futuresBalance,
        grossExposure,
        netExposure,
        longExposure,
        shortExposure,
        openPositions,
        openOrders,
        openOrderExposure,
        reservedOrderMargin,
        unrealizedPnl,
        realizedPnl: 0,
        weightedAvgLeverage,
        maxLeverage,
        worstLiquidationDistancePct:
          worstLiquidationDistancePct === null ? null : this.roundNumber(worstLiquidationDistancePct, 2),
        riskScore: assessment.riskScore,
        riskState: assessment.riskState,
        primaryConcern: assessment.primaryConcern,
      } satisfies ComputedRiskBrokerSnapshotDraft;
    });
  }

  private buildComputedRiskAssetSnapshots(
    accounts: AccountRiskSnapshotInput[],
    evaluations: PositionRiskEvaluation[],
    orderSnapshots: ComputedRiskOrderSnapshotPayload[],
    equity: number
  ): ComputedRiskAssetSnapshotPayload[] {
    const accountsById = new Map(accounts.map((account) => [account.accountId, account] as const));
    const orderSummaryBySymbol = this.buildOrderSummaryMap(orderSnapshots, (order) =>
      String(order.symbol || '').trim().toUpperCase()
    );
    const symbols = Array.from(
      new Set(
        evaluations
          .map((evaluation) => String(evaluation.symbol || '').trim().toUpperCase())
          .filter(Boolean)
      )
    ).sort();

    return symbols.map((symbol) => {
      const scopedEvaluations = evaluations.filter(
        (evaluation) => String(evaluation.symbol || '').trim().toUpperCase() === symbol
      );
      const scopedAccounts = Array.from(
        new Map(
          scopedEvaluations
            .map((evaluation) => accountsById.get(evaluation.accountId))
            .filter((account): account is AccountRiskSnapshotInput => Boolean(account))
            .map((account) => [account.accountId, account] as const)
        ).values()
      );
      const thresholds = this.buildGlobalThresholdProfile(scopedAccounts);
      const grossExposure = this.roundNumber(
        scopedEvaluations.reduce((sum, evaluation) => sum + evaluation.exposure, 0),
        2
      );
      const longExposure = this.roundNumber(
        scopedEvaluations.reduce((sum, evaluation) => {
          return evaluation.sideKey === 'long' ? sum + evaluation.exposure : sum;
        }, 0),
        2
      );
      const shortExposure = this.roundNumber(
        scopedEvaluations.reduce((sum, evaluation) => {
          return evaluation.sideKey === 'short' ? sum + evaluation.exposure : sum;
        }, 0),
        2
      );
      const netExposure = this.roundNumber(longExposure - shortExposure, 2);
      const allocationPct = equity > 0 ? (grossExposure / equity) * 100 : 0;
      const weightedAvgLeverage = this.weightedAverage(
        scopedEvaluations.map((evaluation) => ({
          value: evaluation.leverage,
          weight: evaluation.exposure,
        }))
      );
      const maxLeverage = this.maxNumber(scopedEvaluations.map((evaluation) => evaluation.leverage));
      const worstLiquidationDistancePct = this.minNumber(
        scopedEvaluations.map((evaluation) => evaluation.liquidationDistancePct)
      );
      const unrealizedPnl = this.roundNumber(
        scopedEvaluations.reduce((sum, evaluation) => sum + this.toFiniteNumber(evaluation.unrealizedPnl, 0), 0),
        2
      );
      const orderSummary = orderSummaryBySymbol.get(symbol) || {
        openOrders: 0,
        openOrderExposure: 0,
        reservedOrderMargin: 0,
      };
      const assessment = this.buildScopedRiskAssessment({
        criticalSignals: [
          ...(allocationPct >= thresholds.concentrationCriticalPct
            ? ['Asset concentration exceeds the configured critical threshold.']
            : []),
          ...(maxLeverage !== null && maxLeverage >= thresholds.maxLeverage
            ? ['Observed leverage exceeds the configured max leverage.']
            : []),
          ...(worstLiquidationDistancePct !== null && worstLiquidationDistancePct <= 5
            ? ['At least one position is within 5% of liquidation.']
            : []),
        ],
        watchSignals: [
          ...(allocationPct >= thresholds.concentrationWarnPct &&
          allocationPct < thresholds.concentrationCriticalPct
            ? ['Asset concentration is approaching the warning band.']
            : []),
          ...(maxLeverage !== null &&
          maxLeverage >= thresholds.maxLeverage * 0.8 &&
          maxLeverage < thresholds.maxLeverage
            ? ['Observed leverage is close to the configured max leverage.']
            : []),
          ...(worstLiquidationDistancePct !== null &&
          worstLiquidationDistancePct > 5 &&
          worstLiquidationDistancePct <= 10
            ? ['At least one position is within 10% of liquidation.']
            : []),
        ],
        fallbackCriticalSignal:
          scopedEvaluations.find((evaluation) => evaluation.statuses.includes('critical'))?.notes?.[0] || null,
        fallbackWatchSignal:
          scopedEvaluations.find((evaluation) => !evaluation.statuses.includes('critical') && evaluation.statuses.includes('watch'))?.notes?.[0] ||
          null,
        baseScore:
          Math.min(25, allocationPct / 4) +
          (maxLeverage !== null ? Math.min(15, maxLeverage * 2) : 0) +
          (worstLiquidationDistancePct !== null
            ? worstLiquidationDistancePct <= 5
              ? 12
              : worstLiquidationDistancePct <= 10
                ? 6
                : 0
            : 0),
      });

      return {
        symbol,
        accountCount: new Set(scopedEvaluations.map((evaluation) => evaluation.accountId)).size,
        brokerCount: new Set(scopedEvaluations.map((evaluation) => evaluation.brokerKey)).size,
        positionCount: scopedEvaluations.length,
        openOrders: orderSummary.openOrders,
        openOrderExposure: this.roundNumber(orderSummary.openOrderExposure, 2),
        reservedOrderMargin: this.roundNumber(orderSummary.reservedOrderMargin, 2),
        grossExposure,
        netExposure,
        longExposure,
        shortExposure,
        unrealizedPnl,
        realizedPnl: 0,
        weightedAvgLeverage,
        maxLeverage,
        worstLiquidationDistancePct:
          worstLiquidationDistancePct === null ? null : this.roundNumber(worstLiquidationDistancePct, 2),
        riskScore: assessment.riskScore,
        riskState: assessment.riskState,
        primaryConcern: assessment.primaryConcern,
      } satisfies ComputedRiskAssetSnapshotPayload;
    });
  }

  private buildComputedRiskBrokerAssetSnapshots(
    accounts: AccountRiskSnapshotInput[],
    evaluations: PositionRiskEvaluation[],
    orderSnapshots: ComputedRiskOrderSnapshotPayload[],
    equity: number
  ): ComputedRiskBrokerAssetSnapshotDraft[] {
    const accountsById = new Map(accounts.map((account) => [account.accountId, account] as const));
    const orderSummaryByBrokerAsset = this.buildOrderSummaryMap(orderSnapshots, (order) => {
      const brokerKey = String(order.brokerKey || '').trim().toLowerCase();
      const symbol = String(order.symbol || '').trim().toUpperCase();
      return brokerKey && symbol ? `${brokerKey}|${symbol}` : '';
    });
    const keys = Array.from(
      new Set(
        evaluations
          .map((evaluation) => {
            const brokerKey = String(evaluation.brokerKey || '').trim().toLowerCase();
            const symbol = String(evaluation.symbol || '').trim().toUpperCase();
            return brokerKey && symbol ? `${brokerKey}|${symbol}` : '';
          })
          .filter(Boolean)
      )
    ).sort();

    return keys.map((key) => {
      const [brokerKey, symbol] = key.split('|');
      const scopedEvaluations = evaluations.filter(
        (evaluation) =>
          String(evaluation.brokerKey || '').trim().toLowerCase() === brokerKey &&
          String(evaluation.symbol || '').trim().toUpperCase() === symbol
      );
      const scopedAccounts = Array.from(
        new Map(
          scopedEvaluations
            .map((evaluation) => accountsById.get(evaluation.accountId))
            .filter((account): account is AccountRiskSnapshotInput => Boolean(account))
            .map((account) => [account.accountId, account] as const)
        ).values()
      );
      const thresholds = scopedAccounts[0]?.thresholds || this.buildRiskThresholdProfile(null);
      const brokerTrackedBalance = this.roundNumber(
        scopedAccounts.reduce((sum, account) => sum + this.toFiniteNumber(account.balance, 0), 0),
        4
      );
      const grossExposure = this.roundNumber(
        scopedEvaluations.reduce((sum, evaluation) => sum + evaluation.exposure, 0),
        2
      );
      const longExposure = this.roundNumber(
        scopedEvaluations.reduce((sum, evaluation) => {
          return evaluation.sideKey === 'long' ? sum + evaluation.exposure : sum;
        }, 0),
        2
      );
      const shortExposure = this.roundNumber(
        scopedEvaluations.reduce((sum, evaluation) => {
          return evaluation.sideKey === 'short' ? sum + evaluation.exposure : sum;
        }, 0),
        2
      );
      const netExposure = this.roundNumber(longExposure - shortExposure, 2);
      const allocationPct = equity > 0 ? (grossExposure / equity) * 100 : 0;
      const marginUsagePct = brokerTrackedBalance > 0 ? (grossExposure / brokerTrackedBalance) * 100 : 0;
      const weightedAvgLeverage = this.weightedAverage(
        scopedEvaluations.map((evaluation) => ({
          value: evaluation.leverage,
          weight: evaluation.exposure,
        }))
      );
      const maxLeverage = this.maxNumber(scopedEvaluations.map((evaluation) => evaluation.leverage));
      const worstLiquidationDistancePct = this.minNumber(
        scopedEvaluations.map((evaluation) => evaluation.liquidationDistancePct)
      );
      const unrealizedPnl = this.roundNumber(
        scopedEvaluations.reduce((sum, evaluation) => sum + this.toFiniteNumber(evaluation.unrealizedPnl, 0), 0),
        2
      );
      const orderSummary = orderSummaryByBrokerAsset.get(key) || {
        openOrders: 0,
        openOrderExposure: 0,
        reservedOrderMargin: 0,
      };
      const assessment = this.buildScopedRiskAssessment({
        criticalSignals: [
          ...(marginUsagePct >= thresholds.marginUsageCriticalPct
            ? ['Broker-asset margin usage exceeds the configured critical threshold.']
            : []),
          ...(allocationPct >= thresholds.concentrationCriticalPct
            ? ['Broker-asset concentration exceeds the configured critical threshold.']
            : []),
          ...(maxLeverage !== null && maxLeverage >= thresholds.maxLeverage
            ? ['Observed leverage exceeds the configured max leverage.']
            : []),
          ...(worstLiquidationDistancePct !== null && worstLiquidationDistancePct <= 5
            ? ['At least one position is within 5% of liquidation.']
            : []),
        ],
        watchSignals: [
          ...(marginUsagePct >= thresholds.marginUsageWarnPct &&
          marginUsagePct < thresholds.marginUsageCriticalPct
            ? ['Broker-asset margin usage is approaching its warning band.']
            : []),
          ...(allocationPct >= thresholds.concentrationWarnPct &&
          allocationPct < thresholds.concentrationCriticalPct
            ? ['Broker-asset concentration is approaching the warning band.']
            : []),
          ...(maxLeverage !== null &&
          maxLeverage >= thresholds.maxLeverage * 0.8 &&
          maxLeverage < thresholds.maxLeverage
            ? ['Observed leverage is close to the configured max leverage.']
            : []),
          ...(worstLiquidationDistancePct !== null &&
          worstLiquidationDistancePct > 5 &&
          worstLiquidationDistancePct <= 10
            ? ['At least one position is within 10% of liquidation.']
            : []),
        ],
        fallbackCriticalSignal:
          scopedEvaluations.find((evaluation) => evaluation.statuses.includes('critical'))?.notes?.[0] || null,
        fallbackWatchSignal:
          scopedEvaluations.find((evaluation) => !evaluation.statuses.includes('critical') && evaluation.statuses.includes('watch'))?.notes?.[0] ||
          null,
        baseScore:
          Math.min(20, marginUsagePct / 4) +
          Math.min(20, allocationPct / 4) +
          (maxLeverage !== null ? Math.min(15, maxLeverage * 2) : 0) +
          (worstLiquidationDistancePct !== null
            ? worstLiquidationDistancePct <= 5
              ? 12
              : worstLiquidationDistancePct <= 10
                ? 6
                : 0
            : 0),
      });

      return {
        brokerKey,
        symbol,
        policyContextKey: scopedAccounts[0]?.policyContext.contextKey || null,
        accountCount: new Set(scopedEvaluations.map((evaluation) => evaluation.accountId)).size,
        positionCount: scopedEvaluations.length,
        openOrders: orderSummary.openOrders,
        openOrderExposure: this.roundNumber(orderSummary.openOrderExposure, 2),
        reservedOrderMargin: this.roundNumber(orderSummary.reservedOrderMargin, 2),
        grossExposure,
        netExposure,
        longExposure,
        shortExposure,
        unrealizedPnl,
        realizedPnl: 0,
        weightedAvgLeverage,
        maxLeverage,
        worstLiquidationDistancePct:
          worstLiquidationDistancePct === null ? null : this.roundNumber(worstLiquidationDistancePct, 2),
        riskScore: assessment.riskScore,
        riskState: assessment.riskState,
        primaryConcern: assessment.primaryConcern,
      } satisfies ComputedRiskBrokerAssetSnapshotDraft;
    });
  }

  private buildOrderSummaryMap(
    orderSnapshots: ComputedRiskOrderSnapshotPayload[],
    keyResolver: (order: ComputedRiskOrderSnapshotPayload) => string
  ): Map<string, ComputedRiskOrderAccountSummary> {
    const summaryByKey = new Map<string, ComputedRiskOrderAccountSummary>();

    orderSnapshots.forEach((order) => {
      const key = keyResolver(order);
      if (!key) {
        return;
      }

      const existing = summaryByKey.get(key) || {
        openOrders: 0,
        openOrderExposure: 0,
        reservedOrderMargin: 0,
      };
      existing.openOrders += 1;
      if (!order.reduceOnly) {
        existing.openOrderExposure = this.roundNumber(
          existing.openOrderExposure + Math.abs(order.notional || 0),
          2
        );
        existing.reservedOrderMargin = this.roundNumber(
          existing.reservedOrderMargin + Math.abs(order.reservedMargin || 0),
          2
        );
      }
      summaryByKey.set(key, existing);
    });

    return summaryByKey;
  }

  private buildScopedRiskAssessment(input: {
    criticalSignals: string[];
    watchSignals: string[];
    fallbackCriticalSignal?: string | null;
    fallbackWatchSignal?: string | null;
    baseScore: number;
  }): { riskScore: number; riskState: string; primaryConcern: string | null } {
    const criticalSignals = [...input.criticalSignals];
    const watchSignals = [...input.watchSignals];

    if (!criticalSignals.length && input.fallbackCriticalSignal) {
      criticalSignals.push(input.fallbackCriticalSignal);
    }
    if (!watchSignals.length && input.fallbackWatchSignal) {
      watchSignals.push(input.fallbackWatchSignal);
    }

    const riskState = criticalSignals.length ? 'critical' : watchSignals.length ? 'watch' : 'ok';
    const rawScore = input.baseScore + criticalSignals.length * 18 + watchSignals.length * 7;

    return {
      riskScore: Math.max(0, Math.min(100, Math.round(rawScore))),
      riskState,
      primaryConcern:
        criticalSignals[0] ||
        watchSignals[0] ||
        'No acute risk breach detected in the latest recompute.',
    };
  }

  private weightedAverage(
    items: Array<{
      value: number | null;
      weight: number;
    }>
  ): number | null {
    let weightedSum = 0;
    let totalWeight = 0;
    let fallbackSum = 0;
    let fallbackCount = 0;

    items.forEach((item) => {
      const value = this.toFiniteNumber(item.value, null);
      if (value === null) {
        return;
      }

      fallbackSum += value;
      fallbackCount += 1;

      const weight = Math.max(0, this.toFiniteNumber(item.weight, 0));
      if (weight > 0) {
        weightedSum += value * weight;
        totalWeight += weight;
      }
    });

    if (totalWeight > 0) {
      return this.roundNumber(weightedSum / totalWeight, 2);
    }
    if (fallbackCount > 0) {
      return this.roundNumber(fallbackSum / fallbackCount, 2);
    }
    return null;
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
      minLeverage: this.toFiniteNumber(policy?.minLeverage, null),
      maxLeverage: this.toFiniteNumber(policy?.maxLeverage, 5),
      minNotionalPerTrade: this.toFiniteNumber(policy?.minNotionalPerTrade, null),
      maxOrderAllocation: this.toFiniteNumber(policy?.maxOrderAllocation, null),
      maxTotalAllocation: this.toFiniteNumber(policy?.maxTotalAllocation, 80),
      maxAvgLeverage: this.toFiniteNumber(policy?.maxAvgLeverage, 4),
    };
  }

  private buildRiskControls(
    accounts: AccountRiskSnapshotInput[],
    equity: number,
    marginUsagePct: number,
    lossWindowUsage: LossWindowUsage,
    averageLeverage: number | null,
    brokerExposureTotals: Map<string, number>,
    accountExposureTotals: Map<string, number>,
    evaluations: PositionRiskEvaluation[]
  ): ComputedRiskControlPayload[] {
    const controls: ComputedRiskControlPayload[] = [];
    const globalThresholds = this.buildGlobalThresholdProfile(accounts);
    let sortOrder = 0;
    const pushControl = (item: ComputedRiskControlPayload) => {
      controls.push({
        ...item,
        sortOrder,
      });
      sortOrder += 1;
    };

    const portfolioMarginStatus = this.resolveThresholdState(
      marginUsagePct,
      globalThresholds.marginUsageWarnPct,
      globalThresholds.marginUsageCriticalPct
    );
    pushControl({
      bucket: 'Portfolio margin usage',
      exposure: this.formatPercent(marginUsagePct),
      threshold: `Warn ${this.formatPercent(globalThresholds.marginUsageWarnPct)} / Critical ${this.formatPercent(globalThresholds.marginUsageCriticalPct)}`,
      status: portfolioMarginStatus,
      action:
        marginUsagePct >= globalThresholds.marginUsageCriticalPct
          ? 'Reduce gross exposure or add margin before the next rebalance window.'
          : marginUsagePct >= globalThresholds.marginUsageWarnPct
            ? 'Review leverage-heavy routes before increasing exposure.'
            : 'Margin usage is within configured tolerance.',
      scopeType: 'portfolio',
      scopeKey: 'portfolio',
      ruleCode: 'portfolio_margin_usage',
      metricName: 'marginUsagePct',
      actualValue: this.roundNumber(marginUsagePct, 2),
      basisValue: this.roundNumber(equity, 2),
      warnThresholdValue: globalThresholds.marginUsageWarnPct,
      criticalThresholdValue: globalThresholds.marginUsageCriticalPct,
    });

    const dailyDrawdownStatus = this.resolveLossWindowState(
      lossWindowUsage.dailyUsagePct,
      globalThresholds.dailyLossLimitPct
    );
    pushControl({
      bucket: 'Daily drawdown usage',
      exposure: this.formatPercent(lossWindowUsage.dailyUsagePct),
      threshold: `Limit ${this.formatPercent(globalThresholds.dailyLossLimitPct)}`,
      status: dailyDrawdownStatus,
      action:
        lossWindowUsage.dailyUsagePct >= globalThresholds.dailyLossLimitPct
          ? 'De-risk open positions or tighten losses before the daily budget is exhausted.'
          : lossWindowUsage.dailyUsagePct >= globalThresholds.dailyLossLimitPct * 0.8
            ? 'Watch daily drawdown closely; one more adverse move could hit the limit.'
            : 'Daily drawdown usage remains within the configured budget.',
      scopeType: 'portfolio',
      scopeKey: 'portfolio',
      ruleCode: 'daily_drawdown_usage',
      metricName: 'dailyLossUsagePct',
      actualValue: this.roundNumber(lossWindowUsage.dailyUsagePct, 2),
      basisValue: this.roundNumber(equity, 2),
      warnThresholdValue: this.roundNumber(globalThresholds.dailyLossLimitPct * 0.8, 2),
      criticalThresholdValue: globalThresholds.dailyLossLimitPct,
    });

    const weeklyLossStatus = this.resolveLossWindowState(
      lossWindowUsage.weeklyUsagePct,
      globalThresholds.weeklyLossLimitPct
    );
    pushControl({
      bucket: 'Weekly loss usage',
      exposure: this.formatPercent(lossWindowUsage.weeklyUsagePct),
      threshold: `Limit ${this.formatPercent(globalThresholds.weeklyLossLimitPct)}`,
      status: weeklyLossStatus,
      action:
        lossWindowUsage.weeklyUsagePct >= globalThresholds.weeklyLossLimitPct
          ? 'Trailing 7-day realized losses have exhausted the weekly budget. Reduce risk and review recent closed-trade activity before adding exposure.'
          : lossWindowUsage.weeklyUsagePct >= globalThresholds.weeklyLossLimitPct * 0.8
            ? 'Weekly loss usage is nearing its limit. Review the last 7 days of realized losses before scaling up.'
            : 'Weekly loss usage remains within the configured budget.',
      scopeType: 'portfolio',
      scopeKey: 'portfolio',
      ruleCode: 'weekly_loss_usage',
      metricName: 'weeklyLossUsagePct',
      actualValue: this.roundNumber(lossWindowUsage.weeklyUsagePct, 2),
      basisValue: this.roundNumber(equity, 2),
      warnThresholdValue: this.roundNumber(globalThresholds.weeklyLossLimitPct * 0.8, 2),
      criticalThresholdValue: globalThresholds.weeklyLossLimitPct,
    });

    const monthlyLossStatus = this.resolveLossWindowState(
      lossWindowUsage.monthlyUsagePct,
      globalThresholds.monthlyLossLimitPct
    );
    pushControl({
      bucket: 'Monthly loss usage',
      exposure: this.formatPercent(lossWindowUsage.monthlyUsagePct),
      threshold: `Limit ${this.formatPercent(globalThresholds.monthlyLossLimitPct)}`,
      status: monthlyLossStatus,
      action:
        lossWindowUsage.monthlyUsagePct >= globalThresholds.monthlyLossLimitPct
          ? 'Trailing 30-day realized losses have exhausted the monthly budget. Pause new risk and review strategy quality before re-entering.'
          : lossWindowUsage.monthlyUsagePct >= globalThresholds.monthlyLossLimitPct * 0.8
            ? 'Monthly loss usage is approaching its limit. Inspect the last 30 days of realized losses before increasing risk.'
            : 'Monthly loss usage remains within the configured budget.',
      scopeType: 'portfolio',
      scopeKey: 'portfolio',
      ruleCode: 'monthly_loss_usage',
      metricName: 'monthlyLossUsagePct',
      actualValue: this.roundNumber(lossWindowUsage.monthlyUsagePct, 2),
      basisValue: this.roundNumber(equity, 2),
      warnThresholdValue: this.roundNumber(globalThresholds.monthlyLossLimitPct * 0.8, 2),
      criticalThresholdValue: globalThresholds.monthlyLossLimitPct,
    });

    if (averageLeverage !== null) {
      const averageLeverageStatus =
        averageLeverage >= globalThresholds.maxAvgLeverage ? 'Critical' : 'Ok';
      pushControl({
        bucket: 'Average leverage',
        exposure: `${this.roundNumber(averageLeverage, 2)}x`,
        threshold: `Max ${this.roundNumber(globalThresholds.maxAvgLeverage, 2)}x`,
        status: averageLeverageStatus,
        action:
          averageLeverage >= globalThresholds.maxAvgLeverage
            ? 'Reduce average leverage across the book before adding new trades.'
            : 'Average leverage stays inside the configured guardrail.',
        scopeType: 'portfolio',
        scopeKey: 'portfolio',
        ruleCode: 'average_leverage',
        metricName: 'averageLeverage',
        actualValue: this.roundNumber(averageLeverage, 2),
        basisValue: null,
        warnThresholdValue: null,
        criticalThresholdValue: globalThresholds.maxAvgLeverage,
      });
    }

    brokerExposureTotals.forEach((exposure, brokerKey) => {
      const brokerAccount =
        accounts.find((account) => account.brokerKey === brokerKey) || null;
      const thresholds = brokerAccount?.thresholds || globalThresholds;
      const criticalLimit = Math.min(100, thresholds.maxTotalAllocation);
      const pct = equity > 0 ? (exposure / equity) * 100 : 0;
      const brokerStatus = this.resolveThresholdState(
        pct,
        thresholds.concentrationWarnPct,
        criticalLimit
      );
      pushControl({
        bucket: `${brokerKey || 'broker'} total allocation`,
        exposure: this.formatPercent(pct),
        threshold: `Warn ${this.formatPercent(thresholds.concentrationWarnPct)} / Critical ${this.formatPercent(criticalLimit)}`,
        status: brokerStatus,
        action:
          pct >= criticalLimit
            ? `Reduce ${brokerKey || 'broker'} concentration before it dominates portfolio risk.`
            : pct >= thresholds.concentrationWarnPct
              ? `Keep ${brokerKey || 'broker'} exposure under watch; it is becoming the dominant sleeve.`
              : `${brokerKey || 'Broker'} allocation remains inside the configured posture.`,
        policyContextKey: brokerAccount?.policyContext.contextKey || null,
        scopeType: 'broker',
        scopeKey: brokerKey || 'broker',
        brokerKey: brokerKey || null,
        ruleCode: 'broker_total_allocation',
        metricName: 'allocationPct',
        actualValue: this.roundNumber(pct, 2),
        basisValue: this.roundNumber(equity, 2),
        warnThresholdValue: thresholds.concentrationWarnPct,
        criticalThresholdValue: criticalLimit,
      });
    });

    accounts.forEach((account) => {
      const accountExposure = accountExposureTotals.get(account.accountId) || 0;
      const accountBalance = account.balance || 0;
      const accountMarginUsagePct = accountBalance > 0 ? (accountExposure / accountBalance) * 100 : 0;
      const accountStatus = this.resolveThresholdState(
        accountMarginUsagePct,
        account.thresholds.marginUsageWarnPct,
        account.thresholds.marginUsageCriticalPct
      );
      pushControl({
        bucket: `${account.accountName} margin usage`,
        exposure: this.formatPercent(accountMarginUsagePct),
        threshold: `Warn ${this.formatPercent(account.thresholds.marginUsageWarnPct)} / Critical ${this.formatPercent(account.thresholds.marginUsageCriticalPct)}`,
        status: accountStatus,
        action:
          accountMarginUsagePct >= account.thresholds.marginUsageCriticalPct
            ? `Add funds or trim exposure on ${account.accountName}.`
            : accountMarginUsagePct >= account.thresholds.marginUsageWarnPct
              ? `Monitor ${account.accountName}; margin usage is rising.`
              : `${account.accountName} remains comfortably within margin tolerance.`,
        policyContextKey: account.policyContext.contextKey,
        scopeType: 'account',
        scopeKey: account.accountId,
        brokerKey: account.brokerKey,
        accountId: account.accountId,
        ruleCode: 'account_margin_usage',
        metricName: 'marginUsagePct',
        actualValue: this.roundNumber(accountMarginUsagePct, 2),
        basisValue: this.roundNumber(accountBalance, 4),
        warnThresholdValue: account.thresholds.marginUsageWarnPct,
        criticalThresholdValue: account.thresholds.marginUsageCriticalPct,
      });
    });

    evaluations
      .filter((evaluation) => evaluation.concentrationPct !== null)
      .sort((left, right) => (right.concentrationPct || 0) - (left.concentrationPct || 0))
      .slice(0, 3)
      .forEach((evaluation) => {
        const account = accounts.find((item) => item.accountId === evaluation.accountId);
        const thresholds = account?.thresholds || globalThresholds;
        const concentrationPct = evaluation.concentrationPct || 0;
        const concentrationStatus = this.resolveThresholdState(
          concentrationPct,
          thresholds.concentrationWarnPct,
          thresholds.concentrationCriticalPct
        );
        pushControl({
          bucket: `${evaluation.symbol} concentration`,
          exposure: this.formatPercent(concentrationPct),
          threshold: `Warn ${this.formatPercent(thresholds.concentrationWarnPct)} / Critical ${this.formatPercent(thresholds.concentrationCriticalPct)}`,
          status: concentrationStatus,
          action:
            concentrationPct >= thresholds.concentrationCriticalPct
              ? `Cut ${evaluation.symbol} concentration or hedge the position.`
              : concentrationPct >= thresholds.concentrationWarnPct
                ? `Keep ${evaluation.symbol} under review; it is becoming oversized.`
                : `${evaluation.symbol} concentration remains inside the configured posture.`,
          policyContextKey: account?.policyContext.contextKey || null,
          scopeType: 'asset',
          scopeKey: evaluation.symbol,
          brokerKey: evaluation.brokerKey,
          accountId: evaluation.accountId,
          symbol: evaluation.symbol,
          ruleCode: 'asset_concentration',
          metricName: 'allocationPct',
          actualValue: this.roundNumber(concentrationPct, 2),
          basisValue: this.roundNumber(equity, 2),
          warnThresholdValue: thresholds.concentrationWarnPct,
          criticalThresholdValue: thresholds.concentrationCriticalPct,
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

  private buildComputedRiskRuleEvaluations(
    accounts: AccountRiskSnapshotInput[],
    controls: ComputedRiskControlPayload[],
    evaluations: PositionRiskEvaluation[]
  ): ComputedRiskRuleEvaluationPayload[] {
    const accountNameById = new Map(
      accounts.map((account) => [account.accountId, account.accountName] as const)
    );

    const controlRows = controls.map((control, index) => {
      const normalizedStatus = this.normalizeRiskState(control.status);
      const hasAlert = normalizedStatus !== 'ok';

      return {
        policyContextKey: control.policyContextKey ?? null,
        sourceType: 'control',
        scopeType: control.scopeType || 'portfolio',
        scopeKey: control.scopeKey || control.bucket,
        scopeLabel: control.bucket,
        brokerKey: control.brokerKey ?? null,
        accountId: control.accountId ?? null,
        positionId: null,
        symbol: control.symbol ?? null,
        ruleCode: control.ruleCode || 'risk_control',
        metricName: control.metricName ?? null,
        actualValue: control.actualValue ?? null,
        basisValue: control.basisValue ?? null,
        warnThresholdValue: control.warnThresholdValue ?? null,
        criticalThresholdValue: control.criticalThresholdValue ?? null,
        status: control.status,
        bucket: control.bucket,
        exposure: control.exposure,
        threshold: control.threshold,
        action: control.action,
        alertSeverity: hasAlert
          ? normalizedStatus === 'critical'
            ? 'Critical'
            : 'Watch'
          : null,
        alertMessage: hasAlert ? `${control.bucket}: ${control.action}` : null,
        alertSymbol: hasAlert ? 'PORTFOLIO' : null,
        alertChannel: hasAlert ? 'Risk' : null,
        alertStatus: hasAlert ? 'Open' : null,
        sortOrder: control.sortOrder ?? index,
      } satisfies ComputedRiskRuleEvaluationPayload;
    });

    const positionRows = [...evaluations]
      .sort((left, right) => right.exposure - left.exposure)
      .map((evaluation, index) => {
        const normalizedStatus = this.resolveWorstRiskState(evaluation.statuses);
        const hasAlert = normalizedStatus !== 'ok';
        const accountName =
          accountNameById.get(evaluation.accountId) || evaluation.accountName || evaluation.accountId;

        return {
          policyContextKey: evaluation.policyContextKey,
          sourceType: 'position',
          scopeType: 'position',
          scopeKey: evaluation.positionId,
          scopeLabel: `${accountName} / ${evaluation.symbol}`,
          brokerKey: evaluation.brokerKey,
          accountId: evaluation.accountId,
          positionId: evaluation.positionId,
          symbol: evaluation.symbol,
          ruleCode: 'position_risk_summary',
          metricName: 'exposure',
          actualValue: this.roundNumber(evaluation.exposure, 2),
          basisValue: null,
          warnThresholdValue: null,
          criticalThresholdValue: null,
          status: this.formatRiskStateLabel(normalizedStatus),
          bucket: null,
          exposure: null,
          threshold: null,
          action: null,
          alertSeverity: hasAlert
            ? normalizedStatus === 'critical'
              ? 'Critical'
              : 'Watch'
            : null,
          alertMessage:
            hasAlert
              ? evaluation.notes[0] ||
                `${evaluation.symbol} is carrying elevated position risk on ${accountName}.`
              : null,
          alertSymbol: hasAlert ? evaluation.symbol : null,
          alertChannel: hasAlert ? 'Risk' : null,
          alertStatus: hasAlert ? 'Open' : null,
          sortOrder: 1000 + index,
        } satisfies ComputedRiskRuleEvaluationPayload;
      });

    return [...controlRows, ...positionRows];
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
      policyContextKey: account.policyContext.contextKey,
      sideKey: this.resolvePositionSideKey(position),
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
        minLeverage:
          accumulator.minLeverage === null
            ? account.thresholds.minLeverage
            : account.thresholds.minLeverage === null
              ? accumulator.minLeverage
              : Math.max(accumulator.minLeverage, account.thresholds.minLeverage),
        maxLeverage: Math.min(accumulator.maxLeverage, account.thresholds.maxLeverage),
        minNotionalPerTrade:
          accumulator.minNotionalPerTrade === null
            ? account.thresholds.minNotionalPerTrade
            : account.thresholds.minNotionalPerTrade === null
              ? accumulator.minNotionalPerTrade
              : Math.max(accumulator.minNotionalPerTrade, account.thresholds.minNotionalPerTrade),
        maxOrderAllocation:
          accumulator.maxOrderAllocation === null
            ? account.thresholds.maxOrderAllocation
            : account.thresholds.maxOrderAllocation === null
              ? accumulator.maxOrderAllocation
              : Math.min(accumulator.maxOrderAllocation, account.thresholds.maxOrderAllocation),
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

  private formatRiskStateLabel(value: string): 'Ok' | 'Watch' | 'Critical' {
    const normalized = this.normalizeRiskState(value);
    if (normalized === 'critical') {
      return 'Critical';
    }
    if (normalized === 'watch') {
      return 'Watch';
    }
    return 'Ok';
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
      minLeverage: policy.minLeverage ?? undefined,
      maxLeverage: policy.maxLeverage ?? undefined,
      minNotionalPerTrade: policy.minNotionalPerTrade ?? undefined,
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
      minLeverage: policy.minLeverage,
      maxLeverage: policy.maxLeverage,
      minNotionalPerTrade: policy.minNotionalPerTrade,
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
      minLeverage: this.readNullableNumber(rawSnapshot.minLeverage),
      maxLeverage: this.readNullableNumber(rawSnapshot.maxLeverage),
      minNotionalPerTrade: this.readNullableNumber(rawSnapshot.minNotionalPerTrade),
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
        minLeverage: validatedSnapshot.minLeverage,
        maxLeverage: validatedSnapshot.maxLeverage,
        minNotionalPerTrade: validatedSnapshot.minNotionalPerTrade,
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
      ['Min leverage', current.minLeverage ?? null, previous.minLeverage ?? null],
      ['Max leverage', current.maxLeverage ?? null, previous.maxLeverage ?? null],
      ['Min notional per trade', current.minNotionalPerTrade ?? null, previous.minNotionalPerTrade ?? null],
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
      this.hasHigherTighterConstraint(current.minLeverage, next.minLeverage),
      this.hasTighterConstraint(current.maxLeverage, next.maxLeverage),
      this.hasHigherTighterConstraint(current.minNotionalPerTrade, next.minNotionalPerTrade),
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

  private hasHigherTighterConstraint(
    currentValue: number | undefined,
    nextValue: number | undefined
  ): boolean {
    if (nextValue === undefined || nextValue === null) {
      return false;
    }

    if (currentValue === undefined || currentValue === null) {
      return true;
    }

    return nextValue > currentValue;
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
