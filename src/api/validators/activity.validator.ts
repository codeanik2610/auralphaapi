import {
  ActivityActionFilterBody,
  ActivityExportBody,
  ActivityFeedView,
  ActivityGroupBy,
  ActivityReadState,
  ActivitySaveViewBody,
  ActivitySortBy,
  ActivitySortOrder,
} from '../contracts/Activity';
import { BadRequestAppError } from '../errors/AppError';

export interface ActivityQuery extends ActivityActionFilterBody {
  limit?: string;
  offset?: string;
  sortBy?: string;
  sortOrder?: string;
  view?: string;
  groupBy?: string;
}

export interface ValidatedActivityFilterInput {
  type?: string;
  status?: string;
  search?: string;
  stream?: string;
  route?: string;
  referenceId?: string;
  correlationId?: string;
  related?: string;
  readState: ActivityReadState;
  savedViewId?: string;
}

export interface ValidatedActivityQuery extends ValidatedActivityFilterInput {
  limit: number;
  offset: number;
  sortBy: ActivitySortBy;
  sortOrder: ActivitySortOrder;
  view: ActivityFeedView;
  groupBy?: ActivityGroupBy;
}

export interface ActivityExportHistoryQuery {
  limit?: string;
  offset?: string;
}

export interface ValidatedActivityExportHistoryQuery {
  limit: number;
  offset: number;
}

export type ValidatedActivityActionFilterBody = ValidatedActivityFilterInput;

export interface ValidatedActivityExportBody extends ValidatedActivityActionFilterBody {
  scope: string;
  format: 'csv' | 'json';
}

export interface ValidatedActivitySaveViewBody {
  name: string;
  description?: string;
  isDefault: boolean;
  view: ActivityFeedView;
  groupBy?: ActivityGroupBy;
  sortBy: ActivitySortBy;
  sortOrder: ActivitySortOrder;
  readState: ActivityReadState;
  type?: string;
  status?: string;
  search?: string;
  stream?: string;
  route?: string;
  referenceId?: string;
  correlationId?: string;
  related?: string;
}

function normalizeActivityFilters<T extends ActivityActionFilterBody>(query: T) {
  return {
    type: query.type?.trim() || undefined,
    status: query.status?.trim() || undefined,
    search: query.search?.trim() || undefined,
    stream: query.stream?.trim() || undefined,
    route: query.route?.trim() || undefined,
    referenceId: query.referenceId?.trim() || undefined,
    correlationId: query.correlationId?.trim() || undefined,
    related: query.related?.trim() || undefined,
    savedViewId: 'savedViewId' in query ? query.savedViewId?.trim() || undefined : undefined,
  };
}

const validateActivitySortBy = (value?: string): ActivitySortBy => {
  const normalized = value?.trim().toLowerCase() || 'time';
  if (!['time', 'status', 'type', 'route', 'stream'].includes(normalized)) {
    throw new BadRequestAppError('sortBy must be time, status, type, route, or stream');
  }
  return normalized as ActivitySortBy;
};

const validateActivitySortOrder = (value?: string): ActivitySortOrder => {
  const normalized = value?.trim().toLowerCase() || 'desc';
  if (normalized !== 'asc' && normalized !== 'desc') {
    throw new BadRequestAppError('sortOrder must be asc or desc');
  }
  return normalized as ActivitySortOrder;
};

const validateActivityView = (value?: string): ActivityFeedView => {
  const normalized = value?.trim().toLowerCase() || 'feed';
  if (!['feed', 'grouped', 'clustered'].includes(normalized)) {
    throw new BadRequestAppError('view must be feed, grouped, or clustered');
  }
  return normalized as ActivityFeedView;
};

const validateActivityGroupBy = (value?: string): ActivityGroupBy | undefined => {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (!['day', 'route', 'stream', 'status', 'type'].includes(normalized)) {
    throw new BadRequestAppError('groupBy must be day, route, stream, status, or type');
  }
  return normalized as ActivityGroupBy;
};

