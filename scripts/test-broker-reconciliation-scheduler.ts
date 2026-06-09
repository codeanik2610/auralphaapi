import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { InternalBrokerReconciliationController } from '../src/api/controllers/InternalBrokerReconciliationController';
import {
  BrokerReconciliationBatchResponse,
  BrokerReconciliationScheduledRunResponse,
} from '../src/api/contracts/BrokerReconciliation';
import { BrokerReconciliationSchedulerService } from '../src/api/services/BrokerReconciliationSchedulerService';
import { SchedulerConfig } from '../src/database/entities/SchedulerConfig';

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function createSuccess<T>(data: T) {
  return { success: true as const, data };
}

function config(overrides: Partial<SchedulerConfig> = {}): SchedulerConfig {
  return {
    id: 'config-1',
    key: 'broker-reconciliation-sync',
    name: 'Broker Reconciliation Sync',
    description:
      'Runs read-only Mudrex/Delta broker evidence sync and app-vs-broker reconciliation matching.',
    enabled: true,
    cronExpression: '*/15 * * * *',
    timezone: 'Asia/Kolkata',
    runAt: '01:00',
    intervalDays: 1,
    batchSize: 200,
    schedulerType: 'user',
    config: {
      sources: ['mudrex'],
      brokerKeys: ['mudrex'],
      retentionDays: 30,
      lookbackHours: 12,
      lockMinutes: 5,
      fallbackWindowMinutes: 30,
      sync: true,
      match: true,
    },
    lastStartedAt: null,
    lastFinishedAt: null,
    lastStatus: null,
    lastError: null,
    runningLockUntil: null,
    createdAt: new Date('2026-06-09T00:00:00.000Z'),
    updatedAt: new Date('2026-06-09T00:00:00.000Z'),
    ...overrides,
  };
}

function batchResponse(
  overrides: Partial<BrokerReconciliationBatchResponse> = {}
): BrokerReconciliationBatchResponse {
  return {
    startedAt: '2026-06-09T10:00:00.000Z',
    finishedAt: '2026-06-09T10:00:01.000Z',
    requested: {
      sync: true,
      match: true,
      startDate: '2026-06-08T10:00:00.000Z',
      endDate: '2026-06-09T10:00:00.000Z',
      fallbackWindowMinutes: 30,
    },
    summary: {
      totalAccounts: 2,
      completedAccounts: 2,
      skippedAccounts: 0,
      unsupportedBrokerAccounts: 0,
      syncFailedAccounts: 0,
      matchFailedAccounts: 0,
    },
    results: [
      {
        userId: 'user-1',
        brokerKey: 'mudrex',
        accountId: 'mudrex-1',
        status: 'completed',
        sync: { status: 'completed', runId: 'sync-run-1', errorMessage: null },
        match: { status: 'completed', runId: 'match-run-1', errorMessage: null },
      },
      {
        userId: 'user-2',
        brokerKey: 'mudrex',
        accountId: 'mudrex-2',
        status: 'completed',
        sync: { status: 'completed', runId: 'sync-run-2', errorMessage: null },
        match: { status: 'completed', runId: 'match-run-2', errorMessage: null },
      },
    ],
    ...overrides,
  };
}

