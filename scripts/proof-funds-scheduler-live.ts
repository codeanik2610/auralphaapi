import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

type EnvMap = Record<string, string | undefined>;
type JsonRecord = Record<string, unknown>;

const RELEASE_GATE_SCRIPT = String(
  process.env.FUNDS_SCHEDULER_PROOF_RELEASE_GATE_SCRIPT ||
    'scripts/release-gate-funds-scheduler.ts'
).trim();
const SIGNOFF_SCRIPT = String(
  process.env.FUNDS_SCHEDULER_PROOF_SIGNOFF_SCRIPT || 'scripts/signoff-funds-scheduler.ts'
).trim();
const GATE_FILE = String(
  process.env.FUNDS_SCHEDULER_RELEASE_GATE_OUTPUT_FILE ||
    'artifacts/funds-scheduler-release-gate.json'
).trim();
const SIGNOFF_FILE = String(
  process.env.FUNDS_SCHEDULER_SIGNOFF_OUTPUT_FILE || 'artifacts/funds-scheduler-signoff.json'
).trim();
const OUTPUT_FILE = String(
  process.env.FUNDS_SCHEDULER_PROOF_OUTPUT_FILE ||
    'artifacts/funds-scheduler-live-proof.json'
).trim();
const EVIDENCE_OUTPUT_FILE = String(
  process.env.FUNDS_SCHEDULER_EVIDENCE_OUTPUT_FILE ||
    'artifacts/funds-scheduler-deployment-evidence.json'
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
  assert.ok(value, `${name} is required for funds scheduler live proof`);
  return value;
}

function requireTrueEnv(name: string): void {
  const value = requireEnv(name).toLowerCase();
  assert.equal(value, 'true', `${name} must be set to true for funds scheduler live proof`);
}

async function runStep(label: string, scriptPath: string, envOverrides: EnvMap = {}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    console.log(`[funds-scheduler-proof] ${label}`);

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

async function persistSummary(filePath: string, summary: Record<string, unknown>): Promise<void> {
  if (!filePath) {
    return;
  }

  const absolutePath = path.resolve(process.cwd(), filePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
}

async function run(): Promise<void> {
  const approver = requireEnv('FUNDS_SCHEDULER_SIGNOFF_APPROVER');
  requireTrueEnv('FUNDS_SCHEDULER_SIGNOFF_DIAGNOSTICS_VERIFIED');
  requireTrueEnv('FUNDS_SCHEDULER_SIGNOFF_COVERAGE_VERIFIED');
  requireTrueEnv('FUNDS_SCHEDULER_SIGNOFF_PRODUCT_TRUST_VERIFIED');
  requireTrueEnv('FUNDS_SCHEDULER_SIGNOFF_HEALTH_THRESHOLDS_VERIFIED');
  requireTrueEnv('FUNDS_SCHEDULER_SIGNOFF_RECOVERY_DRILL_VERIFIED');
  requireTrueEnv('FUNDS_SCHEDULER_SIGNOFF_ACCESS_REVIEW_VERIFIED');

  await runStep('release gate with live health checks', RELEASE_GATE_SCRIPT, {
    FUNDS_SCHEDULER_RUN_LIVE_CHECKS:
      process.env.FUNDS_SCHEDULER_RUN_LIVE_CHECKS || 'true',
    FUNDS_SCHEDULER_RELEASE_GATE_OUTPUT_FILE: GATE_FILE,
  });

  await runStep('final signoff with live health requirement', SIGNOFF_SCRIPT, {
    FUNDS_SCHEDULER_SIGNOFF_GATE_FILE: GATE_FILE,
    FUNDS_SCHEDULER_SIGNOFF_OUTPUT_FILE: SIGNOFF_FILE,
    FUNDS_SCHEDULER_SIGNOFF_REQUIRE_LIVE_HEALTH:
      process.env.FUNDS_SCHEDULER_SIGNOFF_REQUIRE_LIVE_HEALTH || 'true',
  });

  const gate = await readJsonFile(GATE_FILE);
  const signoff = await readJsonFile(SIGNOFF_FILE);

  assert.equal(
    readString(gate.decision),
    'ready',
    'funds scheduler release gate must be ready'
  );
  assert.equal(
    asRecord(gate).liveChecksEnabled === true,
    true,
    'funds scheduler live proof must run the release gate with live checks enabled'
  );
  assert.equal(
    readString(signoff.decision),
    'ready',
    'funds scheduler signoff must be ready'
  );

  const summary = {
    decision: 'ready' as const,
    generatedAt: new Date().toISOString(),
    approver,
    releaseGateFile: path.resolve(process.cwd(), GATE_FILE),
    signoffFile: path.resolve(process.cwd(), SIGNOFF_FILE),
    proofOutputFile: path.resolve(process.cwd(), OUTPUT_FILE),
    deploymentEvidenceOutputFile: path.resolve(process.cwd(), EVIDENCE_OUTPUT_FILE),
    gateDecision: readString(gate.decision) || null,
    signoffDecision: readString(signoff.decision) || null,
    liveChecksEnabled: asRecord(gate).liveChecksEnabled === true,
    gateTotals: asRecord(gate.totals),
    evidence: asRecord(signoff.evidence),
    evidenceClassification: asRecord(signoff.evidenceClassification),
    environment: asRecord(signoff.environment),
    acknowledgements: asRecord(signoff.acknowledgements),
    checks: asRecord(signoff.checks),
    readiness: asRecord(signoff.readiness),
  };

  await persistSummary(OUTPUT_FILE, summary);

  const evidencePackage = {
    decision: 'ready' as const,
    generatedAt: new Date().toISOString(),
    approver,
    releaseGateFile: path.resolve(process.cwd(), GATE_FILE),
    signoffFile: path.resolve(process.cwd(), SIGNOFF_FILE),
    proofFile: path.resolve(process.cwd(), OUTPUT_FILE),
    evidenceOutputFile: path.resolve(process.cwd(), EVIDENCE_OUTPUT_FILE),
    gateDecision: readString(gate.decision) || null,
    signoffDecision: readString(signoff.decision) || null,
    liveChecksEnabled: asRecord(gate).liveChecksEnabled === true,
    deploymentPromotionReady: asRecord(signoff.readiness).productionPromotionReady === true,
    deploymentEvidenceReady: asRecord(signoff.readiness).deploymentEvidenceReady === true,
    thresholdProfileMode: readString(asRecord(signoff.readiness).thresholdProfileMode) || null,
    gateTotals: asRecord(gate.totals),
    evidence: asRecord(signoff.evidence),
    evidenceClassification: asRecord(signoff.evidenceClassification),
    environment: asRecord(signoff.environment),
    acknowledgements: asRecord(signoff.acknowledgements),
    checks: asRecord(signoff.checks),
    readiness: asRecord(signoff.readiness),
    thresholdProfile: asRecord(signoff.thresholdProfile),
    healthSnapshot: asRecord(gate.healthSnapshot),
  };

  await persistSummary(EVIDENCE_OUTPUT_FILE, evidencePackage);
  console.log('funds-scheduler-live-proof:', JSON.stringify(summary));
  console.log('funds-scheduler-deployment-evidence:', JSON.stringify(evidencePackage));
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
