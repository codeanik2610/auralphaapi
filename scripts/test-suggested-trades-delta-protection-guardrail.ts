import assert from 'node:assert/strict';
import {
  type DeltaGuardrailItem,
  hasDeltaProtectionQuantityMismatchForTest,
  resolveExpectedDeltaProtectionQuantity,
} from './checks/check-suggested-trades-delta-protection-guardrail';
import { buildDeltaProtectionRepairPreview } from './checks/check-suggested-trades-delta-protection-repair-preview';
import {
  isDeltaProtectionRepairApplyActionSupported,
  selectDeltaProtectionRepairApplyCandidates,
} from './maintenance/repair-suggested-trades-delta-protection';

function buildGuardrailItem(overrides: Partial<DeltaGuardrailItem>): DeltaGuardrailItem {
  return {
    suggestedTradeId: 'st-delta-preview-1',
    userId: 'user-1',
    accountId: 'delta-acc-1',
    symbol: 'BTCUSDT',
    timeframe: '5m',
    side: 'BUY',
    entryOrderId: 'delta-entry-1',
    orderStatus: 'FILLED',
    executionState: 'filled',
    positionId: 'delta-position-1',
    positionStatus: 'OPEN',
    protectionState: 'failed',
    quantity: 3,
    filledQuantity: 3,
    remainingQuantity: 0,
    entryPrice: 100,
    filledPrice: 101,
    plannedStopLossPrice: 95,
    plannedTakeProfitPrice: 110,
    protectionMode: null,
    bracketStatus: null,
    positionReadModelExternalId: 'delta-position-1',
    positionReadModelStatus: 'OPEN',
    positionReadModelSymbol: 'BTCUSD',
    positionReadModelSide: 'LONG',
    positionReadModelQuantity: 3,
    stopLossOrderId: null,
    stopLossOrderStatus: null,
    stopLossOrderQuantity: null,
    takeProfitOrderId: null,
    takeProfitOrderStatus: null,
    takeProfitOrderQuantity: null,
    expectedProtectionQuantity: 3,
    expectedProtectionQuantitySource: 'position.payload.quantity_contracts',
    expectedProtectionQuantityUnit: 'contracts',
    expectedProtectionQuantityContractValue: 0.001,
    expectedProtectionQuantityNotes: [],
    sameSymbolOpenPositionCandidates: 1,
    issues: ['missing_active_stop_loss', 'missing_active_take_profit'],
    reasons: ['missing protection'],
    ...overrides,
  };
}

function testDeltaContractsArePreferredOverBaseQuantity(): void {
  const expected = resolveExpectedDeltaProtectionQuantity({
    row: {
      filledQuantity: 12,
      quantity: 0.12134947,
    },
    position: {
      quantity: 0.12,
      payload: {
        quantity: '0.12',
        base_quantity: '0.12',
        quantity_contracts: '12',
        contract_value: '0.01',
      },
    },
  });

  assert.equal(expected.value, 12);
  assert.equal(expected.source, 'position.payload.quantity_contracts');
  assert.equal(expected.unit, 'contracts');
  assert.equal(
    hasDeltaProtectionQuantityMismatchForTest({
      expected,
      stopLossQuantity: 12,
      takeProfitQuantity: 12,
    }),
    false
  );
}

function testDeltaBaseQuantityCanConvertToContracts(): void {
  const expected = resolveExpectedDeltaProtectionQuantity({
    row: {
      filledQuantity: null,
      quantity: 0.12,
    },
    position: {
      quantity: 0.12,
      payload: {
        base_quantity: '0.12',
        contract_value: '0.01',
      },
    },
  });

  assert.equal(expected.value, 12);
  assert.equal(expected.unit, 'contracts');
  assert.equal(expected.contractValue, 0.01);
  assert.equal(
    expected.notes.includes('converted base quantity to Delta contracts using contract_value'),
    true
  );
}

function testPartialFillProtectionMismatchStillFlags(): void {
  const expected = resolveExpectedDeltaProtectionQuantity({
    row: {
      filledQuantity: 4,
      quantity: 10,
    },
    position: {
      quantity: 0.04,
      payload: {
        quantity_contracts: '4',
        contract_value: '0.01',
      },
    },
  });

  assert.equal(
    hasDeltaProtectionQuantityMismatchForTest({
      expected,
      stopLossQuantity: 10,
      takeProfitQuantity: 10,
    }),
    true
  );
}

function testUnknownDeltaQuantitySourceDoesNotFalseFlag(): void {
  const expected = resolveExpectedDeltaProtectionQuantity({
    row: {
      filledQuantity: null,
      quantity: null,
    },
    position: {
      quantity: 0.12,
      payload: {},
    },
  });

  assert.equal(expected.unit, 'unknown');
  assert.equal(
    hasDeltaProtectionQuantityMismatchForTest({
      expected,
      stopLossQuantity: 12,
      takeProfitQuantity: 12,
    }),
    false
  );
}

