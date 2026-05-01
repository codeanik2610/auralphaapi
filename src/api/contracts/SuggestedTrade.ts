import type { ItemFreshness, LinkedEntityReference } from './UiState';

export type SuggestedTradeStatus = 'Open' | 'Reviewed' | 'Accepted' | 'Dismissed' | 'Expired';
export type SuggestedTradeSide = 'BUY' | 'SELL';
export type SuggestedTradeReviewStage =
  | 'needs_review'
  | 'reviewed'
  | 'accepted'
  | 'dismissed'
  | 'expired';
export type SuggestedTradeExecutionStage =
  | 'unlinked'
  | 'queued'
  | 'submitting'
  | 'linked'
  | 'working'
  | 'filled'
  | 'closed'
  | 'cancelled'
  | 'rejected'
  | 'expired'
  | 'failed'
  | 'unknown';
export type SuggestedTradeJourneyStage =
  | 'queue_review'
  | 'accept_trade'
  | 'link_order'
  | 'track_execution'
  | 'closed_out';
export type SuggestedTradeSyncState = 'untracked' | 'fresh' | 'stale' | 'attention' | 'settled';
export type SuggestedTradePageAction =
  | 'review'
  | 'accept'
  | 'dismiss'
  | 'link_order'
  | 'reconcile_execution';

export interface SuggestedTradeExecutionLink {
  executionMode?: 'live' | 'paper' | null;
  preTradeCheckId?: string | null;
  preTradeState?: 'not_requested' | 'queued' | 'passed' | 'blocked' | 'stale' | 'error' | null;
  preTradeCheckedAt?: string | null;
  preTradeBlockedReason?: string | null;
  acceptedBy?: 'user' | 'system' | null;
  acceptedAt?: string | null;
  orderId?: string | null;
  paperOrderId?: string | null;
  brokerKey?: string | null;
  accountId?: string | null;
  orderStatus?: string | null;
  paperOrderStatus?: string | null;
  executionState?:
    | 'queued'
    | 'submitting'
    | 'linked'
    | 'working'
    | 'filled'
    | 'cancelled'
    | 'rejected'
    | 'expired'
    | 'failed'
    | 'closed'
    | 'unknown'
    | null;
  orderType?: string | null;
  triggerType?: string | null;
  leverage?: number | null;
  quantity?: number | null;
  entryPrice?: string | null;
  stopLossPrice?: string | null;
  takeProfitPrice?: string | null;
  submittedAt?: string | null;
  linkedAt?: string | null;
  lastSeenAt?: string | null;
  trackedAt?: string | null;
  lastSyncAt?: string | null;
  filledAt?: string | null;
  canceledAt?: string | null;
  filledPrice?: string | null;
  filledQuantity?: number | null;
  remainingQuantity?: number | null;
  positionId?: string | null;
  positionStatus?: string | null;
  positionOpenedAt?: string | null;
  positionClosedAt?: string | null;
  exitPrice?: string | null;
  realizedPnl?: string | null;
  outcome?: 'open' | 'profit' | 'loss' | 'breakeven' | 'unknown' | null;
  note?: string | null;
}

export interface SuggestedTradeRouteCandidate {
  brokerKey: string;
  accountId: string;
  accountName?: string | null;
  requestedSymbol: string;
  brokerSymbol: string;
  candidateSymbols: string[];
  resolvedVia?:
    | 'catalog_exact'
    | 'catalog_equivalent'
    | 'remote_exact'
    | 'remote_equivalent'
    | null;
  supported: boolean;
  supportMessage?: string | null;
  allowed: boolean;
  blocked: boolean;
  summary: string;
  warningRuleCount: number;
  blockingRuleCount: number;
  freshnessState?: string | null;
}

export interface SuggestedTradeRouteDecision {
  mode: 'adaptive_candidate_live' | 'adaptive_candidate_shadow';
  decision: 'selected' | 'blocked';
  requestedSymbol: string;
  selectedBrokerKey?: string | null;
  selectedAccountId?: string | null;
  selectedAccountName?: string | null;
  selectedBrokerSymbol?: string | null;
  selectionReason: string;
  summary: string;
  decidedAt?: string | null;
  candidates: SuggestedTradeRouteCandidate[];
}

export interface SuggestedTradeSyncStatus {
  state: SuggestedTradeSyncState;
  label: string;
  summary: string;
  isStale: boolean;
  backgroundEnabled: boolean;
  manualReconcileAvailable: boolean;
  lastObservedAt?: string | null;
  lastSyncedAt?: string | null;
  nextCheckAt?: string | null;
  staleAfterMs?: number | null;
}

export interface SuggestedTradeLifecycle {
  signal: {
    entity: 'signal';
    entityId?: string | null;
    detectedAt: string;
    status: 'detected';
  };
  suggestedTrade: {
    entity: 'suggested_trade';
    entityId: string;
    status: SuggestedTradeStatus;
    createdAt: string;
    reviewedAt?: string | null;
    reviewNote?: string | null;
  };
  order?: {
    entity: 'order' | 'paper_order';
    entityId?: string | null;
    executionMode?: 'live' | 'paper' | null;
    status?: string | null;
    executionState?: SuggestedTradeExecutionStage | null;
    linkedAt?: string | null;
    lastSeenAt?: string | null;
  } | null;
  position?: {
    entity: 'position';
    entityId?: string | null;
    status?: string | null;
    openedAt?: string | null;
    closedAt?: string | null;
    outcome?: SuggestedTradeExecutionLink['outcome'];
  } | null;
  sync: SuggestedTradeSyncStatus;
}

