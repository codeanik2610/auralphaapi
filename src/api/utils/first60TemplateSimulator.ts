import {
  buildStrategyTemplateAutomationProfile,
  StrategyTemplateAutomationProfile,
  StrategyTradeSide,
} from './strategyTemplateAutomation';

export interface First60TemplateSimulationSignal {
  symbol: string;
  side: StrategyTradeSide | 'BUY' | 'SELL' | string;
  signalTime: Date | string | number;
  entryPrice: number | string;
  stopLossPrice?: number | string | null;
  stop_loss_price?: number | string | null;
  signalCandleLow?: number | string | null;
  signal_candle_low?: number | string | null;
  signalCandleHigh?: number | string | null;
  signal_candle_high?: number | string | null;
}

export interface First60TemplateSimulationCandle {
  symbol?: string;
  openTime?: Date | string | number;
  open_time?: Date | string | number;
  timestamp?: Date | string | number;
  time?: Date | string | number;
  open: number | string;
  high: number | string;
  low: number | string;
  close: number | string;
  volume?: number | string | null;
}

export type First60TemplateSimulationCandleSet =
  | Map<string, First60TemplateSimulationCandle[]>
  | Record<string, First60TemplateSimulationCandle[]>;

export type First60TemplateSimulationOutcome =
  | 'target'
  | 'stop'
  | 'timeout'
  | 'first60_failed'
  | 'invalid'
  | 'missing-management'
  | 'no-candles';

export interface First60TemplateSimulationOptions {
  maxHoldMinutes?: number;
  topSymbolsLimit?: number;
}

export interface First60TemplateSimulationTradeResult {
  symbol: string;
  side: StrategyTradeSide;
  signalTime: string;
  simulated: boolean;
  outcome: First60TemplateSimulationOutcome;
  first60Passed: boolean;
  entryPrice: number;
  stopLossPrice: number;
  targetPrice: number;
  riskDistance: number;
  exitTime: string | null;
  exitPrice: number | null;
  realizedR: number | null;
  targetHit: boolean;
  favorableR: number | null;
  adverseR: number | null;
  first60CloseR: number | null;
  maxAdverseRObserved: number | null;
  holdMinutes: number | null;
  reason: string | null;
}

export interface First60TemplateSimulationSymbolSummary {
  symbol: string;
  trades: number;
  passedFirst60: number;
  targetHits: number;
  totalR: number;
  avgR: number;
  targetHitRate: number;
}

export interface First60TemplateSimulationSideSummary {
  side: StrategyTradeSide;
  totalTrades: number;
  simulatedTrades: number;
  passedFirst60: number;
  failedFirst60: number;
  targetHits: number;
  stopHits: number;
  timeouts: number;
  invalidTrades: number;
  passRate: number | null;
  targetHitRate: number | null;
  targetHitRateAfterPass: number | null;
  avgR: number | null;
  totalR: number;
  avgPassedR: number | null;
  totalPassedR: number;
  maxAdverseR: number | null;
  bestSymbols: First60TemplateSimulationSymbolSummary[];
  worstSymbols: First60TemplateSimulationSymbolSummary[];
}

export interface First60TemplateSimulationReport {
  generatedAt: string;
  options: {
    maxHoldMinutes: number;
    topSymbolsLimit: number;
  };
  warnings: string[];
  sides: {
    long: First60TemplateSimulationSideSummary;
    short: First60TemplateSimulationSideSummary;
  };
  trades: First60TemplateSimulationTradeResult[];
}

