import { randomUUID } from 'node:crypto';
import { Service } from 'typedi';
import { coreDataSource } from '../data-source';

export type BrokerReconciliationMutationResult = {
  inserted: boolean;
  updated: boolean;
};

export type BrokerReconciliationMatchState = 'unmatched' | 'matched' | 'estimated';
export type BrokerReconciliationMatchConfidence = 'unknown' | 'exact' | 'high' | 'medium' | 'low';

interface BrokerReconciliationBaseRow {
  userId: string;
  brokerKey: string;
  accountId: string;
  externalId: string;
  source?: string | null;
  rawPayload?: unknown;
  matchState?: BrokerReconciliationMatchState | string | null;
  matchConfidence?: BrokerReconciliationMatchConfidence | string | null;
}

export interface BrokerFillUpsert extends BrokerReconciliationBaseRow {
  orderId?: string | null;
  positionId?: string | null;
  suggestedTradeId?: string | null;
  symbol?: string | null;
  side?: string | null;
  liquidityRole?: string | null;
  orderType?: string | null;
  tradeCurrency?: string | null;
  quantity?: number | string | null;
  price?: number | string | null;
  notional?: number | string | null;
  commissionAmount?: number | string | null;
  commissionCurrency?: string | null;
  feeSource?: string | null;
  filledAt?: Date | string | null;
}

export interface BrokerFeeEntryUpsert extends BrokerReconciliationBaseRow {
  symbol?: string | null;
  orderId?: string | null;
  fillId?: string | null;
  positionId?: string | null;
  suggestedTradeId?: string | null;
  feeType: string;
  amount: number | string;
  currency?: string | null;
  transactionAmount?: number | string | null;
  feeRatePct?: number | string | null;
  occurredAt?: Date | string | null;
}

export interface BrokerFundingEntryUpsert extends BrokerReconciliationBaseRow {
  symbol?: string | null;
  positionId?: string | null;
  suggestedTradeId?: string | null;
  side?: string | null;
  amount: number | string;
  currency?: string | null;
  notional?: number | string | null;
  fundingRatePct?: number | string | null;
  occurredAt?: Date | string | null;
}

export interface BrokerWalletTransactionUpsert extends BrokerReconciliationBaseRow {
  transactionType: string;
  symbol?: string | null;
  referenceId?: string | null;
  orderId?: string | null;
  positionId?: string | null;
  amount: number | string;
  currency?: string | null;
  balanceBefore?: number | string | null;
  balanceAfter?: number | string | null;
  occurredAt?: Date | string | null;
}

export interface BrokerBalanceSnapshotUpsert extends BrokerReconciliationBaseRow {
  walletBalance?: number | string | null;
  futuresBalance?: number | string | null;
  totalBalance?: number | string | null;
  availableBalance?: number | string | null;
  lockedAmount?: number | string | null;
  currency?: string | null;
  sourceSnapshotId?: string | null;
  observedAt?: Date | string | null;
}

export interface BrokerReconciliationRunCreate {
  userId: string;
  brokerKey: string;
  accountId?: string | null;
  runType: string;
  windowStartAt?: Date | string | null;
  windowEndAt?: Date | string | null;
  startedAt?: Date | string | null;
  summaryPayload?: unknown;
}

export interface BrokerReconciliationRunFinish {
  status: 'completed' | 'failed';
  finishedAt?: Date | string | null;
  fillsCount?: number | null;
  feeEntriesCount?: number | null;
  fundingEntriesCount?: number | null;
  walletTransactionsCount?: number | null;
  balanceSnapshotsCount?: number | null;
  grossPnl?: number | string | null;
  feesTotal?: number | string | null;
  fundingTotal?: number | string | null;
  netPnl?: number | string | null;
  balanceDelta?: number | string | null;
  unmatchedDelta?: number | string | null;
  summaryPayload?: unknown;
  errorMessage?: string | null;
}

export interface BrokerReconciliationRunRow {
  id: string;
  user_id: string;
  broker_key: string;
  account_id: string | null;
  run_type: string;
  status: string;
  started_at: Date;
  finished_at: Date | null;
}

export interface BrokerReconciliationMatchFilters {
  userId: string;
  brokerKey?: string | null;
  accountId?: string | null;
  windowStartAt?: Date | string | null;
  windowEndAt?: Date | string | null;
  fallbackWindowMinutes?: number | null;
}

export interface BrokerReconciliationMatchCounts {
  fillsMatchedByExecutionOrderId: number;
  fillsMatchedBySubmissionOrderId: number;
  fillsMatchedByPositionId: number;
  fillsMatchedBySymbolTimeSide: number;
  feeEntriesLinked: number;
  fundingEntriesLinked: number;
  walletTransactionsLinked: number;
}

export interface BrokerReconciliationComparisonTotals {
  appTradeCount: number;
  appMatchedTradeCount: number;
  appGrossPnl: number;
  appMatchedGrossPnl: number;
  brokerFillCount: number;
  brokerMatchedFillCount: number;
  brokerUnmatchedFillCount: number;
  brokerNotional: number;
  brokerMatchedNotional: number;
  brokerFeeTotal: number;
  brokerMatchedFeeTotal: number;
  brokerFundingTotal: number;
  brokerMatchedFundingTotal: number;
  brokerWalletTransactionTotal: number;
  brokerMatchedWalletTransactionTotal: number;
}

export interface BrokerReconciliationSourceRunTotals {
  id: string;
  brokerKey: string;
  accountId: string | null;
  runType: string;
  startedAt: Date | null;
  finishedAt: Date | null;
  grossPnl: number;
  feesTotal: number;
  fundingTotal: number;
  netPnl: number;
}

export interface BrokerReconciliationRunReadFilters {
  userId: string;
  brokerKey?: string | null;
  accountId?: string | null;
  status?: string | null;
  runType?: string | null;
  limit?: number | null;
  offset?: number | null;
}

