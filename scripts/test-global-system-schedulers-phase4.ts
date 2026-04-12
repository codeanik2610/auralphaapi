import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function run(): void {
  const findings: string[] = [];

  const phaseDoc = read('GLOBAL_SYSTEM_SCHEDULERS_PHASE4.md');
  for (const marker of [
    '`broker-assets-sync`',
    '`exchange-assets-sync`',
    '`binance-candles-3m-1m-sync`',
    '`system-health-sync`',
    'Update-log retention and purge behavior is now scoped by `scheduler_key`.',
    'Update logs are deleted before run logs for these schedulers.',
    'new health detail rows in `scheduler_health_check_results` purge before the matching run logs',
    'Phase 5 should build on this stable cleanup contract',
  ]) {
    if (!phaseDoc.includes(marker)) {
      findings.push(`GLOBAL_SYSTEM_SCHEDULERS_PHASE4.md: missing contract marker ${marker}`);
    }
  }

  const readme = read('README.md');
  if (!readme.includes('GLOBAL_SYSTEM_SCHEDULERS_PHASE4.md')) {
    findings.push('README.md: missing global system schedulers Phase 4 baseline link');
  }
  if (!readme.includes('scheduler-scoped purge and retention truth')) {
    findings.push('README.md: missing global system scheduler Phase 4 baseline summary');
  }

  const repositorySource = read('src/database/repositories/ExchangeAssetUpdateLogRepository.ts');
  for (const marker of [
    'deleteOlderThanDaysBySchedulerKey(',
    'countOlderThanDaysBySchedulerKey(',
    'created_at < DATE_SUB(NOW(), INTERVAL :retentionDays DAY)',
    'log.createdAt < DATE_SUB(NOW(), INTERVAL :retentionDays DAY)',
  ]) {
    if (!repositorySource.includes(marker)) {
      findings.push(`ExchangeAssetUpdateLogRepository.ts: missing Phase 4 marker ${marker}`);
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
      'countOlderThanDaysBySchedulerKey(',
      'deleteOlderThanDaysBySchedulerKey(',
    ]) {
      if (!source.includes(marker)) {
        findings.push(`${relativePath}: missing Phase 4 service marker ${marker}`);
      }
    }
    if (source.includes('updateLogsDeleted: 0')) {
      findings.push(`${relativePath}: Phase 4 should not hardcode updateLogsDeleted: 0`);
    }
    if (source.includes('updateLogsToDelete: 0')) {
      findings.push(`${relativePath}: Phase 4 should not hardcode updateLogsToDelete: 0`);
    }
  }

  const runtimeTestSource = read('scripts/test-global-system-schedulers.ts');
  for (const marker of [
    'assertPhaseFourRetentionContract',
    "callOrder, isHealthSchedulerCase(testCase) ? ['update', 'health', 'run'] : ['update', 'run']",
    'genericCountCalls',
    'genericDeleteCalls',
    'dedicatedCountCalls',
    'dedicatedDeleteCalls',
    'isHealthSchedulerCase(testCase) ? 10 : 7',
  ]) {
    if (!runtimeTestSource.includes(marker)) {
      findings.push(`test-global-system-schedulers.ts: missing Phase 4 runtime marker ${marker}`);
    }
  }

  const packageSource = read('package.json');
  if (!packageSource.includes('"test:global-system-schedulers-phase4"')) {
    findings.push('package.json: missing global system schedulers Phase 4 test script');
  }
  if (!packageSource.includes('npm run test:global-system-schedulers-phase4')) {
    findings.push('package.json: global system schedulers Phase 4 guard must stay wired');
  }

  assert.equal(
    findings.length,
    0,
    `Global system schedulers Phase 4 guard failed:\n${findings.join('\n')}`
  );
  console.log('Global system schedulers Phase 4 guard passed.');
}

run();
