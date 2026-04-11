import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PositionsSchedulerService } from '../src/api/services/PositionsSchedulerService';
import { OrdersSchedulerService } from '../src/api/services/OrdersSchedulerService';
import { coreDataSource } from '../src/database/data-source';
import {
  formatSchedulerDisplayTime,
  formatSchedulerRawIso,
} from '../src/api/utils/schedulerTimeContract';

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

async function runPositionsRuntimeAssertions(): Promise<void> {
  const service = new PositionsSchedulerService() as any;
  const originalQuery = (coreDataSource as any).query;
  const timeZone = 'Asia/Kolkata';
  const runDate = new Date('2026-04-10T04:30:00.000Z');
  const finishDate = new Date('2026-04-10T04:35:00.000Z');
  const updateDate = new Date('2026-04-10T04:31:00.000Z');
  const checkpointDate = new Date('2026-04-10T04:45:00.000Z');
  const retryDate = new Date('2026-04-10T05:00:00.000Z');
  const pendingUpdateDate = new Date('2026-04-10T05:05:00.000Z');
  const latestSnapshotDate = new Date('2026-04-10T05:10:00.000Z');
  const latestReadModelDate = new Date('2026-04-10T05:12:00.000Z');

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
    detail: { reason: 'payload changed' },
    createdAt: updateDate,
    initiatedByType: null,
    initiatedByUserId: null,
    initiatedByLabel: null,
    executionContext: null,
  };

  service.userTimeZoneService = {
    async resolveUserTimeZone() {
      return timeZone;
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
  };
  service.exchangeAssetUpdateLogRepository = {
    async listByRunLogId(runLogId: string, limit: number, offset: number) {
      assert.equal(runLogId, 'positions-run-1');
      assert.equal(limit >= 1, true);
      assert.equal(offset, 0);
      return { items: [sampleUpdate], total: 1 };
    },
  };
  service.loadReadModelCoverageByAccountIds = async (rows: Array<Record<string, unknown>>) => {
    assert.equal(rows.length >= 1, true);
    return new Map([
      [
        'acct-1',
        {
          accountId: 'acct-1',
          snapshotRows: 4,
          readModelRows: 3,
          rowsMissingFromReadModel: 1,
          rowsBehindSnapshot: 1,
          orphanReadModelRows: 0,
          latestSnapshotSeenAt: latestSnapshotDate,
          latestReadModelSeenAt: latestReadModelDate,
        },
      ],
    ]);
  };
  service.loadReadModelCoverageSummaryForConnectedAccounts = async () => ({
    accountsWithSnapshotData: 1,
    accountsWithoutSnapshotData: 0,
    accountsWithReadModel: 1,
    accountsWithoutReadModel: 0,
    accountsWithReadModelDrift: 1,
    snapshotRows: 4,
    readModelRows: 3,
    rowsMissingFromReadModel: 1,
    rowsBehindSnapshot: 1,
    orphanReadModelRows: 0,
    latestSnapshotSeenAt: latestSnapshotDate,
    latestReadModelSeenAt: latestReadModelDate,
  });

  (coreDataSource as any).query = async (sql: string) => {
    const statement = String(sql || '');
    if (statement.includes('LEFT JOIN scheduler_sync_checkpoints scp') && statement.includes('LIMIT ? OFFSET ?')) {
      return [
        {
          accountId: 'acct-1',
          userId: 'user-1',
          brokerKey: 'mudrex',
          checkpointAt: checkpointDate,
          pendingRecords: 2,
          failedRecords: 1,
          resolvedRecords: 6,
          nextRetryAt: retryDate,
          lastPendingUpdateAt: pendingUpdateDate,
        },
      ];
    }
    if (statement.includes('SELECT COUNT(*) AS total') && statement.includes('FROM broker_accounts ba')) {
      return [{ total: 1 }];
    }
    if (statement.includes('accountsWithCheckpoint')) {
      return [
        {
          totalAccounts: 1,
          accountsWithCheckpoint: 1,
          accountsWithoutCheckpoint: 0,
          accountsWithPending: 1,
          accountsWithFailed: 1,
          accountsWithRetryScheduled: 1,
          pendingRecords: 2,
          failedRecords: 1,
          resolvedRecords: 6,
          oldestCheckpointAt: checkpointDate,
          latestCheckpointAt: checkpointDate,
          latestPendingUpdateAt: pendingUpdateDate,
          nextRetryAt: retryDate,
        },
      ];
    }
    throw new Error(`Unexpected SQL in positions/orders sync phase 6 positions test: ${statement}`);
  };

  try {
    const configResponse = await service.getSchedulerConfig('admin-user-1');
    assert.equal(configResponse.data.time?.displayTimeZone, timeZone);
    assert.equal(configResponse.data.lastStartedAt, formatSchedulerDisplayTime(runDate, timeZone));
    assert.equal(configResponse.data.lastStartedAtIso, formatSchedulerRawIso(runDate));
    assert.equal(configResponse.data.lastFinishedAt, formatSchedulerDisplayTime(finishDate, timeZone));

    const runsResponse = await service.listSchedulerRuns('admin-user-1', {
      limit: '10',
      offset: '0',
    });
    assert.equal(runsResponse.data.time?.displayTimeZone, timeZone);
    assert.equal(runsResponse.data.items[0]?.startedAt, formatSchedulerDisplayTime(runDate, timeZone));
    assert.equal(runsResponse.data.items[0]?.startedAtIso, formatSchedulerRawIso(runDate));
    assert.equal(runsResponse.data.items[0]?.finishedAt, formatSchedulerDisplayTime(finishDate, timeZone));

    const progressResponse = await service.getSchedulerRunProgress('admin-user-1', 'positions-run-1');
    assert.equal(progressResponse.data.time?.displayTimeZone, timeZone);
    assert.equal(progressResponse.data.run?.startedAt, formatSchedulerDisplayTime(runDate, timeZone));
    assert.equal(progressResponse.data.run?.finishedAtIso, formatSchedulerRawIso(finishDate));

    const updatesResponse = await service.listSchedulerRunUpdates('admin-user-1', 'positions-run-1', {
      limit: '25',
      offset: '0',
    });
    assert.equal(updatesResponse.data.time?.displayTimeZone, timeZone);
    assert.equal(
      updatesResponse.data.items[0]?.createdAt,
      formatSchedulerDisplayTime(updateDate, timeZone)
    );
    assert.equal(updatesResponse.data.items[0]?.createdAtIso, formatSchedulerRawIso(updateDate));

    const exportResponse = await service.exportSchedulerRunUpdates('admin-user-1', 'positions-run-1', {});
    assert.equal(
      exportResponse.data.csv.includes(formatSchedulerDisplayTime(updateDate, timeZone) || ''),
      true
    );
    assert.equal(exportResponse.data.csv.includes(formatSchedulerRawIso(updateDate) || ''), true);

    const syncStateResponse = await service.listSchedulerSyncState('admin-user-1', {
      limit: '10',
      offset: '0',
    });
    assert.equal(syncStateResponse.data.time?.displayTimeZone, timeZone);
    assert.equal(
      syncStateResponse.data.items[0]?.checkpointAt,
      formatSchedulerDisplayTime(checkpointDate, timeZone)
    );
    assert.equal(
      syncStateResponse.data.items[0]?.latestSnapshotSeenAt,
      formatSchedulerDisplayTime(latestSnapshotDate, timeZone)
    );
    assert.equal(
      syncStateResponse.data.items[0]?.lastPendingUpdateAt,
      formatSchedulerDisplayTime(pendingUpdateDate, timeZone)
    );

    const summaryResponse = await service.getSchedulerSyncStateSummary('admin-user-1');
    assert.equal(summaryResponse.data.time?.displayTimeZone, timeZone);
    assert.equal(
      summaryResponse.data.oldestCheckpointAt,
      formatSchedulerDisplayTime(checkpointDate, timeZone)
    );
    assert.equal(
      summaryResponse.data.latestSnapshotSeenAt,
      formatSchedulerDisplayTime(latestSnapshotDate, timeZone)
    );
    assert.equal(
      summaryResponse.data.nextRetryAt,
      formatSchedulerDisplayTime(retryDate, timeZone)
    );
  } finally {
    (coreDataSource as any).query = originalQuery;
  }
}

