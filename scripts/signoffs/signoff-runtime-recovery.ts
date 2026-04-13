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
  runtimeHealthSnapshotFile?: string | null;
  runtimeHealthSnapshot: JsonRecord | null;
  totals: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
  };
  results: ReleaseGateResult[];
};

const GATE_FILE = String(
  process.env.RUNTIME_RECOVERY_SIGNOFF_GATE_FILE ||
    'artifacts/runtime-recovery-release-gate.json'
).trim();
const OUTPUT_FILE = String(
  process.env.RUNTIME_RECOVERY_SIGNOFF_OUTPUT_FILE ||
    'artifacts/runtime-recovery-signoff.json'
).trim();
const STEP_SUMMARY_FILE = String(process.env.GITHUB_STEP_SUMMARY || '').trim();
const REQUIRE_LIVE_HEALTH =
  String(process.env.RUNTIME_RECOVERY_SIGNOFF_REQUIRE_LIVE_HEALTH || 'false')
    .trim()
    .toLowerCase() === 'true';
const OPERATOR_DRILL_REVIEWED =
  String(process.env.RUNTIME_RECOVERY_SIGNOFF_OPERATOR_DRILL_REVIEWED || '')
    .trim()
    .toLowerCase() === 'true';
const APPROVER = String(process.env.RUNTIME_RECOVERY_SIGNOFF_APPROVER || '').trim();
const WORKFLOW_URL = String(process.env.RUNTIME_RECOVERY_SIGNOFF_WORKFLOW_URL || '').trim();
const DASHBOARD_URL = String(process.env.RUNTIME_RECOVERY_SIGNOFF_DASHBOARD_URL || '').trim();
const RUNBOOK_URL = String(process.env.RUNTIME_RECOVERY_SIGNOFF_RUNBOOK_URL || '').trim();

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
    runtimeHealthSnapshotFile: readString(parsed.runtimeHealthSnapshotFile) || null,
    runtimeHealthSnapshot:
      parsed.runtimeHealthSnapshot && typeof parsed.runtimeHealthSnapshot === 'object'
        ? asRecord(parsed.runtimeHealthSnapshot)
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

async function persistSummary(summary: Record<string, unknown>): Promise<void> {
  if (!OUTPUT_FILE) {
    return;
  }

  const absoluteOutputPath = path.resolve(process.cwd(), OUTPUT_FILE);
  await mkdir(path.dirname(absoluteOutputPath), { recursive: true });
  await writeFile(absoluteOutputPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
}

async function writeStepSummary(summary: Record<string, unknown>): Promise<void> {
  if (!STEP_SUMMARY_FILE) {
    return;
  }

  const readiness = asRecord(summary.readiness);
  const evidence = asRecord(summary.evidence);
  const lines = [
    '## Runtime recovery sign-off',
    '',
    `- Decision: **${String(summary.decision || 'blocked')}**`,
    `- Gate file: ${String(summary.gateFile || GATE_FILE)}`,
    `- Approver: ${String(summary.approver || 'unassigned')}`,
    '',
    '### Readiness',
    '',
    `- gate ready: ${String(readiness.gateReady === true)}`,
    `- live health satisfied: ${String(readiness.liveHealthSatisfied === true)}`,
    `- operator drill reviewed: ${String(readiness.operatorDrillReviewed === true)}`,
    '',
    '### Evidence',
    '',
    `- workflow: ${String(evidence.workflowUrl || 'n/a')}`,
    `- dashboard: ${String(evidence.dashboardUrl || 'n/a')}`,
    `- runbook: ${String(evidence.runbookUrl || 'n/a')}`,
    '',
  ];

  await writeFile(STEP_SUMMARY_FILE, `${lines.join('\n')}\n`, 'utf8');
}

async function run(): Promise<void> {
  const gate = await readGateSummary();
  const runtimeHealth = asRecord(gate.runtimeHealthSnapshot);
  const resultsByKey = new Map(gate.results.map((result) => [result.key, result]));
  const runtimeHealthResult = resultsByKey.get('runtime-health');

  const readiness = {
    gateReady: gate.decision === 'ready' && gate.totals.failed === 0,
    liveHealthSatisfied:
      !REQUIRE_LIVE_HEALTH ||
      (gate.liveChecksEnabled === true &&
        runtimeHealthResult?.status === 'passed' &&
        readString(runtimeHealth.status).toLowerCase() !== 'down'),
    operatorDrillReviewed: OPERATOR_DRILL_REVIEWED,
  };

  const summary = {
    decision:
      readiness.gateReady &&
      readiness.liveHealthSatisfied &&
      readiness.operatorDrillReviewed
        ? 'ready'
        : 'blocked',
    gateFile: GATE_FILE,
    approver: APPROVER || null,
    evidence: {
      workflowUrl: WORKFLOW_URL || null,
      dashboardUrl: DASHBOARD_URL || null,
      runbookUrl: RUNBOOK_URL || null,
    },
    readiness,
    gate,
  };

  await persistSummary(summary);
  await writeStepSummary(summary);
  console.log(JSON.stringify(summary, null, 2));

  assert.equal(gate.decision, 'ready', 'runtime recovery release gate must be ready');
  assert.equal(gate.totals.failed, 0, 'runtime recovery release gate cannot contain failed checks');
  if (REQUIRE_LIVE_HEALTH) {
    assert.equal(gate.liveChecksEnabled, true, 'runtime recovery sign-off requires live checks');
    assert.equal(
      runtimeHealthResult?.status,
      'passed',
      'runtime health check must pass when live health is required'
    );
    assert.notEqual(
      readString(runtimeHealth.status).toLowerCase(),
      'down',
      'runtime health snapshot cannot be down when live health is required'
    );
  }
  assert.equal(
    OPERATOR_DRILL_REVIEWED,
    true,
    'runtime recovery sign-off requires OPERATOR_DRILL_REVIEWED=true'
  );

  if (summary.decision !== 'ready') {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
