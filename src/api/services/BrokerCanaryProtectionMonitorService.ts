import { Inject, Service } from 'typedi';
import { AlertRepository } from '../../database';
import { coreDataSource } from '../../database/data-source';
import { env } from '../../env';
import { BrokerOrdersFacadeService } from './BrokerOrdersFacadeService';
import { RiskKillSwitchService } from './RiskKillSwitchService';
import { Logger } from '../../lib/logger';

const log = new Logger(__filename);
const MONITOR_LOOP_KEY = 'broker-canary-monitor';

type MonitorStatus = 'ok' | 'degraded' | 'disabled';
type IssueSeverity = 'warning' | 'critical';
type LifecycleState =
  | 'OPEN_WITH_SL_TP'
  | 'OPEN_UNPROTECTED'
  | 'CLOSED_NO_ACTIVE_PROTECTION'
  | 'CLOSED_WITH_ACTIVE_PROTECTION'
  | 'UNKNOWN';

interface SubmissionCandidateRow {
  id?: string | null;
  suggestedTradeId?: string | null;
  userId?: string | null;
  brokerKey?: string | null;
  accountId?: string | null;
  brokerOrderId?: string | null;
  brokerOrderStatus?: string | null;
  reconciliationState?: string | null;
  assetId?: string | null;
  requestSymbol?: string | null;
  requestOrderSymbol?: string | null;
  responseSymbol?: string | null;
  stopLossOrderId?: string | null;
  stopLossOrderIdNested?: string | null;
  takeProfitOrderId?: string | null;
  takeProfitOrderIdNested?: string | null;
  requestStopLossPrice?: string | null;
  requestTakeProfitPrice?: string | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
}

interface OrderSnapshotRow {
  externalId?: string | null;
  symbol?: string | null;
  orderStatus?: string | null;
  statusRank?: number | string | null;
  assetUuid?: string | null;
  side?: string | null;
  orderType?: string | null;
  stopOrderType?: string | null;
  stopPrice?: string | null;
  lastSeenAt?: Date | string | null;
  updatedAt?: Date | string | null;
}

interface PositionSnapshotRow {
  externalId?: string | null;
  symbol?: string | null;
  status?: string | null;
  statusRank?: number | string | null;
  quantityContracts?: string | null;
  entryPrice?: string | null;
  markPrice?: string | null;
  stopLossOrderId?: string | null;
  stopLossPrice?: string | null;
  takeProfitOrderId?: string | null;
  takeProfitPrice?: string | null;
  lastSeenAt?: Date | string | null;
  updatedAt?: Date | string | null;
}

export interface BrokerCanaryProtectionIssue {
  code:
    | 'entry_snapshot_missing'
    | 'protective_snapshot_missing'
    | 'open_position_unprotected'
    | 'orphan_active_protection'
    | 'submission_reconciliation_drift'
    | 'snapshot_stale';
  severity: IssueSeverity;
  message: string;
  orderId?: string;
}

export interface BrokerCanaryProtectionItem {
  submissionId: string;
  userId: string;
  brokerKey: string;
  accountId: string;
  symbol: string | null;
  lifecycle: LifecycleState;
  entryOrderId: string;
  stopLossOrderId: string | null;
  takeProfitOrderId: string | null;
  positionOpen: boolean;
  entryStatus: string | null;
  stopLossStatus: string | null;
  takeProfitStatus: string | null;
  reconciliationState: string | null;
  latestSnapshotAt: string | null;
  issues: BrokerCanaryProtectionIssue[];
  autoCancelledOrderIds?: string[];
  alertEmitted: boolean;
  killSwitchTriggered: boolean;
  killSwitchActive: boolean;
  killSwitchIssueCode: BrokerCanaryProtectionIssue['code'] | null;
  killSwitchReason: string | null;
  killSwitchError?: string;
}

export interface BrokerCanaryProtectionMonitorResponse {
  status: MonitorStatus;
  timestamp: string;
  emitAlerts: boolean;
  lookbackHours: number;
  monitoredSubmissions: number;
  healthySubmissions: number;
  issueSubmissions: number;
  criticalIssues: number;
  warningIssues: number;
  alertsEmitted: number;
  freezeOnCritical: boolean;
  killSwitchTriggers: number;
  items: BrokerCanaryProtectionItem[];
  detail?: string;
}

@Service()
export class BrokerCanaryProtectionMonitorService {
  @Inject(() => AlertRepository)
  private alertRepository!: AlertRepository;

  @Inject(() => BrokerOrdersFacadeService)
  private brokerOrdersFacadeService!: BrokerOrdersFacadeService;

