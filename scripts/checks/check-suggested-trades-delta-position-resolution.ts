import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  type PositionReadModel,
  resolveExpectedDeltaProtectionQuantity,
} from './check-suggested-trades-delta-protection-guardrail';
import { coreDataSource } from '../../src/database/data-source';
import { initializeCoreDataSource } from '../../src/database/initializeCoreDataSource';

type JsonRecord = Record<string, unknown>;

type DeltaPositionExecutionRow = {
  suggestedTradeId: string;
  userId: string;
  accountId: string | null;
  symbol: string;
  tradeBaseSymbol: string;
  side: string;
  expectedSide: 'LONG' | 'SHORT' | null;
  timeframe: string | null;
  entryOrderId: string | null;
  orderStatus: string | null;
  executionState: string | null;
  positionId: string | null;
  positionStatus: string | null;
  quantity: number | null;
  filledQuantity: number | null;
  submittedAt: string | null;
  filledAt: string | null;
  positionOpenedAt: string | null;
  updatedAt: string | null;
};

type DeltaEntryOrderSnapshot = {
  userId: string;
  accountId: string;
  externalId: string;
  symbol: string | null;
  baseSymbol: string;
  status: string | null;
  lastSeenAt: string | null;
};

export type DeltaPositionResolutionType =
  | 'exact_read_model'
  | 'missing_position_id'
  | 'missing_read_model'
  | 'account_mismatch'
  | 'symbol_mismatch'
  | 'side_mismatch'
  | 'ambiguous_same_symbol';

export type DeltaEntryOrderLineage =
  | 'entry_order_snapshot_match'
  | 'entry_order_id_only'
  | 'missing_entry_order_id'
  | 'entry_order_snapshot_account_mismatch'
  | 'entry_order_snapshot_symbol_mismatch';

export type DeltaPositionResolutionItem = {
  type: DeltaPositionResolutionType;
  mutation: 'none_read_only';
  suggestedTradeId: string;
  userId: string;
  accountId: string | null;
  symbol: string;
  timeframe: string | null;
  side: string;
  expectedSide: 'LONG' | 'SHORT' | null;
  entryOrderId: string | null;
  entryOrderLineage: DeltaEntryOrderLineage;
  entryOrderSnapshotStatus: string | null;
  entryOrderSnapshotLastSeenAt: string | null;
  orderStatus: string | null;
  executionState: string | null;
  positionId: string | null;
  positionStatus: string | null;
  positionReadModelExternalId: string | null;
  positionReadModelAccountId: string | null;
  positionReadModelSymbol: string | null;
  positionReadModelSide: string | null;
  positionReadModelStatus: string | null;
  positionReadModelStatusRank: number | null;
  positionReadModelLastSeenAt: string | null;
  exactPositionIdBound: boolean;
  accountIdMatches: boolean | null;
  symbolMatches: boolean | null;
  sideMatches: boolean | null;
  sameSymbolOpenPositionCandidates: number;
  accountMismatchCandidates: number;
  expectedProtectionQuantity: number | null;
  expectedProtectionQuantitySource: string | null;
  expectedProtectionQuantityUnit: 'contracts' | 'base' | 'unknown';
  expectedProtectionQuantityContractValue: number | null;
  expectedProtectionQuantityNotes: string[];
  reasons: string[];
};

export type DeltaPositionResolutionReport = {
  generatedAt: string;
  brokerKey: typeof DELTA_BROKER;
  lookbackDays: number;
  limit: number;
  audited: number;
  exactReadModel: number;
  missingPositionId: number;
  missingReadModel: number;
  accountMismatch: number;
  symbolMismatch: number;
  sideMismatch: number;
  ambiguousSameSymbol: number;
  unresolved: number;
  unsafeMismatch: number;
  thresholds: {
    maxUnsafeMismatches: number;
    maxUnresolved: number;
  };
  byType: Record<DeltaPositionResolutionType, number>;
  items: DeltaPositionResolutionItem[];
  unsafeItems: DeltaPositionResolutionItem[];
  unresolvedItems: DeltaPositionResolutionItem[];
};

