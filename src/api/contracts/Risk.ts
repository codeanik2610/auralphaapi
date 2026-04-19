import { ApiTimeContract } from './Time';

export interface RiskSummary {
  snapshotId?: string;
  portfolioRisk: string;
  breachedRules: number;
  liquidationWatch: number;
  capitalAtRisk: number;
  denominatorBasis?: string;
  portfolioEquity?: number;
  grossExposure?: number;
  netExposure?: number;
  longExposure?: number;
  shortExposure?: number;
  openOrders?: number;
  openOrderExposure?: number;
  reservedOrderMargin?: number;
  marginUsage?: string;
  drawdownBudgetUsed?: string;
  weeklyDrawdownBudgetUsed?: string;
  monthlyDrawdownBudgetUsed?: string;
  atRiskPositions?: number;
  ruleViolations?: number;
  portfolioRiskScore?: string;
  primaryConcern?: string;
  riskByPosition?: string;
  riskByStrategy?: string;
  riskByGuardrail?: string;
  guardrailOne?: string;
  guardrailTwo?: string;
  guardrailThree?: string;
  actionOne?: string;
  actionTwo?: string;
  actionThree?: string;
  fundsObservedAtIso?: string;
  positionsObservedAtIso?: string;
  ordersObservedAtIso?: string;
}

export interface RiskAccountItem {
  id: string;
  snapshotId: string;
  brokerKey: string;
  accountId: string;
  accountName: string;
  policyContextId?: string | null;
  sourceCoverageId?: string | null;
  denominatorBasis?: string;
  walletBalance?: number | null;
  futuresBalance?: number | null;
  trackedBalance?: number | null;
  grossExposure: number;
  netExposure: number;
  longExposure: number;
  shortExposure: number;
  openOrders: number;
  openOrderExposure: number;
  reservedOrderMargin: number;
  marginUsagePct: number;
  portfolioConcentrationPct: number;
  dailyLossUsagePct: number;
  unrealizedPnl: number;
  openPositions: number;
  maxPositionLeverage?: number | null;
  closestLiquidationDistancePct?: number | null;
  marginUsageWarnPct: number;
  marginUsageCriticalPct: number;
  concentrationWarnPct: number;
  concentrationCriticalPct: number;
  dailyLossLimitPct: number;
  weeklyLossLimitPct: number;
  monthlyLossLimitPct: number;
  maxLeverage: number;
  maxTotalAllocation: number;
  maxAvgLeverage: number;
  fundsObservedAt?: string | null;
  fundsObservedAtIso?: string | null;
  positionsObservedAt?: string | null;
  positionsObservedAtIso?: string | null;
  ordersObservedAt?: string | null;
  ordersObservedAtIso?: string | null;
  createdAt: string;
  createdAtIso?: string;
}

export interface RiskAccountsResponse {
  items: RiskAccountItem[];
  total: number;
  snapshotId?: string;
  denominatorBasis?: string;
  portfolioEquity?: number;
  grossExposure?: number;
  netExposure?: number;
  longExposure?: number;
  shortExposure?: number;
  openOrders?: number;
  openOrderExposure?: number;
  reservedOrderMargin?: number;
  fundsObservedAt?: string | null;
  fundsObservedAtIso?: string | null;
  positionsObservedAt?: string | null;
  positionsObservedAtIso?: string | null;
  ordersObservedAt?: string | null;
  ordersObservedAtIso?: string | null;
  time?: ApiTimeContract;
}

export interface RiskPositionItem {
  id: string;
  snapshotId: string;
  brokerKey: string;
  accountId: string;
  accountName: string;
  positionId: string;
  symbol: string;
  side?: string | null;
  sideKey?: string | null;
  status?: string | null;
  statusKey?: string | null;
  quantity?: number | null;
  entryPrice?: number | null;
  currentPrice?: number | null;
  exposure: number;
  unrealizedPnl?: number | null;
  realizedPnl?: number | null;
  leverage?: number | null;
  liquidationPrice?: number | null;
  liquidationDistancePct?: number | null;
  concentrationPct?: number | null;
  riskState: string;
  notes: string[];
  positionOpenedAt?: string | null;
  positionOpenedAtIso?: string | null;
  sourceUpdatedAt?: string | null;
  sourceUpdatedAtIso?: string | null;
  createdAt: string;
  createdAtIso?: string;
}

