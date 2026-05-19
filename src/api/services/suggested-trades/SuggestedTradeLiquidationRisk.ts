export type SuggestedTradeLiquidationRiskSide = 'long' | 'short';

export type SuggestedTradeLiquidationRiskStatus =
  | 'safe'
  | 'near_liquidation'
  | 'beyond_liquidation'
  | 'unknown';

export type SuggestedTradeLiquidationRiskSource =
  | 'actual_liquidation'
  | 'estimated_from_leverage'
  | 'none';

export interface SuggestedTradeLiquidationRiskInput {
  symbol?: string | null;
  side?: unknown;
  entryPrice?: unknown;
  stopLossPrice?: unknown;
  liquidationPrice?: unknown;
  leverage?: unknown;
  maxSafeStopDistanceRatio?: number | null;
}

export interface SuggestedTradeLiquidationRiskEvaluation {
  status: SuggestedTradeLiquidationRiskStatus;
  source: SuggestedTradeLiquidationRiskSource;
  symbol: string | null;
  side: SuggestedTradeLiquidationRiskSide | null;
  entryPrice: number | null;
  stopLossPrice: number | null;
  liquidationPrice: number | null;
  estimatedLiquidationPrice: number | null;
  leverage: number | null;
  stopDistance: number | null;
  liquidationDistance: number | null;
  maxSafeStopDistance: number | null;
  maxSafeStopDistanceRatio: number;
  stopDistancePct: number | null;
  maxSafeStopDistancePct: number | null;
  reason: string;
}

export const DEFAULT_SUGGESTED_TRADE_LIQUIDATION_RISK_STOP_DISTANCE_RATIO = 0.9;

export function evaluateSuggestedTradeLiquidationRisk(
  input: SuggestedTradeLiquidationRiskInput
): SuggestedTradeLiquidationRiskEvaluation {
  const symbol = normalizeSymbol(input.symbol);
  const side = normalizeLiquidationRiskSide(input.side);
  const entryPrice = readPositiveNumber(input.entryPrice);
  const stopLossPrice = readPositiveNumber(input.stopLossPrice);
  const liquidationPrice = readPositiveNumber(input.liquidationPrice);
  const leverage = readPositiveNumber(input.leverage);
  const maxSafeStopDistanceRatio = normalizeMaxSafeStopDistanceRatio(
    input.maxSafeStopDistanceRatio
  );

  const base = {
    symbol,
    side,
    entryPrice,
    stopLossPrice,
    liquidationPrice,
    estimatedLiquidationPrice: null,
    leverage,
    stopDistance: null,
    liquidationDistance: null,
    maxSafeStopDistance: null,
    maxSafeStopDistanceRatio,
    stopDistancePct: null,
    maxSafeStopDistancePct: null,
  } satisfies Omit<SuggestedTradeLiquidationRiskEvaluation, 'status' | 'source' | 'reason'>;

  if (!side) {
    return {
      ...base,
      status: 'unknown',
      source: 'none',
      reason: 'Liquidation risk cannot be evaluated because the trade side is missing.',
    };
  }

  if (!(stopLossPrice && stopLossPrice > 0)) {
    return {
      ...base,
      status: 'unknown',
      source: 'none',
      reason: 'Liquidation risk cannot be evaluated because the stop-loss price is missing.',
    };
  }

  if (liquidationPrice && stopLossIsBeyondLiquidation(side, stopLossPrice, liquidationPrice)) {
    return {
      ...base,
      status: 'beyond_liquidation',
      source: 'actual_liquidation',
      reason: `Stop-loss ${formatLiquidationRiskNumber(stopLossPrice)} is at or beyond liquidation ${formatLiquidationRiskNumber(liquidationPrice)}.`,
    };
  }

  if (!(entryPrice && entryPrice > 0)) {
    return {
      ...base,
      status: 'unknown',
      source: liquidationPrice ? 'actual_liquidation' : 'none',
      reason: 'Liquidation risk cannot be evaluated because the entry price is missing.',
    };
  }

  const stopDistance = side === 'long' ? entryPrice - stopLossPrice : stopLossPrice - entryPrice;
  if (!(stopDistance > 0)) {
    return {
      ...base,
      status: 'unknown',
      source: liquidationPrice ? 'actual_liquidation' : 'none',
      stopDistance,
      stopDistancePct: stopDistance / entryPrice,
      reason:
        'Liquidation risk cannot be evaluated because the stop-loss is not beyond entry risk.',
    };
  }

  const actualLiquidationDistance =
    liquidationPrice && liquidationIsOnExpectedSide(side, entryPrice, liquidationPrice)
      ? Math.abs(entryPrice - liquidationPrice)
      : null;
  const estimatedLiquidationPrice =
    actualLiquidationDistance === null && leverage
      ? estimateLiquidationPrice(side, entryPrice, leverage)
      : null;
  const estimatedLiquidationDistance =
    estimatedLiquidationPrice !== null ? Math.abs(entryPrice - estimatedLiquidationPrice) : null;
  const liquidationDistance = actualLiquidationDistance ?? estimatedLiquidationDistance;
  const source: SuggestedTradeLiquidationRiskSource =
    actualLiquidationDistance !== null
      ? 'actual_liquidation'
      : estimatedLiquidationDistance !== null
        ? 'estimated_from_leverage'
        : 'none';

  if (!(liquidationDistance && liquidationDistance > 0)) {
    return {
      ...base,
      estimatedLiquidationPrice,
      stopDistance,
      stopDistancePct: stopDistance / entryPrice,
      status: 'unknown',
      source,
      reason:
        'Liquidation risk cannot be evaluated because neither liquidation price nor leverage is usable.',
    };
  }

  const maxSafeStopDistance = liquidationDistance * maxSafeStopDistanceRatio;
  const stopDistancePct = stopDistance / entryPrice;
  const maxSafeStopDistancePct = maxSafeStopDistance / entryPrice;
  const measured = {
    ...base,
    estimatedLiquidationPrice,
    stopDistance,
    liquidationDistance,
    maxSafeStopDistance,
    stopDistancePct,
    maxSafeStopDistancePct,
  };

  if (stopDistance >= liquidationDistance) {
    return {
      ...measured,
      status: 'beyond_liquidation',
      source,
      reason: `Stop-loss ${formatLiquidationRiskNumber(stopLossPrice)} is at or beyond ${formatLiquidationRiskSource(source)} ${formatLiquidationRiskNumber(liquidationPrice ?? estimatedLiquidationPrice)}.`,
    };
  }

  if (stopDistance >= maxSafeStopDistance) {
    return {
      ...measured,
      status: 'near_liquidation',
      source,
      reason: `Stop-loss ${formatLiquidationRiskNumber(stopLossPrice)} is ${formatLiquidationRiskPercent(stopDistancePct)} from entry, above the liquidation safety limit ${formatLiquidationRiskPercent(maxSafeStopDistancePct)}.`,
    };
  }

  return {
    ...measured,
    status: 'safe',
    source,
    reason: `Stop-loss is inside the liquidation safety limit ${formatLiquidationRiskPercent(maxSafeStopDistancePct)}.`,
  };
}

