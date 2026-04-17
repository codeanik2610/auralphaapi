import {
  RiskAlertsResponse,
  RiskControlsResponse,
  RiskPoliciesResponse,
  RiskScenariosResponse,
  RiskSummary,
} from './Risk';
import { ActivityExportFormat, ActivityExportStatus, ActivityReadState } from './Activity';
import { ApiTimeContract } from './Time';

export type RiskCenterSnapshotAvailability = 'snapshot' | 'partial' | 'unavailable';
export type RiskCenterFreshnessState = 'fresh' | 'lagging' | 'partial' | 'unavailable';
export type RiskCenterFreshnessBlocker =
  | 'missing_risk_snapshot'
  | 'missing_funds_snapshot_coverage'
  | 'missing_positions_snapshot_coverage'
  | 'risk_snapshot_behind_sources';

export interface RiskWindowOverviewItem {
  key: 'daily' | 'weekly' | 'monthly';
  label: string;
  usedPct: number | null;
  usedDisplay: string;
  availability: 'snapshot' | 'unavailable';
  observedAt: string | null;
  observedAtIso?: string | null;
  sourceLabel: string;
  note: string;
}

export interface RiskBrokerSnapshotMetric {
  value: number | null;
  availability: 'snapshot' | 'unavailable';
  observedAt: string | null;
  observedAtIso?: string | null;
  sourceLabel: string;
}

export interface RiskBrokerOverviewItem {
  brokerKey: string;
  brokerName: string;
  connectedAccountCount: number;
  snapshotAvailability: RiskCenterSnapshotAvailability;
  fundsBalance: RiskBrokerSnapshotMetric;
  openPositions: RiskBrokerSnapshotMetric;
  note: string;
}

export interface RiskBrokersOverview {
  brokerKeys: string[];
  brokerKeyNameMap: Record<string, string>;
  items: RiskBrokerOverviewItem[];
}

export interface RiskActivityTrailOption {
  value: string;
  label: string;
}

export interface RiskActivityTrailExportItem {
  exportId: string;
  status: ActivityExportStatus;
  fileName: string;
  createdAt: string;
  createdAtIso?: string;
  expiresAt: string | null;
  expiresAtIso?: string | null;
  filters: Record<string, string>;
  downloadPath?: string;
}

export interface RiskActivityTrailOverview {
  defaultFilters: {
    route: 'Risk';
    readState: ActivityReadState;
  };
  supportedFilters: Array<'stream' | 'status' | 'readState'>;
  streamOptions: RiskActivityTrailOption[];
  statusOptions: RiskActivityTrailOption[];
  readStateOptions: RiskActivityTrailOption[];
  exportHistoryPath: string;
  exportFormat: ActivityExportFormat;
  exportRetentionDays: number;
  exportRetentionLabel: string;
  latestExport: RiskActivityTrailExportItem | null;
}

export interface RiskOverviewFreshnessMeta {
  state: RiskCenterFreshnessState;
  blockers: RiskCenterFreshnessBlocker[];
  connectedAccountCount: number;
  fundsAccountsWithSnapshot: number;
  positionsAccountsWithSnapshot: number;
  latestRiskSnapshotAt: string | null;
  latestRiskSnapshotAtIso?: string | null;
  latestFundsObservedAt: string | null;
  latestFundsObservedAtIso?: string | null;
  latestPositionsObservedAt: string | null;
  latestPositionsObservedAtIso?: string | null;
  latestControlAt: string | null;
  latestControlAtIso?: string | null;
  latestAlertAt: string | null;
  latestAlertAtIso?: string | null;
  latestScenarioAt: string | null;
  latestScenarioAtIso?: string | null;
  snapshotLagMinutes: number | null;
}

export interface RiskOverviewLineageMeta {
  summary: 'risk_snapshots_latest';
  riskWindows: 'risk_snapshots_latest_with_persisted_loss_windows';
  brokerCoverage:
    | 'funds_snapshots_plus_position_read_models_for_connected_accounts'
    | 'risk_account_snapshots_plus_funds_snapshots_plus_position_read_models_for_connected_accounts';
  recomputeWrites: Array<
    | 'risk_snapshots'
    | 'risk_account_snapshots'
    | 'risk_order_snapshots'
    | 'risk_position_snapshots'
    | 'risk_controls'
    | 'risk_alerts'
    | 'risk_scenarios'
  >;
}

export interface RiskOverviewMeta {
  contractVersion: string;
  purpose: 'operator_risk_workspace';
  generatedAt: string;
  generatedAtIso?: string;
  summary: string;
  query: {
    supported: string[];
    unsupported: string[];
    resolved: {
      controls: {
        limit: number;
        offset: number;
      };
      alerts: {
        limit: number;
        offset: number;
      };
      scenarios: {
        limit: number;
        offset: number;
      };
    };
  };
  sources: {
    summary: string;
    controls: string;
    scenarios: string;
    alerts: string;
    policies: string;
    brokers: string;
    riskWindows: string;
    brokerSnapshots: string;
    activityExports: string;
  };
  pageTruth: {
    riskWindowSource: 'latest_risk_snapshot_with_persisted_loss_windows';
    brokerCoverageSource:
      | 'snapshot_backed_connected_brokers'
      | 'risk_account_snapshots_backed_connected_brokers';
    policyWorkspace: 'selected_rule_with_pending_review_history_controls';
    policyGovernance: 'manual_review_for_sensitive_policy_mutations';
    activityTrailSource: 'activity_logs_route_and_reference_filters';
    activityTrailControls: 'in_page_filters_export_and_retention_cues';
    alertHandoff: 'alerts_workspace_symbol_search';
    workspaceStructure: 'focus_coverage_policy_activity_modules';
  };
  capabilities: {
    policyWrites: boolean;
    policyRollback: boolean;
    liveBrokerKpis: boolean;
    snapshotBrokerKpis: boolean;
    weeklyMonthlyRiskWindowUsage: boolean;
    riskCapacity: boolean;
    killSwitchAutomation: boolean;
    recomputeExecutesRealCalculation: boolean;
    riskActivityTrailUsedByPage: boolean;
    riskActivityTrailFiltersUsedByPage: boolean;
    riskActivityTrailExportsUsedByPage: boolean;
    pageModulesSplitByConcern: boolean;
    workspaceFocusBannerUsedByPage: boolean;
    policyReviewWorkflow: boolean;
  };
  freshness: RiskOverviewFreshnessMeta;
  lineage: RiskOverviewLineageMeta;
  time?: ApiTimeContract;
}

export interface RiskOverviewResponse {
  meta: RiskOverviewMeta;
  summary: RiskSummary;
  controls: RiskControlsResponse;
  scenarios: RiskScenariosResponse;
  alerts: RiskAlertsResponse;
  policies: RiskPoliciesResponse;
  riskWindows: RiskWindowOverviewItem[];
  brokers: RiskBrokersOverview;
  activityTrail: RiskActivityTrailOverview;
  time?: ApiTimeContract;
}
