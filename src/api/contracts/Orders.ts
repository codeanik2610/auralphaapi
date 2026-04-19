import { ApiTimeContract } from './Time';

export type OrdersSyncScope = 'desk' | 'broker' | 'account';
export type OrdersFreshnessState = 'fresh' | 'stale' | 'critical' | 'unknown';

export interface OrdersFreshnessIndicator {
  state: OrdersFreshnessState;
  observedAt: string | null;
  observedAtIso?: string | null;
  freshnessMs: number | null;
  staleAfterMs: number | null;
  criticalAfterMs: number | null;
  isStale: boolean;
  isCritical: boolean;
  source: string;
}

export interface OrdersAccountFreshness {
  checkpoint: OrdersFreshnessIndicator | null;
  latestSnapshot: OrdersFreshnessIndicator | null;
  warning?: string | null;
}

export interface OrdersGroupedFreshnessSummary {
  observedAt: string | null;
  observedAtIso?: string | null;
  freshAccounts: number;
  staleAccounts: number;
  criticalAccounts: number;
  unknownAccounts: number;
  warning?: string | null;
}

export interface OrdersSyncStatusItem {
  accountId: string;
  accountName: string;
  accountKey: string;
  brokerKey: string;
  status: string;
  freshness: OrdersAccountFreshness | null;
  pendingRecords: number;
  failedRecords: number;
  resolvedRecords: number;
  nextRetryAt?: string | null;
  nextRetryAtIso?: string | null;
  lastPendingUpdateAt?: string | null;
  lastPendingUpdateAtIso?: string | null;
  warning?: string | null;
}

export interface OrdersSyncStatusResponse {
  state: 'healthy' | 'attention' | 'idle';
  label: string;
  summary: string;
  generatedAt: string;
  generatedAtIso?: string;
  scope: OrdersSyncScope;
  brokerKey?: string;
  accountId?: string;
  totalAccounts: number;
  pendingRecords: number;
  failedRecords: number;
  resolvedRecords: number;
  items: OrdersSyncStatusItem[];
  freshness: OrdersGroupedFreshnessSummary | null;
  latestCheckpointAt?: string | null;
  latestCheckpointAtIso?: string | null;
  latestSnapshotAt?: string | null;
  latestSnapshotAtIso?: string | null;
  nextRetryAt?: string | null;
  nextRetryAtIso?: string | null;
  time?: ApiTimeContract;
}

export interface OrdersRefreshRequestResponse {
  requested: boolean;
  state: 'completed' | 'warning' | 'idle';
  scope: OrdersSyncScope;
  brokerKey?: string;
  accountId?: string;
  requestedAt: string;
  requestedAtIso?: string;
  summary: string;
  processedAccounts: number;
  failedAccounts: number;
  fetchedRecords: number;
  insertedRecords: number;
  updatedRecords: number;
  skippedRecords: number;
  failures: string[];
  time?: ApiTimeContract;
}

export type OrderSubmissionStatus = 'in_progress' | 'completed' | 'failed';
export type OrderSubmissionPlacementState =
  | 'registered'
  | 'submitting'
  | 'placed'
  | 'rejected'
  | 'replayed';
export type OrderSubmissionReconciliationState =
  | 'not_required'
  | 'pending'
  | 'matched'
  | 'missing';

export interface OrderSubmissionLifecycleEvent {
  at?: string;
  type?: string;
  message?: string;
  details?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface OrderSubmissionOperatorState {
  label: string;
  tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger';
  summary: string;
  recommendedAction?: 'wait' | 'reconcile_execution' | 'review_error' | null;
}

export interface OrderSubmissionAttempt {
  id: string;
  userId: string;
  idempotencyKey: string;
  requestHash: string;
  executionMode: string;
  assetId: string;
  brokerKey?: string | null;
  accountId?: string | null;
  suggestedTradeId?: string | null;
  status: OrderSubmissionStatus;
  placementState: OrderSubmissionPlacementState;
  brokerOrderId?: string | null;
  brokerOrderStatus?: string | null;
  reconciliationState: OrderSubmissionReconciliationState;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
  failedAt?: string | null;
  lifecycle: OrderSubmissionLifecycleEvent[];
  operatorState: OrderSubmissionOperatorState;
}

export interface OrderSubmissionAttemptDetail extends OrderSubmissionAttempt {
  requestPayload?: Record<string, unknown> | null;
  responsePayload?: Record<string, unknown> | null;
  errorPayload?: Record<string, unknown> | null;
}

export interface OrderSubmissionAttemptsResponse {
  items: OrderSubmissionAttempt[];
  total: number;
  limit: number;
  offset: number;
  filters: {
    suggestedTradeId?: string;
    status?: OrderSubmissionStatus;
    placementState?: OrderSubmissionPlacementState;
    reconciliationState?: OrderSubmissionReconciliationState;
    brokerKey?: string;
    accountId?: string;
  };
  time?: ApiTimeContract;
}
