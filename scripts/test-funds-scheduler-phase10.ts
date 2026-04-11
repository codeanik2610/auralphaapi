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

function buildReadyGateSummary(healthSnapshot: JsonRecord): JsonRecord {
  return {
    decision: 'ready',
    startedAt: '2026-04-10T12:00:00.000Z',
    finishedAt: '2026-04-10T12:05:00.000Z',
    liveChecksEnabled: true,
    healthSnapshotFile: '/tmp/funds-scheduler-health.json',
    healthSnapshot,
    totals: {
      total: 17,
      passed: 17,
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
      'backend-funds-scheduler-phase11',
      'backend-funds-scheduler-phase12',
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
}

function buildUnboundedHealthSnapshot(): JsonRecord {
  return {
    baseUrl: 'http://127.0.0.1:3100/api/v1',
    scheduler: {
      totalConnectedAccounts: 2,
      accountsWithFreshSnapshot: 0,
      accountsWithStaleSnapshot: 0,
      accountsMissingSnapshot: 2,
      accountsWithFailedLatestAttempt: 0,
    },
    thresholds: {
      maxStaleAccounts: null,
      maxMissingAccounts: null,
      maxFailedLatestAttempts: null,
      maxLatestSnapshotAgeMinutes: null,
      maxLatestAttemptAgeMinutes: null,
    },
    thresholdProfile: {
      mode: 'unbounded',
      configuredThresholdCount: 0,
      requiredThresholdCount: 5,
      configuredKeys: [],
      missingKeys: [
        'maxStaleAccounts',
        'maxMissingAccounts',
        'maxFailedLatestAttempts',
        'maxLatestSnapshotAgeMinutes',
        'maxLatestAttemptAgeMinutes',
      ],
    },
  };
}

async function testSignoffCapturesPlaceholderEvidenceAndThresholdPosture(): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'funds-phase10-signoff-'));
  const gateFile = path.join(tempDir, 'funds-release-gate.json');
  const outputFile = path.join(tempDir, 'funds-signoff.json');

  await writeFile(
    gateFile,
    `${JSON.stringify(buildReadyGateSummary(buildUnboundedHealthSnapshot()), null, 2)}\n`,
    'utf8'
  );

  const exitCode = await runCommand(
    process.execPath,
    ['--import', 'tsx', 'scripts/signoff-funds-scheduler.ts'],
    {
      ...process.env,
      FUNDS_SCHEDULER_SIGNOFF_GATE_FILE: gateFile,
      FUNDS_SCHEDULER_SIGNOFF_OUTPUT_FILE: outputFile,
      FUNDS_SCHEDULER_SIGNOFF_REQUIRE_LIVE_HEALTH: 'true',
      FUNDS_SCHEDULER_SIGNOFF_DIAGNOSTICS_VERIFIED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_COVERAGE_VERIFIED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_PRODUCT_TRUST_VERIFIED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_HEALTH_THRESHOLDS_VERIFIED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_RECOVERY_DRILL_VERIFIED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_ACCESS_REVIEW_VERIFIED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_PLACEHOLDER_EVIDENCE_ACKNOWLEDGED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_UNBOUNDED_THRESHOLDS_ACKNOWLEDGED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_APPROVER: 'codex-phase10',
      FUNDS_SCHEDULER_SIGNOFF_STAGING_WORKFLOW_URL:
        'http://127.0.0.1:3100/api/v1/scheduler/funds/summary',
      FUNDS_SCHEDULER_SIGNOFF_DASHBOARD_URL:
        'http://127.0.0.1:3100/api/v1/scheduler/funds/coverage?limit=200',
      FUNDS_SCHEDULER_SIGNOFF_RUNBOOK_URL:
        '/Users/apple/Documents/Project/Backend/aurAlpha/RUNBOOK.md',
      FUNDS_SCHEDULER_SIGNOFF_RELEASE_NOTE_URL:
        '/Users/apple/Documents/Project/Backend/aurAlpha/FUNDS_SCHEDULER_PHASE10.md',
    }
  );

  assert.equal(exitCode, 0, 'signoff should succeed when placeholder posture is acknowledged');

  const raw = await readFile(outputFile, 'utf8');
  const summary = JSON.parse(raw) as {
    checks: Record<string, boolean>;
    readiness: Record<string, unknown>;
    thresholdProfile: Record<string, unknown>;
    evidenceClassification: Record<string, string>;
  };

  assert.equal(summary.checks.thresholdPostureCaptured, true);
  assert.equal(summary.checks.placeholderEvidenceAcknowledged, true);
  assert.equal(summary.checks.unboundedThresholdsAcknowledged, true);
  assert.equal(summary.readiness.deploymentEvidenceReady, false);
  assert.equal(summary.readiness.productionPromotionReady, false);
  assert.equal(summary.thresholdProfile.mode, 'unbounded');
  assert.equal(summary.evidenceClassification.stagingWorkflowUrlKind, 'localhost_url');
  assert.equal(summary.evidenceClassification.releaseNoteUrlKind, 'local_path');
}

