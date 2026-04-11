import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  buildAssetPriceSyncHealthThresholdProfile,
  resolveAssetPriceSyncHealthThresholds,
} from './check-asset-price-sync-health';

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

type ProofSummary = {
  decision: 'ready' | 'blocked';
  gateDecision?: string | null;
  healthSnapshot?: JsonRecord | null;
};

type ThresholdProfile = {
  mode: ThresholdProfileMode;
  configuredThresholdCount: number;
  requiredThresholdCount: number;
  configuredKeys: string[];
  missingKeys: string[];
};

const EXPECTED_SOURCES = ['mudrex', 'delta_exchange'];
const GATE_FILE = String(
  process.env.ASSET_PRICE_SYNC_SIGNOFF_GATE_FILE ||
    'artifacts/asset-price-sync-release-gate.json'
).trim();
const PROOF_FILE = String(
  process.env.ASSET_PRICE_SYNC_SIGNOFF_PROOF_FILE ||
    'artifacts/asset-price-sync-live-proof.json'
).trim();
const OUTPUT_FILE = String(
  process.env.ASSET_PRICE_SYNC_SIGNOFF_OUTPUT_FILE ||
    'artifacts/asset-price-sync-signoff.json'
).trim();
const STEP_SUMMARY_FILE = String(process.env.GITHUB_STEP_SUMMARY || '').trim();
const REQUIRE_LIVE_HEALTH =
  String(process.env.ASSET_PRICE_SYNC_SIGNOFF_REQUIRE_LIVE_HEALTH || 'false')
    .trim()
    .toLowerCase() === 'true';
const REQUIRE_LIVE_PROOF =
  String(process.env.ASSET_PRICE_SYNC_SIGNOFF_REQUIRE_LIVE_PROOF || 'false')
    .trim()
    .toLowerCase() === 'true';
const REQUIRE_DEPLOYMENT_EVIDENCE =
  String(process.env.ASSET_PRICE_SYNC_SIGNOFF_REQUIRE_DEPLOYMENT_EVIDENCE || 'false')
    .trim()
    .toLowerCase() === 'true';
const OPERATOR_WORKSPACE_REVIEWED =
  String(process.env.ASSET_PRICE_SYNC_SIGNOFF_OPERATOR_WORKSPACE_REVIEWED || '')
    .trim()
    .toLowerCase() === 'true';
const RUN_SCOPE_OVERRIDE_REVIEWED =
  String(process.env.ASSET_PRICE_SYNC_SIGNOFF_RUN_SCOPE_OVERRIDE_REVIEWED || '')
    .trim()
    .toLowerCase() === 'true';
const BROKER_ASSET_ID_REVIEWED =
  String(process.env.ASSET_PRICE_SYNC_SIGNOFF_BROKER_ASSET_ID_REVIEWED || '')
    .trim()
    .toLowerCase() === 'true';
const SYSTEM_SOURCES_REVIEWED =
  String(process.env.ASSET_PRICE_SYNC_SIGNOFF_SYSTEM_SOURCES_REVIEWED || '')
    .trim()
    .toLowerCase() === 'true';
const TIME_AUDIT_REVIEWED =
  String(process.env.ASSET_PRICE_SYNC_SIGNOFF_TIME_AUDIT_REVIEWED || '')
    .trim()
    .toLowerCase() === 'true';
const PLACEHOLDER_EVIDENCE_ACKNOWLEDGED =
  String(process.env.ASSET_PRICE_SYNC_SIGNOFF_PLACEHOLDER_EVIDENCE_ACKNOWLEDGED || '')
    .trim()
    .toLowerCase() === 'true';
const UNBOUNDED_THRESHOLDS_ACKNOWLEDGED =
  String(process.env.ASSET_PRICE_SYNC_SIGNOFF_UNBOUNDED_THRESHOLDS_ACKNOWLEDGED || '')
    .trim()
    .toLowerCase() === 'true';
const APPROVER = String(process.env.ASSET_PRICE_SYNC_SIGNOFF_APPROVER || '').trim();
const STAGING_WORKFLOW_URL = String(
  process.env.ASSET_PRICE_SYNC_SIGNOFF_STAGING_WORKFLOW_URL ||
    process.env.ASSET_PRICE_SYNC_SIGNOFF_WORKFLOW_URL ||
    ''
).trim();
const DASHBOARD_URL = String(process.env.ASSET_PRICE_SYNC_SIGNOFF_DASHBOARD_URL || '').trim();
const RUNBOOK_URL = String(process.env.ASSET_PRICE_SYNC_SIGNOFF_RUNBOOK_URL || '').trim();
const RELEASE_NOTE_URL = String(process.env.ASSET_PRICE_SYNC_SIGNOFF_RELEASE_NOTE_URL || '').trim();

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

