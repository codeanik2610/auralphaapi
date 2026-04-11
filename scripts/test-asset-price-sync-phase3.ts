import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { AssetPriceSchedulerService } from '../src/api/services/AssetPriceSchedulerService';

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function readWorker(relativePath: string): string {
  return fs.readFileSync(
    path.resolve(process.cwd(), '../aurAlphaSchedulerWorker', relativePath),
    'utf8'
  );
}

async function runRuntimeAssertions(): Promise<void> {
  const service = new AssetPriceSchedulerService() as any;
  const storedConfig: any = {
    key: 'asset-price-sync',
    name: 'Asset Price Sync',
    description:
      'Fetches latest prices for system broker assets from system market sources (Mudrex, Delta Exchange).',
    enabled: true,
    cronExpression: '0 1 * * *',
    timezone: 'UTC',
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
    lastStartedAt: null,
    lastFinishedAt: null,
    lastStatus: null,
    lastError: null,
    runningLockUntil: null,
  };

  let createdRunPayload: any = null;
  let createdCommandPayload: any = null;

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
      return false;
    },
    async createRun(payload: Record<string, unknown>) {
      createdRunPayload = payload;
      return payload;
    },
  };

  service.schedulerCommandRepository = {
    async findLatestBySchedulerKeyAndTypeInStatuses() {
      return null;
    },
    async createCommand(payload: Record<string, unknown>) {
      createdCommandPayload = payload;
      return { id: 'asset-price-command-1', ...payload };
    },
    async cancelPendingBySchedulerKey() {
      return 0;
    },
    async cancelPendingBySchedulerKeyAndType() {
      return 0;
    },
  };

  service.exchangeAssetRepository = {
    async listSystemAssetsForAssetPriceScope(query: Record<string, unknown>) {
      assert.deepEqual(query.sources, ['mudrex', 'delta_exchange']);
      return {
        items: [
          { id: 'asset-id-a', symbol: 'BTCUSDT', source: 'mudrex' },
          { id: 'asset-id-b', symbol: 'BTCUSD', source: 'delta_exchange' },
        ],
        total: 2,
      };
    },
    async listSystemAssetIdsByIds(ids: string[], sources: string[]) {
      assert.deepEqual(ids, ['asset-id-a']);
      assert.deepEqual(sources, ['mudrex', 'delta_exchange']);
      return ['asset-id-a'];
    },
    async listSystemAssetIdsBySources(sources: string[]) {
      assert.deepEqual(sources, ['mudrex', 'delta_exchange']);
      return ['asset-id-a', 'asset-id-b'];
    },
  };

  service.exchangeAssetUpdateLogRepository = {} as any;
  service.activityRepository = {} as any;
  service.alertRepository = {} as any;
  service.userTimeZoneService = {
    async resolveUserTimeZone() {
      return 'Asia/Kolkata';
    },
  };
  service.logSchedulerActivity = async () => {};
  service.emitSchedulerFailureAlert = async () => {};

  const updated = await service.updateSchedulerConfig('admin-user-1', {
    selectionMode: 'custom',
    selectedAssetIds: ['asset-id-a'],
  });
  assert.deepEqual(updated.data.selectedAssetIds, ['asset-id-a']);

  const runNow = await service.runNow('admin-user-1');
  assert.equal(runNow.data.scopeAssetsCount, 1);

  const runScope =
    createdRunPayload?.meta &&
    typeof createdRunPayload.meta === 'object' &&
    !Array.isArray(createdRunPayload.meta) &&
    (createdRunPayload.meta as Record<string, unknown>).scope &&
    typeof (createdRunPayload.meta as Record<string, unknown>).scope === 'object'
      ? ((createdRunPayload.meta as Record<string, unknown>).scope as Record<string, unknown>)
      : {};
  assert.deepEqual(runScope.assets, ['asset-id-a']);

  const commandBody =
    createdCommandPayload?.payload &&
    typeof createdCommandPayload.payload === 'object' &&
    !Array.isArray(createdCommandPayload.payload)
      ? (createdCommandPayload.payload as Record<string, unknown>)
      : {};
  const commandScope =
    commandBody.scope && typeof commandBody.scope === 'object' && !Array.isArray(commandBody.scope)
      ? (commandBody.scope as Record<string, unknown>)
      : {};
  assert.deepEqual(commandScope.assets, ['asset-id-a']);

  const assets = await service.listSchedulerAssets({});
  assert.equal(assets.data.total, 2);
  assert.deepEqual(assets.data.items, [
    { id: 'asset-id-a', symbol: 'BTCUSDT', source: 'mudrex' },
    { id: 'asset-id-b', symbol: 'BTCUSD', source: 'delta_exchange' },
  ]);
}

