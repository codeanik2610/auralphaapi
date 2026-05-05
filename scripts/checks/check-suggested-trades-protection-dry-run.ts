import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { coreDataSource } from '../../src/database/data-source';

type JsonRecord = Record<string, unknown>;

type ProtectionClassification =
  | 'NOOP_ACTIVE'
  | 'WOULD_REPLACE_INACTIVE_PROTECTION'
  | 'MANUAL_STOP_ALREADY_CROSSED'
  | 'MANUAL_UNLINKED'
  | 'WAITING_FOR_FILL'
  | 'WAITING_FOR_POSITION'
  | 'REVIEW';

type OrderSnapshot = {
  externalId: string;
  symbol: string | null;
  status: string | null;
  side: string | null;
  orderType: string | null;
  stopOrderType: string | null;
  reduceOnly: boolean | null;
  price: number | null;
  filledQuantity: number | null;
  reason: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  lastSeenAt: string | null;
};

type PositionSnapshot = {
  externalId: string;
  symbol: string;
  baseSymbol: string;
  status: string;
  side: string | null;
  entryPrice: number | null;
  markPrice: number | null;
  currentPrice: number | null;
  contracts: number | null;
  baseQuantity: number | null;
  unrealizedPnl: number | null;
  stopLossOrderId: string | null;
  stopLossPrice: number | null;
  takeProfitOrderId: string | null;
  takeProfitPrice: number | null;
  lastSeenAt: string | null;
};

type ReplacementPreview = {
  dryRun: true;
  brokerKey: 'delta_exchange';
  accountId: string | null;
  tradeSymbol: string;
  positionSymbol: string;
  entryOrderId: string | null;
  body: {
    size: number;
    entrySide: 'buy' | 'sell';
    stopLossPrice: number;
    takeProfitPrice: number;
    idempotencyKey: string;
  };
  directionValid: boolean;
};

const OUTPUT_FILE = String(
  process.env.SUGGESTED_TRADES_PROTECTION_DRY_RUN_OUTPUT_FILE ||
    'artifacts/suggested-trades-protection-dry-run.json'
).trim();
const DELTA_BROKER = 'delta_exchange';
const ACTIVE_ORDER_STATUSES = new Set(['OPEN', 'PENDING']);
const INACTIVE_ORDER_STATUSES = new Set(['CANCELLED', 'CANCELED', 'REJECTED', 'EXPIRED', 'FAILED']);

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

function readBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') {
    return value;
  }
  const normalized = readString(value).toLowerCase();
  if (normalized === 'true' || normalized === '1') {
    return true;
  }
  if (normalized === 'false' || normalized === '0') {
    return false;
  }
  return null;
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

function readJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function toIsoString(value: unknown): string | null {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeOrderStatus(value: unknown): string | null {
  const normalized = readNullableString(value)?.toUpperCase() ?? null;
  return normalized;
}

function normalizeSymbolBase(symbol: string): string {
  const normalized = symbol.trim().toUpperCase();
  for (const suffix of ['USDT', 'USDC', 'USD']) {
    if (normalized.endsWith(suffix) && normalized.length > suffix.length) {
      return normalized.slice(0, -suffix.length);
    }
  }
  return normalized;
}

function countBy<T extends string>(items: T[]): Record<T, number> {
  return items.reduce<Record<T, number>>(
    (acc, item) => {
      acc[item] = (acc[item] ?? 0) + 1;
      return acc;
    },
    {} as Record<T, number>
  );
}

function countDecimals(value: number | null): number {
  if (value === null) {
    return 0;
  }
  const raw = String(value);
  return raw.includes('.') ? (raw.split('.')[1]?.length ?? 0) : 0;
}

function deriveScaledProtectionPrice(
  actualEntryPrice: number,
  requestedEntryPrice: number,
  requestedTargetPrice: number
): number {
  const precision = Math.max(
    6,
    countDecimals(requestedEntryPrice),
    countDecimals(requestedTargetPrice)
  );
  return Number(
    ((actualEntryPrice * requestedTargetPrice) / requestedEntryPrice).toFixed(precision)
  );
}

function isExecutionFilled(row: JsonRecord): boolean {
  const executionState = readNullableString(row.executionState)?.toLowerCase();
  const orderStatus = normalizeOrderStatus(row.orderStatus);
  return Boolean(
    row.filledAt ||
    executionState === 'filled' ||
    orderStatus === 'CLOSED' ||
    orderStatus === 'FILLED'
  );
}

function isActiveOrder(status: string | null): boolean {
  return Boolean(status && ACTIVE_ORDER_STATUSES.has(status));
}

function isInactiveOrder(status: string | null): boolean {
  return Boolean(status && INACTIVE_ORDER_STATUSES.has(status));
}

function isStopAlreadyCrossed(
  side: string,
  marketPrice: number | null,
  stopLossPrice: number | null
): boolean {
  if (!(marketPrice && marketPrice > 0 && stopLossPrice && stopLossPrice > 0)) {
    return false;
  }
  return side === 'BUY' ? marketPrice <= stopLossPrice : marketPrice >= stopLossPrice;
}

function isProtectionDirectionValid(
  entrySide: 'buy' | 'sell',
  entryPrice: number,
  stopLossPrice: number,
  takeProfitPrice: number
): boolean {
  if (!(entryPrice > 0 && stopLossPrice > 0 && takeProfitPrice > 0)) {
    return false;
  }
  return entrySide === 'buy'
    ? stopLossPrice < entryPrice && takeProfitPrice > entryPrice
    : stopLossPrice > entryPrice && takeProfitPrice < entryPrice;
}

function firstTakeProfitTarget(value: unknown): number | null {
  const targets = readJsonArray(value);
  for (const target of targets) {
    const numeric =
      readNullableNumber(target) ??
      readNullableNumber(readRecord(target).price) ??
      readNullableNumber(readRecord(target).target);
    if (numeric && numeric > 0) {
      return numeric;
    }
  }
  return null;
}

function mapPosition(row: JsonRecord): PositionSnapshot {
  const payload = readRecord(row.payloadJson);
  const symbol = readString(row.symbol || payload.symbol).toUpperCase();
  return {
    externalId: readString(row.externalId || payload.id),
    symbol,
    baseSymbol: normalizeSymbolBase(symbol),
    status: readString(row.status || payload.status).toUpperCase(),
    side: readNullableString(payload.side ?? payload.order_type ?? payload.position_type),
    entryPrice: readNullableNumber(payload.entry_price ?? payload.entryPrice),
    markPrice: readNullableNumber(payload.mark_price ?? payload.markPrice),
    currentPrice: readNullableNumber(payload.current_price ?? payload.currentPrice),
    contracts: readNullableNumber(payload.quantity_contracts ?? payload.size),
    baseQuantity: readNullableNumber(payload.base_quantity ?? payload.quantity),
    unrealizedPnl: readNullableNumber(payload.unrealized_pnl ?? payload.pnl),
    stopLossOrderId: readNullableString(readRecord(payload.stoploss).order_id),
    stopLossPrice: readNullableNumber(readRecord(payload.stoploss).price),
    takeProfitOrderId: readNullableString(readRecord(payload.takeprofit).order_id),
    takeProfitPrice: readNullableNumber(readRecord(payload.takeprofit).price),
    lastSeenAt: toIsoString(row.lastSeenAt),
  };
}

function mapOrder(row: JsonRecord): OrderSnapshot {
  const payload = readRecord(row.payloadJson);
  const price = readNullableNumber(
    payload.price ?? payload.stop_price ?? payload.limit_price ?? payload.filled_price
  );
  return {
    externalId: readString(row.externalId || payload.id),
    symbol: readNullableString(row.symbol || payload.symbol),
    status: normalizeOrderStatus(row.orderStatus || payload.status),
    side: readNullableString(payload.side),
    orderType: readNullableString(payload.order_type),
    stopOrderType: readNullableString(payload.stop_order_type),
    reduceOnly: readBoolean(payload.reduce_only),
    price,
    filledQuantity: readNullableNumber(payload.filled_quantity),
    reason: readNullableString(payload.reason),
    createdAt: toIsoString(payload.created_at),
    updatedAt: toIsoString(payload.updated_at),
    lastSeenAt: toIsoString(row.lastSeenAt),
  };
}

function createReplacementPreview(input: {
  row: JsonRecord;
  position: PositionSnapshot;
  requestedEntryPrice: number;
  requestedStopLossPrice: number;
  requestedTakeProfitPrice: number;
}): ReplacementPreview | null {
  const actualEntryPrice =
    input.position.entryPrice ??
    readNullableNumber(input.row.filledPrice) ??
    readNullableNumber(input.row.entryPrice);
  const size =
    input.position.contracts ??
    readNullableNumber(input.row.filledQuantity) ??
    readNullableNumber(input.row.quantity);
  if (!(actualEntryPrice && actualEntryPrice > 0) || !(size && size > 0)) {
    return null;
  }
  const entrySide = readString(input.row.tradeSide).toUpperCase() === 'SELL' ? 'sell' : 'buy';
  const stopLossPrice = deriveScaledProtectionPrice(
    actualEntryPrice,
    input.requestedEntryPrice,
    input.requestedStopLossPrice
  );
  const takeProfitPrice = deriveScaledProtectionPrice(
    actualEntryPrice,
    input.requestedEntryPrice,
    input.requestedTakeProfitPrice
  );
  return {
    dryRun: true,
    brokerKey: DELTA_BROKER,
    accountId: readNullableString(input.row.accountId),
    tradeSymbol: readString(input.row.tradeSymbol),
    positionSymbol: input.position.symbol,
    entryOrderId: readNullableString(input.row.orderId),
    body: {
      size: Math.abs(size),
      entrySide,
      stopLossPrice,
      takeProfitPrice,
      idempotencyKey: readNullableString(input.row.orderId)
        ? `live-auto-protection:${readString(input.row.suggestedTradeId)}:${readString(
            input.row.orderId
          )}`
        : `live-auto-protection:${readString(input.row.suggestedTradeId)}`,
    },
    directionValid: isProtectionDirectionValid(
      entrySide,
      actualEntryPrice,
      stopLossPrice,
      takeProfitPrice
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

async function queryDeltaExecutions(): Promise<JsonRecord[]> {
  return (await coreDataSource.query(
    `SELECT suggested_trade.id AS suggestedTradeId,
            suggested_trade.user_id AS userId,
            suggested_trade.symbol AS tradeSymbol,
            suggested_trade.side AS tradeSide,
            suggested_trade.timeframe AS timeframe,
            suggested_trade.entry_price AS tradeEntryPrice,
            suggested_trade.stop_loss_price AS tradeStopLossPrice,
            suggested_trade.take_profit_targets AS tradeTakeProfitTargets,
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
            execution_record.filled_quantity AS filledQuantity,
            execution_record.quantity AS quantity,
            execution_record.submitted_at AS submittedAt,
            execution_record.filled_at AS filledAt,
            execution_record.protection_state AS protectionState,
            execution_record.protection_checked_at AS protectionCheckedAt,
            execution_record.protection_attached_at AS protectionAttachedAt,
            execution_record.protection_plan_json AS protectionPlanJson
       FROM suggested_trade_executions execution_record
       JOIN suggested_trades suggested_trade
         ON suggested_trade.id = execution_record.suggested_trade_id
      WHERE LOWER(COALESCE(execution_record.execution_mode, '')) = 'live'
        AND LOWER(COALESCE(execution_record.broker_key, '')) = ?
        AND LOWER(COALESCE(execution_record.execution_state, '')) NOT IN
            ('closed', 'cancelled', 'rejected', 'expired', 'failed')
        AND LOWER(COALESCE(execution_record.position_status, '')) NOT IN ('closed', 'liquidated')
      ORDER BY COALESCE(execution_record.submitted_at, execution_record.updated_at) ASC`,
    [DELTA_BROKER]
  )) as JsonRecord[];
}

async function queryPositions(brokerKey: string): Promise<PositionSnapshot[]> {
  const rows = (await coreDataSource.query(
    `SELECT external_id AS externalId,
            symbol AS symbol,
            status AS status,
            payload_json AS payloadJson,
            last_seen_at AS lastSeenAt
       FROM scheduler_positions_snapshots
      WHERE LOWER(broker_key) = ?
        AND UPPER(status) = 'OPEN'
      ORDER BY symbol ASC`,
    [brokerKey]
  )) as JsonRecord[];
  return rows.map(mapPosition);
}

async function queryOrders(orderIds: string[]): Promise<Map<string, OrderSnapshot>> {
  const uniqueOrderIds = Array.from(new Set(orderIds.filter(Boolean)));
  if (!uniqueOrderIds.length) {
    return new Map();
  }
  const placeholders = uniqueOrderIds.map(() => '?').join(', ');
  const rows = (await coreDataSource.query(
    `SELECT external_id AS externalId,
            symbol AS symbol,
            order_status AS orderStatus,
            payload_json AS payloadJson,
            last_seen_at AS lastSeenAt
       FROM scheduler_orders_snapshots
      WHERE LOWER(broker_key) = ?
        AND external_id IN (${placeholders})`,
    [DELTA_BROKER, ...uniqueOrderIds]
  )) as JsonRecord[];
  return new Map(
    rows.map((row) => {
      const order = mapOrder(row);
      return [order.externalId, order];
    })
  );
}

function classifyDeltaItem(input: {
  row: JsonRecord;
  position: PositionSnapshot | null;
  stopLossOrder: OrderSnapshot | null;
  takeProfitOrder: OrderSnapshot | null;
}): {
  classification: ProtectionClassification;
  reason: string;
} {
  if (!input.position) {
    return isExecutionFilled(input.row)
      ? {
          classification: 'WAITING_FOR_POSITION',
          reason: 'Entry appears filled, but no active Delta position snapshot is matched yet.',
        }
      : {
          classification: 'WAITING_FOR_FILL',
          reason: 'Delta entry order has not filled yet, so post-fill protection is not ready.',
        };
  }

  const stopLossStatus = input.stopLossOrder?.status ?? null;
  const takeProfitStatus = input.takeProfitOrder?.status ?? null;
  if (isActiveOrder(stopLossStatus) && isActiveOrder(takeProfitStatus)) {
    return {
      classification: 'NOOP_ACTIVE',
      reason: 'Both linked Delta SL/TP order snapshots are active.',
    };
  }

  const protectionState = readString(input.row.protectionState).toLowerCase();
  if (protectionState === 'manual_unlinked') {
    return {
      classification: 'MANUAL_UNLINKED',
      reason:
        'Delta protection is already marked manual_unlinked; Phase 4 will not auto-replace it.',
    };
  }

  const tradeSide = readString(input.row.tradeSide).toUpperCase();
  const marketPrice = input.position.markPrice ?? input.position.currentPrice;
  const stopLossPrice =
    input.stopLossOrder?.price ??
    readNullableNumber(readRecord(input.row.protectionPlanJson).stopLossPrice) ??
    readNullableNumber(input.row.stopLossPrice);
  if (isStopAlreadyCrossed(tradeSide, marketPrice, stopLossPrice)) {
    return {
      classification: 'MANUAL_STOP_ALREADY_CROSSED',
      reason: 'The planned stop-loss is already crossed at the current Delta mark price.',
    };
  }

  if (
    isInactiveOrder(stopLossStatus) ||
    isInactiveOrder(takeProfitStatus) ||
    !input.stopLossOrder ||
    !input.takeProfitOrder
  ) {
    return {
      classification: 'WOULD_REPLACE_INACTIVE_PROTECTION',
      reason: 'Open Delta position has missing or inactive linked SL/TP order snapshots.',
    };
  }

  return {
    classification: 'REVIEW',
    reason: 'Delta protection status did not match an automatic dry-run classification.',
  };
}

async function run(): Promise<void> {
  if (!coreDataSource.isInitialized) {
    await coreDataSource.initialize();
  }

  try {
    const generatedAt = new Date();
    const [deltaExecutions, deltaPositions, mudrexPositions] = await Promise.all([
      queryDeltaExecutions(),
      queryPositions(DELTA_BROKER),
      queryPositions('mudrex'),
    ]);
    const protectionOrderIds = deltaExecutions.flatMap((row) => {
      const plan = readRecord(row.protectionPlanJson);
      return [
        readNullableString(plan.stopLossOrderId),
        readNullableString(plan.takeProfitOrderId),
      ].filter((value): value is string => Boolean(value));
    });
    const orderById = await queryOrders(protectionOrderIds);
    const positionByBaseSymbol = new Map(
      deltaPositions.map((position) => [position.baseSymbol, position])
    );

    const deltaItems = deltaExecutions.map((row) => {
      const plan = readRecord(row.protectionPlanJson);
      const tradeSymbol = readString(row.tradeSymbol).toUpperCase();
      const position = positionByBaseSymbol.get(normalizeSymbolBase(tradeSymbol)) ?? null;
      const stopLossOrderId = readNullableString(plan.stopLossOrderId);
      const takeProfitOrderId = readNullableString(plan.takeProfitOrderId);
      const stopLossOrder = stopLossOrderId ? (orderById.get(stopLossOrderId) ?? null) : null;
      const takeProfitOrder = takeProfitOrderId ? (orderById.get(takeProfitOrderId) ?? null) : null;
      const classification = classifyDeltaItem({
        row,
        position,
        stopLossOrder,
        takeProfitOrder,
      });
      const requestedEntryPrice =
        readNullableNumber(plan.entryPrice) ??
        readNullableNumber(row.entryPrice) ??
        readNullableNumber(row.tradeEntryPrice);
      const requestedStopLossPrice =
        readNullableNumber(plan.stopLossPrice) ??
        readNullableNumber(row.stopLossPrice) ??
        readNullableNumber(row.tradeStopLossPrice);
      const requestedTakeProfitPrice =
        readNullableNumber(plan.takeProfitPrice) ??
        readNullableNumber(row.takeProfitPrice) ??
        firstTakeProfitTarget(row.tradeTakeProfitTargets);
      const replacementPreview =
        classification.classification === 'WOULD_REPLACE_INACTIVE_PROTECTION' &&
        position &&
        requestedEntryPrice &&
        requestedStopLossPrice &&
        requestedTakeProfitPrice
          ? createReplacementPreview({
              row,
              position,
              requestedEntryPrice,
              requestedStopLossPrice,
              requestedTakeProfitPrice,
            })
          : null;

      return {
        classification: classification.classification,
        reason: classification.reason,
        suggestedTradeId: readString(row.suggestedTradeId),
        userId: readString(row.userId),
        accountId: readNullableString(row.accountId),
        tradeSymbol,
        positionSymbol: position?.symbol ?? null,
        side: readString(row.tradeSide).toUpperCase(),
        timeframe: readNullableString(row.timeframe),
        entryOrderId: readNullableString(row.orderId),
        entryOrderStatus: normalizeOrderStatus(row.orderStatus),
        executionState: readNullableString(row.executionState),
        submittedAt: toIsoString(row.submittedAt),
        filledAt: toIsoString(row.filledAt),
        secondsToFill:
          row.submittedAt && row.filledAt
            ? Math.max(
                0,
                Math.floor(
                  (new Date(String(row.filledAt)).getTime() -
                    new Date(String(row.submittedAt)).getTime()) /
                    1000
                )
              )
            : null,
        protectionState: readNullableString(row.protectionState),
        protectionCheckedAt: toIsoString(row.protectionCheckedAt),
        protectionAttachedAt: toIsoString(row.protectionAttachedAt),
        position,
        stopLossOrder,
        takeProfitOrder,
        replacementPreview,
      };
    });

    const mudrexItems = mudrexPositions.map((position) => ({
      brokerKey: 'mudrex',
      classification:
        position.stopLossOrderId && position.takeProfitOrderId ? 'HAS_BOTH' : 'MISSING',
      symbol: position.symbol,
      side: position.side,
      quantity: position.baseQuantity,
      entryPrice: position.entryPrice,
      markPrice: position.markPrice ?? position.currentPrice,
      unrealizedPnl: position.unrealizedPnl,
      stopLossOrderId: position.stopLossOrderId,
      stopLossPrice: position.stopLossPrice,
      takeProfitOrderId: position.takeProfitOrderId,
      takeProfitPrice: position.takeProfitPrice,
      lastSeenAt: position.lastSeenAt,
    }));
    const report = {
      generatedAt: generatedAt.toISOString(),
      dryRun: true,
      summary: {
        delta: {
          trackedExecutions: deltaItems.length,
          openPositions: deltaPositions.length,
          byClassification: countBy(
            deltaItems.map((item) => item.classification as ProtectionClassification)
          ),
          replacementCandidates: deltaItems.filter(
            (item) => item.classification === 'WOULD_REPLACE_INACTIVE_PROTECTION'
          ).length,
          manualStopAlreadyCrossed: deltaItems.filter(
            (item) => item.classification === 'MANUAL_STOP_ALREADY_CROSSED'
          ).length,
          manualUnlinked: deltaItems.filter((item) => item.classification === 'MANUAL_UNLINKED')
            .length,
          reviewItems: deltaItems.filter((item) => item.classification === 'REVIEW').length,
        },
        mudrex: {
          openPositions: mudrexItems.length,
          byClassification: countBy(
            mudrexItems.map((item) => item.classification as 'HAS_BOTH' | 'MISSING')
          ),
        },
      },
      deltaItems,
      mudrexItems,
    };

    await persistReport(report);
    console.log('suggested-trades-protection-dry-run:', JSON.stringify(report));
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
