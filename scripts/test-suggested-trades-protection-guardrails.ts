import 'reflect-metadata';

import assert from 'node:assert/strict';
import { SuggestedTradesProtectionGuardrailService } from '../src/api/services/SuggestedTradesProtectionGuardrailService';
import { coreDataSource } from '../src/database/data-source';

type QueryHandler = (sql: string, params?: unknown[]) => Promise<unknown[]>;

function createExecution(overrides: Record<string, unknown> = {}) {
  return {
    suggestedTradeId: 'trade-1',
    userId: 'user-1',
    brokerKey: 'delta_exchange',
    accountId: 'acct-1',
    symbol: 'BTCUSDT',
    side: 'long',
    timeframe: '5m',
    orderId: 'entry-1',
    orderStatus: 'CLOSED',
    orderType: 'limit',
    executionState: 'filled',
    positionId: null,
    positionStatus: 'open',
    filledAt: new Date('2026-05-05T10:00:00.000Z'),
    submittedAt: new Date('2026-05-05T09:59:00.000Z'),
    protectionState: 'attached',
    protectionPlanJson: {
      stopLossOrderId: 'sl-1',
      takeProfitOrderId: 'tp-1',
    },
    protectionCheckedAt: new Date('2026-05-05T10:01:00.000Z'),
    protectionAttachedAt: new Date('2026-05-05T10:01:00.000Z'),
    updatedAt: new Date('2026-05-05T10:01:00.000Z'),
    ...overrides,
  };
}

function createOrder(overrides: Record<string, unknown> = {}) {
  return {
    externalId: 'sl-1',
    symbol: 'BTCUSD',
    orderStatus: 'PENDING',
    statusRank: 1,
    lastSeenAt: new Date('2026-05-05T10:05:00.000Z'),
    ...overrides,
  };
}

