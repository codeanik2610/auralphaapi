import { Service } from 'typedi';
import { In, Repository } from 'typeorm';
import { coreDataSource } from '../data-source';
import { Watchlist } from '../entities/Watchlist';
import { WatchlistItem } from '../entities/WatchlistItem';

export interface WatchlistItemsQuery {
  limit: number;
  offset: number;
  search?: string;
}

export interface CreateWatchlistInput {
  name: string;
  type: string;
  description?: string | null;
}

export interface UpdateWatchlistInput {
  name?: string;
  description?: string | null;
}

@Service()
export class WatchlistRepository {
  private get watchlistRepository(): Repository<Watchlist> {
    return coreDataSource.getRepository(Watchlist);
  }

  private get watchlistItemRepository(): Repository<WatchlistItem> {
    return coreDataSource.getRepository(WatchlistItem);
  }

  async listWatchlists(userId: string): Promise<Watchlist[]> {
    return this.watchlistRepository
      .createQueryBuilder('watchlist')
      .loadRelationCountAndMap('watchlist.itemsCount', 'watchlist.items')
      .where('watchlist.userId = :userId', { userId })
      .orderBy('watchlist.updatedAt', 'DESC')
      .getMany();
  }

  async getWatchlistById(userId: string, watchlistId: string): Promise<Watchlist | null> {
    return this.watchlistRepository
      .createQueryBuilder('watchlist')
      .loadRelationCountAndMap('watchlist.itemsCount', 'watchlist.items')
      .where('watchlist.id = :watchlistId', { watchlistId })
      .andWhere('watchlist.userId = :userId', { userId })
      .getOne();
  }

  async listWatchlistItems(userId: string, watchlistId: string, query: WatchlistItemsQuery) {
    const builder = this.watchlistItemRepository
      .createQueryBuilder('watchlistItem')
      .where('watchlistItem.watchlistId = :watchlistId', { watchlistId })
      .andWhere('watchlistItem.userId = :userId', { userId })
      .orderBy('watchlistItem.updatedAt', 'DESC')
      .skip(query.offset)
      .take(query.limit);

    if (query.search) {
      const trimmedSearch = String(query.search || '').trim();
      const normalizedSymbolSearch = trimmedSearch.toUpperCase();
      builder.andWhere(
        '(watchlistItem.symbol = :symbolExact OR watchlistItem.symbol LIKE :symbolPrefix OR watchlistItem.regime LIKE :search OR watchlistItem.signal LIKE :search OR watchlistItem.setup LIKE :search OR watchlistItem.status LIKE :search OR watchlistItem.liquidity LIKE :search)',
        {
          symbolExact: normalizedSymbolSearch,
          symbolPrefix: `${normalizedSymbolSearch}%`,
          search: `%${trimmedSearch}%`,
        }
      );
    }

    const [items, total] = await builder.getManyAndCount();
    return { items, total };
  }

  async deleteWatchlist(userId: string, watchlistId: string): Promise<boolean> {
    const result = await this.watchlistRepository.delete({ id: watchlistId, userId });
    return Boolean(result.affected && result.affected > 0);
  }

  async createWatchlist(userId: string, input: CreateWatchlistInput): Promise<Watchlist> {
    const watchlist = this.watchlistRepository.create({
      name: input.name,
      type: input.type,
      description: input.description ?? null,
      userId,
    });
    return this.watchlistRepository.save(watchlist);
  }

  async updateWatchlist(
    userId: string,
    watchlistId: string,
    input: UpdateWatchlistInput
  ): Promise<Watchlist | null> {
    const watchlist = await this.getWatchlistById(userId, watchlistId);
    if (!watchlist) {
      return null;
    }

    if (input.name !== undefined) {
      watchlist.name = input.name;
    }
    if (input.description !== undefined) {
      watchlist.description = input.description;
    }

    return this.watchlistRepository.save(watchlist);
  }

  async removeWatchlistItems(userId: string, watchlistId: string, symbols: string[]) {
    const existing = await this.watchlistItemRepository.find({
      where: { userId, watchlistId, symbol: In(symbols) },
    });
    if (!existing.length) {
      return { removed: [], skipped: symbols };
    }

    const existingSymbols = new Set(existing.map((item) => item.symbol));
    await this.watchlistItemRepository.delete({
      userId,
      watchlistId,
      symbol: In(symbols),
    });

    return {
      removed: symbols.filter((symbol) => existingSymbols.has(symbol)),
      skipped: symbols.filter((symbol) => !existingSymbols.has(symbol)),
    };
  }

