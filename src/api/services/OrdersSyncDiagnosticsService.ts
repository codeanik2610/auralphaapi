import { Service } from 'typedi';
import { coreDataSource } from '../../database/data-source';

export const ORDERS_SYNC_SCHEDULER_KEY = 'orders-sync';

export interface OrdersSyncPendingStateRecord {
  accountId: string;
  pendingRecords: number;
  failedRecords: number;
  resolvedRecords: number;
  nextRetryAt: string | null;
  lastPendingUpdateAt: string | null;
}

export interface OrdersSyncFreshnessRecord {
  accountId: string;
  observedAt: string | null;
  checkpointAt: string | null;
}

export interface OrdersSchedulerSyncStateRecord {
  accountId: string;
  userId: string;
  brokerKey: string;
  checkpointAt: string | null;
  pendingRecords: number;
  failedRecords: number;
  resolvedRecords: number;
  nextRetryAt: string | null;
  lastPendingUpdateAt: string | null;
}

export interface OrdersSchedulerSyncStateSummaryRecord {
  totalAccounts: number;
  accountsWithCheckpoint: number;
  accountsWithoutCheckpoint: number;
  accountsWithPending: number;
  accountsWithFailed: number;
  accountsWithRetryScheduled: number;
  pendingRecords: number;
  failedRecords: number;
  resolvedRecords: number;
  oldestCheckpointAt: string | null;
  latestCheckpointAt: string | null;
  latestPendingUpdateAt: string | null;
  nextRetryAt: string | null;
}

export interface OrdersSchedulerSyncStateFilters {
  accountId?: string;
  ownerUserId?: string;
  brokerKey?: string;
}

@Service()
export class OrdersSyncDiagnosticsService {
  async listPendingSyncStateByAccountId(
    accountIds: string[]
  ): Promise<Map<string, OrdersSyncPendingStateRecord>> {
    const normalizedAccountIds = this.normalizeAccountIds(accountIds);
    if (!normalizedAccountIds.length) {
      return new Map();
    }

    try {
      const rows = (await coreDataSource.query(
        `SELECT
           account_id AS accountId,
           COALESCE(SUM(CASE WHEN LOWER(status) IN ('pending', 'failed') THEN 1 ELSE 0 END), 0) AS pendingRecords,
           COALESCE(SUM(CASE WHEN LOWER(status) = 'failed' THEN 1 ELSE 0 END), 0) AS failedRecords,
           COALESCE(SUM(CASE WHEN LOWER(status) = 'resolved' THEN 1 ELSE 0 END), 0) AS resolvedRecords,
           MIN(CASE WHEN LOWER(status) IN ('pending', 'failed') THEN next_retry_at ELSE NULL END) AS nextRetryAt,
           MAX(updated_at) AS lastPendingUpdateAt
         FROM scheduler_sync_pending_records
         WHERE scheduler_key = ?
           AND account_id IN (${normalizedAccountIds.map(() => '?').join(', ')})
         GROUP BY account_id`,
        [ORDERS_SYNC_SCHEDULER_KEY, ...normalizedAccountIds]
      )) as Array<Record<string, unknown>>;

      return new Map(
        rows
          .map((row) => this.mapPendingStateRow(row))
          .filter(
            (
              row
            ): row is OrdersSyncPendingStateRecord => Boolean(row)
          )
          .map((row) => [row.accountId, row] as const)
      );
    } catch (error) {
      if (!this.isMissingTableError(error)) {
        throw error;
      }
      return new Map();
    }
  }

