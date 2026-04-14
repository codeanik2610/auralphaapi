import { ApiTimeContract } from './Time';

export interface PortfolioHolding {
  id: string;
  symbol: string;
  quantity: number;
  marketValue: number;
  allocationPct: number;
  dayPnL: number;
  unrealizedPnL: number;
  side: 'Long' | 'Short' | 'Hedged';
  strategy: string;
  riskState: 'Healthy' | 'Watch' | 'At risk';
  sleeve: string;
  contribution?: string;
  lastRebalanceAt?: string;
  lastRebalanceAtIso?: string;
}

export interface PortfolioHoldingsResponse {
  items: PortfolioHolding[];
  total: number;
  limit: number;
  offset: number;
  source?: 'portfolio_snapshots' | 'portfolio_overview_futures_legacy_alias';
  observedAt?: string | null;
  observedAtIso?: string | null;
  definition?: string;
  time?: ApiTimeContract;
}

export interface PortfolioSummary {
  equity: number;
  dayPnL: number;
  netExposure: string;
  diversification: string;
  source?: 'portfolio_snapshots' | 'portfolio_overview_futures_legacy_alias';
  observedAt?: string | null;
  observedAtIso?: string | null;
  definition?: string;
  portfolioValue?: string;
  netPnl?: string;
  holdings?: number;
  largestWeight?: string;
  largestWeightLabel?: string;
  assetAllocation?: string;
  strategyMix?: string;
  riskPosture?: string;
  accountCurve?: string;
  monthlyPace?: string;
  time?: ApiTimeContract;
}

export interface PortfolioPerformancePoint {
  date: string;
  equity: number;
  pnl: number;
  totalProfit: number;
  totalLoss: number;
  totalTrades: number;
}

export interface PortfolioPerformanceSummary {
  totalEquity: number;
  totalPnl: number;
  totalProfit: number;
  totalLoss: number;
  totalTrades: number;
  brokers: Record<string, { totalProfit: number; totalLoss: number; totalTrades: number }>;
}

export interface PortfolioPerformanceResponse {
  timeframe: 'daily' | 'weekly' | 'monthly';
  mode?: 'closed-position-activity';
  source?: 'scheduler_positions_snapshots';
  measurement?: 'realized_pnl';
  freshnessModel?: 'windowed_activity';
  observedAt?: string | null;
  observedAtIso?: string | null;
  definition?: string;
  windowLabel?: string;
  bucketLabel?: 'hour' | 'day';
  points: PortfolioPerformancePoint[];
  summary: PortfolioPerformanceSummary;
  time?: ApiTimeContract;
}

export interface PortfolioPnLResponse {
  dailyPnL: number;
  weeklyPnL: number;
  monthlyPnL: number;
  source?: 'scheduler_positions_snapshots';
  measurement?: 'realized_pnl';
  freshnessModel?: 'windowed_activity';
  observedAt?: string | null;
  observedAtIso?: string | null;
  definition?: string;
  windows?: {
    timezone: string;
    daily: string;
    weekly: string;
    monthly: string;
  };
  connections?: Array<{
    brokerKey: string;
    accountId: string;
    dailyPnL: number;
    weeklyPnL: number;
    monthlyPnL: number;
  }>;
  time?: ApiTimeContract;
}

export interface PortfolioSnapshotItem {
  id: string;
  equity: number;
  dayPnL: number;
  netExposure?: string;
  diversification?: string;
  assetAllocation?: string;
  strategyMix?: string;
  riskPosture?: string;
  accountCurve?: string;
  monthlyPace?: string;
  createdAt: string;
  createdAtIso?: string;
}

export interface PortfolioSnapshotsResponse {
  items: PortfolioSnapshotItem[];
  total: number;
  limit: number;
  offset: number;
  source?: 'portfolio_snapshots' | 'portfolio_overview_futures_legacy_alias';
  observedAt?: string | null;
  observedAtIso?: string | null;
  definition?: string;
  time?: ApiTimeContract;
}

export type PortfolioWorkspaceHoldingsFocus = 'all' | 'watch' | 'long' | 'short';
export type PortfolioWorkspaceReportFormat = 'markdown' | 'json';

export interface PortfolioWorkspaceContext {
  timeframe: 'daily' | 'weekly' | 'monthly';
  holdingsFocus: PortfolioWorkspaceHoldingsFocus;
  holdingsSearch?: string | null;
  selectedHoldingId?: string | null;
  selectedHoldingSymbol?: string | null;
  sliceLimit: number;
  filterMode: 'loaded_overview_slice_client_side';
}

export interface PortfolioWorkspaceHighlight {
  label: string;
  value: string;
  tone?: 'info' | 'success' | 'warning' | 'danger';
}

export interface PortfolioWorkspaceAction {
  code:
    | 'trim_concentration'
    | 'triage_at_risk'
    | 'review_watchlist'
    | 'rebalance_sleeve'
    | 'align_capital_routes'
    | 'review_recent_activity'
    | 'inspect_selected_holding'
    | 'monitor';
  title: string;
  priority: 'high' | 'medium' | 'low';
  detail: string;
  metric?: string;
}

export interface RebalanceReviewBody {
  scope?: string;
  mode?: string;
  timeframe?: string;
  holdingsFocus?: string;
  holdingsSearch?: string;
  selectedHoldingId?: string;
}

export interface RebalanceReviewResult {
  message: string;
  review: {
    generatedAt: string;
    generatedAtIso?: string;
    summary: string;
    note: string;
    context: PortfolioWorkspaceContext;
    snapshotObservedAt?: string | null;
    snapshotObservedAtIso?: string | null;
    activityObservedAt?: string | null;
    activityObservedAtIso?: string | null;
    highlights: PortfolioWorkspaceHighlight[];
    actions: PortfolioWorkspaceAction[];
    time?: ApiTimeContract;
  };
}

export interface PortfolioWorkspaceReportBody {
  timeframe?: string;
  holdingsFocus?: string;
  holdingsSearch?: string;
  selectedHoldingId?: string;
  format?: string;
}

export interface PortfolioWorkspaceReportResult {
  message: string;
  report: {
    generatedAt: string;
    generatedAtIso?: string;
    title: string;
    format: PortfolioWorkspaceReportFormat;
    fileName: string;
    contentType: string;
    content: string;
    summary: string;
    note: string;
    context: PortfolioWorkspaceContext;
    snapshotObservedAt?: string | null;
    snapshotObservedAtIso?: string | null;
    activityObservedAt?: string | null;
    activityObservedAtIso?: string | null;
    highlights: PortfolioWorkspaceHighlight[];
    actions: PortfolioWorkspaceAction[];
    time?: ApiTimeContract;
  };
}
