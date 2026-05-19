import { Inject, Service } from 'typedi';
import { AlertRepository } from '../../database';
import { coreDataSource } from '../../database/data-source';
import { env } from '../../env';
import { Logger } from '../../lib/logger';
import { SuggestedTradesService } from './SuggestedTradesService';

const log = new Logger(__filename);
const LOOP_KEY = 'suggested-trades-protection-guardrails';
const CHANNEL = 'Suggested Trades';
const ROUTE = 'Suggested Trades';
const ACTIVE_ORDER_STATUSES = new Set([
  'OPEN',
  'PENDING',
  'PARTIALLY_FILLED',
  'PARTIAL_FILLED',
  'PARTIAL',
  'TRIGGER_PENDING',
]);

type GuardrailStatus = 'ok' | 'degraded' | 'disabled';
type GuardrailIssueCode =
  | 'attached_protection_inactive'
  | 'delta_filled_protection_stale'
  | 'open_position_unprotected';
type ProtectionWatchdogStatus =
  | 'protected'
  | 'broker_verified_after_error'
  | 'needs_repair'
  | 'not_required'
  | 'unknown';

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
  quantity?: number | string | null;
  filledQuantity?: number | string | null;
  remainingQuantity?: number | string | null;
  positionId?: string | null;
  positionStatus?: string | null;
  filledAt?: Date | string | null;
  submittedAt?: Date | string | null;
  protectionState?: string | null;
  protectionLastError?: string | null;
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
  positionSize?: string | null;
  lastSeenAt?: Date | string | null;
}

interface ResolvedPositionProtection {
  stopLossActive: boolean;
  takeProfitActive: boolean;
  stopLossOrderId: string | null;
  takeProfitOrderId: string | null;
  stopLossPrice: string | null;
  takeProfitPrice: string | null;
  positionSize: string | null;
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
  partialFill: boolean;
  filledQuantity: number | null;
  remainingQuantity: number | null;
  positionId: string | null;
  positionStatus: string | null;
  protectionState: string;
  protectionLastError: string | null;
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
  positionSize: string | null;
  watchdogStatus: ProtectionWatchdogStatus;
  watchdogReason: string | null;
  readBackReconciled: boolean;
  readBackReason: string | null;
  readBackError: string | null;
  ageSeconds: number | null;
  issues: SuggestedTradesProtectionGuardrailIssue[];
  alertEmitted: boolean;
  recoveryTriggered: boolean;
  recoveryRefreshed: number | null;
  recoveryError: string | null;
}

export interface SuggestedTradesProtectionGuardrailResponse {
  status: GuardrailStatus;
  timestamp: string;
  emitAlerts: boolean;
  attemptRecovery: boolean;
  monitoredTrades: number;
  issueTrades: number;
  criticalIssues: number;
  warningIssues: number;
  alertsEmitted: number;
  recoveriesTriggered: number;
  recoveryFailures: number;
  readBackReconciliations: number;
  readBackFailures: number;
  staleAfterMs: number;
  items: SuggestedTradesProtectionGuardrailItem[];
  detail?: string;
}

@Service()
export class SuggestedTradesProtectionGuardrailService {
  @Inject(() => AlertRepository)
  private alertRepository!: AlertRepository;

