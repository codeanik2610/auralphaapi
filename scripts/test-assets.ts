import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { AssetsController } from '../src/api/controllers/AssetsController';
import { CryptoAssetsController } from '../src/api/controllers/CryptoAssetsController';
import { ExchangeAssetsController } from '../src/api/controllers/ExchangeAssetsController';
import { BrokerReferenceDataService } from '../src/api/services/BrokerReferenceDataService';
import { ExchangeAssetsService } from '../src/api/services/ExchangeAssetsService';
import { LeverageService } from '../src/brokers/providers/mudrex/LeverageService';

function createSuccess<T>(data: T) {
  return { success: true as const, data };
}

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

const authReq = { authUser: { sub: 'user-1' } } as any;
const unauthReq = {} as any;

async function assertAuthRequired(
  run: () => Promise<unknown>,
  message = 'Authentication required'
): Promise<void> {
  await assert.rejects(
    run,
    (error: unknown) =>
      error instanceof Error &&
      error.message === message &&
      (error as { httpCode?: number }).httpCode === 401
  );
}

async function runAssetsControllerAssertions(): Promise<void> {
  const controller: any = new AssetsController();

  controller.brokerReferenceDataService = {
    getReferenceCatalog: async (...args: unknown[]) => createSuccess({ args }),
    getFuturesAssets: async (...args: unknown[]) => createSuccess({ args }),
    getFuturesAsset: async (...args: unknown[]) => createSuccess({ args }),
    getFuturesAssetBySymbol: async (...args: unknown[]) => createSuccess({ args }),
  };

  assert.deepEqual((await controller.getReferenceCatalog(authReq)).data.args, ['user-1']);
  assert.deepEqual(
    (await controller.getFuturesAssets(authReq, 'mudrex', 'volume', 'desc', '5', '10')).data.args,
    ['mudrex', { sort: 'volume', order: 'desc', offset: '5', limit: '10' }]
  );
  assert.deepEqual((await controller.getFuturesAsset(authReq, 'mudrex', 'asset-1')).data.args, [
    'mudrex',
    'asset-1',
  ]);
  assert.deepEqual((await controller.getFuturesAssetBySymbol(authReq, 'BTCUSDT')).data.args, [
    'BTCUSDT',
  ]);

  await assertAuthRequired(() => controller.getReferenceCatalog(unauthReq));
  await assertAuthRequired(() => controller.getFuturesAssets(unauthReq));
  await assertAuthRequired(() => controller.getFuturesAsset(unauthReq, 'mudrex', 'asset-1'));
  await assertAuthRequired(() => controller.getFuturesAssetBySymbol(unauthReq, 'BTCUSDT'));
}

async function runExchangeAssetsControllerAssertions(): Promise<void> {
  const controller: any = new ExchangeAssetsController();

  controller.exchangeAssetsService = {
    syncExchangeAssets: async (...args: unknown[]) => createSuccess({ args }),
    getStoredExchangeAssets: async (...args: unknown[]) => createSuccess({ args }),
  };

  assert.deepEqual((await controller.syncExchangeAssets(authReq, 'delta_exchange')).data.args, [
    'user-1',
    'delta_exchange',
  ]);
  assert.deepEqual(
    (await controller.getStoredExchangeAssets(authReq, '10', '5', 'btc', 'mudrex')).data.args,
    ['user-1', { limit: '10', offset: '5', search: 'btc', source: 'mudrex' }]
  );

  await assertAuthRequired(() => controller.syncExchangeAssets(unauthReq, 'mudrex'));
  await assertAuthRequired(() => controller.getStoredExchangeAssets(unauthReq));
}

async function runCryptoAssetsControllerAssertions(): Promise<void> {
  const controller: any = new CryptoAssetsController();

  controller.cryptoAssetsService = {
    syncAssets: async (...args: unknown[]) => createSuccess({ args }),
    getStoredAssets: async (...args: unknown[]) => createSuccess({ args }),
  };

  assert.deepEqual((await controller.syncAssets()).data.args, []);
  assert.deepEqual((await controller.getStoredAssets('25', '5', 'eth')).data.args, [
    { limit: '25', offset: '5', search: 'eth' },
  ]);
}

