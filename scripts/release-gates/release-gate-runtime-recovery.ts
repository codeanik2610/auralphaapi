import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveTestCommand } from '../_support/resolve-test-command';

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
  workerCwd: string;
  discoveryCwd: string;
  liveChecksEnabled: boolean;
  runtimeHealthSnapshotFile: string | null;
  runtimeHealthSnapshot: JsonRecord | null;
  totals: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
  };
  results: GateCheckResult[];
};

const BACKEND_CWD = process.cwd();
const WORKER_CWD = String(
  process.env.RUNTIME_RECOVERY_WORKER_CWD ||
    '/Users/apple/Documents/Project/Backend/aurAlphaSchedulerWorker'
).trim();
const DISCOVERY_CWD = String(
  process.env.RUNTIME_RECOVERY_DISCOVERY_CWD ||
    '/Users/apple/Documents/Project/Backend/discovery-engine'
).trim();
const DISCOVERY_PYTHON = String(
  process.env.RUNTIME_RECOVERY_DISCOVERY_PYTHON ||
    '/Users/apple/Documents/Project/Backend/discovery-engine/.venv/bin/python'
).trim();
const OUTPUT_FILE = String(
  process.env.RUNTIME_RECOVERY_RELEASE_GATE_OUTPUT_FILE ||
    'artifacts/runtime-recovery-release-gate.json'
).trim();
const RUNTIME_HEALTH_FILE = String(
  process.env.RUNTIME_HEALTH_OUTPUT_FILE || 'artifacts/runtime-health.json'
).trim();
const RUN_LIVE_CHECKS =
  String(process.env.RUNTIME_RECOVERY_RUN_LIVE_CHECKS || '').trim().toLowerCase() === 'true';
const STEP_SUMMARY_FILE = String(process.env.GITHUB_STEP_SUMMARY || '').trim();
const WORKER_RECONCILIATION_ENTRY = path.join(
  WORKER_CWD,
  'dist',
  'src',
  'scheduler',
  'queue',
  'SchedulerCommandPoller.js'
);
const RUNTIME_RECOVERY_AUTOMATIONS_MAX_FAILED_RUNS_24H = String(
  process.env.RUNTIME_RECOVERY_AUTOMATIONS_MAX_FAILED_RUNS_24H ||
    process.env.AUTOMATIONS_MAX_FAILED_RUNS_24H ||
    '500'
).trim();
const RUNTIME_RECOVERY_AUTOMATIONS_MAX_OVERLAP_SKIPS_24H = String(
  process.env.RUNTIME_RECOVERY_AUTOMATIONS_MAX_OVERLAP_SKIPS_24H ||
    process.env.AUTOMATIONS_MAX_OVERLAP_SKIPS_24H ||
    '5000'
).trim();
const RUNTIME_RECOVERY_AUTOMATIONS_MAX_STALE_CURSORS = String(
  process.env.RUNTIME_RECOVERY_AUTOMATIONS_MAX_STALE_CURSORS ||
    process.env.AUTOMATIONS_MAX_STALE_CURSORS ||
    '5'
).trim();
const RUNTIME_RECOVERY_AUTOMATIONS_MAX_OPEN_ALERTS = String(
  process.env.RUNTIME_RECOVERY_AUTOMATIONS_MAX_OPEN_ALERTS ||
    process.env.AUTOMATIONS_MAX_OPEN_ALERTS ||
    '10'
).trim();
const RUNTIME_RECOVERY_AUTOMATIONS_MAX_OPEN_CONTROL_ALERTS = String(
  process.env.RUNTIME_RECOVERY_AUTOMATIONS_MAX_OPEN_CONTROL_ALERTS ||
    process.env.AUTOMATIONS_MAX_OPEN_CONTROL_ALERTS ||
    RUNTIME_RECOVERY_AUTOMATIONS_MAX_OPEN_ALERTS
).trim();
const RUNTIME_RECOVERY_AUTOMATIONS_MAX_OPEN_RECOVERY_ALERTS = String(
  process.env.RUNTIME_RECOVERY_AUTOMATIONS_MAX_OPEN_RECOVERY_ALERTS ||
    process.env.AUTOMATIONS_MAX_OPEN_RECOVERY_ALERTS ||
    RUNTIME_RECOVERY_AUTOMATIONS_MAX_OPEN_ALERTS
).trim();
const RUNTIME_RECOVERY_AUTOMATIONS_MAX_OPEN_EXECUTION_ALERTS = String(
  process.env.RUNTIME_RECOVERY_AUTOMATIONS_MAX_OPEN_EXECUTION_ALERTS ||
    process.env.AUTOMATIONS_MAX_OPEN_EXECUTION_ALERTS ||
    RUNTIME_RECOVERY_AUTOMATIONS_MAX_OPEN_ALERTS
).trim();

