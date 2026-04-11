import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

type EnvMap = Record<string, string | undefined>;
type JsonRecord = Record<string, unknown>;

const EXPECTED_SCHEDULER_KEYS = [
  'broker-assets-sync',
  'exchange-assets-sync',
  'binance-candles-3m-1m-sync',
  'system-health-sync',
];

const RELEASE_GATE_SCRIPT = String(
  process.env.GLOBAL_SYSTEM_SCHEDULERS_PROOF_RELEASE_GATE_SCRIPT ||
    'scripts/release-gate-global-system-schedulers.ts'
).trim();
const SIGNOFF_SCRIPT = String(
  process.env.GLOBAL_SYSTEM_SCHEDULERS_PROOF_SIGNOFF_SCRIPT ||
    'scripts/signoff-global-system-schedulers.ts'
).trim();
const GATE_FILE = String(
  process.env.GLOBAL_SYSTEM_SCHEDULERS_RELEASE_GATE_OUTPUT_FILE ||
    'artifacts/global-system-schedulers-release-gate.json'
).trim();
const SIGNOFF_FILE = String(
  process.env.GLOBAL_SYSTEM_SCHEDULERS_SIGNOFF_OUTPUT_FILE ||
    'artifacts/global-system-schedulers-signoff.json'
).trim();
const HEALTH_FILE = String(
  process.env.GLOBAL_SYSTEM_SCHEDULERS_HEALTH_OUTPUT_FILE ||
    'artifacts/global-system-schedulers-health.json'
).trim();
const OUTPUT_FILE = String(
  process.env.GLOBAL_SYSTEM_SCHEDULERS_PROOF_OUTPUT_FILE ||
    'artifacts/global-system-schedulers-live-proof.json'
).trim();
const EVIDENCE_OUTPUT_FILE = String(
  process.env.GLOBAL_SYSTEM_SCHEDULERS_EVIDENCE_OUTPUT_FILE ||
    'artifacts/global-system-schedulers-deployment-evidence.json'
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

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => readString(item)).filter(Boolean) : [];
}

function requireEnv(name: string): string {
  const value = String(process.env[name] || '').trim();
  assert.ok(value, `${name} is required for global system schedulers live proof`);
  return value;
}

function requireTrueEnv(name: string): void {
  const value = requireEnv(name).toLowerCase();
  assert.equal(
    value,
    'true',
    `${name} must be set to true for global system schedulers live proof`
  );
}

