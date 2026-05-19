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

function createService(
  alerts: Array<Record<string, unknown>> = [],
  recoveryCalls: Array<Record<string, unknown>> = []
) {
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
  service.suggestedTradesService = {
    async syncExecutionForPositionUpdates(
      userId: string,
      brokerKey: string,
      accountId: string,
      symbols: string[]
    ) {
      recoveryCalls.push({ userId, brokerKey, accountId, symbols: [...symbols] });
      return 1;
    },
  };
  return service as SuggestedTradesProtectionGuardrailService;
}

async function runGuardrailScenario(input: {
  execution: Record<string, unknown>;
  orders?: Record<string, unknown>[];
  positions?: Record<string, unknown>[];
  alerts?: Array<Record<string, unknown>>;
  recoveryCalls?: Array<Record<string, unknown>>;
  updates?: Array<{ sql: string; params?: unknown[] }>;
}) {
  const service = createService(input.alerts, input.recoveryCalls);
  return withMockedQuery(
    async (sql, params) => {
      if (sql.includes('UPDATE suggested_trade_executions')) {
        input.updates?.push({ sql, params });
        return [];
      }
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
  const updates: Array<{ sql: string; params?: unknown[] }> = [];
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
    updates,
  });

  assert.equal(response.status, 'ok');
  assert.equal(response.issueTrades, 0);
  assert.equal(response.readBackReconciliations, 1);
  assert.equal(response.items[0]?.readBackReason, 'broker_verified_state_reconciled');
  assert.equal(alerts.length, 0);
  assert.equal(updates.length, 1);
  assert.ok(updates[0]?.params?.[0] instanceof Date);
  assert.ok(updates[0]?.params?.[1] instanceof Date);
}

async function testAttachedMudrexMissingTakeProfitAlerts(): Promise<void> {
  const alerts: Array<Record<string, unknown>> = [];
  const recoveryCalls: Array<Record<string, unknown>> = [];
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
    recoveryCalls,
  });

  assert.equal(response.status, 'degraded');
  assert.equal(response.items[0]?.issues[0]?.code, 'attached_protection_inactive');
  assert.equal(response.recoveriesTriggered, 1);
  assert.equal(response.items[0]?.watchdogStatus, 'needs_repair');
  assert.match(String(response.items[0]?.watchdogReason || ''), /missing take profit/);
  assert.equal(response.items[0]?.recoveryTriggered, true);
  assert.equal(response.items[0]?.recoveryRefreshed, 1);
  assert.equal(alerts.length, 1);
  assert.match(String(alerts[0]?.message || ''), /mudrex ETHUSDT/);
  assert.deepEqual(recoveryCalls, [
    {
      userId: 'user-1',
      brokerKey: 'mudrex',
      accountId: 'acct-1',
      symbols: ['ETHUSDT'],
    },
  ]);
}

async function testAttachedMudrexZeroProtectionPricesAlert(): Promise<void> {
  const alerts: Array<Record<string, unknown>> = [];
  const recoveryCalls: Array<Record<string, unknown>> = [];
  const response = await runGuardrailScenario({
    execution: createExecution({
      brokerKey: 'mudrex',
      symbol: 'SOLUSDT',
      protectionPlanJson: {},
    }),
    positions: [
      createPosition({
        symbol: 'SOLUSDT',
        stopLossPrice: '0',
        takeProfitPrice: '0',
      }),
    ],
    alerts,
    recoveryCalls,
  });

  assert.equal(response.status, 'degraded');
  assert.equal(response.items[0]?.issues[0]?.code, 'attached_protection_inactive');
  assert.equal(response.items[0]?.watchdogStatus, 'needs_repair');
  assert.match(
    String(response.items[0]?.watchdogReason || ''),
    /missing stop loss and take profit/
  );
  assert.equal(response.readBackReconciliations, 0);
  assert.equal(response.recoveriesTriggered, 1);
  assert.equal(response.items[0]?.recoveryTriggered, true);
  assert.equal(response.items[0]?.recoveryRefreshed, 1);
  assert.equal(alerts.length, 1);
  assert.deepEqual(recoveryCalls, [
    {
      userId: 'user-1',
      brokerKey: 'mudrex',
      accountId: 'acct-1',
      symbols: ['SOLUSDT'],
    },
  ]);
}

