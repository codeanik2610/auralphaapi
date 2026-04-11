import { Service } from 'typedi';
import { BrokerModule } from '../../core/types';

@Service()
export class BinanceMarketDataBrokerModule implements BrokerModule {
  readonly brokerKey = 'binance';

  readonly displayName = 'Binance market data';

  readonly category = 'feed' as const;

  readonly providerType = 'feed' as const;

  readonly profile = {
    purpose: 'Public futures candles and market-data reachability checks',
    capabilities: 'Candles, public market diagnostics',
    authMode: 'No account credentials required',
    limitations: 'Public feed only. Orders, positions, wallet, and account-auth checks are not supported.',
    environment: 'Production',
  };

  readonly features = {
    marketData: true,
    orders: false,
    positions: false,
    balances: false,
    leverage: false,
    risk: false,
    streaming: false,
  };
}
