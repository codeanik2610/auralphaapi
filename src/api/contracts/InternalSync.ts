export type InternalSyncExecutionScope = 'system_scheduler' | 'product_user';

export interface InternalSyncBody {
  executionScope?: InternalSyncExecutionScope;
  requestUserId?: string;
  targetUserIds?: string[];
  brokerKeys?: string[];
  accountIds?: string[];
  lookbackDays?: number;
  startDate?: string;
  endDate?: string;
  historyWindowDays?: number;
  backfill?: boolean;
  runLogId?: string;
}

export interface OrdersSyncRequest {
  executionScope?: InternalSyncExecutionScope;
  requestUserId?: string;
  targetUserIds?: string[];
  brokerKeys?: string[];
  accountIds?: string[];
  startDate?: string;
  endDate?: string;
  historyWindowDays?: number;
  lookbackDays?: number;
  backfill?: boolean;
  runLogId?: string;
}

export interface PositionsSyncRequest {
  executionScope?: InternalSyncExecutionScope;
  requestUserId?: string;
  targetUserIds?: string[];
  brokerKeys?: string[];
  accountIds?: string[];
  startDate?: string;
  endDate?: string;
  historyWindowDays?: number;
  lookbackDays?: number;
  backfill?: boolean;
  runLogId?: string;
}
