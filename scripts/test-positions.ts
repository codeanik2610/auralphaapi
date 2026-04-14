import assert from 'node:assert/strict';
import { runSuiteSteps } from './_support/run-script-suite';

// Consolidated module suite.

async function positionsGuard01(): Promise<void> {
  const { BrokerPositionsFacadeService } = await import("../src/api/services/BrokerPositionsFacadeService");
  const { buildPositionRecordFromReadModelRow } = await import("../src/api/utils/positionsReadModel");

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
  const { BrokerPositionsFacadeService } = await import("../src/api/services/BrokerPositionsFacadeService");
  const { buildPositionReadModelUpsert, buildPositionRecordFromReadModelRow, } = await import("../src/api/utils/positionsReadModel");
  const { PositionSnapshotRepository } = await import("../src/database/repositories/PositionSnapshotRepository");

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
  const { BrokerPositionsFacadeService } = await import("../src/api/services/BrokerPositionsFacadeService");
  const { buildPositionRecordFromReadModelRow } = await import("../src/api/utils/positionsReadModel");
  const { coreDataSource } = await import("../src/database/data-source");

async function run(): Promise<void> {
  const service: any = new BrokerPositionsFacadeService();
  const originalQuery = coreDataSource.query.bind(coreDataSource);
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

  coreDataSource.query = (async (sql: string) => {
    if (sql.includes('FROM scheduler_orders_snapshots')) {
      return [
        {
          externalId: 'sl-1',
          symbol: 'BTCUSDT',
          orderStatus: 'OPEN',
          statusRank: 1,
          payload: JSON.stringify({
            id: 'sl-1',
            symbol: 'BTCUSDT',
            side: 'SELL',
            order_type: 'stop_market',
            trigger_type: 'mark_price',
            quantity: '0.25',
            order_price: '65500',
            reduce_only: true,
            position_id: 'pos-1',
            created_at: '2026-04-09T09:01:00.000Z',
            updated_at: '2026-04-09T11:05:00.000Z',
          }),
          firstSeenAt: '2026-04-09T09:01:00.000Z',
          lastSeenAt: '2026-04-09T11:05:00.000Z',
        },
      ];
    }
    return originalQuery(sql);
  }) as typeof coreDataSource.query;

  try {
    const response = await service.getPositionLifecycle('user-1', 'pos-1', 'mudrex', 'acc-1');

    assert.equal(response.position.id, 'pos-1');
    assert.equal(response.account?.id, 'acc-1');
    assert.equal(response.account?.isDefault, true);
    assert.equal(response.summary.relatedOrders, 2);
    assert.equal(response.summary.openAlerts, 1);
    assert.equal(response.summary.linkedSuggestedTrades, 2);
    assert.equal(response.summary.recentActivity, 1);
    assert.equal(response.position.freshness?.state, 'fresh');
    assert.equal(response.freshness?.position?.state, 'fresh');
    assert.equal(response.freshness?.account?.state, 'fresh');
    assert.equal(response.freshness?.warning, null);
    assert.equal(response.relatedOrders[0].id, 'sl-1');
    assert.equal(
      response.relatedOrders.some((item: { id: string; relation: string }) => item.id === 'sl-1' && item.relation === 'position'),
      true
    );
    assert.equal(
      response.relatedOrders.some((item: { id: string }) => item.id === 'paper-1'),
      true
    );
    assert.equal(response.relatedAlerts[0].id, 'alert-1');
    assert.equal(response.relatedSuggestedTrades[0].id, 'trade-1');
    assert.equal(response.relatedSuggestedTrades[0].linkedPositionId, 'pos-1');
    assert.equal(
      response.relatedLinks.some((item: { entity: string; id: string }) => item.entity === 'account' && item.id === 'acc-1'),
      true
    );
    assert.equal(
      response.relatedLinks.some((item: { entity: string; id: string }) => item.entity === 'strategy_template' && item.id === 'template-1'),
      true
    );
    assert.equal(response.recentActivity[0].id, 'act-1');

    console.log('Positions phase 5 assertions passed.');
  } finally {
    Date.now = originalNow;
    coreDataSource.query = originalQuery;
  }
}

  await run();
}

