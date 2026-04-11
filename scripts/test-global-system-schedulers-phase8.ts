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
      total: 16,
      passed: 16,
      failed: 0,
      skipped: 0,
    },
    results: [
      'backend-global-system-schedulers-phase1',
      'backend-global-system-schedulers-phase2',
      'backend-global-system-schedulers-phase3',
      'backend-global-system-schedulers-phase4',
      'backend-global-system-schedulers-phase5',
      'backend-global-system-schedulers-phase6',
      'backend-global-system-schedulers-phase7',
      'backend-global-system-schedulers-phase8',
      'backend-global-system-schedulers-regression',
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
    ['--import', 'tsx', 'scripts/proof-global-system-schedulers-live.ts'],
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
    path.join(process.cwd(), 'scripts', 'check-global-system-schedulers-health.ts'),
    'utf8'
  );
  const releaseGateSource = await readFile(
    path.join(process.cwd(), 'scripts', 'release-gate-global-system-schedulers.ts'),
    'utf8'
  );
  const signoffSource = await readFile(
    path.join(process.cwd(), 'scripts', 'signoff-global-system-schedulers.ts'),
    'utf8'
  );
  const proofSource = await readFile(
    path.join(process.cwd(), 'scripts', 'proof-global-system-schedulers-live.ts'),
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
    releaseGateSource.includes('backend-global-system-schedulers-phase8'),
    true,
    'global system scheduler release gate must include the Phase 8 suite'
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
    packageSource.includes('"test:global-system-schedulers-phase8"'),
    true,
    'package.json must include the Phase 8 global system scheduler suite'
  );
  assert.equal(
    packageSource.includes('"check:global-system-schedulers-health"'),
    true,
    'package.json must include the Phase 8 health script'
  );
  assert.equal(
    packageSource.includes('npm run test:global-system-schedulers-phase8'),
    true,
    'test:all must include the Phase 8 global system scheduler guard'
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

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
