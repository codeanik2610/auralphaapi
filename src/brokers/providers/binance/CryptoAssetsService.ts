import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../../../api';
import { AssetListResponse, AssetSyncSummary, CryptoAsset } from '../../../api';
import { successResponse } from '../../../api';
import { BadRequestAppError } from '../../../api';
import { AssetRepository } from '../../../database';
import { BinanceHttpClient } from './BinanceHttpClient';

interface StoredAssetsQuery {
  limit?: string;
  offset?: string;
  search?: string;
}

interface BinanceExchangeInfoPayload {
  symbols: BinanceExchangeInfoSymbol[];
}

interface BinanceExchangeInfoSymbol {
  symbol: string;
  status: string;
  baseAsset: string;
}

@Service()
export class CryptoAssetsService {
  @Inject(() => BinanceHttpClient)
  private binanceHttpClient!: BinanceHttpClient;

  @Inject(() => AssetRepository)
  private assetRepository!: AssetRepository;

  async syncAssets(): Promise<ApiSuccessResponse<AssetSyncSummary>> {
    const onlineAssets = await this.getOnlineAssets();
    const result = await this.assetRepository.upsertAssets(
      onlineAssets.map((asset) => ({
        source: 'binance-futures',
        externalId: asset.symbol,
        symbol: asset.symbol,
        name: asset.name,
        status: asset.status,
      }))
    );

    return successResponse({
      source: 'binance-futures',
      fetchedAssets: result.fetched,
      insertedAssets: result.inserted,
      updatedAssets: result.updated,
      totalStoredAssets: result.totalStored,
      changes: result.changes,
    });
  }

  async getStoredAssets(query: StoredAssetsQuery): Promise<ApiSuccessResponse<AssetListResponse>> {
    const limit = query.limit !== undefined ? Number(query.limit) : 100;
    const offset = query.offset !== undefined ? Number(query.offset) : 0;

    if (!Number.isInteger(limit) || limit <= 0 || limit > 1000) {
      throw new BadRequestAppError('limit must be an integer between 1 and 1000');
    }

    if (!Number.isInteger(offset) || offset < 0) {
      throw new BadRequestAppError('offset must be a non-negative integer');
    }

    const result = await this.assetRepository.listAssets({
      limit,
      offset,
      search: query.search?.trim() || undefined,
    });

    return successResponse({
      assets: result.data as CryptoAsset[],
      total: result.total,
      limit,
      offset,
    });
  }

  private async getOnlineAssets(): Promise<
    Array<{ symbol: string; name: string; status: string }>
  > {
    const payload =
      await this.binanceHttpClient.get<BinanceExchangeInfoPayload>('/fapi/v1/exchangeInfo');

    if (!payload || !Array.isArray(payload.symbols)) {
      throw new BadRequestAppError('Binance exchange info returned an invalid asset payload');
    }

    return payload.symbols
      .filter((symbol): symbol is BinanceExchangeInfoSymbol => this.isBinanceSymbol(symbol))
      .map((symbol) => ({
        symbol: symbol.symbol,
        name: symbol.baseAsset,
        status: symbol.status.toLowerCase(),
      }));
  }

  private isBinanceSymbol(value: unknown): value is BinanceExchangeInfoSymbol {
    if (!value || typeof value !== 'object') {
      return false;
    }

    const symbol = value as Record<string, unknown>;
    return (
      typeof symbol.symbol === 'string' &&
      typeof symbol.status === 'string' &&
      typeof symbol.baseAsset === 'string'
    );
  }
}
