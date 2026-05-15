import assert from 'node:assert/strict';
import { runSuiteSteps } from './_support/run-script-suite';

// Consolidated module suite.

async function positionsGuard01(): Promise<void> {
  const { BrokerPositionsFacadeService } =
    await import('../src/api/services/BrokerPositionsFacadeService');
  const { buildPositionRecordFromReadModelRow } =
    await import('../src/api/utils/positionsReadModel');

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
      assert.equal(live.items[0].data[0].current_price, 70000);
      assert.equal(live.items[0].data[0].unrealized_pnl, 0);
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

  await run();
}

async function positionsGuard04(): Promise<void> {
  const { BrokerPositionsFacadeService } =
    await import('../src/api/services/BrokerPositionsFacadeService');
  const { buildPositionReadModelUpsert, buildPositionRecordFromReadModelRow } =
    await import('../src/api/utils/positionsReadModel');
  const { PositionSnapshotRepository } =
    await import('../src/database/repositories/PositionSnapshotRepository');

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
          requested_leverage: '10',
          confirmed_order_leverage: '10',
          leverage_source: 'confirmed_order_submission',
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

      const nestedProtectionUpsert = buildPositionReadModelUpsert({
        userId: 'user-1',
        accountId: 'acc-1',
        brokerKey: 'mudrex',
        externalId: 'pos-2',
        payload: {
          symbol: 'ETHUSDT',
          position_type: 'long',
          quantity: '1.25',
          entry_price: '2200',
          current_price: '2210',
          status: 'open',
          leverage: '12',
          stoploss: {
            order_id: 'nested-sl-1',
            price: '2145.5',
          },
          takeprofit: {
            order_id: 'nested-tp-1',
            price: '2310.75',
          },
          created_at: '2026-04-09T09:10:00.000Z',
          updated_at: '2026-04-09T10:10:00.000Z',
        },
        payloadHash: 'hash-2',
        statusRank: 1,
        firstSeenAt: '2026-04-09T09:10:00.000Z',
        lastSeenAt: '2026-04-09T10:10:00.000Z',
      });

      assert.ok(nestedProtectionUpsert, 'nested Mudrex protection payload should hydrate');
      assert.equal(nestedProtectionUpsert?.stoplossOrderId, 'nested-sl-1');
      assert.equal(nestedProtectionUpsert?.takeprofitOrderId, 'nested-tp-1');
      assert.equal(nestedProtectionUpsert?.stoplossPrice, 2145.5);
      assert.equal(nestedProtectionUpsert?.takeprofitPrice, 2310.75);

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
      assert.equal(record.requested_leverage, 10);
      assert.equal(record.confirmed_order_leverage, 10);
      assert.equal(record.leverage_source, 'confirmed_order_submission');
      assert.equal(record.stoploss_order_id, 'sl-1');
      assert.equal((record.rawPayload as { symbol?: string } | undefined)?.symbol, 'BTCUSDT');

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
      assert.equal(live.items[0].data[0].current_price, 70000);
      assert.equal(live.items[0].data[0].unrealized_pnl, 0);
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

  await run();
}