async function runOrdersRuntimeAssertions(): Promise<void> {
  const service = new OrdersSchedulerService() as any;
  const timeZone = 'Asia/Kolkata';
  const runDate = new Date('2026-04-10T06:30:00.000Z');
  const finishDate = new Date('2026-04-10T06:34:00.000Z');
  const updateDate = new Date('2026-04-10T06:31:00.000Z');
  const checkpointIso = '2026-04-10T06:45:00.000Z';
  const retryIso = '2026-04-10T07:00:00.000Z';
  const pendingUpdateIso = '2026-04-10T07:05:00.000Z';

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
    detail: { reason: 'status changed' },
    createdAt: updateDate,
    initiatedByType: null,
    initiatedByUserId: null,
    initiatedByLabel: null,
    executionContext: null,
  };

  service.userTimeZoneService = {
    async resolveUserTimeZone() {
      return timeZone;
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
  };
  service.exchangeAssetUpdateLogRepository = {
    async listByRunLogId(runLogId: string, limit: number, offset: number) {
      assert.equal(runLogId, 'orders-run-1');
      assert.equal(limit >= 1, true);
      assert.equal(offset, 0);
      return { items: [sampleUpdate], total: 1 };
    },
  };
  service.schedulerRuntimeSchemaService = {
    async inspectOrdersRuntimeSchema() {
      return {
        status: 'ready',
        migrationName: 'test-migration',
        requiredTables: [],
        requiredColumns: [],
      };
    },
  };
  service.ordersSyncDiagnosticsService = {
    async listSchedulerSyncStateRecords() {
      return {
        items: [
          {
            accountId: 'acct-2',
            userId: 'user-2',
            brokerKey: 'delta_exchange',
            checkpointAt: checkpointIso,
            pendingRecords: 3,
            failedRecords: 1,
            resolvedRecords: 5,
            nextRetryAt: retryIso,
            lastPendingUpdateAt: pendingUpdateIso,
          },
        ],
        total: 1,
      };
    },
    async getSchedulerSyncStateSummaryRecord() {
      return {
        totalAccounts: 1,
        accountsWithCheckpoint: 1,
        accountsWithoutCheckpoint: 0,
        accountsWithPending: 1,
        accountsWithFailed: 1,
        accountsWithRetryScheduled: 1,
        pendingRecords: 3,
        failedRecords: 1,
        resolvedRecords: 5,
        oldestCheckpointAt: checkpointIso,
        latestCheckpointAt: checkpointIso,
        latestPendingUpdateAt: pendingUpdateIso,
        nextRetryAt: retryIso,
      };
    },
  };

  const configResponse = await service.getSchedulerConfig('admin-user-1');
  assert.equal(configResponse.data.time?.displayTimeZone, timeZone);
  assert.equal(configResponse.data.lastStartedAt, formatSchedulerDisplayTime(runDate, timeZone));
  assert.equal(configResponse.data.lastStartedAtIso, formatSchedulerRawIso(runDate));

  const runsResponse = await service.listSchedulerRuns('admin-user-1', {
    limit: '10',
    offset: '0',
  });
  assert.equal(runsResponse.data.time?.displayTimeZone, timeZone);
  assert.equal(runsResponse.data.items[0]?.startedAt, formatSchedulerDisplayTime(runDate, timeZone));
  assert.equal(runsResponse.data.items[0]?.finishedAt, formatSchedulerDisplayTime(finishDate, timeZone));

  const progressResponse = await service.getSchedulerRunProgress('admin-user-1', 'orders-run-1');
  assert.equal(progressResponse.data.time?.displayTimeZone, timeZone);
  assert.equal(progressResponse.data.run?.startedAtIso, formatSchedulerRawIso(runDate));
  assert.equal(progressResponse.data.run?.finishedAt, formatSchedulerDisplayTime(finishDate, timeZone));

  const updatesResponse = await service.listSchedulerRunUpdates('admin-user-1', 'orders-run-1', {
    limit: '25',
    offset: '0',
  });
  assert.equal(updatesResponse.data.time?.displayTimeZone, timeZone);
  assert.equal(
    updatesResponse.data.items[0]?.createdAt,
    formatSchedulerDisplayTime(updateDate, timeZone)
  );
  assert.equal(updatesResponse.data.items[0]?.createdAtIso, formatSchedulerRawIso(updateDate));

  const exportResponse = await service.exportSchedulerRunUpdates('admin-user-1', 'orders-run-1', {});
  assert.equal(
    exportResponse.data.csv.includes(formatSchedulerDisplayTime(updateDate, timeZone) || ''),
    true
  );
  assert.equal(exportResponse.data.csv.includes(formatSchedulerRawIso(updateDate) || ''), true);

  const syncStateResponse = await service.listSchedulerSyncState('admin-user-1', {
    limit: '10',
    offset: '0',
  });
  assert.equal(syncStateResponse.data.time?.displayTimeZone, timeZone);
  assert.equal(
    syncStateResponse.data.items[0]?.checkpointAt,
    formatSchedulerDisplayTime(checkpointIso, timeZone)
  );
  assert.equal(
    syncStateResponse.data.items[0]?.nextRetryAt,
    formatSchedulerDisplayTime(retryIso, timeZone)
  );

  const summaryResponse = await service.getSchedulerSyncStateSummary('admin-user-1');
  assert.equal(summaryResponse.data.time?.displayTimeZone, timeZone);
  assert.equal(
    summaryResponse.data.oldestCheckpointAt,
    formatSchedulerDisplayTime(checkpointIso, timeZone)
  );
  assert.equal(
    summaryResponse.data.latestPendingUpdateAt,
    formatSchedulerDisplayTime(pendingUpdateIso, timeZone)
  );
}

