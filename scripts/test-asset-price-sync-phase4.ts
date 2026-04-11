import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { AssetPriceRepository } from '../src/database/repositories/AssetPriceRepository';
import { BrokerReferenceDataService } from '../src/api/services/BrokerReferenceDataService';

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

async function runRuntimeAssertions(): Promise<void> {
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
  assert.equal(preferredRows[0].brokerAssetId, 'mudrex-asset');

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
  assert.equal(response.data.source, 'mudrex');
}

async function run(): Promise<void> {
  const findings: string[] = [];

  await runRuntimeAssertions();

  const phaseDoc = read('ASSET_PRICE_SYNC_PHASE4.md');
  for (const marker of [
    'Phase 4 completes the downstream reader migration for `asset-price-sync`.',
    'live backend readers no longer depend on `MarketPriceBinanceRepository`',
    'read paths consume `asset_price`',
    '`market_prices_binance` is no longer part of the active app read/write path',
  ]) {
    if (!phaseDoc.includes(marker)) {
      findings.push(`ASSET_PRICE_SYNC_PHASE4.md: missing Phase 4 marker ${marker}`);
    }
  }

  const readme = read('README.md');
  if (!readme.includes('ASSET_PRICE_SYNC_PHASE4.md')) {
    findings.push('README.md: missing asset-price-sync Phase 4 baseline link');
  }
  if (!readme.includes('test:asset-price-sync-phase4')) {
    findings.push('README.md: missing asset-price-sync Phase 4 verification command');
  }

  const packageSource = read('package.json');
  if (!packageSource.includes('"test:asset-price-sync-phase4"')) {
    findings.push('package.json: missing asset-price-sync Phase 4 test script');
  }
  if (!packageSource.includes('npm run test:asset-price-sync-phase4')) {
    findings.push('package.json: asset-price-sync Phase 4 guard must stay wired');
  }

  const repositorySource = read('src/database/repositories/AssetPriceRepository.ts');
  for (const marker of [
    'export interface AssetPriceLookupOptions',
    'getByBrokerAssetId',
    'getBySymbol(',
    'getBySymbols(',
    'pickPreferredRow',
    'listCandidateRows',
  ]) {
    if (!repositorySource.includes(marker)) {
      findings.push(`AssetPriceRepository.ts: missing Phase 4 marker ${marker}`);
    }
  }

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
      findings.push(`${relativePath}: should not depend on MarketPriceBinanceRepository in Phase 4`);
    }
  }

  const brokerReferenceSource = read('src/api/services/BrokerReferenceDataService.ts');
  for (const marker of [
    'AssetPriceRepository',
    "sources: ['mudrex', 'delta_exchange']",
    'exchangeAssetId: row.brokerAssetId',
    'brokerAssetId: row.brokerAssetId',
  ]) {
    if (!brokerReferenceSource.includes(marker)) {
      findings.push(`BrokerReferenceDataService.ts: missing Phase 4 marker ${marker}`);
    }
  }

  const positionsFacadeSource = read('src/api/services/BrokerPositionsFacadeService.ts');
  for (const marker of [
    'AssetPriceRepository',
    "sources: ['mudrex']",
    'this.assetPriceRepository.getBySymbols',
  ]) {
    if (!positionsFacadeSource.includes(marker)) {
      findings.push(`BrokerPositionsFacadeService.ts: missing Phase 4 marker ${marker}`);
    }
  }

  const internalPositionsSource = read('src/api/services/InternalPositionsSyncService.ts');
  for (const marker of [
    'AssetPriceRepository',
    "sources: ['mudrex']",
    'this.assetPriceRepository.getBySymbols',
  ]) {
    if (!internalPositionsSource.includes(marker)) {
      findings.push(`InternalPositionsSyncService.ts: missing Phase 4 marker ${marker}`);
    }
  }

  const paperExecutionSource = read('src/api/services/PaperOrderExecutionService.ts');
  for (const marker of [
    'AssetPriceRepository',
    'loadFallbackMarketPrices',
    'loadScopedMarketPrices',
    'resolvePriceSourceForBroker',
    'buildScopedSymbolKey',
  ]) {
    if (!paperExecutionSource.includes(marker)) {
      findings.push(`PaperOrderExecutionService.ts: missing Phase 4 marker ${marker}`);
    }
  }

  const marketMetricsSource = read('src/api/services/MarketMetricsService.ts');
  for (const marker of [
    'AssetPriceRepository',
    'this.assetPriceRepository.getBySymbols',
    "sources: ['mudrex', 'delta_exchange']",
  ]) {
    if (!marketMetricsSource.includes(marker)) {
      findings.push(`MarketMetricsService.ts: missing Phase 4 marker ${marker}`);
    }
  }

  assert.equal(
    findings.length,
    0,
    `Asset price sync Phase 4 guard failed:\n${findings.join('\n')}`
  );
  console.log('Asset price sync Phase 4 guard passed.');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
