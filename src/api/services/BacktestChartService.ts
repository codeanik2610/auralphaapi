import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import { BacktestChartResponse } from '../contracts/Backtest';
import { ServiceUnavailableAppError, NotFoundAppError } from '../errors/AppError';
import { successResponse } from '../utils/response';
import {
  BacktestChartQuery,
  validateBacktestChartQuery,
  validateBacktestId,
} from '../validators/backtests.validator';
import {
  Backtest,
  BacktestRepository,
  BacktestTradeRepository,
} from '../../database';
import { strategyDataSource } from '../../database/pg-data-source';
import { env } from '../../env';

@Service()
export class BacktestChartService {
  @Inject(() => BacktestRepository)
  private backtestRepository!: BacktestRepository;

  @Inject(() => BacktestTradeRepository)
  private backtestTradeRepository!: BacktestTradeRepository;

  async getBacktestChart(
    userId: string,
    backtestId: string,
    query: BacktestChartQuery
  ): Promise<ApiSuccessResponse<BacktestChartResponse>> {
    const validatedId = validateBacktestId(backtestId);
    const params = validateBacktestChartQuery(query || {});
    const backtest = await this.backtestRepository.getBacktestById(userId, validatedId);

    if (!backtest) {
      throw new NotFoundAppError('Backtest not found');
    }

    const chartWindow = this.resolveChartWindow(backtest, params);
    const intervalSeconds = this.intervalToSeconds(params.interval);
    const candles = await this.fetchCandles(
      params.symbol,
      intervalSeconds,
      chartWindow,
      params.limit
    );
    const storedTrades = await this.backtestTradeRepository.listTrades({
      userId,
      backtestId: validatedId,
      symbol: params.symbol,
      interval: params.interval,
    });
    const trades = storedTrades
      .filter((trade) => this.isTradeInsideWindow(trade, chartWindow))
      .map((trade) => this.mapTrade(trade));
    const storedTradeEvents = storedTrades.length;
    const expectedTradeEvents = this.getExpectedTradeEventsForScope(
      backtest,
      params.symbol,
      params.interval
    );

    return successResponse({
      symbol: params.symbol,
      interval: params.interval,
      window: {
        startTime: chartWindow.startTime?.toISOString() ?? null,
        endTime: chartWindow.endTime.toISOString(),
        lookbackDays: chartWindow.lookbackDays,
      },
      candles,
      trades,
      tradeCoverage: {
        symbol: params.symbol,
        interval: params.interval,
        expectedTradeEvents,
        storedTradeEvents,
        chartTradeEvents: trades.length,
        missingTradeEvents:
          expectedTradeEvents !== null
            ? Math.max(0, expectedTradeEvents - storedTradeEvents)
            : null,
        hasIncompleteTradeHistory:
          expectedTradeEvents !== null && expectedTradeEvents > storedTradeEvents,
      },
    });
  }

  private mapTrade(trade: {
    id: string;
    symbol: string;
    interval: string;
    side: 'BUY' | 'SELL' | string;
    entryTime: Date | string;
    entryPrice: string | number;
    exitTime: Date | string | null;
    exitPrice: string | number | null;
  }): BacktestChartResponse['trades'][number] {
    return {
      id: trade.id,
      symbol: trade.symbol,
      interval: trade.interval,
      side: trade.side as 'BUY' | 'SELL',
      entryTime:
        trade.entryTime instanceof Date
          ? trade.entryTime.getTime()
          : new Date(trade.entryTime).getTime(),
      entryPrice: Number(trade.entryPrice),
      exitTime:
        trade.exitTime !== null && trade.exitTime !== undefined
          ? trade.exitTime instanceof Date
            ? trade.exitTime.getTime()
            : new Date(trade.exitTime).getTime()
          : null,
      exitPrice:
        trade.exitPrice !== null && trade.exitPrice !== undefined
          ? Number(trade.exitPrice)
          : null,
    };
  }