async function testSignoffRejectsPlaceholderEvidenceWithoutAcknowledgement(): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'funds-phase10-placeholder-'));
  const gateFile = path.join(tempDir, 'funds-release-gate.json');
  const outputFile = path.join(tempDir, 'funds-signoff.json');

  await writeFile(
    gateFile,
    `${JSON.stringify(buildReadyGateSummary(buildUnboundedHealthSnapshot()), null, 2)}\n`,
    'utf8'
  );

  const exitCode = await runCommand(
    process.execPath,
    ['--import', 'tsx', 'scripts/signoff-funds-scheduler.ts'],
    {
      ...process.env,
      FUNDS_SCHEDULER_SIGNOFF_GATE_FILE: gateFile,
      FUNDS_SCHEDULER_SIGNOFF_OUTPUT_FILE: outputFile,
      FUNDS_SCHEDULER_SIGNOFF_REQUIRE_LIVE_HEALTH: 'true',
      FUNDS_SCHEDULER_SIGNOFF_DIAGNOSTICS_VERIFIED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_COVERAGE_VERIFIED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_PRODUCT_TRUST_VERIFIED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_HEALTH_THRESHOLDS_VERIFIED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_RECOVERY_DRILL_VERIFIED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_ACCESS_REVIEW_VERIFIED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_PLACEHOLDER_EVIDENCE_ACKNOWLEDGED: '',
      FUNDS_SCHEDULER_SIGNOFF_UNBOUNDED_THRESHOLDS_ACKNOWLEDGED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_APPROVER: 'codex-phase10',
      FUNDS_SCHEDULER_SIGNOFF_STAGING_WORKFLOW_URL:
        'http://127.0.0.1:3100/api/v1/scheduler/funds/summary',
      FUNDS_SCHEDULER_SIGNOFF_DASHBOARD_URL:
        'http://127.0.0.1:3100/api/v1/scheduler/funds/coverage?limit=200',
      FUNDS_SCHEDULER_SIGNOFF_RUNBOOK_URL:
        '/Users/apple/Documents/Project/Backend/aurAlpha/RUNBOOK.md',
      FUNDS_SCHEDULER_SIGNOFF_RELEASE_NOTE_URL:
        '/Users/apple/Documents/Project/Backend/aurAlpha/FUNDS_SCHEDULER_PHASE10.md',
    }
  );

  assert.notEqual(
    exitCode,
    0,
    'signoff should fail when localhost placeholder evidence is not acknowledged'
  );
}

