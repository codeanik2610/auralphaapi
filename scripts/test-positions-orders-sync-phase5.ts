import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { OrdersSchedulerService } from '../src/api/services/OrdersSchedulerService';
import { PositionsSchedulerService } from '../src/api/services/PositionsSchedulerService';

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

async function runPositionsRuntimeAssertions(): Promise<void> {
  const service = new PositionsSchedulerService() as any;
  const runDate = new Date('2026-04-10T01:00:00.000Z');
  const finishDate = new Date('2026-04-10T01:05:00.000Z');
  const updateDate = new Date('2026-04-10T01:02:00.000Z');

  const anchorConfig: any = {
    key: 'positions-sync',
    name: 'Positions Sync',
    description: 'Positions reconciliation scheduler.',
    enabled: true,
    cronExpression: '0 1 * * *',
    timezone: 'UTC',
    runAt: '01:00',
    intervalDays: 1,
    batchSize: 200,
    schedulerType: 'user',
    config: {
      sources: ['positions'],
      retentionDays: 30,
      lookbackDays: 90,
    },
  };
  const userConfig: any = {
    schedulerKey: 'positions-sync',
    userId: 'admin-user-1',
    name: 'Positions Sync',
    description: 'Positions reconciliation scheduler.',
    enabled: true,
    cronExpression: '0 1 * * *',
    timezone: 'UTC',
    runAt: '01:00',
    intervalDays: 1,
    batchSize: 200,
    schedulerType: 'user',
    config: {
      sources: ['positions'],
      retentionDays: 30,
      lookbackDays: 90,
    },
    lastStartedAt: runDate,
    lastFinishedAt: finishDate,
    lastStatus: 'Completed',
    lastError: null,
    runningLockUntil: null,
  };

  const sampleRun: any = {
    id: 'positions-run-1',
    schedulerKey: 'positions-sync',
    status: 'Completed',
    startedAt: runDate,
    finishedAt: finishDate,
    durationMs: 300000,
    processedAccounts: 2,
    insertedAssets: 3,
    updatedAssets: 1,
    skippedAssets: 4,
    errorMessage: null,
    initiatedByType: 'manual',
    initiatedByUserId: 'admin-user-1',
    initiatedByLabel: 'admin-user-1',
    executionContext: 'system',
    meta: {
      progress: {
        total: 2,
        processed: 2,
        percent: 100,
        currentItem: {
          symbol: 'BTCUSDT',
          assetId: 'asset-1',
          id: 'current-1',
        },
      },
    },
  };

  const sampleUpdate: any = {
    id: 'positions-update-1',
    runLogId: 'positions-run-1',
    source: 'positions',
    accountId: 'acct-1',
    connectionId: null,
    actionType: 'updated',
    symbol: 'BTCUSDT',
    externalId: 'pos-1',
    assetId: 'asset-1',
    message: 'Position updated',
    detail: {
      reason: 'payload changed',
    },
    createdAt: updateDate,
    initiatedByType: null,
    initiatedByUserId: null,
    initiatedByLabel: null,
    executionContext: null,
  };

  let createdRunPayload: any = null;
  const createdCommands: any[] = [];
  let running = false;
  let updatePreviewCalls = 0;
  let updateDeleteCalls = 0;

  service.userTimeZoneService = {
    async resolveUserTimeZone() {
      return 'UTC';
    },
  };
  service.schedulerConfigRepository = {
    async createIfMissing() {
      return anchorConfig;
    },
    async updateByKey(_key: string, payload: Record<string, unknown>) {
      Object.assign(anchorConfig, payload);
      return anchorConfig;
    },
  };
  service.schedulerUserConfigRepository = {
    async createIfMissing(payload: Record<string, unknown>) {
      assert.equal(payload.schedulerKey, 'positions-sync');
      assert.equal(payload.userId, 'admin-user-1');
      return userConfig;
    },
    async updateBySchedulerKeyAndUserId(
      schedulerKey: string,
      userId: string,
      payload: Record<string, unknown>
    ) {
      assert.equal(schedulerKey, 'positions-sync');
      assert.equal(userId, 'admin-user-1');
      Object.assign(userConfig, payload);
      return userConfig;
    },
  };
  service.schedulerRunLogRepository = {
    async hasRunningRunBySchedulerKeyAndActor(schedulerKey: string, actorUserId: string) {
      assert.equal(schedulerKey, 'positions-sync');
      assert.equal(actorUserId, 'admin-user-1');
      return running;
    },
    async createRun(payload: Record<string, unknown>) {
      createdRunPayload = payload;
      return payload;
    },
    async listRunsBySchedulerKeyAndActor(
      schedulerKey: string,
      actorUserId: string,
      limit: number,
      offset: number
    ) {
      assert.equal(schedulerKey, 'positions-sync');
      assert.equal(actorUserId, 'admin-user-1');
      assert.equal(limit, 10);
      assert.equal(offset, 0);
      return { items: [sampleRun], total: 1 };
    },
    async findByIdAndSchedulerKeyAndActor(
      runId: string,
      schedulerKey: string,
      actorUserId: string
    ) {
      assert.equal(schedulerKey, 'positions-sync');
      assert.equal(actorUserId, 'admin-user-1');
      return runId === 'positions-run-1' ? sampleRun : null;
    },
    async countOlderThanDaysBySchedulerKeyAndActor(
      schedulerKey: string,
      actorUserId: string,
      retentionDays: number
    ) {
      assert.equal(schedulerKey, 'positions-sync');
      assert.equal(actorUserId, 'admin-user-1');
      assert.equal(retentionDays, 30);
      return 6;
    },
    async deleteOlderThanDaysBySchedulerKeyAndActor(
      schedulerKey: string,
      actorUserId: string,
      retentionDays: number
    ) {
      assert.equal(schedulerKey, 'positions-sync');
      assert.equal(actorUserId, 'admin-user-1');
      assert.equal(retentionDays, 30);
      return 4;
    },
    async cancelQueuedRunsBySchedulerKeyAndActor(
      schedulerKey: string,
      actorUserId: string
    ) {
      assert.equal(schedulerKey, 'positions-sync');
      assert.equal(actorUserId, 'admin-user-1');
      return 0;
    },
  };
  service.schedulerCommandRepository = {
    async findLatestBySchedulerKeyAndTypeAndActorInStatuses(
      schedulerKey: string,
      commandType: string,
      actorUserId: string
    ) {
      assert.equal(schedulerKey, 'positions-sync');
      assert.equal(commandType, 'run_now');
      assert.equal(actorUserId, 'admin-user-1');
      return null;
    },
    async createCommand(payload: Record<string, unknown>) {
      createdCommands.push(payload);
      return { id: `positions-command-${createdCommands.length}`, ...payload };
    },
    async cancelPendingBySchedulerKeyAndActor(
      schedulerKey: string,
      actorUserId: string
    ) {
      assert.equal(schedulerKey, 'positions-sync');
      assert.equal(actorUserId, 'admin-user-1');
      return 0;
    },
    async cancelPendingBySchedulerKeyAndTypeAndActor(
      schedulerKey: string,
      commandType: string,
      actorUserId: string
    ) {
      assert.equal(schedulerKey, 'positions-sync');
      assert.equal(commandType, 'run_now');
      assert.equal(actorUserId, 'admin-user-1');
      return 0;
    },
  };
  service.exchangeAssetUpdateLogRepository = {
    async listByRunLogId(runLogId: string, limit: number, offset: number) {
      assert.equal(runLogId, 'positions-run-1');
      assert.equal(limit >= 1, true);
      assert.equal(offset, 0);
      return { items: [sampleUpdate], total: 1 };
    },
    async countOlderThanDaysBySchedulerKeyAndActor(
      schedulerKey: string,
      actorUserId: string,
      retentionDays: number
    ) {
      updatePreviewCalls += 1;
      assert.equal(schedulerKey, 'positions-sync');
      assert.equal(actorUserId, 'admin-user-1');
      assert.equal(retentionDays, 30);
      return 7;
    },
    async deleteOlderThanDaysBySchedulerKeyAndActor(
      schedulerKey: string,
      actorUserId: string,
      retentionDays: number
    ) {
      updateDeleteCalls += 1;
      assert.equal(schedulerKey, 'positions-sync');
      assert.equal(actorUserId, 'admin-user-1');
      assert.equal(retentionDays, 30);
      return 5;
    },
  };
  service.activityRepository = {
    async createActivityLog() {
      return;
    },
  };
  service.alertRepository = {
    async findRecentOpenAlertBySource() {
      return null;
    },
    async createAlert() {
      return;
    },
  };

  const configResponse = await service.getSchedulerConfig('admin-user-1');
  assert.equal(configResponse.data.lastStartedAtIso, '2026-04-10T01:00:00.000Z');
  assert.equal(configResponse.data.lastFinishedAtIso, '2026-04-10T01:05:00.000Z');

  await service.runNow('admin-user-1');
  assert.equal(createdRunPayload.initiatedByType, 'manual');
  assert.equal(createdRunPayload.initiatedByUserId, 'admin-user-1');
  assert.equal(createdRunPayload.executionContext, 'system');
  assert.equal(createdRunPayload.meta.initiatedByType, 'manual');
  assert.equal(createdCommands[0].initiatedByType, 'manual');
  assert.equal(createdCommands[0].payload.executionContext, 'system');

  running = true;
  createdCommands.length = 0;
  await service.stopScheduler('admin-user-1');
  assert.equal(createdCommands[0].commandType, 'stop_now');
  assert.equal(createdCommands[0].initiatedByType, 'manual');

  createdCommands.length = 0;
  await service.restartScheduler('admin-user-1');
  assert.equal(createdCommands[0].commandType, 'stop_now');
  assert.equal(createdCommands[1].commandType, 'run_now');
  assert.equal(createdCommands[1].initiatedByType, 'manual');

  const runsResponse = await service.listSchedulerRuns('admin-user-1', {
    limit: '10',
    offset: '0',
  });
  assert.equal(runsResponse.data.items[0].initiatedBy?.type, 'manual');
  assert.equal(runsResponse.data.items[0].executionContext, 'system');
  assert.equal(runsResponse.data.items[0].startedAtIso, '2026-04-10T01:00:00.000Z');
  assert.equal(runsResponse.data.items[0].finishedAtIso, '2026-04-10T01:05:00.000Z');
  assert.equal(runsResponse.data.items[0].progress?.currentItem?.id, 'current-1');

  const progressResponse = await service.getSchedulerRunProgress('admin-user-1', 'positions-run-1');
  assert.equal(progressResponse.data.run?.initiatedBy?.userId, 'admin-user-1');
  assert.equal(progressResponse.data.run?.startedAtIso, '2026-04-10T01:00:00.000Z');

  const updatesResponse = await service.listSchedulerRunUpdates('admin-user-1', 'positions-run-1', {
    limit: '25',
    offset: '0',
  });
  assert.equal(updatesResponse.data.items[0].initiatedBy?.type, 'manual');
  assert.equal(updatesResponse.data.items[0].executionContext, 'system');
  assert.equal(updatesResponse.data.items[0].createdAtIso, '2026-04-10T01:02:00.000Z');

  const exportResponse = await service.exportSchedulerRunUpdates('admin-user-1', 'positions-run-1', {});
  assert.equal(exportResponse.data.csv.includes('initiatedByType'), true);
  assert.equal(exportResponse.data.csv.includes('executionContext'), true);
  assert.equal(exportResponse.data.csv.includes('createdAtIso'), true);
  assert.equal(exportResponse.data.csv.includes('admin-user-1'), true);

  const purgePreview = await service.getSchedulerPurgePreview('admin-user-1');
  assert.equal(purgePreview.data.runLogsToDelete, 6);
  assert.equal(purgePreview.data.updateLogsToDelete, 7);
  assert.equal(updatePreviewCalls, 1);

  const purgeResponse = await service.purgeSchedulerLogs('admin-user-1');
  assert.equal(purgeResponse.data.runLogsDeleted, 4);
  assert.equal(purgeResponse.data.updateLogsDeleted, 5);
  assert.equal(updateDeleteCalls, 1);
  assert.equal(
    purgeResponse.data.message,
    'Positions scheduler logs purged. Deleted 4 run logs and 5 update logs.'
  );
}

