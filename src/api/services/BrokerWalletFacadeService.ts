import { Inject, Service } from 'typedi';
import { BrokerAccountRoutingService } from '../../brokers';
import { BrokerAccountRepository } from '../../database';
import { FundsSnapshotRepository } from '../../database/repositories/FundsSnapshotRepository';

@Service()
export class BrokerWalletFacadeService {
  @Inject(() => BrokerAccountRoutingService)
  private brokerAccountRoutingService!: BrokerAccountRoutingService;

  @Inject(() => BrokerAccountRepository)
  private brokerAccountRepository!: BrokerAccountRepository;

  @Inject(() => FundsSnapshotRepository)
  private fundsSnapshotRepository!: FundsSnapshotRepository;

  async getWalletFunds(userId: string, brokerKey?: string, accountId?: string): Promise<unknown> {
    const route = await this.brokerAccountRoutingService.resolve(userId, brokerKey, accountId, 'mudrex');
    const snapshot = await this.fundsSnapshotRepository.getLatestSnapshot(
      userId,
      route.brokerKey,
      route.accountId
    );
    return this.parseSnapshotJson(snapshot?.wallet_funds_json);
  }

  async getFuturesFunds(userId: string, brokerKey?: string, accountId?: string): Promise<unknown> {
    const route = await this.brokerAccountRoutingService.resolve(userId, brokerKey, accountId, 'mudrex');
    const snapshot = await this.fundsSnapshotRepository.getLatestSnapshot(
      userId,
      route.brokerKey,
      route.accountId
    );
    return this.parseSnapshotJson(snapshot?.futures_funds_json);
  }

  async getFuturesFundsForActiveAccounts(userId: string, brokerKey?: string): Promise<unknown> {
    const activeAccounts = await this.brokerAccountRepository.getConnectedBrokerAccounts(
      userId,
      brokerKey
    );

    const results = await Promise.all(
      activeAccounts.map(async (account) => {
        try {
          const route = await this.brokerAccountRoutingService.resolve(
            userId,
            account.brokerKey,
            account.id,
            account.brokerKey
          );
          const snapshot = await this.fundsSnapshotRepository.getLatestSnapshot(
            userId,
            route.brokerKey,
            route.accountId
          );
          const funds = this.parseSnapshotJson(snapshot?.futures_funds_json);
          const observedAt =
            snapshot?.observed_at?.toISOString?.() ??
            snapshot?.computed_at?.toISOString?.() ??
            snapshot?.created_at?.toISOString?.() ??
            null;

          return {
            accountId: account.id,
            accountName: account.accountName,
            accountKey: account.accountKey,
            brokerKey: account.brokerKey,
            status: account.status,
            observedAt,
            funds,
            error: funds ? null : 'No snapshot available',
          };
        } catch (error) {
          return {
            accountId: account.id,
            accountName: account.accountName,
            accountKey: account.accountKey,
            brokerKey: account.brokerKey,
            status: account.status,
            observedAt: null,
            funds: null,
            error: error instanceof Error ? error.message : 'Unable to fetch futures funds',
          };
        }
      })
    );

    return {
      totalActiveAccounts: activeAccounts.length,
      successCount: results.filter((item) => !item.error).length,
      failureCount: results.filter((item) => Boolean(item.error)).length,
      items: results,
    };
  }

  async getWalletFundsForActiveAccounts(userId: string, brokerKey?: string): Promise<unknown> {
    const activeAccounts = await this.brokerAccountRepository.getConnectedBrokerAccounts(
      userId,
      brokerKey
    );

    const results = await Promise.all(
      activeAccounts.map(async (account) => {
        try {
          const route = await this.brokerAccountRoutingService.resolve(
            userId,
            account.brokerKey,
            account.id,
            account.brokerKey
          );
          const snapshot = await this.fundsSnapshotRepository.getLatestSnapshot(
            userId,
            route.brokerKey,
            route.accountId
          );
          const funds = this.parseSnapshotJson(snapshot?.wallet_funds_json);
          const observedAt =
            snapshot?.observed_at?.toISOString?.() ??
            snapshot?.computed_at?.toISOString?.() ??
            snapshot?.created_at?.toISOString?.() ??
            null;

          return {
            accountId: account.id,
            accountName: account.accountName,
            accountKey: account.accountKey,
            brokerKey: account.brokerKey,
            status: account.status,
            observedAt,
            funds,
            error: funds ? null : 'No snapshot available',
          };
        } catch (error) {
          return {
            accountId: account.id,
            accountName: account.accountName,
            accountKey: account.accountKey,
            brokerKey: account.brokerKey,
            status: account.status,
            observedAt: null,
            funds: null,
            error: error instanceof Error ? error.message : 'Unable to fetch wallet funds',
          };
        }
      })
    );

    return {
      totalActiveAccounts: activeAccounts.length,
      successCount: results.filter((item) => !item.error).length,
      failureCount: results.filter((item) => Boolean(item.error)).length,
      items: results,
    };
  }

  private parseSnapshotJson(value: unknown): unknown {
    if (!value) return null;

    if (typeof value === 'object') {
      return value;
    }

    try {
      return JSON.parse(String(value));
    } catch {
      return null;
    }
  }

}
