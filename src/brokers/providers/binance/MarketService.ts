import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../../../api';
import { BinanceMarketCandle } from '../../../api';
import { BadGatewayAppError } from '../../../api';
import { successResponse } from '../../../api';
import { MarketCandlesQuery, validateMarketCandlesQuery } from '../../../api/validators/market.validator';
import { BinanceHttpClient } from './BinanceHttpClient';

@Service()
export class MarketService {
  @Inject(() => BinanceHttpClient)
  private binanceHttpClient!: BinanceHttpClient;

  async getCandles(query: MarketCandlesQuery): Promise<ApiSuccessResponse<BinanceMarketCandle[]>> {
    const params = validateMarketCandlesQuery(query);

    const data = await this.fetchCandles(params.symbol, params.interval, params.limit);
    return successResponse(data);
  }

  private async fetchCandles(
    symbol: string,
    interval: string,
    limit: number
  ): Promise<BinanceMarketCandle[]> {
    const payload = await this.binanceHttpClient.get<unknown[][]>('/fapi/v1/klines', {
      symbol,
      interval,
      limit,
    });

    if (!Array.isArray(payload)) {
      throw new BadGatewayAppError('Binance returned an invalid market candles payload');
    }

    return payload.map((item) => this.mapKline(item));
  }

  private mapKline(item: unknown[]): BinanceMarketCandle {
    if (
      item.length < 6 ||
      typeof item[0] !== 'number' ||
      typeof item[1] !== 'string' ||
      typeof item[2] !== 'string' ||
      typeof item[3] !== 'string' ||
      typeof item[4] !== 'string' ||
      typeof item[5] !== 'string'
    ) {
      throw new BadGatewayAppError('Binance returned an invalid market candle item');
    }

    return {
      openTime: item[0],
      open: item[1],
      high: item[2],
      low: item[3],
      close: item[4],
      volume: item[5],
    };
  }
}
