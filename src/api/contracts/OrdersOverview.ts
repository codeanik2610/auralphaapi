import { OrdersSyncStatusResponse } from './Orders';
import { ApiTimeContract } from './Time';

export interface OrdersOverviewMeta {
  contractVersion: string;
  purpose: 'global_execution_console';
  generatedAt: string;
  generatedAtIso?: string;
  summary: string;
  query: {
    supported: string[];
    unsupported: string[];
    behavior: {
      defaultScope: 'all_active_connected_accounts';
      brokerKey: 'limits_active_accounts_before_aggregation';
      accountId: 'post_aggregation_row_filter';
      startDate: 'applies_to_history_and_paper_only';
      endDate: 'applies_to_history_and_paper_only';
      limit: 'not_supported_on_orders_overview';
      syncStatus: 'follows_desk_broker_or_selected_route_scope_without_failing_on_empty_account_post_filter';
    };
    resolved: {
      brokerKey: string | null;
      accountId: string | null;
      startDate: string | null;
      endDate: string | null;
    };
  };
  sources: {
    openOrders: string;
    history: string;
    paperOrders: string;
    paperSimulation: string;
    createSubmissionLedger: string;
    syncStatus: string;
    createLive: string;
    createPaper: string;
    cancelLive: string;
    cancelPaper: string;
  };
  pageTruth: {
    monitoringScope: 'global_active_accounts';
    creationScope: 'selected_broker_route';
    liveReadModel: 'snapshot_backed';
    paperReadModel: 'db_backed_simulated';
    detailDrawerSource: 'canonical_detail_fetch_with_row_fallback';
    activityTrailSource: 'activity_logs_route_and_reference_filters';
    liveWriteFlow: 'broker_write_with_snapshot_ack_polling';
    paperWriteFlow: 'db_write_with_local_reconciliation';
    createMutationHardening: 'server_idempotency_keys_and_normalized_rejections';
    workspaceStructure: 'workspace_ticket_detail_modules';
  };
  capabilities: {
    routeScopedCreate: boolean;
    routeScopedMonitoring: boolean;
    liveSnapshotFreshnessExposed: boolean;
    canonicalDetailFetchUsedByPage: boolean;
    paperExecutionScheduler: boolean;
    localPaperWriteReconciliationUsedByPage: boolean;
    targetedLiveSyncPollingUsedByPage: boolean;
    embeddedSyncStatus: boolean;
    executionSurfaceSplitByMode: boolean;
    executionActivityTrailUsedByPage: boolean;
    pageModulesSplitByConcern: boolean;
    createSubmitIdempotency: boolean;
    normalizedBrokerRejectCodes: boolean;
  };
  time?: ApiTimeContract;
}

export type OrdersOverviewSectionSource = 'scheduler_orders_snapshots';
export type OrdersOverviewRowModel = 'normalized_live_snapshot';
export type OrdersOverviewSnapshotState = 'open' | 'history';

export interface OrdersOverviewRoute {
  brokerKey: string;
  accountId: string;
  accountName: string;
  accountKey: string;
  status: string;
}

export interface OrdersOverviewSnapshot {
  source: OrdersOverviewSectionSource;
  statusRank: number;
  state: OrdersOverviewSnapshotState;
  firstSeenAt: string | null;
  firstSeenAtIso?: string | null;
  lastSeenAt: string | null;
  lastSeenAtIso?: string | null;
}

export interface OrdersOverviewOrderRow extends Record<string, unknown> {
  id: string;
  order_id: string;
  external_id: string;
  mode: 'live';
  source: OrdersOverviewSectionSource;
  brokerKey: string;
  broker_key: string;
  accountId: string;
  account_id: string;
  accountName: string;
  account_name: string;
  accountKey: string;
  account_key: string;
  accountStatus: string;
  account_status: string;
  symbol: string | null;
  side: string | null;
  status: string | null;
  order_type: string | null;
  trigger_type: string | null;
  quantity: number | null;
  filled_quantity: number | null;
  remaining_quantity: number | null;
  price: number | null;
  order_price: number | null;
  trigger_price: number | null;
  filled_price: number | null;
  last_price: number | null;
  stoploss_price: number | null;
  takeprofit_price: number | null;
  leverage: number | null;
  reduce_only: boolean | null;
  created_at: string | null;
  createdAtIso?: string | null;
  updated_at: string | null;
  updatedAtIso?: string | null;
  canceled_at: string | null;
  canceledAtIso?: string | null;
  first_seen_at: string | null;
  firstSeenAtIso?: string | null;
  last_seen_at: string | null;
  lastSeenAtIso?: string | null;
  snapshot_status_rank: number;
  snapshot_state: OrdersOverviewSnapshotState;
  route: OrdersOverviewRoute;
  snapshot: OrdersOverviewSnapshot;
  payload: Record<string, unknown>;
}

export interface OrdersOverviewSection {
  source: OrdersOverviewSectionSource;
  rowModel: OrdersOverviewRowModel;
  freshnessModel: 'snapshot_timestamp';
  latestSnapshotAt: string | null;
  latestSnapshotAtIso?: string | null;
  oldestSnapshotAt: string | null;
  oldestSnapshotAtIso?: string | null;
  totalRows: number;
  totalAccounts: number;
  items: OrdersOverviewOrderRow[];
}

export interface OrdersOverviewResponse {
  meta: OrdersOverviewMeta;
  syncStatus: OrdersSyncStatusResponse;
  openOrders: OrdersOverviewSection;
  history: OrdersOverviewSection;
  time?: ApiTimeContract;
}
