import assert from 'node:assert/strict';
import { BrokerCanaryProtectionMonitorService } from '../src/api/services/BrokerCanaryProtectionMonitorService';
import { coreDataSource } from '../src/database/data-source';
import { env } from '../src/env';

type QueryHandler = (sql: string, params?: unknown[]) => Promise<unknown[]>;

function createCandidate(overrides: Record<string, unknown> = {}) {
  return {
    id: 'submission-1',
    userId: 'user-1',
    brokerKey: 'delta_exchange',
    accountId: 'acct-1',
    brokerOrderId: 'entry-1',
    brokerOrderStatus: 'CLOSED',
    reconciliationState: 'matched',
    assetId: 'asset-1',
    requestSymbol: 'BTCUSDT',
    requestOrderSymbol: null,
    responseSymbol: null,
    stopLossOrderId: 'sl-1',
    stopLossOrderIdNested: null,
    takeProfitOrderId: 'tp-1',
    takeProfitOrderIdNested: null,
    requestStopLossPrice: '73253',
    requestTakeProfitPrice: '75473',
    createdAt: new Date('2026-04-20T06:00:00.000Z'),
    updatedAt: new Date('2026-04-20T06:01:00.000Z'),
    ...overrides,
  };
}

function createOrderSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    externalId: 'entry-1',
    symbol: 'BTCUSD',
    orderStatus: 'CLOSED',
    statusRank: 4,
    assetUuid: '27',
    side: 'buy',
    orderType: 'market_order',
    stopOrderType: null,
    stopPrice: null,
    lastSeenAt: new Date('2026-04-20T07:00:00.000Z'),
    updatedAt: new Date('2026-04-20T07:00:00.000Z'),
    ...overrides,
  };
}

function createPositionSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    externalId: '27',
    symbol: 'BTCUSD',
    status: 'OPEN',
    statusRank: 1,
    quantityContracts: '1',
    entryPrice: '74268.5',
    markPrice: '74740.1',
    stopLossOrderId: null,
    stopLossPrice: null,
    takeProfitOrderId: null,
    takeProfitPrice: null,
    lastSeenAt: new Date('2026-04-20T07:00:00.000Z'),
    updatedAt: new Date('2026-04-20T07:00:00.000Z'),
    ...overrides,
  };
}

async function withMockedQuery<T>(handler: QueryHandler, run: () => Promise<T>): Promise<T> {
  const originalQuery = coreDataSource.query;
  coreDataSource.query = (async (sql: string, params?: unknown[]) =>
    handler(sql, params)) as typeof coreDataSource.query;
  try {
    return await run();
  } finally {
    coreDataSource.query = originalQuery;
  }
}

function createService(
  alerts: Array<Record<string, unknown>> = [],
  options: {
    openAlertBySource?: Record<string, unknown> | null;
    updatedAlerts?: Array<Record<string, unknown>>;
    cancelledOrders?: Array<Record<string, unknown>>;
    killSwitchTriggers?: Array<Record<string, unknown>>;
    activeKillSwitch?: Record<string, unknown> | null;
  } = {}
) {
  const service = new BrokerCanaryProtectionMonitorService() as any;
  service.alertRepository = {
    async findOpenAlertBySource() {
      return options.openAlertBySource ?? null;
    },
    async findRecentOpenAlertBySource() {
      return null;
    },
    async findOpenAlertBySignature() {
      return null;
    },
    async createAlert(payload: Record<string, unknown>) {
      alerts.push(payload);
      return { id: `alert-${alerts.length}`, ...payload };
    },
    async updateOpenAlertDetails(
      userId: string,
      alertId: string,
      payload: Record<string, unknown>
    ) {
      options.updatedAlerts?.push({ userId, alertId, ...payload });
      if (options.openAlertBySource) {
        Object.assign(options.openAlertBySource, payload);
      }
    },
  };
  service.riskKillSwitchService = {
    async findActiveLiveTradingBlock(userId: string, context: Record<string, unknown>) {
      if (!options.activeKillSwitch) {
        return null;
      }
      return {
        id: 'kill-switch-1',
        active: true,
        scope: 'broker',
        brokerKey: context.brokerKey,
        accountId: context.accountId,
        reason: 'Existing broker route freeze',
        triggeredBy: userId,
        triggeredAt: '2026-04-20T07:00:00.000Z',
        triggeredAtIso: '2026-04-20T07:00:00.000Z',
        ...options.activeKillSwitch,
      };
    },
    async trigger(userId: string, body: Record<string, unknown>) {
      options.killSwitchTriggers?.push({ userId, body });
      return {
        message: 'Kill switch triggered',
        active: true,
        triggeredAt: '2026-04-20T07:01:00.000Z',
        triggeredAtIso: '2026-04-20T07:01:00.000Z',
        scope: body.scope,
        brokerKey: body.brokerKey,
        accountId: body.accountId,
        reason: body.reason,
      };
    },
  };
  service.brokerOrdersFacadeService = {
    async cancelFuturesOrder(userId: string, orderId: string, query: Record<string, unknown>) {
      options.cancelledOrders?.push({ userId, orderId, ...query });
      return {
        success: true,
        data: {
          order_id: orderId,
          status: 'CANCELLED',
        },
      };
    },
  };
  return service as BrokerCanaryProtectionMonitorService;
}