  async addWatchlistItems(userId: string, watchlistId: string, symbols: string[]) {
    const existingItems = await this.watchlistItemRepository.find({
      where: { userId, watchlistId, symbol: In(symbols) },
    });
    const existingSymbols = new Set(existingItems.map((item) => item.symbol));

    const toInsert = symbols.filter((symbol) => !existingSymbols.has(symbol));
    if (!toInsert.length) {
      return { added: [], skipped: symbols };
    }

    await this.watchlistItemRepository
      .createQueryBuilder()
      .insert()
      .into(WatchlistItem)
      .values(
        toInsert.map((symbol) => ({
          watchlistId,
          userId,
          symbol,
        }))
      )
      .orIgnore()
      .execute();

    const persistedItems = await this.watchlistItemRepository.find({
      where: { userId, watchlistId, symbol: In(toInsert) },
    });
    const persistedSymbols = new Set(persistedItems.map((item) => item.symbol));

    return {
      added: toInsert.filter((symbol) => persistedSymbols.has(symbol)),
      skipped: symbols.filter(
        (symbol) => existingSymbols.has(symbol) || !persistedSymbols.has(symbol)
      ),
    };
  }

  isDuplicateWatchlistNameError(error: unknown): boolean {
    return this.matchesConstraintError(error, ['uidx_watchlists_owner_name_ci']);
  }

  private matchesConstraintError(error: unknown, markers: string[]): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }

    const code = String((error as { code?: string }).code || '').trim();
    const message = String((error as { message?: string }).message || '').toLowerCase();
    const constraint = String((error as { constraint?: string }).constraint || '').toLowerCase();

    if (code !== 'ER_DUP_ENTRY' && code !== '23505') {
      return false;
    }

    return markers.some(
      (marker) => message.includes(marker.toLowerCase()) || constraint.includes(marker.toLowerCase())
    );
  }

  async listWatchlistsContainingSymbol(userId: string, symbol: string): Promise<Watchlist[]> {
    const normalized = String(symbol || '').trim().toUpperCase();
    if (!normalized) {
      return [];
    }

    return this.watchlistRepository
      .createQueryBuilder('watchlist')
      .innerJoin(
        'watchlist.items',
        'watchlistItem',
        'watchlistItem.symbol = :symbol AND watchlistItem.userId = :userId',
        { symbol: normalized, userId }
      )
      .where('watchlist.userId = :userId', { userId })
      .orderBy('watchlist.updatedAt', 'DESC')
      .getMany();
  }

  async countWatchlistsBySymbols(
    userId: string,
    symbols: string[]
  ): Promise<Map<string, number>> {
    const normalizedSymbols = Array.from(
      new Set(
        (symbols || [])
          .map((symbol) => String(symbol || '').trim().toUpperCase())
          .filter(Boolean)
      )
    );

    if (!normalizedSymbols.length) {
      return new Map();
    }

    const rows = await this.watchlistItemRepository
      .createQueryBuilder('watchlistItem')
      .select('watchlistItem.symbol', 'symbol')
      .addSelect('COUNT(DISTINCT watchlistItem.watchlistId)', 'total')
      .where('watchlistItem.userId = :userId', { userId })
      .andWhere('watchlistItem.symbol IN (:...symbols)', { symbols: normalizedSymbols })
      .groupBy('watchlistItem.symbol')
      .getRawMany<{ symbol: string; total: string | number }>();

    return new Map(
      rows.map((row) => [String(row.symbol || '').trim().toUpperCase(), Number(row.total || 0)])
    );
  }

  async getWatchlistsSummary(userId: string): Promise<{
    savedLists: number;
    symbolsTracked: number;
    activeAlerts: number;
    topAiScore: number;
  }> {
    const [savedLists, symbolsTracked, alertCount, topAiScoreRow] = await Promise.all([
      this.watchlistRepository.count({ where: { userId } }),
      this.watchlistItemRepository.count({ where: { userId } }),
      this.watchlistItemRepository
        .createQueryBuilder('watchlistItem')
        .select('COALESCE(SUM(watchlistItem.alerts), 0)', 'total')
        .where('watchlistItem.userId = :userId', { userId })
        .getRawOne<{ total: string | number }>(),
      this.watchlistItemRepository
        .createQueryBuilder('watchlistItem')
        .select('COALESCE(MAX(watchlistItem.aiScore), 0)', 'topAiScore')
        .where('watchlistItem.userId = :userId', { userId })
        .getRawOne<{ topAiScore: string | number }>(),
    ]);

    return {
      savedLists,
      symbolsTracked,
      activeAlerts: Number(alertCount?.total ?? 0),
      topAiScore: Number(topAiScoreRow?.topAiScore ?? 0),
    };
  }
}
