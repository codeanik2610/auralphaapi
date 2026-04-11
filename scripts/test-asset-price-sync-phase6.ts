import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { AssetPriceSchedulerService } from '../src/api/services/AssetPriceSchedulerService';
import {
  formatSchedulerDisplayTime,
  formatSchedulerRawIso,
} from '../src/api/utils/schedulerTimeContract';

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

async function runRuntimeAssertions(): Promise<void> {
  const service = new AssetPriceSchedulerService() as any;

  const timeZone = 'Asia/Kolkata';
  const runDate = new Date('2026-04-10T04:30:00.000Z');
  const finishDate = new Date('2026-04-10T04:31:00.000Z');
  const updateDate = new Date('2026-04-10T04:30:30.000Z');

  const storedConfig: any = {
    key: 'asset-price-sync',
    name: 'Asset Price Sync',
    description:
      'Fetches latest prices for system broker assets from system market sources (Mudrex, Delta Exchange).',
    enabled: true,
    cronExpression: '0 1 * * *',
    timezone: 'Asia/Kolkata',
    runAt: '01:00',
    intervalDays: 1,
    batchSize: 200,
    schedulerType: 'global',
    config: {
      sources: ['mudrex', 'delta_exchange'],
      useSystemConnectionsOnly: true,
      selectionMode: 'custom',
      selectedAssetIds: ['asset-id-a'],
      retentionDays: 30,
      scheduleMode: 'daily',
      intervalMinutes: 5,
      intervalSeconds: 1,
      hourlyMinute: 0,
    },
    lastStartedAt: runDate,
    lastFinishedAt: finishDate,
    lastStatus: 'Completed',
    lastError: null,
    runningLockUntil: null,
  };

  const sampleRun: any = {
    id: 'run-1',
    schedulerKey: 'asset-price-sync',
    status: 'Completed',
    startedAt: runDate,
    finishedAt: finishDate,
    durationMs: 60000,
    processedAccounts: 2,
    insertedAssets: 1,
    updatedAssets: 1,
    skippedAssets: 0,
    errorMessage: null,
    initiatedByType: 'manual',
    initiatedByUserId: 'admin-user-1',
    initiatedByLabel: 'admin-user-1',
    executionContext: 'system',
    meta: {
      scope: {
        assets: ['asset-id-a'],
        assetsCount: 1,
      },
      progress: {
        total: 2,
        processed: 2,
        percent: 100,
        etaSeconds: 0,
        currentItem: {
          assetId: 'asset-id-a',
          symbol: 'BTCUSDT',
        },
      },
    },
  };

  const sampleUpdate: any = {
    id: 'update-1',
    runLogId: 'run-1',
    source: 'mudrex',
    accountId: null,
    connectionId: null,
    actionType: 'updated',
    symbol: 'BTCUSDT',
    externalId: 'BTCUSDT',
    assetId: 'asset-id-a',
    message: 'Refreshed latest price',
    detail: {
      brokerAssetId: 'asset-id-a',
      price: '123.45',
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
  let purgePreviewCalls = 0;
  let purgeDeleteCalls = 0;

  service.userTimeZoneService = {
    async resolveUserTimeZone() {
      return timeZone;
    },
  };

  service.schedulerConfigRepository = {
    async createIfMissing() {
      return storedConfig;
    },
    async updateByKey(key: string, payload: Record<string, unknown>) {
      assert.equal(key, 'asset-price-sync');
      Object.assign(storedConfig, payload);
      if (payload.config && typeof payload.config === 'object') {
        storedConfig.config = payload.config as Record<string, unknown>;
      }
      return storedConfig;
    },
  };

  service.schedulerRunLogRepository = {
    async hasRunningRun() {
      return running;
    },
    async createRun(payload: Record<string, unknown>) {
      createdRunPayload = payload;
      return payload;
    },
    async listRunsBySchedulerKey(key: string, limit: number, offset: number) {
      assert.equal(key, 'asset-price-sync');
      assert.equal(limit, 10);
      assert.equal(offset, 0);
      return { items: [sampleRun], total: 1 };
    },
    async findByIdAndSchedulerKey(runId: string, schedulerKey: string) {
      assert.equal(schedulerKey, 'asset-price-sync');
      return runId === 'run-1' ? sampleRun : null;
    },
    async countOlderThanDays(key: string, retentionDays: number) {
      assert.equal(key, 'asset-price-sync');
      assert.equal(retentionDays, 30);
      return 6;
    },
    async deleteOlderThanDays(key: string, retentionDays: number) {
      assert.equal(key, 'asset-price-sync');
      assert.equal(retentionDays, 30);
      return 4;
    },
  };

  service.schedulerCommandRepository = {
    async findLatestBySchedulerKeyAndTypeInStatuses() {
      return null;
    },
    async createCommand(payload: Record<string, unknown>) {
      createdCommands.push(payload);
      return { id: `command-${createdCommands.length}`, ...payload };
    },
    async cancelPendingBySchedulerKey() {
      return 0;
    },
    async cancelPendingBySchedulerKeyAndType() {
      return 0;
    },
  };

  service.exchangeAssetRepository = {
    async listSystemAssetIdsByIds(ids: string[], sources: string[]) {
      assert.deepEqual(ids, ['asset-id-a']);
      assert.deepEqual(sources, ['mudrex', 'delta_exchange']);
      return ['asset-id-a'];
    },
    async listSystemAssetIdsBySources(sources: string[]) {
      assert.deepEqual(sources, ['mudrex', 'delta_exchange']);
      return ['asset-id-a'];
    },
  };

  service.exchangeAssetUpdateLogRepository = {
    async listByRunLogId(runLogId: string, limit: number, offset: number) {
      assert.equal(runLogId, 'run-1');
      assert.equal(limit >= 1, true);
      assert.equal(offset, 0);
      return { items: [sampleUpdate], total: 1 };
    },
    async countOlderThanDays() {
      throw new Error('Phase 6 must not use unscoped update-log purge preview');
    },
    async deleteOlderThanDays() {
      throw new Error('Phase 6 must not use unscoped update-log purge delete');
    },
    async countOlderThanDaysBySchedulerKey(key: string, retentionDays: number) {
      purgePreviewCalls += 1;
      assert.equal(key, 'asset-price-sync');
      assert.equal(retentionDays, 30);
      return 7;
    },
    async deleteOlderThanDaysBySchedulerKey(key: string, retentionDays: number) {
      purgeDeleteCalls += 1;
      assert.equal(key, 'asset-price-sync');
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
  assert.equal(configResponse.data.time?.displayTimeZone, timeZone);
  assert.equal(
    configResponse.data.lastStartedAt,
    formatSchedulerDisplayTime(storedConfig.lastStartedAt, timeZone)
  );
  assert.equal(
    configResponse.data.lastStartedAtIso,
    formatSchedulerRawIso(storedConfig.lastStartedAt)
  );

  const runNowResponse = await service.runNow('admin-user-1');
  assert.equal(runNowResponse.data.scopeAssetsCount, 1);
  assert.equal(createdRunPayload.initiatedByType, 'manual');
  assert.equal(createdRunPayload.initiatedByUserId, 'admin-user-1');
  assert.equal(createdRunPayload.executionContext, 'system');
  assert.equal(createdRunPayload.meta.initiatedByType, 'manual');
  assert.equal(createdCommands[0].commandType, 'run_now');
  assert.equal(createdCommands[0].initiatedByType, 'manual');
  assert.equal(createdCommands[0].payload.executionContext, 'system');
  assert.deepEqual(createdCommands[0].payload.scope.assets, ['asset-id-a']);

  running = true;
  createdCommands.length = 0;
  const stopResponse = await service.stopScheduler('admin-user-1');
  assert.equal(stopResponse.data.commandIds?.length, 1);
  assert.equal(createdCommands[0].commandType, 'stop_now');
  assert.equal(createdCommands[0].initiatedByType, 'manual');

  createdCommands.length = 0;
  const restartResponse = await service.restartScheduler('admin-user-1');
  assert.equal(restartResponse.data.commandIds?.length, 2);
  assert.equal(createdCommands[0].commandType, 'stop_now');
  assert.equal(createdCommands[1].commandType, 'run_now');
  assert.equal(createdCommands[1].initiatedByType, 'manual');
  assert.deepEqual(createdCommands[1].payload.scope.assets, ['asset-id-a']);

  const runsResponse = await service.listSchedulerRuns('admin-user-1', {
    limit: '10',
    offset: '0',
  });
  assert.equal(runsResponse.data.time?.displayTimeZone, timeZone);
  assert.equal(runsResponse.data.items[0].initiatedBy?.type, 'manual');
  assert.equal(runsResponse.data.items[0].executionContext, 'system');
  assert.equal(
    runsResponse.data.items[0].startedAt,
    formatSchedulerDisplayTime(runDate, timeZone)
  );
  assert.equal(runsResponse.data.items[0].startedAtIso, formatSchedulerRawIso(runDate));
  assert.equal(runsResponse.data.items[0].scopeAssetsCount, 1);
  assert.equal(runsResponse.data.items[0].progress?.currentItem?.assetId, 'asset-id-a');

  const progressResponse = await service.getSchedulerRunProgress('admin-user-1', 'run-1');
  assert.equal(progressResponse.data.time?.displayTimeZone, timeZone);
  assert.equal(progressResponse.data.run?.startedAtIso, formatSchedulerRawIso(runDate));
  assert.equal(progressResponse.data.run?.initiatedBy?.userId, 'admin-user-1');

  const updatesResponse = await service.listSchedulerRunUpdates('admin-user-1', 'run-1', {
    limit: '25',
    offset: '0',
    sortBy: 'createdAt',
    sortOrder: 'desc',
  });
  assert.equal(updatesResponse.data.time?.displayTimeZone, timeZone);
  assert.equal(updatesResponse.data.items[0].initiatedBy?.type, 'manual');
  assert.equal(updatesResponse.data.items[0].executionContext, 'system');
  assert.equal(
    updatesResponse.data.items[0].createdAt,
    formatSchedulerDisplayTime(updateDate, timeZone)
  );
  assert.equal(
    updatesResponse.data.items[0].createdAtIso,
    formatSchedulerRawIso(updateDate)
  );
  assert.deepEqual(updatesResponse.data.items[0].detail, sampleUpdate.detail);

  const missingUpdatesResponse = await service.listSchedulerRunUpdates('admin-user-1', 'missing', {
    limit: '25',
    offset: '0',
  });
  assert.equal(missingUpdatesResponse.data.total, 0);
  assert.deepEqual(missingUpdatesResponse.data.items, []);

  const exportResponse = await service.exportSchedulerRunUpdates('admin-user-1', 'run-1', {});
  assert.equal(exportResponse.data.fileName, 'scheduler-run-run-1-updates.csv');
  assert.equal(exportResponse.data.rowCount, 1);
  assert.equal(exportResponse.data.csv.includes('initiatedByType'), true);
  assert.equal(exportResponse.data.csv.includes('createdAtIso'), true);
  assert.equal(exportResponse.data.csv.includes('admin-user-1'), true);

  const purgePreviewResponse = await service.getSchedulerPurgePreview('admin-user-1');
  assert.equal(purgePreviewResponse.data.runLogsToDelete, 6);
  assert.equal(purgePreviewResponse.data.updateLogsToDelete, 7);
  assert.equal(purgePreviewCalls, 1);

  const purgeResponse = await service.purgeSchedulerLogs('admin-user-1');
  assert.equal(purgeResponse.data.runLogsDeleted, 4);
  assert.equal(purgeResponse.data.updateLogsDeleted, 5);
  assert.equal(purgeDeleteCalls, 1);
  assert.equal(
    purgeResponse.data.message,
    'Asset price scheduler logs purged. Deleted 4 run logs and 5 update logs.'
  );
}

async function run(): Promise<void> {
  const findings: string[] = [];

  await runRuntimeAssertions();

  const phaseDoc = read('ASSET_PRICE_SYNC_PHASE6.md');
  for (const marker of [
    'Phase 6 aligns the dedicated `asset-price-sync` backend operator contract with',
    'config responses expose localized display timestamps plus raw UTC ISO',
    'update logs and CSV export include initiator and execution-context data',
    'restart uses `stop_now` consistently before requeueing a fresh run',
  ]) {
    if (!phaseDoc.includes(marker)) {
      findings.push(`ASSET_PRICE_SYNC_PHASE6.md: missing Phase 6 marker ${marker}`);
    }
  }

  const readme = read('README.md');
  if (!readme.includes('ASSET_PRICE_SYNC_PHASE6.md')) {
    findings.push('README.md: missing asset-price-sync Phase 6 baseline link');
  }
  if (!readme.includes('test:asset-price-sync-phase6')) {
    findings.push('README.md: missing asset-price-sync Phase 6 verification command');
  }

  const packageSource = read('package.json');
  if (!packageSource.includes('"test:asset-price-sync-phase6"')) {
    findings.push('package.json: missing asset-price-sync Phase 6 test script');
  }
  if (!packageSource.includes('npm run test:asset-price-sync-phase6')) {
    findings.push('package.json: asset-price-sync Phase 6 guard must stay wired');
  }

  const serviceSource = read('src/api/services/AssetPriceSchedulerService.ts');
  for (const marker of [
    'buildSchedulerTimeContract',
    'buildSystemSchedulerManualAudit',
    'toSchedulerAuditContract',
    'countOlderThanDaysBySchedulerKey',
    'deleteOlderThanDaysBySchedulerKey',
    "commandType: 'stop_now'",
    'startedAtIso',
    'createdAtIso',
    'lastStartedAtIso',
    'time: buildSchedulerTimeContract(timeZone)',
    'private mapRun(',
    'private buildManualAudit(',
  ]) {
    if (!serviceSource.includes(marker)) {
      findings.push(`AssetPriceSchedulerService.ts: missing Phase 6 marker ${marker}`);
    }
  }

  assert.equal(
    findings.length,
    0,
    `Asset price sync Phase 6 guard failed:\n${findings.join('\n')}`
  );
  console.log('Asset price sync Phase 6 guard passed.');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
