export interface MarketPriceResult {
  symbol: string;
  sourceSymbol: string | null;
  price: number;
  source: string;
  retrievedAt: string;
  updatedAt: string;
  exchangeAssetId: string | null;
  brokerAssetId?: string | null;
}
