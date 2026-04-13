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
  process.env.ORDERS_SCHEDULER_SIGNOFF_GATE_FILE ||
    'artifacts/orders-scheduler-release-gate.json'
).trim();
const OUTPUT_FILE = String(
  process.env.ORDERS_SCHEDULER_SIGNOFF_OUTPUT_FILE ||
    'artifacts/orders-scheduler-signoff.json'
).trim();
const STEP_SUMMARY_FILE = String(process.env.GITHUB_STEP_SUMMARY || '').trim();
const REQUIRE_LIVE_HEALTH =
  String(process.env.ORDERS_SCHEDULER_SIGNOFF_REQUIRE_LIVE_HEALTH || 'false')
    .trim()
    .toLowerCase() === 'true';
const OPERATOR_WALKTHROUGH_VERIFIED =
  String(process.env.ORDERS_SCHEDULER_SIGNOFF_OPERATOR_WALKTHROUGH_VERIFIED || '')
    .trim()
    .toLowerCase() === 'true';
const RUNBOOK_REVIEW_VERIFIED =
  String(process.env.ORDERS_SCHEDULER_SIGNOFF_RUNBOOK_REVIEW_VERIFIED || '')
    .trim()
    .toLowerCase() === 'true';
const RUNTIME_FOUNDATION_VERIFIED =
  String(process.env.ORDERS_SCHEDULER_SIGNOFF_RUNTIME_FOUNDATION_VERIFIED || '')
    .trim()
    .toLowerCase() === 'true';
const ACCESS_REVIEW_VERIFIED =
  String(process.env.ORDERS_SCHEDULER_SIGNOFF_ACCESS_REVIEW_VERIFIED || '')
    .trim()
    .toLowerCase() === 'true';
const APPROVER = String(process.env.ORDERS_SCHEDULER_SIGNOFF_APPROVER || '').trim();
const STAGING_WORKFLOW_URL = String(
  process.env.ORDERS_SCHEDULER_SIGNOFF_STAGING_WORKFLOW_URL || ''
).trim();
const DASHBOARD_URL = String(
  process.env.ORDERS_SCHEDULER_SIGNOFF_DASHBOARD_URL || ''
).trim();
const RUNBOOK_URL = String(
  process.env.ORDERS_SCHEDULER_SIGNOFF_RUNBOOK_URL || ''
).trim();
const RELEASE_NOTE_URL = String(
  process.env.ORDERS_SCHEDULER_SIGNOFF_RELEASE_NOTE_URL || ''
).trim();
const OPERATOR_WALKTHROUGH_URL = String(
  process.env.ORDERS_SCHEDULER_SIGNOFF_OPERATOR_WALKTHROUGH_URL || ''
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
    '## Orders scheduler final sign-off',
    '',
    `- Decision: **${summary.decision}**`,
    `- Gate file: \`${summary.gateFile}\``,
    `- Approver: ${summary.approver || 'n/a'}`,
    '',
    '### Checks',
    '',
    `- release gate decision is ready: ${summary.checks.gateReady ? 'yes' : 'no'}`,
    `- required orders scheduler suites passed: ${summary.checks.requiredSuitesPassed ? 'yes' : 'no'}`,
    `- live orders scheduler health reviewed: ${summary.checks.liveHealthReviewed ? 'yes' : 'no'}`,
    `- operator walkthrough verified: ${summary.checks.operatorWalkthroughVerified ? 'yes' : 'no'}`,
    `- runbook review verified: ${summary.checks.runbookReviewVerified ? 'yes' : 'no'}`,
    `- runtime foundation verified: ${summary.checks.runtimeFoundationVerified ? 'yes' : 'no'}`,
    `- admin access review verified: ${summary.checks.accessReviewVerified ? 'yes' : 'no'}`,
    '',
    '### Evidence',
    '',
    `- staging workflow: ${summary.evidence.stagingWorkflowUrl || 'n/a'}`,
    `- dashboard URL: ${summary.evidence.dashboardUrl || 'n/a'}`,
    `- runbook URL: ${summary.evidence.runbookUrl || 'n/a'}`,
    `- release note URL: ${summary.evidence.releaseNoteUrl || 'n/a'}`,
    `- operator walkthrough URL: ${summary.evidence.operatorWalkthroughUrl || 'n/a'}`,
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
    'backend-orders-scheduler-suite',
    'backend-orders-scheduler-controllers',
    'backend-orders-scheduler-eslint',
    'frontend-orders-scheduler-eslint',
    'frontend-orders-scheduler-ui',
    'frontend-orders-scheduler-e2e',
  ];

  const requiredSuitesPassed = requiredGateKeys.every(
    (key) => resultsByKey.get(key)?.status === 'passed'
  );
  const liveHealthReviewed = REQUIRE_LIVE_HEALTH
    ? resultsByKey.get('backend-orders-scheduler-live-health')?.status === 'passed'
    : true;

  const checks = {
    gateReady: gate.decision === 'ready' && gate.totals.failed === 0,
    requiredSuitesPassed,
    liveHealthReviewed,
    operatorWalkthroughVerified: OPERATOR_WALKTHROUGH_VERIFIED,
    runbookReviewVerified: RUNBOOK_REVIEW_VERIFIED,
    runtimeFoundationVerified: RUNTIME_FOUNDATION_VERIFIED,
    accessReviewVerified: ACCESS_REVIEW_VERIFIED,
  };

  assert.equal(checks.gateReady, true, 'release gate must be ready with zero failed checks');
  assert.equal(
    checks.requiredSuitesPassed,
    true,
    'required orders scheduler backend, UI, lint, and E2E suites must all pass'
  );
  assert.equal(
    checks.liveHealthReviewed,
    true,
    'live orders scheduler health must be reviewed when ORDERS_SCHEDULER_SIGNOFF_REQUIRE_LIVE_HEALTH is true'
  );
  assert.equal(
    checks.operatorWalkthroughVerified,
    true,
    'the orders scheduler operator walkthrough must be explicitly verified before final sign-off'
  );
  assert.equal(
    checks.runbookReviewVerified,
    true,
    'the orders scheduler runbook review must be explicitly verified before final sign-off'
  );
  assert.equal(
    checks.runtimeFoundationVerified,
    true,
    'the orders scheduler runtime foundation must be explicitly verified before final sign-off'
  );
  assert.equal(
    checks.accessReviewVerified,
    true,
    'the orders scheduler admin-only access review must be explicitly verified before final sign-off'
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
      operatorWalkthroughUrl: OPERATOR_WALKTHROUGH_URL || null,
    },
    gate,
  };

  await persistSummary(summary);
  await writeStepSummary(summary);

  console.log('orders-scheduler-signoff:', JSON.stringify(summary));
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
