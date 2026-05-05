import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { coreDataSource } from '../../src/database/data-source';

type JsonRecord = Record<string, unknown>;

const APPLY =
  String(process.env.SUGGESTED_TRADES_TERMINAL_PROTECTION_REPAIR_APPLY || '')
    .trim()
    .toLowerCase() === 'true';
const LIMIT = Math.max(
  1,
  Number(process.env.SUGGESTED_TRADES_TERMINAL_PROTECTION_REPAIR_LIMIT || 100)
);
const OUTPUT_FILE = String(
  process.env.SUGGESTED_TRADES_TERMINAL_PROTECTION_REPAIR_OUTPUT_FILE ||
    'artifacts/suggested-trades-terminal-protection-repair.json'
).trim();
const TERMINAL_FILTER_SQL = `(
  LOWER(COALESCE(execution_state, '')) IN ('closed', 'cancelled', 'rejected', 'expired', 'failed')
  OR LOWER(COALESCE(position_status, '')) IN ('closed', 'liquidated')
  OR position_closed_at IS NOT NULL
)`;
const REPAIRABLE_PROTECTION_SQL = `LOWER(COALESCE(protection_state, '')) IN (
  'pending',
  'waiting_for_fill',
  'waiting_for_position',
  'attaching',
  'failed',
  'manual_unlinked',
  'unknown'
)`;

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
    brokerKey: readString(row.brokerKey) || null,
    accountId: readString(row.accountId) || null,
    symbol: readString(row.symbol),
    timeframe: readString(row.timeframe),
    side: readString(row.side).toUpperCase(),
    executionState: readString(row.executionState) || null,
    positionStatus: readString(row.positionStatus) || null,
    positionId: readString(row.positionId) || null,
    protectionState: readString(row.protectionState).toLowerCase(),
    protectionLastError: readString(row.protectionLastError) || null,
    positionClosedAt: toIsoString(row.positionClosedAt),
    updatedAt: toIsoString(row.updatedAt),
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

async function run(): Promise<void> {
  if (!coreDataSource.isInitialized) {
    await coreDataSource.initialize();
  }

  try {
    const [countRow] = (await coreDataSource.query(
      `SELECT COUNT(*) AS count
         FROM suggested_trade_executions
        WHERE LOWER(COALESCE(execution_mode, '')) = 'live'
          AND ${REPAIRABLE_PROTECTION_SQL}
          AND ${TERMINAL_FILTER_SQL}`
    )) as JsonRecord[];
    const repairableRows = readCount(countRow?.count);

    const rows = (await coreDataSource.query(
      `SELECT suggested_trade.id AS suggestedTradeId,
              suggested_trade.user_id AS userId,
              suggested_trade.symbol AS symbol,
              suggested_trade.timeframe AS timeframe,
              suggested_trade.side AS side,
              execution_record.broker_key AS brokerKey,
              execution_record.account_id AS accountId,
              execution_record.execution_state AS executionState,
              execution_record.position_id AS positionId,
              execution_record.position_status AS positionStatus,
              execution_record.position_closed_at AS positionClosedAt,
              execution_record.protection_state AS protectionState,
              execution_record.protection_last_error AS protectionLastError,
              execution_record.updated_at AS updatedAt
         FROM suggested_trade_executions execution_record
         JOIN suggested_trades suggested_trade
           ON suggested_trade.id = execution_record.suggested_trade_id
        WHERE LOWER(COALESCE(execution_record.execution_mode, '')) = 'live'
          AND ${REPAIRABLE_PROTECTION_SQL}
          AND ${TERMINAL_FILTER_SQL}
        ORDER BY execution_record.updated_at ASC
        LIMIT ${LIMIT}`
    )) as JsonRecord[];

    let updatedRows = 0;
    if (APPLY && repairableRows > 0) {
      const result = (await coreDataSource.query(
        `UPDATE suggested_trade_executions
            SET protection_state = 'not_required',
                protection_last_error = NULL,
                protection_checked_at = COALESCE(protection_checked_at, NOW()),
                note = CASE
                  WHEN COALESCE(note, '') = '' THEN 'Terminal execution no longer requires manual SL/TP protection.'
                  WHEN note LIKE '%Terminal execution no longer requires manual SL/TP protection.%' THEN note
                  ELSE CONCAT(note, ' Terminal execution no longer requires manual SL/TP protection.')
                END
          WHERE LOWER(COALESCE(execution_mode, '')) = 'live'
            AND ${REPAIRABLE_PROTECTION_SQL}
            AND ${TERMINAL_FILTER_SQL}`
      )) as { affectedRows?: number } | Array<{ affectedRows?: number }>;
      updatedRows = Array.isArray(result)
        ? readCount(result[0]?.affectedRows)
        : readCount(result.affectedRows);
    }

    const report = {
      generatedAt: new Date().toISOString(),
      mode: APPLY ? 'apply' : 'dry_run',
      limit: LIMIT,
      repairableRows,
      returnedRows: rows.length,
      updatedRows,
      items: rows.map(mapRow),
    };
    await persistReport(report);
    console.log('suggested-trades-terminal-protection-repair:', JSON.stringify(report));
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