async function testHealthyProtectedCanaryDoesNotAlert(): Promise<void> {
  const alerts: Array<Record<string, unknown>> = [];
  const service = createService(alerts);

  const response = await withMockedQuery(
    async (sql) => {
      if (sql.includes('FROM order_submission_requests')) {
        return [createCandidate()];
      }
      if (sql.includes('FROM scheduler_orders_snapshots')) {
        return [
          createOrderSnapshot(),
          createOrderSnapshot({
            externalId: 'sl-1',
            orderStatus: 'PENDING',
            statusRank: 1,
            side: 'sell',
          }),
          createOrderSnapshot({
            externalId: 'tp-1',
            orderStatus: 'PENDING',
            statusRank: 1,
            side: 'sell',
          }),
        ];
      }
      if (sql.includes('FROM scheduler_positions_snapshots')) {
        return [createPositionSnapshot()];
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    () =>
      service.runMonitor({
        emitAlerts: true,
        now: new Date('2026-04-20T07:01:00.000Z'),
      })
  );

  assert.equal(response.status, 'ok');
  assert.equal(response.monitoredSubmissions, 1);
  assert.equal(response.healthySubmissions, 1);
  assert.equal(response.issueSubmissions, 0);
  assert.equal(alerts.length, 0);
  assert.equal(response.items[0]?.lifecycle, 'OPEN_WITH_SL_TP');
}

async function testDeltaOpenPositionUsesLiveReduceOnlyProtectionBySymbol(): Promise<void> {
  const alerts: Array<Record<string, unknown>> = [];
  const service = createService(alerts);
  let sawDeltaProtectionReadBack = false;

  const response = await withMockedQuery(
    async (sql, params) => {
      if (sql.includes('FROM order_submission_requests')) {
        return [
          createCandidate({
            id: 'arb-submission-1',
            requestSymbol: 'ARBUSDT',
            brokerOrderId: 'arb-entry-1',
            stopLossOrderId: null,
            takeProfitOrderId: null,
            requestStopLossPrice: '0.1169275',
            requestTakeProfitPrice: '0.109735',
          }),
        ];
      }
      if (sql.includes('broker-canary-delta-active-protection')) {
        sawDeltaProtectionReadBack = true;
        assert.deepEqual(params, [
          'user-1',
          'acct-1',
          'ARBUSDT',
          'ARBUSD',
          'ARBUSDC',
        ]);
        return [
          createOrderSnapshot({
            externalId: 'arb-sl-live',
            symbol: 'ARBUSD',
            orderStatus: 'PENDING',
            statusRank: 1,
            side: 'buy',
            reduceOnly: 'true',
            stopOrderType: 'stop_loss_order',
          }),
          createOrderSnapshot({
            externalId: 'arb-tp-live',
            symbol: 'ARBUSD',
            orderStatus: 'PENDING',
            statusRank: 1,
            side: 'buy',
            reduceOnly: 'true',
            stopOrderType: 'take_profit_order',
          }),
        ];
      }
      if (sql.includes('FROM scheduler_orders_snapshots')) {
        return [
          createOrderSnapshot({
            externalId: 'arb-entry-1',
            symbol: 'ARBUSD',
            assetUuid: '17331',
            side: 'buy',
          }),
        ];
      }
      if (sql.includes('FROM scheduler_positions_snapshots')) {
        return [
          createPositionSnapshot({
            externalId: '17331',
            symbol: 'ARBUSD',
            stopLossOrderId: null,
            stopLossPrice: null,
            takeProfitOrderId: null,
            takeProfitPrice: null,
          }),
        ];
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    () =>
      service.runMonitor({
        emitAlerts: true,
        now: new Date('2026-04-20T07:01:00.000Z'),
      })
  );

  assert.equal(sawDeltaProtectionReadBack, true);
  assert.equal(response.status, 'ok');
  assert.equal(response.issueSubmissions, 0);
  assert.equal(response.criticalIssues, 0);
  assert.equal(response.items[0]?.lifecycle, 'OPEN_WITH_SL_TP');
  assert.equal(response.items[0]?.stopLossOrderId, 'arb-sl-live');
  assert.equal(response.items[0]?.takeProfitOrderId, 'arb-tp-live');
  assert.equal(alerts.length, 0);
}

async function testMudrexOpenPositionProtectionCanComeFromPositionSnapshot(): Promise<void> {
  const alerts: Array<Record<string, unknown>> = [];
  const service = createService(alerts);

  const response = await withMockedQuery(
    async (sql) => {
      if (sql.includes('FROM order_submission_requests')) {
        return [
          createCandidate({
            brokerKey: 'mudrex',
            brokerOrderId: 'mudrex-entry-1',
            requestSymbol: null,
            requestOrderSymbol: 'BTCUSDT',
            stopLossOrderId: null,
            takeProfitOrderId: null,
          }),
        ];
      }
      if (sql.includes('FROM scheduler_orders_snapshots')) {
        return [
          createOrderSnapshot({
            externalId: 'mudrex-entry-1',
            symbol: 'BTCUSDT',
            assetUuid: 'mudrex-asset-1',
          }),
        ];
      }
      if (sql.includes('FROM scheduler_positions_snapshots')) {
        return [
          createPositionSnapshot({
            externalId: 'mudrex:mudrex-asset-1:2026-04-20T06:12:18.000Z:LONG',
            symbol: 'BTCUSDT',
            stopLossOrderId: 'mudrex-sl-1',
            stopLossPrice: '73253',
            takeProfitOrderId: 'mudrex-tp-1',
            takeProfitPrice: '75473',
          }),
        ];
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    () =>
      service.runMonitor({
        emitAlerts: true,
        now: new Date('2026-04-20T07:01:00.000Z'),
      })
  );

  assert.equal(response.status, 'ok');
  assert.equal(response.items[0]?.brokerKey, 'mudrex');
  assert.equal(response.items[0]?.lifecycle, 'OPEN_WITH_SL_TP');
  assert.equal(response.items[0]?.stopLossOrderId, 'mudrex-sl-1');
  assert.equal(response.items[0]?.takeProfitOrderId, 'mudrex-tp-1');
  assert.equal(alerts.length, 0);
}

async function testMudrexOpenPositionMissingTakeProfitAlerts(): Promise<void> {
  const alerts: Array<Record<string, unknown>> = [];
  const service = createService(alerts);

  const response = await withMockedQuery(
    async (sql) => {
      if (sql.includes('FROM order_submission_requests')) {
        return [
          createCandidate({
            brokerKey: 'mudrex',
            brokerOrderId: 'mudrex-entry-1',
            stopLossOrderId: null,
            takeProfitOrderId: null,
          }),
        ];
      }
      if (sql.includes('FROM scheduler_orders_snapshots')) {
        return [
          createOrderSnapshot({
            externalId: 'mudrex-entry-1',
            symbol: 'BTCUSDT',
            assetUuid: 'mudrex-asset-1',
          }),
        ];
      }
      if (sql.includes('FROM scheduler_positions_snapshots')) {
        return [
          createPositionSnapshot({
            externalId: 'mudrex:mudrex-asset-1:2026-04-20T06:12:18.000Z:LONG',
            symbol: 'BTCUSDT',
            stopLossOrderId: 'mudrex-sl-1',
            stopLossPrice: '73253',
            takeProfitOrderId: null,
            takeProfitPrice: null,
          }),
        ];
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    () =>
      service.runMonitor({
        emitAlerts: true,
        now: new Date('2026-04-20T07:01:00.000Z'),
      })
  );

  assert.equal(response.status, 'degraded');
  assert.equal(response.items[0]?.lifecycle, 'OPEN_UNPROTECTED');
  assert.equal(
    response.items[0]?.issues.some((issue) => issue.code === 'open_position_unprotected'),
    true
  );
  assert.equal(alerts.length, 1);
}

async function testOpenCanaryMissingProtectionEmitsAlert(): Promise<void> {
  const alerts: Array<Record<string, unknown>> = [];
  const service = createService(alerts);

  const response = await withMockedQuery(
    async (sql) => {
      if (sql.includes('FROM order_submission_requests')) {
        return [createCandidate()];
      }
      if (sql.includes('FROM scheduler_orders_snapshots')) {
        return [
          createOrderSnapshot(),
          createOrderSnapshot({
            externalId: 'tp-1',
            orderStatus: 'PENDING',
            statusRank: 1,
            side: 'sell',
          }),
        ];
      }
      if (sql.includes('FROM scheduler_positions_snapshots')) {
        return [createPositionSnapshot()];
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    () =>
      service.runMonitor({
        emitAlerts: true,
        now: new Date('2026-04-20T07:01:00.000Z'),
      })
  );

  assert.equal(response.status, 'degraded');
  assert.equal(response.issueSubmissions, 1);
  assert.equal(response.criticalIssues >= 1, true);
  assert.equal(response.alertsEmitted, 1);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0]?.channel, 'Broker Canary');
  assert.equal(alerts[0]?.source, 'broker-canary-monitor:submission-1');
  assert.equal(alerts[0]?.severity, 'High');
  assert.equal(alerts[0]?.suppressEmailDelivery, false);
  assert.match(
    String(alerts[0]?.message || ''),
    /stop-loss protective order snapshot sl-1 is missing/i
  );
  assert.equal(response.items[0]?.lifecycle, 'OPEN_UNPROTECTED');
}

async function testWarningOnlyCanaryAlertSuppressesEmailDelivery(): Promise<void> {
  const alerts: Array<Record<string, unknown>> = [];
  const service = createService(alerts);

  const response = await withMockedQuery(
    async (sql) => {
      if (sql.includes('FROM order_submission_requests')) {
        return [
          createCandidate({
            brokerKey: 'mudrex',
            brokerOrderId: 'mudrex-entry-1',
            requestSymbol: null,
            requestOrderSymbol: 'BTCUSDT',
            stopLossOrderId: 'mudrex-sl-1',
            takeProfitOrderId: 'mudrex-tp-1',
          }),
        ];
      }
      if (sql.includes('FROM scheduler_orders_snapshots')) {
        return [];
      }
      if (sql.includes('FROM scheduler_positions_snapshots')) {
        return [];
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    () =>
      service.runMonitor({
        emitAlerts: true,
        now: new Date('2026-04-20T07:01:00.000Z'),
      })
  );

  assert.equal(response.status, 'degraded');
  assert.equal(response.issueSubmissions, 1);
  assert.equal(response.criticalIssues, 0);
  assert.equal(response.warningIssues, 3);
  assert.equal(response.alertsEmitted, 1);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0]?.channel, 'Broker Canary');
  assert.equal(alerts[0]?.severity, 'Medium');
  assert.equal(alerts[0]?.suppressEmailDelivery, true);
  assert.match(String(alerts[0]?.message || ''), /Entry order snapshot mudrex-entry-1 is missing/i);
}

async function testOpenCanaryMissingProtectionAutoFreezesBrokerAccount(): Promise<void> {
  const alerts: Array<Record<string, unknown>> = [];
  const killSwitchTriggers: Array<Record<string, unknown>> = [];
  const service = createService(alerts, { killSwitchTriggers });

  const response = await withMockedQuery(
    async (sql) => {
      if (sql.includes('FROM order_submission_requests')) {
        return [
          createCandidate({
            brokerKey: 'mudrex',
            brokerOrderId: 'mudrex-entry-1',
            stopLossOrderId: null,
            takeProfitOrderId: null,
          }),
        ];
      }
      if (sql.includes('FROM scheduler_orders_snapshots')) {
        return [
          createOrderSnapshot({
            externalId: 'mudrex-entry-1',
            symbol: 'BTCUSDT',
            assetUuid: 'mudrex-asset-1',
          }),
        ];
      }
      if (sql.includes('FROM scheduler_positions_snapshots')) {
        return [
          createPositionSnapshot({
            externalId: 'mudrex:mudrex-asset-1:2026-04-20T06:12:18.000Z:LONG',
            symbol: 'BTCUSDT',
            stopLossOrderId: 'mudrex-sl-1',
            stopLossPrice: '73253',
            takeProfitOrderId: null,
            takeProfitPrice: null,
          }),
        ];
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    () =>
      service.runMonitor({
        emitAlerts: true,
        freezeOnCritical: true,
        now: new Date('2026-04-20T07:01:00.000Z'),
      })
  );

  assert.equal(response.status, 'degraded');
  assert.equal(response.freezeOnCritical, true);
  assert.equal(response.killSwitchTriggers, 1);
  assert.equal(killSwitchTriggers.length, 1);
  assert.equal(killSwitchTriggers[0]?.userId, 'user-1');
  assert.deepEqual(killSwitchTriggers[0]?.body, {
    scope: 'broker',
    brokerKey: 'mudrex',
    accountId: 'acct-1',
    reason:
      'Auto-freeze: open live position BTCUSDT on mudrex/acct-1 has critical canary issue open_position_unprotected: Open live canary position does not have both active SL and TP protective orders. Submission submission-1.',
  });
  assert.equal(response.items[0]?.killSwitchTriggered, true);
  assert.equal(response.items[0]?.killSwitchActive, true);
  assert.equal(response.items[0]?.killSwitchIssueCode, 'open_position_unprotected');
  assert.match(String(response.items[0]?.killSwitchReason || ''), /Auto-freeze/);
  assert.equal(alerts.length, 1);
}

async function testOpenCanaryStaleSnapshotAutoFreezesBrokerAccount(): Promise<void> {
  const alerts: Array<Record<string, unknown>> = [];
  const killSwitchTriggers: Array<Record<string, unknown>> = [];
  const service = createService(alerts, { killSwitchTriggers });

  const response = await withMockedQuery(
    async (sql) => {
      if (sql.includes('FROM order_submission_requests')) {
        return [createCandidate()];
      }
      if (sql.includes('FROM scheduler_orders_snapshots')) {
        return [
          createOrderSnapshot({
            lastSeenAt: new Date('2026-04-20T07:00:00.000Z'),
            updatedAt: new Date('2026-04-20T07:00:00.000Z'),
          }),
          createOrderSnapshot({
            externalId: 'sl-1',
            orderStatus: 'PENDING',
            statusRank: 1,
            side: 'sell',
            lastSeenAt: new Date('2026-04-20T07:00:00.000Z'),
            updatedAt: new Date('2026-04-20T07:00:00.000Z'),
          }),
          createOrderSnapshot({
            externalId: 'tp-1',
            orderStatus: 'PENDING',
            statusRank: 1,
            side: 'sell',
            lastSeenAt: new Date('2026-04-20T07:00:00.000Z'),
            updatedAt: new Date('2026-04-20T07:00:00.000Z'),
          }),
        ];
      }
      if (sql.includes('FROM scheduler_positions_snapshots')) {
        return [
          createPositionSnapshot({
            lastSeenAt: new Date('2026-04-20T07:00:00.000Z'),
            updatedAt: new Date('2026-04-20T07:00:00.000Z'),
          }),
        ];
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    () =>
      service.runMonitor({
        emitAlerts: true,
        freezeOnCritical: true,
        now: new Date('2026-04-20T07:30:01.000Z'),
      })
  );

  assert.equal(response.status, 'degraded');
  assert.equal(response.items[0]?.lifecycle, 'OPEN_WITH_SL_TP');
  assert.equal(
    response.items[0]?.issues.some((issue) => issue.code === 'open_position_unprotected'),
    false
  );
  assert.equal(
    response.items[0]?.issues.some((issue) => issue.code === 'snapshot_stale'),
    true
  );
  assert.equal(response.killSwitchTriggers, 1);
  assert.equal(killSwitchTriggers.length, 1);
  assert.deepEqual(killSwitchTriggers[0]?.body, {
    scope: 'broker',
    brokerKey: 'delta_exchange',
    accountId: 'acct-1',
    reason:
      'Auto-freeze: open live position BTCUSDT on delta_exchange/acct-1 has critical canary issue snapshot_stale: Order snapshot entry-1 is stale. Submission submission-1.',
  });
  assert.equal(response.items[0]?.killSwitchTriggered, true);
  assert.equal(response.items[0]?.killSwitchIssueCode, 'snapshot_stale');
  assert.equal(alerts.length, 1);
}

async function testOpenCanaryMissingProtectionDryRunDoesNotAutoFreeze(): Promise<void> {
  const alerts: Array<Record<string, unknown>> = [];
  const killSwitchTriggers: Array<Record<string, unknown>> = [];
  const service = createService(alerts, { killSwitchTriggers });

  const response = await withMockedQuery(
    async (sql) => {
      if (sql.includes('FROM order_submission_requests')) {
        return [createCandidate()];
      }
      if (sql.includes('FROM scheduler_orders_snapshots')) {
        return [
          createOrderSnapshot(),
          createOrderSnapshot({
            externalId: 'tp-1',
            orderStatus: 'PENDING',
            statusRank: 1,
            side: 'sell',
          }),
        ];
      }
      if (sql.includes('FROM scheduler_positions_snapshots')) {
        return [createPositionSnapshot()];
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    () =>
      service.runMonitor({
        emitAlerts: false,
        freezeOnCritical: true,
        now: new Date('2026-04-20T07:01:00.000Z'),
      })
  );

  assert.equal(response.status, 'degraded');
  assert.equal(response.freezeOnCritical, true);
  assert.equal(response.killSwitchTriggers, 0);
  assert.equal(response.items[0]?.killSwitchTriggered, false);
  assert.equal(response.items[0]?.killSwitchActive, false);
  assert.equal(killSwitchTriggers.length, 0);
  assert.equal(alerts.length, 0);
}

async function testOpenCanaryMissingProtectionReusesActiveKillSwitch(): Promise<void> {
  const alerts: Array<Record<string, unknown>> = [];
  const killSwitchTriggers: Array<Record<string, unknown>> = [];
  const service = createService(alerts, {
    killSwitchTriggers,
    activeKillSwitch: {
      reason: 'Existing workspace freeze',
      scope: 'workspace',
      brokerKey: null,
      accountId: null,
    },
  });

  const response = await withMockedQuery(
    async (sql) => {
      if (sql.includes('FROM order_submission_requests')) {
        return [createCandidate()];
      }
      if (sql.includes('FROM scheduler_orders_snapshots')) {
        return [createOrderSnapshot()];
      }
      if (sql.includes('FROM scheduler_positions_snapshots')) {
        return [createPositionSnapshot()];
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    () =>
      service.runMonitor({
        emitAlerts: true,
        freezeOnCritical: true,
        now: new Date('2026-04-20T07:01:00.000Z'),
      })
  );

  assert.equal(response.killSwitchTriggers, 0);
  assert.equal(killSwitchTriggers.length, 0);
  assert.equal(response.items[0]?.killSwitchTriggered, false);
  assert.equal(response.items[0]?.killSwitchActive, true);
  assert.equal(response.items[0]?.killSwitchReason, 'Existing workspace freeze');
  assert.equal(alerts.length, 1);
}

async function testClosedCanaryWithActiveProtectionAlertsAsOrphan(): Promise<void> {
  const alerts: Array<Record<string, unknown>> = [];
  const killSwitchTriggers: Array<Record<string, unknown>> = [];
  const service = createService(alerts, { killSwitchTriggers });

  const response = await withMockedQuery(
    async (sql) => {
      if (sql.includes('FROM order_submission_requests')) {
        return [createCandidate()];
      }
      if (sql.includes('FROM scheduler_orders_snapshots')) {
        return [
          createOrderSnapshot(),
          createOrderSnapshot({
            externalId: 'sl-1',
            orderStatus: 'PENDING',
            statusRank: 1,
            side: 'sell',
          }),
          createOrderSnapshot({
            externalId: 'tp-1',
            orderStatus: 'PENDING',
            statusRank: 1,
            side: 'sell',
          }),
        ];
      }
      if (sql.includes('FROM scheduler_positions_snapshots')) {
        return [];
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    () =>
      service.runMonitor({
        emitAlerts: true,
        freezeOnCritical: true,
        now: new Date('2026-04-20T07:01:00.000Z'),
      })
  );

  assert.equal(response.status, 'degraded');
  assert.equal(response.items[0]?.lifecycle, 'CLOSED_WITH_ACTIVE_PROTECTION');
  assert.equal(
    response.items[0]?.issues.some((issue) => issue.code === 'orphan_active_protection'),
    true
  );
  assert.equal(alerts.length, 0);
  assert.equal(response.killSwitchTriggers, 0);
  assert.equal(killSwitchTriggers.length, 0);
}

async function testClosedCanaryWithActiveProtectionAutoCancelsSiblingOrders(): Promise<void> {
  const alerts: Array<Record<string, unknown>> = [];
  const cancelledOrders: Array<Record<string, unknown>> = [];
  const service = createService(alerts, { cancelledOrders });

  const response = await withMockedQuery(
    async (sql) => {
      if (sql.includes('FROM order_submission_requests')) {
        return [createCandidate()];
      }
      if (sql.includes('FROM scheduler_orders_snapshots')) {
        return [
          createOrderSnapshot(),
          createOrderSnapshot({
            externalId: 'sl-1',
            orderStatus: 'PENDING',
            statusRank: 1,
            side: 'sell',
          }),
          createOrderSnapshot({
            externalId: 'tp-1',
            orderStatus: 'PENDING',
            statusRank: 1,
            side: 'sell',
          }),
        ];
      }
      if (sql.includes('FROM scheduler_positions_snapshots')) {
        return [];
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    () =>
      service.runMonitor({
        emitAlerts: true,
        now: new Date('2026-04-20T07:01:00.000Z'),
      })
  );

  assert.equal(response.items[0]?.lifecycle, 'CLOSED_WITH_ACTIVE_PROTECTION');
  assert.deepEqual(response.items[0]?.autoCancelledOrderIds, ['sl-1', 'tp-1']);
  assert.deepEqual(
    cancelledOrders.map((item) => item.orderId),
    ['sl-1', 'tp-1']
  );
  assert.equal(alerts.length, 0);
}

async function testFilledProtectiveLegTreatsNettedSymbolAsClosedAndCancelsSibling(): Promise<void> {
  const alerts: Array<Record<string, unknown>> = [];
  const cancelledOrders: Array<Record<string, unknown>> = [];
  const service = createService(alerts, { cancelledOrders });

  const response = await withMockedQuery(
    async (sql) => {
      if (sql.includes('FROM order_submission_requests')) {
        return [createCandidate()];
      }
      if (sql.includes('FROM scheduler_orders_snapshots')) {
        return [
          createOrderSnapshot(),
          createOrderSnapshot({
            externalId: 'sl-1',
            orderStatus: 'CLOSED',
            statusRank: 4,
            side: 'sell',
          }),
          createOrderSnapshot({
            externalId: 'tp-1',
            orderStatus: 'PENDING',
            statusRank: 1,
            side: 'sell',
          }),
        ];
      }
      if (sql.includes('FROM scheduler_positions_snapshots')) {
        return [
          createPositionSnapshot({
            status: 'OPEN',
            statusRank: 1,
            quantityContracts: '3',
          }),
        ];
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    () =>
      service.runMonitor({
        emitAlerts: true,
        now: new Date('2026-04-20T07:01:00.000Z'),
      })
  );

  assert.equal(response.items[0]?.positionOpen, false);
  assert.equal(response.items[0]?.lifecycle, 'CLOSED_WITH_ACTIVE_PROTECTION');
  assert.equal(
    response.items[0]?.issues.some((issue) => issue.code === 'open_position_unprotected'),
    false
  );
  assert.equal(
    response.items[0]?.issues.some((issue) => issue.code === 'orphan_active_protection'),
    true
  );
  assert.deepEqual(response.items[0]?.autoCancelledOrderIds, ['tp-1']);
  assert.deepEqual(
    cancelledOrders.map((item) => item.orderId),
    ['tp-1']
  );
  assert.equal(alerts.length, 0);
}

async function testClosedPositionRankThreeIsNotTreatedAsOpen(): Promise<void> {
  const alerts: Array<Record<string, unknown>> = [];
  const service = createService(alerts);

  const response = await withMockedQuery(
    async (sql) => {
      if (sql.includes('FROM order_submission_requests')) {
        return [createCandidate()];
      }
      if (sql.includes('FROM scheduler_orders_snapshots')) {
        return [
          createOrderSnapshot(),
          createOrderSnapshot({
            externalId: 'sl-1',
            orderStatus: 'PENDING',
            statusRank: 1,
            side: 'sell',
          }),
          createOrderSnapshot({
            externalId: 'tp-1',
            orderStatus: 'CLOSED',
            statusRank: 4,
            side: 'sell',
          }),
        ];
      }
      if (sql.includes('FROM scheduler_positions_snapshots')) {
        return [
          createPositionSnapshot({
            status: 'CLOSED',
            statusRank: 3,
            quantityContracts: '1',
          }),
        ];
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    () =>
      service.runMonitor({
        emitAlerts: true,
        now: new Date('2026-04-20T07:01:00.000Z'),
      })
  );

  assert.equal(response.status, 'degraded');
  assert.equal(response.items[0]?.positionOpen, false);
  assert.equal(response.items[0]?.lifecycle, 'CLOSED_WITH_ACTIVE_PROTECTION');
  assert.equal(
    response.items[0]?.issues.some((issue) => issue.code === 'open_position_unprotected'),
    false
  );
  assert.equal(
    response.items[0]?.issues.some((issue) => issue.code === 'orphan_active_protection'),
    true
  );
  assert.equal(alerts.length, 0);
}

async function testExistingCanaryAlertIsRefreshedWhenLifecycleChanges(): Promise<void> {
  const alerts: Array<Record<string, unknown>> = [];
  const updatedAlerts: Array<Record<string, unknown>> = [];
  const service = createService(alerts, {
    updatedAlerts,
    openAlertBySource: {
      id: 'alert-1',
      userId: 'user-1',
      severity: 'High',
      channel: 'Broker Canary',
      symbol: 'BTCUSDT',
      message:
        'Broker canary protection issue for BTCUSDT: Open live canary position does not have both active SL and TP protective orders.',
      route: 'Orders',
      status: 'Open',
      source: 'broker-canary-monitor:submission-1',
      urgency: 'immediate',
    },
  });

  const response = await withMockedQuery(
    async (sql) => {
      if (sql.includes('FROM order_submission_requests')) {
        return [createCandidate()];
      }
      if (sql.includes('FROM scheduler_orders_snapshots')) {
        return [
          createOrderSnapshot(),
          createOrderSnapshot({
            externalId: 'sl-1',
            orderStatus: 'PENDING',
            statusRank: 1,
            side: 'sell',
          }),
          createOrderSnapshot({
            externalId: 'tp-1',
            orderStatus: 'CLOSED',
            statusRank: 4,
            side: 'sell',
          }),
        ];
      }
      if (sql.includes('FROM scheduler_positions_snapshots')) {
        return [
          createPositionSnapshot({
            status: 'CLOSED',
            statusRank: 3,
            quantityContracts: '1',
          }),
        ];
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    () =>
      service.runMonitor({
        emitAlerts: true,
        now: new Date('2026-04-20T07:01:00.000Z'),
      })
  );

  assert.equal(response.alertsEmitted, 0);
  assert.equal(alerts.length, 0);
  assert.equal(updatedAlerts.length, 0);
}

async function testDisabledMonitorSkipsQueries(): Promise<void> {
  const originalEnabled = env.brokerCanaryMonitor.enabled;
  env.brokerCanaryMonitor.enabled = false;
  try {
    const service = createService();
    const response = await withMockedQuery(
      async () => {
        throw new Error('disabled monitor should not query database');
      },
      () => service.runMonitor({ now: new Date('2026-04-20T07:01:00.000Z') })
    );

    assert.equal(response.status, 'disabled');
    assert.equal(response.monitoredSubmissions, 0);
  } finally {
    env.brokerCanaryMonitor.enabled = originalEnabled;
  }
}

async function testBrokerKeyFilterIsPassedToCandidateQuery(): Promise<void> {
  const service = createService();
  let sawBrokerFilter = false;

  const response = await withMockedQuery(
    async (sql, params) => {
      if (sql.includes('FROM order_submission_requests')) {
        sawBrokerFilter = sql.includes('LOWER(broker_key) = ?');
        assert.deepEqual(params, ['mudrex']);
        return [];
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    () =>
      service.runMonitor({
        brokerKey: ' Mudrex ',
        emitAlerts: false,
        now: new Date('2026-04-20T07:01:00.000Z'),
      })
  );

  assert.equal(response.status, 'ok');
  assert.equal(response.monitoredSubmissions, 0);
  assert.equal(sawBrokerFilter, true);
}

async function testSuggestedTradeSubmissionsAreExcludedByDefault(): Promise<void> {
  const service = createService();
  let sawSuggestedTradeExclusion = false;

  const response = await withMockedQuery(
    async (sql) => {
      if (sql.includes('FROM order_submission_requests')) {
        sawSuggestedTradeExclusion = sql.includes('suggested_trade_id IS NULL');
        return [];
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    () =>
      service.runMonitor({
        emitAlerts: false,
        now: new Date('2026-04-20T07:01:00.000Z'),
      })
  );

  assert.equal(response.status, 'ok');
  assert.equal(response.monitoredSubmissions, 0);
  assert.equal(sawSuggestedTradeExclusion, true);
}

async function main(): Promise<void> {
  await testHealthyProtectedCanaryDoesNotAlert();
  await testDeltaOpenPositionUsesLiveReduceOnlyProtectionBySymbol();
  await testMudrexOpenPositionProtectionCanComeFromPositionSnapshot();
  await testMudrexOpenPositionMissingTakeProfitAlerts();
  await testOpenCanaryMissingProtectionEmitsAlert();
  await testWarningOnlyCanaryAlertSuppressesEmailDelivery();
  await testOpenCanaryMissingProtectionAutoFreezesBrokerAccount();
  await testOpenCanaryStaleSnapshotAutoFreezesBrokerAccount();
  await testOpenCanaryMissingProtectionDryRunDoesNotAutoFreeze();
  await testOpenCanaryMissingProtectionReusesActiveKillSwitch();
  await testClosedCanaryWithActiveProtectionAlertsAsOrphan();
  await testClosedCanaryWithActiveProtectionAutoCancelsSiblingOrders();
  await testFilledProtectiveLegTreatsNettedSymbolAsClosedAndCancelsSibling();
  await testClosedPositionRankThreeIsNotTreatedAsOpen();
  await testExistingCanaryAlertIsRefreshedWhenLifecycleChanges();
  await testDisabledMonitorSkipsQueries();
  await testBrokerKeyFilterIsPassedToCandidateQuery();
  await testSuggestedTradeSubmissionsAreExcludedByDefault();
  console.log('Broker canary protection monitor assertions passed.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
