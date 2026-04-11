import { Inject, Service } from 'typedi';
import { BadRequestAppError, NotFoundAppError } from '../../api';
import { BrokerAccountRepository } from '../../database';

export interface BrokerRouteResolution {
  userId?: string;
  brokerKey?: string;
  accountId?: string;
}

@Service()
export class BrokerAccountRoutingService {
  @Inject(() => BrokerAccountRepository)
  private brokerAccountRepository!: BrokerAccountRepository;

  async resolve(userId: string, requestedBrokerKey?: string, requestedAccountId?: string, fallbackBrokerKey?: string): Promise<BrokerRouteResolution> {
    if (requestedAccountId) {
      const account = await this.brokerAccountRepository.getBrokerAccountById(userId, requestedAccountId);
      if (!account) throw new NotFoundAppError('Broker account not found');
      if (requestedBrokerKey && requestedBrokerKey !== account.brokerKey) {
        throw new BadRequestAppError('Selected broker account does not belong to the requested brokerKey');
      }
      return { userId, brokerKey: account.brokerKey, accountId: account.id };
    }

    const brokerKey = requestedBrokerKey || fallbackBrokerKey;
    if (!brokerKey) return { userId };
    const preferredAccount = await this.brokerAccountRepository.getPreferredBrokerAccountByBrokerKey(
      userId,
      brokerKey
    );
    if (!preferredAccount) return { userId, brokerKey };
    return { userId, brokerKey, accountId: preferredAccount.id };
  }
}
