import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CreateAssetPriceTable1770713000000 } from '../src/database/migrations/1770713000000-CreateAssetPriceTable';
import { DropLegacyMarketPricesBinanceTable1770714000000 } from '../src/database/migrations/1770714000000-DropLegacyMarketPricesBinanceTable';
import { AssetPriceSchedulerService } from '../src/api/services/AssetPriceSchedulerService';
import { AssetPriceRepository } from '../src/database/repositories/AssetPriceRepository';
import { BrokerReferenceDataService } from '../src/api/services/BrokerReferenceDataService';
import {
  formatSchedulerDisplayTime,
  formatSchedulerRawIso,
} from '../src/api/utils/schedulerTimeContract';

type JsonRecord = Record<string, unknown>;

const frontendRoot = '/Users/apple/Documents/Project/Frontend/aurAlphaApp';
const workerRoot = path.resolve(process.cwd(), '../aurAlphaSchedulerWorker');
const moduleTestCommand = 'test:asset-price-sync';
const moduleTestScriptPath = 'scripts/test-asset-price-sync.ts';
const releaseGateSuiteKey = 'backend-asset-price-sync-suite';

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function readWorker(relativePath: string): string {
  return fs.readFileSync(path.join(workerRoot, relativePath), 'utf8');
}

function readFrontend(relativePath: string): string {
  return fs.readFileSync(path.join(frontendRoot, relativePath), 'utf8');
}

function ensureMarkers(
  source: string,
  markers: string[],
  findings: string[],
  label: string
): void {
  for (const marker of markers) {
    if (!source.includes(marker)) {
      findings.push(`${label}: missing marker ${marker}`);
    }
  }
}

function ensureAssetPricePackageWiring(packageSource: string, findings: string[], label: string): void {
  if (!packageSource.includes(`"${moduleTestCommand}"`)) {
    findings.push(`${label}: missing consolidated asset-price-sync test script`);
  }
  if (!packageSource.includes(moduleTestScriptPath)) {
    findings.push(`${label}: consolidated asset-price-sync test must point at ${moduleTestScriptPath}`);
  }
}

async function runCommand(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv
): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env,
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', (code) => resolve(code));
  });
}

function listTypeScriptFiles(rootPath: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(rootPath, { withFileTypes: true })) {
    const absolutePath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...listTypeScriptFiles(absolutePath));
      continue;
    }
    if (entry.isFile() && absolutePath.endsWith('.ts')) {
      results.push(absolutePath);
    }
  }
  return results;
}

function runPhase1Assertions(): void {
  const findings: string[] = [];

  const phaseDoc = read('ASSET_PRICE_SYNC_PHASE1.md');
  ensureMarkers(
    phaseDoc,
    [
      '`asset-price-sync`',
      '`asset_price`',
      '`market_prices_binance`',
      '`broker_assets.id`',
      'Phase 1 does not change scheduler execution behavior.',
      'Phase 2 must introduce the `asset_price` schema and storage migration path.',
      'Phase 3 must switch writer paths from the legacy table to `asset_price`.',
    ],
    findings,
    'ASSET_PRICE_SYNC_PHASE1.md'
  );

  const checklist = read('ASSET_PRICE_SYNC_FUNCTIONAL_CHECKLIST.md');
  ensureMarkers(
    checklist,
    [
      'Storage target table: `asset_price`',
      'Legacy table to retire from this flow: `market_prices_binance`',
      '`selectedAssetIds` refer to `broker_assets.id` values.',
      '`broker_asset_id` is the primary or uniqueness anchor for upsert behavior.',
    ],
    findings,
    'ASSET_PRICE_SYNC_FUNCTIONAL_CHECKLIST.md'
  );

  const readme = read('README.md');
  ensureMarkers(
    readme,
    [
      'ASSET_PRICE_SYNC_PHASE1.md',
      moduleTestCommand,
      'frozen Phase 1 contract for `asset-price-sync`',
    ],
    findings,
    'README.md'
  );

  const contractSource = read('src/api/utils/assetPriceContract.ts');
  ensureMarkers(
    contractSource,
    [
      "export const ASSET_PRICE_SYNC_SCHEDULER_KEY = 'asset-price-sync';",
      "export const ASSET_PRICE_SYNC_SCHEDULER_OWNERSHIP = 'global' as const;",
      "export const ASSET_PRICE_SYNC_SCOPE_SOURCE_TABLE = 'broker_assets';",
      "export const ASSET_PRICE_SYNC_TARGET_STORAGE_TABLE = 'asset_price';",
      'export const ASSET_PRICE_SYNC_DEFAULT_CONFIG = {',
    ],
    findings,
    'assetPriceContract.ts'
  );

  const serviceSource = read('src/api/services/AssetPriceSchedulerService.ts');
  ensureMarkers(
    serviceSource,
    [
      "from '../utils/assetPriceContract';",
      'ASSET_PRICE_SYNC_SCHEDULER_KEY',
      'ASSET_PRICE_SYNC_SCHEDULER_NAME',
      'ASSET_PRICE_SYNC_SCHEDULER_OWNERSHIP',
      'ASSET_PRICE_SYNC_DEFAULT_CONFIG',
      'ASSET_PRICE_SYNC_SYSTEM_SOURCES',
      'ASSET_PRICE_SYNC_ALLOWED_SELECTION_MODES',
    ],
    findings,
    'AssetPriceSchedulerService.ts'
  );

  const schedulerOverviewSource = read('src/api/services/SchedulerOverviewService.ts');
  if (!schedulerOverviewSource.includes("'asset-price-sync'")) {
    findings.push('SchedulerOverviewService.ts: asset-price-sync must remain in the system-owned scheduler set');
  }

  for (const relativePath of [
    'src/database/migrations/1770710000000-NormalizeGlobalSystemSchedulerOwnership.ts',
    'src/database/migrations/1770711000000-EnforceGlobalSystemSchedulerScope.ts',
  ]) {
    const source = read(relativePath);
    if (
      !source.includes(
        'Fetches latest prices for system broker assets from system market sources (Mudrex, Delta Exchange).'
      )
    ) {
      findings.push(`${relativePath}: missing frozen asset-price-sync Phase 1 description`);
    }
  }

  const regressionSource = read('scripts/test-global-system-schedulers.ts');
  ensureMarkers(
    regressionSource,
    ["'asset-price-sync'", "['asset-price-sync', 'Asset Price Sync']"],
    findings,
    'test-global-system-schedulers.ts'
  );

  ensureAssetPricePackageWiring(read('package.json'), findings, 'package.json');

  assert.equal(findings.length, 0, `Asset price sync Phase 1 assertions failed:\n${findings.join('\n')}`);
}

