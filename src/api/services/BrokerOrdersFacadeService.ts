import { createHash } from 'node:crypto';
import { Inject, Service } from 'typedi';
import { BrokerAccountRoutingService } from '../../brokers';
import { BrokerRuntimeRegistry } from '../../brokers';
import {
  BrokerAccountRepository,
  OrderSubmissionRequest,
  OrderSubmissionRequestRepository,
  OrderSnapshotSourceRow,
  OrdersSnapshotSourceRepository,
  PaperOrderRepository,
} from '../../database';
import { coreDataSource } from '../../database/data-source';
import { env } from '../../env';
import {
  OrdersAccountFreshness,
  OrdersFreshnessIndicator,
  OrdersGroupedFreshnessSummary,
  OrderSubmissionAttempt,
  OrderSubmissionAttemptDetail,
  OrderSubmissionAttemptsResponse,
  OrderSubmissionLifecycleEvent,
  OrderSubmissionOperatorState,
  OrderSubmissionMatchedSnapshot,
  OrderSubmissionReconciliationResult,
  OrderSubmissionReconciliationSweepResponse,
  OrdersRefreshRequestResponse,
  OrdersSyncStatusItem,
  OrdersSyncStatusResponse,
} from '../contracts/Orders';
import {
  CreateOrderBody,
  OrderSubmissionAttemptsQuery,
  OrderSubmissionReconcileQuery,
  OrdersRefreshBody,
  OrdersQuery,
  OrdersSyncStatusQuery,
  ValidatedCreateOrderBody,
  ValidatedOrderSubmissionAttemptsQuery,
  ValidatedOrderSubmissionReconcileQuery,
  validateCreateOrderBody,
  validateOrderId,
  validateOrderSubmissionAttemptsQuery,
  validateOrderSubmissionReconcileQuery,
  validateOrdersQuery,
  validateOrdersRefreshBody,
  validateOrdersSyncStatusQuery,
} from '../validators/orders.validator';
import { OperationalEventService } from './OperationalEventService';
import { RiskService } from './RiskService';
import {
  AppError,
  BadGatewayAppError,
  BadRequestAppError,
  ConflictAppError,
  ForbiddenAppError,
  NotFoundAppError,
  RateLimitAppError,
  ServiceUnavailableAppError,
  UnauthorizedAppError,
} from '../errors/AppError';
import { successResponse } from '../utils/response';
import { UserTimeZoneService } from './UserTimeZoneService';
import { getUtcDateRangeFromLocalDates } from '../utils/timezone';
import {
  buildApiTimeContract,
  formatApiDisplayTime,
  formatApiRawIso,
} from '../utils/apiTimeContract';
import { buildProductOwnedOrdersSyncRequest } from '../utils/positionsOrdersSyncScopeContract';
import { SuggestedTradesService } from './SuggestedTradesService';
import { PaperOrderExecutionService } from './PaperOrderExecutionService';
import { InternalOrdersSyncService } from './InternalOrdersSyncService';
import { Logger } from '../../lib/logger';
import { OrdersSyncDiagnosticsService } from './OrdersSyncDiagnosticsService';

const log = new Logger(__filename);

interface CreateFuturesOrderOptions {
  suggestedTradeId?: string | null;
}

@Service()
export class BrokerOrdersFacadeService {
  private readonly orderSubmissionStaleMs = 60 * 1000;
  private readonly orderSubmissionReconciliationMissingAfterMs = Math.max(
    10 * 60 * 1000,
    env.orders.syncCheckpointStaleAfterMs
  );

  @Inject(() => BrokerRuntimeRegistry)
  private brokerRuntimeRegistry!: BrokerRuntimeRegistry;

  @Inject(() => BrokerAccountRoutingService)
  private brokerAccountRoutingService!: BrokerAccountRoutingService;

  @Inject(() => BrokerAccountRepository)
  private brokerAccountRepository!: BrokerAccountRepository;

  @Inject(() => OperationalEventService)
  private operationalEventService!: OperationalEventService;

  @Inject(() => RiskService)
  private riskService!: RiskService;

  @Inject(() => UserTimeZoneService)
  private userTimeZoneService!: UserTimeZoneService;

  @Inject(() => PaperOrderRepository)
  private paperOrderRepository!: PaperOrderRepository;

  @Inject(() => SuggestedTradesService)
  private suggestedTradesService!: SuggestedTradesService;

  @Inject(() => PaperOrderExecutionService)
  private paperOrderExecutionService!: PaperOrderExecutionService;

  @Inject(() => OrderSubmissionRequestRepository)
  private orderSubmissionRequestRepository!: OrderSubmissionRequestRepository;

  @Inject(() => OrdersSnapshotSourceRepository)
  private ordersSnapshotSourceRepository!: OrdersSnapshotSourceRepository;

  @Inject(() => InternalOrdersSyncService)
  private internalOrdersSyncService!: InternalOrdersSyncService;

  @Inject(() => OrdersSyncDiagnosticsService)
  private ordersSyncDiagnosticsService: OrdersSyncDiagnosticsService =
    new OrdersSyncDiagnosticsService();

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

