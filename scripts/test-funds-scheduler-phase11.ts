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

function buildBoundedHealthSnapshot(baseUrl: string): JsonRecord {
  return {
    baseUrl,
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
  };
}

function buildSignoffEnv(
  gateFile: string,
  outputFile: string,
  extraEnv: Record<string, string> = {}
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    FUNDS_SCHEDULER_SIGNOFF_GATE_FILE: gateFile,
    FUNDS_SCHEDULER_SIGNOFF_OUTPUT_FILE: outputFile,
    FUNDS_SCHEDULER_SIGNOFF_REQUIRE_LIVE_HEALTH: 'true',
    FUNDS_SCHEDULER_SIGNOFF_REQUIRE_DEPLOYMENT_EVIDENCE: 'true',
    FUNDS_SCHEDULER_SIGNOFF_DIAGNOSTICS_VERIFIED: 'true',
    FUNDS_SCHEDULER_SIGNOFF_COVERAGE_VERIFIED: 'true',
    FUNDS_SCHEDULER_SIGNOFF_PRODUCT_TRUST_VERIFIED: 'true',
    FUNDS_SCHEDULER_SIGNOFF_HEALTH_THRESHOLDS_VERIFIED: 'true',
    FUNDS_SCHEDULER_SIGNOFF_RECOVERY_DRILL_VERIFIED: 'true',
    FUNDS_SCHEDULER_SIGNOFF_ACCESS_REVIEW_VERIFIED: 'true',
    FUNDS_SCHEDULER_SIGNOFF_APPROVER: 'codex-phase11',
    FUNDS_SCHEDULER_SIGNOFF_STAGING_WORKFLOW_URL:
      'https://staging.example.com/workflows/funds-sync',
    FUNDS_SCHEDULER_SIGNOFF_DASHBOARD_URL:
      'https://staging.example.com/dashboards/funds-sync',
    FUNDS_SCHEDULER_SIGNOFF_RUNBOOK_URL:
      'https://staging.example.com/runbooks/funds-sync',
    FUNDS_SCHEDULER_SIGNOFF_RELEASE_NOTE_URL:
      'https://staging.example.com/releases/funds-sync',
    FUNDS_SCHEDULER_SIGNOFF_PLACEHOLDER_EVIDENCE_ACKNOWLEDGED: '',
    FUNDS_SCHEDULER_SIGNOFF_UNBOUNDED_THRESHOLDS_ACKNOWLEDGED: '',
    ...extraEnv,
  };
}

async function testSignoffCapturesTargetEnvironmentReadiness(): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'funds-phase11-signoff-'));
  const gateFile = path.join(tempDir, 'funds-release-gate.json');
  const outputFile = path.join(tempDir, 'funds-signoff.json');

  await writeFile(
    gateFile,
    `${JSON.stringify(
      buildReadyGateSummary(buildBoundedHealthSnapshot('http://127.0.0.1:3100/api/v1')),
      null,
      2
    )}\n`,
    'utf8'
  );

  const exitCode = await runCommand(
    process.execPath,
    ['--import', 'tsx', 'scripts/signoff-funds-scheduler.ts'],
    buildSignoffEnv(gateFile, outputFile)
  );

  assert.equal(
    exitCode,
    0,
    'signoff should stay ready when evidence is remote but the health base URL is still localhost'
  );

  const raw = await readFile(outputFile, 'utf8');
  const summary = JSON.parse(raw) as {
    decision: string;
    checks: Record<string, boolean>;
    readiness: Record<string, unknown>;
    acknowledgements: Record<string, boolean>;
    environment: Record<string, unknown>;
  };

  assert.equal(summary.decision, 'ready');
  assert.equal(summary.checks.placeholderEvidenceAcknowledged, true);
  assert.equal(summary.acknowledgements.placeholderEvidenceUsed, false);
  assert.equal(summary.acknowledgements.unboundedThresholdsUsed, false);
  assert.equal(summary.readiness.deploymentEvidenceReady, true);
  assert.equal(summary.readiness.targetEnvironmentReady, false);
  assert.equal(summary.readiness.healthBaseUrlKind, 'localhost_url');
  assert.equal(summary.readiness.productionPromotionReady, false);
  assert.equal(summary.environment.healthBaseUrl, 'http://127.0.0.1:3100/api/v1');
  assert.equal(summary.environment.healthBaseUrlKind, 'localhost_url');
  assert.equal(summary.environment.targetEnvironmentReady, false);
}

