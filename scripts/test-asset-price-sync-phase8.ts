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

async function runAssetPriceSyncLiveProofAssertions(): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'asset-price-sync-phase8-'));
  const gateFile = path.join(tempDir, 'asset-price-sync-release-gate.json');
  const signoffFile = path.join(tempDir, 'asset-price-sync-signoff.json');
  const healthFile = path.join(tempDir, 'asset-price-sync-health.json');
  const proofFile = path.join(tempDir, 'asset-price-sync-live-proof.json');
  const evidenceFile = path.join(tempDir, 'asset-price-sync-deployment-evidence.json');
  const gateScript = path.join(tempDir, 'release-gate.stub.ts');
  const signoffScript = path.join(tempDir, 'signoff.stub.ts');

  const readyHealthSnapshot = {
    baseUrl: 'http://127.0.0.1:3102/api/v1',
    queueStatus: 'ok',
    queueName: 'scheduler.exchange-assets.execute',
    queueLatencyMs: 12,
    workerStatus: 'ok',
    workerHttpStatus: 'ok',
    workerHeartbeatAgeMs: 2100,
    schedulerKey: 'asset-price-sync',
    schedulerType: 'global',
    schedulerEnabled: true,
    schedulerTimezone: 'UTC',
    schedulerSources: ['mudrex', 'delta_exchange'],
    selectionMode: 'custom',
    selectedAssetIdsCount: 4,
    configLatencyMs: 40,
    assetsLatencyMs: 55,
    runsLatencyMs: 48,
    assetTotal: 4,
    assetCount: 4,
    assetFirstId: 'broker-asset-1',
    assetFirstSymbol: 'BTCUSDT',
    assetSourceSamples: ['mudrex', 'delta_exchange'],
    runTotal: 3,
    runCount: 3,
    latestRunId: 'run-1',
    latestRunStatus: 'Completed',
    latestRunExecutionContext: 'system',
    latestRunInitiatedByType: 'manual',
    latestRunScopeAssetsCount: 4,
    latestRunProgressPercent: 100,
    latestUpdateCount: 2,
    overviewCount: 4,
    overviewDisplayTimeZone: 'Asia/Kolkata',
    overviewLocalized: true,
    overviewStatus: 'Completed',
    overviewExecutionContext: 'system',
    overviewInitiatedByType: 'manual',
    overviewHasQueuedWork: false,
    configDisplayTimeZone: 'Asia/Kolkata',
    configLocalized: true,
    runsDisplayTimeZone: 'Asia/Kolkata',
    runsLocalized: true,
    progressDisplayTimeZone: 'Asia/Kolkata',
    progressLocalized: true,
    updatesDisplayTimeZone: 'Asia/Kolkata',
    updatesLocalized: true,
    thresholdProfile: {
      mode: 'bounded',
      configuredThresholdCount: 5,
      requiredThresholdCount: 5,
      configuredKeys: [
        'maxConfigLatencyMs',
        'maxAssetListLatencyMs',
        'maxRunListLatencyMs',
        'minAssetResults',
        'minRunResults',
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
      total: 15,
      passed: 15,
      failed: 0,
      skipped: 0,
    },
    results: [
      'backend-asset-price-sync-phase1',
      'backend-asset-price-sync-phase2',
      'backend-asset-price-sync-phase3',
      'backend-asset-price-sync-phase4',
      'backend-asset-price-sync-phase5',
      'backend-asset-price-sync-phase6',
      'backend-asset-price-sync-phase7',
      'backend-asset-price-sync-phase8',
      'backend-asset-price-sync-global-regression',
      'backend-asset-price-sync-operational-audit',
      'backend-asset-price-sync-eslint',
      'worker-asset-price-sync-build',
      'frontend-asset-price-sync-ui',
      'frontend-asset-price-sync-eslint',
      'backend-asset-price-sync-live-health',
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
      liveProofReviewed: true,
      thresholdPostureCaptured: true,
      operatorWorkspaceReviewed: true,
      runScopeOverrideReviewed: true,
      brokerAssetIdReviewed: true,
      systemSourcesReviewed: true,
      timeAuditReviewed: true,
      placeholderEvidenceAcknowledged: true,
      unboundedThresholdsAcknowledged: true,
    },
    readiness: {
      deploymentEvidenceReady: true,
      thresholdProfileMode: 'bounded',
      liveGateReady: true,
      liveProofReady: false,
      crossRepoProofReady: true,
      productionPromotionReady: true,
    },
    acknowledgements: {
      placeholderEvidenceUsed: false,
      unboundedThresholdsUsed: false,
    },
    thresholdProfile: readyHealthSnapshot.thresholdProfile,
    evidence: {
      stagingWorkflowUrl: 'https://example.com/workflows/asset-price-sync',
      dashboardUrl: 'https://example.com/dashboards/asset-price-sync',
      runbookUrl: 'https://example.com/runbooks/asset-price-sync',
      releaseNoteUrl: 'https://example.com/releases/asset-price-sync',
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
  };

  await writeFile(
    gateScript,
    `import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const outputFile = path.resolve(process.cwd(), String(process.env.ASSET_PRICE_SYNC_RELEASE_GATE_OUTPUT_FILE || '').trim());
const healthFile = path.resolve(process.cwd(), String(process.env.ASSET_PRICE_SYNC_HEALTH_OUTPUT_FILE || '').trim());

async function run(): Promise<void> {
  assert.equal(process.env.ASSET_PRICE_SYNC_RUN_LIVE_CHECKS, 'true');
  assert.ok(outputFile, 'ASSET_PRICE_SYNC_RELEASE_GATE_OUTPUT_FILE must be provided');
  assert.ok(healthFile, 'ASSET_PRICE_SYNC_HEALTH_OUTPUT_FILE must be provided');
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

const gateFile = path.resolve(process.cwd(), String(process.env.ASSET_PRICE_SYNC_SIGNOFF_GATE_FILE || '').trim());
const outputFile = path.resolve(process.cwd(), String(process.env.ASSET_PRICE_SYNC_SIGNOFF_OUTPUT_FILE || '').trim());

async function run(): Promise<void> {
  assert.equal(process.env.ASSET_PRICE_SYNC_SIGNOFF_REQUIRE_LIVE_HEALTH, 'true');
  assert.equal(process.env.ASSET_PRICE_SYNC_SIGNOFF_REQUIRE_LIVE_PROOF, 'false');
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
    ['--import', 'tsx', 'scripts/proof-asset-price-sync-live.ts'],
    {
      ...process.env,
      ASSET_PRICE_SYNC_PROOF_RELEASE_GATE_SCRIPT: gateScript,
      ASSET_PRICE_SYNC_PROOF_SIGNOFF_SCRIPT: signoffScript,
      ASSET_PRICE_SYNC_RELEASE_GATE_OUTPUT_FILE: gateFile,
      ASSET_PRICE_SYNC_SIGNOFF_OUTPUT_FILE: signoffFile,
      ASSET_PRICE_SYNC_HEALTH_OUTPUT_FILE: healthFile,
      ASSET_PRICE_SYNC_PROOF_OUTPUT_FILE: proofFile,
      ASSET_PRICE_SYNC_EVIDENCE_OUTPUT_FILE: evidenceFile,
      ASSET_PRICE_SYNC_SIGNOFF_APPROVER: 'codex-phase8',
      ASSET_PRICE_SYNC_SIGNOFF_OPERATOR_WORKSPACE_REVIEWED: 'true',
      ASSET_PRICE_SYNC_SIGNOFF_RUN_SCOPE_OVERRIDE_REVIEWED: 'true',
      ASSET_PRICE_SYNC_SIGNOFF_BROKER_ASSET_ID_REVIEWED: 'true',
      ASSET_PRICE_SYNC_SIGNOFF_SYSTEM_SOURCES_REVIEWED: 'true',
      ASSET_PRICE_SYNC_SIGNOFF_TIME_AUDIT_REVIEWED: 'true',
    }
  );

  assert.equal(
    exitCode,
    0,
    'asset-price-sync live proof should succeed against ready stub scripts'
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
  assert.equal(healthSnapshot.schedulerType, 'global');
  assert.deepEqual(healthSnapshot.schedulerSources, readyHealthSnapshot.schedulerSources);

  const rawEvidence = await readFile(evidenceFile, 'utf8');
  const evidenceSummary = JSON.parse(rawEvidence) as JsonRecord;
  assert.equal(evidenceSummary.decision, 'ready');
  assert.equal(evidenceSummary.proofFile, path.resolve(process.cwd(), proofFile));
  assert.equal(evidenceSummary.deploymentPromotionReady, true);
}

async function runSourceMarkerAssertions(): Promise<void> {
  const healthSource = await readFile(
    path.join(process.cwd(), 'scripts', 'check-asset-price-sync-health.ts'),
    'utf8'
  );
  const releaseGateSource = await readFile(
    path.join(process.cwd(), 'scripts', 'release-gate-asset-price-sync.ts'),
    'utf8'
  );
  const signoffSource = await readFile(
    path.join(process.cwd(), 'scripts', 'signoff-asset-price-sync.ts'),
    'utf8'
  );
  const proofSource = await readFile(
    path.join(process.cwd(), 'scripts', 'proof-asset-price-sync-live.ts'),
    'utf8'
  );
  const operationalAuditSource = await readFile(
    path.join(process.cwd(), 'scripts', 'test-operational-audit.ts'),
    'utf8'
  );
  const packageSource = await readFile(path.join(process.cwd(), 'package.json'), 'utf8');
  const phaseDoc = await readFile(path.join(process.cwd(), 'ASSET_PRICE_SYNC_PHASE8.md'), 'utf8');
  const previousPhaseDoc = await readFile(
    path.join(process.cwd(), 'ASSET_PRICE_SYNC_PHASE7.md'),
    'utf8'
  );
  const readmeSource = await readFile(path.join(process.cwd(), 'README.md'), 'utf8');

  assert.equal(
    healthSource.includes('/scheduler/asset-price/config'),
    true,
    'asset-price-sync health must read the scheduler config route'
  );
  assert.equal(
    healthSource.includes('/scheduler/asset-price/assets'),
    true,
    'asset-price-sync health must read the scope assets route'
  );
  assert.equal(
    healthSource.includes('delta_exchange'),
    true,
    'asset-price-sync health must keep Delta Exchange in the source contract'
  );
  assert.equal(
    releaseGateSource.includes('backend-asset-price-sync-phase8'),
    true,
    'asset-price-sync release gate must include the Phase 8 suite'
  );
  assert.equal(
    releaseGateSource.includes('frontend-asset-price-sync-ui'),
    true,
    'asset-price-sync release gate must include frontend proof coverage'
  );
  assert.equal(
    releaseGateSource.includes('worker-asset-price-sync-build'),
    true,
    'asset-price-sync release gate must include worker proof coverage'
  );
  assert.equal(
    signoffSource.includes('ASSET_PRICE_SYNC_SIGNOFF_BROKER_ASSET_ID_REVIEWED'),
    true,
    'asset-price-sync signoff must require explicit broker-asset-id review'
  );
  assert.equal(
    signoffSource.includes('backend-asset-price-sync-phase8'),
    true,
    'asset-price-sync signoff must require the Phase 8 gate result'
  );
  assert.equal(
    proofSource.includes('artifacts/asset-price-sync-deployment-evidence.json'),
    true,
    'asset-price-sync proof must write the deployment evidence artifact'
  );
  assert.equal(
    proofSource.includes('asset-price-sync-deployment-evidence:'),
    true,
    'asset-price-sync proof must emit the deployment evidence marker'
  );
  assert.equal(
    operationalAuditSource.includes('"proof:asset-price-sync-live"'),
    true,
    'operational audit must treat the asset-price-sync proof workflow as required'
  );
  assert.equal(
    packageSource.includes('"test:asset-price-sync-phase8"'),
    true,
    'package.json must include the Phase 8 asset-price-sync suite'
  );
  assert.equal(
    packageSource.includes('"check:asset-price-sync-health"'),
    true,
    'package.json must include the Phase 8 health script'
  );
  assert.equal(
    packageSource.includes('npm run test:asset-price-sync-phase8'),
    true,
    'test:all must include the Phase 8 asset-price-sync guard'
  );
  assert.equal(
    phaseDoc.includes(
      'Phase 8 closes the operational proof gap after the Phase 7 frontend/operator freeze.'
    ),
    true,
    'ASSET_PRICE_SYNC_PHASE8.md must document the Phase 8 proof workflow'
  );
  assert.equal(
    phaseDoc.includes('## 4) Carry-Forward For Phase 9'),
    true,
    'ASSET_PRICE_SYNC_PHASE8.md must include the Phase 9 handoff checklist'
  );
  assert.equal(
    previousPhaseDoc.includes('ASSET_PRICE_SYNC_PHASE8.md'),
    true,
    'ASSET_PRICE_SYNC_PHASE7.md must point forward to the Phase 8 handoff'
  );
  assert.equal(
    readmeSource.includes('proof:asset-price-sync-live'),
    true,
    'README.md must reference the asset-price-sync live proof workflow'
  );
}

async function main(): Promise<void> {
  await runAssetPriceSyncLiveProofAssertions();
  await runSourceMarkerAssertions();
  console.log('Asset price sync Phase 8 assertions passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