  private isTradeInsideWindow(
    trade: {
      entryTime: Date | string;
      exitTime: Date | string | null;
    },
    chartWindow: {
      startTime: Date | null;
      lookbackDays: number;
      endTime: Date;
    }
  ): boolean {
    const entryTime =
      trade.entryTime instanceof Date
        ? trade.entryTime.getTime()
        : new Date(trade.entryTime).getTime();
    const exitSource = trade.exitTime || trade.entryTime;
    const exitTime =
      exitSource instanceof Date ? exitSource.getTime() : new Date(exitSource).getTime();

    if (chartWindow.startTime && exitTime < chartWindow.startTime.getTime()) {
      return false;
    }

    return entryTime <= chartWindow.endTime.getTime();
  }

  private getExpectedTradeEventsForScope(
    backtest: Backtest,
    symbol: string,
    interval: string
  ): number | null {
    const config = this.parseConfig(backtest.result?.config) ?? {};
    const normalizedSymbol = String(symbol || '').trim().toUpperCase();
    const normalizedInterval = String(interval || '').trim().toLowerCase();
    const surface = this.parseConfig(config.performanceSurface);
    const results = Array.isArray(surface?.results) ? surface.results : [];
    let total = 0;
    let matched = false;

    results.forEach((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return;
      }
      const row = item as Record<string, unknown>;
      const rowSymbol = String(row.symbol || '').trim().toUpperCase();
      const rowInterval = String(row.timeframe ?? row.interval ?? '')
        .trim()
        .toLowerCase();

      if (!rowSymbol || !rowInterval) {
        return;
      }

      if (rowSymbol !== normalizedSymbol || rowInterval !== normalizedInterval) {
        return;
      }

      const count = Number(row.total_trades ?? row.trades ?? row.totalTrades);
      if (!Number.isFinite(count) || count < 0) {
        return;
      }

      total += Math.max(0, Math.trunc(count));
      matched = true;
    });

    if (matched) {
      return total;
    }

    const directCount = Number(config.tradeEventCount);
    if (Number.isFinite(directCount) && directCount >= 0) {
      return Math.max(0, Math.trunc(directCount));
    }

