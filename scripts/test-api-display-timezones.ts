import assert from 'node:assert/strict';

import {
  buildApiTimeContract,
  formatApiDisplayTime,
  formatApiRawIso,
} from '../src/api/utils/apiTimeContract';

async function runAliasAssertions(): Promise<void> {
  const referenceIso = '2026-04-11T04:12:16.000Z';

  assert.equal(
    formatApiDisplayTime(referenceIso, 'Asia/Calcutta'),
    '2026-04-11T09:42:16.000+05:30'
  );
  assert.equal(
    formatApiDisplayTime(referenceIso, 'Asia/Kolkata'),
    '2026-04-11T09:42:16.000+05:30'
  );
  assert.equal(formatApiRawIso(referenceIso), referenceIso);
  assert.deepEqual(buildApiTimeContract('Asia/Calcutta'), {
    displayTimeZone: 'Asia/Calcutta',
    storageTimeZone: 'UTC',
    rawTimeFields: 'iso-utc',
    displayTimesLocalized: true,
  });
}

async function runDstAssertions(): Promise<void> {
  assert.equal(
    formatApiDisplayTime('2026-03-08T06:59:59.000Z', 'America/New_York'),
    '2026-03-08T01:59:59.000-05:00'
  );
  assert.equal(
    formatApiDisplayTime('2026-03-08T07:00:00.000Z', 'America/New_York'),
    '2026-03-08T03:00:00.000-04:00'
  );
  assert.equal(
    formatApiDisplayTime('2026-11-01T05:59:59.000Z', 'America/New_York'),
    '2026-11-01T01:59:59.000-04:00'
  );
  assert.equal(
    formatApiDisplayTime('2026-11-01T06:00:00.000Z', 'America/New_York'),
    '2026-11-01T01:00:00.000-05:00'
  );
}

async function main(): Promise<void> {
  await runAliasAssertions();
  await runDstAssertions();
  console.log('API display timezone assertions passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
