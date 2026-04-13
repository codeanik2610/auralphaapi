export type RuntimeStatus = 'ok' | 'degraded' | 'down' | 'disabled';

export type RuntimeStaleItemType =
  | 'scheduler-command'
  | 'scheduler-run'
  | 'scheduler-lock'
  | 'automation-run'
  | 'activity-export'
  | 'discovery-bot'
  | 'discovery-run'
  | 'discovery-template-improvement';

export interface RuntimeLoopSnapshot {
  key: string;
  label: string;
  enabled: boolean;
  state: 'disabled' | 'idle' | 'running' | 'draining' | 'stopped';
  timerActive: boolean;
  running: boolean;
  stopRequested: boolean;
  pollIntervalMs: number;
  lastStartedAt?: string | null;
  lastFinishedAt?: string | null;
  lastError?: string | null;
  workerId?: string | null;
  detail?: string | null;
}

export interface RuntimeStaleItem {
  id: string;
  type: RuntimeStaleItemType;
  source: 'auralpha' | 'discovery-engine';
  status: string;
  title: string;
  detail?: string | null;
  schedulerKey?: string | null;
  automationId?: string | null;
  userId?: string | null;
  actorUserId?: string | null;
  workerId?: string | null;
  startedAt?: string | null;
  updatedAt?: string | null;
  lastProgressAt?: string | null;
  ageMs?: number | null;
  staleThresholdMs?: number | null;
  repairable: boolean;
  repairAction?: string | null;
}

export interface RuntimeOverviewResponse {
  status: RuntimeStatus;
  timestamp: string;
  staleCounts: {
    total: number;
    schedulerCommands: number;
    schedulerRuns: number;
    schedulerLocks: number;
    automationRuns: number;
    activityExports: number;
    discoveryItems: number;
  };
  worker: {
    status: RuntimeStatus;
    endpoint: string;
    heartbeatStatus?: 'ok' | 'down';
    httpStatus?: 'ok' | 'down';
    workerId?: string | null;
    lastHeartbeatAt?: string | null;
    heartbeatAgeMs?: number | null;
    lastCommandPollAt?: string | null;
    commandPollLagMs?: number | null;
    activeCommandCount?: number | null;
    activeScopeCount?: number | null;
    detail?: string | null;
  };
  emailWorker: {
    status: RuntimeStatus;
    enabled: boolean;
    smtpConfigured: boolean;
    workerId?: string | null;
    workerStatus?: string | null;
    queuedCount?: number | null;
    sendingCount?: number | null;
    failedCount?: number | null;
    activeCount?: number | null;
    lastHeartbeatAt?: string | null;
    heartbeatAgeMs?: number | null;
    detail?: string | null;
  };
  discovery: {
    status: RuntimeStatus;
    endpoint: string;
    workerId?: string | null;
    lifecycleState?: string | null;
    staleThresholdSeconds?: number | null;
    staleBotCount?: number | null;
    staleRunCount?: number | null;
    staleTemplateImprovementCount?: number | null;
    detail?: string | null;
  };
  automations: {
    status: RuntimeStatus;
    total: number;
    running: number;
    paused: number;
    failed: number;
    draft: number;
    activeRuns: number;
    failedRuns24h: number;
    overlapSkips24h: number;
    staleCursorCount: number;
    totalCursorCount: number;
    workerStatus?: string | null;
    heartbeatStatus?: string | null;
    workerHeartbeatAgeMs?: number | null;
    detail?: string | null;
  };
  apiLoops: RuntimeLoopSnapshot[];
  stalePreview: RuntimeStaleItem[];
}

export interface RuntimeStaleItemsResponse {
  timestamp: string;
  total: number;
  items: RuntimeStaleItem[];
}

export interface RuntimeRepairResult {
  repaired: boolean;
  itemType: RuntimeStaleItemType | 'scheduler-requeue';
  id: string;
  status: string;
  message: string;
  item?: RuntimeStaleItem | null;
}
