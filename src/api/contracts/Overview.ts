import { AlertsListResponse, AlertsSummary } from './Alert';
import { AutomationsListResponse, AutomationsSummary } from './Automation';
import { MudrexAsset, MudrexAssetDetail, MudrexFuturesFunds, MudrexLeverage, MudrexWalletFunds } from './Mudrex';
import { PortfolioActiveFundsResponse } from './PortfolioOverview';
import { PortfolioHoldingsResponse, PortfolioSummary } from './Portfolio';
import { SignalSummary, SignalsListResponse } from './Signal';

export type OverviewSectionKey =
  | 'health'
  | 'walletFunds'
  | 'futuresFunds'
  | 'assets'
  | 'selectedAsset'
  | 'leverage'
  | 'automations'
  | 'automationsSummary'
  | 'alerts'
  | 'alertsSummary'
  | 'signals'
  | 'signalsSummary'
  | 'portfolioSummary'
  | 'portfolioHoldings'
  | 'activeFunds';

export interface OverviewHealth {
  status: 'assembled' | 'degraded';
  timestamp: string;
  scope?: 'overview_request';
  summary?: string;
  degradedSections?: OverviewSectionKey[];
  timeoutSections?: OverviewSectionKey[];
}

export type OverviewSourceType = 'live_external' | 'db_snapshot' | 'computed_summary';
export type OverviewUiUsage = 'rendered' | 'available_not_rendered';
export type OverviewSectionAvailability = 'available' | 'missing';
export type OverviewSectionRequestStatus = 'ok' | 'degraded';
export type OverviewSectionFetchMode = 'primary' | 'fallback' | 'skipped';
export type OverviewFreshnessState = 'fresh' | 'stale' | 'critical' | 'unknown';
export type OverviewSectionCacheState =
  | 'not_applicable'
  | 'live'
  | 'fresh-cache-fallback'
  | 'stale-cache-fallback'
  | 'unavailable';
export type OverviewWarningLevel = 'warning' | 'critical';

export interface OverviewSectionFreshness {
  state: OverviewFreshnessState;
  ageMs: number | null;
  staleAfterMs: number | null;
  criticalAfterMs: number | null;
}

export interface OverviewSectionCache {
  enabled: boolean;
  state: OverviewSectionCacheState;
  cachedAt: string | null;
  ttlMs: number | null;
  staleTtlMs: number | null;
  detail: string;
}

export interface OverviewWarning {
  code:
    | 'capital_snapshot_attention'
    | 'portfolio_snapshot_attention'
    | 'automation_health_attention'
    | 'live_reference_feed_attention';
  level: OverviewWarningLevel;
  section: OverviewSectionKey;
  summary: string;
  detail: string;
}

export interface OverviewSectionProvenance {
  sourceType: OverviewSourceType;
  source: string;
  sourceLabel: string;
  uiUsage: OverviewUiUsage;
  observedAt: string | null;
  availability: OverviewSectionAvailability;
  requestStatus: OverviewSectionRequestStatus;
  fetchMode: OverviewSectionFetchMode;
  statusDetail: string;
  timeoutMs?: number | null;
  freshness?: OverviewSectionFreshness | null;
  cache?: OverviewSectionCache | null;
  notes?: string;
}

export interface OverviewMeta {
  contractVersion: 'overview-phase4-2026-04-09';
  purpose: 'operator_command_center';
  generatedAt: string;
  summary: string;
  query: {
    supported: Array<'selectedSymbol' | 'sort' | 'order'>;
    ignored: Array<'brokerKey' | 'accountId' | 'limit'>;
    sectionLimits: {
      assets: number;
      automations: number;
      alerts: number;
      signals: number;
      portfolioHoldings: number;
    };
  };
  routing: {
    accountSelection: 'default_connected_account_or_first_connected_account';
    brokerKey: string;
    accountId: string | null;
    referenceBrokerKey: 'mudrex';
    resolution: 'resolved' | 'fallback_default_broker';
    detail: string;
  };
  resilience: {
    status: 'full' | 'partial';
    degradedSections: OverviewSectionKey[];
    timeoutSections: OverviewSectionKey[];
    routingFallback: boolean;
    summary: string;
  };
  selection: {
    requestedSymbol: string | null;
    resolvedSymbol: string | null;
    mode: 'requested' | 'first_asset_default' | 'none';
  };
  warnings: OverviewWarning[];
  observability: {
    totalMs: number;
    degradedSectionCount: number;
    timeoutSectionCount: number;
    staleSectionCount: number;
    criticalSectionCount: number;
    warningCount: number;
    referenceCache: {
      assets: OverviewSectionCacheState;
      selectedAsset: OverviewSectionCacheState;
      leverage: OverviewSectionCacheState;
    };
    summary: string;
  };
  sections: Record<OverviewSectionKey, OverviewSectionProvenance>;
}

export interface OverviewResponse {
  meta: OverviewMeta;
  health: OverviewHealth;
  walletFunds: MudrexWalletFunds | null;
  futuresFunds: MudrexFuturesFunds | null;
  activeFunds: PortfolioActiveFundsResponse;
  assets: MudrexAsset[];
  selectedAsset: MudrexAssetDetail | null;
  leverage: MudrexLeverage | null;
  automations: AutomationsListResponse;
  automationsSummary: AutomationsSummary;
  alerts: AlertsListResponse;
  alertsSummary: AlertsSummary;
  signals: SignalsListResponse;
  signalsSummary: SignalSummary;
  portfolioSummary: PortfolioSummary;
  portfolioHoldings: PortfolioHoldingsResponse;
}
