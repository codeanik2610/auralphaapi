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

async function runOrdersLiveProofAssertions(): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'orders-live-proof-'));
  const gateFile = path.join(tempDir, 'orders-release-gate.json');
  const signoffFile = path.join(tempDir, 'orders-signoff.json');
  const proofFile = path.join(tempDir, 'orders-live-proof.json');
  const gateScript = path.join(tempDir, 'release-gate.stub.ts');
  const signoffScript = path.join(tempDir, 'signoff.stub.ts');

  const readyGateSummary = {
    decision: 'ready',
    generatedAt: '2026-04-10T12:00:00.000Z',
    liveChecksEnabled: true,
    totals: {
      total: 7,
      passed: 7,
      failed: 0,
      skipped: 0,
    },
    results: [
      'backend-orders-suite',
      'backend-orders-controllers',
      'backend-orders-eslint',
      'frontend-orders-eslint',
      'frontend-orders-ui',
      'frontend-orders-e2e',
      'backend-orders-live-health',
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
      externalDashboardsVerified: true,
      writeReadConsistencyVerified: true,
      snapshotLagRunbookVerified: true,
      operatorFlowsVerified: true,
      syncStatusVerified: true,
      manualRefreshVerified: true,
    },
    evidence: {
      stagingWorkflowUrl: 'https://example.com/staging/orders',
      dashboardUrl: 'https://example.com/dashboard/orders',
      runbookUrl: 'https://example.com/runbooks/orders',
      releaseNoteUrl: 'https://example.com/releases/orders',
    },
  };

  await writeFile(
    gateScript,
    `import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const outputFile = path.resolve(process.cwd(), String(process.env.ORDERS_RELEASE_GATE_OUTPUT_FILE || '').trim());

async function run(): Promise<void> {
  assert.equal(process.env.ORDERS_RUN_LIVE_CHECKS, 'true');
  assert.ok(outputFile, 'ORDERS_RELEASE_GATE_OUTPUT_FILE must be provided');
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

const gateFile = path.resolve(process.cwd(), String(process.env.ORDERS_SIGNOFF_GATE_FILE || '').trim());
const outputFile = path.resolve(process.cwd(), String(process.env.ORDERS_SIGNOFF_OUTPUT_FILE || '').trim());

async function run(): Promise<void> {
  assert.equal(process.env.ORDERS_SIGNOFF_REQUIRE_LIVE_HEALTH, 'true');
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
    ['--import', 'tsx', 'scripts/proofs/proof-orders-live.ts'],
    {
      ...process.env,
      ORDERS_PROOF_RELEASE_GATE_SCRIPT: gateScript,
      ORDERS_PROOF_SIGNOFF_SCRIPT: signoffScript,
      ORDERS_RELEASE_GATE_OUTPUT_FILE: gateFile,
      ORDERS_SIGNOFF_OUTPUT_FILE: signoffFile,
      ORDERS_PROOF_OUTPUT_FILE: proofFile,
      ORDERS_SIGNOFF_APPROVER: 'codex-phase8',
      ORDERS_SIGNOFF_EXTERNAL_DASHBOARDS_VERIFIED: 'true',
      ORDERS_SIGNOFF_WRITE_READ_CONSISTENCY_VERIFIED: 'true',
      ORDERS_SIGNOFF_SNAPSHOT_LAG_RUNBOOK_VERIFIED: 'true',
      ORDERS_SIGNOFF_OPERATOR_FLOWS_VERIFIED: 'true',
      ORDERS_SIGNOFF_SYNC_STATUS_VERIFIED: 'true',
      ORDERS_SIGNOFF_MANUAL_REFRESH_VERIFIED: 'true',
    }
  );

  assert.equal(exitCode, 0, 'orders live proof should succeed against ready stub scripts');

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
  assert.equal(checks.syncStatusVerified, true);
  assert.equal(checks.manualRefreshVerified, true);
}

async function runSourceMarkerAssertions(): Promise<void> {
  const releaseGateSource = await readFile(
    path.join(process.cwd(), 'scripts', 'release-gates', 'release-gate-orders.ts'),
    'utf8'
  );
  const packageSource = await readFile(path.join(process.cwd(), 'package.json'), 'utf8');
  const operationalAuditSource = await readFile(
    path.join(process.cwd(), 'scripts', 'test-operational-audit.ts'),
    'utf8'
  );

  assert.equal(
    releaseGateSource.includes('scripts/proofs/proof-orders-live.ts'),
    true,
    'release gate lint coverage must include the orders live proof script'
  );
  assert.equal(
    packageSource.includes('"test:orders-live-proof"'),
    true,
    'package.json must include "test:orders-live-proof" for the Orders live proof workflow'
  );
  assert.equal(
    packageSource.includes('"proof:orders-live"'),
    true,
    'package.json must include "proof:orders-live" for the Orders live proof workflow'
  );

  for (const marker of [
    '"check:orders-health"',
    '"release-gate:orders"',
    '"signoff:orders"',
    '"proof:orders-live"',
  ]) {
    assert.equal(
      operationalAuditSource.includes(marker),
      true,
      `test-operational-audit.ts must guard ${marker} for the Orders workflow`
    );
  }
}

async function main(): Promise<void> {
  await runOrdersLiveProofAssertions();
  await runSourceMarkerAssertions();
  console.log('Orders live proof assertions passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
