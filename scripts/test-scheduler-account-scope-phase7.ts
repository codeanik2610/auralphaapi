import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

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

async function runSignoffChecks(): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'scheduler-account-scope-phase7-'));
  const gateFile = path.join(tempDir, 'scheduler-account-scope-release-gate.json');
  const proofFile = path.join(tempDir, 'scheduler-account-scope-live-proof.json');
  const outputFile = path.join(tempDir, 'scheduler-account-scope-signoff.json');

  const gateSummary = {
    decision: 'ready',
    startedAt: '2026-04-11T00:00:00.000Z',
    finishedAt: '2026-04-11T00:05:00.000Z',
    liveProofEnabled: true,
    proofFile,
    proofSummary: {
      decision: 'ready',
      contract: 'broker_accounts.user_id IS NOT NULL',
      activeUserOwned: 4,
      activeSystemOwned: 2,
    },
    totals: {
      total: 6,
      passed: 6,
      failed: 0,
      skipped: 0,
    },
    results: [
      'backend-scheduler-account-scope-phase3',
      'backend-scheduler-account-scope-phase5',
      'backend-scheduler-account-scope-phase6',
      'backend-scheduler-account-scope-phase7',
      'backend-scheduler-account-scope-operational-audit',
      'backend-scheduler-account-scope-live-proof',
    ].map((key) => ({
      key,
      label: key,
      status: 'passed',
    })),
  };
  const proofSummary = {
    decision: 'ready',
    contract: 'broker_accounts.user_id IS NOT NULL',
    activeUserOwned: 4,
    activeSystemOwned: 2,
  };

  await writeFile(gateFile, `${JSON.stringify(gateSummary, null, 2)}\n`, 'utf8');
  await writeFile(proofFile, `${JSON.stringify(proofSummary, null, 2)}\n`, 'utf8');

  const exitCode = await runCommand(
    process.execPath,
    ['--import', 'tsx', 'scripts/signoff-scheduler-account-scope.ts'],
    {
      ...process.env,
      SCHEDULER_ACCOUNT_SCOPE_SIGNOFF_GATE_FILE: gateFile,
      SCHEDULER_ACCOUNT_SCOPE_SIGNOFF_PROOF_FILE: proofFile,
      SCHEDULER_ACCOUNT_SCOPE_SIGNOFF_OUTPUT_FILE: outputFile,
      SCHEDULER_ACCOUNT_SCOPE_SIGNOFF_REQUIRE_LIVE_PROOF: 'true',
      SCHEDULER_ACCOUNT_SCOPE_SIGNOFF_OWNERSHIP_SPLIT_VERIFIED: 'true',
      SCHEDULER_ACCOUNT_SCOPE_SIGNOFF_ORDERS_DIAGNOSTICS_VERIFIED: 'true',
      SCHEDULER_ACCOUNT_SCOPE_SIGNOFF_POSITIONS_DIAGNOSTICS_VERIFIED: 'true',
      SCHEDULER_ACCOUNT_SCOPE_SIGNOFF_FUNDS_OWNERLESS_EXCLUSION_VERIFIED: 'true',
      SCHEDULER_ACCOUNT_SCOPE_SIGNOFF_PLACEHOLDER_EVIDENCE_ACKNOWLEDGED: 'true',
      SCHEDULER_ACCOUNT_SCOPE_SIGNOFF_APPROVER: 'codex-phase7',
    }
  );

  assert.equal(
    exitCode,
    0,
    'scheduler account-scope signoff should succeed against a ready Phase 7 gate'
  );

  const rawOutput = await readFile(outputFile, 'utf8');
  const summary = JSON.parse(rawOutput) as {
    decision: string;
    approver: string;
    checks: Record<string, boolean>;
    readiness: Record<string, boolean>;
  };

  assert.equal(summary.decision, 'ready');
  assert.equal(summary.approver, 'codex-phase7');
  assert.equal(summary.checks.liveProofReviewed, true);
  assert.equal(summary.checks.fundsOwnerlessExclusionVerified, true);
  assert.equal(summary.readiness.productionPromotionReady, true);
}

