import { BadRequestAppError } from '../errors/AppError';
import { UpdateSettingsBody } from '../contracts/Settings';
import { isValidIanaTimeZone, normalizeTimeZone } from '../utils/timezone';

export interface SettingsAuditQuery {
  limit?: string;
  offset?: string;
}

export interface ValidatedSettingsAuditQuery {
  limit: number;
  offset: number;
}

export const validateUpdateSettingsBody = (
  body: Partial<UpdateSettingsBody> = {},
  defaults: Partial<UpdateSettingsBody> = {}
): UpdateSettingsBody => {
  const allowedFields = new Set([
    'timezone',
    'notifyEmail',
    'notifyInApp',
    'confirmDestructive',
    'notificationChannel',
    'notificationSeverity',
    'escalationRoute',
    'escalationSlaMinutes'
  ]);
  const allowedChannels = new Set(['both', 'in-app', 'email', 'disabled']);
  const allowedSeverities = new Set(['all', 'medium', 'high', 'critical']);
  const allowedEscalationRoutes = new Set(['risk-review', 'on-call', 'manual']);
  const unexpectedFields = Object.keys(body || {}).filter((key) => !allowedFields.has(key));

  if (unexpectedFields.length > 0) {
    throw new BadRequestAppError(
      `Unknown settings fields: ${unexpectedFields.sort().join(', ')}`
    );
  }

  const candidate: Partial<UpdateSettingsBody> = {
    timezone: body.timezone ?? defaults.timezone,
    notifyEmail: body.notifyEmail ?? defaults.notifyEmail,
    notifyInApp: body.notifyInApp ?? defaults.notifyInApp,
    confirmDestructive: body.confirmDestructive ?? defaults.confirmDestructive,
    notificationChannel: body.notificationChannel ?? defaults.notificationChannel,
    notificationSeverity: body.notificationSeverity ?? defaults.notificationSeverity,
    escalationRoute: body.escalationRoute ?? defaults.escalationRoute,
    escalationSlaMinutes: body.escalationSlaMinutes ?? defaults.escalationSlaMinutes
  };

  if (typeof candidate.timezone !== 'string' || !isValidIanaTimeZone(candidate.timezone)) {
    throw new BadRequestAppError('timezone must be a valid IANA timezone');
  }

  if (typeof candidate.notifyEmail !== 'boolean') {
    throw new BadRequestAppError('notifyEmail must be a boolean');
  }

  if (typeof candidate.notifyInApp !== 'boolean') {
    throw new BadRequestAppError('notifyInApp must be a boolean');
  }

  if (typeof candidate.confirmDestructive !== 'boolean') {
    throw new BadRequestAppError('confirmDestructive must be a boolean');
  }

  if (
    typeof candidate.notificationChannel !== 'string' ||
    !allowedChannels.has(candidate.notificationChannel)
  ) {
    throw new BadRequestAppError(
      'notificationChannel must be one of: both, in-app, email, disabled'
    );
  }

  if (
    typeof candidate.notificationSeverity !== 'string' ||
    !allowedSeverities.has(candidate.notificationSeverity)
  ) {
    throw new BadRequestAppError(
      'notificationSeverity must be one of: all, medium, high, critical'
    );
  }

  if (
    typeof candidate.escalationRoute !== 'string' ||
    !allowedEscalationRoutes.has(candidate.escalationRoute)
  ) {
    throw new BadRequestAppError(
      'escalationRoute must be one of: risk-review, on-call, manual'
    );
  }

  if (
    typeof candidate.escalationSlaMinutes !== 'number' ||
    !Number.isInteger(candidate.escalationSlaMinutes) ||
    candidate.escalationSlaMinutes < 1 ||
    candidate.escalationSlaMinutes > 1440
  ) {
    throw new BadRequestAppError('escalationSlaMinutes must be an integer between 1 and 1440');
  }

  return {
    timezone: normalizeTimeZone(candidate.timezone),
    notifyEmail: candidate.notifyEmail,
    notifyInApp: candidate.notifyInApp,
    confirmDestructive: candidate.confirmDestructive,
    notificationChannel: candidate.notificationChannel,
    notificationSeverity: candidate.notificationSeverity,
    escalationRoute: candidate.escalationRoute,
    escalationSlaMinutes: candidate.escalationSlaMinutes
  };
};

export const validateSettingsAuditQuery = (
  query: SettingsAuditQuery = {}
): ValidatedSettingsAuditQuery => {
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
