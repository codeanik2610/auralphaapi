import assert from 'node:assert/strict';
import { BrokerPositionsFacadeService } from '../src/api/services/BrokerPositionsFacadeService';

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

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
