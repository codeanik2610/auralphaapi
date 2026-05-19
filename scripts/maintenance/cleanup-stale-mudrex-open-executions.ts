import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { coreDataSource } from '../../src/database/data-source';

type JsonRecord = Record<string, unknown>;

const APPLY =
  String(process.env.SUGGESTED_TRADES_STALE_MUDREX_OPEN_EXECUTIONS_APPLY || '')
    .trim()
    .toLowerCase() === 'true';
const LIMIT = Math.max(
  1,
  Number(process.env.SUGGESTED_TRADES_STALE_MUDREX_OPEN_EXECUTIONS_LIMIT || 100)
);
const STALE_MINUTES = Math.max(
  15,
  Number(process.env.SUGGESTED_TRADES_STALE_MUDREX_OPEN_EXECUTIONS_MIN_AGE_MINUTES || 60)
);
const POSITION_SNAPSHOT_FRESH_MINUTES = Math.max(
  5,
  Number(process.env.SUGGESTED_TRADES_STALE_MUDREX_OPEN_EXECUTIONS_FRESH_MINUTES || 15)
);
const OUTPUT_FILE = String(
  process.env.SUGGESTED_TRADES_STALE_MUDREX_OPEN_EXECUTIONS_OUTPUT_FILE ||
    'artifacts/suggested-trades-stale-mudrex-open-executions.json'
).trim();

const LOCAL_ACTIVE_SQL = `LOWER(COALESCE(execution_record.execution_state, '')) NOT IN ('closed', 'cancelled', 'rejected', 'expired', 'failed')
          AND LOWER(COALESCE(execution_record.position_status, '')) NOT IN ('closed', 'liquidated')`;
const MUDREX_OPEN_POSITION_SQL = `(LOWER(COALESCE(position_snapshot.status, '')) IN ('open', 'partial', 'partially_closed', 'partially_closed_position')
              OR (position_snapshot.status_rank > 0 AND position_snapshot.status_rank <= 2))`;
const ACTIVE_ENTRY_ORDER_SQL = `(UPPER(COALESCE(order_snapshot.order_status, '')) IN ('OPEN', 'PENDING', 'PARTIALLY_FILLED', 'PARTIAL_FILLED', 'PARTIAL', 'TRIGGER_PENDING')
              OR (order_snapshot.status_rank > 0 AND order_snapshot.status_rank <= 2))`;

function readString(value: unknown): string {
  return String(value || '').trim();
}

function readCount(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : 0;
}

