import {
  EMAIL_DELIVERY_DEFAULT_RETENTION_DAYS,
  EMAIL_DELIVERY_MAX_RETENTION_DAYS,
} from '../constants/emailDeliveries';
import { EmailDeliveryExportBody, EmailDeliveryStatus } from '../contracts/EmailDelivery';
import { BadRequestAppError } from '../errors/AppError';

const VALID_STATUSES: EmailDeliveryStatus[] = ['Queued', 'Sending', 'Sent', 'Failed'];

export interface EmailDeliveriesQuery {
  limit?: string;
  offset?: string;
  status?: string;
  search?: string;
  userId?: string;
  recipient?: string;
  severity?: string;
  channel?: string;
  source?: string;
}

export interface ValidatedEmailDeliveriesQuery {
  limit: number;
  offset: number;
  status?: EmailDeliveryStatus;
  search?: string;
  userId?: string;
  recipient?: string;
  severity?: string;
  channel?: string;
  source?: string;
}

export interface ValidatedEmailDeliveryExportBody
  extends Omit<ValidatedEmailDeliveriesQuery, 'limit' | 'offset'> {
  format: 'csv';
}

export const validateEmailDeliveriesQuery = (
  query: EmailDeliveriesQuery = {}
): ValidatedEmailDeliveriesQuery => {
  const limit = query.limit !== undefined ? Number(query.limit) : 50;
  const offset = query.offset !== undefined ? Number(query.offset) : 0;

  if (!Number.isInteger(limit) || limit <= 0 || limit > 100) {
    throw new BadRequestAppError('limit must be an integer between 1 and 100');
  }

  if (!Number.isInteger(offset) || offset < 0) {
    throw new BadRequestAppError('offset must be an integer greater than or equal to 0');
  }

  const status = query.status?.trim();
  if (status && !VALID_STATUSES.includes(status as EmailDeliveryStatus)) {
    throw new BadRequestAppError(`status must be one of: ${VALID_STATUSES.join(', ')}`);
  }

  return {
    limit,
    offset,
    status: status as EmailDeliveryStatus | undefined,
    search: query.search?.trim() || undefined,
    userId: query.userId?.trim() || undefined,
    recipient: query.recipient?.trim() || undefined,
    severity: query.severity?.trim() || undefined,
    channel: query.channel?.trim() || undefined,
    source: query.source?.trim() || undefined,
  };
};

export const validateEmailDeliveriesFilters = (
  query: EmailDeliveriesQuery = {}
): Omit<ValidatedEmailDeliveriesQuery, 'limit' | 'offset'> => {
  const { status, search, userId, recipient, severity, channel, source } =
    validateEmailDeliveriesQuery({
      ...query,
      limit: '1',
      offset: '0',
    });

  return {
    status,
    search,
    userId,
    recipient,
    severity,
    channel,
    source,
  };
};

export const validateEmailDeliveryExportBody = (
  body: EmailDeliveryExportBody = {}
): ValidatedEmailDeliveryExportBody => {
  const filters = validateEmailDeliveriesFilters(body);
  const format = String(body.format || 'csv')
    .trim()
    .toLowerCase();

  if (format !== 'csv') {
    throw new BadRequestAppError('Only csv export is supported');
  }

  return {
    format: 'csv',
    ...filters,
  };
};

export const hasEmailDeliveryFilters = (
  query: Omit<ValidatedEmailDeliveriesQuery, 'limit' | 'offset'>
): boolean =>
  Object.values(query).some((value) => String(value || '').trim().length > 0);

export const validateEmailDeliveryId = (deliveryId: string): string => {
  const normalizedDeliveryId = deliveryId.trim();

  if (!normalizedDeliveryId) {
    throw new BadRequestAppError('deliveryId is required');
  }

  return normalizedDeliveryId;
};

export const validateEmailDeliveryRetentionDays = (
  retentionDays?: string
): number => {
  if (retentionDays === undefined || retentionDays === null || retentionDays === '') {
    return EMAIL_DELIVERY_DEFAULT_RETENTION_DAYS;
  }

  const normalizedRetentionDays = Number(retentionDays);
  if (
    !Number.isInteger(normalizedRetentionDays) ||
    normalizedRetentionDays < 1 ||
    normalizedRetentionDays > EMAIL_DELIVERY_MAX_RETENTION_DAYS
  ) {
    throw new BadRequestAppError(
      `retentionDays must be an integer between 1 and ${EMAIL_DELIVERY_MAX_RETENTION_DAYS}`
    );
  }

  return normalizedRetentionDays;
};