export interface RiskPositionsResponse {
  items: RiskPositionItem[];
  total: number;
  snapshotId?: string;
  time?: ApiTimeContract;
}

export interface RiskOrderItem {
  id: string;
  snapshotId: string;
  brokerKey: string;
  accountId: string;
  accountName: string;
  externalId: string;
  orderId?: string | null;
  symbol?: string | null;
  side?: string | null;
  status?: string | null;
  orderType?: string | null;
  triggerType?: string | null;
  quantity?: number | null;
  filledQuantity?: number | null;
  remainingQuantity?: number | null;
  price?: number | null;
  orderPrice?: number | null;
  triggerPrice?: number | null;
  filledPrice?: number | null;
  lastPrice?: number | null;
  stoplossPrice?: number | null;
  takeprofitPrice?: number | null;
  leverage?: number | null;
  reduceOnly?: boolean | null;
  snapshotStatusRank: number;
  notional?: number | null;
  reservedMargin?: number | null;
  orderCreatedAt?: string | null;
  orderCreatedAtIso?: string | null;
  orderUpdatedAt?: string | null;
  orderUpdatedAtIso?: string | null;
  orderCanceledAt?: string | null;
  orderCanceledAtIso?: string | null;
  firstSeenAt?: string | null;
  firstSeenAtIso?: string | null;
  lastSeenAt?: string | null;
  lastSeenAtIso?: string | null;
  createdAt: string;
  createdAtIso?: string;
}

export interface RiskOrdersResponse {
  items: RiskOrderItem[];
  total: number;
  snapshotId?: string;
  time?: ApiTimeContract;
}

export interface RiskSnapshotDetailResponse {
  snapshotId: string;
  createdAt: string;
  createdAtIso?: string;
  previousSnapshotId?: string;
  previousSnapshotCreatedAt?: string | null;
  previousSnapshotCreatedAtIso?: string | null;
  summary: RiskSummary;
  accounts: RiskAccountItem[];
  positions: RiskPositionItem[];
  orders: RiskOrderItem[];
  controls: RiskControlItem[];
  alerts: RiskAlertItem[];
  scenarios: RiskScenarioItem[];
  storage?: RiskSnapshotStorageDetail;
  counts: {
    accounts: number;
    positions: number;
    orders: number;
    controls: number;
    alerts: number;
    scenarios: number;
  };
  time?: ApiTimeContract;
}

export interface RiskSnapshotStorageDetail {
  brokers: RiskBrokerSnapshotItem[];
  assets: RiskAssetSnapshotItem[];
  brokerAssets: RiskBrokerAssetSnapshotItem[];
  policyContexts: RiskPolicyContextItem[];
  sourceCoverage: RiskSourceCoverageItem[];
  ruleEvaluations: RiskRuleEvaluationItem[];
  counts: {
    brokers: number;
    assets: number;
    brokerAssets: number;
    policyContexts: number;
    sourceCoverage: number;
    ruleEvaluations: number;
  };
}

export interface RiskBrokerSnapshotItem {
  id: string;
  snapshotId: string;
  brokerKey: string;
  policyContextId?: string | null;
  accountCount: number;
  trackedBalance: number;
  walletBalance: number;
  futuresBalance: number;
  grossExposure: number;
  netExposure: number;
  longExposure: number;
  shortExposure: number;
  openPositions: number;
  openOrders: number;
  openOrderExposure: number;
  reservedOrderMargin: number;
  unrealizedPnl: number;
  realizedPnl: number;
  weightedAvgLeverage?: number | null;
  maxLeverage?: number | null;
  worstLiquidationDistancePct?: number | null;
  marginUsagePct?: number;
  portfolioAllocationPct?: number;
  riskScore: number;
  riskState: string;
  primaryConcern?: string | null;
  createdAt: string;
  createdAtIso?: string;
}

