import { Service } from 'typedi';
import { Brackets, In, Repository, SelectQueryBuilder } from 'typeorm';
import { coreDataSource } from '../data-source';
import { MarketSymbolSnapshot } from '../entities/MarketSymbolSnapshot';

export interface MarketSymbolSnapshotUpsert {
  symbol: string;
  assetId?: string | null;
  name?: string | null;
  source?: string | null;
  lastPrice?: string | null;
  change24h?: number | null;
  volume24h?: number | null;
  high24h?: string | null;
  low24h?: string | null;
  liquidityTier?: string | null;
  priceSource?: string | null;
  snapshotAt?: Date | null;
}

export interface MarketSnapshotListQuery {
  limit: number;
  offset: number;
  search?: string;
  sort?: string;
  order?: string;
  liquidityTier?: string;
}

export interface MarketSnapshotMatchQuery {
  search?: string;
  liquidityTier?: string;
}

@Service()
export class MarketSymbolSnapshotRepository {
  private static readonly SUPPORTED_OVERVIEW_SORTS = new Set([
    'volume',
    'change',
    'change_perc',
    'price',
    'symbol',
    'name',
  ]);

  private get repository(): Repository<MarketSymbolSnapshot> {
    return coreDataSource.getRepository(MarketSymbolSnapshot);
  }

  supportsOverviewSort(sort?: string): boolean {
    const normalizedSort = String(sort || 'volume').trim().toLowerCase();
    return MarketSymbolSnapshotRepository.SUPPORTED_OVERVIEW_SORTS.has(normalizedSort);
  }

  async getBySymbol(symbol: string): Promise<MarketSymbolSnapshot | null> {
    const normalized = String(symbol || '').trim().toUpperCase();
    if (!normalized) {
      return null;
    }
    return this.repository.findOne({ where: { symbol: normalized } });
  }

  async getBySymbols(symbols: string[]): Promise<MarketSymbolSnapshot[]> {
    const normalized = Array.from(
      new Set(
        (symbols || [])
          .map((symbol) => String(symbol || '').trim().toUpperCase())
          .filter(Boolean)
      )
    );
    if (!normalized.length) {
      return [];
    }
    return this.repository.find({ where: { symbol: In(normalized) } });
  }

  async listOverviewSnapshots(query: MarketSnapshotListQuery): Promise<{
    data: MarketSymbolSnapshot[];
    total: number;
    timings: {
      countMs: number;
      dataMs: number;
    };
  }> {
    const qb = this.repository.createQueryBuilder('snapshot');

    this.applyOverviewFilters(qb, query);

    const countStartedAt = Date.now();
    const total = await qb.clone().getCount();
    const countMs = Date.now() - countStartedAt;

    this.applyOverviewSort(qb, query.sort, query.order);
    qb.skip(Math.max(0, Number(query.offset) || 0));
    qb.take(Math.max(1, Number(query.limit) || 1));

    const dataStartedAt = Date.now();
    const data = await qb.getMany();
    const dataMs = Date.now() - dataStartedAt;
    return { data, total, timings: { countMs, dataMs } };
  }

  async listMatchingSnapshots(query: MarketSnapshotMatchQuery): Promise<MarketSymbolSnapshot[]> {
    const qb = this.repository.createQueryBuilder('snapshot');

    this.applyOverviewFilters(qb, query);
    qb.orderBy('snapshot.symbol', 'ASC');

    return qb.getMany();
  }

  async hasSnapshots(): Promise<boolean> {
    return this.repository
      .createQueryBuilder('snapshot')
      .select('1')
      .limit(1)
      .getRawOne()
      .then(Boolean);
  }

  async upsertSnapshots(payload: MarketSymbolSnapshotUpsert[]): Promise<void> {
    const normalized = payload
      .map((item) => ({
        ...item,
        symbol: String(item.symbol || '').trim().toUpperCase(),
      }))
      .filter((item) => item.symbol);

    if (!normalized.length) {
      return;
    }

    await this.repository.upsert(normalized, {
      conflictPaths: ['symbol'],
      skipUpdateIfNoValuesChanged: false,
    });
  }

  private applyOverviewFilters(
    qb: SelectQueryBuilder<MarketSymbolSnapshot>,
    query: Pick<MarketSnapshotListQuery, 'search' | 'liquidityTier'>
  ): void {
    const search = String(query.search || '').trim();
    const liquidityTier = String(query.liquidityTier || 'all').trim().toLowerCase();

    if (search) {
      const normalizedSymbolSearch = search.toUpperCase();
      qb.andWhere(
        new Brackets((searchQb) => {
          searchQb
            .where('snapshot.symbol = :symbolExact', { symbolExact: normalizedSymbolSearch })
            .orWhere('snapshot.symbol LIKE :symbolPrefix', {
              symbolPrefix: `${normalizedSymbolSearch}%`,
            })
            .orWhere('LOWER(COALESCE(snapshot.name, \'\')) LIKE :nameSearch', {
              nameSearch: `%${search.toLowerCase()}%`,
            });
        })
      );
    }

    if (liquidityTier && liquidityTier !== 'all') {
      qb.andWhere('LOWER(COALESCE(snapshot.liquidityTier, \'\')) = :liquidityTier', {
        liquidityTier,
      });
    }
  }

  private applyOverviewSort(
    qb: SelectQueryBuilder<MarketSymbolSnapshot>,
    sort?: string,
    order?: string
  ): void {
    const normalizedSort = String(sort || 'volume').trim().toLowerCase();
    const normalizedOrder = String(order || 'desc').trim().toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const sortColumnMap: Record<string, string> = {
      volume: 'snapshot.volume24h',
      change: 'snapshot.change24h',
      change_perc: 'snapshot.change24h',
      price: 'snapshot.lastPrice',
      symbol: 'snapshot.symbol',
      name: 'snapshot.name',
    };

    const sortColumn = sortColumnMap[normalizedSort] || sortColumnMap.volume;
    qb.orderBy(`CASE WHEN ${sortColumn} IS NULL THEN 1 ELSE 0 END`, 'ASC');
    qb.addOrderBy(sortColumn, normalizedOrder);
    qb.addOrderBy('snapshot.symbol', 'ASC');
  }
}