async function runOrdersRuntimeAssertions(): Promise<void> {
  const service = new OrdersSchedulerService() as any;
  const runDate = new Date('2026-04-10T03:00:00.000Z');
  const finishDate = new Date('2026-04-10T03:04:00.000Z');
  const updateDate = new Date('2026-04-10T03:02:00.000Z');

  const anchorConfig: any = {
    key: 'orders-sync',
    name: 'Orders Sync',
    description: 'Orders reconciliation scheduler.',
    enabled: true,
    cronExpression: '0 1 * * *',
    timezone: 'UTC',
    runAt: '01:00',
    intervalDays: 1,
    batchSize: 200,
    schedulerType: 'user',
    config: {
      sources: ['orders'],
      retentionDays: 30,
      lookbackDays: 90,
    },
  };
  const userConfig: any = {
    schedulerKey: 'orders-sync',
    userId: 'admin-user-1',
    name: 'Orders Sync',
    description: 'Orders reconciliation scheduler.',
    enabled: true,
    cronExpression: '0 1 * * *',
    timezone: 'UTC',
    runAt: '01:00',
    intervalDays: 1,
    batchSize: 200,
    schedulerType: 'user',
    config: {
      sources: ['orders'],
      retentionDays: 30,
      lookbackDays: 90,
    },
    lastStartedAt: runDate,
    lastFinishedAt: finishDate,
    lastStatus: 'Completed',
    lastError: null,
    runningLockUntil: null,
  };

  const sampleRun: any = {
    id: 'orders-run-1',
    schedulerKey: 'orders-sync',
    status: 'Completed',
    startedAt: runDate,
    finishedAt: finishDate,
    durationMs: 240000,
    processedAccounts: 3,
    insertedAssets: 2,
    updatedAssets: 5,
    skippedAssets: 1,
    errorMessage: null,
    initiatedByType: 'manual',
    initiatedByUserId: 'admin-user-1',
    initiatedByLabel: 'admin-user-1',
    executionContext: 'system',
    meta: {
      requestedByUserId: 'admin-user-1',
      progress: {
        total: 3,
        processed: 3,
        percent: 100,
        currentItem: {
          symbol: 'ETHUSDT',
          assetId: 'asset-2',
          id: 'order-1',
        },
      },
    },
  };

  const sampleUpdate: any = {
    id: 'orders-update-1',
    runLogId: 'orders-run-1',
    source: 'orders',
    accountId: 'acct-2',
    connectionId: null,
    actionType: 'updated',
    symbol: 'ETHUSDT',
    externalId: 'order-1',
    assetId: 'asset-2',
    message: 'Order updated',
    detail: {
      reason: 'status changed',
    },
    createdAt: updateDate,
    initiatedByType: null,
    initiatedByUserId: null,
    initiatedByLabel: null,
    executionContext: null,
  };

  let createdRunPayload: any = null;
  const createdCommands: any[] = [];
  let running = false;

  service.userTimeZoneService = {
    async resolveUserTimeZone() {
      return 'Asia/Kolkata';
    },
  };
  service.schedulerConfigRepository = {
    async createIfMissing() {
      return anchorConfig;
    },
    async updateByKey(_key: string, payload: Record<string, unknown>) {
      Object.assign(anchorConfig, payload);
      return anchorConfig;
    },
  };
  service.schedulerUserConfigRepository = {
    async createIfMissing(payload: Record<string, unknown>) {
      assert.equal(payload.schedulerKey, 'orders-sync');
      assert.equal(payload.userId, 'admin-user-1');
      return userConfig;
    },
    async updateBySchedulerKeyAndUserId(
      schedulerKey: string,
      userId: string,
      payload: Record<string, unknown>
    ) {
      assert.equal(schedulerKey, 'orders-sync');
      assert.equal(userId, 'admin-user-1');
      Object.assign(userConfig, payload);
      return userConfig;
    },
  };
  service.schedulerRunLogRepository = {
    async hasRunningRunBySchedulerKeyAndActor(schedulerKey: string, actorUserId: string) {
      assert.equal(schedulerKey, 'orders-sync');
      assert.equal(actorUserId, 'admin-user-1');
      return running;
    },
    async createRun(payload: Record<string, unknown>) {
      createdRunPayload = payload;
      return payload;
    },
    async listRunsBySchedulerKeyAndActor(
      schedulerKey: string,
      actorUserId: string,
      limit: number,
      offset: number
    ) {
      assert.equal(schedulerKey, 'orders-sync');
      assert.equal(actorUserId, 'admin-user-1');
      assert.equal(limit, 10);
      assert.equal(offset, 0);
      return { items: [sampleRun], total: 1 };
    },
    async findByIdAndSchedulerKeyAndActor(
      runId: string,
      schedulerKey: string,
      actorUserId: string
    ) {
      assert.equal(schedulerKey, 'orders-sync');
      assert.equal(actorUserId, 'admin-user-1');
      return runId === 'orders-run-1' ? sampleRun : null;
    },
    async cancelQueuedRunsBySchedulerKeyAndActor(
      schedulerKey: string,
      actorUserId: string
    ) {
      assert.equal(schedulerKey, 'orders-sync');
      assert.equal(actorUserId, 'admin-user-1');
      return 0;
    },
  };
  service.schedulerCommandRepository = {
    async findLatestBySchedulerKeyAndTypeAndActorInStatuses(
      schedulerKey: string,
      commandType: string,
      actorUserId: string
    ) {
      assert.equal(schedulerKey, 'orders-sync');
      assert.equal(commandType, 'run_now');
      assert.equal(actorUserId, 'admin-user-1');
      return null;
    },
    async createCommand(payload: Record<string, unknown>) {
      createdCommands.push(payload);
      return { id: `orders-command-${createdCommands.length}`, ...payload };
    },
    async cancelPendingBySchedulerKeyAndActor(
      schedulerKey: string,
      actorUserId: string
    ) {
      assert.equal(schedulerKey, 'orders-sync');
      assert.equal(actorUserId, 'admin-user-1');
      return 0;
    },
    async cancelPendingBySchedulerKeyAndTypeAndActor(
      schedulerKey: string,
      commandType: string,
      actorUserId: string
    ) {
      assert.equal(schedulerKey, 'orders-sync');
      assert.equal(commandType, 'run_now');
      assert.equal(actorUserId, 'admin-user-1');
      return 0;
    },
  };
  service.exchangeAssetUpdateLogRepository = {
    async listByRunLogId(runLogId: string, limit: number, offset: number) {
      assert.equal(runLogId, 'orders-run-1');
      assert.equal(limit >= 1, true);
      assert.equal(offset, 0);
      return { items: [sampleUpdate], total: 1 };
    },
  };
  service.activityRepository = {
    async createActivityLog() {
      return;
    },
  };
  service.alertRepository = {
    async findRecentOpenAlertBySource() {
      return null;
    },
    async createAlert() {
      return;
    },
  };
  service.schedulerRuntimeSchemaService = {
    async assertOrdersRuntimeSchemaReady() {
      return;
    },
  };

  const configResponse = await service.getSchedulerConfig('admin-user-1');
  assert.equal(configResponse.data.lastStartedAtIso, '2026-04-10T03:00:00.000Z');
  assert.equal(configResponse.data.lastFinishedAtIso, '2026-04-10T03:04:00.000Z');

  await service.runNow('admin-user-1');
  assert.equal(createdRunPayload.initiatedByType, 'manual');
  assert.equal(createdRunPayload.initiatedByUserId, 'admin-user-1');
  assert.equal(createdRunPayload.executionContext, 'system');
  assert.equal(createdRunPayload.meta.requestedByUserId, 'admin-user-1');
  assert.equal(createdCommands[0].initiatedByType, 'manual');
  assert.equal(createdCommands[0].payload.initiatedByType, 'manual');
  assert.equal(createdCommands[0].payload.executionContext, 'system');

  running = true;
  createdCommands.length = 0;
  await service.stopScheduler('admin-user-1');
  assert.equal(createdCommands[0].commandType, 'stop_now');
  assert.equal(createdCommands[0].initiatedByType, 'manual');

  createdCommands.length = 0;
  await service.restartScheduler('admin-user-1');
  assert.equal(createdCommands[0].commandType, 'stop_now');
  assert.equal(createdCommands[1].commandType, 'run_now');
  assert.equal(createdCommands[1].payload.requestedByUserId, 'admin-user-1');
  assert.equal(createdCommands[1].payload.executionContext, 'system');

  const runsResponse = await service.listSchedulerRuns('admin-user-1', {
    limit: '10',
    offset: '0',
  });
  assert.equal(runsResponse.data.items[0].initiatedBy?.type, 'manual');
  assert.equal(runsResponse.data.items[0].executionContext, 'system');
  assert.equal(runsResponse.data.items[0].startedAtIso, '2026-04-10T03:00:00.000Z');
  assert.equal(runsResponse.data.items[0].progress?.currentItem?.id, 'order-1');

  const progressResponse = await service.getSchedulerRunProgress('admin-user-1', 'orders-run-1');
  assert.equal(progressResponse.data.run?.initiatedBy?.userId, 'admin-user-1');
  assert.equal(progressResponse.data.run?.finishedAtIso, '2026-04-10T03:04:00.000Z');

  const updatesResponse = await service.listSchedulerRunUpdates('admin-user-1', 'orders-run-1', {
    limit: '25',
    offset: '0',
  });
  assert.equal(updatesResponse.data.items[0].initiatedBy?.type, 'manual');
  assert.equal(updatesResponse.data.items[0].executionContext, 'system');
  assert.equal(updatesResponse.data.items[0].createdAtIso, '2026-04-10T03:02:00.000Z');

  const exportResponse = await service.exportSchedulerRunUpdates('admin-user-1', 'orders-run-1', {});
  assert.equal(exportResponse.data.csv.includes('initiatedByType'), true);
  assert.equal(exportResponse.data.csv.includes('executionContext'), true);
  assert.equal(exportResponse.data.csv.includes('createdAtIso'), true);
  assert.equal(exportResponse.data.csv.includes('admin-user-1'), true);
}