  @Inject(() => SuggestedTradesService)
  private suggestedTradesService!: SuggestedTradesService;

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
      attemptRecovery?: boolean;
      now?: Date;
      maxTrades?: number;
      staleAfterMs?: number;
    } = {}
  ): Promise<SuggestedTradesProtectionGuardrailResponse> {
    const now = options.now ?? new Date();
    const emitAlerts = options.emitAlerts !== false;
    const attemptRecovery = options.attemptRecovery ?? emitAlerts;
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
        attemptRecovery,
        monitoredTrades: 0,
        issueTrades: 0,
        criticalIssues: 0,
        warningIssues: 0,
        alertsEmitted: 0,
        recoveriesTriggered: 0,
        recoveryFailures: 0,
        readBackReconciliations: 0,
        readBackFailures: 0,
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
    let recoveriesTriggered = 0;
    let recoveryFailures = 0;
    let readBackReconciliations = 0;
    let readBackFailures = 0;
    for (const row of rows) {
      const positions = await this.listOpenPositionSnapshots(row);
      const item = this.evaluateExecution(row, positions, orderById, now, staleAfterMs);
      const readBack = await this.maybeReconcileMudrexReadBack(row, positions, item, now);
      if (readBack.reconciled) {
        readBackReconciliations += 1;
      }
      if (readBack.error) {
        readBackFailures += 1;
      }
      if (emitAlerts && item.issues.length > 0) {
        for (const issue of item.issues) {
          if (await this.emitIssueAlert(item, issue)) {
            alertsEmitted += 1;
            item.alertEmitted = true;
          }
        }
      }
      if (attemptRecovery && this.shouldTriggerRecovery(item)) {
        const recovered = await this.triggerRecovery(item);
        if (recovered) {
          recoveriesTriggered += 1;
        } else {
          recoveryFailures += 1;
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
      attemptRecovery,
      monitoredTrades: items.length,
      issueTrades,
      criticalIssues,
      warningIssues,
      alertsEmitted,
      recoveriesTriggered,
      recoveryFailures,
      readBackReconciliations,
      readBackFailures,
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
              execution_record.quantity AS quantity,
              execution_record.filled_quantity AS filledQuantity,
              execution_record.remaining_quantity AS remainingQuantity,
              execution_record.position_id AS positionId,
              execution_record.position_status AS positionStatus,
              execution_record.filled_at AS filledAt,
              execution_record.submitted_at AS submittedAt,
              execution_record.protection_state AS protectionState,
              execution_record.protection_last_error AS protectionLastError,
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
              LOWER(COALESCE(execution_record.broker_key, '')) = 'mudrex'
              AND (
                COALESCE(execution_record.position_id, '') <> ''
                OR LOWER(COALESCE(execution_record.position_status, '')) IN ('open', 'partial', 'partially_closed', 'partially_closed_position')
                OR execution_record.filled_at IS NOT NULL
                OR LOWER(COALESCE(execution_record.execution_state, '')) = 'filled'
                OR UPPER(COALESCE(execution_record.order_status, '')) IN ('CLOSED', 'FILLED', 'PARTIALLY_FILLED', 'PARTIAL_FILLED', 'PARTIAL')
              )
            )
            OR (
              LOWER(COALESCE(execution_record.protection_state, '')) IN ('pending', 'waiting_for_fill', 'waiting_for_position', 'attaching', 'failed', 'manual_unlinked')
              AND (
                COALESCE(execution_record.position_id, '') <> ''
                OR LOWER(COALESCE(execution_record.position_status, '')) IN ('open', 'partial', 'partially_closed', 'partially_closed_position')
                OR
                execution_record.filled_at IS NOT NULL
                OR LOWER(COALESCE(execution_record.execution_state, '')) = 'filled'
                OR UPPER(COALESCE(execution_record.order_status, '')) IN ('CLOSED', 'FILLED', 'PARTIALLY_FILLED', 'PARTIAL_FILLED', 'PARTIAL')
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
              COALESCE(
                NULLIF(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.size')), 'null'), ''),
                NULLIF(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.quantity')), 'null'), ''),
                NULLIF(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.qty')), 'null'), ''),
                NULLIF(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.position_size')), 'null'), ''),
                NULLIF(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.positionSize')), 'null'), ''),
                NULLIF(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.contracts')), 'null'), '')
              ) AS positionSize,
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
      return Boolean(
        symbolBase && this.normalizeSymbolBase(this.readString(position.symbol)) === symbolBase
      );
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
    const protectionLastError = this.readNullableString(row.protectionLastError);
    const plan = this.readRecord(row.protectionPlanJson);
    const stopLossOrderId = this.readNullableString(plan.stopLossOrderId);
    const takeProfitOrderId = this.readNullableString(plan.takeProfitOrderId);
    const stopLossSnapshot = stopLossOrderId ? (orderById.get(stopLossOrderId) ?? null) : null;
    const takeProfitSnapshot = takeProfitOrderId
      ? (orderById.get(takeProfitOrderId) ?? null)
      : null;
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
    const missingProtection = !stopLossActive || !takeProfitActive;
    const openPositionIsStale =
      referenceTime === null || now.getTime() - referenceTime > staleAfterMs;
    const missingProtectionReason = this.describeMissingPositionProtection(positionProtection);
    const watchdogStatus = this.resolveWatchdogStatus({
      brokerKey,
      protectionState,
      hasPosition: positions.length > 0,
      missingProtection,
      protectionLastError,
    });
    const watchdogReason = this.resolveWatchdogReason({
      brokerKey,
      protectionState,
      hasPosition: positions.length > 0,
      missingProtection,
      missingProtectionReason,
      protectionLastError,
    });

    if (protectionState === 'attached' && positions.length > 0 && missingProtection) {
      issues.push({
        code: 'attached_protection_inactive',
        severity: 'High',
        message:
          brokerKey === 'mudrex'
            ? `Mudrex open position protection read-back is incomplete: ${missingProtectionReason}.`
            : 'Execution is marked attached, but the open position does not have active SL and TP protection snapshots.',
      });
    }

    if (
      protectionState !== 'attached' &&
      protectionState !== 'not_required' &&
      positions.length > 0 &&
      missingProtection &&
      (openPositionIsStale || protectionState === 'failed' || protectionState === 'manual_unlinked')
    ) {
      issues.push({
        code: 'open_position_unprotected',
        severity: 'High',
        message:
          brokerKey === 'mudrex'
            ? `Mudrex open position needs protection repair: ${missingProtectionReason}; watchdog is audit-only and did not submit a broker mutation.`
            : `Open live position has missing SL/TP protection while protection state is ${protectionState}.`,
      });
    }

    if (
      brokerKey === 'delta_exchange' &&
      (protectionState === 'waiting_for_position' || protectionState === 'attaching') &&
      this.isFilledExecution(row) &&
      openPositionIsStale
    ) {
      issues.push({
        code: 'delta_filled_protection_stale',
        severity: 'High',
        message: `Delta entry is filled but protection is still ${protectionState} after ${ageSeconds ?? 'unknown'} seconds.`,
      });
    }

    const firstPosition = positions[0] ?? null;
    const filledQuantity = this.readNumber(row.filledQuantity);
    const remainingQuantity = this.readNumber(row.remainingQuantity);
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
      partialFill: this.isPartialFill(row),
      filledQuantity,
      remainingQuantity,
      positionId: this.readNullableString(row.positionId),
      positionStatus: this.readNullableString(row.positionStatus),
      protectionState,
      protectionLastError,
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
      positionSize: positionProtection.positionSize,
      watchdogStatus,
      watchdogReason,
      readBackReconciled: false,
      readBackReason: null,
      readBackError: null,
      ageSeconds,
      issues,
      alertEmitted: false,
      recoveryTriggered: false,
      recoveryRefreshed: null,
      recoveryError: null,
    };
  }

  private shouldTriggerRecovery(item: SuggestedTradesProtectionGuardrailItem): boolean {
    if (!item.issues.length || !item.userId || !item.brokerKey || !item.accountId || !item.symbol) {
      return false;
    }
    if (item.brokerKey === 'mudrex') {
      return false;
    }
    return item.issues.some((issue) =>
      [
        'attached_protection_inactive',
        'delta_filled_protection_stale',
        'open_position_unprotected',
      ].includes(issue.code)
    );
  }

  private async triggerRecovery(item: SuggestedTradesProtectionGuardrailItem): Promise<boolean> {
    try {
      const refreshed = await this.suggestedTradesService.syncExecutionForPositionUpdates(
        item.userId,
        item.brokerKey,
        item.accountId ?? '',
        [item.symbol]
      );
      item.recoveryTriggered = true;
      item.recoveryRefreshed = refreshed;
      return true;
    } catch (error) {
      item.recoveryError = error instanceof Error ? error.message : String(error);
      return false;
    }
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
    const partial = item.partialFill
      ? ` partial_fill filled=${item.filledQuantity ?? 'unknown'} remaining=${item.remainingQuantity ?? 'unknown'} position_size=${item.positionSize ?? 'unknown'}`
      : '';
    return `${item.brokerKey} ${item.symbol} protection guardrail ${issue.code}; entry=${item.entryOrderId || 'missing'} state=${item.protectionState} SL=${sl} TP=${tp}${partial}.`.slice(
      0,
      255
    );
  }

  private resolvePositionProtection(positions: PositionSnapshotRow[]): ResolvedPositionProtection {
    let stopLossOrderId: string | null = null;
    let takeProfitOrderId: string | null = null;
    let stopLossPrice: string | null = null;
    let takeProfitPrice: string | null = null;
    let positionSize: string | null = null;

    for (const position of positions) {
      stopLossOrderId ??= this.readNullableString(position.stopLossOrderId);
      takeProfitOrderId ??= this.readNullableString(position.takeProfitOrderId);
      stopLossPrice ??= this.readNullableString(position.stopLossPrice);
      takeProfitPrice ??= this.readNullableString(position.takeProfitPrice);
      positionSize ??= this.readNullableString(position.positionSize);
    }

    return {
      stopLossActive: Boolean(stopLossOrderId || this.isPositiveProtectionPrice(stopLossPrice)),
      takeProfitActive: Boolean(
        takeProfitOrderId || this.isPositiveProtectionPrice(takeProfitPrice)
      ),
      stopLossOrderId,
      takeProfitOrderId,
      stopLossPrice,
      takeProfitPrice,
      positionSize,
    };
  }

  private isPositiveProtectionPrice(value: string | null): boolean {
    const normalized = this.readString(value);
    if (!normalized) {
      return false;
    }
    const numeric = Number(normalized);
    return Number.isFinite(numeric) && numeric > 0;
  }

  private async maybeReconcileMudrexReadBack(
    row: ProtectionExecutionRow,
    positions: PositionSnapshotRow[],
    item: SuggestedTradesProtectionGuardrailItem,
    now: Date
  ): Promise<{ reconciled: boolean; error: string | null }> {
    if (item.brokerKey !== 'mudrex' || !item.userId || !item.suggestedTradeId) {
      return { reconciled: false, error: null };
    }

    const positionProtection = this.resolvePositionProtection(positions);
    if (!positionProtection.stopLossActive || !positionProtection.takeProfitActive) {
      item.watchdogStatus = positions.length > 0 ? 'needs_repair' : item.watchdogStatus;
      item.watchdogReason =
        positions.length > 0
          ? `Mudrex read-back found incomplete protection: ${this.describeMissingPositionProtection(
              positionProtection
            )}.`
          : item.watchdogReason;
      return { reconciled: false, error: null };
    }

    const plan = this.readRecord(row.protectionPlanJson);
    const priorState = this.readString(row.protectionState).toLowerCase() || 'unknown';
    const priorError = this.readNullableString(row.protectionLastError);
    const planHasBrokerProtection = Boolean(
      this.readNullableString(plan.stopLossOrderId) ||
      this.readNullableString(plan.takeProfitOrderId) ||
      this.readNullableString(plan.attachedStopLossPrice) ||
      this.readNullableString(plan.attachedTakeProfitPrice)
    );
    const shouldReconcile = Boolean(
      priorState !== 'attached' || priorError || !planHasBrokerProtection
    );
    if (!shouldReconcile) {
      item.watchdogStatus = 'protected';
      item.watchdogReason = 'Mudrex broker read-back reports active SL and TP protection.';
      return { reconciled: false, error: null };
    }

    const nowIso = now.toISOString();
    const position = positions[0] ?? null;
    const reason =
      priorError || priorState === 'failed'
        ? 'broker_verified_after_error'
        : 'broker_verified_state_reconciled';
    const nextPlan = this.buildMudrexReadBackProtectionPlan(
      plan,
      positionProtection,
      position,
      nowIso,
      reason,
      priorState,
      priorError,
      item
    );

    try {
      await coreDataSource.query(
        `UPDATE suggested_trade_executions
            SET protection_state = 'attached',
                protection_source = COALESCE(protection_source, 'suggested_trade_execution'),
                protection_last_error = NULL,
                protection_checked_at = ?,
                protection_attached_at = COALESCE(protection_attached_at, ?),
                position_id = COALESCE(NULLIF(position_id, ''), ?),
                position_status = COALESCE(?, position_status),
                stop_loss_price = COALESCE(?, stop_loss_price),
                take_profit_price = COALESCE(?, take_profit_price),
                protection_plan_json = ?
          WHERE suggested_trade_id = ?
            AND user_id = ?
            AND LOWER(COALESCE(broker_key, '')) = 'mudrex'`,
        [
          now,
          now,
          this.readNullableString(position?.externalId),
          this.readNullableString(position?.status),
          positionProtection.stopLossPrice,
          positionProtection.takeProfitPrice,
          JSON.stringify(nextPlan),
          item.suggestedTradeId,
          item.userId,
        ]
      );
      item.protectionState = 'attached';
      item.protectionLastError = null;
      item.protectionCheckedAt = nowIso;
      item.protectionAttachedAt = item.protectionAttachedAt ?? nowIso;
      item.positionId = item.positionId ?? this.readNullableString(position?.externalId);
      item.positionStatus = this.readNullableString(position?.status) ?? item.positionStatus;
      item.positionStopLossOrderId = positionProtection.stopLossOrderId;
      item.positionTakeProfitOrderId = positionProtection.takeProfitOrderId;
      item.positionStopLossPrice = positionProtection.stopLossPrice;
      item.positionTakeProfitPrice = positionProtection.takeProfitPrice;
      item.positionSize = positionProtection.positionSize;
      item.watchdogStatus = reason === 'broker_verified_after_error' ? reason : 'protected';
      item.watchdogReason =
        reason === 'broker_verified_after_error'
          ? 'Mudrex broker read-back showed active SL/TP, so the previous local protection error was cleared.'
          : 'Mudrex broker read-back showed active SL/TP, so local protection state was marked attached.';
      item.readBackReconciled = true;
      item.readBackReason = reason;
      item.readBackError = null;
      return { reconciled: true, error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      item.readBackError = message;
      return { reconciled: false, error: message };
    }
  }

  private buildMudrexReadBackProtectionPlan(
    plan: Record<string, unknown>,
    positionProtection: ResolvedPositionProtection,
    position: PositionSnapshotRow | null,
    nowIso: string,
    reason: string,
    priorState: string,
    priorError: string | null,
    item: SuggestedTradesProtectionGuardrailItem
  ): Record<string, unknown> {
    const existingTrailing = this.readRecord(plan.trailingStop);
    const audit = {
      at: nowIso,
      action: 'read_back_verified',
      reason,
      source: 'suggested_trades_protection_guardrail',
      brokerKey: 'mudrex',
      symbol: item.symbol,
      positionId: this.readNullableString(position?.externalId),
      positionStatus: this.readNullableString(position?.status),
      positionSize: positionProtection.positionSize,
      stopLossOrderId: positionProtection.stopLossOrderId,
      takeProfitOrderId: positionProtection.takeProfitOrderId,
      stopLossPrice: positionProtection.stopLossPrice,
      takeProfitPrice: positionProtection.takeProfitPrice,
      priorProtectionState: priorState,
      priorProtectionLastError: priorError,
      partialFill: item.partialFill,
      filledQuantity: item.filledQuantity,
      remainingQuantity: item.remainingQuantity,
    };
    const trailingStop =
      Object.keys(existingTrailing).length > 0
        ? {
            ...existingTrailing,
            lastCheckedAt: nowIso,
            lastError: null,
            lastNoopReason: 'broker_readback_verified',
            ...(positionProtection.stopLossPrice
              ? { lastStopLossPrice: positionProtection.stopLossPrice }
              : {}),
            lastAudit: audit,
            auditHistory: [
              ...(Array.isArray(existingTrailing.auditHistory)
                ? existingTrailing.auditHistory
                    .map((entry) => this.readRecord(entry))
                    .filter((entry) => Object.keys(entry).length > 0)
                    .slice(-19)
                : []),
              audit,
            ],
          }
        : undefined;

    return {
      ...plan,
      source: this.readNullableString(plan.source) ?? 'suggested_trade_execution',
      positionId:
        this.readNullableString(plan.positionId) ?? this.readNullableString(position?.externalId),
      snapshotPositionId: this.readNullableString(position?.externalId),
      stopLossOrderId:
        positionProtection.stopLossOrderId ?? this.readNullableString(plan.stopLossOrderId),
      takeProfitOrderId:
        positionProtection.takeProfitOrderId ?? this.readNullableString(plan.takeProfitOrderId),
      attachedStopLossPrice:
        positionProtection.stopLossPrice ?? this.readNullableString(plan.attachedStopLossPrice),
      attachedTakeProfitPrice:
        positionProtection.takeProfitPrice ?? this.readNullableString(plan.attachedTakeProfitPrice),
      mudrexReadBackVerifiedAt: nowIso,
      mudrexReadBackReason: reason,
      mudrexProtectionWatchdog: audit,
      ...(trailingStop ? { trailingStop } : {}),
    };
  }

  private describeMissingPositionProtection(positionProtection: {
    stopLossActive: boolean;
    takeProfitActive: boolean;
  }): string {
    const missing: string[] = [];
    if (!positionProtection.stopLossActive) {
      missing.push('stop loss');
    }
    if (!positionProtection.takeProfitActive) {
      missing.push('take profit');
    }
    return missing.length ? `missing ${missing.join(' and ')}` : 'SL and TP present';
  }

  private resolveWatchdogStatus(input: {
    brokerKey: string;
    protectionState: string;
    hasPosition: boolean;
    missingProtection: boolean;
    protectionLastError: string | null;
  }): ProtectionWatchdogStatus {
    if (!input.hasPosition) {
      return input.protectionState === 'not_required' ? 'not_required' : 'unknown';
    }
    if (input.brokerKey === 'mudrex' && !input.missingProtection && input.protectionLastError) {
      return 'broker_verified_after_error';
    }
    if (!input.missingProtection) {
      return 'protected';
    }
    return input.protectionState === 'not_required' ? 'not_required' : 'needs_repair';
  }

  private resolveWatchdogReason(input: {
    brokerKey: string;
    protectionState: string;
    hasPosition: boolean;
    missingProtection: boolean;
    missingProtectionReason: string;
    protectionLastError: string | null;
  }): string | null {
    if (!input.hasPosition) {
      return null;
    }
    if (input.brokerKey === 'mudrex' && !input.missingProtection && input.protectionLastError) {
      return 'Mudrex broker read-back reports active SL and TP protection despite the local error.';
    }
    if (!input.missingProtection) {
      return 'Broker read-back reports active SL and TP protection.';
    }
    return `Broker read-back reports incomplete protection: ${input.missingProtectionReason}.`;
  }

  private isPartialFill(row: ProtectionExecutionRow): boolean {
    const status = this.readString(row.orderStatus).toUpperCase();
    if (['PARTIALLY_FILLED', 'PARTIAL_FILLED', 'PARTIAL'].includes(status)) {
      return true;
    }
    const quantity = this.readNumber(row.quantity);
    const filledQuantity = this.readNumber(row.filledQuantity);
    const remainingQuantity = this.readNumber(row.remainingQuantity);
    return Boolean(
      (quantity !== null &&
        filledQuantity !== null &&
        filledQuantity > 0 &&
        filledQuantity < quantity) ||
      (remainingQuantity !== null && remainingQuantity > 0)
    );
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

  private readNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const normalized = value.trim();
      if (!normalized || normalized.toLowerCase() === 'null') {
        return null;
      }
      const parsed = Number(normalized);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
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
