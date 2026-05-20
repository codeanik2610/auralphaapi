import { randomUUID } from 'node:crypto';
import { Service } from 'typedi';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { coreDataSource } from '../data-source';
import { SuggestedTrade } from '../entities/SuggestedTrade';
import { SuggestedTradeExecution } from '../entities/SuggestedTradeExecution';

export interface SuggestedTradeInsertPayload {
  automationId: string;
  automationRunId: string;
  userId: string;
  symbol: string;
  timeframe: string;
  side: string;
  signalTime: Date | string | number;
  status?: string;
  confidence?: number | null;
  score?: number | null;
  entryPrice?: number | string | null;
  stopLossPrice?: number | string | null;
  takeProfitTargets?: Array<number | string> | null;
  entryRule?: string | null;
  exitRule?: string | null;
  rationale?: string | null;
  sourceBacktestId?: string | null;
  sourceTemplateId?: string | null;
  sourceSetupKey?: string | null;
  dedupeKey?: string | null;
  meta?: Record<string, unknown> | null;
}

export interface SuggestedTradeListQuery {
  userId: string;
  limit: number;
  offset: number;
  automationId?: string;
  automationRunId?: string;
  status?: string;
  executionState?: string;
  symbol?: string;
  timeframe?: string;
  side?: string;
  search?: string;
}

export interface SuggestedTradeSummaryQuery {
  userId: string;
  automationId?: string;
  automationRunId?: string;
  status?: string;
  executionState?: string;
  symbol?: string;
  timeframe?: string;
  side?: string;
  search?: string;
}

export interface SuggestedTradeFreshnessAuditQuery {
  userId?: string | null;
  createdAfter: Date;
  limit: number;
  automationId?: string;
  automationRunId?: string;
  status?: string;
  executionState?: string;
  symbol?: string;
  timeframe?: string;
  side?: string;
  search?: string;
}

export interface SuggestedTradeExecutionSyncQuery extends SuggestedTradeSummaryQuery {
  limit: number;
  staleBefore?: Date;
  staleOnly?: boolean;
}

export interface SuggestedTradeExecutionSyncSummary {
  tracked: number;
  stale: number;
  terminal: number;
}

export interface SuggestedTradeOperationalSnapshot {
  total: number;
  open: number;
  reviewed: number;
  accepted: number;
  dismissed: number;
  queuedForOrder: number;
  convertedToOrder: number;
  queued: number;
  submitting: number;
  linked: number;
  working: number;
  filled: number;
  closed: number;
  queueToOrderConversionRate: number | null;
}

export interface SuggestedTradeProtectionOperationalSnapshot {
  tracked: number;
  pending: number;
  waitingForFill: number;
  waitingForPosition: number;
  attaching: number;
  attached: number;
  failed: number;
  manualUnlinked: number;
  staleManualUnlinked: number;
  staleAttaching: number;
  notRequired: number;
  unknown: number;
  actionable: number;
  unresolved: number;
  retriableFailed: number;
  lastCheckedAt: Date | null;
  lastAttachedAt: Date | null;
  lastManualActionAt: Date | null;
}

export interface LinkedOrderSnapshot {
  orderStatus: string | null;
  statusRank: number | null;
  lastSeenAt: Date | string | null;
  payload: Record<string, unknown> | null;
}

export interface LinkedPositionSnapshot {
  externalId: string;
  status: string | null;
  statusRank: number | null;
  firstSeenAt: Date | string | null;
  lastSeenAt: Date | string | null;
  payload: Record<string, unknown> | null;
}

export interface LinkedPositionSnapshotLookupOptions {
  preferredPositionOpenedAt?: Date | string | null;
  preferredSide?: string | null;
}

interface LinkedPositionSnapshotRow {
  externalId?: string;
  status?: string | null;
  statusRank?: number | null;
  firstSeenAt?: Date | string | null;
  lastSeenAt?: Date | string | null;
  payload?: unknown;
  readModelStatus?: unknown;
  readModelStatusKey?: unknown;
  readModelQuantity?: unknown;
  readModelEntryPrice?: unknown;
  readModelCurrentPrice?: unknown;
  readModelClosedPrice?: unknown;
  readModelRealizedPnl?: unknown;
  readModelStopLossPrice?: unknown;
  readModelTakeProfitPrice?: unknown;
  readModelStopLossOrderId?: unknown;
  readModelTakeProfitOrderId?: unknown;
  readModelPositionCreatedAt?: unknown;
  readModelPositionUpdatedAt?: unknown;
  readModelPositionClosedAt?: unknown;
  preferredOpenedDiffSeconds?: number | string | null;
}

export interface SuggestedTradeExecutionUpsertPayload {
  suggestedTradeId: string;
  userId: string;
  executionMode?: string | null;
  preTradeCheckId?: string | null;
  preTradeState?: string | null;
  preTradeCheckedAt?: Date | string | null;
  preTradeBlockedReason?: string | null;
  acceptedBy?: string | null;
  acceptedAt?: Date | string | null;
  orderId?: string | null;
  paperOrderId?: string | null;
  brokerKey?: string | null;
  accountId?: string | null;
  orderStatus?: string | null;
  paperOrderStatus?: string | null;
  executionState?: string | null;
  orderType?: string | null;
  triggerType?: string | null;
  leverage?: number | null;
  quantity?: number | null;
  entryPrice?: string | null;
  stopLossPrice?: string | null;
  takeProfitPrice?: string | null;
  protectionState?: string | null;
  protectionSource?: string | null;
  protectionPlan?: Record<string, unknown> | null;
  routeAttempts?: unknown[] | null;
  protectionAttempts?: number | null;
  protectionLastError?: string | null;
  protectionCheckedAt?: Date | string | null;
  protectionAttachedAt?: Date | string | null;
  submittedAt?: Date | string | null;
  linkedAt?: Date | string | null;
  lastSeenAt?: Date | string | null;
  filledAt?: Date | string | null;
  canceledAt?: Date | string | null;
  filledPrice?: string | null;
  filledQuantity?: number | null;
  remainingQuantity?: number | null;
  positionId?: string | null;
  positionStatus?: string | null;
  positionOpenedAt?: Date | string | null;
  positionClosedAt?: Date | string | null;
  exitPrice?: string | null;
  realizedPnl?: string | null;
  outcome?: string | null;
  note?: string | null;
}

const normalizeDate = (value: Date | string | number): Date => {
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === 'number') {
    return new Date(value > 1e12 ? value : value * 1000);
  }
  return new Date(value);
};

const normalizeDecimal = (value: number | string | null | undefined): string | null => {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const numeric = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return String(numeric);
};

const normalizeOptionalString = (value: unknown): string | null => {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized ? normalized : null;
};

