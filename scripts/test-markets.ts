import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { InternalMarketsSnapshotController } from '../src/api/controllers/InternalMarketsSnapshotController';
import { MarketController } from '../src/api/controllers/MarketController';
import { MarketsOverviewController } from '../src/api/controllers/MarketsOverviewController';
import { env } from '../src/env';
import { MarketMetricsService } from '../src/api/services/MarketMetricsService';
import { MarketsOverviewService } from '../src/api/services/MarketsOverviewService';
import { MarketSnapshotRefreshService } from '../src/api/services/MarketSnapshotRefreshService';
import { validateMarketCandlesQuery } from '../src/api/validators/market.validator';
import { strategyDataSource } from '../src/database/pg-data-source';

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

async function runMarketControllerAssertions(): Promise<void> {
  const controller: any = new MarketController();

  controller.marketService = {
    getCandles: async (...args: unknown[]) => createSuccess({ args }),
  };

  assert.deepEqual(
    (
      await controller.getCandles(authReq, {
        symbol: 'BTCUSDT',
        interval: '1h',
        limit: '25',
        brokerKey: 'mudrex',
        accountId: 'acct-1',
      })
    ).data.args,
    [
      'user-1',
      {
        symbol: 'BTCUSDT',
        interval: '1h',
        limit: '25',
        brokerKey: 'mudrex',
        accountId: 'acct-1',
      },
    ]
  );

  await assertAuthRequired(() => controller.getCandles(unauthReq, { symbol: 'BTCUSDT' }));
}

async function runMarketsOverviewControllerAssertions(): Promise<void> {
  const controller: any = new MarketsOverviewController();

  controller.marketsOverviewService = {
    getOverview: async (...args: unknown[]) => createSuccess({ args }),
    getSymbolOverview: async (...args: unknown[]) => createSuccess({ args }),
    getSymbolChart: async (...args: unknown[]) => createSuccess({ args }),
  };

  assert.deepEqual(
    (
      await controller.getOverview(
        authReq,
        'BTCUSDT',
        'btc',
        'volume',
        'desc',
        '10',
        '5',
        'triggered',
        'watched',
        'core'
      )
    ).data.args,
    [
      'user-1',
      {
        selectedSymbol: 'BTCUSDT',
        search: 'btc',
        sort: 'volume',
        order: 'desc',
        limit: '10',
        offset: '5',
        signalFilter: 'triggered',
        watchlistFilter: 'watched',
        liquidityTier: 'core',
      },
    ]
  );

  assert.deepEqual(
    (await controller.getSymbolOverview(authReq, 'BTCUSDT', '6')).data.args,
    ['user-1', 'BTCUSDT', { signalsLimit: '6' }]
  );
  assert.deepEqual(
    (await controller.getSymbolChart(authReq, 'BTCUSDT', '1h', '24')).data.args,
    ['BTCUSDT', { interval: '1h', limit: '24' }]
  );

  await assertAuthRequired(() => controller.getOverview(unauthReq));
  await assertAuthRequired(() => controller.getSymbolOverview(unauthReq, 'BTCUSDT'));
  await assertAuthRequired(() => controller.getSymbolChart(unauthReq, 'BTCUSDT'));
}

async function runInternalMarketsSnapshotControllerAssertions(): Promise<void> {
  const controller: any = new InternalMarketsSnapshotController();

  controller.marketSnapshotRefreshService = {
    refreshSnapshots: async (...args: unknown[]) => createSuccess({ args }),
  };

  assert.deepEqual(
    (await controller.refreshSnapshots({ symbols: ['BTCUSDT', 'ETHUSDT'] })).data.args,
    [{ symbols: ['BTCUSDT', 'ETHUSDT'] }]
  );
  assert.deepEqual((await controller.refreshSnapshots()).data.args, [{ symbols: [] }]);
}

