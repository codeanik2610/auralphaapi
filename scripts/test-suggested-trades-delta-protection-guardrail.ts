import assert from 'node:assert/strict';
import {
  type DeltaExecutionRow,
  type DeltaGuardrailItem,
  evaluateDeltaProtectionGuardrailExecutionForTest,
  hasDeltaProtectionQuantityMismatchForTest,
  resolveExpectedDeltaProtectionQuantity,
} from './checks/check-suggested-trades-delta-protection-guardrail';
import {
  buildDeltaProtectionRepairPreview,
  buildDeltaProtectionRepairPreviewReport,
} from './checks/check-suggested-trades-delta-protection-repair-preview';
import {
  isDeltaProtectionRepairApplyActionSupported,
  resolveDeltaProtectionRepairApplyOutcomeForTest,
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

function buildDeltaExecution(overrides: Partial<DeltaExecutionRow> = {}): DeltaExecutionRow {
  return {
    suggestedTradeId: 'st-delta-stale-1',
    userId: 'user-1',
    accountId: 'delta-acc-1',
    tradeSymbol: 'BCHUSDT',
    tradeBaseSymbol: 'BCH',
    tradeSide: 'SELL',
    timeframe: '15m',
    entryOrderId: null,
    orderStatus: 'FILLED',
    executionState: 'filled',
    positionId: '15001',
    positionStatus: 'OPEN',
    quantity: 0.12134947,
    filledQuantity: 12,
    remainingQuantity: 0,
    entryPrice: 368.44,
    filledPrice: 368.94,
    stopLossPrice: 371.549607142857,
    takeProfitPrice: 349.782357142857,
    protectionState: 'attached',
    protectionPlan: {},
    submittedAt: '2026-05-20T09:21:00.000Z',
    filledAt: '2026-05-20T09:21:19.000Z',
    positionOpenedAt: '2026-05-20T09:21:19.000Z',
    positionClosedAt: null,
    updatedAt: '2026-05-20T09:21:20.000Z',
    ...overrides,
  };
}

function testStaleMissingPositionReadModelIsObservationOnly(): void {
  const item = evaluateDeltaProtectionGuardrailExecutionForTest({
    row: buildDeltaExecution(),
    position: null,
    sameSymbolOpenPositions: [],
    orderByKey: new Map(),
    now: new Date('2026-05-21T11:45:47.000Z'),
  });

  assert.equal(item?.issues.length, 1);
  assert.equal(item?.issues[0], 'stale_missing_position_read_model');
  assert.equal(
    item?.reasons.some((reason) => reason.includes('older than 12h')),
    true
  );
}

function testRecentMissingPositionReadModelStillBlocks(): void {
  const item = evaluateDeltaProtectionGuardrailExecutionForTest({
    row: buildDeltaExecution({
      positionOpenedAt: '2026-05-21T11:30:00.000Z',
      filledAt: '2026-05-21T11:30:00.000Z',
      updatedAt: '2026-05-21T11:30:10.000Z',
    }),
    position: null,
    sameSymbolOpenPositions: [],
    orderByKey: new Map(),
    now: new Date('2026-05-21T11:45:47.000Z'),
  });

  assert.equal(item?.issues.includes('missing_position_read_model'), true);
  assert.equal(item?.issues.includes('unsafe_position_mismatch'), true);
  assert.equal(item?.issues.includes('stale_missing_position_read_model'), false);
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
  assert.equal(preview.expectedMutation.repairKind, 'attach_missing_stop_loss_and_take_profit');
  assert.equal(preview.expectedMutation.protectionPath, 'detached_reduce_only_orders');
  assert.deepEqual(preview.expectedMutation.missingLegs, ['stop_loss', 'take_profit']);
  assert.equal(preview.expectedMutation.createStopLoss, true);
  assert.equal(preview.expectedMutation.createTakeProfit, true);
  assert.equal(preview.expectedMutation.requiresFreshPositionReadback, true);
  assert.equal(preview.expectedMutation.requiresFreshProtectionOrderReadback, true);
  assert.equal(preview.expectedMutation.requiresDuplicateProtectionCheck, true);
}

function testDeltaRepairPreviewCanAttachOnlyMissingStopLoss(): void {
  const preview = buildDeltaProtectionRepairPreview(
    buildGuardrailItem({
      issues: ['missing_active_stop_loss'],
      plannedTakeProfitPrice: null,
      takeProfitOrderId: 'existing-tp',
      takeProfitOrderStatus: 'OPEN',
      takeProfitOrderQuantity: 3,
    })
  );

  assert.equal(preview.action, 'would_attach_missing_protection');
  assert.equal(preview.readiness, 'ready');
  assert.equal(preview.expectedMutation.repairKind, 'attach_missing_stop_loss');
  assert.deepEqual(preview.expectedMutation.missingLegs, ['stop_loss']);
  assert.equal(preview.expectedMutation.createStopLoss, true);
  assert.equal(preview.expectedMutation.createTakeProfit, false);
  assert.equal(preview.expectedMutation.existingTakeProfitOrderId, 'existing-tp');
}

function testDeltaRepairPreviewCanAttachOnlyMissingTakeProfit(): void {
  const preview = buildDeltaProtectionRepairPreview(
    buildGuardrailItem({
      issues: ['missing_active_take_profit'],
      plannedStopLossPrice: null,
      stopLossOrderId: 'existing-sl',
      stopLossOrderStatus: 'OPEN',
      stopLossOrderQuantity: 3,
    })
  );

  assert.equal(preview.action, 'would_attach_missing_protection');
  assert.equal(preview.readiness, 'ready');
  assert.equal(preview.expectedMutation.repairKind, 'attach_missing_take_profit');
  assert.deepEqual(preview.expectedMutation.missingLegs, ['take_profit']);
  assert.equal(preview.expectedMutation.createStopLoss, false);
  assert.equal(preview.expectedMutation.createTakeProfit, true);
  assert.equal(preview.expectedMutation.existingStopLossOrderId, 'existing-sl');
}

function testDeltaRepairPreviewBlocksMissingStopLossWithoutStopLossPrice(): void {
  const preview = buildDeltaProtectionRepairPreview(
    buildGuardrailItem({
      issues: ['missing_active_stop_loss'],
      plannedStopLossPrice: null,
      takeProfitOrderId: 'existing-tp',
      takeProfitOrderStatus: 'OPEN',
      takeProfitOrderQuantity: 3,
    })
  );

  assert.equal(preview.action, 'would_attach_missing_protection');
  assert.equal(preview.readiness, 'blocked');
  assert.equal(preview.blockers.includes('missing planned stop-loss price'), true);
  assert.equal(preview.blockers.includes('missing planned take-profit price'), false);
}

function testDeltaRepairPreviewBlocksMissingTakeProfitWithoutTakeProfitPrice(): void {
  const preview = buildDeltaProtectionRepairPreview(
    buildGuardrailItem({
      issues: ['missing_active_take_profit'],
      plannedTakeProfitPrice: null,
      stopLossOrderId: 'existing-sl',
      stopLossOrderStatus: 'OPEN',
      stopLossOrderQuantity: 3,
    })
  );

  assert.equal(preview.action, 'would_attach_missing_protection');
  assert.equal(preview.readiness, 'blocked');
  assert.equal(preview.blockers.includes('missing planned stop-loss price'), false);
  assert.equal(preview.blockers.includes('missing planned take-profit price'), true);
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
      issues: [],
      reasons: [],
      protectionMode: 'native_bracket',
      bracketStatus: 'submitted',
    })
  );

  assert.equal(preview.action, 'would_reconcile_native_bracket_protection');
  assert.equal(preview.readiness, 'ready');
  assert.equal(preview.expectedMutation.protectionMode, 'native_bracket');
  assert.equal(preview.expectedMutation.protectionPath, 'native_bracket');
  assert.equal(preview.expectedMutation.attachDetachedOrders, false);
  assert.equal(preview.expectedMutation.createStopLoss, false);
  assert.equal(preview.expectedMutation.createTakeProfit, false);
  assert.equal(preview.expectedMutation.requiresNativeBracketReadback, true);
}

