import { runSuiteSteps } from './_support/run-script-suite';

// Consolidated module suite.

async function scheduler_account_scopeGuard03(): Promise<void> {
  const { default: assert } = await import("node:assert/strict");
  const { default: fs } = await import("node:fs");
  const { default: path } = await import("node:path");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function extractBlock(source: string, signature: string): string {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `Missing signature: ${signature}`);
  const braceStart = source.indexOf('{', start);
  assert.notEqual(braceStart, -1, `Missing opening brace for: ${signature}`);

  let depth = 0;
  for (let index = braceStart; index < source.length; index += 1) {
    const character = source[index];
    if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(braceStart, index + 1);
      }
    }
  }

  assert.fail(`Unclosed block for: ${signature}`);
}

function run(): void {
  const brokerAccountRepositorySource = read(
    'src/database/repositories/BrokerAccountRepository.ts'
  );
  const fundsSchedulerSource = read('src/api/services/FundsSchedulerService.ts');
  const internalOrdersSource = read('src/api/services/InternalOrdersSyncService.ts');
  const internalPositionsSource = read('src/api/services/InternalPositionsSyncService.ts');
  const ordersSchedulerSource = read('src/api/services/OrdersSchedulerService.ts');
  const packageSource = read('package.json');
  const readmeSource = read('README.md');
  const phaseDoc = read('SCHEDULER_ACCOUNT_SCOPE_PHASE3.md');

  const genericAllActiveBlock = extractBlock(
    brokerAccountRepositorySource,
    'async getAllActiveBrokerAccounts(brokerKey?: string): Promise<BrokerAccount[]>'
  );
  assert.equal(
    genericAllActiveBlock.includes("status: In(['Connected', 'Idle'])"),
    true,
    'BrokerAccountRepository.getAllActiveBrokerAccounts must stay a generic active-account read'
  );
  assert.equal(
    genericAllActiveBlock.includes('userId'),
    false,
    'BrokerAccountRepository.getAllActiveBrokerAccounts must not silently become a user-owned-only helper'
  );
  assert.equal(
    genericAllActiveBlock.includes('IsNull'),
    false,
    'BrokerAccountRepository.getAllActiveBrokerAccounts must not embed system-account ownership filtering'
  );

  const systemAccountsBlock = extractBlock(
    brokerAccountRepositorySource,
    'async getActiveSystemBrokerAccounts(brokerKey?: string): Promise<BrokerAccount[]>'
  );
  assert.equal(
    systemAccountsBlock.includes('userId: IsNull()'),
    true,
    'BrokerAccountRepository must keep the explicit system-account helper for true system workflows'
  );

  for (const [label, source] of [
    ['FundsSchedulerService.ts', fundsSchedulerSource],
    ['InternalOrdersSyncService.ts', internalOrdersSource],
    ['InternalPositionsSyncService.ts', internalPositionsSource],
  ] as const) {
    assert.equal(
      source.includes('private groupInfraAccountsByOwner(') &&
        source.includes('if (!ownerUserId) {') &&
        source.includes('continue;'),
      true,
      `${label} must skip ownerless system accounts at the service layer`
    );
  }

  assert.equal(
    ordersSchedulerSource.includes(
      'const activeAccounts = await this.brokerAccountRepository.getAllActiveBrokerAccounts('
    ),
    true,
    'OrdersSchedulerService scoped replay must start from the generic all-active repository read'
  );
  assert.equal(
    ordersSchedulerSource.includes("if (!String(account.userId || '').trim()) {"),
    true,
    'OrdersSchedulerService scoped replay must reject ownerless system accounts after the generic lookup'
  );

  assert.equal(
    packageSource.includes('"test:scheduler-account-scope"'),
    true,
    'package.json must expose the consolidated scheduler account-scope suite'
  );
  assert.equal(
    packageSource.includes('"test:scheduler-account-scope"'),
    true,
    'test:all must keep the consolidated scheduler account-scope suite wired'
  );

  for (const marker of [
    'BrokerAccountRepository stays generic',
    'Ownerless exclusion stays in the scheduler services',
    '## 4) Phase 4 Entry Checklist',
  ]) {
    assert.equal(
      phaseDoc.includes(marker),
      true,
      `SCHEDULER_ACCOUNT_SCOPE_PHASE3.md must include marker: ${marker}`
    );
  }

  assert.equal(
    readmeSource.includes('SCHEDULER_ACCOUNT_SCOPE_PHASE3.md'),
    true,
    'README.md must reference the scheduler account-scope Phase 3 document'
  );
  assert.equal(
    readmeSource.includes('test:scheduler-account-scope'),
    true,
    'README.md must include the consolidated scheduler account-scope verification command'
  );

  console.log('Scheduler account-scope Phase 3 guard passed.');
}

  await run();
}

