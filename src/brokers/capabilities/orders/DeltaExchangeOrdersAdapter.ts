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

const DELTA_CLIENT_ORDER_ID_MAX_LENGTH = 32;
const DELTA_CLIENT_ORDER_ID_PREFIX = 'aur_';

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
  reduce_only?: boolean | string | null;
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

interface DeltaProductCache {
  fetchedAt: number;
  products: DeltaProductPayload[];
  byId: Map<string, DeltaProductPayload>;
}

interface DeltaResolvedOrderProduct {
  productId: number;
  product: DeltaProductPayload | null;
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

interface DeltaProtectionPricePlan {
  stopLossPrice: number;
  takeProfitPrice: number;
  referenceEntryPrice: number;
  rebased: boolean;
}

interface DeltaOrderLeveragePayload {
  leverage?: string | number | null;
  order_margin?: string | number | null;
  product_id?: string | number | null;
}

interface DeltaPositionPayload {
  product_id?: number | string;
  product_symbol?: string;
  size?: string | number | null;
}

@Service()
export class DeltaExchangeOrdersAdapter implements BrokerOrdersAdapter {
  @Inject(() => DeltaExchangeHttpClient)
  private deltaHttpClient!: DeltaExchangeHttpClient;

  @Inject(() => ExchangeAssetRepository)
  private exchangeAssetRepository!: ExchangeAssetRepository;

