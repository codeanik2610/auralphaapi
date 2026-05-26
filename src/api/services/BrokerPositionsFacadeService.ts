import { Inject, Service } from 'typedi';
import { BrokerAccountRoutingService } from '../../brokers';
import { BrokerRuntimeRegistry } from '../../brokers';
import {
  ActivityRepository,
  AssetPriceRepository,
  AlertRepository,
  BrokerAccountRepository,
  PaperOrderRepository,
  PositionReadModelRepository,
  SuggestedTradeRepository,
} from '../../database';
import { PaperOrder, SuggestedTrade } from '../../database';
import { ActivityLog } from '../../database/entities/ActivityLog';
import { coreDataSource } from '../../database/data-source';
import {
  PositionLifecycleFreshness,
  PositionLifecycleAccountContext,
  PositionLifecycleActivityItem,
  PositionLifecycleAlertItem,
  PositionLifecycleEventItem,
  PositionLifecycleOrderItem,
  PositionLifecycleResponse,
  PositionLifecycleSuggestedTradeItem,
  PositionExecutionProtectionContext,
  PositionsAccountFreshness,
  PositionsFreshnessIndicator,
  PositionsFreshnessState,
  PositionRecord,
  PositionSummary,
  PositionsAccountItem,
  PositionsGroupedFreshnessSummary,
  PositionsGroupedResponse,
  PositionsRefreshRequestResponse,
  PositionsSyncStatusItem,
  PositionsSyncStatusResponse,
} from '../contracts/Positions';
import type { SuggestedTradeRouteAttempt } from '../contracts/SuggestedTrade';
import {
  AddMarginBody,
  ClosePartialPositionBody,
  CreateRiskOrderBody,
  PositionLiqPriceQuery,
  PositionsQuery,
  PositionsHistoryQuery,
  PositionsRefreshBody,
  UpdateRiskOrderBody,
  validatePositionId,
  validatePositionsQuery,
  validatePositionsHistoryQuery,
  validatePositionsRefreshBody,
} from '../validators/positions.validator';
import { InternalPositionsSyncService } from './InternalPositionsSyncService';
import { MarketPriceRefreshService } from './MarketPriceRefreshService';
import { OperationalEventService } from './OperationalEventService';
import { UserTimeZoneService } from './UserTimeZoneService';
import { getUtcDateRangeFromLocalDates } from '../utils/timezone';
import { buildProductOwnedPositionsSyncRequest } from '../utils/positionsOrdersSyncScopeContract';
import { NotFoundAppError } from '../errors/AppError';
import { LinkedEntityReference } from '../contracts/UiState';
import { env } from '../../env';

@Service()
export class BrokerPositionsFacadeService {
  @Inject(() => BrokerRuntimeRegistry)
  private brokerRuntimeRegistry!: BrokerRuntimeRegistry;

  @Inject(() => BrokerAccountRoutingService)
  private brokerAccountRoutingService!: BrokerAccountRoutingService;

  @Inject(() => BrokerAccountRepository)
  private brokerAccountRepository!: BrokerAccountRepository;

  @Inject(() => PositionReadModelRepository)
  private positionReadModelRepository!: PositionReadModelRepository;

  @Inject(() => AlertRepository)
  private alertRepository!: AlertRepository;

  @Inject(() => ActivityRepository)
  private activityRepository!: ActivityRepository;

  @Inject(() => SuggestedTradeRepository)
  private suggestedTradeRepository!: SuggestedTradeRepository;

  @Inject(() => PaperOrderRepository)
  private paperOrderRepository!: PaperOrderRepository;

  @Inject(() => AssetPriceRepository)
  private assetPriceRepository!: AssetPriceRepository;

  @Inject(() => MarketPriceRefreshService)
  private marketPriceRefreshService!: MarketPriceRefreshService;

  @Inject(() => OperationalEventService)
  private operationalEventService!: OperationalEventService;

  @Inject(() => UserTimeZoneService)
  private userTimeZoneService!: UserTimeZoneService;

  @Inject(() => InternalPositionsSyncService)
  private internalPositionsSyncService!: InternalPositionsSyncService;

  private parsePayloadJson(value: unknown): unknown {
    if (!value) {
      return {};
    }
    if (typeof value === 'object') {
      return value;
    }
    try {
      return JSON.parse(String(value));
    } catch {
      return {};
    }
  }