async function testSignoffPersistsBlockedSummaryWhenPromotionReadyIsRequired(): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'funds-phase11-signoff-blocked-'));
  const gateFile = path.join(tempDir, 'funds-release-gate.json');
  const outputFile = path.join(tempDir, 'funds-signoff.json');

  await writeFile(
    gateFile,
    `${JSON.stringify(
      buildReadyGateSummary(buildBoundedHealthSnapshot('http://127.0.0.1:3100/api/v1')),
      null,
      2
    )}\n`,
    'utf8'
  );

  const exitCode = await runCommand(
    process.execPath,
    ['--import', 'tsx', 'scripts/signoff-funds-scheduler.ts'],
    buildSignoffEnv(gateFile, outputFile, {
      FUNDS_SCHEDULER_SIGNOFF_REQUIRE_PROMOTION_READY: 'true',
    })
  );

  assert.notEqual(
    exitCode,
    0,
    'signoff should block when strict promotion readiness is required but live health still points at localhost'
  );

  const raw = await readFile(outputFile, 'utf8');
  const summary = JSON.parse(raw) as {
    decision: string;
    readiness: Record<string, unknown>;
    environment: Record<string, unknown>;
  };

  assert.equal(summary.decision, 'blocked');
  assert.equal(summary.readiness.productionPromotionReady, false);
  assert.equal(summary.environment.healthBaseUrlKind, 'localhost_url');
  assert.equal(summary.environment.targetEnvironmentReady, false);
}

