import { Inject, Service } from 'typedi';
import { MarketService } from '../../providers/binance';
import { MarketCandlesQuery } from '../../../api/validators/market.validator';
import { BrokerMarketAdapter, BrokerMarketContext } from './types';

@Service()
export class BinanceMarketAdapter implements BrokerMarketAdapter {
  @Inject(() => MarketService)
  private marketService!: MarketService;

  async getCandles(
    query: MarketCandlesQuery,
    _context?: BrokerMarketContext
  ): Promise<unknown> {
    return this.marketService.getCandles(query);
  }
}