interface NormalizedCandle {
  openTimeMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface First60WindowStats {
  favorableR: number;
  adverseR: number;
  closeR: number;
}

interface ExitHit {
  outcome: 'target' | 'stop';
  exitPrice: number;
  exitTimeMs: number;
}

const DEFAULT_MAX_HOLD_MINUTES = 24 * 60;
const DEFAULT_TOP_SYMBOLS_LIMIT = 5;

export const simulateFirst60TemplateConfig = (
  config: Record<string, unknown> | null | undefined,
  signals: First60TemplateSimulationSignal[],
  candlesBySymbol: First60TemplateSimulationCandleSet,
  options: First60TemplateSimulationOptions = {}
): First60TemplateSimulationReport =>
  simulateFirst60TemplateProfile(
    buildStrategyTemplateAutomationProfile(config),
    signals,
    candlesBySymbol,
    options
  );

export const simulateFirst60TemplateProfile = (
  profile: StrategyTemplateAutomationProfile,
  signals: First60TemplateSimulationSignal[],
  candlesBySymbol: First60TemplateSimulationCandleSet,
  options: First60TemplateSimulationOptions = {}
): First60TemplateSimulationReport => {
  const resolvedOptions = {
    maxHoldMinutes: Math.max(
      1,
      Math.trunc(readNumber(options.maxHoldMinutes) ?? DEFAULT_MAX_HOLD_MINUTES)
    ),
    topSymbolsLimit: Math.max(
      1,
      Math.trunc(readNumber(options.topSymbolsLimit) ?? DEFAULT_TOP_SYMBOLS_LIMIT)
    ),
  };
  const candleMap = normalizeCandlesBySymbol(candlesBySymbol);
  const trades = signals.map((signal) =>
    simulateTrade(profile, signal, candleMap, resolvedOptions.maxHoldMinutes)
  );
  const warnings = buildWarnings(profile, trades);

  return {
    generatedAt: new Date().toISOString(),
    options: resolvedOptions,
    warnings,
    sides: {
      long: summarizeSide('long', trades, resolvedOptions.topSymbolsLimit),
      short: summarizeSide('short', trades, resolvedOptions.topSymbolsLimit),
    },
    trades,
  };
};

const simulateTrade = (
  profile: StrategyTemplateAutomationProfile,
  signal: First60TemplateSimulationSignal,
  candleMap: Map<string, NormalizedCandle[]>,
  maxHoldMinutes: number
): First60TemplateSimulationTradeResult => {
  const symbol = normalizeSymbol(signal.symbol);
  const side = normalizeSide(signal.side);
  const signalTimeMs = readTimeMs(signal.signalTime);
  const entryPrice = readNumber(signal.entryPrice);
  const stopLossPrice = resolveStopLossPrice(signal, side);

  if (!symbol || !side || signalTimeMs === null || entryPrice === null || stopLossPrice === null) {
    return buildInvalidTrade(
      signal,
      side ?? 'long',
      'Signal is missing side, time, entry, or stop'
    );
  }

  const first60 = profile.tradeManagement?.first60;
  const first60Leg = first60?.enabled ? (side === 'long' ? first60.long : first60.short) : null;
  if (!first60Leg?.enabled) {
    return buildInvalidTrade(
      signal,
      side,
      'Template profile is missing enabled First60 management',
      {
        symbol,
        signalTimeMs,
        entryPrice,
        stopLossPrice,
        outcome: 'missing-management',
      }
    );
  }

  const riskDistance = side === 'long' ? entryPrice - stopLossPrice : stopLossPrice - entryPrice;
  if (!Number.isFinite(riskDistance) || riskDistance <= 0) {
    return buildInvalidTrade(signal, side, 'Stop loss is not on the risk side of entry', {
      symbol,
      signalTimeMs,
      entryPrice,
      stopLossPrice,
    });
  }

  const targetPrice =
    side === 'long'
      ? entryPrice + first60Leg.targetR * riskDistance
      : entryPrice - first60Leg.targetR * riskDistance;
  const candles = candleMap.get(symbol) || [];
  const windowEndMs = signalTimeMs + first60Leg.windowMinutes * 60_000;
  const holdEndMs = signalTimeMs + maxHoldMinutes * 60_000;
  const scopedCandles = candles.filter(
    (candle) => candle.openTimeMs >= signalTimeMs && candle.openTimeMs <= holdEndMs
  );
  const first60Candles = scopedCandles.filter((candle) => candle.openTimeMs < windowEndMs);

  if (!first60Candles.length) {
    return buildInvalidTrade(signal, side, 'No candles available for the First60 window', {
      symbol,
      signalTimeMs,
      entryPrice,
      stopLossPrice,
      targetPrice,
      riskDistance,
      outcome: 'no-candles',
    });
  }

  const windowStats = computeWindowStats(side, entryPrice, riskDistance, first60Candles);
  const first60Exit = findFirstExit(side, first60Candles, stopLossPrice, targetPrice);
  if (first60Exit) {
    const first60Passed = first60Exit.outcome === 'target';
    return buildSimulatedTrade({
      symbol,
      side,
      signalTimeMs,
      entryPrice,
      stopLossPrice,
      targetPrice,
      riskDistance,
      outcome: first60Exit.outcome,
      exitTimeMs: first60Exit.exitTimeMs,
      exitPrice: first60Exit.exitPrice,
      first60Passed,
      windowStats,
      maxAdverseRObserved: windowStats.adverseR,
    });
  }

  const first60Passed =
    windowStats.favorableR >= first60Leg.requiredFavorableR &&
    windowStats.adverseR <= first60Leg.maxAdverseR;
  if (!first60Passed) {
    const exitCandle = first60Candles[first60Candles.length - 1];
    return buildSimulatedTrade({
      symbol,
      side,
      signalTimeMs,
      entryPrice,
      stopLossPrice,
      targetPrice,
      riskDistance,
      outcome: 'first60_failed',
      exitTimeMs: exitCandle.openTimeMs,
      exitPrice: exitCandle.close,
      first60Passed,
      windowStats,
      maxAdverseRObserved: windowStats.adverseR,
    });
  }

  const remainingCandles = scopedCandles.filter((candle) => candle.openTimeMs >= windowEndMs);
  const remainingExit = findFirstExit(side, remainingCandles, stopLossPrice, targetPrice);
  if (remainingExit) {
    const fullAdverse = computeWindowStats(side, entryPrice, riskDistance, [
      ...first60Candles,
      ...remainingCandles.filter((candle) => candle.openTimeMs <= remainingExit.exitTimeMs),
    ]).adverseR;
    return buildSimulatedTrade({
      symbol,
      side,
      signalTimeMs,
      entryPrice,
      stopLossPrice,
      targetPrice,
      riskDistance,
      outcome: remainingExit.outcome,
      exitTimeMs: remainingExit.exitTimeMs,
      exitPrice: remainingExit.exitPrice,
      first60Passed,
      windowStats,
      maxAdverseRObserved: fullAdverse,
    });
  }

  const exitCandle =
    scopedCandles[scopedCandles.length - 1] || first60Candles[first60Candles.length - 1];
  const fullAdverse = computeWindowStats(side, entryPrice, riskDistance, scopedCandles).adverseR;
  return buildSimulatedTrade({
    symbol,
    side,
    signalTimeMs,
    entryPrice,
    stopLossPrice,
    targetPrice,
    riskDistance,
    outcome: 'timeout',
    exitTimeMs: exitCandle.openTimeMs,
    exitPrice: exitCandle.close,
    first60Passed,
    windowStats,
    maxAdverseRObserved: fullAdverse,
  });
};

const summarizeSide = (
  side: StrategyTradeSide,
  trades: First60TemplateSimulationTradeResult[],
  topSymbolsLimit: number
): First60TemplateSimulationSideSummary => {
  const sideTrades = trades.filter((trade) => trade.side === side);
  const simulatedTrades = sideTrades.filter((trade) => trade.simulated);
  const passedTrades = simulatedTrades.filter((trade) => trade.first60Passed);
  const realizedTrades = simulatedTrades.filter((trade) => trade.realizedR !== null);
  const targetHits = simulatedTrades.filter((trade) => trade.targetHit).length;
  const stopHits = simulatedTrades.filter((trade) => trade.outcome === 'stop').length;
  const timeouts = simulatedTrades.filter((trade) => trade.outcome === 'timeout').length;
  const failedFirst60 = simulatedTrades.filter((trade) => !trade.first60Passed).length;
  const totalR = sum(realizedTrades.map((trade) => trade.realizedR ?? 0));
  const totalPassedR = sum(passedTrades.map((trade) => trade.realizedR ?? 0));
  const maxAdverseValues = simulatedTrades
    .map((trade) => trade.maxAdverseRObserved)
    .filter((value): value is number => value !== null && Number.isFinite(value));

  return {
    side,
    totalTrades: sideTrades.length,
    simulatedTrades: simulatedTrades.length,
    passedFirst60: passedTrades.length,
    failedFirst60,
    targetHits,
    stopHits,
    timeouts,
    invalidTrades: sideTrades.length - simulatedTrades.length,
    passRate: ratio(passedTrades.length, simulatedTrades.length),
    targetHitRate: ratio(targetHits, simulatedTrades.length),
    targetHitRateAfterPass: ratio(targetHits, passedTrades.length),
    avgR: ratio(totalR, realizedTrades.length),
    totalR,
    avgPassedR: ratio(totalPassedR, passedTrades.length),
    totalPassedR,
    maxAdverseR: maxAdverseValues.length ? Math.max(...maxAdverseValues) : null,
    bestSymbols: summarizeSymbols(realizedTrades, topSymbolsLimit, 'desc'),
    worstSymbols: summarizeSymbols(realizedTrades, topSymbolsLimit, 'asc'),
  };
};

const summarizeSymbols = (
  trades: First60TemplateSimulationTradeResult[],
  limit: number,
  direction: 'asc' | 'desc'
): First60TemplateSimulationSymbolSummary[] => {
  const grouped = new Map<string, First60TemplateSimulationTradeResult[]>();
  for (const trade of trades) {
    const items = grouped.get(trade.symbol) || [];
    items.push(trade);
    grouped.set(trade.symbol, items);
  }

  return Array.from(grouped.entries())
    .map(([symbol, items]) => {
      const totalR = sum(items.map((trade) => trade.realizedR ?? 0));
      return {
        symbol,
        trades: items.length,
        passedFirst60: items.filter((trade) => trade.first60Passed).length,
        targetHits: items.filter((trade) => trade.targetHit).length,
        totalR,
        avgR: totalR / items.length,
        targetHitRate: items.filter((trade) => trade.targetHit).length / items.length,
      };
    })
    .sort((left, right) =>
      direction === 'desc' ? right.totalR - left.totalR : left.totalR - right.totalR
    )
    .slice(0, limit);
};

const buildSimulatedTrade = (input: {
  symbol: string;
  side: StrategyTradeSide;
  signalTimeMs: number;
  entryPrice: number;
  stopLossPrice: number;
  targetPrice: number;
  riskDistance: number;
  outcome: 'target' | 'stop' | 'timeout' | 'first60_failed';
  exitTimeMs: number;
  exitPrice: number;
  first60Passed: boolean;
  windowStats: First60WindowStats;
  maxAdverseRObserved: number;
}): First60TemplateSimulationTradeResult => {
  const realizedR = priceToR(input.side, input.entryPrice, input.riskDistance, input.exitPrice);
  return {
    symbol: input.symbol,
    side: input.side,
    signalTime: new Date(input.signalTimeMs).toISOString(),
    simulated: true,
    outcome: input.outcome,
    first60Passed: input.first60Passed,
    entryPrice: input.entryPrice,
    stopLossPrice: input.stopLossPrice,
    targetPrice: input.targetPrice,
    riskDistance: input.riskDistance,
    exitTime: new Date(input.exitTimeMs).toISOString(),
    exitPrice: input.exitPrice,
    realizedR,
    targetHit: input.outcome === 'target',
    favorableR: input.windowStats.favorableR,
    adverseR: input.windowStats.adverseR,
    first60CloseR: input.windowStats.closeR,
    maxAdverseRObserved: input.maxAdverseRObserved,
    holdMinutes: Math.max(0, (input.exitTimeMs - input.signalTimeMs) / 60_000),
    reason: null,
  };
};

const buildInvalidTrade = (
  signal: First60TemplateSimulationSignal,
  side: StrategyTradeSide,
  reason: string,
  values: Partial<{
    symbol: string;
    signalTimeMs: number;
    entryPrice: number;
    stopLossPrice: number;
    targetPrice: number;
    riskDistance: number;
    outcome: First60TemplateSimulationOutcome;
  }> = {}
): First60TemplateSimulationTradeResult => ({
  symbol: values.symbol || normalizeSymbol(signal.symbol) || 'UNKNOWN',
  side,
  signalTime:
    values.signalTimeMs !== undefined
      ? new Date(values.signalTimeMs).toISOString()
      : readTimeMs(signal.signalTime) === null
        ? new Date(0).toISOString()
        : new Date(readTimeMs(signal.signalTime) as number).toISOString(),
  simulated: false,
  outcome: values.outcome || 'invalid',
  first60Passed: false,
  entryPrice: values.entryPrice ?? readNumber(signal.entryPrice) ?? 0,
  stopLossPrice: values.stopLossPrice ?? resolveStopLossPrice(signal, side) ?? 0,
  targetPrice: values.targetPrice ?? 0,
  riskDistance: values.riskDistance ?? 0,
  exitTime: null,
  exitPrice: null,
  realizedR: null,
  targetHit: false,
  favorableR: null,
  adverseR: null,
  first60CloseR: null,
  maxAdverseRObserved: null,
  holdMinutes: null,
  reason,
});

const computeWindowStats = (
  side: StrategyTradeSide,
  entryPrice: number,
  riskDistance: number,
  candles: NormalizedCandle[]
): First60WindowStats => {
  let favorableR = 0;
  let adverseR = 0;
  for (const candle of candles) {
    if (side === 'long') {
      favorableR = Math.max(favorableR, (candle.high - entryPrice) / riskDistance);
      adverseR = Math.max(adverseR, (entryPrice - candle.low) / riskDistance);
    } else {
      favorableR = Math.max(favorableR, (entryPrice - candle.low) / riskDistance);
      adverseR = Math.max(adverseR, (candle.high - entryPrice) / riskDistance);
    }
  }
  const last = candles[candles.length - 1];
  return {
    favorableR: Math.max(0, favorableR),
    adverseR: Math.max(0, adverseR),
    closeR: priceToR(side, entryPrice, riskDistance, last.close),
  };
};

const findFirstExit = (
  side: StrategyTradeSide,
  candles: NormalizedCandle[],
  stopLossPrice: number,
  targetPrice: number
): ExitHit | null => {
  for (const candle of candles) {
    const stopHit = side === 'long' ? candle.low <= stopLossPrice : candle.high >= stopLossPrice;
    const targetHit = side === 'long' ? candle.high >= targetPrice : candle.low <= targetPrice;
    if (stopHit) {
      return {
        outcome: 'stop',
        exitPrice: stopLossPrice,
        exitTimeMs: candle.openTimeMs,
      };
    }
    if (targetHit) {
      return {
        outcome: 'target',
        exitPrice: targetPrice,
        exitTimeMs: candle.openTimeMs,
      };
    }
  }
  return null;
};

const normalizeCandlesBySymbol = (
  candlesBySymbol: First60TemplateSimulationCandleSet
): Map<string, NormalizedCandle[]> => {
  const entries =
    candlesBySymbol instanceof Map
      ? Array.from(candlesBySymbol.entries())
      : Object.entries(candlesBySymbol);
  const normalized = new Map<string, NormalizedCandle[]>();
  for (const [symbol, candles] of entries) {
    const normalizedSymbol = normalizeSymbol(symbol);
    if (!normalizedSymbol) {
      continue;
    }
    const normalizedCandles = (Array.isArray(candles) ? candles : [])
      .map((candle) => normalizeCandle(candle))
      .filter((candle): candle is NormalizedCandle => Boolean(candle))
      .sort((left, right) => left.openTimeMs - right.openTimeMs);
    normalized.set(normalizedSymbol, normalizedCandles);
  }
  return normalized;
};

const normalizeCandle = (candle: First60TemplateSimulationCandle): NormalizedCandle | null => {
  const openTimeMs = readTimeMs(
    candle.openTime ?? candle.open_time ?? candle.timestamp ?? candle.time
  );
  const open = readNumber(candle.open);
  const high = readNumber(candle.high);
  const low = readNumber(candle.low);
  const close = readNumber(candle.close);
  if (openTimeMs === null || open === null || high === null || low === null || close === null) {
    return null;
  }
  return { openTimeMs, open, high, low, close };
};

const resolveStopLossPrice = (
  signal: First60TemplateSimulationSignal,
  side: StrategyTradeSide | null
): number | null => {
  if (!side) {
    return readNumber(signal.stopLossPrice ?? signal.stop_loss_price);
  }
  return (
    readNumber(signal.stopLossPrice ?? signal.stop_loss_price) ??
    (side === 'long'
      ? readNumber(signal.signalCandleLow ?? signal.signal_candle_low)
      : readNumber(signal.signalCandleHigh ?? signal.signal_candle_high))
  );
};

const normalizeSide = (value: unknown): StrategyTradeSide | null => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (normalized === 'long' || normalized === 'buy') {
    return 'long';
  }
  if (normalized === 'short' || normalized === 'sell') {
    return 'short';
  }
  return null;
};

