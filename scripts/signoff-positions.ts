import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

type JsonRecord = Record<string, unknown>;

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
  totals: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
  };
  results: ReleaseGateResult[];
};

const GATE_FILE = String(
  process.env.POSITIONS_SIGNOFF_GATE_FILE || 'artifacts/positions-release-gate.json'
).trim();
const OUTPUT_FILE = String(process.env.POSITIONS_SIGNOFF_OUTPUT_FILE || '').trim();
const STEP_SUMMARY_FILE = String(process.env.GITHUB_STEP_SUMMARY || '').trim();
const REQUIRE_LIVE_HEALTH =
  String(process.env.POSITIONS_SIGNOFF_REQUIRE_LIVE_HEALTH || 'false')
    .trim()
    .toLowerCase() === 'true';
const ACTIVITY_AUDIT_VERIFIED =
  String(process.env.POSITIONS_SIGNOFF_ACTIVITY_AUDIT_VERIFIED || '')
    .trim()
    .toLowerCase() === 'true';
const SHAREABLE_WORKSPACE_VERIFIED =
  String(process.env.POSITIONS_SIGNOFF_SHAREABLE_WORKSPACE_VERIFIED || '')
    .trim()
    .toLowerCase() === 'true';
const STALE_SNAPSHOT_RUNBOOK_VERIFIED =
  String(process.env.POSITIONS_SIGNOFF_STALE_SNAPSHOT_RUNBOOK_VERIFIED || '')
    .trim()
    .toLowerCase() === 'true';
const OPERATOR_FLOWS_VERIFIED =
  String(process.env.POSITIONS_SIGNOFF_OPERATOR_FLOWS_VERIFIED || '')
    .trim()
    .toLowerCase() === 'true';
const APPROVER = String(process.env.POSITIONS_SIGNOFF_APPROVER || '').trim();
const STAGING_WORKFLOW_URL = String(
  process.env.POSITIONS_SIGNOFF_STAGING_WORKFLOW_URL || ''
).trim();
const DASHBOARD_URL = String(process.env.POSITIONS_SIGNOFF_DASHBOARD_URL || '').trim();
const RUNBOOK_URL = String(process.env.POSITIONS_SIGNOFF_RUNBOOK_URL || '').trim();
const RELEASE_NOTE_URL = String(
  process.env.POSITIONS_SIGNOFF_RELEASE_NOTE_URL || ''
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
  evidence: Record<string, string | null>;
  gate: ReleaseGateSummary;
}): Promise<void> {
  if (!STEP_SUMMARY_FILE) {
    return;
  }

  const lines = [
    '## Positions final sign-off',
    '',
    `- Decision: **${summary.decision}**`,
    `- Gate file: \`${summary.gateFile}\``,
    `- Approver: ${summary.approver || 'n/a'}`,
    '',
    '### Checks',
    '',
    `- release gate decision is ready: ${summary.checks.gateReady ? 'yes' : 'no'}`,
    `- required positions suites passed: ${summary.checks.requiredSuitesPassed ? 'yes' : 'no'}`,
    `- live positions health reviewed: ${summary.checks.liveHealthReviewed ? 'yes' : 'no'}`,
    `- action audit verified: ${summary.checks.activityAuditVerified ? 'yes' : 'no'}`,
    `- shareable workspace verified: ${summary.checks.shareableWorkspaceVerified ? 'yes' : 'no'}`,
    `- stale snapshot runbook verified: ${summary.checks.staleSnapshotRunbookVerified ? 'yes' : 'no'}`,
    `- operator flows verified: ${summary.checks.operatorFlowsVerified ? 'yes' : 'no'}`,
    '',
    '### Evidence',
    '',
    `- staging workflow: ${summary.evidence.stagingWorkflowUrl || 'n/a'}`,
    `- dashboard URL: ${summary.evidence.dashboardUrl || 'n/a'}`,
    `- runbook URL: ${summary.evidence.runbookUrl || 'n/a'}`,
    `- release note URL: ${summary.evidence.releaseNoteUrl || 'n/a'}`,
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
    'backend-positions-phase1',
    'backend-positions-phase4',
    'backend-positions-phase5',
    'backend-positions-phase6',
    'backend-positions-phase8',
    'backend-positions-eslint',
    'frontend-positions-eslint',
    'frontend-positions-ui',
    'frontend-positions-build',
  ];

  const requiredSuitesPassed = requiredGateKeys.every(
    (key) => resultsByKey.get(key)?.status === 'passed'
  );
  const liveHealthReviewed = REQUIRE_LIVE_HEALTH
    ? resultsByKey.get('backend-positions-live-health')?.status === 'passed'
    : true;

  const checks = {
    gateReady: gate.decision === 'ready' && gate.totals.failed === 0,
    requiredSuitesPassed,
    liveHealthReviewed,
    activityAuditVerified: ACTIVITY_AUDIT_VERIFIED,
    shareableWorkspaceVerified: SHAREABLE_WORKSPACE_VERIFIED,
    staleSnapshotRunbookVerified: STALE_SNAPSHOT_RUNBOOK_VERIFIED,
    operatorFlowsVerified: OPERATOR_FLOWS_VERIFIED,
  };

  assert.equal(checks.gateReady, true, 'release gate must be ready with zero failed checks');
  assert.equal(
    checks.requiredSuitesPassed,
    true,
    'required positions suites, lint, and build checks must all pass'
  );
  assert.equal(
    checks.liveHealthReviewed,
    true,
    'live positions health must be reviewed when POSITIONS_SIGNOFF_REQUIRE_LIVE_HEALTH is true'
  );
  assert.equal(
    checks.activityAuditVerified,
    true,
    'close, partial close, reverse, margin, and protection audit flows must be explicitly verified before sign-off'
  );
  assert.equal(
    checks.shareableWorkspaceVerified,
    true,
    'shareable positions workspace state must be explicitly verified before sign-off'
  );
  assert.equal(
    checks.staleSnapshotRunbookVerified,
    true,
    'stale snapshot runbook must be explicitly verified before sign-off'
  );
  assert.equal(
    checks.operatorFlowsVerified,
    true,
    'operator desk flows must be explicitly verified before final positions sign-off'
  );

  const summary = {
    decision: 'ready' as const,
    generatedAt: new Date().toISOString(),
    gateFile: path.resolve(process.cwd(), GATE_FILE),
    approver: APPROVER || null,
    checks,
    evidence: {
      stagingWorkflowUrl: STAGING_WORKFLOW_URL || null,
      dashboardUrl: DASHBOARD_URL || null,
      runbookUrl: RUNBOOK_URL || null,
      releaseNoteUrl: RELEASE_NOTE_URL || null,
    },
    gate,
  };

  await persistSummary(summary);
  await writeStepSummary(summary);
  console.log('positions-signoff:', JSON.stringify(summary));
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
