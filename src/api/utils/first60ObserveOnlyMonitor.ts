import { StrategyTradeSide } from './strategyTemplateAutomation';

export type First60ObserveOnlyAction = 'observe_only' | 'diagnostics_only' | 'skipped';

export type First60ObserveOnlyOutcome =
  | 'first60_passed'
  | 'first60_failed'
  | 'target'
  | 'stop'
  | 'not_due'
  | 'no_candles'
  | 'invalid'
  | 'missing_snapshot'
  | 'disabled';

export interface First60ObserveOnlyTradeInput {
  id: string;
  symbol: string;
  side: string;
  signalTime: Date | string | number;
  entryPrice: number | string | null;
  stopLossPrice: number | string | null;
  status?: string | null;
  meta?: Record<string, unknown> | null;
}

export interface First60ObserveOnlyCandle {
  openTime?: Date | string | number;
  open_time?: Date | string | number;
  timestamp?: Date | string | number;
  time?: Date | string | number;
  open: number | string;
  high: number | string;
  low: number | string;
  close: number | string;
}

export interface First60ObserveOnlyOptions {
  now?: Date | string | number;
  maxOutcomeLookaheadMinutes?: number;
}

export interface First60ObserveOnlyResult {
  schemaVersion: 'first60-observe-only.v1';
  suggestedTradeId: string;
  symbol: string;
  side: StrategyTradeSide | null;
  action: First60ObserveOnlyAction;
  eligibleForObserveOnly: boolean;
  evaluatedAt: string;
  signalTime: string | null;
  windowEnd: string | null;
  outcome: First60ObserveOnlyOutcome;
  first60Passed: boolean | null;
  decisionGate: First60ObserveOnlyDecisionGate | null;
  entryPrice: number | null;
  stopLossPrice: number | null;
  targetPrice: number | null;
  riskDistance: number | null;
  requiredFavorableR: number | null;
  maxAdverseR: number | null;
  targetR: number | null;
  favorableR: number | null;
  adverseR: number | null;
  first60CloseR: number | null;
  first60Exit: First60ObserveOnlyExit | null;
  followThroughExit: First60ObserveOnlyExit | null;
  candleCount: number;
  reason: string | null;
}

export interface First60ObserveOnlyDecisionGate {
  status: string | null;
  observeOnlyEnabled: boolean;
  managementEnabled: boolean;
  diagnosticsEnabled: boolean;
  reason: string | null;
  evidenceRef: string | null;
  decidedAt: string | null;
}

export interface First60ObserveOnlyExit {
  outcome: 'target' | 'stop';
  exitPrice: number;
  exitTime: string;
}

