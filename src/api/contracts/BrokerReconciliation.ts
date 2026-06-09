export interface BrokerReconciliationMatchBody {
  userId: string;
  brokerKey?: string | null;
  accountId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  fallbackWindowMinutes?: number | null;
}

export interface BrokerReconciliationMatchBreakdown {
  fillsMatchedByExecutionOrderId: number;
  fillsMatchedBySubmissionOrderId: number;
  fillsMatchedByPositionId: number;
  fillsMatchedBySymbolTimeSide: number;
  feeEntriesLinked: number;
  fundingEntriesLinked: number;
  walletTransactionsLinked: number;
}

export interface BrokerReconciliationPnlComparison {
  appGrossPnl: number;
  appMatchedGrossPnl: number;
  brokerGrossPnl: number;
  brokerFeeTotal: number;
  brokerFundingTotal: number;
  brokerNetPnl: number;
  grossDelta: number;
  netDeltaVsAppGross: number;
  unmatchedBrokerNotional: number;
  unmatchedBrokerFillCount: number;
  explanation: string[];
}

export interface BrokerReconciliationCoverage {
  appTradeCount: number;
  appMatchedTradeCount: number;
  brokerFillCount: number;
  brokerMatchedFillCount: number;
  brokerUnmatchedFillCount: number;
  matchedFillCoveragePct: number;
  matchedAppTradeCoveragePct: number;
}

export interface BrokerReconciliationSourceRunSummary {
  id: string;
  brokerKey: string;
  accountId: string | null;
  runType: string;
  startedAt: string | null;
  finishedAt: string | null;
  grossPnl: number;
  feesTotal: number;
  fundingTotal: number;
  netPnl: number;
}

export interface BrokerReconciliationMatchResponse {
  runId: string;
  brokerKey: string | null;
  accountId: string | null;
  startedAt: string;
  finishedAt: string;
  matchBreakdown: BrokerReconciliationMatchBreakdown;
  coverage: BrokerReconciliationCoverage;
  pnlComparison: BrokerReconciliationPnlComparison;
  latestSourceRun: BrokerReconciliationSourceRunSummary | null;
}

export interface BrokerReconciliationRunItem {
  id: string;
  userId: string;
  brokerKey: string;
  accountId: string | null;
  runType: string;
  status: string;
  windowStartAt: string | null;
  windowEndAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  counts: {
    fills: number;
    feeEntries: number;
    fundingEntries: number;
    walletTransactions: number;
    balanceSnapshots: number;
  };
  pnl: {
    gross: number | null;
    fees: number | null;
    funding: number | null;
    net: number | null;
    balanceDelta: number | null;
    unmatchedDelta: number | null;
  };
  summary: Record<string, unknown> | null;
  errorMessage: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface BrokerReconciliationRunListResponse {
  items: BrokerReconciliationRunItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface BrokerReconciliationUnmatchedEvidenceItem {
  kind: string;
  id: string;
  brokerKey: string;
  accountId: string | null;
  externalId: string;
  symbol: string | null;
  orderId: string | null;
  positionId: string | null;
  suggestedTradeId: string | null;
  side: string | null;
  amount: number | null;
  quantity: number | null;
  price: number | null;
  occurredAt: string | null;
  matchState: string;
  matchConfidence: string;
  source: string;
  rawPayload: Record<string, unknown> | null;
}

export interface BrokerReconciliationUnmatchedEvidenceResponse {
  items: BrokerReconciliationUnmatchedEvidenceItem[];
  total: number;
  limit: number;
  offset: number;
  kind: string;
}

export interface BrokerReconciliationRunDetailResponse extends BrokerReconciliationRunItem {
  unmatchedEvidencePreview: BrokerReconciliationUnmatchedEvidenceResponse;
}

export interface BrokerReconciliationBatchAccountScope {
  userId?: string | null;
  brokerKey: string;
  accountId: string;
}

export interface BrokerReconciliationBatchBody {
  targetUserIds?: string[] | null;
  brokerKeys?: string[] | null;
  accountIds?: string[] | null;
  accounts?: BrokerReconciliationBatchAccountScope[] | null;
  startDate?: string | null;
  endDate?: string | null;
  fallbackWindowMinutes?: number | null;
  sync?: boolean | null;
  match?: boolean | null;
}

export interface BrokerReconciliationScheduledRunBody extends BrokerReconciliationBatchBody {
  runLogId?: string | null;
  trigger?: string | null;
  force?: boolean | null;
  lockMinutes?: number | null;
  lookbackHours?: number | null;
}

export type BrokerReconciliationBatchStepStatus = 'completed' | 'failed' | 'skipped';

export type BrokerReconciliationBatchAccountStatus =
  | 'completed'
  | 'sync_failed'
  | 'match_failed'
  | 'unsupported_broker'
  | 'skipped';

export interface BrokerReconciliationBatchStepResult {
  status: BrokerReconciliationBatchStepStatus;
  runId: string | null;
  errorMessage: string | null;
}

export interface BrokerReconciliationBatchAccountResult {
  userId: string | null;
  brokerKey: string;
  accountId: string;
  status: BrokerReconciliationBatchAccountStatus;
  sync: BrokerReconciliationBatchStepResult;
  match: BrokerReconciliationBatchStepResult;
}

export interface BrokerReconciliationBatchResponse {
  startedAt: string;
  finishedAt: string;
  requested: {
    sync: boolean;
    match: boolean;
    startDate: string | null;
    endDate: string | null;
    fallbackWindowMinutes: number | null;
  };
  summary: {
    totalAccounts: number;
    completedAccounts: number;
    skippedAccounts: number;
    unsupportedBrokerAccounts: number;
    syncFailedAccounts: number;
    matchFailedAccounts: number;
  };
  results: BrokerReconciliationBatchAccountResult[];
}

export type BrokerReconciliationScheduledRunStatus =
  | 'completed'
  | 'warning'
  | 'failed'
  | 'skipped_disabled'
  | 'skipped_locked';

export interface BrokerReconciliationScheduledRunResponse {
  schedulerKey: string;
  runLogId: string | null;
  status: BrokerReconciliationScheduledRunStatus;
  locked: boolean;
  startedAt: string;
  finishedAt: string;
  window: {
    startDate: string | null;
    endDate: string | null;
    lookbackHours: number;
  };
  batch: BrokerReconciliationBatchResponse | null;
  errorMessage: string | null;
}
