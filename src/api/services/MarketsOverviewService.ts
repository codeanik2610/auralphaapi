import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import {
  MarketAssetSummary,
  MarketChartResponse,
  MarketDataProvenance,
  MarketsOverviewMeta,
  MarketsOverviewResponse,
  MarketSymbolOverviewResponse,
} from '../contracts/MarketOverview';
import { SignalsListResponse } from '../contracts/Signal';
import { successResponse } from '../utils/response';
import { SignalsService } from './SignalsService';
import { MarketMetric, MarketMetricsService } from './MarketMetricsService';
import { AssetRepository } from '../../database/repositories/AssetRepository';
import {
  MarketSnapshotListQuery,
  MarketSymbolSnapshotRepository,
} from '../../database/repositories/MarketSymbolSnapshotRepository';
import { SignalRepository } from '../../database/repositories/SignalRepository';
import { WatchlistRepository } from '../../database/repositories/WatchlistRepository';
import { MarketSymbolSnapshot } from '../../database/entities/MarketSymbolSnapshot';
import {
  BadRequestAppError,
  NotFoundAppError,
  ServiceUnavailableAppError,
} from '../errors/AppError';
import { validateMarketCandlesQuery } from '../validators/market.validator';
import { strategyDataSource } from '../../database/pg-data-source';
import { env } from '../../env';
import { BinanceMarketCandle } from '../contracts/Binance';
import { Logger } from '../../lib/logger/Logger';

interface MarketsOverviewQuery {
  selectedSymbol?: string;
  sort?: string;
  order?: string;
  limit?: string;
  offset?: string;
  search?: string;
  signalFilter?: string;
  watchlistFilter?: string;
  liquidityTier?: string;
}

interface MarketSymbolQuery {
  signalsLimit?: string;
}

interface MarketChartQuery {
  interval?: string;
  limit?: string;
}

interface MarketAssetBase {
  id?: string | null;
  symbol: string;
  name?: string | null;
  source?: string | null;
}

interface PreparedMarketAsset {
  summary: MarketAssetSummary;
}

interface PrepareAssetsOptions {
  includeLiveMetrics?: boolean;
}

interface OverviewFilters {
  signalFilter: string;
  watchlistFilter: string;
  liquidityTierFilter: string;
}

interface OverviewExecutionTimings {
  cacheHit: boolean;
  totalMs: number;
  assetLookupMs?: number;
  prepareMs?: number;
  enrichmentMs?: number;
  filterSortMs?: number;
  snapshotQueryMs?: number;
  snapshotCountMs?: number;
  snapshotDataMs?: number;
  selectedAssetMs?: number;
}

interface OverviewBuildResult {
  data: MarketsOverviewResponse;
  mode: 'snapshot-query' | 'full-enrichment';
  timings: OverviewExecutionTimings;
  assetsLoaded: number;
  assetsPrepared: number;
  assetsFiltered: number;
  assetsReturned: number;
}

interface CachedOverviewEntry {
  expiresAt: number;
  staleExpiresAt: number;
  data: MarketsOverviewResponse;
}

const DEFAULT_ASSETS_LIMIT = 200;
const DEFAULT_SIGNALS_LIMIT = 20;
const DEFAULT_CHART_LIMIT = 120;
const CHART_SOURCE = 'pg.market_candles_1m';
const OVERVIEW_CACHE_TTL_MS = 15_000;
const OVERVIEW_STALE_CACHE_TTL_MS = 5 * 60_000;
const OVERVIEW_CACHE_MAX_ENTRIES = 200;
const OVERVIEW_PAGE_ENRICHMENT_TIMEOUT_MS = 2_500;
const OVERVIEW_FULL_ENRICHMENT_TIMEOUT_MS = 6_000;
const MARKET_DATA_STALE_AFTER_MS = 15 * 60_000;
const CHART_DATA_STALE_AFTER_MS = 15 * 60_000;
const log = new Logger(__filename);

const toNullableNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const toNullableIsoString = (value: Date | string | null | undefined): string | null => {
  if (!value) {
    return null;
  }
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

const getProvenanceSourceLabel = (
  mode: MarketDataProvenance['mode'],
  source?: string | null
): string => {
  const normalized = String(source || '').trim().toLowerCase();

  if (normalized === 'pg.market_candles_1m') {
    return 'Binance futures candles';
  }
  if (normalized === 'mudrex') {
    return 'Mudrex broker price cache';
  }
  if (normalized === 'delta_exchange') {
    return 'Delta Exchange broker price cache';
  }
  if (mode === 'snapshot') {
    return normalized ? `${source} snapshot` : 'Market snapshot record';
  }
  if (mode === 'broker-price-cache') {
    return normalized ? `${source} broker price cache` : 'Broker price cache';
  }
  if (mode === 'chart-candles') {
    return normalized ? String(source) : 'Chart candle warehouse';
  }
  return normalized ? String(source) : 'Live market data';
};

const getLiquidityTier = (volume24h: number | null): string | null => {
  if (volume24h === null || !Number.isFinite(volume24h)) {
    return null;
  }
  if (volume24h >= 1_000_000_000) {
    return 'Deep';
  }
  if (volume24h >= 100_000_000) {
    return 'Core';
  }
  if (volume24h >= 10_000_000) {
    return 'Active';
  }
  return 'Thin';
};

const createEmptySignalsResponse = (limit: number): SignalsListResponse => ({
  items: [],
  total: 0,
  limit,
  offset: 0,
});

@Service()
export class MarketsOverviewService {
  @Inject(() => SignalsService)
  private signalsService!: SignalsService;

  @Inject(() => MarketMetricsService)
  private marketMetricsService!: MarketMetricsService;

  @Inject(() => AssetRepository)
  private assetRepository!: AssetRepository;

  @Inject(() => MarketSymbolSnapshotRepository)
  private marketSymbolSnapshotRepository!: MarketSymbolSnapshotRepository;

  @Inject(() => WatchlistRepository)
  private watchlistRepository!: WatchlistRepository;

  @Inject(() => SignalRepository)
  private signalRepository!: SignalRepository;

  private readonly overviewCache = new Map<string, CachedOverviewEntry>();

  async getOverview(userId: string, query: MarketsOverviewQuery): Promise<ApiSuccessResponse<MarketsOverviewResponse>> {
    const startedAt = Date.now();
    const limit = query.limit ?? String(DEFAULT_ASSETS_LIMIT);
    const limitNumber = Math.max(1, Number(limit) || DEFAULT_ASSETS_LIMIT);
    const offset = query.offset ?? '0';
    const offsetNumber = Math.max(0, Number(offset) || 0);
    const requestedSymbol = this.normalizeOptionalSymbol(query.selectedSymbol);
    const sortKey = String(query.sort || 'volume').toLowerCase();
    const sortOrder = String(query.order || 'desc').toLowerCase() === 'asc' ? 1 : -1;
    const supportsSnapshotSort =
      this.marketSymbolSnapshotRepository.supportsOverviewSort(sortKey);
    const filters: OverviewFilters = {
      signalFilter: String(query.signalFilter || 'all').trim().toLowerCase(),
      watchlistFilter: String(query.watchlistFilter || 'all').trim().toLowerCase(),
      liquidityTierFilter: String(query.liquidityTier || 'all').trim().toLowerCase(),
    };

    const cacheKey = this.buildOverviewCacheKey(userId, query);
    const cached = this.getCachedOverview(cacheKey);
    if (cached) {
      this.logOverviewTiming({
        totalMs: Date.now() - startedAt,
        cacheHit: true,
        search: Boolean(query.search),
        sortKey,
        signalFilter: filters.signalFilter,
        watchlistFilter: filters.watchlistFilter,
        liquidityTierFilter: filters.liquidityTierFilter,
        assetsLoaded: cached.total,
        assetsPrepared: cached.total,
        assetsFiltered: cached.total,
        assetsReturned: cached.assets.length,
        mode: 'cache-hit',
        offset: offsetNumber,
        limit: limitNumber,
        selectedSymbol: cached.selectedSymbol,
      });
      const response = this.cloneOverviewResponse(cached);
      response.meta = this.buildOverviewMeta(response.meta?.buildMode || 'snapshot-query', 'fresh-hit');
      return successResponse(response);
    }

    const staleCached = this.getStaleCachedOverview(cacheKey);
    const needsFullSignalContext = this.needsFullSignalContext(sortKey, filters.signalFilter);
    const needsFullWatchlistContext = this.needsFullWatchlistContext(sortKey, filters.watchlistFilter);

    let result: OverviewBuildResult;

    if (!supportsSnapshotSort || needsFullSignalContext || needsFullWatchlistContext) {
      try {
        result = await this.withTimeout(
          this.getOverviewFromFullEnrichment(userId, {
            query,
            requestedSymbol,
            sortKey,
            sortOrder,
            limitNumber,
            offsetNumber,
            filters,
          }),
          OVERVIEW_FULL_ENRICHMENT_TIMEOUT_MS,
          'Markets overview full enrichment timed out'
        );
      } catch (error) {
        if (staleCached) {
          log.warn('markets overview fell back to stale cache', {
            error: error instanceof Error ? error.message : String(error),
            sortKey,
            signalFilter: filters.signalFilter,
            watchlistFilter: filters.watchlistFilter,
            liquidityTierFilter: filters.liquidityTierFilter,
            offset: offsetNumber,
            limit: limitNumber,
          });

          this.logOverviewTiming({
            totalMs: Date.now() - startedAt,
            cacheHit: false,
            search: Boolean(query.search),
            sortKey,
            signalFilter: filters.signalFilter,
            watchlistFilter: filters.watchlistFilter,
            liquidityTierFilter: filters.liquidityTierFilter,
            assetsLoaded: staleCached.total,
            assetsPrepared: staleCached.total,
            assetsFiltered: staleCached.total,
            assetsReturned: staleCached.assets.length,
            mode: 'stale-cache-fallback',
            offset: offsetNumber,
            limit: limitNumber,
            selectedSymbol: staleCached.selectedSymbol,
          });

          const response = this.cloneOverviewResponse(staleCached);
          response.meta = this.buildOverviewMeta(
            response.meta?.buildMode || 'snapshot-query',
            'stale-fallback'
          );
          return successResponse(response);
        }
        throw error;
      }
    } else {
      result = await this.getOverviewFromSnapshots(userId, {
        query,
        requestedSymbol,
        sortKey,
        sortOrder,
        limitNumber,
        offsetNumber,
        filters,
      });
    }

    this.setCachedOverview(cacheKey, result.data);
    this.logOverviewTiming({
      ...result.timings,
      search: Boolean(query.search),
      sortKey,
      signalFilter: filters.signalFilter,
      watchlistFilter: filters.watchlistFilter,
      liquidityTierFilter: filters.liquidityTierFilter,
      assetsLoaded: result.assetsLoaded,
      assetsPrepared: result.assetsPrepared,
      assetsFiltered: result.assetsFiltered,
      assetsReturned: result.assetsReturned,
      mode: result.mode,
      offset: offsetNumber,
      limit: limitNumber,
      selectedSymbol: result.data.selectedSymbol,
    });

    return successResponse(result.data);
  }

  async getSymbolOverview(
    userId: string,
    symbol: string,
    query: MarketSymbolQuery
  ): Promise<ApiSuccessResponse<MarketSymbolOverviewResponse>> {
    const normalizedSymbol = this.requireSymbol(symbol);
    const signalsLimit = query.signalsLimit ?? String(DEFAULT_SIGNALS_LIMIT);
    const signalsLimitNumber = Number(signalsLimit) || DEFAULT_SIGNALS_LIMIT;

    const [asset, preparedAssets, signalsResponse, watchlists] = await Promise.all([
      this.assetRepository.getAssetBySymbol(normalizedSymbol),
      this.prepareAssets(
        [
          {
            symbol: normalizedSymbol,
            name: normalizedSymbol,
          },
        ],
        {
          includeLiveMetrics: true,
        }
      ),
      this.signalsService.getSignals(userId, {
        limit: signalsLimit,
        offset: '0',
        symbol: normalizedSymbol,
      }),
      this.watchlistRepository.listWatchlistsContainingSymbol(userId, normalizedSymbol),
    ]);

    const prepared = preparedAssets[0] || null;
    if (!asset && !prepared?.summary?.price && !prepared?.summary?.snapshot_at) {
      throw new NotFoundAppError(`Market symbol ${normalizedSymbol} was not found`);
    }

    return successResponse({
      symbol: normalizedSymbol,
      asset: prepared
        ? {
            ...prepared.summary,
            name: asset?.name || prepared.summary.name || normalizedSymbol,
          }
        : null,
      signals: signalsResponse.data ?? createEmptySignalsResponse(signalsLimitNumber),
      watchlists: {
        total: watchlists.length,
        memberships: watchlists.map((watchlist) => ({
          id: watchlist.id,
          name: watchlist.name,
          type: watchlist.type,
          updatedAt: watchlist.updatedAt.toISOString(),
        })),
      },
    });
  }

  async getSymbolChart(
    symbol: string,
    query: MarketChartQuery
  ): Promise<ApiSuccessResponse<MarketChartResponse>> {
    const params = validateMarketCandlesQuery({
      symbol,
      interval: query.interval,
      limit: query.limit ?? String(DEFAULT_CHART_LIMIT),
    });

    const candles = await this.fetchChartCandles(params.symbol, params.interval, params.limit);
    const startTime = candles[0]?.openTime ? new Date(candles[0].openTime).toISOString() : null;
    const endTime = candles[candles.length - 1]?.openTime
      ? new Date(candles[candles.length - 1].openTime).toISOString()
      : null;
    const chartProvenance = this.buildChartProvenance(CHART_SOURCE, endTime);

    return successResponse({
      symbol: params.symbol,
      interval: params.interval,
      limit: params.limit,
      source: CHART_SOURCE,
      provenance: chartProvenance,
      candles,
      range: {
        startTime,
        endTime,
      },
    });
  }

  private async getOverviewFromSnapshots(
    userId: string,
    options: {
      query: MarketsOverviewQuery;
      requestedSymbol: string | null;
      sortKey: string;
      sortOrder: number;
      limitNumber: number;
      offsetNumber: number;
      filters: OverviewFilters;
    }
  ): Promise<OverviewBuildResult> {
    const startedAt = Date.now();
    const snapshotQuery: MarketSnapshotListQuery = {
      limit: options.limitNumber,
      offset: options.offsetNumber,
      search: options.query.search,
      sort: options.sortKey,
      order: options.sortOrder === 1 ? 'asc' : 'desc',
      liquidityTier: options.filters.liquidityTierFilter,
    };

    const snapshotStartedAt = Date.now();
    const snapshotResult = await this.marketSymbolSnapshotRepository.listOverviewSnapshots(snapshotQuery);
    const snapshotQueryMs = Date.now() - snapshotStartedAt;

    if (!snapshotResult.total) {
      const hasSnapshots = await this.marketSymbolSnapshotRepository.hasSnapshots();
      if (!hasSnapshots || Boolean(String(options.query.search || '').trim()) || Boolean(options.requestedSymbol)) {
        return this.getOverviewFromFullEnrichment(userId, options);
      }
    }

    const baseAssets = snapshotResult.data.map((snapshot) => this.mapSnapshotToSummary(snapshot));
    const pageSymbols = Array.from(
      new Set(
        [
          ...baseAssets.map((asset) => asset.symbol),
          options.requestedSymbol || '',
        ].filter(Boolean)
      )
    );

    const pageEnrichment = await this.tryEnrichAssetsForSymbols(
      userId,
      baseAssets,
      pageSymbols,
      OVERVIEW_PAGE_ENRICHMENT_TIMEOUT_MS,
      'overview-page'
    );
    const pageAssets = pageEnrichment.assets;
    const enrichmentMs = pageEnrichment.durationMs;

    let selectedAsset: MarketAssetSummary | null = null;
    let selectedAssetMs = 0;

    if (options.requestedSymbol) {
      selectedAsset = pageAssets.find((asset) => asset.symbol === options.requestedSymbol) || null;

      if (!selectedAsset) {
        const selectedStartedAt = Date.now();
        const selectedSnapshot = await this.marketSymbolSnapshotRepository.getBySymbol(options.requestedSymbol);
        if (selectedSnapshot) {
          const selectedEnrichment = await this.tryEnrichAssetsForSymbols(
            userId,
            [this.mapSnapshotToSummary(selectedSnapshot)],
            [selectedSnapshot.symbol],
            OVERVIEW_PAGE_ENRICHMENT_TIMEOUT_MS,
            'overview-selected-symbol'
          );
          const [enrichedSelected] = selectedEnrichment.assets;
          selectedAsset = enrichedSelected || null;
        }
        selectedAssetMs = Date.now() - selectedStartedAt;
      }
    }

    let selectedSymbol = options.requestedSymbol;
    if (!selectedAsset) {
      selectedAsset = pageAssets[0] || null;
      selectedSymbol = selectedAsset?.symbol || '';
    }

    return {
      data: {
        assets: pageAssets,
        total: snapshotResult.total,
        limit: options.limitNumber,
        offset: options.offsetNumber,
        selectedSymbol: selectedSymbol || null,
        selectedAsset,
        meta: this.buildOverviewMeta('snapshot-query', 'miss'),
      },
      mode: 'snapshot-query',
      timings: {
        cacheHit: false,
        totalMs: Date.now() - startedAt,
        snapshotQueryMs,
        snapshotCountMs: snapshotResult.timings.countMs,
        snapshotDataMs: snapshotResult.timings.dataMs,
        enrichmentMs,
        selectedAssetMs,
      },
      assetsLoaded: snapshotResult.total,
      assetsPrepared: baseAssets.length,
      assetsFiltered: snapshotResult.total,
      assetsReturned: pageAssets.length,
    };
  }

  private async getOverviewFromFullEnrichment(
    userId: string,
    options: {
      query: MarketsOverviewQuery;
      requestedSymbol: string | null;
      sortKey: string;
      sortOrder: number;
      limitNumber: number;
      offsetNumber: number;
      filters: OverviewFilters;
    }
  ): Promise<OverviewBuildResult> {
    const startedAt = Date.now();

    const assetLookupStartedAt = Date.now();
    const matchingSnapshots = await this.marketSymbolSnapshotRepository.listMatchingSnapshots({
      search: options.query.search,
      liquidityTier: options.filters.liquidityTierFilter,
    });
    const assetLookupMs = Date.now() - assetLookupStartedAt;

    const prepareStartedAt = Date.now();
    let preparedAssets = matchingSnapshots.map((snapshot) => ({
      summary: this.mapSnapshotToSummary(snapshot),
    }));

    if (options.requestedSymbol && !preparedAssets.some((asset) => asset.summary.symbol === options.requestedSymbol)) {
      const requestedPreparedAssets = await this.prepareAssets(
        [
          {
            symbol: options.requestedSymbol,
            name: options.requestedSymbol,
          },
        ],
        {
          includeLiveMetrics: false,
        }
      );

      requestedPreparedAssets.forEach((asset) => {
        if (!preparedAssets.some((entry) => entry.summary.symbol === asset.summary.symbol)) {
          preparedAssets.push(asset);
        }
      });
    }

    if (!preparedAssets.length) {
      const assetBases = await this.assetRepository.listAssetBases(options.query.search);
      preparedAssets = await this.prepareAssets(assetBases, {
        includeLiveMetrics: false,
      });
    }
    const prepareMs = Date.now() - prepareStartedAt;

    const enrichmentStartedAt = Date.now();
    const enrichedAssets = await this.enrichAssetsForSymbols(
      userId,
      preparedAssets.map((asset) => asset.summary),
      preparedAssets.map((asset) => asset.summary.symbol),
      'full-enrichment'
    );
    const enrichmentMs = Date.now() - enrichmentStartedAt;

    const filterSortStartedAt = Date.now();
    const filteredAssets = this.filterAssets(enrichedAssets, options.filters);
    const sortedAssets = this.sortAssets(filteredAssets, options.sortKey, options.sortOrder);
    let selectedSymbol = options.requestedSymbol;
    let selectedAsset = selectedSymbol
      ? sortedAssets.find((asset) => asset.symbol === selectedSymbol) || null
      : null;

    if (!selectedAsset) {
      selectedAsset = sortedAssets[0] || null;
      selectedSymbol = selectedAsset?.symbol || '';
    }

    const pagedAssets = sortedAssets.slice(
      options.offsetNumber,
      options.offsetNumber + options.limitNumber
    );
    const filterSortMs = Date.now() - filterSortStartedAt;

    return {
      data: {
        assets: pagedAssets,
        total: sortedAssets.length,
        limit: options.limitNumber,
        offset: options.offsetNumber,
        selectedSymbol: selectedSymbol || null,
        selectedAsset,
        meta: this.buildOverviewMeta('full-enrichment', 'miss'),
      },
      mode: 'full-enrichment',
      timings: {
        cacheHit: false,
        totalMs: Date.now() - startedAt,
        assetLookupMs,
        prepareMs,
        enrichmentMs,
        filterSortMs,
      },
      assetsLoaded: matchingSnapshots.length || preparedAssets.length,
      assetsPrepared: preparedAssets.length,
      assetsFiltered: filteredAssets.length,
      assetsReturned: pagedAssets.length,
    };
  }

  private async prepareAssets(
    assets: MarketAssetBase[],
    options: PrepareAssetsOptions = {}
  ): Promise<PreparedMarketAsset[]> {
    const normalizedSymbols = Array.from(
      new Set(
        (assets || [])
          .map((asset) => this.normalizeOptionalSymbol(asset.symbol))
          .filter((symbol): symbol is string => Boolean(symbol))
      )
    );

    if (!normalizedSymbols.length) {
      return [];
    }

    const includeLiveMetrics = options.includeLiveMetrics !== false;
    const snapshots = await this.marketSymbolSnapshotRepository.getBySymbols(normalizedSymbols);
    const metricsBySymbol = includeLiveMetrics
      ? await this.marketMetricsService.getMetricsForSymbols(normalizedSymbols)
      : new Map<string, MarketMetric>();

    const snapshotsBySymbol = new Map(
      (snapshots || []).map((snapshot) => [this.normalizeOptionalSymbol(snapshot.symbol) || '', snapshot])
    );

    return assets
      .map((asset) => {
        const normalizedSymbol = this.normalizeOptionalSymbol(asset.symbol);
        if (!normalizedSymbol) {
          return null;
        }
        return this.buildPreparedAsset(
          asset,
          metricsBySymbol.get(normalizedSymbol),
          snapshotsBySymbol.get(normalizedSymbol)
        );
      })
      .filter((item): item is PreparedMarketAsset => Boolean(item));
  }

  private async enrichAssetsForSymbols(
    userId: string,
    assets: MarketAssetSummary[],
    symbols: string[],
    context = 'overview'
  ): Promise<MarketAssetSummary[]> {
    const normalizedSymbols = Array.from(
      new Set(
        (symbols || [])
          .map((symbol) => this.normalizeOptionalSymbol(symbol))
          .filter((symbol): symbol is string => Boolean(symbol))
      )
    );

    if (!normalizedSymbols.length || !assets.length) {
      return assets;
    }

    const enrichmentStartedAt = Date.now();
    const signalsPromise = (async () => {
      const startedAt = Date.now();
      const result = await this.signalRepository.getLatestSignalsBySymbols(userId, normalizedSymbols);
      return {
        result,
        durationMs: Date.now() - startedAt,
      };
    })();
    const watchlistsPromise = (async () => {
      const startedAt = Date.now();
      const result = await this.watchlistRepository.countWatchlistsBySymbols(userId, normalizedSymbols);
      return {
        result,
        durationMs: Date.now() - startedAt,
      };
    })();

    const [signalsResult, watchlistsResult] = await Promise.all([signalsPromise, watchlistsPromise]);
    const latestSignalsBySymbol = signalsResult.result;
    const watchlistCountsBySymbol = watchlistsResult.result;
    const enrichmentMs = Date.now() - enrichmentStartedAt;

    const enrichmentLogMethod =
      enrichmentMs >= 1500 || signalsResult.durationMs >= 1000 || watchlistsResult.durationMs >= 1000
        ? 'warn'
        : 'info';
    log[enrichmentLogMethod]('markets overview enrichment timing', {
      context,
      symbols: normalizedSymbols.length,
      totalMs: enrichmentMs,
      signalsQueryMs: signalsResult.durationMs,
      watchlistsQueryMs: watchlistsResult.durationMs,
    });

    return assets.map((asset) => {
      const symbol = asset.symbol;
      const latestSignal = latestSignalsBySymbol.get(symbol);

      return {
        ...asset,
        latest_signal_source: latestSignal?.signal.source ?? asset.latest_signal_source ?? null,
        latest_signal_status: latestSignal?.signal.status ?? asset.latest_signal_status ?? null,
        latest_signal_confidence:
          latestSignal && Number.isFinite(latestSignal.signal.confidence)
            ? Number(latestSignal.signal.confidence)
            : asset.latest_signal_confidence ?? null,
        latest_signal_time: latestSignal
          ? toNullableIsoString(latestSignal.signal.signalTime ?? latestSignal.signal.createdAt)
          : asset.latest_signal_time ?? null,
        latest_signal_timeframe: latestSignal?.signal.timeframe ?? asset.latest_signal_timeframe ?? null,
        signal_count: latestSignal?.signalCount ?? asset.signal_count ?? 0,
        watchlist_count: watchlistCountsBySymbol.get(symbol) ?? asset.watchlist_count ?? 0,
      };
    });
  }

  private async tryEnrichAssetsForSymbols(
    userId: string,
    assets: MarketAssetSummary[],
    symbols: string[],
    timeoutMs: number,
    context: string
  ): Promise<{ assets: MarketAssetSummary[]; durationMs: number }> {
    const startedAt = Date.now();

    try {
      const enrichedAssets = await this.withTimeout(
        this.enrichAssetsForSymbols(userId, assets, symbols, context),
        timeoutMs,
        `Markets overview ${context} enrichment timed out`
      );

      return {
        assets: enrichedAssets,
        durationMs: Date.now() - startedAt,
      };
    } catch (error) {
      log.warn('markets overview enrichment degraded to snapshot-only data', {
        context,
        timeoutMs,
        symbols: symbols.length,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        assets,
        durationMs: Date.now() - startedAt,
      };
    }
  }

  private withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    timeoutMessage: string
  ): Promise<T> {
    let timeoutHandle: NodeJS.Timeout | null = null;

    return new Promise<T>((resolve, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new ServiceUnavailableAppError(timeoutMessage));
      }, timeoutMs);

      promise
        .then((value) => {
          if (timeoutHandle) {
            clearTimeout(timeoutHandle);
          }
          resolve(value);
        })
        .catch((error) => {
          if (timeoutHandle) {
            clearTimeout(timeoutHandle);
          }
          reject(error);
        });
    });
  }

  private filterAssets(assets: MarketAssetSummary[], filters: OverviewFilters): MarketAssetSummary[] {
    return assets.filter((asset) => {
      const hasSignal = Number(asset.signal_count || 0) > 0;
      const hasWatchlist = Number(asset.watchlist_count || 0) > 0;
      const assetLiquidityTier = String(asset.liquidity_tier || '').trim().toLowerCase();

      if (filters.signalFilter === 'with_signal' && !hasSignal) {
        return false;
      }

      if (filters.signalFilter === 'no_signal' && hasSignal) {
        return false;
      }

      if (filters.watchlistFilter === 'watchlisted' && !hasWatchlist) {
        return false;
      }

      if (filters.watchlistFilter === 'untracked' && hasWatchlist) {
        return false;
      }

      if (
        filters.liquidityTierFilter &&
        filters.liquidityTierFilter !== 'all' &&
        assetLiquidityTier !== filters.liquidityTierFilter
      ) {
        return false;
      }

      return true;
    });
  }

  private sortAssets(assets: MarketAssetSummary[], sortKey: string, sortOrder: number): MarketAssetSummary[] {
    return [...assets].sort((left, right) => {
      const pickValue = (asset: MarketAssetSummary) => {
        if (sortKey === 'price') return asset.price ?? Number.NaN;
        if (sortKey === 'change' || sortKey === 'change_perc') return asset.change_perc ?? Number.NaN;
        if (sortKey === 'signalconfidence') {
          return asset.latest_signal_confidence ?? Number.NaN;
        }
        if (sortKey === 'signalfreshness') {
          return asset.latest_signal_time ? new Date(asset.latest_signal_time).getTime() : Number.NaN;
        }
        if (sortKey === 'signalcount') return asset.signal_count ?? Number.NaN;
        if (sortKey === 'watchlists') return asset.watchlist_count ?? Number.NaN;
        if (sortKey === 'symbol') return asset.symbol;
        if (sortKey === 'name') return asset.name;
        return asset.volume ?? Number.NaN;
      };

      const leftValue = pickValue(left);
      const rightValue = pickValue(right);

      if (typeof leftValue === 'string' || typeof rightValue === 'string') {
        return String(leftValue || '').localeCompare(String(rightValue || '')) * sortOrder;
      }

      const leftNumeric = Number(leftValue);
      const rightNumeric = Number(rightValue);
      const leftHasValue = Number.isFinite(leftNumeric);
      const rightHasValue = Number.isFinite(rightNumeric);
      if (!leftHasValue && !rightHasValue) return 0;
      if (!leftHasValue) return 1;
      if (!rightHasValue) return -1;
      return (leftNumeric - rightNumeric) * sortOrder;
    });
  }

  private needsFullSignalContext(sortKey: string, signalFilter: string): boolean {
    return signalFilter !== 'all' || ['signalconfidence', 'signalfreshness', 'signalcount'].includes(sortKey);
  }

  private needsFullWatchlistContext(sortKey: string, watchlistFilter: string): boolean {
    return watchlistFilter !== 'all' || sortKey === 'watchlists';
  }

  private buildAssetProvenance(
    mode: Exclude<MarketDataProvenance['mode'], 'chart-candles'>,
    source: string | null,
    observedAt: Date | string | null | undefined
  ): MarketDataProvenance {
    return this.buildProvenance(mode, source, observedAt, MARKET_DATA_STALE_AFTER_MS);
  }

  private buildChartProvenance(
    source: string | null,
    observedAt: Date | string | null | undefined
  ): MarketDataProvenance {
    return this.buildProvenance('chart-candles', source, observedAt, CHART_DATA_STALE_AFTER_MS);
  }

  private buildProvenance(
    mode: MarketDataProvenance['mode'],
    source: string | null,
    observedAt: Date | string | null | undefined,
    staleAfterMs: number
  ): MarketDataProvenance {
    const observedIso = toNullableIsoString(observedAt);
    const observedTimestamp = observedIso ? new Date(observedIso).getTime() : Number.NaN;
    const freshnessMs = Number.isFinite(observedTimestamp)
      ? Math.max(0, Date.now() - observedTimestamp)
      : null;

    return {
      mode,
      source,
      sourceLabel: getProvenanceSourceLabel(mode, source),
      observedAt: observedIso,
      freshnessMs,
      staleAfterMs,
      isStale: freshnessMs !== null ? freshnessMs > staleAfterMs : false,
    };
  }

  private buildOverviewMeta(
    buildMode: MarketsOverviewMeta['buildMode'],
    cacheState: MarketsOverviewMeta['cacheState']
  ): MarketsOverviewMeta {
    const generatedAt = new Date().toISOString();
    const buildSummary =
      buildMode === 'full-enrichment'
        ? 'Live-enriched board with signal and watchlist overlays'
        : 'Snapshot-backed board with page-level enrichment';

    if (cacheState === 'fresh-hit') {
      return {
        buildMode,
        cacheState,
        generatedAt,
        staleCacheFallback: false,
        summary: `${buildSummary} served from fresh overview cache`,
      };
    }

    if (cacheState === 'stale-fallback') {
      return {
        buildMode,
        cacheState,
        generatedAt,
        staleCacheFallback: true,
        summary: 'Stale cached overview shown while live market context recovers',
      };
    }

    return {
      buildMode,
      cacheState,
      generatedAt,
      staleCacheFallback: false,
      summary: buildSummary,
    };
  }

  private mapSnapshotToSummary(snapshot: MarketSymbolSnapshot): MarketAssetSummary {
    const volume = snapshot.volume24h ?? null;
    return {
      symbol: this.requireSymbol(snapshot.symbol),
      name: snapshot.name || snapshot.symbol,
      price: toNullableNumber(snapshot.lastPrice),
      change_perc: snapshot.change24h ?? null,
      volume,
      high_24h: toNullableNumber(snapshot.high24h),
      low_24h: toNullableNumber(snapshot.low24h),
      liquidity_tier: snapshot.liquidityTier ?? getLiquidityTier(volume),
      price_source: snapshot.priceSource ?? null,
      snapshot_at: toNullableIsoString(snapshot.snapshotAt),
      provenance: this.buildAssetProvenance(
        'snapshot',
        snapshot.priceSource ?? null,
        snapshot.snapshotAt
      ),
    };
  }

  private buildOverviewCacheKey(userId: string, query: MarketsOverviewQuery): string {
    return JSON.stringify({
      userId,
      selectedSymbol: this.normalizeOptionalSymbol(query.selectedSymbol),
      sort: String(query.sort || 'volume').toLowerCase(),
      order: String(query.order || 'desc').toLowerCase(),
      limit: Math.max(1, Number(query.limit) || DEFAULT_ASSETS_LIMIT),
      offset: Math.max(0, Number(query.offset) || 0),
      search: String(query.search || '').trim().toLowerCase(),
      signalFilter: String(query.signalFilter || 'all').trim().toLowerCase(),
      watchlistFilter: String(query.watchlistFilter || 'all').trim().toLowerCase(),
      liquidityTier: String(query.liquidityTier || 'all').trim().toLowerCase(),
    });
  }

  private getCachedOverview(key: string): MarketsOverviewResponse | null {
    const cached = this.getCacheEntry(key);
    if (!cached) {
      return null;
    }
    if (cached.expiresAt <= Date.now()) {
      return null;
    }
    return cached.data;
  }

  private getStaleCachedOverview(key: string): MarketsOverviewResponse | null {
    const cached = this.getCacheEntry(key);
    return cached ? cached.data : null;
  }

  private getCacheEntry(key: string): CachedOverviewEntry | null {
    const cached = this.overviewCache.get(key);
    if (!cached) {
      return null;
    }
    if (cached.staleExpiresAt <= Date.now()) {
      this.overviewCache.delete(key);
      return null;
    }
    return cached;
  }

  private setCachedOverview(key: string, data: MarketsOverviewResponse): void {
    this.pruneOverviewCache();
    this.overviewCache.set(key, {
      expiresAt: Date.now() + OVERVIEW_CACHE_TTL_MS,
      staleExpiresAt: Date.now() + OVERVIEW_STALE_CACHE_TTL_MS,
      data: this.cloneOverviewResponse(data),
    });
  }

  private pruneOverviewCache(): void {
    const now = Date.now();
    for (const [key, value] of this.overviewCache.entries()) {
      if (value.staleExpiresAt <= now) {
        this.overviewCache.delete(key);
      }
    }

    if (this.overviewCache.size < OVERVIEW_CACHE_MAX_ENTRIES) {
      return;
    }

    const oldestEntries = [...this.overviewCache.entries()]
      .sort((left, right) => left[1].staleExpiresAt - right[1].staleExpiresAt)
      .slice(0, Math.max(1, Math.ceil(this.overviewCache.size * 0.2)));

    oldestEntries.forEach(([key]) => {
      this.overviewCache.delete(key);
    });
  }

  private cloneOverviewResponse(data: MarketsOverviewResponse): MarketsOverviewResponse {
    return JSON.parse(JSON.stringify(data)) as MarketsOverviewResponse;
  }

  private logOverviewTiming(payload: {
    totalMs: number;
    cacheHit: boolean;
    assetLookupMs?: number;
    prepareMs?: number;
    enrichmentMs?: number;
    filterSortMs?: number;
    snapshotQueryMs?: number;
    snapshotCountMs?: number;
    snapshotDataMs?: number;
    selectedAssetMs?: number;
    search: boolean;
    sortKey: string;
    signalFilter: string;
    watchlistFilter: string;
    liquidityTierFilter: string;
    assetsLoaded: number;
    assetsPrepared: number;
    assetsFiltered: number;
    assetsReturned: number;
    mode: string;
    offset: number;
    limit: number;
    selectedSymbol: string | null;
  }): void {
    const logMethod = payload.totalMs >= 1500 || payload.mode === 'full-enrichment' ? 'warn' : 'info';
    log[logMethod]('markets overview timing', payload);
  }

  private buildPreparedAsset(
    asset: MarketAssetBase,
    metrics?: MarketMetric,
    snapshot?: MarketSymbolSnapshot | null
  ): PreparedMarketAsset {
    const symbol = this.requireSymbol(asset.symbol);
    const price = metrics?.lastPrice ?? toNullableNumber(snapshot?.lastPrice);
    const change24h = metrics?.changePerc ?? snapshot?.change24h ?? null;
    const volume24h = metrics?.volume24h ?? snapshot?.volume24h ?? null;
    const high24h = metrics?.high24h ?? toNullableNumber(snapshot?.high24h);
    const low24h = metrics?.low24h ?? toNullableNumber(snapshot?.low24h);
    const snapshotAt = metrics?.snapshotAt ?? snapshot?.snapshotAt ?? null;
    const liquidityTier = snapshot?.liquidityTier ?? getLiquidityTier(volume24h);
    const priceSource = metrics?.priceSource ?? snapshot?.priceSource ?? null;
    const hasLiveMetricContext = Boolean(
      metrics &&
        (metrics.priceSource || metrics.snapshotAt || metrics.lastPrice !== null || metrics.volume24h !== null)
    );
    const provenanceMode: Exclude<MarketDataProvenance['mode'], 'chart-candles'> = hasLiveMetricContext
      ? metrics?.priceSource === 'pg.market_candles_1m'
        ? 'live-candles'
        : 'broker-price-cache'
      : 'snapshot';

    return {
      summary: {
        symbol,
        name: asset.name || snapshot?.name || symbol,
        price,
        change_perc: change24h,
        volume: volume24h,
        high_24h: high24h,
        low_24h: low24h,
        liquidity_tier: liquidityTier,
        price_source: priceSource,
        snapshot_at: toNullableIsoString(snapshotAt),
        provenance: this.buildAssetProvenance(provenanceMode, priceSource, snapshotAt),
      },
    };
  }

  private async fetchChartCandles(
    symbol: string,
    interval: string,
    limit: number
  ): Promise<BinanceMarketCandle[]> {
    if (!env.pg.enabled) {
      throw new ServiceUnavailableAppError(
        'Postgres market data is not enabled. Enable env.pg.enabled to load market charts.'
      );
    }

    if (!strategyDataSource.isInitialized) {
      await strategyDataSource.initialize();
    }

    const resolvedSymbol = await this.resolveWarehouseSymbol(symbol);
    const intervalSeconds = this.intervalToSeconds(interval);
    const lookbackSeconds = Math.max(intervalSeconds * (limit + 2), intervalSeconds * 10);

    const rows = await strategyDataSource.query(
      `WITH bounds AS (
         SELECT MAX(open_time) AS end_time
         FROM market_candles_1m
         WHERE symbol = $1
       ),
       base AS (
         SELECT
           open_time,
           open,
           high,
           low,
           close,
           volume,
           floor(extract(epoch from open_time) / $2) * $2 AS bucket_ts
         FROM market_candles_1m
         CROSS JOIN bounds
         WHERE symbol = $1
           AND interval = (
             SELECT interval
             FROM market_candles_1m
             WHERE symbol = $1
             ORDER BY open_time DESC
             LIMIT 1
           )
           AND bounds.end_time IS NOT NULL
           AND open_time BETWEEN (bounds.end_time - ($3 || ' seconds')::interval) AND bounds.end_time
       )
       SELECT
         bucket_ts,
         (array_agg(open ORDER BY open_time ASC))[1] AS open,
         max(high) AS high,
         min(low) AS low,
         (array_agg(close ORDER BY open_time DESC))[1] AS close,
         sum(volume) AS volume
       FROM base
       GROUP BY bucket_ts
       ORDER BY bucket_ts DESC
       LIMIT $4`,
      [resolvedSymbol, intervalSeconds, lookbackSeconds, limit]
    );

    return (rows || [])
      .map((row: Record<string, unknown>) => {
        const bucket = Number(row.bucket_ts);
        if (!Number.isFinite(bucket)) {
          return null;
        }
        return {
          openTime: Math.round(bucket * 1000),
          open: String(row.open ?? '0'),
          high: String(row.high ?? '0'),
          low: String(row.low ?? '0'),
          close: String(row.close ?? '0'),
          volume: String(row.volume ?? '0'),
        } as BinanceMarketCandle;
      })
      .filter((item: BinanceMarketCandle | null): item is BinanceMarketCandle => Boolean(item))
      .reverse();
  }

  private intervalToSeconds(interval: string): number {
    const normalized = String(interval || '').trim().toLowerCase();
    const match = normalized.match(/^(\d+)([mhdw])$/);
    if (!match) {
      throw new BadRequestAppError('Unsupported interval');
    }
    const value = Number(match[1]);
    if (!Number.isFinite(value) || value <= 0) {
      throw new BadRequestAppError('Unsupported interval');
    }
    switch (match[2]) {
      case 'm':
        return value * 60;
      case 'h':
        return value * 60 * 60;
      case 'd':
        return value * 60 * 60 * 24;
      case 'w':
        return value * 60 * 60 * 24 * 7;
      default:
        throw new BadRequestAppError('Unsupported interval');
    }
  }

  private requireSymbol(symbol: string): string {
    const normalized = this.normalizeOptionalSymbol(symbol);
    if (!normalized) {
      throw new BadRequestAppError('symbol is required');
    }
    if (!/^[A-Z0-9_:-]+$/.test(normalized)) {
      throw new BadRequestAppError('symbol contains invalid characters');
    }
    return normalized;
  }

  private normalizeOptionalSymbol(symbol?: string | null): string | null {
    const normalized = String(symbol || '').trim().toUpperCase();
    return normalized || null;
  }

  private async resolveWarehouseSymbol(symbol: string): Promise<string> {
    const candidates = this.buildMarketSymbolCandidates(symbol);
    if (!candidates.length) {
      return this.requireSymbol(symbol);
    }

    const rows = await strategyDataSource.query(
      `SELECT symbol, MAX(open_time) AS latest_open
       FROM market_candles_1m
       WHERE symbol = ANY($1::text[])
       GROUP BY symbol
       ORDER BY CASE WHEN symbol = $2 THEN 0 ELSE 1 END, MAX(open_time) DESC
       LIMIT 1`,
      [candidates, candidates[0]]
    );

    const resolved = String(rows?.[0]?.symbol || '').trim().toUpperCase();
    return resolved || candidates[0];
  }

  private buildMarketSymbolCandidates(value: unknown): string[] {
    const normalized = this.normalizeOptionalSymbol(String(value || ''));
    if (!normalized) {
      return [];
    }

    const candidates = new Set<string>([normalized]);
    if (normalized.endsWith('USD') && !normalized.endsWith('USDT')) {
      candidates.add(`${normalized.slice(0, -3)}USDT`);
    }
    if (normalized.endsWith('USDC') || normalized.endsWith('BUSD') || normalized.endsWith('FDUSD')) {
      candidates.add(`${normalized.replace(/(USDC|BUSD|FDUSD)$/u, '')}USDT`);
    }
    if (
      /^[A-Z0-9]{2,20}$/u.test(normalized) &&
      !['USDT', 'USDC', 'BUSD', 'FDUSD', 'USD', 'INR', 'BTC', 'ETH'].some((quote) =>
        normalized.endsWith(quote)
      )
    ) {
      candidates.add(`${normalized}USDT`);
    }

    return Array.from(candidates);
  }
}