export interface RiskBrokerSnapshotsResponse {
  items: RiskBrokerSnapshotItem[];
  total: number;
  snapshotId?: string;
  portfolioEquity?: number;
  time?: ApiTimeContract;
}

export interface RiskAssetSnapshotItem {
  id: string;
  snapshotId: string;
  symbol: string;
  accountCount: number;
  brokerCount: number;
  positionCount: number;
  openOrders: number;
  openOrderExposure: number;
  reservedOrderMargin: number;
  grossExposure: number;
  netExposure: number;
  longExposure: number;
  shortExposure: number;
  unrealizedPnl: number;
  realizedPnl: number;
  weightedAvgLeverage?: number | null;
  maxLeverage?: number | null;
  worstLiquidationDistancePct?: number | null;
  allocationPct?: number;
  riskScore: number;
  riskState: string;
  primaryConcern?: string | null;
  createdAt: string;
  createdAtIso?: string;
}

export interface RiskAssetSnapshotsResponse {
  items: RiskAssetSnapshotItem[];
  total: number;
  snapshotId?: string;
  portfolioEquity?: number;
  time?: ApiTimeContract;
}

export interface RiskBrokerAssetSnapshotItem {
  id: string;
  snapshotId: string;
  brokerKey: string;
  symbol: string;
  policyContextId?: string | null;
  accountCount: number;
  positionCount: number;
  openOrders: number;
  openOrderExposure: number;
  reservedOrderMargin: number;
  grossExposure: number;
  netExposure: number;
  longExposure: number;
  shortExposure: number;
  unrealizedPnl: number;
  realizedPnl: number;
  weightedAvgLeverage?: number | null;
  maxLeverage?: number | null;
  worstLiquidationDistancePct?: number | null;
  allocationPct?: number;
  marginUsagePct?: number | null;
  riskScore: number;
  riskState: string;
  primaryConcern?: string | null;
  createdAt: string;
  createdAtIso?: string;
}

export interface RiskBrokerAssetSnapshotsResponse {
  items: RiskBrokerAssetSnapshotItem[];
  total: number;
  snapshotId?: string;
  portfolioEquity?: number;
  time?: ApiTimeContract;
}

export interface RiskPolicyContextItem {
  id: string;
  snapshotId: string;
  contextKey: string;
  policyId?: string | null;
  policyScope: string;
  policyTargetKey: string;
  enabled: boolean;
  monitorOnly: boolean;
  enforceHardBlock: boolean;
  marginUsageWarnPct: number;
  marginUsageCriticalPct: number;
  concentrationWarnPct: number;
  concentrationCriticalPct: number;
  dailyLossLimitPct: number;
  weeklyLossLimitPct: number;
  monthlyLossLimitPct: number;
  minLeverage?: number | null;
  maxLeverage?: number | null;
  minNotionalPerTrade?: number | null;
  maxOrderAllocation?: number | null;
  maxTotalAllocation?: number | null;
  maxAvgLeverage?: number | null;
  createdAt: string;
  createdAtIso?: string;
}

export interface RiskPolicyContextsResponse {
  items: RiskPolicyContextItem[];
  total: number;
  snapshotId?: string;
  time?: ApiTimeContract;
}

