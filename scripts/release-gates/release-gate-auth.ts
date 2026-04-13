import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveTestCommand } from '../_support/resolve-test-command';

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
  process.env.AUTH_FRONTEND_CWD || '/Users/apple/Documents/Project/Frontend/aurAlphaApp'
).trim();
const OUTPUT_FILE = String(
  process.env.AUTH_RELEASE_GATE_OUTPUT_FILE || 'artifacts/auth-release-gate.json'
).trim();
const RUN_LIVE_CHECKS =
  String(process.env.AUTH_RUN_LIVE_CHECKS || '').trim().toLowerCase() === 'true';
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
    '## Auth release gate',
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
      key: 'backend-auth-contract',
      label: 'Backend auth contract suite',
      cwd: BACKEND_CWD,
      command: resolveTestCommand('test:auth-contract'),
    },
    {
      key: 'backend-auth-security',
      label: 'Backend auth security suite',
      cwd: BACKEND_CWD,
      command: resolveTestCommand('test:auth-security'),
    },
    {
      key: 'backend-type-check',
      label: 'Backend type-check',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'type-check'],
    },
    {
      key: 'frontend-auth-eslint',
      label: 'Frontend auth lint check',
      cwd: FRONTEND_CWD,
      command: [
        npxBin(),
        'eslint',
        'src/helpers/authRouting.js',
        'src/helpers/authRouting.test.js',
        'src/pages/Login/index.jsx',
        'src/pages/Login/index.test.jsx',
        'src/services/http.js',
        'src/services/http.test.js',
        'tests/e2e/auth.spec.js',
      ],
    },
    {
      key: 'frontend-auth-ui',
      label: 'Frontend auth UI suite',
      cwd: FRONTEND_CWD,
      command: [
        npmBin(),
        'run',
        'test:ui',
        '--',
        'src/helpers/authRouting.test.js',
        'src/components/auth/RequireAuth.test.jsx',
        'src/components/auth/GuestOnlyRoute.test.jsx',
        'src/pages/Login/index.test.jsx',
        'src/services/http.test.js',
      ],
    },
    {
      key: 'frontend-auth-e2e',
      label: 'Frontend auth E2E suite',
      cwd: FRONTEND_CWD,
      command: [npmBin(), 'run', 'test:e2e', '--', 'tests/e2e/auth.spec.js'],
    },
    {
      key: 'backend-auth-live-health',
      label: 'Backend auth live health check',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'check:auth-health'],
      enabled: RUN_LIVE_CHECKS,
      skipReason: 'AUTH_RUN_LIVE_CHECKS is not true',
    },
  ];

  const results: GateCheckResult[] = [];
  for (const check of checks) {
    const result = await runCheck(check);
    results.push(result);
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
    { total: 0, passed: 0, failed: 0, skipped: 0 }
  );

  const summary = {
    decision: totals.failed === 0 ? ('ready' as const) : ('blocked' as const),
    startedAt,
    finishedAt: createTimestamp(),
    liveChecksEnabled: RUN_LIVE_CHECKS,
    totals,
    results,
  };

  await persistSummary(summary);
  await writeStepSummary(summary);

  console.log('auth-release-gate:', JSON.stringify(summary));

  if (totals.failed > 0) {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
