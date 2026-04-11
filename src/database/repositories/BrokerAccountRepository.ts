import { Service } from 'typedi';
import { In, IsNull, Repository } from 'typeorm';
import { coreDataSource } from '../data-source';
import { BrokerAccount } from '../entities/BrokerAccount';

export interface BrokerAccountListQuery {
  limit: number;
  offset: number;
  connectionId?: string;
  brokerKey?: string;
  status?: string;
  search?: string;
}

@Service()
export class BrokerAccountRepository {
  private get brokerAccountRepository(): Repository<BrokerAccount> {
    return coreDataSource.getRepository(BrokerAccount);
  }

  async getActiveBrokerAccounts(userId: string, brokerKey?: string): Promise<BrokerAccount[]> {
    if (brokerKey) {
      return this.brokerAccountRepository.find({
        where: { userId, brokerKey, status: In(['Connected', 'Idle']) },
        order: { isDefault: 'DESC', updatedAt: 'DESC' },
      });
    }
    return this.brokerAccountRepository.find({
      where: { userId, status: In(['Connected', 'Idle']) },
      order: { isDefault: 'DESC', updatedAt: 'DESC' },
    });
  }

  async getActiveSystemBrokerAccounts(brokerKey?: string): Promise<BrokerAccount[]> {
    if (brokerKey) {
      return this.brokerAccountRepository.find({
        where: { userId: IsNull(), brokerKey, status: In(['Connected', 'Idle']) },
        order: { isDefault: 'DESC', updatedAt: 'DESC' },
      });
    }
    return this.brokerAccountRepository.find({
      where: { userId: IsNull(), status: In(['Connected', 'Idle']) },
      order: { isDefault: 'DESC', updatedAt: 'DESC' },
    });
  }

  async getAllActiveBrokerAccounts(brokerKey?: string): Promise<BrokerAccount[]> {
    if (brokerKey) {
      return this.brokerAccountRepository.find({
        where: { brokerKey, status: In(['Connected', 'Idle']) },
        order: { isDefault: 'DESC', updatedAt: 'DESC' },
      });
    }
    return this.brokerAccountRepository.find({
      where: { status: In(['Connected', 'Idle']) },
      order: { isDefault: 'DESC', updatedAt: 'DESC' },
    });
  }

  async listBrokerAccounts(userId: string, query: BrokerAccountListQuery) {
    const builder = this.brokerAccountRepository
      .createQueryBuilder('account')
      .where('account.userId = :userId', { userId })
      .orderBy('account.isDefault', 'DESC')
      .addOrderBy('account.updatedAt', 'DESC')
      .skip(query.offset)
      .take(query.limit);

    if (query.connectionId) {
      builder.andWhere('account.connectionId = :connectionId', { connectionId: query.connectionId });
    }
    if (query.brokerKey) {
      builder.andWhere('LOWER(account.brokerKey) = LOWER(:brokerKey)', { brokerKey: query.brokerKey });
    }
    if (query.status) {
      builder.andWhere('LOWER(account.status) = LOWER(:status)', { status: query.status });
    }
    if (query.search) {
      builder.andWhere(
        '(account.accountName LIKE :search OR account.accountKey LIKE :search OR account.brokerKey LIKE :search OR account.status LIKE :search)',
        { search: '%' + query.search + '%' }
      );
    }

    const [items, total] = await builder.getManyAndCount();
    return { items, total };
  }

  async getBrokerAccountById(userId: string, accountId: string): Promise<BrokerAccount | null> {
    return this.brokerAccountRepository.findOne({ where: { id: accountId, userId } });
  }

  async getBrokerAccountsByConnectionId(userId: string, connectionId: string): Promise<BrokerAccount[]> {
    return this.brokerAccountRepository.find({
      where: { userId, connectionId },
      order: { isDefault: 'DESC', updatedAt: 'DESC' },
    });
  }

  async getBrokerAccountByKey(userId: string, accountKey: string): Promise<BrokerAccount | null> {
    return this.brokerAccountRepository.findOne({ where: { accountKey, userId } });
  }

  async getDefaultBrokerAccountByConnectionId(
    userId: string,
    connectionId: string
  ): Promise<BrokerAccount | null> {
    return this.brokerAccountRepository.findOne({
      where: { connectionId, isDefault: true, userId },
      order: { updatedAt: 'DESC' },
    });
  }

  async getPreferredBrokerAccountByConnectionId(
    userId: string,
    connectionId: string
  ): Promise<BrokerAccount | null> {
    return this.brokerAccountRepository.findOne({
      where: { connectionId, userId },
      order: { isDefault: 'DESC', updatedAt: 'DESC' },
    });
  }

  async getDefaultBrokerAccountByBrokerKey(userId: string, brokerKey: string): Promise<BrokerAccount | null> {
    return this.brokerAccountRepository.findOne({ where: { brokerKey, isDefault: true, userId }, order: { updatedAt: 'DESC' } });
  }

  async getLatestBrokerAccountByBrokerKey(userId: string, brokerKey: string): Promise<BrokerAccount | null> {
    return this.brokerAccountRepository.findOne({ where: { brokerKey, userId }, order: { updatedAt: 'DESC' } });
  }

  async getPreferredBrokerAccountByBrokerKey(
    userId: string,
    brokerKey: string
  ): Promise<BrokerAccount | null> {
    return this.brokerAccountRepository.findOne({
      where: { brokerKey, userId },
      order: { isDefault: 'DESC', updatedAt: 'DESC' },
    });
  }

  async getConnectedBrokerAccounts(userId: string, brokerKey?: string): Promise<BrokerAccount[]> {
    if (brokerKey) {
      return this.brokerAccountRepository.find({
        where: { userId, brokerKey, status: 'Connected' },
        order: { isDefault: 'DESC', updatedAt: 'DESC' },
      });
    }

    return this.brokerAccountRepository.find({
      where: { userId, status: 'Connected' },
      order: { isDefault: 'DESC', updatedAt: 'DESC' },
    });
  }

