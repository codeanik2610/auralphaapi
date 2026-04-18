import assert from 'node:assert/strict';
import { AssetPriceSchedulerService } from '../src/api/services/AssetPriceSchedulerService';
import { BinanceAssetsSchedulerService } from '../src/api/services/BinanceAssetsSchedulerService';
import { CandlesSchedulerService } from '../src/api/services/CandlesSchedulerService';
import { HealthCheckSchedulerService } from '../src/api/services/HealthCheckSchedulerService';
import { SchedulerOverviewService } from '../src/api/services/SchedulerOverviewService';
import { SchedulerService } from '../src/api/services/SchedulerService';
import { env } from '../src/env';
import { coreDataSource } from '../src/database/data-source';
import { NormalizeGlobalSystemSchedulerOwnership1770710000000 } from '../src/database/migrations/1770710000000-NormalizeGlobalSystemSchedulerOwnership';
import { EnforceGlobalSystemSchedulerScope1770711000000 } from '../src/database/migrations/1770711000000-EnforceGlobalSystemSchedulerScope';
import { AddGlobalSystemSchedulerInitiatorAudit1770712000000 } from '../src/database/migrations/1770712000000-AddGlobalSystemSchedulerInitiatorAudit';

type GlobalSchedulerCase = {
  label: string;
  key: string;
  description: string;
  buildService: () => any;
  needsSystemAssetScope?: boolean;
  supportsPhaseTwoAudit?: boolean;
};

function isHealthSchedulerCase(testCase: GlobalSchedulerCase): boolean {
  return testCase.key === 'system-health-sync';
}

function createConfig(
  key: string,
  description: string,
  configOverrides: Record<string, unknown> = {}
) {
  return {
    key,
    name: `${key} legacy`,
    description: `Legacy ${key} description (${description})`,
    enabled: true,
    cronExpression: '0 1 * * *',
    timezone: 'UTC',
    runAt: '01:00',
    intervalDays: 1,
    batchSize: 200,
    schedulerType: 'user',
    config: {
      sources: ['mudrex', 'delta_exchange'],
      useSystemConnectionsOnly: true,
      retentionDays: 30,
      selectionMode: 'all',
      selectedAssetIds: [],
      ...configOverrides,
    },
    lastStartedAt: null,
    lastFinishedAt: null,
    lastStatus: null,
    lastError: null,
    runningLockUntil: null,
    createdAt: new Date('2026-04-10T00:00:00.000Z'),
    updatedAt: new Date('2026-04-10T00:00:00.000Z'),
  };
}

async function assertGlobalSchedulerBehavior(testCase: GlobalSchedulerCase): Promise<void> {
  const service = testCase.buildService() as any;
  const storedConfig = createConfig(
    testCase.key,
    testCase.description,
    testCase.needsSystemAssetScope
      ? { sources: ['binance'], useSystemConnectionsOnly: true, useSystemAccountsOnly: true }
      : { useSystemConnectionsOnly: true }
  );
  const updateCalls: Array<Record<string, unknown>> = [];
  const createdRunPayloads: Array<Record<string, unknown>> = [];
  const createdCommandPayloads: Array<Record<string, unknown>> = [];
  let globalPendingChecks = 0;
  let actorPendingChecks = 0;
  let globalRunningChecks = 0;
  let actorRunningChecks = 0;

  service.schedulerConfigRepository = {
    async createIfMissing() {
      return storedConfig as any;
    },
    async updateByKey(key: string, payload: Record<string, unknown>) {
      assert.equal(key, testCase.key);
      updateCalls.push(payload);
      Object.assign(storedConfig, payload);
      return storedConfig as any;
    },
  } as any;

  service.schedulerCommandRepository = {
    async findLatestBySchedulerKeyAndTypeInStatuses(
      schedulerKey: string,
      commandType: string,
      statuses: string[]
    ) {
      globalPendingChecks += 1;
      assert.equal(schedulerKey, testCase.key);
      assert.equal(commandType, 'run_now');
      assert.deepEqual(statuses, ['Pending', 'Processing']);
      return null;
    },
    async findLatestBySchedulerKeyAndTypeAndActorInStatuses() {
      actorPendingChecks += 1;
      return null;
    },
    async createCommand(payload: Record<string, unknown>) {
      createdCommandPayloads.push(payload);
      return { id: `${testCase.key}-command`, ...payload };
    },
    async cancelPendingBySchedulerKey() {
      return 0;
    },
    async cancelPendingBySchedulerKeyAndType() {
      return 0;
    },
  } as any;

  service.schedulerRunLogRepository = {
    async hasRunningRun(schedulerKey: string) {
      globalRunningChecks += 1;
      assert.equal(schedulerKey, testCase.key);
      return false;
    },
    async hasRunningRunBySchedulerKeyAndActor() {
      actorRunningChecks += 1;
      return false;
    },
    async createRun(payload: Record<string, unknown>) {
      createdRunPayloads.push(payload);
      return payload;
    },
  } as any;

  service.userTimeZoneService = {
    async resolveUserTimeZone(userId: string) {
      assert.equal(userId, 'admin-user-1');
      return 'UTC';
    },
  } as any;

  if (testCase.needsSystemAssetScope) {
    service.exchangeAssetRepository = {
      async listSystemAssetsDistinctSymbols() {
        return {
          items: [{ id: 'asset-1', symbol: 'BTCUSDT', source: 'binance' }],
          total: 1,
        };
      },
      async listSystemAssetSymbolsByIds() {
        return ['BTCUSDT'];
      },
      async listSystemAssetIdsBySources(sources: string[]) {
        assert.deepEqual(sources, ['mudrex', 'delta_exchange']);
        return ['asset-1'];
      },
      async listSystemAssetIdsByIds(ids: string[], sources: string[]) {
        assert.deepEqual(ids, ['asset-1']);
        assert.deepEqual(sources, ['mudrex', 'delta_exchange']);
        return ['asset-1'];
      },
      async listSystemAssetsForAssetPriceScope() {
        return {
          items: [{ id: 'asset-1', symbol: 'BTCUSDT', source: 'mudrex' }],
          total: 1,
        };
      },
    } as any;
  }

  service.schedulerRuntimeSchemaService = {
    async assertFundsRuntimeSchemaReady() {
      return null;
    },
  } as any;

  service.schedulerUserConfigRepository = {
    async listEnabledBySchedulerKey(schedulerKey: string) {
      assert.equal(schedulerKey, testCase.key);
      return [];
    },
  } as any;

  service.activityRepository = {} as any;
  service.alertRepository = {} as any;
  service.exchangeAssetUpdateLogRepository = {} as any;
  service.logSchedulerActivity = async () => {};
  service.emitSchedulerFailureAlert = async () => {};

  const configResponse = await service.getSchedulerConfig('admin-user-1');
  assert.equal(configResponse.data.schedulerType, 'global');
  assert.equal(storedConfig.schedulerType, 'global');
  assert.equal(storedConfig.description, testCase.description);
  assert.ok(
    updateCalls.some(
      (payload) => String(payload.schedulerType || '').trim().toLowerCase() === 'global'
    ),
    `${testCase.label} should normalize legacy ownership back to global`
  );

  await assert.rejects(
    () =>
      service.updateSchedulerConfig('admin-user-1', {
        schedulerType: 'user',
      } as any),
    /cannot be switched to user scope/
  );
  if (testCase.key === 'asset-price-sync') {
    await assert.rejects(
      () =>
        service.updateSchedulerConfig('admin-user-1', {
          sources: ['binance'],
        } as any),
      /must only include "mudrex" or "delta_exchange"/
    );
    await assert.rejects(
      () =>
        service.runNow('admin-user-1', {
          sources: ['binance'],
        } as any),
      /must only include "mudrex" or "delta_exchange"/
    );
  }

  const runResponse = await service.runNow('admin-user-1');
  assert.equal(runResponse.data.queued, true);
  assert.equal(globalPendingChecks, 1);
  assert.equal(actorPendingChecks, 0);
  assert.equal(globalRunningChecks, 1);
  assert.equal(actorRunningChecks, 0);

  const createdRun = createdRunPayloads[0] || {};
  const createdRunMeta =
    createdRun.meta && typeof createdRun.meta === 'object' && !Array.isArray(createdRun.meta)
      ? (createdRun.meta as Record<string, unknown>)
      : {};
  assert.equal(createdRun.actorUserId, undefined);
  assert.equal(createdRunMeta.actorUserId, undefined);
  if (testCase.supportsPhaseTwoAudit !== false) {
    assert.equal(createdRun.initiatedByType, 'manual');
    assert.equal(createdRun.initiatedByUserId, 'admin-user-1');
    assert.equal(createdRun.initiatedByLabel, 'admin-user-1');
    assert.equal(createdRun.executionContext, 'system');
    assert.equal(createdRunMeta.initiatedByType, 'manual');
    assert.equal(createdRunMeta.initiatedByUserId, 'admin-user-1');
    assert.equal(createdRunMeta.initiatedByLabel, 'admin-user-1');
    assert.equal(createdRunMeta.executionContext, 'system');
  }

  const createdCommand = createdCommandPayloads[0] || {};
  const createdCommandBody =
    createdCommand.payload &&
    typeof createdCommand.payload === 'object' &&
    !Array.isArray(createdCommand.payload)
      ? (createdCommand.payload as Record<string, unknown>)
      : {};
  assert.equal(createdCommand.actorUserId, undefined);
  assert.equal(createdCommandBody.actorUserId, undefined);
  if (testCase.supportsPhaseTwoAudit !== false) {
    assert.equal(createdCommand.initiatedByType, 'manual');
    assert.equal(createdCommand.initiatedByUserId, 'admin-user-1');
    assert.equal(createdCommand.initiatedByLabel, 'admin-user-1');
    assert.equal(createdCommand.executionContext, 'system');
    assert.equal(createdCommandBody.initiatedByType, 'manual');
    assert.equal(createdCommandBody.initiatedByUserId, 'admin-user-1');
    assert.equal(createdCommandBody.initiatedByLabel, 'admin-user-1');
    assert.equal(createdCommandBody.executionContext, 'system');
  }
  if (testCase.key === 'asset-price-sync') {
    const createdScope =
      createdCommandBody.scope &&
      typeof createdCommandBody.scope === 'object' &&
      !Array.isArray(createdCommandBody.scope)
        ? (createdCommandBody.scope as Record<string, unknown>)
        : {};
    assert.deepEqual(createdScope.assets, ['asset-1']);
  }
}

