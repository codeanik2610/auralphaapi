import assert from 'node:assert/strict';
import {
  type DeltaPositionResolutionItem,
  evaluateDeltaPositionResolutionForTest,
  resolveDeltaPositionResolutionQuantityForTest,
  shouldAuditDeltaPositionResolutionExecutionForTest,
} from './checks/check-suggested-trades-delta-position-resolution';
import type { PositionReadModel } from './checks/check-suggested-trades-delta-protection-guardrail';

function buildExecution(overrides: Record<string, unknown> = {}) {
  return {
    suggestedTradeId: 'st-delta-resolution-1',
    userId: 'user-1',
    accountId: 'delta-acc-1',
    symbol: 'BTCUSDT',
    tradeBaseSymbol: 'BTC',
    side: 'BUY',
    expectedSide: 'LONG' as const,
    timeframe: '5m',
    entryOrderId: 'entry-order-1',
    orderStatus: 'FILLED',
    executionState: 'filled',
    positionId: 'delta-position-1',
    positionStatus: 'OPEN',
    quantity: 0.03,
    filledQuantity: 3,
    submittedAt: '2026-05-20T00:00:00.000Z',
    filledAt: '2026-05-20T00:00:05.000Z',
    positionOpenedAt: '2026-05-20T00:00:05.000Z',
    updatedAt: '2026-05-20T00:00:06.000Z',
    ...overrides,
  };
}

function buildPosition(overrides: Partial<PositionReadModel> = {}): PositionReadModel {
  return {
    userId: 'user-1',
    accountId: 'delta-acc-1',
    externalId: 'delta-position-1',
    symbol: 'BTCUSD',
    baseSymbol: 'BTC',
    side: 'LONG',
    status: 'OPEN',
    statusKey: 'OPEN',
    statusRank: 1,
    quantity: 0.03,
    stopLossPrice: null,
    takeProfitPrice: null,
    stopLossOrderId: null,
    takeProfitOrderId: null,
    lastSeenAt: '2026-05-20T00:00:10.000Z',
    payload: {
      quantity_contracts: '3',
      contract_value: '0.01',
    },
    ...overrides,
  };
}

function buildEntryOrder(overrides: Record<string, unknown> = {}) {
  return {
    userId: 'user-1',
    accountId: 'delta-acc-1',
    externalId: 'entry-order-1',
    symbol: 'BTCUSD',
    baseSymbol: 'BTC',
    status: 'FILLED',
    lastSeenAt: '2026-05-20T00:00:08.000Z',
    ...overrides,
  };
}

function evaluate(
  overrides: {
    execution?: Record<string, unknown>;
    exactPosition?: PositionReadModel | null;
    accountMismatchPositions?: PositionReadModel[];
    sameSymbolOpenPositions?: PositionReadModel[];
    entryOrder?: ReturnType<typeof buildEntryOrder> | null;
  } = {}
): DeltaPositionResolutionItem {
  const row = buildExecution(overrides.execution);
  const exactPosition =
    overrides.exactPosition === undefined ? buildPosition() : overrides.exactPosition;
  return evaluateDeltaPositionResolutionForTest({
    row,
    exactPosition,
    accountMismatchPositions: overrides.accountMismatchPositions ?? [],
    sameSymbolOpenPositions:
      overrides.sameSymbolOpenPositions ?? (exactPosition ? [exactPosition] : []),
    entryOrder: overrides.entryOrder === undefined ? buildEntryOrder() : overrides.entryOrder,
  });
}

function testExactReadModelBinding(): void {
  const item = evaluate();

  assert.equal(item.type, 'exact_read_model');
  assert.equal(item.mutation, 'none_read_only');
  assert.equal(item.exactPositionIdBound, true);
  assert.equal(item.accountIdMatches, true);
  assert.equal(item.symbolMatches, true);
  assert.equal(item.sideMatches, true);
  assert.equal(item.entryOrderLineage, 'entry_order_snapshot_match');
  assert.equal(item.expectedProtectionQuantity, 3);
  assert.equal(item.expectedProtectionQuantitySource, 'position.payload.quantity_contracts');
}

function testMissingPositionIdIsUnresolved(): void {
  const item = evaluate({
    execution: { positionId: null },
    exactPosition: null,
    sameSymbolOpenPositions: [],
  });

  assert.equal(item.type, 'missing_position_id');
  assert.equal(item.exactPositionIdBound, false);
  assert.equal(
    item.reasons.some((reason) => reason.includes('no position_id')),
    true
  );
}

