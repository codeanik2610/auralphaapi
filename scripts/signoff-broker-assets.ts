import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  buildBrokerAssetsHealthThresholdProfile,
  resolveBrokerAssetsHealthThresholds,
} from './check-broker-assets-health';

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

const GATE_FILE = String(
  process.env.BROKER_ASSETS_SIGNOFF_GATE_FILE || 'artifacts/broker-assets-release-gate.json'
).trim();
const PROOF_FILE = String(
  process.env.BROKER_ASSETS_SIGNOFF_PROOF_FILE || 'artifacts/broker-assets-live-proof.json'
).trim();
const OUTPUT_FILE = String(
  process.env.BROKER_ASSETS_SIGNOFF_OUTPUT_FILE || 'artifacts/broker-assets-signoff.json'
).trim();
const STEP_SUMMARY_FILE = String(process.env.GITHUB_STEP_SUMMARY || '').trim();
const REQUIRE_LIVE_HEALTH =
  String(process.env.BROKER_ASSETS_SIGNOFF_REQUIRE_LIVE_HEALTH || 'false')
    .trim()
    .toLowerCase() === 'true';
const REQUIRE_LIVE_PROOF =
  String(process.env.BROKER_ASSETS_SIGNOFF_REQUIRE_LIVE_PROOF || 'false')
    .trim()
    .toLowerCase() === 'true';
const REQUIRE_DEPLOYMENT_EVIDENCE =
  String(process.env.BROKER_ASSETS_SIGNOFF_REQUIRE_DEPLOYMENT_EVIDENCE || 'false')
    .trim()
    .toLowerCase() === 'true';
const GLOBAL_CATALOG_VERIFIED =
  String(process.env.BROKER_ASSETS_SIGNOFF_GLOBAL_CATALOG_VERIFIED || '')
    .trim()
    .toLowerCase() === 'true';
const CONNECTED_VISIBILITY_VERIFIED =
  String(process.env.BROKER_ASSETS_SIGNOFF_CONNECTED_VISIBILITY_VERIFIED || '')
    .trim()
    .toLowerCase() === 'true';
const DELTA_LOOKUP_VERIFIED =
  String(process.env.BROKER_ASSETS_SIGNOFF_DELTA_LOOKUP_VERIFIED || '')
    .trim()
    .toLowerCase() === 'true';
const SOURCE_THRESHOLDS_VERIFIED =
  String(process.env.BROKER_ASSETS_SIGNOFF_SOURCE_THRESHOLDS_VERIFIED || '')
    .trim()
    .toLowerCase() === 'true';
const IDENTITY_CONSTRAINTS_REVIEWED =
  String(process.env.BROKER_ASSETS_SIGNOFF_IDENTITY_CONSTRAINTS_REVIEWED || '')
    .trim()
    .toLowerCase() === 'true';
const PLACEHOLDER_EVIDENCE_ACKNOWLEDGED =
  String(process.env.BROKER_ASSETS_SIGNOFF_PLACEHOLDER_EVIDENCE_ACKNOWLEDGED || '')
    .trim()
    .toLowerCase() === 'true';
const UNBOUNDED_THRESHOLDS_ACKNOWLEDGED =
  String(process.env.BROKER_ASSETS_SIGNOFF_UNBOUNDED_THRESHOLDS_ACKNOWLEDGED || '')
    .trim()
    .toLowerCase() === 'true';