function runMarketValidationAssertions(): void {
  assert.deepEqual(
    (() => {
      const result = validateMarketCandlesQuery({
        symbol: ' btcusdt ',
        interval: '1h',
        limit: '24',
        endTime: '2026-04-13T03:00:00.000Z',
        brokerKey: ' mudrex ',
        accountId: ' acct-1 ',
      });
      return {
        ...result,
        endTime: result.endTime?.toISOString(),
      };
    })(),
    {
      symbol: 'BTCUSDT',
      interval: '1h',
      limit: 24,
      endTime: '2026-04-13T03:00:00.000Z',
      brokerKey: 'mudrex',
      accountId: 'acct-1',
    }
  );

  assert.throws(() => validateMarketCandlesQuery({ interval: '1h' }), /symbol is required/);
  assert.throws(
    () => validateMarketCandlesQuery({ symbol: 'BTC/USDT', interval: '1h' }),
    /symbol contains invalid characters/
  );
  assert.throws(
    () => validateMarketCandlesQuery({ symbol: 'BTCUSDT', interval: '13m' }),
    /interval must be one of/
  );
  assert.throws(
    () => validateMarketCandlesQuery({ symbol: 'BTCUSDT', interval: '1h', limit: '1001' }),
    /limit must be an integer between 1 and 1000/
  );
  assert.throws(
    () =>
      validateMarketCandlesQuery({
        symbol: 'BTCUSDT',
        interval: '1h',
        endTime: 'not-a-date',
      }),
    /endTime must be a valid date/
  );
}

async function runMarketsOverviewSnapshotAssertions(): Promise<void> {
  const service = new MarketsOverviewService() as any;

  service.marketSymbolSnapshotRepository = {
    supportsOverviewSort(sort?: string) {
      return sort === 'volume';
    },
    async listOverviewSnapshots() {
      return {
        data: [
          {
            symbol: 'BTCUSDT',
            name: 'Bitcoin',
            lastPrice: 67250.12,
            change24h: 3.42,
            volume24h: 184000000,
            high24h: 67500.45,
            low24h: 66120.11,
            liquidityTier: 'High',
            priceSource: 'snapshot',
            snapshotAt: new Date('2026-04-05T00:00:00.000Z'),
          },
        ],
        total: 1,
        timings: {
          countMs: 3,
          dataMs: 5,
        },
      };
    },
    async getBySymbol() {
      return null;
    },
  };
  service.signalRepository = {
    async getLatestSignalsBySymbols() {
      return new Map();
    },
  };
  service.watchlistRepository = {
    async countWatchlistsBySymbols() {
      return new Map([['BTCUSDT', 2]]);
    },
  };
  service.assetRepository = {
    async listAssetBases() {
      throw new Error('snapshot fast path should not load asset bases');
    },
  };

  const response = await service.getOverview('user-1', {
    limit: '20',
    offset: '0',
    sort: 'volume',
  });

  assert.equal(response.data.meta.buildMode, 'snapshot-query');
  assert.equal(response.data.meta.cacheState, 'miss');
  assert.equal(response.data.assets.length, 1);
  assert.equal(response.data.assets[0].symbol, 'BTCUSDT');
  assert.equal(response.data.assets[0].watchlist_count, 2);
  assert.equal(response.data.assets[0].provenance?.mode, 'snapshot');
  assert.equal(response.data.assets[0].provenance?.isStale, true);
  assert.equal(response.data.selectedAsset?.symbol, 'BTCUSDT');
}

async function runMarketsSymbolOverviewAssertions(): Promise<void> {
  const service = new MarketsOverviewService() as any;

  service.assetRepository = {
    async getAssetBySymbol() {
      return {
        symbol: 'BTCUSDT',
        name: 'Bitcoin',
      };
    },
  };
  service.marketSymbolSnapshotRepository = {
    async getBySymbols() {
      return [
        {
          symbol: 'BTCUSDT',
          name: 'Bitcoin snapshot',
          lastPrice: 66880.11,
          change24h: 2.18,
          volume24h: 173000000,
          high24h: 67110.52,
          low24h: 65420.24,
          liquidityTier: 'High',
          priceSource: 'snapshot',
          snapshotAt: new Date('2026-04-06T09:40:00.000Z'),
        },
      ];
    },
  };
  service.marketMetricsService = {
    async getMetricsForSymbols() {
      return new Map([
        [
          'BTCUSDT',
          {
            symbol: 'BTCUSDT',
            lastPrice: 67250.12,
            changePerc: 3.42,
            volume24h: 184000000,
            high24h: 67500.45,
            low24h: 66120.11,
            snapshotAt: new Date('2026-04-06T09:58:00.000Z'),
            priceSource: 'pg.market_candles_1m',
          },
        ],
      ]);
    },
  };
  service.signalsService = {
    async getSignals() {
      return {
        data: {
          items: [
            {
              id: 'signal-1',
              symbol: 'BTCUSDT',
              source: 'Trend model',
              status: 'Triggered',
              timeframe: '1h',
              confidence: 0.91,
            },
          ],
          total: 1,
          limit: 6,
          offset: 0,
        },
      };
    },
  };
  service.watchlistRepository = {
    async listWatchlistsContainingSymbol() {
      return [
        {
          id: 'wl-1',
          name: 'Momentum Core',
          type: 'Manual',
          updatedAt: new Date('2026-04-06T10:10:00.000Z'),
        },
      ];
    },
  };

  const response = await service.getSymbolOverview('user-1', 'BTCUSDT', {
    signalsLimit: '6',
  });

  assert.equal(response.data.symbol, 'BTCUSDT');
  assert.equal(response.data.asset?.name, 'Bitcoin');
  assert.equal(response.data.asset?.price, 67250.12);
  assert.equal(response.data.asset?.provenance?.mode, 'live-candles');
  assert.equal(response.data.asset?.price_source, 'pg.market_candles_1m');
  assert.equal(response.data.signals.total, 1);
  assert.equal(response.data.signals.items[0].id, 'signal-1');
  assert.equal(response.data.watchlists.total, 1);
  assert.equal(response.data.watchlists.memberships[0].id, 'wl-1');
  assert.equal(response.data.watchlists.memberships[0].name, 'Momentum Core');
}

