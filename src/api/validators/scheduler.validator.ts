import { BadRequestAppError } from '../errors/AppError';
import {
  DiscoveryTemplateImprovementPolicy,
  FundsHealthThresholds,
  FundsSchedulerRunNowBody,
  OrdersSchedulerRunNowBody,
  PositionsSchedulerReadModelRebuildBody,
  UpdateSchedulerConfigBody,
} from '../contracts/Scheduler';
import {
  DISCOVERY_POLICY_ALLOWED_TIMEFRAMES,
  normalizeDiscoveryTemplateImprovementPolicy,
} from '../utils/discoveryPolicy';
import { ASSET_PRICE_SYNC_SYSTEM_SOURCES } from '../utils/assetPriceContract';

const ALLOWED_DISCOVERY_TIMEFRAMES = new Set<string>(DISCOVERY_POLICY_ALLOWED_TIMEFRAMES);

function validateDiscoveryTemplateImprovementPolicy(
  value: unknown
): DiscoveryTemplateImprovementPolicy {
  return normalizeDiscoveryTemplateImprovementPolicy(value, { requireComplete: true });
}

function validateFundsHealthThresholds(
  value: unknown
): FundsHealthThresholds | null {
  if (value === null) {
    return null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestAppError('fundsHealthThresholds must be an object');
  }

  const input = value as Record<string, unknown>;
  const payload: FundsHealthThresholds = {};
  const thresholdKeys: Array<keyof FundsHealthThresholds> = [
    'maxStaleAccounts',
    'maxMissingAccounts',
    'maxFailedLatestAttempts',
    'maxLatestSnapshotAgeMinutes',
    'maxLatestAttemptAgeMinutes',
  ];

  for (const key of thresholdKeys) {
    if (!(key in input)) {
      continue;
    }
    const raw = input[key];
    if (raw === null) {
      payload[key] = null;
      continue;
    }
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new BadRequestAppError(
        `${key} must be a non-negative integer or null when provided`
      );
    }
    payload[key] = parsed;
  }

  return payload;
}

export function validateListQuery(query: { limit?: string; offset?: string }): {
  limit: number;
  offset: number;
} {
  const limit = query.limit !== undefined ? Number(query.limit) : 20;
  const offset = query.offset !== undefined ? Number(query.offset) : 0;

  if (!Number.isInteger(limit) || limit <= 0 || limit > 200) {
    throw new BadRequestAppError('limit must be an integer between 1 and 200');
  }

  if (!Number.isInteger(offset) || offset < 0) {
    throw new BadRequestAppError('offset must be a non-negative integer');
  }

  return { limit, offset };
}

export function validateUpdateLogSortQuery(query: {
  sortBy?: string;
  sortOrder?: string;
}): {
  sortBy: 'createdAt' | 'actionType' | 'source' | 'symbol';
  sortOrder: 'asc' | 'desc';
} {
  const sortByInput = String(query.sortBy || 'createdAt').trim();
  const sortOrderInput = String(query.sortOrder || 'desc').trim().toLowerCase();

  const allowedSortBy = new Set(['createdAt', 'actionType', 'source', 'symbol']);
  if (!allowedSortBy.has(sortByInput)) {
    throw new BadRequestAppError('sortBy must be one of createdAt, actionType, source, symbol');
  }

  if (!['asc', 'desc'].includes(sortOrderInput)) {
    throw new BadRequestAppError('sortOrder must be asc or desc');
  }

  return {
    sortBy: sortByInput as 'createdAt' | 'actionType' | 'source' | 'symbol',
    sortOrder: sortOrderInput as 'asc' | 'desc',
  };
}

