import assert from 'node:assert/strict';
import {
  hasDeltaProtectionQuantityMismatchForTest,
  resolveExpectedDeltaProtectionQuantity,
} from './checks/check-suggested-trades-delta-protection-guardrail';

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

testDeltaContractsArePreferredOverBaseQuantity();
testDeltaBaseQuantityCanConvertToContracts();
testPartialFillProtectionMismatchStillFlags();
testUnknownDeltaQuantitySourceDoesNotFalseFlag();

console.log('Suggested trades Delta protection guardrail tests passed.');
