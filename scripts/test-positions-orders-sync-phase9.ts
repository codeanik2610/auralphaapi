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

async function runPositionsSchedulerLiveProofAssertions(): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'positions-orders-phase9-positions-'));
  const gateFile = path.join(tempDir, 'positions-scheduler-release-gate.json');
  const signoffFile = path.join(tempDir, 'positions-scheduler-signoff.json');
  const proofFile = path.join(tempDir, 'positions-scheduler-live-proof.json');
  const gateScript = path.join(tempDir, 'release-gate.stub.ts');
  const signoffScript = path.join(tempDir, 'signoff.stub.ts');

  const readyGateSummary = {
    decision: 'ready',
    generatedAt: '2026-04-10T12:00:00.000Z',
    liveChecksEnabled: true,
    totals: {
      total: 12,
      passed: 12,
      failed: 0,
      skipped: 0,
    },
    results: [
      'backend-positions-scheduler-phase1',
      'backend-positions-scheduler-phase2',
      'backend-positions-scheduler-phase3',
      'backend-positions-scheduler-phase4',
      'backend-positions-scheduler-phase5',
      'backend-positions-scheduler-phase6',
      'backend-positions-scheduler-phase7',
      'backend-positions-scheduler-phase8',
      'backend-positions-scheduler-operational-audit',
      'backend-positions-scheduler-eslint',
      'backend-positions-health',
      'backend-positions-scheduler-health',
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
      diagnosticsVerified: true,
      productTrustVerified: true,
      rebuildDrillVerified: true,
      recoveryHistoryVerified: true,
      accessReviewVerified: true,
    },
    evidence: {
      workflowUrl: 'https://example.com/workflows/positions-scheduler',
      dashboardUrl: 'https://example.com/dashboards/positions-scheduler',
      runbookUrl: 'https://example.com/runbooks/positions-scheduler',
      releaseNoteUrl: 'https://example.com/releases/positions-scheduler',
      recoveryEvidenceUrl: 'https://example.com/evidence/positions-recovery',
    },
  };

  await writeFile(
    gateScript,
    `import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const outputFile = path.resolve(process.cwd(), String(process.env.POSITIONS_SCHEDULER_RELEASE_GATE_OUTPUT_FILE || '').trim());

async function run(): Promise<void> {
  assert.equal(process.env.POSITIONS_SCHEDULER_RUN_LIVE_CHECKS, 'true');
  assert.ok(outputFile, 'POSITIONS_SCHEDULER_RELEASE_GATE_OUTPUT_FILE must be provided');
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

const gateFile = path.resolve(process.cwd(), String(process.env.POSITIONS_SCHEDULER_SIGNOFF_GATE_FILE || '').trim());
const outputFile = path.resolve(process.cwd(), String(process.env.POSITIONS_SCHEDULER_SIGNOFF_OUTPUT_FILE || '').trim());

async function run(): Promise<void> {
  assert.equal(process.env.POSITIONS_SCHEDULER_SIGNOFF_REQUIRE_LIVE_HEALTH, 'true');
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
    ['--import', 'tsx', 'scripts/proof-positions-scheduler-live.ts'],
    {
      ...process.env,
      POSITIONS_SCHEDULER_PROOF_RELEASE_GATE_SCRIPT: gateScript,
      POSITIONS_SCHEDULER_PROOF_SIGNOFF_SCRIPT: signoffScript,
      POSITIONS_SCHEDULER_RELEASE_GATE_OUTPUT_FILE: gateFile,
      POSITIONS_SCHEDULER_SIGNOFF_OUTPUT_FILE: signoffFile,
      POSITIONS_SCHEDULER_PROOF_OUTPUT_FILE: proofFile,
      POSITIONS_SCHEDULER_SIGNOFF_APPROVER: 'codex-phase9',
      POSITIONS_SCHEDULER_SIGNOFF_DIAGNOSTICS_VERIFIED: 'true',
      POSITIONS_SCHEDULER_SIGNOFF_PRODUCT_TRUST_VERIFIED: 'true',
      POSITIONS_SCHEDULER_SIGNOFF_REBUILD_DRILL_VERIFIED: 'true',
      POSITIONS_SCHEDULER_SIGNOFF_RECOVERY_HISTORY_VERIFIED: 'true',
      POSITIONS_SCHEDULER_SIGNOFF_ACCESS_REVIEW_VERIFIED: 'true',
      POSITIONS_SCHEDULER_SIGNOFF_RECOVERY_EVIDENCE_URL:
        'https://example.com/evidence/positions-recovery',
    }
  );

  assert.equal(exitCode, 0, 'positions scheduler live proof should succeed against ready stub scripts');

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

  const checks = (summary.checks || {}) as JsonRecord;
  assert.equal(checks.liveHealthReviewed, true);
  assert.equal(checks.recoveryHistoryVerified, true);

  const evidence = (summary.evidence || {}) as JsonRecord;
  assert.equal(
    evidence.recoveryEvidenceUrl,
    readySignoffSummary.evidence.recoveryEvidenceUrl
  );
}

async function runOrdersSchedulerLiveProofAssertions(): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'positions-orders-phase9-orders-'));
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

  assert.equal(exitCode, 0, 'orders scheduler live proof should succeed against ready stub scripts');

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

  const checks = (summary.checks || {}) as JsonRecord;
  assert.equal(checks.runtimeFoundationVerified, true);
  assert.equal(checks.liveHealthReviewed, true);
}

async function runSourceMarkerAssertions(): Promise<void> {
  const packageSource = await readFile(path.join(process.cwd(), 'package.json'), 'utf8');
  const readmeSource = await readFile(path.join(process.cwd(), 'README.md'), 'utf8');
  const phase8Doc = await readFile(
    path.join(process.cwd(), 'POSITIONS_ORDERS_SYNC_PHASE8.md'),
    'utf8'
  );
  const phase9Doc = await readFile(
    path.join(process.cwd(), 'POSITIONS_ORDERS_SYNC_PHASE9.md'),
    'utf8'
  );
  const positionsProofSource = await readFile(
    path.join(process.cwd(), 'scripts', 'proof-positions-scheduler-live.ts'),
    'utf8'
  );
  const positionsSignoffSource = await readFile(
    path.join(process.cwd(), 'scripts', 'signoff-positions-scheduler.ts'),
    'utf8'
  );
  const ordersProofSource = await readFile(
    path.join(process.cwd(), 'scripts', 'proof-orders-scheduler-live.ts'),
    'utf8'
  );
  const ordersSignoffSource = await readFile(
    path.join(process.cwd(), 'scripts', 'signoff-orders-scheduler.ts'),
    'utf8'
  );
  const operationalAuditSource = await readFile(
    path.join(process.cwd(), 'scripts', 'test-operational-audit.ts'),
    'utf8'
  );

  assert.equal(
    packageSource.includes('"test:positions-orders-sync-phase9"'),
    true,
    'package.json must expose the positions/orders shared Phase 9 guard'
  );
  assert.equal(
    packageSource.includes('npm run test:positions-orders-sync-phase9'),
    true,
    'test:all must include the Phase 9 positions/orders shared guard'
  );

  for (const marker of [
    '"proof:positions-scheduler-live"',
    '"signoff:positions-scheduler"',
    '"release-gate:positions-scheduler"',
    '"check:positions-scheduler-health"',
    '"proof:orders-scheduler-live"',
    '"signoff:orders-scheduler"',
    '"release-gate:orders-scheduler"',
    '"check:orders-scheduler-health"',
  ]) {
    assert.equal(
      packageSource.includes(marker),
      true,
      `package.json must include ${marker} in the shared Phase 9 workflow`
    );
    assert.equal(
      operationalAuditSource.includes(marker),
      true,
      `test-operational-audit.ts must guard ${marker} in the shared Phase 9 workflow`
    );
  }

  assert.equal(
    readmeSource.includes('POSITIONS_ORDERS_SYNC_PHASE9.md'),
    true,
    'README.md must point to the shared Phase 9 positions/orders workflow note'
  );
  assert.equal(
    readmeSource.includes('proof:positions-scheduler-live'),
    true,
    'README.md must mention the positions scheduler proof command in the shared workflow'
  );
  assert.equal(
    readmeSource.includes('proof:orders-scheduler-live'),
    true,
    'README.md must mention the orders scheduler proof command in the shared workflow'
  );
  assert.equal(
    phase8Doc.includes('before Phase 9 proof/signoff work'),
    true,
    'POSITIONS_ORDERS_SYNC_PHASE8.md must keep the Phase 9 handoff note'
  );
  assert.equal(
    phase9Doc.includes('npm run proof:positions-scheduler-live'),
    true,
    'POSITIONS_ORDERS_SYNC_PHASE9.md must document the positions scheduler proof command'
  );
  assert.equal(
    phase9Doc.includes('npm run proof:orders-scheduler-live'),
    true,
    'POSITIONS_ORDERS_SYNC_PHASE9.md must document the orders scheduler proof command'
  );
  assert.equal(
    phase9Doc.includes('proof layer as frozen'),
    true,
    'POSITIONS_ORDERS_SYNC_PHASE9.md must freeze the shared proof posture'
  );
  assert.equal(
    positionsProofSource.includes('POSITIONS_SCHEDULER_SIGNOFF_RECOVERY_EVIDENCE_URL'),
    true,
    'proof-positions-scheduler-live.ts must keep the recovery evidence requirement'
  );
  assert.equal(
    positionsProofSource.includes('liveHealthReviewed'),
    true,
    'proof-positions-scheduler-live.ts must preserve live health review checks'
  );
  assert.equal(
    positionsSignoffSource.includes('recoveryHistoryVerified'),
    true,
    'signoff-positions-scheduler.ts must preserve recovery-history verification'
  );
  assert.equal(
    ordersProofSource.includes('ORDERS_SCHEDULER_SIGNOFF_RUNTIME_FOUNDATION_VERIFIED'),
    true,
    'proof-orders-scheduler-live.ts must keep the runtime foundation verification requirement'
  );
  assert.equal(
    ordersProofSource.includes('liveChecksEnabled'),
    true,
    'proof-orders-scheduler-live.ts must preserve live-check enablement in the summary'
  );
  assert.equal(
    ordersSignoffSource.includes('runtimeFoundationVerified'),
    true,
    'signoff-orders-scheduler.ts must preserve runtime foundation verification'
  );
}

async function main(): Promise<void> {
  await runPositionsSchedulerLiveProofAssertions();
  await runOrdersSchedulerLiveProofAssertions();
  await runSourceMarkerAssertions();
  console.log('Positions/orders sync Phase 9 guard passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