async function positionsGuard05(): Promise<void> {
  const { BrokerPositionsFacadeService } =
    await import('../src/api/services/BrokerPositionsFacadeService');
  const { buildPositionRecordFromReadModelRow } =
    await import('../src/api/utils/positionsReadModel');

  async function run(): Promise<void> {
    const service: any = new BrokerPositionsFacadeService();
    const originalNow = Date.now;

    Date.now = () => new Date('2026-04-09T11:04:00.000Z').getTime();

    service.positionReadModelRepository = {
      ensureHydratedFromSnapshots: async () => undefined,
      getAccountFreshness: async () =>
        new Map([
          [
            'acc-1',
            {
              accountId: 'acc-1',
              observedAt: new Date('2026-04-09T11:00:00.000Z'),
              checkpointAt: new Date('2026-04-09T11:04:00.000Z'),
              openPositions: 1,
              totalRows: 1,
            },
          ],
        ]),
      getPositionByExternalId: async () =>
        buildPositionRecordFromReadModelRow({
          accountId: 'acc-1',
          brokerKey: 'mudrex',
          externalId: 'pos-1',
          symbol: 'BTCUSDT',
          side: 'Long',
          sideKey: 'long',
          status: 'Open',
          statusKey: 'open',
          statusRank: 1,
          quantity: 0.25,
          entryPrice: 67000,
          currentPrice: 68200,
          unrealizedPnl: 300,
          leverage: 10,
          liquidationPrice: 62000,
          exposure: 16750,
          stoplossOrderId: 'sl-1',
          takeprofitOrderId: 'tp-1',
          triggerType: 'mark_price',
          positionCreatedAt: '2026-04-09T09:00:00.000Z',
          positionUpdatedAt: '2026-04-09T11:00:00.000Z',
          payloadJson: JSON.stringify({
            symbol: 'BTCUSDT',
            position_type: 'long',
            quantity: '0.25',
            entry_price: '67000',
            current_price: '68200',
            stoploss_order_id: 'sl-1',
            takeprofit_order_id: 'tp-1',
            status: 'open',
            created_at: '2026-04-09T09:00:00.000Z',
            updated_at: '2026-04-09T11:00:00.000Z',
          }),
        }),
    };
    service.brokerAccountRoutingService = {
      resolve: async () => ({
        brokerKey: 'mudrex',
        accountId: 'acc-1',
      }),
    };
    service.brokerAccountRepository = {
      getBrokerAccountById: async () => ({
        id: 'acc-1',
        accountName: 'Primary account',
        accountKey: 'primary',
        brokerKey: 'mudrex',
        status: 'Connected',
        mode: 'live',
        purpose: 'Execution',
        capabilities: 'futures',
        isDefault: true,
        lastSyncAt: new Date('2026-04-09T11:30:00.000Z'),
      }),
    };
    service.alertRepository = {
      listRelatedAlerts: async () => [
        {
          id: 'alert-1',
          severity: 'High',
          channel: 'Trading',
          status: 'Open',
          message: 'BTCUSDT volatility alert',
          route: 'Risk review',
          source: 'positions-worker',
          createdAt: new Date('2026-04-09T11:10:00.000Z'),
        },
      ],
    };
    service.activityRepository = {
      listActivityWindow: async () => [
        {
          id: 'act-1',
          type: 'Position',
          title: 'Margin added: pos-1',
          status: 'Success',
          stream: 'Execution',
          route: 'Positions',
          description: 'Position margin updated',
          createdAt: new Date('2026-04-09T11:20:00.000Z'),
        },
      ],
    };
    service.suggestedTradeRepository = {
      findLinkedTradesByPositionIds: async () => [
        {
          id: 'trade-1',
          automationId: 'auto-1',
          automationRunId: 'run-1',
          userId: 'user-1',
          sourceBacktestId: 'backtest-1',
          sourceTemplateId: 'template-1',
          sourceSetupKey: 'btc-breakout',
          symbol: 'BTCUSDT',
          timeframe: '15m',
          side: 'BUY',
          signalTime: new Date('2026-04-09T08:55:00.000Z'),
          status: 'Accepted',
          confidence: 0.84,
          score: 91,
          entryPrice: '66800',
          stopLossPrice: '65500',
          takeProfitTargets: ['69000'],
          entryRule: 'Breakout',
          exitRule: 'Trail',
          rationale: 'Momentum confirmed',
          dedupeKey: 'dedupe-1',
          meta: { signalId: 'signal-1' },
          executionRecord: {
            executionMode: 'live',
            orderId: 'ord-1',
            paperOrderId: null,
            brokerKey: 'mudrex',
            accountId: 'acc-1',
            orderStatus: 'FILLED',
            paperOrderStatus: null,
            executionState: 'filled',
            orderType: 'market',
            triggerType: 'mark_price',
            leverage: 10,
            quantity: 0.25,
            routeAttempts: [
              {
                attemptNumber: 1,
                candidateRank: 1,
                brokerKey: 'delta_exchange',
                accountId: 'delta-acc-1',
                accountName: 'Delta Prod',
                requestedSymbol: 'BTCUSDT',
                brokerSymbol: 'BTCUSDT',
                status: 'failed',
                startedAt: '2026-04-09T08:55:30.000Z',
                finishedAt: '2026-04-09T08:55:45.000Z',
                submissionState: 'rejected',
                failureClassification: 'confirmed_no_order',
                failureCode: 'ORDER_REJECTED_INSUFFICIENT_MARGIN',
                failureMessage: 'Order rejected: insufficient margin',
              },
              {
                attemptNumber: 2,
                candidateRank: 2,
                brokerKey: 'mudrex',
                accountId: 'acc-1',
                accountName: 'Mudrex Prod',
                requestedSymbol: 'BTCUSDT',
                brokerSymbol: 'BTCUSDT',
                status: 'placed',
                startedAt: '2026-04-09T08:55:46.000Z',
                finishedAt: '2026-04-09T08:56:00.000Z',
                submissionState: 'accepted',
                orderId: 'ord-1',
                orderStatus: 'FILLED',
              },
            ],
            entryPrice: '66800',
            stopLossPrice: '65500',
            takeProfitPrice: '69000',
            submittedAt: new Date('2026-04-09T08:56:00.000Z'),
            linkedAt: new Date('2026-04-09T08:57:00.000Z'),
            lastSeenAt: new Date('2026-04-09T11:21:00.000Z'),
            filledAt: new Date('2026-04-09T08:58:00.000Z'),
            canceledAt: null,
            filledPrice: '66810',
            filledQuantity: 0.25,
            remainingQuantity: 0,
            positionId: 'pos-1',
            positionStatus: 'Open',
            positionOpenedAt: new Date('2026-04-09T08:58:00.000Z'),
            positionClosedAt: null,
            exitPrice: null,
            realizedPnl: null,
            protectionState: 'attached',
            protectionSource: 'suggested_trade_execution',
            protectionPlan: {
              attachedStopLossPrice: '65600',
              attachedTakeProfitPrice: '68950',
              replacementSubmittedAt: '2026-04-09T09:00:00.000Z',
              stopLossOrderId: 'sl-1',
              takeProfitOrderId: 'tp-1',
            },
            protectionAttempts: 1,
            protectionLastError: null,
            protectionCheckedAt: new Date('2026-04-09T08:59:30.000Z'),
            protectionAttachedAt: new Date('2026-04-09T09:00:05.000Z'),
            outcome: 'open',
            note: null,
          },
          createdAt: new Date('2026-04-09T08:55:00.000Z'),
          updatedAt: new Date('2026-04-09T11:21:00.000Z'),
        },
      ],
      findRecentTradesBySymbol: async () => [
        {
          id: 'trade-2',
          automationId: 'auto-2',
          automationRunId: 'run-2',
          userId: 'user-1',
          sourceBacktestId: null,
          sourceTemplateId: null,
          sourceSetupKey: null,
          symbol: 'BTCUSDT',
          timeframe: '5m',
          side: 'BUY',
          signalTime: new Date('2026-04-09T10:45:00.000Z'),
          status: 'Reviewed',
          confidence: 0.72,
          score: 77,
          entryPrice: '67900',
          stopLossPrice: '67100',
          takeProfitTargets: ['68800'],
          entryRule: null,
          exitRule: null,
          rationale: null,
          dedupeKey: 'dedupe-2',
          meta: {},
          executionRecord: {
            executionMode: 'paper',
            orderId: null,
            paperOrderId: 'paper-1',
            brokerKey: 'mudrex',
            accountId: 'acc-1',
            orderStatus: null,
            paperOrderStatus: 'OPEN',
            executionState: 'linked',
            orderType: 'limit',
            triggerType: 'mark_price',
            leverage: 5,
            quantity: 0.1,
            entryPrice: '67900',
            stopLossPrice: '67100',
            takeProfitPrice: '68800',
            submittedAt: new Date('2026-04-09T10:46:00.000Z'),
            linkedAt: new Date('2026-04-09T10:47:00.000Z'),
            lastSeenAt: new Date('2026-04-09T10:48:00.000Z'),
            filledAt: null,
            canceledAt: null,
            filledPrice: null,
            filledQuantity: null,
            remainingQuantity: 0.1,
            positionId: null,
            positionStatus: null,
            positionOpenedAt: null,
            positionClosedAt: null,
            exitPrice: null,
            realizedPnl: null,
            outcome: null,
            note: null,
          },
          createdAt: new Date('2026-04-09T10:45:00.000Z'),
          updatedAt: new Date('2026-04-09T10:48:00.000Z'),
        },
      ],
    };
    service.paperOrderRepository = {
      listPaperOrders: async () => [
        {
          id: 'paper-1',
          suggestedTradeId: 'trade-2',
          assetId: 'btcusdt',
          brokerKey: 'mudrex',
          accountId: 'acc-1',
          symbol: 'BTCUSDT',
          side: 'BUY',
          orderType: 'limit',
          triggerType: 'mark_price',
          status: 'OPEN',
          leverage: 5,
          quantity: '0.1',
          orderPrice: '67900',
          stoplossPrice: '67100',
          takeprofitPrice: '68800',
          reduceOnly: false,
          payload: {
            simulation: {
              positionId: null,
            },
          },
          canceledAt: null,
          createdAt: new Date('2026-04-09T10:46:00.000Z'),
          updatedAt: new Date('2026-04-09T10:48:00.000Z'),
        },
      ],
    };
    service.listRelatedLiveOrderSnapshots = async () => [
      {
        id: 'sl-1',
        externalId: 'sl-1',
        kind: 'live',
        relation: 'position',
        symbol: 'BTCUSDT',
        status: 'OPEN',
        side: 'SELL',
        orderType: 'stop_market',
        triggerType: 'mark_price',
        quantity: 0.25,
        orderPrice: 65500,
        reduceOnly: true,
        linkedPositionId: 'pos-1',
        createdAt: '2026-04-09T09:01:00.000Z',
        updatedAt: '2026-04-09T11:07:00.000Z',
        detailUrl: '/orders?selected=sl-1',
      },
      {
        id: 'risk-tp-1',
        externalId: 'risk-tp-1',
        kind: 'live',
        relation: 'protection',
        symbol: 'BTCUSDT',
        status: 'CREATED',
        side: 'SELL',
        orderType: 'TAKEPROFIT',
        triggerType: 'MARKET',
        quantity: 0.25,
        orderPrice: 69000,
        reduceOnly: false,
        createdAt: '2026-04-09T09:02:00.000Z',
        updatedAt: '2026-04-09T11:06:00.000Z',
        detailUrl: '/orders?selected=risk-tp-1',
      },
    ];

    try {
      const response = await service.getPositionLifecycle('user-1', 'pos-1', 'mudrex', 'acc-1');

      assert.equal(response.position.id, 'pos-1');
      assert.equal(response.account?.id, 'acc-1');
      assert.equal(response.account?.isDefault, true);
      assert.equal(response.summary.relatedOrders, 3);
      assert.equal(response.summary.openAlerts, 1);
      assert.equal(response.summary.linkedSuggestedTrades, 2);
      assert.equal(response.summary.recentActivity, 1);
      assert.equal(response.position.freshness?.state, 'fresh');
      assert.equal(response.freshness?.position?.state, 'fresh');
      assert.equal(response.freshness?.account?.state, 'fresh');
      assert.equal(response.freshness?.warning, null);
      assert.equal(response.relatedOrders[0].id, 'sl-1');
      assert.equal(
        response.relatedOrders.some(
          (item: { id: string; relation: string }) =>
            item.id === 'sl-1' && item.relation === 'position'
        ),
        true
      );
      assert.equal(
        response.relatedOrders.some(
          (item: { id: string; relation: string; orderType?: string; orderPrice?: number }) =>
            item.id === 'risk-tp-1' &&
            item.relation === 'protection' &&
            item.orderType === 'TAKEPROFIT' &&
            item.orderPrice === 69000
        ),
        true
      );
      assert.equal(
        response.relatedOrders.some((item: { id: string }) => item.id === 'paper-1'),
        true
      );
      assert.equal(response.relatedAlerts[0].id, 'alert-1');
      assert.equal(response.relatedSuggestedTrades[0].id, 'trade-1');
      assert.equal(response.relatedSuggestedTrades[0].linkedPositionId, 'pos-1');
      assert.equal(response.relatedSuggestedTrades[0].orderStatus, 'FILLED');
      assert.equal(response.relatedSuggestedTrades[0].entrySubmittedAt, '2026-04-09T08:56:00.000Z');
      assert.equal(response.relatedSuggestedTrades[0].entryFilledAt, '2026-04-09T08:58:00.000Z');
      assert.equal(response.relatedSuggestedTrades[0].positionOpenedAt, '2026-04-09T08:58:00.000Z');
      assert.equal(response.relatedSuggestedTrades[0].filledPrice, 66810);
      assert.equal(response.relatedSuggestedTrades[0].filledQuantity, 0.25);
      assert.equal(response.relatedSuggestedTrades[0].protection?.state, 'attached');
      assert.equal(
        response.relatedSuggestedTrades[0].protection?.checkedAt,
        '2026-04-09T08:59:30.000Z'
      );
      assert.equal(
        response.relatedSuggestedTrades[0].protection?.attachedAt,
        '2026-04-09T09:00:05.000Z'
      );
      assert.equal(
        response.relatedSuggestedTrades[0].protection?.replacementSubmittedAt,
        '2026-04-09T09:00:00.000Z'
      );
      assert.equal(response.relatedSuggestedTrades[0].protection?.plannedStopLossPrice, 65500);
      assert.equal(response.relatedSuggestedTrades[0].protection?.plannedTakeProfitPrice, 69000);
      assert.equal(response.relatedSuggestedTrades[0].protection?.stopLossPrice, 65600);
      assert.equal(response.relatedSuggestedTrades[0].protection?.takeProfitPrice, 68950);
      assert.equal(response.relatedSuggestedTrades[0].protection?.stopLossOrderId, 'sl-1');
      assert.equal(response.relatedSuggestedTrades[0].routeAttempts?.length, 2);
      assert.equal(
        response.relatedSuggestedTrades[0].routeAttempts?.[0]?.brokerKey,
        'delta_exchange'
      );
      assert.equal(response.relatedSuggestedTrades[0].routeAttempts?.[1]?.brokerKey, 'mudrex');
      assert.equal(
        response.relatedSuggestedTrades[0].operatorTimeline?.some(
          (event: { kind: string; label: string; status?: string | null }) =>
            event.kind === 'broker_route' &&
            event.label === 'Broker route 1 failed' &&
            event.status === 'failed'
        ),
        true
      );
      assert.equal(
        response.relatedSuggestedTrades[0].operatorTimeline?.some(
          (event: { kind: string; label: string }) =>
            event.kind === 'protection' && event.label === 'Protection attached'
        ),
        true
      );
      assert.equal(
        response.relatedSuggestedTrades[0].operatorTimeline?.some(
          (event: { kind: string; label: string; occurredAt: string }) =>
            event.kind === 'protection' &&
            event.label === 'Protection repair submitted' &&
            event.occurredAt === '2026-04-09T09:00:00.000Z'
        ),
        true
      );
      assert.equal(
        response.relatedLinks.some(
          (item: { entity: string; id: string }) => item.entity === 'account' && item.id === 'acc-1'
        ),
        true
      );
      assert.equal(
        response.relatedLinks.some(
          (item: { entity: string; id: string }) =>
            item.entity === 'strategy_template' && item.id === 'template-1'
        ),
        true
      );
      assert.equal(response.recentActivity[0].id, 'act-1');

      console.log('Positions phase 5 assertions passed.');
    } finally {
      Date.now = originalNow;
    }
  }

  await run();
}

