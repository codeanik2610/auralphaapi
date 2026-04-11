import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
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
  PaperOrderRepository,
  SuggestedTradeExecutionUpsertPayload,
  SuggestedTradeRepository,
} from '../../database';
import { SuggestedTrade } from '../../database';
import { env } from '../../env';
import { OperationalEventService } from './OperationalEventService';
import { PaperOrderExecutionService } from './PaperOrderExecutionService';

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

  async syncStaleTrackedExecutionTrades(options: {
    limit?: number;
    staleBefore?: Date;
  }): Promise<{
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
      refreshed += await this.refreshExecutionOutcomes(userId, userTrades);
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
        : candidateTrades.filter((trade) => this.hasExecutionTracking(this.getExecutionLink(trade)));

      const refreshed = trades.length
        ? await this.refreshExecutionOutcomes(userId, trades)
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
    const trade = await this.suggestedTradeRepository.getSuggestedTradeById(userId, validatedTradeId);

    if (!trade) {
      throw new NotFoundAppError('Suggested trade not found');
    }
    if (trade.status !== 'Accepted') {
      throw new BadRequestAppError('Only accepted suggested trades can be handed off to orders');
    }

    await this.assertOrderLinkAllowed(userId, trade, payload);

    const nextExecution: SuggestedTradeExecutionLink = {
      ...(this.getExecutionLink(trade) ?? {}),
      executionMode: payload.executionMode ?? (payload.paperOrderId ? 'paper' : 'live'),
      orderId: payload.orderId ?? null,
      paperOrderId: payload.paperOrderId ?? null,
      brokerKey: payload.brokerKey ?? null,
      accountId: payload.accountId ?? null,
      orderStatus: payload.orderStatus ?? null,
      paperOrderStatus: payload.paperOrderStatus ?? null,
      executionState: payload.orderId || payload.paperOrderId ? 'linked' : null,
      orderType: payload.orderType ?? null,
      triggerType: payload.triggerType ?? null,
      leverage: payload.leverage ?? null,
      quantity: payload.quantity ?? null,
      entryPrice:
        payload.entryPrice === undefined ? null : String(payload.entryPrice),
      stopLossPrice:
        payload.stopLossPrice === undefined ? null : String(payload.stopLossPrice),
      takeProfitPrice:
        payload.takeProfitPrice === undefined ? null : String(payload.takeProfitPrice),
      linkedAt: new Date().toISOString(),
      note: payload.note ?? null,
    };

    await this.persistExecutionState(trade, nextExecution);
    if (payload.paperOrderId) {
      await this.paperOrderRepository.attachSuggestedTrade(
        userId,
        payload.paperOrderId,
        trade.id
      );
    }
    const updatedTrade =
      (await this.suggestedTradeRepository.getSuggestedTradeById(userId, validatedTradeId)) ?? trade;

    await this.operationalEventService.logActivity(userId, {
      type: 'Suggested Trade',
      title: `Suggested trade routed to orders: ${updatedTrade.symbol}`,
      status: 'Success',
      route: 'Orders',
      stream: 'Execution',
      related: `${updatedTrade.symbol} · ${updatedTrade.timeframe}`,
      referenceId: updatedTrade.id,
      symbol: updatedTrade.symbol,
      description:
        payload.orderId
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
      const trade = await this.suggestedTradeRepository.getSuggestedTradeById(userId, validatedTradeId);
      if (!trade) {
        throw new NotFoundAppError('Suggested trade not found');
      }

      const refreshed = (await this.refreshExecutionOutcomes(userId, [trade])) > 0;
      const currentTrade =
        (await this.suggestedTradeRepository.getSuggestedTradeById(userId, validatedTradeId)) ?? trade;

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
      const trade = await this.suggestedTradeRepository.getSuggestedTradeById(userId, validatedTradeId);
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
          },
        });
      }

      this.assertStatusTransitionAllowed(trade, nextStatus);

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

      const updatedTrade = await this.suggestedTradeRepository.saveSuggestedTrade(trade);

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
          status: updatedTrade.status as SuggestedTradeStatusActionResult['suggestedTrade']['status'],
          updatedAt: updatedTrade.updatedAt.toISOString(),
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
        throw new BadRequestAppError(
          'Only open or reviewed suggested trades can be accepted'
        );
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
      const paperOrder = await this.paperOrderRepository.getPaperOrderById(userId, nextPaperOrderId);
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
    const executionState = String(execution?.executionState || '').trim().toLowerCase();
    const outcome = String(execution?.outcome || '').trim().toLowerCase();

    if (status === 'Dismissed') {
      return 'Suggestion dismissed by operator';
    }
    if (status === 'Expired') {
      return 'Suggestion expired before execution';
    }
    if (status === 'Open') {
      return 'New suggestion awaiting first review';
    }
    if (status === 'Reviewed') {
      return 'Reviewed and awaiting accept or dismiss decision';
    }
    if (status === 'Accepted' && !this.hasExecutionTracking(execution)) {
      return 'Accepted and ready to route to execution';
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

    if (status === 'Dismissed') {
      return 'Dismissed';
    }
    if (status === 'Expired') {
      return 'Expired';
    }
    if (status === 'Open') {
      return 'Needs Review';
    }
    if (status === 'Reviewed') {
      return 'Reviewed';
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
    if (executionState === 'expired') {
      return 'Execution Expired';
    }

    return 'Accepted';
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
    const executionState = String(execution?.executionState || '').trim().toLowerCase();
    if (!executionState) {
      return 'unlinked';
    }
    if (
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
      order: orderId
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
          review.note ?? `Operator review moved the trade into ${String(review.status || item.status)}.`,
        occurredAt: review.updatedAt,
        entity: 'suggested_trade',
        entityId: item.id,
        status: review.status ?? item.status,
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
        status: execution.paperOrderStatus ?? execution.orderStatus ?? execution.executionState ?? null,
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
          execution.executionState ??
          execution.orderStatus ??
          execution.paperOrderStatus ??
          null,
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
        (left, right) =>
          this.toTimestamp(left.occurredAt) - this.toTimestamp(right.occurredAt)
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
    const staleAfterMs = execution?.executionMode === 'live'
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

  private resolveExecutionSyncStaleAfterMs(
    execution: SuggestedTradeExecutionLink | null
  ): number {
    if (execution?.executionMode === 'paper') {
      return Math.max(
        env.suggestedTradesSync.staleAfterMs,
        env.paperOrders.pollIntervalMs * 3
      );
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
      staleBefore?.getTime() ??
      Date.now() - this.resolveExecutionSyncStaleAfterMs(execution);
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
    trades: SuggestedTrade[]
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
        continue;
      }

      const snapshot = await this.suggestedTradeRepository.getLinkedOrderSnapshot(
        userId,
        brokerKey,
        accountId,
        orderId
      );

      if (!snapshot) {
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
      nextExecution = this.mergePositionOutcome(
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
    const normalizedStatus = String(paperOrder.status || 'OPEN').trim().toUpperCase();
    const payload =
      paperOrder.payload && typeof paperOrder.payload === 'object' && !Array.isArray(paperOrder.payload)
        ? paperOrder.payload
        : {};
    const simulation =
      payload.simulation &&
      typeof payload.simulation === 'object' &&
      !Array.isArray(payload.simulation)
        ? (payload.simulation as Record<string, unknown>)
        : {};
    const executionState =
      (this.readStringValue(simulation.executionState) as SuggestedTradeExecutionLink['executionState']) ??
      (normalizedStatus === 'CANCELLED'
        ? 'cancelled'
        : normalizedStatus === 'FILLED'
          ? 'filled'
          : normalizedStatus === 'CLOSED'
            ? 'closed'
            : 'working');

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
        this.toIsoString(simulation.lastPriceSeenAt) ??
        paperOrder.updatedAt.toISOString(),
      canceledAt:
        paperOrder.canceledAt
          ? paperOrder.canceledAt.toISOString()
          : this.toIsoString(simulation.canceledAt) ??
            existing?.canceledAt ??
            null,
      orderType: existing?.orderType ?? paperOrder.orderType ?? null,
      triggerType: existing?.triggerType ?? paperOrder.triggerType ?? null,
      leverage: existing?.leverage ?? paperOrder.leverage ?? null,
      quantity:
        existing?.quantity ??
        (paperOrder.quantity === null ? null : Number(paperOrder.quantity)),
      entryPrice: existing?.entryPrice ?? paperOrder.orderPrice ?? null,
      stopLossPrice: existing?.stopLossPrice ?? paperOrder.stoplossPrice ?? null,
      takeProfitPrice: existing?.takeProfitPrice ?? paperOrder.takeprofitPrice ?? null,
      filledAt:
        this.toIsoString(simulation.filledAt) ??
        existing?.filledAt ??
        null,
      filledPrice:
        this.readStringValue(simulation.filledPrice) ??
        existing?.filledPrice ??
        null,
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
        (normalizedStatus === 'CLOSED'
          ? 'CLOSED'
          : normalizedStatus === 'FILLED'
            ? 'OPEN'
            : null),
      positionOpenedAt:
        this.toIsoString(simulation.positionOpenedAt) ??
        existing?.positionOpenedAt ??
        (normalizedStatus === 'FILLED' || normalizedStatus === 'CLOSED'
          ? this.toIsoString(simulation.filledAt) ?? paperOrder.updatedAt.toISOString()
          : null),
      positionClosedAt:
        this.toIsoString(simulation.positionClosedAt) ??
        this.toIsoString(simulation.closedAt) ??
        existing?.positionClosedAt ??
        (normalizedStatus === 'CLOSED' ? paperOrder.updatedAt.toISOString() : null),
      exitPrice:
        this.readStringValue(simulation.exitPrice) ??
        existing?.exitPrice ??
        null,
      realizedPnl:
        this.readStringValue(simulation.realizedPnl) ??
        existing?.realizedPnl ??
        null,
      outcome:
        (this.readStringValue(simulation.outcome) as SuggestedTradeExecutionLink['outcome']) ??
        existing?.outcome ??
        (normalizedStatus === 'FILLED' ? 'open' : normalizedStatus === 'CLOSED' ? 'unknown' : null),
    };
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
          ? this.toIsoString(payload.updated_at) ??
            this.toIsoString(payload.updatedAt) ??
            existing?.filledAt ??
            null
          : existing?.filledAt ?? null),
      canceledAt:
        this.toIsoString(payload.canceled_at) ??
        this.toIsoString(payload.canceledAt) ??
        this.toIsoString(payload.cancelled_at) ??
        this.toIsoString(payload.cancelledAt) ??
        (['CANCELLED', 'REJECTED', 'EXPIRED', 'FAILED'].includes(normalizedStatus || '')
          ? this.toIsoString(payload.updated_at) ??
            this.toIsoString(payload.updatedAt) ??
            existing?.canceledAt ??
            null
          : existing?.canceledAt ?? null),
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
          ? this.toIsoString(candidate.payload?.updated_at) ??
            this.toIsoString(candidate.payload?.updatedAt) ??
            this.toIsoString(candidate.lastSeenAt) ??
            execution.positionClosedAt ??
            null
          : execution.positionClosedAt ?? null),
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
          : execution.executionState ?? null,
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
        this.toTimestamp(payload.created_at) ??
        this.toTimestamp(snapshot.firstSeenAt) ??
        eventMs;

      let score = 0;
      if (createdMs >= anchorMs - 15 * 60 * 1000) {
        score += 35;
      } else if (eventMs >= anchorMs - 6 * 60 * 60 * 1000) {
        score += 20;
      } else {
        score += 5;
      }

      const status = this.normalizePositionStatus(
        this.readStringValue(snapshot.status) ??
          this.readStringValue(payload.status) ??
          null
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

      if (!best || score > best.score || (score === best.score && eventMs > this.toTimestamp(best.snapshot.lastSeenAt))) {
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
    return this.mapExecutionRecord((trade as { executionRecord?: unknown }).executionRecord) ??
      this.extractExecutionLink(trade.meta ?? null);
  }

  private mapExecutionRecord(record: unknown): SuggestedTradeExecutionLink | null {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      return null;
    }

    const execution = record as Record<string, unknown>;
    const executionMode = this.readStringValue(execution.executionMode)?.toLowerCase();

    return {
      orderId: this.readStringValue(execution.orderId),
      executionMode:
        executionMode === 'paper' ? 'paper' : executionMode === 'live' ? 'live' : null,
      paperOrderId: this.readStringValue(execution.paperOrderId),
      brokerKey: this.readStringValue(execution.brokerKey),
      accountId: this.readStringValue(execution.accountId),
      orderStatus: this.readStringValue(execution.orderStatus),
      paperOrderStatus: this.readStringValue(execution.paperOrderStatus),
      executionState:
        this.readStringValue(execution.executionState) as SuggestedTradeExecutionLink['executionState'],
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
      paperOrderId: readString(execution.paperOrderId),
      brokerKey: readString(execution.brokerKey),
      accountId: readString(execution.accountId),
      orderStatus: readString(execution.orderStatus),
      paperOrderStatus: readString(execution.paperOrderStatus),
      executionState: readString(execution.executionState) as SuggestedTradeExecutionLink['executionState'],
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
    const normalized = String(orderStatus || '').trim().toUpperCase();
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
    const side = String(payload.side ?? '').trim().toLowerCase();
    const positionType = String(payload.position_type ?? '').trim().toLowerCase();
    const orderType = String(payload.order_type ?? '').trim().toLowerCase();

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

  private readNumberValue(value: unknown): number | null {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
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
