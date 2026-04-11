import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function run(): void {
  const findings: string[] = [];

  const phaseDoc = read('BROKER_ASSETS_PHASE3.md');
  for (const marker of [
    'Phase 3 aligns the runtime with the global-catalog ownership model',
    '`ExchangeAssetsService` now writes `broker_assets` through',
    'User-visible visibility is derived from user-owned routes:',
    'active `broker_accounts` with status `Connected` or `Idle`',
    '`DeltaExchangeOrdersAdapter` now resolves product mappings from the global',
    '## Phase 4 Entry Checklist',
  ]) {
    if (!phaseDoc.includes(marker)) {
      findings.push(`BROKER_ASSETS_PHASE3.md: missing Phase 3 marker ${marker}`);
    }
  }

  const readme = read('README.md');
  if (!readme.includes('BROKER_ASSETS_PHASE4.md')) {
    findings.push('README.md: missing broker assets Phase 4 cleanup reference');
  }

  const repositorySource = read('src/database/repositories/ExchangeAssetRepository.ts');
  for (const marker of [
    'async replaceSystemAssets(',
    'async listVisibleAssetsForUser(',
    'async countVisibleAssetsForUser(',
    'async listVisibleAssetsBySourceAndSymbolsForUser(',
    'async getSystemAssetBySourceAndSymbol(',
    'from(Connection, \'connection\')',
    'from(BrokerAccount, \'account\')',
  ]) {
    if (!repositorySource.includes(marker)) {
      findings.push(`ExchangeAssetRepository.ts: missing Phase 3 marker ${marker}`);
    }
  }

  const exchangeAssetsService = read('src/api/services/ExchangeAssetsService.ts');
  for (const marker of [
    'replaceSystemAssets(',
    'listVisibleAssetsForUser(userId, {',
    'listVisibleAssetsBySourceAndSymbolsForUser(',
  ]) {
    if (!exchangeAssetsService.includes(marker)) {
      findings.push(`ExchangeAssetsService.ts: missing Phase 3 marker ${marker}`);
    }
  }

  const connectionsService = read('src/api/services/ConnectionsService.ts');
  if (!connectionsService.includes('countVisibleAssetsForUser(userId, source)')) {
    findings.push('ConnectionsService.ts: missing Phase 3 product-map visibility count');
  }

  const deltaAdapter = read('src/brokers/capabilities/orders/DeltaExchangeOrdersAdapter.ts');
  for (const marker of [
    'getSystemAssetBySourceAndExternalId(',
    'getSystemAssetBySourceAndAssetId(',
    'getSystemAssetBySourceAndSymbol(',
  ]) {
    if (!deltaAdapter.includes(marker)) {
      findings.push(`DeltaExchangeOrdersAdapter.ts: missing Phase 3 global lookup ${marker}`);
    }
  }

  const servicesTestSource = read('scripts/test-services.ts');
  for (const marker of [
    'async countVisibleAssetsForUser(',
    'const replaceCaptures:',
    'async listVisibleAssetsForUser(',
    'async getSystemAssetBySourceAndSymbol(',
    'runExchangeAssetsVisibilityAssertions()',
    'runDeltaExchangeOrdersAdapterCatalogAssertions()',
  ]) {
    if (!servicesTestSource.includes(marker)) {
      findings.push(`scripts/test-services.ts: missing Phase 3 test marker ${marker}`);
    }
  }

  const packageSource = read('package.json');
  if (!packageSource.includes('"test:broker-assets-phase3"')) {
    findings.push('package.json: missing broker assets Phase 3 test script');
  }
  if (
    !packageSource.includes('npm run test:broker-assets-phase3') &&
    !packageSource.includes('npm run test:broker-assets')
  ) {
    findings.push('package.json: Phase 3 history guard must stay wired directly or via the stable broker-assets umbrella');
  }
  if (!read('BROKER_ASSETS_PHASE4.md').includes('Phase 4 removes the last legacy user-ownership schema')) {
    findings.push('BROKER_ASSETS_PHASE4.md: missing Phase 4 handoff after the Phase 3 runtime alignment');
  }

  assert.equal(findings.length, 0, `Broker assets Phase 3 guard failed:\n${findings.join('\n')}`);
  console.log('Broker assets Phase 3 guard passed.');
}

run();