async function positionsGuard06(): Promise<void> {
  const { BrokerPositionsFacadeService } =
    await import('../src/api/services/BrokerPositionsFacadeService');
  const { buildPositionRecordFromReadModelRow } =
    await import('../src/api/utils/positionsReadModel');

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

      const syncedFlatFreshness = service.buildAccountFreshness(
        {
          accountName: 'Delta Production',
          accountKey: 'delta_primary_account',
        },
        {
          accountId: 'acc-flat',
          observedAt: new Date('2026-04-09T08:00:00.000Z'),
          checkpointAt: new Date('2026-04-09T11:58:30.000Z'),
          openPositions: 0,
          totalRows: 26,
        }
      );
      assert.equal(syncedFlatFreshness?.account?.state, 'fresh');
      assert.equal(syncedFlatFreshness?.account?.source, 'sync_checkpoint_no_open_positions');
      assert.equal(syncedFlatFreshness?.warning, null);

      const syncedFlatSummary = service.summarizeGroupedFreshness([
        {
          accountId: 'acc-flat',
          accountName: 'Delta Production',
          accountKey: 'delta_primary_account',
          brokerKey: 'delta_exchange',
          status: 'Connected',
          totalPositions: 0,
          data: [],
          positions: [],
          freshness: syncedFlatFreshness,
        },
      ]);
      assert.equal(syncedFlatSummary?.freshAccounts, 1);
      assert.equal(syncedFlatSummary?.criticalAccounts, 0);
      assert.equal(syncedFlatSummary?.warning, null);

      console.log('Positions phase 6 assertions passed.');
    } finally {
      Date.now = originalNow;
    }
  }

  await run();
}

async function positionsGuard08(): Promise<void> {
  const { BrokerPositionsFacadeService } =
    await import('../src/api/services/BrokerPositionsFacadeService');

  type LoggedEvent = {
    userId: string;
    payload: Record<string, unknown>;
  };

  async function run(): Promise<void> {
    const service: any = new BrokerPositionsFacadeService();
    const loggedEvents: LoggedEvent[] = [];
    const emittedAlerts: Array<{ userId: string; payload: Record<string, unknown> }> = [];

    service.brokerAccountRoutingService = {
      resolve: async () => ({
        brokerKey: 'mudrex',
        accountId: 'acc-1',
        userId: 'user-1',
      }),
    };
    service.positionReadModelRepository = {
      ensureHydratedFromSnapshots: async () => undefined,
      getPositionByExternalId: async () => ({
        id: 'pos-1',
        external_id: 'pos-1',
        symbol: 'BTCUSDT',
        accountId: 'acc-1',
        brokerKey: 'mudrex',
      }),
    };
    service.operationalEventService = {
      logActivity: async (userId: string, payload: Record<string, unknown>) => {
        loggedEvents.push({ userId, payload });
      },
      emitFailureAlert: async (userId: string, payload: Record<string, unknown>) => {
        emittedAlerts.push({ userId, payload });
      },
    };

    const adapter = {
      addMargin: async () => ({
        data: {
          message: 'Margin updated',
          liquidation_price: '61000',
        },
      }),
      createRiskOrder: async () => ({
        data: {
          position_id: 'pos-1',
          status: 'OPEN',
          message: 'Protection orders submitted',
        },
      }),
      updateRiskOrder: async () => ({
        data: {
          position_id: 'pos-1',
          status: 'OPEN',
          message: 'Protection orders updated',
        },
      }),
      reversePosition: async () => {
        throw new Error('Mudrex rejected reverse');
      },
      closePartial: async () => ({
        data: true,
      }),
      closePosition: async () => ({
        data: {
          position_id: 'pos-1',
          status: 'CLOSED',
          message: 'Position closed',
        },
      }),
    };

    service.brokerRuntimeRegistry = {
      getPositionsAdapter: () => adapter,
    };

    await service.addPositionMargin('pos-1', { margin: 250 }, 'user-1', 'mudrex', 'acc-1');
    await service.createPositionRiskOrder(
      'pos-1',
      {
        stoploss_price: '65000',
        takeprofit_price: '72000',
        order_source: 'positions_desk',
        is_stoploss: true,
        is_takeprofit: true,
      },
      'user-1',
      'mudrex',
      'acc-1'
    );
    await service.updatePositionRiskOrder(
      'pos-1',
      {
        order_price: 68200,
        stoploss_price: 65000,
        takeprofit_price: 72000,
        stoploss_order_id: 'sl-1',
        takeprofit_order_id: 'tp-1',
        trigger_type: 'mark_price',
        is_stoploss: true,
        is_takeprofit: true,
      },
      'user-1',
      'mudrex',
      'acc-1'
    );
    await service.closePositionPartial(
      'pos-1',
      {
        order_type: 'market',
        quantity: '0.1',
        limit_price: '0',
      },
      'user-1',
      'mudrex',
      'acc-1'
    );
    await service.closePosition('pos-1', 'user-1', 'mudrex', 'acc-1');

    await assert.rejects(
      () => service.reversePosition('pos-1', 'user-1', 'mudrex', 'acc-1'),
      (error: unknown) => error instanceof Error && error.message === 'Mudrex rejected reverse'
    );

    assert.equal(loggedEvents.length, 6);
    assert.equal(emittedAlerts.length, 1);

    const addMarginLog = loggedEvents[0];
    assert.equal(addMarginLog.userId, 'user-1');
    assert.equal(addMarginLog.payload.title, 'Margin added: pos-1');
    assert.equal(addMarginLog.payload.related, 'mudrex · acc-1');
    assert.equal(addMarginLog.payload.referenceId, 'pos-1');
    assert.equal(addMarginLog.payload.correlationId, 'mudrex · acc-1');
    assert.equal(addMarginLog.payload.symbol, 'BTCUSDT');
    assert.equal(addMarginLog.payload.description, 'Position margin updated');
    assert.deepEqual(
      ((addMarginLog.payload.flags as Array<Record<string, unknown>>) || []).map((item) => [
        item.id,
        item.channel,
        item.status,
      ]),
      [
        ['route', 'Route', 'Success'],
        ['position', 'Context', 'Success'],
        ['request-1', 'Request', 'Success'],
        ['result-1', 'Result', 'Success'],
        ['result-2', 'Result', 'Success'],
      ]
    );
    assert.equal(
      ((addMarginLog.payload.flags as Array<Record<string, unknown>>) || [])[2]?.message,
      'Margin +250'
    );
    assert.equal(
      ((addMarginLog.payload.flags as Array<Record<string, unknown>>) || [])[4]?.message,
      'Liquidation 61000'
    );

    const partialCloseLog = loggedEvents[3];
    assert.equal(partialCloseLog.payload.title, 'Position partially closed: pos-1');
    assert.equal(
      ((partialCloseLog.payload.flags as Array<Record<string, unknown>>) || []).some(
        (item) => item.message === 'Quantity 0.1'
      ),
      true
    );
    assert.equal(
      ((partialCloseLog.payload.flags as Array<Record<string, unknown>>) || []).some(
        (item) => item.message === 'Broker acknowledged the request'
      ),
      true
    );

    const failedReverseLog = loggedEvents[5];
    assert.equal(failedReverseLog.payload.title, 'Reverse position failed');
    assert.equal(failedReverseLog.payload.status, 'Failed');
    assert.equal(failedReverseLog.payload.related, 'mudrex · acc-1');
    assert.equal(failedReverseLog.payload.correlationId, 'mudrex · acc-1');
    assert.equal(
      ((failedReverseLog.payload.flags as Array<Record<string, unknown>>) || []).some(
        (item) => item.id === 'error' && item.message === 'Mudrex rejected reverse'
      ),
      true
    );

    assert.equal(emittedAlerts[0].userId, 'user-1');
    assert.equal(emittedAlerts[0].payload.source, 'mudrex');
    assert.equal(emittedAlerts[0].payload.symbol, 'BTCUSDT');
    assert.equal(
      emittedAlerts[0].payload.message,
      'Reverse position failed (pos-1): Mudrex rejected reverse'
    );

    console.log('Positions phase 8 assertions passed.');
  }

  await run();
}

