import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DropBrokerAssetLegacyUserOwnership1770709000000 } from '../src/database/migrations/1770709000000-DropBrokerAssetLegacyUserOwnership';

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

async function runMigrationAssertions(): Promise<void> {
  const migration = new DropBrokerAssetLegacyUserOwnership1770709000000();
  const executedQueries: string[] = [];
  const indexes = new Set([
    'uq_exchange_assets_user_source_symbol',
    'idx_exchange_assets_user_symbol_name',
    'idx_exchange_assets_user_broker_id',
    'idx_exchange_assets_user_exchange_id',
  ]);
  let hasUserId = true;

  await migration.up({
    async hasTable(tableName: string) {
      return tableName === 'broker_assets';
    },
    async hasColumn(tableName: string, columnName: string) {
      return tableName === 'broker_assets' && columnName === 'user_id' ? hasUserId : false;
    },
    async query(sql: string, params?: unknown[]) {
      executedQueries.push(sql);

      if (sql.includes('SHOW INDEX FROM broker_assets WHERE Key_name = ?')) {
        const indexName = String(params?.[0] || '');
        return indexes.has(indexName) ? [{ Key_name: indexName }] : [];
      }

      if (sql.includes('ALTER TABLE broker_assets DROP INDEX')) {
        const match = sql.match(/DROP INDEX ([A-Za-z0-9_]+)/);
        if (match?.[1]) {
          indexes.delete(match[1]);
        }
        return [];
      }

      if (
        sql.includes('CREATE UNIQUE INDEX') ||
        sql.includes('CREATE INDEX')
      ) {
        const match = sql.match(/INDEX ([A-Za-z0-9_]+) ON/);
        if (match?.[1]) {
          indexes.add(match[1]);
        }
        return [];
      }

      if (sql.includes('ALTER TABLE broker_assets DROP COLUMN user_id')) {
        hasUserId = false;
        return [];
      }

      if (sql.includes('ALTER TABLE broker_assets ADD COLUMN user_id')) {
        hasUserId = true;
        return [];
      }

      return [];
    },
  } as any);

  assert.equal(
    executedQueries.some(
      (sql) =>
        sql.includes('INSERT INTO broker_assets') &&
        sql.includes('WHERE user_id IS NOT NULL')
    ),
    true
  );
  assert.equal(
    executedQueries.some((sql) => sql.includes('DELETE FROM broker_assets WHERE user_id IS NOT NULL')),
    true
  );
  assert.equal(
    executedQueries.some((sql) => sql.includes('ALTER TABLE broker_assets DROP COLUMN user_id')),
    true
  );
  assert.equal(indexes.has('uq_broker_assets_source_symbol'), true);
  assert.equal(indexes.has('idx_broker_assets_source_symbol_name'), true);
  assert.equal(indexes.has('idx_broker_assets_broker_id'), true);
  assert.equal(indexes.has('idx_broker_assets_source_external_id'), true);
  assert.equal(indexes.has('idx_broker_assets_source_asset_id'), true);
  assert.equal(indexes.has('uq_exchange_assets_user_source_symbol'), false);

  const downIndexes = new Set([
    'uq_broker_assets_source_symbol',
    'idx_broker_assets_source_symbol_name',
    'idx_broker_assets_broker_id',
    'idx_broker_assets_source_external_id',
    'idx_broker_assets_source_asset_id',
  ]);
  let downHasUserId = false;

  await migration.down({
    async hasTable(tableName: string) {
      return tableName === 'broker_assets';
    },
    async hasColumn(tableName: string, columnName: string) {
      return tableName === 'broker_assets' && columnName === 'user_id' ? downHasUserId : false;
    },
    async query(sql: string, params?: unknown[]) {
      if (sql.includes('SHOW INDEX FROM broker_assets WHERE Key_name = ?')) {
        const indexName = String(params?.[0] || '');
        return downIndexes.has(indexName) ? [{ Key_name: indexName }] : [];
      }

      if (sql.includes('ALTER TABLE broker_assets DROP INDEX')) {
        const match = sql.match(/DROP INDEX ([A-Za-z0-9_]+)/);
        if (match?.[1]) {
          downIndexes.delete(match[1]);
        }
        return [];
      }

      if (
        sql.includes('CREATE UNIQUE INDEX') ||
        sql.includes('CREATE INDEX')
      ) {
        const match = sql.match(/INDEX ([A-Za-z0-9_]+) ON/);
        if (match?.[1]) {
          downIndexes.add(match[1]);
        }
        return [];
      }

      if (sql.includes('ALTER TABLE broker_assets ADD COLUMN user_id')) {
        downHasUserId = true;
      }

      return [];
    },
  } as any);

  assert.equal(downHasUserId, true);
  assert.equal(downIndexes.has('uq_broker_assets_user_source_symbol'), true);
  assert.equal(downIndexes.has('idx_broker_assets_user_symbol_name'), true);
}