async function testPromotionProofWritesBlockedArtifactForLocalhostEvidence(): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'funds-phase11-proof-blocked-'));
  const gateFile = path.join(tempDir, 'funds-release-gate.json');
  const signoffFile = path.join(tempDir, 'funds-signoff.json');
  const promotionFile = path.join(tempDir, 'funds-promotion-proof.json');
  const gateScript = path.join(tempDir, 'release-gate.stub.ts');

  await writeFile(
    gateScript,
    `import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const outputFile = path.resolve(process.cwd(), String(process.env.FUNDS_SCHEDULER_RELEASE_GATE_OUTPUT_FILE || '').trim());

async function run(): Promise<void> {
  assert.equal(process.env.FUNDS_SCHEDULER_RUN_LIVE_CHECKS, 'true');
  await mkdir(path.dirname(outputFile), { recursive: true });
  const summary = ${JSON.stringify(
    buildReadyGateSummary(buildBoundedHealthSnapshot('http://127.0.0.1:3100/api/v1')),
    null,
    2
  )};
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
    ['--import', 'tsx', 'scripts/proof-funds-scheduler-promotion.ts'],
    {
      ...process.env,
      FUNDS_SCHEDULER_PROMOTION_RELEASE_GATE_SCRIPT: gateScript,
      FUNDS_SCHEDULER_RELEASE_GATE_OUTPUT_FILE: gateFile,
      FUNDS_SCHEDULER_SIGNOFF_OUTPUT_FILE: signoffFile,
      FUNDS_SCHEDULER_PROMOTION_OUTPUT_FILE: promotionFile,
      FUNDS_SCHEDULER_SIGNOFF_APPROVER: 'codex-phase11',
      FUNDS_SCHEDULER_SIGNOFF_DIAGNOSTICS_VERIFIED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_COVERAGE_VERIFIED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_PRODUCT_TRUST_VERIFIED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_HEALTH_THRESHOLDS_VERIFIED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_RECOVERY_DRILL_VERIFIED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_ACCESS_REVIEW_VERIFIED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_STAGING_WORKFLOW_URL:
        'https://staging.example.com/workflows/funds-sync',
      FUNDS_SCHEDULER_SIGNOFF_DASHBOARD_URL:
        'https://staging.example.com/dashboards/funds-sync',
      FUNDS_SCHEDULER_SIGNOFF_RELEASE_NOTE_URL:
        'https://staging.example.com/releases/funds-sync',
      FUNDS_SCHEDULER_SIGNOFF_PLACEHOLDER_EVIDENCE_ACKNOWLEDGED: '',
      FUNDS_SCHEDULER_SIGNOFF_UNBOUNDED_THRESHOLDS_ACKNOWLEDGED: '',
    }
  );

  assert.notEqual(
    exitCode,
    0,
    'promotion proof should block while funds health still points at localhost'
  );

  const raw = await readFile(promotionFile, 'utf8');
  const summary = JSON.parse(raw) as {
    decision: string;
    gateDecision: string | null;
    signoffDecision: string | null;
    readiness: Record<string, unknown>;
    environment: Record<string, unknown>;
  };

  assert.equal(summary.decision, 'blocked');
  assert.equal(summary.gateDecision, 'ready');
  assert.equal(summary.signoffDecision, 'blocked');
  assert.equal(summary.readiness.productionPromotionReady, false);
  assert.equal(summary.environment.healthBaseUrlKind, 'localhost_url');
  assert.equal(summary.environment.targetEnvironmentReady, false);
}

async function testPromotionProofSucceedsWhenTargetEnvironmentIsReady(): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'funds-phase11-proof-ready-'));
  const gateFile = path.join(tempDir, 'funds-release-gate.json');
  const signoffFile = path.join(tempDir, 'funds-signoff.json');
  const promotionFile = path.join(tempDir, 'funds-promotion-proof.json');
  const gateScript = path.join(tempDir, 'release-gate.stub.ts');
  const signoffScript = path.join(tempDir, 'signoff.stub.ts');

  const readyGateSummary = buildReadyGateSummary(
    buildBoundedHealthSnapshot('https://staging.example.com/api/v1')
  );
  const readySignoffSummary = {
    decision: 'ready',
    generatedAt: '2026-04-10T12:06:00.000Z',
    approver: 'codex-phase11',
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
      targetEnvironmentReady: true,
      healthBaseUrlKind: 'remote_url',
      productionPromotionReady: true,
    },
    acknowledgements: {
      placeholderEvidenceUsed: false,
      unboundedThresholdsUsed: false,
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
    evidence: {
      stagingWorkflowUrl: 'https://staging.example.com/workflows/funds-sync',
      workflowUrl: 'https://staging.example.com/workflows/funds-sync',
      dashboardUrl: 'https://staging.example.com/dashboards/funds-sync',
      runbookUrl: 'https://staging.example.com/runbooks/funds-sync',
      releaseNoteUrl: 'https://staging.example.com/releases/funds-sync',
    },
    evidenceClassification: {
      stagingWorkflowUrlKind: 'remote_url',
      dashboardUrlKind: 'remote_url',
      runbookUrlKind: 'remote_url',
      releaseNoteUrlKind: 'remote_url',
    },
    environment: {
      healthBaseUrl: 'https://staging.example.com/api/v1',
      healthBaseUrlKind: 'remote_url',
      targetEnvironmentReady: true,
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
    `import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const outputFile = path.resolve(process.cwd(), String(process.env.FUNDS_SCHEDULER_SIGNOFF_OUTPUT_FILE || '').trim());

async function run(): Promise<void> {
  assert.equal(process.env.FUNDS_SCHEDULER_SIGNOFF_REQUIRE_LIVE_HEALTH, 'true');
  assert.equal(process.env.FUNDS_SCHEDULER_SIGNOFF_REQUIRE_DEPLOYMENT_EVIDENCE, 'true');
  assert.equal(process.env.FUNDS_SCHEDULER_SIGNOFF_REQUIRE_PROMOTION_READY, 'true');
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
    ['--import', 'tsx', 'scripts/proof-funds-scheduler-promotion.ts'],
    {
      ...process.env,
      FUNDS_SCHEDULER_PROMOTION_RELEASE_GATE_SCRIPT: gateScript,
      FUNDS_SCHEDULER_PROMOTION_SIGNOFF_SCRIPT: signoffScript,
      FUNDS_SCHEDULER_RELEASE_GATE_OUTPUT_FILE: gateFile,
      FUNDS_SCHEDULER_SIGNOFF_OUTPUT_FILE: signoffFile,
      FUNDS_SCHEDULER_PROMOTION_OUTPUT_FILE: promotionFile,
      FUNDS_SCHEDULER_SIGNOFF_APPROVER: 'codex-phase11',
      FUNDS_SCHEDULER_SIGNOFF_DIAGNOSTICS_VERIFIED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_COVERAGE_VERIFIED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_PRODUCT_TRUST_VERIFIED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_HEALTH_THRESHOLDS_VERIFIED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_RECOVERY_DRILL_VERIFIED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_ACCESS_REVIEW_VERIFIED: 'true',
      FUNDS_SCHEDULER_SIGNOFF_STAGING_WORKFLOW_URL:
        'https://staging.example.com/workflows/funds-sync',
      FUNDS_SCHEDULER_SIGNOFF_DASHBOARD_URL:
        'https://staging.example.com/dashboards/funds-sync',
      FUNDS_SCHEDULER_SIGNOFF_RELEASE_NOTE_URL:
        'https://staging.example.com/releases/funds-sync',
      FUNDS_SCHEDULER_SIGNOFF_PLACEHOLDER_EVIDENCE_ACKNOWLEDGED: '',
      FUNDS_SCHEDULER_SIGNOFF_UNBOUNDED_THRESHOLDS_ACKNOWLEDGED: '',
    }
  );

  assert.equal(exitCode, 0, 'promotion proof should succeed against a target-ready stub');

  const raw = await readFile(promotionFile, 'utf8');
  const summary = JSON.parse(raw) as {
    decision: string;
    gateDecision: string | null;
    signoffDecision: string | null;
    acknowledgements: Record<string, boolean>;
    readiness: Record<string, unknown>;
    environment: Record<string, unknown>;
  };

  assert.equal(summary.decision, 'ready');
  assert.equal(summary.gateDecision, 'ready');
  assert.equal(summary.signoffDecision, 'ready');
  assert.equal(summary.acknowledgements.placeholderEvidenceUsed, false);
  assert.equal(summary.acknowledgements.unboundedThresholdsUsed, false);
  assert.equal(summary.readiness.productionPromotionReady, true);
  assert.equal(summary.environment.healthBaseUrlKind, 'remote_url');
  assert.equal(summary.environment.targetEnvironmentReady, true);
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
  const proofSource = await readFile(
    path.join(process.cwd(), 'scripts', 'proof-funds-scheduler-promotion.ts'),
    'utf8'
  );
  const operationalAuditSource = await readFile(
    path.join(process.cwd(), 'scripts', 'test-operational-audit.ts'),
    'utf8'
  );
  const packageSource = await readFile(path.join(process.cwd(), 'package.json'), 'utf8');
  const docSource = await readFile(path.join(process.cwd(), 'FUNDS_SCHEDULER_PHASE11.md'), 'utf8');

  assert.equal(
    releaseGateSource.includes('backend-funds-scheduler-phase11'),
    true,
    'release gate must include the Phase 11 funds scheduler suite'
  );
  assert.equal(
    signoffSource.includes('FUNDS_SCHEDULER_SIGNOFF_REQUIRE_PROMOTION_READY'),
    true,
    'signoff must support a strict promotion-ready requirement'
  );
  assert.equal(
    proofSource.includes('funds-scheduler-promotion-proof.json'),
    true,
    'promotion proof must write the Phase 11 promotion artifact'
  );
  assert.equal(
    operationalAuditSource.includes('"proof:funds-scheduler-promotion"'),
    true,
    'operational audit must require the Phase 11 promotion proof workflow'
  );
  assert.equal(
    packageSource.includes('"test:funds-scheduler-phase11"'),
    true,
    'package.json must include the Phase 11 funds scheduler suite'
  );
  assert.equal(
    packageSource.includes('"proof:funds-scheduler-promotion"'),
    true,
    'package.json must include the Phase 11 promotion proof script'
  );
  assert.equal(
    docSource.includes('proof:funds-scheduler-promotion'),
    true,
    'Phase 11 handoff doc must describe the strict promotion proof command'
  );
  assert.equal(
    docSource.includes('localhost'),
    true,
    'Phase 11 handoff doc must describe why localhost proofs do not count as promotion-ready evidence'
  );
}

async function main(): Promise<void> {
  await testSignoffCapturesTargetEnvironmentReadiness();
  await testSignoffPersistsBlockedSummaryWhenPromotionReadyIsRequired();
  await testPromotionProofWritesBlockedArtifactForLocalhostEvidence();
  await testPromotionProofSucceedsWhenTargetEnvironmentIsReady();
  await runSourceMarkerAssertions();
  console.log('Funds scheduler phase 11 assertions passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
