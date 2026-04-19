import { createHash } from 'crypto';
import { Inject, Service } from 'typedi';
import {
  BrokerOrderContext,
  BrokerOrdersAdapter,
  ValidatedCreateOrderRouteBody,
  ValidatedOrdersRouteQuery,
} from './types';
import { DeltaExchangeHttpClient } from '../../providers/delta_exchange/DeltaExchangeHttpClient';
import { ExchangeAssetRepository } from '../../../database';
import { BadRequestAppError } from '../../../api';

interface DeltaOrderPayload {
  id?: number | string;
  product_id?: number | string;
  product_symbol?: string;
  client_order_id?: string | null;
  created_at?: string;
  updated_at?: string;
  side?: string | null;
  limit_price?: string | number | null;
  average_fill_price?: string | number | null;
  stop_price?: string | number | null;
  stop_order_type?: string | null;
  size?: string | number | null;
  unfilled_size?: string | number | null;
  leverage?: string | number | null;
  state?: string | null;
  order_type?: string | null;
  time_in_force?: string | null;
}

interface DeltaProductPayload {
  id?: number | string;
  symbol?: string;
  contract_value?: string | number | null;
  contract_unit_currency?: string | null;
  contract_type?: string | null;
  notional_type?: string | null;
  state?: string | null;
  trading_status?: string | null;
}

interface DeltaProtectiveOrderResult {
  kind: 'stop_loss' | 'take_profit';
  order_id: string;
  status: string;
  side: 'buy' | 'sell';
  stop_price: string;
  stop_order_type: 'stop_loss_order' | 'take_profit_order';
  reduce_only: true;
}

@Service()
export class DeltaExchangeOrdersAdapter implements BrokerOrdersAdapter {
  @Inject(() => DeltaExchangeHttpClient)
  private deltaHttpClient!: DeltaExchangeHttpClient;

  @Inject(() => ExchangeAssetRepository)
  private exchangeAssetRepository!: ExchangeAssetRepository;

  private productCache: { fetchedAt: number; byId: Map<string, DeltaProductPayload> } | null = null;

  async listOpenOrders(
    query: ValidatedOrdersRouteQuery,
    context?: BrokerOrderContext
  ): Promise<unknown> {
    const pageSize = Math.min(Math.max(1, Number(query.limit || 50)), 50);
    const maxItems = Math.min(Math.max(1, Number(query.limit || 50)), 50000);
    let after: string | null | undefined;
    const items: DeltaOrderPayload[] = [];

    while (items.length < maxItems) {
      const envelope = await this.deltaHttpClient.signedGetEnvelope<DeltaOrderPayload[]>(
        context?.accountId,
        '/v2/orders',
        {
          // Delta supports filtering by multiple states via `states=open,pending`.
          // This makes "open orders" include both open and pending orders.
          states: 'open,pending',
          page_size: pageSize,
          ...(after ? { after } : {}),
        },
        context?.userId
      );
      const page = Array.isArray(envelope.result) ? envelope.result : [];
      if (page.length === 0) break;
      items.push(...page);
      after = envelope.meta?.after;
      if (!after || page.length < pageSize) break;
    }

    return items.slice(0, maxItems).map((item) => this.mapOrder(item));
  }

