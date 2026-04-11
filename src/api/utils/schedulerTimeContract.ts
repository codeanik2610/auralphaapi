import { SchedulerTimeContract } from '../contracts/Scheduler';
import {
  DEFAULT_SCHEDULER_TIMEZONE,
  formatDateInTimeZone,
  normalizeTimeZone,
} from './timezone';

// Phase 3 keeps scheduler storage in UTC while localizing display-facing
// timestamps into the resolved user timezone.
export function buildSchedulerTimeContract(resolvedTimeZone?: string): SchedulerTimeContract {
  return {
    displayTimeZone: normalizeTimeZone(
      String(resolvedTimeZone || '').trim() || DEFAULT_SCHEDULER_TIMEZONE,
      DEFAULT_SCHEDULER_TIMEZONE
    ),
    storageTimeZone: 'UTC',
    rawTimeFields: 'iso-utc',
    displayTimesLocalized: true,
  };
}

export function formatSchedulerDisplayTime(
  value: Date | string | null | undefined,
  resolvedTimeZone?: string
): string | undefined {
  const displayTimeZone = normalizeTimeZone(
    String(resolvedTimeZone || '').trim() || DEFAULT_SCHEDULER_TIMEZONE,
    DEFAULT_SCHEDULER_TIMEZONE
  );
  return formatDateInTimeZone(value, displayTimeZone);
}

export function formatSchedulerRawIso(
  value: Date | string | null | undefined
): string | undefined {
  if (!value) {
    return undefined;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}
