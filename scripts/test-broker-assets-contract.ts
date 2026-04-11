import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function parsePackageJson(): {
  scripts: Record<string, string>;
} {
  return JSON.parse(read('package.json')) as {
    scripts: Record<string, string>;
  };
}

async function run(): Promise<void> {
  const findings: string[] = [];

  const phaseDoc = read('BROKER_ASSETS_PHASE5.md');
  for (const marker of [
    'Phase 5 promotes `broker_assets` from a schema-transition rollout to a',
    '- `broker_assets` is the global provider or exchange catalog.',
    '- User visibility is derived from owned `connections` and active',
    '- Delta order product lookup resolves against the global `delta_exchange`',
    '- `(source, externalId)` and `(source, assetId)` remain lookup indexes, not',
    '## Stable Guardrails',
    '## Naming Policy',
    '## Phase 6 Entry Checklist',
  ]) {
    if (!phaseDoc.includes(marker)) {
      findings.push(`BROKER_ASSETS_PHASE5.md: missing Phase 5 marker ${marker}`);
    }
  }

  const phase4Doc = read('BROKER_ASSETS_PHASE4.md');
  if (!phase4Doc.includes('BROKER_ASSETS_PHASE5.md')) {
    findings.push('BROKER_ASSETS_PHASE4.md: missing Phase 5 handoff');
  }

  const readme = read('README.md');
  if (!readme.includes('BROKER_ASSETS_PHASE5.md')) {
    findings.push('README.md: missing broker-assets Phase 5 steady-state reference');
  }
  if (!readme.includes('keyed by provider `source`, with optional broker-master linkage')) {
    findings.push('README.md: broker_assets ownership wording should describe the steady-state model');
  }

  const entitySource = read('src/database/entities/ExchangeAsset.ts');
  for (const marker of [
    'Phase 4 schema cleanup, now carried forward as the Phase 5 steady-state contract:',
    "@Unique('uq_broker_assets_source_symbol'",
    "@Index('idx_broker_assets_source_external_id'",
    "@Index('idx_broker_assets_source_asset_id'",
  ]) {
    if (!entitySource.includes(marker)) {
      findings.push(`ExchangeAsset.ts: missing steady-state marker ${marker}`);
    }
  }
  if (entitySource.includes("name: 'user_id'")) {
    findings.push('ExchangeAsset.ts: legacy user_id column should not exist in the steady-state entity');
  }

  const repositorySource = read('src/database/repositories/ExchangeAssetRepository.ts');
  for (const marker of [
    'Phase 4 schema cleanup, now carried forward as the Phase 5 steady-state contract:',
    'async replaceSystemAssets(',
    'async getSystemAssetBySourceAndExternalId(',
    'async getSystemAssetBySourceAndAssetId(',
    'async getSystemAssetBySourceAndSymbol(',
    'async listVisibleAssetsForUser(',
    'async countVisibleAssetsForUser(',
    'async listVisibleAssetsBySourceAndSymbolsForUser(',
  ]) {
    if (!repositorySource.includes(marker)) {
      findings.push(`ExchangeAssetRepository.ts: missing steady-state marker ${marker}`);
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
      findings.push(`ExchangeAssetRepository.ts: legacy user-scoped marker should stay removed: ${removedMarker}`);
    }
  }

  const serviceSource = read('src/api/services/ExchangeAssetsService.ts');
  for (const marker of [
    'Phase 4 stable model, now locked as the Phase 5 steady-state contract:',
    'replaceSystemAssets(',
    'listVisibleAssetsForUser(userId, {',
    'listVisibleAssetsBySourceAndSymbolsForUser(',
  ]) {
    if (!serviceSource.includes(marker)) {
      findings.push(`ExchangeAssetsService.ts: missing steady-state flow marker ${marker}`);
    }
  }

  const connectionsSource = read('src/api/services/ConnectionsService.ts');
  if (!connectionsSource.includes('countVisibleAssetsForUser(userId, source)')) {
    findings.push('ConnectionsService.ts: product-map totals should use broker_assets user-visible counts');
  }

  const deltaAdapterSource = read('src/brokers/capabilities/orders/DeltaExchangeOrdersAdapter.ts');
  for (const marker of [
    'getSystemAssetBySourceAndExternalId(',
    'getSystemAssetBySourceAndAssetId(',
    'getSystemAssetBySourceAndSymbol(',
  ]) {
    if (!deltaAdapterSource.includes(marker)) {
      findings.push(`DeltaExchangeOrdersAdapter.ts: missing steady-state global lookup ${marker}`);
    }
  }

  const migrationSource = read(
    'src/database/migrations/1770709000000-DropBrokerAssetLegacyUserOwnership.ts'
  );
  for (const marker of [
    'DropBrokerAssetLegacyUserOwnership1770709000000',
    'legacyIndexNames',
    'globalIndexes',
    'UUID()',
    'ROW_NUMBER() OVER',
    'DROP COLUMN user_id',
    'CREATE UNIQUE INDEX uq_broker_assets_source_symbol',
  ]) {
    if (!migrationSource.includes(marker)) {
      findings.push(`DropBrokerAssetLegacyUserOwnership migration: missing steady-state marker ${marker}`);
    }
  }

  const packageJson = parsePackageJson();
  const scripts = packageJson.scripts || {};
  for (const [key, expected] of [
    ['test:broker-assets-contract', 'node --import tsx scripts/test-broker-assets-contract.ts'],
    ['test:broker-assets-flow', 'node --import tsx scripts/test-broker-assets-flow.ts'],
    ['release-gate:broker-assets', 'node --import tsx scripts/release-gate-broker-assets.ts'],
  ]) {
    if (scripts[key] !== expected) {
      findings.push(`package.json: ${key} should equal "${expected}"`);
    }
  }

  const umbrellaScript = String(scripts['test:broker-assets'] || '');
  if (!umbrellaScript.includes('npm run test:broker-assets-contract')) {
    findings.push('package.json: test:broker-assets should run the contract suite');
  }
  if (!umbrellaScript.includes('npm run test:broker-assets-flow')) {
    findings.push('package.json: test:broker-assets should run the flow suite');
  }

  const testAllScript = String(scripts['test:all'] || '');
  if (!testAllScript.includes('npm run test:broker-assets')) {
    findings.push('package.json: test:all should include the stable broker-assets umbrella suite');
  }
  for (const legacyScript of [
    'npm run test:broker-assets-phase1',
    'npm run test:broker-assets-phase2',
    'npm run test:broker-assets-phase3',
    'npm run test:broker-assets-phase4',
  ]) {
    if (testAllScript.includes(legacyScript)) {
      findings.push(`package.json: test:all should not depend on historical phase guard ${legacyScript}`);
    }
  }

  assert.equal(findings.length, 0, `Broker assets contract failed:\n${findings.join('\n')}`);
  console.log('Broker assets contract passed.');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
