import { Service } from 'typedi';
import { IsNull, Repository } from 'typeorm';
import { coreDataSource } from '../data-source';
import { Connection } from '../entities/Connection';

export interface ConnectionListQuery {
  limit: number;
  offset: number;
  type?: string;
  search?: string;
}

@Service()
export class ConnectionRepository {
  private get connectionRepository(): Repository<Connection> {
    return coreDataSource.getRepository(Connection);
  }

  async listConnections(userId: string, query: ConnectionListQuery) {
    const builder = this.connectionRepository
      .createQueryBuilder('connection')
      .where('connection.userId = :userId', { userId })
      .orderBy('connection.updatedAt', 'DESC')
      .skip(query.offset)
      .take(query.limit);

    if (query.type) {
      builder.andWhere('LOWER(connection.type) = LOWER(:type)', { type: query.type });
    }
    if (query.search) {
      builder.andWhere(
        '(connection.name LIKE :search OR connection.brokerKey LIKE :search OR connection.type LIKE :search OR connection.status LIKE :search OR connection.mode LIKE :search OR connection.route LIKE :search OR connection.broker LIKE :search)',
        { search: '%' + query.search + '%' }
      );
    }

    const [items, total] = await builder.getManyAndCount();
    return { items, total };
  }

  async getConnectionsSummary(userId: string) {
    const [feeds, brokerRoutes, statusRows] =
      await Promise.all([
        this.connectionRepository
          .createQueryBuilder('connection')
          .where('connection.userId = :userId', { userId })
          .andWhere('LOWER(connection.type) = :type', { type: 'feed' })
          .getCount(),
        this.connectionRepository
          .createQueryBuilder('connection')
          .where('connection.userId = :userId', { userId })
          .andWhere('LOWER(connection.type) <> :type', { type: 'feed' })
          .getCount(),
        this.connectionRepository
          .createQueryBuilder('connection')
          .select('LOWER(connection.status)', 'status')
          .addSelect('COUNT(*)', 'total')
          .where('connection.userId = :userId', { userId })
          .groupBy('LOWER(connection.status)')
          .getRawMany<{ status: string | null; total: string }>(),
      ]);

    const health = {
      connected: 0,
      idle: 0,
      disconnected: 0,
    };

    statusRows.forEach((row) => {
      const count = Number(row.total || 0);
      const normalizedStatus = this.normalizeStatusBucket(row.status);
      health[normalizedStatus] += count;
    });

    return {
      healthyConnections: health.connected,
      watchingConnections: health.idle,
      disconnected: health.disconnected,
      syncHealth: health.disconnected
        ? 'Routes need attention'
        : health.connected || health.idle
          ? 'Routes stable'
          : 'No route diagnostics yet',
      connected: health.connected,
      feeds,
      brokerRoutes,
    };
  }

  async getConnectionById(userId: string, connectionId: string): Promise<Connection | null> {
    return this.connectionRepository.findOne({ where: { id: connectionId, userId } });
  }

  async createConnection(payload: Partial<Connection>): Promise<Connection> {
    const created = this.connectionRepository.create(payload);
    return this.connectionRepository.save(created);
  }

  async replaceConnection(userId: string, connectionId: string, payload: Partial<Connection>): Promise<void> {
    await this.connectionRepository.update({ id: connectionId, userId }, payload);
  }

  async updateConnection(
    userId: string,
    connectionId: string,
    payload: Partial<Pick<Connection, 'lastSyncAt' | 'latency' | 'diagnosticSummary' | 'status'>>
  ): Promise<void> {
    await this.connectionRepository.update({ id: connectionId, userId }, payload);
  }

  async deleteConnection(userId: string, connectionId: string): Promise<boolean> {
    const result = await this.connectionRepository.delete({ id: connectionId, userId });
    return Boolean(result.affected && result.affected > 0);
  }

  async getSystemConnectionById(connectionId: string): Promise<Connection | null> {
    return this.connectionRepository.findOne({
      where: {
        id: connectionId,
        userId: IsNull(),
      },
    });
  }

  private normalizeStatusBucket(value?: string | null): 'connected' | 'idle' | 'disconnected' {
    const normalized = String(value || '').trim().toLowerCase();

    if (normalized === 'connected' || normalized === 'active' || normalized === 'stable') {
      return 'connected';
    }

    if (
      normalized === 'disconnected' ||
      normalized === 'failed' ||
      normalized === 'error'
    ) {
      return 'disconnected';
    }

    return 'idle';
  }
}