async function testFailedMudrexReadBackClearsFalseError(): Promise<void> {
  const alerts: Array<Record<string, unknown>> = [];
  const updates: Array<{ sql: string; params?: unknown[] }> = [];
  const response = await runGuardrailScenario({
    execution: createExecution({
      brokerKey: 'mudrex',
      symbol: 'XRPUSDT',
      orderStatus: 'PARTIALLY_FILLED',
      quantity: 100,
      filledQuantity: 40,
      remainingQuantity: 60,
      protectionState: 'failed',
      protectionLastError: 'Trailing SL update failed: Risk order amendment failed',
      protectionPlanJson: {
        trailingStop: {
          enabled: true,
          lastError: 'Trailing SL update failed: Risk order amendment failed',
        },
      },
      protectionAttachedAt: null,
    }),
    positions: [
      createPosition({
        externalId: 'mudrex-xrp-position',
        symbol: 'XRPUSDT',
        stopLossOrderId: 'mudrex-sl-1',
        stopLossPrice: '1.23',
        takeProfitOrderId: 'mudrex-tp-1',
        takeProfitPrice: '1.11',
        positionSize: '40',
      }),
    ],
    alerts,
    updates,
  });

  assert.equal(response.status, 'ok');
  assert.equal(response.issueTrades, 0);
  assert.equal(response.readBackReconciliations, 1);
  assert.equal(response.recoveryFailures, 0);
  assert.equal(response.items[0]?.protectionState, 'attached');
  assert.equal(response.items[0]?.protectionLastError, null);
  assert.equal(response.items[0]?.partialFill, true);
  assert.equal(response.items[0]?.positionSize, '40');
  assert.equal(response.items[0]?.watchdogStatus, 'broker_verified_after_error');
  assert.equal(response.items[0]?.readBackReason, 'broker_verified_after_error');
  assert.equal(alerts.length, 0);
  assert.equal(updates.length, 1);
  assert.ok(updates[0]?.params?.[0] instanceof Date);
  assert.ok(updates[0]?.params?.[1] instanceof Date);
  const plan = JSON.parse(String(updates[0]?.params?.[6] || '{}')) as Record<string, unknown>;
  assert.equal(plan.mudrexReadBackReason, 'broker_verified_after_error');
  assert.equal(plan.stopLossOrderId, 'mudrex-sl-1');
  assert.equal(plan.takeProfitOrderId, 'mudrex-tp-1');
  assert.equal((plan.mudrexProtectionWatchdog as Record<string, unknown>)?.positionSize, '40');
  assert.equal(
    ((plan.trailingStop as Record<string, unknown>)?.lastAudit as Record<string, unknown>)?.reason,
    'broker_verified_after_error'
  );
}

async function testMudrexStalePositionIdDoesNotBindSameSymbolPosition(): Promise<void> {
  const alerts: Array<Record<string, unknown>> = [];
  const updates: Array<{ sql: string; params?: unknown[] }> = [];
  const response = await runGuardrailScenario({
    execution: createExecution({
      brokerKey: 'mudrex',
      symbol: 'SOLUSDT',
      positionId: 'older-sol-position',
      protectionPlanJson: {},
    }),
    positions: [
      createPosition({
        externalId: 'newer-sol-position',
        symbol: 'SOLUSDT',
        stopLossPrice: '0',
        takeProfitPrice: '0',
      }),
    ],
    alerts,
    updates,
  });

  assert.equal(response.status, 'ok');
  assert.equal(response.issueTrades, 0);
  assert.equal(response.items[0]?.positionSymbol, null);
  assert.equal(response.items[0]?.watchdogStatus, 'unknown');
  assert.equal(response.readBackReconciliations, 0);
  assert.equal(alerts.length, 0);
  assert.equal(updates.length, 0);
}

async function main(): Promise<void> {
  await testAttachedDeltaWithActiveOrdersPasses();
  await testAttachedDeltaWithCancelledProtectionAlerts();
  await testDeltaFilledWaitingForPositionStaleAlerts();
  await testAttachedMudrexWithPositionProtectionPasses();
  await testAttachedMudrexMissingTakeProfitAlerts();
  await testAttachedMudrexZeroProtectionPricesAlert();
  await testFailedMudrexReadBackClearsFalseError();
  await testMudrexStalePositionIdDoesNotBindSameSymbolPosition();
  console.log('Suggested trades protection guardrail assertions passed.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