const normalizeOptionalNumber = (value: unknown): number | null => {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const normalizeOperationalCount = (value: unknown): number => {
  const numeric = normalizeOptionalNumber(value);
  return numeric === null ? 0 : Math.max(0, Math.floor(numeric));
};

const normalizeOptionalUnsignedInteger = (value: unknown): number => {
  const numeric = normalizeOptionalNumber(value);
  if (numeric === null) {
    return 0;
  }
  return Math.max(0, Math.floor(numeric));
};

const normalizeOptionalRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

const normalizeOptionalRecordArray = (
  value: unknown[] | null | undefined
): Array<Record<string, unknown>> | null => {
  if (!Array.isArray(value)) {
    return null;
  }
  const normalized = value.filter(
    (item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === 'object' && !Array.isArray(item)
  );
  return normalized.length ? normalized : null;
};

const normalizeOptionalDate = (value: Date | string | null | undefined): Date | null => {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
};

const buildDedupeKey = (payload: SuggestedTradeInsertPayload): string =>
  [
    payload.automationId,
    payload.symbol.trim().toUpperCase(),
    payload.timeframe.trim(),
    payload.side.trim().toUpperCase(),
    normalizeDate(payload.signalTime).toISOString(),
    payload.sourceSetupKey?.trim() || '',
  ].join(':');

const EXECUTION_LOOKUP_CHUNK_SIZE = 200;
const TERMINAL_EXECUTION_STATES = ['closed', 'cancelled', 'rejected', 'expired', 'failed'];
const AUTOMATIC_REMEDIABLE_PROTECTION_STATES = [
  'pending',
  'waiting_for_fill',
  'waiting_for_position',
  'attaching',
];
const MANUAL_REMEDIABLE_PROTECTION_STATE = 'manual_unlinked';
const RETRIABLE_FAILED_PROTECTION_ERROR_PATTERNS = [
  '%position not found%',
  '%bad request%',
  '%invalid stop loss price%',
  '%replacement protection is required%',
];

@Service()
export class SuggestedTradeRepository {
  private get repository(): Repository<SuggestedTrade> {
    return coreDataSource.getRepository(SuggestedTrade);
  }

  private get executionRepository(): Repository<SuggestedTradeExecution> {
    return coreDataSource.getRepository(SuggestedTradeExecution);
  }

  async listSuggestedTrades(
    query: SuggestedTradeListQuery
  ): Promise<{ items: SuggestedTrade[]; total: number }> {
    const builder = this.buildFilteredSuggestedTradesQuery(query, {
      withExecution: true,
    })
      .orderBy('suggested_trade.signalTime', 'DESC')
      .skip(query.offset)
      .take(query.limit);

    const [items, total] = await builder.getManyAndCount();
    return { items, total };
  }

  async getSuggestedTradeById(
    userId: string,
    suggestedTradeId: string
  ): Promise<SuggestedTrade | null> {
    return this.repository
      .createQueryBuilder('suggested_trade')
      .leftJoinAndSelect('suggested_trade.executionRecord', 'execution_record')
      .where('suggested_trade.id = :suggestedTradeId', { suggestedTradeId })
      .andWhere('suggested_trade.userId = :userId', { userId })
      .getOne();
  }

  async getSuggestedTradesByIds(
    userId: string,
    suggestedTradeIds: string[]
  ): Promise<SuggestedTrade[]> {
    return this.loadSuggestedTradesByIds(userId, suggestedTradeIds);
  }

  async saveSuggestedTrade(item: SuggestedTrade): Promise<SuggestedTrade> {
    return this.repository.save(item);
  }

  async saveSuggestedTradeExecution(
    payload: SuggestedTradeExecutionUpsertPayload
  ): Promise<SuggestedTradeExecution> {
    const safePayload = await this.preserveExistingLiveExecutionLink(payload);
    const entity = this.executionRepository.create({
      suggestedTradeId: safePayload.suggestedTradeId,
      userId: safePayload.userId,
      executionMode: normalizeOptionalString(safePayload.executionMode)?.toLowerCase() ?? null,
      preTradeCheckId: normalizeOptionalString(safePayload.preTradeCheckId),
      preTradeState: normalizeOptionalString(safePayload.preTradeState)?.toLowerCase() ?? null,
      preTradeCheckedAt: normalizeOptionalDate(safePayload.preTradeCheckedAt),
      preTradeBlockedReason: normalizeOptionalString(safePayload.preTradeBlockedReason),
      acceptedBy: normalizeOptionalString(safePayload.acceptedBy)?.toLowerCase() ?? null,
      acceptedAt: normalizeOptionalDate(safePayload.acceptedAt),
      orderId: normalizeOptionalString(safePayload.orderId),
      paperOrderId: normalizeOptionalString(safePayload.paperOrderId),
      brokerKey: normalizeOptionalString(safePayload.brokerKey)?.toLowerCase() ?? null,
      accountId: normalizeOptionalString(safePayload.accountId),
      orderStatus: normalizeOptionalString(safePayload.orderStatus),
      paperOrderStatus: normalizeOptionalString(safePayload.paperOrderStatus),
      executionState: normalizeOptionalString(safePayload.executionState)?.toLowerCase() ?? null,
      orderType: normalizeOptionalString(safePayload.orderType),
      triggerType: normalizeOptionalString(safePayload.triggerType),
      leverage: normalizeOptionalNumber(safePayload.leverage),
      quantity: normalizeOptionalNumber(safePayload.quantity),
      entryPrice: normalizeDecimal(safePayload.entryPrice),
      stopLossPrice: normalizeDecimal(safePayload.stopLossPrice),
      takeProfitPrice: normalizeDecimal(safePayload.takeProfitPrice),
      protectionState: normalizeOptionalString(safePayload.protectionState)?.toLowerCase() ?? null,
      protectionSource:
        normalizeOptionalString(safePayload.protectionSource)?.toLowerCase() ?? null,
      protectionPlan: normalizeOptionalRecord(safePayload.protectionPlan),
      routeAttempts: normalizeOptionalRecordArray(safePayload.routeAttempts),
      protectionAttempts: normalizeOptionalUnsignedInteger(safePayload.protectionAttempts),
      protectionLastError: normalizeOptionalString(safePayload.protectionLastError),
      protectionCheckedAt: normalizeOptionalDate(safePayload.protectionCheckedAt),
      protectionAttachedAt: normalizeOptionalDate(safePayload.protectionAttachedAt),
      submittedAt: normalizeOptionalDate(safePayload.submittedAt),
      linkedAt: normalizeOptionalDate(safePayload.linkedAt),
      lastSeenAt: normalizeOptionalDate(safePayload.lastSeenAt),
      filledAt: normalizeOptionalDate(safePayload.filledAt),
      canceledAt: normalizeOptionalDate(safePayload.canceledAt),
      filledPrice: normalizeDecimal(safePayload.filledPrice),
      filledQuantity: normalizeOptionalNumber(safePayload.filledQuantity),
      remainingQuantity: normalizeOptionalNumber(safePayload.remainingQuantity),
      positionId: normalizeOptionalString(safePayload.positionId),
      positionStatus: normalizeOptionalString(safePayload.positionStatus),
      positionOpenedAt: normalizeOptionalDate(safePayload.positionOpenedAt),
      positionClosedAt: normalizeOptionalDate(safePayload.positionClosedAt),
      exitPrice: normalizeDecimal(safePayload.exitPrice),
      realizedPnl: normalizeDecimal(safePayload.realizedPnl),
      outcome: normalizeOptionalString(safePayload.outcome)?.toLowerCase() ?? null,
      note: normalizeOptionalString(safePayload.note),
    });

    return this.executionRepository.save(entity);
  }

  private async preserveExistingLiveExecutionLink(
    payload: SuggestedTradeExecutionUpsertPayload
  ): Promise<SuggestedTradeExecutionUpsertPayload> {
    const incomingMode = normalizeOptionalString(payload.executionMode)?.toLowerCase();
    if (incomingMode && incomingMode !== 'live') {
      return payload;
    }

    const existing = await this.executionRepository.findOne({
      where: { suggestedTradeId: payload.suggestedTradeId },
    });
    const existingOrderId = normalizeOptionalString(existing?.orderId);
    if (!existing) {
      return payload;
    }

    const existingMode = normalizeOptionalString(existing.executionMode)?.toLowerCase();
    if (existingMode !== 'live') {
      return payload;
    }
    const preferExistingTrailingState = this.shouldPreferExistingTrailingState(
      payload.protectionPlan,
      existing.protectionPlan
    );

    return {
      ...payload,
      executionMode: normalizeOptionalString(payload.executionMode) ?? existing.executionMode,
      orderId: normalizeOptionalString(payload.orderId) ?? existingOrderId,
      brokerKey: normalizeOptionalString(payload.brokerKey) ?? existing.brokerKey,
      accountId: normalizeOptionalString(payload.accountId) ?? existing.accountId,
      stopLossPrice: preferExistingTrailingState ? existing.stopLossPrice : payload.stopLossPrice,
      takeProfitPrice: preferExistingTrailingState
        ? existing.takeProfitPrice
        : payload.takeProfitPrice,
      linkedAt: payload.linkedAt ?? existing.linkedAt,
      protectionSource:
        normalizeOptionalString(payload.protectionSource) ?? existing.protectionSource,
      protectionPlan: this.mergeProtectionPlanLinkFields(
        payload.protectionPlan,
        existing.protectionPlan
      ),
      protectionLastError: preferExistingTrailingState
        ? existing.protectionLastError
        : payload.protectionLastError,
      protectionCheckedAt: preferExistingTrailingState
        ? existing.protectionCheckedAt
        : payload.protectionCheckedAt,
    };
  }

  private mergeProtectionPlanLinkFields(
    incoming: Record<string, unknown> | null | undefined,
    existing: Record<string, unknown> | null | undefined
  ): Record<string, unknown> | null | undefined {
    const existingPlan = normalizeOptionalRecord(existing);
    if (!existingPlan) {
      return incoming;
    }

    const incomingPlan = normalizeOptionalRecord(incoming);
    if (!incomingPlan) {
      return existingPlan;
    }

    const preferExistingTrailingState = this.shouldPreferExistingTrailingState(
      incomingPlan,
      existingPlan
    );
    const selectedProtectionPlan = preferExistingTrailingState ? existingPlan : incomingPlan;
    const trailingStop =
      (preferExistingTrailingState
        ? normalizeOptionalRecord(existingPlan.trailingStop)
        : normalizeOptionalRecord(incomingPlan.trailingStop)) ??
      normalizeOptionalRecord(existingPlan.trailingStop);

    const merged: Record<string, unknown> = { ...incomingPlan };
    const setOptionalField = (key: string, value: unknown): void => {
      if (value === undefined || value === null || value === '') {
        delete merged[key];
        return;
      }
      merged[key] = value;
    };

    setOptionalField(
      'orderId',
      normalizeOptionalString(incomingPlan.orderId) ?? existingPlan.orderId
    );
    setOptionalField(
      'stopLossOrderId',
      normalizeOptionalString(selectedProtectionPlan.stopLossOrderId) ??
        normalizeOptionalString(incomingPlan.stopLossOrderId) ??
        existingPlan.stopLossOrderId
    );
    setOptionalField(
      'takeProfitOrderId',
      normalizeOptionalString(selectedProtectionPlan.takeProfitOrderId) ??
        normalizeOptionalString(incomingPlan.takeProfitOrderId) ??
        existingPlan.takeProfitOrderId
    );
    setOptionalField(
      'attachedStopLossPrice',
      normalizeOptionalString(selectedProtectionPlan.attachedStopLossPrice) ??
        incomingPlan.attachedStopLossPrice ??
        existingPlan.attachedStopLossPrice
    );
    setOptionalField(
      'attachedTakeProfitPrice',
      normalizeOptionalString(selectedProtectionPlan.attachedTakeProfitPrice) ??
        incomingPlan.attachedTakeProfitPrice ??
        existingPlan.attachedTakeProfitPrice
    );
    setOptionalField(
      'positionId',
      normalizeOptionalString(selectedProtectionPlan.positionId) ??
        normalizeOptionalString(incomingPlan.positionId) ??
        existingPlan.positionId
    );
    setOptionalField(
      'snapshotPositionId',
      normalizeOptionalString(selectedProtectionPlan.snapshotPositionId) ??
        normalizeOptionalString(incomingPlan.snapshotPositionId) ??
        existingPlan.snapshotPositionId
    );
    if (trailingStop) {
      merged.trailingStop = trailingStop;
    }

    return merged;
  }

  private shouldPreferExistingTrailingState(
    incoming: Record<string, unknown> | null | undefined,
    existing: Record<string, unknown> | null | undefined
  ): boolean {
    const incomingPlan = normalizeOptionalRecord(incoming);
    const existingPlan = normalizeOptionalRecord(existing);
    if (!existingPlan) {
      return false;
    }
    const incomingTrailing = normalizeOptionalRecord(incomingPlan?.trailingStop);
    const existingTrailing = normalizeOptionalRecord(existingPlan.trailingStop);
    if (!existingTrailing) {
      return false;
    }
    if (!incomingTrailing) {
      return true;
    }

    const incomingFreshness = this.readTrailingStopFreshness(incomingTrailing);
    const existingFreshness = this.readTrailingStopFreshness(existingTrailing);
    if (existingFreshness.appliedWhenProfitR !== incomingFreshness.appliedWhenProfitR) {
      return existingFreshness.appliedWhenProfitR > incomingFreshness.appliedWhenProfitR;
    }
    if (existingFreshness.moveStopToR !== incomingFreshness.moveStopToR) {
      return existingFreshness.moveStopToR > incomingFreshness.moveStopToR;
    }
    if (existingFreshness.appliedAtMs !== incomingFreshness.appliedAtMs) {
      return existingFreshness.appliedAtMs > incomingFreshness.appliedAtMs;
    }
    return existingFreshness.checkedAtMs > incomingFreshness.checkedAtMs;
  }

  private readTrailingStopFreshness(record: Record<string, unknown>): {
    appliedAtMs: number;
    checkedAtMs: number;
    appliedWhenProfitR: number;
    moveStopToR: number;
  } {
    const history = Array.isArray(record.history) ? record.history : [];
    const lastHistory = normalizeOptionalRecord(history[history.length - 1]);
    const appliedAtMs = Math.max(
      this.toTimestampMs(record.lastUpdatedAt),
      this.toTimestampMs(lastHistory?.at)
    );
    return {
      appliedAtMs,
      checkedAtMs: this.toTimestampMs(record.lastCheckedAt),
      appliedWhenProfitR: normalizeOptionalNumber(record.lastAppliedWhenProfitR) ?? -Infinity,
      moveStopToR: normalizeOptionalNumber(record.lastMoveStopToR) ?? -Infinity,
    };
  }

  private toTimestampMs(value: unknown): number {
    const normalized = normalizeOptionalString(value);
    if (!normalized) {
      return 0;
    }
    const timestamp = Date.parse(normalized);
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  async getLinkedOrderSnapshot(
    userId: string,
    brokerKey: string,
    accountId: string,
    orderId: string
  ): Promise<LinkedOrderSnapshot | null> {
    const rows = (await coreDataSource.query(
      `SELECT order_status AS orderStatus,
              status_rank AS statusRank,
              last_seen_at AS lastSeenAt,
              payload_json AS payload
         FROM scheduler_orders_snapshots
        WHERE user_id = ?
          AND account_id = ?
          AND LOWER(broker_key) = ?
          AND external_id = ?
        LIMIT 1`,
      [userId, accountId, brokerKey.toLowerCase(), orderId]
    )) as Array<{
      orderStatus?: string | null;
      statusRank?: number | null;
      lastSeenAt?: Date | string | null;
      payload?: unknown;
    }>;

    if (!rows.length) {
      return null;
    }

    const payload = rows[0].payload;
    let parsedPayload: Record<string, unknown> | null = null;
    if (typeof payload === 'string') {
      try {
        const parsed = JSON.parse(payload) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          parsedPayload = parsed as Record<string, unknown>;
        }
      } catch {
        parsedPayload = null;
      }
    } else if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      parsedPayload = payload as Record<string, unknown>;
    }

    return {
      orderStatus: rows[0].orderStatus ?? null,
      statusRank:
        rows[0].statusRank === undefined || rows[0].statusRank === null
          ? null
          : Number(rows[0].statusRank),
      lastSeenAt: rows[0].lastSeenAt ?? null,
      payload: parsedPayload,
    };
  }

  async getLinkedPositionSnapshots(
    userId: string,
    brokerKey: string,
    accountId: string,
    symbol: string,
    since: Date,
    limit = 20,
    preferredExternalId?: string | null,
    options: LinkedPositionSnapshotLookupOptions = {}
  ): Promise<LinkedPositionSnapshot[]> {
    const normalizedBrokerKey = brokerKey.toLowerCase();
    const symbolLookupValues = this.buildSymbolLookupValues(normalizedBrokerKey, [symbol]);
    if (!symbolLookupValues.length) {
      return [];
    }
    const normalizedPreferredExternalId = normalizeOptionalString(preferredExternalId);

    const rows = (await coreDataSource.query(
      `SELECT scheduler_position.external_id AS externalId,
              COALESCE(position_model.status, scheduler_position.status) AS status,
              COALESCE(position_model.status_rank, scheduler_position.status_rank) AS statusRank,
              COALESCE(position_model.position_created_at, scheduler_position.first_seen_at) AS firstSeenAt,
              COALESCE(position_model.last_seen_at, scheduler_position.last_seen_at) AS lastSeenAt,
              scheduler_position.payload_json AS payload,
              position_model.status AS readModelStatus,
              position_model.status_key AS readModelStatusKey,
              position_model.quantity AS readModelQuantity,
              position_model.entry_price AS readModelEntryPrice,
              position_model.current_price AS readModelCurrentPrice,
              position_model.closed_price AS readModelClosedPrice,
              position_model.realized_pnl AS readModelRealizedPnl,
              position_model.stoploss_price AS readModelStopLossPrice,
              position_model.takeprofit_price AS readModelTakeProfitPrice,
              position_model.stoploss_order_id AS readModelStopLossOrderId,
              position_model.takeprofit_order_id AS readModelTakeProfitOrderId,
              position_model.position_created_at AS readModelPositionCreatedAt,
              position_model.position_updated_at AS readModelPositionUpdatedAt,
              position_model.position_closed_at AS readModelPositionClosedAt
         FROM scheduler_positions_snapshots scheduler_position
         LEFT JOIN position_read_models position_model
                ON position_model.user_id = scheduler_position.user_id
               AND position_model.account_id = scheduler_position.account_id
               AND LOWER(position_model.broker_key) = LOWER(scheduler_position.broker_key)
               AND position_model.external_id = scheduler_position.external_id
        WHERE scheduler_position.user_id = ?
          AND scheduler_position.account_id = ?
          AND LOWER(scheduler_position.broker_key) = ?
          AND LOWER(scheduler_position.symbol) IN (${symbolLookupValues.map(() => '?').join(',')})
          AND scheduler_position.last_seen_at >= ?
        ORDER BY CASE
                   WHEN ? <> '' AND scheduler_position.external_id = ? THEN 0
                   ELSE 1
                 END,
                 scheduler_position.status_rank DESC,
                 scheduler_position.last_seen_at DESC
        LIMIT ?`,
      [
        userId,
        accountId,
        normalizedBrokerKey,
        ...symbolLookupValues,
        since,
        normalizedPreferredExternalId ?? '',
        normalizedPreferredExternalId ?? '',
        Math.max(1, Math.floor(limit)),
      ]
    )) as LinkedPositionSnapshotRow[];

    const preferredRows = normalizedPreferredExternalId
      ? ((await coreDataSource.query(
          `SELECT position_model.external_id AS externalId,
                  position_model.status,
                  position_model.status_rank AS statusRank,
                  position_model.position_created_at AS firstSeenAt,
                  position_model.last_seen_at AS lastSeenAt,
                  position_model.payload_json AS payload,
                  position_model.status AS readModelStatus,
                  position_model.status_key AS readModelStatusKey,
                  position_model.quantity AS readModelQuantity,
                  position_model.entry_price AS readModelEntryPrice,
                  position_model.current_price AS readModelCurrentPrice,
                  position_model.closed_price AS readModelClosedPrice,
                  position_model.realized_pnl AS readModelRealizedPnl,
                  position_model.stoploss_price AS readModelStopLossPrice,
                  position_model.takeprofit_price AS readModelTakeProfitPrice,
                  position_model.stoploss_order_id AS readModelStopLossOrderId,
                  position_model.takeprofit_order_id AS readModelTakeProfitOrderId,
                  position_model.position_created_at AS readModelPositionCreatedAt,
                  position_model.position_updated_at AS readModelPositionUpdatedAt,
                  position_model.position_closed_at AS readModelPositionClosedAt
             FROM position_read_models position_model
            WHERE position_model.user_id = ?
              AND position_model.account_id = ?
              AND LOWER(position_model.broker_key) = ?
              AND position_model.external_id = ?
            LIMIT 1`,
          [userId, accountId, normalizedBrokerKey, normalizedPreferredExternalId]
        )) as LinkedPositionSnapshotRow[])
      : [];
    const resolvedPreferredRows =
      normalizedBrokerKey === 'mudrex' && normalizedPreferredExternalId && !preferredRows.length
        ? await this.getMudrexResolvedPreferredPositionRows(
            userId,
            accountId,
            normalizedBrokerKey,
            symbolLookupValues,
            normalizedPreferredExternalId,
            options
          )
        : [];
    const schedulerRows =
      normalizedBrokerKey === 'mudrex' && normalizedPreferredExternalId
        ? this.filterMudrexPreferredPositionRows(rows, normalizedPreferredExternalId, options, true)
        : rows;

    const snapshots: LinkedPositionSnapshot[] = [];
    const seenExternalIds = new Set<string>();
    for (const row of [...preferredRows, ...resolvedPreferredRows, ...schedulerRows]) {
      const externalId = String(row.externalId || '').trim();
      if (!externalId || seenExternalIds.has(externalId)) {
        continue;
      }
      seenExternalIds.add(externalId);
      snapshots.push({
        externalId,
        status: row.status ?? null,
        statusRank:
          row.statusRank === undefined || row.statusRank === null ? null : Number(row.statusRank),
        firstSeenAt: row.firstSeenAt ?? null,
        lastSeenAt: row.lastSeenAt ?? null,
        payload: this.mergeReadModelProtectionIntoPositionPayload(row),
      });
    }

    return snapshots;
  }

  private async getMudrexResolvedPreferredPositionRows(
    userId: string,
    accountId: string,
    brokerKey: string,
    symbolLookupValues: string[],
    preferredExternalId: string,
    options: LinkedPositionSnapshotLookupOptions
  ): Promise<LinkedPositionSnapshotRow[]> {
    const rawRows = (await coreDataSource.query(
      `SELECT position_model.external_id AS externalId,
              position_model.status,
              position_model.status_rank AS statusRank,
              position_model.position_created_at AS firstSeenAt,
              position_model.last_seen_at AS lastSeenAt,
              position_model.payload_json AS payload,
              position_model.status AS readModelStatus,
              position_model.status_key AS readModelStatusKey,
              position_model.quantity AS readModelQuantity,
              position_model.entry_price AS readModelEntryPrice,
              position_model.current_price AS readModelCurrentPrice,
              position_model.closed_price AS readModelClosedPrice,
              position_model.realized_pnl AS readModelRealizedPnl,
              position_model.stoploss_price AS readModelStopLossPrice,
              position_model.takeprofit_price AS readModelTakeProfitPrice,
              position_model.stoploss_order_id AS readModelStopLossOrderId,
              position_model.takeprofit_order_id AS readModelTakeProfitOrderId,
              position_model.position_created_at AS readModelPositionCreatedAt,
              position_model.position_updated_at AS readModelPositionUpdatedAt,
              position_model.position_closed_at AS readModelPositionClosedAt
         FROM position_read_models position_model
        WHERE position_model.user_id = ?
          AND position_model.account_id = ?
          AND LOWER(position_model.broker_key) = ?
          AND (
            position_model.external_id = ?
            OR NULLIF(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(position_model.payload_json, '$.id')), 'null'), '') = ?
            OR NULLIF(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(position_model.payload_json, '$.position_id')), 'null'), '') = ?
            OR NULLIF(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(position_model.payload_json, '$.positionId')), 'null'), '') = ?
            OR CAST(position_model.payload_json AS CHAR) LIKE ?
          )
        ORDER BY position_model.last_seen_at DESC
        LIMIT 10`,
      [
        userId,
        accountId,
        brokerKey,
        preferredExternalId,
        preferredExternalId,
        preferredExternalId,
        preferredExternalId,
        `%${preferredExternalId}%`,
      ]
    )) as LinkedPositionSnapshotRow[];
    const directRows = this.filterMudrexPreferredPositionRows(
      rawRows,
      preferredExternalId,
      options,
      false
    );
    if (directRows.length) {
      return directRows;
    }

    const openedAt = normalizeOptionalDate(options.preferredPositionOpenedAt);
    const expectedDirection = this.normalizeMudrexDirection(options.preferredSide);
    if (!openedAt || !expectedDirection || !symbolLookupValues.length) {
      return [];
    }

    const timeRows = (await coreDataSource.query(
      `SELECT position_model.external_id AS externalId,
              position_model.status,
              position_model.status_rank AS statusRank,
              position_model.position_created_at AS firstSeenAt,
              position_model.last_seen_at AS lastSeenAt,
              position_model.payload_json AS payload,
              position_model.status AS readModelStatus,
              position_model.status_key AS readModelStatusKey,
              position_model.quantity AS readModelQuantity,
              position_model.entry_price AS readModelEntryPrice,
              position_model.current_price AS readModelCurrentPrice,
              position_model.closed_price AS readModelClosedPrice,
              position_model.realized_pnl AS readModelRealizedPnl,
              position_model.stoploss_price AS readModelStopLossPrice,
              position_model.takeprofit_price AS readModelTakeProfitPrice,
              position_model.stoploss_order_id AS readModelStopLossOrderId,
              position_model.takeprofit_order_id AS readModelTakeProfitOrderId,
              position_model.position_created_at AS readModelPositionCreatedAt,
              position_model.position_updated_at AS readModelPositionUpdatedAt,
              position_model.position_closed_at AS readModelPositionClosedAt,
              ABS(TIMESTAMPDIFF(SECOND, position_model.position_created_at, ?)) AS preferredOpenedDiffSeconds
         FROM position_read_models position_model
        WHERE position_model.user_id = ?
          AND position_model.account_id = ?
          AND LOWER(position_model.broker_key) = ?
          AND LOWER(position_model.symbol) IN (${symbolLookupValues.map(() => '?').join(',')})
          AND position_model.position_created_at IS NOT NULL
          AND position_model.position_created_at BETWEEN DATE_SUB(?, INTERVAL 30 MINUTE)
                                                   AND DATE_ADD(?, INTERVAL 30 MINUTE)
        ORDER BY preferredOpenedDiffSeconds ASC, position_model.last_seen_at DESC
        LIMIT 10`,
      [openedAt, userId, accountId, brokerKey, ...symbolLookupValues, openedAt, openedAt]
    )) as LinkedPositionSnapshotRow[];

    return this.filterMudrexPreferredPositionRows(timeRows, preferredExternalId, options, true);
  }

  private filterMudrexPreferredPositionRows(
    rows: LinkedPositionSnapshotRow[],
    preferredExternalId: string,
    options: LinkedPositionSnapshotLookupOptions,
    allowTimeFallback: boolean
  ): LinkedPositionSnapshotRow[] {
    const expectedDirection = this.normalizeMudrexDirection(options.preferredSide);
    const directRows = rows.filter((row) =>
      this.isMudrexDirectPositionIdentifierMatch(row, preferredExternalId)
    );
    if (directRows.length) {
      return directRows.filter((row) => {
        const direction = this.resolveMudrexPositionRowDirection(row);
        return !expectedDirection || !direction || direction === expectedDirection;
      });
    }
    if (!allowTimeFallback || !expectedDirection) {
      return [];
    }

    const anchor = normalizeOptionalDate(options.preferredPositionOpenedAt);
    if (!anchor) {
      return [];
    }
    const anchorMs = anchor.getTime();
    const compatibleRows = rows
      .map((row) => {
        const direction = this.resolveMudrexPositionRowDirection(row);
        if (direction !== expectedDirection) {
          return null;
        }
        const diffSeconds =
          normalizeOptionalNumber(row.preferredOpenedDiffSeconds) ??
          this.resolveMudrexPositionOpenedDiffSeconds(row, anchorMs);
        if (diffSeconds === null || diffSeconds > 30 * 60) {
          return null;
        }
        return { row, diffSeconds };
      })
      .filter((item): item is { row: LinkedPositionSnapshotRow; diffSeconds: number } =>
        Boolean(item)
      )
      .sort((a, b) => a.diffSeconds - b.diffSeconds);

    const tightRows = compatibleRows.filter((item) => item.diffSeconds <= 5);
    if (tightRows.length === 1) {
      return [tightRows[0].row];
    }
    if (tightRows.length > 1) {
      return [];
    }

    const oneMinuteRows = compatibleRows.filter((item) => item.diffSeconds <= 60);
    return oneMinuteRows.length === 1 ? [oneMinuteRows[0].row] : [];
  }

  private isMudrexDirectPositionIdentifierMatch(
    row: LinkedPositionSnapshotRow,
    preferredExternalId: string
  ): boolean {
    const payload = this.parsePayloadObject(row.payload);
    const identifiers = [
      row.externalId,
      payload?.id,
      payload?.position_id,
      payload?.positionId,
      this.buildMudrexSyntheticPositionId(row, payload),
    ];
    return identifiers.some((value) => normalizeOptionalString(value) === preferredExternalId);
  }

  private buildMudrexSyntheticPositionId(
    row: LinkedPositionSnapshotRow,
    payload: Record<string, unknown> | null = this.parsePayloadObject(row.payload)
  ): string | null {
    const assetUuid =
      normalizeOptionalString(payload?.asset_uuid) ?? normalizeOptionalString(payload?.assetUuid);
    const openedAt =
      normalizeOptionalDate(row.readModelPositionCreatedAt as Date | string | null | undefined) ??
      normalizeOptionalDate(row.firstSeenAt as Date | string | null | undefined) ??
      normalizeOptionalDate(payload?.created_at as Date | string | null | undefined) ??
      normalizeOptionalDate(payload?.createdAt as Date | string | null | undefined) ??
      normalizeOptionalDate(payload?.opened_at as Date | string | null | undefined) ??
      normalizeOptionalDate(payload?.openedAt as Date | string | null | undefined);
    const direction = this.resolveMudrexPositionRowDirection(row, payload);
    if (!assetUuid || !openedAt || !direction) {
      return null;
    }
    return `mudrex:${assetUuid}:${openedAt.toISOString().replace('.000Z', 'Z')}:${direction}`;
  }

  private resolveMudrexPositionRowDirection(
    row: LinkedPositionSnapshotRow,
    payload: Record<string, unknown> | null = this.parsePayloadObject(row.payload)
  ): 'LONG' | 'SHORT' | null {
    const explicit =
      this.normalizeMudrexDirection(payload?.position_type) ??
      this.normalizeMudrexDirection(payload?.positionType) ??
      this.normalizeMudrexDirection(payload?.order_type) ??
      this.normalizeMudrexDirection(payload?.orderType) ??
      this.normalizeMudrexDirection(payload?.side) ??
      this.normalizeMudrexDirection(payload?.position_side) ??
      this.normalizeMudrexDirection(payload?.positionSide);
    if (explicit) {
      return explicit;
    }
    const suffix = normalizeOptionalString(row.externalId)?.split(':').pop();
    return this.normalizeMudrexDirection(suffix);
  }

  private normalizeMudrexDirection(value: unknown): 'LONG' | 'SHORT' | null {
    const normalized = normalizeOptionalString(value)?.toUpperCase();
    if (!normalized) {
      return null;
    }
    if (normalized === 'BUY' || normalized === 'LONG') {
      return 'LONG';
    }
    if (normalized === 'SELL' || normalized === 'SHORT') {
      return 'SHORT';
    }
    return null;
  }

  private resolveMudrexPositionOpenedDiffSeconds(
    row: LinkedPositionSnapshotRow,
    anchorMs: number
  ): number | null {
    const payload = this.parsePayloadObject(row.payload);
    const openedAt =
      normalizeOptionalDate(row.readModelPositionCreatedAt as Date | string | null | undefined) ??
      normalizeOptionalDate(row.firstSeenAt as Date | string | null | undefined) ??
      normalizeOptionalDate(payload?.created_at as Date | string | null | undefined) ??
      normalizeOptionalDate(payload?.createdAt as Date | string | null | undefined) ??
      normalizeOptionalDate(payload?.opened_at as Date | string | null | undefined) ??
      normalizeOptionalDate(payload?.openedAt as Date | string | null | undefined);
    if (!openedAt) {
      return null;
    }
    return Math.abs(openedAt.getTime() - anchorMs) / 1000;
  }

  async findLinkedTradesByOrderIds(
    userId: string,
    brokerKey: string,
    accountId: string,
    orderIds: string[]
  ): Promise<SuggestedTrade[]> {
    const normalizedOrderIds = Array.from(
      new Set(orderIds.map((value) => String(value || '').trim()).filter(Boolean))
    );
    if (!normalizedOrderIds.length) {
      return [];
    }

    const collectedIds = new Set<string>();
    for (let index = 0; index < normalizedOrderIds.length; index += EXECUTION_LOOKUP_CHUNK_SIZE) {
      const chunk = normalizedOrderIds.slice(index, index + EXECUTION_LOOKUP_CHUNK_SIZE);
      const rows = (await coreDataSource.query(
        `SELECT suggested_trade.id AS id
           FROM suggested_trade_executions execution_row
           INNER JOIN suggested_trades suggested_trade
                   ON suggested_trade.id = execution_row.suggested_trade_id
          WHERE execution_row.user_id = ?
            AND LOWER(COALESCE(execution_row.broker_key, '')) = ?
            AND COALESCE(execution_row.account_id, '') = ?
            AND COALESCE(execution_row.order_id, '') IN (${chunk.map(() => '?').join(',')})`,
        [userId, brokerKey.toLowerCase(), accountId, ...chunk]
      )) as Array<{ id?: string }>;

      for (const row of rows) {
        const tradeId = String(row.id || '').trim();
        if (tradeId) {
          collectedIds.add(tradeId);
        }
      }
    }

    return this.loadSuggestedTradesByIds(userId, Array.from(collectedIds));
  }

  async findLinkedTradesByPositionIds(
    userId: string,
    brokerKey: string,
    accountId: string,
    positionIds: string[]
  ): Promise<SuggestedTrade[]> {
    const normalizedPositionIds = Array.from(
      new Set(positionIds.map((value) => String(value || '').trim()).filter(Boolean))
    );
    if (!normalizedPositionIds.length) {
      return [];
    }

    const collectedIds = new Set<string>();
    for (
      let index = 0;
      index < normalizedPositionIds.length;
      index += EXECUTION_LOOKUP_CHUNK_SIZE
    ) {
      const chunk = normalizedPositionIds.slice(index, index + EXECUTION_LOOKUP_CHUNK_SIZE);
      const rows = (await coreDataSource.query(
        `SELECT suggested_trade.id AS id
           FROM suggested_trade_executions execution_row
           INNER JOIN suggested_trades suggested_trade
                   ON suggested_trade.id = execution_row.suggested_trade_id
          WHERE execution_row.user_id = ?
            AND LOWER(COALESCE(execution_row.broker_key, '')) = ?
            AND COALESCE(execution_row.account_id, '') = ?
            AND COALESCE(execution_row.position_id, '') IN (${chunk.map(() => '?').join(',')})`,
        [userId, brokerKey.toLowerCase(), accountId, ...chunk]
      )) as Array<{ id?: string }>;

      for (const row of rows) {
        const tradeId = String(row.id || '').trim();
        if (tradeId) {
          collectedIds.add(tradeId);
        }
      }
    }

    return this.loadSuggestedTradesByIds(userId, Array.from(collectedIds));
  }

  async findLinkedTradesBySymbols(
    userId: string,
    brokerKey: string,
    accountId: string,
    symbols: string[]
  ): Promise<SuggestedTrade[]> {
    const normalizedBrokerKey = brokerKey.toLowerCase();
    const normalizedSymbols = this.buildSymbolLookupValues(normalizedBrokerKey, symbols);
    if (!normalizedSymbols.length) {
      return [];
    }

    const collectedIds = new Set<string>();
    for (let index = 0; index < normalizedSymbols.length; index += EXECUTION_LOOKUP_CHUNK_SIZE) {
      const chunk = normalizedSymbols.slice(index, index + EXECUTION_LOOKUP_CHUNK_SIZE);
      const rows = (await coreDataSource.query(
        `SELECT suggested_trade.id AS id
           FROM suggested_trade_executions execution_row
           INNER JOIN suggested_trades suggested_trade
                   ON suggested_trade.id = execution_row.suggested_trade_id
          WHERE execution_row.user_id = ?
            AND LOWER(COALESCE(execution_row.broker_key, '')) = ?
            AND COALESCE(execution_row.account_id, '') = ?
            AND (
              COALESCE(execution_row.order_id, '') <> ''
              OR COALESCE(execution_row.position_id, '') <> ''
            )
            AND (
              LOWER(COALESCE(execution_row.execution_state, '')) NOT IN ('closed', 'cancelled', 'rejected', 'expired', 'failed')
              OR LOWER(COALESCE(execution_row.position_status, '')) IN ('open', 'partial', 'partially_closed', 'partially_closed_position')
              OR LOWER(COALESCE(execution_row.protection_state, '')) IN ('pending', 'waiting_for_fill', 'waiting_for_position', 'attaching', 'failed', 'manual_unlinked')
            )
            AND LOWER(suggested_trade.symbol) IN (${chunk.map(() => '?').join(',')})`,
        [userId, normalizedBrokerKey, accountId, ...chunk]
      )) as Array<{ id?: string }>;

      for (const row of rows) {
        const tradeId = String(row.id || '').trim();
        if (tradeId) {
          collectedIds.add(tradeId);
        }
      }
    }

    return this.loadSuggestedTradesByIds(userId, Array.from(collectedIds));
  }

  async findRecentTradesBySymbol(
    userId: string,
    brokerKey: string,
    accountId: string,
    symbol: string,
    limit = 6
  ): Promise<SuggestedTrade[]> {
    const normalizedBrokerKey = brokerKey.toLowerCase();
    const symbolLookupValues = this.buildSymbolLookupValues(normalizedBrokerKey, [symbol]);
    if (!symbolLookupValues.length) {
      return [];
    }

    const rows = (await coreDataSource.query(
      `SELECT suggested_trade.id AS id
         FROM suggested_trade_executions execution_row
         INNER JOIN suggested_trades suggested_trade
                 ON suggested_trade.id = execution_row.suggested_trade_id
        WHERE execution_row.user_id = ?
          AND LOWER(COALESCE(execution_row.broker_key, '')) = ?
          AND COALESCE(execution_row.account_id, '') = ?
          AND LOWER(COALESCE(suggested_trade.symbol, '')) IN (${symbolLookupValues
            .map(() => '?')
            .join(',')})
        ORDER BY COALESCE(
          execution_row.last_seen_at,
          execution_row.position_closed_at,
          execution_row.position_opened_at,
          execution_row.linked_at,
          suggested_trade.updated_at,
          suggested_trade.created_at
        ) DESC
        LIMIT ?`,
      [
        userId,
        normalizedBrokerKey,
        accountId,
        ...symbolLookupValues,
        Math.max(1, Math.floor(limit)),
      ]
    )) as Array<{ id?: string }>;

    return this.loadSuggestedTradesByIds(
      userId,
      rows.map((row) => String(row.id || '').trim()).filter(Boolean)
    );
  }

  async findLinkedTradesByPaperOrderIds(
    userId: string,
    paperOrderIds: string[]
  ): Promise<SuggestedTrade[]> {
    const normalizedPaperOrderIds = Array.from(
      new Set(paperOrderIds.map((value) => String(value || '').trim()).filter(Boolean))
    );
    if (!normalizedPaperOrderIds.length) {
      return [];
    }

    const collectedIds = new Set<string>();
    for (
      let index = 0;
      index < normalizedPaperOrderIds.length;
      index += EXECUTION_LOOKUP_CHUNK_SIZE
    ) {
      const chunk = normalizedPaperOrderIds.slice(index, index + EXECUTION_LOOKUP_CHUNK_SIZE);
      const rows = (await coreDataSource.query(
        `SELECT suggested_trade.id AS id
           FROM suggested_trade_executions execution_row
           INNER JOIN suggested_trades suggested_trade
                   ON suggested_trade.id = execution_row.suggested_trade_id
          WHERE execution_row.user_id = ?
            AND LOWER(COALESCE(execution_row.execution_mode, '')) = 'paper'
            AND COALESCE(execution_row.paper_order_id, '') IN (${chunk.map(() => '?').join(',')})`,
        [userId, ...chunk]
      )) as Array<{ id?: string }>;

      for (const row of rows) {
        const tradeId = String(row.id || '').trim();
        if (tradeId) {
          collectedIds.add(tradeId);
        }
      }
    }

    return this.loadSuggestedTradesByIds(userId, Array.from(collectedIds));
  }

  async countSystemAcceptedExecutionsSince(
    automationId: string,
    executionMode: 'paper' | 'live',
    since: Date
  ): Promise<number> {
    return this.repository
      .createQueryBuilder('suggested_trade')
      .innerJoin('suggested_trade.executionRecord', 'execution_record')
      .where('suggested_trade.automationId = :automationId', { automationId })
      .andWhere("LOWER(COALESCE(execution_record.executionMode, '')) = :executionMode", {
        executionMode,
      })
      .andWhere("LOWER(COALESCE(execution_record.acceptedBy, '')) = 'system'")
      .andWhere('execution_record.acceptedAt >= :since', { since })
      .andWhere("LOWER(COALESCE(execution_record.executionState, '')) <> 'failed'")
      .getCount();
  }

  async countSystemAcceptedPaperExecutionsSince(
    automationId: string,
    since: Date
  ): Promise<number> {
    return this.countSystemAcceptedExecutionsSince(automationId, 'paper', since);
  }

  async countActiveExecutionsForAutomation(
    automationId: string,
    executionMode: 'paper' | 'live'
  ): Promise<number> {
    return this.repository
      .createQueryBuilder('suggested_trade')
      .innerJoin('suggested_trade.executionRecord', 'execution_record')
      .where('suggested_trade.automationId = :automationId', { automationId })
      .andWhere("LOWER(COALESCE(execution_record.executionMode, '')) = :executionMode", {
        executionMode,
      })
      .andWhere("LOWER(COALESCE(execution_record.executionState, '')) IN (:...states)", {
        states: ['linked', 'working', 'filled'],
      })
      .getCount();
  }

  async countActivePaperExecutionsForAutomation(automationId: string): Promise<number> {
    return this.countActiveExecutionsForAutomation(automationId, 'paper');
  }

  private buildSymbolLookupValues(brokerKey: string, symbols: string[]): string[] {
    const normalizedBrokerKey = String(brokerKey || '')
      .trim()
      .toLowerCase();
    const values = new Set<string>();

    for (const symbol of symbols) {
      if (normalizedBrokerKey === 'delta_exchange') {
        for (const equivalent of this.buildDeltaSymbolEquivalents(symbol)) {
          values.add(equivalent.toLowerCase());
        }
        continue;
      }

      const normalized = String(symbol || '')
        .trim()
        .toLowerCase();
      if (normalized) {
        values.add(normalized);
      }
    }

    return Array.from(values);
  }

  private buildDeltaSymbolEquivalents(symbol: unknown): string[] {
    const normalized = this.normalizeDeltaSymbol(symbol);
    if (!normalized) {
      return [];
    }

    const values = new Set<string>([normalized]);
    const base = this.resolveDeltaBaseSymbol(normalized);
    if (base && base !== normalized) {
      values.add(`${base}USDT`);
      values.add(`${base}USDC`);
      values.add(`${base}USD`);
    }

    return Array.from(values);
  }

  private normalizeDeltaSymbol(value: unknown): string {
    return String(value || '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
  }

  private resolveDeltaBaseSymbol(value: unknown): string {
    const normalized = this.normalizeDeltaSymbol(value);
    for (const quote of ['USDT', 'USDC', 'USD']) {
      if (normalized.endsWith(quote) && normalized.length > quote.length) {
        return normalized.slice(0, -quote.length);
      }
    }

    return normalized;
  }

  private parsePayloadObject(payload: unknown): Record<string, unknown> | null {
    if (typeof payload === 'string') {
      try {
        const parsed = JSON.parse(payload) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        return null;
      }
      return null;
    }

    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      return payload as Record<string, unknown>;
    }

    return null;
  }

  private mergeReadModelProtectionIntoPositionPayload(row: {
    payload?: unknown;
    readModelStatus?: unknown;
    readModelStatusKey?: unknown;
    readModelQuantity?: unknown;
    readModelEntryPrice?: unknown;
    readModelCurrentPrice?: unknown;
    readModelClosedPrice?: unknown;
    readModelRealizedPnl?: unknown;
    readModelStopLossPrice?: unknown;
    readModelTakeProfitPrice?: unknown;
    readModelStopLossOrderId?: unknown;
    readModelTakeProfitOrderId?: unknown;
    readModelPositionCreatedAt?: unknown;
    readModelPositionUpdatedAt?: unknown;
    readModelPositionClosedAt?: unknown;
  }): Record<string, unknown> | null {
    const parsedPayload = this.parsePayloadObject(row.payload);
    const payload: Record<string, unknown> = parsedPayload ? { ...parsedPayload } : {};
    let hasPayload = Boolean(parsedPayload);
    const put = (key: string, value: unknown, overwrite = false) => {
      const normalized = normalizeOptionalString(value);
      if (!normalized) {
        return;
      }
      if (
        !overwrite &&
        payload[key] !== undefined &&
        payload[key] !== null &&
        payload[key] !== ''
      ) {
        return;
      }
      payload[key] = normalized;
      hasPayload = true;
    };
    const putTimestamp = (key: string, value: unknown, overwrite = false) => {
      if (
        !overwrite &&
        payload[key] !== undefined &&
        payload[key] !== null &&
        payload[key] !== ''
      ) {
        return;
      }
      const normalizedDate = normalizeOptionalDate(value as Date | string | null | undefined);
      const normalized = normalizedDate?.toISOString() ?? normalizeOptionalString(value);
      if (!normalized) {
        return;
      }
      payload[key] = normalized;
      hasPayload = true;
    };

    put('status', row.readModelStatus, true);
    put('status_key', row.readModelStatusKey, true);
    put('quantity', row.readModelQuantity);
    put('entry_price', row.readModelEntryPrice);
    put('current_price', row.readModelCurrentPrice);
    put('closed_price', row.readModelClosedPrice, true);
    put('pnl', row.readModelRealizedPnl, true);
    put('realized_pnl', row.readModelRealizedPnl, true);
    put('stoploss_price', row.readModelStopLossPrice, true);
    put('takeprofit_price', row.readModelTakeProfitPrice, true);
    put('stoploss_order_id', row.readModelStopLossOrderId, true);
    put('takeprofit_order_id', row.readModelTakeProfitOrderId, true);
    putTimestamp('created_at', row.readModelPositionCreatedAt);
    putTimestamp('updated_at', row.readModelPositionUpdatedAt, true);
    putTimestamp('closed_at', row.readModelPositionClosedAt, true);

    return hasPayload ? payload : null;
  }

  async getSuggestedTradesSummary(
    userId: string,
    query: Omit<SuggestedTradeSummaryQuery, 'userId'> = {}
  ): Promise<{
    open: number;
    reviewed: number;
    accepted: number;
    dismissed: number;
    actionable: number;
    buySide: number;
    sellSide: number;
    queued: number;
    submitting: number;
    linked: number;
    working: number;
    filled: number;
    closed: number;
  }> {
    const baseQuery = this.buildFilteredSuggestedTradesQuery(
      {
        userId,
        ...query,
      },
      {
        withExecution: true,
      }
    );

    const [
      open,
      reviewed,
      accepted,
      dismissed,
      actionable,
      buySide,
      sellSide,
      queued,
      submitting,
      linked,
      working,
      filled,
      closed,
    ] = await Promise.all([
      baseQuery
        .clone()
        .andWhere('suggested_trade.status = :openStatus', { openStatus: 'Open' })
        .getCount(),
      baseQuery
        .clone()
        .andWhere('suggested_trade.status = :reviewedStatus', { reviewedStatus: 'Reviewed' })
        .getCount(),
      baseQuery
        .clone()
        .andWhere('suggested_trade.status = :acceptedStatus', { acceptedStatus: 'Accepted' })
        .getCount(),
      baseQuery
        .clone()
        .andWhere('suggested_trade.status = :dismissedStatus', { dismissedStatus: 'Dismissed' })
        .getCount(),
      baseQuery
        .clone()
        .andWhere('suggested_trade.status IN (:...statuses)', {
          statuses: ['Open', 'Reviewed', 'Accepted'],
        })
        .getCount(),
      baseQuery.clone().andWhere('suggested_trade.side = :buySide', { buySide: 'BUY' }).getCount(),
      baseQuery
        .clone()
        .andWhere('suggested_trade.side = :sellSide', { sellSide: 'SELL' })
        .getCount(),
      baseQuery
        .clone()
        .andWhere("LOWER(COALESCE(execution_record.executionState, '')) = :queuedState", {
          queuedState: 'queued',
        })
        .getCount(),
      baseQuery
        .clone()
        .andWhere("LOWER(COALESCE(execution_record.executionState, '')) = :submittingState", {
          submittingState: 'submitting',
        })
        .getCount(),
      baseQuery
        .clone()
        .andWhere("LOWER(COALESCE(execution_record.executionState, '')) = :linkedState", {
          linkedState: 'linked',
        })
        .getCount(),
      baseQuery
        .clone()
        .andWhere("LOWER(COALESCE(execution_record.executionState, '')) = :workingState", {
          workingState: 'working',
        })
        .getCount(),
      baseQuery
        .clone()
        .andWhere("LOWER(COALESCE(execution_record.executionState, '')) = :filledState", {
          filledState: 'filled',
        })
        .getCount(),
      baseQuery
        .clone()
        .andWhere("LOWER(COALESCE(execution_record.executionState, '')) = :closedState", {
          closedState: 'closed',
        })
        .getCount(),
    ]);

    return {
      open,
      reviewed,
      accepted,
      dismissed,
      actionable,
      buySide,
      sellSide,
      queued,
      submitting,
      linked,
      working,
      filled,
      closed,
    };
  }

  async listExecutionSyncCandidates(
    query: SuggestedTradeExecutionSyncQuery
  ): Promise<SuggestedTrade[]> {
    const builder = this.buildFilteredSuggestedTradesQuery(query, {
      withExecution: true,
    });

    this.applyExecutionTrackingFilter(builder);
    this.applyActiveExecutionFilter(builder);
    if (query.staleOnly && query.staleBefore) {
      this.applyStaleExecutionFilter(builder, query.staleBefore);
      this.applyExecutionSyncOrdering(builder);
    } else {
      builder.orderBy('suggested_trade.signalTime', 'DESC');
    }

    return builder.take(query.limit).getMany();
  }

  async listStaleTrackedTradesGlobal(limit: number, staleBefore: Date): Promise<SuggestedTrade[]> {
    const builder = this.repository
      .createQueryBuilder('suggested_trade')
      .leftJoinAndSelect('suggested_trade.executionRecord', 'execution_record');

    this.applyExecutionTrackingFilter(builder);
    this.applyActiveExecutionFilter(builder);
    this.applyStaleExecutionFilter(builder, staleBefore);
    this.applyExecutionSyncOrdering(builder);

    return builder.take(limit).getMany();
  }

  async listProtectionRemediationCandidates(
    limit: number,
    staleBefore: Date,
    options: { automaticStaleBefore?: Date } = {}
  ): Promise<SuggestedTrade[]> {
    const automaticStaleBefore = options.automaticStaleBefore ?? staleBefore;
    const builder = this.repository
      .createQueryBuilder('suggested_trade')
      .leftJoinAndSelect('suggested_trade.executionRecord', 'execution_record')
      .where("LOWER(COALESCE(execution_record.executionMode, '')) = 'live'")
      .andWhere(
        `(
          (
            LOWER(COALESCE(execution_record.protectionState, '')) IN (:...automaticStates)
            AND (
              execution_record.protection_checked_at IS NULL
              OR execution_record.protection_checked_at <= :automaticStaleBefore
            )
          )
          OR (
            LOWER(COALESCE(execution_record.protectionState, '')) = :manualState
            AND (
              execution_record.protection_checked_at IS NULL
              OR execution_record.protection_checked_at <= :manualStaleBefore
            )
          )
          OR (
            LOWER(COALESCE(execution_record.protectionState, '')) = 'failed'
            AND COALESCE(execution_record.protectionAttempts, 0) < 3
            AND (${RETRIABLE_FAILED_PROTECTION_ERROR_PATTERNS.map(
              (_pattern, index) =>
                `LOWER(COALESCE(execution_record.protectionLastError, '')) LIKE :retryErrorPattern${index}`
            ).join(' OR ')})
            AND (
              execution_record.protection_checked_at IS NULL
              OR execution_record.protection_checked_at <= :automaticStaleBefore
            )
          )
        )`,
        {
          automaticStates: AUTOMATIC_REMEDIABLE_PROTECTION_STATES,
          manualState: MANUAL_REMEDIABLE_PROTECTION_STATE,
          automaticStaleBefore,
          manualStaleBefore: staleBefore,
          ...Object.fromEntries(
            RETRIABLE_FAILED_PROTECTION_ERROR_PATTERNS.map((pattern, index) => [
              `retryErrorPattern${index}`,
              pattern,
            ])
          ),
        }
      )
      .andWhere(
        "LOWER(COALESCE(execution_record.executionState, '')) NOT IN (:...terminalStates)",
        { terminalStates: TERMINAL_EXECUTION_STATES }
      )
      .addSelect(
        `COALESCE(
          execution_record.protection_checked_at,
          execution_record.updated_at,
          execution_record.linked_at,
          execution_record.created_at,
          suggested_trade.updated_at
        )`,
        'protection_remediation_sort_checked_at'
      )
      .addSelect(
        `CASE
          WHEN COALESCE(execution_record.order_id, '') <> '' THEN 0
          WHEN COALESCE(execution_record.position_id, '') <> '' THEN 0
          WHEN LOWER(COALESCE(execution_record.execution_state, '')) IN ('linked', 'working', 'filled') THEN 0
          ELSE 1
        END`,
        'protection_remediation_priority'
      )
      .orderBy('protection_remediation_priority', 'ASC')
      .addOrderBy('protection_remediation_sort_checked_at', 'ASC')
      .addOrderBy('suggested_trade.signalTime', 'ASC');

    return builder.take(Math.max(1, Math.floor(limit))).getMany();
  }

  async getExecutionSyncSummary(
    userId: string,
    query: Omit<SuggestedTradeSummaryQuery, 'userId'> = {},
    staleBefore: Date
  ): Promise<SuggestedTradeExecutionSyncSummary> {
    const baseQuery = this.buildFilteredSuggestedTradesQuery(
      {
        userId,
        ...query,
      },
      {
        withExecution: true,
      }
    );

    this.applyExecutionTrackingFilter(baseQuery);

    const trackedQuery = baseQuery.clone();
    const terminalQuery = baseQuery
      .clone()
      .andWhere("LOWER(COALESCE(execution_record.executionState, '')) IN (:...terminalStates)", {
        terminalStates: TERMINAL_EXECUTION_STATES,
      });

    const activeQuery = baseQuery.clone();
    this.applyActiveExecutionFilter(activeQuery);

    const staleQuery = activeQuery.clone();
    this.applyStaleExecutionFilter(staleQuery, staleBefore);

    const [tracked, stale, terminal] = await Promise.all([
      trackedQuery.getCount(),
      staleQuery.getCount(),
      terminalQuery.getCount(),
    ]);

    return {
      tracked,
      stale,
      terminal,
    };
  }

  async getGlobalExecutionSyncSummary(
    staleBefore: Date
  ): Promise<SuggestedTradeExecutionSyncSummary> {
    const baseQuery = this.repository
      .createQueryBuilder('suggested_trade')
      .leftJoin('suggested_trade.executionRecord', 'execution_record');

    this.applyExecutionTrackingFilter(baseQuery);

    const trackedQuery = baseQuery.clone();
    const terminalQuery = baseQuery
      .clone()
      .andWhere("LOWER(COALESCE(execution_record.executionState, '')) IN (:...terminalStates)", {
        terminalStates: TERMINAL_EXECUTION_STATES,
      });

    const activeQuery = baseQuery.clone();
    this.applyActiveExecutionFilter(activeQuery);

    const staleQuery = activeQuery.clone();
    this.applyStaleExecutionFilter(staleQuery, staleBefore);

    const [tracked, stale, terminal] = await Promise.all([
      trackedQuery.getCount(),
      staleQuery.getCount(),
      terminalQuery.getCount(),
    ]);

    return {
      tracked,
      stale,
      terminal,
    };
  }

  async getOperationalSnapshot(): Promise<SuggestedTradeOperationalSnapshot> {
    const hasExecutionTrackingSql = this.getExecutionTrackingSql();
    const raw = await this.repository
      .createQueryBuilder('suggested_trade')
      .leftJoin('suggested_trade.executionRecord', 'execution_record')
      .select('COUNT(*)', 'total')
      .addSelect(
        "COALESCE(SUM(CASE WHEN suggested_trade.status = 'Open' THEN 1 ELSE 0 END), 0)",
        'open'
      )
      .addSelect(
        "COALESCE(SUM(CASE WHEN suggested_trade.status = 'Reviewed' THEN 1 ELSE 0 END), 0)",
        'reviewed'
      )
      .addSelect(
        "COALESCE(SUM(CASE WHEN suggested_trade.status = 'Accepted' THEN 1 ELSE 0 END), 0)",
        'accepted'
      )
      .addSelect(
        "COALESCE(SUM(CASE WHEN suggested_trade.status = 'Dismissed' THEN 1 ELSE 0 END), 0)",
        'dismissed'
      )
      .addSelect(
        `COALESCE(SUM(CASE
          WHEN suggested_trade.status = 'Accepted' AND NOT ${hasExecutionTrackingSql}
          THEN 1
          ELSE 0
        END), 0)`,
        'queuedForOrder'
      )
      .addSelect(
        `COALESCE(SUM(CASE
          WHEN suggested_trade.status = 'Accepted' AND ${hasExecutionTrackingSql}
          THEN 1
          ELSE 0
        END), 0)`,
        'convertedToOrder'
      )
      .addSelect(
        "COALESCE(SUM(CASE WHEN LOWER(COALESCE(execution_record.executionState, '')) = 'queued' THEN 1 ELSE 0 END), 0)",
        'queued'
      )
      .addSelect(
        "COALESCE(SUM(CASE WHEN LOWER(COALESCE(execution_record.executionState, '')) = 'submitting' THEN 1 ELSE 0 END), 0)",
        'submitting'
      )
      .addSelect(
        "COALESCE(SUM(CASE WHEN LOWER(COALESCE(execution_record.executionState, '')) = 'linked' THEN 1 ELSE 0 END), 0)",
        'linked'
      )
      .addSelect(
        "COALESCE(SUM(CASE WHEN LOWER(COALESCE(execution_record.executionState, '')) = 'working' THEN 1 ELSE 0 END), 0)",
        'working'
      )
      .addSelect(
        "COALESCE(SUM(CASE WHEN LOWER(COALESCE(execution_record.executionState, '')) = 'filled' THEN 1 ELSE 0 END), 0)",
        'filled'
      )
      .addSelect(
        "COALESCE(SUM(CASE WHEN LOWER(COALESCE(execution_record.executionState, '')) = 'closed' THEN 1 ELSE 0 END), 0)",
        'closed'
      )
      .getRawOne<{
        total?: string | number | null;
        open?: string | number | null;
        reviewed?: string | number | null;
        accepted?: string | number | null;
        dismissed?: string | number | null;
        queuedForOrder?: string | number | null;
        convertedToOrder?: string | number | null;
        queued?: string | number | null;
        submitting?: string | number | null;
        linked?: string | number | null;
        working?: string | number | null;
        filled?: string | number | null;
        closed?: string | number | null;
      }>();

    const accepted = Number(raw?.accepted || 0);
    const convertedToOrder = Number(raw?.convertedToOrder || 0);

    return {
      total: Number(raw?.total || 0),
      open: Number(raw?.open || 0),
      reviewed: Number(raw?.reviewed || 0),
      accepted,
      dismissed: Number(raw?.dismissed || 0),
      queuedForOrder: Number(raw?.queuedForOrder || 0),
      convertedToOrder,
      queued: Number(raw?.queued || 0),
      submitting: Number(raw?.submitting || 0),
      linked: Number(raw?.linked || 0),
      working: Number(raw?.working || 0),
      filled: Number(raw?.filled || 0),
      closed: Number(raw?.closed || 0),
      queueToOrderConversionRate:
        accepted > 0 ? Number((convertedToOrder / accepted).toFixed(4)) : null,
    };
  }

  async getProtectionOperationalSnapshot(
    manualRecoveryStaleBefore = new Date(Date.now() - 10 * 60 * 1000),
    attachingStaleBefore = manualRecoveryStaleBefore
  ): Promise<SuggestedTradeProtectionOperationalSnapshot> {
    const retryableFailedSql = `LOWER(COALESCE(protection_last_error, '')) LIKE '%position not found%'
      OR LOWER(COALESCE(protection_last_error, '')) LIKE '%bad request%'
      OR LOWER(COALESCE(protection_last_error, '')) LIKE '%invalid stop loss price%'
      OR LOWER(COALESCE(protection_last_error, '')) LIKE '%replacement protection is required%'`;
    const activeProtectionSql = `LOWER(COALESCE(execution_state, '')) NOT IN ('closed', 'cancelled', 'rejected', 'expired', 'failed')
      AND LOWER(COALESCE(position_status, '')) NOT IN ('closed', 'liquidated')`;
    const rows = (await coreDataSource.query(
      `SELECT COUNT(*) AS tracked,
              COALESCE(SUM(CASE WHEN LOWER(COALESCE(protection_state, '')) = 'pending' AND ${activeProtectionSql} THEN 1 ELSE 0 END), 0) AS pending,
              COALESCE(SUM(CASE WHEN LOWER(COALESCE(protection_state, '')) = 'waiting_for_fill' AND ${activeProtectionSql} THEN 1 ELSE 0 END), 0) AS waitingForFill,
              COALESCE(SUM(CASE WHEN LOWER(COALESCE(protection_state, '')) = 'waiting_for_position' AND ${activeProtectionSql} THEN 1 ELSE 0 END), 0) AS waitingForPosition,
              COALESCE(SUM(CASE WHEN LOWER(COALESCE(protection_state, '')) = 'attaching' AND ${activeProtectionSql} THEN 1 ELSE 0 END), 0) AS attaching,
              COALESCE(SUM(CASE WHEN LOWER(COALESCE(protection_state, '')) = 'attached' THEN 1 ELSE 0 END), 0) AS attached,
              COALESCE(SUM(CASE WHEN LOWER(COALESCE(protection_state, '')) = 'failed' AND ${activeProtectionSql} THEN 1 ELSE 0 END), 0) AS failed,
              COALESCE(SUM(CASE WHEN LOWER(COALESCE(protection_state, '')) = 'manual_unlinked' AND ${activeProtectionSql} THEN 1 ELSE 0 END), 0) AS manualUnlinked,
              COALESCE(SUM(CASE WHEN LOWER(COALESCE(protection_state, '')) = 'manual_unlinked' AND ${activeProtectionSql} AND (protection_checked_at IS NULL OR protection_checked_at < ?) THEN 1 ELSE 0 END), 0) AS staleManualUnlinked,
              COALESCE(SUM(CASE WHEN LOWER(COALESCE(protection_state, '')) = 'attaching' AND ${activeProtectionSql} AND (protection_checked_at IS NULL OR protection_checked_at < ?) THEN 1 ELSE 0 END), 0) AS staleAttaching,
              COALESCE(SUM(CASE WHEN LOWER(COALESCE(protection_state, '')) = 'not_required' THEN 1 ELSE 0 END), 0) AS notRequired,
              COALESCE(SUM(CASE WHEN LOWER(COALESCE(protection_state, '')) = 'unknown' AND ${activeProtectionSql} THEN 1 ELSE 0 END), 0) AS unknown,
              COALESCE(SUM(CASE WHEN LOWER(COALESCE(protection_state, '')) IN ('failed', 'manual_unlinked') AND ${activeProtectionSql} THEN 1 ELSE 0 END), 0) AS actionable,
              COALESCE(SUM(CASE WHEN LOWER(COALESCE(protection_state, '')) IN ('pending', 'waiting_for_fill', 'waiting_for_position', 'attaching', 'failed') AND ${activeProtectionSql} THEN 1 ELSE 0 END), 0) AS unresolved,
              COALESCE(SUM(CASE
                WHEN LOWER(COALESCE(protection_state, '')) = 'failed'
                 AND ${activeProtectionSql}
                 AND COALESCE(protection_attempts, 0) < 3
                 AND (${retryableFailedSql})
                THEN 1 ELSE 0 END), 0) AS retriableFailed,
              MAX(protection_checked_at) AS lastCheckedAt,
              MAX(protection_attached_at) AS lastAttachedAt,
              MAX(CASE WHEN LOWER(COALESCE(protection_state, '')) = 'manual_unlinked' AND ${activeProtectionSql} THEN protection_checked_at ELSE NULL END) AS lastManualActionAt
         FROM suggested_trade_executions
        WHERE LOWER(COALESCE(execution_mode, '')) = 'live'
          AND (
            protection_state IS NOT NULL
            OR stop_loss_price IS NOT NULL
            OR take_profit_price IS NOT NULL
          )`,
      [manualRecoveryStaleBefore, attachingStaleBefore]
    )) as Array<Record<string, unknown>>;

    const row = rows[0] ?? {};
    return {
      tracked: normalizeOperationalCount(row.tracked),
      pending: normalizeOperationalCount(row.pending),
      waitingForFill: normalizeOperationalCount(row.waitingForFill),
      waitingForPosition: normalizeOperationalCount(row.waitingForPosition),
      attaching: normalizeOperationalCount(row.attaching),
      attached: normalizeOperationalCount(row.attached),
      failed: normalizeOperationalCount(row.failed),
      manualUnlinked: normalizeOperationalCount(row.manualUnlinked),
      staleManualUnlinked: normalizeOperationalCount(row.staleManualUnlinked),
      staleAttaching: normalizeOperationalCount(row.staleAttaching),
      notRequired: normalizeOperationalCount(row.notRequired),
      unknown: normalizeOperationalCount(row.unknown),
      actionable: normalizeOperationalCount(row.actionable),
      unresolved: normalizeOperationalCount(row.unresolved),
      retriableFailed: normalizeOperationalCount(row.retriableFailed),
      lastCheckedAt: normalizeOptionalDate(row.lastCheckedAt as Date | string | null | undefined),
      lastAttachedAt: normalizeOptionalDate(row.lastAttachedAt as Date | string | null | undefined),
      lastManualActionAt: normalizeOptionalDate(
        row.lastManualActionAt as Date | string | null | undefined
      ),
    };
  }

  async listSuggestedTradesForFreshnessAudit(
    query: SuggestedTradeFreshnessAuditQuery
  ): Promise<{ items: SuggestedTrade[]; sampled: number; total: number }> {
    const builder = this.repository
      .createQueryBuilder('suggested_trade')
      .leftJoinAndSelect('suggested_trade.executionRecord', 'execution_record')
      .where('suggested_trade.createdAt >= :createdAfter', {
        createdAfter: query.createdAfter,
      });

    if (query.userId) {
      builder.andWhere('suggested_trade.userId = :userId', { userId: query.userId });
    }

    this.applyFilters(builder, query);

    const total = await builder.clone().getCount();
    const items = await builder
      .orderBy('suggested_trade.createdAt', 'DESC')
      .addOrderBy('suggested_trade.signalTime', 'DESC')
      .take(Math.max(1, Math.floor(query.limit)))
      .getMany();

    return {
      items,
      sampled: items.length,
      total,
    };
  }

  async insertSuggestedTrades(
    payloads: SuggestedTradeInsertPayload[]
  ): Promise<{ inserted: number; duplicates: number }> {
    if (!payloads.length) {
      return { inserted: 0, duplicates: 0 };
    }

    let inserted = 0;
    let duplicates = 0;

    for (const payload of payloads) {
      const dedupeKey = payload.dedupeKey?.trim() || buildDedupeKey(payload);
      const exists = await this.repository.exist({
        where: {
          automationId: payload.automationId,
          dedupeKey,
        },
      });

      if (exists) {
        duplicates += 1;
        continue;
      }

      const entity = this.repository.create({
        id: randomUUID(),
        automationId: payload.automationId,
        automationRunId: payload.automationRunId,
        userId: payload.userId,
        sourceBacktestId: payload.sourceBacktestId ?? null,
        sourceTemplateId: payload.sourceTemplateId ?? null,
        sourceSetupKey: payload.sourceSetupKey ?? null,
        symbol: payload.symbol.trim().toUpperCase(),
        timeframe: payload.timeframe.trim(),
        side: payload.side.trim().toUpperCase(),
        signalTime: normalizeDate(payload.signalTime),
        status: payload.status?.trim() || 'Open',
        confidence:
          payload.confidence === undefined || payload.confidence === null
            ? null
            : Number(payload.confidence),
        score: payload.score === undefined || payload.score === null ? null : Number(payload.score),
        entryPrice: normalizeDecimal(payload.entryPrice),
        stopLossPrice: normalizeDecimal(payload.stopLossPrice),
        takeProfitTargets: payload.takeProfitTargets ?? null,
        entryRule: payload.entryRule ?? null,
        exitRule: payload.exitRule ?? null,
        rationale: payload.rationale ?? null,
        dedupeKey,
        meta: payload.meta ?? null,
      });

      await this.repository.save(entity);
      inserted += 1;
    }

    return { inserted, duplicates };
  }

  async createSuggestedTrade(
    payload: SuggestedTradeInsertPayload
  ): Promise<{ item: SuggestedTrade | null; duplicate: boolean }> {
    const dedupeKey = payload.dedupeKey?.trim() || buildDedupeKey(payload);
    const existing = await this.repository.findOne({
      where: {
        automationId: payload.automationId,
        dedupeKey,
      },
    });

    if (existing) {
      return {
        item: existing,
        duplicate: true,
      };
    }

    const entity = this.repository.create({
      id: randomUUID(),
      automationId: payload.automationId,
      automationRunId: payload.automationRunId,
      userId: payload.userId,
      sourceBacktestId: payload.sourceBacktestId ?? null,
      sourceTemplateId: payload.sourceTemplateId ?? null,
      sourceSetupKey: payload.sourceSetupKey ?? null,
      symbol: payload.symbol.trim().toUpperCase(),
      timeframe: payload.timeframe.trim(),
      side: payload.side.trim().toUpperCase(),
      signalTime: normalizeDate(payload.signalTime),
      status: payload.status?.trim() || 'Open',
      confidence:
        payload.confidence === undefined || payload.confidence === null
          ? null
          : Number(payload.confidence),
      score: payload.score === undefined || payload.score === null ? null : Number(payload.score),
      entryPrice: normalizeDecimal(payload.entryPrice),
      stopLossPrice: normalizeDecimal(payload.stopLossPrice),
      takeProfitTargets: payload.takeProfitTargets ?? null,
      entryRule: payload.entryRule ?? null,
      exitRule: payload.exitRule ?? null,
      rationale: payload.rationale ?? null,
      dedupeKey,
      meta: payload.meta ?? null,
    });

    const item = await this.repository.save(entity);
    return { item, duplicate: false };
  }

  async countByAutomationRun(automationRunId: string): Promise<number> {
    return this.repository.count({
      where: { automationRunId },
    });
  }

  private async loadSuggestedTradesByIds(userId: string, ids: string[]): Promise<SuggestedTrade[]> {
    const normalizedIds = Array.from(
      new Set(ids.map((value) => String(value || '').trim()).filter(Boolean))
    );
    if (!normalizedIds.length) {
      return [];
    }

    return this.repository
      .createQueryBuilder('suggested_trade')
      .leftJoinAndSelect('suggested_trade.executionRecord', 'execution_record')
      .where('suggested_trade.userId = :userId', { userId })
      .andWhere('suggested_trade.id IN (:...ids)', { ids: normalizedIds })
      .orderBy('suggested_trade.signalTime', 'DESC')
      .getMany();
  }

  private buildFilteredSuggestedTradesQuery(
    query: SuggestedTradeSummaryQuery,
    options: {
      withExecution?: boolean;
    } = {}
  ): SelectQueryBuilder<SuggestedTrade> {
    const builder = this.repository
      .createQueryBuilder('suggested_trade')
      .where('suggested_trade.userId = :userId', { userId: query.userId });

    if (options.withExecution || query.executionState) {
      builder.leftJoinAndSelect('suggested_trade.executionRecord', 'execution_record');
    }

    this.applyFilters(builder, query);
    return builder;
  }

  private applyFilters(
    builder: SelectQueryBuilder<SuggestedTrade>,
    query: Omit<SuggestedTradeSummaryQuery, 'userId'>
  ): void {
    if (query.automationId) {
      builder.andWhere('suggested_trade.automationId = :automationId', {
        automationId: query.automationId,
      });
    }
    if (query.automationRunId) {
      builder.andWhere('suggested_trade.automationRunId = :automationRunId', {
        automationRunId: query.automationRunId,
      });
    }
    if (query.status) {
      builder.andWhere('suggested_trade.status = :status', { status: query.status });
    }
    if (query.executionState) {
      builder.andWhere("LOWER(COALESCE(execution_record.executionState, '')) = :executionState", {
        executionState: query.executionState.toLowerCase(),
      });
    }
    if (query.symbol) {
      builder.andWhere('LOWER(suggested_trade.symbol) = LOWER(:symbol)', {
        symbol: query.symbol,
      });
    }
    if (query.timeframe) {
      builder.andWhere('LOWER(suggested_trade.timeframe) = LOWER(:timeframe)', {
        timeframe: query.timeframe,
      });
    }
    if (query.side) {
      builder.andWhere('suggested_trade.side = :side', { side: query.side });
    }
    if (query.search) {
      builder.andWhere(
        '(suggested_trade.symbol LIKE :search OR suggested_trade.timeframe LIKE :search OR suggested_trade.entry_rule LIKE :search OR suggested_trade.exit_rule LIKE :search OR suggested_trade.rationale LIKE :search)',
        {
          search: `%${query.search}%`,
        }
      );
    }
  }

  private applyExecutionTrackingFilter(builder: SelectQueryBuilder<SuggestedTrade>): void {
    builder.andWhere(this.getExecutionTrackingSql());
  }

  private applyActiveExecutionFilter(builder: SelectQueryBuilder<SuggestedTrade>): void {
    builder.andWhere(
      "LOWER(COALESCE(execution_record.executionState, '')) NOT IN (:...terminalStates)",
      { terminalStates: TERMINAL_EXECUTION_STATES }
    );
  }

  private applyStaleExecutionFilter(
    builder: SelectQueryBuilder<SuggestedTrade>,
    staleBefore: Date
  ): void {
    builder.andWhere(
      `COALESCE(
        execution_record.last_seen_at,
        execution_record.updated_at,
        execution_record.linked_at,
        execution_record.created_at,
        suggested_trade.updated_at
      ) <= :staleBefore`,
      { staleBefore }
    );
  }

  private applyExecutionSyncOrdering(builder: SelectQueryBuilder<SuggestedTrade>): void {
    builder.addSelect(
      `COALESCE(
        execution_record.last_seen_at,
        execution_record.updated_at,
        execution_record.linked_at,
        execution_record.created_at,
        suggested_trade.updated_at
      )`,
      'execution_sync_sort_seen_at'
    );
    builder
      .orderBy('execution_sync_sort_seen_at', 'ASC')
      .addOrderBy('suggested_trade.signalTime', 'ASC');
  }

  private getExecutionTrackingSql(alias = 'execution_record'): string {
    return `(
      ${alias}.suggested_trade_id IS NOT NULL
      AND (
        ${alias}.order_id IS NOT NULL
        OR ${alias}.paper_order_id IS NOT NULL
        OR ${alias}.position_id IS NOT NULL
        OR ${alias}.execution_state IS NOT NULL
      )
    )`;
  }
}
