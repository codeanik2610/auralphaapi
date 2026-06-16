process.chdir('/app');

require('/app/node_modules/reflect-metadata');

const { Container } = require('/app/node_modules/typedi');
const { useContainer } = require('/app/node_modules/typeorm');

useContainer(Container);

const { initializeCoreDataSource } = require('/app/dist/src/database/initializeCoreDataSource');
const { coreDataSource } = require('/app/dist/src/database/data-source');
const { BrokerRuntimeRegistry } = require('/app/dist/src/brokers/core/BrokerRuntimeRegistry');

const userId = process.argv[2] || 'aed8a75e-0113-4659-9582-28fc2120278c';
const startDate = process.argv[3] || '2026-05-17';
const endDate = process.argv[4] || '2026-06-16';

const startMs = Date.parse(`${startDate}T00:00:00.000Z`);
const endMs = Date.parse(`${endDate}T23:59:59.999Z`);

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.data)) return value.data;
  if (value && Array.isArray(value.items)) return value.items;
  return [];
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function pick(record, keys) {
  for (const key of keys) {
    const value = record && record[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return value;
    }
  }
  return null;
}

function parseJson(value) {
  try {
    return typeof value === 'string' ? JSON.parse(value) : value || {};
  } catch {
    return {};
  }
}

function normalizeStatus(record) {
  const raw = String(
    pick(record, ['status_key', 'statusKey', 'status', 'state', 'position_status']) || ''
  ).toLowerCase();
  if (['open', 'active'].includes(raw)) return 'open';
  if (['closed', 'close', 'filled', 'completed', 'done'].includes(raw)) return 'closed';
  if (raw.includes('liquid')) return 'liquidated';
  if (raw === 'partial' || raw.includes('partial')) return 'partial';
  return raw || 'unknown';
}

function normalizeSide(record) {
  const raw = String(
    pick(record, ['side_key', 'sideKey', 'side', 'position_type']) || ''
  ).toLowerCase();
  if (['buy', 'long'].includes(raw)) return 'long';
  if (['sell', 'short'].includes(raw)) return 'short';
  return raw || 'unknown';
}

function symbolOf(record) {
  return String(
    pick(record, ['symbol', 'product_symbol', 'productSymbol', 'instrument', 'asset', 'pair']) ||
      'UNKNOWN'
  ).toUpperCase();
}

function externalIdOf(record) {
  return String(
    pick(record, [
      'external_id',
      'externalId',
      'future_position_uuid',
      'position_id',
      'positionId',
      'id',
      'uuid',
      'product_id',
    ]) || ''
  );
}

function quantityOf(record) {
  return Math.abs(
    toNumber(pick(record, ['quantity', 'size', 'open_quantity', 'qty', 'contracts']))
  );
}

function realizedPnlOf(record) {
  return toNumber(pick(record, ['realized_pnl', 'realizedPnl', 'pnl', 'realized', 'profit']));
}

function entryPriceOf(record) {
  return toNumber(
    pick(record, ['entry_price', 'entryPrice', 'average_entry_price', 'avg_entry_price']),
    null
  );
}

function closedPriceOf(record) {
  return toNumber(pick(record, ['closed_price', 'closedPrice', 'close_price', 'exit_price']), null);
}

function timeRawOf(record) {
  return pick(record, [
    'position_closed_at',
    'positionClosedAt',
    'closed_at',
    'closedAt',
    'position_updated_at',
    'positionUpdatedAt',
    'updated_at',
    'updatedAt',
    'last_seen_at',
    'lastSeenAt',
    'time',
    'created_at',
    'createdAt',
  ]);
}

function timeMsOf(record) {
  const date = new Date(timeRawOf(record) || 0);
  return Number.isFinite(date.getTime()) ? date.getTime() : 0;
}

function dayOf(record) {
  const ms = timeMsOf(record);
  return ms ? new Date(ms).toISOString().slice(0, 10) : 'unknown';
}

function inWindow(record) {
  const ms = timeMsOf(record);
  return ms >= startMs && ms <= endMs;
}

function normalizePosition(record, source, brokerKey, accountId) {
  return {
    source,
    brokerKey,
    accountId,
    externalId: externalIdOf(record),
    symbol: symbolOf(record),
    side: normalizeSide(record),
    status: normalizeStatus(record),
    quantity: quantityOf(record),
    entryPrice: entryPriceOf(record),
    closedPrice: closedPriceOf(record),
    realizedPnl: realizedPnlOf(record),
    time: timeRawOf(record) ? new Date(timeRawOf(record)).toISOString() : null,
  };
}

