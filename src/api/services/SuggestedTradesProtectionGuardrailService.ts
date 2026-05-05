import { Inject, Service } from 'typedi';
import { AlertRepository } from '../../database';
import { coreDataSource } from '../../database/data-source';
import { env } from '../../env';
import { Logger } from '../../lib/logger';

const log = new Logger(__filename);
const LOOP_KEY = 'suggested-trades-protection-guardrails';
const CHANNEL = 'Suggested Trades';
const ROUTE = 'Suggested Trades';
const ACTIVE_ORDER_STATUSES = new Set([
  'OPEN',
  'PENDING',
  'PARTIALLY_FILLED',
  'PARTIAL',
  'TRIGGER_PENDING',
]);

type GuardrailStatus = 'ok' | 'degraded' | 'disabled';
type GuardrailIssueCode = 'attached_protection_inactive' | 'delta_filled_protection_stale';

interface ProtectionExecutionRow {
  suggestedTradeId?: string | null;
  userId?: string | null;
  brokerKey?: string | null;
  accountId?: string | null;
  symbol?: string | null;
  side?: string | null;
  timeframe?: string | null;
  orderId?: string | null;
  orderStatus?: string | null;
  orderType?: string | null;
  executionState?: string | null;
  positionId?: string | null;
  positionStatus?: string | null;
  filledAt?: Date | string | null;
  submittedAt?: Date | string | null;
  protectionState?: string | null;
  protectionPlanJson?: Record<string, unknown> | string | null;
  protectionCheckedAt?: Date | string | null;
  protectionAttachedAt?: Date | string | null;
  updatedAt?: Date | string | null;
}

interface OrderSnapshotRow {
  externalId?: string | null;
  symbol?: string | null;
  orderStatus?: string | null;
  statusRank?: number | string | null;
  lastSeenAt?: Date | string | null;
}

interface PositionSnapshotRow {
  externalId?: string | null;
  symbol?: string | null;
  status?: string | null;
  statusRank?: number | string | null;
  stopLossOrderId?: string | null;
  stopLossPrice?: string | null;
  takeProfitOrderId?: string | null;
  takeProfitPrice?: string | null;
  lastSeenAt?: Date | string | null;
}

export interface SuggestedTradesProtectionGuardrailIssue {
  code: GuardrailIssueCode;
  severity: 'High' | 'Medium';
  message: string;
}

export interface SuggestedTradesProtectionGuardrailItem {
  suggestedTradeId: string;
  userId: string;
  brokerKey: string;
  accountId: string | null;
  symbol: string;
  side: string | null;
  timeframe: string | null;
  entryOrderId: string | null;
  entryOrderStatus: string | null;
  executionState: string | null;
  positionId: string | null;
  positionStatus: string | null;
  protectionState: string;
  protectionCheckedAt: string | null;
  protectionAttachedAt: string | null;
  stopLossOrderId: string | null;
  stopLossOrderStatus: string | null;
  takeProfitOrderId: string | null;
  takeProfitOrderStatus: string | null;
  positionSymbol: string | null;
  positionStopLossOrderId: string | null;
  positionTakeProfitOrderId: string | null;
  positionStopLossPrice: string | null;
  positionTakeProfitPrice: string | null;
  ageSeconds: number | null;
  issues: SuggestedTradesProtectionGuardrailIssue[];
  alertEmitted: boolean;
}

export interface SuggestedTradesProtectionGuardrailResponse {
  status: GuardrailStatus;
  timestamp: string;
  emitAlerts: boolean;
  monitoredTrades: number;
  issueTrades: number;
  criticalIssues: number;
  warningIssues: number;
  alertsEmitted: number;
  staleAfterMs: number;
  items: SuggestedTradesProtectionGuardrailItem[];
  detail?: string;
}