export interface BrokerReconciliationRunReadRow {
  id: string;
  user_id: string;
  broker_key: string;
  account_id: string | null;
  run_type: string;
  status: string;
  window_start_at: Date | null;
  window_end_at: Date | null;
  started_at: Date;
  finished_at: Date | null;
  fills_count: number | string;
  fee_entries_count: number | string;
  funding_entries_count: number | string;
  wallet_transactions_count: number | string;
  balance_snapshots_count: number | string;
  gross_pnl: number | string | null;
  fees_total: number | string | null;
  funding_total: number | string | null;
  net_pnl: number | string | null;
  balance_delta: number | string | null;
  unmatched_delta: number | string | null;
  summary_json: unknown;
  error_message: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface BrokerReconciliationUnmatchedEvidenceFilters {
  userId: string;
  brokerKey?: string | null;
  accountId?: string | null;
  windowStartAt?: Date | string | null;
  windowEndAt?: Date | string | null;
  kind?: string | null;
  limit?: number | null;
  offset?: number | null;
}

export interface BrokerReconciliationUnmatchedEvidenceRow {
  kind: string;
  id: string;
  broker_key: string;
  account_id: string | null;
  external_id: string;
  symbol: string | null;
  order_id: string | null;
  position_id: string | null;
  suggested_trade_id: string | null;
  side: string | null;
  amount: number | string | null;
  quantity: number | string | null;
  price: number | string | null;
  occurred_at: Date | null;
  match_state: string;
  match_confidence: string;
  source: string;
  raw_payload_json: unknown;
}

@Service()
export class BrokerReconciliationRepository {
  async upsertFill(row: BrokerFillUpsert): Promise<BrokerReconciliationMutationResult> {
    const result = await coreDataSource.query(
      `INSERT INTO broker_fills
        (
          id, user_id, broker_key, account_id, external_id, order_id, position_id,
          suggested_trade_id, symbol, side, liquidity_role, order_type, trade_currency,
          quantity, price, notional, commission_amount, commission_currency, fee_source,
          filled_at, raw_payload_json, match_state, match_confidence, source,
          created_at, updated_at
        )
       VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
       ON DUPLICATE KEY UPDATE
         order_id = VALUES(order_id),
         position_id = VALUES(position_id),
         suggested_trade_id = VALUES(suggested_trade_id),
         symbol = VALUES(symbol),
         side = VALUES(side),
         liquidity_role = VALUES(liquidity_role),
         order_type = VALUES(order_type),
         trade_currency = VALUES(trade_currency),
         quantity = VALUES(quantity),
         price = VALUES(price),
         notional = VALUES(notional),
         commission_amount = VALUES(commission_amount),
         commission_currency = VALUES(commission_currency),
         fee_source = VALUES(fee_source),
         filled_at = VALUES(filled_at),
         raw_payload_json = VALUES(raw_payload_json),
         match_state = VALUES(match_state),
         match_confidence = VALUES(match_confidence),
         source = VALUES(source)`,
      [
        row.userId,
        this.normalizeBrokerKey(row.brokerKey),
        row.accountId,
        row.externalId,
        this.nullableString(row.orderId),
        this.nullableString(row.positionId),
        this.nullableString(row.suggestedTradeId),
        this.nullableString(row.symbol)?.toUpperCase() ?? null,
        this.nullableString(row.side),
        this.nullableString(row.liquidityRole),
        this.nullableString(row.orderType),
        this.nullableString(row.tradeCurrency),
        this.decimalParam(row.quantity),
        this.decimalParam(row.price),
        this.decimalParam(row.notional),
        this.decimalParam(row.commissionAmount),
        this.nullableString(row.commissionCurrency),
        this.nullableString(row.feeSource),
        this.dateParam(row.filledAt),
        this.jsonParam(row.rawPayload),
        this.normalizeMatchState(row.matchState),
        this.normalizeMatchConfidence(row.matchConfidence),
        this.normalizeSource(row.source),
      ]
    );

    return this.readMutationResult(result);
  }

  async upsertFeeEntry(row: BrokerFeeEntryUpsert): Promise<BrokerReconciliationMutationResult> {
    const result = await coreDataSource.query(
      `INSERT INTO broker_fee_entries
        (
          id, user_id, broker_key, account_id, external_id, symbol, order_id, fill_id,
          position_id, suggested_trade_id, fee_type, amount, currency, transaction_amount,
          fee_rate_pct, occurred_at, raw_payload_json, match_state, match_confidence, source,
          created_at, updated_at
        )
       VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
       ON DUPLICATE KEY UPDATE
         symbol = VALUES(symbol),
         order_id = VALUES(order_id),
         fill_id = VALUES(fill_id),
         position_id = VALUES(position_id),
         suggested_trade_id = VALUES(suggested_trade_id),
         fee_type = VALUES(fee_type),
         amount = VALUES(amount),
         currency = VALUES(currency),
         transaction_amount = VALUES(transaction_amount),
         fee_rate_pct = VALUES(fee_rate_pct),
         occurred_at = VALUES(occurred_at),
         raw_payload_json = VALUES(raw_payload_json),
         match_state = VALUES(match_state),
         match_confidence = VALUES(match_confidence),
         source = VALUES(source)`,
      [
        row.userId,
        this.normalizeBrokerKey(row.brokerKey),
        row.accountId,
        row.externalId,
        this.nullableString(row.symbol)?.toUpperCase() ?? null,
        this.nullableString(row.orderId),
        this.nullableString(row.fillId),
        this.nullableString(row.positionId),
        this.nullableString(row.suggestedTradeId),
        this.requiredString(row.feeType, 'feeType'),
        this.requiredDecimal(row.amount, 'amount'),
        this.nullableString(row.currency),
        this.decimalParam(row.transactionAmount),
        this.decimalParam(row.feeRatePct),
        this.dateParam(row.occurredAt),
        this.jsonParam(row.rawPayload),
        this.normalizeMatchState(row.matchState),
        this.normalizeMatchConfidence(row.matchConfidence),
        this.normalizeSource(row.source),
      ]
    );

    return this.readMutationResult(result);
  }

  async upsertFundingEntry(
    row: BrokerFundingEntryUpsert
  ): Promise<BrokerReconciliationMutationResult> {
    const result = await coreDataSource.query(
      `INSERT INTO broker_funding_entries
        (
          id, user_id, broker_key, account_id, external_id, symbol, position_id,
          suggested_trade_id, side, amount, currency, notional, funding_rate_pct,
          occurred_at, raw_payload_json, match_state, match_confidence, source,
          created_at, updated_at
        )
       VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
       ON DUPLICATE KEY UPDATE
         symbol = VALUES(symbol),
         position_id = VALUES(position_id),
         suggested_trade_id = VALUES(suggested_trade_id),
         side = VALUES(side),
         amount = VALUES(amount),
         currency = VALUES(currency),
         notional = VALUES(notional),
         funding_rate_pct = VALUES(funding_rate_pct),
         occurred_at = VALUES(occurred_at),
         raw_payload_json = VALUES(raw_payload_json),
         match_state = VALUES(match_state),
         match_confidence = VALUES(match_confidence),
         source = VALUES(source)`,
      [
        row.userId,
        this.normalizeBrokerKey(row.brokerKey),
        row.accountId,
        row.externalId,
        this.nullableString(row.symbol)?.toUpperCase() ?? null,
        this.nullableString(row.positionId),
        this.nullableString(row.suggestedTradeId),
        this.nullableString(row.side),
        this.requiredDecimal(row.amount, 'amount'),
        this.nullableString(row.currency),
        this.decimalParam(row.notional),
        this.decimalParam(row.fundingRatePct),
        this.dateParam(row.occurredAt),
        this.jsonParam(row.rawPayload),
        this.normalizeMatchState(row.matchState),
        this.normalizeMatchConfidence(row.matchConfidence),
        this.normalizeSource(row.source),
      ]
    );

    return this.readMutationResult(result);
  }

