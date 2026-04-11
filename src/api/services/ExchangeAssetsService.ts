import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import {
  ExchangeAssetListResponse,
  ExchangeAssetSyncSummary,
  StoredExchangeAsset,
} from '../contracts/ExchangeAsset';
import { BadRequestAppError, NotFoundAppError } from '../errors/AppError';
import { successResponse } from '../utils/response';
import { AssetRepository } from '../../database';
import { ExchangeAssetRepository } from '../../database';
import { ExchangeRepository } from '../../database';
import { BrokerDefinitionService } from '../../brokers';
import { BrokerExchangeAssetSyncService } from '../../brokers/capabilities/sync';
import { MudrexService } from '../../brokers/providers/mudrex/MudrexService';
import { OperationalEventService } from './OperationalEventService';

interface StoredExchangeAssetsQuery {
  limit?: string;
  offset?: string;
  search?: string;
  source?: string;
}

// Phase 4 stable model, now locked as the Phase 5 steady-state contract:
// broker_assets writes target the global catalog, and user-visible reads are
// derived from user-owned routes.
@Service()
export class ExchangeAssetsService {
  @Inject(() => AssetRepository)
  private assetRepository!: AssetRepository;

  @Inject(() => ExchangeAssetRepository)
  private exchangeAssetRepository!: ExchangeAssetRepository;

  @Inject(() => ExchangeRepository)
  private exchangeRepository!: ExchangeRepository;

  @Inject(() => BrokerDefinitionService)
  private brokerDefinitionService!: BrokerDefinitionService;

  @Inject(() => BrokerExchangeAssetSyncService)
  private brokerExchangeAssetSyncService!: BrokerExchangeAssetSyncService;

  @Inject(() => MudrexService)
  private mudrexService!: MudrexService;

  @Inject(() => OperationalEventService)
  private operationalEventService!: OperationalEventService;

  async syncExchangeAssets(userId: string, source = 'mudrex'): Promise<ApiSuccessResponse<ExchangeAssetSyncSummary>> {
    try {
      if (source === 'mudrex') {
        const response = await this.syncMudrexExchangeAssets(userId);
        await this.operationalEventService.logActivity(userId, {
          type: 'Exchange assets',
          title: 'Exchange assets sync completed: mudrex',
          status: 'Success',
          route: 'Scheduler',
          stream: 'Sync',
          related: 'mudrex',
          description: `Inserted ${response.data.insertedAssets}, updated ${response.data.updatedAssets}`,
        });
        return response;
      }

      const assets = await this.assetRepository.listAllSymbols('binance-futures');
      const providerIds = await this.resolveProviderIds(source);
      const matchedAssets = (
        await this.brokerExchangeAssetSyncService.sync(
          source,
          assets.map((asset) => ({ id: asset.id, symbol: asset.symbol }))
        )
      ).map((item) => ({
        source,
        brokerId: providerIds.brokerId,
        externalId: item.externalId,
        assetId: item.assetId,
        name: item.name,
        symbol: item.symbol,
      }));

      const result = await this.exchangeAssetRepository.replaceSystemAssets(
        source,
        matchedAssets,
        assets.length
      );
      await this.operationalEventService.logActivity(userId, {
        type: 'Exchange assets',
        title: `Exchange assets sync completed: ${source}`,
        status: 'Success',
        route: 'Scheduler',
        stream: 'Sync',
        related: source,
        description: `Inserted ${result.inserted}, updated ${result.updated}`,
      });

      return successResponse({
        source,
        attemptedSymbols: result.attempted,
        matchedAssets: result.matched,
        insertedAssets: result.inserted,
        updatedAssets: result.updated,
        skippedSymbols: result.skipped,
        totalStoredAssets: result.totalStored,
      });
    } catch (error) {
      await this.operationalEventService.logActivity(userId, {
        type: 'Exchange assets',
        title: `Exchange assets sync failed: ${source}`,
        status: 'Failed',
        route: 'Scheduler',
        stream: 'Sync',
        related: source,
        description: error instanceof Error ? error.message : String(error),
      });
      await this.operationalEventService.emitFailureAlert(userId, {
        channel: 'Scheduler',
        source: source || 'broker_assets',
        message: `Exchange assets sync failed (${source}): ${
          error instanceof Error ? error.message : String(error)
        }`,
        route: 'Schedulers',
      });
      throw error;
    }
  }