export interface RiskSourceCoverageItem {
  id: string;
  snapshotId: string;
  brokerKey: string;
  accountId: string;
  accountName: string;
  latestFundsSnapshotId?: string | null;
  latestFundsSnapshotDate?: string | null;
  latestFundsObservedAt?: string | null;
  latestFundsObservedAtIso?: string | null;
  latestFundsComputedAt?: string | null;
  latestFundsComputedAtIso?: string | null;
  latestFundsLastAttemptAt?: string | null;
  latestFundsLastAttemptAtIso?: string | null;
  latestFundsFetchStatus?: string | null;
  latestFundsErrorMessage?: string | null;
  latestFundsSource?: string | null;
  latestWalletAvailable: boolean;
  latestFuturesAvailable: boolean;
  latestSuccessFundsSnapshotId?: string | null;
  latestSuccessFundsSnapshotDate?: string | null;
  latestSuccessFundsObservedAt?: string | null;
  latestSuccessFundsObservedAtIso?: string | null;
  latestSuccessFundsComputedAt?: string | null;
  latestSuccessFundsComputedAtIso?: string | null;
  latestSuccessFundsSource?: string | null;
  latestSuccessWalletAvailable: boolean;
  latestSuccessFuturesAvailable: boolean;
  positionsObservedAt?: string | null;
  positionsObservedAtIso?: string | null;
  positionsCheckpointAt?: string | null;
  positionsCheckpointAtIso?: string | null;
  openPositions: number;
  positionTotalRows: number;
  positionSnapshotRows: number;
  positionReadModelRows: number;
  rowsMissingFromReadModel: number;
  rowsBehindSnapshot: number;
  orphanReadModelRows: number;
  latestPositionSnapshotSeenAt?: string | null;
  latestPositionSnapshotSeenAtIso?: string | null;
  latestPositionReadModelSeenAt?: string | null;
  latestPositionReadModelSeenAtIso?: string | null;
  openOrderRows: number;
  latestOrderSeenAt?: string | null;
  latestOrderSeenAtIso?: string | null;
  createdAt: string;
  createdAtIso?: string;
}

export interface RiskSourceCoverageResponse {
  items: RiskSourceCoverageItem[];
  total: number;
  snapshotId?: string;
  time?: ApiTimeContract;
}

export interface RiskRuleEvaluationItem {
  id: string;
  snapshotId: string;
  policyContextId?: string | null;
  sourceType: string;
  scopeType: string;
  scopeKey: string;
  scopeLabel?: string | null;
  brokerKey?: string | null;
  accountId?: string | null;
  positionId?: string | null;
  symbol?: string | null;
  ruleCode: string;
  metricName?: string | null;
  actualValue?: number | null;
  basisValue?: number | null;
  warnThresholdValue?: number | null;
  criticalThresholdValue?: number | null;
  status: string;
  bucket?: string | null;
  exposure?: string | null;
  threshold?: string | null;
  action?: string | null;
  alertSeverity?: string | null;
  alertMessage?: string | null;
  alertSymbol?: string | null;
  alertChannel?: string | null;
  alertStatus?: string | null;
  sortOrder: number;
  createdAt: string;
  createdAtIso?: string;
}

export interface RiskRuleEvaluationsResponse {
  items: RiskRuleEvaluationItem[];
  total: number;
  snapshotId?: string;
  time?: ApiTimeContract;
}

export type RiskPreTradeExecutionMode = 'paper' | 'live';
export type RiskPreTradeApprovalMode = 'manual_review' | 'auto_if_safe';
export type RiskPreTradeRouteMode = 'strategy_default' | 'user_default' | 'fixed';
export type RiskPreTradeOrderType = 'market' | 'limit';
export type RiskPreTradeQuantityMode = 'quantity' | 'notional' | 'risk_percent';
export type RiskPreTradeCheckStatus = 'passed' | 'blocked' | 'warning' | 'stale' | 'error';
export type RiskPreTradeFreshnessState = 'fresh' | 'lagging' | 'partial' | 'unavailable';

export interface RiskPreTradeCheckBody {
  snapshotId?: string;
  suggestedTradeId?: string;
  automationId?: string;
  automationRunId?: string;
  sourceType?: string;
  executionMode?: RiskPreTradeExecutionMode;
  approvalMode?: RiskPreTradeApprovalMode;
  routing?: {
    routeMode?: RiskPreTradeRouteMode;
    brokerKey?: string | null;
    accountId?: string | null;
  };
  order?: {
    symbol?: string;
    timeframe?: string | null;
    side?: 'BUY' | 'SELL';
    orderType?: RiskPreTradeOrderType;
    timeInForce?: 'GTC' | 'IOC' | 'FOK' | null;
    quantityMode?: RiskPreTradeQuantityMode;
    quantity?: number | null;
    notional?: number | null;
    riskPercent?: number | null;
    entryPrice?: number | string | null;
    stopLossPrice?: number | string | null;
    takeProfitTargets?: Array<number | string> | null;
    leverage?: number | null;
    reduceOnly?: boolean;
  };
}