  async upsertWalletTransaction(
    row: BrokerWalletTransactionUpsert
  ): Promise<BrokerReconciliationMutationResult> {
    const result = await coreDataSource.query(
      `INSERT INTO broker_wallet_transactions
        (
          id, user_id, broker_key, account_id, external_id, transaction_type, symbol,
          reference_id, order_id, position_id, amount, currency, balance_before,
          balance_after, occurred_at, raw_payload_json, match_state, match_confidence, source,
          created_at, updated_at
        )
       VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
       ON DUPLICATE KEY UPDATE
         transaction_type = VALUES(transaction_type),
         symbol = VALUES(symbol),
         reference_id = VALUES(reference_id),
         order_id = VALUES(order_id),
         position_id = VALUES(position_id),
         amount = VALUES(amount),
         currency = VALUES(currency),
         balance_before = VALUES(balance_before),
         balance_after = VALUES(balance_after),
         occurred_at = VALUES(occurred_at),
         raw_payload_json = VALUES(raw_payload_json),
         match_state = VALUES(match_state),
         match_confidence = VALUES(match_confidence),
         source = VALUES(source)`,
      [
        row.userId,
        this.normalizeBrokerKey(row.brokerKey),
        row.accountId,
        row.externalId,
        this.requiredString(row.transactionType, 'transactionType'),
        this.nullableString(row.symbol)?.toUpperCase() ?? null,
        this.nullableString(row.referenceId),
        this.nullableString(row.orderId),
        this.nullableString(row.positionId),
        this.requiredDecimal(row.amount, 'amount'),
        this.nullableString(row.currency),
        this.decimalParam(row.balanceBefore),
        this.decimalParam(row.balanceAfter),
        this.dateParam(row.occurredAt),
        this.jsonParam(row.rawPayload),
        this.normalizeMatchState(row.matchState),
        this.normalizeMatchConfidence(row.matchConfidence),
        this.normalizeSource(row.source),
      ]
    );

    return this.readMutationResult(result);
  }

  async upsertBalanceSnapshot(
    row: BrokerBalanceSnapshotUpsert
  ): Promise<BrokerReconciliationMutationResult> {
    const result = await coreDataSource.query(
      `INSERT INTO broker_balance_snapshots
        (
          id, user_id, broker_key, account_id, external_id, wallet_balance, futures_balance,
          total_balance, available_balance, locked_amount, currency, source_snapshot_id,
          observed_at, raw_payload_json, source, created_at, updated_at
        )
       VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
       ON DUPLICATE KEY UPDATE
         wallet_balance = VALUES(wallet_balance),
         futures_balance = VALUES(futures_balance),
         total_balance = VALUES(total_balance),
         available_balance = VALUES(available_balance),
         locked_amount = VALUES(locked_amount),
         currency = VALUES(currency),
         source_snapshot_id = VALUES(source_snapshot_id),
         observed_at = VALUES(observed_at),
         raw_payload_json = VALUES(raw_payload_json),
         source = VALUES(source)`,
      [
        row.userId,
        this.normalizeBrokerKey(row.brokerKey),
        row.accountId,
        row.externalId,
        this.decimalParam(row.walletBalance),
        this.decimalParam(row.futuresBalance),
        this.decimalParam(row.totalBalance),
        this.decimalParam(row.availableBalance),
        this.decimalParam(row.lockedAmount),
        this.nullableString(row.currency),
        this.nullableString(row.sourceSnapshotId),
        this.dateParam(row.observedAt),
        this.jsonParam(row.rawPayload),
        this.normalizeSource(row.source),
      ]
    );

    return this.readMutationResult(result);
  }

  async createReconciliationRun(payload: BrokerReconciliationRunCreate): Promise<string> {
    const id = randomUUID();
    await coreDataSource.query(
      `INSERT INTO broker_reconciliation_runs
        (
          id, user_id, broker_key, account_id, run_type, status, window_start_at,
          window_end_at, started_at, summary_json, created_at, updated_at
        )
       VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?, ?, NOW(), NOW())`,
      [
        id,
        payload.userId,
        this.normalizeBrokerKey(payload.brokerKey),
        this.nullableString(payload.accountId),
        this.requiredString(payload.runType, 'runType'),
        this.dateParam(payload.windowStartAt),
        this.dateParam(payload.windowEndAt),
        this.dateParam(payload.startedAt) ?? new Date(),
        this.jsonParam(payload.summaryPayload),
      ]
    );
    return id;
  }

  async finishReconciliationRun(
    runId: string,
    payload: BrokerReconciliationRunFinish
  ): Promise<number> {
    const result = await coreDataSource.query(
      `UPDATE broker_reconciliation_runs
          SET status = ?,
              finished_at = ?,
              fills_count = ?,
              fee_entries_count = ?,
              funding_entries_count = ?,
              wallet_transactions_count = ?,
              balance_snapshots_count = ?,
              gross_pnl = ?,
              fees_total = ?,
              funding_total = ?,
              net_pnl = ?,
              balance_delta = ?,
              unmatched_delta = ?,
              summary_json = ?,
              error_message = ?,
              updated_at = NOW()
        WHERE id = ?`,
      [
        this.requiredString(payload.status, 'status'),
        this.dateParam(payload.finishedAt) ?? new Date(),
        this.integerParam(payload.fillsCount),
        this.integerParam(payload.feeEntriesCount),
        this.integerParam(payload.fundingEntriesCount),
        this.integerParam(payload.walletTransactionsCount),
        this.integerParam(payload.balanceSnapshotsCount),
        this.decimalParam(payload.grossPnl),
        this.decimalParam(payload.feesTotal),
        this.decimalParam(payload.fundingTotal),
        this.decimalParam(payload.netPnl),
        this.decimalParam(payload.balanceDelta),
        this.decimalParam(payload.unmatchedDelta),
        this.jsonParam(payload.summaryPayload),
        this.nullableString(payload.errorMessage),
        runId,
      ]
    );
    return this.readAffectedRows(result);
  }

