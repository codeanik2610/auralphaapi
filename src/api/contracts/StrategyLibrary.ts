export type StrategyLibraryStatus = 'Draft' | 'Active' | 'Paused' | 'Archived';

export interface StrategyLibraryLifecycle {
  canEdit: boolean;
  canRunManually: boolean;
  isReadOnly: boolean;
  scheduledSignalsEnabled: boolean;
  summary: string;
  allowedTransitions: StrategyLibraryStatus[];
}

export interface StrategyLibraryLatestRun {
  backtestId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface StrategyLibraryRecentRun {
  backtestId: string;
  status: string;
  queuedAt: string;
  completedAt?: string | null;
  updatedAt: string;
  parameter?: string | null;
}

export interface StrategyLibraryItem {
  id: string;
  templateId: string;
  templateName?: string | null;
  templateDescription?: string | null;
  templateStatus?: string | null;
  templateVersion?: number | null;
  templateType?: string | null;
  templateAutomationReady?: boolean;
  templateAutomationReasons?: string[];
  name: string;
  status: StrategyLibraryStatus;
  assets?: Record<string, unknown>[] | null;
  timeframes?: string[] | null;
  overrides?: Record<string, unknown> | null;
  lifecycle: StrategyLibraryLifecycle;
  latestRun?: StrategyLibraryLatestRun | null;
  createdAt: string;
  updatedAt: string;
}

export interface StrategyLibraryListResponse {
  items: StrategyLibraryItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface StrategyLibraryRunsResponse {
  items: StrategyLibraryRecentRun[];
  limit: number;
}

export interface StrategyLibraryUpdateBody {
  name?: string;
  assets?: Record<string, unknown>[] | null;
  timeframes?: string[] | null;
  overrides?: Record<string, unknown> | null;
}

export interface StrategyLibraryImportBody {
  templateId?: string;
  name?: string;
  status?: StrategyLibraryStatus;
  assets?: Record<string, unknown>[] | null;
  timeframes?: string[] | null;
  overrides?: Record<string, unknown> | null;
}

export interface StrategyLibraryStatusUpdateBody {
  status?: StrategyLibraryStatus;
}

export interface StrategyLibraryRunBody {
  assets?: Record<string, unknown>[] | null;
  timeframes?: string[] | null;
  overrides?: Record<string, unknown> | null;
  start?: string | null;
  end?: string | null;
  automationId?: string | null;
  automationRunId?: string | null;
}

export interface StrategyLibraryRunResult {
  id: string;
  backtestId: string;
  status: 'queued' | 'started' | 'completed' | 'failed';
  message: string;
}