export interface SuggestedTradeTimelineEvent {
  id: string;
  kind: 'signal' | 'suggested_trade' | 'review' | 'order' | 'position' | 'sync';
  label: string;
  description: string;
  occurredAt: string;
  entity?: string;
  entityId?: string | null;
  status?: string | null;
}

export interface SuggestedTradeItem {
  id: string;
  automationId: string;
  automationRunId: string;
  sourceBacktestId?: string | null;
  sourceTemplateId?: string | null;
  sourceSetupKey?: string | null;
  symbol: string;
  timeframe: string;
  side: SuggestedTradeSide;
  signalTime: string;
  status: string;
  confidence?: number | null;
  score?: number | null;
  entryPrice?: string | null;
  stopLossPrice?: string | null;
  takeProfitTargets?: string[] | null;
  entryRule?: string | null;
  exitRule?: string | null;
  rationale?: string | null;
  dedupeKey: string;
  meta?: Record<string, unknown> | null;
  routeDecision?: SuggestedTradeRouteDecision | null;
  execution?: SuggestedTradeExecutionLink | null;
  allowedActions?: SuggestedTradePageAction[];
  statusReason?: string;
  statusDisplay?: string;
  freshness?: ItemFreshness;
  linkedEntities?: LinkedEntityReference[];
  reviewStage?: SuggestedTradeReviewStage;
  executionStage?: SuggestedTradeExecutionStage;
  journeyStage?: SuggestedTradeJourneyStage;
  syncStatus?: SuggestedTradeSyncStatus;
  lifecycle?: SuggestedTradeLifecycle;
  timeline?: SuggestedTradeTimelineEvent[];
  createdAt: string;
  updatedAt: string;
}

export interface SuggestedTradesListResponse {
  items: SuggestedTradeItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface SuggestedTradesSummary {
  open: number;
  reviewed: number;
  accepted: number;
  dismissed: number;
  actionable: number;
  buySide: number;
  sellSide: number;
  queued: number;
  submitting: number;
  linked: number;
  working: number;
  filled: number;
  closed: number;
  freshnessAudit?: SuggestedTradesFreshnessAudit;
}

export interface SuggestedTradesFreshnessAuditWorstDelay {
  suggestedTradeId: string;
  symbol: string;
  timeframe: string;
  side: SuggestedTradeSide;
  signalTime: string;
  suggestedTradeCreatedAt: string;
  openedAt: string | null;
  executionMode?: 'live' | 'paper' | null;
  executionState?: SuggestedTradeExecutionStage | null;
  brokerKey?: string | null;
  accountId?: string | null;
  signalSelectionMode?: string | null;
  signalToSuggestionMinutes: number;
  signalToOpenMinutes: number | null;
  openAgeAfterCloseMinutes: number | null;
  maxAgeAfterCloseMinutes: number | null;
  stale: boolean;
}

export interface SuggestedTradesFreshnessAuditTimeframe {
  timeframe: string;
  totalSignals: number;
  openedSignals: number;
  staleOpenCount: number;
  averageSignalToSuggestionMinutes: number | null;
  averageSignalToOpenMinutes: number | null;
  maxSignalToOpenMinutes: number | null;
}

export interface SuggestedTradesFreshnessAudit {
  lookbackDays: number;
  windowStart: string;
  generatedAt: string;
  sampledSignals: number;
  totalSignals: number;
  openedSignals: number;
  staleOpenCount: number;
  staleBlockedCount: number;
  latestClosedOnlyCount: number;
  cursorGapCount: number;
  unknownSignalSelectionModeCount: number;
  averageSignalToSuggestionMinutes: number | null;
  averageSignalToOpenMinutes: number | null;
  maxSignalToOpenMinutes: number | null;
  byTimeframe: SuggestedTradesFreshnessAuditTimeframe[];
  worstDelays: SuggestedTradesFreshnessAuditWorstDelay[];
}

export interface SuggestedTradeStatusActionResult {
  message: string;
  suggestedTrade: {
    id: string;
    status: SuggestedTradeStatus;
    updatedAt: string;
    execution?: SuggestedTradeExecutionLink | null;
  };
}

export interface SuggestedTradeOrderLinkResult {
  message: string;
  suggestedTrade: {
    id: string;
    status: SuggestedTradeStatus;
    updatedAt: string;
    execution?: SuggestedTradeExecutionLink | null;
  };
}

export interface SuggestedTradeReconcileActionResult {
  message: string;
  refreshed: boolean;
  suggestedTrade: SuggestedTradeItem;
}

export interface SuggestedTradesExecutionSyncResult {
  message: string;
  processed: number;
  refreshed: number;
  staleOnly: boolean;
  suggestedTradeIds: string[];
}