  async listRecentRuns(payload: {
    userId: string;
    brokerKey?: string | null;
    accountId?: string | null;
    limit?: number | null;
  }): Promise<BrokerReconciliationRunRow[]> {
    const where = ['user_id = ?'];
    const params: unknown[] = [payload.userId];
    const brokerKey = this.nullableString(payload.brokerKey);
    if (brokerKey) {
      where.push('LOWER(broker_key) = ?');
      params.push(this.normalizeBrokerKey(brokerKey));
    }
    const accountId = this.nullableString(payload.accountId);
    if (accountId) {
      where.push('account_id = ?');
      params.push(accountId);
    }
    params.push(Math.min(Math.max(1, Math.floor(Number(payload.limit || 25))), 200));

    return (await coreDataSource.query(
      `SELECT id, user_id, broker_key, account_id, run_type, status, started_at, finished_at
         FROM broker_reconciliation_runs
        WHERE ${where.join(' AND ')}
        ORDER BY started_at DESC, created_at DESC
        LIMIT ?`,
      params
    )) as BrokerReconciliationRunRow[];
  }

  async listReconciliationRuns(
    payload: BrokerReconciliationRunReadFilters
  ): Promise<{ items: BrokerReconciliationRunReadRow[]; total: number }> {
    const filters = this.buildRunReadFilters(payload);
    const limit = this.limitParam(payload.limit, 25, 200);
    const offset = this.offsetParam(payload.offset);

    const [countRows, items] = await Promise.all([
      coreDataSource.query(
        `SELECT COUNT(*) AS total
           FROM broker_reconciliation_runs
          WHERE ${filters.where}`,
        filters.params
      ),
      coreDataSource.query(
        `SELECT id, user_id, broker_key, account_id, run_type, status, window_start_at,
                window_end_at, started_at, finished_at, fills_count, fee_entries_count,
                funding_entries_count, wallet_transactions_count, balance_snapshots_count,
                gross_pnl, fees_total, funding_total, net_pnl, balance_delta,
                unmatched_delta, summary_json, error_message, created_at, updated_at
           FROM broker_reconciliation_runs
          WHERE ${filters.where}
          ORDER BY started_at DESC, created_at DESC
          LIMIT ? OFFSET ?`,
        [...filters.params, limit, offset]
      ),
    ]);

    return {
      items: items as BrokerReconciliationRunReadRow[],
      total: this.numberFromRow(countRows, 'total'),
    };
  }

  async getReconciliationRunById(
    userId: string,
    runId: string
  ): Promise<BrokerReconciliationRunReadRow | null> {
    const rows = (await coreDataSource.query(
      `SELECT id, user_id, broker_key, account_id, run_type, status, window_start_at,
              window_end_at, started_at, finished_at, fills_count, fee_entries_count,
              funding_entries_count, wallet_transactions_count, balance_snapshots_count,
              gross_pnl, fees_total, funding_total, net_pnl, balance_delta,
              unmatched_delta, summary_json, error_message, created_at, updated_at
         FROM broker_reconciliation_runs
        WHERE user_id = ? AND id = ?
        LIMIT 1`,
      [userId, runId]
    )) as BrokerReconciliationRunReadRow[];

    return rows[0] ?? null;
  }

  async listUnmatchedEvidence(
    payload: BrokerReconciliationUnmatchedEvidenceFilters
  ): Promise<{ items: BrokerReconciliationUnmatchedEvidenceRow[]; total: number }> {
    const selectedKinds = this.resolveUnmatchedKinds(payload.kind);
    const limit = this.limitParam(payload.limit, 25, 200);
    const offset = this.offsetParam(payload.offset);
    const unions = selectedKinds.map((kind) => this.buildUnmatchedEvidenceSelect(kind, payload));
    const unionSql = unions.map((entry) => entry.sql).join('\nUNION ALL\n');
    const unionParams = unions.flatMap((entry) => entry.params);

    const [countRows, items] = await Promise.all([
      coreDataSource.query(`SELECT COUNT(*) AS total FROM (${unionSql}) evidence`, unionParams),
      coreDataSource.query(
        `SELECT * FROM (${unionSql}) evidence
          ORDER BY occurred_at DESC, id DESC
          LIMIT ? OFFSET ?`,
        [...unionParams, limit, offset]
      ),
    ]);

    return {
      items: items as BrokerReconciliationUnmatchedEvidenceRow[],
      total: this.numberFromRow(countRows, 'total'),
    };
  }

  async linkFillsByExecutionOrderId(payload: BrokerReconciliationMatchFilters): Promise<number> {
    const filters = this.buildBrokerRowFilters('bf', payload, 'filled_at');
    return this.readAffectedRows(
      await coreDataSource.query(
        `UPDATE broker_fills bf
          JOIN suggested_trade_executions ste
            ON ste.user_id = bf.user_id
           AND LOWER(ste.broker_key) = bf.broker_key
           AND ste.account_id = bf.account_id
           AND ste.order_id IS NOT NULL
           AND ste.order_id = bf.order_id
           SET bf.suggested_trade_id = ste.suggested_trade_id,
               bf.match_state = 'matched',
               bf.match_confidence = 'exact',
               bf.updated_at = NOW()
         WHERE ${filters.where}
           AND bf.suggested_trade_id IS NULL
           AND bf.order_id IS NOT NULL`,
        filters.params
      )
    );
  }

  async linkFillsBySubmissionOrderId(payload: BrokerReconciliationMatchFilters): Promise<number> {
    const filters = this.buildBrokerRowFilters('bf', payload, 'filled_at');
    return this.readAffectedRows(
      await coreDataSource.query(
        `UPDATE broker_fills bf
          JOIN order_submission_requests osr
            ON osr.user_id = bf.user_id
           AND LOWER(osr.broker_key) = bf.broker_key
           AND osr.account_id = bf.account_id
           AND osr.broker_order_id IS NOT NULL
           AND osr.broker_order_id = bf.order_id
           AND osr.suggested_trade_id IS NOT NULL
           SET bf.suggested_trade_id = osr.suggested_trade_id,
               bf.match_state = 'matched',
               bf.match_confidence = 'exact',
               bf.updated_at = NOW()
         WHERE ${filters.where}
           AND bf.suggested_trade_id IS NULL
           AND bf.order_id IS NOT NULL`,
        filters.params
      )
    );
  }