async function runMarketsChartWarehouseSymbolResolutionAssertions(): Promise<void> {
  const service = new MarketsOverviewService() as any;
  const originalQuery = strategyDataSource.query.bind(strategyDataSource);
  const originalInitialized = strategyDataSource.isInitialized;
  const capturedQueries: Array<{ sql: string; params: unknown[] }> = [];

  (strategyDataSource as any).isInitialized = true;
  (strategyDataSource as any).query = async (sql: string, params: unknown[]) => {
    capturedQueries.push({ sql, params });
    if (sql.includes('WITH bounds AS')) {
      if (params[0] === 'DOGSUSDT') {
        return [
          {
            bucket_ts: Date.parse('2026-04-13T03:00:00.000Z') / 1000,
            open: '100',
            high: '105',
            low: '98',
            close: '102',
            volume: '1000',
          },
          {
            bucket_ts: Date.parse('2026-04-13T03:05:00.000Z') / 1000,
            open: '102',
            high: '106',
            low: '99',
            close: '103',
            volume: '1100',
          },
        ];
      }
      return [
        {
          bucket_ts: Date.parse('2026-04-13T03:00:00.000Z') / 1000,
          open: '100',
          high: '105',
          low: '98',
          close: '102',
          volume: '1000',
        },
      ];
    }
    const candidates = Array.isArray(params[0]) ? (params[0] as string[]) : [];
    return [{ symbol: candidates.includes('DOGSUSDT') ? 'DOGSUSDT' : 'AVAXUSDT' }];
  };

  try {
    const resolved = await service.resolveWarehouseSymbol('AVAXUSD');

    assert.equal(resolved, 'AVAXUSDT');
    assert.equal(capturedQueries.length, 1);
    assert.match(capturedQueries[0].sql, /symbol = ANY/);
    assert.deepEqual(capturedQueries[0].params, [['AVAXUSD', 'AVAXUSDT'], 'AVAXUSD']);

    const chart = await service.getSymbolChart('AVAXUSD', {
      interval: '5m',
      limit: '1',
      endTime: '2026-04-13T03:05:00.000Z',
    });
    const chartQuery = capturedQueries.find((call) => call.sql.includes('WITH bounds AS'));

    assert.equal(chart.data.source, 'pg.market_candles_1m');
    assert.equal(chart.data.provenance.sourceLabel, 'Binance futures candles');
    assert.equal(chart.data.range.startTime, '2026-04-13T03:00:00.000Z');
    assert.match(String(chartQuery?.sql || ''), /\$4::timestamptz/);
    assert.equal((chartQuery?.params[3] as Date).toISOString(), '2026-04-13T03:05:00.000Z');
    assert.equal(chartQuery?.params[4], 1);

    service.binanceMarketService = {
      async getCandles(query: Record<string, unknown>) {
        assert.equal(query.symbol, 'DOGSUSDT');
        assert.equal(query.interval, '5m');
        assert.equal(query.limit, '2');
        return createSuccess([
          {
            openTime: Date.parse('2026-04-13T03:05:00.000Z'),
            open: 'live-102',
            high: '106',
            low: '99',
            close: '104',
            volume: '1200',
          },
          {
            openTime: Date.parse('2026-04-13T03:10:00.000Z'),
            open: '104',
            high: '110',
            low: '103',
            close: '109',
            volume: '1400',
          },
        ]);
      },
    };

    const hydratedChart = await service.getSymbolChart('DOGSUSDT', {
      interval: '5m',
      limit: '2',
    });

    assert.equal(hydratedChart.data.source, 'binance.futures.live+pg.market_candles_1m');
    assert.equal(
      hydratedChart.data.provenance.sourceLabel,
      'Binance futures live + warehouse candles'
    );
    assert.deepEqual(
      (hydratedChart.data.candles as Array<{ openTime: number }>).map((candle) => candle.openTime),
      [Date.parse('2026-04-13T03:05:00.000Z'), Date.parse('2026-04-13T03:10:00.000Z')]
    );
    assert.equal(hydratedChart.data.candles[0].open, 'live-102');
    assert.equal(hydratedChart.data.range.endTime, '2026-04-13T03:10:00.000Z');
  } finally {
    (strategyDataSource as any).query = originalQuery;
    (strategyDataSource as any).isInitialized = originalInitialized;
  }
}

