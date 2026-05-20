import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { coreDataSource } from '../../src/database/data-source';
import { initializeCoreDataSource } from '../../src/database/initializeCoreDataSource';
import {
  buildDeltaProtectionGuardrailReport,
  type DeltaGuardrailItem,
  type DeltaProtectionGuardrailReport,
} from './check-suggested-trades-delta-protection-guardrail';

type JsonRecord = Record<string, unknown>;
type ProtectionLeg = 'stop_loss' | 'take_profit';

export type DeltaProtectionRepairAction =
  | 'would_attach_missing_protection'
  | 'would_cancel_stale_protection_orders'
  | 'would_replace_mismatched_partial_fill_protection'
  | 'would_reconcile_native_bracket_protection'
  | 'manual_review_required';

export type DeltaProtectionRepairReadiness = 'ready' | 'blocked' | 'manual_review';

export type DeltaProtectionRepairPreview = {
  action: DeltaProtectionRepairAction;
  readiness: DeltaProtectionRepairReadiness;
  repairable: boolean;
  mutation: 'none_preview_only';
  blockers: string[];
  notes: string[];
  expectedMutation: JsonRecord;
};

export type DeltaProtectionRepairPreviewItem = DeltaGuardrailItem & {
  remediation: DeltaProtectionRepairPreview;
};

export type DeltaProtectionRepairPreviewReport = Omit<DeltaProtectionGuardrailReport, 'items'> & {
  mode: 'preview';
  dryRun: true;
  repairableItems: number;
  blockedItems: number;
  manualReviewItems: number;
  byAction: Record<DeltaProtectionRepairAction, number>;
  items: DeltaProtectionRepairPreviewItem[];
};

const OUTPUT_FILE = String(
  process.env.SUGGESTED_TRADES_DELTA_PROTECTION_REPAIR_PREVIEW_OUTPUT_FILE ||
    'artifacts/suggested-trades-delta-protection-repair-preview.json'
).trim();

function hasIssue(item: DeltaGuardrailItem, issue: DeltaGuardrailItem['issues'][number]): boolean {
  return item.issues.includes(issue);
}

function readString(value: unknown): string {
  return String(value ?? '').trim();
}

function positiveNumber(value: number | null): boolean {
  return value !== null && Number.isFinite(value) && value > 0;
}

function isWholeContractQuantity(value: number | null): boolean {
  return positiveNumber(value) && Math.abs(Number(value) - Math.round(Number(value))) <= 1e-9;
}

function isNativeBracket(item: DeltaGuardrailItem): boolean {
  return readString(item.protectionMode).toLowerCase() === 'native_bracket';
}

function pushBlocker(blockers: string[], blocker: string): void {
  if (!blockers.includes(blocker)) {
    blockers.push(blocker);
  }
}

function linkedProtectionOrderIds(item: DeltaGuardrailItem): string[] {
  return Array.from(
    new Set([readString(item.stopLossOrderId), readString(item.takeProfitOrderId)].filter(Boolean))
  );
}

function missingProtectionLegs(item: DeltaGuardrailItem): ProtectionLeg[] {
  const legs: ProtectionLeg[] = [];
  if (hasIssue(item, 'missing_active_stop_loss')) {
    legs.push('stop_loss');
  }
  if (hasIssue(item, 'missing_active_take_profit')) {
    legs.push('take_profit');
  }
  return legs;
}

