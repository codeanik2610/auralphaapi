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
  process.env.RISK_SCHEDULER_FRONTEND_CWD || '/Users/apple/Documents/Project/Frontend/aurAlphaApp'
).trim();
const OUTPUT_FILE = String(
  process.env.RISK_SCHEDULER_RELEASE_GATE_OUTPUT_FILE || 'artifacts/risk-scheduler-release-gate.json'
).trim();
const RUN_LIVE_CHECKS =
  String(process.env.RISK_SCHEDULER_RUN_LIVE_CHECKS || '')
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
    '## Risk scheduler release gate',
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
      key: 'backend-risk-scheduler-phase1',
      label: 'Backend risk scheduler Phase 1 suite',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'test:risk-scheduler-phase1'],
    },
    {
      key: 'backend-risk-scheduler-phase2',
      label: 'Backend risk scheduler Phase 2 suite',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'test:risk-scheduler-phase2'],
    },
    {
      key: 'backend-risk-scheduler-phase4',
      label: 'Backend risk scheduler Phase 4 suite',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'test:risk-scheduler-phase4'],
    },
    {
      key: 'backend-risk-scheduler-phase5',
      label: 'Backend risk scheduler Phase 5 suite',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'test:risk-scheduler-phase5'],
    },
    {
      key: 'backend-risk-scheduler-phase6',
      label: 'Backend risk scheduler Phase 6 suite',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'test:risk-scheduler-phase6'],
    },
    {
      key: 'backend-risk-scheduler-phase8',
      label: 'Backend risk scheduler Phase 8 suite',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'test:risk-scheduler-phase8'],
    },
    {
      key: 'backend-risk-center-phase6',
      label: 'Backend risk-center Phase 6 suite',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'test:risk-center-phase6'],
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
      key: 'backend-risk-scheduler-eslint',
      label: 'Backend risk scheduler lint check',
      cwd: BACKEND_CWD,
      command: [
        npxBin(),
        'eslint',
        'src/api/controllers/RiskSchedulerController.ts',
        'src/api/contracts/RiskOverview.ts',
        'src/api/services/RiskSchedulerService.ts',
        'scripts/check-risk-center-health.ts',
        'scripts/check-risk-scheduler-health.ts',
        'scripts/release-gate-risk-scheduler.ts',
        'scripts/signoff-risk-scheduler.ts',
        'scripts/test-risk-center-phase6.ts',
        'scripts/test-risk-scheduler-phase6.ts',
        'scripts/test-risk-scheduler-phase8.ts',
      ],
    },
    {
      key: 'frontend-schedulers-risk-ui',
      label: 'Frontend scheduler UI risk diagnostics suite',
      cwd: FRONTEND_CWD,
      command: [
        npmBin(),
        'run',
        'test:ui',
        '--',
        'src/pages/Schedulers/index.test.jsx',
        'src/pages/SchedulerOps/index.test.jsx',
        'src/store/slices/settingsSlice.test.js',
      ],
    },
    {
      key: 'frontend-schedulers-risk-eslint',
      label: 'Frontend scheduler UI risk diagnostics lint check',
      cwd: FRONTEND_CWD,
      command: [
        npxBin(),
        'eslint',
        'src/pages/Schedulers/index.jsx',
        'src/pages/Schedulers/index.test.jsx',
        'src/pages/SchedulerOps/index.jsx',
        'src/pages/SchedulerOps/index.test.jsx',
        'src/pages/Schedulers/components/SchedulerConfigSection.jsx',
      ],
    },
    {
      key: 'backend-risk-scheduler-health',
      label: 'Backend risk scheduler live health check',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'check:risk-scheduler-health'],
      enabled: RUN_LIVE_CHECKS,
      skipReason: 'RISK_SCHEDULER_RUN_LIVE_CHECKS is not true',
    },
    {
      key: 'backend-risk-center-health',
      label: 'Backend risk-center live health check',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'check:risk-center-health'],
      enabled: RUN_LIVE_CHECKS,
      skipReason: 'RISK_SCHEDULER_RUN_LIVE_CHECKS is not true',
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
    backendCwd: BACKEND_CWD,
    frontendCwd: FRONTEND_CWD,
    liveChecksEnabled: RUN_LIVE_CHECKS,
    totals,
    results,
  };

  await persistSummary(summary);
  await writeStepSummary(summary);

  console.log('risk-scheduler-release-gate:', JSON.stringify(summary));

  if (decision === 'blocked') {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