function testMissingReadModelIsUnresolved(): void {
  const item = evaluate({
    exactPosition: null,
    sameSymbolOpenPositions: [buildPosition({ externalId: 'other-position-1' })],
  });

  assert.equal(item.type, 'missing_read_model');
  assert.equal(item.sameSymbolOpenPositionCandidates, 1);
}

function testAmbiguousSameSymbolIsSeparatedFromUnsafe(): void {
  const item = evaluate({
    exactPosition: null,
    sameSymbolOpenPositions: [
      buildPosition({ externalId: 'candidate-1' }),
      buildPosition({ externalId: 'candidate-2' }),
    ],
  });

  assert.equal(item.type, 'ambiguous_same_symbol');
  assert.equal(item.sameSymbolOpenPositionCandidates, 2);
}

function testAccountMismatchIsUnsafe(): void {
  const item = evaluate({
    exactPosition: null,
    accountMismatchPositions: [buildPosition({ accountId: 'other-account' })],
    sameSymbolOpenPositions: [],
  });

  assert.equal(item.type, 'account_mismatch');
  assert.equal(item.accountMismatchCandidates, 1);
}

function testSymbolMismatchIsUnsafe(): void {
  const item = evaluate({
    exactPosition: buildPosition({
      symbol: 'ETHUSD',
      baseSymbol: 'ETH',
    }),
  });

  assert.equal(item.type, 'symbol_mismatch');
  assert.equal(item.symbolMatches, false);
}

function testSideMismatchIsUnsafe(): void {
  const item = evaluate({
    exactPosition: buildPosition({ side: 'SHORT' }),
  });

  assert.equal(item.type, 'side_mismatch');
  assert.equal(item.sideMatches, false);
}

function testEntryOrderLineageMismatchIsReported(): void {
  const item = evaluate({
    entryOrder: buildEntryOrder({ accountId: 'other-account' }),
  });

  assert.equal(item.type, 'exact_read_model');
  assert.equal(item.entryOrderLineage, 'entry_order_snapshot_account_mismatch');
  assert.equal(
    item.reasons.includes('Entry order lineage is entry_order_snapshot_account_mismatch.'),
    true
  );
}

function testDeltaQuantitySourceUsesProtectionGuardrailNormalizer(): void {
  const quantity = resolveDeltaPositionResolutionQuantityForTest({
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

  assert.equal(quantity.value, 12);
  assert.equal(quantity.unit, 'contracts');
  assert.equal(quantity.contractValue, 0.01);
  assert.equal(
    quantity.notes.includes('converted base quantity to Delta contracts using contract_value'),
    true
  );
}

function testAuditEvidenceFilterSkipsEmptyExecutions(): void {
  assert.equal(
    shouldAuditDeltaPositionResolutionExecutionForTest({
      positionId: null,
      filledAt: null,
      positionOpenedAt: null,
      positionStatus: null,
      orderStatus: null,
      executionState: null,
      filledQuantity: null,
    }),
    false
  );
}

function testAuditEvidenceFilterKeepsFilledAndPositionRows(): void {
  assert.equal(
    shouldAuditDeltaPositionResolutionExecutionForTest({
      positionId: null,
      filledAt: null,
      positionOpenedAt: null,
      positionStatus: null,
      orderStatus: 'FILLED',
      executionState: null,
      filledQuantity: null,
    }),
    true
  );
  assert.equal(
    shouldAuditDeltaPositionResolutionExecutionForTest({
      positionId: 'position-1',
      filledAt: null,
      positionOpenedAt: null,
      positionStatus: null,
      orderStatus: null,
      executionState: null,
      filledQuantity: null,
    }),
    true
  );
}

testExactReadModelBinding();
testMissingPositionIdIsUnresolved();
testMissingReadModelIsUnresolved();
testAmbiguousSameSymbolIsSeparatedFromUnsafe();
testAccountMismatchIsUnsafe();
testSymbolMismatchIsUnsafe();
testSideMismatchIsUnsafe();
testEntryOrderLineageMismatchIsReported();
testDeltaQuantitySourceUsesProtectionGuardrailNormalizer();
testAuditEvidenceFilterSkipsEmptyExecutions();
testAuditEvidenceFilterKeepsFilledAndPositionRows();

console.log('Suggested trades Delta position resolution tests passed.');