async function runSchedulerSuccessAssertions(): Promise<void> {
  const service: any = new BrokerReconciliationSchedulerService();
  const calls: Array<{ method: string; args: unknown[] }> = [];

  service.schedulerConfigRepository = {
    async createIfMissing(payload: unknown) {
      calls.push({ method: 'createIfMissing', args: [payload] });
      return config();
    },
    async updateByKey(key: string, payload: unknown) {
      calls.push({ method: 'updateByKey', args: [key, payload] });
      return config(payload as Partial<SchedulerConfig>);
    },
    async tryAcquireRunLock(key: string, lockUntil: Date) {
      calls.push({ method: 'tryAcquireRunLock', args: [key, lockUntil] });
      return true;
    },
    async releaseRunLock(key: string) {
      calls.push({ method: 'releaseRunLock', args: [key] });
    },
  };
  service.schedulerRunLogRepository = {
    async createRun(payload: unknown) {
      calls.push({ method: 'createRun', args: [payload] });
      return { id: 'sched-run-1' };
    },
    async updateRun(runId: string, payload: unknown) {
      calls.push({ method: 'updateRun', args: [runId, payload] });
    },
  };
  service.brokerReconciliationBatchService = {
    async runBatch(payload: unknown) {
      calls.push({ method: 'runBatch', args: [payload] });
      return batchResponse();
    },
  };

  const result: BrokerReconciliationScheduledRunResponse = await service.runScheduledBatch({
    startDate: '2026-06-08T10:00:00.000Z',
    endDate: '2026-06-09T10:00:00.000Z',
    trigger: 'phase9_manual_dry_run_after_date_fix',
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.locked, true);
  assert.equal(result.runLogId, 'sched-run-1');
  assert.equal(result.batch?.summary.completedAccounts, 2);
  const createRunPayload = calls.find((call) => call.method === 'createRun')?.args[0] as Record<
    string,
    unknown
  >;
  assert.equal(createRunPayload.initiatedByType, 'manual');
  assert.equal(
    (createRunPayload.meta as Record<string, unknown>).trigger,
    'phase9_manual_dry_run_after_date_fix'
  );
  assert.deepEqual(calls.find((call) => call.method === 'runBatch')?.args[0], {
    targetUserIds: ['system'],
    brokerKeys: ['mudrex'],
    accountIds: [],
    accounts: null,
    startDate: '2026-06-08T10:00:00.000Z',
    endDate: '2026-06-09T10:00:00.000Z',
    fallbackWindowMinutes: 30,
    sync: true,
    match: true,
  });
  assert.equal(
    calls.some((call) => call.method === 'releaseRunLock'),
    true
  );

  const finalRunUpdate = calls.filter((call) => call.method === 'updateRun').at(-1);
  assert.equal(finalRunUpdate?.args[0], 'sched-run-1');
  const finalRunPayload = finalRunUpdate?.args[1] as Record<string, unknown>;
  assert.equal(finalRunPayload.status, 'Completed');
  assert.equal(finalRunPayload.processedAccounts, 2);
  assert.equal(finalRunPayload.insertedAssets, 2);

  const finalConfigUpdate = calls.filter((call) => call.method === 'updateByKey').at(-1);
  const finalConfigPayload = finalConfigUpdate?.args[1] as Record<string, unknown>;
  assert.equal(finalConfigPayload.lastStatus, 'Completed');
  assert.equal(finalConfigPayload.lastError, null);
}

async function runSchedulerWarningAssertions(): Promise<void> {
  const service: any = new BrokerReconciliationSchedulerService();
  const calls: Array<{ method: string; args: unknown[] }> = [];

  service.schedulerConfigRepository = {
    async createIfMissing() {
      return config();
    },
    async updateByKey(key: string, payload: unknown) {
      calls.push({ method: 'updateByKey', args: [key, payload] });
      return config(payload as Partial<SchedulerConfig>);
    },
    async tryAcquireRunLock() {
      return true;
    },
    async releaseRunLock() {
      calls.push({ method: 'releaseRunLock', args: [] });
    },
  };
  service.schedulerRunLogRepository = {
    async createRun() {
      return { id: 'sched-run-warning' };
    },
    async updateRun(runId: string, payload: unknown) {
      calls.push({ method: 'updateRun', args: [runId, payload] });
    },
  };
  service.brokerReconciliationBatchService = {
    async runBatch() {
      return batchResponse({
        summary: {
          totalAccounts: 2,
          completedAccounts: 1,
          skippedAccounts: 0,
          unsupportedBrokerAccounts: 0,
          syncFailedAccounts: 1,
          matchFailedAccounts: 0,
        },
      });
    },
  };

  const result = await service.runScheduledBatch({
    startDate: '2026-06-08T10:00:00.000Z',
    endDate: '2026-06-09T10:00:00.000Z',
  });

  assert.equal(result.status, 'warning');
  assert.match(result.errorMessage || '', /1 account issue/);
  const finalRunPayload = calls.find((call) => call.method === 'updateRun')?.args[1] as Record<
    string,
    unknown
  >;
  assert.equal(finalRunPayload.status, 'Warning');
  assert.equal(finalRunPayload.updatedAssets, 1);
  assert.equal(
    calls.some((call) => call.method === 'releaseRunLock'),
    true
  );
}

async function runSchedulerDisabledAssertions(): Promise<void> {
  const service: any = new BrokerReconciliationSchedulerService();
  const calls: Array<{ method: string; args: unknown[] }> = [];

  service.schedulerConfigRepository = {
    async createIfMissing() {
      return config({ enabled: false });
    },
    async updateByKey(key: string, payload: unknown) {
      calls.push({ method: 'updateByKey', args: [key, payload] });
      return config(payload as Partial<SchedulerConfig>);
    },
    async tryAcquireRunLock() {
      throw new Error('disabled run must not acquire lock');
    },
    async releaseRunLock() {
      throw new Error('disabled run must not release lock');
    },
  };
  service.schedulerRunLogRepository = {
    async createRun(payload: unknown) {
      calls.push({ method: 'createRun', args: [payload] });
      return { id: 'sched-run-disabled' };
    },
  };
  service.brokerReconciliationBatchService = {
    async runBatch() {
      throw new Error('disabled run must not execute batch');
    },
  };

  const result = await service.runScheduledBatch();

  assert.equal(result.status, 'skipped_disabled');
  assert.equal(result.locked, false);
  assert.equal(result.runLogId, 'sched-run-disabled');
  assert.equal(
    (calls.find((call) => call.method === 'createRun')?.args[0] as any).status,
    'Skipped'
  );
  assert.equal(
    (calls.find((call) => call.method === 'updateByKey')?.args[1] as any).lastStatus,
    'Warning'
  );
}

async function runSchedulerLockAssertions(): Promise<void> {
  const service: any = new BrokerReconciliationSchedulerService();
  const calls: Array<{ method: string; args: unknown[] }> = [];

  service.schedulerConfigRepository = {
    async createIfMissing() {
      return config();
    },
    async updateByKey(key: string, payload: unknown) {
      calls.push({ method: 'updateByKey', args: [key, payload] });
      return config(payload as Partial<SchedulerConfig>);
    },
    async tryAcquireRunLock(key: string) {
      calls.push({ method: 'tryAcquireRunLock', args: [key] });
      return false;
    },
    async releaseRunLock() {
      throw new Error('locked skip must not release lock it did not acquire');
    },
  };
  service.schedulerRunLogRepository = {
    async createRun(payload: unknown) {
      calls.push({ method: 'createRun', args: [payload] });
      return { id: 'sched-run-locked' };
    },
  };
  service.brokerReconciliationBatchService = {
    async runBatch() {
      throw new Error('locked run must not execute batch');
    },
  };

  const result = await service.runScheduledBatch({ force: true });

  assert.equal(result.status, 'skipped_locked');
  assert.equal(result.locked, false);
  assert.equal(result.runLogId, 'sched-run-locked');
  assert.equal(
    calls.some((call) => call.method === 'tryAcquireRunLock'),
    true
  );
  assert.equal(
    (calls.find((call) => call.method === 'createRun')?.args[0] as any).status,
    'Skipped'
  );
}

async function runSchedulerFailureAssertions(): Promise<void> {
  const service: any = new BrokerReconciliationSchedulerService();
  const calls: Array<{ method: string; args: unknown[] }> = [];

  service.schedulerConfigRepository = {
    async createIfMissing() {
      return config();
    },
    async updateByKey(key: string, payload: unknown) {
      calls.push({ method: 'updateByKey', args: [key, payload] });
      return config(payload as Partial<SchedulerConfig>);
    },
    async tryAcquireRunLock() {
      return true;
    },
    async releaseRunLock() {
      calls.push({ method: 'releaseRunLock', args: [] });
    },
  };
  service.schedulerRunLogRepository = {
    async createRun() {
      return { id: 'sched-run-failed' };
    },
    async updateRun(runId: string, payload: unknown) {
      calls.push({ method: 'updateRun', args: [runId, payload] });
    },
  };
  service.brokerReconciliationBatchService = {
    async runBatch() {
      throw new Error('broker API timeout');
    },
  };

  const result = await service.runScheduledBatch({ force: true });

  assert.equal(result.status, 'failed');
  assert.equal(result.errorMessage, 'broker API timeout');
  assert.equal(
    (calls.find((call) => call.method === 'updateRun')?.args[1] as any).status,
    'Failed'
  );
  assert.equal(
    (calls.filter((call) => call.method === 'updateByKey').at(-1)?.args[1] as any).lastStatus,
    'Failed'
  );
  assert.equal(
    calls.some((call) => call.method === 'releaseRunLock'),
    true
  );
}

async function runInternalControllerAssertions(): Promise<void> {
  const controller: any = new InternalBrokerReconciliationController();
  const input = { force: true, trigger: 'worker' };
  const output: BrokerReconciliationScheduledRunResponse = {
    schedulerKey: 'broker-reconciliation-sync',
    runLogId: 'sched-run-1',
    status: 'completed',
    locked: true,
    startedAt: '2026-06-09T10:00:00.000Z',
    finishedAt: '2026-06-09T10:00:01.000Z',
    window: {
      startDate: '2026-06-08T10:00:00.000Z',
      endDate: '2026-06-09T10:00:00.000Z',
      lookbackHours: 24,
    },
    batch: batchResponse(),
    errorMessage: null,
  };

  controller.brokerReconciliationSchedulerService = {
    async runScheduledBatch(body: unknown) {
      assert.deepEqual(body, input);
      return output;
    },
  };

  assert.deepEqual(await controller.runScheduledBatch(input), createSuccess(output));
}

function runSourceWiringAssertions(): void {
  const packageJson = JSON.parse(read('package.json')) as { scripts?: Record<string, string> };
  assert.equal(
    packageJson.scripts?.['test:broker-reconciliation-scheduler'],
    'node --import tsx scripts/_support/run-doc-aware-test.ts scripts/test-broker-reconciliation-scheduler.ts'
  );

  const suiteSource = read('scripts/_support/run-package-suite.ts');
  assert.match(suiteSource, /'broker-reconciliation-scheduler':\s*'baseline'/);
  assert.match(
    suiteSource,
    /'broker-reconciliation-scheduler':\s*\['test:broker-reconciliation-scheduler'\]/
  );

  const controllerSource = read('src/api/controllers/InternalBrokerReconciliationController.ts');
  assert.match(controllerSource, /@Post\('\/scheduler\/run'\)/);

  const serviceSource = read('src/api/services/BrokerReconciliationSchedulerService.ts');
  assert.match(serviceSource, /tryAcquireRunLock/);
  assert.match(serviceSource, /releaseRunLock/);
  assert.match(serviceSource, /broker-reconciliation-sync/);

  const seedSource = read('scripts/db/db-seed-production-bootstrap.ts');
  assert.match(seedSource, /key:\s*'broker-reconciliation-sync'/);
  assert.match(seedSource, /broker-reconciliation-sync/);
  assert.match(seedSource, /lookbackHours:\s*24/);
}

async function main(): Promise<void> {
  await runSchedulerSuccessAssertions();
  await runSchedulerWarningAssertions();
  await runSchedulerDisabledAssertions();
  await runSchedulerLockAssertions();
  await runSchedulerFailureAssertions();
  await runInternalControllerAssertions();
  runSourceWiringAssertions();
  console.log('Broker reconciliation scheduler assertions passed.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
