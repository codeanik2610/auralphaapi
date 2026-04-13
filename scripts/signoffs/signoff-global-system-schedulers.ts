import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

type JsonRecord = Record<string, unknown>;
type EvidenceLocationKind =
  | 'missing'
  | 'remote_url'
  | 'localhost_url'
  | 'local_path'
  | 'relative_path'
  | 'invalid';

type ReleaseGateResult = {
  key: string;
  label: string;
  status: 'passed' | 'failed' | 'skipped';
  reason?: string;
};

type ReleaseGateSummary = {
  decision: 'ready' | 'blocked';
  startedAt?: string;
  finishedAt?: string;
  liveChecksEnabled: boolean;
  healthSnapshotFile?: string | null;
  healthSnapshot: JsonRecord | null;
  totals: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
  };
  results: ReleaseGateResult[];
};

const EXPECTED_SCHEDULER_KEYS = [
  'broker-assets-sync',
  'exchange-assets-sync',
  'binance-candles-3m-1m-sync',
  'system-health-sync',
];

const GATE_FILE = String(
  process.env.GLOBAL_SYSTEM_SCHEDULERS_SIGNOFF_GATE_FILE ||
    'artifacts/global-system-schedulers-release-gate.json'
).trim();
const OUTPUT_FILE = String(
  process.env.GLOBAL_SYSTEM_SCHEDULERS_SIGNOFF_OUTPUT_FILE ||
    'artifacts/global-system-schedulers-signoff.json'
).trim();
const STEP_SUMMARY_FILE = String(process.env.GITHUB_STEP_SUMMARY || '').trim();
const REQUIRE_LIVE_HEALTH =
  String(process.env.GLOBAL_SYSTEM_SCHEDULERS_SIGNOFF_REQUIRE_LIVE_HEALTH || 'false')
    .trim()
    .toLowerCase() === 'true';
const REQUIRE_DEPLOYMENT_EVIDENCE =
  String(process.env.GLOBAL_SYSTEM_SCHEDULERS_SIGNOFF_REQUIRE_DEPLOYMENT_EVIDENCE || 'false')
    .trim()
    .toLowerCase() === 'true';
const OPERATOR_WORKSPACE_REVIEWED =
  String(process.env.GLOBAL_SYSTEM_SCHEDULERS_SIGNOFF_OPERATOR_WORKSPACE_REVIEWED || '')
    .trim()
    .toLowerCase() === 'true';
const SYSTEM_SCOPE_VERIFIED =
  String(process.env.GLOBAL_SYSTEM_SCHEDULERS_SIGNOFF_SYSTEM_SCOPE_VERIFIED || '')
    .trim()
    .toLowerCase() === 'true';
const AUDIT_CHAIN_VERIFIED =
  String(process.env.GLOBAL_SYSTEM_SCHEDULERS_SIGNOFF_AUDIT_CHAIN_VERIFIED || '')
    .trim()
    .toLowerCase() === 'true';
const TIMEZONE_DISPLAY_VERIFIED =
  String(process.env.GLOBAL_SYSTEM_SCHEDULERS_SIGNOFF_TIMEZONE_DISPLAY_VERIFIED || '')
    .trim()
    .toLowerCase() === 'true';
const RETENTION_SCOPE_VERIFIED =
  String(process.env.GLOBAL_SYSTEM_SCHEDULERS_SIGNOFF_RETENTION_SCOPE_VERIFIED || '')
    .trim()
    .toLowerCase() === 'true';
const WORKER_RUNTIME_VERIFIED =
  String(process.env.GLOBAL_SYSTEM_SCHEDULERS_SIGNOFF_WORKER_RUNTIME_VERIFIED || '')
    .trim()
    .toLowerCase() === 'true';
const APPROVER = String(
  process.env.GLOBAL_SYSTEM_SCHEDULERS_SIGNOFF_APPROVER || ''
).trim();
const STAGING_WORKFLOW_URL = String(
  process.env.GLOBAL_SYSTEM_SCHEDULERS_SIGNOFF_STAGING_WORKFLOW_URL ||
    process.env.GLOBAL_SYSTEM_SCHEDULERS_SIGNOFF_WORKFLOW_URL ||
    ''
).trim();
const DASHBOARD_URL = String(
  process.env.GLOBAL_SYSTEM_SCHEDULERS_SIGNOFF_DASHBOARD_URL || ''
).trim();
const RUNBOOK_URL = String(
  process.env.GLOBAL_SYSTEM_SCHEDULERS_SIGNOFF_RUNBOOK_URL || ''
).trim();
const RELEASE_NOTE_URL = String(
  process.env.GLOBAL_SYSTEM_SCHEDULERS_SIGNOFF_RELEASE_NOTE_URL || ''
).trim();

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
  if (!Number.isFinite(numeric)) {
    throw new Error(`Expected finite number, received ${String(value)}`);
  }
  return numeric;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => readString(item)).filter(Boolean) : [];
}

function isLocalHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '0.0.0.0' ||
    normalized === '::1' ||
    normalized === '[::1]'
  );
}

function classifyEvidenceLocation(value: string): EvidenceLocationKind {
  const normalized = readString(value);
  if (!normalized) {
    return 'missing';
  }
  if (path.isAbsolute(normalized)) {
    return 'local_path';
  }

  try {
    const parsed = new URL(normalized);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return isLocalHost(parsed.hostname) ? 'localhost_url' : 'remote_url';
    }
    return 'invalid';
  } catch {
    return normalized.includes('/') ? 'relative_path' : 'invalid';
  }
}

function isEvidenceReady(kind: EvidenceLocationKind): boolean {
  return kind === 'remote_url' || kind === 'local_path' || kind === 'relative_path';
}

function isSkippedForMissingCwd(result: ReleaseGateResult | undefined): boolean {
  return result?.status === 'skipped' && readString(result.reason).startsWith('cwd not found:');
}

async function readGateSummary(): Promise<ReleaseGateSummary> {
  const absoluteGateFile = path.resolve(process.cwd(), GATE_FILE);
  const raw = await readFile(absoluteGateFile, 'utf8');
  const parsed = JSON.parse(raw) as JsonRecord;
  const totals = asRecord(parsed.totals);

  return {
    decision: readString(parsed.decision) === 'blocked' ? 'blocked' : 'ready',
    startedAt: readString(parsed.startedAt) || undefined,
    finishedAt: readString(parsed.finishedAt) || undefined,
    liveChecksEnabled: parsed.liveChecksEnabled === true,
    healthSnapshotFile: readString(parsed.healthSnapshotFile) || null,
    healthSnapshot:
      parsed.healthSnapshot && typeof parsed.healthSnapshot === 'object'
        ? asRecord(parsed.healthSnapshot)
        : null,
    totals: {
      total: readNumber(totals.total),
      passed: readNumber(totals.passed),
      failed: readNumber(totals.failed),
      skipped: readNumber(totals.skipped),
    },
    results: Array.isArray(parsed.results)
      ? parsed.results.map((item) => {
          const result = asRecord(item);
          return {
            key: readString(result.key),
            label: readString(result.label),
            status:
              readString(result.status) === 'failed'
                ? 'failed'
                : readString(result.status) === 'skipped'
                  ? 'skipped'
                  : 'passed',
            reason: readString(result.reason) || undefined,
          };
        })
      : [],
  };
}