  @Inject(() => RiskKillSwitchService)
  private riskKillSwitchService!: RiskKillSwitchService;

  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopRequested = false;
  private activeRunPromise: Promise<void> | null = null;

  async start(): Promise<void> {
    if (
      env.isTest ||
      !env.brokerCanaryMonitor.enabled ||
      !env.brokerCanaryMonitor.backgroundEnabled
    ) {
      log.info(
        `Broker canary protection background loop is disabled (enabled=${env.brokerCanaryMonitor.enabled}, backgroundEnabled=${env.brokerCanaryMonitor.backgroundEnabled}, test=${env.isTest})`
      );
      return;
    }

    if (this.timer) {
      return;
    }

    this.stopRequested = false;
    log.info(
      `Starting ${MONITOR_LOOP_KEY} background loop with poll interval ${env.brokerCanaryMonitor.pollIntervalMs}ms`
    );
    void this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, env.brokerCanaryMonitor.pollIntervalMs);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    this.stopRequested = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.activeRunPromise;
  }

  async runMonitor(
    options: {
      emitAlerts?: boolean;
      lookbackHours?: number;
      maxSubmissions?: number;
      brokerKey?: string;
      freezeOnCritical?: boolean;
      now?: Date;
    } = {}
  ): Promise<BrokerCanaryProtectionMonitorResponse> {
    const now = options.now ?? new Date();
    const emitAlerts = options.emitAlerts !== false;
    const freezeOnCritical =
      options.freezeOnCritical ?? env.brokerCanaryMonitor.autoFreezeOnCritical;
    const lookbackHours = this.normalizePositiveInteger(
      options.lookbackHours ?? env.brokerCanaryMonitor.lookbackHours,
      env.brokerCanaryMonitor.lookbackHours,
      1,
      24 * 90
    );
    const maxSubmissions = this.normalizePositiveInteger(
      options.maxSubmissions ?? env.brokerCanaryMonitor.maxSubmissions,
      env.brokerCanaryMonitor.maxSubmissions,
      1,
      500
    );

    if (!env.brokerCanaryMonitor.enabled) {
      return {
        status: 'disabled',
        timestamp: now.toISOString(),
        emitAlerts,
        lookbackHours,
        monitoredSubmissions: 0,
        healthySubmissions: 0,
        issueSubmissions: 0,
        criticalIssues: 0,
        warningIssues: 0,
        alertsEmitted: 0,
        freezeOnCritical,
        killSwitchTriggers: 0,
        items: [],
        detail: 'Broker canary protection monitor is disabled by configuration.',
      };
    }

    const candidates = await this.listCandidateSubmissions({
      lookbackHours,
      maxSubmissions,
      brokerKey: options.brokerKey,
    });
    const items: BrokerCanaryProtectionItem[] = [];
    let alertsEmitted = 0;
    let killSwitchTriggers = 0;

    for (const candidate of candidates) {
      const item = await this.evaluateCandidate(candidate, now, emitAlerts);
      const remediationOnly =
        item.autoCancelledOrderIds?.length &&
        item.issues.length > 0 &&
        item.issues.every((issue) => issue.code === 'orphan_active_protection');
      if (emitAlerts && item.issues.length > 0 && !remediationOnly) {
        item.alertEmitted = await this.emitIssueAlert(item);
        if (item.alertEmitted) {
          alertsEmitted += 1;
        }
      }
      if (
        await this.maybeFreezeUnsafeLiveTrading(item, {
          emitAlerts,
          freezeOnCritical,
        })
      ) {
        killSwitchTriggers += 1;
      }
      items.push(item);
    }

    const criticalIssues = items.reduce(
      (total, item) => total + item.issues.filter((issue) => issue.severity === 'critical').length,
      0
    );
    const warningIssues = items.reduce(
      (total, item) => total + item.issues.filter((issue) => issue.severity === 'warning').length,
      0
    );
    const issueSubmissions = items.filter((item) => item.issues.length > 0).length;
    const healthySubmissions = Math.max(0, items.length - issueSubmissions);

    return {
      status: issueSubmissions > 0 ? 'degraded' : 'ok',
      timestamp: now.toISOString(),
      emitAlerts,
      lookbackHours,
      monitoredSubmissions: items.length,
      healthySubmissions,
      issueSubmissions,
      criticalIssues,
      warningIssues,
      alertsEmitted,
      freezeOnCritical,
      killSwitchTriggers,
      items,
      ...(items.length === 0
        ? {
            detail:
              'No recent live broker canary submissions with protective order ids or requested SL/TP prices found.',
          }
        : {}),
    };
  }

  private async listCandidateSubmissions(input: {
    lookbackHours: number;
    maxSubmissions: number;
    brokerKey?: string;
  }): Promise<SubmissionCandidateRow[]> {
    const normalizedBrokerKey = this.readString(input.brokerKey).toLowerCase();
    const brokerFilter = normalizedBrokerKey ? 'AND LOWER(broker_key) = ?' : '';
    const params = normalizedBrokerKey ? [normalizedBrokerKey] : [];

    return coreDataSource.query(
      `SELECT id,
              user_id AS userId,
              suggested_trade_id AS suggestedTradeId,
              broker_key AS brokerKey,
              account_id AS accountId,
              broker_order_id AS brokerOrderId,
              broker_order_status AS brokerOrderStatus,
              reconciliation_state AS reconciliationState,
              asset_id AS assetId,
              JSON_UNQUOTE(JSON_EXTRACT(request_json, '$.symbol')) AS requestSymbol,
              JSON_UNQUOTE(JSON_EXTRACT(request_json, '$.order.symbol')) AS requestOrderSymbol,
              JSON_UNQUOTE(JSON_EXTRACT(response_json, '$.symbol')) AS responseSymbol,
              JSON_UNQUOTE(JSON_EXTRACT(response_json, '$.stop_loss_order_id')) AS stopLossOrderId,
              JSON_UNQUOTE(JSON_EXTRACT(response_json, '$.data.stop_loss_order_id')) AS stopLossOrderIdNested,
              JSON_UNQUOTE(JSON_EXTRACT(response_json, '$.take_profit_order_id')) AS takeProfitOrderId,
              JSON_UNQUOTE(JSON_EXTRACT(response_json, '$.data.take_profit_order_id')) AS takeProfitOrderIdNested,
              NULLIF(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(request_json, '$.order.stopLossPrice')), 'null'), '') AS requestStopLossPrice,
              NULLIF(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(request_json, '$.order.takeProfitPrice')), 'null'), '') AS requestTakeProfitPrice,
              created_at AS createdAt,
              updated_at AS updatedAt
         FROM order_submission_requests
        WHERE execution_mode = 'live'
          AND status = 'completed'
          AND placement_state IN ('placed', 'replayed')
          AND broker_order_id IS NOT NULL
          ${env.brokerCanaryMonitor.includeSuggestedTrades ? '' : 'AND suggested_trade_id IS NULL'}
          AND account_id IS NOT NULL
          AND broker_key IS NOT NULL
          ${brokerFilter}
          AND created_at >= DATE_SUB(NOW(), INTERVAL ${input.lookbackHours} HOUR)
          AND (
            NULLIF(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(response_json, '$.stop_loss_order_id')), 'null'), '') IS NOT NULL
            OR NULLIF(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(response_json, '$.data.stop_loss_order_id')), 'null'), '') IS NOT NULL
            OR NULLIF(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(response_json, '$.take_profit_order_id')), 'null'), '') IS NOT NULL
            OR NULLIF(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(response_json, '$.data.take_profit_order_id')), 'null'), '') IS NOT NULL
            OR NULLIF(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(request_json, '$.order.stopLossPrice')), 'null'), '') IS NOT NULL
            OR NULLIF(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(request_json, '$.order.takeProfitPrice')), 'null'), '') IS NOT NULL
          )
        ORDER BY updated_at DESC
        LIMIT ${input.maxSubmissions}`,
      params
    ) as Promise<SubmissionCandidateRow[]>;
  }

  private async evaluateCandidate(
    candidate: SubmissionCandidateRow,
    now: Date,
    autoRemediate: boolean
  ): Promise<BrokerCanaryProtectionItem> {
    const submissionId = this.readString(candidate.id);
    const userId = this.readString(candidate.userId);
    const brokerKey = this.readString(candidate.brokerKey).toLowerCase();
    const accountId = this.readString(candidate.accountId);
    const entryOrderId = this.readString(candidate.brokerOrderId);
    const stopLossOrderId =
      this.readString(candidate.stopLossOrderId) ||
      this.readString(candidate.stopLossOrderIdNested) ||
      null;
    const takeProfitOrderId =
      this.readString(candidate.takeProfitOrderId) ||
      this.readString(candidate.takeProfitOrderIdNested) ||
      null;
    const trackedOrderIds = [entryOrderId, stopLossOrderId, takeProfitOrderId].filter(
      (value): value is string => Boolean(value)
    );

    const orderSnapshots = await this.listOrderSnapshots(
      userId,
      accountId,
      brokerKey,
      trackedOrderIds
    );
    const orderById = new Map(
      orderSnapshots.map((row) => [this.readString(row.externalId), row] as const)
    );
    const entrySnapshot = orderById.get(entryOrderId) ?? null;
    const stopLossSnapshot = stopLossOrderId ? (orderById.get(stopLossOrderId) ?? null) : null;
    const takeProfitSnapshot = takeProfitOrderId
      ? (orderById.get(takeProfitOrderId) ?? null)
      : null;
    const symbol = this.resolveSymbol(
      candidate,
      entrySnapshot,
      stopLossSnapshot,
      takeProfitSnapshot
    );
    const assetIdentifiers = this.resolvePositionIdentifiers(entrySnapshot, orderSnapshots);
    const positions = (
      await this.listOpenPositionSnapshots({
        userId,
        accountId,
        brokerKey,
        symbol,
        assetIdentifiers,
      })
    ).filter((position) => this.isOpenPositionSnapshot(position));
    const positionProtection = this.resolvePositionProtection(positions);
    const resolvedStopLossOrderId = stopLossOrderId ?? positionProtection.stopLossOrderId;
    const resolvedTakeProfitOrderId = takeProfitOrderId ?? positionProtection.takeProfitOrderId;
    const positionClosedByProtection =
      this.isClosedOrderSnapshot(stopLossSnapshot) ||
      this.isClosedOrderSnapshot(takeProfitSnapshot);
    const positionOpen = positions.length > 0 && !positionClosedByProtection;
    const stopLossActive =
      (stopLossSnapshot ? this.isActiveOrderSnapshot(stopLossSnapshot) : false) ||
      positionProtection.stopLossActive;
    const takeProfitActive =
      (takeProfitSnapshot ? this.isActiveOrderSnapshot(takeProfitSnapshot) : false) ||
      positionProtection.takeProfitActive;
    const activeProtectionCount = [stopLossActive, takeProfitActive].filter(Boolean).length;
    const issues: BrokerCanaryProtectionIssue[] = [];

    if (!entrySnapshot) {
      issues.push({
        code: 'entry_snapshot_missing',
        severity: 'warning',
        message: `Entry order snapshot ${entryOrderId} is missing.`,
        orderId: entryOrderId,
      });
    }

    for (const [label, orderId, snapshot] of [
      ['stop-loss', stopLossOrderId, stopLossSnapshot],
      ['take-profit', takeProfitOrderId, takeProfitSnapshot],
    ] as const) {
      if (orderId && !snapshot) {
        issues.push({
          code: 'protective_snapshot_missing',
          severity: positionOpen ? 'critical' : 'warning',
          message: `${label} protective order snapshot ${orderId} is missing.`,
          orderId,
        });
      }
    }

    if (positionOpen && (!stopLossActive || !takeProfitActive)) {
      issues.push({
        code: 'open_position_unprotected',
        severity: 'critical',
        message: 'Open live canary position does not have both active SL and TP protective orders.',
      });
    }

    if (!positionOpen && activeProtectionCount > 0) {
      issues.push({
        code: 'orphan_active_protection',
        severity: 'critical',
        message: positionClosedByProtection
          ? 'Protective sibling order is still active even though the submission leg has already been closed by another protective fill.'
          : 'Protective order is still active but no matching open position snapshot is visible.',
      });
    }

    if (this.readString(candidate.reconciliationState).toLowerCase() !== 'matched') {
      issues.push({
        code: 'submission_reconciliation_drift',
        severity: 'warning',
        message: `Submission reconciliation is ${this.readString(candidate.reconciliationState) || 'unknown'}, expected matched.`,
      });
    }

    for (const snapshot of [entrySnapshot, stopLossSnapshot, takeProfitSnapshot]) {
      if (snapshot && this.isSnapshotStale(snapshot.lastSeenAt, now)) {
        issues.push({
          code: 'snapshot_stale',
          severity: positionOpen ? 'critical' : 'warning',
          message: `Order snapshot ${this.readString(snapshot.externalId)} is stale.`,
          orderId: this.readString(snapshot.externalId),
        });
      }
    }
    for (const position of positions) {
      if (this.isSnapshotStale(position.lastSeenAt, now)) {
        issues.push({
          code: 'snapshot_stale',
          severity: 'critical',
          message: `Position snapshot ${this.readString(position.externalId)} is stale.`,
        });
      }
    }

    const autoCancelledOrderIds =
      autoRemediate && !positionOpen && activeProtectionCount > 0
        ? await this.autoCancelOrphanProtection({
            userId,
            brokerKey,
            accountId,
            stopLossOrderId: resolvedStopLossOrderId,
            takeProfitOrderId: resolvedTakeProfitOrderId,
            stopLossActive,
            takeProfitActive,
          })
        : [];

    return {
      submissionId,
      userId,
      brokerKey,
      accountId,
      symbol,
      lifecycle: this.resolveLifecycle(positionOpen, stopLossActive, takeProfitActive),
      entryOrderId,
      stopLossOrderId: resolvedStopLossOrderId,
      takeProfitOrderId: resolvedTakeProfitOrderId,
      positionOpen,
      entryStatus: this.readNullableString(entrySnapshot?.orderStatus),
      stopLossStatus: this.readNullableString(stopLossSnapshot?.orderStatus),
      takeProfitStatus: this.readNullableString(takeProfitSnapshot?.orderStatus),
      reconciliationState: this.readNullableString(candidate.reconciliationState),
      latestSnapshotAt: this.pickLatestSnapshotAt([...orderSnapshots, ...positions]),
      issues,
      autoCancelledOrderIds,
      alertEmitted: false,
      killSwitchTriggered: false,
      killSwitchActive: false,
      killSwitchIssueCode: null,
      killSwitchReason: null,
    };
  }

  private async tick(): Promise<void> {
    if (this.running || this.stopRequested) {
      return;
    }

    const runPromise = (async () => {
      this.running = true;
      try {
        const response = await this.runMonitor({ emitAlerts: true });
        if (response.issueSubmissions > 0) {
          log.warn(
            `Broker canary protection monitor found ${response.issueSubmissions} issue submission(s) with ${response.criticalIssues} critical and ${response.warningIssues} warning issue(s).`
          );
        }
      } catch (error) {
        log.error(
          `Broker canary protection monitor run failed: ${
            error instanceof Error ? error.stack || error.message : String(error)
          }`
        );
      } finally {
        this.running = false;
      }
    })();

    this.activeRunPromise = runPromise;
    try {
      await runPromise;
    } finally {
      if (this.activeRunPromise === runPromise) {
        this.activeRunPromise = null;
      }
    }
  }

  private async autoCancelOrphanProtection(input: {
    userId: string;
    brokerKey: string;
    accountId: string;
    stopLossOrderId: string | null;
    takeProfitOrderId: string | null;
    stopLossActive: boolean;
    takeProfitActive: boolean;
  }): Promise<string[]> {
    const cancelledOrderIds: string[] = [];
    const attempts: Array<{ orderId: string | null; active: boolean }> = [
      { orderId: input.stopLossOrderId, active: input.stopLossActive },
      { orderId: input.takeProfitOrderId, active: input.takeProfitActive },
    ];

    for (const attempt of attempts) {
      const orderId = this.readString(attempt.orderId);
      if (!attempt.active || !orderId) {
        continue;
      }

      try {
        await this.brokerOrdersFacadeService.cancelFuturesOrder(input.userId, orderId, {
          brokerKey: input.brokerKey,
          accountId: input.accountId,
        });
        cancelledOrderIds.push(orderId);
      } catch {
        // Leave the monitor issue in place; the next run will retry and can emit an alert.
      }
    }

    return cancelledOrderIds;
  }

  private async maybeFreezeUnsafeLiveTrading(
    item: BrokerCanaryProtectionItem,
    input: { emitAlerts: boolean; freezeOnCritical: boolean }
  ): Promise<boolean> {
    if (!input.emitAlerts || !input.freezeOnCritical) {
      return false;
    }
    if (!item.userId || !item.brokerKey || !item.accountId) {
      return false;
    }

    const freezeIssue = this.pickLiveExposureFreezeIssue(item);
    if (!freezeIssue) {
      return false;
    }
    item.killSwitchIssueCode = freezeIssue.code;

    try {
      const activeBlock = await this.riskKillSwitchService.findActiveLiveTradingBlock(item.userId, {
        brokerKey: item.brokerKey,
        accountId: item.accountId,
      });
      if (activeBlock) {
        item.killSwitchActive = true;
        item.killSwitchReason = activeBlock.reason;
        return false;
      }

      const reason = this.buildAutoFreezeReason(item, freezeIssue);
      await this.riskKillSwitchService.trigger(item.userId, {
        scope: 'broker',
        brokerKey: item.brokerKey,
        accountId: item.accountId,
        reason,
      });
      item.killSwitchTriggered = true;
      item.killSwitchActive = true;
      item.killSwitchReason = reason;
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      item.killSwitchError = message;
      item.killSwitchReason = `Kill switch trigger failed: ${message}`;
      log.error(
        `Broker canary monitor failed to freeze live trading for ${item.userId}/${item.brokerKey}/${item.accountId}: ${message}`
      );
      return false;
    }
  }

  private pickLiveExposureFreezeIssue(
    item: BrokerCanaryProtectionItem
  ): BrokerCanaryProtectionIssue | null {
    if (!item.positionOpen) {
      return null;
    }
    return (
      item.issues.find(
        (issue) => issue.severity === 'critical' && this.isLiveExposureFreezeIssue(issue)
      ) ?? null
    );
  }

  private isLiveExposureFreezeIssue(issue: BrokerCanaryProtectionIssue): boolean {
    return (
      issue.code === 'open_position_unprotected' ||
      issue.code === 'protective_snapshot_missing' ||
      issue.code === 'snapshot_stale'
    );
  }

  private buildAutoFreezeReason(
    item: BrokerCanaryProtectionItem,
    issue: BrokerCanaryProtectionIssue
  ): string {
    const symbol = item.symbol || item.entryOrderId || 'unknown symbol';
    const issueMessage = issue.message.replace(/\s+/g, ' ').trim();
    return `Auto-freeze: open live position ${symbol} on ${item.brokerKey}/${item.accountId} has critical canary issue ${issue.code}: ${issueMessage} Submission ${item.submissionId}.`.slice(
      0,
      500
    );
  }

  private async listOrderSnapshots(
    userId: string,
    accountId: string,
    brokerKey: string,
    orderIds: string[]
  ): Promise<OrderSnapshotRow[]> {
    const normalizedOrderIds = Array.from(
      new Set(orderIds.map((item) => this.readString(item)).filter(Boolean))
    );
    if (!normalizedOrderIds.length) {
      return [];
    }

    return coreDataSource.query(
      `SELECT external_id AS externalId,
              symbol,
              order_status AS orderStatus,
              status_rank AS statusRank,
              JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.asset_uuid')) AS assetUuid,
              JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.side')) AS side,
              JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.order_type')) AS orderType,
              JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.stop_order_type')) AS stopOrderType,
              JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.stop_price')) AS stopPrice,
              last_seen_at AS lastSeenAt,
              updated_at AS updatedAt
         FROM scheduler_orders_snapshots
        WHERE user_id = ?
          AND account_id = ?
          AND LOWER(broker_key) = ?
          AND external_id IN (${normalizedOrderIds.map(() => '?').join(', ')})`,
      [userId, accountId, brokerKey, ...normalizedOrderIds]
    ) as Promise<OrderSnapshotRow[]>;
  }

  private async listOpenPositionSnapshots(input: {
    userId: string;
    accountId: string;
    brokerKey: string;
    symbol: string | null;
    assetIdentifiers: string[];
  }): Promise<PositionSnapshotRow[]> {
    const clauses: string[] = [];
    const params: unknown[] = [input.userId, input.accountId, input.brokerKey];
    if (input.symbol) {
      clauses.push('UPPER(symbol) = ?');
      params.push(input.symbol.toUpperCase());
    }
    const assetIdentifiers = Array.from(
      new Set(input.assetIdentifiers.map((item) => this.readString(item)).filter(Boolean))
    );
    if (assetIdentifiers.length) {
      clauses.push(`external_id IN (${assetIdentifiers.map(() => '?').join(', ')})`);
      params.push(...assetIdentifiers);
    }
    if (!clauses.length) {
      return [];
    }

    return coreDataSource.query(
      `SELECT external_id AS externalId,
              symbol,
              status,
              status_rank AS statusRank,
              JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.quantity_contracts')) AS quantityContracts,
              JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.entry_price')) AS entryPrice,
              JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.mark_price')) AS markPrice,
              COALESCE(
                NULLIF(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.stoploss.order_id')), 'null'), ''),
                NULLIF(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.stop_loss.order_id')), 'null'), ''),
                NULLIF(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.stopLoss.orderId')), 'null'), ''),
                NULLIF(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.stoploss_order_id')), 'null'), ''),
                NULLIF(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.stopLossOrderId')), 'null'), '')
              ) AS stopLossOrderId,
              COALESCE(
                NULLIF(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.stoploss.price')), 'null'), ''),
                NULLIF(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.stop_loss.price')), 'null'), ''),
                NULLIF(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.stopLoss.price')), 'null'), ''),
                NULLIF(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.stoploss_price')), 'null'), ''),
                NULLIF(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.stopLossPrice')), 'null'), '')
              ) AS stopLossPrice,
              COALESCE(
                NULLIF(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.takeprofit.order_id')), 'null'), ''),
                NULLIF(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.take_profit.order_id')), 'null'), ''),
                NULLIF(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.takeProfit.orderId')), 'null'), ''),
                NULLIF(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.takeprofit_order_id')), 'null'), ''),
                NULLIF(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.takeProfitOrderId')), 'null'), '')
              ) AS takeProfitOrderId,
              COALESCE(
                NULLIF(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.takeprofit.price')), 'null'), ''),
                NULLIF(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.take_profit.price')), 'null'), ''),
                NULLIF(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.takeProfit.price')), 'null'), ''),
                NULLIF(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.takeprofit_price')), 'null'), ''),
                NULLIF(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.takeProfitPrice')), 'null'), '')
              ) AS takeProfitPrice,
              last_seen_at AS lastSeenAt,
              updated_at AS updatedAt
         FROM scheduler_positions_snapshots
        WHERE user_id = ?
          AND account_id = ?
          AND LOWER(broker_key) = ?
          AND status_rank > 0
          AND status_rank <= 2
          AND (${clauses.join(' OR ')})
        ORDER BY updated_at DESC
        LIMIT 5`,
      params
    ) as Promise<PositionSnapshotRow[]>;
  }

  private async emitIssueAlert(item: BrokerCanaryProtectionItem): Promise<boolean> {
    if (!item.userId || !item.issues.length) {
      return false;
    }
    const channel = 'Broker Canary';
    const source = `broker-canary-monitor:${item.submissionId}`.slice(0, 100);
    const severity = item.issues.some((issue) => issue.severity === 'critical') ? 'High' : 'Medium';
    const symbol = (item.symbol || 'SYSTEM').slice(0, 50);
    const route = 'Orders';
    const urgency = item.issues.some((issue) => issue.code === 'open_position_unprotected')
      ? 'immediate'
      : 'review';
    const issueSummary = item.issues
      .slice(0, 3)
      .map((issue) => issue.message)
      .join(' ');
    const message =
      `Broker canary protection issue for ${item.symbol || item.brokerKey}: ${issueSummary}`.slice(
        0,
        255
      );
    const existingBySource = await this.alertRepository.findOpenAlertBySource({
      userId: item.userId,
      channel,
      source,
    });
    if (existingBySource) {
      if (
        existingBySource.severity !== severity ||
        existingBySource.symbol !== symbol ||
        existingBySource.message !== message ||
        existingBySource.route !== route ||
        existingBySource.urgency !== urgency
      ) {
        await this.alertRepository.updateOpenAlertDetails(item.userId, existingBySource.id, {
          severity,
          symbol,
          message,
          route,
          urgency,
        });
        return true;
      }
      return false;
    }
    const existing = await this.alertRepository.findOpenAlertBySignature({
      userId: item.userId,
      channel,
      source,
      message,
    });
    if (existing) {
      return false;
    }

    const created = await this.alertRepository.createAlert({
      userId: item.userId,
      severity,
      channel,
      symbol,
      message,
      route,
      status: 'Open',
      source,
      urgency,
      applyEscalationPolicy: true,
    });

    return Boolean(created);
  }

  private resolveSymbol(
    candidate: SubmissionCandidateRow,
    ...snapshots: Array<OrderSnapshotRow | null>
  ): string | null {
    for (const value of [
      candidate.requestOrderSymbol,
      candidate.requestSymbol,
      candidate.responseSymbol,
      ...snapshots.map((snapshot) => snapshot?.symbol),
    ]) {
      const normalized = this.readString(value).toUpperCase();
      if (normalized) {
        return normalized;
      }
    }
    return null;
  }

  private resolvePositionIdentifiers(
    entrySnapshot: OrderSnapshotRow | null,
    orderSnapshots: OrderSnapshotRow[]
  ): string[] {
    const values = [
      entrySnapshot?.assetUuid,
      ...orderSnapshots.map((snapshot) => snapshot.assetUuid),
    ];
    return Array.from(new Set(values.map((item) => this.readString(item)).filter(Boolean)));
  }

  private resolveLifecycle(
    positionOpen: boolean,
    stopLossActive: boolean,
    takeProfitActive: boolean
  ): LifecycleState {
    if (positionOpen && stopLossActive && takeProfitActive) {
      return 'OPEN_WITH_SL_TP';
    }
    if (positionOpen) {
      return 'OPEN_UNPROTECTED';
    }
    if (!positionOpen && (stopLossActive || takeProfitActive)) {
      return 'CLOSED_WITH_ACTIVE_PROTECTION';
    }
    if (!positionOpen && !stopLossActive && !takeProfitActive) {
      return 'CLOSED_NO_ACTIVE_PROTECTION';
    }
    return 'UNKNOWN';
  }

  private isActiveOrderSnapshot(snapshot: OrderSnapshotRow): boolean {
    const status = this.readString(snapshot.orderStatus).toUpperCase();
    const rank = Number(snapshot.statusRank);
    if (
      [
        'OPEN',
        'PENDING',
        'PARTIALLY_FILLED',
        'PARTIAL_FILLED',
        'PARTIAL',
        'TRIGGER_PENDING',
      ].includes(status)
    ) {
      return true;
    }
    return Number.isFinite(rank) && rank > 0 && rank < 4;
  }

  private isClosedOrderSnapshot(snapshot: OrderSnapshotRow | null | undefined): boolean {
    if (!snapshot) {
      return false;
    }

    const status = this.readString(snapshot.orderStatus).toUpperCase();
    if (status === 'CLOSED' || status === 'FILLED') {
      return true;
    }

    const rank = Number(snapshot.statusRank);
    return Number.isFinite(rank) && rank >= 4 && status === 'CLOSED';
  }

  private resolvePositionProtection(positions: PositionSnapshotRow[]): {
    stopLossActive: boolean;
    takeProfitActive: boolean;
    stopLossOrderId: string | null;
    takeProfitOrderId: string | null;
  } {
    let stopLossOrderId: string | null = null;
    let takeProfitOrderId: string | null = null;
    let stopLossActive = false;
    let takeProfitActive = false;

    for (const position of positions) {
      const positionStopLossOrderId = this.readNullableString(position.stopLossOrderId);
      const positionTakeProfitOrderId = this.readNullableString(position.takeProfitOrderId);
      const positionStopLossPrice = this.readNullableString(position.stopLossPrice);
      const positionTakeProfitPrice = this.readNullableString(position.takeProfitPrice);

      stopLossOrderId ??= positionStopLossOrderId;
      takeProfitOrderId ??= positionTakeProfitOrderId;
      stopLossActive ||= Boolean(positionStopLossOrderId || positionStopLossPrice);
      takeProfitActive ||= Boolean(positionTakeProfitOrderId || positionTakeProfitPrice);
    }

    return {
      stopLossActive,
      takeProfitActive,
      stopLossOrderId,
      takeProfitOrderId,
    };
  }

  private isOpenPositionSnapshot(snapshot: PositionSnapshotRow): boolean {
    const status = this.readString(snapshot.status).toUpperCase();
    if (['OPEN', 'PARTIAL', 'PARTIALLY_CLOSED', 'PARTIALLY_CLOSED_POSITION'].includes(status)) {
      return true;
    }
    if (
      ['CLOSED', 'CLOSE', 'LIQUIDATED', 'SETTLED', 'EXPIRED', 'CANCELLED', 'CANCELED'].includes(
        status
      )
    ) {
      return false;
    }
    const rank = Number(snapshot.statusRank);
    return Number.isFinite(rank) && rank > 0 && rank <= 2;
  }

  private isSnapshotStale(value: Date | string | null | undefined, now: Date): boolean {
    const timestamp = this.toTimestamp(value);
    if (timestamp === null) {
      return true;
    }
    return now.getTime() - timestamp > env.brokerCanaryMonitor.snapshotStaleAfterMs;
  }

  private pickLatestSnapshotAt(rows: Array<{ lastSeenAt?: Date | string | null }>): string | null {
    let latest: number | null = null;
    for (const row of rows) {
      const timestamp = this.toTimestamp(row.lastSeenAt);
      if (timestamp !== null && (latest === null || timestamp > latest)) {
        latest = timestamp;
      }
    }
    return latest === null ? null : new Date(latest).toISOString();
  }

  private toTimestamp(value: Date | string | null | undefined): number | null {
    if (!value) {
      return null;
    }
    const date = value instanceof Date ? value : new Date(String(value));
    const timestamp = date.getTime();
    return Number.isNaN(timestamp) ? null : timestamp;
  }

  private readString(value: unknown): string {
    const normalized = String(value ?? '').trim();
    return normalized.toLowerCase() === 'null' ? '' : normalized;
  }

  private readNullableString(value: unknown): string | null {
    const normalized = this.readString(value);
    return normalized || null;
  }

  private normalizePositiveInteger(
    value: unknown,
    fallback: number,
    minimum: number,
    maximum: number
  ): number {
    const parsed = Math.floor(Number(value));
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return Math.min(Math.max(parsed, minimum), maximum);
  }
}