const normalizeSymbol = (value: unknown): string =>
  String(value || '')
    .trim()
    .toUpperCase();

const readNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
};

const readTimeMs = (value: unknown): number | null => {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const time = value > 1e12 ? value : value * 1000;
    return Number.isFinite(time) ? time : null;
  }
  if (typeof value === 'string' && value.trim()) {
    const time = new Date(value).getTime();
    return Number.isFinite(time) ? time : null;
  }
  return null;
};

const priceToR = (
  side: StrategyTradeSide,
  entryPrice: number,
  riskDistance: number,
  price: number
): number =>
  side === 'long' ? (price - entryPrice) / riskDistance : (entryPrice - price) / riskDistance;

const ratio = (numerator: number, denominator: number): number | null =>
  denominator > 0 ? numerator / denominator : null;

const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);

const buildWarnings = (
  profile: StrategyTemplateAutomationProfile,
  trades: First60TemplateSimulationTradeResult[]
): string[] => {
  const warnings: string[] = [];
  if (!profile.tradeManagement?.first60?.enabled) {
    warnings.push('Template profile does not have enabled First60 trade management.');
  }
  const missingManagement = trades.filter((trade) => trade.outcome === 'missing-management').length;
  if (missingManagement) {
    warnings.push(
      `${missingManagement} trade(s) skipped because side-specific First60 management was missing.`
    );
  }
  const noCandles = trades.filter((trade) => trade.outcome === 'no-candles').length;
  if (noCandles) {
    warnings.push(`${noCandles} trade(s) skipped because First60 candles were unavailable.`);
  }
  const invalid = trades.filter((trade) => trade.outcome === 'invalid').length;
  if (invalid) {
    warnings.push(`${invalid} trade(s) skipped because signal input was invalid.`);
  }
  return warnings;
};
