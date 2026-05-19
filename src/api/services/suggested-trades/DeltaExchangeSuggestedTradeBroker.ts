import { env } from '../../../env';
import { SuggestedTradeExecutionLink } from '../../contracts/SuggestedTrade';
import { BadRequestAppError } from '../../errors/AppError';

const DELTA_EXCHANGE_BROKER_KEY = 'delta_exchange';
const DELTA_EXCHANGE_LIVE_AUTO_ENV = 'SUGGESTED_TRADES_LIVE_AUTO_DELTA_EXCHANGE_ENABLED';
const DELTA_EXCHANGE_PROTECTION_REPAIR_ENV =
  'SUGGESTED_TRADES_PROTECTION_REPAIR_DELTA_EXCHANGE_ENABLED';

type BooleanEnvReader = (name: string) => boolean | null;

type SuggestedTradeSymbolSideLike = {
  symbol?: unknown;
  side?: unknown;
};

type LivePositionSnapshotLike = {
  payload?: Record<string, unknown> | null;
};

export type LiveProtectionOrderContextLike = {
  stopLossOrderId: string | null;
  takeProfitOrderId: string | null;
  stopLossStatus: string | null;
  takeProfitStatus: string | null;
  activeOrderIds: string[];
  orderDetails?: Record<
    string,
    {
      status?: string | null;
      quantity?: number | null;
      filledQuantity?: number | null;
      remainingQuantity?: number | null;
      stopPrice?: number | null;
      limitPrice?: number | null;
      stopOrderType?: string | null;
    }
  >;
};

export type DeltaActiveProtectionOrdersLike = {
  stopLossOrderIds: string[];
  takeProfitOrderIds: string[];
  unclassifiedOrderIds: string[];
  activeOrderIds: string[];
  orderDetails?: LiveProtectionOrderContextLike['orderDetails'];
};

type SuggestedTradeProtectionTradeLike = {
  id: string;
  symbol: string;
  side?: unknown;
  timeframe?: unknown;
};

export interface DeltaProtectionPrices {
  requestedEntryPrice: number | null;
  stopLossPrice: number;
  takeProfitPrice: number;
}

export interface DeltaProtectionOrdersAdapter {
  listOpenOrders?: (
    query: { limit: number },
    context?: { userId?: string; brokerKey?: string; accountId?: string }
  ) => Promise<unknown>;
  getOrder?: (
    orderId: string,
    context?: { userId?: string; brokerKey?: string; accountId?: string }
  ) => Promise<unknown>;
  cancelOrder?: (
    orderId: string,
    context?: { userId?: string; brokerKey?: string; accountId?: string }
  ) => Promise<unknown>;
  createLiveAutoProtectiveOrdersForPosition?: (
    assetId: string,
    body: {
      size: number;
      entrySide: 'buy' | 'sell';
      stopLossPrice: number;
      takeProfitPrice: number;
      idempotencyKey?: string;
      deltaProtectionMode?: string | null;
    },
    context?: { userId?: string; brokerKey?: string; accountId?: string }
  ) => Promise<unknown>;
}

export interface DeltaProtectionPositionsAdapter {
  closePosition?: (
    positionId: string,
    context?: { userId?: string; brokerKey?: string; accountId?: string }
  ) => Promise<unknown>;
}

export interface DeltaLiveAutoProductRulePreflightAdapter {
  preflightLiveAutoOrder?: (
    assetId: string,
    body: {
      symbol?: string | null;
      quantity: number;
      entryPrice: number;
      stopLossPrice: number;
      takeProfitPrice: number;
      side: 'long' | 'short';
    },
    context?: { userId?: string; brokerKey?: string; accountId?: string }
  ) => Promise<{
    quantityContracts?: number;
    contractValue?: number;
    contractUnitCurrency?: string | null;
    auditNote?: string | null;
  }>;
}

export interface DeltaLiveAutoOrderSizingResult {
  quantity: number;
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  auditNote: string | null;
}

export interface DeltaLiveAutoOrderSizingInput {
  adapter: DeltaLiveAutoProductRulePreflightAdapter | null | undefined;
  assetId: string;
  brokerSymbol: string;
  quantity: number;
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  side: 'long' | 'short';
}