async function positionsGuard09(): Promise<void> {
  const { PositionReadModelRepository } =
    await import('../src/database/repositories/PositionReadModelRepository');
  const { DataSource } = await import('typeorm');

  async function run(): Promise<void> {
    const repository = new PositionReadModelRepository();
    const originalQuery = DataSource.prototype.query;
    const capturedCalls: Array<{ sql: string; params: unknown[] }> = [];

    (DataSource.prototype as any).query = async (sql: string, params: unknown[] = []) => {
      capturedCalls.push({ sql, params });

      if (sql.includes('COUNT(*) AS openPositions')) {
        return [
          {
            accountId: 'acc-1',
            openPositions: '2',
            grossExposure: '18500',
            longExposure: '12000',
            shortExposure: '6500',
            unrealizedPnl: '420.5',
            latestObservedAt: '2026-04-09T11:59:00.000Z',
            oldestObservedAt: '2026-04-09T11:40:00.000Z',
          },
          {
            accountId: 'acc-2',
            openPositions: '1',
            grossExposure: '4300',
            longExposure: '4300',
            shortExposure: '0',
            unrealizedPnl: '-35.25',
            latestObservedAt: '2026-04-09T11:57:00.000Z',
            oldestObservedAt: '2026-04-09T11:57:00.000Z',
          },
        ];
      }

      if (sql.includes('COUNT(*) AS total')) {
        return [
          {
            total: '3',
            latestObservedAt: '2026-04-09T11:59:00.000Z',
            oldestObservedAt: '2026-04-09T11:40:00.000Z',
          },
        ];
      }

      if (
        sql.includes(
          'ORDER BY COALESCE(last_seen_at, position_updated_at, position_created_at) DESC'
        )
      ) {
        return [
          {
            userId: 'user-1',
            accountId: 'acc-1',
            brokerKey: 'mudrex',
            externalId: 'pos-2',
            symbol: 'ETHUSDT',
            side: 'Long',
            sideKey: 'long',
            sideRaw: 'long',
            status: 'Open',
            statusKey: 'open',
            statusRaw: 'open',
            statusRank: 1,
            quantity: '1.5',
            entryPrice: '3300',
            currentPrice: '3360',
            unrealizedPnl: '90',
            leverage: '5',
            exposure: '4950',
            positionCreatedAt: '2026-04-09T10:00:00.000Z',
            positionUpdatedAt: '2026-04-09T11:30:00.000Z',
            lastSeenAt: '2026-04-09T11:58:00.000Z',
            payloadJson: JSON.stringify({
              symbol: 'ETHUSDT',
              side: 'buy',
              quantity: '1.5',
              entry_price: '3300',
              current_price: '3360',
              status: 'open',
              updated_at: '2026-04-09T11:30:00.000Z',
            }),
          },
          {
            userId: 'user-1',
            accountId: 'acc-1',
            brokerKey: 'mudrex',
            externalId: 'pos-1',
            symbol: 'BTCUSDT',
            side: 'Long',
            sideKey: 'long',
            sideRaw: 'long',
            status: 'Open',
            statusKey: 'open',
            statusRaw: 'open',
            statusRank: 1,
            quantity: '0.2',
            entryPrice: '70000',
            currentPrice: '70500',
            unrealizedPnl: '100',
            leverage: '10',
            exposure: '14000',
            positionCreatedAt: '2026-04-09T09:00:00.000Z',
            positionUpdatedAt: '2026-04-09T11:15:00.000Z',
            lastSeenAt: '2026-04-09T11:59:00.000Z',
            payloadJson: JSON.stringify({
              symbol: 'BTCUSDT',
              side: 'buy',
              quantity: '0.2',
              entry_price: '70000',
              current_price: '70500',
              status: 'open',
              updated_at: '2026-04-09T11:15:00.000Z',
            }),
          },
        ];
      }

      if (sql.includes('FROM suggested_trade_executions execution_row')) {
        if (sql.includes("COALESCE(execution_row.position_id, '') IN")) {
          return [
            {
              suggestedTradeId: 'trade-eth-cancelled',
              automationId: 'automation-old',
              automationRunId: 'run-old',
              timeframe: '15m',
              signalTime: '2026-04-08T09:45:00.000Z',
              side: 'BUY',
              symbol: 'ETHUSDT',
              sourceTemplateId: 'template-old',
              sourceBacktestId: 'backtest-old',
              brokerKey: 'mudrex',
              accountId: 'acc-1',
              positionId: 'pos-2',
              orderId: 'order-eth-cancelled',
              orderType: 'limit',
              triggerType: 'GTC',
              entryPrice: '3300',
              filledPrice: null,
              submittedAt: '2026-04-09T10:05:00.000Z',
              filledAt: null,
              executionState: 'cancelled',
              positionStatus: 'OPEN',
              protectionState: 'not_required',
              protectionSource: 'suggested_trade_execution',
              protectionAttempts: 0,
              protectionLastError: null,
              protectionCheckedAt: null,
              protectionAttachedAt: null,
              protectionStopLossPrice: null,
              protectionTakeProfitPrice: null,
              protectionStopLossOrderId: null,
              protectionTakeProfitOrderId: null,
              traceMethod: 'position_id',
            },
            {
              suggestedTradeId: 'trade-eth',
              automationId: 'automation-15m',
              automationRunId: 'run-15m',
              timeframe: '15m',
              signalTime: '2026-04-09T09:45:00.000Z',
              side: 'BUY',
              symbol: 'ETHUSDT',
              sourceTemplateId: 'template-1',
              sourceBacktestId: 'backtest-1',
              brokerKey: 'mudrex',
              accountId: 'acc-1',
              positionId: 'pos-2',
              orderId: 'order-eth',
              orderType: 'limit',
              triggerType: 'GTC',
              entryPrice: '3300',
              filledPrice: '3300',
              submittedAt: '2026-04-09T09:58:00.000Z',
              filledAt: '2026-04-09T10:00:00.000Z',
              executionState: 'filled',
              positionStatus: 'OPEN',
              routeAttempts: JSON.stringify([
                {
                  attemptNumber: 1,
                  candidateRank: 1,
                  brokerKey: 'mudrex',
                  accountId: 'acc-1',
                  accountName: 'Mudrex Prod',
                  requestedSymbol: 'ETHUSDT',
                  brokerSymbol: 'ETHUSDT',
                  status: 'placed',
                  startedAt: '2026-04-09T09:57:30.000Z',
                  finishedAt: '2026-04-09T09:58:00.000Z',
                  submissionState: 'accepted',
                  orderId: 'order-eth',
                  orderStatus: 'FILLED',
                },
              ]),
              protectionState: 'attached',
              protectionSource: 'suggested_trade_execution',
              protectionAttempts: 1,
              protectionLastError: null,
              protectionCheckedAt: '2026-04-09T10:02:00.000Z',
              protectionAttachedAt: '2026-04-09T10:02:00.000Z',
              protectionStopLossPrice: '3234',
              protectionTakeProfitPrice: '3432',
              protectionAttachedStopLossPrice: '3234.5',
              protectionAttachedTakeProfitPrice: '3432.5',
              protectionReplacementSubmittedAt: '2026-04-09T10:01:30.000Z',
              protectionStopLossOrderId: 'sl-eth',
              protectionTakeProfitOrderId: 'tp-eth',
              traceMethod: 'position_id',
            },
          ];
        }

        return [
          {
            suggestedTradeId: 'trade-btc',
            automationId: 'automation-5m',
            automationRunId: 'run-5m',
            timeframe: '5m',
            signalTime: '2026-04-09T08:55:00.000Z',
            side: 'BUY',
            symbol: 'BTCUSDT',
            sourceTemplateId: 'template-2',
            sourceBacktestId: 'backtest-2',
            brokerKey: 'mudrex',
            accountId: 'acc-1',
            positionId: null,
            orderId: 'order-btc',
            orderType: 'limit',
            triggerType: 'GTC',
            entryPrice: '70000',
            filledPrice: '70000',
            submittedAt: '2026-04-09T08:59:00.000Z',
            filledAt: '2026-04-09T09:00:00.000Z',
            executionState: 'filled',
            positionStatus: 'OPEN',
            protectionState: 'failed',
            protectionSource: 'suggested_trade_execution',
            protectionAttempts: 1,
            protectionLastError: 'Mudrex protection remediation failed: position not found',
            protectionCheckedAt: '2026-04-09T09:02:00.000Z',
            protectionAttachedAt: null,
            protectionStopLossPrice: '68600',
            protectionTakeProfitPrice: '72100',
            protectionStopLossOrderId: null,
            protectionTakeProfitOrderId: null,
            traceMethod: 'symbol_entry',
          },
        ];
      }

      throw new Error(`Unexpected positions read-model query: ${sql}`);
    };

    try {
      const unmatchedRecord = {
        created_at: '2026-04-09T12:34:00.000Z',
        positionSummary: {
          createdAt: '2026-04-09T12:34:00.000Z',
        },
      } as any;

      (repository as any).applySuggestedTradeContext(unmatchedRecord, null);
      assert.equal(unmatchedRecord.entryFilledAt, '2026-04-09T12:34:00.000Z');
      assert.equal(unmatchedRecord.positionSummary.entryFilledAt, '2026-04-09T12:34:00.000Z');

      const summary = await repository.getOpenPositionSummaryForAccounts('user-1', [
        'acc-1',
        'acc-2',
      ]);
      assert.equal(summary.size, 2);
      assert.deepEqual(summary.get('acc-1'), {
        accountId: 'acc-1',
        openPositions: 2,
        grossExposure: 18500,
        longExposure: 12000,
        shortExposure: 6500,
        unrealizedPnl: 420.5,
        latestObservedAt: new Date('2026-04-09T11:59:00.000Z'),
        oldestObservedAt: new Date('2026-04-09T11:40:00.000Z'),
      });
      assert.equal(summary.get('acc-2')?.openPositions, 1);
      assert.equal(summary.get('acc-2')?.shortExposure, 0);

      const overview = await repository.listLivePositionsOverview('user-1', ['acc-1', 'acc-2'], {
        limit: 2,
        offset: 1,
        brokerKey: 'mudrex',
        sideKey: 'long',
      });

      assert.equal(overview.total, 3);
      assert.equal(overview.latestObservedAt?.toISOString(), '2026-04-09T11:59:00.000Z');
      assert.equal(overview.oldestObservedAt?.toISOString(), '2026-04-09T11:40:00.000Z');
      assert.equal(overview.items.length, 2);
      assert.equal(overview.items[0].id, 'pos-2');
      assert.equal(overview.items[0].accountId, 'acc-1');
      assert.equal(overview.items[0].brokerKey, 'mudrex');
      assert.equal(overview.items[0].positionSummary?.exposure, 4950);
      assert.equal(overview.items[0].timeframe, '15m');
      assert.equal(overview.items[0].entryOrderType, 'limit');
      assert.equal(overview.items[0].automationTrade?.traceMethod, 'position_id');
      assert.equal(overview.items[0].positionSummary?.entryFilledAt, '2026-04-09T10:00:00.000Z');
      assert.equal(overview.items[0].executionProtection?.state, 'attached');
      assert.equal(overview.items[0].executionProtection?.plannedStopLossPrice, 3234);
      assert.equal(overview.items[0].executionProtection?.stopLossPrice, 3234.5);
      assert.equal(
        overview.items[0].executionProtection?.replacementSubmittedAt,
        '2026-04-09T10:01:30.000Z'
      );
      assert.equal(overview.items[0].executionProtection?.stopLossOrderId, 'sl-eth');
      assert.equal(overview.items[0].positionSummary?.executionProtection?.takeProfitPrice, 3432.5);
      assert.equal(overview.items[0].automationTrade?.routeAttempts?.[0]?.brokerKey, 'mudrex');
      assert.equal(
        overview.items[0].automationTrade?.operatorTimeline?.some(
          (event: { kind: string; label: string; status?: string | null }) =>
            event.kind === 'broker_route' &&
            event.label === 'Broker route 1 placed' &&
            event.status === 'placed'
        ),
        true
      );
      assert.equal(
        overview.items[0].automationTrade?.operatorTimeline?.some(
          (event: { kind: string; label: string }) =>
            event.kind === 'protection' && event.label === 'Protection attached'
        ),
        true
      );
      assert.equal(
        overview.items[0].automationTrade?.operatorTimeline?.some(
          (event: { kind: string; label: string; occurredAt: string }) =>
            event.kind === 'protection' &&
            event.label === 'Protection repair submitted' &&
            event.occurredAt === '2026-04-09T10:01:30.000Z'
        ),
        true
      );
      assert.equal(overview.items[1].id, 'pos-1');
      assert.equal(overview.items[1].positionSummary?.unrealizedPnl, 100);
      assert.equal(overview.items[1].timeframe, '5m');
      assert.equal(overview.items[1].tradeContextSource, 'symbol_entry');
      assert.equal(overview.items[1].suggestedTradeId, 'trade-btc');
      assert.equal(overview.items[1].automationTrade?.protection?.state, 'failed');
      assert.match(
        String(overview.items[1].executionProtection?.lastError || ''),
        /position not found/
      );

      const summaryCall = capturedCalls.find((call) =>
        call.sql.includes('COUNT(*) AS openPositions')
      );
      assert.deepEqual(summaryCall?.params, ['user-1', 'acc-1', 'acc-2']);

      const overviewAggregateCall = capturedCalls.find((call) =>
        call.sql.includes('COUNT(*) AS total')
      );
      assert.deepEqual(overviewAggregateCall?.params, [
        'user-1',
        'acc-1',
        'acc-2',
        'mudrex',
        'long',
      ]);

      const overviewRowsCall = capturedCalls.find((call) =>
        call.sql.includes(
          'ORDER BY COALESCE(last_seen_at, position_updated_at, position_created_at) DESC'
        )
      );
      assert.deepEqual(overviewRowsCall?.params, [
        'user-1',
        'acc-1',
        'acc-2',
        'mudrex',
        'long',
        2,
        1,
      ]);

      console.log('Positions phase 9 assertions passed.');
    } finally {
      DataSource.prototype.query = originalQuery;
    }
  }

  await run();
}

