import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function run(): void {
  const findings: string[] = [];

  const phaseDoc = read('GLOBAL_SYSTEM_SCHEDULERS_PHASE2.md');
  for (const marker of [
    '`broker-assets-sync`',
    '`exchange-assets-sync`',
    '`binance-candles-3m-1m-sync`',
    '`system-health-sync`',
    'Manual admin actions record who requested the action separately from',
    'Execution scope stays `system` for these schedulers.',
    'Phase 3 should localize display timestamps on top of this now-stable audit',
  ]) {
    if (!phaseDoc.includes(marker)) {
      findings.push(`GLOBAL_SYSTEM_SCHEDULERS_PHASE2.md: missing contract marker ${marker}`);
    }
  }

  const readme = read('README.md');
  if (!readme.includes('GLOBAL_SYSTEM_SCHEDULERS_PHASE2.md')) {
    findings.push('README.md: missing global system schedulers Phase 2 baseline link');
  }
  if (!readme.includes('explicit initiator/audit contract')) {
    findings.push('README.md: missing global system scheduler Phase 2 baseline summary');
  }

  const contractSource = read('src/api/contracts/Scheduler.ts');
  for (const marker of [
    "export type SchedulerExecutionContext = 'system' | 'user';",
    'export interface SchedulerInitiator {',
    "type: 'manual' | 'cron' | 'system';",
    'initiatedBy?: SchedulerInitiator;',
    'executionContext?: SchedulerExecutionContext;',
  ]) {
    if (!contractSource.includes(marker)) {
      findings.push(`Scheduler.ts: missing Phase 2 audit marker ${marker}`);
    }
  }

  const auditContractSource = read('src/api/utils/schedulerAuditContract.ts');
  for (const marker of [
    'buildSystemSchedulerManualAudit(',
    'buildSystemSchedulerProcessAudit(',
    'toSchedulerAuditContract(',
    "executionContext: 'system'",
  ]) {
    if (!auditContractSource.includes(marker)) {
      findings.push(`schedulerAuditContract.ts: missing Phase 2 marker ${marker}`);
    }
  }

  for (const relativePath of [
    'src/database/entities/SchedulerRunLog.ts',
    'src/database/entities/SchedulerCommand.ts',
    'src/database/entities/ExchangeAssetUpdateLog.ts',
  ]) {
    const source = read(relativePath);
    for (const marker of [
      "name: 'initiated_by_type'",
      "name: 'initiated_by_user_id'",
      "name: 'initiated_by_label'",
      "name: 'execution_context'",
    ]) {
      if (!source.includes(marker)) {
        findings.push(`${relativePath}: missing Phase 2 entity marker ${marker}`);
      }
    }
  }

  const migrationSource = read(
    'src/database/migrations/1770712000000-AddGlobalSystemSchedulerInitiatorAudit.ts'
  );
  for (const marker of [
    'AddGlobalSystemSchedulerInitiatorAudit1770712000000',
    'ALTER TABLE scheduler_run_logs ADD COLUMN initiated_by_type',
    'ALTER TABLE scheduler_commands ADD COLUMN initiated_by_type',
    'ALTER TABLE exchange_asset_update_logs ADD COLUMN initiated_by_type',
    'execution_context = COALESCE',
  ]) {
    if (!migrationSource.includes(marker)) {
      findings.push(`Phase 2 migration: missing marker ${marker}`);
    }
  }

  const overviewSource = read('src/api/services/SchedulerOverviewService.ts');
  for (const marker of [
    'globalLatestRunRows',
    'userLatestRunRows',
    'initiated_by_type AS initiatedByType',
    '...toSchedulerAuditContract(',
  ]) {
    if (!overviewSource.includes(marker)) {
      findings.push(`SchedulerOverviewService.ts: missing Phase 2 marker ${marker}`);
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
      'buildSystemSchedulerManualAudit',
      'initiatedByType: manualAudit.initiatedByType',
      'executionContext: manualAudit.executionContext',
      '...toSchedulerAuditContract(',
    ]) {
      if (!source.includes(marker)) {
        findings.push(`${relativePath}: missing Phase 2 service marker ${marker}`);
      }
    }
  }

  const runtimeTestSource = read('scripts/test-global-system-schedulers.ts');
  for (const marker of [
    'AddGlobalSystemSchedulerInitiatorAudit1770712000000',
    'initiatedByType',
    'executionContext',
    'assertPhaseTwoAuditContract',
  ]) {
    if (!runtimeTestSource.includes(marker)) {
      findings.push(`test-global-system-schedulers.ts: missing Phase 2 runtime marker ${marker}`);
    }
  }

  const packageSource = read('package.json');
  if (!packageSource.includes('"test:global-system-schedulers-phase2"')) {
    findings.push('package.json: missing global system schedulers Phase 2 test script');
  }
  if (!packageSource.includes('npm run test:global-system-schedulers-phase2')) {
    findings.push('package.json: global system schedulers Phase 2 guard must stay wired');
  }

  assert.equal(
    findings.length,
    0,
    `Global system schedulers Phase 2 guard failed:\n${findings.join('\n')}`
  );
  console.log('Global system schedulers Phase 2 guard passed.');
}

run();
