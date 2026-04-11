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
