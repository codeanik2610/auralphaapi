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
const FRONTEND_CWD = String(
  process.env.ORDERS_SCHEDULER_FRONTEND_CWD ||
    '/Users/apple/Documents/Project/Frontend/aurAlphaApp'
).trim();
const OUTPUT_FILE = String(
  process.env.ORDERS_SCHEDULER_RELEASE_GATE_OUTPUT_FILE ||
    'artifacts/orders-scheduler-release-gate.json'
).trim();
const RUN_LIVE_CHECKS =
  String(process.env.ORDERS_SCHEDULER_RUN_LIVE_CHECKS || '')
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
    '## Orders scheduler release gate',
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
      key: 'backend-orders-scheduler-phase2',
      label: 'Backend orders scheduler Phase 2 suite',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'test:schedulers-phase2'],
    },
    {
      key: 'backend-orders-scheduler-phase3',
      label: 'Backend orders scheduler Phase 3 suite',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'test:schedulers-phase3'],
    },
    {
      key: 'backend-orders-scheduler-phase4',
      label: 'Backend orders scheduler Phase 4 suite',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'test:schedulers-phase4'],
    },
    {
      key: 'backend-orders-scheduler-phase5',
      label: 'Backend orders scheduler Phase 5 suite',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'test:schedulers-phase5'],
    },
    {
      key: 'backend-orders-scheduler-phase7',
      label: 'Backend orders scheduler Phase 7 suite',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'test:schedulers-phase7'],
    },
    {
      key: 'backend-orders-scheduler-phase8',
      label: 'Backend orders scheduler Phase 8 suite',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'test:schedulers-phase8'],
    },
    {
      key: 'backend-orders-scheduler-phase9',
      label: 'Backend orders scheduler Phase 9 suite',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'test:schedulers-phase9'],
    },
    {
      key: 'backend-orders-scheduler-controllers',
      label: 'Backend controller suite',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'test:controllers'],
    },
    {
      key: 'backend-orders-scheduler-eslint',
      label: 'Backend orders scheduler lint check',
      cwd: BACKEND_CWD,
      command: [
        npxBin(),
        'eslint',
        'src/api/contracts/Scheduler.ts',
        'src/api/controllers/OrdersSchedulerController.ts',
        'src/api/services/OrdersSchedulerService.ts',
        'src/api/services/SchedulerRuntimeSchemaService.ts',
        'src/api/validators/scheduler.validator.ts',
        'scripts/test-schedulers-phase2.ts',
        'scripts/test-schedulers-phase3.ts',
        'scripts/test-schedulers-phase4.ts',
        'scripts/test-schedulers-phase5.ts',
        'scripts/test-schedulers-phase7.ts',
        'scripts/test-schedulers-phase8.ts',
        'scripts/test-schedulers-phase9.ts',
        'scripts/check-orders-scheduler-health.ts',
        'scripts/proof-orders-scheduler-live.ts',
        'scripts/release-gate-orders-scheduler.ts',
        'scripts/signoff-orders-scheduler.ts',
      ],
    },
    {
      key: 'frontend-orders-scheduler-eslint',
      label: 'Frontend orders scheduler lint check',
      cwd: FRONTEND_CWD,
      command: [
        npxBin(),
        'eslint',
        'src/pages/Schedulers/index.jsx',
        'src/pages/Schedulers/index.test.jsx',
        'src/pages/Schedulers/components/SchedulerOverviewWorkspace.jsx',
        'src/pages/Schedulers/components/SchedulerConfigWorkspace.jsx',
        'src/pages/Schedulers/components/SchedulerHistoryWorkspace.jsx',
        'src/pages/Schedulers/components/SchedulerConfigSection.jsx',
        'src/pages/Schedulers/components/SchedulerConfigSection.test.jsx',
        'src/pages/Schedulers/components/SchedulerRecordSyncCoverage.jsx',
        'tests/e2e/schedulers-orders.spec.js',
      ],
    },
    {
      key: 'frontend-orders-scheduler-ui',
      label: 'Frontend orders scheduler UI suite',
      cwd: FRONTEND_CWD,
      command: [
        npmBin(),
        'run',
        'test:ui',
        '--',
        'src/pages/Schedulers/index.test.jsx',
        'src/pages/Schedulers/components/SchedulerConfigSection.test.jsx',
      ],
    },
    {
      key: 'frontend-orders-scheduler-e2e',
      label: 'Frontend orders scheduler operator journey E2E',
      cwd: FRONTEND_CWD,
      command: [npmBin(), 'run', 'test:e2e', '--', 'tests/e2e/schedulers-orders.spec.js'],
    },
    {
      key: 'backend-orders-scheduler-live-health',
      label: 'Backend orders scheduler live health check',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'check:orders-scheduler-health'],
      enabled: RUN_LIVE_CHECKS,
      skipReason: 'ORDERS_SCHEDULER_RUN_LIVE_CHECKS is not true',
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

  console.log('orders-scheduler-release-gate:', JSON.stringify(summary));

  if (decision === 'blocked') {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
