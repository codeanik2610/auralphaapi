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
  liveProofEnabled: boolean;
  proofFile?: string | null;
  proofSummary: JsonRecord | null;
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
  contract?: string | null;
  activeUserOwned?: number;
  activeSystemOwned?: number;
};

const GATE_FILE = String(
  process.env.SCHEDULER_ACCOUNT_SCOPE_SIGNOFF_GATE_FILE ||
    'artifacts/scheduler-account-scope-release-gate.json'
).trim();
const PROOF_FILE = String(
  process.env.SCHEDULER_ACCOUNT_SCOPE_SIGNOFF_PROOF_FILE ||
    'artifacts/scheduler-account-scope-live-proof.json'
).trim();
const OUTPUT_FILE = String(
  process.env.SCHEDULER_ACCOUNT_SCOPE_SIGNOFF_OUTPUT_FILE ||
    'artifacts/scheduler-account-scope-signoff.json'
).trim();
const STEP_SUMMARY_FILE = String(process.env.GITHUB_STEP_SUMMARY || '').trim();
const REQUIRE_LIVE_PROOF =
  String(process.env.SCHEDULER_ACCOUNT_SCOPE_SIGNOFF_REQUIRE_LIVE_PROOF || 'false')
    .trim()
    .toLowerCase() === 'true';
const REQUIRE_DEPLOYMENT_EVIDENCE =
  String(process.env.SCHEDULER_ACCOUNT_SCOPE_SIGNOFF_REQUIRE_DEPLOYMENT_EVIDENCE || 'false')
    .trim()
    .toLowerCase() === 'true';
const OWNERSHIP_SPLIT_VERIFIED =
  String(process.env.SCHEDULER_ACCOUNT_SCOPE_SIGNOFF_OWNERSHIP_SPLIT_VERIFIED || '')
    .trim()
    .toLowerCase() === 'true';
const ORDERS_DIAGNOSTICS_VERIFIED =
  String(process.env.SCHEDULER_ACCOUNT_SCOPE_SIGNOFF_ORDERS_DIAGNOSTICS_VERIFIED || '')
    .trim()
    .toLowerCase() === 'true';
const POSITIONS_DIAGNOSTICS_VERIFIED =
  String(process.env.SCHEDULER_ACCOUNT_SCOPE_SIGNOFF_POSITIONS_DIAGNOSTICS_VERIFIED || '')
    .trim()
    .toLowerCase() === 'true';
const FUNDS_OWNERLESS_EXCLUSION_VERIFIED =
  String(process.env.SCHEDULER_ACCOUNT_SCOPE_SIGNOFF_FUNDS_OWNERLESS_EXCLUSION_VERIFIED || '')
    .trim()
    .toLowerCase() === 'true';
const PLACEHOLDER_EVIDENCE_ACKNOWLEDGED =
  String(process.env.SCHEDULER_ACCOUNT_SCOPE_SIGNOFF_PLACEHOLDER_EVIDENCE_ACKNOWLEDGED || '')
    .trim()
    .toLowerCase() === 'true';
const APPROVER = String(process.env.SCHEDULER_ACCOUNT_SCOPE_SIGNOFF_APPROVER || '').trim();
const STAGING_WORKFLOW_URL = String(
  process.env.SCHEDULER_ACCOUNT_SCOPE_SIGNOFF_STAGING_WORKFLOW_URL ||
    process.env.SCHEDULER_ACCOUNT_SCOPE_SIGNOFF_WORKFLOW_URL ||
    ''
).trim();
const DASHBOARD_URL = String(
  process.env.SCHEDULER_ACCOUNT_SCOPE_SIGNOFF_DASHBOARD_URL || ''
).trim();
const RUNBOOK_URL = String(process.env.SCHEDULER_ACCOUNT_SCOPE_SIGNOFF_RUNBOOK_URL || '').trim();
const RELEASE_NOTE_URL = String(
  process.env.SCHEDULER_ACCOUNT_SCOPE_SIGNOFF_RELEASE_NOTE_URL || ''
).trim();

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