async function runPhase2Assertions(): Promise<void> {
  const findings: string[] = [];
  const migration = new CreateAssetPriceTable1770713000000();
  const executedQueries: string[] = [];
  const indexes = new Set<string>();
  let hasAssetPrice = false;

  await migration.up({
    async hasTable(tableName: string) {
      if (tableName === 'asset_price') {
        return hasAssetPrice;
      }
      return tableName === 'market_prices_binance' || tableName === 'broker_assets';
    },
    async query(sql: string, params?: unknown[]) {
      executedQueries.push(sql);

      if (sql.includes('CREATE TABLE IF NOT EXISTS asset_price')) {
        hasAssetPrice = true;
        return [];
      }

      if (sql.includes('SHOW INDEX FROM asset_price WHERE Key_name = ?')) {
        const indexName = String(params?.[0] || '');
        return indexes.has(indexName) ? [{ Key_name: indexName }] : [];
      }

      if (sql.includes('CREATE INDEX idx_asset_price_')) {
        const match = sql.match(/CREATE INDEX ([A-Za-z0-9_]+) ON asset_price/);
        if (match?.[1]) {
          indexes.add(match[1]);
        }
        return [];
      }

      if (sql.includes('DROP TABLE IF EXISTS asset_price')) {
        hasAssetPrice = false;
      }

      return [];
    },
  } as any);

  assert.equal(
    executedQueries.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS asset_price')),
    true
  );
  assert.equal(
    executedQueries.some(
      (sql) =>
        sql.includes('INSERT INTO asset_price') &&
        sql.includes('FROM market_prices_binance mp') &&
        sql.includes('INNER JOIN broker_assets ba') &&
        sql.includes('ba.id = mp.exchange_asset_id')
    ),
    true
  );
  assert.equal(indexes.has('idx_asset_price_source_symbol'), true);
  assert.equal(indexes.has('idx_asset_price_symbol'), true);
  assert.equal(indexes.has('idx_asset_price_retrieved_at'), true);
  assert.equal(indexes.has('idx_asset_price_updated_at'), true);

  await migration.down({
    async query(sql: string) {
      executedQueries.push(sql);
      if (sql.includes('DROP TABLE IF EXISTS asset_price')) {
        hasAssetPrice = false;
      }
      return [];
    },
  } as any);

  assert.equal(hasAssetPrice, false);

  const phaseDoc = read('ASSET_PRICE_SYNC_PHASE2.md');
  ensureMarkers(
    phaseDoc,
    [
      'Phase 2 introduces the schema foundation for the `asset-price-sync` cutover.',
      '`asset_price` exists as the target storage table',
      '`broker_asset_id` is the schema anchor for price rows',
      'Phase 2 does not perform risky symbol-only remapping.',
      'Phase 3 must switch writer paths away from `market_prices_binance`',
    ],
    findings,
    'ASSET_PRICE_SYNC_PHASE2.md'
  );

  const readme = read('README.md');
  ensureMarkers(readme, ['ASSET_PRICE_SYNC_PHASE2.md', moduleTestCommand], findings, 'README.md');

  const entitySource = read('src/database/entities/AssetPrice.ts');
  ensureMarkers(
    entitySource,
    [
      'Phase 2 schema foundation for asset-price-sync',
      "@Entity({ name: 'asset_price' })",
      "@PrimaryColumn({ name: 'broker_asset_id'",
      "@Index('idx_asset_price_source_symbol'",
    ],
    findings,
    'AssetPrice.ts'
  );

  const dataSource = read('src/database/data-source.ts');
  ensureMarkers(
    dataSource,
    ["import { AssetPrice } from './entities/AssetPrice';", 'AssetPrice, Asset, ExchangeAsset'],
    findings,
    'data-source.ts'
  );

  const migrationSource = read('src/database/migrations/1770713000000-CreateAssetPriceTable.ts');
  ensureMarkers(
    migrationSource,
    [
      'CreateAssetPriceTable1770713000000',
      'CREATE TABLE IF NOT EXISTS asset_price',
      'broker_asset_id char(36) NOT NULL',
      'FROM market_prices_binance mp',
      'INNER JOIN broker_assets ba',
      'ba.id = mp.exchange_asset_id',
    ],
    findings,
    'CreateAssetPriceTable migration'
  );

  ensureAssetPricePackageWiring(read('package.json'), findings, 'package.json');
  assert.equal(findings.length, 0, `Asset price sync Phase 2 assertions failed:\n${findings.join('\n')}`);
}