async function runMarketMetricsServiceBatchAssertions(): Promise<void> {
  const service = new MarketMetricsService() as any;
  const capturedQueries: Array<{ sql: string; params: unknown[] }> = [];

  service.candleQueryBatchSize = 2;
  service.assetPriceRepository = {
    async getBySymbols(symbols: string[]) {
      return symbols.map((symbol) => ({
        brokerAssetId: `broker-${symbol}`,
        symbol,
        sourceSymbol: symbol,
        price: symbol === 'SOLUSDT' ? '155.50' : '100.00',
        source: 'delta_exchange',
        retrievedAt: new Date('2026-04-13T03:00:00.000Z'),
        updatedAt: new Date('2026-04-13T03:00:00.000Z'),
      }));
    },
  };

  const originalQuery = strategyDataSource.query.bind(strategyDataSource);
  const originalInitialized = strategyDataSource.isInitialized;
  const originalPgEnabled = env.pg.enabled;
  (env.pg as any).enabled = true;
  (strategyDataSource as any).isInitialized = true;
  (strategyDataSource as any).query = async (sql: string, params: unknown[]) => {
    capturedQueries.push({ sql, params });
    const symbols = Array.isArray(params?.[0]) ? (params[0] as string[]) : [];
    return symbols.map((symbol) => ({
      symbol,
      lastPrice: symbol === 'BTCUSDT' ? '67500.12' : null,
      snapshotAt: '2026-04-13T02:45:00.000Z',
      prevClose: symbol === 'BTCUSDT' ? '65000.00' : null,
      volume24h: symbol === 'BTCUSDT' ? '250000000' : null,
      high24h: symbol === 'BTCUSDT' ? '68000.55' : null,
      low24h: symbol === 'BTCUSDT' ? '64000.10' : null,
    }));
  };

  try {
    const metrics = await service.getMetricsForSymbols(['BTCUSDT', 'ETHUSDT', 'SOLUSDT']);

    assert.equal(capturedQueries.length, 2);
    assert.ok(capturedQueries.every((entry) => entry.sql.includes("INTERVAL '48 hours'")));
    assert.deepEqual(capturedQueries[0].params, [['BTCUSDT', 'ETHUSDT']]);
    assert.deepEqual(capturedQueries[1].params, [['SOLUSDT']]);
    assert.equal(metrics.get('BTCUSDT')?.lastPrice, 67500.12);
    assert.equal(metrics.get('SOLUSDT')?.lastPrice, 155.5);
    assert.equal(metrics.get('SOLUSDT')?.priceSource, 'delta_exchange');
  } finally {
    (env.pg as any).enabled = originalPgEnabled;
    (strategyDataSource as any).query = originalQuery;
    (strategyDataSource as any).isInitialized = originalInitialized;
  }
}

