import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

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
  frontendCwd: string;
  workerCwd: string;
  liveChecksEnabled: boolean;
  healthSnapshotFile: string | null;
  healthSnapshot: JsonRecord | null;
  totals: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
  };
  results: GateCheckResult[];
};

const BACKEND_CWD = process.cwd();
const FRONTEND_CWD = String(
  process.env.GLOBAL_SYSTEM_SCHEDULERS_FRONTEND_CWD ||
    '/Users/apple/Documents/Project/Frontend/aurAlphaApp'
).trim();
const WORKER_CWD = String(
  process.env.GLOBAL_SYSTEM_SCHEDULERS_WORKER_CWD ||
    '/Users/apple/Documents/Project/Backend/aurAlphaSchedulerWorker'
).trim();
const OUTPUT_FILE = String(
  process.env.GLOBAL_SYSTEM_SCHEDULERS_RELEASE_GATE_OUTPUT_FILE ||
    'artifacts/global-system-schedulers-release-gate.json'
).trim();
const HEALTH_SNAPSHOT_FILE = String(
  process.env.GLOBAL_SYSTEM_SCHEDULERS_HEALTH_OUTPUT_FILE ||
    'artifacts/global-system-schedulers-health.json'
).trim();
const RUN_LIVE_CHECKS =
  String(process.env.GLOBAL_SYSTEM_SCHEDULERS_RUN_LIVE_CHECKS || '')
    .trim()
    .toLowerCase() === 'true';
const STEP_SUMMARY_FILE = String(process.env.GITHUB_STEP_SUMMARY || '').trim();

function createTimestamp(): string {
  return new Date().toISOString();
}

function commandToString(command: string[]): string {
  return command.join(' ');
}