async function runPhase3Assertions(): Promise<void> {
  const findings: string[] = [];
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
  assert.deepEqual(createdRunPayload.meta.scope.assets, ['asset-id-a']);

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

  const phaseDoc = read('ASSET_PRICE_SYNC_PHASE3.md');
  ensureMarkers(
    phaseDoc,
    [
      'Phase 3 performs the live writer cutover for `asset-price-sync`.',
      '`asset_price` is the canonical write target',
      '`broker_asset_id` is the runtime write key',
      'scheduler scope assets are `broker_assets.id` values',
      'Phase 4 is the reader migration phase.',
    ],
    findings,
    'ASSET_PRICE_SYNC_PHASE3.md'
  );

  const readme = read('README.md');
  ensureMarkers(readme, ['ASSET_PRICE_SYNC_PHASE3.md', moduleTestCommand], findings, 'README.md');

  const repositorySource = read('src/database/repositories/AssetPriceRepository.ts');
  ensureMarkers(
    repositorySource,
    [
      'export interface AssetPriceUpsertEntry',
      'class AssetPriceRepository',
      'INSERT INTO asset_price',
      'broker_asset_id',
    ],
    findings,
    'AssetPriceRepository.ts'
  );

  const refreshSource = read('src/api/services/MarketPriceRefreshService.ts');
  ensureMarkers(
    refreshSource,
    [
      'AssetPriceRepository',
      "related: 'asset_price'",
      "listSystemAssetsBySourceAndSymbols(\n        'mudrex'",
      "listSystemAssetsBySourceAndSymbols(\n        'delta_exchange'",
      'this.assetPriceRepository.upsertMany',
    ],
    findings,
    'MarketPriceRefreshService.ts'
  );

  const schedulerSource = read('src/api/services/AssetPriceSchedulerService.ts');
  ensureMarkers(
    schedulerSource,
    [
      'listSystemAssetsForAssetPriceScope',
      'listSystemAssetIdsByIds',
      'listSystemAssetIdsBySources',
      'resolveScopeAssetIds',
      ".map((item) => String(item || '').trim())",
    ],
    findings,
    'AssetPriceSchedulerService.ts'
  );

  const exchangeAssetRepositorySource = read('src/database/repositories/ExchangeAssetRepository.ts');
  ensureMarkers(
    exchangeAssetRepositorySource,
    [
      'AssetPriceScopeAssetQuery',
      'listSystemAssetsForAssetPriceScope',
      'listSystemAssetIdsByIds',
      'listSystemAssetIdsBySources',
    ],
    findings,
    'ExchangeAssetRepository.ts'
  );

  const workerExecutionSource = readWorker('src/scheduler/services/SchedulerExecutionService.ts');
  ensureMarkers(
    workerExecutionSource,
    [
      'scope.assets could not be resolved to broker assets',
      'INSERT INTO asset_price',
      'broker_asset_id',
      'fetchMudrexAssetPriceMap',
      'fetchDeltaAssetPriceMap',
      'fetchExistingAssetPriceIds',
    ],
    findings,
    'Worker SchedulerExecutionService.ts'
  );

  const workerPollerSource = readWorker('src/scheduler/queue/SchedulerCommandPoller.ts');
  ensureMarkers(
    workerPollerSource,
    [
      'normalizeCommandScope(command.scheduler_key, payloadJson)',
      "String(schedulerKey || '').trim() === ASSET_PRICE_SCHEDULER_KEY",
      'SELECT DISTINCT id',
      'LOWER(source) IN (?)',
    ],
    findings,
    'Worker SchedulerCommandPoller.ts'
  );

  ensureAssetPricePackageWiring(read('package.json'), findings, 'package.json');
  assert.equal(findings.length, 0, `Asset price sync Phase 3 assertions failed:\n${findings.join('\n')}`);
}

async function runPhase4Assertions(): Promise<void> {
  const findings: string[] = [];
  const repository = new AssetPriceRepository() as any;
  repository.listCandidateRows = async () => [
    {
      brokerAssetId: 'delta-asset',
      symbol: 'BTCUSDT',
      sourceSymbol: 'BTCUSDT',
      price: '100.00',
      source: 'delta_exchange',
      retrievedAt: new Date('2026-04-10T10:00:00.000Z'),
      updatedAt: new Date('2026-04-10T10:00:00.000Z'),
    },
    {
      brokerAssetId: 'mudrex-asset',
      symbol: 'BTCUSDT',
      sourceSymbol: 'BTCUSDT',
      price: '101.00',
      source: 'mudrex',
      retrievedAt: new Date('2026-04-10T09:00:00.000Z'),
      updatedAt: new Date('2026-04-10T09:00:00.000Z'),
    },
  ];

  const preferredRows = await repository.getBySymbols(['BTCUSDT'], {
    sources: ['mudrex', 'delta_exchange'],
  });
  assert.equal(preferredRows.length, 1);
  assert.equal(preferredRows[0].source, 'mudrex');

  const referenceService = new BrokerReferenceDataService() as any;
  referenceService.assetPriceRepository = {
    async getBySymbol(symbol: string, options: { sources?: string[] }) {
      assert.equal(symbol, 'BTCUSDT');
      assert.deepEqual(options.sources, ['mudrex', 'delta_exchange']);
      return {
        brokerAssetId: 'mudrex-asset',
        symbol: 'BTCUSDT',
        sourceSymbol: 'BTCUSDT',
        price: '123.45',
        source: 'mudrex',
        retrievedAt: new Date('2026-04-10T00:00:00.000Z'),
        updatedAt: new Date('2026-04-10T00:00:30.000Z'),
      };
    },
  };

  const response = await referenceService.getFuturesAssetBySymbol('BTCUSDT');
  assert.equal(response.data.exchangeAssetId, 'mudrex-asset');
  assert.equal(response.data.brokerAssetId, 'mudrex-asset');

  const phaseDoc = read('ASSET_PRICE_SYNC_PHASE4.md');
  ensureMarkers(
    phaseDoc,
    [
      'Phase 4 completes the downstream reader migration for `asset-price-sync`.',
      'live backend readers no longer depend on `MarketPriceBinanceRepository`',
      'read paths consume `asset_price`',
      '`market_prices_binance` is no longer part of the active app read/write path',
    ],
    findings,
    'ASSET_PRICE_SYNC_PHASE4.md'
  );

  const readme = read('README.md');
  ensureMarkers(readme, ['ASSET_PRICE_SYNC_PHASE4.md', moduleTestCommand], findings, 'README.md');

  const repositorySource = read('src/database/repositories/AssetPriceRepository.ts');
  ensureMarkers(
    repositorySource,
    [
      'export interface AssetPriceLookupOptions',
      'getByBrokerAssetId',
      'getBySymbol(',
      'getBySymbols(',
      'pickPreferredRow',
      'listCandidateRows',
    ],
    findings,
    'AssetPriceRepository.ts'
  );

  const contractSource = read('src/api/contracts/MarketPrice.ts');
  if (!contractSource.includes('brokerAssetId?: string | null;')) {
    findings.push('MarketPrice.ts: missing additive brokerAssetId contract field');
  }

  for (const relativePath of [
    'src/api/services/BrokerReferenceDataService.ts',
    'src/api/services/BrokerPositionsFacadeService.ts',
    'src/api/services/InternalPositionsSyncService.ts',
    'src/api/services/PaperOrderExecutionService.ts',
    'src/api/services/MarketMetricsService.ts',
  ]) {
    const source = read(relativePath);
    if (source.includes('MarketPriceBinanceRepository')) {
      findings.push(`${relativePath}: should not depend on MarketPriceBinanceRepository in consolidated steady state`);
    }
  }

  ensureMarkers(
    read('src/api/services/BrokerReferenceDataService.ts'),
    [
      'AssetPriceRepository',
      "sources: ['mudrex', 'delta_exchange']",
      'exchangeAssetId: row.brokerAssetId',
      'brokerAssetId: row.brokerAssetId',
    ],
    findings,
    'BrokerReferenceDataService.ts'
  );

  ensureMarkers(
    read('src/api/services/BrokerPositionsFacadeService.ts'),
    ['AssetPriceRepository', "sources: ['mudrex']", 'this.assetPriceRepository.getBySymbols'],
    findings,
    'BrokerPositionsFacadeService.ts'
  );

  ensureMarkers(
    read('src/api/services/InternalPositionsSyncService.ts'),
    ['AssetPriceRepository', "sources: ['mudrex']", 'this.assetPriceRepository.getBySymbols'],
    findings,
    'InternalPositionsSyncService.ts'
  );

  ensureMarkers(
    read('src/api/services/PaperOrderExecutionService.ts'),
    [
      'AssetPriceRepository',
      'loadFallbackMarketPrices',
      'loadScopedMarketPrices',
      'resolvePriceSourceForBroker',
      'buildScopedSymbolKey',
    ],
    findings,
    'PaperOrderExecutionService.ts'
  );

  ensureMarkers(
    read('src/api/services/MarketMetricsService.ts'),
    ['AssetPriceRepository', 'this.assetPriceRepository.getBySymbols', "sources: ['mudrex', 'delta_exchange']"],
    findings,
    'MarketMetricsService.ts'
  );

  ensureAssetPricePackageWiring(read('package.json'), findings, 'package.json');
  assert.equal(findings.length, 0, `Asset price sync Phase 4 assertions failed:\n${findings.join('\n')}`);
}

