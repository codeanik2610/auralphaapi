import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

type EnvMap = Record<string, string | undefined>;
type JsonRecord = Record<string, unknown>;

const RELEASE_GATE_SCRIPT = String(
  process.env.FUNDS_SCHEDULER_PROMOTION_RELEASE_GATE_SCRIPT ||
    'scripts/release-gates/release-gate-funds-scheduler.ts'
).trim();
const SIGNOFF_SCRIPT = String(
  process.env.FUNDS_SCHEDULER_PROMOTION_SIGNOFF_SCRIPT || 'scripts/signoffs/signoff-funds-scheduler.ts'
).trim();
const GATE_FILE = String(
  process.env.FUNDS_SCHEDULER_RELEASE_GATE_OUTPUT_FILE ||
    'artifacts/funds-scheduler-release-gate.json'
).trim();
const SIGNOFF_FILE = String(
  process.env.FUNDS_SCHEDULER_SIGNOFF_OUTPUT_FILE || 'artifacts/funds-scheduler-signoff.json'
).trim();
const OUTPUT_FILE = String(
  process.env.FUNDS_SCHEDULER_PROMOTION_OUTPUT_FILE ||
    'artifacts/funds-scheduler-promotion-proof.json'
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
  assert.ok(value, `${name} is required for funds scheduler promotion proof`);
  return value;
}

function requireTrueEnv(name: string): void {
  const value = requireEnv(name).toLowerCase();
  assert.equal(value, 'true', `${name} must be set to true for funds scheduler promotion proof`);
}

function requireFalseEnv(name: string): void {
  const value = String(process.env[name] || '')
    .trim()
    .toLowerCase();
  assert.notEqual(
    value,
    'true',
    `${name} must not be true for funds scheduler promotion proof`
  );
}

