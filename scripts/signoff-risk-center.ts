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
  process.env.RISK_CENTER_SIGNOFF_GATE_FILE || 'artifacts/risk-center-release-gate.json'
).trim();
const OUTPUT_FILE = String(
  process.env.RISK_CENTER_SIGNOFF_OUTPUT_FILE || 'artifacts/risk-center-signoff.json'
).trim();
const STEP_SUMMARY_FILE = String(process.env.GITHUB_STEP_SUMMARY || '').trim();
const REQUIRE_LIVE_HEALTH =
  String(process.env.RISK_CENTER_SIGNOFF_REQUIRE_LIVE_HEALTH || 'false')
    .trim()
    .toLowerCase() === 'true';
const EXTERNAL_DASHBOARDS_VERIFIED =
  String(process.env.RISK_CENTER_SIGNOFF_EXTERNAL_DASHBOARDS_VERIFIED || '')
    .trim()
    .toLowerCase() === 'true';
const DATA_PROVENANCE_VERIFIED =
  String(process.env.RISK_CENTER_SIGNOFF_DATA_PROVENANCE_VERIFIED || '')
    .trim()
    .toLowerCase() === 'true';
const OPERATOR_HANDOFFS_VERIFIED =
  String(process.env.RISK_CENTER_SIGNOFF_OPERATOR_HANDOFFS_VERIFIED || '')
    .trim()
    .toLowerCase() === 'true';
const MIGRATION_RUN_VERIFIED =
  String(process.env.RISK_CENTER_SIGNOFF_MIGRATION_RUN_VERIFIED || '')
    .trim()
    .toLowerCase() === 'true';
const APPROVER = String(process.env.RISK_CENTER_SIGNOFF_APPROVER || '').trim();
const STAGING_WORKFLOW_URL = String(
  process.env.RISK_CENTER_SIGNOFF_STAGING_WORKFLOW_URL || ''
).trim();
const DASHBOARD_URL = String(
  process.env.RISK_CENTER_SIGNOFF_DASHBOARD_URL || ''
).trim();
const RUNBOOK_URL = String(process.env.RISK_CENTER_SIGNOFF_RUNBOOK_URL || '').trim();
const RELEASE_NOTE_URL = String(
  process.env.RISK_CENTER_SIGNOFF_RELEASE_NOTE_URL || ''
).trim();
const MIGRATION_RUN_URL = String(
  process.env.RISK_CENTER_SIGNOFF_MIGRATION_RUN_URL || ''
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
    '## Risk Center final sign-off',
    '',
    `- Decision: **${summary.decision}**`,
    `- Gate file: \`${summary.gateFile}\``,
    `- Approver: ${summary.approver || 'n/a'}`,
    '',
    '### Checks',
    '',
    `- release gate decision is ready: ${summary.checks.gateReady ? 'yes' : 'no'}`,
    `- required risk-center suites passed: ${summary.checks.requiredSuitesPassed ? 'yes' : 'no'}`,
    `- live risk-center health reviewed: ${summary.checks.liveHealthReviewed ? 'yes' : 'no'}`,
    `- external dashboards verified: ${summary.checks.externalDashboardsVerified ? 'yes' : 'no'}`,
    `- data provenance verified: ${summary.checks.dataProvenanceVerified ? 'yes' : 'no'}`,
    `- operator handoffs verified: ${summary.checks.operatorHandoffsVerified ? 'yes' : 'no'}`,
    `- migration run verified: ${summary.checks.migrationRunVerified ? 'yes' : 'no'}`,
    '',
    '### Evidence',
    '',
    `- staging workflow: ${summary.evidence.stagingWorkflowUrl || 'n/a'}`,
    `- dashboard URL: ${summary.evidence.dashboardUrl || 'n/a'}`,
    `- runbook URL: ${summary.evidence.runbookUrl || 'n/a'}`,
    `- release note URL: ${summary.evidence.releaseNoteUrl || 'n/a'}`,
    `- migration run URL: ${summary.evidence.migrationRunUrl || 'n/a'}`,
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
    'backend-risk-center-contract',
    'backend-risk-center-phase1',
    'backend-risk-center-phase2',
    'backend-risk-center-phase4',
    'backend-risk-center-phase5',
    'backend-risk-center-controllers',
    'backend-type-check',
    'frontend-risk-center-eslint',
    'frontend-risk-center-ui',
    'frontend-risk-center-e2e',
  ];

  const requiredSuitesPassed = requiredGateKeys.every(
    (key) => resultsByKey.get(key)?.status === 'passed'
  );
  const liveHealthReviewed = REQUIRE_LIVE_HEALTH
    ? resultsByKey.get('backend-risk-center-live-health')?.status === 'passed'
    : true;

  const checks = {
    gateReady: gate.decision === 'ready' && gate.totals.failed === 0,
    requiredSuitesPassed,
    liveHealthReviewed,
    externalDashboardsVerified: EXTERNAL_DASHBOARDS_VERIFIED,
    dataProvenanceVerified: DATA_PROVENANCE_VERIFIED,
    operatorHandoffsVerified: OPERATOR_HANDOFFS_VERIFIED,
    migrationRunVerified: MIGRATION_RUN_VERIFIED,
  };

  assert.equal(checks.gateReady, true, 'release gate must be ready with zero failed checks');
  assert.equal(
    checks.requiredSuitesPassed,
    true,
    'required risk-center backend, UI, lint, and E2E suites must all pass'
  );
  assert.equal(
    checks.liveHealthReviewed,
    true,
    'live risk-center health must be reviewed when RISK_CENTER_SIGNOFF_REQUIRE_LIVE_HEALTH is true'
  );
  assert.equal(
    checks.externalDashboardsVerified,
    true,
    'external dashboards must be verified before final risk-center sign-off'
  );
  assert.equal(
    checks.dataProvenanceVerified,
    true,
    'risk-center snapshot, alert digest, and lifecycle provenance must be explicitly verified before final sign-off'
  );
  assert.equal(
    checks.operatorHandoffsVerified,
    true,
    'risk-center handoffs into activity and alerts must be explicitly verified before final sign-off'
  );
  assert.equal(
    checks.migrationRunVerified,
    true,
    'the real risk-center migration chain must be verified before final sign-off'
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
      migrationRunUrl: MIGRATION_RUN_URL || null,
    },
    gate,
  };

  await persistSummary(summary);
  await writeStepSummary(summary);
  console.log('risk-center-signoff:', JSON.stringify(summary));
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
