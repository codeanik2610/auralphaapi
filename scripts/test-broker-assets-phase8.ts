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

async function runBrokerAssetsLiveProofAssertions(): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'broker-assets-phase8-'));
  const gateFile = path.join(tempDir, 'broker-assets-release-gate.json');
  const signoffFile = path.join(tempDir, 'broker-assets-signoff.json');
  const healthFile = path.join(tempDir, 'broker-assets-health.json');
  const proofFile = path.join(tempDir, 'broker-assets-live-proof.json');
  const evidenceFile = path.join(tempDir, 'broker-assets-deployment-evidence.json');
  const gateScript = path.join(tempDir, 'release-gate.stub.ts');
  const signoffScript = path.join(tempDir, 'signoff.stub.ts');

  const readyHealthSnapshot = {
    baseUrl: 'http://127.0.0.1:3102/api/v1',
    queueStatus: 'ok',
    queueName: 'scheduler.exchange-assets.execute',
    workerStatus: 'ok',
    workerHttpStatus: 'ok',
    schedulerKey: 'broker-assets-sync',
    schedulerType: 'global',
    schedulerSources: ['mudrex', 'delta_exchange'],
    visibleTotal: 12,
    adminCatalogTotal: 480,
    thresholdProfile: {
      mode: 'bounded',
      configuredThresholdCount: 6,
      requiredThresholdCount: 6,
      configuredKeys: [
        'maxAdminCatalogLatencyMs',
        'maxVisibleLatencyMs',
        'minAdminCatalogResults',
        'minVisibleResults',
        'minVisibleResultsBySource.mudrex',
        'minVisibleResultsBySource.delta_exchange',
      ],
      missingKeys: [],
    },
  };

  const readyGateSummary = {
    decision: 'ready',
    generatedAt: '2026-04-10T12:00:00.000Z',
    liveChecksEnabled: true,
    healthSnapshotFile: path.resolve(process.cwd(), healthFile),
    healthSnapshot: readyHealthSnapshot,
    totals: {
      total: 7,
      passed: 7,
      failed: 0,
      skipped: 0,
    },
    results: [
      'backend-broker-assets-contract',
      'backend-broker-assets-flow',
      'backend-broker-assets-phase6',
      'backend-broker-assets-phase7',
      'backend-broker-assets-phase8',
      'backend-broker-assets-eslint',
      'backend-broker-assets-live-health',
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
      liveProofReviewed: true,
      thresholdPostureCaptured: true,
      globalCatalogVerified: true,
      connectedVisibilityVerified: true,
      deltaLookupVerified: true,
      sourceThresholdsVerified: true,
      identityConstraintsReviewed: true,
      placeholderEvidenceAcknowledged: true,
      unboundedThresholdsAcknowledged: true,
    },
    evidence: {
      stagingWorkflowUrl: 'https://example.com/workflows/broker-assets',
      dashboardUrl: 'https://example.com/dashboards/broker-assets',
      runbookUrl: 'https://example.com/runbooks/broker-assets',
      releaseNoteUrl: 'https://example.com/releases/broker-assets',
    },
    evidenceClassification: {
      stagingWorkflowUrlKind: 'remote_url',
      dashboardUrlKind: 'remote_url',
      runbookUrlKind: 'remote_url',
      releaseNoteUrlKind: 'remote_url',
    },
    environment: {
      requireLiveHealth: true,
      requireLiveProof: false,
      requireDeploymentEvidence: false,
    },
    acknowledgements: {
      placeholderEvidenceUsed: false,
      unboundedThresholdsUsed: false,
    },
    readiness: {
      deploymentEvidenceReady: true,
      thresholdProfileMode: 'bounded',
      liveGateReady: true,
      liveProofReady: false,
      productionPromotionReady: true,
    },
    thresholdProfile: readyHealthSnapshot.thresholdProfile,
  };

  await writeFile(
    gateScript,
    `import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const outputFile = path.resolve(process.cwd(), String(process.env.BROKER_ASSETS_RELEASE_GATE_OUTPUT_FILE || '').trim());
const healthFile = path.resolve(process.cwd(), String(process.env.BROKER_ASSETS_HEALTH_OUTPUT_FILE || '').trim());

async function run(): Promise<void> {
  assert.equal(process.env.BROKER_ASSETS_RUN_LIVE_CHECKS, 'true');
  assert.ok(outputFile, 'BROKER_ASSETS_RELEASE_GATE_OUTPUT_FILE must be provided');
  assert.ok(healthFile, 'BROKER_ASSETS_HEALTH_OUTPUT_FILE must be provided');
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

const gateFile = path.resolve(process.cwd(), String(process.env.BROKER_ASSETS_SIGNOFF_GATE_FILE || '').trim());
const outputFile = path.resolve(process.cwd(), String(process.env.BROKER_ASSETS_SIGNOFF_OUTPUT_FILE || '').trim());

async function run(): Promise<void> {
  assert.equal(process.env.BROKER_ASSETS_SIGNOFF_REQUIRE_LIVE_HEALTH, 'true');
  assert.equal(process.env.BROKER_ASSETS_SIGNOFF_REQUIRE_LIVE_PROOF, 'false');
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
    ['--import', 'tsx', 'scripts/proof-broker-assets-live.ts'],
    {
      ...process.env,
      BROKER_ASSETS_PROOF_RELEASE_GATE_SCRIPT: gateScript,
      BROKER_ASSETS_PROOF_SIGNOFF_SCRIPT: signoffScript,
      BROKER_ASSETS_RELEASE_GATE_OUTPUT_FILE: gateFile,
      BROKER_ASSETS_SIGNOFF_OUTPUT_FILE: signoffFile,
      BROKER_ASSETS_HEALTH_OUTPUT_FILE: healthFile,
      BROKER_ASSETS_PROOF_OUTPUT_FILE: proofFile,
      BROKER_ASSETS_EVIDENCE_OUTPUT_FILE: evidenceFile,
      BROKER_ASSETS_SIGNOFF_APPROVER: 'codex-phase8',
      BROKER_ASSETS_SIGNOFF_GLOBAL_CATALOG_VERIFIED: 'true',
      BROKER_ASSETS_SIGNOFF_CONNECTED_VISIBILITY_VERIFIED: 'true',
      BROKER_ASSETS_SIGNOFF_DELTA_LOOKUP_VERIFIED: 'true',
      BROKER_ASSETS_SIGNOFF_SOURCE_THRESHOLDS_VERIFIED: 'true',
      BROKER_ASSETS_SIGNOFF_IDENTITY_CONSTRAINTS_REVIEWED: 'true',
    }
  );

  assert.equal(exitCode, 0, 'broker-assets live proof should succeed against ready stub scripts');

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
  assert.equal(summary.deploymentEvidenceOutputFile, path.resolve(process.cwd(), evidenceFile));
  assert.deepEqual(summary.gateTotals, readyGateSummary.totals);

  const checks = (summary.checks || {}) as JsonRecord;
  assert.equal(checks.liveHealthReviewed, true);
  assert.equal(checks.deltaLookupVerified, true);

  const healthSnapshot = (summary.healthSnapshot || {}) as JsonRecord;
  assert.equal(healthSnapshot.schedulerType, 'global');

  const rawEvidence = await readFile(evidenceFile, 'utf8');
  const evidenceSummary = JSON.parse(rawEvidence) as JsonRecord;
  assert.equal(evidenceSummary.decision, 'ready');
  assert.equal(evidenceSummary.proofFile, path.resolve(process.cwd(), proofFile));
  assert.equal(evidenceSummary.deploymentPromotionReady, true);
}

async function runSourceMarkerAssertions(): Promise<void> {
  const proofSource = await readFile(
    path.join(process.cwd(), 'scripts', 'proof-broker-assets-live.ts'),
    'utf8'
  );
  const releaseGateSource = await readFile(
    path.join(process.cwd(), 'scripts', 'release-gate-broker-assets.ts'),
    'utf8'
  );
  const signoffSource = await readFile(
    path.join(process.cwd(), 'scripts', 'signoff-broker-assets.ts'),
    'utf8'
  );
  const operationalAuditSource = await readFile(
    path.join(process.cwd(), 'scripts', 'test-operational-audit.ts'),
    'utf8'
  );
  const packageSource = await readFile(path.join(process.cwd(), 'package.json'), 'utf8');
  const phaseDoc = await readFile(path.join(process.cwd(), 'BROKER_ASSETS_PHASE8.md'), 'utf8');
  const previousPhaseDoc = await readFile(
    path.join(process.cwd(), 'BROKER_ASSETS_PHASE7.md'),
    'utf8'
  );
  const readmeSource = await readFile(path.join(process.cwd(), 'README.md'), 'utf8');

  assert.equal(
    proofSource.includes('scripts/signoff-broker-assets.ts'),
    true,
    'broker-assets proof script must drive broker-assets signoff in Phase 8'
  );
  assert.equal(
    proofSource.includes('artifacts/broker-assets-signoff.json'),
    true,
    'broker-assets proof script must reference the signoff artifact in Phase 8'
  );
  assert.equal(
    proofSource.includes('artifacts/broker-assets-deployment-evidence.json'),
    true,
    'broker-assets proof script must reference the deployment evidence artifact in Phase 8'
  );
  assert.equal(
    proofSource.includes('broker-assets-deployment-evidence:'),
    true,
    'broker-assets proof script must emit the deployment evidence marker in Phase 8'
  );
  assert.equal(
    releaseGateSource.includes('backend-broker-assets-phase8'),
    true,
    'broker-assets release gate must include the Phase 8 suite'
  );
  assert.equal(
    signoffSource.includes('backend-broker-assets-phase8'),
    true,
    'broker-assets signoff must require the Phase 8 gate result'
  );
  assert.equal(
    operationalAuditSource.includes('"proof:broker-assets-live"'),
    true,
    'operational audit must treat the broker-assets proof workflow as required'
  );
  assert.equal(
    packageSource.includes('"test:broker-assets-phase8"'),
    true,
    'package.json must include the Phase 8 broker-assets suite'
  );
  assert.equal(
    packageSource.includes('npm run test:broker-assets-phase8'),
    true,
    'test:broker-assets must include the Phase 8 broker-assets guard'
  );
  assert.equal(
    phaseDoc.includes('Phase 8 closes the remaining operational gap after the Phase 7 release gate.'),
    true,
    'BROKER_ASSETS_PHASE8.md must document the Phase 8 proof workflow'
  );
  assert.equal(
    phaseDoc.includes('## 4) Carry-Forward For Phase 9'),
    true,
    'BROKER_ASSETS_PHASE8.md must include the Phase 9 handoff checklist'
  );
  assert.equal(
    previousPhaseDoc.includes('BROKER_ASSETS_PHASE8.md'),
    true,
    'BROKER_ASSETS_PHASE7.md must point forward to the Phase 8 handoff'
  );
  assert.equal(
    readmeSource.includes('proof:broker-assets-live'),
    true,
    'README.md must reference the broker-assets live proof workflow'
  );
}

async function main(): Promise<void> {
  await runBrokerAssetsLiveProofAssertions();
  await runSourceMarkerAssertions();
  console.log('Broker assets phase 8 assertions passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