@Service()
export class SuggestedTradesProtectionGuardrailService {
  @Inject(() => AlertRepository)
  private alertRepository!: AlertRepository;

  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopRequested = false;
  private activeRunPromise: Promise<void> | null = null;

  async start(): Promise<void> {
    if (
      env.isTest ||
      !env.suggestedTradesProtectionGuardrails.enabled ||
      !env.suggestedTradesProtectionGuardrails.backgroundEnabled
    ) {
      log.info(
        `Suggested trades protection guardrail loop is disabled (enabled=${env.suggestedTradesProtectionGuardrails.enabled}, backgroundEnabled=${env.suggestedTradesProtectionGuardrails.backgroundEnabled}, test=${env.isTest})`
      );
      return;
    }

    if (this.timer) {
      return;
    }

    this.stopRequested = false;
    log.info(
      `Starting ${LOOP_KEY} background loop with poll interval ${env.suggestedTradesProtectionGuardrails.pollIntervalMs}ms`
    );
    void this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, env.suggestedTradesProtectionGuardrails.pollIntervalMs);
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

  async runAudit(
    options: {
      emitAlerts?: boolean;
      now?: Date;
      maxTrades?: number;
      staleAfterMs?: number;
    } = {}
  ): Promise<SuggestedTradesProtectionGuardrailResponse> {
    const now = options.now ?? new Date();
    const emitAlerts = options.emitAlerts !== false;
    const staleAfterMs = this.normalizePositiveInteger(
      options.staleAfterMs ?? env.suggestedTradesProtectionGuardrails.staleAfterMs,
      env.suggestedTradesProtectionGuardrails.staleAfterMs,
      60_000,
      24 * 60 * 60 * 1000
    );
    const maxTrades = this.normalizePositiveInteger(
      options.maxTrades ?? env.suggestedTradesProtectionGuardrails.maxTrades,
      env.suggestedTradesProtectionGuardrails.maxTrades,
      1,
      500
    );

    if (!env.suggestedTradesProtectionGuardrails.enabled) {
      return {
        status: 'disabled',
        timestamp: now.toISOString(),
        emitAlerts,
        monitoredTrades: 0,
        issueTrades: 0,
        criticalIssues: 0,
        warningIssues: 0,
        alertsEmitted: 0,
        staleAfterMs,
        items: [],
        detail: 'Suggested trades protection guardrails are disabled by configuration.',
      };
    }

    const rows = await this.listExecutionCandidates(maxTrades);
    const orderIds = rows.flatMap((row) => {
      const plan = this.readRecord(row.protectionPlanJson);
      return [
        this.readNullableString(plan.stopLossOrderId),
        this.readNullableString(plan.takeProfitOrderId),
      ].filter((value): value is string => Boolean(value));
    });
    const orderById = await this.listOrderSnapshots(orderIds);

    const items: SuggestedTradesProtectionGuardrailItem[] = [];
    let alertsEmitted = 0;
    for (const row of rows) {
      const positions = await this.listOpenPositionSnapshots(row);
      const item = this.evaluateExecution(row, positions, orderById, now, staleAfterMs);
      if (emitAlerts && item.issues.length > 0) {
        for (const issue of item.issues) {
          if (await this.emitIssueAlert(item, issue)) {
            alertsEmitted += 1;
            item.alertEmitted = true;
          }
        }
      }
      items.push(item);
    }

    const issueTrades = items.filter((item) => item.issues.length > 0).length;
    const criticalIssues = items.reduce(
      (total, item) => total + item.issues.filter((issue) => issue.severity === 'High').length,
      0
    );
    const warningIssues = items.reduce(
      (total, item) => total + item.issues.filter((issue) => issue.severity === 'Medium').length,
      0
    );

    return {
      status: issueTrades > 0 ? 'degraded' : 'ok',
      timestamp: now.toISOString(),
      emitAlerts,
      monitoredTrades: items.length,
      issueTrades,
      criticalIssues,
      warningIssues,
      alertsEmitted,
      staleAfterMs,
      items,
      ...(items.length === 0
        ? {
            detail:
              'No live Delta or Mudrex suggested-trade protection rows currently need guardrail evaluation.',
          }
        : {}),
    };
  }

