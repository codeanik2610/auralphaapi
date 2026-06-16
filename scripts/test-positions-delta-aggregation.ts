import assert from 'node:assert/strict';

async function runDeltaSplitFillAggregationAssertions(): Promise<void> {
  const { DeltaExchangePositionsAdapter } =
    await import('../src/brokers/capabilities/positions/DeltaExchangePositionsAdapter');
  const { buildDeltaClosedPositionLifecycleId } =
    await import('../src/brokers/providers/delta_exchange/deltaPositionLifecycle');

  const adapter = new DeltaExchangePositionsAdapter() as any;
  adapter.deltaHttpClient = {
    async publicGet(path: string) {
      assert.equal(path, '/v2/products');
      return [
        {
          id: '40004',
          symbol: 'SAGAUSD',
          contract_value: '1',
          contract_unit_currency: 'SAGA',
        },
      ];
    },
    async signedGetEnvelope() {
      return {
        success: true,
        result: [
          {
            id: 'fill-close-main',
            order_id: 'order-close-1',
            product_id: '40004',
            product_symbol: 'SAGAUSD',
            side: 'buy',
            size: '1697',
            price: '0.02037',
            created_at: '2026-05-25T06:17:39.100Z',
          },
          {
            id: 'fill-close-dust-1',
            order_id: 'order-close-1',
            product_id: '40004',
            product_symbol: 'SAGAUSD',
            side: 'buy',
            size: '1',
            price: '0.02037',
            created_at: '2026-05-25T06:17:39.100Z',
          },
          {
            id: 'fill-close-dust-2',
            order_id: 'order-close-1',
            product_id: '40004',
            product_symbol: 'SAGAUSD',
            side: 'buy',
            size: '1',
            price: '0.02036',
            created_at: '2026-05-25T06:17:39.100Z',
          },
          {
            id: 'fill-close-dust-3',
            order_id: 'order-close-1',
            product_id: '40004',
            product_symbol: 'SAGAUSD',
            side: 'buy',
            size: '1',
            price: '0.02035',
            created_at: '2026-05-25T06:17:39.100Z',
          },
          {
            id: 'fill-open',
            order_id: 'order-open-1',
            product_id: '40004',
            product_symbol: 'SAGAUSD',
            side: 'sell',
            size: '1700',
            price: '0.02003',
            created_at: '2026-05-25T05:32:03.191Z',
          },
        ],
        meta: { after: null },
      };
    },
  };

  const history = await adapter.getPositionHistory(
    {
      startDate: '2026-05-25',
      endDate: '2026-05-25',
      limit: '20',
    },
    {
      userId: 'user-1',
      accountId: 'account-1',
      brokerKey: 'delta_exchange',
    }
  );

  assert.equal(Array.isArray(history), true);
  assert.equal(history.length, 1);
  const [position] = history as Array<Record<string, unknown>>;
  assert.equal(position.symbol, 'SAGAUSD');
  assert.equal(position.position_type, 'short');
  assert.equal(position.status, 'closed');
  assert.equal(position.close_state, 'CLOSED');
  assert.equal(position.quantity, '1700');
  assert.equal(position.quantity_contracts, '1700');
  assert.equal(position.base_quantity, '1700');
  assert.equal(position.split_fill_count, 4);
  assert.deepEqual(position.close_fill_ids, [
    'fill-close-main',
    'fill-close-dust-1',
    'fill-close-dust-2',
    'fill-close-dust-3',
  ]);
  assert.deepEqual(position.close_order_ids, ['order-close-1']);
  assert.equal(position.closed_price, '0.02037');
  assert.equal(position.weighted_closed_price, '0.020369982353');
  assert.equal(Math.abs(Number(position.realized) - -0.57797) < 1e-12, true);
  assert.equal(Math.abs(Number(position.pnl) - -0.57797) < 1e-12, true);
  assert.equal(
    position.id,
    buildDeltaClosedPositionLifecycleId({
      productId: '40004',
      side: 'short',
      status: 'closed',
      quantity: 1700,
      entryPrice: '0.02003',
      closePrice: '0.02037',
      closedAt: '2026-05-25T06:17:39.100Z',
    })
  );
}

async function run(): Promise<void> {
  await runDeltaSplitFillAggregationAssertions();
  console.log('Delta split-fill aggregation assertions passed.');
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
