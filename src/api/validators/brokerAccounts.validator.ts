import { BadRequestAppError } from '../errors/AppError';
import { BrokerAccountUpsertBody } from '../contracts/BrokerAccount';

export interface BrokerAccountsQuery {
  limit?: string;
  offset?: string;
  connectionId?: string;
  brokerKey?: string;
  status?: string;
  search?: string;
}

export interface ValidatedBrokerAccountsQuery {
  limit: number;
  offset: number;
  connectionId?: string;
  brokerKey?: string;
  status?: string;
  search?: string;
}

export interface ValidatedBrokerAccountUpsertBody {
  connectionId: string;
  brokerKey: string;
  accountKey: string;
  accountName: string;
  mode?: string;
  purpose?: string;
  capabilities?: string;
  settings?: Record<string, unknown> | null;
  isDefault: boolean;
}

const normalizeOptional = (value?: string): string | undefined => {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
};

const normalizeKey = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const validateBrokerAccountSettings = (
  _brokerKey: string,
  settings?: Record<string, unknown>
): Record<string, unknown> | undefined => {
  if (!settings) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(settings).map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value])
  );
};

export const validateBrokerAccountsQuery = (
  query: BrokerAccountsQuery = {}
): ValidatedBrokerAccountsQuery => {
  const limit = Number.parseInt(query.limit || '50', 10);
  const offset = Number.parseInt(query.offset || '0', 10);

  if (Number.isNaN(limit) || limit < 1 || limit > 200) {
    throw new BadRequestAppError('limit must be between 1 and 200');
  }

  if (Number.isNaN(offset) || offset < 0) {
    throw new BadRequestAppError('offset must be 0 or greater');
  }

  return {
    limit,
    offset,
    connectionId: normalizeOptional(query.connectionId),
    brokerKey: normalizeOptional(query.brokerKey),
    status: normalizeOptional(query.status),
    search: normalizeOptional(query.search),
  };
};

export const validateBrokerAccountId = (accountId: string): string => {
  const normalized = accountId.trim();
  if (!normalized) {
    throw new BadRequestAppError('accountId is required');
  }
  return normalized;
};

export const validateBrokerAccountUpsertBody = (
  body: BrokerAccountUpsertBody = {}
): ValidatedBrokerAccountUpsertBody => {
  const connectionId = normalizeOptional(body.connectionId);
  const brokerKey = normalizeKey(body.brokerKey || '');
  const accountKey = normalizeKey(body.accountKey || body.accountName || '');
  const accountName = normalizeOptional(body.accountName);

  if (!connectionId) {
    throw new BadRequestAppError('connectionId is required');
  }
  if (!brokerKey) {
    throw new BadRequestAppError('brokerKey is required');
  }
  if (!accountKey) {
    throw new BadRequestAppError('accountKey is required');
  }
  if (!accountName) {
    throw new BadRequestAppError('accountName is required');
  }

  const settingsCandidate =
    body.settings && typeof body.settings === 'object' && !Array.isArray(body.settings)
      ? body.settings
      : body.settings == null
        ? undefined
        : (() => {
            throw new BadRequestAppError('settings must be an object');
          })();

  const settings = validateBrokerAccountSettings(brokerKey, settingsCandidate);

  return {
    connectionId,
    brokerKey,
    accountKey,
    accountName,
    mode: normalizeOptional(body.mode),
    purpose: normalizeOptional(body.purpose),
    capabilities: normalizeOptional(body.capabilities),
    settings,
    isDefault: Boolean(body.isDefault),
  };
};