  private async tick(): Promise<void> {
    if (this.running || this.stopRequested) {
      return;
    }

    const runPromise = (async () => {
      this.running = true;
      try {
        const response = await this.runAudit({ emitAlerts: true });
        if (response.issueTrades > 0) {
          log.warn(
            `Suggested trades protection guardrails found ${response.issueTrades} issue trade(s) with ${response.criticalIssues} critical and ${response.warningIssues} warning issue(s).`
          );
        }
      } catch (error) {
        log.error(
          `Suggested trades protection guardrail run failed: ${
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

  private async listExecutionCandidates(limit: number): Promise<ProtectionExecutionRow[]> {
    return coreDataSource.query(
      `SELECT suggested_trade.id AS suggestedTradeId,
              suggested_trade.user_id AS userId,
              suggested_trade.symbol AS symbol,
              suggested_trade.side AS side,
              suggested_trade.timeframe AS timeframe,
              execution_record.broker_key AS brokerKey,
              execution_record.account_id AS accountId,
              execution_record.order_id AS orderId,
              execution_record.order_status AS orderStatus,
              execution_record.order_type AS orderType,
              execution_record.execution_state AS executionState,
              execution_record.position_id AS positionId,
              execution_record.position_status AS positionStatus,
              execution_record.filled_at AS filledAt,
              execution_record.submitted_at AS submittedAt,
              execution_record.protection_state AS protectionState,
              execution_record.protection_plan_json AS protectionPlanJson,
              execution_record.protection_checked_at AS protectionCheckedAt,
              execution_record.protection_attached_at AS protectionAttachedAt,
              execution_record.updated_at AS updatedAt
         FROM suggested_trade_executions execution_record
         JOIN suggested_trades suggested_trade
           ON suggested_trade.id = execution_record.suggested_trade_id
        WHERE LOWER(COALESCE(execution_record.execution_mode, '')) = 'live'
          AND LOWER(COALESCE(execution_record.broker_key, '')) IN ('delta_exchange', 'mudrex')
          AND LOWER(COALESCE(execution_record.execution_state, '')) NOT IN ('closed', 'cancelled', 'rejected', 'expired', 'failed')
          AND LOWER(COALESCE(execution_record.position_status, '')) NOT IN ('closed', 'liquidated')
          AND (
            LOWER(COALESCE(execution_record.protection_state, '')) = 'attached'
            OR (
              LOWER(COALESCE(execution_record.broker_key, '')) = 'delta_exchange'
              AND LOWER(COALESCE(execution_record.protection_state, '')) IN ('waiting_for_position', 'attaching')
              AND (
                execution_record.filled_at IS NOT NULL
                OR LOWER(COALESCE(execution_record.execution_state, '')) = 'filled'
                OR UPPER(COALESCE(execution_record.order_status, '')) IN ('CLOSED', 'FILLED')
              )
            )
          )
        ORDER BY COALESCE(execution_record.protection_checked_at, execution_record.filled_at, execution_record.updated_at) ASC
        LIMIT ${limit}`
    ) as Promise<ProtectionExecutionRow[]>;
  }

  private async listOrderSnapshots(orderIds: string[]): Promise<Map<string, OrderSnapshotRow>> {
    const uniqueOrderIds = Array.from(
      new Set(orderIds.map((value) => this.readString(value)).filter(Boolean))
    );
    if (!uniqueOrderIds.length) {
      return new Map();
    }

    const rows = (await coreDataSource.query(
      `SELECT external_id AS externalId,
              symbol,
              order_status AS orderStatus,
              status_rank AS statusRank,
              last_seen_at AS lastSeenAt
         FROM scheduler_orders_snapshots
        WHERE external_id IN (${uniqueOrderIds.map(() => '?').join(', ')})`,
      uniqueOrderIds
    )) as OrderSnapshotRow[];

    return new Map(
      rows.map((row) => [this.readString(row.externalId), row] as [string, OrderSnapshotRow])
    );
  }

  private async listOpenPositionSnapshots(
    row: ProtectionExecutionRow
  ): Promise<PositionSnapshotRow[]> {
    const userId = this.readString(row.userId);
    const accountId = this.readString(row.accountId);
    const brokerKey = this.readString(row.brokerKey).toLowerCase();
    if (!userId || !accountId || !brokerKey) {
      return [];
    }

    const rows = (await coreDataSource.query(
      `SELECT external_id AS externalId,
              symbol,
              status,
              status_rank AS statusRank,
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
              last_seen_at AS lastSeenAt
         FROM scheduler_positions_snapshots
        WHERE user_id = ?
          AND account_id = ?
          AND LOWER(broker_key) = ?
          AND status_rank > 0
          AND status_rank <= 2
        ORDER BY updated_at DESC
        LIMIT 250`,
      [userId, accountId, brokerKey]
    )) as PositionSnapshotRow[];

    const positionId = this.readString(row.positionId);
    const symbolBase = this.normalizeSymbolBase(this.readString(row.symbol));
    return rows.filter((position) => {
      if (!this.isOpenPosition(position)) {
        return false;
      }
      const externalId = this.readString(position.externalId);
      if (positionId && externalId === positionId) {
        return true;
      }
      return Boolean(symbolBase && this.normalizeSymbolBase(this.readString(position.symbol)) === symbolBase);
    });
  }

  private evaluateExecution(
    row: ProtectionExecutionRow,
    positions: PositionSnapshotRow[],
    orderById: Map<string, OrderSnapshotRow>,
    now: Date,
    staleAfterMs: number
  ): SuggestedTradesProtectionGuardrailItem {
    const brokerKey = this.readString(row.brokerKey).toLowerCase();
    const protectionState = this.readString(row.protectionState).toLowerCase() || 'unknown';
    const plan = this.readRecord(row.protectionPlanJson);
    const stopLossOrderId = this.readNullableString(plan.stopLossOrderId);
    const takeProfitOrderId = this.readNullableString(plan.takeProfitOrderId);
    const stopLossSnapshot = stopLossOrderId ? (orderById.get(stopLossOrderId) ?? null) : null;
    const takeProfitSnapshot = takeProfitOrderId ? (orderById.get(takeProfitOrderId) ?? null) : null;
    const positionProtection = this.resolvePositionProtection(positions);
    const referenceTime =
      this.toTimestamp(row.protectionCheckedAt) ??
      this.toTimestamp(row.filledAt) ??
      this.toTimestamp(row.updatedAt);
    const ageSeconds =
      referenceTime === null
        ? null
        : Math.max(0, Math.floor((now.getTime() - referenceTime) / 1000));
    const issues: SuggestedTradesProtectionGuardrailIssue[] = [];

    const stopLossActive =
      brokerKey === 'mudrex'
        ? positionProtection.stopLossActive
        : Boolean(stopLossSnapshot && this.isActiveOrderSnapshot(stopLossSnapshot));
    const takeProfitActive =
      brokerKey === 'mudrex'
        ? positionProtection.takeProfitActive
        : Boolean(takeProfitSnapshot && this.isActiveOrderSnapshot(takeProfitSnapshot));

    if (protectionState === 'attached' && positions.length > 0 && (!stopLossActive || !takeProfitActive)) {
      issues.push({
        code: 'attached_protection_inactive',
        severity: 'High',
        message: 'Execution is marked attached, but the open position does not have active SL and TP protection snapshots.',
      });
    }

    if (
      brokerKey === 'delta_exchange' &&
      (protectionState === 'waiting_for_position' || protectionState === 'attaching') &&
      this.isFilledExecution(row) &&
      (referenceTime === null || now.getTime() - referenceTime > staleAfterMs)
    ) {
      issues.push({
        code: 'delta_filled_protection_stale',
        severity: 'High',
        message: `Delta entry is filled but protection is still ${protectionState} after ${ageSeconds ?? 'unknown'} seconds.`,
      });
    }

    const firstPosition = positions[0] ?? null;
    return {
      suggestedTradeId: this.readString(row.suggestedTradeId),
      userId: this.readString(row.userId),
      brokerKey,
      accountId: this.readNullableString(row.accountId),
      symbol: this.readString(row.symbol).toUpperCase(),
      side: this.readNullableString(row.side)?.toUpperCase() ?? null,
      timeframe: this.readNullableString(row.timeframe),
      entryOrderId: this.readNullableString(row.orderId),
      entryOrderStatus: this.readNullableString(row.orderStatus),
      executionState: this.readNullableString(row.executionState),
      positionId: this.readNullableString(row.positionId),
      positionStatus: this.readNullableString(row.positionStatus),
      protectionState,
      protectionCheckedAt: this.toIsoString(row.protectionCheckedAt),
      protectionAttachedAt: this.toIsoString(row.protectionAttachedAt),
      stopLossOrderId,
      stopLossOrderStatus: this.readNullableString(stopLossSnapshot?.orderStatus),
      takeProfitOrderId,
      takeProfitOrderStatus: this.readNullableString(takeProfitSnapshot?.orderStatus),
      positionSymbol: this.readNullableString(firstPosition?.symbol),
      positionStopLossOrderId: positionProtection.stopLossOrderId,
      positionTakeProfitOrderId: positionProtection.takeProfitOrderId,
      positionStopLossPrice: positionProtection.stopLossPrice,
      positionTakeProfitPrice: positionProtection.takeProfitPrice,
      ageSeconds,
      issues,
      alertEmitted: false,
    };
  }

  private async emitIssueAlert(
    item: SuggestedTradesProtectionGuardrailItem,
    issue: SuggestedTradesProtectionGuardrailIssue
  ): Promise<boolean> {
    if (!item.userId || !item.suggestedTradeId) {
      return false;
    }

    const source = `st-protection-guardrail:${item.suggestedTradeId}:${issue.code}`.slice(0, 100);
    const message = this.buildAlertMessage(item, issue);
    const existingBySource = await this.alertRepository.findOpenAlertBySource({
      userId: item.userId,
      channel: CHANNEL,
      source,
    });

    if (existingBySource) {
      if (
        existingBySource.severity !== issue.severity ||
        existingBySource.symbol !== item.symbol ||
        existingBySource.message !== message ||
        existingBySource.route !== ROUTE ||
        existingBySource.urgency !== 'immediate'
      ) {
        await this.alertRepository.updateOpenAlertDetails(item.userId, existingBySource.id, {
          severity: issue.severity,
          symbol: item.symbol.slice(0, 50) || 'SYSTEM',
          message,
          route: ROUTE,
          urgency: 'immediate',
        });
        return true;
      }
      return false;
    }

    const existing = await this.alertRepository.findOpenAlertBySignature({
      userId: item.userId,
      channel: CHANNEL,
      source,
      message,
    });
    if (existing) {
      return false;
    }

    const created = await this.alertRepository.createAlert({
      userId: item.userId,
      severity: issue.severity,
      channel: CHANNEL,
      symbol: item.symbol.slice(0, 50) || 'SYSTEM',
      message,
      route: ROUTE,
      status: 'Open',
      source,
      urgency: 'immediate',
      applyEscalationPolicy: true,
    });

    return Boolean(created);
  }

  private buildAlertMessage(
    item: SuggestedTradesProtectionGuardrailItem,
    issue: SuggestedTradesProtectionGuardrailIssue
  ): string {
    const sl = item.stopLossOrderId
      ? `${item.stopLossOrderId}:${item.stopLossOrderStatus || 'missing'}`
      : item.positionStopLossOrderId
        ? `${item.positionStopLossOrderId}:position`
        : 'missing';
    const tp = item.takeProfitOrderId
      ? `${item.takeProfitOrderId}:${item.takeProfitOrderStatus || 'missing'}`
      : item.positionTakeProfitOrderId
        ? `${item.positionTakeProfitOrderId}:position`
        : 'missing';
    return `${item.brokerKey} ${item.symbol} protection guardrail ${issue.code}; entry=${item.entryOrderId || 'missing'} state=${item.protectionState} SL=${sl} TP=${tp}.`.slice(
      0,
      255
    );
  }

  private resolvePositionProtection(positions: PositionSnapshotRow[]): {
    stopLossActive: boolean;
    takeProfitActive: boolean;
    stopLossOrderId: string | null;
    takeProfitOrderId: string | null;
    stopLossPrice: string | null;
    takeProfitPrice: string | null;
  } {
    let stopLossOrderId: string | null = null;
    let takeProfitOrderId: string | null = null;
    let stopLossPrice: string | null = null;
    let takeProfitPrice: string | null = null;

    for (const position of positions) {
      stopLossOrderId ??= this.readNullableString(position.stopLossOrderId);
      takeProfitOrderId ??= this.readNullableString(position.takeProfitOrderId);
      stopLossPrice ??= this.readNullableString(position.stopLossPrice);
      takeProfitPrice ??= this.readNullableString(position.takeProfitPrice);
    }

    return {
      stopLossActive: Boolean(stopLossOrderId || stopLossPrice),
      takeProfitActive: Boolean(takeProfitOrderId || takeProfitPrice),
      stopLossOrderId,
      takeProfitOrderId,
      stopLossPrice,
      takeProfitPrice,
    };
  }

  private isFilledExecution(row: ProtectionExecutionRow): boolean {
    const executionState = this.readString(row.executionState).toLowerCase();
    const orderStatus = this.readString(row.orderStatus).toUpperCase();
    return Boolean(
      row.filledAt ||
        executionState === 'filled' ||
        orderStatus === 'CLOSED' ||
        orderStatus === 'FILLED'
    );
  }

  private isActiveOrderSnapshot(snapshot: OrderSnapshotRow): boolean {
    const status = this.readString(snapshot.orderStatus).toUpperCase();
    const rank = Number(snapshot.statusRank);
    if (ACTIVE_ORDER_STATUSES.has(status)) {
      return true;
    }
    return Number.isFinite(rank) && rank > 0 && rank < 4;
  }

  private isOpenPosition(snapshot: PositionSnapshotRow): boolean {
    const status = this.readString(snapshot.status).toUpperCase();
    if (['OPEN', 'PARTIAL', 'PARTIALLY_CLOSED', 'PARTIALLY_CLOSED_POSITION'].includes(status)) {
      return true;
    }
    const rank = Number(snapshot.statusRank);
    return Number.isFinite(rank) && rank > 0 && rank <= 2;
  }

  private normalizeSymbolBase(symbol: string): string {
    const normalized = symbol.trim().toUpperCase();
    for (const suffix of ['USDT', 'USDC', 'USD']) {
      if (normalized.endsWith(suffix) && normalized.length > suffix.length) {
        return normalized.slice(0, -suffix.length);
      }
    }
    return normalized;
  }

  private readRecord(value: unknown): Record<string, unknown> {
    if (!value) {
      return {};
    }
    if (typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value) as unknown;
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : {};
      } catch {
        return {};
      }
    }
    return {};
  }

  private toIsoString(value: Date | string | null | undefined): string | null {
    const timestamp = this.toTimestamp(value);
    return timestamp === null ? null : new Date(timestamp).toISOString();
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
