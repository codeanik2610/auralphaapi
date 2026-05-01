import { BadRequestAppError } from '../errors/AppError';
import { UpdateSettingsBody, UpdateSettingsRequestBody } from '../contracts/Settings';
import { isValidIanaTimeZone, normalizeTimeZone } from '../utils/timezone';
import {
  resolveBacktestPromotionRules,
  validateBacktestPromotionRulesInput,
} from '../utils/backtestPromotionRules';

export interface SettingsAuditQuery {
  limit?: string;
  offset?: string;
}

export interface ValidatedSettingsAuditQuery {
  limit: number;
  offset: number;
}

const WHATSAPP_E164_PATTERN = /^\+[1-9]\d{7,14}$/;

function normalizeWhatsappNumber(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== 'string') {
    throw new BadRequestAppError('whatsappNumber must be a string or null');
  }

  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  if (!WHATSAPP_E164_PATTERN.test(normalized)) {
    throw new BadRequestAppError(
      'whatsappNumber must be a valid E.164 phone number (for example, +14155550123)'
    );
  }

  return normalized;
}

export const validateUpdateSettingsBody = (
  body: UpdateSettingsRequestBody = {},
  defaults: Partial<UpdateSettingsBody> = {}
): UpdateSettingsBody => {
  const allowedFields = new Set([
    'timezone',
    'notifyEmail',
    'notifyInApp',
    'notifyWhatsapp',
    'whatsappLiveTradeSuggestions',
    'whatsappNumber',
    'confirmDestructive',
    'notificationChannel',
    'notificationSeverity',
    'escalationRoute',
    'escalationSlaMinutes',
    'backtestPromotionRules',
  ]);
  const allowedChannels = new Set(['both', 'in-app', 'email', 'disabled']);
  const allowedSeverities = new Set(['all', 'medium', 'high', 'critical']);
  const allowedEscalationRoutes = new Set(['risk-review', 'on-call', 'manual']);
  const unexpectedFields = Object.keys(body || {}).filter((key) => !allowedFields.has(key));

  if (unexpectedFields.length > 0) {
    throw new BadRequestAppError(`Unknown settings fields: ${unexpectedFields.sort().join(', ')}`);
  }

  const defaultPromotionRules = resolveBacktestPromotionRules(defaults.backtestPromotionRules);
  const candidate: UpdateSettingsBody = {
    timezone: body.timezone ?? defaults.timezone ?? 'UTC',
    notifyEmail: body.notifyEmail ?? defaults.notifyEmail ?? true,
    notifyInApp: body.notifyInApp ?? defaults.notifyInApp ?? true,
    notifyWhatsapp: body.notifyWhatsapp ?? defaults.notifyWhatsapp ?? false,
    whatsappLiveTradeSuggestions:
      body.whatsappLiveTradeSuggestions ?? defaults.whatsappLiveTradeSuggestions ?? false,
    whatsappNumber:
      body.whatsappNumber === undefined
        ? (defaults.whatsappNumber ?? null)
        : normalizeWhatsappNumber(body.whatsappNumber),
    confirmDestructive: body.confirmDestructive ?? defaults.confirmDestructive ?? true,
    notificationChannel: body.notificationChannel ?? defaults.notificationChannel ?? 'both',
    notificationSeverity: body.notificationSeverity ?? defaults.notificationSeverity ?? 'all',
    escalationRoute: body.escalationRoute ?? defaults.escalationRoute ?? 'risk-review',
    escalationSlaMinutes: body.escalationSlaMinutes ?? defaults.escalationSlaMinutes ?? 15,
    backtestPromotionRules:
      body.backtestPromotionRules === undefined
        ? defaultPromotionRules
        : validateBacktestPromotionRulesInput(body.backtestPromotionRules, defaultPromotionRules),
  };

  if (candidate.whatsappLiveTradeSuggestions && !candidate.notifyWhatsapp) {
    if (body.whatsappLiveTradeSuggestions === undefined) {
      candidate.whatsappLiveTradeSuggestions = false;
    } else {
      throw new BadRequestAppError(
        'notifyWhatsapp must be enabled when whatsappLiveTradeSuggestions is enabled'
      );
    }
  }

  if (typeof candidate.timezone !== 'string' || !isValidIanaTimeZone(candidate.timezone)) {
    throw new BadRequestAppError('timezone must be a valid IANA timezone');
  }

  if (typeof candidate.notifyEmail !== 'boolean') {
    throw new BadRequestAppError('notifyEmail must be a boolean');
  }

  if (typeof candidate.notifyInApp !== 'boolean') {
    throw new BadRequestAppError('notifyInApp must be a boolean');
  }

  if (typeof candidate.notifyWhatsapp !== 'boolean') {
    throw new BadRequestAppError('notifyWhatsapp must be a boolean');
  }

  if (typeof candidate.whatsappLiveTradeSuggestions !== 'boolean') {
    throw new BadRequestAppError('whatsappLiveTradeSuggestions must be a boolean');
  }

  if (typeof candidate.confirmDestructive !== 'boolean') {
    throw new BadRequestAppError('confirmDestructive must be a boolean');
  }

  if (
    (candidate.notifyWhatsapp || candidate.whatsappLiveTradeSuggestions) &&
    !candidate.whatsappNumber
  ) {
    throw new BadRequestAppError(
      'whatsappNumber is required when WhatsApp notifications are enabled'
    );
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
    throw new BadRequestAppError('escalationRoute must be one of: risk-review, on-call, manual');
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
    notifyWhatsapp: candidate.notifyWhatsapp,
    whatsappLiveTradeSuggestions: candidate.whatsappLiveTradeSuggestions,
    whatsappNumber: candidate.whatsappNumber,
    confirmDestructive: candidate.confirmDestructive,
    notificationChannel: candidate.notificationChannel,
    notificationSeverity: candidate.notificationSeverity,
    escalationRoute: candidate.escalationRoute,
    escalationSlaMinutes: candidate.escalationSlaMinutes,
    backtestPromotionRules: candidate.backtestPromotionRules,
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
