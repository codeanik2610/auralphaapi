import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import { ReferenceCatalogItem, ReferenceCatalogResponse } from '../contracts/Asset';
import { MarketPriceResult } from '../contracts/MarketPrice';
import { MudrexAsset, MudrexAssetDetail, MudrexLeverage } from '../contracts/Mudrex';
import { BadRequestAppError, NotFoundAppError } from '../errors/AppError';
import { successResponse } from '../utils/response';
import { BrokerDefinitionService } from '../../brokers';
import { LeverageService } from '../../brokers';
import { MudrexService } from '../../brokers';
import { AssetPriceRepository, Exchange, ExchangeRepository } from '../../database';

@Service()
export class BrokerReferenceDataService {
  @Inject(() => BrokerDefinitionService)
  private brokerDefinitionService!: BrokerDefinitionService;

  @Inject(() => MudrexService)
  private mudrexService!: MudrexService;

  @Inject(() => LeverageService)
  private leverageService!: LeverageService;

  @Inject(() => AssetPriceRepository)
  private assetPriceRepository!: AssetPriceRepository;

  @Inject(() => ExchangeRepository)
  private exchangeRepository!: ExchangeRepository;

  async getFuturesAssets(
    brokerKey = 'mudrex',
    query: { sort?: string; order?: string; offset?: string; limit?: string }
  ): Promise<ApiSuccessResponse<MudrexAsset[]>> {
    const definition = await this.brokerDefinitionService.getRequiredDefinition(brokerKey);

    if (definition.brokerKey !== 'mudrex') {
      throw new BadRequestAppError(`Futures assets are not configured for broker: ${definition.brokerKey}`);
    }

    return this.mudrexService.getRemoteFutures(query);
  }

  async getFuturesAsset(
    brokerKey = 'mudrex',
    assetId: string
  ): Promise<ApiSuccessResponse<MudrexAssetDetail>> {
    const definition = await this.brokerDefinitionService.getRequiredDefinition(brokerKey);

    if (definition.brokerKey !== 'mudrex') {
      throw new BadRequestAppError(`Futures asset lookup is not configured for broker: ${definition.brokerKey}`);
    }

    return this.mudrexService.getRemoteFuturesAsset(assetId);
  }

  async getFuturesAssetBySymbol(
    symbol: string
  ): Promise<ApiSuccessResponse<MarketPriceResult>> {
    const row = await this.assetPriceRepository.getBySymbol(symbol, {
      sources: ['mudrex', 'delta_exchange'],
    });

    if (!row) {
      throw new NotFoundAppError(`Market price not found for symbol: ${symbol}`);
    }

    return successResponse<MarketPriceResult>({
      symbol: row.symbol,
      sourceSymbol: row.sourceSymbol,
      price: Number(row.price),
      source: row.source,
      retrievedAt: row.retrievedAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      exchangeAssetId: row.brokerAssetId,
      brokerAssetId: row.brokerAssetId,
    });
  }

  async getFuturesAssetDetailBySymbol(
    brokerKey = 'mudrex',
    symbol: string
  ): Promise<ApiSuccessResponse<MudrexAssetDetail>> {
    const definition = await this.brokerDefinitionService.getRequiredDefinition(brokerKey);

    if (definition.brokerKey !== 'mudrex') {
      throw new BadRequestAppError(`Futures asset detail lookup is not configured for broker: ${definition.brokerKey}`);
    }

    return this.mudrexService.getRemoteFuturesAssetBySymbol(symbol);
  }

  async getLeverageByAssetId(
    brokerKey = 'mudrex',
    assetId: string
  ): Promise<ApiSuccessResponse<MudrexLeverage>> {
    const definition = await this.brokerDefinitionService.getRequiredDefinition(brokerKey);

    if (definition.brokerKey !== 'mudrex') {
      throw new BadRequestAppError(`Leverage lookup is not configured for broker: ${definition.brokerKey}`);
    }

    return this.leverageService.getLeverageByAssetId(assetId);
  }

  async getLeverageBySymbol(
    brokerKey = 'mudrex',
    symbol: string
  ): Promise<ApiSuccessResponse<MudrexLeverage>> {
    const definition = await this.brokerDefinitionService.getRequiredDefinition(brokerKey);

    if (definition.brokerKey !== 'mudrex') {
      throw new BadRequestAppError(`Leverage lookup is not configured for broker: ${definition.brokerKey}`);
    }

    return this.leverageService.getLeverageBySymbol(symbol);
  }

  async getReferenceCatalog(userId: string): Promise<ApiSuccessResponse<ReferenceCatalogResponse>> {
    void userId;
    const [definitions, exchanges] = await Promise.all([
      this.brokerDefinitionService.listPersistedDefinitions({ includeInactive: false }),
      this.exchangeRepository.listActiveExchanges(),
    ]);
    const providerItems = definitions
      .filter((definition) =>
        definition.capabilities.some((capability) => ['assets', 'market', 'leverage'].includes(capability))
      )
      .map((definition): ReferenceCatalogItem => ({
        id: definition.id,
        brokerKey: definition.brokerKey,
        entityType: 'provider',
        name: definition.name,
        category: definition.category,
        providerType: definition.providerType,
        capabilities: definition.capabilities,
      }));
    const exchangeItems = exchanges
      .map((exchange) => this.mapExchangeReferenceCatalogItem(exchange))
      .filter((item): item is ReferenceCatalogItem => Boolean(item));
    const items = [...providerItems, ...exchangeItems];

    return successResponse({
      items,
      providerItems,
      exchangeItems,
      total: items.length,
      providersTotal: providerItems.length,
      exchangesTotal: exchangeItems.length,
    });
  }

  private mapExchangeReferenceCatalogItem(exchange: Exchange): ReferenceCatalogItem | null {
    const exchangeKey = String(exchange.exchangeKey || '').trim().toLowerCase();

    if (exchangeKey !== 'binance') {
      return null;
    }

    return {
      id: exchange.id,
      brokerKey: exchangeKey,
      exchangeKey,
      entityType: 'exchange',
      name: `${String(exchange.name || 'Binance').trim() || 'Binance'} market data`,
      category: 'feed',
      providerType: 'feed',
      capabilities: ['diagnostics', 'market'],
    };
  }
}