function testDeltaRepairPreviewMakesMissingNativeBracketActionable(): void {
  const preview = buildDeltaProtectionRepairPreview(
    buildGuardrailItem({
      issues: ['missing_active_stop_loss'],
      protectionMode: 'native_bracket',
      bracketStatus: 'submitted',
      plannedTakeProfitPrice: null,
    })
  );

  assert.equal(preview.action, 'would_repair_or_close_missing_native_bracket_protection');
  assert.equal(preview.readiness, 'ready');
  assert.equal(preview.repairable, true);
  assert.equal(
    preview.expectedMutation.repairKind,
    'repair_or_close_missing_native_bracket_protection'
  );
  assert.deepEqual(preview.expectedMutation.missingLegs, ['stop_loss']);
  assert.equal(preview.expectedMutation.attachDetachedOrders, false);
  assert.equal(preview.expectedMutation.protectionPath, 'native_bracket');
  assert.equal(preview.expectedMutation.requiresUnsafeResidualCloseCheck, true);
  assert.equal(preview.blockers.includes('missing planned take-profit price'), false);
}

function testDeltaRepairPreviewReportCountsMissingNativeBracketAction(): void {
  const item = buildGuardrailItem({
    suggestedTradeId: 'native-missing-sl-1',
    issues: ['missing_active_stop_loss'],
    protectionMode: 'native_bracket',
    bracketStatus: 'submitted',
    plannedTakeProfitPrice: null,
  });
  const report = buildDeltaProtectionRepairPreviewReport({
    generatedAt: '2026-05-23T10:00:00.000Z',
    brokerKey: 'delta_exchange',
    lookbackDays: 7,
    limit: 1000,
    audited: 1,
    openPositions: 1,
    issueTrades: 1,
    missingPositionReadModel: 0,
    staleMissingPositionReadModel: 0,
    missingActiveStopLoss: 1,
    missingActiveTakeProfit: 0,
    staleProtectionForClosedPosition: 0,
    partialFillProtectionMismatch: 0,
    unsafePositionMismatch: 0,
    thresholds: {
      maxMissingPositionReadModel: 0,
      maxMissingActiveStopLoss: 0,
      maxMissingActiveTakeProfit: 0,
      maxStaleProtectionForClosedPosition: 0,
      maxPartialFillProtectionMismatch: 0,
      maxUnsafePositionMismatch: 0,
      staleMissingReadModelMinHours: 12,
    },
    byIssue: {
      missing_position_read_model: 0,
      stale_missing_position_read_model: 0,
      missing_active_stop_loss: 1,
      missing_active_take_profit: 0,
      stale_protection_for_closed_position: 0,
      partial_fill_protection_mismatch: 0,
      unsafe_position_mismatch: 0,
    },
    items: [item],
    staleItems: [],
  });

  assert.equal(report.repairableItems, 1);
  assert.equal(report.byAction.would_repair_or_close_missing_native_bracket_protection, 1);
  assert.equal(
    report.items[0]?.remediation.action,
    'would_repair_or_close_missing_native_bracket_protection'
  );
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
  const nativeBracketMissingItem = {
    ...buildGuardrailItem({
      suggestedTradeId: 'native-bracket-missing-1',
      issues: ['missing_active_stop_loss'],
      protectionMode: 'native_bracket',
      plannedTakeProfitPrice: null,
    }),
    remediation: buildDeltaProtectionRepairPreview(
      buildGuardrailItem({
        issues: ['missing_active_stop_loss'],
        protectionMode: 'native_bracket',
        plannedTakeProfitPrice: null,
      })
    ),
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
    isDeltaProtectionRepairApplyActionSupported(
      'would_repair_or_close_missing_native_bracket_protection'
    ),
    true
  );
  assert.equal(
    isDeltaProtectionRepairApplyActionSupported('would_cancel_stale_protection_orders', {
      includeStaleCancel: true,
    }),
    true
  );
  assert.deepEqual(
    selectDeltaProtectionRepairApplyCandidates([
      staleProtectionItem,
      nativeBracketMissingItem,
      missingProtectionItem,
    ]).map((item) => item.suggestedTradeId),
    ['native-bracket-missing-1', 'repair-ready-1']
  );
  assert.deepEqual(
    selectDeltaProtectionRepairApplyCandidates(
      [staleProtectionItem, nativeBracketMissingItem, missingProtectionItem],
      5,
      {
        includeStaleCancel: true,
      }
    ).map((item) => item.suggestedTradeId),
    ['stale-unsupported-1', 'native-bracket-missing-1', 'repair-ready-1']
  );
}

