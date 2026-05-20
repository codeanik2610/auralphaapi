import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { coreDataSource } from '../../src/database/data-source';
import { initializeCoreDataSource } from '../../src/database/initializeCoreDataSource';

type JsonRecord = Record<string, unknown>;

export type MudrexExecutionRow = {
  suggestedTradeId: string;
  userId: string;
  accountId: string | null;
  tradeSymbol: string;
  tradeBaseSymbol: string;
  tradeSide: string;
  timeframe: string | null;
  entryOrderId: string | null;
  orderStatus: string | null;
  executionState: string | null;
  positionId: string | null;
  positionStatus: string | null;
  quantity: number | null;
  filledQuantity: number | null;
  remainingQuantity: number | null;
  entryPrice: number | null;
  filledPrice: number | null;
  stopLossPrice: number | null;
  takeProfitPrice: number | null;
  protectionState: string;
  protectionPlan: JsonRecord;
  submittedAt: string | null;
  filledAt: string | null;
  positionOpenedAt: string | null;
  positionClosedAt: string | null;
  updatedAt: string | null;
};

export type MudrexPositionReadModel = {
  userId: string;
  accountId: string;
  externalId: string;
  symbol: string | null;
  baseSymbol: string;
  side: string | null;
  status: string | null;
  statusKey: string | null;
  statusRank: number | null;
  quantity: number | null;
  stopLossPrice: number | null;
  takeProfitPrice: number | null;
  stopLossOrderId: string | null;
  takeProfitOrderId: string | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  payload: JsonRecord;
};

export type MudrexOrderSnapshot = {
  userId: string;
  accountId: string;
  externalId: string;
  symbol: string | null;
  baseSymbol: string;
  status: string | null;
  statusRank: number | null;
  quantity: number | null;
  lastSeenAt: string | null;
  payload: JsonRecord;
};

export type MudrexProtectionHealthIssue =
  | 'missing_position_read_model'
  | 'missing_active_stop_loss'
  | 'missing_active_take_profit'
  | 'stale_protection_for_closed_position'
  | 'partial_fill_protection_mismatch'
  | 'unsafe_position_mismatch';

export type MudrexProtectionHealthItem = {
  suggestedTradeId: string;
  userId: string;
  accountId: string | null;
  symbol: string;
  timeframe: string | null;
  side: string;
  entryOrderId: string | null;
  orderStatus: string | null;
  executionState: string | null;
  positionId: string | null;
  positionStatus: string | null;
  protectionState: string;
  quantity: number | null;
  filledQuantity: number | null;
  remainingQuantity: number | null;
  entryPrice: number | null;
  filledPrice: number | null;
  plannedStopLossPrice: number | null;
  plannedTakeProfitPrice: number | null;
  positionResolution: 'exact_read_model' | 'direct_raw_payload' | 'unresolved';
  positionReadModelExternalId: string | null;
  positionReadModelStatus: string | null;
  positionReadModelSymbol: string | null;
  positionReadModelSide: string | null;
  positionReadModelQuantity: number | null;
  stopLossOrderId: string | null;
  stopLossOrderStatus: string | null;
  stopLossOrderQuantity: number | null;
  takeProfitOrderId: string | null;
  takeProfitOrderStatus: string | null;
  takeProfitOrderQuantity: number | null;
  expectedProtectionQuantity: number | null;
  expectedProtectionQuantitySource: string | null;
  expectedProtectionQuantityUnit: 'base' | 'unknown';
  expectedProtectionQuantityNotes: string[];
  sameSymbolOpenPositionCandidates: number;
  issues: MudrexProtectionHealthIssue[];
  reasons: string[];
};

export type MudrexProtectionHealthReport = {
  generatedAt: string;
  brokerKey: typeof MUDREX_BROKER;
  mutation: 'none_read_only';
  lookbackDays: number;
  limit: number;
  audited: number;
  openPositions: number;
  issueTrades: number;
  missingPositionReadModel: number;
  missingActiveStopLoss: number;
  missingActiveTakeProfit: number;
  staleProtectionForClosedPosition: number;
  partialFillProtectionMismatch: number;
  unsafePositionMismatch: number;
  thresholds: {
    maxMissingPositionReadModel: number;
    maxMissingActiveStopLoss: number;
    maxMissingActiveTakeProfit: number;
    maxStaleProtectionForClosedPosition: number;
    maxPartialFillProtectionMismatch: number;
    maxUnsafePositionMismatch: number;
  };
  byIssue: Record<MudrexProtectionHealthIssue, number>;
  items: MudrexProtectionHealthItem[];
};

export type MudrexProtectionQuantityResolution = {
  value: number | null;
  source: string | null;
  unit: 'base' | 'unknown';
  notes: string[];
};

type NumberSource = {
  value: number;
  source: string;
};

type ResolvedMudrexPosition = {
  position: MudrexPositionReadModel | null;
  resolution: MudrexProtectionHealthItem['positionResolution'];
};

