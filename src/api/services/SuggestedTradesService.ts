import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import { RiskPreTradeCheckResult } from '../contracts/Risk';
import {
  SuggestedTradeItem,
  SuggestedTradePageAction,
  SuggestedTradeReconcileActionResult,
  SuggestedTradeOrderLinkResult,
  SuggestedTradeExecutionLink,
  SuggestedTradeStatus,
  SuggestedTradesListResponse,
  SuggestedTradesExecutionSyncResult,
  SuggestedTradeStatusActionResult,
  SuggestedTradesSummary,
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
  BrokerAccountRepository,
  ExchangeAssetRepository,
  PaperOrderRepository,
  SuggestedTradeExecutionUpsertPayload,
  SuggestedTradeRepository,
} from '../../database';
import { SuggestedTrade } from '../../database';
import { env } from '../../env';
import { normalizeTradeSuggestionExecutionPolicy } from '../utils/automationType';
import { OperationalEventService } from './OperationalEventService';
import { PaperOrderExecutionService } from './PaperOrderExecutionService';
import { BrokerReferenceDataService } from './BrokerReferenceDataService';
import { RiskPreTradeService } from './RiskPreTradeService';

type TradeSuggestionExecutionMode = 'suggestion_only' | 'paper_trade_auto' | 'live_trade_auto';
type TradeSuggestionApprovalMode = 'manual_review' | 'auto_if_safe';
type TradeSuggestionRouteMode = 'strategy_default' | 'user_default' | 'fixed';
type TradeSuggestionOrderType = 'market' | 'limit';
type TradeSuggestionQuantityMode = 'quantity' | 'notional' | 'risk_percent';
type SuggestedTradePreTradeState = NonNullable<SuggestedTradeExecutionLink['preTradeState']>;

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
}

interface DefaultRouteCandidate {
  brokerKey: string;
  accountId: string;
  accountName: string | null;
}

interface EvaluatedRouteCandidate {
  route: DefaultRouteCandidate;
  request: SuggestedTradePreTradeRequest;
  preview: RiskPreTradeCheckResult;
  support: {
    supported: boolean;
    message: string | null;
  };
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
}

@Service()
export class SuggestedTradesService {
  @Inject(() => SuggestedTradeRepository)
  private suggestedTradeRepository!: SuggestedTradeRepository;

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

  @Inject(() => ExchangeAssetRepository)
  private exchangeAssetRepository!: ExchangeAssetRepository;

  @Inject(() => BrokerReferenceDataService)
  private brokerReferenceDataService!: BrokerReferenceDataService;

