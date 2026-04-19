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
  created_at?: string;
  updated_at?: string;
  side?: string | null;
  limit_price?: string | number | null;
  average_fill_price?: string | number | null;
  stop_price?: string | number | null;
  size?: string | number | null;
  unfilled_size?: string | number | null;
  leverage?: string | number | null;
  state?: string | null;
  order_type?: string | null;
  time_in_force?: string | null;
}

@Service()
export class DeltaExchangeOrdersAdapter implements BrokerOrdersAdapter {
  @Inject(() => DeltaExchangeHttpClient)
  private deltaHttpClient!: DeltaExchangeHttpClient;

  @Inject(() => ExchangeAssetRepository)
  private exchangeAssetRepository!: ExchangeAssetRepository;

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
    const size = this.resolveOrderSize(body.quantity);
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

    const payload = await this.deltaHttpClient.signedPost<DeltaOrderPayload>(
      context?.accountId,
      '/v2/orders',
      requestPayload,
      context?.userId
    );

    return {
      leverage: String(body.leverage),
      amount: String(Number(body.order_price) * size),
      quantity: String(size),
      price: String(body.order_price),
      order_id: String(payload.id ?? ''),
      status: payload.state ?? 'open',
      message: 'Order submitted',
    };
  }

  private resolveOrderSize(quantity: unknown): number {
    const size = Number(quantity);
    if (!Number.isInteger(size) || size <= 0) {
      throw new BadRequestAppError(
        'Delta Exchange order size must be a positive integer contract quantity'
      );
    }

    return size;
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
