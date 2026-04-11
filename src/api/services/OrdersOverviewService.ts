import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import {
  OrdersOverviewOrderRow,
  OrdersOverviewResponse,
  OrdersOverviewSection,
  OrdersOverviewSnapshotState,
} from '../contracts/OrdersOverview';
import { OrdersSyncStatusResponse } from '../contracts/Orders';
import { NotFoundAppError } from '../errors/AppError';
import { successResponse } from '../utils/response';
import { BrokerOrdersFacadeService } from './BrokerOrdersFacadeService';
import { UserTimeZoneService } from './UserTimeZoneService';
import {
  buildApiTimeContract,
  formatApiDisplayTime,
  formatApiRawIso,
} from '../utils/apiTimeContract';

interface OrdersOverviewQuery {
  brokerKey?: string;
  accountId?: string;
  startDate?: string;
  endDate?: string;
}

interface OrdersOverviewAccountGroup {
  accountId?: string;
  accountName?: string;
  accountKey?: string;
  brokerKey?: string;
  status?: string;
  data?: unknown[];
}

const normalizeRoot = (response: unknown): Record<string, unknown> => {
  const root = (response as { data?: unknown })?.data ?? response;
  return root && typeof root === 'object' && !Array.isArray(root)
    ? (root as Record<string, unknown>)
    : {};
};

const isPresentValue = (value: unknown): boolean =>
  value !== undefined &&
  value !== null &&
  !(typeof value === 'string' && value.trim() === '');

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const pickValue = (record: Record<string, unknown>, keys: string[]): unknown => {
  for (const key of keys) {
    if (isPresentValue(record[key])) {
      return record[key];
    }
  }
  return null;
};

const pickString = (record: Record<string, unknown>, keys: string[]): string => {
  const value = pickValue(record, keys);
  return isPresentValue(value) ? String(value).trim() : '';
};

const pickNullableString = (
  record: Record<string, unknown>,
  keys: string[]
): string | null => {
  const value = pickValue(record, keys);
  if (!isPresentValue(value)) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized || null;
};

const pickNumber = (
  record: Record<string, unknown>,
  keys: string[]
): number | null => {
  const value = pickValue(record, keys);
  if (!isPresentValue(value)) {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const pickBoolean = (
  record: Record<string, unknown>,
  keys: string[]
): boolean | null => {
  const value = pickValue(record, keys);
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return null;
    }
    if (['true', '1', 'yes'].includes(normalized)) {
      return true;
    }
    if (['false', '0', 'no'].includes(normalized)) {
      return false;
    }
  }
  return null;
};