async function readGateSummary(): Promise<ReleaseGateSummary> {
  const absoluteGateFile = path.resolve(process.cwd(), GATE_FILE);
  const raw = await readFile(absoluteGateFile, 'utf8');
  const parsed = JSON.parse(raw) as JsonRecord;
  const totals = asRecord(parsed.totals);

  return {
    decision: readString(parsed.decision) === 'blocked' ? 'blocked' : 'ready',
    startedAt: readString(parsed.startedAt) || undefined,
    finishedAt: readString(parsed.finishedAt) || undefined,
    liveProofEnabled: parsed.liveProofEnabled === true,
    proofFile: readString(parsed.proofFile) || null,
    proofSummary:
      parsed.proofSummary && typeof parsed.proofSummary === 'object'
        ? asRecord(parsed.proofSummary)
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

async function readOptionalProofSummary(gate: ReleaseGateSummary): Promise<ProofSummary | null> {
  const candidate = readString(gate.proofFile) || PROOF_FILE;
  const absoluteProofFile = path.resolve(process.cwd(), candidate);

  try {
    const raw = await readFile(absoluteProofFile, 'utf8');
    const parsed = JSON.parse(raw) as JsonRecord;
    return {
      decision: readString(parsed.decision) === 'blocked' ? 'blocked' : 'ready',
      contract: readString(parsed.contract) || null,
      activeUserOwned:
        parsed.activeUserOwned === undefined ? undefined : readNumber(parsed.activeUserOwned),
      activeSystemOwned:
        parsed.activeSystemOwned === undefined ? undefined : readNumber(parsed.activeSystemOwned),
    };
  } catch {
    if (gate.proofSummary) {
      return {
        decision: readString(gate.proofSummary.decision) === 'blocked' ? 'blocked' : 'ready',
        contract: readString(gate.proofSummary.contract) || null,
        activeUserOwned:
          gate.proofSummary.activeUserOwned === undefined
            ? undefined
            : readNumber(gate.proofSummary.activeUserOwned),
        activeSystemOwned:
          gate.proofSummary.activeSystemOwned === undefined
            ? undefined
            : readNumber(gate.proofSummary.activeSystemOwned),
      };
    }
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
  readiness: Record<string, boolean>;
  acknowledgements: Record<string, boolean>;
  evidence: Record<string, string | null>;
  evidenceClassification: Record<string, string>;
  gate: ReleaseGateSummary;
  proof: ProofSummary | null;
}): Promise<void> {
  if (!STEP_SUMMARY_FILE) {
    return;
  }

  const lines = [
    '## Scheduler account-scope final sign-off',
    '',
    `- Decision: **${summary.decision}**`,
    `- Gate file: \`${summary.gateFile}\``,
    `- Proof file: ${summary.proofFile ? `\`${summary.proofFile}\`` : 'n/a'}`,
    `- Approver: ${summary.approver || 'n/a'}`,
    '',
    '### Checks',
    '',
    `- release gate decision is ready: ${summary.checks.gateReady ? 'yes' : 'no'}`,
    `- required scheduler account-scope suites passed: ${summary.checks.requiredSuitesPassed ? 'yes' : 'no'}`,
    `- live proof reviewed: ${summary.checks.liveProofReviewed ? 'yes' : 'no'}`,
    `- ownership split verified: ${summary.checks.ownershipSplitVerified ? 'yes' : 'no'}`,
    `- orders diagnostics verified: ${summary.checks.ordersDiagnosticsVerified ? 'yes' : 'no'}`,
    `- positions diagnostics verified: ${summary.checks.positionsDiagnosticsVerified ? 'yes' : 'no'}`,
    `- funds ownerless exclusion verified: ${summary.checks.fundsOwnerlessExclusionVerified ? 'yes' : 'no'}`,
    `- placeholder evidence acknowledged: ${summary.checks.placeholderEvidenceAcknowledged ? 'yes' : 'no'}`,
    '',
    '### Readiness',
    '',
    `- live proof ready: ${summary.readiness.liveProofReady ? 'yes' : 'no'}`,
    `- deployment evidence ready: ${summary.readiness.deploymentEvidenceReady ? 'yes' : 'no'}`,
    `- production promotion ready: ${summary.readiness.productionPromotionReady ? 'yes' : 'no'}`,
    `- placeholder acknowledgement used: ${summary.acknowledgements.placeholderEvidenceUsed ? 'yes' : 'no'}`,
    '',
    '### Evidence',
    '',
    `- staging workflow: ${summary.evidence.stagingWorkflowUrl || 'n/a'} (${summary.evidenceClassification.stagingWorkflowUrlKind || 'missing'})`,
    `- dashboard URL: ${summary.evidence.dashboardUrl || 'n/a'} (${summary.evidenceClassification.dashboardUrlKind || 'missing'})`,
    `- runbook URL: ${summary.evidence.runbookUrl || 'n/a'} (${summary.evidenceClassification.runbookUrlKind || 'missing'})`,
    `- release note URL: ${summary.evidence.releaseNoteUrl || 'n/a'} (${summary.evidenceClassification.releaseNoteUrlKind || 'missing'})`,
    '',
  ];

  await writeFile(STEP_SUMMARY_FILE, `${lines.join('\n')}\n`, 'utf8');
}

async function run(): Promise<void> {
  const gate = await readGateSummary();
  const proof = await readOptionalProofSummary(gate);
  const proofFile = readString(gate.proofFile) || (proof ? PROOF_FILE : '');

  const requiredGateKeys = [
    'backend-scheduler-account-scope-suite',
    'backend-scheduler-account-scope-operational-audit',
  ];

  const gateResultMap = new Map(gate.results.map((result) => [result.key, result]));
  const requiredSuitesPassed = requiredGateKeys.every(
    (key) => gateResultMap.get(key)?.status === 'passed'
  );
  const liveProofReady = proof?.decision === 'ready';
  const liveProofReviewed = REQUIRE_LIVE_PROOF ? liveProofReady : true;

  const evidence = {
    stagingWorkflowUrl: STAGING_WORKFLOW_URL || null,
    dashboardUrl: DASHBOARD_URL || null,
    runbookUrl: RUNBOOK_URL || null,
    releaseNoteUrl: RELEASE_NOTE_URL || null,
  };
  const evidenceClassification = {
    stagingWorkflowUrlKind: classifyEvidenceLocation(evidence.stagingWorkflowUrl || ''),
    dashboardUrlKind: classifyEvidenceLocation(evidence.dashboardUrl || ''),
    runbookUrlKind: classifyEvidenceLocation(evidence.runbookUrl || ''),
    releaseNoteUrlKind: classifyEvidenceLocation(evidence.releaseNoteUrl || ''),
  };
  const deploymentEvidenceReady = Object.values(evidenceClassification).every((kind) =>
    isEvidenceReady(kind as EvidenceLocationKind)
  );
  const placeholderEvidenceAcknowledged =
    deploymentEvidenceReady || PLACEHOLDER_EVIDENCE_ACKNOWLEDGED;

  const checks = {
    gateReady: gate.decision === 'ready',
    requiredSuitesPassed,
    liveProofReviewed,
    ownershipSplitVerified: OWNERSHIP_SPLIT_VERIFIED,
    ordersDiagnosticsVerified: ORDERS_DIAGNOSTICS_VERIFIED,
    positionsDiagnosticsVerified: POSITIONS_DIAGNOSTICS_VERIFIED,
    fundsOwnerlessExclusionVerified: FUNDS_OWNERLESS_EXCLUSION_VERIFIED,
    placeholderEvidenceAcknowledged,
  };

  const readiness = {
    liveProofReady,
    deploymentEvidenceReady,
    productionPromotionReady:
      checks.gateReady &&
      checks.requiredSuitesPassed &&
      checks.liveProofReviewed &&
      checks.ownershipSplitVerified &&
      checks.ordersDiagnosticsVerified &&
      checks.positionsDiagnosticsVerified &&
      checks.fundsOwnerlessExclusionVerified &&
      (REQUIRE_DEPLOYMENT_EVIDENCE ? deploymentEvidenceReady : placeholderEvidenceAcknowledged),
  };

  const acknowledgements = {
    placeholderEvidenceUsed: !deploymentEvidenceReady && PLACEHOLDER_EVIDENCE_ACKNOWLEDGED,
  };

  const decision: 'ready' | 'blocked' = readiness.productionPromotionReady ? 'ready' : 'blocked';
  const summary = {
    decision,
    generatedAt: new Date().toISOString(),
    approver: APPROVER || null,
    gateFile: path.resolve(process.cwd(), GATE_FILE),
    proofFile: proofFile ? path.resolve(process.cwd(), proofFile) : null,
    checks,
    readiness,
    acknowledgements,
    evidence,
    evidenceClassification,
    environment: {
      requireLiveProof: REQUIRE_LIVE_PROOF,
      requireDeploymentEvidence: REQUIRE_DEPLOYMENT_EVIDENCE,
    },
    gate,
    proof,
  };

  await persistSummary(summary);
  await writeStepSummary({
    decision,
    gateFile: summary.gateFile,
    proofFile: summary.proofFile,
    approver: summary.approver,
    checks,
    readiness,
    acknowledgements,
    evidence,
    evidenceClassification,
    gate,
    proof,
  });
  console.log('scheduler-account-scope-signoff:', JSON.stringify(summary));

  if (decision === 'blocked') {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