async function assertPhaseThreeLocalizedTimeContract(
  testCase: GlobalSchedulerCase
): Promise<void> {
  const service = testCase.buildService() as any;
  const run = {
    id: `${testCase.key}-run-1`,
    schedulerKey: testCase.key,
    status: 'Completed',
    startedAt: new Date('2026-04-10T01:00:00.000Z'),
    finishedAt: new Date('2026-04-10T01:05:00.000Z'),
    durationMs: 300000,
    processedAccounts: 1,
    insertedAssets: 3,
    updatedAssets: 2,
    skippedAssets: 1,
    errorMessage: null,
    initiatedByType: 'manual',
    initiatedByUserId: 'admin-user-1',
    initiatedByLabel: 'admin-user-1',
    executionContext: 'system',
    meta: {
      initiatedByType: 'manual',
      initiatedByUserId: 'admin-user-1',
      initiatedByLabel: 'admin-user-1',
      executionContext: 'system',
      progress: {
        total: 6,
        processed: 6,
        percent: 100,
      },
    },
  };

  service.userTimeZoneService = {
    async resolveUserTimeZone(userId: string) {
      assert.equal(userId, 'admin-user-1');
      return 'Asia/Kolkata';
    },
  } as any;

  service.schedulerRunLogRepository = {
    async listRunsBySchedulerKey(schedulerKey: string) {
      assert.equal(schedulerKey, testCase.key);
      return { items: [run], total: 1 };
    },
    async findByIdAndSchedulerKey(runId: string, schedulerKey: string) {
      assert.equal(runId, `${testCase.key}-run-1`);
      assert.equal(schedulerKey, testCase.key);
      return run;
    },
  } as any;

  service.schedulerHealthCheckResultRepository = {
    async hasResultsForRunLogId(runLogId: string) {
      assert.equal(runLogId, `${testCase.key}-run-1`);
      return isHealthSchedulerCase(testCase);
    },
    async listByRunLogId(runLogId: string) {
      assert.equal(runLogId, `${testCase.key}-run-1`);
      if (!isHealthSchedulerCase(testCase)) {
        return { items: [], total: 0 };
      }
      return {
        items: [
          {
            id: `${testCase.key}-health-1`,
            runLogId,
            checkId: 'binance-exchange-health',
            checkLabel: 'Binance exchange health',
            status: 'passed',
            detail: 'ok',
            createdAt: new Date('2026-04-10T01:02:00.000Z'),
          },
        ],
        total: 1,
      };
    },
    async countOlderThanDays() {
      return 0;
    },
    async deleteOlderThanDays() {
      return 0;
    },
  } as any;

  service.exchangeAssetUpdateLogRepository = {
    async listByRunLogId(runLogId: string) {
      assert.equal(runLogId, `${testCase.key}-run-1`);
      return {
        items: [
          {
            id: `${testCase.key}-update-1`,
            runLogId,
            source: 'system',
            accountId: null,
            connectionId: null,
            actionType: 'updated',
            symbol: 'BTCUSDT',
            externalId: 'btc',
            assetId: 'asset-1',
            message: 'Updated asset',
            initiatedByType: null,
            initiatedByUserId: null,
            initiatedByLabel: null,
            executionContext: null,
            createdAt: new Date('2026-04-10T01:02:00.000Z'),
          },
        ],
        total: 1,
      };
    },
  } as any;

  const runsResponse = await service.listSchedulerRuns('admin-user-1', {});
  assert.equal(runsResponse.data.time?.displayTimeZone, 'Asia/Kolkata');
  assert.equal(runsResponse.data.time?.storageTimeZone, 'UTC');
  assert.equal(runsResponse.data.time?.rawTimeFields, 'iso-utc');
  assert.equal(runsResponse.data.time?.displayTimesLocalized, true);
  assert.equal(runsResponse.data.items[0]?.startedAt, '2026-04-10T06:30:00.000+05:30');
  assert.equal(runsResponse.data.items[0]?.finishedAt, '2026-04-10T06:35:00.000+05:30');
  assert.equal(runsResponse.data.items[0]?.startedAtIso, '2026-04-10T01:00:00.000Z');
  assert.equal(runsResponse.data.items[0]?.finishedAtIso, '2026-04-10T01:05:00.000Z');
  if (isHealthSchedulerCase(testCase)) {
    assert.deepEqual(runsResponse.data.items[0]?.healthCheckCounts, {
      checked: 1,
      passed: 3,
      failed: 2,
      skipped: 1,
    });
  }

  const progressResponse = await service.getSchedulerRunProgress(
    'admin-user-1',
    `${testCase.key}-run-1`
  );
  assert.equal(progressResponse.data.time?.displayTimeZone, 'Asia/Kolkata');
  assert.equal(progressResponse.data.time?.displayTimesLocalized, true);
  assert.equal(progressResponse.data.run?.startedAt, '2026-04-10T06:30:00.000+05:30');
  assert.equal(progressResponse.data.run?.finishedAt, '2026-04-10T06:35:00.000+05:30');
  assert.equal(progressResponse.data.run?.startedAtIso, '2026-04-10T01:00:00.000Z');
  assert.equal(progressResponse.data.run?.finishedAtIso, '2026-04-10T01:05:00.000Z');
  if (isHealthSchedulerCase(testCase)) {
    assert.deepEqual(progressResponse.data.run?.healthCheckCounts, {
      checked: 1,
      passed: 3,
      failed: 2,
      skipped: 1,
    });
  }

  const updatesResponse = await service.listSchedulerRunUpdates(
    'admin-user-1',
    `${testCase.key}-run-1`,
    {}
  );
  assert.equal(updatesResponse.data.time?.displayTimeZone, 'Asia/Kolkata');
  assert.equal(updatesResponse.data.time?.displayTimesLocalized, true);
  assert.equal(updatesResponse.data.items[0]?.createdAt, '2026-04-10T06:32:00.000+05:30');
  assert.equal(updatesResponse.data.items[0]?.createdAtIso, '2026-04-10T01:02:00.000Z');
  if (isHealthSchedulerCase(testCase)) {
    assert.equal(updatesResponse.data.items[0]?.source, 'health');
    assert.equal(updatesResponse.data.items[0]?.actionType, 'passed');
    assert.equal(updatesResponse.data.items[0]?.symbol, 'binance-exchange-health');
  }

  const exportResponse = await service.exportSchedulerRunUpdates(
    'admin-user-1',
    `${testCase.key}-run-1`,
    {}
  );
  assert.ok(exportResponse.data.csv.includes('"createdAt","createdAtIso"'));
  assert.ok(
    exportResponse.data.csv.includes(
      '"2026-04-10T06:32:00.000+05:30","2026-04-10T01:02:00.000Z"'
    )
  );
}

