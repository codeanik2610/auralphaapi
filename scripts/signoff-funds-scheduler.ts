import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

type JsonRecord = Record<string, unknown>;
type EvidenceLocationKind =
  | 'missing'
  | 'remote_url'
  | 'localhost_url'
  | 'local_path'
  | 'relative_path'
  | 'invalid';
type ThresholdProfileMode = 'bounded' | 'partial' | 'unbounded' | 'unknown';

type ReleaseGateResult = {
  key: string;
  label: string;
  status: 'passed' | 'failed' | 'skipped';
  reason?: string;
};

type ReleaseGateSummary = {
  decision: 'ready' | 'blocked';
  startedAt?: string;
  finishedAt?: string;
  liveChecksEnabled: boolean;
  healthSnapshotFile?: string | null;
  healthSnapshot: JsonRecord | null;
  totals: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
  };
  results: ReleaseGateResult[];
};

type ThresholdProfile = {
  mode: ThresholdProfileMode;
  configuredThresholdCount: number;
  requiredThresholdCount: number;
  configuredKeys: string[];
  missingKeys: string[];
};

const GATE_FILE = String(
  process.env.FUNDS_SCHEDULER_SIGNOFF_GATE_FILE || 'artifacts/funds-scheduler-release-gate.json'
).trim();
const OUTPUT_FILE = String(
  process.env.FUNDS_SCHEDULER_SIGNOFF_OUTPUT_FILE || 'artifacts/funds-scheduler-signoff.json'
).trim();
const STEP_SUMMARY_FILE = String(process.env.GITHUB_STEP_SUMMARY || '').trim();
const REQUIRE_LIVE_HEALTH =
  String(process.env.FUNDS_SCHEDULER_SIGNOFF_REQUIRE_LIVE_HEALTH || 'false')
    .trim()
    .toLowerCase() === 'true';
const REQUIRE_DEPLOYMENT_EVIDENCE =
  String(process.env.FUNDS_SCHEDULER_SIGNOFF_REQUIRE_DEPLOYMENT_EVIDENCE || 'false')
    .trim()
    .toLowerCase() === 'true';
const REQUIRE_PROMOTION_READY =
  String(process.env.FUNDS_SCHEDULER_SIGNOFF_REQUIRE_PROMOTION_READY || 'false')
    .trim()
    .toLowerCase() === 'true';
const DIAGNOSTICS_VERIFIED =
  String(process.env.FUNDS_SCHEDULER_SIGNOFF_DIAGNOSTICS_VERIFIED || '')
    .trim()
    .toLowerCase() === 'true';
const COVERAGE_VERIFIED =
  String(process.env.FUNDS_SCHEDULER_SIGNOFF_COVERAGE_VERIFIED || '')
    .trim()
    .toLowerCase() === 'true';
const PRODUCT_TRUST_VERIFIED =
  String(process.env.FUNDS_SCHEDULER_SIGNOFF_PRODUCT_TRUST_VERIFIED || '')
    .trim()
    .toLowerCase() === 'true';
const HEALTH_THRESHOLDS_VERIFIED =
  String(process.env.FUNDS_SCHEDULER_SIGNOFF_HEALTH_THRESHOLDS_VERIFIED || '')
    .trim()
    .toLowerCase() === 'true';
const RECOVERY_DRILL_VERIFIED =
  String(process.env.FUNDS_SCHEDULER_SIGNOFF_RECOVERY_DRILL_VERIFIED || '')
    .trim()
    .toLowerCase() === 'true';
const ACCESS_REVIEW_VERIFIED =
  String(process.env.FUNDS_SCHEDULER_SIGNOFF_ACCESS_REVIEW_VERIFIED || '')
    .trim()
    .toLowerCase() === 'true';
const PLACEHOLDER_EVIDENCE_ACKNOWLEDGED =
  String(process.env.FUNDS_SCHEDULER_SIGNOFF_PLACEHOLDER_EVIDENCE_ACKNOWLEDGED || '')
    .trim()
    .toLowerCase() === 'true';
const UNBOUNDED_THRESHOLDS_ACKNOWLEDGED =
  String(process.env.FUNDS_SCHEDULER_SIGNOFF_UNBOUNDED_THRESHOLDS_ACKNOWLEDGED || '')
    .trim()
    .toLowerCase() === 'true';
