export const ASSET_PRICE_SYNC_SCHEDULER_KEY = 'asset-price-sync';
export const ASSET_PRICE_SYNC_SCHEDULER_NAME = 'Asset Price Sync';
export const ASSET_PRICE_SYNC_SCHEDULER_OWNERSHIP = 'global' as const;
export const ASSET_PRICE_SYNC_DESCRIPTION =
  'Fetches latest prices for system broker assets from system market sources (Mudrex, Delta Exchange).';

export const ASSET_PRICE_SYNC_SYSTEM_SOURCES = ['mudrex', 'delta_exchange'] as const;
export type AssetPriceSyncSource = (typeof ASSET_PRICE_SYNC_SYSTEM_SOURCES)[number];

export const ASSET_PRICE_SYNC_SCOPE_SOURCE_TABLE = 'broker_assets';
export const ASSET_PRICE_SYNC_TARGET_STORAGE_TABLE = 'asset_price';
export const ASSET_PRICE_SYNC_USE_SYSTEM_CONNECTIONS_ONLY = true;

export const ASSET_PRICE_SYNC_ALLOWED_SELECTION_MODES = ['all', 'custom'] as const;
export type AssetPriceSyncSelectionMode =
  (typeof ASSET_PRICE_SYNC_ALLOWED_SELECTION_MODES)[number];

export const ASSET_PRICE_SYNC_DEFAULT_CONFIG = {
  sources: [...ASSET_PRICE_SYNC_SYSTEM_SOURCES],
  useSystemConnectionsOnly: ASSET_PRICE_SYNC_USE_SYSTEM_CONNECTIONS_ONLY,
  selectionMode: 'all' as AssetPriceSyncSelectionMode,
  selectedAssetIds: [] as string[],
  retentionDays: 30,
  scheduleMode: 'daily' as const,
  intervalMinutes: 5,
  intervalSeconds: 1,
  hourlyMinute: 0,
};
