import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PositionsSchedulerController } from '../src/api/controllers/PositionsSchedulerController';

function createSuccess<T>(data: T) {
  return { success: true as const, data };
}

const adminAuthReq = { authUser: { sub: 'user-1', role: 'admin' } } as any;
const authReq = { authUser: { sub: 'user-1', role: 'user' } } as any;
const unauthReq = {} as any;

async function assertAdminRoleRequired(
  run: () => Promise<unknown>,
  message = 'Admin role is required'
): Promise<void> {
  await assert.rejects(
    run,
    (error: unknown) =>
      error instanceof Error &&
      error.message === message &&
      (error as { httpCode?: number }).httpCode === 403
  );
}

async function assertAuthRequired(
  run: () => Promise<unknown>,
  message = 'Authentication required'
): Promise<void> {
  await assert.rejects(
    run,
    (error: unknown) =>
      error instanceof Error &&
      error.message === message &&
      (error as { httpCode?: number }).httpCode === 401
  );
}

async function testPositionsSchedulerControllerStaysAdminOnly(): Promise<void> {
  const controller = new PositionsSchedulerController() as any;
  const calls: Array<{ method: string; args: unknown[] }> = [];

  controller.positionsSchedulerService = {
    async getSchedulerConfig(...args: unknown[]) {
      calls.push({ method: 'getSchedulerConfig', args });
      return createSuccess({ args });
    },
    async updateSchedulerConfig(...args: unknown[]) {
      calls.push({ method: 'updateSchedulerConfig', args });
      return createSuccess({ args });
    },
    async runNow(...args: unknown[]) {
      calls.push({ method: 'runNow', args });
      return createSuccess({ args });
    },
    async listReadModelRecoveryHistory(...args: unknown[]) {
      calls.push({ method: 'listReadModelRecoveryHistory', args });
      return createSuccess({ args });
    },
    async pauseScheduler(...args: unknown[]) {
      calls.push({ method: 'pauseScheduler', args });
      return createSuccess({ args });
    },
    async resumeScheduler(...args: unknown[]) {
      calls.push({ method: 'resumeScheduler', args });
      return createSuccess({ args });
    },
    async stopScheduler(...args: unknown[]) {
      calls.push({ method: 'stopScheduler', args });
      return createSuccess({ args });
    },
    async restartScheduler(...args: unknown[]) {
      calls.push({ method: 'restartScheduler', args });
      return createSuccess({ args });
    },
    async purgeSchedulerLogs(...args: unknown[]) {
      calls.push({ method: 'purgeSchedulerLogs', args });
      return createSuccess({ args });
    },
    async getSchedulerPurgePreview(...args: unknown[]) {
      calls.push({ method: 'getSchedulerPurgePreview', args });
      return createSuccess({ args });
    },
    async listSchedulerRuns(...args: unknown[]) {
      calls.push({ method: 'listSchedulerRuns', args });
      return createSuccess({ args });
    },
    async listSchedulerSyncState(...args: unknown[]) {
      calls.push({ method: 'listSchedulerSyncState', args });
      return createSuccess({ args });
    },
    async getSchedulerSyncStateSummary(...args: unknown[]) {
      calls.push({ method: 'getSchedulerSyncStateSummary', args });
      return createSuccess({ args });
    },
    async getSchedulerRunProgress(...args: unknown[]) {
      calls.push({ method: 'getSchedulerRunProgress', args });
      return createSuccess({ args });
    },
    async listSchedulerRunUpdates(...args: unknown[]) {
      calls.push({ method: 'listSchedulerRunUpdates', args });
      return createSuccess({ args });
    },
    async exportSchedulerRunUpdates(...args: unknown[]) {
      calls.push({ method: 'exportSchedulerRunUpdates', args });
      return createSuccess({ args });
    },
  };

  const cases: Array<{
    label: string;
    method: string;
    args?: unknown[];
    expectedArgs: unknown[];
  }> = [
    {
      label: 'config',
      method: 'getConfig',
      expectedArgs: ['user-1'],
    },
    {
      label: 'update',
      method: 'updateConfig',
      args: [{ enabled: true }],
      expectedArgs: ['user-1', { enabled: true }],
    },
    {
      label: 'run',
      method: 'runNow',
      expectedArgs: ['user-1'],
    },
    {
      label: 'read model recovery history',
      method: 'listReadModelRecoveryHistory',
      args: ['10', '5', 'warning'],
      expectedArgs: [
        'user-1',
        {
          limit: '10',
          offset: '5',
          status: 'warning',
        },
      ],
    },
    {
      label: 'pause',
      method: 'pause',
      expectedArgs: ['user-1'],
    },
    {
      label: 'resume',
      method: 'resume',
      expectedArgs: ['user-1'],
    },
    {
      label: 'stop',
      method: 'stop',
      expectedArgs: ['user-1'],
    },
    {
      label: 'restart',
      method: 'restart',
      expectedArgs: ['user-1'],
    },
    {
      label: 'purge logs',
      method: 'purgeLogs',
      expectedArgs: ['user-1'],
    },
    {
      label: 'purge preview',
      method: 'purgeLogsPreview',
      expectedArgs: ['user-1'],
    },
    {
      label: 'runs',
      method: 'listRuns',
      args: ['10', '5'],
      expectedArgs: ['user-1', { limit: '10', offset: '5' }],
    },
    {
      label: 'sync state',
      method: 'listSyncState',
      args: ['10', '5', 'acc-1', 'owner-1', 'mudrex'],
      expectedArgs: [
        'user-1',
        {
          limit: '10',
          offset: '5',
          accountId: 'acc-1',
          ownerUserId: 'owner-1',
          brokerKey: 'mudrex',
        },
      ],
    },
    {
      label: 'sync state summary',
      method: 'getSyncStateSummary',
      expectedArgs: ['user-1'],
    },
    {
      label: 'run progress',
      method: 'getRunProgress',
      args: ['run-1'],
      expectedArgs: ['user-1', 'run-1'],
    },
    {
      label: 'run updates',
      method: 'listRunUpdates',
      args: ['run-1', '25', '0', 'upsert', 'checkpoint', 'BTCUSDT', 'symbol', 'desc'],
      expectedArgs: [
        'user-1',
        'run-1',
        {
          limit: '25',
          offset: '0',
          actionType: 'upsert',
          source: 'checkpoint',
          symbol: 'BTCUSDT',
          sortBy: 'symbol',
          sortOrder: 'desc',
        },
      ],
    },
    {
      label: 'run updates export',
      method: 'exportRunUpdates',
      args: ['run-1', 'upsert', 'checkpoint', 'BTCUSDT', 'symbol', 'desc'],
      expectedArgs: [
        'user-1',
        'run-1',
        {
          actionType: 'upsert',
          source: 'checkpoint',
          symbol: 'BTCUSDT',
          sortBy: 'symbol',
          sortOrder: 'desc',
        },
      ],
    },
  ];

  for (const testCase of cases) {
    const beforeCalls = calls.length;
    await assertAuthRequired(() => controller[testCase.method](unauthReq, ...(testCase.args || [])));
    assert.equal(
      calls.length,
      beforeCalls,
      `${testCase.label} should not call the service when authentication is missing`
    );

    await assertAdminRoleRequired(() => controller[testCase.method](authReq, ...(testCase.args || [])));
    assert.equal(
      calls.length,
      beforeCalls,
      `${testCase.label} should not call the service for non-admin users`
    );

    const response = await controller[testCase.method](adminAuthReq, ...(testCase.args || []));
    assert.deepEqual(
      response.data.args,
      testCase.expectedArgs,
      `${testCase.label} should pass the canonical admin args through`
    );
    assert.equal(
      calls.length,
      beforeCalls + 1,
      `${testCase.label} should call the service exactly once for admin users`
    );
  }
}