async function runPhase5Assertions(): Promise<void> {
  const findings: string[] = [];
  const migration = new DropLegacyMarketPricesBinanceTable1770714000000();
  const executedQueries: string[] = [];
  let hasLegacyTable = true;
  let hasAssetPriceTable = true;
  let hasBrokerAssetsTable = true;

  await migration.up({
    async hasTable(tableName: string) {
      if (tableName === 'market_prices_binance') {
        return hasLegacyTable;
      }
      if (tableName === 'asset_price') {
        return hasAssetPriceTable;
      }
      if (tableName === 'broker_assets') {
        return hasBrokerAssetsTable;
      }
      return false;
    },
    async query(sql: string) {
      executedQueries.push(sql);
      if (sql.includes('DROP TABLE IF EXISTS market_prices_binance')) {
        hasLegacyTable = false;
      }
      return [];
    },
  } as any);

  assert.equal(hasLegacyTable, false);

  await migration.down({
    async hasTable(tableName: string) {
      if (tableName === 'market_prices_binance') {
        return hasLegacyTable;
      }
      if (tableName === 'asset_price') {
        return hasAssetPriceTable;
      }
      if (tableName === 'broker_assets') {
        return hasBrokerAssetsTable;
      }
      return false;
    },
    async query(sql: string) {
      executedQueries.push(sql);
      if (sql.includes('CREATE TABLE IF NOT EXISTS market_prices_binance')) {
        hasLegacyTable = true;
      }
      return [];
    },
  } as any);

  assert.equal(hasLegacyTable, true);

  const phaseDoc = read('ASSET_PRICE_SYNC_PHASE5.md');
  ensureMarkers(
    phaseDoc,
    [
      'Phase 5 performs the explicit legacy cleanup for `asset-price-sync`.',
      'the legacy `MarketPriceBinance` entity and repository are removed',
      '`asset_price` is the only active runtime storage model for this flow',
      '`market_prices_binance` is removed through a dedicated migration',
    ],
    findings,
    'ASSET_PRICE_SYNC_PHASE5.md'
  );

  const readme = read('README.md');
  ensureMarkers(readme, ['ASSET_PRICE_SYNC_PHASE5.md', moduleTestCommand], findings, 'README.md');

  const contractSource = read('src/api/utils/assetPriceContract.ts');
  if (contractSource.includes('ASSET_PRICE_SYNC_LEGACY_STORAGE_TABLE')) {
    findings.push('assetPriceContract.ts: legacy storage constant should be removed in steady state');
  }

  const assetPriceEntity = read('src/database/entities/AssetPrice.ts');
  if (!assetPriceEntity.includes('Steady-state storage for asset-price-sync.')) {
    findings.push('AssetPrice.ts: missing steady-state storage marker');
  }

  const dataSource = read('src/database/data-source.ts');
  if (dataSource.includes('MarketPriceBinance')) {
    findings.push('data-source.ts: should not register MarketPriceBinance in steady state');
  }

  if (read('src/database/entities/index.ts').includes('MarketPriceBinance')) {
    findings.push('entities/index.ts: should not export MarketPriceBinance');
  }
  if (read('src/database/repositories/index.ts').includes('MarketPriceBinanceRepository')) {
    findings.push('repositories/index.ts: should not export MarketPriceBinanceRepository');
  }

  if (fs.existsSync(path.join(process.cwd(), 'src/database/entities/MarketPriceBinance.ts'))) {
    findings.push('src/database/entities/MarketPriceBinance.ts: should be deleted');
  }
  if (fs.existsSync(path.join(process.cwd(), 'src/database/repositories/MarketPriceBinanceRepository.ts'))) {
    findings.push('src/database/repositories/MarketPriceBinanceRepository.ts: should be deleted');
  }

  ensureMarkers(
    read('src/database/migrations/1770714000000-DropLegacyMarketPricesBinanceTable.ts'),
    [
      'DropLegacyMarketPricesBinanceTable1770714000000',
      'asset_price must exist before dropping market_prices_binance',
      'INSERT INTO asset_price',
      'DROP TABLE IF EXISTS market_prices_binance',
      'CREATE TABLE IF NOT EXISTS market_prices_binance',
      'ROW_NUMBER() OVER',
    ],
    findings,
    'DropLegacyMarketPricesBinanceTable migration'
  );

  const activeSourceFiles = listTypeScriptFiles(path.join(process.cwd(), 'src')).filter(
    (absolutePath) => !absolutePath.includes(`${path.sep}migrations${path.sep}`)
  );
  for (const absolutePath of activeSourceFiles) {
    const source = fs.readFileSync(absolutePath, 'utf8');
    if (
      source.includes('MarketPriceBinance') ||
      source.includes('MarketPriceBinanceRepository') ||
      source.includes('market_prices_binance')
    ) {
      findings.push(
        `${path.relative(process.cwd(), absolutePath)}: active source should not reference legacy market price storage`
      );
    }
  }

  ensureAssetPricePackageWiring(read('package.json'), findings, 'package.json');
  assert.equal(findings.length, 0, `Asset price sync Phase 5 assertions failed:\n${findings.join('\n')}`);
}