  async getStoredExchangeAssets(
    userId: string,
    query: StoredExchangeAssetsQuery
  ): Promise<ApiSuccessResponse<ExchangeAssetListResponse>> {
    const limit = query.limit !== undefined ? Number(query.limit) : 100;
    const offset = query.offset !== undefined ? Number(query.offset) : 0;

    if (!Number.isInteger(limit) || limit <= 0 || limit > 1000) {
      throw new BadRequestAppError('limit must be an integer between 1 and 1000');
    }

    if (!Number.isInteger(offset) || offset < 0) {
      throw new BadRequestAppError('offset must be a non-negative integer');
    }

    const result = await this.exchangeAssetRepository.listVisibleAssetsForUser(userId, {
      limit,
      offset,
      search: query.search?.trim() || undefined,
      source: query.source?.trim() || undefined,
    });

    const resolvedSource = query.source?.trim() || undefined;
    let assets = result.data as StoredExchangeAsset[];

    if (resolvedSource === 'mudrex' && assets.length > 0) {
      const deltaAssets = await this.exchangeAssetRepository.listVisibleAssetsBySourceAndSymbolsForUser(
        userId,
        'delta_exchange',
        assets.map((item) => item.symbol)
      );
      const deltaBySymbol = new Map(
        deltaAssets.map((item) => [String(item.symbol || '').toUpperCase(), item])
      );

      assets = assets.map((item) => {
        const deltaMatch = deltaBySymbol.get(String(item.symbol || '').toUpperCase());
        return {
          ...item,
          deltaExternalId: deltaMatch?.externalId || null,
          deltaSymbol: deltaMatch?.symbol || null,
          isDeltaMapped: Boolean(deltaMatch),
        };
      });
    }

    return successResponse({
      assets,
      total: result.total,
      limit,
      offset,
      source: resolvedSource,
    });
  }

  private async syncMudrexExchangeAssets(
    userId: string
  ): Promise<ApiSuccessResponse<ExchangeAssetSyncSummary>> {
    const source = 'mudrex';
    const providerIds = await this.resolveProviderIds(source);
    const mudrexAssets = await this.mudrexService.fetchAllRemoteFuturesForUserOrThrow(
      200,
      userId
    );
    const coreAssets = await this.assetRepository.listAllSymbols('binance-futures');

    const coreAssetIdBySymbol = new Map(
      coreAssets.map((asset) => [String(asset.symbol || '').toUpperCase(), asset.id])
    );

    const candidates = mudrexAssets.map((asset) => {
      const normalizedSymbol = String(asset.symbol || '').trim().toUpperCase();
      const resolvedAssetId =
        coreAssetIdBySymbol.get(normalizedSymbol) ||
        this.buildDeterministicAssetId(normalizedSymbol || asset.id || asset.name);

      return {
        id: resolvedAssetId,
        symbol: String(asset.symbol || '').trim(),
        externalId: String(asset.id || '').trim(),
        name: String(asset.name || asset.symbol || asset.id || '').trim(),
      };
    });

    const validCandidates = candidates.filter((item) => item.symbol && item.externalId && item.name);
    const deltaMatches = await this.brokerExchangeAssetSyncService.sync(
      'delta_exchange',
      validCandidates.map((item) => ({ id: item.id, symbol: item.symbol }))
    );
    const deltaMappedSymbols = new Set(
      deltaMatches.map((item) => String(item.symbol || '').toUpperCase())
    ).size;

    const matchedAssets = validCandidates.map((item) => ({
      source,
      brokerId: providerIds.brokerId,
      externalId: item.externalId,
      assetId: item.id,
      name: item.name,
      symbol: item.symbol,
    }));

    const result = await this.exchangeAssetRepository.replaceSystemAssets(
      source,
      matchedAssets,
      mudrexAssets.length
    );

    return successResponse({
      source,
      attemptedSymbols: result.attempted,
      matchedAssets: result.matched,
      insertedAssets: result.inserted,
      updatedAssets: result.updated,
      skippedSymbols: result.skipped,
      totalStoredAssets: result.totalStored,
      deltaMappedSymbols,
    });
  }

  private buildDeterministicAssetId(key: string): string {
    const normalized = String(key || 'asset').trim().toUpperCase();
    const padded = (Buffer.from(normalized).toString('hex') + '0'.repeat(32)).slice(0, 32);
    return `${padded.slice(0, 8)}-${padded.slice(8, 12)}-${padded.slice(12, 16)}-${padded.slice(16, 20)}-${padded.slice(20, 32)}`;
  }

  private async resolveProviderIds(
    source: string
  ): Promise<{ brokerId: string | null }> {
    const definition = await this.brokerDefinitionService.getRequiredDefinition(source);
    const linkedExchangeKey = definition.linkedExchangeKey?.trim();
    if (linkedExchangeKey) {
      const exchange = await this.exchangeRepository.getExchangeByKey(linkedExchangeKey);
      if (!exchange) {
        throw new NotFoundAppError(`Exchange master record not found for source: ${linkedExchangeKey}`);
      }
      return { brokerId: definition.brokerId ?? null };
    }

    return { brokerId: definition.brokerId ?? definition.id };
  }
}