export interface DeltaLiveProtectionRepairInput {
  userId: string;
  trade: SuggestedTradeProtectionTradeLike;
  execution: SuggestedTradeExecutionLink;
  position: LivePositionSnapshotLike & { externalId?: unknown };
  prices: DeltaProtectionPrices;
  nowIso: string;
  brokerKey: string;
  accountId: string;
  ordersAdapter: DeltaProtectionOrdersAdapter | null | undefined;
  positionsAdapter?: DeltaProtectionPositionsAdapter | null | undefined;
  protectionRepairEnabled: boolean;
  resolveLiveProtectionOrderContext: (
    userId: string,
    suggestedTradeId: string,
    brokerKey: string,
    accountId: string,
    orderId: string
  ) => Promise<LiveProtectionOrderContextLike>;
  hasUsableProtectionContext: (context: LiveProtectionOrderContextLike) => boolean;
  resolvePositionEntryPrice: (
    payload: Record<string, unknown>,
    execution: SuggestedTradeExecutionLink
  ) => number | null;
  resolvePositionCurrentPrice: (payload: Record<string, unknown>) => number | null;
  deriveScaledProtectionPrice: (
    actualEntryPrice: number,
    requestedEntryPrice: number,
    requestedTargetPrice: number
  ) => string;
  resolveLiveAutoAssetRoute: (
    brokerKey: string,
    symbol: string
  ) => Promise<{ assetId: string; brokerSymbol: string; candidateSymbols: string[] }>;
  resolveActiveProtectionOrdersForSymbol: (input: {
    userId: string;
    brokerKey: string;
    accountId: string;
    symbols: string[];
    entrySide: 'buy' | 'sell';
    includeLiveBroker?: boolean;
  }) => Promise<DeltaActiveProtectionOrdersLike>;
  unwrapOrderPlacementResponse: (response: unknown) => Record<string, unknown>;
  allowTerminalReplacementRetry?: boolean;
  replacementRetryReason?: string | null;
  replacementIdempotencySuffix?: string | null;
  markProtectionAttached: (
    trade: SuggestedTradeProtectionTradeLike,
    execution: SuggestedTradeExecutionLink,
    nowIso: string,
    note: string,
    planUpdate: Record<string, unknown>,
    attempted?: boolean
  ) => SuggestedTradeExecutionLink;
  markProtectionAttaching: (
    trade: SuggestedTradeProtectionTradeLike,
    execution: SuggestedTradeExecutionLink,
    nowIso: string,
    note: string,
    planUpdate: Record<string, unknown>,
    attempted?: boolean
  ) => SuggestedTradeExecutionLink;
  markProtectionManualUnlinked: (
    execution: SuggestedTradeExecutionLink,
    nowIso: string,
    message: string
  ) => SuggestedTradeExecutionLink;
  markProtectionFailed: (
    execution: SuggestedTradeExecutionLink,
    nowIso: string,
    message: string
  ) => SuggestedTradeExecutionLink;
}

const readRecordValue = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const readStringValue = (value: unknown): string | null => {
  if (value === null || value === undefined) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized || null;
};

const readNumberValue = (value: unknown): number | null => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const formatNumericString = (value: number | null | undefined): string | null =>
  value !== null && value !== undefined && Number.isFinite(value) ? String(value) : null;

const sanitizeIdempotencySegment = (value: unknown): string | null => {
  const normalized = readStringValue(value);
  if (!normalized) {
    return null;
  }
  return normalized.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || null;
};

const buildDeltaProtectionIdempotencyKey = (
  tradeId: string,
  orderId: string | null,
  suffix: string | null | undefined
): string => {
  const base = orderId
    ? `live-auto-protection:${tradeId}:${orderId}`
    : `live-auto-protection:${tradeId}`;
  const normalizedSuffix = sanitizeIdempotencySegment(suffix);
  return normalizedSuffix ? `${base}:${normalizedSuffix}` : base;
};

const countNumericDecimals = (value: unknown): number => {
  const raw = String(value ?? '').trim();
  if (!raw || !raw.includes('.')) {
    return 0;
  }
  const fractional = raw.split('.')[1]?.replace(/0+$/, '') ?? '';
  return fractional.length;
};

const deriveScaledProtectionPrice = (
  actualEntryPrice: number,
  requestedEntryPrice: number,
  requestedTargetPrice: number
): string => {
  const precision = Math.max(
    6,
    countNumericDecimals(requestedEntryPrice),
    countNumericDecimals(requestedTargetPrice)
  );
  return Number(
    ((actualEntryPrice * requestedTargetPrice) / requestedEntryPrice).toFixed(precision)
  ).toFixed(precision);
};

export function isDeltaExchangeSuggestedTradeBroker(brokerKey: string | null | undefined): boolean {
  return (
    String(brokerKey || '')
      .trim()
      .toLowerCase() === DELTA_EXCHANGE_BROKER_KEY
  );
}

export function resolveDeltaExchangeSuggestedTradeLiveAutoEnabled(
  liveAutoEnabled: boolean,
  readBooleanEnvOverride: BooleanEnvReader
): boolean {
  return (
    readBooleanEnvOverride(DELTA_EXCHANGE_LIVE_AUTO_ENV) ??
    (process.env[DELTA_EXCHANGE_LIVE_AUTO_ENV] !== undefined
      ? env.suggestedTrades.liveAuto.deltaExchangeEnabled
      : liveAutoEnabled) ??
    liveAutoEnabled
  );
}

export function resolveDeltaExchangeSuggestedTradeProtectionRepairEnabled(
  readBooleanEnvOverride: BooleanEnvReader
): boolean {
  return (
    readBooleanEnvOverride(DELTA_EXCHANGE_PROTECTION_REPAIR_ENV) ??
    env.suggestedTrades.protectionRepair?.deltaExchangeEnabled ??
    true
  );
}

export function resolveDeltaProtectionLookupSymbols(
  trade: SuggestedTradeSymbolSideLike,
  position: LivePositionSnapshotLike
): string[] {
  const payload = position.payload ?? {};
  return [
    trade.symbol,
    readStringValue(payload.product_symbol),
    readStringValue(payload.symbol),
    readStringValue(payload.contract_symbol),
    readStringValue(readRecordValue(payload.product)?.symbol),
  ].filter((value): value is string => Boolean(value));
}