async function assertPhaseTwoAuditContract(testCase: GlobalSchedulerCase): Promise<void> {
  if (testCase.supportsPhaseTwoAudit === false) {
    return;
  }

  const service = testCase.buildService() as any;
  const run = {
    id: `${testCase.key}-run-2`,
    schedulerKey: testCase.key,
    status: 'Completed',
    startedAt: new Date('2026-04-10T01:00:00.000Z'),
    finishedAt: new Date('2026-04-10T01:05:00.000Z'),
    durationMs: 300000,
    processedAccounts: 1,
    insertedAssets: 3,
    updatedAssets: 2,
    skippedAssets: 1,
    errorMessage: null,
    initiatedByType: 'manual',
    initiatedByUserId: 'admin-user-1',
    initiatedByLabel: 'admin-user-1',
    executionContext: 'system',
    meta: {
      trigger: 'manual',
      initiatedByType: 'manual',
      initiatedByUserId: 'admin-user-1',
      initiatedByLabel: 'admin-user-1',
      executionContext: 'system',
      progress: {
        total: 6,
        processed: 6,
        percent: 100,
      },
    },
  };

  service.userTimeZoneService = {
    async resolveUserTimeZone(userId: string) {
      assert.equal(userId, 'admin-user-1');
      return 'UTC';
    },
  } as any;

  service.schedulerRunLogRepository = {
    async listRunsBySchedulerKey(schedulerKey: string) {
      assert.equal(schedulerKey, testCase.key);
      return { items: [run], total: 1 };
    },
    async findByIdAndSchedulerKey(runId: string, schedulerKey: string) {
      assert.equal(runId, `${testCase.key}-run-2`);
      assert.equal(schedulerKey, testCase.key);
      return run;
    },
  } as any;

  service.schedulerHealthCheckResultRepository = {
    async hasResultsForRunLogId(runLogId: string) {
      assert.equal(runLogId, `${testCase.key}-run-2`);
      return isHealthSchedulerCase(testCase);
    },
    async listByRunLogId(runLogId: string) {
      assert.equal(runLogId, `${testCase.key}-run-2`);
      if (!isHealthSchedulerCase(testCase)) {
        return { items: [], total: 0 };
      }
      return {
        items: [
          {
            id: `${testCase.key}-health-2`,
            runLogId,
            checkId: 'auralpha-health',
            checkLabel: 'aurAlpha API health',
            status: 'passed',
            detail: 'ok',
            createdAt: new Date('2026-04-10T01:02:00.000Z'),
          },
        ],
        total: 1,
      };
    },
    async countOlderThanDays() {
      return 0;
    },
    async deleteOlderThanDays() {
      return 0;
    },
  } as any;

  service.exchangeAssetUpdateLogRepository = {
    async listByRunLogId(runLogId: string) {
      assert.equal(runLogId, `${testCase.key}-run-2`);
      return {
        items: [
          {
            id: `${testCase.key}-update-2`,
            runLogId,
            source: 'system',
            accountId: null,
            connectionId: null,
            actionType: 'updated',
            symbol: 'BTCUSDT',
            externalId: 'btc',
            assetId: 'asset-1',
            message: 'Updated asset',
            createdAt: new Date('2026-04-10T01:02:00.000Z'),
            initiatedByType: null,
            initiatedByUserId: null,
            initiatedByLabel: null,
            executionContext: null,
          },
        ],
        total: 1,
      };
    },
  } as any;

  const runsResponse = await service.listSchedulerRuns('admin-user-1', {});
  assert.equal(runsResponse.data.items[0]?.initiatedBy?.type, 'manual');
  assert.equal(runsResponse.data.items[0]?.initiatedBy?.userId, 'admin-user-1');
  assert.equal(runsResponse.data.items[0]?.initiatedBy?.label, 'admin-user-1');
  assert.equal(runsResponse.data.items[0]?.executionContext, 'system');

  const progressResponse = await service.getSchedulerRunProgress(
    'admin-user-1',
    `${testCase.key}-run-2`
  );
  assert.equal(progressResponse.data.run?.initiatedBy?.type, 'manual');
  assert.equal(progressResponse.data.run?.initiatedBy?.userId, 'admin-user-1');
  assert.equal(progressResponse.data.run?.initiatedBy?.label, 'admin-user-1');
  assert.equal(progressResponse.data.run?.executionContext, 'system');

  const updatesResponse = await service.listSchedulerRunUpdates(
    'admin-user-1',
    `${testCase.key}-run-2`,
    {}
  );
  assert.equal(updatesResponse.data.items[0]?.initiatedBy?.type, 'manual');
  assert.equal(updatesResponse.data.items[0]?.initiatedBy?.userId, 'admin-user-1');
  assert.equal(updatesResponse.data.items[0]?.initiatedBy?.label, 'admin-user-1');
  assert.equal(updatesResponse.data.items[0]?.executionContext, 'system');

  const exportResponse = await service.exportSchedulerRunUpdates(
    'admin-user-1',
    `${testCase.key}-run-2`,
    {}
  );
  assert.ok(
    exportResponse.data.csv.includes('"initiatedByType","initiatedByUserId","initiatedByLabel","executionContext"')
  );
  assert.ok(exportResponse.data.csv.includes('"manual","admin-user-1","admin-user-1","system"'));
}

