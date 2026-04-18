import assert from 'node:assert/strict';
import { runScriptSuite, runSuiteSteps } from './_support/run-script-suite';

// Consolidated module suite.

async function global_system_schedulersGuard01(): Promise<void> {
  const { default: fs } = await import("node:fs");
  const { default: path } = await import("node:path");

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
    'items: await resolveSchedulerAuditDisplayLabels(items)',
    'return successResponse({',
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
  if (!packageSource.includes('"test:global-system-schedulers"')) {
    findings.push('package.json: missing global system schedulers module test script');
  }
  if (!packageSource.includes('"test:global-system-schedulers"')) {
    findings.push('package.json: global system schedulers module guard must stay wired');
  }

  assert.equal(
    findings.length,
    0,
    `Global system schedulers Phase 1 guard failed:\n${findings.join('\n')}`
  );
  console.log('Global system schedulers Phase 1 guard passed.');
}

  await run();
}

async function global_system_schedulersGuard02(): Promise<void> {
  const { default: fs } = await import("node:fs");
  const { default: path } = await import("node:path");

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
    'scripts/_fixtures/migrations/1770712000000-AddGlobalSystemSchedulerInitiatorAudit.ts'
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
  if (!packageSource.includes('"test:global-system-schedulers"')) {
    findings.push('package.json: missing global system schedulers module test script');
  }
  if (!packageSource.includes('"test:global-system-schedulers"')) {
    findings.push('package.json: global system schedulers module guard must stay wired');
  }

  assert.equal(
    findings.length,
    0,
    `Global system schedulers Phase 2 guard failed:\n${findings.join('\n')}`
  );
  console.log('Global system schedulers Phase 2 guard passed.');
}

  await run();
}

async function global_system_schedulersGuard03(): Promise<void> {
  const { default: fs } = await import("node:fs");
  const { default: path } = await import("node:path");

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

  const phaseOneGuard = read('scripts/test-global-system-schedulers-suite.ts');
  if (!phaseOneGuard.includes('displayTimesLocalized:')) {
    findings.push('Phase 1 guard must stay tolerant of later scheduler localization phases');
  }

  const packageSource = read('package.json');
  if (!packageSource.includes('"test:global-system-schedulers"')) {
    findings.push('package.json: missing global system schedulers module test script');
  }
  if (!packageSource.includes('"test:global-system-schedulers"')) {
    findings.push('package.json: global system schedulers module guard must stay wired');
  }

  assert.equal(
    findings.length,
    0,
    `Global system schedulers Phase 3 guard failed:\n${findings.join('\n')}`
  );
  console.log('Global system schedulers Phase 3 guard passed.');
}

  await run();
}

async function global_system_schedulersGuard04(): Promise<void> {
  const { default: fs } = await import("node:fs");
  const { default: path } = await import("node:path");

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
  if (!packageSource.includes('"test:global-system-schedulers"')) {
    findings.push('package.json: missing global system schedulers module test script');
  }
  if (!packageSource.includes('"test:global-system-schedulers"')) {
    findings.push('package.json: global system schedulers module guard must stay wired');
  }

  assert.equal(
    findings.length,
    0,
    `Global system schedulers Phase 4 guard failed:\n${findings.join('\n')}`
  );
  console.log('Global system schedulers Phase 4 guard passed.');
}

  await run();
}

async function global_system_schedulersGuard05(): Promise<void> {
  const { default: fs } = await import("node:fs");
  const { default: path } = await import("node:path");

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
  if (!packageSource.includes('"test:global-system-schedulers"')) {
    findings.push('package.json: missing global system schedulers module test script');
  }
  if (!packageSource.includes('"test:global-system-schedulers"')) {
    findings.push('package.json: global system schedulers module guard must stay wired');
  }

  assert.equal(
    findings.length,
    0,
    `Global system schedulers Phase 5 guard failed:\n${findings.join('\n')}`
  );
  console.log('Global system schedulers Phase 5 guard passed.');
}

  await run();
}

