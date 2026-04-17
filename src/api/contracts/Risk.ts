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
  maxLeverage?: number;
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
  maxLeverage?: number;
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
