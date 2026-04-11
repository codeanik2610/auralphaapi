import { Service } from 'typedi';
import { Repository } from 'typeorm';
import { coreDataSource } from '../data-source';
import { PortfolioHolding } from '../entities/PortfolioHolding';
import { PortfolioSnapshot } from '../entities/PortfolioSnapshot';

export interface PortfolioHoldingsQuery {
  limit: number;
  offset: number;
  search?: string;
  sleeve?: string;
  side?: string;
}

export interface PortfolioSnapshotsQuery {
  limit: number;
  offset: number;
}

@Service()
export class PortfolioRepository {
  private get snapshotRepository(): Repository<PortfolioSnapshot> {
    return coreDataSource.getRepository(PortfolioSnapshot);
  }

  private get holdingRepository(): Repository<PortfolioHolding> {
    return coreDataSource.getRepository(PortfolioHolding);
  }

  private createLatestSnapshotQuery(userId: string) {
    return this.snapshotRepository
      .createQueryBuilder('snapshot')
      .where('snapshot.userId = :userId', { userId })
      .orderBy('snapshot.createdAt', 'DESC');
  }

  async getLatestSnapshot(userId: string): Promise<PortfolioSnapshot | null> {
    return this.createLatestSnapshotQuery(userId)
      .leftJoinAndSelect('snapshot.holdings', 'holdings')
      .addOrderBy('holdings.marketValue', 'DESC')
      .getOne();
  }

  async getLatestSnapshotReference(
    userId: string
  ): Promise<Pick<PortfolioSnapshot, 'id' | 'createdAt'> | null> {
    const snapshot = await this.createLatestSnapshotQuery(userId)
      .select(['snapshot.id', 'snapshot.createdAt'])
      .getOne();

    if (!snapshot) {
      return null;
    }

    return {
      id: snapshot.id,
      createdAt: snapshot.createdAt,
    };
  }

  async listHoldings(userId: string, query: PortfolioHoldingsQuery) {
    const snapshot = await this.getLatestSnapshotReference(userId);
    if (!snapshot) {
      return { items: [], total: 0, snapshot: null };
    }

    const builder = this.holdingRepository
      .createQueryBuilder('holding')
      .where('holding.snapshotId = :snapshotId', { snapshotId: snapshot.id })
      .andWhere('holding.userId = :userId', { userId })
      .orderBy('holding.marketValue', 'DESC')
      .skip(query.offset)
      .take(query.limit);

    if (query.sleeve) {
      builder.andWhere('LOWER(holding.sleeve) = LOWER(:sleeve)', { sleeve: query.sleeve });
    }

    if (query.side) {
      builder.andWhere('LOWER(holding.side) = LOWER(:side)', { side: query.side });
    }

    if (query.search) {
      builder.andWhere(
        '(holding.symbol LIKE :search OR holding.side LIKE :search OR holding.strategy LIKE :search OR holding.riskState LIKE :search OR holding.sleeve LIKE :search OR holding.contribution LIKE :search)',
        { search: `%${query.search}%` }
      );
    }

    const [items, total] = await builder.getManyAndCount();
    return { items, total, snapshot };
  }

  async getHoldingById(userId: string, holdingId: string): Promise<PortfolioHolding | null> {
    return this.holdingRepository.findOne({ where: { id: holdingId, userId } });
  }

  async getPortfolioSummary(userId: string): Promise<PortfolioSnapshot | null> {
    return this.getLatestSnapshot(userId);
  }

  async listDistinctSnapshotUserIds(): Promise<string[]> {
    const rows = await this.snapshotRepository
      .createQueryBuilder('snapshot')
      .select('snapshot.userId', 'userId')
      .groupBy('snapshot.userId')
      .getRawMany<{ userId: string }>();

    return rows
      .map((row) => String(row.userId || '').trim())
      .filter(Boolean);
  }

  async listSnapshotsSince(userId: string, startAt: Date): Promise<PortfolioSnapshot[]> {
    return this.snapshotRepository
      .createQueryBuilder('snapshot')
      .where('snapshot.userId = :userId', { userId })
      .andWhere('snapshot.createdAt >= :startAt', { startAt })
      .orderBy('snapshot.createdAt', 'DESC')
      .getMany();
  }

  async listSnapshots(userId: string, query: PortfolioSnapshotsQuery) {
    const builder = this.snapshotRepository
      .createQueryBuilder('snapshot')
      .where('snapshot.userId = :userId', { userId })
      .orderBy('snapshot.createdAt', 'DESC')
      .skip(query.offset)
      .take(query.limit);

    const [items, total] = await builder.getManyAndCount();
    return { items, total };
  }

  async getLatestPnLByWindow(
    userId: string,
    startAt: Date
  ): Promise<{ pnl: number } | null> {
    const result = await this.snapshotRepository
      .createQueryBuilder('snapshot')
      .select('COALESCE(SUM(snapshot.dayPnL), 0)', 'pnl')
      .where('snapshot.userId = :userId', { userId })
      .andWhere('snapshot.createdAt >= :startAt', { startAt })
      .getRawOne<{ pnl: number }>();
    return result ?? null;
  }

  async listPerformancePoints(userId: string, startAt: Date): Promise<PortfolioSnapshot[]> {
    return this.snapshotRepository
      .createQueryBuilder('snapshot')
      .select(['snapshot.id', 'snapshot.equity', 'snapshot.dayPnL', 'snapshot.createdAt'])
      .where('snapshot.userId = :userId', { userId })
      .andWhere('snapshot.createdAt >= :startAt', { startAt })
      .orderBy('snapshot.createdAt', 'ASC')
      .getMany();
  }
}
