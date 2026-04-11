import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function run(): void {
  const findings: string[] = [];

  const phaseDoc = read('GLOBAL_SYSTEM_SCHEDULERS_PHASE3.md');
  for (const marker of [
    '`broker-assets-sync`',
    '`exchange-assets-sync`',
    '`binance-candles-3m-1m-sync`',
    '`system-health-sync`',
    'Display-facing scheduler timestamps are localized into the resolved user',
    'Raw UTC ISO companion fields stay available and stable.',
    'Phase 4 should harden scheduler-scoped retention and purge behavior',
  ]) {
    if (!phaseDoc.includes(marker)) {
      findings.push(`GLOBAL_SYSTEM_SCHEDULERS_PHASE3.md: missing contract marker ${marker}`);
    }
  }

  const readme = read('README.md');
  if (!readme.includes('GLOBAL_SYSTEM_SCHEDULERS_PHASE3.md')) {
    findings.push('README.md: missing global system schedulers Phase 3 baseline link');
  }
  if (!readme.includes('localized display timestamps')) {
    findings.push('README.md: missing global system scheduler Phase 3 baseline summary');
  }

  const contractSource = read('src/api/contracts/Scheduler.ts');
  for (const marker of [
    'lastStartedAtIso?: string;',
    'lastFinishedAtIso?: string;',
    'syncedFromIso?: string;',
    'syncedToIso?: string;',
    'lastSyncedAtIso?: string;',
    'time?: SchedulerTimeContract;',
  ]) {
    if (!contractSource.includes(marker)) {
      findings.push(`Scheduler.ts: missing Phase 3 contract marker ${marker}`);
    }
  }

  const timeContractSource = read('src/api/utils/schedulerTimeContract.ts');
  for (const marker of [
    'formatSchedulerDisplayTime(',
    'formatDateInTimeZone(',
    'displayTimesLocalized: true',
  ]) {
    if (!timeContractSource.includes(marker)) {
      findings.push(`schedulerTimeContract.ts: missing Phase 3 marker ${marker}`);
    }
  }

  const overviewSource = read('src/api/services/SchedulerOverviewService.ts');
  for (const marker of [
    'formatSchedulerDisplayTime',
    'formatDisplayDate(',
    'displayTimesLocalized: true',
  ]) {
    if (!overviewSource.includes(marker) && marker !== 'displayTimesLocalized: true') {
      findings.push(`SchedulerOverviewService.ts: missing Phase 3 marker ${marker}`);
    }
  }

  for (const relativePath of [
    'src/api/services/SchedulerService.ts',
    'src/api/services/BinanceAssetsSchedulerService.ts',
    'src/api/services/CandlesSchedulerService.ts',
    'src/api/services/HealthCheckSchedulerService.ts',
  ]) {
    const source = read(relativePath);
    for (const marker of [
      'formatSchedulerDisplayTime',
      'formatDisplayDate(',
      'lastStartedAtIso:',
      'lastFinishedAtIso:',
    ]) {
      if (!source.includes(marker)) {
        findings.push(`${relativePath}: missing Phase 3 service marker ${marker}`);
      }
    }
  }

  const candlesSource = read('src/api/services/CandlesSchedulerService.ts');
  for (const marker of ['syncedFromIso', 'syncedToIso', 'lastSyncedAtIso']) {
    if (!candlesSource.includes(marker)) {
      findings.push(`CandlesSchedulerService.ts: missing Phase 3 sync-state marker ${marker}`);
    }
  }

  const runtimeTestSource = read('scripts/test-global-system-schedulers.ts');
  for (const marker of [
    'assertPhaseThreeLocalizedTimeContract',
    'displayTimesLocalized, true',
    '+05:30',
    'createdAtIso',
  ]) {
    if (!runtimeTestSource.includes(marker)) {
      findings.push(`test-global-system-schedulers.ts: missing Phase 3 runtime marker ${marker}`);
    }
  }

  const phaseOneGuard = read('scripts/test-global-system-schedulers-phase1.ts');
  if (!phaseOneGuard.includes('displayTimesLocalized:')) {
    findings.push('Phase 1 guard must stay tolerant of later scheduler localization phases');
  }

  const packageSource = read('package.json');
  if (!packageSource.includes('"test:global-system-schedulers-phase3"')) {
    findings.push('package.json: missing global system schedulers Phase 3 test script');
  }
  if (!packageSource.includes('npm run test:global-system-schedulers-phase3')) {
    findings.push('package.json: global system schedulers Phase 3 guard must stay wired');
  }

  assert.equal(
    findings.length,
    0,
    `Global system schedulers Phase 3 guard failed:\n${findings.join('\n')}`
  );
  console.log('Global system schedulers Phase 3 guard passed.');
}

run();