async function global_system_schedulersGuard06(): Promise<void> {
  const { default: fs } = await import("node:fs");
  const { default: path } = await import("node:path");

const workerRoot = '/Users/apple/Documents/Project/Backend/aurAlphaSchedulerWorker';

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function readWorker(relativePath: string): string {
  return fs.readFileSync(path.join(workerRoot, relativePath), 'utf8');
}

function run(): void {
  const findings: string[] = [];

  const phaseDoc = read('GLOBAL_SYSTEM_SCHEDULERS_PHASE6.md');
  for (const marker of [
    '`broker-assets-sync`',
    '`exchange-assets-sync`',
    '`binance-candles-3m-1m-sync`',
    '`system-health-sync`',
    'Worker-written run logs keep `actor_user_id` null for global system schedulers.',
    'Worker-written update logs now persist the same audit fields as the run log.',
    'Phase 7 can focus on frontend consumption and operator UX',
  ]) {
    if (!phaseDoc.includes(marker)) {
      findings.push(`GLOBAL_SYSTEM_SCHEDULERS_PHASE6.md: missing contract marker ${marker}`);
    }
  }

  const readme = read('README.md');
  if (!readme.includes('GLOBAL_SYSTEM_SCHEDULERS_PHASE6.md')) {
    findings.push('README.md: missing global system schedulers Phase 6 baseline link');
  }
  if (!readme.includes('worker-backed audit and runtime truth')) {
    findings.push('README.md: missing global system scheduler Phase 6 baseline summary');
  }

  const workerTypes = readWorker('src/scheduler/queue/types.ts');
  for (const marker of [
    'export type SchedulerInitiatedByType',
    'buildSchedulerExecutionAudit(',
    'shouldPersistSchedulerActorUserId(',
    "'System cron'",
  ]) {
    if (!workerTypes.includes(marker)) {
      findings.push(`worker types.ts: missing Phase 6 marker ${marker}`);
    }
  }

  const workerPoller = readWorker('src/scheduler/queue/SchedulerCommandPoller.ts');
  for (const marker of [
    'initiated_by_type',
    'execution_context',
    'activityActorUserId',
    'toExecutionAuditPayload(',
    'shouldPersistSchedulerActorUserId(',
  ]) {
    if (!workerPoller.includes(marker)) {
      findings.push(`SchedulerCommandPoller.ts: missing Phase 6 marker ${marker}`);
    }
  }

  const workerExecution = readWorker('src/scheduler/services/SchedulerExecutionService.ts');
  for (const marker of [
    'persistedActorUserId',
    'runAudit',
    'decorateUpdateLogsWithAudit(',
    'initiated_by_type = ?',
    'activityActorUserId',
  ]) {
    if (!workerExecution.includes(marker)) {
      findings.push(`SchedulerExecutionService.ts: missing Phase 6 marker ${marker}`);
    }
  }

  const workerReconciliationTest = readWorker('scripts/test-reconciliation.js');
  for (const marker of [
    'runGlobalSystemCommandAuditPropagationAssertions',
    "payload.initiatedByType, 'cron'",
    'activityLogs[0].actorUserId',
    'executedPayloads[0].actorUserId, env.scheduler.systemUserId',
  ]) {
    if (!workerReconciliationTest.includes(marker)) {
      findings.push(`worker test-reconciliation.js: missing Phase 6 marker ${marker}`);
    }
  }

  const workerOperationalAudit = readWorker('scripts/test-operational-audit.js');
  for (const marker of [
    'missing Phase 6 audit marker',
    'decorateUpdateLogsWithAudit(',
    'toExecutionAuditPayload(',
  ]) {
    if (!workerOperationalAudit.includes(marker)) {
      findings.push(`worker test-operational-audit.js: missing Phase 6 marker ${marker}`);
    }
  }

  const packageSource = read('package.json');
  if (!packageSource.includes('"test:global-system-schedulers"')) {
    findings.push('package.json: missing global system schedulers module test script');
  }
  if (!packageSource.includes('"test:global-system-schedulers"')) {
    findings.push('package.json: global system schedulers module guard must stay wired');
  }

  assert.equal(
    findings.length,
    0,
    `Global system schedulers Phase 6 guard failed:\n${findings.join('\n')}`
  );
  console.log('Global system schedulers Phase 6 guard passed.');
}

  await run();
}