interface NormalizedCandle {
  openTimeMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface First60Snapshot {
  enabled: boolean;
  windowMinutes: number;
  requiredFavorableR: number;
  maxAdverseR: number;
  targetR: number;
  decisionGate: First60ObserveOnlyDecisionGate;
}

interface WindowStats {
  favorableR: number;
  adverseR: number;
  closeR: number;
}

interface ExitHit {
  outcome: 'target' | 'stop';
  exitPrice: number;
  exitTimeMs: number;
}

const DEFAULT_MAX_OUTCOME_LOOKAHEAD_MINUTES = 24 * 60;

export const evaluateFirst60ObserveOnlyTrade = (
  trade: First60ObserveOnlyTradeInput,
  candles: First60ObserveOnlyCandle[],
  options: First60ObserveOnlyOptions = {}
): First60ObserveOnlyResult => {
  const evaluatedAtMs = readTimeMs(options.now) ?? Date.now();
  const symbol = normalizeSymbol(trade.symbol);
  const side = normalizeSide(trade.side);
  const signalTimeMs = readTimeMs(trade.signalTime);
  const entryPrice = readNumber(trade.entryPrice);
  const stopLossPrice = readNumber(trade.stopLossPrice);
  const snapshot = readFirst60Snapshot(trade.meta);
  const base = {
    schemaVersion: 'first60-observe-only.v1' as const,
    suggestedTradeId: String(trade.id || ''),
    symbol,
    side,
    evaluatedAt: new Date(evaluatedAtMs).toISOString(),
    signalTime: signalTimeMs === null ? null : new Date(signalTimeMs).toISOString(),
    entryPrice,
    stopLossPrice,
    decisionGate: snapshot?.decisionGate ?? null,
  };

  if (!snapshot) {
    return buildResult(base, {
      action: 'skipped',
      eligibleForObserveOnly: false,
      outcome: 'missing_snapshot',
      reason: 'Suggested trade is missing tradeManagementSnapshot.first60',
    });
  }

  const action = resolveAction(snapshot.decisionGate);
  if (!snapshot.enabled || action === 'skipped') {
    return buildResult(base, {
      action,
      eligibleForObserveOnly: false,
      outcome: 'disabled',
      requiredFavorableR: snapshot.requiredFavorableR,
      maxAdverseR: snapshot.maxAdverseR,
      targetR: snapshot.targetR,
      reason: snapshot.enabled
        ? 'First60 decision gate is disabled'
        : 'First60 snapshot is disabled',
    });
  }

  if (
    !symbol ||
    !side ||
    signalTimeMs === null ||
    entryPrice === null ||
    stopLossPrice === null
  ) {
    return buildResult(base, {
      action,
      eligibleForObserveOnly: action === 'observe_only',
      outcome: 'invalid',
      requiredFavorableR: snapshot.requiredFavorableR,
      maxAdverseR: snapshot.maxAdverseR,
      targetR: snapshot.targetR,
      reason: 'Trade is missing symbol, side, signal time, entry, or stop',
    });
  }

  const windowEndMs = signalTimeMs + snapshot.windowMinutes * 60_000;
  if (evaluatedAtMs < windowEndMs) {
    return buildResult(base, {
      action,
      eligibleForObserveOnly: action === 'observe_only',
      outcome: 'not_due',
      windowEnd: new Date(windowEndMs).toISOString(),
      requiredFavorableR: snapshot.requiredFavorableR,
      maxAdverseR: snapshot.maxAdverseR,
      targetR: snapshot.targetR,
      reason: 'First60 window has not completed yet',
    });
  }

  const riskDistance = side === 'long' ? entryPrice - stopLossPrice : stopLossPrice - entryPrice;
  if (!Number.isFinite(riskDistance) || riskDistance <= 0) {
    return buildResult(base, {
      action,
      eligibleForObserveOnly: action === 'observe_only',
      outcome: 'invalid',
      windowEnd: new Date(windowEndMs).toISOString(),
      requiredFavorableR: snapshot.requiredFavorableR,
      maxAdverseR: snapshot.maxAdverseR,
      targetR: snapshot.targetR,
      riskDistance,
      reason: 'Stop loss is not on the risk side of entry',
    });
  }

  const targetPrice =
    side === 'long'
      ? entryPrice + snapshot.targetR * riskDistance
      : entryPrice - snapshot.targetR * riskDistance;
  const normalizedCandles = normalizeCandles(candles);
  const first60Candles = normalizedCandles.filter(
    (candle) => candle.openTimeMs >= signalTimeMs && candle.openTimeMs < windowEndMs
  );

  if (!first60Candles.length) {
    return buildResult(base, {
      action,
      eligibleForObserveOnly: action === 'observe_only',
      outcome: 'no_candles',
      windowEnd: new Date(windowEndMs).toISOString(),
      targetPrice,
      riskDistance,
      requiredFavorableR: snapshot.requiredFavorableR,
      maxAdverseR: snapshot.maxAdverseR,
      targetR: snapshot.targetR,
      reason: 'No 1m candles were available for the First60 window',
    });
  }

  const windowStats = computeWindowStats(side, entryPrice, riskDistance, first60Candles);
  const first60Exit = findFirstExit(side, first60Candles, stopLossPrice, targetPrice);
  const first60Passed = first60Exit
    ? first60Exit.outcome === 'target'
    : windowStats.favorableR >= snapshot.requiredFavorableR &&
      windowStats.adverseR <= snapshot.maxAdverseR;
  const outcome = first60Exit
    ? first60Exit.outcome
    : first60Passed
      ? 'first60_passed'
      : 'first60_failed';
  const maxOutcomeLookaheadMinutes = Math.max(
    1,
    Math.trunc(readNumber(options.maxOutcomeLookaheadMinutes) ?? DEFAULT_MAX_OUTCOME_LOOKAHEAD_MINUTES)
  );
  const lookaheadEndMs = signalTimeMs + maxOutcomeLookaheadMinutes * 60_000;
  const followThroughCandles = normalizedCandles.filter(
    (candle) => candle.openTimeMs >= windowEndMs && candle.openTimeMs <= lookaheadEndMs
  );
  const followThroughExit = findFirstExit(
    side,
    followThroughCandles,
    stopLossPrice,
    targetPrice
  );

  return buildResult(base, {
    action,
    eligibleForObserveOnly: action === 'observe_only',
    outcome,
    first60Passed,
    windowEnd: new Date(windowEndMs).toISOString(),
    targetPrice,
    riskDistance,
    requiredFavorableR: snapshot.requiredFavorableR,
    maxAdverseR: snapshot.maxAdverseR,
    targetR: snapshot.targetR,
    favorableR: windowStats.favorableR,
    adverseR: windowStats.adverseR,
    first60CloseR: windowStats.closeR,
    first60Exit: first60Exit ? toExit(first60Exit) : null,
    followThroughExit: followThroughExit ? toExit(followThroughExit) : null,
    candleCount: first60Candles.length,
    reason: action === 'diagnostics_only' ? 'Decision gate is diagnostics-only for this side' : null,
  });
};

const resolveAction = (decisionGate: First60ObserveOnlyDecisionGate): First60ObserveOnlyAction => {
  if (decisionGate.observeOnlyEnabled) {
    return 'observe_only';
  }
  if (decisionGate.diagnosticsEnabled) {
    return 'diagnostics_only';
  }
  return 'skipped';
};

const readFirst60Snapshot = (meta: Record<string, unknown> | null | undefined): First60Snapshot | null => {
  const root = parseRecord(meta);
  const snapshot = parseRecord(root?.tradeManagementSnapshot);
  const first60 = parseRecord(snapshot?.first60);
  if (!first60) {
    return null;
  }

  return {
    enabled: parseBoolean(first60.enabled) ?? true,
    windowMinutes: readPositiveNumber(first60.windowMinutes ?? first60.window_minutes, 60),
    requiredFavorableR: readPositiveNumber(
      first60.requiredFavorableR ?? first60.required_favorable_r,
      1
    ),
    maxAdverseR: readNonNegativeNumber(first60.maxAdverseR ?? first60.max_adverse_r, 0.75),
    targetR: readPositiveNumber(first60.targetR ?? first60.target_r, 1),
    decisionGate: readDecisionGate(parseRecord(first60.decisionGate) || parseRecord(first60.decision_gate)),
  };
};

const readDecisionGate = (
  value: Record<string, unknown> | null
): First60ObserveOnlyDecisionGate => ({
  status: readText(value?.status) || null,
  observeOnlyEnabled: parseBoolean(value?.observeOnlyEnabled ?? value?.observe_only_enabled) ?? false,
  managementEnabled: parseBoolean(value?.managementEnabled ?? value?.management_enabled) ?? false,
  diagnosticsEnabled: parseBoolean(value?.diagnosticsEnabled ?? value?.diagnostics_enabled) ?? false,
  reason: readText(value?.reason) || null,
  evidenceRef: readText(value?.evidenceRef ?? value?.evidence_ref) || null,
  decidedAt: readText(value?.decidedAt ?? value?.decided_at) || null,
});

const buildResult = (
  base: Pick<
    First60ObserveOnlyResult,
    | 'schemaVersion'
    | 'suggestedTradeId'
    | 'symbol'
    | 'side'
    | 'evaluatedAt'
    | 'signalTime'
    | 'entryPrice'
    | 'stopLossPrice'
    | 'decisionGate'
  >,
  values: Partial<First60ObserveOnlyResult> & {
    action: First60ObserveOnlyAction;
    eligibleForObserveOnly: boolean;
    outcome: First60ObserveOnlyOutcome;
  }
): First60ObserveOnlyResult => ({
  ...base,
  action: values.action,
  eligibleForObserveOnly: values.eligibleForObserveOnly,
  windowEnd: values.windowEnd ?? null,
  outcome: values.outcome,
  first60Passed: values.first60Passed ?? null,
  targetPrice: values.targetPrice ?? null,
  riskDistance: values.riskDistance ?? null,
  requiredFavorableR: values.requiredFavorableR ?? null,
  maxAdverseR: values.maxAdverseR ?? null,
  targetR: values.targetR ?? null,
  favorableR: values.favorableR ?? null,
  adverseR: values.adverseR ?? null,
  first60CloseR: values.first60CloseR ?? null,
  first60Exit: values.first60Exit ?? null,
  followThroughExit: values.followThroughExit ?? null,
  candleCount: values.candleCount ?? 0,
  reason: values.reason ?? null,
});

const computeWindowStats = (
  side: StrategyTradeSide,
  entryPrice: number,
  riskDistance: number,
  candles: NormalizedCandle[]
): WindowStats => {
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
      return { outcome: 'stop', exitPrice: stopLossPrice, exitTimeMs: candle.openTimeMs };
    }
    if (targetHit) {
      return { outcome: 'target', exitPrice: targetPrice, exitTimeMs: candle.openTimeMs };
    }
  }
  return null;
};