export function validateSchedulerConfigBody(
  body: Partial<UpdateSchedulerConfigBody>
): Partial<UpdateSchedulerConfigBody> {
  const payload: Partial<UpdateSchedulerConfigBody> = {};

  if (body.name !== undefined) {
    const name = String(body.name || '').trim();
    if (!name) {
      throw new BadRequestAppError('name cannot be empty');
    }
    payload.name = name;
  }

  if (body.description !== undefined) {
    if (body.description === null) {
      payload.description = null;
    } else {
      payload.description = String(body.description || '').trim() || null;
    }
  }

  if (body.enabled !== undefined) {
    payload.enabled = Boolean(body.enabled);
  }

  if (body.applyToAllUsers !== undefined) {
    payload.applyToAllUsers = Boolean(body.applyToAllUsers);
  }

  if (body.cronExpression !== undefined) {
    const cronExpression = String(body.cronExpression || '').trim();
    if (!cronExpression) {
      throw new BadRequestAppError('cronExpression cannot be empty');
    }
    payload.cronExpression = cronExpression;
  }

  if (body.runAt !== undefined) {
    const runAt = String(body.runAt || '').trim();
    if (!/^\d{2}:\d{2}$/.test(runAt)) {
      throw new BadRequestAppError('runAt must be in HH:mm format');
    }
    const [hour, minute] = runAt.split(':').map(Number);
    if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      throw new BadRequestAppError('runAt must be a valid 24-hour time');
    }
    payload.runAt = runAt;
  }

  if (body.intervalDays !== undefined) {
    const intervalDays = Number(body.intervalDays);
    if (!Number.isInteger(intervalDays) || intervalDays < 1 || intervalDays > 30) {
      throw new BadRequestAppError('intervalDays must be an integer between 1 and 30');
    }
    payload.intervalDays = intervalDays;
  }

  if (body.scheduleMode !== undefined) {
    const scheduleMode = String(body.scheduleMode || '').trim().toLowerCase();
    if (!['daily', 'every_n_minutes', 'every_n_seconds', 'hourly_at_minute'].includes(scheduleMode)) {
      throw new BadRequestAppError('scheduleMode must be daily, every_n_minutes, every_n_seconds, or hourly_at_minute');
    }
    payload.scheduleMode = scheduleMode as
      | 'daily'
      | 'every_n_minutes'
      | 'every_n_seconds'
      | 'hourly_at_minute';
  }

  if (body.intervalMinutes !== undefined) {
    const intervalMinutes = Number(body.intervalMinutes);
    if (!Number.isInteger(intervalMinutes) || intervalMinutes < 1 || intervalMinutes > 60) {
      throw new BadRequestAppError('intervalMinutes must be an integer between 1 and 60');
    }
    payload.intervalMinutes = intervalMinutes;
  }

  if (body.intervalSeconds !== undefined) {
    const intervalSeconds = Number(body.intervalSeconds);
    if (!Number.isInteger(intervalSeconds) || intervalSeconds < 1 || intervalSeconds > 60) {
      throw new BadRequestAppError('intervalSeconds must be an integer between 1 and 60');
    }
    payload.intervalSeconds = intervalSeconds;
  }

  if (body.hourlyMinute !== undefined) {
    const hourlyMinute = Number(body.hourlyMinute);
    if (!Number.isInteger(hourlyMinute) || hourlyMinute < 0 || hourlyMinute > 59) {
      throw new BadRequestAppError('hourlyMinute must be an integer between 0 and 59');
    }
    payload.hourlyMinute = hourlyMinute;
  }

  if (body.schedulerType !== undefined) {
    const schedulerType = String(body.schedulerType || '').trim().toLowerCase();
    if (schedulerType !== 'global' && schedulerType !== 'user') {
      throw new BadRequestAppError('schedulerType must be global or user');
    }
    payload.schedulerType = schedulerType as 'global' | 'user';
  }

  if (body.batchSize !== undefined) {
    const batchSize = Number(body.batchSize);
    if (!Number.isInteger(batchSize) || batchSize < 10 || batchSize > 1000) {
      throw new BadRequestAppError('batchSize must be an integer between 10 and 1000');
    }
    payload.batchSize = batchSize;
  }

  if (body.sources !== undefined) {
    if (!Array.isArray(body.sources)) {
      throw new BadRequestAppError('sources must be an array');
    }

    const sources = Array.from(
      new Set(
        body.sources
          .map((item) => String(item || '').trim().toLowerCase())
          .filter(Boolean)
      )
    );

    if (!sources.length) {
      throw new BadRequestAppError('sources must contain at least one broker key');
    }

    payload.sources = sources;
  }

  if (body.retentionDays !== undefined) {
    const retentionDays = Number(body.retentionDays);
    if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 365) {
      throw new BadRequestAppError('retentionDays must be an integer between 1 and 365');
    }
    payload.retentionDays = retentionDays;
  }

  if (body.lookbackDays !== undefined) {
    const lookbackDays = Number(body.lookbackDays);
    if (!Number.isInteger(lookbackDays) || lookbackDays < 1 || lookbackDays > 90) {
      throw new BadRequestAppError('lookbackDays must be an integer between 1 and 90');
    }
    payload.lookbackDays = lookbackDays;
  }

  if (body.selectionMode !== undefined) {
    const selectionMode = String(body.selectionMode || '').trim().toLowerCase();
    if (selectionMode !== 'all' && selectionMode !== 'custom') {
      throw new BadRequestAppError('selectionMode must be all or custom');
    }
    payload.selectionMode = selectionMode as 'all' | 'custom';
  }

  if (body.selectedAssetIds !== undefined) {
    if (!Array.isArray(body.selectedAssetIds)) {
      throw new BadRequestAppError('selectedAssetIds must be an array');
    }

    payload.selectedAssetIds = Array.from(
      new Set(
        body.selectedAssetIds
          .map((item) => String(item || '').trim())
          .filter(Boolean)
      )
    );
  }

  if (body.timeframes !== undefined) {
    if (!Array.isArray(body.timeframes)) {
      throw new BadRequestAppError('timeframes must be an array');
    }

    const timeframes = Array.from(
      new Set(
        body.timeframes
          .map((item) => String(item || '').trim().toLowerCase())
          .filter((item) => ALLOWED_DISCOVERY_TIMEFRAMES.has(item))
      )
    );

    if (!timeframes.length) {
      throw new BadRequestAppError('timeframes must include at least one supported value');
    }

    payload.timeframes = timeframes;
  }

  if (body.discoveryPolicy !== undefined) {
    payload.discoveryPolicy = validateDiscoveryTemplateImprovementPolicy(body.discoveryPolicy);
  }

  if (body.fundsHealthThresholds !== undefined) {
    payload.fundsHealthThresholds = validateFundsHealthThresholds(body.fundsHealthThresholds);
  }

  return payload;
}

