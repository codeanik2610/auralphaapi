import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const FOCUSED_TEST_SCRIPTS = [
  'scripts/test-positions-mudrex-partial.ts',
  'scripts/test-positions-delta-aggregation.ts',
  'scripts/test-positions-mudrex-history-window.ts',
  'scripts/test-positions-history-backfill-script.ts',
  'scripts/test-positions-reconciliation-check.ts',
] as const;

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function runScript(relativePath: string): void {
  const result = spawnSync(process.execPath, ['--import', 'tsx', relativePath], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });

  if (result.error) {
    throw result.error;
  }
  if (result.signal) {
    throw new Error(`${relativePath} terminated by signal ${result.signal}`);
  }
  if (result.status && result.status !== 0) {
    throw new Error(`${relativePath} exited with code ${result.status}`);
  }
}

function runRegistrationAssertions(): void {
  const packageJson = JSON.parse(read('package.json')) as { scripts?: Record<string, string> };
  assert.equal(
    packageJson.scripts?.['test:positions-reconciliation-repair'],
    'node --import tsx scripts/test-positions-reconciliation-repair.ts'
  );

  const suiteSource = read('scripts/_support/run-package-suite.ts');
  assert.match(suiteSource, /'positions-reconciliation-repair': 'baseline'/);
  assert.match(suiteSource, /'test:positions-reconciliation-repair'/);
  assert.match(
    suiteSource,
    /'positions-reconciliation-repair': \['test:positions-reconciliation-repair'\]/
  );

  const manifestSource = read('scripts/_support/system-coverage-manifest.ts');
  assert.match(manifestSource, /test:positions-reconciliation-repair/);
  assert.match(manifestSource, /scripts\/test-positions-reconciliation-repair\.ts/);

  for (const relativePath of FOCUSED_TEST_SCRIPTS) {
    assert.equal(
      fs.existsSync(path.join(process.cwd(), relativePath)),
      true,
      `${relativePath} exists`
    );
  }
}

for (const relativePath of FOCUSED_TEST_SCRIPTS) {
  runScript(relativePath);
}

runRegistrationAssertions();
console.log('Positions reconciliation repair test suite assertions passed.');