const normalizeCandles = (candles: First60ObserveOnlyCandle[]): NormalizedCandle[] =>
  (Array.isArray(candles) ? candles : [])
    .map((candle) => {
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
    })
    .filter((candle): candle is NormalizedCandle => candle !== null)
    .sort((left, right) => left.openTimeMs - right.openTimeMs);

const toExit = (exit: ExitHit): First60ObserveOnlyExit => ({
  outcome: exit.outcome,
  exitPrice: exit.exitPrice,
  exitTime: new Date(exit.exitTimeMs).toISOString(),
});

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

const parseRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const parseBoolean = (value: unknown): boolean | null => {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const normalized = value.trim().toLowerCase();
    if (['true', 'yes', 'enabled', 'on', '1'].includes(normalized)) {
      return true;
    }
    if (['false', 'no', 'disabled', 'off', '0'].includes(normalized)) {
      return false;
    }
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  return null;
};

const readText = (...values: unknown[]): string => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
};

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

const readPositiveNumber = (value: unknown, fallback: number): number => {
  const parsed = readNumber(value);
  return parsed !== null && parsed > 0 ? parsed : fallback;
};

const readNonNegativeNumber = (value: unknown, fallback: number): number => {
  const parsed = readNumber(value);
  return parsed !== null && parsed >= 0 ? parsed : fallback;
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