export function describeLiveProtectionOrderContext(
  context: LiveProtectionOrderContextLike
): string {
  const stopLoss = context.stopLossOrderId
    ? `SL ${context.stopLossOrderId} ${context.stopLossStatus ?? 'missing_snapshot'}`
    : 'SL missing';
  const takeProfit = context.takeProfitOrderId
    ? `TP ${context.takeProfitOrderId} ${context.takeProfitStatus ?? 'missing_snapshot'}`
    : 'TP missing';
  return `${stopLoss}, ${takeProfit}`;
}

export function hasExactlyOneDeltaProtectionPair(
  context: DeltaActiveProtectionOrdersLike
): boolean {
  return (
    context.activeOrderIds.length === 2 &&
    context.stopLossOrderIds.length === 1 &&
    context.takeProfitOrderIds.length === 1 &&
    context.unclassifiedOrderIds.length === 0
  );
}

export function describeDeltaActiveProtectionOrders(
  context: DeltaActiveProtectionOrdersLike
): string {
  const parts = [
    context.stopLossOrderIds.length ? `SL ${context.stopLossOrderIds.join(',')}` : 'SL missing',
    context.takeProfitOrderIds.length ? `TP ${context.takeProfitOrderIds.join(',')}` : 'TP missing',
    context.unclassifiedOrderIds.length ? `other ${context.unclassifiedOrderIds.join(',')}` : null,
  ].filter((value): value is string => Boolean(value));
  return parts.join('; ');
}

export function isDeltaProtectionDirectionValid(
  entrySide: 'buy' | 'sell',
  entryPrice: number,
  stopLossPrice: number,
  takeProfitPrice: number
): boolean {
  if (!(entryPrice > 0 && stopLossPrice > 0 && takeProfitPrice > 0)) {
    return false;
  }
  if (entrySide === 'buy') {
    return stopLossPrice < entryPrice && takeProfitPrice > entryPrice;
  }
  return stopLossPrice > entryPrice && takeProfitPrice < entryPrice;
}

function isDeltaProtectionPlacementSafe(
  entrySide: 'buy' | 'sell',
  entryPrice: number,
  stopLossPrice: number,
  takeProfitPrice: number,
  currentPrice: number | null
): boolean {
  if (currentPrice && currentPrice > 0) {
    return entrySide === 'buy'
      ? stopLossPrice < currentPrice && takeProfitPrice > currentPrice
      : stopLossPrice > currentPrice && takeProfitPrice < currentPrice;
  }
  return isDeltaProtectionDirectionValid(entrySide, entryPrice, stopLossPrice, takeProfitPrice);
}

export function resolveDeltaInactiveAttachedProtectionManualReason(input: {
  entrySide: 'buy' | 'sell';
  actualEntryPrice: number | null;
  requestedEntryPrice: number | null;
  stopLossPrice: number;
  takeProfitPrice: number;
  currentPrice: number | null;
}): string | null {
  const actualEntryPrice = input.actualEntryPrice;
  const requestedEntryPrice = input.requestedEntryPrice ?? actualEntryPrice;
  if (
    !(actualEntryPrice && actualEntryPrice > 0) ||
    !(requestedEntryPrice && requestedEntryPrice > 0)
  ) {
    return null;
  }

  const stopLossPrice = Number(
    deriveScaledProtectionPrice(actualEntryPrice, requestedEntryPrice, input.stopLossPrice)
  );
  const takeProfitPrice = Number(
    deriveScaledProtectionPrice(actualEntryPrice, requestedEntryPrice, input.takeProfitPrice)
  );
  const currentPrice = input.currentPrice;
  if (currentPrice && currentPrice > 0) {
    if (input.entrySide === 'buy' && currentPrice <= stopLossPrice) {
      return `Delta Exchange attached protection is inactive and planned stop-loss ${formatNumericString(stopLossPrice) || stopLossPrice} is already crossed for current price ${formatNumericString(currentPrice) || currentPrice}; manual action is required.`;
    }
    if (input.entrySide === 'sell' && currentPrice >= stopLossPrice) {
      return `Delta Exchange attached protection is inactive and planned stop-loss ${formatNumericString(stopLossPrice) || stopLossPrice} is already crossed for current price ${formatNumericString(currentPrice) || currentPrice}; manual action is required.`;
    }
    if (input.entrySide === 'buy' && currentPrice >= takeProfitPrice) {
      return `Delta Exchange attached protection is inactive and planned take-profit ${formatNumericString(takeProfitPrice) || takeProfitPrice} is already crossed for current price ${formatNumericString(currentPrice) || currentPrice}; manual action is required.`;
    }
    if (input.entrySide === 'sell' && currentPrice <= takeProfitPrice) {
      return `Delta Exchange attached protection is inactive and planned take-profit ${formatNumericString(takeProfitPrice) || takeProfitPrice} is already crossed for current price ${formatNumericString(currentPrice) || currentPrice}; manual action is required.`;
    }
  }
  if (
    !isDeltaProtectionPlacementSafe(
      input.entrySide,
      actualEntryPrice,
      stopLossPrice,
      takeProfitPrice,
      currentPrice
    )
  ) {
    return `Delta Exchange attached protection is inactive and stored protection prices are invalid for the filled ${input.entrySide} position; manual SL/TP action is required.`;
  }

  return null;
}

function shouldCloseDeltaPositionForManualReason(message: string | null): boolean {
  const normalized = String(message || '').toLowerCase();
  return normalized.includes('already crossed');
}