  async linkFillsByPositionId(payload: BrokerReconciliationMatchFilters): Promise<number> {
    const filters = this.buildBrokerRowFilters('bf', payload, 'filled_at');
    return this.readAffectedRows(
      await coreDataSource.query(
        `UPDATE broker_fills bf
          JOIN suggested_trade_executions ste
            ON ste.user_id = bf.user_id
           AND LOWER(ste.broker_key) = bf.broker_key
           AND ste.account_id = bf.account_id
           AND ste.position_id IS NOT NULL
           AND ste.position_id = bf.position_id
           SET bf.suggested_trade_id = ste.suggested_trade_id,
               bf.match_state = 'matched',
               bf.match_confidence = 'exact',
               bf.updated_at = NOW()
         WHERE ${filters.where}
           AND bf.suggested_trade_id IS NULL
           AND bf.position_id IS NOT NULL`,
        filters.params
      )
    );
  }

  async linkFillsBySymbolTimeSide(payload: BrokerReconciliationMatchFilters): Promise<number> {
    const fallbackWindowMinutes = Math.min(
      Math.max(1, Math.floor(Number(payload.fallbackWindowMinutes || 30))),
      24 * 60
    );
    const filters = this.buildBrokerRowFilters('bf', payload, 'filled_at');
    return this.readAffectedRows(
      await coreDataSource.query(
        `UPDATE broker_fills bf
          JOIN (
            SELECT bf_inner.id AS fill_id, MIN(st.id) AS suggested_trade_id
              FROM broker_fills bf_inner
              JOIN suggested_trades st
                ON st.user_id = bf_inner.user_id
               AND UPPER(st.symbol) = UPPER(bf_inner.symbol)
               AND CASE
                     WHEN LOWER(st.side) IN ('buy', 'long') THEN 'buy'
                     WHEN LOWER(st.side) IN ('sell', 'short') THEN 'sell'
                     ELSE LOWER(st.side)
                   END = CASE
                     WHEN LOWER(bf_inner.side) IN ('buy', 'long') THEN 'buy'
                     WHEN LOWER(bf_inner.side) IN ('sell', 'short') THEN 'sell'
                     ELSE LOWER(bf_inner.side)
                   END
              LEFT JOIN suggested_trade_executions ste
                ON ste.suggested_trade_id = st.id
             WHERE ${filters.where.replace(/\bbf\./g, 'bf_inner.')}
               AND bf_inner.suggested_trade_id IS NULL
               AND bf_inner.symbol IS NOT NULL
               AND bf_inner.side IS NOT NULL
               AND bf_inner.filled_at IS NOT NULL
               AND ABS(TIMESTAMPDIFF(MINUTE, COALESCE(ste.filled_at, ste.submitted_at, st.signal_time), bf_inner.filled_at)) <= ?
             GROUP BY bf_inner.id
          ) candidate
            ON candidate.fill_id = bf.id
           SET bf.suggested_trade_id = candidate.suggested_trade_id,
               bf.match_state = 'matched',
               bf.match_confidence = 'medium',
               bf.updated_at = NOW()`,
        [...filters.params, fallbackWindowMinutes]
      )
    );
  }

  async linkFeeEntriesFromMatchedFills(payload: BrokerReconciliationMatchFilters): Promise<number> {
    const filters = this.buildBrokerRowFilters('fee', payload, 'occurred_at');
    return this.readAffectedRows(
      await coreDataSource.query(
        `UPDATE broker_fee_entries fee
          JOIN broker_fills bf
            ON bf.user_id = fee.user_id
           AND bf.broker_key = fee.broker_key
           AND bf.account_id = fee.account_id
           AND bf.suggested_trade_id IS NOT NULL
           AND (
             (fee.order_id IS NOT NULL AND fee.order_id = bf.order_id)
             OR (fee.position_id IS NOT NULL AND fee.position_id = bf.position_id)
           )
           SET fee.suggested_trade_id = bf.suggested_trade_id,
               fee.match_state = 'matched',
               fee.match_confidence = CASE WHEN bf.match_confidence = 'exact' THEN 'exact' ELSE 'medium' END,
               fee.updated_at = NOW()
         WHERE ${filters.where}
           AND fee.suggested_trade_id IS NULL`,
        filters.params
      )
    );
  }

  async linkFundingEntriesFromMatchedFills(
    payload: BrokerReconciliationMatchFilters
  ): Promise<number> {
    const filters = this.buildBrokerRowFilters('funding', payload, 'occurred_at');
    return this.readAffectedRows(
      await coreDataSource.query(
        `UPDATE broker_funding_entries funding
          JOIN broker_fills bf
            ON bf.user_id = funding.user_id
           AND bf.broker_key = funding.broker_key
           AND bf.account_id = funding.account_id
           AND bf.suggested_trade_id IS NOT NULL
           AND funding.position_id IS NOT NULL
           AND funding.position_id = bf.position_id
           SET funding.suggested_trade_id = bf.suggested_trade_id,
               funding.match_state = 'matched',
               funding.match_confidence = CASE WHEN bf.match_confidence = 'exact' THEN 'exact' ELSE 'medium' END,
               funding.updated_at = NOW()
         WHERE ${filters.where}
           AND funding.suggested_trade_id IS NULL`,
        filters.params
      )
    );
  }

  async linkWalletTransactionsFromMatchedFills(
    payload: BrokerReconciliationMatchFilters
  ): Promise<number> {
    const filters = this.buildBrokerRowFilters('wallet', payload, 'occurred_at');
    return this.readAffectedRows(
      await coreDataSource.query(
        `UPDATE broker_wallet_transactions wallet
          JOIN broker_fills bf
            ON bf.user_id = wallet.user_id
           AND bf.broker_key = wallet.broker_key
           AND bf.account_id = wallet.account_id
           AND bf.suggested_trade_id IS NOT NULL
           AND (
             (wallet.order_id IS NOT NULL AND wallet.order_id = bf.order_id)
             OR (wallet.position_id IS NOT NULL AND wallet.position_id = bf.position_id)
             OR (wallet.reference_id IS NOT NULL AND wallet.reference_id = bf.external_id)
           )
           SET wallet.match_state = 'matched',
               wallet.match_confidence = CASE WHEN bf.match_confidence = 'exact' THEN 'exact' ELSE 'medium' END,
               wallet.updated_at = NOW()
         WHERE ${filters.where}`,
        filters.params
      )
    );
  }