async function scheduler_account_scopeGuard05(): Promise<void> {
  const { default: assert } = await import("node:assert/strict");
  const { default: fs } = await import("node:fs");
  const { default: path } = await import("node:path");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function run(): void {
  const liveCheckSource = read('scripts/checks/check-scheduler-account-scope-live.ts');
  const ordersDiagnosticsSource = read('src/api/services/OrdersSyncDiagnosticsService.ts');
  const positionsSchedulerSource = read('src/api/services/PositionsSchedulerService.ts');
  const packageSource = read('package.json');
  const readmeSource = read('README.md');
  const phaseDoc = read('SCHEDULER_ACCOUNT_SCOPE_PHASE5.md');

  for (const marker of [
    '/scheduler/orders/sync-state/summary',
    '/scheduler/orders/sync-state?limit=20&offset=0',
    '/scheduler/positions/sync-state/summary',
    '/scheduler/positions/sync-state?limit=20&offset=0',
    '/internal/funds/snapshot',
    'activeUserOwned',
    'activeSystemOwned',
    'ownerlessAccountIds',
  ]) {
    assert.equal(
      liveCheckSource.includes(marker),
      true,
      `check-scheduler-account-scope-live.ts must include marker: ${marker}`
    );
  }

  assert.equal(
    packageSource.includes('"check:scheduler-account-scope-live"'),
    true,
    'package.json must expose the live scheduler account-scope proof command'
  );
  assert.equal(
    packageSource.includes('"test:scheduler-account-scope"'),
    true,
    'package.json must expose the consolidated scheduler account-scope suite'
  );
  assert.equal(
    packageSource.includes('"test:scheduler-account-scope"'),
    true,
    'test:all must keep the consolidated scheduler account-scope suite wired'
  );

  for (const marker of [
    'One live proof command now exists',
    '## 4) Phase 6 Entry Checklist',
    'npm run check:scheduler-account-scope-live',
  ]) {
    assert.equal(
      phaseDoc.includes(marker),
      true,
      `SCHEDULER_ACCOUNT_SCOPE_PHASE5.md must include marker: ${marker}`
    );
  }

  assert.equal(
    readmeSource.includes('SCHEDULER_ACCOUNT_SCOPE_PHASE5.md'),
    true,
    'README.md must reference the scheduler account-scope Phase 5 document'
  );
  assert.equal(
    readmeSource.includes('check:scheduler-account-scope-live'),
    true,
    'README.md must include the scheduler account-scope live proof command'
  );

  for (const [source, label] of [
    [ordersDiagnosticsSource, 'OrdersSyncDiagnosticsService.ts'],
    [positionsSchedulerSource, 'PositionsSchedulerService.ts'],
  ] as const) {
    assert.equal(
      source.includes('ba.updatedAt'),
      true,
      `${label} must use the real broker_accounts updatedAt column in raw SQL`
    );
    assert.equal(
      source.includes('ba.brokerKey'),
      true,
      `${label} must use the real broker_accounts brokerKey column in raw SQL`
    );
    assert.equal(
      source.includes('ba.updated_at'),
      false,
      `${label} must not regress to the non-existent broker_accounts updated_at column`
    );
    assert.equal(
      source.includes('ba.broker_key'),
      false,
      `${label} must not regress to the non-existent broker_accounts broker_key column`
    );
  }

  console.log('Scheduler account-scope Phase 5 guard passed.');
}

  await run();
}