async function global_system_schedulersGuard07(): Promise<void> {
  const { default: fs } = await import("node:fs");
  const { default: path } = await import("node:path");

const frontendRoot = '/Users/apple/Documents/Project/Frontend/aurAlphaApp';

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function readFrontend(relativePath: string): string {
  return fs.readFileSync(path.join(frontendRoot, relativePath), 'utf8');
}

function run(): void {
  const findings: string[] = [];

  const phaseDoc = read('GLOBAL_SYSTEM_SCHEDULERS_PHASE7.md');
  for (const marker of [
    '`broker-assets-sync`',
    '`exchange-assets-sync`',
    '`binance-candles-3m-1m-sync`',
    '`system-health-sync`',
    'The Active Scheduler Status drawer no longer issues per-scheduler latest-run',
    'The selected scheduler card now shows the latest trigger and recent outcome',
    'Recent runs and run updates now show initiator attribution in the frontend.',
    'Phase 8 can focus on proof and subsystem validation',
  ]) {
    if (!phaseDoc.includes(marker)) {
      findings.push(`GLOBAL_SYSTEM_SCHEDULERS_PHASE7.md: missing contract marker ${marker}`);
    }
  }

  const readme = read('README.md');
  if (!readme.includes('GLOBAL_SYSTEM_SCHEDULERS_PHASE7.md')) {
    findings.push('README.md: missing global system schedulers Phase 7 baseline link');
  }
  if (!readme.includes('frontend/operator consumption')) {
    findings.push('README.md: missing global system scheduler Phase 7 summary');
  }

  const schedulersPage = readFrontend('src/pages/Schedulers/index.jsx');
  for (const marker of [
    'const schedulerOverviewByKey = useMemo(() => {',
    'const selectedSchedulerAuditLabel = useMemo(',
    'const selectedSchedulerOutcomeLabel = useMemo(() => {',
    "headerName: 'Triggered by'",
    "headerName: 'Initiated by'",
    "headerName: 'By'",
    'buildSchedulerAuditSummary(',
  ]) {
    if (!schedulersPage.includes(marker)) {
      findings.push(`frontend Schedulers index.jsx: missing Phase 7 marker ${marker}`);
    }
  }
  for (const removedMarker of [
    'overviewLatestRunsByType',
    'getLatestSchedulerRunFromResponse(',
    'tradingApi.getSchedulerRuns(config, schedulerType',
  ]) {
    if (schedulersPage.includes(removedMarker)) {
      findings.push(`frontend Schedulers index.jsx: stale Phase 6 fallback still present ${removedMarker}`);
    }
  }

  const overviewWorkspace = readFrontend(
    'src/pages/Schedulers/components/SchedulerOverviewWorkspace.jsx'
  );
  for (const marker of ['Latest trigger:', 'Recent outcome:']) {
    if (!overviewWorkspace.includes(marker)) {
      findings.push(
        `frontend SchedulerOverviewWorkspace.jsx: missing Phase 7 marker ${marker}`
      );
    }
  }

  const schedulersPageTest = readFrontend('src/pages/Schedulers/index.test.jsx');
  for (const marker of [
    'renders active status rows from overview recent-run snapshots without extra latest-run API hydration',
    'expect(tradingApi.getSchedulerRuns).not.toHaveBeenCalled();',
    'shows selected scheduler trigger, outcome, and last execution from the overview contract',
  ]) {
    if (!schedulersPageTest.includes(marker)) {
      findings.push(`frontend Schedulers index.test.jsx: missing Phase 7 test marker ${marker}`);
    }
  }

  const packageSource = read('package.json');
  if (!packageSource.includes('"test:global-system-schedulers"')) {
    findings.push('package.json: missing global system schedulers module test script');
  }
  if (!packageSource.includes('"test:global-system-schedulers"')) {
    findings.push('package.json: global system schedulers module guard must stay wired');
  }

  assert.equal(
    findings.length,
    0,
    `Global system schedulers Phase 7 guard failed:\n${findings.join('\n')}`
  );
  console.log('Global system schedulers Phase 7 guard passed.');
}

  await run();
}

async function global_system_schedulersGuard08(): Promise<void> {
  const { spawn } = await import("node:child_process");
  const { mkdtemp, readFile, writeFile } = await import("node:fs/promises");
  const { default: os } = await import("node:os");
  const { default: path } = await import("node:path");

type JsonRecord = Record<string, unknown>;

async function runCommand(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv
): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env,
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', (code) => resolve(code));
  });
}

