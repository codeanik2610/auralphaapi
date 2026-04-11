import { Inject, Service } from 'typedi';
import { BadGatewayAppError } from '../../../api';
import { MarketCandlesQuery } from '../../../api/validators/market.validator';
import { BrokerMarketAdapter, BrokerMarketContext } from './types';
import { DeltaExchangeHttpClient } from '../../providers/delta_exchange/DeltaExchangeHttpClient';

type DeltaCandlePayload =
  | Array<[number, string | number, string | number, string | number, string | number, string | number]>
  | {
      time?: number[];
      open?: Array<string | number>;
      high?: Array<string | number>;
      low?: Array<string | number>;
      close?: Array<string | number>;
      volume?: Array<string | number>;
      result?: unknown;
    };

@Service()
export class DeltaExchangeMarketAdapter implements BrokerMarketAdapter {
  @Inject(() => DeltaExchangeHttpClient)
  private deltaHttpClient!: DeltaExchangeHttpClient;

  async getCandles(
    query: MarketCandlesQuery,
    _context?: BrokerMarketContext
  ): Promise<unknown> {
    const resolution = this.toResolution(query.interval ?? '1h');
    const end = Math.floor(Date.now() / 1000);
    const start = end - resolution * Number(query.limit ?? 100);

    const payload = await this.deltaHttpClient.publicGet<DeltaCandlePayload>(
      '/v2/history/candles',
      {
        symbol: query.symbol,
        resolution,
        start,
        end,
      }
    );

    return this.mapCandles(payload);
  }

  private toResolution(interval: string): number {
    const resolutions: Record<string, number> = {
      '1m': 1,
      '3m': 3,
      '5m': 5,
      '15m': 15,
      '30m': 30,
      '1h': 60,
      '2h': 120,
      '4h': 240,
      '6h': 360,
      '12h': 720,
      '1d': 1440,
      '1w': 10080,
    };

    return resolutions[interval] ?? 60;
  }

  private mapCandles(payload: DeltaCandlePayload) {
    if (Array.isArray(payload)) {
      return payload.map((item) => ({
        openTime: item[0],
        open: String(item[1]),
        high: String(item[2]),
        low: String(item[3]),
        close: String(item[4]),
        volume: String(item[5]),
      }));
    }

    const time = Array.isArray(payload?.time) ? payload.time : [];
    const open = Array.isArray(payload?.open) ? payload.open : [];
    const high = Array.isArray(payload?.high) ? payload.high : [];
    const low = Array.isArray(payload?.low) ? payload.low : [];
    const close = Array.isArray(payload?.close) ? payload.close : [];
    const volume = Array.isArray(payload?.volume) ? payload.volume : [];

    if (!time.length) {
      throw new BadGatewayAppError('Delta Exchange returned an invalid candle payload');
    }

    return time.map((openTime, index) => ({
      openTime,
      open: String(open[index] ?? ''),
      high: String(high[index] ?? ''),
      low: String(low[index] ?? ''),
      close: String(close[index] ?? ''),
      volume: String(volume[index] ?? ''),
    }));
  }
}
