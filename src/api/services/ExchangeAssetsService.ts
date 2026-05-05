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
      const deltaCandidateSymbols = Array.from(
        new Set(
          assets.flatMap((item) => this.buildDeltaEquivalentSymbols(item.symbol))
        )
      );
      const deltaAssets = await this.exchangeAssetRepository.listVisibleAssetsBySourceAndSymbolsForUser(
        userId,
        'delta_exchange',
        deltaCandidateSymbols
      );
      const deltaBySymbol = new Map(
        deltaAssets.map((item) => [String(item.symbol || '').toUpperCase(), item])
      );

      assets = assets.map((item) => {
        const deltaMatch = this.resolveDeltaEquivalentAsset(item.symbol, deltaBySymbol);
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
    const deltaProviderIds = await this.resolveProviderIds('delta_exchange');
    const deltaMatchedAssets = deltaMatches.map((item) => ({
      source: 'delta_exchange',
      brokerId: deltaProviderIds.brokerId,
      externalId: item.externalId,
      assetId: item.assetId,
      name: item.name,
      symbol: String(item.symbol || '').trim().toUpperCase(),
    }));
    const deltaResult = await this.exchangeAssetRepository.upsertSystemAssets(
      'delta_exchange',
      deltaMatchedAssets,
      validCandidates.length
    );
    const deltaMissingSymbols = this.buildDeltaMissingSymbolReport(validCandidates, deltaMatches);

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
      deltaMappedSymbols: deltaResult.matched,
      deltaInsertedAssets: deltaResult.inserted,
      deltaUpdatedAssets: deltaResult.updated,
      deltaSkippedSymbols: deltaResult.skipped,
      deltaTotalStoredAssets: deltaResult.totalStored,
      deltaMissingSymbols,
    });
  }

  private buildDeltaMissingSymbolReport(
    candidates: Array<{ symbol: string }>,
    deltaMatches: Array<{ symbol: string }>
  ): Array<{ symbol: string; candidateSymbols: string[]; reason: string }> {
    const matchedSymbols = new Set(
      deltaMatches
        .flatMap((item) => this.buildDeltaEquivalentSymbols(item.symbol))
        .map((item) => item.toUpperCase())
    );

    return candidates
      .map((item) => String(item.symbol || '').trim().toUpperCase())
      .filter(Boolean)
      .filter((symbol) => !this.buildDeltaEquivalentSymbols(symbol).some((candidate) => matchedSymbols.has(candidate)))
      .map((symbol) => {
        const candidateSymbols = this.buildDeltaEquivalentSymbols(symbol);
        return {
          symbol,
          candidateSymbols,
          reason: `No live operational Delta perpetual product matched ${candidateSymbols.join(', ')}`,
        };
      });
  }

  private resolveDeltaEquivalentAsset(
    symbol: string,
    deltaBySymbol: Map<string, StoredExchangeAsset>
  ): StoredExchangeAsset | undefined {
    for (const candidate of this.buildDeltaEquivalentSymbols(symbol)) {
      const match = deltaBySymbol.get(candidate);
      if (match) {
        return match;
      }
    }
    return undefined;
  }

  private buildDeltaEquivalentSymbols(symbol: string): string[] {
    const normalized = String(symbol || '')
      .trim()
      .toUpperCase()
      .replace(/[\s_-]/g, '');
    if (!normalized) {
      return [];
    }

    const candidates = new Set<string>([normalized]);
    if (normalized.endsWith('USDT')) {
      const base = normalized.slice(0, -4);
      candidates.add(`${base}USD`);
      candidates.add(`${base}USDC`);
    } else if (normalized.endsWith('USDC')) {
      const base = normalized.slice(0, -4);
      candidates.add(`${base}USD`);
      candidates.add(`${base}USDT`);
    } else if (normalized.endsWith('USD')) {
      const base = normalized.slice(0, -3);
      candidates.add(`${base}USDT`);
      candidates.add(`${base}USDC`);
    }

    return Array.from(candidates);
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
