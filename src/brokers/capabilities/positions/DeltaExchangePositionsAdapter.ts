import { createHash } from 'node:crypto';
import { Inject, Service } from 'typedi';
import { BadRequestAppError, ServiceUnavailableAppError } from '../../../api';
import {
  AddMarginBody,
  ClosePartialPositionBody,
  CreateRiskOrderBody,
  PositionLiqPriceQuery,
  PositionsHistoryQuery,
  UpdateRiskOrderBody,
} from '../../../api/validators/positions.validator';
import { BrokerPositionContext, BrokerPositionsAdapter } from './types';
import { ValidatedPositionsRouteQuery } from './types';
import { DeltaExchangeHttpClient } from '../../providers/delta_exchange/DeltaExchangeHttpClient';
import { buildDeltaClosedPositionLifecycleId } from '../../providers/delta_exchange/deltaPositionLifecycle';

interface DeltaPositionPayload {
  product_id?: number | string;
  product_symbol?: string;
  size?: string | number | null;
  entry_price?: string | number | null;
  mark_price?: string | number | null;
  liquidation_price?: string | number | null;
  margin?: string | number | null;
  leverage?: string | number | null;
  realized_pnl?: string | number | null;
  realized_funding?: string | number | null;
  commission?: string | number | null;
  created_at?: string;
  updated_at?: string;
}

interface DeltaPositionHistoryPayload {
  // Delta does not document a "positions history" endpoint in v2.
  // We approximate closed-position history using fills (trade executions).
  id?: number | string;
  product_id?: number | string;
  product_symbol?: string;
  side?: string | null;
  size?: string | number | null;
  price?: string | number | null;
  fill_type?: string | null;
  pnl?: string | number | null;
  realized_cashflow?: string | number | null;
  commission?: string | number | null;
  order_id?: number | string | null;
  created_at?: string;
}

interface DeltaProduct {
  id?: number | string;
  symbol?: string;
  contract_value?: string | number | null;
  contract_unit_currency?: string | null;
}

type DeltaProductMaps = {
  byId: Map<string, DeltaProduct>;
  bySymbol: Map<string, DeltaProduct>;
};

const DELTA_CLIENT_ORDER_ID_MAX_LENGTH = 32;
const DELTA_CLIENT_ORDER_ID_PREFIX = 'aur_';

interface DeltaOrderPayload {
  id?: number | string;
  product_id?: number | string;
  product_symbol?: string;
  side?: string | null;
  stop_price?: string | number | null;
  stop_order_type?: string | null;
  size?: string | number | null;
  state?: string | null;
  order_type?: string | null;
  reduce_only?: boolean | string | null;
}

interface DeltaProtectiveOrderResult {
  kind: 'stop_loss' | 'take_profit';
  order_id: string;
  product_id: string;
  status: string;
  side: 'buy' | 'sell';
  stop_price: string;
  stop_order_type: 'stop_loss_order' | 'take_profit_order';
  reduce_only: true;
}

@Service()
export class DeltaExchangePositionsAdapter implements BrokerPositionsAdapter {
  readonly historyWindowMode = 'contiguous' as const;
  readonly historyOverlapDays = 30;

  @Inject(() => DeltaExchangeHttpClient)
  private deltaHttpClient!: DeltaExchangeHttpClient;

  private productCache: {
    fetchedAt: number;
    byId: Map<string, DeltaProduct>;
    bySymbol: Map<string, DeltaProduct>;
  } | null = null;

  private async getProductMaps(): Promise<DeltaProductMaps> {
    const now = Date.now();
    if (this.productCache && now - this.productCache.fetchedAt < 5 * 60 * 1000) {
      return { byId: this.productCache.byId, bySymbol: this.productCache.bySymbol };
    }

    const products = await this.deltaHttpClient.publicGet<DeltaProduct[]>('/v2/products');
    const byId = new Map<string, DeltaProduct>();
    const bySymbol = new Map<string, DeltaProduct>();
    for (const item of Array.isArray(products) ? products : []) {
      const id = String(item.id ?? '').trim();
      if (id) byId.set(id, item);
      const symbol = String(item.symbol ?? '')
        .trim()
        .toUpperCase();
      if (symbol) bySymbol.set(symbol, item);
    }
    this.productCache = { fetchedAt: now, byId, bySymbol };
    return { byId, bySymbol };
  }

  async getPositions(
    _query: ValidatedPositionsRouteQuery,
    context?: BrokerPositionContext
  ): Promise<unknown> {
    // Delta's "list positions" API is `/v2/positions/margined`.
    // `/v2/positions` requires `product_id` or `underlying_asset_symbol` and is not suitable for syncing all open positions.
    const marginedPayload = await this.deltaHttpClient.signedGet<DeltaPositionPayload[]>(
      context?.accountId,
      '/v2/positions/margined',
      undefined,
      context?.userId
    );

    if (!Array.isArray(marginedPayload)) {
      return [];
    }

    const productMaps = await this.getProductMaps();
    return marginedPayload
      .filter((item) => Math.abs(this.toNumber(item.size)) > 0)
      .map((item) => this.mapPosition(item, productMaps));
  }

  async getLiquidationPrice(
    positionId: string,
    _query: PositionLiqPriceQuery,
    context?: BrokerPositionContext
  ): Promise<unknown> {
    const position = await this.findPosition(positionId, context?.accountId, context?.userId);
    return position?.liquidation_price ? String(position.liquidation_price) : '0';
  }

  async addMargin(
    _positionId: string,
    _body: AddMarginBody,
    _context?: BrokerPositionContext
  ): Promise<unknown> {
    throw new ServiceUnavailableAppError('Delta Exchange margin updates are not enabled yet');
  }

