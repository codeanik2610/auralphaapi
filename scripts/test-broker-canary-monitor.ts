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

function createService(alerts: Array<Record<string, unknown>> = []) {
  const service = new BrokerCanaryProtectionMonitorService() as any;
  service.alertRepository = {
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

async function main(): Promise<void> {
  await testHealthyProtectedCanaryDoesNotAlert();
  await testOpenCanaryMissingProtectionEmitsAlert();
  await testClosedCanaryWithActiveProtectionAlertsAsOrphan();
  await testDisabledMonitorSkipsQueries();
  console.log('Broker canary protection monitor assertions passed.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
