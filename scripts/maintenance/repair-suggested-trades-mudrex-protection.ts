import 'reflect-metadata';

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Container } from 'typedi';
import type { SuggestedTradeExecutionLink } from '../../src/api/contracts/SuggestedTrade';
import { SuggestedTradesService } from '../../src/api/services/SuggestedTradesService';
import { isSuggestedTradeProtectionRepairEnabledForBroker } from '../../src/api/services/suggested-trades/SuggestedTradeBrokerControls';
import type { BrokerOrdersAdapter } from '../../src/brokers/capabilities/orders/types';
import { BrokerRuntimeRegistry } from '../../src/brokers/core/BrokerRuntimeRegistry';
import { coreDataSource } from '../../src/database/data-source';
import { SuggestedTrade } from '../../src/database/entities/SuggestedTrade';
import { initializeCoreDataSource } from '../../src/database/initializeCoreDataSource';
import { SuggestedTradeRepository } from '../../src/database/repositories/SuggestedTradeRepository';
import { buildMudrexProtectionHealthReport } from '../checks/check-suggested-trades-mudrex-protection-health';
import {
  buildMudrexProtectionRepairPreviewReport,
  type MudrexProtectionRepairAction,
  type MudrexProtectionRepairPreviewItem,
} from '../checks/check-suggested-trades-mudrex-protection-repair-preview';

type JsonRecord = Record<string, unknown>;
type MudrexRepairApplyStatus =
  | 'not_applied_apply_disabled'
  | 'blocked_broker_repair_disabled'
  | 'blocked_stale_cancel_disabled'
  | 'skipped_not_repairable'
  | 'skipped_unsupported_action'
  | 'skipped_trade_not_found'
  | 'skipped_execution_missing'
  | 'skipped_execution_mismatch'
  | 'skipped_unsafe_position_identity'
  | 'skipped_same_symbol_ambiguity'
  | 'skipped_live_position_readback_missing'
  | 'skipped_live_position_readback_unsafe'
  | 'skipped_cancel_missing_order_ids'
  | 'skipped_cancel_order_readback_unavailable'
  | 'skipped_cancel_live_readback_inactive'
  | 'skipped_cancel_live_readback_unsafe'
  | 'skipped_stale_cancel_missing_order_ids'
  | 'skipped_stale_cancel_not_terminal'
  | 'skipped_stale_cancel_same_symbol_open_position'
  | 'skipped_stale_cancel_order_readback_unavailable'
  | 'skipped_stale_cancel_live_readback_inactive'
  | 'skipped_stale_cancel_live_readback_unsafe'
  | 'applied'
  | 'no_change'
  | 'error';

type PositionSnapshots = Awaited<
  ReturnType<SuggestedTradeRepository['getLinkedPositionSnapshots']>
>;

type PositionSnapshot = PositionSnapshots[number];

type SuggestedTradesServiceInternals = {
  getExecutionLink: (trade: SuggestedTrade) => SuggestedTradeExecutionLink | null;
  maybeRemediateLiveProtection: (
    userId: string,
    trade: SuggestedTrade,
    execution: SuggestedTradeExecutionLink,
    positionSnapshots: PositionSnapshots
  ) => Promise<SuggestedTradeExecutionLink>;
  alignLiveAutoExecutionStateWithProtectionLifecycle: (
    execution: SuggestedTradeExecutionLink
  ) => SuggestedTradeExecutionLink;
  persistExecutionState: (
    trade: SuggestedTrade,
    execution: SuggestedTradeExecutionLink
  ) => Promise<void>;
};

type MudrexRepairApplyItem = {
  suggestedTradeId: string;
  userId: string;
  symbol: string;
  action: MudrexProtectionRepairAction;
  status: MudrexRepairApplyStatus;
  reason: string | null;
  entryOrderId: string | null;
  positionId: string | null;
  cancelledOrderIds?: string[];
  before: JsonRecord | null;
  after: JsonRecord | null;
};

type MudrexLiveOrderReadback = {
  orderId: string;
  detail: JsonRecord;
  status: string;
  orderType: string;
};

const APPLY =
  String(process.env.SUGGESTED_TRADES_MUDREX_PROTECTION_REPAIR_APPLY || '')
    .trim()
    .toLowerCase() === 'true';
const STALE_CANCEL_APPLY =
  String(process.env.SUGGESTED_TRADES_MUDREX_STALE_PROTECTION_CANCEL_APPLY || '')
    .trim()
    .toLowerCase() === 'true';
const LIMIT = Math.max(
  1,
  Math.floor(Number(process.env.SUGGESTED_TRADES_MUDREX_PROTECTION_REPAIR_LIMIT || 5))
);
const OUTPUT_FILE = String(
  process.env.SUGGESTED_TRADES_MUDREX_PROTECTION_REPAIR_OUTPUT_FILE ||
    'artifacts/suggested-trades-mudrex-protection-repair.json'
).trim();
const STANDARD_APPLY_ACTIONS = new Set<MudrexProtectionRepairAction>([
  'would_attach_missing_protection',
  'would_replace_mismatched_partial_fill_protection',
  'would_mark_terminal_protection_not_required',
]);
const STALE_CANCEL_ACTION: MudrexProtectionRepairAction = 'would_cancel_stale_protection_orders';
const REPLACE_PARTIAL_FILL_ACTION: MudrexProtectionRepairAction =
  'would_replace_mismatched_partial_fill_protection';

