export type AutomationStatus = 'Running' | 'Paused' | 'Failed' | 'Draft';
export type AutomationType = 'trade-suggestion' | 'backtest-runner';
export type LegacyAutomationType = 'strategy' | 'strategy-library';

export interface AutomationTemplateDiffSummary {
  changedCount: number;
  inheritedCount: number;
  changedFields: string[];
}

export interface AutomationLineage {
  source?: string | null;
  backtestId?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  libraryId?: string | null;
  libraryName?: string | null;
  projectId?: string | null;
  projectVersion?: number | null;
  templateId?: string | null;
  templateName?: string | null;
  templateVersion?: number | null;
  sourceTemplateId?: string | null;
  sourceTemplateName?: string | null;
  sourceTemplateVersion?: number | null;
  templateDiffSummary?: AutomationTemplateDiffSummary | null;
}

export interface AutomationEvent {
  id: string;
  type: string;
  entity: string;
  time: string;
  outcome: string;
  lineage?: AutomationLineage | null;
}

export interface AutomationAlert {
  id: string;
  message: string;
  time: string;
  severity: string;
  status: string;
  lineage?: AutomationLineage | null;
}

export interface AutomationItem {
  id: string;
  automationType?: AutomationType;
  name: string;
  strategy: string;
  broker: string;
  market: string;
  trigger: string;
  status: AutomationStatus;
  lastRun: string;
  nextRun: string;
  timeZone?: string | null;
  schedule?: Record<string, unknown> | null;
  accounts: number;
  riskMode: string;
  config?: Record<string, unknown> | null;
  lineage?: AutomationLineage | null;
  updatedAt?: string;
  events?: AutomationEvent[];
  alerts?: AutomationAlert[];
}

export interface AutomationsListResponse {
  items: AutomationItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface AutomationsSummary {
  running: number;
  paused: number;
  connectedAccounts: number;
  health: string;
  healthStatus?: 'ok' | 'degraded' | 'down';
  diagnostics?: {
    workerStatus: 'ok' | 'degraded' | 'down';
    workerHttpStatus?: 'ok' | 'down';
    heartbeatStatus?: 'ok' | 'down';
    workerDetail?: string | null;
    workerHeartbeatAgeMs?: number | null;
    commandPollLagMs?: number | null;
    queueStatus: 'ok' | 'down';
    queueLatencyMs?: number | null;
    activeRuns: number;
    failedRuns24h: number;
    overlapSkips24h: number;
    staleCursorCount: number;
    totalCursorCount: number;
    staleCursorThresholdMinutes: number;
    lastCursorAt?: string | null;
    lastTriggeredSignalAt?: string | null;
  };
}

export interface AutomationActionResult {
  message: string;
  automation: {
    id: string;
    status: AutomationStatus;
    updatedAt: string;
  };
}

export interface AutomationDeleteImpact {
  automationEvents: number;
  automationAlerts: number;
  automationRuns: number;
  activeRuns: number;
  automationRunOutputs: number;
  automationCursors: number;
  suggestedTrades: number;
  openSuggestedTrades: number;
  acceptedSuggestedTrades: number;
  activeSuggestedTradeExecutions: number;
}

export interface AutomationDeleteNotice {
  code: string;
  message: string;
  severity: 'blocking' | 'warning';
  count?: number;
}

export interface AutomationDeletePreview {
  automation: {
    id: string;
    name: string;
    status: AutomationStatus;
    automationType?: AutomationType;
    strategy: string;
    trigger: string;
    updatedAt: string;
  };
  impact: AutomationDeleteImpact;
  blockers: AutomationDeleteNotice[];
  warnings: AutomationDeleteNotice[];
  canDelete: boolean;
  requiredConfirmName: string;
  requiredConfirmPhrase: 'DELETE AUTOMATION';
  previewToken: string;
  expiresAt: string;
}

export interface AutomationHardDeleteResult {
  message: string;
  deletedAutomationId: string;
  deletedAutomationName: string;
  deletedAt: string;
  impact: AutomationDeleteImpact;
  retainedSuggestedTrades: number;
}

export interface AutomationRunItem {
  id: string;
  status: string;
  scheduledFor?: string;
  scheduledForIso?: string;
  startedAt: string;
  startedAtIso?: string;
  finishedAt?: string;
  finishedAtIso?: string;
  durationMs?: number | null;
  errorMessage?: string | null;
  backtestId?: string | null;
  backtestStatus?: string | null;
  backtestProgress?: Record<string, unknown> | null;
  resultSummary?: Record<string, unknown> | null;
  trigger?: string | null;
  lineage?: AutomationLineage | null;
  recovery?: {
    active: boolean;
    canReconcile: boolean;
    canRetry: boolean;
    isStaleCandidate: boolean;
    staleThresholdMinutes?: number | null;
    note?: string | null;
  } | null;
}

export interface AutomationRunListResponse {
  items: AutomationRunItem[];
  total: number;
  limit: number;
  offset: number;
}
