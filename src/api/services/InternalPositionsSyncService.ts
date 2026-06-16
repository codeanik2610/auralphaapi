import { Service, Inject } from 'typedi';
import { createHash } from 'node:crypto';
import {
  AssetPriceRepository,
  BrokerAccount,
  BrokerAccountRepository,
  ExchangeAssetUpdateLogRepository,
  PositionReadModelRepository,
} from '../../database';
import { coreDataSource } from '../../database/data-source';
import { ExchangeAssetUpdateLog } from '../../database/entities/ExchangeAssetUpdateLog';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { BrokerAccountRoutingService } from '../../brokers/core/BrokerAccountRoutingService';
import { BrokerRuntimeRegistry } from '../../brokers/core/BrokerRuntimeRegistry';
import { env } from '../../env';
import { PositionsSyncRequest } from '../contracts/InternalSync';
import { OperationalEventService } from './OperationalEventService';
import { SuggestedTradesService } from './SuggestedTradesService';
import {
  POSITIONS_ORDERS_PRODUCT_SYNC_SCOPE,
  POSITIONS_ORDERS_SYSTEM_SYNC_SCOPE,
} from '../utils/positionsOrdersSyncScopeContract';
import { buildPositionReadModelUpsert, PositionReadModelUpsert } from '../utils/positionsReadModel';
import { buildDeltaClosedPositionLifecycleId } from '../../brokers/providers/delta_exchange/deltaPositionLifecycle';

const MAX_LOOKBACK_DAYS = 90;
const DEFAULT_WINDOW_DAYS = 7;
const SYNC_LIMIT = 50000;
const CHUNK_SIZE = 250;
const CHECKPOINT_SCHEDULER_KEY = 'positions-sync';

interface DeltaClosedLifecycleRow {
  id?: string | null;
  externalId: string;
  symbol: string | null;
  status: string | null;
  statusRank: number;
  payloadJson: unknown;
  side?: string | null;
  sideKey?: string | null;
  quantity?: unknown;
  entryPrice?: unknown;
  closedPrice?: unknown;
  positionClosedAt?: unknown;
  lastSeenAt?: unknown;
  updatedAt?: unknown;
}

interface DeltaClosedLifecycleCleanupResult {
  deletedSchedulerRows: number;
  deletedReadModelRows: number;
  symbols: string[];
}

interface MudrexClosedPositionAggregationCandidate {
  item: Record<string, unknown>;
  symbol: string;
  side: 'LONG' | 'SHORT';
  assetUuid: string | null;
  createdAtMs: number;
  directFuturePositionUuid: string | null;
}

interface MudrexOrderSnapshotAggregationRow {
  externalId?: string | null;
  symbol?: string | null;
  orderStatus?: string | null;
  payloadJson?: unknown;
  firstSeenAt?: Date | string | null;
  lastSeenAt?: Date | string | null;
}

interface MudrexOrderAggregationRecord {
  externalId: string | null;
  symbol: string;
  futurePositionUuid: string;
  orderType: string;
  side: 'LONG' | 'SHORT' | null;
  status: string | null;
  quantity: number;
  price: number;
  notional: number;
  createdAtMs: number | null;
  updatedAtMs: number | null;
  assetUuid: string | null;
  isProtectionExit: boolean;
}

interface MudrexClosedPositionOrderAggregate {
  futurePositionUuid: string;
  entryQuantity: number;
  closedQuantity: number;
  entryPrice: number;
  closedPrice: number;
  realizedPnl: number;
  entryOrderCount: number;
  closeOrderCount: number;
  closedAtIso: string | null;
}

@Service()
export class InternalPositionsSyncService {
  @Inject(() => BrokerRuntimeRegistry)
  private brokerRuntimeRegistry!: BrokerRuntimeRegistry;

  @Inject(() => BrokerAccountRoutingService)
  private brokerAccountRoutingService!: BrokerAccountRoutingService;

  @Inject(() => BrokerAccountRepository)
  private brokerAccountRepository!: BrokerAccountRepository;

  @Inject(() => ExchangeAssetUpdateLogRepository)
  private exchangeAssetUpdateLogRepository!: ExchangeAssetUpdateLogRepository;

  @Inject(() => PositionReadModelRepository)
  private positionReadModelRepository!: PositionReadModelRepository;

  @Inject(() => AssetPriceRepository)
  private assetPriceRepository!: AssetPriceRepository;

  @Inject(() => OperationalEventService)
  private operationalEventService!: OperationalEventService;

  @Inject(() => SuggestedTradesService)
  private suggestedTradesService!: SuggestedTradesService;

  private checkpointTableColumns: {
    hasId: boolean;
    hasCreatedAt: boolean;
    hasUpdatedAt: boolean;
  } | null = null;

  // ── Helpers ──────────────────────────────────────────────────

  private toFiniteNumber(value: unknown): number {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
  }

