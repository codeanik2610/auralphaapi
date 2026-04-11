import assert from 'node:assert/strict';
import { BrokerPositionsFacadeService } from '../src/api/services/BrokerPositionsFacadeService';
import { buildPositionRecordFromReadModelRow } from '../src/api/utils/positionsReadModel';

async function run(): Promise<void> {
  const service: any = new BrokerPositionsFacadeService();
  const originalNow = Date.now;

  Date.now = () => new Date('2026-04-09T12:00:00.000Z').getTime();

  const freshRow = buildPositionRecordFromReadModelRow({
    accountId: 'acc-fresh',
    brokerKey: 'mudrex',
    externalId: 'fresh-1',
    symbol: 'BTCUSDT',
    side: 'Long',
    sideKey: 'long',
    status: 'Open',
    statusKey: 'open',
    statusRank: 1,
    quantity: 0.1,
    entryPrice: 70000,
    currentPrice: 70100,
    unrealizedPnl: 10,
    exposure: 7000,
    positionCreatedAt: '2026-04-09T11:30:00.000Z',
    positionUpdatedAt: '2026-04-09T11:58:00.000Z',
    firstSeenAt: '2026-04-09T11:30:00.000Z',
    lastSeenAt: '2026-04-09T11:58:00.000Z',
    payloadJson: JSON.stringify({
      symbol: 'BTCUSDT',
      position_type: 'long',
      quantity: '0.1',
      entry_price: '70000',
      current_price: '70100',
      status: 'open',
      created_at: '2026-04-09T11:30:00.000Z',
      updated_at: '2026-04-09T11:58:00.000Z',
    }),
  });

  const criticalRow = buildPositionRecordFromReadModelRow({
    accountId: 'acc-critical',
    brokerKey: 'mudrex',
    externalId: 'stale-1',
    symbol: 'ETHUSDT',
    side: 'Short',
    sideKey: 'short',
    status: 'Open',
    statusKey: 'open',
    statusRank: 1,
    quantity: 0.5,
    entryPrice: 3200,
    currentPrice: 3190,
    unrealizedPnl: 5,
    exposure: 1600,
    positionCreatedAt: '2026-04-09T10:00:00.000Z',
    positionUpdatedAt: '2026-04-09T11:35:00.000Z',
    firstSeenAt: '2026-04-09T10:00:00.000Z',
    lastSeenAt: '2026-04-09T11:35:00.000Z',
    payloadJson: JSON.stringify({
      symbol: 'ETHUSDT',
      position_type: 'short',
      quantity: '-0.5',
      entry_price: '3200',
      current_price: '3190',
      status: 'open',
      created_at: '2026-04-09T10:00:00.000Z',
      updated_at: '2026-04-09T11:35:00.000Z',
    }),
  });

  service.positionReadModelRepository = {
    ensureHydratedFromSnapshots: async () => undefined,
    listLivePositionsForAccount: async () => [criticalRow],
    listLivePositionsForAccounts: async () =>
      new Map([
        ['acc-fresh', [freshRow]],
        ['acc-critical', [criticalRow]],
      ]),
    getAccountFreshness: async (_userId: string, accountIds: string[]) =>
      new Map(
        accountIds.map((accountId) => [
          accountId,
          accountId === 'acc-critical'
            ? {
                accountId,
                observedAt: new Date('2026-04-09T11:35:00.000Z'),
                checkpointAt: new Date('2026-04-09T11:36:00.000Z'),
                openPositions: 1,
                totalRows: 1,
              }
            : {
                accountId,
                observedAt: new Date('2026-04-09T11:58:00.000Z'),
                checkpointAt: new Date('2026-04-09T11:58:30.000Z'),
                openPositions: 1,
                totalRows: 1,
              },
        ])
      ),
    getPositionByExternalId: async () => criticalRow,
  };
  service.brokerAccountRepository = {
    getActiveBrokerAccounts: async () => [
      {
        id: 'acc-fresh',
        accountName: 'Primary',
        accountKey: 'primary',
        brokerKey: 'mudrex',
        status: 'Connected',
      },
      {
        id: 'acc-critical',
        accountName: 'Secondary',
        accountKey: 'secondary',
        brokerKey: 'mudrex',
        status: 'Connected',
      },
    ],
    getBrokerAccountById: async () => ({
      id: 'acc-critical',
      accountName: 'Secondary',
      accountKey: 'secondary',
      brokerKey: 'mudrex',
      status: 'Connected',
      mode: 'live',
      purpose: 'Execution',
      capabilities: 'futures',
      isDefault: false,
      lastSyncAt: new Date('2026-04-09T11:36:00.000Z'),
    }),
  };
  service.marketPriceRefreshService = {
    refreshPricesForUser: async () => undefined,
  };
  service.marketPriceBinanceRepository = {
    getBySymbols: async () => [],
  };
  service.brokerAccountRoutingService = {
    resolve: async () => ({
      brokerKey: 'mudrex',
      accountId: 'acc-critical',
    }),
  };
  service.alertRepository = {
    listRelatedAlerts: async () => [],
  };
  service.activityRepository = {
    listActivityWindow: async () => [],
  };
  service.suggestedTradeRepository = {
    findLinkedTradesByPositionIds: async () => [],
    findRecentTradesBySymbol: async () => [],
  };
  service.paperOrderRepository = {
    listPaperOrders: async () => [],
  };

  try {
    const grouped = await service.getFuturesPositionsForActiveAccounts('user-1');
    assert.equal(grouped.freshness?.freshAccounts, 1);
    assert.equal(grouped.freshness?.criticalAccounts, 1);
    assert.equal(
      grouped.freshness?.warning,
      '1 account has critically old position snapshots on the live desk.'
    );
    assert.equal(grouped.items[0].data[0].freshness?.state, 'fresh');
    assert.equal(grouped.items[1].data[0].freshness?.state, 'critical');
    assert.equal(grouped.items[1].freshness?.account?.state, 'critical');
    assert.match(
      grouped.items[1].freshness?.warning || '',
      /materially behind the broker route/i
    );

    const lifecycle = await service.getPositionLifecycle(
      'user-1',
      'stale-1',
      'mudrex',
      'acc-critical'
    );
    assert.equal(lifecycle.position.freshness?.state, 'critical');
    assert.equal(lifecycle.freshness?.position?.state, 'critical');
    assert.equal(lifecycle.freshness?.account?.state, 'critical');
    assert.match(lifecycle.freshness?.warning || '', /materially behind the broker route/i);

    console.log('Positions phase 6 assertions passed.');
  } finally {
    Date.now = originalNow;
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