async function assertPhaseFourRetentionContract(testCase: GlobalSchedulerCase): Promise<void> {
  const service = testCase.buildService() as any;
  const config = {
    ...createConfig(testCase.key, testCase.description),
    description: testCase.description,
    schedulerType: 'global',
    config: {
      sources:
        testCase.key === 'broker-assets-sync'
          ? ['mudrex', 'delta_exchange']
          : testCase.key === 'exchange-assets-sync'
            ? ['binance-futures']
            : testCase.key === 'binance-candles-3m-1m-sync'
              ? ['binance']
              : ['health'],
      retentionDays: 45,
      useSystemConnectionsOnly: true,
      ...(
        testCase.needsSystemAssetScope || testCase.key === 'broker-assets-sync'
          ? { useSystemAccountsOnly: true }
          : {}
      ),
    },
  };
  const activityCalls: Array<Record<string, unknown>> = [];
  const callOrder: string[] = [];
  let genericCountCalls = 0;
  let genericDeleteCalls = 0;
  let dedicatedCountCalls = 0;
  let dedicatedDeleteCalls = 0;

  service.userTimeZoneService = {
    async resolveUserTimeZone(userId: string) {
      assert.equal(userId, 'admin-user-1');
      return 'UTC';
    },
  } as any;

  service.schedulerConfigRepository = {
    async createIfMissing() {
      return config;
    },
    async updateByKey(_key: string, payload: Record<string, unknown>) {
      Object.assign(config, payload);
      return config;
    },
  } as any;

  service.schedulerRunLogRepository = {
    async countOlderThanDays(schedulerKey: string, retentionDays: number) {
      assert.equal(schedulerKey, testCase.key);
      assert.equal(retentionDays, 45);
      return 5;
    },
    async deleteOlderThanDays(schedulerKey: string, retentionDays: number) {
      callOrder.push('run');
      assert.equal(schedulerKey, testCase.key);
      assert.equal(retentionDays, 45);
      return 4;
    },
  } as any;

  service.exchangeAssetUpdateLogRepository = {
    async countOlderThanDays() {
      genericCountCalls += 1;
      return 999;
    },
    async countOlderThanDaysBySchedulerKey(schedulerKey: string, retentionDays: number) {
      assert.equal(schedulerKey, testCase.key);
      assert.equal(retentionDays, 45);
      return 8;
    },
    async deleteOlderThanDays() {
      genericDeleteCalls += 1;
      return 999;
    },
    async deleteOlderThanDaysBySchedulerKey(schedulerKey: string, retentionDays: number) {
      callOrder.push('update');
      assert.equal(schedulerKey, testCase.key);
      assert.equal(retentionDays, 45);
      return 7;
    },
  } as any;

  service.schedulerHealthCheckResultRepository = {
    async countOlderThanDays(retentionDays: number) {
      dedicatedCountCalls += 1;
      assert.equal(retentionDays, 45);
      return isHealthSchedulerCase(testCase) ? 2 : 0;
    },
    async deleteOlderThanDays(retentionDays: number) {
      dedicatedDeleteCalls += 1;
      assert.equal(retentionDays, 45);
      callOrder.push('health');
      return isHealthSchedulerCase(testCase) ? 3 : 0;
    },
  } as any;

  service.activityRepository = {
    async createActivityLog(payload: Record<string, unknown>) {
      activityCalls.push(payload);
      return null;
    },
  } as any;

  service.schedulerUserConfigRepository = {
    async listEnabledBySchedulerKey(schedulerKey: string) {
      assert.equal(schedulerKey, testCase.key);
      return [];
    },
  } as any;

  const previewResponse = await service.getSchedulerPurgePreview('admin-user-1');
  assert.deepEqual(previewResponse.data, {
    retentionDays: 45,
    runLogsToDelete: 5,
    updateLogsToDelete: isHealthSchedulerCase(testCase) ? 10 : 8,
  });
  assert.equal(genericCountCalls, 0);
  assert.equal(dedicatedCountCalls, isHealthSchedulerCase(testCase) ? 1 : 0);

  const purgeResponse = await service.purgeSchedulerLogs('admin-user-1');
  assert.equal(purgeResponse.data.retentionDays, 45);
  assert.equal(purgeResponse.data.runLogsDeleted, 4);
  assert.equal(purgeResponse.data.updateLogsDeleted, isHealthSchedulerCase(testCase) ? 10 : 7);
  assert.deepEqual(callOrder, isHealthSchedulerCase(testCase) ? ['update', 'health', 'run'] : ['update', 'run']);
  assert.equal(genericDeleteCalls, 0);
  assert.equal(dedicatedDeleteCalls, isHealthSchedulerCase(testCase) ? 1 : 0);
  assert.equal(activityCalls.length, 1);
  assert.equal(activityCalls[0].status, 'Success');
  assert.match(
    String(activityCalls[0].description || ''),
    isHealthSchedulerCase(testCase)
      ? /4 run logs and 10 health detail rows/
      : /4 run logs and 7 update logs/
  );
}

async function testSchedulerOverviewKeepsSystemGlobalsGlobal(): Promise<void> {
  const service = new SchedulerOverviewService() as any;
  const originalQuery = (coreDataSource as any).query;

  service.userTimeZoneService = {
    async resolveUserTimeZone(userId: string) {
      assert.equal(userId, 'admin-user-9');
      return 'UTC';
    },
  } as any;

  (coreDataSource as any).query = async (sql: string, params: unknown[] = []) => {
    if (sql.includes('FROM scheduler_configs')) {
      return [
        {
          key: 'broker-assets-sync',
          name: 'Broker Assets Daily Sync',
          enabled: 1,
          last_finished_at: '2026-04-10T01:00:00.000Z',
          last_status: 'Completed',
          last_error: null,
          scheduler_type: 'user',
        },
        {
          key: 'exchange-assets-sync',
          name: 'Exchange Assets Sync',
          enabled: 1,
          last_finished_at: '2026-04-10T01:00:00.000Z',
          last_status: 'Completed',
          last_error: null,
          scheduler_type: 'user',
        },
        {
          key: 'binance-candles-3m-1m-sync',
          name: 'OHLCV Data Sync',
          enabled: 1,
          last_finished_at: '2026-04-10T01:00:00.000Z',
          last_status: 'Completed',
          last_error: null,
          scheduler_type: 'user',
        },
        {
          key: 'system-health-sync',
          name: 'System Health Sync',
          enabled: 1,
          last_finished_at: '2026-04-10T01:00:00.000Z',
          last_status: 'Completed',
          last_error: null,
          scheduler_type: 'user',
        },
        {
          key: 'asset-price-sync',
          name: 'Asset Price Sync',
          enabled: 1,
          last_finished_at: '2026-04-10T01:00:00.000Z',
          last_status: 'Completed',
          last_error: null,
          scheduler_type: 'user',
        },
      ];
    }

    if (sql.includes('FROM scheduler_user_configs')) {
      assert.deepEqual(params, ['admin-user-9']);
      return [
        {
          key: 'broker-assets-sync',
          name: 'Broker Assets Personal',
          enabled: 0,
          last_finished_at: '2026-04-09T01:00:00.000Z',
          last_status: 'Failed',
          last_error: 'Should not override',
          scheduler_type: 'user',
        },
        {
          key: 'asset-price-sync',
          name: 'Asset Price Personal',
          enabled: 0,
          last_finished_at: '2026-04-09T01:00:00.000Z',
          last_status: 'Failed',
          last_error: 'Should not override',
          scheduler_type: 'user',
        },
      ];
    }

    if (sql.includes('FROM scheduler_run_logs') && sql.includes('WHERE actor_user_id IS NULL')) {
      return [
        {
          id: 'broker-assets-sync-run-1',
          schedulerKey: 'broker-assets-sync',
          status: 'Completed',
          startedAt: '2026-04-10T00:55:00.000Z',
          finishedAt: '2026-04-10T01:00:00.000Z',
          errorMessage: null,
          meta: JSON.stringify({
            initiatedByType: 'cron',
            initiatedByLabel: 'System cron',
            executionContext: 'system',
          }),
          initiatedByType: 'cron',
          initiatedByUserId: null,
          initiatedByLabel: 'System cron',
          executionContext: 'system',
        },
      ];
    }

    if (sql.includes('FROM scheduler_run_logs') && sql.includes('WHERE actor_user_id = ?')) {
      assert.deepEqual(params, ['admin-user-9']);
      return [];
    }

    if (sql.includes('FROM scheduler_commands') && sql.includes('WHERE command_type = \'run_now\'')) {
      return [];
    }

    return [];
  };

  try {
    const response = await service.getOverview('admin-user-9');
    assert.equal(response.data.time?.displayTimeZone, 'UTC');
    assert.equal(response.data.time?.storageTimeZone, 'UTC');
    assert.equal(response.data.time?.rawTimeFields, 'iso-utc');
    assert.equal(response.data.time?.displayTimesLocalized, true);
    const indexed = new Map(response.data.items.map((item: any) => [item.key, item]));
    for (const [key, expectedName] of [
      ['broker-assets-sync', 'Broker Assets Daily Sync'],
      ['exchange-assets-sync', 'Exchange Assets Sync'],
      ['binance-candles-3m-1m-sync', 'OHLCV Data Sync'],
      ['system-health-sync', 'System Health Sync'],
      ['asset-price-sync', 'Asset Price Sync'],
    ]) {
      const item = indexed.get(key) as
        | {
            name?: string;
            enabled?: boolean;
            lastStatus?: string;
            lastFinishedAt?: string;
            lastFinishedAtIso?: string;
            initiatedBy?: {
              type?: string;
              label?: string;
            };
            executionContext?: string;
          }
        | undefined;
      assert.ok(item, `${key} should remain visible in scheduler overview`);
      assert.equal(item.name, expectedName);
      assert.equal(item.enabled, true);
      assert.equal(item.lastStatus, 'Completed');
      assert.equal(item.lastFinishedAt, '2026-04-10T01:00:00.000+00:00');
      assert.equal(item.lastFinishedAtIso, '2026-04-10T01:00:00.000Z');
    }
    const brokerAssetsItem = indexed.get('broker-assets-sync') as
      | {
          initiatedBy?: {
            type?: string;
            label?: string;
          };
          executionContext?: string;
        }
      | undefined;
    assert.equal(brokerAssetsItem?.initiatedBy?.type, 'cron');
    assert.equal(brokerAssetsItem?.initiatedBy?.label, 'System cron');
    assert.equal(brokerAssetsItem?.executionContext, 'system');
  } finally {
    (coreDataSource as any).query = originalQuery;
  }
}