  private normalizeSnapshotTimestamp(value: unknown): string | null {
    if (!value) {
      return null;
    }
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value.toISOString();
    }
    const normalized = String(value).trim();
    if (!normalized) {
      return null;
    }
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? normalized : parsed.toISOString();
  }

  private formatDisplayTime(
    value: Date | string | null | undefined,
    timeZone?: string
  ): string | null {
    return formatApiDisplayTime(value, timeZone) || null;
  }

  private formatRawIso(value: Date | string | null | undefined): string | null {
    return formatApiRawIso(value) || null;
  }

  private normalizeLifecycleEvents(value: unknown): OrderSubmissionLifecycleEvent[] {
    if (Array.isArray(value)) {
      return value
        .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
        .map((item) => ({ ...(item as Record<string, unknown>) }));
    }

    if (typeof value === 'string') {
      try {
        return this.normalizeLifecycleEvents(JSON.parse(value) as unknown);
      } catch {
        return [];
      }
    }

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return [{ ...(value as Record<string, unknown>) }];
    }

    return [];
  }

  private buildOrderSubmissionOperatorState(
    submission: OrderSubmissionRequest
  ): OrderSubmissionOperatorState {
    if (submission.status === 'failed' || submission.placementState === 'rejected') {
      return {
        label: 'Rejected',
        tone: 'danger',
        summary:
          typeof submission.errorPayload?.message === 'string'
            ? submission.errorPayload.message
            : 'Broker placement was rejected or failed before completion.',
        recommendedAction: 'review_error',
      };
    }

    if (submission.placementState === 'submitting') {
      return {
        label: 'Submitting',
        tone: 'info',
        summary: 'Broker placement call is in progress.',
        recommendedAction: 'wait',
      };
    }

    if (submission.placementState === 'registered') {
      return {
        label: 'Registered',
        tone: 'neutral',
        summary: 'Order submission is registered and waiting for the broker call to start.',
        recommendedAction: 'wait',
      };
    }

    if (submission.reconciliationState === 'pending') {
      return {
        label: 'Pending reconciliation',
        tone: 'warning',
        summary:
          'Broker accepted the order, but the scheduler snapshot has not confirmed it yet.',
        recommendedAction: 'reconcile_execution',
      };
    }

    if (submission.reconciliationState === 'missing') {
      return {
        label: 'Missing snapshot',
        tone: 'danger',
        summary:
          'Broker placement completed, but no broker order id or matching snapshot is available.',
        recommendedAction: 'reconcile_execution',
      };
    }

    if (submission.reconciliationState === 'matched') {
      return {
        label: 'Reconciled',
        tone: 'success',
        summary: 'Broker placement is matched to broker snapshot data.',
        recommendedAction: null,
      };
    }

    if (submission.placementState === 'placed') {
      return {
        label: 'Placed',
        tone: 'success',
        summary: 'Order placement completed.',
        recommendedAction: null,
      };
    }

    return {
      label: 'Recorded',
      tone: 'neutral',
      summary: 'Order submission attempt is recorded.',
      recommendedAction: null,
    };
  }

  private mapOrderSubmissionAttempt(
    submission: OrderSubmissionRequest
  ): OrderSubmissionAttempt {
    return {
      id: submission.id,
      userId: submission.userId,
      idempotencyKey: submission.idempotencyKey,
      requestHash: submission.requestHash,
      executionMode: submission.executionMode,
      assetId: submission.assetId,
      brokerKey: submission.brokerKey,
      accountId: submission.accountId,
      suggestedTradeId: submission.suggestedTradeId,
      status: submission.status,
      placementState: submission.placementState,
      brokerOrderId: submission.brokerOrderId,
      brokerOrderStatus: submission.brokerOrderStatus,
      reconciliationState: submission.reconciliationState,
      createdAt: submission.createdAt.toISOString(),
      updatedAt: submission.updatedAt.toISOString(),
      completedAt: this.toOptionalIsoString(submission.completedAt),
      failedAt: this.toOptionalIsoString(submission.failedAt),
      lifecycle: this.normalizeLifecycleEvents(submission.lifecyclePayload),
      operatorState: this.buildOrderSubmissionOperatorState(submission),
    };
  }

  private mapOrderSubmissionAttemptDetail(
    submission: OrderSubmissionRequest
  ): OrderSubmissionAttemptDetail {
    return {
      ...this.mapOrderSubmissionAttempt(submission),
      requestPayload: this.normalizeNullableJsonRecord(submission.requestPayload),
      responsePayload: this.normalizeNullableJsonRecord(submission.responsePayload),
      errorPayload: this.normalizeNullableJsonRecord(submission.errorPayload),
    };
  }

  private buildOrderSubmissionFilterEcho(
    filters: ValidatedOrderSubmissionAttemptsQuery
  ): OrderSubmissionAttemptsResponse['filters'] {
    return {
      ...(filters.suggestedTradeId ? { suggestedTradeId: filters.suggestedTradeId } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.placementState ? { placementState: filters.placementState } : {}),
      ...(filters.reconciliationState
        ? { reconciliationState: filters.reconciliationState }
        : {}),
      ...(filters.brokerKey ? { brokerKey: filters.brokerKey } : {}),
      ...(filters.accountId ? { accountId: filters.accountId } : {}),
    };
  }

  private normalizeNullableJsonRecord(value: unknown): Record<string, unknown> | null {
    if (value === undefined || value === null) {
      return null;
    }
    const record = this.normalizeJsonRecord(value);
    return Object.keys(record).length ? record : null;
  }

  private toOptionalIsoString(value: Date | string | null | undefined): string | null {
    if (!value) {
      return null;
    }
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value.toISOString();
    }
    const parsed = new Date(String(value));
    return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
  }

  private mapOrderSubmissionMatchedSnapshot(
    snapshot: OrderSnapshotSourceRow | null
  ): OrderSubmissionMatchedSnapshot | null {
    if (!snapshot) {
      return null;
    }

    return {
      externalId: snapshot.externalId,
      orderStatus: snapshot.orderStatus,
      statusRank: snapshot.statusRank,
      firstSeenAt: this.toOptionalIsoString(snapshot.firstSeenAt),
      lastSeenAt: this.toOptionalIsoString(snapshot.lastSeenAt),
      payload: snapshot.payloadJson,
    };
  }

  private getOrderSubmissionReconciliationReferenceAt(
    submission: OrderSubmissionRequest
  ): Date {
    const candidates = [submission.completedAt, submission.updatedAt, submission.createdAt];
    for (const candidate of candidates) {
      if (candidate instanceof Date && !Number.isNaN(candidate.getTime())) {
        return candidate;
      }
      if (candidate) {
        const parsed = new Date(String(candidate));
        if (!Number.isNaN(parsed.getTime())) {
          return parsed;
        }
      }
    }
    return new Date();
  }

  private getOrderSubmissionMissingEligibleAt(
    submission: OrderSubmissionRequest
  ): Date {
    return new Date(
      this.getOrderSubmissionReconciliationReferenceAt(submission).getTime() +
        this.orderSubmissionReconciliationMissingAfterMs
    );
  }

  private isOrderSubmissionMissingEligible(submission: OrderSubmissionRequest): boolean {
    return Date.now() >= this.getOrderSubmissionMissingEligibleAt(submission).getTime();
  }

  private buildOrderSubmissionReconciliationFilterEcho(
    filters: ValidatedOrderSubmissionReconcileQuery
  ): OrderSubmissionReconciliationSweepResponse['filters'] {
    return {
      ...(filters.brokerKey ? { brokerKey: filters.brokerKey } : {}),
      ...(filters.accountId ? { accountId: filters.accountId } : {}),
    };
  }

  private readString(value: unknown): string {
    return String(value ?? '').trim();
  }

  private localizeShallowOrderRecord(value: unknown, timeZone: string): unknown {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return value;
    }

    const record = { ...(value as Record<string, unknown>) };
    const mappings: Array<{ key: string; isoKey: string }> = [
      { key: 'created_at', isoKey: 'createdAtIso' },
      { key: 'updated_at', isoKey: 'updatedAtIso' },
      { key: 'canceled_at', isoKey: 'canceledAtIso' },
      { key: 'first_seen_at', isoKey: 'firstSeenAtIso' },
      { key: 'last_seen_at', isoKey: 'lastSeenAtIso' },
      { key: 'filled_at', isoKey: 'filledAtIso' },
      { key: 'closed_at', isoKey: 'closedAtIso' },
      { key: 'position_opened_at', isoKey: 'positionOpenedAtIso' },
      { key: 'position_closed_at', isoKey: 'positionClosedAtIso' },
      { key: 'last_price_seen_at', isoKey: 'lastPriceSeenAtIso' },
      { key: 'createdAt', isoKey: 'createdAtIso' },
      { key: 'updatedAt', isoKey: 'updatedAtIso' },
      { key: 'canceledAt', isoKey: 'canceledAtIso' },
      { key: 'firstSeenAt', isoKey: 'firstSeenAtIso' },
      { key: 'lastSeenAt', isoKey: 'lastSeenAtIso' },
      { key: 'filledAt', isoKey: 'filledAtIso' },
      { key: 'closedAt', isoKey: 'closedAtIso' },
    ];

    for (const mapping of mappings) {
      if (!(mapping.key in record)) {
        continue;
      }
      const rawIso = this.normalizeSnapshotTimestamp(record[mapping.key]);
      record[mapping.key] = this.formatDisplayTime(rawIso, timeZone);
      record[mapping.isoKey] = rawIso;
    }

    return record;
  }

  private getOrdersSyncScope(
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

  private toTimestamp(value: unknown): number | null {
    const normalized = this.readString(value);
    if (!normalized) {
      return null;
    }
    const parsed = new Date(normalized);
    const timestamp = parsed.getTime();
    return Number.isNaN(timestamp) ? null : timestamp;
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

  private buildOrdersFreshnessIndicator(
    observedAt: unknown,
    staleAfterMs: number | null,
    criticalAfterMs: number | null,
    source: string,
    timeZone: string
  ): OrdersFreshnessIndicator {
    const observedIso = this.normalizeSnapshotTimestamp(observedAt);
    const observedMs = observedIso ? this.toTimestamp(observedIso) : null;
    const freshnessMs =
      observedMs !== null ? Math.max(0, Date.now() - observedMs) : null;
    const state =
      freshnessMs === null
        ? 'unknown'
        : criticalAfterMs !== null && freshnessMs > criticalAfterMs
          ? 'critical'
          : staleAfterMs !== null && freshnessMs > staleAfterMs
            ? 'stale'
            : 'fresh';

    return {
      state,
      observedAt: this.formatDisplayTime(observedIso, timeZone),
      observedAtIso: observedIso,
      freshnessMs,
      staleAfterMs,
      criticalAfterMs,
      isStale: state === 'stale' || state === 'critical',
      isCritical: state === 'critical',
      source,
    };
  }

  private buildOrdersAccountFreshness(
    account: {
      accountName?: string;
      accountKey?: string;
    },
    freshnessRow?: {
      observedAt?: string | null;
      checkpointAt?: string | null;
    } | null,
    timeZone?: string
  ): OrdersAccountFreshness | null {
    if (!freshnessRow?.observedAt && !freshnessRow?.checkpointAt) {
      return null;
    }

    const latestSnapshot = this.buildOrdersFreshnessIndicator(
      freshnessRow?.observedAt || null,
      env.orders.liveSnapshotStaleAfterMs,
      env.orders.liveSnapshotCriticalAfterMs,
      'order_snapshot',
      timeZone || 'UTC'
    );
    const checkpoint = this.buildOrdersFreshnessIndicator(
      freshnessRow?.checkpointAt || null,
      env.orders.syncCheckpointStaleAfterMs,
      env.orders.syncCheckpointCriticalAfterMs,
      'sync_checkpoint',
      timeZone || 'UTC'
    );
    const accountLabel = account.accountName || account.accountKey || 'this account';
    let warning: string | null = null;

    if (latestSnapshot.state === 'critical') {
      const age = this.formatRelativeAge(latestSnapshot.freshnessMs) || 'a while ago';
      warning = `Live orders snapshot for ${accountLabel} was last observed ${age}. This desk may be materially behind the broker route.`;
    } else if (latestSnapshot.state === 'stale') {
      const age = this.formatRelativeAge(latestSnapshot.freshnessMs) || 'recently';
      warning = `Live orders snapshot for ${accountLabel} was last observed ${age}. Recent broker writes can still be catching up.`;
    } else if (
      latestSnapshot.state === 'unknown' &&
      checkpoint.state !== 'unknown'
    ) {
      const age = this.formatRelativeAge(checkpoint.freshnessMs) || 'recently';
      warning = `No visible orders snapshot timestamp is available for ${accountLabel} yet. The latest sync checkpoint was ${age}.`;
    }

    return {
      checkpoint: checkpoint.state === 'unknown' ? null : checkpoint,
      latestSnapshot,
      warning,
    };
  }

  private summarizeOrdersGroupedFreshness(
    items: Array<{ freshness: OrdersAccountFreshness | null }>,
    timeZone: string
  ): OrdersGroupedFreshnessSummary | null {
    if (!items.length) {
      return {
        observedAt: null,
        freshAccounts: 0,
        staleAccounts: 0,
        criticalAccounts: 0,
        unknownAccounts: 0,
        warning: null,
      };
    }

    let observedAt: string | null = null;
    let observedTimestamp = 0;
    let freshAccounts = 0;
    let staleAccounts = 0;
    let criticalAccounts = 0;
    let unknownAccounts = 0;

    items.forEach((item) => {
      const state = item.freshness?.latestSnapshot?.state || 'unknown';
      if (state === 'critical') {
        criticalAccounts += 1;
      } else if (state === 'stale') {
        staleAccounts += 1;
      } else if (state === 'fresh') {
        freshAccounts += 1;
      } else {
        unknownAccounts += 1;
      }

      const candidate =
        item.freshness?.latestSnapshot?.observedAtIso ||
        item.freshness?.latestSnapshot?.observedAt ||
        null;
      const candidateTimestamp = candidate ? this.toTimestamp(candidate) : null;
      if (candidate && candidateTimestamp !== null && candidateTimestamp > observedTimestamp) {
        observedTimestamp = candidateTimestamp;
        observedAt = candidate;
      }
    });

    const warning =
      criticalAccounts > 0
        ? `${criticalAccounts} account${criticalAccounts === 1 ? ' has' : 's have'} critically old order snapshots on the live desk.`
        : staleAccounts > 0
          ? `${staleAccounts} account${staleAccounts === 1 ? ' has' : 's have'} lagging order snapshots on the live desk.`
          : unknownAccounts > 0
            ? `${unknownAccounts} account${unknownAccounts === 1 ? ' has' : 's have'} no visible order snapshot timestamp yet.`
            : null;

    return {
      observedAt: this.formatDisplayTime(observedAt, timeZone),
      observedAtIso: observedAt,
      freshAccounts,
      staleAccounts,
      criticalAccounts,
      unknownAccounts,
      warning,
    };
  }

  private buildOrdersSyncSummary(
    items: OrdersSyncStatusItem[],
    freshness: OrdersGroupedFreshnessSummary | null,
    failedRecords: number,
    pendingRecords: number
  ): {
    state: OrdersSyncStatusResponse['state'];
    label: string;
    summary: string;
  } {
    if (!items.length) {
      return {
        state: 'idle',
        label: 'No routes',
        summary: 'No connected or idle broker routes are available for orders sync on this desk.',
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
            : `${criticalAccounts} route${criticalAccounts === 1 ? ' is' : 's are'} backed by critically old order snapshots.`,
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
      summary: 'Connected broker routes are aligned with the latest visible order snapshots and checkpoints.',
    };
  }

  private buildActivityRouteTarget(
    brokerKey?: string | null,
    accountId?: string | null
  ): string | null {
    const parts = [String(brokerKey || '').trim(), String(accountId || '').trim()].filter(
      Boolean
    );

    return parts.length ? parts.join(' · ') : null;
  }

  private normalizeJsonRecord(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return { ...(value as Record<string, unknown>) };
    }

    return {
      value,
    };
  }

  private sortForStableHash(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.sortForStableHash(item));
    }

    if (value && typeof value === 'object') {
      return Object.keys(value as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((accumulator, key) => {
          accumulator[key] = this.sortForStableHash(
            (value as Record<string, unknown>)[key]
          );
          return accumulator;
        }, {});
    }

    return value;
  }

  private buildCreateOrderSubmissionHash(
    assetId: string,
    brokerKey: string,
    accountId: string,
    body: ValidatedCreateOrderBody,
    suggestedTradeId?: string | null
  ): string {
    const normalizedSuggestedTradeId =
      String(suggestedTradeId || body.suggested_trade_id || '').trim() || null;
    const payload = {
      assetId: String(assetId || '').trim(),
      route: {
        brokerKey: String(brokerKey || '').trim(),
        accountId: String(accountId || '').trim(),
      },
      order: {
        symbol: body.symbol ?? null,
        side: body.side,
        executionMode: body.execution_mode,
        suggestedTradeId: normalizedSuggestedTradeId,
        leverage: body.leverage,
        quantity: body.quantity,
        orderPrice: body.order_price,
        orderType: body.order_type,
        triggerType: body.trigger_type,
        isTakeProfit: body.is_takeprofit,
        isStopLoss: body.is_stoploss,
        stopLossPrice: body.stoploss_price,
        takeProfitPrice: body.takeprofit_price,
        reduceOnly: body.reduce_only,
      },
    };

    return createHash('sha256')
      .update(JSON.stringify(this.sortForStableHash(payload)))
      .digest('hex');
  }

  private buildCreateOrderRequestPayload(
    assetId: string,
    brokerKey: string,
    accountId: string,
    body: ValidatedCreateOrderBody,
    suggestedTradeId?: string | null
  ): Record<string, unknown> {
    const normalizedSuggestedTradeId =
      String(suggestedTradeId || body.suggested_trade_id || '').trim() || null;
    return {
      assetId: String(assetId || '').trim(),
      route: {
        brokerKey: String(brokerKey || '').trim(),
        accountId: String(accountId || '').trim(),
      },
      order: {
        symbol: body.symbol ?? null,
        side: body.side,
        executionMode: body.execution_mode,
        suggestedTradeId: normalizedSuggestedTradeId,
        leverage: body.leverage,
        quantity: body.quantity,
        orderPrice: body.order_price,
        orderType: body.order_type,
        triggerType: body.trigger_type,
        isTakeProfit: body.is_takeprofit,
        isStopLoss: body.is_stoploss,
        stopLossPrice: body.stoploss_price,
        takeProfitPrice: body.takeprofit_price,
        reduceOnly: body.reduce_only,
      },
    };
  }

  private unwrapSuccessData(value: unknown): Record<string, unknown> {
    const record = this.normalizeJsonRecord(value);

    if (
      record.success === true &&
      Object.prototype.hasOwnProperty.call(record, 'data') &&
      record.data &&
      typeof record.data === 'object' &&
      !Array.isArray(record.data)
    ) {
      return { ...(record.data as Record<string, unknown>) };
    }

    return record;
  }

  private buildOrderSubmissionConflictError(): ConflictAppError {
    return new ConflictAppError(
      'This submission key is already tied to a different order draft. Refresh the ticket and submit again.',
      'ORDER_IDEMPOTENCY_KEY_REUSED'
    );
  }

  private buildOrderSubmissionInProgressError(): ConflictAppError {
    return new ConflictAppError(
      'This order submission is already in progress. Wait for the current attempt to finish before retrying.',
      'ORDER_SUBMISSION_IN_PROGRESS'
    );
  }

  private async reconcileOrderSubmissionRequest(
    request: OrderSubmissionRequest,
    requestHash: string
  ): Promise<{ request: OrderSubmissionRequest | null; replayResponse?: unknown }> {
    if (String(request.requestHash || '').trim() !== requestHash) {
      throw this.buildOrderSubmissionConflictError();
    }

    if (request.status === 'completed' && request.responsePayload) {
      return {
        request,
        replayResponse: request.responsePayload,
      };
    }

    if (request.status === 'in_progress') {
      const updatedAt = request.updatedAt instanceof Date ? request.updatedAt.getTime() : 0;
      if (Number.isFinite(updatedAt) && Date.now() - updatedAt < this.orderSubmissionStaleMs) {
        throw this.buildOrderSubmissionInProgressError();
      }
    }

    return {
      request: await this.orderSubmissionRequestRepository.markInProgress(
        request,
        requestHash
      ),
    };
  }

  private async beginCreateOrderSubmission(
    userId: string,
    assetId: string,
    brokerKey: string,
    accountId: string,
    body: ValidatedCreateOrderBody,
    suggestedTradeId?: string | null
  ): Promise<{
    request: OrderSubmissionRequest | null;
    requestHash: string | null;
    replayResponse?: unknown;
  }> {
    const idempotencyKey = String(body.idempotency_key || '').trim();
    if (!idempotencyKey) {
      return {
        request: null,
        requestHash: null,
      };
    }

    const requestHash = this.buildCreateOrderSubmissionHash(
      assetId,
      brokerKey,
      accountId,
      body,
      suggestedTradeId
    );
    const existing = await this.orderSubmissionRequestRepository.findByUserAndKey(
      userId,
      idempotencyKey
    );

    if (existing) {
      const reconciled = await this.reconcileOrderSubmissionRequest(
        existing,
        requestHash
      );
      return {
        ...reconciled,
        requestHash,
      };
    }

    try {
      return {
        requestHash,
        request: await this.orderSubmissionRequestRepository.createInProgress({
          userId,
          idempotencyKey,
          requestHash,
          executionMode: body.execution_mode,
          assetId,
          brokerKey,
          accountId,
          suggestedTradeId: suggestedTradeId ?? body.suggested_trade_id ?? null,
          requestPayload: this.buildCreateOrderRequestPayload(
            assetId,
            brokerKey,
            accountId,
            body,
            suggestedTradeId
          ),
        }),
      };
    } catch (error) {
      if (!this.orderSubmissionRequestRepository.isDuplicateIdempotencyKeyError(error)) {
        throw error;
      }

      const racedRequest = await this.orderSubmissionRequestRepository.findByUserAndKey(
        userId,
        idempotencyKey
      );

      if (!racedRequest) {
        throw error;
      }

      const reconciled = await this.reconcileOrderSubmissionRequest(
        racedRequest,
        requestHash
      );
      return {
        ...reconciled,
        requestHash,
      };
    }
  }

  private buildCreateOrderFailurePayload(error: unknown): Record<string, unknown> {
    const statusCode =
      error instanceof AppError
        ? error.httpCode
        : typeof (error as { httpCode?: unknown })?.httpCode === 'number'
          ? Number((error as { httpCode: number }).httpCode)
          : 500;

    return {
      statusCode,
      ...(typeof (error as { code?: unknown })?.code === 'string'
        ? { code: String((error as { code?: string }).code) }
        : {}),
      message: error instanceof Error ? error.message : String(error),
      ...(this.extractBrokerErrorContext(error)
        ? { brokerError: this.extractBrokerErrorContext(error) }
        : {}),
    };
  }

  private normalizeCreateOrderError(error: unknown): Error {
    if (error instanceof AppError && error.code) {
      return error;
    }

    const message = error instanceof Error ? error.message : String(error);
    const lowerMessage = message.toLowerCase();

    if (this.isBrokerAuthorizationOrderError(error, lowerMessage)) {
      return this.withBrokerErrorContext(
        new BadRequestAppError(
          'Order rejected: broker authorization failed. Check Delta API key Trading permission and IP whitelist.',
          'ORDER_BROKER_AUTHORIZATION_FAILED'
        ),
        error
      );
    }

    if (
      lowerMessage.includes('product mapping') ||
      lowerMessage.includes('live product catalog') ||
      (lowerMessage.includes('product') &&
        lowerMessage.includes('not found') &&
        lowerMessage.includes('catalog')) ||
      (lowerMessage.includes('product') &&
        lowerMessage.includes('not live') &&
        lowerMessage.includes('operational'))
    ) {
      return this.withBrokerErrorContext(
        new BadRequestAppError(
          'Order rejected: broker product mapping is stale or unavailable for this route.',
          'ORDER_REJECTED_BROKER_MAPPING'
        ),
        error
      );
    }

    if (
      lowerMessage.includes('insufficient') &&
      ['margin', 'balance', 'fund', 'collateral'].some((token) =>
        lowerMessage.includes(token)
      )
    ) {
      return this.withBrokerErrorContext(
        new BadRequestAppError(
          'Order rejected: insufficient margin for this route.',
          'ORDER_REJECTED_INSUFFICIENT_MARGIN'
        ),
        error
      );
    }

    if (
      ['price', 'tick', 'step'].some((token) => lowerMessage.includes(token)) &&
      ['invalid', 'minimum', 'maximum', 'range', 'precision'].some((token) =>
        lowerMessage.includes(token)
      )
    ) {
      return this.withBrokerErrorContext(
        new BadRequestAppError(
          'Order rejected: price does not match the broker rules for this asset.',
          'ORDER_REJECTED_INVALID_PRICE'
        ),
        error
      );
    }

    if (
      ['quantity', 'size', 'contract', 'notional'].some((token) =>
        lowerMessage.includes(token)
      ) &&
      ['invalid', 'minimum', 'maximum', 'step', 'precision', 'small'].some((token) =>
        lowerMessage.includes(token)
      )
    ) {
      return this.withBrokerErrorContext(
        new BadRequestAppError(
          'Order rejected: quantity does not match the broker rules for this asset.',
          'ORDER_REJECTED_INVALID_QUANTITY'
        ),
        error
      );
    }

    if (lowerMessage.includes('leverage')) {
      return this.withBrokerErrorContext(
        new BadRequestAppError(
          'Order rejected: leverage is outside the broker limits for this asset.',
          'ORDER_REJECTED_INVALID_LEVERAGE'
        ),
        error
      );
    }

    if (
      lowerMessage.includes('duplicate') ||
      lowerMessage.includes('already submitted') ||
      lowerMessage.includes('already exists')
    ) {
      return this.withBrokerErrorContext(
        new ConflictAppError(
          'Order submission was already accepted by the broker. Refresh the live book before submitting again.',
          'ORDER_REJECTED_DUPLICATE'
        ),
        error
      );
    }

    if (
      lowerMessage.includes('timeout') ||
      lowerMessage.includes('timed out') ||
      lowerMessage.includes('gateway timeout')
    ) {
      return this.withBrokerErrorContext(
        new ServiceUnavailableAppError(
          'Broker did not confirm the order in time. Retry with the same draft if the order does not appear.',
          'ORDER_REJECTED_TIMEOUT'
        ),
        error
      );
    }

    if (error instanceof RateLimitAppError) {
      return this.withBrokerErrorContext(
        new RateLimitAppError(
          'Broker rate limit hit while creating the order. Try again in a moment.',
          'ORDER_RATE_LIMITED'
        ),
        error
      );
    }

    if (error instanceof ConflictAppError) {
      return this.withBrokerErrorContext(
        new ConflictAppError(
          'Order submission conflicted with existing broker state. Refresh the live book before retrying.',
          'ORDER_REJECTED_DUPLICATE'
        ),
        error
      );
    }

    if (error instanceof BadRequestAppError) {
      return this.withBrokerErrorContext(
        new BadRequestAppError(
          'Order rejected by the broker. Review the ticket values and try again.',
          'ORDER_REJECTED_BROKER_RULE'
        ),
        error
      );
    }

    if (error instanceof BadGatewayAppError || error instanceof ServiceUnavailableAppError) {
      return this.withBrokerErrorContext(
        new ServiceUnavailableAppError(
          'Broker was unavailable while creating the order. Try again in a moment.',
          'ORDER_BROKER_UNAVAILABLE'
        ),
        error
      );
    }

    return this.withBrokerErrorContext(
      new ServiceUnavailableAppError(
        'Broker was unavailable while creating the order. Try again in a moment.',
        'ORDER_BROKER_UNAVAILABLE'
      ),
      error
    );
  }

  private isBrokerAuthorizationOrderError(error: unknown, lowerMessage: string): boolean {
    const brokerError = this.extractBrokerErrorContext(error);
    const brokerErrorCode = String(brokerError?.code || '').trim().toLowerCase();
    const brokerErrorMessage = String(brokerError?.message || '').trim().toLowerCase();
    return (
      error instanceof UnauthorizedAppError ||
      error instanceof ForbiddenAppError ||
      brokerErrorCode === 'unauthorizedapiaccess' ||
      brokerErrorCode === 'invalidapikey' ||
      brokerErrorCode === 'ip_not_whitelisted_for_api_key' ||
      lowerMessage.includes('unauthorizedapiaccess') ||
      lowerMessage.includes('invalidapikey') ||
      lowerMessage.includes('not authorised') ||
      lowerMessage.includes('not authorized') ||
      lowerMessage.includes('ip not whitelisted') ||
      lowerMessage.includes('ip_not_whitelisted_for_api_key') ||
      brokerErrorMessage.includes('not authorised') ||
      brokerErrorMessage.includes('not authorized') ||
      brokerErrorMessage.includes('ip not whitelisted') ||
      brokerErrorMessage.includes('ip_not_whitelisted_for_api_key')
    );
  }

  private withBrokerErrorContext<T extends Error>(normalizedError: T, sourceError: unknown): T {
    const brokerContext = this.extractRawBrokerErrorContext(sourceError);
    if (brokerContext) {
      Object.assign(normalizedError, brokerContext);
    }
    return normalizedError;
  }

  private extractBrokerErrorContext(error: unknown): Record<string, unknown> | null {
    const raw = this.extractRawBrokerErrorContext(error);
    if (!raw) {
      return null;
    }

    return {
      ...(raw.broker ? { broker: raw.broker } : {}),
      ...(typeof raw.brokerStatusCode === 'number'
        ? { statusCode: raw.brokerStatusCode }
        : {}),
      ...(raw.brokerRoutePath ? { routePath: raw.brokerRoutePath } : {}),
      ...(raw.brokerErrorCode ? { code: raw.brokerErrorCode } : {}),
      ...(raw.brokerErrorMessage ? { message: raw.brokerErrorMessage } : {}),
      ...(raw.brokerErrorPayload ? { payload: raw.brokerErrorPayload } : {}),
    };
  }

  private extractRawBrokerErrorContext(error: unknown):
    | {
        broker?: string;
        brokerStatusCode?: number;
        brokerRoutePath?: string;
        brokerErrorCode?: string;
        brokerErrorMessage?: string;
        brokerErrorPayload?: unknown;
      }
    | null {
    if (!error || typeof error !== 'object') {
      return null;
    }
    const source = error as {
      broker?: unknown;
      brokerStatusCode?: unknown;
      brokerRoutePath?: unknown;
      brokerErrorCode?: unknown;
      brokerErrorMessage?: unknown;
      brokerErrorPayload?: unknown;
    };
    const broker = String(source.broker || '').trim();
    const brokerStatusCode =
      typeof source.brokerStatusCode === 'number'
        ? source.brokerStatusCode
        : Number.isFinite(Number(source.brokerStatusCode))
          ? Number(source.brokerStatusCode)
          : undefined;
    const brokerRoutePath = String(source.brokerRoutePath || '').trim();
    const brokerErrorCode = String(source.brokerErrorCode || '').trim();
    const brokerErrorMessage = String(source.brokerErrorMessage || '').trim();
    const brokerErrorPayload = source.brokerErrorPayload;

    if (
      !broker &&
      brokerStatusCode === undefined &&
      !brokerRoutePath &&
      !brokerErrorCode &&
      !brokerErrorMessage &&
      brokerErrorPayload === undefined
    ) {
      return null;
    }

    return {
      ...(broker ? { broker } : {}),
      ...(brokerStatusCode !== undefined ? { brokerStatusCode } : {}),
      ...(brokerRoutePath ? { brokerRoutePath } : {}),
      ...(brokerErrorCode ? { brokerErrorCode } : {}),
      ...(brokerErrorMessage ? { brokerErrorMessage } : {}),
      ...(brokerErrorPayload !== undefined ? { brokerErrorPayload } : {}),
    };
  }

  private resolveSnapshotState(statusRank: number, payload: unknown): 'open' | 'history' {
    return this.isClosedSnapshotOrder(statusRank, payload) ? 'history' : 'open';
  }

  private decorateLiveSnapshotOrder(
    payload: unknown,
    context: {
      brokerKey: string;
      accountId: string;
      accountName?: string | null;
      accountKey?: string | null;
      accountStatus?: string | null;
      externalId?: string | null;
      firstSeenAt?: string | null;
      lastSeenAt?: string | null;
      statusRank?: number;
    },
    timeZone: string
  ): Record<string, unknown> {
    const base =
      payload && typeof payload === 'object' && !Array.isArray(payload)
        ? { ...(payload as Record<string, unknown>) }
        : {};
    const normalizedBrokerKey = String(context.brokerKey || '').trim();
    const normalizedAccountId = String(context.accountId || '').trim();
    const normalizedAccountName = String(context.accountName || '').trim();
    const normalizedAccountKey = String(context.accountKey || '').trim();
    const normalizedAccountStatus = String(context.accountStatus || '').trim();
    const id =
      String(
        base.id ??
          base.order_id ??
          base.orderId ??
          base.external_id ??
          base.externalId ??
          context.externalId ??
          ''
      ).trim() || '';
    const externalId =
      String(base.external_id ?? base.externalId ?? context.externalId ?? id).trim() || id;
    const statusRank = Number(context.statusRank ?? base.snapshot_status_rank ?? 0);
    const firstSeenAtIso =
      this.normalizeSnapshotTimestamp(context.firstSeenAt) ??
      this.normalizeSnapshotTimestamp(base.first_seen_at ?? base.firstSeenAt);
    const lastSeenAtIso =
      this.normalizeSnapshotTimestamp(context.lastSeenAt) ??
      this.normalizeSnapshotTimestamp(base.last_seen_at ?? base.lastSeenAt);
    const snapshotState = this.resolveSnapshotState(statusRank, base);
    const fetchedAtIso = new Date(Date.now()).toISOString();

    return {
      ...base,
      id,
      order_id: String(base.order_id ?? base.orderId ?? id).trim() || id,
      external_id: externalId,
      mode: 'live',
      source: 'scheduler_orders_snapshots',
      brokerKey: normalizedBrokerKey,
      broker_key: normalizedBrokerKey,
      accountId: normalizedAccountId,
      account_id: normalizedAccountId,
      accountName: normalizedAccountName,
      account_name: normalizedAccountName,
      accountKey: normalizedAccountKey,
      account_key: normalizedAccountKey,
      accountStatus: normalizedAccountStatus,
      account_status: normalizedAccountStatus,
      first_seen_at: this.formatDisplayTime(firstSeenAtIso, timeZone),
      firstSeenAtIso: firstSeenAtIso,
      last_seen_at: this.formatDisplayTime(lastSeenAtIso, timeZone),
      lastSeenAtIso: lastSeenAtIso,
      snapshot_source: 'scheduler_orders_snapshots',
      snapshot_status_rank: statusRank,
      snapshot_state: snapshotState,
      route: {
        brokerKey: normalizedBrokerKey,
        accountId: normalizedAccountId,
        accountName: normalizedAccountName,
        accountKey: normalizedAccountKey,
        status: normalizedAccountStatus,
      },
      snapshot: {
        source: 'scheduler_orders_snapshots',
        statusRank,
        state: snapshotState,
        firstSeenAt: this.formatDisplayTime(firstSeenAtIso, timeZone),
        firstSeenAtIso,
        lastSeenAt: this.formatDisplayTime(lastSeenAtIso, timeZone),
        lastSeenAtIso,
      },
      detailMeta: {
        sourceKind: 'snapshot_backed_live',
        sourceLabel: 'Live broker snapshot',
        freshnessModel: 'scheduler_snapshot',
        fetchedAt: this.formatDisplayTime(fetchedAtIso, timeZone),
        fetchedAtIso,
        canLagAfterBrokerWrite: true,
      },
    };
  }

  private decoratePaperOrderDetail(
    order: Record<string, unknown>,
    timeZone: string
  ): Record<string, unknown> {
    const fetchedAtIso = new Date(Date.now()).toISOString();
    return {
      ...order,
      source: 'paper_orders',
      detailMeta: {
        sourceKind: 'paper_simulation',
        sourceLabel: 'Paper order simulation',
        freshnessModel: 'db_backed_simulation',
        fetchedAt: this.formatDisplayTime(fetchedAtIso, timeZone),
        fetchedAtIso,
        canLagAfterBrokerWrite: false,
      },
    };
  }

  private buildPaperExecutionHistory(events: Array<Record<string, unknown> | null>): Array<Record<string, unknown>> {
    return events
      .filter((event): event is Record<string, unknown> => Boolean(event))
      .sort((left, right) => {
        const leftAt = Date.parse(String(left.at || ''));
        const rightAt = Date.parse(String(right.at || ''));
        if (!Number.isFinite(leftAt) && !Number.isFinite(rightAt)) {
          return 0;
        }
        if (!Number.isFinite(leftAt)) {
          return 1;
        }
        if (!Number.isFinite(rightAt)) {
          return -1;
        }
        return leftAt - rightAt;
      });
  }

  private derivePaperLifecycleStage(
    status: string,
    executionState: string | null
  ): 'open_order' | 'open_position' | 'closed_position' | 'cancelled_order' {
    const normalizedStatus = String(status || '').trim().toUpperCase();
    const normalizedExecutionState = String(executionState || '')
      .trim()
      .toLowerCase();

    if (normalizedStatus === 'CANCELLED') {
      return 'cancelled_order';
    }
    if (normalizedStatus === 'CLOSED' || normalizedExecutionState === 'closed') {
      return 'closed_position';
    }
    if (normalizedStatus === 'FILLED' || normalizedExecutionState === 'filled') {
      return 'open_position';
    }
    return 'open_order';
  }

  private mapPaperOrder(item: {
    id: string;
    suggestedTradeId: string | null;
    assetId: string;
    brokerKey: string;
    accountId: string;
    symbol: string | null;
    side: string | null;
    orderType: string | null;
    triggerType: string | null;
    status: string;
    leverage: number | null;
    quantity: string | null;
    orderPrice: string | null;
    stoplossPrice: string | null;
    takeprofitPrice: string | null;
    reduceOnly: boolean;
    canceledAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    payload: Record<string, unknown> | null;
  }, timeZone: string): Record<string, unknown> {
    const payload =
      item.payload && typeof item.payload === 'object' && !Array.isArray(item.payload)
        ? item.payload
        : {};
    const simulation =
      payload.simulation &&
      typeof payload.simulation === 'object' &&
      !Array.isArray(payload.simulation)
        ? (payload.simulation as Record<string, unknown>)
        : {};
    const executionState =
      simulation.executionState === undefined ? null : String(simulation.executionState);
    const lastPrice =
      simulation.lastPrice === undefined ? null : simulation.lastPrice;
    const lastPriceSeenAt =
      simulation.lastPriceSeenAt === undefined ? null : simulation.lastPriceSeenAt;
    const filledAt =
      simulation.filledAt === undefined ? null : simulation.filledAt;
    const filledPrice =
      simulation.filledPrice === undefined ? null : simulation.filledPrice;
    const filledQuantity =
      simulation.filledQuantity === undefined ? null : simulation.filledQuantity;
    const remainingQuantity =
      simulation.remainingQuantity === undefined ? null : simulation.remainingQuantity;
    const positionOpenedAt =
      simulation.positionOpenedAt === undefined ? null : simulation.positionOpenedAt;
    const positionClosedAt =
      simulation.positionClosedAt === undefined ? null : simulation.positionClosedAt;
    const closedAt =
      simulation.closedAt === undefined ? positionClosedAt : simulation.closedAt;
    const exitPrice =
      simulation.exitPrice === undefined ? null : simulation.exitPrice;
    const realizedPnl =
      simulation.realizedPnl === undefined ? null : simulation.realizedPnl;
    const outcome =
      simulation.outcome === undefined ? null : simulation.outcome;
    const positionId =
      simulation.positionId === undefined ? null : simulation.positionId;
    const positionStatus =
      simulation.positionStatus === undefined ? null : simulation.positionStatus;
    const closeReason =
      simulation.closeReason === undefined ? null : simulation.closeReason;
    const lastObservationSource =
      simulation.lastObservationSource === undefined
        ? null
        : simulation.lastObservationSource;
    const lifecycleStage = this.derivePaperLifecycleStage(
      item.status,
      executionState
    );
    const createdAtIso = this.formatRawIso(item.createdAt);
    const updatedAtIso = this.formatRawIso(item.updatedAt);
    const canceledAtIso = this.formatRawIso(item.canceledAt);
    const filledAtIso = this.normalizeSnapshotTimestamp(filledAt);
    const lastPriceSeenAtIso = this.normalizeSnapshotTimestamp(lastPriceSeenAt);
    const positionOpenedAtIso = this.normalizeSnapshotTimestamp(positionOpenedAt);
    const positionClosedAtIso = this.normalizeSnapshotTimestamp(positionClosedAt);
    const closedAtIso = this.normalizeSnapshotTimestamp(closedAt);
    const executionHistory = this.buildPaperExecutionHistory([
      {
        type: 'created',
        at: this.formatDisplayTime(createdAtIso, timeZone),
        atIso: createdAtIso,
        source: 'paper_orders',
      },
      filledAt
        ? {
            type: 'filled',
            at: this.formatDisplayTime(filledAtIso, timeZone),
            atIso: filledAtIso,
            source: lastObservationSource || 'simulation',
            price: filledPrice,
            quantity: filledQuantity,
          }
        : null,
      item.canceledAt
        ? {
            type: 'cancelled',
            at: this.formatDisplayTime(canceledAtIso, timeZone),
            atIso: canceledAtIso,
            source: 'paper_orders',
          }
        : null,
      closedAt
        ? {
            type: 'closed',
            at: this.formatDisplayTime(closedAtIso, timeZone),
            atIso: closedAtIso,
            source: lastObservationSource || 'simulation',
            price: exitPrice,
            outcome,
            reason: closeReason,
          }
        : null,
    ]);
    const lastTransition = executionHistory.length
      ? executionHistory[executionHistory.length - 1]
      : {
          type: 'created',
          at: this.formatDisplayTime(createdAtIso, timeZone),
          atIso: createdAtIso,
        };
    const canCancel = ['OPEN', 'PENDING', 'CREATED'].includes(
      String(item.status || '').trim().toUpperCase()
    );

    return {
      id: item.id,
      order_id: item.id,
      mode: 'paper',
      suggested_trade_id: item.suggestedTradeId,
      asset_id: item.assetId,
      broker_key: item.brokerKey,
      account_id: item.accountId,
      symbol: item.symbol,
      side: item.side,
      order_type: item.orderType,
      trigger_type: item.triggerType,
      status: item.status,
      leverage: item.leverage,
      quantity: item.quantity,
      order_price: item.orderPrice,
      stoploss_price: item.stoplossPrice,
      takeprofit_price: item.takeprofitPrice,
      reduce_only: item.reduceOnly,
      execution_state: executionState,
      last_price: lastPrice,
      filled_price: filledPrice,
      filled_quantity: filledQuantity,
      remaining_quantity: remainingQuantity,
      exit_price: exitPrice,
      realized_pnl: realizedPnl,
      outcome,
      position_id: positionId,
      position_status: positionStatus,
      close_reason: closeReason,
      last_observation_source: lastObservationSource,
      lifecycle_stage: lifecycleStage,
      lifecycle_terminal: ['closed_position', 'cancelled_order'].includes(
        lifecycleStage
      ),
      lifecycle_can_cancel: canCancel,
      lifecycle_last_transition_type: String(lastTransition.type || 'created'),
      lifecycle_last_transition_at: String(
        lastTransition.at || this.formatDisplayTime(createdAtIso, timeZone)
      ),
      execution_history: executionHistory,
      lifecycle: {
        stage: lifecycleStage,
        terminal: ['closed_position', 'cancelled_order'].includes(lifecycleStage),
        canCancel,
        lastTransition: {
          type: String(lastTransition.type || 'created'),
          at: String(lastTransition.at || this.formatDisplayTime(createdAtIso, timeZone)),
          atIso: String(lastTransition.atIso || createdAtIso || ''),
        },
        timeline: {
          createdAt: this.formatDisplayTime(createdAtIso, timeZone),
          createdAtIso,
          updatedAt: this.formatDisplayTime(updatedAtIso, timeZone),
          updatedAtIso,
          canceledAt: this.formatDisplayTime(canceledAtIso, timeZone),
          canceledAtIso,
          filledAt: this.formatDisplayTime(filledAtIso, timeZone),
          filledAtIso,
          positionOpenedAt: this.formatDisplayTime(positionOpenedAtIso, timeZone),
          positionOpenedAtIso,
          positionClosedAt: this.formatDisplayTime(positionClosedAtIso, timeZone),
          positionClosedAtIso,
          closedAt: this.formatDisplayTime(closedAtIso, timeZone),
          closedAtIso,
          lastPriceSeenAt: this.formatDisplayTime(lastPriceSeenAtIso, timeZone),
          lastPriceSeenAtIso,
        },
        observation: {
          source: lastObservationSource,
          lastPrice,
        },
      },
      canceled_at: this.formatDisplayTime(canceledAtIso, timeZone),
      canceledAtIso,
      created_at: this.formatDisplayTime(createdAtIso, timeZone),
      createdAtIso,
      updated_at: this.formatDisplayTime(updatedAtIso, timeZone),
      updatedAtIso,
      last_price_seen_at: this.formatDisplayTime(lastPriceSeenAtIso, timeZone),
      lastPriceSeenAtIso,
      filled_at: this.formatDisplayTime(filledAtIso, timeZone),
      filledAtIso,
      position_opened_at: this.formatDisplayTime(positionOpenedAtIso, timeZone),
      positionOpenedAtIso,
      position_closed_at: this.formatDisplayTime(positionClosedAtIso, timeZone),
      positionClosedAtIso,
      closed_at: this.formatDisplayTime(closedAtIso, timeZone),
      closedAtIso,
      payload: item.payload ?? null,
    };
  }

  private async listOrderSnapshots(
    userId: string,
    brokerKey: string,
    accountId: string,
    opts: {
      openOnly: boolean;
      limit?: number;
      startDate?: string;
      endDate?: string;
    }
  ): Promise<unknown[]> {
    const limit = opts.limit && Number.isFinite(opts.limit) ? Math.max(1, Math.floor(opts.limit)) : 100;
    const openOnly = Boolean(opts.openOnly);
    const timeZone = await this.userTimeZoneService.resolveUserTimeZone(userId);
    const { startUtc, endUtc } = getUtcDateRangeFromLocalDates(opts.startDate, opts.endDate, timeZone);

    const where: string[] = [
      'user_id = ?',
      'account_id = ?',
      'LOWER(broker_key) = ?',
    ];
    const params: Array<unknown> = [userId, accountId, brokerKey.toLowerCase()];

    if (startUtc && Number.isFinite(startUtc.getTime())) {
      where.push('last_seen_at >= ?');
      params.push(startUtc);
    }
    if (endUtc && Number.isFinite(endUtc.getTime())) {
      where.push('last_seen_at <= ?');
      params.push(endUtc);
    }

    // status_rank: 1=open/pending, 2=partial, 3=filled, 4=terminal closed/cancelled/etc
    where.push(openOnly ? 'status_rank > 0 AND status_rank <= 2' : 'status_rank >= 3');

    const rows = (await coreDataSource.query(
      `SELECT payload_json AS payload
       FROM scheduler_orders_snapshots
       WHERE ${where.join(' AND ')}
       ORDER BY last_seen_at DESC
       LIMIT ?`,
      [...params, limit]
    )) as Array<{ payload?: unknown }>;

    const parsed = rows.map((row) => this.parsePayloadJson(row.payload));
    // Keep the existing date filtering semantics (created_at/updated_at) on the payload itself.
    return this.applyDateRangeFilter(parsed, startUtc, endUtc).map((item) =>
      this.localizeShallowOrderRecord(item, timeZone)
    );
  }

  private async getOrderSnapshotByExternalId(
    userId: string,
    brokerKey: string,
    accountId: string,
    externalId: string,
    routeContext: {
      accountName?: string | null;
      accountKey?: string | null;
      accountStatus?: string | null;
    } = {},
    timeZone?: string
  ): Promise<unknown> {
    const rows = (await coreDataSource.query(
      `SELECT external_id AS externalId,
              payload_json AS payload,
              status_rank AS statusRank,
              first_seen_at AS firstSeenAt,
              last_seen_at AS lastSeenAt
       FROM scheduler_orders_snapshots
       WHERE user_id = ?
         AND account_id = ?
         AND LOWER(broker_key) = ?
         AND external_id = ?
       LIMIT 1`,
      [userId, accountId, brokerKey.toLowerCase(), externalId]
    )) as Array<{
      externalId?: string;
      payload?: unknown;
      statusRank?: number;
      firstSeenAt?: unknown;
      lastSeenAt?: unknown;
    }>;

    const row = rows?.[0];
    if (!row) {
      return {};
    }

    return this.decorateLiveSnapshotOrder(this.parsePayloadJson(row.payload), {
      brokerKey,
      accountId,
      accountName: routeContext.accountName,
      accountKey: routeContext.accountKey,
      accountStatus: routeContext.accountStatus,
      externalId: String(row.externalId || '').trim() || externalId,
      firstSeenAt: this.normalizeSnapshotTimestamp(row.firstSeenAt),
      lastSeenAt: this.normalizeSnapshotTimestamp(row.lastSeenAt),
      statusRank: Number(row.statusRank || 0),
    }, timeZone || 'UTC');
  }

  async getFuturesOrders(userId: string, query: OrdersQuery): Promise<unknown> {
    const params = validateOrdersQuery(query);
    const route = await this.brokerAccountRoutingService.resolve(userId, params.brokerKey, params.accountId, 'mudrex');
    const resolvedBrokerKey = String(route.brokerKey || '').trim() || 'mudrex';
    const resolvedAccountId = String(route.accountId || '').trim();
    return this.listOrderSnapshots(userId, resolvedBrokerKey, resolvedAccountId, {
      openOnly: true,
      limit: params.limit ? Number(params.limit) : undefined,
      startDate: params.startDate,
      endDate: params.endDate,
    });
  }

  async requestOrdersRefresh(
    userId: string,
    body: OrdersRefreshBody = {}
  ): Promise<OrdersRefreshRequestResponse> {
    const timeZone = await this.userTimeZoneService.resolveUserTimeZone(userId);
    const filters = validateOrdersRefreshBody(body);
    const scope = this.getOrdersSyncScope(filters.brokerKey, filters.accountId);
    const activeAccounts = await this.brokerAccountRepository.getActiveBrokerAccounts(
      userId,
      filters.brokerKey
    );
    const scopedAccounts = filters.accountId
      ? activeAccounts.filter((item) => item.id === filters.accountId)
      : activeAccounts;

    if (filters.accountId && !scopedAccounts.length) {
      throw new NotFoundAppError('Broker account not found for the requested orders refresh scope');
    }

    if (!scopedAccounts.length) {
      const requestedAtIso = new Date().toISOString();
      return {
        requested: false,
        state: 'idle',
        scope,
        brokerKey: filters.brokerKey,
        accountId: filters.accountId,
        requestedAt: this.formatDisplayTime(requestedAtIso, timeZone) || requestedAtIso,
        requestedAtIso,
        summary: 'No connected or idle broker routes are available for orders refresh on this desk.',
        processedAccounts: 0,
        failedAccounts: 0,
        fetchedRecords: 0,
        insertedRecords: 0,
        updatedRecords: 0,
        skippedRecords: 0,
        failures: [],
        time: buildApiTimeContract(timeZone),
      };
    }

    const result = await this.internalOrdersSyncService.runBatch(
      buildProductOwnedOrdersSyncRequest(userId, {
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
        : `Reconciled ${processedAccounts} route${processedAccounts === 1 ? '' : 's'} for the live orders desk.`;

    const requestedAtIso = new Date().toISOString();
    return {
      requested: true,
      state: failedAccounts > 0 ? 'warning' : 'completed',
      scope,
      brokerKey: filters.brokerKey,
      accountId: filters.accountId,
      requestedAt: this.formatDisplayTime(requestedAtIso, timeZone) || requestedAtIso,
      requestedAtIso,
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
      time: buildApiTimeContract(timeZone),
    };
  }

  async getOrdersSyncStatus(
    userId: string,
    query: OrdersSyncStatusQuery = {}
  ): Promise<OrdersSyncStatusResponse> {
    const timeZone = await this.userTimeZoneService.resolveUserTimeZone(userId);
    const filters = validateOrdersSyncStatusQuery(query);
    const brokerKey = this.readString(filters.brokerKey) || undefined;
    const accountId = this.readString(filters.accountId) || undefined;
    const scope = this.getOrdersSyncScope(brokerKey, accountId);
    const activeAccounts = await this.brokerAccountRepository.getActiveBrokerAccounts(
      userId,
      brokerKey
    );
    const scopedAccounts = accountId
      ? activeAccounts.filter((item) => item.id === accountId)
      : activeAccounts;

    if (accountId && !scopedAccounts.length) {
      throw new NotFoundAppError('Broker account not found for the requested orders sync scope');
    }

    const accountIds = scopedAccounts.map((item) => item.id);
    const [freshnessByAccountId, pendingStateByAccountId] = await Promise.all([
      this.ordersSyncDiagnosticsService.listFreshnessByAccountId(userId, accountIds),
      this.ordersSyncDiagnosticsService.listPendingSyncStateByAccountId(accountIds),
    ]);

    let latestCheckpointAt: string | null = null;
    let latestCheckpointTimestamp = 0;
    let latestSnapshotAt: string | null = null;
    let latestSnapshotTimestamp = 0;
    let nextRetryAt: string | null = null;
    let nextRetryTimestamp: number | null = null;
    let pendingRecords = 0;
    let failedRecords = 0;
    let resolvedRecords = 0;

    const items: OrdersSyncStatusItem[] = scopedAccounts.map((account) => {
      const freshness = this.buildOrdersAccountFreshness(
        {
          accountName: account.accountName,
          accountKey: account.accountKey,
        },
        freshnessByAccountId.get(account.id) || null,
        timeZone
      );
      const pendingState =
        pendingStateByAccountId.get(account.id) || {
          pendingRecords: 0,
          failedRecords: 0,
          resolvedRecords: 0,
          nextRetryAt: null,
          lastPendingUpdateAt: null,
        };

      pendingRecords += pendingState.pendingRecords;
      failedRecords += pendingState.failedRecords;
      resolvedRecords += pendingState.resolvedRecords;

      const checkpointAt = freshness?.checkpoint?.observedAtIso || freshness?.checkpoint?.observedAt || null;
      const checkpointTimestamp = checkpointAt ? this.toTimestamp(checkpointAt) : null;
      if (checkpointAt && checkpointTimestamp !== null && checkpointTimestamp > latestCheckpointTimestamp) {
        latestCheckpointTimestamp = checkpointTimestamp;
        latestCheckpointAt = checkpointAt;
      }

      const snapshotAt =
        freshness?.latestSnapshot?.observedAtIso || freshness?.latestSnapshot?.observedAt || null;
      const snapshotTimestamp = snapshotAt ? this.toTimestamp(snapshotAt) : null;
      if (snapshotAt && snapshotTimestamp !== null && snapshotTimestamp > latestSnapshotTimestamp) {
        latestSnapshotTimestamp = snapshotTimestamp;
        latestSnapshotAt = snapshotAt;
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
        nextRetryAt: this.formatDisplayTime(pendingState.nextRetryAt, timeZone),
        nextRetryAtIso: this.formatRawIso(pendingState.nextRetryAt),
        lastPendingUpdateAt: this.formatDisplayTime(pendingState.lastPendingUpdateAt, timeZone),
        lastPendingUpdateAtIso: this.formatRawIso(pendingState.lastPendingUpdateAt),
        warning,
      };
    });

    const freshness = this.summarizeOrdersGroupedFreshness(
      items.map((item) => ({
        freshness: item.freshness,
      })),
      timeZone
    );

    const presentation = this.buildOrdersSyncSummary(
      items,
      freshness,
      failedRecords,
      pendingRecords
    );

    const generatedAtIso = new Date().toISOString();
    return {
      state: presentation.state,
      label: presentation.label,
      summary: presentation.summary,
      generatedAt: this.formatDisplayTime(generatedAtIso, timeZone) || generatedAtIso,
      generatedAtIso,
      scope,
      brokerKey,
      accountId,
      totalAccounts: items.length,
      pendingRecords,
      failedRecords,
      resolvedRecords,
      items,
      freshness,
      latestCheckpointAt: this.formatDisplayTime(latestCheckpointAt, timeZone),
      latestCheckpointAtIso: latestCheckpointAt,
      latestSnapshotAt: this.formatDisplayTime(latestSnapshotAt, timeZone),
      latestSnapshotAtIso: latestSnapshotAt,
      nextRetryAt: this.formatDisplayTime(nextRetryAt, timeZone),
      nextRetryAtIso: nextRetryAt,
      time: buildApiTimeContract(timeZone),
    };
  }

  async getOrderSubmissionAttempts(
    userId: string,
    query: OrderSubmissionAttemptsQuery = {}
  ): Promise<OrderSubmissionAttemptsResponse> {
    const timeZone = await this.userTimeZoneService.resolveUserTimeZone(userId);
    const filters = validateOrderSubmissionAttemptsQuery(query);
    const { items, total } =
      await this.orderSubmissionRequestRepository.listSubmissionAttempts({
        userId,
        limit: filters.limit,
        offset: filters.offset,
        suggestedTradeId: filters.suggestedTradeId,
        status: filters.status,
        placementState: filters.placementState,
        reconciliationState: filters.reconciliationState,
        brokerKey: filters.brokerKey,
        accountId: filters.accountId,
      });

    return {
      items: items.map((item) => this.mapOrderSubmissionAttempt(item)),
      total,
      limit: filters.limit,
      offset: filters.offset,
      filters: this.buildOrderSubmissionFilterEcho(filters),
      time: buildApiTimeContract(timeZone),
    };
  }

  async getOrderSubmissionAttempt(
    userId: string,
    submissionId: string
  ): Promise<OrderSubmissionAttemptDetail> {
    const normalizedSubmissionId = String(submissionId || '').trim();
    if (!normalizedSubmissionId) {
      throw new BadRequestAppError('submissionId is required');
    }

    const submission = await this.orderSubmissionRequestRepository.findByUserAndId(
      userId,
      normalizedSubmissionId
    );
    if (!submission) {
      throw new NotFoundAppError('Order submission attempt not found');
    }

    return this.mapOrderSubmissionAttemptDetail(submission);
  }

  private async reconcileOrderSubmissionSnapshotState(
    submission: OrderSubmissionRequest,
    timeZone: string
  ): Promise<OrderSubmissionReconciliationResult> {
    const baseResult = (
      decision: OrderSubmissionReconciliationResult['decision'],
      message: string,
      nextSubmission: OrderSubmissionRequest = submission,
      matchedSnapshot: OrderSnapshotSourceRow | null = null
    ): OrderSubmissionReconciliationResult => ({
      decision,
      message,
      submission: this.mapOrderSubmissionAttempt(nextSubmission),
      matchedSnapshot: this.mapOrderSubmissionMatchedSnapshot(matchedSnapshot),
      missingEligibleAt: this.toOptionalIsoString(
        this.getOrderSubmissionMissingEligibleAt(nextSubmission)
      ),
      staleAfterMs: this.orderSubmissionReconciliationMissingAfterMs,
      time: buildApiTimeContract(timeZone),
    });

    if (submission.status !== 'completed' || submission.placementState !== 'placed') {
      return baseResult(
        'skipped',
        'Only completed placed submissions require broker snapshot reconciliation.'
      );
    }

    if (!['pending', 'missing'].includes(submission.reconciliationState)) {
      return baseResult(
        'skipped',
        `Submission reconciliation state is ${submission.reconciliationState}.`
      );
    }

    const brokerKey = String(submission.brokerKey || '').trim();
    const accountId = String(submission.accountId || '').trim();
    const brokerOrderId = String(submission.brokerOrderId || '').trim();

    if (!brokerKey || !accountId) {
      return baseResult(
        'skipped',
        'Submission does not have enough broker route data to reconcile.'
      );
    }

    if (!brokerOrderId) {
      if (!this.isOrderSubmissionMissingEligible(submission)) {
        return baseResult(
          'pending',
          'Broker response did not include an order id yet; waiting for the safe reconciliation threshold before marking missing.'
        );
      }

      if (submission.reconciliationState === 'missing') {
        return baseResult(
          'missing',
          'Submission is already marked missing because no broker order id was available after the safe threshold.'
        );
      }

      const updated = await this.orderSubmissionRequestRepository.markReconciliationMissing(
        submission,
        {
          lifecycleEvent: {
            type: 'broker_order_snapshot_missing',
            message:
              'Broker response did not include an order id after the safe reconciliation threshold.',
            details: {
              brokerKey,
              accountId,
              reason: 'missing_broker_order_id',
              staleAfterMs: this.orderSubmissionReconciliationMissingAfterMs,
            },
          },
        }
      );

      return baseResult(
        'missing',
        'No broker order id was available after the safe reconciliation threshold.',
        updated
      );
    }

    const snapshot = await this.ordersSnapshotSourceRepository.findOrderByExternalId(
      submission.userId,
      brokerKey,
      accountId,
      brokerOrderId
    );

    if (snapshot) {
      const updated =
        submission.reconciliationState === 'matched'
          ? submission
          : await this.orderSubmissionRequestRepository.markReconciliationMatched(
              submission,
              {
                brokerOrderStatus: snapshot.orderStatus,
                lifecycleEvent: {
                  type: 'broker_order_snapshot_matched',
                  message: 'Broker order was found in scheduler order snapshots.',
                  details: {
                    brokerKey,
                    accountId,
                    brokerOrderId,
                    orderStatus: snapshot.orderStatus,
                    statusRank: snapshot.statusRank,
                    firstSeenAt: this.toOptionalIsoString(snapshot.firstSeenAt),
                    lastSeenAt: this.toOptionalIsoString(snapshot.lastSeenAt),
                  },
                },
              }
            );

      return baseResult(
        'matched',
        'Broker order was confirmed in scheduler order snapshots.',
        updated,
        snapshot
      );
    }

    if (!this.isOrderSubmissionMissingEligible(submission)) {
      return baseResult(
        'pending',
        'Broker order is not visible in snapshots yet; waiting for the safe reconciliation threshold before marking missing.'
      );
    }

    if (submission.reconciliationState === 'missing') {
      return baseResult(
        'missing',
        'Broker order is still missing from scheduler snapshots after the safe threshold.'
      );
    }

    const updated = await this.orderSubmissionRequestRepository.markReconciliationMissing(
      submission,
      {
        lifecycleEvent: {
          type: 'broker_order_snapshot_missing',
          message: 'Broker order was not found in scheduler snapshots after the safe threshold.',
          details: {
            brokerKey,
            accountId,
            brokerOrderId,
            staleAfterMs: this.orderSubmissionReconciliationMissingAfterMs,
          },
        },
      }
    );

    return baseResult(
      'missing',
      'Broker order was not found in scheduler snapshots after the safe threshold.',
      updated
    );
  }

  async reconcileOrderSubmissionAttempt(
    userId: string,
    submissionId: string
  ): Promise<OrderSubmissionReconciliationResult> {
    const timeZone = await this.userTimeZoneService.resolveUserTimeZone(userId);
    const normalizedSubmissionId = String(submissionId || '').trim();
    if (!normalizedSubmissionId) {
      throw new BadRequestAppError('submissionId is required');
    }

    const submission = await this.orderSubmissionRequestRepository.findByUserAndId(
      userId,
      normalizedSubmissionId
    );
    if (!submission) {
      throw new NotFoundAppError('Order submission attempt not found');
    }

    return this.reconcileOrderSubmissionSnapshotState(submission, timeZone);
  }

  async reconcileOrderSubmissionAttempts(
    userId: string,
    query: OrderSubmissionReconcileQuery = {}
  ): Promise<OrderSubmissionReconciliationSweepResponse> {
    const timeZone = await this.userTimeZoneService.resolveUserTimeZone(userId);
    const filters = validateOrderSubmissionReconcileQuery(query);
    const candidates =
      await this.orderSubmissionRequestRepository.listReconciliationCandidates({
        userId,
        limit: filters.limit,
        brokerKey: filters.brokerKey,
        accountId: filters.accountId,
      });
    const items: OrderSubmissionReconciliationResult[] = [];

    for (const candidate of candidates) {
      items.push(await this.reconcileOrderSubmissionSnapshotState(candidate, timeZone));
    }

    return {
      items,
      total: items.length,
      matched: items.filter((item) => item.decision === 'matched').length,
      missing: items.filter((item) => item.decision === 'missing').length,
      pending: items.filter((item) => item.decision === 'pending').length,
      skipped: items.filter((item) => item.decision === 'skipped').length,
      limit: filters.limit,
      staleAfterMs: this.orderSubmissionReconciliationMissingAfterMs,
      filters: this.buildOrderSubmissionReconciliationFilterEcho(filters),
      time: buildApiTimeContract(timeZone),
    };
  }

  async createFuturesOrder(
    userId: string,
    assetId: string,
    body: CreateOrderBody,
    options: CreateFuturesOrderOptions = {}
  ): Promise<unknown> {
    let requestedRouteTarget = this.buildActivityRouteTarget(
      (body as { brokerKey?: string | null })?.brokerKey,
      (body as { accountId?: string | null })?.accountId
    );
    let alertSource = String(body?.brokerKey || 'orders');
    let activeSubmissionRequest: OrderSubmissionRequest | null = null;
    let normalizeCreateMutationError = false;
    try {
      const validatedBody = validateCreateOrderBody(body);
      const placementSuggestedTradeId =
        String(options.suggestedTradeId || validatedBody.suggested_trade_id || '').trim() ||
        null;
      const route = await this.brokerAccountRoutingService.resolve(userId, validatedBody.brokerKey, validatedBody.accountId, 'mudrex');
      const resolvedBrokerKey = String(route.brokerKey || '').trim();
      const resolvedAccountId = String(route.accountId || '').trim();
      const activityRouteTarget = this.buildActivityRouteTarget(
        resolvedBrokerKey,
        resolvedAccountId
      );
      requestedRouteTarget = activityRouteTarget;
      alertSource = resolvedBrokerKey || alertSource;
      if (!resolvedBrokerKey || !resolvedAccountId) {
        throw new BadRequestAppError('A broker route is required to create an order');
      }

      const submission = await this.beginCreateOrderSubmission(
        userId,
        assetId,
        resolvedBrokerKey,
        resolvedAccountId,
        validatedBody,
        placementSuggestedTradeId
      );

      if (Object.prototype.hasOwnProperty.call(submission, 'replayResponse')) {
        return submission.replayResponse;
      }
      activeSubmissionRequest = submission.request;

      const riskCheck = await this.riskService.evaluatePreTradeOrder(userId, route, {
        assetId,
        quantity: validatedBody.quantity,
        orderPrice: validatedBody.order_price,
        leverage: validatedBody.leverage
      });

      if (riskCheck.blocked) {
        const message = riskCheck.reason || 'Order blocked by risk policy';
        await this.operationalEventService.logActivity(userId, {
          type: 'Risk control',
          title: 'Order blocked by risk policy',
          status: 'Failed',
          route: 'Risk',
          stream: 'Controls',
          related: activityRouteTarget || resolvedAccountId || route.brokerKey,
          referenceId: riskCheck.policyId || resolvedAccountId,
          correlationId: activityRouteTarget || resolvedAccountId || undefined,
          description: `${message}${riskCheck.policyId ? ` (policy ${riskCheck.policyId})` : ''}`,
        });
        await this.operationalEventService.emitFailureAlert(userId, {
          channel: 'Risk',
          source: route.brokerKey || 'orders',
          message,
          route: 'Risk review',
        });
        throw new BadRequestAppError(message);
      }

      if (riskCheck.breaches.length) {
        await this.operationalEventService.logActivity(userId, {
          type: 'Risk control',
          title: 'Order submitted with risk warnings',
          status: 'In progress',
          route: 'Risk',
          stream: 'Controls',
          related: activityRouteTarget || resolvedAccountId || route.brokerKey,
          referenceId: riskCheck.policyId || resolvedAccountId,
          correlationId: activityRouteTarget || resolvedAccountId || undefined,
          description: `${riskCheck.breaches.join(' | ')}${riskCheck.policyId ? ` (policy ${riskCheck.policyId})` : ''}`,
        });
      }

      if (activeSubmissionRequest) {
        activeSubmissionRequest = await this.orderSubmissionRequestRepository.markBrokerSubmitting(
          activeSubmissionRequest,
          {
            type:
              validatedBody.execution_mode === 'paper'
                ? 'paper_order_create_started'
                : 'broker_call_started',
            message:
              validatedBody.execution_mode === 'paper'
                ? 'Paper order creation started after risk clearance.'
                : 'Broker placement call started after risk clearance.',
            details: {
              brokerKey: resolvedBrokerKey,
              accountId: resolvedAccountId,
              suggestedTradeId: placementSuggestedTradeId,
              riskWarningCount: riskCheck.breaches.length,
            },
          }
        );
      }
      normalizeCreateMutationError = true;

      if (validatedBody.execution_mode === 'paper') {
        const paperOrder = await this.paperOrderRepository.createPaperOrder({
          userId,
          suggestedTradeId: validatedBody.suggested_trade_id ?? null,
          assetId,
          brokerKey: resolvedBrokerKey,
          accountId: resolvedAccountId,
          symbol: validatedBody.symbol ?? null,
          side: validatedBody.side === 'short' ? 'SELL' : 'BUY',
          orderType: validatedBody.order_type,
          triggerType: validatedBody.trigger_type,
          status: 'OPEN',
          leverage: validatedBody.leverage,
          quantity: validatedBody.quantity,
          orderPrice: validatedBody.order_price,
          stoplossPrice: validatedBody.stoploss_price,
          takeprofitPrice: validatedBody.takeprofit_price,
          reduceOnly: validatedBody.reduce_only,
          payload: {
            source: 'paper-order',
            assetId,
            brokerKey: resolvedBrokerKey,
            accountId: resolvedAccountId,
          },
        });

        let refreshedPaperOrder = paperOrder;
        let simulatedOrderIds: string[] = [];

        try {
          const simulationResult =
            await this.paperOrderExecutionService.simulateUserPaperOrders(userId, {
              paperOrderIds: [paperOrder.id],
            });
          simulatedOrderIds = simulationResult.updatedOrderIds;
          refreshedPaperOrder =
            (await this.paperOrderRepository.getPaperOrderById(userId, paperOrder.id)) ||
            paperOrder;
        } catch (simulationError) {
          log.warn(
            `Paper order simulation follow-up failed after create ${paperOrder.id}: ${
              simulationError instanceof Error
                ? simulationError.stack || simulationError.message
                : String(simulationError)
            }`
          );
        }

        const response = successResponse({
          ...this.mapPaperOrder(refreshedPaperOrder, await this.userTimeZoneService.resolveUserTimeZone(userId)),
          message: 'Paper order created',
        });

        if (activeSubmissionRequest) {
          await this.orderSubmissionRequestRepository.markCompleted(
            activeSubmissionRequest,
            this.normalizeJsonRecord(response),
            {
              placementState: 'placed',
              brokerOrderStatus: refreshedPaperOrder.status,
              reconciliationState: 'not_required',
              lifecycleEvent: {
                type: 'paper_order_created',
                message: 'Paper order was created and stored locally.',
                details: {
                  paperOrderId: paperOrder.id,
                  suggestedTradeId: placementSuggestedTradeId,
                },
              },
            }
          );
        }

        try {
          if (validatedBody.suggested_trade_id) {
            await this.suggestedTradesService.linkSuggestedTradeOrder(
              userId,
              validatedBody.suggested_trade_id,
              {
                executionMode: 'paper',
                paperOrderId: paperOrder.id,
                paperOrderStatus: refreshedPaperOrder.status,
                brokerKey: resolvedBrokerKey,
                accountId: resolvedAccountId,
                orderType: validatedBody.order_type,
                triggerType: validatedBody.trigger_type,
                leverage: validatedBody.leverage,
                quantity: validatedBody.quantity,
                entryPrice: validatedBody.order_price,
                stopLossPrice: validatedBody.stoploss_price,
                takeProfitPrice: validatedBody.takeprofit_price,
                note: `Paper order created from accepted suggestion ${validatedBody.symbol || assetId}`.trim(),
              }
            );
          }

          if (simulatedOrderIds.length) {
            await this.suggestedTradesService.syncExecutionForPaperOrderUpdates(
              userId,
              simulatedOrderIds
            );
          }

          await this.operationalEventService.logActivity(userId, {
            type: 'Paper order',
            title: `Paper order created: ${assetId}`,
            status: 'Success',
            route: 'Orders',
            stream: 'Execution',
            related: activityRouteTarget || route.brokerKey,
            referenceId: paperOrder.id,
            correlationId: paperOrder.id,
            description: `Paper order queued for ${route.brokerKey}`,
          });
        } catch (sideEffectError) {
          log.warn(
            `Paper order follow-up failed after create ${paperOrder.id}: ${
              sideEffectError instanceof Error
                ? sideEffectError.stack || sideEffectError.message
                : String(sideEffectError)
            }`
          );
        }

        return response;
      }

      const result = await this.brokerRuntimeRegistry
        .getOrdersAdapter(route.brokerKey)
        .createOrder(assetId, { ...validatedBody, brokerKey: route.brokerKey, accountId: route.accountId }, route);

      const createdOrder = this.unwrapSuccessData(result);
      const createdOrderId =
        String(createdOrder.order_id || createdOrder.orderId || '').trim() || undefined;
      const createdOrderStatus =
        typeof createdOrder.status === 'string'
          ? createdOrder.status
          : typeof createdOrder.order_status === 'string'
            ? String(createdOrder.order_status)
            : undefined;
      const protectionStatus =
        typeof createdOrder.protection_status === 'string'
          ? String(createdOrder.protection_status)
          : undefined;
      const protectiveOrders = Array.isArray(createdOrder.protective_orders)
        ? createdOrder.protective_orders
        : [];
      const protectionAttached = protectionStatus === 'attached';

      if (activeSubmissionRequest) {
        await this.orderSubmissionRequestRepository.markCompleted(
          activeSubmissionRequest,
          this.normalizeJsonRecord(result),
          {
            placementState: 'placed',
            brokerOrderId: createdOrderId ?? null,
            brokerOrderStatus: createdOrderStatus ?? null,
            reconciliationState: 'pending',
            lifecycleEvent: {
              type: createdOrderId ? 'broker_order_accepted' : 'broker_order_without_id',
              message: createdOrderId
                ? 'Broker accepted the order; snapshot reconciliation is pending.'
                : 'Broker response did not include an order id; snapshot reconciliation will wait for the safe missing threshold.',
              details: {
                brokerKey: resolvedBrokerKey,
                accountId: resolvedAccountId,
                brokerOrderId: createdOrderId ?? null,
                brokerOrderStatus: createdOrderStatus ?? null,
                protectionStatus: protectionStatus ?? null,
                protectiveOrders,
                suggestedTradeId: placementSuggestedTradeId,
              },
            },
          }
        );
      }

      try {
        if (validatedBody.suggested_trade_id) {
          await this.suggestedTradesService.linkSuggestedTradeOrder(
            userId,
            validatedBody.suggested_trade_id,
            {
              executionMode: 'live',
              orderId: createdOrderId,
              brokerKey: resolvedBrokerKey,
              accountId: resolvedAccountId,
              orderStatus: createdOrderStatus,
              orderType: validatedBody.order_type,
              triggerType: validatedBody.trigger_type,
              leverage: validatedBody.leverage,
              quantity: validatedBody.quantity,
              entryPrice: validatedBody.order_price,
              stopLossPrice: validatedBody.stoploss_price,
              takeProfitPrice: validatedBody.takeprofit_price,
              note: protectionAttached
                ? `Order created from accepted suggestion ${validatedBody.symbol || assetId} with native SL/TP protection`.trim()
                : `Order created from accepted suggestion ${validatedBody.symbol || assetId}`.trim(),
            }
          );
        }

        await this.operationalEventService.logActivity(userId, {
          type: 'Order',
          title: `Order created: ${assetId}`,
          status: 'Success',
          route: 'Orders',
          stream: 'Execution',
          related: activityRouteTarget || route.brokerKey,
          referenceId: createdOrderId || route.accountId,
          correlationId: createdOrderId || route.accountId,
          description: protectionAttached
            ? `Order placed via ${route.brokerKey} with native SL/TP protection`
            : `Order placed via ${route.brokerKey}`,
        });
      } catch (sideEffectError) {
        log.warn(
          `Live order follow-up failed after create ${createdOrderId || assetId}: ${
            sideEffectError instanceof Error
              ? sideEffectError.stack || sideEffectError.message
              : String(sideEffectError)
          }`
        );
      }

      return result;
    } catch (error) {
      const normalizedError = normalizeCreateMutationError
        ? error instanceof ConflictAppError &&
          ['ORDER_IDEMPOTENCY_KEY_REUSED', 'ORDER_SUBMISSION_IN_PROGRESS'].includes(
            String(error.code || '')
          )
          ? error
          : this.normalizeCreateOrderError(error)
        : error instanceof Error
          ? error
          : new Error(String(error));

      if (activeSubmissionRequest) {
        try {
          await this.orderSubmissionRequestRepository.markFailed(
            activeSubmissionRequest,
            this.buildCreateOrderFailurePayload(normalizedError),
            {
              placementState: 'rejected',
              reconciliationState: 'not_required',
              lifecycleEvent: {
                type: normalizeCreateMutationError
                  ? 'broker_order_rejected'
                  : 'order_submission_blocked',
                message:
                  normalizedError instanceof Error
                    ? normalizedError.message
                    : String(normalizedError),
              },
            }
          );
        } catch (submissionError) {
          log.warn(
            `Order submission failure state could not be persisted for request ${activeSubmissionRequest.id}: ${
              submissionError instanceof Error
                ? submissionError.stack || submissionError.message
                : String(submissionError)
            }`
          );
        }
      }

      await this.operationalEventService.logActivity(userId, {
        type: 'Order',
        title: 'Order create failed',
        status: 'Failed',
        route: 'Orders',
        stream: 'Execution',
        related: requestedRouteTarget || alertSource || 'orders',
        correlationId:
          requestedRouteTarget ||
          String((body as { accountId?: string | null })?.accountId || '').trim() ||
          undefined,
        description:
          normalizedError instanceof Error
            ? normalizedError.message
            : String(normalizedError),
      });
      await this.operationalEventService.emitFailureAlert(userId, {
        channel: 'Trading',
        source: alertSource || 'orders',
        message: `Order create failed: ${
          normalizedError instanceof Error
            ? normalizedError.message
            : String(normalizedError)
        }`,
        route: 'Risk review',
      });
      throw normalizedError;
    }
  }

  async getPaperOrders(userId: string, query: OrdersQuery): Promise<unknown> {
    const params = validateOrdersQuery(query);
    const timeZone = await this.userTimeZoneService.resolveUserTimeZone(userId);
    const { startUtc, endUtc } = getUtcDateRangeFromLocalDates(
      params.startDate,
      params.endDate,
      timeZone
    );

    let brokerKey = params.brokerKey;
    let accountId = params.accountId;

    if (brokerKey || accountId) {
      const route = await this.brokerAccountRoutingService.resolve(
        userId,
        brokerKey,
        accountId,
        'mudrex'
      );
      brokerKey = route.brokerKey;
      accountId = route.accountId;
    }

    const simulationResult = await this.paperOrderExecutionService.simulateUserPaperOrders(
      userId,
      {
        brokerKey,
        accountId,
        limit: params.limit,
      }
    );
    if (simulationResult.updatedOrderIds.length) {
      await this.suggestedTradesService.syncExecutionForPaperOrderUpdates(
        userId,
        simulationResult.updatedOrderIds
      );
    }

    const items = await this.paperOrderRepository.listPaperOrders(userId, {
      brokerKey,
      accountId,
      limit: params.limit,
      startDate: startUtc,
      endDate: endUtc,
    });

    return items.map((item) => this.mapPaperOrder(item, timeZone));
  }

  async getPaperOrder(userId: string, paperOrderId: string): Promise<unknown> {
    const timeZone = await this.userTimeZoneService.resolveUserTimeZone(userId);
    const simulationResult = await this.paperOrderExecutionService.simulateUserPaperOrders(
      userId,
      {
        paperOrderIds: [paperOrderId],
      }
    );
    if (simulationResult.updatedOrderIds.length) {
      await this.suggestedTradesService.syncExecutionForPaperOrderUpdates(
        userId,
        simulationResult.updatedOrderIds
      );
    }
    const item = await this.paperOrderRepository.getPaperOrderById(userId, validateOrderId(paperOrderId));
    if (!item) {
      throw new BadRequestAppError('Paper order not found');
    }
    return successResponse(this.decoratePaperOrderDetail(this.mapPaperOrder(item, timeZone), timeZone));
  }

  async cancelPaperOrder(userId: string, paperOrderId: string): Promise<unknown> {
    const timeZone = await this.userTimeZoneService.resolveUserTimeZone(userId);
    const item = await this.paperOrderRepository.cancelPaperOrder(userId, validateOrderId(paperOrderId));
    if (!item) {
      throw new BadRequestAppError('Paper order not found');
    }

    const activityRouteTarget = this.buildActivityRouteTarget(item.brokerKey, item.accountId);

    if (item.suggestedTradeId) {
      await this.suggestedTradesService.syncExecutionForPaperOrderUpdates(userId, [item.id]);
    }

    await this.operationalEventService.logActivity(userId, {
      type: 'Paper order',
      title: `Paper order cancelled: ${item.id}`,
      status: 'Success',
      route: 'Orders',
      stream: 'Execution',
      related: activityRouteTarget || item.brokerKey,
      referenceId: item.id,
      correlationId: item.id,
      description: `Paper order cancelled for ${item.symbol || item.assetId}`,
    });

    return successResponse({
      ...this.mapPaperOrder(item, timeZone),
      message: 'Paper order cancelled',
    });
  }

  async getFuturesOrder(userId: string, orderId: string, query: OrdersQuery = {}): Promise<unknown> {
    const timeZone = await this.userTimeZoneService.resolveUserTimeZone(userId);
    const validatedOrderId = validateOrderId(orderId);
    const params = validateOrdersQuery(query);
    const route = await this.brokerAccountRoutingService.resolve(userId, params.brokerKey, params.accountId, 'mudrex');
    const resolvedBrokerKey = String(route.brokerKey || '').trim() || 'mudrex';
    const resolvedAccountId = String(route.accountId || '').trim();
    const account = resolvedAccountId
      ? await this.brokerAccountRepository.getBrokerAccountById(userId, resolvedAccountId)
      : null;
    const snapshot = await this.getOrderSnapshotByExternalId(
      userId,
      resolvedBrokerKey,
      resolvedAccountId,
      validatedOrderId,
      {
        accountName: account?.accountName || null,
        accountKey: account?.accountKey || null,
        accountStatus: account?.status || null,
      },
      timeZone
    );

    if (!snapshot || typeof snapshot !== 'object' || !Object.keys(snapshot).length) {
      throw new BadRequestAppError('Order not found in live snapshots');
    }

    return successResponse(snapshot);
  }

  async getFuturesOrderHistory(userId: string, query: OrdersQuery): Promise<unknown> {
    const params = validateOrdersQuery(query);
    const route = await this.brokerAccountRoutingService.resolve(userId, params.brokerKey, params.accountId, 'mudrex');
    const resolvedBrokerKey = String(route.brokerKey || '').trim() || 'mudrex';
    const resolvedAccountId = String(route.accountId || '').trim();
    return this.listOrderSnapshots(userId, resolvedBrokerKey, resolvedAccountId, {
      openOnly: false,
      limit: params.limit ? Number(params.limit) : undefined,
      startDate: params.startDate,
      endDate: params.endDate,
    });
  }

  async cancelFuturesOrder(userId: string, orderId: string, query: OrdersQuery = {}): Promise<unknown> {
    const validatedOrderId = validateOrderId(orderId);
    let resolvedBrokerKey = String(query?.brokerKey || '').trim();
    let resolvedAccountId = String(query?.accountId || '').trim();
    let activityRouteTarget = this.buildActivityRouteTarget(
      resolvedBrokerKey,
      resolvedAccountId
    );
    try {
      const params = validateOrdersQuery(query);
      const route = await this.brokerAccountRoutingService.resolve(userId, params.brokerKey, params.accountId, 'mudrex');
      resolvedBrokerKey = String(route.brokerKey || '').trim() || 'mudrex';
      resolvedAccountId = String(route.accountId || '').trim();
      activityRouteTarget = this.buildActivityRouteTarget(
        resolvedBrokerKey,
        resolvedAccountId
      );

      // Idempotency: if we already know the order is terminal from snapshots, don't call broker cancel.
      try {
        const snapshot = await this.getOrderSnapshotByExternalId(
          userId,
          resolvedBrokerKey,
          resolvedAccountId,
          validatedOrderId
        );
        if (snapshot && typeof snapshot === 'object' && this.isClosedSnapshotOrder(0, snapshot)) {
          const snapshotStatus = String((snapshot as { status?: string }).status || 'CLOSED').trim().toUpperCase() || 'CLOSED';
          await this.operationalEventService.logActivity(userId, {
            type: 'Order',
            title: `Order already terminal: ${validatedOrderId}`,
            status: 'Success',
            route: 'Orders',
            stream: 'Execution',
            related: activityRouteTarget || route.brokerKey,
            referenceId: validatedOrderId,
            correlationId: validatedOrderId,
            description: `Cancel skipped; order is already ${snapshotStatus}`,
          });
          return successResponse({
            message: `Order already in terminal state (${snapshotStatus})`,
            order_id: validatedOrderId,
            status: snapshotStatus,
          });
        }
      } catch {
        // If snapshot lookup fails/misses, continue with broker cancel attempt.
      }

      const result = await this.brokerRuntimeRegistry.getOrdersAdapter(route.brokerKey).cancelOrder(validatedOrderId, route);
      await this.operationalEventService.logActivity(userId, {
        type: 'Order',
        title: `Order cancelled: ${validatedOrderId}`,
        status: 'Success',
        route: 'Orders',
        stream: 'Execution',
        related: activityRouteTarget || route.brokerKey,
        referenceId: validatedOrderId,
        correlationId: validatedOrderId,
        description: `Order cancelled via ${route.brokerKey}`,
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Mudrex returns 400 "order is in terminal state" for idempotent cancels. Treat as success.
      if (message.toLowerCase().includes('terminal state')) {
        await this.operationalEventService.logActivity(userId, {
          type: 'Order',
          title: `Order already terminal: ${validatedOrderId}`,
          status: 'Success',
          route: 'Orders',
          stream: 'Execution',
          related: activityRouteTarget || resolvedBrokerKey || 'orders',
          referenceId: validatedOrderId,
          correlationId: validatedOrderId,
          description: message,
        });
        return successResponse({
          message,
          order_id: validatedOrderId,
          status: 'CLOSED',
        });
      }
      await this.operationalEventService.logActivity(userId, {
        type: 'Order',
        title: 'Order cancel failed',
        status: 'Failed',
        route: 'Orders',
        stream: 'Execution',
        related: activityRouteTarget || resolvedBrokerKey || 'orders',
        referenceId: validatedOrderId,
        correlationId: validatedOrderId,
        description: message,
      });
      await this.operationalEventService.emitFailureAlert(userId, {
        channel: 'Trading',
        source: resolvedBrokerKey || 'orders',
        message: `Order cancel failed (${validatedOrderId}): ${
          message
        }`,
        route: 'Risk review',
      });
      throw error;
    }
  }

  async getFuturesOrderHistoryForActiveAccounts(userId: string, query: OrdersQuery): Promise<unknown> {
    const params = validateOrdersQuery(query);
    const activeAccounts = await this.brokerAccountRepository.getActiveBrokerAccounts(
      userId,
      params.brokerKey
    );
    return this.getFuturesOrdersForActiveAccountsFromSnapshot(userId, activeAccounts, params, false);
  }


  async getFuturesOrdersForActiveAccounts(userId: string, query: OrdersQuery): Promise<unknown> {
    const params = validateOrdersQuery(query);
    const activeAccounts = await this.brokerAccountRepository.getActiveBrokerAccounts(
      userId,
      params.brokerKey
    );
    return this.getFuturesOrdersForActiveAccountsFromSnapshot(userId, activeAccounts, params, true);
  }


  private applyDateRangeFilter(data: unknown, startUtc?: Date, endUtc?: Date): unknown[] {
    const list = Array.isArray(data)
      ? data
      : Array.isArray((data as { data?: unknown[] })?.data)
        ? (data as { data: unknown[] }).data
        : [];

    if (!startUtc && !endUtc) {
      return list;
    }

    return list.filter((item) => {
      const row = item as { updated_at?: string; created_at?: string };
      const rawDate = row.updated_at || row.created_at;
      if (!rawDate) {
        return true;
      }
      const current = new Date(rawDate);
      if (Number.isNaN(current.getTime())) {
        return true;
      }
      if (startUtc && current < startUtc) {
        return false;
      }
      if (endUtc && current > endUtc) {
        return false;
      }
      return true;
    });
  }

  private async getFuturesOrdersForActiveAccountsFromSnapshot(
    userId: string,
    activeAccounts: Array<{
      id: string;
      accountName: string;
      accountKey: string;
      brokerKey: string;
      status: string;
    }>,
    params: { startDate?: string; endDate?: string },
    openOnly: boolean
  ): Promise<unknown> {
    if (!activeAccounts.length) {
      return {
        totalActiveAccounts: 0,
        successCount: 0,
        failureCount: 0,
        items: [],
      };
    }
    const timeZone = await this.userTimeZoneService.resolveUserTimeZone(userId);
    const { startUtc, endUtc } = getUtcDateRangeFromLocalDates(params.startDate, params.endDate, timeZone);
    const accountIds = activeAccounts.map((item) => item.id);
    const rows = await coreDataSource.query(
      `SELECT account_id AS accountId,
              external_id AS externalId,
              payload_json AS payload,
              status_rank AS statusRank,
              first_seen_at AS firstSeenAt,
              last_seen_at AS lastSeenAt
       FROM scheduler_orders_snapshots
       WHERE user_id = ?
         AND account_id IN (${accountIds.map(() => '?').join(', ')})
       ORDER BY last_seen_at DESC`,
      [userId, ...accountIds]
    );

    const grouped = new Map<
      string,
      Array<{
        payload: unknown;
        externalId: string | null;
        statusRank: number;
        firstSeenAt: string | null;
        lastSeenAt: string | null;
      }>
    >();
    for (const row of rows as Array<{
      accountId?: string;
      externalId?: string;
      payload?: unknown;
      statusRank?: number;
      firstSeenAt?: unknown;
      lastSeenAt?: unknown;
    }>) {
      const accountId = String(row.accountId || '').trim();
      if (!accountId) {
        continue;
      }
      if (!grouped.has(accountId)) {
        grouped.set(accountId, []);
      }
      grouped.get(accountId)?.push({
        payload: this.parsePayloadJson(row.payload),
        externalId: String(row.externalId || '').trim() || null,
        statusRank: Number(row.statusRank || 0),
        firstSeenAt: this.normalizeSnapshotTimestamp(row.firstSeenAt),
        lastSeenAt: this.normalizeSnapshotTimestamp(row.lastSeenAt),
      });
    }

    const items = activeAccounts.map((account) => {
      const raw = grouped.get(account.id) || [];
      const filtered = raw
        .filter((item) =>
          openOnly
            ? this.isOpenSnapshotOrder(item.statusRank, item.payload)
            : this.isClosedSnapshotOrder(item.statusRank, item.payload)
        )
        .map((item) => {
          const payload =
            item.payload && typeof item.payload === 'object' && !Array.isArray(item.payload)
              ? { ...(item.payload as Record<string, unknown>) }
              : {};
          payload.external_id ??= item.externalId;
          payload.first_seen_at ??= item.firstSeenAt;
          payload.last_seen_at ??= item.lastSeenAt;
          payload.snapshot_source ??= 'scheduler_orders_snapshots';
          payload.snapshot_status_rank ??= item.statusRank;
          payload.snapshot_state ??= openOnly ? 'open' : 'history';
          return payload;
        });
      const orders = this.applyDateRangeFilter(filtered, startUtc, endUtc);
      return {
        accountId: account.id,
        accountName: account.accountName,
        accountKey: account.accountKey,
        brokerKey: account.brokerKey,
        status: account.status,
        totalOrders: orders.length,
        data: orders,
        error: null,
      };
    });

    return {
      totalActiveAccounts: activeAccounts.length,
      successCount: items.length,
      failureCount: 0,
      items,
    };
  }

  private isOpenSnapshotOrder(statusRank: number, payload: unknown): boolean {
    if (statusRank > 0) {
      return statusRank <= 2;
    }
    const row = payload as { status?: string };
    const status = String(row?.status || '').trim().toUpperCase();
    if (!status) {
      return false;
    }
    return !['FILLED', 'COMPLETED', 'EXECUTED', 'CLOSED', 'CANCELLED', 'CANCELED', 'REJECTED', 'FAILED', 'EXPIRED'].includes(status);
  }

  private isClosedSnapshotOrder(statusRank: number, payload: unknown): boolean {
    if (statusRank > 0) {
      return statusRank >= 3;
    }
    const row = payload as { status?: string };
    const status = String(row?.status || '').trim().toUpperCase();
    if (!status) {
      return false;
    }
    return ['FILLED', 'COMPLETED', 'EXECUTED', 'CLOSED', 'CANCELLED', 'CANCELED', 'REJECTED', 'FAILED', 'EXPIRED'].includes(status);
  }

  // parsePayloadJson moved above to support both single-account and active-account snapshot reads.

}
