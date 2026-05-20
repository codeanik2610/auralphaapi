import assert from 'node:assert/strict';
import {
  type MudrexProtectionHealthItem,
  hasMudrexProtectionQuantityMismatchForTest,
  resolveExpectedMudrexProtectionQuantity,
} from './checks/check-suggested-trades-mudrex-protection-health';
import { buildMudrexProtectionRepairPreview } from './checks/check-suggested-trades-mudrex-protection-repair-preview';
import {
  isMudrexProtectionRepairApplyActionSupported,
  selectMudrexProtectionRepairApplyCandidates,
} from './maintenance/repair-suggested-trades-mudrex-protection';

function buildHealthItem(
  overrides: Partial<MudrexProtectionHealthItem>
): MudrexProtectionHealthItem {
  return {
    suggestedTradeId: 'st-mudrex-preview-1',
    userId: 'user-1',
    accountId: 'mudrex-acc-1',
    symbol: 'BTCUSDT',
    timeframe: '5m',
    side: 'BUY',
    entryOrderId: 'mudrex-entry-1',
    orderStatus: 'FILLED',
    executionState: 'filled',
    positionId: 'mudrex-position-1',
    positionStatus: 'OPEN',
    protectionState: 'failed',
    quantity: 3,
    filledQuantity: 3,
    remainingQuantity: 0,
    entryPrice: 100,
    filledPrice: 101,
    plannedStopLossPrice: 95,
    plannedTakeProfitPrice: 110,
    positionResolution: 'exact_read_model',
    positionReadModelExternalId: 'mudrex-position-1',
    positionReadModelStatus: 'OPEN',
    positionReadModelSymbol: 'BTCUSDT',
    positionReadModelSide: 'LONG',
    positionReadModelQuantity: 3,
    stopLossOrderId: null,
    stopLossOrderStatus: null,
    stopLossOrderQuantity: null,
    takeProfitOrderId: null,
    takeProfitOrderStatus: null,
    takeProfitOrderQuantity: null,
    expectedProtectionQuantity: 3,
    expectedProtectionQuantitySource: 'position.quantity',
    expectedProtectionQuantityUnit: 'base',
    expectedProtectionQuantityNotes: [],
    sameSymbolOpenPositionCandidates: 1,
    issues: ['missing_active_stop_loss', 'missing_active_take_profit'],
    reasons: ['missing protection'],
    ...overrides,
  };
}

function testMudrexBaseQuantityIsUsedDirectly(): void {
  const expected = resolveExpectedMudrexProtectionQuantity({
    row: {
      filledQuantity: 2,
      quantity: 5,
    },
    position: {
      quantity: 2,
      payload: {
        quantity: '2',
      },
    },
  });

  assert.equal(expected.value, 2);
  assert.equal(expected.source, 'position.quantity');
  assert.equal(expected.unit, 'base');
  assert.equal(
    hasMudrexProtectionQuantityMismatchForTest({
      expected,
      stopLossQuantity: 2,
      takeProfitQuantity: 2,
    }),
    false
  );
}

function testMudrexPartialFillProtectionMismatchStillFlags(): void {
  const expected = resolveExpectedMudrexProtectionQuantity({
    row: {
      filledQuantity: 4,
      quantity: 10,
    },
    position: {
      quantity: 4,
      payload: {},
    },
  });

  assert.equal(
    hasMudrexProtectionQuantityMismatchForTest({
      expected,
      stopLossQuantity: 10,
      takeProfitQuantity: 10,
    }),
    true
  );
}

function testMudrexRepairPreviewCanAttachMissingProtection(): void {
  const preview = buildMudrexProtectionRepairPreview(buildHealthItem({}));

  assert.equal(preview.action, 'would_attach_missing_protection');
  assert.equal(preview.readiness, 'ready');
  assert.equal(preview.repairable, true);
  assert.equal(preview.mutation, 'none_preview_only');
  assert.equal(preview.expectedMutation.size, 3);
}

function testMudrexRepairPreviewBlocksUnsafeBinding(): void {
  const preview = buildMudrexProtectionRepairPreview(
    buildHealthItem({
      positionResolution: 'unresolved',
      positionReadModelExternalId: null,
      issues: ['missing_position_read_model', 'unsafe_position_mismatch'],
      reasons: ['Mudrex execution cannot bind safe position.'],
    })
  );

  assert.equal(preview.action, 'manual_review_required');
  assert.equal(preview.readiness, 'manual_review');
  assert.equal(preview.repairable, false);
  assert.equal(preview.blockers.includes('Mudrex position identity is unresolved'), true);
}

function testMudrexRepairPreviewPlansPartialFillReplacement(): void {
  const preview = buildMudrexProtectionRepairPreview(
    buildHealthItem({
      issues: ['partial_fill_protection_mismatch'],
      stopLossOrderId: 'mudrex-old-sl',
      stopLossOrderStatus: 'OPEN',
      stopLossOrderQuantity: 10,
      takeProfitOrderId: 'mudrex-old-tp',
      takeProfitOrderStatus: 'OPEN',
      takeProfitOrderQuantity: 10,
      expectedProtectionQuantity: 4,
    })
  );

  assert.equal(preview.action, 'would_replace_mismatched_partial_fill_protection');
  assert.equal(preview.readiness, 'ready');
  assert.deepEqual(preview.expectedMutation.replaceOrderIds, ['mudrex-old-sl', 'mudrex-old-tp']);
}

