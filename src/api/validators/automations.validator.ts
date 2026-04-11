import { AutomationStatus, AutomationType } from '../contracts/Automation';
import { BadRequestAppError } from '../errors/AppError';
import { isValidIanaTimeZone, normalizeTimeZone } from '../utils/timezone';
import {
  ACCEPTED_AUTOMATION_TYPE_INPUTS,
  CANONICAL_AUTOMATION_TYPES,
  normalizeAutomationType,
} from '../utils/automationType';

const VALID_STATUSES: AutomationStatus[] = ['Running', 'Paused', 'Failed', 'Draft'];
const VALID_TYPES: AutomationType[] = CANONICAL_AUTOMATION_TYPES;

export interface AutomationsQuery {
  limit?: string;
  offset?: string;
  status?: string;
  search?: string;
}

export interface CreateAutomationBody {
  name?: string;
  strategy?: string;
  broker?: string;
  market?: string;
  trigger?: string;
  status?: string;
  automationType?: string;
  timeZone?: string | null;
  schedule?: Record<string, unknown> | null;
  riskMode?: string | null;
  config?: Record<string, unknown> | null;
}

export interface ValidatedCreateAutomationBody {
  name: string;
  strategy?: string;
  broker?: string;
  market?: string;
  trigger?: string;
  status: AutomationStatus;
  automationType: AutomationType;
  timeZone: string | null;
  schedule: Record<string, unknown> | null;
  riskMode: string | null;
  config: Record<string, unknown> | null;
}

export interface UpdateAutomationBody {
  name?: string;
  strategy?: string;
  broker?: string;
  market?: string;
  trigger?: string;
  status?: string;
  automationType?: string;
  timeZone?: string | null;
  schedule?: Record<string, unknown> | null;
  riskMode?: string | null;
  config?: Record<string, unknown> | null;
}

export interface ValidatedUpdateAutomationBody {
  name?: string;
  strategy?: string;
  broker?: string;
  market?: string;
  trigger?: string;
  status?: AutomationStatus;
  automationType?: AutomationType;
  timeZone?: string | null;
  schedule?: Record<string, unknown> | null;
  riskMode?: string | null;
  config?: Record<string, unknown> | null;
}

export interface AutomationActionBody {
  reason?: string;
}

export interface ValidatedAutomationsQuery {
  limit: number;
  offset: number;
  status?: AutomationStatus;
  search?: string;
}

const sanitizeRecord = (value: unknown, field: string): Record<string, unknown> | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestAppError(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
};

const parseRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

const readString = (...values: unknown[]): string | null => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
};

const validateTradeSuggestionConfig = (
  config: Record<string, unknown> | null,
  fieldLabel = 'config'
): void => {
  if (!config) {
    throw new BadRequestAppError(`${fieldLabel} is required for trade-suggestion automations`);
  }

  const tradeSuggestion = parseRecord(config.tradeSuggestion);
  const setupScope = parseRecord(tradeSuggestion?.setupScope) ?? parseRecord(config.setupScope);
  const symbol = readString(
    config.symbol,
    tradeSuggestion?.symbol,
    setupScope?.symbol
  );
  const timeframe = readString(
    config.timeframe,
    tradeSuggestion?.timeframe,
    setupScope?.timeframe
  );
  const sourceTemplateId = readString(
    config.sourceTemplateId,
    config.templateId,
    tradeSuggestion?.sourceTemplateId,
    tradeSuggestion?.templateId
  );
  const backtestId = readString(config.backtestId, tradeSuggestion?.backtestId);

  if (!symbol) {
    throw new BadRequestAppError(
      `${fieldLabel} must include a symbol or setupScope.symbol for trade-suggestion automations`
    );
  }
  if (!timeframe) {
    throw new BadRequestAppError(
      `${fieldLabel} must include a timeframe or setupScope.timeframe for trade-suggestion automations`
    );
  }
  if (!sourceTemplateId && !backtestId) {
    throw new BadRequestAppError(
      `${fieldLabel} must include sourceTemplateId/templateId or backtestId for trade-suggestion automations`
    );
  }
};

const validateBacktestRunnerConfig = (
  config: Record<string, unknown> | null,
  fieldLabel = 'config'
): void => {
  if (!config) {
    throw new BadRequestAppError(`${fieldLabel} is required for backtest-runner automations`);
  }

  const runner = parseRecord(config.backtestRunner);
  const nestedConfig = parseRecord(config.config);
  const runBody = parseRecord(runner?.runBody);
  const backtestId = readString(config.backtestId, runner?.backtestId);
  const libraryId = readString(
    config.libraryId,
    config.strategyLibraryId,
    runner?.libraryId,
    runner?.strategyLibraryId,
    runner?.library
  );

  if (!backtestId && !libraryId && !nestedConfig && !runBody) {
    throw new BadRequestAppError(
      `${fieldLabel} must include backtestId, libraryId, or an executable runBody for backtest-runner automations`
    );
  }
};

