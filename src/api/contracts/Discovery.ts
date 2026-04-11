export interface DiscoveryDependencyCheck {
  key: string;
  label: string;
  status: 'ok' | 'degraded' | 'down';
  httpStatus?: number;
  latencyMs?: number;
  detail?: string;
  probeMode?: 'direct' | 'sampled' | 'skipped';
  sampledId?: string;
}

export interface DiscoveryDependencyReadinessDependency {
  status: 'ok' | 'degraded' | 'down';
  detail?: string;
}

export interface DiscoveryDependencyHealthResponse {
  status: 'ok' | 'degraded' | 'down';
  checkedAt: string;
  baseUrl: string;
  service: DiscoveryDependencyCheck;
  readiness: DiscoveryDependencyCheck & {
    dependencies?: Record<string, DiscoveryDependencyReadinessDependency>;
  };
  auth: DiscoveryDependencyCheck;
  contract: DiscoveryDependencyCheck & {
    checkedEndpoints: string[];
  };
  endpoints: DiscoveryDependencyCheck[];
  detail?: string;
}

export interface DiscoverySummaryResponse {
  checkedAt: string;
  bots: {
    total: number;
    active: number;
  };
  strategies: {
    total: number;
    pendingReview: number;
    bestScore: number | null;
  };
  suggestions: {
    total: number;
  };
  runs: {
    total: number;
  };
}

export interface DiscoveryFeedItem {
  id: string;
  source: 'history' | 'stream';
  type: 'strategy_discovered' | 'run_progress' | 'run_completed';
  occurredAt: string;
  runId?: string;
  botId?: string;
  status?: string | null;
  name?: string | null;
  symbol?: string | null;
  timeframe?: string | null;
  score?: number | null;
  strategiesFound?: number;
  assetsScanned?: number;
  percentComplete?: number | null;
  durationSeconds?: number | null;
  startedAt?: string | null;
  completedAt?: string | null;
  errorMessage?: string | null;
  timeframes?: string[];
  assets?: string[];
}

export interface DiscoveryFeedResponse {
  checkedAt: string;
  items: DiscoveryFeedItem[];
}
