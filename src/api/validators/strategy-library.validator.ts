import { BadRequestAppError } from '../errors/AppError';
import {
  StrategyLibraryImportBody,
  StrategyLibraryRunBody,
  StrategyLibraryStatus,
  StrategyLibraryStatusUpdateBody,
  StrategyLibraryUpdateBody,
} from '../contracts/StrategyLibrary';
import { STRATEGY_LIBRARY_STATUSES } from '../utils/strategyLibraryLifecycle';

const VALID_STATUSES = STRATEGY_LIBRARY_STATUSES;
const VALID_STATUS_SET = new Set<StrategyLibraryStatus>(VALID_STATUSES);

const sanitizeOverrides = (overrides: unknown): Record<string, unknown> | null => {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
    return null;
  }
  const cleaned = { ...(overrides as Record<string, unknown>) };
  if ('required' in cleaned) {
    delete cleaned.required;
  }
  if ('risk' in cleaned) {
    delete cleaned.risk;
  }
  return Object.keys(cleaned).length ? cleaned : null;
};

const validateDateString = (value: string, fieldName: 'start' | 'end'): string => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestAppError(`${fieldName} must be a valid date or datetime string`);
  }

  return value;
};

export interface StrategyLibraryQuery {
  limit?: string;
  offset?: string;
  status?: string;
  search?: string;
  sort?: string;
  hasAssets?: string;
  hasTimeframes?: string;
  scopeReady?: string;
  automationReady?: string;
  lastRunFailed?: string;
}

export interface StrategyLibraryRunsQuery {
  limit?: string;
}

export type StrategyLibrarySort =
  | 'updated_desc'
  | 'updated_asc'
  | 'name_asc'
  | 'name_desc'
  | 'latest_run_desc'
  | 'latest_run_asc';

const VALID_LIBRARY_SORTS: StrategyLibrarySort[] = [
  'updated_desc',
  'updated_asc',
  'name_asc',
  'name_desc',
  'latest_run_desc',
  'latest_run_asc',
];
const VALID_LIBRARY_SORT_SET = new Set<StrategyLibrarySort>(VALID_LIBRARY_SORTS);

export interface ValidatedStrategyLibraryQuery {
  limit: number;
  offset: number;
  status?: StrategyLibraryStatus;
  search?: string;
  sort: StrategyLibrarySort;
  hasAssets?: boolean;
  hasTimeframes?: boolean;
  scopeReady?: boolean;
  automationReady?: boolean;
  lastRunFailed?: boolean;
}

export interface ValidatedStrategyLibraryRunsQuery {
  limit: number;
}

const parseOptionalBoolean = (
  value: string | undefined,
  fieldName: string
): boolean | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  if (['true', '1', 'yes'].includes(normalized)) {
    return true;
  }

  if (['false', '0', 'no'].includes(normalized)) {
    return false;
  }

  throw new BadRequestAppError(`${fieldName} must be true or false`);
};

export const validateStrategyLibraryQuery = (query: StrategyLibraryQuery): ValidatedStrategyLibraryQuery => {
  const limit = query.limit !== undefined ? Number(query.limit) : 20;
  const offset = query.offset !== undefined ? Number(query.offset) : 0;

  if (!Number.isInteger(limit) || limit <= 0 || limit > 100) {
    throw new BadRequestAppError('limit must be an integer between 1 and 100');
  }

  if (!Number.isInteger(offset) || offset < 0) {
    throw new BadRequestAppError('offset must be an integer greater than or equal to 0');
  }

  const status = query.status?.trim();
  if (status && !VALID_STATUS_SET.has(status as StrategyLibraryStatus)) {
    throw new BadRequestAppError('status must be one of: ' + VALID_STATUSES.join(', '));
  }

  const sort = String(query.sort || 'updated_desc').trim().toLowerCase() as StrategyLibrarySort;
  if (!VALID_LIBRARY_SORT_SET.has(sort)) {
    throw new BadRequestAppError('sort must be one of: ' + VALID_LIBRARY_SORTS.join(', '));
  }

  return {
    limit,
    offset,
    status: status ? validateStrategyLibraryStatus(status) : undefined,
    search: query.search?.trim() || undefined,
    sort,
    hasAssets: parseOptionalBoolean(query.hasAssets, 'hasAssets'),
    hasTimeframes: parseOptionalBoolean(query.hasTimeframes, 'hasTimeframes'),
    scopeReady: parseOptionalBoolean(query.scopeReady, 'scopeReady'),
    automationReady: parseOptionalBoolean(query.automationReady, 'automationReady'),
    lastRunFailed: parseOptionalBoolean(query.lastRunFailed, 'lastRunFailed'),
  };
};

