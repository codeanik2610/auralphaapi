import { Inject, Service } from 'typedi';
import { AlertRepository } from '../../database';
import { coreDataSource } from '../../database/data-source';
import { env } from '../../env';

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
  alertEmitted: boolean;
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
  items: BrokerCanaryProtectionItem[];
  detail?: string;
}

@Service()
export class BrokerCanaryProtectionMonitorService {
  @Inject(() => AlertRepository)
  private alertRepository!: AlertRepository;

  async runMonitor(options: {
    emitAlerts?: boolean;
    lookbackHours?: number;
    maxSubmissions?: number;
    now?: Date;
  } = {}): Promise<BrokerCanaryProtectionMonitorResponse> {
    const now = options.now ?? new Date();
    const emitAlerts = options.emitAlerts !== false;
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
        items: [],
        detail: 'Broker canary protection monitor is disabled by configuration.',
      };
    }

    const candidates = await this.listCandidateSubmissions(lookbackHours, maxSubmissions);
    const items: BrokerCanaryProtectionItem[] = [];
    let alertsEmitted = 0;

    for (const candidate of candidates) {
      const item = await this.evaluateCandidate(candidate, now);
      if (emitAlerts && item.issues.length > 0) {
        item.alertEmitted = await this.emitIssueAlert(item);
        if (item.alertEmitted) {
          alertsEmitted += 1;
        }
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
      items,
      ...(items.length === 0
        ? { detail: 'No recent live broker canary submissions with protective order ids found.' }
        : {}),
    };
  }

  private async listCandidateSubmissions(
    lookbackHours: number,
    maxSubmissions: number
  ): Promise<SubmissionCandidateRow[]> {
    return coreDataSource.query(
      `SELECT id,
              user_id AS userId,
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
              created_at AS createdAt,
              updated_at AS updatedAt
         FROM order_submission_requests
        WHERE execution_mode = 'live'
          AND status = 'completed'
          AND placement_state IN ('placed', 'replayed')
          AND broker_order_id IS NOT NULL
          AND account_id IS NOT NULL
          AND broker_key IS NOT NULL
          AND created_at >= DATE_SUB(NOW(), INTERVAL ${lookbackHours} HOUR)
          AND (
            JSON_UNQUOTE(JSON_EXTRACT(response_json, '$.stop_loss_order_id')) IS NOT NULL
            OR JSON_UNQUOTE(JSON_EXTRACT(response_json, '$.data.stop_loss_order_id')) IS NOT NULL
            OR JSON_UNQUOTE(JSON_EXTRACT(response_json, '$.take_profit_order_id')) IS NOT NULL
            OR JSON_UNQUOTE(JSON_EXTRACT(response_json, '$.data.take_profit_order_id')) IS NOT NULL
          )
        ORDER BY updated_at DESC
        LIMIT ${maxSubmissions}`
    ) as Promise<SubmissionCandidateRow[]>;
  }

  private async evaluateCandidate(
    candidate: SubmissionCandidateRow,
    now: Date
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

    const orderSnapshots = await this.listOrderSnapshots(userId, accountId, brokerKey, trackedOrderIds);
    const orderById = new Map(
      orderSnapshots.map((row) => [this.readString(row.externalId), row] as const)
    );
    const entrySnapshot = orderById.get(entryOrderId) ?? null;
    const stopLossSnapshot = stopLossOrderId ? orderById.get(stopLossOrderId) ?? null : null;
    const takeProfitSnapshot = takeProfitOrderId ? orderById.get(takeProfitOrderId) ?? null : null;
    const symbol = this.resolveSymbol(candidate, entrySnapshot, stopLossSnapshot, takeProfitSnapshot);
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
    const positionOpen = positions.length > 0;
    const stopLossActive = stopLossSnapshot ? this.isActiveOrderSnapshot(stopLossSnapshot) : false;
    const takeProfitActive = takeProfitSnapshot ? this.isActiveOrderSnapshot(takeProfitSnapshot) : false;
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
        message: 'Protective order is still active but no matching open position snapshot is visible.',
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

    return {
      submissionId,
      userId,
      brokerKey,
      accountId,
      symbol,
      lifecycle: this.resolveLifecycle(positionOpen, stopLossActive, takeProfitActive),
      entryOrderId,
      stopLossOrderId,
      takeProfitOrderId,
      positionOpen,
      entryStatus: this.readNullableString(entrySnapshot?.orderStatus),
      stopLossStatus: this.readNullableString(stopLossSnapshot?.orderStatus),
      takeProfitStatus: this.readNullableString(takeProfitSnapshot?.orderStatus),
      reconciliationState: this.readNullableString(candidate.reconciliationState),
      latestSnapshotAt: this.pickLatestSnapshotAt([...orderSnapshots, ...positions]),
      issues,
      alertEmitted: false,
    };
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
    const source = `broker-canary-monitor:${item.submissionId}`.slice(0, 100);
    const severity = item.issues.some((issue) => issue.severity === 'critical')
      ? 'High'
      : 'Medium';
    const issueSummary = item.issues
      .slice(0, 3)
      .map((issue) => issue.message)
      .join(' ');
    const message = `Broker canary protection issue for ${item.symbol || item.brokerKey}: ${issueSummary}`.slice(
      0,
      255
    );
    const recent = await this.alertRepository.findRecentOpenAlertBySource({
      userId: item.userId,
      channel: 'Broker Canary',
      source,
      withinMinutes: env.observability.failureAlertThrottleMinutes,
    });
    if (recent) {
      return false;
    }
    const existing = await this.alertRepository.findOpenAlertBySignature({
      userId: item.userId,
      channel: 'Broker Canary',
      source,
      message,
    });
    if (existing) {
      return false;
    }

    const created = await this.alertRepository.createAlert({
      userId: item.userId,
      severity,
      channel: 'Broker Canary',
      symbol: (item.symbol || 'SYSTEM').slice(0, 50),
      message,
      route: 'Orders',
      status: 'Open',
      source,
      urgency: item.issues.some((issue) => issue.code === 'open_position_unprotected')
        ? 'immediate'
        : 'review',
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
    if (['OPEN', 'PENDING', 'PARTIALLY_FILLED', 'PARTIAL', 'TRIGGER_PENDING'].includes(status)) {
      return true;
    }
    return Number.isFinite(rank) && rank > 0 && rank < 4;
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