  async createRiskOrder(
    positionId: string,
    body: CreateRiskOrderBody,
    context?: BrokerPositionContext
  ): Promise<unknown> {
    this.assertRiskOrderBodyFlags(body.is_stoploss, body.is_takeprofit);
    const position = await this.requireOpenPosition(positionId, context);
    const productId = this.resolvePositionProductId(position);
    const size = this.resolvePositionContractSize(position);
    const entrySide = this.resolvePositionEntrySide(position);
    const stopLossPrice = this.requirePositivePrice(body.stoploss_price, 'stoploss_price');
    const takeProfitPrice = this.requirePositivePrice(body.takeprofit_price, 'takeprofit_price');
    this.assertProtectionPricesAgainstPosition(entrySide, position, stopLossPrice, takeProfitPrice);

    const protectiveOrders = await this.createProtectiveOrdersForPosition(
      productId,
      size,
      entrySide,
      stopLossPrice,
      takeProfitPrice,
      `risk-create:${positionId}:${stopLossPrice}:${takeProfitPrice}`,
      context
    );

    return {
      message: 'Delta Exchange risk orders attached',
      status: 'created',
      protection_status: protectiveOrders.length ? 'attached' : 'not_requested',
      protective_orders: protectiveOrders,
      stop_loss_order_id:
        protectiveOrders.find((order) => order.kind === 'stop_loss')?.order_id ?? null,
      take_profit_order_id:
        protectiveOrders.find((order) => order.kind === 'take_profit')?.order_id ?? null,
    };
  }