async function runStep(label: string, scriptPath: string, envOverrides: EnvMap = {}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    console.log(`[global-system-schedulers-proof] ${label}`);

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
  const approver = requireEnv('GLOBAL_SYSTEM_SCHEDULERS_SIGNOFF_APPROVER');
  requireTrueEnv('GLOBAL_SYSTEM_SCHEDULERS_SIGNOFF_OPERATOR_WORKSPACE_REVIEWED');
  requireTrueEnv('GLOBAL_SYSTEM_SCHEDULERS_SIGNOFF_SYSTEM_SCOPE_VERIFIED');
  requireTrueEnv('GLOBAL_SYSTEM_SCHEDULERS_SIGNOFF_AUDIT_CHAIN_VERIFIED');
  requireTrueEnv('GLOBAL_SYSTEM_SCHEDULERS_SIGNOFF_TIMEZONE_DISPLAY_VERIFIED');
  requireTrueEnv('GLOBAL_SYSTEM_SCHEDULERS_SIGNOFF_RETENTION_SCOPE_VERIFIED');
  requireTrueEnv('GLOBAL_SYSTEM_SCHEDULERS_SIGNOFF_WORKER_RUNTIME_VERIFIED');
  const requireDeploymentEvidence =
    String(process.env.GLOBAL_SYSTEM_SCHEDULERS_SIGNOFF_REQUIRE_DEPLOYMENT_EVIDENCE || 'false')
      .trim()
      .toLowerCase() === 'true';
  if (requireDeploymentEvidence) {
    requireEnv('GLOBAL_SYSTEM_SCHEDULERS_SIGNOFF_STAGING_WORKFLOW_URL');
    requireEnv('GLOBAL_SYSTEM_SCHEDULERS_SIGNOFF_DASHBOARD_URL');
    requireEnv('GLOBAL_SYSTEM_SCHEDULERS_SIGNOFF_RUNBOOK_URL');
    requireEnv('GLOBAL_SYSTEM_SCHEDULERS_SIGNOFF_RELEASE_NOTE_URL');
  }

  await runStep('release gate with live global system scheduler health', RELEASE_GATE_SCRIPT, {
    GLOBAL_SYSTEM_SCHEDULERS_RUN_LIVE_CHECKS:
      process.env.GLOBAL_SYSTEM_SCHEDULERS_RUN_LIVE_CHECKS || 'true',
    GLOBAL_SYSTEM_SCHEDULERS_RELEASE_GATE_OUTPUT_FILE: GATE_FILE,
    GLOBAL_SYSTEM_SCHEDULERS_HEALTH_OUTPUT_FILE: HEALTH_FILE,
  });

  await runStep('final signoff with live global system scheduler health requirement', SIGNOFF_SCRIPT, {
    GLOBAL_SYSTEM_SCHEDULERS_SIGNOFF_GATE_FILE: GATE_FILE,
    GLOBAL_SYSTEM_SCHEDULERS_SIGNOFF_OUTPUT_FILE: SIGNOFF_FILE,
    GLOBAL_SYSTEM_SCHEDULERS_SIGNOFF_REQUIRE_LIVE_HEALTH:
      process.env.GLOBAL_SYSTEM_SCHEDULERS_SIGNOFF_REQUIRE_LIVE_HEALTH || 'true',
    GLOBAL_SYSTEM_SCHEDULERS_SIGNOFF_REQUIRE_DEPLOYMENT_EVIDENCE:
      process.env.GLOBAL_SYSTEM_SCHEDULERS_SIGNOFF_REQUIRE_DEPLOYMENT_EVIDENCE || 'false',
  });

  const gate = await readJsonFile(GATE_FILE);
  const signoff = await readJsonFile(SIGNOFF_FILE);
  const health = await readJsonFile(HEALTH_FILE);
  const schedulerKeys = readStringArray(health.schedulerKeys);

  assert.equal(
    readString(gate.decision),
    'ready',
    'global system schedulers release gate must be ready'
  );
  assert.equal(
    asRecord(gate).liveChecksEnabled === true,
    true,
    'global system schedulers live proof must run the release gate with live checks enabled'
  );
  assert.equal(
    readString(signoff.decision),
    'ready',
    'global system schedulers signoff must be ready'
  );
  assert.equal(
    asRecord(signoff.readiness).productionPromotionReady === true,
    true,
    'global system schedulers live proof must only succeed when signoff is promotion ready'
  );
  if (requireDeploymentEvidence) {
    assert.equal(
      asRecord(signoff.readiness).deploymentEvidenceReady === true,
      true,
      'global system schedulers live proof must confirm deployment evidence readiness when required'
    );
  }
  assert.equal(
    readString(health.queueStatus),
    'ok',
    'global system schedulers live proof must confirm queue health'
  );
  assert.equal(
    readString(health.workerStatus),
    'ok',
    'global system schedulers live proof must confirm worker health'
  );
  assert.deepEqual(
    schedulerKeys,
    EXPECTED_SCHEDULER_KEYS,
    'global system schedulers live proof must confirm all four scheduler keys'
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
    checks: asRecord(signoff.checks),
    readiness: asRecord(signoff.readiness),
    coverage: asRecord(signoff.coverage),
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
    productionPromotionReady:
      asRecord(signoff.readiness).productionPromotionReady === true,
    subsystemCoverageReady: asRecord(signoff.readiness).subsystemCoverageReady === true,
    gateTotals: asRecord(gate.totals),
    evidence: asRecord(signoff.evidence),
    evidenceClassification: asRecord(signoff.evidenceClassification),
    environment: asRecord(signoff.environment),
    checks: asRecord(signoff.checks),
    readiness: asRecord(signoff.readiness),
    coverage: asRecord(signoff.coverage),
    healthSnapshot: health,
  };

  await persistSummary(EVIDENCE_OUTPUT_FILE, evidencePackage);
  console.log('global-system-schedulers-live-proof:', JSON.stringify(summary));
  console.log('global-system-schedulers-deployment-evidence:', JSON.stringify(evidencePackage));
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