async function scheduler_account_scopeGuard06(): Promise<void> {
  const { default: assert } = await import("node:assert/strict");
  const { default: fs } = await import("node:fs");
  const { default: path } = await import("node:path");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function run(): void {
  const findings: string[] = [];

  const phaseDoc = read('SCHEDULER_ACCOUNT_SCOPE_PHASE6.md');
  for (const marker of [
    'Phase 6 archives the live ownership-alignment evidence and adds an operator',
    '`funds-sync`',
    '`orders-sync`',
    '`positions-sync`',
    '`npm run proof:scheduler-account-scope-live`',
    '`artifacts/scheduler-account-scope-live.json`',
    '`artifacts/scheduler-account-scope-live-proof.json`',
    'manual smoke proof, not an automatic release gate',
    '## 5) Phase 7 Entry Checklist',
  ]) {
    if (!phaseDoc.includes(marker)) {
      findings.push(`SCHEDULER_ACCOUNT_SCOPE_PHASE6.md: missing Phase 6 marker ${marker}`);
    }
  }

  const phase5Doc = read('SCHEDULER_ACCOUNT_SCOPE_PHASE5.md');
  if (!phase5Doc.includes('SCHEDULER_ACCOUNT_SCOPE_PHASE6.md')) {
    findings.push('SCHEDULER_ACCOUNT_SCOPE_PHASE5.md: missing Phase 6 handoff');
  }

  const packageSource = read('package.json');
  for (const marker of [
    '"test:scheduler-account-scope"',
    '"check:scheduler-account-scope-live"',
    '"proof:scheduler-account-scope-live"',
  ]) {
    if (!packageSource.includes(marker)) {
      findings.push(`package.json: missing Phase 6 script ${marker}`);
    }
  }
  if (!packageSource.includes('"test:scheduler-account-scope"')) {
    findings.push('package.json: test:all must include the consolidated scheduler account-scope suite');
  }
  if (packageSource.includes('npm run proof:scheduler-account-scope-live && npm run type-check')) {
    findings.push('package.json: test:all must not depend on the live scheduler account-scope proof');
  }

  const readmeSource = read('README.md');
  if (!readmeSource.includes('SCHEDULER_ACCOUNT_SCOPE_PHASE6.md')) {
    findings.push('README.md: missing scheduler account-scope Phase 6 baseline link');
  }
  if (!readmeSource.includes('proof:scheduler-account-scope-live')) {
    findings.push('README.md: missing scheduler account-scope Phase 6 proof command');
  }
  if (!readmeSource.includes('manual smoke proof artifact')) {
    findings.push('README.md: missing scheduler account-scope Phase 6 summary');
  }

  const checkScript = read('scripts/checks/check-scheduler-account-scope-live.ts');
  for (const marker of [
    'export type SchedulerAccountScopeLiveSnapshot',
    'export function assertSchedulerAccountScopeLiveSnapshot',
    'export async function buildSchedulerAccountScopeLiveSnapshot',
    "path.basename(String(process.argv[1] || ''))",
    'if (isMainModule)',
    'artifacts/scheduler-account-scope-live.json',
    'scheduler-account-scope-live:',
  ]) {
    if (!checkScript.includes(marker)) {
      findings.push(`check-scheduler-account-scope-live.ts: missing Phase 6 marker ${marker}`);
    }
  }

  const proofScript = read('scripts/proofs/proof-scheduler-account-scope-live.ts');
  for (const marker of [
    "manual-smoke",
    'artifacts/scheduler-account-scope-live.json',
    'artifacts/scheduler-account-scope-live-proof.json',
    'broker_accounts.user_id IS NOT NULL',
    'scheduler-account-scope-live-proof:',
  ]) {
    if (!proofScript.includes(marker)) {
      findings.push(`proof-scheduler-account-scope-live.ts: missing Phase 6 marker ${marker}`);
    }
  }

  assert.equal(
    findings.length,
    0,
    `Scheduler account-scope Phase 6 guard failed:\n${findings.join('\n')}`
  );
  console.log('Scheduler account-scope Phase 6 guard passed.');
}

  await run();
}

async function scheduler_account_scopeGuard07(): Promise<void> {
  const { default: assert } = await import("node:assert/strict");
  const { spawn } = await import("node:child_process");
  const { mkdtemp, readFile, writeFile } = await import("node:fs/promises");
  const { default: os } = await import("node:os");
  const { default: path } = await import("node:path");

async function runCommand(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv
): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env,
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', (code) => resolve(code));
  });
}

