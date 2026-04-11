export const DEFAULT_TIMEZONE = 'UTC';
export const DEFAULT_SCHEDULER_TIMEZONE = 'Asia/Kolkata';

const WEEKDAY_MAP: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

export function isValidIanaTimeZone(value: string): boolean {
  const timezone = String(value || '').trim();
  if (!timezone) {
    return false;
  }
  try {
    Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function normalizeTimeZone(value?: string | null, fallback = DEFAULT_TIMEZONE): string {
  const timezone = String(value || '').trim();
  return isValidIanaTimeZone(timezone) ? timezone : fallback;
}

function parseDateKey(value?: string | null): { year: number; month: number; day: number } | null {
  const raw = String(value || '').trim();
  if (!raw) {
    return null;
  }
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!year || !month || !day) {
    return null;
  }
  return { year, month, day };
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function pad3(value: number): string {
  return String(value).padStart(3, '0');
}

export function formatDateInTimeZone(
  value: Date | string | null | undefined,
  timeZone: string,
  options: { includeMs?: boolean } = {}
): string | undefined {
  if (!value) {
    return undefined;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  const normalized = normalizeTimeZone(timeZone, DEFAULT_TIMEZONE);
  const parts = toParts(date, normalized);
  const offsetMinutes = Math.round(getOffsetMs(date, normalized) / 60000);
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absMinutes = Math.abs(offsetMinutes);
  const offset = `${sign}${pad2(Math.floor(absMinutes / 60))}:${pad2(absMinutes % 60)}`;
  const datePart = `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
  const timePart = `${pad2(parts.hour)}:${pad2(parts.minute)}:${pad2(parts.second)}`;
  const includeMs = options.includeMs !== false;
  const msPart = includeMs ? `.${pad3(date.getMilliseconds())}` : '';
  return `${datePart}T${timePart}${msPart}${offset}`;
}

function toParts(date: Date, timeZone: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
} {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    hourCycle: 'h23',
    weekday: 'short',
  }).formatToParts(date);

  const get = (type: string): string =>
    parts.find((item) => item.type === type)?.value || '0';

  const weekdayRaw = get('weekday').slice(0, 3).toLowerCase();
  const hour = Number(get('hour'));
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: hour === 24 ? 0 : hour,
    minute: Number(get('minute')),
    second: Number(get('second')),
    weekday: WEEKDAY_MAP[weekdayRaw] ?? 0,
  };
}

function getOffsetMs(date: Date, timeZone: string): number {
  const zoned = toParts(date, timeZone);
  const asUtc = Date.UTC(
    zoned.year,
    zoned.month - 1,
    zoned.day,
    zoned.hour,
    zoned.minute,
    zoned.second
  );
  return asUtc - date.getTime();
}

function zonedDateTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string
): Date {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const firstOffset = getOffsetMs(utcGuess, timeZone);
  const firstPass = new Date(utcGuess.getTime() - firstOffset);
  const secondOffset = getOffsetMs(firstPass, timeZone);
  return new Date(utcGuess.getTime() - secondOffset);
}

export function getUtcDateRangeFromLocalDates(
  startDate?: string | null,
  endDate?: string | null,
  timeZone?: string
): { startUtc?: Date; endUtc?: Date } {
  const resolved = normalizeTimeZone(timeZone, DEFAULT_TIMEZONE);
  const startParts = parseDateKey(startDate);
  const endParts = parseDateKey(endDate);
  const startUtc = startParts
    ? zonedDateTimeToUtc(startParts.year, startParts.month, startParts.day, 0, 0, 0, resolved)
    : startDate
      ? (() => {
          const parsed = new Date(startDate);
          return Number.isNaN(parsed.getTime()) ? undefined : parsed;
        })()
      : undefined;
  const endUtc = endParts
    ? new Date(
        zonedDateTimeToUtc(endParts.year, endParts.month, endParts.day, 23, 59, 59, resolved).getTime() +
          999
      )
    : endDate
      ? (() => {
          const parsed = new Date(endDate);
          return Number.isNaN(parsed.getTime()) ? undefined : parsed;
        })()
      : undefined;
  return { startUtc, endUtc };
}

export function getTimeZoneWindowStarts(
  reference: Date,
  timeZone: string
): { dayStart: Date; weekStart: Date; monthStart: Date } {
  const now = toParts(reference, timeZone);

  const dayStart = zonedDateTimeToUtc(
    now.year,
    now.month,
    now.day,
    0,
    0,
    0,
    timeZone
  );

  const localMidnight = new Date(Date.UTC(now.year, now.month - 1, now.day));
  const weekDiff = now.weekday === 0 ? 6 : now.weekday - 1;
  localMidnight.setUTCDate(localMidnight.getUTCDate() - weekDiff);
  const weekStart = zonedDateTimeToUtc(
    localMidnight.getUTCFullYear(),
    localMidnight.getUTCMonth() + 1,
    localMidnight.getUTCDate(),
    0,
    0,
    0,
    timeZone
  );

  const monthStart = zonedDateTimeToUtc(now.year, now.month, 1, 0, 0, 0, timeZone);
  return { dayStart, weekStart, monthStart };
}