  async createOrder(
    assetId: string,
    body: ValidatedCreateOrderRouteBody,
    context?: BrokerOrderContext
  ): Promise<unknown> {
    const productId = await this.resolveProductId(assetId);
    const product = await this.resolveProductForOrder(productId, body);
    const size = this.resolveOrderSize(body.quantity, product, body);
    const side = this.resolveOrderSide(body);
    const orderType = this.resolveOrderType(body.order_type);
    const timeInForce = this.resolveTimeInForce(body.trigger_type, orderType);
    const clientOrderId = this.buildClientOrderId(body.idempotency_key);
    const requestPayload: Record<string, unknown> = {
      product_id: productId,
      size,
      side,
      order_type: orderType,
      time_in_force: timeInForce,
      ...(body.reduce_only ? { reduce_only: true } : {}),
      ...(clientOrderId ? { client_order_id: clientOrderId } : {}),
    };

    if (orderType === 'limit_order') {
      requestPayload.limit_price = String(body.order_price);
    }

    const shouldAttachProtection = this.shouldAttachLiveAutoProtection(body);
    if (shouldAttachProtection) {
      this.assertLiveAutoProtectivePrices(side, body);
    }

    const payload = await this.deltaHttpClient.signedPost<DeltaOrderPayload>(
      context?.accountId,
      '/v2/orders',
      requestPayload,
      context?.userId
    );
    const primaryOrderId = String(payload.id ?? '').trim();
    if (shouldAttachProtection && !primaryOrderId) {
      throw new BadRequestAppError(
        'Delta Exchange live-auto entry order did not return an order id before protection placement'
      );
    }
    let protectiveOrders: DeltaProtectiveOrderResult[] = [];
    if (shouldAttachProtection) {
      try {
        protectiveOrders = await this.createLiveAutoProtectiveOrders(
          productId,
          size,
          side,
          body,
          context
        );
      } catch (error) {
        throw new BadRequestAppError(
          `Delta Exchange entry order ${primaryOrderId} was accepted, but native SL/TP protection failed: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
    const amount = this.resolveEstimatedOrderValue(size, body.order_price, product);
    const contractValue = this.toNumber(product?.contract_value);

    return {
      leverage: String(body.leverage),
      amount: String(amount),
      quantity: String(size),
      ...(contractValue > 0
        ? {
            base_quantity: String(size * contractValue),
            contract_value: String(contractValue),
            contract_unit_currency: product?.contract_unit_currency ?? null,
          }
        : {}),
      price: String(body.order_price),
      order_id: primaryOrderId,
      status: payload.state ?? 'open',
      protection_status: protectiveOrders.length ? 'attached' : 'not_requested',
      ...(protectiveOrders.length
        ? {
            protective_orders: protectiveOrders,
            stop_loss_order_id:
              protectiveOrders.find((order) => order.kind === 'stop_loss')?.order_id ?? null,
            take_profit_order_id:
              protectiveOrders.find((order) => order.kind === 'take_profit')?.order_id ?? null,
          }
        : {}),
      message: 'Order submitted',
    };
  }

  private shouldAttachLiveAutoProtection(body: ValidatedCreateOrderRouteBody): boolean {
    return (
      this.isLiveAutoSubmission(body) &&
      body.execution_mode === 'live' &&
      body.reduce_only !== true &&
      body.is_stoploss !== true &&
      body.is_takeprofit !== true
    );
  }

  private assertLiveAutoProtectivePrices(
    entrySide: 'buy' | 'sell',
    body: ValidatedCreateOrderRouteBody
  ): void {
    const entryPrice = this.toNumber(body.order_price);
    const stopLossPrice = this.toNumber(body.stoploss_price);
    const takeProfitPrice = this.toNumber(body.takeprofit_price);
    if (!(entryPrice > 0 && stopLossPrice > 0 && takeProfitPrice > 0)) {
      throw new BadRequestAppError(
        'Delta Exchange live-auto requires native stop-loss and take-profit prices'
      );
    }

    if (entrySide === 'buy' && !(stopLossPrice < entryPrice && takeProfitPrice > entryPrice)) {
      throw new BadRequestAppError(
        'Delta Exchange long protection requires stop-loss below entry and take-profit above entry'
      );
    }

    if (entrySide === 'sell' && !(stopLossPrice > entryPrice && takeProfitPrice < entryPrice)) {
      throw new BadRequestAppError(
        'Delta Exchange short protection requires stop-loss above entry and take-profit below entry'
      );
    }
  }

  private async createLiveAutoProtectiveOrders(
    productId: number,
    size: number,
    entrySide: 'buy' | 'sell',
    body: ValidatedCreateOrderRouteBody,
    context?: BrokerOrderContext
  ): Promise<DeltaProtectiveOrderResult[]> {
    const exitSide = entrySide === 'buy' ? 'sell' : 'buy';
    const stopLoss = await this.createLiveAutoProtectiveOrder(
      productId,
      size,
      exitSide,
      body,
      'stop_loss',
      'stop_loss_order',
      body.stoploss_price,
      context
    );
    const takeProfit = await this.createLiveAutoProtectiveOrder(
      productId,
      size,
      exitSide,
      body,
      'take_profit',
      'take_profit_order',
      body.takeprofit_price,
      context
    );

    return [stopLoss, takeProfit];
  }

  private async createLiveAutoProtectiveOrder(
    productId: number,
    size: number,
    side: 'buy' | 'sell',
    body: ValidatedCreateOrderRouteBody,
    kind: 'stop_loss' | 'take_profit',
    stopOrderType: 'stop_loss_order' | 'take_profit_order',
    stopPrice: number,
    context?: BrokerOrderContext
  ): Promise<DeltaProtectiveOrderResult> {
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
        stop_price: String(stopPrice),
        stop_trigger_method: 'mark_price',
        reduce_only: true,
        ...(body.idempotency_key
          ? { client_order_id: this.buildClientOrderId(`${body.idempotency_key}:${kind}`) }
          : {}),
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
      status: payload.state ?? 'open',
      side,
      stop_price: String(stopPrice),
      stop_order_type: stopOrderType,
      reduce_only: true,
    };
  }

  private resolveOrderSize(
    quantity: unknown,
    product: DeltaProductPayload | null,
    body: ValidatedCreateOrderRouteBody
  ): number {
    const size = Number(quantity);
    if (Number.isInteger(size) && size > 0) {
      return size;
    }

    if (this.isLiveAutoSubmission(body)) {
      const contractValue = this.toNumber(product?.contract_value);
      if (!(contractValue > 0)) {
        throw new BadRequestAppError(
          'Delta Exchange live-auto quantity conversion requires product contract_value'
        );
      }
      const notionalType = String(product?.notional_type || '').trim().toLowerCase();
      if (notionalType && notionalType !== 'vanilla') {
        throw new BadRequestAppError(
          'Delta Exchange live-auto quantity conversion requires a vanilla contract'
        );
      }
      const contractSize = Math.floor(size / contractValue);
      if (!(contractSize > 0)) {
        throw new BadRequestAppError(
          'Delta Exchange live-auto notional is smaller than one whole contract'
        );
      }

      return contractSize;
    }

    if (!(size > 0)) {
      throw new BadRequestAppError(
        'Delta Exchange order size must be a positive integer contract quantity'
      );
    }

    throw new BadRequestAppError(
      'Delta Exchange order size must be a whole-number contract quantity'
    );
  }

  private resolveOrderSide(body: ValidatedCreateOrderRouteBody): 'buy' | 'sell' {
    return body.side === 'short' ? 'sell' : 'buy';
  }

  private resolveOrderType(orderType: string): 'market_order' | 'limit_order' {
    const normalized = orderType.trim().toLowerCase();
    if (normalized === 'market' || normalized === 'market_order') {
      return 'market_order';
    }
    if (normalized === 'limit' || normalized === 'limit_order') {
      return 'limit_order';
    }

    throw new BadRequestAppError('Delta Exchange order_type must be market or limit');
  }

  private resolveTimeInForce(
    triggerType: string | undefined,
    orderType: 'market_order' | 'limit_order'
  ): 'gtc' | 'ioc' {
    const normalized = String(triggerType || '').trim().toLowerCase();
    if (normalized === 'gtc' || normalized === 'ioc') {
      return normalized;
    }
    if (normalized === 'immediate' || normalized === 'market') {
      return 'ioc';
    }

    return orderType === 'market_order' ? 'ioc' : 'gtc';
  }

  private buildClientOrderId(idempotencyKey?: string): string | undefined {
    const normalized = String(idempotencyKey || '').trim();
    if (!normalized) {
      return undefined;
    }

    const digest = createHash('sha256').update(normalized).digest('hex').slice(0, 32);
    return `auralpha_${digest}`;
  }

  private isLiveAutoSubmission(body: ValidatedCreateOrderRouteBody): boolean {
    return String(body.idempotency_key || '').trim().startsWith('live-auto:');
  }

  private async resolveProductForOrder(
    productId: number,
    body: ValidatedCreateOrderRouteBody
  ): Promise<DeltaProductPayload | null> {
    if (!this.isLiveAutoSubmission(body)) {
      return null;
    }

    const product = await this.getProductById(productId);
    this.assertLiveAutoProduct(product, productId);
    return product;
  }

  private assertLiveAutoProduct(product: DeltaProductPayload | null, productId: number): void {
    if (!product) {
      throw new BadRequestAppError(
        `Delta Exchange product ${productId} was not found in the live product catalog`
      );
    }

    const state = String(product.state || '').trim().toLowerCase();
    const tradingStatus = String(product.trading_status || '').trim().toLowerCase();
    const contractType = String(product.contract_type || '').trim().toLowerCase();
    if (
      state !== 'live' ||
      tradingStatus !== 'operational' ||
      contractType !== 'perpetual_futures'
    ) {
      throw new BadRequestAppError(
        `Delta Exchange product ${productId} is not live and operational for live-auto placement`
      );
    }

    if (!(this.toNumber(product.contract_value) > 0)) {
      throw new BadRequestAppError(
        `Delta Exchange product ${productId} is missing contract_value for live-auto placement`
      );
    }
  }

  private async getProductById(productId: number): Promise<DeltaProductPayload | null> {
    const now = Date.now();
    if (!this.productCache || now - this.productCache.fetchedAt > 5 * 60 * 1000) {
      const products = await this.deltaHttpClient.publicGet<DeltaProductPayload[]>('/v2/products');
      const byId = new Map<string, DeltaProductPayload>();
      for (const product of Array.isArray(products) ? products : []) {
        const id = String(product.id ?? '').trim();
        if (id) {
          byId.set(id, product);
        }
      }
      this.productCache = { fetchedAt: now, byId };
    }

    return this.productCache.byId.get(String(productId)) ?? null;
  }

  private resolveEstimatedOrderValue(
    contracts: number,
    orderPrice: unknown,
    product: DeltaProductPayload | null
  ): number {
    const price = Number(orderPrice);
    if (!(Number.isFinite(price) && price > 0)) {
      return 0;
    }
    const contractValue = this.toNumber(product?.contract_value);
    return Number((price * contracts * (contractValue > 0 ? contractValue : 1)).toFixed(8));
  }

  async getOrder(orderId: string, context?: BrokerOrderContext): Promise<unknown> {
    const payload = await this.deltaHttpClient.signedGet<DeltaOrderPayload>(
      context?.accountId,
      `/v2/orders/${encodeURIComponent(orderId)}`,
      undefined,
      context?.userId
    );

    return this.mapOrder(payload);
  }

  async getOrderHistory(
    query: ValidatedOrdersRouteQuery,
    context?: BrokerOrderContext
  ): Promise<unknown> {
    const pageSize = 50;
    const maxItems = Math.min(Math.max(1, Number(query.limit || 100)), 50000);
    const startTime = this.toEpochMicrosStartOfDay(query.startDate);
    const endTime = this.toEpochMicrosEndOfDay(query.endDate);
    let after: string | null | undefined;
    const items: DeltaOrderPayload[] = [];

    while (items.length < maxItems) {
      const envelope = await this.deltaHttpClient.signedGetEnvelope<DeltaOrderPayload[]>(
        context?.accountId,
        '/v2/orders/history',
        {
          page_size: pageSize,
          ...(startTime ? { start_time: startTime } : {}),
          ...(endTime ? { end_time: endTime } : {}),
          ...(after ? { after } : {}),
        },
        context?.userId
      );
      const page = Array.isArray(envelope.result) ? envelope.result : [];
      if (page.length === 0) break;
      items.push(...page);
      after = envelope.meta?.after;
      if (!after || page.length < pageSize) break;
    }

    return items.slice(0, maxItems).map((item) => this.mapOrder(item));
  }

  private toEpochMicrosStartOfDay(value?: string): number | undefined {
    if (!value) return undefined;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return undefined;
    // `YYYY-MM-DD` parses to UTC midnight in JS.
    return Math.floor(date.getTime() * 1000);
  }

  private toEpochMicrosEndOfDay(value?: string): number | undefined {
    if (!value) return undefined;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return undefined;
    const end = new Date(date.getTime() + 24 * 60 * 60 * 1000 - 1);
    return Math.floor(end.getTime() * 1000);
  }

  async cancelOrder(orderId: string, context?: BrokerOrderContext): Promise<unknown> {
    const detail = (await this.deltaHttpClient.signedGet<DeltaOrderPayload>(
      context?.accountId,
      `/v2/orders/${encodeURIComponent(orderId)}`,
      undefined,
      context?.userId
    )) as DeltaOrderPayload;

    const resolvedId = Number(detail.id ?? orderId);
    const productId = Number(detail.product_id);

    if (!Number.isFinite(resolvedId) || resolvedId <= 0) {
      throw new BadRequestAppError('Cannot cancel order: invalid order ID returned by Delta Exchange');
    }
    if (!Number.isFinite(productId) || productId <= 0) {
      throw new BadRequestAppError('Cannot cancel order: product_id is required but missing from order details');
    }

    await this.deltaHttpClient.signedDelete<unknown>(
      context?.accountId,
      '/v2/orders',
      { id: resolvedId, product_id: productId },
      context?.userId,
    );

    return {
      message: 'Order cancel requested',
      order_id: String(resolvedId),
      status: 'cancelled',
    };
  }

  private async resolveProductId(assetId: string): Promise<number> {
    const directValue = Number(assetId);
    if (Number.isInteger(directValue) && directValue > 0) {
      return directValue;
    }

    const mappedByExternalId = await this.exchangeAssetRepository.getSystemAssetBySourceAndExternalId(
      'delta_exchange',
      assetId
    );
    if (mappedByExternalId) {
      return this.toProductId(mappedByExternalId.externalId, assetId);
    }

    const mappedByAssetId = await this.exchangeAssetRepository.getSystemAssetBySourceAndAssetId(
      'delta_exchange',
      assetId
    );
    if (mappedByAssetId) {
      return this.toProductId(mappedByAssetId.externalId, assetId);
    }

    const mappedBySymbol = await this.exchangeAssetRepository.getSystemAssetBySourceAndSymbol(
      'delta_exchange',
      assetId.toUpperCase()
    );
    if (mappedBySymbol) {
      return this.toProductId(mappedBySymbol.externalId, assetId);
    }

    throw new BadRequestAppError(
      'Delta Exchange product mapping not found for the selected asset'
    );
  }

  private toProductId(value: unknown, assetId: string): number {
    const productId = Number(value);
    if (!Number.isInteger(productId) || productId <= 0) {
      throw new BadRequestAppError(
        `Delta Exchange product mapping for ${assetId} does not contain a numeric product_id`
      );
    }

    return productId;
  }

  private mapOrder(item: DeltaOrderPayload) {
    const quantity = this.toNumber(item.size);
    const unfilled = this.toNumber(item.unfilled_size);
    const filledQuantity = quantity > 0 ? Math.max(quantity - unfilled, 0) : 0;
    const price = this.toNumber(item.limit_price) || this.toNumber(item.stop_price);
    const filledPrice = this.toNumber(item.average_fill_price) || price;
    const side = item.side ? String(item.side).toLowerCase() : null;

    return {
      created_at: item.created_at ?? '',
      updated_at: item.updated_at ?? item.created_at ?? '',
      reason: null,
      actual_amount: price * quantity,
      desired_amount: price * quantity,
      quantity,
      filled_quantity: filledQuantity,
      price,
      filled_price: filledPrice,
      leverage: this.toNumber(item.leverage) || 1,
      liquidation_price: undefined,
      hedge_rate: undefined,
      trade_currency: undefined,
      order_type: item.order_type ?? 'limit',
      trigger_type: item.time_in_force ?? 'gtc',
      status: item.state ?? 'open',
      side: side || undefined,
      id: String(item.id ?? ''),
      asset_uuid: String(item.product_id ?? ''),
      symbol: item.product_symbol ?? String(item.product_id ?? ''),
    };
  }

  private toNumber(value: string | number | null | undefined): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
}
