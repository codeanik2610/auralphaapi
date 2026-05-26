import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { coreDataSource } from '../../src/database/data-source';
import { initializeCoreDataSource } from '../../src/database/initializeCoreDataSource';
import {
  buildMudrexProtectionGuardrailReport,
  type MudrexProtectionGuardrailItem,
  type MudrexProtectionGuardrailReport,
} from './check-suggested-trades-mudrex-protection-guardrail';

type JsonRecord = Record<string, unknown>;

export type MudrexProtectionRepairAction =
  | 'would_attach_missing_protection'
  | 'would_replace_mismatched_partial_fill_protection'
  | 'would_mark_terminal_protection_not_required'
  | 'would_cancel_stale_protection_orders'
  | 'manual_review_required';

export type MudrexProtectionRepairReadiness = 'ready' | 'blocked' | 'manual_review';

export type MudrexProtectionRepairPreview = {
  action: MudrexProtectionRepairAction;
  readiness: MudrexProtectionRepairReadiness;
  repairable: boolean;
  mutation: 'none_preview_only';
  blockers: string[];
  notes: string[];
  expectedMutation: JsonRecord;
};

export type MudrexProtectionRepairPreviewItem = MudrexProtectionGuardrailItem & {
  remediation: MudrexProtectionRepairPreview;
};

export type MudrexProtectionRepairPreviewReport = Omit<MudrexProtectionGuardrailReport, 'items'> & {
  mode: 'preview';
  dryRun: true;
  repairableItems: number;
  blockedItems: number;
  manualReviewItems: number;
  byAction: Record<MudrexProtectionRepairAction, number>;
  items: MudrexProtectionRepairPreviewItem[];
};

const OUTPUT_FILE = String(
  process.env.SUGGESTED_TRADES_MUDREX_PROTECTION_REPAIR_PREVIEW_OUTPUT_FILE ||
    'artifacts/suggested-trades-mudrex-protection-repair-preview.json'
).trim();

function hasIssue(
  item: MudrexProtectionGuardrailItem,
  issue: MudrexProtectionGuardrailItem['issues'][number]
): boolean {
  return item.issues.includes(issue);
}

function positiveNumber(value: number | null): boolean {
  return value !== null && Number.isFinite(value) && value > 0;
}

function isResolvedPositionIdentity(item: MudrexProtectionGuardrailItem): boolean {
  return Boolean(
    item.positionReadModelExternalId &&
    item.positionResolution !== 'unresolved' &&
    !hasIssue(item, 'missing_position_read_model') &&
    !hasIssue(item, 'unsafe_position_mismatch')
  );
}

function buildCommonMutation(item: MudrexProtectionGuardrailItem): JsonRecord {
  return {
    brokerKey: 'mudrex',
    accountId: item.accountId,
    symbol: item.symbol,
    side: item.side,
    positionId: item.positionReadModelExternalId,
    positionResolution: item.positionResolution,
    entryOrderId: item.entryOrderId,
    size: item.expectedProtectionQuantity,
    sizeSource: item.expectedProtectionQuantitySource,
    sizeUnit: item.expectedProtectionQuantityUnit,
    stopLossPrice: item.plannedStopLossPrice,
    takeProfitPrice: item.plannedTakeProfitPrice,
    stopLossOrderId: item.stopLossOrderId,
    takeProfitOrderId: item.takeProfitOrderId,
  };
}

function buildRepairBlockers(item: MudrexProtectionGuardrailItem): string[] {
  const blockers: string[] = [];
  if (!item.accountId) {
    blockers.push('missing Mudrex account id');
  }
  if (!isResolvedPositionIdentity(item)) {
    blockers.push('missing safe Mudrex position read-model binding');
  }
  if (!positiveNumber(item.expectedProtectionQuantity)) {
    blockers.push('missing expected Mudrex protection size');
  }
  if (item.expectedProtectionQuantityUnit !== 'base') {
    blockers.push('expected Mudrex protection size is not confirmed as base quantity');
  }
  if (!positiveNumber(item.plannedStopLossPrice)) {
    blockers.push('missing planned stop-loss price');
  }
  if (!positiveNumber(item.plannedTakeProfitPrice)) {
    blockers.push('missing planned take-profit price');
  }
  return blockers;
}

function buildIdentityBlockers(item: MudrexProtectionGuardrailItem): string[] {
  const blockers = item.reasons.length ? [...item.reasons] : [];
  if (!item.positionReadModelExternalId) {
    blockers.push('missing Mudrex position read-model external id');
  }
  if (item.positionResolution === 'unresolved') {
    blockers.push('Mudrex position identity is unresolved');
  }
  return blockers.length ? blockers : ['Mudrex position identity is not safe for repair'];
}

