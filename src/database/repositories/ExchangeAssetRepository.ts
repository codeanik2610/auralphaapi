import { Service } from 'typedi';
import { Brackets, In, Repository } from 'typeorm';
import { coreDataSource } from '../data-source';
import { BrokerAccount } from '../entities/BrokerAccount';
import { Connection } from '../entities/Connection';
import { ExchangeAsset } from '../entities/ExchangeAsset';

export interface ExchangeAssetUpsertPayload {
  source: string;
  brokerId?: string | null;
  externalId: string;
  assetId: string;
  name: string;
  symbol: string;
}

export interface ExchangeAssetSyncResult {
  attempted: number;
  matched: number;
  inserted: number;
  updated: number;
  skipped: number;
  totalStored: number;
  changes?: Array<{
    symbol: string;
    externalId: string;
    assetId: string;
    actionType: 'inserted' | 'updated';
  }>;
}

export interface ExchangeAssetListQuery {
  limit: number;
  offset: number;
  search?: string;
  source?: string;
}

export interface SystemExchangeAssetListQuery {
  limit: number;
  offset: number;
  search?: string;
  assetId?: string;
  symbols?: string[];
}

export interface SystemExchangeAssetSymbolItem {
  id: string;
  symbol: string;
  source: string;
}

export interface AssetPriceScopeAssetQuery {
  limit: number;
  offset: number;
  search?: string;
  assetId?: string;
  sources?: string[];
}

const USER_VISIBLE_BROKER_ACCOUNT_STATUSES = ['Connected', 'Idle'] as const;

// Phase 4 schema cleanup, now carried forward as the Phase 5 steady-state contract:
// broker_assets no longer carries legacy per-user ownership. All rows are
// global catalog rows, and user-visible filtering is derived from owned routes.
@Service()
export class ExchangeAssetRepository {
  private get repository(): Repository<ExchangeAsset> {
    return coreDataSource.getRepository(ExchangeAsset);
  }

  async replaceSystemAssets(
    source: string,
    assets: ExchangeAssetUpsertPayload[],
    attempted: number
  ): Promise<ExchangeAssetSyncResult> {
    const existingAssets = await this.repository.find({
      select: {
        symbol: true,
        externalId: true,
        assetId: true,
      },
      where: {
        source,
      },
    });

    const existingBySymbol = new Map(
      existingAssets.map((item) => [String(item.symbol || '').toUpperCase(), item])
    );

    await this.repository.delete({
      source,
    });

    const payload = assets.map((asset) => ({ ...asset }));

    if (payload.length > 0) {
      await this.repository.insert(payload);
    }

    let updated = 0;
    let inserted = 0;
    const changes: ExchangeAssetSyncResult['changes'] = [];
    for (const item of payload) {
      const key = String(item.symbol || '').toUpperCase();
      const existing = existingBySymbol.get(key);
      if (!existing) {
        inserted += 1;
        changes.push({
          symbol: item.symbol,
          externalId: item.externalId,
          assetId: item.assetId,
          actionType: 'inserted',
        });
        continue;
      }

      if (existing.externalId !== item.externalId || existing.assetId !== item.assetId) {
        updated += 1;
        changes.push({
          symbol: item.symbol,
          externalId: item.externalId,
          assetId: item.assetId,
          actionType: 'updated',
        });
      } else {
        inserted += 0;
      }
    }

    const totalStored = await this.repository.count({
      where: {
        source,
      },
    });

    return {
      attempted,
      matched: payload.length,
      inserted,
      updated,
      skipped: Math.max(attempted - payload.length, 0),
      totalStored,
      changes,
    };
  }

  async getSystemAssetBySourceAndExternalId(
    source: string,
    externalId: string
  ): Promise<ExchangeAsset | null> {
    return this.repository.findOne({
      where: {
        source,
        externalId,
      },
    });
  }

  async getSystemAssetBySourceAndAssetId(
    source: string,
    assetId: string
  ): Promise<ExchangeAsset | null> {
    return this.repository.findOne({
      where: {
        source,
        assetId,
      },
    });
  }

  async getSystemAssetBySourceAndSymbol(
    source: string,
    symbol: string
  ): Promise<ExchangeAsset | null> {
    return this.repository.findOne({
      where: {
        source,
        symbol,
      },
    });
  }

  async listVisibleAssetsForUser(
    userId: string,
    query: ExchangeAssetListQuery
  ): Promise<{ data: ExchangeAsset[]; total: number }> {
    const builder = this.buildUserVisibleSystemAssetQuery(userId).orderBy('asset.name', 'ASC');

    if (query.source) {
      builder.andWhere('LOWER(asset.source) = LOWER(:source)', { source: query.source });
    }

    if (query.search) {
      builder.andWhere('(asset.name LIKE :search OR UPPER(asset.symbol) LIKE :upperSearch)', {
        search: `%${query.search}%`,
        upperSearch: `%${query.search.toUpperCase()}%`,
      });
    }

    const totalRow = await builder
      .clone()
      .select('COUNT(DISTINCT asset.id)', 'total')
      .getRawOne<{ total?: string | number }>();

    const data = await builder
      .clone()
      .distinct(true)
      .skip(query.offset)
      .take(query.limit)
      .getMany();

    return {
      data,
      total: Number(totalRow?.total || 0),
    };
  }