async function persistSummary(summary: Record<string, unknown>): Promise<void> {
  if (!OUTPUT_FILE) {
    return;
  }

  const absoluteOutputPath = path.resolve(process.cwd(), OUTPUT_FILE);
  await mkdir(path.dirname(absoluteOutputPath), { recursive: true });
  await writeFile(absoluteOutputPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
}

async function writeStepSummary(summary: {
  decision: 'ready' | 'blocked';
  gateFile: string;
  approver: string | null;
  checks: Record<string, boolean>;
  evidence: Record<string, string | null>;
  evidenceClassification: Record<string, string>;
  readiness: Record<string, boolean>;
  coverage: {
    schedulerKeys: string[];
  };
  environment: {
    requireLiveHealth: boolean;
    requireDeploymentEvidence: boolean;
  };
  gate: ReleaseGateSummary;
}): Promise<void> {
  if (!STEP_SUMMARY_FILE) {
    return;
  }

  const lines = [
    '## Global system schedulers final sign-off',
    '',
    `- Decision: **${summary.decision}**`,
    `- Gate file: \`${summary.gateFile}\``,
    `- Approver: ${summary.approver || 'n/a'}`,
    `- Scheduler coverage: ${summary.coverage.schedulerKeys.join(', ') || 'n/a'}`,
    '',
    '### Checks',
    '',
    `- release gate decision is ready: ${summary.checks.gateReady ? 'yes' : 'no'}`,
    `- required backend suites passed: ${summary.checks.requiredSuitesPassed ? 'yes' : 'no'}`,
    `- cross-repo suites passed or are unavailable: ${summary.checks.crossRepoSuitesPassed ? 'yes' : 'no'}`,
    `- live health reviewed: ${summary.checks.liveHealthReviewed ? 'yes' : 'no'}`,
    `- scheduler coverage captured: ${summary.checks.schedulerCoverageCaptured ? 'yes' : 'no'}`,
    `- operator workspace reviewed: ${summary.checks.operatorWorkspaceReviewed ? 'yes' : 'no'}`,
    `- system scope verified: ${summary.checks.systemScopeVerified ? 'yes' : 'no'}`,
    `- audit chain verified: ${summary.checks.auditChainVerified ? 'yes' : 'no'}`,
    `- timezone display verified: ${summary.checks.timezoneDisplayVerified ? 'yes' : 'no'}`,
    `- retention scope verified: ${summary.checks.retentionScopeVerified ? 'yes' : 'no'}`,
    `- worker runtime verified: ${summary.checks.workerRuntimeVerified ? 'yes' : 'no'}`,
    `- deployment evidence ready: ${summary.checks.deploymentEvidenceReady ? 'yes' : 'no'}`,
    '',
    '### Readiness',
    '',
    `- live gate ready: ${summary.readiness.liveGateReady ? 'yes' : 'no'}`,
    `- subsystem coverage ready: ${summary.readiness.subsystemCoverageReady ? 'yes' : 'no'}`,
    `- cross-repo proof ready: ${summary.readiness.crossRepoProofReady ? 'yes' : 'no'}`,
    `- deployment evidence ready: ${summary.readiness.deploymentEvidenceReady ? 'yes' : 'no'}`,
    `- production promotion ready: ${summary.readiness.productionPromotionReady ? 'yes' : 'no'}`,
    '',
    '### Evidence',
    '',
    `- staging workflow: ${summary.evidence.stagingWorkflowUrl || 'n/a'} (${summary.evidenceClassification.stagingWorkflowUrlKind || 'missing'})`,
    `- dashboard URL: ${summary.evidence.dashboardUrl || 'n/a'} (${summary.evidenceClassification.dashboardUrlKind || 'missing'})`,
    `- runbook URL: ${summary.evidence.runbookUrl || 'n/a'} (${summary.evidenceClassification.runbookUrlKind || 'missing'})`,
    `- release note URL: ${summary.evidence.releaseNoteUrl || 'n/a'} (${summary.evidenceClassification.releaseNoteUrlKind || 'missing'})`,
    '',
    '### Environment',
    '',
    `- require live health: ${summary.environment.requireLiveHealth ? 'yes' : 'no'}`,
    `- require deployment evidence: ${summary.environment.requireDeploymentEvidence ? 'yes' : 'no'}`,
    '',
    '### Gate totals',
    '',
    `- passed: ${summary.gate.totals.passed}`,
    `- failed: ${summary.gate.totals.failed}`,
    `- skipped: ${summary.gate.totals.skipped}`,
    '',
  ];

  await writeFile(STEP_SUMMARY_FILE, `${lines.join('\n')}\n`, 'utf8');
}

async function run(): Promise<void> {
  const gate = await readGateSummary();
  const resultsByKey = new Map(gate.results.map((result) => [result.key, result]));
  const requiredGateKeys = [
    'backend-global-system-schedulers-suite',
    'backend-global-system-schedulers-operational-audit',
    'backend-global-system-schedulers-eslint',
  ];
  const optionalCrossRepoKeys = [
    'worker-global-system-schedulers-reconciliation',
    'worker-global-system-schedulers-operational-audit',
    'frontend-global-system-schedulers-ui',
    'frontend-global-system-schedulers-eslint',
  ];

  const requiredSuitesPassed = requiredGateKeys.every(
    (key) => resultsByKey.get(key)?.status === 'passed'
  );
  const crossRepoSuitesPassed = optionalCrossRepoKeys.every((key) => {
    const result = resultsByKey.get(key);
    return result?.status === 'passed' || isSkippedForMissingCwd(result);
  });

  const healthSnapshot = asRecord(gate.healthSnapshot);
  const healthSchedulerKeys = readStringArray(healthSnapshot.schedulerKeys);
  const schedulerCoverageCaptured = REQUIRE_LIVE_HEALTH
    ? EXPECTED_SCHEDULER_KEYS.every((key) => healthSchedulerKeys.includes(key))
    : true;
  const liveHealthReviewed = REQUIRE_LIVE_HEALTH
    ? gate.liveChecksEnabled === true &&
      resultsByKey.get('backend-global-system-schedulers-live-health')?.status === 'passed'
    : true;
  const evidenceClassification = {
    stagingWorkflowUrlKind: classifyEvidenceLocation(STAGING_WORKFLOW_URL),
    dashboardUrlKind: classifyEvidenceLocation(DASHBOARD_URL),
    runbookUrlKind: classifyEvidenceLocation(RUNBOOK_URL),
    releaseNoteUrlKind: classifyEvidenceLocation(RELEASE_NOTE_URL),
  };
  const deploymentEvidenceReady = REQUIRE_DEPLOYMENT_EVIDENCE
    ? [
        evidenceClassification.stagingWorkflowUrlKind,
        evidenceClassification.dashboardUrlKind,
        evidenceClassification.runbookUrlKind,
        evidenceClassification.releaseNoteUrlKind,
      ].every((kind) => isEvidenceReady(kind))
    : true;

  const checks = {
    gateReady: gate.decision === 'ready' && gate.totals.failed === 0,
    requiredSuitesPassed,
    crossRepoSuitesPassed,
    liveHealthReviewed,
    schedulerCoverageCaptured,
    operatorWorkspaceReviewed: OPERATOR_WORKSPACE_REVIEWED,
    systemScopeVerified: SYSTEM_SCOPE_VERIFIED,
    auditChainVerified: AUDIT_CHAIN_VERIFIED,
    timezoneDisplayVerified: TIMEZONE_DISPLAY_VERIFIED,
    retentionScopeVerified: RETENTION_SCOPE_VERIFIED,
    workerRuntimeVerified: WORKER_RUNTIME_VERIFIED,
    deploymentEvidenceReady,
  };

  assert.equal(checks.gateReady, true, 'release gate must be ready with zero failed checks');
  assert.equal(
    checks.requiredSuitesPassed,
    true,
    'required backend global system scheduler suites must all pass'
  );
  assert.equal(
    checks.crossRepoSuitesPassed,
    true,
    'frontend and worker validation must pass when those repos are available'
  );
  assert.equal(
    checks.liveHealthReviewed,
    true,
    'live global system scheduler health must be reviewed when signoff requires it'
  );
  assert.equal(
    checks.schedulerCoverageCaptured,
    true,
    'live health must capture all four global scheduler keys when signoff requires it'
  );
  assert.equal(
    checks.operatorWorkspaceReviewed,
    true,
    'the /schedulers operator workspace must be explicitly reviewed before signoff'
  );
  assert.equal(
    checks.systemScopeVerified,
    true,
    'global scheduler execution scope must be explicitly verified before signoff'
  );
  assert.equal(
    checks.auditChainVerified,
    true,
    'manual-vs-system initiator audit truth must be explicitly verified before signoff'
  );
  assert.equal(
    checks.timezoneDisplayVerified,
    true,
    'localized display times must be explicitly verified before signoff'
  );
  assert.equal(
    checks.retentionScopeVerified,
    true,
    'scheduler-scoped retention and purge behavior must be explicitly verified before signoff'
  );
  assert.equal(
    checks.workerRuntimeVerified,
    true,
    'worker runtime behavior must be explicitly verified before signoff'
  );
  assert.equal(
    checks.deploymentEvidenceReady,
    true,
    'deployment evidence must be provided when signoff requires it'
  );

  const readiness = {
    liveGateReady: checks.gateReady && checks.liveHealthReviewed,
    subsystemCoverageReady: checks.schedulerCoverageCaptured,
    crossRepoProofReady: checks.crossRepoSuitesPassed,
    deploymentEvidenceReady: checks.deploymentEvidenceReady,
    productionPromotionReady: Object.values(checks).every((value) => value === true),
  };

  const summary = {
    decision: 'ready' as const,
    generatedAt: new Date().toISOString(),
    gateFile: path.resolve(process.cwd(), GATE_FILE),
    approver: APPROVER || null,
    checks,
    readiness,
    evidence: {
      stagingWorkflowUrl: STAGING_WORKFLOW_URL || null,
      dashboardUrl: DASHBOARD_URL || null,
      runbookUrl: RUNBOOK_URL || null,
      releaseNoteUrl: RELEASE_NOTE_URL || null,
    },
    evidenceClassification,
    coverage: {
      schedulerKeys:
        schedulerCoverageCaptured && healthSchedulerKeys.length > 0
          ? healthSchedulerKeys
          : EXPECTED_SCHEDULER_KEYS,
    },
    environment: {
      requireLiveHealth: REQUIRE_LIVE_HEALTH,
      requireDeploymentEvidence: REQUIRE_DEPLOYMENT_EVIDENCE,
    },
    gate,
  };

  await persistSummary(summary);
  await writeStepSummary(summary);

  console.log('global-system-schedulers-signoff:', JSON.stringify(summary));
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
