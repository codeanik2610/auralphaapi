import { OverviewCard, OverviewQuickAction, OverviewTab, OperatorJourney } from './PageExperience';
import { SuggestedTradesListResponse, SuggestedTradesSummary } from './SuggestedTrade';

export interface SuggestedTradesExecutionSyncStatus {
  state: 'running' | 'healthy' | 'paused' | 'attention';
  label: string;
  summary: string;
  enabled: boolean;
  tracked: number;
  stale: number;
  terminal: number;
  staleAfterMs: number;
  lastStartedAt?: string;
  lastFinishedAt?: string;
  lastStatus?: string;
  lastError?: string;
  activeRunId?: string;
}

export interface SuggestedTradesOverviewResponse {
  summary: SuggestedTradesSummary;
  suggestedTrades: SuggestedTradesListResponse;
  cards: OverviewCard[];
  tabs: OverviewTab[];
  quickActions: OverviewQuickAction[];
  journey: OperatorJourney;
  syncStatus: SuggestedTradesExecutionSyncStatus;
}