  async updateRiskOrder(
    positionId: string,
    body: UpdateRiskOrderBody,
    context?: BrokerPositionContext
  ): Promise<unknown> {
    this.assertRiskOrderBodyFlags(body.is_stoploss, body.is_takeprofit);
    const position = await this.requireOpenPosition(positionId, context);
    const productId = this.resolvePositionProductId(position);
    const size = this.resolvePositionContractSize(position);
    const entrySide = this.resolvePositionEntrySide(position);
    const stopLossPrice = this.requirePositivePrice(body.stoploss_price, 'stoploss_price');
    const takeProfitPrice = this.requirePositivePrice(body.takeprofit_price, 'takeprofit_price');
    const stopLossOrderId = String(body.stoploss_order_id || '').trim();
    const takeProfitOrderId = String(body.takeprofit_order_id || '').trim();
    if (!stopLossOrderId || !takeProfitOrderId) {
      throw new BadRequestAppError(
        'Delta Exchange risk order update requires existing stop-loss and take-profit order ids'
      );
    }

    this.assertProtectionPricesAgainstPosition(entrySide, position, stopLossPrice, takeProfitPrice);

    const [currentStopLoss, currentTakeProfit] = await Promise.all([
      this.getDeltaOrder(stopLossOrderId, context),
      this.getDeltaOrder(takeProfitOrderId, context),
    ]);
    const exitSide = this.resolveExitSide(entrySide);
    this.assertRiskOrderMatchesPosition(currentStopLoss, 'stop_loss', productId, size, exitSide);
    this.assertRiskOrderMatchesPosition(
      currentTakeProfit,
      'take_profit',
      productId,
      size,
      exitSide
    );
    this.assertTrailingStopImproves(
      entrySide,
      this.toNumber(currentStopLoss.stop_price),
      stopLossPrice
    );

    const replacementStopLoss = await this.createProtectiveOrder(
      productId,
      size,
      exitSide,
      'stop_loss',
      'stop_loss_order',
      stopLossPrice,
      this.buildClientOrderId(`risk-update:${positionId}:${stopLossOrderId}:${stopLossPrice}`),
      context
    );

    try {
      await this.cancelDeltaOrder(currentStopLoss, context);
    } catch (error) {
      try {
        await this.cancelDeltaOrder(
          {
            id: replacementStopLoss.order_id,
            product_id: replacementStopLoss.product_id,
          },
          context
        );
      } catch {
        // The original cancel error is more actionable; keep it as the reported failure.
      }
      throw new BadRequestAppError(
        `Delta Exchange created replacement stop-loss ${replacementStopLoss.order_id}, but could not cancel old stop-loss ${stopLossOrderId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    const currentTakeProfitPrice = this.toNumber(currentTakeProfit.stop_price);
    return {
      message: 'Delta Exchange risk order updated',
      status: 'updated',
      stop_loss_order_id: replacementStopLoss.order_id,
      take_profit_order_id: takeProfitOrderId,
      replaced_stop_loss_order_id: stopLossOrderId,
      stoploss_price: replacementStopLoss.stop_price,
      takeprofit_price: String(
        currentTakeProfitPrice > 0 ? currentTakeProfitPrice : takeProfitPrice
      ),
      protective_orders: [
        replacementStopLoss,
        {
          kind: 'take_profit',
          order_id: takeProfitOrderId,
          product_id: String(productId),
          status: currentTakeProfit.state ?? 'open',
          side: exitSide,
          stop_price: String(currentTakeProfitPrice > 0 ? currentTakeProfitPrice : takeProfitPrice),
          stop_order_type: 'take_profit_order',
          reduce_only: true,
        },
      ],
    };
  }

  private async requireOpenPosition(
    positionId: string,
    context?: BrokerPositionContext
  ): Promise<DeltaPositionPayload> {
    const position = await this.findPosition(positionId, context?.accountId, context?.userId);
    if (!position) {
      throw new BadRequestAppError('Delta position not found');
    }
    const size = this.toNumber(position.size);
    if (!(Math.abs(size) > 0)) {
      throw new BadRequestAppError('Delta position size is zero');
    }
    return position;
  }

  private resolvePositionProductId(position: DeltaPositionPayload): number {
    const productId = Number(position.product_id);
    if (!Number.isInteger(productId) || productId <= 0) {
      throw new BadRequestAppError('Delta position is missing product_id');
    }
    return productId;
  }

  private resolvePositionContractSize(position: DeltaPositionPayload): number {
    const size = Math.abs(this.toNumber(position.size));
    if (!(size > 0)) {
      throw new BadRequestAppError('Delta position size is zero');
    }
    if (!Number.isInteger(size)) {
      throw new BadRequestAppError(
        'Delta Exchange risk orders require a whole-number contract size'
      );
    }
    return size;
  }

  private resolvePositionEntrySide(position: DeltaPositionPayload): 'buy' | 'sell' {
    const size = this.toNumber(position.size);
    if (size > 0) return 'buy';
    if (size < 0) return 'sell';
    throw new BadRequestAppError('Delta position size is zero');
  }

  private resolveExitSide(entrySide: 'buy' | 'sell'): 'buy' | 'sell' {
    return entrySide === 'buy' ? 'sell' : 'buy';
  }

  private assertRiskOrderBodyFlags(isStopLoss: unknown, isTakeProfit: unknown): void {
    if (isStopLoss !== true || isTakeProfit !== true) {
      throw new BadRequestAppError(
        'Delta Exchange risk orders require both stop-loss and take-profit flags'
      );
    }
  }

  private requirePositivePrice(value: unknown, field: string): number {
    const numeric = this.toNumber(value as string | number | null | undefined);
    if (!(numeric > 0)) {
      throw new BadRequestAppError(`Delta Exchange risk order ${field} must be positive`);
    }
    return numeric;
  }

  private assertProtectionPricesAgainstPosition(
    entrySide: 'buy' | 'sell',
    position: DeltaPositionPayload,
    stopLossPrice: number,
    takeProfitPrice: number
  ): void {
    const markPrice = this.toNumber(position.mark_price);
    const entryPrice = this.toNumber(position.entry_price);
    const referencePrice = markPrice > 0 ? markPrice : entryPrice;
    if (!(referencePrice > 0)) {
      throw new BadRequestAppError(
        'Delta Exchange risk order update requires a live mark or entry price'
      );
    }

    if (entrySide === 'buy') {
      if (!(stopLossPrice < referencePrice)) {
        throw new BadRequestAppError(
          'Delta Exchange long stop-loss must remain below the current mark price'
        );
      }
      if (!(takeProfitPrice > referencePrice)) {
        throw new BadRequestAppError(
          'Delta Exchange long take-profit must remain above the current mark price'
        );
      }
      return;
    }

    if (!(stopLossPrice > referencePrice)) {
      throw new BadRequestAppError(
        'Delta Exchange short stop-loss must remain above the current mark price'
      );
    }
    if (!(takeProfitPrice < referencePrice)) {
      throw new BadRequestAppError(
        'Delta Exchange short take-profit must remain below the current mark price'
      );
    }
  }

  private async getDeltaOrder(
    orderId: string,
    context?: BrokerPositionContext
  ): Promise<DeltaOrderPayload> {
    const normalizedOrderId = String(orderId || '').trim();
    if (!normalizedOrderId) {
      throw new BadRequestAppError('Delta Exchange order id is required');
    }
    return this.deltaHttpClient.signedGet<DeltaOrderPayload>(
      context?.accountId,
      `/v2/orders/${encodeURIComponent(normalizedOrderId)}`,
      undefined,
      context?.userId
    );
  }

  private assertRiskOrderMatchesPosition(
    order: DeltaOrderPayload,
    kind: 'stop_loss' | 'take_profit',
    productId: number,
    size: number,
    exitSide: 'buy' | 'sell'
  ): void {
    const orderId = String(order.id ?? '').trim();
    if (!orderId) {
      throw new BadRequestAppError(`Delta Exchange ${kind} order is missing id`);
    }

    const orderProductId = Number(order.product_id);
    if (orderProductId !== productId) {
      throw new BadRequestAppError(
        `Delta Exchange ${kind} order product does not match the open position`
      );
    }

    if (!this.isActiveRiskOrderState(order.state)) {
      throw new BadRequestAppError(
        `Delta Exchange ${kind} order ${orderId} is not active (${String(order.state || 'unknown')})`
      );
    }

    if (
      String(order.side || '')
        .trim()
        .toLowerCase() !== exitSide
    ) {
      throw new BadRequestAppError(
        `Delta Exchange ${kind} order side does not match the position exit side`
      );
    }

    const expectedStopOrderType = kind === 'stop_loss' ? 'stop_loss_order' : 'take_profit_order';
    if (
      String(order.stop_order_type || '')
        .trim()
        .toLowerCase() !== expectedStopOrderType
    ) {
      throw new BadRequestAppError(
        `Delta Exchange ${kind} order is not a ${expectedStopOrderType}`
      );
    }

    if (!this.readBoolean(order.reduce_only)) {
      throw new BadRequestAppError(`Delta Exchange ${kind} order must be reduce-only`);
    }

    if (Math.abs(this.toNumber(order.size) - size) > 1e-9) {
      throw new BadRequestAppError(
        `Delta Exchange ${kind} order size does not match the open position size`
      );
    }
  }

  private assertTrailingStopImproves(
    entrySide: 'buy' | 'sell',
    currentStopLossPrice: number,
    nextStopLossPrice: number
  ): void {
    if (!(currentStopLossPrice > 0)) {
      throw new BadRequestAppError('Delta Exchange existing stop-loss order is missing stop_price');
    }
    if (entrySide === 'buy' && !(nextStopLossPrice > currentStopLossPrice)) {
      throw new BadRequestAppError(
        'Delta Exchange long trailing stop update cannot move stop-loss backward'
      );
    }
    if (entrySide === 'sell' && !(nextStopLossPrice < currentStopLossPrice)) {
      throw new BadRequestAppError(
        'Delta Exchange short trailing stop update cannot move stop-loss backward'
      );
    }
  }

  private isActiveRiskOrderState(state: string | null | undefined): boolean {
    const normalized = String(state || '')
      .trim()
      .toLowerCase();
    return ['open', 'pending', 'created', 'active', 'untriggered'].includes(normalized);
  }

  private readBoolean(value: unknown): boolean {
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'number') {
      return value !== 0;
    }
    if (typeof value === 'string') {
      return ['1', 'true', 'yes'].includes(value.trim().toLowerCase());
    }
    return false;
  }

  private async createProtectiveOrdersForPosition(
    productId: number,
    size: number,
    entrySide: 'buy' | 'sell',
    stopLossPrice: number,
    takeProfitPrice: number,
    idempotencyKey: string,
    context?: BrokerPositionContext
  ): Promise<DeltaProtectiveOrderResult[]> {
    const exitSide = this.resolveExitSide(entrySide);
    const stopLoss = await this.createProtectiveOrder(
      productId,
      size,
      exitSide,
      'stop_loss',
      'stop_loss_order',
      stopLossPrice,
      this.buildClientOrderId(`${idempotencyKey}:stop_loss`),
      context
    );
    const takeProfit = await this.createProtectiveOrder(
      productId,
      size,
      exitSide,
      'take_profit',
      'take_profit_order',
      takeProfitPrice,
      this.buildClientOrderId(`${idempotencyKey}:take_profit`),
      context
    );
    return [stopLoss, takeProfit];
  }

  private async createProtectiveOrder(
    productId: number,
    size: number,
    side: 'buy' | 'sell',
    kind: 'stop_loss' | 'take_profit',
    stopOrderType: 'stop_loss_order' | 'take_profit_order',
    stopPrice: number,
    clientOrderId: string | undefined,
    context?: BrokerPositionContext
  ): Promise<DeltaProtectiveOrderResult> {
    const formattedStopPrice = this.formatPrice(stopPrice);
    const payload = await this.deltaHttpClient.signedPost<DeltaOrderPayload>(
      context?.accountId,
      '/v2/orders',
      {
        product_id: productId,
        size,
        side,
        order_type: 'market_order',
        time_in_force: 'gtc',
        stop_order_type: stopOrderType,
        stop_price: formattedStopPrice,
        stop_trigger_method: 'mark_price',
        reduce_only: true,
        ...(clientOrderId ? { client_order_id: clientOrderId } : {}),
      },
      context?.userId
    );
    const orderId = String(payload.id ?? '').trim();
    if (!orderId) {
      throw new BadRequestAppError(
        `Delta Exchange ${kind.replace('_', '-')} protection order did not return an order id`
      );
    }

    return {
      kind,
      order_id: orderId,
      product_id: String(productId),
      status: payload.state ?? 'open',
      side,
      stop_price: formattedStopPrice,
      stop_order_type: stopOrderType,
      reduce_only: true,
    };
  }

  private async cancelDeltaOrder(
    order: Pick<DeltaOrderPayload, 'id' | 'product_id'>,
    context?: BrokerPositionContext
  ): Promise<void> {
    const resolvedId = Number(order.id);
    const productId = Number(order.product_id);
    if (!Number.isFinite(resolvedId) || resolvedId <= 0) {
      throw new BadRequestAppError(
        'Cannot cancel Delta risk order: invalid order ID returned by Delta Exchange'
      );
    }
    if (!Number.isFinite(productId) || productId <= 0) {
      throw new BadRequestAppError(
        'Cannot cancel Delta risk order: product_id is required but missing from order details'
      );
    }

    await this.deltaHttpClient.signedDelete<unknown>(
      context?.accountId,
      '/v2/orders',
      { id: resolvedId, product_id: productId },
      context?.userId
    );
  }

  private buildClientOrderId(idempotencyKey?: string): string | undefined {
    const normalized = String(idempotencyKey || '').trim();
    if (!normalized) {
      return undefined;
    }

    const digestLength = DELTA_CLIENT_ORDER_ID_MAX_LENGTH - DELTA_CLIENT_ORDER_ID_PREFIX.length;
    const digest = createHash('sha256').update(normalized).digest('hex').slice(0, digestLength);
    return `${DELTA_CLIENT_ORDER_ID_PREFIX}${digest}`;
  }

  private formatPrice(value: number): string {
    if (!Number.isFinite(value)) {
      return String(value);
    }
    return String(Number(value.toFixed(12)));
  }

  async reversePosition(_positionId: string, _context?: BrokerPositionContext): Promise<unknown> {
    throw new ServiceUnavailableAppError('Delta Exchange reverse position is not enabled yet');
  }

  async closePartial(
    positionId: string,
    body: ClosePartialPositionBody,
    context?: BrokerPositionContext
  ): Promise<unknown> {
    const position = await this.findPosition(positionId, context?.accountId, context?.userId);
    if (!position) {
      throw new BadRequestAppError('Delta position not found');
    }

    const size = this.toNumber(position.size);
    if (!Number.isFinite(size) || Math.abs(size) <= 0) {
      throw new BadRequestAppError('Delta position size is zero');
    }

    const requestedQty = Number(body.quantity);
    if (!Number.isFinite(requestedQty) || requestedQty <= 0) {
      throw new BadRequestAppError('quantity must be a positive number');
    }

    const orderType =
      String(body.order_type || '').toLowerCase() === 'market' ? 'market_order' : 'limit_order';
    const reduceOnlySide = size > 0 ? 'sell' : 'buy';
    const payload = {
      product_id: Number(position.product_id),
      size: requestedQty,
      side: reduceOnlySide,
      order_type: orderType,
      ...(orderType === 'limit_order' ? { limit_price: Number(body.limit_price) } : {}),
      reduce_only: true,
      time_in_force: 'gtc',
    };

    const result = await this.deltaHttpClient.signedPost<{ id?: number | string; state?: string }>(
      context?.accountId,
      '/v2/orders',
      payload,
      context?.userId
    );

    return {
      message: 'Position partial close submitted',
      order_id: String(result?.id ?? ''),
      status: result?.state ?? 'open',
    };
  }

  async closePosition(positionId: string, context?: BrokerPositionContext): Promise<unknown> {
    const position = await this.findPosition(positionId, context?.accountId, context?.userId);
    if (!position) {
      throw new BadRequestAppError('Delta position not found');
    }

    const size = this.toNumber(position.size);
    if (!Number.isFinite(size) || Math.abs(size) <= 0) {
      throw new BadRequestAppError('Delta position size is zero');
    }

    const reduceOnlySide = size > 0 ? 'sell' : 'buy';
    const payload = {
      product_id: Number(position.product_id),
      size: Math.abs(size),
      side: reduceOnlySide,
      order_type: 'market_order',
      reduce_only: true,
      time_in_force: 'gtc',
    };

    const result = await this.deltaHttpClient.signedPost<{ id?: number | string; state?: string }>(
      context?.accountId,
      '/v2/orders',
      payload,
      context?.userId
    );

    return {
      message: 'Position close submitted',
      order_id: String(result?.id ?? ''),
      status: result?.state ?? 'open',
    };
  }

  async getPositionHistory(
    query: PositionsHistoryQuery,
    context?: BrokerPositionContext
  ): Promise<unknown> {
    const fills = await this.fetchFillsWindow(
      {
        contract_types: 'perpetual_futures',
        ...(query.startDate ? { start_time: this.toMicrosStart(query.startDate) } : {}),
        ...(query.endDate ? { end_time: this.toMicrosEnd(query.endDate) } : {}),
        page_size: 50,
      },
      context
    );
    const productMaps = await this.getProductMaps();
    const closedPositions = this.reconstructClosedPositionsFromFills(fills, productMaps);
    const limit = Math.max(1, Math.floor(Number(query.limit || 20)));
    return closedPositions.slice(0, limit);
  }

  async getClosingFills(
    productIds: string[],
    context?: BrokerPositionContext
  ): Promise<
    | Map<
        string,
        {
          closePrice: number;
          closedAt: string;
          fillType: string | null;
          closeFillId: string | null;
          closeOrderId: string | null;
        }
      >
    | undefined
  > {
    if (productIds.length === 0) return new Map();

    const targetSet = new Set(productIds.map(String));
    const fills = await this.fetchFillsWindow(
      {
        contract_types: 'perpetual_futures',
        page_size: 50,
      },
      context,
      targetSet
    );

    const result = new Map<
      string,
      {
        closePrice: number;
        closedAt: string;
        fillType: string | null;
        closeFillId: string | null;
        closeOrderId: string | null;
      }
    >();
    // Fills are returned most-recent-first; first match per product wins.
    for (const fill of fills) {
      const pid = String(fill.product_id ?? '');
      if (!targetSet.has(pid) || result.has(pid)) continue;
      const price = this.toNumber(fill.price);
      if (price <= 0) continue;
      result.set(pid, {
        closePrice: price,
        closedAt: fill.created_at ?? new Date().toISOString(),
        fillType: fill.fill_type ? String(fill.fill_type) : null,
        closeFillId: fill.id === undefined || fill.id === null ? null : String(fill.id),
        closeOrderId:
          fill.order_id === undefined || fill.order_id === null ? null : String(fill.order_id),
      });
    }
    return result;
  }

  private reconstructClosedPositionsFromFills(
    fills: DeltaPositionHistoryPayload[],
    productMaps: DeltaProductMaps
  ) {
    type PositionState = {
      sizeSigned: number;
      avgEntry: number;
      openedAt: string | null;
    };

    const toTimestamp = (value: string | undefined) => {
      if (!value) return 0;
      const d = new Date(value);
      const t = d.getTime();
      return Number.isNaN(t) ? 0 : t;
    };

    const grouped = new Map<string, DeltaPositionHistoryPayload[]>();
    for (const fill of fills) {
      const key = String(fill.product_id ?? fill.product_symbol ?? '').trim() || 'unknown';
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)?.push(fill);
    }

    const output: Array<Record<string, unknown>> = [];

    for (const groupFills of grouped.values()) {
      const sorted = [...groupFills].sort(
        (a, b) => toTimestamp(a.created_at) - toTimestamp(b.created_at)
      );
      const state: PositionState = { sizeSigned: 0, avgEntry: 0, openedAt: null };

      for (const fill of sorted) {
        const side = String(fill.side || '').toLowerCase();
        const quantityContracts = Math.abs(this.toNumber(fill.size));
        const product = this.resolveProductForFill(fill, productMaps);
        const contractValue = this.toNumber(product?.contract_value ?? 0);
        const qty = contractValue > 0 ? quantityContracts * contractValue : quantityContracts;
        const price = this.toNumber(fill.price);
        if (!qty || !Number.isFinite(qty) || qty <= 0) continue;
        if (!price || !Number.isFinite(price) || price <= 0) continue;

        const delta = side === 'sell' ? -qty : qty;

        if (state.sizeSigned === 0) {
          state.sizeSigned = delta;
          state.avgEntry = price;
          state.openedAt = fill.created_at ?? null;
          continue;
        }

        const sameDirection =
          Math.sign(state.sizeSigned) === Math.sign(delta) || Math.sign(delta) === 0;

        if (sameDirection) {
          const oldAbs = Math.abs(state.sizeSigned);
          const newAbs = oldAbs + qty;
          state.avgEntry = (oldAbs * state.avgEntry + qty * price) / newAbs;
          state.sizeSigned += delta;
          continue;
        }

        // Closing trade (opposite direction).
        const oldAbs = Math.abs(state.sizeSigned);
        const closingQty = Math.min(oldAbs, qty);
        const closingContracts = contractValue > 0 ? closingQty / contractValue : closingQty;
        const direction = state.sizeSigned > 0 ? 1 : -1;
        const realized = direction * (price - state.avgEntry) * closingQty;
        const afterSizeSigned = state.sizeSigned + delta;
        const fillType = String(fill.fill_type || '')
          .trim()
          .toLowerCase();
        const isLiquidation = fillType === 'liquidation' || fillType === 'liquidate';
        const positionSide = direction > 0 ? 'long' : 'short';
        const positionStatus = isLiquidation ? 'liquidated' : 'closed';
        const productId = String(fill.product_id ?? product?.id ?? '').trim();
        const lifecycleId = buildDeltaClosedPositionLifecycleId({
          productId,
          side: positionSide,
          status: positionStatus,
          quantity: closingQty,
          entryPrice: state.avgEntry,
          closePrice: price,
          closedAt: fill.created_at,
        });

        output.push({
          created_at: state.openedAt ?? fill.created_at ?? '',
          updated_at: fill.created_at ?? '',
          closed_at: fill.created_at ?? '',
          stoploss: null,
          takeprofit: null,
          entry_price: String(state.avgEntry || 0),
          closed_price: String(price || 0),
          liquidation_price: '0',
          quantity: String(closingQty),
          quantity_contracts: String(closingContracts),
          base_quantity: contractValue > 0 ? String(closingQty) : null,
          contract_value: contractValue > 0 ? String(contractValue) : null,
          contract_unit_currency: product?.contract_unit_currency ?? null,
          leverage: '1',
          order_type: direction > 0 ? 'buy' : 'sell',
          side: direction > 0 ? 'Long' : 'Short',
          position_type: positionSide,
          status: positionStatus,
          close_state: afterSizeSigned === 0 ? 'CLOSED' : 'PARTIAL',
          id: lifecycleId ?? String(fill.id ?? fill.order_id ?? fill.product_id ?? ''),
          asset_uuid: String(fill.product_id ?? ''),
          close_fill_id: fill.id === undefined || fill.id === null ? null : String(fill.id),
          close_order_id:
            fill.order_id === undefined || fill.order_id === null ? null : String(fill.order_id),
          symbol: fill.product_symbol ?? String(fill.product_id ?? ''),
          pnl: realized,
          realized,
          duration: this.calculateDuration(
            state.openedAt ?? undefined,
            fill.created_at ?? undefined
          ),
          fill_type: fill.fill_type ?? null,
          commission: fill.commission ?? null,
        });

        if (qty < oldAbs) {
          // Partial close; keep avg entry and openedAt.
          state.sizeSigned = afterSizeSigned;
          continue;
        }

        if (qty === oldAbs) {
          // Fully closed.
          state.sizeSigned = 0;
          state.avgEntry = 0;
          state.openedAt = null;
          continue;
        }

        // Flipped direction: close the old position and open a new one with the remaining qty at this price.
        const remaining = qty - oldAbs;
        state.sizeSigned = Math.sign(delta) * remaining;
        state.avgEntry = price;
        state.openedAt = fill.created_at ?? null;
      }
    }

    return this.aggregateClosedPositionFillBatches(output);
  }

  private aggregateClosedPositionFillBatches(
    rows: Array<Record<string, unknown>>
  ): Array<Record<string, unknown>> {
    if (rows.length <= 1) {
      return this.sortClosedPositionRows(rows);
    }

    const sorted = this.sortClosedPositionRows(rows);
    const grouped = new Map<string, Array<Record<string, unknown>>>();
    const order: string[] = [];

    for (const row of sorted) {
      const key = this.buildClosedPositionFillBatchKey(row);
      if (!key) {
        const passthroughKey = `passthrough:${order.length}`;
        grouped.set(passthroughKey, [row]);
        order.push(passthroughKey);
        continue;
      }
      if (!grouped.has(key)) {
        grouped.set(key, []);
        order.push(key);
      }
      grouped.get(key)?.push(row);
    }

    const aggregated = order.flatMap((key) => {
      const group = grouped.get(key) ?? [];
      if (group.length <= 1) {
        return group;
      }
      return [this.mergeClosedPositionFillBatch(group)];
    });

    return this.sortClosedPositionRows(aggregated);
  }

  private buildClosedPositionFillBatchKey(row: Record<string, unknown>): string | null {
    const productId = String(row.asset_uuid ?? row.product_id ?? '')
      .trim()
      .toUpperCase();
    const symbol = String(row.symbol ?? '')
      .trim()
      .toUpperCase();
    const side = String(row.position_type ?? row.side ?? '')
      .trim()
      .toLowerCase();
    const status = String(row.status ?? '')
      .trim()
      .toLowerCase();
    const openedAtSecond = this.toTimestampSecondKey(row.created_at);
    const closedAtSecond = this.toTimestampSecondKey(row.closed_at ?? row.updated_at);
    const entryPrice = this.normalizeBatchNumber(row.entry_price);
    const closeOrderId = String(row.close_order_id ?? '').trim();
    const closeBatch = closeOrderId ? `order:${closeOrderId}` : `second:${closedAtSecond}`;

    if (!(productId || symbol) || !side || !status || !openedAtSecond || !closedAtSecond) {
      return null;
    }

    return [
      productId || symbol,
      side,
      status,
      openedAtSecond,
      entryPrice || 'NA',
      closeBatch,
      closedAtSecond,
    ].join('|');
  }

  private mergeClosedPositionFillBatch(
    rows: Array<Record<string, unknown>>
  ): Record<string, unknown> {
    const primary = rows[0] ?? {};
    const quantity = this.sumRowNumber(rows, 'quantity');
    const quantityContracts = this.sumRowNumber(rows, 'quantity_contracts');
    const baseQuantity = this.sumNullableRowNumber(rows, 'base_quantity');
    const realized = this.sumRowNumber(rows, 'realized');
    const pnl = this.sumRowNumber(rows, 'pnl');
    const commission = this.sumNullableRowNumber(rows, 'commission');
    const closeFillIds = this.collectDistinctStrings(rows, 'close_fill_id');
    const closeOrderIds = this.collectDistinctStrings(rows, 'close_order_id');
    const weightedClosedPrice = this.calculateWeightedClosePrice(rows);
    const closedAt = primary.closed_at ?? primary.updated_at;
    const productId = String(primary.asset_uuid ?? primary.product_id ?? '').trim();
    const lifecycleId = buildDeltaClosedPositionLifecycleId({
      productId,
      side: primary.position_type ?? primary.side ?? primary.order_type,
      status: primary.status ?? 'closed',
      quantity,
      entryPrice: primary.entry_price ?? primary.entryPrice,
      closePrice: primary.closed_price ?? primary.closedPrice,
      closedAt,
    });

    return {
      ...primary,
      id: lifecycleId ?? primary.id,
      quantity: this.toHistoryNumberString(quantity),
      quantity_contracts: this.toHistoryNumberString(quantityContracts),
      base_quantity:
        baseQuantity === null
          ? (primary.base_quantity ?? null)
          : this.toHistoryNumberString(baseQuantity),
      pnl: this.toHistoryNumberValue(pnl),
      realized: this.toHistoryNumberValue(realized),
      commission:
        commission === null ? (primary.commission ?? null) : this.toHistoryNumberValue(commission),
      close_state: rows.some((row) => String(row.close_state || '').toUpperCase() === 'CLOSED')
        ? 'CLOSED'
        : 'PARTIAL',
      split_fill_count: rows.length,
      close_fill_ids: closeFillIds,
      close_order_ids: closeOrderIds,
      weighted_closed_price:
        weightedClosedPrice === null ? null : this.toHistoryNumberString(weightedClosedPrice),
    };
  }

  private sortClosedPositionRows(
    rows: Array<Record<string, unknown>>
  ): Array<Record<string, unknown>> {
    return [...rows].sort(
      (a, b) => this.toTimestampMs(b.updated_at) - this.toTimestampMs(a.updated_at)
    );
  }

  private toTimestampMs(value: unknown): number {
    if (!value) return 0;
    const date = new Date(String(value));
    const time = date.getTime();
    return Number.isNaN(time) ? 0 : time;
  }

  private toTimestampSecondKey(value: unknown): string | null {
    const time = this.toTimestampMs(value);
    if (!time) return null;
    return new Date(Math.round(time / 1000) * 1000).toISOString();
  }

  private normalizeBatchNumber(value: unknown): string | null {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    return numeric.toFixed(8);
  }

  private sumRowNumber(rows: Array<Record<string, unknown>>, key: string): number {
    return rows.reduce((sum, row) => sum + this.toUnknownNumber(row[key]), 0);
  }

  private sumNullableRowNumber(rows: Array<Record<string, unknown>>, key: string): number | null {
    let hasValue = false;
    const sum = rows.reduce((total, row) => {
      const rawValue = row[key];
      if (rawValue === undefined || rawValue === null || String(rawValue).trim() === '') {
        return total;
      }
      const value = this.toUnknownNumber(rawValue);
      if (Number.isFinite(value)) {
        hasValue = true;
        return total + value;
      }
      return total;
    }, 0);
    return hasValue ? sum : null;
  }

  private collectDistinctStrings(rows: Array<Record<string, unknown>>, key: string): string[] {
    return Array.from(
      new Set(rows.map((row) => String(row[key] ?? '').trim()).filter((value) => value.length > 0))
    );
  }

  private calculateWeightedClosePrice(rows: Array<Record<string, unknown>>): number | null {
    let notional = 0;
    let quantity = 0;
    for (const row of rows) {
      const rowQuantity = this.toUnknownNumber(row.quantity);
      const closePrice = this.toUnknownNumber(row.closed_price ?? row.closedPrice);
      if (rowQuantity > 0 && closePrice > 0) {
        notional += rowQuantity * closePrice;
        quantity += rowQuantity;
      }
    }
    return quantity > 0 ? notional / quantity : null;
  }

  private toHistoryNumberValue(value: number): number {
    if (!Number.isFinite(value)) {
      return 0;
    }
    return Math.round(value * 1_000_000_000_000) / 1_000_000_000_000;
  }

  private toHistoryNumberString(value: number): string {
    return String(this.toHistoryNumberValue(value));
  }

  private toUnknownNumber(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private resolveProductForFill(
    fill: DeltaPositionHistoryPayload,
    productMaps: DeltaProductMaps
  ): DeltaProduct | undefined {
    const productId = String(fill.product_id ?? '').trim();
    const productSymbol = String(fill.product_symbol ?? '')
      .trim()
      .toUpperCase();
    return (
      (productId && productMaps.byId.get(productId)) ||
      (productSymbol && productMaps.bySymbol.get(productSymbol)) ||
      undefined
    );
  }

  private async fetchFillsWindow(
    baseQuery: Record<string, string | number | boolean | undefined>,
    context?: BrokerPositionContext,
    targetProductIds?: ReadonlySet<string>
  ): Promise<DeltaPositionHistoryPayload[]> {
    const fills: DeltaPositionHistoryPayload[] = [];
    let after: string | undefined;

    for (;;) {
      const envelope = await this.deltaHttpClient.signedGetEnvelope<DeltaPositionHistoryPayload[]>(
        context?.accountId,
        '/v2/fills',
        {
          ...baseQuery,
          ...(after ? { after } : {}),
        },
        context?.userId
      );
      const page = Array.isArray(envelope.result) ? envelope.result : [];
      fills.push(...page);

      if (
        targetProductIds &&
        targetProductIds.size > 0 &&
        this.hasAllTargetProducts(fills, targetProductIds)
      ) {
        break;
      }

      const nextAfter = String(envelope.meta?.after || '').trim();
      if (!nextAfter || page.length === 0) {
        break;
      }
      after = nextAfter;
    }

    return fills;
  }

  private hasAllTargetProducts(
    fills: DeltaPositionHistoryPayload[],
    targetProductIds: ReadonlySet<string>
  ): boolean {
    const seen = new Set<string>();
    for (const fill of fills) {
      const productId = String(fill.product_id ?? '').trim();
      if (productId && targetProductIds.has(productId)) {
        seen.add(productId);
      }
      if (seen.size >= targetProductIds.size) {
        return true;
      }
    }
    return false;
  }

  private async findPosition(
    positionId: string,
    accountId?: string,
    userId?: string
  ): Promise<DeltaPositionPayload | undefined> {
    const payload = await this.deltaHttpClient.signedGet<DeltaPositionPayload[]>(
      accountId,
      '/v2/positions/margined',
      undefined,
      userId
    );

    if (!Array.isArray(payload)) {
      return undefined;
    }

    return payload.find((item) => String(item.product_id ?? '') === positionId);
  }

  private mapPosition(item: DeltaPositionPayload, productMaps: DeltaProductMaps) {
    const isLong = this.toNumber(item.size) >= 0;
    const entryPrice = this.toNumber(item.entry_price);
    const markPrice = this.toNumber(item.mark_price) || entryPrice;
    const quantityContracts = Math.abs(this.toNumber(item.size));
    const productId = String(item.product_id ?? '').trim();
    const productSymbol = String(item.product_symbol ?? '')
      .trim()
      .toUpperCase();
    const product =
      (productId && productMaps.byId.get(productId)) ||
      (productSymbol && productMaps.bySymbol.get(productSymbol)) ||
      undefined;
    const contractValue = this.toNumber(product?.contract_value ?? 0);
    const baseQuantity = contractValue > 0 ? quantityContracts * contractValue : null;
    const quantity = baseQuantity ?? quantityContracts;
    const direction = isLong ? 1 : -1;
    const unrealizedPnl = direction * (markPrice - entryPrice) * quantity;
    const realizedPnl = this.toNumber(item.realized_pnl);
    const brokerLeverage = this.toPositiveNumericString(item.leverage);
    const derivedLeverage =
      brokerLeverage ?? this.deriveLeverageFromMargin(item.margin, quantity, entryPrice, markPrice);
    const leverage = brokerLeverage ?? derivedLeverage;
    return {
      created_at: item.created_at ?? '',
      updated_at: item.updated_at ?? item.created_at ?? '',
      stoploss: null,
      takeprofit: null,
      entry_price: String(entryPrice),
      mark_price: String(markPrice),
      quantity: String(quantity),
      quantity_contracts: String(quantityContracts),
      base_quantity: baseQuantity !== null ? String(baseQuantity) : null,
      contract_value: contractValue ? String(contractValue) : null,
      contract_unit_currency: product?.contract_unit_currency ?? null,
      margin: item.margin === null || item.margin === undefined ? null : String(item.margin),
      leverage,
      ...(brokerLeverage
        ? {
            position_leverage: brokerLeverage,
            observed_position_leverage: brokerLeverage,
            leverage_source: 'broker_position',
          }
        : derivedLeverage
          ? {
              position_leverage: derivedLeverage,
              derived_position_leverage: derivedLeverage,
              leverage_calculation_basis: 'entry_notional_over_margin',
              leverage_source: 'derived_position_margin',
            }
          : {}),
      liquidation_price: String(item.liquidation_price ?? '0'),
      order_type: isLong ? 'buy' : 'sell',
      side: isLong ? 'Long' : 'Short',
      position_type: isLong ? 'long' : 'short',
      status: 'open',
      id: productId || String(item.product_id ?? ''),
      asset_uuid: productId || String(item.product_id ?? ''),
      symbol: item.product_symbol ?? (productId || String(item.product_id ?? '')),
      pnl: unrealizedPnl,
      unrealized_pnl: unrealizedPnl,
      realized: realizedPnl,
    };
  }

  private deriveLeverageFromMargin(
    marginValue: string | number | null | undefined,
    quantity: number,
    entryPrice: number,
    markPrice: number
  ): string | null {
    const margin = this.toNumber(marginValue);
    const price = entryPrice > 0 ? entryPrice : markPrice;
    if (!(margin > 0) || !(quantity > 0) || !(price > 0)) {
      return null;
    }
    const leverage = Math.abs(price * quantity) / margin;
    return this.toRoundedPositiveNumericString(leverage);
  }

  private toRoundedPositiveNumericString(value: number): string | null {
    if (!Number.isFinite(value) || value <= 0) {
      return null;
    }
    return String(Math.round(value * 100_000_000) / 100_000_000);
  }

  private toPositiveNumericString(value: string | number | null | undefined): string | null {
    const numeric = this.toNumber(value);
    if (!(numeric > 0)) {
      return null;
    }
    return String(numeric);
  }

  /** @deprecated No longer used — position history is derived via stale-close + getClosingFills. */
  private mapFillAsClosedPosition(item: DeltaPositionHistoryPayload) {
    const createdAt = item.created_at ?? '';
    const side = String(item.side || '').toLowerCase();
    const isBuy = side === 'buy';
    const size = Math.abs(this.toNumber(item.size));
    const price = this.toNumber(item.price);
    const productId = String(item.product_id ?? '');
    const fillId = String(item.id ?? '');
    const pnl = this.toNumber(item.pnl);
    const realizedCashflow = this.toNumber(item.realized_cashflow);
    const realized = pnl !== 0 ? pnl : realizedCashflow;

    return {
      created_at: createdAt,
      updated_at: createdAt,
      stoploss: null,
      takeprofit: null,
      entry_price: String(price || '0'),
      closed_price: String(price || '0'),
      liquidation_price: '0',
      quantity: String(size),
      leverage: '1',
      order_type: isBuy ? 'buy' : 'sell',
      side: isBuy ? 'Long' : 'Short',
      position_type: isBuy ? 'long' : 'short',
      status: 'closed',
      id: fillId || productId,
      asset_uuid: productId,
      symbol: item.product_symbol ?? productId,
      pnl: realized,
      realized,
      duration: this.calculateDuration(createdAt, createdAt),
    };
  }

  private calculateDuration(createdAt?: string, closedAt?: string): string {
    if (!createdAt || !closedAt) {
      return '--';
    }

    const from = new Date(createdAt);
    const to = new Date(closedAt);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      return '--';
    }

    const diffMs = Math.max(to.getTime() - from.getTime(), 0);
    const minutes = Math.floor(diffMs / 60000);
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;

    if (hours > 0) {
      return `${hours}h ${remainingMinutes}m`;
    }
    return `${minutes}m`;
  }

  private toNumber(value: string | number | null | undefined): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private toMicrosStart(date: string): number {
    return Date.parse(`${date}T00:00:00.000Z`) * 1000;
  }

  private toMicrosEnd(date: string): number {
    return Date.parse(`${date}T23:59:59.999Z`) * 1000;
  }
}
