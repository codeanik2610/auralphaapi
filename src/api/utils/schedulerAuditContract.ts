import {
  SchedulerExecutionContext,
  SchedulerInitiator,
} from '../contracts/Scheduler';

type SchedulerAuditSource = Record<string, unknown> | null | undefined;

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
