import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function run(): void {
  const liveCheckSource = read('scripts/check-scheduler-account-scope-live.ts');
  const ordersDiagnosticsSource = read('src/api/services/OrdersSyncDiagnosticsService.ts');
  const positionsSchedulerSource = read('src/api/services/PositionsSchedulerService.ts');
  const packageSource = read('package.json');
  const readmeSource = read('README.md');
  const phaseDoc = read('SCHEDULER_ACCOUNT_SCOPE_PHASE5.md');

  for (const marker of [
    '/scheduler/orders/sync-state/summary',
    '/scheduler/orders/sync-state?limit=20&offset=0',
    '/scheduler/positions/sync-state/summary',
    '/scheduler/positions/sync-state?limit=20&offset=0',
    '/internal/funds/snapshot',
    'activeUserOwned',
    'activeSystemOwned',
    'ownerlessAccountIds',
  ]) {
    assert.equal(
      liveCheckSource.includes(marker),
      true,
      `check-scheduler-account-scope-live.ts must include marker: ${marker}`
    );
  }

  assert.equal(
    packageSource.includes('"check:scheduler-account-scope-live"'),
    true,
    'package.json must expose the live scheduler account-scope proof command'
  );
  assert.equal(
    packageSource.includes('"test:scheduler-account-scope-phase5"'),
    true,
    'package.json must expose the Phase 5 scheduler account-scope guard'
  );
  assert.equal(
    packageSource.includes('npm run test:scheduler-account-scope-phase5'),
    true,
    'test:all must keep the Phase 5 scheduler account-scope guard wired'
  );

  for (const marker of [
    'One live proof command now exists',
    '## 4) Phase 6 Entry Checklist',
    'npm run check:scheduler-account-scope-live',
  ]) {
    assert.equal(
      phaseDoc.includes(marker),
      true,
      `SCHEDULER_ACCOUNT_SCOPE_PHASE5.md must include marker: ${marker}`
    );
  }

  assert.equal(
    readmeSource.includes('SCHEDULER_ACCOUNT_SCOPE_PHASE5.md'),
    true,
    'README.md must reference the scheduler account-scope Phase 5 document'
  );
  assert.equal(
    readmeSource.includes('check:scheduler-account-scope-live'),
    true,
    'README.md must include the scheduler account-scope live proof command'
  );

  for (const [source, label] of [
    [ordersDiagnosticsSource, 'OrdersSyncDiagnosticsService.ts'],
    [positionsSchedulerSource, 'PositionsSchedulerService.ts'],
  ] as const) {
    assert.equal(
      source.includes('ba.updatedAt'),
      true,
      `${label} must use the real broker_accounts updatedAt column in raw SQL`
    );
    assert.equal(
      source.includes('ba.brokerKey'),
      true,
      `${label} must use the real broker_accounts brokerKey column in raw SQL`
    );
    assert.equal(
      source.includes('ba.updated_at'),
      false,
      `${label} must not regress to the non-existent broker_accounts updated_at column`
    );
    assert.equal(
      source.includes('ba.broker_key'),
      false,
      `${label} must not regress to the non-existent broker_accounts broker_key column`
    );
  }

  console.log('Scheduler account-scope Phase 5 guard passed.');
}

run();
