import { env } from '../../../env';

const MUDREX_BROKER_KEY = 'mudrex';
const MUDREX_LIVE_AUTO_ENV = 'SUGGESTED_TRADES_LIVE_AUTO_MUDREX_ENABLED';
const MUDREX_PROTECTION_REPAIR_ENV = 'SUGGESTED_TRADES_PROTECTION_REPAIR_MUDREX_ENABLED';

type BooleanEnvReader = (name: string) => boolean | null;

type SuggestedTradeSideLike = {
  side?: unknown;
};

type LivePositionSnapshotLike = {
  externalId?: unknown;
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

const readNumberValue = (value: unknown): number | null => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const formatNumericString = (value: number | null | undefined): string | null =>
  value !== null && value !== undefined && Number.isFinite(value) ? String(value) : null;

export function isMudrexSuggestedTradeBroker(brokerKey: string | null | undefined): boolean {
  return (
    String(brokerKey || '')
      .trim()
      .toLowerCase() === MUDREX_BROKER_KEY
  );
}

export function resolveMudrexSuggestedTradeLiveAutoEnabled(
  liveAutoEnabled: boolean,
  readBooleanEnvOverride: BooleanEnvReader
): boolean {
  return (
    readBooleanEnvOverride(MUDREX_LIVE_AUTO_ENV) ??
    (process.env[MUDREX_LIVE_AUTO_ENV] !== undefined
      ? env.suggestedTrades.liveAuto.mudrexEnabled
      : liveAutoEnabled) ??
    liveAutoEnabled
  );
}

export function resolveMudrexSuggestedTradeProtectionRepairEnabled(
  readBooleanEnvOverride: BooleanEnvReader
): boolean {
  return (
    readBooleanEnvOverride(MUDREX_PROTECTION_REPAIR_ENV) ??
    env.suggestedTrades.protectionRepair?.mudrexEnabled ??
    true
  );
}

export function mudrexPositionHasProtection(position: Record<string, unknown>): boolean {
  const stopLossPrice = readNumberValue(
    position.stoploss_price ??
      position.stopLossPrice ??
      readRecordValue(position.stoploss)?.price ??
      readRecordValue(position.stopLoss)?.price
  );
  const takeProfitPrice = readNumberValue(
    position.takeprofit_price ??
      position.takeProfitPrice ??
      readRecordValue(position.takeprofit)?.price ??
      readRecordValue(position.takeProfit)?.price
  );
  const stopLossOrderId =
    readStringValue(position.stoploss_order_id) ??
    readStringValue(readRecordValue(position.stoploss)?.id);
  const takeProfitOrderId =
    readStringValue(position.takeprofit_order_id) ??
    readStringValue(readRecordValue(position.takeprofit)?.id);

  return Boolean(
    (stopLossPrice && stopLossPrice > 0) ||
    (takeProfitPrice && takeProfitPrice > 0) ||
    stopLossOrderId ||
    takeProfitOrderId
  );
}

export function resolveMudrexRiskOrderPositionId(
  position: LivePositionSnapshotLike,
  positionPayload: Record<string, unknown>
): string | null {
  return (
    readStringValue(positionPayload.id) ??
    readStringValue(positionPayload.position_id) ??
    readStringValue(positionPayload.positionId) ??
    readStringValue(position.externalId)
  );
}

export function validateMudrexProtectionAttachability(
  trade: SuggestedTradeSideLike,
  positionPayload: Record<string, unknown>,
  stopLossPrice: string,
  takeProfitPrice: string
): string | null {
  const side = resolveMudrexPositionEntrySide(trade, positionPayload);
  const stopLoss = readNumberValue(stopLossPrice);
  const takeProfit = readNumberValue(takeProfitPrice);
  const currentPrice =
    readNumberValue(positionPayload.current_price) ??
    readNumberValue(positionPayload.currentPrice) ??
    readNumberValue(positionPayload.mark_price) ??
    readNumberValue(positionPayload.markPrice);
  const liquidationPrice =
    readNumberValue(positionPayload.liquidation_price) ??
    readNumberValue(positionPayload.liquidationPrice);

  if (!side || !(stopLoss && stopLoss > 0) || !(takeProfit && takeProfit > 0)) {
    return null;
  }

  if (side === 'buy') {
    if (currentPrice && stopLoss >= currentPrice) {
      return `Mudrex protection needs manual action: planned stop-loss ${stopLossPrice} is already breached for current price ${formatNumericString(currentPrice) || currentPrice}.`;
    }
    if (currentPrice && takeProfit <= currentPrice) {
      return `Mudrex protection needs manual action: planned take-profit ${takeProfitPrice} is already crossed for current price ${formatNumericString(currentPrice) || currentPrice}.`;
    }
    if (liquidationPrice && stopLoss <= liquidationPrice) {
      return `Mudrex protection needs manual action: planned stop-loss ${stopLossPrice} is at or beyond liquidation price ${formatNumericString(liquidationPrice) || liquidationPrice}.`;
    }
    return null;
  }

  if (currentPrice && stopLoss <= currentPrice) {
    return `Mudrex protection needs manual action: planned stop-loss ${stopLossPrice} is already breached for current price ${formatNumericString(currentPrice) || currentPrice}.`;
  }
  if (currentPrice && takeProfit >= currentPrice) {
    return `Mudrex protection needs manual action: planned take-profit ${takeProfitPrice} is already crossed for current price ${formatNumericString(currentPrice) || currentPrice}.`;
  }
  if (liquidationPrice && stopLoss >= liquidationPrice) {
    return `Mudrex protection needs manual action: planned stop-loss ${stopLossPrice} is at or beyond liquidation price ${formatNumericString(liquidationPrice) || liquidationPrice}.`;
  }
  return null;
}

function resolveMudrexPositionEntrySide(
  trade: SuggestedTradeSideLike,
  positionPayload: Record<string, unknown>
): 'buy' | 'sell' | null {
  const payloadSide = String(
    readStringValue(positionPayload.order_type) ??
      readStringValue(positionPayload.position_type) ??
      readStringValue(positionPayload.side) ??
      ''
  )
    .trim()
    .toLowerCase();
  if (['long', 'buy'].includes(payloadSide)) {
    return 'buy';
  }
  if (['short', 'sell'].includes(payloadSide)) {
    return 'sell';
  }
  const tradeSide = String(trade.side || '')
    .trim()
    .toUpperCase();
  if (tradeSide === 'BUY') {
    return 'buy';
  }
  if (tradeSide === 'SELL') {
    return 'sell';
  }
  return null;
}
