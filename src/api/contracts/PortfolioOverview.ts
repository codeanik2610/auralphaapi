import {
  PortfolioPerformanceResponse,
  PortfolioHoldingsResponse,
  PortfolioPnLResponse,
  PortfolioSnapshotsResponse,
  PortfolioSummary,
} from './Portfolio';
import { ApiTimeContract } from './Time';

export type PortfolioOverviewSectionKey =
  | 'pnl'
  | 'performance'
  | 'summary'
  | 'holdings'
  | 'snapshots'
  | 'activeFunds';

export type PortfolioOverviewFreshnessModel =
  | 'snapshot_timestamp'
  | 'funds_snapshot_timestamp'
  | 'windowed_activity';

export type PortfolioOverviewSectionAvailability = 'available' | 'partial' | 'missing';
export type PortfolioOverviewFreshnessState = 'fresh' | 'stale' | 'critical' | 'unknown';

export interface PortfolioOverviewSectionFreshness {
  state: PortfolioOverviewFreshnessState;
  freshnessMs: number | null;
  staleAfterMs: number | null;
  criticalAfterMs: number | null;
}

export interface PortfolioOverviewSectionProvenance {
  source: string;
  sourceLabel: string;
  availability: PortfolioOverviewSectionAvailability;
  observedAt: string | null;
  observedAtIso?: string | null;
  freshnessModel: PortfolioOverviewFreshnessModel;
  freshness: PortfolioOverviewSectionFreshness | null;
  definition: string;
  note: string;
}

export interface PortfolioOverviewWarning {
  code:
    | 'stored_snapshot_missing'
    | 'stored_snapshot_stale'
    | 'funds_snapshot_attention'
    | 'funds_snapshot_missing';
  tone: 'warning' | 'danger';
  section: PortfolioOverviewSectionKey;
  summary: string;
  detail: string;
}

export interface PortfolioActiveFundsItem {
  accountId: string;
  accountName: string;
  accountKey: string;
  brokerKey: string;
  status: string;
  observedAt?: string | null;
  observedAtIso?: string | null;
  error?: string | null;
  funds: {
    balance: number | null;
    available: number | null;
    invested: number | null;
  };
}

export interface PortfolioActiveFundsResponse {
  source: string;
  definition: string;
  freshnessModel?: 'funds_snapshot_timestamp';
  latestObservedAt?: string | null;
  latestObservedAtIso?: string | null;
  oldestObservedAt?: string | null;
  oldestObservedAtIso?: string | null;
  walletItems: PortfolioActiveFundsItem[];
  futuresItems: PortfolioActiveFundsItem[];
  time?: ApiTimeContract;
}

export interface PortfolioOverviewReconciliationPolicy {
  mode: 'manual_workspace_review';
  holdingsSource: 'portfolio_snapshots';
  capitalSource: 'funds_snapshots via broker_wallet_facade';
  activitySource: 'scheduler_positions_snapshots';
  holdingsScope: 'loaded_overview_slice_client_side';
  driftAlertThresholdPct: number;
  reviewTriggers: string[];
  operatorActions: string[];
}

export interface PortfolioOverviewMeta {
  contractVersion: string;
  purpose: 'operator_portfolio_workspace';
  generatedAt: string;
  generatedAtIso?: string;
  summary: string;
  primaryPageRoute: string;
  primaryEndpoint: string;
  pageHydration: string;
  query: {
    supported: Array<'timeframe' | 'snapshotsLimit' | 'snapshotsOffset' | 'holdingsLimit'>;
    unsupported: Array<'brokerKey' | 'accountId'>;
    resolved: {
      timeframe: 'daily' | 'weekly' | 'monthly';
      snapshots: {
        limit: number;
        offset: number;
      };
      holdings: {
        limit: number;
        offset: number;
        filterMode: 'loaded_overview_slice_client_side';
      };
    };
  };
  sources: {
    pnl: string;
    performance: string;
    summary: string;
    holdings: string;
    snapshots: string;
    activeFunds: string;
  };
  pageTruth: {
    storedPosture: 'latest_portfolio_snapshot';
    holdingsWorkspace: 'ranked_overview_slice_from_latest_snapshot';
    liveCapital: 'active_account_funds_snapshots';
    activity: 'closed_position_scheduler_snapshots';
    reconciliation: 'operator_review_without_auto_reconciliation';
    workspaceStructure: 'trust_posture_holdings_capital_activity_snapshots';
  };
  capabilities: {
    singleRequestHydration: boolean;
    explicitSectionProvenance: boolean;
    explicitSectionFreshness: boolean;
    holdingsIncludedInOverview: boolean;
    indexedSnapshotReads: boolean;
    activityReadModelAcceleration: boolean;
    portfolioHealthChecks: boolean;
    shareableWorkspaceState: boolean;
    rebalanceReviewWorkflow: boolean;
    workspaceReportGeneration: boolean;
    serverScopedHoldingsFiltersInOverview: boolean;
    routeScopedPerformanceFilters: boolean;
    routeScopedPnlFilters: boolean;
    liveSnapshotReconciliationPolicy: boolean;
    exportReport: boolean;
  };
  reconciliationPolicy: PortfolioOverviewReconciliationPolicy;
  warnings: PortfolioOverviewWarning[];
  sections: Record<PortfolioOverviewSectionKey, PortfolioOverviewSectionProvenance>;
  time?: ApiTimeContract;
}

export interface PortfolioOverviewResponse {
  meta: PortfolioOverviewMeta;
  pnl: PortfolioPnLResponse;
  performance: PortfolioPerformanceResponse;
  summary: PortfolioSummary;
  holdings: PortfolioHoldingsResponse;
  snapshots: PortfolioSnapshotsResponse;
  activeFunds: PortfolioActiveFundsResponse;
  time?: ApiTimeContract;
}
