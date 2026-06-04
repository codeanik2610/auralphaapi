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
export type SuggestedTradeProtectionState =
  | 'pending'
  | 'waiting_for_fill'
  | 'waiting_for_position'
  | 'attaching'
  | 'attached'
  | 'failed'
  | 'manual_unlinked'
  | 'not_required'
  | 'unknown';
export type SuggestedTradeExecutionPreTradeState =
  | 'not_requested'
  | 'queued'
  | 'passed'
  | 'blocked'
  | 'stale'
  | 'error';
export type SuggestedTradeRouteAttemptStatus =
  | 'pending'
  | 'pre_trade_blocked'
  | 'submitting'
  | 'working'
  | 'placed'
  | 'failed'
  | 'manual_review'
  | 'unknown';
export type SuggestedTradeRouteAttemptSubmissionState =
  | 'not_started'
  | 'pre_trade'
  | 'submitting'
  | 'submitted'
  | 'accepted'
  | 'rejected'
  | 'failed'
  | 'unknown';
export type SuggestedTradeRouteAttemptFailureClassification =
  | 'confirmed_no_order'
  | 'ambiguous'
  | 'order_created_protection_unresolved'
  | 'unknown';
export type SuggestedTradeRouteAttemptReconciliationStatus =
  | 'not_required'
  | 'pending'
  | 'confirmed_no_order'
  | 'found_order'
  | 'found_position'
  | 'inconclusive'
  | 'failed';
export type SuggestedTradePageAction =
  | 'review'
  | 'accept'
  | 'dismiss'
  | 'link_order'
  | 'reconcile_execution';

export interface SuggestedTradeRouteAttemptReconciliation {
  status: SuggestedTradeRouteAttemptReconciliationStatus;
  checkedAt?: string | null;
  orderId?: string | null;
  positionId?: string | null;
  message?: string | null;
}

export interface SuggestedTradeRouteAttempt {
  attemptNumber: number;
  candidateRank: number;
  brokerKey: string;
  accountId?: string | null;
  accountName?: string | null;
  requestedSymbol: string;
  brokerSymbol: string;
  status: SuggestedTradeRouteAttemptStatus;
  startedAt?: string | null;
  finishedAt?: string | null;
  preTradeCheckId?: string | null;
  preTradeState?: SuggestedTradeExecutionPreTradeState | null;
  submissionState?: SuggestedTradeRouteAttemptSubmissionState | null;
  orderId?: string | null;
  orderStatus?: string | null;
  failureClassification?: SuggestedTradeRouteAttemptFailureClassification | null;
  failureCode?: string | null;
  failureMessage?: string | null;
  requestSummary?: Record<string, unknown> | null;
  brokerResponseSummary?: Record<string, unknown> | null;
  reconciliation?: SuggestedTradeRouteAttemptReconciliation | null;
  note?: string | null;
}

export interface SuggestedTradeRiskAuditSnapshot {
  schemaVersion: 'suggested-trade-risk-audit.v1';
  source: 'risk_pre_trade_check';
  preTradeCheckId?: string | null;
  preTradeState?: SuggestedTradeExecutionPreTradeState | null;
  checkedAt?: string | null;
  decisionSummary?: string | null;
  status?: string | null;
  symbol?: string | null;
  timeframe?: string | null;
  side?: string | null;
  executionMode?: string | null;
  approvalMode?: string | null;
  brokerKey?: string | null;
  accountId?: string | null;
  entryPrice?: number | null;
  stopLossPrice?: number | null;
  takeProfitPrice?: number | null;
  quantity?: number | null;
  leverage?: number | null;
  accountBalance?: number | null;
  portfolioEquity?: number | null;
  moneyUsed?: number | null;
  plannedStopLossLoss?: number | null;
  maxAllowedStopLossLoss?: number | null;
  stopLossPctOfMoneyUsed?: number | null;
  stopLossPctCap?: number | null;
  targetAmount?: number | null;
  targetRiskReward?: number | null;
  slLadder?: Record<string, unknown> | null;
  slLadderSource?: Record<string, unknown> | null;
  appliedPolicies?: Array<Record<string, unknown>>;
  riskPolicyVersions?: Array<Record<string, unknown>>;
  rules?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface SuggestedTradeExecutionLink {
  executionMode?: 'live' | 'paper' | null;
  preTradeCheckId?: string | null;
  preTradeState?: SuggestedTradeExecutionPreTradeState | null;
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
  routeAttempts?: SuggestedTradeRouteAttempt[] | null;
  entryPrice?: string | null;
  stopLossPrice?: string | null;
  takeProfitPrice?: string | null;
  protectionState?: SuggestedTradeProtectionState | null;
  protectionSource?: string | null;
  protectionPlan?: Record<string, unknown> | null;
  riskAudit?: SuggestedTradeRiskAuditSnapshot | Record<string, unknown> | null;
  protectionAttempts?: number | null;
  protectionLastError?: string | null;
  protectionCheckedAt?: string | null;
  protectionAttachedAt?: string | null;
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
  shadowOnly?: boolean;
  shadowReason?: string | null;
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
  kind:
    | 'signal'
    | 'suggested_trade'
    | 'review'
    | 'broker_route'
    | 'order'
    | 'position'
    | 'protection'
    | 'sync';
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
