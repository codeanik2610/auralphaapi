import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { coreDataSource } from '../../src/database/data-source';

type JsonRecord = Record<string, unknown>;

type ProtectionActionItem = {
  suggestedTradeId: string;
  userId: string;
  brokerKey: string | null;
  accountId: string | null;
  symbol: string;
  timeframe: string;
  side: string;
  tradeStatus: string;
  executionState: string | null;
  orderId: string | null;
  orderStatus: string | null;
  positionId: string | null;
  positionStatus: string | null;
  entryPrice: string | null;
  stopLossPrice: string | null;
  takeProfitPrice: string | null;
  filledPrice: string | null;
  quantity: number | null;
  leverage: number | null;
  protectionState: string;
  protectionAttempts: number;
  protectionSource: string | null;
  protectionLastError: string | null;
  protectionCheckedAt: string | null;
  protectionCheckedAgeSeconds: number | null;
  protectionAttachedAt: string | null;
  recoveryFreshness: 'fresh' | 'stale' | 'unverified';
  staleManualRecovery: boolean;
  staleAttaching: boolean;
  signalTime: string | null;
  submittedAt: string | null;
  linkedAt: string | null;
  filledAt: string | null;
  updatedAt: string | null;
  blockingReason: string;
  recommendedAction: string;
};

const DEFAULT_ACTION_STATES = ['manual_unlinked', 'failed'];
const LIMIT = Math.max(1, Number(process.env.SUGGESTED_TRADES_PROTECTION_ACTIONS_LIMIT || 50));
const MAX_ACTION_ITEMS = Math.max(
  0,
  Number(
    process.env.SUGGESTED_TRADES_MAX_PROTECTION_ACTION_ITEMS ||
      process.env.SUGGESTED_TRADES_MAX_PROTECTION_ACTIONABLE_TRADES ||
      0
  )
);
const OUTPUT_FILE = String(
  process.env.SUGGESTED_TRADES_PROTECTION_ACTIONS_OUTPUT_FILE ||
    'artifacts/suggested-trades-protection-actions.json'
).trim();
const ACTION_STATES = parseActionStates(process.env.SUGGESTED_TRADES_PROTECTION_ACTION_STATES);
const RECOVERY_STALE_MINUTES = Math.max(
  1,
  Number(process.env.SUGGESTED_TRADES_PROTECTION_RECOVERY_STALE_MINUTES || 10)
);
const ATTACHING_STALE_MINUTES = Math.max(
  1,
  Number(process.env.SUGGESTED_TRADES_PROTECTION_ATTACHING_STALE_MINUTES || 10)
);
const ACTIVE_PROTECTION_SQL = `LOWER(COALESCE(execution_record.execution_state, '')) NOT IN ('closed', 'cancelled', 'rejected', 'expired', 'failed')
          AND LOWER(COALESCE(execution_record.position_status, '')) NOT IN ('closed', 'liquidated')`;

