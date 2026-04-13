import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

type JsonRecord = Record<string, unknown>;

const GATE_FILE = String(
  process.env.ALERTS_SIGNOFF_GATE_FILE || 'artifacts/alerts-release-gate.json'
).trim();
const OUTPUT_FILE = String(process.env.ALERTS_SIGNOFF_OUTPUT_FILE || '').trim();
const STEP_SUMMARY_FILE = String(process.env.GITHUB_STEP_SUMMARY || '').trim();
const MIN_SOAK_MINUTES = Math.max(0, Number(process.env.ALERTS_SIGNOFF_MIN_SOAK_MINUTES || 0));
const DASHBOARDS_VERIFIED =
  String(process.env.ALERTS_SIGNOFF_DASHBOARDS_VERIFIED || '').trim().toLowerCase() === 'true';
const OPERATOR_FLOW_VERIFIED =
  String(process.env.ALERTS_SIGNOFF_OPERATOR_FLOW_VERIFIED || '').trim().toLowerCase() === 'true';
const OVERVIEW_VERIFIED =
  String(process.env.ALERTS_SIGNOFF_OVERVIEW_VERIFIED || '').trim().toLowerCase() === 'true';
const APPROVER = String(process.env.ALERTS_SIGNOFF_APPROVER || '').trim();

function asRecord(value: unknown): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as JsonRecord;
}

async function readGateSummary(): Promise<JsonRecord> {
  const absoluteGateFile = path.resolve(process.cwd(), GATE_FILE);
  const raw = await readFile(absoluteGateFile, 'utf8');
  return asRecord(JSON.parse(raw));
}

async function persistSummary(summary: Record<string, unknown>): Promise<void> {
  if (!OUTPUT_FILE) {
    return;
  }

  const absoluteOutputPath = path.resolve(process.cwd(), OUTPUT_FILE);
  await mkdir(path.dirname(absoluteOutputPath), { recursive: true });
  await writeFile(absoluteOutputPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
}

async function writeSummary(lines: string[]): Promise<void> {
  if (!STEP_SUMMARY_FILE) {
    return;
  }

  await writeFile(STEP_SUMMARY_FILE, `${lines.join('\n')}\n`, 'utf8');
}

async function run(): Promise<void> {
  const gate = await readGateSummary();
  const checksRecord = asRecord(gate.checks);
  const checks = {
    testSuiteRan: gate.testSuiteRan === true,
    samplesCollected: Number(gate.samples || 0) >= 1,
    minSoakSatisfied: Number(gate.soakDurationMinutes || 0) >= MIN_SOAK_MINUTES,
    thresholdsSatisfied: checksRecord.thresholdsSatisfied === true,
    dashboardsVerified: DASHBOARDS_VERIFIED,
    operatorFlowVerified: OPERATOR_FLOW_VERIFIED,
    overviewVerified: OVERVIEW_VERIFIED,
  };

  assert.equal(checks.testSuiteRan, true, 'alerts release gate must run the dedicated suite');
  assert.equal(checks.samplesCollected, true, 'alerts release gate must collect at least one sample');
  assert.equal(
    checks.minSoakSatisfied,
    true,
    `alerts release gate soak must be at least ${MIN_SOAK_MINUTES} minutes`
  );
  assert.equal(checks.thresholdsSatisfied, true, 'alerts release gate thresholds must pass');
  assert.equal(checks.dashboardsVerified, true, 'alerts dashboards must be verified');
  assert.equal(checks.operatorFlowVerified, true, 'alerts operator flow must be verified');
  assert.equal(checks.overviewVerified, true, 'alerts overview must be verified');

  const summary = {
    decision: 'ready' as const,
    generatedAt: new Date().toISOString(),
    gateFile: path.resolve(process.cwd(), GATE_FILE),
    approver: APPROVER || null,
    checks,
    gate,
  };

  await persistSummary(summary);
  await writeSummary([
    '## Alerts final sign-off',
    '',
    `- Decision: **ready**`,
    `- Gate file: \`${summary.gateFile}\``,
    `- Approver: ${summary.approver || 'n/a'}`,
    `- Test suite ran: ${checks.testSuiteRan ? 'yes' : 'no'}`,
    `- Samples collected: ${checks.samplesCollected ? 'yes' : 'no'}`,
    `- Thresholds satisfied: ${checks.thresholdsSatisfied ? 'yes' : 'no'}`,
    `- Dashboards verified: ${checks.dashboardsVerified ? 'yes' : 'no'}`,
    `- Operator flow verified: ${checks.operatorFlowVerified ? 'yes' : 'no'}`,
    `- Overview verified: ${checks.overviewVerified ? 'yes' : 'no'}`,
    '',
  ]);

  console.log('alerts-signoff:', JSON.stringify(summary));
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