  @Inject(() => RiskPreTradeService)
  private riskPreTradeService!: RiskPreTradeService;

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
    const summary = await this.suggestedTradeRepository.getSuggestedTradesSummary(userId, {
      automationId: params.automationId,
      automationRunId: params.automationRunId,
      status: params.status,
      executionState: params.executionState,
      symbol: params.symbol,
      timeframe: params.timeframe,
      side: params.side,
      search: params.search,
    });
    return successResponse(summary);
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
    return this.refreshExecutionOutcomes(userId, trades);
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
    const trades = await this.suggestedTradeRepository.listStaleTrackedTradesGlobal(
      limit,
      staleBefore
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
    const request = this.buildPreTradeCheckRequest(
      trade,
      executionPolicy,
      existingExecution,
      options.linkPayload
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
      const candidateRequest: SuggestedTradePreTradeRequest = {
        ...request,
        routing: {
          routeMode: 'fixed',
          brokerKey: route.brokerKey,
          accountId: route.accountId,
        },
      };
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
        support,
      });
    }

    const viableCandidates = evaluated
      .filter((candidate) => candidate.preview.decision.allowed && candidate.support.supported)
      .sort((left, right) => this.compareRouteCandidates(left, right));

    if (viableCandidates.length > 0) {
      return {
        request: viableCandidates[0].request,
      };
    }

    const bestRejectedCandidate = [...evaluated].sort((left, right) =>
      this.compareRejectedRouteCandidates(left, right)
    )[0];
    if (!bestRejectedCandidate) {
      return { request };
    }

    return {
      request: bestRejectedCandidate.request,
      previewBlock: this.createBlockedCandidatePreview(
        bestRejectedCandidate.preview,
        this.buildNoSafeRouteMessage(evaluated)
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
    const allowlistedAccounts =
      liveAutoConfig && liveAutoConfig.brokerAllowlist.length > 0
        ? baseAccounts.filter((account) =>
            liveAutoConfig.brokerAllowlist.includes(
              String(account.brokerKey || '')
                .trim()
                .toLowerCase()
            )
          )
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
          'Live auto execution requires an explicit positive leverage in the automation order template.',
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
      await this.resolveLiveAutoAssetId(metrics.brokerKey, trade.symbol);
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
      const orderType = routeMetrics.orderType;
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

      if (!leverage || leverage <= 0) {
        const message =
          'Live auto execution requires an explicit positive leverage in the automation order template';
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

      if (!this.resolveLiveAutoRuntimeConfig().executionEnabled) {
        const readyMessage =
          'Live auto rollout guard passed. Broker placement remains disabled until live auto execution is explicitly enabled.';
        await this.persistExecutionState(trade, {
          ...gatedExecution.execution,
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

      const assetId = await this.resolveLiveAutoAssetId(brokerKey, trade.symbol);
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
        triggerType: 'immediate',
        leverage,
        quantity,
        entryPrice: this.formatNumericString(entryPrice) ?? null,
        stopLossPrice: this.formatNumericString(stopLossPrice) ?? null,
        takeProfitPrice: this.formatNumericString(takeProfitPrice) ?? null,
        note: 'Live order queued automatically from automation suggestion',
      };

      await this.persistExecutionState(updatedTrade, acceptedExecution);
      updatedTrade =
        (await this.suggestedTradeRepository.getSuggestedTradeById(userId, updatedTrade.id)) ??
        updatedTrade;

      const createOrderBody: CreateOrderBody = {
        brokerKey,
        accountId,
        idempotency_key: idempotencyKey,
        symbol: trade.symbol,
        side,
        execution_mode: 'live',
        leverage,
        quantity,
        order_price: entryPrice,
        order_type: orderType,
        trigger_type: 'immediate',
        is_takeprofit: false,
        is_stoploss: false,
        stoploss_price: stopLossPrice,
        takeprofit_price: takeProfitPrice,
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
      const protectionAttached = protectionStatus === 'attached';
      const protectionNote = protectionAttached
        ? ` Native SL/TP protection attached${
            stopLossOrderId || takeProfitOrderId
              ? ` (SL ${stopLossOrderId ?? 'unknown'}, TP ${takeProfitOrderId ?? 'unknown'})`
              : ''
          }.`
        : '';

      if (!createdOrderId) {
        throw new BadRequestAppError('Live auto execution did not return a broker order id');
      }

      const linkedExecution: SuggestedTradeExecutionLink = {
        ...submittingExecution,
        orderId: createdOrderId,
        orderStatus: createdOrderStatus,
        executionState: 'linked',
        linkedAt: new Date().toISOString(),
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

    return {
      allowed: true,
      outcome: 'blocked',
      message: 'Live auto rollout guard passed',
      brokerKey,
      accountId,
    };
  }

  private resolveLiveAutoRuntimeConfig(): {
    rolloutEnabled: boolean;
    enabled: boolean;
    executionEnabled: boolean;
    requireFixedRouting: boolean;
    userAllowlist: string[];
    brokerAllowlist: string[];
  } {
    const rolloutEnabled =
      this.readBooleanEnvOverride('SUGGESTED_TRADES_ROLLOUT_ENABLED') ??
      env.suggestedTrades.rolloutEnabled;
    const enabled =
      this.readBooleanEnvOverride('SUGGESTED_TRADES_LIVE_AUTO_ENABLED') ??
      env.suggestedTrades.liveAuto.enabled;
    const executionEnabled =
      this.readBooleanEnvOverride('SUGGESTED_TRADES_LIVE_AUTO_EXECUTION_ENABLED') ??
      env.suggestedTrades.liveAuto.executionEnabled;
    const requireFixedRouting =
      this.readBooleanEnvOverride('SUGGESTED_TRADES_LIVE_AUTO_REQUIRE_FIXED_ROUTING') ??
      env.suggestedTrades.liveAuto.requireFixedRouting;
    const userAllowlist =
      this.readArrayEnvOverride('SUGGESTED_TRADES_LIVE_AUTO_USER_ALLOWLIST') ??
      env.suggestedTrades.liveAuto.userAllowlist;
    const brokerAllowlist =
      this.readArrayEnvOverride('SUGGESTED_TRADES_LIVE_AUTO_BROKER_ALLOWLIST') ??
      env.suggestedTrades.liveAuto.brokerAllowlist;

    return {
      rolloutEnabled,
      enabled,
      executionEnabled,
      requireFixedRouting,
      userAllowlist: userAllowlist.map((item) => String(item).trim()).filter(Boolean),
      brokerAllowlist: brokerAllowlist
        .map((item) => String(item).trim().toLowerCase())
        .filter(Boolean),
    };
  }

  private async resolveLiveAutoAssetId(brokerKey: string, symbol: string): Promise<string> {
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

    const catalogAsset = await this.exchangeAssetRepository.getSystemAssetBySourceAndSymbol(
      normalizedBrokerKey,
      normalizedSymbol
    );
    const externalId = this.readStringValue(catalogAsset?.externalId);
    if (externalId) {
      return externalId;
    }

    if (normalizedBrokerKey === 'delta_exchange') {
      throw new BadRequestAppError(
        `Could not resolve a broker asset id for ${normalizedSymbol} on ${normalizedBrokerKey}; run exchange-assets-sync before live auto placement`
      );
    }

    const remoteAsset = (
      await this.brokerReferenceDataService.getFuturesAssetDetailBySymbol(
        normalizedBrokerKey,
        normalizedSymbol
      )
    ).data;
    const remoteId =
      this.readStringValue((remoteAsset as { id?: unknown })?.id) ??
      this.readStringValue((remoteAsset as { asset_uuid?: unknown })?.asset_uuid);

    if (!remoteId) {
      throw new BadRequestAppError(
        `Could not resolve a broker asset id for ${normalizedSymbol} on ${normalizedBrokerKey}`
      );
    }

    return remoteId;
  }

  private buildAutoLiveIdempotencyKey(
    suggestedTradeId: string,
    preTradeCheckId: string | null | undefined
  ): string {
    const tradeId = String(suggestedTradeId || '').trim();
    const checkId = String(preTradeCheckId || '').trim() || 'pretrade';
    return `live-auto:${tradeId}:${checkId}`.slice(0, 191);
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

  private async loadTradeSuggestionExecutionPolicy(
    userId: string,
    automationId: string | null | undefined
  ): Promise<ResolvedTradeSuggestionExecutionPolicy> {
    const normalizedAutomationId = this.readStringValue(automationId);
    const automation = normalizedAutomationId
      ? await this.automationRepository.getAutomationById(userId, normalizedAutomationId)
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
      maxOrdersPerRun: Math.max(1, Math.floor(this.readNumberValue(limits.maxOrdersPerRun) ?? 1)),
      maxOrdersPerDay: Math.max(1, Math.floor(this.readNumberValue(limits.maxOrdersPerDay) ?? 3)),
      maxConcurrentOpenTrades: Math.max(
        1,
        Math.floor(this.readNumberValue(limits.maxConcurrentOpenTrades) ?? 1)
      ),
      maxNotionalPerTrade: this.readNumberValue(limits.maxNotionalPerTrade),
      maxNotionalPerDay: this.readNumberValue(limits.maxNotionalPerDay),
    };
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
    const orderType =
      requestedOrderType === 'limit' && entryPrice && entryPrice > 0 ? 'limit' : 'market';

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
        timeInForce: executionPolicy.timeInForce,
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
        url: `/signals?selected=${encodeURIComponent(signalId)}`,
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
      nextExecution = this.mergePositionOutcome(trade, nextExecution, positionSnapshots);
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

    return {
      ...(existing ?? {}),
      orderStatus: normalizedStatus,
      executionState: this.mapExecutionState(normalizedStatus, snapshot.statusRank),
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
        (normalizedStatus === 'FILLED'
          ? (this.toIsoString(payload.updated_at) ??
            this.toIsoString(payload.updatedAt) ??
            existing?.filledAt ??
            null)
          : (existing?.filledAt ?? null)),
      canceledAt:
        this.toIsoString(payload.canceled_at) ??
        this.toIsoString(payload.canceledAt) ??
        this.toIsoString(payload.cancelled_at) ??
        this.toIsoString(payload.cancelledAt) ??
        (['CANCELLED', 'REJECTED', 'EXPIRED', 'FAILED'].includes(normalizedStatus || '')
          ? (this.toIsoString(payload.updated_at) ??
            this.toIsoString(payload.updatedAt) ??
            existing?.canceledAt ??
            null)
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
    }>
  ): SuggestedTradeExecutionLink {
    const candidate = this.selectBestPositionCandidate(trade, execution, snapshots);
    if (!candidate) {
      return execution;
    }

    const realizedPnl =
      this.readStringValue(candidate.payload?.realized) ??
      this.readStringValue(candidate.payload?.pnl) ??
      this.readStringValue(candidate.payload?.realized_pnl) ??
      execution.realizedPnl ??
      null;
    const positionStatus = this.normalizePositionStatus(
      this.readStringValue(candidate.status) ??
        this.readStringValue(candidate.payload?.status) ??
        null
    );
    const outcome = this.deriveOutcome(positionStatus, realizedPnl);

    return {
      ...execution,
      positionId: candidate.externalId || execution.positionId || null,
      positionStatus,
      positionOpenedAt:
        this.toIsoString(candidate.payload?.created_at) ??
        this.toIsoString(candidate.payload?.createdAt) ??
        this.toIsoString(candidate.firstSeenAt) ??
        execution.positionOpenedAt ??
        null,
      positionClosedAt:
        this.toIsoString(candidate.payload?.closed_at) ??
        this.toIsoString(candidate.payload?.closedAt) ??
        (positionStatus === 'CLOSED' || positionStatus === 'LIQUIDATED'
          ? (this.toIsoString(candidate.payload?.updated_at) ??
            this.toIsoString(candidate.payload?.updatedAt) ??
            this.toIsoString(candidate.lastSeenAt) ??
            execution.positionClosedAt ??
            null)
          : (execution.positionClosedAt ?? null)),
      exitPrice:
        this.readStringValue(candidate.payload?.closed_price) ??
        this.readStringValue(candidate.payload?.closedPrice) ??
        execution.exitPrice ??
        null,
      realizedPnl,
      outcome,
      executionState:
        positionStatus === 'CLOSED' || positionStatus === 'LIQUIDATED'
          ? 'closed'
          : (execution.executionState ?? null),
    };
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
    }>
  ): {
    externalId: string;
    status: string | null;
    statusRank: number | null;
    firstSeenAt: Date | string | null;
    lastSeenAt: Date | string | null;
    payload: Record<string, unknown> | null;
  } | null {
    const expectedDirection = String(trade.side || '').toUpperCase() === 'SELL' ? 'short' : 'long';
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
      const direction = this.resolvePositionDirection(payload);
      if (direction !== expectedDirection) {
        continue;
      }

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
      if (status === 'CLOSED' || status === 'LIQUIDATED') {
        score += 20;
      } else if (status === 'OPEN' || status === 'PARTIAL') {
        score += 10;
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

  private resolvePositionDirection(payload: Record<string, unknown>): 'long' | 'short' {
    const side = String(payload.side ?? '')
      .trim()
      .toLowerCase();
    const positionType = String(payload.position_type ?? '')
      .trim()
      .toLowerCase();
    const orderType = String(payload.order_type ?? '')
      .trim()
      .toLowerCase();

    if (side === 'short' || positionType === 'short' || orderType === 'sell') {
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

  private readRecordValue(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    return value as Record<string, unknown>;
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