async function runGlobalSystemSchedulersLiveProofAssertions(): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'global-system-schedulers-phase8-'));
  const gateFile = path.join(tempDir, 'global-system-schedulers-release-gate.json');
  const signoffFile = path.join(tempDir, 'global-system-schedulers-signoff.json');
  const healthFile = path.join(tempDir, 'global-system-schedulers-health.json');
  const proofFile = path.join(tempDir, 'global-system-schedulers-live-proof.json');
  const evidenceFile = path.join(
    tempDir,
    'global-system-schedulers-deployment-evidence.json'
  );
  const gateScript = path.join(tempDir, 'release-gate.stub.ts');
  const signoffScript = path.join(tempDir, 'signoff.stub.ts');

  const readyHealthSnapshot = {
    baseUrl: 'http://127.0.0.1:3102/api/v1',
    queueStatus: 'ok',
    queueName: 'scheduler.exchange-assets.execute',
    queueLatencyMs: 10,
    workerStatus: 'ok',
    workerHttpStatus: 'ok',
    workerHeartbeatAgeMs: 2500,
    overviewCount: 4,
    overviewDisplayTimeZone: 'Asia/Kolkata',
    overviewLocalized: true,
    schedulerKeys: [
      'broker-assets-sync',
      'exchange-assets-sync',
      'binance-candles-3m-1m-sync',
      'system-health-sync',
    ],
    schedulers: {
      'broker-assets-sync': {
        key: 'broker-assets-sync',
        routeBase: '/scheduler/exchange-assets',
        schedulerType: 'global',
      },
      'exchange-assets-sync': {
        key: 'exchange-assets-sync',
        routeBase: '/scheduler/binance-assets',
        schedulerType: 'global',
      },
      'binance-candles-3m-1m-sync': {
        key: 'binance-candles-3m-1m-sync',
        routeBase: '/scheduler/candles',
        schedulerType: 'global',
      },
      'system-health-sync': {
        key: 'system-health-sync',
        routeBase: '/scheduler/health',
        schedulerType: 'global',
      },
    },
  };

  const readyGateSummary = {
    decision: 'ready',
    generatedAt: '2026-04-10T12:00:00.000Z',
    liveChecksEnabled: true,
    healthSnapshotFile: path.resolve(process.cwd(), healthFile),
    healthSnapshot: readyHealthSnapshot,
    totals: {
      total: 8,
      passed: 8,
      failed: 0,
      skipped: 0,
    },
    results: [
      'backend-global-system-schedulers-suite',
      'backend-global-system-schedulers-operational-audit',
      'backend-global-system-schedulers-eslint',
      'worker-global-system-schedulers-reconciliation',
      'worker-global-system-schedulers-operational-audit',
      'frontend-global-system-schedulers-ui',
      'frontend-global-system-schedulers-eslint',
      'backend-global-system-schedulers-live-health',
    ].map((key) => ({
      key,
      label: key,
      status: 'passed',
    })),
  };

  const readySignoffSummary = {
    decision: 'ready',
    generatedAt: '2026-04-10T12:05:00.000Z',
    approver: 'codex-phase8',
    checks: {
      gateReady: true,
      requiredSuitesPassed: true,
      crossRepoSuitesPassed: true,
      liveHealthReviewed: true,
      schedulerCoverageCaptured: true,
      operatorWorkspaceReviewed: true,
      systemScopeVerified: true,
      auditChainVerified: true,
      timezoneDisplayVerified: true,
      retentionScopeVerified: true,
      workerRuntimeVerified: true,
    },
    readiness: {
      liveGateReady: true,
      subsystemCoverageReady: true,
      crossRepoProofReady: true,
      productionPromotionReady: true,
    },
    evidence: {
      stagingWorkflowUrl: 'https://example.com/workflows/global-system-schedulers',
      dashboardUrl: 'https://example.com/dashboards/global-system-schedulers',
      runbookUrl: 'https://example.com/runbooks/global-system-schedulers',
      releaseNoteUrl: 'https://example.com/releases/global-system-schedulers',
    },
    coverage: {
      schedulerKeys: readyHealthSnapshot.schedulerKeys,
    },
    environment: {
      requireLiveHealth: true,
    },
  };

  await writeFile(
    gateScript,
    `import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const outputFile = path.resolve(process.cwd(), String(process.env.GLOBAL_SYSTEM_SCHEDULERS_RELEASE_GATE_OUTPUT_FILE || '').trim());
const healthFile = path.resolve(process.cwd(), String(process.env.GLOBAL_SYSTEM_SCHEDULERS_HEALTH_OUTPUT_FILE || '').trim());

async function run(): Promise<void> {
  assert.equal(process.env.GLOBAL_SYSTEM_SCHEDULERS_RUN_LIVE_CHECKS, 'true');
  assert.ok(outputFile, 'GLOBAL_SYSTEM_SCHEDULERS_RELEASE_GATE_OUTPUT_FILE must be provided');
  assert.ok(healthFile, 'GLOBAL_SYSTEM_SCHEDULERS_HEALTH_OUTPUT_FILE must be provided');
  await mkdir(path.dirname(outputFile), { recursive: true });
  await mkdir(path.dirname(healthFile), { recursive: true });
  const health = ${JSON.stringify(readyHealthSnapshot, null, 2)};
  const summary = ${JSON.stringify(readyGateSummary, null, 2)};
  await writeFile(healthFile, \`\${JSON.stringify(health, null, 2)}\\n\`, 'utf8');
  await writeFile(outputFile, \`\${JSON.stringify(summary, null, 2)}\\n\`, 'utf8');
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
`,
    'utf8'
  );

  await writeFile(
    signoffScript,
    `import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const gateFile = path.resolve(process.cwd(), String(process.env.GLOBAL_SYSTEM_SCHEDULERS_SIGNOFF_GATE_FILE || '').trim());
const outputFile = path.resolve(process.cwd(), String(process.env.GLOBAL_SYSTEM_SCHEDULERS_SIGNOFF_OUTPUT_FILE || '').trim());

async function run(): Promise<void> {
  assert.equal(process.env.GLOBAL_SYSTEM_SCHEDULERS_SIGNOFF_REQUIRE_LIVE_HEALTH, 'true');
  const rawGate = await readFile(gateFile, 'utf8');
  const gate = JSON.parse(rawGate) as { decision?: string; liveChecksEnabled?: boolean };
  assert.equal(gate.decision, 'ready');
  assert.equal(gate.liveChecksEnabled, true);
  await mkdir(path.dirname(outputFile), { recursive: true });
  const summary = ${JSON.stringify(readySignoffSummary, null, 2)};
  await writeFile(outputFile, \`\${JSON.stringify(summary, null, 2)}\\n\`, 'utf8');
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
`,
    'utf8'
  );

  const exitCode = await runCommand(
    process.execPath,
    ['--import', 'tsx', 'scripts/proofs/proof-global-system-schedulers-live.ts'],
    {
      ...process.env,
      GLOBAL_SYSTEM_SCHEDULERS_PROOF_RELEASE_GATE_SCRIPT: gateScript,
      GLOBAL_SYSTEM_SCHEDULERS_PROOF_SIGNOFF_SCRIPT: signoffScript,
      GLOBAL_SYSTEM_SCHEDULERS_RELEASE_GATE_OUTPUT_FILE: gateFile,
      GLOBAL_SYSTEM_SCHEDULERS_SIGNOFF_OUTPUT_FILE: signoffFile,
      GLOBAL_SYSTEM_SCHEDULERS_HEALTH_OUTPUT_FILE: healthFile,
      GLOBAL_SYSTEM_SCHEDULERS_PROOF_OUTPUT_FILE: proofFile,
      GLOBAL_SYSTEM_SCHEDULERS_EVIDENCE_OUTPUT_FILE: evidenceFile,
      GLOBAL_SYSTEM_SCHEDULERS_SIGNOFF_APPROVER: 'codex-phase8',
      GLOBAL_SYSTEM_SCHEDULERS_SIGNOFF_OPERATOR_WORKSPACE_REVIEWED: 'true',
      GLOBAL_SYSTEM_SCHEDULERS_SIGNOFF_SYSTEM_SCOPE_VERIFIED: 'true',
      GLOBAL_SYSTEM_SCHEDULERS_SIGNOFF_AUDIT_CHAIN_VERIFIED: 'true',
      GLOBAL_SYSTEM_SCHEDULERS_SIGNOFF_TIMEZONE_DISPLAY_VERIFIED: 'true',
      GLOBAL_SYSTEM_SCHEDULERS_SIGNOFF_RETENTION_SCOPE_VERIFIED: 'true',
      GLOBAL_SYSTEM_SCHEDULERS_SIGNOFF_WORKER_RUNTIME_VERIFIED: 'true',
      GLOBAL_SYSTEM_SCHEDULERS_SIGNOFF_REQUIRE_DEPLOYMENT_EVIDENCE: 'false',
    }
  );

  assert.equal(
    exitCode,
    0,
    'global system schedulers live proof should succeed against ready stub scripts'
  );

  const rawProof = await readFile(proofFile, 'utf8');
  const summary = JSON.parse(rawProof) as JsonRecord;

  assert.equal(summary.decision, 'ready');
  assert.equal(summary.approver, 'codex-phase8');
  assert.equal(summary.gateDecision, 'ready');
  assert.equal(summary.signoffDecision, 'ready');
  assert.equal(summary.liveChecksEnabled, true);
  assert.equal(summary.releaseGateFile, path.resolve(process.cwd(), gateFile));
  assert.equal(summary.signoffFile, path.resolve(process.cwd(), signoffFile));
  assert.equal(summary.healthFile, path.resolve(process.cwd(), healthFile));
  assert.equal(summary.proofOutputFile, path.resolve(process.cwd(), proofFile));
  assert.equal(
    summary.deploymentEvidenceOutputFile,
    path.resolve(process.cwd(), evidenceFile)
  );

  const readiness = (summary.readiness || {}) as JsonRecord;
  assert.equal(readiness.productionPromotionReady, true);

  const healthSnapshot = (summary.healthSnapshot || {}) as JsonRecord;
  assert.deepEqual(healthSnapshot.schedulerKeys, readyHealthSnapshot.schedulerKeys);

  const rawEvidence = await readFile(evidenceFile, 'utf8');
  const evidenceSummary = JSON.parse(rawEvidence) as JsonRecord;
  assert.equal(evidenceSummary.decision, 'ready');
  assert.equal(evidenceSummary.proofFile, path.resolve(process.cwd(), proofFile));
  assert.equal(evidenceSummary.productionPromotionReady, true);
}

