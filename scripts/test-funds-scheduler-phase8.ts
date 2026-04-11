import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

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

async function runFundsSchedulerLiveProofAssertions(): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'funds-scheduler-phase8-'));
  const gateFile = path.join(tempDir, 'funds-release-gate.json');
  const signoffFile = path.join(tempDir, 'funds-signoff.json');
  const proofFile = path.join(tempDir, 'funds-live-proof.json');
  const evidenceFile = path.join(tempDir, 'funds-deployment-evidence.json');
  const gateScript = path.join(tempDir, 'release-gate.stub.ts');
  const signoffScript = path.join(tempDir, 'signoff.stub.ts');

  const readyGateSummary = {
    decision: 'ready',
    generatedAt: '2026-04-10T12:00:00.000Z',
    liveChecksEnabled: true,
    totals: {
      total: 15,
      passed: 15,
      failed: 0,
      skipped: 0,
    },
    results: [
      'backend-funds-scheduler-phase1',
      'backend-funds-scheduler-phase2',
      'backend-funds-scheduler-phase3',
      'backend-funds-scheduler-phase4',
      'backend-funds-scheduler-phase6',
      'backend-funds-scheduler-phase7',
      'backend-funds-scheduler-phase8',
      'backend-funds-scheduler-phase10',
      'backend-controllers',
      'backend-operational-audit',
      'backend-funds-scheduler-eslint',
      'frontend-schedulers-funds-ui',
      'frontend-schedulers-funds-eslint',
      'backend-funds-scheduler-health',
      'backend-portfolio-health',
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
      liveHealthReviewed: true,
      diagnosticsVerified: true,
      coverageVerified: true,
      productTrustVerified: true,
      healthThresholdsVerified: true,
      recoveryDrillVerified: true,
      accessReviewVerified: true,
    },
    evidence: {
      workflowUrl: 'https://example.com/staging/funds-scheduler',
      dashboardUrl: 'https://example.com/dashboard/funds-scheduler',
      runbookUrl: 'https://example.com/runbooks/funds-scheduler',
      releaseNoteUrl: 'https://example.com/releases/funds-scheduler',
    },
  };

  await writeFile(
    gateScript,
    `import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const outputFile = path.resolve(process.cwd(), String(process.env.FUNDS_SCHEDULER_RELEASE_GATE_OUTPUT_FILE || '').trim());

async function run(): Promise<void> {
  assert.equal(process.env.FUNDS_SCHEDULER_RUN_LIVE_CHECKS, 'true');
  assert.ok(outputFile, 'FUNDS_SCHEDULER_RELEASE_GATE_OUTPUT_FILE must be provided');
  await mkdir(path.dirname(outputFile), { recursive: true });
  const summary = ${JSON.stringify(readyGateSummary, null, 2)};
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

const gateFile = path.resolve(process.cwd(), String(process.env.FUNDS_SCHEDULER_SIGNOFF_GATE_FILE || '').trim());
const outputFile = path.resolve(process.cwd(), String(process.env.FUNDS_SCHEDULER_SIGNOFF_OUTPUT_FILE || '').trim());

async function run(): Promise<void> {
  assert.equal(process.env.FUNDS_SCHEDULER_SIGNOFF_REQUIRE_LIVE_HEALTH, 'true');
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
    ['--import', 'tsx', 'scripts/proof-funds-scheduler-live.ts'],
    {
      ...process.env,
      FUNDS_SCHEDULER_PROOF_RELEASE_GATE_SCRIPT: gateScript,
      FUNDS_SCHEDULER_PROOF_SIGNOFF_SCRIPT: signoffScript,
      FUNDS_SCHEDULER_RELEASE_GATE_OUTPUT_FILE: gateFile,
      FUNDS_SCHEDULER_SIGNOFF_OUTPUT_FILE: signoffFile,
      FUNDS_SCHEDULER_PROOF_OUTPUT_FILE: proofFile,
      FUNDS_SCHEDULER_EVIDENCE_OUTPUT_FILE: evidenceFile,
      FUNDS_SCHEDULER_SIGNOFF_APPROVER: 'codex-phase8',
      FUNDS_SCHEDULER_SIGNOFF_DIAGNOSTICS_VERIFIED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_COVERAGE_VERIFIED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_PRODUCT_TRUST_VERIFIED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_HEALTH_THRESHOLDS_VERIFIED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_RECOVERY_DRILL_VERIFIED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_ACCESS_REVIEW_VERIFIED: 'true',
    }
  );

  assert.equal(
    exitCode,
    0,
    'funds scheduler live proof should succeed against ready stub scripts'
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
  assert.equal(summary.proofOutputFile, path.resolve(process.cwd(), proofFile));
  assert.equal(summary.deploymentEvidenceOutputFile, path.resolve(process.cwd(), evidenceFile));
  assert.deepEqual(summary.gateTotals, readyGateSummary.totals);

  const evidence = (summary.evidence || {}) as JsonRecord;
  assert.equal(evidence.runbookUrl, readySignoffSummary.evidence.runbookUrl);

  const checks = (summary.checks || {}) as JsonRecord;
  assert.equal(checks.liveHealthReviewed, true);
  assert.equal(checks.recoveryDrillVerified, true);
}

async function runSourceMarkerAssertions(): Promise<void> {
  const releaseGateSource = await readFile(
    path.join(process.cwd(), 'scripts', 'release-gate-funds-scheduler.ts'),
    'utf8'
  );
  const signoffSource = await readFile(
    path.join(process.cwd(), 'scripts', 'signoff-funds-scheduler.ts'),
    'utf8'
  );
  const operationalAuditSource = await readFile(
    path.join(process.cwd(), 'scripts', 'test-operational-audit.ts'),
    'utf8'
  );
  const packageSource = await readFile(path.join(process.cwd(), 'package.json'), 'utf8');
  const phaseDoc = await readFile(
    path.join(process.cwd(), 'FUNDS_SCHEDULER_PHASE8.md'),
    'utf8'
  );
  const readmeSource = await readFile(path.join(process.cwd(), 'README.md'), 'utf8');

  assert.equal(
    releaseGateSource.includes('backend-funds-scheduler-phase8'),
    true,
    'release gate must include the Phase 8 funds scheduler suite'
  );
  assert.equal(
    signoffSource.includes('backend-funds-scheduler-phase8'),
    true,
    'funds scheduler signoff must require the Phase 8 gate result'
  );
  assert.equal(
    operationalAuditSource.includes('"proof:funds-scheduler-live"'),
    true,
    'operational audit must treat the funds scheduler proof workflow as required'
  );
  assert.equal(
    packageSource.includes('"proof:funds-scheduler-live"'),
    true,
    'package.json must include the Phase 8 funds scheduler proof script'
  );
  assert.equal(
    phaseDoc.includes('## 4) Carry-Forward For Phase 9'),
    true,
    'FUNDS_SCHEDULER_PHASE8.md must include the Phase 9 handoff checklist'
  );
  assert.equal(
    readmeSource.includes('proof:funds-scheduler-live'),
    true,
    'README.md must reference the funds scheduler live proof workflow'
  );
}

async function main(): Promise<void> {
  await runFundsSchedulerLiveProofAssertions();
  await runSourceMarkerAssertions();
  console.log('Funds scheduler phase 8 assertions passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