export function resolveDeltaProtectionPartialExecutionReason(
  context: LiveProtectionOrderContextLike
): string | null {
  const details = context.orderDetails ?? {};
  const linkedOrderIds = [
    { kind: 'stop-loss', id: context.stopLossOrderId },
    { kind: 'take-profit', id: context.takeProfitOrderId },
  ].filter((item): item is { kind: string; id: string } => Boolean(item.id));

  const partialOrders = linkedOrderIds.filter((item) => {
    const detail = details[item.id];
    if (!detail) {
      return false;
    }
    const normalizedStatus = String(detail.status || '')
      .trim()
      .toUpperCase();
    const quantity = readNumberValue(detail.quantity);
    const filledQuantity = readNumberValue(detail.filledQuantity);
    const remainingQuantity = readNumberValue(detail.remainingQuantity);
    return (
      normalizedStatus === 'PARTIALLY_FILLED' ||
      Boolean(
        filledQuantity &&
        filledQuantity > 0 &&
        ((remainingQuantity && remainingQuantity > 0) || (quantity && quantity > filledQuantity))
      )
    );
  });

  if (!partialOrders.length) {
    return null;
  }

  return `Delta Exchange reduce-only protection partially executed (${partialOrders
    .map((item) => `${item.kind} ${item.id}`)
    .join(', ')}); the remaining position must be closed immediately.`;
}

function isAlreadyTerminalCancelError(message: string): boolean {
  const normalized = String(message || '').toLowerCase();
  return (
    normalized.includes('terminal state') ||
    normalized.includes('too late to cancel') ||
    normalized.includes('not found') ||
    normalized.includes('does not exist') ||
    normalized.includes('already cancelled') ||
    normalized.includes('already canceled') ||
    normalized.includes('already closed')
  );
}

function isPartialEntryRemainderCleared(execution: SuggestedTradeExecutionLink): boolean {
  const orderStatus = String(execution.orderStatus || '')
    .trim()
    .toUpperCase();
  const filledQuantity = readNumberValue(execution.filledQuantity);
  const remainingQuantity = readNumberValue(execution.remainingQuantity);
  return Boolean(
    (orderStatus === 'PARTIALLY_FILLED' || (filledQuantity && filledQuantity > 0)) &&
    remainingQuantity !== null &&
    remainingQuantity <= 0 &&
    execution.canceledAt
  );
}

function resolveDeltaOpenPositionSize(
  position: LivePositionSnapshotLike,
  execution: SuggestedTradeExecutionLink
): number | null {
  const payload = position.payload ?? {};
  return (
    readNumberValue(payload.quantity_contracts) ??
    readNumberValue(payload.quantityContracts) ??
    readNumberValue(payload.size) ??
    readNumberValue(payload.quantity) ??
    readNumberValue(execution.filledQuantity)
  );
}

function resolveDeltaProtectionSizeMismatch(input: {
  context: LiveProtectionOrderContextLike;
  position: LivePositionSnapshotLike;
  execution: SuggestedTradeExecutionLink;
}): { reason: string; orderIds: string[]; positionSize: number } | null {
  const positionSize = resolveDeltaOpenPositionSize(input.position, input.execution);
  if (!(positionSize && positionSize > 0)) {
    return null;
  }

  const mismatches: string[] = [];
  for (const [label, orderId] of [
    ['stop-loss', input.context.stopLossOrderId],
    ['take-profit', input.context.takeProfitOrderId],
  ] as const) {
    if (!orderId || !input.context.activeOrderIds.includes(orderId)) {
      continue;
    }
    const orderSize = readNumberValue(input.context.orderDetails?.[orderId]?.quantity);
    if (!(orderSize && orderSize > 0)) {
      continue;
    }
    const drift = Math.abs(orderSize - positionSize) / Math.max(positionSize, 1e-9);
    if (drift > 0.01) {
      mismatches.push(`${label} ${orderId} size ${formatNumericString(orderSize) ?? orderSize}`);
    }
  }

  if (!mismatches.length) {
    return null;
  }

  const orderIds = [input.context.stopLossOrderId, input.context.takeProfitOrderId].filter(
    (orderId): orderId is string =>
      Boolean(orderId && input.context.activeOrderIds.includes(orderId))
  );
  return {
    orderIds,
    positionSize,
    reason: `Delta Exchange linked protection size ${mismatches.join(
      ', '
    )} does not match current partial-fill position size ${
      formatNumericString(positionSize) ?? positionSize
    }.`,
  };
}

async function cancelDeltaProtectionOrdersForReplacement(input: {
  ordersAdapter: DeltaProtectionOrdersAdapter;
  orderIds: string[];
  userId: string;
  brokerKey: string;
  accountId: string;
}): Promise<{
  requestedOrderIds: string[];
  cancelledOrderIds: string[];
  alreadyTerminalOrderIds: string[];
  failedMessages: string[];
}> {
  const requestedOrderIds = Array.from(new Set(input.orderIds.filter(Boolean)));
  const cancelledOrderIds: string[] = [];
  const alreadyTerminalOrderIds: string[] = [];
  const failedMessages: string[] = [];

  for (const orderId of requestedOrderIds) {
    try {
      await input.ordersAdapter.cancelOrder?.(orderId, {
        userId: input.userId,
        brokerKey: input.brokerKey,
        accountId: input.accountId,
      });
      cancelledOrderIds.push(orderId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isAlreadyTerminalCancelError(message)) {
        alreadyTerminalOrderIds.push(orderId);
        continue;
      }
      failedMessages.push(`${orderId}: ${message}`);
    }
  }

  return {
    requestedOrderIds,
    cancelledOrderIds,
    alreadyTerminalOrderIds,
    failedMessages,
  };
}