async function testSchedulerOverviewDoesNotTreatPositionsAndOrdersAsSystemGlobals(): Promise<void> {
  const service = new SchedulerOverviewService() as any;
  const originalQuery = (coreDataSource as any).query;

  service.userTimeZoneService = {
    async resolveUserTimeZone(userId: string) {
      assert.equal(userId, 'admin-user-11');
      return 'UTC';
    },
  } as any;

  (coreDataSource as any).query = async (sql: string, params: unknown[] = []) => {
    if (sql.includes('FROM scheduler_configs')) {
      return [
        {
          key: 'positions-sync',
          name: 'Positions Sync',
          enabled: 1,
          last_finished_at: '2026-04-10T01:00:00.000Z',
          last_status: 'Completed',
          last_error: null,
          scheduler_type: 'global',
        },
        {
          key: 'orders-sync',
          name: 'Orders Sync',
          enabled: 1,
          last_finished_at: '2026-04-10T01:00:00.000Z',
          last_status: 'Completed',
          last_error: null,
          scheduler_type: 'global',
        },
      ];
    }

    if (sql.includes('FROM scheduler_user_configs')) {
      assert.deepEqual(params, ['admin-user-11']);
      return [
        {
          key: 'positions-sync',
          name: 'Positions Sync Personal',
          enabled: 0,
          last_finished_at: '2026-04-09T01:00:00.000Z',
          last_status: 'Failed',
          last_error: 'User-specific positions state',
          scheduler_type: 'user',
        },
        {
          key: 'orders-sync',
          name: 'Orders Sync Personal',
          enabled: 0,
          last_finished_at: '2026-04-09T01:05:00.000Z',
          last_status: 'Cancelled',
          last_error: 'User-specific orders state',
          scheduler_type: 'user',
        },
      ];
    }

    if (sql.includes('FROM scheduler_run_logs')) {
      return [];
    }

    if (sql.includes('FROM scheduler_commands')) {
      return [];
    }

    return [];
  };

  try {
    const response = await service.getOverview('admin-user-11');
    const indexed = new Map<string, any>(
      response.data.items.map((item: any) => [item.key, item])
    );
    const positionsItem = indexed.get('positions-sync');
    const ordersItem = indexed.get('orders-sync');

    assert.ok(positionsItem, 'positions-sync should remain visible in scheduler overview');
    assert.equal(positionsItem?.name, 'Positions Sync Personal');
    assert.equal(positionsItem?.enabled, false);
    assert.equal(positionsItem?.lastStatus, 'Failed');

    assert.ok(ordersItem, 'orders-sync should remain visible in scheduler overview');
    assert.equal(ordersItem?.name, 'Orders Sync Personal');
    assert.equal(ordersItem?.enabled, false);
    assert.equal(ordersItem?.lastStatus, 'Cancelled');
  } finally {
    (coreDataSource as any).query = originalQuery;
  }
}