function addSummary(map, key, item) {
  const summary = map.get(key) || {
    key,
    count: 0,
    quantity: 0,
    realizedPnl: 0,
    symbols: new Set(),
    sides: new Set(),
    statuses: new Set(),
  };
  summary.count += 1;
  summary.quantity += item.quantity || 0;
  summary.realizedPnl += item.realizedPnl || 0;
  summary.symbols.add(item.symbol);
  summary.sides.add(item.side);
  summary.statuses.add(item.status);
  map.set(key, summary);
}

function summarize(map) {
  return Array.from(map.values())
    .map((item) => ({
      key: item.key,
      count: item.count,
      quantity: Number(item.quantity.toFixed(8)),
      realizedPnl: Number(item.realizedPnl.toFixed(8)),
      symbols: Array.from(item.symbols).slice(0, 12),
      sides: Array.from(item.sides),
      statuses: Array.from(item.statuses),
    }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

function mapByExternalId(items) {
  const map = new Map();
  for (const item of items) {
    if (!item.externalId) continue;
    const key = `${item.brokerKey}|${item.accountId}|${item.externalId}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...item, rows: 1 });
      continue;
    }
    existing.rows += 1;
    existing.quantity += item.quantity || 0;
    existing.realizedPnl += item.realizedPnl || 0;
  }
  return map;
}

function findExternalMismatches(dbItems, brokerItems) {
  const dbById = mapByExternalId(dbItems);
  const brokerById = mapByExternalId(brokerItems);
  const missingInDb = [];
  const missingInBroker = [];
  const fieldMismatches = [];

  for (const [key, broker] of brokerById) {
    const db = dbById.get(key);
    if (!db) {
      missingInDb.push(broker);
      continue;
    }
    const diffs = [];
    for (const field of ['symbol', 'side', 'status']) {
      if ((db[field] || null) !== (broker[field] || null)) {
        diffs.push(`${field}: db=${db[field] || null} broker=${broker[field] || null}`);
      }
    }
    if (Math.abs((db.quantity || 0) - (broker.quantity || 0)) > 1e-8) {
      diffs.push(`quantity: db=${db.quantity} broker=${broker.quantity}`);
    }
    if (Math.abs((db.realizedPnl || 0) - (broker.realizedPnl || 0)) > 0.01) {
      diffs.push(`realizedPnl: db=${db.realizedPnl} broker=${broker.realizedPnl}`);
    }
    if (diffs.length) {
      fieldMismatches.push({ key, db, broker, diffs });
    }
  }

  for (const [key, db] of dbById) {
    if (!brokerById.has(key)) {
      missingInBroker.push(db);
    }
  }

  return {
    missingInDb,
    missingInBroker,
    fieldMismatches,
  };
}

function buildSummaries(items) {
  const byAccount = new Map();
  const byStatus = new Map();
  const byDayStatus = new Map();
  const bySymbolStatus = new Map();

  for (const item of items) {
    addSummary(byAccount, `${item.brokerKey}|${item.accountId}`, item);
    addSummary(byStatus, `${item.brokerKey}|${item.accountId}|${item.status}`, item);
    addSummary(
      byDayStatus,
      `${item.brokerKey}|${item.accountId}|${dayOf(item)}|${item.status}`,
      item
    );
    addSummary(
      bySymbolStatus,
      `${item.brokerKey}|${item.accountId}|${item.symbol}|${item.status}`,
      item
    );
  }

  return {
    byAccount: summarize(byAccount),
    byStatus: summarize(byStatus),
    byDayStatus: summarize(byDayStatus),
    bySymbolStatus: summarize(bySymbolStatus),
  };
}

function compareSummary(leftItems, rightItems) {
  const left = new Map(leftItems.map((item) => [item.key, item]));
  const right = new Map(rightItems.map((item) => [item.key, item]));
  const keys = Array.from(new Set([...left.keys(), ...right.keys()])).sort();
  return keys
    .map((key) => {
      const db = left.get(key) || { count: 0, quantity: 0, realizedPnl: 0 };
      const broker = right.get(key) || { count: 0, quantity: 0, realizedPnl: 0 };
      return {
        key,
        dbCount: db.count || 0,
        brokerCount: broker.count || 0,
        countDiff: (db.count || 0) - (broker.count || 0),
        dbQuantity: Number((db.quantity || 0).toFixed(8)),
        brokerQuantity: Number((broker.quantity || 0).toFixed(8)),
        quantityDiff: Number(((db.quantity || 0) - (broker.quantity || 0)).toFixed(8)),
        dbPnl: Number((db.realizedPnl || 0).toFixed(8)),
        brokerPnl: Number((broker.realizedPnl || 0).toFixed(8)),
        pnlDiff: Number(((db.realizedPnl || 0) - (broker.realizedPnl || 0)).toFixed(8)),
      };
    })
    .filter(
      (item) =>
        item.countDiff !== 0 || Math.abs(item.quantityDiff) > 1e-8 || Math.abs(item.pnlDiff) > 0.01
    );
}

async function main() {
  await initializeCoreDataSource();
  const registry = Container.get(BrokerRuntimeRegistry);

  const accounts = await coreDataSource.query(
    `SELECT id, user_id AS userId, brokerKey AS brokerKey, accountKey AS accountKey, status
       FROM broker_accounts
      WHERE user_id = ?
        AND LOWER(status) IN ('connected', 'idle')
        AND LOWER(brokerKey) IN ('mudrex', 'delta_exchange')
      ORDER BY brokerKey, id`,
    [userId]
  );

  const dbRows = await coreDataSource.query(
    `SELECT account_id, broker_key, external_id, symbol, side_key, status_key,
            quantity, entry_price, closed_price, realized_pnl,
            position_created_at, position_updated_at, position_closed_at,
            first_seen_at, last_seen_at, payload_json
       FROM position_read_models
      WHERE user_id = ?
        AND account_id IN (
          SELECT id
            FROM broker_accounts
           WHERE user_id = ?
             AND LOWER(status) IN ('connected', 'idle')
             AND LOWER(brokerKey) IN ('mudrex', 'delta_exchange')
        )`,
    [userId, userId]
  );

  const snapshotRows = await coreDataSource.query(
    `SELECT account_id, broker_key, external_id, symbol, status,
            first_seen_at, last_seen_at, updated_at, payload_json
       FROM scheduler_positions_snapshots
      WHERE user_id = ?
        AND account_id IN (
          SELECT id
            FROM broker_accounts
           WHERE user_id = ?
             AND LOWER(status) IN ('connected', 'idle')
             AND LOWER(brokerKey) IN ('mudrex', 'delta_exchange')
        )`,
    [userId, userId]
  );

  const dbItems = dbRows
    .map((row) => ({
      ...parseJson(row.payload_json),
      ...row,
    }))
    .filter(inWindow)
    .map((row) =>
      normalizePosition(row, 'db_read_model', String(row.broker_key).toLowerCase(), row.account_id)
    );

  const snapshotItems = snapshotRows
    .map((row) => ({
      ...parseJson(row.payload_json),
      ...row,
    }))
    .filter(inWindow)
    .map((row) =>
      normalizePosition(row, 'db_snapshot', String(row.broker_key).toLowerCase(), row.account_id)
    );

  const dbExternalKeys = new Set(
    dbItems.map((item) => `${item.brokerKey}|${item.accountId}|${item.externalId}`)
  );
  const snapshotOnly = snapshotItems.filter(
    (item) => !dbExternalKeys.has(`${item.brokerKey}|${item.accountId}|${item.externalId}`)
  );

  const brokerRawItems = [];
  const fetchErrors = [];

  for (const account of accounts) {
    const brokerKey = String(account.brokerKey).toLowerCase();
    const adapter = registry.getPositionsAdapter(brokerKey);
    const route = {
      userId,
      accountId: account.id,
      brokerKey,
    };

    try {
      const rows = asArray(await adapter.getPositions({ limit: 50000 }, route));
      for (const row of rows) {
        brokerRawItems.push(normalizePosition(row, 'broker_open', brokerKey, account.id));
      }
    } catch (error) {
      fetchErrors.push({
        brokerKey,
        accountId: account.id,
        source: 'open',
        error: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      const rows = asArray(
        await adapter.getPositionHistory({ startDate, endDate, limit: '50000' }, route)
      );
      for (const row of rows) {
        brokerRawItems.push(normalizePosition(row, 'broker_history', brokerKey, account.id));
      }
    } catch (error) {
      fetchErrors.push({
        brokerKey,
        accountId: account.id,
        source: 'history',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const brokerItems = brokerRawItems.filter(inWindow);
  const outsideWindowBrokerRows = brokerRawItems.filter((item) => !inWindow(item));
  const dbSummaries = buildSummaries(dbItems);
  const brokerSummaries = buildSummaries(brokerItems);
  const externalCompare = findExternalMismatches(dbItems, brokerItems);

  const dayDiffs = compareSummary(dbSummaries.byDayStatus, brokerSummaries.byDayStatus).sort(
    (left, right) => Math.abs(right.pnlDiff) - Math.abs(left.pnlDiff)
  );
  const statusDiffs = compareSummary(dbSummaries.byStatus, brokerSummaries.byStatus).sort(
    (left, right) => Math.abs(right.pnlDiff) - Math.abs(left.pnlDiff)
  );
  const symbolDiffs = compareSummary(
    dbSummaries.bySymbolStatus,
    brokerSummaries.bySymbolStatus
  ).sort((left, right) => Math.abs(right.pnlDiff) - Math.abs(left.pnlDiff));

  const brokerPartialRows = brokerItems.filter((item) => item.status === 'partial');
  const dbPartialRows = dbItems.filter((item) => item.status === 'partial');
  const openDbRows = dbItems.filter((item) => item.status === 'open');
  const openBrokerRows = brokerItems.filter((item) => item.status === 'open');

  const report = {
    generatedAt: new Date().toISOString(),
    mode: 'read_only_baseline_audit',
    window: {
      startDate,
      endDate,
      timezoneAssumption:
        'UTC date-window passed to broker adapters; client-side filtering applied after fetch',
    },
    accounts: accounts.map((account) => ({
      brokerKey: String(account.brokerKey).toLowerCase(),
      accountId: account.id,
      accountKey: account.accountKey,
      status: account.status,
    })),
    totals: {
      dbReadModelRowsInWindow: dbItems.length,
      dbSnapshotRowsInWindow: snapshotItems.length,
      dbSnapshotOnlyRowsInWindow: snapshotOnly.length,
      brokerRowsReturnedBeforeClientFilter: brokerRawItems.length,
      brokerRowsInWindowAfterClientFilter: brokerItems.length,
      brokerRowsOutsideWindowReturnedByApi: outsideWindowBrokerRows.length,
      fetchErrors: fetchErrors.length,
      openDbRows: openDbRows.length,
      openBrokerRows: openBrokerRows.length,
      brokerPartialRows: brokerPartialRows.length,
      dbPartialRows: dbPartialRows.length,
      externalMissingInDb: externalCompare.missingInDb.length,
      externalMissingInBroker: externalCompare.missingInBroker.length,
      externalFieldMismatches: externalCompare.fieldMismatches.length,
      dayStatusDiffs: dayDiffs.length,
      statusDiffs: statusDiffs.length,
      symbolStatusDiffs: symbolDiffs.length,
    },
    dbSummary: {
      byAccount: dbSummaries.byAccount,
      byStatus: dbSummaries.byStatus,
    },
    brokerSummary: {
      byAccount: brokerSummaries.byAccount,
      byStatus: brokerSummaries.byStatus,
    },
    mismatchCategories: {
      openPositionMismatch:
        openDbRows.length !== openBrokerRows.length
          ? {
              dbOpenCount: openDbRows.length,
              brokerOpenCount: openBrokerRows.length,
              dbOpenSample: openDbRows.slice(0, 10),
              brokerOpenSample: openBrokerRows.slice(0, 10),
            }
          : null,
      brokerDateFilterLeakage:
        outsideWindowBrokerRows.length > 0
          ? {
              count: outsideWindowBrokerRows.length,
              byStatus: buildSummaries(outsideWindowBrokerRows).byStatus,
              sample: outsideWindowBrokerRows.slice(0, 10),
            }
          : null,
      mudrexPartialRowsMissingOrNotRepresented:
        brokerPartialRows.length !== dbPartialRows.length
          ? {
              dbPartialCount: dbPartialRows.length,
              brokerPartialCount: brokerPartialRows.length,
              brokerPartialPnl: Number(
                brokerPartialRows.reduce((sum, item) => sum + item.realizedPnl, 0).toFixed(8)
              ),
              dbPartialPnl: Number(
                dbPartialRows.reduce((sum, item) => sum + item.realizedPnl, 0).toFixed(8)
              ),
              brokerPartialSample: brokerPartialRows.slice(0, 20),
            }
          : null,
      deltaSplitVsAggregateLikely: statusDiffs.some((item) =>
        item.key.startsWith('delta_exchange|')
      )
        ? {
            statusDiffs: statusDiffs.filter((item) => item.key.startsWith('delta_exchange|')),
            largestDayDiffs: dayDiffs
              .filter((item) => item.key.startsWith('delta_exchange|'))
              .slice(0, 20),
          }
        : null,
      externalIdLifecycleMismatch: {
        missingInDbCount: externalCompare.missingInDb.length,
        missingInBrokerCount: externalCompare.missingInBroker.length,
        fieldMismatchCount: externalCompare.fieldMismatches.length,
        brokerOnlySample: externalCompare.missingInDb.slice(0, 20),
        dbOnlySample: externalCompare.missingInBroker.slice(0, 20),
        fieldMismatchSample: externalCompare.fieldMismatches.slice(0, 10),
      },
    },
    largestDayStatusDiffs: dayDiffs.slice(0, 30),
    largestSymbolStatusDiffs: symbolDiffs.slice(0, 30),
    fetchErrors,
  };

  console.log(JSON.stringify(report, null, 2));
  await coreDataSource.destroy();
}

main().catch(async (error) => {
  console.error(error);
  try {
    await coreDataSource.destroy();
  } catch {
    // ignore cleanup errors in one-off audit script
  }
  process.exit(1);
});