export interface RiskPreTradeAppliedPolicyItem {
  policyContextId?: string | null;
  policyId?: string | null;
  scope: string;
  scopeKey: string;
  monitorOnly: boolean;
  enforceHardBlock: boolean;
}

export interface RiskPreTradeScopeImpactItem {
  id: string;
  checkId: string;
  snapshotId?: string | null;
  scopeType: string;
  scopeKey: string;
  scopeLabel?: string | null;
  brokerKey?: string | null;
  accountId?: string | null;
  symbol?: string | null;
  beforeGrossExposure?: number | null;
  beforeNetExposure?: number | null;
  beforeOpenOrderExposure?: number | null;
  beforeReservedOrderMargin?: number | null;
  beforeMarginUsagePct?: number | null;
  beforeAllocationPct?: number | null;
  beforeRiskScore?: number | null;
  beforeRiskState?: string | null;
  deltaGrossExposure?: number | null;
  deltaNetExposure?: number | null;
  deltaOpenOrderExposure?: number | null;
  deltaReservedOrderMargin?: number | null;
  afterGrossExposure?: number | null;
  afterNetExposure?: number | null;
  afterOpenOrderExposure?: number | null;
  afterReservedOrderMargin?: number | null;
  afterMarginUsagePct?: number | null;
  afterAllocationPct?: number | null;
  afterRiskScore?: number | null;
  afterRiskState?: string | null;
  sortOrder: number;
  createdAt: string;
  createdAtIso?: string;
}

export interface RiskPreTradeRuleResult {
  id: string;
  checkId: string;
  snapshotId?: string | null;
  policyContextId?: string | null;
  scopeType: string;
  scopeKey: string;
  scopeLabel?: string | null;
  brokerKey?: string | null;
  accountId?: string | null;
  symbol?: string | null;
  ruleCode: string;
  metricName?: string | null;
  actualValue?: number | null;
  basisValue?: number | null;
  warnThresholdValue?: number | null;
  criticalThresholdValue?: number | null;
  status: string;
  blocking: boolean;
  message: string;
  sortOrder: number;
  createdAt: string;
  createdAtIso?: string;
}

export interface RiskPreTradeCheckResult {
  checkId: string;
  status: RiskPreTradeCheckStatus;
  checkedAt: string;
  checkedAtIso?: string;
  expiresAt?: string | null;
  expiresAtIso?: string | null;
  request: {
    suggestedTradeId?: string | null;
    automationId?: string | null;
    automationRunId?: string | null;
    sourceType: string;
    executionMode: RiskPreTradeExecutionMode;
    approvalMode: RiskPreTradeApprovalMode;
    routing: {
      routeMode: RiskPreTradeRouteMode;
      brokerKey?: string | null;
      accountId?: string | null;
    };
    order: {
      symbol: string;
      timeframe?: string | null;
      side: 'BUY' | 'SELL';
      orderType: RiskPreTradeOrderType;
      timeInForce?: 'GTC' | 'IOC' | 'FOK' | null;
      quantityMode: RiskPreTradeQuantityMode;
      quantity?: number | null;
      notional?: number | null;
      riskPercent?: number | null;
      entryPrice?: number | null;
      stopLossPrice?: number | null;
      takeProfitTargets?: number[] | null;
      leverage?: number | null;
      reduceOnly: boolean;
    };
  };
  snapshot: {
    snapshotId?: string | null;
    freshnessState: RiskPreTradeFreshnessState;
    snapshotLagMinutes?: number | null;
    latestRiskSnapshotAt?: string | null;
    latestRiskSnapshotAtIso?: string | null;
  };
  decision: {
    allowed: boolean;
    blocked: boolean;
    approvalRequired: boolean;
    blockingRuleCount: number;
    warningRuleCount: number;
    summary: string;
  };
  before: {
    portfolio?: RiskPreTradeScopeImpactItem | null;
    brokers: RiskPreTradeScopeImpactItem[];
    assets: RiskPreTradeScopeImpactItem[];
    brokerAssets: RiskPreTradeScopeImpactItem[];
  };
  delta: {
    grossExposureDelta?: number | null;
    netExposureDelta?: number | null;
    openOrderExposureDelta?: number | null;
    reservedOrderMarginDelta?: number | null;
  };
  after: {
    portfolio?: RiskPreTradeScopeImpactItem | null;
    brokers: RiskPreTradeScopeImpactItem[];
    assets: RiskPreTradeScopeImpactItem[];
    brokerAssets: RiskPreTradeScopeImpactItem[];
  };
  scopeImpacts: RiskPreTradeScopeImpactItem[];
  blockingRules: RiskPreTradeRuleResult[];
  warningRules: RiskPreTradeRuleResult[];
  evaluatedRules: RiskPreTradeRuleResult[];
  appliedPolicies: RiskPreTradeAppliedPolicyItem[];
  time?: ApiTimeContract;
}