const MUDREX_BROKER = 'mudrex';
const OUTPUT_FILE = String(
  process.env.SUGGESTED_TRADES_MUDREX_PROTECTION_HEALTH_OUTPUT_FILE ||
    'artifacts/suggested-trades-mudrex-protection-health.json'
).trim();
const LOOKBACK_DAYS = Math.max(
  1,
  Number(process.env.SUGGESTED_TRADES_MUDREX_PROTECTION_LOOKBACK_DAYS || 7)
);
const LIMIT = Math.max(1, Number(process.env.SUGGESTED_TRADES_MUDREX_PROTECTION_LIMIT || 1000));
const MAX_MISSING_POSITION_READ_MODEL = readThreshold(
  'SUGGESTED_TRADES_MAX_MUDREX_MISSING_POSITION_READ_MODEL'
);
const MAX_MISSING_ACTIVE_STOP_LOSS = readThreshold(
  'SUGGESTED_TRADES_MAX_MUDREX_MISSING_ACTIVE_STOP_LOSS'
);
const MAX_MISSING_ACTIVE_TAKE_PROFIT = readThreshold(
  'SUGGESTED_TRADES_MAX_MUDREX_MISSING_ACTIVE_TAKE_PROFIT'
);
const MAX_STALE_PROTECTION_FOR_CLOSED_POSITION = readThreshold(
  'SUGGESTED_TRADES_MAX_MUDREX_STALE_PROTECTION_FOR_CLOSED_POSITION'
);
const MAX_PARTIAL_FILL_PROTECTION_MISMATCH = readThreshold(
  'SUGGESTED_TRADES_MAX_MUDREX_PARTIAL_FILL_PROTECTION_MISMATCH'
);
const MAX_UNSAFE_POSITION_MISMATCH = readThreshold(
  'SUGGESTED_TRADES_MAX_MUDREX_UNSAFE_POSITION_MISMATCH'
);

const ACTIVE_ORDER_STATUSES = new Set([
  'OPEN',
  'PENDING',
  'PARTIALLY_FILLED',
  'PARTIAL_FILLED',
  'PARTIAL',
  'TRIGGER_PENDING',
]);
const TERMINAL_EXECUTION_STATES = new Set([
  'closed',
  'cancelled',
  'canceled',
  'rejected',
  'expired',
  'failed',
]);
const TERMINAL_POSITION_STATES = new Set(['closed', 'liquidated']);

function readThreshold(key: string): number {
  return Math.max(0, Number(process.env[key] || 0));
}

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

function isTerminalExecution(row: MudrexExecutionRow): boolean {
  return TERMINAL_EXECUTION_STATES.has(readString(row.executionState).toLowerCase());
}

function isTerminalPositionState(value: unknown): boolean {
  return TERMINAL_POSITION_STATES.has(readString(value).toLowerCase());
}

function isFilledExecution(row: MudrexExecutionRow): boolean {
  const orderStatus = normalizeStatus(row.orderStatus);
  return Boolean(
    row.filledAt ||
    readString(row.executionState).toLowerCase() === 'filled' ||
    orderStatus === 'CLOSED' ||
    orderStatus === 'FILLED' ||
    orderStatus === 'PARTIALLY_FILLED' ||
    orderStatus === 'PARTIAL_FILLED' ||
    orderStatus === 'PARTIAL'
  );
}

function needsOpenPositionProtection(
  row: MudrexExecutionRow,
  position: MudrexPositionReadModel | null
): boolean {
  if (isTerminalExecution(row) || isTerminalPositionState(row.positionStatus)) {
    return false;
  }
  if (position) {
    return isOpenPosition(position);
  }
  return Boolean(
    row.positionId ||
    row.positionOpenedAt ||
    readString(row.positionStatus).toLowerCase() === 'open' ||
    isFilledExecution(row)
  );
}

function isOpenPosition(position: MudrexPositionReadModel): boolean {
  if (isTerminalPositionState(position.status) || isTerminalPositionState(position.statusKey)) {
    return false;
  }
  if (position.statusRank !== null) {
    return position.statusRank > 0 && position.statusRank <= 2;
  }
  const normalizedStatus = readString(position.status || position.statusKey).toLowerCase();
  return (
    normalizedStatus === 'open' ||
    normalizedStatus === 'partial' ||
    normalizedStatus === 'partially_closed' ||
    normalizedStatus === 'partially_closed_position'
  );
}

function isActiveOrder(order: MudrexOrderSnapshot | null): boolean {
  if (!order) {
    return false;
  }
  if (order.status && ACTIVE_ORDER_STATUSES.has(order.status)) {
    return true;
  }
  return Boolean(order.statusRank !== null && order.statusRank > 0 && order.statusRank <= 2);
}

function hasPositivePrice(value: number | null): boolean {
  return value !== null && value > 0;
}

