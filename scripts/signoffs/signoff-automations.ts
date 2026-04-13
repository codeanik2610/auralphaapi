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
    failedRuns24h: number;
    overlapSkips24h: number;
    staleCursorCount: number;
    openAutomationAlerts: number;
    openControlAlerts: number;
    openRecoveryAlerts: number;
    openExecutionAlerts: number;
  };
  finalHealth: {
    status: string;
    workerStatus: string;
    queueStatus: string;
    failedRuns24h: number;
    overlapSkips24h: number;
    staleCursorCount: number;
    totalAutomations: number;
    runningAutomations: number;
    pausedAutomations: number;
    detail: string;
  };
  finalAlerts: {
    openAutomationAlerts: number;
    ids: string[];
    messages: string[];
  };
};

const GATE_FILE = String(
  process.env.AUTOMATIONS_SIGNOFF_GATE_FILE || 'artifacts/automations-release-gate.json'
).trim();
const OUTPUT_FILE = String(process.env.AUTOMATIONS_SIGNOFF_OUTPUT_FILE || '').trim();
const STEP_SUMMARY_FILE = String(process.env.GITHUB_STEP_SUMMARY || '').trim();
const MIN_SOAK_MINUTES = Math.max(
  0,
  Number(process.env.AUTOMATIONS_SIGNOFF_MIN_SOAK_MINUTES || 30)
);
const EXTERNAL_DASHBOARDS_VERIFIED =
  String(process.env.AUTOMATIONS_SIGNOFF_EXTERNAL_DASHBOARDS_VERIFIED || '')
    .trim()
    .toLowerCase() === 'true';
const OPERATOR_RECOVERY_VERIFIED =
  String(process.env.AUTOMATIONS_SIGNOFF_OPERATOR_RECOVERY_VERIFIED || '')
    .trim()
    .toLowerCase() === 'true';
const SCHEDULE_AUDIT_VERIFIED =
  String(process.env.AUTOMATIONS_SIGNOFF_SCHEDULE_AUDIT_VERIFIED || '')
    .trim()
    .toLowerCase() === 'true';
const APPROVER = String(process.env.AUTOMATIONS_SIGNOFF_APPROVER || '').trim();
const STAGING_WORKFLOW_URL = String(
  process.env.AUTOMATIONS_SIGNOFF_STAGING_WORKFLOW_URL || ''
).trim();
const DASHBOARD_URL = String(process.env.AUTOMATIONS_SIGNOFF_DASHBOARD_URL || '').trim();
const PAGER_URL = String(process.env.AUTOMATIONS_SIGNOFF_PAGER_URL || '').trim();
const RELEASE_NOTE_URL = String(process.env.AUTOMATIONS_SIGNOFF_RELEASE_NOTE_URL || '').trim();

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
      failedRuns24h: readNumber(thresholds.failedRuns24h),
      overlapSkips24h: readNumber(thresholds.overlapSkips24h),
      staleCursorCount: readNumber(thresholds.staleCursorCount),
      openAutomationAlerts: readNumber(thresholds.openAutomationAlerts),
      openControlAlerts: readNumber(thresholds.openControlAlerts),
      openRecoveryAlerts: readNumber(thresholds.openRecoveryAlerts),
      openExecutionAlerts: readNumber(thresholds.openExecutionAlerts),
    },
    finalHealth: {
      status: readString(finalHealth.status),
      workerStatus: readString(finalHealth.workerStatus),
      queueStatus: readString(finalHealth.queueStatus),
      failedRuns24h: readNumber(finalHealth.failedRuns24h),
      overlapSkips24h: readNumber(finalHealth.overlapSkips24h),
      staleCursorCount: readNumber(finalHealth.staleCursorCount),
      totalAutomations: readNumber(finalHealth.totalAutomations),
      runningAutomations: readNumber(finalHealth.runningAutomations),
      pausedAutomations: readNumber(finalHealth.pausedAutomations),
      detail: readString(finalHealth.detail),
    },
    finalAlerts: {
      openAutomationAlerts: readNumber(finalAlerts.openAutomationAlerts),
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
    '## Automations final sign-off',
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
    `- operator recovery verified: ${summary.checks.operatorRecoveryVerified ? 'yes' : 'no'}`,
    `- schedule/timezone audit verified: ${summary.checks.scheduleAuditVerified ? 'yes' : 'no'}`,
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
    `- workerStatus: ${summary.gate.finalHealth.workerStatus}`,
    `- queueStatus: ${summary.gate.finalHealth.queueStatus}`,
    `- failedRuns24h: ${summary.gate.finalHealth.failedRuns24h}`,
    `- overlapSkips24h: ${summary.gate.finalHealth.overlapSkips24h}`,
    `- staleCursorCount: ${summary.gate.finalHealth.staleCursorCount}`,
    `- openAutomationAlerts: ${summary.gate.finalAlerts.openAutomationAlerts}`,
    '',
  ];

  await writeFile(STEP_SUMMARY_FILE, `${lines.join('\n')}\n`, 'utf8');
}

async function run(): Promise<void> {
  const gate = await readGateSummary();

  const thresholdsSatisfied =
    readString(gate.finalHealth.status).toLowerCase() !== 'down' &&
    readString(gate.finalHealth.workerStatus).toLowerCase() === 'ok' &&
    readString(gate.finalHealth.queueStatus).toLowerCase() === 'ok' &&
    gate.finalHealth.failedRuns24h <= gate.thresholds.failedRuns24h &&
    gate.finalHealth.overlapSkips24h <= gate.thresholds.overlapSkips24h &&
    gate.finalHealth.staleCursorCount <= gate.thresholds.staleCursorCount &&
    gate.finalAlerts.openAutomationAlerts <= gate.thresholds.openAutomationAlerts;

  const checks = {
    lifecycleSmokeRan: gate.smokeRan === true,
    minSoakSatisfied: gate.soakDurationMinutes >= MIN_SOAK_MINUTES,
    thresholdsSatisfied,
    externalDashboardsVerified: EXTERNAL_DASHBOARDS_VERIFIED,
    operatorRecoveryVerified: OPERATOR_RECOVERY_VERIFIED,
    scheduleAuditVerified: SCHEDULE_AUDIT_VERIFIED,
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
    checks.operatorRecoveryVerified,
    true,
    'operator recovery controls must be explicitly verified before final sign-off'
  );
  assert.equal(
    checks.scheduleAuditVerified,
    true,
    'schedule/timezone behavior must be explicitly verified before final sign-off'
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
  console.log('automations-signoff:', JSON.stringify(summary));
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
