import { Inject, Service } from 'typedi';
import { MarketService } from '../../providers/binance';
import {
  BrokerDiagnosticsExecutor,
  BrokerDiagnosticsResult,
  BrokerDiagnosticsRoute,
} from './types';

@Service()
export class BinanceMarketDiagnosticsExecutor implements BrokerDiagnosticsExecutor {
  readonly key = 'binance-market';

  @Inject(() => MarketService)
  private marketService!: MarketService;

  async execute(_route: BrokerDiagnosticsRoute): Promise<BrokerDiagnosticsResult> {
    await this.marketService.getCandles({
      symbol: 'BTCUSDT',
      interval: '1h',
      limit: '1',
    });

    return { detail: 'Binance futures candles reachable' };
  }
}