export function validateOrdersSchedulerRunBody(body: unknown): OrdersSchedulerRunNowBody {
  const payload =
    body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  const accountId = String(payload.accountId || '').trim();
  const brokerKey = String(payload.brokerKey || '').trim().toLowerCase();
  const resetCheckpoint = payload.resetCheckpoint === true;

  if (payload.accountId !== undefined && !accountId) {
    throw new BadRequestAppError('accountId cannot be empty when provided');
  }

  if (payload.brokerKey !== undefined && !brokerKey) {
    throw new BadRequestAppError('brokerKey cannot be empty when provided');
  }

  if (payload.resetCheckpoint !== undefined && typeof payload.resetCheckpoint !== 'boolean') {
    throw new BadRequestAppError('resetCheckpoint must be a boolean when provided');
  }

  if (resetCheckpoint && !accountId) {
    throw new BadRequestAppError('resetCheckpoint requires accountId');
  }

  return {
    ...(accountId ? { accountId } : {}),
    ...(brokerKey ? { brokerKey } : {}),
    ...(payload.resetCheckpoint !== undefined ? { resetCheckpoint } : {}),
  };
}

export function validateFundsSchedulerRunBody(body: unknown): FundsSchedulerRunNowBody {
  const payload =
    body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  const accountId = String(payload.accountId || '').trim();
  const brokerKey = String(payload.brokerKey || '').trim().toLowerCase();

  if (payload.accountId !== undefined && !accountId) {
    throw new BadRequestAppError('accountId cannot be empty when provided');
  }

  if (payload.brokerKey !== undefined && !brokerKey) {
    throw new BadRequestAppError('brokerKey cannot be empty when provided');
  }

  return {
    ...(accountId ? { accountId } : {}),
    ...(brokerKey ? { brokerKey } : {}),
  };
}

export function validatePositionsSchedulerReadModelRebuildBody(
  body: unknown
): PositionsSchedulerReadModelRebuildBody {
  const payload =
    body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};

  const accountId = String(payload.accountId || '').trim();
  const ownerUserId = String(payload.ownerUserId || '').trim();
  const brokerKey = String(payload.brokerKey || '').trim().toLowerCase();
  const rebuildAll = payload.rebuildAll === true;
  const onlyDrifted =
    payload.onlyDrifted === undefined ? true : payload.onlyDrifted === true;
  const limitRaw = payload.limit === undefined ? undefined : Number(payload.limit);

  if (payload.accountId !== undefined && !accountId) {
    throw new BadRequestAppError('accountId cannot be empty when provided');
  }

  if (payload.ownerUserId !== undefined && !ownerUserId) {
    throw new BadRequestAppError('ownerUserId cannot be empty when provided');
  }

  if (payload.brokerKey !== undefined && !brokerKey) {
    throw new BadRequestAppError('brokerKey cannot be empty when provided');
  }

  if (payload.rebuildAll !== undefined && typeof payload.rebuildAll !== 'boolean') {
    throw new BadRequestAppError('rebuildAll must be a boolean when provided');
  }

  if (payload.onlyDrifted !== undefined && typeof payload.onlyDrifted !== 'boolean') {
    throw new BadRequestAppError('onlyDrifted must be a boolean when provided');
  }

  if (
    limitRaw !== undefined &&
    (!Number.isInteger(limitRaw) || limitRaw <= 0 || limitRaw > 200)
  ) {
    throw new BadRequestAppError('limit must be an integer between 1 and 200 when provided');
  }

  const hasScopedFilter = Boolean(accountId || ownerUserId || brokerKey);
  if (rebuildAll && hasScopedFilter) {
    throw new BadRequestAppError('rebuildAll cannot be combined with accountId, ownerUserId, or brokerKey');
  }

  if (!rebuildAll && !hasScopedFilter) {
    throw new BadRequestAppError(
      'accountId, ownerUserId, brokerKey, or rebuildAll=true is required to trigger a read-model rebuild'
    );
  }

  return {
    ...(accountId ? { accountId } : {}),
    ...(ownerUserId ? { ownerUserId } : {}),
    ...(brokerKey ? { brokerKey } : {}),
    ...(limitRaw !== undefined ? { limit: limitRaw } : {}),
    ...(payload.rebuildAll !== undefined ? { rebuildAll } : {}),
    onlyDrifted,
  };
}