async function runPhase6Assertions(): Promise<void> {
  const findings: string[] = [];
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
      throw new Error('Consolidated steady state must not use unscoped update-log purge preview');
    },
    async deleteOlderThanDays() {
      throw new Error('Consolidated steady state must not use unscoped update-log purge delete');
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
  assert.equal(configResponse.data.lastStartedAt, formatSchedulerDisplayTime(storedConfig.lastStartedAt, timeZone));
  assert.equal(configResponse.data.lastStartedAtIso, formatSchedulerRawIso(storedConfig.lastStartedAt));

  const runNowResponse = await service.runNow('admin-user-1');
  assert.equal(runNowResponse.data.scopeAssetsCount, 1);
  assert.equal(createdRunPayload.initiatedByType, 'manual');
  assert.equal(createdCommands[0].commandType, 'run_now');

  running = true;
  createdCommands.length = 0;
  const stopResponse = await service.stopScheduler('admin-user-1');
  assert.equal(stopResponse.data.commandIds?.length, 1);

  createdCommands.length = 0;
  const restartResponse = await service.restartScheduler('admin-user-1');
  assert.equal(restartResponse.data.commandIds?.length, 2);

  const runsResponse = await service.listSchedulerRuns('admin-user-1', {
    limit: '10',
    offset: '0',
  });
  assert.equal(runsResponse.data.items[0].startedAtIso, formatSchedulerRawIso(runDate));

  const progressResponse = await service.getSchedulerRunProgress('admin-user-1', 'run-1');
  assert.equal(progressResponse.data.run?.initiatedBy?.userId, 'admin-user-1');

  const updatesResponse = await service.listSchedulerRunUpdates('admin-user-1', 'run-1', {
    limit: '25',
    offset: '0',
    sortBy: 'createdAt',
    sortOrder: 'desc',
  });
  assert.equal(updatesResponse.data.items[0].createdAtIso, formatSchedulerRawIso(updateDate));

  const exportResponse = await service.exportSchedulerRunUpdates('admin-user-1', 'run-1', {});
  assert.equal(exportResponse.data.csv.includes('initiatedByType'), true);

  const purgePreviewResponse = await service.getSchedulerPurgePreview('admin-user-1');
  assert.equal(purgePreviewResponse.data.updateLogsToDelete, 7);
  assert.equal(purgePreviewCalls, 1);

  const purgeResponse = await service.purgeSchedulerLogs('admin-user-1');
  assert.equal(purgeResponse.data.updateLogsDeleted, 5);
  assert.equal(purgeDeleteCalls, 1);

  const phaseDoc = read('ASSET_PRICE_SYNC_PHASE6.md');
  ensureMarkers(
    phaseDoc,
    [
      'Phase 6 aligns the dedicated `asset-price-sync` backend operator contract with',
      'config responses expose localized display timestamps plus raw UTC ISO',
      'update logs and CSV export include initiator and execution-context data',
      'restart uses `stop_now` consistently before requeueing a fresh run',
    ],
    findings,
    'ASSET_PRICE_SYNC_PHASE6.md'
  );

  const readme = read('README.md');
  ensureMarkers(readme, ['ASSET_PRICE_SYNC_PHASE6.md', moduleTestCommand], findings, 'README.md');

  const serviceSource = read('src/api/services/AssetPriceSchedulerService.ts');
  ensureMarkers(
    serviceSource,
    [
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
    ],
    findings,
    'AssetPriceSchedulerService.ts'
  );

  ensureAssetPricePackageWiring(read('package.json'), findings, 'package.json');
  assert.equal(findings.length, 0, `Asset price sync Phase 6 assertions failed:\n${findings.join('\n')}`);
}

