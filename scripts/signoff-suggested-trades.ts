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
    staleTrackedTrades: number;
    refreshFailures24h: number;
    stateTransitionFailures24h: number;
    duplicateSuggestions24h: number;
    openAlerts: number;
    openActionAlerts: number;
    openExecutionAlerts: number;
    minQueueToOrderConversionRate: number;
    maxOverviewLatencyMs: number;
    maxListLatencyMs: number;
    maxSummaryLatencyMs: number;
    maxSyncStatusLatencyMs: number;
  };
  finalHealth: {
    status: string;
    rolloutEnabled: boolean;
    rolloutStage: string;
    syncState: string;
    staleTrackedTrades: number;
    refreshFailures24h: number;
    stateTransitionFailures24h: number;
    duplicateSuggestions24h: number;
    queueToOrderConversionRate: number | null;
    openAlerts: number;
    openActionAlerts: number;
    openExecutionAlerts: number;
    overviewLatencyMs: number | null;
    listLatencyMs: number | null;
    summaryLatencyMs: number | null;
    syncStatusLatencyMs: number | null;
    detail: string;
  };
};

const GATE_FILE = String(
  process.env.SUGGESTED_TRADES_SIGNOFF_GATE_FILE || 'artifacts/suggested-trades-release-gate.json'
).trim();
const OUTPUT_FILE = String(process.env.SUGGESTED_TRADES_SIGNOFF_OUTPUT_FILE || '').trim();
const STEP_SUMMARY_FILE = String(process.env.GITHUB_STEP_SUMMARY || '').trim();
const MIN_SOAK_MINUTES = Math.max(
  0,
  Number(process.env.SUGGESTED_TRADES_SIGNOFF_MIN_SOAK_MINUTES || 30)
);
const EXTERNAL_DASHBOARDS_VERIFIED =
  String(process.env.SUGGESTED_TRADES_SIGNOFF_EXTERNAL_DASHBOARDS_VERIFIED || '')
    .trim()
    .toLowerCase() === 'true';
const OPERATOR_FLOW_VERIFIED =
  String(process.env.SUGGESTED_TRADES_SIGNOFF_OPERATOR_FLOW_VERIFIED || '')
    .trim()
    .toLowerCase() === 'true';
const ROLLOUT_TOGGLE_VERIFIED =
  String(process.env.SUGGESTED_TRADES_SIGNOFF_ROLLOUT_TOGGLE_VERIFIED || '')
    .trim()
    .toLowerCase() === 'true';
const APPROVER = String(process.env.SUGGESTED_TRADES_SIGNOFF_APPROVER || '').trim();
const STAGING_WORKFLOW_URL = String(
  process.env.SUGGESTED_TRADES_SIGNOFF_STAGING_WORKFLOW_URL || ''
).trim();
const DASHBOARD_URL = String(process.env.SUGGESTED_TRADES_SIGNOFF_DASHBOARD_URL || '').trim();
const PAGER_URL = String(process.env.SUGGESTED_TRADES_SIGNOFF_PAGER_URL || '').trim();
const RELEASE_NOTE_URL = String(
  process.env.SUGGESTED_TRADES_SIGNOFF_RELEASE_NOTE_URL || ''
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

function readNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  return readNumber(value);
}