  async listFreshnessByAccountId(
    userId: string,
    accountIds: string[]
  ): Promise<Map<string, OrdersSyncFreshnessRecord>> {
    const normalizedUserId = this.readString(userId);
    const normalizedAccountIds = this.normalizeAccountIds(accountIds);
    if (!normalizedUserId || !normalizedAccountIds.length) {
      return new Map();
    }

    try {
      const snapshotRows = (await coreDataSource.query(
        `SELECT
           account_id AS accountId,
           MAX(last_seen_at) AS observedAt
         FROM scheduler_orders_snapshots
         WHERE user_id = ?
           AND account_id IN (${normalizedAccountIds.map(() => '?').join(', ')})
         GROUP BY account_id`,
        [normalizedUserId, ...normalizedAccountIds]
      )) as Array<Record<string, unknown>>;

      const checkpointRows = (await coreDataSource.query(
        `SELECT
           account_id AS accountId,
           checkpoint_at AS checkpointAt
         FROM scheduler_sync_checkpoints
         WHERE scheduler_key = ?
           AND account_id IN (${normalizedAccountIds.map(() => '?').join(', ')})`,
        [ORDERS_SYNC_SCHEDULER_KEY, ...normalizedAccountIds]
      )) as Array<Record<string, unknown>>;

      const freshnessByAccountId = new Map<string, OrdersSyncFreshnessRecord>();

      snapshotRows.forEach((row) => {
        const accountId = this.readString(row.accountId);
        if (!accountId) {
          return;
        }

        freshnessByAccountId.set(accountId, {
          accountId,
          observedAt: this.normalizeTimestamp(row.observedAt),
          checkpointAt: freshnessByAccountId.get(accountId)?.checkpointAt || null,
        });
      });

      checkpointRows.forEach((row) => {
        const accountId = this.readString(row.accountId);
        if (!accountId) {
          return;
        }

        freshnessByAccountId.set(accountId, {
          accountId,
          observedAt: freshnessByAccountId.get(accountId)?.observedAt || null,
          checkpointAt: this.normalizeTimestamp(row.checkpointAt),
        });
      });

      return freshnessByAccountId;
    } catch (error) {
      if (!this.isMissingTableError(error)) {
        throw error;
      }
      return new Map();
    }
  }

