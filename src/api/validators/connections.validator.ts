import { BadRequestAppError } from '../errors/AppError';
import { ConnectionActionBody, ConnectionUpsertBody } from '../contracts/Connection';

export interface ConnectionsQuery {
  limit?: string;
  offset?: string;
  type?: string;
  search?: string;
}

export interface ConnectionWorkspaceQuery {
  accountLimit?: string;
  accountOffset?: string;
  accountSearch?: string;
  activityLimit?: string;
  selectedAccountId?: string;
}

export interface ValidatedConnectionsQuery {
  limit: number;
  offset: number;
  type?: string;
  search?: string;
}

export interface ValidatedConnectionWorkspaceQuery {
  accountLimit: number;
  accountOffset: number;
  accountSearch?: string;
  activityLimit: number;
  selectedAccountId?: string;
}

export interface ValidatedConnectionUpsertBody {
  name: string;
  brokerKey: string;
  mode?: string;
  route?: string;
  scope?: string;
}

export const validateConnectionsQuery = (query: ConnectionsQuery): ValidatedConnectionsQuery => {
  const limit = query.limit !== undefined ? Number(query.limit) : 50;
  const offset = query.offset !== undefined ? Number(query.offset) : 0;

  if (!Number.isInteger(limit) || limit <= 0 || limit > 100) {
    throw new BadRequestAppError('limit must be an integer between 1 and 100');
  }

  if (!Number.isInteger(offset) || offset < 0) {
    throw new BadRequestAppError('offset must be an integer greater than or equal to 0');
  }

  return {
    limit,
    offset,
    type: query.type?.trim() || undefined,
    search: query.search?.trim() || undefined,
  };
};

export const validateConnectionId = (connectionId: string): string => {
  const normalizedConnectionId = connectionId.trim();

  if (!normalizedConnectionId) {
    throw new BadRequestAppError('connectionId is required');
  }

  return normalizedConnectionId;
};

export const validateConnectionWorkspaceQuery = (
  query: ConnectionWorkspaceQuery = {}
): ValidatedConnectionWorkspaceQuery => {
  const accountLimit = query.accountLimit !== undefined ? Number(query.accountLimit) : 10;
  const accountOffset = query.accountOffset !== undefined ? Number(query.accountOffset) : 0;
  const activityLimit = query.activityLimit !== undefined ? Number(query.activityLimit) : 4;

  if (!Number.isInteger(accountLimit) || accountLimit <= 0 || accountLimit > 100) {
    throw new BadRequestAppError('accountLimit must be an integer between 1 and 100');
  }

  if (!Number.isInteger(accountOffset) || accountOffset < 0) {
    throw new BadRequestAppError('accountOffset must be an integer greater than or equal to 0');
  }

  if (!Number.isInteger(activityLimit) || activityLimit <= 0 || activityLimit > 20) {
    throw new BadRequestAppError('activityLimit must be an integer between 1 and 20');
  }

  return {
    accountLimit,
    accountOffset,
    accountSearch: query.accountSearch?.trim() || undefined,
    activityLimit,
    selectedAccountId: query.selectedAccountId?.trim() || undefined,
  };
};

const normalizeBrokerKey = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

export const validateConnectionActionBody = (
  body: ConnectionActionBody = {}
): Required<ConnectionActionBody> => {
  return {
    reason: body.reason?.trim() || 'Operator initiated action',
    mode: body.mode?.trim() || 'diagnostic',
    accountId: body.accountId?.trim() || '',
  };
};

export const validateConnectionUpsertBody = (
  body: ConnectionUpsertBody = {}
): ValidatedConnectionUpsertBody => {
  const name = body.name?.trim() || '';
  const brokerKey = normalizeBrokerKey(body.brokerKey || body.name || '');

  if (!name) {
    throw new BadRequestAppError('name is required');
  }

  if (!brokerKey) {
    throw new BadRequestAppError('brokerKey is required');
  }

  return {
    name,
    brokerKey,
    mode: body.mode?.trim() || undefined,
    route: body.route?.trim() || undefined,
    scope: body.scope?.trim() || undefined,
  };
};
