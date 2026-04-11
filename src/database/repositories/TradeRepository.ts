import { Service } from 'typedi';
import { Repository } from 'typeorm';
import { Trade } from '../entities/Trade';
import { coreDataSource } from '../data-source';

export interface TradeInsertPayload {
  strategy: string;
  symbol: string;
  interval: string;
  side: 'BUY' | 'SELL';
  alertOpenTime: number;
  confirmOpenTime: number;
  alertHigh: string;
  alertLow: string;
  confirmClose: string;
  barsWaited: number;
}

export interface TradePersistenceResult {
  inserted: number;
  duplicates: number;
}

@Service()
export class TradeRepository {
  private get repository(): Repository<Trade> {
    return coreDataSource.getRepository(Trade);
  }

  async saveUniqueTrades(trades: TradeInsertPayload[]): Promise<TradePersistenceResult> {
    const uniqueTrades: TradeInsertPayload[] = [];

    for (const trade of trades) {
      const exists = await this.repository.exist({
        where: {
          strategy: trade.strategy,
          symbol: trade.symbol,
          interval: trade.interval,
          side: trade.side,
          alertOpenTime: trade.alertOpenTime,
          confirmOpenTime: trade.confirmOpenTime,
        },
      });

      if (!exists) {
        uniqueTrades.push(trade);
      }
    }

    if (uniqueTrades.length > 0) {
      await this.repository.insert(uniqueTrades);
    }

    return {
      inserted: uniqueTrades.length,
      duplicates: trades.length - uniqueTrades.length,
    };
  }
}
