import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function run(): void {
  const findings: string[] = [];

  const phaseDoc = read('GLOBAL_SYSTEM_SCHEDULERS_PHASE1.md');
  for (const marker of [
    '`broker-assets-sync`',
    '`exchange-assets-sync`',
    '`binance-candles-3m-1m-sync`',
    '`system-health-sync`',
    'Phase 1 does not change scheduler execution behavior.',
    'Storage stays UTC.',
    'Phase 2 must add explicit initiator and audit fields without changing global ownership.',
    'Phase 3 must localize display fields while keeping raw UTC ISO companions stable.',
  ]) {
    if (!phaseDoc.includes(marker)) {
      findings.push(`GLOBAL_SYSTEM_SCHEDULERS_PHASE1.md: missing contract marker ${marker}`);
    }
  }

  const exchangeAssetsChecklist = read('EXCHANGE_ASSETS_SYNC_FUNCTIONAL_CHECKLIST.md');
  for (const marker of [
    'Scheduler key: `exchange-assets-sync`',
    'Admin route base: `/scheduler/binance-assets`',
    '## 12. Time And Timezone Checks',
  ]) {
    if (!exchangeAssetsChecklist.includes(marker)) {
      findings.push(`EXCHANGE_ASSETS_SYNC_FUNCTIONAL_CHECKLIST.md: missing marker ${marker}`);
    }
  }

  const candlesChecklist = read('CANDLES_SYNC_FUNCTIONAL_CHECKLIST.md');
  for (const marker of [
    'Scheduler key: `binance-candles-3m-1m-sync`',
    'Admin route base: `/scheduler/candles`',
    'Default `maxLookbackDays` is `90`.',
    '## 6. Asset Scope, Sync-State, And Postgres Candle Coverage',
    '## 14. Time And Timezone Checks',
  ]) {
    if (!candlesChecklist.includes(marker)) {
      findings.push(`CANDLES_SYNC_FUNCTIONAL_CHECKLIST.md: missing marker ${marker}`);
    }
  }

  const healthChecklist = read('SYSTEM_HEALTH_SYNC_FUNCTIONAL_CHECKLIST.md');
  for (const marker of [
    'Scheduler key: `system-health-sync`',
    'Admin route base: `/scheduler/health`',
    "Default source list is `['health']`.",
    '## 5. System Probe Scope And Health Targets',
    '## 14. Time And Timezone Checks',
  ]) {
    if (!healthChecklist.includes(marker)) {
      findings.push(`SYSTEM_HEALTH_SYNC_FUNCTIONAL_CHECKLIST.md: missing marker ${marker}`);
    }
  }

  const readme = read('README.md');
  if (!readme.includes('GLOBAL_SYSTEM_SCHEDULERS_PHASE1.md')) {
    findings.push('README.md: missing global system schedulers Phase 1 baseline link');
  }
  if (!readme.includes('frozen backend Phase 1 contract')) {
    findings.push('README.md: missing global system scheduler Phase 1 baseline summary');
  }
  for (const marker of [
    'EXCHANGE_ASSETS_SYNC_FUNCTIONAL_CHECKLIST.md',
    'CANDLES_SYNC_FUNCTIONAL_CHECKLIST.md',
    'SYSTEM_HEALTH_SYNC_FUNCTIONAL_CHECKLIST.md',
  ]) {
    if (!readme.includes(marker)) {
      findings.push(`README.md: missing functional checklist reference ${marker}`);
    }
  }

  const contractSource = read('src/api/contracts/Scheduler.ts');
  for (const marker of [
    'export interface SchedulerTimeContract',
    'startedAtIso?: string;',
    'finishedAtIso?: string;',
    'createdAtIso?: string;',
    'queuedAtIso?: string;',
    'lastFinishedAtIso?: string;',
    'time?: SchedulerTimeContract;',
  ]) {
    if (!contractSource.includes(marker)) {
      findings.push(`Scheduler.ts: missing Phase 1 time contract marker ${marker}`);
    }
  }

  const timeContractSource = read('src/api/utils/schedulerTimeContract.ts');
  for (const marker of [
    'buildSchedulerTimeContract(',
    "storageTimeZone: 'UTC'",
    "rawTimeFields: 'iso-utc'",
    'displayTimesLocalized:',
  ]) {
    if (!timeContractSource.includes(marker)) {
      findings.push(`schedulerTimeContract.ts: missing Phase 1 marker ${marker}`);
    }
  }

  const overviewSource = read('src/api/services/SchedulerOverviewService.ts');
  for (const marker of [
    'buildSchedulerTimeContract(timeZone)',
    'startedAtIso:',
    'queuedAtIso:',
    'lastFinishedAtIso:',
    'return successResponse({ items, time });',
  ]) {
    if (!overviewSource.includes(marker)) {
      findings.push(`SchedulerOverviewService.ts: missing Phase 1 marker ${marker}`);
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
      'buildSchedulerTimeContract(timeZone)',
      'startedAtIso:',
      'finishedAtIso:',
      'createdAtIso:',
    ]) {
      if (!source.includes(marker)) {
        findings.push(`${relativePath}: missing Phase 1 marker ${marker}`);
      }
    }
  }

  const packageSource = read('package.json');
  if (!packageSource.includes('"test:global-system-schedulers-phase1"')) {
    findings.push('package.json: missing global system schedulers Phase 1 test script');
  }
  if (!packageSource.includes('npm run test:global-system-schedulers-phase1')) {
    findings.push('package.json: global system schedulers Phase 1 guard must stay wired');
  }

  assert.equal(
    findings.length,
    0,
    `Global system schedulers Phase 1 guard failed:\n${findings.join('\n')}`
  );
  console.log('Global system schedulers Phase 1 guard passed.');
}

run();
