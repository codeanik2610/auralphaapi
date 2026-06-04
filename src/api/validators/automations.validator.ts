import { AutomationStatus, AutomationType } from '../contracts/Automation';
import { BadRequestAppError } from '../errors/AppError';
import { isValidIanaTimeZone, normalizeTimeZone } from '../utils/timezone';
import {
  ACCEPTED_AUTOMATION_TYPE_INPUTS,
  CANONICAL_AUTOMATION_TYPES,
  normalizeTradeSuggestionExecutionPolicy,
  normalizeAutomationType,
  TRADE_SUGGESTION_EXECUTION_MODES,
  TRADE_SUGGESTION_ROUTE_MODES,
} from '../utils/automationType';

const VALID_STATUSES: AutomationStatus[] = ['Running', 'Paused', 'Failed', 'Draft'];
const VALID_TYPES: AutomationType[] = CANONICAL_AUTOMATION_TYPES;
const VALID_LIST_VIEWS = ['full', 'options'] as const;
export type AutomationListView = (typeof VALID_LIST_VIEWS)[number];

export interface AutomationsQuery {
  limit?: string;
  offset?: string;
  status?: string;
  search?: string;
  automationType?: string;
  view?: string;
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

export interface AutomationDeleteBody {
  confirmName?: string;
  confirmPhrase?: string;
  reason?: string;
  previewToken?: string;
}

export interface ValidatedAutomationDeleteBody {
  confirmName: string;
  confirmPhrase: 'DELETE AUTOMATION';
  reason: string;
  previewToken: string;
}

export interface ValidatedAutomationsQuery {
  limit: number;
  offset: number;
  status?: AutomationStatus;
  search?: string;
  automationType?: AutomationType;
  view: AutomationListView;
}

const sanitizeRecord = (
  value: unknown,
  field: string
): Record<string, unknown> | null | undefined => {
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
  const symbol = readString(config.symbol, tradeSuggestion?.symbol, setupScope?.symbol);
  const timeframe = readString(config.timeframe, tradeSuggestion?.timeframe, setupScope?.timeframe);
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

  const executionPolicy = normalizeTradeSuggestionExecutionPolicy(
    tradeSuggestion?.execution ?? config.config ?? null
  );
  const routing = parseRecord(executionPolicy.routing) ?? {};
  const liveConsent = parseRecord(executionPolicy.liveConsent) ?? {};
  const executionMode = readString(executionPolicy.executionMode) ?? 'suggestion_only';
  const routeMode = readString(routing.routeMode) ?? 'strategy_default';
  const brokerKey = readString(routing.brokerKey);

  if (
    !TRADE_SUGGESTION_EXECUTION_MODES.includes(
      executionMode as (typeof TRADE_SUGGESTION_EXECUTION_MODES)[number]
    )
  ) {
    throw new BadRequestAppError(
      `${fieldLabel}.tradeSuggestion.execution.executionMode must be one of: ${TRADE_SUGGESTION_EXECUTION_MODES.join(', ')}`
    );
  }

  if (
    !TRADE_SUGGESTION_ROUTE_MODES.includes(
      routeMode as (typeof TRADE_SUGGESTION_ROUTE_MODES)[number]
    )
  ) {
    throw new BadRequestAppError(
      `${fieldLabel}.tradeSuggestion.execution.routing.routeMode must be one of: ${TRADE_SUGGESTION_ROUTE_MODES.join(', ')}`
    );
  }

  if (routeMode === 'fixed' && !brokerKey) {
    throw new BadRequestAppError(
      `${fieldLabel}.tradeSuggestion.execution.routing.brokerKey is required when routeMode is fixed`
    );
  }

  if (executionMode === 'live_trade_auto' && liveConsent.enabled !== true) {
    throw new BadRequestAppError(
      `${fieldLabel}.tradeSuggestion.execution.liveConsent.enabled must be true for live_trade_auto automations`
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

  const automationType = query.automationType?.trim();
  if (automationType && !VALID_TYPES.includes(automationType as AutomationType)) {
    throw new BadRequestAppError(`automationType must be one of: ${VALID_TYPES.join(', ')}`);
  }

  const view = query.view?.trim() || 'full';
  if (!VALID_LIST_VIEWS.includes(view as AutomationListView)) {
    throw new BadRequestAppError(`view must be one of: ${VALID_LIST_VIEWS.join(', ')}`);
  }

  return {
    limit,
    offset,
    status: status as AutomationStatus | undefined,
    search: query.search?.trim() || undefined,
    automationType: automationType as AutomationType | undefined,
    view: view as AutomationListView,
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

export const validateAutomationDeleteBody = (
  body: AutomationDeleteBody = {}
): ValidatedAutomationDeleteBody => {
  if (body.confirmName !== undefined && typeof body.confirmName !== 'string') {
    throw new BadRequestAppError('confirmName must be a string');
  }
  if (body.confirmPhrase !== undefined && typeof body.confirmPhrase !== 'string') {
    throw new BadRequestAppError('confirmPhrase must be a string');
  }
  if (body.reason !== undefined && typeof body.reason !== 'string') {
    throw new BadRequestAppError('reason must be a string');
  }
  if (body.previewToken !== undefined && typeof body.previewToken !== 'string') {
    throw new BadRequestAppError('previewToken must be a string');
  }

  const confirmName = body.confirmName?.trim();
  const confirmPhrase = body.confirmPhrase?.trim();
  const reason = body.reason?.trim();
  const previewToken = body.previewToken?.trim();

  if (!confirmName) {
    throw new BadRequestAppError('confirmName is required');
  }
  if (confirmPhrase !== 'DELETE AUTOMATION') {
    throw new BadRequestAppError('confirmPhrase must be DELETE AUTOMATION');
  }
  if (!reason) {
    throw new BadRequestAppError('reason is required');
  }
  if (reason.length < 8) {
    throw new BadRequestAppError('reason must be at least 8 characters');
  }
  if (!previewToken) {
    throw new BadRequestAppError('previewToken is required');
  }

  return {
    confirmName,
    confirmPhrase: 'DELETE AUTOMATION',
    reason,
    previewToken,
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
  const config =
    body.config === undefined ? undefined : (sanitizeRecord(body.config, 'config') ?? null);
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
    schedule:
      body.schedule === undefined ? undefined : (sanitizeRecord(body.schedule, 'schedule') ?? null),
    riskMode:
      body.riskMode === undefined
        ? undefined
        : body.riskMode === null
          ? null
          : body.riskMode.trim(),
    config,
  };
};