  async countVisibleAssetsForUser(userId: string, source?: string): Promise<number> {
    const builder = this.buildUserVisibleSystemAssetQuery(userId);

    if (source) {
      builder.andWhere('LOWER(asset.source) = LOWER(:source)', { source });
    }

    const row = await builder
      .clone()
      .select('COUNT(DISTINCT asset.id)', 'total')
      .getRawOne<{ total?: string | number }>();

    return Number(row?.total || 0);
  }

  async listVisibleAssetsBySourceAndSymbolsForUser(
    userId: string,
    source: string,
    symbols: string[]
  ): Promise<ExchangeAsset[]> {
    const normalizedSymbols = Array.from(
      new Set(
        symbols
          .map((item) => String(item || '').trim().toUpperCase())
          .filter(Boolean)
      )
    );

    if (!normalizedSymbols.length) {
      return [];
    }

    return this.buildUserVisibleSystemAssetQuery(userId)
      .andWhere('LOWER(asset.source) = LOWER(:source)', { source })
      .andWhere('asset.symbol IN (:...symbols)', {
        symbols: normalizedSymbols,
      })
      .distinct(true)
      .getMany();
  }

  async listSystemAssetsBySourceAndSymbols(source: string, symbols: string[]): Promise<ExchangeAsset[]> {
    const normalizedSymbols = Array.from(
      new Set(
        symbols
          .map((item) => String(item || '').trim().toUpperCase())
          .filter(Boolean)
      )
    );

    if (!normalizedSymbols.length) {
      return [];
    }

    return this.repository
      .createQueryBuilder('asset')
      .where('LOWER(asset.source) = LOWER(:source)', { source })
      .andWhere('UPPER(asset.symbol) IN (:...symbols)', {
        symbols: normalizedSymbols,
      })
      .getMany();
  }

  async listSystemAssetsForAssetPriceScope(
    query: AssetPriceScopeAssetQuery
  ): Promise<{ items: SystemExchangeAssetSymbolItem[]; total: number }> {
    const search = String(query.search || '').trim().toUpperCase();
    const assetId = String(query.assetId || '').trim();
    const normalizedSources = Array.isArray(query.sources)
      ? Array.from(
          new Set(
            query.sources
              .map((item) => String(item || '').trim().toLowerCase())
              .filter(Boolean)
          )
        )
      : [];

    const builder = this.repository
      .createQueryBuilder('asset')
      .where('asset.symbol IS NOT NULL')
      .andWhere('TRIM(asset.symbol) <> \'\'');

    if (normalizedSources.length) {
      builder.andWhere('LOWER(asset.source) IN (:...sources)', {
        sources: normalizedSources,
      });
    }

    if (assetId) {
      builder.andWhere('asset.id = :assetId', { assetId });
    }

    if (search) {
      builder.andWhere(
        '(UPPER(asset.symbol) LIKE :search OR UPPER(COALESCE(asset.name, \'\')) LIKE :search)',
        {
          search: `%${search}%`,
        }
      );
    }

    const [items, total] = await builder
      .clone()
      .orderBy('UPPER(asset.symbol)', 'ASC')
      .addOrderBy('LOWER(asset.source)', 'ASC')
      .offset(query.offset)
      .limit(query.limit)
      .getManyAndCount();

    return {
      items: items.map((item) => ({
        id: item.id,
        symbol: String(item.symbol || '').trim().toUpperCase(),
        source: String(item.source || '').trim().toLowerCase(),
      })),
      total,
    };
  }

  async listSystemAssetsDistinctSymbols(
    query: SystemExchangeAssetListQuery
  ): Promise<{ items: SystemExchangeAssetSymbolItem[]; total: number }> {
    const search = String(query.search || '').trim().toUpperCase();
    const assetId = String(query.assetId || '').trim();
    const allowedSymbols = Array.isArray(query.symbols)
      ? Array.from(
          new Set(
            query.symbols
              .map((item) => String(item || '').trim().toUpperCase())
              .filter(Boolean)
          )
        )
      : null;

    if (allowedSymbols && allowedSymbols.length === 0) {
      return {
        items: [],
        total: 0,
      };
    }

    const baseBuilder = this.repository
      .createQueryBuilder('asset')
      .where('1 = 1')
      .andWhere('asset.symbol IS NOT NULL')
      .andWhere('TRIM(asset.symbol) <> \'\'');

    if (assetId) {
      baseBuilder.andWhere('asset.id = :assetId', { assetId });
    }

    if (search) {
      baseBuilder.andWhere('UPPER(asset.symbol) LIKE :search', {
        search: `%${search}%`,
      });
    }

    if (allowedSymbols?.length) {
      baseBuilder.andWhere('asset.symbol IN (:...symbols)', {
        symbols: allowedSymbols,
      });
    }

    const totalRow = await baseBuilder
      .clone()
      .select('COUNT(DISTINCT UPPER(asset.symbol))', 'total')
      .getRawOne<{ total?: string | number }>();

    const rows = await baseBuilder
      .clone()
      .select('MIN(asset.id)', 'id')
      .addSelect('UPPER(asset.symbol)', 'symbol')
      .addSelect('MIN(asset.source)', 'source')
      .groupBy('UPPER(asset.symbol)')
      .orderBy('UPPER(asset.symbol)', 'ASC')
      .offset(query.offset)
      .limit(query.limit)
      .getRawMany<{ id?: string; symbol?: string; source?: string }>();

    return {
      items: rows
        .map((row) => ({
          id: String(row.id || '').trim(),
          symbol: String(row.symbol || '').trim().toUpperCase(),
          source: String(row.source || '').trim().toLowerCase() || 'exchange-assets',
        }))
        .filter((item) => Boolean(item.id && item.symbol)),
      total: Number(totalRow?.total || 0),
    };
  }

