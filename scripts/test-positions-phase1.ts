import assert from 'node:assert/strict';
import { BrokerPositionsFacadeService } from '../src/api/services/BrokerPositionsFacadeService';
import { buildPositionRecordFromReadModelRow } from '../src/api/utils/positionsReadModel';

async function run(): Promise<void> {
  const service: any = new BrokerPositionsFacadeService();
  const originalNow = Date.now;

  Date.now = () => new Date('2026-04-09T10:03:00.000Z').getTime();

  try {
    service.positionReadModelRepository = {
      ensureHydratedFromSnapshots: async () => undefined,
      getAccountFreshness: async () =>
        new Map([
          [
            'acc-1',
            {
              accountId: 'acc-1',
              observedAt: new Date('2026-04-09T10:00:00.000Z'),
              checkpointAt: new Date('2026-04-09T10:01:00.000Z'),
              openPositions: 1,
              totalRows: 2,
            },
          ],
        ]),
      listLivePositionsForAccount: async () => [
        buildPositionRecordFromReadModelRow({
          accountId: 'acc-1',
          brokerKey: 'mudrex',
          externalId: 'pos-1',
          symbol: 'BTCUSDT',
          side: 'Short',
          sideKey: 'short',
          status: 'Open',
          statusKey: 'open',
          statusRank: 1,
          quantity: 0.5,
          entryPrice: 70000,
          currentPrice: 70000,
          unrealizedPnl: 0,
          leverage: 10,
          exposure: 35000,
          positionCreatedAt: '2026-04-09T09:00:00.000Z',
          positionUpdatedAt: '2026-04-09T10:00:00.000Z',
          lastSeenAt: '2026-04-09T10:00:00.000Z',
          payloadJson: JSON.stringify({
            symbol: 'BTCUSDT',
            position_type: 'short',
            size: '-0.5',
            entry_price: '70000',
            status: 'open',
            leverage: '10',
            created_at: '2026-04-09T09:00:00.000Z',
            updated_at: '2026-04-09T10:00:00.000Z',
          }),
        }),
      ],
      listLivePositionsForAccounts: async () =>
        new Map([
          [
            'acc-1',
            [
              buildPositionRecordFromReadModelRow({
                accountId: 'acc-1',
                brokerKey: 'mudrex',
                externalId: 'pos-1',
                symbol: 'BTCUSDT',
                side: 'Short',
                sideKey: 'short',
                status: 'Open',
                statusKey: 'open',
                statusRank: 1,
                quantity: 0.5,
                entryPrice: 70000,
                currentPrice: 70000,
                unrealizedPnl: 0,
                leverage: 10,
                exposure: 35000,
                positionCreatedAt: '2026-04-09T09:00:00.000Z',
                positionUpdatedAt: '2026-04-09T10:00:00.000Z',
                lastSeenAt: '2026-04-09T10:00:00.000Z',
                payloadJson: JSON.stringify({
                  symbol: 'BTCUSDT',
                  position_type: 'short',
                  size: '-0.5',
                  entry_price: '70000',
                  status: 'open',
                  leverage: '10',
                  created_at: '2026-04-09T09:00:00.000Z',
                  updated_at: '2026-04-09T10:00:00.000Z',
                }),
              }),
            ],
          ],
        ]),
      listHistoryForAccount: async () => [
        buildPositionRecordFromReadModelRow({
          accountId: 'acc-1',
          brokerKey: 'mudrex',
          externalId: 'hist-1',
          symbol: 'ETHUSDT',
          side: 'Long',
          sideKey: 'long',
          status: 'Closed',
          statusKey: 'closed',
          statusRank: 3,
          quantity: 1.25,
          entryPrice: 3200,
          closedPrice: 3550,
          realizedPnl: 437.5,
          positionCreatedAt: '2026-04-09T06:00:00.000Z',
          positionUpdatedAt: '2026-04-09T08:00:00.000Z',
          payloadJson: JSON.stringify({
            symbol: 'ETHUSDT',
            side: 'buy',
            quantity: '1.25',
            entry_price: '3200',
            close_price: '3550',
            pnl: '437.5',
            status: 'closed',
            updated_at: '2026-04-09T08:00:00.000Z',
            created_at: '2026-04-09T06:00:00.000Z',
          }),
        }),
      ],
      listHistoryForAccounts: async () =>
        new Map([
          [
            'acc-1',
            [
              buildPositionRecordFromReadModelRow({
                accountId: 'acc-1',
                brokerKey: 'mudrex',
                externalId: 'hist-1',
                symbol: 'ETHUSDT',
                side: 'Long',
                sideKey: 'long',
                status: 'Closed',
                statusKey: 'closed',
                statusRank: 3,
                quantity: 1.25,
                entryPrice: 3200,
                closedPrice: 3550,
                realizedPnl: 437.5,
                positionCreatedAt: '2026-04-09T06:00:00.000Z',
                positionUpdatedAt: '2026-04-09T08:00:00.000Z',
                payloadJson: JSON.stringify({
                  symbol: 'ETHUSDT',
                  side: 'buy',
                  quantity: '1.25',
                  entry_price: '3200',
                  close_price: '3550',
                  pnl: '437.5',
                  status: 'closed',
                  updated_at: '2026-04-09T08:00:00.000Z',
                  created_at: '2026-04-09T06:00:00.000Z',
                }),
              }),
            ],
          ],
        ]),
    };
  service.brokerAccountRepository = {
    getActiveBrokerAccounts: async () => [
      {
        id: 'acc-1',
        accountName: 'Primary',
        accountKey: 'primary',
        brokerKey: 'mudrex',
        status: 'active',
      },
    ],
  };
  service.marketPriceRefreshService = {
    refreshPricesForUser: async () => undefined,
  };
  service.marketPriceBinanceRepository = {
    getBySymbols: async () => [
      {
        symbol: 'BTCUSDT',
        price: 71000,
        source: 'binance',
        retrievedAt: '2026-04-09T10:00:00.000Z',
      },
    ],
  };
  service.userTimeZoneService = {
    resolveUserTimeZone: async () => 'UTC',
  };
  service.brokerAccountRoutingService = {
    resolve: async () => ({
      brokerKey: 'mudrex',
      accountId: 'acc-1',
    }),
  };

    const live = await service.getFuturesPositionsForActiveAccounts('user-1');
    assert.equal(live.totalActiveAccounts, 1);
    assert.equal(live.items[0].positions?.length, 1);
    assert.equal(live.items[0].data[0].id, 'pos-1');
    assert.equal(live.items[0].data[0].side, 'Short');
    assert.equal(live.items[0].data[0].status, 'Open');
    assert.equal(live.items[0].data[0].quantity, 0.5);
    assert.equal(live.items[0].data[0].current_price, 71000);
    assert.equal(live.items[0].data[0].unrealized_pnl, -500);
    assert.equal(live.items[0].data[0].accountName, 'Primary');
    assert.equal(live.items[0].data[0].positionSummary?.sideKey, 'short');
    assert.equal(live.items[0].data[0].positionSummary?.exposure, 35000);
    assert.equal(live.items[0].data[0].freshness?.state, 'fresh');
    assert.equal(live.items[0].freshness?.account?.state, 'fresh');
    assert.equal(live.freshness?.freshAccounts, 1);

    const history = await service.getPositionHistoryForActiveAccounts({}, 'user-1');
    assert.equal(history.items[0].history?.length, 1);
    assert.equal(history.items[0].data[0].id, 'hist-1');
    assert.equal(history.items[0].data[0].side, 'Long');
    assert.equal(history.items[0].data[0].status, 'Closed');
    assert.equal(history.items[0].data[0].quantity, 1.25);
    assert.equal(history.items[0].data[0].closed_price, 3550);
    assert.equal(history.items[0].data[0].realized_pnl, 437.5);
    assert.equal(history.items[0].data[0].accountKey, 'primary');

    const singleHistory = await service.getPositionHistory({}, 'user-1', 'mudrex', 'acc-1');
    assert.equal(singleHistory[0].accountId, 'acc-1');
    assert.equal(singleHistory[0].brokerKey, 'mudrex');
    assert.equal(singleHistory[0].positionSummary?.statusKey, 'closed');
    assert.equal(singleHistory[0].freshness?.source, 'position_archive');

    console.log('Positions phase 1 assertions passed.');
  } finally {
    Date.now = originalNow;
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
