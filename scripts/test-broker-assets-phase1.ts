import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function run(): void {
  const findings: string[] = [];

  const phaseDoc = read('BROKER_ASSETS_PHASE1.md');
  for (const marker of [
    '`broker_assets` is the global broker or exchange asset catalog.',
    '`broker_accounts` is the user-owned connection layer',
    '`broker_assets.user_id` is a legacy transitional column.',
    'Phase 1 does not change runtime behavior.',
    'no new feature should depend on `broker_assets.user_id` for ownership',
  ]) {
    if (!phaseDoc.includes(marker)) {
      findings.push(`BROKER_ASSETS_PHASE1.md: missing contract marker ${marker}`);
    }
  }

  const checklist = read('BROKER_ASSETS_SYNC_FUNCTIONAL_CHECKLIST.md');
  for (const marker of [
    'Scheduler key: `broker-assets-sync`',
    'Admin route base: `/scheduler/exchange-assets`',
    'Storage target table: `broker_assets`',
    "Default source list is `['mudrex', 'delta_exchange']`.",
    '## 14. Time And Timezone Checks',
  ]) {
    if (!checklist.includes(marker)) {
      findings.push(`BROKER_ASSETS_SYNC_FUNCTIONAL_CHECKLIST.md: missing marker ${marker}`);
    }
  }

  const readme = read('README.md');
  if (!readme.includes('`broker_assets` is the global provider asset catalog;')) {
    findings.push('README.md: missing broker_assets ownership note');
  }
  if (!readme.includes('BROKER_ASSETS_SYNC_FUNCTIONAL_CHECKLIST.md')) {
    findings.push('README.md: missing broker-assets functional checklist reference');
  }

  const entitySource = read('src/database/entities/ExchangeAsset.ts');
  for (const marker of [
    'broker_assets is now a pure global broker or exchange asset catalog.',
    "@Unique('uq_broker_assets_source_symbol'",
  ]) {
    if (!entitySource.includes(marker)) {
      findings.push(`ExchangeAsset.ts: missing Phase 1 marker ${marker}`);
    }
  }

  const repositorySource = read('src/database/repositories/ExchangeAssetRepository.ts');
  for (const marker of [
    'broker_assets no longer carries legacy per-user ownership',
    'replaceSystemAssets(',
    'listVisibleAssetsForUser(',
  ]) {
    if (!repositorySource.includes(marker)) {
      findings.push(`ExchangeAssetRepository.ts: missing Phase 1 marker ${marker}`);
    }
  }

  const serviceSource = read('src/api/services/ExchangeAssetsService.ts');
  for (const marker of [
    'broker_assets writes target the global catalog',
    'derived from user-owned routes',
    'syncExchangeAssets(',
    'getStoredExchangeAssets(',
  ]) {
    if (!serviceSource.includes(marker)) {
      findings.push(`ExchangeAssetsService.ts: missing Phase 1 marker ${marker}`);
    }
  }

  const packageSource = read('package.json');
  if (!packageSource.includes('"test:broker-assets-phase1"')) {
    findings.push('package.json: missing broker assets Phase 1 test script');
  }
  if (!packageSource.includes('npm run test:broker-assets-phase1')) {
    findings.push('package.json: broker assets Phase 1 guard must stay wired');
  }

  assert.equal(findings.length, 0, `Broker assets Phase 1 guard failed:\n${findings.join('\n')}`);
  console.log('Broker assets Phase 1 guard passed.');
}

run();
