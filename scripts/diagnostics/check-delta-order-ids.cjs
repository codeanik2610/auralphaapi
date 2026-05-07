require('reflect-metadata');

const { Container } = require('typedi');
const { iocLoader } = require('/app/dist/src/loaders/IocLoader.js');
const { initializeCoreDataSource } = require('/app/dist/src/database/initializeCoreDataSource.js');
const { coreDataSource } = require('/app/dist/src/database/data-source.js');
const { BrokerRuntimeRegistry } = require('/app/dist/src/brokers/core/BrokerRuntimeRegistry.js');

const USER_ID = process.env.USER_ID || 'aed8a75e-0113-4659-9582-28fc2120278c';
const ACCOUNT_ID = process.env.ACCOUNT_ID || 'cd24939b-afb1-4678-a506-bbe9fb6085b4';
const BROKER_KEY = 'delta_exchange';
const ORDER_IDS = process.argv
  .slice(2)
  .map((value) => String(value || '').trim())
  .filter(Boolean);

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.data)) return value.data;
  if (value && value.data && Array.isArray(value.data.items)) return value.data.items;
  if (value && Array.isArray(value.items)) return value.items;
  if (value && Array.isArray(value.result)) return value.result;
  return [];
}

async function main() {
  if (!ORDER_IDS.length) {
    throw new Error('Pass one or more order ids.');
  }

  iocLoader();
  await initializeCoreDataSource();

  const registry = Container.get(BrokerRuntimeRegistry);
  const adapter = registry.getOrdersAdapter(BROKER_KEY);
  const context = { userId: USER_ID, brokerKey: BROKER_KEY, accountId: ACCOUNT_ID };
  const orders = [];
  for (const orderId of ORDER_IDS) {
    try {
      orders.push({ orderId, response: await adapter.getOrder(orderId, context) });
    } catch (error) {
      orders.push({
        orderId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const openOrders = asArray(await adapter.listOpenOrders({ limit: 100 }, context));

  console.log(
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        brokerKey: BROKER_KEY,
        accountId: ACCOUNT_ID,
        orderIds: ORDER_IDS,
        orders,
        matchingOpenOrders: openOrders.filter((order) =>
          ORDER_IDS.includes(String(order && (order.id || order.order_id || order.orderId)))
        ),
        crossOpenOrders: openOrders.filter((order) =>
          String(order && (order.symbol || order.product_symbol || ''))
            .toUpperCase()
            .includes('CROSS')
        ),
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
