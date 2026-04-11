import { AlertRouteTarget, AlertSeverity, AlertStatus } from '../contracts/Alert';
import { BadRequestAppError } from '../errors/AppError';

const VALID_STATUSES: AlertStatus[] = ['Open', 'Acknowledged', 'Muted', 'Resolved'];
const VALID_SEVERITIES: AlertSeverity[] = ['High', 'Medium', 'Low'];
const VALID_TARGETS: AlertRouteTarget[] = ['signals', 'risk', 'automations', 'orders'];

export interface AlertsQuery {
  limit?: string;
  offset?: string;
  status?: string;
  search?: string;
  severity?: string;
  channel?: string;
}

export interface AlertAcknowledgeBody {
  note?: string;
}

export interface AlertMuteBody {
  reason?: string;
}

export interface AlertRouteBody {
  target?: string;
  note?: string;
}

export interface ValidatedAlertsQuery {
  limit: number;
  offset: number;
  status?: AlertStatus;
  search?: string;
  severity?: AlertSeverity;
  channel?: string;
}

export const validateAlertsQuery = (query: AlertsQuery): ValidatedAlertsQuery => {
  const limit = query.limit !== undefined ? Number(query.limit) : 20;
  const offset = query.offset !== undefined ? Number(query.offset) : 0;

  if (!Number.isInteger(limit) || limit <= 0 || limit > 100) {
    throw new BadRequestAppError('limit must be an integer between 1 and 100');
  }

  if (!Number.isInteger(offset) || offset < 0) {
    throw new BadRequestAppError('offset must be an integer greater than or equal to 0');
  }

  const status = query.status?.trim();
  if (status && !VALID_STATUSES.includes(status as AlertStatus)) {
    throw new BadRequestAppError(`status must be one of: ${VALID_STATUSES.join(', ')}`);
  }

  const severity = query.severity?.trim();
  if (severity && !VALID_SEVERITIES.includes(severity as AlertSeverity)) {
    throw new BadRequestAppError(`severity must be one of: ${VALID_SEVERITIES.join(', ')}`);
  }

  return {
    limit,
    offset,
    status: status as AlertStatus | undefined,
    search: query.search?.trim() || undefined,
    severity: severity as AlertSeverity | undefined,
    channel: query.channel?.trim() || undefined,
  };
};

export const validateAlertId = (alertId: string): string => {
  const normalizedAlertId = alertId.trim();

  if (!normalizedAlertId) {
    throw new BadRequestAppError('alertId is required');
  }

  return normalizedAlertId;
};

export const validateAlertAcknowledgeBody = (
  body: AlertAcknowledgeBody = {}
): AlertAcknowledgeBody => {
  if (body.note !== undefined && typeof body.note !== 'string') {
    throw new BadRequestAppError('note must be a string');
  }

  return { note: body.note?.trim() || undefined };
};

export const validateAlertMuteBody = (body: AlertMuteBody = {}): AlertMuteBody => {
  if (body.reason !== undefined && typeof body.reason !== 'string') {
    throw new BadRequestAppError('reason must be a string');
  }

  return { reason: body.reason?.trim() || undefined };
};

export const validateAlertRouteBody = (
  body: AlertRouteBody = {}
): { target: AlertRouteTarget; note?: string } => {
  const target = body.target?.trim();

  if (!target) {
    throw new BadRequestAppError('target is required');
  }

  if (!VALID_TARGETS.includes(target as AlertRouteTarget)) {
    throw new BadRequestAppError(`target must be one of: ${VALID_TARGETS.join(', ')}`);
  }

  if (body.note !== undefined && typeof body.note !== 'string') {
    throw new BadRequestAppError('note must be a string');
  }

  return {
    target: target as AlertRouteTarget,
    note: body.note?.trim() || undefined,
  };
};
