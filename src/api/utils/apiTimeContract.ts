import { ApiTimeContract } from '../contracts/Time';
import { DEFAULT_TIMEZONE, formatDateInTimeZone, normalizeTimeZone } from './timezone';

export function buildApiTimeContract(resolvedTimeZone?: string): ApiTimeContract {
  return {
    displayTimeZone: normalizeTimeZone(
      String(resolvedTimeZone || '').trim() || DEFAULT_TIMEZONE,
      DEFAULT_TIMEZONE
    ),
    storageTimeZone: 'UTC',
    rawTimeFields: 'iso-utc',
    displayTimesLocalized: true,
  };
}

export function formatApiDisplayTime(
  value: Date | string | null | undefined,
  resolvedTimeZone?: string
): string | undefined {
  const displayTimeZone = normalizeTimeZone(
    String(resolvedTimeZone || '').trim() || DEFAULT_TIMEZONE,
    DEFAULT_TIMEZONE
  );
  return formatDateInTimeZone(value, displayTimeZone);
}

export function formatApiRawIso(
  value: Date | string | null | undefined
): string | undefined {
  if (!value) {
    return undefined;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}
