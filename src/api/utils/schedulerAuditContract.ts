import {
  SchedulerExecutionContext,
  SchedulerInitiator,
} from '../contracts/Scheduler';
import { coreDataSource } from '../../database/data-source';
import { User } from '../../database/entities/User';

type SchedulerAuditSource = Record<string, unknown> | null | undefined;
type SchedulerAuditCarrier = {
  initiatedBy?: SchedulerInitiator | null;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type SchedulerAuditMetadata = {
  initiatedByType: SchedulerInitiator['type'];
  initiatedByUserId?: string;
  initiatedByLabel?: string;
  executionContext: SchedulerExecutionContext;
};

export function buildSystemSchedulerManualAudit(
  actorUserId: string
): SchedulerAuditMetadata {
  const normalizedActorUserId = String(actorUserId || '').trim();
  return {
    initiatedByType: 'manual',
    ...(normalizedActorUserId ? { initiatedByUserId: normalizedActorUserId } : {}),
    ...(normalizedActorUserId ? { initiatedByLabel: normalizedActorUserId } : {}),
    executionContext: 'system',
  };
}

export function buildSystemSchedulerProcessAudit(
  type: 'cron' | 'system' = 'system'
): SchedulerAuditMetadata {
  return {
    initiatedByType: type,
    initiatedByLabel: type === 'cron' ? 'System cron' : 'System',
    executionContext: 'system',
  };
}

export function toSchedulerAuditContract(
  ...sources: SchedulerAuditSource[]
): Pick<
  {
    initiatedBy?: SchedulerInitiator;
    executionContext?: SchedulerExecutionContext;
  },
  'initiatedBy' | 'executionContext'
> {
  const initiatedByType =
    readInitiatedByType(...sources) ||
    readTriggerAsInitiatedByType(...sources);
  const initiatedByUserId = readOptionalString(
    'initiatedByUserId',
    'initiated_by_user_id',
    ...sources
  );
  const initiatedByLabelRaw = readOptionalString(
    'initiatedByLabel',
    'initiated_by_label',
    ...sources
  );
  const executionContext =
    readExecutionContext(...sources) ||
    (initiatedByType ? 'system' : undefined);

  if (!initiatedByType && !executionContext) {
    return {};
  }

  const initiatedByLabel =
    initiatedByLabelRaw ||
    initiatedByUserId ||
    (initiatedByType === 'cron'
      ? 'System cron'
      : initiatedByType === 'system'
        ? 'System'
        : undefined);

  return {
    ...(initiatedByType
      ? {
          initiatedBy: {
            type: initiatedByType,
            ...(initiatedByUserId ? { userId: initiatedByUserId } : {}),
            ...(initiatedByLabel ? { label: initiatedByLabel } : {}),
          },
        }
      : {}),
    ...(executionContext ? { executionContext } : {}),
  };
}

export async function resolveSchedulerAuditDisplayLabels<T>(value: T): Promise<T> {
  if (!value || !coreDataSource.isInitialized) {
    return value;
  }

  const userIds = new Set<string>();
  collectUserIdsNeedingLabels(value, userIds);
  if (!userIds.size) {
    return value;
  }

  const rows = await coreDataSource
    .getRepository(User)
    .createQueryBuilder('user')
    .select('user.id', 'id')
    .addSelect('user.fullName', 'fullName')
    .where('user.id IN (:...ids)', { ids: Array.from(userIds) })
    .getRawMany<{ id?: string; fullName?: string }>();

  if (!rows.length) {
    return value;
  }

  const userNamesById = new Map<string, string>();
  for (const row of rows) {
    const id = String(row.id || '').trim();
    const fullName = String(row.fullName || '').trim();
    if (id && fullName) {
      userNamesById.set(id, fullName);
    }
  }

  if (!userNamesById.size) {
    return value;
  }

  return rewriteSchedulerAuditDisplayLabels(value, userNamesById);
}

function readInitiatedByType(
  ...sources: SchedulerAuditSource[]
): SchedulerInitiator['type'] | undefined {
  for (const source of sources) {
    if (!source) {
      continue;
    }
    const direct = normalizeInitiatedByType(source.initiatedByType);
    if (direct) {
      return direct;
    }
    const snake = normalizeInitiatedByType(source.initiated_by_type);
    if (snake) {
      return snake;
    }
  }
  return undefined;
}

function readTriggerAsInitiatedByType(
  ...sources: SchedulerAuditSource[]
): SchedulerInitiator['type'] | undefined {
  for (const source of sources) {
    if (!source) {
      continue;
    }
    const normalized = normalizeInitiatedByType(source.trigger);
    if (normalized) {
      return normalized;
    }
  }
  return undefined;
}

function readExecutionContext(
  ...sources: SchedulerAuditSource[]
): SchedulerExecutionContext | undefined {
  for (const source of sources) {
    if (!source) {
      continue;
    }
    const direct = normalizeExecutionContext(source.executionContext);
    if (direct) {
      return direct;
    }
    const snake = normalizeExecutionContext(source.execution_context);
    if (snake) {
      return snake;
    }
  }
  return undefined;
}

function readOptionalString(
  camelKey: string,
  snakeKey: string,
  ...sources: SchedulerAuditSource[]
): string | undefined {
  for (const source of sources) {
    if (!source) {
      continue;
    }
    const camelValue = String(source[camelKey] || '').trim();
    if (camelValue) {
      return camelValue;
    }
    const snakeValue = String(source[snakeKey] || '').trim();
    if (snakeValue) {
      return snakeValue;
    }
  }
  return undefined;
}

function normalizeInitiatedByType(
  value: unknown
): SchedulerInitiator['type'] | undefined {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (normalized === 'manual') {
    return 'manual';
  }
  if (normalized === 'scheduled' || normalized === 'cron') {
    return 'cron';
  }
  if (normalized === 'system') {
    return 'system';
  }
  return undefined;
}

function normalizeExecutionContext(
  value: unknown
): SchedulerExecutionContext | undefined {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'system' || normalized === 'user') {
    return normalized;
  }
  return undefined;
}