async function runBrokerReferenceCatalogAssertions(): Promise<void> {
  const service = new BrokerReferenceDataService() as any;

  service.brokerDefinitionService = {
    async listPersistedDefinitions() {
      return [
        {
          id: 'provider-mudrex',
          brokerKey: 'mudrex',
          name: 'Mudrex',
          category: 'broker',
          providerType: 'broker',
          capabilities: ['assets', 'market', 'leverage'],
        },
        {
          id: 'provider-mail',
          brokerKey: 'mailgun',
          name: 'Mailgun',
          category: 'service',
          providerType: 'service',
          capabilities: ['email'],
        },
      ];
    },
  };
  service.exchangeRepository = {
    async listActiveExchanges() {
      return [
        { id: 'exchange-binance', exchangeKey: 'binance', name: 'Binance' },
        { id: 'exchange-delta', exchangeKey: 'delta_exchange', name: 'Delta Exchange' },
      ];
    },
  };

  const response = await service.getReferenceCatalog('user-1');
  assert.equal(response.data.total, 2);
  assert.equal(response.data.providerItems.length, 1);
  assert.equal(response.data.providerItems[0]?.brokerKey, 'mudrex');
  assert.equal(response.data.exchangeItems.length, 1);
  assert.equal(response.data.exchangeItems[0]?.brokerKey, 'binance');
}

async function runBrokerReferenceDataAssertions(): Promise<void> {
  const service = new BrokerReferenceDataService() as any;

  service.brokerDefinitionService = {
    async getRequiredDefinition(brokerKey: string) {
      return { brokerKey };
    },
  };
  service.mudrexService = {
    async getRemoteFutures(query: Record<string, unknown>) {
      return createSuccess({ query });
    },
    async getRemoteFuturesAsset(assetId: string) {
      return createSuccess({ assetId });
    },
    async getRemoteFuturesAssetBySymbol(symbol: string) {
      return createSuccess({ id: `${symbol}-asset` });
    },
  };
  service.leverageService = {
    async getLeverageByAssetId(assetId: string) {
      return createSuccess({ assetId });
    },
    async getLeverageBySymbol(symbol: string) {
      return createSuccess({ symbol });
    },
  };
  service.assetPriceRepository = {
    async getBySymbol(symbol: string, options: Record<string, unknown>) {
      assert.equal(symbol, 'BTCUSDT');
      assert.deepEqual(options, { sources: ['mudrex', 'delta_exchange'] });
      return {
        brokerAssetId: 'mudrex-btc',
        symbol: 'BTCUSDT',
        sourceSymbol: 'BTCUSDT',
        price: '67250.12',
        source: 'mudrex',
        retrievedAt: new Date('2026-04-13T01:00:00.000Z'),
        updatedAt: new Date('2026-04-13T01:00:05.000Z'),
      };
    },
  };

  assert.deepEqual((await service.getFuturesAssets('mudrex', { limit: '5' })).data.query, {
    limit: '5',
  });
  assert.deepEqual((await service.getFuturesAsset('mudrex', 'asset-1')).data.assetId, 'asset-1');
  assert.deepEqual((await service.getLeverageByAssetId('mudrex', 'asset-1')).data.assetId, 'asset-1');
  assert.deepEqual((await service.getLeverageBySymbol('mudrex', 'BTCUSDT')).data.symbol, 'BTCUSDT');

  const marketPrice = await service.getFuturesAssetBySymbol('BTCUSDT');
  assert.equal(marketPrice.data.brokerAssetId, 'mudrex-btc');
  assert.equal(marketPrice.data.exchangeAssetId, 'mudrex-btc');
  assert.equal(marketPrice.data.price, 67250.12);

  await assert.rejects(
    () => service.getFuturesAssets('delta_exchange', {}),
    /Futures assets are not configured for broker: delta_exchange/
  );
  await assert.rejects(
    () => service.getLeverageBySymbol('delta_exchange', 'BTCUSDT'),
    /Leverage lookup is not configured for broker: delta_exchange/
  );

  service.leverageService = {
    async getLeverageByAssetId(assetId: string) {
      return createSuccess({ assetId });
    },
    async getLeverageBySymbol() {
      throw new Error('leverage not found');
    },
  };

  await assert.rejects(
    () => service.getLeverageBySymbol('mudrex', 'BTCUSDT'),
    /leverage not found/
  );

  service.leverageService = {
    async getLeverageByAssetId(assetId: string) {
      return createSuccess({ assetId });
    },
    async getLeverageBySymbol() {
      const error = new Error('leverage not found') as Error & { httpCode?: number };
      error.httpCode = 404;
      throw error;
    },
  };

  const fallbackLeverage = await service.getLeverageBySymbol('mudrex', 'BTCUSDT');
  assert.equal(fallbackLeverage.data.assetId, 'BTCUSDT-asset');
}

