export interface CryptoAsset {
  id: string;
  source: string;
  externalId: string;
  symbol: string;
  name: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AssetSyncSummary {
  source: 'binance-futures';
  fetchedAssets: number;
  insertedAssets: number;
  updatedAssets: number;
  totalStoredAssets: number;
  changes?: Array<{
    actionType: 'inserted' | 'updated';
    symbol: string;
    externalId: string;
    assetId: string;
  }>;
}

export interface AssetListResponse {
  assets: CryptoAsset[];
  total: number;
  limit: number;
  offset: number;
}

export interface ReferenceCatalogItem {
  id: string;
  brokerKey: string;
  exchangeKey?: string;
  entityType: 'provider' | 'exchange';
  name: string;
  category: string;
  providerType?: string;
  capabilities: string[];
}

export interface ReferenceCatalogResponse {
  items: ReferenceCatalogItem[];
  providerItems: ReferenceCatalogItem[];
  exchangeItems: ReferenceCatalogItem[];
  total: number;
  providersTotal: number;
  exchangesTotal: number;
}
