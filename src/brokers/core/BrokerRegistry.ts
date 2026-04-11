import { Inject, Service } from 'typedi';
import { NotFoundAppError } from '../../api';
import { BinanceMarketDataBrokerModule } from '../providers/binance/BinanceMarketDataBrokerModule';
import { DeltaExchangeBrokerModule } from '../providers/delta_exchange/DeltaExchangeBrokerModule';
import { MudrexBrokerModule } from '../providers/mudrex/MudrexBrokerModule';
import { BrokerModule } from './types';

@Service()
export class BrokerRegistry {
  @Inject(() => BinanceMarketDataBrokerModule)
  private binanceMarketDataBrokerModule!: BinanceMarketDataBrokerModule;

  @Inject(() => MudrexBrokerModule)
  private mudrexBrokerModule!: MudrexBrokerModule;

  @Inject(() => DeltaExchangeBrokerModule)
  private deltaExchangeBrokerModule!: DeltaExchangeBrokerModule;

  private get modules(): BrokerModule[] {
    return [
      this.binanceMarketDataBrokerModule,
      this.mudrexBrokerModule,
      this.deltaExchangeBrokerModule,
    ];
  }

  private normalizeBrokerKey(brokerKey?: string | null): string {
    return String(brokerKey || '').trim().toLowerCase();
  }

  list(): BrokerModule[] {
    return this.modules;
  }

  getOptional(brokerKey?: string | null): BrokerModule | null {
    const resolvedBrokerKey = this.normalizeBrokerKey(brokerKey);

    if (!resolvedBrokerKey) {
      return null;
    }

    return this.modules.find((module) => module.brokerKey === resolvedBrokerKey) || null;
  }

  getRequired(brokerKey: string): BrokerModule {
    const module = this.getOptional(brokerKey);

    if (!module) {
      throw new NotFoundAppError(`Broker module not registered for key: ${brokerKey}`);
    }

    return module;
  }
}
