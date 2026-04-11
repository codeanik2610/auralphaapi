import assert from 'node:assert/strict';

import { DeltaExchangeOrdersAdapter } from '../src/brokers/capabilities/orders/DeltaExchangeOrdersAdapter';
import { ConnectionsService } from '../src/api/services/ConnectionsService';
import { ExchangeAssetsService } from '../src/api/services/ExchangeAssetsService';

async function runSyncFlowAssertions(): Promise<void> {
  const service = new ExchangeAssetsService() as any;
  const replaceCaptures: Array<{
    source: string;
    assets: Array<Record<string, unknown>>;
    attempted: number;
  }> = [];
  const syncRequests: Array<{
    source: string;
    assets: Array<{ id: string; symbol: string }>;
  }> = [];

  Object.defineProperty(service, 'brokerDefinitionService', {
    get: () => ({
      async getRequiredDefinition(source: string) {
        const normalizedSource = String(source || '').trim().toLowerCase();

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

        if (normalizedSource === 'delta_exchange') {
          return {
            id: 'broker-delta',
            brokerId: 'broker-delta',
            brokerKey: 'delta_exchange',
            providerType: 'broker',
          };
        }

        throw new Error(`Unexpected source: ${source}`);
      },
    }),
  });

  Object.defineProperty(service, 'exchangeRepository', {
    get: () => ({
      async getExchangeByKey(exchangeKey: string) {
        if (String(exchangeKey || '').trim().toLowerCase() === 'binance') {
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
      async fetchAllRemoteFuturesForUserOrThrow() {
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

  const binanceSync = await service.syncExchangeAssets('user-1', 'binance');
  assert.equal(binanceSync.data.source, 'binance');
  assert.equal(replaceCaptures[0].source, 'binance');
  assert.equal(replaceCaptures[0].attempted, 2);
  assert.equal(replaceCaptures[0].assets.length, 2);
  assert.equal(replaceCaptures[0].assets[0].brokerId, null);
  assert.equal(Object.prototype.hasOwnProperty.call(replaceCaptures[0].assets[0], 'userId'), false);

  const mudrexSync = await service.syncExchangeAssets('user-1', 'mudrex');
  assert.equal(mudrexSync.data.source, 'mudrex');
  assert.equal(mudrexSync.data.deltaMappedSymbols, 2);
  assert.equal(replaceCaptures[1].source, 'mudrex');
  assert.equal(replaceCaptures[1].attempted, 2);
  assert.equal(replaceCaptures[1].assets[0].brokerId, 'broker-mudrex');
  assert.equal(Object.prototype.hasOwnProperty.call(replaceCaptures[1].assets[0], 'userId'), false);
  assert.deepEqual(
    syncRequests.map((request) => request.source),
    ['binance', 'delta_exchange']
  );
}

async function runVisibilityFlowAssertions(): Promise<void> {
  const service = new ExchangeAssetsService() as any;
  const listVisibleRequests: Array<{
    userId: string;
    query: Record<string, unknown>;
  }> = [];
  const deltaVisibilityRequests: Array<{
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
        deltaVisibilityRequests.push({ userId, source, symbols });
        return [
          {
            id: 'asset-row-delta-1',
            source: 'delta_exchange',
            brokerId: 'broker-delta',
            externalId: 'delta:BTCUSDT',
            assetId: 'asset-btc',
            name: 'Bitcoin',
            symbol: 'BTCUSDT',
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
  assert.deepEqual(deltaVisibilityRequests, [
    {
      userId: 'user-1',
      source: 'delta_exchange',
      symbols: ['BTCUSDT'],
    },
  ]);
  assert.equal(response.data.assets[0].isDeltaMapped, true);
  assert.equal(response.data.assets[0].deltaExternalId, 'delta:BTCUSDT');
}

async function runProductMapVisibilityAssertions(): Promise<void> {
  const service = new ConnectionsService() as any;
  const countRequests: Array<{ userId: string; source?: string }> = [];

  Object.defineProperty(service, 'exchangeAssetRepository', {
    get: () => ({
      async countVisibleAssetsForUser(userId: string, source?: string) {
        countRequests.push({ userId, source });
        return 7;
      },
    }),
  });

  const summary = await service.resolveConnectionProductMapSummary(
    'user-1',
    { brokerKey: 'delta_exchange' },
    {
      providerType: 'broker',
      category: 'broker',
      capabilities: ['assets', 'orders'],
    }
  );

  assert.deepEqual(countRequests, [{ userId: 'user-1', source: 'delta_exchange' }]);
  assert.deepEqual(summary, {
    supported: true,
    source: 'delta_exchange',
    total: 7,
  });
}

async function runDeltaLookupAssertions(): Promise<void> {
  const adapter = new DeltaExchangeOrdersAdapter() as any;
  const lookupCalls: string[] = [];
  let submittedPayload: Record<string, unknown> | null = null;

  Object.defineProperty(adapter, 'exchangeAssetRepository', {
    get: () => ({
      async getSystemAssetBySourceAndExternalId(source: string, externalId: string) {
        lookupCalls.push(`external:${source}:${externalId}`);
        return null;
      },
      async getSystemAssetBySourceAndAssetId(source: string, assetId: string) {
        lookupCalls.push(`asset:${source}:${assetId}`);
        return null;
      },
      async getSystemAssetBySourceAndSymbol(source: string, symbol: string) {
        lookupCalls.push(`symbol:${source}:${symbol}`);
        return {
          externalId: '45678',
          symbol,
        };
      },
    }),
  });

  Object.defineProperty(adapter, 'deltaHttpClient', {
    get: () => ({
      async signedPost(
        accountId: string,
        routePath: string,
        payload: Record<string, unknown>,
        userId?: string
      ) {
        submittedPayload = {
          accountId,
          routePath,
          payload,
          userId,
        };
        return {
          id: 'delta-order-1',
          state: 'open',
        };
      },
    }),
  });

  const response = await adapter.createOrder(
    'BTCUSDT',
    {
      quantity: '2',
      reduce_only: false,
      order_type: 'limit',
      order_price: '101.5',
      leverage: '3',
      trigger_type: 'gtc',
    },
    {
      userId: 'user-1',
      accountId: 'acct-1',
    }
  );

  assert.deepEqual(lookupCalls, [
    'external:delta_exchange:BTCUSDT',
    'asset:delta_exchange:BTCUSDT',
    'symbol:delta_exchange:BTCUSDT',
  ]);
  assert.deepEqual(submittedPayload, {
    accountId: 'acct-1',
    routePath: '/v2/orders',
    payload: {
      product_id: 45678,
      size: 2,
      side: 'buy',
      order_type: 'limit_order',
      limit_price: 101.5,
      time_in_force: 'gtc',
    },
    userId: 'user-1',
  });
  assert.equal(response.order_id, 'delta-order-1');
  assert.equal(response.status, 'open');
}

async function run(): Promise<void> {
  await runSyncFlowAssertions();
  await runVisibilityFlowAssertions();
  await runProductMapVisibilityAssertions();
  await runDeltaLookupAssertions();
  console.log('Broker assets flow proof passed.');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