async function testSchedulerOverviewPhaseFiveSnapshots(): Promise<void> {
  const service = new SchedulerOverviewService() as any;
  const originalQuery = (coreDataSource as any).query;

  service.userTimeZoneService = {
    async resolveUserTimeZone(userId: string) {
      assert.equal(userId, 'admin-user-5');
      return 'Asia/Kolkata';
    },
  } as any;

  const brokerRunningRow = {
    id: 'broker-run-2',
    schedulerKey: 'broker-assets-sync',
    status: 'Running',
    startedAt: '2026-04-10T01:05:00.000Z',
    finishedAt: null,
    durationMs: 900000,
    processedAccounts: 12,
    insertedAssets: 7,
    updatedAssets: 3,
    skippedAssets: 2,
    errorMessage: null,
    meta: JSON.stringify({
      initiatedByType: 'manual',
      initiatedByUserId: 'admin-user-5',
      initiatedByLabel: 'admin-user-5',
      executionContext: 'system',
      progress: {
        total: 20,
        processed: 8,
        percent: 40,
        etaSeconds: 180,
        currentItem: {
          symbol: 'BTCUSDT',
          assetId: 'asset-1',
        },
      },
    }),
    initiatedByType: 'manual',
    initiatedByUserId: 'admin-user-5',
    initiatedByLabel: 'admin-user-5',
    executionContext: 'system',
  };

  (coreDataSource as any).query = async (sql: string, params: unknown[] = []) => {
    if (sql.includes('FROM scheduler_configs')) {
      return [
        {
          key: 'broker-assets-sync',
          name: 'Broker Assets Daily Sync',
          enabled: 1,
          last_finished_at: '2026-04-10T01:00:00.000Z',
          last_status: 'Completed',
          last_error: null,
          scheduler_type: 'global',
        },
        {
          key: 'exchange-assets-sync',
          name: 'Exchange Assets Sync',
          enabled: 1,
          last_finished_at: '2026-04-10T01:15:00.000Z',
          last_status: 'Completed',
          last_error: null,
          scheduler_type: 'global',
        },
        {
          key: 'binance-candles-3m-1m-sync',
          name: 'OHLCV Data Sync',
          enabled: 1,
          last_finished_at: '2026-04-10T02:10:00.000Z',
          last_status: 'Failed',
          last_error: 'Binance rejected request',
          scheduler_type: 'global',
        },
        {
          key: 'system-health-sync',
          name: 'System Health Sync',
          enabled: 1,
          last_finished_at: '2026-04-10T03:30:00.000Z',
          last_status: 'Completed',
          last_error: null,
          scheduler_type: 'global',
        },
      ];
    }

    if (sql.includes('FROM scheduler_user_configs')) {
      assert.deepEqual(params, ['admin-user-5']);
      return [];
    }

    if (
      sql.includes('FROM scheduler_run_logs') &&
      sql.includes('WHERE status = ?') &&
      sql.includes('actor_user_id IS NULL')
    ) {
      assert.deepEqual(params, ['Running']);
      return [brokerRunningRow];
    }

    if (
      sql.includes('FROM scheduler_run_logs') &&
      sql.includes('WHERE status = ?') &&
      sql.includes('actor_user_id = ?')
    ) {
      assert.deepEqual(params, ['Running', 'admin-user-5']);
      return [];
    }

    if (
      sql.includes('FROM scheduler_run_logs') &&
      !sql.includes('WHERE status = ?') &&
      sql.includes('actor_user_id IS NULL')
    ) {
      return [
        brokerRunningRow,
        {
          id: 'exchange-run-9',
          schedulerKey: 'exchange-assets-sync',
          status: 'Completed',
          startedAt: '2026-04-10T01:10:00.000Z',
          finishedAt: '2026-04-10T01:15:00.000Z',
          durationMs: 300000,
          processedAccounts: 20,
          insertedAssets: 11,
          updatedAssets: 5,
          skippedAssets: 4,
          errorMessage: null,
          meta: JSON.stringify({
            initiatedByType: 'cron',
            initiatedByLabel: 'System cron',
            executionContext: 'system',
            progress: {
              total: 20,
              processed: 20,
              percent: 100,
            },
          }),
          initiatedByType: 'cron',
          initiatedByUserId: null,
          initiatedByLabel: 'System cron',
          executionContext: 'system',
        },
        {
          id: 'candles-run-4',
          schedulerKey: 'binance-candles-3m-1m-sync',
          status: 'Failed',
          startedAt: '2026-04-10T02:00:00.000Z',
          finishedAt: '2026-04-10T02:10:00.000Z',
          durationMs: 600000,
          processedAccounts: 8,
          insertedAssets: 0,
          updatedAssets: 0,
          skippedAssets: 8,
          errorMessage: 'Binance rejected request',
          meta: JSON.stringify({
            initiatedByType: 'cron',
            initiatedByLabel: 'System cron',
            executionContext: 'system',
            progress: {
              total: 8,
              processed: 8,
              percent: 100,
            },
          }),
          initiatedByType: 'cron',
          initiatedByUserId: null,
          initiatedByLabel: 'System cron',
          executionContext: 'system',
        },
        {
          id: 'health-run-3',
          schedulerKey: 'system-health-sync',
          status: 'Completed',
          startedAt: '2026-04-10T03:20:00.000Z',
          finishedAt: '2026-04-10T03:30:00.000Z',
          durationMs: 600000,
          processedAccounts: 5,
          insertedAssets: 0,
          updatedAssets: 5,
          skippedAssets: 0,
          errorMessage: null,
          meta: JSON.stringify({
            initiatedByType: 'system',
            initiatedByLabel: 'System',
            executionContext: 'system',
            progress: {
              total: 5,
              processed: 5,
              percent: 100,
            },
          }),
          initiatedByType: 'system',
          initiatedByUserId: null,
          initiatedByLabel: 'System',
          executionContext: 'system',
        },
      ];
    }

    if (
      sql.includes('FROM scheduler_run_logs') &&
      !sql.includes('WHERE status = ?') &&
      sql.includes('actor_user_id = ?')
    ) {
      assert.deepEqual(params, ['admin-user-5']);
      return [];
    }

    if (sql.includes('FROM scheduler_commands') && sql.includes('actor_user_id IS NULL')) {
      return [
        {
          id: 'broker-command-1',
          schedulerKey: 'broker-assets-sync',
          status: 'Pending',
          createdAt: '2026-04-10T01:12:00.000Z',
          updatedAt: '2026-04-10T01:14:00.000Z',
          initiatedByType: 'manual',
          initiatedByUserId: 'admin-user-5',
          initiatedByLabel: 'admin-user-5',
          executionContext: 'system',
        },
        {
          id: 'exchange-command-1',
          schedulerKey: 'exchange-assets-sync',
          status: 'Pending',
          createdAt: '2026-04-10T01:18:00.000Z',
          updatedAt: '2026-04-10T01:20:00.000Z',
          initiatedByType: 'system',
          initiatedByUserId: null,
          initiatedByLabel: 'System',
          executionContext: 'system',
        },
      ];
    }

    if (sql.includes('FROM scheduler_commands') && sql.includes('actor_user_id = ?')) {
      assert.deepEqual(params, ['admin-user-5']);
      return [];
    }

    return [];
  };

  try {
    const response = await service.getOverview('admin-user-5');
    assert.equal(response.data.time?.displayTimeZone, 'Asia/Kolkata');
    assert.equal(response.data.time?.displayTimesLocalized, true);

    const indexed = new Map(response.data.items.map((item: any) => [item.key, item]));

    const broker = indexed.get('broker-assets-sync') as
      | {
          status?: string;
          hasQueuedWork?: boolean;
          initiatedBy?: { type?: string; userId?: string; label?: string };
          executionContext?: string;
          recentRun?: {
            id?: string;
            status?: string;
            startedAt?: string;
            startedAtIso?: string;
            durationMs?: number;
            processedAccounts?: number;
            insertedAssets?: number;
            updatedAssets?: number;
            skippedAssets?: number;
            progress?: { percent?: number; etaSeconds?: number };
          };
          ops?: {
            activeStatus?: string;
            hasQueuedWork?: boolean;
            latestRunId?: string;
            latestRunStatus?: string;
            latestOutcome?: string;
            latestFinishedAt?: string;
            latestFinishedAtIso?: string;
          };
        }
      | undefined;
    assert.equal(broker?.status, 'running');
    assert.equal(broker?.hasQueuedWork, true);
    assert.equal(broker?.initiatedBy?.type, 'manual');
    assert.equal(broker?.initiatedBy?.userId, 'admin-user-5');
    assert.equal(broker?.executionContext, 'system');
    assert.equal(broker?.recentRun?.id, 'broker-run-2');
    assert.equal(broker?.recentRun?.status, 'Running');
    assert.equal(broker?.recentRun?.startedAt, '2026-04-10T06:35:00.000+05:30');
    assert.equal(broker?.recentRun?.startedAtIso, '2026-04-10T01:05:00.000Z');
    assert.equal(broker?.recentRun?.durationMs, 900000);
    assert.equal(broker?.recentRun?.processedAccounts, 12);
    assert.equal(broker?.recentRun?.insertedAssets, 7);
    assert.equal(broker?.recentRun?.updatedAssets, 3);
    assert.equal(broker?.recentRun?.skippedAssets, 2);
    assert.equal(broker?.recentRun?.progress?.percent, 40);
    assert.equal(broker?.recentRun?.progress?.etaSeconds, 180);
    assert.equal(broker?.ops?.activeStatus, 'running');
    assert.equal(broker?.ops?.hasQueuedWork, true);
    assert.equal(broker?.ops?.latestRunId, 'broker-run-2');
    assert.equal(broker?.ops?.latestRunStatus, 'Running');
    assert.equal(broker?.ops?.latestOutcome, 'Completed');
    assert.equal(broker?.ops?.latestFinishedAt, '2026-04-10T06:30:00.000+05:30');
    assert.equal(broker?.ops?.latestFinishedAtIso, '2026-04-10T01:00:00.000Z');

    const exchange = indexed.get('exchange-assets-sync') as
      | {
          status?: string;
          hasQueuedWork?: boolean;
          queuedAt?: string;
          initiatedBy?: { type?: string; label?: string };
          recentRun?: {
            id?: string;
            status?: string;
            finishedAt?: string;
            finishedAtIso?: string;
            processedAccounts?: number;
            insertedAssets?: number;
            updatedAssets?: number;
            skippedAssets?: number;
          };
          ops?: {
            activeStatus?: string;
            hasQueuedWork?: boolean;
            latestRunStatus?: string;
            latestOutcome?: string;
            latestFinishedAt?: string;
          };
        }
      | undefined;
    assert.equal(exchange?.status, 'queued');
    assert.equal(exchange?.hasQueuedWork, true);
    assert.equal(exchange?.queuedAt, '2026-04-10T06:50:00.000+05:30');
    assert.equal(exchange?.initiatedBy?.type, 'system');
    assert.equal(exchange?.initiatedBy?.label, 'System');
    assert.equal(exchange?.recentRun?.id, 'exchange-run-9');
    assert.equal(exchange?.recentRun?.status, 'Completed');
    assert.equal(exchange?.recentRun?.finishedAt, '2026-04-10T06:45:00.000+05:30');
    assert.equal(exchange?.recentRun?.finishedAtIso, '2026-04-10T01:15:00.000Z');
    assert.equal(exchange?.recentRun?.processedAccounts, 20);
    assert.equal(exchange?.recentRun?.insertedAssets, 11);
    assert.equal(exchange?.recentRun?.updatedAssets, 5);
    assert.equal(exchange?.recentRun?.skippedAssets, 4);
    assert.equal(exchange?.ops?.activeStatus, 'queued');
    assert.equal(exchange?.ops?.hasQueuedWork, true);
    assert.equal(exchange?.ops?.latestRunStatus, 'Completed');
    assert.equal(exchange?.ops?.latestOutcome, 'Completed');
    assert.equal(exchange?.ops?.latestFinishedAt, '2026-04-10T06:45:00.000+05:30');

    const candles = indexed.get('binance-candles-3m-1m-sync') as
      | {
          status?: string;
          hasQueuedWork?: boolean;
          lastError?: string;
          recentRun?: {
            id?: string;
            status?: string;
            errorMessage?: string;
            processedAccounts?: number;
            skippedAssets?: number;
          };
          ops?: {
            activeStatus?: string;
            latestRunStatus?: string;
            latestOutcome?: string;
            latestError?: string;
          };
        }
      | undefined;
    assert.equal(candles?.status, 'failed');
    assert.equal(candles?.hasQueuedWork, false);
    assert.equal(candles?.lastError, 'Binance rejected request');
    assert.equal(candles?.recentRun?.id, 'candles-run-4');
    assert.equal(candles?.recentRun?.status, 'Failed');
    assert.equal(candles?.recentRun?.errorMessage, 'Binance rejected request');
    assert.equal(candles?.recentRun?.processedAccounts, 8);
    assert.equal(candles?.recentRun?.skippedAssets, 8);
    assert.equal(candles?.ops?.activeStatus, 'failed');
    assert.equal(candles?.ops?.latestRunStatus, 'Failed');
    assert.equal(candles?.ops?.latestOutcome, 'Failed');
    assert.equal(candles?.ops?.latestError, 'Binance rejected request');

    const health = indexed.get('system-health-sync') as
      | {
          status?: string;
          hasQueuedWork?: boolean;
          recentRun?: {
            id?: string;
            status?: string;
            finishedAt?: string;
            updatedAssets?: number;
            healthCheckCounts?: {
              checked?: number;
              passed?: number;
              failed?: number;
              skipped?: number;
            };
          };
          ops?: {
            activeStatus?: string;
            latestRunStatus?: string;
            latestOutcome?: string;
            latestFinishedAt?: string;
          };
        }
      | undefined;
    assert.equal(health?.status, 'idle');
    assert.equal(health?.hasQueuedWork, false);
    assert.equal(health?.recentRun?.id, 'health-run-3');
    assert.equal(health?.recentRun?.status, 'Completed');
    assert.equal(health?.recentRun?.finishedAt, '2026-04-10T09:00:00.000+05:30');
    assert.equal(health?.recentRun?.updatedAssets, 5);
    assert.deepEqual(health?.recentRun?.healthCheckCounts, {
      checked: 5,
      passed: 0,
      failed: 5,
      skipped: 0,
    });
    assert.equal(health?.ops?.activeStatus, 'idle');
    assert.equal(health?.ops?.latestRunStatus, 'Completed');
    assert.equal(health?.ops?.latestOutcome, 'Completed');
    assert.equal(health?.ops?.latestFinishedAt, '2026-04-10T09:00:00.000+05:30');
  } finally {
    (coreDataSource as any).query = originalQuery;
  }
}