async function runPhase7Assertions(): Promise<void> {
  const findings: string[] = [];
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
      throw new Error('Consolidated runNow overrides should use selected asset ids');
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

  assert.equal(response.data.scopeAssetsCount, 2);
  assert.deepEqual(createdRunPayload.meta.scope.assets, ['asset-id-a', 'asset-id-b']);
  assert.deepEqual(createdCommands[0].payload.scope.assets, ['asset-id-a', 'asset-id-b']);

  const phaseDoc = read('ASSET_PRICE_SYNC_PHASE7.md');
  ensureMarkers(
    phaseDoc,
    [
      'Phase 7 completes the frontend/operator consumption handoff for',
      '`asset-price-sync`',
      'Mudrex and Delta Exchange',
      "sources: ['mudrex', 'delta_exchange']",
      'writes latest values by broker asset id',
      'focused frontend tests now guard the asset-price save/run payload contract',
      'The operator consumption layer is now frozen',
      'Carry-Forward For Phase 8',
    ],
    findings,
    'ASSET_PRICE_SYNC_PHASE7.md'
  );

  const readme = read('README.md');
  ensureMarkers(
    readme,
    ['ASSET_PRICE_SYNC_PHASE7.md', 'frontend/operator consumption handoff', moduleTestCommand],
    findings,
    'README.md'
  );

  const schedulersPage = readFrontend('src/pages/Schedulers/index.jsx');
  ensureMarkers(
    schedulersPage,
    [
      'Fetches latest prices for system broker assets from Mudrex and Delta Exchange.',
      "sources: ['mudrex', 'delta_exchange']",
    ],
    findings,
    'frontend Schedulers index.jsx'
  );

  const configSection = readFrontend('src/pages/Schedulers/components/SchedulerConfigSection.jsx');
  ensureMarkers(
    configSection,
    [
      'System sources: Mudrex + Delta Exchange. Writes latest values by broker asset id.',
      'All system broker assets covered by Mudrex and Delta Exchange will be included in asset price scope.',
    ],
    findings,
    'frontend SchedulerConfigSection.jsx'
  );

  const schedulersPageTest = readFrontend('src/pages/Schedulers/index.test.jsx');
  ensureMarkers(
    schedulersPageTest,
    [
      'saves asset-price-sync using Mudrex and Delta Exchange system sources',
      'tradingApi.updateSchedulerConfig',
      'runs asset-price-sync with Mudrex and Delta Exchange system sources',
      'tradingApi.runSchedulerNow',
      "sources: ['mudrex', 'delta_exchange']",
    ],
    findings,
    'frontend Schedulers index.test.jsx'
  );

  ensureAssetPricePackageWiring(read('package.json'), findings, 'package.json');
  assert.equal(findings.length, 0, `Asset price sync Phase 7 assertions failed:\n${findings.join('\n')}`);
}

