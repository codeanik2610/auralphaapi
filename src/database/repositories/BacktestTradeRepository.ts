import { Service } from 'typedi';
import { Repository } from 'typeorm';
import { strategyDataSource } from '../pg-data-source';
import { BacktestTrade } from '../entities/BacktestTrade';

export interface BacktestTradeInsertPayload {
  userId: string;
  backtestId: string;
  symbol: string;
  interval: string;
  side: 'BUY' | 'SELL';
  entryTime: number;
  entryPrice: number;
  exitTime?: number | null;
  exitPrice?: number | null;
}

@Service()
export class BacktestTradeRepository {
  private get repository(): Repository<BacktestTrade> {
    return strategyDataSource.getRepository(BacktestTrade);
  }

  async listTrades(params: {
    userId: string;
    backtestId: string;
    symbol: string;
    interval: string;
    limit?: number;
  }): Promise<BacktestTrade[]> {
    return this.repository.find({
      where: {
        userId: params.userId,
        backtestId: params.backtestId,
        symbol: params.symbol,
        interval: params.interval,
      },
      order: { entryTime: 'ASC' },
      take: params.limit && params.limit > 0 ? params.limit : undefined,
    });
  }

  async getTradeCountsByBacktest(
    userId: string,
    backtestIds: string[]
  ): Promise<Map<string, number>> {
    const ids = Array.from(
      new Set(
        (Array.isArray(backtestIds) ? backtestIds : [])
          .map((item) => String(item || '').trim())
          .filter(Boolean)
      )
    );

    if (!ids.length) {
      return new Map();
    }

    const rows = (await strategyDataSource.query(
      `SELECT backtest_id, COUNT(*)::int AS count
       FROM backtest_trades
       WHERE user_id = $1
         AND backtest_id = ANY($2::uuid[])
       GROUP BY backtest_id`,
      [userId, ids]
    )) as Array<{ backtest_id?: string; count?: string | number }>;

    return new Map(
      rows.map((row) => [
        String(row.backtest_id || '').trim(),
        Number(row.count ?? 0),
      ])
    );
  }

  async insertTrades(trades: BacktestTradeInsertPayload[]): Promise<number> {
    if (!trades.length) return 0;

    const values: Array<string | number | Date | null> = [];
    const placeholders: string[] = [];

    const toDate = (value?: number | null): Date | null => {
      if (value === null || value === undefined) return null;
      if (!Number.isFinite(value)) return null;
      return new Date(value > 1e12 ? value : value * 1000);
    };

    trades.forEach((trade, index) => {
      const base = index * 9;
      placeholders.push(
        `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9})`
      );
      values.push(
        trade.backtestId,
        trade.userId,
        trade.symbol,
        trade.interval,
        trade.side,
        toDate(trade.entryTime) as Date,
        trade.entryPrice,
        toDate(trade.exitTime ?? null),
        trade.exitPrice ?? null
      );
    });

    const result = await strategyDataSource.query(
      `INSERT INTO backtest_trades
        (backtest_id, user_id, symbol, interval, side, entry_time, entry_price, exit_time, exit_price)
       VALUES ${placeholders.join(',')}
       ON CONFLICT (backtest_id, symbol, interval, side, entry_time, exit_time)
       DO NOTHING`,
      values
    );

    return Number(result?.rowCount || 0);
  }

  async deleteTradesForBacktest(userId: string, backtestId: string): Promise<number> {
    const result = await strategyDataSource.query(
      `DELETE FROM backtest_trades
       WHERE user_id = $1
         AND backtest_id = $2`,
      [userId, backtestId]
    );

    return Number(result?.rowCount || 0);
  }
}
