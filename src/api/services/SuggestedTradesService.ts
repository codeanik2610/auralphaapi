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
  SuggestedTradeStatus,
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
import { OperationalEventService } from './OperationalEventService';
import { PaperOrderExecutionService } from './PaperOrderExecutionService';
import { BrokerReferenceDataService } from './BrokerReferenceDataService';
import { RiskPreTradeService } from './RiskPreTradeService';
import { RiskKillSwitchService } from './RiskKillSwitchService';
import {
  describeDeltaActiveProtectionOrders,
  describeLiveProtectionOrderContext,
  hasExactlyOneDeltaProtectionPair,
  isDeltaExchangeSuggestedTradeBroker,
  isDeltaProtectionDirectionValid,
  resolveDeltaExchangeSuggestedTradeLiveAutoEnabled,
  resolveDeltaExchangeSuggestedTradeProtectionRepairEnabled,
  resolveDeltaInactiveAttachedProtectionManualReason,
  resolveDeltaProtectionLookupSymbols,
} from './suggested-trades/DeltaExchangeSuggestedTradeBroker';
import {
  isMudrexSuggestedTradeBroker,
  mudrexPositionHasProtection,
  resolveMudrexRiskOrderPositionId,
  resolveMudrexSuggestedTradeLiveAutoEnabled,
  resolveMudrexSuggestedTradeProtectionRepairEnabled,
  validateMudrexProtectionAttachability,
} from './suggested-trades/MudrexSuggestedTradeBroker';

type TradeSuggestionExecutionMode = 'suggestion_only' | 'paper_trade_auto' | 'live_trade_auto';
type TradeSuggestionApprovalMode = 'manual_review' | 'auto_if_safe';
type TradeSuggestionRouteMode = 'strategy_default' | 'user_default' | 'fixed';
type TradeSuggestionOrderType = 'market' | 'limit';
type TradeSuggestionQuantityMode = 'quantity' | 'notional' | 'risk_percent';
type SuggestedTradePreTradeState = NonNullable<SuggestedTradeExecutionLink['preTradeState']>;
type LiveAutoAdaptiveRoutingMode = 'off' | 'shadow' | 'live';

const SUGGESTED_TRADES_FRESHNESS_AUDIT_LOOKBACK_DAYS = 7;
const SUGGESTED_TRADES_FRESHNESS_AUDIT_LIMIT = 5000;
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

interface SuggestedTradeAutoLiveRolloutResult {
  outcome: 'disabled' | 'skipped' | 'blocked' | 'ready' | 'placed' | 'failed';
  message: string;
  suggestedTradeId: string;
  brokerKey?: string | null;
  accountId?: string | null;
  preTradeCheckId?: string | null;
  orderId?: string | null;
}

interface LiveAutoRolloutGuardDecision {
  allowed: boolean;
  outcome: 'disabled' | 'blocked';
  message: string;
  brokerKey: string | null;
  accountId: string | null;
}

interface LiveAutoRuntimeConfig {
  rolloutEnabled: boolean;
  enabled: boolean;
  executionEnabled: boolean;
  mudrexEnabled: boolean;
  deltaExchangeEnabled: boolean;
  adaptiveRoutingMode: LiveAutoAdaptiveRoutingMode;
  requireFixedRouting: boolean;
  userAllowlist: string[];
  brokerAllowlist: string[];
  shadowBrokerAllowlist: string[];
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
}

interface DeltaActiveProtectionOrders {
  stopLossOrderIds: string[];
  takeProfitOrderIds: string[];
  unclassifiedOrderIds: string[];
  activeOrderIds: string[];
}

interface DeltaProtectionOrderCandidate {
  externalId?: unknown;
  orderStatus?: unknown;
  statusRank?: unknown;
  side?: unknown;
  reduceOnly?: unknown;
  stopOrderType?: unknown;
  orderType?: unknown;
}

interface MudrexLiveAutoProtectionAttachmentResult {
  attached: boolean;
  note: string | null;
}

interface DeltaProtectionOrdersAdapter {
  listOpenOrders?: (
    query: { limit: number },
    context?: { userId?: string; brokerKey?: string; accountId?: string }
  ) => Promise<unknown>;
  createLiveAutoProtectiveOrdersForPosition?: (
    assetId: string,
    body: {
      size: number;
      entrySide: 'buy' | 'sell';
      stopLossPrice: number;
      takeProfitPrice: number;
      idempotencyKey?: string;
    },
    context?: { userId?: string; brokerKey?: string; accountId?: string }
  ) => Promise<unknown>;
}

interface DeltaLiveAutoProductRulePreflightAdapter {
  preflightLiveAutoOrder?: (
    assetId: string,
    body: {
      symbol?: string | null;
      quantity: number;
      entryPrice: number;
      stopLossPrice: number;
      takeProfitPrice: number;
      side: 'long' | 'short';
    },
    context?: { userId?: string; brokerKey?: string; accountId?: string }
  ) => Promise<{
    quantityContracts?: number;
    contractValue?: number;
    contractUnitCurrency?: string | null;
    auditNote?: string | null;
  }>;
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
      await this.suggestedTradeRepository.listProtectionRemediationCandidates(limit, staleBefore);
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