  async getBrokerAccountStatusSummary(userId: string): Promise<{
    connected: number;
    idle: number;
    disconnected: number;
  }> {
    const [connected, idle, disconnected] = await Promise.all([
      this.brokerAccountRepository.count({ where: { userId, status: 'Connected' } }),
      this.brokerAccountRepository.count({ where: { userId, status: 'Idle' } }),
      this.brokerAccountRepository.count({ where: { userId, status: 'Disconnected' } }),
    ]);

    return {
      connected,
      idle,
      disconnected,
    };
  }

  async getBrokerAccountCountByConnectionId(userId: string, connectionId: string): Promise<number> {
    return this.brokerAccountRepository.count({ where: { userId, connectionId } });
  }

  async getBrokerAccountCountsByConnectionIds(
    userId: string,
    connectionIds: string[]
  ): Promise<Map<string, number>> {
    const normalizedConnectionIds = Array.from(
      new Set(connectionIds.map((item) => String(item || '').trim()).filter(Boolean))
    );

    if (!normalizedConnectionIds.length) {
      return new Map();
    }

    const rows = await this.brokerAccountRepository
      .createQueryBuilder('account')
      .select('account.connectionId', 'connectionId')
      .addSelect('COUNT(*)', 'total')
      .where('account.userId = :userId', { userId })
      .andWhere('account.connectionId IN (:...connectionIds)', {
        connectionIds: normalizedConnectionIds,
      })
      .groupBy('account.connectionId')
      .getRawMany<{ connectionId: string; total: string }>();

    return new Map(
      normalizedConnectionIds.map((connectionId) => {
        const match = rows.find((row) => row.connectionId === connectionId);
        return [connectionId, Number(match?.total || 0)];
      })
    );
  }

  async createBrokerAccount(payload: Partial<BrokerAccount>): Promise<BrokerAccount> {
    const created = this.brokerAccountRepository.create(payload);
    return this.brokerAccountRepository.save(created);
  }

  async updateBrokerAccount(userId: string, accountId: string, payload: Partial<BrokerAccount>): Promise<void> {
    const existing = await this.getBrokerAccountById(userId, accountId);
    if (!existing) return;
    const merged = this.brokerAccountRepository.merge(existing, payload);
    await this.brokerAccountRepository.save(merged);
  }

  async deleteBrokerAccount(userId: string, accountId: string): Promise<boolean> {
    const result = await this.brokerAccountRepository.delete({ id: accountId, userId });
    return Boolean(result.affected && result.affected > 0);
  }

  async deleteBrokerAccountsByConnectionId(userId: string, connectionId: string): Promise<number> {
    const result = await this.brokerAccountRepository.delete({ userId, connectionId });
    return result.affected ?? 0;
  }

  async clearDefaultForConnection(userId: string, connectionId: string, excludeAccountId?: string): Promise<void> {
    await this.brokerAccountRepository
      .createQueryBuilder()
      .update(BrokerAccount)
      .set({ isDefault: false })
      .where('user_id = :userId', { userId })
      .andWhere('connectionId = :connectionId', { connectionId })
      .andWhere(excludeAccountId ? 'id <> :excludeAccountId' : '1 = 1', {
        excludeAccountId,
      })
      .execute();
  }

  async ensureSingleDefaultForConnection(
    userId: string,
    connectionId: string,
    options: {
      preferredAccountId?: string;
      excludedAccountId?: string;
    } = {}
  ): Promise<BrokerAccount | null> {
    const accounts = await this.getBrokerAccountsByConnectionId(userId, connectionId);

    if (!accounts.length) {
      return null;
    }

    const excludedAccountId = options.excludedAccountId?.trim() || '';
    const preferredAccountId = options.preferredAccountId?.trim() || '';
    const pickableAccounts = accounts.filter((account) => account.id !== excludedAccountId);
    const targetAccount =
      accounts.find((account) => account.id === preferredAccountId) ||
      pickableAccounts.find((account) => account.isDefault) ||
      pickableAccounts[0] ||
      accounts[0];

    await this.clearDefaultForConnection(userId, connectionId, targetAccount.id);

    if (!targetAccount.isDefault) {
      await this.updateBrokerAccount(userId, targetAccount.id, {
        isDefault: true,
      });
    }

    return this.getBrokerAccountById(userId, targetAccount.id);
  }

  async listSystemBrokerAccounts(options?: {
    statuses?: string[];
    brokerKey?: string;
  }): Promise<BrokerAccount[]> {
    const builder = this.brokerAccountRepository
      .createQueryBuilder('account')
      .where('account.userId IS NULL')
      .orderBy('account.isDefault', 'DESC')
      .addOrderBy('account.updatedAt', 'DESC');

    if (options?.brokerKey) {
      builder.andWhere('LOWER(account.brokerKey) = LOWER(:brokerKey)', { brokerKey: options.brokerKey });
    }

    if (options?.statuses?.length) {
      const normalized = options.statuses.map((item) => String(item || '').trim()).filter(Boolean);
      if (normalized.length > 0) {
        builder.andWhere(
          `LOWER(account.status) IN (${normalized.map((_, index) => `:status${index}`).join(',')})`,
          Object.fromEntries(normalized.map((item, index) => [`status${index}`, item.toLowerCase()]))
        );
      }
    }

    return builder.getMany();
  }

  async getSystemBrokerAccountById(accountId: string): Promise<BrokerAccount | null> {
    return this.brokerAccountRepository.findOne({
      where: {
        id: accountId,
        userId: IsNull(),
      },
    });
  }
}