  private productCache: DeltaProductCache | null = null;

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
    const requestedProductId = await this.resolveProductId(assetId);
    const resolvedProduct = await this.resolveProductForOrder(requestedProductId, body);
    const productId = resolvedProduct.productId;
    const product = resolvedProduct.product;
    const size = this.resolveOrderSize(body.quantity, product, body);
    const side = this.resolveOrderSide(body);
    const orderType = this.resolveOrderType(body.order_type);
    const timeInForce = this.resolveTimeInForce(body.trigger_type, orderType);
    const shouldAttachProtection = this.shouldAttachLiveAutoProtection(body);
    if (shouldAttachProtection) {
      this.assertLiveAutoProtectivePrices(side, body);
      await this.assertLiveAutoProtectionCanBeAttached(productId, product, body, context);
    }
    const clientOrderId = this.buildClientOrderId(body.idempotency_key);
    const confirmedLeverage = await this.ensureOrderLeverageConfigured(
      productId,
      body,
      context
    );
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
    const primaryOrderId = String(payload.id ?? '').trim();
    if (shouldAttachProtection && !primaryOrderId) {
      throw new BadRequestAppError(
        'Delta Exchange live-auto entry order did not return an order id before protection placement'
      );
    }
    const protectionPlan = shouldAttachProtection
      ? await this.resolveLiveAutoProtectionPricePlan(
          primaryOrderId,
          orderType,
          payload,
          side,
          body,
          context
        )
      : null;
    let protectiveOrders: DeltaProtectiveOrderResult[] = [];
    if (shouldAttachProtection) {
      try {
        protectiveOrders = await this.createLiveAutoProtectiveOrders(
          productId,
          size,
          side,
          protectionPlan ?? this.createDefaultProtectionPricePlan(body),
          body.idempotency_key,
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
      leverage: String(confirmedLeverage ?? body.leverage),
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
      ...(protectionPlan
        ? {
            protection_reference_price: String(protectionPlan.referenceEntryPrice),
            protection_rebased: protectionPlan.rebased,
          }
        : {}),
      ...(protectionPlan && protectionPlan.rebased
        ? {
            filled_price: String(protectionPlan.referenceEntryPrice),
          }
        : {}),
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

  private async ensureOrderLeverageConfigured(
    productId: number,
    body: ValidatedCreateOrderRouteBody,
    context?: BrokerOrderContext
  ): Promise<number | null> {
    if (body.reduce_only === true) {
      return null;
    }

    const requestedLeverage = this.toNumber(body.leverage);
    if (!(requestedLeverage > 0)) {
      return null;
    }

    const payload = await this.deltaHttpClient.signedPost<DeltaOrderLeveragePayload>(
      context?.accountId,
      `/v2/products/${encodeURIComponent(String(productId))}/orders/leverage`,
      {
        leverage: String(requestedLeverage),
      },
      context?.userId
    );

    const confirmedLeverage = this.toNumber(payload?.leverage);
    if (!(confirmedLeverage > 0)) {
      return requestedLeverage;
    }

    if (Math.abs(confirmedLeverage - requestedLeverage) > 1e-12) {
      throw new BadRequestAppError(
        `Delta Exchange confirmed leverage ${confirmedLeverage} instead of requested leverage ${requestedLeverage}`
      );
    }

    return confirmedLeverage;
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
    plan: DeltaProtectionPricePlan,
    idempotencyKey?: string,
    context?: BrokerOrderContext
  ): Promise<DeltaProtectiveOrderResult[]> {
    const exitSide = entrySide === 'buy' ? 'sell' : 'buy';
    const stopLoss = await this.createLiveAutoProtectiveOrder(
      productId,
      size,
      exitSide,
      'stop_loss',
      'stop_loss_order',
      plan.stopLossPrice,
      this.buildClientOrderId(
        idempotencyKey ? `${idempotencyKey}:stop_loss` : undefined
      ),
      context
    );
    const takeProfit = await this.createLiveAutoProtectiveOrder(
      productId,
      size,
      exitSide,
      'take_profit',
      'take_profit_order',
      plan.takeProfitPrice,
      this.buildClientOrderId(
        idempotencyKey ? `${idempotencyKey}:take_profit` : undefined
      ),
      context
    );

    return [stopLoss, takeProfit];
  }

  private async assertLiveAutoProtectionCanBeAttached(
    productId: number,
    product: DeltaProductPayload | null,
    body: ValidatedCreateOrderRouteBody,
    context?: BrokerOrderContext
  ): Promise<void> {
    const positions = await this.deltaHttpClient.signedGet<DeltaPositionPayload[]>(
      context?.accountId,
      '/v2/positions/margined',
      undefined,
      context?.userId
    );
    if (!Array.isArray(positions) || positions.length === 0) {
      return;
    }

    const requestedSymbol =
      String(body.symbol || product?.symbol || '').trim() || String(productId);
    const hasOpenNetExposure = positions.some((position) => {
      if (!(Math.abs(this.toNumber(position.size)) > 0)) {
        return false;
      }

      const positionProductId = String(position.product_id ?? '').trim();
      if (positionProductId && positionProductId === String(productId)) {
        return true;
      }

      return this.isDeltaSymbolCompatible(position.product_symbol, requestedSymbol);
    });

    if (hasOpenNetExposure) {
      throw new BadRequestAppError(
        'Delta Exchange live-auto native SL/TP is not safe when the account already has an open net position on this symbol. Close or reconcile the existing Delta exposure before placing another protected live-auto order.'
      );
    }
  }

  private createDefaultProtectionPricePlan(
    body: ValidatedCreateOrderRouteBody
  ): DeltaProtectionPricePlan {
    return {
      stopLossPrice: body.stoploss_price,
      takeProfitPrice: body.takeprofit_price,
      referenceEntryPrice: body.order_price,
      rebased: false,
    };
  }

  private async resolveLiveAutoProtectionPricePlan(
    primaryOrderId: string,
    orderType: 'market_order' | 'limit_order',
    payload: DeltaOrderPayload,
    entrySide: 'buy' | 'sell',
    body: ValidatedCreateOrderRouteBody,
    context?: BrokerOrderContext
  ): Promise<DeltaProtectionPricePlan> {
    const fallback = this.createDefaultProtectionPricePlan(body);
    const plannedEntryPrice = this.toNumber(body.order_price);
    const actualEntryPrice = await this.resolveLiveAutoFilledEntryPrice(
      primaryOrderId,
      orderType,
      payload,
      context
    );
    if (!(plannedEntryPrice > 0) || !(typeof actualEntryPrice === 'number' && actualEntryPrice > 0)) {
      return fallback;
    }
    const resolvedEntryPrice = actualEntryPrice;

    const stopLossDelta = this.toNumber(body.stoploss_price) - plannedEntryPrice;
    const takeProfitDelta = this.toNumber(body.takeprofit_price) - plannedEntryPrice;
    const stopLossPrice = this.roundPrice(resolvedEntryPrice + stopLossDelta);
    const takeProfitPrice = this.roundPrice(resolvedEntryPrice + takeProfitDelta);

    if (!(stopLossPrice > 0 && takeProfitPrice > 0)) {
      return fallback;
    }

    if (
      (entrySide === 'buy' &&
        !(stopLossPrice < resolvedEntryPrice && takeProfitPrice > resolvedEntryPrice)) ||
      (entrySide === 'sell' &&
        !(stopLossPrice > resolvedEntryPrice && takeProfitPrice < resolvedEntryPrice))
    ) {
      return fallback;
    }

    return {
      stopLossPrice,
      takeProfitPrice,
      referenceEntryPrice: resolvedEntryPrice,
      rebased:
        Math.abs(resolvedEntryPrice - plannedEntryPrice) > 1e-12 &&
        (Math.abs(stopLossPrice - this.toNumber(body.stoploss_price)) > 1e-12 ||
          Math.abs(takeProfitPrice - this.toNumber(body.takeprofit_price)) > 1e-12),
    };
  }

  private async resolveLiveAutoFilledEntryPrice(
    primaryOrderId: string,
    orderType: 'market_order' | 'limit_order',
    payload: DeltaOrderPayload,
    context?: BrokerOrderContext
  ): Promise<number | null> {
    const payloadFilledPrice = this.toNumber(payload.average_fill_price);
    if (payloadFilledPrice > 0) {
      return payloadFilledPrice;
    }

    if (!primaryOrderId || !this.shouldRefreshFilledEntryPrice(orderType, payload.state)) {
      return null;
    }

    try {
      const detail = await this.deltaHttpClient.signedGet<DeltaOrderPayload>(
        context?.accountId,
        `/v2/orders/${encodeURIComponent(primaryOrderId)}`,
        undefined,
        context?.userId
      );
      const detailFilledPrice = this.toNumber(detail.average_fill_price);
      return detailFilledPrice > 0 ? detailFilledPrice : null;
    } catch {
      return null;
    }
  }

  private shouldRefreshFilledEntryPrice(
    orderType: 'market_order' | 'limit_order',
    state: string | null | undefined
  ): boolean {
    const normalizedState = String(state || '').trim().toLowerCase();
    if (!['closed', 'filled', 'completed', 'executed'].includes(normalizedState)) {
      return false;
    }

    return orderType === 'market_order' || orderType === 'limit_order';
  }

  private roundPrice(value: number): number {
    if (!Number.isFinite(value)) {
      return value;
    }
    return Number(value.toFixed(12));
  }

  private async createLiveAutoProtectiveOrder(
    productId: number,
    size: number,
    side: 'buy' | 'sell',
    kind: 'stop_loss' | 'take_profit',
    stopOrderType: 'stop_loss_order' | 'take_profit_order',
    stopPrice: number,
    clientOrderId?: string,
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

    const digestLength = DELTA_CLIENT_ORDER_ID_MAX_LENGTH - DELTA_CLIENT_ORDER_ID_PREFIX.length;
    const digest = createHash('sha256').update(normalized).digest('hex').slice(0, digestLength);
    return `${DELTA_CLIENT_ORDER_ID_PREFIX}${digest}`;
  }

  private isLiveAutoSubmission(body: ValidatedCreateOrderRouteBody): boolean {
    return String(body.idempotency_key || '').trim().startsWith('live-auto:');
  }

  private async resolveProductForOrder(
    productId: number,
    body: ValidatedCreateOrderRouteBody
  ): Promise<DeltaResolvedOrderProduct> {
    if (!this.isLiveAutoSubmission(body)) {
      return { productId, product: null };
    }

    const product = await this.getProductById(productId);
    if (product) {
      if (
        String(body.symbol || '').trim() &&
        !this.isDeltaSymbolCompatible(product.symbol, body.symbol)
      ) {
        const symbolResolvedProduct = await this.findLiveAutoProductBySymbol(body.symbol);
        if (symbolResolvedProduct) {
          const resolvedProductId = this.toProductId(
            symbolResolvedProduct.id,
            String(body.symbol || productId)
          );
          this.assertLiveAutoProduct(symbolResolvedProduct, resolvedProductId);
          return {
            productId: resolvedProductId,
            product: symbolResolvedProduct,
          };
        }

        throw new BadRequestAppError(
          `Delta Exchange product mapping is stale for ${String(body.symbol).toUpperCase()}; requested product ${productId} maps to ${String(
            product.symbol || 'unknown'
          ).toUpperCase()}`
        );
      }
      this.assertLiveAutoProduct(product, productId);
      return {
        productId: this.toProductId(product.id ?? productId, String(productId)),
        product,
      };
    }

    const symbolResolvedProduct = await this.findLiveAutoProductBySymbol(body.symbol);
    if (symbolResolvedProduct) {
      const resolvedProductId = this.toProductId(
        symbolResolvedProduct.id,
        String(body.symbol || productId)
      );
      this.assertLiveAutoProduct(symbolResolvedProduct, resolvedProductId);
      return {
        productId: resolvedProductId,
        product: symbolResolvedProduct,
      };
    }

    const symbolHint = String(body.symbol || '').trim().toUpperCase();
    throw new BadRequestAppError(
      `Delta Exchange product mapping is stale for ${
        symbolHint || `product ${productId}`
      }; requested product ${productId} was not found in the live product catalog`
    );
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
    const cache = await this.getProductCache();
    return cache.byId.get(String(productId)) ?? null;
  }

  private async findLiveAutoProductBySymbol(
    symbol: string | undefined
  ): Promise<DeltaProductPayload | null> {
    const normalizedSymbol = this.normalizeDeltaSymbol(symbol);
    if (!normalizedSymbol) {
      return null;
    }

    const normalizedRegionalSymbol = this.normalizeDeltaUsdQuoteSymbol(normalizedSymbol);
    const baseSymbol = this.resolveDeltaBaseSymbol(normalizedSymbol);
    const cache = await this.getProductCache();
    const candidates = cache.products.filter((product) => {
      return this.isDeltaLivePerpetualProduct(product);
    });

    const findBySymbol = (candidateSymbol: string): DeltaProductPayload | null =>
      candidates.find(
        (product) => this.normalizeDeltaSymbol(product.symbol) === candidateSymbol
      ) ?? null;

    return (
      findBySymbol(normalizedSymbol) ??
      findBySymbol(normalizedRegionalSymbol) ??
      (baseSymbol
        ? candidates.find(
            (product) => this.resolveDeltaBaseSymbol(product.symbol) === baseSymbol
          ) ?? null
        : null)
    );
  }

  private async getProductCache(): Promise<DeltaProductCache> {
    const now = Date.now();
    if (!this.productCache || now - this.productCache.fetchedAt > 5 * 60 * 1000) {
      const products = await this.deltaHttpClient.publicGet<DeltaProductPayload[]>('/v2/products');
      const productList = Array.isArray(products) ? products : [];
      const byId = new Map<string, DeltaProductPayload>();
      for (const product of productList) {
        const id = String(product.id ?? '').trim();
        if (id) {
          byId.set(id, product);
        }
      }
      this.productCache = { fetchedAt: now, products: productList, byId };
    }

    return this.productCache;
  }

  private normalizeDeltaSymbol(value: unknown): string {
    return String(value || '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
  }

  private normalizeDeltaUsdQuoteSymbol(symbol: string): string {
    const normalized = this.normalizeDeltaSymbol(symbol);
    for (const quote of ['USDT', 'USDC', 'BUSD', 'FDUSD']) {
      if (normalized.endsWith(quote) && normalized.length > quote.length) {
        return `${normalized.slice(0, -quote.length)}USD`;
      }
    }

    return normalized;
  }

  private isDeltaLivePerpetualProduct(product: DeltaProductPayload | null): boolean {
    if (!product) {
      return false;
    }
    const state = String(product.state || '').trim().toLowerCase();
    const tradingStatus = String(product.trading_status || '').trim().toLowerCase();
    const contractType = String(product.contract_type || '').trim().toLowerCase();
    return (
      state === 'live' &&
      tradingStatus === 'operational' &&
      contractType === 'perpetual_futures'
    );
  }

  private isDeltaSymbolCompatible(productSymbol: unknown, requestedSymbol: unknown): boolean {
    const normalizedProductSymbol = this.normalizeDeltaSymbol(productSymbol);
    const normalizedRequestedSymbol = this.normalizeDeltaSymbol(requestedSymbol);
    return (
      normalizedProductSymbol === normalizedRequestedSymbol ||
      normalizedProductSymbol === this.normalizeDeltaUsdQuoteSymbol(normalizedRequestedSymbol) ||
      this.resolveDeltaBaseSymbol(normalizedProductSymbol) ===
        this.resolveDeltaBaseSymbol(normalizedRequestedSymbol)
    );
  }

  private resolveDeltaBaseSymbol(value: unknown): string {
    const normalized = this.normalizeDeltaSymbol(value);
    for (const quote of ['USDT', 'USDC', 'BUSD', 'FDUSD', 'USD']) {
      if (normalized.endsWith(quote) && normalized.length > quote.length) {
        return normalized.slice(0, -quote.length);
      }
    }

    return normalized;
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
      ...(item.stop_order_type ? { stop_order_type: item.stop_order_type } : {}),
      ...(item.client_order_id ? { client_order_id: item.client_order_id } : {}),
      ...(item.reduce_only === undefined || item.reduce_only === null
        ? {}
        : { reduce_only: this.toBoolean(item.reduce_only) }),
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

  private toBoolean(value: unknown): boolean {
    if (typeof value === 'boolean') {
      return value;
    }
    const normalized = String(value || '')
      .trim()
      .toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes';
  }
}