export function validateOrdersSchedulerConfigBody(
  body: Partial<UpdateSchedulerConfigBody>
): Partial<UpdateSchedulerConfigBody> {
  const payload = validateSchedulerConfigBody(body);

  if (
    body.schedulerType !== undefined &&
    String(body.schedulerType || '').trim().toLowerCase() !== 'global'
  ) {
    throw new BadRequestAppError(
      'Orders scheduler is a global system scheduler and cannot be switched to user scope.'
    );
  }

  if (body.sources !== undefined) {
    const sources = Array.isArray(payload.sources) ? payload.sources : [];
    if (sources.length !== 1 || sources[0] !== 'orders') {
      throw new BadRequestAppError(
        'Orders scheduler sources must be exactly ["orders"] when provided'
      );
    }
    payload.sources = ['orders'];
  }

  if (body.selectionMode !== undefined) {
    throw new BadRequestAppError(
      'Orders scheduler does not support asset selection controls'
    );
  }

  if (body.selectedAssetIds !== undefined) {
    throw new BadRequestAppError(
      'Orders scheduler does not support selectedAssetIds'
    );
  }

  if (body.timeframes !== undefined) {
    throw new BadRequestAppError(
      'Orders scheduler does not support timeframe scope controls'
    );
  }

  if (body.discoveryPolicy !== undefined) {
    throw new BadRequestAppError(
      'Orders scheduler does not support discovery policy configuration'
    );
  }

  if (body.maxLookbackDays !== undefined) {
    throw new BadRequestAppError(
      'Orders scheduler lookback is fixed server-side and cannot be configured from this endpoint'
    );
  }

  return payload;
}

export function validateAssetPriceSchedulerConfigBody(
  body: Partial<UpdateSchedulerConfigBody>
): Partial<UpdateSchedulerConfigBody> {
  const payload = validateSchedulerConfigBody(body);

  if (body.sources !== undefined) {
    const sources = Array.isArray(payload.sources) ? payload.sources : [];
    const hasUnsupportedSource = sources.some(
      (source) =>
        !ASSET_PRICE_SYNC_SYSTEM_SOURCES.some((allowedSource) => allowedSource === source)
    );

    if (hasUnsupportedSource) {
      throw new BadRequestAppError(
        'Asset price scheduler sources must only include "mudrex" or "delta_exchange"'
      );
    }

    payload.sources = Array.from(new Set(sources));
  }

  return payload;
}

export function validateOrdersSchedulerSyncStateQuery(query: {
  limit?: string;
  offset?: string;
  accountId?: string;
  ownerUserId?: string;
  userId?: string;
  brokerKey?: string;
}): {
  limit: number;
  offset: number;
  accountId?: string;
  ownerUserId?: string;
  brokerKey?: string;
} {
  const { limit, offset } = validateListQuery(query);
  const accountId = String(query.accountId || '').trim();
  const ownerUserId = String(query.ownerUserId || '').trim();
  const legacyUserId = String(query.userId || '').trim();
  const brokerKey = String(query.brokerKey || '').trim().toLowerCase();

  if (ownerUserId && legacyUserId && ownerUserId !== legacyUserId) {
    throw new BadRequestAppError(
      'ownerUserId and userId must match when both are provided'
    );
  }

  return {
    limit,
    offset,
    ...(accountId ? { accountId } : {}),
    ...(ownerUserId || legacyUserId
      ? { ownerUserId: ownerUserId || legacyUserId }
      : {}),
    ...(brokerKey ? { brokerKey } : {}),
  };
}
