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
  process.env.FOUNDATION_FRONTEND_CWD || '/Users/apple/Documents/Project/Frontend/aurAlphaApp'
).trim();
const OUTPUT_FILE = String(
  process.env.FOUNDATION_RELEASE_GATE_OUTPUT_FILE || 'artifacts/foundation-release-gate.json'
).trim();
const RUN_LIVE_CHECKS =
  String(process.env.FOUNDATION_RUN_LIVE_CHECKS || '').trim().toLowerCase() === 'true';
const RUN_STRATEGY_LIBRARY_E2E =
  String(process.env.FOUNDATION_RUN_STRATEGY_LIBRARY_E2E || '').trim().toLowerCase() === 'true';
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
    '## Foundation release gate',
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

  const backendChecks: GateCheckDefinition[] = [
    {
      key: 'backend-services',
      label: 'Backend services test suite',
      cwd: BACKEND_CWD,
      command: resolveTestCommand('test:services'),
    },
    {
      key: 'backend-controllers',
      label: 'Backend controllers test suite',
      cwd: BACKEND_CWD,
      command: resolveTestCommand('test:controllers'),
    },
    {
      key: 'backend-operational-audit',
      label: 'Backend operational audit suite',
      cwd: BACKEND_CWD,
      command: resolveTestCommand('test:operational-audit'),
    },
    {
      key: 'backend-type-check',
      label: 'Backend type-check',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'type-check'],
    },
  ];

  const frontendChecks: GateCheckDefinition[] = [
    {
      key: 'frontend-ops-eslint',
      label: 'Frontend ops surface lint check',
      cwd: FRONTEND_CWD,
      command: [
        npxBin(),
        'eslint',
        'src/pages/Alerts/index.jsx',
        'src/pages/Schedulers/index.jsx',
        'src/pages/EmailDeliveries/index.jsx',
        'src/pages/Activity/index.jsx',
        'src/pages/Discovery/index.jsx',
        'tests/e2e/business-flows.spec.js',
        'tests/e2e/discovery.spec.js',
      ],
    },
    {
      key: 'frontend-alerts-ui',
      label: 'Alerts UI gate',
      cwd: FRONTEND_CWD,
      command: [npmBin(), 'run', 'test:ui', '--', 'src/pages/Alerts/index.test.jsx'],
    },
    {
      key: 'frontend-schedulers-ui',
      label: 'Schedulers UI gate',
      cwd: FRONTEND_CWD,
      command: [npmBin(), 'run', 'test:ui', '--', 'src/pages/Schedulers/index.test.jsx'],
    },
    {
      key: 'frontend-activity-ui',
      label: 'Activity URL/filter UI gate',
      cwd: FRONTEND_CWD,
      command: [
        npmBin(),
        'run',
        'test:ui',
        '--',
        'src/pages/Activity/index.test.jsx',
        '-t',
        'hydrates server-side filters from the URL and keeps export/read actions aligned',
      ],
    },
    {
      key: 'frontend-activity-links-ui',
      label: 'Activity linked-context UI gate',
      cwd: FRONTEND_CWD,
      command: [
        npmBin(),
        'run',
        'test:ui',
        '--',
        'src/pages/Activity/index.test.jsx',
        '-t',
        'opens the detail drawer and surfaces linked backend activity context',
      ],
    },
    {
      key: 'frontend-discovery-ui',
      label: 'Discovery UI gate',
      cwd: FRONTEND_CWD,
      command: [npmBin(), 'run', 'test:ui', '--', 'src/pages/Discovery/index.test.jsx'],
    },
    {
      key: 'frontend-business-flows-e2e',
      label: 'Cross-module business flows E2E',
      cwd: FRONTEND_CWD,
      command: [npmBin(), 'run', 'test:e2e', '--', 'tests/e2e/business-flows.spec.js'],
    },
    {
      key: 'frontend-discovery-e2e',
      label: 'Discovery operator journey E2E',
      cwd: FRONTEND_CWD,
      command: [npmBin(), 'run', 'test:e2e', '--', 'tests/e2e/discovery.spec.js'],
    },
    {
      key: 'frontend-strategy-library-e2e',
      label: 'Strategy library lifecycle E2E',
      cwd: FRONTEND_CWD,
      command: [npmBin(), 'run', 'test:e2e', '--', 'tests/e2e/strategy-library.spec.js'],
      enabled: RUN_STRATEGY_LIBRARY_E2E,
      skipReason: 'enable with FOUNDATION_RUN_STRATEGY_LIBRARY_E2E=true',
    },
  ];

  const liveChecks: GateCheckDefinition[] = [
    {
      key: 'live-discovery-gate',
      label: 'Live discovery release gate',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'release-gate:discovery'],
      enabled: RUN_LIVE_CHECKS,
      skipReason: 'enable with FOUNDATION_RUN_LIVE_CHECKS=true',
    },
    {
      key: 'live-scheduler-health',
      label: 'Live scheduler health smoke',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'smoke:scheduler-health'],
      enabled: RUN_LIVE_CHECKS,
      skipReason: 'enable with FOUNDATION_RUN_LIVE_CHECKS=true',
    },
    {
      key: 'live-strategy-library-gate',
      label: 'Live strategy-library release gate',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'release-gate:strategy-library'],
      enabled: RUN_LIVE_CHECKS,
      skipReason: 'enable with FOUNDATION_RUN_LIVE_CHECKS=true',
    },
    {
      key: 'live-suggested-trades-gate',
      label: 'Live suggested-trades release gate',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'release-gate:suggested-trades'],
      enabled: RUN_LIVE_CHECKS,
      skipReason: 'enable with FOUNDATION_RUN_LIVE_CHECKS=true',
    },
  ];

  const results: GateCheckResult[] = [];
  const checks = [...backendChecks, ...frontendChecks, ...liveChecks];

  for (const check of checks) {
    // Sequential execution keeps output readable and makes failures easier to trace.
    results.push(await runCheck(check));
  }

  const totals = {
    total: results.length,
    passed: results.filter((result) => result.status === 'passed').length,
    failed: results.filter((result) => result.status === 'failed').length,
    skipped: results.filter((result) => result.status === 'skipped').length,
  };
  const finishedAt = createTimestamp();
  const decision: 'ready' | 'blocked' = totals.failed === 0 ? 'ready' : 'blocked';
  const summary = {
    decision,
    startedAt,
    finishedAt,
    backendCwd: BACKEND_CWD,
    frontendCwd: FRONTEND_CWD,
    liveChecksEnabled: RUN_LIVE_CHECKS,
    optionalStrategyLibraryE2EEnabled: RUN_STRATEGY_LIBRARY_E2E,
    totals,
    results,
  };

  await persistSummary(summary);
  await writeStepSummary(summary);

  console.log('foundation-release-gate:', JSON.stringify(summary));

  if (totals.failed > 0) {
    process.exit(1);
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
