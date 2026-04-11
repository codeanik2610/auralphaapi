import { Service } from 'typedi';
import { BrokerModule } from '../../core/types';

@Service()
export class DeltaExchangeBrokerModule implements BrokerModule {
  readonly brokerKey = 'delta_exchange';

  readonly displayName = 'Delta Exchange';

  readonly category = 'broker' as const;

  readonly providerType = 'broker' as const;

  readonly profile = {
    purpose: 'Execution account, balances, positions, and exchange candle data',
    capabilities: 'Candles, balances, open orders, order history, cancel order, positions, liquidation info',
    authMode: 'API key + secret signing',
    limitations:
      'Create order, close-position actions, leverage controls, and websocket updates still need explicit product/action mapping.',
    environment: 'Testnet + Production',
  };

  readonly features = {
    marketData: true,
    orders: true,
    positions: true,
    balances: true,
    leverage: false,
    risk: true,
    streaming: false,
  };
}
