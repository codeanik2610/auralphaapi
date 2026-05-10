import { env } from '../../../env';

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

type LiveProtectionOrderContextLike = {
  stopLossOrderId: string | null;
  takeProfitOrderId: string | null;
  stopLossStatus: string | null;
  takeProfitStatus: string | null;
  activeOrderIds: string[];
};

type DeltaActiveProtectionOrdersLike = {
  stopLossOrderIds: string[];
  takeProfitOrderIds: string[];
  unclassifiedOrderIds: string[];
  activeOrderIds: string[];
};

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

const formatNumericString = (value: number | null | undefined): string | null =>
  value !== null && value !== undefined && Number.isFinite(value) ? String(value) : null;

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
  if (
    !isDeltaProtectionDirectionValid(
      input.entrySide,
      actualEntryPrice,
      stopLossPrice,
      takeProfitPrice
    )
  ) {
    return `Delta Exchange attached protection is inactive and stored protection prices are invalid for the filled ${input.entrySide} position; manual SL/TP action is required.`;
  }

  const currentPrice = input.currentPrice;
  if (!(currentPrice && currentPrice > 0)) {
    return null;
  }
  if (input.entrySide === 'buy' && currentPrice <= stopLossPrice) {
    return `Delta Exchange attached protection is inactive and planned stop-loss ${formatNumericString(stopLossPrice) || stopLossPrice} is already crossed for current price ${formatNumericString(currentPrice) || currentPrice}; manual action is required.`;
  }
  if (input.entrySide === 'sell' && currentPrice >= stopLossPrice) {
    return `Delta Exchange attached protection is inactive and planned stop-loss ${formatNumericString(stopLossPrice) || stopLossPrice} is already crossed for current price ${formatNumericString(currentPrice) || currentPrice}; manual action is required.`;
  }

  return null;
}
