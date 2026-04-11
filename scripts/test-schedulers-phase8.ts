import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { OrdersSchedulerController } from '../src/api/controllers/OrdersSchedulerController';

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

async function testOrdersSchedulerControllerStaysAdminOnly(): Promise<void> {
  const controller = new OrdersSchedulerController() as any;
  const calls: Array<{ method: string; args: unknown[] }> = [];

  controller.ordersSchedulerService = {
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
      expectedArgs: ['user-1', {}],
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
      args: ['10', '5', 'acct-1', 'owner-1', 'legacy-owner-1', 'mudrex'],
      expectedArgs: [
        'user-1',
        {
          limit: '10',
          offset: '5',
          accountId: 'acct-1',
          ownerUserId: 'owner-1',
          userId: 'legacy-owner-1',
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
    await assertAuthRequired(() =>
      controller[testCase.method](unauthReq, ...(testCase.args || []))
    );
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
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'orders-scheduler-phase8-'));
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
            'backend-orders-scheduler-phase2',
            'backend-orders-scheduler-phase3',
            'backend-orders-scheduler-phase4',
            'backend-orders-scheduler-phase5',
            'backend-orders-scheduler-phase7',
            'backend-orders-scheduler-phase8',
            'backend-orders-scheduler-phase9',
            'backend-orders-scheduler-controllers',
            'backend-orders-scheduler-eslint',
            'frontend-orders-scheduler-eslint',
            'frontend-orders-scheduler-ui',
            'frontend-orders-scheduler-e2e',
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
      ['--import', 'tsx', 'scripts/signoff-orders-scheduler.ts'],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          ORDERS_SCHEDULER_SIGNOFF_GATE_FILE: gateFile,
          ORDERS_SCHEDULER_SIGNOFF_OUTPUT_FILE: outputFile,
          ORDERS_SCHEDULER_SIGNOFF_OPERATOR_WALKTHROUGH_VERIFIED: 'true',
          ORDERS_SCHEDULER_SIGNOFF_RUNBOOK_REVIEW_VERIFIED: 'true',
          ORDERS_SCHEDULER_SIGNOFF_RUNTIME_FOUNDATION_VERIFIED: 'true',
          ORDERS_SCHEDULER_SIGNOFF_ACCESS_REVIEW_VERIFIED: 'true',
          ORDERS_SCHEDULER_SIGNOFF_APPROVER: 'Codex',
          ORDERS_SCHEDULER_SIGNOFF_OPERATOR_WALKTHROUGH_URL: '/tmp/orders-walkthrough.md',
        },
        encoding: 'utf8',
      }
    );

    assert.equal(
      result.status,
      0,
      result.stderr || result.stdout || 'orders scheduler signoff script should succeed'
    );
    const output = JSON.parse(await readFile(outputFile, 'utf8')) as Record<string, unknown>;
    assert.equal(output.decision, 'ready');
    assert.equal(output.approver, 'Codex');
    assert.equal(
      (output.checks as Record<string, unknown>).accessReviewVerified,
      true
    );
    assert.equal(
      ((output.evidence as Record<string, unknown>).operatorWalkthroughUrl as string) || '',
      '/tmp/orders-walkthrough.md'
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function run(): Promise<void> {
  await testOrdersSchedulerControllerStaysAdminOnly();
  await testFinalSignoffScriptCanProduceReadyArtifact();
  console.log('Schedulers Phase 8 assertions passed.');
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