async function runLeverageServiceAssertions(): Promise<void> {
  const service = new LeverageService() as any;
  const authenticatedCalls: Array<{ settings: Record<string, unknown>; path: string }> = [];
  const publicCalls: string[] = [];

  service.brokerAccountRepository = {
    async listSystemBrokerAccounts() {
      return [
        {
          settings: {
            apiSecret: 'system-secret',
          },
        },
      ];
    },
  };

  service.mudrexHttpClient = {
    async authenticatedGetWithSettings(
      settings: Record<string, unknown>,
      path: string
    ) {
      authenticatedCalls.push({ settings, path });
      return {
        leverage: '25x',
        margin_type: 'Cross',
      };
    },
    async get(path: string) {
      publicCalls.push(path);
      return {
        leverage: '10x',
        margin_type: 'Isolated',
      };
    },
  };

  const authenticatedResponse = await service.getLeverageBySymbol('BTCUSDT');
  assert.equal(authenticatedResponse.data.Leverage, '25x');
  assert.equal(authenticatedResponse.data.MarginType, 'Cross');
  assert.equal(authenticatedCalls.length, 1);
  assert.match(authenticatedCalls[0]?.path || '', /BTCUSDT\/leverage\?is_symbol$/);
  assert.equal(authenticatedCalls[0]?.settings.apiSecret, 'system-secret');
  assert.equal(publicCalls.length, 0);

  service.brokerAccountRepository = {
    async listSystemBrokerAccounts() {
      return [];
    },
  };

  const publicResponse = await service.getLeverageByAssetId('asset-1');
  assert.equal(publicResponse.data.Leverage, '10x');
  assert.equal(publicResponse.data.MarginType, 'Isolated');
  assert.equal(publicCalls.length, 1);
  assert.match(publicCalls[0] || '', /asset-1\/leverage$/);
}

