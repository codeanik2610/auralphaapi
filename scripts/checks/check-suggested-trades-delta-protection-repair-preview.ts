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

function buildRepairBlockers(item: DeltaGuardrailItem): string[] {
  const blockers: string[] = [];
  if (!item.accountId) {
    blockers.push('missing Delta account id');
  }
  if (!item.positionReadModelExternalId) {
    blockers.push('missing exact Delta position read-model binding');
  }
  if (!isWholeContractQuantity(item.expectedProtectionQuantity)) {
    blockers.push('expected Delta protection size is not a whole contract quantity');
  }
  if (item.expectedProtectionQuantityUnit !== 'contracts') {
    blockers.push('expected Delta protection size is not confirmed as contract-based');
  }
  if (!positiveNumber(item.plannedStopLossPrice)) {
    blockers.push('missing planned stop-loss price');
  }
  if (!positiveNumber(item.plannedTakeProfitPrice)) {
    blockers.push('missing planned take-profit price');
  }
  return blockers;
}

export function buildDeltaProtectionRepairPreview(
  item: DeltaGuardrailItem
): DeltaProtectionRepairPreview {
  const unsafeBinding =
    hasIssue(item, 'unsafe_position_mismatch') || hasIssue(item, 'missing_position_read_model');
  const bracketProtection = isNativeBracket(item);
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
    const blockers = buildRepairBlockers(item).filter(
      (blocker) => blocker !== 'expected Delta protection size is not a whole contract quantity'
    );
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
        protectionMode: item.protectionMode,
        bracketStatus: item.bracketStatus,
      },
    };
  }

  if (hasIssue(item, 'partial_fill_protection_mismatch')) {
    const blockers = buildRepairBlockers(item);
    const existingOrderIds = [item.stopLossOrderId, item.takeProfitOrderId].filter(Boolean);
    if (!existingOrderIds.length) {
      blockers.push('mismatched active protection order ids were not resolved');
    }
    return {
      action: 'would_replace_mismatched_partial_fill_protection',
      readiness: blockers.length ? 'blocked' : 'ready',
      repairable: blockers.length === 0,
      mutation: 'none_preview_only',
      blockers,
      notes: [
        'Delta partial-fill/open-size protection quantity differs from the expected contract size.',
        'Future apply mode should cancel the mismatched reduce-only pair after fresh read-back, then recreate protection for the resolved position size.',
      ],
      expectedMutation: {
        ...commonMutation,
        replaceOrderIds: existingOrderIds,
      },
    };
  }

  if (hasIssue(item, 'missing_active_stop_loss') || hasIssue(item, 'missing_active_take_profit')) {
    const blockers = buildRepairBlockers(item);
    return {
      action: 'would_attach_missing_protection',
      readiness: blockers.length ? 'blocked' : 'ready',
      repairable: blockers.length === 0,
      mutation: 'none_preview_only',
      blockers,
      notes: [
        'Open Delta position is missing active SL and/or TP protection.',
        'Future apply mode should create protection only after a fresh open-position and active-order read-back.',
      ],
      expectedMutation: commonMutation,
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