export interface RiskKillSwitchBody {
  scope?: string;
  reason?: string;
}

export interface RiskKillSwitchResult {
  message: string;
  triggeredAt: string;
  triggeredAtIso?: string;
  scope: string;
  time?: ApiTimeContract;
}

export interface RiskRecomputeResult {
  message: string;
  computedAt: string;
  computedAtIso?: string;
  equity?: number;
  snapshotId?: string;
  portfolioRisk?: string;
  orderSnapshotsCreated?: number;
  ruleEvaluationsCreated?: number;
  controlsCreated?: number;
  alertsCreated?: number;
  scenariosCreated?: number;
  accountCount?: number;
  livePositionCount?: number;
  holdings?: Array<{
    id: string;
    symbol: string;
    allocationPct: number;
    marketValue: number;
    dayPnL: number;
    strategy: string;
    riskState: string;
  }>;
  time?: ApiTimeContract;
}

export interface RiskAlertItem {
  id: string;
  snapshotId: string;
  severity: string;
  message: string;
  symbol: string;
  channel?: string;
  status?: string;
  createdAt: string;
  createdAtIso?: string;
}

export interface RiskAlertsResponse {
  items: RiskAlertItem[];
  total: number;
  limit: number;
  offset: number;
  time?: ApiTimeContract;
}

export interface RiskAlertsSummary {
  total: number;
  bySeverity: Record<string, number>;
  byStatus: Record<string, number>;
}

export interface RiskControlItem {
  id: string;
  snapshotId: string;
  bucket: string;
  exposure: string;
  threshold: string;
  status: string;
  action: string;
  createdAt: string;
  createdAtIso?: string;
}

export interface RiskControlsResponse {
  items: RiskControlItem[];
  total: number;
  limit: number;
  offset: number;
  time?: ApiTimeContract;
}

export interface RiskScenarioItem {
  id: string;
  snapshotId: string;
  scenario: string;
  impact: string;
  commentary: string;
  createdAt: string;
  createdAtIso?: string;
}

export interface RiskScenariosResponse {
  items: RiskScenarioItem[];
  total: number;
  limit: number;
  offset: number;
  time?: ApiTimeContract;
}

export interface RiskBatchRecomputeResult {
  message: string;
  processed: number;
  succeeded: number;
  failed: number;
  snapshotsCreated?: number;
  orderSnapshotsCreated?: number;
  controlsCreated?: number;
  alertsCreated?: number;
  scenariosCreated?: number;
  failures: Array<{
    userId: string;
    error: string;
  }>;
  completedAt: string;
  completedAtIso?: string;
  time?: ApiTimeContract;
}

export type RiskPolicyScope = 'user' | 'broker';
export type RiskPolicyMode = 'disabled' | 'warn' | 'monitor' | 'hard_block';
export type RiskPolicyVersionOperation = 'create' | 'update' | 'rollback';
export type RiskPolicyApprovalMode = 'auto_approved' | 'manual_review';
export type RiskPolicyApprovalState = 'pending_review' | 'approved' | 'rejected';