async function testProofWritesDeploymentEvidencePackage(): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'funds-phase10-proof-'));
  const gateFile = path.join(tempDir, 'funds-release-gate.json');
  const signoffFile = path.join(tempDir, 'funds-signoff.json');
  const proofFile = path.join(tempDir, 'funds-live-proof.json');
  const evidenceFile = path.join(tempDir, 'funds-deployment-evidence.json');
  const gateScript = path.join(tempDir, 'release-gate.stub.ts');
  const signoffScript = path.join(tempDir, 'signoff.stub.ts');

  const readyGateSummary = buildReadyGateSummary({
    baseUrl: 'https://staging.example.com/api/v1',
    scheduler: {
      totalConnectedAccounts: 3,
      accountsWithFreshSnapshot: 3,
      accountsWithStaleSnapshot: 0,
      accountsMissingSnapshot: 0,
      accountsWithFailedLatestAttempt: 0,
    },
    thresholds: {
      maxStaleAccounts: 0,
      maxMissingAccounts: 0,
      maxFailedLatestAttempts: 0,
      maxLatestSnapshotAgeMinutes: 90,
      maxLatestAttemptAgeMinutes: 90,
    },
    thresholdProfile: {
      mode: 'bounded',
      configuredThresholdCount: 5,
      requiredThresholdCount: 5,
      configuredKeys: [
        'maxStaleAccounts',
        'maxMissingAccounts',
        'maxFailedLatestAttempts',
        'maxLatestSnapshotAgeMinutes',
        'maxLatestAttemptAgeMinutes',
      ],
      missingKeys: [],
    },
  });

  const readySignoffSummary = {
    decision: 'ready',
    generatedAt: '2026-04-10T12:05:00.000Z',
    approver: 'codex-phase10',
    checks: {
      gateReady: true,
      requiredSuitesPassed: true,
      liveHealthReviewed: true,
      thresholdPostureCaptured: true,
      placeholderEvidenceAcknowledged: true,
      unboundedThresholdsAcknowledged: true,
      diagnosticsVerified: true,
      coverageVerified: true,
      productTrustVerified: true,
      healthThresholdsVerified: true,
      recoveryDrillVerified: true,
      accessReviewVerified: true,
    },
    readiness: {
      deploymentEvidenceReady: true,
      thresholdProfileMode: 'bounded',
      productionPromotionReady: true,
    },
    thresholdProfile: {
      mode: 'bounded',
      configuredThresholdCount: 5,
      requiredThresholdCount: 5,
      configuredKeys: ['maxStaleAccounts'],
      missingKeys: [],
    },
    evidence: {
      stagingWorkflowUrl: 'https://example.com/staging/funds-sync',
      dashboardUrl: 'https://example.com/dashboards/funds-sync',
      runbookUrl: 'https://example.com/runbooks/funds-sync',
      releaseNoteUrl: 'https://example.com/releases/funds-sync',
    },
    evidenceClassification: {
      stagingWorkflowUrlKind: 'remote_url',
      dashboardUrlKind: 'remote_url',
      runbookUrlKind: 'remote_url',
      releaseNoteUrlKind: 'remote_url',
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
    `import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const outputFile = path.resolve(process.cwd(), String(process.env.FUNDS_SCHEDULER_SIGNOFF_OUTPUT_FILE || '').trim());

async function run(): Promise<void> {
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
      FUNDS_SCHEDULER_SIGNOFF_APPROVER: 'codex-phase10',
      FUNDS_SCHEDULER_SIGNOFF_DIAGNOSTICS_VERIFIED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_COVERAGE_VERIFIED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_PRODUCT_TRUST_VERIFIED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_HEALTH_THRESHOLDS_VERIFIED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_RECOVERY_DRILL_VERIFIED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_ACCESS_REVIEW_VERIFIED: 'true',
    }
  );

  assert.equal(exitCode, 0, 'proof should succeed against ready Phase 10 stub scripts');

  const rawProof = await readFile(proofFile, 'utf8');
  const proofSummary = JSON.parse(rawProof) as JsonRecord;
  assert.equal(proofSummary.deploymentEvidenceOutputFile, path.resolve(process.cwd(), evidenceFile));

  const rawEvidence = await readFile(evidenceFile, 'utf8');
  const evidencePackage = JSON.parse(rawEvidence) as JsonRecord;
  assert.equal(evidencePackage.deploymentPromotionReady, true);
  assert.equal(evidencePackage.deploymentEvidenceReady, true);
  assert.equal(evidencePackage.thresholdProfileMode, 'bounded');
  assert.equal(evidencePackage.proofFile, path.resolve(process.cwd(), proofFile));
}

async function runSourceMarkerAssertions(): Promise<void> {
  const checkHealthSource = await readFile(
    path.join(process.cwd(), 'scripts', 'check-funds-scheduler-health.ts'),
    'utf8'
  );
  const releaseGateSource = await readFile(
    path.join(process.cwd(), 'scripts', 'release-gate-funds-scheduler.ts'),
    'utf8'
  );
  const signoffSource = await readFile(
    path.join(process.cwd(), 'scripts', 'signoff-funds-scheduler.ts'),
    'utf8'
  );
  const proofSource = await readFile(
    path.join(process.cwd(), 'scripts', 'proof-funds-scheduler-live.ts'),
    'utf8'
  );
  const packageSource = await readFile(path.join(process.cwd(), 'package.json'), 'utf8');

  assert.equal(
    checkHealthSource.includes('FUNDS_SCHEDULER_HEALTH_OUTPUT_FILE'),
    true,
    'health check must support a persisted Phase 10 output snapshot'
  );
  assert.equal(
    checkHealthSource.includes('thresholdProfile'),
    true,
    'health check must include thresholdProfile in the Phase 10 snapshot'
  );
  assert.equal(
    releaseGateSource.includes('backend-funds-scheduler-phase10'),
    true,
    'release gate must include the Phase 10 funds scheduler suite'
  );
  assert.equal(
    signoffSource.includes('backend-funds-scheduler-phase10'),
    true,
    'signoff must require the Phase 10 gate result'
  );
  assert.equal(
    proofSource.includes('funds-scheduler-deployment-evidence.json'),
    true,
    'proof must write the Phase 10 deployment evidence package'
  );
  assert.equal(
    packageSource.includes('"test:funds-scheduler-phase10"'),
    true,
    'package.json must include the Phase 10 funds scheduler script'
  );
}

async function main(): Promise<void> {
  await testSignoffCapturesPlaceholderEvidenceAndThresholdPosture();
  await testSignoffRejectsPlaceholderEvidenceWithoutAcknowledgement();
  await testProofWritesDeploymentEvidencePackage();
  await runSourceMarkerAssertions();
  console.log('Funds scheduler phase 10 assertions passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
