export interface StoredExchangeAsset {
  id: string;
  source: string;
  brokerId?: string | null;
  externalId: string;
  assetId: string;
  name: string;
  symbol: string;
  deltaExternalId?: string | null;
  deltaSymbol?: string | null;
  isDeltaMapped?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExchangeAssetSyncSummary {
  source: string;
  attemptedSymbols: number;
  matchedAssets: number;
  insertedAssets: number;
  updatedAssets: number;
  skippedSymbols: number;
  totalStoredAssets: number;
  deltaMappedSymbols?: number;
}

export interface ExchangeAssetListResponse {
  assets: StoredExchangeAsset[];
  total: number;
  limit: number;
  offset: number;
  source?: string;
}