const APPROVER = String(process.env.BROKER_ASSETS_SIGNOFF_APPROVER || '').trim();
const STAGING_WORKFLOW_URL = String(
  process.env.BROKER_ASSETS_SIGNOFF_STAGING_WORKFLOW_URL ||
    process.env.BROKER_ASSETS_SIGNOFF_WORKFLOW_URL ||
    ''
).trim();
const DASHBOARD_URL = String(process.env.BROKER_ASSETS_SIGNOFF_DASHBOARD_URL || '').trim();
const RUNBOOK_URL = String(process.env.BROKER_ASSETS_SIGNOFF_RUNBOOK_URL || '').trim();
const RELEASE_NOTE_URL = String(process.env.BROKER_ASSETS_SIGNOFF_RELEASE_NOTE_URL || '').trim();

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

  const fallback = buildBrokerAssetsHealthThresholdProfile(resolveBrokerAssetsHealthThresholds());
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
    '## Broker assets final sign-off',
    '',
    `- Decision: **${summary.decision}**`,
    `- Gate file: \`${summary.gateFile}\``,
    `- Proof file: ${summary.proofFile ? `\`${summary.proofFile}\`` : 'n/a'}`,
    `- Approver: ${summary.approver || 'n/a'}`,
    '',
    '### Checks',
    '',
    `- release gate decision is ready: ${summary.checks.gateReady ? 'yes' : 'no'}`,
    `- required broker-assets suites passed: ${summary.checks.requiredSuitesPassed ? 'yes' : 'no'}`,
    `- live gate health reviewed: ${summary.checks.liveHealthReviewed ? 'yes' : 'no'}`,
    `- live proof reviewed: ${summary.checks.liveProofReviewed ? 'yes' : 'no'}`,
    `- threshold posture captured: ${summary.checks.thresholdPostureCaptured ? 'yes' : 'no'}`,
    `- global catalog verified: ${summary.checks.globalCatalogVerified ? 'yes' : 'no'}`,
    `- connected visibility verified: ${summary.checks.connectedVisibilityVerified ? 'yes' : 'no'}`,
    `- delta lookup verified: ${summary.checks.deltaLookupVerified ? 'yes' : 'no'}`,
    `- source thresholds verified: ${summary.checks.sourceThresholdsVerified ? 'yes' : 'no'}`,
    `- identity constraints reviewed: ${summary.checks.identityConstraintsReviewed ? 'yes' : 'no'}`,
    `- placeholder evidence acknowledged: ${summary.checks.placeholderEvidenceAcknowledged ? 'yes' : 'no'}`,
    `- unbounded thresholds acknowledged: ${summary.checks.unboundedThresholdsAcknowledged ? 'yes' : 'no'}`,
    '',
    '### Readiness',
    '',
    `- deployment evidence ready: ${summary.readiness.deploymentEvidenceReady === true ? 'yes' : 'no'}`,
    `- threshold profile mode: ${summary.thresholdProfile.mode}`,
    `- live gate ready: ${summary.readiness.liveGateReady === true ? 'yes' : 'no'}`,
    `- live proof ready: ${summary.readiness.liveProofReady === true ? 'yes' : 'no'}`,
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
    'backend-broker-assets-contract',
    'backend-broker-assets-flow',
    'backend-broker-assets-phase6',
    'backend-broker-assets-phase7',
    'backend-broker-assets-phase8',
    'backend-broker-assets-eslint',
  ];
  const requiredSuitesPassed = requiredGateKeys.every(
    (key) => resultsByKey.get(key)?.status === 'passed'
  );
  const liveHealthReviewed = REQUIRE_LIVE_HEALTH
    ? gate.liveChecksEnabled === true &&
      resultsByKey.get('backend-broker-assets-live-health')?.status === 'passed'
    : true;
  const liveProofReviewed = REQUIRE_LIVE_PROOF
    ? proof?.decision === 'ready' && readString(proof.gateDecision || gate.decision) === 'ready'
    : true;
  const thresholdProfile = deriveThresholdProfile(gate.healthSnapshot || proof?.healthSnapshot || null);

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
    liveHealthReviewed,
    liveProofReviewed,
    thresholdPostureCaptured: thresholdProfile.mode !== 'unknown',
    globalCatalogVerified: GLOBAL_CATALOG_VERIFIED,
    connectedVisibilityVerified: CONNECTED_VISIBILITY_VERIFIED,
    deltaLookupVerified: DELTA_LOOKUP_VERIFIED,
    sourceThresholdsVerified: SOURCE_THRESHOLDS_VERIFIED,
    identityConstraintsReviewed: IDENTITY_CONSTRAINTS_REVIEWED,
    placeholderEvidenceAcknowledged:
      deploymentEvidenceReady || PLACEHOLDER_EVIDENCE_ACKNOWLEDGED,
    unboundedThresholdsAcknowledged:
      thresholdProfile.mode !== 'unbounded' || UNBOUNDED_THRESHOLDS_ACKNOWLEDGED,
  };

  assert.equal(checks.gateReady, true, 'release gate must be ready with zero failed checks');
  assert.equal(
    checks.requiredSuitesPassed,
    true,
    'required broker-assets suites, lint, and guards must all pass'
  );
  assert.equal(
    checks.liveHealthReviewed,
    true,
    'live broker-assets health must be reviewed when BROKER_ASSETS_SIGNOFF_REQUIRE_LIVE_HEALTH is true'
  );
  assert.equal(
    checks.liveProofReviewed,
    true,
    'Phase 6 broker-assets live proof must be reviewed when BROKER_ASSETS_SIGNOFF_REQUIRE_LIVE_PROOF is true'
  );
  assert.equal(
    checks.thresholdPostureCaptured,
    true,
    'broker-assets threshold posture must be captured before final sign-off'
  );
  assert.equal(
    checks.globalCatalogVerified,
    true,
    'global broker-assets catalog ownership must be explicitly verified before sign-off'
  );
  assert.equal(
    checks.connectedVisibilityVerified,
    true,
    'connected-broker visibility must be explicitly verified before sign-off'
  );
  assert.equal(
    checks.deltaLookupVerified,
    true,
    'Delta lookup against the global broker-assets catalog must be explicitly verified before sign-off'
  );
  assert.equal(
    checks.sourceThresholdsVerified,
    true,
    'broker-assets source thresholds must be explicitly verified before sign-off'
  );
  assert.equal(
    checks.identityConstraintsReviewed,
    true,
    'provider identity and uniqueness constraints must be explicitly reviewed before sign-off'
  );

  if (REQUIRE_DEPLOYMENT_EVIDENCE) {
    assert.equal(
      deploymentEvidenceReady,
      true,
      'deployment evidence links must be provided when BROKER_ASSETS_SIGNOFF_REQUIRE_DEPLOYMENT_EVIDENCE is true'
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
    'unbounded broker-assets thresholds must be explicitly acknowledged before sign-off'
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
        resultsByKey.get('backend-broker-assets-live-health')?.status === 'passed',
      liveProofReady: proof?.decision === 'ready' || false,
      productionPromotionReady:
        checks.gateReady &&
        checks.requiredSuitesPassed &&
        checks.liveHealthReviewed &&
        checks.liveProofReviewed &&
        checks.thresholdPostureCaptured &&
        checks.globalCatalogVerified &&
        checks.connectedVisibilityVerified &&
        checks.deltaLookupVerified &&
        checks.sourceThresholdsVerified &&
        checks.identityConstraintsReviewed &&
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
  console.log('broker-assets-signoff:', JSON.stringify(summary));
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
