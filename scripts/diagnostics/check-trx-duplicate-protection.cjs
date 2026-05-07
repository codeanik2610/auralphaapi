require('reflect-metadata');

const { Container } = require('typedi');
const { iocLoader } = require('/app/dist/src/loaders/IocLoader.js');
const { initializeCoreDataSource } = require('/app/dist/src/database/initializeCoreDataSource.js');
const { coreDataSource } = require('/app/dist/src/database/data-source.js');
const { BrokerRuntimeRegistry } = require('/app/dist/src/brokers/core/BrokerRuntimeRegistry.js');

const USER_ID = 'aed8a75e-0113-4659-9582-28fc2120278c';
const ACCOUNT_ID = 'cd24939b-afb1-4678-a506-bbe9fb6085b4';
const BROKER_KEY = 'delta_exchange';
const SYMBOL = process.env.SYMBOL || 'TRXUSD';
const SYMBOL_ALIASES = Array.from(
  new Set([SYMBOL, SYMBOL.replace(/USD$/, 'USDT')].map((value) => value.toUpperCase()))
);

function safeJson(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function read(value, keys) {
  for (const key of keys) {
    const raw = value && value[key];
    if (raw !== undefined && raw !== null && String(raw).trim() !== '') return raw;
  }
  return null;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.data)) return value.data;
  if (value && value.data && Array.isArray(value.data.items)) return value.data.items;
  if (value && Array.isArray(value.items)) return value.items;
  if (value && Array.isArray(value.result)) return value.result;
  return [];
}

function normalizeRow(row) {
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = value instanceof Date ? value.toISOString() : value;
  }
  return out;
}

function summarizeSnapshot(row) {
  const payload = safeJson(row.payloadJson);
  return {
    ...row,
    payloadJson: undefined,
    payload: {
      id: read(payload, ['id', 'order_id']),
      product_id: read(payload, ['product_id']),
      product_symbol: read(payload, ['product_symbol', 'symbol']),
      side: read(payload, ['side']),
      state: read(payload, ['state', 'status']),
      order_type: read(payload, ['order_type', 'type']),
      stop_order_type: read(payload, ['stop_order_type']),
      reduce_only: read(payload, ['reduce_only', 'reduceOnly']),
      price: read(payload, ['price', 'limit_price']),
      stop_price: read(payload, ['stop_price', 'trigger_price']),
      size: read(payload, ['size', 'quantity']),
      unfilled_size: read(payload, ['unfilled_size']),
      client_order_id: read(payload, ['client_order_id']),
      created_at: read(payload, ['created_at']),
      updated_at: read(payload, ['updated_at']),
    },
  };
}

function summarizeLiveOrder(order) {
  return {
    id: read(order, ['id', 'order_id']),
    symbol: read(order, ['symbol', 'product_symbol']),
    side: read(order, ['side']),
    status: read(order, ['status', 'state']),
    type: read(order, ['type', 'order_type']),
    stopOrderType: read(order, ['stop_order_type', 'stopOrderType']),
    reduceOnly: read(order, ['reduce_only', 'reduceOnly']),
    price: read(order, ['price', 'limit_price']),
    triggerPrice: read(order, ['stop_price', 'trigger_price']),
    quantity: read(order, ['quantity', 'size']),
    createdAt: read(order, ['created_at', 'createdAt']),
    updatedAt: read(order, ['updated_at', 'updatedAt']),
    clientOrderId: read(order, ['client_order_id', 'clientOrderId']),
  };
}

async function query(sql, params = []) {
  return (await coreDataSource.query(sql, params)).map(normalizeRow);
}