function testDeltaRepairPreviewCanAttachMissingProtection(): void {
  const preview = buildDeltaProtectionRepairPreview(buildGuardrailItem({}));

  assert.equal(preview.action, 'would_attach_missing_protection');
  assert.equal(preview.readiness, 'ready');
  assert.equal(preview.repairable, true);
  assert.equal(preview.mutation, 'none_preview_only');
  assert.equal(preview.expectedMutation.size, 3);
}

function testDeltaRepairPreviewBlocksUnsafeBinding(): void {
  const preview = buildDeltaProtectionRepairPreview(
    buildGuardrailItem({
      positionReadModelExternalId: null,
      issues: ['missing_position_read_model', 'unsafe_position_mismatch'],
      reasons: ['Delta execution cannot bind exact position.'],
    })
  );

  assert.equal(preview.action, 'manual_review_required');
  assert.equal(preview.readiness, 'manual_review');
  assert.equal(preview.repairable, false);
}

function testDeltaRepairPreviewUsesNativeBracketPath(): void {
  const preview = buildDeltaProtectionRepairPreview(
    buildGuardrailItem({
      protectionMode: 'native_bracket',
      bracketStatus: 'submitted',
    })
  );

  assert.equal(preview.action, 'would_reconcile_native_bracket_protection');
  assert.equal(preview.readiness, 'ready');
  assert.equal(preview.expectedMutation.protectionMode, 'native_bracket');
}

function testDeltaRepairPreviewPlansPartialFillReplacement(): void {
  const preview = buildDeltaProtectionRepairPreview(
    buildGuardrailItem({
      issues: ['partial_fill_protection_mismatch'],
      stopLossOrderId: 'old-sl',
      stopLossOrderStatus: 'OPEN',
      stopLossOrderQuantity: 10,
      takeProfitOrderId: 'old-tp',
      takeProfitOrderStatus: 'OPEN',
      takeProfitOrderQuantity: 10,
      expectedProtectionQuantity: 4,
    })
  );

  assert.equal(preview.action, 'would_replace_mismatched_partial_fill_protection');
  assert.equal(preview.readiness, 'ready');
  assert.deepEqual(preview.expectedMutation.replaceOrderIds, ['old-sl', 'old-tp']);
  assert.equal(preview.expectedMutation.repairKind, 'partial_fill_quantity_replacement');
  assert.equal(preview.expectedMutation.currentStopLossOrderId, 'old-sl');
  assert.equal(preview.expectedMutation.currentStopLossQuantity, 10);
  assert.equal(preview.expectedMutation.currentTakeProfitOrderId, 'old-tp');
  assert.equal(preview.expectedMutation.currentTakeProfitQuantity, 10);
  assert.equal(preview.expectedMutation.requestedExecutionQuantity, 3);
  assert.equal(preview.expectedMutation.filledExecutionQuantity, 3);
  assert.equal(preview.expectedMutation.expectedProtectionQuantity, 4);
  assert.equal(
    preview.expectedMutation.expectedProtectionQuantitySource,
    'position.payload.quantity_contracts'
  );
  assert.equal(preview.expectedMutation.expectedProtectionQuantityUnit, 'contracts');
  assert.equal(preview.expectedMutation.requiresFreshPositionReadback, true);
  assert.equal(preview.expectedMutation.requiresFreshProtectionOrderReadback, true);
}

function testDeltaRepairPreviewBlocksPartialFillWithoutBothProtectionOrderIds(): void {
  const preview = buildDeltaProtectionRepairPreview(
    buildGuardrailItem({
      issues: ['partial_fill_protection_mismatch'],
      stopLossOrderId: 'old-sl',
      stopLossOrderStatus: 'OPEN',
      stopLossOrderQuantity: 10,
      takeProfitOrderId: null,
      takeProfitOrderStatus: null,
      takeProfitOrderQuantity: null,
      expectedProtectionQuantity: 4,
    })
  );

  assert.equal(preview.action, 'would_replace_mismatched_partial_fill_protection');
  assert.equal(preview.readiness, 'blocked');
  assert.equal(preview.repairable, false);
  assert.equal(
    preview.blockers.includes('missing linked take-profit order id for partial-fill replacement'),
    true
  );
}

function testDeltaRepairPreviewBlocksPartialFillAmbiguousPositionMapping(): void {
  const preview = buildDeltaProtectionRepairPreview(
    buildGuardrailItem({
      issues: ['partial_fill_protection_mismatch'],
      stopLossOrderId: 'old-sl',
      stopLossOrderStatus: 'OPEN',
      stopLossOrderQuantity: 10,
      takeProfitOrderId: 'old-tp',
      takeProfitOrderStatus: 'OPEN',
      takeProfitOrderQuantity: 10,
      expectedProtectionQuantity: 4,
      sameSymbolOpenPositionCandidates: 2,
    })
  );

  assert.equal(preview.action, 'would_replace_mismatched_partial_fill_protection');
  assert.equal(preview.readiness, 'blocked');
  assert.equal(
    preview.blockers.includes(
      'partial-fill replacement requires exactly one same-symbol open position candidate; found 2'
    ),
    true
  );
}