  async listSystemAssetSymbolsByIds(ids: string[]): Promise<string[]> {
    const normalizedIds = Array.from(
      new Set(ids.map((item) => String(item || '').trim()).filter(Boolean))
    );
    if (!normalizedIds.length) {
      return [];
    }
    const rows = await this.repository.find({
      select: { symbol: true },
      where: {
        id: In(normalizedIds),
      },
    });
    return Array.from(
      new Set(
        rows
          .map((row) => String(row.symbol || '').trim().toUpperCase())
          .filter(Boolean)
      )
    );
  }

  async listSystemAssetIdsByIds(ids: string[], sources?: string[]): Promise<string[]> {
    const normalizedIds = Array.from(
      new Set(ids.map((item) => String(item || '').trim()).filter(Boolean))
    );
    const normalizedSources = Array.isArray(sources)
      ? Array.from(
          new Set(
            sources
              .map((item) => String(item || '').trim().toLowerCase())
              .filter(Boolean)
          )
        )
      : [];

    if (!normalizedIds.length) {
      return [];
    }

    const builder = this.repository
      .createQueryBuilder('asset')
      .select('asset.id', 'id')
      .where('asset.id IN (:...ids)', { ids: normalizedIds });

    if (normalizedSources.length) {
      builder.andWhere('LOWER(asset.source) IN (:...sources)', {
        sources: normalizedSources,
      });
    }

    const rows = await builder.orderBy('asset.id', 'ASC').getRawMany<{ id?: string }>();
    return rows
      .map((row) => String(row.id || '').trim())
      .filter(Boolean);
  }

  async listSystemAssetIdsBySources(sources: string[]): Promise<string[]> {
    const normalizedSources = Array.from(
      new Set(
        (sources || [])
          .map((item) => String(item || '').trim().toLowerCase())
          .filter(Boolean)
      )
    );

    if (!normalizedSources.length) {
      return [];
    }

    const rows = await this.repository
      .createQueryBuilder('asset')
      .select('asset.id', 'id')
      .where('LOWER(asset.source) IN (:...sources)', {
        sources: normalizedSources,
      })
      .andWhere('asset.symbol IS NOT NULL')
      .andWhere('TRIM(asset.symbol) <> \'\'')
      .orderBy('UPPER(asset.symbol)', 'ASC')
      .addOrderBy('LOWER(asset.source)', 'ASC')
      .getRawMany<{ id?: string }>();

    return rows
      .map((row) => String(row.id || '').trim())
      .filter(Boolean);
  }

  private buildUserVisibleSystemAssetQuery(userId: string) {
    const builder = this.repository.createQueryBuilder('asset');
    const connectionVisibilitySubquery = builder
      .subQuery()
      .select('1')
      .from(Connection, 'connection')
      .where('connection.user_id = :visibleUserId')
      .andWhere(
        new Brackets((visibilityQb) => {
          visibilityQb
            .where('LOWER(connection.brokerKey) = LOWER(asset.source)')
            .orWhere('(connection.broker_id IS NOT NULL AND connection.broker_id = asset.broker_id)');
        })
      )
      .getQuery();

    const accountVisibilitySubquery = builder
      .subQuery()
      .select('1')
      .from(BrokerAccount, 'account')
      .where('account.user_id = :visibleUserId')
      .andWhere('account.status IN (:...visibleBrokerAccountStatuses)')
      .andWhere(
        new Brackets((visibilityQb) => {
          visibilityQb
            .where('LOWER(account.brokerKey) = LOWER(asset.source)')
            .orWhere('(account.broker_id IS NOT NULL AND account.broker_id = asset.broker_id)');
        })
      )
      .getQuery();

    builder
      .andWhere(
        new Brackets((visibilityQb) => {
          visibilityQb
            .where(`EXISTS ${connectionVisibilitySubquery}`)
            .orWhere(`EXISTS ${accountVisibilitySubquery}`);
        })
      )
      .setParameters({
        visibleUserId: userId,
        visibleBrokerAccountStatuses: [...USER_VISIBLE_BROKER_ACCOUNT_STATUSES],
      });

    return builder;
  }
}
