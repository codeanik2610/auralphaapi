export interface DiscoveryTemplateImprovementPolicy {
  discoveryScopeMode?: 'exact_selected_scope';
  batchSizeMode?: 'not_used';
  templateImprovementWindowDays?: number;
  templateImprovementMaxAssets?: number;
  templateImprovementMaxTimeframes?: number;
  templateImprovementMinimumTimeframes?: number;
  templateImprovementFillTimeframes?: string[];
}

export interface DiscoveryTemplateImprovementPolicyContract {
  allowedTimeframes: string[];
  defaults: Required<
    Pick<
      DiscoveryTemplateImprovementPolicy,
      | 'templateImprovementWindowDays'
      | 'templateImprovementMaxAssets'
      | 'templateImprovementMaxTimeframes'
      | 'templateImprovementMinimumTimeframes'
      | 'templateImprovementFillTimeframes'
    >
  >;
  bounds: {
    templateImprovementWindowDays: { min: number; max: number };
    templateImprovementMaxAssets: { min: number; max: number };
    templateImprovementMaxTimeframes: { min: number; max: number };
    templateImprovementMinimumTimeframes: { min: number; max: number };
  };
}

export interface FundsHealthThresholds {
  maxStaleAccounts?: number | null;
  maxMissingAccounts?: number | null;
  maxFailedLatestAttempts?: number | null;
  maxLatestSnapshotAgeMinutes?: number | null;
  maxLatestAttemptAgeMinutes?: number | null;
}

export interface FundsHealthThresholdProfile {
  mode: 'bounded' | 'partial' | 'unbounded';
  configuredThresholdCount: number;
  requiredThresholdCount: number;
  configuredKeys: string[];
  missingKeys: string[];
}

export interface SchedulerConfigResponse {
  key: string;
  name: string;
  description?: string;
  enabled: boolean;
  cronExpression: string;
  timezone: string;
  runAt: string;
  intervalDays: number;
  scheduleMode?: 'daily' | 'every_n_minutes' | 'every_n_seconds' | 'hourly_at_minute';
  intervalMinutes?: number;
  intervalSeconds?: number;
  hourlyMinute?: number;
  batchSize: number;
  schedulerType: 'global' | 'user';
  sources: string[];
  retentionDays: number;
  lookbackDays?: number;
  selectionMode?: 'all' | 'custom';
  selectedAssetIds?: string[];
  timeframes?: string[];
  maxLookbackDays?: number;
  discoveryPolicy?: DiscoveryTemplateImprovementPolicy;
  discoveryPolicyContract?: DiscoveryTemplateImprovementPolicyContract;
  ordersPolicy?: OrdersSchedulerPolicy;
  readModelRecoveryPolicy?: PositionsSchedulerReadModelRecoveryPolicy;
  fundsHealthThresholds?: FundsHealthThresholds;
  time?: SchedulerTimeContract;
  lastStartedAt?: string;
  lastStartedAtIso?: string;
  lastFinishedAt?: string;
  lastFinishedAtIso?: string;
  lastStatus?: string;
  lastError?: string;
}

export interface OrdersSchedulerPolicy {
  lookbackDays: number;
  maxLookbackDays: number;
  historyWindowDays: number;
  incrementalCheckpointOverlapDays: number;
  openOrdersSweepEnabled: boolean;
  staleMissingOpenOrdersCloseEnabled: boolean;
  replayMode: 'checkpoint_reset_then_scoped_run';
}

export interface TemplateImprovementEffectiveScope {
  windowDays?: number;
  windowStart?: string;
  windowEnd?: string;
  requestedAssets?: string[];
  requestedAssetsCount?: number;
  evaluatedAssets?: string[];
  evaluatedAssetsCount?: number;
  requestedTimeframes?: string[];
  evaluatedTimeframes?: string[];
  evaluatedTimeframesCount?: number;
  policyCaps?: {
    maxAssets?: number;
    maxTimeframes?: number;
    minimumTimeframes?: number;
    fillTimeframes?: string[];
  };
}

// Global system scheduler responses freeze the shared time contract in Phase 1.
// Legacy timestamp fields stay backward compatible while raw UTC ISO companions
// and response-level time metadata become explicit for later audit/localization phases.
export interface SchedulerTimeContract {
  displayTimeZone: string;
  storageTimeZone: 'UTC';
  rawTimeFields: 'iso-utc';
  displayTimesLocalized: boolean;
}

