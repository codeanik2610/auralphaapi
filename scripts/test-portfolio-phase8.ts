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

async function runPortfolioLiveProofAssertions(): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'portfolio-phase8-'));
  const gateFile = path.join(tempDir, 'portfolio-release-gate.json');
  const signoffFile = path.join(tempDir, 'portfolio-signoff.json');
  const proofFile = path.join(tempDir, 'portfolio-live-proof.json');
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
      'backend-portfolio-phase1',
      'backend-portfolio-phase2',
      'backend-portfolio-phase3',
      'backend-portfolio-phase4',
      'backend-portfolio-phase5',
      'backend-portfolio-phase6',
      'backend-portfolio-phase7',
      'backend-portfolio-phase8',
      'backend-portfolio-eslint',
      'frontend-portfolio-eslint',
      'frontend-portfolio-ui',
      'frontend-portfolio-build',
      'backend-portfolio-live-health',
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
      manualReviewWorkflowVerified: true,
      reportExportVerified: true,
      shareableWorkspaceVerified: true,
      reconciliationRunbookVerified: true,
    },
    evidence: {
      stagingWorkflowUrl: 'https://example.com/staging/portfolio',
      dashboardUrl: 'https://example.com/dashboard/portfolio',
      runbookUrl: 'https://example.com/runbooks/portfolio',
      releaseNoteUrl: 'https://example.com/releases/portfolio',
    },
  };

  await writeFile(
    gateScript,
    `import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const outputFile = path.resolve(process.cwd(), String(process.env.PORTFOLIO_RELEASE_GATE_OUTPUT_FILE || '').trim());

async function run(): Promise<void> {
  assert.equal(process.env.PORTFOLIO_RUN_LIVE_CHECKS, 'true');
  assert.ok(outputFile, 'PORTFOLIO_RELEASE_GATE_OUTPUT_FILE must be provided');
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

const gateFile = path.resolve(process.cwd(), String(process.env.PORTFOLIO_SIGNOFF_GATE_FILE || '').trim());
const outputFile = path.resolve(process.cwd(), String(process.env.PORTFOLIO_SIGNOFF_OUTPUT_FILE || '').trim());

async function run(): Promise<void> {
  assert.equal(process.env.PORTFOLIO_SIGNOFF_REQUIRE_LIVE_HEALTH, 'true');
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
    ['--import', 'tsx', 'scripts/proof-portfolio-live.ts'],
    {
      ...process.env,
      PORTFOLIO_PROOF_RELEASE_GATE_SCRIPT: gateScript,
      PORTFOLIO_PROOF_SIGNOFF_SCRIPT: signoffScript,
      PORTFOLIO_RELEASE_GATE_OUTPUT_FILE: gateFile,
      PORTFOLIO_SIGNOFF_OUTPUT_FILE: signoffFile,
      PORTFOLIO_PROOF_OUTPUT_FILE: proofFile,
      PORTFOLIO_SIGNOFF_APPROVER: 'codex-phase8',
      PORTFOLIO_SIGNOFF_MANUAL_REVIEW_WORKFLOW_VERIFIED: 'true',
      PORTFOLIO_SIGNOFF_REPORT_EXPORT_VERIFIED: 'true',
      PORTFOLIO_SIGNOFF_SHAREABLE_WORKSPACE_VERIFIED: 'true',
      PORTFOLIO_SIGNOFF_RECONCILIATION_RUNBOOK_VERIFIED: 'true',
    }
  );

  assert.equal(exitCode, 0, 'portfolio live proof should succeed against ready stub scripts');

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
  assert.deepEqual(summary.gateTotals, readyGateSummary.totals);

  const evidence = (summary.evidence || {}) as JsonRecord;
  assert.equal(evidence.runbookUrl, readySignoffSummary.evidence.runbookUrl);

  const checks = (summary.checks || {}) as JsonRecord;
  assert.equal(checks.liveHealthReviewed, true);
  assert.equal(checks.shareableWorkspaceVerified, true);
}

async function runSourceMarkerAssertions(): Promise<void> {
  const releaseGateSource = await readFile(
    path.join(process.cwd(), 'scripts', 'release-gate-portfolio.ts'),
    'utf8'
  );
  const signoffSource = await readFile(
    path.join(process.cwd(), 'scripts', 'signoff-portfolio.ts'),
    'utf8'
  );

  assert.equal(
    releaseGateSource.includes('backend-portfolio-phase8'),
    true,
    'release gate must include the Phase 8 portfolio suite'
  );
  assert.equal(
    signoffSource.includes('backend-portfolio-phase8'),
    true,
    'portfolio signoff must require the Phase 8 gate result'
  );
}

async function main(): Promise<void> {
  await runPortfolioLiveProofAssertions();
  await runSourceMarkerAssertions();
  console.log('Portfolio Phase 8 assertions passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
