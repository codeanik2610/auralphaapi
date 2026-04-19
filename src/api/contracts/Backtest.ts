import type { AutomationStatus } from './Automation';

export type BacktestStatus = string;
export type BacktestRunStatus = 'Queued' | 'Running' | 'Completed' | 'Failed';

export interface BacktestTemplateDiffSummary {
  changedCount: number;
  inheritedCount: number;
  changedFields: string[];
}

export interface BacktestLineage {
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
  templateDiffSummary?: BacktestTemplateDiffSummary | null;
}

export interface BacktestProgressItem {
  symbol?: string | null;
  timeframe?: string | null;
  status?: string | null;
  totalTrades?: number | null;
}

export interface BacktestProgress {
  state?: string | null;
  processed: number;
  total: number;
  percent?: number | null;
  etaSeconds?: number | null;
  startedAt?: string | null;
  updatedAt?: string | null;
  finishedAt?: string | null;
  assetsCount?: number | null;
  timeframesCount?: number | null;
  combinationsCount?: number | null;
  okCount?: number | null;
  failedCount?: number | null;
  noDataCount?: number | null;
  skippedCount?: number | null;
  tradeEventCount?: number | null;
  latestItem?: BacktestProgressItem | null;
  error?: string | null;
  resumeCount?: number | null;
  resumedFromCheckpoint?: boolean | null;
}

export interface BacktestExecutionAssumptions {
  feesPct?: number | null;
  slippagePct?: number | null;
  spreadPct?: number | null;
  latencyBars?: number | null;
  fillPolicy?: string | null;
  participationPct?: number | null;
  capitalUtilizationPct?: number | null;
  leverage?: number | null;
  startingCapital?: number | null;
  haltOnCapitalDepletion?: boolean | null;
  simulationMode?: string | null;
}

export interface BacktestPortfolioSummary {
  evaluationMethod?: string | null;
  startingCapital?: number | null;
  endingCapital?: number | null;
  realizedPnlAmount?: number | null;
  portfolioReturnPct?: number | null;
  candidateTrades?: number | null;
  executedTrades?: number | null;
  skippedTrades?: number | null;
  partialAllocationTrades?: number | null;
  blockedByDepletionCount?: number | null;
  peakConcurrentTrades?: number | null;
  peakReservedCapitalPct?: number | null;
  averageReservedCapitalPct?: number | null;
  averageAllocationFillRatio?: number | null;
  capitalDepleted?: boolean | null;
  haltOnCapitalDepletion?: boolean | null;
}

export interface BacktestPortfolioPressure {
  setupKey?: string | null;
  templateId?: string | null;
  symbol?: string | null;
  timeframe?: string | null;
  candidateTrades?: number | null;
  executedTrades?: number | null;
  skippedTrades?: number | null;
  partialAllocationTrades?: number | null;
  overlapTrades?: number | null;
  blockedByDepletionCount?: number | null;
  averageAllocationFillRatio?: number | null;
  executedTradeRatio?: number | null;
  overlapTradeRatio?: number | null;
  partialAllocationRate?: number | null;
  pressureScore?: number | null;
  pressureState?: string | null;
  capitalDepletionRisk?: boolean | null;
  reasons?: string[];
}

export interface BacktestRobustnessSplit {
  splitMethod?: string | null;
  splitRatio?: number | null;
  splitTimestamp?: number | null;
  inSampleTrades?: number | null;
  inSampleReturnPct?: number | null;
  inSampleWinRate?: number | null;
  inSampleProfitFactor?: number | null;
  outOfSampleTrades?: number | null;
  outOfSampleReturnPct?: number | null;
  outOfSampleWinRate?: number | null;
  outOfSampleProfitFactor?: number | null;
  returnRetentionRatio?: number | null;
  promotionReady?: boolean | null;
  reasons?: string[];
}

