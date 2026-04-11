export type PositionsFreshnessState = 'fresh' | 'stale' | 'critical' | 'unknown';

export interface PositionsFreshnessIndicator {
  state: PositionsFreshnessState;
  observedAt: string | null;
  freshnessMs: number | null;
  staleAfterMs: number | null;
  criticalAfterMs: number | null;
  isStale: boolean;
  isCritical: boolean;
  source: string;
}

export interface PositionSummary {
  id: string;
  externalId?: string;
  symbol: string | null;
  side: string;
  sideKey: string;
  status: string;
  statusKey: string;
  quantity: number | null;
  entryPrice: number | null;
  currentPrice: number | null;
  closedPrice: number | null;
  unrealizedPnl: number | null;
  realizedPnl: number | null;
  leverage: number | null;
  liquidationPrice: number | null;
  exposure: number | null;
  createdAt?: string;
  updatedAt?: string;
  closedAt?: string;
}

export interface PositionRecord extends Record<string, unknown> {
  id: string;
  external_id?: string;
  externalId?: string;
  symbol?: string | null;
  side?: string;
  side_raw?: string | null;
  sideKey?: string;
  status?: string;
  status_raw?: string | null;
  statusKey?: string;
  quantity?: number | null;
  quantity_raw?: unknown;
  entry_price?: number | null;
  current_price?: number | null;
  closed_price?: number | null;
  unrealized_pnl?: number | null;
  realized_pnl?: number | null;
  realized?: number | null;
  leverage?: number | null;
  liquidation_price?: number | null;
  exposure?: number | null;
  created_at?: string;
  updated_at?: string;
  closed_at?: string;
  first_seen_at?: string;
  last_seen_at?: string;
  freshness?: PositionsFreshnessIndicator | null;
  accountId?: string;
  accountName?: string;
  accountKey?: string;
  brokerKey?: string;
  positionSummary?: PositionSummary;
}

export interface PositionLifecycleAccountContext {
  id: string;
  accountName: string;
  accountKey: string;
  brokerKey: string;
  status: string;
  mode?: string | null;
  purpose?: string | null;
  capabilities?: string | null;
  isDefault: boolean;
  lastSyncAt?: string | null;
}

export interface PositionLifecycleOrderItem {
  id: string;
  externalId?: string;
  kind: 'live' | 'paper';
  relation: 'position' | 'protection' | 'symbol';
  symbol?: string | null;
  status?: string | null;
  side?: string | null;
  orderType?: string | null;
  triggerType?: string | null;
  quantity?: number | null;
  orderPrice?: number | null;
  stopLossPrice?: number | null;
  takeProfitPrice?: number | null;
  reduceOnly?: boolean;
  linkedPositionId?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  detailUrl?: string;
}

export interface PositionLifecycleAlertItem {
  id: string;
  severity: string;
  channel: string;
  status: string;
  message: string;
  route?: string | null;
  source?: string | null;
  createdAt: string;
  detailUrl?: string;
}

export interface PositionLifecycleSuggestedTradeItem {
  id: string;
  symbol: string;
  timeframe: string;
  side: string;
  status: string;
  signalTime: string;
  confidence?: number | null;
  score?: number | null;
  executionMode?: 'live' | 'paper' | null;
  executionState?: string | null;
  linkedPositionId?: string | null;
  linkedOrderId?: string | null;
  linkedPaperOrderId?: string | null;
  sourceTemplateId?: string | null;
  sourceBacktestId?: string | null;
  detailUrl?: string;
  linkedEntities?: import('./UiState').LinkedEntityReference[];
}

export interface PositionLifecycleActivityItem {
  id: string;
  type: string;
  title: string;
  status: string;
  actor?: string | null;
  symbol?: string | null;
  stream?: string | null;
  route?: string | null;
  related?: string | null;
  referenceId?: string | null;
  correlationId?: string | null;
  description?: string | null;
  flags?: Array<{
    id: string;
    message: string;
    channel: string;
    time: string;
    status: string;
  }> | null;
  createdAt: string;
}

export interface PositionLifecycleSummary {
  relatedOrders: number;
  openAlerts: number;
  linkedSuggestedTrades: number;
  recentActivity: number;
}

export interface PositionsAccountFreshness {
  account: PositionsFreshnessIndicator | null;
  checkpoint: PositionsFreshnessIndicator | null;
  warning?: string | null;
}

export interface PositionsGroupedFreshnessSummary {
  observedAt: string | null;
  freshAccounts: number;
  staleAccounts: number;
  criticalAccounts: number;
  unknownAccounts: number;
  warning?: string | null;
}

export interface PositionLifecycleFreshness extends PositionsAccountFreshness {
  position: PositionsFreshnessIndicator | null;
}

export interface PositionLifecycleResponse {
  position: PositionRecord;
  account: PositionLifecycleAccountContext | null;
  summary: PositionLifecycleSummary;
  freshness?: PositionLifecycleFreshness | null;
  relatedOrders: PositionLifecycleOrderItem[];
  relatedAlerts: PositionLifecycleAlertItem[];
  relatedSuggestedTrades: PositionLifecycleSuggestedTradeItem[];
  recentActivity: PositionLifecycleActivityItem[];
  relatedLinks: import('./UiState').LinkedEntityReference[];
}

export interface PositionsAccountItem {
  accountId: string;
  accountName: string;
  accountKey: string;
  brokerKey: string;
  status: string;
  totalPositions?: number;
  totalHistory?: number;
  data: PositionRecord[];
  positions?: PositionRecord[];
  history?: PositionRecord[];
  freshness?: PositionsAccountFreshness | null;
  openOrders?: unknown[];
  closedOrders?: unknown[];
  error: string | null;
}

export interface PositionsGroupedResponse {
  totalActiveAccounts: number;
  successCount: number;
  failureCount: number;
  items: PositionsAccountItem[];
  freshness?: PositionsGroupedFreshnessSummary | null;
  openOrders?: unknown[];
  closedOrders?: unknown[];
}

export interface PositionsSyncStatusItem {
  accountId: string;
  accountName: string;
  accountKey: string;
  brokerKey: string;
  status: string;
  freshness: PositionsAccountFreshness | null;
  pendingRecords: number;
  failedRecords: number;
  resolvedRecords: number;
  nextRetryAt?: string | null;
  lastPendingUpdateAt?: string | null;
  warning?: string | null;
}

export interface PositionsSyncStatusResponse {
  state: 'healthy' | 'attention' | 'idle';
  label: string;
  summary: string;
  generatedAt: string;
  scope: 'desk' | 'broker' | 'account';
  brokerKey?: string;
  accountId?: string;
  totalAccounts: number;
  pendingRecords: number;
  failedRecords: number;
  resolvedRecords: number;
  items: PositionsSyncStatusItem[];
  freshness: PositionsGroupedFreshnessSummary | null;
  latestCheckpointAt?: string | null;
  nextRetryAt?: string | null;
}

export interface PositionsRefreshRequestResponse {
  requested: boolean;
  state: 'completed' | 'warning' | 'idle';
  scope: 'desk' | 'broker' | 'account';
  brokerKey?: string;
  accountId?: string;
  requestedAt: string;
  summary: string;
  processedAccounts: number;
  failedAccounts: number;
  fetchedRecords: number;
  insertedRecords: number;
  updatedRecords: number;
  skippedRecords: number;
  failures: string[];
}
