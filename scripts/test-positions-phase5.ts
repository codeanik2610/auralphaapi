import assert from 'node:assert/strict';
import { BrokerPositionsFacadeService } from '../src/api/services/BrokerPositionsFacadeService';
import { buildPositionRecordFromReadModelRow } from '../src/api/utils/positionsReadModel';
import { coreDataSource } from '../src/database/data-source';

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

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
