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
  process.env.PORTFOLIO_FRONTEND_CWD || '/Users/apple/Documents/Project/Frontend/aurAlphaApp'
).trim();
const OUTPUT_FILE = String(
  process.env.PORTFOLIO_RELEASE_GATE_OUTPUT_FILE || 'artifacts/portfolio-release-gate.json'
).trim();
const RUN_LIVE_CHECKS =
  String(process.env.PORTFOLIO_RUN_LIVE_CHECKS || '').trim().toLowerCase() === 'true';
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
    child.on('exit', (code) => {
      resolve(code);
    });
  }).catch((error) => {
    console.error(
      error instanceof Error ? error.message : `Unknown error: ${String(error)}`
    );
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
    '## Portfolio release gate',
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
      key: 'backend-portfolio-phase1',
      label: 'Backend portfolio Phase 1 suite',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'test:portfolio-phase1'],
    },
    {
      key: 'backend-portfolio-phase2',
      label: 'Backend portfolio Phase 2 suite',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'test:portfolio-phase2'],
    },
    {
      key: 'backend-portfolio-phase3',
      label: 'Backend portfolio Phase 3 suite',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'test:portfolio-phase3'],
    },
    {
      key: 'backend-portfolio-phase4',
      label: 'Backend portfolio Phase 4 suite',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'test:portfolio-phase4'],
    },
    {
      key: 'backend-portfolio-phase5',
      label: 'Backend portfolio Phase 5 suite',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'test:portfolio-phase5'],
    },
    {
      key: 'backend-portfolio-phase6',
      label: 'Backend portfolio Phase 6 suite',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'test:portfolio-phase6'],
    },
    {
      key: 'backend-portfolio-phase7',
      label: 'Backend portfolio Phase 7 suite',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'test:portfolio-phase7'],
    },
    {
      key: 'backend-portfolio-phase8',
      label: 'Backend portfolio Phase 8 suite',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'test:portfolio-phase8'],
    },
    {
      key: 'backend-portfolio-eslint',
      label: 'Backend portfolio lint check',
      cwd: BACKEND_CWD,
      command: [
        npxBin(),
        'eslint',
        'src/api/contracts/Portfolio.ts',
        'src/api/contracts/PortfolioOverview.ts',
        'src/api/controllers/PortfolioController.ts',
        'src/api/services/PortfolioOverviewService.ts',
        'src/api/services/PortfolioService.ts',
        'src/api/validators/portfolio.validator.ts',
        'scripts/check-portfolio-health.ts',
        'scripts/test-portfolio-phase2.ts',
        'scripts/test-portfolio-phase4.ts',
        'scripts/test-portfolio-phase6.ts',
        'scripts/test-portfolio-phase7.ts',
        'scripts/test-portfolio-phase8.ts',
        'scripts/proof-portfolio-live.ts',
        'scripts/release-gate-portfolio.ts',
        'scripts/signoff-portfolio.ts',
      ],
    },
    {
      key: 'frontend-portfolio-eslint',
      label: 'Frontend portfolio lint check',
      cwd: FRONTEND_CWD,
      command: [
        npxBin(),
        'eslint',
        'src/pages/Portfolio/index.jsx',
        'src/pages/Portfolio/index.test.jsx',
        'src/store/slices/portfolioSlice.js',
        'src/store/slices/portfolioSlice.test.js',
        'src/services/tradingApi.js',
      ],
    },
    {
      key: 'frontend-portfolio-ui',
      label: 'Frontend portfolio UI suite',
      cwd: FRONTEND_CWD,
      command: [
        npmBin(),
        'run',
        'test:ui',
        '--',
        'src/store/slices/portfolioSlice.test.js',
        'src/pages/Portfolio/index.test.jsx',
      ],
    },
    {
      key: 'frontend-portfolio-build',
      label: 'Frontend portfolio build',
      cwd: FRONTEND_CWD,
      command: [npmBin(), 'run', 'build'],
    },
    {
      key: 'backend-portfolio-live-health',
      label: 'Backend portfolio live health check',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'check:portfolio-health'],
      enabled: RUN_LIVE_CHECKS,
      skipReason: 'PORTFOLIO_RUN_LIVE_CHECKS is not true',
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

  console.log('portfolio-release-gate:', JSON.stringify(summary));

  if (decision === 'blocked') {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