async function positionsGuard10(): Promise<void> {
  const { DeltaExchangePositionsAdapter } =
    await import('../src/brokers/capabilities/positions/DeltaExchangePositionsAdapter');

  async function run(): Promise<void> {
    const adapter = new DeltaExchangePositionsAdapter() as any;
    const capturedQueries: Array<{
      accountId: string;
      path: string;
      query: Record<string, unknown>;
      userId: string;
    }> = [];

    adapter.deltaHttpClient = {
      async publicGet(path: string) {
        assert.equal(path, '/v2/products');
        return [
          {
            id: '123',
            symbol: 'BTCUSD',
            contract_value: '0.001',
            contract_unit_currency: 'BTC',
          },
          {
            id: '456',
            symbol: 'ETHUSD',
            contract_value: '0.01',
            contract_unit_currency: 'ETH',
          },
        ];
      },
      async signedGetEnvelope(
        accountId: string,
        path: string,
        query: Record<string, unknown>,
        userId: string
      ) {
        capturedQueries.push({ accountId, path, query, userId });
        if (!query.after) {
          return {
            success: true,
            result: [
              {
                id: 'fill-btc-open',
                product_id: '123',
                product_symbol: 'BTCUSD',
                side: 'buy',
                size: '1',
                price: '100',
                created_at: '2026-04-10T00:00:00.000Z',
              },
              {
                id: 'fill-btc-close',
                product_id: '123',
                product_symbol: 'BTCUSD',
                side: 'sell',
                size: '1',
                price: '120',
                created_at: '2026-04-10T01:00:00.000Z',
              },
              {
                id: 'fill-eth-open',
                product_id: '456',
                product_symbol: 'ETHUSD',
                side: 'buy',
                size: '2',
                price: '50',
                created_at: '2026-04-10T02:00:00.000Z',
              },
            ],
            meta: { after: 'cursor-2' },
          };
        }
        return {
          success: true,
          result: [
            {
              id: 'fill-eth-close',
              product_id: '456',
              product_symbol: 'ETHUSD',
              side: 'sell',
              size: '2',
              price: '55',
              created_at: '2026-04-10T03:00:00.000Z',
            },
          ],
          meta: { after: null },
        };
      },
      async signedGet() {
        return [
          {
            product_id: '123',
            product_symbol: 'BTCUSD',
            size: '1',
            entry_price: '100',
            mark_price: '110',
            margin: '0.01',
            liquidation_price: '50',
            leverage: undefined,
            created_at: '2026-04-10T00:00:00.000Z',
            updated_at: '2026-04-10T00:05:00.000Z',
          },
        ];
      },
    };

    const history = await adapter.getPositionHistory(
      {
        startDate: '2026-04-10',
        endDate: '2026-04-14',
        limit: '10',
      },
      {
        userId: 'user-1',
        accountId: 'account-1',
        brokerKey: 'delta_exchange',
      }
    );

    assert.equal(Array.isArray(history), true);
    assert.equal(history.length, 2);
    assert.equal(history[0].symbol, 'ETHUSD');
    assert.equal(history[0].status, 'closed');
    assert.equal(history[0].closed_price, '55');
    assert.equal(history[0].quantity, '0.02');
    assert.equal(history[0].quantity_contracts, '2');
    assert.equal(history[0].base_quantity, '0.02');
    assert.equal(history[0].contract_value, '0.01');
    assert.equal(history[0].contract_unit_currency, 'ETH');
    assert.equal(Math.abs(Number(history[0].pnl) - 0.1) < 1e-12, true);
    assert.equal(history[1].symbol, 'BTCUSD');
    assert.equal(history[1].closed_price, '120');
    assert.equal(history[1].quantity, '0.001');
    assert.equal(history[1].quantity_contracts, '1');
    assert.equal(history[1].base_quantity, '0.001');
    assert.equal(history[1].contract_value, '0.001');
    assert.equal(history[1].contract_unit_currency, 'BTC');
    assert.equal(Math.abs(Number(history[1].pnl) - 0.02) < 1e-12, true);

    assert.equal(capturedQueries.length, 2);
    assert.equal(capturedQueries[0].path, '/v2/fills');
    assert.equal(capturedQueries[0].query.page_size, 50);
    assert.equal(capturedQueries[0].query.contract_types, 'perpetual_futures');
    assert.equal(
      capturedQueries[0].query.start_time,
      Date.parse('2026-04-10T00:00:00.000Z') * 1000
    );
    assert.equal(capturedQueries[0].query.end_time, Date.parse('2026-04-14T23:59:59.999Z') * 1000);
    assert.equal(capturedQueries[1].query.after, 'cursor-2');

    const positions = await adapter.getPositions({} as any, {
      userId: 'user-1',
      accountId: 'account-1',
      brokerKey: 'delta_exchange',
    });

    assert.equal(Array.isArray(positions), true);
    assert.equal(positions.length, 1);
    assert.equal(positions[0].symbol, 'BTCUSD');
    assert.equal(positions[0].leverage, '10');
    assert.equal(positions[0].position_leverage, '10');
    assert.equal(positions[0].derived_position_leverage, '10');
    assert.equal(positions[0].observed_position_leverage, undefined);
    assert.equal(positions[0].leverage_calculation_basis, 'entry_notional_over_margin');
    assert.equal(positions[0].leverage_source, 'derived_position_margin');

    adapter.deltaHttpClient = {
      ...adapter.deltaHttpClient,
      async signedGet() {
        return [
          {
            product_id: '123',
            product_symbol: 'BTCUSD',
            size: '1',
            entry_price: '100',
            mark_price: '110',
            liquidation_price: '50',
            leverage: '12',
            created_at: '2026-04-10T00:00:00.000Z',
            updated_at: '2026-04-10T00:05:00.000Z',
          },
        ];
      },
    };

    const leveragedPositions = await adapter.getPositions({} as any, {
      userId: 'user-1',
      accountId: 'account-1',
      brokerKey: 'delta_exchange',
    });

    assert.equal(leveragedPositions[0].leverage, '12');
    assert.equal(leveragedPositions[0].position_leverage, '12');
    assert.equal(leveragedPositions[0].observed_position_leverage, '12');
    assert.equal(leveragedPositions[0].leverage_source, 'broker_position');

    console.log('Positions phase 10 assertions passed.');
  }

  await run();
}