function createTimestamp(): string {
  return new Date().toISOString();
}

function commandToString(command: string[]): string {
  return command.join(' ');
}

function npmBin(): string {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function resolveWorkerReconciliationCommand(): string[] {
  if (existsSync(WORKER_RECONCILIATION_ENTRY)) {
    return [process.execPath, 'scripts/test-reconciliation.js'];
  }

  return [npmBin(), 'run', 'test:reconciliation'];
}

function asRecord(value: unknown): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as JsonRecord;
}

async function readOptionalJson(filePath: string): Promise<JsonRecord | null> {
  if (!filePath) {
    return null;
  }

  const absolutePath = path.resolve(BACKEND_CWD, filePath);
  if (!existsSync(absolutePath)) {
    return null;
  }

  try {
    const raw = await readFile(absolutePath, 'utf8');
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

async function writeStepSummary(summary: ReleaseGateSummary): Promise<void> {
  if (!STEP_SUMMARY_FILE) {
    return;
  }

  const runtimeSnapshot = asRecord(summary.runtimeHealthSnapshot);
  const staleCounts = asRecord(runtimeSnapshot.staleCounts);
  const lines = [
    '## Runtime recovery release gate',
    '',
    `- Decision: **${summary.decision}**`,
    `- Started: ${summary.startedAt}`,
    `- Finished: ${summary.finishedAt}`,
    `- Live checks enabled: ${summary.liveChecksEnabled ? 'yes' : 'no'}`,
    `- Runtime health artifact: ${summary.runtimeHealthSnapshotFile || 'n/a'}`,
    '',
    '### Runtime posture',
    '',
    `- runtime status: ${String(runtimeSnapshot.status || 'n/a')}`,
    `- stale total: ${String(staleCounts.total || 0)}`,
    `- worker status: ${String(asRecord(runtimeSnapshot.worker).status || 'n/a')}`,
    `- discovery status: ${String(asRecord(runtimeSnapshot.discovery).status || 'n/a')}`,
    '',
    '### Totals',
    '',
    `- total: ${summary.totals.total}`,
    `- passed: ${summary.totals.passed}`,
    `- failed: ${summary.totals.failed}`,
    `- skipped: ${summary.totals.skipped}`,
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

  const checks: GateCheckDefinition[] = [
    {
      key: 'backend-runtime-test',
      label: 'Backend runtime recovery contract test',
      cwd: BACKEND_CWD,
      command: resolveTestCommand('test:runtime-recovery'),
    },
    {
      key: 'backend-operational-audit',
      label: 'Backend operational audit',
      cwd: BACKEND_CWD,
      command: resolveTestCommand('test:operational-audit'),
    },
    {
      key: 'worker-operational-audit',
      label: 'Worker operational audit',
      cwd: WORKER_CWD,
      command: [npmBin(), 'run', 'test:operational-audit'],
    },
    {
      key: 'worker-reconciliation',
      label: 'Worker reconciliation test',
      cwd: WORKER_CWD,
      command: resolveWorkerReconciliationCommand(),
    },
    {
      key: 'discovery-runtime-smoke',
      label: 'Discovery runtime recovery smoke',
      cwd: DISCOVERY_CWD,
      command: [DISCOVERY_PYTHON, 'scripts/smoke_runtime_recovery.py'],
      enabled: existsSync(DISCOVERY_PYTHON),
      skipReason: existsSync(DISCOVERY_PYTHON)
        ? undefined
        : `python not found: ${DISCOVERY_PYTHON}`,
    },
    {
      key: 'runtime-health',
      label: 'Runtime health check',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'check:runtime-health'],
      enabled: RUN_LIVE_CHECKS,
      skipReason: 'live checks disabled',
    },
    {
      key: 'activity-health',
      label: 'Activity health check',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'check:activity-health'],
      enabled: RUN_LIVE_CHECKS,
      skipReason: 'live checks disabled',
    },
    {
      key: 'automations-health',
      label: 'Automations health check',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'check:automations-health'],
      env: RUN_LIVE_CHECKS
        ? {
            AUTOMATIONS_MAX_FAILED_RUNS_24H:
              RUNTIME_RECOVERY_AUTOMATIONS_MAX_FAILED_RUNS_24H,
            AUTOMATIONS_MAX_OVERLAP_SKIPS_24H:
              RUNTIME_RECOVERY_AUTOMATIONS_MAX_OVERLAP_SKIPS_24H,
            AUTOMATIONS_MAX_STALE_CURSORS:
              RUNTIME_RECOVERY_AUTOMATIONS_MAX_STALE_CURSORS,
            AUTOMATIONS_MAX_OPEN_ALERTS: RUNTIME_RECOVERY_AUTOMATIONS_MAX_OPEN_ALERTS,
            AUTOMATIONS_MAX_OPEN_CONTROL_ALERTS:
              RUNTIME_RECOVERY_AUTOMATIONS_MAX_OPEN_CONTROL_ALERTS,
            AUTOMATIONS_MAX_OPEN_RECOVERY_ALERTS:
              RUNTIME_RECOVERY_AUTOMATIONS_MAX_OPEN_RECOVERY_ALERTS,
            AUTOMATIONS_MAX_OPEN_EXECUTION_ALERTS:
              RUNTIME_RECOVERY_AUTOMATIONS_MAX_OPEN_EXECUTION_ALERTS,
          }
        : undefined,
      enabled: RUN_LIVE_CHECKS,
      skipReason: 'live checks disabled',
    },
    {
      key: 'global-system-schedulers-health',
      label: 'Global system schedulers health check',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'check:global-system-schedulers-health'],
      enabled: RUN_LIVE_CHECKS,
      skipReason: 'live checks disabled',
    },
    {
      key: 'runtime-smoke',
      label: 'Runtime recovery smoke',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'smoke:runtime-recovery'],
      enabled: RUN_LIVE_CHECKS,
      skipReason: 'live checks disabled',
    },
  ];

  const results: GateCheckResult[] = [];
  for (const check of checks) {
    results.push(await runCheck(check));
  }

  const runtimeHealthSnapshot = await readOptionalJson(RUNTIME_HEALTH_FILE);
  const totals = {
    total: results.length,
    passed: results.filter((result) => result.status === 'passed').length,
    failed: results.filter((result) => result.status === 'failed').length,
    skipped: results.filter((result) => result.status === 'skipped').length,
  };

  const summary: ReleaseGateSummary = {
    decision: totals.failed > 0 ? 'blocked' : 'ready',
    startedAt,
    finishedAt: createTimestamp(),
    backendCwd: BACKEND_CWD,
    workerCwd: WORKER_CWD,
    discoveryCwd: DISCOVERY_CWD,
    liveChecksEnabled: RUN_LIVE_CHECKS,
    runtimeHealthSnapshotFile: runtimeHealthSnapshot ? RUNTIME_HEALTH_FILE : null,
    runtimeHealthSnapshot,
    totals,
    results,
  };

  await persistSummary(summary);
  await writeStepSummary(summary);
  console.log(JSON.stringify(summary, null, 2));

  if (summary.decision === 'blocked') {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
