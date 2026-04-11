import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { CreateAssetPriceTable1770713000000 } from '../src/database/migrations/1770713000000-CreateAssetPriceTable';

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

async function runMigrationAssertions(): Promise<void> {
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
  assert.equal(
    executedQueries.some((sql) => sql.includes('DROP TABLE IF EXISTS asset_price')),
    true
  );
}

async function run(): Promise<void> {
  const findings: string[] = [];

  await runMigrationAssertions();

  const phaseDoc = read('ASSET_PRICE_SYNC_PHASE2.md');
  for (const marker of [
    'Phase 2 introduces the schema foundation for the `asset-price-sync` cutover.',
    '`asset_price` exists as the target storage table',
    '`broker_asset_id` is the schema anchor for price rows',
    'Phase 2 does not perform risky symbol-only remapping.',
    'Phase 3 must switch writer paths away from `market_prices_binance`',
  ]) {
    if (!phaseDoc.includes(marker)) {
      findings.push(`ASSET_PRICE_SYNC_PHASE2.md: missing Phase 2 marker ${marker}`);
    }
  }

  const readme = read('README.md');
  if (!readme.includes('ASSET_PRICE_SYNC_PHASE2.md')) {
    findings.push('README.md: missing asset-price-sync Phase 2 baseline link');
  }
  if (!readme.includes('test:asset-price-sync-phase2')) {
    findings.push('README.md: missing asset-price-sync Phase 2 verification command');
  }

  const entitySource = read('src/database/entities/AssetPrice.ts');
  for (const marker of [
    'Phase 2 schema foundation for asset-price-sync',
    "@Entity({ name: 'asset_price' })",
    "@PrimaryColumn({ name: 'broker_asset_id'",
    "@Index('idx_asset_price_source_symbol'",
  ]) {
    if (!entitySource.includes(marker)) {
      findings.push(`AssetPrice.ts: missing Phase 2 entity marker ${marker}`);
    }
  }

  const dataSource = read('src/database/data-source.ts');
  for (const marker of [
    "import { AssetPrice } from './entities/AssetPrice';",
    'AssetPrice, Asset, ExchangeAsset',
  ]) {
    if (!dataSource.includes(marker)) {
      findings.push(`data-source.ts: missing Phase 2 marker ${marker}`);
    }
  }

  const migrationSource = read(
    'src/database/migrations/1770713000000-CreateAssetPriceTable.ts'
  );
  for (const marker of [
    'CreateAssetPriceTable1770713000000',
    'CREATE TABLE IF NOT EXISTS asset_price',
    'broker_asset_id char(36) NOT NULL',
    'FROM market_prices_binance mp',
    'INNER JOIN broker_assets ba',
    'ba.id = mp.exchange_asset_id',
  ]) {
    if (!migrationSource.includes(marker)) {
      findings.push(`CreateAssetPriceTable migration: missing marker ${marker}`);
    }
  }

  const packageSource = read('package.json');
  if (!packageSource.includes('"test:asset-price-sync-phase2"')) {
    findings.push('package.json: missing asset-price-sync Phase 2 test script');
  }
  if (!packageSource.includes('npm run test:asset-price-sync-phase2')) {
    findings.push('package.json: asset-price-sync Phase 2 guard must stay wired');
  }

  assert.equal(
    findings.length,
    0,
    `Asset price sync Phase 2 guard failed:\n${findings.join('\n')}`
  );
  console.log('Asset price sync Phase 2 guard passed.');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