function filterDeltaActiveProtectionOrders(
  input: DeltaActiveProtectionOrdersLike,
  ignoredOrderIds: Set<string>
): DeltaActiveProtectionOrdersLike {
  if (!ignoredOrderIds.size) {
    return input;
  }
  const filterIds = (values: string[]) => values.filter((orderId) => !ignoredOrderIds.has(orderId));
  return {
    stopLossOrderIds: filterIds(input.stopLossOrderIds),
    takeProfitOrderIds: filterIds(input.takeProfitOrderIds),
    unclassifiedOrderIds: filterIds(input.unclassifiedOrderIds),
    activeOrderIds: filterIds(input.activeOrderIds),
    orderDetails: Object.fromEntries(
      Object.entries(input.orderDetails ?? {}).filter(([orderId]) => !ignoredOrderIds.has(orderId))
    ),
  };
}

function resolveDeltaPositionCloseId(
  position: LivePositionSnapshotLike & { externalId?: unknown }
): string | null {
  const payload = position.payload ?? {};
  return (
    readStringValue(position.externalId) ??
    readStringValue(payload.id) ??
    readStringValue(payload.position_id) ??
    readStringValue(payload.positionId) ??
    readStringValue(payload.product_id) ??
    readStringValue(payload.asset_uuid)
  );
}

export async function closeDeltaPositionForUnsafeProtection(input: {
  positionsAdapter: DeltaProtectionPositionsAdapter | null | undefined;
  position: LivePositionSnapshotLike & { externalId?: unknown };
  userId: string;
  brokerKey: string;
  accountId: string;
  issueMessage: string;
}): Promise<{ closed: boolean; note: string; positionId: string | null }> {
  const positionId = resolveDeltaPositionCloseId(input.position);
  if (!positionId) {
    return {
      closed: false,
      positionId: null,
      note: `${input.issueMessage} Delta position id is unavailable; position still needs urgent manual close.`,
    };
  }

  if (!input.positionsAdapter?.closePosition) {
    return {
      closed: false,
      positionId,
      note: `${input.issueMessage} Delta close-position adapter is unavailable; position still needs urgent manual close.`,
    };
  }

  try {
    await input.positionsAdapter.closePosition(positionId, {
      userId: input.userId,
      brokerKey: input.brokerKey,
      accountId: input.accountId,
    });
    return {
      closed: true,
      positionId,
      note: `${input.issueMessage} Delta position was closed immediately because protection was already unsafe before SL/TP could attach.`,
    };
  } catch (error) {
    return {
      closed: false,
      positionId,
      note: `${input.issueMessage} Delta immediate close failed: ${
        error instanceof Error ? error.message : String(error)
      }.`,
    };
  }
}

function appendProtectionNote(existing: unknown, next: string): string {
  const current = readStringValue(existing);
  return current ? `${current} ${next}` : next;
}

export async function normalizeDeltaLiveAutoOrderSizing(
  input: DeltaLiveAutoOrderSizingInput
): Promise<DeltaLiveAutoOrderSizingResult> {
  if (!input.adapter?.preflightLiveAutoOrder) {
    throw new BadRequestAppError(
      'Delta Exchange product-rule preflight is unavailable for live-auto placement.'
    );
  }

  const preflight = await input.adapter.preflightLiveAutoOrder(input.assetId, {
    symbol: input.brokerSymbol,
    quantity: input.quantity,
    entryPrice: input.entryPrice,
    stopLossPrice: input.stopLossPrice,
    takeProfitPrice: input.takeProfitPrice,
    side: input.side,
  });
  const contracts = readNumberValue(preflight?.quantityContracts);
  if (!(contracts && Number.isInteger(contracts) && contracts > 0)) {
    throw new BadRequestAppError(
      `Delta Exchange product-rule preflight did not return a valid integer contract size for ${input.brokerSymbol}.`
    );
  }

  return {
    quantity: input.quantity,
    entryPrice: input.entryPrice,
    stopLossPrice: input.stopLossPrice,
    takeProfitPrice: input.takeProfitPrice,
    auditNote:
      readStringValue(preflight?.auditNote) ??
      `Delta product preflight passed for ${input.brokerSymbol}: ${contracts} contract${
        contracts === 1 ? '' : 's'
      }.`,
  };
}

