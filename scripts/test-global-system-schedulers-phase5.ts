import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function run(): void {
  const findings: string[] = [];

  const phaseDoc = read('GLOBAL_SYSTEM_SCHEDULERS_PHASE5.md');
  for (const marker of [
    '`broker-assets-sync`',
    '`exchange-assets-sync`',
    '`binance-candles-3m-1m-sync`',
    '`system-health-sync`',
    'The overview payload now carries an explicit `recentRun` snapshot.',
    'The overview payload now carries an explicit `ops` snapshot.',
    'Top-level active-status fields stay backward compatible.',
    'Phase 6 should implement worker/runtime truth against this stable overview',
  ]) {
    if (!phaseDoc.includes(marker)) {
      findings.push(`GLOBAL_SYSTEM_SCHEDULERS_PHASE5.md: missing contract marker ${marker}`);
    }
  }

  const readme = read('README.md');
  if (!readme.includes('GLOBAL_SYSTEM_SCHEDULERS_PHASE5.md')) {
    findings.push('README.md: missing global system schedulers Phase 5 baseline link');
  }
  if (!readme.includes('recent-run and ops snapshots')) {
    findings.push('README.md: missing global system scheduler Phase 5 baseline summary');
  }

  const contractSource = read('src/api/contracts/Scheduler.ts');
  for (const marker of [
    'export interface SchedulerOverviewRunSnapshot {',
    'export interface SchedulerOverviewOpsSnapshot {',
    'hasQueuedWork?: boolean;',
    'recentRun?: SchedulerOverviewRunSnapshot;',
    'ops?: SchedulerOverviewOpsSnapshot;',
  ]) {
    if (!contractSource.includes(marker)) {
      findings.push(`Scheduler.ts: missing Phase 5 contract marker ${marker}`);
    }
  }

  const overviewSource = read('src/api/services/SchedulerOverviewService.ts');
  for (const marker of [
    'processed_accounts AS processedAccounts',
    'inserted_assets AS insertedAssets',
    'updated_assets AS updatedAssets',
    'skipped_assets AS skippedAssets',
    'buildOverviewRunSnapshot(',
    'buildOverviewOpsSnapshot(',
    'hasQueuedWork',
  ]) {
    if (!overviewSource.includes(marker)) {
      findings.push(`SchedulerOverviewService.ts: missing Phase 5 marker ${marker}`);
    }
  }

  const runtimeTestSource = read('scripts/test-global-system-schedulers.ts');
  for (const marker of [
    'testSchedulerOverviewPhaseFiveSnapshots',
    'recentRun?.processedAccounts',
    'ops?.latestOutcome',
    'hasQueuedWork, true',
  ]) {
    if (!runtimeTestSource.includes(marker)) {
      findings.push(`test-global-system-schedulers.ts: missing Phase 5 runtime marker ${marker}`);
    }
  }

  const packageSource = read('package.json');
  if (!packageSource.includes('"test:global-system-schedulers-phase5"')) {
    findings.push('package.json: missing global system schedulers Phase 5 test script');
  }
  if (!packageSource.includes('npm run test:global-system-schedulers-phase5')) {
    findings.push('package.json: global system schedulers Phase 5 guard must stay wired');
  }

  assert.equal(
    findings.length,
    0,
    `Global system schedulers Phase 5 guard failed:\n${findings.join('\n')}`
  );
  console.log('Global system schedulers Phase 5 guard passed.');
}

run();
