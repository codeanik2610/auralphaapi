import { BinanceMarketCandle } from './Binance';
import { SignalsListResponse } from './Signal';

export interface MarketDataProvenance {
  mode: 'live-candles' | 'broker-price-cache' | 'snapshot' | 'chart-candles';
  source: string | null;
  sourceLabel: string;
  observedAt: string | null;
  freshnessMs: number | null;
  staleAfterMs: number;
  isStale: boolean;
}

export interface MarketsOverviewMeta {
  buildMode: 'snapshot-query' | 'full-enrichment';
  cacheState: 'miss' | 'fresh-hit' | 'stale-fallback';
  generatedAt: string;
  staleCacheFallback: boolean;
  summary: string;
}

export interface MarketAssetSummary {
  symbol: string;
  name: string;
  price: number | null;
  change_perc: number | null;
  volume: number | null;
  high_24h: number | null;
  low_24h: number | null;
  liquidity_tier: string | null;
  price_source: string | null;
  snapshot_at: string | null;
  latest_signal_source?: string | null;
  latest_signal_status?: string | null;
  latest_signal_confidence?: number | null;
  latest_signal_time?: string | null;
  latest_signal_timeframe?: string | null;
  signal_count?: number;
  watchlist_count?: number;
  provenance?: MarketDataProvenance | null;
}

export interface MarketWatchlistMembership {
  id: string;
  name: string;
  type: string;
  updatedAt: string;
}

export interface MarketSymbolOverviewResponse {
  symbol: string;
  asset: MarketAssetSummary | null;
  signals: SignalsListResponse;
  watchlists: {
    total: number;
    memberships: MarketWatchlistMembership[];
  };
}

export interface MarketChartResponse {
  symbol: string;
  interval: string;
  limit: number;
  source: string;
  provenance: MarketDataProvenance | null;
  candles: BinanceMarketCandle[];
  range: {
    startTime: string | null;
    endTime: string | null;
  };
}

export interface MarketsOverviewResponse {
  assets: MarketAssetSummary[];
  total: number;
  limit: number;
  offset: number;
  selectedSymbol: string | null;
  selectedAsset: MarketAssetSummary | null;
  meta: MarketsOverviewMeta;
}
