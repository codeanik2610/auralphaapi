import { Service } from 'typedi';
import { Repository } from 'typeorm';
import { coreDataSource } from '../data-source';
import { AssetPrice } from '../entities/AssetPrice';

export interface AssetPriceUpsertEntry {
  brokerAssetId: string;
  symbol: string;
  sourceSymbol?: string | null;
  price: string;
  source: string;
  retrievedAt: Date;
  updatedAt?: Date;
}

export interface AssetPriceLookupOptions {
  sources?: string[];
  includeSourceSymbol?: boolean;
}

@Service()
export class AssetPriceRepository {
  private get repository(): Repository<AssetPrice> {
    return coreDataSource.getRepository(AssetPrice);
  }

  async getLatestRetrievedAt(): Promise<Date | null> {
    const row = await this.repository
      .createQueryBuilder('price')
      .select('MAX(price.retrievedAt)', 'latest')
      .getRawOne<{ latest?: string | Date | null }>();

    const latest = row?.latest;
    if (!latest) {
      return null;
    }

    const parsed = latest instanceof Date ? latest : new Date(String(latest));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  async getByBrokerAssetId(brokerAssetId: string): Promise<AssetPrice | null> {
    const normalized = String(brokerAssetId || '').trim();
    if (!normalized) {
      return null;
    }
    return this.repository.findOneBy({ brokerAssetId: normalized });
  }

  async getBySymbol(
    symbol: string,
    options: AssetPriceLookupOptions = {}
  ): Promise<AssetPrice | null> {
    const rows = await this.getBySymbols([symbol], options);
    return rows[0] || null;
  }

  async getBySymbols(
    symbols: string[],
    options: AssetPriceLookupOptions = {}
  ): Promise<AssetPrice[]> {
    const normalizedSymbols = Array.from(
      new Set(
        (symbols || [])
          .map((value) => String(value || '').trim().toUpperCase())
          .filter(Boolean)
      )
    );
    if (!normalizedSymbols.length) {
      return [];
    }

    const normalizedSources = Array.isArray(options.sources)
      ? Array.from(
          new Set(
            options.sources
              .map((value) => String(value || '').trim().toLowerCase())
              .filter(Boolean)
          )
        )
      : [];
    const includeSourceSymbol = options.includeSourceSymbol !== false;
    const matchingRows = await this.listCandidateRows(
      normalizedSymbols,
      normalizedSources,
      includeSourceSymbol
    );

    return normalizedSymbols
      .map((requestedSymbol) =>
        this.pickPreferredRow(requestedSymbol, matchingRows, normalizedSources, includeSourceSymbol)
      )
      .filter((row): row is AssetPrice => Boolean(row));
  }

  async upsertMany(entries: AssetPriceUpsertEntry[]): Promise<void> {
    if (!entries.length) {
      return;
    }

    const batchSize = 100;
    for (let index = 0; index < entries.length; index += batchSize) {
      const batch = entries.slice(index, index + batchSize);
      const placeholders = batch.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(', ');
      const params = batch.flatMap((entry) => [
        entry.brokerAssetId,
        entry.symbol,
        entry.sourceSymbol ?? null,
        entry.price,
        entry.source,
        entry.retrievedAt,
        entry.updatedAt ?? entry.retrievedAt,
      ]);

      await coreDataSource.query(
        `INSERT INTO asset_price
           (broker_asset_id, symbol, source_symbol, price, source, retrieved_at, updated_at)
         VALUES ${placeholders}
         ON DUPLICATE KEY UPDATE
           symbol = VALUES(symbol),
           source_symbol = VALUES(source_symbol),
           price = VALUES(price),
           source = VALUES(source),
           retrieved_at = VALUES(retrieved_at),
           updated_at = VALUES(updated_at)`,
        params
      );
    }
  }

  private async listCandidateRows(
    normalizedSymbols: string[],
    normalizedSources: string[],
    includeSourceSymbol: boolean
  ): Promise<AssetPrice[]> {
    const symbolPlaceholders = normalizedSymbols.map(() => '?').join(', ');
    const queryParts = [
      `SELECT
         broker_asset_id AS brokerAssetId,
         symbol,
         source_symbol AS sourceSymbol,
         price,
         source,
         retrieved_at AS retrievedAt,
         updated_at AS updatedAt
       FROM asset_price
       WHERE (UPPER(symbol) IN (${symbolPlaceholders})`,
    ];
    const params: unknown[] = [...normalizedSymbols];

    if (includeSourceSymbol) {
      queryParts.push(` OR UPPER(COALESCE(source_symbol, '')) IN (${symbolPlaceholders})`);
      params.push(...normalizedSymbols);
    }
    queryParts.push(')');

    if (normalizedSources.length) {
      const sourcePlaceholders = normalizedSources.map(() => '?').join(', ');
      queryParts.push(` AND LOWER(source) IN (${sourcePlaceholders})`);
      params.push(...normalizedSources);
    }

    queryParts.push(' ORDER BY updated_at DESC, retrieved_at DESC');

    const rows = (await coreDataSource.query(queryParts.join(''), params)) as AssetPrice[];
    return Array.isArray(rows) ? rows : [];
  }

  private pickPreferredRow(
    requestedSymbol: string,
    rows: AssetPrice[],
    normalizedSources: string[],
    includeSourceSymbol: boolean
  ): AssetPrice | null {
    const candidates = rows.filter((row) => this.matchesRequestedSymbol(row, requestedSymbol, includeSourceSymbol));
    if (!candidates.length) {
      return null;
    }

    const ranked = [...candidates].sort((left, right) =>
      this.compareRows(left, right, requestedSymbol, normalizedSources)
    );
    return ranked[0] || null;
  }

  private matchesRequestedSymbol(
    row: AssetPrice,
    requestedSymbol: string,
    includeSourceSymbol: boolean
  ): boolean {
    const normalizedSymbol = String(row.symbol || '').trim().toUpperCase();
    const normalizedSourceSymbol = String(row.sourceSymbol || '').trim().toUpperCase();
    if (normalizedSymbol === requestedSymbol) {
      return true;
    }
    if (includeSourceSymbol && normalizedSourceSymbol === requestedSymbol) {
      return true;
    }
    return false;
  }

  private compareRows(
    left: AssetPrice,
    right: AssetPrice,
    requestedSymbol: string,
    normalizedSources: string[]
  ): number {
    const sourceDiff =
      this.getSourceRank(left, normalizedSources) - this.getSourceRank(right, normalizedSources);
    if (sourceDiff !== 0) {
      return sourceDiff;
    }

    const exactSymbolDiff =
      this.getExactSymbolRank(left, requestedSymbol) - this.getExactSymbolRank(right, requestedSymbol);
    if (exactSymbolDiff !== 0) {
      return exactSymbolDiff;
    }

    const updatedDiff = this.readDateMs(right.updatedAt) - this.readDateMs(left.updatedAt);
    if (updatedDiff !== 0) {
      return updatedDiff;
    }

    return this.readDateMs(right.retrievedAt) - this.readDateMs(left.retrievedAt);
  }

  private getSourceRank(row: AssetPrice, normalizedSources: string[]): number {
    if (!normalizedSources.length) {
      return 0;
    }
    const source = String(row.source || '').trim().toLowerCase();
    const index = normalizedSources.indexOf(source);
    return index === -1 ? normalizedSources.length + 1 : index;
  }

  private getExactSymbolRank(row: AssetPrice, requestedSymbol: string): number {
    const normalizedSymbol = String(row.symbol || '').trim().toUpperCase();
    return normalizedSymbol === requestedSymbol ? 0 : 1;
  }

  private readDateMs(value: unknown): number {
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? 0 : value.getTime();
    }
    const parsed = new Date(String(value || ''));
    return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
  }
}
