import { Service } from 'typedi';
import { coreDataSource } from '../data-source';

export type FundsSnapshotFetchStatus = 'success' | 'failed';

export interface FundsSnapshotRow {
  id: string;
  user_id: string;
  broker_key: string;
  account_id: string;
  wallet_funds_json: string | null;
  futures_funds_json: string | null;
  computed_at: Date;
  snapshot_date: string;
  observed_at: Date | null;
  last_attempt_at: Date;
  fetch_status: FundsSnapshotFetchStatus;
  error_message: string | null;
  source: string;
  created_at: Date;
}

export interface FundsSnapshotCoverageRow {
  user_id: string;
  broker_key: string;
  account_id: string;
  account_name: string;
  account_key: string;
  account_status: string;
  latest_snapshot_id: string | null;
  latest_snapshot_date: string | null;
  latest_observed_at: Date | null;
  latest_last_attempt_at: Date | null;
  latest_fetch_status: FundsSnapshotFetchStatus | null;
  latest_error_message: string | null;
  latest_source: string | null;
  latest_computed_at: Date | null;
  latest_wallet_available: boolean;
  latest_futures_available: boolean;
  latest_success_snapshot_id: string | null;
  latest_success_snapshot_date: string | null;
  latest_success_observed_at: Date | null;
  latest_success_computed_at: Date | null;
  latest_success_source: string | null;
  latest_success_wallet_available: boolean;
  latest_success_futures_available: boolean;
}

type FundsSnapshotMutationResult = {
  inserted: boolean;
  updated: boolean;
};

@Service()
export class FundsSnapshotRepository {
  async createSnapshot(payload: {
    userId: string;
    brokerKey: string;
    accountId: string;
    walletFunds: unknown;
    futuresFunds: unknown;
    computedAt: Date;
    observedAt?: Date | null;
    source?: string | null;
  }): Promise<FundsSnapshotMutationResult> {
    return this.upsertSnapshotRecord({
      userId: payload.userId,
      brokerKey: payload.brokerKey,
      accountId: payload.accountId,
      walletFunds: payload.walletFunds,
      futuresFunds: payload.futuresFunds,
      computedAt: payload.computedAt,
      observedAt: payload.observedAt ?? payload.computedAt,
      lastAttemptAt: payload.computedAt,
      fetchStatus: 'success',
      errorMessage: null,
      source: payload.source ?? 'broker_runtime',
    });
  }

  async recordFetchFailure(payload: {
    userId: string;
    brokerKey: string;
    accountId: string;
    attemptedAt: Date;
    errorMessage: string;
    source?: string | null;
  }): Promise<FundsSnapshotMutationResult> {
    return this.upsertSnapshotRecord({
      userId: payload.userId,
      brokerKey: payload.brokerKey,
      accountId: payload.accountId,
      walletFunds: null,
      futuresFunds: null,
      computedAt: payload.attemptedAt,
      observedAt: null,
      lastAttemptAt: payload.attemptedAt,
      fetchStatus: 'failed',
      errorMessage: payload.errorMessage,
      source: payload.source ?? 'broker_runtime',
    });
  }

  async listSnapshots(userId: string, query: { limit: number; offset: number }) {
    const rows = await coreDataSource.query(
      `SELECT
         id,
         user_id,
         broker_key,
         account_id,
         wallet_funds_json,
         futures_funds_json,
         computed_at,
         snapshot_date,
         observed_at,
         last_attempt_at,
         fetch_status,
         error_message,
         source,
         created_at
       FROM funds_snapshots
       WHERE user_id = ?
       ORDER BY COALESCE(last_attempt_at, observed_at, computed_at) DESC, created_at DESC
       LIMIT ? OFFSET ?`,
      [userId, query.limit, query.offset]
    );

    const totalRows = await coreDataSource.query(
      `SELECT COUNT(*) as total FROM funds_snapshots WHERE user_id = ?`,
      [userId]
    );

    return {
      items: ((rows || []) as FundsSnapshotRow[]).map((row) => this.normalizeSnapshotRow(row)),
      total: Number(totalRows?.[0]?.total || 0),
    };
  }

  async getLatestSnapshot(userId: string, brokerKey?: string, accountId?: string): Promise<FundsSnapshotRow | null> {
    const clauses = ['user_id = ?', '(wallet_funds_json IS NOT NULL OR futures_funds_json IS NOT NULL)'];
    const params: Array<string> = [userId];
    if (brokerKey) {
      clauses.push('LOWER(broker_key) = LOWER(?)');
      params.push(brokerKey);
    }
    if (accountId) {
      clauses.push('account_id = ?');
      params.push(accountId);
    }
    const whereClause = `WHERE ${clauses.join(' AND ')}`;
    const rows = await coreDataSource.query(
      `SELECT
         id,
         user_id,
         broker_key,
         account_id,
         wallet_funds_json,
         futures_funds_json,
         computed_at,
         snapshot_date,
         observed_at,
         last_attempt_at,
         fetch_status,
         error_message,
         source,
         created_at
       FROM funds_snapshots
       ${whereClause}
       ORDER BY COALESCE(observed_at, computed_at) DESC, last_attempt_at DESC, created_at DESC
       LIMIT 1`,
      params
    );

    return rows?.[0] ? this.normalizeSnapshotRow(rows[0] as FundsSnapshotRow) : null;
  }

