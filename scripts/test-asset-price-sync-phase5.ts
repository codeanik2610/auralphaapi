import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DropLegacyMarketPricesBinanceTable1770714000000 } from '../src/database/migrations/1770714000000-DropLegacyMarketPricesBinanceTable';

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
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

async function runMigrationAssertions(): Promise<void> {
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
  assert.equal(
    executedQueries.some(
      (sql) =>
        sql.includes('INSERT INTO asset_price') &&
        sql.includes('FROM market_prices_binance mp') &&
        sql.includes('INNER JOIN broker_assets ba')
    ),
    true
  );
  assert.equal(
    executedQueries.some((sql) => sql.includes('DROP TABLE IF EXISTS market_prices_binance')),
    true
  );

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
  assert.equal(
    executedQueries.some(
      (sql) =>
        sql.includes('CREATE TABLE IF NOT EXISTS market_prices_binance') &&
        sql.includes('exchange_asset_id varchar(64) NULL')
    ),
    true
  );
  assert.equal(
    executedQueries.some(
      (sql) =>
        sql.includes('INSERT INTO market_prices_binance') &&
        sql.includes('ROW_NUMBER() OVER') &&
        sql.includes('FROM asset_price ap')
    ),
    true
  );
}

async function run(): Promise<void> {
  const findings: string[] = [];

  await runMigrationAssertions();

  const phaseDoc = read('ASSET_PRICE_SYNC_PHASE5.md');
  for (const marker of [
    'Phase 5 performs the explicit legacy cleanup for `asset-price-sync`.',
    'the legacy `MarketPriceBinance` entity and repository are removed',
    '`asset_price` is the only active runtime storage model for this flow',
    '`market_prices_binance` is removed through a dedicated migration',
  ]) {
    if (!phaseDoc.includes(marker)) {
      findings.push(`ASSET_PRICE_SYNC_PHASE5.md: missing Phase 5 marker ${marker}`);
    }
  }

  const readme = read('README.md');
  if (!readme.includes('ASSET_PRICE_SYNC_PHASE5.md')) {
    findings.push('README.md: missing asset-price-sync Phase 5 baseline link');
  }
  if (!readme.includes('test:asset-price-sync-phase5')) {
    findings.push('README.md: missing asset-price-sync Phase 5 verification command');
  }

  const packageSource = read('package.json');
  if (!packageSource.includes('"test:asset-price-sync-phase5"')) {
    findings.push('package.json: missing asset-price-sync Phase 5 test script');
  }
  if (!packageSource.includes('npm run test:asset-price-sync-phase5')) {
    findings.push('package.json: asset-price-sync Phase 5 guard must stay wired');
  }

  const contractSource = read('src/api/utils/assetPriceContract.ts');
  if (contractSource.includes('ASSET_PRICE_SYNC_LEGACY_STORAGE_TABLE')) {
    findings.push('assetPriceContract.ts: legacy storage constant should be removed in Phase 5');
  }

  const assetPriceEntity = read('src/database/entities/AssetPrice.ts');
  if (!assetPriceEntity.includes('Steady-state storage for asset-price-sync.')) {
    findings.push('AssetPrice.ts: missing Phase 5 steady-state storage marker');
  }

  const dataSource = read('src/database/data-source.ts');
  if (dataSource.includes('MarketPriceBinance')) {
    findings.push('data-source.ts: should not register MarketPriceBinance in Phase 5');
  }

  const entityIndex = read('src/database/entities/index.ts');
  if (entityIndex.includes('MarketPriceBinance')) {
    findings.push('entities/index.ts: should not export MarketPriceBinance in Phase 5');
  }

  const repositoryIndex = read('src/database/repositories/index.ts');
  if (repositoryIndex.includes('MarketPriceBinanceRepository')) {
    findings.push('repositories/index.ts: should not export MarketPriceBinanceRepository in Phase 5');
  }

  if (fs.existsSync(path.join(process.cwd(), 'src/database/entities/MarketPriceBinance.ts'))) {
    findings.push('src/database/entities/MarketPriceBinance.ts: should be deleted in Phase 5');
  }
  if (
    fs.existsSync(path.join(process.cwd(), 'src/database/repositories/MarketPriceBinanceRepository.ts'))
  ) {
    findings.push(
      'src/database/repositories/MarketPriceBinanceRepository.ts: should be deleted in Phase 5'
    );
  }

  const migrationSource = read(
    'src/database/migrations/1770714000000-DropLegacyMarketPricesBinanceTable.ts'
  );
  for (const marker of [
    'DropLegacyMarketPricesBinanceTable1770714000000',
    'asset_price must exist before dropping market_prices_binance',
    'INSERT INTO asset_price',
    'DROP TABLE IF EXISTS market_prices_binance',
    'CREATE TABLE IF NOT EXISTS market_prices_binance',
    'ROW_NUMBER() OVER',
  ]) {
    if (!migrationSource.includes(marker)) {
      findings.push(`DropLegacyMarketPricesBinanceTable migration: missing marker ${marker}`);
    }
  }

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
        `${path.relative(process.cwd(), absolutePath)}: active source should not reference legacy market price storage in Phase 5`
      );
    }
  }

  assert.equal(
    findings.length,
    0,
    `Asset price sync Phase 5 guard failed:\n${findings.join('\n')}`
  );
  console.log('Asset price sync Phase 5 guard passed.');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
