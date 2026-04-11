import { Inject, Service } from 'typedi';
import { DeltaExchangeHttpClient } from '../../providers/delta_exchange/DeltaExchangeHttpClient';
import { ExchangeAssetSyncCandidate, ExchangeAssetSyncExecutor, ExchangeAssetSyncMatch } from './ExchangeAssetSyncService';

interface DeltaProduct {
  id?: number | string;
  symbol?: string;
  description?: string;
  contract_type?: string;
  state?: string;
}

@Service()
export class DeltaExchangeAssetSyncExecutor implements ExchangeAssetSyncExecutor {
  readonly key = 'delta-exchange-assets';

  @Inject(() => DeltaExchangeHttpClient)
  private deltaExchangeHttpClient!: DeltaExchangeHttpClient;

  async execute(assets: ExchangeAssetSyncCandidate[]): Promise<ExchangeAssetSyncMatch[]> {
    const products = await this.deltaExchangeHttpClient.publicGet<DeltaProduct[]>('/v2/products');
    const candidateProducts = (Array.isArray(products) ? products : []).filter(
      (item) =>
        item?.id !== undefined &&
        item?.symbol &&
        item.state === 'live' &&
        item.contract_type === 'perpetual_futures'
    );

    const productsByExactSymbol = new Map(
      candidateProducts.map((item) => [String(item.symbol).toUpperCase(), item])
    );
    const productsByNormalizedSymbol = new Map(
      candidateProducts.map((item) => [this.normalizeDeltaSymbol(String(item.symbol)), item])
    );
    const productsByBaseSymbol = new Map(
      candidateProducts.map((item) => [this.extractBaseSymbol(String(item.symbol)), item])
    );

    return assets.flatMap((assetRecord) => {
      const exactSymbol = assetRecord.symbol.toUpperCase();
      const normalizedSymbol = this.normalizeAssetSymbol(assetRecord.symbol);
      const baseSymbol = this.extractBaseSymbol(assetRecord.symbol);
      const product =
        productsByExactSymbol.get(exactSymbol) ||
        productsByNormalizedSymbol.get(normalizedSymbol) ||
        productsByBaseSymbol.get(baseSymbol);

      if (!product) {
        return [];
      }

      return [
        {
          externalId: String(product.id),
          assetId: assetRecord.id,
          name: String(product.description || product.symbol || assetRecord.symbol),
          symbol: assetRecord.symbol,
        },
      ];
    });
  }

  private normalizeAssetSymbol(symbol: string): string {
    const upper = symbol.toUpperCase().replace(/[_-]/g, '');
    if (upper.endsWith('USDT')) {
      return `${upper.slice(0, -4)}USD`;
    }
    if (upper.endsWith('USDC')) {
      return `${upper.slice(0, -4)}USD`;
    }
    if (upper.endsWith('BUSD')) {
      return `${upper.slice(0, -4)}USD`;
    }
    if (upper.endsWith('FDUSD')) {
      return `${upper.slice(0, -5)}USD`;
    }
    return upper;
  }

  private normalizeDeltaSymbol(symbol: string): string {
    return symbol.toUpperCase().replace(/[_-]/g, '');
  }

  private extractBaseSymbol(symbol: string): string {
    const normalized = symbol.toUpperCase().replace(/[_-]/g, '');
    const quotes = ['USDT', 'USDC', 'BUSD', 'FDUSD', 'USD', 'INR', 'BTC', 'ETH'];

    for (const quote of quotes) {
      if (normalized.endsWith(quote) && normalized.length > quote.length) {
        return normalized.slice(0, -quote.length);
      }
    }

    return normalized;
  }
}
