import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

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
  if (!packageSource.includes('"test:global-system-schedulers-phase6"')) {
    findings.push('package.json: missing global system schedulers Phase 6 test script');
  }
  if (!packageSource.includes('npm run test:global-system-schedulers-phase6')) {
    findings.push('package.json: global system schedulers Phase 6 guard must stay wired');
  }

  assert.equal(
    findings.length,
    0,
    `Global system schedulers Phase 6 guard failed:\n${findings.join('\n')}`
  );
  console.log('Global system schedulers Phase 6 guard passed.');
}

run();
