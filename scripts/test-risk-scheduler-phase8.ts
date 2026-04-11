import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { RiskSchedulerController } from '../src/api/controllers/RiskSchedulerController';

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

async function testRiskSchedulerControllerStaysAdminOnly(): Promise<void> {
  const controller = new RiskSchedulerController() as any;
  const calls: Array<{ method: string; args: unknown[] }> = [];

  controller.riskSchedulerService = {
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
    async getSchedulerDiagnosticsSummary(...args: unknown[]) {
      calls.push({ method: 'getSchedulerDiagnosticsSummary', args });
      return createSuccess({ args });
    },
    async listSchedulerRuns(...args: unknown[]) {
      calls.push({ method: 'listSchedulerRuns', args });
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
    { label: 'config', method: 'getConfig', expectedArgs: ['user-1'] },
    {
      label: 'update',
      method: 'updateConfig',
      args: [{ enabled: true }],
      expectedArgs: ['user-1', { enabled: true }],
    },
    { label: 'run', method: 'runNow', expectedArgs: ['user-1'] },
    { label: 'pause', method: 'pause', expectedArgs: ['user-1'] },
    { label: 'resume', method: 'resume', expectedArgs: ['user-1'] },
    { label: 'stop', method: 'stop', expectedArgs: ['user-1'] },
    { label: 'restart', method: 'restart', expectedArgs: ['user-1'] },
    { label: 'purge logs', method: 'purgeLogs', expectedArgs: ['user-1'] },
    { label: 'purge preview', method: 'purgeLogsPreview', expectedArgs: ['user-1'] },
    { label: 'summary', method: 'getSummary', expectedArgs: ['user-1'] },
    {
      label: 'runs',
      method: 'listRuns',
      args: ['10', '5'],
      expectedArgs: ['user-1', { limit: '10', offset: '5' }],
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
      args: ['run-1', '25', '0', 'upsert', 'risk', 'BTCUSDT', 'symbol', 'desc'],
      expectedArgs: [
        'user-1',
        'run-1',
        {
          limit: '25',
          offset: '0',
          actionType: 'upsert',
          source: 'risk',
          symbol: 'BTCUSDT',
          sortBy: 'symbol',
          sortOrder: 'desc',
        },
      ],
    },
    {
      label: 'run updates export',
      method: 'exportRunUpdates',
      args: ['run-1', 'upsert', 'risk', 'BTCUSDT', 'symbol', 'desc'],
      expectedArgs: [
        'user-1',
        'run-1',
        {
          actionType: 'upsert',
          source: 'risk',
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

    await assertAdminRoleRequired(() =>
      controller[testCase.method](authReq, ...(testCase.args || []))
    );
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

async function testFinalSignoffScriptCanProduceReadyArtifact(): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'risk-scheduler-phase8-'));
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
            total: 12,
            passed: 12,
            failed: 0,
            skipped: 0,
          },
          results: [
            'backend-risk-scheduler-phase1',
            'backend-risk-scheduler-phase2',
            'backend-risk-scheduler-phase4',
            'backend-risk-scheduler-phase5',
            'backend-risk-scheduler-phase6',
            'backend-risk-scheduler-phase8',
            'backend-risk-center-phase6',
            'backend-controllers',
            'backend-operational-audit',
            'backend-risk-scheduler-eslint',
            'frontend-schedulers-risk-ui',
            'frontend-schedulers-risk-eslint',
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
      ['--import', 'tsx', 'scripts/signoff-risk-scheduler.ts'],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          RISK_SCHEDULER_SIGNOFF_GATE_FILE: gateFile,
          RISK_SCHEDULER_SIGNOFF_OUTPUT_FILE: outputFile,
          RISK_SCHEDULER_SIGNOFF_DIAGNOSTICS_VERIFIED: 'true',
          RISK_SCHEDULER_SIGNOFF_PRODUCT_TRUST_VERIFIED: 'true',
          RISK_SCHEDULER_SIGNOFF_RECOMPUTE_WRITES_VERIFIED: 'true',
          RISK_SCHEDULER_SIGNOFF_ACCESS_REVIEW_VERIFIED: 'true',
          RISK_SCHEDULER_SIGNOFF_APPROVER: 'Codex',
        },
        encoding: 'utf8',
      }
    );

    assert.equal(result.status, 0, result.stderr || result.stdout || 'signoff script should succeed');
    const output = JSON.parse(await readFile(outputFile, 'utf8')) as Record<string, unknown>;
    assert.equal(output.decision, 'ready');
    assert.equal(output.approver, 'Codex');
    assert.equal((output.checks as Record<string, unknown>).recomputeWritesVerified, true);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function run(): Promise<void> {
  await testRiskSchedulerControllerStaysAdminOnly();
  await testFinalSignoffScriptCanProduceReadyArtifact();
  console.log('Risk scheduler phase 8 assertions passed.');
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