export interface BacktestRobustness {
  evaluationMethod?: string | null;
  primarySplitRatio?: number | null;
  splitMethod?: string | null;
  splitTimestamp?: number | null;
  inSampleTrades?: number | null;
  inSampleReturnPct?: number | null;
  inSampleWinRate?: number | null;
  inSampleProfitFactor?: number | null;
  outOfSampleTrades?: number | null;
  outOfSampleReturnPct?: number | null;
  outOfSampleWinRate?: number | null;
  outOfSampleProfitFactor?: number | null;
  returnRetentionRatio?: number | null;
  walkForwardSplitCount?: number | null;
  walkForwardPassingSplitCount?: number | null;
  walkForwardPassRate?: number | null;
  averageOutOfSampleTrades?: number | null;
  averageOutOfSampleReturnPct?: number | null;
  averageOutOfSampleProfitFactor?: number | null;
  averageReturnRetentionRatio?: number | null;
  worstOutOfSampleReturnPct?: number | null;
  positiveOutOfSampleSplitCount?: number | null;
  consistencyScore?: number | null;
  robustnessScore?: number | null;
  promotionReady?: boolean | null;
  reasons?: string[];
  walkForwardSplits?: BacktestRobustnessSplit[];
}

export interface BacktestResumeCheckpointSummary {
  processed?: number | null;
  okCount?: number | null;
  failedCount?: number | null;
  noDataCount?: number | null;
  skippedCount?: number | null;
}

export interface BacktestResumeCheckpoint {
  state?: string | null;
  startedAt?: string | null;
  lastUpdatedAt?: string | null;
  finishedAt?: string | null;
  error?: string | null;
  resumeCount?: number | null;
  resumedFromCheckpoint?: boolean | null;
  completedCombinations?: number | null;
  totalCombinations?: number | null;
  tradeEventCount?: number | null;
  resultsSummary?: BacktestResumeCheckpointSummary | null;
}

export interface BacktestTopSetupItem {
  id: string;
  dedupeKey: string;
  backtestId: string;
  backtestName: string;
  strategy: string;
  parameter: string;
  symbol: string;
  timeframe: string;
  score: number | null;
  trades: number;
  winRate: number | null;
  profitFactor: number | null;
  returnPct: number | null;
  maxDrawdownPct: number | null;
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
  lineage?: BacktestLineage | null;
  dateRangeStart?: string | null;
  dateRangeEnd?: string | null;
  hasIncompleteTradeHistory: boolean;
  templateAutomationReady?: boolean;
  templateAutomationReasons?: string[];
  eligibleForAutomation: boolean;
  automationEligibilityReasons: string[];
  generatedAt?: string | null;
  createdAt?: string | null;
  robustness?: BacktestRobustness | null;
  portfolioAdjustedScore?: number | null;
  portfolioPressure?: BacktestPortfolioPressure | null;
}

export interface BacktestItem {
  id: string;
  name: string;
  strategy: string;
  symbol: string;
  parameter: string;
  cagr: string;
  sharpe: string;
  drawdown: string;
  trades: number;
  status: BacktestStatus;
  runStatus: BacktestRunStatus;
  assessmentStatus: string;
  winRate: string;
  profitFactor: string;
  stability: string;
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
  sourceTemplateVersion?: number | null;
  sourceTemplateName?: string | null;
  lineage?: BacktestLineage | null;
  dateRangeStart?: string | null;
  dateRangeEnd?: string | null;
  templateDiffSummary?: BacktestTemplateDiffSummary | null;
  templateAutomationReady?: boolean;
  templateAutomationReasons?: string[];
  expectedTradeEvents?: number | null;
  storedTradeEvents?: number | null;
  hasIncompleteTradeHistory?: boolean;
  progress?: BacktestProgress | null;
  resumeCheckpoint?: BacktestResumeCheckpoint | null;
  executionAssumptions?: BacktestExecutionAssumptions | null;
  portfolioSummary?: BacktestPortfolioSummary | null;
  performanceSurface?: unknown;
  createdAt?: string;
}

export interface BacktestTradeEvent {
  id?: string;
  symbol: string;
  interval: string;
  side: 'BUY' | 'SELL';
  entryTime: number;
  entryPrice: number;
  exitTime?: number | null;
  exitPrice?: number | null;
}

export interface BacktestChartWindow {
  startTime?: string | null;
  endTime: string;
  lookbackDays: number;
}

export interface BacktestChartTradeCoverage {
  symbol: string;
  interval: string;
  expectedTradeEvents?: number | null;
  storedTradeEvents: number;
  chartTradeEvents: number;
  missingTradeEvents?: number | null;
  hasIncompleteTradeHistory: boolean;
}