async function runMarketSnapshotRefreshServiceAssertions(): Promise<void> {
  const service = new MarketSnapshotRefreshService() as any;
  const upsertPayloads: Array<Array<Record<string, unknown>>> = [];
  const metricRequests: string[][] = [];
  const snapshotRequests: string[][] = [];

  service.refreshBatchSize = 1;

  service.assetRepository = {
    async listAssets() {
      return {
        data: [
          { id: 'asset-btc', symbol: 'BTCUSDT', name: 'Bitcoin', source: 'catalog' },
          { id: 'asset-eth', symbol: 'ETHUSDT', name: 'Ethereum', source: 'catalog' },
        ],
      };
    },
  };
  service.marketMetricsService = {
    async getMetricsForSymbols(symbols: string[]) {
      metricRequests.push([...symbols]);
      return new Map([
        [
          'BTCUSDT',
          {
            symbol: 'BTCUSDT',
            lastPrice: 67500.12,
            changePerc: 4.2,
            volume24h: 250000000,
            high24h: 68000.55,
            low24h: 65000.11,
            priceSource: 'pg.market_candles_1m',
            snapshotAt: new Date('2026-04-13T02:45:00.000Z'),
          },
        ],
      ]);
    },
  };
  service.marketSymbolSnapshotRepository = {
    async getBySymbols(symbols: string[]) {
      snapshotRequests.push([...symbols]);
      return [
        {
          symbol: 'ETHUSDT',
          assetId: 'asset-eth',
          name: 'Ethereum snapshot',
          source: 'catalog',
          lastPrice: '3300.55',
          change24h: 1.8,
          volume24h: 90000000,
          high24h: '3340.00',
          low24h: '3205.10',
          liquidityTier: 'Active',
          priceSource: 'snapshot',
          snapshotAt: new Date('2026-04-13T02:30:00.000Z'),
        },
      ];
    },
    async upsertSnapshots(payload: Array<Record<string, unknown>>) {
      upsertPayloads.push(payload);
    },
  };

  const response = await service.refreshSnapshots();
  assert.equal(response.data.message, 'Market snapshots refreshed');
  assert.equal(response.data.processedSymbols, 2);
  assert.equal(response.data.refreshedSnapshots, 2);
  assert.equal(response.data.insertedSnapshots, 1);
  assert.equal(response.data.updatedSnapshots, 1);
  assert.equal(response.data.skippedSymbols, 0);
  assert.deepEqual(metricRequests, [['BTCUSDT'], ['ETHUSDT']]);
  assert.deepEqual(snapshotRequests, [['BTCUSDT'], ['ETHUSDT']]);
  assert.equal(upsertPayloads.length, 2);
  assert.equal(upsertPayloads[0].length, 1);
  assert.equal(upsertPayloads[1].length, 1);
  assert.equal(upsertPayloads[0][0].symbol, 'BTCUSDT');
  assert.equal(upsertPayloads[0][0].liquidityTier, 'Core');
  assert.equal(upsertPayloads[0][0].priceSource, 'pg.market_candles_1m');
  assert.equal(upsertPayloads[1][0].symbol, 'ETHUSDT');
  assert.equal(upsertPayloads[1][0].liquidityTier, 'Active');
}

function runMarketsScriptWiringAssertions(): void {
  const packageSource = read('package.json');
  const packageJson = JSON.parse(packageSource) as { scripts?: Record<string, string> };
  const packageScripts = packageJson.scripts || {};
  const runPackageSuiteSource = read('scripts/_support/run-package-suite.ts');
  const smokeModulesSource = read('scripts/smokes/smoke-modules.sh');

  assert.equal(
    packageScripts['test:markets'],
    'node --import tsx scripts/_support/run-doc-aware-test.ts scripts/test-markets.ts'
  );
  assert.match(runPackageSuiteSource, /markets:\s*\['test:markets'\]/);
  assert.match(smokeModulesSource, /\/markets\/overview\?limit=5&offset=0/);
  assert.match(smokeModulesSource, /\/markets\/BTCUSDT\/chart\?interval=1h&limit=10/);
  assert.equal(
    packageScripts['check:markets-health'],
    'node --import tsx scripts/checks/check-markets-health.ts'
  );
}

async function main(): Promise<void> {
  await runMarketControllerAssertions();
  await runMarketsOverviewControllerAssertions();
  await runInternalMarketsSnapshotControllerAssertions();
  runMarketValidationAssertions();
  await runMarketsOverviewSnapshotAssertions();
  await runMarketsSymbolOverviewAssertions();
  await runMarketsChartWarehouseSymbolResolutionAssertions();
  await runMarketMetricsServiceBatchAssertions();
  await runMarketSnapshotRefreshServiceAssertions();
  runMarketsScriptWiringAssertions();
  console.log('Markets module assertions passed.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
