import { Inject, Service } from 'typedi';
import { env } from '../../env';
import { Logger } from '../../lib/logger';
import { strategyDataSource } from '../../database/pg-data-source';
import { AssetPriceRepository } from '../../database';

export interface MarketMetric {
  symbol: string;
  lastPrice: number | null;
  changePerc: number | null;
  volume24h: number | null;
  high24h: number | null;
  low24h: number | null;
  priceSource: string | null;
  snapshotAt: Date | null;
}

const log = new Logger(__filename);
const DEFAULT_CANDLE_QUERY_BATCH_SIZE = 200;

const chunkValues = <T>(values: T[], size: number): T[][] => {
  const normalizedSize = Math.max(1, Math.trunc(size) || 1);
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += normalizedSize) {
    chunks.push(values.slice(index, index + normalizedSize));
  }
  return chunks;
};

@Service()
export class MarketMetricsService {
  protected candleQueryBatchSize = DEFAULT_CANDLE_QUERY_BATCH_SIZE;

  @Inject(() => AssetPriceRepository)
  private assetPriceRepository!: AssetPriceRepository;

  async getMetricsForSymbols(symbols: string[]): Promise<Map<string, MarketMetric>> {
    const normalized = Array.from(
      new Set(
        (symbols || [])
          .map((symbol) => String(symbol || '').trim().toUpperCase())
          .filter(Boolean)
      )
    );

    const metricsBySymbol = new Map<string, MarketMetric>();

    if (!normalized.length) {
      return metricsBySymbol;
    }

    const startedAt = Date.now();
    let loadedFromCandles = 0;
    const candleChunks = env.pg.enabled
      ? chunkValues(normalized, this.candleQueryBatchSize)
      : [];
    for (const [chunkIndex, symbolChunk] of candleChunks.entries()) {
      try {
        const candleMetrics = await this.fetchCandleMetrics(symbolChunk);
        candleMetrics.forEach((metric) => {
          metricsBySymbol.set(metric.symbol, metric);
        });
        loadedFromCandles += candleMetrics.length;
      } catch (error) {
        const symbolSample = symbolChunk.slice(0, 10).join(', ');
        const chunkLabel =
          candleChunks.length > 1
            ? ` chunk ${chunkIndex + 1}/${candleChunks.length}`
            : '';
        if (this.isTempFileLimitError(error)) {
          log.warn(
            `MarketMetricsService: candle metrics${chunkLabel} hit temp_file_limit for ${symbolChunk.length} symbol(s) (sample: ${symbolSample}). Falling back to asset prices where possible.`
          );
        } else {
          const message = error instanceof Error ? error.message : String(error);
          log.warn(
            `MarketMetricsService: unable to read candle metrics${chunkLabel} for ${symbolChunk.length} symbol(s) (sample: ${symbolSample}): ${message}`
          );
        }
      }
    }

    const missingPriceSymbols = normalized.filter((symbol) => {
      const metric = metricsBySymbol.get(symbol);
      return !metric || metric.lastPrice === null || metric.lastPrice === undefined;
    });

    if (missingPriceSymbols.length) {
      const priceRows = await this.assetPriceRepository.getBySymbols(missingPriceSymbols, {
        sources: ['mudrex', 'delta_exchange'],
      });
      priceRows.forEach((row) => {
        const symbol = String(row.symbol || '').trim().toUpperCase();
        if (!symbol) {
          return;
        }

        const existing =
          metricsBySymbol.get(symbol) || {
            symbol,
            lastPrice: null,
            changePerc: null,
            volume24h: null,
            high24h: null,
            low24h: null,
            priceSource: null,
            snapshotAt: null,
          };

        if (existing.lastPrice === null || existing.lastPrice === undefined) {
          existing.lastPrice = Number(row.price);
        }
        if (!existing.snapshotAt && (row.retrievedAt || row.updatedAt)) {
          existing.snapshotAt = new Date(row.retrievedAt || row.updatedAt);
        }
        existing.priceSource = String(row.source || '').trim() || existing.priceSource || null;
        metricsBySymbol.set(symbol, existing);
      });
    }

    normalized.forEach((symbol) => {
      if (!metricsBySymbol.has(symbol)) {
        metricsBySymbol.set(symbol, {
          symbol,
          lastPrice: null,
          changePerc: null,
          volume24h: null,
          high24h: null,
          low24h: null,
          priceSource: null,
          snapshotAt: null,
        });
      }
    });

    const durationMs = Date.now() - startedAt;
    if (durationMs >= 2000 || normalized.length >= 100) {
      log.info(
        `MarketMetricsService: resolved ${normalized.length} symbol(s) in ${durationMs}ms (${loadedFromCandles} from candle metrics, ${missingPriceSymbols.length} fallback price lookup)`
      );
    }

    return metricsBySymbol;
  }

