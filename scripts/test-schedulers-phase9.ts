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

async function runOrdersSchedulerLiveProofAssertions(): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'orders-scheduler-phase9-'));
  const gateFile = path.join(tempDir, 'orders-scheduler-release-gate.json');
  const signoffFile = path.join(tempDir, 'orders-scheduler-signoff.json');
  const proofFile = path.join(tempDir, 'orders-scheduler-live-proof.json');
  const gateScript = path.join(tempDir, 'release-gate.stub.ts');
  const signoffScript = path.join(tempDir, 'signoff.stub.ts');

  const readyGateSummary = {
    decision: 'ready',
    generatedAt: '2026-04-10T12:00:00.000Z',
    liveChecksEnabled: true,
    totals: {
      total: 13,
      passed: 13,
      failed: 0,
      skipped: 0,
    },
    results: [
      'backend-orders-scheduler-phase2',
      'backend-orders-scheduler-phase3',
      'backend-orders-scheduler-phase4',
      'backend-orders-scheduler-phase5',
      'backend-orders-scheduler-phase7',
      'backend-orders-scheduler-phase8',
      'backend-orders-scheduler-phase9',
      'backend-orders-scheduler-controllers',
      'backend-orders-scheduler-eslint',
      'frontend-orders-scheduler-eslint',
      'frontend-orders-scheduler-ui',
      'frontend-orders-scheduler-e2e',
      'backend-orders-scheduler-live-health',
    ].map((key) => ({
      key,
      label: key,
      status: 'passed',
    })),
  };

  const readySignoffSummary = {
    decision: 'ready',
    generatedAt: '2026-04-10T12:05:00.000Z',
    approver: 'codex-phase9',
    checks: {
      gateReady: true,
      requiredSuitesPassed: true,
      liveHealthReviewed: true,
      operatorWalkthroughVerified: true,
      runbookReviewVerified: true,
      runtimeFoundationVerified: true,
      accessReviewVerified: true,
    },
    evidence: {
      stagingWorkflowUrl: 'https://example.com/staging/orders-scheduler',
      dashboardUrl: 'https://example.com/dashboard/orders-scheduler',
      runbookUrl: 'https://example.com/runbooks/orders-scheduler',
      releaseNoteUrl: 'https://example.com/releases/orders-scheduler',
      operatorWalkthroughUrl: 'https://example.com/walkthroughs/orders-scheduler',
    },
  };

  await writeFile(
    gateScript,
    `import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const outputFile = path.resolve(process.cwd(), String(process.env.ORDERS_SCHEDULER_RELEASE_GATE_OUTPUT_FILE || '').trim());

async function run(): Promise<void> {
  assert.equal(process.env.ORDERS_SCHEDULER_RUN_LIVE_CHECKS, 'true');
  assert.ok(outputFile, 'ORDERS_SCHEDULER_RELEASE_GATE_OUTPUT_FILE must be provided');
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

const gateFile = path.resolve(process.cwd(), String(process.env.ORDERS_SCHEDULER_SIGNOFF_GATE_FILE || '').trim());
const outputFile = path.resolve(process.cwd(), String(process.env.ORDERS_SCHEDULER_SIGNOFF_OUTPUT_FILE || '').trim());

async function run(): Promise<void> {
  assert.equal(process.env.ORDERS_SCHEDULER_SIGNOFF_REQUIRE_LIVE_HEALTH, 'true');
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
    ['--import', 'tsx', 'scripts/proof-orders-scheduler-live.ts'],
    {
      ...process.env,
      ORDERS_SCHEDULER_PROOF_RELEASE_GATE_SCRIPT: gateScript,
      ORDERS_SCHEDULER_PROOF_SIGNOFF_SCRIPT: signoffScript,
      ORDERS_SCHEDULER_RELEASE_GATE_OUTPUT_FILE: gateFile,
      ORDERS_SCHEDULER_SIGNOFF_OUTPUT_FILE: signoffFile,
      ORDERS_SCHEDULER_PROOF_OUTPUT_FILE: proofFile,
      ORDERS_SCHEDULER_SIGNOFF_APPROVER: 'codex-phase9',
      ORDERS_SCHEDULER_SIGNOFF_OPERATOR_WALKTHROUGH_VERIFIED: 'true',
      ORDERS_SCHEDULER_SIGNOFF_RUNBOOK_REVIEW_VERIFIED: 'true',
      ORDERS_SCHEDULER_SIGNOFF_RUNTIME_FOUNDATION_VERIFIED: 'true',
      ORDERS_SCHEDULER_SIGNOFF_ACCESS_REVIEW_VERIFIED: 'true',
    }
  );

  assert.equal(
    exitCode,
    0,
    'orders scheduler live proof should succeed against ready stub scripts'
  );

  const rawProof = await readFile(proofFile, 'utf8');
  const summary = JSON.parse(rawProof) as JsonRecord;

  assert.equal(summary.decision, 'ready');
  assert.equal(summary.approver, 'codex-phase9');
  assert.equal(summary.gateDecision, 'ready');
  assert.equal(summary.signoffDecision, 'ready');
  assert.equal(summary.liveChecksEnabled, true);
  assert.equal(summary.releaseGateFile, path.resolve(process.cwd(), gateFile));
  assert.equal(summary.signoffFile, path.resolve(process.cwd(), signoffFile));
  assert.equal(summary.proofOutputFile, path.resolve(process.cwd(), proofFile));
  assert.deepEqual(summary.gateTotals, readyGateSummary.totals);

  const evidence = (summary.evidence || {}) as JsonRecord;
  assert.equal(evidence.runbookUrl, readySignoffSummary.evidence.runbookUrl);

  const checks = (summary.checks || {}) as JsonRecord;
  assert.equal(checks.liveHealthReviewed, true);
  assert.equal(checks.runtimeFoundationVerified, true);
}

async function runSourceMarkerAssertions(): Promise<void> {
  const releaseGateSource = await readFile(
    path.join(process.cwd(), 'scripts', 'release-gate-orders-scheduler.ts'),
    'utf8'
  );
  const signoffSource = await readFile(
    path.join(process.cwd(), 'scripts', 'signoff-orders-scheduler.ts'),
    'utf8'
  );
  const packageSource = await readFile(path.join(process.cwd(), 'package.json'), 'utf8');
  const operationalAuditSource = await readFile(
    path.join(process.cwd(), 'scripts', 'test-operational-audit.ts'),
    'utf8'
  );

  assert.equal(
    releaseGateSource.includes('backend-orders-scheduler-phase9'),
    true,
    'release gate must include the Phase 9 orders scheduler suite'
  );
  assert.equal(
    releaseGateSource.includes('scripts/proof-orders-scheduler-live.ts'),
    true,
    'release gate lint coverage must include the orders scheduler proof script'
  );
  assert.equal(
    signoffSource.includes('backend-orders-scheduler-phase9'),
    true,
    'orders scheduler signoff must require the Phase 9 gate result'
  );
  assert.equal(
    packageSource.includes('"test:schedulers-phase9"'),
    true,
    'package.json must include "test:schedulers-phase9" for the orders scheduler Phase 9 workflow'
  );

  for (const marker of [
    '"proof:orders-scheduler-live"',
    '"check:orders-scheduler-health"',
    '"release-gate:orders-scheduler"',
    '"signoff:orders-scheduler"',
  ]) {
    assert.equal(
      packageSource.includes(marker),
      true,
      `package.json must include ${marker} for the orders scheduler Phase 9 workflow`
    );
    assert.equal(
      operationalAuditSource.includes(marker),
      true,
      `test-operational-audit.ts must guard ${marker} for the orders scheduler workflow`
    );
  }
}

async function main(): Promise<void> {
  await runOrdersSchedulerLiveProofAssertions();
  await runSourceMarkerAssertions();
  console.log('Schedulers Phase 9 assertions passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