export interface RiskPolicy {
  id: string;
  scope: RiskPolicyScope;
  brokerKey?: string;
  mode: RiskPolicyMode;
  enabled: boolean;
  monitorOnly: boolean;
  enforceHardBlock: boolean;
  marginUsageWarnPct: number;
  marginUsageCriticalPct: number;
  concentrationWarnPct: number;
  concentrationCriticalPct: number;
  dailyLossLimitPct?: number;
  weeklyLossLimitPct?: number;
  monthlyLossLimitPct?: number;
  minLeverage?: number;
  maxLeverage?: number;
  minNotionalPerTrade?: number;
  maxOrderAllocation?: number;
  maxTotalAllocation?: number;
  maxAvgLeverage?: number;
  approvalMode: RiskPolicyApprovalMode;
  approvalState: RiskPolicyApprovalState;
  pendingVersionId?: string;
  pendingVersionCount: number;
  updatedAt: string;
  updatedAtIso?: string;
}

export interface RiskPoliciesResponse {
  items: RiskPolicy[];
  total: number;
  time?: ApiTimeContract;
}

export interface RiskPolicyVersionItem {
  id: string;
  policyId: string;
  actorUserId: string;
  operation: RiskPolicyVersionOperation;
  summary: string;
  reason?: string;
  approvalMode: RiskPolicyApprovalMode;
  approvalState: RiskPolicyApprovalState;
  approvedAt?: string;
  approvedByUserId?: string;
  reviewReason?: string;
  reviewedAt?: string;
  reviewedByUserId?: string;
  rollbackFromVersionId?: string;
  changedFields: string[];
  canRollback: boolean;
  canApprove: boolean;
  canReject: boolean;
  effective: boolean;
  snapshot: RiskPolicy;
  links: {
    activityPath: string;
    enforcementActivityPath: string;
  };
  createdAt: string;
  createdAtIso?: string;
  approvedAtIso?: string;
  reviewedAtIso?: string;
}

export interface RiskPolicyVersionsResponse {
  policyId: string;
  total: number;
  currentVersionId?: string;
  pendingVersionId?: string;
  pendingVersionCount: number;
  approvalMode: RiskPolicyApprovalMode;
  currentApprovalState: RiskPolicyApprovalState;
  items: RiskPolicyVersionItem[];
  time?: ApiTimeContract;
}

export interface UpsertRiskPolicyBody {
  scope: RiskPolicyScope;
  brokerKey?: string;
  enabled: boolean;
  monitorOnly: boolean;
  enforceHardBlock: boolean;
  marginUsageWarnPct: number;
  marginUsageCriticalPct: number;
  concentrationWarnPct: number;
  concentrationCriticalPct: number;
  dailyLossLimitPct?: number;
  weeklyLossLimitPct?: number;
  monthlyLossLimitPct?: number;
  minLeverage?: number;
  maxLeverage?: number;
  minNotionalPerTrade?: number;
  maxOrderAllocation?: number;
  maxTotalAllocation?: number;
  maxAvgLeverage?: number;
}

export interface RollbackRiskPolicyBody {
  versionId?: string;
  reason?: string;
}

export interface ReviewRiskPolicyVersionBody {
  reason?: string;
}

export interface RiskPolicyWriteResult {
  message: string;
  policyId: string;
  policy: RiskPolicy;
  versionId: string;
  approvalMode: RiskPolicyApprovalMode;
  approvalState: RiskPolicyApprovalState;
  applied: boolean;
  activityPath: string;
  enforcementActivityPath: string;
}

export interface RiskPolicyRollbackResult extends RiskPolicyWriteResult {
  message: string;
  restoredVersionId: string;
  createdVersionId: string;
}

export interface RiskPolicyReviewResult {
  message: string;
  policyId: string;
  versionId: string;
  approvalMode: RiskPolicyApprovalMode;
  approvalState: RiskPolicyApprovalState;
  applied: boolean;
  policy?: RiskPolicy;
  activityPath: string;
  enforcementActivityPath: string;
}
