export interface WatchlistItem {
  id: string;
  symbol: string;
  regime: string;
  signal: string;
  aiScore: number;
  lastPrice: number;
  change24h: number;
  volume24h: number;
  high24h: number;
  low24h: number;
  setup: string;
  status: string;
  alerts: number;
  liquidity: string;
  priceSource: string;
  snapshotAt: string;
}

export interface WatchlistSummary {
  savedLists: number;
  symbolsTracked: number;
  activeAlerts: number;
  topAiScore: number;
}

export interface WatchlistMeta {
  id: string;
  name: string;
  type: string;
  editable: boolean;
  itemsCount: number;
  updatedAt: string;
  description: string;
}

export interface WatchlistsListResponse {
  items: WatchlistMeta[];
}

export interface WatchlistItemsResponse {
  items: WatchlistItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface WatchlistsOverviewResponse {
  watchlists: WatchlistsListResponse;
  summary: WatchlistSummary;
  activeWatchlistId: string | null;
  activeWatchlist: WatchlistMeta | null;
  items: WatchlistItemsResponse;
}

export interface CreateWatchlistResponse {
  watchlist: WatchlistMeta;
  message: string;
}

export interface UpdateWatchlistResponse {
  watchlist: WatchlistMeta;
  message: string;
}

export interface AddWatchlistItemsResponse {
  added: string[];
  skipped: string[];
  message: string;
}

export interface RemoveWatchlistItemsResponse {
  removed: string[];
  skipped: string[];
  message: string;
}

export interface DeleteWatchlistResponse {
  watchlistId: string;
  message: string;
}
