import type { SuggestedTradeRouteAttempt } from './SuggestedTrade';

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
  requestedLeverage?: number | null;
  confirmedOrderLeverage?: number | null;
  observedPositionLeverage?: number | null;
  leverageSource?: string | null;
  liquidationPrice: number | null;
  exposure: number | null;
  timeframe?: string | null;
  tradeTimeframe?: string | null;
  signalTime?: string | null;
  entryOrderType?: string | null;
  entryTriggerType?: string | null;
  entrySubmittedAt?: string | null;
  entryFilledAt?: string | null;
  entryOrderId?: string | null;
  executionProtection?: PositionExecutionProtectionContext | null;
  suggestedTradeId?: string | null;
  automationId?: string | null;
  automationRunId?: string | null;
  createdAt?: string;
  updatedAt?: string;
  closedAt?: string;
}

export interface PositionExecutionProtectionContext {
  state: string | null;
  source: string | null;
  attempts: number | null;
  lastError: string | null;
  checkedAt: string | null;
  attachedAt: string | null;
  replacementSubmittedAt?: string | null;
  stopLossPrice: number | null;
  takeProfitPrice: number | null;
  plannedStopLossPrice?: number | null;
  plannedTakeProfitPrice?: number | null;
  stopLossOrderId: string | null;
  takeProfitOrderId: string | null;
  trailingStop?: Record<string, unknown> | null;
}

export type PositionLifecycleEventKind =
  | 'signal'
  | 'broker_route'
  | 'order'
  | 'position'
  | 'protection'
  | 'exit'
  | 'sync';

export interface PositionLifecycleEventItem {
  id: string;
  kind: PositionLifecycleEventKind;
  label: string;
  description: string;
  occurredAt: string;
  entity?: string | null;
  entityId?: string | null;
  brokerKey?: string | null;
  accountId?: string | null;
  status?: string | null;
  severity?: 'info' | 'success' | 'warning' | 'error';
  meta?: Record<string, unknown> | null;
}

export interface PositionAutomationTradeContext {
  suggestedTradeId: string;
  automationId: string | null;
  automationRunId: string | null;
  timeframe: string;
  signalTime: string | null;
  side: string | null;
  entryOrderId: string | null;
  entryOrderType: string | null;
  entryTriggerType: string | null;
  entrySubmittedAt: string | null;
  entryFilledAt: string | null;
  entryPrice: number | null;
  filledPrice: number | null;
  executionState: string | null;
  positionStatus: string | null;
  protection: PositionExecutionProtectionContext | null;
  routeAttempts?: SuggestedTradeRouteAttempt[] | null;
  operatorTimeline?: PositionLifecycleEventItem[];
  sourceTemplateId: string | null;
  sourceBacktestId: string | null;
  traceMethod: 'position_id' | 'symbol_entry' | 'unmatched';
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
  requested_leverage?: number | null;
  confirmed_order_leverage?: number | null;
  observed_position_leverage?: number | null;
  leverage_source?: string | null;
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
  timeframe?: string | null;
  trade_timeframe?: string | null;
  tradeTimeframe?: string | null;
  signal_time?: string | null;
  signalTime?: string | null;
  entry_order_type?: string | null;
  entryOrderType?: string | null;
  entry_trigger_type?: string | null;
  entryTriggerType?: string | null;
  entry_submitted_at?: string | null;
  entrySubmittedAt?: string | null;
  entry_filled_at?: string | null;
  entryFilledAt?: string | null;
  entry_order_id?: string | null;
  entryOrderId?: string | null;
  executionProtection?: PositionExecutionProtectionContext | null;
  suggested_trade_id?: string | null;
  suggestedTradeId?: string | null;
  automation_id?: string | null;
  automationId?: string | null;
  automation_run_id?: string | null;
  automationRunId?: string | null;
  trade_context_source?: PositionAutomationTradeContext['traceMethod'];
  tradeContextSource?: PositionAutomationTradeContext['traceMethod'];
  automationTrade?: PositionAutomationTradeContext | null;
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
  orderStatus?: string | null;
  paperOrderStatus?: string | null;
  entrySubmittedAt?: string | null;
  entryFilledAt?: string | null;
  filledPrice?: number | null;
  filledQuantity?: number | null;
  remainingQuantity?: number | null;
  positionOpenedAt?: string | null;
  positionClosedAt?: string | null;
  exitPrice?: number | null;
  realizedPnl?: number | null;
  protection?: PositionExecutionProtectionContext | null;
  routeAttempts?: SuggestedTradeRouteAttempt[] | null;
  operatorTimeline?: PositionLifecycleEventItem[];
  sourceTemplateId?: string | null;
  sourceBacktestId?: string | null;
  stopLossPrice?: number | null;
  targetPrice?: number | null;
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
  attentionObservedAt?: string | null;
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