async function positionsGuard11(): Promise<void> {
  const { PaperTradingWorkspaceService } =
    await import('../src/api/services/PaperTradingWorkspaceService');

  async function run(): Promise<void> {
    const service = new PaperTradingWorkspaceService() as any;
    const syncCalls: Array<{ userId: string; brokerKey?: string; accountId?: string }> = [];

    service.syncUserReadModel = async (
      userId: string,
      options: { brokerKey?: string; accountId?: string } = {}
    ) => {
      syncCalls.push({
        userId,
        brokerKey: options.brokerKey,
        accountId: options.accountId,
      });
    };
    service.userTimeZoneService = {
      resolveUserTimeZone: async () => 'UTC',
    };
    service.paperTradingReadModelRepository = {
      listAccounts: async () => [
        {
          id: 'paper-account-1',
          userId: 'user-1',
          brokerKey: 'mudrex',
          linkedAccountId: 'account-1',
          accountName: 'Mudrex Paper',
          accountKey: 'mudrex-paper',
          accountStatus: 'Connected',
          label: 'Mudrex Paper',
          baseCurrency: 'USD',
          startingBalance: 100000,
          cashBalance: 100000,
          equity: 99965.05,
          usedMargin: 104.38,
          availableMargin: 99860.67,
          openPositions: 1,
          closedPositions: 0,
          realizedPnl: 0,
          unrealizedPnl: -34.95,
          observedAt: new Date('2026-04-23T13:42:00.000Z'),
        },
      ],
      listPositions: async (_userId: string, options: Record<string, unknown>) => {
        assert.equal(options.statusKey, 'open');
        assert.equal(options.brokerKey, 'mudrex');
        assert.equal(options.limit, 5);
        return [
          {
            id: 'paper-position-1',
            userId: 'user-1',
            paperAccountId: 'paper-account-1',
            paperOrderId: 'paper-order-1',
            suggestedTradeId: null,
            brokerKey: 'mudrex',
            linkedAccountId: 'account-1',
            accountName: 'Mudrex Paper',
            accountKey: 'mudrex-paper',
            accountStatus: 'Connected',
            symbol: 'SOLUSDT',
            side: 'Long',
            sideKey: 'long',
            status: 'Open',
            statusKey: 'open',
            executionState: 'filled',
            quantity: 18.3,
            entryPrice: 87.47,
            currentPrice: 85.56,
            exitPrice: null,
            stopLossPrice: 0,
            takeProfitPrice: 0,
            leverage: 15,
            liquidationPrice: 82.05,
            exposure: 1565.748,
            unrealizedPnl: -34.95,
            realizedPnl: null,
            outcome: null,
            closeReason: null,
            observationSource: 'candles',
            payload: null,
            createdAt: new Date('2026-04-23T03:12:00.000Z'),
            openedAt: new Date('2026-04-23T03:12:00.000Z'),
            updatedAt: new Date('2026-04-23T13:42:00.000Z'),
            closedAt: null,
            firstSeenAt: new Date('2026-04-23T03:12:00.000Z'),
            lastSeenAt: new Date('2026-04-23T13:42:00.000Z'),
          },
        ];
      },
    };

    const response = (await service.getPaperPositionsForActiveAccounts('user-1', 'mudrex', {
      limit: '5',
    })) as any;

    assert.equal(syncCalls.length, 1);
    assert.deepEqual(syncCalls[0], {
      userId: 'user-1',
      brokerKey: 'mudrex',
      accountId: undefined,
    });
    assert.equal(response.success, true);
    assert.equal(response.data.source, 'paper_position_read_models');
    assert.equal(response.data.totalActiveAccounts, 1);
    assert.equal(response.data.items[0].accountName, 'Mudrex Paper');
    assert.equal(response.data.items[0].positions.length, 1);
    assert.equal(response.data.items[0].data[0].mode, 'paper');
    assert.equal(response.data.items[0].data[0].symbol, 'SOLUSDT');
    assert.equal(response.data.items[0].data[0].entry_price, 87.47);
    assert.equal(response.data.items[0].freshness?.account?.source, 'paper_position_read_models');

    console.log('Positions phase 11 assertions passed.');
  }

  await run();
}