  async runAppBrokerMatching(
    payload: BrokerReconciliationMatchFilters
  ): Promise<BrokerReconciliationMatchCounts> {
    const fillsMatchedByExecutionOrderId = await this.linkFillsByExecutionOrderId(payload);
    const fillsMatchedBySubmissionOrderId = await this.linkFillsBySubmissionOrderId(payload);
    const fillsMatchedByPositionId = await this.linkFillsByPositionId(payload);
    const fillsMatchedBySymbolTimeSide = await this.linkFillsBySymbolTimeSide(payload);
    const feeEntriesLinked = await this.linkFeeEntriesFromMatchedFills(payload);
    const fundingEntriesLinked = await this.linkFundingEntriesFromMatchedFills(payload);
    const walletTransactionsLinked = await this.linkWalletTransactionsFromMatchedFills(payload);

    return {
      fillsMatchedByExecutionOrderId,
      fillsMatchedBySubmissionOrderId,
      fillsMatchedByPositionId,
      fillsMatchedBySymbolTimeSide,
      feeEntriesLinked,
      fundingEntriesLinked,
      walletTransactionsLinked,
    };
  }

  async readComparisonTotals(
    payload: BrokerReconciliationMatchFilters
  ): Promise<BrokerReconciliationComparisonTotals> {
    const appFilters = this.buildAppExecutionFilters(payload);
    const fillFilters = this.buildBrokerRowFilters('bf', payload, 'filled_at');
    const feeFilters = this.buildBrokerRowFilters('fee', payload, 'occurred_at');
    const fundingFilters = this.buildBrokerRowFilters('funding', payload, 'occurred_at');
    const walletFilters = this.buildBrokerRowFilters('wallet', payload, 'occurred_at');

    const [appRows, fillRows, feeRows, fundingRows, walletRows] = await Promise.all([
      coreDataSource.query(
        `SELECT
            COUNT(*) AS appTradeCount,
            COALESCE(SUM(CASE WHEN matched.suggested_trade_id IS NOT NULL THEN 1 ELSE 0 END), 0) AS appMatchedTradeCount,
            COALESCE(SUM(COALESCE(ste.realized_pnl, 0)), 0) AS appGrossPnl,
            COALESCE(SUM(CASE WHEN matched.suggested_trade_id IS NOT NULL THEN COALESCE(ste.realized_pnl, 0) ELSE 0 END), 0) AS appMatchedGrossPnl
           FROM suggested_trade_executions ste
           JOIN suggested_trades st ON st.id = ste.suggested_trade_id
           LEFT JOIN (
             SELECT DISTINCT suggested_trade_id
               FROM broker_fills
              WHERE suggested_trade_id IS NOT NULL
                AND match_state = 'matched'
           ) matched ON matched.suggested_trade_id = ste.suggested_trade_id
          WHERE ${appFilters.where}`,
        appFilters.params
      ),
      coreDataSource.query(
        `SELECT
            COUNT(*) AS brokerFillCount,
            COALESCE(SUM(CASE WHEN suggested_trade_id IS NOT NULL AND match_state = 'matched' THEN 1 ELSE 0 END), 0) AS brokerMatchedFillCount,
            COALESCE(SUM(CASE WHEN suggested_trade_id IS NULL OR match_state <> 'matched' THEN 1 ELSE 0 END), 0) AS brokerUnmatchedFillCount,
            COALESCE(SUM(COALESCE(notional, 0)), 0) AS brokerNotional,
            COALESCE(SUM(CASE WHEN suggested_trade_id IS NOT NULL AND match_state = 'matched' THEN COALESCE(notional, 0) ELSE 0 END), 0) AS brokerMatchedNotional
           FROM broker_fills bf
          WHERE ${fillFilters.where}`,
        fillFilters.params
      ),
      coreDataSource.query(
        `SELECT
            COALESCE(SUM(COALESCE(amount, 0)), 0) AS brokerFeeTotal,
            COALESCE(SUM(CASE WHEN suggested_trade_id IS NOT NULL AND match_state = 'matched' THEN COALESCE(amount, 0) ELSE 0 END), 0) AS brokerMatchedFeeTotal
           FROM broker_fee_entries fee
          WHERE ${feeFilters.where}`,
        feeFilters.params
      ),
      coreDataSource.query(
        `SELECT
            COALESCE(SUM(COALESCE(amount, 0)), 0) AS brokerFundingTotal,
            COALESCE(SUM(CASE WHEN suggested_trade_id IS NOT NULL AND match_state = 'matched' THEN COALESCE(amount, 0) ELSE 0 END), 0) AS brokerMatchedFundingTotal
           FROM broker_funding_entries funding
          WHERE ${fundingFilters.where}`,
        fundingFilters.params
      ),
      coreDataSource.query(
        `SELECT
            COALESCE(SUM(COALESCE(amount, 0)), 0) AS brokerWalletTransactionTotal,
            COALESCE(SUM(CASE WHEN match_state = 'matched' THEN COALESCE(amount, 0) ELSE 0 END), 0) AS brokerMatchedWalletTransactionTotal
           FROM broker_wallet_transactions wallet
          WHERE ${walletFilters.where}`,
        walletFilters.params
      ),
    ]);

    return {
      appTradeCount: this.numberFromRow(appRows, 'appTradeCount'),
      appMatchedTradeCount: this.numberFromRow(appRows, 'appMatchedTradeCount'),
      appGrossPnl: this.numberFromRow(appRows, 'appGrossPnl'),
      appMatchedGrossPnl: this.numberFromRow(appRows, 'appMatchedGrossPnl'),
      brokerFillCount: this.numberFromRow(fillRows, 'brokerFillCount'),
      brokerMatchedFillCount: this.numberFromRow(fillRows, 'brokerMatchedFillCount'),
      brokerUnmatchedFillCount: this.numberFromRow(fillRows, 'brokerUnmatchedFillCount'),
      brokerNotional: this.numberFromRow(fillRows, 'brokerNotional'),
      brokerMatchedNotional: this.numberFromRow(fillRows, 'brokerMatchedNotional'),
      brokerFeeTotal: this.numberFromRow(feeRows, 'brokerFeeTotal'),
      brokerMatchedFeeTotal: this.numberFromRow(feeRows, 'brokerMatchedFeeTotal'),
      brokerFundingTotal: this.numberFromRow(fundingRows, 'brokerFundingTotal'),
      brokerMatchedFundingTotal: this.numberFromRow(fundingRows, 'brokerMatchedFundingTotal'),
      brokerWalletTransactionTotal: this.numberFromRow(walletRows, 'brokerWalletTransactionTotal'),
      brokerMatchedWalletTransactionTotal: this.numberFromRow(
        walletRows,
        'brokerMatchedWalletTransactionTotal'
      ),
    };
  }

