import { BadRequestAppError } from '../errors/AppError';

export interface RuntimeRepairBody {
  status?: string;
  reason?: string;
  actorUserId?: string;
  schedulerUserId?: string;
}

export interface RuntimeRequeueBody {
  actorUserId?: string;
  schedulerUserId?: string;
}

export interface RuntimeReleaseLockBody {
  actorUserId?: string;
  schedulerUserId?: string;
  reason?: string;
}

const ALLOWED_REPAIR_STATUSES = new Set(['Failed', 'Cancelled', 'Queued']);

export function validateRuntimeListQuery(query: { limit?: string }): {
  limit: number;
} {
  const limit = query.limit !== undefined ? Number(query.limit) : 100;
  if (!Number.isInteger(limit) || limit <= 0 || limit > 500) {
    throw new BadRequestAppError('limit must be an integer between 1 and 500');
  }

  return { limit };
}

export function validateRuntimeRepairBody(body: RuntimeRepairBody = {}): {
  status: 'Failed' | 'Cancelled' | 'Queued';
  reason: string | null;
  actorUserId: string | null;
  schedulerUserId: string | null;
} {
  const status = String(body.status || 'Failed').trim();
  if (!ALLOWED_REPAIR_STATUSES.has(status)) {
    throw new BadRequestAppError('status must be Failed, Cancelled, or Queued');
  }

  const reason = String(body.reason || '').trim();
  const actorUserId = String(body.actorUserId || '').trim() || null;
  const schedulerUserId = String(body.schedulerUserId || '').trim() || null;

  return {
    status: status as 'Failed' | 'Cancelled' | 'Queued',
    reason: reason || null,
    actorUserId,
    schedulerUserId,
  };
}

export function validateRuntimeRequeueBody(body: RuntimeRequeueBody = {}): {
  actorUserId: string | null;
  schedulerUserId: string | null;
} {
  return {
    actorUserId: String(body.actorUserId || '').trim() || null,
    schedulerUserId: String(body.schedulerUserId || '').trim() || null,
  };
}

export function validateRuntimeReleaseLockBody(
  body: RuntimeReleaseLockBody = {}
): {
  actorUserId: string | null;
  schedulerUserId: string | null;
  reason: string | null;
} {
  return {
    actorUserId: String(body.actorUserId || '').trim() || null,
    schedulerUserId: String(body.schedulerUserId || '').trim() || null,
    reason: String(body.reason || '').trim() || null,
  };
}