export type SchedulerExecutionContext = 'system' | 'user';

export interface SchedulerInitiator {
  type: 'manual' | 'cron' | 'system';
  userId?: string;
  label?: string;
}

export interface SchedulerRunLogItem {
  id: string;
  schedulerKey: string;
  status: string;
  initiatedBy?: SchedulerInitiator;
  executionContext?: SchedulerExecutionContext;
  scopeAssetsCount?: number;
  discoveryPolicy?: DiscoveryTemplateImprovementPolicy;
  discovery?: {
    status?: string;
    userId?: string;
    botId?: string;
    runId?: string;
    submittedAt?: string;
    completedAt?: string;
    syncSource?: 'callback' | 'reconciliation';
    syncReceivedAt?: string;
    outcomeLabel?: string;
    outcomeTone?: 'success' | 'secondary' | 'danger' | 'info';
    errorMessage?: string;
    assetsScanned?: number;
    candidatesGenerated?: number;
    strategiesDiscovered?: number;
    summary?: Record<string, unknown>;
  };
  suggestions?: {
    status?: 'running' | 'completed' | 'failed' | 'skipped';
    syncSource?: 'callback' | 'reconciliation';
    syncReceivedAt?: string;
    startedAt?: string;
    completedAt?: string;
    skippedReason?: string;
    errorMessage?: string;
    templatesEvaluated?: number;
    suggestionsCreated?: number;
    effectiveScope?: TemplateImprovementEffectiveScope;
  };
  startedAt: string;
  startedAtIso?: string;
  finishedAt?: string;
  finishedAtIso?: string;
  durationMs?: number;
  processedAccounts: number;
  insertedAssets: number;
  updatedAssets: number;
  skippedAssets: number;
  errorMessage?: string;
  progress?: {
    total: number;
    processed: number;
    percent: number;
    etaSeconds?: number;
    currentItem?: {
      symbol?: string;
      assetId?: string;
      id?: string;
    };
  };
}

export interface SchedulerRunLogListResponse {
  items: SchedulerRunLogItem[];
  total: number;
  limit: number;
  offset: number;
  time?: SchedulerTimeContract;
}

export interface SchedulerRunUpdateLogItem {
  id: string;
  runLogId: string;
  initiatedBy?: SchedulerInitiator;
  executionContext?: SchedulerExecutionContext;
  source: string;
  accountId?: string;
  connectionId?: string;
  actionType: string;
  symbol?: string;
  externalId?: string;
  assetId?: string;
  message?: string;
  detail?: Record<string, unknown>;
  createdAt: string;
  createdAtIso?: string;
}

export interface SchedulerRunUpdateLogListResponse {
  items: SchedulerRunUpdateLogItem[];
  total: number;
  limit: number;
  offset: number;
  time?: SchedulerTimeContract;
}

export type SchedulerAssetUpdateLogItem = SchedulerRunUpdateLogItem;
export type SchedulerAssetUpdateLogListResponse = SchedulerRunUpdateLogListResponse;

export interface SchedulerAssetItem {
  id: string;
  symbol: string;
  source: string;
}

