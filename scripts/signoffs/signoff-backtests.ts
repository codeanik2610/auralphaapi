import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

type JsonRecord = Record<string, unknown>;

type ReleaseGateSummary = {
  baseUrl: string;
  smokeRan: boolean;
  soakDurationMinutes: number;
  samples: number;
  startedAt?: string;
  finishedAt?: string;
  thresholds: {
    staleRunningRuns: number;
    incompleteTradeHistoryRuns: number;
    openBacktestAlerts: number;
    recoverableRuns: number | null;
  };
  finalHealth: {
    status: string;
    staleRunningRuns: number;
    recoverableRuns: number;
    incompleteTradeHistoryRuns: number;
    totalRuns: number;
    activeRuns: number;
    detail: string;
  };
  finalAlerts: {
    openBacktestAlerts: number;
    ids: string[];
    messages: string[];
  };
};

const GATE_FILE = String(
  process.env.BACKTESTS_SIGNOFF_GATE_FILE || 'artifacts/backtests-release-gate.json'
).trim();
const OUTPUT_FILE = String(process.env.BACKTESTS_SIGNOFF_OUTPUT_FILE || '').trim();
const STEP_SUMMARY_FILE = String(process.env.GITHUB_STEP_SUMMARY || '').trim();
const MIN_SOAK_MINUTES = Math.max(
  0,
  Number(process.env.BACKTESTS_SIGNOFF_MIN_SOAK_MINUTES || 30)
);
const EXTERNAL_DASHBOARDS_VERIFIED =
  String(process.env.BACKTESTS_SIGNOFF_EXTERNAL_DASHBOARDS_VERIFIED || '')
    .trim()
    .toLowerCase() === 'true';
const UI_COMPOSURE_VERIFIED =
  String(process.env.BACKTESTS_SIGNOFF_UI_COMPOSURE_VERIFIED || '')
    .trim()
    .toLowerCase() === 'true';
const RESULTS_SCALING_VERIFIED =
  String(process.env.BACKTESTS_SIGNOFF_RESULTS_SCALING_VERIFIED || '')
    .trim()
    .toLowerCase() === 'true';
const APPROVER = String(process.env.BACKTESTS_SIGNOFF_APPROVER || '').trim();
const STAGING_WORKFLOW_URL = String(process.env.BACKTESTS_SIGNOFF_STAGING_WORKFLOW_URL || '').trim();
const DASHBOARD_URL = String(process.env.BACKTESTS_SIGNOFF_DASHBOARD_URL || '').trim();
const PAGER_URL = String(process.env.BACKTESTS_SIGNOFF_PAGER_URL || '').trim();
const RELEASE_NOTE_URL = String(process.env.BACKTESTS_SIGNOFF_RELEASE_NOTE_URL || '').trim();

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
  const thresholds = asRecord(parsed.thresholds);
  const finalHealth = asRecord(parsed.finalHealth);
  const finalAlerts = asRecord(parsed.finalAlerts);

  return {
    baseUrl: readString(parsed.baseUrl),
    smokeRan: Boolean(parsed.smokeRan),
    soakDurationMinutes: readNumber(parsed.soakDurationMinutes),
    samples: readNumber(parsed.samples),
    startedAt: readString(parsed.startedAt),
    finishedAt: readString(parsed.finishedAt),
    thresholds: {
      staleRunningRuns: readNumber(thresholds.staleRunningRuns),
      incompleteTradeHistoryRuns: readNumber(thresholds.incompleteTradeHistoryRuns),
      openBacktestAlerts: readNumber(thresholds.openBacktestAlerts),
      recoverableRuns:
        thresholds.recoverableRuns === null || thresholds.recoverableRuns === undefined
          ? null
          : readNumber(thresholds.recoverableRuns),
    },
    finalHealth: {
      status: readString(finalHealth.status),
      staleRunningRuns: readNumber(finalHealth.staleRunningRuns),
      recoverableRuns: readNumber(finalHealth.recoverableRuns),
      incompleteTradeHistoryRuns: readNumber(finalHealth.incompleteTradeHistoryRuns),
      totalRuns: readNumber(finalHealth.totalRuns),
      activeRuns: readNumber(finalHealth.activeRuns),
      detail: readString(finalHealth.detail),
    },
    finalAlerts: {
      openBacktestAlerts: readNumber(finalAlerts.openBacktestAlerts),
      ids: Array.isArray(finalAlerts.ids) ? finalAlerts.ids.map((item) => readString(item)) : [],
      messages: Array.isArray(finalAlerts.messages)
        ? finalAlerts.messages.map((item) => readString(item))
        : [],
    },
  };
}

