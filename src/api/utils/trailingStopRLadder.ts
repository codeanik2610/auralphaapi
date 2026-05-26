export type TrailingStopSide = 'long' | 'short';

export interface CustomRLadderTrailingStopRule {
  whenProfitR: number;
  moveStopToR: number;
  trailDistanceR?: number;
}

export interface CustomRLadderTrailingStopConfig {
  enabled: boolean;
  mode: 'custom_r_ladder';
  basis: 'actual_fill' | 'planned_entry';
  timeframe: string;
  updateOnlyInProfitDirection: boolean;
  rules: CustomRLadderTrailingStopRule[];
}

export interface CustomRLadderTrailingStopEvaluationInput {
  side: TrailingStopSide;
  config: CustomRLadderTrailingStopConfig;
  entryPrice: number;
  originalStopLossPrice: number;
  currentPrice: number;
  currentStopLossPrice?: number | null;
  peakProfitR?: number | null;
  lastAppliedWhenProfitR?: number | null;
  lastAppliedMoveStopToR?: number | null;
}

export interface CustomRLadderTrailingStopMove {
  action: 'move';
  side: TrailingStopSide;
  profitR: number;
  peakProfitR: number;
  riskPerUnit: number;
  lockedProfitR: number;
  rule: CustomRLadderTrailingStopRule;
  targetStopLossPrice: number;
}

export interface CustomRLadderTrailingStopNoop {
  action: 'none';
  reason:
    | 'disabled'
    | 'invalid_entry'
    | 'invalid_stop_loss'
    | 'invalid_current_price'
    | 'invalid_risk'
    | 'no_rule_crossed'
    | 'already_applied'
    | 'would_move_backward';
  profitR?: number | null;
}

export type CustomRLadderTrailingStopEvaluation =
  | CustomRLadderTrailingStopMove
  | CustomRLadderTrailingStopNoop;

const EPSILON = 1e-12;

const parseRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

const parseNumber = (value: unknown): number | null => {
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

const parseBoolean = (value: unknown): boolean | null => {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === 'string' && value.trim()) {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on', 'enabled'].includes(normalized)) {
      return true;
    }
    if (['0', 'false', 'no', 'off', 'disabled'].includes(normalized)) {
      return false;
    }
  }
  return null;
};

const normalizeMode = (value: unknown): string => {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
};

const normalizeBasis = (value: unknown): 'actual_fill' | 'planned_entry' => {
  const normalized = normalizeMode(value);
  if (normalized === 'planned_entry' || normalized === 'planned') {
    return 'planned_entry';
  }
  return 'actual_fill';
};

const normalizeTimeframe = (value: unknown, fallback = '1m'): string => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (/^\d+[mhdw]$/.test(normalized)) {
    return normalized;
  }
  return fallback;
};

const normalizeRule = (value: unknown): CustomRLadderTrailingStopRule | null => {
  const rule = parseRecord(value);
  if (!rule) {
    return null;
  }

  const whenProfitR = parseNumber(
    rule.whenProfitR ??
      rule.when_profit_r ??
      rule.whenR ??
      rule.when_r ??
      rule.triggerR ??
      rule.trigger_r ??
      rule.profitR ??
      rule.profit_r ??
      rule.atR ??
      rule.at_r
  );
  const moveStopToR = parseNumber(
    rule.moveStopToR ??
      rule.move_stop_to_r ??
      rule.stopR ??
      rule.stop_r ??
      rule.toR ??
      rule.to_r ??
      rule.lockR ??
      rule.lock_r
  );
  const trailDistanceR = parseNumber(
    rule.trailDistanceR ??
      rule.trail_distance_r ??
      rule.trailingDistanceR ??
      rule.trailing_distance_r ??
      rule.trailByR ??
      rule.trail_by_r ??
      rule.peakTrailR ??
      rule.peak_trail_r
  );
  const resolvedMoveStopToR =
    moveStopToR ??
    (whenProfitR !== null && trailDistanceR !== null ? whenProfitR - trailDistanceR : null);

  if (
    whenProfitR === null ||
    resolvedMoveStopToR === null ||
    whenProfitR <= 0 ||
    resolvedMoveStopToR < 0 ||
    resolvedMoveStopToR >= whenProfitR ||
    (trailDistanceR !== null && trailDistanceR <= 0)
  ) {
    return null;
  }

  return {
    whenProfitR,
    moveStopToR: resolvedMoveStopToR,
    ...(trailDistanceR !== null ? { trailDistanceR } : {}),
  };
};

export function normalizeCustomRLadderTrailingStopConfig(
  value: unknown
): CustomRLadderTrailingStopConfig | null {
  const config = parseRecord(value);
  if (!config) {
    return null;
  }

  const rulesSource =
    config.rules ??
    config.ladder ??
    config.customRules ??
    config.custom_rules ??
    config.rLadder ??
    config.r_ladder;
  const rulesList = Array.isArray(rulesSource) ? rulesSource : [];
  const rulesByTrigger = new Map<number, CustomRLadderTrailingStopRule>();
  for (const rawRule of rulesList) {
    const rule = normalizeRule(rawRule);
    if (!rule) {
      continue;
    }
    rulesByTrigger.set(rule.whenProfitR, rule);
  }

  const rules = Array.from(rulesByTrigger.values()).sort(
    (left, right) => left.whenProfitR - right.whenProfitR
  );
  if (!rules.length) {
    return null;
  }

  const enabled = parseBoolean(config.enabled) ?? true;
  const mode = normalizeMode(config.mode ?? config.trailingMode ?? config.trailing_mode);
  if (!enabled || (mode && !['custom_r_ladder', 'r_ladder'].includes(mode))) {
    return null;
  }

  return {
    enabled: true,
    mode: 'custom_r_ladder',
    basis: normalizeBasis(config.basis ?? config.entryBasis ?? config.entry_basis),
    timeframe: normalizeTimeframe(
      config.timeframe ??
        config.evaluationTimeframe ??
        config.evaluation_timeframe ??
        config.trailingTimeframe ??
        config.trailing_timeframe
    ),
    updateOnlyInProfitDirection:
      parseBoolean(config.updateOnlyInProfitDirection ?? config.update_only_in_profit_direction) ??
      true,
    rules,
  };
}