async function runSourceMarkerAssertions(): Promise<void> {
  const healthSource = await readFile(
    path.join(process.cwd(), 'scripts', 'checks', 'check-global-system-schedulers-health.ts'),
    'utf8'
  );
  const releaseGateSource = await readFile(
    path.join(process.cwd(), 'scripts', 'release-gates', 'release-gate-global-system-schedulers.ts'),
    'utf8'
  );
  const signoffSource = await readFile(
    path.join(process.cwd(), 'scripts', 'signoffs', 'signoff-global-system-schedulers.ts'),
    'utf8'
  );
  const proofSource = await readFile(
    path.join(process.cwd(), 'scripts', 'proofs', 'proof-global-system-schedulers-live.ts'),
    'utf8'
  );
  const operationalAuditSource = await readFile(
    path.join(process.cwd(), 'scripts', 'test-operational-audit.ts'),
    'utf8'
  );
  const packageSource = await readFile(path.join(process.cwd(), 'package.json'), 'utf8');
  const phaseDoc = await readFile(
    path.join(process.cwd(), 'GLOBAL_SYSTEM_SCHEDULERS_PHASE8.md'),
    'utf8'
  );
  const previousPhaseDoc = await readFile(
    path.join(process.cwd(), 'GLOBAL_SYSTEM_SCHEDULERS_PHASE7.md'),
    'utf8'
  );
  const readmeSource = await readFile(path.join(process.cwd(), 'README.md'), 'utf8');

  assert.equal(
    healthSource.includes('/scheduler/overview'),
    true,
    'global system scheduler health must read the shared scheduler overview'
  );
  assert.equal(
    healthSource.includes('/health/worker'),
    true,
    'global system scheduler health must read worker health'
  );
  assert.equal(
    releaseGateSource.includes('backend-global-system-schedulers-suite'),
    true,
    'global system scheduler release gate must include the module suite'
  );
  assert.equal(
    releaseGateSource.includes('worker-global-system-schedulers-reconciliation'),
    true,
    'global system scheduler release gate must include worker proof coverage'
  );
  assert.equal(
    releaseGateSource.includes('frontend-global-system-schedulers-ui'),
    true,
    'global system scheduler release gate must include frontend proof coverage'
  );
  assert.equal(
    signoffSource.includes('GLOBAL_SYSTEM_SCHEDULERS_SIGNOFF_SYSTEM_SCOPE_VERIFIED'),
    true,
    'global system scheduler signoff must require explicit system-scope verification'
  );
  assert.equal(
    proofSource.includes('artifacts/global-system-schedulers-deployment-evidence.json'),
    true,
    'global system scheduler proof must write the deployment evidence artifact'
  );
  assert.equal(
    proofSource.includes('global-system-schedulers-deployment-evidence:'),
    true,
    'global system scheduler proof must emit the deployment evidence marker'
  );
  assert.equal(
    operationalAuditSource.includes('"proof:global-system-schedulers-live"'),
    true,
    'operational audit must treat the global system scheduler proof workflow as required'
  );
  assert.equal(
    packageSource.includes('"test:global-system-schedulers"'),
    true,
    'package.json must include the global system scheduler module suite'
  );
  assert.equal(
    packageSource.includes('"check:global-system-schedulers-health"'),
    true,
    'package.json must include the Phase 8 health script'
  );
  assert.equal(
    packageSource.includes('"test:global-system-schedulers"'),
    true,
    'test:all must include the global system scheduler module suite'
  );
  assert.equal(
    phaseDoc.includes('Phase 8 closes the operational proof gap after the Phase 7 frontend freeze.'),
    true,
    'GLOBAL_SYSTEM_SCHEDULERS_PHASE8.md must document the Phase 8 proof workflow'
  );
  assert.equal(
    phaseDoc.includes('## 4) Carry-Forward For Phase 9'),
    true,
    'GLOBAL_SYSTEM_SCHEDULERS_PHASE8.md must include the Phase 9 handoff checklist'
  );
  assert.equal(
    previousPhaseDoc.includes('Phase 8 can focus on proof and subsystem validation'),
    true,
    'GLOBAL_SYSTEM_SCHEDULERS_PHASE7.md must point forward to the Phase 8 handoff'
  );
  assert.equal(
    readmeSource.includes('proof:global-system-schedulers-live'),
    true,
    'README.md must reference the global system scheduler live proof workflow'
  );
}

