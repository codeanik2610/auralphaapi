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

@Service()
export class DeltaExchangePositionsAdapter implements BrokerPositionsAdapter {
  readonly historyWindowMode = 'contiguous' as const;

  @Inject(() => DeltaExchangeHttpClient)
  private deltaHttpClient!: DeltaExchangeHttpClient;

  private productCache:
    | { fetchedAt: number; byId: Map<string, DeltaProduct>; bySymbol: Map<string, DeltaProduct> }
    | null = null;

  private async getProductMaps(): Promise<{
    byId: Map<string, DeltaProduct>;
    bySymbol: Map<string, DeltaProduct>;
  }> {
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
      const symbol = String(item.symbol ?? '').trim().toUpperCase();
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
    const position = await this.findPosition(
      positionId,
      context?.accountId,
      context?.userId
    );
    return position?.liquidation_price ? String(position.liquidation_price) : '0';
  }

  async addMargin(
    _positionId: string,
    _body: AddMarginBody,
    _context?: BrokerPositionContext
  ): Promise<unknown> {
    throw new ServiceUnavailableAppError(
      'Delta Exchange margin updates are not enabled yet'
    );
  }

  async createRiskOrder(
    _positionId: string,
    _body: CreateRiskOrderBody,
    _context?: BrokerPositionContext
  ): Promise<unknown> {
    throw new ServiceUnavailableAppError(
      'Delta Exchange risk orders are not enabled yet'
    );
  }

  async updateRiskOrder(
    _positionId: string,
    _body: UpdateRiskOrderBody,
    _context?: BrokerPositionContext
  ): Promise<unknown> {
    throw new ServiceUnavailableAppError(
      'Delta Exchange risk order updates are not enabled yet'
    );
  }

  async reversePosition(_positionId: string, _context?: BrokerPositionContext): Promise<unknown> {
    throw new ServiceUnavailableAppError(
      'Delta Exchange reverse position is not enabled yet'
    );
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

    const orderType = String(body.order_type || '').toLowerCase() === 'market'
      ? 'market_order'
      : 'limit_order';
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
    const closedPositions = this.reconstructClosedPositionsFromFills(fills);
    const limit = Math.max(1, Math.floor(Number(query.limit || 20)));
    return closedPositions.slice(0, limit);
  }

  async getClosingFills(
    productIds: string[],
    context?: BrokerPositionContext
  ): Promise<Map<string, { closePrice: number; closedAt: string; fillType: string | null }> | undefined> {
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

    const result = new Map<string, { closePrice: number; closedAt: string; fillType: string | null }>();
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
      });
    }
    return result;
  }

  private reconstructClosedPositionsFromFills(fills: DeltaPositionHistoryPayload[]) {
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
      const sorted = [...groupFills].sort((a, b) => toTimestamp(a.created_at) - toTimestamp(b.created_at));
      const state: PositionState = { sizeSigned: 0, avgEntry: 0, openedAt: null };

      for (const fill of sorted) {
        const side = String(fill.side || '').toLowerCase();
        const qty = Math.abs(this.toNumber(fill.size));
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
        const direction = state.sizeSigned > 0 ? 1 : -1;
        const realized = direction * (price - state.avgEntry) * closingQty;
        const afterSizeSigned = state.sizeSigned + delta;
        const fillType = String(fill.fill_type || '').trim().toLowerCase();
        const isLiquidation = fillType === 'liquidation' || fillType === 'liquidate';

        output.push({
          created_at: state.openedAt ?? (fill.created_at ?? ''),
          updated_at: fill.created_at ?? '',
          stoploss: null,
          takeprofit: null,
          entry_price: String(state.avgEntry || 0),
          closed_price: String(price || 0),
          liquidation_price: '0',
          quantity: String(closingQty),
          leverage: '1',
          order_type: direction > 0 ? 'buy' : 'sell',
          side: direction > 0 ? 'Long' : 'Short',
          position_type: direction > 0 ? 'long' : 'short',
          status: isLiquidation ? 'liquidated' : 'closed',
          close_state: afterSizeSigned === 0 ? 'CLOSED' : 'PARTIAL',
          id: String(fill.id ?? fill.order_id ?? fill.product_id ?? ''),
          asset_uuid: String(fill.product_id ?? ''),
          symbol: fill.product_symbol ?? String(fill.product_id ?? ''),
          pnl: realized,
          realized,
          duration: this.calculateDuration(state.openedAt ?? undefined, fill.created_at ?? undefined),
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

    // Most recent first.
    output.sort((a, b) => toTimestamp(String(b.updated_at || '')) - toTimestamp(String(a.updated_at || '')));
    return output;
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

  private mapPosition(
    item: DeltaPositionPayload,
    productMaps: { byId: Map<string, DeltaProduct>; bySymbol: Map<string, DeltaProduct> }
  ) {
    const isLong = this.toNumber(item.size) >= 0;
    const entryPrice = this.toNumber(item.entry_price);
    const markPrice = this.toNumber(item.mark_price) || entryPrice;
    const quantityContracts = Math.abs(this.toNumber(item.size));
    const productId = String(item.product_id ?? '').trim();
    const productSymbol = String(item.product_symbol ?? '').trim().toUpperCase();
    const product =
      (productId && productMaps.byId.get(productId)) ||
      (productSymbol && productMaps.bySymbol.get(productSymbol)) ||
      undefined;
    const contractValue = this.toNumber(product?.contract_value ?? 0);
    const baseQuantity =
      contractValue > 0 ? quantityContracts * contractValue : null;
    const quantity = baseQuantity ?? quantityContracts;
    const direction = isLong ? 1 : -1;
    const unrealizedPnl = direction * (markPrice - entryPrice) * quantity;
    const realizedPnl = this.toNumber(item.realized_pnl);
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
      leverage: String(item.leverage ?? '1'),
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
