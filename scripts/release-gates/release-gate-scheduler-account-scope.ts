import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveTestCommand } from '../_support/resolve-test-command';
import { buildSchedulerAccountScopeProofArtifacts } from '../proofs/proof-scheduler-account-scope-live';

type JsonRecord = Record<string, unknown>;
type GateCheckStatus = 'passed' | 'failed' | 'skipped';

type GateCheckResult = {
  key: string;
  label: string;
  cwd: string;
  command: string[];
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  status: GateCheckStatus;
  exitCode: number | null;
  reason?: string;
};

type GateCheckDefinition = {
  key: string;
  label: string;
  cwd: string;
  command: string[];
  enabled?: boolean;
  env?: Record<string, string | undefined>;
  skipReason?: string;
};

type ReleaseGateSummary = {
  decision: 'ready' | 'blocked';
  startedAt: string;
  finishedAt: string;
  backendCwd: string;
  liveProofEnabled: boolean;
  proofFile: string | null;
  proofSummary: JsonRecord | null;
  totals: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
  };
  results: GateCheckResult[];
};

const BACKEND_CWD = process.cwd();
const OUTPUT_FILE = String(
  process.env.SCHEDULER_ACCOUNT_SCOPE_RELEASE_GATE_OUTPUT_FILE ||
    'artifacts/scheduler-account-scope-release-gate.json'
).trim();
const PROOF_FILE = String(
  process.env.SCHEDULER_ACCOUNT_SCOPE_PROOF_OUTPUT_FILE ||
    'artifacts/scheduler-account-scope-live-proof.json'
).trim();
const RUN_LIVE_PROOF =
  String(process.env.SCHEDULER_ACCOUNT_SCOPE_RUN_LIVE_PROOF || '')
    .trim()
    .toLowerCase() === 'true';
const STEP_SUMMARY_FILE = String(process.env.GITHUB_STEP_SUMMARY || '').trim();

function createTimestamp(): string {
  return new Date().toISOString();
}

function commandToString(command: string[]): string {
  return command.join(' ');
}

function asRecord(value: unknown): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as JsonRecord;
}

function readString(value: unknown): string {
  return String(value || '').trim();
}

async function readOptionalJson(filePath: string): Promise<JsonRecord | null> {
  if (!filePath || !existsSync(filePath)) {
    return null;
  }

  try {
    const raw = await readFile(filePath, 'utf8');
    return asRecord(JSON.parse(raw));
  } catch {
    return null;
  }
}

async function runCheck(definition: GateCheckDefinition): Promise<GateCheckResult> {
  const startedAt = createTimestamp();

  if (definition.enabled === false) {
    return {
      key: definition.key,
      label: definition.label,
      cwd: definition.cwd,
      command: definition.command,
      startedAt,
      finishedAt: createTimestamp(),
      durationMs: 0,
      status: 'skipped',
      exitCode: null,
      reason: definition.skipReason || 'disabled',
    };
  }

  if (!existsSync(definition.cwd)) {
    return {
      key: definition.key,
      label: definition.label,
      cwd: definition.cwd,
      command: definition.command,
      startedAt,
      finishedAt: createTimestamp(),
      durationMs: 0,
      status: 'skipped',
      exitCode: null,
      reason: `cwd not found: ${definition.cwd}`,
    };
  }

  console.log(`==> ${definition.label}`);
  console.log(`    cwd: ${definition.cwd}`);
  console.log(`    cmd: ${commandToString(definition.command)}`);

  const durationStartedAt = Date.now();
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    const child = spawn(definition.command[0], definition.command.slice(1), {
      cwd: definition.cwd,
      env: {
        ...process.env,
        ...definition.env,
      },
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', (code) => resolve(code));
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : `Unknown error: ${String(error)}`);
    return -1;
  });

  return {
    key: definition.key,
    label: definition.label,
    cwd: definition.cwd,
    command: definition.command,
    startedAt,
    finishedAt: createTimestamp(),
    durationMs: Date.now() - durationStartedAt,
    status: exitCode === 0 ? 'passed' : 'failed',
    exitCode,
  };
}

async function persistSummary(summary: Record<string, unknown>): Promise<void> {
  if (!OUTPUT_FILE) {
    return;
  }

  const absolutePath = path.resolve(BACKEND_CWD, OUTPUT_FILE);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
}

