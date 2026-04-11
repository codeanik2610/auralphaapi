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
  process.env.ORDERS_SIGNOFF_GATE_FILE || 'artifacts/orders-release-gate.json'
).trim();
const OUTPUT_FILE = String(
  process.env.ORDERS_SIGNOFF_OUTPUT_FILE || 'artifacts/orders-signoff.json'
).trim();
const STEP_SUMMARY_FILE = String(process.env.GITHUB_STEP_SUMMARY || '').trim();
const REQUIRE_LIVE_HEALTH =
  String(process.env.ORDERS_SIGNOFF_REQUIRE_LIVE_HEALTH || 'false')
    .trim()
    .toLowerCase() === 'true';
const EXTERNAL_DASHBOARDS_VERIFIED =
  String(process.env.ORDERS_SIGNOFF_EXTERNAL_DASHBOARDS_VERIFIED || '')
    .trim()
    .toLowerCase() === 'true';
const WRITE_READ_CONSISTENCY_VERIFIED =
  String(process.env.ORDERS_SIGNOFF_WRITE_READ_CONSISTENCY_VERIFIED || '')
    .trim()
    .toLowerCase() === 'true';
const SNAPSHOT_LAG_RUNBOOK_VERIFIED =
  String(process.env.ORDERS_SIGNOFF_SNAPSHOT_LAG_RUNBOOK_VERIFIED || '')
    .trim()
    .toLowerCase() === 'true';
const OPERATOR_FLOWS_VERIFIED =
  String(process.env.ORDERS_SIGNOFF_OPERATOR_FLOWS_VERIFIED || '')
    .trim()
    .toLowerCase() === 'true';
const SYNC_STATUS_VERIFIED =
  String(process.env.ORDERS_SIGNOFF_SYNC_STATUS_VERIFIED || '')
    .trim()
    .toLowerCase() === 'true';
const MANUAL_REFRESH_VERIFIED =
  String(process.env.ORDERS_SIGNOFF_MANUAL_REFRESH_VERIFIED || '')
    .trim()
    .toLowerCase() === 'true';
const APPROVER = String(process.env.ORDERS_SIGNOFF_APPROVER || '').trim();
const STAGING_WORKFLOW_URL = String(
  process.env.ORDERS_SIGNOFF_STAGING_WORKFLOW_URL || ''
).trim();
const DASHBOARD_URL = String(process.env.ORDERS_SIGNOFF_DASHBOARD_URL || '').trim();
const RUNBOOK_URL = String(process.env.ORDERS_SIGNOFF_RUNBOOK_URL || '').trim();
const RELEASE_NOTE_URL = String(
  process.env.ORDERS_SIGNOFF_RELEASE_NOTE_URL || ''
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
    '## Orders final sign-off',
    '',
    `- Decision: **${summary.decision}**`,
    `- Gate file: \`${summary.gateFile}\``,
    `- Approver: ${summary.approver || 'n/a'}`,
    '',
    '### Checks',
    '',
    `- release gate decision is ready: ${summary.checks.gateReady ? 'yes' : 'no'}`,
    `- required orders suites passed: ${summary.checks.requiredSuitesPassed ? 'yes' : 'no'}`,
    `- live orders health reviewed: ${summary.checks.liveHealthReviewed ? 'yes' : 'no'}`,
    `- external dashboards verified: ${summary.checks.externalDashboardsVerified ? 'yes' : 'no'}`,
    `- write/read consistency verified: ${summary.checks.writeReadConsistencyVerified ? 'yes' : 'no'}`,
    `- snapshot-lag runbook verified: ${summary.checks.snapshotLagRunbookVerified ? 'yes' : 'no'}`,
    `- operator flows verified: ${summary.checks.operatorFlowsVerified ? 'yes' : 'no'}`,
    `- sync-status workflow verified: ${summary.checks.syncStatusVerified ? 'yes' : 'no'}`,
    `- manual refresh workflow verified: ${summary.checks.manualRefreshVerified ? 'yes' : 'no'}`,
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
    'backend-orders-contract',
    'backend-orders-phase7',
    'backend-orders-phase8',
    'backend-orders-controllers',
    'backend-orders-eslint',
    'frontend-orders-eslint',
    'frontend-orders-ui',
    'frontend-orders-e2e',
  ];

  const requiredSuitesPassed = requiredGateKeys.every(
    (key) => resultsByKey.get(key)?.status === 'passed'
  );
  const liveHealthReviewed = REQUIRE_LIVE_HEALTH
    ? resultsByKey.get('backend-orders-live-health')?.status === 'passed'
    : true;

  const checks = {
    gateReady: gate.decision === 'ready' && gate.totals.failed === 0,
    requiredSuitesPassed,
    liveHealthReviewed,
    externalDashboardsVerified: EXTERNAL_DASHBOARDS_VERIFIED,
    writeReadConsistencyVerified: WRITE_READ_CONSISTENCY_VERIFIED,
    snapshotLagRunbookVerified: SNAPSHOT_LAG_RUNBOOK_VERIFIED,
    operatorFlowsVerified: OPERATOR_FLOWS_VERIFIED,
    syncStatusVerified: SYNC_STATUS_VERIFIED,
    manualRefreshVerified: MANUAL_REFRESH_VERIFIED,
  };

  assert.equal(checks.gateReady, true, 'release gate must be ready with zero failed checks');
  assert.equal(
    checks.requiredSuitesPassed,
    true,
    'required orders backend, controller, lint, UI, and E2E suites must all pass'
  );
  assert.equal(
    checks.liveHealthReviewed,
    true,
    'live orders health must be reviewed when ORDERS_SIGNOFF_REQUIRE_LIVE_HEALTH is true'
  );
  assert.equal(
    checks.externalDashboardsVerified,
    true,
    'external dashboards must be verified before final orders sign-off'
  );
  assert.equal(
    checks.writeReadConsistencyVerified,
    true,
    'write/read consistency must be explicitly verified before final orders sign-off'
  );
  assert.equal(
    checks.snapshotLagRunbookVerified,
    true,
    'snapshot-lag runbook must be explicitly verified before final orders sign-off'
  );
  assert.equal(
    checks.operatorFlowsVerified,
    true,
    'live and paper operator flows must be explicitly verified before final orders sign-off'
  );
  assert.equal(
    checks.syncStatusVerified,
    true,
    'orders sync-status behavior must be explicitly verified before final orders sign-off'
  );
  assert.equal(
    checks.manualRefreshVerified,
    true,
    'orders manual refresh behavior must be explicitly verified before final orders sign-off'
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
  console.log('orders-signoff:', JSON.stringify(summary));
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