  async listSchedulerSyncStateRecords(
    filters: OrdersSchedulerSyncStateFilters,
    pagination: { limit: number; offset: number; includeRuntimeState: boolean }
  ): Promise<{ items: OrdersSchedulerSyncStateRecord[]; total: number }> {
    const normalizedFilters = this.normalizeSyncStateFilters(filters);
    const { whereClause, params } = this.buildSyncStateWhereClause(normalizedFilters);
    const { limit, offset, includeRuntimeState } = pagination;

    if (includeRuntimeState) {
      const rows = (await coreDataSource.query(
        `SELECT
           ba.id AS accountId,
           ba.user_id AS userId,
           ba.brokerKey AS brokerKey,
           scp.checkpoint_at AS checkpointAt,
           COALESCE(SUM(CASE WHEN LOWER(spr.status) IN ('pending', 'failed') THEN 1 ELSE 0 END), 0) AS pendingRecords,
           COALESCE(SUM(CASE WHEN LOWER(spr.status) = 'failed' THEN 1 ELSE 0 END), 0) AS failedRecords,
           COALESCE(SUM(CASE WHEN LOWER(spr.status) = 'resolved' THEN 1 ELSE 0 END), 0) AS resolvedRecords,
           MAX(spr.next_retry_at) AS nextRetryAt,
           MAX(spr.updated_at) AS lastPendingUpdateAt
         FROM broker_accounts ba
         LEFT JOIN scheduler_sync_checkpoints scp
           ON scp.scheduler_key = ?
          AND scp.account_id = ba.id
         LEFT JOIN scheduler_sync_pending_records spr
           ON spr.scheduler_key = ?
          AND spr.account_id = ba.id
         ${whereClause}
         GROUP BY ba.id, ba.user_id, ba.brokerKey, scp.checkpoint_at
         ORDER BY ba.updatedAt DESC, ba.id DESC
         LIMIT ? OFFSET ?`,
        [ORDERS_SYNC_SCHEDULER_KEY, ORDERS_SYNC_SCHEDULER_KEY, ...params, limit, offset]
      )) as Array<Record<string, unknown>>;

      const total = await this.countSchedulerSyncStateRecords(normalizedFilters);
      return {
        items: rows.map((row) => this.mapSchedulerSyncStateRow(row)),
        total,
      };
    }

    const rows = (await coreDataSource.query(
      `SELECT
         ba.id AS accountId,
         ba.user_id AS userId,
         ba.brokerKey AS brokerKey
       FROM broker_accounts ba
       ${whereClause}
       ORDER BY ba.updatedAt DESC, ba.id DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    )) as Array<Record<string, unknown>>;

    const total = await this.countSchedulerSyncStateRecords(normalizedFilters);
    return {
      items: rows.map((row) => this.mapSchedulerSyncStateRow(row)),
      total,
    };
  }

  async getSchedulerSyncStateSummaryRecord(
    includeRuntimeState: boolean
  ): Promise<OrdersSchedulerSyncStateSummaryRecord> {
    if (includeRuntimeState) {
      const rows = (await coreDataSource.query(
        `SELECT
           COUNT(*) AS totalAccounts,
           COALESCE(SUM(CASE WHEN scp.checkpoint_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS accountsWithCheckpoint,
           COALESCE(SUM(CASE WHEN scp.checkpoint_at IS NULL THEN 1 ELSE 0 END), 0) AS accountsWithoutCheckpoint,
           COALESCE(SUM(CASE WHEN pendingAgg.pendingRecords > 0 THEN 1 ELSE 0 END), 0) AS accountsWithPending,
           COALESCE(SUM(CASE WHEN pendingAgg.failedRecords > 0 THEN 1 ELSE 0 END), 0) AS accountsWithFailed,
           COALESCE(SUM(CASE WHEN pendingAgg.nextRetryAt IS NOT NULL THEN 1 ELSE 0 END), 0) AS accountsWithRetryScheduled,
           COALESCE(SUM(pendingAgg.pendingRecords), 0) AS pendingRecords,
           COALESCE(SUM(pendingAgg.failedRecords), 0) AS failedRecords,
           COALESCE(SUM(pendingAgg.resolvedRecords), 0) AS resolvedRecords,
           MIN(scp.checkpoint_at) AS oldestCheckpointAt,
           MAX(scp.checkpoint_at) AS latestCheckpointAt,
           MAX(pendingAgg.lastPendingUpdateAt) AS latestPendingUpdateAt,
           MIN(pendingAgg.nextRetryAt) AS nextRetryAt
         FROM broker_accounts ba
         LEFT JOIN scheduler_sync_checkpoints scp
           ON scp.scheduler_key = ?
          AND scp.account_id = ba.id
         LEFT JOIN (
           SELECT
             account_id AS accountId,
             COALESCE(SUM(CASE WHEN LOWER(status) IN ('pending', 'failed') THEN 1 ELSE 0 END), 0) AS pendingRecords,
             COALESCE(SUM(CASE WHEN LOWER(status) = 'failed' THEN 1 ELSE 0 END), 0) AS failedRecords,
             COALESCE(SUM(CASE WHEN LOWER(status) = 'resolved' THEN 1 ELSE 0 END), 0) AS resolvedRecords,
             MAX(updated_at) AS lastPendingUpdateAt,
             MIN(CASE WHEN LOWER(status) IN ('pending', 'failed') THEN next_retry_at ELSE NULL END) AS nextRetryAt
           FROM scheduler_sync_pending_records
           WHERE scheduler_key = ?
           GROUP BY account_id
         ) pendingAgg
           ON pendingAgg.accountId = ba.id
         WHERE LOWER(ba.status) IN ('connected', 'idle')
           AND ba.user_id IS NOT NULL`,
        [ORDERS_SYNC_SCHEDULER_KEY, ORDERS_SYNC_SCHEDULER_KEY]
      )) as Array<Record<string, unknown>>;

      return this.mapSchedulerSyncStateSummaryRow(rows[0] || {});
    }

    const rows = (await coreDataSource.query(
      `SELECT COUNT(*) AS totalAccounts
       FROM broker_accounts ba
       WHERE LOWER(ba.status) IN ('connected', 'idle')
         AND ba.user_id IS NOT NULL`
    )) as Array<Record<string, unknown>>;

    return this.mapSchedulerSyncStateSummaryRow(rows[0] || {});
  }

  private async countSchedulerSyncStateRecords(
    filters: OrdersSchedulerSyncStateFilters
  ): Promise<number> {
    const { whereClause, params } = this.buildSyncStateWhereClause(
      this.normalizeSyncStateFilters(filters)
    );
    const rows = (await coreDataSource.query(
      `SELECT COUNT(*) AS total
       FROM broker_accounts ba
       ${whereClause}`,
      params
    )) as Array<Record<string, unknown>>;

    return this.readNumber(rows[0]?.total);
  }

  private mapPendingStateRow(row: Record<string, unknown>): OrdersSyncPendingStateRecord | null {
    const accountId = this.readString(row.accountId);
    if (!accountId) {
      return null;
    }

    return {
      accountId,
      pendingRecords: this.readNumber(row.pendingRecords),
      failedRecords: this.readNumber(row.failedRecords),
      resolvedRecords: this.readNumber(row.resolvedRecords),
      nextRetryAt: this.normalizeTimestamp(row.nextRetryAt),
      lastPendingUpdateAt: this.normalizeTimestamp(row.lastPendingUpdateAt),
    };
  }

  private mapSchedulerSyncStateRow(
    row: Record<string, unknown>
  ): OrdersSchedulerSyncStateRecord {
    return {
      accountId: this.readString(row.accountId),
      userId: this.readString(row.userId),
      brokerKey: this.readString(row.brokerKey),
      checkpointAt: this.normalizeTimestamp(row.checkpointAt),
      pendingRecords: this.readNumber(row.pendingRecords),
      failedRecords: this.readNumber(row.failedRecords),
      resolvedRecords: this.readNumber(row.resolvedRecords),
      nextRetryAt: this.normalizeTimestamp(row.nextRetryAt),
      lastPendingUpdateAt: this.normalizeTimestamp(row.lastPendingUpdateAt),
    };
  }

  private mapSchedulerSyncStateSummaryRow(
    row: Record<string, unknown>
  ): OrdersSchedulerSyncStateSummaryRecord {
    return {
      totalAccounts: this.readNumber(row.totalAccounts),
      accountsWithCheckpoint: this.readNumber(row.accountsWithCheckpoint),
      accountsWithoutCheckpoint: this.readNumber(row.accountsWithoutCheckpoint),
      accountsWithPending: this.readNumber(row.accountsWithPending),
      accountsWithFailed: this.readNumber(row.accountsWithFailed),
      accountsWithRetryScheduled: this.readNumber(row.accountsWithRetryScheduled),
      pendingRecords: this.readNumber(row.pendingRecords),
      failedRecords: this.readNumber(row.failedRecords),
      resolvedRecords: this.readNumber(row.resolvedRecords),
      oldestCheckpointAt: this.normalizeTimestamp(row.oldestCheckpointAt),
      latestCheckpointAt: this.normalizeTimestamp(row.latestCheckpointAt),
      latestPendingUpdateAt: this.normalizeTimestamp(row.latestPendingUpdateAt),
      nextRetryAt: this.normalizeTimestamp(row.nextRetryAt),
    };
  }

  private buildSyncStateWhereClause(filters: OrdersSchedulerSyncStateFilters): {
    whereClause: string;
    params: string[];
  } {
    const clauses = ["LOWER(ba.status) IN ('connected', 'idle')", 'ba.user_id IS NOT NULL'];
    const params: string[] = [];

    if (filters.accountId) {
      clauses.push('ba.id = ?');
      params.push(filters.accountId);
    }
    if (filters.ownerUserId) {
      clauses.push('ba.user_id = ?');
      params.push(filters.ownerUserId);
    }
    if (filters.brokerKey) {
      clauses.push('LOWER(ba.brokerKey) = ?');
      params.push(filters.brokerKey);
    }

    return {
      whereClause: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
      params,
    };
  }

  private normalizeSyncStateFilters(
    filters: OrdersSchedulerSyncStateFilters
  ): OrdersSchedulerSyncStateFilters {
    const accountId = this.readString(filters.accountId);
    const ownerUserId = this.readString(filters.ownerUserId);
    const brokerKey = this.readString(filters.brokerKey).toLowerCase();

    return {
      ...(accountId ? { accountId } : {}),
      ...(ownerUserId ? { ownerUserId } : {}),
      ...(brokerKey ? { brokerKey } : {}),
    };
  }

  private normalizeAccountIds(accountIds: string[]): string[] {
    return Array.from(new Set(accountIds.map((item) => this.readString(item)).filter(Boolean)));
  }

  private normalizeTimestamp(value: unknown): string | null {
    if (!value) {
      return null;
    }
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value.toISOString();
    }
    const normalized = this.readString(value);
    if (!normalized) {
      return null;
    }
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? normalized : parsed.toISOString();
  }

  private readNumber(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private readString(value: unknown): string {
    return String(value ?? '').trim();
  }

  private isMissingTableError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }
    return String((error as { code?: unknown }).code || '') === 'ER_NO_SUCH_TABLE';
  }
}