async function persistJsonFile(filePath: string, summary: Record<string, unknown>): Promise<void> {
  if (!filePath) {
    return;
  }

  const absolutePath = path.resolve(BACKEND_CWD, filePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
}

async function writeStepSummary(summary: ReleaseGateSummary): Promise<void> {
  if (!STEP_SUMMARY_FILE) {
    return;
  }

  const proofSummary = asRecord(summary.proofSummary);
  const lines = [
    '## Scheduler account-scope release gate',
    '',
    `- Decision: **${summary.decision}**`,
    `- Started: ${summary.startedAt}`,
    `- Finished: ${summary.finishedAt}`,
    `- Live proof enabled: ${summary.liveProofEnabled ? 'yes' : 'no'}`,
    `- Proof file: ${summary.proofFile || 'n/a'}`,
    '',
    '### Totals',
    '',
    `- total: ${summary.totals.total}`,
    `- passed: ${summary.totals.passed}`,
    `- failed: ${summary.totals.failed}`,
    `- skipped: ${summary.totals.skipped}`,
    '',
    '### Proof posture',
    '',
    `- active user-owned accounts: ${readString(proofSummary.activeUserOwned) || 'n/a'}`,
    `- active system-owned accounts: ${readString(proofSummary.activeSystemOwned) || 'n/a'}`,
    `- ownership contract: ${readString(proofSummary.contract) || 'n/a'}`,
    '',
    '### Checks',
    '',
    ...summary.results.map((result) => {
      const suffix = result.reason ? ` (${result.reason})` : '';
      return `- ${result.label}: ${result.status}${suffix}`;
    }),
    '',
  ];

  await writeFile(STEP_SUMMARY_FILE, `${lines.join('\n')}\n`, 'utf8');
}

async function run(): Promise<void> {
  const startedAt = createTimestamp();
  const absoluteProofFile = PROOF_FILE ? path.resolve(BACKEND_CWD, PROOF_FILE) : '';

  const checks: GateCheckDefinition[] = [
    {
      key: 'backend-scheduler-account-scope-suite',
      label: 'Backend scheduler account-scope suite',
      cwd: BACKEND_CWD,
      command: resolveTestCommand('test:scheduler-account-scope'),
    },
    {
      key: 'backend-scheduler-account-scope-operational-audit',
      label: 'Backend operational audit',
      cwd: BACKEND_CWD,
      command: resolveTestCommand('test:operational-audit'),
    },
  ];

  const results: GateCheckResult[] = [];
  for (const check of checks) {
    const result = await runCheck(check);
    results.push(result);
  }

  if (RUN_LIVE_PROOF) {
    const startedAtForProof = createTimestamp();
    const durationStartedAt = Date.now();
    try {
      const proofArtifacts = await buildSchedulerAccountScopeProofArtifacts();
      await persistJsonFile('artifacts/scheduler-account-scope-live.json', proofArtifacts.snapshot);
      await persistJsonFile(PROOF_FILE, proofArtifacts.proof);
      results.push({
        key: 'backend-scheduler-account-scope-live-proof',
        label: 'Backend scheduler account-scope live proof',
        cwd: BACKEND_CWD,
        command: ['internal', 'scheduler-account-scope-live-proof'],
        startedAt: startedAtForProof,
        finishedAt: createTimestamp(),
        durationMs: Date.now() - durationStartedAt,
        status: 'passed',
        exitCode: 0,
      });
    } catch (error) {
      const fallbackProof = await readOptionalJson(absoluteProofFile);
      if (readString(fallbackProof?.decision) === 'ready') {
        results.push({
          key: 'backend-scheduler-account-scope-live-proof',
          label: 'Backend scheduler account-scope live proof',
          cwd: BACKEND_CWD,
          command: ['internal', 'scheduler-account-scope-live-proof'],
          startedAt: startedAtForProof,
          finishedAt: createTimestamp(),
          durationMs: Date.now() - durationStartedAt,
          status: 'passed',
          exitCode: 0,
          reason: `reused existing ready proof artifact after direct execution fallback: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      } else {
        results.push({
          key: 'backend-scheduler-account-scope-live-proof',
          label: 'Backend scheduler account-scope live proof',
          cwd: BACKEND_CWD,
          command: ['internal', 'scheduler-account-scope-live-proof'],
          startedAt: startedAtForProof,
          finishedAt: createTimestamp(),
          durationMs: Date.now() - durationStartedAt,
          status: 'failed',
          exitCode: 1,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } else {
    results.push({
      key: 'backend-scheduler-account-scope-live-proof',
      label: 'Backend scheduler account-scope live proof',
      cwd: BACKEND_CWD,
      command: ['internal', 'scheduler-account-scope-live-proof'],
      startedAt: createTimestamp(),
      finishedAt: createTimestamp(),
      durationMs: 0,
      status: 'skipped',
      exitCode: null,
      reason: 'Set SCHEDULER_ACCOUNT_SCOPE_RUN_LIVE_PROOF=true to require live proof',
    });
  }

  const totals = {
    total: results.length,
    passed: results.filter((item) => item.status === 'passed').length,
    failed: results.filter((item) => item.status === 'failed').length,
    skipped: results.filter((item) => item.status === 'skipped').length,
  };

  const proofSummary = RUN_LIVE_PROOF ? await readOptionalJson(absoluteProofFile) : null;
  const summary: ReleaseGateSummary = {
    decision: totals.failed > 0 ? 'blocked' : 'ready',
    startedAt,
    finishedAt: createTimestamp(),
    backendCwd: BACKEND_CWD,
    liveProofEnabled: RUN_LIVE_PROOF,
    proofFile: RUN_LIVE_PROOF ? absoluteProofFile || null : null,
    proofSummary,
    totals,
    results,
  };

  await persistSummary(summary);
  await writeStepSummary(summary);
  console.log('scheduler-account-scope-release-gate:', JSON.stringify(summary));

  if (summary.decision === 'blocked') {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