function testMudrexRepairPreviewPlansStaleCancel(): void {
  const preview = buildMudrexProtectionRepairPreview(
    buildHealthItem({
      executionState: 'closed',
      positionStatus: 'CLOSED',
      issues: ['stale_protection_for_closed_position'],
      stopLossOrderId: 'mudrex-stale-sl',
      stopLossOrderStatus: 'OPEN',
      takeProfitOrderId: 'mudrex-stale-tp',
      takeProfitOrderStatus: 'OPEN',
    })
  );

  assert.equal(preview.action, 'would_cancel_stale_protection_orders');
  assert.equal(preview.readiness, 'ready');
  assert.deepEqual(preview.expectedMutation.cancelOrderIds, ['mudrex-stale-sl', 'mudrex-stale-tp']);
}

function testMudrexRepairPreviewCanMarkTerminalNotRequired(): void {
  const preview = buildMudrexProtectionRepairPreview(
    buildHealthItem({
      executionState: 'closed',
      positionStatus: 'CLOSED',
      issues: ['stale_protection_for_closed_position'],
      stopLossOrderId: null,
      takeProfitOrderId: null,
    })
  );

  assert.equal(preview.action, 'would_mark_terminal_protection_not_required');
  assert.equal(preview.readiness, 'ready');
  assert.equal(preview.expectedMutation.protectionState, 'not_required');
}

function testMudrexRepairApplyActionSupportKeepsStaleGateSeparate(): void {
  assert.equal(
    isMudrexProtectionRepairApplyActionSupported('would_attach_missing_protection'),
    true
  );
  assert.equal(
    isMudrexProtectionRepairApplyActionSupported(
      'would_replace_mismatched_partial_fill_protection'
    ),
    true
  );
  assert.equal(
    isMudrexProtectionRepairApplyActionSupported('would_mark_terminal_protection_not_required'),
    true
  );
  assert.equal(
    isMudrexProtectionRepairApplyActionSupported('would_cancel_stale_protection_orders'),
    false
  );
  assert.equal(
    isMudrexProtectionRepairApplyActionSupported('would_cancel_stale_protection_orders', {
      includeStaleCancel: true,
    }),
    true
  );
}

function testMudrexRepairApplyCandidateSelectionRespectsReadinessAndLimit(): void {
  const attachItem = buildHealthItem({});
  const staleItem = buildHealthItem({
    suggestedTradeId: 'st-mudrex-stale',
    executionState: 'closed',
    positionStatus: 'CLOSED',
    issues: ['stale_protection_for_closed_position'],
    stopLossOrderId: 'mudrex-stale-sl',
    stopLossOrderStatus: 'OPEN',
    takeProfitOrderId: 'mudrex-stale-tp',
    takeProfitOrderStatus: 'OPEN',
    sameSymbolOpenPositionCandidates: 0,
  });
  const blockedItem = buildHealthItem({
    suggestedTradeId: 'st-mudrex-blocked',
    positionResolution: 'unresolved',
    positionReadModelExternalId: null,
    issues: ['missing_position_read_model', 'unsafe_position_mismatch'],
  });
  const previewItems = [attachItem, staleItem, blockedItem].map((item) => ({
    ...item,
    remediation: buildMudrexProtectionRepairPreview(item),
  }));

  const defaultCandidates = selectMudrexProtectionRepairApplyCandidates(previewItems, 10);
  assert.deepEqual(
    defaultCandidates.map((item) => item.remediation.action),
    ['would_attach_missing_protection']
  );

  const staleCandidates = selectMudrexProtectionRepairApplyCandidates(previewItems, 10, {
    includeStaleCancel: true,
  });
  assert.deepEqual(
    staleCandidates.map((item) => item.remediation.action),
    ['would_attach_missing_protection', 'would_cancel_stale_protection_orders']
  );

  const limitedCandidates = selectMudrexProtectionRepairApplyCandidates(previewItems, 1, {
    includeStaleCancel: true,
  });
  assert.equal(limitedCandidates.length, 1);
}

testMudrexBaseQuantityIsUsedDirectly();
testMudrexPartialFillProtectionMismatchStillFlags();
testMudrexRepairPreviewCanAttachMissingProtection();
testMudrexRepairPreviewBlocksUnsafeBinding();
testMudrexRepairPreviewPlansPartialFillReplacement();
testMudrexRepairPreviewPlansStaleCancel();
testMudrexRepairPreviewCanMarkTerminalNotRequired();
testMudrexRepairApplyActionSupportKeepsStaleGateSeparate();
testMudrexRepairApplyCandidateSelectionRespectsReadinessAndLimit();

console.log('Suggested trades Mudrex protection health tests passed.');