async function run(): Promise<void> {
  const findings: string[] = [];

  await runRuntimeAssertions();

  const phaseDoc = read('ASSET_PRICE_SYNC_PHASE3.md');
  for (const marker of [
    'Phase 3 performs the live writer cutover for `asset-price-sync`.',
    '`asset_price` is the canonical write target',
    '`broker_asset_id` is the runtime write key',
    'scheduler scope assets are `broker_assets.id` values',
    'Phase 4 is the reader migration phase.',
  ]) {
    if (!phaseDoc.includes(marker)) {
      findings.push(`ASSET_PRICE_SYNC_PHASE3.md: missing Phase 3 marker ${marker}`);
    }
  }

  const readme = read('README.md');
  if (!readme.includes('ASSET_PRICE_SYNC_PHASE3.md')) {
    findings.push('README.md: missing asset-price-sync Phase 3 baseline link');
  }
  if (!readme.includes('test:asset-price-sync-phase3')) {
    findings.push('README.md: missing asset-price-sync Phase 3 verification command');
  }

  const packageSource = read('package.json');
  if (!packageSource.includes('"test:asset-price-sync-phase3"')) {
    findings.push('package.json: missing asset-price-sync Phase 3 test script');
  }
  if (!packageSource.includes('npm run test:asset-price-sync-phase3')) {
    findings.push('package.json: asset-price-sync Phase 3 guard must stay wired');
  }

  const repositorySource = read('src/database/repositories/AssetPriceRepository.ts');
  for (const marker of [
    'export interface AssetPriceUpsertEntry',
    'class AssetPriceRepository',
    'INSERT INTO asset_price',
    'broker_asset_id',
  ]) {
    if (!repositorySource.includes(marker)) {
      findings.push(`AssetPriceRepository.ts: missing Phase 3 marker ${marker}`);
    }
  }

  const refreshSource = read('src/api/services/MarketPriceRefreshService.ts');
  for (const marker of [
    'AssetPriceRepository',
    "related: 'asset_price'",
    "listSystemAssetsBySourceAndSymbols(\n        'mudrex'",
    "listSystemAssetsBySourceAndSymbols(\n        'delta_exchange'",
    'this.assetPriceRepository.upsertMany',
  ]) {
    if (!refreshSource.includes(marker)) {
      findings.push(`MarketPriceRefreshService.ts: missing Phase 3 marker ${marker}`);
    }
  }

  const schedulerSource = read('src/api/services/AssetPriceSchedulerService.ts');
  for (const marker of [
    'listSystemAssetsForAssetPriceScope',
    'listSystemAssetIdsByIds',
    'listSystemAssetIdsBySources',
    'resolveScopeAssetIds',
    ".map((item) => String(item || '').trim())",
  ]) {
    if (!schedulerSource.includes(marker)) {
      findings.push(`AssetPriceSchedulerService.ts: missing Phase 3 marker ${marker}`);
    }
  }

  const exchangeAssetRepositorySource = read('src/database/repositories/ExchangeAssetRepository.ts');
  for (const marker of [
    'AssetPriceScopeAssetQuery',
    'listSystemAssetsForAssetPriceScope',
    'listSystemAssetIdsByIds',
    'listSystemAssetIdsBySources',
  ]) {
    if (!exchangeAssetRepositorySource.includes(marker)) {
      findings.push(`ExchangeAssetRepository.ts: missing Phase 3 marker ${marker}`);
    }
  }

  const workerExecutionSource = readWorker('src/scheduler/services/SchedulerExecutionService.ts');
  for (const marker of [
    'scope.assets could not be resolved to broker assets',
    'INSERT INTO asset_price',
    'broker_asset_id',
    'fetchMudrexAssetPriceMap',
    'fetchDeltaAssetPriceMap',
    'fetchExistingAssetPriceIds',
  ]) {
    if (!workerExecutionSource.includes(marker)) {
      findings.push(`Worker SchedulerExecutionService.ts: missing Phase 3 marker ${marker}`);
    }
  }

  const workerPollerSource = readWorker('src/scheduler/queue/SchedulerCommandPoller.ts');
  for (const marker of [
    'normalizeCommandScope(command.scheduler_key, payloadJson)',
    "String(schedulerKey || '').trim() === ASSET_PRICE_SCHEDULER_KEY",
    'SELECT DISTINCT id',
    'LOWER(source) IN (?)',
  ]) {
    if (!workerPollerSource.includes(marker)) {
      findings.push(`Worker SchedulerCommandPoller.ts: missing Phase 3 marker ${marker}`);
    }
  }

  assert.equal(
    findings.length,
    0,
    `Asset price sync Phase 3 guard failed:\n${findings.join('\n')}`
  );
  console.log('Asset price sync Phase 3 guard passed.');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
