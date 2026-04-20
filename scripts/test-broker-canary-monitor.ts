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
  return service as BrokerCanaryProtectionMonitorService;
}

async function testHealthyProtectedCanaryDoesNotAlert(): Promise<void> {
  const alerts: Array<Record<string, unknown>> = [];
  const service = createService(alerts);

  const response = await withMockedQuery(async (sql) => {
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
  }, () =>
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

async function testMudrexOpenPositionProtectionCanComeFromPositionSnapshot(): Promise<void> {
  const alerts: Array<Record<string, unknown>> = [];
  const service = createService(alerts);

  const response = await withMockedQuery(async (sql) => {
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
  }, () =>
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

  const response = await withMockedQuery(async (sql) => {
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
  }, () =>
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

  const response = await withMockedQuery(async (sql) => {
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
  }, () =>
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
  assert.match(String(alerts[0]?.message || ''), /stop-loss protective order snapshot sl-1 is missing/i);
  assert.equal(response.items[0]?.lifecycle, 'OPEN_UNPROTECTED');
}

async function testClosedCanaryWithActiveProtectionAlertsAsOrphan(): Promise<void> {
  const alerts: Array<Record<string, unknown>> = [];
  const service = createService(alerts);

  const response = await withMockedQuery(async (sql) => {
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
  }, () =>
    service.runMonitor({
      emitAlerts: true,
      now: new Date('2026-04-20T07:01:00.000Z'),
    })
  );

  assert.equal(response.status, 'degraded');
  assert.equal(response.items[0]?.lifecycle, 'CLOSED_WITH_ACTIVE_PROTECTION');
  assert.equal(
    response.items[0]?.issues.some((issue) => issue.code === 'orphan_active_protection'),
    true
  );
  assert.equal(alerts.length, 1);
}

async function testClosedPositionRankThreeIsNotTreatedAsOpen(): Promise<void> {
  const alerts: Array<Record<string, unknown>> = [];
  const service = createService(alerts);

  const response = await withMockedQuery(async (sql) => {
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
  }, () =>
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
  assert.equal(alerts.length, 1);
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
      message: 'Broker canary protection issue for BTCUSDT: Open live canary position does not have both active SL and TP protective orders.',
      route: 'Orders',
      status: 'Open',
      source: 'broker-canary-monitor:submission-1',
      urgency: 'immediate',
    },
  });

  const response = await withMockedQuery(async (sql) => {
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
  }, () =>
    service.runMonitor({
      emitAlerts: true,
      now: new Date('2026-04-20T07:01:00.000Z'),
    })
  );

  assert.equal(response.alertsEmitted, 1);
  assert.equal(alerts.length, 0);
  assert.equal(updatedAlerts.length, 1);
  assert.equal(updatedAlerts[0]?.alertId, 'alert-1');
  assert.equal(updatedAlerts[0]?.urgency, 'review');
  assert.match(String(updatedAlerts[0]?.message || ''), /protective order is still active/i);
}

async function testDisabledMonitorSkipsQueries(): Promise<void> {
  const originalEnabled = env.brokerCanaryMonitor.enabled;
  env.brokerCanaryMonitor.enabled = false;
  try {
    const service = createService();
    const response = await withMockedQuery(async () => {
      throw new Error('disabled monitor should not query database');
    }, () => service.runMonitor({ now: new Date('2026-04-20T07:01:00.000Z') }));

    assert.equal(response.status, 'disabled');
    assert.equal(response.monitoredSubmissions, 0);
  } finally {
    env.brokerCanaryMonitor.enabled = originalEnabled;
  }
}

async function testBrokerKeyFilterIsPassedToCandidateQuery(): Promise<void> {
  const service = createService();
  let sawBrokerFilter = false;

  const response = await withMockedQuery(async (sql, params) => {
    if (sql.includes('FROM order_submission_requests')) {
      sawBrokerFilter = sql.includes('LOWER(broker_key) = ?');
      assert.deepEqual(params, ['mudrex']);
      return [];
    }
    throw new Error(`Unexpected query: ${sql}`);
  }, () =>
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

async function main(): Promise<void> {
  await testHealthyProtectedCanaryDoesNotAlert();
  await testMudrexOpenPositionProtectionCanComeFromPositionSnapshot();
  await testMudrexOpenPositionMissingTakeProfitAlerts();
  await testOpenCanaryMissingProtectionEmitsAlert();
  await testClosedCanaryWithActiveProtectionAlertsAsOrphan();
  await testClosedPositionRankThreeIsNotTreatedAsOpen();
  await testExistingCanaryAlertIsRefreshedWhenLifecycleChanges();
  await testDisabledMonitorSkipsQueries();
  await testBrokerKeyFilterIsPassedToCandidateQuery();
  console.log('Broker canary protection monitor assertions passed.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
