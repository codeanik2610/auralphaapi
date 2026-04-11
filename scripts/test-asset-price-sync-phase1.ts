import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function run(): void {
  const findings: string[] = [];

  const phaseDoc = read('ASSET_PRICE_SYNC_PHASE1.md');
  for (const marker of [
    '`asset-price-sync`',
    '`asset_price`',
    '`market_prices_binance`',
    '`broker_assets.id`',
    'Phase 1 does not change scheduler execution behavior.',
    'Phase 2 must introduce the `asset_price` schema and storage migration path.',
    'Phase 3 must switch writer paths from the legacy table to `asset_price`.',
  ]) {
    if (!phaseDoc.includes(marker)) {
      findings.push(`ASSET_PRICE_SYNC_PHASE1.md: missing contract marker ${marker}`);
    }
  }

  const checklist = read('ASSET_PRICE_SYNC_FUNCTIONAL_CHECKLIST.md');
  for (const marker of [
    'Storage target table: `asset_price`',
    'Legacy table to retire from this flow: `market_prices_binance`',
    '`selectedAssetIds` refer to `broker_assets.id` values.',
    '`broker_asset_id` is the primary or uniqueness anchor for upsert behavior.',
  ]) {
    if (!checklist.includes(marker)) {
      findings.push(`ASSET_PRICE_SYNC_FUNCTIONAL_CHECKLIST.md: missing marker ${marker}`);
    }
  }

  const readme = read('README.md');
  if (!readme.includes('ASSET_PRICE_SYNC_PHASE1.md')) {
    findings.push('README.md: missing asset-price-sync Phase 1 baseline link');
  }
  if (!readme.includes('test:asset-price-sync-phase1')) {
    findings.push('README.md: missing asset-price-sync Phase 1 verification command');
  }
  if (!readme.includes('frozen Phase 1 contract for `asset-price-sync`')) {
    findings.push('README.md: missing asset-price-sync Phase 1 baseline summary');
  }

  const contractSource = read('src/api/utils/assetPriceContract.ts');
  for (const marker of [
    "export const ASSET_PRICE_SYNC_SCHEDULER_KEY = 'asset-price-sync';",
    "export const ASSET_PRICE_SYNC_SCHEDULER_OWNERSHIP = 'global' as const;",
    "export const ASSET_PRICE_SYNC_SCOPE_SOURCE_TABLE = 'broker_assets';",
    "export const ASSET_PRICE_SYNC_TARGET_STORAGE_TABLE = 'asset_price';",
    'export const ASSET_PRICE_SYNC_DEFAULT_CONFIG = {',
  ]) {
    if (!contractSource.includes(marker)) {
      findings.push(`assetPriceContract.ts: missing Phase 1 marker ${marker}`);
    }
  }

  const serviceSource = read('src/api/services/AssetPriceSchedulerService.ts');
  for (const marker of [
    "from '../utils/assetPriceContract';",
    'ASSET_PRICE_SYNC_SCHEDULER_KEY',
    'ASSET_PRICE_SYNC_SCHEDULER_NAME',
    'ASSET_PRICE_SYNC_SCHEDULER_OWNERSHIP',
    'ASSET_PRICE_SYNC_DEFAULT_CONFIG',
    'ASSET_PRICE_SYNC_SYSTEM_SOURCES',
    'ASSET_PRICE_SYNC_ALLOWED_SELECTION_MODES',
  ]) {
    if (!serviceSource.includes(marker)) {
      findings.push(`AssetPriceSchedulerService.ts: missing Phase 1 marker ${marker}`);
    }
  }

  const schedulerOverviewSource = read('src/api/services/SchedulerOverviewService.ts');
  if (!schedulerOverviewSource.includes("'asset-price-sync'")) {
    findings.push(
      'SchedulerOverviewService.ts: asset-price-sync must remain in the system-owned scheduler set'
    );
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
  for (const marker of ["'asset-price-sync'", "['asset-price-sync', 'Asset Price Sync']"]) {
    if (!regressionSource.includes(marker)) {
      findings.push(`test-global-system-schedulers.ts: missing asset-price-sync marker ${marker}`);
    }
  }

  const packageSource = read('package.json');
  if (!packageSource.includes('"test:asset-price-sync-phase1"')) {
    findings.push('package.json: missing asset-price-sync Phase 1 test script');
  }
  if (!packageSource.includes('npm run test:asset-price-sync-phase1')) {
    findings.push('package.json: asset-price-sync Phase 1 guard must stay wired');
  }

  assert.equal(
    findings.length,
    0,
    `Asset price sync Phase 1 guard failed:\n${findings.join('\n')}`
  );
  console.log('Asset price sync Phase 1 guard passed.');
}

run();