async function positionsGuard12(): Promise<void> {
  const { PaperTradingWorkspaceService } =
    await import('../src/api/services/PaperTradingWorkspaceService');

  const service = new PaperTradingWorkspaceService() as any;
  const syncCalls: Array<Record<string, unknown>> = [];
  const simulateCalls: Array<Record<string, unknown>> = [];
  const closeCalls: Array<Record<string, unknown>> = [];
  const suggestionSyncCalls: Array<Record<string, unknown>> = [];
  let closeLookupCount = 0;

  service.userTimeZoneService = {
    resolveUserTimeZone: async () => 'UTC',
  };
  service.syncUserReadModel = async (userId: string, options: Record<string, unknown> = {}) => {
    syncCalls.push({ userId, ...options });
  };
  service.paperOrderExecutionService = {
    simulateUserPaperOrders: async (userId: string, options: Record<string, unknown> = {}) => {
      simulateCalls.push({ userId, ...options });
      return {
        updatedOrderIds: ['paper-order-1'],
        updatedOrders: [{ userId, paperOrderId: 'paper-order-1' }],
        processedOrders: 1,
        distinctUsers: 1,
      };
    },
    closePaperOrderAtMarket: async (userId: string, paperOrderId: string) => {
      closeCalls.push({ userId, paperOrderId });
      return { id: paperOrderId };
    },
  };
  service.suggestedTradesService = {
    syncExecutionForPaperOrderUpdates: async (userId: string, paperOrderIds: string[]) => {
      suggestionSyncCalls.push({ userId, paperOrderIds });
      return paperOrderIds.length;
    },
  };
  service.paperTradingReadModelRepository = {
    getPositionById: async (_userId: string, positionId: string) => {
      closeLookupCount += 1;
      return {
        id: positionId,
        userId: 'user-1',
        paperAccountId: 'acc-1',
        paperOrderId: 'paper-order-1',
        suggestedTradeId: null,
        brokerKey: 'mudrex',
        linkedAccountId: 'acc-1',
        accountName: 'Mudrex Paper',
        accountKey: 'mudrex-paper',
        accountStatus: 'Connected',
        symbol: 'SOLUSDT',
        side: 'Long',
        sideKey: 'long',
        status: closeLookupCount > 1 ? 'Closed' : 'Open',
        statusKey: closeLookupCount > 1 ? 'closed' : 'open',
        executionState: closeLookupCount > 1 ? 'closed' : 'filled',
        quantity: 1.2,
        entryPrice: 87.47,
        currentPrice: 85.56,
        exitPrice: closeLookupCount > 1 ? 85.56 : null,
        stopLossPrice: 0,
        takeProfitPrice: 0,
        leverage: 4,
        liquidationPrice: 75,
        exposure: 102.672,
        unrealizedPnl: closeLookupCount > 1 ? 0 : -2.292,
        realizedPnl: closeLookupCount > 1 ? -2.292 : null,
        outcome: closeLookupCount > 1 ? 'loss' : null,
        closeReason: closeLookupCount > 1 ? 'manual-close' : null,
        observationSource: 'candle',
        payload: null,
        createdAt: new Date('2026-04-23T10:00:00.000Z'),
        openedAt: new Date('2026-04-23T10:00:00.000Z'),
        updatedAt: new Date('2026-04-23T10:05:00.000Z'),
        closedAt: closeLookupCount > 1 ? new Date('2026-04-23T10:05:00.000Z') : null,
        firstSeenAt: new Date('2026-04-23T10:00:00.000Z'),
        lastSeenAt: new Date('2026-04-23T10:05:00.000Z'),
      };
    },
  };

  const simulationResponse = (await service.runPaperSimulation('user-1', {
    brokerKey: 'mudrex',
    accountId: 'acc-1',
  })) as any;

  assert.equal(simulationResponse.success, true);
  assert.equal(simulationResponse.data.updatedOrders, 1);
  assert.equal(simulationResponse.data.brokerKey, 'mudrex');
  assert.equal(simulateCalls.length, 1);
  assert.deepEqual(simulateCalls[0], {
    userId: 'user-1',
    brokerKey: 'mudrex',
    accountId: 'acc-1',
  });
  assert.deepEqual(suggestionSyncCalls[0], {
    userId: 'user-1',
    paperOrderIds: ['paper-order-1'],
  });

  const closeResponse = (await service.closePaperPosition('user-1', 'paper-position-1')) as any;

  assert.equal(closeResponse.success, true);
  assert.equal(closeResponse.data.position.status, 'Closed');
  assert.equal(closeResponse.data.position.close_reason, 'manual-close');
  assert.deepEqual(closeCalls[0], {
    userId: 'user-1',
    paperOrderId: 'paper-order-1',
  });
  assert.equal(syncCalls.length, 3);
  assert.deepEqual(syncCalls[0], {
    userId: 'user-1',
    brokerKey: 'mudrex',
    accountId: 'acc-1',
    skipSimulation: true,
  });
  assert.deepEqual(syncCalls[1], {
    userId: 'user-1',
    skipSimulation: true,
  });
  assert.deepEqual(syncCalls[2], {
    userId: 'user-1',
    brokerKey: 'mudrex',
    accountId: 'acc-1',
    skipSimulation: true,
  });

  console.log('Positions phase 12 assertions passed.');
}

async function positionsGuard13(): Promise<void> {
  const { BrokerPositionsFacadeService } =
    await import('../src/api/services/BrokerPositionsFacadeService');

  const service: any = new BrokerPositionsFacadeService();
  const position = {
    id: 'mudrex:acc-1:2026-05-12T04:03:38Z:LONG',
    external_id: 'mudrex:acc-1:2026-05-12T04:03:38Z:LONG',
    externalId: 'mudrex:acc-1:2026-05-12T04:03:38Z:LONG',
    symbol: 'JSTUSDT',
    created_at: '2026-05-12T04:03:38.000Z',
    rawPayload: {
      id: '019e1a5a-c7df-796d-8a66-507104d017d2',
      symbol: 'JSTUSDT',
      position_type: 'long',
    },
    positionSummary: {
      id: 'mudrex:acc-1:2026-05-12T04:03:38Z:LONG',
      externalId: 'mudrex:acc-1:2026-05-12T04:03:38Z:LONG',
    },
  };

  const linkedOrder = service.mapRelatedLiveOrderSnapshot(
    {
      externalId: 'current-sl',
      symbol: 'JSTUSDT',
      orderStatus: 'OPEN',
      payload: JSON.stringify({
        id: 'current-sl',
        future_position_uuid: '019e1a5a-c7df-796d-8a66-507104d017d2',
        order_type: 'STOPLOSS',
        price: '0.08831',
      }),
      firstSeenAt: '2026-05-12T04:04:00.000Z',
      lastSeenAt: '2026-05-12T04:04:00.000Z',
    },
    position,
    []
  );
  assert.equal(linkedOrder.relation, 'position');
  assert.equal(linkedOrder.linkedPositionId, '019e1a5a-c7df-796d-8a66-507104d017d2');
  assert.equal(service.shouldIncludeRelatedLiveOrder(linkedOrder), true);

  const staleOrder = service.mapRelatedLiveOrderSnapshot(
    {
      externalId: 'old-sl',
      symbol: 'JSTUSDT',
      orderStatus: 'FILLED',
      payload: JSON.stringify({
        id: 'old-sl',
        future_position_uuid: '019e18cc-7894-7bba-a7af-5722c4eac3c5',
        order_type: 'STOPLOSS',
        price: '0.08726',
      }),
      firstSeenAt: '2026-05-11T20:48:34.000Z',
      lastSeenAt: '2026-05-11T20:48:34.000Z',
    },
    position,
    []
  );
  assert.equal(staleOrder.relation, 'symbol');
  assert.equal(service.shouldIncludeRelatedLiveOrder(staleOrder), false);

  const staleEntryOrder = service.mapRelatedLiveOrderSnapshot(
    {
      externalId: 'old-short-entry',
      symbol: 'JSTUSDT',
      orderStatus: 'FILLED',
      payload: JSON.stringify({
        id: 'old-short-entry',
        future_position_uuid: '019e18cc-7894-7bba-a7af-5722c4eac3c5',
        order_type: 'SHORT',
        price: '0.08723',
      }),
      firstSeenAt: '2026-05-11T20:48:34.000Z',
      lastSeenAt: '2026-05-12T04:20:00.000Z',
    },
    position,
    []
  );
  assert.equal(staleEntryOrder.relation, 'symbol');
  assert.equal(service.shouldIncludeRelatedLiveOrder(staleEntryOrder), false);

  const staleRiskOrder = service.mapRelatedLiveRiskOrderSnapshot(
    {
      orderId: 'old-tp',
      symbol: 'JSTUSDT',
      status: 'CREATED',
      side: 'SELL',
      orderType: 'TAKEPROFIT',
      orderPrice: 0.08496,
      reduceOnly: false,
      firstSeenAt: '2026-05-10T20:36:19.000Z',
      lastSeenAt: '2026-05-10T20:36:19.000Z',
    },
    []
  );
  assert.equal(staleRiskOrder.relation, 'symbol');
  assert.equal(service.shouldIncludeRelatedLiveOrder(staleRiskOrder), false);

  const trackedRiskOrder = service.mapRelatedLiveRiskOrderSnapshot(
    {
      orderId: 'current-tp',
      symbol: 'JSTUSDT',
      status: 'CREATED',
      side: 'SELL',
      orderType: 'TAKEPROFIT',
      orderPrice: 0.08859,
      reduceOnly: false,
      firstSeenAt: '2026-05-12T04:04:00.000Z',
      lastSeenAt: '2026-05-12T04:04:00.000Z',
    },
    ['current-tp']
  );
  assert.equal(trackedRiskOrder.relation, 'protection');
  assert.equal(service.shouldIncludeRelatedLiveOrder(trackedRiskOrder), true);

  assert.equal(
    service.getLifecycleWindowStart(position)?.toISOString(),
    '2026-05-11T22:03:38.000Z'
  );

  console.log('Positions phase 13 assertions passed.');
}