async function runStep(label: string, scriptPath: string, envOverrides: EnvMap = {}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    console.log(`[funds-scheduler-promotion] ${label}`);

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

async function readOptionalJsonFile(filePath: string): Promise<JsonRecord | null> {
  const absolutePath = path.resolve(process.cwd(), filePath);
  if (!existsSync(absolutePath)) {
    return null;
  }
  return readJsonFile(filePath);
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
  const approver = requireEnv('FUNDS_SCHEDULER_SIGNOFF_APPROVER');
  requireTrueEnv('FUNDS_SCHEDULER_SIGNOFF_DIAGNOSTICS_VERIFIED');
  requireTrueEnv('FUNDS_SCHEDULER_SIGNOFF_COVERAGE_VERIFIED');
  requireTrueEnv('FUNDS_SCHEDULER_SIGNOFF_PRODUCT_TRUST_VERIFIED');
  requireTrueEnv('FUNDS_SCHEDULER_SIGNOFF_HEALTH_THRESHOLDS_VERIFIED');
  requireTrueEnv('FUNDS_SCHEDULER_SIGNOFF_RECOVERY_DRILL_VERIFIED');
  requireTrueEnv('FUNDS_SCHEDULER_SIGNOFF_ACCESS_REVIEW_VERIFIED');
  requireEnv('FUNDS_SCHEDULER_SIGNOFF_STAGING_WORKFLOW_URL');
  requireEnv('FUNDS_SCHEDULER_SIGNOFF_DASHBOARD_URL');
  requireEnv('FUNDS_SCHEDULER_SIGNOFF_RELEASE_NOTE_URL');
  requireFalseEnv('FUNDS_SCHEDULER_SIGNOFF_PLACEHOLDER_EVIDENCE_ACKNOWLEDGED');
  requireFalseEnv('FUNDS_SCHEDULER_SIGNOFF_UNBOUNDED_THRESHOLDS_ACKNOWLEDGED');

  try {
    await runStep('release gate with live health checks', RELEASE_GATE_SCRIPT, {
      FUNDS_SCHEDULER_RUN_LIVE_CHECKS:
        process.env.FUNDS_SCHEDULER_RUN_LIVE_CHECKS || 'true',
      FUNDS_SCHEDULER_RELEASE_GATE_OUTPUT_FILE: GATE_FILE,
    });

    await runStep('final signoff with promotion-ready requirement', SIGNOFF_SCRIPT, {
      FUNDS_SCHEDULER_SIGNOFF_GATE_FILE: GATE_FILE,
      FUNDS_SCHEDULER_SIGNOFF_OUTPUT_FILE: SIGNOFF_FILE,
      FUNDS_SCHEDULER_SIGNOFF_REQUIRE_LIVE_HEALTH:
        process.env.FUNDS_SCHEDULER_SIGNOFF_REQUIRE_LIVE_HEALTH || 'true',
      FUNDS_SCHEDULER_SIGNOFF_REQUIRE_DEPLOYMENT_EVIDENCE:
        process.env.FUNDS_SCHEDULER_SIGNOFF_REQUIRE_DEPLOYMENT_EVIDENCE || 'true',
      FUNDS_SCHEDULER_SIGNOFF_REQUIRE_PROMOTION_READY:
        process.env.FUNDS_SCHEDULER_SIGNOFF_REQUIRE_PROMOTION_READY || 'true',
    });

    const gate = await readJsonFile(GATE_FILE);
    const signoff = await readJsonFile(SIGNOFF_FILE);

    assert.equal(
      readString(gate.decision),
      'ready',
      'funds scheduler promotion proof requires a ready release gate'
    );
    assert.equal(
      asRecord(gate).liveChecksEnabled === true,
      true,
      'funds scheduler promotion proof must run the release gate with live checks enabled'
    );
    assert.equal(
      readString(signoff.decision),
      'ready',
      'funds scheduler promotion proof requires a ready signoff'
    );
    assert.equal(
      asRecord(signoff.readiness).productionPromotionReady === true,
      true,
      'funds scheduler promotion proof requires productionPromotionReady to be true'
    );

    const summary = {
      decision: 'ready' as const,
      generatedAt: new Date().toISOString(),
      approver,
      releaseGateFile: path.resolve(process.cwd(), GATE_FILE),
      signoffFile: path.resolve(process.cwd(), SIGNOFF_FILE),
      promotionProofFile: path.resolve(process.cwd(), OUTPUT_FILE),
      gateDecision: readString(gate.decision) || null,
      signoffDecision: readString(signoff.decision) || null,
      liveChecksEnabled: asRecord(gate).liveChecksEnabled === true,
      evidence: asRecord(signoff.evidence),
      evidenceClassification: asRecord(signoff.evidenceClassification),
      environment: asRecord(signoff.environment),
      acknowledgements: asRecord(signoff.acknowledgements),
      checks: asRecord(signoff.checks),
      readiness: asRecord(signoff.readiness),
      thresholdProfile: asRecord(signoff.thresholdProfile),
    };

    await persistSummary(summary);
    console.log('funds-scheduler-promotion-proof:', JSON.stringify(summary));
  } catch (error) {
    const gate = await readOptionalJsonFile(GATE_FILE);
    const signoff = await readOptionalJsonFile(SIGNOFF_FILE);
    const summary = {
      decision: 'blocked' as const,
      generatedAt: new Date().toISOString(),
      approver,
      releaseGateFile: path.resolve(process.cwd(), GATE_FILE),
      signoffFile: path.resolve(process.cwd(), SIGNOFF_FILE),
      promotionProofFile: path.resolve(process.cwd(), OUTPUT_FILE),
      gateDecision: gate ? readString(gate.decision) || null : null,
      signoffDecision: signoff ? readString(signoff.decision) || null : null,
      liveChecksEnabled: gate ? asRecord(gate).liveChecksEnabled === true : false,
      reason: error instanceof Error ? error.message : String(error),
      evidence: signoff ? asRecord(signoff.evidence) : {},
      evidenceClassification: signoff ? asRecord(signoff.evidenceClassification) : {},
      environment: signoff ? asRecord(signoff.environment) : {},
      acknowledgements: signoff ? asRecord(signoff.acknowledgements) : {},
      checks: signoff ? asRecord(signoff.checks) : {},
      readiness: signoff ? asRecord(signoff.readiness) : {},
      thresholdProfile: signoff ? asRecord(signoff.thresholdProfile) : {},
    };

    await persistSummary(summary);
    console.error('funds-scheduler-promotion-proof:', JSON.stringify(summary));
    throw error;
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