    const signalFreshness = this.evaluateSuggestedTradeFreshness(trade, executionPolicy);
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
      };
    }

    try {
      const gatedExecution = await this.runPreTradeGate(userId, trade, {
        sourceType: 'suggested_trade_automation_live_rollout',
      });
      const persistedPreTradeCheckId = this.resolvePersistedPreTradeCheckId(gatedExecution.result);

      if (!gatedExecution.ready) {
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
        };
      }

      const liveAutoRuntimeConfig = this.resolveLiveAutoRuntimeConfig();
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
        };
      }

      const routeMetrics = this.resolvePreTradeRouteOrderMetrics(
        trade,
        gatedExecution.result,
        gatedExecution.execution
      );
      const brokerKey = routeMetrics.brokerKey ?? rolloutGuard.brokerKey;
      const accountId = routeMetrics.accountId ?? rolloutGuard.accountId;
      const requestOrder = routeMetrics.requestOrder;
      const requestedNotional = routeMetrics.requestedNotional;
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
          brokerKey,
          accountId,
          preTradeCheckId: persistedPreTradeCheckId,
        };
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
        const message = 'Live auto execution requires a resolved broker route and account';
        await this.persistExecutionState(trade, {
          ...gatedExecution.execution,
          executionState: 'failed',
          note: message,
        });
        return {
          outcome: 'failed',
          message,
          suggestedTradeId: trade.id,
          brokerKey,
          accountId,
          preTradeCheckId: persistedPreTradeCheckId,
        };
      }

      if (!this.isLiveAutoBrokerEnabled(liveAutoRuntimeConfig, brokerKey)) {
        const message = `Broker ${brokerKey} live auto is disabled by broker-specific control`;
        await this.persistExecutionState(trade, {
          ...gatedExecution.execution,
          brokerKey,
          accountId,
          executionState: 'rejected',
          preTradeState: 'blocked',
          preTradeBlockedReason: message,
          note: message,
        });
        await this.operationalEventService.logActivity(userId, {
          type: 'Suggested Trade',
          title: `Live auto broker control blocked: ${trade.symbol}`,
          status: 'Warning',
          route: 'Suggested Trades',
          stream: 'Execution',
          related: `${brokerKey} · ${accountId}`,
          referenceId: trade.id,
          symbol: trade.symbol,
          description: message,
        });
        return {
          outcome: 'blocked',
          message,
          suggestedTradeId: trade.id,
          brokerKey,
          accountId,
          preTradeCheckId: persistedPreTradeCheckId,
        };
      }

      if (!leverage || leverage <= 0) {
        const message =
          'Live auto execution requires a positive min_leverage in the effective broker risk policy';
        await this.persistExecutionState(trade, {
          ...gatedExecution.execution,
          executionState: 'failed',
          note: message,
        });
        return {
          outcome: 'failed',
          message,
          suggestedTradeId: trade.id,
          brokerKey,
          accountId,
          preTradeCheckId: persistedPreTradeCheckId,
        };
      }

      if (!(quantity && quantity > 0 && entryPrice && entryPrice > 0)) {
        const message =
          'Live auto execution requires a positive entry price and resolvable quantity from the automation policy';
        await this.persistExecutionState(trade, {
          ...gatedExecution.execution,
          executionState: 'failed',
          note: message,
        });
        return {
          outcome: 'failed',
          message,
          suggestedTradeId: trade.id,
          brokerKey,
          accountId,
          preTradeCheckId: persistedPreTradeCheckId,
        };
      }

      if (!(stopLossPrice && stopLossPrice > 0 && takeProfitPrice && takeProfitPrice > 0)) {
        const message =
          'Live auto execution requires positive stop-loss and take-profit prices on the suggestion or automation template';
        await this.persistExecutionState(trade, {
          ...gatedExecution.execution,
          executionState: 'failed',
          note: message,
        });
        return {
          outcome: 'failed',
          message,
          suggestedTradeId: trade.id,
          brokerKey,
          accountId,
          preTradeCheckId: persistedPreTradeCheckId,
        };
      }

      const killSwitchBlock =
        (await this.riskKillSwitchService?.findActiveLiveTradingBlock(userId, {
          brokerKey,
          accountId,
        })) ?? null;
      if (killSwitchBlock) {
        const message = `Risk kill switch is active for ${killSwitchBlock.scope}. Live auto placement is blocked until it is cleared.`;
        await this.persistExecutionState(trade, {
          ...gatedExecution.execution,
          executionState: 'rejected',
          preTradeState: 'blocked',
          preTradeBlockedReason: message,
          note: message,
        });
        await this.operationalEventService.logActivity(userId, {
          type: 'Suggested Trade',
          title: `Live auto kill switch blocked: ${trade.symbol}`,
          status: 'Warning',
          route: 'Suggested Trades',
          stream: 'Execution',
          related: `${brokerKey} · ${accountId}`,
          referenceId: trade.id,
          symbol: trade.symbol,
          description: message,
        });
        return {
          outcome: 'blocked',
          message,
          suggestedTradeId: trade.id,
          brokerKey,
          accountId,
          preTradeCheckId: persistedPreTradeCheckId,
        };
      }

      const resolvedAssetRoute = await this.resolveLiveAutoAssetRoute(
        brokerKey,
        this.readStringValue(gatedExecution.result.request.order.symbol) ?? trade.symbol
      );
      let normalizedSizing: NormalizedLiveAutoOrderSizing;
      try {
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
        const message =
          error instanceof Error ? error.message : 'Live auto product preflight failed';
        await this.persistExecutionState(trade, {
          ...gatedExecution.execution,
          brokerKey,
          accountId,
          executionState: 'rejected',
          preTradeState: 'blocked',
          preTradeBlockedReason: message,
          note: message,
        });
        await this.operationalEventService.logActivity(userId, {
          type: 'Suggested Trade',
          title: `Live auto product preflight blocked: ${trade.symbol}`,
          status: 'Warning',
          route: 'Suggested Trades',
          stream: 'Execution',
          related: `${brokerKey} · ${accountId}`,
          referenceId: trade.id,
          symbol: trade.symbol,
          description: message,
        });
        return {
          outcome: 'blocked',
          message,
          suggestedTradeId: trade.id,
          brokerKey,
          accountId,
          preTradeCheckId: persistedPreTradeCheckId,
        };
      }
      const normalizedQuantity = normalizedSizing.quantity;
      const normalizedEntryPrice = normalizedSizing.entryPrice;
      const normalizedStopLossPrice = normalizedSizing.stopLossPrice;
      const normalizedTakeProfitPrice = normalizedSizing.takeProfitPrice;
      const normalizedSizingNote = normalizedSizing.auditNote;
      const policyLeverageNote = `Using broker policy minimum leverage ${this.formatNumericString(leverage) || leverage}x.`;

      if (!liveAutoRuntimeConfig.executionEnabled) {
        const readyMessage = `Live auto rollout guard passed. Broker placement remains disabled until live auto execution is explicitly enabled. ${policyLeverageNote}${normalizedSizingNote ? ` ${normalizedSizingNote}` : ''}`;
        await this.persistExecutionState(trade, {
          ...gatedExecution.execution,
          brokerKey,
          accountId,
          orderType,
          triggerType,
          quantity: normalizedQuantity,
          entryPrice: this.formatNumericString(normalizedEntryPrice) ?? null,
          stopLossPrice: this.formatNumericString(normalizedStopLossPrice) ?? null,
          takeProfitPrice: this.formatNumericString(normalizedTakeProfitPrice) ?? null,
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
          brokerKey,
          accountId,
          preTradeCheckId: persistedPreTradeCheckId,
        };
      }
      const assetId = resolvedAssetRoute.assetId;
      const idempotencyKey = this.buildAutoLiveIdempotencyKey(trade.id, persistedPreTradeCheckId);
      const acceptedAt = new Date().toISOString();
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
      let updatedTrade = await this.suggestedTradeRepository.saveSuggestedTrade(trade);

      const acceptedExecution: SuggestedTradeExecutionLink = {
        ...gatedExecution.execution,
        executionMode: 'live',
        executionState: 'queued',
        acceptedBy: 'system',
        acceptedAt,
        brokerKey,
        accountId,
        orderType,
        triggerType,
        leverage,
        quantity: normalizedQuantity,
        entryPrice: this.formatNumericString(normalizedEntryPrice) ?? null,
        stopLossPrice: this.formatNumericString(normalizedStopLossPrice) ?? null,
        takeProfitPrice: this.formatNumericString(normalizedTakeProfitPrice) ?? null,
        note: [
          resolvedAssetRoute.brokerSymbol !== trade.symbol
            ? `Live order queued automatically from automation suggestion using equivalent broker symbol ${resolvedAssetRoute.brokerSymbol} for requested signal ${trade.symbol}`
            : 'Live order queued automatically from automation suggestion',
          policyLeverageNote,
          normalizedSizingNote,
        ]
          .filter((value): value is string => Boolean(value))
          .join(' '),
      };

      await this.persistExecutionState(updatedTrade, acceptedExecution);
      updatedTrade =
        (await this.suggestedTradeRepository.getSuggestedTradeById(userId, updatedTrade.id)) ??
        updatedTrade;

      const createOrderBody: CreateOrderBody = {
        brokerKey,
        accountId,
        idempotency_key: idempotencyKey,
        symbol: resolvedAssetRoute.brokerSymbol,
        side,
        execution_mode: 'live',
        leverage,
        quantity: normalizedQuantity,
        order_price: normalizedEntryPrice,
        order_type: orderType,
        trigger_type: triggerType,
        is_takeprofit: false,
        is_stoploss: false,
        stoploss_price: normalizedStopLossPrice,
        takeprofit_price: normalizedTakeProfitPrice,
        reduce_only: requestOrder.reduceOnly === true,
      };

      const submittingExecution: SuggestedTradeExecutionLink = {
        ...acceptedExecution,
        executionState: 'submitting',
        submittedAt: new Date().toISOString(),
      };
      await this.persistExecutionState(updatedTrade, submittingExecution);
      updatedTrade =
        (await this.suggestedTradeRepository.getSuggestedTradeById(userId, updatedTrade.id)) ??
        updatedTrade;

      const result = await handler.createOrder(assetId, createOrderBody, {
        suggestedTradeId: updatedTrade.id,
      });
      const createdOrder = this.unwrapOrderPlacementResponse(result);
      const createdOrderId =
        this.readStringValue(createdOrder.order_id) ??
        this.readStringValue(createdOrder.orderId) ??
        null;
      const createdOrderStatus =
        this.readStringValue(createdOrder.status) ??
        this.readStringValue(createdOrder.order_status) ??
        null;
      const protectionStatus = this.readStringValue(createdOrder.protection_status);
      const stopLossOrderId = this.readStringValue(createdOrder.stop_loss_order_id);
      const takeProfitOrderId = this.readStringValue(createdOrder.take_profit_order_id);
      const deltaLimitProtectionProvisional = this.isDeltaLimitEntryProtectionProvisional(
        brokerKey,
        orderType
      );
      let protectionAttached = protectionStatus === 'attached' && !deltaLimitProtectionProvisional;
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

      if (!createdOrderId) {
        throw new BadRequestAppError('Live auto execution did not return a broker order id');
      }

      if (!protectionAttached && brokerKey === 'mudrex') {
        const attachedProtection = await this.attachMudrexLiveAutoProtectionIfNeeded({
          userId,
          brokerKey,
          accountId,
          brokerSymbol: resolvedAssetRoute.brokerSymbol,
          side,
          orderId: createdOrderId,
          requestedEntryPrice: normalizedEntryPrice,
          requestedStopLossPrice: normalizedStopLossPrice,
          requestedTakeProfitPrice: normalizedTakeProfitPrice,
        });
        if (attachedProtection.attached) {
          protectionAttached = true;
        }
        if (attachedProtection.note) {
          protectionNote =
            `${protectionNote}${protectionNote ? ' ' : ' '}${attachedProtection.note}`.trimEnd();
        }
      }

      const linkedAt = new Date().toISOString();
      const needsPostFillProtection = Boolean(
        normalizedStopLossPrice > 0 && normalizedTakeProfitPrice > 0
      );
      const linkedProtectionState: SuggestedTradeProtectionState | undefined = protectionAttached
        ? 'attached'
        : deltaLimitProtectionProvisional
          ? 'waiting_for_fill'
          : needsPostFillProtection
            ? 'waiting_for_fill'
            : (submittingExecution.protectionState ?? undefined);
      const linkedExecution: SuggestedTradeExecutionLink = {
        ...submittingExecution,
        orderId: createdOrderId,
        orderStatus: createdOrderStatus,
        executionState: 'linked',
        linkedAt,
        protectionState: linkedProtectionState,
        protectionCheckedAt: linkedAt,
        protectionAttachedAt: protectionAttached ? linkedAt : null,
        protectionLastError: protectionAttached ? null : submittingExecution.protectionLastError,
        protectionPlan: {
          ...(this.readRecordValue(submittingExecution.protectionPlan) ?? {}),
          source: 'suggested_trade_execution',
          symbol: updatedTrade.symbol,
          side: updatedTrade.side,
          timeframe: updatedTrade.timeframe,
          entryPrice: this.formatNumericString(normalizedEntryPrice) ?? null,
          stopLossPrice: this.formatNumericString(normalizedStopLossPrice) ?? null,
          takeProfitPrice: this.formatNumericString(normalizedTakeProfitPrice) ?? null,
          brokerKey,
          accountId,
          orderId: createdOrderId,
          ...(stopLossOrderId ? { stopLossOrderId } : {}),
          ...(takeProfitOrderId ? { takeProfitOrderId } : {}),
        },
        note: `Live order created automatically from automation suggestion.${protectionNote}`,
      };
      await this.persistExecutionState(updatedTrade, linkedExecution);

      await this.operationalEventService.logActivity(userId, {
        type: 'Suggested Trade',
        title: `Live auto order created: ${updatedTrade.symbol}`,
        status: 'Success',
        route: 'Suggested Trades',
        stream: 'Execution',
        related: `${brokerKey} · ${accountId}`,
        referenceId: updatedTrade.id,
        symbol: updatedTrade.symbol,
        description: protectionAttached
          ? `Live order ${createdOrderId} created automatically after pre-trade clearance with native SL/TP protection`
          : `Live order ${createdOrderId} created automatically after pre-trade clearance`,
      });
      await this.operationalEventService.emitNotificationAlert(userId, {
        channel: 'Trading',
        source: `trade-suggestion.live-auto.placed:${updatedTrade.id}`,
        symbol: updatedTrade.symbol,
        route: 'Suggested Trades',
        severity: 'Medium',
        message: `Live order ${createdOrderId} created for ${updatedTrade.symbol} on ${brokerKey}${accountId ? ` (${accountId})` : ''}.`,
      });

      return {
        outcome: 'placed',
        message: protectionAttached
          ? 'Live order created automatically after pre-trade clearance with native SL/TP protection'
          : 'Live order created automatically after pre-trade clearance',
        suggestedTradeId: updatedTrade.id,
        brokerKey,
        accountId,
        preTradeCheckId: persistedPreTradeCheckId,
        orderId: createdOrderId,
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
      };
    }
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
    const rolloutEnabled =
      this.readBooleanEnvOverride('SUGGESTED_TRADES_ROLLOUT_ENABLED') ??
      env.suggestedTrades.rolloutEnabled;
    const enabled =
      this.readBooleanEnvOverride('SUGGESTED_TRADES_LIVE_AUTO_ENABLED') ??
      env.suggestedTrades.liveAuto.enabled;
    const executionEnabled =
      this.readBooleanEnvOverride('SUGGESTED_TRADES_LIVE_AUTO_EXECUTION_ENABLED') ??
      env.suggestedTrades.liveAuto.executionEnabled;
    const readBooleanEnvOverride = (name: string) => this.readBooleanEnvOverride(name);
    const mudrexEnabled = resolveMudrexSuggestedTradeLiveAutoEnabled(
      enabled,
      readBooleanEnvOverride
    );
    const deltaExchangeEnabled = resolveDeltaExchangeSuggestedTradeLiveAutoEnabled(
      enabled,
      readBooleanEnvOverride
    );
    const adaptiveRoutingMode = this.resolveLiveAutoAdaptiveRoutingModeValue(
      this.readStringEnvOverride('SUGGESTED_TRADES_LIVE_AUTO_ADAPTIVE_ROUTING_MODE') ??
        env.suggestedTrades.liveAuto.adaptiveRoutingMode
    );
    const requireFixedRouting =
      this.readBooleanEnvOverride('SUGGESTED_TRADES_LIVE_AUTO_REQUIRE_FIXED_ROUTING') ??
      env.suggestedTrades.liveAuto.requireFixedRouting;
    const userAllowlist =
      this.readArrayEnvOverride('SUGGESTED_TRADES_LIVE_AUTO_USER_ALLOWLIST') ??
      env.suggestedTrades.liveAuto.userAllowlist;
    const brokerAllowlist =
      this.readArrayEnvOverride('SUGGESTED_TRADES_LIVE_AUTO_BROKER_ALLOWLIST') ??
      env.suggestedTrades.liveAuto.brokerAllowlist;
    const shadowBrokerAllowlist =
      this.readArrayEnvOverride('SUGGESTED_TRADES_LIVE_AUTO_SHADOW_BROKER_ALLOWLIST') ??
      env.suggestedTrades.liveAuto.shadowBrokerAllowlist ??
      [];

    return {
      rolloutEnabled,
      enabled,
      executionEnabled,
      mudrexEnabled,
      deltaExchangeEnabled,
      adaptiveRoutingMode,
      requireFixedRouting,
      userAllowlist: userAllowlist.map((item) => String(item).trim()).filter(Boolean),
      brokerAllowlist: brokerAllowlist
        .map((item) => String(item).trim().toLowerCase())
        .filter(Boolean),
      shadowBrokerAllowlist: Array.from(
        new Set(
          shadowBrokerAllowlist.map((item) => String(item).trim().toLowerCase()).filter(Boolean)
        )
      ),
    };
  }

  private isLiveAutoBrokerEnabled(
    liveAutoConfig: LiveAutoRuntimeConfig,
    brokerKey: string | null | undefined
  ): boolean {
    const normalizedBrokerKey = String(brokerKey || '')
      .trim()
      .toLowerCase();
    if (isMudrexSuggestedTradeBroker(normalizedBrokerKey)) {
      return liveAutoConfig.mudrexEnabled !== false;
    }
    if (isDeltaExchangeSuggestedTradeBroker(normalizedBrokerKey)) {
      return liveAutoConfig.deltaExchangeEnabled !== false;
    }
    return true;
  }

  private isProtectionRepairEnabledForBroker(brokerKey: string | null | undefined): boolean {
    const normalizedBrokerKey = String(brokerKey || '')
      .trim()
      .toLowerCase();
    const readBooleanEnvOverride = (name: string) => this.readBooleanEnvOverride(name);
    if (isMudrexSuggestedTradeBroker(normalizedBrokerKey)) {
      return resolveMudrexSuggestedTradeProtectionRepairEnabled(readBooleanEnvOverride);
    }
    if (isDeltaExchangeSuggestedTradeBroker(normalizedBrokerKey)) {
      return resolveDeltaExchangeSuggestedTradeProtectionRepairEnabled(readBooleanEnvOverride);
    }
    return true;
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
    preTradeCheckId: string | null | undefined
  ): string {
    const tradeId = String(suggestedTradeId || '').trim();
    const checkId = String(preTradeCheckId || '').trim() || 'pretrade';
    return `live-auto:${tradeId}:${checkId}`.slice(0, 191);
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
    if (
      !(input.requestedEntryPrice > 0) ||
      !(input.requestedStopLossPrice && input.requestedStopLossPrice > 0) ||
      !(input.requestedTakeProfitPrice && input.requestedTakeProfitPrice > 0)
    ) {
      return {
        attached: false,
        note: null,
      };
    }

    const positionsAdapter = this.brokerRuntimeRegistry?.getPositionsAdapter?.('mudrex');
    if (!positionsAdapter?.getPositions || !positionsAdapter?.createRiskOrder) {
      return {
        attached: false,
        note: 'Mudrex order created, but the positions adapter is unavailable for automatic SL/TP attachment.',
      };
    }

    try {
      const position = await this.pollMudrexLiveAutoPosition({
        adapter: positionsAdapter,
        userId: input.userId,
        accountId: input.accountId,
        brokerSymbol: input.brokerSymbol,
        side: input.side,
        orderId: input.orderId,
      });
      if (!position) {
        return {
          attached: false,
          note: `Mudrex order ${input.orderId} was created, but no matching open position was found in time for automatic SL/TP attachment.`,
        };
      }

      if (mudrexPositionHasProtection(position)) {
        return {
          attached: true,
          note: 'Mudrex position already reports active SL/TP protection.',
        };
      }

      const positionId =
        this.readStringValue(position.id) ??
        this.readStringValue(position.position_id) ??
        this.readStringValue(position.positionId);
      const actualEntryPrice = this.readNumberValue(
        position.entry_price ?? position.entryPrice ?? position.avg_price ?? position.average_price
      );
      if (!positionId || !(actualEntryPrice && actualEntryPrice > 0)) {
        return {
          attached: false,
          note: `Mudrex order ${input.orderId} opened a position, but the broker position payload did not include a usable id/entry price for automatic SL/TP attachment.`,
        };
      }

      const stopLossPrice = this.deriveScaledProtectionPrice(
        actualEntryPrice,
        input.requestedEntryPrice,
        input.requestedStopLossPrice
      );
      const takeProfitPrice = this.deriveScaledProtectionPrice(
        actualEntryPrice,
        input.requestedEntryPrice,
        input.requestedTakeProfitPrice
      );
      await positionsAdapter.createRiskOrder(
        positionId,
        {
          stoploss_price: stopLossPrice,
          takeprofit_price: takeProfitPrice,
          order_source: 'positions_desk',
          is_stoploss: true,
          is_takeprofit: true,
        },
        {
          userId: input.userId,
          brokerKey: input.brokerKey,
          accountId: input.accountId,
        }
      );

      return {
        attached: true,
        note: `Derived Mudrex SL/TP attached from actual fill price ${this.formatNumericString(actualEntryPrice) || actualEntryPrice} (SL ${stopLossPrice}, TP ${takeProfitPrice}).`,
      };
    } catch (error) {
      return {
        attached: false,
        note: `Mudrex order ${input.orderId} was created, but automatic SL/TP attachment failed: ${error instanceof Error ? error.message : 'unknown error'}.`,
      };
    }
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
      if (!adapter?.preflightLiveAutoOrder) {
        throw new BadRequestAppError(
          'Delta Exchange product-rule preflight is unavailable for live-auto placement.'
        );
      }
      const preflight = await adapter.preflightLiveAutoOrder(assetId, {
        symbol: brokerSymbol,
        quantity,
        entryPrice,
        stopLossPrice,
        takeProfitPrice,
        side,
      });
      const contracts = this.readNumberValue(preflight?.quantityContracts);
      if (!(contracts && Number.isInteger(contracts) && contracts > 0)) {
        throw new BadRequestAppError(
          `Delta Exchange product-rule preflight did not return a valid integer contract size for ${brokerSymbol}.`
        );
      }
      return {
        quantity,
        entryPrice,
        stopLossPrice,
        takeProfitPrice,
        auditNote:
          this.readStringValue(preflight?.auditNote) ??
          `Delta product preflight passed for ${brokerSymbol}: ${contracts} contract${contracts === 1 ? '' : 's'}.`,
      };
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

    const step = this.readNumberValue(assetDetail?.quantity_step);
    const minContract = this.readNumberValue(assetDetail?.min_contract);
    const maxContract = this.readNumberValue(assetDetail?.max_contract);
    const maxMarketContract = this.readNumberValue(assetDetail?.max_market_contract);
    const minNotionalValue = this.readNumberValue(assetDetail?.min_notional_value);
    const priceStep = this.readNumberValue(assetDetail?.price_step);
    const minPrice = this.readNumberValue(assetDetail?.min_price);
    const maxPrice = this.readNumberValue(assetDetail?.max_price);

    this.assertMudrexLiveAutoLeverageWithinAssetLimits(brokerSymbol, assetDetail, leverage);

    if (!(step && step > 0)) {
      return {
        quantity,
        entryPrice,
        stopLossPrice,
        takeProfitPrice,
        auditNote: null,
      };
    }

    const precision = this.countNumericDecimals(assetDetail?.quantity_step);
    const steppedQuantity = Math.floor(quantity / step) * step;
    const normalizedQuantity = Number(steppedQuantity.toFixed(precision));

    if (!(normalizedQuantity > 0)) {
      throw new BadRequestAppError(
        `Mudrex quantity ${this.formatNumericString(quantity) || quantity} rounds below the broker minimum step ${this.formatNumericString(step) || step} for ${brokerSymbol}.`
      );
    }

    if (minContract && normalizedQuantity < minContract) {
      throw new BadRequestAppError(
        `Mudrex quantity ${this.formatNumericString(normalizedQuantity) || normalizedQuantity} is below the broker minimum contract ${this.formatNumericString(minContract) || minContract} for ${brokerSymbol}.`
      );
    }

    const normalizedOrderType = String(orderType || '')
      .trim()
      .toLowerCase();
    const maxAllowed =
      normalizedOrderType === 'market' && maxMarketContract && maxMarketContract > 0
        ? maxMarketContract
        : maxContract;
    if (maxAllowed && normalizedQuantity > maxAllowed) {
      throw new BadRequestAppError(
        `Mudrex quantity ${this.formatNumericString(normalizedQuantity) || normalizedQuantity} exceeds the broker maximum ${this.formatNumericString(maxAllowed) || maxAllowed} for ${brokerSymbol}.`
      );
    }

    const normalizedEntryPrice =
      priceStep && priceStep > 0
        ? this.normalizeMudrexOrderPriceForStep(
            entryPrice,
            priceStep,
            assetDetail?.price_step,
            side === 'long' ? 'floor' : 'ceil'
          )
        : entryPrice;
    const normalizedStopLossPrice =
      priceStep && priceStep > 0
        ? this.normalizeMudrexOrderPriceForStep(
            stopLossPrice,
            priceStep,
            assetDetail?.price_step,
            side === 'long' ? 'floor' : 'ceil'
          )
        : stopLossPrice;
    const normalizedTakeProfitPrice =
      priceStep && priceStep > 0
        ? this.normalizeMudrexOrderPriceForStep(
            takeProfitPrice,
            priceStep,
            assetDetail?.price_step,
            side === 'long' ? 'ceil' : 'floor'
          )
        : takeProfitPrice;

    for (const [label, value] of [
      ['entry price', normalizedEntryPrice],
      ['stop-loss price', normalizedStopLossPrice],
      ['take-profit price', normalizedTakeProfitPrice],
    ] as const) {
      if (minPrice && value < minPrice) {
        throw new BadRequestAppError(
          `Mudrex ${label} ${this.formatNumericString(value) || value} is below the broker minimum price ${this.formatNumericString(minPrice) || minPrice} for ${brokerSymbol}.`
        );
      }
      if (maxPrice && value > maxPrice) {
        throw new BadRequestAppError(
          `Mudrex ${label} ${this.formatNumericString(value) || value} exceeds the broker maximum price ${this.formatNumericString(maxPrice) || maxPrice} for ${brokerSymbol}.`
        );
      }
    }

    const normalizedNotional = normalizedQuantity * normalizedEntryPrice;
    if (minNotionalValue && normalizedNotional < minNotionalValue) {
      throw new BadRequestAppError(
        `Mudrex order notional ${this.formatNumericString(normalizedNotional) || normalizedNotional} is below the broker minimum ${this.formatNumericString(minNotionalValue) || minNotionalValue} for ${brokerSymbol}.`
      );
    }

    const notes: string[] = [];
    const changed = Math.abs(normalizedQuantity - quantity) > 1e-12;
    if (changed) {
      notes.push(
        `Normalized Mudrex quantity from ${this.formatNumericString(quantity) || quantity} to ${this.formatNumericString(normalizedQuantity) || normalizedQuantity} to satisfy broker quantity step ${this.formatNumericString(step) || step}.`
      );
    }
    if (priceStep && priceStep > 0) {
      const priceChanges = [
        ['entry', entryPrice, normalizedEntryPrice],
        ['stop-loss', stopLossPrice, normalizedStopLossPrice],
        ['take-profit', takeProfitPrice, normalizedTakeProfitPrice],
      ]
        .filter(
          ([, original, normalized]) => Math.abs(Number(normalized) - Number(original)) > 1e-12
        )
        .map(
          ([label, original, normalized]) =>
            `${label} ${this.formatNumericString(Number(original)) || original} -> ${this.formatNumericString(Number(normalized)) || normalized}`
        );
      if (priceChanges.length) {
        notes.push(
          `Normalized Mudrex prices to broker price step ${this.formatNumericString(priceStep) || priceStep}: ${priceChanges.join(', ')}.`
        );
      }
    }

    return {
      quantity: normalizedQuantity,
      entryPrice: normalizedEntryPrice,
      stopLossPrice: normalizedStopLossPrice,
      takeProfitPrice: normalizedTakeProfitPrice,
      auditNote: notes.length ? notes.join(' ') : null,
    };
  }

  private assertMudrexLiveAutoLeverageWithinAssetLimits(
    brokerSymbol: string,
    assetDetail: Record<string, unknown> | null,
    leverage?: number | null
  ): void {
    const requestedLeverage = this.readNumberValue(leverage);
    if (!(requestedLeverage && requestedLeverage > 0)) {
      return;
    }

    const minLeverage = this.readNumberValue(assetDetail?.min_leverage);
    const maxLeverage = this.readNumberValue(assetDetail?.max_leverage);
    const formattedRequested = this.formatNumericString(requestedLeverage) ?? requestedLeverage;

    if (minLeverage && requestedLeverage < minLeverage) {
      throw new BadRequestAppError(
        `Mudrex requested leverage ${formattedRequested}x is below the broker minimum leverage ${this.formatNumericString(minLeverage) ?? minLeverage}x for ${brokerSymbol}.`
      );
    }

    if (maxLeverage && requestedLeverage > maxLeverage) {
      throw new BadRequestAppError(
        `Mudrex requested leverage ${formattedRequested}x exceeds the broker maximum leverage ${this.formatNumericString(maxLeverage) ?? maxLeverage}x for ${brokerSymbol}.`
      );
    }
  }

  private normalizeMudrexOrderPriceForStep(
    price: number,
    step: number,
    rawStep: unknown,
    mode: 'floor' | 'ceil'
  ): number {
    if (!(price > 0 && step > 0)) {
      return price;
    }

    const precision = this.countNumericDecimals(rawStep);
    const units = price / step;
    const roundedUnits =
      mode === 'ceil'
        ? Math.ceil(units - Number.EPSILON * 10)
        : Math.floor(units + Number.EPSILON * 10);
    return Number((roundedUnits * step).toFixed(precision));
  }

  private async pollMudrexLiveAutoPosition(input: {
    adapter: {
      getPositions: (
        query: { limit?: number },
        context?: { userId?: string; brokerKey?: string; accountId?: string }
      ) => Promise<unknown>;
    };
    userId: string;
    accountId: string;
    brokerSymbol: string;
    side: 'buy' | 'sell' | 'long' | 'short';
    orderId: string;
  }): Promise<Record<string, unknown> | null> {
    const normalizedSymbol = String(input.brokerSymbol || '')
      .trim()
      .toUpperCase();
    const expectedDirection = input.side === 'sell' || input.side === 'short' ? 'short' : 'long';

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const response = await input.adapter.getPositions(
        { limit: 100 },
        {
          userId: input.userId,
          brokerKey: 'mudrex',
          accountId: input.accountId,
        }
      );
      const positions = this.extractPositionRecords(response)
        .filter((position) => {
          const symbol = String(position.symbol ?? position.asset_symbol ?? '')
            .trim()
            .toUpperCase();
          if (symbol !== normalizedSymbol) {
            return false;
          }
          const status = this.normalizePositionStatus(
            this.readStringValue(position.status) ?? this.readStringValue(position.position_status)
          );
          if (status && ['CLOSED', 'LIQUIDATED'].includes(status)) {
            return false;
          }
          return this.resolvePositionDirection(position) === expectedDirection;
        })
        .sort(
          (left, right) =>
            this.extractPositionTimestamp(right) - this.extractPositionTimestamp(left)
        );

      if (positions[0]) {
        return positions[0];
      }

      if (attempt < 7) {
        await this.waitForLiveAutoProtectionPoll(750);
      }
    }

    return null;
  }

  private extractPositionRecords(value: unknown): Record<string, unknown>[] {
    if (Array.isArray(value)) {
      return value.filter((item): item is Record<string, unknown> =>
        Boolean(this.readRecordValue(item))
      );
    }

    const record = this.readRecordValue(value);
    if (!record) {
      return [];
    }

    const directList = [record.items, record.positions, record.results, record.data].find(
      (candidate) => Array.isArray(candidate)
    );
    if (Array.isArray(directList)) {
      return directList.filter((item): item is Record<string, unknown> =>
        Boolean(this.readRecordValue(item))
      );
    }

    const dataRecord = this.readRecordValue(record.data);
    if (!dataRecord) {
      return [];
    }

    const nestedList = [dataRecord.items, dataRecord.positions, dataRecord.results].find(
      (candidate) => Array.isArray(candidate)
    );
    return Array.isArray(nestedList)
      ? nestedList.filter((item): item is Record<string, unknown> =>
          Boolean(this.readRecordValue(item))
        )
      : [];
  }

  private extractPositionTimestamp(position: Record<string, unknown>): number {
    const candidates = [
      position.updated_at,
      position.updatedAt,
      position.created_at,
      position.createdAt,
      position.open_time,
      position.openTime,
    ];
    for (const candidate of candidates) {
      const raw = this.readStringValue(candidate);
      if (!raw) {
        continue;
      }
      const parsed = Date.parse(raw);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return 0;
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
    executionPolicy: ResolvedTradeSuggestionExecutionPolicy
  ): SignalFreshnessEvaluation {
    return evaluateSignalFreshness({
      signalTime: trade.signalTime,
      timeframe: trade.timeframe,
      policy: executionPolicy.freshness,
    });
  }

  private buildLiveExecutionFreshnessBlockedMessage(freshness: SignalFreshnessEvaluation): string {
    if (!freshness.enabled) {
      return 'Signal freshness guard is disabled for this automation.';
    }
    if (freshness.ageAfterCloseSeconds !== null && freshness.maxAgeAfterCloseSeconds !== null) {
      return `Skipped live execution: ${freshness.timeframe} signal closed ${this.formatDurationFromSeconds(freshness.ageAfterCloseSeconds)} ago, exceeding the configured ${this.formatDurationFromSeconds(freshness.maxAgeAfterCloseSeconds)} freshness window.`;
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
          nextExecution = await this.maybeAutoCancelSiblingProtectionOrders(
            userId,
            trade,
            nextExecution,
            positionSnapshots
          );
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
      nextExecution = await this.maybeAutoCancelSiblingProtectionOrders(
        userId,
        trade,
        nextExecution,
        positionSnapshots
      );
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
    if (
      ['filled', 'closed', 'cancelled', 'rejected', 'expired', 'failed'].includes(executionState) ||
      (orderStatus &&
        ['FILLED', 'CLOSED', 'CANCELLED', 'REJECTED', 'EXPIRED', 'FAILED'].includes(orderStatus))
    ) {
      return execution;
    }

    if (execution.positionOpenedAt || this.hasOpenPositionSnapshot(positionSnapshots)) {
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

    const expiryMessage = `Limit entry order expired after ${this.formatDurationFromSeconds(expirySeconds)} for ${trade.timeframe}; cancel requested at ${new Date().toISOString()}.`;
    try {
      await adapter.cancelOrder(orderId, {
        userId,
        brokerKey,
        accountId,
      });
      return {
        ...execution,
        orderStatus: 'EXPIRED',
        executionState: 'expired',
        canceledAt: new Date().toISOString(),
        note: this.appendExecutionNote(execution.note, expiryMessage),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ...execution,
        note: this.appendExecutionNote(
          execution.note,
          `${expiryMessage} Broker cancel failed: ${message}`
        ),
      };
    }
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
            orderId
          );
          if (this.hasUsableProtectionContext(existingProtection)) {
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
          return this.markProtectionManualUnlinked(execution, nowIso, manualMessage);
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

    if (brokerKey === 'mudrex') {
      return this.remediateMudrexLiveProtection({
        userId,
        trade,
        execution,
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
        execution,
        position,
        prices,
        nowIso,
        brokerKey,
        accountId,
      });
    }

    return this.markProtectionFailed(
      execution,
      nowIso,
      `Protection remediation is not supported for broker ${brokerKey}.`
    );
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
          orderId
        );
        if (this.hasUsableProtectionContext(existingProtection)) {
          const duplicateProtectionReason = await this.resolveDeltaLinkedProtectionManualReason({
            userId,
            brokerKey,
            accountId,
            trade,
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
      orderId
    );
    if (this.hasUsableProtectionContext(protection)) {
      const duplicateProtectionReason = await this.resolveDeltaLinkedProtectionManualReason({
        userId,
        brokerKey,
        accountId,
        trade,
        position,
        protection,
      });
      if (duplicateProtectionReason) {
        return this.markProtectionManualUnlinked(execution, nowIso, duplicateProtectionReason);
      }
      return execution;
    }

    const prices = this.resolveExecutionProtectionPrices(trade, execution);
    const positionPayload = position.payload ?? {};
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

  private async resolveDeltaLinkedProtectionManualReason(input: {
    userId: string;
    brokerKey: string;
    accountId: string;
    trade: SuggestedTrade;
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
    const positionPayload = input.position.payload ?? {};
    if (mudrexPositionHasProtection(positionPayload)) {
      return this.markProtectionAttached(
        input.trade,
        input.execution,
        input.nowIso,
        'Mudrex position already reports active SL/TP protection.',
        {
          positionId: input.position.externalId,
        }
      );
    }

    if (!this.isProtectionRepairEnabledForBroker(input.brokerKey)) {
      return this.markProtectionManualUnlinked(
        input.execution,
        input.nowIso,
        'Mudrex automatic SL/TP protection repair is disabled by broker-specific control.'
      );
    }

    const positionsAdapter = this.brokerRuntimeRegistry?.getPositionsAdapter?.('mudrex');
    if (!positionsAdapter?.createRiskOrder) {
      return this.markProtectionFailed(
        input.execution,
        input.nowIso,
        'Mudrex positions adapter is unavailable for protection remediation.'
      );
    }

    const positionId = resolveMudrexRiskOrderPositionId(input.position, positionPayload);
    const actualEntryPrice = this.resolvePositionEntryPrice(positionPayload, input.execution);
    if (!positionId || !(actualEntryPrice && actualEntryPrice > 0)) {
      return {
        ...input.execution,
        protectionState: 'waiting_for_position',
        protectionCheckedAt: input.nowIso,
        protectionLastError:
          'Mudrex position snapshot did not include a usable id and entry price yet.',
      };
    }

    const requestedEntryPrice = input.prices.requestedEntryPrice ?? actualEntryPrice;
    const stopLossPrice = this.deriveScaledProtectionPrice(
      actualEntryPrice,
      requestedEntryPrice,
      input.prices.stopLossPrice
    );
    const takeProfitPrice = this.deriveScaledProtectionPrice(
      actualEntryPrice,
      requestedEntryPrice,
      input.prices.takeProfitPrice
    );
    const attachabilityError = validateMudrexProtectionAttachability(
      input.trade,
      positionPayload,
      stopLossPrice,
      takeProfitPrice
    );
    if (attachabilityError) {
      return this.markProtectionManualUnlinked(input.execution, input.nowIso, attachabilityError);
    }

    try {
      await positionsAdapter.createRiskOrder(
        positionId,
        {
          stoploss_price: stopLossPrice,
          takeprofit_price: takeProfitPrice,
          order_source: 'positions_desk',
          is_stoploss: true,
          is_takeprofit: true,
        },
        {
          userId: input.userId,
          brokerKey: input.brokerKey,
          accountId: input.accountId,
        }
      );
      return this.markProtectionAttached(
        input.trade,
        input.execution,
        input.nowIso,
        `Derived Mudrex SL/TP attached from actual fill price ${this.formatNumericString(actualEntryPrice) || actualEntryPrice} (SL ${stopLossPrice}, TP ${takeProfitPrice}).`,
        {
          positionId,
          snapshotPositionId: input.position.externalId,
          attachedStopLossPrice: stopLossPrice,
          attachedTakeProfitPrice: takeProfitPrice,
        },
        true
      );
    } catch (error) {
      return this.markProtectionFailed(
        input.execution,
        input.nowIso,
        `Mudrex protection remediation failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
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
    const orderId = this.readStringValue(input.execution.orderId);
    if (orderId) {
      const existingProtection = await this.resolveLiveProtectionOrderContext(
        input.userId,
        input.trade.id,
        input.brokerKey,
        input.accountId,
        orderId
      );
      if (this.hasUsableProtectionContext(existingProtection)) {
        return this.markProtectionAttached(
          input.trade,
          input.execution,
          input.nowIso,
          'Delta Exchange native SL/TP protection is already linked to the execution.',
          {
            positionId: input.position.externalId,
            stopLossOrderId: existingProtection.stopLossOrderId,
            takeProfitOrderId: existingProtection.takeProfitOrderId,
          }
        );
      }
      if (
        input.execution.protectionState === 'attaching' &&
        (existingProtection.stopLossOrderId || existingProtection.takeProfitOrderId)
      ) {
        const hasTerminalSnapshot = [
          existingProtection.stopLossStatus,
          existingProtection.takeProfitStatus,
        ]
          .filter((status): status is string => Boolean(status))
          .some((status) => ['CANCELLED', 'REJECTED', 'EXPIRED', 'FAILED'].includes(status));
        if (hasTerminalSnapshot) {
          return this.markProtectionFailed(
            input.execution,
            input.nowIso,
            `Delta Exchange replacement protection is inactive after submission (${describeLiveProtectionOrderContext(
              existingProtection
            )}); replacement protection still needs operator review.`
          );
        }
        return {
          ...input.execution,
          protectionCheckedAt: input.nowIso,
          protectionLastError: `Delta Exchange replacement protection submitted; waiting for active SL/TP snapshots (${describeLiveProtectionOrderContext(
            existingProtection
          )}).`,
        };
      }
    }

    const adapter = this.brokerRuntimeRegistry?.getOrdersAdapter?.(
      'delta_exchange'
    ) as DeltaProtectionOrdersAdapter;
    if (!adapter?.createLiveAutoProtectiveOrdersForPosition) {
      return this.markProtectionFailed(
        input.execution,
        input.nowIso,
        'Delta Exchange post-fill protection placement is unavailable in the orders adapter.'
      );
    }

    const positionPayload = input.position.payload ?? {};
    const actualEntryPrice = this.resolvePositionEntryPrice(positionPayload, input.execution);
    const size =
      this.readNumberValue(positionPayload.quantity_contracts) ??
      this.readNumberValue(positionPayload.size) ??
      this.readNumberValue(input.execution.filledQuantity) ??
      this.readNumberValue(input.execution.quantity);
    if (!(actualEntryPrice && actualEntryPrice > 0) || !(size && size > 0)) {
      return {
        ...input.execution,
        protectionState: 'waiting_for_position',
        protectionCheckedAt: input.nowIso,
        protectionLastError:
          'Delta Exchange position snapshot did not include a usable entry price and contract size yet.',
      };
    }

    const requestedEntryPrice = input.prices.requestedEntryPrice ?? actualEntryPrice;
    const stopLossPrice = Number(
      this.deriveScaledProtectionPrice(
        actualEntryPrice,
        requestedEntryPrice,
        input.prices.stopLossPrice
      )
    );
    const takeProfitPrice = Number(
      this.deriveScaledProtectionPrice(
        actualEntryPrice,
        requestedEntryPrice,
        input.prices.takeProfitPrice
      )
    );
    const entrySide = String(input.trade.side || '').toUpperCase() === 'SELL' ? 'sell' : 'buy';
    const manualReason = resolveDeltaInactiveAttachedProtectionManualReason({
      entrySide,
      actualEntryPrice,
      requestedEntryPrice: input.prices.requestedEntryPrice,
      stopLossPrice: input.prices.stopLossPrice,
      takeProfitPrice: input.prices.takeProfitPrice,
      currentPrice: this.resolvePositionCurrentPrice(positionPayload),
    });
    if (manualReason) {
      return this.markProtectionManualUnlinked(input.execution, input.nowIso, manualReason);
    }
    if (
      !isDeltaProtectionDirectionValid(entrySide, actualEntryPrice, stopLossPrice, takeProfitPrice)
    ) {
      return this.markProtectionFailed(
        input.execution,
        input.nowIso,
        `Delta Exchange protection prices are invalid for the filled ${entrySide} position.`
      );
    }

    try {
      const route = await this.resolveLiveAutoAssetRoute(input.brokerKey, input.trade.symbol);
      const existingSymbolProtection = await this.resolveActiveDeltaProtectionOrdersForSymbol({
        userId: input.userId,
        brokerKey: input.brokerKey,
        accountId: input.accountId,
        symbols: [route.brokerSymbol, input.trade.symbol, ...route.candidateSymbols],
        entrySide,
        includeLiveBroker: true,
      });
      if (existingSymbolProtection.activeOrderIds.length > 0) {
        if (hasExactlyOneDeltaProtectionPair(existingSymbolProtection)) {
          return this.markProtectionAttached(
            input.trade,
            input.execution,
            input.nowIso,
            'Delta Exchange active reduce-only SL/TP protection already exists for this symbol; linked existing broker orders instead of creating replacements.',
            {
              positionId: input.position.externalId,
              stopLossOrderId: existingSymbolProtection.stopLossOrderIds[0],
              takeProfitOrderId: existingSymbolProtection.takeProfitOrderIds[0],
            }
          );
        }

        return this.markProtectionManualUnlinked(
          input.execution,
          input.nowIso,
          `Delta Exchange active reduce-only protection orders already exist for ${route.brokerSymbol} (${describeDeltaActiveProtectionOrders(existingSymbolProtection)}); manual cleanup is required before auto repair can safely create replacements.`
        );
      }

      if (!this.isProtectionRepairEnabledForBroker(input.brokerKey)) {
        return this.markProtectionManualUnlinked(
          input.execution,
          input.nowIso,
          'Delta Exchange automatic SL/TP protection repair is disabled by broker-specific control.'
        );
      }

      const response = await adapter.createLiveAutoProtectiveOrdersForPosition(
        route.assetId,
        {
          size: Math.abs(size),
          entrySide,
          stopLossPrice,
          takeProfitPrice,
          idempotencyKey: orderId
            ? `live-auto-protection:${input.trade.id}:${orderId}`
            : `live-auto-protection:${input.trade.id}`,
        },
        {
          userId: input.userId,
          brokerKey: input.brokerKey,
          accountId: input.accountId,
        }
      );
      const payload = this.unwrapOrderPlacementResponse(response);
      const stopLossOrderId = this.readStringValue(payload.stop_loss_order_id);
      const takeProfitOrderId = this.readStringValue(payload.take_profit_order_id);
      if (!stopLossOrderId || !takeProfitOrderId) {
        return this.markProtectionFailed(
          input.execution,
          input.nowIso,
          'Delta Exchange protection remediation did not return both replacement SL/TP order ids.'
        );
      }
      return this.markProtectionAttaching(
        input.trade,
        input.execution,
        input.nowIso,
        `Delta Exchange replacement SL/TP submitted after fill (SL ${stopLossOrderId}, TP ${takeProfitOrderId}); waiting for active order snapshots before marking attached.`,
        {
          positionId: input.position.externalId,
          attachedStopLossPrice: stopLossPrice,
          attachedTakeProfitPrice: takeProfitPrice,
          stopLossOrderId,
          takeProfitOrderId,
        },
        true
      );
    } catch (error) {
      return this.markProtectionFailed(
        input.execution,
        input.nowIso,
        `Delta Exchange protection remediation failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
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
    const orderStatus = this.normalizeOrderStatus(execution.orderStatus);
    const executionState = this.readStringValue(execution.executionState)?.toLowerCase();
    return Boolean(
      execution.filledAt ||
      executionState === 'filled' ||
      orderStatus === 'FILLED' ||
      orderStatus === 'CLOSED'
    );
  }

  private isUnfilledTerminalEntryExecution(execution: SuggestedTradeExecutionLink): boolean {
    const orderStatus = this.normalizeOrderStatus(execution.orderStatus);
    const executionState = this.readStringValue(execution.executionState)?.toLowerCase();
    const filledQuantity = this.readNumberValue(execution.filledQuantity);
    const hasFillEvidence = Boolean(
      execution.filledAt ||
      executionState === 'filled' ||
      orderStatus === 'FILLED' ||
      orderStatus === 'CLOSED' ||
      (filledQuantity && filledQuantity > 0)
    );
    if (hasFillEvidence) {
      return false;
    }

    return Boolean(
      ['cancelled', 'rejected', 'expired', 'failed'].includes(executionState ?? '') ||
      ['CANCELLED', 'REJECTED', 'EXPIRED', 'FAILED'].includes(orderStatus ?? '')
    );
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
    if (positionStatus === 'OPEN' || positionStatus === 'PARTIAL') {
      return Boolean(
        ['cancelled', 'rejected', 'expired', 'failed'].includes(executionState ?? '') ||
        ['CANCELLED', 'REJECTED', 'EXPIRED', 'FAILED'].includes(orderStatus ?? '')
      );
    }
    return Boolean(
      execution.positionClosedAt ||
      positionStatus === 'CLOSED' ||
      positionStatus === 'LIQUIDATED' ||
      ['closed', 'cancelled', 'rejected', 'expired', 'failed'].includes(executionState ?? '') ||
      ['CANCELLED', 'REJECTED', 'EXPIRED', 'FAILED'].includes(orderStatus ?? '') ||
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
              JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.order_type')) AS orderType
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
      error.includes('attached protection is inactive or missing') &&
      error.includes('replacement protection is required')
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
        ...(this.readRecordValue(execution.protectionPlan) ?? {}),
        source: 'suggested_trade_execution',
        symbol: trade.symbol,
        side: trade.side,
        timeframe: trade.timeframe,
        brokerKey: execution.brokerKey ?? null,
        accountId: execution.accountId ?? null,
        orderId: execution.orderId ?? null,
        attachedAt: execution.protectionAttachedAt ?? nowIso,
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
        ...(this.readRecordValue(execution.protectionPlan) ?? {}),
        source: 'suggested_trade_execution',
        symbol: trade.symbol,
        side: trade.side,
        timeframe: trade.timeframe,
        brokerKey: execution.brokerKey ?? null,
        accountId: execution.accountId ?? null,
        orderId: execution.orderId ?? null,
        replacementSubmittedAt: nowIso,
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
    if (!protection.activeOrderIds.length) {
      return execution;
    }

    const cancelMessage = `Sibling protection cancel requested after position close: ${protection.activeOrderIds.join(', ')}`;
    if (String(execution.note || '').includes(cancelMessage)) {
      return execution;
    }

    const adapter = this.brokerRuntimeRegistry?.getOrdersAdapter?.(brokerKey);
    if (!adapter?.cancelOrder) {
      return execution;
    }
    const cancelledOrderIds: string[] = [];
    for (const protectionOrderId of protection.activeOrderIds) {
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
    const remainingQuantity =
      this.readNumberValue(payload.remaining_quantity) ??
      this.readNumberValue(payload.remainingQuantity) ??
      existing?.remainingQuantity ??
      null;
    const updatedAt =
      this.toIsoString(payload.updated_at) ?? this.toIsoString(payload.updatedAt) ?? null;
    const deltaClosedFilledOrder = this.isDeltaClosedFilledOrder(
      existing?.brokerKey,
      normalizedStatus,
      filledQuantity
    );
    const executionState = deltaClosedFilledOrder
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
        (normalizedStatus === 'FILLED' || deltaClosedFilledOrder
          ? (updatedAt ?? existing?.filledAt ?? null)
          : (existing?.filledAt ?? null)),
      canceledAt:
        this.toIsoString(payload.canceled_at) ??
        this.toIsoString(payload.canceledAt) ??
        this.toIsoString(payload.cancelled_at) ??
        this.toIsoString(payload.cancelledAt) ??
        (['CANCELLED', 'REJECTED', 'EXPIRED', 'FAILED'].includes(normalizedStatus || '')
          ? (updatedAt ?? existing?.canceledAt ?? null)
          : (existing?.canceledAt ?? null)),
      filledPrice,
      filledQuantity,
      remainingQuantity,
    };
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
    const normalizedExecutionStatus = this.normalizePositionStatus(execution.positionStatus);
    if (normalizedExecutionStatus === 'CLOSED' || normalizedExecutionStatus === 'LIQUIDATED') {
      return true;
    }

    if (!snapshots.length) {
      return false;
    }

    return snapshots.every((snapshot) => {
      const normalizedStatus = this.normalizePositionStatus(
        this.readStringValue(snapshot.status) ??
          this.readStringValue(snapshot.payload?.status) ??
          null
      );
      return normalizedStatus === 'CLOSED' || normalizedStatus === 'LIQUIDATED';
    });
  }

  private async resolveLiveProtectionOrderContext(
    userId: string,
    suggestedTradeId: string,
    brokerKey: string,
    accountId: string,
    orderId: string
  ): Promise<LiveProtectionOrderContext> {
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
    let stopLossOrderId = this.readStringValue(planRows[0]?.stopLossOrderId);
    let takeProfitOrderId = this.readStringValue(planRows[0]?.takeProfitOrderId);

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
    stopLossOrderId =
      stopLossOrderId ??
      this.readStringValue(row.stopLossOrderId) ??
      this.readStringValue(row.stopLossOrderIdNested) ??
      null;
    takeProfitOrderId =
      takeProfitOrderId ??
      this.readStringValue(row.takeProfitOrderId) ??
      this.readStringValue(row.takeProfitOrderIdNested) ??
      null;

    const trackedOrderIds = [stopLossOrderId, takeProfitOrderId].filter((value): value is string =>
      Boolean(value)
    );
    if (!trackedOrderIds.length) {
      return {
        stopLossOrderId,
        takeProfitOrderId,
        stopLossStatus: null,
        takeProfitStatus: null,
        activeOrderIds: [],
      };
    }

    const snapshots = (await coreDataSource.query(
      `SELECT external_id AS externalId,
              order_status AS orderStatus,
              status_rank AS statusRank
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
              },
            ] as const
        )
        .filter((entry): entry is [string, { status: string | null; statusRank: number | null }] =>
          Boolean(entry[0])
        )
    );

    const stopLossStatus = stopLossOrderId
      ? (snapshotById.get(stopLossOrderId)?.status ?? null)
      : null;
    const takeProfitStatus = takeProfitOrderId
      ? (snapshotById.get(takeProfitOrderId)?.status ?? null)
      : null;
    const activeOrderIds = trackedOrderIds.filter((trackedOrderId) => {
      const snapshot = snapshotById.get(trackedOrderId);
      return this.isActiveLiveProtectionOrder(
        snapshot?.status ?? null,
        snapshot?.statusRank ?? null
      );
    });

    return {
      stopLossOrderId,
      takeProfitOrderId,
      stopLossStatus,
      takeProfitStatus,
      activeOrderIds,
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
      firstSeenAt: Date | string | null;
      payload: Record<string, unknown> | null;
    }
  ): boolean {
    const filledMs = this.toTimestamp(execution.filledAt);
    if (!filledMs) {
      return true;
    }

    const payload = snapshot.payload ?? {};
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
    if (['PARTIALLY_FILLED', 'PARTIAL'].includes(normalized)) return 'PARTIALLY_FILLED';
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

  private resolveLiveAutoAdaptiveRoutingModeValue(value: unknown): LiveAutoAdaptiveRoutingMode {
    const normalized = String(value || '')
      .trim()
      .toLowerCase();
    if (!normalized || normalized === 'live') {
      return 'live';
    }
    if (normalized === 'shadow' || normalized === 'off') {
      return normalized;
    }

    return 'live';
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