function testDeltaRepairApplyOutcomeExplainsDisappearedCandidate(): void {
  const outcome = resolveDeltaProtectionRepairApplyOutcomeForTest({
    applyEnabled: true,
    brokerRepairEnabled: true,
    candidateItems: 0,
    appliedItems: 0,
    noChangeItems: 0,
    blockedItems: 0,
    errorItems: 0,
  });

  assert.deepEqual(outcome, {
    applyOutcome: 'no_change_pre_apply_refresh',
    applyOutcomeReason:
      'pre-apply refresh found no repairable candidates; no broker mutation was attempted',
    candidateApplyAttempted: false,
    brokerMutationConfirmed: false,
  });
}

function testDeltaRepairApplyOutcomeConfirmsMutationOnlyWhenApplied(): void {
  assert.deepEqual(
    resolveDeltaProtectionRepairApplyOutcomeForTest({
      applyEnabled: true,
      brokerRepairEnabled: true,
      candidateItems: 1,
      appliedItems: 1,
      noChangeItems: 0,
      blockedItems: 0,
      errorItems: 0,
    }),
    {
      applyOutcome: 'applied',
      applyOutcomeReason: '1 candidate apply attempt(s) completed',
      candidateApplyAttempted: true,
      brokerMutationConfirmed: true,
    }
  );
  assert.deepEqual(
    resolveDeltaProtectionRepairApplyOutcomeForTest({
      applyEnabled: false,
      brokerRepairEnabled: false,
      candidateItems: 1,
      appliedItems: 0,
      noChangeItems: 0,
      blockedItems: 0,
      errorItems: 0,
    }),
    {
      applyOutcome: 'dry_run_preview',
      applyOutcomeReason: 'apply mode is disabled; no broker mutation was attempted',
      candidateApplyAttempted: false,
      brokerMutationConfirmed: false,
    }
  );
}

