import assert from 'node:assert/strict';

import { BadRequestAppError } from '../src/api/errors/AppError';
import { BrokerOrdersFacadeService } from '../src/api/services/BrokerOrdersFacadeService';

function createSuccess<T>(data: T) {
  return { success: true as const, data };
}

function createServiceHarness() {
  const submissions = new Map<string, any>();
  const activities: Array<Record<string, unknown>> = [];
  const alerts: Array<Record<string, unknown>> = [];
  let adapterCalls = 0;
  let nextAdapterResult: unknown = createSuccess({
    order_id: 'live-1',
    status: 'OPEN',
    message: 'Order submitted',
  });

  const service = new BrokerOrdersFacadeService() as any;

  service.brokerAccountRoutingService = {
    async resolve(userId: string, brokerKey?: string, accountId?: string) {
      return {
        userId,
        brokerKey: String(brokerKey || 'mudrex').trim() || 'mudrex',
        accountId: String(accountId || 'acct-1').trim() || 'acct-1',
      };
    },
  };

  service.riskService = {
    async evaluatePreTradeOrder() {
      return {
        blocked: false,
        reason: '',
        policyId: null,
        breaches: [],
      };
    },
  };

  service.orderSubmissionRequestRepository = {
    async findByUserAndKey(userId: string, idempotencyKey: string) {
      return submissions.get(`${userId}:${idempotencyKey}`) || null;
    },
    async createInProgress(payload: Record<string, unknown>) {
      const key = `${payload.userId}:${payload.idempotencyKey}`;
      if (submissions.has(key)) {
        const duplicate: NodeJS.ErrnoException = new Error('duplicate');
        duplicate.code = 'ER_DUP_ENTRY';
        throw duplicate;
      }

      const record = {
        id: `${payload.idempotencyKey}-record`,
        ...payload,
        status: 'in_progress',
        responsePayload: null,
        errorPayload: null,
        completedAt: null,
        failedAt: null,
        createdAt: new Date('2026-04-09T11:55:00.000Z'),
        updatedAt: new Date('2026-04-09T11:55:00.000Z'),
      };
      submissions.set(key, record);
      return record;
    },
    async markInProgress(record: Record<string, unknown>, requestHash: string) {
      const updated = {
        ...record,
        requestHash,
        status: 'in_progress',
        responsePayload: null,
        errorPayload: null,
        completedAt: null,
        failedAt: null,
        updatedAt: new Date('2026-04-09T12:00:00.000Z'),
      };
      submissions.set(`${record.userId}:${record.idempotencyKey}`, updated);
      return updated;
    },
    async markCompleted(record: Record<string, unknown>, responsePayload: Record<string, unknown>) {
      const updated = {
        ...record,
        status: 'completed',
        responsePayload,
        errorPayload: null,
        completedAt: new Date('2026-04-09T12:00:00.000Z'),
        failedAt: null,
        updatedAt: new Date('2026-04-09T12:00:00.000Z'),
      };
      submissions.set(`${record.userId}:${record.idempotencyKey}`, updated);
      return updated;
    },
    async markFailed(record: Record<string, unknown>, errorPayload: Record<string, unknown>) {
      const updated = {
        ...record,
        status: 'failed',
        responsePayload: null,
        errorPayload,
        completedAt: null,
        failedAt: new Date('2026-04-09T12:00:00.000Z'),
        updatedAt: new Date('2026-04-09T12:00:00.000Z'),
      };
      submissions.set(`${record.userId}:${record.idempotencyKey}`, updated);
      return updated;
    },
    isDuplicateIdempotencyKeyError(error: unknown) {
      return (error as { code?: string })?.code === 'ER_DUP_ENTRY';
    },
  };

  service.brokerRuntimeRegistry = {
    getOrdersAdapter() {
      return {
        async createOrder() {
          adapterCalls += 1;
          if (nextAdapterResult instanceof Error) {
            throw nextAdapterResult;
          }
          return nextAdapterResult;
        },
      };
    },
  };

  service.paperOrderRepository = {
    async createPaperOrder() {
      throw new Error('paper path not used in phase 8 service test');
    },
  };

  service.paperOrderExecutionService = {
    async simulateUserPaperOrders() {
      return {
        updatedOrderIds: [],
      };
    },
  };

  service.suggestedTradesService = {
    async linkSuggestedTradeOrder() {
      return null;
    },
    async syncExecutionForPaperOrderUpdates() {
      return null;
    },
  };

  service.operationalEventService = {
    async logActivity(_userId: string, payload: Record<string, unknown>) {
      activities.push(payload);
    },
    async emitFailureAlert(_userId: string, payload: Record<string, unknown>) {
      alerts.push(payload);
    },
  };

  return {
    service,
    submissions,
    activities,
    alerts,
    getAdapterCalls: () => adapterCalls,
    setAdapterResult: (value: unknown) => {
      nextAdapterResult = value;
    },
  };
}