function collectUserIdsNeedingLabels(value: unknown, userIds: Set<string>): void {
  if (!value) {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectUserIdsNeedingLabels(item, userIds);
    }
    return;
  }
  if (typeof value !== 'object') {
    return;
  }

  const record = value as Record<string, unknown>;
  const auditUserId = readAuditUserIdNeedingLabel(record);
  if (auditUserId) {
    userIds.add(auditUserId);
  }

  for (const [key, child] of Object.entries(record)) {
    if (key === 'initiatedBy') {
      continue;
    }
    collectUserIdsNeedingLabels(child, userIds);
  }
}

function rewriteSchedulerAuditDisplayLabels<T>(
  value: T,
  userNamesById: Map<string, string>
): T {
  if (!value) {
    return value;
  }
  if (Array.isArray(value)) {
    let changed = false;
    const rewrittenItems = value.map((item) => {
      const rewrittenItem = rewriteSchedulerAuditDisplayLabels(item, userNamesById);
      if (rewrittenItem !== item) {
        changed = true;
      }
      return rewrittenItem;
    });
    return (changed ? rewrittenItems : value) as T;
  }
  if (typeof value !== 'object') {
    return value;
  }

  const record = value as Record<string, unknown>;
  let nextRecord: Record<string, unknown> | null = null;
  const rewrittenInitiator = rewriteInitiatedByLabel(record, userNamesById);
  if (rewrittenInitiator) {
    nextRecord = {
      ...record,
      initiatedBy: rewrittenInitiator,
    };
  }

  for (const [key, child] of Object.entries(record)) {
    if (key === 'initiatedBy' || !child || typeof child !== 'object') {
      continue;
    }
    const rewrittenChild = rewriteSchedulerAuditDisplayLabels(child, userNamesById);
    if (rewrittenChild !== child) {
      nextRecord = nextRecord || { ...record };
      nextRecord[key] = rewrittenChild as unknown;
    }
  }

  return (nextRecord || record) as T;
}

function rewriteInitiatedByLabel(
  record: Record<string, unknown>,
  userNamesById: Map<string, string>
): SchedulerInitiator | null {
  const initiatedBy = record.initiatedBy;
  if (!initiatedBy || typeof initiatedBy !== 'object' || Array.isArray(initiatedBy)) {
    return null;
  }

  const initiatedByType = String((initiatedBy as SchedulerAuditCarrier['initiatedBy'])?.type || '').trim().toLowerCase();
  const normalizedUserId = String((initiatedBy as SchedulerAuditCarrier['initiatedBy'])?.userId || '').trim();
  if (!normalizedUserId) {
    return null;
  }

  const currentLabel = String((initiatedBy as SchedulerAuditCarrier['initiatedBy'])?.label || '').trim();
  if (!shouldResolveLabel(currentLabel, normalizedUserId, initiatedByType)) {
    return null;
  }

  const resolvedLabel = userNamesById.get(normalizedUserId);
  if (!resolvedLabel || resolvedLabel === currentLabel) {
    return null;
  }

  return {
    ...(initiatedBy as SchedulerInitiator),
    label: resolvedLabel,
  };
}

function readAuditUserIdNeedingLabel(record: Record<string, unknown>): string {
  const initiatedBy = record.initiatedBy;
  if (!initiatedBy || typeof initiatedBy !== 'object' || Array.isArray(initiatedBy)) {
    return '';
  }

  const initiatedByType = String((initiatedBy as SchedulerAuditCarrier['initiatedBy'])?.type || '').trim().toLowerCase();
  const normalizedUserId = String((initiatedBy as SchedulerAuditCarrier['initiatedBy'])?.userId || '').trim();
  if (!normalizedUserId) {
    return '';
  }

  const currentLabel = String((initiatedBy as SchedulerAuditCarrier['initiatedBy'])?.label || '').trim();
  return shouldResolveLabel(currentLabel, normalizedUserId, initiatedByType) ? normalizedUserId : '';
}

function shouldResolveLabel(label: string, userId: string, initiatedByType: string): boolean {
  if (initiatedByType === 'manual') {
    return true;
  }
  const normalizedLabel = String(label || '').trim();
  if (!normalizedLabel) {
    return true;
  }
  if (normalizedLabel === userId) {
    return true;
  }
  return UUID_PATTERN.test(normalizedLabel);
}
