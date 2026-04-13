import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

type EnvMap = Record<string, string | undefined>;
type JsonRecord = Record<string, unknown>;

const RELEASE_GATE_SCRIPT = String(
  process.env.POSITIONS_SCHEDULER_PROOF_RELEASE_GATE_SCRIPT ||
    'scripts/release-gates/release-gate-positions-scheduler.ts'
).trim();
const SIGNOFF_SCRIPT = String(
  process.env.POSITIONS_SCHEDULER_PROOF_SIGNOFF_SCRIPT ||
    'scripts/signoffs/signoff-positions-scheduler.ts'
).trim();
const GATE_FILE = String(
  process.env.POSITIONS_SCHEDULER_RELEASE_GATE_OUTPUT_FILE ||
    'artifacts/positions-scheduler-release-gate.json'
).trim();
const SIGNOFF_FILE = String(
  process.env.POSITIONS_SCHEDULER_SIGNOFF_OUTPUT_FILE ||
    'artifacts/positions-scheduler-signoff.json'
).trim();
const OUTPUT_FILE = String(
  process.env.POSITIONS_SCHEDULER_PROOF_OUTPUT_FILE ||
    'artifacts/positions-scheduler-live-proof.json'
).trim();

function readString(value: unknown): string {
  return String(value || '').trim();
}

function asRecord(value: unknown): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as JsonRecord;
}

function requireEnv(name: string): string {
  const value = String(process.env[name] || '').trim();
  assert.ok(value, `${name} is required for positions scheduler live proof`);
  return value;
}

function requireTrueEnv(name: string): void {
  const value = requireEnv(name).toLowerCase();
  assert.equal(value, 'true', `${name} must be set to true for positions scheduler live proof`);
}

async function runStep(label: string, scriptPath: string, envOverrides: EnvMap = {}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    console.log(`[positions-scheduler-proof] ${label}`);

    const child = spawn(process.execPath, ['--import', 'tsx', scriptPath], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...envOverrides,
      },
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${label} exited with code ${String(code)}`));
    });
  });
}

async function readJsonFile(filePath: string): Promise<JsonRecord> {
  const absolutePath = path.resolve(process.cwd(), filePath);
  const raw = await readFile(absolutePath, 'utf8');
  return asRecord(JSON.parse(raw));
}

async function persistSummary(summary: Record<string, unknown>): Promise<void> {
  if (!OUTPUT_FILE) {
    return;
  }

  const absolutePath = path.resolve(process.cwd(), OUTPUT_FILE);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
}

async function run(): Promise<void> {
  const approver = requireEnv('POSITIONS_SCHEDULER_SIGNOFF_APPROVER');
  requireTrueEnv('POSITIONS_SCHEDULER_SIGNOFF_DIAGNOSTICS_VERIFIED');
  requireTrueEnv('POSITIONS_SCHEDULER_SIGNOFF_PRODUCT_TRUST_VERIFIED');
  requireTrueEnv('POSITIONS_SCHEDULER_SIGNOFF_REBUILD_DRILL_VERIFIED');
  requireTrueEnv('POSITIONS_SCHEDULER_SIGNOFF_RECOVERY_HISTORY_VERIFIED');
  requireTrueEnv('POSITIONS_SCHEDULER_SIGNOFF_ACCESS_REVIEW_VERIFIED');
  requireEnv('POSITIONS_SCHEDULER_SIGNOFF_RECOVERY_EVIDENCE_URL');

  await runStep('release gate with live health checks', RELEASE_GATE_SCRIPT, {
    POSITIONS_SCHEDULER_RUN_LIVE_CHECKS:
      process.env.POSITIONS_SCHEDULER_RUN_LIVE_CHECKS || 'true',
    POSITIONS_SCHEDULER_RELEASE_GATE_OUTPUT_FILE: GATE_FILE,
  });

  await runStep('final signoff with live health requirement', SIGNOFF_SCRIPT, {
    POSITIONS_SCHEDULER_SIGNOFF_GATE_FILE: GATE_FILE,
    POSITIONS_SCHEDULER_SIGNOFF_OUTPUT_FILE: SIGNOFF_FILE,
    POSITIONS_SCHEDULER_SIGNOFF_REQUIRE_LIVE_HEALTH:
      process.env.POSITIONS_SCHEDULER_SIGNOFF_REQUIRE_LIVE_HEALTH || 'true',
  });

  const gate = await readJsonFile(GATE_FILE);
  const signoff = await readJsonFile(SIGNOFF_FILE);
  const signoffChecks = asRecord(signoff.checks);
  const signoffEvidence = asRecord(signoff.evidence);

  assert.equal(
    readString(gate.decision),
    'ready',
    'positions scheduler release gate must be ready'
  );
  assert.equal(
    asRecord(gate).liveChecksEnabled === true,
    true,
    'positions scheduler live proof must run the release gate with live checks enabled'
  );
  assert.equal(
    readString(signoff.decision),
    'ready',
    'positions scheduler signoff must be ready'
  );
  assert.equal(
    signoffChecks.liveHealthReviewed === true,
    true,
    'positions scheduler live proof must require live health review during signoff'
  );
  assert.equal(
    signoffChecks.recoveryHistoryVerified === true,
    true,
    'positions scheduler live proof must preserve recovery-history verification in signoff'
  );
  assert.ok(
    readString(signoffEvidence.recoveryEvidenceUrl),
    'positions scheduler live proof must carry a recovery evidence URL'
  );

  const summary = {
    decision: 'ready' as const,
    generatedAt: new Date().toISOString(),
    approver,
    releaseGateFile: path.resolve(process.cwd(), GATE_FILE),
    signoffFile: path.resolve(process.cwd(), SIGNOFF_FILE),
    proofOutputFile: path.resolve(process.cwd(), OUTPUT_FILE),
    gateDecision: readString(gate.decision) || null,
    signoffDecision: readString(signoff.decision) || null,
    liveChecksEnabled: asRecord(gate).liveChecksEnabled === true,
    gateTotals: asRecord(gate.totals),
    evidence: signoffEvidence,
    checks: signoffChecks,
  };

  await persistSummary(summary);
  console.log('positions-scheduler-live-proof:', JSON.stringify(summary));
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