async function runReplayAssertion(): Promise<void> {
  const harness = createServiceHarness();

  const body = {
    brokerKey: 'mudrex',
    accountId: 'acct-1',
    idempotency_key: 'order-submit-8-replay',
    symbol: 'BTCUSDT',
    side: 'long',
    execution_mode: 'live',
    leverage: 5,
    quantity: 1,
    order_price: 64000,
    order_type: 'market',
    trigger_type: 'immediate',
    is_takeprofit: false,
    is_stoploss: false,
    stoploss_price: 62000,
    takeprofit_price: 66000,
    reduce_only: false,
  };

  const first = await harness.service.createFuturesOrder('user-1', 'asset-1', body);
  const second = await harness.service.createFuturesOrder('user-1', 'asset-1', body);

  assert.deepEqual(second, first);
  assert.equal(harness.getAdapterCalls(), 1);
  assert.equal(
    harness.submissions.get('user-1:order-submit-8-replay')?.status,
    'completed'
  );
}

async function runConflictAssertion(): Promise<void> {
  const harness = createServiceHarness();

  await harness.service.createFuturesOrder('user-1', 'asset-1', {
    brokerKey: 'mudrex',
    accountId: 'acct-1',
    idempotency_key: 'order-submit-8-conflict',
    symbol: 'BTCUSDT',
    side: 'long',
    execution_mode: 'live',
    leverage: 5,
    quantity: 1,
    order_price: 64000,
    order_type: 'market',
    trigger_type: 'immediate',
    is_takeprofit: false,
    is_stoploss: false,
    stoploss_price: 62000,
    takeprofit_price: 66000,
    reduce_only: false,
  });

  await assert.rejects(
    () =>
      harness.service.createFuturesOrder('user-1', 'asset-1', {
        brokerKey: 'mudrex',
        accountId: 'acct-1',
        idempotency_key: 'order-submit-8-conflict',
        symbol: 'BTCUSDT',
        side: 'long',
        execution_mode: 'live',
        leverage: 5,
        quantity: 2,
        order_price: 64000,
        order_type: 'market',
        trigger_type: 'immediate',
        is_takeprofit: false,
        is_stoploss: false,
        stoploss_price: 62000,
        takeprofit_price: 66000,
        reduce_only: false,
      }),
    (error: unknown) =>
      error instanceof Error &&
      (error as { httpCode?: number }).httpCode === 409 &&
      (error as { code?: string }).code === 'ORDER_IDEMPOTENCY_KEY_REUSED'
  );

  assert.equal(harness.getAdapterCalls(), 1);
}

async function runNormalizationAssertion(): Promise<void> {
  const harness = createServiceHarness();
  harness.setAdapterResult(
    new BadRequestAppError('insufficient margin on selected account')
  );

  await assert.rejects(
    () =>
      harness.service.createFuturesOrder('user-1', 'asset-1', {
        brokerKey: 'mudrex',
        accountId: 'acct-1',
        idempotency_key: 'order-submit-8-error',
        symbol: 'BTCUSDT',
        side: 'long',
        execution_mode: 'live',
        leverage: 5,
        quantity: 1,
        order_price: 64000,
        order_type: 'market',
        trigger_type: 'immediate',
        is_takeprofit: false,
        is_stoploss: false,
        stoploss_price: 62000,
        takeprofit_price: 66000,
        reduce_only: false,
      }),
    (error: unknown) =>
      error instanceof Error &&
      (error as { httpCode?: number }).httpCode === 400 &&
      error.message === 'Order rejected: insufficient margin for this route.' &&
      (error as { code?: string }).code === 'ORDER_REJECTED_INSUFFICIENT_MARGIN'
  );

  const stored = harness.submissions.get('user-1:order-submit-8-error');
  assert.equal(stored?.status, 'failed');
  assert.equal(stored?.errorPayload?.code, 'ORDER_REJECTED_INSUFFICIENT_MARGIN');
  assert.equal(harness.alerts.length, 1);
  assert.equal(
    harness.alerts[0]?.message,
    'Order create failed: Order rejected: insufficient margin for this route.'
  );
}

async function main(): Promise<void> {
  await runReplayAssertion();
  await runConflictAssertion();
  await runNormalizationAssertion();
  console.log('Orders phase 8 checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
