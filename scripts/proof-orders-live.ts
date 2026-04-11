import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

type EnvMap = Record<string, string | undefined>;
type JsonRecord = Record<string, unknown>;

const RELEASE_GATE_SCRIPT = String(
  process.env.ORDERS_PROOF_RELEASE_GATE_SCRIPT || 'scripts/release-gate-orders.ts'
).trim();
const SIGNOFF_SCRIPT = String(
  process.env.ORDERS_PROOF_SIGNOFF_SCRIPT || 'scripts/signoff-orders.ts'
).trim();
const GATE_FILE = String(
  process.env.ORDERS_RELEASE_GATE_OUTPUT_FILE || 'artifacts/orders-release-gate.json'
).trim();
const SIGNOFF_FILE = String(
  process.env.ORDERS_SIGNOFF_OUTPUT_FILE || 'artifacts/orders-signoff.json'
).trim();
const OUTPUT_FILE = String(
  process.env.ORDERS_PROOF_OUTPUT_FILE || 'artifacts/orders-live-proof.json'
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
  assert.ok(value, `${name} is required for orders live proof`);
  return value;
}

function requireTrueEnv(name: string): void {
  const value = requireEnv(name).toLowerCase();
  assert.equal(value, 'true', `${name} must be set to true for orders live proof`);
}

async function runStep(label: string, scriptPath: string, envOverrides: EnvMap = {}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    console.log(`[orders-proof] ${label}`);

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
  const approver = requireEnv('ORDERS_SIGNOFF_APPROVER');
  requireTrueEnv('ORDERS_SIGNOFF_EXTERNAL_DASHBOARDS_VERIFIED');
  requireTrueEnv('ORDERS_SIGNOFF_WRITE_READ_CONSISTENCY_VERIFIED');
  requireTrueEnv('ORDERS_SIGNOFF_SNAPSHOT_LAG_RUNBOOK_VERIFIED');
  requireTrueEnv('ORDERS_SIGNOFF_OPERATOR_FLOWS_VERIFIED');
  requireTrueEnv('ORDERS_SIGNOFF_SYNC_STATUS_VERIFIED');
  requireTrueEnv('ORDERS_SIGNOFF_MANUAL_REFRESH_VERIFIED');

  await runStep('release gate with live health checks', RELEASE_GATE_SCRIPT, {
    ORDERS_RUN_LIVE_CHECKS: process.env.ORDERS_RUN_LIVE_CHECKS || 'true',
    ORDERS_RELEASE_GATE_OUTPUT_FILE: GATE_FILE,
  });

  await runStep('final signoff with live health requirement', SIGNOFF_SCRIPT, {
    ORDERS_SIGNOFF_GATE_FILE: GATE_FILE,
    ORDERS_SIGNOFF_OUTPUT_FILE: SIGNOFF_FILE,
    ORDERS_SIGNOFF_REQUIRE_LIVE_HEALTH:
      process.env.ORDERS_SIGNOFF_REQUIRE_LIVE_HEALTH || 'true',
  });

  const gate = await readJsonFile(GATE_FILE);
  const signoff = await readJsonFile(SIGNOFF_FILE);

  assert.equal(readString(gate.decision), 'ready', 'orders release gate must be ready');
  assert.equal(
    asRecord(gate).liveChecksEnabled === true,
    true,
    'orders live proof must run the release gate with live checks enabled'
  );
  assert.equal(readString(signoff.decision), 'ready', 'orders signoff must be ready');

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
    evidence: asRecord(signoff.evidence),
    checks: asRecord(signoff.checks),
  };

  await persistSummary(summary);
  console.log('orders-live-proof:', JSON.stringify(summary));
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
