import assert from 'node:assert/strict';
import { BrokerPositionsFacadeService } from '../src/api/services/BrokerPositionsFacadeService';
import {
  buildPositionReadModelUpsert,
  buildPositionRecordFromReadModelRow,
} from '../src/api/utils/positionsReadModel';
import { PositionSnapshotRepository } from '../src/database/repositories/PositionSnapshotRepository';

async function run(): Promise<void> {
  const originalNow = Date.now;

  Date.now = () => new Date('2026-04-09T10:03:00.000Z').getTime();

  try {
  const upsert = buildPositionReadModelUpsert({
    userId: 'user-1',
    accountId: 'acc-1',
    brokerKey: 'mudrex',
    externalId: 'pos-1',
    payload: {
      symbol: 'BTCUSDT',
      position_type: 'short',
      size: '-0.5',
      entry_price: '70000',
      current_price: '69000',
      status: 'open',
      leverage: '10',
      stoploss_order_id: 'sl-1',
      takeprofit_order_id: 'tp-1',
      trigger_type: 'mark_price',
      created_at: '2026-04-09T09:00:00.000Z',
      updated_at: '2026-04-09T10:00:00.000Z',
    },
    payloadHash: 'hash-1',
    statusRank: 1,
    firstSeenAt: '2026-04-09T09:00:00.000Z',
    lastSeenAt: '2026-04-09T10:00:00.000Z',
  });

  assert.ok(upsert, 'read-model upsert should be built from the snapshot payload');
  assert.equal(upsert?.side, 'Short');
  assert.equal(upsert?.statusKey, 'open');
  assert.equal(upsert?.quantity, 0.5);
  assert.equal(upsert?.stoplossOrderId, 'sl-1');
  assert.equal(upsert?.takeprofitOrderId, 'tp-1');

  const record = buildPositionRecordFromReadModelRow({
    userId: upsert?.userId,
    accountId: upsert?.accountId,
    brokerKey: upsert?.brokerKey,
    externalId: upsert?.externalId,
    symbol: upsert?.symbol,
    side: upsert?.side,
    sideKey: upsert?.sideKey,
    sideRaw: upsert?.sideRaw,
    status: upsert?.status,
    statusKey: upsert?.statusKey,
    statusRaw: upsert?.statusRaw,
    statusRank: upsert?.statusRank,
    quantity: upsert?.quantity,
    entryPrice: upsert?.entryPrice,
    currentPrice: upsert?.currentPrice,
    closedPrice: upsert?.closedPrice,
    unrealizedPnl: upsert?.unrealizedPnl,
    realizedPnl: upsert?.realizedPnl,
    leverage: upsert?.leverage,
    liquidationPrice: upsert?.liquidationPrice,
    exposure: upsert?.exposure,
    orderPrice: upsert?.orderPrice,
    stoplossPrice: upsert?.stoplossPrice,
    takeprofitPrice: upsert?.takeprofitPrice,
    stoplossOrderId: upsert?.stoplossOrderId,
    takeprofitOrderId: upsert?.takeprofitOrderId,
    triggerType: upsert?.triggerType,
    positionCreatedAt: upsert?.positionCreatedAt,
    positionUpdatedAt: upsert?.positionUpdatedAt,
    positionClosedAt: upsert?.positionClosedAt,
    firstSeenAt: upsert?.firstSeenAt,
    lastSeenAt: upsert?.lastSeenAt,
    payloadJson: upsert?.payloadJson,
    payloadHash: upsert?.payloadHash,
  });
  assert.equal(record.id, 'pos-1');
  assert.equal(record.side, 'Short');
  assert.equal(record.quantity, 0.5);
  assert.equal(record.stoploss_order_id, 'sl-1');
  assert.equal(
    (record.rawPayload as { symbol?: string } | undefined)?.symbol,
    'BTCUSDT'
  );

  const hydrationCalls: unknown[][] = [];
  const summaryRepo: any = new PositionSnapshotRepository();
  summaryRepo.positionReadModelRepository = {
    ensureHydratedFromSnapshots: async (...args: unknown[]) => {
      hydrationCalls.push(args);
    },
    getAccountOpenPositionSummary: async () =>
      new Map([
        [
          'acc-1',
          {
            accountId: 'acc-1',
            openPositions: 2,
            observedAt: new Date('2026-04-09T11:00:00.000Z'),
            hasSnapshotHistory: true,
          },
        ],
      ]),
  };
  const summary = await summaryRepo.getAccountOpenPositionSummary('user-1', ['acc-1']);
  assert.equal(hydrationCalls.length, 1);
  assert.equal(summary.get('acc-1')?.openPositions, 2);

  const service: any = new BrokerPositionsFacadeService();
  const readModelCalls: unknown[][] = [];
  service.positionReadModelRepository = {
    ensureHydratedFromSnapshots: async (...args: unknown[]) => {
      readModelCalls.push(args);
    },
    getAccountFreshness: async () =>
      new Map([
        [
          'acc-1',
          {
            accountId: 'acc-1',
            observedAt: new Date('2026-04-09T10:00:00.000Z'),
            checkpointAt: new Date('2026-04-09T10:02:00.000Z'),
            openPositions: 1,
            totalRows: 2,
          },
        ],
      ]),
    listLivePositionsForAccount: async () => [
      buildPositionRecordFromReadModelRow({
        accountId: 'acc-1',
        brokerKey: 'mudrex',
        externalId: 'live-1',
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
        payloadJson: JSON.stringify({
          symbol: 'BTCUSDT',
          position_type: 'short',
          size: '-0.5',
          entry_price: '70000',
          status: 'open',
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
              externalId: 'live-1',
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
              payloadJson: JSON.stringify({
                symbol: 'BTCUSDT',
                position_type: 'short',
                size: '-0.5',
                entry_price: '70000',
                status: 'open',
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
  assert.equal(readModelCalls.length > 0, true);
  assert.equal(live.totalActiveAccounts, 1);
  assert.equal(live.items[0].positions?.length, 1);
  assert.equal(live.items[0].data[0].current_price, 71000);
  assert.equal(live.items[0].data[0].unrealized_pnl, -500);
  assert.equal(live.items[0].data[0].accountName, 'Primary');
  assert.equal(live.items[0].data[0].freshness?.state, 'fresh');
  assert.equal(live.items[0].freshness?.account?.state, 'fresh');
  assert.equal(live.freshness?.freshAccounts, 1);

  const history = await service.getPositionHistoryForActiveAccounts({}, 'user-1');
  assert.equal(history.items[0].history?.length, 1);
  assert.equal(history.items[0].data[0].realized_pnl, 437.5);
  assert.equal(history.items[0].data[0].accountKey, 'primary');

  const singleHistory = await service.getPositionHistory({}, 'user-1', 'mudrex', 'acc-1');
  assert.equal(singleHistory[0].accountId, 'acc-1');
  assert.equal(singleHistory[0].brokerKey, 'mudrex');
  assert.equal(singleHistory[0].rawPayload?.symbol, 'ETHUSDT');
  assert.equal(singleHistory[0].freshness?.source, 'position_archive');

    console.log('Positions phase 4 assertions passed.');
  } finally {
    Date.now = originalNow;
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