function npmBin(): string {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function npxBin(): string {
  return process.platform === 'win32' ? 'npx.cmd' : 'npx';
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

async function writeStepSummary(summary: ReleaseGateSummary): Promise<void> {
  if (!STEP_SUMMARY_FILE) {
    return;
  }

  const healthSnapshot = asRecord(summary.healthSnapshot);
  const schedulerKeys = Array.isArray(healthSnapshot.schedulerKeys)
    ? healthSnapshot.schedulerKeys.map((item) => readString(item)).filter(Boolean)
    : [];
  const lines = [
    '## Global system schedulers release gate',
    '',
    `- Decision: **${summary.decision}**`,
    `- Started: ${summary.startedAt}`,
    `- Finished: ${summary.finishedAt}`,
    `- Live checks enabled: ${summary.liveChecksEnabled ? 'yes' : 'no'}`,
    `- Health snapshot file: ${summary.healthSnapshotFile || 'n/a'}`,
    '',
    '### Totals',
    '',
    `- total: ${summary.totals.total}`,
    `- passed: ${summary.totals.passed}`,
    `- failed: ${summary.totals.failed}`,
    `- skipped: ${summary.totals.skipped}`,
    '',
    '### Live health posture',
    '',
    `- queue status: ${readString(healthSnapshot.queueStatus) || 'n/a'}`,
    `- worker status: ${readString(healthSnapshot.workerStatus) || 'n/a'}`,
    `- overview display time zone: ${readString(healthSnapshot.overviewDisplayTimeZone) || 'n/a'}`,
    `- scheduler coverage: ${schedulerKeys.join(', ') || 'n/a'}`,
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
  const absoluteHealthSnapshotFile = HEALTH_SNAPSHOT_FILE
    ? path.resolve(BACKEND_CWD, HEALTH_SNAPSHOT_FILE)
    : '';

  if (RUN_LIVE_CHECKS && absoluteHealthSnapshotFile) {
    await unlink(absoluteHealthSnapshotFile).catch(() => undefined);
  }

  const checks: GateCheckDefinition[] = [
    {
      key: 'backend-global-system-schedulers-phase1',
      label: 'Backend global system schedulers Phase 1 suite',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'test:global-system-schedulers-phase1'],
    },
    {
      key: 'backend-global-system-schedulers-phase2',
      label: 'Backend global system schedulers Phase 2 suite',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'test:global-system-schedulers-phase2'],
    },
    {
      key: 'backend-global-system-schedulers-phase3',
      label: 'Backend global system schedulers Phase 3 suite',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'test:global-system-schedulers-phase3'],
    },
    {
      key: 'backend-global-system-schedulers-phase4',
      label: 'Backend global system schedulers Phase 4 suite',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'test:global-system-schedulers-phase4'],
    },
    {
      key: 'backend-global-system-schedulers-phase5',
      label: 'Backend global system schedulers Phase 5 suite',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'test:global-system-schedulers-phase5'],
    },
    {
      key: 'backend-global-system-schedulers-phase6',
      label: 'Backend global system schedulers Phase 6 suite',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'test:global-system-schedulers-phase6'],
    },
    {
      key: 'backend-global-system-schedulers-phase7',
      label: 'Backend global system schedulers Phase 7 suite',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'test:global-system-schedulers-phase7'],
    },
    {
      key: 'backend-global-system-schedulers-phase8',
      label: 'Backend global system schedulers Phase 8 suite',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'test:global-system-schedulers-phase8'],
    },
    {
      key: 'backend-global-system-schedulers-phase9',
      label: 'Backend global system schedulers Phase 9 suite',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'test:global-system-schedulers-phase9'],
    },
    {
      key: 'backend-global-system-schedulers-regression',
      label: 'Backend global system schedulers regression suite',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'test:global-system-schedulers'],
    },
    {
      key: 'backend-global-system-schedulers-operational-audit',
      label: 'Backend operational audit suite',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'test:operational-audit'],
    },
    {
      key: 'backend-global-system-schedulers-eslint',
      label: 'Backend global system schedulers scoped lint check',
      cwd: BACKEND_CWD,
      command: [
        npxBin(),
        'eslint',
        'scripts/check-global-system-schedulers-health.ts',
        'scripts/capture-global-system-schedulers-evidence.ts',
        'scripts/release-gate-global-system-schedulers.ts',
        'scripts/signoff-global-system-schedulers.ts',
        'scripts/proof-global-system-schedulers-live.ts',
        'scripts/test-global-system-schedulers-phase8.ts',
        'scripts/test-global-system-schedulers-phase9.ts',
        'scripts/test-operational-audit.ts',
      ],
    },
    {
      key: 'worker-global-system-schedulers-reconciliation',
      label: 'Worker reconciliation suite',
      cwd: WORKER_CWD,
      command: [npmBin(), 'run', 'test:reconciliation'],
    },
    {
      key: 'worker-global-system-schedulers-operational-audit',
      label: 'Worker operational audit suite',
      cwd: WORKER_CWD,
      command: [npmBin(), 'run', 'test:operational-audit'],
    },
    {
      key: 'frontend-global-system-schedulers-ui',
      label: 'Frontend /schedulers UI suite',
      cwd: FRONTEND_CWD,
      command: [npmBin(), 'run', 'test:ui', '--', 'src/pages/Schedulers/index.test.jsx'],
    },
    {
      key: 'frontend-global-system-schedulers-eslint',
      label: 'Frontend /schedulers lint check',
      cwd: FRONTEND_CWD,
      command: [
        npxBin(),
        'eslint',
        'src/pages/Schedulers/index.jsx',
        'src/pages/Schedulers/components/SchedulerOverviewWorkspace.jsx',
        'src/pages/Schedulers/index.test.jsx',
      ],
    },
    {
      key: 'backend-global-system-schedulers-live-health',
      label: 'Backend global system schedulers live health check',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'check:global-system-schedulers-health'],
      enabled: RUN_LIVE_CHECKS,
      env: {
        GLOBAL_SYSTEM_SCHEDULERS_HEALTH_OUTPUT_FILE: HEALTH_SNAPSHOT_FILE,
      },
      skipReason: 'GLOBAL_SYSTEM_SCHEDULERS_RUN_LIVE_CHECKS=false',
    },
  ];

  const results: GateCheckResult[] = [];
  for (const check of checks) {
    results.push(await runCheck(check));
  }

  const healthSnapshot =
    RUN_LIVE_CHECKS && absoluteHealthSnapshotFile
      ? await readOptionalJson(absoluteHealthSnapshotFile)
      : null;
  const totals = {
    total: results.length,
    passed: results.filter((result) => result.status === 'passed').length,
    failed: results.filter((result) => result.status === 'failed').length,
    skipped: results.filter((result) => result.status === 'skipped').length,
  };
  const decision: 'ready' | 'blocked' = totals.failed === 0 ? 'ready' : 'blocked';
  const summary: ReleaseGateSummary = {
    decision,
    startedAt,
    finishedAt: createTimestamp(),
    backendCwd: BACKEND_CWD,
    frontendCwd: FRONTEND_CWD,
    workerCwd: WORKER_CWD,
    liveChecksEnabled: RUN_LIVE_CHECKS,
    healthSnapshotFile: absoluteHealthSnapshotFile || null,
    healthSnapshot,
    totals,
    results,
  };

  await persistSummary(summary);
  await writeStepSummary(summary);

  console.log('global-system-schedulers-release-gate:', JSON.stringify(summary));

  if (decision !== 'ready') {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