function buildRepairBlockers(
  item: DeltaGuardrailItem,
  options: {
    requiredPriceLegs?: ProtectionLeg[];
    requireWholeContractQuantity?: boolean;
  } = {}
): string[] {
  const blockers: string[] = [];
  const requiredPriceLegs =
    options.requiredPriceLegs ?? (['stop_loss', 'take_profit'] as ProtectionLeg[]);
  const requireWholeContractQuantity = options.requireWholeContractQuantity ?? true;
  if (!item.accountId) {
    blockers.push('missing Delta account id');
  }
  if (!item.positionReadModelExternalId) {
    blockers.push('missing exact Delta position read-model binding');
  }
  if (requireWholeContractQuantity && !isWholeContractQuantity(item.expectedProtectionQuantity)) {
    blockers.push('expected Delta protection size is not a whole contract quantity');
  }
  if (item.expectedProtectionQuantityUnit !== 'contracts') {
    blockers.push('expected Delta protection size is not confirmed as contract-based');
  }
  if (
    readString(item.expectedProtectionQuantitySource).includes(' / ') &&
    !positiveNumber(item.expectedProtectionQuantityContractValue)
  ) {
    blockers.push('Delta base-to-contract quantity conversion is missing contract_value evidence');
  }
  if (requiredPriceLegs.includes('stop_loss') && !positiveNumber(item.plannedStopLossPrice)) {
    blockers.push('missing planned stop-loss price');
  }
  if (requiredPriceLegs.includes('take_profit') && !positiveNumber(item.plannedTakeProfitPrice)) {
    blockers.push('missing planned take-profit price');
  }
  return blockers;
}

function missingProtectionRepairKind(legs: ProtectionLeg[]): string {
  if (legs.includes('stop_loss') && legs.includes('take_profit')) {
    return 'attach_missing_stop_loss_and_take_profit';
  }
  if (legs.includes('stop_loss')) {
    return 'attach_missing_stop_loss';
  }
  if (legs.includes('take_profit')) {
    return 'attach_missing_take_profit';
  }
  return 'attach_missing_protection';
}

function buildPartialFillReplacementBlockers(item: DeltaGuardrailItem): string[] {
  const blockers = buildRepairBlockers(item);
  const entryOrderId = readString(item.entryOrderId);
  const stopLossOrderId = readString(item.stopLossOrderId);
  const takeProfitOrderId = readString(item.takeProfitOrderId);
  const sizeSource = readString(item.expectedProtectionQuantitySource);

  if (!sizeSource) {
    pushBlocker(blockers, 'missing expected Delta protection quantity source');
  }
  if (sizeSource.includes('execution.quantity')) {
    pushBlocker(
      blockers,
      'partial-fill replacement cannot use requested execution quantity as the protection size'
    );
  }
  if (item.sameSymbolOpenPositionCandidates !== 1) {
    pushBlocker(
      blockers,
      `partial-fill replacement requires exactly one same-symbol open position candidate; found ${item.sameSymbolOpenPositionCandidates}`
    );
  }
  if (!stopLossOrderId) {
    pushBlocker(blockers, 'missing linked stop-loss order id for partial-fill replacement');
  }
  if (!takeProfitOrderId) {
    pushBlocker(blockers, 'missing linked take-profit order id for partial-fill replacement');
  }
  if (entryOrderId && stopLossOrderId === entryOrderId) {
    pushBlocker(blockers, 'linked stop-loss order id matches the entry order id');
  }
  if (entryOrderId && takeProfitOrderId === entryOrderId) {
    pushBlocker(blockers, 'linked take-profit order id matches the entry order id');
  }
  if (stopLossOrderId && !positiveNumber(item.stopLossOrderQuantity)) {
    pushBlocker(blockers, 'linked stop-loss order quantity was not resolved');
  }
  if (takeProfitOrderId && !positiveNumber(item.takeProfitOrderQuantity)) {
    pushBlocker(blockers, 'linked take-profit order quantity was not resolved');
  }

  return blockers;
}