function createPosition(overrides: Record<string, unknown> = {}) {
  return {
    externalId: 'pos-1',
    symbol: 'BTCUSD',
    status: 'OPEN',
    statusRank: 1,
    stopLossOrderId: null,
    stopLossPrice: null,
    takeProfitOrderId: null,
    takeProfitPrice: null,
    lastSeenAt: new Date('2026-05-05T10:05:00.000Z'),
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
  const service = new SuggestedTradesProtectionGuardrailService() as any;
  service.alertRepository = {
    async findOpenAlertBySource() {
      return null;
    },
    async findOpenAlertBySignature() {
      return null;
    },
    async createAlert(payload: Record<string, unknown>) {
      alerts.push(payload);
      return { id: `alert-${alerts.length}`, ...payload };
    },
    async updateOpenAlertDetails() {
      throw new Error('updateOpenAlertDetails should not run without an existing alert');
    },
  };
  return service as SuggestedTradesProtectionGuardrailService;
}

async function runGuardrailScenario(input: {
  execution: Record<string, unknown>;
  orders?: Record<string, unknown>[];
  positions?: Record<string, unknown>[];
  alerts?: Array<Record<string, unknown>>;
}) {
  const service = createService(input.alerts);
  return withMockedQuery(
    async (sql) => {
      if (sql.includes('FROM suggested_trade_executions')) {
        return [input.execution];
      }
      if (sql.includes('FROM scheduler_orders_snapshots')) {
        return input.orders ?? [];
      }
      if (sql.includes('FROM scheduler_positions_snapshots')) {
        return input.positions ?? [];
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    () =>
      service.runAudit({
        emitAlerts: true,
        now: new Date('2026-05-05T10:20:00.000Z'),
        staleAfterMs: 10 * 60 * 1000,
      })
  );
}

async function testAttachedDeltaWithActiveOrdersPasses(): Promise<void> {
  const alerts: Array<Record<string, unknown>> = [];
  const response = await runGuardrailScenario({
    execution: createExecution(),
    orders: [
      createOrder({ externalId: 'sl-1', orderStatus: 'PENDING', statusRank: 1 }),
      createOrder({ externalId: 'tp-1', orderStatus: 'PENDING', statusRank: 1 }),
    ],
    positions: [createPosition()],
    alerts,
  });

  assert.equal(response.status, 'ok');
  assert.equal(response.issueTrades, 0);
  assert.equal(alerts.length, 0);
}

async function testAttachedDeltaWithCancelledProtectionAlerts(): Promise<void> {
  const alerts: Array<Record<string, unknown>> = [];
  const response = await runGuardrailScenario({
    execution: createExecution(),
    orders: [
      createOrder({ externalId: 'sl-1', orderStatus: 'CANCELLED', statusRank: 5 }),
      createOrder({ externalId: 'tp-1', orderStatus: 'PENDING', statusRank: 1 }),
    ],
    positions: [createPosition()],
    alerts,
  });

  assert.equal(response.status, 'degraded');
  assert.equal(response.issueTrades, 1);
  assert.equal(response.items[0]?.issues[0]?.code, 'attached_protection_inactive');
  assert.equal(response.alertsEmitted, 1);
  assert.equal(alerts.length, 1);
  assert.match(String(alerts[0]?.message || ''), /SL=sl-1:CANCELLED/);
}

async function testDeltaFilledWaitingForPositionStaleAlerts(): Promise<void> {
  const alerts: Array<Record<string, unknown>> = [];
  const response = await runGuardrailScenario({
    execution: createExecution({
      protectionState: 'waiting_for_position',
      protectionPlanJson: {},
      protectionCheckedAt: new Date('2026-05-05T10:00:00.000Z'),
      protectionAttachedAt: null,
    }),
    positions: [],
    alerts,
  });

  assert.equal(response.status, 'degraded');
  assert.equal(response.items[0]?.issues[0]?.code, 'delta_filled_protection_stale');
  assert.equal(response.items[0]?.ageSeconds, 1200);
  assert.equal(alerts.length, 1);
  assert.match(String(alerts[0]?.message || ''), /delta_filled_protection_stale/);
}

async function testAttachedMudrexWithPositionProtectionPasses(): Promise<void> {
  const alerts: Array<Record<string, unknown>> = [];
  const response = await runGuardrailScenario({
    execution: createExecution({
      brokerKey: 'mudrex',
      symbol: 'ETHUSDT',
      protectionPlanJson: {},
    }),
    positions: [
      createPosition({
        symbol: 'ETHUSDT',
        stopLossPrice: '3250',
        takeProfitPrice: '3450',
      }),
    ],
    alerts,
  });

  assert.equal(response.status, 'ok');
  assert.equal(response.issueTrades, 0);
  assert.equal(alerts.length, 0);
}

async function testAttachedMudrexMissingTakeProfitAlerts(): Promise<void> {
  const alerts: Array<Record<string, unknown>> = [];
  const response = await runGuardrailScenario({
    execution: createExecution({
      brokerKey: 'mudrex',
      symbol: 'ETHUSDT',
      protectionPlanJson: {},
    }),
    positions: [
      createPosition({
        symbol: 'ETHUSDT',
        stopLossPrice: '3250',
        takeProfitPrice: null,
      }),
    ],
    alerts,
  });

  assert.equal(response.status, 'degraded');
  assert.equal(response.items[0]?.issues[0]?.code, 'attached_protection_inactive');
  assert.equal(alerts.length, 1);
  assert.match(String(alerts[0]?.message || ''), /mudrex ETHUSDT/);
}

async function main(): Promise<void> {
  await testAttachedDeltaWithActiveOrdersPasses();
  await testAttachedDeltaWithCancelledProtectionAlerts();
  await testDeltaFilledWaitingForPositionStaleAlerts();
  await testAttachedMudrexWithPositionProtectionPasses();
  await testAttachedMudrexMissingTakeProfitAlerts();
  console.log('Suggested trades protection guardrail assertions passed.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
