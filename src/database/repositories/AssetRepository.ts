import { Service } from 'typedi';
import { In, Like, Repository } from 'typeorm';
import { coreDataSource } from '../data-source';
import { Asset } from '../entities/Asset';

export interface AssetUpsertPayload {
  source: string;
  externalId: string;
  symbol: string;
  name: string;
  status: string;
}

export interface AssetSyncResult {
  fetched: number;
  inserted: number;
  updated: number;
  totalStored: number;
  changes: Array<{
    actionType: 'inserted' | 'updated';
    symbol: string;
    externalId: string;
    assetId: string;
  }>;
}

export interface AssetListQuery {
  limit: number;
  offset: number;
  search?: string;
}

export interface AssetSymbolRecord {
  id: string;
  symbol: string;
}

export interface AssetListRecord {
  id: string;
  symbol: string;
  name: string;
  source: string;
}

@Service()
export class AssetRepository {
  private get repository(): Repository<Asset> {
    return coreDataSource.getRepository(Asset);
  }

  async upsertAssets(assets: AssetUpsertPayload[]): Promise<AssetSyncResult> {
    const source = assets[0]?.source;

    if (!source || assets.length === 0) {
      const totalStored = await this.repository.count();
      return {
        fetched: 0,
        inserted: 0,
        updated: 0,
        totalStored,
        changes: [],
      };
    }

    const existingAssets = await this.repository.find({
      select: {
        externalId: true,
      },
      where: {
        source,
      },
    });

    const existingIds = new Set(existingAssets.map((asset) => asset.externalId));
    const inserted = assets.filter((asset) => !existingIds.has(asset.externalId)).length;

    await this.repository.upsert(assets, {
      conflictPaths: ['source', 'externalId'],
    });

    const persistedAssets = await this.repository.find({
      select: {
        id: true,
        symbol: true,
        externalId: true,
      },
      where: {
        source,
        externalId: In(assets.map((item) => item.externalId)),
      },
    });
    const persistedByExternalId = new Map(
      persistedAssets.map((asset) => [String(asset.externalId || ''), asset])
    );
    const changes = assets
      .map((asset) => {
        const persisted = persistedByExternalId.get(String(asset.externalId || ''));
        if (!persisted) {
          return null;
        }
        return {
          actionType: existingIds.has(asset.externalId) ? 'updated' : 'inserted',
          symbol: String(asset.symbol || ''),
          externalId: String(asset.externalId || ''),
          assetId: String(persisted.id || ''),
        } as const;
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item && item.assetId));

    const totalStored = await this.repository.count({
      where: {
        source,
      },
    });

    return {
      fetched: assets.length,
      inserted,
      updated: assets.length - inserted,
      totalStored,
      changes,
    };
  }

  async listAssetBases(search?: string): Promise<AssetListRecord[]> {
    const where = search
      ? [{ name: Like(`%${search}%`) }, { symbol: Like(`%${search.toUpperCase()}%`) }]
      : undefined;

    return this.repository.find({
      select: {
        id: true,
        symbol: true,
        name: true,
        source: true,
      },
      where,
      order: {
        name: 'ASC',
      },
    }) as Promise<AssetListRecord[]>;
  }

  async listAssets(query: AssetListQuery): Promise<{ data: Asset[]; total: number }> {
    const where = query.search
      ? [{ name: Like(`%${query.search}%`) }, { symbol: Like(`%${query.search.toUpperCase()}%`) }]
      : undefined;

    const [data, total] = await this.repository.findAndCount({
      where,
      order: {
        name: 'ASC',
      },
      skip: query.offset,
      take: query.limit,
    });

    return {
      data,
      total,
    };
  }

  async getAssetBySymbol(symbol: string): Promise<Asset | null> {
    const normalized = String(symbol || '').trim().toUpperCase();
    if (!normalized) {
      return null;
    }

    return this.repository.findOne({
      where: { symbol: normalized },
      order: {
        updatedAt: 'DESC',
      },
    });
  }

  async listAssetsBySymbols(symbols: string[]): Promise<Asset[]> {
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

    return this.repository.find({
      where: { symbol: In(normalized) },
      order: {
        updatedAt: 'DESC',
      },
    });
  }

  async listAllSymbols(source?: string): Promise<AssetSymbolRecord[]> {
    const assets = await this.repository.find({
      select: {
        id: true,
        symbol: true,
      },
      ...(source
        ? {
            where: {
              source,
            },
          }
        : {}),
      order: {
        symbol: 'ASC',
      },
    });

    return Array.from(
      new Map(
        assets.map((asset) => [asset.symbol, { id: asset.id, symbol: asset.symbol }])
      ).values()
    );
  }
}