export function buildDeltaProtectionRepairPreview(
  item: DeltaGuardrailItem
): DeltaProtectionRepairPreview {
  const unsafeBinding =
    hasIssue(item, 'unsafe_position_mismatch') || hasIssue(item, 'missing_position_read_model');
  const bracketProtection = isNativeBracket(item);
  const missingLegs = missingProtectionLegs(item);
  const commonMutation = {
    brokerKey: 'delta_exchange',
    accountId: item.accountId,
    symbol: item.symbol,
    side: item.side,
    positionId: item.positionReadModelExternalId,
    entryOrderId: item.entryOrderId,
    size: item.expectedProtectionQuantity,
    sizeSource: item.expectedProtectionQuantitySource,
    sizeUnit: item.expectedProtectionQuantityUnit,
    sizeContractValue: item.expectedProtectionQuantityContractValue,
    sizeNotes: item.expectedProtectionQuantityNotes,
    positionStatus: item.positionReadModelStatus,
    positionQuantity: item.positionReadModelQuantity,
    sameSymbolOpenPositionCandidates: item.sameSymbolOpenPositionCandidates,
    stopLossPrice: item.plannedStopLossPrice,
    takeProfitPrice: item.plannedTakeProfitPrice,
  };

  if (hasIssue(item, 'stale_protection_for_closed_position')) {
    const orderIds = [item.stopLossOrderId, item.takeProfitOrderId].filter(Boolean);
    return {
      action: 'would_cancel_stale_protection_orders',
      readiness: orderIds.length ? 'ready' : 'blocked',
      repairable: orderIds.length > 0,
      mutation: 'none_preview_only',
      blockers: orderIds.length ? [] : ['no linked active protection order ids were found'],
      notes: [
        'Closed/terminal Delta execution still has active linked protection snapshots.',
        'Future apply mode should cancel only these linked reduce-only protection orders after fresh read-back.',
      ],
      expectedMutation: {
        ...commonMutation,
        cancelOrderIds: orderIds,
      },
    };
  }

  if (unsafeBinding) {
    return {
      action: 'manual_review_required',
      readiness: 'manual_review',
      repairable: false,
      mutation: 'none_preview_only',
      blockers: item.reasons,
      notes: [
        'Delta repair is blocked until the execution is bound to the exact broker position.',
        'This avoids protecting a newer same-symbol position owned by another execution.',
      ],
      expectedMutation: commonMutation,
    };
  }

  if (bracketProtection) {
    const requiredPriceLegs =
      missingLegs.length > 0 ? missingLegs : (['stop_loss', 'take_profit'] as ProtectionLeg[]);
    const blockers = buildRepairBlockers(item, {
      requiredPriceLegs,
      requireWholeContractQuantity: false,
    });
    return {
      action: 'would_reconcile_native_bracket_protection',
      readiness: blockers.length ? 'blocked' : 'ready',
      repairable: blockers.length === 0,
      mutation: 'none_preview_only',
      blockers,
      notes: [
        'Execution is marked for Delta native bracket protection.',
        'Future apply mode must use the native bracket path and fresh broker read-back, not detached duplicate SL/TP orders.',
      ],
      expectedMutation: {
        ...commonMutation,
        repairKind: 'reconcile_native_bracket_protection',
        protectionPath: 'native_bracket',
        protectionMode: item.protectionMode,
        bracketStatus: item.bracketStatus,
        missingLegs,
        attachDetachedOrders: false,
        existingStopLossOrderId: item.stopLossOrderId,
        existingTakeProfitOrderId: item.takeProfitOrderId,
        createStopLoss: false,
        createTakeProfit: false,
        requiresFreshPositionReadback: true,
        requiresFreshProtectionOrderReadback: true,
        requiresNativeBracketReadback: true,
      },
    };
  }

  if (hasIssue(item, 'partial_fill_protection_mismatch')) {
    const blockers = buildPartialFillReplacementBlockers(item);
    const existingOrderIds = linkedProtectionOrderIds(item);
    return {
      action: 'would_replace_mismatched_partial_fill_protection',
      readiness: blockers.length ? 'blocked' : 'ready',
      repairable: blockers.length === 0,
      mutation: 'none_preview_only',
      blockers,
      notes: [
        'Delta partial-fill/open-size protection quantity differs from the expected contract size.',
        'Future apply mode should cancel the mismatched reduce-only pair after fresh read-back, then recreate protection for the resolved position size.',
        'The preview is blocked unless the expected size comes from filled/open position evidence and both linked protection order ids are known.',
      ],
      expectedMutation: {
        ...commonMutation,
        repairKind: 'partial_fill_quantity_replacement',
        replaceOrderIds: existingOrderIds,
        currentStopLossOrderId: item.stopLossOrderId,
        currentStopLossQuantity: item.stopLossOrderQuantity,
        currentTakeProfitOrderId: item.takeProfitOrderId,
        currentTakeProfitQuantity: item.takeProfitOrderQuantity,
        requestedExecutionQuantity: item.quantity,
        filledExecutionQuantity: item.filledQuantity,
        remainingExecutionQuantity: item.remainingQuantity,
        expectedProtectionQuantity: item.expectedProtectionQuantity,
        expectedProtectionQuantitySource: item.expectedProtectionQuantitySource,
        expectedProtectionQuantityUnit: item.expectedProtectionQuantityUnit,
        expectedProtectionQuantityContractValue: item.expectedProtectionQuantityContractValue,
        expectedProtectionQuantityNotes: item.expectedProtectionQuantityNotes,
        replacementReason: 'partial_fill_protection_mismatch',
        requiresFreshPositionReadback: true,
        requiresFreshProtectionOrderReadback: true,
      },
    };
  }

  if (hasIssue(item, 'missing_active_stop_loss') || hasIssue(item, 'missing_active_take_profit')) {
    const blockers = buildRepairBlockers(item, { requiredPriceLegs: missingLegs });
    return {
      action: 'would_attach_missing_protection',
      readiness: blockers.length ? 'blocked' : 'ready',
      repairable: blockers.length === 0,
      mutation: 'none_preview_only',
      blockers,
      notes: [
        'Open Delta position is missing active SL and/or TP protection.',
        'Future apply mode should create protection only after a fresh open-position and active-order read-back.',
        'The preview creates only the missing detached protection legs and must re-check existing linked orders first.',
      ],
      expectedMutation: {
        ...commonMutation,
        repairKind: missingProtectionRepairKind(missingLegs),
        protectionPath: 'detached_reduce_only_orders',
        missingLegs,
        attachDetachedOrders: true,
        existingStopLossOrderId: item.stopLossOrderId,
        existingTakeProfitOrderId: item.takeProfitOrderId,
        createStopLoss: missingLegs.includes('stop_loss'),
        createTakeProfit: missingLegs.includes('take_profit'),
        requiresFreshPositionReadback: true,
        requiresFreshProtectionOrderReadback: true,
        requiresDuplicateProtectionCheck: true,
      },
    };
  }

  return {
    action: 'manual_review_required',
    readiness: 'manual_review',
    repairable: false,
    mutation: 'none_preview_only',
    blockers: item.reasons.length
      ? item.reasons
      : ['unclassified Delta protection guardrail issue'],
    notes: ['No automatic Delta repair preview is available for this issue mix yet.'],
    expectedMutation: commonMutation,
  };
}