const DELTA_BROKER = 'delta_exchange';
const OUTPUT_FILE = String(
  process.env.SUGGESTED_TRADES_DELTA_POSITION_RESOLUTION_OUTPUT_FILE ||
    'artifacts/suggested-trades-delta-position-resolution.json'
).trim();
const LOOKBACK_DAYS = Math.max(
  1,
  Number(process.env.SUGGESTED_TRADES_DELTA_POSITION_LOOKBACK_DAYS || 7)
);
const LIMIT = Math.max(
  1,
  Number(process.env.SUGGESTED_TRADES_DELTA_POSITION_RESOLUTION_LIMIT || 1000)
);
const MAX_UNSAFE_MISMATCHES = Math.max(
  0,
  Number(process.env.SUGGESTED_TRADES_MAX_DELTA_POSITION_UNSAFE_MISMATCHES || 0)
);
const MAX_UNRESOLVED = Math.max(
  0,
  Number(process.env.SUGGESTED_TRADES_MAX_DELTA_POSITION_UNRESOLVED || 0)
);

const TERMINAL_EXECUTION_STATES = new Set([
  'closed',
  'cancelled',
  'canceled',
  'rejected',
  'expired',
  'failed',
]);
const TERMINAL_POSITION_STATES = new Set(['closed', 'liquidated']);
const POSITION_EVIDENCE_ORDER_STATUSES = new Set([
  'CLOSED',
  'FILLED',
  'PARTIALLY_FILLED',
  'PARTIAL_FILLED',
  'PARTIAL',
]);
const POSITION_EVIDENCE_EXECUTION_STATES = new Set(['filled', 'closed']);
const POSITION_EVIDENCE_POSITION_STATES = new Set(['open', 'partial', 'closed', 'liquidated']);

function readString(value: unknown): string {
  return String(value ?? '').trim();
}

function readNullableString(value: unknown): string | null {
  const normalized = readString(value);
  if (!normalized || normalized.toLowerCase() === 'null') {
    return null;
  }
  return normalized;
}

function readNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function readRecord(value: unknown): JsonRecord {
  if (!value) {
    return {};
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as JsonRecord;
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as JsonRecord)
        : {};
    } catch {
      return {};
    }
  }
  return {};
}

