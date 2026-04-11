import { normalizeTimeZone } from './timezone';

export type AutomationScheduleType =
  | 'interval'
  | 'daily'
  | 'weekly'
  | 'every_n_seconds'
  | 'hourly_at_minute';

export type AutomationSchedule =
  | { type: 'interval'; intervalMinutes: number }
  | { type: 'every_n_seconds'; intervalSeconds: number }
  | { type: 'hourly_at_minute'; minute: number }
  | { type: 'daily'; hour: number; minute: number; intervalDays?: number }
  | { type: 'weekly'; hour: number; minute: number; weekdays: number[] };

const WEEKDAY_INDEX: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

const clampNumber = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const toTimeString = (hour: number, minute: number): string =>
  `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

const parseIntervalString = (value: string): number | null => {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  const match = trimmed.match(/^(\d+)\s*(m|h|hr|hour|hours|min|mins|minute|minutes)$/);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const unit = match[2];
  if (unit.startsWith('h')) return amount * 60;
  return amount;
};

const parseTimeString = (value: string): { hour: number; minute: number } | null => {
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
};

const normalizeWeekday = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isInteger(value)) {
    if (value >= 0 && value <= 6) return value;
    return null;
  }
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return null;
  const key = raw.slice(0, 3);
  return WEEKDAY_INDEX[key] ?? null;
};

const parseWeekdays = (value: unknown): number[] => {
  if (!value) return [];
  if (Array.isArray(value)) {
    return Array.from(
      new Set(
        value
          .map((item) => normalizeWeekday(item))
          .filter((item): item is number => item !== null)
      )
    ).sort();
  }
  const raw = String(value || '')
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  return Array.from(
    new Set(
      raw
        .map((item) => normalizeWeekday(item))
        .filter((item): item is number => item !== null)
    )
  ).sort();
};

const parseIntervalMinutes = (
  schedule: Record<string, unknown> | null,
  trigger?: string
): number | null => {
  if (!schedule && !trigger) return null;
  const intervalMinutesRaw = schedule?.intervalMinutes ?? schedule?.intervalMins ?? schedule?.everyMinutes;
  if (intervalMinutesRaw !== undefined) {
    const parsed = Number(intervalMinutesRaw);
    if (Number.isFinite(parsed)) {
      return clampNumber(Math.round(parsed), 1, 1440);
    }
  }
  const intervalHoursRaw = schedule?.intervalHours ?? schedule?.everyHours;
  if (intervalHoursRaw !== undefined) {
    const parsed = Number(intervalHoursRaw);
    if (Number.isFinite(parsed)) {
      return clampNumber(Math.round(parsed * 60), 1, 1440);
    }
  }
  if (typeof schedule?.interval === 'string') {
    const parsed = parseIntervalString(schedule.interval);
    if (parsed) return clampNumber(parsed, 1, 1440);
  }
  if (typeof schedule?.every === 'string') {
    const parsed = parseIntervalString(schedule.every);
    if (parsed) return clampNumber(parsed, 1, 1440);
  }
  if (trigger) {
    const match = trigger.toLowerCase().match(/(?:every|interval[:\s]*)\s*(\d+)\s*(m|min|minute|minutes|h|hr|hour|hours)/);
    if (match) {
      const amount = Number(match[1]);
      if (!Number.isFinite(amount) || amount <= 0) return null;
      const unit = match[2];
      const minutes = unit.startsWith('h') ? amount * 60 : amount;
      return clampNumber(minutes, 1, 1440);
    }
  }
  return null;
};

const parseIntervalSeconds = (
  schedule: Record<string, unknown> | null,
  trigger?: string
): number | null => {
  if (!schedule && !trigger) return null;
  const intervalSecondsRaw =
    schedule?.intervalSeconds ?? schedule?.everySeconds ?? schedule?.seconds;
  if (intervalSecondsRaw !== undefined) {
    const parsed = Number(intervalSecondsRaw);
    if (Number.isFinite(parsed)) {
      return clampNumber(Math.round(parsed), 1, 3600);
    }
  }
  if (trigger) {
    const match = trigger
      .toLowerCase()
      .match(/(?:every|interval[:\s]*)\s*(\d+)\s*(s|sec|second|seconds)/);
    if (match) {
      const amount = Number(match[1]);
      if (!Number.isFinite(amount) || amount <= 0) return null;
      return clampNumber(amount, 1, 3600);
    }
  }
  return null;
};

const parseRunTime = (
  schedule: Record<string, unknown> | null,
  trigger?: string
): { hour: number; minute: number } | null => {
  if (schedule) {
    if (typeof schedule.runAt === 'string') {
      const parsed = parseTimeString(schedule.runAt);
      if (parsed) return parsed;
    }
    if (typeof schedule.time === 'string') {
      const parsed = parseTimeString(schedule.time);
      if (parsed) return parsed;
    }
    if (typeof schedule.at === 'string') {
      const parsed = parseTimeString(schedule.at);
      if (parsed) return parsed;
    }
    const hourRaw = schedule.hour ?? schedule.hours;
    const minuteRaw = schedule.minute ?? schedule.minutes ?? schedule.min;
    if (hourRaw !== undefined || minuteRaw !== undefined) {
      const hour = hourRaw !== undefined ? Number(hourRaw) : 0;
      const minute = minuteRaw !== undefined ? Number(minuteRaw) : 0;
      if (Number.isFinite(hour) && Number.isFinite(minute)) {
        return { hour: clampNumber(Math.round(hour), 0, 23), minute: clampNumber(Math.round(minute), 0, 59) };
      }
    }
  }
  if (trigger) {
    const match = trigger.match(/(\d{1,2}):(\d{2})/);
    if (match) {
      const parsed = parseTimeString(match[0]);
      if (parsed) return parsed;
    }
  }
  return null;
};

const parseHourlyMinute = (
  schedule: Record<string, unknown> | null,
  trigger?: string
): number | null => {
  if (schedule) {
    const minuteRaw = schedule.hourlyMinute ?? schedule.minute ?? schedule.minutes ?? schedule.min;
    if (minuteRaw !== undefined) {
      const minute = Number(minuteRaw);
      if (Number.isFinite(minute)) {
        return clampNumber(Math.round(minute), 0, 59);
      }
    }
  }
  if (trigger) {
    const match = trigger.toLowerCase().match(/hourly[^0-9]*(\d{1,2})/);
    if (match) {
      const minute = Number(match[1]);
      if (Number.isFinite(minute)) {
        return clampNumber(Math.round(minute), 0, 59);
      }
    }
  }
  return null;
};

const parseIntervalDays = (schedule: Record<string, unknown> | null): number => {
  if (!schedule) return 1;
  const raw = schedule.intervalDays ?? schedule.everyDays ?? schedule.days;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return 1;
  }
  return clampNumber(Math.round(parsed), 1, 30);
};

const inferScheduleType = (schedule: Record<string, unknown> | null, trigger?: string): AutomationScheduleType | null => {
  const raw =
    (typeof schedule?.type === 'string' ? schedule.type : undefined) ||
    (typeof schedule?.mode === 'string' ? schedule.mode : undefined) ||
    (typeof schedule?.frequency === 'string' ? schedule.frequency : undefined) ||
    (typeof schedule?.scheduleType === 'string' ? schedule.scheduleType : undefined) ||
    (typeof schedule?.scheduleMode === 'string' ? schedule.scheduleMode : undefined);
  const normalized = raw ? raw.trim().toLowerCase() : '';
  if (normalized) {
    if (normalized === 'every_n_seconds') return 'every_n_seconds';
    if (normalized === 'hourly_at_minute') return 'hourly_at_minute';
    if (normalized.includes('week')) return 'weekly';
    if (normalized.includes('day')) return 'daily';
    if (normalized.includes('interval') || normalized.includes('minute')) {
      return 'interval';
    }
    if (normalized === 'hourly') return 'hourly_at_minute';
  }
  if (schedule) {
    if (schedule.weekdays || schedule.daysOfWeek) return 'weekly';
    if (schedule.intervalSeconds || schedule.everySeconds || schedule.seconds) {
      return 'every_n_seconds';
    }
    if (schedule.hourlyMinute !== undefined) {
      return 'hourly_at_minute';
    }
    if (schedule.interval || schedule.intervalMinutes || schedule.intervalHours || schedule.every) return 'interval';
    if (schedule.runAt || schedule.time || schedule.at || schedule.hour !== undefined || schedule.minute !== undefined) {
      return 'daily';
    }
  }
  if (trigger) {
    const normalizedTrigger = trigger.toLowerCase();
    if (normalizedTrigger.includes('weekly')) return 'weekly';
    if (normalizedTrigger.includes('daily')) return 'daily';
    if (normalizedTrigger.includes('every') || normalizedTrigger.includes('interval')) return 'interval';
  }
  return null;
};

export const resolveAutomationSchedule = (
  schedule: Record<string, unknown> | null,
  trigger?: string
): AutomationSchedule | null => {
  const mode = inferScheduleType(schedule, trigger);
  if (!mode) return null;
  if (mode === 'interval') {
    const intervalMinutes = parseIntervalMinutes(schedule, trigger);
    if (!intervalMinutes) return null;
    return { type: 'interval', intervalMinutes };
  }
  if (mode === 'every_n_seconds') {
    const intervalSeconds = parseIntervalSeconds(schedule, trigger);
    if (!intervalSeconds) return null;
    return { type: 'every_n_seconds', intervalSeconds };
  }
  if (mode === 'hourly_at_minute') {
    const minute = parseHourlyMinute(schedule, trigger);
    if (minute === null) return null;
    return { type: 'hourly_at_minute', minute };
  }

  const runTime = parseRunTime(schedule, trigger);
  if (!runTime) return null;

  if (mode === 'daily') {
    return {
      type: 'daily',
      hour: runTime.hour,
      minute: runTime.minute,
      intervalDays: parseIntervalDays(schedule),
    };
  }

  const weekdays =
    parseWeekdays(schedule?.weekdays ?? schedule?.daysOfWeek ?? schedule?.dayOfWeek ?? schedule?.days) ||
    [];
  if (!weekdays.length) {
    const triggerWeekdays = parseWeekdays(trigger);
    if (!triggerWeekdays.length) return null;
    return { type: 'weekly', hour: runTime.hour, minute: runTime.minute, weekdays: triggerWeekdays };
  }
  return { type: 'weekly', hour: runTime.hour, minute: runTime.minute, weekdays };
};

const getZonedDateParts = (
  date: Date,
  timeZone: string
): { year: number; month: number; day: number; hour: number; minute: number; weekday: number } => {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    hourCycle: 'h23',
    weekday: 'short',
  });
  const parts = formatter.formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || '0';
  const weekdayRaw = get('weekday').slice(0, 3).toLowerCase();
  const hour = Number(get('hour'));
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: hour === 24 ? 0 : hour,
    minute: Number(get('minute')),
    weekday: WEEKDAY_INDEX[weekdayRaw] ?? 0,
  };
};

const getOffsetMs = (date: Date, timeZone: string): number => {
  const parts = getZonedDateParts(date, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0);
  return asUtc - date.getTime();
};

const zonedDateTimeToUtc = (
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string
): Date => {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const firstOffset = getOffsetMs(utcGuess, timeZone);
  const firstPass = new Date(utcGuess.getTime() - firstOffset);
  const secondOffset = getOffsetMs(firstPass, timeZone);
  return new Date(utcGuess.getTime() - secondOffset);
};

const addLocalDays = (
  year: number,
  month: number,
  day: number,
  days: number
): { year: number; month: number; day: number } => {
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
};

export const computeNextRun = (
  schedule: AutomationSchedule,
  timeZone: string,
  reference: Date
): Date | null => {
  const resolvedTimeZone = normalizeTimeZone(timeZone);
  const now = reference instanceof Date ? reference : new Date(reference);
  if (Number.isNaN(now.getTime())) {
    return null;
  }

  if (schedule.type === 'interval') {
    const intervalMinutes = clampNumber(schedule.intervalMinutes, 1, 1440);
    return new Date(now.getTime() + intervalMinutes * 60 * 1000);
  }
  if (schedule.type === 'every_n_seconds') {
    const intervalSeconds = clampNumber(schedule.intervalSeconds, 1, 3600);
    return new Date(now.getTime() + intervalSeconds * 1000);
  }

  const nowParts = getZonedDateParts(now, resolvedTimeZone);
  if (schedule.type === 'hourly_at_minute') {
    let target = zonedDateTimeToUtc(
      nowParts.year,
      nowParts.month,
      nowParts.day,
      nowParts.hour,
      schedule.minute,
      resolvedTimeZone
    );
    if (target.getTime() <= now.getTime()) {
      const nextHourUtc = new Date(target.getTime() + 60 * 60 * 1000);
      const nextHourParts = getZonedDateParts(nextHourUtc, resolvedTimeZone);
      target = zonedDateTimeToUtc(
        nextHourParts.year,
        nextHourParts.month,
        nextHourParts.day,
        nextHourParts.hour,
        schedule.minute,
        resolvedTimeZone
      );
    }
    return target;
  }
  if (schedule.type === 'daily') {
    let target = zonedDateTimeToUtc(
      nowParts.year,
      nowParts.month,
      nowParts.day,
      schedule.hour,
      schedule.minute,
      resolvedTimeZone
    );
    if (target.getTime() <= now.getTime()) {
      const nextDay = addLocalDays(
        nowParts.year,
        nowParts.month,
        nowParts.day,
        clampNumber(schedule.intervalDays ?? 1, 1, 30)
      );
      target = zonedDateTimeToUtc(
        nextDay.year,
        nextDay.month,
        nextDay.day,
        schedule.hour,
        schedule.minute,
        resolvedTimeZone
      );
    }
    return target;
  }

  const weekdays = Array.isArray(schedule.weekdays) ? schedule.weekdays : [];
  if (!weekdays.length) return null;
  for (let offset = 0; offset <= 7; offset += 1) {
    const candidate = addLocalDays(nowParts.year, nowParts.month, nowParts.day, offset);
    const candidateDate = zonedDateTimeToUtc(
      candidate.year,
      candidate.month,
      candidate.day,
      schedule.hour,
      schedule.minute,
      resolvedTimeZone
    );
    const candidateWeekday = getZonedDateParts(candidateDate, resolvedTimeZone).weekday;
    if (!weekdays.includes(candidateWeekday)) continue;
    if (candidateDate.getTime() <= now.getTime()) continue;
    return candidateDate;
  }
  const fallbackDay = addLocalDays(nowParts.year, nowParts.month, nowParts.day, 7);
  return zonedDateTimeToUtc(
    fallbackDay.year,
    fallbackDay.month,
    fallbackDay.day,
    schedule.hour,
    schedule.minute,
    resolvedTimeZone
  );
};

export const serializeAutomationSchedule = (
  schedule: AutomationSchedule
): Record<string, unknown> => {
  if (schedule.type === 'interval') {
    return {
      type: 'interval',
      scheduleMode: 'every_n_minutes',
      intervalMinutes: clampNumber(schedule.intervalMinutes, 1, 1440),
    };
  }

  if (schedule.type === 'every_n_seconds') {
    return {
      type: 'every_n_seconds',
      scheduleMode: 'every_n_seconds',
      intervalSeconds: clampNumber(schedule.intervalSeconds, 1, 3600),
    };
  }

  if (schedule.type === 'hourly_at_minute') {
    const minute = clampNumber(schedule.minute, 0, 59);
    return {
      type: 'hourly_at_minute',
      scheduleMode: 'hourly_at_minute',
      hourlyMinute: minute,
      minute,
    };
  }

  if (schedule.type === 'daily') {
    const hour = clampNumber(schedule.hour, 0, 23);
    const minute = clampNumber(schedule.minute, 0, 59);
    return {
      type: 'daily',
      scheduleMode: 'daily',
      runAt: toTimeString(hour, minute),
      hour,
      minute,
      intervalDays: clampNumber(schedule.intervalDays ?? 1, 1, 30),
    };
  }

  return {
    type: 'weekly',
    scheduleMode: 'weekly',
    runAt: toTimeString(clampNumber(schedule.hour, 0, 23), clampNumber(schedule.minute, 0, 59)),
    hour: clampNumber(schedule.hour, 0, 23),
    minute: clampNumber(schedule.minute, 0, 59),
    weekdays: Array.from(new Set((schedule.weekdays ?? []).filter((day) => Number.isInteger(day))))
      .map((day) => clampNumber(day, 0, 6))
      .sort(),
  };
};

export const normalizeAutomationScheduleRecord = (
  schedule: Record<string, unknown> | null,
  trigger?: string
): Record<string, unknown> | null => {
  const resolved = resolveAutomationSchedule(schedule, trigger);
  return resolved ? serializeAutomationSchedule(resolved) : null;
};
