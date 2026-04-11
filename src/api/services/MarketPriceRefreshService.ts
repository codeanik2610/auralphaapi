import { Inject, Service } from 'typedi';
import {
  AssetPriceRepository,
  BrokerAccountRepository,
  ExchangeAssetRepository,
} from '../../database';
import { MudrexService } from '../../brokers/providers/mudrex/MudrexService';
import { DeltaExchangeHttpClient } from '../../brokers/providers/delta_exchange/DeltaExchangeHttpClient';
import { OperationalEventService } from './OperationalEventService';

interface PriceEntry {
  brokerAssetId: string;
  symbol: string;
  sourceSymbol: string;
  price: string;
  source: string;
}

@Service()
export class MarketPriceRefreshService {
  @Inject(() => BrokerAccountRepository)
  private brokerAccountRepository!: BrokerAccountRepository;

  @Inject(() => AssetPriceRepository)
  private assetPriceRepository!: AssetPriceRepository;

  @Inject(() => ExchangeAssetRepository)
  private exchangeAssetRepository!: ExchangeAssetRepository;

  @Inject(() => MudrexService)
  private mudrexService!: MudrexService;

  @Inject(() => DeltaExchangeHttpClient)
  private deltaExchangeHttpClient!: DeltaExchangeHttpClient;

  @Inject(() => OperationalEventService)
  private operationalEventService!: OperationalEventService;

  async refreshPricesForUser(userId: string): Promise<void> {
    try {
      const latest = await this.assetPriceRepository.getLatestRetrievedAt();
      if (latest) {
        const ageMs = Date.now() - latest.getTime();
        if (ageMs >= 0 && ageMs < 30_000) {
          return;
        }
      }

      const accounts = await this.brokerAccountRepository.getConnectedBrokerAccounts(userId);
      if (!accounts.length) return;

      const brokerKeys = new Set(
        accounts.map((a) => String(a.brokerKey || '').trim().toLowerCase()).filter(Boolean)
      );

      const priceMap = new Map<string, PriceEntry>();

      // Fetch from each connected broker — first to set a symbol wins
      if (brokerKeys.has('mudrex')) {
        await this.fetchMudrexPrices(priceMap);
      }
      if (brokerKeys.has('delta_exchange')) {
        await this.fetchDeltaExchangePrices(priceMap);
      }

      if (priceMap.size === 0) return;

      await this.upsertPrices(Array.from(priceMap.values()));
      await this.operationalEventService.logActivity(userId, {
        type: 'Market',
        title: 'Market prices refreshed',
        status: 'Success',
        route: 'Market',
        stream: 'Prices',
        related: 'asset_price',
        description: `Upserted ${priceMap.size} price(s) from brokers.`,
      });
    } catch (error) {
      await this.operationalEventService.logActivity(userId, {
        type: 'Market',
        title: 'Market prices refresh failed',
        status: 'Failed',
        route: 'Market',
        stream: 'Prices',
        related: 'asset_price',
        description: error instanceof Error ? error.message : String(error),
      });
      await this.operationalEventService.emitFailureAlert(userId, {
        channel: 'Market',
        source: 'market-price-refresh',
        message: error instanceof Error ? error.message : String(error),
        route: 'Market',
        symbol: 'PRICES',
      });
    }
  }

  private async fetchMudrexPrices(priceMap: Map<string, PriceEntry>): Promise<void> {
    try {
      const assets = await this.mudrexService.fetchAllRemoteFuturesOrThrow(500);
      const remoteBySymbol = new Map<
        string,
        { sourceSymbol: string; price: string }
      >();

      for (const asset of assets) {
        const sourceSymbol = String(asset.symbol || '').trim().toUpperCase();
        const price = String(asset.price || '').trim();
        if (!sourceSymbol || !price || Number(price) <= 0) continue;
        remoteBySymbol.set(sourceSymbol, {
          sourceSymbol,
          price,
        });
      }

      if (!remoteBySymbol.size) {
        return;
      }

      const systemAssets = await this.exchangeAssetRepository.listSystemAssetsBySourceAndSymbols(
        'mudrex',
        Array.from(remoteBySymbol.keys())
      );

      for (const asset of systemAssets) {
        const remote = remoteBySymbol.get(String(asset.symbol || '').trim().toUpperCase());
        if (!remote) {
          continue;
        }
        priceMap.set(asset.id, {
          brokerAssetId: asset.id,
          symbol: String(asset.symbol || '').trim().toUpperCase(),
          sourceSymbol: remote.sourceSymbol,
          price: remote.price,
          source: 'mudrex',
        });
      }
    } catch {
      // Skip if Mudrex API fails
    }
  }

  private async fetchDeltaExchangePrices(priceMap: Map<string, PriceEntry>): Promise<void> {
    try {
      const products = await this.deltaExchangeHttpClient.publicGet<
        Array<{
          symbol?: string;
          state?: string;
          contract_type?: string;
          mark_price?: string;
        }>
      >('/v2/products');

      const items = Array.isArray(products) ? products : [];
      const remoteBySymbol = new Map<
        string,
        { sourceSymbol: string; price: string }
      >();

      for (const product of items) {
        const state = String(product.state || '').trim().toLowerCase();
        const contractType = String(product.contract_type || '').trim().toLowerCase();
        if (state !== 'live' || contractType !== 'perpetual_futures') continue;

        const sourceSymbol = String(product.symbol || '').trim().toUpperCase();
        const price = String(product.mark_price || '').trim();
        if (!sourceSymbol || !price || Number(price) <= 0) continue;
        remoteBySymbol.set(sourceSymbol, {
          sourceSymbol,
          price,
        });
      }

      if (!remoteBySymbol.size) {
        return;
      }

      const systemAssets = await this.exchangeAssetRepository.listSystemAssetsBySourceAndSymbols(
        'delta_exchange',
        Array.from(remoteBySymbol.keys())
      );

      for (const asset of systemAssets) {
        const remote = remoteBySymbol.get(String(asset.symbol || '').trim().toUpperCase());
        if (!remote) {
          continue;
        }
        priceMap.set(asset.id, {
          brokerAssetId: asset.id,
          symbol: String(asset.symbol || '').trim().toUpperCase(),
          sourceSymbol: remote.sourceSymbol,
          price: remote.price,
          source: 'delta_exchange',
        });
      }
    } catch {
      // Skip if Delta Exchange API fails
    }
  }

  private async upsertPrices(entries: PriceEntry[]): Promise<void> {
    if (!entries.length) return;

    const retrievedAt = new Date();
    await this.assetPriceRepository.upsertMany(
      entries.map((entry) => ({
        brokerAssetId: entry.brokerAssetId,
        symbol: entry.symbol,
        sourceSymbol: entry.sourceSymbol,
        price: entry.price,
        source: entry.source,
        retrievedAt,
        updatedAt: retrievedAt,
      }))
    );
  }
}
