import 'reflect-metadata';

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Container } from 'typedi';
import type { SuggestedTradeExecutionLink } from '../../src/api/contracts/SuggestedTrade';
import { SuggestedTradesService } from '../../src/api/services/SuggestedTradesService';
import { isSuggestedTradeProtectionRepairEnabledForBroker } from '../../src/api/services/suggested-trades/SuggestedTradeBrokerControls';
import type { BrokerOrdersAdapter } from '../../src/brokers/capabilities/orders/types';
import { BrokerRuntimeRegistry } from '../../src/brokers/core/BrokerRuntimeRegistry';
import { SuggestedTrade } from '../../src/database/entities/SuggestedTrade';
import { coreDataSource } from '../../src/database/data-source';
import { initializeCoreDataSource } from '../../src/database/initializeCoreDataSource';
import { SuggestedTradeRepository } from '../../src/database/repositories/SuggestedTradeRepository';
import { buildDeltaProtectionGuardrailReport } from '../checks/check-suggested-trades-delta-protection-guardrail';
import {
  buildDeltaProtectionRepairPreviewReport,
  type DeltaProtectionRepairAction,
  type DeltaProtectionRepairPreviewItem,
} from '../checks/check-suggested-trades-delta-protection-repair-preview';

type JsonRecord = Record<string, unknown>;
type DeltaRepairApplyStatus =
  | 'not_applied_apply_disabled'
  | 'blocked_broker_repair_disabled'
  | 'blocked_stale_cancel_disabled'
  | 'skipped_not_repairable'
  | 'skipped_unsupported_action'
  | 'skipped_trade_not_found'
  | 'skipped_execution_missing'
  | 'skipped_execution_mismatch'
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

type DeltaRepairApplyItem = {
  suggestedTradeId: string;
  userId: string;
  symbol: string;
  action: DeltaProtectionRepairAction;
  status: DeltaRepairApplyStatus;
  reason: string | null;
  entryOrderId: string | null;
  positionId: string | null;
  before: JsonRecord | null;
  after: JsonRecord | null;
};

const APPLY =
  String(process.env.SUGGESTED_TRADES_DELTA_PROTECTION_REPAIR_APPLY || '')
    .trim()
    .toLowerCase() === 'true';
const STALE_CANCEL_APPLY =
  String(process.env.SUGGESTED_TRADES_DELTA_STALE_PROTECTION_CANCEL_APPLY || '')
    .trim()
    .toLowerCase() === 'true';
const LIMIT = Math.max(
  1,
  Math.floor(Number(process.env.SUGGESTED_TRADES_DELTA_PROTECTION_REPAIR_LIMIT || 5))
);
const OUTPUT_FILE = String(
  process.env.SUGGESTED_TRADES_DELTA_PROTECTION_REPAIR_OUTPUT_FILE ||
    'artifacts/suggested-trades-delta-protection-repair.json'
).trim();
const STANDARD_APPLY_ACTIONS = new Set<DeltaProtectionRepairAction>([
  'would_attach_missing_protection',
  'would_replace_mismatched_partial_fill_protection',
  'would_reconcile_native_bracket_protection',
]);
const STALE_CANCEL_ACTION: DeltaProtectionRepairAction = 'would_cancel_stale_protection_orders';

function readString(value: unknown): string {
  return String(value ?? '').trim();
}

function readRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
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
  const protectionPlan =
    execution.protectionPlan && typeof execution.protectionPlan === 'object'
      ? (execution.protectionPlan as JsonRecord)
      : {};
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
  item: DeltaProtectionRepairPreviewItem,
  execution: SuggestedTradeExecutionLink
): { matched: boolean; reason: string | null } {
  if (readString(execution.brokerKey).toLowerCase() !== 'delta_exchange') {
    return { matched: false, reason: 'execution is not routed to Delta Exchange' };
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

export function isDeltaProtectionRepairApplyActionSupported(
  action: DeltaProtectionRepairAction,
  options: { includeStaleCancel?: boolean } = {}
): boolean {
  return (
    STANDARD_APPLY_ACTIONS.has(action) ||
    (options.includeStaleCancel === true && action === STALE_CANCEL_ACTION)
  );
}

export function selectDeltaProtectionRepairApplyCandidates(
  items: DeltaProtectionRepairPreviewItem[],
  limit = LIMIT,
  options: { includeStaleCancel?: boolean } = {}
): DeltaProtectionRepairPreviewItem[] {
  return items
    .filter(
      (item) =>
        item.remediation.repairable &&
        item.remediation.readiness === 'ready' &&
        isDeltaProtectionRepairApplyActionSupported(item.remediation.action, options)
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
  return ['OPEN', 'PENDING', 'PARTIALLY_FILLED', 'PARTIAL_FILLED', 'TRIGGER_PENDING'].includes(
    normalizeStatus(value)
  );
}

function normalizeSide(value: unknown): 'buy' | 'sell' | null {
  const normalized = readString(value).toLowerCase();
  if (['buy', 'long'].includes(normalized)) {
    return 'buy';
  }
  if (['sell', 'short'].includes(normalized)) {
    return 'sell';
  }
  return null;
}

function normalizeSymbolBase(value: unknown): string {
  const normalized = readString(value).toUpperCase();
  for (const suffix of ['USDT', 'USDC', 'USD']) {
    if (normalized.endsWith(suffix)) {
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

function resolveStaleCancelOrderIds(item: DeltaProtectionRepairPreviewItem): string[] {
  const mutation = readRecord(item.remediation.expectedMutation);
  return Array.from(
    new Set(
      [
        ...readArray(mutation.cancelOrderIds),
        item.stopLossOrderId,
        item.takeProfitOrderId,
      ]
        .map((orderId) => readString(orderId))
        .filter((orderId) => orderId && orderId !== item.entryOrderId)
    )
  );
}

function isStaleCancelTerminalCandidate(
  item: DeltaProtectionRepairPreviewItem,
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

type DeltaLiveOrderReadback = {
  orderId: string;
  detail: JsonRecord;
  status: string;
  stopOrderType: string;
};

function validateDeltaStaleCancelOrderReadback(input: {
  item: DeltaProtectionRepairPreviewItem;
  orderId: string;
  detail: JsonRecord;
}): { ok: true; readback: DeltaLiveOrderReadback } | { ok: false; reason: string } {
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
  if (!isActiveOrderStatus(status)) {
    return {
      ok: false,
      reason: `order ${input.orderId} is no longer active on live read-back (${status || 'unknown'})`,
    };
  }

  const reduceOnly = readBoolean(input.detail.reduce_only ?? input.detail.reduceOnly);
  if (reduceOnly !== true) {
    return { ok: false, reason: `order ${input.orderId} is not reduce-only` };
  }

  const entrySide = normalizeSide(input.item.side);
  if (!entrySide) {
    return { ok: false, reason: `trade side ${input.item.side} cannot be mapped safely` };
  }
  const expectedProtectionSide = entrySide === 'buy' ? 'sell' : 'buy';
  const liveSide = normalizeSide(input.detail.side);
  if (liveSide !== expectedProtectionSide) {
    return {
      ok: false,
      reason: `order ${input.orderId} side ${liveSide ?? 'unknown'} does not match expected protection side ${expectedProtectionSide}`,
    };
  }

  const stopOrderType = readString(input.detail.stop_order_type ?? input.detail.stopOrderType)
    .toLowerCase()
    .replace(/-/g, '_');
  if (!stopOrderType.includes('stop_loss') && !stopOrderType.includes('take_profit')) {
    return {
      ok: false,
      reason: `order ${input.orderId} is not a Delta SL/TP stop order`,
    };
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

  return {
    ok: true,
    readback: {
      orderId: input.orderId,
      detail: input.detail,
      status,
      stopOrderType,
    },
  };
}

function buildSkippedItem(
  item: DeltaProtectionRepairPreviewItem,
  status: DeltaRepairApplyStatus,
  reason: string | null
): DeltaRepairApplyItem {
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
  item: DeltaProtectionRepairPreviewItem;
  repository: SuggestedTradeRepository;
  service: SuggestedTradesServiceInternals;
  ordersAdapter?: BrokerOrdersAdapter;
}): Promise<DeltaRepairApplyItem> {
  const { item, repository, service } = input;
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

  const accountId = readString(execution.accountId);
  if (!accountId) {
    return {
      ...buildSkippedItem(item, 'skipped_execution_mismatch', 'execution account id is missing'),
      before: summarizeExecution(execution),
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
    'delta_exchange',
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

  const before = summarizeExecution(execution);
  try {
    let nextExecution = await service.maybeRemediateLiveProtection(
      item.userId,
      trade,
      execution,
      positionSnapshots
    );
    nextExecution = service.alignLiveAutoExecutionStateWithProtectionLifecycle(nextExecution);
    const after = summarizeExecution(nextExecution);
    if (JSON.stringify(execution ?? null) === JSON.stringify(nextExecution ?? null)) {
      return {
        ...buildSkippedItem(item, 'no_change', 'existing remediation path did not change state'),
        before,
        after,
      };
    }

    await service.persistExecutionState(trade, nextExecution);
    return {
      ...buildSkippedItem(item, 'applied', null),
      before,
      after,
    };
  } catch (error) {
    return {
      ...buildSkippedItem(
        item,
        'error',
        error instanceof Error ? error.message : String(error)
      ),
      before,
      after: null,
    };
  }
}

async function applyStaleProtectionCancelCandidate(input: {
  item: DeltaProtectionRepairPreviewItem;
  trade: SuggestedTrade;
  execution: SuggestedTradeExecutionLink;
  service: SuggestedTradesServiceInternals;
  ordersAdapter?: BrokerOrdersAdapter;
}): Promise<DeltaRepairApplyItem> {
  const { item, trade, execution, service, ordersAdapter } = input;
  const before = summarizeExecution(execution);
  if (!STALE_CANCEL_APPLY) {
    return {
      ...buildSkippedItem(
        item,
        'blocked_stale_cancel_disabled',
        'set SUGGESTED_TRADES_DELTA_STALE_PROTECTION_CANCEL_APPLY=true before cancelling stale Delta protection'
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
        'same-symbol open Delta position candidates exist; refusing stale protection cancellation'
      ),
      before,
    };
  }

  const accountId = readString(execution.accountId);
  const brokerKey = readString(execution.brokerKey).toLowerCase();
  const orderIds = resolveStaleCancelOrderIds(item);
  if (!accountId || brokerKey !== 'delta_exchange') {
    return {
      ...buildSkippedItem(
        item,
        'skipped_execution_mismatch',
        'stale cancellation requires a Delta execution with account routing'
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
  if (!ordersAdapter?.getOrder || !ordersAdapter.cancelOrder) {
    return {
      ...buildSkippedItem(
        item,
        'skipped_stale_cancel_order_readback_unavailable',
        'Delta order read-back/cancel adapter is unavailable'
      ),
      before,
    };
  }

  const readbacks: DeltaLiveOrderReadback[] = [];
  const unsafeReasons: string[] = [];
  const inactiveReasons: string[] = [];
  for (const orderId of orderIds) {
    try {
      const detail = readRecord(
        await ordersAdapter.getOrder(orderId, {
          userId: item.userId,
          brokerKey,
          accountId,
        })
      );
      const validation = validateDeltaStaleCancelOrderReadback({ item, orderId, detail });
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
      unsafeReasons.push(
        `${orderId}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  if (unsafeReasons.length) {
    return {
      ...buildSkippedItem(
        item,
        'skipped_stale_cancel_live_readback_unsafe',
        unsafeReasons.join('; ')
      ),
      before,
    };
  }
  if (inactiveReasons.length || readbacks.length !== orderIds.length) {
    return {
      ...buildSkippedItem(
        item,
        'skipped_stale_cancel_live_readback_inactive',
        inactiveReasons.join('; ') || 'not all stale protection orders are active on live read-back'
      ),
      before,
    };
  }

  const cancelledOrderIds: string[] = [];
  try {
    for (const order of readbacks) {
      await ordersAdapter.cancelOrder(order.orderId, {
        userId: item.userId,
        brokerKey,
        accountId,
      });
      cancelledOrderIds.push(order.orderId);
    }
    const nowIso = new Date().toISOString();
    const message = `Delta stale protection cancel requested after terminal position read-back: ${cancelledOrderIds.join(
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
        staleProtectionCancelSource: 'delta_repair_apply',
        staleProtectionCancelledOrderIds: cancelledOrderIds,
      },
      note: appendNote(execution.note, message),
    };
    await service.persistExecutionState(trade, nextExecution);
    return {
      ...buildSkippedItem(item, 'applied', null),
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
    const guardrailReport = await buildDeltaProtectionGuardrailReport();
    const previewReport = buildDeltaProtectionRepairPreviewReport(guardrailReport);
    const candidates = selectDeltaProtectionRepairApplyCandidates(previewReport.items, LIMIT, {
      includeStaleCancel: true,
    });
    const unsupportedRepairableItems = previewReport.items.filter(
      (item) =>
        item.remediation.repairable &&
        item.remediation.readiness === 'ready' &&
        !isDeltaProtectionRepairApplyActionSupported(item.remediation.action, {
          includeStaleCancel: true,
        })
    ).length;
    const staleCancelCandidateItems = candidates.filter(
      (item) => item.remediation.action === STALE_CANCEL_ACTION
    ).length;
    const brokerRepairEnabled = isSuggestedTradeProtectionRepairEnabledForBroker(
      'delta_exchange',
      readBooleanEnvOverride
    );

    let items: DeltaRepairApplyItem[] = [];
    if (!APPLY) {
      items = candidates.map((item) =>
        buildSkippedItem(
          item,
          'not_applied_apply_disabled',
          'set SUGGESTED_TRADES_DELTA_PROTECTION_REPAIR_APPLY=true to enable apply mode'
        )
      );
    } else if (!brokerRepairEnabled) {
      items = candidates.map((item) =>
        buildSkippedItem(
          item,
          'blocked_broker_repair_disabled',
          'set SUGGESTED_TRADES_PROTECTION_REPAIR_DELTA_EXCHANGE_ENABLED=true before applying Delta repairs'
        )
      );
    } else {
      const repository = Container.get(SuggestedTradeRepository);
      const service = Container.get(
        SuggestedTradesService
      ) as unknown as SuggestedTradesServiceInternals;
      const ordersAdapter = Container.get(BrokerRuntimeRegistry).getOrdersAdapter('delta_exchange');
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
        item.status === 'skipped_execution_mismatch' ||
        item.status === 'skipped_trade_not_found' ||
        item.status === 'skipped_execution_missing' ||
        item.status.startsWith('skipped_stale_cancel_')
    ).length;

    const report = {
      generatedAt: new Date().toISOString(),
      mode: APPLY ? 'apply' : 'dry_run',
      applyEnabled: APPLY,
      applyFlag: 'SUGGESTED_TRADES_DELTA_PROTECTION_REPAIR_APPLY',
      staleCancelApplyEnabled: STALE_CANCEL_APPLY,
      staleCancelApplyFlag: 'SUGGESTED_TRADES_DELTA_STALE_PROTECTION_CANCEL_APPLY',
      brokerRepairEnabled,
      brokerRepairFlag: 'SUGGESTED_TRADES_PROTECTION_REPAIR_DELTA_EXCHANGE_ENABLED',
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
      unsupportedRepairableItems,
      appliedItems,
      noChangeItems,
      blockedItems,
      errorItems,
      items,
    };
    await persistReport(report);
    console.log('suggested-trades-delta-protection-repair:', JSON.stringify(report));
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