export async function remediateDeltaLiveProtection(
  input: DeltaLiveProtectionRepairInput
): Promise<SuggestedTradeExecutionLink> {
  const orderId = readStringValue(input.execution.orderId);
  let replacementCleanup: {
    reason: string;
    requestedOrderIds: string[];
    cancelledOrderIds: string[];
    alreadyTerminalOrderIds: string[];
  } | null = null;
  if (orderId) {
    const existingProtection = await input.resolveLiveProtectionOrderContext(
      input.userId,
      input.trade.id,
      input.brokerKey,
      input.accountId,
      orderId
    );
    const partialExecutionReason = resolveDeltaProtectionPartialExecutionReason(existingProtection);
    if (partialExecutionReason) {
      const closeResult = await closeDeltaPositionForUnsafeProtection({
        positionsAdapter: input.positionsAdapter,
        position: input.position,
        userId: input.userId,
        brokerKey: input.brokerKey,
        accountId: input.accountId,
        issueMessage: partialExecutionReason,
      });
      if (closeResult.closed) {
        return {
          ...input.execution,
          executionState: 'closed',
          positionId: closeResult.positionId ?? readStringValue(input.position.externalId),
          positionStatus: 'CLOSED',
          positionClosedAt: input.nowIso,
          protectionState: 'not_required',
          protectionCheckedAt: input.nowIso,
          protectionAttachedAt: null,
          protectionLastError: null,
          protectionPlan: {
            ...(input.execution.protectionPlan ?? {}),
            positionId: closeResult.positionId ?? readStringValue(input.position.externalId),
            autoClosedAt: input.nowIso,
            autoCloseReason: 'partial_protection_execution',
          },
          note: appendProtectionNote(input.execution.note, closeResult.note),
        };
      }
      return input.markProtectionFailed(input.execution, input.nowIso, closeResult.note);
    }
    if (input.hasUsableProtectionContext(existingProtection)) {
      return input.markProtectionAttached(
        input.trade,
        input.execution,
        input.nowIso,
        'Delta Exchange native SL/TP protection is already linked to the execution.',
        {
          positionId: input.position.externalId,
          stopLossOrderId: existingProtection.stopLossOrderId,
          takeProfitOrderId: existingProtection.takeProfitOrderId,
        }
      );
    }
    const partialFillSizeMismatch = isPartialEntryRemainderCleared(input.execution)
      ? resolveDeltaProtectionSizeMismatch({
          context: existingProtection,
          position: input.position,
          execution: input.execution,
        })
      : null;
    if (partialFillSizeMismatch) {
      if (!input.protectionRepairEnabled) {
        return input.markProtectionManualUnlinked(
          input.execution,
          input.nowIso,
          `${partialFillSizeMismatch.reason} Automatic Delta protection replacement is disabled; manual cleanup is required.`
        );
      }
      if (!input.ordersAdapter?.cancelOrder) {
        return input.markProtectionManualUnlinked(
          input.execution,
          input.nowIso,
          `${partialFillSizeMismatch.reason} Delta protection cancellation is unavailable; manual cleanup is required before replacement.`
        );
      }
      const cleanup = await cancelDeltaProtectionOrdersForReplacement({
        ordersAdapter: input.ordersAdapter,
        orderIds: partialFillSizeMismatch.orderIds,
        userId: input.userId,
        brokerKey: input.brokerKey,
        accountId: input.accountId,
      });
      if (cleanup.failedMessages.length) {
        return input.markProtectionFailed(
          input.execution,
          input.nowIso,
          `${partialFillSizeMismatch.reason} Existing oversized protection could not be fully cancelled before replacement: ${cleanup.failedMessages.join(
            '; '
          )}.`
        );
      }
      replacementCleanup = {
        reason: partialFillSizeMismatch.reason,
        requestedOrderIds: cleanup.requestedOrderIds,
        cancelledOrderIds: cleanup.cancelledOrderIds,
        alreadyTerminalOrderIds: cleanup.alreadyTerminalOrderIds,
      };
    }
    if (
      !replacementCleanup &&
      input.execution.protectionState === 'attaching' &&
      (existingProtection.stopLossOrderId || existingProtection.takeProfitOrderId)
    ) {
      const hasTerminalSnapshot = [
        existingProtection.stopLossStatus,
        existingProtection.takeProfitStatus,
      ]
        .filter((status): status is string => Boolean(status))
        .some((status) => ['CANCELLED', 'REJECTED', 'EXPIRED', 'FAILED'].includes(status));
      if (hasTerminalSnapshot) {
        if (!input.allowTerminalReplacementRetry) {
          return input.markProtectionFailed(
            input.execution,
            input.nowIso,
            `Delta Exchange replacement protection is inactive after submission (${describeLiveProtectionOrderContext(
              existingProtection
            )}); replacement protection still needs operator review.`
          );
        }
        const alreadyTerminalOrderIds = [
          existingProtection.stopLossOrderId,
          existingProtection.takeProfitOrderId,
        ].filter((value): value is string => Boolean(value));
        replacementCleanup = {
          reason:
            input.replacementRetryReason ??
            `Delta Exchange terminal replacement protection is being retried after read-back (${describeLiveProtectionOrderContext(
              existingProtection
            )}).`,
          requestedOrderIds: alreadyTerminalOrderIds,
          cancelledOrderIds: [],
          alreadyTerminalOrderIds,
        };
      }
      if (!replacementCleanup) {
        return {
          ...input.execution,
          protectionCheckedAt: input.nowIso,
          protectionLastError: `Delta Exchange replacement protection submitted; waiting for active SL/TP snapshots (${describeLiveProtectionOrderContext(
            existingProtection
          )}).`,
        };
      }
    } else if (
      input.allowTerminalReplacementRetry &&
      !replacementCleanup &&
      (existingProtection.stopLossOrderId || existingProtection.takeProfitOrderId)
    ) {
      replacementCleanup = {
        reason:
          input.replacementRetryReason ??
          `Delta Exchange replacement protection is being retried after stale read-back (${describeLiveProtectionOrderContext(
            existingProtection
          )}).`,
        requestedOrderIds: [
          existingProtection.stopLossOrderId,
          existingProtection.takeProfitOrderId,
        ].filter((value): value is string => Boolean(value)),
        cancelledOrderIds: [],
        alreadyTerminalOrderIds: [
          existingProtection.stopLossOrderId,
          existingProtection.takeProfitOrderId,
        ].filter((value): value is string => Boolean(value)),
      };
    }
    if (
      !replacementCleanup &&
      input.execution.protectionState === 'attaching' &&
      (existingProtection.stopLossOrderId || existingProtection.takeProfitOrderId)
    ) {
      return {
        ...input.execution,
        protectionCheckedAt: input.nowIso,
        protectionLastError: `Delta Exchange replacement protection submitted; waiting for active SL/TP snapshots (${describeLiveProtectionOrderContext(
          existingProtection
        )}).`,
      };
    }
  }

  if (!input.ordersAdapter?.createLiveAutoProtectiveOrdersForPosition) {
    return input.markProtectionFailed(
      input.execution,
      input.nowIso,
      'Delta Exchange post-fill protection placement is unavailable in the orders adapter.'
    );
  }

  const positionPayload = input.position.payload ?? {};
  const actualEntryPrice = input.resolvePositionEntryPrice(positionPayload, input.execution);
  const size =
    readNumberValue(positionPayload.quantity_contracts) ??
    readNumberValue(positionPayload.size) ??
    readNumberValue(input.execution.filledQuantity) ??
    readNumberValue(input.execution.quantity);
  if (!(actualEntryPrice && actualEntryPrice > 0) || !(size && size > 0)) {
    return {
      ...input.execution,
      protectionState: 'waiting_for_position',
      protectionCheckedAt: input.nowIso,
      protectionLastError:
        'Delta Exchange position snapshot did not include a usable entry price and contract size yet.',
    };
  }

  const requestedEntryPrice = input.prices.requestedEntryPrice ?? actualEntryPrice;
  const stopLossPrice = Number(
    input.deriveScaledProtectionPrice(
      actualEntryPrice,
      requestedEntryPrice,
      input.prices.stopLossPrice
    )
  );
  const takeProfitPrice = Number(
    input.deriveScaledProtectionPrice(
      actualEntryPrice,
      requestedEntryPrice,
      input.prices.takeProfitPrice
    )
  );
  const entrySide = String(input.trade.side || '').toUpperCase() === 'SELL' ? 'sell' : 'buy';
  const currentPrice = input.resolvePositionCurrentPrice(positionPayload);
  const manualReason = resolveDeltaInactiveAttachedProtectionManualReason({
    entrySide,
    actualEntryPrice,
    requestedEntryPrice: input.prices.requestedEntryPrice,
    stopLossPrice: input.prices.stopLossPrice,
    takeProfitPrice: input.prices.takeProfitPrice,
    currentPrice,
  });
  if (manualReason) {
    if (shouldCloseDeltaPositionForManualReason(manualReason)) {
      const closeResult = await closeDeltaPositionForUnsafeProtection({
        positionsAdapter: input.positionsAdapter,
        position: input.position,
        userId: input.userId,
        brokerKey: input.brokerKey,
        accountId: input.accountId,
        issueMessage: manualReason,
      });
      if (closeResult.closed) {
        return {
          ...input.execution,
          executionState: 'closed',
          positionId: closeResult.positionId ?? readStringValue(input.position.externalId),
          positionStatus: 'CLOSED',
          positionClosedAt: input.nowIso,
          protectionState: 'not_required',
          protectionCheckedAt: input.nowIso,
          protectionAttachedAt: null,
          protectionLastError: null,
          protectionPlan: {
            ...(input.execution.protectionPlan ?? {}),
            positionId: closeResult.positionId ?? readStringValue(input.position.externalId),
            autoClosedAt: input.nowIso,
            autoCloseReason: 'unsafe_protection_already_crossed',
            stopLossPrice,
            takeProfitPrice,
          },
          note: appendProtectionNote(input.execution.note, closeResult.note),
        };
      }
      return input.markProtectionFailed(input.execution, input.nowIso, closeResult.note);
    }
    return input.markProtectionManualUnlinked(input.execution, input.nowIso, manualReason);
  }
  if (
    !isDeltaProtectionPlacementSafe(
      entrySide,
      actualEntryPrice,
      stopLossPrice,
      takeProfitPrice,
      currentPrice
    )
  ) {
    return input.markProtectionFailed(
      input.execution,
      input.nowIso,
      `Delta Exchange protection prices are invalid for the filled ${entrySide} position.`
    );
  }

  try {
    const route = await input.resolveLiveAutoAssetRoute(input.brokerKey, input.trade.symbol);
    const ignoredReplacementOrderIds = new Set([
      ...(replacementCleanup?.cancelledOrderIds ?? []),
      ...(replacementCleanup?.alreadyTerminalOrderIds ?? []),
    ]);
    const existingSymbolProtection = filterDeltaActiveProtectionOrders(
      await input.resolveActiveProtectionOrdersForSymbol({
        userId: input.userId,
        brokerKey: input.brokerKey,
        accountId: input.accountId,
        symbols: [route.brokerSymbol, input.trade.symbol, ...route.candidateSymbols],
        entrySide,
        includeLiveBroker: true,
      }),
      ignoredReplacementOrderIds
    );
    if (existingSymbolProtection.activeOrderIds.length > 0) {
      if (hasExactlyOneDeltaProtectionPair(existingSymbolProtection)) {
        const existingSymbolPair = {
          stopLossOrderId: existingSymbolProtection.stopLossOrderIds[0] ?? null,
          takeProfitOrderId: existingSymbolProtection.takeProfitOrderIds[0] ?? null,
          stopLossStatus: null,
          takeProfitStatus: null,
          activeOrderIds: existingSymbolProtection.activeOrderIds,
          orderDetails: existingSymbolProtection.orderDetails,
        };
        if (!input.hasUsableProtectionContext(existingSymbolPair)) {
          return input.markProtectionManualUnlinked(
            input.execution,
            input.nowIso,
            `Delta Exchange active reduce-only SL/TP protection exists for ${route.brokerSymbol}, but it does not match the current open position size; manual cleanup is required before auto repair can safely create replacements.`
          );
        }
        return input.markProtectionAttached(
          input.trade,
          input.execution,
          input.nowIso,
          'Delta Exchange active reduce-only SL/TP protection already exists for this symbol; linked existing broker orders instead of creating replacements.',
          {
            positionId: input.position.externalId,
            stopLossOrderId: existingSymbolProtection.stopLossOrderIds[0],
            takeProfitOrderId: existingSymbolProtection.takeProfitOrderIds[0],
          }
        );
      }

      return input.markProtectionManualUnlinked(
        input.execution,
        input.nowIso,
        `Delta Exchange active reduce-only protection orders already exist for ${route.brokerSymbol} (${describeDeltaActiveProtectionOrders(existingSymbolProtection)}); manual cleanup is required before auto repair can safely create replacements.`
      );
    }

    if (!input.protectionRepairEnabled) {
      return input.markProtectionManualUnlinked(
        input.execution,
        input.nowIso,
        'Delta Exchange automatic SL/TP protection repair is disabled by broker-specific control.'
      );
    }

    const response = await input.ordersAdapter.createLiveAutoProtectiveOrdersForPosition(
      route.assetId,
      {
        size: Math.abs(size),
        entrySide,
        stopLossPrice,
        takeProfitPrice,
        deltaProtectionMode: readStringValue(
          readRecordValue(input.execution.protectionPlan)?.protectionMode
        ),
        idempotencyKey: buildDeltaProtectionIdempotencyKey(
          input.trade.id,
          orderId,
          input.replacementIdempotencySuffix
        ),
      },
      {
        userId: input.userId,
        brokerKey: input.brokerKey,
        accountId: input.accountId,
      }
    );
    const payload = input.unwrapOrderPlacementResponse(response);
    const protectionMode =
      readStringValue(payload.protection_mode) ?? readStringValue(payload.delta_protection_mode);
    const replacementPlanUpdate = replacementCleanup
      ? {
          replacedProtectionReason: replacementCleanup.reason,
          replacedProtectionOrderIds: replacementCleanup.requestedOrderIds,
          replacedProtectionCancelledOrderIds: replacementCleanup.cancelledOrderIds,
          replacedProtectionAlreadyTerminalOrderIds: replacementCleanup.alreadyTerminalOrderIds,
          replacedProtectionAt: input.nowIso,
          ...(input.allowTerminalReplacementRetry
            ? {
                forcedReplacementRetry: true,
                forcedReplacementRetryReason: input.replacementRetryReason ?? null,
                forcedReplacementRetryIdempotencySuffix:
                  sanitizeIdempotencySegment(input.replacementIdempotencySuffix) ?? null,
              }
            : {}),
        }
      : {};
    if (protectionMode === 'native_bracket') {
      return input.markProtectionAttaching(
        input.trade,
        input.execution,
        input.nowIso,
        'Delta Exchange native bracket protection submitted after fill; waiting for active bracket snapshots before marking attached.',
        {
          positionId: input.position.externalId,
          protectionMode,
          bracketStatus: readStringValue(payload.bracket_status) ?? 'submitted',
          attachedStopLossPrice: stopLossPrice,
          attachedTakeProfitPrice: takeProfitPrice,
          bracketStopLossPrice: readStringValue(payload.bracket_stop_loss_price) ?? stopLossPrice,
          bracketTakeProfitPrice:
            readStringValue(payload.bracket_take_profit_price) ?? takeProfitPrice,
          ...replacementPlanUpdate,
        },
        true
      );
    }
    const stopLossOrderId = readStringValue(payload.stop_loss_order_id);
    const takeProfitOrderId = readStringValue(payload.take_profit_order_id);
    if (!stopLossOrderId || !takeProfitOrderId) {
      return input.markProtectionFailed(
        input.execution,
        input.nowIso,
        'Delta Exchange protection remediation did not return both replacement SL/TP order ids.'
      );
    }
    return input.markProtectionAttaching(
      input.trade,
      input.execution,
      input.nowIso,
      `Delta Exchange replacement SL/TP submitted after fill (SL ${stopLossOrderId}, TP ${takeProfitOrderId}); waiting for active order snapshots before marking attached.`,
      {
        positionId: input.position.externalId,
        attachedStopLossPrice: stopLossPrice,
        attachedTakeProfitPrice: takeProfitPrice,
        stopLossOrderId,
        takeProfitOrderId,
        ...replacementPlanUpdate,
      },
      true
    );
  } catch (error) {
    return input.markProtectionFailed(
      input.execution,
      input.nowIso,
      `Delta Exchange protection remediation failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}