  private toRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    return value as Record<string, unknown>;
  }

  private pickFirst(record: Record<string, unknown>, keys: string[]): unknown {
    for (const key of keys) {
      if (record[key] !== undefined && record[key] !== null && record[key] !== '') {
        return record[key];
      }
    }
    return undefined;
  }

  private toNumber(value: unknown): number | null {
    if (value === null || value === undefined) {
      return null;
    }
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null;
    }
    if (typeof value === 'bigint') {
      return Number(value);
    }
    const raw = String(value).trim();
    if (!raw || raw === '--') {
      return null;
    }
    const cleaned = raw.replace(/[^0-9.+-]/g, '');
    if (!cleaned) {
      return null;
    }
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private toIsoString(value: unknown): string | undefined {
    if (!value) {
      return undefined;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) {
        return undefined;
      }
      const parsed = new Date(trimmed);
      return Number.isNaN(parsed.getTime()) ? trimmed : parsed.toISOString();
    }
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
    }
    const parsed = new Date(String(value));
    return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
  }

  private readString(value: unknown): string {
    return String(value || '').trim();
  }

  private applyLimit(raw: unknown, limit?: number): unknown {
    if (!limit) return raw;

    if (Array.isArray(raw)) {
      return raw.slice(0, limit);
    }

    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const data = (raw as { data?: unknown }).data;
      if (Array.isArray(data)) {
        return { ...(raw as Record<string, unknown>), data: data.slice(0, limit) };
      }
    }

    return raw;
  }

  private buildActivityRouteTarget(
    brokerKey?: string | null,
    accountId?: string | null
  ): string | null {
    const parts = [this.readString(brokerKey), this.readString(accountId)].filter(Boolean);
    return parts.length ? parts.join(' · ') : null;
  }

  private extractActionResultData(result: unknown): unknown {
    const record = this.toRecord(result);
    if (!record) {
      return result;
    }

    if (record.data !== undefined) {
      return record.data;
    }

    return result;
  }

  private buildPositionActionFlag(
    id: string,
    channel: string,
    message: string | null,
    status: string
  ): NonNullable<ActivityLog['flags']>[number] | null {
    const normalizedMessage = this.readString(message);
    if (!normalizedMessage) {
      return null;
    }

    return {
      id,
      channel,
      message: normalizedMessage,
      time: new Date().toISOString(),
      status,
    };
  }

  private buildPositionActionRequestMessages(
    actionKey:
      | 'add-margin'
      | 'risk-order-create'
      | 'risk-order-update'
      | 'reverse'
      | 'close-partial'
      | 'close',
    payload?: Record<string, unknown> | null
  ): string[] {
    if (actionKey === 'reverse') {
      return ['Requested direction reversal for the current position'];
    }

    if (actionKey === 'close') {
      return ['Requested full close for the current position'];
    }

    if (!payload) {
      return [];
    }

    if (actionKey === 'add-margin') {
      return [
        this.readString(payload.margin) ? `Margin +${this.readString(payload.margin)}` : '',
      ].filter(Boolean);
    }

    if (actionKey === 'risk-order-create') {
      return [
        this.readString(payload.stoploss_price)
          ? `Stop loss ${this.readString(payload.stoploss_price)}`
          : '',
        this.readString(payload.takeprofit_price)
          ? `Take profit ${this.readString(payload.takeprofit_price)}`
          : '',
        this.readString(payload.order_source)
          ? `Source ${this.readString(payload.order_source)}`
          : '',
      ].filter(Boolean);
    }

    if (actionKey === 'risk-order-update') {
      return [
        payload.order_price !== undefined && payload.order_price !== null
          ? `Reference ${this.readString(payload.order_price)}`
          : '',
        payload.stoploss_price !== undefined && payload.stoploss_price !== null
          ? `Stop loss ${this.readString(payload.stoploss_price)}`
          : '',
        payload.takeprofit_price !== undefined && payload.takeprofit_price !== null
          ? `Take profit ${this.readString(payload.takeprofit_price)}`
          : '',
        this.readString(payload.trigger_type)
          ? `Trigger ${this.readString(payload.trigger_type)}`
          : '',
      ].filter(Boolean);
    }

    if (actionKey === 'close-partial') {
      return [
        this.readString(payload.quantity) ? `Quantity ${this.readString(payload.quantity)}` : '',
        this.readString(payload.order_type) ? `Order ${this.readString(payload.order_type)}` : '',
        this.readString(payload.limit_price) ? `Limit ${this.readString(payload.limit_price)}` : '',
      ].filter(Boolean);
    }

    return [];
  }

  private buildPositionActionResultMessages(result: unknown): string[] {
    const resolvedResult = this.extractActionResultData(result);
    const resultRecord = this.toRecord(resolvedResult);
    if (!resultRecord) {
      if (typeof resolvedResult === 'boolean') {
        return [resolvedResult ? 'Broker acknowledged the request' : 'Broker returned false'];
      }
      return this.readString(resolvedResult) ? [this.readString(resolvedResult)] : [];
    }

    const primaryMessage = this.readString(
      this.pickFirst(resultRecord, ['message', 'detail', 'statusText'])
    );
    const status = this.readString(this.pickFirst(resultRecord, ['status', 'state']));
    const reference = this.readString(
      this.pickFirst(resultRecord, ['position_id', 'positionId', 'id'])
    );
    const liquidation = this.readString(
      this.pickFirst(resultRecord, ['liquidation_price', 'liquidationPrice'])
    );

    const normalized: string[] = [];
    if (primaryMessage) {
      normalized.push(primaryMessage);
    }
    if (status) {
      normalized.push(`Status ${status}`);
    }
    if (reference) {
      normalized.push(`Reference ${reference}`);
    }
    if (liquidation) {
      normalized.push(`Liquidation ${liquidation}`);
    }
    return normalized;
  }

  private async getPositionActionSnapshot(
    userId: string,
    positionId: string,
    route: { brokerKey?: string | null; accountId?: string | null }
  ): Promise<PositionRecord | null> {
    const resolvedAccountId = this.readString(route.accountId);
    const resolvedBrokerKey = this.readString(route.brokerKey).toLowerCase();
    if (!resolvedAccountId || !resolvedBrokerKey) {
      return null;
    }

    try {
      await this.positionReadModelRepository.ensureHydratedFromSnapshots(userId, [
        resolvedAccountId,
      ]);
      return (
        (await this.positionReadModelRepository.getPositionByExternalId(
          userId,
          resolvedAccountId,
          positionId,
          resolvedBrokerKey
        )) || null
      );
    } catch {
      return null;
    }
  }

  private getPositionActionPayload(
    snapshot: PositionRecord | null
  ): Record<string, unknown> | null {
    if (!snapshot) {
      return null;
    }
    return this.toRecord((snapshot as Record<string, unknown>).rawPayload);
  }

  private resolveBrokerActionPositionId(
    requestedPositionId: string,
    snapshot: PositionRecord | null,
    route: { brokerKey?: string | null }
  ): string {
    const resolvedBrokerKey = this.readString(route.brokerKey).toLowerCase();
    if (resolvedBrokerKey !== 'mudrex') {
      return requestedPositionId;
    }

    const payload = this.getPositionActionPayload(snapshot);
    const nativePositionId = this.readString(
      this.pickFirst(payload || {}, ['id', 'position_id', 'positionId'])
    );
    return nativePositionId || requestedPositionId;
  }

  private isIgnorableProtectionCancelError(error: unknown): boolean {
    const message = String(error instanceof Error ? error.message : error || '')
      .trim()
      .toLowerCase();
    if (!message) {
      return false;
    }
    return (
      message.includes('not found') ||
      message.includes('open_order_not_found') ||
      message.includes('already') ||
      message.includes('closed') ||
      message.includes('cancelled') ||
      message.includes('canceled') ||
      message.includes('terminal')
    );
  }

  private async cleanupProtectionOrdersAfterPositionClose(
    route: { brokerKey?: string; accountId?: string; userId?: string },
    snapshot: PositionRecord | null
  ): Promise<string[]> {
    const resolvedBrokerKey = this.readString(route.brokerKey);
    const trackedOrderIds = snapshot ? this.getTrackedOrderIds(snapshot) : [];
    if (!resolvedBrokerKey || !trackedOrderIds.length) {
      return [];
    }

    const messages: string[] = [];
    const ordersAdapter = this.brokerRuntimeRegistry.getOrdersAdapter(resolvedBrokerKey);

    for (const orderId of trackedOrderIds) {
      try {
        await ordersAdapter.cancelOrder(orderId, route);
        messages.push(`Protection cancel submitted ${orderId}`);
      } catch (error) {
        if (this.isIgnorableProtectionCancelError(error)) {
          messages.push(`Protection already inactive ${orderId}`);
          continue;
        }

        const message = this.readString(error instanceof Error ? error.message : error);
        if (message) {
          messages.push(`Protection cleanup pending ${orderId}: ${message}`);
        }
      }
    }

    return messages;
  }

  private async executePositionActionWithAudit(params: {
    actionKey:
      | 'add-margin'
      | 'risk-order-create'
      | 'risk-order-update'
      | 'reverse'
      | 'close-partial'
      | 'close';
    successTitle: string;
    successDescription: string;
    failureTitle: string;
    failureAlertLabel: string;
    positionId: string;
    payload?: Record<string, unknown> | null;
    userId: string;
    brokerKey?: string;
    accountId?: string;
    execute: (
      route: { brokerKey?: string; accountId?: string; userId?: string },
      resolvedPositionId: string,
      snapshot: PositionRecord | null
    ) => Promise<unknown>;
  }): Promise<unknown> {
    const route = await this.brokerAccountRoutingService.resolve(
      params.userId,
      params.brokerKey,
      params.accountId,
      'mudrex'
    );
    const routeTarget =
      this.buildActivityRouteTarget(route.brokerKey, route.accountId) ||
      this.readString(route.brokerKey) ||
      'positions';
    const snapshot = await this.getPositionActionSnapshot(params.userId, params.positionId, route);
    const executionRoute = {
      ...route,
      userId: params.userId,
    };
    const resolvedPositionId = this.resolveBrokerActionPositionId(
      params.positionId,
      snapshot,
      executionRoute
    );
    const symbol = this.readString(snapshot?.symbol);

    try {
      const result = await params.execute(executionRoute, resolvedPositionId, snapshot);
      const protectionCleanupMessages =
        params.actionKey === 'close'
          ? await this.cleanupProtectionOrdersAfterPositionClose(executionRoute, snapshot)
          : [];
      const flags = [
        this.buildPositionActionFlag('route', 'Route', routeTarget, 'Success'),
        this.buildPositionActionFlag(
          'position',
          'Context',
          symbol ? `${params.positionId} · ${symbol}` : params.positionId,
          'Success'
        ),
        ...this.buildPositionActionRequestMessages(params.actionKey, params.payload).map(
          (message, index) =>
            this.buildPositionActionFlag(`request-${index + 1}`, 'Request', message, 'Success')
        ),
        ...[...this.buildPositionActionResultMessages(result), ...protectionCleanupMessages].map(
          (message, index) =>
            this.buildPositionActionFlag(`result-${index + 1}`, 'Result', message, 'Success')
        ),
      ].filter((flag): flag is NonNullable<ActivityLog['flags']>[number] => Boolean(flag));

      await this.operationalEventService.logActivity(params.userId, {
        type: 'Position',
        title: params.successTitle,
        status: 'Success',
        route: 'Positions',
        stream: 'Execution',
        related: routeTarget,
        referenceId: params.positionId,
        correlationId: routeTarget,
        symbol: symbol || undefined,
        description: params.successDescription,
        flags,
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const flags = [
        this.buildPositionActionFlag('route', 'Route', routeTarget, 'Failed'),
        this.buildPositionActionFlag(
          'position',
          'Context',
          symbol ? `${params.positionId} · ${symbol}` : params.positionId,
          'Failed'
        ),
        ...this.buildPositionActionRequestMessages(params.actionKey, params.payload).map(
          (flagMessage, index) =>
            this.buildPositionActionFlag(`request-${index + 1}`, 'Request', flagMessage, 'Failed')
        ),
        this.buildPositionActionFlag('error', 'Result', message, 'Failed'),
      ].filter((flag): flag is NonNullable<ActivityLog['flags']>[number] => Boolean(flag));

      await this.operationalEventService.logActivity(params.userId, {
        type: 'Position',
        title: params.failureTitle,
        status: 'Failed',
        route: 'Positions',
        stream: 'Execution',
        related: routeTarget,
        referenceId: params.positionId,
        correlationId: routeTarget,
        symbol: symbol || undefined,
        description: message,
        flags,
      });
      await this.operationalEventService.emitFailureAlert(params.userId, {
        channel: 'Trading',
        source: this.readString(route.brokerKey) || params.brokerKey || 'positions',
        message: `${params.failureAlertLabel} (${params.positionId}): ${message}`,
        route: 'Risk review',
        symbol: symbol || undefined,
      });
      throw error;
    }
  }

  private normalizeMarketSymbol(value: unknown): string | null {
    const raw = String(value || '')
      .trim()
      .toUpperCase();
    if (!raw) return null;
    if (raw.endsWith('USDT')) return raw;
    if (raw.endsWith('USD')) return `${raw.slice(0, -3)}USDT`;
    // Most futures symbols we track are quoted in USDT (BTCUSDT, ETHUSDT).
    if (/^[A-Z0-9]{2,20}$/.test(raw)) return `${raw}USDT`;
    return raw;
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

  private resolvePositionSide(position: Record<string, unknown>): {
    label: string;
    raw: string | null;
    key: string;
  } {
    const raw = String(
      this.pickFirst(position, [
        'side',
        'position_type',
        'order_type',
        'orderType',
        'positionSide',
        'position_side',
      ]) || ''
    )
      .trim()
      .toLowerCase();

    if (raw === 'buy' || raw === 'long') {
      return { label: 'Long', raw: raw || null, key: 'long' };
    }
    if (raw === 'sell' || raw === 'short') {
      return { label: 'Short', raw: raw || null, key: 'short' };
    }

    const quantity = this.toNumber(
      this.pickFirst(position, ['quantity', 'size', 'qty', 'position_size', 'net_quantity'])
    );
    if (quantity !== null && quantity < 0) {
      return { label: 'Short', raw: raw || null, key: 'short' };
    }
    if (quantity !== null && quantity >= 0) {
      return { label: 'Long', raw: raw || null, key: 'long' };
    }
    return { label: '--', raw: raw || null, key: 'unknown' };
  }

  private normalizeStatus(value: unknown): { label: string; raw: string | null; key: string } {
    const rawText = String(value || '').trim();
    const key = rawText.toLowerCase().replace(/\s+/g, '_').replace(/-+/g, '_');

    if (['open', 'active', 'live', 'running'].includes(key)) {
      return { label: 'Open', raw: rawText || null, key: 'open' };
    }
    if (['closed', 'filled', 'done', 'completed'].includes(key)) {
      return { label: 'Closed', raw: rawText || null, key: 'closed' };
    }
    if (['liquidated', 'liquidation', 'forced'].includes(key)) {
      return { label: 'Liquidated', raw: rawText || null, key: 'liquidated' };
    }
    return {
      label: rawText || '--',
      raw: rawText || null,
      key: key || 'unknown',
    };
  }

  private buildPositionSummary(record: Record<string, unknown>): PositionSummary {
    const id = String(
      this.pickFirst(record, ['id', 'external_id', 'externalId', 'position_id', 'positionId']) || ''
    ).trim();
    const externalId = String(
      this.pickFirst(record, ['external_id', 'externalId', 'position_id', 'positionId', 'id']) || ''
    ).trim();
    const symbolValue = this.pickFirst(record, [
      'symbol',
      'product_symbol',
      'productSymbol',
      'instrument',
      'market',
    ]);
    const symbol =
      symbolValue === undefined || symbolValue === null || String(symbolValue).trim() === ''
        ? null
        : String(symbolValue).trim();
    const side = this.resolvePositionSide(record);
    const status = this.normalizeStatus(
      this.pickFirst(record, ['status', 'state', 'position_status'])
    );
    const signedQuantity = this.toNumber(
      this.pickFirst(record, ['quantity', 'size', 'qty', 'position_size', 'net_quantity'])
    );
    const quantity = signedQuantity === null ? null : Math.abs(signedQuantity);
    const entryPrice = this.toNumber(
      this.pickFirst(record, [
        'entry_price',
        'entry',
        'avg_entry',
        'avg_entry_price',
        'average_entry_price',
        'entryPrice',
      ])
    );
    const currentPrice = this.toNumber(
      this.pickFirst(record, ['current_price', 'mark_price', 'price', 'currentPrice', 'markPrice'])
    );
    const closedPrice = this.toNumber(
      this.pickFirst(record, [
        'closed_price',
        'close_price',
        'exit_price',
        'exitPrice',
        'closedPrice',
      ])
    );
    const leverage = this.toNumber(
      this.pickFirst(record, ['leverage', 'position_leverage', 'leverageValue'])
    );
    const liquidationPrice = this.toNumber(
      this.pickFirst(record, ['liquidation_price', 'liq_price', 'liquidationPrice'])
    );
    const createdAt = this.toIsoString(this.pickFirst(record, ['created_at', 'createdAt']));
    const closedAt = this.toIsoString(this.pickFirst(record, ['closed_at', 'closedAt']));
    const updatedAt = this.toIsoString(
      this.pickFirst(record, [
        'updated_at',
        'updatedAt',
        'closed_at',
        'closedAt',
        'created_at',
        'createdAt',
      ])
    );
    const unrealizedPnlExplicit = this.toNumber(
      this.pickFirst(record, ['unrealized_pnl', 'unrealized', 'unrealizedPnl', 'pnl_unrealized'])
    );
    const realizedPnlExplicit = this.toNumber(
      this.pickFirst(record, ['realized_pnl', 'realized', 'realizedPnl', 'pnl_realized'])
    );
    const fallbackRealized =
      status.key === 'closed' || status.key === 'liquidated'
        ? this.toNumber(this.pickFirst(record, ['pnl']))
        : null;
    const exposure =
      entryPrice !== null && quantity !== null ? Math.abs(entryPrice * quantity) : null;
    const unrealizedPnl = (() => {
      if (unrealizedPnlExplicit !== null) {
        return unrealizedPnlExplicit;
      }
      if (entryPrice === null || currentPrice === null || quantity === null) {
        return null;
      }
      const direction = side.key === 'short' ? -1 : 1;
      return direction * (currentPrice - entryPrice) * quantity;
    })();

    return {
      id: id || externalId,
      externalId: externalId || undefined,
      symbol,
      side: side.label,
      sideKey: side.key,
      status: status.label,
      statusKey: status.key,
      quantity,
      entryPrice,
      currentPrice,
      closedPrice,
      unrealizedPnl,
      realizedPnl: realizedPnlExplicit ?? fallbackRealized,
      leverage,
      liquidationPrice,
      exposure,
      createdAt,
      updatedAt,
      closedAt,
    };
  }

  private normalizePositionRecord(
    value: unknown,
    metadata?: Partial<
      Pick<PositionRecord, 'accountId' | 'accountName' | 'accountKey' | 'brokerKey'>
    >
  ): PositionRecord {
    const record = this.toRecord(value) || {};
    const summary = this.buildPositionSummary(record);
    const normalizedId =
      summary.id ||
      [
        summary.symbol || 'position',
        metadata?.accountId || 'account',
        summary.createdAt || summary.updatedAt || 'unknown',
      ].join(':');

    return {
      ...record,
      ...(metadata || {}),
      id: normalizedId,
      external_id:
        summary.externalId || String(record.external_id || record.externalId || normalizedId),
      externalId:
        summary.externalId || String(record.externalId || record.external_id || normalizedId),
      symbol: summary.symbol,
      side: summary.side,
      side_raw: this.resolvePositionSide(record).raw,
      sideKey: summary.sideKey,
      status: summary.status,
      status_raw: this.normalizeStatus(
        this.pickFirst(record, ['status', 'state', 'position_status'])
      ).raw,
      statusKey: summary.statusKey,
      quantity: summary.quantity,
      quantity_raw: this.pickFirst(record, [
        'quantity',
        'size',
        'qty',
        'position_size',
        'net_quantity',
      ]),
      entry_price: summary.entryPrice,
      current_price: summary.currentPrice,
      closed_price: summary.closedPrice,
      unrealized_pnl: summary.unrealizedPnl,
      realized_pnl: summary.realizedPnl,
      realized: summary.realizedPnl,
      leverage: summary.leverage,
      liquidation_price: summary.liquidationPrice,
      exposure: summary.exposure,
      created_at: summary.createdAt,
      updated_at: summary.updatedAt,
      closed_at: summary.closedAt,
      positionSummary: summary,
    };
  }

  private toTimestamp(value: unknown): number | null {
    if (!value) {
      return null;
    }

    const timestamp = value instanceof Date ? value.getTime() : new Date(String(value)).getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  private formatRelativeAge(freshnessMs: number | null): string | null {
    if (freshnessMs === null || !Number.isFinite(freshnessMs)) {
      return null;
    }
    if (freshnessMs < 60 * 1000) {
      return 'just now';
    }
    if (freshnessMs < 60 * 60 * 1000) {
      return `${Math.floor(freshnessMs / (60 * 1000))}m ago`;
    }
    if (freshnessMs < 24 * 60 * 60 * 1000) {
      return `${Math.floor(freshnessMs / (60 * 60 * 1000))}h ago`;
    }
    return `${Math.floor(freshnessMs / (24 * 60 * 60 * 1000))}d ago`;
  }

  private buildFreshnessIndicator(
    observedAt: unknown,
    staleAfterMs: number | null,
    criticalAfterMs: number | null,
    source: string
  ): PositionsFreshnessIndicator {
    const observedIso = this.toIsoString(observedAt) || null;
    const observedMs = observedIso ? this.toTimestamp(observedIso) : null;
    const freshnessMs = observedMs !== null ? Math.max(0, Date.now() - observedMs) : null;
    const state: PositionsFreshnessState =
      freshnessMs === null
        ? 'unknown'
        : criticalAfterMs !== null && freshnessMs > criticalAfterMs
          ? 'critical'
          : staleAfterMs !== null && freshnessMs > staleAfterMs
            ? 'stale'
            : 'fresh';

    return {
      state,
      observedAt: observedIso,
      freshnessMs,
      staleAfterMs,
      criticalAfterMs,
      isStale: state === 'stale' || state === 'critical',
      isCritical: state === 'critical',
      source,
    };
  }

  private getPositionObservedAt(position: PositionRecord): string | null {
    return (
      this.toIsoString(
        position.last_seen_at ?? position.updated_at ?? position.closed_at ?? position.created_at
      ) || null
    );
  }

  private withPositionFreshness(
    positions: PositionRecord[],
    options: {
      source: string;
      staleAfterMs: number | null;
      criticalAfterMs: number | null;
    }
  ): PositionRecord[] {
    return positions.map((item) => ({
      ...item,
      freshness: this.buildFreshnessIndicator(
        this.getPositionObservedAt(item),
        options.staleAfterMs,
        options.criticalAfterMs,
        options.source
      ),
    }));
  }

  private buildAccountFreshness(
    account: {
      accountName?: string;
      accountKey?: string;
    },
    freshnessRow?: {
      observedAt?: Date | null;
      checkpointAt?: Date | null;
      openPositions?: number;
      totalRows?: number;
    } | null
  ): PositionsAccountFreshness | null {
    if (!freshnessRow?.observedAt && !freshnessRow?.checkpointAt) {
      return null;
    }

    let accountFreshness = this.buildFreshnessIndicator(
      freshnessRow?.observedAt || null,
      env.positions.liveSnapshotStaleAfterMs,
      env.positions.liveSnapshotCriticalAfterMs,
      'position_snapshot'
    );
    const checkpointFreshness = this.buildFreshnessIndicator(
      freshnessRow?.checkpointAt || null,
      env.positions.syncCheckpointStaleAfterMs,
      env.positions.syncCheckpointCriticalAfterMs,
      'sync_checkpoint'
    );
    const openPositions = Number(freshnessRow?.openPositions);
    const hasNoOpenPositions = Number.isFinite(openPositions) && openPositions <= 0;
    const syncedNoOpenPositions = hasNoOpenPositions && checkpointFreshness.state === 'fresh';
    if (syncedNoOpenPositions) {
      accountFreshness = {
        ...checkpointFreshness,
        source: 'sync_checkpoint_no_open_positions',
      };
    }
    const accountLabel = account.accountName || account.accountKey || 'this account';
    let warning: string | null = null;

    if (syncedNoOpenPositions) {
      warning = null;
    } else if (accountFreshness.state === 'critical') {
      const age = this.formatRelativeAge(accountFreshness.freshnessMs) || 'a while ago';
      warning = `Live snapshot for ${accountLabel} was last observed ${age}. This desk may be materially behind the broker route.`;
    } else if (accountFreshness.state === 'stale') {
      const age = this.formatRelativeAge(accountFreshness.freshnessMs) || 'recently';
      warning = `Live snapshot for ${accountLabel} was last observed ${age}. Recent broker writes can still be catching up.`;
    } else if (accountFreshness.state === 'unknown' && checkpointFreshness.state !== 'unknown') {
      const age = this.formatRelativeAge(checkpointFreshness.freshnessMs) || 'recently';
      warning = `No visible position snapshot timestamp is available for ${accountLabel} yet. The latest sync checkpoint was ${age}.`;
    }

    return {
      account: accountFreshness,
      checkpoint: checkpointFreshness.state === 'unknown' ? null : checkpointFreshness,
      warning,
    };
  }

  private summarizeGroupedFreshness(
    items: PositionsAccountItem[]
  ): PositionsGroupedFreshnessSummary | null {
    if (!items.length) {
      return {
        observedAt: null,
        attentionObservedAt: null,
        freshAccounts: 0,
        staleAccounts: 0,
        criticalAccounts: 0,
        unknownAccounts: 0,
        warning: null,
      };
    }

    let observedAt: string | null = null;
    let observedTimestamp = 0;
    let attentionObservedAt: string | null = null;
    let attentionObservedTimestamp: number | null = null;
    let freshAccounts = 0;
    let staleAccounts = 0;
    let criticalAccounts = 0;
    let unknownAccounts = 0;

    items.forEach((item) => {
      const state = item.freshness?.account?.state || 'unknown';
      if (state === 'critical') {
        criticalAccounts += 1;
      } else if (state === 'stale') {
        staleAccounts += 1;
      } else if (state === 'fresh') {
        freshAccounts += 1;
      } else {
        unknownAccounts += 1;
      }

      const candidate = item.freshness?.account?.observedAt || null;
      const candidateTimestamp = candidate ? this.toTimestamp(candidate) : null;
      if (candidate && candidateTimestamp !== null && candidateTimestamp > observedTimestamp) {
        observedTimestamp = candidateTimestamp;
        observedAt = candidate;
      }
      if (
        candidate &&
        candidateTimestamp !== null &&
        (state === 'critical' || state === 'stale') &&
        (attentionObservedTimestamp === null || candidateTimestamp < attentionObservedTimestamp)
      ) {
        attentionObservedTimestamp = candidateTimestamp;
        attentionObservedAt = candidate;
      }
    });

    const warning =
      criticalAccounts > 0
        ? `${criticalAccounts} account${criticalAccounts === 1 ? ' has' : 's have'} critically old position snapshots on the live desk.`
        : staleAccounts > 0
          ? `${staleAccounts} account${staleAccounts === 1 ? ' has' : 's have'} lagging position snapshots on the live desk.`
          : unknownAccounts > 0
            ? `${unknownAccounts} account${unknownAccounts === 1 ? ' has' : 's have'} no visible position snapshot timestamp yet.`
            : null;

    return {
      observedAt,
      attentionObservedAt,
      freshAccounts,
      staleAccounts,
      criticalAccounts,
      unknownAccounts,
      warning,
    };
  }

  private isMissingTableError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }

    return String((error as { code?: unknown }).code || '') === 'ER_NO_SUCH_TABLE';
  }

  private async listPendingSyncStateByAccountId(accountIds: string[]): Promise<
    Map<
      string,
      {
        pendingRecords: number;
        failedRecords: number;
        resolvedRecords: number;
        nextRetryAt: string | null;
        lastPendingUpdateAt: string | null;
      }
    >
  > {
    const normalizedAccountIds = Array.from(
      new Set(accountIds.map((item) => this.readString(item)).filter(Boolean))
    );
    if (!normalizedAccountIds.length) {
      return new Map();
    }

    try {
      const rows = (await coreDataSource.query(
        `SELECT
           account_id AS accountId,
           COALESCE(SUM(CASE WHEN LOWER(status) IN ('pending', 'failed') THEN 1 ELSE 0 END), 0) AS pendingRecords,
           COALESCE(SUM(CASE WHEN LOWER(status) = 'failed' THEN 1 ELSE 0 END), 0) AS failedRecords,
           COALESCE(SUM(CASE WHEN LOWER(status) = 'resolved' THEN 1 ELSE 0 END), 0) AS resolvedRecords,
           MIN(CASE WHEN LOWER(status) IN ('pending', 'failed') THEN next_retry_at ELSE NULL END) AS nextRetryAt,
           MAX(updated_at) AS lastPendingUpdateAt
         FROM scheduler_sync_pending_records
         WHERE scheduler_key = ?
           AND account_id IN (${normalizedAccountIds.map(() => '?').join(', ')})
         GROUP BY account_id`,
        ['positions-sync', ...normalizedAccountIds]
      )) as Array<{
        accountId?: string;
        pendingRecords?: number | string;
        failedRecords?: number | string;
        resolvedRecords?: number | string;
        nextRetryAt?: Date | string | null;
        lastPendingUpdateAt?: Date | string | null;
      }>;

      return new Map(
        rows
          .map((row) => {
            const accountId = this.readString(row.accountId);
            if (!accountId) {
              return null;
            }

            return [
              accountId,
              {
                pendingRecords: Number(row.pendingRecords || 0),
                failedRecords: Number(row.failedRecords || 0),
                resolvedRecords: Number(row.resolvedRecords || 0),
                nextRetryAt: this.toIsoString(row.nextRetryAt) || null,
                lastPendingUpdateAt: this.toIsoString(row.lastPendingUpdateAt) || null,
              },
            ] as const;
          })
          .filter(
            (
              entry
            ): entry is readonly [
              string,
              {
                pendingRecords: number;
                failedRecords: number;
                resolvedRecords: number;
                nextRetryAt: string | null;
                lastPendingUpdateAt: string | null;
              },
            ] => Boolean(entry)
          )
      );
    } catch (error) {
      if (!this.isMissingTableError(error)) {
        throw error;
      }
      return new Map();
    }
  }

  private getPositionsSyncScope(
    brokerKey?: string,
    accountId?: string
  ): 'desk' | 'broker' | 'account' {
    if (accountId) {
      return 'account';
    }
    if (brokerKey) {
      return 'broker';
    }
    return 'desk';
  }

  private buildPositionsSyncSummary(
    items: PositionsSyncStatusItem[],
    freshness: PositionsGroupedResponse['freshness'] | null,
    failedRecords: number,
    pendingRecords: number
  ): {
    state: PositionsSyncStatusResponse['state'];
    label: string;
    summary: string;
  } {
    if (!items.length) {
      return {
        state: 'idle',
        label: 'No routes',
        summary:
          'No connected or idle broker routes are available for positions sync on this desk.',
      };
    }

    const criticalAccounts = freshness?.criticalAccounts || 0;
    const staleAccounts = freshness?.staleAccounts || 0;

    if (failedRecords > 0 || criticalAccounts > 0) {
      return {
        state: 'attention',
        label: 'Needs attention',
        summary:
          failedRecords > 0
            ? `${failedRecords} sync record${failedRecords === 1 ? '' : 's'} still need operator attention on the live desk.`
            : `${criticalAccounts} route${criticalAccounts === 1 ? ' is' : 's are'} backed by critically old position snapshots.`,
      };
    }

    if (pendingRecords > 0 || staleAccounts > 0) {
      return {
        state: 'attention',
        label: 'Catching up',
        summary:
          pendingRecords > 0
            ? `${pendingRecords} sync record${pendingRecords === 1 ? '' : 's'} are still retrying in the background.`
            : `${staleAccounts} route${staleAccounts === 1 ? ' is' : 's are'} lagging and still catching up to broker state.`,
      };
    }

    return {
      state: 'healthy',
      label: 'Healthy',
      summary:
        'Connected broker routes are aligned with the latest visible position snapshots and checkpoints.',
    };
  }

  private readBoolean(value: unknown): boolean {
    if (typeof value === 'boolean') {
      return value;
    }
    const normalized = String(value ?? '')
      .trim()
      .toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes';
  }

  private getTrackedOrderIds(position: PositionRecord): string[] {
    return Array.from(
      new Set(
        [
          this.readString(position.stoploss_order_id),
          this.readString(position.takeprofit_order_id),
          this.readString(position.stopLossOrderId),
          this.readString(position.takeProfitOrderId),
        ].filter((value): value is string => Boolean(value))
      )
    );
  }

  private addLifecycleIdentifier(identifiers: Set<string>, value: unknown): void {
    const normalized = this.readString(value).toLowerCase();
    if (normalized) {
      identifiers.add(normalized);
    }
  }

  private getPositionLifecycleIdentifiers(position: PositionRecord): Set<string> {
    const identifiers = new Set<string>();
    const rawPayload = this.toRecord((position as Record<string, unknown>).rawPayload);
    const summary = this.toRecord(position.positionSummary);

    [
      position.id,
      position.external_id,
      position.externalId,
      this.pickFirst(rawPayload || {}, [
        'id',
        'external_id',
        'externalId',
        'position_id',
        'positionId',
        'position_uuid',
        'positionUuid',
        'future_position_uuid',
        'futurePositionUuid',
      ]),
      this.pickFirst(summary || {}, ['id', 'externalId', 'external_id']),
    ].forEach((value) => this.addLifecycleIdentifier(identifiers, value));

    return identifiers;
  }

  private isLifecycleIdentifierMatch(value: unknown, identifiers: Set<string>): boolean {
    const normalized = this.readString(value).toLowerCase();
    return Boolean(normalized && identifiers.has(normalized));
  }

  private readOrderLinkedPositionId(payload: Record<string, unknown>): string {
    return this.readString(
      this.pickFirst(payload, [
        'position_id',
        'positionId',
        'position_uuid',
        'positionUuid',
        'future_position_uuid',
        'futurePositionUuid',
        'future_position_id',
        'futurePositionId',
      ])
    );
  }

  private getLifecycleWindowStart(position: PositionRecord): Date | null {
    const candidates = [
      this.toIsoString(position.created_at),
      this.toIsoString(position.updated_at),
      this.toIsoString(position.closed_at),
    ].filter((value): value is string => Boolean(value));
    const pivot = candidates[0] ? new Date(candidates[0]) : null;
    if (!pivot || Number.isNaN(pivot.getTime())) {
      return null;
    }
    return new Date(pivot.getTime() - 1000 * 60 * 60 * 6);
  }

  private mapRelatedLiveOrderSnapshot(
    row: {
      externalId?: string;
      symbol?: string | null;
      orderStatus?: string | null;
      statusRank?: number | null;
      payload?: unknown;
      firstSeenAt?: Date | string | null;
      lastSeenAt?: Date | string | null;
    },
    position: PositionRecord,
    trackedOrderIds: string[]
  ): PositionLifecycleOrderItem {
    const payload = this.toRecord(this.parsePayloadJson(row.payload)) || {};
    const positionIdentifiers = this.getPositionLifecycleIdentifiers(position);
    const orderId =
      this.readString(row.externalId) ||
      this.readString(payload.external_id) ||
      this.readString(payload.externalId) ||
      this.readString(payload.id) ||
      '';
    const linkedPositionId = this.readOrderLinkedPositionId(payload);
    const relation =
      linkedPositionId && this.isLifecycleIdentifierMatch(linkedPositionId, positionIdentifiers)
        ? 'position'
        : trackedOrderIds.includes(orderId)
          ? 'protection'
          : 'symbol';

    return {
      id: orderId,
      externalId: orderId || undefined,
      kind: 'live',
      relation,
      symbol:
        this.readString(row.symbol) ||
        this.readString(payload.symbol) ||
        this.readString(payload.product_symbol),
      status:
        this.readString(row.orderStatus) ||
        this.readString(this.pickFirst(payload, ['status', 'order_status'])) ||
        null,
      side: this.readString(this.pickFirst(payload, ['side', 'order_type', 'position_type'])),
      orderType: this.readString(this.pickFirst(payload, ['order_type', 'orderType'])),
      triggerType: this.readString(this.pickFirst(payload, ['trigger_type', 'triggerType'])),
      quantity: this.toNumber(this.pickFirst(payload, ['quantity', 'qty', 'size'])),
      orderPrice: this.toNumber(this.pickFirst(payload, ['order_price', 'orderPrice', 'price'])),
      stopLossPrice: this.toNumber(this.pickFirst(payload, ['stoploss_price', 'stopLossPrice'])),
      takeProfitPrice: this.toNumber(
        this.pickFirst(payload, ['takeprofit_price', 'takeProfitPrice'])
      ),
      reduceOnly: this.readBoolean(this.pickFirst(payload, ['reduce_only', 'reduceOnly'])),
      linkedPositionId,
      createdAt:
        this.toIsoString(this.pickFirst(payload, ['created_at', 'createdAt'])) ||
        this.toIsoString(row.firstSeenAt) ||
        null,
      updatedAt:
        this.toIsoString(this.pickFirst(payload, ['updated_at', 'updatedAt'])) ||
        this.toIsoString(row.lastSeenAt) ||
        null,
      detailUrl: orderId ? `/orders?selected=${encodeURIComponent(orderId)}` : undefined,
    };
  }

  private mapRelatedLiveRiskOrderSnapshot(
    row: {
      externalId?: string | null;
      orderId?: string | null;
      symbol?: string | null;
      side?: string | null;
      status?: string | null;
      orderType?: string | null;
      triggerType?: string | null;
      quantity?: number | string | null;
      price?: number | string | null;
      orderPrice?: number | string | null;
      triggerPrice?: number | string | null;
      stoplossPrice?: number | string | null;
      takeprofitPrice?: number | string | null;
      reduceOnly?: boolean | number | string | null;
      orderCreatedAt?: Date | string | null;
      orderUpdatedAt?: Date | string | null;
      firstSeenAt?: Date | string | null;
      lastSeenAt?: Date | string | null;
    },
    trackedOrderIds: string[]
  ): PositionLifecycleOrderItem {
    const orderId = this.readString(row.orderId) || this.readString(row.externalId) || '';
    const orderType = this.readString(row.orderType);
    const reduceOnly = this.readBoolean(row.reduceOnly);
    const relation = trackedOrderIds.includes(orderId) ? 'protection' : 'symbol';
    const orderPrice =
      this.toNumber(row.orderPrice) ??
      this.toNumber(row.triggerPrice) ??
      this.toNumber(row.price) ??
      this.toNumber(row.stoplossPrice) ??
      this.toNumber(row.takeprofitPrice);

    return {
      id: orderId,
      externalId: orderId || undefined,
      kind: 'live',
      relation,
      symbol: this.readString(row.symbol),
      status: this.readString(row.status) || null,
      side: this.readString(row.side),
      orderType,
      triggerType: this.readString(row.triggerType),
      quantity: this.toNumber(row.quantity),
      orderPrice,
      stopLossPrice: this.toNumber(row.stoplossPrice),
      takeProfitPrice: this.toNumber(row.takeprofitPrice),
      reduceOnly,
      linkedPositionId: null,
      createdAt: this.toIsoString(row.orderCreatedAt) || this.toIsoString(row.firstSeenAt) || null,
      updatedAt: this.toIsoString(row.orderUpdatedAt) || this.toIsoString(row.lastSeenAt) || null,
      detailUrl: orderId ? `/orders?selected=${encodeURIComponent(orderId)}` : undefined,
    };
  }

  private shouldIncludeRelatedLiveOrder(item: PositionLifecycleOrderItem): boolean {
    return item.relation !== 'symbol';
  }

  private dedupeLifecycleOrders(items: PositionLifecycleOrderItem[]): PositionLifecycleOrderItem[] {
    const byId = new Map<string, PositionLifecycleOrderItem>();
    const score = (item: PositionLifecycleOrderItem): number => {
      const status = this.readString(item.status).toLowerCase();
      const updatedAt = Date.parse(String(item.updatedAt || item.createdAt || ''));
      const statusScore =
        status === 'filled' || status === 'closed'
          ? 3
          : status === 'open' || status === 'pending' || status === 'created'
            ? 2
            : status
              ? 1
              : 0;
      return statusScore * 1_000_000_000_000 + (Number.isFinite(updatedAt) ? updatedAt : 0);
    };

    items.forEach((item, index) => {
      const key = this.readString(item.id) || `${item.symbol || 'order'}:${index}`;
      const existing = byId.get(key);
      if (!existing || score(item) >= score(existing)) {
        byId.set(key, item);
      }
    });

    return Array.from(byId.values());
  }

  private mapPaperLifecycleOrder(
    item: PaperOrder,
    position: PositionRecord
  ): PositionLifecycleOrderItem {
    const payload = this.toRecord(item.payload) || {};
    const simulation = this.toRecord(payload.simulation) || {};
    const linkedPositionId = this.readString(simulation.positionId);
    const normalizedPositionSymbol = this.readString(position.symbol)?.toUpperCase() || null;
    const relation =
      linkedPositionId && linkedPositionId === position.id
        ? 'position'
        : normalizedPositionSymbol &&
            normalizedPositionSymbol === (this.readString(item.symbol)?.toUpperCase() || null)
          ? 'symbol'
          : 'symbol';

    return {
      id: item.id,
      kind: 'paper',
      relation,
      symbol: this.readString(item.symbol),
      status: this.readString(item.status),
      side: this.readString(item.side),
      orderType: this.readString(item.orderType),
      triggerType: this.readString(item.triggerType),
      quantity: this.toNumber(item.quantity),
      orderPrice: this.toNumber(item.orderPrice),
      stopLossPrice: this.toNumber(item.stoplossPrice),
      takeProfitPrice: this.toNumber(item.takeprofitPrice),
      reduceOnly: item.reduceOnly === true,
      linkedPositionId,
      createdAt: this.toIsoString(item.createdAt) || null,
      updatedAt:
        this.toIsoString(item.updatedAt) || this.toIsoString(simulation.lastPriceSeenAt) || null,
      detailUrl: `/orders?selected=${encodeURIComponent(item.id)}`,
    };
  }

  private mapLifecycleAlert(item: {
    id: string;
    severity: string;
    channel: string;
    status: string;
    message: string;
    route?: string | null;
    source?: string | null;
    createdAt: Date;
  }): PositionLifecycleAlertItem {
    return {
      id: item.id,
      severity: item.severity,
      channel: item.channel,
      status: item.status,
      message: item.message,
      route: item.route ?? null,
      source: item.source ?? null,
      createdAt: item.createdAt.toISOString(),
      detailUrl: `/alerts?selected=${encodeURIComponent(item.id)}`,
    };
  }

  private buildSuggestedTradeLinks(item: SuggestedTrade): LinkedEntityReference[] {
    const linkedEntities: LinkedEntityReference[] = [];
    const seen = new Set<string>();
    const execution = item.executionRecord || null;
    const meta = item.meta && typeof item.meta === 'object' ? item.meta : {};
    const signalId = this.readString((meta as Record<string, unknown>).signalId);

    const push = (
      entity: string,
      id: string | null,
      extras: Partial<LinkedEntityReference> = {}
    ) => {
      const normalizedId = this.readString(id);
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
        label: extras.label,
        url: extras.url,
        relation: extras.relation,
        status: extras.status ?? null,
      });
    };

    push('automation', this.readString(item.automationId), {
      label: 'Automation',
      url: `/automations?selected=${encodeURIComponent(item.automationId)}`,
      relation: 'source',
    });
    push('automation_run', this.readString(item.automationRunId), {
      label: 'Automation run',
      url: `/automations?selected=${encodeURIComponent(
        item.automationId
      )}&runId=${encodeURIComponent(item.automationRunId)}`,
      relation: 'run',
    });
    push('strategy_template', this.readString(item.sourceTemplateId), {
      label: 'Strategy template',
      url: item.sourceTemplateId
        ? `/strategy-templates?selected=${encodeURIComponent(item.sourceTemplateId)}`
        : undefined,
      relation: 'template',
    });
    push('backtest', this.readString(item.sourceBacktestId), {
      label: 'Backtest',
      url: item.sourceBacktestId
        ? `/backtests?selected=${encodeURIComponent(item.sourceBacktestId)}`
        : undefined,
      relation: 'backtest',
    });
    push('signal', signalId, {
      label: 'Source signal',
      url: signalId
        ? `/suggested-trades?tab=signals&signalId=${encodeURIComponent(signalId)}`
        : undefined,
      relation: 'source',
    });
    push('live_order', this.readString(execution?.orderId), {
      label: 'Live order',
      url: execution?.orderId
        ? `/orders?selected=${encodeURIComponent(execution.orderId)}`
        : undefined,
      relation: 'execution',
      status: execution?.orderStatus ?? null,
    });
    push('paper_order', this.readString(execution?.paperOrderId), {
      label: 'Paper order',
      url: execution?.paperOrderId
        ? `/orders?selected=${encodeURIComponent(execution.paperOrderId)}`
        : undefined,
      relation: 'execution',
      status: execution?.paperOrderStatus ?? execution?.orderStatus ?? null,
    });
    push('position', this.readString(execution?.positionId), {
      label: 'Position',
      url: execution?.positionId
        ? `/positions?selected=${encodeURIComponent(execution.positionId)}`
        : undefined,
      relation: 'execution',
      status: execution?.positionStatus ?? null,
    });

    return linkedEntities;
  }

  private mapLifecycleSuggestedTrade(item: SuggestedTrade): PositionLifecycleSuggestedTradeItem {
    const execution = item.executionRecord || null;
    const fallbackTarget = Array.isArray(item.takeProfitTargets)
      ? (item.takeProfitTargets
          .map((value) => this.toNumber(value))
          .find((value): value is number => value !== null) ?? null)
      : null;
    const protection = this.mapLifecycleSuggestedTradeProtection(execution);
    const routeAttempts = this.normalizeLifecycleRouteAttempts(execution?.routeAttempts);
    return {
      id: item.id,
      symbol: item.symbol,
      timeframe: item.timeframe,
      side: item.side,
      status: item.status,
      signalTime: item.signalTime.toISOString(),
      confidence: item.confidence ?? null,
      score: item.score ?? null,
      executionMode:
        execution?.executionMode === 'live' || execution?.executionMode === 'paper'
          ? execution.executionMode
          : null,
      executionState: execution?.executionState ?? null,
      linkedPositionId: execution?.positionId ?? null,
      linkedOrderId: execution?.orderId ?? null,
      linkedPaperOrderId: execution?.paperOrderId ?? null,
      orderStatus: execution?.orderStatus ?? null,
      paperOrderStatus: execution?.paperOrderStatus ?? null,
      entrySubmittedAt: this.toIsoString(execution?.submittedAt) || null,
      entryFilledAt: this.toIsoString(execution?.filledAt) || null,
      filledPrice: this.toNumber(execution?.filledPrice),
      filledQuantity: this.toNumber(execution?.filledQuantity),
      remainingQuantity: this.toNumber(execution?.remainingQuantity),
      positionOpenedAt: this.toIsoString(execution?.positionOpenedAt) || null,
      positionClosedAt: this.toIsoString(execution?.positionClosedAt) || null,
      exitPrice: this.toNumber(execution?.exitPrice),
      realizedPnl: this.toNumber(execution?.realizedPnl),
      protection,
      routeAttempts,
      operatorTimeline: this.buildLifecycleSuggestedTradeTimeline(
        item,
        execution,
        protection,
        routeAttempts
      ),
      sourceTemplateId: item.sourceTemplateId ?? null,
      sourceBacktestId: item.sourceBacktestId ?? null,
      stopLossPrice: this.toNumber(execution?.stopLossPrice ?? item.stopLossPrice),
      targetPrice: this.toNumber(execution?.takeProfitPrice) ?? fallbackTarget,
      detailUrl: `/suggested-trades?selected=${encodeURIComponent(item.id)}`,
      linkedEntities: this.buildSuggestedTradeLinks(item),
    };
  }

  private normalizeLifecycleRouteAttempts(value: unknown): SuggestedTradeRouteAttempt[] | null {
    const raw = typeof value === 'string' ? this.parsePayloadJson(value) : value;
    if (!Array.isArray(raw)) {
      return null;
    }

    const attempts = raw
      .map((item, index): SuggestedTradeRouteAttempt | null => {
        const record = this.toRecord(item);
        if (!record) {
          return null;
        }

        const brokerKey = this.readString(record.brokerKey);
        const requestedSymbol = this.readString(record.requestedSymbol);
        const brokerSymbol = this.readString(record.brokerSymbol) || requestedSymbol;
        if (!brokerKey || !brokerSymbol) {
          return null;
        }

        const reconciliation = this.toRecord(record.reconciliation);

        return {
          attemptNumber: this.toNumber(record.attemptNumber) ?? index + 1,
          candidateRank: this.toNumber(record.candidateRank) ?? index + 1,
          brokerKey,
          accountId: this.readString(record.accountId) || null,
          accountName: this.readString(record.accountName) || null,
          requestedSymbol: requestedSymbol || brokerSymbol,
          brokerSymbol,
          status: (this.readString(record.status) ||
            'unknown') as SuggestedTradeRouteAttempt['status'],
          startedAt: this.toIsoString(record.startedAt) || null,
          finishedAt: this.toIsoString(record.finishedAt) || null,
          preTradeCheckId: this.readString(record.preTradeCheckId) || null,
          preTradeState:
            (this.readString(
              record.preTradeState
            ) as SuggestedTradeRouteAttempt['preTradeState']) || null,
          submissionState:
            (this.readString(
              record.submissionState
            ) as SuggestedTradeRouteAttempt['submissionState']) || null,
          orderId: this.readString(record.orderId) || null,
          orderStatus: this.readString(record.orderStatus) || null,
          failureClassification:
            (this.readString(
              record.failureClassification
            ) as SuggestedTradeRouteAttempt['failureClassification']) || null,
          failureCode: this.readString(record.failureCode) || null,
          failureMessage: this.readString(record.failureMessage) || null,
          requestSummary: this.toRecord(record.requestSummary),
          brokerResponseSummary: this.toRecord(record.brokerResponseSummary),
          reconciliation: reconciliation
            ? {
                status:
                  (this.readString(reconciliation.status) as NonNullable<
                    SuggestedTradeRouteAttempt['reconciliation']
                  >['status']) || 'unknown',
                checkedAt: this.toIsoString(reconciliation.checkedAt) || null,
                orderId: this.readString(reconciliation.orderId) || null,
                positionId: this.readString(reconciliation.positionId) || null,
                message: this.readString(reconciliation.message) || null,
              }
            : null,
          note: this.readString(record.note) || null,
        };
      })
      .filter((item): item is SuggestedTradeRouteAttempt => Boolean(item));

    return attempts.length ? attempts : null;
  }

  private buildLifecycleSuggestedTradeTimeline(
    item: SuggestedTrade,
    execution: SuggestedTrade['executionRecord'] | null | undefined,
    protection: PositionExecutionProtectionContext | null,
    routeAttempts: SuggestedTradeRouteAttempt[] | null
  ): PositionLifecycleEventItem[] {
    const events: PositionLifecycleEventItem[] = [];
    type DraftPositionLifecycleEvent = Omit<PositionLifecycleEventItem, 'occurredAt'> & {
      occurredAt: unknown;
    };

    const pushEvent = (event: DraftPositionLifecycleEvent): void => {
      const occurredAt = this.toIsoString(event.occurredAt);
      if (!occurredAt) {
        return;
      }
      events.push({ ...event, occurredAt });
    };

    pushEvent({
      id: 'signal_detected',
      kind: 'signal',
      label: 'Signal detected',
      description: 'Automation created the source signal for this position.',
      occurredAt: item.signalTime,
      entity: 'suggested_trade',
      entityId: item.id,
      status: item.status,
      severity: 'info',
    });

    for (const attempt of routeAttempts ?? []) {
      const attemptId = Math.max(1, Math.floor(attempt.attemptNumber || 1));
      const brokerKey = attempt.brokerKey || 'unknown';
      const accountLabel = attempt.accountName || attempt.accountId || 'unknown account';
      const symbol = attempt.brokerSymbol || attempt.requestedSymbol || item.symbol;
      if (attempt.startedAt) {
        pushEvent({
          id: `route_attempt_${attemptId}_started`,
          kind: 'broker_route',
          label: `Broker route ${attemptId} started`,
          description: `Submitting ${symbol} to ${brokerKey} (${accountLabel}).`,
          occurredAt: attempt.startedAt,
          entity: 'broker_route',
          entityId: attempt.accountId ?? null,
          brokerKey,
          accountId: attempt.accountId ?? null,
          status: attempt.submissionState ?? attempt.status,
          severity: 'info',
        });
      }
      if (attempt.finishedAt || attempt.reconciliation?.checkedAt) {
        const failed = attempt.status === 'failed' || attempt.status === 'pre_trade_blocked';
        pushEvent({
          id: `route_attempt_${attemptId}_finished`,
          kind: 'broker_route',
          label:
            attempt.status === 'placed'
              ? `Broker route ${attemptId} placed`
              : failed
                ? `Broker route ${attemptId} failed`
                : `Broker route ${attemptId} updated`,
          description: this.describeLifecycleRouteAttempt(attempt),
          occurredAt: attempt.finishedAt || attempt.reconciliation?.checkedAt || '',
          entity: attempt.orderId ? 'order' : 'broker_route',
          entityId: attempt.orderId ?? attempt.accountId ?? null,
          brokerKey,
          accountId: attempt.accountId ?? null,
          status: attempt.status,
          severity: attempt.status === 'placed' ? 'success' : failed ? 'warning' : 'info',
        });
      }
    }

    pushEvent({
      id: 'entry_submitted',
      kind: 'order',
      label: 'Entry submitted',
      description: 'Entry order submission was recorded.',
      occurredAt: execution?.submittedAt ?? '',
      entity: 'order',
      entityId: execution?.orderId ?? execution?.paperOrderId ?? null,
      brokerKey: execution?.brokerKey ?? null,
      accountId: execution?.accountId ?? null,
      status: execution?.executionState ?? null,
      severity: 'info',
    });
    pushEvent({
      id: 'entry_linked',
      kind: 'order',
      label: 'Entry linked',
      description: 'The broker order was linked to this suggested trade.',
      occurredAt: execution?.linkedAt ?? '',
      entity: execution?.paperOrderId ? 'paper_order' : 'order',
      entityId: execution?.orderId ?? execution?.paperOrderId ?? null,
      brokerKey: execution?.brokerKey ?? null,
      accountId: execution?.accountId ?? null,
      status: execution?.orderStatus ?? execution?.paperOrderStatus ?? null,
      severity: 'success',
    });
    pushEvent({
      id: 'entry_filled',
      kind: 'order',
      label: 'Entry filled',
      description: 'The entry order filled at the broker.',
      occurredAt: execution?.filledAt ?? '',
      entity: execution?.paperOrderId ? 'paper_order' : 'order',
      entityId: execution?.orderId ?? execution?.paperOrderId ?? null,
      brokerKey: execution?.brokerKey ?? null,
      accountId: execution?.accountId ?? null,
      status: execution?.orderStatus ?? execution?.paperOrderStatus ?? 'FILLED',
      severity: 'success',
      meta: {
        filledPrice: this.toNumber(execution?.filledPrice),
        filledQuantity: this.toNumber(execution?.filledQuantity),
      },
    });
    pushEvent({
      id: 'position_opened',
      kind: 'position',
      label: 'Position visible',
      description: 'The position became visible in broker position sync.',
      occurredAt: execution?.positionOpenedAt ?? '',
      entity: 'position',
      entityId: execution?.positionId ?? null,
      brokerKey: execution?.brokerKey ?? null,
      accountId: execution?.accountId ?? null,
      status: execution?.positionStatus ?? 'OPEN',
      severity: 'success',
    });
    pushEvent({
      id: 'protection_checked',
      kind: 'protection',
      label: 'Protection checked',
      description:
        protection?.lastError ||
        'Stop loss and target protection were checked against the broker state.',
      occurredAt: protection?.checkedAt ?? '',
      entity: 'position',
      entityId: execution?.positionId ?? null,
      brokerKey: execution?.brokerKey ?? null,
      accountId: execution?.accountId ?? null,
      status: protection?.state ?? null,
      severity: protection?.state === 'failed' ? 'error' : 'info',
    });
    pushEvent({
      id: 'protection_repair_submitted',
      kind: 'protection',
      label: 'Protection repair submitted',
      description: 'Replacement stop loss and target orders were submitted.',
      occurredAt: protection?.replacementSubmittedAt ?? '',
      entity: 'position',
      entityId: execution?.positionId ?? null,
      brokerKey: execution?.brokerKey ?? null,
      accountId: execution?.accountId ?? null,
      status: protection?.state ?? null,
      severity: 'info',
    });
    pushEvent({
      id: 'protection_attached',
      kind: 'protection',
      label: 'Protection attached',
      description: 'Broker stop loss and target protection were confirmed.',
      occurredAt: protection?.attachedAt ?? '',
      entity: 'position',
      entityId: execution?.positionId ?? null,
      brokerKey: execution?.brokerKey ?? null,
      accountId: execution?.accountId ?? null,
      status: protection?.state ?? 'attached',
      severity: 'success',
      meta: {
        stopLossOrderId: protection?.stopLossOrderId ?? null,
        takeProfitOrderId: protection?.takeProfitOrderId ?? null,
      },
    });
    pushEvent({
      id: 'position_closed',
      kind: 'exit',
      label: 'Position closed',
      description: 'The position close was observed from broker state.',
      occurredAt: execution?.positionClosedAt ?? '',
      entity: 'position',
      entityId: execution?.positionId ?? null,
      brokerKey: execution?.brokerKey ?? null,
      accountId: execution?.accountId ?? null,
      status: execution?.positionStatus ?? 'CLOSED',
      severity: 'info',
      meta: {
        exitPrice: this.toNumber(execution?.exitPrice),
        realizedPnl: this.toNumber(execution?.realizedPnl),
      },
    });

    return events.sort((left, right) => {
      const leftTime = Date.parse(left.occurredAt);
      const rightTime = Date.parse(right.occurredAt);
      return (
        (Number.isFinite(leftTime) ? leftTime : 0) - (Number.isFinite(rightTime) ? rightTime : 0)
      );
    });
  }

  private describeLifecycleRouteAttempt(attempt: SuggestedTradeRouteAttempt): string {
    const brokerKey = attempt.brokerKey || 'unknown broker';
    const accountLabel = attempt.accountName || attempt.accountId || 'unknown account';
    if (attempt.status === 'placed') {
      return attempt.orderId
        ? `${brokerKey} accepted the order as ${attempt.orderId}.`
        : `${brokerKey} accepted the order.`;
    }
    const failure =
      attempt.failureMessage ||
      attempt.failureCode ||
      attempt.note ||
      attempt.reconciliation?.message;
    if (failure) {
      return `${brokerKey} (${accountLabel}) did not complete this route: ${failure}.`;
    }
    return `${brokerKey} (${accountLabel}) route attempt ended with ${attempt.status}.`;
  }

  private mapLifecycleSuggestedTradeProtection(
    execution: SuggestedTrade['executionRecord'] | null | undefined
  ): PositionExecutionProtectionContext | null {
    if (!execution) {
      return null;
    }

    const protectionPlan = this.toRecord(execution.protectionPlan) || {};
    const state = this.readString(execution.protectionState) || null;
    const source = this.readString(execution.protectionSource) || null;
    const attempts = this.toNumber(execution.protectionAttempts);
    const lastError = this.readString(execution.protectionLastError) || null;
    const checkedAt = this.toIsoString(execution.protectionCheckedAt) || null;
    const attachedAt = this.toIsoString(execution.protectionAttachedAt) || null;
    const replacementSubmittedAt = this.toIsoString(protectionPlan.replacementSubmittedAt) || null;
    const plannedStopLossPrice = this.toNumber(execution.stopLossPrice);
    const plannedTakeProfitPrice = this.toNumber(execution.takeProfitPrice);
    const stopLossPrice =
      this.toNumber(protectionPlan.attachedStopLossPrice) ?? plannedStopLossPrice;
    const takeProfitPrice =
      this.toNumber(protectionPlan.attachedTakeProfitPrice) ?? plannedTakeProfitPrice;
    const stopLossOrderId = this.readString(protectionPlan.stopLossOrderId) || null;
    const takeProfitOrderId = this.readString(protectionPlan.takeProfitOrderId) || null;
    const trailingStop = this.toRecord(protectionPlan.trailingStop) || null;

    if (
      !state &&
      !source &&
      attempts === null &&
      !lastError &&
      !checkedAt &&
      !attachedAt &&
      !replacementSubmittedAt &&
      stopLossPrice === null &&
      takeProfitPrice === null &&
      plannedStopLossPrice === null &&
      plannedTakeProfitPrice === null &&
      !stopLossOrderId &&
      !takeProfitOrderId &&
      !trailingStop
    ) {
      return null;
    }

    return {
      state,
      source,
      attempts,
      lastError,
      checkedAt,
      attachedAt,
      replacementSubmittedAt,
      stopLossPrice,
      takeProfitPrice,
      plannedStopLossPrice,
      plannedTakeProfitPrice,
      stopLossOrderId,
      takeProfitOrderId,
      trailingStop,
    };
  }

  private mapLifecycleActivity(item: ActivityLog): PositionLifecycleActivityItem {
    return {
      id: item.id,
      type: item.type,
      title: item.title,
      status: item.status,
      actor: item.actor ?? null,
      symbol: item.symbol ?? null,
      stream: item.stream ?? null,
      route: item.route ?? null,
      related: item.related ?? null,
      referenceId: item.referenceId ?? null,
      correlationId: item.correlationId ?? null,
      description: item.description ?? null,
      flags: item.flags ?? null,
      createdAt: item.createdAt.toISOString(),
    };
  }

  private dedupeLinks(items: LinkedEntityReference[]): LinkedEntityReference[] {
    const seen = new Set<string>();
    const output: LinkedEntityReference[] = [];
    items.forEach((item) => {
      const id = this.readString(item.id);
      if (!id) {
        return;
      }
      const key = `${item.entity}:${id}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      output.push({
        entity: item.entity,
        id,
        label: item.label,
        url: item.url,
        relation: item.relation,
        status: item.status ?? null,
      });
    });
    return output;
  }

  private mapLifecycleAccountContext(
    item: {
      id: string;
      accountName: string;
      accountKey: string;
      brokerKey: string;
      status: string;
      mode?: string | null;
      purpose?: string | null;
      capabilities?: string | null;
      isDefault?: boolean;
      lastSyncAt?: Date | null;
    } | null
  ): PositionLifecycleAccountContext | null {
    if (!item) {
      return null;
    }
    return {
      id: item.id,
      accountName: item.accountName,
      accountKey: item.accountKey,
      brokerKey: item.brokerKey,
      status: item.status,
      mode: item.mode ?? null,
      purpose: item.purpose ?? null,
      capabilities: item.capabilities ?? null,
      isDefault: item.isDefault === true,
      lastSyncAt: this.toIsoString(item.lastSyncAt) || null,
    };
  }

  private async listRelatedLiveOrderSnapshots(
    userId: string,
    brokerKey: string,
    accountId: string,
    position: PositionRecord
  ): Promise<PositionLifecycleOrderItem[]> {
    const trackedOrderIds = this.getTrackedOrderIds(position);
    const normalizedSymbol = this.readString(position.symbol)?.toLowerCase() || null;
    if (!trackedOrderIds.length && !normalizedSymbol) {
      return [];
    }

    const clauses: string[] = [];
    const params: Array<unknown> = [userId, accountId, brokerKey.toLowerCase()];
    if (trackedOrderIds.length) {
      clauses.push(`external_id IN (${trackedOrderIds.map(() => '?').join(', ')})`);
      params.push(...trackedOrderIds);
    }
    if (normalizedSymbol) {
      clauses.push("LOWER(COALESCE(symbol, '')) = ?");
      params.push(normalizedSymbol);
    }

    const windowStart = this.getLifecycleWindowStart(position);
    let windowSql = '';
    if (windowStart && Number.isFinite(windowStart.getTime())) {
      windowSql = ' AND last_seen_at >= ?';
      params.push(windowStart);
    }

    const rows = (await coreDataSource.query(
      `SELECT external_id AS externalId,
              symbol,
              order_status AS orderStatus,
              status_rank AS statusRank,
              payload_json AS payload,
              first_seen_at AS firstSeenAt,
              last_seen_at AS lastSeenAt
         FROM scheduler_orders_snapshots
        WHERE user_id = ?
          AND account_id = ?
          AND LOWER(broker_key) = ?
          AND (${clauses.join(' OR ')})${windowSql}
        ORDER BY last_seen_at DESC
        LIMIT 20`,
      params
    )) as Array<{
      externalId?: string;
      symbol?: string | null;
      orderStatus?: string | null;
      statusRank?: number | null;
      payload?: unknown;
      firstSeenAt?: Date | string | null;
      lastSeenAt?: Date | string | null;
    }>;

    const riskRows = (await coreDataSource.query(
      `SELECT external_id AS externalId,
              order_id AS orderId,
              symbol,
              side,
              status,
              order_type AS orderType,
              trigger_type AS triggerType,
              quantity,
              price,
              order_price AS orderPrice,
              trigger_price AS triggerPrice,
              stoploss_price AS stoplossPrice,
              takeprofit_price AS takeprofitPrice,
              reduce_only AS reduceOnly,
              order_created_at AS orderCreatedAt,
              order_updated_at AS orderUpdatedAt,
              first_seen_at AS firstSeenAt,
              last_seen_at AS lastSeenAt
         FROM risk_order_snapshots
        WHERE user_id = ?
          AND account_id = ?
          AND LOWER(broker_key) = ?
          AND (${[
            trackedOrderIds.length
              ? `COALESCE(order_id, external_id) IN (${trackedOrderIds.map(() => '?').join(', ')})`
              : '',
            normalizedSymbol ? "LOWER(COALESCE(symbol, '')) = ?" : '',
          ]
            .filter(Boolean)
            .join(' OR ')})${windowSql}
        ORDER BY last_seen_at DESC
        LIMIT 20`,
      params
    )) as Array<{
      externalId?: string | null;
      orderId?: string | null;
      symbol?: string | null;
      side?: string | null;
      status?: string | null;
      orderType?: string | null;
      triggerType?: string | null;
      quantity?: number | string | null;
      price?: number | string | null;
      orderPrice?: number | string | null;
      triggerPrice?: number | string | null;
      stoplossPrice?: number | string | null;
      takeprofitPrice?: number | string | null;
      reduceOnly?: boolean | number | string | null;
      orderCreatedAt?: Date | string | null;
      orderUpdatedAt?: Date | string | null;
      firstSeenAt?: Date | string | null;
      lastSeenAt?: Date | string | null;
    }>;

    return this.dedupeLifecycleOrders([
      ...rows
        .map((row) => this.mapRelatedLiveOrderSnapshot(row, position, trackedOrderIds))
        .filter((item) => this.shouldIncludeRelatedLiveOrder(item)),
      ...riskRows
        .map((row) => this.mapRelatedLiveRiskOrderSnapshot(row, trackedOrderIds))
        .filter((item) => this.shouldIncludeRelatedLiveOrder(item)),
    ])
      .sort((left, right) => {
        const rank = (item: PositionLifecycleOrderItem): number =>
          item.relation === 'position' ? 0 : item.relation === 'protection' ? 1 : 2;
        const leftUpdated = Date.parse(String(left.updatedAt || left.createdAt || ''));
        const rightUpdated = Date.parse(String(right.updatedAt || right.createdAt || ''));
        return (
          rank(left) - rank(right) ||
          (Number.isFinite(rightUpdated) ? rightUpdated : 0) -
            (Number.isFinite(leftUpdated) ? leftUpdated : 0)
        );
      })
      .slice(0, 8);
  }

  private async listRelatedPaperOrders(
    userId: string,
    brokerKey: string,
    accountId: string,
    position: PositionRecord
  ): Promise<PositionLifecycleOrderItem[]> {
    const normalizedSymbol = this.readString(position.symbol)?.toUpperCase() || null;
    if (!normalizedSymbol) {
      return [];
    }

    const windowStart = this.getLifecycleWindowStart(position);
    const items = await this.paperOrderRepository.listPaperOrders(userId, {
      brokerKey,
      accountId,
      limit: 20,
      startDate: windowStart,
      endDate: null,
    });

    return items
      .filter((item) => (this.readString(item.symbol)?.toUpperCase() || null) === normalizedSymbol)
      .map((item) => this.mapPaperLifecycleOrder(item, position))
      .slice(0, 6);
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
    // Long: (mark - entry) * qty. Short: (entry - mark) * qty.
    return direction * (markPrice - entry) * qty;
  }

  private async enrichOpenPositionsWithMarketPnl(items: unknown[]): Promise<void> {
    const records = items
      .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
      .map((item) => item as Record<string, unknown>);

    if (records.length === 0) {
      return;
    }

    const symbols = new Set<string>();
    for (const record of records) {
      const symbol = this.normalizeMarketSymbol(record.symbol ?? record.product_symbol);
      if (symbol) symbols.add(symbol);
    }

    if (symbols.size === 0) {
      return;
    }

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
      // If reference pricing table is missing or temporarily unavailable, do not fail positions reads.
      return;
    }
    const priceMap = new Map<string, { price: number; retrievedAt?: string; source?: string }>();
    for (const row of rows) {
      const symbol = String(row.symbol || '')
        .trim()
        .toUpperCase();
      const price = Number(row.price);
      if (!symbol || !Number.isFinite(price)) continue;
      priceMap.set(symbol, {
        price,
        retrievedAt: (() => {
          if (!row.retrievedAt) return undefined;
          const date =
            row.retrievedAt instanceof Date ? row.retrievedAt : new Date(String(row.retrievedAt));
          if (Number.isNaN(date.getTime())) return undefined;
          return date.toISOString();
        })(),
        source: row.source || 'binance',
      });
    }

    for (const record of records) {
      const symbol = this.normalizeMarketSymbol(record.symbol ?? record.product_symbol);
      if (!symbol) continue;
      const market = priceMap.get(symbol);
      if (!market) continue;

      // Update mark price to latest market data and recompute PnL.
      record.mark_price = market.price;
      record.current_price = market.price;
      record.market_price_source = market.source;
      if (market.retrievedAt) {
        record.market_price_retrieved_at = market.retrievedAt;
      }

      const pnl = this.computeUnrealizedPnl(record, market.price);
      if (pnl !== null) {
        record.unrealized_pnl = pnl;
        record.pnl = pnl + Number(record.realized ?? 0);
      }
    }
  }

  async getFuturesPositions(
    userId: string,
    brokerKey?: string,
    accountId?: string,
    query: PositionsQuery = {}
  ): Promise<PositionRecord[]> {
    const params = validatePositionsQuery(query);
    const route = await this.brokerAccountRoutingService.resolve(
      userId,
      brokerKey,
      accountId,
      'mudrex'
    );
    const resolvedBrokerKey = String(route.brokerKey || '').trim() || 'mudrex';
    const resolvedAccountId = String(route.accountId || '').trim();
    const limit = params.limit ? Number(params.limit) : undefined;
    await this.positionReadModelRepository.ensureHydratedFromSnapshots(userId, [resolvedAccountId]);
    const items = await this.positionReadModelRepository.listLivePositionsForAccount(
      userId,
      resolvedAccountId,
      resolvedBrokerKey.toLowerCase(),
      limit
    );
    if (items.length) {
      await this.marketPriceRefreshService.refreshPricesForUser(userId);
      await this.enrichOpenPositionsWithMarketPnl(items);
    }
    const freshItems = this.withPositionFreshness(items, {
      source: 'position_snapshot',
      staleAfterMs: env.positions.liveSnapshotStaleAfterMs,
      criticalAfterMs: env.positions.liveSnapshotCriticalAfterMs,
    });
    return this.applyLimit(
      freshItems.map((item) => ({
        ...item,
        accountId: item.accountId || resolvedAccountId || undefined,
        brokerKey: item.brokerKey || resolvedBrokerKey,
      })),
      limit
    ) as PositionRecord[];
  }

  async requestPositionsRefresh(
    userId: string,
    body: PositionsRefreshBody = {}
  ): Promise<PositionsRefreshRequestResponse> {
    const filters = validatePositionsRefreshBody(body);
    const scope = this.getPositionsSyncScope(filters.brokerKey, filters.accountId);
    const activeAccounts = await this.brokerAccountRepository.getActiveBrokerAccounts(
      userId,
      filters.brokerKey
    );
    const scopedAccounts = filters.accountId
      ? activeAccounts.filter((item) => item.id === filters.accountId)
      : activeAccounts;

    if (filters.accountId && !scopedAccounts.length) {
      throw new NotFoundAppError(
        'Broker account not found for the requested positions refresh scope'
      );
    }

    if (!scopedAccounts.length) {
      return {
        requested: false,
        state: 'idle',
        scope,
        brokerKey: filters.brokerKey,
        accountId: filters.accountId,
        requestedAt: new Date().toISOString(),
        summary:
          'No connected or idle broker routes are available for positions refresh on this desk.',
        processedAccounts: 0,
        failedAccounts: 0,
        fetchedRecords: 0,
        insertedRecords: 0,
        updatedRecords: 0,
        skippedRecords: 0,
        failures: [],
      };
    }

    const result = await this.internalPositionsSyncService.runBatch(
      buildProductOwnedPositionsSyncRequest(userId, {
        targetUserIds: [userId],
        brokerKeys: filters.brokerKey ? [filters.brokerKey] : undefined,
        accountIds: scopedAccounts.map((item) => item.id),
      })
    );

    const failedAccounts = Math.max(0, Number(result.failedAccounts || 0));
    const processedAccounts = Math.max(0, Number(result.processedAccounts || 0));
    const summary =
      failedAccounts > 0
        ? `Reconciled ${processedAccounts} route${processedAccounts === 1 ? '' : 's'}, with ${failedAccounts} reporting issues.`
        : `Reconciled ${processedAccounts} route${processedAccounts === 1 ? '' : 's'} for the live positions desk.`;

    return {
      requested: true,
      state: failedAccounts > 0 ? 'warning' : 'completed',
      scope,
      brokerKey: filters.brokerKey,
      accountId: filters.accountId,
      requestedAt: new Date().toISOString(),
      summary,
      processedAccounts,
      failedAccounts,
      fetchedRecords: Math.max(0, Number(result.fetchedRecords || 0)),
      insertedRecords: Math.max(0, Number(result.insertedRecords || 0)),
      updatedRecords: Math.max(0, Number(result.updatedRecords || 0)),
      skippedRecords: Math.max(0, Number(result.skippedRecords || 0)),
      failures: Array.isArray(result.failures)
        ? result.failures
            .map((item) => this.readString(item?.error))
            .filter(Boolean)
            .slice(0, 10)
        : [],
    };
  }

  async getPositionsSyncStatus(
    userId: string,
    query: {
      brokerKey?: string;
      accountId?: string;
    } = {}
  ): Promise<PositionsSyncStatusResponse> {
    const brokerKey = this.readString(query.brokerKey) || undefined;
    const accountId = this.readString(query.accountId) || undefined;
    const scope = this.getPositionsSyncScope(brokerKey, accountId);
    const activeAccounts = await this.brokerAccountRepository.getActiveBrokerAccounts(
      userId,
      brokerKey
    );
    const scopedAccounts = accountId
      ? activeAccounts.filter((item) => item.id === accountId)
      : activeAccounts;

    if (accountId && !scopedAccounts.length) {
      throw new NotFoundAppError('Broker account not found for the requested positions sync scope');
    }

    const accountIds = scopedAccounts.map((item) => item.id);
    if (accountIds.length) {
      await this.positionReadModelRepository.ensureHydratedFromSnapshots(userId, accountIds);
    }

    const [freshnessByAccountId, pendingStateByAccountId] = await Promise.all([
      this.positionReadModelRepository.getAccountFreshness(userId, accountIds),
      this.listPendingSyncStateByAccountId(accountIds),
    ]);

    let latestCheckpointAt: string | null = null;
    let latestCheckpointTimestamp = 0;
    let nextRetryAt: string | null = null;
    let nextRetryTimestamp: number | null = null;
    let pendingRecords = 0;
    let failedRecords = 0;
    let resolvedRecords = 0;

    const items: PositionsSyncStatusItem[] = scopedAccounts.map((account) => {
      const freshness = this.buildAccountFreshness(
        {
          accountName: account.accountName,
          accountKey: account.accountKey,
        },
        freshnessByAccountId.get(account.id) || null
      );
      const pendingState = pendingStateByAccountId.get(account.id) || {
        pendingRecords: 0,
        failedRecords: 0,
        resolvedRecords: 0,
        nextRetryAt: null,
        lastPendingUpdateAt: null,
      };

      pendingRecords += pendingState.pendingRecords;
      failedRecords += pendingState.failedRecords;
      resolvedRecords += pendingState.resolvedRecords;

      const checkpointAt = freshness?.checkpoint?.observedAt || null;
      const checkpointTimestamp = checkpointAt ? this.toTimestamp(checkpointAt) : null;
      if (
        checkpointAt &&
        checkpointTimestamp !== null &&
        checkpointTimestamp > latestCheckpointTimestamp
      ) {
        latestCheckpointTimestamp = checkpointTimestamp;
        latestCheckpointAt = checkpointAt;
      }

      const retryTimestamp = pendingState.nextRetryAt
        ? this.toTimestamp(pendingState.nextRetryAt)
        : null;
      if (
        pendingState.nextRetryAt &&
        retryTimestamp !== null &&
        (nextRetryTimestamp === null || retryTimestamp < nextRetryTimestamp)
      ) {
        nextRetryTimestamp = retryTimestamp;
        nextRetryAt = pendingState.nextRetryAt;
      }

      const warning =
        pendingState.failedRecords > 0
          ? `${pendingState.failedRecords} failed sync record${pendingState.failedRecords === 1 ? '' : 's'} still need review.`
          : pendingState.pendingRecords > 0
            ? `${pendingState.pendingRecords} sync record${pendingState.pendingRecords === 1 ? '' : 's'} are still pending or retrying.`
            : freshness?.warning || null;

      return {
        accountId: account.id,
        accountName: account.accountName,
        accountKey: account.accountKey,
        brokerKey: account.brokerKey,
        status: account.status,
        freshness,
        pendingRecords: pendingState.pendingRecords,
        failedRecords: pendingState.failedRecords,
        resolvedRecords: pendingState.resolvedRecords,
        nextRetryAt: pendingState.nextRetryAt,
        lastPendingUpdateAt: pendingState.lastPendingUpdateAt,
        warning,
      };
    });

    const freshness = this.summarizeGroupedFreshness(
      items.map((item) => ({
        accountId: item.accountId,
        accountName: item.accountName,
        accountKey: item.accountKey,
        brokerKey: item.brokerKey,
        status: item.status,
        data: [],
        positions: [],
        history: [],
        freshness: item.freshness,
        openOrders: [],
        closedOrders: [],
        error: null,
      }))
    );

    const presentation = this.buildPositionsSyncSummary(
      items,
      freshness,
      failedRecords,
      pendingRecords
    );

    return {
      state: presentation.state,
      label: presentation.label,
      summary: presentation.summary,
      generatedAt: new Date().toISOString(),
      scope,
      brokerKey,
      accountId,
      totalAccounts: items.length,
      pendingRecords,
      failedRecords,
      resolvedRecords,
      items,
      freshness,
      latestCheckpointAt,
      nextRetryAt,
    };
  }

  async getFuturesPositionsForActiveAccounts(
    userId: string,
    brokerKey?: string
  ): Promise<PositionsGroupedResponse> {
    const activeAccounts = await this.brokerAccountRepository.getActiveBrokerAccounts(
      userId,
      brokerKey
    );
    return this.getFuturesPositionsForActiveAccountsFromReadModel(userId, activeAccounts);
  }

  async getPositionLifecycle(
    userId: string,
    positionId: string,
    brokerKey?: string,
    accountId?: string
  ): Promise<PositionLifecycleResponse> {
    const validatedPositionId = validatePositionId(positionId);
    const route = await this.brokerAccountRoutingService.resolve(
      userId,
      brokerKey,
      accountId,
      'mudrex'
    );
    const resolvedBrokerKey = String(route.brokerKey || '').trim() || 'mudrex';
    const resolvedAccountId = String(route.accountId || '').trim();
    await this.positionReadModelRepository.ensureHydratedFromSnapshots(userId, [resolvedAccountId]);

    const position = await this.positionReadModelRepository.getPositionByExternalId(
      userId,
      resolvedAccountId,
      validatedPositionId,
      resolvedBrokerKey.toLowerCase()
    );
    if (!position) {
      throw new NotFoundAppError('Position not found');
    }

    const [
      account,
      accountFreshnessById,
      liveOrders,
      paperOrders,
      alerts,
      activities,
      exactTrades,
      recentTrades,
    ] = await Promise.all([
      this.brokerAccountRepository.getBrokerAccountById(userId, resolvedAccountId),
      this.positionReadModelRepository.getAccountFreshness(userId, [resolvedAccountId]),
      this.listRelatedLiveOrderSnapshots(
        userId,
        resolvedBrokerKey,
        resolvedAccountId,
        position
      ).catch(() => []),
      this.listRelatedPaperOrders(userId, resolvedBrokerKey, resolvedAccountId, position).catch(
        () => []
      ),
      position.symbol
        ? this.alertRepository.listRelatedAlerts(userId, {
            symbol: position.symbol,
            limit: 6,
          })
        : Promise.resolve([]),
      this.activityRepository.listActivityWindow(
        userId,
        { limit: 8, referenceId: validatedPositionId },
        undefined
      ),
      this.suggestedTradeRepository.findLinkedTradesByPositionIds(
        userId,
        resolvedBrokerKey,
        resolvedAccountId,
        [validatedPositionId]
      ),
      position.symbol
        ? this.suggestedTradeRepository.findRecentTradesBySymbol(
            userId,
            resolvedBrokerKey,
            resolvedAccountId,
            position.symbol,
            6
          )
        : Promise.resolve([]),
    ]);

    const positionFreshness = this.buildFreshnessIndicator(
      this.getPositionObservedAt(position),
      env.positions.liveSnapshotStaleAfterMs,
      env.positions.liveSnapshotCriticalAfterMs,
      'position_snapshot'
    );
    const accountFreshness = this.buildAccountFreshness(
      {
        accountName: account?.accountName || position.accountName,
        accountKey: account?.accountKey || position.accountKey,
      },
      accountFreshnessById.get(resolvedAccountId) || null
    );
    const lifecyclePosition: PositionRecord = {
      ...position,
      accountId: resolvedAccountId,
      brokerKey: resolvedBrokerKey,
      accountName: account?.accountName || position.accountName,
      accountKey: account?.accountKey || position.accountKey,
      freshness: positionFreshness,
    };
    const lifecycleFreshness: PositionLifecycleFreshness = {
      position: positionFreshness,
      account: accountFreshness?.account || null,
      checkpoint: accountFreshness?.checkpoint || null,
      warning:
        accountFreshness?.warning ||
        (positionFreshness.state === 'critical'
          ? 'This position is backed by a critically old broker snapshot. Recent route changes may not be reflected yet.'
          : positionFreshness.state === 'stale'
            ? 'This position is backed by a lagging broker snapshot. Recent route changes may still be catching up.'
            : null),
    };

    const relatedOrders = [...liveOrders, ...paperOrders]
      .sort((left, right) => {
        const leftTime = Date.parse(String(left.updatedAt || left.createdAt || ''));
        const rightTime = Date.parse(String(right.updatedAt || right.createdAt || ''));
        return (
          (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0)
        );
      })
      .slice(0, 10);

    const seenTradeIds = new Set<string>();
    const relatedSuggestedTrades = [...exactTrades, ...recentTrades]
      .filter((item) => {
        if (seenTradeIds.has(item.id)) {
          return false;
        }
        seenTradeIds.add(item.id);
        return true;
      })
      .map((item) => this.mapLifecycleSuggestedTrade(item))
      .slice(0, 6);

    const relatedLinks = this.dedupeLinks([
      ...(account
        ? [
            {
              entity: 'account',
              id: account.id,
              label: 'Broker account',
              url: `/brokers-data?accountId=${encodeURIComponent(account.id)}`,
              relation: 'route',
              status: account.status,
            } satisfies LinkedEntityReference,
          ]
        : []),
      ...relatedOrders
        .filter((item) => item.detailUrl)
        .map((item) => ({
          entity: item.kind === 'paper' ? 'paper_order' : 'order',
          id: item.id,
          label: item.kind === 'paper' ? 'Paper order' : 'Live order',
          url: item.detailUrl,
          relation: item.relation,
          status: item.status ?? null,
        })),
      ...relatedSuggestedTrades.flatMap((item) => item.linkedEntities || []),
      ...alerts.map((item) => ({
        entity: 'alert',
        id: item.id,
        label: 'Alert',
        url: `/alerts?selected=${encodeURIComponent(item.id)}`,
        relation: 'signal',
        status: item.status,
      })),
    ]);

    return {
      position: lifecyclePosition,
      account: this.mapLifecycleAccountContext(account),
      summary: {
        relatedOrders: relatedOrders.length,
        openAlerts: alerts.filter((item) => String(item.status || '').trim() === 'Open').length,
        linkedSuggestedTrades: relatedSuggestedTrades.length,
        recentActivity: activities.length,
      },
      freshness: lifecycleFreshness,
      relatedOrders,
      relatedAlerts: alerts.map((item) => this.mapLifecycleAlert(item)),
      relatedSuggestedTrades,
      recentActivity: activities.map((item) => this.mapLifecycleActivity(item as ActivityLog)),
      relatedLinks,
    };
  }

  private async getFuturesPositionsForActiveAccountsFromReadModel(
    userId: string,
    activeAccounts: Array<{
      id: string;
      accountName: string;
      accountKey: string;
      brokerKey: string;
      status: string;
    }>
  ): Promise<PositionsGroupedResponse> {
    if (!activeAccounts.length) {
      return {
        totalActiveAccounts: 0,
        successCount: 0,
        failureCount: 0,
        items: [],
        openOrders: [],
        closedOrders: [],
      };
    }
    const accountIds = activeAccounts.map((item) => item.id);
    await this.positionReadModelRepository.ensureHydratedFromSnapshots(userId, accountIds);
    const [grouped, freshnessByAccountId] = await Promise.all([
      this.positionReadModelRepository.listLivePositionsForAccounts(userId, accountIds),
      this.positionReadModelRepository.getAccountFreshness(userId, accountIds),
    ]);

    const flattened: PositionRecord[] = [];
    for (const data of grouped.values()) {
      flattened.push(...data);
    }
    if (flattened.length) {
      await this.marketPriceRefreshService.refreshPricesForUser(userId);
      await this.enrichOpenPositionsWithMarketPnl(flattened);
    }

    const items: PositionsAccountItem[] = activeAccounts.map((account) => {
      const data = this.withPositionFreshness(
        (grouped.get(account.id) || []).map((item) => ({
          ...item,
          accountId: account.id,
          accountName: account.accountName,
          accountKey: account.accountKey,
          brokerKey: account.brokerKey,
        })),
        {
          source: 'position_snapshot',
          staleAfterMs: env.positions.liveSnapshotStaleAfterMs,
          criticalAfterMs: env.positions.liveSnapshotCriticalAfterMs,
        }
      );
      return {
        accountId: account.id,
        accountName: account.accountName,
        accountKey: account.accountKey,
        brokerKey: account.brokerKey,
        status: account.status,
        totalPositions: data.length,
        data,
        positions: data,
        freshness: this.buildAccountFreshness(
          {
            accountName: account.accountName,
            accountKey: account.accountKey,
          },
          freshnessByAccountId.get(account.id) || null
        ),
        openOrders: [],
        closedOrders: [],
        error: null,
      };
    });

    return {
      totalActiveAccounts: activeAccounts.length,
      successCount: items.length,
      failureCount: 0,
      items,
      freshness: this.summarizeGroupedFreshness(items),
      openOrders: [],
      closedOrders: [],
    };
  }

  // parsePayloadJson moved above to support both single-account and active-account snapshot reads.

  async getPositionLiquidationPrice(
    positionId: string,
    query: PositionLiqPriceQuery,
    userId: string,
    brokerKey?: string,
    accountId?: string
  ): Promise<unknown> {
    const route = await this.brokerAccountRoutingService.resolve(
      userId,
      brokerKey,
      accountId,
      'mudrex'
    );
    return this.brokerRuntimeRegistry
      .getPositionsAdapter(route.brokerKey)
      .getLiquidationPrice(positionId, query, route);
  }

  async addPositionMargin(
    positionId: string,
    body: AddMarginBody,
    userId: string,
    brokerKey?: string,
    accountId?: string
  ): Promise<unknown> {
    return this.executePositionActionWithAudit({
      actionKey: 'add-margin',
      successTitle: `Margin added: ${positionId}`,
      successDescription: 'Position margin updated',
      failureTitle: 'Add margin failed',
      failureAlertLabel: 'Add margin failed',
      positionId,
      payload: body as Record<string, unknown>,
      userId,
      brokerKey,
      accountId,
      execute: async (route, resolvedPositionId) =>
        this.brokerRuntimeRegistry
          .getPositionsAdapter(route.brokerKey)
          .addMargin(resolvedPositionId, body, route),
    });
  }

  async createPositionRiskOrder(
    positionId: string,
    body: CreateRiskOrderBody,
    userId: string,
    brokerKey?: string,
    accountId?: string
  ): Promise<unknown> {
    return this.executePositionActionWithAudit({
      actionKey: 'risk-order-create',
      successTitle: `Risk order created: ${positionId}`,
      successDescription: 'Position risk order created',
      failureTitle: 'Create risk order failed',
      failureAlertLabel: 'Create risk order failed',
      positionId,
      payload: body as Record<string, unknown>,
      userId,
      brokerKey,
      accountId,
      execute: async (route, resolvedPositionId) =>
        this.brokerRuntimeRegistry
          .getPositionsAdapter(route.brokerKey)
          .createRiskOrder(resolvedPositionId, body, route),
    });
  }

  async updatePositionRiskOrder(
    positionId: string,
    body: UpdateRiskOrderBody,
    userId: string,
    brokerKey?: string,
    accountId?: string
  ): Promise<unknown> {
    return this.executePositionActionWithAudit({
      actionKey: 'risk-order-update',
      successTitle: `Risk order updated: ${positionId}`,
      successDescription: 'Position risk order updated',
      failureTitle: 'Update risk order failed',
      failureAlertLabel: 'Update risk order failed',
      positionId,
      payload: body as Record<string, unknown>,
      userId,
      brokerKey,
      accountId,
      execute: async (route, resolvedPositionId) =>
        this.brokerRuntimeRegistry
          .getPositionsAdapter(route.brokerKey)
          .updateRiskOrder(resolvedPositionId, body, route),
    });
  }

  async reversePosition(
    positionId: string,
    userId: string,
    brokerKey?: string,
    accountId?: string
  ): Promise<unknown> {
    return this.executePositionActionWithAudit({
      actionKey: 'reverse',
      successTitle: `Position reversed: ${positionId}`,
      successDescription: 'Position reverse action completed',
      failureTitle: 'Reverse position failed',
      failureAlertLabel: 'Reverse position failed',
      positionId,
      payload: null,
      userId,
      brokerKey,
      accountId,
      execute: async (route, resolvedPositionId) =>
        this.brokerRuntimeRegistry
          .getPositionsAdapter(route.brokerKey)
          .reversePosition(resolvedPositionId, route),
    });
  }

  async closePositionPartial(
    positionId: string,
    body: ClosePartialPositionBody,
    userId: string,
    brokerKey?: string,
    accountId?: string
  ): Promise<unknown> {
    return this.executePositionActionWithAudit({
      actionKey: 'close-partial',
      successTitle: `Position partially closed: ${positionId}`,
      successDescription: 'Partial close executed',
      failureTitle: 'Partial close failed',
      failureAlertLabel: 'Partial close failed',
      positionId,
      payload: body as Record<string, unknown>,
      userId,
      brokerKey,
      accountId,
      execute: async (route, resolvedPositionId) =>
        this.brokerRuntimeRegistry
          .getPositionsAdapter(route.brokerKey)
          .closePartial(resolvedPositionId, body, route),
    });
  }

  async closePosition(
    positionId: string,
    userId: string,
    brokerKey?: string,
    accountId?: string
  ): Promise<unknown> {
    return this.executePositionActionWithAudit({
      actionKey: 'close',
      successTitle: `Position closed: ${positionId}`,
      successDescription: 'Position close executed',
      failureTitle: 'Close position failed',
      failureAlertLabel: 'Close position failed',
      positionId,
      payload: null,
      userId,
      brokerKey,
      accountId,
      execute: async (route, resolvedPositionId) =>
        this.brokerRuntimeRegistry
          .getPositionsAdapter(route.brokerKey)
          .closePosition(resolvedPositionId, route),
    });
  }

  async getPositionHistory(
    query: PositionsHistoryQuery,
    userId: string,
    brokerKey?: string,
    accountId?: string
  ): Promise<PositionRecord[]> {
    const params = validatePositionsHistoryQuery(query);
    const route = await this.brokerAccountRoutingService.resolve(
      userId,
      brokerKey || params.brokerKey,
      accountId || params.accountId,
      'mudrex'
    );
    const resolvedBrokerKey = String(route.brokerKey || '').trim() || 'mudrex';
    const resolvedAccountId = String(route.accountId || '').trim();
    const limit = params.limit ? Math.max(1, Math.floor(Number(params.limit))) : 100;
    const timeZone = await this.userTimeZoneService.resolveUserTimeZone(userId);
    const { startUtc, endUtc } = getUtcDateRangeFromLocalDates(
      params.startDate,
      params.endDate,
      timeZone
    );
    await this.positionReadModelRepository.ensureHydratedFromSnapshots(userId, [resolvedAccountId]);
    const records = await this.positionReadModelRepository.listHistoryForAccount(
      userId,
      resolvedAccountId,
      resolvedBrokerKey.toLowerCase(),
      {
        limit,
        startUtc,
        endUtc,
      }
    );
    return this.withPositionFreshness(
      records.map((item) => ({
        ...item,
        accountId: item.accountId || resolvedAccountId || undefined,
        brokerKey: item.brokerKey || resolvedBrokerKey,
      })),
      {
        source: 'position_archive',
        staleAfterMs: null,
        criticalAfterMs: null,
      }
    );
  }

  async getPositionHistoryForActiveAccounts(
    query: PositionsHistoryQuery,
    userId: string,
    brokerKey?: string
  ): Promise<PositionsGroupedResponse> {
    const params = validatePositionsHistoryQuery(query);
    const activeAccounts = await this.brokerAccountRepository.getActiveBrokerAccounts(
      userId,
      brokerKey || params.brokerKey
    );
    if (!activeAccounts.length) {
      return {
        totalActiveAccounts: 0,
        successCount: 0,
        failureCount: 0,
        items: [],
        openOrders: [],
        closedOrders: [],
      };
    }

    const accountIds = activeAccounts.map((item) => item.id);
    const timeZone = await this.userTimeZoneService.resolveUserTimeZone(userId);
    const { startUtc, endUtc } = getUtcDateRangeFromLocalDates(
      params.startDate,
      params.endDate,
      timeZone
    );
    await this.positionReadModelRepository.ensureHydratedFromSnapshots(userId, accountIds);
    const grouped = await this.positionReadModelRepository.listHistoryForAccounts(
      userId,
      accountIds,
      {
        startUtc,
        endUtc,
        limit: 50000,
      }
    );

    const items: PositionsAccountItem[] = activeAccounts.map((account) => {
      const data = this.withPositionFreshness(
        (grouped.get(account.id) || []).map((item) => ({
          ...item,
          accountId: account.id,
          accountName: account.accountName,
          accountKey: account.accountKey,
          brokerKey: account.brokerKey,
        })),
        {
          source: 'position_archive',
          staleAfterMs: null,
          criticalAfterMs: null,
        }
      );
      return {
        accountId: account.id,
        accountName: account.accountName,
        accountKey: account.accountKey,
        brokerKey: account.brokerKey,
        status: account.status,
        totalHistory: data.length,
        data,
        history: data,
        openOrders: [],
        closedOrders: [],
        error: null,
      };
    });

    return {
      totalActiveAccounts: activeAccounts.length,
      successCount: items.length,
      failureCount: 0,
      items,
      freshness: null,
      openOrders: [],
      closedOrders: [],
    };
  }
}