async function main() {
  iocLoader();
  await initializeCoreDataSource();

  const snapshots = await query(
    `SELECT id,
            external_id AS externalId,
            symbol,
            order_status AS orderStatus,
            status_rank AS statusRank,
            last_seen_at AS lastSeenAt,
            first_seen_at AS firstSeenAt,
            payload_json AS payloadJson,
            JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.order_type')) AS orderType,
            JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.stop_order_type')) AS stopOrderType,
            JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.side')) AS side,
            JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.reduce_only')) AS reduceOnly,
            JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.price')) AS price,
            JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.stop_price')) AS stopPrice,
            JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.created_at')) AS brokerCreatedAt,
            JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.updated_at')) AS brokerUpdatedAt,
            JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.client_order_id')) AS clientOrderId
       FROM scheduler_orders_snapshots
      WHERE user_id = ?
        AND account_id = ?
        AND LOWER(broker_key) = ?
        AND UPPER(symbol) = ?
      ORDER BY first_seen_at ASC, external_id ASC`,
    [USER_ID, ACCOUNT_ID, BROKER_KEY, SYMBOL]
  );

  const activeProtectionOrderIds = snapshots
    .filter((row) => Number(row.statusRank) > 0 && Number(row.statusRank) <= 2)
    .filter((row) =>
      ['stop_loss_order', 'take_profit_order'].includes(
        String(row.stopOrderType || '').toLowerCase()
      )
    )
    .map((row) => String(row.externalId));

  const ids = activeProtectionOrderIds.length ? activeProtectionOrderIds : ['__none__'];
  const placeholders = ids.map(() => '?').join(',');

  const submissions = await query(
    `SELECT id,
            suggested_trade_id AS suggestedTradeId,
            asset_id AS assetId,
            status,
            placement_state AS placementState,
            broker_order_id AS brokerOrderId,
            broker_order_status AS brokerOrderStatus,
            reconciliation_state AS reconciliationState,
            created_at AS createdAt,
            updated_at AS updatedAt,
            completed_at AS completedAt,
            JSON_UNQUOTE(JSON_EXTRACT(request_json, '$.order.symbol')) AS requestOrderSymbol,
            JSON_UNQUOTE(JSON_EXTRACT(response_json, '$.order_id')) AS responseOrderId,
            JSON_UNQUOTE(JSON_EXTRACT(response_json, '$.stop_loss_order_id')) AS stopLossOrderId,
            JSON_UNQUOTE(JSON_EXTRACT(response_json, '$.take_profit_order_id')) AS takeProfitOrderId,
            JSON_UNQUOTE(JSON_EXTRACT(response_json, '$.data.order_id')) AS dataOrderId,
            JSON_UNQUOTE(JSON_EXTRACT(response_json, '$.data.stop_loss_order_id')) AS dataStopLossOrderId,
            JSON_UNQUOTE(JSON_EXTRACT(response_json, '$.data.take_profit_order_id')) AS dataTakeProfitOrderId,
            response_json AS responseJson
       FROM order_submission_requests
      WHERE user_id = ?
        AND LOWER(COALESCE(broker_key, '')) = ?
        AND account_id = ?
        AND (
             broker_order_id IN (${placeholders})
          OR JSON_UNQUOTE(JSON_EXTRACT(response_json, '$.stop_loss_order_id')) IN (${placeholders})
          OR JSON_UNQUOTE(JSON_EXTRACT(response_json, '$.take_profit_order_id')) IN (${placeholders})
          OR JSON_UNQUOTE(JSON_EXTRACT(response_json, '$.data.stop_loss_order_id')) IN (${placeholders})
          OR JSON_UNQUOTE(JSON_EXTRACT(response_json, '$.data.take_profit_order_id')) IN (${placeholders})
          OR JSON_UNQUOTE(JSON_EXTRACT(request_json, '$.order.symbol')) IN (${SYMBOL_ALIASES.map(() => '?').join(',')})
        )
      ORDER BY created_at ASC`,
    [USER_ID, BROKER_KEY, ACCOUNT_ID, ...ids, ...ids, ...ids, ...ids, ...ids, ...SYMBOL_ALIASES]
  );

  const suggestedTradeIds = Array.from(
    new Set(submissions.map((row) => String(row.suggestedTradeId || '').trim()).filter(Boolean))
  );
  const suggestedPlaceholders = suggestedTradeIds.length
    ? suggestedTradeIds.map(() => '?').join(',')
    : '?';
  const suggestedParams = suggestedTradeIds.length ? suggestedTradeIds : ['__none__'];

  const executions = await query(
    `SELECT ste.suggested_trade_id AS suggestedTradeId,
            st.automation_id AS automationId,
            st.automation_run_id AS automationRunId,
            st.symbol,
            st.timeframe,
            st.side,
            st.status AS tradeStatus,
            st.signal_time AS signalTime,
            st.created_at AS suggestedTradeCreatedAt,
            a.name AS automationName,
            a.status AS automationStatus,
            ste.order_id AS orderId,
            ste.order_status AS orderStatus,
            ste.execution_state AS executionState,
            ste.position_id AS positionId,
            ste.position_status AS positionStatus,
            ste.protection_state AS protectionState,
            ste.protection_attempts AS protectionAttempts,
            ste.protection_source AS protectionSource,
            ste.protection_last_error AS protectionLastError,
            ste.submitted_at AS submittedAt,
            ste.linked_at AS linkedAt,
            ste.filled_at AS filledAt,
            ste.position_opened_at AS positionOpenedAt,
            ste.position_closed_at AS positionClosedAt,
            ste.updated_at AS updatedAt,
            ste.note
       FROM suggested_trade_executions ste
       LEFT JOIN suggested_trades st
         ON st.id = ste.suggested_trade_id
       LEFT JOIN automations a
         ON a.id = st.automation_id
      WHERE ste.suggested_trade_id IN (${suggestedPlaceholders})
         OR (
              ste.user_id = ?
          AND LOWER(COALESCE(ste.broker_key, '')) = ?
          AND ste.account_id = ?
          AND UPPER(st.symbol) IN (${SYMBOL_ALIASES.map(() => '?').join(',')})
          AND ste.updated_at >= DATE_SUB(NOW(), INTERVAL 2 DAY)
         )
      ORDER BY ste.updated_at ASC`,
    [...suggestedParams, USER_ID, BROKER_KEY, ACCOUNT_ID, ...SYMBOL_ALIASES]
  );

  const positions = await query(
    `SELECT external_id AS externalId,
            symbol,
            side,
            status,
            status_rank AS statusRank,
            entry_price AS entryPrice,
            current_price AS currentPrice,
            stoploss_price AS stopLossPrice,
            takeprofit_price AS takeProfitPrice,
            stoploss_order_id AS stopLossOrderId,
            takeprofit_order_id AS takeProfitOrderId,
            position_created_at AS openedAt,
            position_closed_at AS closedAt,
            updated_at AS updatedAt
       FROM position_read_models
      WHERE user_id = ?
        AND account_id = ?
        AND LOWER(broker_key) = ?
        AND UPPER(symbol) = ?
      ORDER BY updated_at DESC`,
    [USER_ID, ACCOUNT_ID, BROKER_KEY, SYMBOL]
  );

  const registry = Container.get(BrokerRuntimeRegistry);
  const ordersAdapter = registry.getOrdersAdapter(BROKER_KEY);
  const liveOrders = asArray(
    await ordersAdapter.listOpenOrders(
      { limit: 100 },
      { userId: USER_ID, accountId: ACCOUNT_ID, brokerKey: BROKER_KEY }
    )
  )
    .filter(
      (order) => String(read(order, ['symbol', 'product_symbol']) || '').toUpperCase() === SYMBOL
    )
    .map(summarizeLiveOrder);

  const output = {
    checkedAt: new Date().toISOString(),
    scope: { brokerKey: BROKER_KEY, accountId: ACCOUNT_ID, symbol: SYMBOL },
    activeProtectionOrderIds,
    positionRows: positions,
    orderSnapshots: snapshots.map(summarizeSnapshot),
    relatedSubmissions: submissions.map((row) => ({
      ...row,
      responseJson: undefined,
      response: safeJson(row.responseJson),
    })),
    relatedExecutions: executions,
    liveOrders,
  };

  console.log(JSON.stringify(output, null, 2));
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
