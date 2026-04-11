import {
  StrategyLabBacktestHandoffBody,
  StrategyLabDraftBody,
} from '../contracts/StrategyLab';
import { BadRequestAppError } from '../errors/AppError';

export interface ValidatedStrategyLabDraftBody {
  projectId?: string;
  name: string;
  description: string | null;
  sourceTemplateId: string | null;
  sourceTemplateVersion: number | null;
  sourceTemplateName: string | null;
  authoringMode: 'no_code' | 'code';
  codeTarget: 'dsl' | 'javascript' | 'python' | null;
  objective: string;
  market: string;
  timeframe: string;
  timeframes: string[];
  assets: Array<Record<string, unknown>>;
  start: string | null;
  end: string | null;
  universe: string;
  modelType: string;
  maxRisk: string;
  signalThreshold: string;
  entryLogic: string;
  exitLogic: string;
  shortEnabled: boolean;
  entryShortLogic: string;
  exitShortLogic: string;
  sizingNotes: string;
  notes: string;
  useAiFilter: boolean;
  useRegimeFilter: boolean;
  paperTradeFirst: boolean;
  visualDefinition: Record<string, unknown> | null;
  codeDefinition: string | null;
  parameters: Record<string, unknown> | null;
  riskConfig: Record<string, unknown> | null;
}

const toRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return { ...(value as Record<string, unknown>) };
};

const cleanText = (value: unknown): string => String(value || '').trim();

const firstNonEmptyText = (...values: unknown[]): string => {
  for (const value of values) {
    const cleaned = cleanText(value);
    if (cleaned) {
      return cleaned;
    }
  }
  return '';
};

export const validateStrategyLabProjectId = (projectId: string): string => {
  const normalizedProjectId = projectId.trim();

  if (!normalizedProjectId) {
    throw new BadRequestAppError('projectId is required');
  }

  return normalizedProjectId;
};

export const validateStrategyLabDraftBody = (
  body: StrategyLabDraftBody
): ValidatedStrategyLabDraftBody => {
  if (!body.name?.trim()) {
    throw new BadRequestAppError('name is required');
  }

  if (!body.market?.trim()) {
    throw new BadRequestAppError('market is required');
  }

  const rawTimeframes = Array.isArray(body.timeframes) ? body.timeframes : [];
  const timeframes = rawTimeframes
    .map((frame) => String(frame || '').trim())
    .filter(Boolean);
  const timeframe = body.timeframe?.trim() || timeframes[0];
  if (!timeframe) {
    throw new BadRequestAppError('timeframe is required');
  }

  const assets = Array.isArray(body.assets)
    ? body.assets.filter((asset) => asset && typeof asset === 'object')
    : [];
  const start = body.start?.trim() || null;
  const end = body.end?.trim() || null;
  const sourceTemplateId = body.sourceTemplateId?.trim() || null;
  const sourceTemplateVersion =
    body.sourceTemplateVersion === null || body.sourceTemplateVersion === undefined
      ? null
      : Number(body.sourceTemplateVersion);
  const sourceTemplateName = body.sourceTemplateName?.trim() || null;
  const parameters = toRecord(body.parameters);
  const riskConfig = toRecord(body.riskConfig);
  const maxRisk = firstNonEmptyText(
    body.maxRisk,
    riskConfig?.maxRisk,
    riskConfig?.max_per_trade
  ) || '1.5';
  const signalThreshold = firstNonEmptyText(
    body.signalThreshold,
    parameters?.signalThreshold,
    parameters?.signal_threshold
  ) || '0.82';
  const sizingNotes =
    firstNonEmptyText(body.sizingNotes, riskConfig?.sizingNotes) || '';
  const explicitShortEnabled = typeof body.shortEnabled === 'boolean' ? body.shortEnabled : null;
  const entryShortLogic = body.entryShortLogic?.trim() || '';
  const exitShortLogic = body.exitShortLogic?.trim() || '';
  const shortEnabled =
    explicitShortEnabled !== null
      ? explicitShortEnabled
      : Boolean(entryShortLogic || exitShortLogic);
  const normalizedParameters = parameters ? { ...parameters } : {};
  const normalizedRiskConfig = riskConfig ? { ...riskConfig } : {};

  normalizedParameters.signalThreshold = signalThreshold;
  if (!('signal_threshold' in normalizedParameters)) {
    normalizedParameters.signal_threshold = signalThreshold;
  }
  normalizedRiskConfig.maxRisk = maxRisk;
  if (!('max_per_trade' in normalizedRiskConfig)) {
    normalizedRiskConfig.max_per_trade = maxRisk;
  }
  normalizedRiskConfig.sizingNotes = sizingNotes;

  const authoringMode = body.authoringMode === 'code' ? 'code' : 'no_code';
  const codeTarget = body.codeTarget?.trim().toLowerCase() || 'dsl';

  if (
    authoringMode === 'code' &&
    !['dsl', 'javascript', 'python'].includes(codeTarget)
  ) {
    throw new BadRequestAppError('codeTarget must be one of dsl, javascript, or python');
  }

  if (authoringMode === 'code' && !body.codeDefinition?.trim()) {
    throw new BadRequestAppError('codeDefinition is required for code mode');
  }

  if (
    sourceTemplateVersion !== null &&
    (!Number.isInteger(sourceTemplateVersion) || sourceTemplateVersion <= 0)
  ) {
    throw new BadRequestAppError('sourceTemplateVersion must be a positive integer');
  }

  return {
    projectId: body.projectId?.trim() || undefined,
    name: body.name.trim(),
    description: body.description?.trim() || null,
    sourceTemplateId,
    sourceTemplateVersion,
    sourceTemplateName,
    authoringMode,
    codeTarget: authoringMode === 'code' ? (codeTarget as 'dsl' | 'javascript' | 'python') : null,
    objective: body.objective?.trim() || 'probability-alpha',
    market: body.market.trim(),
    timeframe,
    timeframes,
    assets,
    start,
    end,
    universe: body.universe?.trim() || 'top-25-liquidity',
    modelType: body.modelType?.trim() || 'ai-ranked',
    maxRisk,
    signalThreshold,
    entryLogic: body.entryLogic?.trim() || '',
    exitLogic: body.exitLogic?.trim() || '',
    shortEnabled,
    entryShortLogic: shortEnabled ? entryShortLogic : '',
    exitShortLogic: shortEnabled ? exitShortLogic : '',
    sizingNotes,
    notes: body.notes?.trim() || '',
    useAiFilter: body.useAiFilter !== false,
    useRegimeFilter: body.useRegimeFilter !== false,
    paperTradeFirst: body.paperTradeFirst !== false,
    visualDefinition: body.visualDefinition || null,
    codeDefinition:
      authoringMode === 'code' ? body.codeDefinition?.trim() || null : null,
    parameters: Object.keys(normalizedParameters).length ? normalizedParameters : null,
    riskConfig: Object.keys(normalizedRiskConfig).length ? normalizedRiskConfig : null,
  };
};

export const validateStrategyLabBacktestHandoffBody = (
  body: StrategyLabBacktestHandoffBody = {}
): Required<StrategyLabBacktestHandoffBody> => {
  const projectId = body.projectId?.trim();

  if (!projectId) {
    throw new BadRequestAppError('projectId is required');
  }

  return {
    projectId,
  };
};