async function run(): Promise<void> {
  const findings: string[] = [];

  await runPositionsRuntimeAssertions();
  await runOrdersRuntimeAssertions();

  const phaseDoc = read('POSITIONS_ORDERS_SYNC_PHASE6.md');
  for (const marker of [
    '`positions-sync`',
    '`orders-sync`',
    'Config responses now expose localized `lastStartedAt` and `lastFinishedAt` values plus response-level `time` metadata.',
    'Run list, run progress, and update-log responses now render display timestamps in the resolved user timezone while keeping the raw UTC `*Iso` companions from Phase 5.',
    'Orders and positions sync-state list or summary responses now expose shared `time` metadata and localize checkpoint or retry or freshness timestamps.',
    'Phase 7 should build on this stable shared timezone contract',
  ]) {
    if (!phaseDoc.includes(marker)) {
      findings.push(`POSITIONS_ORDERS_SYNC_PHASE6.md: missing Phase 6 marker ${marker}`);
    }
  }

  const readme = read('README.md');
  if (!readme.includes('POSITIONS_ORDERS_SYNC_PHASE6.md')) {
    findings.push('README.md: missing positions/orders sync Phase 6 baseline link');
  }
  if (!readme.includes('test:positions-orders-sync-phase6')) {
    findings.push('README.md: missing positions/orders sync Phase 6 verification command');
  }

  const packageSource = read('package.json');
  if (!packageSource.includes('"test:positions-orders-sync-phase6"')) {
    findings.push('package.json: missing positions/orders sync Phase 6 test script');
  }
  if (!packageSource.includes('npm run test:positions-orders-sync-phase6')) {
    findings.push('package.json: positions/orders sync Phase 6 guard must stay wired');
  }

  const contractSource = read('src/api/contracts/Scheduler.ts');
  for (const marker of [
    'export interface SchedulerRecordSyncStateListResponse {',
    'export interface SchedulerRecordSyncSummaryResponse {',
    'time?: SchedulerTimeContract;',
  ]) {
    if (!contractSource.includes(marker)) {
      findings.push(`Scheduler.ts: missing Phase 6 marker ${marker}`);
    }
  }

  const positionsServiceSource = read('src/api/services/PositionsSchedulerService.ts');
  for (const marker of [
    'buildSchedulerTimeContract',
    'formatSchedulerDisplayTime',
    'time: buildSchedulerTimeContract(timeZone)',
    'lastStartedAt: this.formatDisplayDate(config.lastStartedAt, timeZone)',
    'startedAt: this.formatDisplayDate(item.startedAt, timeZone)',
    'createdAt: this.formatDisplayDate(item.createdAt, timeZone)',
    'const checkpointAt =',
    'private async resolveUserTimeZone(',
  ]) {
    if (!positionsServiceSource.includes(marker)) {
      findings.push(`PositionsSchedulerService.ts: missing Phase 6 marker ${marker}`);
    }
  }

  const ordersServiceSource = read('src/api/services/OrdersSchedulerService.ts');
  for (const marker of [
    'buildSchedulerTimeContract',
    'formatSchedulerDisplayTime',
    'time: buildSchedulerTimeContract(timeZone)',
    'lastStartedAt: this.formatDisplayDate(config.lastStartedAt, timeZone)',
    'startedAt: this.formatDisplayDate(item.startedAt, timeZone)',
    'createdAt: this.formatDisplayDate(item.createdAt, timeZone)',
    'checkpointAt:',
    'private async resolveUserTimeZone(',
  ]) {
    if (!ordersServiceSource.includes(marker)) {
      findings.push(`OrdersSchedulerService.ts: missing Phase 6 marker ${marker}`);
    }
  }

  assert.equal(
    findings.length,
    0,
    `Positions/orders sync Phase 6 guard failed:\n${findings.join('\n')}`
  );
  console.log('Positions/orders sync Phase 6 guard passed.');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
