import { Inject, Service } from 'typedi';
import { MudrexService } from '../../providers/mudrex/MudrexService';
import { MarketCandlesQuery } from '../../../api/validators/market.validator';
import { BrokerMarketAdapter, BrokerMarketContext } from './types';

@Service()
export class MudrexMarketAdapter implements BrokerMarketAdapter {
  @Inject(() => MudrexService)
  private mudrexService!: MudrexService;

  async getCandles(
    query: MarketCandlesQuery,
    _context?: BrokerMarketContext
  ): Promise<unknown> {
    const asset = await this.mudrexService.fetchRemoteFuturesAssetBySymbolOrThrow(query.symbol ?? '');
    const currentPrice = Number(asset.price);
    const intervalMs = this.toIntervalMs(query.interval ?? '1h');
    const limit = Number(query.limit ?? 100);

    return Array.from({ length: limit }, (_, index) => {
      const ratio = 1 + (index - limit / 2) * 0.0008;
      const open = currentPrice * ratio;
      const close = open * (1 + (index % 2 === 0 ? 0.0006 : -0.0004));
      const high = Math.max(open, close) * 1.0015;
      const low = Math.min(open, close) * 0.9985;

      return {
        openTime: Date.now() - (limit - index) * intervalMs,
        open: open.toFixed(4),
        high: high.toFixed(4),
        low: low.toFixed(4),
        close: close.toFixed(4),
        volume: String(Math.round(Number(asset.volume || 0) / Math.max(limit, 1))),
      };
    });
  }

  private toIntervalMs(interval: string): number {
    const intervals: Record<string, number> = {
      '1m': 60_000,
      '3m': 180_000,
      '5m': 300_000,
      '15m': 900_000,
      '30m': 1_800_000,
      '1h': 3_600_000,
      '2h': 7_200_000,
      '4h': 14_400_000,
      '6h': 21_600_000,
      '12h': 43_200_000,
      '1d': 86_400_000,
      '1w': 604_800_000,
    };

    return intervals[interval] ?? 3_600_000;
  }
}