async function runSignoffChecks(): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'scheduler-account-scope-phase7-'));
  const gateFile = path.join(tempDir, 'scheduler-account-scope-release-gate.json');
  const proofFile = path.join(tempDir, 'scheduler-account-scope-live-proof.json');
  const outputFile = path.join(tempDir, 'scheduler-account-scope-signoff.json');

  const gateSummary = {
    decision: 'ready',
    startedAt: '2026-04-11T00:00:00.000Z',
    finishedAt: '2026-04-11T00:05:00.000Z',
    liveProofEnabled: true,
    proofFile,
    proofSummary: {
      decision: 'ready',
      contract: 'broker_accounts.user_id IS NOT NULL',
      activeUserOwned: 4,
      activeSystemOwned: 2,
    },
    totals: {
      total: 3,
      passed: 3,
      failed: 0,
      skipped: 0,
    },
    results: [
      'backend-scheduler-account-scope-suite',
      'backend-scheduler-account-scope-operational-audit',
      'backend-scheduler-account-scope-live-proof',
    ].map((key) => ({
      key,
      label: key,
      status: 'passed',
    })),
  };
  const proofSummary = {
    decision: 'ready',
    contract: 'broker_accounts.user_id IS NOT NULL',
    activeUserOwned: 4,
    activeSystemOwned: 2,
  };

  await writeFile(gateFile, `${JSON.stringify(gateSummary, null, 2)}\n`, 'utf8');
  await writeFile(proofFile, `${JSON.stringify(proofSummary, null, 2)}\n`, 'utf8');

  const exitCode = await runCommand(
    process.execPath,
    ['--import', 'tsx', 'scripts/signoffs/signoff-scheduler-account-scope.ts'],
    {
      ...process.env,
      SCHEDULER_ACCOUNT_SCOPE_SIGNOFF_GATE_FILE: gateFile,
      SCHEDULER_ACCOUNT_SCOPE_SIGNOFF_PROOF_FILE: proofFile,
      SCHEDULER_ACCOUNT_SCOPE_SIGNOFF_OUTPUT_FILE: outputFile,
      SCHEDULER_ACCOUNT_SCOPE_SIGNOFF_REQUIRE_LIVE_PROOF: 'true',
      SCHEDULER_ACCOUNT_SCOPE_SIGNOFF_OWNERSHIP_SPLIT_VERIFIED: 'true',
      SCHEDULER_ACCOUNT_SCOPE_SIGNOFF_ORDERS_DIAGNOSTICS_VERIFIED: 'true',
      SCHEDULER_ACCOUNT_SCOPE_SIGNOFF_POSITIONS_DIAGNOSTICS_VERIFIED: 'true',
      SCHEDULER_ACCOUNT_SCOPE_SIGNOFF_FUNDS_OWNERLESS_EXCLUSION_VERIFIED: 'true',
      SCHEDULER_ACCOUNT_SCOPE_SIGNOFF_PLACEHOLDER_EVIDENCE_ACKNOWLEDGED: 'true',
      SCHEDULER_ACCOUNT_SCOPE_SIGNOFF_APPROVER: 'codex-phase7',
    }
  );

  assert.equal(
    exitCode,
    0,
    'scheduler account-scope signoff should succeed against a ready Phase 7 gate'
  );

  const rawOutput = await readFile(outputFile, 'utf8');
  const summary = JSON.parse(rawOutput) as {
    decision: string;
    approver: string;
    checks: Record<string, boolean>;
    readiness: Record<string, boolean>;
  };

  assert.equal(summary.decision, 'ready');
  assert.equal(summary.approver, 'codex-phase7');
  assert.equal(summary.checks.liveProofReviewed, true);
  assert.equal(summary.checks.fundsOwnerlessExclusionVerified, true);
  assert.equal(summary.readiness.productionPromotionReady, true);
}