async function testDeprecatedPositionsSyncAliasIsRetired(): Promise<void> {
  const source = await readFile(path.join(process.cwd(), 'src', 'loaders', 'ExpressLoader.ts'), 'utf8');
  assert.ok(
    !source.includes('/scheduler/positions-sync'),
    'ExpressLoader should no longer rewrite the deprecated /scheduler/positions-sync alias'
  );
  assert.ok(
    source.includes('/scheduler/orders-sync'),
    'ExpressLoader should keep the remaining supported orders alias intact'
  );
}

async function testFinalSignoffScriptCanProduceReadyArtifact(): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'positions-scheduler-phase8-'));
  const gateFile = path.join(tempDir, 'gate.json');
  const outputFile = path.join(tempDir, 'signoff.json');

  try {
    await writeFile(
      gateFile,
      `${JSON.stringify(
        {
          decision: 'ready',
          startedAt: '2026-04-10T00:00:00.000Z',
          finishedAt: '2026-04-10T00:10:00.000Z',
          liveChecksEnabled: false,
          totals: {
            total: 10,
            passed: 10,
            failed: 0,
            skipped: 0,
          },
          results: [
            'backend-positions-scheduler-phase1',
            'backend-positions-scheduler-phase2',
            'backend-positions-scheduler-phase3',
            'backend-positions-scheduler-phase4',
            'backend-positions-scheduler-phase5',
            'backend-positions-scheduler-phase6',
            'backend-positions-scheduler-phase7',
            'backend-positions-scheduler-phase8',
            'backend-positions-scheduler-operational-audit',
            'backend-positions-scheduler-eslint',
          ].map((key) => ({
            key,
            label: key,
            status: 'passed',
          })),
        },
        null,
        2
      )}\n`,
      'utf8'
    );

    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'scripts/signoff-positions-scheduler.ts'],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          POSITIONS_SCHEDULER_SIGNOFF_GATE_FILE: gateFile,
          POSITIONS_SCHEDULER_SIGNOFF_OUTPUT_FILE: outputFile,
          POSITIONS_SCHEDULER_SIGNOFF_DIAGNOSTICS_VERIFIED: 'true',
          POSITIONS_SCHEDULER_SIGNOFF_PRODUCT_TRUST_VERIFIED: 'true',
          POSITIONS_SCHEDULER_SIGNOFF_REBUILD_DRILL_VERIFIED: 'true',
          POSITIONS_SCHEDULER_SIGNOFF_RECOVERY_HISTORY_VERIFIED: 'true',
          POSITIONS_SCHEDULER_SIGNOFF_ACCESS_REVIEW_VERIFIED: 'true',
          POSITIONS_SCHEDULER_SIGNOFF_APPROVER: 'Codex',
        },
        encoding: 'utf8',
      }
    );

    assert.equal(result.status, 0, result.stderr || result.stdout || 'signoff script should succeed');
    const output = JSON.parse(await readFile(outputFile, 'utf8')) as Record<string, unknown>;
    assert.equal(output.decision, 'ready');
    assert.equal(output.approver, 'Codex');
    assert.equal((output.checks as Record<string, unknown>).recoveryHistoryVerified, true);
    assert.equal((output.checks as Record<string, unknown>).accessReviewVerified, true);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function testPositionsSchedulerLiveProofCanProduceReadyArtifact(): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'positions-scheduler-proof-phase8-'));
  const gateFile = path.join(tempDir, 'gate.json');
  const signoffFile = path.join(tempDir, 'signoff.json');
  const proofFile = path.join(tempDir, 'proof.json');
  const gateScript = path.join(tempDir, 'release-gate.stub.ts');
  const signoffScript = path.join(tempDir, 'signoff.stub.ts');

  const readyGateSummary = {
    decision: 'ready',
    generatedAt: '2026-04-10T12:00:00.000Z',
    liveChecksEnabled: true,
    totals: {
      total: 12,
      passed: 12,
      failed: 0,
      skipped: 0,
    },
    results: [
      'backend-positions-scheduler-phase1',
      'backend-positions-scheduler-phase2',
      'backend-positions-scheduler-phase3',
      'backend-positions-scheduler-phase4',
      'backend-positions-scheduler-phase5',
      'backend-positions-scheduler-phase6',
      'backend-positions-scheduler-phase7',
      'backend-positions-scheduler-phase8',
      'backend-positions-scheduler-operational-audit',
      'backend-positions-scheduler-eslint',
      'backend-positions-health',
      'backend-positions-scheduler-health',
    ].map((key) => ({
      key,
      label: key,
      status: 'passed',
    })),
  };

  const readySignoffSummary = {
    decision: 'ready',
    generatedAt: '2026-04-10T12:05:00.000Z',
    approver: 'codex-phase8',
    checks: {
      gateReady: true,
      requiredSuitesPassed: true,
      liveHealthReviewed: true,
      diagnosticsVerified: true,
      productTrustVerified: true,
      rebuildDrillVerified: true,
      recoveryHistoryVerified: true,
      accessReviewVerified: true,
    },
    evidence: {
      workflowUrl: 'https://example.com/workflows/positions-scheduler',
      dashboardUrl: 'https://example.com/dashboards/positions-scheduler',
      runbookUrl: 'https://example.com/runbooks/positions-scheduler',
      releaseNoteUrl: 'https://example.com/releases/positions-scheduler',
      recoveryEvidenceUrl: 'https://example.com/evidence/positions-read-model-recovery',
    },
  };

  try {
    await writeFile(
      gateScript,
      `import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const outputFile = path.resolve(process.cwd(), String(process.env.POSITIONS_SCHEDULER_RELEASE_GATE_OUTPUT_FILE || '').trim());

async function run(): Promise<void> {
  assert.equal(process.env.POSITIONS_SCHEDULER_RUN_LIVE_CHECKS, 'true');
  assert.ok(outputFile, 'POSITIONS_SCHEDULER_RELEASE_GATE_OUTPUT_FILE must be provided');
  await mkdir(path.dirname(outputFile), { recursive: true });
  const summary = ${JSON.stringify(readyGateSummary, null, 2)};
  await writeFile(outputFile, \`\${JSON.stringify(summary, null, 2)}\\n\`, 'utf8');
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
`,
      'utf8'
    );

    await writeFile(
      signoffScript,
      `import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const gateFile = path.resolve(process.cwd(), String(process.env.POSITIONS_SCHEDULER_SIGNOFF_GATE_FILE || '').trim());
const outputFile = path.resolve(process.cwd(), String(process.env.POSITIONS_SCHEDULER_SIGNOFF_OUTPUT_FILE || '').trim());

async function run(): Promise<void> {
  assert.equal(process.env.POSITIONS_SCHEDULER_SIGNOFF_REQUIRE_LIVE_HEALTH, 'true');
  assert.equal(
    process.env.POSITIONS_SCHEDULER_SIGNOFF_RECOVERY_EVIDENCE_URL,
    'https://example.com/evidence/positions-read-model-recovery'
  );
  const rawGate = await readFile(gateFile, 'utf8');
  const gate = JSON.parse(rawGate) as { decision?: string; liveChecksEnabled?: boolean };
  assert.equal(gate.decision, 'ready');
  assert.equal(gate.liveChecksEnabled, true);
  await mkdir(path.dirname(outputFile), { recursive: true });
  const summary = ${JSON.stringify(readySignoffSummary, null, 2)};
  await writeFile(outputFile, \`\${JSON.stringify(summary, null, 2)}\\n\`, 'utf8');
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
`,
      'utf8'
    );

    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'scripts/proof-positions-scheduler-live.ts'],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          POSITIONS_SCHEDULER_PROOF_RELEASE_GATE_SCRIPT: gateScript,
          POSITIONS_SCHEDULER_PROOF_SIGNOFF_SCRIPT: signoffScript,
          POSITIONS_SCHEDULER_RELEASE_GATE_OUTPUT_FILE: gateFile,
          POSITIONS_SCHEDULER_SIGNOFF_OUTPUT_FILE: signoffFile,
          POSITIONS_SCHEDULER_PROOF_OUTPUT_FILE: proofFile,
          POSITIONS_SCHEDULER_SIGNOFF_APPROVER: 'codex-phase8',
          POSITIONS_SCHEDULER_SIGNOFF_DIAGNOSTICS_VERIFIED: 'true',
          POSITIONS_SCHEDULER_SIGNOFF_PRODUCT_TRUST_VERIFIED: 'true',
          POSITIONS_SCHEDULER_SIGNOFF_REBUILD_DRILL_VERIFIED: 'true',
          POSITIONS_SCHEDULER_SIGNOFF_RECOVERY_HISTORY_VERIFIED: 'true',
          POSITIONS_SCHEDULER_SIGNOFF_ACCESS_REVIEW_VERIFIED: 'true',
          POSITIONS_SCHEDULER_SIGNOFF_RECOVERY_EVIDENCE_URL:
            'https://example.com/evidence/positions-read-model-recovery',
        },
        encoding: 'utf8',
      }
    );

    assert.equal(
      result.status,
      0,
      result.stderr || result.stdout || 'positions scheduler live proof should succeed'
    );

    const output = JSON.parse(await readFile(proofFile, 'utf8')) as Record<string, unknown>;
    assert.equal(output.decision, 'ready');
    assert.equal(output.approver, 'codex-phase8');
    assert.equal(output.gateDecision, 'ready');
    assert.equal(output.signoffDecision, 'ready');
    assert.equal(output.liveChecksEnabled, true);
    assert.equal(output.releaseGateFile, path.resolve(process.cwd(), gateFile));
    assert.equal(output.signoffFile, path.resolve(process.cwd(), signoffFile));
    assert.equal(output.proofOutputFile, path.resolve(process.cwd(), proofFile));
    assert.deepEqual(output.gateTotals, readyGateSummary.totals);

    const checks = (output.checks || {}) as Record<string, unknown>;
    assert.equal(checks.liveHealthReviewed, true);
    assert.equal(checks.recoveryHistoryVerified, true);

    const evidence = (output.evidence || {}) as Record<string, unknown>;
    assert.equal(
      evidence.recoveryEvidenceUrl,
      readySignoffSummary.evidence.recoveryEvidenceUrl
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function testPhase8SourceMarkersStayWired(): Promise<void> {
  const releaseGateSource = await readFile(
    path.join(process.cwd(), 'scripts', 'release-gate-positions-scheduler.ts'),
    'utf8'
  );
  const signoffSource = await readFile(
    path.join(process.cwd(), 'scripts', 'signoff-positions-scheduler.ts'),
    'utf8'
  );
  const operationalAuditSource = await readFile(
    path.join(process.cwd(), 'scripts', 'test-operational-audit.ts'),
    'utf8'
  );

  assert.equal(
    releaseGateSource.includes('backend-positions-scheduler-phase8'),
    true,
    'release gate must include the Phase 8 positions scheduler suite'
  );
  assert.equal(
    signoffSource.includes('backend-positions-scheduler-phase8'),
    true,
    'positions scheduler signoff must require the Phase 8 gate result'
  );
  assert.equal(
    operationalAuditSource.includes('"proof:positions-scheduler-live"'),
    true,
    'operational audit must treat the positions scheduler proof workflow as required'
  );
}

async function run(): Promise<void> {
  await testPositionsSchedulerControllerStaysAdminOnly();
  await testDeprecatedPositionsSyncAliasIsRetired();
  await testFinalSignoffScriptCanProduceReadyArtifact();
  await testPositionsSchedulerLiveProofCanProduceReadyArtifact();
  await testPhase8SourceMarkersStayWired();
  console.log('Positions scheduler phase 8 assertions passed.');
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
