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
  process.env.RISK_SCHEDULER_SIGNOFF_GATE_FILE || 'artifacts/risk-scheduler-release-gate.json'
).trim();
const OUTPUT_FILE = String(
  process.env.RISK_SCHEDULER_SIGNOFF_OUTPUT_FILE || 'artifacts/risk-scheduler-signoff.json'
).trim();
const STEP_SUMMARY_FILE = String(process.env.GITHUB_STEP_SUMMARY || '').trim();
const REQUIRE_LIVE_HEALTH =
  String(process.env.RISK_SCHEDULER_SIGNOFF_REQUIRE_LIVE_HEALTH || 'false')
    .trim()
    .toLowerCase() === 'true';
const DIAGNOSTICS_VERIFIED =
  String(process.env.RISK_SCHEDULER_SIGNOFF_DIAGNOSTICS_VERIFIED || '')
    .trim()
    .toLowerCase() === 'true';
const PRODUCT_TRUST_VERIFIED =
  String(process.env.RISK_SCHEDULER_SIGNOFF_PRODUCT_TRUST_VERIFIED || '')
    .trim()
    .toLowerCase() === 'true';
const RECOMPUTE_WRITES_VERIFIED =
  String(process.env.RISK_SCHEDULER_SIGNOFF_RECOMPUTE_WRITES_VERIFIED || '')
    .trim()
    .toLowerCase() === 'true';
const ACCESS_REVIEW_VERIFIED =
  String(process.env.RISK_SCHEDULER_SIGNOFF_ACCESS_REVIEW_VERIFIED || '')
    .trim()
    .toLowerCase() === 'true';
const APPROVER = String(process.env.RISK_SCHEDULER_SIGNOFF_APPROVER || '').trim();
const WORKFLOW_URL = String(process.env.RISK_SCHEDULER_SIGNOFF_WORKFLOW_URL || '').trim();
const DASHBOARD_URL = String(process.env.RISK_SCHEDULER_SIGNOFF_DASHBOARD_URL || '').trim();
const RUNBOOK_URL = String(process.env.RISK_SCHEDULER_SIGNOFF_RUNBOOK_URL || '').trim();
const RELEASE_NOTE_URL = String(process.env.RISK_SCHEDULER_SIGNOFF_RELEASE_NOTE_URL || '').trim();

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
    '## Risk scheduler final sign-off',
    '',
    `- Decision: **${summary.decision}**`,
    `- Gate file: \`${summary.gateFile}\``,
    `- Approver: ${summary.approver || 'n/a'}`,
    '',
    '### Checks',
    '',
    `- release gate decision is ready: ${summary.checks.gateReady ? 'yes' : 'no'}`,
    `- required risk scheduler suites passed: ${summary.checks.requiredSuitesPassed ? 'yes' : 'no'}`,
    `- live scheduler and risk-center health reviewed: ${summary.checks.liveHealthReviewed ? 'yes' : 'no'}`,
    `- admin diagnostics verified: ${summary.checks.diagnosticsVerified ? 'yes' : 'no'}`,
    `- product trust alignment verified: ${summary.checks.productTrustVerified ? 'yes' : 'no'}`,
    `- recompute writes verified: ${summary.checks.recomputeWritesVerified ? 'yes' : 'no'}`,
    `- admin access review verified: ${summary.checks.accessReviewVerified ? 'yes' : 'no'}`,
    '',
    '### Evidence',
    '',
    `- workflow URL: ${summary.evidence.workflowUrl || 'n/a'}`,
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
    'backend-risk-scheduler-suite',
    'backend-risk-center-suite',
    'backend-controllers',
    'backend-operational-audit',
    'backend-risk-scheduler-eslint',
    'frontend-schedulers-risk-ui',
    'frontend-schedulers-risk-eslint',
  ];

  const requiredSuitesPassed = requiredGateKeys.every(
    (key) => resultsByKey.get(key)?.status === 'passed'
  );
  const liveHealthReviewed = REQUIRE_LIVE_HEALTH
    ? resultsByKey.get('backend-risk-scheduler-health')?.status === 'passed' &&
      resultsByKey.get('backend-risk-center-health')?.status === 'passed'
    : true;

  const checks = {
    gateReady: gate.decision === 'ready' && gate.totals.failed === 0,
    requiredSuitesPassed,
    liveHealthReviewed,
    diagnosticsVerified: DIAGNOSTICS_VERIFIED,
    productTrustVerified: PRODUCT_TRUST_VERIFIED,
    recomputeWritesVerified: RECOMPUTE_WRITES_VERIFIED,
    accessReviewVerified: ACCESS_REVIEW_VERIFIED,
  };

  assert.equal(checks.gateReady, true, 'release gate must be ready with zero failed checks');
  assert.equal(
    checks.requiredSuitesPassed,
    true,
    'required risk scheduler backend, product-trust, UI, lint, and audit checks must all pass'
  );
  assert.equal(
    checks.liveHealthReviewed,
    true,
    'live risk scheduler and risk-center health must be reviewed when RISK_SCHEDULER_SIGNOFF_REQUIRE_LIVE_HEALTH is true'
  );
  assert.equal(
    checks.diagnosticsVerified,
    true,
    'admin risk scheduler diagnostics must be explicitly verified before final sign-off'
  );
  assert.equal(
    checks.productTrustVerified,
    true,
    'Risk Center trust alignment must be explicitly verified before final risk scheduler sign-off'
  );
  assert.equal(
    checks.recomputeWritesVerified,
    true,
    'fresh risk snapshot/control/alert/scenario writes must be explicitly verified before final sign-off'
  );
  assert.equal(
    checks.accessReviewVerified,
    true,
    'admin-only access review must be explicitly verified before final risk scheduler sign-off'
  );

  const summary = {
    decision: 'ready' as const,
    generatedAt: new Date().toISOString(),
    gateFile: path.resolve(process.cwd(), GATE_FILE),
    approver: APPROVER || null,
    checks,
    evidence: {
      workflowUrl: WORKFLOW_URL || null,
      dashboardUrl: DASHBOARD_URL || null,
      runbookUrl: RUNBOOK_URL || null,
      releaseNoteUrl: RELEASE_NOTE_URL || null,
    },
    gate,
  };

  await persistSummary(summary);
  await writeStepSummary(summary);
  console.log('risk-scheduler-signoff:', JSON.stringify(summary));
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