function isPartialFill(row: MudrexExecutionRow): boolean {
  const orderStatus = normalizeStatus(row.orderStatus);
  return Boolean(
    orderStatus === 'PARTIALLY_FILLED' ||
    orderStatus === 'PARTIAL_FILLED' ||
    orderStatus === 'PARTIAL' ||
    (row.quantity !== null &&
      row.filledQuantity !== null &&
      row.filledQuantity > 0 &&
      row.filledQuantity < row.quantity) ||
    (row.remainingQuantity !== null && row.remainingQuantity > 0)
  );
}

function quantitiesMismatch(expected: number | null, actual: number | null): boolean {
  if (!(expected && expected > 0) || !(actual && actual > 0)) {
    return false;
  }
  const tolerance = Math.max(1e-8, Math.abs(expected) * 0.001);
  return Math.abs(Math.abs(actual) - Math.abs(expected)) > tolerance;
}

function pickNumberSource(candidates: Array<[string, unknown]>): NumberSource | null {
  for (const [source, rawValue] of candidates) {
    const value = readNullableNumber(rawValue);
    if (value !== null && Number.isFinite(value) && Math.abs(value) > 0) {
      return { value: Math.abs(value), source };
    }
  }
  return null;
}

export function resolveExpectedMudrexProtectionQuantity(input: {
  row: Pick<MudrexExecutionRow, 'filledQuantity' | 'quantity'>;
  position: Pick<MudrexPositionReadModel, 'quantity' | 'payload'> | null;
}): MudrexProtectionQuantityResolution {
  const payload = input.position?.payload ?? {};
  const baseQuantity = pickNumberSource([
    ['position.quantity', input.position?.quantity],
    ['position.payload.quantity', payload.quantity],
    ['position.payload.size', payload.size],
    ['position.payload.qty', payload.qty],
    ['position.payload.base_quantity', payload.base_quantity],
    ['position.payload.baseQuantity', payload.baseQuantity],
    ['execution.filled_quantity', input.row.filledQuantity],
    ['execution.quantity', input.row.quantity],
  ]);

  if (baseQuantity) {
    return {
      value: baseQuantity.value,
      source: baseQuantity.source,
      unit: 'base',
      notes: [],
    };
  }

  return {
    value: null,
    source: null,
    unit: 'unknown',
    notes: ['No usable Mudrex quantity source was available.'],
  };
}

function hasMudrexProtectionQuantityMismatch(input: {
  expected: MudrexProtectionQuantityResolution;
  stopLossQuantity: number | null;
  takeProfitQuantity: number | null;
}): boolean {
  if (input.expected.unit !== 'base' || !(input.expected.value && input.expected.value > 0)) {
    return false;
  }
  return (
    quantitiesMismatch(input.expected.value, input.stopLossQuantity) ||
    quantitiesMismatch(input.expected.value, input.takeProfitQuantity)
  );
}

export function hasMudrexProtectionQuantityMismatchForTest(input: {
  expected: MudrexProtectionQuantityResolution;
  stopLossQuantity: number | null;
  takeProfitQuantity: number | null;
}): boolean {
  return hasMudrexProtectionQuantityMismatch(input);
}

function extractOrderQuantity(payload: JsonRecord): number | null {
  return (
    readNullableNumber(payload.quantity) ??
    readNullableNumber(payload.qty) ??
    readNullableNumber(payload.size) ??
    readNullableNumber(payload.order_size) ??
    readNullableNumber(payload.orderSize) ??
    readNullableNumber(payload.base_quantity) ??
    readNullableNumber(payload.baseQuantity) ??
    readNullableNumber(payload.unfilled_size) ??
    readNullableNumber(payload.unfilledSize)
  );
}

function extractPlanStopLossOrderId(plan: JsonRecord): string | null {
  return (
    readNullableString(plan.stopLossOrderId) ??
    readNullableString(plan.stop_loss_order_id) ??
    readNullableString(readRecord(plan.stopLoss).orderId) ??
    readNullableString(readRecord(plan.stopLoss).order_id) ??
    readNullableString(readRecord(plan.stop_loss).orderId) ??
    readNullableString(readRecord(plan.stop_loss).order_id)
  );
}

function extractPlanTakeProfitOrderId(plan: JsonRecord): string | null {
  return (
    readNullableString(plan.takeProfitOrderId) ??
    readNullableString(plan.take_profit_order_id) ??
    readNullableString(readRecord(plan.takeProfit).orderId) ??
    readNullableString(readRecord(plan.takeProfit).order_id) ??
    readNullableString(readRecord(plan.take_profit).orderId) ??
    readNullableString(readRecord(plan.take_profit).order_id)
  );
}

function hasDirectRawPayloadMatch(payload: JsonRecord, positionId: string | null): boolean {
  if (!positionId) {
    return false;
  }
  const identifiers = [
    payload.id,
    payload.position_id,
    payload.positionId,
    payload.external_id,
    payload.externalId,
  ];
  return identifiers.some((value) => readNullableString(value) === positionId);
}