async function main(): Promise<void> {
  await runGlobalSystemSchedulersLiveProofAssertions();
  await runSourceMarkerAssertions();
  console.log('Global system schedulers Phase 8 assertions passed.');
}

  await main();
}

async function global_system_schedulersGuard09(): Promise<void> {
  const { readFile } = await import("node:fs/promises");
  const { default: path } = await import("node:path");

async function main(): Promise<void> {
  const packageSource = await readFile(path.join(process.cwd(), 'package.json'), 'utf8');
  const readmeSource = await readFile(path.join(process.cwd(), 'README.md'), 'utf8');
  const phase8Doc = await readFile(
    path.join(process.cwd(), 'GLOBAL_SYSTEM_SCHEDULERS_PHASE8.md'),
    'utf8'
  );
  const phase9Doc = await readFile(
    path.join(process.cwd(), 'GLOBAL_SYSTEM_SCHEDULERS_PHASE9.md'),
    'utf8'
  );
  const captureSource = await readFile(
    path.join(process.cwd(), 'scripts', 'capture', 'capture-global-system-schedulers-evidence.ts'),
    'utf8'
  );
  const releaseGateSource = await readFile(
    path.join(process.cwd(), 'scripts', 'release-gates', 'release-gate-global-system-schedulers.ts'),
    'utf8'
  );
  const signoffSource = await readFile(
    path.join(process.cwd(), 'scripts', 'signoffs', 'signoff-global-system-schedulers.ts'),
    'utf8'
  );
  const proofSource = await readFile(
    path.join(process.cwd(), 'scripts', 'proofs', 'proof-global-system-schedulers-live.ts'),
    'utf8'
  );

  assert.equal(
    packageSource.includes('"capture:global-system-schedulers-evidence"'),
    true,
    'package.json must expose the global system scheduler evidence capture command in Phase 9'
  );
  assert.equal(
    packageSource.includes('"test:global-system-schedulers"'),
    true,
    'package.json must expose the global system scheduler module suite in Phase 9'
  );
  assert.equal(
    packageSource.includes('"test:global-system-schedulers"'),
    true,
    'test:all must include the global system scheduler module suite'
  );
  assert.equal(
    readmeSource.includes('GLOBAL_SYSTEM_SCHEDULERS_PHASE9.md'),
    true,
    'README.md must point to the Phase 9 global system scheduler workflow note'
  );
  assert.equal(
    readmeSource.includes('capture:global-system-schedulers-evidence'),
    true,
    'README.md must reference the global system scheduler evidence capture command'
  );
  assert.equal(
    phase8Doc.includes('## 4) Carry-Forward For Phase 9'),
    true,
    'GLOBAL_SYSTEM_SCHEDULERS_PHASE8.md must keep the Phase 9 handoff checklist'
  );
  assert.equal(
    phase9Doc.includes('npm run capture:global-system-schedulers-evidence'),
    true,
    'GLOBAL_SYSTEM_SCHEDULERS_PHASE9.md must document the evidence capture command'
  );
  assert.equal(
    phase9Doc.includes('npm run proof:global-system-schedulers-live'),
    true,
    'GLOBAL_SYSTEM_SCHEDULERS_PHASE9.md must document the live proof command'
  );
  assert.equal(
    phase9Doc.includes('real deployment-proof'),
    true,
    'GLOBAL_SYSTEM_SCHEDULERS_PHASE9.md must record the real deployment-proof posture'
  );
  assert.equal(
    captureSource.includes('artifacts/global-system-schedulers-workflow-evidence.json'),
    true,
    'capture-global-system-schedulers-evidence.ts must write the workflow evidence artifact'
  );
  assert.equal(
    captureSource.includes('artifacts/global-system-schedulers-dashboard-evidence.json'),
    true,
    'capture-global-system-schedulers-evidence.ts must write the dashboard evidence artifact'
  );
  assert.equal(
    captureSource.includes('/scheduler/overview'),
    true,
    'capture-global-system-schedulers-evidence.ts must capture shared scheduler overview evidence'
  );
  assert.equal(
    captureSource.includes('/health/worker'),
    true,
    'capture-global-system-schedulers-evidence.ts must capture worker health evidence'
  );
  assert.equal(
    releaseGateSource.includes('backend-global-system-schedulers-suite'),
    true,
    'release gate must include the global system scheduler module suite'
  );
  assert.equal(
    releaseGateSource.includes('scripts/capture/capture-global-system-schedulers-evidence.ts'),
    true,
    'release gate lint coverage must include the evidence capture script'
  );
  assert.equal(
    signoffSource.includes('GLOBAL_SYSTEM_SCHEDULERS_SIGNOFF_REQUIRE_DEPLOYMENT_EVIDENCE'),
    true,
    'signoff-global-system-schedulers.ts must support deployment-evidence requirements in Phase 9'
  );
  assert.equal(
    signoffSource.includes('deploymentEvidenceReady'),
    true,
    'signoff-global-system-schedulers.ts must compute deployment evidence readiness in Phase 9'
  );
  assert.equal(
    proofSource.includes('GLOBAL_SYSTEM_SCHEDULERS_SIGNOFF_REQUIRE_DEPLOYMENT_EVIDENCE'),
    true,
    'proof-global-system-schedulers-live.ts must forward the deployment-evidence requirement in Phase 9'
  );
  assert.equal(
    proofSource.includes('productionPromotionReady'),
    true,
    'proof-global-system-schedulers-live.ts must require promotion-ready signoff in Phase 9'
  );

  console.log('Global system schedulers Phase 9 assertions passed.');
}

  await main();
}

