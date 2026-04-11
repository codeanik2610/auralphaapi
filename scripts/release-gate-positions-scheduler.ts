import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

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
  skipReason?: string;
};

const BACKEND_CWD = process.cwd();
const OUTPUT_FILE = String(
  process.env.POSITIONS_SCHEDULER_RELEASE_GATE_OUTPUT_FILE ||
    'artifacts/positions-scheduler-release-gate.json'
).trim();
const RUN_LIVE_CHECKS =
  String(process.env.POSITIONS_SCHEDULER_RUN_LIVE_CHECKS || '')
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
      env: process.env,
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

async function writeStepSummary(summary: {
  decision: 'ready' | 'blocked';
  startedAt: string;
  finishedAt: string;
  totals: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
  };
  liveChecksEnabled: boolean;
  results: GateCheckResult[];
}): Promise<void> {
  if (!STEP_SUMMARY_FILE) {
    return;
  }

  const lines = [
    '## Positions scheduler release gate',
    '',
    `- Decision: **${summary.decision}**`,
    `- Started: ${summary.startedAt}`,
    `- Finished: ${summary.finishedAt}`,
    `- Live checks enabled: ${summary.liveChecksEnabled ? 'yes' : 'no'}`,
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
      key: 'backend-positions-scheduler-phase1',
      label: 'Backend positions scheduler phase 1 suite',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'test:positions-scheduler-phase1'],
    },
    {
      key: 'backend-positions-scheduler-phase2',
      label: 'Backend positions scheduler phase 2 suite',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'test:positions-scheduler-phase2'],
    },
    {
      key: 'backend-positions-scheduler-phase3',
      label: 'Backend positions scheduler phase 3 suite',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'test:positions-scheduler-phase3'],
    },
    {
      key: 'backend-positions-scheduler-phase4',
      label: 'Backend positions scheduler phase 4 suite',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'test:positions-scheduler-phase4'],
    },
    {
      key: 'backend-positions-scheduler-phase5',
      label: 'Backend positions scheduler phase 5 suite',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'test:positions-scheduler-phase5'],
    },
    {
      key: 'backend-positions-scheduler-phase6',
      label: 'Backend positions scheduler phase 6 suite',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'test:positions-scheduler-phase6'],
    },
    {
      key: 'backend-positions-scheduler-phase7',
      label: 'Backend positions scheduler phase 7 suite',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'test:positions-scheduler-phase7'],
    },
    {
      key: 'backend-positions-scheduler-phase8',
      label: 'Backend positions scheduler phase 8 suite',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'test:positions-scheduler-phase8'],
    },
    {
      key: 'backend-positions-scheduler-operational-audit',
      label: 'Backend positions scheduler operational audit',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'test:operational-audit'],
    },
    {
      key: 'backend-positions-scheduler-eslint',
      label: 'Backend positions scheduler lint check',
      cwd: BACKEND_CWD,
      command: [
        npxBin(),
        'eslint',
        'src/api/controllers/PositionsSchedulerController.ts',
        'src/api/contracts/Scheduler.ts',
        'src/api/services/PositionsSchedulerService.ts',
        'src/api/validators/scheduler.validator.ts',
        'src/database/repositories/PositionReadModelRepository.ts',
        'src/loaders/ExpressLoader.ts',
        'scripts/test-operational-audit.ts',
        'scripts/test-positions-scheduler-phase3.ts',
        'scripts/test-positions-scheduler-phase5.ts',
        'scripts/test-positions-scheduler-phase6.ts',
        'scripts/test-positions-scheduler-phase7.ts',
        'scripts/test-positions-scheduler-phase8.ts',
        'scripts/check-positions-scheduler-health.ts',
        'scripts/proof-positions-scheduler-live.ts',
        'scripts/release-gate-positions-scheduler.ts',
        'scripts/rebuild-positions-read-model.ts',
        'scripts/signoff-positions-scheduler.ts',
      ],
    },
    {
      key: 'backend-positions-health',
      label: 'Backend positions desk live health check',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'check:positions-health'],
      enabled: RUN_LIVE_CHECKS,
      skipReason: 'POSITIONS_SCHEDULER_RUN_LIVE_CHECKS is not true',
    },
    {
      key: 'backend-positions-scheduler-health',
      label: 'Backend positions scheduler live health check',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'check:positions-scheduler-health'],
      enabled: RUN_LIVE_CHECKS,
      skipReason: 'POSITIONS_SCHEDULER_RUN_LIVE_CHECKS is not true',
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

  const finishedAt = createTimestamp();
  const decision: 'ready' | 'blocked' = totals.failed === 0 ? 'ready' : 'blocked';
  const summary = {
    decision,
    startedAt,
    finishedAt,
    liveChecksEnabled: RUN_LIVE_CHECKS,
    totals,
    results,
  };

  await persistSummary(summary);
  await writeStepSummary(summary);

  console.log('positions-scheduler-release-gate:', JSON.stringify(summary));

  if (decision === 'blocked') {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