const APPROVER = String(process.env.FUNDS_SCHEDULER_SIGNOFF_APPROVER || '').trim();
const STAGING_WORKFLOW_URL = String(
  process.env.FUNDS_SCHEDULER_SIGNOFF_STAGING_WORKFLOW_URL ||
    process.env.FUNDS_SCHEDULER_SIGNOFF_WORKFLOW_URL ||
    ''
).trim();
const DASHBOARD_URL = String(process.env.FUNDS_SCHEDULER_SIGNOFF_DASHBOARD_URL || '').trim();
const RUNBOOK_URL = String(process.env.FUNDS_SCHEDULER_SIGNOFF_RUNBOOK_URL || '').trim();
const RELEASE_NOTE_URL = String(process.env.FUNDS_SCHEDULER_SIGNOFF_RELEASE_NOTE_URL || '').trim();

function asRecord(value: unknown): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as JsonRecord;
}

function readString(value: unknown): string {
  return String(value || '').trim();
}

function readNumber(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    throw new Error(`Expected finite number, received ${String(value)}`);
  }
  return numeric;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => readString(item)).filter(Boolean) : [];
}

function isLocalHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '0.0.0.0' ||
    normalized === '::1' ||
    normalized === '[::1]'
  );
}

function classifyEvidenceLocation(value: string): EvidenceLocationKind {
  const normalized = readString(value);
  if (!normalized) {
    return 'missing';
  }
  if (path.isAbsolute(normalized)) {
    return 'local_path';
  }

  try {
    const parsed = new URL(normalized);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return isLocalHost(parsed.hostname) ? 'localhost_url' : 'remote_url';
    }
    return 'invalid';
  } catch {
    return normalized.includes('/') ? 'relative_path' : 'invalid';
  }
}

function deriveThresholdProfile(healthSnapshot: JsonRecord | null): ThresholdProfile {
  const thresholdProfile = asRecord(asRecord(healthSnapshot).thresholdProfile);
  const thresholdKeys = [
    'maxStaleAccounts',
    'maxMissingAccounts',
    'maxFailedLatestAttempts',
    'maxLatestSnapshotAgeMinutes',
    'maxLatestAttemptAgeMinutes',
  ];

  const configuredKeysFromProfile = readStringArray(thresholdProfile.configuredKeys);
  const missingKeysFromProfile = readStringArray(thresholdProfile.missingKeys);

  if (configuredKeysFromProfile.length > 0 || missingKeysFromProfile.length > 0) {
    const mode = readString(thresholdProfile.mode);
    return {
      mode:
        mode === 'bounded' || mode === 'partial' || mode === 'unbounded'
          ? mode
          : 'unknown',
      configuredThresholdCount:
        thresholdProfile.configuredThresholdCount === undefined
          ? configuredKeysFromProfile.length
          : readNumber(thresholdProfile.configuredThresholdCount),
      requiredThresholdCount:
        thresholdProfile.requiredThresholdCount === undefined
          ? configuredKeysFromProfile.length + missingKeysFromProfile.length
          : readNumber(thresholdProfile.requiredThresholdCount),
      configuredKeys: configuredKeysFromProfile,
      missingKeys: missingKeysFromProfile,
    };
  }

  const thresholds = asRecord(asRecord(healthSnapshot).thresholds);
  const configuredKeys = thresholdKeys.filter((key) => {
    const value = thresholds[key];
    return value !== null && value !== undefined && value !== '';
  });
  const missingKeys = thresholdKeys.filter((key) => !configuredKeys.includes(key));

  return {
    mode:
      configuredKeys.length === 0
        ? 'unbounded'
        : configuredKeys.length === thresholdKeys.length
          ? 'bounded'
          : 'partial',
    configuredThresholdCount: configuredKeys.length,
    requiredThresholdCount: thresholdKeys.length,
    configuredKeys,
    missingKeys,
  };
}

async function readGateSummary(): Promise<ReleaseGateSummary> {
  const absoluteGateFile = path.resolve(process.cwd(), GATE_FILE);
  const raw = await readFile(absoluteGateFile, 'utf8');
  const parsed = JSON.parse(raw) as JsonRecord;
  const totals = asRecord(parsed.totals);

  return {
    decision: readString(parsed.decision) === 'blocked' ? 'blocked' : 'ready',
    startedAt: readString(parsed.startedAt) || undefined,
    finishedAt: readString(parsed.finishedAt) || undefined,
    liveChecksEnabled: parsed.liveChecksEnabled === true,
    healthSnapshotFile: readString(parsed.healthSnapshotFile) || null,
    healthSnapshot:
      parsed.healthSnapshot && typeof parsed.healthSnapshot === 'object'
        ? asRecord(parsed.healthSnapshot)
        : null,
    totals: {
      total: readNumber(totals.total),
      passed: readNumber(totals.passed),
      failed: readNumber(totals.failed),
      skipped: readNumber(totals.skipped),
    },
    results: Array.isArray(parsed.results)
      ? parsed.results.map((item) => {
          const result = asRecord(item);
          return {
            key: readString(result.key),
            label: readString(result.label),
            status:
              readString(result.status) === 'failed'
                ? 'failed'
                : readString(result.status) === 'skipped'
                  ? 'skipped'
                  : 'passed',
            reason: readString(result.reason) || undefined,
          };
        })
      : [],
  };
}