async function runExchangeAssetsProviderCompatibilityAssertions(): Promise<void> {
  const service = new ExchangeAssetsService() as any;
  const replaceCaptures: Array<{
    source: string;
    assets: Array<Record<string, unknown>>;
    attempted: number;
  }> = [];
  const upsertCaptures: Array<{
    source: string;
    assets: Array<Record<string, unknown>>;
    attempted: number;
  }> = [];
  const syncRequests: Array<{
    source: string;
    assets: Array<{ id: string; symbol: string }>;
  }> = [];
  const mudrexFetchRequests: Array<{ pageSize: number; userId?: string }> = [];

  Object.defineProperty(service, 'brokerDefinitionService', {
    get: () => ({
      async getRequiredDefinition(source: string) {
        const normalizedSource = String(source || '').trim().toLowerCase();

        if (normalizedSource === 'delta_exchange') {
          return {
            id: 'broker-delta',
            brokerId: 'broker-delta',
            brokerKey: 'delta_exchange',
            providerType: 'broker',
          };
        }

        if (normalizedSource === 'mudrex') {
          return {
            id: 'broker-mudrex',
            brokerId: 'broker-mudrex',
            brokerKey: 'mudrex',
            providerType: 'broker',
          };
        }

        if (normalizedSource === 'binance') {
          return {
            id: 'exchange-binance',
            brokerKey: 'binance',
            providerType: 'feed',
            linkedExchangeKey: 'binance',
          };
        }

        throw new Error(`Unexpected source: ${source}`);
      },
    }),
  });

  Object.defineProperty(service, 'exchangeRepository', {
    get: () => ({
      async getExchangeByKey(exchangeKey: string) {
        const normalizedKey = String(exchangeKey || '').trim().toLowerCase();

        if (normalizedKey === 'delta_exchange') {
          return { id: 'exchange-delta', exchangeKey: 'delta_exchange' };
        }

        if (normalizedKey === 'binance') {
          return { id: 'exchange-binance', exchangeKey: 'binance' };
        }

        return null;
      },
    }),
  });

  Object.defineProperty(service, 'assetRepository', {
    get: () => ({
      async listAllSymbols() {
        return [
          { id: 'asset-btc', symbol: 'BTCUSDT' },
          { id: 'asset-eth', symbol: 'ETHUSDT' },
        ];
      },
    }),
  });

  Object.defineProperty(service, 'mudrexService', {
    get: () => ({
      async fetchAllRemoteFuturesForUserOrThrow(pageSize: number, userId?: string) {
        mudrexFetchRequests.push({ pageSize, userId });
        return [
          {
            id: 'mudrex-btc',
            symbol: 'BTCUSDT',
            name: 'Bitcoin',
          },
          {
            id: 'mudrex-eth',
            symbol: 'ETHUSDT',
            name: 'Ethereum',
          },
        ];
      },
    }),
  });

  Object.defineProperty(service, 'brokerExchangeAssetSyncService', {
    get: () => ({
      async sync(source: string, assets: Array<{ id: string; symbol: string }>) {
        syncRequests.push({ source, assets });
        return assets.map((item) => ({
          externalId: `${source}:${item.symbol}`,
          assetId: item.id,
          name: item.symbol,
          symbol: item.symbol,
        }));
      },
    }),
  });

  Object.defineProperty(service, 'exchangeAssetRepository', {
    get: () => ({
      async replaceSystemAssets(
        source: string,
        assets: Array<Record<string, unknown>>,
        attempted: number
      ) {
        replaceCaptures.push({ source, assets, attempted });
        return {
          attempted,
          matched: assets.length,
          inserted: assets.length,
          updated: 0,
          skipped: attempted - assets.length,
          totalStored: assets.length,
        };
      },
      async upsertSystemAssets(
        source: string,
        assets: Array<Record<string, unknown>>,
        attempted: number
      ) {
        upsertCaptures.push({ source, assets, attempted });
        return {
          attempted,
          matched: assets.length,
          inserted: assets.length,
          updated: 0,
          skipped: Math.max(attempted - assets.length, 0),
          totalStored: assets.length,
        };
      },
    }),
  });

  Object.defineProperty(service, 'operationalEventService', {
    get: () => ({
      async logActivity() {
        return;
      },
      async emitFailureAlert() {
        return;
      },
    }),
  });

  assert.deepEqual(await service.resolveProviderIds('delta_exchange'), {
    brokerId: 'broker-delta',
  });
  assert.deepEqual(await service.resolveProviderIds('mudrex'), {
    brokerId: 'broker-mudrex',
  });
  assert.deepEqual(await service.resolveProviderIds('binance'), {
    brokerId: null,
  });

  const binanceSync = await service.syncExchangeAssets('user-1', 'binance');
  assert.equal(binanceSync.data.source, 'binance');
  assert.equal(binanceSync.data.matchedAssets, 2);
  assert.equal(syncRequests.length, 1);
  assert.equal(syncRequests[0].source, 'binance');
  assert.deepEqual(
    syncRequests[0].assets.map((item) => item.symbol),
    ['BTCUSDT', 'ETHUSDT']
  );
  assert.equal(replaceCaptures.length, 1);
  assert.equal(replaceCaptures[0].source, 'binance');
  assert.equal(replaceCaptures[0].attempted, 2);
  assert.equal(replaceCaptures[0].assets.length, 2);
  assert.equal(replaceCaptures[0].assets[0].brokerId, null);
  assert.equal(
    Object.prototype.hasOwnProperty.call(replaceCaptures[0].assets[0], 'exchangeId'),
    false
  );

  const mudrexSync = await service.syncExchangeAssets('user-1', 'mudrex');
  assert.equal(mudrexSync.data.source, 'mudrex');
  assert.equal(mudrexSync.data.matchedAssets, 2);
  assert.equal(mudrexSync.data.deltaMappedSymbols, 2);
  assert.equal(mudrexFetchRequests.length, 1);
  assert.deepEqual(mudrexFetchRequests[0], {
    pageSize: 200,
    userId: 'user-1',
  });
  assert.equal(syncRequests.length, 2);
  assert.equal(syncRequests[1].source, 'delta_exchange');
  assert.deepEqual(
    syncRequests[1].assets.map((item) => item.symbol),
    ['BTCUSDT', 'ETHUSDT']
  );
  assert.equal(replaceCaptures.length, 2);
  assert.equal(replaceCaptures[1].source, 'mudrex');
  assert.equal(replaceCaptures[1].attempted, 2);
  assert.equal(replaceCaptures[1].assets.length, 2);
  assert.equal(replaceCaptures[1].assets[0].brokerId, 'broker-mudrex');
  assert.equal(upsertCaptures.length, 1);
  assert.equal(upsertCaptures[0].source, 'delta_exchange');
  assert.equal(upsertCaptures[0].attempted, 2);
  assert.equal(upsertCaptures[0].assets.length, 2);
  assert.equal(upsertCaptures[0].assets[0].brokerId, 'broker-delta');
  assert.equal(mudrexSync.data.deltaInsertedAssets, 2);
}

