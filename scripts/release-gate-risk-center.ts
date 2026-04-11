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
  process.env.RISK_CENTER_FRONTEND_CWD || '/Users/apple/Documents/Project/Frontend/aurAlphaApp'
).trim();
const OUTPUT_FILE = String(
  process.env.RISK_CENTER_RELEASE_GATE_OUTPUT_FILE || 'artifacts/risk-center-release-gate.json'
).trim();
const RUN_LIVE_CHECKS =
  String(process.env.RISK_CENTER_RUN_LIVE_CHECKS || '').trim().toLowerCase() === 'true';
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
    '## Risk Center release gate',
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
      key: 'backend-risk-center-contract',
      label: 'Backend risk-center contract suite',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'test:risk-center-contract'],
    },
    {
      key: 'backend-risk-center-phase1',
      label: 'Backend risk-center Phase 1 suite',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'test:risk-center-phase1'],
    },
    {
      key: 'backend-risk-center-phase2',
      label: 'Backend risk-center Phase 2 suite',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'test:risk-center-phase2'],
    },
    {
      key: 'backend-risk-center-phase4',
      label: 'Backend risk-center Phase 4 suite',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'test:risk-center-phase4'],
    },
    {
      key: 'backend-risk-center-phase5',
      label: 'Backend risk-center Phase 5 suite',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'test:risk-center-phase5'],
    },
    {
      key: 'backend-risk-center-phase8',
      label: 'Backend risk-center Phase 8 suite',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'test:risk-center-phase8'],
    },
    {
      key: 'backend-risk-center-phase9',
      label: 'Backend risk-center Phase 9 suite',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'test:risk-center-phase9'],
    },
    {
      key: 'backend-risk-center-controllers',
      label: 'Backend controller suite',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'test:controllers'],
    },
    {
      key: 'backend-type-check',
      label: 'Backend type-check',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'type-check'],
    },
    {
      key: 'frontend-risk-center-eslint',
      label: 'Frontend risk-center lint check',
      cwd: FRONTEND_CWD,
      command: [
        npxBin(),
        'eslint',
        'src/pages/RiskCenter/index.jsx',
        'src/pages/RiskCenter/index.test.jsx',
        'src/pages/RiskCenter/trust.js',
        'src/pages/RiskCenter/RiskCenterActivityTrail.jsx',
        'src/pages/RiskCenter/RiskCenterOverviewWorkspace.jsx',
        'src/pages/RiskCenter/RiskCenterPoliciesWorkspace.jsx',
        'src/pages/RiskCenter/RiskCenterOperationsWorkspace.jsx',
        'src/pages/RiskCenter/RiskPolicyDrawer.jsx',
        'src/store/slices/riskCenterSlice.js',
        'src/services/tradingApi.js',
        'tests/e2e/risk-center.spec.js',
      ],
    },
    {
      key: 'frontend-risk-center-ui',
      label: 'Frontend risk-center UI suite',
      cwd: FRONTEND_CWD,
      command: [npmBin(), 'run', 'test:ui', '--', 'src/pages/RiskCenter/index.test.jsx'],
    },
    {
      key: 'frontend-risk-center-e2e',
      label: 'Frontend risk-center operator journey E2E',
      cwd: FRONTEND_CWD,
      command: [npmBin(), 'run', 'test:e2e', '--', 'tests/e2e/risk-center.spec.js'],
    },
    {
      key: 'backend-risk-center-live-health',
      label: 'Backend risk-center live health check',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'check:risk-center-health'],
      enabled: RUN_LIVE_CHECKS,
      skipReason: 'RISK_CENTER_RUN_LIVE_CHECKS is not true',
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

  console.log('risk-center-release-gate:', JSON.stringify(summary));

  if (totals.failed > 0) {
    process.exit(1);
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
