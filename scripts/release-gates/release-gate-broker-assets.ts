import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
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
const OUTPUT_FILE = String(
  process.env.BROKER_ASSETS_RELEASE_GATE_OUTPUT_FILE || 'artifacts/broker-assets-release-gate.json'
).trim();
const HEALTH_SNAPSHOT_FILE = String(
  process.env.BROKER_ASSETS_HEALTH_OUTPUT_FILE || 'artifacts/broker-assets-health.json'
).trim();
const RUN_LIVE_CHECKS =
  String(process.env.BROKER_ASSETS_RUN_LIVE_CHECKS || '')
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
  const thresholdProfile = asRecord(healthSnapshot.thresholdProfile);
  const lines = [
    '## Broker assets release gate',
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
    `- scheduler type: ${readString(healthSnapshot.schedulerType) || 'n/a'}`,
    `- visible total: ${readString(healthSnapshot.visibleTotal) || 'n/a'}`,
    `- admin catalog total: ${readString(healthSnapshot.adminCatalogTotal) || 'n/a'}`,
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
      key: 'backend-broker-assets-suite',
      label: 'Backend broker-assets module suite',
      cwd: BACKEND_CWD,
      command: resolveTestCommand('test:broker-assets'),
    },
    {
      key: 'backend-broker-assets-eslint',
      label: 'Backend broker-assets scoped lint check',
      cwd: BACKEND_CWD,
      command: [
        npxBin(),
        'eslint',
        'src/database/entities/ExchangeAsset.ts',
        'src/database/repositories/ExchangeAssetRepository.ts',
        'src/api/services/ExchangeAssetsService.ts',
        'src/api/services/ConnectionsService.ts',
        'src/brokers/capabilities/orders/DeltaExchangeOrdersAdapter.ts',
        'scripts/_fixtures/migrations/1770709000000-DropBrokerAssetLegacyUserOwnership.ts',
        'scripts/test-broker-assets.ts',
        'scripts/checks/check-broker-assets-health.ts',
        'scripts/release-gates/release-gate-broker-assets.ts',
        'scripts/signoffs/signoff-broker-assets.ts',
        'scripts/proofs/proof-broker-assets-live.ts',
      ],
    },
    {
      key: 'backend-broker-assets-live-health',
      label: 'Backend broker-assets scoped live health check',
      cwd: BACKEND_CWD,
      command: [npmBin(), 'run', 'check:broker-assets-health'],
      enabled: RUN_LIVE_CHECKS,
      env: {
        BROKER_ASSETS_HEALTH_OUTPUT_FILE: HEALTH_SNAPSHOT_FILE,
      },
      skipReason: 'BROKER_ASSETS_RUN_LIVE_CHECKS=false',
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
    liveChecksEnabled: RUN_LIVE_CHECKS,
    healthSnapshotFile: healthSnapshot && absoluteHealthSnapshotFile ? absoluteHealthSnapshotFile : null,
    healthSnapshot,
    totals,
    results,
  };

  await persistSummary(summary);
  await writeStepSummary(summary);

  if (decision === 'blocked') {
    process.exitCode = 1;
    return;
  }

  console.log('Broker assets release gate passed.');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