async function persistSummary(summary: Record<string, unknown>): Promise<void> {
  if (!OUTPUT_FILE) {
    return;
  }

  const absoluteOutputPath = path.resolve(process.cwd(), OUTPUT_FILE);
  await mkdir(path.dirname(absoluteOutputPath), { recursive: true });
  await writeFile(absoluteOutputPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
}

async function writeStepSummary(summary: {
  decision: 'ready' | 'blocked';
  gateFile: string;
  approver: string | null;
  checks: Record<string, boolean>;
  readiness: Record<string, unknown>;
  acknowledgements: Record<string, boolean>;
  thresholdProfile: ThresholdProfile;
  evidence: Record<string, string | null>;
  evidenceClassification: Record<string, string>;
  environment: Record<string, string | boolean | null>;
  gate: ReleaseGateSummary;
}): Promise<void> {
  if (!STEP_SUMMARY_FILE) {
    return;
  }

  const scheduler = asRecord(summary.gate.healthSnapshot).scheduler
    ? asRecord(asRecord(summary.gate.healthSnapshot).scheduler)
    : {};

  const lines = [
    '## Funds scheduler final sign-off',
    '',
    `- Decision: **${summary.decision}**`,
    `- Gate file: \`${summary.gateFile}\``,
    `- Approver: ${summary.approver || 'n/a'}`,
    '',
    '### Checks',
    '',
    `- release gate decision is ready: ${summary.checks.gateReady ? 'yes' : 'no'}`,
    `- required funds scheduler suites passed: ${summary.checks.requiredSuitesPassed ? 'yes' : 'no'}`,
    `- live scheduler and portfolio health reviewed: ${summary.checks.liveHealthReviewed ? 'yes' : 'no'}`,
    `- threshold posture captured: ${summary.checks.thresholdPostureCaptured ? 'yes' : 'no'}`,
    `- placeholder evidence acknowledged: ${summary.checks.placeholderEvidenceAcknowledged ? 'yes' : 'no'}`,
    `- unbounded thresholds acknowledged: ${summary.checks.unboundedThresholdsAcknowledged ? 'yes' : 'no'}`,
    `- admin diagnostics verified: ${summary.checks.diagnosticsVerified ? 'yes' : 'no'}`,
    `- per-account coverage verified: ${summary.checks.coverageVerified ? 'yes' : 'no'}`,
    `- downstream product trust verified: ${summary.checks.productTrustVerified ? 'yes' : 'no'}`,
    `- stale and missing health thresholds verified: ${summary.checks.healthThresholdsVerified ? 'yes' : 'no'}`,
    `- scoped recovery drill verified: ${summary.checks.recoveryDrillVerified ? 'yes' : 'no'}`,
    `- admin access review verified: ${summary.checks.accessReviewVerified ? 'yes' : 'no'}`,
    '',
    '### Readiness',
    '',
    `- deployment evidence ready: ${summary.readiness.deploymentEvidenceReady === true ? 'yes' : 'no'}`,
    `- threshold profile mode: ${summary.thresholdProfile.mode}`,
    `- target environment ready: ${summary.readiness.targetEnvironmentReady === true ? 'yes' : 'no'}`,
    `- production promotion ready: ${summary.readiness.productionPromotionReady === true ? 'yes' : 'no'}`,
    `- placeholder acknowledgement used: ${summary.acknowledgements.placeholderEvidenceUsed ? 'yes' : 'no'}`,
    `- unbounded-threshold acknowledgement used: ${summary.acknowledgements.unboundedThresholdsUsed ? 'yes' : 'no'}`,
    '',
    '### Evidence',
    '',
    `- staging workflow: ${summary.evidence.stagingWorkflowUrl || 'n/a'} (${summary.evidenceClassification.stagingWorkflowUrlKind || 'missing'})`,
    `- dashboard URL: ${summary.evidence.dashboardUrl || 'n/a'} (${summary.evidenceClassification.dashboardUrlKind || 'missing'})`,
    `- runbook URL: ${summary.evidence.runbookUrl || 'n/a'} (${summary.evidenceClassification.runbookUrlKind || 'missing'})`,
    `- release note URL: ${summary.evidence.releaseNoteUrl || 'n/a'} (${summary.evidenceClassification.releaseNoteUrlKind || 'missing'})`,
    '',
    '### Live health snapshot',
    '',
    `- health snapshot file: ${summary.gate.healthSnapshotFile || 'n/a'}`,
    `- health base URL: ${summary.environment.healthBaseUrl || 'n/a'} (${summary.environment.healthBaseUrlKind || 'missing'})`,
    `- totalConnectedAccounts: ${readNumber(scheduler.totalConnectedAccounts || 0)}`,
    `- fresh accounts: ${readNumber(scheduler.accountsWithFreshSnapshot || 0)}`,
    `- stale accounts: ${readNumber(scheduler.accountsWithStaleSnapshot || 0)}`,
    `- missing accounts: ${readNumber(scheduler.accountsMissingSnapshot || 0)}`,
    `- failed latest attempts: ${readNumber(scheduler.accountsWithFailedLatestAttempt || 0)}`,
    '',
    '### Gate totals',
    '',
    `- passed: ${summary.gate.totals.passed}`,
    `- failed: ${summary.gate.totals.failed}`,
    `- skipped: ${summary.gate.totals.skipped}`,
    '',
  ];

  await writeFile(STEP_SUMMARY_FILE, `${lines.join('\n')}\n`, 'utf8');
}

async function run(): Promise<void> {
  const gate = await readGateSummary();
  const resultsByKey = new Map(gate.results.map((result) => [result.key, result]));
  const requiredGateKeys = [
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
  ];

  const requiredSuitesPassed = requiredGateKeys.every(
    (key) => resultsByKey.get(key)?.status === 'passed'
  );
  const liveHealthReviewed = REQUIRE_LIVE_HEALTH
    ? resultsByKey.get('backend-funds-scheduler-health')?.status === 'passed' &&
      resultsByKey.get('backend-portfolio-health')?.status === 'passed'
    : true;

  const thresholdProfile = deriveThresholdProfile(gate.healthSnapshot);
  const stagingWorkflowUrlKind = classifyEvidenceLocation(STAGING_WORKFLOW_URL);
  const dashboardUrlKind = classifyEvidenceLocation(DASHBOARD_URL);
  const runbookUrlKind = classifyEvidenceLocation(RUNBOOK_URL);
  const releaseNoteUrlKind = classifyEvidenceLocation(RELEASE_NOTE_URL);
  const healthBaseUrl = readString(asRecord(gate.healthSnapshot).baseUrl);
  const healthBaseUrlKind = classifyEvidenceLocation(healthBaseUrl);
  const targetEnvironmentReady = healthBaseUrlKind === 'remote_url';
  const deploymentEvidenceReady =
    stagingWorkflowUrlKind === 'remote_url' &&
    dashboardUrlKind === 'remote_url' &&
    releaseNoteUrlKind === 'remote_url';
  const acknowledgements = {
    placeholderEvidenceUsed: PLACEHOLDER_EVIDENCE_ACKNOWLEDGED,
    unboundedThresholdsUsed: UNBOUNDED_THRESHOLDS_ACKNOWLEDGED,
  };

  const checks = {
    gateReady: gate.decision === 'ready' && gate.totals.failed === 0,
    requiredSuitesPassed,
    liveHealthReviewed,
    thresholdPostureCaptured:
      REQUIRE_LIVE_HEALTH === false || Boolean(gate.healthSnapshot && Object.keys(gate.healthSnapshot).length > 0),
    placeholderEvidenceAcknowledged:
      deploymentEvidenceReady || PLACEHOLDER_EVIDENCE_ACKNOWLEDGED,
    unboundedThresholdsAcknowledged:
      REQUIRE_LIVE_HEALTH === false ||
      thresholdProfile.mode === 'bounded' ||
      UNBOUNDED_THRESHOLDS_ACKNOWLEDGED,
    diagnosticsVerified: DIAGNOSTICS_VERIFIED,
    coverageVerified: COVERAGE_VERIFIED,
    productTrustVerified: PRODUCT_TRUST_VERIFIED,
    healthThresholdsVerified: HEALTH_THRESHOLDS_VERIFIED,
    recoveryDrillVerified: RECOVERY_DRILL_VERIFIED,
    accessReviewVerified: ACCESS_REVIEW_VERIFIED,
  };

  const readiness = {
    deploymentEvidenceReady,
    thresholdProfileMode: thresholdProfile.mode,
    targetEnvironmentReady,
    healthBaseUrlKind,
    productionPromotionReady:
      checks.gateReady &&
      checks.requiredSuitesPassed &&
      checks.liveHealthReviewed &&
      checks.diagnosticsVerified &&
      checks.coverageVerified &&
      checks.productTrustVerified &&
      checks.healthThresholdsVerified &&
      checks.recoveryDrillVerified &&
      checks.accessReviewVerified &&
      deploymentEvidenceReady &&
      targetEnvironmentReady &&
      thresholdProfile.mode === 'bounded' &&
      acknowledgements.placeholderEvidenceUsed === false &&
      acknowledgements.unboundedThresholdsUsed === false,
  };

  const blockingReasons: string[] = [];
  if (!checks.gateReady) {
    blockingReasons.push('release gate must be ready with zero failed checks');
  }
  if (!checks.requiredSuitesPassed) {
    blockingReasons.push(
      'required funds scheduler backend, UI, lint, and audit checks must all pass'
    );
  }
  if (!checks.liveHealthReviewed) {
    blockingReasons.push(
      'live funds scheduler and portfolio health must be reviewed when FUNDS_SCHEDULER_SIGNOFF_REQUIRE_LIVE_HEALTH is true'
    );
  }
  if (!checks.thresholdPostureCaptured) {
    blockingReasons.push(
      'the funds scheduler signoff must capture the live health threshold posture when live health is required'
    );
  }
  if (!checks.placeholderEvidenceAcknowledged) {
    blockingReasons.push(
      'localhost or placeholder funds scheduler evidence must be explicitly acknowledged before final sign-off'
    );
  }
  if (!checks.unboundedThresholdsAcknowledged) {
    blockingReasons.push(
      'unbounded funds scheduler thresholds must be explicitly acknowledged before final sign-off'
    );
  }
  if (!checks.diagnosticsVerified) {
    blockingReasons.push(
      'admin funds scheduler diagnostics must be explicitly verified before final sign-off'
    );
  }
  if (!checks.coverageVerified) {
    blockingReasons.push('per-account funds coverage must be explicitly verified before final sign-off');
  }
  if (!checks.productTrustVerified) {
    blockingReasons.push(
      'downstream funds snapshot trust alignment must be explicitly verified before final sign-off'
    );
  }
  if (!checks.healthThresholdsVerified) {
    blockingReasons.push(
      'stale and missing health thresholds must be explicitly verified before final funds scheduler sign-off'
    );
  }
  if (!checks.recoveryDrillVerified) {
    blockingReasons.push(
      'scoped recovery drill must be explicitly verified before final funds scheduler sign-off'
    );
  }
  if (!checks.accessReviewVerified) {
    blockingReasons.push(
      'admin-only access review must be explicitly verified before final funds scheduler sign-off'
    );
  }
  if (REQUIRE_DEPLOYMENT_EVIDENCE && !deploymentEvidenceReady) {
    blockingReasons.push(
      'remote staging or production evidence is required when FUNDS_SCHEDULER_SIGNOFF_REQUIRE_DEPLOYMENT_EVIDENCE is true'
    );
  }
  if (REQUIRE_PROMOTION_READY && !readiness.productionPromotionReady) {
    blockingReasons.push(
      'target-environment funds promotion proof requires remote live health, remote deployment evidence, bounded thresholds, and no placeholder acknowledgements'
    );
  }

  const summary = {
    decision: (blockingReasons.length === 0 ? 'ready' : 'blocked') as 'ready' | 'blocked',
    generatedAt: new Date().toISOString(),
    gateFile: path.resolve(process.cwd(), GATE_FILE),
    approver: APPROVER || null,
    checks,
    readiness,
    acknowledgements,
    thresholdProfile,
    evidence: {
      stagingWorkflowUrl: STAGING_WORKFLOW_URL || null,
      workflowUrl: STAGING_WORKFLOW_URL || null,
      dashboardUrl: DASHBOARD_URL || null,
      runbookUrl: RUNBOOK_URL || null,
      releaseNoteUrl: RELEASE_NOTE_URL || null,
    },
    evidenceClassification: {
      stagingWorkflowUrlKind,
      dashboardUrlKind,
      runbookUrlKind,
      releaseNoteUrlKind,
    },
    environment: {
      healthBaseUrl: healthBaseUrl || null,
      healthBaseUrlKind,
      targetEnvironmentReady,
    },
    gate,
  };

  await persistSummary(summary);
  await writeStepSummary(summary);
  if (blockingReasons.length > 0) {
    throw new Error(blockingReasons[0]);
  }
  console.log('funds-scheduler-signoff:', JSON.stringify(summary));
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