async function runExchangeAssetsVisibilityAssertions(): Promise<void> {
  const service = new ExchangeAssetsService() as any;
  const listVisibleRequests: Array<{
    userId: string;
    query: Record<string, unknown>;
  }> = [];
  const visibleDeltaRequests: Array<{
    userId: string;
    source: string;
    symbols: string[];
  }> = [];

  Object.defineProperty(service, 'exchangeAssetRepository', {
    get: () => ({
      async listVisibleAssetsForUser(userId: string, query: Record<string, unknown>) {
        listVisibleRequests.push({ userId, query });
        return {
          data: [
            {
              id: 'asset-row-1',
              source: 'mudrex',
              brokerId: 'broker-mudrex',
              externalId: 'mudrex:BTCUSDT',
              assetId: 'asset-btc',
              name: 'Bitcoin',
              symbol: 'BTCUSDT',
              createdAt: new Date('2026-04-04T09:00:00.000Z'),
              updatedAt: new Date('2026-04-04T09:00:00.000Z'),
            },
          ],
          total: 1,
        };
      },
      async listVisibleAssetsBySourceAndSymbolsForUser(
        userId: string,
        source: string,
        symbols: string[]
      ) {
        visibleDeltaRequests.push({ userId, source, symbols });
        return [
          {
            id: 'asset-row-delta-1',
            source: 'delta_exchange',
            brokerId: 'broker-delta',
            externalId: 'delta:BTCUSD',
            assetId: 'asset-btc',
            name: 'Bitcoin',
            symbol: 'BTCUSD',
            createdAt: new Date('2026-04-04T09:00:00.000Z'),
            updatedAt: new Date('2026-04-04T09:00:00.000Z'),
          },
        ];
      },
    }),
  });

  const response = await service.getStoredExchangeAssets('user-1', {
    limit: '25',
    offset: '5',
    search: 'btc',
    source: 'mudrex',
  });

  assert.deepEqual(listVisibleRequests, [
    {
      userId: 'user-1',
      query: {
        limit: 25,
        offset: 5,
        search: 'btc',
        source: 'mudrex',
      },
    },
  ]);
  assert.deepEqual(visibleDeltaRequests, [
    {
      userId: 'user-1',
      source: 'delta_exchange',
      symbols: ['BTCUSDT', 'BTCUSD', 'BTCUSDC'],
    },
  ]);
  assert.equal(response.data.total, 1);
  assert.equal(response.data.limit, 25);
  assert.equal(response.data.offset, 5);
  assert.equal(response.data.assets.length, 1);
  assert.equal(response.data.assets[0].symbol, 'BTCUSDT');
  assert.equal(response.data.assets[0].deltaExternalId, 'delta:BTCUSD');
  assert.equal(response.data.assets[0].deltaSymbol, 'BTCUSD');
  assert.equal(response.data.assets[0].isDeltaMapped, true);
}

function runAssetsScriptWiringAssertions(): void {
  const packageSource = read('package.json');
  const packageJson = JSON.parse(packageSource) as { scripts?: Record<string, string> };
  const packageScripts = packageJson.scripts || {};
  const runPackageSuiteSource = read('scripts/_support/run-package-suite.ts');
  const smokeModulesSource = read('scripts/smokes/smoke-modules.sh');

  assert.equal(
    packageScripts['test:assets'],
    'node --import tsx scripts/_support/run-doc-aware-test.ts scripts/test-assets.ts'
  );
  assert.match(runPackageSuiteSource, /assets:\s*\['test:assets'\]/);
  assert.match(smokeModulesSource, /\/assets\/catalog/);
  assert.match(smokeModulesSource, /\/exchange-assets\?limit=5&offset=0/);
  assert.equal(
    packageScripts['check:assets-health'],
    'node --import tsx scripts/checks/check-assets-health.ts'
  );
}

async function main(): Promise<void> {
  await runAssetsControllerAssertions();
  await runExchangeAssetsControllerAssertions();
  await runCryptoAssetsControllerAssertions();
  await runBrokerReferenceCatalogAssertions();
  await runBrokerReferenceDataAssertions();
  await runLeverageServiceAssertions();
  await runExchangeAssetsProviderCompatibilityAssertions();
  await runExchangeAssetsVisibilityAssertions();
  runAssetsScriptWiringAssertions();
  console.log('Assets module assertions passed.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
