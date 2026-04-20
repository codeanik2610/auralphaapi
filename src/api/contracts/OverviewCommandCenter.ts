export const OVERVIEW_COMMAND_CENTER_CONTRACT_VERSION =
  'overview-command-center-phase2-2026-04-20' as const;

export type OverviewCommandCenterState = 'ok' | 'attention' | 'blocked' | 'loading' | 'unknown';

export type OverviewCommandCenterTone =
  | 'emerald'
  | 'blue'
  | 'cyan'
  | 'amber'
  | 'red'
  | 'violet'
  | 'slate';

export type OverviewCommandCenterSectionId =
  | 'status'
  | 'actionQueue'
  | 'tradingReadiness'
  | 'alertsSnapshot'
  | 'automationSnapshot'
  | 'bookSnapshot'
  | 'riskSnapshot'
  | 'tradeIdeasSnapshot'
  | 'brokerDataSnapshot'
  | 'opsSnapshot';

export type OverviewCommandCenterSourceType =
  | 'db_snapshot'
  | 'computed_summary'
  | 'internal_health'
  | 'scheduler_output'
  | 'activity_log'
  | 'contract';

export interface OverviewCommandCenterSource {
  type: OverviewCommandCenterSourceType;
  label: string;
  detail: string;
}

export interface OverviewCommandCenterCard {
  id: string;
  label: string;
  value: string | number | boolean | null;
  valueLabel?: string;
  summary?: string;
  unit?: string;
  tone?: OverviewCommandCenterTone;
  trend?: 'up' | 'down' | 'flat' | 'unknown';
}

export interface OverviewCommandCenterItem {
  id: string;
  title: string;
  summary: string;
  meta?: string;
  severity?: string;
  tone?: OverviewCommandCenterTone;
  target?: string;
  source?: string;
  actionLabel?: string;
}

export interface OverviewCommandCenterAction {
  id: string;
  label: string;
  target: string;
  style: 'primary' | 'secondary' | 'danger' | 'link';
}

export interface OverviewCommandCenterSection {
  id: OverviewCommandCenterSectionId;
  title: string;
  summary: string;
  state: OverviewCommandCenterState;
  tone: OverviewCommandCenterTone;
  visibility: 'all' | 'admin';
  cards: OverviewCommandCenterCard[];
  items: OverviewCommandCenterItem[];
  actions: OverviewCommandCenterAction[];
  lastUpdatedAt: string | null;
  source: OverviewCommandCenterSource;
}

export interface OverviewCommandCenterResponse {
  meta: {
    contractVersion: typeof OVERVIEW_COMMAND_CENTER_CONTRACT_VERSION;
    purpose: 'operator_command_center';
    generatedAt: string;
    actor: {
      userId: string;
      role: string;
      isAdmin: boolean;
    };
    dataPolicy: {
      directBrokerCallsOnLoad: false;
      allowedSourceTypes: OverviewCommandCenterSourceType[];
      summary: string;
    };
    query: {
      supported: Array<'selectedSymbol'>;
      ignored: Array<'brokerKey' | 'accountId' | 'liveBrokerProbe'>;
      selectedSymbol: string | null;
    };
    includedSections: OverviewCommandCenterSectionId[];
    redactedSections: OverviewCommandCenterSectionId[];
    degradedSections: OverviewCommandCenterSectionId[];
    summary: string;
  };
  status: OverviewCommandCenterSection;
  actionQueue: OverviewCommandCenterSection;
  tradingReadiness: OverviewCommandCenterSection;
  alertsSnapshot: OverviewCommandCenterSection;
  automationSnapshot: OverviewCommandCenterSection;
  bookSnapshot: OverviewCommandCenterSection;
  riskSnapshot: OverviewCommandCenterSection;
  tradeIdeasSnapshot: OverviewCommandCenterSection;
  brokerDataSnapshot: OverviewCommandCenterSection;
  opsSnapshot: OverviewCommandCenterSection;
}
