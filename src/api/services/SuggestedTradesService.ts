import { createHash } from 'node:crypto';
import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import { RiskPreTradeCheckResult } from '../contracts/Risk';
import {
  SuggestedTradeItem,
  SuggestedTradePageAction,
  SuggestedTradeReconcileActionResult,
  SuggestedTradeOrderLinkResult,
  SuggestedTradeExecutionLink,
  SuggestedTradeProtectionState,
  SuggestedTradeRouteDecision,
  SuggestedTradeRouteAttempt,
  SuggestedTradeRouteAttemptFailureClassification,
  SuggestedTradeStatus,
  SuggestedTradeTimelineEvent,
  SuggestedTradesListResponse,
  SuggestedTradesExecutionSyncResult,
  SuggestedTradeStatusActionResult,
  SuggestedTradesSummary,
  SuggestedTradesFreshnessAudit,
} from '../contracts/SuggestedTrade';
import { successResponse } from '../utils/response';
import { BadRequestAppError, NotFoundAppError } from '../errors/AppError';
import { CreateOrderBody } from '../validators/orders.validator';
import {
  SuggestedTradeActionBody,
  SuggestedTradesExecutionSyncBody,
  SuggestedTradeOrderLinkBody,
  SuggestedTradesQuery,
  validateSuggestedTradeActionBody,
  validateSuggestedTradeId,
  validateSuggestedTradesExecutionSyncBody,
  validateSuggestedTradeOrderLinkBody,
  validateSuggestedTradesQuery,
} from '../validators/suggestedTrades.validator';
import {
  AutomationRepository,
  ActivityRepository,
  BrokerAccountRepository,
  ExchangeAssetRepository,
  FundsSnapshotRepository,
  OrdersSnapshotSourceRepository,
  OrderSubmissionLifecycleEvent,
  OrderSubmissionRequestRepository,
  PaperOrderRepository,
  PositionReadModelRepository,
  RiskPolicyRepository,
  SuggestedTradeExecutionUpsertPayload,
  SuggestedTradeRepository,
} from '../../database';
import { coreDataSource } from '../../database/data-source';
import { SuggestedTrade } from '../../database';
import { BrokerRuntimeRegistry } from '../../brokers/core/BrokerRuntimeRegistry';
import { env } from '../../env';
import {
  TRADE_SUGGESTION_EXECUTION_LIMIT_RULES,
  normalizeTradeSuggestionExecutionPolicy,
} from '../utils/automationType';
import {
  SignalFreshnessEvaluation,
  TradeSuggestionFreshnessPolicy,
  evaluateSignalFreshness,
  normalizeTradeSuggestionFreshnessPolicy,
  parseTimeframeSeconds,
  resolveFreshnessGraceSeconds,
} from '../utils/signalFreshness';
import {
  TradeSuggestionLimitOrderExpiryPolicy,
  normalizeTradeSuggestionLimitOrderExpiryPolicy,
  resolveLimitOrderExpirySeconds,
} from '../utils/tradeSuggestionOrderExpiry';
import {
  CustomRLadderTrailingStopConfig,
  CustomRLadderTrailingStopMove,
  evaluateCustomRLadderTrailingStopMove,
  resolveCustomRLadderTrailingStopConfigFromRecords,
} from '../utils/trailingStopRLadder';
import { OperationalEventService } from './OperationalEventService';
import { PaperOrderExecutionService } from './PaperOrderExecutionService';
import { BrokerReferenceDataService } from './BrokerReferenceDataService';
import { RiskPreTradeService } from './RiskPreTradeService';
import { RiskKillSwitchService } from './RiskKillSwitchService';
import {
  DeltaLiveAutoProductRulePreflightAdapter,
  DeltaProtectionOrdersAdapter,
  closeDeltaPositionForUnsafeProtection,
  describeDeltaActiveProtectionOrders,
  describeLiveProtectionOrderContext,
  hasExactlyOneDeltaProtectionPair,
  normalizeDeltaLiveAutoOrderSizing as normalizeDeltaLiveAutoOrderSizingForBroker,
  remediateDeltaLiveProtection as remediateDeltaLiveProtectionForBroker,
  resolveDeltaInactiveAttachedProtectionManualReason,
  resolveDeltaProtectionPartialExecutionReason,
  resolveDeltaProtectionLookupSymbols,
} from './suggested-trades/DeltaExchangeSuggestedTradeBroker';
import {
  MudrexLiveAutoProtectionAttachmentResult,
  attachMudrexLiveAutoProtectionIfNeeded as attachMudrexLiveAutoProtectionIfNeededForBroker,
  mudrexPositionHasProtection,
  normalizeMudrexLiveAutoOrderSizing as normalizeMudrexLiveAutoOrderSizingForBroker,
  remediateMudrexLiveProtection as remediateMudrexLiveProtectionForBroker,
  resolveMudrexRiskOrderPositionId,
  validateMudrexProtectionAttachability,
} from './suggested-trades/MudrexSuggestedTradeBroker';
import {
  isSuggestedTradeLiveAutoBrokerEnabled,
  isSuggestedTradeProtectionRepairEnabledForBroker,
  resolveSuggestedTradeLiveAutoRuntimeConfig,
} from './suggested-trades/SuggestedTradeBrokerControls';
import type {
  LiveAutoAdaptiveRoutingMode,
  LiveAutoRuntimeConfig,
} from './suggested-trades/SuggestedTradeBrokerControls';

type TradeSuggestionExecutionMode = 'suggestion_only' | 'paper_trade_auto' | 'live_trade_auto';
type TradeSuggestionApprovalMode = 'manual_review' | 'auto_if_safe';
type TradeSuggestionRouteMode = 'strategy_default' | 'user_default' | 'fixed';
type TradeSuggestionOrderType = 'market' | 'limit';
type TradeSuggestionQuantityMode = 'quantity' | 'notional' | 'risk_percent';
type SuggestedTradePreTradeState = NonNullable<SuggestedTradeExecutionLink['preTradeState']>;
const SUGGESTED_TRADES_FRESHNESS_AUDIT_LOOKBACK_DAYS = 7;
const SUGGESTED_TRADES_FRESHNESS_AUDIT_LIMIT = 5000;
const LIVE_AUTO_LIFECYCLE_MONITOR_INTERVAL_MS = 1500;
const LIVE_AUTO_LIFECYCLE_MONITOR_DEFAULT_DURATION_MS = 5 * 60 * 1000;
const LIVE_AUTO_LIFECYCLE_MONITOR_MAX_DURATION_MS = 15 * 60 * 1000;
const SUGGESTED_TRADE_PROTECTION_STATES = new Set<SuggestedTradeProtectionState>([
  'pending',
  'waiting_for_fill',
  'waiting_for_position',
  'attaching',
  'attached',
  'failed',
  'manual_unlinked',
  'not_required',
  'unknown',
]);
const REMEDIABLE_SUGGESTED_TRADE_PROTECTION_STATES = new Set<SuggestedTradeProtectionState>([
  'pending',
  'waiting_for_fill',
  'waiting_for_position',
  'attaching',
]);

interface ResolvedTradeSuggestionExecutionPolicy {
  executionMode: TradeSuggestionExecutionMode;
  approvalMode: TradeSuggestionApprovalMode;
  routeMode: TradeSuggestionRouteMode;
  brokerKey: string | null;
  accountId: string | null;
  liveConsentEnabled: boolean;
  orderType: TradeSuggestionOrderType;
  timeInForce: 'GTC' | 'IOC' | 'FOK' | null;
  quantityMode: TradeSuggestionQuantityMode;
  quantity: number | null;
  notional: number | null;
  riskPercent: number | null;
  leverage: number | null;
  reduceOnly: boolean;
  deltaProtectionMode: string | null;
  maxOrdersPerRun: number;
  maxOrdersPerDay: number;
  maxConcurrentOpenTrades: number;
  maxNotionalPerTrade: number | null;
  maxNotionalPerDay: number | null;
  dedupeWindowSeconds: number;
  freshness: TradeSuggestionFreshnessPolicy;
  limitOrderExpiry?: TradeSuggestionLimitOrderExpiryPolicy;
}

interface SuggestedTradePreTradeGate {
  result: RiskPreTradeCheckResult;
  execution: SuggestedTradeExecutionLink;
  ready: boolean;
  routeCandidates?: EvaluatedRouteCandidate[];
}

interface SuggestedTradeAutoPaperExecutionResult {
  outcome: 'disabled' | 'skipped' | 'blocked' | 'placed' | 'failed';
  message: string;
  suggestedTradeId: string;
  paperOrderId?: string | null;
  preTradeCheckId?: string | null;
}

interface SuggestedTradeProtectionPersistence {
  protectionState: SuggestedTradeProtectionState | null;
  protectionSource: string | null;
  protectionPlan: Record<string, unknown> | null;
  protectionAttempts: number | null;
  protectionLastError: string | null;
  protectionCheckedAt: string | null;
  protectionAttachedAt: string | null;
}

type SuggestedTradeAutoLiveRolloutOutcome =
  | 'disabled'
  | 'skipped'
  | 'blocked'
  | 'ready'
  | 'working'
  | 'placed'
  | 'failed';

interface SuggestedTradeAutoLiveRolloutResult {
  outcome: SuggestedTradeAutoLiveRolloutOutcome;
  message: string;
  suggestedTradeId: string;
  brokerKey?: string | null;
  accountId?: string | null;
  preTradeCheckId?: string | null;
  orderId?: string | null;
  protectionState?: SuggestedTradeProtectionState | null;
  freshness?: SuggestedTradeAutoLiveFreshnessSnapshot | null;
}

interface SuggestedTradeAutoLiveFreshnessSnapshot {
  allowed: boolean;
  enabled: boolean;
  reason: string;
  timeframe: string;
  timeframeSeconds: number | null;
  signalTime: string | null;
  candleCloseAt: string | null;
  evaluatedAt: string;
  ageAfterCloseSeconds: number | null;
  maxAgeAfterCloseSeconds: number | null;
  currentRunFreshnessFloorSeconds: number | null;
}

interface LiveAutoRolloutGuardDecision {
  allowed: boolean;
  outcome: 'disabled' | 'blocked';
  message: string;
  brokerKey: string | null;
  accountId: string | null;
}

interface SuggestedTradePreTradeRequest {
  snapshotId?: string;
  suggestedTradeId: string;
  automationId: string;
  automationRunId: string;
  sourceType: string;
  executionMode: 'paper' | 'live';
  approvalMode: 'manual_review' | 'auto_if_safe';
  routing: {
    routeMode: 'strategy_default' | 'user_default' | 'fixed';
    brokerKey?: string | null;
    accountId?: string | null;
  };
  order: {
    symbol: string;
    timeframe: string;
    side: 'BUY' | 'SELL';
    orderType: 'market' | 'limit';
    timeInForce?: 'GTC' | 'IOC' | 'FOK' | null;
    quantityMode: 'quantity' | 'notional' | 'risk_percent';
    quantity?: number | null;
    notional?: number | null;
    riskPercent?: number | null;
    entryPrice?: number | null;
    stopLossPrice?: number | null;
    takeProfitTargets?: number[] | null;
    leverage?: number | null;
    reduceOnly: boolean;
  };
}

interface AdaptivePreTradeRouteDecision {
  request: SuggestedTradePreTradeRequest;
  previewBlock?: RiskPreTradeCheckResult | null;
  routeDecision?: SuggestedTradeRouteDecision | null;
  routeCandidates?: EvaluatedRouteCandidate[];
}

interface DefaultRouteCandidate {
  brokerKey: string;
  accountId: string;
  accountName: string | null;
  shadowOnly?: boolean;
  shadowReason?: string | null;
}

interface EvaluatedRouteCandidate {
  route: DefaultRouteCandidate;
  request: SuggestedTradePreTradeRequest;
  preview: RiskPreTradeCheckResult;
  assetRoute: ResolvedLiveAutoAssetRoute | null;
  support: {
    supported: boolean;
    message: string | null;
  };
}

interface ResolvedLiveAutoAssetRoute {
  assetId: string;
  requestedSymbol: string;
  brokerSymbol: string;
  candidateSymbols: string[];
  resolvedVia: 'catalog_exact' | 'catalog_equivalent' | 'remote_exact' | 'remote_equivalent';
}

interface NormalizedLiveAutoOrderSizing {
  quantity: number;
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  auditNote: string | null;
}

interface LiveAutoRouteGate {
  result: RiskPreTradeCheckResult;
  execution: SuggestedTradeExecutionLink;
  ready: boolean;
  candidate?: EvaluatedRouteCandidate | null;
  candidateRank: number;
}

interface PreparedLiveAutoRoute {
  gate: LiveAutoRouteGate;
  brokerKey: string;
  accountId: string;
  requestOrder: Record<string, unknown>;
  requestedNotional: number | null;
  leverage: number;
  orderType: 'market' | 'limit';
  triggerType: 'immediate' | 'GTC';
  side: 'long' | 'short';
  resolvedAssetRoute: ResolvedLiveAutoAssetRoute;
  normalizedQuantity: number;
  normalizedEntryPrice: number;
  normalizedStopLossPrice: number;
  normalizedTakeProfitPrice: number;
  normalizedSizingNote: string | null;
  deltaProtectionMode: string | null;
  policyLeverageNote: string;
  preTradeCheckId: string | null;
}

interface LiveAutoRoutePreparationFailure {
  gate: LiveAutoRouteGate;
  brokerKey: string | null;
  accountId: string | null;
  message: string;
  outcome: 'blocked' | 'failed';
  executionState: SuggestedTradeExecutionLink['executionState'];
  preTradeState?: SuggestedTradeExecutionLink['preTradeState'];
  preTradeBlockedReason?: string | null;
  failureClassification: SuggestedTradeRouteAttemptFailureClassification;
  preTradeCheckId: string | null;
}

type LiveAutoRoutePreparationResult =
  | { ok: true; prepared: PreparedLiveAutoRoute }
  | { ok: false; failure: LiveAutoRoutePreparationFailure };

type LiveAutoRouteReconciliationStatus = NonNullable<
  SuggestedTradeRouteAttempt['reconciliation']
>['status'];

interface LiveAutoRouteReconciliationResult {
  status: LiveAutoRouteReconciliationStatus;
  checkedAt: string;
  message: string;
  order?: Record<string, unknown> | null;
  orderId?: string | null;
  orderStatus?: string | null;
  position?: Record<string, unknown> | null;
  positionId?: string | null;
  positionStatus?: string | null;
}

interface LiveAutoBrokerRecordLookup {
  checked: boolean;
  records: Record<string, unknown>[];
  error?: string | null;
}

interface LiveAutoLifecycleMonitorInput {
  userId: string;
  suggestedTradeId: string;
  brokerKey: string;
  accountId: string;
  orderId: string | null;
}

interface LiveAutoOrderPlacementHandler {
  createOrder: (
    assetId: string,
    body: CreateOrderBody,
    context?: { suggestedTradeId?: string | null }
  ) => Promise<unknown>;
}

interface ExecutionRefreshOptions {
  resolveStaleGaps?: boolean;
  allowPositionEvidenceFill?: boolean;
}

interface LivePositionSnapshot {
  externalId: string;
  status: string | null;
  statusRank: number | null;
  firstSeenAt: Date | string | null;
  lastSeenAt: Date | string | null;
  payload: Record<string, unknown> | null;
}

interface LiveProtectionOrderContext {
  stopLossOrderId: string | null;
  takeProfitOrderId: string | null;
  stopLossStatus: string | null;
  takeProfitStatus: string | null;
  activeOrderIds: string[];
  orderDetails?: Record<
    string,
    {
      status?: string | null;
      quantity?: number | null;
      filledQuantity?: number | null;
      remainingQuantity?: number | null;
      stopPrice?: number | null;
      limitPrice?: number | null;
      stopOrderType?: string | null;
    }
  >;
}

interface DeltaActiveProtectionOrders {
  stopLossOrderIds: string[];
  takeProfitOrderIds: string[];
  unclassifiedOrderIds: string[];
  activeOrderIds: string[];
  orderDetails: NonNullable<LiveProtectionOrderContext['orderDetails']>;
}

interface DeltaProtectionOrderCandidate {
  externalId?: unknown;
  orderStatus?: unknown;
  statusRank?: unknown;
  side?: unknown;
  reduceOnly?: unknown;
  stopOrderType?: unknown;
  orderType?: unknown;
  stopPrice?: unknown;
  limitPrice?: unknown;
  quantity?: unknown;
  size?: unknown;
  filledQuantity?: unknown;
  remainingQuantity?: unknown;
  unfilledSize?: unknown;
}

@Service()
export class SuggestedTradesService {
  @Inject(() => SuggestedTradeRepository)
  private suggestedTradeRepository!: SuggestedTradeRepository;

  @Inject(() => ActivityRepository)
  private activityRepository!: ActivityRepository;

  @Inject(() => OperationalEventService)
  private operationalEventService!: OperationalEventService;

  @Inject(() => PaperOrderRepository)
  private paperOrderRepository!: PaperOrderRepository;

  @Inject(() => PaperOrderExecutionService)
  private paperOrderExecutionService!: PaperOrderExecutionService;

  @Inject(() => AutomationRepository)
  private automationRepository!: AutomationRepository;

  @Inject(() => BrokerAccountRepository)
  private brokerAccountRepository!: BrokerAccountRepository;

  @Inject(() => PositionReadModelRepository)
  private positionReadModelRepository!: PositionReadModelRepository;

  @Inject(() => OrdersSnapshotSourceRepository)
  private ordersSnapshotSourceRepository!: OrdersSnapshotSourceRepository;

  @Inject(() => OrderSubmissionRequestRepository)
  private orderSubmissionRequestRepository!: OrderSubmissionRequestRepository;

  @Inject(() => ExchangeAssetRepository)
  private exchangeAssetRepository!: ExchangeAssetRepository;

  @Inject(() => FundsSnapshotRepository)
  private fundsSnapshotRepository!: FundsSnapshotRepository;

  @Inject(() => RiskPolicyRepository)
  private riskPolicyRepository!: RiskPolicyRepository;

  @Inject(() => BrokerReferenceDataService)
  private brokerReferenceDataService!: BrokerReferenceDataService;

  @Inject(() => BrokerRuntimeRegistry)
  private brokerRuntimeRegistry!: BrokerRuntimeRegistry;

  @Inject(() => RiskPreTradeService)
  private riskPreTradeService!: RiskPreTradeService;

  @Inject(() => RiskKillSwitchService)
  private riskKillSwitchService!: RiskKillSwitchService;

  private liveAutoLifecycleMonitorKeys = new Set<string>();
  private liveAutoLifecycleMonitorEnabled = true;

  async getSuggestedTrades(
    userId: string,
    query: SuggestedTradesQuery
  ): Promise<ApiSuccessResponse<SuggestedTradesListResponse>> {
    const params = validateSuggestedTradesQuery(query);
    const { items, total } = await this.suggestedTradeRepository.listSuggestedTrades({
      userId,
      limit: params.limit,
      offset: params.offset,
      automationId: params.automationId,
      automationRunId: params.automationRunId,
      status: params.status,
      executionState: params.executionState,
      symbol: params.symbol,
      timeframe: params.timeframe,
      side: params.side,
      search: params.search,
    });

    return successResponse({
      items: items.map((item) => this.mapSuggestedTrade(item)),
      total,
      limit: params.limit,
      offset: params.offset,
    });
  }

  async getSuggestedTradesSummary(
    userId: string,
    query: SuggestedTradesQuery = {}
  ): Promise<ApiSuccessResponse<SuggestedTradesSummary>> {
    const params = validateSuggestedTradesQuery(query);
    const summaryQuery = {
      automationId: params.automationId,
      automationRunId: params.automationRunId,
      status: params.status,
      executionState: params.executionState,
      symbol: params.symbol,
      timeframe: params.timeframe,
      side: params.side,
      search: params.search,
    };
    const [summary, freshnessAudit] = await Promise.all([
      this.suggestedTradeRepository.getSuggestedTradesSummary(userId, summaryQuery),
      this.getSuggestedTradesFreshnessAudit({
        userId,
        query: summaryQuery,
      }),
    ]);
    return successResponse({
      ...summary,
      freshnessAudit,
    });
  }

  async getSuggestedTradesFreshnessAudit(
    options: {
      userId?: string | null;
      query?: Partial<SuggestedTradesQuery>;
      lookbackDays?: number;
      limit?: number;
    } = {}
  ): Promise<SuggestedTradesFreshnessAudit> {
    const lookbackDays = this.normalizeAuditLookbackDays(options.lookbackDays);
    const windowStart = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
    const limit = Math.max(
      1,
      Math.min(25000, Math.floor(options.limit ?? SUGGESTED_TRADES_FRESHNESS_AUDIT_LIMIT))
    );
    const query = options.query ?? {};
    const userId = this.readStringValue(options.userId);

    const [sample, liveAutoStaleSkipped, staleSuggestedTradeBlocked] = await Promise.all([
      this.suggestedTradeRepository.listSuggestedTradesForFreshnessAudit({
        userId,
        createdAfter: windowStart,
        limit,
        automationId: query.automationId,
        automationRunId: query.automationRunId,
        status: query.status,
        executionState: query.executionState,
        symbol: query.symbol,
        timeframe: query.timeframe,
        side: query.side,
        search: query.search,
      }),
      this.activityRepository.countOperationalActivities({
        userId,
        type: 'Suggested Trade',
        titleLike: 'Live auto stale signal skipped',
        status: 'Warning',
        stream: 'Execution',
        createdAfter: windowStart,
      }),
      this.activityRepository.countOperationalActivities({
        userId,
        type: 'Suggested Trade',
        titleLike: 'Stale suggested trade blocked',
        status: 'Warning',
        stream: 'Execution',
        createdAfter: windowStart,
      }),
    ]);

    return this.summarizeSuggestedTradeFreshnessAudit(sample.items, {
      lookbackDays,
      windowStart,
      sampledSignals: sample.sampled,
      totalSignals: sample.total,
      staleBlockedCount: liveAutoStaleSkipped + staleSuggestedTradeBlocked,
    });
  }

  private summarizeSuggestedTradeFreshnessAudit(
    items: SuggestedTrade[],
    context: {
      lookbackDays: number;
      windowStart: Date;
      sampledSignals: number;
      totalSignals: number;
      staleBlockedCount: number;
    }
  ): SuggestedTradesFreshnessAudit {
    const defaultFreshnessPolicy = normalizeTradeSuggestionFreshnessPolicy({});
    const timeframeBuckets = new Map<
      string,
      {
        totalSignals: number;
        openedSignals: number;
        staleOpenCount: number;
        signalToSuggestionTotalMs: number;
        signalToSuggestionCount: number;
        signalToOpenTotalMs: number;
        signalToOpenCount: number;
        maxSignalToOpenMs: number | null;
      }
    >();
    const worstDelays: SuggestedTradesFreshnessAudit['worstDelays'] = [];

    let openedSignals = 0;
    let staleOpenCount = 0;
    let latestClosedOnlyCount = 0;
    let cursorGapCount = 0;
    let unknownSignalSelectionModeCount = 0;
    let signalToSuggestionTotalMs = 0;
    let signalToSuggestionCount = 0;
    let signalToOpenTotalMs = 0;
    let signalToOpenCount = 0;
    let maxSignalToOpenMs: number | null = null;

    for (const item of items) {
      const signalMs = this.toTimestamp(item.signalTime);
      const createdMs = this.toTimestamp(item.createdAt);
      if (!signalMs || !createdMs) {
        continue;
      }

      const timeframe = String(item.timeframe || '').trim() || 'unknown';
      const bucket = timeframeBuckets.get(timeframe) ?? {
        totalSignals: 0,
        openedSignals: 0,
        staleOpenCount: 0,
        signalToSuggestionTotalMs: 0,
        signalToSuggestionCount: 0,
        signalToOpenTotalMs: 0,
        signalToOpenCount: 0,
        maxSignalToOpenMs: null,
      };
      bucket.totalSignals += 1;
      timeframeBuckets.set(timeframe, bucket);

      const meta = this.readRecordValue(item.meta) ?? {};
      const signalSelectionMode = this.readStringValue(meta.signalSelectionMode);
      if (signalSelectionMode === 'latest_closed_only') {
        latestClosedOnlyCount += 1;
      } else if (signalSelectionMode === 'cursor_gap') {
        cursorGapCount += 1;
      } else {
        unknownSignalSelectionModeCount += 1;
      }

      const signalToSuggestionMs = Math.max(0, createdMs - signalMs);
      signalToSuggestionTotalMs += signalToSuggestionMs;
      signalToSuggestionCount += 1;
      bucket.signalToSuggestionTotalMs += signalToSuggestionMs;
      bucket.signalToSuggestionCount += 1;

      const execution = this.getExecutionLink(item);
      const openedAt = execution?.positionOpenedAt ?? execution?.filledAt ?? null;
      const openedMs = this.toTimestamp(openedAt);
      if (!openedMs) {
        continue;
      }

      const signalToOpenMs = Math.max(0, openedMs - signalMs);
      const timeframeSeconds = parseTimeframeSeconds(timeframe);
      const maxAgeAfterCloseSeconds = resolveFreshnessGraceSeconds(
        timeframe,
        defaultFreshnessPolicy
      );
      const candleCloseMs = timeframeSeconds ? signalMs + timeframeSeconds * 1000 : null;
      const openAgeAfterCloseMs =
        candleCloseMs === null ? null : Math.max(0, openedMs - candleCloseMs);
      const stale =
        openAgeAfterCloseMs !== null &&
        maxAgeAfterCloseSeconds !== null &&
        openAgeAfterCloseMs > maxAgeAfterCloseSeconds * 1000;

      openedSignals += 1;
      signalToOpenTotalMs += signalToOpenMs;
      signalToOpenCount += 1;
      maxSignalToOpenMs =
        maxSignalToOpenMs === null ? signalToOpenMs : Math.max(maxSignalToOpenMs, signalToOpenMs);
      if (stale) {
        staleOpenCount += 1;
      }

      bucket.openedSignals += 1;
      bucket.signalToOpenTotalMs += signalToOpenMs;
      bucket.signalToOpenCount += 1;
      bucket.maxSignalToOpenMs =
        bucket.maxSignalToOpenMs === null
          ? signalToOpenMs
          : Math.max(bucket.maxSignalToOpenMs, signalToOpenMs);
      if (stale) {
        bucket.staleOpenCount += 1;
      }

      worstDelays.push({
        suggestedTradeId: item.id,
        symbol: item.symbol,
        timeframe,
        side: item.side as SuggestedTradesFreshnessAudit['worstDelays'][number]['side'],
        signalTime: item.signalTime.toISOString(),
        suggestedTradeCreatedAt: item.createdAt.toISOString(),
        openedAt: new Date(openedMs).toISOString(),
        executionMode: execution?.executionMode ?? null,
        executionState: this.buildExecutionStage(execution),
        brokerKey: execution?.brokerKey ?? null,
        accountId: execution?.accountId ?? null,
        signalSelectionMode,
        signalToSuggestionMinutes: this.toAuditMinutes(signalToSuggestionMs),
        signalToOpenMinutes: this.toAuditMinutes(signalToOpenMs),
        openAgeAfterCloseMinutes:
          openAgeAfterCloseMs === null ? null : this.toAuditMinutes(openAgeAfterCloseMs),
        maxAgeAfterCloseMinutes:
          maxAgeAfterCloseSeconds === null
            ? null
            : this.toAuditMinutes(maxAgeAfterCloseSeconds * 1000),
        stale,
      });
    }

    return {
      lookbackDays: context.lookbackDays,
      windowStart: context.windowStart.toISOString(),
      generatedAt: new Date().toISOString(),
      sampledSignals: context.sampledSignals,
      totalSignals: context.totalSignals,
      openedSignals,
      staleOpenCount,
      staleBlockedCount: context.staleBlockedCount,
      latestClosedOnlyCount,
      cursorGapCount,
      unknownSignalSelectionModeCount,
      averageSignalToSuggestionMinutes: this.toAuditAverageMinutes(
        signalToSuggestionTotalMs,
        signalToSuggestionCount
      ),
      averageSignalToOpenMinutes: this.toAuditAverageMinutes(
        signalToOpenTotalMs,
        signalToOpenCount
      ),
      maxSignalToOpenMinutes:
        maxSignalToOpenMs === null ? null : this.toAuditMinutes(maxSignalToOpenMs),
      byTimeframe: Array.from(timeframeBuckets.entries())
        .map(([timeframe, bucket]) => ({
          timeframe,
          totalSignals: bucket.totalSignals,
          openedSignals: bucket.openedSignals,
          staleOpenCount: bucket.staleOpenCount,
          averageSignalToSuggestionMinutes: this.toAuditAverageMinutes(
            bucket.signalToSuggestionTotalMs,
            bucket.signalToSuggestionCount
          ),
          averageSignalToOpenMinutes: this.toAuditAverageMinutes(
            bucket.signalToOpenTotalMs,
            bucket.signalToOpenCount
          ),
          maxSignalToOpenMinutes:
            bucket.maxSignalToOpenMs === null
              ? null
              : this.toAuditMinutes(bucket.maxSignalToOpenMs),
        }))
        .sort(
          (left, right) =>
            right.totalSignals - left.totalSignals || left.timeframe.localeCompare(right.timeframe)
        ),
      worstDelays: worstDelays
        .sort((left, right) => (right.signalToOpenMinutes ?? 0) - (left.signalToOpenMinutes ?? 0))
        .slice(0, 5),
    };
  }

  private normalizeAuditLookbackDays(value: unknown): number {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return SUGGESTED_TRADES_FRESHNESS_AUDIT_LOOKBACK_DAYS;
    }
    return Math.max(1, Math.min(30, Math.floor(numeric)));
  }

  private toAuditAverageMinutes(totalMs: number, count: number): number | null {
    if (count <= 0) {
      return null;
    }
    return this.toAuditMinutes(totalMs / count);
  }

  private toAuditMinutes(valueMs: number): number {
    return Number((Math.max(0, valueMs) / 60000).toFixed(2));
  }

  async getSuggestedTradeById(
    userId: string,
    suggestedTradeId: string
  ): Promise<ApiSuccessResponse<SuggestedTradeItem>> {
    const trade = await this.suggestedTradeRepository.getSuggestedTradeById(
      userId,
      validateSuggestedTradeId(suggestedTradeId)
    );
    if (!trade) {
      throw new NotFoundAppError('Suggested trade not found');
    }
    return successResponse(this.mapSuggestedTrade(trade));
  }

  async syncExecutionForOrderUpdates(
    userId: string,
    brokerKey: string,
    accountId: string,
    orderIds: string[]
  ): Promise<number> {
    const trades = await this.suggestedTradeRepository.findLinkedTradesByOrderIds(
      userId,
      brokerKey,
      accountId,
      orderIds
    );
    if (!trades.length) {
      return 0;
    }
    return this.refreshExecutionOutcomes(userId, trades);
  }

  async syncExecutionForPositionUpdates(
    userId: string,
    brokerKey: string,
    accountId: string,
    symbols: string[]
  ): Promise<number> {
    const trades = await this.suggestedTradeRepository.findLinkedTradesBySymbols(
      userId,
      brokerKey,
      accountId,
      symbols
    );
    if (!trades.length) {
      return 0;
    }
    return this.refreshExecutionOutcomes(userId, trades, {
      allowPositionEvidenceFill: true,
    });
  }

  async syncExecutionForPaperOrderUpdates(
    userId: string,
    paperOrderIds: string[]
  ): Promise<number> {
    const trades = await this.suggestedTradeRepository.findLinkedTradesByPaperOrderIds(
      userId,
      paperOrderIds
    );
    if (!trades.length) {
      return 0;
    }
    return this.refreshExecutionOutcomes(userId, trades);
  }

  async syncStaleTrackedExecutionTrades(options: { limit?: number; staleBefore?: Date }): Promise<{
    processed: number;
    refreshed: number;
    userCount: number;
    suggestedTradeIds: string[];
  }> {
    const limit = Math.max(1, options.limit ?? env.suggestedTradesSync.batchSize);
    const staleBefore =
      options.staleBefore ?? new Date(Date.now() - env.suggestedTradesSync.staleAfterMs);
    const staleTrades = await this.suggestedTradeRepository.listStaleTrackedTradesGlobal(
      limit,
      staleBefore
    );
    const protectionTrades =
      await this.suggestedTradeRepository.listProtectionRemediationCandidates(limit, staleBefore, {
        automaticStaleBefore: new Date(),
      });
    const trades = this.mergeUniqueSuggestedTrades([...protectionTrades, ...staleTrades]).slice(
      0,
      limit
    );
    if (!trades.length) {
      return {
        processed: 0,
        refreshed: 0,
        userCount: 0,
        suggestedTradeIds: [],
      };
    }

    const tradesByUser = new Map<string, SuggestedTrade[]>();
    for (const trade of trades) {
      const userId = String(trade.userId || '').trim();
      if (!userId) {
        continue;
      }
      const next = tradesByUser.get(userId) ?? [];
      next.push(trade);
      tradesByUser.set(userId, next);
    }

    let refreshed = 0;
    for (const [userId, userTrades] of tradesByUser.entries()) {
      refreshed += await this.refreshExecutionOutcomes(userId, userTrades, {
        resolveStaleGaps: true,
      });
    }

    return {
      processed: trades.length,
      refreshed,
      userCount: tradesByUser.size,
      suggestedTradeIds: trades.map((trade) => trade.id),
    };
  }

  private mergeUniqueSuggestedTrades(trades: SuggestedTrade[]): SuggestedTrade[] {
    const seen = new Set<string>();
    const unique: SuggestedTrade[] = [];
    for (const trade of trades) {
      const id = this.readStringValue(trade.id);
      if (!id || seen.has(id)) {
        continue;
      }
      seen.add(id);
      unique.push(trade);
    }
    return unique;
  }

  async reconcileSuggestedTradesExecution(
    userId: string,
    body: SuggestedTradesExecutionSyncBody
  ): Promise<ApiSuccessResponse<SuggestedTradesExecutionSyncResult>> {
    const payload = validateSuggestedTradesExecutionSyncBody(body);
    const staleBefore = new Date(Date.now() - env.suggestedTradesSync.staleAfterMs);

    try {
      const candidateTrades = payload.suggestedTradeIds?.length
        ? await this.suggestedTradeRepository.getSuggestedTradesByIds(
            userId,
            payload.suggestedTradeIds
          )
        : await this.suggestedTradeRepository.listExecutionSyncCandidates({
            userId,
            limit: payload.limit,
            automationId: payload.automationId,
            automationRunId: payload.automationRunId,
            status: payload.status,
            executionState: payload.executionState,
            symbol: payload.symbol,
            timeframe: payload.timeframe,
            side: payload.side,
            search: payload.search,
            staleOnly: payload.staleOnly,
            staleBefore,
          });

      const trades = payload.staleOnly
        ? candidateTrades.filter((trade) =>
            this.isExecutionTrackingStale(trade, this.getExecutionLink(trade), staleBefore)
          )
        : candidateTrades.filter((trade) =>
            this.hasExecutionTracking(this.getExecutionLink(trade))
          );

      const refreshed = trades.length
        ? await this.refreshExecutionOutcomes(userId, trades, {
            resolveStaleGaps: payload.staleOnly,
          })
        : 0;
      const suggestedTradeIds = trades.map((trade) => trade.id);

      await this.operationalEventService.logActivity(userId, {
        type: 'Suggested Trade',
        title: 'Suggested trade execution sync requested',
        status: 'Success',
        route: 'Suggested Trades',
        stream: 'Execution',
        related: `${trades.length} trade(s)`,
        description:
          refreshed > 0
            ? `Refreshed ${refreshed} of ${trades.length} tracked trades`
            : trades.length > 0
              ? 'Tracked trades were already current'
              : 'No tracked trades matched the sync request',
      });

      return successResponse({
        message:
          refreshed > 0
            ? 'Suggested trade executions refreshed'
            : trades.length > 0
              ? 'Suggested trade executions already current'
              : 'No suggested trades required execution refresh',
        processed: trades.length,
        refreshed,
        staleOnly: payload.staleOnly,
        suggestedTradeIds,
      });
    } catch (error) {
      await this.operationalEventService.logActivity(userId, {
        type: 'Suggested Trade',
        title: 'Suggested trade execution sync failed',
        status: 'Failed',
        route: 'Suggested Trades',
        stream: 'Execution',
        description: error instanceof Error ? error.message : String(error),
      });
      await this.operationalEventService.emitFailureAlert(userId, {
        channel: 'Suggested Trades',
        source: 'suggested-trades',
        message: `Suggested trade execution sync failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        route: 'Alerts',
      });
      throw error;
    }
  }

  async reviewSuggestedTrade(
    userId: string,
    suggestedTradeId: string,
    body: SuggestedTradeActionBody
  ): Promise<ApiSuccessResponse<SuggestedTradeStatusActionResult>> {
    return this.updateSuggestedTradeStatus(userId, suggestedTradeId, body, 'Reviewed', {
      successMessage: 'Suggested trade marked as reviewed',
      activityTitle: 'Suggested trade reviewed',
      failureTitle: 'Suggested trade review failed',
      failureMessagePrefix: 'Suggested trade review failed',
    });
  }

  async acceptSuggestedTrade(
    userId: string,
    suggestedTradeId: string,
    body: SuggestedTradeActionBody
  ): Promise<ApiSuccessResponse<SuggestedTradeStatusActionResult>> {
    return this.updateSuggestedTradeStatus(userId, suggestedTradeId, body, 'Accepted', {
      successMessage: 'Suggested trade accepted',
      activityTitle: 'Suggested trade accepted',
      failureTitle: 'Suggested trade accept failed',
      failureMessagePrefix: 'Suggested trade accept failed',
    });
  }

  async dismissSuggestedTrade(
    userId: string,
    suggestedTradeId: string,
    body: SuggestedTradeActionBody
  ): Promise<ApiSuccessResponse<SuggestedTradeStatusActionResult>> {
    return this.updateSuggestedTradeStatus(userId, suggestedTradeId, body, 'Dismissed', {
      successMessage: 'Suggested trade dismissed',
      activityTitle: 'Suggested trade dismissed',
      failureTitle: 'Suggested trade dismiss failed',
      failureMessagePrefix: 'Suggested trade dismiss failed',
    });
  }

  async linkSuggestedTradeOrder(
    userId: string,
    suggestedTradeId: string,
    body: SuggestedTradeOrderLinkBody
  ): Promise<ApiSuccessResponse<SuggestedTradeOrderLinkResult>> {
    const validatedTradeId = validateSuggestedTradeId(suggestedTradeId);
    const payload = validateSuggestedTradeOrderLinkBody(body);
    const trade = await this.suggestedTradeRepository.getSuggestedTradeById(
      userId,
      validatedTradeId
    );

    if (!trade) {
      throw new NotFoundAppError('Suggested trade not found');
    }
    if (trade.status !== 'Accepted') {
      throw new BadRequestAppError('Only accepted suggested trades can be handed off to orders');
    }

    await this.assertOrderLinkAllowed(userId, trade, payload);
    const gatedExecution = await this.runPreTradeGate(userId, trade, {
      sourceType: 'suggested_trade_link',
      linkPayload: payload,
    });
    if (!gatedExecution.ready) {
      throw new BadRequestAppError(
        gatedExecution.result.decision.summary ||
          'Pre-trade check did not clear this suggested trade for order handoff'
      );
    }

    const nextExecution: SuggestedTradeExecutionLink = {
      ...gatedExecution.execution,
      executionMode:
        payload.executionMode ??
        (payload.paperOrderId
          ? 'paper'
          : payload.orderId
            ? 'live'
            : (gatedExecution.execution.executionMode ?? 'live')),
      orderId: payload.orderId ?? null,
      paperOrderId: payload.paperOrderId ?? null,
      brokerKey: payload.brokerKey ?? gatedExecution.execution.brokerKey ?? null,
      accountId: payload.accountId ?? gatedExecution.execution.accountId ?? null,
      orderStatus: payload.orderStatus ?? gatedExecution.execution.orderStatus ?? null,
      paperOrderStatus:
        payload.paperOrderStatus ?? gatedExecution.execution.paperOrderStatus ?? null,
      executionState: payload.orderId || payload.paperOrderId ? 'linked' : null,
      orderType: payload.orderType ?? gatedExecution.execution.orderType ?? null,
      triggerType: payload.triggerType ?? gatedExecution.execution.triggerType ?? null,
      leverage: payload.leverage ?? gatedExecution.execution.leverage ?? null,
      quantity: payload.quantity ?? gatedExecution.execution.quantity ?? null,
      entryPrice:
        payload.entryPrice === undefined
          ? (gatedExecution.execution.entryPrice ?? null)
          : String(payload.entryPrice),
      stopLossPrice:
        payload.stopLossPrice === undefined
          ? (gatedExecution.execution.stopLossPrice ?? null)
          : String(payload.stopLossPrice),
      takeProfitPrice:
        payload.takeProfitPrice === undefined
          ? (gatedExecution.execution.takeProfitPrice ?? null)
          : String(payload.takeProfitPrice),
      linkedAt: new Date().toISOString(),
      note: payload.note ?? gatedExecution.execution.note ?? null,
    };

    await this.persistExecutionState(trade, nextExecution);
    if (payload.paperOrderId) {
      await this.paperOrderRepository.attachSuggestedTrade(userId, payload.paperOrderId, trade.id);
    }
    const updatedTrade =
      (await this.suggestedTradeRepository.getSuggestedTradeById(userId, validatedTradeId)) ??
      trade;

    await this.operationalEventService.logActivity(userId, {
      type: 'Suggested Trade',
      title: `Suggested trade routed to orders: ${updatedTrade.symbol}`,
      status: 'Success',
      route: 'Orders',
      stream: 'Execution',
      related: `${updatedTrade.symbol} · ${updatedTrade.timeframe}`,
      referenceId: updatedTrade.id,
      symbol: updatedTrade.symbol,
      description: payload.orderId
        ? `Linked to order ${payload.orderId}`
        : 'Linked to order ticket',
    });

    return successResponse({
      message: payload.orderId
        ? 'Suggested trade linked to created order'
        : 'Suggested trade linked to order ticket',
      suggestedTrade: {
        id: updatedTrade.id,
        status: updatedTrade.status as SuggestedTradeOrderLinkResult['suggestedTrade']['status'],
        updatedAt: updatedTrade.updatedAt.toISOString(),
        execution: this.getExecutionLink(updatedTrade),
      },
    });
  }

  async reconcileSuggestedTradeExecution(
    userId: string,
    suggestedTradeId: string
  ): Promise<ApiSuccessResponse<SuggestedTradeReconcileActionResult>> {
    const validatedTradeId = validateSuggestedTradeId(suggestedTradeId);

    try {
      const trade = await this.suggestedTradeRepository.getSuggestedTradeById(
        userId,
        validatedTradeId
      );
      if (!trade) {
        throw new NotFoundAppError('Suggested trade not found');
      }

      const refreshed = (await this.refreshExecutionOutcomes(userId, [trade])) > 0;
      const currentTrade =
        (await this.suggestedTradeRepository.getSuggestedTradeById(userId, validatedTradeId)) ??
        trade;

      await this.operationalEventService.logActivity(userId, {
        type: 'Suggested Trade',
        title: `Suggested trade execution reconciled: ${currentTrade.symbol}`,
        status: 'Success',
        route: 'Suggested Trades',
        stream: 'Execution',
        related: `${currentTrade.symbol} · ${currentTrade.timeframe}`,
        referenceId: currentTrade.id,
        symbol: currentTrade.symbol,
        description: refreshed
          ? 'Execution state refreshed from latest order and position snapshots'
          : 'Execution state was already current',
      });

      return successResponse({
        message: refreshed
          ? 'Suggested trade execution refreshed'
          : 'Suggested trade execution already current',
        refreshed,
        suggestedTrade: this.mapSuggestedTrade(currentTrade),
      });
    } catch (error) {
      await this.operationalEventService.logActivity(userId, {
        type: 'Suggested Trade',
        title: 'Suggested trade execution reconcile failed',
        status: 'Failed',
        route: 'Suggested Trades',
        stream: 'Execution',
        referenceId: validatedTradeId,
        description: error instanceof Error ? error.message : String(error),
      });
      await this.operationalEventService.emitFailureAlert(userId, {
        channel: 'Suggested Trades',
        source: 'suggested-trades',
        message: `Suggested trade execution reconcile failed (${validatedTradeId}): ${
          error instanceof Error ? error.message : String(error)
        }`,
        route: 'Alerts',
      });
      throw error;
    }
  }

  async assertLiveOrderFreshnessForSuggestedTrade(
    userId: string,
    suggestedTradeId: string
  ): Promise<void> {
    const validatedTradeId = validateSuggestedTradeId(suggestedTradeId);
    const trade = await this.suggestedTradeRepository.getSuggestedTradeById(
      userId,
      validatedTradeId
    );
    if (!trade) {
      throw new NotFoundAppError('Suggested trade not found');
    }

    const executionPolicy = await this.loadTradeSuggestionExecutionPolicy(
      userId,
      trade.automationId
    );
    const freshness = this.evaluateSuggestedTradeFreshness(trade, executionPolicy);
    if (freshness.allowed) {
      return;
    }

    const message = this.buildLiveExecutionFreshnessBlockedMessage(freshness);
    await this.operationalEventService.logActivity(userId, {
      type: 'Suggested Trade',
      title: `Stale suggested trade blocked: ${trade.symbol}`,
      status: 'Warning',
      route: 'Orders',
      stream: 'Execution',
      related: `${trade.symbol} · ${trade.timeframe}`,
      referenceId: trade.id,
      symbol: trade.symbol,
      description: message,
    });

    throw new BadRequestAppError(message);
  }

  private async updateSuggestedTradeStatus(
    userId: string,
    suggestedTradeId: string,
    body: SuggestedTradeActionBody,
    nextStatus: SuggestedTradeStatusActionResult['suggestedTrade']['status'],
    options: {
      successMessage: string;
      activityTitle: string;
      failureTitle: string;
      failureMessagePrefix: string;
    }
  ): Promise<ApiSuccessResponse<SuggestedTradeStatusActionResult>> {
    const validatedTradeId = validateSuggestedTradeId(suggestedTradeId);
    const payload = validateSuggestedTradeActionBody(body);

    try {
      const trade = await this.suggestedTradeRepository.getSuggestedTradeById(
        userId,
        validatedTradeId
      );
      if (!trade) {
        throw new NotFoundAppError('Suggested trade not found');
      }
      if (trade.status === nextStatus) {
        return successResponse({
          message: options.successMessage,
          suggestedTrade: {
            id: trade.id,
            status: trade.status as SuggestedTradeStatusActionResult['suggestedTrade']['status'],
            updatedAt: trade.updatedAt.toISOString(),
            execution: this.getExecutionLink(trade),
          },
        });
      }

      this.assertStatusTransitionAllowed(trade, nextStatus);
      let acceptedExecution: SuggestedTradeExecutionLink | null = null;

      if (nextStatus === 'Accepted') {
        const gatedExecution = await this.runPreTradeGate(userId, trade, {
          sourceType: 'suggested_trade_accept',
        });
        acceptedExecution = gatedExecution.execution;

        if (!gatedExecution.ready) {
          const currentTrade =
            (await this.suggestedTradeRepository.getSuggestedTradeById(userId, validatedTradeId)) ??
            trade;

          await this.operationalEventService.logActivity(userId, {
            type: 'Suggested Trade',
            title: `Suggested trade accept blocked: ${currentTrade.symbol}`,
            status: 'Warning',
            route: 'Suggested Trades',
            stream: 'Review',
            related: `${currentTrade.symbol} · ${currentTrade.timeframe}`,
            referenceId: currentTrade.id,
            symbol: currentTrade.symbol,
            description: gatedExecution.result.decision.summary,
          });

          return successResponse({
            message: gatedExecution.result.decision.summary,
            suggestedTrade: {
              id: currentTrade.id,
              status:
                currentTrade.status as SuggestedTradeStatusActionResult['suggestedTrade']['status'],
              updatedAt: currentTrade.updatedAt.toISOString(),
              execution: this.getExecutionLink(currentTrade),
            },
          });
        }
      }

      const meta = trade.meta && typeof trade.meta === 'object' ? { ...trade.meta } : {};
      trade.status = nextStatus;
      trade.meta = {
        ...meta,
        review: {
          status: nextStatus,
          note: payload.note ?? null,
          updatedAt: new Date().toISOString(),
          actor: userId,
        },
      };

      let updatedTrade = await this.suggestedTradeRepository.saveSuggestedTrade(trade);
      if (nextStatus === 'Accepted' && acceptedExecution) {
        await this.persistExecutionState(updatedTrade, {
          ...acceptedExecution,
          acceptedBy: 'user',
          acceptedAt: new Date().toISOString(),
        });
        updatedTrade =
          (await this.suggestedTradeRepository.getSuggestedTradeById(userId, updatedTrade.id)) ??
          updatedTrade;
      }

      await this.operationalEventService.logActivity(userId, {
        type: 'Suggested Trade',
        title: `${options.activityTitle}: ${updatedTrade.symbol}`,
        status: 'Success',
        route: 'Suggested Trades',
        stream: 'Review',
        related: `${updatedTrade.symbol} · ${updatedTrade.timeframe}`,
        referenceId: updatedTrade.id,
        symbol: updatedTrade.symbol,
        description: payload.note || `${updatedTrade.side} suggestion moved to ${nextStatus}`,
      });

      return successResponse({
        message: options.successMessage,
        suggestedTrade: {
          id: updatedTrade.id,
          status:
            updatedTrade.status as SuggestedTradeStatusActionResult['suggestedTrade']['status'],
          updatedAt: updatedTrade.updatedAt.toISOString(),
          execution: this.getExecutionLink(updatedTrade),
        },
      });
    } catch (error) {
      await this.operationalEventService.logActivity(userId, {
        type: 'Suggested Trade',
        title: options.failureTitle,
        status: 'Failed',
        route: 'Suggested Trades',
        stream: 'Review',
        referenceId: validatedTradeId,
        description: error instanceof Error ? error.message : String(error),
      });
      await this.operationalEventService.emitFailureAlert(userId, {
        channel: 'Suggested Trades',
        source: 'suggested-trades',
        message: `${options.failureMessagePrefix} (${validatedTradeId}): ${
          error instanceof Error ? error.message : String(error)
        }`,
        route: 'Alerts',
      });
      throw error;
    }
  }

  private assertStatusTransitionAllowed(
    trade: SuggestedTrade,
    nextStatus: SuggestedTradeStatusActionResult['suggestedTrade']['status']
  ): void {
    const currentStatus = String(trade.status || '').trim();

    if (nextStatus === 'Reviewed') {
      if (currentStatus !== 'Open') {
        throw new BadRequestAppError('Only open suggested trades can be marked as reviewed');
      }
      return;
    }

    if (nextStatus === 'Accepted') {
      if (currentStatus !== 'Open' && currentStatus !== 'Reviewed') {
        throw new BadRequestAppError('Only open or reviewed suggested trades can be accepted');
      }
      return;
    }

    if (nextStatus === 'Dismissed') {
      if (!['Open', 'Reviewed', 'Accepted'].includes(currentStatus)) {
        throw new BadRequestAppError(
          'Only open, reviewed, or accepted suggested trades can be dismissed'
        );
      }

      if (currentStatus === 'Accepted' && this.hasLinkedExecution(trade)) {
        throw new BadRequestAppError(
          'Accepted suggested trades with linked execution cannot be dismissed'
        );
      }
    }
  }

  private async assertOrderLinkAllowed(
    userId: string,
    trade: SuggestedTrade,
    payload: SuggestedTradeOrderLinkBody
  ): Promise<void> {
    const existingExecution = this.getExecutionLink(trade);
    const existingLinkedOrderId = this.readStringValue(existingExecution?.orderId);
    const existingLinkedPaperOrderId = this.readStringValue(existingExecution?.paperOrderId);
    const nextOrderId = payload.orderId ? String(payload.orderId).trim() : null;
    const nextPaperOrderId = payload.paperOrderId ? String(payload.paperOrderId).trim() : null;

    if (existingLinkedOrderId && nextOrderId && existingLinkedOrderId !== nextOrderId) {
      throw new BadRequestAppError('Suggested trade is already linked to a different live order');
    }
    if (
      existingLinkedPaperOrderId &&
      nextPaperOrderId &&
      existingLinkedPaperOrderId !== nextPaperOrderId
    ) {
      throw new BadRequestAppError('Suggested trade is already linked to a different paper order');
    }

    if (nextPaperOrderId) {
      const paperOrder = await this.paperOrderRepository.getPaperOrderById(
        userId,
        nextPaperOrderId
      );
      if (!paperOrder) {
        throw new BadRequestAppError('Paper order not found');
      }
      if (paperOrder.suggestedTradeId && paperOrder.suggestedTradeId !== trade.id) {
        throw new BadRequestAppError(
          'Paper order is already linked to a different suggested trade'
        );
      }
    }
  }

  private async runPreTradeGate(
    userId: string,
    trade: SuggestedTrade,
    options: {
      sourceType: string;
      linkPayload?: SuggestedTradeOrderLinkBody;
    }
  ): Promise<SuggestedTradePreTradeGate> {
    const existingExecution = this.getExecutionLink(trade) ?? {};
    const executionPolicy = await this.loadTradeSuggestionExecutionPolicy(
      userId,
      trade.automationId
    );
    const request = await this.applyBrokerPolicyTradeSize(
      userId,
      this.buildPreTradeCheckRequest(
        trade,
        executionPolicy,
        existingExecution,
        options.linkPayload
      ),
      options.sourceType
    );
    const adaptiveRoute = this.shouldUseAdaptivePreTradeRoute(options.sourceType, request)
      ? await this.resolveAdaptivePreTradeRoute(userId, trade, request, options.sourceType)
      : { request };
    const resolvedRequest = adaptiveRoute.request;
    const result =
      adaptiveRoute.previewBlock ??
      (
        await this.riskPreTradeService.createPreTradeCheck(userId, {
          ...resolvedRequest,
          sourceType: options.sourceType,
        })
      ).data;

    if (adaptiveRoute.routeDecision) {
      const nextMeta = this.readRecordValue(trade.meta) ?? {};
      trade.meta = {
        ...nextMeta,
        routeDecision: adaptiveRoute.routeDecision,
      };
      const savedTrade = await this.suggestedTradeRepository.saveSuggestedTrade(trade);
      trade.meta = savedTrade.meta;
      trade.updatedAt = savedTrade.updatedAt;
    }

    const preTradeState = this.resolvePreTradeState(result.status);
    const ready = preTradeState === 'passed';
    const nextExecution: SuggestedTradeExecutionLink = {
      ...existingExecution,
      executionMode: resolvedRequest.executionMode,
      preTradeCheckId: adaptiveRoute.previewBlock ? null : result.checkId,
      preTradeState,
      preTradeCheckedAt: result.checkedAtIso ?? result.checkedAt,
      preTradeBlockedReason: ready ? null : result.decision.summary,
      brokerKey:
        result.request.routing.brokerKey ??
        resolvedRequest.routing.brokerKey ??
        existingExecution.brokerKey ??
        null,
      accountId:
        result.request.routing.accountId ??
        resolvedRequest.routing.accountId ??
        existingExecution.accountId ??
        null,
      orderType: resolvedRequest.order.orderType ?? existingExecution.orderType ?? null,
      leverage: resolvedRequest.order.leverage ?? existingExecution.leverage ?? null,
      quantity: resolvedRequest.order.quantity ?? existingExecution.quantity ?? null,
      entryPrice:
        this.formatNumericString(resolvedRequest.order.entryPrice) ??
        existingExecution.entryPrice ??
        null,
      stopLossPrice:
        this.formatNumericString(resolvedRequest.order.stopLossPrice) ??
        existingExecution.stopLossPrice ??
        null,
      takeProfitPrice:
        this.formatNumericString(resolvedRequest.order.takeProfitTargets?.[0] ?? null) ??
        existingExecution.takeProfitPrice ??
        null,
    };

    await this.persistExecutionState(trade, nextExecution);

    return {
      result,
      execution: nextExecution,
      ready,
      routeCandidates: adaptiveRoute.routeCandidates,
    };
  }

  private shouldUseAdaptivePreTradeRoute(
    sourceType: string,
    request: SuggestedTradePreTradeRequest
  ): boolean {
    if (!String(sourceType || '').startsWith('suggested_trade_automation_')) {
      return false;
    }
    if (
      sourceType === 'suggested_trade_automation_live_rollout' &&
      this.resolveAdaptiveRoutingMode(request.executionMode, sourceType) === 'off'
    ) {
      return false;
    }
    return !(
      request.routing.routeMode === 'fixed' ||
      request.routing.brokerKey ||
      request.routing.accountId
    );
  }

  private async resolveAdaptivePreTradeRoute(
    userId: string,
    trade: SuggestedTrade,
    request: SuggestedTradePreTradeRequest,
    sourceType: string
  ): Promise<AdaptivePreTradeRouteDecision> {
    const adaptiveRoutingMode = this.resolveAdaptiveRoutingMode(request.executionMode, sourceType);
    const candidates = await this.listDefaultRouteCandidates(
      userId,
      request.executionMode,
      sourceType
    );
    if (!candidates.length) {
      return { request };
    }

    const evaluated: EvaluatedRouteCandidate[] = [];
    for (const route of candidates) {
      let equivalentAssetRoute: ResolvedLiveAutoAssetRoute | null = null;
      try {
        equivalentAssetRoute = await this.resolveEquivalentLiveAutoAssetRouteIfNeeded(
          route.brokerKey,
          trade.symbol,
          request.executionMode,
          sourceType
        );
      } catch {
        equivalentAssetRoute = null;
      }
      const candidateOrderType = this.resolveBrokerEntryOrderType(
        route.brokerKey,
        request.executionMode,
        request.order.orderType,
        request.order.entryPrice
      );
      const candidateRequest = await this.applyBrokerPolicyTradeSize(
        userId,
        {
          ...request,
          routing: {
            routeMode: 'fixed',
            brokerKey: route.brokerKey,
            accountId: route.accountId,
          },
          order: {
            ...request.order,
            symbol: equivalentAssetRoute?.brokerSymbol ?? request.order.symbol,
            orderType: candidateOrderType,
            timeInForce: this.resolveBrokerEntryTimeInForce(
              route.brokerKey,
              request.executionMode,
              candidateOrderType,
              request.order.timeInForce
            ),
          },
        },
        sourceType
      );
      const preview = (
        await this.riskPreTradeService.previewPreTradeCheck(userId, {
          ...candidateRequest,
          sourceType,
        })
      ).data;
      const support = await this.evaluateRouteCandidateSupport(
        trade,
        preview,
        request.executionMode,
        sourceType
      );
      evaluated.push({
        route,
        request: candidateRequest,
        preview,
        assetRoute: equivalentAssetRoute,
        support,
      });
    }

    const selectableCandidates =
      adaptiveRoutingMode === 'shadow'
        ? evaluated
        : evaluated.filter((candidate) => !candidate.route.shadowOnly);
    const viableCandidates = selectableCandidates
      .filter((candidate) => candidate.preview.decision.allowed && candidate.support.supported)
      .sort((left, right) => this.compareRouteCandidates(left, right));

    if (viableCandidates.length > 0) {
      const selectedCandidate = viableCandidates[0];
      const decisionMode =
        adaptiveRoutingMode === 'shadow' ? 'adaptive_candidate_shadow' : 'adaptive_candidate_live';
      return {
        request: adaptiveRoutingMode === 'shadow' ? request : selectedCandidate.request,
        routeCandidates: viableCandidates,
        routeDecision: this.buildAdaptiveRouteDecisionRecord(
          trade,
          evaluated,
          selectedCandidate,
          decisionMode,
          'selected',
          adaptiveRoutingMode === 'shadow'
            ? 'shadow_best_viable_candidate'
            : 'best_viable_candidate'
        ),
      };
    }

    const bestRejectedCandidate = [
      ...(selectableCandidates.length ? selectableCandidates : evaluated),
    ].sort((left, right) => this.compareRejectedRouteCandidates(left, right))[0];
    if (!bestRejectedCandidate) {
      return { request };
    }

    const decisionMode =
      adaptiveRoutingMode === 'shadow' ? 'adaptive_candidate_shadow' : 'adaptive_candidate_live';
    return {
      request: adaptiveRoutingMode === 'shadow' ? request : bestRejectedCandidate.request,
      routeCandidates: [],
      previewBlock:
        adaptiveRoutingMode === 'shadow'
          ? null
          : this.createBlockedCandidatePreview(
              bestRejectedCandidate.preview,
              this.buildNoSafeRouteMessage(evaluated)
            ),
      routeDecision: this.buildAdaptiveRouteDecisionRecord(
        trade,
        evaluated,
        bestRejectedCandidate,
        decisionMode,
        'blocked',
        adaptiveRoutingMode === 'shadow'
          ? 'shadow_best_rejected_candidate'
          : 'best_rejected_candidate'
      ),
    };
  }

  private async listDefaultRouteCandidates(
    userId: string,
    executionMode: 'paper' | 'live',
    sourceType: string
  ): Promise<DefaultRouteCandidate[]> {
    const connectedAccounts = await this.brokerAccountRepository.getConnectedBrokerAccounts(userId);
    if (!connectedAccounts.length) {
      return [];
    }

    const defaultAccounts = connectedAccounts.filter((account) => account.isDefault);
    const baseAccounts = defaultAccounts.length > 0 ? defaultAccounts : connectedAccounts;
    const liveAutoConfig =
      executionMode === 'live' && sourceType === 'suggested_trade_automation_live_rollout'
        ? this.resolveLiveAutoRuntimeConfig()
        : null;
    const liveBrokerAllowlist = liveAutoConfig?.brokerAllowlist ?? [];
    const allowlistedAccounts = liveAutoConfig
      ? baseAccounts.filter((account) => {
          const brokerKey = String(account.brokerKey || '')
            .trim()
            .toLowerCase();
          if (!this.isLiveAutoBrokerEnabled(liveAutoConfig, brokerKey)) {
            return false;
          }
          return liveBrokerAllowlist.length > 0 ? liveBrokerAllowlist.includes(brokerKey) : true;
        })
      : baseAccounts;
    const candidates: DefaultRouteCandidate[] = [];
    const seenBrokers = new Set<string>();

    for (const account of allowlistedAccounts) {
      const brokerKey = String(account.brokerKey || '')
        .trim()
        .toLowerCase();
      if (!brokerKey || seenBrokers.has(brokerKey)) {
        continue;
      }
      seenBrokers.add(brokerKey);
      candidates.push({
        brokerKey,
        accountId: account.id,
        accountName:
          String(account.accountName || account.accountKey || account.id || '').trim() || null,
      });
    }

    const shadowBrokerAllowlist = liveAutoConfig?.shadowBrokerAllowlist ?? [];
    if (liveAutoConfig && shadowBrokerAllowlist.length > 0) {
      const accountPreference = [...defaultAccounts, ...connectedAccounts];
      for (const shadowBrokerKey of shadowBrokerAllowlist) {
        const normalizedShadowBrokerKey = String(shadowBrokerKey || '')
          .trim()
          .toLowerCase();
        if (
          !normalizedShadowBrokerKey ||
          seenBrokers.has(normalizedShadowBrokerKey) ||
          !this.isLiveAutoBrokerEnabled(liveAutoConfig, normalizedShadowBrokerKey)
        ) {
          continue;
        }
        const account = accountPreference.find(
          (item) =>
            String(item.brokerKey || '')
              .trim()
              .toLowerCase() === normalizedShadowBrokerKey
        );
        if (!account) {
          continue;
        }
        seenBrokers.add(normalizedShadowBrokerKey);
        candidates.push({
          brokerKey: normalizedShadowBrokerKey,
          accountId: account.id,
          accountName:
            String(account.accountName || account.accountKey || account.id || '').trim() || null,
          shadowOnly: true,
          shadowReason: `Broker ${normalizedShadowBrokerKey} is evaluated as a live-auto shadow route only and is not in the placement allowlist.`,
        });
      }
    }

    return candidates;
  }

  private async evaluateRouteCandidateSupport(
    trade: SuggestedTrade,
    preview: RiskPreTradeCheckResult,
    executionMode: 'paper' | 'live',
    sourceType: string
  ): Promise<{ supported: boolean; message: string | null }> {
    if (!(executionMode === 'live' && sourceType === 'suggested_trade_automation_live_rollout')) {
      return {
        supported: true,
        message: null,
      };
    }

    const metrics = this.resolvePreTradeRouteOrderMetrics(trade, preview);
    if (!metrics.brokerKey || !metrics.accountId) {
      return {
        supported: false,
        message: 'Live auto execution requires a resolved broker route and account.',
      };
    }
    if (!(metrics.leverage && metrics.leverage > 0)) {
      return {
        supported: false,
        message:
          'Live auto execution requires a positive min_leverage in the effective broker risk policy.',
      };
    }
    if (
      !(metrics.quantity && metrics.quantity > 0 && metrics.entryPrice && metrics.entryPrice > 0)
    ) {
      return {
        supported: false,
        message: 'Live auto execution requires a positive entry price and a resolvable quantity.',
      };
    }
    if (
      !(
        metrics.stopLossPrice &&
        metrics.stopLossPrice > 0 &&
        metrics.takeProfitPrice &&
        metrics.takeProfitPrice > 0
      )
    ) {
      return {
        supported: false,
        message:
          'Live auto execution requires positive stop-loss and take-profit prices on the suggestion or automation template.',
      };
    }

    try {
      this.assertLiveAutoBrokerMeasurementsFitRoute(
        metrics.brokerKey,
        metrics.orderSide,
        metrics.entryPrice,
        metrics.stopLossPrice,
        metrics.takeProfitPrice
      );
      const deltaProtectionConflict = await this.detectLiveAutoDeltaNativeProtectionConflict(
        trade.userId,
        metrics.brokerKey,
        metrics.accountId,
        this.readStringValue(preview.request.order.symbol) ?? trade.symbol
      );
      if (deltaProtectionConflict) {
        return {
          supported: false,
          message: deltaProtectionConflict,
        };
      }
      const assetRoute = await this.resolveLiveAutoAssetRoute(
        metrics.brokerKey,
        this.readStringValue(preview.request.order.symbol) ?? trade.symbol
      );
      if (metrics.brokerKey === 'delta_exchange') {
        await this.normalizeLiveAutoOrderSizing(
          metrics.brokerKey,
          assetRoute.assetId,
          assetRoute.brokerSymbol,
          metrics.quantity,
          metrics.entryPrice,
          metrics.stopLossPrice,
          metrics.takeProfitPrice,
          metrics.orderSide === 'sell' ? 'short' : 'long',
          metrics.orderType,
          metrics.leverage
        );
      } else if (metrics.brokerKey === 'mudrex') {
        await this.normalizeLiveAutoOrderSizing(
          metrics.brokerKey,
          assetRoute.assetId,
          assetRoute.brokerSymbol,
          metrics.quantity,
          metrics.entryPrice,
          metrics.stopLossPrice,
          metrics.takeProfitPrice,
          metrics.orderSide === 'sell' ? 'short' : 'long',
          metrics.orderType,
          metrics.leverage
        );
      }
      return {
        supported: true,
        message: null,
      };
    } catch (error) {
      return {
        supported: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private resolvePreTradeRouteOrderMetrics(
    trade: SuggestedTrade,
    result: RiskPreTradeCheckResult,
    execution?: SuggestedTradeExecutionLink | null
  ): {
    brokerKey: string | null;
    accountId: string | null;
    requestedNotional: number | null;
    requestOrder: Record<string, unknown>;
    entryPrice: number | null;
    quantity: number | null;
    leverage: number | null;
    stopLossPrice: number | null;
    takeProfitPrice: number | null;
    orderType: string;
    orderSide: 'buy' | 'sell';
  } {
    const routing = result.request.routing;
    const requestOrder = this.readRecordValue(result.request.order) ?? {};
    const requestedNotional = this.readNumberValue(result.delta?.grossExposureDelta);
    const brokerKey =
      this.readStringValue(routing.brokerKey)?.toLowerCase() ?? execution?.brokerKey ?? null;
    const accountId = this.readStringValue(routing.accountId) ?? execution?.accountId ?? null;
    const entryPrice =
      this.readNumberValue(requestOrder.entryPrice) ??
      this.readNumberValue(trade.entryPrice) ??
      this.readNumberValue(execution?.entryPrice);
    const quantity = this.resolveAutoPaperQuantity({
      requestedQuantity: execution?.quantity ?? this.readNumberValue(requestOrder.quantity),
      requestedNotional,
      entryPrice,
    });
    const leverage = execution?.leverage ?? this.readNumberValue(requestOrder.leverage) ?? null;
    const stopLossPrice =
      this.readNumberValue(requestOrder.stopLossPrice) ??
      this.readNumberValue(execution?.stopLossPrice) ??
      this.readNumberValue(trade.stopLossPrice);
    const takeProfitPrice =
      this.readNumberValue(
        Array.isArray(requestOrder.takeProfitTargets) ? requestOrder.takeProfitTargets[0] : null
      ) ??
      this.readNumberValue(execution?.takeProfitPrice) ??
      this.readNumberValue(
        Array.isArray(trade.takeProfitTargets) ? trade.takeProfitTargets[0] : null
      );
    const orderType =
      execution?.orderType ?? this.readStringValue(requestOrder.orderType) ?? 'market';
    const orderSide =
      String(result.request.order.side || '')
        .trim()
        .toUpperCase() === 'SELL'
        ? 'sell'
        : 'buy';

    return {
      brokerKey,
      accountId,
      requestedNotional,
      requestOrder,
      entryPrice,
      quantity,
      leverage,
      stopLossPrice,
      takeProfitPrice,
      orderType,
      orderSide,
    };
  }

  private normalizeLiveAutoEntryOrderType(
    orderType: string | null | undefined
  ): 'market' | 'limit' {
    const normalized = String(orderType || '')
      .trim()
      .toLowerCase();
    return normalized === 'limit' || normalized === 'limit_order' ? 'limit' : 'market';
  }

  private resolveLiveAutoTriggerType(orderType: 'market' | 'limit'): 'immediate' | 'GTC' {
    return orderType === 'limit' ? 'GTC' : 'immediate';
  }

  private isLimitOnlyLiveAutoBroker(brokerKey: string | null | undefined): boolean {
    const normalized = String(brokerKey || '')
      .trim()
      .toLowerCase();
    return normalized === 'mudrex' || normalized === 'delta_exchange';
  }

  private resolveBrokerEntryOrderType(
    brokerKey: string | null | undefined,
    executionMode: 'paper' | 'live',
    requestedOrderType: string | null | undefined,
    entryPrice?: number | null
  ): 'market' | 'limit' {
    if (executionMode === 'live' && this.isLimitOnlyLiveAutoBroker(brokerKey)) {
      return 'limit';
    }

    const normalized = this.normalizeLiveAutoEntryOrderType(requestedOrderType);
    return normalized === 'limit' && entryPrice && entryPrice > 0 ? 'limit' : 'market';
  }

  private resolveBrokerEntryTimeInForce(
    brokerKey: string | null | undefined,
    executionMode: 'paper' | 'live',
    orderType: 'market' | 'limit',
    requestedTimeInForce: 'GTC' | 'IOC' | 'FOK' | null | undefined
  ): 'GTC' | 'IOC' | 'FOK' | null {
    if (
      executionMode === 'live' &&
      orderType === 'limit' &&
      this.isLimitOnlyLiveAutoBroker(brokerKey)
    ) {
      return 'GTC';
    }

    return requestedTimeInForce ?? null;
  }

  private isDeltaLimitEntryProtectionProvisional(
    brokerKey: string | null | undefined,
    orderType: TradeSuggestionOrderType
  ): boolean {
    const normalizedBrokerKey = String(brokerKey || '')
      .trim()
      .toLowerCase();
    return normalizedBrokerKey === 'delta_exchange' && orderType === 'limit';
  }

  private assertLiveAutoBrokerMeasurementsFitRoute(
    brokerKey: string,
    orderSide: 'buy' | 'sell',
    entryPrice: number,
    stopLossPrice: number,
    takeProfitPrice: number
  ): void {
    if (
      String(brokerKey || '')
        .trim()
        .toLowerCase() !== 'delta_exchange'
    ) {
      return;
    }

    if (orderSide === 'buy' && !(stopLossPrice < entryPrice && takeProfitPrice > entryPrice)) {
      throw new BadRequestAppError(
        'Delta Exchange long protection requires stop-loss below entry and take-profit above entry.'
      );
    }

    if (orderSide === 'sell' && !(stopLossPrice > entryPrice && takeProfitPrice < entryPrice)) {
      throw new BadRequestAppError(
        'Delta Exchange short protection requires stop-loss above entry and take-profit below entry.'
      );
    }
  }

  private async detectLiveAutoDeltaNativeProtectionConflict(
    userId: string,
    brokerKey: string | null,
    accountId: string | null,
    symbol: string | null | undefined
  ): Promise<string | null> {
    const normalizedBrokerKey = String(brokerKey || '')
      .trim()
      .toLowerCase();
    const normalizedAccountId = String(accountId || '').trim();
    const normalizedSymbol = this.normalizeDeltaRouteSymbol(symbol);
    if (normalizedBrokerKey !== 'delta_exchange' || !normalizedAccountId || !normalizedSymbol) {
      return null;
    }

    const rows = (await coreDataSource.query(
      `SELECT symbol, quantity
         FROM position_read_models
        WHERE user_id = ?
          AND account_id = ?
          AND LOWER(broker_key) = 'delta_exchange'
          AND status_rank > 0
          AND status_rank <= 2
        ORDER BY last_seen_at DESC
        LIMIT 50`,
      [userId, normalizedAccountId]
    )) as Array<{
      symbol?: string | null;
      quantity?: string | number | null;
    }>;

    const hasConflict = rows.some((row) => {
      const quantity = Number(row.quantity);
      if (!(Number.isFinite(quantity) && Math.abs(quantity) > 0)) {
        return false;
      }
      return this.isDeltaRouteSymbolCompatible(row.symbol, normalizedSymbol);
    });

    return hasConflict
      ? 'Delta Exchange live-auto native SL/TP is not safe when the account already has an open net position on this symbol. Close or reconcile the existing Delta exposure before placing another protected live-auto order.'
      : null;
  }

  private async detectLiveAutoDuplicateAssetConflict(
    userId: string,
    trade: SuggestedTrade,
    executionPolicy: ResolvedTradeSuggestionExecutionPolicy
  ): Promise<string | null> {
    const assetKey = this.resolveLiveAutoDuplicateAssetKey(trade.symbol);
    if (!assetKey) {
      return null;
    }

    const recentExecutionConflict = await this.detectRecentLiveAutoDuplicateExecutionConflict(
      userId,
      trade,
      executionPolicy,
      assetKey
    );
    if (recentExecutionConflict) {
      return recentExecutionConflict;
    }

    if (
      typeof this.brokerAccountRepository?.getConnectedBrokerAccounts !== 'function' ||
      typeof this.positionReadModelRepository?.listLivePositionsForAccounts !== 'function' ||
      typeof this.ordersSnapshotSourceRepository?.listOpenOrdersForAccounts !== 'function'
    ) {
      return null;
    }

    const connectedAccounts = await this.brokerAccountRepository.getConnectedBrokerAccounts(userId);
    const accountIds = Array.from(
      new Set(
        (Array.isArray(connectedAccounts) ? connectedAccounts : [])
          .map((account) => this.readStringValue(account?.id))
          .filter((value): value is string => Boolean(value))
      )
    );
    if (!accountIds.length) {
      return null;
    }

    const positionsByAccount = await this.positionReadModelRepository.listLivePositionsForAccounts(
      userId,
      accountIds
    );
    for (const positions of positionsByAccount.values()) {
      for (const position of positions) {
        const positionSymbol = this.readStringValue((position as { symbol?: unknown })?.symbol);
        const quantity = this.readNumberValue((position as { quantity?: unknown })?.quantity);
        if (!(quantity && Math.abs(quantity) > 0)) {
          continue;
        }
        if (this.isLiveAutoDuplicateAssetMatch(positionSymbol, assetKey)) {
          return `Active exposure already exists for asset ${assetKey}; skipping duplicate live-auto suggestion.`;
        }
      }
    }

    const openOrdersByAccount = await this.ordersSnapshotSourceRepository.listOpenOrdersForAccounts(
      userId,
      accountIds
    );
    for (const orders of openOrdersByAccount.values()) {
      for (const order of orders) {
        const orderSymbol = this.extractLiveAutoOpenOrderSymbol(order?.payloadJson);
        if (this.isLiveAutoDuplicateAssetMatch(orderSymbol, assetKey)) {
          return `Active exposure already exists for asset ${assetKey}; skipping duplicate live-auto suggestion.`;
        }
      }
    }

    return null;
  }

  private async detectRecentLiveAutoDuplicateExecutionConflict(
    userId: string,
    trade: SuggestedTrade,
    executionPolicy: ResolvedTradeSuggestionExecutionPolicy,
    assetKey: string
  ): Promise<string | null> {
    if (!(executionPolicy.dedupeWindowSeconds > 0) || !coreDataSource.isInitialized) {
      return null;
    }

    const cutoff = new Date(Date.now() - executionPolicy.dedupeWindowSeconds * 1000);
    const rows = (await coreDataSource.query(
      `SELECT st.symbol AS symbol
         FROM suggested_trade_executions ste
         JOIN suggested_trades st
           ON st.id = ste.suggested_trade_id
        WHERE ste.user_id = ?
          AND st.id <> ?
          AND st.signal_time >= ?
          AND LOWER(COALESCE(ste.execution_mode, '')) = 'live'
          AND (
            LOWER(COALESCE(ste.execution_state, '')) IN ('submitting', 'linked', 'working', 'filled')
            OR LOWER(COALESCE(ste.position_status, '')) IN ('open', 'partial')
            OR LOWER(COALESCE(ste.order_status, '')) IN (
              'open',
              'new',
              'created',
              'pending',
              'trigger_pending',
              'partially_filled',
              'partial'
            )
          )
        ORDER BY COALESCE(ste.last_seen_at, ste.linked_at, ste.accepted_at, ste.created_at) DESC
        LIMIT 50`,
      [userId, trade.id, cutoff]
    )) as Array<{
      symbol?: string | null;
    }>;

    const hasConflict = rows.some((row) =>
      this.isLiveAutoDuplicateAssetMatch(row.symbol, assetKey)
    );

    return hasConflict
      ? `Active exposure already exists for asset ${assetKey}; skipping duplicate live-auto suggestion.`
      : null;
  }

  private normalizeDeltaRouteSymbol(value: unknown): string {
    return String(value || '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
  }

  private normalizeDeltaRouteUsdQuoteSymbol(symbol: string): string {
    const normalized = this.normalizeDeltaRouteSymbol(symbol);
    for (const quote of ['USDT', 'USDC', 'BUSD', 'FDUSD']) {
      if (normalized.endsWith(quote) && normalized.length > quote.length) {
        return `${normalized.slice(0, -quote.length)}USD`;
      }
    }

    return normalized;
  }

  private resolveDeltaRouteBaseSymbol(value: unknown): string {
    const normalized = this.normalizeDeltaRouteSymbol(value);
    for (const quote of ['USDT', 'USDC', 'BUSD', 'FDUSD', 'USD']) {
      if (normalized.endsWith(quote) && normalized.length > quote.length) {
        return normalized.slice(0, -quote.length);
      }
    }

    return normalized;
  }

  private resolveLiveAutoDuplicateAssetKey(value: unknown): string {
    return this.resolveDeltaRouteBaseSymbol(value);
  }

  private isLiveAutoDuplicateAssetMatch(symbol: unknown, duplicateAssetKey: string): boolean {
    return this.resolveLiveAutoDuplicateAssetKey(symbol) === duplicateAssetKey;
  }

  private extractLiveAutoOpenOrderSymbol(payload: unknown): string | null {
    const record = this.readRecordValue(payload);
    return (
      this.readStringValue(record?.symbol) ??
      this.readStringValue(record?.product_symbol) ??
      this.readStringValue(record?.trading_symbol) ??
      null
    );
  }

  private isDeltaRouteSymbolCompatible(positionSymbol: unknown, requestedSymbol: unknown): boolean {
    const normalizedPositionSymbol = this.normalizeDeltaRouteSymbol(positionSymbol);
    const normalizedRequestedSymbol = this.normalizeDeltaRouteSymbol(requestedSymbol);
    return (
      normalizedPositionSymbol === normalizedRequestedSymbol ||
      normalizedPositionSymbol ===
        this.normalizeDeltaRouteUsdQuoteSymbol(normalizedRequestedSymbol) ||
      this.resolveDeltaRouteBaseSymbol(normalizedPositionSymbol) ===
        this.resolveDeltaRouteBaseSymbol(normalizedRequestedSymbol)
    );
  }

  private createBlockedCandidatePreview(
    preview: RiskPreTradeCheckResult,
    message: string
  ): RiskPreTradeCheckResult {
    const routeScopeKey = `${String(preview.request.routing.brokerKey || '')
      .trim()
      .toLowerCase()}|${String(preview.request.routing.accountId || '').trim()}`;
    const blockingRule = {
      id: 'adaptive-route-support',
      checkId: preview.checkId,
      snapshotId: preview.snapshot.snapshotId ?? null,
      policyContextId: null,
      scopeType: 'route',
      scopeKey: routeScopeKey === '|' ? 'route' : routeScopeKey,
      scopeLabel:
        String(preview.request.routing.brokerKey || '')
          .trim()
          .toLowerCase() || 'route',
      brokerKey: preview.request.routing.brokerKey ?? null,
      accountId: preview.request.routing.accountId ?? null,
      symbol: preview.request.order.symbol,
      ruleCode: 'route_support',
      metricName: 'route_support',
      actualValue: null,
      basisValue: null,
      warnThresholdValue: null,
      criticalThresholdValue: null,
      status: 'critical' as const,
      blocking: true,
      message,
      sortOrder: preview.evaluatedRules.length + 1,
      createdAt: preview.checkedAt,
      createdAtIso: preview.checkedAtIso,
    };

    return {
      ...preview,
      status: 'blocked',
      decision: {
        allowed: false,
        blocked: true,
        approvalRequired: false,
        blockingRuleCount: Math.max(preview.decision.blockingRuleCount + 1, 1),
        warningRuleCount: preview.decision.warningRuleCount,
        summary: message,
      },
      blockingRules: [...preview.blockingRules, blockingRule],
      evaluatedRules: [...preview.evaluatedRules, blockingRule],
    };
  }

  private buildAdaptiveRouteDecisionRecord(
    trade: SuggestedTrade,
    candidates: EvaluatedRouteCandidate[],
    selectedCandidate: EvaluatedRouteCandidate,
    mode: SuggestedTradeRouteDecision['mode'],
    decision: 'selected' | 'blocked',
    selectionReason: string
  ): SuggestedTradeRouteDecision {
    const selectedBrokerSymbol =
      this.readStringValue(selectedCandidate.request.order.symbol) ?? trade.symbol;
    const selectedLabel = selectedCandidate.route.accountName
      ? `${selectedCandidate.route.brokerKey} (${selectedCandidate.route.accountName})`
      : selectedCandidate.route.brokerKey;
    const summary =
      decision === 'selected'
        ? mode === 'adaptive_candidate_shadow'
          ? `Shadow route would select ${selectedLabel} using broker symbol ${selectedBrokerSymbol}. Live routing remained unchanged.`
          : `Selected ${selectedLabel} using broker symbol ${selectedBrokerSymbol}.`
        : mode === 'adaptive_candidate_shadow'
          ? `Shadow route found no safe adaptive candidate. ${this.buildNoSafeRouteMessage(candidates)}`
          : this.buildNoSafeRouteMessage(candidates);
    const shadowSummary = this.buildShadowRouteCandidateSummary(candidates);

    return {
      mode,
      decision,
      requestedSymbol: trade.symbol,
      selectedBrokerKey: selectedCandidate.route.brokerKey,
      selectedAccountId: selectedCandidate.route.accountId,
      selectedAccountName: selectedCandidate.route.accountName,
      selectedBrokerSymbol,
      selectionReason,
      summary: shadowSummary ? `${summary} ${shadowSummary}` : summary,
      decidedAt: new Date().toISOString(),
      candidates: candidates.map((candidate) => ({
        brokerKey: candidate.route.brokerKey,
        accountId: candidate.route.accountId,
        accountName: candidate.route.accountName,
        shadowOnly: candidate.route.shadowOnly === true,
        shadowReason: candidate.route.shadowReason ?? null,
        requestedSymbol: trade.symbol,
        brokerSymbol: this.readStringValue(candidate.request.order.symbol) ?? trade.symbol,
        candidateSymbols:
          candidate.assetRoute?.candidateSymbols ??
          this.buildEquivalentLiveAutoSymbols(trade.symbol, candidate.route.brokerKey),
        resolvedVia: candidate.assetRoute?.resolvedVia ?? null,
        supported: candidate.support.supported,
        supportMessage: candidate.support.message ?? null,
        allowed: candidate.preview.decision.allowed,
        blocked: candidate.preview.decision.blocked,
        summary: candidate.support.supported
          ? candidate.preview.decision.summary
          : candidate.support.message || candidate.preview.decision.summary,
        warningRuleCount: candidate.preview.decision.warningRuleCount,
        blockingRuleCount: candidate.preview.decision.blockingRuleCount,
        freshnessState: candidate.preview.snapshot.freshnessState ?? null,
      })),
    };
  }

  private buildShadowRouteCandidateSummary(candidates: EvaluatedRouteCandidate[]): string | null {
    const shadowCandidates = candidates.filter((candidate) => candidate.route.shadowOnly === true);
    if (!shadowCandidates.length) {
      return null;
    }

    const details = shadowCandidates.map((candidate) => {
      const routeLabel = candidate.route.accountName
        ? `${candidate.route.brokerKey} (${candidate.route.accountName})`
        : candidate.route.brokerKey;
      if (candidate.preview.decision.allowed && candidate.support.supported) {
        return `${routeLabel}: would pass`;
      }
      return `${routeLabel}: ${
        candidate.support.message || candidate.preview.decision.summary || 'would be blocked'
      }`;
    });

    return `Shadow-only route verdicts: ${details.join(' | ')}`;
  }

  private resolveAdaptiveRoutingMode(
    executionMode: 'paper' | 'live',
    sourceType: string
  ): LiveAutoAdaptiveRoutingMode {
    if (executionMode === 'live' && sourceType === 'suggested_trade_automation_live_rollout') {
      return this.resolveLiveAutoRuntimeConfig().adaptiveRoutingMode;
    }

    return 'live';
  }

  private buildNoSafeRouteMessage(candidates: EvaluatedRouteCandidate[]): string {
    const reasons = candidates.map((candidate) => {
      const routeLabel = candidate.route.accountName
        ? `${candidate.route.brokerKey} (${candidate.route.accountName})`
        : candidate.route.brokerKey;
      const reason = candidate.support.supported
        ? candidate.preview.decision.summary
        : candidate.support.message || candidate.preview.decision.summary;
      return `${routeLabel}: ${reason}`;
    });

    return `No default broker account could safely support this trade. ${reasons.join(' | ')}`;
  }

  private compareRouteCandidates(
    left: EvaluatedRouteCandidate,
    right: EvaluatedRouteCandidate
  ): number {
    const comparisons = [
      left.preview.decision.warningRuleCount - right.preview.decision.warningRuleCount,
      this.getFreshnessRank(left.preview.snapshot.freshnessState) -
        this.getFreshnessRank(right.preview.snapshot.freshnessState),
      this.compareMetricValues(
        this.readScopeMetric(left.preview, 'account', 'afterMarginUsagePct'),
        this.readScopeMetric(right.preview, 'account', 'afterMarginUsagePct')
      ),
      this.compareMetricValues(
        this.readScopeMetric(left.preview, 'account', 'afterAllocationPct'),
        this.readScopeMetric(right.preview, 'account', 'afterAllocationPct')
      ),
      this.compareMetricValues(
        this.readScopeMetric(left.preview, 'broker_asset', 'afterAllocationPct'),
        this.readScopeMetric(right.preview, 'broker_asset', 'afterAllocationPct')
      ),
      this.compareMetricValues(
        this.readScopeMetric(left.preview, 'broker', 'afterAllocationPct'),
        this.readScopeMetric(right.preview, 'broker', 'afterAllocationPct')
      ),
      this.compareMetricValues(
        this.readScopeMetric(left.preview, 'broker', 'afterMarginUsagePct'),
        this.readScopeMetric(right.preview, 'broker', 'afterMarginUsagePct')
      ),
      String(left.route.brokerKey || '').localeCompare(String(right.route.brokerKey || '')),
    ];

    return comparisons.find((value) => value !== 0) ?? 0;
  }

  private compareRejectedRouteCandidates(
    left: EvaluatedRouteCandidate,
    right: EvaluatedRouteCandidate
  ): number {
    const comparisons = [
      Number(right.support.supported) - Number(left.support.supported),
      left.preview.decision.blockingRuleCount - right.preview.decision.blockingRuleCount,
      left.preview.decision.warningRuleCount - right.preview.decision.warningRuleCount,
      this.getFreshnessRank(left.preview.snapshot.freshnessState) -
        this.getFreshnessRank(right.preview.snapshot.freshnessState),
      this.compareMetricValues(
        this.readScopeMetric(left.preview, 'account', 'afterMarginUsagePct'),
        this.readScopeMetric(right.preview, 'account', 'afterMarginUsagePct')
      ),
      String(left.route.brokerKey || '').localeCompare(String(right.route.brokerKey || '')),
    ];

    return comparisons.find((value) => value !== 0) ?? 0;
  }

  private getFreshnessRank(value: string | null | undefined): number {
    const normalized = String(value || '')
      .trim()
      .toLowerCase();
    if (normalized === 'fresh') {
      return 0;
    }
    if (normalized === 'lagging') {
      return 1;
    }
    if (normalized === 'partial') {
      return 2;
    }
    return 3;
  }

  private compareMetricValues(left: number, right: number): number {
    if (left === right || (!Number.isFinite(left) && !Number.isFinite(right))) {
      return 0;
    }
    if (!Number.isFinite(left)) {
      return 1;
    }
    if (!Number.isFinite(right)) {
      return -1;
    }
    return left - right;
  }

  private readScopeMetric(
    result: RiskPreTradeCheckResult,
    scopeType: string,
    metricName: keyof Pick<
      RiskPreTradeCheckResult['scopeImpacts'][number],
      'afterMarginUsagePct' | 'afterAllocationPct'
    >
  ): number {
    const scope = result.scopeImpacts.find((item) => item.scopeType === scopeType) ?? null;
    const value = scope ? this.readNumberValue(scope[metricName]) : null;
    return value ?? Number.POSITIVE_INFINITY;
  }

  private resolvePersistedPreTradeCheckId(result: RiskPreTradeCheckResult): string | null {
    const checkId = String(result.checkId || '').trim();
    if (!checkId || checkId.startsWith('preview:')) {
      return null;
    }
    return checkId;
  }

  async attemptAutoPaperExecutionForAutomation(
    userId: string,
    suggestedTradeId: string,
    options: {
      placedInRun?: number;
    } = {}
  ): Promise<SuggestedTradeAutoPaperExecutionResult> {
    const validatedTradeId = validateSuggestedTradeId(suggestedTradeId);
    const trade = await this.suggestedTradeRepository.getSuggestedTradeById(
      userId,
      validatedTradeId
    );
    if (!trade) {
      throw new NotFoundAppError('Suggested trade not found');
    }

    const existingExecution = this.getExecutionLink(trade);
    if (this.hasExecutionTracking(existingExecution)) {
      return {
        outcome: 'skipped',
        message: 'Suggested trade already has tracked execution state',
        suggestedTradeId: trade.id,
        paperOrderId: existingExecution?.paperOrderId ?? null,
        preTradeCheckId: existingExecution?.preTradeCheckId ?? null,
      };
    }

    const executionPolicy = await this.loadTradeSuggestionExecutionPolicy(
      userId,
      trade.automationId
    );
    if (executionPolicy.executionMode !== 'paper_trade_auto') {
      return {
        outcome: 'disabled',
        message: 'Automation is not configured for paper auto execution',
        suggestedTradeId: trade.id,
      };
    }
    if (executionPolicy.approvalMode !== 'auto_if_safe') {
      return {
        outcome: 'disabled',
        message: 'Automation requires manual review before execution',
        suggestedTradeId: trade.id,
      };
    }

    const placedInRun = Math.max(0, Math.floor(options.placedInRun ?? 0));
    if (placedInRun >= executionPolicy.maxOrdersPerRun) {
      return {
        outcome: 'skipped',
        message: `Run limit reached for paper auto execution (${executionPolicy.maxOrdersPerRun}/${executionPolicy.maxOrdersPerRun})`,
        suggestedTradeId: trade.id,
      };
    }

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const ordersPlacedToday =
      await this.suggestedTradeRepository.countSystemAcceptedPaperExecutionsSince(
        trade.automationId,
        startOfDay
      );
    if (ordersPlacedToday >= executionPolicy.maxOrdersPerDay) {
      return {
        outcome: 'skipped',
        message: `Daily paper auto execution limit reached (${ordersPlacedToday}/${executionPolicy.maxOrdersPerDay})`,
        suggestedTradeId: trade.id,
      };
    }

    const activeExecutions =
      await this.suggestedTradeRepository.countActivePaperExecutionsForAutomation(
        trade.automationId
      );
    if (activeExecutions >= executionPolicy.maxConcurrentOpenTrades) {
      return {
        outcome: 'skipped',
        message: `Concurrent paper trade limit reached (${activeExecutions}/${executionPolicy.maxConcurrentOpenTrades})`,
        suggestedTradeId: trade.id,
      };
    }

    const gatedExecution = await this.runPreTradeGate(userId, trade, {
      sourceType: 'suggested_trade_automation_auto',
    });
    const persistedPreTradeCheckId = this.resolvePersistedPreTradeCheckId(gatedExecution.result);

    if (!gatedExecution.ready) {
      await this.operationalEventService.logActivity(userId, {
        type: 'Suggested Trade',
        title: `Paper auto execution blocked: ${trade.symbol}`,
        status: 'Warning',
        route: 'Suggested Trades',
        stream: 'Execution',
        related: `${trade.symbol} · ${trade.timeframe}`,
        referenceId: trade.id,
        symbol: trade.symbol,
        description:
          gatedExecution.result.decision.summary ||
          'Pre-trade check blocked this suggestion from paper auto execution',
      });

      return {
        outcome: 'blocked',
        message:
          gatedExecution.result.decision.summary ||
          'Pre-trade check blocked this suggestion from paper auto execution',
        suggestedTradeId: trade.id,
        preTradeCheckId: persistedPreTradeCheckId,
      };
    }

    const requestedNotional = this.readNumberValue(gatedExecution.result.delta?.grossExposureDelta);
    if (
      executionPolicy.maxNotionalPerTrade &&
      requestedNotional &&
      requestedNotional > executionPolicy.maxNotionalPerTrade
    ) {
      const message = `Projected notional ${this.formatNumericString(requestedNotional) || requestedNotional} exceeds the per-trade automation cap of ${this.formatNumericString(executionPolicy.maxNotionalPerTrade) || executionPolicy.maxNotionalPerTrade}.`;
      await this.persistExecutionState(trade, {
        ...gatedExecution.execution,
        note: message,
      });

      return {
        outcome: 'blocked',
        message,
        suggestedTradeId: trade.id,
        preTradeCheckId: persistedPreTradeCheckId,
      };
    }

    const routing = gatedExecution.result.request.routing;
    const requestOrder = this.readRecordValue(gatedExecution.result.request.order) ?? {};
    const brokerKey =
      this.readStringValue(routing.brokerKey)?.toLowerCase() ??
      gatedExecution.execution.brokerKey ??
      null;
    const accountId =
      this.readStringValue(routing.accountId) ?? gatedExecution.execution.accountId ?? null;
    const entryPrice =
      this.readNumberValue(requestOrder.entryPrice) ??
      this.readNumberValue(trade.entryPrice) ??
      this.readNumberValue(gatedExecution.execution.entryPrice);
    const quantity = this.resolveAutoPaperQuantity({
      requestedQuantity: gatedExecution.execution.quantity ?? null,
      requestedNotional,
      entryPrice,
    });

    if (!brokerKey || !accountId) {
      const message = 'Paper auto execution requires a resolved broker route and account';
      await this.persistExecutionState(trade, {
        ...gatedExecution.execution,
        executionState: 'failed',
        note: message,
      });
      return {
        outcome: 'failed',
        message,
        suggestedTradeId: trade.id,
        preTradeCheckId: persistedPreTradeCheckId,
      };
    }

    if (!(quantity && quantity > 0 && entryPrice && entryPrice > 0)) {
      const message =
        'Paper auto execution requires a positive entry price and resolvable quantity from the automation policy';
      await this.persistExecutionState(trade, {
        ...gatedExecution.execution,
        executionState: 'failed',
        note: message,
      });
      return {
        outcome: 'failed',
        message,
        suggestedTradeId: trade.id,
        preTradeCheckId: persistedPreTradeCheckId,
      };
    }

    const acceptedAt = new Date().toISOString();
    const reviewMeta = trade.meta && typeof trade.meta === 'object' ? { ...trade.meta } : {};
    trade.status = 'Accepted';
    trade.meta = {
      ...reviewMeta,
      review: {
        status: 'Accepted',
        note: 'Accepted automatically by automation execution policy',
        updatedAt: acceptedAt,
        actor: 'system',
      },
    };
    let updatedTrade = await this.suggestedTradeRepository.saveSuggestedTrade(trade);

    const acceptedExecution: SuggestedTradeExecutionLink = {
      ...gatedExecution.execution,
      executionMode: 'paper',
      executionState: 'queued',
      acceptedBy: 'system',
      acceptedAt,
      brokerKey,
      accountId,
      entryPrice:
        this.formatNumericString(entryPrice) ?? gatedExecution.execution.entryPrice ?? null,
      quantity,
      note: 'Paper order created automatically from automation suggestion',
    };

    await this.persistExecutionState(updatedTrade, acceptedExecution);
    updatedTrade =
      (await this.suggestedTradeRepository.getSuggestedTradeById(userId, updatedTrade.id)) ??
      updatedTrade;

    try {
      const submittingExecution: SuggestedTradeExecutionLink = {
        ...acceptedExecution,
        executionState: 'submitting',
        submittedAt: new Date().toISOString(),
      };
      await this.persistExecutionState(updatedTrade, submittingExecution);
      updatedTrade =
        (await this.suggestedTradeRepository.getSuggestedTradeById(userId, updatedTrade.id)) ??
        updatedTrade;

      const paperOrder = await this.paperOrderRepository.createPaperOrder({
        userId,
        suggestedTradeId: updatedTrade.id,
        assetId: updatedTrade.symbol,
        brokerKey,
        accountId,
        symbol: updatedTrade.symbol,
        side:
          String(updatedTrade.side || '')
            .trim()
            .toUpperCase() === 'SELL'
            ? 'SELL'
            : 'BUY',
        orderType:
          acceptedExecution.orderType ?? this.readStringValue(requestOrder.orderType) ?? 'market',
        triggerType: 'AUTOMATION',
        status: 'OPEN',
        leverage: acceptedExecution.leverage ?? this.readNumberValue(requestOrder.leverage) ?? null,
        quantity,
        orderPrice: entryPrice,
        stoplossPrice:
          this.readNumberValue(requestOrder.stopLossPrice) ??
          this.readNumberValue(acceptedExecution.stopLossPrice) ??
          null,
        takeprofitPrice:
          this.readNumberValue(
            Array.isArray(requestOrder.takeProfitTargets) ? requestOrder.takeProfitTargets[0] : null
          ) ??
          this.readNumberValue(acceptedExecution.takeProfitPrice) ??
          null,
        reduceOnly: requestOrder.reduceOnly === true,
        payload: {
          source: 'automation-paper-order',
          automationId: updatedTrade.automationId,
          automationRunId: updatedTrade.automationRunId,
          suggestedTradeId: updatedTrade.id,
          preTradeCheckId: persistedPreTradeCheckId,
          requestedNotional,
        },
      });

      let refreshedPaperOrder = paperOrder;
      try {
        await this.paperOrderExecutionService.simulateUserPaperOrders(userId, {
          paperOrderIds: [paperOrder.id],
        });
        refreshedPaperOrder =
          (await this.paperOrderRepository.getPaperOrderById(userId, paperOrder.id)) || paperOrder;
      } catch (simulationError) {
        refreshedPaperOrder =
          (await this.paperOrderRepository.getPaperOrderById(userId, paperOrder.id)) || paperOrder;
        const simulationMessage =
          simulationError instanceof Error ? simulationError.message : String(simulationError);
        await this.operationalEventService.logActivity(userId, {
          type: 'Paper order',
          title: `Paper auto simulation follow-up failed: ${updatedTrade.symbol}`,
          status: 'Warning',
          route: 'Orders',
          stream: 'Execution',
          related: `${brokerKey} · ${accountId}`,
          referenceId: paperOrder.id,
          correlationId: paperOrder.id,
          description: simulationMessage,
        });
      }

      const nextExecution = this.mergePaperExecutionOutcome(
        submittingExecution,
        refreshedPaperOrder
      );
      nextExecution.acceptedBy = 'system';
      nextExecution.acceptedAt = acceptedAt;
      nextExecution.brokerKey = brokerKey;
      nextExecution.accountId = accountId;
      nextExecution.note = 'Paper order created automatically from automation suggestion';
      await this.persistExecutionState(updatedTrade, nextExecution);

      await this.operationalEventService.logActivity(userId, {
        type: 'Paper order',
        title: `Paper auto order created: ${updatedTrade.symbol}`,
        status: 'Success',
        route: 'Orders',
        stream: 'Execution',
        related: `${brokerKey} · ${accountId}`,
        referenceId: paperOrder.id,
        correlationId: paperOrder.id,
        symbol: updatedTrade.symbol,
        description: `Paper order created automatically from automation ${updatedTrade.automationId}`,
      });

      return {
        outcome: 'placed',
        message: 'Paper order created automatically after pre-trade clearance',
        suggestedTradeId: updatedTrade.id,
        paperOrderId: paperOrder.id,
        preTradeCheckId: persistedPreTradeCheckId,
      };
    } catch (error) {
      const failureMessage = error instanceof Error ? error.message : 'Paper auto execution failed';
      await this.persistExecutionState(updatedTrade, {
        ...acceptedExecution,
        executionState: 'failed',
        note: failureMessage,
      });
      await this.operationalEventService.logActivity(userId, {
        type: 'Paper order',
        title: `Paper auto order failed: ${updatedTrade.symbol}`,
        status: 'Failed',
        route: 'Orders',
        stream: 'Execution',
        related: `${brokerKey} · ${accountId}`,
        referenceId: updatedTrade.id,
        symbol: updatedTrade.symbol,
        description: failureMessage,
      });
      await this.operationalEventService.emitFailureAlert(userId, {
        channel: 'Orders',
        source: brokerKey,
        message: `Paper auto order failed for ${updatedTrade.symbol}: ${failureMessage}`,
        route: 'Orders',
      });
      return {
        outcome: 'failed',
        message: failureMessage,
        suggestedTradeId: updatedTrade.id,
        preTradeCheckId: persistedPreTradeCheckId,
      };
    }
  }

  async attemptAutoLiveExecutionForAutomation(
    userId: string,
    suggestedTradeId: string,
    handler: LiveAutoOrderPlacementHandler,
    options: {
      placedInRun?: number;
      freshnessEvaluatedAt?: Date;
      currentRunFreshnessFloorSeconds?: number | null;
    } = {}
  ): Promise<SuggestedTradeAutoLiveRolloutResult> {
    const validatedTradeId = validateSuggestedTradeId(suggestedTradeId);
    const trade = await this.suggestedTradeRepository.getSuggestedTradeById(
      userId,
      validatedTradeId
    );
    if (!trade) {
      throw new NotFoundAppError('Suggested trade not found');
    }

    const existingExecution = this.getExecutionLink(trade);
    if (this.hasExecutionTracking(existingExecution)) {
      return {
        outcome: 'skipped',
        message: 'Suggested trade already has tracked execution state',
        suggestedTradeId: trade.id,
        brokerKey: existingExecution?.brokerKey ?? null,
        accountId: existingExecution?.accountId ?? null,
        preTradeCheckId: existingExecution?.preTradeCheckId ?? null,
      };
    }

    const executionPolicy = await this.loadTradeSuggestionExecutionPolicy(
      userId,
      trade.automationId
    );
    if (executionPolicy.executionMode !== 'live_trade_auto') {
      return {
        outcome: 'disabled',
        message: 'Automation is not configured for live auto execution',
        suggestedTradeId: trade.id,
      };
    }
    if (executionPolicy.approvalMode !== 'auto_if_safe') {
      return {
        outcome: 'disabled',
        message: 'Automation requires manual review before live execution',
        suggestedTradeId: trade.id,
      };
    }

    const rolloutGuard = this.evaluateLiveAutoRolloutGuard(userId, executionPolicy);
    if (!rolloutGuard.allowed) {
      if (rolloutGuard.outcome === 'blocked') {
        await this.operationalEventService.logActivity(userId, {
          type: 'Suggested Trade',
          title: `Live auto rollout blocked: ${trade.symbol}`,
          status: 'Warning',
          route: 'Suggested Trades',
          stream: 'Execution',
          related: `${trade.symbol} · ${trade.timeframe}`,
          referenceId: trade.id,
          symbol: trade.symbol,
          description: rolloutGuard.message,
        });
      }

      return {
        outcome: rolloutGuard.outcome,
        message: rolloutGuard.message,
        suggestedTradeId: trade.id,
        brokerKey: rolloutGuard.brokerKey,
        accountId: rolloutGuard.accountId,
      };
    }

    const signalFreshness = this.evaluateSuggestedTradeFreshness(trade, executionPolicy, {
      evaluatedAt: options.freshnessEvaluatedAt,
      minimumMaxAgeAfterCloseSeconds: options.currentRunFreshnessFloorSeconds ?? null,
    });
    const signalFreshnessSnapshot = this.buildLiveAutoFreshnessSnapshot(
      signalFreshness,
      options.currentRunFreshnessFloorSeconds ?? null
    );
    if (!signalFreshness.allowed) {
      const message = this.buildLiveExecutionFreshnessBlockedMessage(signalFreshness);
      await this.operationalEventService.logActivity(userId, {
        type: 'Suggested Trade',
        title: `Live auto stale signal skipped: ${trade.symbol}`,
        status: 'Warning',
        route: 'Suggested Trades',
        stream: 'Execution',
        related: `${trade.symbol} · ${trade.timeframe}`,
        referenceId: trade.id,
        symbol: trade.symbol,
        description: message,
      });

      return {
        outcome: 'skipped',
        message,
        suggestedTradeId: trade.id,
        brokerKey: rolloutGuard.brokerKey,
        accountId: rolloutGuard.accountId,
        freshness: signalFreshnessSnapshot,
      };
    }

    const duplicateAssetConflict = await this.detectLiveAutoDuplicateAssetConflict(
      userId,
      trade,
      executionPolicy
    );
    if (duplicateAssetConflict) {
      await this.operationalEventService.logActivity(userId, {
        type: 'Suggested Trade',
        title: `Live auto duplicate skipped: ${trade.symbol}`,
        status: 'Warning',
        route: 'Suggested Trades',
        stream: 'Execution',
        related: `${trade.symbol} · ${trade.timeframe}`,
        referenceId: trade.id,
        symbol: trade.symbol,
        description: duplicateAssetConflict,
      });

      return {
        outcome: 'skipped',
        message: duplicateAssetConflict,
        suggestedTradeId: trade.id,
        brokerKey: rolloutGuard.brokerKey,
        accountId: rolloutGuard.accountId,
        freshness: signalFreshnessSnapshot,
      };
    }

    const placedInRun = Math.max(0, Math.floor(options.placedInRun ?? 0));
    if (placedInRun >= executionPolicy.maxOrdersPerRun) {
      return {
        outcome: 'skipped',
        message: `Run limit reached for live auto rollout (${executionPolicy.maxOrdersPerRun}/${executionPolicy.maxOrdersPerRun})`,
        suggestedTradeId: trade.id,
        brokerKey: rolloutGuard.brokerKey,
        accountId: rolloutGuard.accountId,
        freshness: signalFreshnessSnapshot,
      };
    }

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const ordersPlacedToday =
      await this.suggestedTradeRepository.countSystemAcceptedExecutionsSince(
        trade.automationId,
        'live',
        startOfDay
      );
    if (ordersPlacedToday >= executionPolicy.maxOrdersPerDay) {
      return {
        outcome: 'skipped',
        message: `Daily live auto limit reached (${ordersPlacedToday}/${executionPolicy.maxOrdersPerDay})`,
        suggestedTradeId: trade.id,
        brokerKey: rolloutGuard.brokerKey,
        accountId: rolloutGuard.accountId,
        freshness: signalFreshnessSnapshot,
      };
    }

    const activeExecutions = await this.suggestedTradeRepository.countActiveExecutionsForAutomation(
      trade.automationId,
      'live'
    );
    if (activeExecutions >= executionPolicy.maxConcurrentOpenTrades) {
      return {
        outcome: 'skipped',
        message: `Concurrent live trade limit reached (${activeExecutions}/${executionPolicy.maxConcurrentOpenTrades})`,
        suggestedTradeId: trade.id,
        brokerKey: rolloutGuard.brokerKey,
        accountId: rolloutGuard.accountId,
        freshness: signalFreshnessSnapshot,
      };
    }

    try {
      const gatedExecution = await this.runPreTradeGate(userId, trade, {
        sourceType: 'suggested_trade_automation_live_rollout',
      });
      const persistedPreTradeCheckId = this.resolvePersistedPreTradeCheckId(gatedExecution.result);
      const liveAutoRuntimeConfig = this.resolveLiveAutoRuntimeConfig();
      const hasFailoverCandidates = (gatedExecution.routeCandidates?.length ?? 0) > 1;

      if (!gatedExecution.ready && !hasFailoverCandidates) {
        await this.operationalEventService.logActivity(userId, {
          type: 'Suggested Trade',
          title: `Live auto pre-trade blocked: ${trade.symbol}`,
          status: 'Warning',
          route: 'Suggested Trades',
          stream: 'Execution',
          related: `${trade.symbol} · ${trade.timeframe}`,
          referenceId: trade.id,
          symbol: trade.symbol,
          description:
            gatedExecution.result.decision.summary ||
            'Pre-trade check blocked this suggestion from live auto rollout',
        });

        return {
          outcome: 'blocked',
          message:
            gatedExecution.result.decision.summary ||
            'Pre-trade check blocked this suggestion from live auto rollout',
          suggestedTradeId: trade.id,
          brokerKey:
            this.readStringValue(gatedExecution.result.request.routing.brokerKey)?.toLowerCase() ??
            rolloutGuard.brokerKey,
          accountId:
            this.readStringValue(gatedExecution.result.request.routing.accountId) ??
            rolloutGuard.accountId,
          preTradeCheckId: persistedPreTradeCheckId,
          freshness: signalFreshnessSnapshot,
        };
      }

      const routeDecision = this.readRecordValue(this.readRecordValue(trade.meta)?.routeDecision);
      if (liveAutoRuntimeConfig.adaptiveRoutingMode === 'shadow') {
        const shadowBrokerKey =
          this.readStringValue(routeDecision?.selectedBrokerKey)?.toLowerCase() ??
          this.readStringValue(gatedExecution.result.request.routing.brokerKey)?.toLowerCase() ??
          rolloutGuard.brokerKey;
        const shadowAccountId =
          this.readStringValue(routeDecision?.selectedAccountId) ??
          this.readStringValue(gatedExecution.result.request.routing.accountId) ??
          rolloutGuard.accountId;
        const readyMessage = `${
          this.readStringValue(routeDecision?.summary) ??
          'Adaptive live-auto shadow routing recorded a candidate route.'
        } Broker placement remains disabled while adaptive routing runs in shadow mode.`;
        await this.persistExecutionState(trade, {
          ...gatedExecution.execution,
          note: readyMessage,
        });
        await this.operationalEventService.logActivity(userId, {
          type: 'Suggested Trade',
          title: `Live auto shadow route ready: ${trade.symbol}`,
          status: 'Success',
          route: 'Suggested Trades',
          stream: 'Execution',
          related: `${trade.symbol} · ${trade.timeframe}`,
          referenceId: trade.id,
          symbol: trade.symbol,
          description: readyMessage,
        });
        return {
          outcome: 'ready',
          message: readyMessage,
          suggestedTradeId: trade.id,
          brokerKey: shadowBrokerKey,
          accountId: shadowAccountId,
          preTradeCheckId: persistedPreTradeCheckId,
          freshness: signalFreshnessSnapshot,
        };
      }

      const routeResult = await this.attemptLiveAutoBrokerRoutes({
        userId,
        trade,
        gatedExecution,
        handler,
        executionPolicy,
        liveAutoRuntimeConfig,
      });
      return {
        ...routeResult,
        freshness: signalFreshnessSnapshot,
      };
    } catch (error) {
      const failureMessage = error instanceof Error ? error.message : 'Live auto execution failed';
      await this.persistExecutionState(trade, {
        ...(this.getExecutionLink(trade) ?? {}),
        executionMode: 'live',
        executionState: 'failed',
        note: failureMessage,
      });
      await this.operationalEventService.logActivity(userId, {
        type: 'Suggested Trade',
        title: `Live auto execution failed: ${trade.symbol}`,
        status: 'Failed',
        route: 'Suggested Trades',
        stream: 'Execution',
        related: `${trade.symbol} · ${trade.timeframe}`,
        referenceId: trade.id,
        symbol: trade.symbol,
        description: failureMessage,
      });
      await this.operationalEventService.emitFailureAlert(userId, {
        channel: 'Suggested Trades',
        source: rolloutGuard.brokerKey || 'suggested-trades',
        message: `Live auto execution failed for ${trade.symbol}: ${failureMessage}`,
        route: 'Suggested Trades',
      });
      return {
        outcome: 'failed',
        message: failureMessage,
        suggestedTradeId: trade.id,
        brokerKey: rolloutGuard.brokerKey,
        accountId: rolloutGuard.accountId,
        freshness: signalFreshnessSnapshot,
      };
    }
  }

  private async attemptLiveAutoBrokerRoutes(input: {
    userId: string;
    trade: SuggestedTrade;
    gatedExecution: SuggestedTradePreTradeGate;
    handler: LiveAutoOrderPlacementHandler;
    executionPolicy: ResolvedTradeSuggestionExecutionPolicy;
    liveAutoRuntimeConfig: LiveAutoRuntimeConfig;
  }): Promise<SuggestedTradeAutoLiveRolloutResult> {
    let updatedTrade = input.trade;
    const candidates =
      input.gatedExecution.routeCandidates && input.gatedExecution.routeCandidates.length > 0
        ? input.gatedExecution.routeCandidates
        : [null];
    const routeAttempts = [
      ...(this.normalizeRouteAttempts(input.gatedExecution.execution.routeAttempts) ?? []),
    ];
    let lastFailure:
      | (LiveAutoRoutePreparationFailure & {
          routeAttempts: SuggestedTradeRouteAttempt[];
        })
      | null = null;

    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index] ?? null;
      const gate =
        index === 0
          ? {
              result: input.gatedExecution.result,
              execution: input.gatedExecution.execution,
              ready: input.gatedExecution.ready,
              candidate,
              candidateRank: index + 1,
            }
          : await this.createLiveAutoRouteGate(input.userId, updatedTrade, candidate, index + 1);

      const preparedResult = await this.prepareLiveAutoRoute({
        userId: input.userId,
        trade: updatedTrade,
        gate,
        executionPolicy: input.executionPolicy,
        liveAutoRuntimeConfig: input.liveAutoRuntimeConfig,
      });

      if (!preparedResult.ok) {
        const failure = preparedResult.failure;
        const nextAttempts = this.upsertLiveAutoRouteAttempt(
          routeAttempts,
          this.buildLiveAutoRouteFailureAttempt({
            gate,
            brokerKey: failure.brokerKey,
            accountId: failure.accountId,
            message: failure.message,
            failureClassification: failure.failureClassification,
            failureCode: 'LIVE_AUTO_ROUTE_PRECHECK_FAILED',
            status: failure.outcome === 'blocked' ? 'pre_trade_blocked' : 'failed',
          })
        );
        routeAttempts.splice(0, routeAttempts.length, ...nextAttempts);
        await this.persistExecutionState(updatedTrade, {
          ...gate.execution,
          brokerKey: failure.brokerKey,
          accountId: failure.accountId,
          executionMode: 'live',
          executionState: failure.executionState,
          preTradeState: failure.preTradeState ?? gate.execution.preTradeState ?? null,
          preTradeBlockedReason:
            failure.preTradeBlockedReason ?? gate.execution.preTradeBlockedReason ?? null,
          routeAttempts,
          note: failure.message,
        });
        lastFailure = { ...failure, routeAttempts: [...routeAttempts] };
        continue;
      }

      const prepared = preparedResult.prepared;
      if (!input.liveAutoRuntimeConfig.executionEnabled) {
        return this.persistLiveAutoReadyRoute(input.userId, updatedTrade, prepared, routeAttempts);
      }

      const attemptStartedAt = new Date().toISOString();
      const pendingAttempt = this.buildLiveAutoRoutePendingAttempt(prepared, attemptStartedAt);
      routeAttempts.splice(
        0,
        routeAttempts.length,
        ...this.upsertLiveAutoRouteAttempt(routeAttempts, pendingAttempt)
      );

      updatedTrade = await this.acceptLiveAutoTradeForRoute(updatedTrade, attemptStartedAt);
      let acceptedExecution = this.buildAcceptedLiveAutoExecution(
        updatedTrade,
        prepared,
        routeAttempts,
        attemptStartedAt
      );
      await this.persistExecutionState(updatedTrade, acceptedExecution);
      updatedTrade =
        (await this.suggestedTradeRepository.getSuggestedTradeById(
          input.userId,
          updatedTrade.id
        )) ?? updatedTrade;

      const createOrderBody = this.buildLiveAutoCreateOrderBody(prepared, updatedTrade.id);
      const submittingAt = new Date().toISOString();
      routeAttempts.splice(
        0,
        routeAttempts.length,
        ...this.upsertLiveAutoRouteAttempt(routeAttempts, {
          ...pendingAttempt,
          status: 'submitting',
          submissionState: 'submitting',
          startedAt: pendingAttempt.startedAt ?? submittingAt,
        })
      );
      const submittingExecution: SuggestedTradeExecutionLink = {
        ...acceptedExecution,
        executionState: 'submitting',
        submittedAt: submittingAt,
        routeAttempts,
      };
      await this.persistExecutionState(updatedTrade, submittingExecution);
      updatedTrade =
        (await this.suggestedTradeRepository.getSuggestedTradeById(
          input.userId,
          updatedTrade.id
        )) ?? updatedTrade;

      try {
        const result = await input.handler.createOrder(
          prepared.resolvedAssetRoute.assetId,
          createOrderBody,
          {
            suggestedTradeId: updatedTrade.id,
          }
        );
        const placed = await this.persistSuccessfulLiveAutoRoute({
          userId: input.userId,
          trade: updatedTrade,
          prepared,
          submittingExecution,
          routeAttempts,
          createdOrder: this.unwrapOrderPlacementResponse(result),
          pendingAttempt,
        });
        return placed;
      } catch (error) {
        const failureMessage =
          error instanceof Error ? error.message : 'Live auto execution failed';
        const failureClassification = this.classifyLiveAutoRouteFailure(error, true);
        const failedAttempt = this.buildLiveAutoRouteFailureAttempt({
          gate,
          brokerKey: prepared.brokerKey,
          accountId: prepared.accountId,
          message: failureMessage,
          failureClassification,
          failureCode: this.resolveLiveAutoFailureCode(error),
          status: failureClassification === 'ambiguous' ? 'manual_review' : 'failed',
          orderId: this.readStringValue(submittingExecution.orderId),
          requestSummary: this.buildLiveAutoRouteRequestSummary(prepared),
          brokerResponseSummary: this.buildLiveAutoBrokerErrorSummary(error),
        });
        routeAttempts.splice(
          0,
          routeAttempts.length,
          ...this.upsertLiveAutoRouteAttempt(routeAttempts, failedAttempt)
        );
        await this.persistExecutionState(updatedTrade, {
          ...submittingExecution,
          executionState: 'failed',
          routeAttempts,
          note: failureMessage,
        });

        if (failureClassification !== 'confirmed_no_order') {
          const reconciliation = await this.reconcileLiveAutoAmbiguousRoute({
            userId: input.userId,
            prepared,
            createOrderBody,
            submittedAt: submittingAt,
          });
          const reconciledAttempt = this.applyLiveAutoRouteReconciliation(
            failedAttempt,
            reconciliation
          );
          routeAttempts.splice(
            0,
            routeAttempts.length,
            ...this.upsertLiveAutoRouteAttempt(routeAttempts, reconciledAttempt)
          );

          if (reconciliation.status === 'confirmed_no_order') {
            await this.persistExecutionState(updatedTrade, {
              ...submittingExecution,
              executionState: 'failed',
              routeAttempts,
              note: `${failureMessage} ${reconciliation.message}`.trim(),
            });
            lastFailure = {
              gate,
              brokerKey: prepared.brokerKey,
              accountId: prepared.accountId,
              message: failureMessage,
              outcome: 'failed',
              executionState: 'failed',
              failureClassification: 'confirmed_no_order',
              preTradeCheckId: prepared.preTradeCheckId,
              routeAttempts: [...routeAttempts],
            };
            continue;
          }

          if (reconciliation.status === 'found_order') {
            return this.persistReconciledLiveAutoOrderRoute({
              userId: input.userId,
              trade: updatedTrade,
              prepared,
              submittingExecution,
              routeAttempts,
              reconciliation,
            });
          }

          if (reconciliation.status === 'found_position') {
            return this.persistReconciledLiveAutoPositionRoute({
              userId: input.userId,
              trade: updatedTrade,
              prepared,
              submittingExecution,
              routeAttempts,
              reconciliation,
            });
          }

          const manualReviewMessage = `Live auto route ${prepared.brokerKey} failed ambiguously for ${updatedTrade.symbol}; reconciliation was ${reconciliation.status}, so broker state must be reviewed before trying another broker. ${reconciliation.message} ${failureMessage}`;
          await this.persistExecutionState(updatedTrade, {
            ...submittingExecution,
            executionState: 'failed',
            routeAttempts,
            note: manualReviewMessage,
          });
          await this.logLiveAutoAllRoutesFailed(input.userId, updatedTrade, manualReviewMessage);
          return {
            outcome: 'failed',
            message: manualReviewMessage,
            suggestedTradeId: updatedTrade.id,
            brokerKey: prepared.brokerKey,
            accountId: prepared.accountId,
            preTradeCheckId: prepared.preTradeCheckId,
          };
        }

        lastFailure = {
          gate,
          brokerKey: prepared.brokerKey,
          accountId: prepared.accountId,
          message: failureMessage,
          outcome: 'failed',
          executionState: 'failed',
          failureClassification,
          preTradeCheckId: prepared.preTradeCheckId,
          routeAttempts: [...routeAttempts],
        };
      }
    }

    if (candidates.length === 1 && lastFailure?.outcome === 'blocked') {
      return {
        outcome: 'blocked',
        message: lastFailure.message,
        suggestedTradeId: updatedTrade.id,
        brokerKey: lastFailure.brokerKey,
        accountId: lastFailure.accountId,
        preTradeCheckId: lastFailure.preTradeCheckId,
      };
    }

    const allRoutesMessage = this.buildAllLiveAutoRoutesFailedMessage(
      updatedTrade,
      routeAttempts,
      lastFailure?.message ?? 'No eligible live-auto broker route created an order'
    );
    await this.persistExecutionState(updatedTrade, {
      ...(this.getExecutionLink(updatedTrade) ?? {}),
      executionMode: 'live',
      executionState: 'failed',
      routeAttempts,
      note: allRoutesMessage,
    });
    await this.logLiveAutoAllRoutesFailed(input.userId, updatedTrade, allRoutesMessage);

    return {
      outcome: 'failed',
      message: allRoutesMessage,
      suggestedTradeId: updatedTrade.id,
      brokerKey: lastFailure?.brokerKey ?? null,
      accountId: lastFailure?.accountId ?? null,
      preTradeCheckId: lastFailure?.preTradeCheckId ?? null,
    };
  }

  private async createLiveAutoRouteGate(
    userId: string,
    trade: SuggestedTrade,
    candidate: EvaluatedRouteCandidate | null,
    candidateRank: number
  ): Promise<LiveAutoRouteGate> {
    if (!candidate) {
      throw new BadRequestAppError('Live auto failover requires a route candidate');
    }

    const result = (
      await this.riskPreTradeService.createPreTradeCheck(userId, {
        ...candidate.request,
        sourceType: 'suggested_trade_automation_live_rollout',
      })
    ).data;
    const preTradeState = this.resolvePreTradeState(result.status);
    const ready = preTradeState === 'passed';
    const existingExecution = this.getExecutionLink(trade) ?? {};
    const execution = this.buildExecutionFromPreTradeResult(
      trade,
      candidate.request,
      result,
      existingExecution,
      ready
    );

    await this.persistExecutionState(trade, execution);

    return {
      result,
      execution,
      ready,
      candidate,
      candidateRank,
    };
  }

  private buildExecutionFromPreTradeResult(
    trade: SuggestedTrade,
    request: SuggestedTradePreTradeRequest,
    result: RiskPreTradeCheckResult,
    existingExecution: SuggestedTradeExecutionLink,
    ready: boolean
  ): SuggestedTradeExecutionLink {
    return {
      ...existingExecution,
      executionMode: request.executionMode,
      preTradeCheckId: result.checkId,
      preTradeState: this.resolvePreTradeState(result.status),
      preTradeCheckedAt: result.checkedAtIso ?? result.checkedAt,
      preTradeBlockedReason: ready ? null : result.decision.summary,
      brokerKey:
        result.request.routing.brokerKey ??
        request.routing.brokerKey ??
        existingExecution.brokerKey ??
        null,
      accountId:
        result.request.routing.accountId ??
        request.routing.accountId ??
        existingExecution.accountId ??
        null,
      orderType: request.order.orderType ?? existingExecution.orderType ?? null,
      leverage: request.order.leverage ?? existingExecution.leverage ?? null,
      quantity: request.order.quantity ?? existingExecution.quantity ?? null,
      entryPrice:
        this.formatNumericString(request.order.entryPrice) ?? existingExecution.entryPrice ?? null,
      stopLossPrice:
        this.formatNumericString(request.order.stopLossPrice) ??
        existingExecution.stopLossPrice ??
        null,
      takeProfitPrice:
        this.formatNumericString(request.order.takeProfitTargets?.[0] ?? null) ??
        existingExecution.takeProfitPrice ??
        null,
    };
  }

  private async prepareLiveAutoRoute(input: {
    userId: string;
    trade: SuggestedTrade;
    gate: LiveAutoRouteGate;
    executionPolicy: ResolvedTradeSuggestionExecutionPolicy;
    liveAutoRuntimeConfig: LiveAutoRuntimeConfig;
  }): Promise<LiveAutoRoutePreparationResult> {
    const preTradeCheckId = this.resolvePersistedPreTradeCheckId(input.gate.result);
    const routeMetrics = this.resolvePreTradeRouteOrderMetrics(
      input.trade,
      input.gate.result,
      input.gate.execution
    );
    const brokerKey = routeMetrics.brokerKey;
    const accountId = routeMetrics.accountId;

    if (!input.gate.ready) {
      return {
        ok: false,
        failure: {
          gate: input.gate,
          brokerKey,
          accountId,
          message:
            input.gate.result.decision.summary ||
            'Pre-trade check blocked this suggestion from live auto rollout',
          outcome: 'blocked',
          executionState: 'rejected',
          preTradeState: 'blocked',
          preTradeBlockedReason:
            input.gate.result.decision.summary ||
            'Pre-trade check blocked this suggestion from live auto rollout',
          failureClassification: 'confirmed_no_order',
          preTradeCheckId,
        },
      };
    }

    if (
      input.executionPolicy.maxNotionalPerTrade &&
      routeMetrics.requestedNotional &&
      routeMetrics.requestedNotional > input.executionPolicy.maxNotionalPerTrade
    ) {
      const message = `Projected notional ${
        this.formatNumericString(routeMetrics.requestedNotional) || routeMetrics.requestedNotional
      } exceeds the per-trade automation cap of ${
        this.formatNumericString(input.executionPolicy.maxNotionalPerTrade) ||
        input.executionPolicy.maxNotionalPerTrade
      }.`;
      return this.buildLiveAutoPreparationFailure(input.gate, brokerKey, accountId, message, {
        outcome: 'blocked',
        executionState: 'rejected',
        preTradeState: 'blocked',
        preTradeBlockedReason: message,
        preTradeCheckId,
      });
    }

    const entryPrice = routeMetrics.entryPrice;
    const quantity = routeMetrics.quantity;
    const leverage = routeMetrics.leverage;
    const stopLossPrice = routeMetrics.stopLossPrice;
    const takeProfitPrice = routeMetrics.takeProfitPrice;
    const orderType = this.resolveBrokerEntryOrderType(
      brokerKey,
      'live',
      routeMetrics.orderType,
      entryPrice
    );
    const triggerType = this.resolveLiveAutoTriggerType(orderType);
    const side = routeMetrics.orderSide === 'sell' ? 'short' : 'long';

    if (!brokerKey || !accountId) {
      return this.buildLiveAutoPreparationFailure(
        input.gate,
        brokerKey,
        accountId,
        'Live auto execution requires a resolved broker route and account',
        {
          outcome: 'failed',
          executionState: 'failed',
          preTradeCheckId,
        }
      );
    }

    if (!this.isLiveAutoBrokerEnabled(input.liveAutoRuntimeConfig, brokerKey)) {
      const message = `Broker ${brokerKey} live auto is disabled by broker-specific control`;
      return this.buildLiveAutoPreparationFailure(input.gate, brokerKey, accountId, message, {
        outcome: 'blocked',
        executionState: 'rejected',
        preTradeState: 'blocked',
        preTradeBlockedReason: message,
        preTradeCheckId,
      });
    }

    if (!leverage || leverage <= 0) {
      return this.buildLiveAutoPreparationFailure(
        input.gate,
        brokerKey,
        accountId,
        'Live auto execution requires a positive min_leverage in the effective broker risk policy',
        {
          outcome: 'failed',
          executionState: 'failed',
          preTradeCheckId,
        }
      );
    }

    if (!(quantity && quantity > 0 && entryPrice && entryPrice > 0)) {
      return this.buildLiveAutoPreparationFailure(
        input.gate,
        brokerKey,
        accountId,
        'Live auto execution requires a positive entry price and resolvable quantity from the automation policy',
        {
          outcome: 'failed',
          executionState: 'failed',
          preTradeCheckId,
        }
      );
    }

    if (!(stopLossPrice && stopLossPrice > 0 && takeProfitPrice && takeProfitPrice > 0)) {
      return this.buildLiveAutoPreparationFailure(
        input.gate,
        brokerKey,
        accountId,
        'Live auto execution requires positive stop-loss and take-profit prices on the suggestion or automation template',
        {
          outcome: 'failed',
          executionState: 'failed',
          preTradeCheckId,
        }
      );
    }

    const killSwitchBlock =
      (await this.riskKillSwitchService?.findActiveLiveTradingBlock(input.userId, {
        brokerKey,
        accountId,
      })) ?? null;
    if (killSwitchBlock) {
      const message = `Risk kill switch is active for ${killSwitchBlock.scope}. Live auto placement is blocked until it is cleared.`;
      return this.buildLiveAutoPreparationFailure(input.gate, brokerKey, accountId, message, {
        outcome: 'blocked',
        executionState: 'rejected',
        preTradeState: 'blocked',
        preTradeBlockedReason: message,
        preTradeCheckId,
      });
    }

    let resolvedAssetRoute: ResolvedLiveAutoAssetRoute;
    let normalizedSizing: NormalizedLiveAutoOrderSizing;
    try {
      resolvedAssetRoute = await this.resolveLiveAutoAssetRoute(
        brokerKey,
        this.readStringValue(input.gate.result.request.order.symbol) ?? input.trade.symbol
      );
      normalizedSizing = await this.normalizeLiveAutoOrderSizing(
        brokerKey,
        resolvedAssetRoute.assetId,
        resolvedAssetRoute.brokerSymbol,
        quantity,
        entryPrice,
        stopLossPrice,
        takeProfitPrice,
        side,
        orderType,
        leverage
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Live auto product preflight failed';
      return this.buildLiveAutoPreparationFailure(input.gate, brokerKey, accountId, message, {
        outcome: 'blocked',
        executionState: 'rejected',
        preTradeState: 'blocked',
        preTradeBlockedReason: message,
        preTradeCheckId,
      });
    }

    return {
      ok: true,
      prepared: {
        gate: input.gate,
        brokerKey,
        accountId,
        requestOrder: routeMetrics.requestOrder,
        requestedNotional: routeMetrics.requestedNotional,
        leverage,
        orderType,
        triggerType,
        side,
        resolvedAssetRoute,
        normalizedQuantity: normalizedSizing.quantity,
        normalizedEntryPrice: normalizedSizing.entryPrice,
        normalizedStopLossPrice: normalizedSizing.stopLossPrice,
        normalizedTakeProfitPrice: normalizedSizing.takeProfitPrice,
        normalizedSizingNote: normalizedSizing.auditNote,
        deltaProtectionMode:
          brokerKey === 'delta_exchange' ? input.executionPolicy.deltaProtectionMode : null,
        policyLeverageNote: `Using broker policy minimum leverage ${
          this.formatNumericString(leverage) || leverage
        }x.`,
        preTradeCheckId,
      },
    };
  }

  private buildLiveAutoPreparationFailure(
    gate: LiveAutoRouteGate,
    brokerKey: string | null,
    accountId: string | null,
    message: string,
    options: {
      outcome: 'blocked' | 'failed';
      executionState: SuggestedTradeExecutionLink['executionState'];
      preTradeState?: SuggestedTradeExecutionLink['preTradeState'];
      preTradeBlockedReason?: string | null;
      preTradeCheckId: string | null;
    }
  ): LiveAutoRoutePreparationResult {
    return {
      ok: false,
      failure: {
        gate,
        brokerKey,
        accountId,
        message,
        outcome: options.outcome,
        executionState: options.executionState,
        preTradeState: options.preTradeState,
        preTradeBlockedReason: options.preTradeBlockedReason,
        failureClassification: 'confirmed_no_order',
        preTradeCheckId: options.preTradeCheckId,
      },
    };
  }

  private async persistLiveAutoReadyRoute(
    userId: string,
    trade: SuggestedTrade,
    prepared: PreparedLiveAutoRoute,
    routeAttempts: SuggestedTradeRouteAttempt[]
  ): Promise<SuggestedTradeAutoLiveRolloutResult> {
    const readyMessage = `Live auto rollout guard passed. Broker placement remains disabled until live auto execution is explicitly enabled. ${prepared.policyLeverageNote}${
      prepared.normalizedSizingNote ? ` ${prepared.normalizedSizingNote}` : ''
    }`;
    await this.persistExecutionState(trade, {
      ...prepared.gate.execution,
      brokerKey: prepared.brokerKey,
      accountId: prepared.accountId,
      orderType: prepared.orderType,
      triggerType: prepared.triggerType,
      quantity: prepared.normalizedQuantity,
      entryPrice: this.formatNumericString(prepared.normalizedEntryPrice) ?? null,
      stopLossPrice: this.formatNumericString(prepared.normalizedStopLossPrice) ?? null,
      takeProfitPrice: this.formatNumericString(prepared.normalizedTakeProfitPrice) ?? null,
      routeAttempts: routeAttempts.length ? routeAttempts : null,
      note: readyMessage,
    });
    await this.operationalEventService.logActivity(userId, {
      type: 'Suggested Trade',
      title: `Live auto rollout ready: ${trade.symbol}`,
      status: 'Success',
      route: 'Suggested Trades',
      stream: 'Execution',
      related: `${trade.symbol} · ${trade.timeframe}`,
      referenceId: trade.id,
      symbol: trade.symbol,
      description: readyMessage,
    });
    return {
      outcome: 'ready',
      message: readyMessage,
      suggestedTradeId: trade.id,
      brokerKey: prepared.brokerKey,
      accountId: prepared.accountId,
      preTradeCheckId: prepared.preTradeCheckId,
    };
  }

  private async acceptLiveAutoTradeForRoute(
    trade: SuggestedTrade,
    acceptedAt: string
  ): Promise<SuggestedTrade> {
    if (String(trade.status || '').trim() === 'Accepted') {
      return trade;
    }

    const reviewMeta = trade.meta && typeof trade.meta === 'object' ? { ...trade.meta } : {};
    trade.status = 'Accepted';
    trade.meta = {
      ...reviewMeta,
      review: {
        status: 'Accepted',
        note: 'Accepted automatically by live automation execution policy',
        updatedAt: acceptedAt,
        actor: 'system',
      },
    };
    return this.suggestedTradeRepository.saveSuggestedTrade(trade);
  }

  private buildAcceptedLiveAutoExecution(
    trade: SuggestedTrade,
    prepared: PreparedLiveAutoRoute,
    routeAttempts: SuggestedTradeRouteAttempt[],
    acceptedAt: string
  ): SuggestedTradeExecutionLink {
    return {
      ...prepared.gate.execution,
      executionMode: 'live',
      executionState: 'queued',
      acceptedBy: 'system',
      acceptedAt,
      brokerKey: prepared.brokerKey,
      accountId: prepared.accountId,
      orderType: prepared.orderType,
      triggerType: prepared.triggerType,
      leverage: prepared.leverage,
      quantity: prepared.normalizedQuantity,
      entryPrice: this.formatNumericString(prepared.normalizedEntryPrice) ?? null,
      stopLossPrice: this.formatNumericString(prepared.normalizedStopLossPrice) ?? null,
      takeProfitPrice: this.formatNumericString(prepared.normalizedTakeProfitPrice) ?? null,
      routeAttempts,
      note: [
        prepared.resolvedAssetRoute.brokerSymbol !== trade.symbol
          ? `Live order queued automatically from automation suggestion using equivalent broker symbol ${prepared.resolvedAssetRoute.brokerSymbol} for requested signal ${trade.symbol}`
          : 'Live order queued automatically from automation suggestion',
        prepared.policyLeverageNote,
        prepared.normalizedSizingNote,
      ]
        .filter((value): value is string => Boolean(value))
        .join(' '),
    };
  }

  private buildLiveAutoCreateOrderBody(
    prepared: PreparedLiveAutoRoute,
    suggestedTradeId: string
  ): CreateOrderBody {
    return {
      brokerKey: prepared.brokerKey,
      accountId: prepared.accountId,
      idempotency_key: this.buildAutoLiveIdempotencyKey(
        suggestedTradeId,
        prepared.preTradeCheckId,
        prepared.brokerKey,
        prepared.accountId
      ),
      symbol: prepared.resolvedAssetRoute.brokerSymbol,
      side: prepared.side,
      execution_mode: 'live',
      leverage: prepared.leverage,
      quantity: prepared.normalizedQuantity,
      order_price: prepared.normalizedEntryPrice,
      order_type: prepared.orderType,
      trigger_type: prepared.triggerType,
      is_takeprofit: false,
      is_stoploss: false,
      stoploss_price: prepared.normalizedStopLossPrice,
      takeprofit_price: prepared.normalizedTakeProfitPrice,
      reduce_only: prepared.requestOrder.reduceOnly === true,
      delta_protection_mode:
        prepared.brokerKey === 'delta_exchange'
          ? (prepared.deltaProtectionMode ?? undefined)
          : undefined,
    };
  }

  private async persistSuccessfulLiveAutoRoute(input: {
    userId: string;
    trade: SuggestedTrade;
    prepared: PreparedLiveAutoRoute;
    submittingExecution: SuggestedTradeExecutionLink;
    routeAttempts: SuggestedTradeRouteAttempt[];
    createdOrder: Record<string, unknown>;
    pendingAttempt: SuggestedTradeRouteAttempt;
  }): Promise<SuggestedTradeAutoLiveRolloutResult> {
    const createdOrderId =
      this.readStringValue(input.createdOrder.order_id) ??
      this.readStringValue(input.createdOrder.orderId) ??
      null;
    const createdOrderStatus =
      this.readStringValue(input.createdOrder.status) ??
      this.readStringValue(input.createdOrder.order_status) ??
      null;
    const protectionStatus = this.readStringValue(input.createdOrder.protection_status);
    const protectionMode =
      this.readStringValue(input.createdOrder.protection_mode) ??
      this.readStringValue(input.createdOrder.delta_protection_mode);
    const bracketStatus = this.readStringValue(input.createdOrder.bracket_status);
    const stopLossOrderId = this.readStringValue(input.createdOrder.stop_loss_order_id);
    const takeProfitOrderId = this.readStringValue(input.createdOrder.take_profit_order_id);
    const deltaLimitProtectionProvisional = this.isDeltaLimitEntryProtectionProvisional(
      input.prepared.brokerKey,
      input.prepared.orderType
    );
    const deltaNativeBracketPending =
      input.prepared.brokerKey === 'delta_exchange' &&
      protectionMode === 'native_bracket' &&
      ['pending_confirmation', 'attaching', 'submitted'].includes(
        String(protectionStatus || bracketStatus || '')
          .trim()
          .toLowerCase()
      );
    let protectionAttached = protectionStatus === 'attached' && !deltaLimitProtectionProvisional;
    let protectionClosedPosition = false;
    let protectionAttachmentNote: string | null = null;
    let protectionNote = protectionAttached
      ? ` Native SL/TP protection attached${
          stopLossOrderId || takeProfitOrderId
            ? ` (SL ${stopLossOrderId ?? 'unknown'}, TP ${takeProfitOrderId ?? 'unknown'})`
            : ''
        }.`
      : '';
    if (deltaLimitProtectionProvisional && protectionStatus === 'attached') {
      protectionNote = ` Delta native SL/TP protection created${
        stopLossOrderId || takeProfitOrderId
          ? ` (SL ${stopLossOrderId ?? 'unknown'}, TP ${takeProfitOrderId ?? 'unknown'})`
          : ''
      }, awaiting entry fill and active order snapshot verification.`;
    }
    if (deltaNativeBracketPending) {
      protectionNote =
        ' Delta native bracket submitted; awaiting entry fill and active bracket protection snapshot verification.';
    }

    if (!createdOrderId) {
      throw new BadRequestAppError('Live auto execution did not return a broker order id');
    }

    if (!protectionAttached && input.prepared.brokerKey === 'mudrex') {
      const attachedProtection = await this.attachMudrexLiveAutoProtectionIfNeeded({
        userId: input.userId,
        brokerKey: input.prepared.brokerKey,
        accountId: input.prepared.accountId,
        brokerSymbol: input.prepared.resolvedAssetRoute.brokerSymbol,
        side: input.prepared.side,
        orderId: createdOrderId,
        requestedEntryPrice: input.prepared.normalizedEntryPrice,
        requestedStopLossPrice: input.prepared.normalizedStopLossPrice,
        requestedTakeProfitPrice: input.prepared.normalizedTakeProfitPrice,
      });
      if (attachedProtection.attached) {
        protectionAttached = true;
      }
      if (attachedProtection.closedPosition) {
        protectionClosedPosition = true;
      }
      if (attachedProtection.note) {
        protectionAttachmentNote = attachedProtection.note;
        protectionNote =
          `${protectionNote}${protectionNote ? ' ' : ' '}${attachedProtection.note}`.trimEnd();
      }
    }

    const linkedAt = new Date().toISOString();
    const needsPostFillProtection = Boolean(
      input.prepared.normalizedStopLossPrice > 0 && input.prepared.normalizedTakeProfitPrice > 0
    );
    const protectionResolution = this.resolveCreatedLiveAutoOrderProtectionState({
      brokerKey: input.prepared.brokerKey,
      protectionAttached,
      deltaLimitProtectionProvisional,
      deltaNativeBracketPending,
      needsPostFillProtection,
      protectionAttachmentNote,
      protectionClosedPosition,
      fallbackProtectionState: input.submittingExecution.protectionState,
      fallbackProtectionLastError: input.submittingExecution.protectionLastError,
    });
    const unresolvedProtection = this.isLiveAutoProtectionUnresolved(
      protectionResolution.protectionState
    );
    const routeAttemptStatus = this.resolveLiveAutoRouteAttemptStatus(
      protectionResolution.protectionState
    );
    const liveAutoOutcome = this.resolveCreatedLiveAutoRolloutOutcome(
      protectionResolution.protectionState
    );
    const liveAutoMessage = this.buildCreatedLiveAutoRolloutMessage({
      protectionAttached,
      protectionState: protectionResolution.protectionState,
    });
    const routeAttempts = this.upsertLiveAutoRouteAttempt(input.routeAttempts, {
      ...input.pendingAttempt,
      status: routeAttemptStatus,
      submissionState: 'accepted',
      finishedAt: linkedAt,
      orderId: createdOrderId,
      orderStatus: createdOrderStatus,
      failureClassification: protectionResolution.routeFailureClassification,
      failureMessage: protectionResolution.routeFailureMessage,
      note: protectionResolution.routeNote,
      brokerResponseSummary: this.buildLiveAutoBrokerResponseSummary(input.createdOrder),
    });
    input.routeAttempts.splice(0, input.routeAttempts.length, ...routeAttempts);
    const linkedExecution: SuggestedTradeExecutionLink = {
      ...input.submittingExecution,
      orderId: createdOrderId,
      orderStatus: createdOrderStatus,
      executionState: protectionClosedPosition
        ? 'closed'
        : unresolvedProtection
          ? 'working'
          : 'linked',
      linkedAt,
      positionStatus: protectionClosedPosition
        ? 'CLOSED'
        : input.submittingExecution.positionStatus,
      positionClosedAt: protectionClosedPosition
        ? linkedAt
        : input.submittingExecution.positionClosedAt,
      protectionState: protectionResolution.protectionState,
      protectionCheckedAt: linkedAt,
      protectionAttachedAt: protectionAttached ? linkedAt : null,
      protectionLastError: protectionResolution.protectionLastError,
      routeAttempts,
      protectionPlan: {
        ...(this.readRecordValue(input.submittingExecution.protectionPlan) ?? {}),
        source: 'suggested_trade_execution',
        symbol: input.trade.symbol,
        side: input.trade.side,
        timeframe: input.trade.timeframe,
        entryPrice: this.formatNumericString(input.prepared.normalizedEntryPrice) ?? null,
        stopLossPrice: this.formatNumericString(input.prepared.normalizedStopLossPrice) ?? null,
        takeProfitPrice: this.formatNumericString(input.prepared.normalizedTakeProfitPrice) ?? null,
        brokerKey: input.prepared.brokerKey,
        accountId: input.prepared.accountId,
        orderId: createdOrderId,
        ...(protectionMode ? { protectionMode } : {}),
        ...(bracketStatus ? { bracketStatus } : {}),
        ...(this.readStringValue(input.createdOrder.bracket_stop_loss_price)
          ? {
              bracketStopLossPrice: this.readStringValue(
                input.createdOrder.bracket_stop_loss_price
              ),
            }
          : {}),
        ...(this.readStringValue(input.createdOrder.bracket_take_profit_price)
          ? {
              bracketTakeProfitPrice: this.readStringValue(
                input.createdOrder.bracket_take_profit_price
              ),
            }
          : {}),
        ...(stopLossOrderId ? { stopLossOrderId } : {}),
        ...(takeProfitOrderId ? { takeProfitOrderId } : {}),
      },
      note: `Live order created automatically from automation suggestion.${protectionNote}`,
    };
    await this.persistExecutionState(input.trade, linkedExecution);

    await this.operationalEventService.logActivity(input.userId, {
      type: 'Suggested Trade',
      title: unresolvedProtection
        ? `Live auto order awaiting protection: ${input.trade.symbol}`
        : `Live auto order created: ${input.trade.symbol}`,
      status: unresolvedProtection ? 'Warning' : 'Success',
      route: 'Suggested Trades',
      stream: 'Execution',
      related: `${input.prepared.brokerKey} · ${input.prepared.accountId}`,
      referenceId: input.trade.id,
      symbol: input.trade.symbol,
      description: protectionAttached
        ? `Live order ${createdOrderId} created automatically after pre-trade clearance with native SL/TP protection`
        : `Live order ${createdOrderId} accepted after pre-trade clearance; protection lifecycle is ${protectionResolution.protectionState ?? 'pending'}.`,
    });
    await this.operationalEventService.emitNotificationAlert(input.userId, {
      channel: 'Trading',
      source: `trade-suggestion.live-auto.${unresolvedProtection ? 'working' : 'placed'}:${input.trade.id}`,
      symbol: input.trade.symbol,
      route: 'Suggested Trades',
      severity: 'Medium',
      message: unresolvedProtection
        ? `Live order ${createdOrderId} accepted for ${input.trade.symbol} on ${
            input.prepared.brokerKey
          }${input.prepared.accountId ? ` (${input.prepared.accountId})` : ''}; protection is ${protectionResolution.protectionState ?? 'pending'}.`
        : `Live order ${createdOrderId} created for ${input.trade.symbol} on ${
            input.prepared.brokerKey
          }${input.prepared.accountId ? ` (${input.prepared.accountId})` : ''}.`,
    });
    if (this.shouldStartLiveAutoLifecycleMonitor(protectionResolution.protectionState)) {
      this.startLiveAutoOrderLifecycleMonitor({
        userId: input.userId,
        suggestedTradeId: input.trade.id,
        brokerKey: input.prepared.brokerKey,
        accountId: input.prepared.accountId,
        orderId: createdOrderId,
      });
    }

    return {
      outcome: liveAutoOutcome,
      message: liveAutoMessage,
      suggestedTradeId: input.trade.id,
      brokerKey: input.prepared.brokerKey,
      accountId: input.prepared.accountId,
      preTradeCheckId: input.prepared.preTradeCheckId,
      orderId: createdOrderId,
      protectionState: protectionResolution.protectionState ?? null,
    };
  }

  private resolveCreatedLiveAutoOrderProtectionState(input: {
    brokerKey: string;
    protectionAttached: boolean;
    deltaLimitProtectionProvisional: boolean;
    deltaNativeBracketPending: boolean;
    needsPostFillProtection: boolean;
    protectionAttachmentNote: string | null;
    protectionClosedPosition?: boolean;
    fallbackProtectionState: SuggestedTradeProtectionState | null | undefined;
    fallbackProtectionLastError: string | null | undefined;
  }): {
    protectionState: SuggestedTradeProtectionState | undefined;
    protectionLastError: string | null | undefined;
    routeFailureClassification?: SuggestedTradeRouteAttemptFailureClassification | null;
    routeFailureMessage?: string | null;
    routeNote?: string | null;
  } {
    if (input.protectionAttached) {
      return {
        protectionState: 'attached',
        protectionLastError: null,
      };
    }

    if (input.protectionClosedPosition) {
      return {
        protectionState: 'not_required',
        protectionLastError: null,
        routeNote:
          input.protectionAttachmentNote ??
          'Position closed because SL/TP was already breached before protection could attach.',
      };
    }

    if (!input.needsPostFillProtection) {
      return {
        protectionState: input.fallbackProtectionState ?? undefined,
        protectionLastError: input.fallbackProtectionLastError,
      };
    }

    if (input.deltaNativeBracketPending) {
      const note =
        input.protectionAttachmentNote ??
        'Delta native bracket was submitted; waiting for entry fill and active bracket protection snapshots.';
      return {
        protectionState: 'waiting_for_fill',
        protectionLastError: note,
        routeFailureClassification: 'order_created_protection_unresolved',
        routeFailureMessage: note,
        routeNote: 'Order created; Delta native bracket protection must be reconciled after fill.',
      };
    }

    if (input.deltaLimitProtectionProvisional) {
      return {
        protectionState: 'waiting_for_fill',
        protectionLastError:
          input.protectionAttachmentNote ??
          'Broker created provisional SL/TP orders; waiting for entry fill and active protection snapshots.',
        routeFailureClassification: 'order_created_protection_unresolved',
        routeFailureMessage:
          input.protectionAttachmentNote ??
          'Broker order was created, but protection remains provisional until fill confirmation.',
        routeNote: 'Order created; protection remains provisional and must be reconciled.',
      };
    }

    const note = this.readStringValue(input.protectionAttachmentNote);
    if (!note) {
      return {
        protectionState: 'waiting_for_fill',
        protectionLastError: input.fallbackProtectionLastError,
        routeFailureClassification: 'order_created_protection_unresolved',
        routeFailureMessage:
          'Broker order was created, but native SL/TP protection was not confirmed yet.',
        routeNote: 'Order created; waiting for fill/position before protection repair.',
      };
    }

    const normalizedNote = note.toLowerCase();
    if (
      normalizedNote.includes('manual action') ||
      normalizedNote.includes('already breached') ||
      normalizedNote.includes('already crossed') ||
      normalizedNote.includes('unsafe') ||
      normalizedNote.includes('stale')
    ) {
      return {
        protectionState: 'manual_unlinked',
        protectionLastError: note,
        routeFailureClassification: 'order_created_protection_unresolved',
        routeFailureMessage: note,
        routeNote: 'Order created; protection needs manual action.',
      };
    }

    if (normalizedNote.includes('no matching open position')) {
      return {
        protectionState: 'waiting_for_position',
        protectionLastError: note,
        routeFailureClassification: 'order_created_protection_unresolved',
        routeFailureMessage: note,
        routeNote: 'Order created; waiting for matching position before protection repair.',
      };
    }

    return {
      protectionState: 'failed',
      protectionLastError: note,
      routeFailureClassification: 'order_created_protection_unresolved',
      routeFailureMessage: note,
      routeNote: 'Order created; automatic protection attachment failed.',
    };
  }

  private isLiveAutoProtectionUnresolved(
    protectionState: SuggestedTradeProtectionState | null | undefined
  ): boolean {
    return (
      protectionState === 'pending' ||
      protectionState === 'waiting_for_fill' ||
      protectionState === 'waiting_for_position' ||
      protectionState === 'attaching' ||
      protectionState === 'failed' ||
      protectionState === 'manual_unlinked'
    );
  }

  private resolveLiveAutoRouteAttemptStatus(
    protectionState: SuggestedTradeProtectionState | null | undefined
  ): SuggestedTradeRouteAttempt['status'] {
    if (protectionState === 'failed' || protectionState === 'manual_unlinked') {
      return 'manual_review';
    }
    if (this.isLiveAutoProtectionUnresolved(protectionState)) {
      return 'working';
    }
    return 'placed';
  }

  private resolveCreatedLiveAutoRolloutOutcome(
    protectionState: SuggestedTradeProtectionState | null | undefined
  ): SuggestedTradeAutoLiveRolloutOutcome {
    return this.isLiveAutoProtectionUnresolved(protectionState) ? 'working' : 'placed';
  }

  private buildCreatedLiveAutoRolloutMessage(input: {
    protectionAttached: boolean;
    protectionState: SuggestedTradeProtectionState | undefined;
  }): string {
    if (input.protectionAttached || input.protectionState === 'attached') {
      return 'Live order created automatically after pre-trade clearance with native SL/TP protection';
    }
    if (input.protectionState === 'waiting_for_fill') {
      return 'Live order accepted after pre-trade clearance; waiting for entry fill before SL/TP protection can be attached.';
    }
    if (input.protectionState === 'waiting_for_position') {
      return 'Live order accepted after pre-trade clearance; waiting for matching position before SL/TP protection repair.';
    }
    if (input.protectionState === 'manual_unlinked') {
      return 'Live order accepted after pre-trade clearance, but SL/TP protection needs manual action.';
    }
    if (input.protectionState === 'failed') {
      return 'Live order accepted after pre-trade clearance, but automatic SL/TP protection is unresolved.';
    }
    if (input.protectionState === 'pending' || input.protectionState === 'attaching') {
      return 'Live order accepted after pre-trade clearance; SL/TP protection is still being resolved.';
    }
    return 'Live order created automatically after pre-trade clearance';
  }

  private markLiveAutoRouteAttemptsForProtectionLifecycle(
    attempts: SuggestedTradeRouteAttempt[],
    protectionState: SuggestedTradeProtectionState | undefined,
    message: string
  ): SuggestedTradeRouteAttempt[] {
    if (!this.isLiveAutoProtectionUnresolved(protectionState)) {
      return attempts;
    }
    const status = this.resolveLiveAutoRouteAttemptStatus(protectionState);
    return attempts.map((attempt) => {
      if (
        attempt.status !== 'placed' &&
        attempt.status !== 'working' &&
        attempt.status !== 'manual_review'
      ) {
        return attempt;
      }
      return {
        ...attempt,
        status,
        failureClassification:
          attempt.failureClassification ?? 'order_created_protection_unresolved',
        failureMessage: attempt.failureMessage ?? message,
        note:
          attempt.note ??
          (status === 'manual_review'
            ? 'Order accepted; protection needs manual review.'
            : 'Order accepted; fill/protection lifecycle is still being tracked.'),
      };
    });
  }

  private shouldStartLiveAutoLifecycleMonitor(
    protectionState: SuggestedTradeProtectionState | null | undefined
  ): boolean {
    return (
      protectionState === 'pending' ||
      protectionState === 'waiting_for_fill' ||
      protectionState === 'waiting_for_position' ||
      protectionState === 'attaching'
    );
  }

  private shouldResumeLiveAutoLifecycleMonitor(
    execution: SuggestedTradeExecutionLink | null | undefined
  ): boolean {
    if (!execution || execution.executionMode !== 'live') {
      return false;
    }
    const executionState = this.readStringValue(execution.executionState)?.toLowerCase();
    if (['closed', 'cancelled', 'rejected', 'expired', 'failed'].includes(executionState ?? '')) {
      return false;
    }
    const protectionState = this.normalizeProtectionState(execution.protectionState);
    if (this.shouldStartLiveAutoLifecycleMonitor(protectionState)) {
      return true;
    }
    return (
      protectionState === 'failed' &&
      (this.isRetriableProtectionFailure(execution) ||
        this.isDeltaReplacementProtectionFailure(execution))
    );
  }

  private maybeStartLiveAutoLifecycleMonitorForExecution(
    userId: string,
    trade: SuggestedTrade,
    execution: SuggestedTradeExecutionLink | null | undefined
  ): void {
    if (!this.shouldResumeLiveAutoLifecycleMonitor(execution)) {
      return;
    }
    const brokerKey = this.readStringValue(execution?.brokerKey)?.toLowerCase();
    const accountId = this.readStringValue(execution?.accountId);
    if (!brokerKey || !accountId) {
      return;
    }
    this.startLiveAutoOrderLifecycleMonitor({
      userId,
      suggestedTradeId: trade.id,
      brokerKey,
      accountId,
      orderId: this.readStringValue(execution?.orderId),
    });
  }

  private startLiveAutoOrderLifecycleMonitor(input: LiveAutoLifecycleMonitorInput): void {
    if (!this.liveAutoLifecycleMonitorEnabled) {
      return;
    }
    const key = this.buildLiveAutoLifecycleMonitorKey(input);
    if (!key || this.liveAutoLifecycleMonitorKeys.has(key)) {
      return;
    }
    this.liveAutoLifecycleMonitorKeys.add(key);
    void this.runLiveAutoOrderLifecycleMonitor(input)
      .catch(() => undefined)
      .finally(() => {
        this.liveAutoLifecycleMonitorKeys.delete(key);
      });
  }

  private buildLiveAutoLifecycleMonitorKey(input: LiveAutoLifecycleMonitorInput): string | null {
    const userId = this.readStringValue(input.userId);
    const tradeId = this.readStringValue(input.suggestedTradeId);
    const brokerKey = this.readStringValue(input.brokerKey)?.toLowerCase();
    const accountId = this.readStringValue(input.accountId);
    const orderId = this.readStringValue(input.orderId) ?? 'position';
    if (!userId || !tradeId || !brokerKey || !accountId) {
      return null;
    }
    return [userId, tradeId, brokerKey, accountId, orderId].join(':');
  }

  private async runLiveAutoOrderLifecycleMonitor(
    input: LiveAutoLifecycleMonitorInput
  ): Promise<void> {
    const startedAt = Date.now();
    const maxDurationMs = await this.resolveLiveAutoLifecycleMonitorDurationMs(input);

    while (Date.now() - startedAt <= maxDurationMs) {
      const settled = await this.runLiveAutoOrderLifecycleMonitorOnce(input);
      if (settled) {
        return;
      }

      const remainingMs = maxDurationMs - (Date.now() - startedAt);
      if (remainingMs <= 0) {
        break;
      }
      await this.waitForLiveAutoLifecycleMonitorPoll(
        Math.min(LIVE_AUTO_LIFECYCLE_MONITOR_INTERVAL_MS, remainingMs)
      );
    }

    await this.runLiveAutoOrderLifecycleMonitorOnce(input);
  }

  private async resolveLiveAutoLifecycleMonitorDurationMs(
    input: LiveAutoLifecycleMonitorInput
  ): Promise<number> {
    try {
      const trade = await this.suggestedTradeRepository.getSuggestedTradeById(
        input.userId,
        input.suggestedTradeId
      );
      if (!trade) {
        return LIVE_AUTO_LIFECYCLE_MONITOR_DEFAULT_DURATION_MS;
      }
      const executionPolicy = await this.loadTradeSuggestionExecutionPolicy(
        input.userId,
        trade.automationId
      );
      const expirySeconds = resolveLimitOrderExpirySeconds(
        trade.timeframe,
        executionPolicy.limitOrderExpiry
      );
      if (expirySeconds === null) {
        return LIVE_AUTO_LIFECYCLE_MONITOR_DEFAULT_DURATION_MS;
      }
      return Math.min(
        LIVE_AUTO_LIFECYCLE_MONITOR_MAX_DURATION_MS,
        Math.max(LIVE_AUTO_LIFECYCLE_MONITOR_INTERVAL_MS, expirySeconds * 1000)
      );
    } catch {
      return LIVE_AUTO_LIFECYCLE_MONITOR_DEFAULT_DURATION_MS;
    }
  }

  private async runLiveAutoOrderLifecycleMonitorOnce(
    input: LiveAutoLifecycleMonitorInput
  ): Promise<boolean> {
    const trade = await this.suggestedTradeRepository.getSuggestedTradeById(
      input.userId,
      input.suggestedTradeId
    );
    if (!trade) {
      return true;
    }

    const execution = this.getExecutionLink(trade);
    if (!execution || execution.executionMode !== 'live') {
      return true;
    }

    const brokerKey = this.readStringValue(execution.brokerKey)?.toLowerCase();
    const accountId = this.readStringValue(execution.accountId);
    const orderId = this.readStringValue(execution.orderId);
    if (
      !brokerKey ||
      !accountId ||
      brokerKey !== input.brokerKey.toLowerCase() ||
      accountId !== input.accountId ||
      (input.orderId && orderId && orderId !== input.orderId)
    ) {
      return true;
    }

    if (this.isLiveAutoLifecycleMonitorSettled(execution)) {
      return true;
    }

    let nextExecution = execution;
    const orderSnapshot = await this.fetchLiveAutoBrokerOrderSnapshot(input, nextExecution);
    if (orderSnapshot) {
      nextExecution = this.mergeExecutionOutcome(nextExecution, orderSnapshot);
    }

    const positionSnapshots = await this.fetchLiveAutoBrokerPositionSnapshots(
      input,
      trade,
      nextExecution
    );
    nextExecution = this.mergePositionOutcome(trade, nextExecution, positionSnapshots, {
      allowPositionEvidenceFill: true,
    });
    nextExecution = await this.maybeExpireLiveLimitEntryOrder(
      input.userId,
      trade,
      nextExecution,
      positionSnapshots
    );
    nextExecution = await this.maybeRemediateLiveProtection(
      input.userId,
      trade,
      nextExecution,
      positionSnapshots
    );
    nextExecution = await this.maybeApplyLiveTrailingStop(
      input.userId,
      trade,
      nextExecution,
      positionSnapshots
    );
    nextExecution = await this.maybeAutoCancelSiblingProtectionOrders(
      input.userId,
      trade,
      nextExecution,
      positionSnapshots
    );
    nextExecution = this.alignLiveAutoExecutionStateWithProtectionLifecycle(nextExecution);

    if (JSON.stringify(execution ?? null) !== JSON.stringify(nextExecution ?? null)) {
      await this.persistExecutionState(trade, nextExecution);
    }

    return this.isLiveAutoLifecycleMonitorSettled(nextExecution);
  }

  private async fetchLiveAutoBrokerOrderSnapshot(
    input: LiveAutoLifecycleMonitorInput,
    execution: SuggestedTradeExecutionLink
  ): Promise<{
    orderStatus: string | null;
    statusRank: number | null;
    lastSeenAt: Date | string | null;
    payload: Record<string, unknown> | null;
  } | null> {
    const orderId = this.readStringValue(execution.orderId) ?? this.readStringValue(input.orderId);
    if (!orderId || !this.brokerRuntimeRegistry?.supportsOrdersAdapter?.(input.brokerKey)) {
      return null;
    }

    const adapter = this.brokerRuntimeRegistry.getOrdersAdapter(input.brokerKey) as {
      getOrder?: (...args: unknown[]) => Promise<unknown>;
    };
    if (typeof adapter.getOrder !== 'function') {
      return null;
    }

    try {
      const raw = await adapter.getOrder(orderId, {
        userId: input.userId,
        brokerKey: input.brokerKey,
        accountId: input.accountId,
      });
      const records = this.extractBrokerRecordCandidates(raw);
      const record =
        records.find((candidate) => this.extractBrokerRecordId(candidate) === orderId) ??
        records[0] ??
        null;
      if (!record) {
        return null;
      }
      const payload = {
        ...record,
        order_id: this.extractBrokerRecordId(record) ?? orderId,
      };
      return {
        orderStatus: this.extractBrokerRecordStatus(record),
        statusRank: null,
        lastSeenAt: this.extractBrokerRecordIsoTimestamp(record) ?? new Date().toISOString(),
        payload,
      };
    } catch {
      return null;
    }
  }

  private async fetchLiveAutoBrokerPositionSnapshots(
    input: LiveAutoLifecycleMonitorInput,
    trade: SuggestedTrade,
    execution: SuggestedTradeExecutionLink
  ): Promise<LivePositionSnapshot[]> {
    if (!this.brokerRuntimeRegistry?.supportsPositionsAdapter?.(input.brokerKey)) {
      return [];
    }

    const adapter = this.brokerRuntimeRegistry.getPositionsAdapter(input.brokerKey) as {
      getPositions?: (...args: unknown[]) => Promise<unknown>;
    };
    if (typeof adapter.getPositions !== 'function') {
      return [];
    }

    try {
      const raw = await adapter.getPositions(
        { limit: 100 },
        {
          userId: input.userId,
          brokerKey: input.brokerKey,
          accountId: input.accountId,
        }
      );
      const expectedSymbols = this.buildLiveAutoExecutionSymbols(trade, execution);
      const expectedDirection =
        String(trade.side || '')
          .trim()
          .toUpperCase() === 'SELL'
          ? 'short'
          : 'long';
      const anchorMs =
        this.toTimestamp(
          execution.submittedAt ?? execution.linkedAt ?? execution.acceptedAt ?? trade.signalTime
        ) ?? Date.now();
      return this.extractBrokerRecordCandidates(raw)
        .filter((record) =>
          this.isLiveAutoBrokerPositionMatch(
            record,
            expectedSymbols,
            expectedDirection,
            execution,
            anchorMs
          )
        )
        .map((record) => this.toLiveAutoPositionSnapshot(record))
        .filter((snapshot): snapshot is LivePositionSnapshot => snapshot !== null);
    } catch {
      return [];
    }
  }

  private buildLiveAutoExecutionSymbols(
    trade: SuggestedTrade,
    execution: SuggestedTradeExecutionLink
  ): Set<string> {
    const brokerKey = this.readStringValue(execution.brokerKey);
    const symbols = new Set<string>();
    const addSymbol = (value: unknown): void => {
      const symbol = this.readStringValue(value);
      if (!symbol) {
        return;
      }
      symbols.add(symbol.toUpperCase());
      for (const equivalent of this.buildEquivalentLiveAutoSymbols(
        symbol,
        brokerKey ?? undefined
      )) {
        symbols.add(equivalent);
      }
    };

    addSymbol(trade.symbol);
    for (const attempt of execution.routeAttempts ?? []) {
      addSymbol(attempt.requestedSymbol);
      addSymbol(attempt.brokerSymbol);
    }
    const protectionPlan = this.readRecordValue(execution.protectionPlan);
    addSymbol(protectionPlan?.symbol);
    addSymbol(protectionPlan?.brokerSymbol);
    return symbols;
  }

  private isLiveAutoBrokerPositionMatch(
    record: Record<string, unknown>,
    expectedSymbols: Set<string>,
    expectedDirection: 'long' | 'short',
    execution: SuggestedTradeExecutionLink,
    anchorMs: number
  ): boolean {
    const symbol = this.extractBrokerRecordSymbol(record);
    if (!symbol || !expectedSymbols.has(symbol)) {
      return false;
    }

    const status = this.normalizePositionStatus(this.extractBrokerRecordStatus(record));
    if (status === 'CLOSED' || status === 'LIQUIDATED') {
      return false;
    }

    const direction = this.extractBrokerRecordDirection(record);
    if (direction && direction !== expectedDirection) {
      return false;
    }

    const observedMs = this.extractBrokerRecordTimestamp(record);
    if (observedMs !== null && observedMs >= anchorMs - 10 * 60 * 1000) {
      return true;
    }

    const quantity = this.extractBrokerRecordQuantity(record);
    return Boolean(
      quantity !== null &&
      execution.quantity !== null &&
      execution.quantity !== undefined &&
      this.isLiveAutoQuantityClose(quantity, execution.quantity)
    );
  }

  private toLiveAutoPositionSnapshot(record: Record<string, unknown>): LivePositionSnapshot | null {
    const externalId = this.extractBrokerRecordId(record);
    if (!externalId) {
      return null;
    }
    const status = this.extractBrokerRecordStatus(record);
    const observedAt = this.extractBrokerRecordIsoTimestamp(record) ?? new Date().toISOString();
    return {
      externalId,
      status,
      statusRank: null,
      firstSeenAt: observedAt,
      lastSeenAt: observedAt,
      payload: record,
    };
  }

  private isLiveAutoLifecycleMonitorSettled(execution: SuggestedTradeExecutionLink): boolean {
    const executionState = this.readStringValue(execution.executionState)?.toLowerCase();
    if (['closed', 'cancelled', 'rejected', 'expired', 'failed'].includes(executionState ?? '')) {
      return true;
    }
    const protectionState = this.normalizeProtectionState(execution.protectionState);
    if (protectionState === 'failed') {
      return (
        !this.isRetriableProtectionFailure(execution) &&
        !this.isDeltaReplacementProtectionFailure(execution)
      );
    }
    return (
      protectionState === 'attached' ||
      protectionState === 'not_required' ||
      protectionState === 'manual_unlinked'
    );
  }

  private alignLiveAutoExecutionStateWithProtectionLifecycle(
    execution: SuggestedTradeExecutionLink
  ): SuggestedTradeExecutionLink {
    if (execution.executionMode !== 'live') {
      return execution;
    }
    const executionState = this.readStringValue(execution.executionState)?.toLowerCase();
    if (['closed', 'cancelled', 'rejected', 'expired', 'failed'].includes(executionState ?? '')) {
      return execution;
    }
    if (
      this.isLiveAutoProtectionUnresolved(this.normalizeProtectionState(execution.protectionState))
    ) {
      return {
        ...execution,
        executionState: 'working',
      };
    }
    return execution;
  }

  private waitForLiveAutoLifecycleMonitorPoll(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      const unref = (timer as { unref?: () => void }).unref;
      if (typeof unref === 'function') {
        unref.call(timer);
      }
    });
  }

  private async reconcileLiveAutoAmbiguousRoute(input: {
    userId: string;
    prepared: PreparedLiveAutoRoute;
    createOrderBody: CreateOrderBody;
    submittedAt: string;
  }): Promise<LiveAutoRouteReconciliationResult> {
    const checkedAt = new Date().toISOString();
    const [ordersLookup, positionsLookup] = await Promise.all([
      this.listLiveAutoBrokerOrdersForReconciliation(input),
      this.listLiveAutoBrokerPositionsForReconciliation(input),
    ]);
    const matchingOrder = this.findLiveAutoReconciledOrder(
      ordersLookup.records,
      input.prepared,
      input.createOrderBody
    );
    if (matchingOrder) {
      const orderId = this.extractBrokerRecordId(matchingOrder);
      return {
        status: 'found_order',
        checkedAt,
        message: orderId
          ? `Broker order ${orderId} was found during ambiguous-submit reconciliation.`
          : 'Broker order was found during ambiguous-submit reconciliation.',
        order: matchingOrder,
        orderId,
        orderStatus: this.extractBrokerRecordStatus(matchingOrder),
      };
    }

    const matchingPosition = this.findLiveAutoReconciledPosition(
      positionsLookup.records,
      input.prepared,
      input.submittedAt
    );
    if (matchingPosition) {
      const positionId = this.extractBrokerRecordId(matchingPosition);
      return {
        status: 'found_position',
        checkedAt,
        message: positionId
          ? `Broker position ${positionId} was found during ambiguous-submit reconciliation.`
          : 'Broker position was found during ambiguous-submit reconciliation.',
        position: matchingPosition,
        positionId,
        positionStatus: this.extractBrokerRecordStatus(matchingPosition),
      };
    }

    if (ordersLookup.checked && positionsLookup.checked) {
      return {
        status: 'confirmed_no_order',
        checkedAt,
        message:
          'Broker orders and positions were checked after the ambiguous submit failure; no matching order or position was found.',
      };
    }

    const lookupIssues = [ordersLookup.error, positionsLookup.error].filter(
      (value): value is string => Boolean(value)
    );
    return {
      status: lookupIssues.length ? 'failed' : 'inconclusive',
      checkedAt,
      message: lookupIssues.length
        ? `Broker reconciliation could not complete: ${lookupIssues.join('; ')}`
        : 'Broker reconciliation was inconclusive; do not try another broker route until the account is reviewed.',
    };
  }

  private async listLiveAutoBrokerOrdersForReconciliation(input: {
    userId: string;
    prepared: PreparedLiveAutoRoute;
    submittedAt: string;
  }): Promise<LiveAutoBrokerRecordLookup> {
    let adapter: {
      listOpenOrders?: (...args: unknown[]) => Promise<unknown>;
      getOrderHistory?: (...args: unknown[]) => Promise<unknown>;
    };
    try {
      adapter = this.brokerRuntimeRegistry.getOrdersAdapter(
        input.prepared.brokerKey
      ) as typeof adapter;
    } catch (error) {
      return {
        checked: false,
        records: [],
        error: `Orders adapter unavailable for ${input.prepared.brokerKey}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }

    const query = {
      limit: 100,
      brokerKey: input.prepared.brokerKey,
      accountId: input.prepared.accountId,
      startDate: this.buildLiveAutoReconciliationStartDate(input.submittedAt),
      endDate: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
    };
    const context = {
      userId: input.userId,
      brokerKey: input.prepared.brokerKey,
      accountId: input.prepared.accountId,
    };
    const records: Record<string, unknown>[] = [];
    const errors: string[] = [];
    let checked = false;

    if (typeof adapter.listOpenOrders === 'function') {
      try {
        records.push(...this.extractBrokerRecordList(await adapter.listOpenOrders(query, context)));
        checked = true;
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }

    if (typeof adapter.getOrderHistory === 'function') {
      try {
        records.push(
          ...this.extractBrokerRecordList(await adapter.getOrderHistory(query, context))
        );
        checked = true;
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }

    return {
      checked,
      records,
      error: checked
        ? null
        : errors.join('; ') || 'Orders adapter does not expose reconciliation reads',
    };
  }

  private async listLiveAutoBrokerPositionsForReconciliation(input: {
    userId: string;
    prepared: PreparedLiveAutoRoute;
  }): Promise<LiveAutoBrokerRecordLookup> {
    let adapter: {
      getPositions?: (...args: unknown[]) => Promise<unknown>;
    };
    try {
      adapter = this.brokerRuntimeRegistry.getPositionsAdapter(
        input.prepared.brokerKey
      ) as typeof adapter;
    } catch (error) {
      return {
        checked: false,
        records: [],
        error: `Positions adapter unavailable for ${input.prepared.brokerKey}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }

    if (typeof adapter.getPositions !== 'function') {
      return {
        checked: false,
        records: [],
        error: 'Positions adapter does not expose getPositions for reconciliation',
      };
    }

    try {
      const response = await adapter.getPositions(
        { limit: 100 },
        {
          userId: input.userId,
          brokerKey: input.prepared.brokerKey,
          accountId: input.prepared.accountId,
        }
      );
      return {
        checked: true,
        records: this.extractBrokerRecordList(response),
      };
    } catch (error) {
      return {
        checked: false,
        records: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private applyLiveAutoRouteReconciliation(
    attempt: SuggestedTradeRouteAttempt,
    reconciliation: LiveAutoRouteReconciliationResult
  ): SuggestedTradeRouteAttempt {
    const foundBrokerState =
      reconciliation.status === 'found_order' || reconciliation.status === 'found_position';
    const confirmedNoOrder = reconciliation.status === 'confirmed_no_order';
    return {
      ...attempt,
      status: foundBrokerState ? 'placed' : confirmedNoOrder ? 'failed' : 'manual_review',
      submissionState: foundBrokerState ? 'accepted' : confirmedNoOrder ? 'failed' : 'unknown',
      orderId: reconciliation.orderId ?? attempt.orderId ?? null,
      orderStatus: reconciliation.orderStatus ?? attempt.orderStatus ?? null,
      failureClassification: confirmedNoOrder
        ? 'confirmed_no_order'
        : foundBrokerState
          ? null
          : (attempt.failureClassification ?? 'ambiguous'),
      reconciliation: {
        status: reconciliation.status,
        checkedAt: reconciliation.checkedAt,
        orderId: reconciliation.orderId ?? null,
        positionId: reconciliation.positionId ?? null,
        message: reconciliation.message,
      },
    };
  }

  private async persistReconciledLiveAutoOrderRoute(input: {
    userId: string;
    trade: SuggestedTrade;
    prepared: PreparedLiveAutoRoute;
    submittingExecution: SuggestedTradeExecutionLink;
    routeAttempts: SuggestedTradeRouteAttempt[];
    reconciliation: LiveAutoRouteReconciliationResult;
  }): Promise<SuggestedTradeAutoLiveRolloutResult> {
    const order = input.reconciliation.order ?? {};
    const orderId = input.reconciliation.orderId ?? this.extractBrokerRecordId(order);
    const orderStatus =
      this.normalizeOrderStatus(input.reconciliation.orderStatus) ??
      this.normalizeOrderStatus(this.extractBrokerRecordStatus(order));
    const linkedAt = input.reconciliation.checkedAt;
    const filledAt =
      this.toIsoString(order.filled_at) ??
      this.toIsoString(order.filledAt) ??
      (orderStatus === 'FILLED' ? (this.extractBrokerRecordIsoTimestamp(order) ?? linkedAt) : null);
    const filledPrice =
      this.readStringValue(order.filled_price) ??
      this.readStringValue(order.filledPrice) ??
      this.readStringValue(order.average_fill_price) ??
      this.readStringValue(order.averageFillPrice) ??
      null;
    const filledQuantity =
      this.readNumberValue(order.filled_quantity) ??
      this.readNumberValue(order.filledQuantity) ??
      null;
    const remainingQuantity =
      this.readNumberValue(order.remaining_quantity) ??
      this.readNumberValue(order.remainingQuantity) ??
      null;
    const expectedProtection = Boolean(
      input.prepared.normalizedStopLossPrice > 0 && input.prepared.normalizedTakeProfitPrice > 0
    );
    const protectionState: SuggestedTradeProtectionState | undefined = expectedProtection
      ? orderStatus === 'FILLED'
        ? 'waiting_for_position'
        : 'waiting_for_fill'
      : (input.submittingExecution.protectionState ?? undefined);
    const protectionLastError = expectedProtection
      ? orderStatus === 'FILLED'
        ? 'Broker order was found filled during ambiguous-submit reconciliation; waiting for matching position before SL/TP protection repair.'
        : 'Broker order was found during ambiguous-submit reconciliation; waiting for fill/position before SL/TP protection repair.'
      : input.submittingExecution.protectionLastError;
    const routeAttempts = this.markLiveAutoRouteAttemptsForProtectionLifecycle(
      input.routeAttempts,
      protectionState,
      protectionLastError ?? 'Broker order was found during ambiguous-submit reconciliation.'
    );
    const linkedExecution: SuggestedTradeExecutionLink = {
      ...input.submittingExecution,
      orderId: orderId ?? input.submittingExecution.orderId ?? null,
      orderStatus: orderStatus ?? input.submittingExecution.orderStatus ?? null,
      executionState: this.isLiveAutoProtectionUnresolved(protectionState)
        ? 'working'
        : orderStatus === 'FILLED'
          ? 'filled'
          : 'linked',
      linkedAt,
      filledAt: filledAt ?? input.submittingExecution.filledAt ?? null,
      filledPrice: filledPrice ?? input.submittingExecution.filledPrice ?? null,
      filledQuantity: filledQuantity ?? input.submittingExecution.filledQuantity ?? null,
      remainingQuantity: remainingQuantity ?? input.submittingExecution.remainingQuantity ?? null,
      protectionState,
      protectionCheckedAt: linkedAt,
      protectionAttachedAt: null,
      protectionLastError,
      routeAttempts,
      protectionPlan: this.buildLiveAutoReconciledProtectionPlan(input, {
        orderId: orderId ?? null,
      }),
      note: this.appendExecutionNote(input.submittingExecution.note, input.reconciliation.message),
    };

    await this.persistExecutionState(input.trade, linkedExecution);
    await this.logLiveAutoReconciledRoute(input.userId, input.trade, input.prepared, {
      referenceId: orderId ?? input.trade.id,
      description: input.reconciliation.message,
    });
    if (this.shouldStartLiveAutoLifecycleMonitor(protectionState)) {
      this.startLiveAutoOrderLifecycleMonitor({
        userId: input.userId,
        suggestedTradeId: input.trade.id,
        brokerKey: input.prepared.brokerKey,
        accountId: input.prepared.accountId,
        orderId: orderId ?? null,
      });
    }

    return {
      outcome: this.resolveCreatedLiveAutoRolloutOutcome(protectionState),
      message: input.reconciliation.message,
      suggestedTradeId: input.trade.id,
      brokerKey: input.prepared.brokerKey,
      accountId: input.prepared.accountId,
      preTradeCheckId: input.prepared.preTradeCheckId,
      orderId,
      protectionState: protectionState ?? null,
    };
  }

  private async persistReconciledLiveAutoPositionRoute(input: {
    userId: string;
    trade: SuggestedTrade;
    prepared: PreparedLiveAutoRoute;
    submittingExecution: SuggestedTradeExecutionLink;
    routeAttempts: SuggestedTradeRouteAttempt[];
    reconciliation: LiveAutoRouteReconciliationResult;
  }): Promise<SuggestedTradeAutoLiveRolloutResult> {
    const position = input.reconciliation.position ?? {};
    const positionId = input.reconciliation.positionId ?? this.extractBrokerRecordId(position);
    const positionStatus =
      this.normalizePositionStatus(input.reconciliation.positionStatus) ??
      this.normalizePositionStatus(this.extractBrokerRecordStatus(position)) ??
      'OPEN';
    const filledAt =
      this.extractBrokerRecordIsoTimestamp(position) ?? input.reconciliation.checkedAt;
    const filledPrice =
      this.readStringValue(position.entry_price) ??
      this.readStringValue(position.entryPrice) ??
      this.readStringValue(position.avg_entry_price) ??
      this.readStringValue(position.average_entry_price) ??
      input.submittingExecution.filledPrice ??
      null;
    const filledQuantity =
      this.extractBrokerRecordQuantity(position) ??
      input.submittingExecution.filledQuantity ??
      null;
    const expectedProtection = Boolean(
      input.prepared.normalizedStopLossPrice > 0 && input.prepared.normalizedTakeProfitPrice > 0
    );
    const openPosition = positionStatus !== 'CLOSED' && positionStatus !== 'LIQUIDATED';
    const protectionState: SuggestedTradeProtectionState | undefined =
      expectedProtection && openPosition
        ? 'pending'
        : (input.submittingExecution.protectionState ?? undefined);
    const protectionLastError =
      expectedProtection && openPosition
        ? 'Broker position was found during ambiguous-submit reconciliation; SL/TP protection repair is required.'
        : input.submittingExecution.protectionLastError;
    const routeAttempts = this.markLiveAutoRouteAttemptsForProtectionLifecycle(
      input.routeAttempts,
      protectionState,
      protectionLastError ?? 'Broker position was found during ambiguous-submit reconciliation.'
    );
    const linkedExecution: SuggestedTradeExecutionLink = {
      ...input.submittingExecution,
      orderStatus: input.submittingExecution.orderStatus ?? 'FILLED',
      executionState:
        positionStatus === 'CLOSED' || positionStatus === 'LIQUIDATED'
          ? 'closed'
          : this.isLiveAutoProtectionUnresolved(protectionState)
            ? 'working'
            : 'filled',
      linkedAt: input.reconciliation.checkedAt,
      filledAt,
      filledPrice,
      filledQuantity,
      remainingQuantity: 0,
      positionId: positionId ?? input.submittingExecution.positionId ?? null,
      positionStatus,
      positionOpenedAt: filledAt,
      protectionState,
      protectionCheckedAt: input.reconciliation.checkedAt,
      protectionAttachedAt: null,
      protectionLastError,
      routeAttempts,
      protectionPlan: this.buildLiveAutoReconciledProtectionPlan(input, {
        positionId: positionId ?? null,
      }),
      note: this.appendExecutionNote(input.submittingExecution.note, input.reconciliation.message),
    };

    await this.persistExecutionState(input.trade, linkedExecution);
    await this.logLiveAutoReconciledRoute(input.userId, input.trade, input.prepared, {
      referenceId: positionId ?? input.trade.id,
      description: input.reconciliation.message,
    });
    if (this.shouldStartLiveAutoLifecycleMonitor(protectionState)) {
      this.startLiveAutoOrderLifecycleMonitor({
        userId: input.userId,
        suggestedTradeId: input.trade.id,
        brokerKey: input.prepared.brokerKey,
        accountId: input.prepared.accountId,
        orderId: this.readStringValue(input.submittingExecution.orderId),
      });
    }

    return {
      outcome: this.resolveCreatedLiveAutoRolloutOutcome(protectionState),
      message: input.reconciliation.message,
      suggestedTradeId: input.trade.id,
      brokerKey: input.prepared.brokerKey,
      accountId: input.prepared.accountId,
      preTradeCheckId: input.prepared.preTradeCheckId,
      orderId: null,
      protectionState: protectionState ?? null,
    };
  }

  private buildLiveAutoReconciledProtectionPlan(
    input: {
      trade: SuggestedTrade;
      prepared: PreparedLiveAutoRoute;
      submittingExecution: SuggestedTradeExecutionLink;
    },
    identifiers: {
      orderId?: string | null;
      positionId?: string | null;
    }
  ): Record<string, unknown> {
    return {
      ...(this.readRecordValue(input.submittingExecution.protectionPlan) ?? {}),
      source: 'suggested_trade_execution',
      symbol: input.trade.symbol,
      side: input.trade.side,
      timeframe: input.trade.timeframe,
      entryPrice: this.formatNumericString(input.prepared.normalizedEntryPrice) ?? null,
      stopLossPrice: this.formatNumericString(input.prepared.normalizedStopLossPrice) ?? null,
      takeProfitPrice: this.formatNumericString(input.prepared.normalizedTakeProfitPrice) ?? null,
      brokerKey: input.prepared.brokerKey,
      accountId: input.prepared.accountId,
      ...(identifiers.orderId ? { orderId: identifiers.orderId } : {}),
      ...(identifiers.positionId ? { positionId: identifiers.positionId } : {}),
    };
  }

  private async logLiveAutoReconciledRoute(
    userId: string,
    trade: SuggestedTrade,
    prepared: PreparedLiveAutoRoute,
    options: {
      referenceId: string;
      description: string;
    }
  ): Promise<void> {
    await this.operationalEventService.logActivity(userId, {
      type: 'Suggested Trade',
      title: `Live auto route reconciled: ${trade.symbol}`,
      status: 'Success',
      route: 'Suggested Trades',
      stream: 'Execution',
      related: `${prepared.brokerKey} · ${prepared.accountId}`,
      referenceId: options.referenceId,
      symbol: trade.symbol,
      description: options.description,
    });
  }

  private buildLiveAutoRoutePendingAttempt(
    prepared: PreparedLiveAutoRoute,
    startedAt: string
  ): SuggestedTradeRouteAttempt {
    return {
      attemptNumber: prepared.gate.candidateRank,
      candidateRank: prepared.gate.candidateRank,
      brokerKey: prepared.brokerKey,
      accountId: prepared.accountId,
      accountName: prepared.gate.candidate?.route.accountName ?? null,
      requestedSymbol: prepared.resolvedAssetRoute.requestedSymbol,
      brokerSymbol: prepared.resolvedAssetRoute.brokerSymbol,
      status: 'pending',
      startedAt,
      preTradeCheckId: prepared.preTradeCheckId,
      preTradeState: prepared.gate.execution.preTradeState ?? null,
      submissionState: 'not_started',
      requestSummary: this.buildLiveAutoRouteRequestSummary(prepared),
    };
  }

  private buildLiveAutoRouteFailureAttempt(input: {
    gate: LiveAutoRouteGate;
    brokerKey: string | null;
    accountId: string | null;
    message: string;
    failureClassification: SuggestedTradeRouteAttemptFailureClassification;
    failureCode: string | null;
    status: SuggestedTradeRouteAttempt['status'];
    orderId?: string | null;
    requestSummary?: Record<string, unknown> | null;
    brokerResponseSummary?: Record<string, unknown> | null;
  }): SuggestedTradeRouteAttempt {
    const now = new Date().toISOString();
    const requestSymbol =
      this.readStringValue(input.gate.result.request.order.symbol) ??
      this.readStringValue(input.gate.candidate?.request.order.symbol) ??
      'unknown';
    return {
      attemptNumber: input.gate.candidateRank,
      candidateRank: input.gate.candidateRank,
      brokerKey:
        input.brokerKey ?? this.readStringValue(input.gate.candidate?.route.brokerKey) ?? 'unknown',
      accountId: input.accountId ?? this.readStringValue(input.gate.candidate?.route.accountId),
      accountName: input.gate.candidate?.route.accountName ?? null,
      requestedSymbol: requestSymbol,
      brokerSymbol:
        this.readStringValue(input.gate.candidate?.request.order.symbol) ?? requestSymbol,
      status: input.status,
      startedAt: this.toIsoString(input.gate.execution.submittedAt) ?? now,
      finishedAt: now,
      preTradeCheckId: this.resolvePersistedPreTradeCheckId(input.gate.result),
      preTradeState: input.gate.execution.preTradeState ?? null,
      submissionState: input.status === 'pre_trade_blocked' ? 'pre_trade' : 'failed',
      orderId: input.orderId ?? null,
      failureClassification: input.failureClassification,
      failureCode: input.failureCode,
      failureMessage: input.message,
      requestSummary: input.requestSummary ?? null,
      brokerResponseSummary: input.brokerResponseSummary ?? null,
      reconciliation:
        input.failureClassification === 'ambiguous'
          ? {
              status: 'pending',
              checkedAt: now,
              message: 'Reconciliation is required before trying another broker route.',
            }
          : {
              status: 'not_required',
              checkedAt: now,
            },
    };
  }

  private upsertLiveAutoRouteAttempt(
    existingAttempts: SuggestedTradeRouteAttempt[],
    attempt: SuggestedTradeRouteAttempt
  ): SuggestedTradeRouteAttempt[] {
    const nextAttempts = [...existingAttempts];
    const existingIndex = nextAttempts.findIndex(
      (item) =>
        item.attemptNumber === attempt.attemptNumber ||
        (item.brokerKey === attempt.brokerKey && item.accountId === attempt.accountId)
    );
    if (existingIndex >= 0) {
      nextAttempts[existingIndex] = {
        ...nextAttempts[existingIndex],
        ...attempt,
      };
    } else {
      nextAttempts.push(attempt);
    }
    return nextAttempts.sort((left, right) => left.attemptNumber - right.attemptNumber);
  }

  private buildLiveAutoRouteRequestSummary(
    prepared: PreparedLiveAutoRoute
  ): Record<string, unknown> {
    return {
      orderType: prepared.orderType,
      triggerType: prepared.triggerType,
      leverage: prepared.leverage,
      quantity: prepared.normalizedQuantity,
      entryPrice: this.formatNumericString(prepared.normalizedEntryPrice),
      stopLossPrice: this.formatNumericString(prepared.normalizedStopLossPrice),
      takeProfitPrice: this.formatNumericString(prepared.normalizedTakeProfitPrice),
      reduceOnly: prepared.requestOrder.reduceOnly === true,
      ...(prepared.deltaProtectionMode
        ? { deltaProtectionMode: prepared.deltaProtectionMode }
        : {}),
    };
  }

  private buildLiveAutoBrokerResponseSummary(
    response: Record<string, unknown>
  ): Record<string, unknown> {
    return {
      orderId: this.readStringValue(response.order_id) ?? this.readStringValue(response.orderId),
      status: this.readStringValue(response.status) ?? this.readStringValue(response.order_status),
      protectionStatus: this.readStringValue(response.protection_status),
      protectionMode:
        this.readStringValue(response.protection_mode) ??
        this.readStringValue(response.delta_protection_mode),
      bracketStatus: this.readStringValue(response.bracket_status),
      stopLossOrderId: this.readStringValue(response.stop_loss_order_id),
      takeProfitOrderId: this.readStringValue(response.take_profit_order_id),
    };
  }

  private buildLiveAutoBrokerErrorSummary(error: unknown): Record<string, unknown> | null {
    if (!error || typeof error !== 'object') {
      return null;
    }
    const record = error as Record<string, unknown>;
    const summary: Record<string, unknown> = {};
    for (const key of [
      'broker',
      'brokerStatusCode',
      'brokerRoutePath',
      'brokerErrorCode',
      'brokerErrorMessage',
    ]) {
      const value = this.readStringValue(record[key]) ?? this.readNumberValue(record[key]);
      if (value !== null) {
        summary[key] = value;
      }
    }
    const payload = this.readRecordValue(record.brokerErrorPayload);
    if (payload) {
      summary.brokerErrorPayload = payload;
    }
    return Object.keys(summary).length ? summary : null;
  }

  private buildLiveAutoReconciliationStartDate(submittedAt: string): string {
    const parsed = Date.parse(submittedAt);
    const startMs = Number.isFinite(parsed) ? parsed - 10 * 60 * 1000 : Date.now() - 10 * 60 * 1000;
    return new Date(startMs).toISOString();
  }

  private extractBrokerRecordList(value: unknown): Record<string, unknown>[] {
    if (Array.isArray(value)) {
      return value.filter((item): item is Record<string, unknown> =>
        Boolean(this.readRecordValue(item))
      );
    }

    const record = this.readRecordValue(value);
    if (!record) {
      return [];
    }

    const directList = [
      record.items,
      record.orders,
      record.positions,
      record.results,
      record.data,
    ].find((candidate) => Array.isArray(candidate));
    if (Array.isArray(directList)) {
      return directList.filter((item): item is Record<string, unknown> =>
        Boolean(this.readRecordValue(item))
      );
    }

    const dataRecord = this.readRecordValue(record.data);
    if (!dataRecord) {
      return [];
    }

    const nestedList = [
      dataRecord.items,
      dataRecord.orders,
      dataRecord.positions,
      dataRecord.results,
    ].find((candidate) => Array.isArray(candidate));
    return Array.isArray(nestedList)
      ? nestedList.filter((item): item is Record<string, unknown> =>
          Boolean(this.readRecordValue(item))
        )
      : [];
  }

  private extractBrokerRecordCandidates(value: unknown): Record<string, unknown>[] {
    const list = this.extractBrokerRecordList(value);
    if (list.length) {
      return list;
    }

    const record = this.readRecordValue(value);
    if (!record) {
      return [];
    }

    const dataRecord = this.readRecordValue(record.data);
    if (dataRecord) {
      return [dataRecord];
    }
    return [record];
  }

  private findLiveAutoReconciledOrder(
    records: Record<string, unknown>[],
    prepared: PreparedLiveAutoRoute,
    createOrderBody: CreateOrderBody
  ): Record<string, unknown> | null {
    const idempotencyKey = this.readStringValue(createOrderBody.idempotency_key);
    if (!idempotencyKey) {
      return null;
    }
    const candidateKeys = new Set<string>([idempotencyKey]);
    const deltaClientOrderId = this.buildDeltaClientOrderId(idempotencyKey);
    if (deltaClientOrderId) {
      candidateKeys.add(deltaClientOrderId);
    }

    const expectedSymbols = this.buildLiveAutoReconciliationSymbols(prepared);
    return (
      records.find((record) => {
        const recordIdempotencyKey =
          this.readStringValue(record.idempotency_key) ??
          this.readStringValue(record.idempotencyKey) ??
          this.readStringValue(record.client_order_id) ??
          this.readStringValue(record.clientOrderId) ??
          this.readStringValue(record.clientOrderID) ??
          this.readStringValue(record.client_oid);
        if (recordIdempotencyKey && candidateKeys.has(recordIdempotencyKey)) {
          return true;
        }

        const symbol = this.extractBrokerRecordSymbol(record);
        if (!symbol || !expectedSymbols.has(symbol)) {
          return false;
        }
        const note =
          this.readStringValue(record.note) ??
          this.readStringValue(record.description) ??
          this.readStringValue(record.source);
        return Boolean(note && Array.from(candidateKeys).some((key) => note.includes(key)));
      }) ?? null
    );
  }

  private findLiveAutoReconciledPosition(
    records: Record<string, unknown>[],
    prepared: PreparedLiveAutoRoute,
    submittedAt: string
  ): Record<string, unknown> | null {
    const expectedSymbols = this.buildLiveAutoReconciliationSymbols(prepared);
    const expectedDirection = prepared.side;
    const submittedMs = Date.parse(submittedAt);
    const earliestMs = Number.isFinite(submittedMs) ? submittedMs - 10 * 60 * 1000 : null;

    return (
      records.find((record) => {
        const symbol = this.extractBrokerRecordSymbol(record);
        if (!symbol || !expectedSymbols.has(symbol)) {
          return false;
        }
        const status = this.normalizePositionStatus(this.extractBrokerRecordStatus(record));
        if (status === 'CLOSED' || status === 'LIQUIDATED') {
          return false;
        }
        const direction = this.extractBrokerRecordDirection(record);
        if (!direction || direction !== expectedDirection) {
          return false;
        }

        const observedMs = this.extractBrokerRecordTimestamp(record);
        if (earliestMs !== null && observedMs !== null && observedMs >= earliestMs) {
          return true;
        }

        const quantity = this.extractBrokerRecordQuantity(record);
        return (
          quantity !== null && this.isLiveAutoQuantityClose(quantity, prepared.normalizedQuantity)
        );
      }) ?? null
    );
  }

  private buildLiveAutoReconciliationSymbols(prepared: PreparedLiveAutoRoute): Set<string> {
    return new Set(
      [
        prepared.resolvedAssetRoute.requestedSymbol,
        prepared.resolvedAssetRoute.brokerSymbol,
        ...prepared.resolvedAssetRoute.candidateSymbols,
        ...this.buildEquivalentLiveAutoSymbols(
          prepared.resolvedAssetRoute.brokerSymbol,
          prepared.brokerKey
        ),
      ]
        .map((value) =>
          String(value || '')
            .trim()
            .toUpperCase()
        )
        .filter(Boolean)
    );
  }

  private buildDeltaClientOrderId(idempotencyKey: string | null | undefined): string | null {
    const normalized = String(idempotencyKey || '').trim();
    if (!normalized) {
      return null;
    }
    const prefix = 'aur_';
    const digestLength = 32 - prefix.length;
    return `${prefix}${createHash('sha256').update(normalized).digest('hex').slice(0, digestLength)}`;
  }

  private extractBrokerRecordId(record: Record<string, unknown> | null | undefined): string | null {
    return (
      this.readStringValue(record?.order_id) ??
      this.readStringValue(record?.orderId) ??
      this.readStringValue(record?.position_id) ??
      this.readStringValue(record?.positionId) ??
      this.readStringValue(record?.external_id) ??
      this.readStringValue(record?.externalId) ??
      this.readStringValue(record?.id) ??
      null
    );
  }

  private extractBrokerRecordSymbol(
    record: Record<string, unknown> | null | undefined
  ): string | null {
    const symbol =
      this.readStringValue(record?.symbol) ??
      this.readStringValue(record?.asset_symbol) ??
      this.readStringValue(record?.assetSymbol) ??
      this.readStringValue(record?.product_symbol) ??
      this.readStringValue(record?.productSymbol) ??
      this.readStringValue(record?.instrument_name) ??
      this.readStringValue(record?.instrumentName);
    return symbol ? symbol.trim().toUpperCase() : null;
  }

  private extractBrokerRecordStatus(
    record: Record<string, unknown> | null | undefined
  ): string | null {
    return (
      this.readStringValue(record?.status) ??
      this.readStringValue(record?.state) ??
      this.readStringValue(record?.order_status) ??
      this.readStringValue(record?.orderStatus) ??
      this.readStringValue(record?.position_status) ??
      this.readStringValue(record?.positionStatus) ??
      null
    );
  }

  private extractBrokerRecordDirection(
    record: Record<string, unknown> | null | undefined
  ): 'long' | 'short' | null {
    const raw =
      this.readStringValue(record?.side) ??
      this.readStringValue(record?.position_type) ??
      this.readStringValue(record?.positionType) ??
      this.readStringValue(record?.position_side) ??
      this.readStringValue(record?.positionSide) ??
      this.readStringValue(record?.direction);
    const normalized = String(raw || '')
      .trim()
      .toLowerCase();
    if (['long', 'buy', 'bought'].includes(normalized)) {
      return 'long';
    }
    if (['short', 'sell', 'sold'].includes(normalized)) {
      return 'short';
    }

    const signedSize =
      this.readNumberValue(record?.signed_size) ??
      this.readNumberValue(record?.signedSize) ??
      this.readNumberValue(record?.size);
    if (signedSize !== null && signedSize !== 0) {
      return signedSize > 0 ? 'long' : 'short';
    }
    return null;
  }

  private extractBrokerRecordQuantity(
    record: Record<string, unknown> | null | undefined
  ): number | null {
    const raw =
      this.readNumberValue(record?.quantity) ??
      this.readNumberValue(record?.filled_quantity) ??
      this.readNumberValue(record?.filledQuantity) ??
      this.readNumberValue(record?.position_size) ??
      this.readNumberValue(record?.positionSize) ??
      this.readNumberValue(record?.contracts) ??
      this.readNumberValue(record?.amount) ??
      this.readNumberValue(record?.size);
    return raw === null ? null : Math.abs(raw);
  }

  private extractBrokerRecordTimestamp(
    record: Record<string, unknown> | null | undefined
  ): number | null {
    const iso = this.extractBrokerRecordIsoTimestamp(record);
    if (!iso) {
      return null;
    }
    const parsed = Date.parse(iso);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private extractBrokerRecordIsoTimestamp(
    record: Record<string, unknown> | null | undefined
  ): string | null {
    return (
      this.toIsoString(record?.created_at) ??
      this.toIsoString(record?.createdAt) ??
      this.toIsoString(record?.opened_at) ??
      this.toIsoString(record?.openedAt) ??
      this.toIsoString(record?.open_time) ??
      this.toIsoString(record?.openTime) ??
      this.toIsoString(record?.updated_at) ??
      this.toIsoString(record?.updatedAt) ??
      null
    );
  }

  private isLiveAutoQuantityClose(observed: number, expected: number): boolean {
    if (!(observed > 0 && expected > 0)) {
      return false;
    }
    const tolerance = Math.max(expected * 0.05, 1e-8);
    return Math.abs(observed - expected) <= tolerance;
  }

  private classifyLiveAutoRouteFailure(
    error: unknown,
    submissionStarted: boolean
  ): SuggestedTradeRouteAttemptFailureClassification {
    if (!submissionStarted) {
      return 'confirmed_no_order';
    }

    const code = this.resolveLiveAutoFailureCode(error);
    const normalizedCode = String(code || '')
      .trim()
      .toUpperCase();
    const message =
      error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    if (message.includes('did not return a broker order id')) {
      return 'ambiguous';
    }
    if (
      [
        'ORDER_BROKER_AUTHORIZATION_FAILED',
        'ORDER_REJECTED_BROKER_MAPPING',
        'ORDER_REJECTED_INSUFFICIENT_MARGIN',
        'ORDER_REJECTED_INVALID_PRICE',
        'ORDER_REJECTED_INVALID_QUANTITY',
        'ORDER_REJECTED_INVALID_LEVERAGE',
        'ORDER_REJECTED_BROKER_RULE',
      ].includes(normalizedCode)
    ) {
      return 'confirmed_no_order';
    }
    return 'ambiguous';
  }

  private resolveLiveAutoFailureCode(error: unknown): string | null {
    if (!error || typeof error !== 'object') {
      return null;
    }
    const record = error as { code?: unknown; name?: unknown };
    return this.readStringValue(record.code) ?? this.readStringValue(record.name);
  }

  private buildAllLiveAutoRoutesFailedMessage(
    trade: SuggestedTrade,
    routeAttempts: SuggestedTradeRouteAttempt[],
    fallbackMessage: string
  ): string {
    if (!routeAttempts.length) {
      return fallbackMessage;
    }
    const reasons = routeAttempts
      .map((attempt) => {
        const route = `${attempt.brokerKey}${attempt.accountId ? `/${attempt.accountId}` : ''}`;
        return `${route}: ${attempt.failureMessage ?? attempt.status}`;
      })
      .join('; ');
    return `All live auto broker routes failed for ${trade.symbol}. ${reasons}`;
  }

  private async logLiveAutoAllRoutesFailed(
    userId: string,
    trade: SuggestedTrade,
    message: string
  ): Promise<void> {
    await this.operationalEventService.logActivity(userId, {
      type: 'Suggested Trade',
      title: `Live auto execution failed: ${trade.symbol}`,
      status: 'Failed',
      route: 'Suggested Trades',
      stream: 'Execution',
      related: `${trade.symbol} · ${trade.timeframe}`,
      referenceId: trade.id,
      symbol: trade.symbol,
      description: message,
    });
    await this.operationalEventService.emitFailureAlert(userId, {
      channel: 'Suggested Trades',
      source: 'suggested-trades',
      message: `Live auto execution failed for ${trade.symbol}: ${message}`,
      route: 'Suggested Trades',
    });
  }

  private evaluateLiveAutoRolloutGuard(
    userId: string,
    executionPolicy: ResolvedTradeSuggestionExecutionPolicy
  ): LiveAutoRolloutGuardDecision {
    const liveAutoConfig = this.resolveLiveAutoRuntimeConfig();
    const normalizedUserId = String(userId || '').trim();
    const brokerKey = executionPolicy.brokerKey ?? null;
    const accountId = executionPolicy.accountId ?? null;

    if (!liveAutoConfig.rolloutEnabled || !liveAutoConfig.enabled) {
      return {
        allowed: false,
        outcome: 'disabled',
        message: 'Live auto execution is disabled in this environment',
        brokerKey,
        accountId,
      };
    }

    if (!executionPolicy.liveConsentEnabled) {
      return {
        allowed: false,
        outcome: 'blocked',
        message: 'Live auto rollout requires explicit live-trading consent on the automation',
        brokerKey,
        accountId,
      };
    }

    const userAllowlist = Array.isArray(liveAutoConfig.userAllowlist)
      ? liveAutoConfig.userAllowlist.map((item) => String(item).trim()).filter(Boolean)
      : [];
    if (!userAllowlist.length) {
      return {
        allowed: false,
        outcome: 'blocked',
        message: 'Live auto rollout is enabled but no users are allowlisted yet',
        brokerKey,
        accountId,
      };
    }
    if (!userAllowlist.includes(normalizedUserId)) {
      return {
        allowed: false,
        outcome: 'blocked',
        message: 'User is not allowlisted for live auto rollout',
        brokerKey,
        accountId,
      };
    }

    const brokerAllowlist = Array.isArray(liveAutoConfig.brokerAllowlist)
      ? liveAutoConfig.brokerAllowlist
          .map((item) => String(item).trim().toLowerCase())
          .filter(Boolean)
      : [];
    if (!brokerAllowlist.length) {
      return {
        allowed: false,
        outcome: 'blocked',
        message: 'Live auto rollout is enabled but no brokers are allowlisted yet',
        brokerKey,
        accountId,
      };
    }
    if (brokerKey && !brokerAllowlist.includes(brokerKey)) {
      return {
        allowed: false,
        outcome: 'blocked',
        message: `Broker ${brokerKey} is not allowlisted for live auto rollout`,
        brokerKey,
        accountId,
      };
    }

    if (brokerKey && !this.isLiveAutoBrokerEnabled(liveAutoConfig, brokerKey)) {
      return {
        allowed: false,
        outcome: 'blocked',
        message: `Broker ${brokerKey} live auto is disabled by broker-specific control`,
        brokerKey,
        accountId,
      };
    }

    return {
      allowed: true,
      outcome: 'blocked',
      message: 'Live auto rollout guard passed',
      brokerKey,
      accountId,
    };
  }

  private resolveLiveAutoRuntimeConfig(): LiveAutoRuntimeConfig {
    return resolveSuggestedTradeLiveAutoRuntimeConfig({
      readBooleanEnvOverride: (name) => this.readBooleanEnvOverride(name),
      readStringEnvOverride: (name) => this.readStringEnvOverride(name),
      readArrayEnvOverride: (name) => this.readArrayEnvOverride(name),
    });
  }

  private isLiveAutoBrokerEnabled(
    liveAutoConfig: LiveAutoRuntimeConfig,
    brokerKey: string | null | undefined
  ): boolean {
    return isSuggestedTradeLiveAutoBrokerEnabled(liveAutoConfig, brokerKey);
  }

  private isProtectionRepairEnabledForBroker(brokerKey: string | null | undefined): boolean {
    return isSuggestedTradeProtectionRepairEnabledForBroker(brokerKey, (name) =>
      this.readBooleanEnvOverride(name)
    );
  }

  private async resolveEquivalentLiveAutoAssetRouteIfNeeded(
    brokerKey: string,
    symbol: string,
    executionMode: 'paper' | 'live',
    sourceType: string
  ): Promise<ResolvedLiveAutoAssetRoute | null> {
    if (!(executionMode === 'live' && sourceType === 'suggested_trade_automation_live_rollout')) {
      return null;
    }

    return this.resolveLiveAutoAssetRoute(brokerKey, symbol);
  }

  private buildEquivalentLiveAutoSymbols(symbol: string, brokerKey?: string): string[] {
    const normalizedSymbol = String(symbol || '')
      .trim()
      .toUpperCase();
    if (!normalizedSymbol) {
      return [];
    }

    const normalizedBrokerKey = String(brokerKey || '')
      .trim()
      .toLowerCase();
    const candidates = new Set<string>([normalizedSymbol]);
    if (normalizedSymbol.endsWith('USDC')) {
      const base = normalizedSymbol.slice(0, -4);
      if (normalizedBrokerKey === 'delta_exchange') {
        candidates.add(`${base}USD`);
      }
      candidates.add(`${base}USDT`);
    } else if (normalizedSymbol.endsWith('USDT')) {
      const base = normalizedSymbol.slice(0, -4);
      if (normalizedBrokerKey === 'delta_exchange') {
        candidates.add(`${base}USD`);
      }
      candidates.add(`${base}USDC`);
    } else if (normalizedSymbol.endsWith('USD')) {
      const base = normalizedSymbol.slice(0, -3);
      candidates.add(`${base}USDT`);
      candidates.add(`${base}USDC`);
    }

    return Array.from(candidates);
  }

  private async resolveLiveAutoAssetRoute(
    brokerKey: string,
    symbol: string
  ): Promise<ResolvedLiveAutoAssetRoute> {
    const normalizedBrokerKey = String(brokerKey || '')
      .trim()
      .toLowerCase();
    const normalizedSymbol = String(symbol || '')
      .trim()
      .toUpperCase();

    const supportedLiveAutoBrokers = new Set(['mudrex', 'delta_exchange']);
    if (!supportedLiveAutoBrokers.has(normalizedBrokerKey)) {
      throw new BadRequestAppError(
        `Live auto execution currently supports only mudrex and delta_exchange routes; received ${normalizedBrokerKey || 'unknown'}`
      );
    }
    if (!normalizedSymbol) {
      throw new BadRequestAppError('Live auto execution requires a trade symbol');
    }

    const candidateSymbols = this.buildEquivalentLiveAutoSymbols(
      normalizedSymbol,
      normalizedBrokerKey
    );
    const catalogAssets = await this.exchangeAssetRepository.listSystemAssetsBySourceAndSymbols(
      normalizedBrokerKey,
      candidateSymbols
    );
    const catalogAssetBySymbol = new Map(
      catalogAssets.map((item) => [
        String(item.symbol || '')
          .trim()
          .toUpperCase(),
        item,
      ])
    );

    for (const candidateSymbol of candidateSymbols) {
      const catalogAsset = catalogAssetBySymbol.get(candidateSymbol);
      const externalId = this.readStringValue(catalogAsset?.externalId);
      if (externalId) {
        return {
          assetId: externalId,
          requestedSymbol: normalizedSymbol,
          brokerSymbol: candidateSymbol,
          candidateSymbols,
          resolvedVia:
            candidateSymbol === normalizedSymbol ? 'catalog_exact' : 'catalog_equivalent',
        };
      }
    }

    if (normalizedBrokerKey === 'delta_exchange') {
      throw new BadRequestAppError(
        this.buildDeltaUnsupportedProductRouteMessage(normalizedSymbol, candidateSymbols)
      );
    }

    for (const candidateSymbol of candidateSymbols) {
      try {
        const remoteAsset = (
          await this.brokerReferenceDataService.getFuturesAssetDetailBySymbol(
            normalizedBrokerKey,
            candidateSymbol
          )
        ).data;
        const remoteId =
          this.readStringValue((remoteAsset as { id?: unknown })?.id) ??
          this.readStringValue((remoteAsset as { asset_uuid?: unknown })?.asset_uuid);

        if (remoteId) {
          return {
            assetId: remoteId,
            requestedSymbol: normalizedSymbol,
            brokerSymbol: candidateSymbol,
            candidateSymbols,
            resolvedVia:
              candidateSymbol === normalizedSymbol ? 'remote_exact' : 'remote_equivalent',
          };
        }
      } catch (error) {
        if (candidateSymbol === candidateSymbols[candidateSymbols.length - 1]) {
          throw error;
        }
      }
    }

    throw new BadRequestAppError(
      `Could not resolve a broker asset id for ${normalizedSymbol} on ${normalizedBrokerKey}; tried ${candidateSymbols.join(', ')}`
    );
  }

  private buildDeltaUnsupportedProductRouteMessage(
    normalizedSymbol: string,
    candidateSymbols: string[]
  ): string {
    return `Delta product unsupported for ${normalizedSymbol}: no live operational Delta perpetual product mapping was found for ${candidateSymbols.join(', ')}. Keep this symbol on a non-Delta route unless Delta India lists it; refresh delta_exchange broker_assets after Delta lists the product.`;
  }

  private buildAutoLiveIdempotencyKey(
    suggestedTradeId: string,
    preTradeCheckId: string | null | undefined,
    brokerKey?: string | null,
    accountId?: string | null
  ): string {
    const tradeId = String(suggestedTradeId || '').trim();
    const checkId = String(preTradeCheckId || '').trim() || 'pretrade';
    const routeKey = [brokerKey, accountId]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .join(':');
    return (
      routeKey ? `live-auto:${tradeId}:${routeKey}:${checkId}` : `live-auto:${tradeId}:${checkId}`
    ).slice(0, 191);
  }

  private async attachMudrexLiveAutoProtectionIfNeeded(input: {
    userId: string;
    brokerKey: string;
    accountId: string;
    brokerSymbol: string;
    side: 'buy' | 'sell' | 'long' | 'short';
    orderId: string;
    requestedEntryPrice: number;
    requestedStopLossPrice: number | null;
    requestedTakeProfitPrice: number | null;
  }): Promise<MudrexLiveAutoProtectionAttachmentResult> {
    return attachMudrexLiveAutoProtectionIfNeededForBroker({
      ...input,
      positionsAdapter: this.brokerRuntimeRegistry?.getPositionsAdapter?.('mudrex'),
      waitForPoll: (ms) => this.waitForLiveAutoProtectionPoll(ms),
    });
  }

  private unwrapOrderPlacementResponse(value: unknown): Record<string, unknown> {
    const record = this.readRecordValue(value);
    if (
      record?.success === true &&
      Object.prototype.hasOwnProperty.call(record, 'data') &&
      this.readRecordValue(record.data)
    ) {
      return { ...(record.data as Record<string, unknown>) };
    }

    return record ? { ...record } : {};
  }

  private async normalizeLiveAutoOrderSizing(
    brokerKey: string,
    assetId: string,
    brokerSymbol: string,
    quantity: number,
    entryPrice: number,
    stopLossPrice: number,
    takeProfitPrice: number,
    side: 'long' | 'short',
    orderType: string,
    leverage?: number | null
  ): Promise<NormalizedLiveAutoOrderSizing> {
    const normalizedBrokerKey = String(brokerKey || '')
      .trim()
      .toLowerCase();
    if (normalizedBrokerKey === 'delta_exchange') {
      const adapter = this.brokerRuntimeRegistry?.getOrdersAdapter?.('delta_exchange') as
        | DeltaLiveAutoProductRulePreflightAdapter
        | null
        | undefined;

      return normalizeDeltaLiveAutoOrderSizingForBroker({
        adapter,
        assetId,
        brokerSymbol,
        quantity,
        entryPrice,
        stopLossPrice,
        takeProfitPrice,
        side,
      });
    }

    if (normalizedBrokerKey !== 'mudrex') {
      return {
        quantity,
        entryPrice,
        stopLossPrice,
        takeProfitPrice,
        auditNote: null,
      };
    }

    const assetDetail = (
      await this.brokerReferenceDataService.getFuturesAssetDetailBySymbol('mudrex', brokerSymbol)
    ).data as unknown as Record<string, unknown> | null;

    return normalizeMudrexLiveAutoOrderSizingForBroker({
      brokerSymbol,
      quantity,
      entryPrice,
      stopLossPrice,
      takeProfitPrice,
      side,
      orderType,
      leverage,
      assetDetail,
    });
  }

  private deriveScaledProtectionPrice(
    actualEntryPrice: number,
    requestedEntryPrice: number,
    requestedTargetPrice: number
  ): string {
    const precision = Math.max(
      6,
      this.countNumericDecimals(requestedEntryPrice),
      this.countNumericDecimals(requestedTargetPrice)
    );
    return Number(
      ((actualEntryPrice * requestedTargetPrice) / requestedEntryPrice).toFixed(precision)
    ).toFixed(precision);
  }

  private waitForLiveAutoProtectionPoll(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private countNumericDecimals(value: unknown): number {
    const raw = String(value ?? '').trim();
    if (!raw || !raw.includes('.')) {
      return 0;
    }

    const fractional = raw.split('.')[1]?.replace(/0+$/, '') ?? '';
    return fractional.length;
  }

  private resolveAutoPaperQuantity(input: {
    requestedQuantity: number | null;
    requestedNotional: number | null;
    entryPrice: number | null;
  }): number | null {
    if (input.requestedQuantity && input.requestedQuantity > 0) {
      return Number(input.requestedQuantity.toFixed(8));
    }

    if (
      input.requestedNotional &&
      input.requestedNotional > 0 &&
      input.entryPrice &&
      input.entryPrice > 0
    ) {
      return Number((input.requestedNotional / input.entryPrice).toFixed(8));
    }

    return null;
  }

  private async applyBrokerPolicyTradeSize(
    userId: string,
    request: SuggestedTradePreTradeRequest,
    sourceType: string
  ): Promise<SuggestedTradePreTradeRequest> {
    if (!String(sourceType || '').startsWith('suggested_trade_automation_')) {
      return request;
    }

    const brokerKey = this.readStringValue(request.routing.brokerKey)?.toLowerCase();
    const accountId = this.readStringValue(request.routing.accountId);
    if (!brokerKey || !accountId) {
      return request;
    }

    const activePolicy = await this.riskPolicyRepository.getEffectivePolicy(userId, brokerKey);
    let nextOrder = request.order;
    const policyMinLeverage =
      sourceType === 'suggested_trade_automation_live_rollout'
        ? this.resolveLiveAutoPolicyMinLeverage(activePolicy)
        : null;
    if (policyMinLeverage !== null) {
      nextOrder = {
        ...nextOrder,
        leverage: policyMinLeverage,
      };
    }

    const tradeSizePctOfBalance = this.readNumberValue(activePolicy?.tradeSizePctOfBalance);
    if (!(tradeSizePctOfBalance && tradeSizePctOfBalance > 0)) {
      return nextOrder === request.order
        ? request
        : {
            ...request,
            order: nextOrder,
          };
    }

    const fundsSnapshot = await this.fundsSnapshotRepository.getLatestSnapshot(
      userId,
      brokerKey,
      accountId
    );
    const trackedBalance = this.extractTrackedBalanceFromFundsSnapshot(fundsSnapshot);
    if (!(trackedBalance && trackedBalance > 0)) {
      return nextOrder === request.order
        ? request
        : {
            ...request,
            order: nextOrder,
          };
    }

    const leverage = this.readNumberValue(nextOrder.leverage);
    const margin = (trackedBalance * tradeSizePctOfBalance) / 100;
    const notional = Number((margin * (leverage && leverage > 0 ? leverage : 1)).toFixed(2));
    if (!(notional > 0)) {
      return nextOrder === request.order
        ? request
        : {
            ...request,
            order: nextOrder,
          };
    }

    return {
      ...request,
      order: {
        ...nextOrder,
        quantityMode: 'notional',
        quantity: null,
        notional,
        riskPercent: null,
      },
    };
  }

  private resolveLiveAutoPolicyMinLeverage(
    policy:
      | {
          minLeverage?: unknown;
          maxLeverage?: unknown;
        }
      | null
      | undefined
  ): number | null {
    const minLeverage = this.readNumberValue(policy?.minLeverage);
    if (!(minLeverage && minLeverage > 0)) {
      return null;
    }

    const maxLeverage = this.readNumberValue(policy?.maxLeverage);
    if (maxLeverage !== null && minLeverage > maxLeverage) {
      return null;
    }

    return minLeverage;
  }

  private async loadTradeSuggestionExecutionPolicy(
    userId: string,
    automationId: string | null | undefined
  ): Promise<ResolvedTradeSuggestionExecutionPolicy> {
    const normalizedAutomationId = this.readStringValue(automationId);
    const automation = normalizedAutomationId
      ? await this.automationRepository.getAutomationCoreById(userId, normalizedAutomationId)
      : null;
    const automationConfig = this.readRecordValue(automation?.config) ?? {};
    const tradeSuggestion = this.readRecordValue(automationConfig.tradeSuggestion) ?? {};
    const normalizedPolicy = normalizeTradeSuggestionExecutionPolicy(
      tradeSuggestion.execution ?? automationConfig.config ?? null
    );
    const routing = this.readRecordValue(normalizedPolicy.routing) ?? {};
    const orderTemplate = this.readRecordValue(normalizedPolicy.orderTemplate) ?? {};
    const limits = this.readRecordValue(normalizedPolicy.limits) ?? {};
    const liveConsent = this.readRecordValue(normalizedPolicy.liveConsent) ?? {};
    const freshness = this.readRecordValue(normalizedPolicy.freshness) ?? {};
    const limitOrderExpiry = this.readRecordValue(normalizedPolicy.limitOrderExpiry) ?? {};
    const executionModeRaw = this.readStringValue(normalizedPolicy.executionMode)?.toLowerCase();
    const approvalModeRaw = this.readStringValue(normalizedPolicy.approvalMode)?.toLowerCase();
    const routeModeRaw = this.readStringValue(routing.routeMode)?.toLowerCase();
    const orderTypeRaw = this.readStringValue(orderTemplate.orderType)?.toLowerCase();
    const quantityModeRaw = this.readStringValue(orderTemplate.quantityMode)?.toLowerCase();
    const brokerKey = this.readStringValue(routing.brokerKey)?.toLowerCase() ?? null;

    return {
      executionMode:
        executionModeRaw === 'live_trade_auto'
          ? 'live_trade_auto'
          : executionModeRaw === 'paper_trade_auto'
            ? 'paper_trade_auto'
            : 'suggestion_only',
      approvalMode: approvalModeRaw === 'auto_if_safe' ? 'auto_if_safe' : 'manual_review',
      routeMode:
        routeModeRaw === 'fixed' && brokerKey
          ? 'fixed'
          : routeModeRaw === 'user_default'
            ? 'user_default'
            : 'strategy_default',
      brokerKey,
      accountId: this.readStringValue(routing.accountId),
      liveConsentEnabled: this.readBooleanValue(liveConsent.enabled) ?? false,
      orderType: orderTypeRaw === 'limit' ? 'limit' : 'market',
      timeInForce: (() => {
        const value = this.readStringValue(orderTemplate.timeInForce)?.toUpperCase();
        return value === 'GTC' || value === 'IOC' || value === 'FOK' ? value : null;
      })(),
      quantityMode:
        quantityModeRaw === 'quantity'
          ? 'quantity'
          : quantityModeRaw === 'notional'
            ? 'notional'
            : 'risk_percent',
      quantity: this.readNumberValue(orderTemplate.quantity),
      notional: this.readNumberValue(orderTemplate.notional),
      riskPercent: this.readNumberValue(orderTemplate.riskPercent),
      leverage: this.readNumberValue(orderTemplate.leverage),
      reduceOnly: this.readBooleanValue(orderTemplate.reduceOnly) ?? false,
      deltaProtectionMode: this.readStringValue(orderTemplate.deltaProtectionMode),
      maxOrdersPerRun: Math.max(
        TRADE_SUGGESTION_EXECUTION_LIMIT_RULES.maxOrdersPerRun.min,
        Math.floor(
          this.readNumberValue(limits.maxOrdersPerRun) ??
            TRADE_SUGGESTION_EXECUTION_LIMIT_RULES.maxOrdersPerRun.fallback
        )
      ),
      maxOrdersPerDay: Math.max(
        TRADE_SUGGESTION_EXECUTION_LIMIT_RULES.maxOrdersPerDay.min,
        Math.floor(
          this.readNumberValue(limits.maxOrdersPerDay) ??
            TRADE_SUGGESTION_EXECUTION_LIMIT_RULES.maxOrdersPerDay.fallback
        )
      ),
      maxConcurrentOpenTrades: Math.max(
        TRADE_SUGGESTION_EXECUTION_LIMIT_RULES.maxConcurrentOpenTrades.min,
        Math.floor(
          this.readNumberValue(limits.maxConcurrentOpenTrades) ??
            TRADE_SUGGESTION_EXECUTION_LIMIT_RULES.maxConcurrentOpenTrades.fallback
        )
      ),
      maxNotionalPerTrade: this.readNumberValue(limits.maxNotionalPerTrade),
      maxNotionalPerDay: this.readNumberValue(limits.maxNotionalPerDay),
      dedupeWindowSeconds: Math.max(
        TRADE_SUGGESTION_EXECUTION_LIMIT_RULES.dedupeWindowSeconds.min,
        Math.floor(
          this.readNumberValue(limits.dedupeWindowSeconds) ??
            TRADE_SUGGESTION_EXECUTION_LIMIT_RULES.dedupeWindowSeconds.fallback
        )
      ),
      freshness: normalizeTradeSuggestionFreshnessPolicy(freshness),
      limitOrderExpiry: normalizeTradeSuggestionLimitOrderExpiryPolicy(limitOrderExpiry),
    };
  }

  private evaluateSuggestedTradeFreshness(
    trade: SuggestedTrade,
    executionPolicy: ResolvedTradeSuggestionExecutionPolicy,
    options: {
      evaluatedAt?: Date;
      minimumMaxAgeAfterCloseSeconds?: number | null;
    } = {}
  ): SignalFreshnessEvaluation {
    return evaluateSignalFreshness({
      signalTime: trade.signalTime,
      timeframe: trade.timeframe,
      policy: executionPolicy.freshness,
      evaluatedAt: options.evaluatedAt,
      minimumMaxAgeAfterCloseSeconds: options.minimumMaxAgeAfterCloseSeconds ?? null,
    });
  }

  private buildLiveAutoFreshnessSnapshot(
    freshness: SignalFreshnessEvaluation,
    currentRunFreshnessFloorSeconds: number | null
  ): SuggestedTradeAutoLiveFreshnessSnapshot {
    return {
      allowed: freshness.allowed,
      enabled: freshness.enabled,
      reason: freshness.reason,
      timeframe: freshness.timeframe,
      timeframeSeconds: freshness.timeframeSeconds,
      signalTime: freshness.signalTime,
      candleCloseAt: freshness.candleCloseAt,
      evaluatedAt: freshness.evaluatedAt,
      ageAfterCloseSeconds: freshness.ageAfterCloseSeconds,
      maxAgeAfterCloseSeconds: freshness.maxAgeAfterCloseSeconds,
      currentRunFreshnessFloorSeconds: this.normalizeLiveAutoFreshnessFloorSeconds(
        currentRunFreshnessFloorSeconds
      ),
    };
  }

  private normalizeLiveAutoFreshnessFloorSeconds(value: number | null): number | null {
    if (value === null || !Number.isFinite(value)) {
      return null;
    }
    return Math.max(0, Math.trunc(value));
  }

  private buildLiveExecutionFreshnessBlockedMessage(freshness: SignalFreshnessEvaluation): string {
    if (!freshness.enabled) {
      return 'Signal freshness guard is disabled for this automation.';
    }
    if (freshness.ageAfterCloseSeconds !== null && freshness.maxAgeAfterCloseSeconds !== null) {
      return `Skipped live execution: ${freshness.timeframe} signal closed ${this.formatDurationFromSeconds(freshness.ageAfterCloseSeconds)} ago, exceeding the effective ${this.formatDurationFromSeconds(freshness.maxAgeAfterCloseSeconds)} freshness window.`;
    }
    return `Skipped live execution: ${freshness.reason}`;
  }

  private formatDurationFromSeconds(seconds: number): string {
    const normalized = Math.max(0, Math.floor(seconds));
    if (normalized < 60) {
      return `${normalized}s`;
    }
    const minutes = normalized / 60;
    if (minutes < 60) {
      return `${minutes.toFixed(minutes >= 10 ? 0 : 1)}m`;
    }
    const hours = minutes / 60;
    if (hours < 48) {
      return `${hours.toFixed(hours >= 10 ? 0 : 1)}h`;
    }
    const days = hours / 24;
    return `${days.toFixed(days >= 10 ? 0 : 1)}d`;
  }

  private buildPreTradeCheckRequest(
    trade: SuggestedTrade,
    executionPolicy: ResolvedTradeSuggestionExecutionPolicy,
    existingExecution: SuggestedTradeExecutionLink | null,
    linkPayload?: SuggestedTradeOrderLinkBody
  ): SuggestedTradePreTradeRequest {
    const takeProfitTargets = this.resolveTradeTakeProfitTargets(trade, linkPayload);
    const entryPrice =
      this.readNumberValue(linkPayload?.entryPrice) ??
      this.readNumberValue(existingExecution?.entryPrice) ??
      this.readNumberValue(trade.entryPrice);
    const stopLossPrice =
      this.readNumberValue(linkPayload?.stopLossPrice) ??
      this.readNumberValue(existingExecution?.stopLossPrice) ??
      this.readNumberValue(trade.stopLossPrice);
    const executionMode = this.resolvePreTradeExecutionMode(executionPolicy, linkPayload);
    const routingBrokerKey =
      this.readStringValue(linkPayload?.brokerKey)?.toLowerCase() ??
      existingExecution?.brokerKey ??
      executionPolicy.brokerKey ??
      null;
    const routingAccountId =
      this.readStringValue(linkPayload?.accountId) ??
      existingExecution?.accountId ??
      executionPolicy.accountId ??
      null;

    let quantityMode: 'quantity' | 'notional' | 'risk_percent';
    let quantity: number | null = null;
    let notional: number | null = null;
    let riskPercent: number | null = null;

    const overrideQuantity = this.readNumberValue(linkPayload?.quantity);
    if (overrideQuantity && overrideQuantity > 0 && entryPrice && entryPrice > 0) {
      quantityMode = 'quantity';
      quantity = overrideQuantity;
    } else if (
      executionPolicy.quantityMode === 'quantity' &&
      executionPolicy.quantity &&
      executionPolicy.quantity > 0 &&
      entryPrice &&
      entryPrice > 0
    ) {
      quantityMode = 'quantity';
      quantity = executionPolicy.quantity;
    } else if (
      executionPolicy.quantityMode === 'notional' &&
      executionPolicy.notional &&
      executionPolicy.notional > 0
    ) {
      quantityMode = 'notional';
      notional = executionPolicy.notional;
    } else {
      quantityMode = 'risk_percent';
      riskPercent =
        executionPolicy.riskPercent && executionPolicy.riskPercent > 0
          ? executionPolicy.riskPercent
          : 1;
    }

    const requestedOrderType =
      this.readStringValue(linkPayload?.orderType)?.toLowerCase() === 'limit' ||
      executionPolicy.orderType === 'limit'
        ? 'limit'
        : 'market';
    const orderType = this.resolveBrokerEntryOrderType(
      routingBrokerKey,
      executionMode,
      requestedOrderType,
      entryPrice
    );
    const timeInForce = this.resolveBrokerEntryTimeInForce(
      routingBrokerKey,
      executionMode,
      orderType,
      executionPolicy.timeInForce
    );

    return {
      suggestedTradeId: trade.id,
      automationId: trade.automationId,
      automationRunId: trade.automationRunId,
      sourceType: 'suggested_trade',
      executionMode,
      approvalMode: 'auto_if_safe',
      routing: {
        routeMode:
          linkPayload?.brokerKey || linkPayload?.accountId ? 'fixed' : executionPolicy.routeMode,
        brokerKey: routingBrokerKey,
        accountId: routingAccountId,
      },
      order: {
        symbol: trade.symbol,
        timeframe: trade.timeframe,
        side:
          String(trade.side || '')
            .trim()
            .toUpperCase() === 'SELL'
            ? 'SELL'
            : 'BUY',
        orderType,
        timeInForce,
        quantityMode,
        quantity,
        notional,
        riskPercent,
        entryPrice,
        stopLossPrice,
        takeProfitTargets,
        leverage: this.readNumberValue(linkPayload?.leverage) ?? executionPolicy.leverage ?? null,
        reduceOnly: executionPolicy.reduceOnly,
      },
    };
  }

  private resolveTradeTakeProfitTargets(
    trade: SuggestedTrade,
    linkPayload?: SuggestedTradeOrderLinkBody
  ): number[] | null {
    const directTakeProfit = this.readNumberValue(linkPayload?.takeProfitPrice);
    if (directTakeProfit && directTakeProfit > 0) {
      return [directTakeProfit];
    }

    if (!Array.isArray(trade.takeProfitTargets)) {
      return null;
    }

    const targets = trade.takeProfitTargets
      .map((value) => this.readNumberValue(value))
      .filter((value): value is number => Boolean(value && value > 0));
    return targets.length ? targets : null;
  }

  private resolvePreTradeExecutionMode(
    executionPolicy: ResolvedTradeSuggestionExecutionPolicy,
    linkPayload?: SuggestedTradeOrderLinkBody
  ): 'paper' | 'live' {
    const explicitMode = this.readStringValue(linkPayload?.executionMode)?.toLowerCase();
    if (explicitMode === 'paper') {
      return 'paper';
    }
    if (explicitMode === 'live') {
      return 'live';
    }
    if (this.readStringValue(linkPayload?.paperOrderId)) {
      return 'paper';
    }
    if (this.readStringValue(linkPayload?.orderId)) {
      return 'live';
    }
    return executionPolicy.executionMode === 'live_trade_auto' ? 'live' : 'paper';
  }

  private resolvePreTradeState(
    status: RiskPreTradeCheckResult['status']
  ): SuggestedTradePreTradeState {
    if (status === 'passed' || status === 'warning') {
      return 'passed';
    }
    if (status === 'blocked') {
      return 'blocked';
    }
    if (status === 'stale') {
      return 'stale';
    }
    return 'error';
  }

  private hasLinkedExecution(trade: SuggestedTrade): boolean {
    const execution = this.getExecutionLink(trade);
    return this.hasExecutionTracking(execution);
  }

  private hasExecutionTracking(execution: SuggestedTradeExecutionLink | null): boolean {
    return Boolean(
      this.readStringValue(execution?.orderId) ||
      this.readStringValue(execution?.paperOrderId) ||
      this.readStringValue(execution?.positionId) ||
      this.readStringValue(execution?.executionState)
    );
  }

  private mapSuggestedTrade(item: SuggestedTrade): SuggestedTradeItem {
    const execution = this.getExecutionLink(item);
    const syncStatus = this.buildSyncStatus(item, execution);

    return {
      id: item.id,
      automationId: item.automationId,
      automationRunId: item.automationRunId,
      sourceBacktestId: item.sourceBacktestId ?? null,
      sourceTemplateId: item.sourceTemplateId ?? null,
      sourceSetupKey: item.sourceSetupKey ?? null,
      symbol: item.symbol,
      timeframe: item.timeframe,
      side: item.side as SuggestedTradeItem['side'],
      signalTime: item.signalTime.toISOString(),
      status: item.status,
      confidence: item.confidence ?? null,
      score: item.score ?? null,
      entryPrice: item.entryPrice ?? null,
      stopLossPrice: item.stopLossPrice ?? null,
      takeProfitTargets: Array.isArray(item.takeProfitTargets)
        ? item.takeProfitTargets.map((value) => String(value))
        : null,
      entryRule: item.entryRule ?? null,
      exitRule: item.exitRule ?? null,
      rationale: item.rationale ?? null,
      dedupeKey: item.dedupeKey,
      meta: item.meta ?? null,
      routeDecision: this.buildRouteDecision(item),
      execution,
      allowedActions: this.buildAllowedActions(item, execution),
      statusReason: this.buildStatusReason(item, execution),
      statusDisplay: this.buildStatusDisplay(item, execution),
      freshness: this.buildFreshness(item, execution),
      linkedEntities: this.buildLinkedEntities(item, execution),
      reviewStage: this.buildReviewStage(item),
      executionStage: this.buildExecutionStage(execution),
      journeyStage: this.buildJourneyStage(item, execution),
      syncStatus,
      lifecycle: this.buildLifecycle(item, execution, syncStatus),
      timeline: this.buildTimeline(item, execution, syncStatus),
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    };
  }

  private buildRouteDecision(item: SuggestedTrade): SuggestedTradeItem['routeDecision'] {
    const meta = this.readRecordValue(item.meta);
    const routeDecision = this.readRecordValue(meta?.routeDecision);
    if (!routeDecision) {
      return null;
    }

    const rawCandidates = Array.isArray(routeDecision.candidates) ? routeDecision.candidates : [];

    return {
      mode:
        this.readStringValue(routeDecision.mode) === 'adaptive_candidate_shadow'
          ? 'adaptive_candidate_shadow'
          : 'adaptive_candidate_live',
      decision: this.readStringValue(routeDecision.decision) === 'blocked' ? 'blocked' : 'selected',
      requestedSymbol: this.readStringValue(routeDecision.requestedSymbol) ?? item.symbol,
      selectedBrokerKey: this.readStringValue(routeDecision.selectedBrokerKey),
      selectedAccountId: this.readStringValue(routeDecision.selectedAccountId),
      selectedAccountName: this.readStringValue(routeDecision.selectedAccountName),
      selectedBrokerSymbol: this.readStringValue(routeDecision.selectedBrokerSymbol),
      selectionReason: this.readStringValue(routeDecision.selectionReason) ?? 'adaptive_candidate',
      summary: this.readStringValue(routeDecision.summary) ?? 'Adaptive route decision recorded.',
      decidedAt: this.toIsoString(routeDecision.decidedAt),
      candidates: rawCandidates
        .map((candidate) => this.readRecordValue(candidate))
        .filter(Boolean)
        .map((candidate) => ({
          brokerKey: this.readStringValue(candidate?.brokerKey) ?? 'unknown',
          accountId: this.readStringValue(candidate?.accountId) ?? 'unknown',
          accountName: this.readStringValue(candidate?.accountName),
          requestedSymbol: this.readStringValue(candidate?.requestedSymbol) ?? item.symbol,
          brokerSymbol: this.readStringValue(candidate?.brokerSymbol) ?? item.symbol,
          candidateSymbols: Array.isArray(candidate?.candidateSymbols)
            ? candidate.candidateSymbols
                .map((entry) => this.readStringValue(entry))
                .filter((entry): entry is string => Boolean(entry))
            : [],
          resolvedVia:
            (this.readStringValue(
              candidate?.resolvedVia
            ) as SuggestedTradeRouteDecision['candidates'][number]['resolvedVia']) ?? null,
          supported: candidate?.supported === true,
          supportMessage: this.readStringValue(candidate?.supportMessage),
          allowed: candidate?.allowed === true,
          blocked: candidate?.blocked === true,
          summary: this.readStringValue(candidate?.summary) ?? 'No summary recorded.',
          warningRuleCount: Math.max(
            0,
            Math.floor(this.readNumberValue(candidate?.warningRuleCount) ?? 0)
          ),
          blockingRuleCount: Math.max(
            0,
            Math.floor(this.readNumberValue(candidate?.blockingRuleCount) ?? 0)
          ),
          freshnessState: this.readStringValue(candidate?.freshnessState),
        })),
    };
  }

  private buildAllowedActions(
    item: SuggestedTrade,
    execution: SuggestedTradeExecutionLink | null
  ): SuggestedTradePageAction[] {
    const actions: SuggestedTradePageAction[] = [];
    const status = String(item.status || '').trim();
    const hasExecutionTracking = this.hasExecutionTracking(execution);

    if (status === 'Open') {
      actions.push('review', 'accept', 'dismiss');
    } else if (status === 'Reviewed') {
      actions.push('accept', 'dismiss');
    } else if (status === 'Accepted') {
      if (hasExecutionTracking) {
        actions.push('reconcile_execution');
      } else {
        actions.push('link_order', 'dismiss');
      }
    }

    return actions;
  }

  private buildStatusReason(
    item: SuggestedTrade,
    execution: SuggestedTradeExecutionLink | null
  ): string {
    const status = String(item.status || '').trim();
    const executionState = String(execution?.executionState || '')
      .trim()
      .toLowerCase();
    const outcome = String(execution?.outcome || '')
      .trim()
      .toLowerCase();
    const preTradeState = String(execution?.preTradeState || '')
      .trim()
      .toLowerCase();

    if (status === 'Dismissed') {
      return 'Suggestion dismissed by operator';
    }
    if (status === 'Expired') {
      return 'Suggestion expired before execution';
    }
    if (preTradeState === 'blocked') {
      return (
        execution?.preTradeBlockedReason ??
        'Pre-trade check blocked this suggestion from being accepted or routed to execution'
      );
    }
    if (preTradeState === 'stale') {
      return (
        execution?.preTradeBlockedReason ??
        'Pre-trade check requires a fresher risk snapshot before this suggestion can continue'
      );
    }
    if (preTradeState === 'error') {
      return (
        execution?.preTradeBlockedReason ??
        'Pre-trade check failed and should be retried before execution handoff'
      );
    }
    if (status === 'Open') {
      return 'New suggestion awaiting first review';
    }
    if (status === 'Reviewed') {
      return 'Reviewed and awaiting accept or dismiss decision';
    }
    if (status === 'Accepted' && !this.hasExecutionTracking(execution)) {
      return preTradeState === 'passed'
        ? 'Accepted and cleared by pre-trade check. Ready to route to execution'
        : 'Accepted and ready to route to execution';
    }
    if (executionState === 'queued') {
      return 'Execution request is queued and waiting for submission to start';
    }
    if (executionState === 'submitting') {
      return 'Execution submission is in progress and waiting for an order link';
    }
    if (executionState === 'linked') {
      return execution?.executionMode === 'paper'
        ? 'Accepted and linked to a paper order'
        : 'Accepted and linked to a live order';
    }
    if (executionState === 'working') {
      return 'Execution is working in the market';
    }
    if (executionState === 'filled') {
      return 'Order filled and position is open';
    }
    if (executionState === 'cancelled') {
      return 'Execution was cancelled before opening a position';
    }
    if (executionState === 'rejected') {
      return 'Execution was rejected by the broker';
    }
    if (executionState === 'expired') {
      return 'Execution expired before filling';
    }
    if (executionState === 'failed') {
      return 'Execution failed and needs operator review';
    }
    if (executionState === 'unknown') {
      return 'Execution tracking is incomplete and should be reconciled';
    }
    if (executionState === 'closed') {
      if (outcome === 'profit') {
        return 'Execution closed in profit';
      }
      if (outcome === 'loss') {
        return 'Execution closed in loss';
      }
      if (outcome === 'breakeven') {
        return 'Execution closed at breakeven';
      }
      return 'Execution closed';
    }

    return `Suggestion is currently ${status.toLowerCase()}`;
  }

  private buildStatusDisplay(
    item: SuggestedTrade,
    execution: SuggestedTradeExecutionLink | null
  ): string {
    const status = String(item.status || '').trim();
    const executionState = this.buildExecutionStage(execution);
    const preTradeState = String(execution?.preTradeState || '')
      .trim()
      .toLowerCase();

    if (status === 'Dismissed') {
      return 'Dismissed';
    }
    if (status === 'Expired') {
      return 'Expired';
    }
    if (preTradeState === 'blocked') {
      return 'Risk Blocked';
    }
    if (preTradeState === 'stale') {
      return 'Snapshot Stale';
    }
    if (preTradeState === 'error') {
      return 'Check Error';
    }
    if (status === 'Open') {
      return 'Needs Review';
    }
    if (status === 'Reviewed') {
      return 'Reviewed';
    }
    if (executionState === 'queued') {
      return 'Queued';
    }
    if (executionState === 'submitting') {
      return 'Submitting';
    }
    if (executionState === 'linked') {
      return 'Order Linked';
    }
    if (executionState === 'working') {
      return 'Working';
    }
    if (executionState === 'filled') {
      return 'Position Open';
    }
    if (executionState === 'closed') {
      return 'Closed';
    }
    if (executionState === 'cancelled') {
      return 'Cancelled';
    }
    if (executionState === 'rejected') {
      return 'Rejected';
    }
    if (executionState === 'failed') {
      return 'Needs Attention';
    }
    if (executionState === 'unknown') {
      return 'Sync Needed';
    }
    if (executionState === 'expired') {
      return 'Execution Expired';
    }

    return preTradeState === 'passed' ? 'Ready to Route' : 'Accepted';
  }

  private buildReviewStage(item: SuggestedTrade): SuggestedTradeItem['reviewStage'] {
    const status = String(item.status || '').trim();
    if (status === 'Reviewed') {
      return 'reviewed';
    }
    if (status === 'Accepted') {
      return 'accepted';
    }
    if (status === 'Dismissed') {
      return 'dismissed';
    }
    if (status === 'Expired') {
      return 'expired';
    }
    return 'needs_review';
  }

  private buildExecutionStage(
    execution: SuggestedTradeExecutionLink | null
  ): SuggestedTradeItem['executionStage'] {
    const executionState = String(execution?.executionState || '')
      .trim()
      .toLowerCase();
    if (!executionState) {
      return 'unlinked';
    }
    if (
      executionState === 'queued' ||
      executionState === 'submitting' ||
      executionState === 'linked' ||
      executionState === 'working' ||
      executionState === 'filled' ||
      executionState === 'closed' ||
      executionState === 'cancelled' ||
      executionState === 'rejected' ||
      executionState === 'expired' ||
      executionState === 'failed' ||
      executionState === 'unknown'
    ) {
      return executionState as SuggestedTradeItem['executionStage'];
    }
    return 'unknown';
  }

  private buildJourneyStage(
    item: SuggestedTrade,
    execution: SuggestedTradeExecutionLink | null
  ): SuggestedTradeItem['journeyStage'] {
    const status = String(item.status || '').trim();
    const executionStage = this.buildExecutionStage(execution);

    if (status === 'Dismissed' || status === 'Expired' || executionStage === 'closed') {
      return 'closed_out';
    }
    if (executionStage === 'queued' || executionStage === 'submitting') {
      return 'track_execution';
    }
    if (executionStage === 'linked') {
      return 'track_execution';
    }
    if (executionStage !== 'unlinked') {
      return 'track_execution';
    }
    if (status === 'Accepted') {
      return 'link_order';
    }
    return 'accept_trade';
  }

  private buildSyncStatus(
    item: SuggestedTrade,
    execution: SuggestedTradeExecutionLink | null
  ): NonNullable<SuggestedTradeItem['syncStatus']> {
    const hasTracking = this.hasExecutionTracking(execution);
    const executionStage = this.buildExecutionStage(execution);
    const lastObservedAt = this.getExecutionObservedAt(item, execution);
    const lastSyncedAt =
      execution?.lastSyncAt ??
      execution?.lastSeenAt ??
      execution?.positionClosedAt ??
      execution?.filledAt ??
      item.updatedAt.toISOString();
    const staleAfterMs = hasTracking ? this.resolveExecutionSyncStaleAfterMs(execution) : null;
    const nextCheckAt =
      lastObservedAt && staleAfterMs
        ? new Date(this.toTimestamp(lastObservedAt) + staleAfterMs).toISOString()
        : null;

    if (!hasTracking) {
      return {
        state: 'untracked',
        label: 'Not Linked',
        summary:
          item.status === 'Accepted'
            ? 'Accepted trades begin execution tracking after they are linked to an order.'
            : 'Execution tracking starts once a suggested trade is accepted and linked.',
        isStale: false,
        backgroundEnabled: env.suggestedTradesSync.backgroundEnabled,
        manualReconcileAvailable: false,
        lastObservedAt: null,
        lastSyncedAt: null,
        nextCheckAt: null,
        staleAfterMs: null,
      };
    }

    if (
      executionStage === 'failed' ||
      executionStage === 'rejected' ||
      executionStage === 'unknown'
    ) {
      return {
        state: 'attention',
        label: 'Needs Attention',
        summary:
          executionStage === 'rejected'
            ? 'Execution was rejected and should be reviewed before retrying.'
            : executionStage === 'failed'
              ? 'Execution failed and needs operator review.'
              : 'Execution tracking has incomplete state and should be reconciled.',
        isStale: false,
        backgroundEnabled: env.suggestedTradesSync.backgroundEnabled,
        manualReconcileAvailable: true,
        lastObservedAt,
        lastSyncedAt,
        nextCheckAt,
        staleAfterMs,
      };
    }

    if (
      executionStage === 'closed' ||
      executionStage === 'cancelled' ||
      executionStage === 'expired'
    ) {
      return {
        state: 'settled',
        label: 'Settled',
        summary:
          executionStage === 'closed'
            ? 'Execution lifecycle completed and the position is closed.'
            : executionStage === 'cancelled'
              ? 'Execution ended before a position was opened.'
              : 'Execution expired before it could fill.',
        isStale: false,
        backgroundEnabled: env.suggestedTradesSync.backgroundEnabled,
        manualReconcileAvailable: true,
        lastObservedAt,
        lastSyncedAt,
        nextCheckAt: null,
        staleAfterMs,
      };
    }

    const isStale = this.isExecutionTrackingStale(item, execution);

    return {
      state: isStale ? 'stale' : 'fresh',
      label: isStale ? 'Needs Refresh' : 'In Sync',
      summary: isStale
        ? 'Execution tracking is older than the refresh threshold and should be reconciled.'
        : executionStage === 'queued'
          ? 'Execution request is queued and awaiting submission progress.'
          : executionStage === 'submitting'
            ? 'Execution submission is in progress and awaiting an order link.'
            : 'Execution tracking is current with the latest known order and position state.',
      isStale,
      backgroundEnabled: env.suggestedTradesSync.backgroundEnabled,
      manualReconcileAvailable: true,
      lastObservedAt,
      lastSyncedAt,
      nextCheckAt,
      staleAfterMs,
    };
  }

  private buildLifecycle(
    item: SuggestedTrade,
    execution: SuggestedTradeExecutionLink | null,
    syncStatus: NonNullable<SuggestedTradeItem['syncStatus']>
  ): SuggestedTradeItem['lifecycle'] {
    const review = this.getReviewMetadata(item);
    const orderId = execution?.paperOrderId ?? execution?.orderId ?? null;
    const orderEntity = execution?.executionMode === 'paper' ? 'paper_order' : 'order';
    const executionStage = this.buildExecutionStage(execution);

    return {
      signal: {
        entity: 'signal',
        entityId: this.readStringValue((item.meta as Record<string, unknown> | null)?.signalId),
        detectedAt: item.signalTime.toISOString(),
        status: 'detected',
      },
      suggestedTrade: {
        entity: 'suggested_trade',
        entityId: item.id,
        status: item.status as SuggestedTradeStatus,
        createdAt: item.createdAt.toISOString(),
        reviewedAt: review.updatedAt,
        reviewNote: review.note,
      },
      order:
        orderId || executionStage === 'queued' || executionStage === 'submitting'
          ? {
              entity: orderEntity,
              entityId: orderId,
              executionMode: execution?.executionMode ?? null,
              status: execution?.paperOrderStatus ?? execution?.orderStatus ?? null,
              executionState: this.buildExecutionStage(execution),
              linkedAt: execution?.linkedAt ?? null,
              lastSeenAt: execution?.lastSeenAt ?? execution?.lastSyncAt ?? null,
            }
          : null,
      position: execution?.positionId
        ? {
            entity: 'position',
            entityId: execution.positionId,
            status: execution.positionStatus ?? null,
            openedAt: execution.positionOpenedAt ?? null,
            closedAt: execution.positionClosedAt ?? null,
            outcome: execution.outcome ?? null,
          }
        : null,
      sync: syncStatus,
    };
  }

  private buildTimeline(
    item: SuggestedTrade,
    execution: SuggestedTradeExecutionLink | null,
    syncStatus: NonNullable<SuggestedTradeItem['syncStatus']>
  ): SuggestedTradeItem['timeline'] {
    const review = this.getReviewMetadata(item);
    const events: NonNullable<SuggestedTradeItem['timeline']> = [
      {
        id: 'signal_detected',
        kind: 'signal',
        label: 'Signal detected',
        description: 'A qualifying signal triggered this suggested trade.',
        occurredAt: item.signalTime.toISOString(),
        entity: 'signal',
        entityId: this.readStringValue((item.meta as Record<string, unknown> | null)?.signalId),
        status: 'Detected',
      },
      {
        id: 'suggested_trade_created',
        kind: 'suggested_trade',
        label: 'Suggestion created',
        description: 'The execution review item was created from an automation or promoted signal.',
        occurredAt: item.createdAt.toISOString(),
        entity: 'suggested_trade',
        entityId: item.id,
        status: item.status,
      },
    ];

    if (review.updatedAt) {
      events.push({
        id: `review_${String(review.status || item.status).toLowerCase()}`,
        kind: 'review',
        label: `Review ${String(review.status || item.status)}`,
        description:
          review.note ??
          `Operator review moved the trade into ${String(review.status || item.status)}.`,
        occurredAt: review.updatedAt,
        entity: 'suggested_trade',
        entityId: item.id,
        status: review.status ?? item.status,
      });
    }

    if (execution?.preTradeCheckedAt) {
      const preTradeState = String(execution.preTradeState || '')
        .trim()
        .toLowerCase();
      events.push({
        id: `pretrade_${preTradeState || 'checked'}`,
        kind: 'review',
        label:
          preTradeState === 'blocked'
            ? 'Pre-trade blocked'
            : preTradeState === 'stale'
              ? 'Pre-trade stale'
              : preTradeState === 'error'
                ? 'Pre-trade error'
                : 'Pre-trade cleared',
        description:
          execution.preTradeBlockedReason ??
          (preTradeState === 'passed'
            ? 'Pre-trade check cleared the suggestion for the next workflow step.'
            : 'Pre-trade check recorded an execution gate outcome.'),
        occurredAt: execution.preTradeCheckedAt,
        entity: 'suggested_trade',
        entityId: item.id,
        status: execution.preTradeState ?? null,
      });
    }

    events.push(...this.buildRouteAttemptTimelineEvents(execution));

    if (execution?.linkedAt) {
      events.push({
        id: 'order_linked',
        kind: 'order',
        label: execution.executionMode === 'paper' ? 'Paper order linked' : 'Order linked',
        description:
          execution.executionMode === 'paper'
            ? 'The suggested trade was linked to a paper order.'
            : 'The suggested trade was linked to a live order.',
        occurredAt: execution.linkedAt,
        entity: execution.executionMode === 'paper' ? 'paper_order' : 'order',
        entityId: execution.paperOrderId ?? execution.orderId ?? null,
        status:
          execution.paperOrderStatus ?? execution.orderStatus ?? execution.executionState ?? null,
      });
    }

    if (execution?.submittedAt && !execution?.linkedAt) {
      events.push({
        id: 'execution_submitting',
        kind: 'order',
        label: execution.executionState === 'queued' ? 'Execution queued' : 'Execution submitting',
        description:
          execution.executionState === 'queued'
            ? 'The suggestion has entered the execution queue.'
            : 'The suggestion is being submitted to execution.',
        occurredAt: execution.submittedAt,
        entity: execution.executionMode === 'paper' ? 'paper_order' : 'order',
        entityId: execution.paperOrderId ?? execution.orderId ?? null,
        status: execution.executionState ?? null,
      });
    }

    if (execution?.filledAt) {
      events.push({
        id: 'order_filled',
        kind: 'order',
        label: 'Order filled',
        description: 'The linked order filled and moved into the position stage.',
        occurredAt: execution.filledAt,
        entity: execution.executionMode === 'paper' ? 'paper_order' : 'order',
        entityId: execution.paperOrderId ?? execution.orderId ?? null,
        status: execution.orderStatus ?? execution.paperOrderStatus ?? 'FILLED',
      });
    }

    if (execution?.positionOpenedAt) {
      events.push({
        id: 'position_opened',
        kind: 'position',
        label: 'Position opened',
        description: 'A position was observed for the linked execution.',
        occurredAt: execution.positionOpenedAt,
        entity: 'position',
        entityId: execution.positionId ?? null,
        status: execution.positionStatus ?? 'OPEN',
      });
    }

    events.push(...this.buildProtectionTimelineEvents(execution));

    if (execution?.positionClosedAt) {
      events.push({
        id: 'position_closed',
        kind: 'position',
        label: 'Position closed',
        description:
          execution.outcome === 'profit'
            ? 'The tracked position closed in profit.'
            : execution.outcome === 'loss'
              ? 'The tracked position closed in loss.'
              : execution.outcome === 'breakeven'
                ? 'The tracked position closed at breakeven.'
                : 'The tracked position closed.',
        occurredAt: execution.positionClosedAt,
        entity: 'position',
        entityId: execution.positionId ?? null,
        status: execution.positionStatus ?? 'CLOSED',
      });
    }

    if (execution?.canceledAt && !execution.positionClosedAt) {
      events.push({
        id: 'execution_cancelled',
        kind: 'order',
        label: 'Execution closed',
        description: 'The linked execution ended before a position could be tracked further.',
        occurredAt: execution.canceledAt,
        entity: execution.executionMode === 'paper' ? 'paper_order' : 'order',
        entityId: execution.paperOrderId ?? execution.orderId ?? null,
        status:
          execution.executionState ?? execution.orderStatus ?? execution.paperOrderStatus ?? null,
      });
    }

    if (syncStatus.lastSyncedAt) {
      events.push({
        id: 'execution_synced',
        kind: 'sync',
        label: syncStatus.label,
        description: syncStatus.summary,
        occurredAt: syncStatus.lastSyncedAt,
        entity: 'suggested_trade',
        entityId: item.id,
        status: syncStatus.state,
      });
    }

    return events
      .filter((event) => this.toTimestamp(event.occurredAt) > 0)
      .sort(
        (left, right) => this.toTimestamp(left.occurredAt) - this.toTimestamp(right.occurredAt)
      );
  }

  private buildRouteAttemptTimelineEvents(
    execution: SuggestedTradeExecutionLink | null
  ): SuggestedTradeTimelineEvent[] {
    const attempts = execution?.routeAttempts ?? [];
    if (!attempts.length) {
      return [];
    }

    return attempts.flatMap((attempt): SuggestedTradeTimelineEvent[] => {
      const attemptId = Math.max(1, Math.floor(attempt.attemptNumber || 0));
      const brokerKey = String(attempt.brokerKey || 'unknown').trim() || 'unknown';
      const accountLabel =
        String(attempt.accountName || '').trim() ||
        String(attempt.accountId || '').trim() ||
        'unknown account';
      const brokerSymbol = String(attempt.brokerSymbol || attempt.requestedSymbol || '').trim();
      const status = String(attempt.status || 'unknown').trim() || 'unknown';
      const baseId = `route_attempt_${attemptId}_${brokerKey}`;
      const events: SuggestedTradeTimelineEvent[] = [];

      if (attempt.startedAt) {
        events.push({
          id: `${baseId}_started`,
          kind: 'broker_route',
          label: `Broker route ${attemptId} started`,
          description: `Submitting ${brokerSymbol || 'the order'} to ${brokerKey} (${accountLabel}).`,
          occurredAt: attempt.startedAt,
          entity: 'broker_route',
          entityId: attempt.accountId ?? null,
          status: attempt.submissionState ?? status,
        });
      }

      const finishedAt = attempt.finishedAt ?? attempt.reconciliation?.checkedAt ?? null;
      if (finishedAt) {
        events.push({
          id: `${baseId}_finished`,
          kind: 'broker_route',
          label: this.buildRouteAttemptLabel(attemptId, status),
          description: this.buildRouteAttemptDescription(attempt),
          occurredAt: finishedAt,
          entity: attempt.orderId ? 'order' : 'broker_route',
          entityId: attempt.orderId ?? attempt.accountId ?? null,
          status,
        });
      }

      const reconciliation = attempt.reconciliation;
      if (reconciliation?.checkedAt && reconciliation.checkedAt !== finishedAt) {
        events.push({
          id: `${baseId}_reconciled`,
          kind: 'broker_route',
          label: 'Route reconciliation checked',
          description:
            reconciliation.message ??
            `Broker reconciliation completed with ${reconciliation.status}.`,
          occurredAt: reconciliation.checkedAt,
          entity: reconciliation.positionId
            ? 'position'
            : reconciliation.orderId
              ? 'order'
              : 'broker_route',
          entityId:
            reconciliation.positionId ?? reconciliation.orderId ?? attempt.accountId ?? null,
          status: reconciliation.status,
        });
      }

      return events;
    });
  }

  private buildRouteAttemptLabel(attemptNumber: number, status: string): string {
    const normalizedStatus = status.toLowerCase();
    if (normalizedStatus === 'placed') {
      return `Broker route ${attemptNumber} placed`;
    }
    if (normalizedStatus === 'working') {
      return `Broker route ${attemptNumber} working`;
    }
    if (normalizedStatus === 'failed') {
      return `Broker route ${attemptNumber} failed`;
    }
    if (normalizedStatus === 'pre_trade_blocked') {
      return `Broker route ${attemptNumber} blocked`;
    }
    if (normalizedStatus === 'manual_review') {
      return `Broker route ${attemptNumber} needs review`;
    }
    return `Broker route ${attemptNumber} updated`;
  }

  private buildRouteAttemptDescription(attempt: SuggestedTradeRouteAttempt): string {
    const brokerKey = String(attempt.brokerKey || 'unknown').trim() || 'unknown';
    const accountLabel =
      String(attempt.accountName || '').trim() ||
      String(attempt.accountId || '').trim() ||
      'unknown account';
    const status = String(attempt.status || 'unknown')
      .trim()
      .toLowerCase();
    const failureMessage =
      String(attempt.failureMessage || '').trim() ||
      String(attempt.failureCode || '').trim() ||
      String(attempt.note || '').trim();

    if (status === 'placed') {
      return attempt.orderId
        ? `${brokerKey} accepted the route and returned order ${attempt.orderId}.`
        : `${brokerKey} accepted the route.`;
    }
    if (status === 'working') {
      return attempt.orderId
        ? `${brokerKey} accepted order ${attempt.orderId}; fill/protection lifecycle is still being tracked.`
        : `${brokerKey} accepted the route; fill/protection lifecycle is still being tracked.`;
    }
    if (status === 'failed') {
      return failureMessage
        ? `${brokerKey} (${accountLabel}) failed: ${failureMessage}.`
        : `${brokerKey} (${accountLabel}) failed before a confirmed fill.`;
    }
    if (status === 'pre_trade_blocked') {
      return failureMessage
        ? `${brokerKey} (${accountLabel}) was blocked before submission: ${failureMessage}.`
        : `${brokerKey} (${accountLabel}) was blocked before submission.`;
    }
    if (status === 'manual_review') {
      return failureMessage
        ? `${brokerKey} (${accountLabel}) needs manual review: ${failureMessage}.`
        : `${brokerKey} (${accountLabel}) needs manual review before fallback.`;
    }

    return attempt.note ?? `${brokerKey} (${accountLabel}) route attempt recorded.`;
  }

  private buildProtectionTimelineEvents(
    execution: SuggestedTradeExecutionLink | null
  ): SuggestedTradeTimelineEvent[] {
    if (!execution) {
      return [];
    }

    const events: SuggestedTradeTimelineEvent[] = [];
    const protectionPlan = this.readRecordValue(execution.protectionPlan);
    const replacementSubmittedAt = this.toIsoString(protectionPlan?.replacementSubmittedAt);
    const stopLossOrderId = this.readStringValue(protectionPlan?.stopLossOrderId);
    const takeProfitOrderId = this.readStringValue(protectionPlan?.takeProfitOrderId);
    const protectionState = execution.protectionState ?? null;

    if (execution.protectionCheckedAt) {
      events.push({
        id: 'protection_checked',
        kind: 'protection',
        label: 'Protection checked',
        description:
          protectionState === 'failed'
            ? (execution.protectionLastError ??
              'Protection check failed and requires operator review.')
            : 'Stop loss and target protection state was checked against broker state.',
        occurredAt: execution.protectionCheckedAt,
        entity: 'position',
        entityId: execution.positionId ?? null,
        status: protectionState,
      });
    }

    if (replacementSubmittedAt) {
      events.push({
        id: 'protection_replacement_submitted',
        kind: 'protection',
        label: 'Protection repair submitted',
        description: 'Replacement stop loss and target orders were submitted for the position.',
        occurredAt: replacementSubmittedAt,
        entity: 'position',
        entityId: execution.positionId ?? null,
        status: protectionState,
      });
    }

    if (execution.protectionAttachedAt) {
      events.push({
        id: 'protection_attached',
        kind: 'protection',
        label: 'Protection attached',
        description:
          stopLossOrderId || takeProfitOrderId
            ? `Broker protection confirmed. SL ${stopLossOrderId || 'unlinked'}, TP ${
                takeProfitOrderId || 'unlinked'
              }.`
            : 'Broker protection confirmed for the position.',
        occurredAt: execution.protectionAttachedAt,
        entity: 'position',
        entityId: execution.positionId ?? null,
        status: protectionState ?? 'attached',
      });
    }

    return events;
  }

  private buildFreshness(
    item: SuggestedTrade,
    execution: SuggestedTradeExecutionLink | null
  ): SuggestedTradeItem['freshness'] {
    const executionObservedAt =
      execution?.lastSeenAt ??
      execution?.positionClosedAt ??
      execution?.positionOpenedAt ??
      execution?.filledAt ??
      execution?.submittedAt ??
      execution?.linkedAt ??
      null;
    const observedAt = executionObservedAt ?? item.updatedAt.toISOString();
    const observedMs = this.toTimestamp(observedAt);
    const freshnessMs = Math.max(0, Date.now() - observedMs);
    const staleAfterMs =
      execution?.executionMode === 'live'
        ? 15 * 60 * 1000
        : execution?.executionMode === 'paper'
          ? 5 * 60 * 1000
          : ['Open', 'Reviewed', 'Accepted'].includes(String(item.status || '').trim())
            ? 24 * 60 * 60 * 1000
            : null;

    return {
      observedAt,
      freshnessMs,
      staleAfterMs,
      isStale: staleAfterMs !== null ? freshnessMs > staleAfterMs : false,
      source: executionObservedAt ? 'execution' : item.status === 'Open' ? 'suggestion' : 'review',
    };
  }

  private getReviewMetadata(item: SuggestedTrade): {
    status: string | null;
    note: string | null;
    updatedAt: string | null;
  } {
    const meta =
      item.meta && typeof item.meta === 'object' && !Array.isArray(item.meta) ? item.meta : null;
    const review =
      meta?.review && typeof meta.review === 'object' && !Array.isArray(meta.review)
        ? (meta.review as Record<string, unknown>)
        : null;

    return {
      status: this.readStringValue(review?.status),
      note: this.readStringValue(review?.note),
      updatedAt: this.toIsoString(review?.updatedAt),
    };
  }

  private getExecutionObservedAt(
    item: SuggestedTrade,
    execution: SuggestedTradeExecutionLink | null
  ): string | null {
    return (
      execution?.lastSeenAt ??
      execution?.lastSyncAt ??
      execution?.positionClosedAt ??
      execution?.positionOpenedAt ??
      execution?.filledAt ??
      execution?.submittedAt ??
      execution?.linkedAt ??
      item.updatedAt.toISOString()
    );
  }

  private resolveExecutionSyncStaleAfterMs(execution: SuggestedTradeExecutionLink | null): number {
    if (execution?.executionMode === 'paper') {
      return Math.max(env.suggestedTradesSync.staleAfterMs, env.paperOrders.pollIntervalMs * 3);
    }
    return env.suggestedTradesSync.staleAfterMs;
  }

  private isExecutionTrackingStale(
    item: SuggestedTrade,
    execution: SuggestedTradeExecutionLink | null,
    staleBefore?: Date
  ): boolean {
    if (!this.hasExecutionTracking(execution)) {
      return false;
    }

    const executionStage = this.buildExecutionStage(execution);
    if (
      executionStage === 'closed' ||
      executionStage === 'cancelled' ||
      executionStage === 'expired' ||
      executionStage === 'failed' ||
      executionStage === 'rejected'
    ) {
      return false;
    }

    const observedAt = this.getExecutionObservedAt(item, execution);
    const observedMs = this.toTimestamp(observedAt);
    if (!observedMs) {
      return true;
    }

    const thresholdMs =
      staleBefore?.getTime() ?? Date.now() - this.resolveExecutionSyncStaleAfterMs(execution);
    return observedMs <= thresholdMs;
  }

  private buildLinkedEntities(
    item: SuggestedTrade,
    execution: SuggestedTradeExecutionLink | null
  ): SuggestedTradeItem['linkedEntities'] {
    const linkedEntities: NonNullable<SuggestedTradeItem['linkedEntities']> = [];
    const seen = new Set<string>();
    const meta = item.meta && typeof item.meta === 'object' ? item.meta : {};
    const signalId = this.readStringValue((meta as Record<string, unknown>).signalId);

    const push = (entity: string, id: string | null, extras: Record<string, unknown> = {}) => {
      const normalizedId = this.readStringValue(id);
      if (!normalizedId) {
        return;
      }
      const key = `${entity}:${normalizedId}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      linkedEntities.push({
        entity,
        id: normalizedId,
        label: this.readStringValue(extras.label) ?? undefined,
        url: this.readStringValue(extras.url) ?? undefined,
        relation: this.readStringValue(extras.relation) ?? undefined,
        status: this.readStringValue(extras.status),
      });
    };

    push('automation', item.automationId, {
      label: 'Automation',
      url: `/automations?selected=${encodeURIComponent(item.automationId)}`,
      relation: 'source',
    });
    push('automation_run', item.automationRunId, {
      label: 'Automation run',
      url: `/automations?selected=${encodeURIComponent(item.automationId)}&runId=${encodeURIComponent(item.automationRunId)}`,
      relation: 'run',
    });
    if (item.sourceTemplateId) {
      push('strategy_template', item.sourceTemplateId, {
        label: 'Strategy template',
        url: `/strategy-templates?selected=${encodeURIComponent(item.sourceTemplateId)}`,
        relation: 'template',
      });
    }
    if (item.sourceBacktestId) {
      push('backtest', item.sourceBacktestId, {
        label: 'Backtest',
        url: `/backtests?selected=${encodeURIComponent(item.sourceBacktestId)}`,
        relation: 'backtest',
      });
    }
    if (signalId) {
      push('signal', signalId, {
        label: 'Source signal',
        url: `/suggested-trades?tab=signals&signalId=${encodeURIComponent(signalId)}`,
        relation: 'source',
      });
    }
    if (execution?.preTradeCheckId) {
      push('pre_trade_check', execution.preTradeCheckId, {
        label: 'Pre-trade check',
        relation: 'risk',
        status: execution.preTradeState ?? null,
      });
    }
    if (execution?.orderId) {
      push('live_order', execution.orderId, {
        label: 'Live order',
        url: `/orders?selected=${encodeURIComponent(execution.orderId)}`,
        relation: 'execution',
        status: execution.orderStatus ?? null,
      });
    }
    if (execution?.paperOrderId) {
      push('paper_order', execution.paperOrderId, {
        label: 'Paper order',
        url: `/orders?selected=${encodeURIComponent(execution.paperOrderId)}`,
        relation: 'execution',
        status: execution.paperOrderStatus ?? execution.orderStatus ?? null,
      });
    }
    if (execution?.positionId) {
      push('position', execution.positionId, {
        label: 'Position',
        url: `/positions?selected=${encodeURIComponent(execution.positionId)}`,
        relation: 'execution',
        status: execution.positionStatus ?? null,
      });
    }

    return linkedEntities;
  }

  private async refreshExecutionOutcomes(
    userId: string,
    trades: SuggestedTrade[],
    options: ExecutionRefreshOptions = {}
  ): Promise<number> {
    let refreshedTrades = 0;
    for (const trade of trades) {
      const execution = this.getExecutionLink(trade);
      const orderId = this.readStringValue(execution?.orderId);
      const paperOrderId = this.readStringValue(execution?.paperOrderId);
      const brokerKey = this.readStringValue(execution?.brokerKey);
      const accountId = this.readStringValue(execution?.accountId);

      if (
        execution?.executionMode === 'live' &&
        (options.resolveStaleGaps || options.allowPositionEvidenceFill)
      ) {
        this.maybeStartLiveAutoLifecycleMonitorForExecution(userId, trade, execution);
      }

      if (paperOrderId && execution?.executionMode === 'paper') {
        await this.paperOrderExecutionService.simulateUserPaperOrders(userId, {
          paperOrderIds: [paperOrderId],
        });
        const paperOrder = await this.paperOrderRepository.getPaperOrderById(userId, paperOrderId);
        if (!paperOrder) {
          if (!options.resolveStaleGaps) {
            continue;
          }
          const nextExecution = this.resolveExecutionGap(execution, {
            state: 'unknown',
            message: `Linked paper order ${paperOrderId} could not be found during reconciliation`,
          });
          const currentExecutionJson = JSON.stringify(execution ?? null);
          const nextExecutionJson = JSON.stringify(nextExecution ?? null);
          if (currentExecutionJson === nextExecutionJson) {
            continue;
          }
          await this.persistExecutionState(trade, nextExecution);
          refreshedTrades += 1;
          continue;
        }

        const nextExecution = this.mergePaperExecutionOutcome(execution, paperOrder);
        const currentExecutionJson = JSON.stringify(execution ?? null);
        const nextExecutionJson = JSON.stringify(nextExecution ?? null);
        if (currentExecutionJson === nextExecutionJson) {
          continue;
        }

        await this.persistExecutionState(trade, nextExecution);
        refreshedTrades += 1;
        continue;
      }

      if (!orderId || !brokerKey || !accountId) {
        if (!options.resolveStaleGaps) {
          continue;
        }
        const nextExecution = this.resolveUnlinkedExecutionGap(execution);
        if (!nextExecution) {
          continue;
        }
        const currentExecutionJson = JSON.stringify(execution ?? null);
        const nextExecutionJson = JSON.stringify(nextExecution ?? null);
        if (currentExecutionJson === nextExecutionJson) {
          continue;
        }
        await this.persistExecutionState(trade, nextExecution);
        refreshedTrades += 1;
        continue;
      }

      const snapshot = await this.suggestedTradeRepository.getLinkedOrderSnapshot(
        userId,
        brokerKey,
        accountId,
        orderId
      );

      if (!snapshot) {
        if (options.allowPositionEvidenceFill) {
          const positionAnchor = this.buildPositionSearchAnchor(
            execution?.submittedAt ??
              execution?.filledAt ??
              execution?.linkedAt ??
              trade.signalTime.toISOString()
          );
          const positionSnapshots = await this.suggestedTradeRepository.getLinkedPositionSnapshots(
            userId,
            brokerKey,
            accountId,
            trade.symbol,
            positionAnchor,
            20
          );
          let nextExecution = this.mergePositionOutcome(trade, execution ?? {}, positionSnapshots, {
            allowPositionEvidenceFill: true,
          });
          nextExecution = await this.maybeRemediateLiveProtection(
            userId,
            trade,
            nextExecution,
            positionSnapshots
          );
          nextExecution = await this.maybeApplyLiveTrailingStop(
            userId,
            trade,
            nextExecution,
            positionSnapshots
          );
          nextExecution = await this.maybeAutoCancelSiblingProtectionOrders(
            userId,
            trade,
            nextExecution,
            positionSnapshots
          );
          nextExecution = this.alignLiveAutoExecutionStateWithProtectionLifecycle(nextExecution);
          this.maybeStartLiveAutoLifecycleMonitorForExecution(userId, trade, nextExecution);
          const currentExecutionJson = JSON.stringify(execution ?? null);
          const nextExecutionJson = JSON.stringify(nextExecution ?? null);
          if (currentExecutionJson === nextExecutionJson) {
            continue;
          }
          await this.persistExecutionState(trade, nextExecution);
          refreshedTrades += 1;
          continue;
        }
        if (!options.resolveStaleGaps) {
          continue;
        }
        const nextExecution = this.resolveExecutionGap(execution, {
          state: 'unknown',
          message: `Linked live order ${orderId} did not produce a scheduler snapshot during reconciliation`,
        });
        const currentExecutionJson = JSON.stringify(execution ?? null);
        const nextExecutionJson = JSON.stringify(nextExecution ?? null);
        if (currentExecutionJson === nextExecutionJson) {
          continue;
        }
        await this.persistExecutionState(trade, nextExecution);
        refreshedTrades += 1;
        continue;
      }

      let nextExecution = this.mergeExecutionOutcome(execution, snapshot);
      const positionAnchor = this.buildPositionSearchAnchor(
        nextExecution.submittedAt ??
          nextExecution.filledAt ??
          nextExecution.linkedAt ??
          trade.signalTime.toISOString()
      );
      const positionSnapshots = await this.suggestedTradeRepository.getLinkedPositionSnapshots(
        userId,
        brokerKey,
        accountId,
        trade.symbol,
        positionAnchor,
        20
      );
      nextExecution = this.mergePositionOutcome(trade, nextExecution, positionSnapshots, {
        allowPositionEvidenceFill: options.allowPositionEvidenceFill === true,
      });
      nextExecution = await this.maybeExpireLiveLimitEntryOrder(
        userId,
        trade,
        nextExecution,
        positionSnapshots
      );
      nextExecution = await this.maybeRemediateLiveProtection(
        userId,
        trade,
        nextExecution,
        positionSnapshots
      );
      nextExecution = await this.maybeApplyLiveTrailingStop(
        userId,
        trade,
        nextExecution,
        positionSnapshots
      );
      nextExecution = await this.maybeAutoCancelSiblingProtectionOrders(
        userId,
        trade,
        nextExecution,
        positionSnapshots
      );
      nextExecution = this.alignLiveAutoExecutionStateWithProtectionLifecycle(nextExecution);
      if (options.resolveStaleGaps || options.allowPositionEvidenceFill) {
        this.maybeStartLiveAutoLifecycleMonitorForExecution(userId, trade, nextExecution);
      }
      const currentExecutionJson = JSON.stringify(execution ?? null);
      const nextExecutionJson = JSON.stringify(nextExecution ?? null);
      if (currentExecutionJson === nextExecutionJson) {
        continue;
      }

      await this.persistExecutionState(trade, nextExecution);
      refreshedTrades += 1;
    }

    return refreshedTrades;
  }

  private async maybeExpireLiveLimitEntryOrder(
    userId: string,
    trade: SuggestedTrade,
    execution: SuggestedTradeExecutionLink,
    positionSnapshots: Array<{
      externalId: string;
      status: string | null;
      statusRank: number | null;
      firstSeenAt: Date | string | null;
      lastSeenAt: Date | string | null;
      payload: Record<string, unknown> | null;
    }>
  ): Promise<SuggestedTradeExecutionLink> {
    if (execution.executionMode !== 'live') {
      return execution;
    }

    const orderType = String(execution.orderType || '')
      .trim()
      .toLowerCase();
    if (orderType !== 'limit' && orderType !== 'limit_order') {
      return execution;
    }

    const brokerKey = this.readStringValue(execution.brokerKey)?.toLowerCase() ?? null;
    const accountId = this.readStringValue(execution.accountId);
    const orderId = this.readStringValue(execution.orderId);
    if (!brokerKey || !accountId || !orderId) {
      return execution;
    }

    const executionState = String(execution.executionState || '')
      .trim()
      .toLowerCase();
    const orderStatus = this.normalizeOrderStatus(execution.orderStatus);
    const activeOrderStatus = this.isActiveLimitEntryOrderStatus(orderStatus);
    const partialFillEvidence =
      orderStatus === 'PARTIALLY_FILLED' || this.hasPositiveFilledQuantity(execution);
    if (this.isClearedPartialFillEntryRemainder(execution)) {
      return execution;
    }
    const terminalOrderStatus = Boolean(
      orderStatus &&
      ['FILLED', 'CLOSED', 'CANCELLED', 'REJECTED', 'EXPIRED', 'FAILED'].includes(orderStatus)
    );
    if (
      terminalOrderStatus ||
      (!activeOrderStatus &&
        ['filled', 'closed', 'cancelled', 'rejected', 'expired', 'failed'].includes(executionState))
    ) {
      return execution;
    }

    const linkedPositionStatus = this.normalizePositionStatus(execution.positionStatus);
    if (
      !partialFillEvidence &&
      (linkedPositionStatus === 'OPEN' ||
        linkedPositionStatus === 'PARTIAL' ||
        this.hasOpenPositionSnapshot(positionSnapshots))
    ) {
      return execution;
    }

    const executionPolicy = await this.loadTradeSuggestionExecutionPolicy(
      userId,
      trade.automationId
    );
    const expirySeconds = resolveLimitOrderExpirySeconds(
      trade.timeframe,
      executionPolicy.limitOrderExpiry
    );
    if (expirySeconds === null) {
      return execution;
    }

    const anchorMs = this.toTimestamp(
      execution.linkedAt ?? execution.submittedAt ?? execution.acceptedAt ?? trade.createdAt
    );
    if (!anchorMs) {
      return execution;
    }

    const expiresAt = new Date(anchorMs + expirySeconds * 1000);
    if (Date.now() < expiresAt.getTime()) {
      return execution;
    }

    if (!this.brokerRuntimeRegistry?.supportsOrdersAdapter?.(brokerKey)) {
      return execution;
    }

    const adapter = this.brokerRuntimeRegistry?.getOrdersAdapter?.(brokerKey);
    if (!adapter?.cancelOrder) {
      return execution;
    }

    const nowIso = new Date().toISOString();
    const expiryMessage = partialFillEvidence
      ? `Partially filled limit entry order exceeded ${this.formatDurationFromSeconds(expirySeconds)} for ${trade.timeframe}; remaining quantity cancel requested at ${nowIso}.`
      : `Limit entry order expired after ${this.formatDurationFromSeconds(expirySeconds)} for ${trade.timeframe}; cancel requested at ${nowIso}.`;
    try {
      await adapter.cancelOrder(orderId, {
        userId,
        brokerKey,
        accountId,
      });
      const protectionCleanup = partialFillEvidence
        ? { note: null, protectionPlan: null }
        : await this.cancelDeltaProtectionOrdersForExpiredEntry({
            userId,
            brokerKey,
            accountId,
            entryOrderId: orderId,
            execution,
            adapter,
            nowIso,
          });
      await this.recordLiveLimitEntryExpirySubmissionEvent({
        userId,
        tradeId: trade.id,
        brokerKey,
        accountId,
        brokerOrderId: orderId,
        event: {
          type: partialFillEvidence
            ? 'live_auto_limit_entry_remainder_cancel_requested'
            : 'live_auto_limit_entry_expiry_cancel_requested',
          message: expiryMessage,
          details: this.buildLiveLimitEntryExpiryLifecycleDetails({
            trade,
            execution,
            brokerKey,
            accountId,
            orderId,
            expirySeconds,
            expiresAt,
            observedAt: nowIso,
            partialFill: partialFillEvidence,
            protectionPlan: protectionCleanup.protectionPlan ?? execution.protectionPlan,
          }),
        },
      });
      if (partialFillEvidence) {
        const nextExecution: SuggestedTradeExecutionLink = {
          ...execution,
          orderStatus: 'PARTIALLY_FILLED',
          executionState: 'filled',
          canceledAt: nowIso,
          remainingQuantity: 0,
          note: this.appendExecutionNote(execution.note, expiryMessage),
        };
        return this.markDeltaPartialFillProtectionReviewRequired(nextExecution, nowIso);
      }

      return {
        ...execution,
        orderStatus: 'EXPIRED',
        executionState: 'expired',
        canceledAt: nowIso,
        positionId: null,
        positionStatus: null,
        positionOpenedAt: null,
        positionClosedAt: null,
        exitPrice: null,
        realizedPnl: null,
        outcome: null,
        protectionPlan: protectionCleanup.protectionPlan ?? execution.protectionPlan,
        note: this.appendExecutionNote(
          this.appendExecutionNote(execution.note, expiryMessage),
          protectionCleanup.note ?? ''
        ),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (this.isAlreadyTerminalCancelError(message)) {
        const terminalMessage = 'Broker reported order already terminal during expiry cancel.';
        const protectionCleanup = partialFillEvidence
          ? { note: null, protectionPlan: null }
          : await this.cancelDeltaProtectionOrdersForExpiredEntry({
              userId,
              brokerKey,
              accountId,
              entryOrderId: orderId,
              execution,
              adapter,
              nowIso,
            });
        await this.recordLiveLimitEntryExpirySubmissionEvent({
          userId,
          tradeId: trade.id,
          brokerKey,
          accountId,
          brokerOrderId: orderId,
          event: {
            type: partialFillEvidence
              ? 'live_auto_limit_entry_remainder_already_terminal'
              : 'live_auto_limit_entry_expiry_already_terminal',
            message: `${expiryMessage} ${terminalMessage}`,
            details: this.buildLiveLimitEntryExpiryLifecycleDetails({
              trade,
              execution,
              brokerKey,
              accountId,
              orderId,
              expirySeconds,
              expiresAt,
              observedAt: nowIso,
              partialFill: partialFillEvidence,
              protectionPlan: protectionCleanup.protectionPlan ?? execution.protectionPlan,
              brokerMessage: message,
              alreadyTerminal: true,
            }),
          },
        });
        if (partialFillEvidence) {
          const nextExecution: SuggestedTradeExecutionLink = {
            ...execution,
            orderStatus: 'PARTIALLY_FILLED',
            executionState: 'filled',
            canceledAt: nowIso,
            remainingQuantity: 0,
            note: this.appendExecutionNote(
              this.appendExecutionNote(execution.note, expiryMessage),
              terminalMessage
            ),
          };
          return this.markDeltaPartialFillProtectionReviewRequired(nextExecution, nowIso);
        }

        return {
          ...execution,
          orderStatus: 'EXPIRED',
          executionState: 'expired',
          canceledAt: nowIso,
          positionId: null,
          positionStatus: null,
          positionOpenedAt: null,
          positionClosedAt: null,
          exitPrice: null,
          realizedPnl: null,
          outcome: null,
          protectionPlan: protectionCleanup.protectionPlan ?? execution.protectionPlan,
          note: this.appendExecutionNote(
            this.appendExecutionNote(
              this.appendExecutionNote(execution.note, expiryMessage),
              terminalMessage
            ),
            protectionCleanup.note ?? ''
          ),
        };
      }
      await this.recordLiveLimitEntryExpirySubmissionEvent({
        userId,
        tradeId: trade.id,
        brokerKey,
        accountId,
        brokerOrderId: orderId,
        event: {
          type: partialFillEvidence
            ? 'live_auto_limit_entry_remainder_cancel_failed'
            : 'live_auto_limit_entry_expiry_cancel_failed',
          message: `${expiryMessage} Broker cancel failed: ${message}`,
          details: this.buildLiveLimitEntryExpiryLifecycleDetails({
            trade,
            execution,
            brokerKey,
            accountId,
            orderId,
            expirySeconds,
            expiresAt,
            observedAt: nowIso,
            partialFill: partialFillEvidence,
            protectionPlan: execution.protectionPlan,
            brokerMessage: message,
          }),
        },
      });
      return {
        ...execution,
        note: this.appendExecutionNote(
          execution.note,
          `${expiryMessage} Broker cancel failed: ${message}`
        ),
      };
    }
  }

  private buildLiveLimitEntryExpiryLifecycleDetails(input: {
    trade: SuggestedTrade;
    execution: SuggestedTradeExecutionLink;
    brokerKey: string;
    accountId: string;
    orderId: string;
    expirySeconds: number;
    expiresAt: Date;
    observedAt: string;
    partialFill: boolean;
    protectionPlan?: Record<string, unknown> | null;
    brokerMessage?: string | null;
    alreadyTerminal?: boolean;
  }): Record<string, unknown> {
    const protectionPlan = this.readRecordValue(input.protectionPlan) ?? {};
    const readStringList = (value: unknown): string[] =>
      (this.readArrayValue(value) ?? [])
        .map((item) => this.readStringValue(item))
        .filter((item): item is string => Boolean(item));

    return {
      suggestedTradeId: input.trade.id,
      symbol: input.trade.symbol,
      side: input.trade.side,
      timeframe: input.trade.timeframe,
      brokerKey: input.brokerKey,
      accountId: input.accountId,
      brokerOrderId: input.orderId,
      expirySeconds: input.expirySeconds,
      expiresAt: input.expiresAt.toISOString(),
      observedAt: input.observedAt,
      partialFill: input.partialFill,
      orderStatus: this.normalizeOrderStatus(input.execution.orderStatus),
      executionState: this.readStringValue(input.execution.executionState) ?? null,
      filledQuantity: this.readNumberValue(input.execution.filledQuantity),
      remainingQuantity: this.readNumberValue(input.execution.remainingQuantity),
      siblingProtectionCancelOrderIds: readStringList(
        protectionPlan.siblingProtectionCancelOrderIds
      ),
      siblingProtectionCancelledOrderIds: readStringList(
        protectionPlan.siblingProtectionCancelledOrderIds
      ),
      siblingProtectionAlreadyTerminalOrderIds: readStringList(
        protectionPlan.siblingProtectionAlreadyTerminalOrderIds
      ),
      siblingProtectionCancelFailures: readStringList(
        protectionPlan.siblingProtectionCancelFailures
      ),
      ...(input.brokerMessage ? { brokerMessage: input.brokerMessage } : {}),
      ...(input.alreadyTerminal ? { alreadyTerminal: true } : {}),
    };
  }

  private markDeltaPartialFillProtectionReviewRequired(
    execution: SuggestedTradeExecutionLink,
    nowIso: string
  ): SuggestedTradeExecutionLink {
    const brokerKey = this.readStringValue(execution.brokerKey)?.toLowerCase() ?? null;
    if (brokerKey !== 'delta_exchange' || !this.isClearedPartialFillEntryRemainder(execution)) {
      return execution;
    }

    const plan = this.readRecordValue(execution.protectionPlan) ?? {};
    return {
      ...execution,
      protectionState: 'pending',
      protectionAttachedAt: null,
      protectionCheckedAt: nowIso,
      protectionLastError: null,
      protectionPlan: {
        ...plan,
        partialEntryRemainderCancelledAt: nowIso,
        partialEntryProtectionReviewRequired: true,
        partialEntryFilledQuantity: this.readNumberValue(execution.filledQuantity),
        partialEntryOriginalQuantity: this.readNumberValue(execution.quantity),
      },
      note: this.appendExecutionNote(
        execution.note,
        'Delta partial entry remainder was cancelled; native SL/TP protection must be revalidated against the filled position size.'
      ),
    };
  }

  private async recordLiveLimitEntryExpirySubmissionEvent(input: {
    userId: string;
    tradeId: string;
    brokerKey: string;
    accountId: string;
    brokerOrderId: string;
    event: OrderSubmissionLifecycleEvent;
  }): Promise<void> {
    try {
      const repository = this.orderSubmissionRequestRepository;
      if (
        !repository?.findLatestBySuggestedTradeAndBrokerOrder ||
        !repository.recordLifecycleEvent
      ) {
        return;
      }

      const submission = await repository.findLatestBySuggestedTradeAndBrokerOrder({
        userId: input.userId,
        suggestedTradeId: input.tradeId,
        brokerKey: input.brokerKey,
        accountId: input.accountId,
        brokerOrderId: input.brokerOrderId,
      });
      if (!submission) {
        return;
      }

      await repository.recordLifecycleEvent(submission, input.event);
    } catch {
      // Cancellation state must still persist even if the audit ledger is unavailable.
    }
  }

  private async cancelDeltaProtectionOrdersForExpiredEntry(input: {
    userId: string;
    brokerKey: string;
    accountId: string;
    entryOrderId: string;
    execution: SuggestedTradeExecutionLink;
    adapter: {
      cancelOrder?: (
        orderId: string,
        context?: { userId: string; brokerKey: string; accountId: string }
      ) => Promise<unknown>;
    };
    nowIso: string;
  }): Promise<{ note: string | null; protectionPlan: Record<string, unknown> | null }> {
    if (input.brokerKey !== 'delta_exchange' || !input.adapter.cancelOrder) {
      return { note: null, protectionPlan: null };
    }

    const currentPlan = this.readRecordValue(input.execution.protectionPlan) ?? {};
    const protectionOrderIds = Array.from(
      new Set(
        [
          this.readStringValue(currentPlan.stopLossOrderId) ??
            this.readStringValue(currentPlan.stop_loss_order_id),
          this.readStringValue(currentPlan.takeProfitOrderId) ??
            this.readStringValue(currentPlan.take_profit_order_id),
        ].filter((value): value is string => Boolean(value && value !== input.entryOrderId))
      )
    );
    if (!protectionOrderIds.length) {
      return { note: null, protectionPlan: null };
    }

    const cancelledOrderIds: string[] = [];
    const terminalOrderIds: string[] = [];
    const failedOrderMessages: string[] = [];
    for (const protectionOrderId of protectionOrderIds) {
      try {
        await input.adapter.cancelOrder(protectionOrderId, {
          userId: input.userId,
          brokerKey: input.brokerKey,
          accountId: input.accountId,
        });
        cancelledOrderIds.push(protectionOrderId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (this.isAlreadyTerminalCancelError(message)) {
          terminalOrderIds.push(protectionOrderId);
          continue;
        }
        failedOrderMessages.push(`${protectionOrderId}: ${message}`);
      }
    }

    const noteParts: string[] = [];
    if (cancelledOrderIds.length) {
      noteParts.push(
        `Delta native protection cancel requested after unfilled entry expiry: ${cancelledOrderIds.join(
          ', '
        )}.`
      );
    }
    if (terminalOrderIds.length) {
      noteParts.push(
        `Delta native protection was already terminal during entry expiry cleanup: ${terminalOrderIds.join(
          ', '
        )}.`
      );
    }
    if (failedOrderMessages.length) {
      noteParts.push(
        `Delta native protection cancel failed after entry expiry: ${failedOrderMessages.join(
          '; '
        )}.`
      );
    }

    return {
      note: noteParts.join(' ') || null,
      protectionPlan: {
        ...currentPlan,
        siblingProtectionCancelRequestedAt: input.nowIso,
        siblingProtectionCancelOrderIds: protectionOrderIds,
        siblingProtectionCancelledOrderIds: cancelledOrderIds,
        siblingProtectionAlreadyTerminalOrderIds: terminalOrderIds,
        siblingProtectionCancelFailures: failedOrderMessages,
      },
    };
  }

  private isAlreadyTerminalCancelError(message: string): boolean {
    const normalized = String(message || '').toLowerCase();
    return (
      normalized.includes('terminal state') ||
      normalized.includes('too late to cancel') ||
      normalized.includes('open_order_not_found') ||
      normalized.includes('order_not_found') ||
      normalized.includes('not found') ||
      normalized.includes('does not exist') ||
      normalized.includes('already cancelled') ||
      normalized.includes('already canceled') ||
      normalized.includes('already closed')
    );
  }

  private isActiveLimitEntryOrderStatus(status: string | null): boolean {
    return Boolean(status && ['OPEN', 'PENDING', 'PARTIALLY_FILLED'].includes(status));
  }

  private isClearedPartialFillEntryRemainder(
    execution: SuggestedTradeExecutionLink | null | undefined
  ): boolean {
    if (!execution) {
      return false;
    }

    const orderStatus = this.normalizeOrderStatus(execution.orderStatus);
    const partialFillEvidence =
      orderStatus === 'PARTIALLY_FILLED' || this.hasPositiveFilledQuantity(execution);
    const remainingQuantity = this.readNumberValue(execution.remainingQuantity);
    return Boolean(
      partialFillEvidence &&
      remainingQuantity !== null &&
      remainingQuantity <= 0 &&
      execution.canceledAt
    );
  }

  private isActiveUnfilledLiveEntryOrder(execution: SuggestedTradeExecutionLink): boolean {
    if (execution.executionMode !== 'live') {
      return false;
    }

    const orderStatus = this.normalizeOrderStatus(execution.orderStatus);
    return Boolean(
      orderStatus &&
      ['OPEN', 'PENDING'].includes(orderStatus) &&
      !this.hasExecutionFillEvidence(execution)
    );
  }

  private clearStalePositionOutcomeForActiveUnfilledOrder(
    execution: SuggestedTradeExecutionLink
  ): SuggestedTradeExecutionLink {
    if (!this.isActiveUnfilledLiveEntryOrder(execution)) {
      return execution;
    }

    return {
      ...execution,
      executionState: 'working',
      filledAt: null,
      filledPrice: null,
      positionId: null,
      positionStatus: null,
      positionOpenedAt: null,
      positionClosedAt: null,
      exitPrice: null,
      realizedPnl: null,
      outcome: null,
    };
  }

  private hasOpenPositionSnapshot(
    snapshots: Array<{
      status: string | null;
      statusRank: number | null;
      payload: Record<string, unknown> | null;
    }>
  ): boolean {
    return snapshots.some((snapshot) => {
      const normalizedStatus = this.normalizePositionStatus(
        this.readStringValue(snapshot.status) ??
          this.readStringValue(snapshot.payload?.status) ??
          null
      );
      return normalizedStatus === 'OPEN' || normalizedStatus === 'PARTIAL';
    });
  }

  private async maybeRemediateLiveProtection(
    userId: string,
    trade: SuggestedTrade,
    execution: SuggestedTradeExecutionLink,
    positionSnapshots: LivePositionSnapshot[]
  ): Promise<SuggestedTradeExecutionLink> {
    if (execution.executionMode !== 'live') {
      return execution;
    }

    const protectionState = this.normalizeProtectionState(execution.protectionState);
    const nowIso = new Date().toISOString();
    if (this.isUnfilledTerminalEntryExecution(execution)) {
      return {
        ...execution,
        positionId: null,
        positionStatus: null,
        positionOpenedAt: null,
        protectionState: 'not_required',
        protectionCheckedAt: nowIso,
        protectionLastError: null,
        note: this.appendExecutionNote(
          execution.note,
          'Terminal unfilled entry order is not eligible for automatic SL/TP protection repair.'
        ),
      };
    }

    const position = this.selectBestPositionCandidate(trade, execution, positionSnapshots);
    const hasActivePosition = this.isActivePositionSnapshot(position);
    const terminalForProtection = this.isTerminalExecutionForProtection(execution);
    const brokerKey = this.readStringValue(execution.brokerKey)?.toLowerCase() ?? null;
    if (
      terminalForProtection &&
      !hasActivePosition &&
      protectionState !== 'attached' &&
      protectionState !== 'not_required'
    ) {
      return {
        ...execution,
        protectionState: 'not_required',
        protectionCheckedAt: nowIso,
        protectionLastError: null,
        note: this.appendExecutionNote(
          execution.note,
          'Terminal execution no longer requires manual SL/TP protection.'
        ),
      };
    }

    if (protectionState === 'attached') {
      if (brokerKey === 'delta_exchange' && hasActivePosition && position) {
        return this.validateAttachedDeltaLiveProtection(userId, trade, execution, position, nowIso);
      }
      if (!hasActivePosition && terminalForProtection) {
        return {
          ...execution,
          protectionState: 'not_required',
          protectionCheckedAt: nowIso,
          protectionLastError: null,
          note: this.appendExecutionNote(
            execution.note,
            'Terminal execution no longer requires manual SL/TP protection.'
          ),
        };
      }
      return execution;
    }

    const shouldRetryNotRequired =
      protectionState === 'not_required' &&
      (hasActivePosition || (this.isExecutionOrderFilled(execution) && !terminalForProtection));
    if (protectionState === 'not_required' && !shouldRetryNotRequired) {
      return execution;
    }

    const prices = this.resolveExecutionProtectionPrices(trade, execution);
    if (
      protectionState === 'failed' &&
      !this.isRetriableProtectionFailure(execution) &&
      !this.isDeltaReplacementProtectionFailure(execution)
    ) {
      if (brokerKey === 'delta_exchange' && hasActivePosition && position) {
        const accountId = this.readStringValue(execution.accountId);
        const orderId = this.readStringValue(execution.orderId);
        if (accountId && orderId) {
          const existingProtection = await this.resolveLiveProtectionOrderContext(
            userId,
            trade.id,
            brokerKey,
            accountId,
            orderId,
            position.payload ?? {}
          );
          if (this.hasUsableDeltaProtectionContext(existingProtection, execution, position)) {
            return this.markProtectionAttached(
              trade,
              execution,
              nowIso,
              'Delta Exchange linked SL/TP protection snapshots are active after reconciliation.',
              {
                positionId: position.externalId,
                stopLossOrderId: existingProtection.stopLossOrderId,
                takeProfitOrderId: existingProtection.takeProfitOrderId,
              }
            );
          }
        }
      }
      if (brokerKey === 'mudrex' && hasActivePosition && position?.payload && prices) {
        const actualEntryPrice = this.resolvePositionEntryPrice(position.payload, execution);
        const requestedEntryPrice = prices.requestedEntryPrice ?? actualEntryPrice;
        const stopLossPrice =
          actualEntryPrice && requestedEntryPrice
            ? this.deriveScaledProtectionPrice(
                actualEntryPrice,
                requestedEntryPrice,
                prices.stopLossPrice
              )
            : String(prices.stopLossPrice);
        const takeProfitPrice =
          actualEntryPrice && requestedEntryPrice
            ? this.deriveScaledProtectionPrice(
                actualEntryPrice,
                requestedEntryPrice,
                prices.takeProfitPrice
              )
            : String(prices.takeProfitPrice);
        const manualMessage = validateMudrexProtectionAttachability(
          trade,
          position.payload,
          stopLossPrice,
          takeProfitPrice
        );
        if (manualMessage) {
          return this.remediateMudrexLiveProtection({
            userId,
            trade,
            execution,
            position,
            prices,
            nowIso,
            brokerKey,
            accountId: this.readStringValue(execution.accountId) ?? '',
          });
        }
      }
      return execution;
    }

    if (protectionState === 'manual_unlinked') {
      return this.maybeRecoverManualUnlinkedProtection(userId, trade, execution, position, nowIso);
    }

    if (!prices) {
      if (hasActivePosition && protectionState) {
        return this.markProtectionManualUnlinked(
          execution,
          nowIso,
          'Open live position is missing broker SL/TP protection, but no stored SL/TP plan is available for automatic attachment.'
        );
      }

      return {
        ...execution,
        protectionState: 'not_required',
        protectionCheckedAt: nowIso,
        protectionLastError: null,
      };
    }

    if (terminalForProtection && !hasActivePosition) {
      return {
        ...execution,
        protectionState: 'not_required',
        protectionCheckedAt: nowIso,
        protectionLastError: null,
      };
    }

    if (!position) {
      return {
        ...execution,
        protectionState: this.isExecutionOrderFilled(execution)
          ? 'waiting_for_position'
          : 'waiting_for_fill',
        protectionCheckedAt: nowIso,
        protectionLastError: null,
      };
    }

    const accountId = this.readStringValue(execution.accountId);
    if (!brokerKey || !accountId) {
      return this.markProtectionFailed(
        execution,
        nowIso,
        'Protection remediation needs broker/account routing on the execution row.'
      );
    }

    const attachingExecution = await this.persistLiveProtectionAttachmentStarted(
      userId,
      trade,
      execution,
      position,
      nowIso,
      brokerKey,
      accountId
    );

    if (brokerKey === 'mudrex') {
      return this.remediateMudrexLiveProtection({
        userId,
        trade,
        execution: attachingExecution,
        position,
        prices,
        nowIso,
        brokerKey,
        accountId,
      });
    }

    if (brokerKey === 'delta_exchange') {
      return this.remediateDeltaLiveProtection({
        userId,
        trade,
        execution: attachingExecution,
        position,
        prices,
        nowIso,
        brokerKey,
        accountId,
      });
    }

    return this.markProtectionFailed(
      attachingExecution,
      nowIso,
      `Protection remediation is not supported for broker ${brokerKey}.`
    );
  }

  private async maybeApplyLiveTrailingStop(
    userId: string,
    trade: SuggestedTrade,
    execution: SuggestedTradeExecutionLink,
    positionSnapshots: LivePositionSnapshot[]
  ): Promise<SuggestedTradeExecutionLink> {
    if (execution.executionMode !== 'live') {
      return execution;
    }
    if (this.normalizeProtectionState(execution.protectionState) !== 'attached') {
      return execution;
    }

    const config = this.resolveExecutionTrailingStopConfig(trade, execution);
    if (!config) {
      return execution;
    }

    const brokerKey = this.readStringValue(execution.brokerKey)?.toLowerCase() ?? null;
    const accountId = this.readStringValue(execution.accountId);
    if (!brokerKey || !accountId) {
      return this.recordTrailingStopError(
        trade,
        execution,
        new Date().toISOString(),
        'Trailing SL update needs broker/account routing on the execution row.'
      );
    }

    const position = this.selectBestPositionCandidate(trade, execution, positionSnapshots, {
      allowPositionEvidenceFill: true,
    });
    if (!this.isActivePositionSnapshot(position) || !position) {
      return execution;
    }

    const payload = position.payload ?? {};
    const currentPrice = this.resolvePositionCurrentPrice(payload);
    const entryPrice =
      config.basis === 'planned_entry'
        ? (this.readNumberValue(execution.entryPrice) ?? this.readNumberValue(trade.entryPrice))
        : this.resolvePositionEntryPrice(payload, execution);
    const side = String(trade.side || '').toUpperCase() === 'SELL' ? 'short' : 'long';
    const originalStopLossPrice = this.resolveTrailingOriginalStopLossPrice(
      trade,
      execution,
      payload,
      {
        basis: config.basis,
        entryPrice,
        side,
      }
    );
    const currentStopLossPrice = this.resolveTrailingCurrentStopLossPrice(execution, payload);
    const takeProfitPrice = this.resolveTrailingTakeProfitPrice(trade, execution, payload);
    const trailingState = this.readRecordValue(
      this.readRecordValue(execution.protectionPlan)?.trailingStop
    );
    const lastAppliedWhenProfitR = this.readNumberValue(trailingState?.lastAppliedWhenProfitR);
    const peakProfitR = this.readNumberValue(trailingState?.peakProfitR);
    const lastAppliedMoveStopToR = this.readNumberValue(trailingState?.lastMoveStopToR);

    if (!(entryPrice && originalStopLossPrice && currentPrice && takeProfitPrice)) {
      return execution;
    }

    const move = evaluateCustomRLadderTrailingStopMove({
      side,
      config,
      entryPrice,
      originalStopLossPrice,
      currentPrice,
      currentStopLossPrice,
      peakProfitR,
      lastAppliedWhenProfitR,
      lastAppliedMoveStopToR,
    });
    if (move.action !== 'move') {
      return this.clearTrailingStopErrorWhenNoMoveNeeded(
        execution,
        config,
        new Date().toISOString(),
        move.reason,
        move.profitR,
        currentPrice,
        currentStopLossPrice
      );
    }

    if (!this.isTrailingStopMoveSafeAgainstCurrentPrice(move, currentPrice)) {
      return execution;
    }

    const brokerSupport = this.resolveCustomRLadderTrailingStopBrokerSupport(brokerKey);
    if (!brokerSupport.supported) {
      return this.recordTrailingStopError(
        trade,
        execution,
        new Date().toISOString(),
        brokerSupport.reason
      );
    }

    const positionsAdapter = this.brokerRuntimeRegistry?.getPositionsAdapter?.(brokerKey) as {
      createRiskOrder?: (
        positionId: string,
        body: Record<string, unknown>,
        context?: { userId?: string; brokerKey?: string; accountId?: string }
      ) => Promise<unknown>;
      updateRiskOrder?: (
        positionId: string,
        body: Record<string, unknown>,
        context?: { userId?: string; brokerKey?: string; accountId?: string }
      ) => Promise<unknown>;
    };
    if (!positionsAdapter?.createRiskOrder && !positionsAdapter?.updateRiskOrder) {
      return this.recordTrailingStopError(
        trade,
        execution,
        new Date().toISOString(),
        'Trailing SL update needs a broker positions adapter that can create or update risk orders.'
      );
    }

    const riskOrderPositionId = this.resolveTrailingRiskOrderPositionId(
      brokerKey,
      execution,
      position,
      payload
    );
    if (!riskOrderPositionId) {
      return this.recordTrailingStopError(
        trade,
        execution,
        new Date().toISOString(),
        'Trailing SL update could not resolve the broker position id for risk-order replacement.'
      );
    }

    const nowIso = new Date().toISOString();
    const stopLossPrice = this.formatNumericString(move.targetStopLossPrice);
    const formattedTakeProfitPrice = this.formatNumericString(takeProfitPrice);
    if (!stopLossPrice || !formattedTakeProfitPrice) {
      return this.recordTrailingStopError(
        trade,
        execution,
        nowIso,
        'Trailing SL update could not format the replacement SL/TP prices.'
      );
    }

    const plan = this.readRecordValue(execution.protectionPlan) ?? {};
    const protectionMode = this.readStringValue(plan.protectionMode);
    if (brokerKey === 'delta_exchange' && this.hasPendingDeltaBracketAmendment(execution)) {
      return this.touchPendingDeltaBracketAmendment(execution, config, nowIso);
    }

    if (brokerKey === 'delta_exchange' && protectionMode === 'native_bracket') {
      const ordersAdapter = this.brokerRuntimeRegistry?.getOrdersAdapter?.(brokerKey) as {
        updateLiveAutoBracketProtection?: (
          assetId: string,
          body: Record<string, unknown>,
          context?: { userId?: string; brokerKey?: string; accountId?: string }
        ) => Promise<unknown>;
      };
      if (!ordersAdapter?.updateLiveAutoBracketProtection) {
        return this.recordTrailingStopError(
          trade,
          execution,
          nowIso,
          'Trailing SL update needs Delta native bracket amendment support.'
        );
      }
      const entryOrderId = this.readStringValue(execution.orderId);
      if (!entryOrderId) {
        return this.recordTrailingStopError(
          trade,
          execution,
          nowIso,
          'Trailing SL update needs the Delta entry order id for native bracket amendment.'
        );
      }

      try {
        const protection = await this.resolveLiveProtectionOrderContext(
          userId,
          trade.id,
          brokerKey,
          accountId,
          entryOrderId,
          payload
        );
        if (!this.hasUsableDeltaProtectionContext(protection, execution, position)) {
          return this.recordTrailingStopError(
            trade,
            execution,
            nowIso,
            `Trailing SL update needs active Delta native bracket protection before amendment (${describeLiveProtectionOrderContext(
              protection
            )}).`
          );
        }
        const route = await this.resolveLiveAutoAssetRoute(brokerKey, trade.symbol);
        await ordersAdapter.updateLiveAutoBracketProtection(
          route.assetId,
          {
            orderId: entryOrderId,
            stopLossPrice: Number(stopLossPrice),
            takeProfitPrice: Number(formattedTakeProfitPrice),
          },
          { userId, brokerKey, accountId }
        );
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return this.recordTrailingStopError(
          trade,
          execution,
          nowIso,
          `Trailing SL update failed: ${errorMessage}`
        );
      }

      const existingTrailing = this.readRecordValue(plan.trailingStop) ?? {};
      const history = Array.isArray(existingTrailing.history) ? existingTrailing.history : [];
      const previousStopLossPrice =
        this.formatNumericString(currentStopLossPrice) ??
        this.formatNumericString(this.readNumberValue(plan.attachedStopLossPrice)) ??
        this.readStringValue(plan.attachedStopLossPrice) ??
        null;
      const trailingStop = {
        ...config,
        originalStopLossPrice:
          this.readNumberValue(existingTrailing.originalStopLossPrice) ?? originalStopLossPrice,
        pendingWhenProfitR: move.rule.whenProfitR,
        pendingMoveStopToR: move.lockedProfitR,
        pendingStopLossPrice: stopLossPrice,
        pendingTakeProfitPrice: formattedTakeProfitPrice,
        lastCurrentPrice: this.formatNumericString(currentPrice) ?? currentPrice,
        lastProfitR: Number(move.profitR.toFixed(6)),
        peakProfitR: Number(move.peakProfitR.toFixed(6)),
        lastCheckedAt: nowIso,
        lastSubmittedAt: nowIso,
        lastNoopReason: 'bracket_amendment_pending_confirmation',
        lastError: null,
        history: [
          ...history.slice(-9),
          {
            at: nowIso,
            status: 'pending_confirmation',
            whenProfitR: move.rule.whenProfitR,
            moveStopToR: move.lockedProfitR,
            ...(move.rule.trailDistanceR
              ? {
                  trailDistanceR: move.rule.trailDistanceR,
                  peakProfitR: Number(move.peakProfitR.toFixed(6)),
                }
              : {}),
            stopLossPrice,
            previousStopLossPrice,
            currentPrice: this.formatNumericString(currentPrice) ?? currentPrice,
            profitR: Number(move.profitR.toFixed(6)),
            positionId: riskOrderPositionId,
            snapshotPositionId: position.externalId,
            protectionMode,
          },
        ],
      };
      const note = move.rule.trailDistanceR
        ? `Trailing SL moved to ${stopLossPrice} after observed peak ${Number(
            move.peakProfitR.toFixed(6)
          )}R; Delta native bracket amendment submitted.`
        : `Trailing SL moved to ${stopLossPrice} after price crossed ${move.rule.whenProfitR}R; Delta native bracket amendment submitted.`;

      await this.operationalEventService?.logActivity?.(userId, {
        type: 'Suggested Trade',
        title: `Trailing SL updated: ${trade.symbol}`,
        status: 'Success',
        route: 'Suggested Trades',
        stream: 'Execution',
        related: `${brokerKey} · ${accountId}`,
        referenceId: trade.id,
        symbol: trade.symbol,
        description: note,
      });

      return {
        ...execution,
        protectionCheckedAt: nowIso,
        protectionLastError: null,
        protectionPlan: {
          ...plan,
          source: 'suggested_trade_execution',
          symbol: trade.symbol,
          side: trade.side,
          timeframe: trade.timeframe,
          brokerKey,
          accountId,
          positionId: riskOrderPositionId,
          snapshotPositionId: position.externalId,
          protectionMode,
          bracketStatus: 'amendment_pending_confirmation',
          bracketAmendmentStatus: 'pending_confirmation',
          pendingBracketStopLossPrice: stopLossPrice,
          pendingBracketTakeProfitPrice: formattedTakeProfitPrice,
          pendingBracketAmendedAt: nowIso,
          lastBracketAmendmentSubmittedAt: nowIso,
          bracketTakeProfitPrice: plan.bracketTakeProfitPrice ?? formattedTakeProfitPrice,
          attachedTakeProfitPrice: plan.attachedTakeProfitPrice ?? formattedTakeProfitPrice,
          trailingStop,
        },
        note: this.appendExecutionNote(execution.note, note),
      };
    }

    if (brokerKey === 'delta_exchange') {
      return this.recordTrailingStopError(
        trade,
        execution,
        nowIso,
        'Trailing SL update requires Delta native bracket protection; independent reduce-only SL/TP replacement is disabled.'
      );
    }

    const riskOrderIds = await this.resolveTrailingRiskOrderIdsForLiveUpdate(
      userId,
      trade,
      execution,
      brokerKey,
      accountId,
      payload
    );
    let riskOrderMutationResult: unknown = null;
    try {
      if (
        positionsAdapter.updateRiskOrder &&
        riskOrderIds.stopLossOrderId &&
        riskOrderIds.takeProfitOrderId
      ) {
        riskOrderMutationResult = await positionsAdapter.updateRiskOrder(
          riskOrderPositionId,
          {
            order_price: entryPrice,
            stoploss_price: Number(stopLossPrice),
            takeprofit_price: Number(formattedTakeProfitPrice),
            stoploss_order_id: riskOrderIds.stopLossOrderId,
            takeprofit_order_id: riskOrderIds.takeProfitOrderId,
            trigger_type: riskOrderIds.triggerType ?? 'MARKET',
            is_stoploss: true,
            is_takeprofit: true,
          },
          {
            userId,
            brokerKey,
            accountId,
          }
        );
      } else if (positionsAdapter.createRiskOrder) {
        riskOrderMutationResult = await positionsAdapter.createRiskOrder(
          riskOrderPositionId,
          {
            stoploss_price: stopLossPrice,
            takeprofit_price: formattedTakeProfitPrice,
            order_source: 'positions_desk',
            is_stoploss: true,
            is_takeprofit: true,
          },
          {
            userId,
            brokerKey,
            accountId,
          }
        );
      } else {
        return this.recordTrailingStopError(
          trade,
          execution,
          nowIso,
          'Trailing SL update found broker risk-order IDs, but the positions adapter cannot update risk orders.'
        );
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (this.isTrailingStopPositionGoneError(brokerKey, errorMessage)) {
        return this.clearTrailingStopErrorWhenPositionGone(
          execution,
          config,
          nowIso,
          move.profitR,
          currentPrice,
          currentStopLossPrice
        );
      }
      return this.recordTrailingStopError(
        trade,
        execution,
        nowIso,
        `Trailing SL update failed: ${errorMessage}`
      );
    }

    const responseRiskOrderIds =
      this.resolveTrailingRiskOrderIdsFromMutationResult(riskOrderMutationResult);
    const appliedStopLossOrderId =
      responseRiskOrderIds.stopLossOrderId ??
      riskOrderIds.stopLossOrderId ??
      this.readStringValue(plan.stopLossOrderId);
    const appliedTakeProfitOrderId =
      responseRiskOrderIds.takeProfitOrderId ??
      riskOrderIds.takeProfitOrderId ??
      this.readStringValue(plan.takeProfitOrderId);
    const existingTrailing = this.readRecordValue(plan.trailingStop) ?? {};
    const history = Array.isArray(existingTrailing.history) ? existingTrailing.history : [];
    const trailingStop = {
      ...config,
      originalStopLossPrice:
        this.readNumberValue(existingTrailing.originalStopLossPrice) ?? originalStopLossPrice,
      lastAppliedWhenProfitR: move.rule.whenProfitR,
      lastMoveStopToR: move.lockedProfitR,
      lastStopLossPrice: stopLossPrice,
      lastCurrentPrice: this.formatNumericString(currentPrice) ?? currentPrice,
      lastProfitR: Number(move.profitR.toFixed(6)),
      peakProfitR: Number(move.peakProfitR.toFixed(6)),
      lastCheckedAt: nowIso,
      lastUpdatedAt: nowIso,
      lastError: null,
      history: [
        ...history.slice(-9),
        {
          at: nowIso,
          whenProfitR: move.rule.whenProfitR,
          moveStopToR: move.lockedProfitR,
          ...(move.rule.trailDistanceR
            ? {
                trailDistanceR: move.rule.trailDistanceR,
                peakProfitR: Number(move.peakProfitR.toFixed(6)),
              }
            : {}),
          stopLossPrice,
          currentPrice: this.formatNumericString(currentPrice) ?? currentPrice,
          profitR: Number(move.profitR.toFixed(6)),
          positionId: riskOrderPositionId,
          stopLossOrderId: appliedStopLossOrderId,
          takeProfitOrderId: appliedTakeProfitOrderId,
          snapshotPositionId: position.externalId,
        },
      ],
    };
    const note = move.rule.trailDistanceR
      ? `Trailing SL moved to ${stopLossPrice} after observed peak ${Number(
          move.peakProfitR.toFixed(6)
        )}R; stop now trails by ${move.rule.trailDistanceR}R and locks ${Number(
          move.lockedProfitR.toFixed(6)
        )}R.`
      : `Trailing SL moved to ${stopLossPrice} after price crossed ${move.rule.whenProfitR}R; stop now locks ${move.lockedProfitR}R.`;

    await this.operationalEventService?.logActivity?.(userId, {
      type: 'Suggested Trade',
      title: `Trailing SL updated: ${trade.symbol}`,
      status: 'Success',
      route: 'Suggested Trades',
      stream: 'Execution',
      related: `${brokerKey} · ${accountId}`,
      referenceId: trade.id,
      symbol: trade.symbol,
      description: note,
    });

    return {
      ...execution,
      stopLossPrice,
      takeProfitPrice: execution.takeProfitPrice ?? formattedTakeProfitPrice,
      protectionCheckedAt: nowIso,
      protectionLastError: null,
      protectionPlan: {
        ...plan,
        source: 'suggested_trade_execution',
        symbol: trade.symbol,
        side: trade.side,
        timeframe: trade.timeframe,
        brokerKey,
        accountId,
        positionId: riskOrderPositionId,
        snapshotPositionId: position.externalId,
        stopLossOrderId: appliedStopLossOrderId ?? plan.stopLossOrderId,
        takeProfitOrderId: appliedTakeProfitOrderId ?? plan.takeProfitOrderId,
        attachedStopLossPrice: stopLossPrice,
        attachedTakeProfitPrice: formattedTakeProfitPrice,
        trailingStop,
      },
      note: this.appendExecutionNote(execution.note, note),
    };
  }

  private hasPendingDeltaBracketAmendment(execution: SuggestedTradeExecutionLink): boolean {
    const plan = this.readRecordValue(execution.protectionPlan) ?? {};
    const protectionMode = this.readStringValue(plan.protectionMode)?.toLowerCase();
    if (protectionMode !== 'native_bracket') {
      return false;
    }

    const bracketStatus = this.readStringValue(plan.bracketStatus)?.toLowerCase();
    const amendmentStatus = this.readStringValue(plan.bracketAmendmentStatus)?.toLowerCase();
    return Boolean(
      bracketStatus === 'amendment_pending_confirmation' ||
      amendmentStatus === 'pending_confirmation' ||
      this.readStringValue(plan.pendingBracketStopLossPrice)
    );
  }

  private touchPendingDeltaBracketAmendment(
    execution: SuggestedTradeExecutionLink,
    config: CustomRLadderTrailingStopConfig,
    nowIso: string
  ): SuggestedTradeExecutionLink {
    const plan = this.readRecordValue(execution.protectionPlan) ?? {};
    const existingTrailing = this.readRecordValue(plan.trailingStop) ?? {};
    return {
      ...execution,
      protectionCheckedAt: nowIso,
      protectionPlan: {
        ...plan,
        bracketStatus: 'amendment_pending_confirmation',
        bracketAmendmentStatus: 'pending_confirmation',
        trailingStop: {
          ...config,
          ...existingTrailing,
          lastCheckedAt: nowIso,
          lastNoopReason: 'bracket_amendment_pending_confirmation',
          lastError: null,
        },
      },
    };
  }

  private reconcilePendingDeltaBracketAmendmentFromContext(
    execution: SuggestedTradeExecutionLink,
    context: LiveProtectionOrderContext,
    nowIso: string
  ): SuggestedTradeExecutionLink {
    if (!this.hasPendingDeltaBracketAmendment(execution)) {
      return execution;
    }

    const plan = this.readRecordValue(execution.protectionPlan) ?? {};
    const trailing = this.readRecordValue(plan.trailingStop) ?? {};
    const pendingStopLossPrice =
      this.readNumberValue(plan.pendingBracketStopLossPrice) ??
      this.readNumberValue(trailing.pendingStopLossPrice);
    if (!(pendingStopLossPrice && pendingStopLossPrice > 0)) {
      return execution;
    }

    const pendingTakeProfitPrice =
      this.readNumberValue(plan.pendingBracketTakeProfitPrice) ??
      this.readNumberValue(trailing.pendingTakeProfitPrice) ??
      this.readNumberValue(plan.attachedTakeProfitPrice) ??
      this.readNumberValue(plan.bracketTakeProfitPrice);
    const stopLossSnapshotPrice = context.stopLossOrderId
      ? this.resolveProtectionSnapshotStopPrice(context.orderDetails?.[context.stopLossOrderId])
      : null;
    const takeProfitSnapshotPrice = context.takeProfitOrderId
      ? this.resolveProtectionSnapshotStopPrice(context.orderDetails?.[context.takeProfitOrderId])
      : null;
    const stopLossConfirmed =
      stopLossSnapshotPrice !== null &&
      this.pricesApproximatelyEqual(stopLossSnapshotPrice, pendingStopLossPrice);
    const takeProfitMismatch = Boolean(
      pendingTakeProfitPrice !== null &&
      takeProfitSnapshotPrice !== null &&
      !this.pricesApproximatelyEqual(takeProfitSnapshotPrice, pendingTakeProfitPrice)
    );

    if (!stopLossConfirmed || takeProfitMismatch) {
      const takeProfitMessage = takeProfitMismatch
        ? ` Delta take-profit snapshot ${this.formatNumericString(takeProfitSnapshotPrice) ?? takeProfitSnapshotPrice} does not match expected unchanged TP ${
            this.formatNumericString(pendingTakeProfitPrice) ?? pendingTakeProfitPrice
          }.`
        : '';
      return {
        ...execution,
        protectionCheckedAt: nowIso,
        protectionLastError: takeProfitMismatch
          ? `Delta bracket amendment is pending broker snapshot confirmation.${takeProfitMessage}`
          : execution.protectionLastError,
        protectionPlan: {
          ...plan,
          bracketStatus: 'amendment_pending_confirmation',
          bracketAmendmentStatus: 'pending_confirmation',
          trailingStop: {
            ...trailing,
            lastCheckedAt: nowIso,
            lastNoopReason: 'bracket_amendment_pending_confirmation',
            lastError: takeProfitMismatch ? takeProfitMessage.trim() : null,
          },
        },
      };
    }

    const confirmedStopLossPrice =
      this.formatNumericString(pendingStopLossPrice) ?? String(pendingStopLossPrice);
    const confirmedTakeProfitPrice =
      pendingTakeProfitPrice !== null
        ? (this.formatNumericString(pendingTakeProfitPrice) ?? String(pendingTakeProfitPrice))
        : null;
    const pendingWhenProfitR = this.readNumberValue(trailing.pendingWhenProfitR);
    const pendingMoveStopToR = this.readNumberValue(trailing.pendingMoveStopToR);
    const history = Array.isArray(trailing.history) ? trailing.history : [];
    const pendingHistoryIndex = [...history]
      .map((item, index) => ({ item: this.readRecordValue(item), index }))
      .reverse()
      .find(({ item }) => {
        if (!item) {
          return false;
        }
        const status = this.readStringValue(item.status)?.toLowerCase();
        const itemStopLoss = this.readNumberValue(item.stopLossPrice);
        return (
          status === 'pending_confirmation' &&
          itemStopLoss !== null &&
          this.pricesApproximatelyEqual(itemStopLoss, pendingStopLossPrice)
        );
      })?.index;
    const nextHistory =
      pendingHistoryIndex === undefined
        ? history
        : history.map((item, index) =>
            index === pendingHistoryIndex
              ? {
                  ...(this.readRecordValue(item) ?? {}),
                  status: 'confirmed',
                  confirmedAt: nowIso,
                  snapshotStopLossPrice: confirmedStopLossPrice,
                  ...(confirmedTakeProfitPrice
                    ? { snapshotTakeProfitPrice: confirmedTakeProfitPrice }
                    : {}),
                }
              : item
          );

    return {
      ...execution,
      stopLossPrice: confirmedStopLossPrice,
      takeProfitPrice: execution.takeProfitPrice ?? confirmedTakeProfitPrice,
      protectionCheckedAt: nowIso,
      protectionLastError: null,
      protectionPlan: {
        ...plan,
        bracketStatus: 'amendment_confirmed',
        bracketAmendmentStatus: 'confirmed',
        bracketStopLossPrice: confirmedStopLossPrice,
        attachedStopLossPrice: confirmedStopLossPrice,
        ...(confirmedTakeProfitPrice
          ? {
              bracketTakeProfitPrice: confirmedTakeProfitPrice,
              attachedTakeProfitPrice: confirmedTakeProfitPrice,
            }
          : {}),
        pendingBracketStopLossPrice: null,
        pendingBracketTakeProfitPrice: null,
        pendingBracketAmendedAt: null,
        lastBracketAmendmentConfirmedAt: nowIso,
        trailingStop: {
          ...trailing,
          ...(pendingWhenProfitR !== null ? { lastAppliedWhenProfitR: pendingWhenProfitR } : {}),
          ...(pendingMoveStopToR !== null ? { lastMoveStopToR: pendingMoveStopToR } : {}),
          lastStopLossPrice: confirmedStopLossPrice,
          lastUpdatedAt: nowIso,
          lastConfirmedAt: nowIso,
          lastCheckedAt: nowIso,
          lastNoopReason: null,
          lastError: null,
          pendingWhenProfitR: null,
          pendingMoveStopToR: null,
          pendingStopLossPrice: null,
          pendingTakeProfitPrice: null,
          history: nextHistory,
        },
      },
    };
  }

  private resolveProtectionSnapshotStopPrice(
    detail:
      | {
          stopPrice?: number | null;
          limitPrice?: number | null;
        }
      | null
      | undefined
  ): number | null {
    return this.readNumberValue(detail?.stopPrice) ?? this.readNumberValue(detail?.limitPrice);
  }

  private pricesApproximatelyEqual(left: number, right: number): boolean {
    if (!Number.isFinite(left) || !Number.isFinite(right)) {
      return false;
    }
    return Math.abs(left - right) <= Math.max(1e-8, Math.abs(right) * 1e-8);
  }

  private resolveExecutionTrailingStopConfig(
    trade: SuggestedTrade,
    execution: SuggestedTradeExecutionLink
  ): CustomRLadderTrailingStopConfig | null {
    const plan = this.readRecordValue(execution.protectionPlan);
    const meta = this.readRecordValue(trade.meta);
    const tradeManagementSnapshot = this.readRecordValue(meta?.tradeManagementSnapshot);
    return resolveCustomRLadderTrailingStopConfigFromRecords(plan, tradeManagementSnapshot, meta);
  }

  private resolveProtectionPlanTrailingStop(
    trade: SuggestedTrade,
    execution: SuggestedTradeExecutionLink
  ): Record<string, unknown> | null {
    const plan = this.readRecordValue(execution.protectionPlan) ?? {};
    const existingTrailing = this.readRecordValue(plan.trailingStop);
    if (existingTrailing) {
      return existingTrailing;
    }

    const config = this.resolveExecutionTrailingStopConfig(trade, execution);
    if (!config) {
      return null;
    }

    return {
      ...config,
      rules: config.rules.map((rule) => ({ ...rule })),
    };
  }

  private resolveCustomRLadderTrailingStopBrokerSupport(
    brokerKey: string
  ): { supported: true } | { supported: false; reason: string } {
    const normalizedBrokerKey = String(brokerKey || '')
      .trim()
      .toLowerCase();
    if (normalizedBrokerKey === 'mudrex') {
      return { supported: true };
    }
    if (normalizedBrokerKey === 'delta_exchange') {
      if (!this.isProtectionRepairEnabledForBroker(normalizedBrokerKey)) {
        return {
          supported: false,
          reason:
            'Custom R ladder trailing SL is disabled for Delta Exchange by protection repair controls.',
        };
      }
      return { supported: true };
    }
    return {
      supported: false,
      reason: `Custom R ladder trailing SL is not supported for broker ${brokerKey}.`,
    };
  }

  private resolveTrailingRiskOrderPositionId(
    brokerKey: string,
    execution: SuggestedTradeExecutionLink,
    position: LivePositionSnapshot,
    positionPayload: Record<string, unknown>
  ): string | null {
    if (brokerKey === 'mudrex') {
      const plan = this.readRecordValue(execution.protectionPlan) ?? {};
      const payloadPositionId = resolveMudrexRiskOrderPositionId(position, positionPayload);
      const planPositionId = this.readStringValue(plan.positionId);
      const executionPositionId = this.readStringValue(execution.positionId);
      if (payloadPositionId && payloadPositionId !== position.externalId) {
        return payloadPositionId;
      }
      return (
        planPositionId ??
        executionPositionId ??
        payloadPositionId ??
        this.readStringValue(position.externalId)
      );
    }

    return this.readStringValue(position.externalId) ?? this.readStringValue(execution.positionId);
  }

  private resolveTrailingRiskOrderIds(
    execution: SuggestedTradeExecutionLink,
    positionPayload: Record<string, unknown>
  ): {
    stopLossOrderId: string | null;
    takeProfitOrderId: string | null;
    triggerType: string | null;
  } {
    const plan = this.readRecordValue(execution.protectionPlan) ?? {};
    const positionOrderIds = this.resolveProtectionOrderIdsFromPositionPayload(positionPayload);
    const stopLossOrderId =
      this.readStringValue(plan.stopLossOrderId) ??
      this.readStringValue(plan.stoplossOrderId) ??
      this.readStringValue(plan.stoploss_order_id) ??
      positionOrderIds.stopLossOrderId;
    const takeProfitOrderId =
      this.readStringValue(plan.takeProfitOrderId) ??
      this.readStringValue(plan.takeprofitOrderId) ??
      this.readStringValue(plan.takeprofit_order_id) ??
      positionOrderIds.takeProfitOrderId;
    const stopLoss = this.readRecordValue(positionPayload.stoploss) ?? {};
    const takeProfit = this.readRecordValue(positionPayload.takeprofit) ?? {};
    const triggerType =
      this.readStringValue(plan.triggerType) ??
      this.readStringValue(plan.trigger_type) ??
      this.readStringValue(positionPayload.trigger_type) ??
      this.readStringValue(positionPayload.triggerType) ??
      this.readStringValue(stopLoss.trigger_type) ??
      this.readStringValue(stopLoss.triggerType) ??
      this.readStringValue(takeProfit.trigger_type) ??
      this.readStringValue(takeProfit.triggerType);

    return {
      stopLossOrderId,
      takeProfitOrderId,
      triggerType,
    };
  }

  private async resolveTrailingRiskOrderIdsForLiveUpdate(
    userId: string,
    trade: SuggestedTrade,
    execution: SuggestedTradeExecutionLink,
    brokerKey: string,
    accountId: string,
    positionPayload: Record<string, unknown>
  ): Promise<{
    stopLossOrderId: string | null;
    takeProfitOrderId: string | null;
    triggerType: string | null;
  }> {
    const fallback = this.resolveTrailingRiskOrderIds(execution, positionPayload);
    if (brokerKey !== 'delta_exchange') {
      return fallback;
    }

    const orderId = this.readStringValue(execution.orderId);
    if (!orderId) {
      return fallback;
    }

    const protection = await this.resolveLiveProtectionOrderContext(
      userId,
      trade.id,
      brokerKey,
      accountId,
      orderId,
      positionPayload
    );
    if (
      !this.hasUsableDeltaProtectionContext(protection, execution, {
        payload: positionPayload,
      })
    ) {
      return fallback;
    }

    return {
      stopLossOrderId: protection.stopLossOrderId,
      takeProfitOrderId: protection.takeProfitOrderId,
      triggerType: fallback.triggerType,
    };
  }

  private resolveProtectionOrderIdsFromPositionPayload(positionPayload: Record<string, unknown>): {
    stopLossOrderId: string | null;
    takeProfitOrderId: string | null;
  } {
    const stopLoss = this.readRecordValue(positionPayload.stoploss) ?? {};
    const stopLossAlt = this.readRecordValue(positionPayload.stopLoss) ?? {};
    const stopLossSnake = this.readRecordValue(positionPayload.stop_loss) ?? {};
    const takeProfit = this.readRecordValue(positionPayload.takeprofit) ?? {};
    const takeProfitAlt = this.readRecordValue(positionPayload.takeProfit) ?? {};
    const takeProfitSnake = this.readRecordValue(positionPayload.take_profit) ?? {};

    return {
      stopLossOrderId:
        this.readStringValue(positionPayload.stoploss_order_id) ??
        this.readStringValue(positionPayload.stopLossOrderId) ??
        this.readStringValue(positionPayload.stop_loss_order_id) ??
        this.readStringValue(stopLoss.order_id) ??
        this.readStringValue(stopLoss.orderId) ??
        this.readStringValue(stopLossAlt.order_id) ??
        this.readStringValue(stopLossAlt.orderId) ??
        this.readStringValue(stopLossSnake.order_id) ??
        this.readStringValue(stopLossSnake.orderId),
      takeProfitOrderId:
        this.readStringValue(positionPayload.takeprofit_order_id) ??
        this.readStringValue(positionPayload.takeProfitOrderId) ??
        this.readStringValue(positionPayload.take_profit_order_id) ??
        this.readStringValue(takeProfit.order_id) ??
        this.readStringValue(takeProfit.orderId) ??
        this.readStringValue(takeProfitAlt.order_id) ??
        this.readStringValue(takeProfitAlt.orderId) ??
        this.readStringValue(takeProfitSnake.order_id) ??
        this.readStringValue(takeProfitSnake.orderId),
    };
  }

  private resolveTrailingRiskOrderIdsFromMutationResult(result: unknown): {
    stopLossOrderId: string | null;
    takeProfitOrderId: string | null;
  } {
    const record = this.readRecordValue(result);
    if (!record) {
      return { stopLossOrderId: null, takeProfitOrderId: null };
    }

    const data = this.readRecordValue(record.data) ?? {};
    let stopLossOrderId =
      this.readStringValue(record.stop_loss_order_id) ??
      this.readStringValue(record.stoploss_order_id) ??
      this.readStringValue(record.stopLossOrderId) ??
      this.readStringValue(record.stoplossOrderId) ??
      this.readStringValue(data.stop_loss_order_id) ??
      this.readStringValue(data.stoploss_order_id) ??
      this.readStringValue(data.stopLossOrderId) ??
      this.readStringValue(data.stoplossOrderId);
    let takeProfitOrderId =
      this.readStringValue(record.take_profit_order_id) ??
      this.readStringValue(record.takeprofit_order_id) ??
      this.readStringValue(record.takeProfitOrderId) ??
      this.readStringValue(record.takeprofitOrderId) ??
      this.readStringValue(data.take_profit_order_id) ??
      this.readStringValue(data.takeprofit_order_id) ??
      this.readStringValue(data.takeProfitOrderId) ??
      this.readStringValue(data.takeprofitOrderId);

    const protectiveOrders = Array.isArray(record.protective_orders)
      ? record.protective_orders
      : Array.isArray(data.protective_orders)
        ? data.protective_orders
        : [];
    for (const item of protectiveOrders) {
      const order = this.readRecordValue(item);
      if (!order) continue;
      const kind = String(order.kind ?? order.type ?? order.stop_order_type ?? '')
        .trim()
        .toLowerCase();
      const orderId =
        this.readStringValue(order.order_id) ??
        this.readStringValue(order.orderId) ??
        this.readStringValue(order.id);
      if (!orderId) continue;
      if (!stopLossOrderId && (kind === 'stop_loss' || kind === 'stop_loss_order')) {
        stopLossOrderId = orderId;
      }
      if (!takeProfitOrderId && (kind === 'take_profit' || kind === 'take_profit_order')) {
        takeProfitOrderId = orderId;
      }
    }

    return { stopLossOrderId, takeProfitOrderId };
  }

  private resolveTrailingOriginalStopLossPrice(
    trade: SuggestedTrade,
    execution: SuggestedTradeExecutionLink,
    positionPayload: Record<string, unknown>,
    options?: {
      basis?: CustomRLadderTrailingStopConfig['basis'];
      entryPrice?: number | null;
      side?: 'long' | 'short';
    }
  ): number | null {
    const plan = this.readRecordValue(execution.protectionPlan) ?? {};
    const trailing = this.readRecordValue(plan.trailingStop) ?? {};
    const stickyOriginalStopLossPrice = this.readNumberValue(trailing.originalStopLossPrice);
    if (stickyOriginalStopLossPrice !== null) {
      return stickyOriginalStopLossPrice;
    }

    const positionStopLossPrice = this.resolvePositionStopLossPrice(positionPayload);
    const plannedStopLossCandidates = [
      this.readNumberValue(plan.originalStopLossPrice),
      this.readNumberValue(plan.initialStopLossPrice),
      this.readNumberValue(plan.stopLossPrice),
      this.readNumberValue(execution.stopLossPrice),
      this.readNumberValue(trade.stopLossPrice),
      this.readNumberValue(plan.attachedStopLossPrice),
    ].filter((value): value is number => value !== null);

    if (options?.basis === 'actual_fill' && options.entryPrice && options.side) {
      const directionalPositionStopLoss = this.isStopLossDirectionalForSide(
        options.side,
        options.entryPrice,
        positionStopLossPrice
      )
        ? positionStopLossPrice
        : null;
      const directionalPlannedStopLoss = plannedStopLossCandidates.find((value) =>
        this.isStopLossDirectionalForSide(options.side!, options.entryPrice!, value)
      );
      return (
        directionalPositionStopLoss ??
        directionalPlannedStopLoss ??
        plannedStopLossCandidates[0] ??
        positionStopLossPrice ??
        null
      );
    }

    return plannedStopLossCandidates[0] ?? positionStopLossPrice ?? null;
  }

  private isStopLossDirectionalForSide(
    side: 'long' | 'short',
    entryPrice: number,
    stopLossPrice: number | null
  ): stopLossPrice is number {
    if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
      return false;
    }
    if (stopLossPrice === null || !Number.isFinite(stopLossPrice) || stopLossPrice <= 0) {
      return false;
    }
    return side === 'short' ? stopLossPrice > entryPrice : stopLossPrice < entryPrice;
  }

  private resolveTrailingCurrentStopLossPrice(
    execution: SuggestedTradeExecutionLink,
    positionPayload: Record<string, unknown>
  ): number | null {
    const plan = this.readRecordValue(execution.protectionPlan) ?? {};
    const trailing = this.readRecordValue(plan.trailingStop) ?? {};
    return (
      this.resolvePositionStopLossPrice(positionPayload) ??
      this.readNumberValue(trailing.lastStopLossPrice) ??
      this.readNumberValue(execution.stopLossPrice) ??
      this.readNumberValue(plan.attachedStopLossPrice) ??
      this.readNumberValue(plan.stopLossPrice)
    );
  }

  private resolveTrailingTakeProfitPrice(
    trade: SuggestedTrade,
    execution: SuggestedTradeExecutionLink,
    positionPayload: Record<string, unknown>
  ): number | null {
    const plan = this.readRecordValue(execution.protectionPlan) ?? {};
    return (
      this.resolvePositionTakeProfitPrice(positionPayload) ??
      this.readNumberValue(plan.attachedTakeProfitPrice) ??
      this.readNumberValue(plan.takeProfitPrice) ??
      this.readNumberValue(execution.takeProfitPrice) ??
      this.readNumberValue(
        Array.isArray(trade.takeProfitTargets) ? trade.takeProfitTargets[0] : null
      )
    );
  }

  private resolvePositionStopLossPrice(payload: Record<string, unknown>): number | null {
    return (
      this.readNumberValue(payload.stoploss_price) ??
      this.readNumberValue(payload.stopLossPrice) ??
      this.readNumberValue(payload.stop_loss_price) ??
      this.readNumberValue(this.readRecordValue(payload.stoploss)?.price) ??
      this.readNumberValue(this.readRecordValue(payload.stopLoss)?.price) ??
      this.readNumberValue(this.readRecordValue(payload.stop_loss)?.price)
    );
  }

  private resolvePositionTakeProfitPrice(payload: Record<string, unknown>): number | null {
    return (
      this.readNumberValue(payload.takeprofit_price) ??
      this.readNumberValue(payload.takeProfitPrice) ??
      this.readNumberValue(payload.take_profit_price) ??
      this.readNumberValue(this.readRecordValue(payload.takeprofit)?.price) ??
      this.readNumberValue(this.readRecordValue(payload.takeProfit)?.price) ??
      this.readNumberValue(this.readRecordValue(payload.take_profit)?.price)
    );
  }

  private isTrailingStopMoveSafeAgainstCurrentPrice(
    move: CustomRLadderTrailingStopMove,
    currentPrice: number
  ): boolean {
    return move.side === 'short'
      ? move.targetStopLossPrice > currentPrice
      : move.targetStopLossPrice < currentPrice;
  }

  private recordTrailingStopError(
    trade: SuggestedTrade,
    execution: SuggestedTradeExecutionLink,
    nowIso: string,
    message: string
  ): SuggestedTradeExecutionLink {
    const plan = this.readRecordValue(execution.protectionPlan) ?? {};
    const existingTrailing = this.readRecordValue(plan.trailingStop) ?? {};
    const config = this.resolveExecutionTrailingStopConfig(trade, execution);
    return {
      ...execution,
      protectionCheckedAt: nowIso,
      protectionLastError: message,
      protectionPlan: {
        ...plan,
        trailingStop: {
          ...(config ?? {}),
          ...existingTrailing,
          lastCheckedAt: nowIso,
          lastError: message,
        },
      },
      note: this.appendExecutionNote(execution.note, message),
    };
  }

  private clearTrailingStopErrorWhenNoMoveNeeded(
    execution: SuggestedTradeExecutionLink,
    config: CustomRLadderTrailingStopConfig,
    nowIso: string,
    reason: string,
    profitR: number | null | undefined,
    currentPrice: number,
    currentStopLossPrice: number | null
  ): SuggestedTradeExecutionLink {
    const priorError = String(execution.protectionLastError || '').trim();
    if (
      !priorError.toLowerCase().startsWith('trailing sl update failed') ||
      !['already_applied', 'would_move_backward', 'no_rule_crossed'].includes(reason)
    ) {
      return execution;
    }

    const plan = this.readRecordValue(execution.protectionPlan) ?? {};
    const existingTrailing = this.readRecordValue(plan.trailingStop) ?? {};
    return {
      ...execution,
      protectionCheckedAt: nowIso,
      protectionLastError: null,
      protectionPlan: {
        ...plan,
        trailingStop: {
          ...config,
          ...existingTrailing,
          lastCheckedAt: nowIso,
          lastCurrentPrice: this.formatNumericString(currentPrice) ?? currentPrice,
          lastStopLossPrice:
            this.formatNumericString(currentStopLossPrice) ?? currentStopLossPrice ?? null,
          lastProfitR: typeof profitR === 'number' ? Number(profitR.toFixed(6)) : null,
          lastNoopReason: reason,
          lastError: null,
        },
      },
    };
  }

  private isTrailingStopPositionGoneError(brokerKey: string, message: string): boolean {
    if (brokerKey !== 'delta_exchange') {
      return false;
    }
    const normalized = String(message || '').toLowerCase();
    return (
      normalized.includes('position not found') || normalized.includes('position size is zero')
    );
  }

  private clearTrailingStopErrorWhenPositionGone(
    execution: SuggestedTradeExecutionLink,
    config: CustomRLadderTrailingStopConfig,
    nowIso: string,
    profitR: number | null | undefined,
    currentPrice: number,
    currentStopLossPrice: number | null
  ): SuggestedTradeExecutionLink {
    const plan = this.readRecordValue(execution.protectionPlan) ?? {};
    const existingTrailing = this.readRecordValue(plan.trailingStop) ?? {};
    return {
      ...execution,
      protectionCheckedAt: nowIso,
      protectionLastError: null,
      protectionPlan: {
        ...plan,
        trailingStop: {
          ...config,
          ...existingTrailing,
          lastCheckedAt: nowIso,
          lastCurrentPrice: this.formatNumericString(currentPrice) ?? currentPrice,
          lastStopLossPrice:
            this.formatNumericString(currentStopLossPrice) ?? currentStopLossPrice ?? null,
          lastProfitR: typeof profitR === 'number' ? Number(profitR.toFixed(6)) : null,
          lastNoopReason: 'position_not_open',
          lastError: null,
        },
      },
    };
  }

  private async persistLiveProtectionAttachmentStarted(
    userId: string,
    trade: SuggestedTrade,
    execution: SuggestedTradeExecutionLink,
    position: LivePositionSnapshot,
    nowIso: string,
    brokerKey: string,
    accountId: string
  ): Promise<SuggestedTradeExecutionLink> {
    if (this.normalizeProtectionState(execution.protectionState) === 'attaching') {
      return execution;
    }

    const nextExecution = this.markProtectionAttachmentStarted(
      trade,
      execution,
      nowIso,
      'Live position detected; automatic SL/TP protection attachment started.',
      {
        brokerKey,
        accountId,
        positionId: position.externalId,
        positionStatus: position.status ?? null,
        attachmentStartedAt: nowIso,
        attachmentTrigger: 'position_detected',
      }
    );
    if (typeof this.suggestedTradeRepository?.saveSuggestedTradeExecution === 'function') {
      await this.persistExecutionState(trade, nextExecution);
    }
    await this.operationalEventService?.logActivity?.(userId, {
      type: 'Suggested Trade',
      title: `Live protection attachment started: ${trade.symbol}`,
      status: 'Warning',
      route: 'Suggested Trades',
      stream: 'Execution',
      related: `${brokerKey} · ${accountId}`,
      referenceId: trade.id,
      symbol: trade.symbol,
      description: `Live position ${position.externalId} was detected; automatic SL/TP protection attachment is starting now.`,
    });
    return nextExecution;
  }

  private async maybeRecoverManualUnlinkedProtection(
    userId: string,
    trade: SuggestedTrade,
    execution: SuggestedTradeExecutionLink,
    position: LivePositionSnapshot | null,
    nowIso: string
  ): Promise<SuggestedTradeExecutionLink> {
    if (!position) {
      return this.markProtectionManualRecheckPending(
        execution,
        nowIso,
        'Manual SL/TP protection still needs broker position data before it can be verified.'
      );
    }

    const brokerKey = this.readStringValue(execution.brokerKey)?.toLowerCase() ?? null;
    const accountId = this.readStringValue(execution.accountId);
    if (!brokerKey || !accountId) {
      return this.markProtectionManualRecheckPending(
        execution,
        nowIso,
        'Manual SL/TP protection still needs broker/account routing before it can be verified.'
      );
    }

    if (brokerKey === 'mudrex') {
      const positionPayload = position.payload ?? {};
      if (mudrexPositionHasProtection(positionPayload)) {
        return this.markProtectionAttached(
          trade,
          execution,
          nowIso,
          'Mudrex position now reports active manual SL/TP protection.',
          {
            positionId: position.externalId,
          }
        );
      }

      return this.markProtectionManualRecheckPending(
        execution,
        nowIso,
        'Mudrex position still does not report active SL/TP protection; manual action remains required.'
      );
    }

    if (brokerKey === 'delta_exchange') {
      const orderId = this.readStringValue(execution.orderId);
      if (orderId) {
        const existingProtection = await this.resolveLiveProtectionOrderContext(
          userId,
          trade.id,
          brokerKey,
          accountId,
          orderId,
          position.payload ?? {}
        );
        if (this.hasUsableDeltaProtectionContext(existingProtection, execution, position)) {
          const duplicateProtectionReason = await this.resolveDeltaLinkedProtectionManualReason({
            userId,
            brokerKey,
            accountId,
            trade,
            execution,
            position,
            protection: existingProtection,
          });
          if (duplicateProtectionReason) {
            return this.markProtectionManualUnlinked(execution, nowIso, duplicateProtectionReason);
          }
          return this.markProtectionAttached(
            trade,
            execution,
            nowIso,
            'Delta Exchange now reports linked manual SL/TP protection.',
            {
              positionId: position.externalId,
              stopLossOrderId: existingProtection.stopLossOrderId,
              takeProfitOrderId: existingProtection.takeProfitOrderId,
            }
          );
        }
      }

      return this.markProtectionManualRecheckPending(
        execution,
        nowIso,
        'Delta Exchange protection is still not linked to the execution; manual action remains required.'
      );
    }

    return this.markProtectionManualRecheckPending(
      execution,
      nowIso,
      `Manual SL/TP protection verification is not supported for broker ${brokerKey}.`
    );
  }

  private async validateAttachedDeltaLiveProtection(
    userId: string,
    trade: SuggestedTrade,
    execution: SuggestedTradeExecutionLink,
    position: LivePositionSnapshot,
    nowIso: string
  ): Promise<SuggestedTradeExecutionLink> {
    const brokerKey = this.readStringValue(execution.brokerKey)?.toLowerCase() ?? null;
    const accountId = this.readStringValue(execution.accountId);
    const orderId = this.readStringValue(execution.orderId);
    if (brokerKey !== 'delta_exchange') {
      return execution;
    }
    if (!accountId || !orderId) {
      return this.markProtectionFailed(
        execution,
        nowIso,
        'Delta Exchange attached protection validation needs broker account and entry order id.'
      );
    }

    const protection = await this.resolveLiveProtectionOrderContext(
      userId,
      trade.id,
      brokerKey,
      accountId,
      orderId,
      position.payload ?? {}
    );
    if (this.hasUsableDeltaProtectionContext(protection, execution, position)) {
      const reconciledExecution = this.reconcilePendingDeltaBracketAmendmentFromContext(
        execution,
        protection,
        nowIso
      );
      const duplicateProtectionReason = await this.resolveDeltaLinkedProtectionManualReason({
        userId,
        brokerKey,
        accountId,
        trade,
        execution: reconciledExecution,
        position,
        protection,
      });
      if (duplicateProtectionReason) {
        return this.markProtectionManualUnlinked(
          reconciledExecution,
          nowIso,
          duplicateProtectionReason
        );
      }
      return reconciledExecution;
    }

    const prices = this.resolveExecutionProtectionPrices(trade, execution);
    const positionPayload = position.payload ?? {};
    const partialExecutionReason = resolveDeltaProtectionPartialExecutionReason(protection);
    if (partialExecutionReason) {
      return this.closeDeltaPositionForProtectionIssue({
        userId,
        brokerKey,
        accountId,
        execution,
        position,
        nowIso,
        issueMessage: partialExecutionReason,
        autoCloseReason: 'partial_protection_execution',
      });
    }
    const mismatchReason = this.resolveDeltaProtectionContextMismatchReason(
      protection,
      execution,
      position
    );
    if (mismatchReason) {
      if (this.isClearedPartialFillEntryRemainder(execution) && prices) {
        return this.remediateDeltaLiveProtection({
          userId,
          trade,
          execution: {
            ...execution,
            protectionState: 'pending',
            protectionAttachedAt: null,
            protectionLastError: mismatchReason,
          },
          position,
          prices,
          nowIso,
          brokerKey,
          accountId,
        });
      }
      return this.markProtectionManualUnlinked(execution, nowIso, mismatchReason);
    }

    const actualEntryPrice = this.resolvePositionEntryPrice(positionPayload, execution);
    const manualReason = prices
      ? resolveDeltaInactiveAttachedProtectionManualReason({
          entrySide: String(trade.side || '').toUpperCase() === 'SELL' ? 'sell' : 'buy',
          actualEntryPrice,
          requestedEntryPrice: prices.requestedEntryPrice,
          stopLossPrice: prices.stopLossPrice,
          takeProfitPrice: prices.takeProfitPrice,
          currentPrice: this.resolvePositionCurrentPrice(positionPayload),
        })
      : 'Delta Exchange attached protection is inactive or missing and no stored SL/TP plan is available for automatic replacement.';
    if (manualReason) {
      if (String(manualReason).toLowerCase().includes('already crossed')) {
        return this.closeDeltaPositionForProtectionIssue({
          userId,
          brokerKey,
          accountId,
          execution,
          position,
          nowIso,
          issueMessage: manualReason,
          autoCloseReason: 'unsafe_protection_already_crossed',
        });
      }
      return this.markProtectionManualUnlinked(execution, nowIso, manualReason);
    }

    return this.markProtectionFailed(
      execution,
      nowIso,
      `Delta Exchange attached protection is inactive or missing for an open position (${describeLiveProtectionOrderContext(
        protection
      )}); replacement protection is required before this execution can be marked attached.`
    );
  }

  private async closeDeltaPositionForProtectionIssue(input: {
    userId: string;
    brokerKey: string;
    accountId: string;
    execution: SuggestedTradeExecutionLink;
    position: LivePositionSnapshot;
    nowIso: string;
    issueMessage: string;
    autoCloseReason: string;
  }): Promise<SuggestedTradeExecutionLink> {
    const positionsAdapter = this.brokerRuntimeRegistry?.getPositionsAdapter?.(
      'delta_exchange'
    ) as {
      closePosition?: (
        positionId: string,
        context?: { userId?: string; brokerKey?: string; accountId?: string }
      ) => Promise<unknown>;
    };
    const closeResult = await closeDeltaPositionForUnsafeProtection({
      positionsAdapter,
      position: input.position,
      userId: input.userId,
      brokerKey: input.brokerKey,
      accountId: input.accountId,
      issueMessage: input.issueMessage,
    });
    if (!closeResult.closed) {
      return this.markProtectionFailed(input.execution, input.nowIso, closeResult.note);
    }

    return {
      ...input.execution,
      executionState: 'closed',
      positionId: closeResult.positionId ?? input.position.externalId,
      positionStatus: 'CLOSED',
      positionClosedAt: input.nowIso,
      protectionState: 'not_required',
      protectionCheckedAt: input.nowIso,
      protectionAttachedAt: null,
      protectionLastError: null,
      protectionPlan: {
        ...(input.execution.protectionPlan ?? {}),
        positionId: closeResult.positionId ?? input.position.externalId,
        autoClosedAt: input.nowIso,
        autoCloseReason: input.autoCloseReason,
      },
      note: this.appendExecutionNote(input.execution.note, closeResult.note),
    };
  }

  private async resolveDeltaLinkedProtectionManualReason(input: {
    userId: string;
    brokerKey: string;
    accountId: string;
    trade: SuggestedTrade;
    execution: SuggestedTradeExecutionLink;
    position: LivePositionSnapshot;
    protection: LiveProtectionOrderContext;
  }): Promise<string | null> {
    const activeSymbolProtection = await this.resolveActiveDeltaProtectionOrdersForSymbol({
      userId: input.userId,
      brokerKey: input.brokerKey,
      accountId: input.accountId,
      symbols: resolveDeltaProtectionLookupSymbols(input.trade, input.position),
      entrySide: String(input.trade.side || '').toUpperCase() === 'SELL' ? 'sell' : 'buy',
    });
    if (activeSymbolProtection.activeOrderIds.length === 0) {
      return null;
    }

    const linkedOrderIds = [
      input.protection.stopLossOrderId,
      input.protection.takeProfitOrderId,
    ].filter((value): value is string => Boolean(value));
    const activeOrderIds = new Set(activeSymbolProtection.activeOrderIds);
    const onlyLinkedPairActive =
      activeSymbolProtection.activeOrderIds.length === linkedOrderIds.length &&
      linkedOrderIds.every((orderId) => activeOrderIds.has(orderId)) &&
      hasExactlyOneDeltaProtectionPair(activeSymbolProtection);
    if (onlyLinkedPairActive) {
      const linkedContext: LiveProtectionOrderContext = {
        stopLossOrderId: input.protection.stopLossOrderId,
        takeProfitOrderId: input.protection.takeProfitOrderId,
        stopLossStatus: input.protection.stopLossStatus,
        takeProfitStatus: input.protection.takeProfitStatus,
        activeOrderIds: activeSymbolProtection.activeOrderIds,
        orderDetails: {
          ...(activeSymbolProtection.orderDetails ?? {}),
          ...(input.protection.orderDetails ?? {}),
        },
      };
      const mismatchReason = this.resolveDeltaProtectionContextMismatchReason(
        linkedContext,
        input.execution,
        input.position
      );
      if (mismatchReason) {
        return mismatchReason;
      }
      return null;
    }

    return `Delta Exchange linked SL/TP pair is active, but extra or unclassified reduce-only protection also exists for this symbol (${describeDeltaActiveProtectionOrders(
      activeSymbolProtection
    )}); manual cleanup is required before this execution can be trusted as attached.`;
  }

  private async remediateMudrexLiveProtection(input: {
    userId: string;
    trade: SuggestedTrade;
    execution: SuggestedTradeExecutionLink;
    position: LivePositionSnapshot;
    prices: { requestedEntryPrice: number | null; stopLossPrice: number; takeProfitPrice: number };
    nowIso: string;
    brokerKey: string;
    accountId: string;
  }): Promise<SuggestedTradeExecutionLink> {
    return remediateMudrexLiveProtectionForBroker({
      ...input,
      positionsAdapter: this.brokerRuntimeRegistry?.getPositionsAdapter?.('mudrex'),
      protectionRepairEnabled: this.isProtectionRepairEnabledForBroker(input.brokerKey),
      resolvePositionEntryPrice: (payload, execution) =>
        this.resolvePositionEntryPrice(payload, execution),
      deriveScaledProtectionPrice: (actualEntryPrice, requestedEntryPrice, requestedTargetPrice) =>
        this.deriveScaledProtectionPrice(
          actualEntryPrice,
          requestedEntryPrice,
          requestedTargetPrice
        ),
      formatNumericString: (value) => this.formatNumericString(value),
      markProtectionAttached: (trade, execution, nowIso, note, planUpdate, attempted) =>
        this.markProtectionAttached(
          trade as SuggestedTrade,
          execution,
          nowIso,
          note,
          planUpdate,
          attempted
        ),
      markProtectionManualUnlinked: (execution, nowIso, message) =>
        this.markProtectionManualUnlinked(execution, nowIso, message),
      markProtectionFailed: (execution, nowIso, message) =>
        this.markProtectionFailed(execution, nowIso, message),
    });
  }

  private async remediateDeltaLiveProtection(input: {
    userId: string;
    trade: SuggestedTrade;
    execution: SuggestedTradeExecutionLink;
    position: LivePositionSnapshot;
    prices: { requestedEntryPrice: number | null; stopLossPrice: number; takeProfitPrice: number };
    nowIso: string;
    brokerKey: string;
    accountId: string;
  }): Promise<SuggestedTradeExecutionLink> {
    const ordersAdapter = this.brokerRuntimeRegistry?.getOrdersAdapter?.(
      'delta_exchange'
    ) as DeltaProtectionOrdersAdapter;

    return remediateDeltaLiveProtectionForBroker({
      ...input,
      ordersAdapter,
      positionsAdapter: this.brokerRuntimeRegistry?.getPositionsAdapter?.('delta_exchange'),
      protectionRepairEnabled: this.isProtectionRepairEnabledForBroker(input.brokerKey),
      resolveLiveProtectionOrderContext: (
        userId,
        suggestedTradeId,
        brokerKey,
        accountId,
        orderId
      ) =>
        this.resolveLiveProtectionOrderContext(
          userId,
          suggestedTradeId,
          brokerKey,
          accountId,
          orderId,
          input.position.payload ?? {}
        ),
      hasUsableProtectionContext: (context) =>
        this.hasUsableDeltaProtectionContext(context, input.execution, input.position),
      resolvePositionEntryPrice: (payload, execution) =>
        this.resolvePositionEntryPrice(payload, execution),
      resolvePositionCurrentPrice: (payload) => this.resolvePositionCurrentPrice(payload),
      deriveScaledProtectionPrice: (actualEntryPrice, requestedEntryPrice, requestedTargetPrice) =>
        this.deriveScaledProtectionPrice(
          actualEntryPrice,
          requestedEntryPrice,
          requestedTargetPrice
        ),
      resolveLiveAutoAssetRoute: (brokerKey, symbol) =>
        this.resolveLiveAutoAssetRoute(brokerKey, symbol),
      resolveActiveProtectionOrdersForSymbol: (args) =>
        this.resolveActiveDeltaProtectionOrdersForSymbol(args),
      unwrapOrderPlacementResponse: (response) => this.unwrapOrderPlacementResponse(response),
      markProtectionAttached: (trade, execution, nowIso, note, planUpdate, attempted) =>
        this.markProtectionAttached(
          trade as SuggestedTrade,
          execution,
          nowIso,
          note,
          planUpdate,
          attempted
        ),
      markProtectionAttaching: (trade, execution, nowIso, note, planUpdate, attempted) =>
        this.markProtectionAttaching(
          trade as SuggestedTrade,
          execution,
          nowIso,
          note,
          planUpdate,
          attempted
        ),
      markProtectionManualUnlinked: (execution, nowIso, message) =>
        this.markProtectionManualUnlinked(execution, nowIso, message),
      markProtectionFailed: (execution, nowIso, message) =>
        this.markProtectionFailed(execution, nowIso, message),
    });
  }

  private resolveExecutionProtectionPrices(
    trade: SuggestedTrade,
    execution: SuggestedTradeExecutionLink
  ): { requestedEntryPrice: number | null; stopLossPrice: number; takeProfitPrice: number } | null {
    const plan = this.readRecordValue(execution.protectionPlan);
    const requestedEntryPrice =
      this.readNumberValue(plan?.entryPrice) ??
      this.readNumberValue(execution.entryPrice) ??
      this.readNumberValue(trade.entryPrice);
    const stopLossPrice =
      this.readNumberValue(plan?.stopLossPrice) ??
      this.readNumberValue(execution.stopLossPrice) ??
      this.readNumberValue(trade.stopLossPrice);
    const takeProfitPrice =
      this.readNumberValue(plan?.takeProfitPrice) ??
      this.readNumberValue(execution.takeProfitPrice) ??
      this.readNumberValue(
        Array.isArray(trade.takeProfitTargets) ? trade.takeProfitTargets[0] : null
      );

    if (!(stopLossPrice && stopLossPrice > 0) || !(takeProfitPrice && takeProfitPrice > 0)) {
      return null;
    }

    return {
      requestedEntryPrice:
        requestedEntryPrice && requestedEntryPrice > 0 ? requestedEntryPrice : null,
      stopLossPrice,
      takeProfitPrice,
    };
  }

  private resolvePositionEntryPrice(
    payload: Record<string, unknown>,
    execution: SuggestedTradeExecutionLink
  ): number | null {
    return (
      this.readNumberValue(payload.entry_price) ??
      this.readNumberValue(payload.entryPrice) ??
      this.readNumberValue(payload.avg_price) ??
      this.readNumberValue(payload.average_price) ??
      this.readNumberValue(execution.filledPrice) ??
      this.readNumberValue(execution.entryPrice)
    );
  }

  private resolvePositionCurrentPrice(payload: Record<string, unknown>): number | null {
    return (
      this.readNumberValue(payload.mark_price) ??
      this.readNumberValue(payload.markPrice) ??
      this.readNumberValue(payload.current_price) ??
      this.readNumberValue(payload.currentPrice) ??
      this.readNumberValue(payload.last_price) ??
      this.readNumberValue(payload.lastPrice)
    );
  }

  private isExecutionOrderFilled(execution: SuggestedTradeExecutionLink): boolean {
    return this.hasExecutionFillEvidence(execution);
  }

  private isUnfilledTerminalEntryExecution(execution: SuggestedTradeExecutionLink): boolean {
    const orderStatus = this.normalizeOrderStatus(execution.orderStatus);
    const executionState = this.readStringValue(execution.executionState)?.toLowerCase();
    if (this.hasExecutionFillEvidence(execution)) {
      return false;
    }

    return Boolean(
      ['cancelled', 'rejected', 'expired', 'failed'].includes(executionState ?? '') ||
      ['CANCELLED', 'REJECTED', 'EXPIRED', 'FAILED'].includes(orderStatus ?? '')
    );
  }

  private hasExecutionFillEvidence(execution: SuggestedTradeExecutionLink): boolean {
    const orderStatus = this.normalizeOrderStatus(execution.orderStatus);
    const executionState = this.readStringValue(execution.executionState)?.toLowerCase();
    return Boolean(
      execution.filledAt ||
      executionState === 'filled' ||
      orderStatus === 'FILLED' ||
      orderStatus === 'CLOSED' ||
      orderStatus === 'PARTIALLY_FILLED' ||
      this.hasPositiveFilledQuantity(execution)
    );
  }

  private hasPositiveFilledQuantity(execution: SuggestedTradeExecutionLink): boolean {
    const filledQuantity = this.readNumberValue(execution.filledQuantity);
    return Boolean(filledQuantity && filledQuantity > 0);
  }

  private isDeltaClosedFilledOrder(
    brokerKey: string | null | undefined,
    normalizedStatus: string | null,
    filledQuantity: number | null | undefined
  ): boolean {
    return (
      String(brokerKey || '')
        .trim()
        .toLowerCase() === 'delta_exchange' &&
      normalizedStatus === 'CLOSED' &&
      typeof filledQuantity === 'number' &&
      Number.isFinite(filledQuantity) &&
      filledQuantity > 0
    );
  }

  private isActivePositionSnapshot(position: LivePositionSnapshot | null | undefined): boolean {
    if (!position) {
      return false;
    }
    const status = this.normalizePositionStatus(
      this.readStringValue(position.status) ??
        this.readStringValue(position.payload?.status) ??
        null
    );
    return status === 'OPEN' || status === 'PARTIAL';
  }

  private isTerminalExecutionForProtection(execution: SuggestedTradeExecutionLink): boolean {
    const executionState = this.readStringValue(execution.executionState)?.toLowerCase();
    const orderStatus = this.normalizeOrderStatus(execution.orderStatus);
    const positionStatus = this.normalizePositionStatus(execution.positionStatus);
    const outcome = this.readStringValue(execution.outcome)?.toLowerCase();
    const hasFillEvidence = this.hasExecutionFillEvidence(execution);
    if (positionStatus === 'OPEN' || positionStatus === 'PARTIAL') {
      return Boolean(
        !hasFillEvidence &&
        (['cancelled', 'rejected', 'expired', 'failed'].includes(executionState ?? '') ||
          ['CANCELLED', 'REJECTED', 'EXPIRED', 'FAILED'].includes(orderStatus ?? ''))
      );
    }
    return Boolean(
      execution.positionClosedAt ||
      positionStatus === 'CLOSED' ||
      positionStatus === 'LIQUIDATED' ||
      executionState === 'closed' ||
      (!hasFillEvidence &&
        ['cancelled', 'rejected', 'expired', 'failed'].includes(executionState ?? '')) ||
      (!hasFillEvidence &&
        ['CANCELLED', 'REJECTED', 'EXPIRED', 'FAILED'].includes(orderStatus ?? '')) ||
      ['profit', 'loss', 'breakeven'].includes(outcome ?? '')
    );
  }

  private hasUsableProtectionContext(context: LiveProtectionOrderContext): boolean {
    if (!context.stopLossOrderId || !context.takeProfitOrderId) {
      return false;
    }
    return (
      context.activeOrderIds.includes(context.stopLossOrderId) &&
      context.activeOrderIds.includes(context.takeProfitOrderId)
    );
  }

  private hasUsableDeltaProtectionContext(
    context: LiveProtectionOrderContext,
    execution: SuggestedTradeExecutionLink,
    position: LivePositionSnapshot | { payload: Record<string, unknown> | null }
  ): boolean {
    if (!this.hasUsableProtectionContext(context)) {
      return false;
    }
    return this.resolveDeltaProtectionContextMismatchReason(context, execution, position) === null;
  }

  private resolveDeltaProtectionContextMismatchReason(
    context: LiveProtectionOrderContext,
    execution: SuggestedTradeExecutionLink,
    position: LivePositionSnapshot | { payload: Record<string, unknown> | null }
  ): string | null {
    const partialReason = resolveDeltaProtectionPartialExecutionReason(context);
    if (partialReason) {
      return partialReason;
    }

    const positionSize = this.resolveDeltaOpenPositionSize(position.payload ?? {}, execution);
    if (!(positionSize && positionSize > 0)) {
      return null;
    }

    for (const [label, orderId] of [
      ['stop-loss', context.stopLossOrderId],
      ['take-profit', context.takeProfitOrderId],
    ] as const) {
      if (!orderId) {
        continue;
      }
      const detail = context.orderDetails?.[orderId];
      const orderSize = this.readNumberValue(detail?.quantity);
      if (!(orderSize && orderSize > 0)) {
        continue;
      }
      const drift = Math.abs(orderSize - positionSize) / Math.max(positionSize, 1e-9);
      if (drift > 0.01) {
        return `Delta Exchange linked ${label} order ${orderId} size ${this.formatNumericString(orderSize) || orderSize} does not match current open position size ${this.formatNumericString(positionSize) || positionSize}; manual cleanup is required.`;
      }
    }

    return null;
  }

  private resolveDeltaOpenPositionSize(
    positionPayload: Record<string, unknown>,
    execution: SuggestedTradeExecutionLink
  ): number | null {
    return (
      this.readNumberValue(positionPayload.quantity_contracts) ??
      this.readNumberValue(positionPayload.quantityContracts) ??
      this.readNumberValue(positionPayload.size) ??
      this.readNumberValue(positionPayload.quantity) ??
      this.readNumberValue(execution.filledQuantity) ??
      this.readNumberValue(execution.quantity)
    );
  }

  private async resolveActiveDeltaProtectionOrdersForSymbol(input: {
    userId: string;
    brokerKey: string;
    accountId: string;
    symbols: string[];
    entrySide: 'buy' | 'sell';
    includeLiveBroker?: boolean;
  }): Promise<DeltaActiveProtectionOrders> {
    const normalizedBrokerKey = String(input.brokerKey || '')
      .trim()
      .toLowerCase();
    if (normalizedBrokerKey !== 'delta_exchange') {
      return {
        stopLossOrderIds: [],
        takeProfitOrderIds: [],
        unclassifiedOrderIds: [],
        activeOrderIds: [],
        orderDetails: {},
      };
    }

    const symbols = Array.from(
      new Set(
        input.symbols
          .map((symbol) =>
            String(symbol || '')
              .trim()
              .toUpperCase()
          )
          .filter(Boolean)
      )
    );
    if (!symbols.length) {
      return {
        stopLossOrderIds: [],
        takeProfitOrderIds: [],
        unclassifiedOrderIds: [],
        activeOrderIds: [],
        orderDetails: {},
      };
    }

    const protectionSide = input.entrySide === 'buy' ? 'sell' : 'buy';
    const rows = (await coreDataSource.query(
      `SELECT external_id AS externalId,
              order_status AS orderStatus,
              status_rank AS statusRank,
              JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.side')) AS side,
              JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.reduce_only')) AS reduceOnly,
              JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.stop_order_type')) AS stopOrderType,
              JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.order_type')) AS orderType,
              JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.stop_price')) AS stopPrice,
              JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.price')) AS price,
              JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.limit_price')) AS limitPrice,
              JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.quantity')) AS quantity,
              JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.size')) AS size,
              JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.filled_quantity')) AS filledQuantity,
              JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.filledQuantity')) AS filledQuantityCamel,
              JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.remaining_quantity')) AS remainingQuantity,
              JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.remainingQuantity')) AS remainingQuantityCamel,
              JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.unfilled_size')) AS unfilledSize,
              JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.stop_price')) AS stopPrice,
              JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.stopPrice')) AS stopPriceCamel,
              JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.trigger_price')) AS triggerPrice,
              JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.triggerPrice')) AS triggerPriceCamel,
              JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.price')) AS price,
              JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.limit_price')) AS limitPrice,
              JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.limitPrice')) AS limitPriceCamel,
              JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.stop_order_type')) AS stopOrderType,
              JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.stopOrderType')) AS stopOrderTypeCamel
         FROM scheduler_orders_snapshots
        WHERE user_id = ?
          AND account_id = ?
          AND LOWER(broker_key) = ?
          AND UPPER(symbol) IN (${symbols.map(() => '?').join(', ')})
          AND (
            status_rank BETWEEN 1 AND 2
            OR UPPER(COALESCE(order_status, '')) IN ('OPEN', 'PENDING', 'PARTIALLY_FILLED')
          )`,
      [input.userId, input.accountId, normalizedBrokerKey, ...symbols]
    )) as DeltaProtectionOrderCandidate[];

    const context: DeltaActiveProtectionOrders = {
      stopLossOrderIds: [],
      takeProfitOrderIds: [],
      unclassifiedOrderIds: [],
      activeOrderIds: [],
      orderDetails: {},
    };

    for (const row of rows) {
      this.addDeltaActiveProtectionOrder(context, row, protectionSide);
    }

    if (input.includeLiveBroker) {
      const liveOrders = await this.listLiveDeltaProtectionOrderCandidates(input);
      for (const row of liveOrders) {
        this.addDeltaActiveProtectionOrder(context, row, protectionSide);
      }
    }

    return context;
  }

  private async listLiveDeltaProtectionOrderCandidates(input: {
    userId: string;
    brokerKey: string;
    accountId: string;
    symbols: string[];
  }): Promise<DeltaProtectionOrderCandidate[]> {
    const adapter = this.brokerRuntimeRegistry?.getOrdersAdapter?.(
      'delta_exchange'
    ) as DeltaProtectionOrdersAdapter;
    if (!adapter?.listOpenOrders) {
      return [];
    }

    const symbols = new Set(
      input.symbols
        .map((symbol) =>
          String(symbol || '')
            .trim()
            .toUpperCase()
        )
        .filter(Boolean)
    );
    const raw = await adapter.listOpenOrders(
      { limit: 100 },
      {
        userId: input.userId,
        brokerKey: input.brokerKey,
        accountId: input.accountId,
      }
    );
    const rows = this.extractUnknownList(raw);
    return rows
      .map((row) => this.readRecordValue(row))
      .filter((row): row is Record<string, unknown> => Boolean(row))
      .filter((row) => {
        const symbol =
          this.readStringValue(row.symbol) ??
          this.readStringValue(row.product_symbol) ??
          this.readStringValue(row.productSymbol);
        return Boolean(symbol && symbols.has(symbol.toUpperCase()));
      })
      .map((row) => ({
        externalId: row.id ?? row.order_id ?? row.orderId,
        orderStatus: row.status ?? row.state ?? row.order_status ?? row.orderStatus,
        statusRank: 1,
        side: row.side,
        reduceOnly: row.reduce_only ?? row.reduceOnly,
        stopOrderType: row.stop_order_type ?? row.stopOrderType,
        orderType: row.order_type ?? row.orderType ?? row.type,
        stopPrice:
          row.stop_price ?? row.stopPrice ?? row.trigger_price ?? row.triggerPrice ?? row.price,
        limitPrice: row.limit_price ?? row.limitPrice,
        quantity: row.quantity ?? row.size,
        size: row.size,
        filledQuantity: row.filled_quantity ?? row.filledQuantity,
        remainingQuantity: row.remaining_quantity ?? row.remainingQuantity,
        unfilledSize: row.unfilled_size ?? row.unfilledSize,
      }));
  }

  private addDeltaActiveProtectionOrder(
    context: DeltaActiveProtectionOrders,
    row: DeltaProtectionOrderCandidate,
    protectionSide: 'buy' | 'sell'
  ): void {
    const orderId = this.readStringValue(row.externalId);
    if (!orderId) {
      return;
    }
    const orderStatus = this.normalizeOrderStatus(this.readStringValue(row.orderStatus));
    const statusRank =
      row.statusRank === undefined || row.statusRank === null ? null : Number(row.statusRank);
    if (!this.isActiveLiveProtectionOrder(orderStatus, statusRank)) {
      return;
    }

    const side = this.readStringValue(row.side)?.toLowerCase();
    if (side !== protectionSide) {
      return;
    }

    const reduceOnly = this.readBooleanValue(row.reduceOnly);
    if (reduceOnly !== true) {
      return;
    }

    const stopOrderType = String(
      this.readStringValue(row.stopOrderType) ?? this.readStringValue(row.orderType) ?? ''
    )
      .trim()
      .toLowerCase();
    if (!context.activeOrderIds.includes(orderId)) {
      context.activeOrderIds.push(orderId);
    }
    const quantity = this.readNumberValue(row.quantity) ?? this.readNumberValue(row.size);
    const filledQuantity = this.readNumberValue(row.filledQuantity);
    const explicitRemainingQuantity =
      this.readNumberValue(row.remainingQuantity) ?? this.readNumberValue(row.unfilledSize);
    const remainingQuantity =
      explicitRemainingQuantity ??
      (quantity !== null && filledQuantity !== null
        ? Math.max(0, quantity - filledQuantity)
        : null);
    context.orderDetails[orderId] = {
      status: orderStatus,
      quantity,
      filledQuantity,
      remainingQuantity,
      stopPrice: this.readNumberValue(row.stopPrice),
      limitPrice: this.readNumberValue(row.limitPrice),
      stopOrderType,
    };
    if (stopOrderType.includes('stop_loss')) {
      if (!context.stopLossOrderIds.includes(orderId)) {
        context.stopLossOrderIds.push(orderId);
      }
    } else if (stopOrderType.includes('take_profit')) {
      if (!context.takeProfitOrderIds.includes(orderId)) {
        context.takeProfitOrderIds.push(orderId);
      }
    } else if (!context.unclassifiedOrderIds.includes(orderId)) {
      context.unclassifiedOrderIds.push(orderId);
    }
  }

  private extractUnknownList(value: unknown): unknown[] {
    if (Array.isArray(value)) {
      return value;
    }
    const record = this.readRecordValue(value);
    if (!record) {
      return [];
    }
    for (const key of ['data', 'items', 'result']) {
      const child = record[key];
      if (Array.isArray(child)) {
        return child;
      }
      const childRecord = this.readRecordValue(child);
      if (childRecord && Array.isArray(childRecord.items)) {
        return childRecord.items;
      }
    }
    return [];
  }

  private isRetriableProtectionFailure(execution: SuggestedTradeExecutionLink): boolean {
    const attempts = Math.max(
      0,
      Math.floor(this.readNumberValue(execution.protectionAttempts) ?? 0)
    );
    if (attempts >= 3) {
      return false;
    }
    const error = String(execution.protectionLastError || '')
      .trim()
      .toLowerCase();
    return (
      error.includes('position not found') ||
      error.includes('bad request') ||
      error.includes('invalid stop loss price')
    );
  }

  private isDeltaReplacementProtectionFailure(execution: SuggestedTradeExecutionLink): boolean {
    const brokerKey = this.readStringValue(execution.brokerKey)?.toLowerCase();
    if (brokerKey !== 'delta_exchange') {
      return false;
    }
    const attempts = Math.max(
      0,
      Math.floor(this.readNumberValue(execution.protectionAttempts) ?? 0)
    );
    if (attempts >= 3) {
      return false;
    }
    const error = String(execution.protectionLastError || '')
      .trim()
      .toLowerCase();
    return (
      error.includes('replacement protection is inactive after submission') ||
      (error.includes('attached protection is inactive or missing') &&
        error.includes('replacement protection is required'))
    );
  }

  private markProtectionManualUnlinked(
    execution: SuggestedTradeExecutionLink,
    nowIso: string,
    message: string
  ): SuggestedTradeExecutionLink {
    return {
      ...execution,
      protectionState: 'manual_unlinked',
      protectionCheckedAt: nowIso,
      protectionLastError: message,
      note: message,
    };
  }

  private markProtectionManualRecheckPending(
    execution: SuggestedTradeExecutionLink,
    nowIso: string,
    message: string
  ): SuggestedTradeExecutionLink {
    return {
      ...execution,
      protectionState: 'manual_unlinked',
      protectionCheckedAt: nowIso,
      protectionLastError: execution.protectionLastError ?? message,
      note: this.appendExecutionNote(execution.note, message),
    };
  }

  private markProtectionAttached(
    trade: SuggestedTrade,
    execution: SuggestedTradeExecutionLink,
    nowIso: string,
    note: string,
    planUpdate: Record<string, unknown>,
    attempted = false
  ): SuggestedTradeExecutionLink {
    const existingPlan = this.readRecordValue(execution.protectionPlan) ?? {};
    const trailingStop = this.resolveProtectionPlanTrailingStop(trade, execution);
    return {
      ...execution,
      protectionState: 'attached',
      protectionAttempts: attempted
        ? Math.max(0, Math.floor(execution.protectionAttempts ?? 0)) + 1
        : (execution.protectionAttempts ?? 0),
      protectionCheckedAt: nowIso,
      protectionAttachedAt: execution.protectionAttachedAt ?? nowIso,
      protectionLastError: null,
      protectionPlan: {
        ...existingPlan,
        source: 'suggested_trade_execution',
        symbol: trade.symbol,
        side: trade.side,
        timeframe: trade.timeframe,
        brokerKey: execution.brokerKey ?? null,
        accountId: execution.accountId ?? null,
        orderId: execution.orderId ?? null,
        attachedAt: execution.protectionAttachedAt ?? nowIso,
        ...(trailingStop ? { trailingStop } : {}),
        ...planUpdate,
      },
      note: this.appendExecutionNote(execution.note, note),
    };
  }

  private markProtectionAttaching(
    trade: SuggestedTrade,
    execution: SuggestedTradeExecutionLink,
    nowIso: string,
    note: string,
    planUpdate: Record<string, unknown>,
    attempted = false
  ): SuggestedTradeExecutionLink {
    const existingPlan = this.readRecordValue(execution.protectionPlan) ?? {};
    const trailingStop = this.resolveProtectionPlanTrailingStop(trade, execution);
    return {
      ...execution,
      protectionState: 'attaching',
      protectionAttempts: attempted
        ? Math.max(0, Math.floor(execution.protectionAttempts ?? 0)) + 1
        : (execution.protectionAttempts ?? 0),
      protectionCheckedAt: nowIso,
      protectionAttachedAt: null,
      protectionLastError: null,
      protectionPlan: {
        ...existingPlan,
        source: 'suggested_trade_execution',
        symbol: trade.symbol,
        side: trade.side,
        timeframe: trade.timeframe,
        brokerKey: execution.brokerKey ?? null,
        accountId: execution.accountId ?? null,
        orderId: execution.orderId ?? null,
        replacementSubmittedAt: nowIso,
        ...(trailingStop ? { trailingStop } : {}),
        ...planUpdate,
      },
      note: this.appendExecutionNote(execution.note, note),
    };
  }

  private markProtectionAttachmentStarted(
    trade: SuggestedTrade,
    execution: SuggestedTradeExecutionLink,
    nowIso: string,
    note: string,
    planUpdate: Record<string, unknown>
  ): SuggestedTradeExecutionLink {
    const existingPlan = this.readRecordValue(execution.protectionPlan) ?? {};
    const trailingStop = this.resolveProtectionPlanTrailingStop(trade, execution);
    return {
      ...execution,
      protectionState: 'attaching',
      protectionCheckedAt: nowIso,
      protectionAttachedAt: null,
      protectionLastError: null,
      protectionPlan: {
        ...existingPlan,
        source: 'suggested_trade_execution',
        symbol: trade.symbol,
        side: trade.side,
        timeframe: trade.timeframe,
        brokerKey: execution.brokerKey ?? null,
        accountId: execution.accountId ?? null,
        orderId: execution.orderId ?? null,
        ...(trailingStop ? { trailingStop } : {}),
        ...planUpdate,
      },
      note: this.appendExecutionNote(execution.note, note),
    };
  }

  private markProtectionFailed(
    execution: SuggestedTradeExecutionLink,
    nowIso: string,
    message: string
  ): SuggestedTradeExecutionLink {
    return {
      ...execution,
      protectionState: 'failed',
      protectionAttempts: Math.max(0, Math.floor(execution.protectionAttempts ?? 0)) + 1,
      protectionCheckedAt: nowIso,
      protectionLastError: message,
      note: this.appendExecutionNote(execution.note, message),
    };
  }

  private async maybeAutoCancelSiblingProtectionOrders(
    userId: string,
    trade: SuggestedTrade,
    execution: SuggestedTradeExecutionLink,
    positionSnapshots: Array<{
      externalId: string;
      status: string | null;
      statusRank: number | null;
      firstSeenAt: Date | string | null;
      lastSeenAt: Date | string | null;
      payload: Record<string, unknown> | null;
    }>
  ): Promise<SuggestedTradeExecutionLink> {
    if (execution.executionMode !== 'live') {
      return execution;
    }

    const brokerKey = this.readStringValue(execution.brokerKey)?.toLowerCase() ?? null;
    const accountId = this.readStringValue(execution.accountId);
    const orderId = this.readStringValue(execution.orderId);
    if (!brokerKey || !accountId || !orderId) {
      return execution;
    }

    if (!this.brokerRuntimeRegistry?.supportsOrdersAdapter?.(brokerKey)) {
      return execution;
    }

    if (this.isUnfilledTerminalEntryExecution(execution)) {
      const plan = this.readRecordValue(execution.protectionPlan);
      if (this.readStringValue(plan?.siblingProtectionCancelRequestedAt)) {
        return execution;
      }
      const adapter = this.brokerRuntimeRegistry?.getOrdersAdapter?.(brokerKey);
      if (!adapter?.cancelOrder) {
        return execution;
      }
      const protectionCleanup = await this.cancelDeltaProtectionOrdersForExpiredEntry({
        userId,
        brokerKey,
        accountId,
        entryOrderId: orderId,
        execution,
        adapter,
        nowIso: new Date().toISOString(),
      });
      if (!protectionCleanup.note && !protectionCleanup.protectionPlan) {
        return execution;
      }
      return {
        ...execution,
        protectionPlan: protectionCleanup.protectionPlan ?? execution.protectionPlan,
        note: this.appendExecutionNote(execution.note, protectionCleanup.note ?? ''),
      };
    }

    if (this.isActiveUnfilledLiveEntryOrder(execution)) {
      return execution;
    }

    if (!this.isExecutionPositionClosed(execution, positionSnapshots)) {
      return execution;
    }
    const linkedPositionId = this.readStringValue(execution.positionId);
    const hasDifferentActivePosition = positionSnapshots.some((snapshot) => {
      if (linkedPositionId && snapshot.externalId === linkedPositionId) {
        return false;
      }
      return this.isActivePositionSnapshot(snapshot);
    });
    if (hasDifferentActivePosition) {
      return execution;
    }

    const protection = await this.resolveLiveProtectionOrderContext(
      userId,
      trade.id,
      brokerKey,
      accountId,
      orderId
    );
    const deltaLiveProtectionOrderIds =
      brokerKey === 'delta_exchange'
        ? await this.resolveDeltaLiveSiblingProtectionOrderIds({
            userId,
            brokerKey,
            accountId,
            trade,
          })
        : [];
    const activeProtectionOrderIds = Array.from(
      new Set([...protection.activeOrderIds, ...deltaLiveProtectionOrderIds])
    );
    if (!activeProtectionOrderIds.length) {
      return execution;
    }

    const cancelMessage = `Sibling protection cancel requested after position close: ${activeProtectionOrderIds.join(', ')}`;
    if (String(execution.note || '').includes(cancelMessage)) {
      return execution;
    }

    const adapter = this.brokerRuntimeRegistry?.getOrdersAdapter?.(brokerKey);
    if (!adapter?.cancelOrder) {
      return execution;
    }
    const cancelledOrderIds: string[] = [];
    for (const protectionOrderId of activeProtectionOrderIds) {
      try {
        await adapter.cancelOrder(protectionOrderId, {
          userId,
          brokerKey,
          accountId,
        });
        cancelledOrderIds.push(protectionOrderId);
      } catch {
        // Keep reconciliation non-fatal here. The next sync/canary pass can retry.
      }
    }

    if (!cancelledOrderIds.length) {
      return execution;
    }

    return {
      ...execution,
      note: this.appendExecutionNote(
        execution.note,
        `Sibling protection cancel requested after position close: ${cancelledOrderIds.join(', ')}`
      ),
    };
  }

  private async resolveDeltaLiveSiblingProtectionOrderIds(input: {
    userId: string;
    brokerKey: string;
    accountId: string;
    trade: SuggestedTrade;
  }): Promise<string[]> {
    if (input.brokerKey !== 'delta_exchange') {
      return [];
    }

    const side = String(input.trade.side || '')
      .trim()
      .toLowerCase();
    const entrySide =
      side === 'buy' || side === 'long'
        ? 'buy'
        : side === 'sell' || side === 'short'
          ? 'sell'
          : null;
    if (!entrySide) {
      return [];
    }

    try {
      const rows = await this.listLiveDeltaProtectionOrderCandidates({
        userId: input.userId,
        brokerKey: input.brokerKey,
        accountId: input.accountId,
        symbols: this.buildEquivalentLiveAutoSymbols(input.trade.symbol, input.brokerKey),
      });
      const context: DeltaActiveProtectionOrders = {
        stopLossOrderIds: [],
        takeProfitOrderIds: [],
        unclassifiedOrderIds: [],
        activeOrderIds: [],
        orderDetails: {},
      };
      const protectionSide = entrySide === 'buy' ? 'sell' : 'buy';
      for (const row of rows) {
        this.addDeltaActiveProtectionOrder(context, row, protectionSide);
      }
      return context.activeOrderIds;
    } catch {
      return [];
    }
  }

  private mergePaperExecutionOutcome(
    existing: SuggestedTradeExecutionLink | null,
    paperOrder: {
      id: string;
      status: string;
      createdAt: Date;
      updatedAt: Date;
      canceledAt: Date | null;
      orderType: string | null;
      triggerType: string | null;
      leverage: number | null;
      quantity: string | null;
      orderPrice: string | null;
      stoplossPrice: string | null;
      takeprofitPrice: string | null;
      payload: Record<string, unknown> | null;
    }
  ): SuggestedTradeExecutionLink {
    const normalizedStatus = String(paperOrder.status || 'OPEN')
      .trim()
      .toUpperCase();
    const payload =
      paperOrder.payload &&
      typeof paperOrder.payload === 'object' &&
      !Array.isArray(paperOrder.payload)
        ? paperOrder.payload
        : {};
    const simulation =
      payload.simulation &&
      typeof payload.simulation === 'object' &&
      !Array.isArray(payload.simulation)
        ? (payload.simulation as Record<string, unknown>)
        : {};
    const executionState = this.resolvePaperExecutionState(existing, normalizedStatus, simulation);

    return {
      ...(existing ?? {}),
      executionMode: 'paper',
      paperOrderId: paperOrder.id,
      paperOrderStatus: normalizedStatus,
      orderStatus: normalizedStatus,
      executionState,
      linkedAt: existing?.linkedAt ?? paperOrder.createdAt.toISOString(),
      submittedAt: existing?.submittedAt ?? paperOrder.createdAt.toISOString(),
      lastSeenAt:
        this.toIsoString(simulation.lastPriceSeenAt) ?? paperOrder.updatedAt.toISOString(),
      canceledAt: paperOrder.canceledAt
        ? paperOrder.canceledAt.toISOString()
        : (this.toIsoString(simulation.canceledAt) ?? existing?.canceledAt ?? null),
      orderType: existing?.orderType ?? paperOrder.orderType ?? null,
      triggerType: existing?.triggerType ?? paperOrder.triggerType ?? null,
      leverage: existing?.leverage ?? paperOrder.leverage ?? null,
      quantity:
        existing?.quantity ?? (paperOrder.quantity === null ? null : Number(paperOrder.quantity)),
      entryPrice: existing?.entryPrice ?? paperOrder.orderPrice ?? null,
      stopLossPrice: existing?.stopLossPrice ?? paperOrder.stoplossPrice ?? null,
      takeProfitPrice: existing?.takeProfitPrice ?? paperOrder.takeprofitPrice ?? null,
      filledAt: this.toIsoString(simulation.filledAt) ?? existing?.filledAt ?? null,
      filledPrice: this.readStringValue(simulation.filledPrice) ?? existing?.filledPrice ?? null,
      filledQuantity:
        this.readNumberValue(simulation.filledQuantity) ??
        existing?.filledQuantity ??
        (normalizedStatus === 'FILLED' || normalizedStatus === 'CLOSED'
          ? paperOrder.quantity === null
            ? null
            : Number(paperOrder.quantity)
          : null),
      remainingQuantity:
        this.readNumberValue(simulation.remainingQuantity) ??
        existing?.remainingQuantity ??
        (normalizedStatus === 'FILLED' || normalizedStatus === 'CLOSED' ? 0 : null),
      positionId:
        this.readStringValue(simulation.positionId) ??
        existing?.positionId ??
        (normalizedStatus === 'FILLED' || normalizedStatus === 'CLOSED'
          ? `paper:${paperOrder.id}`
          : null),
      positionStatus:
        this.readStringValue(simulation.positionStatus) ??
        existing?.positionStatus ??
        (normalizedStatus === 'CLOSED' ? 'CLOSED' : normalizedStatus === 'FILLED' ? 'OPEN' : null),
      positionOpenedAt:
        this.toIsoString(simulation.positionOpenedAt) ??
        existing?.positionOpenedAt ??
        (normalizedStatus === 'FILLED' || normalizedStatus === 'CLOSED'
          ? (this.toIsoString(simulation.filledAt) ?? paperOrder.updatedAt.toISOString())
          : null),
      positionClosedAt:
        this.toIsoString(simulation.positionClosedAt) ??
        this.toIsoString(simulation.closedAt) ??
        existing?.positionClosedAt ??
        (normalizedStatus === 'CLOSED' ? paperOrder.updatedAt.toISOString() : null),
      exitPrice: this.readStringValue(simulation.exitPrice) ?? existing?.exitPrice ?? null,
      realizedPnl: this.readStringValue(simulation.realizedPnl) ?? existing?.realizedPnl ?? null,
      outcome:
        (this.readStringValue(simulation.outcome) as SuggestedTradeExecutionLink['outcome']) ??
        existing?.outcome ??
        (normalizedStatus === 'FILLED' ? 'open' : normalizedStatus === 'CLOSED' ? 'unknown' : null),
    };
  }

  private resolveUnlinkedExecutionGap(
    execution: SuggestedTradeExecutionLink | null
  ): SuggestedTradeExecutionLink | null {
    const executionState = String(execution?.executionState || '')
      .trim()
      .toLowerCase();
    if (executionState === 'queued' || executionState === 'submitting') {
      return this.resolveExecutionGap(execution, {
        state: 'failed',
        message: 'Execution request stalled before an order or paper order was linked',
      });
    }
    if (executionState === 'linked') {
      return this.resolveExecutionGap(execution, {
        state: 'unknown',
        message: 'Execution is marked linked but no order or account route is attached',
      });
    }

    const protectionState = this.normalizeProtectionState(execution?.protectionState);
    const hasBrokerOrder =
      Boolean(this.readStringValue(execution?.orderId)) ||
      Boolean(this.readStringValue(execution?.positionId)) ||
      Boolean(this.readStringValue(execution?.paperOrderId));
    if (
      execution?.executionMode === 'live' &&
      !hasBrokerOrder &&
      this.isRemediableProtectionState(protectionState)
    ) {
      return {
        ...(execution ?? {}),
        protectionState: 'not_required',
        protectionCheckedAt: new Date().toISOString(),
        protectionLastError: null,
        note: execution?.note ?? 'No broker order was created; protection is not required.',
      };
    }

    return null;
  }

  private resolveExecutionGap(
    execution: SuggestedTradeExecutionLink | null,
    params: {
      state: SuggestedTradeExecutionLink['executionState'];
      message: string;
    }
  ): SuggestedTradeExecutionLink {
    return {
      ...(execution ?? {}),
      executionState: params.state,
      lastSeenAt: execution?.lastSeenAt ?? new Date().toISOString(),
      note: params.message,
    };
  }

  private resolvePaperExecutionState(
    existing: SuggestedTradeExecutionLink | null,
    normalizedStatus: string,
    simulation: Record<string, unknown>
  ): SuggestedTradeExecutionLink['executionState'] {
    const explicitState = this.readStringValue(
      simulation.executionState
    ) as SuggestedTradeExecutionLink['executionState'];
    if (explicitState) {
      return explicitState;
    }
    if (normalizedStatus === 'CANCELLED') {
      return 'cancelled';
    }
    if (normalizedStatus === 'REJECTED') {
      return 'rejected';
    }
    if (normalizedStatus === 'EXPIRED') {
      return 'expired';
    }
    if (normalizedStatus === 'FAILED') {
      return 'failed';
    }
    if (normalizedStatus === 'FILLED') {
      return 'filled';
    }
    if (normalizedStatus === 'CLOSED') {
      return 'closed';
    }
    const hasObservation =
      Boolean(this.toIsoString(simulation.lastPriceSeenAt)) ||
      Boolean(this.toIsoString(simulation.positionOpenedAt)) ||
      Boolean(this.toIsoString(simulation.positionClosedAt)) ||
      this.readNumberValue(simulation.filledQuantity) !== null;
    if (normalizedStatus === 'OPEN' || normalizedStatus === 'PENDING') {
      if (
        existing?.executionState === 'queued' ||
        existing?.executionState === 'submitting' ||
        existing?.executionState === 'linked'
      ) {
        return hasObservation ? 'working' : 'linked';
      }
      return hasObservation ? 'working' : (existing?.executionState ?? 'linked');
    }
    return existing?.executionState ?? 'unknown';
  }

  private mergeExecutionOutcome(
    existing: SuggestedTradeExecutionLink | null,
    snapshot: {
      orderStatus: string | null;
      statusRank: number | null;
      lastSeenAt: Date | string | null;
      payload: Record<string, unknown> | null;
    }
  ): SuggestedTradeExecutionLink {
    const payload = snapshot.payload ?? {};
    const normalizedStatus = this.normalizeOrderStatus(
      this.readStringValue(snapshot.orderStatus) ??
        this.readStringValue(payload.status) ??
        existing?.orderStatus ??
        null
    );
    const filledPrice =
      this.readStringValue(payload.filled_price) ??
      this.readStringValue(payload.filledPrice) ??
      this.readStringValue(payload.avg_fill_price) ??
      this.readStringValue(payload.average_fill_price) ??
      existing?.filledPrice ??
      null;
    const filledQuantity =
      this.readNumberValue(payload.filled_quantity) ??
      this.readNumberValue(payload.filledQuantity) ??
      existing?.filledQuantity ??
      null;
    const existingClearedPartialFillRemainder = this.isClearedPartialFillEntryRemainder(existing);
    const snapshotRemainingQuantity =
      this.readNumberValue(payload.remaining_quantity) ??
      this.readNumberValue(payload.remainingQuantity);
    const remainingQuantity =
      existingClearedPartialFillRemainder && this.isActiveLimitEntryOrderStatus(normalizedStatus)
        ? (existing?.remainingQuantity ?? 0)
        : (snapshotRemainingQuantity ?? existing?.remainingQuantity ?? null);
    const updatedAt =
      this.toIsoString(payload.updated_at) ?? this.toIsoString(payload.updatedAt) ?? null;
    const deltaClosedFilledOrder = this.isDeltaClosedFilledOrder(
      existing?.brokerKey,
      normalizedStatus,
      filledQuantity
    );
    const positiveFilledQuantity = typeof filledQuantity === 'number' && filledQuantity > 0;
    if (
      existing &&
      !positiveFilledQuantity &&
      this.isUnfilledTerminalEntryExecution(existing) &&
      this.isActiveLimitEntryOrderStatus(normalizedStatus)
    ) {
      const snapshotObservedMs = this.getOrderSnapshotBrokerObservedTimestamp(snapshot);
      const localTerminalMs =
        this.toTimestamp(existing.canceledAt) || this.toTimestamp(existing.lastSeenAt);
      if (localTerminalMs && (!snapshotObservedMs || snapshotObservedMs <= localTerminalMs)) {
        return {
          ...existing,
          lastSeenAt: existing.lastSeenAt ?? this.toIsoString(snapshot.lastSeenAt) ?? null,
        };
      }
    }
    const terminalOrderWithPartialFill = Boolean(
      positiveFilledQuantity &&
      normalizedStatus &&
      ['CANCELLED', 'REJECTED', 'EXPIRED', 'FAILED'].includes(normalizedStatus)
    );
    const executionState =
      existingClearedPartialFillRemainder && this.isActiveLimitEntryOrderStatus(normalizedStatus)
        ? (existing?.executionState ?? 'filled')
        : deltaClosedFilledOrder || terminalOrderWithPartialFill
          ? 'filled'
          : this.mapExecutionState(normalizedStatus, snapshot.statusRank);

    return {
      ...(existing ?? {}),
      orderStatus: normalizedStatus,
      executionState,
      submittedAt:
        this.toIsoString(payload.created_at) ??
        this.toIsoString(payload.createdAt) ??
        existing?.submittedAt ??
        null,
      linkedAt: existing?.linkedAt ?? null,
      lastSeenAt: this.toIsoString(snapshot.lastSeenAt) ?? existing?.lastSeenAt ?? null,
      filledAt:
        this.toIsoString(payload.filled_at) ??
        this.toIsoString(payload.filledAt) ??
        (normalizedStatus === 'FILLED' ||
        normalizedStatus === 'PARTIALLY_FILLED' ||
        deltaClosedFilledOrder ||
        terminalOrderWithPartialFill ||
        positiveFilledQuantity
          ? (updatedAt ?? existing?.filledAt ?? null)
          : (existing?.filledAt ?? null)),
      canceledAt:
        existingClearedPartialFillRemainder && this.isActiveLimitEntryOrderStatus(normalizedStatus)
          ? (existing?.canceledAt ?? null)
          : (this.toIsoString(payload.canceled_at) ??
            this.toIsoString(payload.canceledAt) ??
            this.toIsoString(payload.cancelled_at) ??
            this.toIsoString(payload.cancelledAt) ??
            (['CANCELLED', 'REJECTED', 'EXPIRED', 'FAILED'].includes(normalizedStatus || '')
              ? (updatedAt ?? existing?.canceledAt ?? null)
              : (existing?.canceledAt ?? null))),
      filledPrice,
      filledQuantity,
      remainingQuantity,
    };
  }

  private getOrderSnapshotBrokerObservedTimestamp(snapshot: {
    lastSeenAt: Date | string | null;
    payload: Record<string, unknown> | null;
  }): number {
    const payload = snapshot.payload ?? {};
    return (
      this.toTimestamp(payload.updated_at) ||
      this.toTimestamp(payload.updatedAt) ||
      this.toTimestamp(payload.filled_at) ||
      this.toTimestamp(payload.filledAt) ||
      this.toTimestamp(payload.closed_at) ||
      this.toTimestamp(payload.closedAt) ||
      this.toTimestamp(payload.cancelled_at) ||
      this.toTimestamp(payload.cancelledAt) ||
      this.toTimestamp(payload.canceled_at) ||
      this.toTimestamp(payload.canceledAt) ||
      this.toTimestamp(payload.created_at) ||
      this.toTimestamp(payload.createdAt) ||
      this.toTimestamp(snapshot.lastSeenAt)
    );
  }

  private mergePositionOutcome(
    trade: SuggestedTrade,
    execution: SuggestedTradeExecutionLink,
    snapshots: Array<{
      externalId: string;
      status: string | null;
      statusRank: number | null;
      firstSeenAt: Date | string | null;
      lastSeenAt: Date | string | null;
      payload: Record<string, unknown> | null;
    }>,
    options: { allowPositionEvidenceFill?: boolean } = {}
  ): SuggestedTradeExecutionLink {
    const canUseActivePositionEvidence =
      options.allowPositionEvidenceFill === true && this.hasOpenPositionSnapshot(snapshots);
    if (this.isActiveUnfilledLiveEntryOrder(execution) && !canUseActivePositionEvidence) {
      return this.clearStalePositionOutcomeForActiveUnfilledOrder(execution);
    }

    const candidate = this.selectBestPositionCandidate(trade, execution, snapshots, {
      allowPositionEvidenceFill: options.allowPositionEvidenceFill === true,
    });
    if (!candidate) {
      return execution;
    }

    const realizedPnl =
      this.readStringValue(candidate.payload?.realized) ??
      this.readStringValue(candidate.payload?.pnl) ??
      this.readStringValue(candidate.payload?.realized_pnl) ??
      execution.realizedPnl ??
      null;
    const observedLeverage = this.resolveObservedPositionLeverage(candidate.payload);
    const positionStatus = this.normalizePositionStatus(
      this.readStringValue(candidate.status) ??
        this.readStringValue(candidate.payload?.status) ??
        null
    );
    const outcome = this.deriveOutcome(positionStatus, realizedPnl);
    const brokerKey = this.readStringValue(execution.brokerKey)?.toLowerCase() ?? null;
    const requestedLeverage = execution.leverage ?? null;
    const positionOpenedAt =
      this.toIsoString(candidate.payload?.created_at) ??
      this.toIsoString(candidate.payload?.createdAt) ??
      this.toIsoString(candidate.firstSeenAt) ??
      execution.positionOpenedAt ??
      null;
    const activePositionEvidence =
      options.allowPositionEvidenceFill === true &&
      (positionStatus === 'OPEN' || positionStatus === 'PARTIAL');
    const positionObservedFillAt =
      this.toIsoString(candidate.firstSeenAt) ??
      this.toIsoString(candidate.lastSeenAt) ??
      positionOpenedAt ??
      null;
    const positionEntryPrice =
      this.readStringValue(candidate.payload?.entry_price) ??
      this.readStringValue(candidate.payload?.entryPrice) ??
      execution.filledPrice ??
      null;
    const positionQuantity =
      this.readNumberValue(candidate.payload?.quantity) ??
      this.readNumberValue(candidate.payload?.size) ??
      execution.filledQuantity ??
      null;
    const backfilledDeltaFilledAt =
      !execution.filledAt &&
      this.isDeltaClosedFilledOrder(
        execution.brokerKey,
        this.normalizeOrderStatus(execution.orderStatus),
        execution.filledQuantity
      )
        ? positionOpenedAt
        : null;
    const leverageDriftMessage =
      brokerKey === 'mudrex' &&
      observedLeverage !== null &&
      requestedLeverage !== null &&
      Math.abs(observedLeverage - requestedLeverage) > 1e-12
        ? `Broker observed leverage ${this.formatNumericString(observedLeverage) || observedLeverage} differs from requested leverage ${this.formatNumericString(requestedLeverage) || requestedLeverage}. Using broker-observed leverage for tracking.`
        : null;

    return {
      ...execution,
      leverage:
        brokerKey === 'mudrex' && observedLeverage !== null
          ? observedLeverage
          : (execution.leverage ?? null),
      orderStatus:
        activePositionEvidence &&
        !['CANCELLED', 'REJECTED', 'EXPIRED', 'FAILED'].includes(
          this.normalizeOrderStatus(execution.orderStatus) ?? ''
        )
          ? 'FILLED'
          : (execution.orderStatus ?? null),
      positionId: candidate.externalId || execution.positionId || null,
      positionStatus,
      filledAt:
        execution.filledAt ??
        backfilledDeltaFilledAt ??
        (activePositionEvidence ? positionObservedFillAt : null),
      filledPrice: execution.filledPrice ?? (activePositionEvidence ? positionEntryPrice : null),
      filledQuantity:
        execution.filledQuantity ?? (activePositionEvidence ? positionQuantity : null),
      remainingQuantity:
        execution.remainingQuantity ?? (activePositionEvidence && positionQuantity ? 0 : null),
      positionOpenedAt,
      positionClosedAt:
        positionStatus === 'OPEN' || positionStatus === 'PARTIAL'
          ? null
          : (this.toIsoString(candidate.payload?.closed_at) ??
            this.toIsoString(candidate.payload?.closedAt) ??
            (positionStatus === 'CLOSED' || positionStatus === 'LIQUIDATED'
              ? (this.toIsoString(candidate.payload?.updated_at) ??
                this.toIsoString(candidate.payload?.updatedAt) ??
                this.toIsoString(candidate.lastSeenAt) ??
                execution.positionClosedAt ??
                null)
              : (execution.positionClosedAt ?? null))),
      exitPrice:
        this.readStringValue(candidate.payload?.closed_price) ??
        this.readStringValue(candidate.payload?.closedPrice) ??
        execution.exitPrice ??
        null,
      realizedPnl,
      outcome,
      note: leverageDriftMessage
        ? this.appendExecutionNote(execution.note, leverageDriftMessage)
        : (execution.note ?? null),
      executionState:
        positionStatus === 'CLOSED' || positionStatus === 'LIQUIDATED'
          ? 'closed'
          : (positionStatus === 'OPEN' || positionStatus === 'PARTIAL') &&
              (this.isExecutionOrderFilled(execution) || activePositionEvidence)
            ? 'filled'
            : (execution.executionState ?? null),
    };
  }

  private resolveObservedPositionLeverage(
    payload: Record<string, unknown> | null | undefined
  ): number | null {
    if (!payload) {
      return null;
    }
    return this.readNumberValue(
      payload.leverage ?? payload.position_leverage ?? payload.leverageValue ?? null
    );
  }

  private isExecutionPositionClosed(
    execution: SuggestedTradeExecutionLink,
    snapshots: Array<{
      externalId: string;
      status: string | null;
      statusRank: number | null;
      firstSeenAt: Date | string | null;
      lastSeenAt: Date | string | null;
      payload: Record<string, unknown> | null;
    }>
  ): boolean {
    if (this.isActiveUnfilledLiveEntryOrder(execution)) {
      return false;
    }

    const normalizedExecutionStatus = this.normalizePositionStatus(execution.positionStatus);
    if (normalizedExecutionStatus === 'CLOSED' || normalizedExecutionStatus === 'LIQUIDATED') {
      return this.isExecutionPositionClosureAfterFill(execution);
    }

    const relevantSnapshots = snapshots.filter((snapshot) =>
      this.isPositionCandidateFillTimeCompatible(execution, snapshot)
    );
    if (!relevantSnapshots.length) {
      return false;
    }

    return relevantSnapshots.every((snapshot) => {
      const normalizedStatus = this.normalizePositionStatus(
        this.readStringValue(snapshot.status) ??
          this.readStringValue(snapshot.payload?.status) ??
          null
      );
      return normalizedStatus === 'CLOSED' || normalizedStatus === 'LIQUIDATED';
    });
  }

  private isExecutionPositionClosureAfterFill(execution: SuggestedTradeExecutionLink): boolean {
    const filledMs = this.toTimestamp(execution.filledAt);
    const closedMs = this.toTimestamp(execution.positionClosedAt);
    if (!filledMs || !closedMs) {
      return true;
    }
    return closedMs >= filledMs - 60 * 1000;
  }

  private async resolveLiveProtectionOrderContext(
    userId: string,
    suggestedTradeId: string,
    brokerKey: string,
    accountId: string,
    orderId: string,
    positionPayload?: Record<string, unknown> | null
  ): Promise<LiveProtectionOrderContext> {
    const positionOrderIds = positionPayload
      ? this.resolveProtectionOrderIdsFromPositionPayload(positionPayload)
      : { stopLossOrderId: null, takeProfitOrderId: null };
    const planRows = (await coreDataSource.query(
      `SELECT NULLIF(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(protection_plan_json, '$.stopLossOrderId')), 'null'), '') AS stopLossOrderId,
              NULLIF(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(protection_plan_json, '$.takeProfitOrderId')), 'null'), '') AS takeProfitOrderId
         FROM suggested_trade_executions
        WHERE user_id = ?
          AND suggested_trade_id = ?
          AND account_id = ?
          AND LOWER(COALESCE(broker_key, '')) = ?
          AND COALESCE(order_id, '') = ?
        LIMIT 1`,
      [userId, suggestedTradeId, accountId, brokerKey.toLowerCase(), orderId]
    )) as Array<{
      stopLossOrderId?: string | null;
      takeProfitOrderId?: string | null;
    }>;
    const planOrderIds = {
      stopLossOrderId: this.readStringValue(planRows[0]?.stopLossOrderId),
      takeProfitOrderId: this.readStringValue(planRows[0]?.takeProfitOrderId),
    };

    const rows = (await coreDataSource.query(
      `SELECT NULLIF(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(response_json, '$.stop_loss_order_id')), 'null'), '') AS stopLossOrderId,
              NULLIF(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(response_json, '$.data.stop_loss_order_id')), 'null'), '') AS stopLossOrderIdNested,
              NULLIF(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(response_json, '$.take_profit_order_id')), 'null'), '') AS takeProfitOrderId,
              NULLIF(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(response_json, '$.data.take_profit_order_id')), 'null'), '') AS takeProfitOrderIdNested
         FROM order_submission_requests
        WHERE user_id = ?
          AND suggested_trade_id = ?
          AND account_id = ?
          AND LOWER(COALESCE(broker_key, '')) = ?
          AND status = 'completed'
          AND placement_state IN ('placed', 'replayed')
          AND broker_order_id = ?
        ORDER BY created_at DESC
        LIMIT 1`,
      [userId, suggestedTradeId, accountId, brokerKey.toLowerCase(), orderId]
    )) as Array<{
      stopLossOrderId?: string | null;
      stopLossOrderIdNested?: string | null;
      takeProfitOrderId?: string | null;
      takeProfitOrderIdNested?: string | null;
    }>;
    const row = rows[0] ?? {};
    const responseOrderIds = {
      stopLossOrderId:
        this.readStringValue(row.stopLossOrderId) ??
        this.readStringValue(row.stopLossOrderIdNested),
      takeProfitOrderId:
        this.readStringValue(row.takeProfitOrderId) ??
        this.readStringValue(row.takeProfitOrderIdNested),
    };
    const candidatePairs = [
      positionOrderIds,
      planOrderIds,
      responseOrderIds,
      {
        stopLossOrderId: positionOrderIds.stopLossOrderId,
        takeProfitOrderId: planOrderIds.takeProfitOrderId ?? responseOrderIds.takeProfitOrderId,
      },
      {
        stopLossOrderId: planOrderIds.stopLossOrderId ?? responseOrderIds.stopLossOrderId,
        takeProfitOrderId: positionOrderIds.takeProfitOrderId,
      },
    ].filter(
      (candidate, index, candidates) =>
        Boolean(candidate.stopLossOrderId || candidate.takeProfitOrderId) &&
        candidates.findIndex(
          (item) =>
            item.stopLossOrderId === candidate.stopLossOrderId &&
            item.takeProfitOrderId === candidate.takeProfitOrderId
        ) === index
    );

    const trackedOrderIds = [
      ...new Set(
        candidatePairs.flatMap((pair) => [pair.stopLossOrderId ?? '', pair.takeProfitOrderId ?? ''])
      ),
    ].filter((value): value is string => Boolean(value));
    const fallbackPair = candidatePairs[0] ?? { stopLossOrderId: null, takeProfitOrderId: null };
    if (!trackedOrderIds.length) {
      return {
        stopLossOrderId: fallbackPair.stopLossOrderId,
        takeProfitOrderId: fallbackPair.takeProfitOrderId,
        stopLossStatus: null,
        takeProfitStatus: null,
        activeOrderIds: [],
        orderDetails: {},
      };
    }

    const snapshots = (await coreDataSource.query(
      `SELECT external_id AS externalId,
              order_status AS orderStatus,
              status_rank AS statusRank,
              JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.quantity')) AS quantity,
              JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.size')) AS size,
              JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.filled_quantity')) AS filledQuantity,
              JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.filledQuantity')) AS filledQuantityCamel,
              JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.remaining_quantity')) AS remainingQuantity,
              JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.remainingQuantity')) AS remainingQuantityCamel,
              JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.unfilled_size')) AS unfilledSize
         FROM scheduler_orders_snapshots
        WHERE user_id = ?
          AND account_id = ?
          AND LOWER(broker_key) = ?
          AND external_id IN (${trackedOrderIds.map(() => '?').join(', ')})`,
      [userId, accountId, brokerKey.toLowerCase(), ...trackedOrderIds]
    )) as Array<{
      externalId?: string | null;
      orderStatus?: string | null;
      statusRank?: number | string | null;
      quantity?: string | number | null;
      size?: string | number | null;
      filledQuantity?: string | number | null;
      filledQuantityCamel?: string | number | null;
      remainingQuantity?: string | number | null;
      remainingQuantityCamel?: string | number | null;
      unfilledSize?: string | number | null;
      stopPrice?: string | number | null;
      stopPriceCamel?: string | number | null;
      triggerPrice?: string | number | null;
      triggerPriceCamel?: string | number | null;
      price?: string | number | null;
      limitPrice?: string | number | null;
      limitPriceCamel?: string | number | null;
      stopOrderType?: string | null;
      stopOrderTypeCamel?: string | null;
    }>;

    const snapshotById = new Map(
      snapshots
        .map(
          (snapshot) =>
            [
              this.readStringValue(snapshot.externalId),
              {
                status: this.normalizeOrderStatus(this.readStringValue(snapshot.orderStatus)),
                statusRank:
                  snapshot.statusRank === undefined || snapshot.statusRank === null
                    ? null
                    : Number(snapshot.statusRank),
                quantity:
                  this.readNumberValue(snapshot.quantity) ?? this.readNumberValue(snapshot.size),
                filledQuantity:
                  this.readNumberValue(snapshot.filledQuantity) ??
                  this.readNumberValue(snapshot.filledQuantityCamel),
                remainingQuantity:
                  this.readNumberValue(snapshot.remainingQuantity) ??
                  this.readNumberValue(snapshot.remainingQuantityCamel) ??
                  this.readNumberValue(snapshot.unfilledSize),
                stopPrice:
                  this.readNumberValue(snapshot.stopPrice) ??
                  this.readNumberValue(snapshot.stopPriceCamel) ??
                  this.readNumberValue(snapshot.triggerPrice) ??
                  this.readNumberValue(snapshot.triggerPriceCamel) ??
                  this.readNumberValue(snapshot.price),
                limitPrice:
                  this.readNumberValue(snapshot.limitPrice) ??
                  this.readNumberValue(snapshot.limitPriceCamel),
                stopOrderType:
                  this.readStringValue(snapshot.stopOrderType) ??
                  this.readStringValue(snapshot.stopOrderTypeCamel),
              },
            ] as const
        )
        .filter(
          (
            entry
          ): entry is [
            string,
            {
              status: string | null;
              statusRank: number | null;
              quantity: number | null;
              filledQuantity: number | null;
              remainingQuantity: number | null;
              stopPrice: number | null;
              limitPrice: number | null;
              stopOrderType: string | null;
            },
          ] => Boolean(entry[0])
        )
    );

    const orderDetails = Object.fromEntries(
      Array.from(snapshotById.entries()).map(([orderId, detail]) => {
        const remainingQuantity =
          detail.remainingQuantity ??
          (detail.quantity !== null && detail.filledQuantity !== null
            ? Math.max(0, detail.quantity - detail.filledQuantity)
            : null);
        return [
          orderId,
          {
            status: detail.status,
            quantity: detail.quantity,
            filledQuantity: detail.filledQuantity,
            remainingQuantity,
            stopPrice: detail.stopPrice,
            limitPrice: detail.limitPrice,
            stopOrderType: detail.stopOrderType,
          },
        ];
      })
    );

    const activeOrderIds = trackedOrderIds.filter((trackedOrderId) => {
      const snapshot = snapshotById.get(trackedOrderId);
      return this.isActiveLiveProtectionOrder(
        snapshot?.status ?? null,
        snapshot?.statusRank ?? null
      );
    });
    const selectedPair =
      candidatePairs.find(
        (pair) =>
          Boolean(pair.stopLossOrderId && pair.takeProfitOrderId) &&
          activeOrderIds.includes(pair.stopLossOrderId!) &&
          activeOrderIds.includes(pair.takeProfitOrderId!)
      ) ??
      candidatePairs.find((pair) =>
        [pair.stopLossOrderId, pair.takeProfitOrderId].some((orderId) =>
          orderId ? activeOrderIds.includes(orderId) : false
        )
      ) ??
      fallbackPair;

    const stopLossStatus = selectedPair.stopLossOrderId
      ? (snapshotById.get(selectedPair.stopLossOrderId)?.status ?? null)
      : null;
    const takeProfitStatus = selectedPair.takeProfitOrderId
      ? (snapshotById.get(selectedPair.takeProfitOrderId)?.status ?? null)
      : null;

    return {
      stopLossOrderId: selectedPair.stopLossOrderId,
      takeProfitOrderId: selectedPair.takeProfitOrderId,
      stopLossStatus,
      takeProfitStatus,
      activeOrderIds,
      orderDetails,
    };
  }

  private isActiveLiveProtectionOrder(
    orderStatus: string | null,
    statusRank: number | null
  ): boolean {
    if (orderStatus && ['OPEN', 'PENDING', 'PARTIALLY_FILLED'].includes(orderStatus)) {
      return true;
    }
    return Boolean(statusRank && statusRank > 0 && statusRank <= 2);
  }

  private selectBestPositionCandidate(
    trade: SuggestedTrade,
    execution: SuggestedTradeExecutionLink,
    snapshots: Array<{
      externalId: string;
      status: string | null;
      statusRank: number | null;
      firstSeenAt: Date | string | null;
      lastSeenAt: Date | string | null;
      payload: Record<string, unknown> | null;
    }>,
    options: { allowPositionEvidenceFill?: boolean } = {}
  ): {
    externalId: string;
    status: string | null;
    statusRank: number | null;
    firstSeenAt: Date | string | null;
    lastSeenAt: Date | string | null;
    payload: Record<string, unknown> | null;
  } | null {
    if (this.isUnfilledTerminalEntryExecution(execution)) {
      return null;
    }
    const canUseActivePositionEvidence =
      options.allowPositionEvidenceFill === true && this.hasOpenPositionSnapshot(snapshots);
    if (this.isActiveUnfilledLiveEntryOrder(execution) && !canUseActivePositionEvidence) {
      return null;
    }

    const expectedDirection = String(trade.side || '').toUpperCase() === 'SELL' ? 'short' : 'long';
    const linkedPositionId = this.readStringValue(execution.positionId);
    if (
      !linkedPositionId &&
      !this.isExecutionOrderFilled(execution) &&
      options.allowPositionEvidenceFill !== true
    ) {
      return null;
    }
    const preferOpenPosition = this.shouldPreferOpenPositionCandidate(execution, trade);
    const anchorMs = this.toTimestamp(
      execution.filledAt ??
        execution.submittedAt ??
        execution.linkedAt ??
        trade.signalTime.toISOString()
    );
    const expectedEntry = this.readNumberValue(execution.entryPrice);
    const expectedQuantity = execution.quantity ?? null;

    let best: {
      score: number;
      snapshot: {
        externalId: string;
        status: string | null;
        statusRank: number | null;
        firstSeenAt: Date | string | null;
        lastSeenAt: Date | string | null;
        payload: Record<string, unknown> | null;
      };
    } | null = null;

    for (const snapshot of snapshots) {
      const payload = snapshot.payload ?? {};
      const direction = this.resolvePositionDirection(payload, snapshot.externalId);
      if (direction !== expectedDirection) {
        continue;
      }
      if (!this.isPositionCandidateFillTimeCompatible(execution, snapshot)) {
        continue;
      }

      const exactPositionMatch =
        Boolean(linkedPositionId) && snapshot.externalId === linkedPositionId;
      const eventMs =
        this.toTimestamp(payload.closed_at) ??
        this.toTimestamp(payload.updated_at) ??
        this.toTimestamp(payload.created_at) ??
        this.toTimestamp(snapshot.lastSeenAt) ??
        0;
      const createdMs =
        this.toTimestamp(payload.created_at) ?? this.toTimestamp(snapshot.firstSeenAt) ?? eventMs;

      let score = 0;
      if (createdMs >= anchorMs - 15 * 60 * 1000) {
        score += 35;
      } else if (eventMs >= anchorMs - 6 * 60 * 60 * 1000) {
        score += 20;
      } else {
        score += 5;
      }

      const status = this.normalizePositionStatus(
        this.readStringValue(snapshot.status) ?? this.readStringValue(payload.status) ?? null
      );
      if (
        this.isActiveUnfilledLiveEntryOrder(execution) &&
        (status === 'CLOSED' || status === 'LIQUIDATED')
      ) {
        continue;
      }
      if (
        !linkedPositionId &&
        options.allowPositionEvidenceFill === true &&
        !this.isExecutionOrderFilled(execution) &&
        (status === 'CLOSED' || status === 'LIQUIDATED')
      ) {
        continue;
      }
      if (exactPositionMatch) {
        score += preferOpenPosition && (status === 'CLOSED' || status === 'LIQUIDATED') ? 15 : 80;
      }
      if (status === 'CLOSED' || status === 'LIQUIDATED') {
        score += preferOpenPosition ? 0 : 20;
      } else if (status === 'OPEN' || status === 'PARTIAL') {
        score += preferOpenPosition ? 30 : 10;
      }

      const entryPrice = this.readNumberValue(payload.entry_price);
      if (expectedEntry && entryPrice) {
        const drift = Math.abs(entryPrice - expectedEntry) / Math.max(expectedEntry, 1e-9);
        if (drift <= 0.005) {
          score += 15;
        } else if (drift <= 0.02) {
          score += 8;
        }
      }

      const quantity = this.readNumberValue(payload.quantity);
      if (expectedQuantity && quantity) {
        const ratio = Math.abs(quantity - expectedQuantity) / Math.max(expectedQuantity, 1e-9);
        if (ratio <= 0.2) {
          score += 10;
        } else if (ratio <= 0.6) {
          score += 4;
        }
      }

      if (
        !best ||
        score > best.score ||
        (score === best.score && eventMs > this.toTimestamp(best.snapshot.lastSeenAt))
      ) {
        best = { score, snapshot };
      }
    }

    if (!best || best.score < 30) {
      return null;
    }
    return best.snapshot;
  }

  private isPositionCandidateFillTimeCompatible(
    execution: SuggestedTradeExecutionLink,
    snapshot: {
      status?: string | null;
      firstSeenAt: Date | string | null;
      lastSeenAt?: Date | string | null;
      payload: Record<string, unknown> | null;
    }
  ): boolean {
    const filledMs = this.toTimestamp(execution.filledAt);
    if (!filledMs) {
      return true;
    }

    const payload = snapshot.payload ?? {};
    const normalizedStatus = this.normalizePositionStatus(
      this.readStringValue(snapshot.status) ?? this.readStringValue(payload.status) ?? null
    );
    const explicitClosedMs =
      this.toTimestamp(payload.closed_at) ?? this.toTimestamp(payload.closedAt) ?? null;
    const inferredClosedMs =
      normalizedStatus === 'CLOSED' || normalizedStatus === 'LIQUIDATED'
        ? (this.toTimestamp(payload.updated_at) ??
          this.toTimestamp(payload.updatedAt) ??
          this.toTimestamp(snapshot.lastSeenAt) ??
          null)
        : null;
    const closedMs = explicitClosedMs ?? inferredClosedMs;
    if (closedMs && closedMs < filledMs - 60 * 1000) {
      return false;
    }

    const openedMs =
      this.toTimestamp(payload.created_at) ?? this.toTimestamp(payload.createdAt) ?? null;
    if (!openedMs) {
      return true;
    }

    const brokerKey = this.readStringValue(execution.brokerKey)?.toLowerCase();
    const toleranceMs = brokerKey === 'delta_exchange' ? 30 * 60 * 1000 : 2 * 60 * 60 * 1000;
    return openedMs <= filledMs + toleranceMs;
  }

  private shouldPreferOpenPositionCandidate(
    execution: SuggestedTradeExecutionLink,
    trade: SuggestedTrade
  ): boolean {
    if (!this.isExecutionOrderFilled(execution)) {
      return false;
    }

    const orderStatus = this.normalizeOrderStatus(execution.orderStatus);
    if (['CANCELLED', 'REJECTED', 'EXPIRED', 'FAILED'].includes(orderStatus ?? '')) {
      return false;
    }

    const outcome = this.readStringValue(execution.outcome)?.toLowerCase();
    if (!['profit', 'loss', 'breakeven'].includes(outcome ?? '')) {
      return true;
    }

    const positionStatus = this.normalizePositionStatus(execution.positionStatus);
    const positionClosedMs = this.toTimestamp(execution.positionClosedAt);
    const anchorMs = this.toTimestamp(
      execution.submittedAt ??
        execution.acceptedAt ??
        execution.linkedAt ??
        trade.createdAt ??
        trade.signalTime
    );
    if (
      anchorMs &&
      positionClosedMs &&
      positionClosedMs < anchorMs - 60 * 1000 &&
      (positionStatus === 'CLOSED' || positionStatus === 'LIQUIDATED')
    ) {
      return true;
    }

    return false;
  }

  private buildPositionSearchAnchor(anchor: string | null): Date {
    const fallback = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const parsed = anchor ? new Date(anchor) : null;
    if (!parsed || Number.isNaN(parsed.getTime())) {
      return fallback;
    }
    return new Date(parsed.getTime() - 24 * 60 * 60 * 1000);
  }

  private getExecutionLink(
    trade: SuggestedTrade | { meta?: Record<string, unknown> | null; executionRecord?: unknown }
  ): SuggestedTradeExecutionLink | null {
    return (
      this.mapExecutionRecord((trade as { executionRecord?: unknown }).executionRecord) ??
      this.extractExecutionLink(trade.meta ?? null)
    );
  }

  private mapExecutionRecord(record: unknown): SuggestedTradeExecutionLink | null {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      return null;
    }

    const execution = record as Record<string, unknown>;
    const executionMode = this.readStringValue(execution.executionMode)?.toLowerCase();

    return {
      orderId: this.readStringValue(execution.orderId),
      executionMode: executionMode === 'paper' ? 'paper' : executionMode === 'live' ? 'live' : null,
      preTradeCheckId: this.readStringValue(execution.preTradeCheckId),
      preTradeState: this.readStringValue(
        execution.preTradeState
      ) as SuggestedTradeExecutionLink['preTradeState'],
      preTradeCheckedAt: this.toIsoString(execution.preTradeCheckedAt),
      preTradeBlockedReason: this.readStringValue(execution.preTradeBlockedReason),
      acceptedBy: this.readStringValue(
        execution.acceptedBy
      ) as SuggestedTradeExecutionLink['acceptedBy'],
      acceptedAt: this.toIsoString(execution.acceptedAt),
      paperOrderId: this.readStringValue(execution.paperOrderId),
      brokerKey: this.readStringValue(execution.brokerKey),
      accountId: this.readStringValue(execution.accountId),
      orderStatus: this.readStringValue(execution.orderStatus),
      paperOrderStatus: this.readStringValue(execution.paperOrderStatus),
      executionState: this.readStringValue(
        execution.executionState
      ) as SuggestedTradeExecutionLink['executionState'],
      orderType: this.readStringValue(execution.orderType),
      triggerType: this.readStringValue(execution.triggerType),
      leverage: this.readNumberValue(execution.leverage),
      quantity: this.readNumberValue(execution.quantity),
      routeAttempts: this.normalizeRouteAttempts(execution.routeAttempts),
      entryPrice: this.readStringValue(execution.entryPrice),
      stopLossPrice: this.readStringValue(execution.stopLossPrice),
      takeProfitPrice: this.readStringValue(execution.takeProfitPrice),
      protectionState: this.normalizeProtectionState(execution.protectionState),
      protectionSource: this.readStringValue(execution.protectionSource),
      protectionPlan:
        this.readRecordValue(execution.protectionPlan) ??
        this.parseJsonRecord(execution.protectionPlan),
      protectionAttempts: this.readNumberValue(execution.protectionAttempts),
      protectionLastError: this.readStringValue(execution.protectionLastError),
      protectionCheckedAt: this.toIsoString(execution.protectionCheckedAt),
      protectionAttachedAt: this.toIsoString(execution.protectionAttachedAt),
      submittedAt: this.toIsoString(execution.submittedAt),
      linkedAt: this.toIsoString(execution.linkedAt),
      lastSeenAt: this.toIsoString(execution.lastSeenAt),
      trackedAt: this.toIsoString(execution.createdAt),
      lastSyncAt: this.toIsoString(execution.updatedAt),
      filledAt: this.toIsoString(execution.filledAt),
      canceledAt: this.toIsoString(execution.canceledAt),
      filledPrice: this.readStringValue(execution.filledPrice),
      filledQuantity: this.readNumberValue(execution.filledQuantity),
      remainingQuantity: this.readNumberValue(execution.remainingQuantity),
      positionId: this.readStringValue(execution.positionId),
      positionStatus: this.readStringValue(execution.positionStatus),
      positionOpenedAt: this.toIsoString(execution.positionOpenedAt),
      positionClosedAt: this.toIsoString(execution.positionClosedAt),
      exitPrice: this.readStringValue(execution.exitPrice),
      realizedPnl: this.readStringValue(execution.realizedPnl),
      outcome: this.readStringValue(execution.outcome) as SuggestedTradeExecutionLink['outcome'],
      note: this.readStringValue(execution.note),
    };
  }

  private async persistExecutionState(
    trade: SuggestedTrade,
    execution: SuggestedTradeExecutionLink
  ): Promise<void> {
    const legacyExecution = this.extractExecutionLink(trade.meta);
    if (legacyExecution) {
      trade.meta = this.stripExecutionMeta(trade.meta);
      const savedTrade = await this.suggestedTradeRepository.saveSuggestedTrade(trade);
      trade.meta = savedTrade.meta;
      trade.updatedAt = savedTrade.updatedAt;
    }

    trade.executionRecord = await this.suggestedTradeRepository.saveSuggestedTradeExecution(
      this.toExecutionPersistencePayload(trade, execution)
    );
  }

  private toExecutionPersistencePayload(
    trade: SuggestedTrade,
    execution: SuggestedTradeExecutionLink
  ): SuggestedTradeExecutionUpsertPayload {
    const protection = this.resolveExecutionProtectionPersistence(trade, execution);

    return {
      suggestedTradeId: trade.id,
      userId: trade.userId,
      executionMode: execution.executionMode ?? null,
      preTradeCheckId: execution.preTradeCheckId ?? null,
      preTradeState: execution.preTradeState ?? null,
      preTradeCheckedAt: execution.preTradeCheckedAt ?? null,
      preTradeBlockedReason: execution.preTradeBlockedReason ?? null,
      acceptedBy: execution.acceptedBy ?? null,
      acceptedAt: execution.acceptedAt ?? null,
      orderId: execution.orderId ?? null,
      paperOrderId: execution.paperOrderId ?? null,
      brokerKey: execution.brokerKey ?? null,
      accountId: execution.accountId ?? null,
      orderStatus: execution.orderStatus ?? null,
      paperOrderStatus: execution.paperOrderStatus ?? null,
      executionState: execution.executionState ?? null,
      orderType: execution.orderType ?? null,
      triggerType: execution.triggerType ?? null,
      leverage: execution.leverage ?? null,
      quantity: execution.quantity ?? null,
      entryPrice: execution.entryPrice ?? null,
      stopLossPrice: execution.stopLossPrice ?? null,
      takeProfitPrice: execution.takeProfitPrice ?? null,
      protectionState: protection.protectionState,
      protectionSource: protection.protectionSource,
      protectionPlan: protection.protectionPlan,
      routeAttempts: this.normalizeRouteAttempts(execution.routeAttempts),
      protectionAttempts: protection.protectionAttempts,
      protectionLastError: protection.protectionLastError,
      protectionCheckedAt: protection.protectionCheckedAt,
      protectionAttachedAt: protection.protectionAttachedAt,
      submittedAt: execution.submittedAt ?? null,
      linkedAt: execution.linkedAt ?? null,
      lastSeenAt: execution.lastSeenAt ?? null,
      filledAt: execution.filledAt ?? null,
      canceledAt: execution.canceledAt ?? null,
      filledPrice: execution.filledPrice ?? null,
      filledQuantity: execution.filledQuantity ?? null,
      remainingQuantity: execution.remainingQuantity ?? null,
      positionId: execution.positionId ?? null,
      positionStatus: execution.positionStatus ?? null,
      positionOpenedAt: execution.positionOpenedAt ?? null,
      positionClosedAt: execution.positionClosedAt ?? null,
      exitPrice: execution.exitPrice ?? null,
      realizedPnl: execution.realizedPnl ?? null,
      outcome: execution.outcome ?? null,
      note: execution.note ?? null,
    };
  }

  private resolveExecutionProtectionPersistence(
    trade: SuggestedTrade,
    execution: SuggestedTradeExecutionLink
  ): SuggestedTradeProtectionPersistence {
    const explicitPlan = this.readRecordValue(execution.protectionPlan);
    const stopLossPrice =
      this.readStringValue(execution.stopLossPrice) ?? this.readStringValue(trade.stopLossPrice);
    const takeProfitPrice =
      this.readStringValue(execution.takeProfitPrice) ??
      this.readStringValue(
        Array.isArray(trade.takeProfitTargets) ? trade.takeProfitTargets[0] : null
      );
    const entryPrice =
      this.readStringValue(execution.entryPrice) ?? this.readStringValue(trade.entryPrice);
    const liveMode = execution.executionMode === 'live';
    const hasProtectionPrices =
      (this.readNumberValue(stopLossPrice) ?? 0) > 0 &&
      (this.readNumberValue(takeProfitPrice) ?? 0) > 0;
    const protectionPlan =
      explicitPlan ??
      (liveMode && hasProtectionPrices
        ? {
            source: 'suggested_trade_execution',
            symbol: trade.symbol,
            side: trade.side,
            timeframe: trade.timeframe,
            entryPrice,
            stopLossPrice,
            takeProfitPrice,
            brokerKey: execution.brokerKey ?? null,
            accountId: execution.accountId ?? null,
            orderId: execution.orderId ?? null,
            positionId: execution.positionId ?? null,
            orderType: execution.orderType ?? null,
            triggerType: execution.triggerType ?? null,
            leverage: execution.leverage ?? null,
            quantity: execution.quantity ?? null,
          }
        : null);
    const explicitProtectionState = this.normalizeProtectionState(execution.protectionState);
    const terminalWithoutProtection =
      liveMode &&
      this.isTerminalExecutionForProtection(execution) &&
      explicitProtectionState !== 'attached';
    const protectionState = terminalWithoutProtection
      ? 'not_required'
      : (explicitProtectionState ??
        this.inferInitialProtectionState(execution, liveMode, hasProtectionPrices));

    return {
      protectionState,
      protectionSource:
        this.readStringValue(execution.protectionSource) ??
        (protectionPlan ? 'suggested_trade_execution' : null),
      protectionPlan,
      protectionAttempts: Math.max(0, Math.floor(execution.protectionAttempts ?? 0)),
      protectionLastError: terminalWithoutProtection
        ? null
        : (execution.protectionLastError ?? null),
      protectionCheckedAt:
        execution.protectionCheckedAt ??
        (terminalWithoutProtection ? new Date().toISOString() : null),
      protectionAttachedAt: execution.protectionAttachedAt ?? null,
    };
  }

  private inferInitialProtectionState(
    execution: SuggestedTradeExecutionLink,
    liveMode: boolean,
    hasProtectionPrices: boolean
  ): SuggestedTradeProtectionState {
    if (!liveMode || !hasProtectionPrices) {
      return 'not_required';
    }

    const executionState = this.readStringValue(execution.executionState)?.toLowerCase();
    const outcome = this.readStringValue(execution.outcome)?.toLowerCase();
    if (
      this.toIsoString(execution.positionClosedAt) ||
      ['closed', 'cancelled', 'rejected', 'expired', 'failed'].includes(executionState ?? '') ||
      ['profit', 'loss', 'breakeven'].includes(outcome ?? '')
    ) {
      return 'not_required';
    }

    if (!this.readStringValue(execution.orderId) && !this.readStringValue(execution.positionId)) {
      return ['queued', 'submitting'].includes(executionState ?? '') ? 'pending' : 'not_required';
    }
    if (!this.readStringValue(execution.positionId) && this.toIsoString(execution.filledAt)) {
      return 'waiting_for_position';
    }
    if (!this.readStringValue(execution.positionId)) {
      return 'waiting_for_fill';
    }
    return 'pending';
  }

  private stripExecutionMeta(
    meta: Record<string, unknown> | null | undefined
  ): Record<string, unknown> | null {
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
      return null;
    }

    const nextMeta = { ...meta };
    if (!('execution' in nextMeta)) {
      return nextMeta;
    }

    delete nextMeta.execution;
    return Object.keys(nextMeta).length ? nextMeta : null;
  }

  private extractExecutionLink(
    meta: Record<string, unknown> | null | undefined
  ): SuggestedTradeExecutionLink | null {
    if (!meta || typeof meta !== 'object') {
      return null;
    }

    const executionValue = meta.execution;
    if (!executionValue || typeof executionValue !== 'object' || Array.isArray(executionValue)) {
      return null;
    }
    const execution = executionValue as Record<string, unknown>;

    const readNumber = (value: unknown): number | null => {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : null;
    };

    const readString = (value: unknown): string | null => {
      if (value === undefined || value === null) {
        return null;
      }
      const normalized = String(value).trim();
      return normalized ? normalized : null;
    };

    return {
      orderId: readString(execution.orderId),
      executionMode: (() => {
        const raw = readString(execution.executionMode)?.toLowerCase();
        return raw === 'paper' ? 'paper' : raw === 'live' ? 'live' : null;
      })(),
      preTradeCheckId: readString(execution.preTradeCheckId),
      preTradeState: readString(
        execution.preTradeState
      ) as SuggestedTradeExecutionLink['preTradeState'],
      preTradeCheckedAt: readString(execution.preTradeCheckedAt),
      preTradeBlockedReason: readString(execution.preTradeBlockedReason),
      acceptedBy: readString(execution.acceptedBy) as SuggestedTradeExecutionLink['acceptedBy'],
      acceptedAt: readString(execution.acceptedAt),
      paperOrderId: readString(execution.paperOrderId),
      brokerKey: readString(execution.brokerKey),
      accountId: readString(execution.accountId),
      orderStatus: readString(execution.orderStatus),
      paperOrderStatus: readString(execution.paperOrderStatus),
      executionState: readString(
        execution.executionState
      ) as SuggestedTradeExecutionLink['executionState'],
      orderType: readString(execution.orderType),
      triggerType: readString(execution.triggerType),
      leverage: readNumber(execution.leverage),
      quantity: readNumber(execution.quantity),
      routeAttempts: this.normalizeRouteAttempts(execution.routeAttempts),
      entryPrice: readString(execution.entryPrice),
      stopLossPrice: readString(execution.stopLossPrice),
      takeProfitPrice: readString(execution.takeProfitPrice),
      protectionState: this.normalizeProtectionState(execution.protectionState),
      protectionSource: readString(execution.protectionSource),
      protectionPlan:
        this.readRecordValue(execution.protectionPlan) ??
        this.parseJsonRecord(execution.protectionPlan),
      protectionAttempts: readNumber(execution.protectionAttempts),
      protectionLastError: readString(execution.protectionLastError),
      protectionCheckedAt: readString(execution.protectionCheckedAt),
      protectionAttachedAt: readString(execution.protectionAttachedAt),
      submittedAt: readString(execution.submittedAt),
      linkedAt: readString(execution.linkedAt),
      lastSeenAt: readString(execution.lastSeenAt),
      trackedAt: null,
      lastSyncAt: null,
      filledAt: readString(execution.filledAt),
      canceledAt: readString(execution.canceledAt),
      filledPrice: readString(execution.filledPrice),
      filledQuantity: readNumber(execution.filledQuantity),
      remainingQuantity: readNumber(execution.remainingQuantity),
      positionId: readString(execution.positionId),
      positionStatus: readString(execution.positionStatus),
      positionOpenedAt: readString(execution.positionOpenedAt),
      positionClosedAt: readString(execution.positionClosedAt),
      exitPrice: readString(execution.exitPrice),
      realizedPnl: readString(execution.realizedPnl),
      outcome: readString(execution.outcome) as SuggestedTradeExecutionLink['outcome'],
      note: readString(execution.note),
    };
  }

  private normalizeOrderStatus(status: string | null | undefined): string | null {
    const raw = String(status || '').trim();
    if (!raw) {
      return null;
    }

    const normalized = raw.toUpperCase();
    if (['OPEN', 'NEW', 'CREATED'].includes(normalized)) return 'OPEN';
    if (['PENDING', 'TRIGGER_PENDING'].includes(normalized)) return 'PENDING';
    if (['PARTIALLY_FILLED', 'PARTIAL_FILLED', 'PARTIAL'].includes(normalized)) {
      return 'PARTIALLY_FILLED';
    }
    if (['FILLED', 'COMPLETED', 'EXECUTED'].includes(normalized)) return 'FILLED';
    if (['CANCELLED', 'CANCELED'].includes(normalized)) return 'CANCELLED';
    if (['CLOSED'].includes(normalized)) return 'CLOSED';
    if (['REJECTED'].includes(normalized)) return 'REJECTED';
    if (['EXPIRED'].includes(normalized)) return 'EXPIRED';
    if (['FAILED'].includes(normalized)) return 'FAILED';
    return normalized;
  }

  private mapExecutionState(
    orderStatus: string | null,
    statusRank: number | null
  ): SuggestedTradeExecutionLink['executionState'] {
    const normalized = String(orderStatus || '')
      .trim()
      .toUpperCase();
    if (['OPEN', 'PENDING', 'PARTIALLY_FILLED'].includes(normalized)) {
      return 'working';
    }
    if (normalized === 'FILLED') {
      return 'filled';
    }
    if (normalized === 'CANCELLED') {
      return 'cancelled';
    }
    if (normalized === 'REJECTED') {
      return 'rejected';
    }
    if (normalized === 'EXPIRED') {
      return 'expired';
    }
    if (normalized === 'FAILED') {
      return 'failed';
    }
    if (normalized === 'CLOSED') {
      return 'closed';
    }
    if (statusRank && statusRank > 0 && statusRank <= 2) {
      return 'working';
    }
    return existingExecutionStateFallback(orderStatus);
  }

  private normalizePositionStatus(status: string | null | undefined): string | null {
    const raw = String(status || '').trim();
    if (!raw) {
      return null;
    }

    const normalized = raw.toUpperCase();
    if (['OPEN'].includes(normalized)) return 'OPEN';
    if (['CLOSED', 'CLOSE'].includes(normalized)) return 'CLOSED';
    if (['LIQUIDATED', 'LIQUIDATION'].includes(normalized)) return 'LIQUIDATED';
    if (['PARTIAL', 'PARTIALLY_CLOSED', 'PARTIALLY_CLOSED_POSITION'].includes(normalized)) {
      return 'PARTIAL';
    }
    return normalized;
  }

  private appendExecutionNote(existingNote: string | null | undefined, message: string): string {
    const existing = String(existingNote || '').trim();
    const next = String(message || '').trim();
    if (!existing) {
      return next;
    }
    if (!next || existing.includes(next)) {
      return existing;
    }
    return `${existing} ${next}`.trim();
  }

  private resolvePositionDirection(
    payload: Record<string, unknown>,
    externalId?: string | null
  ): 'long' | 'short' {
    const side = String(payload.side ?? '')
      .trim()
      .toLowerCase();
    const positionType = String(payload.position_type ?? '')
      .trim()
      .toLowerCase();
    const orderType = String(payload.order_type ?? '')
      .trim()
      .toLowerCase();

    if (
      side === 'short' ||
      side === 'sell' ||
      positionType === 'short' ||
      orderType === 'sell' ||
      orderType === 'short'
    ) {
      return 'short';
    }
    const externalIdSide = String(externalId || '')
      .trim()
      .split(':')
      .pop()
      ?.toLowerCase();
    if (externalIdSide === 'short' || externalIdSide === 'sell') {
      return 'short';
    }
    return 'long';
  }

  private deriveOutcome(
    positionStatus: string | null,
    realizedPnl: string | null
  ): SuggestedTradeExecutionLink['outcome'] {
    if (positionStatus === 'OPEN' || positionStatus === 'PARTIAL') {
      return 'open';
    }
    const numeric = this.readNumberValue(realizedPnl);
    if (numeric === null) {
      return positionStatus ? 'unknown' : null;
    }
    if (numeric > 0) {
      return 'profit';
    }
    if (numeric < 0) {
      return 'loss';
    }
    return 'breakeven';
  }

  private readStringValue(value: unknown): string | null {
    if (value === undefined || value === null) {
      return null;
    }
    const normalized = String(value).trim();
    return normalized ? normalized : null;
  }

  private normalizeProtectionState(value: unknown): SuggestedTradeProtectionState | null {
    const normalized = this.readStringValue(value)?.toLowerCase();
    if (
      !normalized ||
      !SUGGESTED_TRADE_PROTECTION_STATES.has(normalized as SuggestedTradeProtectionState)
    ) {
      return null;
    }
    return normalized as SuggestedTradeProtectionState;
  }

  private isRemediableProtectionState(
    value: SuggestedTradeProtectionState | null | undefined
  ): boolean {
    return Boolean(value && REMEDIABLE_SUGGESTED_TRADE_PROTECTION_STATES.has(value));
  }

  private readRecordValue(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    return value as Record<string, unknown>;
  }

  private normalizeRouteAttempts(value: unknown): SuggestedTradeRouteAttempt[] | null {
    const rawAttempts = this.readArrayValue(value);
    if (!rawAttempts?.length) {
      return null;
    }

    const attempts = rawAttempts
      .map((item, index): SuggestedTradeRouteAttempt | null => {
        const record = this.readRecordValue(item);
        if (!record) {
          return null;
        }

        const brokerKey = this.readStringValue(record.brokerKey);
        const requestedSymbol = this.readStringValue(record.requestedSymbol);
        const brokerSymbol = this.readStringValue(record.brokerSymbol) ?? requestedSymbol;
        if (!brokerKey || !requestedSymbol || !brokerSymbol) {
          return null;
        }

        return {
          attemptNumber: Math.max(
            1,
            Math.floor(this.readNumberValue(record.attemptNumber) ?? index + 1)
          ),
          candidateRank: Math.max(
            1,
            Math.floor(this.readNumberValue(record.candidateRank) ?? index + 1)
          ),
          brokerKey,
          accountId: this.readStringValue(record.accountId),
          accountName: this.readStringValue(record.accountName),
          requestedSymbol,
          brokerSymbol,
          status: this.normalizeRouteAttemptStatus(record.status),
          startedAt: this.toIsoString(record.startedAt),
          finishedAt: this.toIsoString(record.finishedAt),
          preTradeCheckId: this.readStringValue(record.preTradeCheckId),
          preTradeState: this.normalizeRouteAttemptPreTradeState(record.preTradeState),
          submissionState: this.normalizeRouteAttemptSubmissionState(record.submissionState),
          orderId: this.readStringValue(record.orderId),
          orderStatus: this.readStringValue(record.orderStatus),
          failureClassification: this.normalizeRouteAttemptFailureClassification(
            record.failureClassification
          ),
          failureCode: this.readStringValue(record.failureCode),
          failureMessage: this.readStringValue(record.failureMessage),
          requestSummary:
            this.readRecordValue(record.requestSummary) ??
            this.parseJsonRecord(record.requestSummary),
          brokerResponseSummary:
            this.readRecordValue(record.brokerResponseSummary) ??
            this.parseJsonRecord(record.brokerResponseSummary),
          reconciliation: this.normalizeRouteAttemptReconciliation(record.reconciliation),
          note: this.readStringValue(record.note),
        };
      })
      .filter((attempt): attempt is SuggestedTradeRouteAttempt => attempt !== null);

    return attempts.length ? attempts : null;
  }

  private readArrayValue(value: unknown): unknown[] | null {
    if (Array.isArray(value)) {
      return value;
    }
    if (typeof value !== 'string' || !value.trim()) {
      return null;
    }
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  private normalizeRouteAttemptStatus(value: unknown): SuggestedTradeRouteAttempt['status'] {
    const normalized = this.readStringValue(value)?.toLowerCase();
    if (
      normalized === 'pending' ||
      normalized === 'pre_trade_blocked' ||
      normalized === 'submitting' ||
      normalized === 'working' ||
      normalized === 'placed' ||
      normalized === 'failed' ||
      normalized === 'manual_review'
    ) {
      return normalized;
    }
    return 'unknown';
  }

  private normalizeRouteAttemptPreTradeState(
    value: unknown
  ): SuggestedTradeRouteAttempt['preTradeState'] {
    const normalized = this.readStringValue(value)?.toLowerCase();
    if (
      normalized === 'not_requested' ||
      normalized === 'queued' ||
      normalized === 'passed' ||
      normalized === 'blocked' ||
      normalized === 'stale' ||
      normalized === 'error'
    ) {
      return normalized;
    }
    return null;
  }

  private normalizeRouteAttemptSubmissionState(
    value: unknown
  ): SuggestedTradeRouteAttempt['submissionState'] {
    const normalized = this.readStringValue(value)?.toLowerCase();
    if (
      normalized === 'not_started' ||
      normalized === 'pre_trade' ||
      normalized === 'submitting' ||
      normalized === 'submitted' ||
      normalized === 'accepted' ||
      normalized === 'rejected' ||
      normalized === 'failed' ||
      normalized === 'unknown'
    ) {
      return normalized;
    }
    return null;
  }

  private normalizeRouteAttemptFailureClassification(
    value: unknown
  ): SuggestedTradeRouteAttempt['failureClassification'] {
    const normalized = this.readStringValue(value)?.toLowerCase();
    if (
      normalized === 'confirmed_no_order' ||
      normalized === 'ambiguous' ||
      normalized === 'order_created_protection_unresolved' ||
      normalized === 'unknown'
    ) {
      return normalized;
    }
    return null;
  }

  private normalizeRouteAttemptReconciliation(
    value: unknown
  ): SuggestedTradeRouteAttempt['reconciliation'] {
    const record = this.readRecordValue(value) ?? this.parseJsonRecord(value);
    if (!record) {
      return null;
    }

    const status = this.normalizeRouteAttemptReconciliationStatus(record.status);
    if (!status) {
      return null;
    }

    return {
      status,
      checkedAt: this.toIsoString(record.checkedAt),
      orderId: this.readStringValue(record.orderId),
      positionId: this.readStringValue(record.positionId),
      message: this.readStringValue(record.message),
    };
  }

  private normalizeRouteAttemptReconciliationStatus(
    value: unknown
  ): NonNullable<SuggestedTradeRouteAttempt['reconciliation']>['status'] | null {
    const normalized = this.readStringValue(value)?.toLowerCase();
    if (
      normalized === 'not_required' ||
      normalized === 'pending' ||
      normalized === 'confirmed_no_order' ||
      normalized === 'found_order' ||
      normalized === 'found_position' ||
      normalized === 'inconclusive' ||
      normalized === 'failed'
    ) {
      return normalized;
    }
    return null;
  }

  private parseJsonRecord(value: unknown): Record<string, unknown> | null {
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

  private extractTrackedBalanceFromFundsSnapshot(
    snapshot: {
      broker_key?: string | null;
      wallet_funds_json?: unknown;
      futures_funds_json?: unknown;
    } | null
  ): number | null {
    if (!snapshot) {
      return null;
    }

    const brokerKey = String(snapshot.broker_key || '')
      .trim()
      .toLowerCase();
    const futuresFunds = this.parseJsonRecord(snapshot.futures_funds_json);
    const walletFunds = this.parseJsonRecord(snapshot.wallet_funds_json);
    const futuresBalance = this.extractFundsBalanceFromPayload(futuresFunds, brokerKey);
    const walletBalance = this.extractFundsBalanceFromPayload(walletFunds, brokerKey);
    return futuresBalance ?? walletBalance;
  }

  private extractFundsBalanceFromPayload(
    payload: Record<string, unknown> | null,
    brokerKey?: string
  ): number | null {
    if (!payload) {
      return null;
    }

    const equityLikeBalance = this.readNumberValue(
      payload.equity ??
        payload.futures_equity ??
        payload.futuresEquity ??
        payload.margin_balance ??
        payload.marginBalance ??
        payload.total_balance ??
        payload.totalBalance ??
        payload.account_equity ??
        payload.accountEquity
    );
    if (equityLikeBalance !== null) {
      return equityLikeBalance;
    }

    const totalBalance = this.readNumberValue(
      payload.total ?? payload.wallet_balance ?? payload.walletBalance
    );
    if (totalBalance !== null) {
      return totalBalance;
    }

    const balance = this.readNumberValue(payload.balance);
    const lockedAmount = this.readNumberValue(payload.locked_amount ?? payload.lockedAmount);
    if (
      String(brokerKey || '')
        .trim()
        .toLowerCase() === 'mudrex' &&
      balance !== null
    ) {
      return Number((balance + Math.max(0, lockedAmount ?? 0)).toFixed(2));
    }

    return this.readNumberValue(
      payload.balance ??
        payload.available_balance ??
        payload.availableBalance ??
        payload.free_balance ??
        payload.freeBalance
    );
  }

  private readStringEnvOverride(name: string): string | null {
    const raw = process.env[name];
    return raw !== undefined ? String(raw).trim() : null;
  }

  private readBooleanEnvOverride(name: string): boolean | null {
    const raw = process.env[name];
    return raw !== undefined ? this.readBooleanValue(raw) : null;
  }

  private readArrayEnvOverride(name: string): string[] | null {
    const raw = process.env[name];
    if (raw === undefined) {
      return null;
    }
    return String(raw)
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private readBooleanValue(value: unknown): boolean | null {
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'number') {
      return value !== 0;
    }
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['true', '1', 'yes'].includes(normalized)) {
        return true;
      }
      if (['false', '0', 'no'].includes(normalized)) {
        return false;
      }
    }
    return null;
  }

  private readNumberValue(value: unknown): number | null {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }

  private formatNumericString(value: number | null | undefined): string | null {
    return value !== null && value !== undefined && Number.isFinite(value) ? String(value) : null;
  }

  private toIsoString(value: unknown): string | null {
    if (!value) {
      return null;
    }

    const date = value instanceof Date ? value : new Date(String(value));
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    return date.toISOString();
  }

  private toTimestamp(value: unknown): number {
    if (!value) {
      return 0;
    }
    const date = value instanceof Date ? value : new Date(String(value));
    return Number.isNaN(date.getTime()) ? 0 : date.getTime();
  }
}

const existingExecutionStateFallback = (
  orderStatus: string | null
): SuggestedTradeExecutionLink['executionState'] => {
  return orderStatus ? 'unknown' : 'linked';
};
