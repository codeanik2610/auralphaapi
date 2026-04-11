import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import { successResponse } from '../utils/response';
import { AssetRepository } from '../../database/repositories/AssetRepository';
import { MarketSymbolSnapshotRepository } from '../../database/repositories/MarketSymbolSnapshotRepository';
import { MarketMetric, MarketMetricsService } from './MarketMetricsService';
import { MarketSymbolSnapshot } from '../../database/entities/MarketSymbolSnapshot';

interface RefreshMarketSnapshotsOptions {
  symbols?: string[];
}

interface SnapshotAssetSeed {
  id: string | null;
  symbol: string;
  name: string | null;
  source: string | null;
}

export interface MarketSnapshotRefreshResult {
  message: string;
  processedSymbols: number;
  refreshedSnapshots: number;
  insertedSnapshots: number;
  updatedSnapshots: number;
  skippedSymbols: number;
  snapshotAt: string;
}

const DEFAULT_ASSET_SCAN_LIMIT = 5000;

const toNullableNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const toNullableDecimal = (value: number | null): string | null => {
  return value === null || !Number.isFinite(value) ? null : String(value);
};

const getLiquidityTier = (volume24h: number | null): string | null => {
  if (volume24h === null || !Number.isFinite(volume24h)) {
    return null;
  }
  if (volume24h >= 1_000_000_000) {
    return 'Deep';
  }
  if (volume24h >= 100_000_000) {
    return 'Core';
  }
  if (volume24h >= 10_000_000) {
    return 'Active';
  }
  return 'Thin';
};

@Service()
export class MarketSnapshotRefreshService {
  @Inject(() => AssetRepository)
  private assetRepository!: AssetRepository;

  @Inject(() => MarketMetricsService)
  private marketMetricsService!: MarketMetricsService;

  @Inject(() => MarketSymbolSnapshotRepository)
  private marketSymbolSnapshotRepository!: MarketSymbolSnapshotRepository;

  async refreshSnapshots(
    options: RefreshMarketSnapshotsOptions = {}
  ): Promise<ApiSuccessResponse<MarketSnapshotRefreshResult>> {
    const assets = await this.loadAssets(options.symbols);
    const snapshotMoment = new Date();

    if (!assets.length) {
      return successResponse({
        message: 'No market symbols were eligible for snapshot refresh',
        processedSymbols: 0,
        refreshedSnapshots: 0,
        insertedSnapshots: 0,
        updatedSnapshots: 0,
        skippedSymbols: 0,
        snapshotAt: snapshotMoment.toISOString(),
      });
    }

    const symbols = assets.map((asset) => asset.symbol);
    const [metricsBySymbol, existingSnapshots] = await Promise.all([
      this.marketMetricsService.getMetricsForSymbols(symbols),
      this.marketSymbolSnapshotRepository.getBySymbols(symbols),
    ]);

    const snapshotsBySymbol = new Map(
      existingSnapshots.map((snapshot) => [snapshot.symbol.toUpperCase(), snapshot])
    );

    const payload = [] as Parameters<MarketSymbolSnapshotRepository['upsertSnapshots']>[0];
    let insertedSnapshots = 0;
    let updatedSnapshots = 0;
    let skippedSymbols = 0;

    for (const asset of assets) {
      const symbol = asset.symbol;
      const metric = metricsBySymbol.get(symbol);
      const existingSnapshot = snapshotsBySymbol.get(symbol) || null;
      const nextSnapshot = this.buildSnapshotPayload(asset, metric, existingSnapshot, snapshotMoment);

      if (!nextSnapshot) {
        skippedSymbols += 1;
        continue;
      }

      payload.push(nextSnapshot);
      if (existingSnapshot) {
        updatedSnapshots += 1;
      } else {
        insertedSnapshots += 1;
      }
    }

    if (payload.length > 0) {
      await this.marketSymbolSnapshotRepository.upsertSnapshots(payload);
    }

    return successResponse({
      message: 'Market snapshots refreshed',
      processedSymbols: assets.length,
      refreshedSnapshots: payload.length,
      insertedSnapshots,
      updatedSnapshots,
      skippedSymbols,
      snapshotAt: snapshotMoment.toISOString(),
    });
  }

  private async loadAssets(symbols?: string[]): Promise<SnapshotAssetSeed[]> {
    const normalizedSymbols = Array.from(
      new Set(
        (symbols || [])
          .map((item) => String(item || '').trim().toUpperCase())
          .filter(Boolean)
      )
    );

    const rows = normalizedSymbols.length
      ? await this.assetRepository.listAssetsBySymbols(normalizedSymbols)
      : (await this.assetRepository.listAssets({
          limit: DEFAULT_ASSET_SCAN_LIMIT,
          offset: 0,
        })).data;

    const deduped = new Map<string, SnapshotAssetSeed>();
    for (const row of rows) {
      const symbol = String(row.symbol || '').trim().toUpperCase();
      if (!symbol || deduped.has(symbol)) {
        continue;
      }
      deduped.set(symbol, {
        id: row.id || null,
        symbol,
        name: row.name || null,
        source: row.source || null,
      });
    }

    return Array.from(deduped.values());
  }

  private buildSnapshotPayload(
    asset: SnapshotAssetSeed,
    metric: MarketMetric | undefined,
    snapshot: MarketSymbolSnapshot | null,
    snapshotMoment: Date
  ): Parameters<MarketSymbolSnapshotRepository['upsertSnapshots']>[0][number] | null {
    const lastPrice = metric?.lastPrice ?? toNullableNumber(snapshot?.lastPrice);
    const change24h = metric?.changePerc ?? snapshot?.change24h ?? null;
    const volume24h = metric?.volume24h ?? snapshot?.volume24h ?? null;
    const high24h = metric?.high24h ?? toNullableNumber(snapshot?.high24h);
    const low24h = metric?.low24h ?? toNullableNumber(snapshot?.low24h);
    const priceSource = metric?.priceSource ?? snapshot?.priceSource ?? null;
    const snapshotAt = metric?.snapshotAt ?? snapshot?.snapshotAt ?? snapshotMoment;
    const liquidityTier = getLiquidityTier(volume24h) ?? snapshot?.liquidityTier ?? null;

    const hasMetricData = [lastPrice, change24h, volume24h, high24h, low24h].some(
      (value) => value !== null && value !== undefined
    );

    if (!hasMetricData && !snapshot) {
      return null;
    }

    return {
      symbol: asset.symbol,
      assetId: asset.id || snapshot?.assetId || null,
      name: asset.name || snapshot?.name || asset.symbol,
      source: asset.source || snapshot?.source || null,
      lastPrice: toNullableDecimal(lastPrice),
      change24h,
      volume24h,
      high24h: toNullableDecimal(high24h),
      low24h: toNullableDecimal(low24h),
      liquidityTier,
      priceSource,
      snapshotAt,
    };
  }
}