const pickIsoString = (
  record: Record<string, unknown>,
  keys: string[]
): string | null => {
  const value = pickValue(record, keys);
  if (!isPresentValue(value)) {
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
};

const applyRouteFilters = (
  items: OrdersOverviewOrderRow[],
  query: OrdersOverviewQuery
): OrdersOverviewOrderRow[] => {
  let filtered = items;
  if (query.brokerKey) {
    const key = String(query.brokerKey).toLowerCase();
    filtered = filtered.filter((item) =>
      String((item as { brokerKey?: string })?.brokerKey || '').toLowerCase() === key
    );
  }
  if (query.accountId) {
    const accountId = String(query.accountId);
    filtered = filtered.filter(
      (item) => String((item as { accountId?: string })?.accountId || '') === accountId
    );
  }
  return filtered;
};

@Service()
export class OrdersOverviewService {
  @Inject(() => BrokerOrdersFacadeService)
  private ordersService!: BrokerOrdersFacadeService;

  @Inject(() => UserTimeZoneService)
  private userTimeZoneService!: UserTimeZoneService;

  private normalizeQueryValue(value?: string): string | null {
    const normalized = String(value || '').trim();
    return normalized || null;
  }

  private isNotFoundError(error: unknown): boolean {
    return (
      error instanceof NotFoundAppError ||
      String((error as { httpCode?: unknown } | null)?.httpCode || '') === '404'
    );
  }

  private buildIdleSyncStatus(
    query: OrdersOverviewQuery,
    timeZone: string
  ): OrdersSyncStatusResponse {
    const brokerKey = this.normalizeQueryValue(query.brokerKey) || undefined;
    const accountId = this.normalizeQueryValue(query.accountId) || undefined;
    const scope = accountId ? 'account' : brokerKey ? 'broker' : 'desk';
    const scopeLabel = accountId
      ? 'the selected route'
      : brokerKey
        ? 'this broker scope'
        : 'this desk';

    const generatedAtIso = new Date(Date.now()).toISOString();
    return {
      state: 'idle',
      label: 'No routes',
      summary: `No connected or idle broker routes are available for orders sync in ${scopeLabel}.`,
      generatedAt: this.formatDisplayTime(generatedAtIso, timeZone) || generatedAtIso,
      generatedAtIso,
      scope,
      ...(brokerKey ? { brokerKey } : {}),
      ...(accountId ? { accountId } : {}),
      totalAccounts: 0,
      pendingRecords: 0,
      failedRecords: 0,
      resolvedRecords: 0,
      items: [],
      freshness: {
        observedAt: null,
        freshAccounts: 0,
        staleAccounts: 0,
        criticalAccounts: 0,
        unknownAccounts: 0,
        warning: null,
      },
      latestCheckpointAt: null,
      latestSnapshotAt: null,
      nextRetryAt: null,
      time: buildApiTimeContract(timeZone),
    };
  }

  private async getOverviewSyncStatus(
    userId: string,
    query: OrdersOverviewQuery,
    timeZone: string
  ): Promise<OrdersSyncStatusResponse> {
    try {
      return await this.ordersService.getOrdersSyncStatus(userId, {
        brokerKey: query.brokerKey,
        accountId: query.accountId,
      });
    } catch (error) {
      if (query.accountId && this.isNotFoundError(error)) {
        return this.buildIdleSyncStatus(query, timeZone);
      }
      throw error;
    }
  }

  private normalizeSectionItems(
    response: unknown,
    snapshotState: OrdersOverviewSnapshotState,
    timeZone: string
  ): OrdersOverviewOrderRow[] {
    const root = normalizeRoot(response);
    const rawItems = Array.isArray(root.items)
      ? (root.items as unknown[])
      : Array.isArray(response)
        ? response
        : [];

    const grouped = rawItems.some(
      (item) => Array.isArray((item as OrdersOverviewAccountGroup | null)?.data)
    );
    const rows = grouped
      ? rawItems.flatMap((group, groupIndex) => {
          const account = asRecord(group) as OrdersOverviewAccountGroup;
          const route = {
            accountId: String(account.accountId || '').trim(),
            accountName: String(account.accountName || '').trim(),
            accountKey: String(account.accountKey || '').trim(),
            brokerKey: String(account.brokerKey || '').trim(),
            status: String(account.status || '').trim(),
          };
          return Array.isArray(account.data)
            ? account.data.map((item, itemIndex) =>
                this.normalizeLiveOrderRow(
                  item,
                  route,
                  snapshotState,
                  `${route.accountId || 'account'}:${groupIndex}:${itemIndex}`,
                  timeZone
                )
              )
            : [];
        })
      : rawItems.map((item, index) =>
          this.normalizeLiveOrderRow(item, null, snapshotState, `row:${index}`, timeZone)
        );

    return rows.filter((item) => Boolean(item.id));
  }

  private normalizeLiveOrderRow(
    item: unknown,
    route: {
      accountId: string;
      accountName: string;
      accountKey: string;
      brokerKey: string;
      status: string;
    } | null,
    snapshotState: OrdersOverviewSnapshotState,
    fallbackId: string,
    timeZone: string
  ): OrdersOverviewOrderRow {
    const payload = asRecord(item);
    const routeRecord: Record<string, unknown> = {
      brokerKey: route?.brokerKey || payload.brokerKey || payload.broker_key || '',
      broker_key: route?.brokerKey || payload.broker_key || payload.brokerKey || '',
      accountId: route?.accountId || payload.accountId || payload.account_id || '',
      account_id: route?.accountId || payload.account_id || payload.accountId || '',
      accountName:
        route?.accountName ||
        pickString(payload, ['accountName', 'account_name', 'accountKey', 'account_key', 'accountId', 'account_id']),
      account_name:
        route?.accountName ||
        pickString(payload, ['account_name', 'accountName', 'account_key', 'accountKey', 'account_id', 'accountId']),
      accountKey:
        route?.accountKey || pickString(payload, ['accountKey', 'account_key', 'accountId', 'account_id']),
      account_key:
        route?.accountKey || pickString(payload, ['account_key', 'accountKey', 'account_id', 'accountId']),
      accountStatus: route?.status || pickString(payload, ['accountStatus', 'account_status', 'status']),
      account_status: route?.status || pickString(payload, ['account_status', 'accountStatus', 'status']),
    };

    const brokerKey = pickString(routeRecord, ['brokerKey', 'broker_key']);
    const accountId = pickString(routeRecord, ['accountId', 'account_id']);
    const accountName = pickString(routeRecord, ['accountName', 'account_name']);
    const accountKey = pickString(routeRecord, ['accountKey', 'account_key']);
    const accountStatus = pickString(routeRecord, ['accountStatus', 'account_status']);
    const id =
      pickString(payload, ['id', 'order_id', 'orderId', 'external_id', 'externalId']) ||
      fallbackId;
    const externalId =
      pickString(payload, ['external_id', 'externalId', 'id', 'order_id', 'orderId']) || id;
    const symbol = pickNullableString(payload, ['symbol']);
    const status = pickNullableString(payload, ['status']);
    const side = pickNullableString(payload, ['side']);
    const orderType = pickNullableString(payload, ['order_type', 'orderType']);
    const triggerType = pickNullableString(payload, ['trigger_type', 'triggerType']);
    const quantity = pickNumber(payload, ['quantity', 'actual_amount', 'desired_amount']);
    const filledQuantity = pickNumber(payload, ['filled_quantity', 'filledQuantity']);
    const remainingQuantity = pickNumber(payload, ['remaining_quantity', 'remainingQuantity']);
    const price = pickNumber(payload, ['price', 'order_price', 'orderPrice']);
    const orderPrice = pickNumber(payload, ['order_price', 'orderPrice', 'price']);
    const triggerPrice = pickNumber(payload, ['trigger_price', 'triggerPrice']);
    const filledPrice = pickNumber(payload, ['filled_price', 'filledPrice']);
    const lastPrice = pickNumber(payload, ['last_price', 'lastPrice']);
    const stoplossPrice = pickNumber(payload, ['stoploss_price', 'stopLossPrice']);
    const takeprofitPrice = pickNumber(payload, ['takeprofit_price', 'takeProfitPrice']);
    const leverage = pickNumber(payload, ['leverage']);
    const reduceOnly = pickBoolean(payload, ['reduce_only', 'reduceOnly']);
    const createdAtIso = pickIsoString(payload, ['created_at', 'createdAt']);
    const updatedAtIso = pickIsoString(payload, ['updated_at', 'updatedAt']);
    const canceledAtIso = pickIsoString(payload, ['canceled_at', 'canceledAt']);
    const firstSeenAtIso = pickIsoString(payload, ['first_seen_at', 'firstSeenAt']);
    const lastSeenAtIso = pickIsoString(payload, ['last_seen_at', 'lastSeenAt']);
    const snapshotStatusRank = pickNumber(payload, ['snapshot_status_rank', 'snapshotStatusRank']) || 0;
    const normalizedSnapshotState =
      pickNullableString(payload, ['snapshot_state', 'snapshotState']) === 'history'
        ? 'history'
        : pickNullableString(payload, ['snapshot_state', 'snapshotState']) === 'open'
          ? 'open'
          : snapshotState;

    return {
      ...payload,
      id,
      order_id: pickString(payload, ['order_id', 'orderId', 'id']) || id,
      external_id: externalId,
      mode: 'live',
      source: 'scheduler_orders_snapshots',
      brokerKey,
      broker_key: brokerKey,
      accountId,
      account_id: accountId,
      accountName,
      account_name: accountName,
      accountKey,
      account_key: accountKey,
      accountStatus,
      account_status: accountStatus,
      symbol,
      side,
      status,
      order_type: orderType,
      trigger_type: triggerType,
      quantity,
      filled_quantity: filledQuantity,
      remaining_quantity: remainingQuantity,
      price,
      order_price: orderPrice,
      trigger_price: triggerPrice,
      filled_price: filledPrice,
      last_price: lastPrice,
      stoploss_price: stoplossPrice,
      takeprofit_price: takeprofitPrice,
      leverage,
      reduce_only: reduceOnly,
      created_at: this.formatDisplayTime(createdAtIso, timeZone),
      createdAtIso,
      updated_at: this.formatDisplayTime(updatedAtIso, timeZone),
      updatedAtIso,
      canceled_at: this.formatDisplayTime(canceledAtIso, timeZone),
      canceledAtIso,
      first_seen_at: this.formatDisplayTime(firstSeenAtIso, timeZone),
      firstSeenAtIso,
      last_seen_at: this.formatDisplayTime(lastSeenAtIso, timeZone),
      lastSeenAtIso,
      snapshot_status_rank: snapshotStatusRank,
      snapshot_state: normalizedSnapshotState,
      route: {
        brokerKey,
        accountId,
        accountName,
        accountKey,
        status: accountStatus,
      },
      snapshot: {
        source: 'scheduler_orders_snapshots',
        statusRank: snapshotStatusRank,
        state: normalizedSnapshotState,
        firstSeenAt: this.formatDisplayTime(firstSeenAtIso, timeZone),
        firstSeenAtIso,
        lastSeenAt: this.formatDisplayTime(lastSeenAtIso, timeZone),
        lastSeenAtIso,
      },
      payload,
    };
  }

  private buildLiveSection(
    response: unknown,
    query: OrdersOverviewQuery,
    snapshotState: OrdersOverviewSnapshotState,
    timeZone: string
  ): OrdersOverviewSection {
    const rows = applyRouteFilters(this.normalizeSectionItems(response, snapshotState, timeZone), query);
    const snapshotTimes = rows
      .map((item) => item.snapshot?.lastSeenAtIso || item.lastSeenAtIso || item.snapshot?.lastSeenAt || item.last_seen_at || null)
      .filter(Boolean) as string[];
    const sortedSnapshotTimes = [...snapshotTimes].sort();
    const latestSnapshotAtIso =
      sortedSnapshotTimes.length > 0 ? sortedSnapshotTimes[sortedSnapshotTimes.length - 1] : null;
    const oldestSnapshotAtIso =
      sortedSnapshotTimes.length > 0 ? sortedSnapshotTimes[0] : null;
    return {
      source: 'scheduler_orders_snapshots',
      rowModel: 'normalized_live_snapshot',
      freshnessModel: 'snapshot_timestamp',
      latestSnapshotAt: this.formatDisplayTime(latestSnapshotAtIso, timeZone),
      latestSnapshotAtIso,
      oldestSnapshotAt: this.formatDisplayTime(oldestSnapshotAtIso, timeZone),
      oldestSnapshotAtIso,
      totalRows: rows.length,
      totalAccounts: new Set(rows.map((item) => item.accountId).filter(Boolean)).size,
      items: rows,
    };
  }

  private normalizeSyncStatusForOverview(
    status: OrdersSyncStatusResponse,
    timeZone: string
  ): OrdersSyncStatusResponse {
    const generatedAtIso = this.formatRawIso(status.generatedAtIso || status.generatedAt);
    const latestCheckpointAtIso = this.formatRawIso(
      status.latestCheckpointAtIso || status.latestCheckpointAt
    );
    const latestSnapshotAtIso = this.formatRawIso(
      status.latestSnapshotAtIso || status.latestSnapshotAt
    );
    const nextRetryAtIso = this.formatRawIso(status.nextRetryAtIso || status.nextRetryAt);

    return {
      ...status,
      generatedAt: this.formatDisplayTime(generatedAtIso, timeZone) || status.generatedAt,
      generatedAtIso: generatedAtIso || undefined,
      items: Array.isArray(status.items)
        ? status.items.map((item) => {
            const nextRetryIso = this.formatRawIso(item.nextRetryAtIso || item.nextRetryAt);
            const lastPendingUpdateIso = this.formatRawIso(
              item.lastPendingUpdateAtIso || item.lastPendingUpdateAt
            );
            const checkpointIso = this.formatRawIso(
              item.freshness?.checkpoint?.observedAtIso || item.freshness?.checkpoint?.observedAt
            );
            const snapshotIso = this.formatRawIso(
              item.freshness?.latestSnapshot?.observedAtIso ||
                item.freshness?.latestSnapshot?.observedAt
            );

            return {
              ...item,
              nextRetryAt: this.formatDisplayTime(nextRetryIso, timeZone),
              nextRetryAtIso: nextRetryIso,
              lastPendingUpdateAt: this.formatDisplayTime(lastPendingUpdateIso, timeZone),
              lastPendingUpdateAtIso: lastPendingUpdateIso,
              freshness: item.freshness
                ? {
                    ...item.freshness,
                    checkpoint: item.freshness.checkpoint
                      ? {
                          ...item.freshness.checkpoint,
                          observedAt: this.formatDisplayTime(checkpointIso, timeZone),
                          observedAtIso: checkpointIso,
                        }
                      : null,
                    latestSnapshot: item.freshness.latestSnapshot
                      ? {
                          ...item.freshness.latestSnapshot,
                          observedAt: this.formatDisplayTime(snapshotIso, timeZone),
                          observedAtIso: snapshotIso,
                        }
                      : null,
                  }
                : null,
            };
          })
        : [],
      freshness: status.freshness
        ? {
            ...status.freshness,
            observedAt: this.formatDisplayTime(
              status.freshness.observedAtIso || status.freshness.observedAt,
              timeZone
            ),
            observedAtIso: this.formatRawIso(
              status.freshness.observedAtIso || status.freshness.observedAt
            ),
          }
        : null,
      latestCheckpointAt: this.formatDisplayTime(latestCheckpointAtIso, timeZone),
      latestCheckpointAtIso,
      latestSnapshotAt: this.formatDisplayTime(latestSnapshotAtIso, timeZone),
      latestSnapshotAtIso,
      nextRetryAt: this.formatDisplayTime(nextRetryAtIso, timeZone),
      nextRetryAtIso,
      time: buildApiTimeContract(timeZone),
    };
  }

  async getOverview(
    userId: string,
    query: OrdersOverviewQuery
  ): Promise<ApiSuccessResponse<OrdersOverviewResponse>> {
    const timeZone = await this.userTimeZoneService.resolveUserTimeZone(userId);
    const [openOrders, history, syncStatusResponse] = await Promise.all([
      this.ordersService.getFuturesOrdersForActiveAccounts(userId, {
        brokerKey: query.brokerKey,
      }) as Promise<ApiSuccessResponse<unknown>>,
      this.ordersService.getFuturesOrderHistoryForActiveAccounts(userId, {
        brokerKey: query.brokerKey,
        startDate: query.startDate,
        endDate: query.endDate,
      }) as Promise<ApiSuccessResponse<unknown>>,
      this.getOverviewSyncStatus(userId, query, timeZone),
    ]);
    const syncStatus = this.normalizeSyncStatusForOverview(syncStatusResponse, timeZone);

    const openSection = this.buildLiveSection(openOrders, query, 'open', timeZone);
    const historySection = this.buildLiveSection(history, query, 'history', timeZone);
    const generatedAtIso = new Date(Date.now()).toISOString();

    return successResponse({
      meta: {
        contractVersion: 'orders-phase9-2026-04-10',
        purpose: 'global_execution_console',
        generatedAt: this.formatDisplayTime(generatedAtIso, timeZone) || generatedAtIso,
        generatedAtIso,
        summary:
          'Phase 9 keeps `/orders/overview` as the page-hydration contract: snapshot-backed open/history sections now travel with embedded orders sync status, while create-order submissions remain idempotent and broker rejection errors stay normalized for operators.',
        query: {
          supported: ['brokerKey', 'accountId', 'startDate', 'endDate'],
          unsupported: ['limit'],
          behavior: {
            defaultScope: 'all_active_connected_accounts',
            brokerKey: 'limits_active_accounts_before_aggregation',
            accountId: 'post_aggregation_row_filter',
            startDate: 'applies_to_history_and_paper_only',
            endDate: 'applies_to_history_and_paper_only',
            limit: 'not_supported_on_orders_overview',
            syncStatus:
              'follows_desk_broker_or_selected_route_scope_without_failing_on_empty_account_post_filter',
          },
          resolved: {
            brokerKey: this.normalizeQueryValue(query.brokerKey),
            accountId: this.normalizeQueryValue(query.accountId),
            startDate: this.normalizeQueryValue(query.startDate),
            endDate: this.normalizeQueryValue(query.endDate),
          },
        },
        sources: {
          openOrders: 'scheduler_orders_snapshots',
          history: 'scheduler_orders_snapshots',
          paperOrders: 'paper_orders',
          paperSimulation: 'paper_orders + market price simulation',
          createSubmissionLedger: 'order_submission_requests',
          syncStatus:
            'scheduler_orders_snapshots + scheduler_sync_checkpoints + scheduler_sync_pending_records',
          createLive: 'broker orders adapter',
          createPaper: 'paper_orders',
          cancelLive: 'broker orders adapter with snapshot-assisted idempotency',
          cancelPaper: 'paper_orders',
        },
        pageTruth: {
          monitoringScope: 'global_active_accounts',
          creationScope: 'selected_broker_route',
          liveReadModel: 'snapshot_backed',
          paperReadModel: 'db_backed_simulated',
          detailDrawerSource: 'canonical_detail_fetch_with_row_fallback',
          activityTrailSource: 'activity_logs_route_and_reference_filters',
          liveWriteFlow: 'broker_write_with_snapshot_ack_polling',
          paperWriteFlow: 'db_write_with_local_reconciliation',
          createMutationHardening: 'server_idempotency_keys_and_normalized_rejections',
          workspaceStructure: 'workspace_ticket_detail_modules',
        },
        capabilities: {
          routeScopedCreate: true,
          routeScopedMonitoring: true,
          liveSnapshotFreshnessExposed: true,
          canonicalDetailFetchUsedByPage: true,
          paperExecutionScheduler: true,
          localPaperWriteReconciliationUsedByPage: true,
          targetedLiveSyncPollingUsedByPage: true,
          embeddedSyncStatus: true,
          executionSurfaceSplitByMode: true,
          executionActivityTrailUsedByPage: true,
          pageModulesSplitByConcern: true,
          createSubmitIdempotency: true,
          normalizedBrokerRejectCodes: true,
        },
        time: buildApiTimeContract(timeZone),
      },
      syncStatus,
      openOrders: openSection,
      history: historySection,
      time: buildApiTimeContract(timeZone),
    });
  }

  private formatDisplayTime(
    value: Date | string | null | undefined,
    timeZone: string
  ): string | null {
    return formatApiDisplayTime(value, timeZone) || null;
  }

  private formatRawIso(value: Date | string | null | undefined): string | null {
    return formatApiRawIso(value) || null;
  }
}