function mapExecution(row: JsonRecord): MudrexExecutionRow {
  const tradeSymbol = readString(row.tradeSymbol).toUpperCase();
  return {
    suggestedTradeId: readString(row.suggestedTradeId),
    userId: readString(row.userId),
    accountId: readNullableString(row.accountId),
    tradeSymbol,
    tradeBaseSymbol: normalizeSymbolBase(tradeSymbol),
    tradeSide: readString(row.tradeSide).toUpperCase(),
    timeframe: readNullableString(row.timeframe),
    entryOrderId: readNullableString(row.entryOrderId),
    orderStatus: normalizeStatus(row.orderStatus),
    executionState: readNullableString(row.executionState),
    positionId: readNullableString(row.positionId),
    positionStatus: readNullableString(row.positionStatus),
    quantity: readNullableNumber(row.quantity),
    filledQuantity: readNullableNumber(row.filledQuantity),
    remainingQuantity: readNullableNumber(row.remainingQuantity),
    entryPrice: readNullableNumber(row.entryPrice),
    filledPrice: readNullableNumber(row.filledPrice),
    stopLossPrice: readNullableNumber(row.stopLossPrice),
    takeProfitPrice: readNullableNumber(row.takeProfitPrice),
    protectionState: readString(row.protectionState).toLowerCase() || 'unknown',
    protectionPlan: readRecord(row.protectionPlanJson),
    submittedAt: toIsoString(row.submittedAt),
    filledAt: toIsoString(row.filledAt),
    positionOpenedAt: toIsoString(row.positionOpenedAt),
    positionClosedAt: toIsoString(row.positionClosedAt),
    updatedAt: toIsoString(row.updatedAt),
  };
}

function mapPosition(row: JsonRecord): MudrexPositionReadModel {
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
      normalizeDirection(payload.orderType) ??
      normalizeDirection(payload.position_type) ??
      normalizeDirection(payload.positionType),
    status: normalizeStatus(row.status ?? payload.status),
    statusKey: normalizeStatus(row.statusKey),
    statusRank: readNullableNumber(row.statusRank),
    quantity:
      readNullableNumber(row.quantity) ??
      readNullableNumber(payload.quantity) ??
      readNullableNumber(payload.size) ??
      readNullableNumber(payload.qty),
    stopLossPrice:
      readNullableNumber(row.stopLossPrice) ??
      readNullableNumber(payload.stoploss_price) ??
      readNullableNumber(payload.stopLossPrice) ??
      readNullableNumber(readRecord(payload.stoploss).price) ??
      readNullableNumber(readRecord(payload.stopLoss).price),
    takeProfitPrice:
      readNullableNumber(row.takeProfitPrice) ??
      readNullableNumber(payload.takeprofit_price) ??
      readNullableNumber(payload.takeProfitPrice) ??
      readNullableNumber(readRecord(payload.takeprofit).price) ??
      readNullableNumber(readRecord(payload.takeProfit).price),
    stopLossOrderId:
      readNullableString(row.stopLossOrderId) ??
      readNullableString(payload.stoploss_order_id) ??
      readNullableString(payload.stopLossOrderId) ??
      readNullableString(readRecord(payload.stoploss).id) ??
      readNullableString(readRecord(payload.stopLoss).id),
    takeProfitOrderId:
      readNullableString(row.takeProfitOrderId) ??
      readNullableString(payload.takeprofit_order_id) ??
      readNullableString(payload.takeProfitOrderId) ??
      readNullableString(readRecord(payload.takeprofit).id) ??
      readNullableString(readRecord(payload.takeProfit).id),
    firstSeenAt: toIsoString(row.firstSeenAt),
    lastSeenAt: toIsoString(row.lastSeenAt),
    payload,
  };
}

function mapOrder(row: JsonRecord): MudrexOrderSnapshot {
  const payload = readRecord(row.payloadJson);
  const symbol = readNullableString(row.symbol ?? payload.symbol ?? payload.product_symbol);
  return {
    userId: readString(row.userId),
    accountId: readString(row.accountId),
    externalId: readString(row.externalId),
    symbol,
    baseSymbol: normalizeSymbolBase(symbol),
    status: normalizeStatus(row.orderStatus ?? payload.status),
    statusRank: readNullableNumber(row.statusRank),
    quantity: extractOrderQuantity(payload),
    lastSeenAt: toIsoString(row.lastSeenAt),
    payload,
  };
}

function positionKey(userId: string, accountId: string | null, externalId: string | null): string {
  return `${userId}:${accountId ?? ''}:${externalId ?? ''}`;
}

function orderKey(userId: string, accountId: string | null, externalId: string | null): string {
  return `${userId}:${accountId ?? ''}:${externalId ?? ''}`;
}

function addIssue(
  issues: Set<MudrexProtectionHealthIssue>,
  reasons: string[],
  issue: MudrexProtectionHealthIssue,
  reason: string
): void {
  issues.add(issue);
  reasons.push(reason);
}