async function assertGlobalSystemSchedulerMigration(
  migration:
    | NormalizeGlobalSystemSchedulerOwnership1770710000000
    | EnforceGlobalSystemSchedulerScope1770711000000
    | AddGlobalSystemSchedulerInitiatorAudit1770712000000
): Promise<void> {
  const queries: Array<{ sql: string; params?: unknown[] }> = [];
  const queryRunner = {
    async hasTable(tableName: string) {
      return [
        'scheduler_configs',
        'scheduler_user_configs',
        'scheduler_commands',
        'scheduler_run_logs',
        'exchange_asset_update_logs',
      ].includes(tableName);
    },
    async hasColumn(tableName: string, columnName: string) {
      return (
        (tableName === 'scheduler_commands' &&
          (columnName === 'actor_user_id' || columnName === 'payload_json')) ||
        (tableName === 'scheduler_run_logs' &&
          (columnName === 'actor_user_id' || columnName === 'meta_json'))
      );
    },
    async query(sql: string, params?: unknown[]) {
      queries.push({ sql, params });
      return [];
    },
  };

  await migration.up(queryRunner as any);

  if (migration instanceof AddGlobalSystemSchedulerInitiatorAudit1770712000000) {
    assert.ok(
      queries.some((entry) => entry.sql.includes('ALTER TABLE scheduler_run_logs ADD COLUMN initiated_by_type')),
      'Phase 2 migration should add initiated_by_type to scheduler_run_logs'
    );
    assert.ok(
      queries.some((entry) => entry.sql.includes('ALTER TABLE scheduler_commands ADD COLUMN initiated_by_type')),
      'Phase 2 migration should add initiated_by_type to scheduler_commands'
    );
    assert.ok(
      queries.some(
        (entry) => entry.sql.includes('ALTER TABLE exchange_asset_update_logs ADD COLUMN initiated_by_type')
      ),
      'Phase 2 migration should add initiated_by_type to exchange_asset_update_logs'
    );
    assert.ok(
      queries.some(
        (entry) =>
          entry.sql.includes('UPDATE scheduler_run_logs') &&
          entry.sql.includes('initiated_by_type') &&
          entry.sql.includes('execution_context')
      ),
      'Phase 2 migration should backfill run-log initiator metadata'
    );
    assert.ok(
      queries.some(
        (entry) =>
          entry.sql.includes('UPDATE scheduler_commands') &&
          entry.sql.includes('initiated_by_type') &&
          entry.sql.includes('execution_context')
      ),
      'Phase 2 migration should backfill command initiator metadata'
    );
    assert.ok(
      queries.some(
        (entry) =>
          entry.sql.includes('UPDATE exchange_asset_update_logs log') &&
          entry.sql.includes('log.initiated_by_type') &&
          entry.sql.includes('log.execution_context')
      ),
      'Phase 2 migration should backfill update-log initiator metadata'
    );
    return;
  }

  for (const key of [
    'broker-assets-sync',
    'exchange-assets-sync',
    'binance-candles-3m-1m-sync',
    'system-health-sync',
    'asset-price-sync',
  ]) {
    assert.ok(
      queries.some(
        (entry) =>
          entry.sql.includes('UPDATE scheduler_configs') &&
          entry.sql.includes("scheduler_type = 'global'") &&
          Array.isArray(entry.params) &&
          entry.params.includes(key)
      ),
      `migration should normalize ${key} ownership to global`
    );
  }

  assert.ok(
    queries.some(
      (entry) =>
        entry.sql.includes('DELETE FROM scheduler_user_configs') &&
        Array.isArray(entry.params) &&
        entry.params.includes('asset-price-sync') &&
        entry.params.includes('broker-assets-sync')
    ),
    'migration should retire any user-scoped scheduler rows for the global system schedulers'
  );
  assert.ok(
    queries.some((entry) => entry.sql.includes('UPDATE scheduler_commands') && entry.sql.includes('actor_user_id = NULL')),
    'migration should clear actor ownership from scheduler_commands for global system schedulers'
  );
  assert.ok(
    queries.some((entry) => entry.sql.includes('UPDATE scheduler_run_logs') && entry.sql.includes('actor_user_id = NULL')),
    'migration should clear actor ownership from scheduler_run_logs for global system schedulers'
  );
  assert.ok(
    queries.some(
      (entry) =>
        entry.sql.includes('UPDATE scheduler_commands') &&
        entry.sql.includes('payload_json') &&
        entry.sql.includes('JSON_REMOVE') &&
        entry.sql.includes('$.actorUserId')
    ),
    'migration should scrub embedded actorUserId values from scheduler_commands payloads'
  );
  assert.ok(
    queries.some(
      (entry) =>
        entry.sql.includes('UPDATE scheduler_run_logs') &&
        entry.sql.includes('meta_json') &&
        entry.sql.includes('JSON_REMOVE') &&
        entry.sql.includes('$.actorUserId')
    ),
    'migration should scrub embedded actorUserId values from scheduler_run_logs meta payloads'
  );
}