export interface BacktestChartResponse {
  symbol: string;
  interval: string;
  window: BacktestChartWindow;
  candles: Array<{
    openTime: number;
    open: string;
    high: string;
    low: string;
    close: string;
    volume: string;
  }>;
  trades: BacktestTradeEvent[];
  tradeCoverage: BacktestChartTradeCoverage;
}

export interface BacktestInputSnapshotExport {
  schemaVersion: number;
  exportedAt: string;
  backtest: {
    id: string;
    name: string;
    parameter: string;
    strategy: string;
    symbol: string;
    status: string;
    runStatus: BacktestRunStatus;
    assessmentStatus: string;
    createdAt: string;
  };
  lineage: BacktestLineage;
  dateRange: {
    start?: string | null;
    end?: string | null;
  };
  executionAssumptions?: BacktestExecutionAssumptions | null;
  inputs: Record<string, unknown>;
}

export interface BacktestInputSnapshotResponse {
  backtestId: string;
  fileName: string;
  generatedAt: string;
  snapshot: BacktestInputSnapshotExport;
}

export interface BacktestsListResponse {
  items: BacktestItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface BacktestsTopSetupsResponse {
  items: BacktestTopSetupItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface BacktestsSummary {
  activeRuns: number;
  bestCagr: string;
  bestCagrLabel: string;
  bestSharpe: string;
  maxDrawdown: string;
}

export interface UpdateBacktestResultBody {
  status?: string;
  runStatus?: string;
  stability?: string | null;
  assessmentStatus?: string | null;
  trades?: number;
  cagr?: number;
  sharpe?: number;
  drawdown?: number;
  winRate?: number;
  profitFactor?: number;
  performanceSurface?: unknown;
  config?: Record<string, unknown> | null;
  tradeEvents?: BacktestTradeEvent[];
}

export interface CreateBacktestBody {
  universe?: string;
  interval?: string;
  capital?: string;
  fees?: string;
  slippage?: string;
  spread?: string;
  latencyBars?: string | number;
  fillPolicy?: string;
  participationPct?: string | number;
  capitalUtilizationPct?: string | number;
  leverage?: string | number;
  startingCapital?: string | number;
  haltOnCapitalDepletion?: boolean;
  dateRange?: string;
  benchmark?: string;
  includeExtended?: boolean;
  usePaperGate?: boolean;
}

export interface CreateBacktestResult {
  message: string;
  backtest: {
    id: string;
    status: BacktestStatus;
    createdAt: string;
  };
}

export interface RecoverBacktestResult {
  message: string;
  backtest: BacktestItem;
}

export interface BacktestAutomationSyncResult {
  synced: boolean;
  backtestId: string;
  automationId?: string | null;
  automationRunId?: string | null;
  message: string;
}

export interface PromoteBacktestBody {
  name?: string;
  broker?: string;
  trigger?: string;
  riskMode?: string;
  status?: AutomationStatus;
  symbol?: string;
  timeframe?: string;
  timeZone?: string | null;
  schedule?: Record<string, unknown> | null;
}

export interface PromoteBacktestBatchItemBody {
  backtestId?: string;
  symbol: string;
  timeframe: string;
  name?: string;
}

export interface PromoteBacktestBatchBody {
  name?: string;
  broker?: string;
  trigger?: string;
  riskMode?: string;
  status?: AutomationStatus;
  timeZone?: string | null;
  schedule?: Record<string, unknown> | null;
  items: PromoteBacktestBatchItemBody[];
}

export interface PromoteBacktestResult {
  message: string;
  automation: {
    id: string;
    status: AutomationStatus;
    createdAt: string;
  };
}

export interface PromoteBacktestBatchResultItem {
  symbol?: string;
  symbols?: string[];
  timeframe: string;
  itemCount?: number;
  status: 'created' | 'reused' | 'failed';
  message: string;
  automation?: {
    id: string;
    status: AutomationStatus;
    createdAt: string;
  } | null;
}

export interface PromoteBacktestBatchResult {
  message: string;
  summary: {
    requested: number;
    created: number;
    reused: number;
    failed: number;
  };
  results: PromoteBacktestBatchResultItem[];
}