testStaleMissingPositionReadModelIsObservationOnly();
testRecentMissingPositionReadModelStillBlocks();
testDeltaContractsArePreferredOverBaseQuantity();
testDeltaBaseQuantityCanConvertToContracts();
testPartialFillProtectionMismatchStillFlags();
testUnknownDeltaQuantitySourceDoesNotFalseFlag();
testDeltaRepairPreviewCanAttachMissingProtection();
testDeltaRepairPreviewCanAttachOnlyMissingStopLoss();
testDeltaRepairPreviewCanAttachOnlyMissingTakeProfit();
testDeltaRepairPreviewBlocksMissingStopLossWithoutStopLossPrice();
testDeltaRepairPreviewBlocksMissingTakeProfitWithoutTakeProfitPrice();
testDeltaRepairPreviewBlocksUnsafeBinding();
testDeltaRepairPreviewUsesNativeBracketPath();
testDeltaRepairPreviewMakesMissingNativeBracketActionable();
testDeltaRepairPreviewReportCountsMissingNativeBracketAction();
testDeltaRepairPreviewPlansPartialFillReplacement();
testDeltaRepairPreviewBlocksPartialFillWithoutBothProtectionOrderIds();
testDeltaRepairPreviewBlocksPartialFillAmbiguousPositionMapping();
testDeltaRepairPreviewBlocksPartialFillRequestedQuantitySource();
testDeltaRepairPreviewBlocksPartialFillWithoutContractValueEvidence();
testDeltaRepairApplySelectionIsSafeByDefault();
testDeltaRepairApplyOutcomeExplainsDisappearedCandidate();
testDeltaRepairApplyOutcomeConfirmsMutationOnlyWhenApplied();

console.log('Suggested trades Delta protection guardrail tests passed.');