  private parsePayloadJson(value: unknown): Record<string, unknown> | null {
    let obj: unknown;
    if (typeof value === 'string') {
      try {
        obj = JSON.parse(value);
      } catch {
        return null;
      }
    } else {
      obj = value;
    }
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      return obj as Record<string, unknown>;
    }
    return null;
  }

  private extractList(raw: unknown): unknown[] {
    if (Array.isArray(raw)) {
      return raw;
    }
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const data = (raw as { data?: unknown }).data;
      if (Array.isArray(data)) {
        return data;
      }
    }
    return [];
  }

  private parseIsoDate(value: string): Date | null {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateOnly.test(raw)) return null;
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  private formatIsoDate(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private addDays(date: Date, days: number): Date {
    return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
  }

  private resolveHistoryOverlapDays(
    adapter: { historyOverlapDays?: number } | null | undefined
  ): number {
    const raw = Number(adapter?.historyOverlapDays);
    if (!Number.isFinite(raw)) {
      return 1;
    }
    return Math.min(MAX_LOOKBACK_DAYS, Math.max(1, Math.floor(raw)));
  }

  private buildDateWindows(
    startDate: string,
    endDate: string,
    windowDays: number
  ): Array<{ startDate: string; endDate: string }> {
    const start = this.parseIsoDate(startDate);
    const end = this.parseIsoDate(endDate);
    if (!start || !end) return [{ startDate, endDate }];
    const safeWindowDays = Math.min(
      30,
      Math.max(1, Math.floor(Number(windowDays || DEFAULT_WINDOW_DAYS)))
    );
    const windows: Array<{ startDate: string; endDate: string }> = [];
    let cursor = start;
    while (cursor.getTime() <= end.getTime()) {
      const windowEnd = this.addDays(cursor, safeWindowDays - 1);
      const cappedEnd = windowEnd.getTime() > end.getTime() ? end : windowEnd;
      windows.push({
        startDate: this.formatIsoDate(cursor),
        endDate: this.formatIsoDate(cappedEnd),
      });
      cursor = this.addDays(cappedEnd, 1);
    }
    return windows.length ? windows : [{ startDate, endDate }];
  }

  private readAffectedRows(result: unknown): number {
    const header =
      Array.isArray(result) && result.length > 0 && typeof result[0] === 'object'
        ? (result[0] as { affectedRows?: number })
        : (result as { affectedRows?: number });
    const value = Number(header?.affectedRows || 0);
    return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  }

  private normalizeMarketSymbol(value: unknown): string | null {
    const raw = String(value || '')
      .trim()
      .toUpperCase();
    if (!raw) return null;
    if (raw.endsWith('USDT')) return raw;
    if (raw.endsWith('USD')) return `${raw.slice(0, -3)}USDT`;
    if (/^[A-Z0-9]{2,20}$/.test(raw)) return `${raw}USDT`;
    return raw;
  }

  private toPositiveFiniteNumber(value: unknown): number | null {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
  }

  private readPositiveLeverageValue(item: Record<string, unknown>): number | null {
    for (const candidate of [
      item.leverage,
      item.position_leverage,
      item.observed_position_leverage,
      item.leverageValue,
      item.confirmed_leverage,
    ]) {
      const numeric = this.toPositiveFiniteNumber(candidate);
      if (numeric !== null) {
        return numeric;
      }
    }
    return null;
  }

  private readObservedPositionLeverageValue(item: Record<string, unknown>): number | null {
    const leverageSource = String(item.leverage_source ?? '')
      .trim()
      .toLowerCase();
    if (leverageSource === 'derived_position_margin') {
      return null;
    }
    for (const candidate of [
      item.observed_position_leverage,
      item.leverage,
      item.position_leverage,
    ]) {
      const numeric = this.toPositiveFiniteNumber(candidate);
      if (numeric !== null) {
        return numeric;
      }
    }
    return null;
  }

  private readDerivedPositionLeverageValue(item: Record<string, unknown>): number | null {
    const leverageSource = String(item.leverage_source ?? '')
      .trim()
      .toLowerCase();
    if (
      leverageSource !== 'derived_position_margin' &&
      item.derived_position_leverage === undefined
    ) {
      return null;
    }
    for (const candidate of [
      item.derived_position_leverage,
      item.leverage,
      item.position_leverage,
    ]) {
      const numeric = this.toPositiveFiniteNumber(candidate);
      if (numeric !== null) {
        return numeric;
      }
    }
    return null;
  }

  private resolvePositionAssetId(item: Record<string, unknown>): string | null {
    for (const candidate of [item.id, item.asset_uuid, item.product_id]) {
      const value = String(candidate || '').trim();
      if (value) {
        return value;
      }
    }
    return null;
  }

  private resolvePositionDirection(position: Record<string, unknown>): number {
    const side = String(position.side ?? '')
      .trim()
      .toLowerCase();
    const positionType = String(position.position_type ?? '')
      .trim()
      .toLowerCase();
    const orderType = String(position.order_type ?? '')
      .trim()
      .toLowerCase();

    if (side === 'short' || positionType === 'short' || orderType === 'sell') return -1;
    if (side === 'long' || positionType === 'long' || orderType === 'buy') return 1;

    const size = Number(position.size ?? 0);
    if (Number.isFinite(size) && size < 0) return -1;
    return 1;
  }

  private computeUnrealizedPnl(
    position: Record<string, unknown>,
    markPrice: number
  ): number | null {
    const entry = Number(
      position.entry_price ?? position.avg_entry_price ?? position.average_entry_price ?? 0
    );
    const qty = Math.abs(Number(position.quantity ?? position.size ?? 0));
    if (!Number.isFinite(entry) || !Number.isFinite(qty) || qty <= 0) {
      return null;
    }
    if (!Number.isFinite(markPrice) || markPrice <= 0) {
      return null;
    }
    const direction = this.resolvePositionDirection(position);
    return direction * (markPrice - entry) * qty;
  }

  private async enrichOpenPositionsWithMarketPnl(items: unknown[]): Promise<void> {
    const records = items
      .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
      .map((item) => item as Record<string, unknown>);

    if (!records.length) return;

    const symbols = new Set<string>();
    for (const record of records) {
      const symbol = this.normalizeMarketSymbol(record.symbol ?? record.product_symbol);
      if (symbol) symbols.add(symbol);
    }

    if (!symbols.size) return;

    let rows: Array<{
      symbol?: string;
      price?: unknown;
      retrievedAt?: Date | string;
      source?: string;
    }> = [];
    try {
      rows = (await this.assetPriceRepository.getBySymbols(Array.from(symbols), {
        sources: ['mudrex'],
      })) as Array<{
        symbol?: string;
        price?: unknown;
        retrievedAt?: Date | string;
        source?: string;
      }>;
    } catch {
      return;
    }

    const priceMap = new Map<string, { price: number; retrievedAt?: string; source?: string }>();
    for (const row of rows) {
      const symbol = String(row.symbol || '')
        .trim()
        .toUpperCase();
      const price = Number(row.price);
      if (!symbol || !Number.isFinite(price)) continue;
      const retrievedAt =
        row.retrievedAt instanceof Date
          ? row.retrievedAt
          : row.retrievedAt
            ? new Date(String(row.retrievedAt))
            : null;
      priceMap.set(symbol, {
        price,
        retrievedAt:
          retrievedAt && !Number.isNaN(retrievedAt.getTime())
            ? retrievedAt.toISOString()
            : undefined,
        source: row.source || 'binance',
      });
    }

    for (const record of records) {
      const symbol = this.normalizeMarketSymbol(record.symbol ?? record.product_symbol);
      if (!symbol) continue;
      const market = priceMap.get(symbol);
      if (!market) continue;

      record.mark_price ??= String(market.price);
      record.current_price ??= String(market.price);
      record.market_price_source ??= market.source;
      if (market.retrievedAt) {
        record.market_price_retrieved_at ??= market.retrievedAt;
      }
      const pnl = this.computeUnrealizedPnl(record, market.price);
      if (pnl !== null) {
        record.unrealized_pnl = pnl;
      }
    }
  }

  private async enrichDeltaOpenPositionLeverageFromConfirmedOrders(
    userId: string,
    accountId: string,
    brokerKey: string,
    items: unknown[]
  ): Promise<void> {
    const normalizedBrokerKey = String(brokerKey || '')
      .trim()
      .toLowerCase();
    if (normalizedBrokerKey !== 'delta_exchange') {
      return;
    }

    const openRecords = items
      .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
      .map((item) => item as Record<string, unknown>)
      .filter((item) => {
        const status = this.normalizePositionStatus(String(item.status || '').trim() || null);
        return status === 'OPEN' && this.readPositiveLeverageValue(item) === null;
      });

    if (!openRecords.length) {
      return;
    }

    const assetIds = Array.from(
      new Set(
        openRecords
          .map((item) => this.resolvePositionAssetId(item))
          .filter((value): value is string => Boolean(value))
      )
    );

    if (!assetIds.length) {
      return;
    }

    const leverageByAssetId = await this.listLatestDeltaSubmissionLeverageContextByAssetId(
      userId,
      accountId,
      normalizedBrokerKey,
      assetIds
    );

    for (const item of openRecords) {
      const assetId = this.resolvePositionAssetId(item);
      const leverageContext = assetId ? leverageByAssetId.get(assetId) : null;
      const observedLeverage = this.readObservedPositionLeverageValue(item);
      const derivedPositionLeverage = this.readDerivedPositionLeverageValue(item);
      const requestedLeverage = leverageContext?.requestedLeverage ?? null;
      const confirmedOrderLeverage = leverageContext?.confirmedOrderLeverage ?? null;
      const resolvedLeverage =
        observedLeverage ??
        derivedPositionLeverage ??
        confirmedOrderLeverage ??
        requestedLeverage ??
        null;

      if (requestedLeverage !== null) {
        item.requested_leverage = String(requestedLeverage);
      }
      if (confirmedOrderLeverage !== null) {
        item.confirmed_order_leverage = String(confirmedOrderLeverage);
      }
      if (observedLeverage !== null) {
        item.observed_position_leverage = String(observedLeverage);
      }
      if (derivedPositionLeverage !== null) {
        item.derived_position_leverage = String(derivedPositionLeverage);
      }

      if (resolvedLeverage === null) {
        continue;
      }
      item.leverage = String(resolvedLeverage);
      item.position_leverage = String(resolvedLeverage);
      item.leverage_source =
        observedLeverage !== null
          ? 'broker_position'
          : derivedPositionLeverage !== null
            ? 'derived_position_margin'
            : confirmedOrderLeverage !== null
              ? 'confirmed_order_submission'
              : 'requested_order_submission';
    }
  }

  private async enrichMudrexClosedPositionsFromOrderSnapshots(
    userId: string,
    accountId: string,
    brokerKey: string,
    items: unknown[]
  ): Promise<void> {
    const normalizedBrokerKey = String(brokerKey || '')
      .trim()
      .toLowerCase();
    if (normalizedBrokerKey !== 'mudrex') {
      return;
    }

    const candidates = items
      .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
      .map((item) =>
        this.buildMudrexClosedPositionAggregationCandidate(item as Record<string, unknown>)
      )
      .filter(
        (candidate): candidate is MudrexClosedPositionAggregationCandidate => candidate !== null
      );
    if (!candidates.length) {
      return;
    }

    const symbols = Array.from(new Set(candidates.map((candidate) => candidate.symbol)));
    const earliestCreatedAt = Math.min(...candidates.map((candidate) => candidate.createdAtMs));
    const earliestOrderSeenAt = new Date(earliestCreatedAt - 24 * 60 * 60 * 1000);
    const rows = await this.listMudrexOrderSnapshotRowsForAggregation(
      userId,
      accountId,
      normalizedBrokerKey,
      symbols,
      earliestOrderSeenAt
    );
    if (!rows.length) {
      return;
    }

    const orders = rows
      .map((row) => this.buildMudrexOrderAggregationRecord(row))
      .filter((order): order is MudrexOrderAggregationRecord => order !== null);
    if (!orders.length) {
      return;
    }

    const ordersByFuturePositionUuid = new Map<string, MudrexOrderAggregationRecord[]>();
    for (const order of orders) {
      const list = ordersByFuturePositionUuid.get(order.futurePositionUuid) || [];
      list.push(order);
      ordersByFuturePositionUuid.set(order.futurePositionUuid, list);
    }

    for (const candidate of candidates) {
      const futurePositionUuid =
        candidate.directFuturePositionUuid &&
        ordersByFuturePositionUuid.has(candidate.directFuturePositionUuid)
          ? candidate.directFuturePositionUuid
          : this.resolveMudrexFuturePositionUuidForCandidate(candidate, orders);
      if (!futurePositionUuid) {
        continue;
      }

      const aggregate = this.buildMudrexClosedPositionOrderAggregate(
        futurePositionUuid,
        candidate,
        ordersByFuturePositionUuid.get(futurePositionUuid) || []
      );
      if (!aggregate) {
        continue;
      }

      this.applyMudrexClosedPositionOrderAggregate(candidate.item, aggregate);
    }
  }

  private buildMudrexClosedPositionAggregationCandidate(
    item: Record<string, unknown>
  ): MudrexClosedPositionAggregationCandidate | null {
    const status = this.normalizePositionStatus(String(item.status || '').trim() || null);
    if (status !== 'CLOSED' && status !== 'LIQUIDATED') {
      return null;
    }
    if (this.hasMudrexBrokerTerminalLifecycleEvent(item)) {
      return null;
    }

    const side = this.normalizeMudrexDirectionalSide(
      item.position_type ?? item.order_type ?? item.side
    );
    if (!side) {
      return null;
    }

    const symbol = this.normalizeMarketSymbol(item.symbol ?? item.product_symbol);
    const createdAtMs = this.readTimestampMs(item.created_at ?? item.createdAt);
    if (!symbol || createdAtMs === null) {
      return null;
    }

    const assetUuid =
      String(item.asset_uuid || item.assetUuid || item.asset_id || item.assetId || '').trim() ||
      null;
    const directFuturePositionUuid =
      String(item.future_position_uuid || item.futurePositionUuid || '').trim() || null;

    return {
      item,
      symbol,
      side,
      assetUuid,
      createdAtMs,
      directFuturePositionUuid,
    };
  }

  private hasMudrexBrokerTerminalLifecycleEvent(item: Record<string, unknown>): boolean {
    const rawEventId = String(
      item.id ?? item.position_id ?? item.positionId ?? item.future_position_uuid ?? ''
    ).trim();
    if (!rawEventId) {
      return false;
    }
    const closedAtMs = this.readTimestampMs(
      item.closed_at ?? item.closedAt ?? item.updated_at ?? item.updatedAt
    );
    const quantity =
      this.toPositiveFiniteNumber(item.quantity) ?? this.toPositiveFiniteNumber(item.size);
    const closedPrice =
      this.toPositiveFiniteNumber(item.closed_price) ??
      this.toPositiveFiniteNumber(item.closedPrice);
    const realizedPnl = Number(item.pnl ?? item.realized ?? item.realized_pnl);
    return (
      closedAtMs !== null &&
      quantity !== null &&
      closedPrice !== null &&
      Number.isFinite(realizedPnl)
    );
  }

  private async listMudrexOrderSnapshotRowsForAggregation(
    userId: string,
    accountId: string,
    brokerKey: string,
    symbols: string[],
    earliestOrderSeenAt: Date
  ): Promise<MudrexOrderSnapshotAggregationRow[]> {
    const normalizedSymbols = Array.from(
      new Set(
        symbols
          .map((symbol) =>
            String(symbol || '')
              .trim()
              .toUpperCase()
          )
          .filter(Boolean)
      )
    );
    if (!normalizedSymbols.length) {
      return [];
    }

    const earliestIso = earliestOrderSeenAt.toISOString();
    const rows = (await coreDataSource.query(
      `SELECT external_id AS externalId,
              symbol,
              order_status AS orderStatus,
              payload_json AS payloadJson,
              first_seen_at AS firstSeenAt,
              last_seen_at AS lastSeenAt
         FROM scheduler_orders_snapshots
        WHERE user_id = ?
          AND account_id = ?
          AND LOWER(broker_key) = ?
          AND UPPER(symbol) IN (${normalizedSymbols.map(() => '?').join(', ')})
          AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.future_position_uuid')), '') IS NOT NULL
          AND (
            NULLIF(JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.created_at')), '') >= ?
            OR NULLIF(JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.updated_at')), '') >= ?
            OR last_seen_at >= ?
          )`,
      [
        userId,
        accountId,
        brokerKey,
        ...normalizedSymbols,
        earliestIso,
        earliestIso,
        earliestOrderSeenAt,
      ]
    )) as MudrexOrderSnapshotAggregationRow[];
    return rows;
  }

  private buildMudrexOrderAggregationRecord(
    row: MudrexOrderSnapshotAggregationRow
  ): MudrexOrderAggregationRecord | null {
    const payload = this.parsePayloadJson(row.payloadJson);
    if (!payload) {
      return null;
    }

    const futurePositionUuid = String(
      payload.future_position_uuid || payload.futurePositionUuid || ''
    ).trim();
    if (!futurePositionUuid) {
      return null;
    }

    const status = this.normalizeMudrexOrderStatus(payload.status ?? row.orderStatus);
    if (!this.isMudrexFilledOrderStatus(status)) {
      return null;
    }

    const quantity =
      this.toPositiveFiniteNumber(payload.filled_quantity) ??
      this.toPositiveFiniteNumber(payload.filledQuantity) ??
      this.toPositiveFiniteNumber(payload.executed_quantity) ??
      this.toPositiveFiniteNumber(payload.executedQuantity) ??
      this.toPositiveFiniteNumber(payload.quantity) ??
      this.toPositiveFiniteNumber(payload.qty) ??
      null;
    if (quantity === null) {
      return null;
    }

    const explicitPrice =
      this.toPositiveFiniteNumber(payload.filled_price) ??
      this.toPositiveFiniteNumber(payload.filledPrice) ??
      this.toPositiveFiniteNumber(payload.average_fill_price) ??
      this.toPositiveFiniteNumber(payload.averageFillPrice) ??
      this.toPositiveFiniteNumber(payload.price) ??
      this.toPositiveFiniteNumber(payload.order_price) ??
      null;
    const actualAmount =
      this.toPositiveFiniteNumber(payload.actual_amount) ??
      this.toPositiveFiniteNumber(payload.actualAmount) ??
      null;
    const price = explicitPrice ?? (actualAmount !== null ? actualAmount / quantity : null);
    if (price === null || !Number.isFinite(price) || price <= 0) {
      return null;
    }

    const orderType = String(payload.order_type ?? payload.orderType ?? payload.side ?? '')
      .trim()
      .toUpperCase();
    const side = this.normalizeMudrexDirectionalSide(orderType);
    const isProtectionExit = this.isMudrexProtectionExitOrderType(orderType);
    const symbol = this.normalizeMarketSymbol(payload.symbol ?? row.symbol);
    if (!symbol) {
      return null;
    }

    const notional = actualAmount !== null ? actualAmount : quantity * price;
    const createdAtMs = this.readTimestampMs(
      payload.created_at ?? payload.createdAt ?? row.firstSeenAt
    );
    const updatedAtMs = this.readTimestampMs(
      payload.filled_at ??
        payload.filledAt ??
        payload.updated_at ??
        payload.updatedAt ??
        payload.created_at ??
        payload.createdAt ??
        row.lastSeenAt
    );
    const assetUuid =
      String(
        payload.asset_uuid || payload.assetUuid || payload.asset_id || payload.assetId || ''
      ).trim() || null;

    return {
      externalId: String(row.externalId || payload.id || '').trim() || null,
      symbol,
      futurePositionUuid,
      orderType,
      side,
      status,
      quantity,
      price,
      notional,
      createdAtMs,
      updatedAtMs,
      assetUuid,
      isProtectionExit,
    };
  }

  private resolveMudrexFuturePositionUuidForCandidate(
    candidate: MudrexClosedPositionAggregationCandidate,
    orders: MudrexOrderAggregationRecord[]
  ): string | null {
    const matchingEntries = orders
      .filter((order) => {
        if (order.symbol !== candidate.symbol) {
          return false;
        }
        if (order.side !== candidate.side || order.isProtectionExit) {
          return false;
        }
        if (candidate.assetUuid && order.assetUuid && candidate.assetUuid !== order.assetUuid) {
          return false;
        }
        if (order.createdAtMs === null) {
          return false;
        }
        return Math.abs(order.createdAtMs - candidate.createdAtMs) <= 2 * 60 * 1000;
      })
      .sort((left, right) => {
        const leftDistance = Math.abs((left.createdAtMs || 0) - candidate.createdAtMs);
        const rightDistance = Math.abs((right.createdAtMs || 0) - candidate.createdAtMs);
        return leftDistance - rightDistance;
      });

    return matchingEntries[0]?.futurePositionUuid || null;
  }

  private buildMudrexClosedPositionOrderAggregate(
    futurePositionUuid: string,
    candidate: MudrexClosedPositionAggregationCandidate,
    orders: MudrexOrderAggregationRecord[]
  ): MudrexClosedPositionOrderAggregate | null {
    const entryOrders = orders.filter(
      (order) => order.side === candidate.side && !order.isProtectionExit
    );
    const closeOrders = orders.filter((order) =>
      this.isMudrexCloseOrderForPositionSide(order, candidate.side)
    );
    if (!entryOrders.length || !closeOrders.length) {
      return null;
    }

    const entryQuantity = entryOrders.reduce((total, order) => total + order.quantity, 0);
    const closedQuantity = closeOrders.reduce((total, order) => total + order.quantity, 0);
    if (entryQuantity <= 0 || closedQuantity <= 0) {
      return null;
    }

    const quantityTolerance = Math.max(1e-9, entryQuantity * 1e-8);
    if (closedQuantity + quantityTolerance < entryQuantity) {
      return null;
    }

    const entryNotional = entryOrders.reduce((total, order) => total + order.notional, 0);
    const closedNotional = closeOrders.reduce((total, order) => total + order.notional, 0);
    const entryPrice = entryNotional / entryQuantity;
    const closedPrice = closedNotional / closedQuantity;
    if (
      !Number.isFinite(entryPrice) ||
      !Number.isFinite(closedPrice) ||
      entryPrice <= 0 ||
      closedPrice <= 0
    ) {
      return null;
    }

    const direction = candidate.side === 'SHORT' ? -1 : 1;
    const realizedPnl = closeOrders.reduce(
      (total, order) => total + direction * (order.price - entryPrice) * order.quantity,
      0
    );
    const closedAtMs = Math.max(
      ...closeOrders
        .map((order) => order.updatedAtMs ?? order.createdAtMs ?? 0)
        .filter((value) => Number.isFinite(value) && value > 0)
    );

    return {
      futurePositionUuid,
      entryQuantity,
      closedQuantity,
      entryPrice,
      closedPrice,
      realizedPnl,
      entryOrderCount: entryOrders.length,
      closeOrderCount: closeOrders.length,
      closedAtIso:
        Number.isFinite(closedAtMs) && closedAtMs > 0 ? new Date(closedAtMs).toISOString() : null,
    };
  }

  private applyMudrexClosedPositionOrderAggregate(
    item: Record<string, unknown>,
    aggregate: MudrexClosedPositionOrderAggregate
  ): void {
    const entryQuantity = this.formatMudrexAggregateNumber(aggregate.entryQuantity);
    const closedQuantity = this.formatMudrexAggregateNumber(aggregate.closedQuantity);
    const entryPrice = this.formatMudrexAggregateNumber(aggregate.entryPrice);
    const closedPrice = this.formatMudrexAggregateNumber(aggregate.closedPrice);
    const realizedPnl = this.formatMudrexAggregateNumber(aggregate.realizedPnl);

    item.status = 'CLOSED';
    item.quantity = entryQuantity;
    item.entry_price = entryPrice;
    item.closed_price = closedPrice;
    item.pnl = realizedPnl;
    item.realized = realizedPnl;
    item.realized_pnl = realizedPnl;
    item.aggregate_source = 'scheduler_orders_snapshots';
    item.aggregate_future_position_uuid = aggregate.futurePositionUuid;
    item.aggregate_entry_quantity = entryQuantity;
    item.aggregate_closed_quantity = closedQuantity;
    item.aggregate_entry_order_count = aggregate.entryOrderCount;
    item.aggregate_close_order_count = aggregate.closeOrderCount;
    if (aggregate.closedAtIso) {
      item.closed_at = aggregate.closedAtIso;
      item.updated_at = aggregate.closedAtIso;
    }
  }

  private isMudrexCloseOrderForPositionSide(
    order: MudrexOrderAggregationRecord,
    positionSide: 'LONG' | 'SHORT'
  ): boolean {
    if (order.isProtectionExit) {
      return true;
    }
    if (positionSide === 'LONG') {
      return order.side === 'SHORT';
    }
    return order.side === 'LONG';
  }

  private normalizeMudrexDirectionalSide(value: unknown): 'LONG' | 'SHORT' | null {
    const raw = String(value ?? '')
      .trim()
      .toUpperCase();
    if (raw === 'LONG' || raw === 'BUY') {
      return 'LONG';
    }
    if (raw === 'SHORT' || raw === 'SELL') {
      return 'SHORT';
    }
    return null;
  }

  private normalizeMudrexOrderStatus(value: unknown): string | null {
    const raw = String(value ?? '')
      .trim()
      .toUpperCase()
      .replace(/[\s-]+/g, '_');
    return raw || null;
  }

  private isMudrexFilledOrderStatus(status: string | null): boolean {
    return ['FILLED', 'CLOSED', 'COMPLETED'].includes(String(status || '').toUpperCase());
  }

  private isMudrexProtectionExitOrderType(orderType: string): boolean {
    return ['STOPLOSS', 'STOP_LOSS', 'TAKEPROFIT', 'TAKE_PROFIT'].includes(
      String(orderType || '')
        .trim()
        .toUpperCase()
    );
  }

  private readTimestampMs(value: unknown): number | null {
    if (!value) {
      return null;
    }
    const date = value instanceof Date ? value : new Date(String(value));
    const timestamp = date.getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  private formatMudrexAggregateNumber(value: number): string {
    if (!Number.isFinite(value)) {
      return '0';
    }
    return value.toFixed(12).replace(/\.?0+$/, '');
  }

  private async listLatestDeltaSubmissionLeverageContextByAssetId(
    userId: string,
    accountId: string,
    brokerKey: string,
    assetIds: string[]
  ): Promise<
    Map<
      string,
      {
        requestedLeverage: number | null;
        confirmedOrderLeverage: number | null;
      }
    >
  > {
    const rows = (await coreDataSource.query(
      `SELECT asset_id AS assetId,
              NULLIF(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(response_json, '$.leverage')), 'null'), '') AS responseLeverage,
              NULLIF(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(response_json, '$.data.leverage')), 'null'), '') AS responseLeverageNested,
              NULLIF(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(request_json, '$.leverage')), 'null'), '') AS requestLeverage,
              NULLIF(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(request_json, '$.order.leverage')), 'null'), '') AS requestLeverageNested
         FROM order_submission_requests
        WHERE user_id = ?
          AND account_id = ?
          AND LOWER(COALESCE(broker_key, '')) = ?
          AND asset_id IN (${assetIds.map(() => '?').join(', ')})
          AND status = 'completed'
          AND placement_state IN ('placed', 'replayed')
          AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        ORDER BY created_at DESC`,
      [userId, accountId, brokerKey, ...assetIds, MAX_LOOKBACK_DAYS]
    )) as Array<{
      assetId?: string | null;
      responseLeverage?: string | null;
      responseLeverageNested?: string | null;
      requestLeverage?: string | null;
      requestLeverageNested?: string | null;
    }>;

    const leverageByAssetId = new Map<
      string,
      {
        requestedLeverage: number | null;
        confirmedOrderLeverage: number | null;
      }
    >();
    for (const row of rows) {
      const assetId = String(row.assetId || '').trim();
      if (!assetId || leverageByAssetId.has(assetId)) {
        continue;
      }
      const confirmedOrderLeverage =
        this.toPositiveFiniteNumber(row.responseLeverage) ??
        this.toPositiveFiniteNumber(row.responseLeverageNested) ??
        null;
      const requestedLeverage =
        this.toPositiveFiniteNumber(row.requestLeverage) ??
        this.toPositiveFiniteNumber(row.requestLeverageNested) ??
        null;
      if (confirmedOrderLeverage === null && requestedLeverage === null) {
        continue;
      }
      leverageByAssetId.set(assetId, {
        requestedLeverage,
        confirmedOrderLeverage,
      });
    }
    return leverageByAssetId;
  }

  // ── Status helpers ───────────────────────────────────────────

  private computePositionStatusRank(status: string): number {
    const normalized = String(status || '')
      .trim()
      .toUpperCase();
    if (['OPEN'].includes(normalized)) return 1;
    if (['PARTIAL', 'PARTIALLY_CLOSED'].includes(normalized)) return 2;
    if (['CLOSED'].includes(normalized)) return 3;
    if (['LIQUIDATED'].includes(normalized)) return 4;
    return 0;
  }

  private normalizePositionStatus(status: string | null): string | null {
    const raw = String(status || '').trim();
    if (!raw) return null;
    const normalized = raw.toUpperCase();

    if (['OPEN'].includes(normalized)) return 'OPEN';
    if (['CLOSED', 'CLOSE'].includes(normalized)) return 'CLOSED';
    if (['LIQUIDATED', 'LIQUIDATION'].includes(normalized)) return 'LIQUIDATED';
    if (['PARTIAL', 'PARTIALLY_CLOSED', 'PARTIALLY_CLOSED_POSITION'].includes(normalized))
      return 'PARTIAL';

    return normalized;
  }

  private buildPositionSyntheticId(position: Record<string, unknown>): string {
    const symbol = String(position.symbol || '')
      .trim()
      .toUpperCase();
    const status = String(position.status || '')
      .trim()
      .toUpperCase();
    const createdAt = String(position.created_at || '').trim();
    return [symbol || 'NA', status || 'NA', createdAt || 'NA'].join(':');
  }

  // ── Checkpoint management ────────────────────────────────────

  private async ensureCheckpointTable(): Promise<void> {
    await coreDataSource.query(`
      CREATE TABLE IF NOT EXISTS scheduler_sync_checkpoints (
        id char(36) NOT NULL,
        scheduler_key varchar(100) NOT NULL,
        account_id char(36) NOT NULL,
        checkpoint_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uidx_sync_checkpoint (scheduler_key, account_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    `);

    this.checkpointTableColumns = null;
    const shape = await this.getCheckpointTableColumns();
    if (!shape.hasUpdatedAt) {
      await coreDataSource.query(
        `ALTER TABLE scheduler_sync_checkpoints
         ADD COLUMN updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
         ON UPDATE CURRENT_TIMESTAMP`
      );
      this.checkpointTableColumns = {
        ...shape,
        hasUpdatedAt: true,
      };
    }
  }

  private async getCheckpoint(accountId: string): Promise<Date | null> {
    const rows = (await coreDataSource.query(
      `SELECT checkpoint_at FROM scheduler_sync_checkpoints
       WHERE scheduler_key = ? AND account_id = ?
       LIMIT 1`,
      [CHECKPOINT_SCHEDULER_KEY, accountId]
    )) as Array<{ checkpoint_at: Date | string }>;
    if (!rows || rows.length === 0) return null;
    const val = rows[0].checkpoint_at;
    const d = val instanceof Date ? val : new Date(String(val));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  private async saveCheckpoint(accountId: string, checkpointAt: Date): Promise<void> {
    const shape = await this.getCheckpointTableColumns();
    if (shape.hasId && shape.hasCreatedAt) {
      await coreDataSource.query(
        `INSERT INTO scheduler_sync_checkpoints (id, scheduler_key, account_id, checkpoint_at, created_at, updated_at)
         VALUES (UUID(), ?, ?, ?, NOW(), NOW())
         ON DUPLICATE KEY UPDATE checkpoint_at = VALUES(checkpoint_at), updated_at = NOW()`,
        [CHECKPOINT_SCHEDULER_KEY, accountId, checkpointAt]
      );
      return;
    }

    if (shape.hasUpdatedAt) {
      await coreDataSource.query(
        `INSERT INTO scheduler_sync_checkpoints (scheduler_key, account_id, checkpoint_at, updated_at)
         VALUES (?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE checkpoint_at = VALUES(checkpoint_at), updated_at = NOW()`,
        [CHECKPOINT_SCHEDULER_KEY, accountId, checkpointAt]
      );
      return;
    }

    await coreDataSource.query(
      `INSERT INTO scheduler_sync_checkpoints (scheduler_key, account_id, checkpoint_at)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE checkpoint_at = VALUES(checkpoint_at)`,
      [CHECKPOINT_SCHEDULER_KEY, accountId, checkpointAt]
    );
  }

  private async getCheckpointTableColumns(): Promise<{
    hasId: boolean;
    hasCreatedAt: boolean;
    hasUpdatedAt: boolean;
  }> {
    if (this.checkpointTableColumns) {
      return this.checkpointTableColumns;
    }

    const rows = (await coreDataSource.query(
      `SELECT column_name AS columnName
         FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND table_name = 'scheduler_sync_checkpoints'`
    )) as Array<{ columnName?: string }>;

    const columnNames = new Set(
      rows
        .map((row) =>
          String(row.columnName || '')
            .trim()
            .toLowerCase()
        )
        .filter(Boolean)
    );

    this.checkpointTableColumns = {
      hasId: columnNames.has('id'),
      hasCreatedAt: columnNames.has('created_at'),
      hasUpdatedAt: columnNames.has('updated_at'),
    };

    return this.checkpointTableColumns;
  }

  // ── Deduplication ────────────────────────────────────────────

  private deduplicateByExternalId(items: unknown[], brokerKey: string): unknown[] {
    const map = new Map<string, { item: unknown; rank: number }>();
    const brokerKeyLower = String(brokerKey || '')
      .trim()
      .toLowerCase();
    for (const item of items) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const rec = item as Record<string, unknown>;
      const mudrexExternalId =
        brokerKeyLower === 'mudrex'
          ? this.buildMudrexPositionExternalId(brokerKeyLower, rec)
          : null;
      const id =
        mudrexExternalId || String(rec.id || '').trim() || this.buildPositionSyntheticId(rec);
      if (!id) continue;
      const status = this.normalizePositionStatus(String(rec.status || '').trim() || null);
      const rank = this.computePositionStatusRank(status || '');
      const existing = map.get(id);
      if (!existing || rank >= existing.rank) {
        map.set(id, { item, rank });
      }
    }
    return Array.from(map.values()).map((e) => e.item);
  }

  // ── Row building ─────────────────────────────────────────────

  private buildPositionRow(
    userId: string,
    accountId: string,
    brokerKey: string,
    item: Record<string, unknown>
  ): {
    userId: string;
    accountId: string;
    brokerKey: string;
    externalId: string;
    legacyExternalId?: string | null;
    symbol: string | null;
    status: string | null;
    statusRank: number;
    payloadJson: string;
    payloadHash: string;
  } | null {
    const rawExternalId = String(item.id || '').trim();
    const mudrexExternalId = this.buildMudrexPositionExternalId(brokerKey, item);
    const mudrexLegacyExternalId = this.buildMudrexPositionLegacyExternalId(brokerKey, item);
    const externalId = mudrexExternalId || rawExternalId || this.buildPositionSyntheticId(item);
    if (!externalId) return null;
    const symbol = String(item.symbol || '').trim() || null;
    const status = this.normalizePositionStatus(String(item.status || '').trim() || null);
    const statusRank = this.computePositionStatusRank(status || '');
    this.normalizePositionPayloadTimestamps(item, status);
    const payloadJson = JSON.stringify(item);
    const payloadHash = createHash('sha256').update(payloadJson).digest('hex');
    return {
      userId,
      accountId,
      brokerKey,
      externalId,
      legacyExternalId:
        mudrexExternalId && mudrexLegacyExternalId && mudrexLegacyExternalId !== mudrexExternalId
          ? mudrexLegacyExternalId
          : mudrexExternalId && rawExternalId && mudrexExternalId !== rawExternalId
            ? rawExternalId
            : null,
      symbol,
      status,
      statusRank,
      payloadJson,
      payloadHash,
    };
  }

  private normalizePositionPayloadTimestamps(
    item: Record<string, unknown>,
    status: string | null
  ): void {
    if (!item) return;
    const closedAtRaw = item.closed_at ?? item.closedAt;
    const updatedAtRaw = item.updated_at ?? item.updatedAt;
    const closedAt = closedAtRaw ? new Date(String(closedAtRaw)) : null;
    if (closedAt && Number.isFinite(closedAt.getTime())) {
      const updatedAt = updatedAtRaw ? new Date(String(updatedAtRaw)) : null;
      if (!updatedAt || !Number.isFinite(updatedAt.getTime()) || closedAt > updatedAt) {
        item.updated_at = closedAt.toISOString();
      }
    }
    const normalized = String(status || '')
      .trim()
      .toUpperCase();
    if (
      (normalized === 'CLOSED' || normalized === 'LIQUIDATED') &&
      item.closed_at &&
      !item.updated_at
    ) {
      item.updated_at = String(item.closed_at);
    }
  }

  private buildMudrexPositionExternalId(
    brokerKey: string,
    item: Record<string, unknown>
  ): string | null {
    const base = this.buildMudrexPositionBaseExternalId(brokerKey, item);
    if (!base) {
      return null;
    }
    const status = this.normalizePositionStatus(String(item.status || '').trim() || null);
    const lifecycleSuffix = this.buildMudrexPositionLifecycleExternalIdSuffix(item, status);
    return [...base, ...lifecycleSuffix].join(':');
  }

  private buildMudrexPositionLegacyExternalId(
    brokerKey: string,
    item: Record<string, unknown>
  ): string | null {
    const base = this.buildMudrexPositionBaseExternalId(brokerKey, item);
    return base ? base.join(':') : null;
  }

  private buildMudrexPositionBaseExternalId(
    brokerKey: string,
    item: Record<string, unknown>
  ): string[] | null {
    if (
      String(brokerKey || '')
        .trim()
        .toLowerCase() !== 'mudrex'
    ) {
      return null;
    }
    const assetUuid = String(item.asset_uuid || '').trim();
    const createdAt = String(item.created_at || '').trim();
    const side = String(item.position_type || item.order_type || item.side || '')
      .trim()
      .toUpperCase();
    if (!assetUuid || !createdAt) {
      return null;
    }
    return ['mudrex', assetUuid, createdAt, side || 'NA'];
  }

  private buildMudrexPositionLifecycleExternalIdSuffix(
    item: Record<string, unknown>,
    status: string | null
  ): string[] {
    if (!['PARTIAL', 'CLOSED', 'LIQUIDATED'].includes(String(status || ''))) {
      return [];
    }
    const lifecycleLabel = String(status || 'PARTIAL');

    const rawEventId = String(
      item.id ?? item.position_id ?? item.positionId ?? item.future_position_uuid ?? ''
    ).trim();
    if (rawEventId && rawEventId.length <= 64) {
      return [lifecycleLabel, rawEventId];
    }

    const fingerprint = [
      item.closed_at ?? item.closedAt ?? item.updated_at ?? item.updatedAt ?? '',
      item.quantity ?? item.size ?? '',
      item.closed_price ?? item.closedPrice ?? '',
      item.pnl ?? item.realized ?? item.realized_pnl ?? '',
    ]
      .map((value) => String(value ?? '').trim())
      .join('|');
    const digest = createHash('sha256')
      .update(fingerprint || JSON.stringify(item))
      .digest('hex')
      .slice(0, 16);
    return [lifecycleLabel, digest];
  }

  // ── Single forward-only upsert ───────────────────────────────

  private async upsertPositionSnapshotBatch(
    rows: Array<{
      userId: string;
      accountId: string;
      brokerKey: string;
      externalId: string;
      legacyExternalId?: string | null;
      symbol: string | null;
      status: string | null;
      statusRank: number;
      payloadJson: string;
      payloadHash: string;
    }>,
    runLogId?: string,
    options: { allowStatusDowngrade?: boolean } = {}
  ): Promise<{ inserted: number; updated: number; skipped: number; symbols: string[] }> {
    if (rows.length === 0) return { inserted: 0, updated: 0, skipped: 0, symbols: [] };

    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    const allowStatusDowngrade = Boolean(options.allowStatusDowngrade);
    const statusUpdateCondition = allowStatusDowngrade
      ? 'TRUE'
      : "VALUES(status_rank) >= status_rank OR VALUES(status) = 'OPEN'";

    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE);

      for (const row of chunk) {
        if (row.legacyExternalId && row.legacyExternalId !== row.externalId) {
          const existingTargetRows = (await coreDataSource.query(
            `SELECT id
               FROM scheduler_positions_snapshots
              WHERE user_id = ?
                AND account_id = ?
                AND external_id = ?
              LIMIT 1`,
            [row.userId, row.accountId, row.externalId]
          )) as Array<{ id?: string }>;
          if (existingTargetRows.length > 0) {
            await coreDataSource.query(
              `DELETE FROM scheduler_positions_snapshots
                WHERE user_id = ?
                  AND account_id = ?
                  AND external_id = ?`,
              [row.userId, row.accountId, row.legacyExternalId]
            );
          } else {
            await coreDataSource.query(
              `UPDATE scheduler_positions_snapshots
               SET external_id = ?
               WHERE user_id = ? AND account_id = ? AND external_id = ?`,
              [row.externalId, row.userId, row.accountId, row.legacyExternalId]
            );
          }
        }
      }

      // Query existing external_ids and their current statuses before upsert
      const chunkExternalIds = chunk.map((r) => r.externalId);
      const existingRows = (await coreDataSource.query(
        `SELECT external_id, status, payload_hash, status_rank
         FROM scheduler_positions_snapshots
         WHERE user_id = ? AND account_id = ? AND external_id IN (${chunkExternalIds.map(() => '?').join(',')})`,
        [chunk[0].userId, chunk[0].accountId, ...chunkExternalIds]
      )) as Array<{
        external_id: string;
        status: string | null;
        payload_hash: string | null;
        status_rank: number;
      }>;

      const existingMap = new Map<
        string,
        { status: string | null; payloadHash: string | null; statusRank: number }
      >();
      for (const row of existingRows) {
        existingMap.set(row.external_id, {
          status: row.status,
          payloadHash: row.payload_hash,
          statusRank: row.status_rank,
        });
      }

      const placeholders = chunk
        .map(() => '(UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), NOW(), NOW())')
        .join(',');
      const params: Array<unknown> = [];
      for (const row of chunk) {
        params.push(
          row.userId,
          row.accountId,
          row.brokerKey,
          row.externalId,
          row.symbol,
          row.status,
          row.statusRank,
          row.payloadJson,
          row.payloadHash
        );
      }

      await coreDataSource.query(
        `INSERT INTO scheduler_positions_snapshots
           (id, user_id, account_id, broker_key, external_id, symbol,
            status, status_rank, payload_json, payload_hash,
            first_seen_at, last_seen_at, created_at, updated_at)
         VALUES ${placeholders}
         ON DUPLICATE KEY UPDATE
           last_seen_at = NOW(),
           broker_key = VALUES(broker_key),
           symbol = COALESCE(VALUES(symbol), symbol),
           status = IF(${statusUpdateCondition}, VALUES(status), status),
           status_rank = IF(${statusUpdateCondition}, VALUES(status_rank), status_rank),
           payload_json = IF(${statusUpdateCondition}, VALUES(payload_json), payload_json),
           payload_hash = IF(${statusUpdateCondition}, VALUES(payload_hash), payload_hash),
           updated_at = NOW()`,
        params
      );

      // Classify each row as inserted / updated / skipped
      for (const row of chunk) {
        const existing = existingMap.get(row.externalId);
        if (!existing) {
          inserted += 1;
        } else if (row.payloadHash === existing.payloadHash) {
          skipped += 1;
        } else if (
          !allowStatusDowngrade &&
          row.statusRank < existing.statusRank &&
          row.status !== 'OPEN'
        ) {
          skipped += 1;
        } else {
          updated += 1;
        }
      }

      // Write per-record update logs
      if (runLogId) {
        const logEntries: QueryDeepPartialEntity<ExchangeAssetUpdateLog>[] = [];
        for (const row of chunk) {
          const existing = existingMap.get(row.externalId);
          const isInsert = !existing;

          let actionType: string;
          let message: string;

          if (isInsert) {
            actionType = 'inserted';
            message = row.status || 'UNKNOWN';
          } else if (row.payloadHash === existing.payloadHash) {
            actionType = 'skipped';
            message = 'payload unchanged';
          } else if (
            !allowStatusDowngrade &&
            row.statusRank < existing.statusRank &&
            row.status !== 'OPEN'
          ) {
            actionType = 'skipped';
            const existingStatusLabel = existing.status || 'UNKNOWN';
            const incomingStatusLabel = row.status || 'UNKNOWN';
            message = `status rank lower: ${existingStatusLabel}(${existing.statusRank}) > ${incomingStatusLabel}(${row.statusRank})`;
          } else {
            actionType = 'updated';
            message =
              existing.status !== row.status
                ? `status: ${existing.status || 'UNKNOWN'} → ${row.status || 'UNKNOWN'}`
                : `status: ${row.status || 'UNKNOWN'} (unchanged)`;
          }

          logEntries.push({
            runLogId,
            source: 'positions',
            accountId: row.accountId,
            actionType,
            symbol: row.symbol,
            externalId: row.externalId,
            message,
          });
        }
        await this.exchangeAssetUpdateLogRepository.createMany(logEntries);
      }
    }

    return {
      inserted,
      updated,
      skipped,
      symbols: Array.from(
        new Set(
          rows
            .map((row) =>
              String(row.symbol || '')
                .trim()
                .toUpperCase()
            )
            .filter(Boolean)
        )
      ),
    };
  }

  private async upsertPositionSnapshotsFromItems(
    userId: string,
    accountId: string,
    brokerKey: string,
    items: unknown[],
    runLogId?: string,
    options: { allowStatusDowngrade?: boolean } = {}
  ): Promise<{ inserted: number; updated: number; skipped: number; symbols: string[] }> {
    if (items.length === 0) return { inserted: 0, updated: 0, skipped: 0, symbols: [] };

    await this.enrichDeltaOpenPositionLeverageFromConfirmedOrders(
      userId,
      accountId,
      brokerKey,
      items
    );
    await this.enrichMudrexClosedPositionsFromOrderSnapshots(userId, accountId, brokerKey, items);

    const prepared: Array<{
      userId: string;
      accountId: string;
      brokerKey: string;
      externalId: string;
      symbol: string | null;
      status: string | null;
      statusRank: number;
      payloadJson: string;
      payloadHash: string;
    }> = [];
    const readModelRows: PositionReadModelUpsert[] = [];

    for (const item of items) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const row = this.buildPositionRow(
        userId,
        accountId,
        brokerKey,
        item as Record<string, unknown>
      );
      if (!row) continue;
      prepared.push(row);
      const readModelRow = buildPositionReadModelUpsert({
        userId,
        accountId,
        brokerKey,
        externalId: row.externalId,
        payload: item,
        payloadJson: row.payloadJson,
        payloadHash: row.payloadHash,
        statusRank: row.statusRank,
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
      });
      if (readModelRow) {
        readModelRows.push(readModelRow);
      }
    }

    const delta = await this.upsertPositionSnapshotBatch(prepared, runLogId, options);
    if (readModelRows.length) {
      await this.positionReadModelRepository.upsertReadModels(readModelRows);
      await this.positionReadModelRepository.refreshOpenDeltaProtectionFromOrderSnapshots?.({
        userId,
        accountId,
        brokerKey,
      });
    }
    return delta;
  }

  // ── Table DDL ────────────────────────────────────────────────

  private async ensureSyncPositionsSnapshotTable(): Promise<void> {
    await coreDataSource.query(`
      CREATE TABLE IF NOT EXISTS scheduler_positions_snapshots (
        id char(36) NOT NULL,
        user_id char(36) NOT NULL,
        account_id char(36) NOT NULL,
        broker_key varchar(100) NOT NULL,
        external_id varchar(191) NOT NULL,
        symbol varchar(100) NULL,
        status varchar(64) NULL,
        status_rank int NOT NULL DEFAULT 0,
        payload_json json NULL,
        payload_hash char(64) NULL,
        first_seen_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_seen_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uidx_scheduler_positions_snapshot (user_id, account_id, external_id),
        KEY idx_scheduler_positions_last_seen (last_seen_at),
        KEY idx_scheduler_positions_user_account (user_id, account_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    `);

    // Backwards-compatible upgrade for older tables created before payload_hash existed.
    const hashRows = (await coreDataSource.query(
      `SELECT COUNT(*) AS count
       FROM information_schema.columns
       WHERE table_schema = DATABASE()
         AND table_name = 'scheduler_positions_snapshots'
         AND column_name = 'payload_hash'`
    )) as Array<{ count: number | string }>;
    const hasPayloadHash = Number(hashRows?.[0]?.count || 0) > 0;
    if (!hasPayloadHash) {
      await coreDataSource.query(
        `ALTER TABLE scheduler_positions_snapshots
         ADD COLUMN payload_hash char(64) NULL AFTER payload_json`
      );
    }

    // Backwards-compatible upgrade for older tables created before status_rank existed.
    const rankRows = (await coreDataSource.query(
      `SELECT COUNT(*) AS count
       FROM information_schema.columns
       WHERE table_schema = DATABASE()
         AND table_name = 'scheduler_positions_snapshots'
         AND column_name = 'status_rank'`
    )) as Array<{ count: number | string }>;
    const hasStatusRank = Number(rankRows?.[0]?.count || 0) > 0;
    if (!hasStatusRank) {
      await coreDataSource.query(
        `ALTER TABLE scheduler_positions_snapshots
         ADD COLUMN status_rank int NOT NULL DEFAULT 0 AFTER status`
      );
    }
  }

  // ── Target resolution ────────────────────────────────────────

  private async resolveTargetUserIds(inputUserIds?: string[]): Promise<string[]> {
    const provided = (inputUserIds || []).map((item) => String(item || '').trim()).filter(Boolean);
    if (provided.length === 0) {
      return [];
    }
    return Array.from(new Set(provided));
  }

  private normalizeBrokerKeys(input?: string[]): Array<string> {
    const raw = Array.isArray(input) ? input : [];
    const normalized = raw
      .map((item) =>
        String(item || '')
          .trim()
          .toLowerCase()
      )
      .filter(Boolean);
    return Array.from(new Set(normalized));
  }

  private filterScopedAccounts(
    accounts: BrokerAccount[],
    brokerKeyFilter: ReadonlySet<string>,
    accountIdFilter: ReadonlySet<string>
  ): BrokerAccount[] {
    return accounts.filter((account) => {
      if (
        brokerKeyFilter.size > 0 &&
        !brokerKeyFilter.has(String(account.brokerKey || '').toLowerCase())
      ) {
        return false;
      }
      if (accountIdFilter.size > 0 && !accountIdFilter.has(String(account.id || ''))) {
        return false;
      }
      return true;
    });
  }

  private groupInfraAccountsByOwner(
    accounts: BrokerAccount[],
    brokerKeyFilter: ReadonlySet<string>,
    accountIdFilter: ReadonlySet<string>
  ): Array<{ userId: string; accounts: BrokerAccount[] }> {
    const scopedAccounts = this.filterScopedAccounts(accounts, brokerKeyFilter, accountIdFilter);
    const grouped = new Map<string, BrokerAccount[]>();

    for (const account of scopedAccounts) {
      const ownerUserId = String(account.userId || '').trim();
      if (!ownerUserId) {
        continue;
      }
      const bucket = grouped.get(ownerUserId);
      if (bucket) {
        bucket.push(account);
      } else {
        grouped.set(ownerUserId, [account]);
      }
    }

    return Array.from(grouped.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([userId, ownerAccounts]) => ({
        userId,
        accounts: ownerAccounts.sort((left, right) =>
          String(left.id || '').localeCompare(String(right.id || ''))
        ),
      }));
  }

  private async resolveExecutionUserIds(request: PositionsSyncRequest): Promise<string[]> {
    const executionScope = String(request.executionScope || '')
      .trim()
      .toLowerCase();
    if (executionScope === POSITIONS_ORDERS_PRODUCT_SYNC_SCOPE) {
      const requestUserId = String(request.requestUserId || '').trim();
      if (!requestUserId) {
        throw new Error('Product-owned positions sync requests require requestUserId.');
      }
      return [requestUserId];
    }

    if (executionScope === POSITIONS_ORDERS_SYSTEM_SYNC_SCOPE) {
      const systemUserId = String(env.scheduler.systemUserId || '').trim();
      if (!systemUserId) {
        throw new Error(
          'System scheduler positions sync requests require env.scheduler.systemUserId.'
        );
      }
      return [systemUserId];
    }

    return this.resolveTargetUserIds(request.targetUserIds);
  }

  // ── Main entry point ─────────────────────────────────────────

  async runBatch(request: PositionsSyncRequest): Promise<{
    processedUsers: number;
    succeededUsers: number;
    failedUsers: number;
    processedAccounts: number;
    fetchedRecords: number;
    insertedRecords: number;
    updatedRecords: number;
    skippedRecords: number;
    failedAccounts: number;
    failures: Array<{ userId: string; error: string }>;
  }> {
    const startedAt = new Date();
    await this.ensureSyncPositionsSnapshotTable();
    await this.ensureCheckpointTable();

    const now = new Date();
    const lookbackDays = Math.min(
      MAX_LOOKBACK_DAYS,
      Math.max(1, Math.floor(Number(request.lookbackDays || MAX_LOOKBACK_DAYS)))
    );
    const historyWindowDays =
      typeof request.historyWindowDays === 'number'
        ? Math.floor(request.historyWindowDays)
        : DEFAULT_WINDOW_DAYS;
    const forceBackfill = Boolean(request.backfill);

    const requestedUserIds = await this.resolveExecutionUserIds(request);
    const brokerKeys = this.normalizeBrokerKeys(request.brokerKeys);
    const brokerKeyFilter = new Set(brokerKeys);
    const accountIdFilter = new Set(
      (request.accountIds || []).map((item) => String(item || '').trim()).filter(Boolean)
    );
    const isInfraSystemAccountsRequest =
      requestedUserIds.length === 1 && requestedUserIds[0] === env.scheduler.systemUserId;
    const accountGroups = isInfraSystemAccountsRequest
      ? this.groupInfraAccountsByOwner(
          await this.brokerAccountRepository.getAllActiveBrokerAccounts(),
          brokerKeyFilter,
          accountIdFilter
        )
      : await Promise.all(
          requestedUserIds.map(async (userId) => {
            const isSystemUser = userId === env.scheduler.systemUserId;
            const accounts = isSystemUser
              ? await this.brokerAccountRepository.getActiveSystemBrokerAccounts()
              : await this.brokerAccountRepository.getActiveBrokerAccounts(userId);
            return {
              userId,
              accounts: this.filterScopedAccounts(accounts, brokerKeyFilter, accountIdFilter),
            };
          })
        );

    let succeededUsers = 0;
    let failedUsers = 0;
    let processedAccounts = 0;
    let fetchedRecords = 0;
    let insertedRecords = 0;
    let updatedRecords = 0;
    let skippedRecords = 0;
    let failedAccounts = 0;
    const failures: Array<{ userId: string; error: string }> = [];

    for (const { userId, accounts: scopedAccounts } of accountGroups) {
      try {
        let hadCompletedAccount = false;
        const isSystemUser = userId === env.scheduler.systemUserId;

        for (const account of scopedAccounts) {
          processedAccounts += 1;
          try {
            const brokerKey = String(account.brokerKey || '').trim();
            const accountId = String(account.id || '').trim();
            if (!brokerKey || !accountId) {
              continue;
            }

            // Use MySQL's clock for stale-close comparison so both last_seen_at (set via NOW())
            // and this timestamp are from the same source — avoids JS/MySQL timezone mismatch.
            const [{ now: dbNow }] = (await coreDataSource.query('SELECT NOW() AS now')) as [
              { now: Date },
            ];
            const accountSyncStartedAt = dbNow;
            const route = isSystemUser
              ? { userId, brokerKey, accountId }
              : await this.brokerAccountRoutingService.resolve(
                  userId,
                  brokerKey,
                  accountId,
                  brokerKey
                );
            const resolvedBrokerKey = String(route.brokerKey || brokerKey).trim() || brokerKey;
            const resolvedAccountId = String(route.accountId || accountId).trim() || accountId;

            let openPositions: unknown[] = [];
            let openError: string | null = null;
            let historyPositions: unknown[] = [];
            let historyError: string | null = null;

            const adapter = this.brokerRuntimeRegistry.getPositionsAdapter(resolvedBrokerKey);
            const historyOverlapDays = this.resolveHistoryOverlapDays(adapter);

            // Step 1: Always fetch open positions (lightweight, catches status changes fast)
            try {
              const openRaw = await adapter.getPositions({ limit: SYNC_LIMIT }, route);
              openPositions = this.extractList(openRaw);
              await this.enrichOpenPositionsWithMarketPnl(openPositions);
            } catch (error) {
              openError = error instanceof Error ? error.message : String(error);
            }

            // Step 2: Determine history date range from checkpoint
            const checkpoint = await this.getCheckpoint(resolvedAccountId);
            let historyStart: Date;
            let historyEnd: Date = now;

            if (forceBackfill || !checkpoint) {
              // No checkpoint or forced backfill: full lookback
              historyStart = this.addDays(now, -lookbackDays);
            } else {
              const gapDays = (now.getTime() - checkpoint.getTime()) / (24 * 60 * 60 * 1000);
              if (gapDays > MAX_LOOKBACK_DAYS) {
                // Gap exceeds max lookback — treat as fresh backfill
                historyStart = this.addDays(now, -MAX_LOOKBACK_DAYS);
                failures.push({
                  userId,
                  error: `Checkpoint gap exceeds ${MAX_LOOKBACK_DAYS} days for account ${resolvedAccountId} — backfilling last ${MAX_LOOKBACK_DAYS} days, older data may be missing`,
                });
              } else {
                // Incremental: re-read a recent overlap window so broker normalization fixes self-heal.
                historyStart = this.addDays(checkpoint, -historyOverlapDays);
              }
            }

            // Step 3: Fetch history in date windows
            const startDateStr = request.startDate || this.formatIsoDate(historyStart);
            const endDateStr = request.endDate || this.formatIsoDate(historyEnd);

            try {
              const windows =
                adapter.historyWindowMode === 'contiguous'
                  ? [{ startDate: startDateStr, endDate: endDateStr }]
                  : this.buildDateWindows(startDateStr, endDateStr, historyWindowDays);
              const combinedHistory: unknown[] = [];
              for (const window of windows) {
                const historyRaw = await adapter.getPositionHistory(
                  {
                    startDate: window.startDate || undefined,
                    endDate: window.endDate || undefined,
                    limit: String(SYNC_LIMIT),
                  },
                  route
                );
                combinedHistory.push(...this.extractList(historyRaw));
              }
              historyPositions = combinedHistory;
            } catch (error) {
              historyError = error instanceof Error ? error.message : String(error);
            }

            if (openError && historyError) {
              throw new Error(
                `Open positions failed: ${openError}; Position history failed: ${historyError}`
              );
            }

            // Step 4: Deduplicate open + history in memory, keeping highest status rank
            const combined = [...openPositions, ...historyPositions];
            const deduped = this.deduplicateByExternalId(combined, resolvedBrokerKey);
            const affectedSymbols = new Set<string>();

            // Step 5: Single forward-only upsert
            const delta = await this.upsertPositionSnapshotsFromItems(
              userId,
              resolvedAccountId,
              resolvedBrokerKey.toLowerCase(),
              deduped,
              request.runLogId,
              { allowStatusDowngrade: forceBackfill }
            );

            insertedRecords += delta.inserted;
            updatedRecords += delta.updated;
            skippedRecords += delta.skipped;
            fetchedRecords += combined.length;
            for (const symbol of delta.symbols) {
              affectedSymbols.add(symbol);
            }

            // Step 6: Close stale open positions not seen in this run
            if (!openError) {
              const closeRank = this.computePositionStatusRank('CLOSED');

              // Query stale positions before closing (for logging and PnL computation)
              const stalePositions = (await coreDataSource.query(
                `SELECT id, external_id, symbol, status, payload_json
                 FROM scheduler_positions_snapshots
                 WHERE user_id = ?
                   AND account_id = ?
                   AND LOWER(broker_key) = ?
                   AND status_rank < ?
                   AND last_seen_at < ?`,
                [
                  userId,
                  resolvedAccountId,
                  resolvedBrokerKey.toLowerCase(),
                  closeRank,
                  accountSyncStartedAt,
                ]
              )) as Array<{
                id: string;
                external_id: string;
                symbol: string | null;
                status: string | null;
                payload_json: unknown;
              }>;

              // Fetch closing fills from broker if adapter supports it
              let closingFills:
                | Map<
                    string,
                    {
                      closePrice: number;
                      closedAt: string;
                      fillType: string | null;
                      closeFillId?: string | null;
                      closeOrderId?: string | null;
                    }
                  >
                | undefined;
              if (stalePositions.length > 0) {
                if (typeof adapter.getClosingFills === 'function') {
                  try {
                    const productIds = stalePositions.map((s) => s.external_id);
                    closingFills = await adapter.getClosingFills(productIds, route);
                  } catch {
                    // Fall back to mark_price if fills fetch fails
                  }
                }
              }

              // Close stale positions and compute PnL
              const staleReadModelRows: PositionReadModelUpsert[] = [];
              const staleReadModelIdsWithoutPayload: string[] = [];
              const staleReadModelIdsToDelete: string[] = [];
              for (const stale of stalePositions) {
                const payload = this.parsePayloadJson(stale.payload_json);
                if (payload) {
                  payload.status = 'closed';
                  const entryPrice = this.toFiniteNumber(payload.entry_price);
                  const quantity = Math.abs(
                    this.toFiniteNumber(payload.quantity) || this.toFiniteNumber(payload.size)
                  );
                  const side = String(payload.side || payload.position_type || '').toLowerCase();
                  const direction = side === 'long' || side === 'buy' ? 1 : -1;

                  // Prefer close price from fills, fall back to mark_price
                  const fill = closingFills?.get(stale.external_id);
                  let closePrice: number;
                  if (fill) {
                    closePrice = fill.closePrice;
                    payload.closed_at = fill.closedAt;
                    if (fill.fillType) payload.fill_type = fill.fillType;
                    if (fill.closeFillId) payload.close_fill_id = fill.closeFillId;
                    if (fill.closeOrderId) payload.close_order_id = fill.closeOrderId;
                  } else {
                    closePrice =
                      this.toFiniteNumber(payload.mark_price) ||
                      this.toFiniteNumber(payload.closed_price);
                  }

                  if (entryPrice > 0 && closePrice > 0 && quantity > 0) {
                    const pnl = direction * (closePrice - entryPrice) * quantity;
                    payload.pnl = pnl;
                    payload.realized = pnl;
                    payload.closed_price = String(closePrice);
                  }

                  const lifecycleExternalId = this.buildDeltaClosedPositionLifecycleExternalId(
                    resolvedBrokerKey,
                    stale.external_id,
                    payload,
                    closePrice,
                    fill?.closedAt ?? payload.closed_at ?? payload.updated_at
                  );
                  const nextExternalId = lifecycleExternalId ?? stale.external_id;
                  const shouldCanonicalize =
                    Boolean(lifecycleExternalId) && lifecycleExternalId !== stale.external_id;
                  if (shouldCanonicalize) {
                    payload.legacy_external_id ??= stale.external_id;
                    payload.id = lifecycleExternalId;
                  }

                  const updatedJson = JSON.stringify(payload);
                  const updatedHash = createHash('sha256').update(updatedJson).digest('hex');
                  const mergedIntoExisting = shouldCanonicalize
                    ? await this.mergeDeltaClosedSchedulerSnapshot({
                        userId,
                        accountId: resolvedAccountId,
                        staleRowId: stale.id,
                        staleExternalId: stale.external_id,
                        lifecycleExternalId: nextExternalId,
                        statusRank: closeRank,
                        observedAt: accountSyncStartedAt,
                        payloadJson: updatedJson,
                        payloadHash: updatedHash,
                      })
                    : false;
                  if (!shouldCanonicalize) {
                    await coreDataSource.query(
                      `UPDATE scheduler_positions_snapshots
                       SET status = 'CLOSED',
                           status_rank = ?,
                           payload_json = ?,
                           payload_hash = ?,
                           last_seen_at = ?,
                           updated_at = NOW()
                       WHERE id = ?`,
                      [closeRank, updatedJson, updatedHash, accountSyncStartedAt, stale.id]
                    );
                  }

                  if (shouldCanonicalize) {
                    staleReadModelIdsToDelete.push(stale.external_id);
                  }
                  if (!mergedIntoExisting) {
                    const readModelRow = buildPositionReadModelUpsert({
                      userId,
                      accountId: resolvedAccountId,
                      brokerKey: resolvedBrokerKey.toLowerCase(),
                      externalId: nextExternalId,
                      payload,
                      payloadJson: updatedJson,
                      payloadHash: updatedHash,
                      statusRank: closeRank,
                      firstSeenAt: null,
                      lastSeenAt: accountSyncStartedAt,
                    });
                    if (readModelRow) {
                      staleReadModelRows.push(readModelRow);
                    }
                  }
                } else {
                  await coreDataSource.query(
                    `UPDATE scheduler_positions_snapshots
                     SET status = 'CLOSED', status_rank = ?, updated_at = NOW()
                     WHERE id = ?`,
                    [closeRank, stale.id]
                  );
                  staleReadModelIdsWithoutPayload.push(stale.external_id);
                }
              }
              if (staleReadModelRows.length) {
                await this.positionReadModelRepository.upsertReadModels(staleReadModelRows);
              }
              if (staleReadModelIdsToDelete.length) {
                await this.positionReadModelRepository.deleteReadModelsByExternalIds(
                  userId,
                  resolvedAccountId,
                  resolvedBrokerKey.toLowerCase(),
                  staleReadModelIdsToDelete
                );
              }
              if (staleReadModelIdsWithoutPayload.length) {
                await this.positionReadModelRepository.markPositionsClosed(
                  userId,
                  resolvedAccountId,
                  resolvedBrokerKey.toLowerCase(),
                  staleReadModelIdsWithoutPayload,
                  accountSyncStartedAt
                );
              }
              await this.positionReadModelRepository.refreshOpenDeltaProtectionFromOrderSnapshots?.(
                {
                  userId,
                  accountId: resolvedAccountId,
                  brokerKey: resolvedBrokerKey,
                }
              );
              const closedCount = stalePositions.length;
              updatedRecords += closedCount;

              // Log stale-closed positions
              if (request.runLogId && stalePositions.length > 0) {
                const closeLogEntries: QueryDeepPartialEntity<ExchangeAssetUpdateLog>[] =
                  stalePositions.map((row) => ({
                    runLogId: request.runLogId,
                    source: 'positions',
                    accountId: resolvedAccountId,
                    actionType: 'updated',
                    symbol: row.symbol,
                    externalId: row.external_id,
                    message: `stale-closed: ${row.status || 'UNKNOWN'} → CLOSED`,
                  }));
                await this.exchangeAssetUpdateLogRepository.createMany(closeLogEntries);
              }

              for (const row of stalePositions) {
                const symbol = String(row.symbol || '')
                  .trim()
                  .toUpperCase();
                if (symbol) {
                  affectedSymbols.add(symbol);
                }
              }
            }

            const lifecycleCleanup = await this.pruneDeltaClosedPositionLifecycleDuplicates(
              userId,
              resolvedAccountId,
              resolvedBrokerKey.toLowerCase()
            );
            updatedRecords +=
              lifecycleCleanup.deletedSchedulerRows + lifecycleCleanup.deletedReadModelRows;
            for (const symbol of lifecycleCleanup.symbols) {
              affectedSymbols.add(symbol);
            }

            if (affectedSymbols.size > 0) {
              try {
                await this.suggestedTradesService.syncExecutionForPositionUpdates(
                  userId,
                  resolvedBrokerKey.toLowerCase(),
                  resolvedAccountId,
                  Array.from(affectedSymbols)
                );
              } catch (error) {
                failures.push({
                  userId,
                  error: `suggested trade position sync failed for account ${resolvedAccountId} (${resolvedBrokerKey}): ${
                    error instanceof Error ? error.message : String(error)
                  }`,
                });
              }
            }

            // Step 7: Save checkpoint on success
            if (!historyError) {
              await this.saveCheckpoint(resolvedAccountId, historyEnd);
            }

            // Surface partial failures without failing the whole account sync.
            if (openError || historyError) {
              failures.push({
                userId,
                error: `positions sync partial failure for account ${resolvedAccountId} (${resolvedBrokerKey}): ${
                  openError ? `open error: ${openError}` : ''
                }${openError && historyError ? '; ' : ''}${historyError ? `history error: ${historyError}` : ''}`,
              });
            }
            hadCompletedAccount = true;
          } catch (error) {
            failedAccounts += 1;
            failures.push({
              userId,
              error: `positions sync failed for account ${String(account.id || '').trim()} (${String(
                account.brokerKey || ''
              ).trim()}): ${error instanceof Error ? error.message : String(error)}`,
            });
          }
        }

        if (hadCompletedAccount) {
          succeededUsers += 1;
        } else {
          failedUsers += 1;
          failures.push({
            userId,
            error: scopedAccounts.length
              ? 'All scoped broker accounts failed during positions sync'
              : 'No active broker accounts matched the sync scope',
          });
        }
      } catch (error) {
        failedUsers += 1;
        failures.push({
          userId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const result = {
      processedUsers: accountGroups.length || requestedUserIds.length,
      succeededUsers,
      failedUsers,
      processedAccounts,
      fetchedRecords,
      insertedRecords,
      updatedRecords,
      skippedRecords,
      failedAccounts,
      failures,
    };

    const actorUserId = env.scheduler.systemUserId || requestedUserIds[0] || '';
    const failed = failures.length;
    await this.operationalEventService.logActivity(actorUserId, {
      type: 'Scheduler run',
      title: 'Positions sync completed',
      status: failed > 0 ? 'Warning' : 'Success',
      route: 'Schedulers',
      stream: 'Runs',
      related: CHECKPOINT_SCHEDULER_KEY,
      description:
        `Processed ${accountGroups.length || requestedUserIds.length} user(s) in ${Date.now() - startedAt.getTime()}ms. ` +
        `Accounts processed=${processedAccounts}, inserted=${insertedRecords}, updated=${updatedRecords}, ` +
        `skipped=${skippedRecords}, failures=${failed}.`,
    });

    if (failed > 0) {
      await this.operationalEventService.emitFailureAlert(actorUserId, {
        channel: 'Scheduler',
        source: CHECKPOINT_SCHEDULER_KEY,
        message: `Positions sync completed with ${failed} failure(s) across ${failedAccounts} account(s).`,
        route: 'Schedulers',
        symbol: 'POSITIONS',
      });
    }

    return result;
  }

  private buildDeltaClosedPositionLifecycleExternalId(
    brokerKey: string,
    externalId: string,
    payload: Record<string, unknown>,
    closePrice: number,
    closedAt: unknown
  ): string | null {
    if (
      String(brokerKey || '')
        .trim()
        .toLowerCase() !== 'delta_exchange'
    ) {
      return null;
    }
    const productId = this.resolveDeltaProductIdForLifecycle(externalId, payload);
    return buildDeltaClosedPositionLifecycleId({
      productId,
      side: payload.position_type ?? payload.side ?? payload.order_type,
      status: payload.status ?? 'closed',
      quantity: Math.abs(
        this.toFiniteNumber(payload.quantity) || this.toFiniteNumber(payload.size)
      ),
      entryPrice: payload.entry_price ?? payload.entryPrice,
      closePrice,
      closedAt,
    });
  }

  private async pruneDeltaClosedPositionLifecycleDuplicates(
    userId: string,
    accountId: string,
    brokerKey: string
  ): Promise<DeltaClosedLifecycleCleanupResult> {
    const normalizedBrokerKey = String(brokerKey || '')
      .trim()
      .toLowerCase();
    if (normalizedBrokerKey !== 'delta_exchange') {
      return { deletedSchedulerRows: 0, deletedReadModelRows: 0, symbols: [] };
    }

    const closeRank = this.computePositionStatusRank('CLOSED');
    const schedulerRows = await this.listDeltaClosedSchedulerLifecycleRows(
      userId,
      accountId,
      normalizedBrokerKey,
      closeRank
    );
    const readModelRows = await this.listDeltaClosedReadModelLifecycleRows(
      userId,
      accountId,
      normalizedBrokerKey,
      closeRank
    );
    const schedulerDuplicates = this.resolveDeltaClosedLifecycleDuplicateRows(schedulerRows);
    const readModelDuplicates = this.resolveDeltaClosedLifecycleDuplicateRows(readModelRows);

    const deletedSchedulerRows = await this.deleteDeltaClosedSchedulerLifecycleDuplicates(
      userId,
      accountId,
      normalizedBrokerKey,
      schedulerDuplicates.rowIds
    );
    const deletedReadModelRows =
      await this.positionReadModelRepository.deleteReadModelsByExternalIds(
        userId,
        accountId,
        normalizedBrokerKey,
        readModelDuplicates.externalIds
      );
    const symbols = Array.from(
      new Set([...schedulerDuplicates.symbols, ...readModelDuplicates.symbols])
    );

    return { deletedSchedulerRows, deletedReadModelRows, symbols };
  }

  private async listDeltaClosedSchedulerLifecycleRows(
    userId: string,
    accountId: string,
    brokerKey: string,
    closeRank: number
  ): Promise<DeltaClosedLifecycleRow[]> {
    const rows = (await coreDataSource.query(
      `SELECT id,
              external_id AS externalId,
              symbol,
              status,
              status_rank AS statusRank,
              payload_json AS payloadJson,
              last_seen_at AS lastSeenAt,
              updated_at AS updatedAt
         FROM scheduler_positions_snapshots
        WHERE user_id = ?
          AND account_id = ?
          AND LOWER(broker_key) = ?
          AND status_rank >= ?`,
      [userId, accountId, brokerKey, closeRank]
    )) as DeltaClosedLifecycleRow[];
    return rows;
  }

  private async listDeltaClosedReadModelLifecycleRows(
    userId: string,
    accountId: string,
    brokerKey: string,
    closeRank: number
  ): Promise<DeltaClosedLifecycleRow[]> {
    const rows = (await coreDataSource.query(
      `SELECT NULL AS id,
              external_id AS externalId,
              symbol,
              side,
              side_key AS sideKey,
              status,
              status_rank AS statusRank,
              quantity,
              entry_price AS entryPrice,
              closed_price AS closedPrice,
              position_closed_at AS positionClosedAt,
              payload_json AS payloadJson,
              last_seen_at AS lastSeenAt,
              updated_at AS updatedAt
         FROM position_read_models
        WHERE user_id = ?
          AND account_id = ?
          AND LOWER(broker_key) = ?
          AND status_rank >= ?`,
      [userId, accountId, brokerKey, closeRank]
    )) as DeltaClosedLifecycleRow[];
    return rows;
  }

  private resolveDeltaClosedLifecycleDuplicateRows(rows: DeltaClosedLifecycleRow[]): {
    rowIds: string[];
    externalIds: string[];
    symbols: string[];
  } {
    const groups = new Map<
      string,
      { canonicalRows: DeltaClosedLifecycleRow[]; duplicateRows: DeltaClosedLifecycleRow[] }
    >();

    for (const row of rows) {
      const payload = this.buildDeltaClosedLifecyclePayload(row);
      const closePrice = this.resolveDeltaClosedLifecycleClosePrice(row, payload);
      const closedAt = this.resolveDeltaClosedLifecycleClosedAt(row, payload);
      const lifecycleId = this.buildDeltaClosedPositionLifecycleExternalId(
        'delta_exchange',
        row.externalId,
        payload,
        closePrice,
        closedAt
      );
      const matchKey = this.buildDeltaClosedLifecycleMatchKey(
        row.externalId,
        payload,
        closePrice,
        closedAt
      );
      if (!matchKey) {
        continue;
      }

      const group = groups.get(matchKey) || { canonicalRows: [], duplicateRows: [] };
      if (row.externalId === lifecycleId || this.isDeltaClosedLifecycleExternalId(row.externalId)) {
        group.canonicalRows.push(row);
      } else {
        group.duplicateRows.push(row);
      }
      groups.set(matchKey, group);
    }

    const rowIds = new Set<string>();
    const externalIds = new Set<string>();
    const symbols = new Set<string>();
    for (const group of groups.values()) {
      if (!group.canonicalRows.length || !group.duplicateRows.length) {
        continue;
      }
      for (const row of group.duplicateRows) {
        const rowId = String(row.id || '').trim();
        if (rowId) {
          rowIds.add(rowId);
        }
        const externalId = String(row.externalId || '').trim();
        if (externalId) {
          externalIds.add(externalId);
        }
        const symbol = String(row.symbol || '')
          .trim()
          .toUpperCase();
        if (symbol) {
          symbols.add(symbol);
        }
      }
    }

    return {
      rowIds: Array.from(rowIds),
      externalIds: Array.from(externalIds),
      symbols: Array.from(symbols),
    };
  }

  private isDeltaClosedLifecycleExternalId(value: unknown): boolean {
    return String(value || '')
      .trim()
      .startsWith('delta:');
  }

  private buildDeltaClosedLifecycleMatchKey(
    externalId: string,
    payload: Record<string, unknown>,
    closePrice: number,
    closedAt: unknown
  ): string | null {
    const productId = this.resolveDeltaProductIdForLifecycle(externalId, payload);
    const side = this.normalizeDeltaLifecycleSide(
      payload.position_type ?? payload.side ?? payload.order_type
    );
    const status = this.normalizeDeltaLifecycleStatus(payload.status ?? 'closed');
    const quantity = this.normalizeDeltaLifecycleNumber(
      Math.abs(this.toFiniteNumber(payload.quantity) || this.toFiniteNumber(payload.size))
    );
    const entryPrice = this.normalizeDeltaLifecycleNumber(
      payload.entry_price ?? payload.entryPrice
    );
    const normalizedClosePrice = this.normalizeDeltaLifecycleNumber(closePrice);
    const closedAtSecond = this.normalizeDeltaLifecycleTimestampSecond(closedAt);

    if (
      !productId ||
      !side ||
      !status ||
      !quantity ||
      !entryPrice ||
      !normalizedClosePrice ||
      !closedAtSecond
    ) {
      return null;
    }

    return [
      productId,
      side,
      status,
      quantity,
      entryPrice,
      normalizedClosePrice,
      closedAtSecond,
    ].join('|');
  }

  private normalizeDeltaLifecycleSide(value: unknown): 'long' | 'short' | null {
    const raw = String(value ?? '')
      .trim()
      .toLowerCase();
    if (raw === 'long' || raw === 'buy') {
      return 'long';
    }
    if (raw === 'short' || raw === 'sell') {
      return 'short';
    }
    return null;
  }

  private normalizeDeltaLifecycleStatus(value: unknown): 'closed' | 'liquidated' | null {
    const raw = String(value ?? '')
      .trim()
      .toLowerCase();
    if (raw === 'closed' || raw === 'close') {
      return 'closed';
    }
    if (raw === 'liquidated' || raw === 'liquidation') {
      return 'liquidated';
    }
    return null;
  }

  private normalizeDeltaLifecycleNumber(value: unknown): string | null {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return null;
    }
    return numeric.toFixed(8);
  }

  private normalizeDeltaLifecycleTimestampSecond(value: unknown): string | null {
    const raw = String(value ?? '').trim();
    if (!raw) {
      return null;
    }
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) {
      return raw;
    }
    return new Date(Math.round(date.getTime() / 1000) * 1000).toISOString();
  }

  private buildDeltaClosedLifecyclePayload(row: DeltaClosedLifecycleRow): Record<string, unknown> {
    const payload = { ...(this.parsePayloadJson(row.payloadJson) || {}) };
    if (payload.status === undefined && row.status) payload.status = row.status;
    if (payload.side === undefined && row.side) payload.side = row.side;
    if (payload.position_type === undefined && row.sideKey) payload.position_type = row.sideKey;
    if (payload.quantity === undefined && row.quantity !== undefined) {
      payload.quantity = row.quantity;
    }
    if (payload.entry_price === undefined && row.entryPrice !== undefined) {
      payload.entry_price = row.entryPrice;
    }
    if (payload.closed_price === undefined && row.closedPrice !== undefined) {
      payload.closed_price = row.closedPrice;
    }
    if (payload.closed_at === undefined && row.positionClosedAt !== undefined) {
      payload.closed_at = row.positionClosedAt;
    }
    return payload;
  }

  private resolveDeltaClosedLifecycleClosePrice(
    row: DeltaClosedLifecycleRow,
    payload: Record<string, unknown>
  ): number {
    return (
      this.toFiniteNumber(payload.closed_price) ||
      this.toFiniteNumber(payload.close_price) ||
      this.toFiniteNumber(payload.closedPrice) ||
      this.toFiniteNumber(row.closedPrice)
    );
  }

  private resolveDeltaClosedLifecycleClosedAt(
    row: DeltaClosedLifecycleRow,
    payload: Record<string, unknown>
  ): unknown {
    return (
      payload.closed_at ??
      payload.closedAt ??
      payload.updated_at ??
      row.positionClosedAt ??
      row.lastSeenAt ??
      row.updatedAt
    );
  }

  private async deleteDeltaClosedSchedulerLifecycleDuplicates(
    userId: string,
    accountId: string,
    brokerKey: string,
    rowIds: string[]
  ): Promise<number> {
    const normalizedRowIds = Array.from(
      new Set(rowIds.map((value) => String(value || '').trim()).filter(Boolean))
    );
    if (!normalizedRowIds.length) {
      return 0;
    }

    const result = await coreDataSource.query(
      `DELETE FROM scheduler_positions_snapshots
        WHERE user_id = ?
          AND account_id = ?
          AND LOWER(broker_key) = ?
          AND id IN (${normalizedRowIds.map(() => '?').join(', ')})`,
      [userId, accountId, brokerKey, ...normalizedRowIds]
    );
    return this.readAffectedRows(result);
  }

  private resolveDeltaProductIdForLifecycle(
    externalId: string,
    payload: Record<string, unknown>
  ): string | null {
    for (const candidate of [
      payload.asset_uuid,
      payload.product_id,
      payload.productId,
      payload.product,
      externalId,
    ]) {
      const value = String(candidate ?? '').trim();
      if (value && /^[0-9]+$/.test(value)) {
        return value;
      }
    }
    return null;
  }

  private async mergeDeltaClosedSchedulerSnapshot(input: {
    userId: string;
    accountId: string;
    staleRowId: string;
    staleExternalId: string;
    lifecycleExternalId: string;
    statusRank: number;
    observedAt: Date;
    payloadJson: string;
    payloadHash: string;
  }): Promise<boolean> {
    const existingRows = (await coreDataSource.query(
      `SELECT id
         FROM scheduler_positions_snapshots
        WHERE user_id = ?
          AND account_id = ?
          AND external_id = ?
        LIMIT 1`,
      [input.userId, input.accountId, input.lifecycleExternalId]
    )) as Array<{ id?: string }>;
    const existingId = String(existingRows[0]?.id || '').trim();

    if (existingId && existingId !== input.staleRowId) {
      await coreDataSource.query(
        `UPDATE scheduler_positions_snapshots
            SET status = IF(status_rank <= ?, 'CLOSED', status),
                status_rank = GREATEST(status_rank, ?),
                last_seen_at = IF(last_seen_at IS NULL OR ? > last_seen_at, ?, last_seen_at),
                updated_at = NOW()
          WHERE id = ?`,
        [input.statusRank, input.statusRank, input.observedAt, input.observedAt, existingId]
      );
      await coreDataSource.query(
        `DELETE FROM scheduler_positions_snapshots
          WHERE id = ?`,
        [input.staleRowId]
      );
      return true;
    }

    await coreDataSource.query(
      `UPDATE scheduler_positions_snapshots
          SET external_id = ?,
              status = 'CLOSED',
              status_rank = ?,
              payload_json = ?,
              payload_hash = ?,
              last_seen_at = ?,
              updated_at = NOW()
        WHERE id = ?`,
      [
        input.lifecycleExternalId,
        input.statusRank,
        input.payloadJson,
        input.payloadHash,
        input.observedAt,
        input.staleRowId,
      ]
    );
    return false;
  }
}