async function persistSummary(summary: Record<string, unknown>): Promise<void> {
  if (!OUTPUT_FILE) {
    return;
  }

  const absoluteOutputPath = path.resolve(process.cwd(), OUTPUT_FILE);
  await mkdir(path.dirname(absoluteOutputPath), { recursive: true });
  await writeFile(`${absoluteOutputPath}`, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
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
    '## Backtests final sign-off',
    '',
    `- Decision: **${summary.decision}**`,
    `- Gate file: \`${summary.gateFile}\``,
    `- Approver: ${summary.approver || 'n/a'}`,
    '',
    '### Checks',
    '',
    `- lifecycle smoke ran: ${summary.checks.lifecycleSmokeRan ? 'yes' : 'no'}`,
    `- soak duration >= ${MIN_SOAK_MINUTES} min: ${summary.checks.minSoakSatisfied ? 'yes' : 'no'}`,
    `- final gate thresholds satisfied: ${summary.checks.thresholdsSatisfied ? 'yes' : 'no'}`,
    `- external dashboards verified: ${summary.checks.externalDashboardsVerified ? 'yes' : 'no'}`,
    `- UI composure verified: ${summary.checks.uiComposureVerified ? 'yes' : 'no'}`,
    `- results scaling verified: ${summary.checks.resultsScalingVerified ? 'yes' : 'no'}`,
    '',
    '### Evidence',
    '',
    `- staging workflow: ${summary.evidence.stagingWorkflowUrl || 'n/a'}`,
    `- dashboard URL: ${summary.evidence.dashboardUrl || 'n/a'}`,
    `- pager URL: ${summary.evidence.pagerUrl || 'n/a'}`,
    `- release note URL: ${summary.evidence.releaseNoteUrl || 'n/a'}`,
    '',
    '### Final gate snapshot',
    '',
    `- baseUrl: ${summary.gate.baseUrl}`,
    `- status: ${summary.gate.finalHealth.status}`,
    `- staleRunningRuns: ${summary.gate.finalHealth.staleRunningRuns}`,
    `- recoverableRuns: ${summary.gate.finalHealth.recoverableRuns}`,
    `- incompleteTradeHistoryRuns: ${summary.gate.finalHealth.incompleteTradeHistoryRuns}`,
    `- openBacktestAlerts: ${summary.gate.finalAlerts.openBacktestAlerts}`,
    '',
  ];

  await writeFile(STEP_SUMMARY_FILE, `${lines.join('\n')}\n`, 'utf8');
}

async function run(): Promise<void> {
  const gate = await readGateSummary();

  const thresholdsSatisfied =
    readString(gate.finalHealth.status).toLowerCase() !== 'down' &&
    gate.finalHealth.staleRunningRuns <= gate.thresholds.staleRunningRuns &&
    gate.finalHealth.incompleteTradeHistoryRuns <= gate.thresholds.incompleteTradeHistoryRuns &&
    gate.finalAlerts.openBacktestAlerts <= gate.thresholds.openBacktestAlerts &&
    (gate.thresholds.recoverableRuns === null ||
      gate.finalHealth.recoverableRuns <= gate.thresholds.recoverableRuns);

  const checks = {
    lifecycleSmokeRan: gate.smokeRan === true,
    minSoakSatisfied: gate.soakDurationMinutes >= MIN_SOAK_MINUTES,
    thresholdsSatisfied,
    externalDashboardsVerified: EXTERNAL_DASHBOARDS_VERIFIED,
    uiComposureVerified: UI_COMPOSURE_VERIFIED,
    resultsScalingVerified: RESULTS_SCALING_VERIFIED,
  };

  assert.equal(checks.lifecycleSmokeRan, true, 'release gate must include lifecycle smoke');
  assert.equal(
    checks.minSoakSatisfied,
    true,
    `release gate soak must be at least ${MIN_SOAK_MINUTES} minutes`
  );
  assert.equal(
    checks.thresholdsSatisfied,
    true,
    'release gate final snapshot exceeds one or more allowed thresholds'
  );
  assert.equal(
    checks.externalDashboardsVerified,
    true,
    'external dashboards/paging must be verified before final sign-off'
  );
  assert.equal(
    checks.uiComposureVerified,
    true,
    'frontend composure must be explicitly verified before final sign-off'
  );
  assert.equal(
    checks.resultsScalingVerified,
    true,
    'large-results hardening must be explicitly verified before final sign-off'
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
      pagerUrl: PAGER_URL || null,
      releaseNoteUrl: RELEASE_NOTE_URL || null,
    },
    gate,
  };

  await persistSummary(summary);
  await writeStepSummary(summary);
  console.log('backtests-signoff:', JSON.stringify(summary));
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