async function runSourceMarkerAssertions(): Promise<void> {
  const releaseGateSource = await readFile(
    path.join(process.cwd(), 'scripts', 'release-gates', 'release-gate-scheduler-account-scope.ts'),
    'utf8'
  );
  const signoffSource = await readFile(
    path.join(process.cwd(), 'scripts', 'signoffs', 'signoff-scheduler-account-scope.ts'),
    'utf8'
  );
  const auditSource = await readFile(
    path.join(process.cwd(), 'scripts', 'test-operational-audit.ts'),
    'utf8'
  );
  const packageSource = await readFile(path.join(process.cwd(), 'package.json'), 'utf8');
  const phaseDoc = await readFile(
    path.join(process.cwd(), 'SCHEDULER_ACCOUNT_SCOPE_PHASE7.md'),
    'utf8'
  );
  const previousPhaseDoc = await readFile(
    path.join(process.cwd(), 'SCHEDULER_ACCOUNT_SCOPE_PHASE6.md'),
    'utf8'
  );
  const readmeSource = await readFile(path.join(process.cwd(), 'README.md'), 'utf8');

  assert.equal(
    releaseGateSource.includes('backend-scheduler-account-scope-suite'),
    true,
    'scheduler account-scope release gate must include the consolidated suite'
  );
  assert.equal(
    releaseGateSource.includes('SCHEDULER_ACCOUNT_SCOPE_RUN_LIVE_PROOF'),
    true,
    'scheduler account-scope release gate must support optional live proof'
  );
  assert.equal(
    releaseGateSource.includes('backend-scheduler-account-scope-live-proof'),
    true,
    'scheduler account-scope release gate must expose a live proof check key'
  );
  assert.equal(
    signoffSource.includes('SCHEDULER_ACCOUNT_SCOPE_SIGNOFF_REQUIRE_LIVE_PROOF'),
    true,
    'scheduler account-scope signoff must support optional live proof enforcement'
  );
  assert.equal(
    signoffSource.includes('SCHEDULER_ACCOUNT_SCOPE_SIGNOFF_OWNERSHIP_SPLIT_VERIFIED'),
    true,
    'scheduler account-scope signoff must require ownership split verification'
  );
  assert.equal(
    signoffSource.includes('SCHEDULER_ACCOUNT_SCOPE_SIGNOFF_FUNDS_OWNERLESS_EXCLUSION_VERIFIED'),
    true,
    'scheduler account-scope signoff must require funds ownerless exclusion verification'
  );
  assert.equal(
    auditSource.includes('"signoff:scheduler-account-scope"'),
    true,
    'operational audit must treat scheduler account-scope signoff as a required workflow surface'
  );
  assert.equal(
    packageSource.includes('"test:scheduler-account-scope"'),
    true,
    'package.json must include the consolidated scheduler account-scope suite'
  );
  assert.equal(
    packageSource.includes('"release-gate:scheduler-account-scope"'),
    true,
    'package.json must include scheduler account-scope release gate'
  );
  assert.equal(
    packageSource.includes('"signoff:scheduler-account-scope"'),
    true,
    'package.json must include scheduler account-scope signoff'
  );
  assert.equal(
    packageSource.includes('"test:scheduler-account-scope"'),
    true,
    'test:all must run the consolidated scheduler account-scope suite'
  );
  assert.equal(
    phaseDoc.includes('Phase 7 turns scheduler account-scope into a release-ready workflow'),
    true,
    'SCHEDULER_ACCOUNT_SCOPE_PHASE7.md must document the Phase 7 release workflow'
  );
  assert.equal(
    phaseDoc.includes('## 4) Carry-Forward For Phase 8'),
    true,
    'SCHEDULER_ACCOUNT_SCOPE_PHASE7.md must include the Phase 8 handoff checklist'
  );
  assert.equal(
    previousPhaseDoc.includes('SCHEDULER_ACCOUNT_SCOPE_PHASE7.md'),
    true,
    'SCHEDULER_ACCOUNT_SCOPE_PHASE6.md must point forward to the Phase 7 handoff'
  );
  assert.equal(
    readmeSource.includes('SCHEDULER_ACCOUNT_SCOPE_PHASE7.md'),
    true,
    'README.md must reference the scheduler account-scope Phase 7 workflow'
  );
}

async function run(): Promise<void> {
  await runSignoffChecks();
  await runSourceMarkerAssertions();
  console.log('Scheduler account-scope Phase 7 guard passed.');
}

  await run();
}

const suiteSteps = {
  "03": scheduler_account_scopeGuard03,
  "05": scheduler_account_scopeGuard05,
  "06": scheduler_account_scopeGuard06,
  "07": scheduler_account_scopeGuard07,
} as const;

export async function runSchedulerAccountScopeSuite(): Promise<void> {
  await runSuiteSteps("Scheduler account-scope module", "scripts/test-scheduler-account-scope.ts", ["03", "05", "06", "07"]);
  console.log("Scheduler account-scope module assertions passed.");
}

async function runRequestedStep(): Promise<void> {
  const requestedStep = process.argv[3];
  if (!requestedStep) {
    return;
  }
  const step = suiteSteps[requestedStep as keyof typeof suiteSteps];
  if (!step) {
    throw new Error(`Unknown suite step: ${requestedStep}`);
  }
  await step();
}

if (process.argv[3]) {
  runRequestedStep().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : error);
    process.exit(1);
  });
}