async function positionsGuard14(): Promise<void> {
  const { DeltaExchangePositionsAdapter } =
    await import('../src/brokers/capabilities/positions/DeltaExchangePositionsAdapter');

  const createAdapter = () => {
    const adapter = new DeltaExchangePositionsAdapter() as any;
    const postCalls: Array<{ accountId: string; path: string; body: Record<string, unknown> }> = [];
    const deleteCalls: Array<{ accountId: string; path: string; body: Record<string, unknown> }> =
      [];
    let nextCreatedOrderId = 701;
    let failCancelOldStop = false;

    adapter.deltaHttpClient = {
      async signedGet(
        accountId: string,
        path: string,
        _query: Record<string, unknown> | undefined,
        userId: string
      ) {
        assert.equal(accountId, 'delta-account-1');
        assert.equal(userId, 'user-1');
        if (path === '/v2/positions/margined') {
          return [
            {
              product_id: '123',
              product_symbol: 'BTCUSD',
              size: '2',
              entry_price: '100',
              mark_price: '116',
            },
          ];
        }
        if (path === '/v2/orders/501') {
          return {
            id: '501',
            product_id: '123',
            side: 'sell',
            stop_price: '102',
            stop_order_type: 'stop_loss_order',
            size: '2',
            state: 'pending',
            order_type: 'market_order',
            reduce_only: true,
          };
        }
        if (path === '/v2/orders/601') {
          return {
            id: '601',
            product_id: '123',
            side: 'sell',
            stop_price: '130',
            stop_order_type: 'take_profit_order',
            size: '2',
            state: 'pending',
            order_type: 'market_order',
            reduce_only: 'true',
          };
        }
        throw new Error(`Unexpected signedGet path ${path}`);
      },
      async signedPost(accountId: string, path: string, body: Record<string, unknown>) {
        postCalls.push({ accountId, path, body });
        return { id: String(nextCreatedOrderId++), state: 'pending' };
      },
      async signedDelete(accountId: string, path: string, body: Record<string, unknown>) {
        deleteCalls.push({ accountId, path, body });
        if (failCancelOldStop && body.id === 501) {
          throw new Error('cancel rejected');
        }
        return { success: true };
      },
    };

    return {
      adapter,
      postCalls,
      deleteCalls,
      setNextCreatedOrderId(value: number) {
        nextCreatedOrderId = value;
      },
      setFailCancelOldStop(value: boolean) {
        failCancelOldStop = value;
      },
    };
  };

  const context = {
    userId: 'user-1',
    brokerKey: 'delta_exchange',
    accountId: 'delta-account-1',
  };

  const success = createAdapter();
  const result = await success.adapter.updateRiskOrder(
    '123',
    {
      order_price: 100,
      stoploss_price: 110,
      takeprofit_price: 130,
      stoploss_order_id: '501',
      takeprofit_order_id: '601',
      trigger_type: 'MARKET',
      is_stoploss: true,
      is_takeprofit: true,
    },
    context
  );

  assert.equal(result.stop_loss_order_id, '701');
  assert.equal(result.take_profit_order_id, '601');
  assert.equal(success.postCalls.length, 1);
  assert.equal(success.postCalls[0].path, '/v2/orders');
  assert.equal(success.postCalls[0].body.product_id, 123);
  assert.equal(success.postCalls[0].body.size, 2);
  assert.equal(success.postCalls[0].body.side, 'sell');
  assert.equal(success.postCalls[0].body.stop_order_type, 'stop_loss_order');
  assert.equal(success.postCalls[0].body.stop_price, '110');
  assert.equal(success.postCalls[0].body.reduce_only, true);
  assert.equal(typeof success.postCalls[0].body.client_order_id, 'string');
  assert.deepEqual(success.deleteCalls, [
    { accountId: 'delta-account-1', path: '/v2/orders', body: { id: 501, product_id: 123 } },
  ]);

  const backward = createAdapter();
  await assert.rejects(
    () =>
      backward.adapter.updateRiskOrder(
        '123',
        {
          order_price: 100,
          stoploss_price: 101,
          takeprofit_price: 130,
          stoploss_order_id: '501',
          takeprofit_order_id: '601',
          trigger_type: 'MARKET',
          is_stoploss: true,
          is_takeprofit: true,
        },
        context
      ),
    (error: unknown) =>
      error instanceof Error && /cannot move stop-loss backward/i.test(error.message)
  );
  assert.equal(backward.postCalls.length, 0);
  assert.equal(backward.deleteCalls.length, 0);

  const rollback = createAdapter();
  rollback.setNextCreatedOrderId(801);
  rollback.setFailCancelOldStop(true);
  await assert.rejects(
    () =>
      rollback.adapter.updateRiskOrder(
        '123',
        {
          order_price: 100,
          stoploss_price: 111,
          takeprofit_price: 130,
          stoploss_order_id: '501',
          takeprofit_order_id: '601',
          trigger_type: 'MARKET',
          is_stoploss: true,
          is_takeprofit: true,
        },
        context
      ),
    (error: unknown) =>
      error instanceof Error && /could not cancel old stop-loss 501/i.test(error.message)
  );
  assert.deepEqual(rollback.deleteCalls, [
    { accountId: 'delta-account-1', path: '/v2/orders', body: { id: 501, product_id: 123 } },
    { accountId: 'delta-account-1', path: '/v2/orders', body: { id: 801, product_id: 123 } },
  ]);

  console.log('Positions phase 14 assertions passed.');
}

const suiteSteps = {
  '01': positionsGuard01,
  '04': positionsGuard04,
  '05': positionsGuard05,
  '06': positionsGuard06,
  '08': positionsGuard08,
  '09': positionsGuard09,
  '10': positionsGuard10,
  '11': positionsGuard11,
  '12': positionsGuard12,
  '13': positionsGuard13,
  '14': positionsGuard14,
} as const;

export async function runPositionsSuite(): Promise<void> {
  await runSuiteSteps('Positions module', 'scripts/test-positions.ts', [
    '01',
    '04',
    '05',
    '06',
    '08',
    '09',
    '10',
    '11',
    '12',
    '13',
    '14',
  ]);
}

function resolveRequestedStepArg(): string | null {
  const directArg = process.argv[2];
  return process.argv[3] ?? (/^\d+$/.test(String(directArg || '')) ? directArg : null);
}

async function runRequestedStep(requestedStep: string): Promise<void> {
  const step = suiteSteps[requestedStep as keyof typeof suiteSteps];
  if (!step) {
    throw new Error(`Unknown suite step: ${requestedStep}`);
  }
  await step();
}

const requestedStep = resolveRequestedStepArg();
const runPromise = requestedStep ? runRequestedStep(requestedStep) : runPositionsSuite();

runPromise.catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