export const validateAutomationsQuery = (query: AutomationsQuery): ValidatedAutomationsQuery => {
  const limit = query.limit !== undefined ? Number(query.limit) : 20;
  const offset = query.offset !== undefined ? Number(query.offset) : 0;

  if (!Number.isInteger(limit) || limit <= 0 || limit > 100) {
    throw new BadRequestAppError('limit must be an integer between 1 and 100');
  }

  if (!Number.isInteger(offset) || offset < 0) {
    throw new BadRequestAppError('offset must be an integer greater than or equal to 0');
  }

  const status = query.status?.trim();
  if (status && !VALID_STATUSES.includes(status as AutomationStatus)) {
    throw new BadRequestAppError(`status must be one of: ${VALID_STATUSES.join(', ')}`);
  }

  return {
    limit,
    offset,
    status: status as AutomationStatus | undefined,
    search: query.search?.trim() || undefined,
  };
};

export const validateAutomationId = (automationId: string): string => {
  const normalizedAutomationId = automationId.trim();

  if (!normalizedAutomationId) {
    throw new BadRequestAppError('automationId is required');
  }

  return normalizedAutomationId;
};

export const validateAutomationActionBody = (
  body: AutomationActionBody = {}
): AutomationActionBody => {
  if (body.reason !== undefined && typeof body.reason !== 'string') {
    throw new BadRequestAppError('reason must be a string');
  }

  return {
    reason: body.reason?.trim() || undefined,
  };
};

export const validateAutomationCreateBody = (
  body: CreateAutomationBody = {}
): ValidatedCreateAutomationBody => {
  const name = body.name?.trim();
  if (!name) {
    throw new BadRequestAppError('name is required');
  }
  const status = body.status?.trim() || 'Draft';
  if (!VALID_STATUSES.includes(status as AutomationStatus)) {
    throw new BadRequestAppError(`status must be one of: ${VALID_STATUSES.join(', ')}`);
  }
  const automationType = normalizeAutomationType(body.automationType, body.config);
  if (!VALID_TYPES.includes(automationType)) {
    throw new BadRequestAppError(
      `automationType must be one of: ${ACCEPTED_AUTOMATION_TYPE_INPUTS.join(', ')}`
    );
  }
  const timeZone = body.timeZone === null ? null : body.timeZone?.trim();
  if (timeZone && !isValidIanaTimeZone(timeZone)) {
    throw new BadRequestAppError('timeZone must be a valid IANA timezone');
  }
  const config = sanitizeRecord(body.config, 'config') ?? null;

  if (automationType === 'trade-suggestion') {
    validateTradeSuggestionConfig(config);
  } else {
    validateBacktestRunnerConfig(config);
  }

  return {
    name,
    strategy: body.strategy?.trim() || undefined,
    broker: body.broker?.trim() || undefined,
    market: body.market?.trim() || undefined,
    trigger: body.trigger?.trim() || undefined,
    status: status as AutomationStatus,
    automationType,
    timeZone: timeZone ? normalizeTimeZone(timeZone) : null,
    schedule: sanitizeRecord(body.schedule, 'schedule') ?? null,
    riskMode: body.riskMode === null ? null : body.riskMode?.trim() || null,
    config,
  };
};

export const validateAutomationUpdateBody = (
  body: UpdateAutomationBody = {}
): ValidatedUpdateAutomationBody => {
  const status = body.status?.trim();
  if (status && !VALID_STATUSES.includes(status as AutomationStatus)) {
    throw new BadRequestAppError(`status must be one of: ${VALID_STATUSES.join(', ')}`);
  }
  const config = body.config === undefined ? undefined : sanitizeRecord(body.config, 'config') ?? null;
  const automationType =
    body.automationType === undefined
      ? undefined
      : normalizeAutomationType(body.automationType, config);
  if (automationType && !VALID_TYPES.includes(automationType)) {
    throw new BadRequestAppError(
      `automationType must be one of: ${ACCEPTED_AUTOMATION_TYPE_INPUTS.join(', ')}`
    );
  }

  if (config !== undefined) {
    if ((automationType ?? normalizeAutomationType(undefined, config)) === 'trade-suggestion') {
      validateTradeSuggestionConfig(config, 'config');
    } else {
      validateBacktestRunnerConfig(config, 'config');
    }
  }

  const timeZone =
    body.timeZone === undefined ? undefined : body.timeZone === null ? null : body.timeZone.trim();
  if (timeZone && !isValidIanaTimeZone(timeZone)) {
    throw new BadRequestAppError('timeZone must be a valid IANA timezone');
  }

  return {
    name: body.name?.trim() || undefined,
    strategy: body.strategy?.trim() || undefined,
    broker: body.broker?.trim() || undefined,
    market: body.market?.trim() || undefined,
    trigger: body.trigger?.trim() || undefined,
    status: status as AutomationStatus | undefined,
    automationType: automationType as AutomationType | undefined,
    timeZone:
      timeZone === undefined ? undefined : timeZone === null ? null : normalizeTimeZone(timeZone),
    schedule: body.schedule === undefined ? undefined : sanitizeRecord(body.schedule, 'schedule') ?? null,
    riskMode: body.riskMode === undefined ? undefined : body.riskMode === null ? null : body.riskMode.trim(),
    config,
  };
};
