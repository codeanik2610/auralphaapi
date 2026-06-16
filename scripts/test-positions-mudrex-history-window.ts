import assert from 'node:assert/strict';

import { MudrexPositionHistoryItem } from '../src/api/contracts/Mudrex';

function createPositionHistoryItem(
  overrides: Partial<MudrexPositionHistoryItem> = {}
): MudrexPositionHistoryItem {
  return {
    id: 'position-1',
    position_type: 'LONG',
    status: 'CLOSED',
    leverage: '1',
    entry_price: '100',
    closed_price: '104',
    quantity: '1',
    pnl: '4',
    created_at: '2026-06-08T00:00:00.000Z',
    updated_at: '2026-06-08T12:00:00.000Z',
    asset_uuid: 'asset-1',
    symbol: 'BTCUSDT',
    trade_currency: 'USDT',
    ...overrides,
  };
}

async function runMudrexHistoryWindowAssertions(): Promise<void> {
  const { PositionsService } = await import('../src/brokers/providers/mudrex/PositionsService');
  const service = new PositionsService() as any;
  const calls: Array<Record<string, unknown>> = [];

  service.mudrexHttpClient = {
    async authenticatedGet(
      userId: string,
      accountId: string,
      path: string,
      params: Record<string, unknown>
    ) {
      calls.push({ userId, accountId, path, params });
      return [
        createPositionHistoryItem({
          id: 'before-window',
          updated_at: '2026-06-07T23:59:59.999Z',
        }),
        createPositionHistoryItem({
          id: 'start-boundary',
          updated_at: '2026-06-08T00:00:00.000Z',
        }),
        createPositionHistoryItem({
          id: 'inside-window',
          updated_at: '2026-06-09T10:15:00.000Z',
        }),
        createPositionHistoryItem({
          id: 'end-boundary',
          updated_at: '2026-06-09T23:59:59.999Z',
        }),
        createPositionHistoryItem({
          id: 'after-window',
          updated_at: '2026-06-10T00:00:00.000Z',
        }),
      ];
    },
  };

  const response = await service.getPositionHistory(
    {
      limit: '2',
      startDate: '2026-06-08',
      endDate: '2026-06-09',
    },
    'user-1',
    'account-1'
  );

  assert.deepEqual(calls, [
    {
      userId: 'user-1',
      accountId: 'account-1',
      path: '/fapi/v1/futures/positions/history',
      params: {
        limit: 2,
        start_date: '2026-06-08',
        end_date: '2026-06-09',
      },
    },
  ]);
  assert.deepEqual(
    (response.data as MudrexPositionHistoryItem[]).map((item) => item.id),
    ['start-boundary', 'inside-window']
  );
}

async function run(): Promise<void> {
  await runMudrexHistoryWindowAssertions();
  console.log('Mudrex position history window assertions passed.');
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
