import { env } from '../../env';
import {
  InternalSyncBody,
  OrdersSyncRequest,
  PositionsSyncRequest,
} from '../contracts/InternalSync';

export const POSITIONS_SYNC_SCHEDULER_KEY = 'positions-sync';
export const ORDERS_SYNC_SCHEDULER_KEY = 'orders-sync';
export const POSITIONS_SYNC_SCHEDULER_NAME = 'Positions Sync';
export const ORDERS_SYNC_SCHEDULER_NAME = 'Orders Sync';
export const POSITIONS_SYNC_SCHEDULER_OWNERSHIP = 'user' as const;
export const ORDERS_SYNC_SCHEDULER_OWNERSHIP = 'user' as const;
export const POSITIONS_SYNC_RUNTIME_OWNERSHIP = 'user' as const;
export const ORDERS_SYNC_RUNTIME_OWNERSHIP = 'user' as const;
export const POSITIONS_SYNC_RUNTIME_OWNERSHIP_LEGACY = POSITIONS_SYNC_RUNTIME_OWNERSHIP;
export const ORDERS_SYNC_RUNTIME_OWNERSHIP_LEGACY = ORDERS_SYNC_RUNTIME_OWNERSHIP;
export const POSITIONS_ORDERS_SYSTEM_SYNC_SCOPE = 'system_scheduler' as const;
export const POSITIONS_ORDERS_PRODUCT_SYNC_SCOPE = 'product_user' as const;

export const POSITIONS_SYNC_ADMIN_ROUTE = '/scheduler/positions';
export const ORDERS_SYNC_ADMIN_ROUTE = '/scheduler/orders';

export const POSITIONS_PRODUCT_ROUTE = '/positions';
export const ORDERS_PRODUCT_ROUTE = '/orders';

export const POSITIONS_INTERNAL_SYNC_ROUTE = '/internal/positions/sync';
export const ORDERS_INTERNAL_SYNC_ROUTE = '/internal/orders/sync';

export const ALL_USERS_BATCH_SYNC_SCHEDULERS = [
  POSITIONS_SYNC_SCHEDULER_KEY,
  ORDERS_SYNC_SCHEDULER_KEY,
] as const;
export const ALL_USERS_SYSTEM_SYNC_SCHEDULERS = [] as const;

export const USER_OWNED_PRODUCT_REFRESH_SURFACES = [
  `${POSITIONS_PRODUCT_ROUTE}/futures/refresh`,
  `${ORDERS_PRODUCT_ROUTE}/futures/refresh`,
] as const;

type SharedSyncRequestShape = Pick<
  InternalSyncBody,
  | 'targetUserIds'
  | 'brokerKeys'
  | 'accountIds'
  | 'lookbackDays'
  | 'startDate'
  | 'endDate'
  | 'startDateTime'
  | 'endDateTime'
  | 'historyWindowDays'
  | 'historyMode'
  | 'backfill'
  | 'runLogId'
>;

function normalizeStringArray(value: unknown): string[] {
  const items = Array.isArray(value) ? value : [];
  return Array.from(
    new Set(
      items
        .map((item) => String(item || '').trim())
        .filter(Boolean)
    )
  );
}

function normalizeOptionalStringArray(value: unknown): string[] | undefined {
  const normalized = normalizeStringArray(value);
  return normalized.length ? normalized : undefined;
}

function normalizeOptionalString(value: unknown): string | undefined {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || undefined;
}

function normalizeOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeSharedSyncRequest(
  request: SharedSyncRequestShape = {}
): Omit<SharedSyncRequestShape, 'targetUserIds'> & { targetUserIds: string[] } {
  const normalized: Omit<SharedSyncRequestShape, 'targetUserIds'> & { targetUserIds: string[] } = {
    targetUserIds: normalizeStringArray(request.targetUserIds),
  };
  const brokerKeys = normalizeOptionalStringArray(request.brokerKeys);
  const accountIds = normalizeOptionalStringArray(request.accountIds);
  const lookbackDays = normalizeOptionalNumber(request.lookbackDays);
  const startDate = normalizeOptionalString(request.startDate);
  const endDate = normalizeOptionalString(request.endDate);
  const startDateTime = normalizeOptionalString(request.startDateTime);
  const endDateTime = normalizeOptionalString(request.endDateTime);
  const historyWindowDays = normalizeOptionalNumber(request.historyWindowDays);
  const historyModeRaw = normalizeOptionalString(request.historyMode);
  const historyMode =
    historyModeRaw === 'fast' || historyModeRaw === 'full' ? historyModeRaw : undefined;
  const runLogId = normalizeOptionalString(request.runLogId);

  if (brokerKeys) {
    normalized.brokerKeys = brokerKeys;
  }
  if (accountIds) {
    normalized.accountIds = accountIds;
  }
  if (lookbackDays !== undefined) {
    normalized.lookbackDays = lookbackDays;
  }
  if (startDate) {
    normalized.startDate = startDate;
  }
  if (endDate) {
    normalized.endDate = endDate;
  }
  if (startDateTime) {
    normalized.startDateTime = startDateTime;
  }
  if (endDateTime) {
    normalized.endDateTime = endDateTime;
  }
  if (historyWindowDays !== undefined) {
    normalized.historyWindowDays = historyWindowDays;
  }
  if (historyMode) {
    normalized.historyMode = historyMode;
  }
  if (typeof request.backfill === 'boolean') {
    normalized.backfill = request.backfill;
  }
  if (runLogId) {
    normalized.runLogId = runLogId;
  }

  return normalized;
}

function resolveSystemSchedulerUserId(): string {
  return String(env.scheduler.systemUserId || '').trim();
}

export function buildSystemOwnedPositionsSyncRequest(
  request: SharedSyncRequestShape = {}
): PositionsSyncRequest {
  const normalized = normalizeSharedSyncRequest(request);
  const systemUserId = resolveSystemSchedulerUserId();
  return {
    ...normalized,
    executionScope: POSITIONS_ORDERS_SYSTEM_SYNC_SCOPE,
    requestUserId: systemUserId || undefined,
    targetUserIds: systemUserId ? [systemUserId] : normalized.targetUserIds,
  };
}

export function buildSystemOwnedOrdersSyncRequest(
  request: SharedSyncRequestShape = {}
): OrdersSyncRequest {
  const normalized = normalizeSharedSyncRequest(request);
  const systemUserId = resolveSystemSchedulerUserId();
  return {
    ...normalized,
    executionScope: POSITIONS_ORDERS_SYSTEM_SYNC_SCOPE,
    requestUserId: systemUserId || undefined,
    targetUserIds: systemUserId ? [systemUserId] : normalized.targetUserIds,
  };
}

export function buildProductOwnedPositionsSyncRequest(
  userId: string,
  request: SharedSyncRequestShape = {}
): PositionsSyncRequest {
  const normalized = normalizeSharedSyncRequest(request);
  const requestUserId = String(userId || '').trim();
  return {
    ...normalized,
    executionScope: POSITIONS_ORDERS_PRODUCT_SYNC_SCOPE,
    requestUserId: requestUserId || undefined,
    targetUserIds: requestUserId ? [requestUserId] : normalized.targetUserIds,
  };
}

export function buildProductOwnedOrdersSyncRequest(
  userId: string,
  request: SharedSyncRequestShape = {}
): OrdersSyncRequest {
  const normalized = normalizeSharedSyncRequest(request);
  const requestUserId = String(userId || '').trim();
  return {
    ...normalized,
    executionScope: POSITIONS_ORDERS_PRODUCT_SYNC_SCOPE,
    requestUserId: requestUserId || undefined,
    targetUserIds: requestUserId ? [requestUserId] : normalized.targetUserIds,
  };
}
