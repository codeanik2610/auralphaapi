import { BadRequestAppError } from '../errors/AppError';
import {
  ImportStrategyTemplateSuggestionBody,
  StrategyTemplateDuplicateBody,
  StrategyTemplateCreateBody,
  StrategyTemplateStatus,
  StrategyTemplateStatusUpdateBody,
  StrategyTemplateUpdateBody,
} from '../contracts/StrategyTemplate';

export const VALID_STRATEGY_TEMPLATE_STATUSES: StrategyTemplateStatus[] = [
  'Draft',
  'Active',
  'Paused',
  'Archived',
];
const VALID_STATUS_SET = new Set<string>(VALID_STRATEGY_TEMPLATE_STATUSES);

const STRATEGY_TEMPLATE_CONFIG_STRIP_KEYS = [
  'assets',
  'timeframes',
  'timeframe',
  'tags',
  'name',
  'description',
  'status'
];

const sanitizeTemplateConfig = (config: unknown): Record<string, unknown> | null => {
  if (config === undefined || config === null) {
    return null;
  }
  if (typeof config !== 'object' || Array.isArray(config)) {
    return null;
  }
  const cleaned = { ...(config as Record<string, unknown>) };
  STRATEGY_TEMPLATE_CONFIG_STRIP_KEYS.forEach((key) => {
    if (key in cleaned) {
      delete cleaned[key];
    }
  });
  return cleaned;
};

export interface StrategyTemplatesQuery {
  limit?: string;
  offset?: string;
  status?: string;
  search?: string;
}

export interface ValidatedStrategyTemplatesQuery {
  limit: number;
  offset: number;
  status?: string;
  search?: string;
}

export const validateStrategyTemplatesQuery = (query: StrategyTemplatesQuery): ValidatedStrategyTemplatesQuery => {
  const limit = query.limit !== undefined ? Number(query.limit) : 20;
  const offset = query.offset !== undefined ? Number(query.offset) : 0;

  if (!Number.isInteger(limit) || limit <= 0 || limit > 100) {
    throw new BadRequestAppError('limit must be an integer between 1 and 100');
  }

  if (!Number.isInteger(offset) || offset < 0) {
    throw new BadRequestAppError('offset must be an integer greater than or equal to 0');
  }

  const status = query.status?.trim();
  if (status && !VALID_STATUS_SET.has(status)) {
    throw new BadRequestAppError(
      'status must be one of: ' + VALID_STRATEGY_TEMPLATE_STATUSES.join(', ')
    );
  }

  return {
    limit,
    offset,
    status: status || undefined,
    search: query.search?.trim() || undefined,
  };
};

export const validateStrategyTemplateId = (strategyId: string): string => {
  const normalized = strategyId.trim();
  if (!normalized) {
    throw new BadRequestAppError('strategyId is required');
  }
  return normalized;
};


export const validateStrategyTemplateCreateBody = (body: StrategyTemplateCreateBody): Required<StrategyTemplateCreateBody> => {
  const name = body.name?.trim();
  if (!name) {
    throw new BadRequestAppError('name is required');
  }

  const status = validateStrategyTemplateStatus(body.status, 'Draft');

  return {
    name,
    description: body.description?.trim() || null,
    status,
    config: sanitizeTemplateConfig(body.config),
  };
};

export const validateStrategyTemplateUpdateBody = (body: StrategyTemplateUpdateBody): StrategyTemplateUpdateBody => {
  return {
    name: body.name?.trim() || undefined,
    description: body.description?.trim() || undefined,
    status: body.status === undefined ? undefined : validateStrategyTemplateStatus(body.status),
    config: body.config === undefined ? undefined : sanitizeTemplateConfig(body.config),
  };
};

export const validateStrategyTemplateStatus = (
  status: unknown,
  fallback?: StrategyTemplateStatus
): StrategyTemplateStatus => {
  const normalized = String(status || '').trim();
  if (!normalized) {
    if (fallback) {
      return fallback;
    }
    throw new BadRequestAppError('status is required');
  }

  if (!VALID_STATUS_SET.has(normalized)) {
    throw new BadRequestAppError(
      'status must be one of: ' + VALID_STRATEGY_TEMPLATE_STATUSES.join(', ')
    );
  }

  return normalized as StrategyTemplateStatus;
};

export const validateStrategyTemplateStatusUpdateBody = (
  body: StrategyTemplateStatusUpdateBody
): Required<StrategyTemplateStatusUpdateBody> => ({
  status: validateStrategyTemplateStatus(body.status),
});

export const validateStrategyTemplateDuplicateBody = (
  body: StrategyTemplateDuplicateBody
): StrategyTemplateDuplicateBody => ({
  name: body.name?.trim() || undefined,
  targetUserId: body.targetUserId?.trim() || undefined,
});

export interface ValidatedImportStrategyTemplateSuggestionBody {
  userId: string;
  suggestionId: string;
  templateId: string | null;
  templateName: string | null;
  suggestedName: string;
  diffSummary: string;
  reasoning: string;
  suggestedConfig: Record<string, unknown> | null;
}

export const validateImportStrategyTemplateSuggestionBody = (
  body: ImportStrategyTemplateSuggestionBody
): ValidatedImportStrategyTemplateSuggestionBody => {
  const userId = String(body.userId || '').trim();
  if (!userId) {
    throw new BadRequestAppError('userId is required');
  }

  const suggestionId = String(body.suggestionId || '').trim();
  if (!suggestionId) {
    throw new BadRequestAppError('suggestionId is required');
  }

  const templateName = String(body.templateName || '').trim() || null;
  const suggestedName =
    String(body.suggestedName || '').trim() ||
    `${templateName || 'Strategy Template'} (Improved)`;
  const suggestedConfig = sanitizeTemplateConfig(body.suggestedConfig);

  if (!suggestedConfig) {
    throw new BadRequestAppError('suggestedConfig is required');
  }

  return {
    userId,
    suggestionId,
    templateId: String(body.templateId || '').trim() || null,
    templateName,
    suggestedName,
    diffSummary: String(body.diffSummary || '').trim(),
    reasoning: String(body.reasoning || '').trim(),
    suggestedConfig,
  };
};
