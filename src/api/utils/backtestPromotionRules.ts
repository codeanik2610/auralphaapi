import { BadRequestAppError } from '../errors/AppError';
import type {
  BacktestPromotionRules,
  BacktestPromotionRulesInput,
} from '../contracts/Settings';

const ALLOWED_RULE_FIELDS = new Set([
  'minScore',
  'minTrades',
  'requireCompleteHistory',
  'requireLineage',
  'requireTemplateAutomationReady',
  'requireRobustness',
  'requiredRobustnessModel',
  'minPortfolioPressureScore',
  'minExecutedTradeRatio',
  'blockCapitalDepletionRisk',
]);

export const DEFAULT_BACKTEST_PROMOTION_RULES: BacktestPromotionRules = Object.freeze({
  minScore: 0.6,
  minTrades: 5,
  requireCompleteHistory: true,
  requireLineage: true,
  requireTemplateAutomationReady: true,
  requireRobustness: true,
  requiredRobustnessModel: 'walk-forward-multi-split',
  minPortfolioPressureScore: 0.7,
  minExecutedTradeRatio: 0.75,
  blockCapitalDepletionRisk: true,
});

export function createDefaultBacktestPromotionRules(): BacktestPromotionRules {
  return { ...DEFAULT_BACKTEST_PROMOTION_RULES };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function coerceNumber(
  value: unknown,
  fallback: number,
  options: { integer?: boolean; min?: number; max?: number }
): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  const normalized = options.integer ? Math.trunc(numeric) : numeric;
  if (options.min !== undefined && normalized < options.min) {
    return fallback;
  }
  if (options.max !== undefined && normalized > options.max) {
    return fallback;
  }

  return normalized;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function readModel(value: unknown, fallback: string): string {
  const normalized = String(value || '').trim();
  return normalized || fallback;
}

export function resolveBacktestPromotionRules(
  value: unknown,
  defaults: BacktestPromotionRules = createDefaultBacktestPromotionRules()
): BacktestPromotionRules {
  const source = isPlainObject(value) ? value : {};

  return {
    minScore: coerceNumber(source.minScore, defaults.minScore, { min: 0, max: 1 }),
    minTrades: coerceNumber(source.minTrades, defaults.minTrades, {
      integer: true,
      min: 0,
      max: 1_000_000,
    }),
    requireCompleteHistory: readBoolean(
      source.requireCompleteHistory,
      defaults.requireCompleteHistory
    ),
    requireLineage: readBoolean(source.requireLineage, defaults.requireLineage),
    requireTemplateAutomationReady: readBoolean(
      source.requireTemplateAutomationReady,
      defaults.requireTemplateAutomationReady
    ),
    requireRobustness: readBoolean(source.requireRobustness, defaults.requireRobustness),
    requiredRobustnessModel: readModel(
      source.requiredRobustnessModel,
      defaults.requiredRobustnessModel
    ),
    minPortfolioPressureScore: coerceNumber(
      source.minPortfolioPressureScore,
      defaults.minPortfolioPressureScore,
      { min: 0, max: 1 }
    ),
    minExecutedTradeRatio: coerceNumber(
      source.minExecutedTradeRatio,
      defaults.minExecutedTradeRatio,
      { min: 0, max: 1 }
    ),
    blockCapitalDepletionRisk: readBoolean(
      source.blockCapitalDepletionRisk,
      defaults.blockCapitalDepletionRisk
    ),
  };
}

export function validateBacktestPromotionRulesInput(
  value: BacktestPromotionRulesInput = {},
  defaults: BacktestPromotionRules = createDefaultBacktestPromotionRules()
): BacktestPromotionRules {
  if (!isPlainObject(value)) {
    throw new BadRequestAppError('backtestPromotionRules must be an object');
  }

  const unexpectedFields = Object.keys(value).filter((fieldName) => !ALLOWED_RULE_FIELDS.has(fieldName));
  if (unexpectedFields.length > 0) {
    throw new BadRequestAppError(
      `Unknown backtestPromotionRules fields: ${unexpectedFields.sort().join(', ')}`
    );
  }

  const candidate = {
    minScore: value.minScore ?? defaults.minScore,
    minTrades: value.minTrades ?? defaults.minTrades,
    requireCompleteHistory:
      value.requireCompleteHistory ?? defaults.requireCompleteHistory,
    requireLineage: value.requireLineage ?? defaults.requireLineage,
    requireTemplateAutomationReady:
      value.requireTemplateAutomationReady ?? defaults.requireTemplateAutomationReady,
    requireRobustness: value.requireRobustness ?? defaults.requireRobustness,
    requiredRobustnessModel:
      value.requiredRobustnessModel ?? defaults.requiredRobustnessModel,
    minPortfolioPressureScore:
      value.minPortfolioPressureScore ?? defaults.minPortfolioPressureScore,
    minExecutedTradeRatio:
      value.minExecutedTradeRatio ?? defaults.minExecutedTradeRatio,
    blockCapitalDepletionRisk:
      value.blockCapitalDepletionRisk ?? defaults.blockCapitalDepletionRisk,
  };

  if (
    typeof candidate.minScore !== 'number' ||
    !Number.isFinite(candidate.minScore) ||
    candidate.minScore < 0 ||
    candidate.minScore > 1
  ) {
    throw new BadRequestAppError('backtestPromotionRules.minScore must be a number between 0 and 1');
  }

  if (
    typeof candidate.minTrades !== 'number' ||
    !Number.isInteger(candidate.minTrades) ||
    candidate.minTrades < 0 ||
    candidate.minTrades > 1_000_000
  ) {
    throw new BadRequestAppError(
      'backtestPromotionRules.minTrades must be an integer between 0 and 1000000'
    );
  }

  if (typeof candidate.requireCompleteHistory !== 'boolean') {
    throw new BadRequestAppError(
      'backtestPromotionRules.requireCompleteHistory must be a boolean'
    );
  }

  if (typeof candidate.requireLineage !== 'boolean') {
    throw new BadRequestAppError('backtestPromotionRules.requireLineage must be a boolean');
  }

  if (typeof candidate.requireTemplateAutomationReady !== 'boolean') {
    throw new BadRequestAppError(
      'backtestPromotionRules.requireTemplateAutomationReady must be a boolean'
    );
  }

  if (typeof candidate.requireRobustness !== 'boolean') {
    throw new BadRequestAppError(
      'backtestPromotionRules.requireRobustness must be a boolean'
    );
  }

  if (
    typeof candidate.requiredRobustnessModel !== 'string' ||
    !candidate.requiredRobustnessModel.trim()
  ) {
    throw new BadRequestAppError(
      'backtestPromotionRules.requiredRobustnessModel must be a non-empty string'
    );
  }

  if (
    typeof candidate.minPortfolioPressureScore !== 'number' ||
    !Number.isFinite(candidate.minPortfolioPressureScore) ||
    candidate.minPortfolioPressureScore < 0 ||
    candidate.minPortfolioPressureScore > 1
  ) {
    throw new BadRequestAppError(
      'backtestPromotionRules.minPortfolioPressureScore must be a number between 0 and 1'
    );
  }

  if (
    typeof candidate.minExecutedTradeRatio !== 'number' ||
    !Number.isFinite(candidate.minExecutedTradeRatio) ||
    candidate.minExecutedTradeRatio < 0 ||
    candidate.minExecutedTradeRatio > 1
  ) {
    throw new BadRequestAppError(
      'backtestPromotionRules.minExecutedTradeRatio must be a number between 0 and 1'
    );
  }

  if (typeof candidate.blockCapitalDepletionRisk !== 'boolean') {
    throw new BadRequestAppError(
      'backtestPromotionRules.blockCapitalDepletionRisk must be a boolean'
    );
  }

  return {
    minScore: candidate.minScore,
    minTrades: candidate.minTrades,
    requireCompleteHistory: candidate.requireCompleteHistory,
    requireLineage: candidate.requireLineage,
    requireTemplateAutomationReady: candidate.requireTemplateAutomationReady,
    requireRobustness: candidate.requireRobustness,
    requiredRobustnessModel: candidate.requiredRobustnessModel.trim(),
    minPortfolioPressureScore: candidate.minPortfolioPressureScore,
    minExecutedTradeRatio: candidate.minExecutedTradeRatio,
    blockCapitalDepletionRisk: candidate.blockCapitalDepletionRisk,
  };
}

export function formatBacktestPromotionRulesForDisplay(
  rules: BacktestPromotionRules
): string {
  return [
    `score >= ${rules.minScore.toFixed(2)}`,
    `trades >= ${rules.minTrades}`,
    rules.requireRobustness ? `robustness: ${rules.requiredRobustnessModel}` : 'robustness optional',
    `portfolio score >= ${rules.minPortfolioPressureScore.toFixed(2)}`,
    `exec ratio >= ${rules.minExecutedTradeRatio.toFixed(2)}`,
  ].join(' | ');
}