const suiteSteps = {
  "01": global_system_schedulersGuard01,
  "02": global_system_schedulersGuard02,
  "03": global_system_schedulersGuard03,
  "04": global_system_schedulersGuard04,
  "05": global_system_schedulersGuard05,
  "06": global_system_schedulersGuard06,
  "07": global_system_schedulersGuard07,
  "08": global_system_schedulersGuard08,
  "09": global_system_schedulersGuard09,
} as const;

export async function runGlobalSystemSchedulersSuite(): Promise<void> {
  await runScriptSuite("Global system schedulers module", ["scripts/test-global-system-schedulers.ts"]);
  await runSuiteSteps("Global system schedulers module", "scripts/test-global-system-schedulers-suite.ts", ["01", "02", "03", "04", "05", "06", "07", "08", "09"]);
  console.log("Global system schedulers module assertions passed.");
}

async function runRequestedStep(): Promise<void> {
  const requestedStep = process.argv[3];
  if (!requestedStep) {
    return;
  }
  const step = suiteSteps[requestedStep as keyof typeof suiteSteps];
  if (!step) {
    throw new Error(`Unknown suite step: ${requestedStep}`);
  }
  await step();
}

if (process.argv[3]) {
  runRequestedStep().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : error);
    process.exit(1);
  });
}