  private isTempFileLimitError(error: unknown): boolean {
    const code =
      typeof error === 'object' && error !== null
        ? String((error as any).code || (error as any).driverError?.code || '')
        : '';
    const message = error instanceof Error ? error.message : String(error);
    return code === '53400' || message.toLowerCase().includes('temp_file_limit');
  }

  private async fetchCandleMetrics(symbols: string[]): Promise<MarketMetric[]> {
    if (!strategyDataSource.isInitialized) {
      await strategyDataSource.initialize();
    }

    const rows = await strategyDataSource.query(
      `WITH latest AS (
         SELECT DISTINCT ON (symbol) symbol, close AS last_price, open_time
         FROM market_candles_1m
         WHERE symbol = ANY($1)
           AND open_time >= NOW() - INTERVAL '48 hours'
         ORDER BY symbol, open_time DESC
       ),
       prev AS (
         SELECT DISTINCT ON (symbol) symbol, close AS prev_close
         FROM market_candles_1m
         WHERE symbol = ANY($1)
           AND open_time >= NOW() - INTERVAL '48 hours'
           AND open_time <= NOW() - INTERVAL '24 hours'
         ORDER BY symbol, open_time DESC
       ),
       stats AS (
         SELECT symbol,
                SUM(volume) AS volume_24h,
                MAX(high) AS high_24h,
                MIN(low) AS low_24h
         FROM market_candles_1m
         WHERE symbol = ANY($1)
           AND open_time >= NOW() - INTERVAL '24 hours'
         GROUP BY symbol
       )
       SELECT latest.symbol,
              latest.last_price AS "lastPrice",
              latest.open_time AS "snapshotAt",
              prev.prev_close AS "prevClose",
              stats.volume_24h AS "volume24h",
              stats.high_24h AS "high24h",
              stats.low_24h AS "low24h"
       FROM latest
       LEFT JOIN prev ON prev.symbol = latest.symbol
       LEFT JOIN stats ON stats.symbol = latest.symbol`,
      [symbols]
    );

    return (rows || []).map((row: any) => {
      const lastPrice =
        row.lastPrice === null || row.lastPrice === undefined ? null : Number(row.lastPrice);
      const prevClose =
        row.prevClose === null || row.prevClose === undefined ? null : Number(row.prevClose);
      const volume24h =
        row.volume24h === null || row.volume24h === undefined ? null : Number(row.volume24h);
      const high24h =
        row.high24h === null || row.high24h === undefined ? null : Number(row.high24h);
      const low24h =
        row.low24h === null || row.low24h === undefined ? null : Number(row.low24h);
      const changePerc =
        lastPrice !== null && prevClose !== null && prevClose !== 0
          ? ((lastPrice - prevClose) / prevClose) * 100
          : null;

      return {
        symbol: String(row.symbol || '').trim().toUpperCase(),
        lastPrice,
        changePerc,
        volume24h,
        high24h,
        low24h,
        priceSource: 'pg.market_candles_1m',
        snapshotAt: row.snapshotAt ? new Date(row.snapshotAt) : null,
      } as MarketMetric;
    });
  }
}