async function run(): Promise<void> {
  const findings: string[] = [];

  await runPositionsRuntimeAssertions();
  await runOrdersRuntimeAssertions();

  const phaseDoc = read('POSITIONS_ORDERS_SYNC_PHASE5.md');
  for (const marker of [
    '`positions-sync`',
    '`orders-sync`',
    'Manual queue, stop, and restart commands now stamp explicit `initiatedBy` and `executionContext` audit metadata.',
    'Update-log APIs and CSV export now carry inherited scheduler initiator data plus raw UTC `createdAtIso`.',
    '`positions-sync` purge preview and purge execution now include scheduler-scoped update logs instead of hardcoded zero values.',
    'Phase 6 should implement localized display timestamps and consistent user-timezone rendering on top of this stable audit/ops payload.',
  ]) {
    if (!phaseDoc.includes(marker)) {
      findings.push(`POSITIONS_ORDERS_SYNC_PHASE5.md: missing Phase 5 marker ${marker}`);
    }
  }

  const readme = read('README.md');
  if (!readme.includes('POSITIONS_ORDERS_SYNC_PHASE5.md')) {
    findings.push('README.md: missing positions/orders sync Phase 5 baseline link');
  }
  if (!readme.includes('test:positions-orders-sync-phase5')) {
    findings.push('README.md: missing positions/orders sync Phase 5 verification command');
  }

  const packageSource = read('package.json');
  if (!packageSource.includes('"test:positions-orders-sync-phase5"')) {
    findings.push('package.json: missing positions/orders sync Phase 5 test script');
  }
  if (!packageSource.includes('npm run test:positions-orders-sync-phase5')) {
    findings.push('package.json: positions/orders sync Phase 5 guard must stay wired');
  }

  const positionsServiceSource = read('src/api/services/PositionsSchedulerService.ts');
  for (const marker of [
    'buildSystemSchedulerManualAudit',
    'toSchedulerAuditContract',
    'startedAtIso',
    'createdAtIso',
    'lastStartedAtIso',
    'countOlderThanDaysBySchedulerKey',
    'deleteOlderThanDaysBySchedulerKey',
    'private buildManualAudit(',
  ]) {
    if (!positionsServiceSource.includes(marker)) {
      findings.push(`PositionsSchedulerService.ts: missing Phase 5 marker ${marker}`);
    }
  }

  const ordersServiceSource = read('src/api/services/OrdersSchedulerService.ts');
  for (const marker of [
    'buildSystemSchedulerManualAudit',
    'toSchedulerAuditContract',
    'startedAtIso',
    'createdAtIso',
    'lastStartedAtIso',
    'initiatedByType: manualAudit.initiatedByType',
    'private buildManualAudit(',
  ]) {
    if (!ordersServiceSource.includes(marker)) {
      findings.push(`OrdersSchedulerService.ts: missing Phase 5 marker ${marker}`);
    }
  }

  assert.equal(
    findings.length,
    0,
    `Positions/orders sync Phase 5 guard failed:\n${findings.join('\n')}`
  );
  console.log('Positions/orders sync Phase 5 guard passed.');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