  async listLatestAccountCoverage(
    userId: string,
    brokerKey?: string
  ): Promise<FundsSnapshotCoverageRow[]> {
    const params: Array<string> = [userId];
    const brokerClause = brokerKey ? 'AND LOWER(ba.`brokerKey`) = LOWER(?)' : '';
    if (brokerKey) {
      params.push(brokerKey);
    }

    const rows = await coreDataSource.query(
      `SELECT
         ba.user_id AS user_id,
         LOWER(ba.\`brokerKey\`) AS broker_key,
         ba.id AS account_id,
         ba.\`accountName\` AS account_name,
         ba.\`accountKey\` AS account_key,
         ba.status AS account_status,
         latest.id AS latest_snapshot_id,
         latest.snapshot_date AS latest_snapshot_date,
         latest.observed_at AS latest_observed_at,
         latest.last_attempt_at AS latest_last_attempt_at,
         latest.fetch_status AS latest_fetch_status,
         latest.error_message AS latest_error_message,
         latest.source AS latest_source,
         latest.computed_at AS latest_computed_at,
         CASE WHEN latest.wallet_funds_json IS NULL THEN 0 ELSE 1 END AS latest_wallet_available,
         CASE WHEN latest.futures_funds_json IS NULL THEN 0 ELSE 1 END AS latest_futures_available,
         latest_success.id AS latest_success_snapshot_id,
         latest_success.snapshot_date AS latest_success_snapshot_date,
         latest_success.observed_at AS latest_success_observed_at,
         latest_success.computed_at AS latest_success_computed_at,
         latest_success.source AS latest_success_source,
         CASE WHEN latest_success.wallet_funds_json IS NULL THEN 0 ELSE 1 END AS latest_success_wallet_available,
         CASE WHEN latest_success.futures_funds_json IS NULL THEN 0 ELSE 1 END AS latest_success_futures_available
       FROM broker_accounts ba
       LEFT JOIN funds_snapshots latest
         ON latest.id = (
           SELECT fs.id
           FROM funds_snapshots fs
           WHERE fs.user_id = ba.user_id
             AND LOWER(fs.broker_key) = LOWER(ba.\`brokerKey\`)
             AND fs.account_id = ba.id
           ORDER BY COALESCE(fs.last_attempt_at, fs.observed_at, fs.computed_at) DESC,
                    fs.created_at DESC,
                    fs.id DESC
           LIMIT 1
         )
       LEFT JOIN funds_snapshots latest_success
         ON latest_success.id = (
           SELECT fs.id
           FROM funds_snapshots fs
           WHERE fs.user_id = ba.user_id
             AND LOWER(fs.broker_key) = LOWER(ba.\`brokerKey\`)
             AND fs.account_id = ba.id
             AND (fs.wallet_funds_json IS NOT NULL OR fs.futures_funds_json IS NOT NULL)
           ORDER BY COALESCE(fs.observed_at, fs.computed_at) DESC,
                    fs.created_at DESC,
                    fs.id DESC
           LIMIT 1
         )
       WHERE ba.user_id = ?
         AND ba.status IN ('Connected', 'Idle')
         ${brokerClause}
       ORDER BY ba.\`isDefault\` DESC, ba.\`updatedAt\` DESC, ba.id ASC`,
      params
    );

    return ((rows || []) as Array<Record<string, unknown>>).map((row) =>
      this.normalizeCoverageRow(row)
    );
  }

