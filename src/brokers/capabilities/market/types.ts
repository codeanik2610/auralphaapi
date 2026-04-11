import { MarketCandlesQuery } from '../../../api/validators/market.validator';

export interface BrokerMarketContext {
  brokerKey?: string;
  accountId?: string;
}

export interface BrokerMarketAdapter {
  getCandles(query: MarketCandlesQuery, context?: BrokerMarketContext): Promise<unknown>;
}
