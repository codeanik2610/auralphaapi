require('reflect-metadata');

const { Container } = require('typedi');
const { iocLoader } = require('/app/dist/src/loaders/IocLoader.js');
const { initializeCoreDataSource } = require('/app/dist/src/database/initializeCoreDataSource.js');
const { coreDataSource } = require('/app/dist/src/database/data-source.js');
const { BrokerRuntimeRegistry } = require('/app/dist/src/brokers/core/BrokerRuntimeRegistry.js');

const USER_ID = 'aed8a75e-0113-4659-9582-28fc2120278c';
const ACCOUNT_ID = 'cd24939b-afb1-4678-a506-bbe9fb6085b4';
const BROKER_KEY = 'delta_exchange';
const SYMBOL = 'TRXUSD';
const ORDER_IDS = ['1304444519', '1304444551'];

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.data)) return value.data;
  if (value && value.data && Array.isArray(value.data.items)) return value.data.items;
  if (value && Array.isArray(value.items)) return value.items;
  if (value && Array.isArray(value.result)) return value.result;
  return [];
}

function read(value, keys) {
  for (const key of keys) {
    const raw = value && value[key];
    if (raw !== undefined && raw !== null && String(raw).trim() !== '') return raw;
  }
  return null;
}

function isReduceOnly(value) {
  return value === true || String(value).trim().toLowerCase() === 'true' || Number(value) === 1;
}

function summarizeOrder(order) {
  return {
    id: String(read(order, ['id', 'order_id']) || ''),
    symbol: String(read(order, ['symbol', 'product_symbol']) || '').toUpperCase(),
    status: String(read(order, ['status', 'state']) || '').toLowerCase(),
    side: String(read(order, ['side']) || '').toLowerCase(),
    type: String(read(order, ['type', 'order_type']) || '').toLowerCase(),
    stopOrderType: String(read(order, ['stop_order_type', 'stopOrderType']) || '').toLowerCase(),
    reduceOnly: isReduceOnly(read(order, ['reduce_only', 'reduceOnly'])),
    price: read(order, ['price', 'limit_price', 'stop_price', 'trigger_price']),
    quantity: read(order, ['quantity', 'size']),
    clientOrderId: read(order, ['client_order_id', 'clientOrderId']),
    createdAt: read(order, ['created_at', 'createdAt']),
    updatedAt: read(order, ['updated_at', 'updatedAt']),
  };
}

function assertSafeTarget(order) {
  if (!ORDER_IDS.includes(order.id)) {
    throw new Error(`Unexpected order id ${order.id}`);
  }
  if (order.symbol !== SYMBOL) {
    throw new Error(`Order ${order.id} is ${order.symbol}, expected ${SYMBOL}`);
  }
  if (!['pending', 'open'].includes(order.status)) {
    throw new Error(`Order ${order.id} is not live/open: ${order.status}`);
  }
  if (order.side !== 'buy') {
    throw new Error(`Order ${order.id} side is ${order.side}, expected buy`);
  }
  if (!order.reduceOnly) {
    throw new Error(`Order ${order.id} is not reduce-only`);
  }
  if (!['stop_loss_order', 'take_profit_order'].includes(order.stopOrderType)) {
    throw new Error(`Order ${order.id} is not SL/TP protection: ${order.stopOrderType}`);
  }
}

async function main() {
  iocLoader();
  await initializeCoreDataSource();

  const registry = Container.get(BrokerRuntimeRegistry);
  const adapter = registry.getOrdersAdapter(BROKER_KEY);
  const openOrders = asArray(
    await adapter.listOpenOrders(
      { limit: 100 },
      { userId: USER_ID, brokerKey: BROKER_KEY, accountId: ACCOUNT_ID }
    )
  ).map(summarizeOrder);
  const targets = openOrders.filter((order) => ORDER_IDS.includes(order.id));

  if (targets.length !== ORDER_IDS.length) {
    throw new Error(
      `Expected ${ORDER_IDS.length} target live orders, found ${targets.length}: ${targets
        .map((order) => order.id)
        .join(',')}`
    );
  }

  for (const target of targets) {
    assertSafeTarget(target);
  }

  const results = [];
  for (const target of targets) {
    const response = await adapter.cancelOrder(target.id, {
      userId: USER_ID,
      brokerKey: BROKER_KEY,
      accountId: ACCOUNT_ID,
    });
    results.push({ target, response });
  }

  console.log(
    JSON.stringify(
      {
        cancelledAt: new Date().toISOString(),
        brokerKey: BROKER_KEY,
        accountId: ACCOUNT_ID,
        symbol: SYMBOL,
        cancelledOrderIds: ORDER_IDS,
        results,
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (coreDataSource.isInitialized) {
      await coreDataSource.destroy();
    }
  });