async function positionsGuard06(): Promise<void> {
  const { BrokerPositionsFacadeService } = await import("../src/api/services/BrokerPositionsFacadeService");
  const { buildPositionRecordFromReadModelRow } = await import("../src/api/utils/positionsReadModel");

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

  await run();
}

async function positionsGuard08(): Promise<void> {
  const { BrokerPositionsFacadeService } = await import("../src/api/services/BrokerPositionsFacadeService");

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

  await service.addPositionMargin(
    'pos-1',
    { margin: 250 },
    'user-1',
    'mudrex',
    'acc-1'
  );
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
  const { PositionReadModelRepository } = await import("../src/database/repositories/PositionReadModelRepository");
  const { coreDataSource } = await import("../src/database/data-source");

async function run(): Promise<void> {
  const repository = new PositionReadModelRepository();
  const originalQuery = coreDataSource.query.bind(coreDataSource);
  const capturedCalls: Array<{ sql: string; params: unknown[] }> = [];

  (coreDataSource as any).query = async (sql: string, params: unknown[] = []) => {
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

    if (sql.includes('ORDER BY COALESCE(last_seen_at, position_updated_at, position_created_at) DESC')) {
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

    return originalQuery(sql, params);
  };

  try {
    const summary = await repository.getOpenPositionSummaryForAccounts('user-1', ['acc-1', 'acc-2']);
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

    const overview = await repository.listLivePositionsOverview(
      'user-1',
      ['acc-1', 'acc-2'],
      {
        limit: 2,
        offset: 1,
        brokerKey: 'mudrex',
        sideKey: 'long',
      }
    );

    assert.equal(overview.total, 3);
    assert.equal(overview.latestObservedAt?.toISOString(), '2026-04-09T11:59:00.000Z');
    assert.equal(overview.oldestObservedAt?.toISOString(), '2026-04-09T11:40:00.000Z');
    assert.equal(overview.items.length, 2);
    assert.equal(overview.items[0].id, 'pos-2');
    assert.equal(overview.items[0].accountId, 'acc-1');
    assert.equal(overview.items[0].brokerKey, 'mudrex');
    assert.equal(overview.items[0].positionSummary?.exposure, 4950);
    assert.equal(overview.items[1].id, 'pos-1');
    assert.equal(overview.items[1].positionSummary?.unrealizedPnl, 100);

    const summaryCall = capturedCalls.find((call) => call.sql.includes('COUNT(*) AS openPositions'));
    assert.deepEqual(summaryCall?.params, ['user-1', 'acc-1', 'acc-2']);

    const overviewAggregateCall = capturedCalls.find((call) => call.sql.includes('COUNT(*) AS total'));
    assert.deepEqual(overviewAggregateCall?.params, ['user-1', 'acc-1', 'acc-2', 'mudrex', 'long']);

    const overviewRowsCall = capturedCalls.find((call) => call.sql.includes('ORDER BY COALESCE(last_seen_at, position_updated_at, position_created_at) DESC'));
    assert.deepEqual(overviewRowsCall?.params, ['user-1', 'acc-1', 'acc-2', 'mudrex', 'long', 2, 1]);

    console.log('Positions phase 9 assertions passed.');
  } finally {
    (coreDataSource as any).query = originalQuery;
  }
}

  await run();
}

const suiteSteps = {
  "01": positionsGuard01,
  "04": positionsGuard04,
  "05": positionsGuard05,
  "06": positionsGuard06,
  "08": positionsGuard08,
  "09": positionsGuard09,
} as const;

export async function runPositionsSuite(): Promise<void> {
  await runSuiteSteps("Positions module", "scripts/test-positions.ts", ["01", "04", "05", "06", "08", "09"]);
  console.log("Positions module assertions passed.");
}

async function runRequestedStep(): Promise<void> {
  const requestedStep = process.argv[3];
  if (!requestedStep) {
    return;
  }
  const step = suiteSteps[requestedStep as keyof typeof suiteSteps];
  if (!step) {
    throw new Error(`Unknown suite step: ${requestedStep}`);
  }
  await step();
}

if (process.argv[3]) {
  runRequestedStep().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : error);
    process.exit(1);
  });
}