function toIsoString(value: unknown): string | null {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeSymbolBase(symbol: string | null): string {
  const normalized = readString(symbol).toUpperCase();
  for (const suffix of ['USDT', 'USDC', 'USD']) {
    if (normalized.endsWith(suffix) && normalized.length > suffix.length) {
      return normalized.slice(0, -suffix.length);
    }
  }
  return normalized;
}

function normalizeDirection(value: unknown): 'LONG' | 'SHORT' | null {
  const normalized = readString(value).toUpperCase();
  if (normalized === 'BUY' || normalized === 'LONG') {
    return 'LONG';
  }
  if (normalized === 'SELL' || normalized === 'SHORT') {
    return 'SHORT';
  }
  return null;
}

function normalizeStatus(value: unknown): string | null {
  return readNullableString(value)?.toUpperCase() ?? null;
}

function isTerminalExecution(row: DeltaPositionExecutionRow): boolean {
  return TERMINAL_EXECUTION_STATES.has(readString(row.executionState).toLowerCase());
}

function isTerminalPositionState(value: unknown): boolean {
  return TERMINAL_POSITION_STATES.has(readString(value).toLowerCase());
}

function isOpenPosition(position: PositionReadModel): boolean {
  if (isTerminalPositionState(position.status) || isTerminalPositionState(position.statusKey)) {
    return false;
  }
  if (position.statusRank !== null) {
    return position.statusRank > 0 && position.statusRank <= 2;
  }
  const normalizedStatus = readString(position.status || position.statusKey).toLowerCase();
  return normalizedStatus === 'open' || normalizedStatus === 'partial';
}

export function shouldAuditDeltaPositionResolutionExecutionForTest(
  row: Pick<
    DeltaPositionExecutionRow,
    | 'positionId'
    | 'filledAt'
    | 'positionOpenedAt'
    | 'positionStatus'
    | 'orderStatus'
    | 'executionState'
    | 'filledQuantity'
  >
): boolean {
  return Boolean(
    row.positionId ||
    row.filledAt ||
    row.positionOpenedAt ||
    (row.filledQuantity !== null && row.filledQuantity > 0) ||
    POSITION_EVIDENCE_ORDER_STATUSES.has(normalizeStatus(row.orderStatus) ?? '') ||
    POSITION_EVIDENCE_EXECUTION_STATES.has(readString(row.executionState).toLowerCase()) ||
    POSITION_EVIDENCE_POSITION_STATES.has(readString(row.positionStatus).toLowerCase())
  );
}

function mapExecution(row: JsonRecord): DeltaPositionExecutionRow {
  const symbol = readString(row.symbol).toUpperCase();
  const side = readString(row.side).toUpperCase();
  return {
    suggestedTradeId: readString(row.suggestedTradeId),
    userId: readString(row.userId),
    accountId: readNullableString(row.accountId),
    symbol,
    tradeBaseSymbol: normalizeSymbolBase(symbol),
    side,
    expectedSide: normalizeDirection(side),
    timeframe: readNullableString(row.timeframe),
    entryOrderId: readNullableString(row.entryOrderId),
    orderStatus: normalizeStatus(row.orderStatus),
    executionState: readNullableString(row.executionState),
    positionId: readNullableString(row.positionId),
    positionStatus: readNullableString(row.positionStatus),
    quantity: readNullableNumber(row.quantity),
    filledQuantity: readNullableNumber(row.filledQuantity),
    submittedAt: toIsoString(row.submittedAt),
    filledAt: toIsoString(row.filledAt),
    positionOpenedAt: toIsoString(row.positionOpenedAt),
    updatedAt: toIsoString(row.updatedAt),
  };
}

function mapPosition(row: JsonRecord): PositionReadModel {
  const payload = readRecord(row.payloadJson);
  const symbol = readNullableString(row.symbol ?? payload.symbol);
  return {
    userId: readString(row.userId),
    accountId: readString(row.accountId),
    externalId: readString(row.externalId),
    symbol,
    baseSymbol: normalizeSymbolBase(symbol),
    side:
      normalizeDirection(row.sideKey) ??
      normalizeDirection(row.side) ??
      normalizeDirection(payload.side) ??
      normalizeDirection(payload.order_type) ??
      normalizeDirection(payload.position_type),
    status: normalizeStatus(row.status ?? payload.status),
    statusKey: normalizeStatus(row.statusKey),
    statusRank: readNullableNumber(row.statusRank),
    quantity:
      readNullableNumber(row.quantity) ??
      readNullableNumber(payload.quantity_contracts) ??
      readNullableNumber(payload.size) ??
      readNullableNumber(payload.quantity),
    stopLossPrice:
      readNullableNumber(row.stopLossPrice) ??
      readNullableNumber(readRecord(payload.stoploss).price) ??
      readNullableNumber(readRecord(payload.stop_loss).price),
    takeProfitPrice:
      readNullableNumber(row.takeProfitPrice) ??
      readNullableNumber(readRecord(payload.takeprofit).price) ??
      readNullableNumber(readRecord(payload.take_profit).price),
    stopLossOrderId:
      readNullableString(row.stopLossOrderId) ??
      readNullableString(readRecord(payload.stoploss).order_id) ??
      readNullableString(readRecord(payload.stop_loss).order_id),
    takeProfitOrderId:
      readNullableString(row.takeProfitOrderId) ??
      readNullableString(readRecord(payload.takeprofit).order_id) ??
      readNullableString(readRecord(payload.take_profit).order_id),
    lastSeenAt: toIsoString(row.lastSeenAt),
    payload,
  };
}

function mapEntryOrder(row: JsonRecord): DeltaEntryOrderSnapshot {
  const payload = readRecord(row.payloadJson);
  const symbol = readNullableString(row.symbol ?? payload.symbol);
  return {
    userId: readString(row.userId),
    accountId: readString(row.accountId),
    externalId: readString(row.externalId),
    symbol,
    baseSymbol: normalizeSymbolBase(symbol),
    status: normalizeStatus(row.orderStatus ?? payload.status),
    lastSeenAt: toIsoString(row.lastSeenAt),
  };
}

function positionKey(userId: string, accountId: string | null, externalId: string | null): string {
  return `${userId}:${accountId ?? ''}:${externalId ?? ''}`;
}

function orderKey(userId: string, accountId: string | null, externalId: string | null): string {
  return `${userId}:${accountId ?? ''}:${externalId ?? ''}`;
}

function countByType(
  items: DeltaPositionResolutionItem[]
): Record<DeltaPositionResolutionType, number> {
  return {
    exact_read_model: items.filter((item) => item.type === 'exact_read_model').length,
    missing_position_id: items.filter((item) => item.type === 'missing_position_id').length,
    missing_read_model: items.filter((item) => item.type === 'missing_read_model').length,
    account_mismatch: items.filter((item) => item.type === 'account_mismatch').length,
    symbol_mismatch: items.filter((item) => item.type === 'symbol_mismatch').length,
    side_mismatch: items.filter((item) => item.type === 'side_mismatch').length,
    ambiguous_same_symbol: items.filter((item) => item.type === 'ambiguous_same_symbol').length,
  };
}

function resolveEntryOrderLineage(input: {
  row: DeltaPositionExecutionRow;
  entryOrder: DeltaEntryOrderSnapshot | null;
}): DeltaEntryOrderLineage {
  if (!input.row.entryOrderId) {
    return 'missing_entry_order_id';
  }
  if (!input.entryOrder) {
    return 'entry_order_id_only';
  }
  if (input.row.accountId && input.entryOrder.accountId !== input.row.accountId) {
    return 'entry_order_snapshot_account_mismatch';
  }
  if (input.entryOrder.baseSymbol && input.entryOrder.baseSymbol !== input.row.tradeBaseSymbol) {
    return 'entry_order_snapshot_symbol_mismatch';
  }
  return 'entry_order_snapshot_match';
}

export function evaluateDeltaPositionResolutionForTest(input: {
  row: DeltaPositionExecutionRow;
  exactPosition: PositionReadModel | null;
  accountMismatchPositions: PositionReadModel[];
  sameSymbolOpenPositions: PositionReadModel[];
  entryOrder: DeltaEntryOrderSnapshot | null;
}): DeltaPositionResolutionItem {
  const { row, exactPosition, accountMismatchPositions, sameSymbolOpenPositions, entryOrder } =
    input;
  const reasons: string[] = [];
  const entryOrderLineage = resolveEntryOrderLineage({ row, entryOrder });
  const quantityResolution = resolveExpectedDeltaProtectionQuantity({
    row: {
      filledQuantity: row.filledQuantity,
      quantity: row.quantity,
    },
    position: exactPosition,
  });
  const exactPositionIdBound = Boolean(row.positionId && exactPosition);
  const accountIdMatches = exactPosition
    ? row.accountId !== null && exactPosition.accountId === row.accountId
    : null;
  const symbolMatches = exactPosition ? exactPosition.baseSymbol === row.tradeBaseSymbol : null;
  const sideMatches =
    exactPosition?.side && row.expectedSide ? exactPosition.side === row.expectedSide : null;

  let type: DeltaPositionResolutionType = 'exact_read_model';
  if (!row.positionId) {
    type = 'missing_position_id';
    reasons.push(
      'Delta live execution has no position_id, so it cannot bind to an exact position.'
    );
  } else if (accountMismatchPositions.length > 0) {
    type = 'account_mismatch';
    reasons.push(
      `Delta position_id ${row.positionId} exists under a different account (${accountMismatchPositions
        .map((position) => position.accountId)
        .join(', ')}).`
    );
  } else if (!exactPosition) {
    type = sameSymbolOpenPositions.length > 1 ? 'ambiguous_same_symbol' : 'missing_read_model';
    reasons.push(
      sameSymbolOpenPositions.length > 1
        ? `No exact position_read_models row for ${row.positionId}; same-symbol open candidates=${sameSymbolOpenPositions.length}.`
        : `No exact Delta position_read_models row for position_id ${row.positionId}.`
    );
  } else if (symbolMatches === false) {
    type = 'symbol_mismatch';
    reasons.push(
      `Position symbol ${exactPosition.symbol ?? 'unknown'} does not match trade symbol ${row.symbol}.`
    );
  } else if (sideMatches === false) {
    type = 'side_mismatch';
    reasons.push(
      `Position side ${exactPosition.side ?? 'unknown'} does not match trade side ${row.expectedSide ?? 'unknown'}.`
    );
  }

  if (entryOrderLineage !== 'entry_order_snapshot_match') {
    reasons.push(`Entry order lineage is ${entryOrderLineage}.`);
  }
  if (exactPosition && sideMatches === null) {
    reasons.push(
      'Exact position read-model is present, but side is missing on one side of the check.'
    );
  }
  if (isTerminalExecution(row) && !exactPosition) {
    reasons.push(
      'Execution is terminal, so this may be historical drift rather than a live repair target.'
    );
  }

  return {
    type,
    mutation: 'none_read_only',
    suggestedTradeId: row.suggestedTradeId,
    userId: row.userId,
    accountId: row.accountId,
    symbol: row.symbol,
    timeframe: row.timeframe,
    side: row.side,
    expectedSide: row.expectedSide,
    entryOrderId: row.entryOrderId,
    entryOrderLineage,
    entryOrderSnapshotStatus: entryOrder?.status ?? null,
    entryOrderSnapshotLastSeenAt: entryOrder?.lastSeenAt ?? null,
    orderStatus: row.orderStatus,
    executionState: row.executionState,
    positionId: row.positionId,
    positionStatus: row.positionStatus,
    positionReadModelExternalId: exactPosition?.externalId ?? null,
    positionReadModelAccountId: exactPosition?.accountId ?? null,
    positionReadModelSymbol: exactPosition?.symbol ?? null,
    positionReadModelSide: exactPosition?.side ?? null,
    positionReadModelStatus: exactPosition?.status ?? null,
    positionReadModelStatusRank: exactPosition?.statusRank ?? null,
    positionReadModelLastSeenAt: exactPosition?.lastSeenAt ?? null,
    exactPositionIdBound,
    accountIdMatches,
    symbolMatches,
    sideMatches,
    sameSymbolOpenPositionCandidates: sameSymbolOpenPositions.length,
    accountMismatchCandidates: accountMismatchPositions.length,
    expectedProtectionQuantity: quantityResolution.value,
    expectedProtectionQuantitySource: quantityResolution.source,
    expectedProtectionQuantityUnit: quantityResolution.unit,
    expectedProtectionQuantityContractValue: quantityResolution.contractValue,
    expectedProtectionQuantityNotes: quantityResolution.notes,
    reasons,
  };
}

export function resolveDeltaPositionResolutionQuantityForTest(input: {
  row: Pick<DeltaPositionExecutionRow, 'filledQuantity' | 'quantity'>;
  position: Pick<PositionReadModel, 'quantity' | 'payload'> | null;
}) {
  return resolveExpectedDeltaProtectionQuantity(input);
}

async function persistReport(report: JsonRecord): Promise<void> {
  if (!OUTPUT_FILE) {
    return;
  }
  const absoluteOutputPath = path.resolve(process.cwd(), OUTPUT_FILE);
  await mkdir(path.dirname(absoluteOutputPath), { recursive: true });
  await writeFile(absoluteOutputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

async function queryDeltaExecutions(): Promise<DeltaPositionExecutionRow[]> {
  const rows = (await coreDataSource.query(
    `SELECT suggested_trade.id AS suggestedTradeId,
            suggested_trade.user_id AS userId,
            suggested_trade.symbol AS symbol,
            suggested_trade.side AS side,
            suggested_trade.timeframe AS timeframe,
            execution_record.account_id AS accountId,
            execution_record.order_id AS entryOrderId,
            execution_record.order_status AS orderStatus,
            execution_record.execution_state AS executionState,
            execution_record.position_id AS positionId,
            execution_record.position_status AS positionStatus,
            execution_record.quantity AS quantity,
            execution_record.filled_quantity AS filledQuantity,
            execution_record.submitted_at AS submittedAt,
            execution_record.filled_at AS filledAt,
            execution_record.position_opened_at AS positionOpenedAt,
            execution_record.updated_at AS updatedAt
       FROM suggested_trade_executions execution_record
       JOIN suggested_trades suggested_trade
         ON suggested_trade.id = execution_record.suggested_trade_id
      WHERE LOWER(COALESCE(execution_record.execution_mode, '')) = 'live'
        AND LOWER(COALESCE(execution_record.broker_key, '')) = ?
        AND (
          execution_record.position_id IS NOT NULL
          OR execution_record.filled_at IS NOT NULL
          OR execution_record.position_opened_at IS NOT NULL
          OR execution_record.filled_quantity > 0
          OR LOWER(COALESCE(execution_record.order_status, '')) IN
            ('filled', 'closed', 'partially_filled', 'partial_filled', 'partial')
          OR LOWER(COALESCE(execution_record.execution_state, '')) IN ('filled', 'closed')
          OR LOWER(COALESCE(execution_record.position_status, '')) IN
            ('open', 'partial', 'closed', 'liquidated')
        )
        AND (
          COALESCE(
            execution_record.position_opened_at,
            execution_record.filled_at,
            execution_record.submitted_at,
            suggested_trade.signal_time,
            execution_record.updated_at
          ) >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)
          OR LOWER(COALESCE(execution_record.position_status, '')) IN ('open', 'partial')
        )
      ORDER BY COALESCE(
                 execution_record.position_opened_at,
                 execution_record.filled_at,
                 execution_record.submitted_at,
                 suggested_trade.signal_time,
                 execution_record.updated_at
               ) DESC
      LIMIT ${LIMIT}`,
    [DELTA_BROKER, LOOKBACK_DAYS]
  )) as JsonRecord[];
  return rows
    .map(mapExecution)
    .filter(
      (row) =>
        row.suggestedTradeId &&
        row.userId &&
        shouldAuditDeltaPositionResolutionExecutionForTest(row)
    );
}

async function queryDeltaPositions(): Promise<PositionReadModel[]> {
  const rows = (await coreDataSource.query(
    `SELECT position_model.user_id AS userId,
            position_model.account_id AS accountId,
            position_model.external_id AS externalId,
            position_model.symbol AS symbol,
            position_model.side AS side,
            position_model.side_key AS sideKey,
            position_model.status AS status,
            position_model.status_key AS statusKey,
            position_model.status_rank AS statusRank,
            position_model.quantity AS quantity,
            position_model.stoploss_price AS stopLossPrice,
            position_model.takeprofit_price AS takeProfitPrice,
            position_model.stoploss_order_id AS stopLossOrderId,
            position_model.takeprofit_order_id AS takeProfitOrderId,
            position_model.last_seen_at AS lastSeenAt,
            position_model.payload_json AS payloadJson
       FROM position_read_models position_model
      WHERE LOWER(position_model.broker_key) = ?
        AND (
          position_model.last_seen_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)
          OR position_model.status_rank > 0
        )
      ORDER BY position_model.last_seen_at DESC
      LIMIT 10000`,
    [DELTA_BROKER, LOOKBACK_DAYS + 1]
  )) as JsonRecord[];
  return rows.map(mapPosition).filter((position) => position.userId && position.externalId);
}

async function queryDeltaEntryOrders(orderIds: string[]): Promise<DeltaEntryOrderSnapshot[]> {
  const uniqueOrderIds = Array.from(new Set(orderIds.map(readString).filter(Boolean)));
  if (!uniqueOrderIds.length) {
    return [];
  }

  const rows = (await coreDataSource.query(
    `SELECT order_snapshot.user_id AS userId,
            order_snapshot.account_id AS accountId,
            order_snapshot.external_id AS externalId,
            order_snapshot.symbol AS symbol,
            order_snapshot.order_status AS orderStatus,
            order_snapshot.payload_json AS payloadJson,
            order_snapshot.last_seen_at AS lastSeenAt
       FROM scheduler_orders_snapshots order_snapshot
      WHERE LOWER(order_snapshot.broker_key) = ?
        AND order_snapshot.external_id IN (${uniqueOrderIds.map(() => '?').join(',')})`,
    [DELTA_BROKER, ...uniqueOrderIds]
  )) as JsonRecord[];

  return rows.map(mapEntryOrder);
}

export async function buildDeltaPositionResolutionReport(): Promise<DeltaPositionResolutionReport> {
  const generatedAt = new Date();
  const executions = await queryDeltaExecutions();
  const positions = await queryDeltaPositions();
  const entryOrders = await queryDeltaEntryOrders(
    executions
      .map((execution) => execution.entryOrderId)
      .filter((value): value is string => Boolean(value))
  );
  const entryOrdersByExactKey = new Map(
    entryOrders.map((order) => [orderKey(order.userId, order.accountId, order.externalId), order])
  );
  const entryOrdersByExternalKey = new Map<string, DeltaEntryOrderSnapshot[]>();
  for (const order of entryOrders) {
    const key = `${order.userId}:${order.externalId}`;
    entryOrdersByExternalKey.set(key, [...(entryOrdersByExternalKey.get(key) ?? []), order]);
  }
  const positionsByExactKey = new Map(
    positions.map((position) => [
      positionKey(position.userId, position.accountId, position.externalId),
      position,
    ])
  );
  const positionsByExternalKey = new Map<string, PositionReadModel[]>();
  for (const position of positions) {
    const key = `${position.userId}:${position.externalId}`;
    positionsByExternalKey.set(key, [...(positionsByExternalKey.get(key) ?? []), position]);
  }
  const openPositions = positions.filter(isOpenPosition);

  const items = executions.map((row) => {
    const exactPosition = row.positionId
      ? (positionsByExactKey.get(positionKey(row.userId, row.accountId, row.positionId)) ?? null)
      : null;
    const sameExternalPositions = row.positionId
      ? (positionsByExternalKey.get(`${row.userId}:${row.positionId}`) ?? [])
      : [];
    const accountMismatchPositions = row.accountId
      ? sameExternalPositions.filter((position) => position.accountId !== row.accountId)
      : [];
    const sameSymbolOpenPositions = openPositions.filter(
      (position) =>
        position.userId === row.userId &&
        position.accountId === row.accountId &&
        position.baseSymbol === row.tradeBaseSymbol
    );
    const entryOrder =
      row.entryOrderId && row.accountId
        ? (entryOrdersByExactKey.get(orderKey(row.userId, row.accountId, row.entryOrderId)) ??
          entryOrdersByExternalKey
            .get(`${row.userId}:${row.entryOrderId}`)
            ?.find((order) => order.accountId !== row.accountId) ??
          null)
        : null;
    return evaluateDeltaPositionResolutionForTest({
      row,
      exactPosition,
      accountMismatchPositions,
      sameSymbolOpenPositions,
      entryOrder,
    });
  });

  const byType = countByType(items);
  const unsafeItems = items.filter((item) =>
    ['account_mismatch', 'symbol_mismatch', 'side_mismatch'].includes(item.type)
  );
  const unresolvedItems = items.filter((item) =>
    ['missing_position_id', 'missing_read_model', 'ambiguous_same_symbol'].includes(item.type)
  );

  return {
    generatedAt: generatedAt.toISOString(),
    brokerKey: DELTA_BROKER,
    lookbackDays: LOOKBACK_DAYS,
    limit: LIMIT,
    audited: items.length,
    exactReadModel: byType.exact_read_model,
    missingPositionId: byType.missing_position_id,
    missingReadModel: byType.missing_read_model,
    accountMismatch: byType.account_mismatch,
    symbolMismatch: byType.symbol_mismatch,
    sideMismatch: byType.side_mismatch,
    ambiguousSameSymbol: byType.ambiguous_same_symbol,
    unresolved: unresolvedItems.length,
    unsafeMismatch: unsafeItems.length,
    thresholds: {
      maxUnsafeMismatches: MAX_UNSAFE_MISMATCHES,
      maxUnresolved: MAX_UNRESOLVED,
    },
    byType,
    items,
    unsafeItems,
    unresolvedItems,
  };
}

async function run(): Promise<void> {
  await initializeCoreDataSource();

  try {
    const report = await buildDeltaPositionResolutionReport();

    await persistReport(report);
    console.log('suggested-trades-delta-position-resolution:', JSON.stringify(report));

    if (report.unsafeMismatch > MAX_UNSAFE_MISMATCHES) {
      throw new Error(
        `Delta unsafe position resolutions ${report.unsafeMismatch} exceeds ${MAX_UNSAFE_MISMATCHES}`
      );
    }
    if (report.unresolved > MAX_UNRESOLVED) {
      throw new Error(
        `Delta unresolved position resolutions ${report.unresolved} exceeds ${MAX_UNRESOLVED}`
      );
    }
  } finally {
    if (coreDataSource.isInitialized) {
      await coreDataSource.destroy();
    }
  }
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
