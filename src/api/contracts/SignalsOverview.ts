import { OverviewCard, OverviewQuickAction, OverviewTab, OperatorJourney } from './PageExperience';
import { SignalsListResponse, SignalSummary } from './Signal';

export interface SignalsScanStatus {
  schedulerKey?: string;
  state: 'running' | 'healthy' | 'paused' | 'attention';
  label: string;
  summary: string;
  enabled: boolean;
  sources: string[];
  lastStartedAt?: string;
  lastFinishedAt?: string;
  lastStatus?: string;
  lastError?: string;
  activeRunId?: string;
}

export interface SignalsOverviewResponse {
  summary: SignalSummary;
  signals: SignalsListResponse;
  cards: OverviewCard[];
  tabs: OverviewTab[];
  quickActions: OverviewQuickAction[];
  journey: OperatorJourney;
  scanStatus: SignalsScanStatus;
}
