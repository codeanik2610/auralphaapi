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
  process.env.FUNDS_SCHEDULER_FRONTEND_CWD || '/Users/apple/Documents/Project/Frontend/aurAlphaApp'
).trim();
const OUTPUT_FILE = String(
  process.env.FUNDS_SCHEDULER_RELEASE_GATE_OUTPUT_FILE ||
    'artifacts/funds-scheduler-release-gate.json'
).trim();
const HEALTH_SNAPSHOT_FILE = String(
  process.env.FUNDS_SCHEDULER_HEALTH_OUTPUT_FILE || 'artifacts/funds-scheduler-health.json'
).trim();
const RUN_LIVE_CHECKS =
  String(process.env.FUNDS_SCHEDULER_RUN_LIVE_CHECKS || '')
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

function readNumber(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
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
  const scheduler = asRecord(healthSnapshot.scheduler);
  const thresholdProfile = asRecord(healthSnapshot.thresholdProfile);

  const lines = [
    '## Funds scheduler release gate',
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
    '### Health posture',
    '',
    `- threshold mode: ${readString(thresholdProfile.mode) || 'n/a'}`,
    `- totalConnectedAccounts: ${readNumber(scheduler.totalConnectedAccounts)}`,
    `- fresh accounts: ${readNumber(scheduler.accountsWithFreshSnapshot)}`,
    `- stale accounts: ${readNumber(scheduler.accountsWithStaleSnapshot)}`,
    `- missing accounts: ${readNumber(scheduler.accountsMissingSnapshot)}`,
    `- failed latest attempts: ${readNumber(scheduler.accountsWithFailedLatestAttempt)}`,
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
      key: 'backend-funds-scheduler-phase1',
      label: 'Backend funds scheduler phase 1 suite',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'test:funds-scheduler-phase1'],
    },
    {
      key: 'backend-funds-scheduler-phase2',
      label: 'Backend funds scheduler phase 2 suite',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'test:funds-scheduler-phase2'],
    },
    {
      key: 'backend-funds-scheduler-phase3',
      label: 'Backend funds scheduler phase 3 suite',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'test:funds-scheduler-phase3'],
    },
    {
      key: 'backend-funds-scheduler-phase4',
      label: 'Backend funds scheduler phase 4 suite',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'test:funds-scheduler-phase4'],
    },
    {
      key: 'backend-funds-scheduler-phase6',
      label: 'Backend funds scheduler phase 6 suite',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'test:funds-scheduler-phase6'],
    },
    {
      key: 'backend-funds-scheduler-phase7',
      label: 'Backend funds scheduler phase 7 suite',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'test:funds-scheduler-phase7'],
    },
    {
      key: 'backend-funds-scheduler-phase8',
      label: 'Backend funds scheduler phase 8 suite',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'test:funds-scheduler-phase8'],
    },
    {
      key: 'backend-funds-scheduler-phase10',
      label: 'Backend funds scheduler phase 10 suite',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'test:funds-scheduler-phase10'],
    },
    {
      key: 'backend-funds-scheduler-phase11',
      label: 'Backend funds scheduler phase 11 suite',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'test:funds-scheduler-phase11'],
    },
    {
      key: 'backend-funds-scheduler-phase12',
      label: 'Backend funds scheduler phase 12 suite',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'test:funds-scheduler-phase12'],
    },
    {
      key: 'backend-controllers',
      label: 'Backend controller suite',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'test:controllers'],
    },
    {
      key: 'backend-operational-audit',
      label: 'Backend operational audit',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'test:operational-audit'],
    },
    {
      key: 'backend-funds-scheduler-eslint',
      label: 'Backend funds scheduler lint check',
      cwd: BACKEND_CWD,
      command: [
        npxBin(),
        'eslint',
        'src/api/controllers/FundsSchedulerController.ts',
        'src/api/controllers/InternalFundsSchedulerController.ts',
        'src/api/contracts/Scheduler.ts',
        'src/api/services/FundsSchedulerService.ts',
        'src/database/repositories/FundsSnapshotRepository.ts',
        'scripts/check-funds-scheduler-health.ts',
        'scripts/proof-funds-scheduler-live.ts',
        'scripts/proof-funds-scheduler-promotion.ts',
        'scripts/release-gate-funds-scheduler.ts',
        'scripts/signoff-funds-scheduler.ts',
        'scripts/test-controllers.ts',
        'scripts/test-funds-scheduler-phase1.ts',
        'scripts/test-funds-scheduler-phase2.ts',
        'scripts/test-funds-scheduler-phase3.ts',
        'scripts/test-funds-scheduler-phase4.ts',
        'scripts/test-funds-scheduler-phase6.ts',
        'scripts/test-funds-scheduler-phase7.ts',
        'scripts/test-funds-scheduler-phase8.ts',
        'scripts/test-funds-scheduler-phase10.ts',
        'scripts/test-funds-scheduler-phase11.ts',
        'scripts/test-funds-scheduler-phase12.ts',
        'scripts/test-operational-audit.ts',
      ],
    },
    {
      key: 'frontend-schedulers-funds-ui',
      label: 'Frontend scheduler UI funds diagnostics suite',
      cwd: FRONTEND_CWD,
      command: [
        npmBin(),
        'run',
        'test:ui',
        '--',
        'src/store/slices/settingsSlice.test.js',
        'src/pages/Schedulers/index.test.jsx',
      ],
    },
    {
      key: 'frontend-schedulers-funds-eslint',
      label: 'Frontend scheduler UI funds lint check',
      cwd: FRONTEND_CWD,
      command: [
        npxBin(),
        'eslint',
        'src/services/tradingApi.js',
        'src/store/slices/settingsSlice.js',
        'src/store/slices/settingsSlice.test.js',
        'src/pages/Schedulers/index.jsx',
        'src/pages/Schedulers/index.test.jsx',
        'src/pages/Schedulers/components/SchedulerConfigSection.jsx',
        'src/pages/Schedulers/components/SchedulerConfigWorkspace.jsx',
        'src/pages/Schedulers/components/SchedulerFundsCoverageDesk.jsx',
      ],
    },
    {
      key: 'backend-funds-scheduler-health',
      label: 'Backend funds scheduler live health check',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'check:funds-scheduler-health'],
      enabled: RUN_LIVE_CHECKS,
      env: absoluteHealthSnapshotFile
        ? {
            FUNDS_SCHEDULER_HEALTH_OUTPUT_FILE: absoluteHealthSnapshotFile,
          }
        : undefined,
      skipReason: 'FUNDS_SCHEDULER_RUN_LIVE_CHECKS is not true',
    },
    {
      key: 'backend-portfolio-health',
      label: 'Backend portfolio live health check',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'check:portfolio-health'],
      enabled: RUN_LIVE_CHECKS,
      skipReason: 'FUNDS_SCHEDULER_RUN_LIVE_CHECKS is not true',
    },
  ];

  const results: GateCheckResult[] = [];
  for (const check of checks) {
    results.push(await runCheck(check));
  }

  const totals = results.reduce(
    (accumulator, result) => {
      accumulator.total += 1;
      if (result.status === 'passed') {
        accumulator.passed += 1;
      } else if (result.status === 'failed') {
        accumulator.failed += 1;
      } else {
        accumulator.skipped += 1;
      }
      return accumulator;
    },
    {
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
    }
  );

  const healthSnapshot =
    RUN_LIVE_CHECKS && results.find((result) => result.key === 'backend-funds-scheduler-health')?.status === 'passed'
      ? await readOptionalJson(absoluteHealthSnapshotFile)
      : null;

  const finishedAt = createTimestamp();
  const decision: 'ready' | 'blocked' = totals.failed === 0 ? 'ready' : 'blocked';
  const summary: ReleaseGateSummary = {
    decision,
    startedAt,
    finishedAt,
    backendCwd: BACKEND_CWD,
    frontendCwd: FRONTEND_CWD,
    liveChecksEnabled: RUN_LIVE_CHECKS,
    healthSnapshotFile: absoluteHealthSnapshotFile || null,
    healthSnapshot,
    totals,
    results,
  };

  await persistSummary(summary);
  await writeStepSummary(summary);

  console.log('funds-scheduler-release-gate:', JSON.stringify(summary));

  if (decision === 'blocked') {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