export interface SchedulerAssetListResponse {
  items: SchedulerAssetItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface SchedulerAssetSyncStateItem {
  id: string;
  assetId: string;
  symbol: string;
  source: string;
  syncedFrom?: string;
  syncedFromIso?: string;
  syncedTo?: string;
  syncedToIso?: string;
  pendingDays: number;
  lastSyncedAt?: string;
  lastSyncedAtIso?: string;
}

export interface SchedulerAssetSyncStateListResponse {
  items: SchedulerAssetSyncStateItem[];
  total: number;
  limit: number;
  offset: number;
  time?: SchedulerTimeContract;
}

export interface SchedulerRecordSyncStateItem {
  accountId: string;
  userId: string;
  ownerUserId?: string;
  brokerKey: string;
  checkpointAt?: string;
  snapshotRows?: number;
  readModelRows?: number;
  rowsMissingFromReadModel?: number;
  rowsBehindSnapshot?: number;
  orphanReadModelRows?: number;
  latestSnapshotSeenAt?: string;
  latestReadModelSeenAt?: string;
  readModelState?: 'empty' | 'synced' | 'missing' | 'behind' | 'orphaned';
  readModelNeedsRebuild?: boolean;
  pendingRecords: number;
  failedRecords: number;
  resolvedRecords: number;
  nextRetryAt?: string;
  lastPendingUpdateAt?: string;
}

export interface SchedulerRecordSyncStateListResponse {
  items: SchedulerRecordSyncStateItem[];
  total: number;
  limit: number;
  offset: number;
  time?: SchedulerTimeContract;
}

export interface SchedulerRuntimeFoundationStatus {
  status: 'ready' | 'missing';
  migrationName: string;
  requiredTables: string[];
  requiredColumns: string[];
  missingParts?: string[];
  note?: string;
}

export interface SchedulerRecordSyncSummaryResponse {
  schedulerKey: string;
  totalAccounts: number;
  accountsWithCheckpoint: number;
  accountsWithoutCheckpoint: number;
  accountsWithSnapshotData?: number;
  accountsWithoutSnapshotData?: number;
  accountsWithReadModel?: number;
  accountsWithoutReadModel?: number;
  accountsWithReadModelDrift?: number;
  accountsWithPending: number;
  accountsWithFailed: number;
  accountsWithRetryScheduled: number;
  snapshotRows?: number;
  readModelRows?: number;
  rowsMissingFromReadModel?: number;
  rowsBehindSnapshot?: number;
  orphanReadModelRows?: number;
  pendingRecords: number;
  failedRecords: number;
  resolvedRecords: number;
  oldestCheckpointAt?: string;
  oldestCheckpointAgeHours?: number;
  latestCheckpointAt?: string;
  latestSnapshotSeenAt?: string;
  latestReadModelSeenAt?: string;
  latestPendingUpdateAt?: string;
  nextRetryAt?: string;
  runtimeFoundation?: SchedulerRuntimeFoundationStatus;
  time?: SchedulerTimeContract;
}

export interface SchedulerRiskDiagnosticsBlockerItem {
  blocker:
    | 'missing_snapshot'
    | 'missing_funds_snapshot'
    | 'missing_positions_snapshot'
    | 'stale_snapshot';
  label: string;
  count: number;
}

export interface SchedulerRiskDiagnosticsLatestRunSummary {
  id: string;
  status: string;
  initiatedBy?: SchedulerInitiator;
  executionContext?: SchedulerExecutionContext;
  startedAt?: string;
  startedAtIso?: string;
  finishedAt?: string;
  finishedAtIso?: string;
  targetedUsers: number;
  refreshedUsers: number;
  failedUsers: number;
}

export interface SchedulerRiskDiagnosticsSummaryResponse {
  schedulerKey: string;
  usersTargeted: number;
  usersWithFreshSnapshot: number;
  usersMissingSnapshot: number;
  usersWithSourceBlockers: number;
  latestSnapshotAt?: string;
  latestSnapshotAtIso?: string;
  latestSnapshotAgeMinutes?: number;
  latestControlAt?: string;
  latestControlAtIso?: string;
  latestAlertAt?: string;
  latestAlertAtIso?: string;
  latestScenarioAt?: string;
  latestScenarioAtIso?: string;
  latestRun: SchedulerRiskDiagnosticsLatestRunSummary | null;
  blockers: SchedulerRiskDiagnosticsBlockerItem[];
  time?: SchedulerTimeContract;
}

export interface SchedulerFundsLatestRunSummary {
  id: string;
  status: string;
  startedAt?: string;
  finishedAt?: string;
  targetedAccounts: number;
  refreshedAccounts: number;
  failedAccounts: number;
}

export interface SchedulerFundsDiagnosticsSummaryResponse {
  schedulerKey: string;
  timezone: string;
  localDate: string;
  totalConnectedAccounts: number;
  accountsWithFreshSnapshot: number;
  accountsWithStaleSnapshot: number;
  accountsMissingSnapshot: number;
  accountsWithFailedLatestAttempt: number;
  accountsWithSuccessfulLatestAttempt: number;
  latestObservedSnapshotAt?: string;
  latestObservedSnapshotAgeMinutes?: number;
  latestAttemptAt?: string;
  latestAttemptAgeMinutes?: number;
  lastSuccessfulRun: SchedulerFundsLatestRunSummary | null;
  fundsHealthThresholds?: FundsHealthThresholds;
  fundsHealthThresholdProfile?: FundsHealthThresholdProfile;
  runtimeFoundation?: SchedulerRuntimeFoundationStatus;
  recoveryRunSupported: boolean;
  recoveryRunScope: 'account';
  recoveryRunReason?: string;
  runUpdatesSupported: boolean;
  runUpdatesSupportState: 'not_emitted';
  runUpdatesReason: string;
}

export interface SchedulerFundsCoverageItem {
  accountId: string;
  accountName: string;
  accountKey: string;
  brokerKey: string;
  accountStatus: string;
  freshnessState: 'fresh' | 'stale' | 'missing';
  latestSnapshotDate?: string;
  latestObservedAt?: string;
  latestObservedAgeMinutes?: number;
  latestFetchStatus?: 'success' | 'failed';
  latestAttemptAt?: string;
  latestAttemptAgeMinutes?: number;
  latestError?: string;
  latestSource?: string;
  walletSnapshotAvailable: boolean;
  futuresSnapshotAvailable: boolean;
  needsAttention: boolean;
}

export interface SchedulerFundsCoverageListResponse {
  items: SchedulerFundsCoverageItem[];
  total: number;
  limit: number;
  offset: number;
  timezone: string;
  localDate: string;
}

export interface SchedulerRunUpdatesExportResponse {
  fileName: string;
  rowCount: number;
  csv: string;
}

export interface SchedulerPurgeLogsResponse {
  message: string;
  retentionDays: number;
  runLogsDeleted: number;
  updateLogsDeleted: number;
}

export interface SchedulerPurgePreviewResponse {
  retentionDays: number;
  runLogsToDelete: number;
  updateLogsToDelete: number;
}

export interface UpdateSchedulerConfigBody {
  name?: string;
  description?: string | null;
  enabled?: boolean;
  cronExpression?: string;
  runAt?: string;
  intervalDays?: number;
  scheduleMode?: 'daily' | 'every_n_minutes' | 'every_n_seconds' | 'hourly_at_minute';
  intervalMinutes?: number;
  intervalSeconds?: number;
  hourlyMinute?: number;
  batchSize?: number;
  schedulerType?: 'global' | 'user';
  sources?: string[];
  retentionDays?: number;
  selectionMode?: 'all' | 'custom';
  selectedAssetIds?: string[];
  timeframes?: string[];
  discoveryPolicy?: DiscoveryTemplateImprovementPolicy;
  fundsHealthThresholds?: FundsHealthThresholds | null;
  maxLookbackDays?: number;
  lookbackDays?: number;
}

export interface OrdersSchedulerRunNowBody {
  accountId?: string;
  brokerKey?: string;
  resetCheckpoint?: boolean;
}

export interface FundsSchedulerRunNowBody {
  accountId?: string;
  brokerKey?: string;
}

export interface PositionsSchedulerReadModelRebuildBody {
  accountId?: string;
  ownerUserId?: string;
  brokerKey?: string;
  onlyDrifted?: boolean;
  limit?: number;
  rebuildAll?: boolean;
}

export interface PositionsSchedulerReadModelRebuildScopeItem {
  userId: string;
  accountId: string;
  brokerKey: string;
  snapshotRows: number;
  deletedReadModelRows: number;
  insertedReadModelRows: number;
}

export interface PositionsSchedulerReadModelCoverageSnapshot {
  totalAccounts: number;
  accountsWithSnapshotData: number;
  accountsWithoutSnapshotData: number;
  accountsWithReadModel: number;
  accountsWithoutReadModel: number;
  accountsWithReadModelDrift: number;
  snapshotRows: number;
  readModelRows: number;
  rowsMissingFromReadModel: number;
  rowsBehindSnapshot: number;
  orphanReadModelRows: number;
  latestSnapshotSeenAt?: string;
  latestReadModelSeenAt?: string;
}

export interface PositionsSchedulerReadModelRecoveryPolicy {
  supported: boolean;
  supportedScopes: Array<'account' | 'owner' | 'broker' | 'all'>;
  recommendedScopeOrder: Array<'account' | 'owner' | 'broker' | 'all'>;
  confirmationRequiredScopes: Array<'owner' | 'broker' | 'all'>;
  confirmationRequiredAboveAccounts: number;
  defaultOnlyDrifted: boolean;
  allowRebuildAll: boolean;
  maxScopedAccounts: number;
  cliCommand: string;
  runbookPath: string;
  adminSurface: string;
  productTrustSurface: string;
}

export interface PositionsSchedulerReadModelRecoveryHistoryItem {
  id: string;
  recoveryId: string;
  time: string;
  title: string;
  status: 'Success' | 'Warning' | 'Failed';
  state: 'applied' | 'noop' | 'failed';
  scope: 'account' | 'owner' | 'broker' | 'all';
  actor?: string;
  message: string;
  requestedAccounts: number;
  targetedAccounts: number;
  processedAccounts: number;
  skippedAccounts: number;
  deletedReadModelRows: number;
  insertedReadModelRows: number;
  snapshotRowsProcessed: number;
  beforeDriftAccounts: number;
  afterDriftAccounts: number;
  warnings: string[];
  recommendedNextStep?: string;
  filters: {
    accountId?: string;
    ownerUserId?: string;
    brokerKey?: string;
    limit?: number;
  };
}

export interface PositionsSchedulerReadModelRecoveryHistoryResponse {
  items: PositionsSchedulerReadModelRecoveryHistoryItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface PositionsSchedulerReadModelRebuildResponse {
  queued: false;
  action: 'rebuild_read_model';
  state: 'applied' | 'noop';
  recoveryId?: string;
  scope: 'account' | 'owner' | 'broker' | 'all';
  onlyDrifted: boolean;
  requestedAccounts: number;
  targetedAccounts: number;
  performedAt: string;
  message: string;
  warnings: string[];
  recommendedNextStep: string;
  filters: {
    accountId?: string;
    ownerUserId?: string;
    brokerKey?: string;
    limit?: number;
  };
  beforeCoverage: PositionsSchedulerReadModelCoverageSnapshot;
  afterCoverage: PositionsSchedulerReadModelCoverageSnapshot;
  historyEntry?: PositionsSchedulerReadModelRecoveryHistoryItem;
  rebuildResult: {
    requestedAccounts: number;
    processedAccounts: number;
    skippedAccounts: number;
    deletedReadModelRows: number;
    insertedReadModelRows: number;
    snapshotRowsProcessed: number;
    skippedAccountIds: string[];
    scopes: PositionsSchedulerReadModelRebuildScopeItem[];
  };
}

export interface SchedulerRunNowResponse {
  queued: boolean;
  executionMode: 'direct' | 'queue';
  started: boolean;
  runId?: string;
  jobId?: string;
  scopeAssetsCount?: number;
  message: string;
}

export interface SchedulerControlResponse {
  queued: boolean;
  action: 'pause' | 'resume' | 'stop' | 'restart';
  message: string;
  state?: 'queued' | 'applied' | 'noop';
  commandIds?: string[];
}

export interface SchedulerStatusSyncResponse {
  updated: boolean;
  runId: string;
  status: string;
  message: string;
}

export interface SchedulerRunProgressResponse {
  run: SchedulerRunLogItem | null;
  time?: SchedulerTimeContract;
}

export interface SchedulerOverviewRunSnapshot {
  id: string;
  status: string;
  initiatedBy?: SchedulerInitiator;
  executionContext?: SchedulerExecutionContext;
  startedAt?: string;
  startedAtIso?: string;
  finishedAt?: string;
  finishedAtIso?: string;
  durationMs?: number;
  processedAccounts: number;
  insertedAssets: number;
  updatedAssets: number;
  skippedAssets: number;
  errorMessage?: string;
  progress?: SchedulerRunLogItem['progress'];
}

export interface SchedulerOverviewOpsSnapshot {
  activeStatus: 'running' | 'queued' | 'idle' | 'failed';
  hasQueuedWork: boolean;
  latestRunId?: string;
  latestRunStatus?: string;
  latestOutcome?: string;
  latestError?: string;
  latestFinishedAt?: string;
  latestFinishedAtIso?: string;
}

export interface SchedulerOverviewItem {
  key: string;
  name: string;
  enabled: boolean;
  status: 'running' | 'queued' | 'idle' | 'failed';
  hasQueuedWork?: boolean;
  initiatedBy?: SchedulerInitiator;
  executionContext?: SchedulerExecutionContext;
  runId?: string;
  startedAt?: string;
  startedAtIso?: string;
  queuedAt?: string;
  queuedAtIso?: string;
  lastStatus?: string;
  lastError?: string;
  lastFinishedAt?: string;
  lastFinishedAtIso?: string;
  recentRun?: SchedulerOverviewRunSnapshot;
  ops?: SchedulerOverviewOpsSnapshot;
  progress?: {
    total: number;
    processed: number;
    percent: number;
    etaSeconds?: number;
    currentItem?: {
      symbol?: string;
      assetId?: string;
      id?: string;
    };
  };
}

export interface SchedulerOverviewResponse {
  items: SchedulerOverviewItem[];
  time?: SchedulerTimeContract;
}