async function testGlobalSystemSchedulerMigration(): Promise<void> {
  await assertGlobalSystemSchedulerMigration(
    new NormalizeGlobalSystemSchedulerOwnership1770710000000()
  );
  await assertGlobalSystemSchedulerMigration(
    new EnforceGlobalSystemSchedulerScope1770711000000()
  );
  await assertGlobalSystemSchedulerMigration(
    new AddGlobalSystemSchedulerInitiatorAudit1770712000000()
  );
}

async function run(): Promise<void> {
  const originalExecutionMode = env.scheduler.executionMode;
  env.scheduler.executionMode = 'queue';

  try {
    await assertGlobalSchedulerBehavior({
      label: 'broker assets scheduler',
      key: 'broker-assets-sync',
      description:
        'Fetches provider assets for system broker accounts and updates the global broker assets catalog.',
      buildService: () => new SchedulerService(),
    });
    await assertPhaseThreeLocalizedTimeContract({
      label: 'broker assets scheduler',
      key: 'broker-assets-sync',
      description:
        'Fetches provider assets for system broker accounts and updates the global broker assets catalog.',
      buildService: () => new SchedulerService(),
    });
    await assertPhaseTwoAuditContract({
      label: 'broker assets scheduler',
      key: 'broker-assets-sync',
      description:
        'Fetches provider assets for system broker accounts and updates the global broker assets catalog.',
      buildService: () => new SchedulerService(),
    });
    await assertPhaseFourRetentionContract({
      label: 'broker assets scheduler',
      key: 'broker-assets-sync',
      description:
        'Fetches provider assets for system broker accounts and updates the global broker assets catalog.',
      buildService: () => new SchedulerService(),
    });
    await assertGlobalSchedulerBehavior({
      label: 'exchange assets scheduler',
      key: 'exchange-assets-sync',
      description:
        'Syncs the global exchange assets catalog from Binance exchangeInfo using Binance base URL configured in system exchange metadata.',
      buildService: () => new BinanceAssetsSchedulerService(),
    });
    await assertPhaseThreeLocalizedTimeContract({
      label: 'exchange assets scheduler',
      key: 'exchange-assets-sync',
      description:
        'Syncs the global exchange assets catalog from Binance exchangeInfo using Binance base URL configured in system exchange metadata.',
      buildService: () => new BinanceAssetsSchedulerService(),
    });
    await assertPhaseTwoAuditContract({
      label: 'exchange assets scheduler',
      key: 'exchange-assets-sync',
      description:
        'Syncs the global exchange assets catalog from Binance exchangeInfo using Binance base URL configured in system exchange metadata.',
      buildService: () => new BinanceAssetsSchedulerService(),
    });
    await assertPhaseFourRetentionContract({
      label: 'exchange assets scheduler',
      key: 'exchange-assets-sync',
      description:
        'Syncs the global exchange assets catalog from Binance exchangeInfo using Binance base URL configured in system exchange metadata.',
      buildService: () => new BinanceAssetsSchedulerService(),
    });
    await assertGlobalSchedulerBehavior({
      label: 'candles scheduler',
      key: 'binance-candles-3m-1m-sync',
      description:
        'Fetches 3 months of 1m candles from Binance for global system exchange assets and stores them in Postgres.',
      buildService: () => new CandlesSchedulerService(),
      needsSystemAssetScope: true,
    });
    await assertPhaseThreeLocalizedTimeContract({
      label: 'candles scheduler',
      key: 'binance-candles-3m-1m-sync',
      description:
        'Fetches 3 months of 1m candles from Binance for global system exchange assets and stores them in Postgres.',
      buildService: () => new CandlesSchedulerService(),
      needsSystemAssetScope: true,
    });
    await assertPhaseTwoAuditContract({
      label: 'candles scheduler',
      key: 'binance-candles-3m-1m-sync',
      description:
        'Fetches 3 months of 1m candles from Binance for global system exchange assets and stores them in Postgres.',
      buildService: () => new CandlesSchedulerService(),
      needsSystemAssetScope: true,
    });
    await assertPhaseFourRetentionContract({
      label: 'candles scheduler',
      key: 'binance-candles-3m-1m-sync',
      description:
        'Fetches 3 months of 1m candles from Binance for global system exchange assets and stores them in Postgres.',
      buildService: () => new CandlesSchedulerService(),
      needsSystemAssetScope: true,
    });
    await assertGlobalSchedulerBehavior({
      label: 'system health scheduler',
      key: 'system-health-sync',
      description:
        'Checks aurAlpha API health, discovery-engine health, scheduler worker health, Binance exchange health, and system broker connection health.',
      buildService: () => new HealthCheckSchedulerService(),
    });
    await assertPhaseThreeLocalizedTimeContract({
      label: 'system health scheduler',
      key: 'system-health-sync',
      description:
        'Checks aurAlpha API health, discovery-engine health, scheduler worker health, Binance exchange health, and system broker connection health.',
      buildService: () => new HealthCheckSchedulerService(),
    });
    await assertPhaseTwoAuditContract({
      label: 'system health scheduler',
      key: 'system-health-sync',
      description:
        'Checks aurAlpha API health, discovery-engine health, scheduler worker health, Binance exchange health, and system broker connection health.',
      buildService: () => new HealthCheckSchedulerService(),
    });
    await assertPhaseFourRetentionContract({
      label: 'system health scheduler',
      key: 'system-health-sync',
      description:
        'Checks aurAlpha API health, discovery-engine health, scheduler worker health, Binance exchange health, and system broker connection health.',
      buildService: () => new HealthCheckSchedulerService(),
    });
    await assertGlobalSchedulerBehavior({
      label: 'asset price scheduler',
      key: 'asset-price-sync',
      description:
        'Fetches latest prices for system broker assets from system market sources (Mudrex, Delta Exchange).',
      buildService: () => new AssetPriceSchedulerService(),
      needsSystemAssetScope: true,
      supportsPhaseTwoAudit: false,
    });
  } finally {
    env.scheduler.executionMode = originalExecutionMode;
  }

  await testSchedulerOverviewKeepsSystemGlobalsGlobal();
  await testSchedulerOverviewDoesNotTreatPositionsAndOrdersAsSystemGlobals();
  await testSchedulerOverviewPhaseFiveSnapshots();
  await testGlobalSystemSchedulerMigration();
  console.log('Global system scheduler assertions passed.');
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
