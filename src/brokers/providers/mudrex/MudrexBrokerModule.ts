import { Service } from 'typedi';
import { BrokerModule } from '../../core/types';

@Service()
export class MudrexBrokerModule implements BrokerModule {
  readonly brokerKey = 'mudrex';

  readonly displayName = 'Mudrex';

  readonly category = 'broker' as const;

  readonly providerType = 'broker' as const;

  readonly profile = {
    purpose: 'Orders, positions, balances, strategy execution',
    capabilities: 'Create order, cancel order, view positions, close position, balances, portfolio',
    authMode: 'API key authentication',
    limitations: 'REST-first workflow with lighter market-depth coverage than an exchange-native API.',
    environment: 'Production',
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