async function runPhase8Assertions(): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'asset-price-sync-consolidated-'));
  const gateFile = path.join(tempDir, 'asset-price-sync-release-gate.json');
  const signoffFile = path.join(tempDir, 'asset-price-sync-signoff.json');
  const healthFile = path.join(tempDir, 'asset-price-sync-health.json');
  const proofFile = path.join(tempDir, 'asset-price-sync-live-proof.json');
  const evidenceFile = path.join(tempDir, 'asset-price-sync-deployment-evidence.json');
  const gateScript = path.join(tempDir, 'release-gate.stub.ts');
  const signoffScript = path.join(tempDir, 'signoff.stub.ts');

  const readyHealthSnapshot = {
    baseUrl: 'http://127.0.0.1:3102/api/v1',
    queueStatus: 'ok',
    queueName: 'scheduler.exchange-assets.execute',
    queueLatencyMs: 12,
    workerStatus: 'ok',
    workerHttpStatus: 'ok',
    workerHeartbeatAgeMs: 2100,
    schedulerKey: 'asset-price-sync',
    schedulerType: 'global',
    schedulerEnabled: true,
    schedulerTimezone: 'UTC',
    schedulerSources: ['mudrex', 'delta_exchange'],
    selectionMode: 'custom',
    selectedAssetIdsCount: 4,
    configLatencyMs: 40,
    assetsLatencyMs: 55,
    runsLatencyMs: 48,
    assetTotal: 4,
    assetCount: 4,
    assetFirstId: 'broker-asset-1',
    assetFirstSymbol: 'BTCUSDT',
    assetSourceSamples: ['mudrex', 'delta_exchange'],
    runTotal: 3,
    runCount: 3,
    latestRunId: 'run-1',
    latestRunStatus: 'Completed',
    latestRunExecutionContext: 'system',
    latestRunInitiatedByType: 'manual',
    latestRunScopeAssetsCount: 4,
    latestRunProgressPercent: 100,
    latestUpdateCount: 2,
    overviewCount: 4,
    overviewDisplayTimeZone: 'Asia/Kolkata',
    overviewLocalized: true,
    overviewStatus: 'Completed',
    overviewExecutionContext: 'system',
    overviewInitiatedByType: 'manual',
    overviewHasQueuedWork: false,
    configDisplayTimeZone: 'Asia/Kolkata',
    configLocalized: true,
    runsDisplayTimeZone: 'Asia/Kolkata',
    runsLocalized: true,
    progressDisplayTimeZone: 'Asia/Kolkata',
    progressLocalized: true,
    updatesDisplayTimeZone: 'Asia/Kolkata',
    updatesLocalized: true,
    thresholdProfile: {
      mode: 'bounded',
      configuredThresholdCount: 5,
      requiredThresholdCount: 5,
      configuredKeys: [
        'maxConfigLatencyMs',
        'maxAssetListLatencyMs',
        'maxRunListLatencyMs',
        'minAssetResults',
        'minRunResults',
      ],
      missingKeys: [],
    },
  };

  const readyGateSummary = {
    decision: 'ready',
    generatedAt: '2026-04-10T12:00:00.000Z',
    liveChecksEnabled: true,
    healthSnapshotFile: path.resolve(process.cwd(), healthFile),
    healthSnapshot: readyHealthSnapshot,
    totals: {
      total: 8,
      passed: 8,
      failed: 0,
      skipped: 0,
    },
    results: [
      releaseGateSuiteKey,
      'backend-asset-price-sync-global-regression',
      'backend-asset-price-sync-operational-audit',
      'backend-asset-price-sync-eslint',
      'worker-asset-price-sync-build',
      'frontend-asset-price-sync-ui',
      'frontend-asset-price-sync-eslint',
      'backend-asset-price-sync-live-health',
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
      crossRepoSuitesPassed: true,
      liveHealthReviewed: true,
      liveProofReviewed: true,
      thresholdPostureCaptured: true,
      operatorWorkspaceReviewed: true,
      runScopeOverrideReviewed: true,
      brokerAssetIdReviewed: true,
      systemSourcesReviewed: true,
      timeAuditReviewed: true,
      placeholderEvidenceAcknowledged: true,
      unboundedThresholdsAcknowledged: true,
    },
    readiness: {
      deploymentEvidenceReady: true,
      thresholdProfileMode: 'bounded',
      liveGateReady: true,
      liveProofReady: false,
      crossRepoProofReady: true,
      productionPromotionReady: true,
    },
    acknowledgements: {
      placeholderEvidenceUsed: false,
      unboundedThresholdsUsed: false,
    },
    thresholdProfile: readyHealthSnapshot.thresholdProfile,
    evidence: {
      stagingWorkflowUrl: 'https://example.com/workflows/asset-price-sync',
      dashboardUrl: 'https://example.com/dashboards/asset-price-sync',
      runbookUrl: 'https://example.com/runbooks/asset-price-sync',
      releaseNoteUrl: 'https://example.com/releases/asset-price-sync',
    },
    evidenceClassification: {
      stagingWorkflowUrlKind: 'remote_url',
      dashboardUrlKind: 'remote_url',
      runbookUrlKind: 'remote_url',
      releaseNoteUrlKind: 'remote_url',
    },
    environment: {
      requireLiveHealth: true,
      requireLiveProof: false,
      requireDeploymentEvidence: false,
    },
  };

  await writeFile(
    gateScript,
    `import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const outputFile = path.resolve(process.cwd(), String(process.env.ASSET_PRICE_SYNC_RELEASE_GATE_OUTPUT_FILE || '').trim());
const healthFile = path.resolve(process.cwd(), String(process.env.ASSET_PRICE_SYNC_HEALTH_OUTPUT_FILE || '').trim());

async function run(): Promise<void> {
  assert.equal(process.env.ASSET_PRICE_SYNC_RUN_LIVE_CHECKS, 'true');
  assert.ok(outputFile, 'ASSET_PRICE_SYNC_RELEASE_GATE_OUTPUT_FILE must be provided');
  assert.ok(healthFile, 'ASSET_PRICE_SYNC_HEALTH_OUTPUT_FILE must be provided');
  await mkdir(path.dirname(outputFile), { recursive: true });
  await mkdir(path.dirname(healthFile), { recursive: true });
  const health = ${JSON.stringify(readyHealthSnapshot, null, 2)};
  const summary = ${JSON.stringify(readyGateSummary, null, 2)};
  await writeFile(healthFile, \`\${JSON.stringify(health, null, 2)}\\n\`, 'utf8');
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

const gateFile = path.resolve(process.cwd(), String(process.env.ASSET_PRICE_SYNC_SIGNOFF_GATE_FILE || '').trim());
const outputFile = path.resolve(process.cwd(), String(process.env.ASSET_PRICE_SYNC_SIGNOFF_OUTPUT_FILE || '').trim());

async function run(): Promise<void> {
  assert.equal(process.env.ASSET_PRICE_SYNC_SIGNOFF_REQUIRE_LIVE_HEALTH, 'true');
  assert.equal(process.env.ASSET_PRICE_SYNC_SIGNOFF_REQUIRE_LIVE_PROOF, 'false');
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

  const exitCode = await runCommand(
    process.execPath,
    ['--import', 'tsx', 'scripts/proofs/proof-asset-price-sync-live.ts'],
    {
      ...process.env,
      ASSET_PRICE_SYNC_PROOF_RELEASE_GATE_SCRIPT: gateScript,
      ASSET_PRICE_SYNC_PROOF_SIGNOFF_SCRIPT: signoffScript,
      ASSET_PRICE_SYNC_RELEASE_GATE_OUTPUT_FILE: gateFile,
      ASSET_PRICE_SYNC_SIGNOFF_OUTPUT_FILE: signoffFile,
      ASSET_PRICE_SYNC_HEALTH_OUTPUT_FILE: healthFile,
      ASSET_PRICE_SYNC_PROOF_OUTPUT_FILE: proofFile,
      ASSET_PRICE_SYNC_EVIDENCE_OUTPUT_FILE: evidenceFile,
      ASSET_PRICE_SYNC_SIGNOFF_APPROVER: 'codex-phase8',
      ASSET_PRICE_SYNC_SIGNOFF_OPERATOR_WORKSPACE_REVIEWED: 'true',
      ASSET_PRICE_SYNC_SIGNOFF_RUN_SCOPE_OVERRIDE_REVIEWED: 'true',
      ASSET_PRICE_SYNC_SIGNOFF_BROKER_ASSET_ID_REVIEWED: 'true',
      ASSET_PRICE_SYNC_SIGNOFF_SYSTEM_SOURCES_REVIEWED: 'true',
      ASSET_PRICE_SYNC_SIGNOFF_TIME_AUDIT_REVIEWED: 'true',
    }
  );

  assert.equal(exitCode, 0);

  const rawProof = await readFile(proofFile, 'utf8');
  const summary = JSON.parse(rawProof) as JsonRecord;
  assert.equal(summary.decision, 'ready');
  assert.equal(summary.approver, 'codex-phase8');

  const rawEvidence = await readFile(evidenceFile, 'utf8');
  const evidenceSummary = JSON.parse(rawEvidence) as JsonRecord;
  assert.equal(evidenceSummary.decision, 'ready');

  const healthSource = await readFile(
    path.join(process.cwd(), 'scripts', 'checks', 'check-asset-price-sync-health.ts'),
    'utf8'
  );
  const releaseGateSource = await readFile(
    path.join(process.cwd(), 'scripts', 'release-gates', 'release-gate-asset-price-sync.ts'),
    'utf8'
  );
  const signoffSource = await readFile(
    path.join(process.cwd(), 'scripts', 'signoffs', 'signoff-asset-price-sync.ts'),
    'utf8'
  );
  const proofSource = await readFile(
    path.join(process.cwd(), 'scripts', 'proofs', 'proof-asset-price-sync-live.ts'),
    'utf8'
  );
  const operationalAuditSource = await readFile(
    path.join(process.cwd(), 'scripts', 'test-operational-audit.ts'),
    'utf8'
  );
  const packageSource = await readFile(path.join(process.cwd(), 'package.json'), 'utf8');
  const phaseDoc = await readFile(path.join(process.cwd(), 'ASSET_PRICE_SYNC_PHASE8.md'), 'utf8');
  const previousPhaseDoc = await readFile(
    path.join(process.cwd(), 'ASSET_PRICE_SYNC_PHASE7.md'),
    'utf8'
  );
  const readmeSource = await readFile(path.join(process.cwd(), 'README.md'), 'utf8');

  assert.equal(healthSource.includes('/scheduler/asset-price/config'), true);
  assert.equal(healthSource.includes('/scheduler/asset-price/assets'), true);
  assert.equal(healthSource.includes('delta_exchange'), true);
  assert.equal(releaseGateSource.includes(releaseGateSuiteKey), true);
  assert.equal(releaseGateSource.includes('frontend-asset-price-sync-ui'), true);
  assert.equal(releaseGateSource.includes('worker-asset-price-sync-build'), true);
  assert.equal(signoffSource.includes('ASSET_PRICE_SYNC_SIGNOFF_BROKER_ASSET_ID_REVIEWED'), true);
  assert.equal(signoffSource.includes(releaseGateSuiteKey), true);
  assert.equal(proofSource.includes('artifacts/asset-price-sync-deployment-evidence.json'), true);
  assert.equal(operationalAuditSource.includes('"proof:asset-price-sync-live"'), true);
  assert.equal(packageSource.includes(`"${moduleTestCommand}"`), true);
  assert.equal(packageSource.includes('"check:asset-price-sync-health"'), true);
  assert.equal(
    phaseDoc.includes(
      'Phase 8 closes the operational proof gap after the Phase 7 frontend/operator freeze.'
    ),
    true
  );
  assert.equal(phaseDoc.includes('## 4) Carry-Forward For Phase 9'), true);
  assert.equal(previousPhaseDoc.includes('ASSET_PRICE_SYNC_PHASE8.md'), true);
  assert.equal(readmeSource.includes('proof:asset-price-sync-live'), true);
}

async function runPhase9Assertions(): Promise<void> {
  const packageSource = await readFile(path.join(process.cwd(), 'package.json'), 'utf8');
  const readmeSource = await readFile(path.join(process.cwd(), 'README.md'), 'utf8');
  const phase8Doc = await readFile(
    path.join(process.cwd(), 'ASSET_PRICE_SYNC_PHASE8.md'),
    'utf8'
  );
  const phase9Doc = await readFile(
    path.join(process.cwd(), 'ASSET_PRICE_SYNC_PHASE9.md'),
    'utf8'
  );
  const captureSource = await readFile(
    path.join(process.cwd(), 'scripts', 'capture', 'capture-asset-price-sync-evidence.ts'),
    'utf8'
  );
  const releaseGateSource = await readFile(
    path.join(process.cwd(), 'scripts', 'release-gates', 'release-gate-asset-price-sync.ts'),
    'utf8'
  );
  const signoffSource = await readFile(
    path.join(process.cwd(), 'scripts', 'signoffs', 'signoff-asset-price-sync.ts'),
    'utf8'
  );
  const proofSource = await readFile(
    path.join(process.cwd(), 'scripts', 'proofs', 'proof-asset-price-sync-live.ts'),
    'utf8'
  );

  assert.equal(packageSource.includes('"capture:asset-price-sync-evidence"'), true);
  assert.equal(packageSource.includes(`"${moduleTestCommand}"`), true);
  assert.equal(readmeSource.includes('ASSET_PRICE_SYNC_PHASE9.md'), true);
  assert.equal(readmeSource.includes('capture:asset-price-sync-evidence'), true);
  assert.equal(phase8Doc.includes('## 4) Carry-Forward For Phase 9'), true);
  assert.equal(phase9Doc.includes('npm run capture:asset-price-sync-evidence'), true);
  assert.equal(phase9Doc.includes('npm run proof:asset-price-sync-live'), true);
  assert.equal(phase9Doc.includes('bounded thresholds'), true);
  assert.equal(captureSource.includes('artifacts/asset-price-sync-workflow-evidence.json'), true);
  assert.equal(captureSource.includes('artifacts/asset-price-sync-dashboard-evidence.json'), true);
  assert.equal(captureSource.includes('/scheduler/asset-price/assets'), true);
  assert.equal(captureSource.includes('/scheduler/overview'), true);
  assert.equal(releaseGateSource.includes(releaseGateSuiteKey), true);
  assert.equal(releaseGateSource.includes('scripts/capture/capture-asset-price-sync-evidence.ts'), true);
  assert.equal(signoffSource.includes('ASSET_PRICE_SYNC_SIGNOFF_REQUIRE_DEPLOYMENT_EVIDENCE'), true);
  assert.equal(signoffSource.includes('deploymentEvidenceReady'), true);
  assert.equal(
    signoffSource.includes(
      'const proof = REQUIRE_LIVE_PROOF ? await readOptionalProofSummary() : null;'
    ),
    true
  );
  assert.equal(proofSource.includes('ASSET_PRICE_SYNC_SIGNOFF_REQUIRE_DEPLOYMENT_EVIDENCE'), true);
  assert.equal(proofSource.includes('deploymentPromotionReady'), true);
}

async function main(): Promise<void> {
  runPhase1Assertions();
  await runPhase2Assertions();
  await runPhase3Assertions();
  await runPhase4Assertions();
  await runPhase5Assertions();
  await runPhase6Assertions();
  await runPhase7Assertions();
  await runPhase8Assertions();
  await runPhase9Assertions();
  console.log('Asset price sync assertions passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