function isEvidenceReady(kind: EvidenceLocationKind): boolean {
  return kind === 'remote_url' || kind === 'local_path' || kind === 'relative_path';
}

function isSkippedForMissingCwd(result: ReleaseGateResult | undefined): boolean {
  return result?.status === 'skipped' && readString(result.reason).startsWith('cwd not found:');
}

function deriveThresholdProfile(healthSnapshot: JsonRecord | null): ThresholdProfile {
  const profile = asRecord(asRecord(healthSnapshot).thresholdProfile);
  if (Object.keys(profile).length > 0) {
    const mode = readString(profile.mode);
    return {
      mode:
        mode === 'bounded' || mode === 'partial' || mode === 'unbounded' ? mode : 'unknown',
      configuredThresholdCount: readNumber(profile.configuredThresholdCount),
      requiredThresholdCount: readNumber(profile.requiredThresholdCount),
      configuredKeys: readStringArray(profile.configuredKeys),
      missingKeys: readStringArray(profile.missingKeys),
    };
  }

  const fallback = buildAssetPriceSyncHealthThresholdProfile(
    resolveAssetPriceSyncHealthThresholds()
  );
  return {
    mode: fallback.mode,
    configuredThresholdCount: fallback.configuredThresholdCount,
    requiredThresholdCount: fallback.requiredThresholdCount,
    configuredKeys: fallback.configuredKeys,
    missingKeys: fallback.missingKeys,
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

async function readOptionalProofSummary(): Promise<ProofSummary | null> {
  const absoluteProofFile = path.resolve(process.cwd(), PROOF_FILE);

  try {
    const raw = await readFile(absoluteProofFile, 'utf8');
    const parsed = JSON.parse(raw) as JsonRecord;
    return {
      decision: readString(parsed.decision) === 'blocked' ? 'blocked' : 'ready',
      gateDecision: readString(parsed.gateDecision) || null,
      healthSnapshot:
        parsed.healthSnapshot && typeof parsed.healthSnapshot === 'object'
          ? asRecord(parsed.healthSnapshot)
          : null,
    };
  } catch {
    return null;
  }
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
  proofFile: string | null;
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

  const lines = [
    '## Asset price sync final sign-off',
    '',
    `- Decision: **${summary.decision}**`,
    `- Gate file: \`${summary.gateFile}\``,
    `- Proof file: ${summary.proofFile ? `\`${summary.proofFile}\`` : 'n/a'}`,
    `- Approver: ${summary.approver || 'n/a'}`,
    '',
    '### Checks',
    '',
    `- release gate decision is ready: ${summary.checks.gateReady ? 'yes' : 'no'}`,
    `- required backend suites passed: ${summary.checks.requiredSuitesPassed ? 'yes' : 'no'}`,
    `- cross-repo suites passed or are unavailable: ${summary.checks.crossRepoSuitesPassed ? 'yes' : 'no'}`,
    `- live gate health reviewed: ${summary.checks.liveHealthReviewed ? 'yes' : 'no'}`,
    `- live proof reviewed: ${summary.checks.liveProofReviewed ? 'yes' : 'no'}`,
    `- threshold posture captured: ${summary.checks.thresholdPostureCaptured ? 'yes' : 'no'}`,
    `- operator workspace reviewed: ${summary.checks.operatorWorkspaceReviewed ? 'yes' : 'no'}`,
    `- run-scope override reviewed: ${summary.checks.runScopeOverrideReviewed ? 'yes' : 'no'}`,
    `- broker-asset-id mapping reviewed: ${summary.checks.brokerAssetIdReviewed ? 'yes' : 'no'}`,
    `- system-source contract reviewed: ${summary.checks.systemSourcesReviewed ? 'yes' : 'no'}`,
    `- time/audit display reviewed: ${summary.checks.timeAuditReviewed ? 'yes' : 'no'}`,
    `- placeholder evidence acknowledged: ${summary.checks.placeholderEvidenceAcknowledged ? 'yes' : 'no'}`,
    `- unbounded thresholds acknowledged: ${summary.checks.unboundedThresholdsAcknowledged ? 'yes' : 'no'}`,
    '',
    '### Readiness',
    '',
    `- deployment evidence ready: ${summary.readiness.deploymentEvidenceReady === true ? 'yes' : 'no'}`,
    `- threshold profile mode: ${summary.thresholdProfile.mode}`,
    `- live gate ready: ${summary.readiness.liveGateReady === true ? 'yes' : 'no'}`,
    `- live proof ready: ${summary.readiness.liveProofReady === true ? 'yes' : 'no'}`,
    `- cross-repo proof ready: ${summary.readiness.crossRepoProofReady === true ? 'yes' : 'no'}`,
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
  const proof = REQUIRE_LIVE_PROOF ? await readOptionalProofSummary() : null;
  const resultsByKey = new Map(gate.results.map((result) => [result.key, result]));
  const requiredGateKeys = [
    'backend-asset-price-sync-phase1',
    'backend-asset-price-sync-phase2',
    'backend-asset-price-sync-phase3',
    'backend-asset-price-sync-phase4',
    'backend-asset-price-sync-phase5',
    'backend-asset-price-sync-phase6',
    'backend-asset-price-sync-phase7',
    'backend-asset-price-sync-phase8',
    'backend-asset-price-sync-phase9',
    'backend-asset-price-sync-global-regression',
    'backend-asset-price-sync-operational-audit',
    'backend-asset-price-sync-eslint',
  ];
  const optionalCrossRepoKeys = [
    'worker-asset-price-sync-build',
    'frontend-asset-price-sync-ui',
    'frontend-asset-price-sync-eslint',
  ];
  const requiredSuitesPassed = requiredGateKeys.every(
    (key) => resultsByKey.get(key)?.status === 'passed'
  );
  const crossRepoSuitesPassed = optionalCrossRepoKeys.every((key) => {
    const result = resultsByKey.get(key);
    return result?.status === 'passed' || isSkippedForMissingCwd(result);
  });
  const liveHealthReviewed = REQUIRE_LIVE_HEALTH
    ? gate.liveChecksEnabled === true &&
      resultsByKey.get('backend-asset-price-sync-live-health')?.status === 'passed'
    : true;
  const liveProofReviewed = REQUIRE_LIVE_PROOF
    ? proof?.decision === 'ready' && readString(proof.gateDecision || gate.decision) === 'ready'
    : true;
  const healthSnapshot = gate.healthSnapshot || proof?.healthSnapshot || null;
  const thresholdProfile = deriveThresholdProfile(healthSnapshot);
  const healthSources = readStringArray(asRecord(healthSnapshot).schedulerSources);

  const evidence = {
    stagingWorkflowUrl: STAGING_WORKFLOW_URL || null,
    dashboardUrl: DASHBOARD_URL || null,
    runbookUrl: RUNBOOK_URL || null,
    releaseNoteUrl: RELEASE_NOTE_URL || null,
  };
  const evidenceClassification = {
    stagingWorkflowUrlKind: classifyEvidenceLocation(STAGING_WORKFLOW_URL),
    dashboardUrlKind: classifyEvidenceLocation(DASHBOARD_URL),
    runbookUrlKind: classifyEvidenceLocation(RUNBOOK_URL),
    releaseNoteUrlKind: classifyEvidenceLocation(RELEASE_NOTE_URL),
  };
  const deploymentEvidenceReady = Object.values(evidenceClassification).every((kind) =>
    isEvidenceReady(kind as EvidenceLocationKind)
  );

  const checks = {
    gateReady: gate.decision === 'ready' && gate.totals.failed === 0,
    requiredSuitesPassed,
    crossRepoSuitesPassed,
    liveHealthReviewed,
    liveProofReviewed,
    thresholdPostureCaptured: thresholdProfile.mode !== 'unknown',
    operatorWorkspaceReviewed: OPERATOR_WORKSPACE_REVIEWED,
    runScopeOverrideReviewed: RUN_SCOPE_OVERRIDE_REVIEWED,
    brokerAssetIdReviewed: BROKER_ASSET_ID_REVIEWED,
    systemSourcesReviewed:
      SYSTEM_SOURCES_REVIEWED &&
      EXPECTED_SOURCES.every((source) => healthSources.includes(source)),
    timeAuditReviewed: TIME_AUDIT_REVIEWED,
    placeholderEvidenceAcknowledged:
      deploymentEvidenceReady || PLACEHOLDER_EVIDENCE_ACKNOWLEDGED,
    unboundedThresholdsAcknowledged:
      thresholdProfile.mode !== 'unbounded' || UNBOUNDED_THRESHOLDS_ACKNOWLEDGED,
  };

  assert.equal(checks.gateReady, true, 'release gate must be ready with zero failed checks');
  assert.equal(
    checks.requiredSuitesPassed,
    true,
    'required asset-price-sync backend suites must all pass'
  );
  assert.equal(
    checks.crossRepoSuitesPassed,
    true,
    'frontend and worker validation must pass when those repos are available'
  );
  assert.equal(
    checks.liveHealthReviewed,
    true,
    'live asset-price-sync health must be reviewed when ASSET_PRICE_SYNC_SIGNOFF_REQUIRE_LIVE_HEALTH is true'
  );
  assert.equal(
    checks.liveProofReviewed,
    true,
    'asset-price-sync live proof must be reviewed when ASSET_PRICE_SYNC_SIGNOFF_REQUIRE_LIVE_PROOF is true'
  );
  assert.equal(
    checks.thresholdPostureCaptured,
    true,
    'asset-price-sync threshold posture must be captured before sign-off'
  );
  assert.equal(
    checks.operatorWorkspaceReviewed,
    true,
    'asset-price operator workspace must be explicitly reviewed before sign-off'
  );
  assert.equal(
    checks.runScopeOverrideReviewed,
    true,
    'asset-price run-scope override behavior must be explicitly reviewed before sign-off'
  );
  assert.equal(
    checks.brokerAssetIdReviewed,
    true,
    'asset-price broker-asset-id writes must be explicitly reviewed before sign-off'
  );
  assert.equal(
    checks.systemSourcesReviewed,
    true,
    'asset-price system-source contract must be explicitly reviewed before sign-off'
  );
  assert.equal(
    checks.timeAuditReviewed,
    true,
    'asset-price time and audit display behavior must be explicitly reviewed before sign-off'
  );

  if (REQUIRE_DEPLOYMENT_EVIDENCE) {
    assert.equal(
      deploymentEvidenceReady,
      true,
      'deployment evidence links must be provided when ASSET_PRICE_SYNC_SIGNOFF_REQUIRE_DEPLOYMENT_EVIDENCE is true'
    );
  } else {
    assert.equal(
      checks.placeholderEvidenceAcknowledged,
      true,
      'placeholder evidence must be acknowledged when deployment evidence links are not all provided'
    );
  }

  assert.equal(
    checks.unboundedThresholdsAcknowledged,
    true,
    'unbounded asset-price-sync thresholds must be explicitly acknowledged before sign-off'
  );

  const summary = {
    decision: 'ready' as const,
    generatedAt: new Date().toISOString(),
    gateFile: path.resolve(process.cwd(), GATE_FILE),
    proofFile: proof ? path.resolve(process.cwd(), PROOF_FILE) : null,
    approver: APPROVER || null,
    checks,
    readiness: {
      deploymentEvidenceReady,
      thresholdProfileMode: thresholdProfile.mode,
      liveGateReady:
        gate.liveChecksEnabled === true &&
        resultsByKey.get('backend-asset-price-sync-live-health')?.status === 'passed',
      liveProofReady: proof?.decision === 'ready' || false,
      crossRepoProofReady: crossRepoSuitesPassed,
      productionPromotionReady:
        checks.gateReady &&
        checks.requiredSuitesPassed &&
        checks.crossRepoSuitesPassed &&
        checks.liveHealthReviewed &&
        checks.liveProofReviewed &&
        checks.thresholdPostureCaptured &&
        checks.operatorWorkspaceReviewed &&
        checks.runScopeOverrideReviewed &&
        checks.brokerAssetIdReviewed &&
        checks.systemSourcesReviewed &&
        checks.timeAuditReviewed &&
        checks.placeholderEvidenceAcknowledged &&
        checks.unboundedThresholdsAcknowledged,
    },
    acknowledgements: {
      placeholderEvidenceUsed: deploymentEvidenceReady === false,
      unboundedThresholdsUsed: thresholdProfile.mode === 'unbounded',
    },
    thresholdProfile,
    evidence,
    evidenceClassification,
    environment: {
      requireLiveHealth: REQUIRE_LIVE_HEALTH,
      requireLiveProof: REQUIRE_LIVE_PROOF,
      requireDeploymentEvidence: REQUIRE_DEPLOYMENT_EVIDENCE,
      gateFile: path.resolve(process.cwd(), GATE_FILE),
      proofFile: proof ? path.resolve(process.cwd(), PROOF_FILE) : null,
    },
    gate,
    proof,
  };

  await persistSummary(summary);
  await writeStepSummary(summary);
  console.log('asset-price-sync-signoff:', JSON.stringify(summary));
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
