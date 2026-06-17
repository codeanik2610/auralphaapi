import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function runPositionsReconciliationCheckAssertions(): void {
  const packageJson = JSON.parse(read('package.json')) as { scripts?: Record<string, string> };
  assert.equal(
    packageJson.scripts?.['check:positions-reconciliation'],
    'node --import tsx scripts/checks/check-positions-reconciliation.ts'
  );

  const manifestSource = read('scripts/_support/system-coverage-manifest.ts');
  assert.match(manifestSource, /check:positions-reconciliation/);
  assert.match(manifestSource, /scripts\/checks\/check-positions-reconciliation\.ts/);

  const checkSource = read('scripts/checks/check-positions-reconciliation.ts');
  assert.match(checkSource, /POSITIONS_RECONCILIATION_USER_ID/);
  assert.match(checkSource, /POSITIONS_RECONCILIATION_START_DATE/);
  assert.match(checkSource, /POSITIONS_RECONCILIATION_END_DATE/);
  assert.match(checkSource, /POSITIONS_RECONCILIATION_MAX_EXTERNAL_MISSING/);
  assert.match(checkSource, /positions-reconciliation-check:/);
  assert.match(checkSource, /mudrexCanonicalExternalIdOf/);
  assert.match(checkSource, /createHash\('sha256'\)/);
  assert.match(checkSource, /state: failedChecks\.length \? 'failed' : 'passed'/);
  assert.match(checkSource, /process\.exitCode = 1/);
  assert.equal(
    checkSource.includes("key: 'outside_window_broker_rows'"),
    false,
    'broker rows outside the requested window are reported after filtering, not treated as drift'
  );
  assert.ok(
    checkSource.includes("await adapter.getPositionHistory({ startDate, endDate, limit: '50000' }"),
    'verification must compare requested broker history window'
  );
}

runPositionsReconciliationCheckAssertions();
console.log('Positions reconciliation check assertions passed.');
