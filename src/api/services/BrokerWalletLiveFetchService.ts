import { Inject, Service } from 'typedi';
import { BrokerAccountRoutingService, BrokerRuntimeRegistry } from '../../brokers';
import { BadRequestAppError } from '../errors/AppError';

export type LiveBrokerFundsPayload = {
  userId: string;
  brokerKey: string;
  accountId: string;
  walletFunds: unknown;
  futuresFunds: unknown;
};

@Service()
export class BrokerWalletLiveFetchService {
  @Inject(() => BrokerRuntimeRegistry)
  private brokerRuntimeRegistry!: BrokerRuntimeRegistry;

  @Inject(() => BrokerAccountRoutingService)
  private brokerAccountRoutingService!: BrokerAccountRoutingService;

  async fetchAccountFunds(
    userId: string,
    brokerKey?: string,
    accountId?: string
  ): Promise<LiveBrokerFundsPayload> {
    const route = await this.brokerAccountRoutingService.resolve(
      userId,
      brokerKey,
      accountId,
      brokerKey || 'mudrex'
    );
    const resolvedBrokerKey = String(route.brokerKey || brokerKey || '').trim().toLowerCase();
    const resolvedAccountId = String(route.accountId || accountId || '').trim();

    if (!resolvedBrokerKey || !resolvedAccountId) {
      throw new BadRequestAppError('Live funds fetch requires brokerKey and accountId');
    }

    const context = {
      userId,
      brokerKey: resolvedBrokerKey,
      accountId: resolvedAccountId,
    };
    const walletAdapter = this.brokerRuntimeRegistry.getWalletAdapter(resolvedBrokerKey);
    const [walletFunds, futuresFunds] = await Promise.all([
      walletAdapter.getWalletFunds(context),
      walletAdapter.getFuturesFunds(context),
    ]);

    return {
      userId,
      brokerKey: resolvedBrokerKey,
      accountId: resolvedAccountId,
      walletFunds: this.unwrapPayload(walletFunds),
      futuresFunds: this.unwrapPayload(futuresFunds),
    };
  }

  private unwrapPayload(value: unknown): unknown {
    if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'data')) {
      return (value as { data?: unknown }).data ?? value;
    }

    return value;
  }
}