export function isSuggestedTradeLiquidationRiskUnsafe(
  evaluation: SuggestedTradeLiquidationRiskEvaluation
): boolean {
  return evaluation.status === 'near_liquidation' || evaluation.status === 'beyond_liquidation';
}

export function formatLiquidationRiskNumber(value: number | null | undefined): string {
  return value !== null && value !== undefined && Number.isFinite(value)
    ? String(value)
    : 'unknown';
}

export function formatLiquidationRiskPercent(value: number | null | undefined): string {
  return value !== null && value !== undefined && Number.isFinite(value)
    ? `${(value * 100).toFixed(2)}%`
    : 'unknown';
}

function normalizeSymbol(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function normalizeLiquidationRiskSide(value: unknown): SuggestedTradeLiquidationRiskSide | null {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();
  if (['buy', 'long'].includes(normalized)) {
    return 'long';
  }
  if (['sell', 'short'].includes(normalized)) {
    return 'short';
  }
  return null;
}

function readPositiveNumber(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function normalizeMaxSafeStopDistanceRatio(value: number | null | undefined): number {
  return value && value > 0 && value <= 1
    ? value
    : DEFAULT_SUGGESTED_TRADE_LIQUIDATION_RISK_STOP_DISTANCE_RATIO;
}

function stopLossIsBeyondLiquidation(
  side: SuggestedTradeLiquidationRiskSide,
  stopLossPrice: number,
  liquidationPrice: number
): boolean {
  return side === 'long' ? stopLossPrice <= liquidationPrice : stopLossPrice >= liquidationPrice;
}

function liquidationIsOnExpectedSide(
  side: SuggestedTradeLiquidationRiskSide,
  entryPrice: number,
  liquidationPrice: number
): boolean {
  return side === 'long' ? liquidationPrice < entryPrice : liquidationPrice > entryPrice;
}

function estimateLiquidationPrice(
  side: SuggestedTradeLiquidationRiskSide,
  entryPrice: number,
  leverage: number
): number {
  return side === 'long' ? entryPrice * (1 - 1 / leverage) : entryPrice * (1 + 1 / leverage);
}

function formatLiquidationRiskSource(source: SuggestedTradeLiquidationRiskSource): string {
  return source === 'actual_liquidation' ? 'liquidation price' : 'estimated liquidation';
}