async function readGateSummary(): Promise<ReleaseGateSummary> {
  const absoluteGateFile = path.resolve(process.cwd(), GATE_FILE);
  const raw = await readFile(absoluteGateFile, 'utf8');
  const parsed = JSON.parse(raw) as JsonRecord;
  const thresholds = asRecord(parsed.thresholds);
  const finalHealth = asRecord(parsed.finalHealth);

  return {
    baseUrl: readString(parsed.baseUrl),
    smokeRan: Boolean(parsed.smokeRan),
    soakDurationMinutes: readNumber(parsed.soakDurationMinutes),
    samples: readNumber(parsed.samples),
    startedAt: readString(parsed.startedAt),
    finishedAt: readString(parsed.finishedAt),
    thresholds: {
      staleTrackedTrades: readNumber(thresholds.staleTrackedTrades),
      refreshFailures24h: readNumber(thresholds.refreshFailures24h),
      stateTransitionFailures24h: readNumber(thresholds.stateTransitionFailures24h),
      duplicateSuggestions24h: readNumber(thresholds.duplicateSuggestions24h),
      openAlerts: readNumber(thresholds.openAlerts),
      openActionAlerts: readNumber(thresholds.openActionAlerts),
      openExecutionAlerts: readNumber(thresholds.openExecutionAlerts),
      minQueueToOrderConversionRate: readNumber(thresholds.minQueueToOrderConversionRate),
      maxOverviewLatencyMs: readNumber(thresholds.maxOverviewLatencyMs),
      maxListLatencyMs: readNumber(thresholds.maxListLatencyMs),
      maxSummaryLatencyMs: readNumber(thresholds.maxSummaryLatencyMs),
      maxSyncStatusLatencyMs: readNumber(thresholds.maxSyncStatusLatencyMs),
    },
    finalHealth: {
      status: readString(finalHealth.status),
      rolloutEnabled: Boolean(finalHealth.rolloutEnabled),
      rolloutStage: readString(finalHealth.rolloutStage),
      syncState: readString(finalHealth.syncState),
      staleTrackedTrades: readNumber(finalHealth.staleTrackedTrades),
      refreshFailures24h: readNumber(finalHealth.refreshFailures24h),
      stateTransitionFailures24h: readNumber(finalHealth.stateTransitionFailures24h),
      duplicateSuggestions24h: readNumber(finalHealth.duplicateSuggestions24h),
      queueToOrderConversionRate: readNullableNumber(finalHealth.queueToOrderConversionRate),
      openAlerts: readNumber(finalHealth.openAlerts),
      openActionAlerts: readNumber(finalHealth.openActionAlerts),
      openExecutionAlerts: readNumber(finalHealth.openExecutionAlerts),
      overviewLatencyMs: readNullableNumber(finalHealth.overviewLatencyMs),
      listLatencyMs: readNullableNumber(finalHealth.listLatencyMs),
      summaryLatencyMs: readNullableNumber(finalHealth.summaryLatencyMs),
      syncStatusLatencyMs: readNullableNumber(finalHealth.syncStatusLatencyMs),
      detail: readString(finalHealth.detail),
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
    '## Suggested Trades final sign-off',
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
    `- operator flow verified: ${summary.checks.operatorFlowVerified ? 'yes' : 'no'}`,
    `- rollout toggle verified: ${summary.checks.rolloutToggleVerified ? 'yes' : 'no'}`,
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
    `- rolloutEnabled: ${summary.gate.finalHealth.rolloutEnabled ? 'yes' : 'no'}`,
    `- rolloutStage: ${summary.gate.finalHealth.rolloutStage}`,
    `- syncState: ${summary.gate.finalHealth.syncState}`,
    `- staleTrackedTrades: ${summary.gate.finalHealth.staleTrackedTrades}`,
    `- refreshFailures24h: ${summary.gate.finalHealth.refreshFailures24h}`,
    `- stateTransitionFailures24h: ${summary.gate.finalHealth.stateTransitionFailures24h}`,
    `- duplicateSuggestions24h: ${summary.gate.finalHealth.duplicateSuggestions24h}`,
    `- queueToOrderConversionRate: ${
      summary.gate.finalHealth.queueToOrderConversionRate === null
        ? 'n/a'
        : summary.gate.finalHealth.queueToOrderConversionRate
    }`,
    '',
  ];

  await writeFile(STEP_SUMMARY_FILE, `${lines.join('\n')}\n`, 'utf8');
}

async function run(): Promise<void> {
  const gate = await readGateSummary();

  const thresholdsSatisfied =
    readString(gate.finalHealth.status).toLowerCase() !== 'down' &&
    gate.finalHealth.rolloutEnabled === true &&
    gate.finalHealth.staleTrackedTrades <= gate.thresholds.staleTrackedTrades &&
    gate.finalHealth.refreshFailures24h <= gate.thresholds.refreshFailures24h &&
    gate.finalHealth.stateTransitionFailures24h <= gate.thresholds.stateTransitionFailures24h &&
    gate.finalHealth.duplicateSuggestions24h <= gate.thresholds.duplicateSuggestions24h &&
    gate.finalHealth.openAlerts <= gate.thresholds.openAlerts &&
    gate.finalHealth.openActionAlerts <= gate.thresholds.openActionAlerts &&
    gate.finalHealth.openExecutionAlerts <= gate.thresholds.openExecutionAlerts &&
    (gate.finalHealth.queueToOrderConversionRate === null
      ? gate.thresholds.minQueueToOrderConversionRate <= 0
      : gate.finalHealth.queueToOrderConversionRate >=
        gate.thresholds.minQueueToOrderConversionRate) &&
    (gate.finalHealth.overviewLatencyMs === null ||
      gate.finalHealth.overviewLatencyMs <= gate.thresholds.maxOverviewLatencyMs) &&
    (gate.finalHealth.listLatencyMs === null ||
      gate.finalHealth.listLatencyMs <= gate.thresholds.maxListLatencyMs) &&
    (gate.finalHealth.summaryLatencyMs === null ||
      gate.finalHealth.summaryLatencyMs <= gate.thresholds.maxSummaryLatencyMs) &&
    (gate.finalHealth.syncStatusLatencyMs === null ||
      gate.finalHealth.syncStatusLatencyMs <= gate.thresholds.maxSyncStatusLatencyMs);

  const checks = {
    lifecycleSmokeRan: gate.smokeRan === true,
    minSoakSatisfied: gate.soakDurationMinutes >= MIN_SOAK_MINUTES,
    thresholdsSatisfied,
    externalDashboardsVerified: EXTERNAL_DASHBOARDS_VERIFIED,
    operatorFlowVerified: OPERATOR_FLOW_VERIFIED,
    rolloutToggleVerified: ROLLOUT_TOGGLE_VERIFIED,
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
    checks.operatorFlowVerified,
    true,
    'operator suggested-trade flow must be explicitly verified before final sign-off'
  );
  assert.equal(
    checks.rolloutToggleVerified,
    true,
    'rollout toggle behavior must be explicitly verified before final sign-off'
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

  console.log('suggested-trades-signoff:', JSON.stringify(summary));
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