  async readLatestCompletedSourceRun(
    payload: BrokerReconciliationMatchFilters
  ): Promise<BrokerReconciliationSourceRunTotals | null> {
    const where = ['user_id = ?', "status = 'completed'"];
    const params: unknown[] = [payload.userId];
    const brokerKey = this.nullableString(payload.brokerKey);
    if (brokerKey) {
      where.push('LOWER(broker_key) = ?');
      params.push(this.normalizeBrokerKey(brokerKey));
    }
    const accountId = this.nullableString(payload.accountId);
    if (accountId) {
      where.push('account_id = ?');
      params.push(accountId);
    }
    const windowStartAt = this.dateParam(payload.windowStartAt);
    if (windowStartAt) {
      where.push('(window_end_at IS NULL OR window_end_at >= ? OR finished_at >= ?)');
      params.push(windowStartAt, windowStartAt);
    }
    const windowEndAt = this.dateParam(payload.windowEndAt);
    if (windowEndAt) {
      where.push('(window_start_at IS NULL OR window_start_at <= ? OR started_at <= ?)');
      params.push(windowEndAt, windowEndAt);
    }

    const rows = (await coreDataSource.query(
      `SELECT id, broker_key AS brokerKey, account_id AS accountId, run_type AS runType,
              started_at AS startedAt, finished_at AS finishedAt,
              COALESCE(gross_pnl, 0) AS grossPnl,
              COALESCE(fees_total, 0) AS feesTotal,
              COALESCE(funding_total, 0) AS fundingTotal,
              COALESCE(net_pnl, 0) AS netPnl
         FROM broker_reconciliation_runs
        WHERE ${where.join(' AND ')}
          AND run_type IN ('mudrex_reconciliation_sync', 'delta_reconciliation_sync')
        ORDER BY finished_at DESC, started_at DESC
        LIMIT 1`,
      params
    )) as Array<Record<string, unknown>>;

    const row = rows[0];
    if (!row) {
      return null;
    }

    return {
      id: this.requiredString(row.id, 'id'),
      brokerKey: this.requiredString(row.brokerKey, 'brokerKey'),
      accountId: this.nullableString(row.accountId),
      runType: this.requiredString(row.runType, 'runType'),
      startedAt: this.dateParam(row.startedAt as Date | string | null),
      finishedAt: this.dateParam(row.finishedAt as Date | string | null),
      grossPnl: this.toNumber(row.grossPnl),
      feesTotal: this.toNumber(row.feesTotal),
      fundingTotal: this.toNumber(row.fundingTotal),
      netPnl: this.toNumber(row.netPnl),
    };
  }

  private normalizeBrokerKey(value: string): string {
    return this.requiredString(value, 'brokerKey').toLowerCase();
  }

  private normalizeSource(value: unknown): string {
    return this.nullableString(value) || 'broker_reconciliation';
  }

  private normalizeMatchState(value: unknown): string {
    return this.nullableString(value) || 'unmatched';
  }

  private normalizeMatchConfidence(value: unknown): string {
    return this.nullableString(value) || 'unknown';
  }

  private requiredString(value: unknown, fieldName: string): string {
    const normalized = this.nullableString(value);
    if (!normalized) {
      throw new Error(`Broker reconciliation ${fieldName} is required`);
    }
    return normalized;
  }

  private nullableString(value: unknown): string | null {
    if (value === null || value === undefined) {
      return null;
    }
    const text = String(value).trim();
    return text || null;
  }

  private requiredDecimal(value: unknown, fieldName: string): string {
    const normalized = this.decimalParam(value);
    if (normalized === null) {
      throw new Error(`Broker reconciliation ${fieldName} is required`);
    }
    return normalized;
  }

  private decimalParam(value: unknown): string | null {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return null;
    }
    return String(value);
  }

  private integerParam(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
  }

