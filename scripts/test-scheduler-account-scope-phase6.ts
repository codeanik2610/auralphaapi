import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function run(): void {
  const findings: string[] = [];

  const phaseDoc = read('SCHEDULER_ACCOUNT_SCOPE_PHASE6.md');
  for (const marker of [
    'Phase 6 archives the live ownership-alignment evidence and adds an operator',
    '`funds-sync`',
    '`orders-sync`',
    '`positions-sync`',
    '`npm run proof:scheduler-account-scope-live`',
    '`artifacts/scheduler-account-scope-live.json`',
    '`artifacts/scheduler-account-scope-live-proof.json`',
    'manual smoke proof, not an automatic release gate',
    '## 5) Phase 7 Entry Checklist',
  ]) {
    if (!phaseDoc.includes(marker)) {
      findings.push(`SCHEDULER_ACCOUNT_SCOPE_PHASE6.md: missing Phase 6 marker ${marker}`);
    }
  }

  const phase5Doc = read('SCHEDULER_ACCOUNT_SCOPE_PHASE5.md');
  if (!phase5Doc.includes('SCHEDULER_ACCOUNT_SCOPE_PHASE6.md')) {
    findings.push('SCHEDULER_ACCOUNT_SCOPE_PHASE5.md: missing Phase 6 handoff');
  }

  const packageSource = read('package.json');
  for (const marker of [
    '"test:scheduler-account-scope-phase6"',
    '"check:scheduler-account-scope-live"',
    '"proof:scheduler-account-scope-live"',
  ]) {
    if (!packageSource.includes(marker)) {
      findings.push(`package.json: missing Phase 6 script ${marker}`);
    }
  }
  if (!packageSource.includes('npm run test:scheduler-account-scope-phase6')) {
    findings.push('package.json: test:all must include the Phase 6 guard');
  }
  if (packageSource.includes('npm run proof:scheduler-account-scope-live && npm run type-check')) {
    findings.push('package.json: test:all must not depend on the live scheduler account-scope proof');
  }

  const readmeSource = read('README.md');
  if (!readmeSource.includes('SCHEDULER_ACCOUNT_SCOPE_PHASE6.md')) {
    findings.push('README.md: missing scheduler account-scope Phase 6 baseline link');
  }
  if (!readmeSource.includes('proof:scheduler-account-scope-live')) {
    findings.push('README.md: missing scheduler account-scope Phase 6 proof command');
  }
  if (!readmeSource.includes('manual smoke proof artifact')) {
    findings.push('README.md: missing scheduler account-scope Phase 6 summary');
  }

  const checkScript = read('scripts/check-scheduler-account-scope-live.ts');
  for (const marker of [
    'export type SchedulerAccountScopeLiveSnapshot',
    'export function assertSchedulerAccountScopeLiveSnapshot',
    'export async function buildSchedulerAccountScopeLiveSnapshot',
    "path.basename(String(process.argv[1] || ''))",
    'if (isMainModule)',
    'artifacts/scheduler-account-scope-live.json',
    'scheduler-account-scope-live:',
  ]) {
    if (!checkScript.includes(marker)) {
      findings.push(`check-scheduler-account-scope-live.ts: missing Phase 6 marker ${marker}`);
    }
  }

  const proofScript = read('scripts/proof-scheduler-account-scope-live.ts');
  for (const marker of [
    "manual-smoke",
    'artifacts/scheduler-account-scope-live.json',
    'artifacts/scheduler-account-scope-live-proof.json',
    'broker_accounts.user_id IS NOT NULL',
    'scheduler-account-scope-live-proof:',
  ]) {
    if (!proofScript.includes(marker)) {
      findings.push(`proof-scheduler-account-scope-live.ts: missing Phase 6 marker ${marker}`);
    }
  }

  assert.equal(
    findings.length,
    0,
    `Scheduler account-scope Phase 6 guard failed:\n${findings.join('\n')}`
  );
  console.log('Scheduler account-scope Phase 6 guard passed.');
}

run();