function testDeltaRepairPreviewBlocksPartialFillRequestedQuantitySource(): void {
  const preview = buildDeltaProtectionRepairPreview(
    buildGuardrailItem({
      issues: ['partial_fill_protection_mismatch'],
      stopLossOrderId: 'old-sl',
      stopLossOrderStatus: 'OPEN',
      stopLossOrderQuantity: 10,
      takeProfitOrderId: 'old-tp',
      takeProfitOrderStatus: 'OPEN',
      takeProfitOrderQuantity: 10,
      expectedProtectionQuantity: 4,
      expectedProtectionQuantitySource: 'execution.quantity / position.payload.contract_value',
      expectedProtectionQuantityUnit: 'contracts',
      expectedProtectionQuantityContractValue: 0.001,
    })
  );

  assert.equal(preview.action, 'would_replace_mismatched_partial_fill_protection');
  assert.equal(preview.readiness, 'blocked');
  assert.equal(
    preview.blockers.includes(
      'partial-fill replacement cannot use requested execution quantity as the protection size'
    ),
    true
  );
}

function testDeltaRepairPreviewBlocksPartialFillWithoutContractValueEvidence(): void {
  const preview = buildDeltaProtectionRepairPreview(
    buildGuardrailItem({
      issues: ['partial_fill_protection_mismatch'],
      stopLossOrderId: 'old-sl',
      stopLossOrderStatus: 'OPEN',
      stopLossOrderQuantity: 10,
      takeProfitOrderId: 'old-tp',
      takeProfitOrderStatus: 'OPEN',
      takeProfitOrderQuantity: 10,
      expectedProtectionQuantity: 4,
      expectedProtectionQuantitySource: 'position.quantity / position.payload.contract_value',
      expectedProtectionQuantityUnit: 'contracts',
      expectedProtectionQuantityContractValue: null,
    })
  );

  assert.equal(preview.action, 'would_replace_mismatched_partial_fill_protection');
  assert.equal(preview.readiness, 'blocked');
  assert.equal(
    preview.blockers.includes(
      'Delta base-to-contract quantity conversion is missing contract_value evidence'
    ),
    true
  );
}

function testDeltaRepairApplySelectionIsSafeByDefault(): void {
  const missingProtectionItem = {
    ...buildGuardrailItem({ suggestedTradeId: 'repair-ready-1' }),
    remediation: buildDeltaProtectionRepairPreview(buildGuardrailItem({})),
  };
  const staleProtectionItem = {
    ...buildGuardrailItem({
      suggestedTradeId: 'stale-unsupported-1',
      issues: ['stale_protection_for_closed_position'],
      stopLossOrderId: 'old-sl',
      takeProfitOrderId: 'old-tp',
    }),
    remediation: buildDeltaProtectionRepairPreview(
      buildGuardrailItem({
        issues: ['stale_protection_for_closed_position'],
        stopLossOrderId: 'old-sl',
        takeProfitOrderId: 'old-tp',
      })
    ),
  };

  assert.equal(
    isDeltaProtectionRepairApplyActionSupported('would_attach_missing_protection'),
    true
  );
  assert.equal(
    isDeltaProtectionRepairApplyActionSupported('would_cancel_stale_protection_orders'),
    false
  );
  assert.equal(
    isDeltaProtectionRepairApplyActionSupported('would_cancel_stale_protection_orders', {
      includeStaleCancel: true,
    }),
    true
  );
  assert.deepEqual(
    selectDeltaProtectionRepairApplyCandidates([staleProtectionItem, missingProtectionItem]).map(
      (item) => item.suggestedTradeId
    ),
    ['repair-ready-1']
  );
  assert.deepEqual(
    selectDeltaProtectionRepairApplyCandidates([staleProtectionItem, missingProtectionItem], 5, {
      includeStaleCancel: true,
    }).map((item) => item.suggestedTradeId),
    ['stale-unsupported-1', 'repair-ready-1']
  );
}

testDeltaContractsArePreferredOverBaseQuantity();
testDeltaBaseQuantityCanConvertToContracts();
testPartialFillProtectionMismatchStillFlags();
testUnknownDeltaQuantitySourceDoesNotFalseFlag();
testDeltaRepairPreviewCanAttachMissingProtection();
testDeltaRepairPreviewBlocksUnsafeBinding();
testDeltaRepairPreviewUsesNativeBracketPath();
testDeltaRepairPreviewPlansPartialFillReplacement();
testDeltaRepairPreviewBlocksPartialFillWithoutBothProtectionOrderIds();
testDeltaRepairPreviewBlocksPartialFillAmbiguousPositionMapping();
testDeltaRepairPreviewBlocksPartialFillRequestedQuantitySource();
testDeltaRepairPreviewBlocksPartialFillWithoutContractValueEvidence();
testDeltaRepairApplySelectionIsSafeByDefault();

console.log('Suggested trades Delta protection guardrail tests passed.');
