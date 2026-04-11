import { Inject, Service } from 'typedi';
import { BrokerAccountRoutingService } from '../../brokers';
import { BrokerRuntimeRegistry } from '../../brokers';
import { MarketCandlesQuery } from '../validators/market.validator';

@Service()
export class BrokerMarketFacadeService {
  @Inject(() => BrokerRuntimeRegistry)
  private brokerRuntimeRegistry!: BrokerRuntimeRegistry;

  @Inject(() => BrokerAccountRoutingService)
  private brokerAccountRoutingService!: BrokerAccountRoutingService;

  async getCandles(userId: string, query: MarketCandlesQuery): Promise<unknown> {
    const route = await this.brokerAccountRoutingService.resolve(
      userId,
      query.brokerKey,
      query.accountId,
      'binance'
    );

    return this.brokerRuntimeRegistry
      .getMarketAdapter(route.brokerKey)
      .getCandles(
        {
          ...query,
          brokerKey: route.brokerKey,
          accountId: route.accountId,
        },
        route
      );
  }
}
