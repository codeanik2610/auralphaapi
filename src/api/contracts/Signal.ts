import type { AlertItem } from './Alert';
import type { ItemFreshness, LinkedEntityReference } from './UiState';

export type SignalStatus = 'Triggered' | 'Watching' | 'Queued' | 'Muted';
export type SignalDirection = 'Long' | 'Short';
export type SignalPromoteTarget = 'strategy' | 'execution_queue' | 'alerts' | 'automations';
export type SignalSourceRefType = 'strategy_library' | 'strategy_lab';
export type SignalScanSourceStatus = 'completed' | 'partial' | 'skipped' | 'failed';
export type SignalViewMode = 'inbox' | 'clustered' | 'muted';
export type SignalQueueStage = 'inbox' | 'clustered' | 'muted';
export type SignalJourneyStage = 'signal_detected' | 'signal_review' | 'signal_queued' | 'signal_muted';
export type SignalPageAction =
  | 'acknowledge'
  | 'mute'
  | 'promote_strategy'
  | 'promote_execution_queue'
  | 'promote_alerts'
  | 'promote_automations';

export interface SignalItem {
  id: string;
  symbol: string;
  source: string;
  confidence: number;
  direction: SignalDirection;
  timeframe: string;
  status: SignalStatus;
  regime: string;
  aiScore: number;
  thesis: string;
  route: string;
  createdAt: string;
  updatedAt: string;
  market?: string;
  signalTime?: string;
  entryPrice?: number | null;
  sourceRefType?: SignalSourceRefType;
  sourceRefId?: string;
  expiresAt?: string | null;
  riskNote?: string;
  promotionState?: string;
  metadata?: Record<string, unknown> | null;
  clusterCount?: number;
  clusterTriggeredCount?: number;
  clusterWatchingCount?: number;
  clusterQueuedCount?: number;
  clusterLatestSignalTime?: string;
  clusterStrongestConfidence?: number;
  alerts?: AlertItem[];
  allowedActions?: SignalPageAction[];
  statusReason?: string;
  statusDisplay?: string;
  freshness?: ItemFreshness;
  linkedEntities?: LinkedEntityReference[];
  queueStage?: SignalQueueStage;
  journeyStage?: SignalJourneyStage;
}

export interface SignalsListResponse {
  items: SignalItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface SignalSummary {
  liveSignals: number;
  triggered: number;
  watching: number;
  queued: number;
  muted: number;
  highConfidence: number;
  mutedOrQueued: number;
}

export interface SignalStatusActionResult {
  message: string;
  signal: {
    id: string;
    status: SignalStatus;
    updatedAt: string;
  };
}

export interface SignalPromoteActionResult {
  message: string;
  signalId: string;
  target: SignalPromoteTarget;
  targetId: string;
  targetName?: string;
  targetUrl?: string;
  targetEntity?: string;
  meta?: Record<string, unknown> | null;
}

export interface SignalScanSourceResult {
  sourceRefType: SignalSourceRefType;
  sourceRefId: string;
  name: string;
  status: SignalScanSourceStatus;
  symbols: number;
  timeframes: string[];
  evaluationsRun: number;
  evaluatedSymbols: number;
  detectedSignals: number;
  issues: string[];
}

export interface SignalScanRunResult {
  message: string;
  scannedSources: number;
  skippedSources: number;
  evaluationsRun: number;
  evaluatedSymbols: number;
  detectedSignals: number;
  insertedSignals: number;
  updatedSignals: number;
  sources: SignalScanSourceResult[];
}
