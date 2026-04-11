import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { AssetPriceSchedulerService } from '../src/api/services/AssetPriceSchedulerService';

const frontendRoot = '/Users/apple/Documents/Project/Frontend/aurAlphaApp';

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function readFrontend(relativePath: string): string {
  return fs.readFileSync(path.join(frontendRoot, relativePath), 'utf8');
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
    timezone: 'Asia/Kolkata',
    runAt: '01:00',
    intervalDays: 1,
    batchSize: 200,
    schedulerType: 'global',
    config: {
      sources: ['mudrex', 'delta_exchange'],
      useSystemConnectionsOnly: true,
      selectionMode: 'all',
      selectedAssetIds: [],
      retentionDays: 30,
      scheduleMode: 'daily',
      intervalMinutes: 5,
      intervalSeconds: 1,
      hourlyMinute: 0,
    },
  };

  let createdRunPayload: any = null;
  const createdCommands: any[] = [];

  service.userTimeZoneService = {
    async resolveUserTimeZone() {
      return 'Asia/Kolkata';
    },
  };
  service.schedulerConfigRepository = {
    async createIfMissing() {
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
      createdCommands.push(payload);
      return { id: 'command-1', ...payload };
    },
  };
  service.exchangeAssetRepository = {
    async listSystemAssetIdsByIds(ids: string[], sources: string[]) {
      assert.deepEqual(ids, ['asset-id-a', 'asset-id-b']);
      assert.deepEqual(sources, ['mudrex', 'delta_exchange']);
      return ids;
    },
    async listSystemAssetIdsBySources() {
      throw new Error('Phase 7 runNow overrides should use selected asset ids');
    },
  };
  service.activityRepository = {
    async createActivityLog() {
      return null;
    },
  };
  service.alertRepository = {
    async createAlert() {
      return null;
    },
  };

  const response = await service.runNow('ops-admin', {
    selectionMode: 'custom',
    selectedAssetIds: ['asset-id-a', 'asset-id-b'],
    sources: ['mudrex', 'delta_exchange'],
  });

  assert.equal(response.data.queued, true);
  assert.equal(response.data.scopeAssetsCount, 2);
  assert.deepEqual(createdRunPayload.meta.scope.assets, ['asset-id-a', 'asset-id-b']);
  assert.deepEqual(createdCommands[0].payload.scope.assets, ['asset-id-a', 'asset-id-b']);
}

async function run(): Promise<void> {
  const findings: string[] = [];

  await runRuntimeAssertions();

  const phaseDoc = read('ASSET_PRICE_SYNC_PHASE7.md');
  for (const marker of [
    'Phase 7 completes the frontend/operator consumption handoff for',
    '`asset-price-sync`',
    'Mudrex and Delta Exchange',
    "sources: ['mudrex', 'delta_exchange']",
    'writes latest values by broker asset id',
    'focused frontend tests now guard the asset-price save/run payload contract',
    'The operator consumption layer is now frozen',
    'Carry-Forward For Phase 8',
  ]) {
    if (!phaseDoc.includes(marker)) {
      findings.push(`ASSET_PRICE_SYNC_PHASE7.md: missing Phase 7 marker ${marker}`);
    }
  }

  const readme = read('README.md');
  if (!readme.includes('ASSET_PRICE_SYNC_PHASE7.md')) {
    findings.push('README.md: missing asset-price-sync Phase 7 baseline link');
  }
  if (!readme.includes('frontend/operator consumption handoff')) {
    findings.push('README.md: missing asset-price-sync Phase 7 summary');
  }
  if (!readme.includes('test:asset-price-sync-phase7')) {
    findings.push('README.md: missing asset-price-sync Phase 7 verification command');
  }

  const packageSource = read('package.json');
  if (!packageSource.includes('"test:asset-price-sync-phase7"')) {
    findings.push('package.json: missing asset-price-sync Phase 7 test script');
  }
  if (!packageSource.includes('npm run test:asset-price-sync-phase7')) {
    findings.push('package.json: asset-price-sync Phase 7 guard must stay wired');
  }

  const schedulersPage = readFrontend('src/pages/Schedulers/index.jsx');
  for (const marker of [
    'Fetches latest prices for system broker assets from Mudrex and Delta Exchange.',
    "sources: ['mudrex', 'delta_exchange']",
  ]) {
    if (!schedulersPage.includes(marker)) {
      findings.push(`frontend Schedulers index.jsx: missing Phase 7 marker ${marker}`);
    }
  }
  for (const removedMarker of [
    'Fetches latest asset prices from Binance for monitored assets.',
    'Fetches latest asset prices for monitored symbols.',
  ]) {
    if (schedulersPage.includes(removedMarker)) {
      findings.push(`frontend Schedulers index.jsx: stale Phase 7 marker still present ${removedMarker}`);
    }
  }

  const configSection = readFrontend('src/pages/Schedulers/components/SchedulerConfigSection.jsx');
  for (const marker of [
    'System sources: Mudrex + Delta Exchange. Writes latest values by broker asset id.',
    'All system broker assets covered by Mudrex and Delta Exchange will be included in asset price scope.',
  ]) {
    if (!configSection.includes(marker)) {
      findings.push(
        `frontend SchedulerConfigSection.jsx: missing Phase 7 marker ${marker}`
      );
    }
  }

  const schedulersPageTest = readFrontend('src/pages/Schedulers/index.test.jsx');
  for (const marker of [
    'saves asset-price-sync using Mudrex and Delta Exchange system sources',
    'tradingApi.updateSchedulerConfig',
    "expect.objectContaining({",
    'runs asset-price-sync with Mudrex and Delta Exchange system sources',
    'tradingApi.runSchedulerNow',
    "sources: ['mudrex', 'delta_exchange']",
  ]) {
    if (!schedulersPageTest.includes(marker)) {
      findings.push(`frontend Schedulers index.test.jsx: missing Phase 7 test marker ${marker}`);
    }
  }

  assert.equal(
    findings.length,
    0,
    `Asset price sync Phase 7 guard failed:\n${findings.join('\n')}`
  );
  console.log('Asset price sync Phase 7 guard passed.');
}

run();