async function persistReport(report: JsonRecord): Promise<void> {
  if (!OUTPUT_FILE) {
    return;
  }
  const absoluteOutputPath = path.resolve(process.cwd(), OUTPUT_FILE);
  await mkdir(path.dirname(absoluteOutputPath), { recursive: true });
  await writeFile(absoluteOutputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

async function queryMudrexExecutions(): Promise<MudrexExecutionRow[]> {
  const rows = (await coreDataSource.query(
    `SELECT suggested_trade.id AS suggestedTradeId,
            suggested_trade.user_id AS userId,
            suggested_trade.symbol AS tradeSymbol,
            suggested_trade.side AS tradeSide,
            suggested_trade.timeframe AS timeframe,
            execution_record.account_id AS accountId,
            execution_record.order_id AS entryOrderId,
            execution_record.order_status AS orderStatus,
            execution_record.execution_state AS executionState,
            execution_record.position_id AS positionId,
            execution_record.position_status AS positionStatus,
            execution_record.quantity AS quantity,
            execution_record.filled_quantity AS filledQuantity,
            execution_record.remaining_quantity AS remainingQuantity,
            execution_record.entry_price AS entryPrice,
            execution_record.filled_price AS filledPrice,
            execution_record.stop_loss_price AS stopLossPrice,
            execution_record.take_profit_price AS takeProfitPrice,
            execution_record.protection_state AS protectionState,
            execution_record.protection_plan_json AS protectionPlanJson,
            execution_record.submitted_at AS submittedAt,
            execution_record.filled_at AS filledAt,
            execution_record.position_opened_at AS positionOpenedAt,
            execution_record.position_closed_at AS positionClosedAt,
            execution_record.updated_at AS updatedAt
       FROM suggested_trade_executions execution_record
       JOIN suggested_trades suggested_trade
         ON suggested_trade.id = execution_record.suggested_trade_id
      WHERE LOWER(COALESCE(execution_record.execution_mode, '')) = 'live'
        AND LOWER(COALESCE(execution_record.broker_key, '')) = ?
        AND (
          COALESCE(
            execution_record.position_opened_at,
            execution_record.filled_at,
            execution_record.submitted_at,
            suggested_trade.signal_time,
            execution_record.updated_at
          ) >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)
          OR LOWER(COALESCE(execution_record.execution_state, '')) NOT IN
            ('closed', 'cancelled', 'canceled', 'rejected', 'expired', 'failed')
          OR LOWER(COALESCE(execution_record.position_status, '')) NOT IN ('closed', 'liquidated')
        )
      ORDER BY COALESCE(
                 execution_record.position_opened_at,
                 execution_record.filled_at,
                 execution_record.submitted_at,
                 suggested_trade.signal_time,
                 execution_record.updated_at
               ) DESC
      LIMIT ${LIMIT}`,
    [MUDREX_BROKER, LOOKBACK_DAYS]
  )) as JsonRecord[];
  return rows.map(mapExecution);
}

async function queryMudrexPositions(): Promise<MudrexPositionReadModel[]> {
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
            position_model.first_seen_at AS firstSeenAt,
            position_model.last_seen_at AS lastSeenAt,
            position_model.payload_json AS payloadJson
       FROM position_read_models position_model
      WHERE LOWER(position_model.broker_key) = ?
        AND (
          position_model.last_seen_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)
          OR position_model.status_rank > 0
        )
      ORDER BY position_model.last_seen_at DESC
      LIMIT 5000`,
    [MUDREX_BROKER, LOOKBACK_DAYS + 1]
  )) as JsonRecord[];
  return rows.map(mapPosition).filter((position) => position.userId && position.accountId);
}

async function queryMudrexOrders(orderIds: string[]): Promise<Map<string, MudrexOrderSnapshot>> {
  const uniqueOrderIds = Array.from(new Set(orderIds.map(readString).filter(Boolean)));
  if (!uniqueOrderIds.length) {
    return new Map();
  }

  const rows = (await coreDataSource.query(
    `SELECT order_snapshot.user_id AS userId,
            order_snapshot.account_id AS accountId,
            order_snapshot.external_id AS externalId,
            order_snapshot.symbol AS symbol,
            order_snapshot.order_status AS orderStatus,
            order_snapshot.status_rank AS statusRank,
            order_snapshot.payload_json AS payloadJson,
            order_snapshot.last_seen_at AS lastSeenAt
       FROM scheduler_orders_snapshots order_snapshot
      WHERE LOWER(order_snapshot.broker_key) = ?
        AND order_snapshot.external_id IN (${uniqueOrderIds.map(() => '?').join(',')})`,
    [MUDREX_BROKER, ...uniqueOrderIds]
  )) as JsonRecord[];

  return new Map(
    rows.map((row) => {
      const order = mapOrder(row);
      return [orderKey(order.userId, order.accountId, order.externalId), order];
    })
  );
}

function resolveMudrexPosition(input: {
  row: MudrexExecutionRow;
  positionByKey: Map<string, MudrexPositionReadModel>;
  sameSymbolPositions: MudrexPositionReadModel[];
}): ResolvedMudrexPosition {
  const { row, positionByKey, sameSymbolPositions } = input;
  if (row.positionId) {
    const exact = positionByKey.get(positionKey(row.userId, row.accountId, row.positionId));
    if (exact) {
      return { position: exact, resolution: 'exact_read_model' };
    }

    const directPayloadMatches = sameSymbolPositions.filter((position) =>
      hasDirectRawPayloadMatch(position.payload, row.positionId)
    );
    if (directPayloadMatches.length === 1) {
      return { position: directPayloadMatches[0], resolution: 'direct_raw_payload' };
    }
  }

  return { position: null, resolution: 'unresolved' };
}

function resolveProtectionContext(
  row: MudrexExecutionRow,
  position: MudrexPositionReadModel | null,
  orderByKey: Map<string, MudrexOrderSnapshot>
): {
  stopLossOrderId: string | null;
  takeProfitOrderId: string | null;
  stopLossOrder: MudrexOrderSnapshot | null;
  takeProfitOrder: MudrexOrderSnapshot | null;
  stopLossActive: boolean;
  takeProfitActive: boolean;
} {
  const stopLossOrderId =
    extractPlanStopLossOrderId(row.protectionPlan) ?? position?.stopLossOrderId ?? null;
  const takeProfitOrderId =
    extractPlanTakeProfitOrderId(row.protectionPlan) ?? position?.takeProfitOrderId ?? null;
  const stopLossOrder =
    stopLossOrderId && row.accountId
      ? (orderByKey.get(orderKey(row.userId, row.accountId, stopLossOrderId)) ?? null)
      : null;
  const takeProfitOrder =
    takeProfitOrderId && row.accountId
      ? (orderByKey.get(orderKey(row.userId, row.accountId, takeProfitOrderId)) ?? null)
      : null;

  return {
    stopLossOrderId,
    takeProfitOrderId,
    stopLossOrder,
    takeProfitOrder,
    stopLossActive:
      isActiveOrder(stopLossOrder) || hasPositivePrice(position?.stopLossPrice ?? null),
    takeProfitActive:
      isActiveOrder(takeProfitOrder) || hasPositivePrice(position?.takeProfitPrice ?? null),
  };
}

function evaluateExecution(input: {
  row: MudrexExecutionRow;
  position: MudrexPositionReadModel | null;
  positionResolution: MudrexProtectionHealthItem['positionResolution'];
  sameSymbolOpenPositions: MudrexPositionReadModel[];
  orderByKey: Map<string, MudrexOrderSnapshot>;
}): MudrexProtectionHealthItem | null {
  const { row, position, positionResolution, sameSymbolOpenPositions, orderByKey } = input;
  const issues = new Set<MudrexProtectionHealthIssue>();
  const reasons: string[] = [];
  const protection = resolveProtectionContext(row, position, orderByKey);
  const positionMissing = needsOpenPositionProtection(row, position) && !position;
  const terminalPosition =
    isTerminalExecution(row) ||
    isTerminalPositionState(row.positionStatus) ||
    (position ? !isOpenPosition(position) : Boolean(row.positionClosedAt));
  const expectedProtectionQuantity = resolveExpectedMudrexProtectionQuantity({ row, position });
  const stopLossQuantity = protection.stopLossOrder?.quantity ?? null;
  const takeProfitQuantity = protection.takeProfitOrder?.quantity ?? null;

  if (positionMissing) {
    addIssue(
      issues,
      reasons,
      'missing_position_read_model',
      row.positionId
        ? `Mudrex execution position_id ${row.positionId} has no exact/direct position_read_models row.`
        : 'Mudrex execution is filled/open but has no position_id for read-model binding.'
    );
  }

  if (
    positionMissing &&
    (sameSymbolOpenPositions.length > 0 || Boolean(row.positionId && !position))
  ) {
    addIssue(
      issues,
      reasons,
      'unsafe_position_mismatch',
      `Mudrex execution cannot bind a safe position; same-symbol open candidates=${sameSymbolOpenPositions.length}.`
    );
  }

  if (position) {
    if (position.baseSymbol !== row.tradeBaseSymbol) {
      addIssue(
        issues,
        reasons,
        'unsafe_position_mismatch',
        `Position symbol ${position.symbol ?? 'unknown'} does not match trade symbol ${row.tradeSymbol}.`
      );
    }
    const expectedSide = normalizeDirection(row.tradeSide);
    if (expectedSide && position.side && expectedSide !== position.side) {
      addIssue(
        issues,
        reasons,
        'unsafe_position_mismatch',
        `Position side ${position.side} does not match trade side ${expectedSide}.`
      );
    }
  }

  if (!terminalPosition && needsOpenPositionProtection(row, position) && position) {
    if (!protection.stopLossActive) {
      addIssue(
        issues,
        reasons,
        'missing_active_stop_loss',
        'Open Mudrex position has no active stop-loss order snapshot or broker read-back stop-loss price.'
      );
    }
    if (!protection.takeProfitActive) {
      addIssue(
        issues,
        reasons,
        'missing_active_take_profit',
        'Open Mudrex position has no active take-profit order snapshot or broker read-back take-profit price.'
      );
    }
  }

  if (
    terminalPosition &&
    (isActiveOrder(protection.stopLossOrder) || isActiveOrder(protection.takeProfitOrder))
  ) {
    addIssue(
      issues,
      reasons,
      'stale_protection_for_closed_position',
      'Mudrex execution/position is terminal but linked protection order snapshots are still active.'
    );
  }

  if (
    !terminalPosition &&
    (isPartialFill(row) || expectedProtectionQuantity.value !== null) &&
    hasMudrexProtectionQuantityMismatch({
      expected: expectedProtectionQuantity,
      stopLossQuantity: isActiveOrder(protection.stopLossOrder) ? stopLossQuantity : null,
      takeProfitQuantity: isActiveOrder(protection.takeProfitOrder) ? takeProfitQuantity : null,
    })
  ) {
    addIssue(
      issues,
      reasons,
      'partial_fill_protection_mismatch',
      `Protection order quantity does not match Mudrex ${expectedProtectionQuantity.source ?? 'unknown'} quantity ${expectedProtectionQuantity.value ?? 'unknown'} ${expectedProtectionQuantity.unit}.`
    );
  }

  if (!issues.size) {
    return null;
  }

  return {
    suggestedTradeId: row.suggestedTradeId,
    userId: row.userId,
    accountId: row.accountId,
    symbol: row.tradeSymbol,
    timeframe: row.timeframe,
    side: row.tradeSide,
    entryOrderId: row.entryOrderId,
    orderStatus: row.orderStatus,
    executionState: row.executionState,
    positionId: row.positionId,
    positionStatus: row.positionStatus,
    protectionState: row.protectionState,
    quantity: row.quantity,
    filledQuantity: row.filledQuantity,
    remainingQuantity: row.remainingQuantity,
    entryPrice: row.entryPrice,
    filledPrice: row.filledPrice,
    plannedStopLossPrice: row.stopLossPrice,
    plannedTakeProfitPrice: row.takeProfitPrice,
    positionResolution,
    positionReadModelExternalId: position?.externalId ?? null,
    positionReadModelStatus: position?.status ?? null,
    positionReadModelSymbol: position?.symbol ?? null,
    positionReadModelSide: position?.side ?? null,
    positionReadModelQuantity: position?.quantity ?? null,
    stopLossOrderId: protection.stopLossOrderId,
    stopLossOrderStatus: protection.stopLossOrder?.status ?? null,
    stopLossOrderQuantity: stopLossQuantity,
    takeProfitOrderId: protection.takeProfitOrderId,
    takeProfitOrderStatus: protection.takeProfitOrder?.status ?? null,
    takeProfitOrderQuantity: takeProfitQuantity,
    expectedProtectionQuantity: expectedProtectionQuantity.value,
    expectedProtectionQuantitySource: expectedProtectionQuantity.source,
    expectedProtectionQuantityUnit: expectedProtectionQuantity.unit,
    expectedProtectionQuantityNotes: expectedProtectionQuantity.notes,
    sameSymbolOpenPositionCandidates: sameSymbolOpenPositions.length,
    issues: Array.from(issues),
    reasons,
  };
}

function countItemsWithIssue(
  items: MudrexProtectionHealthItem[],
  issue: MudrexProtectionHealthIssue
): number {
  return items.filter((item) => item.issues.includes(issue)).length;
}

function countByIssue(
  items: MudrexProtectionHealthItem[]
): Record<MudrexProtectionHealthIssue, number> {
  return {
    missing_position_read_model: countItemsWithIssue(items, 'missing_position_read_model'),
    missing_active_stop_loss: countItemsWithIssue(items, 'missing_active_stop_loss'),
    missing_active_take_profit: countItemsWithIssue(items, 'missing_active_take_profit'),
    stale_protection_for_closed_position: countItemsWithIssue(
      items,
      'stale_protection_for_closed_position'
    ),
    partial_fill_protection_mismatch: countItemsWithIssue(
      items,
      'partial_fill_protection_mismatch'
    ),
    unsafe_position_mismatch: countItemsWithIssue(items, 'unsafe_position_mismatch'),
  };
}

export async function buildMudrexProtectionHealthReport(): Promise<MudrexProtectionHealthReport> {
  const generatedAt = new Date();
  const executions = await queryMudrexExecutions();
  const positions = await queryMudrexPositions();
  const positionByKey = new Map(
    positions.map((position) => [
      positionKey(position.userId, position.accountId, position.externalId),
      position,
    ])
  );
  const openPositions = positions.filter(isOpenPosition);
  const resolvedPositions = new Map<string, ResolvedMudrexPosition>();
  for (const execution of executions) {
    const sameSymbolPositions = positions.filter(
      (position) =>
        position.userId === execution.userId &&
        position.accountId === execution.accountId &&
        position.baseSymbol === execution.tradeBaseSymbol
    );
    resolvedPositions.set(
      execution.suggestedTradeId,
      resolveMudrexPosition({ row: execution, positionByKey, sameSymbolPositions })
    );
  }

  const orderIds = new Set<string>();
  for (const execution of executions) {
    const planStopLossOrderId = extractPlanStopLossOrderId(execution.protectionPlan);
    const planTakeProfitOrderId = extractPlanTakeProfitOrderId(execution.protectionPlan);
    if (planStopLossOrderId) {
      orderIds.add(planStopLossOrderId);
    }
    if (planTakeProfitOrderId) {
      orderIds.add(planTakeProfitOrderId);
    }
    const position = resolvedPositions.get(execution.suggestedTradeId)?.position ?? null;
    if (position?.stopLossOrderId) {
      orderIds.add(position.stopLossOrderId);
    }
    if (position?.takeProfitOrderId) {
      orderIds.add(position.takeProfitOrderId);
    }
  }

  const orderByKey = await queryMudrexOrders(Array.from(orderIds));
  const items = executions
    .map((row) => {
      const resolvedPosition = resolvedPositions.get(row.suggestedTradeId) ?? {
        position: null,
        resolution: 'unresolved' as const,
      };
      const sameSymbolOpenPositions = openPositions.filter(
        (position) =>
          position.userId === row.userId &&
          position.accountId === row.accountId &&
          position.baseSymbol === row.tradeBaseSymbol
      );
      return evaluateExecution({
        row,
        position: resolvedPosition.position,
        positionResolution: resolvedPosition.resolution,
        sameSymbolOpenPositions,
        orderByKey,
      });
    })
    .filter((item): item is MudrexProtectionHealthItem => Boolean(item));
  const byIssue = countByIssue(items);

  return {
    generatedAt: generatedAt.toISOString(),
    brokerKey: MUDREX_BROKER,
    mutation: 'none_read_only',
    lookbackDays: LOOKBACK_DAYS,
    limit: LIMIT,
    audited: executions.length,
    openPositions: openPositions.length,
    issueTrades: items.length,
    missingPositionReadModel: byIssue.missing_position_read_model,
    missingActiveStopLoss: byIssue.missing_active_stop_loss,
    missingActiveTakeProfit: byIssue.missing_active_take_profit,
    staleProtectionForClosedPosition: byIssue.stale_protection_for_closed_position,
    partialFillProtectionMismatch: byIssue.partial_fill_protection_mismatch,
    unsafePositionMismatch: byIssue.unsafe_position_mismatch,
    thresholds: {
      maxMissingPositionReadModel: MAX_MISSING_POSITION_READ_MODEL,
      maxMissingActiveStopLoss: MAX_MISSING_ACTIVE_STOP_LOSS,
      maxMissingActiveTakeProfit: MAX_MISSING_ACTIVE_TAKE_PROFIT,
      maxStaleProtectionForClosedPosition: MAX_STALE_PROTECTION_FOR_CLOSED_POSITION,
      maxPartialFillProtectionMismatch: MAX_PARTIAL_FILL_PROTECTION_MISMATCH,
      maxUnsafePositionMismatch: MAX_UNSAFE_POSITION_MISMATCH,
    },
    byIssue,
    items,
  };
}

async function run(): Promise<void> {
  await initializeCoreDataSource();

  try {
    const report = await buildMudrexProtectionHealthReport();

    await persistReport(report);
    console.log('suggested-trades-mudrex-protection-health:', JSON.stringify(report));

    const failures = [
      [
        report.missingPositionReadModel,
        MAX_MISSING_POSITION_READ_MODEL,
        'missing Mudrex position read models',
      ],
      [report.missingActiveStopLoss, MAX_MISSING_ACTIVE_STOP_LOSS, 'missing Mudrex stop losses'],
      [
        report.missingActiveTakeProfit,
        MAX_MISSING_ACTIVE_TAKE_PROFIT,
        'missing Mudrex take profits',
      ],
      [
        report.staleProtectionForClosedPosition,
        MAX_STALE_PROTECTION_FOR_CLOSED_POSITION,
        'stale Mudrex protection for closed positions',
      ],
      [
        report.partialFillProtectionMismatch,
        MAX_PARTIAL_FILL_PROTECTION_MISMATCH,
        'Mudrex partial-fill protection mismatches',
      ],
      [
        report.unsafePositionMismatch,
        MAX_UNSAFE_POSITION_MISMATCH,
        'unsafe Mudrex position mismatches',
      ],
    ].filter(([actual, max]) => Number(actual) > Number(max));

    if (failures.length) {
      throw new Error(
        failures
          .map(([actual, max, label]) => `${label} ${String(actual)} exceeds ${String(max)}`)
          .join('; ')
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
