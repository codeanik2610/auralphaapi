import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { coreDataSource } from '../../src/database/data-source';

type JsonRecord = Record<string, unknown>;

type ManualProtectionRecoveryItem = {
  suggestedTradeId: string;
  userId: string;
  brokerKey: string | null;
  accountId: string | null;
  symbol: string;
  timeframe: string;
  side: string;
  executionState: string | null;
  positionStatus: string | null;
  orderId: string | null;
  protectionState: string;
  protectionCheckedAt: string | null;
  protectionLastError: string | null;
  checkedAgeSeconds: number | null;
  stale: boolean;
};

const LIMIT = Math.max(1, Number(process.env.SUGGESTED_TRADES_PROTECTION_RECOVERY_LIMIT || 50));
const STALE_AFTER_MINUTES = Math.max(
  1,
  Number(process.env.SUGGESTED_TRADES_PROTECTION_RECOVERY_STALE_MINUTES || 10)
);
const MAX_STALE_MANUAL_PROTECTION_TRADES = Math.max(
  0,
  Number(process.env.SUGGESTED_TRADES_MAX_STALE_MANUAL_PROTECTION_TRADES || 0)
);
const OUTPUT_FILE = String(
  process.env.SUGGESTED_TRADES_PROTECTION_RECOVERY_OUTPUT_FILE ||
    'artifacts/suggested-trades-protection-recovery.json'
).trim();
const ACTIVE_PROTECTION_SQL = `LOWER(COALESCE(execution_record.execution_state, '')) NOT IN ('closed', 'cancelled', 'rejected', 'expired', 'failed')
          AND LOWER(COALESCE(execution_record.position_status, '')) NOT IN ('closed', 'liquidated')`;

function readString(value: unknown): string {
  return String(value || '').trim();
}

function readNullableString(value: unknown): string | null {
  const normalized = readString(value);
  return normalized || null;
}

function readNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function readCount(value: unknown): number {
  const numeric = readNullableNumber(value);
  return numeric === null ? 0 : Math.max(0, Math.floor(numeric));
}

function toIsoString(value: unknown): string | null {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function countBy(items: ManualProtectionRecoveryItem[], key: 'brokerKey'): JsonRecord {
  return items.reduce<JsonRecord>((acc, item) => {
    const value = String(item[key] || 'unknown');
    acc[value] = readCount(acc[value]) + 1;
    return acc;
  }, {});
}

function mapRecoveryItem(
  row: JsonRecord,
  nowMs: number,
  staleBeforeMs: number
): ManualProtectionRecoveryItem {
  const protectionCheckedAt = toIsoString(row.protectionCheckedAt);
  const checkedAtMs = protectionCheckedAt ? Date.parse(protectionCheckedAt) : 0;
  const checkedAgeSeconds =
    checkedAtMs > 0 ? Math.max(0, Math.floor((nowMs - checkedAtMs) / 1000)) : null;

  return {
    suggestedTradeId: readString(row.suggestedTradeId),
    userId: readString(row.userId),
    brokerKey: readNullableString(row.brokerKey),
    accountId: readNullableString(row.accountId),
    symbol: readString(row.symbol),
    timeframe: readString(row.timeframe),
    side: readString(row.side).toUpperCase(),
    executionState: readNullableString(row.executionState),
    positionStatus: readNullableString(row.positionStatus),
    orderId: readNullableString(row.orderId),
    protectionState: readString(row.protectionState).toLowerCase() || 'unknown',
    protectionCheckedAt,
    protectionLastError: readNullableString(row.protectionLastError),
    checkedAgeSeconds,
    stale: !checkedAtMs || checkedAtMs < staleBeforeMs,
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
    const generatedAt = new Date();
    const staleBefore = new Date(generatedAt.getTime() - STALE_AFTER_MINUTES * 60 * 1000);
    const [countRow] = (await coreDataSource.query(
      `SELECT COUNT(*) AS totalManualProtectionTrades,
              COALESCE(SUM(CASE
                WHEN execution_record.protection_checked_at IS NULL
                  OR execution_record.protection_checked_at < ?
                THEN 1 ELSE 0 END), 0) AS staleManualProtectionTrades,
              MIN(execution_record.protection_checked_at) AS oldestCheckedAt,
              MAX(execution_record.protection_checked_at) AS latestCheckedAt
         FROM suggested_trade_executions execution_record
        WHERE LOWER(COALESCE(execution_record.execution_mode, '')) = 'live'
          AND LOWER(COALESCE(execution_record.protection_state, '')) = 'manual_unlinked'
          AND ${ACTIVE_PROTECTION_SQL}`,
      [staleBefore]
    )) as JsonRecord[];

    const rows = (await coreDataSource.query(
      `SELECT suggested_trade.id AS suggestedTradeId,
              suggested_trade.user_id AS userId,
              suggested_trade.symbol AS symbol,
              suggested_trade.timeframe AS timeframe,
              suggested_trade.side AS side,
              execution_record.broker_key AS brokerKey,
              execution_record.account_id AS accountId,
              execution_record.order_id AS orderId,
              execution_record.execution_state AS executionState,
              execution_record.position_status AS positionStatus,
              execution_record.protection_state AS protectionState,
              execution_record.protection_checked_at AS protectionCheckedAt,
              execution_record.protection_last_error AS protectionLastError
         FROM suggested_trade_executions execution_record
         JOIN suggested_trades suggested_trade
           ON suggested_trade.id = execution_record.suggested_trade_id
        WHERE LOWER(COALESCE(execution_record.execution_mode, '')) = 'live'
          AND LOWER(COALESCE(execution_record.protection_state, '')) = 'manual_unlinked'
          AND ${ACTIVE_PROTECTION_SQL}
        ORDER BY COALESCE(execution_record.protection_checked_at, execution_record.updated_at, suggested_trade.signal_time) ASC,
                 suggested_trade.signal_time ASC
        LIMIT ${LIMIT}`
    )) as JsonRecord[];

    const items = rows.map((row) =>
      mapRecoveryItem(row, generatedAt.getTime(), staleBefore.getTime())
    );
    const staleItems = items.filter((item) => item.stale);
    const report = {
      generatedAt: generatedAt.toISOString(),
      staleAfterMinutes: STALE_AFTER_MINUTES,
      staleBefore: staleBefore.toISOString(),
      maxStaleManualProtectionTrades: MAX_STALE_MANUAL_PROTECTION_TRADES,
      totalManualProtectionTrades: readCount(countRow?.totalManualProtectionTrades),
      staleManualProtectionTrades: readCount(countRow?.staleManualProtectionTrades),
      oldestCheckedAt: toIsoString(countRow?.oldestCheckedAt),
      latestCheckedAt: toIsoString(countRow?.latestCheckedAt),
      returnedManualProtectionTrades: items.length,
      returnedStaleManualProtectionTrades: staleItems.length,
      byBroker: countBy(items, 'brokerKey'),
      items,
    };

    await persistReport(report);
    console.log('suggested-trades-protection-recovery:', JSON.stringify(report));

    if (report.staleManualProtectionTrades > MAX_STALE_MANUAL_PROTECTION_TRADES) {
      throw new Error(
        `protection recovery stale manual trades ${report.staleManualProtectionTrades} exceeds ${MAX_STALE_MANUAL_PROTECTION_TRADES}`
      );
    }
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