function toIsoString(value: unknown): string | null {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function mapRow(row: JsonRecord): JsonRecord {
  return {
    suggestedTradeId: readString(row.suggestedTradeId),
    userId: readString(row.userId),
    symbol: readString(row.symbol),
    side: readString(row.side).toUpperCase(),
    timeframe: readString(row.timeframe),
    accountId: readString(row.accountId) || null,
    orderId: readString(row.orderId) || null,
    orderStatus: readString(row.orderStatus) || null,
    executionState: readString(row.executionState) || null,
    positionId: readString(row.positionId) || null,
    positionStatus: readString(row.positionStatus) || null,
    protectionState: readString(row.protectionState) || null,
    protectionCheckedAt: toIsoString(row.protectionCheckedAt),
    updatedAt: toIsoString(row.updatedAt),
    positionSnapshotStatus: readString(row.positionSnapshotStatus) || null,
    positionSnapshotRank: row.positionSnapshotRank ?? null,
    positionSnapshotLastSeenAt: toIsoString(row.positionSnapshotLastSeenAt),
    positionSnapshotFreshnessAt: toIsoString(row.positionSnapshotFreshnessAt),
  };
}

async function persistReport(report: JsonRecord): Promise<void> {
  if (!OUTPUT_FILE) {
    return;
  }
  const absoluteOutputPath = path.resolve(process.cwd(), OUTPUT_FILE);
  await mkdir(path.dirname(absoluteOutputPath), { recursive: true });
  await writeFile(absoluteOutputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

function buildCandidateSql(limit: number): string {
  return `SELECT suggested_trade.id AS suggestedTradeId,
                 suggested_trade.user_id AS userId,
                 suggested_trade.symbol AS symbol,
                 suggested_trade.side AS side,
                 suggested_trade.timeframe AS timeframe,
                 execution_record.account_id AS accountId,
                 execution_record.order_id AS orderId,
                 execution_record.order_status AS orderStatus,
                 execution_record.execution_state AS executionState,
                 execution_record.position_id AS positionId,
                 execution_record.position_status AS positionStatus,
                 execution_record.protection_state AS protectionState,
                 execution_record.protection_checked_at AS protectionCheckedAt,
                 execution_record.updated_at AS updatedAt,
                 (
                   SELECT position_snapshot.status
                     FROM scheduler_positions_snapshots position_snapshot
                    WHERE position_snapshot.user_id = execution_record.user_id
                      AND COALESCE(position_snapshot.account_id, '') = COALESCE(execution_record.account_id, '')
                      AND LOWER(COALESCE(position_snapshot.broker_key, '')) = 'mudrex'
                      AND position_snapshot.external_id = execution_record.position_id
                    ORDER BY position_snapshot.last_seen_at DESC, position_snapshot.updated_at DESC
                    LIMIT 1
                 ) AS positionSnapshotStatus,
                 (
                   SELECT position_snapshot.status_rank
                     FROM scheduler_positions_snapshots position_snapshot
                    WHERE position_snapshot.user_id = execution_record.user_id
                      AND COALESCE(position_snapshot.account_id, '') = COALESCE(execution_record.account_id, '')
                      AND LOWER(COALESCE(position_snapshot.broker_key, '')) = 'mudrex'
                      AND position_snapshot.external_id = execution_record.position_id
                    ORDER BY position_snapshot.last_seen_at DESC, position_snapshot.updated_at DESC
                    LIMIT 1
                 ) AS positionSnapshotRank,
                 (
                   SELECT position_snapshot.last_seen_at
                     FROM scheduler_positions_snapshots position_snapshot
                    WHERE position_snapshot.user_id = execution_record.user_id
                      AND COALESCE(position_snapshot.account_id, '') = COALESCE(execution_record.account_id, '')
                      AND LOWER(COALESCE(position_snapshot.broker_key, '')) = 'mudrex'
                      AND position_snapshot.external_id = execution_record.position_id
                    ORDER BY position_snapshot.last_seen_at DESC, position_snapshot.updated_at DESC
                    LIMIT 1
                 ) AS positionSnapshotLastSeenAt,
                 (
                   SELECT MAX(position_snapshot.last_seen_at)
                     FROM scheduler_positions_snapshots position_snapshot
                    WHERE position_snapshot.user_id = execution_record.user_id
                      AND COALESCE(position_snapshot.account_id, '') = COALESCE(execution_record.account_id, '')
                      AND LOWER(COALESCE(position_snapshot.broker_key, '')) = 'mudrex'
                 ) AS positionSnapshotFreshnessAt
            FROM suggested_trade_executions execution_record
            JOIN suggested_trades suggested_trade
              ON suggested_trade.id = execution_record.suggested_trade_id
           WHERE LOWER(COALESCE(execution_record.execution_mode, '')) = 'live'
             AND LOWER(COALESCE(execution_record.broker_key, '')) = 'mudrex'
             AND COALESCE(execution_record.position_id, '') <> ''
             AND ${LOCAL_ACTIVE_SQL}
             AND (
               LOWER(COALESCE(execution_record.position_status, '')) IN ('open', 'partial', 'partially_closed', 'partially_closed_position')
               OR LOWER(COALESCE(execution_record.execution_state, '')) IN ('filled', 'unknown')
               OR UPPER(COALESCE(execution_record.order_status, '')) IN ('CLOSED', 'FILLED', 'PARTIALLY_FILLED', 'PARTIAL_FILLED', 'PARTIAL')
             )
             AND COALESCE(
               execution_record.protection_checked_at,
               execution_record.filled_at,
               execution_record.updated_at,
               execution_record.created_at
             ) < ?
             AND (
               SELECT MAX(position_snapshot.last_seen_at)
                 FROM scheduler_positions_snapshots position_snapshot
                WHERE position_snapshot.user_id = execution_record.user_id
                  AND COALESCE(position_snapshot.account_id, '') = COALESCE(execution_record.account_id, '')
                  AND LOWER(COALESCE(position_snapshot.broker_key, '')) = 'mudrex'
             ) >= ?
             AND NOT EXISTS (
               SELECT 1
                 FROM scheduler_positions_snapshots position_snapshot
                WHERE position_snapshot.user_id = execution_record.user_id
                  AND COALESCE(position_snapshot.account_id, '') = COALESCE(execution_record.account_id, '')
                  AND LOWER(COALESCE(position_snapshot.broker_key, '')) = 'mudrex'
                  AND position_snapshot.external_id = execution_record.position_id
                  AND ${MUDREX_OPEN_POSITION_SQL}
                LIMIT 1
             )
             AND (
               COALESCE(execution_record.order_id, '') = ''
               OR NOT EXISTS (
                 SELECT 1
                   FROM scheduler_orders_snapshots order_snapshot
                  WHERE order_snapshot.user_id = execution_record.user_id
                    AND COALESCE(order_snapshot.account_id, '') = COALESCE(execution_record.account_id, '')
                    AND LOWER(COALESCE(order_snapshot.broker_key, '')) = 'mudrex'
                    AND order_snapshot.external_id = execution_record.order_id
                    AND ${ACTIVE_ENTRY_ORDER_SQL}
                  LIMIT 1
               )
             )
           ORDER BY COALESCE(execution_record.protection_checked_at, execution_record.filled_at, execution_record.updated_at, execution_record.created_at) ASC
           LIMIT ${limit}`;
}

async function run(): Promise<void> {
  if (!coreDataSource.isInitialized) {
    await coreDataSource.initialize();
  }

  try {
    const staleBefore = new Date(Date.now() - STALE_MINUTES * 60_000);
    const freshnessAfter = new Date(Date.now() - POSITION_SNAPSHOT_FRESH_MINUTES * 60_000);
    const rows = (await coreDataSource.query(buildCandidateSql(LIMIT), [
      staleBefore,
      freshnessAfter,
    ])) as JsonRecord[];
    const ids = rows.map((row) => readString(row.suggestedTradeId)).filter(Boolean);

    let updatedRows = 0;
    if (APPLY && ids.length > 0) {
      const placeholders = ids.map(() => '?').join(', ');
      const result = (await coreDataSource.query(
        `UPDATE suggested_trade_executions execution_record
            JOIN suggested_trades suggested_trade
              ON suggested_trade.id = execution_record.suggested_trade_id
             SET execution_record.execution_state = 'closed',
                 execution_record.position_status = COALESCE(
                   (
                     SELECT latest_position.status
                       FROM scheduler_positions_snapshots latest_position
                      WHERE latest_position.user_id = execution_record.user_id
                        AND COALESCE(latest_position.account_id, '') = COALESCE(execution_record.account_id, '')
                        AND LOWER(COALESCE(latest_position.broker_key, '')) = 'mudrex'
                        AND latest_position.external_id = execution_record.position_id
                      ORDER BY latest_position.last_seen_at DESC, latest_position.updated_at DESC
                      LIMIT 1
                   ),
                   'CLOSED'
                 ),
                 execution_record.position_closed_at = COALESCE(
                   execution_record.position_closed_at,
                   (
                     SELECT latest_position.last_seen_at
                       FROM scheduler_positions_snapshots latest_position
                      WHERE latest_position.user_id = execution_record.user_id
                        AND COALESCE(latest_position.account_id, '') = COALESCE(execution_record.account_id, '')
                        AND LOWER(COALESCE(latest_position.broker_key, '')) = 'mudrex'
                        AND latest_position.external_id = execution_record.position_id
                      ORDER BY latest_position.last_seen_at DESC, latest_position.updated_at DESC
                      LIMIT 1
                   ),
                   NOW()
                 ),
                 execution_record.protection_state = 'not_required',
                 execution_record.protection_last_error = NULL,
                 execution_record.protection_checked_at = NOW(),
                 execution_record.updated_at = NOW(),
                 execution_record.note = CASE
                   WHEN COALESCE(execution_record.note, '') = '' THEN 'Stale Mudrex execution cleanup: exact live position is no longer open, so protection is not required.'
                   WHEN execution_record.note LIKE '%Stale Mudrex execution cleanup: exact live position is no longer open, so protection is not required.%' THEN execution_record.note
                   ELSE CONCAT(execution_record.note, ' Stale Mudrex execution cleanup: exact live position is no longer open, so protection is not required.')
                 END
           WHERE suggested_trade.id IN (${placeholders})
             AND LOWER(COALESCE(execution_record.execution_mode, '')) = 'live'
             AND LOWER(COALESCE(execution_record.broker_key, '')) = 'mudrex'
             AND ${LOCAL_ACTIVE_SQL}
             AND NOT EXISTS (
               SELECT 1
                 FROM scheduler_positions_snapshots position_snapshot
                WHERE position_snapshot.user_id = execution_record.user_id
                  AND COALESCE(position_snapshot.account_id, '') = COALESCE(execution_record.account_id, '')
                  AND LOWER(COALESCE(position_snapshot.broker_key, '')) = 'mudrex'
                  AND position_snapshot.external_id = execution_record.position_id
                  AND ${MUDREX_OPEN_POSITION_SQL}
                LIMIT 1
             )
             AND (
               COALESCE(execution_record.order_id, '') = ''
               OR NOT EXISTS (
                 SELECT 1
                   FROM scheduler_orders_snapshots order_snapshot
                  WHERE order_snapshot.user_id = execution_record.user_id
                    AND COALESCE(order_snapshot.account_id, '') = COALESCE(execution_record.account_id, '')
                    AND LOWER(COALESCE(order_snapshot.broker_key, '')) = 'mudrex'
                    AND order_snapshot.external_id = execution_record.order_id
                    AND ${ACTIVE_ENTRY_ORDER_SQL}
                  LIMIT 1
               )
             )`,
        ids
      )) as { affectedRows?: number } | Array<{ affectedRows?: number }>;
      updatedRows = Array.isArray(result)
        ? readCount(result[0]?.affectedRows)
        : readCount(result.affectedRows);
    }

    const report = {
      generatedAt: new Date().toISOString(),
      mode: APPLY ? 'apply' : 'dry_run',
      limit: LIMIT,
      staleMinutes: STALE_MINUTES,
      staleBefore: staleBefore.toISOString(),
      positionSnapshotFreshMinutes: POSITION_SNAPSHOT_FRESH_MINUTES,
      positionSnapshotFreshAfter: freshnessAfter.toISOString(),
      candidateRows: rows.length,
      updatedRows,
      items: rows.map(mapRow),
    };
    await persistReport(report);
    console.log('suggested-trades-stale-mudrex-open-executions:', JSON.stringify(report));
  } finally {
    if (coreDataSource.isInitialized) {
      await coreDataSource.destroy();
    }
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