export function resolveCustomRLadderTrailingStopConfigFromRecords(
  ...records: unknown[]
): CustomRLadderTrailingStopConfig | null {
  for (const rawRecord of records) {
    const record = parseRecord(rawRecord);
    if (!record) {
      continue;
    }

    const direct = normalizeCustomRLadderTrailingStopConfig(
      record.trailingStop ?? record.trailing_stop
    );
    if (direct) {
      return direct;
    }

    const tradeManagement =
      parseRecord(record.tradeManagement) ??
      parseRecord(record.trade_management) ??
      parseRecord(record.management);
    const nested = normalizeCustomRLadderTrailingStopConfig(
      tradeManagement?.trailingStop ?? tradeManagement?.trailing_stop
    );
    if (nested) {
      return nested;
    }
  }

  return null;
}

export function evaluateCustomRLadderTrailingStopMove(
  input: CustomRLadderTrailingStopEvaluationInput
): CustomRLadderTrailingStopEvaluation {
  if (!input.config.enabled) {
    return { action: 'none', reason: 'disabled' };
  }
  if (!Number.isFinite(input.entryPrice) || input.entryPrice <= 0) {
    return { action: 'none', reason: 'invalid_entry' };
  }
  if (!Number.isFinite(input.originalStopLossPrice) || input.originalStopLossPrice <= 0) {
    return { action: 'none', reason: 'invalid_stop_loss' };
  }
  if (!Number.isFinite(input.currentPrice) || input.currentPrice <= 0) {
    return { action: 'none', reason: 'invalid_current_price' };
  }

  const riskPerUnit =
    input.side === 'short'
      ? input.originalStopLossPrice - input.entryPrice
      : input.entryPrice - input.originalStopLossPrice;
  if (!Number.isFinite(riskPerUnit) || riskPerUnit <= 0) {
    return { action: 'none', reason: 'invalid_risk' };
  }

  const profitR =
    input.side === 'short'
      ? (input.entryPrice - input.currentPrice) / riskPerUnit
      : (input.currentPrice - input.entryPrice) / riskPerUnit;
  const priorPeakProfitR =
    typeof input.peakProfitR === 'number' && Number.isFinite(input.peakProfitR)
      ? input.peakProfitR
      : null;
  const peakProfitR = Math.max(profitR, priorPeakProfitR ?? profitR);
  const crossedRule = [...input.config.rules]
    .reverse()
    .find((rule) => peakProfitR + EPSILON >= rule.whenProfitR);
  if (!crossedRule) {
    return { action: 'none', reason: 'no_rule_crossed', profitR };
  }

  const lastApplied = input.lastAppliedWhenProfitR;
  const lockedProfitR = crossedRule.trailDistanceR
    ? Math.max(crossedRule.moveStopToR, peakProfitR - crossedRule.trailDistanceR)
    : crossedRule.moveStopToR;
  const lastAppliedMoveStopToR =
    typeof input.lastAppliedMoveStopToR === 'number' &&
    Number.isFinite(input.lastAppliedMoveStopToR)
      ? input.lastAppliedMoveStopToR
      : null;
  if (
    typeof lastApplied === 'number' &&
    Number.isFinite(lastApplied) &&
    lastApplied + EPSILON >= crossedRule.whenProfitR &&
    (!crossedRule.trailDistanceR ||
      (lastAppliedMoveStopToR !== null && lastAppliedMoveStopToR + EPSILON >= lockedProfitR))
  ) {
    return { action: 'none', reason: 'already_applied', profitR };
  }

  const targetStopLossPrice =
    input.side === 'short'
      ? input.entryPrice - lockedProfitR * riskPerUnit
      : input.entryPrice + lockedProfitR * riskPerUnit;
  const currentStopLossPrice =
    typeof input.currentStopLossPrice === 'number' && Number.isFinite(input.currentStopLossPrice)
      ? input.currentStopLossPrice
      : input.originalStopLossPrice;

  if (input.config.updateOnlyInProfitDirection) {
    const movesForward =
      input.side === 'short'
        ? targetStopLossPrice < currentStopLossPrice - EPSILON
        : targetStopLossPrice > currentStopLossPrice + EPSILON;
    if (!movesForward) {
      return { action: 'none', reason: 'would_move_backward', profitR };
    }
  }

  return {
    action: 'move',
    side: input.side,
    profitR,
    peakProfitR,
    riskPerUnit,
    lockedProfitR,
    rule: {
      ...crossedRule,
      moveStopToR: lockedProfitR,
    },
    targetStopLossPrice,
  };
}