    return null;
  }

  private intervalToSeconds(interval: string): number {
    const normalized = String(interval || '').trim().toLowerCase();
    const match = normalized.match(/^(\d+)([mhdw])$/);
    if (!match) return 60;
    const value = Number(match[1]);
    if (!Number.isFinite(value) || value <= 0) return 60;
    const unit = match[2];
    switch (unit) {
      case 'm':
        return value * 60;
      case 'h':
        return value * 60 * 60;
      case 'd':
        return value * 60 * 60 * 24;
      case 'w':
        return value * 60 * 60 * 24 * 7;
      default:
        return 60;
    }
  }

  private async fetchCandles(
    symbol: string,
    intervalSeconds: number,
    window: {
      startTime: Date | null;
      lookbackDays: number;
      endTime: Date;
    },
    limit?: number
  ): Promise<BacktestChartResponse['candles']> {
    if (!env.pg.enabled) {
      throw new ServiceUnavailableAppError(
        'Postgres market data is not enabled. Enable env.pg.enabled to load chart candles.'
      );
    }
    if (!strategyDataSource.isInitialized) {
      await strategyDataSource.initialize();
    }
    const resolvedSymbol = await this.resolveWarehouseSymbol(symbol, window.endTime);
    const rangeClause = window.startTime
      ? 'AND open_time BETWEEN $3 AND $4'
      : "AND open_time BETWEEN ($4 - ($3 || ' days')::interval) AND $4";
    const baseQuery = `WITH base AS (
        SELECT
          open_time,
          open,
          high,
          low,
          close,
          volume,
          floor(extract(epoch from open_time) / $2) * $2 AS bucket_ts
        FROM market_candles_1m
        WHERE symbol = $1
          AND interval = (
            SELECT interval
            FROM market_candles_1m
            WHERE symbol = $1
              AND open_time <= $4
            ORDER BY open_time DESC
            LIMIT 1
          )
          ${rangeClause}
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
      ORDER BY bucket_ts DESC`;

    const queryText = limit && limit > 0 ? `${baseQuery} LIMIT $5` : baseQuery;
    const queryParams = window.startTime
      ? limit && limit > 0
        ? [resolvedSymbol, intervalSeconds, window.startTime, window.endTime, limit]
        : [resolvedSymbol, intervalSeconds, window.startTime, window.endTime]
      : limit && limit > 0
        ? [resolvedSymbol, intervalSeconds, window.lookbackDays, window.endTime, limit]
        : [resolvedSymbol, intervalSeconds, window.lookbackDays, window.endTime];

    const rows = await strategyDataSource.query(queryText, queryParams);
    const rawCandles: Array<BacktestChartResponse['candles'][number] | null> = (rows || []).map(
      (row: Record<string, unknown>) => {
        const bucket = Number(row.bucket_ts ?? row.bucketTs);
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
        };
      }
    );

    const candles: BacktestChartResponse['candles'] = rawCandles.filter(
      (
        item: BacktestChartResponse['candles'][number] | null
      ): item is BacktestChartResponse['candles'][number] => Boolean(item)
    );

    candles.sort((left, right) => left.openTime - right.openTime);

    return candles;
  }

  private async resolveWarehouseSymbol(symbol: string, endTime: Date): Promise<string> {
    const candidates = this.buildMarketSymbolCandidates(symbol);
    if (!candidates.length) {
      return String(symbol || '').trim().toUpperCase();
    }

    const rows = await strategyDataSource.query(
      `SELECT symbol, MAX(open_time) AS latest_open
       FROM market_candles_1m
       WHERE symbol = ANY($1::text[])
         AND open_time <= $2
       GROUP BY symbol
       ORDER BY CASE WHEN symbol = $3 THEN 0 ELSE 1 END, MAX(open_time) DESC
       LIMIT 1`,
      [candidates, endTime, candidates[0]]
    );

    const resolved = String(rows?.[0]?.symbol || '').trim().toUpperCase();
    return resolved || candidates[0];
  }

  private buildMarketSymbolCandidates(value: unknown): string[] {
    const normalized = String(value || '').trim().toUpperCase();
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

  private resolveChartWindow(
    backtest: Backtest,
    params: ReturnType<typeof validateBacktestChartQuery>
  ): {
    startTime: Date | null;
    lookbackDays: number;
    endTime: Date;
  } {
    const config = this.parseConfig(backtest.result?.config) ?? {};
    const inputSnapshot = this.parseConfig(config.inputSnapshot) ?? {};
    const resolvedEndTime =
      params.endTime ??
      this.parseOptionalDate(inputSnapshot.end) ??
      this.parseOptionalDate(config.end) ??
      new Date();
    const resolvedStartTime =
      this.parseOptionalDate(inputSnapshot.start) ??
      this.parseOptionalDate(config.start);

    if (resolvedStartTime) {
      const msPerDay = 24 * 60 * 60 * 1000;
      const computedLookback = Math.max(
        1,
        Math.ceil((resolvedEndTime.getTime() - resolvedStartTime.getTime()) / msPerDay)
      );
      return {
        startTime: resolvedStartTime,
        lookbackDays: computedLookback,
        endTime: resolvedEndTime,
      };
    }

    return {
      startTime: null,
      lookbackDays: params.lookbackDays,
      endTime: resolvedEndTime,
    };
  }

  private parseConfig(value: unknown): Record<string, unknown> | null {
    if (!value) return null;
    if (typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        return null;
      }
    }
    return null;
  }

  private parseOptionalDate(value: unknown): Date | null {
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value;
    }
    const trimmed = String(value || '').trim();
    if (!trimmed) {
      return null;
    }
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
}