function countByAction(
  items: DeltaProtectionRepairPreviewItem[]
): Record<DeltaProtectionRepairAction, number> {
  return {
    would_attach_missing_protection: items.filter(
      (item) => item.remediation.action === 'would_attach_missing_protection'
    ).length,
    would_cancel_stale_protection_orders: items.filter(
      (item) => item.remediation.action === 'would_cancel_stale_protection_orders'
    ).length,
    would_replace_mismatched_partial_fill_protection: items.filter(
      (item) => item.remediation.action === 'would_replace_mismatched_partial_fill_protection'
    ).length,
    would_reconcile_native_bracket_protection: items.filter(
      (item) => item.remediation.action === 'would_reconcile_native_bracket_protection'
    ).length,
    manual_review_required: items.filter(
      (item) => item.remediation.action === 'manual_review_required'
    ).length,
  };
}

export function buildDeltaProtectionRepairPreviewReport(
  guardrailReport: DeltaProtectionGuardrailReport
): DeltaProtectionRepairPreviewReport {
  const items = guardrailReport.items.map((item) => ({
    ...item,
    remediation: buildDeltaProtectionRepairPreview(item),
  }));
  return {
    ...guardrailReport,
    mode: 'preview',
    dryRun: true,
    repairableItems: items.filter((item) => item.remediation.repairable).length,
    blockedItems: items.filter((item) => item.remediation.readiness === 'blocked').length,
    manualReviewItems: items.filter((item) => item.remediation.readiness === 'manual_review')
      .length,
    byAction: countByAction(items),
    items,
  };
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
    await persistReport(previewReport);
    console.log('suggested-trades-delta-protection-repair-preview:', JSON.stringify(previewReport));
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
