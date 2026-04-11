import { ApiTimeContract } from './Time';

export interface RiskSummary {
  portfolioRisk: string;
  breachedRules: number;
  liquidationWatch: number;
  capitalAtRisk: number;
  marginUsage?: string;
  drawdownBudgetUsed?: string;
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
export type RiskPolicyVersionOperation = 'create' | 'update' | 'rollback';
export type RiskPolicyApprovalMode = 'auto_approved' | 'manual_review';
export type RiskPolicyApprovalState = 'pending_review' | 'approved' | 'rejected';

export interface RiskPolicy {
  id: string;
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
