import * as assert from 'node:assert/strict';

import { computeNextRun } from '../src/api/utils/automationSchedule';
import { formatDateInTimeZone, getUtcDateRangeFromLocalDates } from '../src/api/utils/timezone';

function assertUtcRange(
  startDate: string,
  endDate: string,
  timeZone: string,
  expected: { startUtc: string; endUtc: string }
): void {
  const range = getUtcDateRangeFromLocalDates(startDate, endDate, timeZone);
  assert.equal(range.startUtc?.toISOString(), expected.startUtc);
  assert.equal(range.endUtc?.toISOString(), expected.endUtc);
}

function runDateRangeAssertions(): void {
  assertUtcRange('2026-04-10', '2026-04-10', 'Asia/Kolkata', {
    startUtc: '2026-04-09T18:30:00.000Z',
    endUtc: '2026-04-10T18:29:59.999Z',
  });

  assertUtcRange('2024-03-10', '2024-03-10', 'America/New_York', {
    startUtc: '2024-03-10T05:00:00.000Z',
    endUtc: '2024-03-11T03:59:59.999Z',
  });

  assertUtcRange('2024-11-03', '2024-11-03', 'America/New_York', {
    startUtc: '2024-11-03T04:00:00.000Z',
    endUtc: '2024-11-04T04:59:59.999Z',
  });
}

function runFormattingAssertions(): void {
  assert.equal(
    formatDateInTimeZone(new Date('2026-04-09T18:30:00.000Z'), 'Asia/Kolkata', {
      includeMs: false,
    }),
    '2026-04-10T00:00:00+05:30'
  );

  assert.equal(
    formatDateInTimeZone(new Date('2024-03-10T05:00:00.000Z'), 'America/New_York', {
      includeMs: false,
    }),
    '2024-03-10T00:00:00-05:00'
  );
}

function runScheduleAssertions(): void {
  const midnightIst = computeNextRun(
    { type: 'daily', hour: 0, minute: 0 },
    'Asia/Kolkata',
    new Date('2026-04-09T18:29:59.000Z')
  );
  assert.equal(midnightIst?.toISOString(), '2026-04-09T18:30:00.000Z');

  const midnightNewYork = computeNextRun(
    { type: 'daily', hour: 0, minute: 0 },
    'America/New_York',
    new Date('2024-03-10T04:59:59.000Z')
  );
  assert.equal(midnightNewYork?.toISOString(), '2024-03-10T05:00:00.000Z');
}

function main(): void {
  runDateRangeAssertions();
  runFormattingAssertions();
  runScheduleAssertions();
  console.log('Timezone boundary assertions passed');
}

main();