function parseActionStates(value: string | undefined): string[] {
  const states = String(value || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  return states.length ? Array.from(new Set(states)) : DEFAULT_ACTION_STATES;
}

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

function countBy(items: ProtectionActionItem[], key: 'brokerKey' | 'protectionState'): JsonRecord {
  return items.reduce<JsonRecord>((acc, item) => {
    const value = String(item[key] || 'unknown');
    acc[value] = readCount(acc[value]) + 1;
    return acc;
  }, {});
}

function resolveRecoveryFreshness(
  state: string,
  protectionCheckedAt: string | null,
  staleBeforeMs: number
): 'fresh' | 'stale' | 'unverified' {
  if (state !== 'manual_unlinked') {
    return 'fresh';
  }
  if (!protectionCheckedAt) {
    return 'unverified';
  }
  const checkedAtMs = Date.parse(protectionCheckedAt);
  if (!Number.isFinite(checkedAtMs)) {
    return 'unverified';
  }
  return checkedAtMs < staleBeforeMs ? 'stale' : 'fresh';
}

function resolveRecommendedAction(
  state: string,
  error: string,
  recoveryFreshness: ProtectionActionItem['recoveryFreshness'],
  staleAttaching: boolean
): string {
  if (state === 'attaching' && staleAttaching) {
    return 'Inspect the replacement SL/TP order IDs in the protection plan and the orders-sync snapshots; do not submit duplicate protection until broker snapshots are reconciled.';
  }
  if (state === 'manual_unlinked' && recoveryFreshness !== 'fresh') {
    return 'Rerun suggested-trade reconciliation or inspect the execution-sync worker first; the manual SL/TP recovery check is stale, then place or adjust broker-native protection.';
  }
  const normalizedError = error.toLowerCase();
  if (normalizedError.includes('liquidation')) {
    return 'Reduce or close the live position, then recreate broker-native protection with a stop-loss safely away from liquidation.';
  }
  if (normalizedError.includes('stop-loss') && normalizedError.includes('already breached')) {
    return 'Close the live position or place a fresh broker-native stop-loss from the current market price; do not reuse the stale planned stop-loss.';
  }
  if (normalizedError.includes('take-profit') && normalizedError.includes('crossed')) {
    return 'Review whether the target was effectively reached, then close or place fresh take-profit protection manually.';
  }
  if (state === 'failed') {
    return 'Refresh broker position and order data, then rerun reconciliation; place broker-native SL/TP manually if the retry still fails.';
  }
  return 'Place or adjust broker-native SL/TP manually; the recovery loop will recheck broker data and clear this row once protection is visible.';
}

function mapActionItem(
  row: JsonRecord,
  nowMs: number,
  manualRecoveryStaleBeforeMs: number,
  attachingStaleBeforeMs: number
): ProtectionActionItem {
  const protectionState = readString(row.protectionState).toLowerCase() || 'unknown';
  const protectionLastError = readNullableString(row.protectionLastError);
  const protectionCheckedAt = toIsoString(row.protectionCheckedAt);
  const checkedAtMs = protectionCheckedAt ? Date.parse(protectionCheckedAt) : 0;
  const protectionCheckedAgeSeconds =
    checkedAtMs > 0 ? Math.max(0, Math.floor((nowMs - checkedAtMs) / 1000)) : null;
  const recoveryFreshness = resolveRecoveryFreshness(
    protectionState,
    protectionCheckedAt,
    manualRecoveryStaleBeforeMs
  );
  const staleAttaching =
    protectionState === 'attaching' && (!checkedAtMs || checkedAtMs < attachingStaleBeforeMs);
  const note = readNullableString(row.note);
  const blockingReason =
    protectionLastError ||
    note ||
    (protectionState === 'attaching'
      ? 'Replacement protection is waiting for active broker order snapshots.'
      : 'Protection requires operator review.');

  return {
    suggestedTradeId: readString(row.suggestedTradeId),
    userId: readString(row.userId),
    brokerKey: readNullableString(row.brokerKey),
    accountId: readNullableString(row.accountId),
    symbol: readString(row.symbol),
    timeframe: readString(row.timeframe),
    side: readString(row.side).toUpperCase(),
    tradeStatus: readString(row.tradeStatus),
    executionState: readNullableString(row.executionState),
    orderId: readNullableString(row.orderId),
    orderStatus: readNullableString(row.orderStatus),
    positionId: readNullableString(row.positionId),
    positionStatus: readNullableString(row.positionStatus),
    entryPrice: readNullableString(row.entryPrice),
    stopLossPrice: readNullableString(row.stopLossPrice),
    takeProfitPrice: readNullableString(row.takeProfitPrice),
    filledPrice: readNullableString(row.filledPrice),
    quantity: readNullableNumber(row.quantity),
    leverage: readNullableNumber(row.leverage),
    protectionState,
    protectionAttempts: readCount(row.protectionAttempts),
    protectionSource: readNullableString(row.protectionSource),
    protectionLastError,
    protectionCheckedAt,
    protectionCheckedAgeSeconds,
    protectionAttachedAt: toIsoString(row.protectionAttachedAt),
    recoveryFreshness,
    staleManualRecovery: protectionState === 'manual_unlinked' && recoveryFreshness !== 'fresh',
    staleAttaching,
    signalTime: toIsoString(row.signalTime),
    submittedAt: toIsoString(row.submittedAt),
    linkedAt: toIsoString(row.linkedAt),
    filledAt: toIsoString(row.filledAt),
    updatedAt: toIsoString(row.updatedAt),
    blockingReason,
    recommendedAction: resolveRecommendedAction(
      protectionState,
      blockingReason,
      recoveryFreshness,
      staleAttaching
    ),
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
    const staleBefore = new Date(generatedAt.getTime() - RECOVERY_STALE_MINUTES * 60 * 1000);
    const attachingStaleBefore = new Date(
      generatedAt.getTime() - ATTACHING_STALE_MINUTES * 60 * 1000
    );
    const placeholders = ACTION_STATES.map(() => '?').join(', ');
    const [countRow] = (await coreDataSource.query(
      `SELECT COUNT(*) AS count,
              COALESCE(SUM(CASE
                WHEN LOWER(COALESCE(execution_record.protection_state, '')) = 'manual_unlinked'
                 AND (
                   execution_record.protection_checked_at IS NULL
                   OR execution_record.protection_checked_at < ?
                )
                THEN 1 ELSE 0 END), 0) AS staleManualRecoveryCount
              ,
              COALESCE(SUM(CASE
                WHEN LOWER(COALESCE(execution_record.protection_state, '')) = 'attaching'
                 AND (
                   execution_record.protection_checked_at IS NULL
                   OR execution_record.protection_checked_at < ?
                 )
                THEN 1 ELSE 0 END), 0) AS staleAttachingCount
         FROM suggested_trade_executions execution_record
        WHERE LOWER(COALESCE(execution_record.execution_mode, '')) = 'live'
          AND (
            LOWER(COALESCE(execution_record.protection_state, '')) IN (${placeholders})
            OR (
              LOWER(COALESCE(execution_record.protection_state, '')) = 'attaching'
              AND (
                execution_record.protection_checked_at IS NULL
                OR execution_record.protection_checked_at < ?
              )
            )
          )
          AND ${ACTIVE_PROTECTION_SQL}`,
      [staleBefore, attachingStaleBefore, ...ACTION_STATES, attachingStaleBefore]
    )) as JsonRecord[];
    const totalActionItems = readCount(countRow?.count);
    const staleManualRecoveryItems = readCount(countRow?.staleManualRecoveryCount);
    const staleAttachingItems = readCount(countRow?.staleAttachingCount);

    const rows = (await coreDataSource.query(
      `SELECT suggested_trade.id AS suggestedTradeId,
              suggested_trade.user_id AS userId,
              suggested_trade.symbol AS symbol,
              suggested_trade.timeframe AS timeframe,
              suggested_trade.side AS side,
              suggested_trade.status AS tradeStatus,
              suggested_trade.signal_time AS signalTime,
              execution_record.broker_key AS brokerKey,
              execution_record.account_id AS accountId,
              execution_record.order_id AS orderId,
              execution_record.order_status AS orderStatus,
              execution_record.execution_state AS executionState,
              execution_record.position_id AS positionId,
              execution_record.position_status AS positionStatus,
              execution_record.entry_price AS entryPrice,
              execution_record.stop_loss_price AS stopLossPrice,
              execution_record.take_profit_price AS takeProfitPrice,
              execution_record.filled_price AS filledPrice,
              execution_record.quantity AS quantity,
              execution_record.leverage AS leverage,
              execution_record.protection_state AS protectionState,
              execution_record.protection_source AS protectionSource,
              execution_record.protection_attempts AS protectionAttempts,
              execution_record.protection_last_error AS protectionLastError,
              execution_record.protection_checked_at AS protectionCheckedAt,
              execution_record.protection_attached_at AS protectionAttachedAt,
              execution_record.submitted_at AS submittedAt,
              execution_record.linked_at AS linkedAt,
              execution_record.filled_at AS filledAt,
              execution_record.note AS note,
              execution_record.updated_at AS updatedAt
         FROM suggested_trade_executions execution_record
         JOIN suggested_trades suggested_trade
           ON suggested_trade.id = execution_record.suggested_trade_id
        WHERE LOWER(COALESCE(execution_record.execution_mode, '')) = 'live'
          AND (
            LOWER(COALESCE(execution_record.protection_state, '')) IN (${placeholders})
            OR (
              LOWER(COALESCE(execution_record.protection_state, '')) = 'attaching'
              AND (
                execution_record.protection_checked_at IS NULL
                OR execution_record.protection_checked_at < ?
              )
            )
          )
          AND ${ACTIVE_PROTECTION_SQL}
        ORDER BY COALESCE(execution_record.protection_checked_at, execution_record.updated_at, suggested_trade.signal_time) ASC,
                 suggested_trade.signal_time ASC
        LIMIT ${LIMIT}`,
      [...ACTION_STATES, attachingStaleBefore]
    )) as JsonRecord[];

    const items = rows.map((row) =>
      mapActionItem(
        row,
        generatedAt.getTime(),
        staleBefore.getTime(),
        attachingStaleBefore.getTime()
      )
    );
    const report = {
      generatedAt: generatedAt.toISOString(),
      states: ACTION_STATES,
      limit: LIMIT,
      maxActionItems: MAX_ACTION_ITEMS,
      recoveryStaleMinutes: RECOVERY_STALE_MINUTES,
      recoveryStaleBefore: staleBefore.toISOString(),
      attachingStaleMinutes: ATTACHING_STALE_MINUTES,
      attachingStaleBefore: attachingStaleBefore.toISOString(),
      totalActionItems,
      staleManualRecoveryItems,
      staleAttachingItems,
      returnedActionItems: items.length,
      byState: countBy(items, 'protectionState'),
      byBroker: countBy(items, 'brokerKey'),
      items,
    };

    await persistReport(report);
    console.log('suggested-trades-protection-actions:', JSON.stringify(report));

    if (totalActionItems > MAX_ACTION_ITEMS) {
      throw new Error(`protection action items ${totalActionItems} exceeds ${MAX_ACTION_ITEMS}`);
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