export const validateStrategyLibraryRunsQuery = (
  query: StrategyLibraryRunsQuery
): ValidatedStrategyLibraryRunsQuery => {
  const limit = query.limit !== undefined ? Number(query.limit) : 5;

  if (!Number.isInteger(limit) || limit <= 0 || limit > 20) {
    throw new BadRequestAppError('limit must be an integer between 1 and 20');
  }

  return {
    limit,
  };
};

export const validateStrategyLibraryId = (id: string): string => {
  const normalized = id.trim();
  if (!normalized) {
    throw new BadRequestAppError('id is required');
  }
  return normalized;
};

export const validateStrategyLibraryStatus = (
  status: unknown,
  fallback?: StrategyLibraryStatus
): StrategyLibraryStatus => {
  const normalized = String(status || '').trim();
  if (!normalized) {
    if (fallback) {
      return fallback;
    }
    throw new BadRequestAppError('status is required');
  }

  if (!VALID_STATUS_SET.has(normalized as StrategyLibraryStatus)) {
    throw new BadRequestAppError('status must be one of: ' + VALID_STATUSES.join(', '));
  }

  return normalized as StrategyLibraryStatus;
};

export const validateStrategyLibraryImportBody = (
  body: StrategyLibraryImportBody
): Required<StrategyLibraryImportBody> => {
  const templateId = body.templateId?.trim();
  if (!templateId) {
    throw new BadRequestAppError('templateId is required');
  }

  const name = body.name?.trim();
  if (!name) {
    throw new BadRequestAppError('name is required');
  }

  const status = validateStrategyLibraryStatus(body.status, 'Draft');
  if (status === 'Archived') {
    throw new BadRequestAppError(
      'Imported strategy library entries must start as Draft, Active, or Paused'
    );
  }

  return {
    templateId,
    name,
    status,
    assets: body.assets ?? null,
    timeframes: body.timeframes ?? null,
    overrides: sanitizeOverrides(body.overrides),
  };
};


export const validateStrategyLibraryUpdateBody = (
  body: StrategyLibraryUpdateBody
): StrategyLibraryUpdateBody => {
  if (Object.prototype.hasOwnProperty.call(body, 'status')) {
    throw new BadRequestAppError(
      'status updates must use the strategy library lifecycle endpoint'
    );
  }

  return {
    name: body.name?.trim() || undefined,
    assets: body.assets === undefined ? undefined : body.assets,
    timeframes: body.timeframes === undefined ? undefined : body.timeframes,
    overrides: body.overrides === undefined ? undefined : sanitizeOverrides(body.overrides),
  };
};

export const validateStrategyLibraryStatusUpdateBody = (
  body: StrategyLibraryStatusUpdateBody
): Required<StrategyLibraryStatusUpdateBody> => ({
  status: validateStrategyLibraryStatus(body.status),
});

export const validateStrategyLibraryRunBody = (
  body: StrategyLibraryRunBody
): StrategyLibraryRunBody => {
  const rawStart = body.start !== undefined && body.start !== null ? String(body.start).trim() : null;
  const rawEnd = body.end !== undefined && body.end !== null ? String(body.end).trim() : null;
  const automationId =
    body.automationId !== undefined && body.automationId !== null
      ? String(body.automationId).trim()
      : null;
  const automationRunId =
    body.automationRunId !== undefined && body.automationRunId !== null
      ? String(body.automationRunId).trim()
      : null;

  if (body.start !== undefined && body.start !== null && !rawStart) {
    throw new BadRequestAppError('start must be a non-empty string or null');
  }
  if (body.end !== undefined && body.end !== null && !rawEnd) {
    throw new BadRequestAppError('end must be a non-empty string or null');
  }
  if (body.automationId !== undefined && body.automationId !== null && !automationId) {
    throw new BadRequestAppError('automationId must be a non-empty string or null');
  }
  if (body.automationRunId !== undefined && body.automationRunId !== null && !automationRunId) {
    throw new BadRequestAppError('automationRunId must be a non-empty string or null');
  }

  const start = rawStart ? validateDateString(rawStart, 'start') : rawStart;
  const end = rawEnd ? validateDateString(rawEnd, 'end') : rawEnd;

  return {
    assets: body.assets ?? null,
    timeframes: body.timeframes ?? null,
    overrides: sanitizeOverrides(body.overrides),
    start,
    end,
    automationId,
    automationRunId,
  };
};