async function runSourceMarkerAssertions(): Promise<void> {
  const releaseGateSource = await readFile(
    path.join(process.cwd(), 'scripts', 'release-gate-scheduler-account-scope.ts'),
    'utf8'
  );
  const signoffSource = await readFile(
    path.join(process.cwd(), 'scripts', 'signoff-scheduler-account-scope.ts'),
    'utf8'
  );
  const auditSource = await readFile(
    path.join(process.cwd(), 'scripts', 'test-operational-audit.ts'),
    'utf8'
  );
  const packageSource = await readFile(path.join(process.cwd(), 'package.json'), 'utf8');
  const phaseDoc = await readFile(
    path.join(process.cwd(), 'SCHEDULER_ACCOUNT_SCOPE_PHASE7.md'),
    'utf8'
  );
  const previousPhaseDoc = await readFile(
    path.join(process.cwd(), 'SCHEDULER_ACCOUNT_SCOPE_PHASE6.md'),
    'utf8'
  );
  const readmeSource = await readFile(path.join(process.cwd(), 'README.md'), 'utf8');

  assert.equal(
    releaseGateSource.includes('backend-scheduler-account-scope-phase7'),
    true,
    'scheduler account-scope release gate must include the Phase 7 suite'
  );
  assert.equal(
    releaseGateSource.includes('SCHEDULER_ACCOUNT_SCOPE_RUN_LIVE_PROOF'),
    true,
    'scheduler account-scope release gate must support optional live proof'
  );
  assert.equal(
    releaseGateSource.includes('backend-scheduler-account-scope-live-proof'),
    true,
    'scheduler account-scope release gate must expose a live proof check key'
  );
  assert.equal(
    signoffSource.includes('SCHEDULER_ACCOUNT_SCOPE_SIGNOFF_REQUIRE_LIVE_PROOF'),
    true,
    'scheduler account-scope signoff must support optional live proof enforcement'
  );
  assert.equal(
    signoffSource.includes('SCHEDULER_ACCOUNT_SCOPE_SIGNOFF_OWNERSHIP_SPLIT_VERIFIED'),
    true,
    'scheduler account-scope signoff must require ownership split verification'
  );
  assert.equal(
    signoffSource.includes('SCHEDULER_ACCOUNT_SCOPE_SIGNOFF_FUNDS_OWNERLESS_EXCLUSION_VERIFIED'),
    true,
    'scheduler account-scope signoff must require funds ownerless exclusion verification'
  );
  assert.equal(
    auditSource.includes('"signoff:scheduler-account-scope"'),
    true,
    'operational audit must treat scheduler account-scope signoff as a required workflow surface'
  );
  assert.equal(
    packageSource.includes('"test:scheduler-account-scope-phase7"'),
    true,
    'package.json must include the Phase 7 scheduler account-scope suite'
  );
  assert.equal(
    packageSource.includes('"release-gate:scheduler-account-scope"'),
    true,
    'package.json must include scheduler account-scope release gate'
  );
  assert.equal(
    packageSource.includes('"signoff:scheduler-account-scope"'),
    true,
    'package.json must include scheduler account-scope signoff'
  );
  assert.equal(
    packageSource.includes('npm run test:scheduler-account-scope-phase7'),
    true,
    'test:all must run the Phase 7 scheduler account-scope guard'
  );
  assert.equal(
    phaseDoc.includes('Phase 7 turns scheduler account-scope into a release-ready workflow'),
    true,
    'SCHEDULER_ACCOUNT_SCOPE_PHASE7.md must document the Phase 7 release workflow'
  );
  assert.equal(
    phaseDoc.includes('## 4) Carry-Forward For Phase 8'),
    true,
    'SCHEDULER_ACCOUNT_SCOPE_PHASE7.md must include the Phase 8 handoff checklist'
  );
  assert.equal(
    previousPhaseDoc.includes('SCHEDULER_ACCOUNT_SCOPE_PHASE7.md'),
    true,
    'SCHEDULER_ACCOUNT_SCOPE_PHASE6.md must point forward to the Phase 7 handoff'
  );
  assert.equal(
    readmeSource.includes('SCHEDULER_ACCOUNT_SCOPE_PHASE7.md'),
    true,
    'README.md must reference the scheduler account-scope Phase 7 workflow'
  );
}

async function run(): Promise<void> {
  await runSignoffChecks();
  await runSourceMarkerAssertions();
  console.log('Scheduler account-scope Phase 7 guard passed.');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