  private dateParam(value: Date | string | null | undefined): Date | null {
    if (!value) {
      return null;
    }
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value;
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private jsonParam(value: unknown): string | null {
    if (value === null || value === undefined) {
      return null;
    }
    return JSON.stringify(value);
  }

  private readMutationResult(result: unknown): BrokerReconciliationMutationResult {
    const affectedRows = this.readAffectedRows(result);
    if (affectedRows === 1) {
      return { inserted: true, updated: false };
    }
    if (affectedRows >= 2) {
      return { inserted: false, updated: true };
    }
    return { inserted: false, updated: false };
  }

  private readAffectedRows(result: unknown): number {
    if (result && typeof result === 'object' && !Array.isArray(result)) {
      const value = Number(
        (result as { affectedRows?: unknown; rowCount?: unknown }).affectedRows ??
          (result as { affectedRows?: unknown; rowCount?: unknown }).rowCount ??
          0
      );
      return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
    }
    return 0;
  }

  private buildBrokerRowFilters(
    alias: string,
    payload: BrokerReconciliationMatchFilters,
    dateColumn: string
  ): { where: string; params: unknown[] } {
    const where = [`${alias}.user_id = ?`];
    const params: unknown[] = [payload.userId];
    const brokerKey = this.nullableString(payload.brokerKey);
    if (brokerKey) {
      where.push(`LOWER(${alias}.broker_key) = ?`);
      params.push(this.normalizeBrokerKey(brokerKey));
    }
    const accountId = this.nullableString(payload.accountId);
    if (accountId) {
      where.push(`${alias}.account_id = ?`);
      params.push(accountId);
    }
    const windowStartAt = this.dateParam(payload.windowStartAt);
    if (windowStartAt) {
      where.push(`(${alias}.${dateColumn} IS NULL OR ${alias}.${dateColumn} >= ?)`);
      params.push(windowStartAt);
    }
    const windowEndAt = this.dateParam(payload.windowEndAt);
    if (windowEndAt) {
      where.push(`(${alias}.${dateColumn} IS NULL OR ${alias}.${dateColumn} <= ?)`);
      params.push(windowEndAt);
    }
    return { where: where.join(' AND '), params };
  }

  private buildAppExecutionFilters(payload: BrokerReconciliationMatchFilters): {
    where: string;
    params: unknown[];
  } {
    const where = ['ste.user_id = ?'];
    const params: unknown[] = [payload.userId];
    const brokerKey = this.nullableString(payload.brokerKey);
    if (brokerKey) {
      where.push('LOWER(ste.broker_key) = ?');
      params.push(this.normalizeBrokerKey(brokerKey));
    }
    const accountId = this.nullableString(payload.accountId);
    if (accountId) {
      where.push('ste.account_id = ?');
      params.push(accountId);
    }
    const windowExpression =
      'COALESCE(ste.position_closed_at, ste.filled_at, ste.submitted_at, st.signal_time)';
    const windowStartAt = this.dateParam(payload.windowStartAt);
    if (windowStartAt) {
      where.push(`${windowExpression} >= ?`);
      params.push(windowStartAt);
    }
    const windowEndAt = this.dateParam(payload.windowEndAt);
    if (windowEndAt) {
      where.push(`${windowExpression} <= ?`);
      params.push(windowEndAt);
    }
    return { where: where.join(' AND '), params };
  }

  private numberFromRow(rows: unknown, key: string): number {
    const row = Array.isArray(rows) ? (rows[0] as Record<string, unknown> | undefined) : undefined;
    return this.toNumber(row?.[key]);
  }

  private buildRunReadFilters(payload: BrokerReconciliationRunReadFilters): {
    where: string;
    params: unknown[];
  } {
    const where = ['user_id = ?'];
    const params: unknown[] = [payload.userId];
    const brokerKey = this.nullableString(payload.brokerKey);
    if (brokerKey) {
      where.push('LOWER(broker_key) = ?');
      params.push(this.normalizeBrokerKey(brokerKey));
    }
    const accountId = this.nullableString(payload.accountId);
    if (accountId) {
      where.push('account_id = ?');
      params.push(accountId);
    }
    const status = this.nullableString(payload.status);
    if (status) {
      where.push('LOWER(status) = ?');
      params.push(status.toLowerCase());
    }
    const runType = this.nullableString(payload.runType);
    if (runType) {
      where.push('run_type = ?');
      params.push(runType);
    }
    return { where: where.join(' AND '), params };
  }

  private buildUnmatchedEvidenceSelect(
    kind: string,
    payload: BrokerReconciliationUnmatchedEvidenceFilters
  ): { sql: string; params: unknown[] } {
    const config = this.unmatchedEvidenceConfig(kind);
    const filters = this.buildBrokerRowFilters(config.alias, payload, config.dateColumn);
    const extraWhere = config.hasSuggestedTradeId
      ? `(${config.alias}.suggested_trade_id IS NULL OR ${config.alias}.match_state <> 'matched')`
      : `${config.alias}.match_state <> 'matched'`;
    return {
      sql: `SELECT '${kind}' AS kind,
                   ${config.alias}.id,
                   ${config.alias}.broker_key,
                   ${config.alias}.account_id,
                   ${config.alias}.external_id,
                   ${config.symbolExpression} AS symbol,
                   ${config.orderIdExpression} AS order_id,
                   ${config.positionIdExpression} AS position_id,
                   ${config.suggestedTradeIdExpression} AS suggested_trade_id,
                   ${config.sideExpression} AS side,
                   ${config.amountExpression} AS amount,
                   ${config.quantityExpression} AS quantity,
                   ${config.priceExpression} AS price,
                   ${config.alias}.${config.dateColumn} AS occurred_at,
                   ${config.alias}.match_state,
                   ${config.alias}.match_confidence,
                   ${config.alias}.source,
                   ${config.alias}.raw_payload_json
              FROM ${config.table} ${config.alias}
             WHERE ${filters.where}
               AND ${extraWhere}`,
      params: filters.params,
    };
  }

  private unmatchedEvidenceConfig(kind: string): {
    table: string;
    alias: string;
    dateColumn: string;
    hasSuggestedTradeId: boolean;
    symbolExpression: string;
    orderIdExpression: string;
    positionIdExpression: string;
    suggestedTradeIdExpression: string;
    sideExpression: string;
    amountExpression: string;
    quantityExpression: string;
    priceExpression: string;
  } {
    if (kind === 'fees') {
      return {
        table: 'broker_fee_entries',
        alias: 'fee',
        dateColumn: 'occurred_at',
        hasSuggestedTradeId: true,
        symbolExpression: 'fee.symbol',
        orderIdExpression: 'fee.order_id',
        positionIdExpression: 'fee.position_id',
        suggestedTradeIdExpression: 'fee.suggested_trade_id',
        sideExpression: 'NULL',
        amountExpression: 'fee.amount',
        quantityExpression: 'NULL',
        priceExpression: 'NULL',
      };
    }
    if (kind === 'funding') {
      return {
        table: 'broker_funding_entries',
        alias: 'funding',
        dateColumn: 'occurred_at',
        hasSuggestedTradeId: true,
        symbolExpression: 'funding.symbol',
        orderIdExpression: 'NULL',
        positionIdExpression: 'funding.position_id',
        suggestedTradeIdExpression: 'funding.suggested_trade_id',
        sideExpression: 'funding.side',
        amountExpression: 'funding.amount',
        quantityExpression: 'NULL',
        priceExpression: 'NULL',
      };
    }
    if (kind === 'wallet') {
      return {
        table: 'broker_wallet_transactions',
        alias: 'wallet',
        dateColumn: 'occurred_at',
        hasSuggestedTradeId: false,
        symbolExpression: 'wallet.symbol',
        orderIdExpression: 'wallet.order_id',
        positionIdExpression: 'wallet.position_id',
        suggestedTradeIdExpression: 'NULL',
        sideExpression: 'NULL',
        amountExpression: 'wallet.amount',
        quantityExpression: 'NULL',
        priceExpression: 'NULL',
      };
    }
    return {
      table: 'broker_fills',
      alias: 'fill',
      dateColumn: 'filled_at',
      hasSuggestedTradeId: true,
      symbolExpression: 'fill.symbol',
      orderIdExpression: 'fill.order_id',
      positionIdExpression: 'fill.position_id',
      suggestedTradeIdExpression: 'fill.suggested_trade_id',
      sideExpression: 'fill.side',
      amountExpression: 'fill.notional',
      quantityExpression: 'fill.quantity',
      priceExpression: 'fill.price',
    };
  }

  private resolveUnmatchedKinds(kind: string | null | undefined): string[] {
    const normalized = this.nullableString(kind)?.toLowerCase();
    if (!normalized || normalized === 'all') {
      return ['fills', 'fees', 'funding', 'wallet'];
    }
    if (['fills', 'fees', 'funding', 'wallet'].includes(normalized)) {
      return [normalized];
    }
    return ['fills', 'fees', 'funding', 'wallet'];
  }

  private limitParam(value: unknown, fallback: number, max: number): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return fallback;
    }
    return Math.min(parsed, max);
  }

  private offsetParam(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) {
      return 0;
    }
    return parsed;
  }

  private toNumber(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
}