  private async upsertSnapshotRecord(payload: {
    userId: string;
    brokerKey: string;
    accountId: string;
    walletFunds: unknown;
    futuresFunds: unknown;
    computedAt: Date;
    observedAt: Date | null;
    lastAttemptAt: Date;
    fetchStatus: FundsSnapshotFetchStatus;
    errorMessage: string | null;
    source: string | null;
  }): Promise<FundsSnapshotMutationResult> {
    const snapshotDate = this.normalizeSnapshotDate(payload.lastAttemptAt);
    const result = await coreDataSource.query(
      `INSERT INTO funds_snapshots
        (
          id,
          user_id,
          broker_key,
          account_id,
          snapshot_date,
          wallet_funds_json,
          futures_funds_json,
          computed_at,
          observed_at,
          last_attempt_at,
          fetch_status,
          error_message,
          source,
          created_at
        )
       VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
         wallet_funds_json = CASE
           WHEN VALUES(fetch_status) = 'success' THEN VALUES(wallet_funds_json)
           ELSE wallet_funds_json
         END,
         futures_funds_json = CASE
           WHEN VALUES(fetch_status) = 'success' THEN VALUES(futures_funds_json)
           ELSE futures_funds_json
         END,
         computed_at = CASE
           WHEN VALUES(fetch_status) = 'success' THEN VALUES(computed_at)
           WHEN wallet_funds_json IS NULL AND futures_funds_json IS NULL THEN VALUES(computed_at)
           ELSE computed_at
         END,
         observed_at = CASE
           WHEN VALUES(fetch_status) = 'success' THEN VALUES(observed_at)
           WHEN wallet_funds_json IS NULL AND futures_funds_json IS NULL THEN VALUES(observed_at)
           ELSE observed_at
         END,
         last_attempt_at = VALUES(last_attempt_at),
         fetch_status = VALUES(fetch_status),
         error_message = CASE
           WHEN VALUES(fetch_status) = 'success' THEN NULL
           ELSE VALUES(error_message)
         END,
         source = VALUES(source)`,
      [
        payload.userId,
        payload.brokerKey,
        payload.accountId,
        snapshotDate,
        payload.walletFunds === null || payload.walletFunds === undefined
          ? null
          : JSON.stringify(payload.walletFunds),
        payload.futuresFunds === null || payload.futuresFunds === undefined
          ? null
          : JSON.stringify(payload.futuresFunds),
        payload.computedAt,
        payload.observedAt,
        payload.lastAttemptAt,
        payload.fetchStatus,
        payload.errorMessage,
        payload.source || 'broker_runtime',
      ]
    );

    return this.readMutationResult(result);
  }

  private readMutationResult(result: unknown): FundsSnapshotMutationResult {
    if (result && typeof result === 'object' && !Array.isArray(result)) {
      const affectedRows = Number(
        (result as { affectedRows?: unknown; rowCount?: unknown }).affectedRows ??
          (result as { affectedRows?: unknown; rowCount?: unknown }).rowCount ??
          0
      );
      if (affectedRows === 1) {
        return { inserted: true, updated: false };
      }
      if (affectedRows >= 2) {
        return { inserted: false, updated: true };
      }
    }

    return { inserted: false, updated: true };
  }

  private normalizeSnapshotDate(value: Date): string {
    return value.toISOString().slice(0, 10);
  }

  private normalizeSnapshotRow(row: FundsSnapshotRow): FundsSnapshotRow {
    return {
      ...row,
      fetch_status: row.fetch_status === 'failed' ? 'failed' : 'success',
      source: String(row.source || 'broker_runtime'),
      snapshot_date: String(row.snapshot_date || ''),
    };
  }

  private normalizeCoverageRow(row: Record<string, unknown>): FundsSnapshotCoverageRow {
    return {
      user_id: String(row.user_id || ''),
      broker_key: String(row.broker_key || ''),
      account_id: String(row.account_id || ''),
      account_name: String(row.account_name || ''),
      account_key: String(row.account_key || ''),
      account_status: String(row.account_status || ''),
      latest_snapshot_id: row.latest_snapshot_id ? String(row.latest_snapshot_id) : null,
      latest_snapshot_date: row.latest_snapshot_date ? String(row.latest_snapshot_date) : null,
      latest_observed_at: this.readDate(row.latest_observed_at),
      latest_last_attempt_at: this.readDate(row.latest_last_attempt_at),
      latest_fetch_status:
        row.latest_fetch_status === 'failed'
          ? 'failed'
          : row.latest_fetch_status === 'success'
            ? 'success'
            : null,
      latest_error_message: row.latest_error_message ? String(row.latest_error_message) : null,
      latest_source: row.latest_source ? String(row.latest_source) : null,
      latest_computed_at: this.readDate(row.latest_computed_at),
      latest_wallet_available: Number(row.latest_wallet_available || 0) > 0,
      latest_futures_available: Number(row.latest_futures_available || 0) > 0,
      latest_success_snapshot_id: row.latest_success_snapshot_id
        ? String(row.latest_success_snapshot_id)
        : null,
      latest_success_snapshot_date: row.latest_success_snapshot_date
        ? String(row.latest_success_snapshot_date)
        : null,
      latest_success_observed_at: this.readDate(row.latest_success_observed_at),
      latest_success_computed_at: this.readDate(row.latest_success_computed_at),
      latest_success_source: row.latest_success_source
        ? String(row.latest_success_source)
        : null,
      latest_success_wallet_available: Number(row.latest_success_wallet_available || 0) > 0,
      latest_success_futures_available: Number(row.latest_success_futures_available || 0) > 0,
    };
  }

  private readDate(value: unknown): Date | null {
    if (!value) {
      return null;
    }
    const date = value instanceof Date ? value : new Date(String(value));
    return Number.isNaN(date.getTime()) ? null : date;
  }
}