function readString(value: unknown): string {
  return String(value ?? '').trim();
}

function readRecord(value: unknown): JsonRecord {
  if (!value) {
    return {};
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as JsonRecord;
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as JsonRecord;
      }
    } catch {
      return {};
    }
  }
  return {};
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function readBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') {
    return value;
  }
  const normalized = readString(value).toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no', 'n'].includes(normalized)) {
    return false;
  }
  return null;
}

function readBooleanEnvOverride(name: string): boolean | null {
  const raw = process.env[name];
  if (raw === undefined) {
    return null;
  }
  return ['1', 'true', 'yes', 'on'].includes(String(raw).trim().toLowerCase());
}

function readDate(value: unknown): Date | null {
  if (!value) {
    return null;
  }
  const parsed = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toIsoString(value: unknown): string | null {
  return readDate(value)?.toISOString() ?? null;
}

function buildPositionSearchAnchor(anchor: unknown): Date {
  const fallback = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const parsed = readDate(anchor);
  if (!parsed) {
    return fallback;
  }
  return new Date(parsed.getTime() - 24 * 60 * 60 * 1000);
}

function summarizeExecution(execution: SuggestedTradeExecutionLink | null): JsonRecord | null {
  if (!execution) {
    return null;
  }
  const protectionPlan = readRecord(execution.protectionPlan);
  return {
    executionState: execution.executionState ?? null,
    orderStatus: execution.orderStatus ?? null,
    positionStatus: execution.positionStatus ?? null,
    protectionState: execution.protectionState ?? null,
    protectionSource: execution.protectionSource ?? null,
    protectionAttempts: execution.protectionAttempts ?? null,
    protectionLastError: execution.protectionLastError ?? null,
    protectionCheckedAt: toIsoString(execution.protectionCheckedAt),
    protectionAttachedAt: toIsoString(execution.protectionAttachedAt),
    positionId: execution.positionId ?? null,
    stopLossOrderId: readString(protectionPlan.stopLossOrderId) || null,
    takeProfitOrderId: readString(protectionPlan.takeProfitOrderId) || null,
  };
}

function executionMatchesPreview(
  item: MudrexProtectionRepairPreviewItem,
  execution: SuggestedTradeExecutionLink
): { matched: boolean; reason: string | null } {
  if (readString(execution.brokerKey).toLowerCase() !== 'mudrex') {
    return { matched: false, reason: 'execution is not routed to Mudrex' };
  }
  if (item.accountId && readString(execution.accountId) !== item.accountId) {
    return { matched: false, reason: 'execution account no longer matches preview' };
  }
  if (item.entryOrderId && readString(execution.orderId) !== item.entryOrderId) {
    return { matched: false, reason: 'execution entry order no longer matches preview' };
  }
  const executionPositionId = readString(execution.positionId);
  if (
    item.positionReadModelExternalId &&
    executionPositionId &&
    executionPositionId !== item.positionReadModelExternalId
  ) {
    return { matched: false, reason: 'execution position no longer matches preview' };
  }
  return { matched: true, reason: null };
}

export function isMudrexProtectionRepairApplyActionSupported(
  action: MudrexProtectionRepairAction,
  options: { includeStaleCancel?: boolean } = {}
): boolean {
  return (
    STANDARD_APPLY_ACTIONS.has(action) ||
    (options.includeStaleCancel === true && action === STALE_CANCEL_ACTION)
  );
}

export function selectMudrexProtectionRepairApplyCandidates(
  items: MudrexProtectionRepairPreviewItem[],
  limit = LIMIT,
  options: { includeStaleCancel?: boolean } = {}
): MudrexProtectionRepairPreviewItem[] {
  return items
    .filter(
      (item) =>
        item.remediation.repairable &&
        item.remediation.readiness === 'ready' &&
        isMudrexProtectionRepairApplyActionSupported(item.remediation.action, options)
    )
    .slice(0, Math.max(1, Math.floor(limit)));
}

function normalizeStatus(value: unknown): string {
  return readString(value).toUpperCase();
}

function isTerminalStatus(value: unknown): boolean {
  return [
    'CLOSED',
    'LIQUIDATED',
    'CANCELLED',
    'CANCELED',
    'REJECTED',
    'EXPIRED',
    'FAILED',
  ].includes(normalizeStatus(value));
}

function isActiveOrderStatus(value: unknown): boolean {
  return [
    'OPEN',
    'PENDING',
    'PARTIALLY_FILLED',
    'PARTIAL_FILLED',
    'PARTIAL',
    'TRIGGER_PENDING',
  ].includes(normalizeStatus(value));
}

function isActivePositionSnapshot(snapshot: PositionSnapshot | null): boolean {
  if (!snapshot) {
    return false;
  }
  if (snapshot.statusRank !== null && snapshot.statusRank !== undefined) {
    return Number(snapshot.statusRank) > 0 && Number(snapshot.statusRank) <= 2;
  }
  const normalized = normalizeStatus(
    snapshot.status ?? snapshot.payload?.status ?? snapshot.payload?.status_key
  );
  return ['OPEN', 'PARTIAL', 'PARTIALLY_CLOSED', 'PARTIALLY_CLOSED_POSITION'].includes(normalized);
}

function normalizeSymbolBase(value: unknown): string {
  const normalized = readString(value).toUpperCase();
  for (const suffix of ['USDT', 'USDC', 'USD']) {
    if (normalized.endsWith(suffix) && normalized.length > suffix.length) {
      return normalized.slice(0, -suffix.length);
    }
  }
  return normalized;
}

function appendNote(note: string | null | undefined, message: string): string {
  const current = readString(note);
  if (!current) {
    return message;
  }
  if (current.includes(message)) {
    return current;
  }
  return `${current} ${message}`;
}

function hasMatchingPositionIdentifier(
  snapshot: PositionSnapshot,
  expectedPositionId: string
): boolean {
  const payload = snapshot.payload ?? {};
  const identifiers = [
    snapshot.externalId,
    payload.id,
    payload.position_id,
    payload.positionId,
    payload.external_id,
    payload.externalId,
  ];
  return identifiers.some((value) => readString(value) === expectedPositionId);
}

function isResolvedPositionIdentity(item: MudrexProtectionRepairPreviewItem): boolean {
  return Boolean(
    item.positionReadModelExternalId &&
    item.positionResolution !== 'unresolved' &&
    !item.issues.includes('missing_position_read_model') &&
    !item.issues.includes('unsafe_position_mismatch')
  );
}

function validateLivePositionReadback(
  item: MudrexProtectionRepairPreviewItem,
  snapshots: PositionSnapshots
):
  | { ok: true; snapshot: PositionSnapshot; snapshots: PositionSnapshots }
  | { ok: false; status: MudrexRepairApplyStatus; reason: string } {
  const expectedPositionId = readString(item.positionReadModelExternalId);
  if (!expectedPositionId || !isResolvedPositionIdentity(item)) {
    return {
      ok: false,
      status: 'skipped_unsafe_position_identity',
      reason: 'Mudrex position identity is unresolved or unsafe',
    };
  }

  const matching = snapshots.find((snapshot) =>
    hasMatchingPositionIdentifier(snapshot, expectedPositionId)
  );
  if (!matching) {
    return {
      ok: false,
      status: 'skipped_live_position_readback_missing',
      reason: `fresh Mudrex position read-back did not include ${expectedPositionId}`,
    };
  }
  if (!isActivePositionSnapshot(matching)) {
    return {
      ok: false,
      status: 'skipped_live_position_readback_unsafe',
      reason: `Mudrex position ${expectedPositionId} is not active on fresh read-back`,
    };
  }

  return { ok: true, snapshot: matching, snapshots };
}

function removeMudrexProtectionFields(snapshot: PositionSnapshot): PositionSnapshot {
  const payload = { ...(snapshot.payload ?? {}) };
  for (const key of [
    'stoploss',
    'stopLoss',
    'stoploss_price',
    'stopLossPrice',
    'stoploss_order_id',
    'stopLossOrderId',
    'takeprofit',
    'takeProfit',
    'takeprofit_price',
    'takeProfitPrice',
    'takeprofit_order_id',
    'takeProfitOrderId',
  ]) {
    delete payload[key];
  }
  return {
    ...snapshot,
    payload,
  };
}

function replaceSnapshot(
  snapshots: PositionSnapshots,
  target: PositionSnapshot,
  replacement: PositionSnapshot
): PositionSnapshots {
  return snapshots.map((snapshot) =>
    snapshot.externalId === target.externalId ? replacement : snapshot
  );
}

function resolveCancelOrderIds(
  item: MudrexProtectionRepairPreviewItem,
  mutationField: 'cancelOrderIds' | 'replaceOrderIds'
): string[] {
  const mutation = readRecord(item.remediation.expectedMutation);
  return Array.from(
    new Set(
      [
        ...readArray(mutation[mutationField]),
        ...(mutationField === 'cancelOrderIds'
          ? [item.stopLossOrderId, item.takeProfitOrderId]
          : []),
      ]
        .map((orderId) => readString(orderId))
        .filter((orderId) => orderId && orderId !== item.entryOrderId)
    )
  );
}

function unwrapLiveOrderDetail(value: unknown): JsonRecord {
  const root = readRecord(value);
  for (const key of ['data', 'order', 'result']) {
    const nested = readRecord(root[key]);
    if (Object.keys(nested).length > 0) {
      return nested;
    }
  }
  return root;
}

function isMudrexProtectionOrderLike(input: {
  item: MudrexProtectionRepairPreviewItem;
  orderId: string;
  detail: JsonRecord;
}): boolean {
  if (
    input.orderId === input.item.stopLossOrderId ||
    input.orderId === input.item.takeProfitOrderId
  ) {
    return true;
  }
  const stopLossFlag = readBoolean(
    input.detail.is_stoploss ?? input.detail.isStopLoss ?? input.detail.is_stop_loss
  );
  const takeProfitFlag = readBoolean(
    input.detail.is_takeprofit ?? input.detail.isTakeProfit ?? input.detail.is_take_profit
  );
  if (stopLossFlag === true || takeProfitFlag === true) {
    return true;
  }
  const typeText = [
    input.detail.order_type,
    input.detail.orderType,
    input.detail.trigger_type,
    input.detail.triggerType,
    input.detail.stop_order_type,
    input.detail.stopOrderType,
    input.detail.type,
  ]
    .map((value) => readString(value).toLowerCase().replace(/[-\s]/g, '_'))
    .filter(Boolean)
    .join(' ');
  return (
    typeText.includes('stoploss') ||
    typeText.includes('stop_loss') ||
    typeText.includes('takeprofit') ||
    typeText.includes('take_profit')
  );
}

function validateMudrexCancelOrderReadback(input: {
  item: MudrexProtectionRepairPreviewItem;
  orderId: string;
  detail: JsonRecord;
}): { ok: true; readback: MudrexLiveOrderReadback } | { ok: false; reason: string } {
  if (input.orderId === input.item.entryOrderId) {
    return { ok: false, reason: `order ${input.orderId} is the entry order` };
  }

  const detailOrderId =
    readString(input.detail.id) ||
    readString(input.detail.order_id) ||
    readString(input.detail.orderId);
  if (detailOrderId && detailOrderId !== input.orderId) {
    return { ok: false, reason: `read-back id ${detailOrderId} did not match ${input.orderId}` };
  }

  const status =
    normalizeStatus(input.detail.status) ||
    normalizeStatus(input.detail.state) ||
    normalizeStatus(input.detail.order_status);
  const statusRank = readNumber(input.detail.status_rank ?? input.detail.statusRank);
  if (!isActiveOrderStatus(status) && !(statusRank && statusRank > 0 && statusRank <= 2)) {
    return {
      ok: false,
      reason: `order ${input.orderId} is no longer active on live read-back (${status || 'unknown'})`,
    };
  }

  if (!isMudrexProtectionOrderLike(input)) {
    return { ok: false, reason: `order ${input.orderId} is not a Mudrex SL/TP protection order` };
  }

  const liveSymbol = readString(
    input.detail.symbol ?? input.detail.product_symbol ?? input.detail.productSymbol
  );
  if (liveSymbol && normalizeSymbolBase(liveSymbol) !== normalizeSymbolBase(input.item.symbol)) {
    return {
      ok: false,
      reason: `order ${input.orderId} symbol ${liveSymbol} does not match ${input.item.symbol}`,
    };
  }

  const orderType = [
    input.detail.order_type,
    input.detail.orderType,
    input.detail.trigger_type,
    input.detail.triggerType,
    input.detail.type,
  ]
    .map(readString)
    .filter(Boolean)
    .join(' ');
  return {
    ok: true,
    readback: {
      orderId: input.orderId,
      detail: input.detail,
      status,
      orderType,
    },
  };
}

async function readBackCancelableOrders(input: {
  item: MudrexProtectionRepairPreviewItem;
  orderIds: string[];
  ordersAdapter?: BrokerOrdersAdapter;
  unavailableStatus: MudrexRepairApplyStatus;
  inactiveStatus: MudrexRepairApplyStatus;
  unsafeStatus: MudrexRepairApplyStatus;
}): Promise<
  | { ok: true; readbacks: MudrexLiveOrderReadback[] }
  | { ok: false; status: MudrexRepairApplyStatus; reason: string }
> {
  const { item, orderIds, ordersAdapter } = input;
  if (!ordersAdapter?.getOrder || !ordersAdapter.cancelOrder) {
    return {
      ok: false,
      status: input.unavailableStatus,
      reason: 'Mudrex order read-back/cancel adapter is unavailable',
    };
  }

  const readbacks: MudrexLiveOrderReadback[] = [];
  const unsafeReasons: string[] = [];
  const inactiveReasons: string[] = [];
  for (const orderId of orderIds) {
    try {
      const detail = unwrapLiveOrderDetail(
        await ordersAdapter.getOrder(orderId, {
          userId: item.userId,
          brokerKey: 'mudrex',
          accountId: item.accountId ?? undefined,
        })
      );
      const validation = validateMudrexCancelOrderReadback({ item, orderId, detail });
      if (!validation.ok) {
        if (validation.reason.includes('no longer active')) {
          inactiveReasons.push(validation.reason);
        } else {
          unsafeReasons.push(validation.reason);
        }
        continue;
      }
      readbacks.push(validation.readback);
    } catch (error) {
      unsafeReasons.push(`${orderId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (unsafeReasons.length) {
    return { ok: false, status: input.unsafeStatus, reason: unsafeReasons.join('; ') };
  }
  if (inactiveReasons.length || readbacks.length !== orderIds.length) {
    return {
      ok: false,
      status: input.inactiveStatus,
      reason: inactiveReasons.join('; ') || 'not all Mudrex protection orders are active',
    };
  }
  return { ok: true, readbacks };
}

function isStaleCancelTerminalCandidate(
  item: MudrexProtectionRepairPreviewItem,
  execution: SuggestedTradeExecutionLink
): boolean {
  return (
    item.issues.includes('stale_protection_for_closed_position') &&
    (isTerminalStatus(item.executionState) ||
      isTerminalStatus(item.positionStatus) ||
      isTerminalStatus(item.positionReadModelStatus) ||
      isTerminalStatus(execution.executionState) ||
      isTerminalStatus(execution.positionStatus) ||
      Boolean(execution.positionClosedAt))
  );
}

function buildSkippedItem(
  item: MudrexProtectionRepairPreviewItem,
  status: MudrexRepairApplyStatus,
  reason: string | null
): MudrexRepairApplyItem {
  return {
    suggestedTradeId: item.suggestedTradeId,
    userId: item.userId,
    symbol: item.symbol,
    action: item.remediation.action,
    status,
    reason,
    entryOrderId: item.entryOrderId,
    positionId: item.positionReadModelExternalId,
    before: null,
    after: null,
  };
}

async function applyCandidate(input: {
  item: MudrexProtectionRepairPreviewItem;
  repository: SuggestedTradeRepository;
  service: SuggestedTradesServiceInternals;
  ordersAdapter?: BrokerOrdersAdapter;
}): Promise<MudrexRepairApplyItem> {
  const { item, repository, service } = input;
  if (!item.remediation.repairable || item.remediation.readiness !== 'ready') {
    return buildSkippedItem(
      item,
      'skipped_not_repairable',
      'preview item is not repairable and ready'
    );
  }
  if (
    !isMudrexProtectionRepairApplyActionSupported(item.remediation.action, {
      includeStaleCancel: true,
    })
  ) {
    return buildSkippedItem(item, 'skipped_unsupported_action', 'action is not apply-supported');
  }

  const trade = await repository.getSuggestedTradeById(item.userId, item.suggestedTradeId);
  if (!trade) {
    return buildSkippedItem(item, 'skipped_trade_not_found', 'suggested trade was not found');
  }

  const execution = service.getExecutionLink(trade);
  if (!execution) {
    return buildSkippedItem(item, 'skipped_execution_missing', 'execution record was not found');
  }

  const match = executionMatchesPreview(item, execution);
  if (!match.matched) {
    return {
      ...buildSkippedItem(item, 'skipped_execution_mismatch', match.reason),
      before: summarizeExecution(execution),
    };
  }

  if (item.remediation.action === STALE_CANCEL_ACTION) {
    return applyStaleProtectionCancelCandidate({
      item,
      trade,
      execution,
      service,
      ordersAdapter: input.ordersAdapter,
    });
  }

  if (item.remediation.action === 'would_mark_terminal_protection_not_required') {
    return applyTerminalNotRequiredCandidate({ item, trade, execution, service });
  }

  return applyOpenPositionRepairCandidate({
    item,
    trade,
    execution,
    repository,
    service,
    ordersAdapter: input.ordersAdapter,
  });
}

async function applyOpenPositionRepairCandidate(input: {
  item: MudrexProtectionRepairPreviewItem;
  trade: SuggestedTrade;
  execution: SuggestedTradeExecutionLink;
  repository: SuggestedTradeRepository;
  service: SuggestedTradesServiceInternals;
  ordersAdapter?: BrokerOrdersAdapter;
}): Promise<MudrexRepairApplyItem> {
  const { item, trade, execution, repository, service, ordersAdapter } = input;
  const before = summarizeExecution(execution);
  if (!isResolvedPositionIdentity(item)) {
    return {
      ...buildSkippedItem(
        item,
        'skipped_unsafe_position_identity',
        'Mudrex position identity is unresolved or unsafe'
      ),
      before,
    };
  }
  if (item.sameSymbolOpenPositionCandidates > 1) {
    return {
      ...buildSkippedItem(
        item,
        'skipped_same_symbol_ambiguity',
        'multiple same-symbol open Mudrex position candidates exist'
      ),
      before,
    };
  }

  const accountId = readString(execution.accountId);
  if (!accountId) {
    return {
      ...buildSkippedItem(item, 'skipped_execution_mismatch', 'execution account id is missing'),
      before,
    };
  }

  const anchor = buildPositionSearchAnchor(
    execution.submittedAt ??
      execution.filledAt ??
      execution.linkedAt ??
      trade.signalTime?.toISOString?.() ??
      trade.createdAt?.toISOString?.()
  );
  const positionSnapshots = await repository.getLinkedPositionSnapshots(
    item.userId,
    'mudrex',
    accountId,
    trade.symbol,
    anchor,
    20,
    item.positionReadModelExternalId ?? execution.positionId ?? item.positionId,
    {
      preferredPositionOpenedAt:
        execution.positionOpenedAt ??
        execution.filledAt ??
        execution.submittedAt ??
        execution.linkedAt ??
        trade.signalTime?.toISOString?.() ??
        trade.createdAt?.toISOString?.(),
      preferredSide: trade.side,
    }
  );

  const positionReadback = validateLivePositionReadback(item, positionSnapshots);
  if (!positionReadback.ok) {
    return {
      ...buildSkippedItem(item, positionReadback.status, positionReadback.reason),
      before,
    };
  }

  let repairExecution = execution;
  let repairSnapshots = positionReadback.snapshots;
  const cancelledOrderIds: string[] = [];
  if (item.remediation.action === REPLACE_PARTIAL_FILL_ACTION) {
    const replaceOrderIds = resolveCancelOrderIds(item, 'replaceOrderIds');
    if (!replaceOrderIds.length) {
      return {
        ...buildSkippedItem(
          item,
          'skipped_cancel_missing_order_ids',
          'no mismatched Mudrex protection order ids were available to replace'
        ),
        before,
      };
    }
    const orderReadback = await readBackCancelableOrders({
      item,
      orderIds: replaceOrderIds,
      ordersAdapter,
      unavailableStatus: 'skipped_cancel_order_readback_unavailable',
      inactiveStatus: 'skipped_cancel_live_readback_inactive',
      unsafeStatus: 'skipped_cancel_live_readback_unsafe',
    });
    if (!orderReadback.ok) {
      return {
        ...buildSkippedItem(item, orderReadback.status, orderReadback.reason),
        before,
      };
    }

    try {
      for (const order of orderReadback.readbacks) {
        await ordersAdapter?.cancelOrder(order.orderId, {
          userId: item.userId,
          brokerKey: 'mudrex',
          accountId,
        });
        cancelledOrderIds.push(order.orderId);
      }
    } catch (error) {
      return {
        ...buildSkippedItem(
          item,
          'error',
          `${cancelledOrderIds.length ? `cancelled ${cancelledOrderIds.join(', ')} before failure; ` : ''}${
            error instanceof Error ? error.message : String(error)
          }`
        ),
        cancelledOrderIds,
        before,
      };
    }

    const strippedSnapshot = removeMudrexProtectionFields(positionReadback.snapshot);
    repairSnapshots = replaceSnapshot(
      positionReadback.snapshots,
      positionReadback.snapshot,
      strippedSnapshot
    );
    repairExecution = {
      ...execution,
      protectionState: 'pending',
      protectionAttachedAt: null,
      protectionLastError:
        'Mudrex partial-fill protection mismatch replacement cancelled old SL/TP orders; reattaching scaled protection.',
      note: appendNote(
        execution.note,
        `Mudrex partial-fill protection replacement cancelled old SL/TP orders: ${cancelledOrderIds.join(', ')}.`
      ),
    };
  }

  try {
    let nextExecution = await service.maybeRemediateLiveProtection(
      item.userId,
      trade,
      repairExecution,
      repairSnapshots
    );
    nextExecution = service.alignLiveAutoExecutionStateWithProtectionLifecycle(nextExecution);
    const after = summarizeExecution(nextExecution);
    if (JSON.stringify(repairExecution ?? null) === JSON.stringify(nextExecution ?? null)) {
      if (cancelledOrderIds.length) {
        const nowIso = new Date().toISOString();
        const plan = readRecord(execution.protectionPlan);
        const changedExecution: SuggestedTradeExecutionLink = {
          ...nextExecution,
          protectionCheckedAt: nowIso,
          protectionPlan: {
            ...plan,
            replacementCancelledOrderIds: cancelledOrderIds,
            replacementCancelSource: 'mudrex_repair_apply',
            replacementCancelledAt: nowIso,
          },
          note: appendNote(
            nextExecution.note,
            `Mudrex partial-fill replacement cancelled mismatched protection orders: ${cancelledOrderIds.join(', ')}.`
          ),
        };
        await service.persistExecutionState(trade, changedExecution);
        return {
          ...buildSkippedItem(item, 'applied', 'cancelled mismatched protection orders'),
          cancelledOrderIds,
          before,
          after: summarizeExecution(changedExecution),
        };
      }
      return {
        ...buildSkippedItem(item, 'no_change', 'existing remediation path did not change state'),
        before,
        after,
      };
    }

    await service.persistExecutionState(trade, nextExecution);
    return {
      ...buildSkippedItem(item, 'applied', null),
      cancelledOrderIds: cancelledOrderIds.length ? cancelledOrderIds : undefined,
      before,
      after,
    };
  } catch (error) {
    return {
      ...buildSkippedItem(
        item,
        'error',
        `${cancelledOrderIds.length ? `cancelled ${cancelledOrderIds.join(', ')} before failure; ` : ''}${
          error instanceof Error ? error.message : String(error)
        }`
      ),
      cancelledOrderIds: cancelledOrderIds.length ? cancelledOrderIds : undefined,
      before,
    };
  }
}

async function applyTerminalNotRequiredCandidate(input: {
  item: MudrexProtectionRepairPreviewItem;
  trade: SuggestedTrade;
  execution: SuggestedTradeExecutionLink;
  service: SuggestedTradesServiceInternals;
}): Promise<MudrexRepairApplyItem> {
  const { item, trade, execution, service } = input;
  const before = summarizeExecution(execution);
  if (!isResolvedPositionIdentity(item)) {
    return {
      ...buildSkippedItem(
        item,
        'skipped_unsafe_position_identity',
        'Mudrex position identity is unresolved or unsafe'
      ),
      before,
    };
  }
  if (item.sameSymbolOpenPositionCandidates > 0) {
    return {
      ...buildSkippedItem(
        item,
        'skipped_stale_cancel_same_symbol_open_position',
        'same-symbol open Mudrex position candidates exist; refusing terminal protection mutation'
      ),
      before,
    };
  }
  if (!isStaleCancelTerminalCandidate(item, execution)) {
    return {
      ...buildSkippedItem(
        item,
        'skipped_stale_cancel_not_terminal',
        'terminal protection mark requires terminal execution/position evidence'
      ),
      before,
    };
  }

  const nowIso = new Date().toISOString();
  const plan = readRecord(execution.protectionPlan);
  const message = 'Mudrex terminal execution no longer requires SL/TP protection.';
  const nextExecution: SuggestedTradeExecutionLink = {
    ...execution,
    protectionState: 'not_required',
    protectionCheckedAt: nowIso,
    protectionLastError: null,
    protectionPlan: {
      ...plan,
      terminalProtectionMarkedNotRequiredAt: nowIso,
      terminalProtectionMarkSource: 'mudrex_repair_apply',
    },
    note: appendNote(execution.note, message),
  };
  await service.persistExecutionState(trade, nextExecution);
  return {
    ...buildSkippedItem(item, 'applied', null),
    before,
    after: summarizeExecution(nextExecution),
  };
}

async function applyStaleProtectionCancelCandidate(input: {
  item: MudrexProtectionRepairPreviewItem;
  trade: SuggestedTrade;
  execution: SuggestedTradeExecutionLink;
  service: SuggestedTradesServiceInternals;
  ordersAdapter?: BrokerOrdersAdapter;
}): Promise<MudrexRepairApplyItem> {
  const { item, trade, execution, service, ordersAdapter } = input;
  const before = summarizeExecution(execution);
  if (!STALE_CANCEL_APPLY) {
    return {
      ...buildSkippedItem(
        item,
        'blocked_stale_cancel_disabled',
        'set SUGGESTED_TRADES_MUDREX_STALE_PROTECTION_CANCEL_APPLY=true before cancelling stale Mudrex protection'
      ),
      before,
    };
  }
  if (!isResolvedPositionIdentity(item)) {
    return {
      ...buildSkippedItem(
        item,
        'skipped_unsafe_position_identity',
        'Mudrex position identity is unresolved or unsafe'
      ),
      before,
    };
  }
  if (!isStaleCancelTerminalCandidate(item, execution)) {
    return {
      ...buildSkippedItem(
        item,
        'skipped_stale_cancel_not_terminal',
        'stale protection cancellation requires terminal execution/position evidence'
      ),
      before,
    };
  }
  if (item.sameSymbolOpenPositionCandidates > 0) {
    return {
      ...buildSkippedItem(
        item,
        'skipped_stale_cancel_same_symbol_open_position',
        'same-symbol open Mudrex position candidates exist; refusing stale protection cancellation'
      ),
      before,
    };
  }

  const accountId = readString(execution.accountId);
  const brokerKey = readString(execution.brokerKey).toLowerCase();
  const orderIds = resolveCancelOrderIds(item, 'cancelOrderIds');
  if (!accountId || brokerKey !== 'mudrex') {
    return {
      ...buildSkippedItem(
        item,
        'skipped_execution_mismatch',
        'stale cancellation requires a Mudrex execution with account routing'
      ),
      before,
    };
  }
  if (!orderIds.length) {
    return {
      ...buildSkippedItem(
        item,
        'skipped_stale_cancel_missing_order_ids',
        'no linked stale protection order ids were available to cancel'
      ),
      before,
    };
  }

  const orderReadback = await readBackCancelableOrders({
    item,
    orderIds,
    ordersAdapter,
    unavailableStatus: 'skipped_stale_cancel_order_readback_unavailable',
    inactiveStatus: 'skipped_stale_cancel_live_readback_inactive',
    unsafeStatus: 'skipped_stale_cancel_live_readback_unsafe',
  });
  if (!orderReadback.ok) {
    return {
      ...buildSkippedItem(item, orderReadback.status, orderReadback.reason),
      before,
    };
  }

  const cancelledOrderIds: string[] = [];
  try {
    for (const order of orderReadback.readbacks) {
      await ordersAdapter?.cancelOrder(order.orderId, {
        userId: item.userId,
        brokerKey,
        accountId,
      });
      cancelledOrderIds.push(order.orderId);
    }
    const nowIso = new Date().toISOString();
    const message = `Mudrex stale protection cancel requested after terminal position read-back: ${cancelledOrderIds.join(
      ', '
    )}.`;
    const plan = readRecord(execution.protectionPlan);
    const nextExecution: SuggestedTradeExecutionLink = {
      ...execution,
      protectionState: 'not_required',
      protectionCheckedAt: nowIso,
      protectionLastError: null,
      protectionPlan: {
        ...plan,
        staleProtectionCancelRequestedAt: nowIso,
        staleProtectionCancelSource: 'mudrex_repair_apply',
        staleProtectionCancelledOrderIds: cancelledOrderIds,
      },
      note: appendNote(execution.note, message),
    };
    await service.persistExecutionState(trade, nextExecution);
    return {
      ...buildSkippedItem(item, 'applied', null),
      cancelledOrderIds,
      before,
      after: summarizeExecution(nextExecution),
    };
  } catch (error) {
    return {
      ...buildSkippedItem(
        item,
        'error',
        `${cancelledOrderIds.length ? `cancelled ${cancelledOrderIds.join(', ')} before failure; ` : ''}${
          error instanceof Error ? error.message : String(error)
        }`
      ),
      cancelledOrderIds,
      before,
    };
  }
}

async function persistReport(report: JsonRecord): Promise<void> {
  if (!OUTPUT_FILE) {
    return;
  }
  const absoluteOutputPath = path.resolve(process.cwd(), OUTPUT_FILE);
  await mkdir(path.dirname(absoluteOutputPath), { recursive: true });
  await writeFile(absoluteOutputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

async function run(): Promise<void> {
  await initializeCoreDataSource();

  try {
    const healthReport = await buildMudrexProtectionHealthReport();
    const previewReport = buildMudrexProtectionRepairPreviewReport(healthReport);
    const candidates = selectMudrexProtectionRepairApplyCandidates(previewReport.items, LIMIT, {
      includeStaleCancel: true,
    });
    const unsupportedRepairableItems = previewReport.items.filter(
      (item) =>
        item.remediation.repairable &&
        item.remediation.readiness === 'ready' &&
        !isMudrexProtectionRepairApplyActionSupported(item.remediation.action, {
          includeStaleCancel: true,
        })
    ).length;
    const staleCancelCandidateItems = candidates.filter(
      (item) => item.remediation.action === STALE_CANCEL_ACTION
    ).length;
    const replacementCandidateItems = candidates.filter(
      (item) => item.remediation.action === REPLACE_PARTIAL_FILL_ACTION
    ).length;
    const terminalMarkCandidateItems = candidates.filter(
      (item) => item.remediation.action === 'would_mark_terminal_protection_not_required'
    ).length;
    const brokerRepairEnabled = isSuggestedTradeProtectionRepairEnabledForBroker(
      'mudrex',
      readBooleanEnvOverride
    );

    let items: MudrexRepairApplyItem[] = [];
    if (!APPLY) {
      items = candidates.map((item) =>
        buildSkippedItem(
          item,
          'not_applied_apply_disabled',
          'set SUGGESTED_TRADES_MUDREX_PROTECTION_REPAIR_APPLY=true to enable apply mode'
        )
      );
    } else if (!brokerRepairEnabled) {
      items = candidates.map((item) =>
        buildSkippedItem(
          item,
          'blocked_broker_repair_disabled',
          'set SUGGESTED_TRADES_PROTECTION_REPAIR_MUDREX_ENABLED=true before applying Mudrex repairs'
        )
      );
    } else {
      const repository = Container.get(SuggestedTradeRepository);
      const service = Container.get(
        SuggestedTradesService
      ) as unknown as SuggestedTradesServiceInternals;
      const ordersAdapter = Container.get(BrokerRuntimeRegistry).getOrdersAdapter('mudrex');
      for (const item of candidates) {
        items.push(await applyCandidate({ item, repository, service, ordersAdapter }));
      }
    }

    const appliedItems = items.filter((item) => item.status === 'applied').length;
    const noChangeItems = items.filter((item) => item.status === 'no_change').length;
    const errorItems = items.filter((item) => item.status === 'error').length;
    const blockedItems = items.filter(
      (item) =>
        item.status === 'blocked_broker_repair_disabled' ||
        item.status === 'blocked_stale_cancel_disabled' ||
        item.status.startsWith('skipped_')
    ).length;

    const report = {
      generatedAt: new Date().toISOString(),
      mode: APPLY ? 'apply' : 'dry_run',
      dryRun: !APPLY,
      applyEnabled: APPLY,
      applyFlag: 'SUGGESTED_TRADES_MUDREX_PROTECTION_REPAIR_APPLY',
      staleCancelApplyEnabled: STALE_CANCEL_APPLY,
      staleCancelApplyFlag: 'SUGGESTED_TRADES_MUDREX_STALE_PROTECTION_CANCEL_APPLY',
      brokerRepairEnabled,
      brokerRepairFlag: 'SUGGESTED_TRADES_PROTECTION_REPAIR_MUDREX_ENABLED',
      limit: LIMIT,
      preview: {
        generatedAt: previewReport.generatedAt,
        audited: previewReport.audited,
        openPositions: previewReport.openPositions,
        issueTrades: previewReport.issueTrades,
        repairableItems: previewReport.repairableItems,
        blockedItems: previewReport.blockedItems,
        manualReviewItems: previewReport.manualReviewItems,
        byAction: previewReport.byAction,
      },
      candidateItems: candidates.length,
      staleCancelCandidateItems,
      replacementCandidateItems,
      terminalMarkCandidateItems,
      unsupportedRepairableItems,
      appliedItems,
      noChangeItems,
      blockedItems,
      errorItems,
      items,
    };
    await persistReport(report);
    console.log('suggested-trades-mudrex-protection-repair:', JSON.stringify(report));
  } finally {
    if (coreDataSource.isInitialized) {
      await coreDataSource.destroy();
    }
  }
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
