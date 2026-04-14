import {
  PortfolioPerformanceResponse,
  PortfolioHoldingsResponse,
  PortfolioPnLResponse,
  PortfolioSnapshotsResponse,
  PortfolioSummary,
} from './Portfolio';
import { PositionSummary, PositionsFreshnessIndicator } from './Positions';
import { ApiTimeContract } from './Time';

export type PortfolioOverviewLegacySectionKey =
  | 'pnl'
  | 'performance'
  | 'summary'
  | 'holdings'
  | 'snapshots'
  | 'activeFunds';

export type PortfolioOverviewFuturesSectionKey =
  | 'summary'
  | 'positions'
  | 'capital'
  | 'activity';

export type PortfolioOverviewSectionKey =
  | PortfolioOverviewLegacySectionKey
  | PortfolioOverviewFuturesSectionKey;

export type PortfolioOverviewFreshnessModel =
  | 'snapshot_timestamp'
  | 'funds_snapshot_timestamp'
  | 'windowed_activity'
  | 'position_read_model_timestamp'
  | 'mixed_futures_state';

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
    | 'funds_snapshot_attention'
    | 'funds_snapshot_missing'
    | 'positions_snapshot_attention'
    | 'positions_snapshot_missing'
    | 'futures_summary_attention';
  tone: 'warning' | 'danger';
  section: PortfolioOverviewSectionKey | PortfolioOverviewFuturesSectionKey;
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

export interface PortfolioCapitalResponse {
  source: 'funds_snapshots via broker_wallet_facade';
  definition: string;
  freshnessModel?: 'funds_snapshot_timestamp';
  latestObservedAt?: string | null;
  latestObservedAtIso?: string | null;
  oldestObservedAt?: string | null;
  oldestObservedAtIso?: string | null;
  walletItems: PortfolioActiveFundsItem[];
  futuresItems: PortfolioActiveFundsItem[];
  walletTotal?: number | null;
  futuresTotal?: number | null;
  totalVisibleCapital?: number | null;
  walletSharePct?: number | null;
  futuresSharePct?: number | null;
  driftPct?: number | null;
  time?: ApiTimeContract;
}

export interface PortfolioOpenPositionItem extends PositionSummary {
  accountId: string;
  accountName: string;
  accountKey: string;
  brokerKey: string;
  observedAt?: string | null;
  observedAtIso?: string | null;
  freshness?: PositionsFreshnessIndicator | null;
}

export interface PortfolioOpenPositionsResponse {
  items: PortfolioOpenPositionItem[];
  total: number;
  limit: number;
  offset: number;
  source?: 'position_read_models';
  freshnessModel?: 'position_read_model_timestamp';
  observedAt?: string | null;
  observedAtIso?: string | null;
  latestObservedAt?: string | null;
  latestObservedAtIso?: string | null;
  oldestObservedAt?: string | null;
  oldestObservedAtIso?: string | null;
  definition?: string;
  time?: ApiTimeContract;
}

export interface PortfolioFuturesSummaryResponse {
  source: 'funds_snapshots_plus_position_read_models';
  definition: string;
  freshnessModel?: 'mixed_futures_state';
  observedAt?: string | null;
  observedAtIso?: string | null;
  positionsObservedAt?: string | null;
  positionsObservedAtIso?: string | null;
  capitalObservedAt?: string | null;
  capitalObservedAtIso?: string | null;
  futuresEquity: number | null;
  availableCollateral: number | null;
  usedMargin: number | null;
  walletCollateral: number | null;
  openPositions: number;
  grossExposure: number | null;
  longExposure: number | null;
  shortExposure: number | null;
  unrealizedPnl: number | null;
  time?: ApiTimeContract;
}

export interface PortfolioActivityResponse {
  source: 'scheduler_positions_snapshots';
  definition: string;
  freshnessModel?: 'windowed_activity';
  observedAt?: string | null;
  observedAtIso?: string | null;
  pnl: PortfolioPnLResponse;
  performance: PortfolioPerformanceResponse;
  time?: ApiTimeContract;
}

export interface PortfolioOverviewReconciliationPolicy {
  mode: 'manual_workspace_review';
  holdingsSource: 'position_read_models';
  capitalSource: 'funds_snapshots via broker_wallet_facade';
  activitySource: 'scheduler_positions_snapshots';
  holdingsScope: 'connected_accounts_live_positions';
  driftAlertThresholdPct: number;
  reviewTriggers: string[];
  operatorActions: string[];
}

export interface PortfolioFuturesOverviewReconciliationPolicy {
  mode: 'manual_workspace_review';
  positionsSource: 'position_read_models';
  capitalSource: 'funds_snapshots via broker_wallet_facade';
  activitySource: 'scheduler_positions_snapshots';
  positionsScope: 'connected_accounts_live_positions';
  driftAlertThresholdPct: number;
  reviewTriggers: string[];
  operatorActions: string[];
}

export interface PortfolioOverviewContractEvolution {
  currentModel: 'futures_only_workspace';
  targetModel: 'futures_only_workspace';
  legacySectionKeys: PortfolioOverviewLegacySectionKey[];
  futuresSectionKeys: PortfolioOverviewFuturesSectionKey[];
  deprecatedLegacySections: Array<'holdings' | 'snapshots' | 'activeFunds'>;
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
    futuresSummary?: string;
    positions?: string;
    capital?: string;
    activity?: string;
  };
  pageTruth: {
    storedPosture: 'futures_summary_from_live_routes';
    holdingsWorkspace: 'open_positions_from_connected_accounts';
    liveCapital: 'active_account_funds_snapshots';
    activity: 'closed_position_scheduler_snapshots';
    reconciliation: 'operator_review_with_futures_aliases';
    workspaceStructure: 'futures_summary_positions_capital_activity';
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
    futuresOverview?: boolean;
    positionsIncludedInOverview?: boolean;
    legacyFieldsAreCompatibilityAliases?: boolean;
  };
  reconciliationPolicy: PortfolioOverviewReconciliationPolicy;
  futuresReconciliationPolicy?: PortfolioFuturesOverviewReconciliationPolicy;
  evolution?: PortfolioOverviewContractEvolution;
  warnings: PortfolioOverviewWarning[];
  sections: Record<PortfolioOverviewSectionKey, PortfolioOverviewSectionProvenance>;
  time?: ApiTimeContract;
}

export interface PortfolioOverviewResponse {
  meta: PortfolioOverviewMeta;
  /**
   * @deprecated Legacy split activity field. Replace with `activity`.
   */
  pnl: PortfolioPnLResponse;
  /**
   * @deprecated Legacy split activity field. Replace with `activity`.
   */
  performance: PortfolioPerformanceResponse;
  /**
   * @deprecated Legacy compatibility summary alias. Replace with `futuresSummary`.
   */
  summary: PortfolioSummary;
  /**
   * @deprecated Legacy compatibility positions alias. Replace with `positions`.
   */
  holdings: PortfolioHoldingsResponse;
  /**
   * @deprecated Legacy placeholder retained for compatibility. Remove for futures-only workspaces.
   */
  snapshots: PortfolioSnapshotsResponse;
  /**
   * @deprecated Legacy capital field name. Replace with `capital`.
   */
  activeFunds: PortfolioActiveFundsResponse;
  futuresSummary?: PortfolioFuturesSummaryResponse;
  positions?: PortfolioOpenPositionsResponse;
  capital?: PortfolioCapitalResponse;
  activity?: PortfolioActivityResponse;
  time?: ApiTimeContract;
}