const validateActivityReadState = (value?: string): ActivityReadState => {
  const normalized = value?.trim().toLowerCase() || 'all';
  if (!['all', 'read', 'unread'].includes(normalized)) {
    throw new BadRequestAppError('readState must be all, read, or unread');
  }
  return normalized as ActivityReadState;
};

export const validateActivityActionFilterBody = (
  body: ActivityActionFilterBody = {}
): ValidatedActivityActionFilterBody => ({
  readState: validateActivityReadState(body.readState),
  ...normalizeActivityFilters(body),
});

export const validateActivityQuery = (query: ActivityQuery): ValidatedActivityQuery => {
  const limit = query.limit !== undefined ? Number(query.limit) : 50;
  const offset = query.offset !== undefined ? Number(query.offset) : 0;

  if (!Number.isInteger(limit) || limit <= 0 || limit > 100) {
    throw new BadRequestAppError('limit must be an integer between 1 and 100');
  }

  if (!Number.isInteger(offset) || offset < 0) {
    throw new BadRequestAppError('offset must be an integer greater than or equal to 0');
  }

  const view = validateActivityView(query.view);
  const groupBy = validateActivityGroupBy(query.groupBy);

  return {
    limit,
    offset,
    sortBy: validateActivitySortBy(query.sortBy),
    sortOrder: validateActivitySortOrder(query.sortOrder),
    view,
    groupBy: view === 'feed' ? groupBy : groupBy || 'day',
    ...validateActivityActionFilterBody(query),
  };
};

export const validateActivityId = (activityId: string): string => {
  const normalizedActivityId = activityId.trim();

  if (!normalizedActivityId) {
    throw new BadRequestAppError('activityId is required');
  }

  return normalizedActivityId;
};

export const validateActivityExportBody = (
  body: ActivityExportBody = {}
): ValidatedActivityExportBody => {
  const format = body.format?.trim().toLowerCase() || 'csv';
  if (format !== 'csv' && format !== 'json') {
    throw new BadRequestAppError('format must be csv or json');
  }

  const scope = body.scope?.trim().toLowerCase() || 'all';
  if (!['all', 'controls', 'execution', 'automation'].includes(scope)) {
    throw new BadRequestAppError('scope must be all, controls, execution, or automation');
  }

  return {
    scope,
    format,
    ...validateActivityActionFilterBody(body),
  };
};

export const validateActivitySaveViewBody = (
  body: ActivitySaveViewBody = {},
  options: { requireName?: boolean } = {}
): ValidatedActivitySaveViewBody => {
  const requireName = options.requireName ?? true;
  const name = body.name?.trim() || '';
  if (requireName && !name) {
    throw new BadRequestAppError('name is required');
  }

  const view = validateActivityView(body.view);
  const groupBy = validateActivityGroupBy(body.groupBy);

  return {
    name: name || 'Untitled activity view',
    description: body.description?.trim() || undefined,
    isDefault: body.isDefault === true,
    view,
    groupBy: view === 'grouped' ? groupBy || 'day' : groupBy,
    sortBy: validateActivitySortBy(body.sortBy),
    sortOrder: validateActivitySortOrder(body.sortOrder),
    readState: validateActivityReadState(body.readState),
    type: body.type?.trim() || undefined,
    status: body.status?.trim() || undefined,
    search: body.search?.trim() || undefined,
    stream: body.stream?.trim() || undefined,
    route: body.route?.trim() || undefined,
    referenceId: body.referenceId?.trim() || undefined,
    correlationId: body.correlationId?.trim() || undefined,
    related: body.related?.trim() || undefined,
  };
};

export const validateActivityExportHistoryQuery = (
  query: ActivityExportHistoryQuery = {}
): ValidatedActivityExportHistoryQuery => {
  const limit = query.limit !== undefined ? Number(query.limit) : 20;
  const offset = query.offset !== undefined ? Number(query.offset) : 0;

  if (!Number.isInteger(limit) || limit <= 0 || limit > 100) {
    throw new BadRequestAppError('limit must be an integer between 1 and 100');
  }

  if (!Number.isInteger(offset) || offset < 0) {
    throw new BadRequestAppError('offset must be an integer greater than or equal to 0');
  }

  return { limit, offset };
};