export function buildMudrexProtectionRepairPreview(
  item: MudrexProtectionGuardrailItem
): MudrexProtectionRepairPreview {
  const unsafeBinding =
    hasIssue(item, 'unsafe_position_mismatch') ||
    hasIssue(item, 'missing_position_read_model') ||
    item.positionResolution === 'unresolved';
  const commonMutation = buildCommonMutation(item);

  if (unsafeBinding) {
    return {
      action: 'manual_review_required',
      readiness: 'manual_review',
      repairable: false,
      mutation: 'none_preview_only',
      blockers: buildIdentityBlockers(item),
      notes: [
        'Mudrex repair is blocked until the execution is bound to one safe broker position.',
        'This avoids protecting or cancelling orders for a newer same-symbol position.',
      ],
      expectedMutation: commonMutation,
    };
  }

  if (hasIssue(item, 'stale_protection_for_closed_position')) {
    const orderIds = [item.stopLossOrderId, item.takeProfitOrderId].filter(Boolean);
    if (orderIds.length) {
      return {
        action: 'would_cancel_stale_protection_orders',
        readiness: 'ready',
        repairable: true,
        mutation: 'none_preview_only',
        blockers: [],
        notes: [
          'Closed/terminal Mudrex execution still has active linked protection snapshots.',
          'Future apply mode should cancel only these linked protection orders after fresh broker read-back.',
        ],
        expectedMutation: {
          ...commonMutation,
          cancelOrderIds: orderIds,
        },
      };
    }

    return {
      action: 'would_mark_terminal_protection_not_required',
      readiness: 'ready',
      repairable: true,
      mutation: 'none_preview_only',
      blockers: [],
      notes: [
        'Mudrex execution is terminal and has no active linked protection order ids to cancel.',
        'Future apply mode should mark local protection state as not_required after fresh read-back.',
      ],
      expectedMutation: {
        ...commonMutation,
        protectionState: 'not_required',
      },
    };
  }

  if (hasIssue(item, 'partial_fill_protection_mismatch')) {
    const blockers = buildRepairBlockers(item);
    const existingOrderIds = [item.stopLossOrderId, item.takeProfitOrderId].filter(Boolean);
    if (!existingOrderIds.length) {
      blockers.push('mismatched active Mudrex protection order ids were not resolved');
    }
    return {
      action: 'would_replace_mismatched_partial_fill_protection',
      readiness: blockers.length ? 'blocked' : 'ready',
      repairable: blockers.length === 0,
      mutation: 'none_preview_only',
      blockers,
      notes: [
        'Mudrex protection quantity differs from the resolved live position size.',
        'Future apply mode should cancel the mismatched protection pair after fresh read-back, then recreate protection for the resolved position size.',
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
        'Open Mudrex position is missing active SL and/or TP protection.',
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
      : ['unclassified Mudrex protection-guardrail issue'],
    notes: ['No automatic Mudrex repair preview is available for this issue mix yet.'],
    expectedMutation: commonMutation,
  };
}

function countByAction(
  items: MudrexProtectionRepairPreviewItem[]
): Record<MudrexProtectionRepairAction, number> {
  return {
    would_attach_missing_protection: items.filter(
      (item) => item.remediation.action === 'would_attach_missing_protection'
    ).length,
    would_replace_mismatched_partial_fill_protection: items.filter(
      (item) => item.remediation.action === 'would_replace_mismatched_partial_fill_protection'
    ).length,
    would_mark_terminal_protection_not_required: items.filter(
      (item) => item.remediation.action === 'would_mark_terminal_protection_not_required'
    ).length,
    would_cancel_stale_protection_orders: items.filter(
      (item) => item.remediation.action === 'would_cancel_stale_protection_orders'
    ).length,
    manual_review_required: items.filter(
      (item) => item.remediation.action === 'manual_review_required'
    ).length,
  };
}

export function buildMudrexProtectionRepairPreviewReport(
  healthReport: MudrexProtectionGuardrailReport
): MudrexProtectionRepairPreviewReport {
  const items = healthReport.items.map((item) => ({
    ...item,
    remediation: buildMudrexProtectionRepairPreview(item),
  }));
  return {
    ...healthReport,
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
    const healthReport = await buildMudrexProtectionGuardrailReport();
    const previewReport = buildMudrexProtectionRepairPreviewReport(healthReport);
    await persistReport(previewReport);
    console.log(
      'suggested-trades-mudrex-protection-repair-preview:',
      JSON.stringify(previewReport)
    );
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
