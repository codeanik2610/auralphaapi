import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

type EnvMap = Record<string, string | undefined>;
type JsonRecord = Record<string, unknown>;

const RELEASE_GATE_SCRIPT = String(
  process.env.BROKER_ASSETS_PROOF_RELEASE_GATE_SCRIPT ||
    'scripts/release-gates/release-gate-broker-assets.ts'
).trim();
const SIGNOFF_SCRIPT = String(
  process.env.BROKER_ASSETS_PROOF_SIGNOFF_SCRIPT || 'scripts/signoffs/signoff-broker-assets.ts'
).trim();
const HEALTH_SCRIPT = String(
  process.env.BROKER_ASSETS_PROOF_HEALTH_SCRIPT || 'scripts/checks/check-broker-assets-health.ts'
).trim();
const GATE_FILE = String(
  process.env.BROKER_ASSETS_RELEASE_GATE_OUTPUT_FILE ||
    'artifacts/broker-assets-release-gate.json'
).trim();
const SIGNOFF_FILE = String(
  process.env.BROKER_ASSETS_SIGNOFF_OUTPUT_FILE || 'artifacts/broker-assets-signoff.json'
).trim();
const HEALTH_FILE = String(
  process.env.BROKER_ASSETS_HEALTH_OUTPUT_FILE || 'artifacts/broker-assets-health.json'
).trim();
const OUTPUT_FILE = String(
  process.env.BROKER_ASSETS_PROOF_OUTPUT_FILE || 'artifacts/broker-assets-live-proof.json'
).trim();
const EVIDENCE_OUTPUT_FILE = String(
  process.env.BROKER_ASSETS_EVIDENCE_OUTPUT_FILE ||
    'artifacts/broker-assets-deployment-evidence.json'
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
  assert.ok(value, `${name} is required for broker-assets live proof`);
  return value;
}

function requireTrueEnv(name: string): void {
  const value = requireEnv(name).toLowerCase();
  assert.equal(value, 'true', `${name} must be set to true for broker-assets live proof`);
}

async function runStep(label: string, scriptPath: string, envOverrides: EnvMap = {}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    console.log(`[broker-assets-proof] ${label}`);

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
  try {
    return await readJsonFile(filePath);
  } catch {
    return null;
  }
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
  const approver = requireEnv('BROKER_ASSETS_SIGNOFF_APPROVER');
  requireTrueEnv('BROKER_ASSETS_SIGNOFF_GLOBAL_CATALOG_VERIFIED');
  requireTrueEnv('BROKER_ASSETS_SIGNOFF_CONNECTED_VISIBILITY_VERIFIED');
  requireTrueEnv('BROKER_ASSETS_SIGNOFF_DELTA_LOOKUP_VERIFIED');
  requireTrueEnv('BROKER_ASSETS_SIGNOFF_SOURCE_THRESHOLDS_VERIFIED');
  requireTrueEnv('BROKER_ASSETS_SIGNOFF_IDENTITY_CONSTRAINTS_REVIEWED');

  await runStep('release gate with live broker-assets health', RELEASE_GATE_SCRIPT, {
    BROKER_ASSETS_RUN_LIVE_CHECKS: process.env.BROKER_ASSETS_RUN_LIVE_CHECKS || 'true',
    BROKER_ASSETS_RELEASE_GATE_OUTPUT_FILE: GATE_FILE,
    BROKER_ASSETS_HEALTH_OUTPUT_FILE: HEALTH_FILE,
  });

  await runStep('final signoff with live broker-assets health requirement', SIGNOFF_SCRIPT, {
    BROKER_ASSETS_SIGNOFF_GATE_FILE: GATE_FILE,
    BROKER_ASSETS_SIGNOFF_OUTPUT_FILE: SIGNOFF_FILE,
    BROKER_ASSETS_SIGNOFF_PROOF_FILE: OUTPUT_FILE,
    BROKER_ASSETS_SIGNOFF_REQUIRE_LIVE_HEALTH:
      process.env.BROKER_ASSETS_SIGNOFF_REQUIRE_LIVE_HEALTH || 'true',
    BROKER_ASSETS_SIGNOFF_REQUIRE_LIVE_PROOF:
      process.env.BROKER_ASSETS_SIGNOFF_REQUIRE_LIVE_PROOF || 'false',
  });

  const gate = await readJsonFile(GATE_FILE);
  const signoff = await readJsonFile(SIGNOFF_FILE);
  const health =
    asRecord(gate.healthSnapshot).schedulerType ||
    asRecord(gate.healthSnapshot).queueStatus ||
    asRecord(gate.healthSnapshot).workerStatus
      ? asRecord(gate.healthSnapshot)
      : (await readOptionalJsonFile(HEALTH_FILE)) || {};

  assert.equal(readString(gate.decision), 'ready', 'broker-assets release gate must be ready');
  assert.equal(
    asRecord(gate).liveChecksEnabled === true,
    true,
    'broker-assets live proof must run the release gate with live checks enabled'
  );
  assert.equal(readString(signoff.decision), 'ready', 'broker-assets signoff must be ready');
  assert.equal(
    readString(health.schedulerType),
    'global',
    `broker-assets live proof must confirm the scheduler is global via ${HEALTH_SCRIPT}`
  );
  assert.equal(
    readString(health.queueStatus),
    'ok',
    'broker-assets live proof must confirm queue health'
  );
  assert.equal(
    readString(health.workerStatus),
    'ok',
    'broker-assets live proof must confirm worker health'
  );

  const summary = {
    decision: 'ready' as const,
    generatedAt: new Date().toISOString(),
    approver,
    releaseGateFile: path.resolve(process.cwd(), GATE_FILE),
    signoffFile: path.resolve(process.cwd(), SIGNOFF_FILE),
    healthFile: path.resolve(process.cwd(), HEALTH_FILE),
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
    thresholdProfile: asRecord(signoff.thresholdProfile),
    healthSnapshot: health,
  };

  await persistSummary(OUTPUT_FILE, summary);

  const evidencePackage = {
    decision: 'ready' as const,
    generatedAt: new Date().toISOString(),
    approver,
    releaseGateFile: path.resolve(process.cwd(), GATE_FILE),
    signoffFile: path.resolve(process.cwd(), SIGNOFF_FILE),
    healthFile: path.resolve(process.cwd(), HEALTH_FILE),
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
    healthSnapshot: health,
  };

  await persistSummary(EVIDENCE_OUTPUT_FILE, evidencePackage);
  console.log('broker-assets-live-proof:', JSON.stringify(summary));
  console.log('broker-assets-deployment-evidence:', JSON.stringify(evidencePackage));
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