async function run(): Promise<void> {
  const findings: string[] = [];

  const phaseDoc = read('BROKER_ASSETS_PHASE4.md');
  for (const marker of [
    'Phase 4 removes the last legacy user-ownership schema from `broker_assets`.',
    '`broker_assets.user_id` is dropped.',
    'Global broker-assets constraints now describe the table correctly:',
    '`ExchangeAssetRepository` no longer exposes the legacy user-scoped read or',
    '## Phase 5 Entry Checklist',
  ]) {
    if (!phaseDoc.includes(marker)) {
      findings.push(`BROKER_ASSETS_PHASE4.md: missing Phase 4 marker ${marker}`);
    }
  }

  const readme = read('README.md');
  if (!readme.includes('BROKER_ASSETS_PHASE4.md')) {
    findings.push('README.md: missing broker assets Phase 4 reference');
  }

  const entitySource = read('src/database/entities/ExchangeAsset.ts');
  for (const marker of [
    'Phase 4 schema cleanup',
    "@Unique('uq_broker_assets_source_symbol'",
    "@Index('idx_broker_assets_source_external_id'",
    "@Index('idx_broker_assets_source_asset_id'",
  ]) {
    if (!entitySource.includes(marker)) {
      findings.push(`ExchangeAsset.ts: missing Phase 4 entity marker ${marker}`);
    }
  }
  if (entitySource.includes("name: 'user_id'")) {
    findings.push('ExchangeAsset.ts: legacy user_id column should be removed in Phase 4');
  }

  const repositorySource = read('src/database/repositories/ExchangeAssetRepository.ts');
  for (const marker of [
    'Phase 4 schema cleanup',
    'async replaceSystemAssets(',
    'async listVisibleAssetsForUser(',
    'async countVisibleAssetsForUser(',
  ]) {
    if (!repositorySource.includes(marker)) {
      findings.push(`ExchangeAssetRepository.ts: missing Phase 4 repository marker ${marker}`);
    }
  }
  for (const removedMarker of [
    'async upsertAssets(',
    'async getAssetBySourceAndExternalId(',
    'async getAssetBySourceAndAssetId(',
    'async getAssetBySourceAndSymbol(',
    'async listAssets(',
    'async listAssetsBySourceAndSymbols(',
    'userId: string | null;',
  ]) {
    if (repositorySource.includes(removedMarker)) {
      findings.push(`ExchangeAssetRepository.ts: legacy marker should be removed in Phase 4: ${removedMarker}`);
    }
  }

  const migrationSource = read('src/database/migrations/1770709000000-DropBrokerAssetLegacyUserOwnership.ts');
  for (const marker of [
    'DropBrokerAssetLegacyUserOwnership1770709000000',
    'legacyIndexNames',
    'globalIndexes',
    'ROW_NUMBER() OVER',
  ]) {
    if (!migrationSource.includes(marker)) {
      findings.push(`DropBrokerAssetLegacyUserOwnership migration: missing marker ${marker}`);
    }
  }

  const packageSource = read('package.json');
  if (!packageSource.includes('"test:broker-assets-phase4"')) {
    findings.push('package.json: missing broker assets Phase 4 test script');
  }
  if (
    !packageSource.includes('npm run test:broker-assets-phase4') &&
    !packageSource.includes('npm run test:broker-assets')
  ) {
    findings.push('package.json: Phase 4 history guard must stay wired directly or via the stable broker-assets umbrella');
  }

  await runMigrationAssertions();

  assert.equal(findings.length, 0, `Broker assets Phase 4 guard failed:\n${findings.join('\n')}`);
  console.log('Broker assets Phase 4 guard passed.');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
