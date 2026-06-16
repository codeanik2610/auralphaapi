import 'reflect-metadata';
import assert from 'node:assert/strict';
import { Container } from 'typedi';
import { BrokerRuntimeRegistry } from '../../src/brokers/core/BrokerRuntimeRegistry';
import { coreDataSource } from '../../src/database/data-source';
import { initializeCoreDataSource } from '../../src/database/initializeCoreDataSource';

interface NormalizedPosition {
  source: string;
  brokerKey: string;
  accountId: string;
  externalId: string;
  symbol: string;
  side: string;
  status: string;
  quantity: number;
  entryPrice: number | null;
  closedPrice: number | null;
  realizedPnl: number;
  time: string | null;
}

interface SummaryItem {
  key: string;
  count: number;
  quantity: number;
  realizedPnl: number;
  symbols: string[];
  sides: string[];
  statuses: string[];
}

interface DiffItem {
  key: string;
  dbCount: number;
  brokerCount: number;
  countDiff: number;
  dbQuantity: number;
  brokerQuantity: number;
  quantityDiff: number;
  dbPnl: number;
  brokerPnl: number;
  pnlDiff: number;
}

function parseCsv(value: string): string[] {
  return Array.from(
    new Set(
      String(value || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
}

function readPositiveNumber(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function readRequiredDateKey(value: string | undefined, name: string): string {
  const raw = String(value || '').trim();
  assert.match(raw, /^\d{4}-\d{2}-\d{2}$/, `${name} must be YYYY-MM-DD`);
  return raw;
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    const record = value as { data?: unknown; items?: unknown };
    if (Array.isArray(record.data)) return record.data;
    if (Array.isArray(record.items)) return record.items;
  }
  return [];
}

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function pick(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return value;
    }
  }
  return null;
}

function parseJson(value: unknown): Record<string, unknown> {
  try {
    if (typeof value === 'string') {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    }
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function normalizeStatus(record: Record<string, unknown>): string {
  const raw = String(
    pick(record, ['status_key', 'statusKey', 'status', 'state', 'position_status']) || ''
  ).toLowerCase();
  if (['open', 'active'].includes(raw)) return 'open';
  if (['closed', 'close', 'filled', 'completed', 'done'].includes(raw)) return 'closed';
  if (raw.includes('liquid')) return 'liquidated';
  if (raw === 'partial' || raw.includes('partial')) return 'partial';
  return raw || 'unknown';
}

function normalizeSide(record: Record<string, unknown>): string {
  const raw = String(pick(record, ['side_key', 'sideKey', 'side', 'position_type']) || '')
    .trim()
    .toLowerCase();
  if (['buy', 'long'].includes(raw)) return 'long';
  if (['sell', 'short'].includes(raw)) return 'short';
  return raw || 'unknown';
}

function symbolOf(record: Record<string, unknown>): string {
  return String(
    pick(record, ['symbol', 'product_symbol', 'productSymbol', 'instrument', 'asset', 'pair']) ||
      'UNKNOWN'
  ).toUpperCase();
}

function externalIdOf(record: Record<string, unknown>): string {
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

function quantityOf(record: Record<string, unknown>): number {
  return Math.abs(
    toNumber(pick(record, ['quantity', 'size', 'open_quantity', 'qty', 'contracts']))
  );
}

function realizedPnlOf(record: Record<string, unknown>): number {
  return toNumber(pick(record, ['realized_pnl', 'realizedPnl', 'pnl', 'realized', 'profit']));
}

function timeRawOf(record: Record<string, unknown>): unknown {
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

function normalizePosition(
  record: Record<string, unknown>,
  source: string,
  brokerKey: string,
  accountId: string
): NormalizedPosition {
  const timeRaw = timeRawOf(record);
  return {
    source,
    brokerKey,
    accountId,
    externalId: externalIdOf(record),
    symbol: symbolOf(record),
    side: normalizeSide(record),
    status: normalizeStatus(record),
    quantity: quantityOf(record),
    entryPrice: toNumber(
      pick(record, ['entry_price', 'entryPrice', 'average_entry_price', 'avg_entry_price']),
      Number.NaN
    ),
    closedPrice: toNumber(
      pick(record, ['closed_price', 'closedPrice', 'close_price', 'exit_price']),
      Number.NaN
    ),
    realizedPnl: realizedPnlOf(record),
    time: timeRaw ? new Date(String(timeRaw)).toISOString() : null,
  };
}

function isInWindow(item: NormalizedPosition, startMs: number, endMs: number): boolean {
  const time = item.time ? Date.parse(item.time) : 0;
  return time >= startMs && time <= endMs;
}

function dayOf(item: NormalizedPosition): string {
  return item.time ? item.time.slice(0, 10) : 'unknown';
}

function addSummary(map: Map<string, SummaryItem>, key: string, item: NormalizedPosition): void {
  const summary = map.get(key) || {
    key,
    count: 0,
    quantity: 0,
    realizedPnl: 0,
    symbols: [],
    sides: [],
    statuses: [],
  };
  summary.count += 1;
  summary.quantity += item.quantity || 0;
  summary.realizedPnl += item.realizedPnl || 0;
  if (!summary.symbols.includes(item.symbol)) summary.symbols.push(item.symbol);
  if (!summary.sides.includes(item.side)) summary.sides.push(item.side);
  if (!summary.statuses.includes(item.status)) summary.statuses.push(item.status);
  map.set(key, summary);
}

function summarize(items: NormalizedPosition[]): {
  byAccount: SummaryItem[];
  byStatus: SummaryItem[];
  byDayStatus: SummaryItem[];
  bySymbolStatus: SummaryItem[];
} {
  const byAccount = new Map<string, SummaryItem>();
  const byStatus = new Map<string, SummaryItem>();
  const byDayStatus = new Map<string, SummaryItem>();
  const bySymbolStatus = new Map<string, SummaryItem>();

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

  const asArraySorted = (map: Map<string, SummaryItem>) =>
    Array.from(map.values())
      .map((item) => ({
        ...item,
        quantity: Number(item.quantity.toFixed(8)),
        realizedPnl: Number(item.realizedPnl.toFixed(8)),
        symbols: item.symbols.slice(0, 12),
      }))
      .sort((left, right) => left.key.localeCompare(right.key));

  return {
    byAccount: asArraySorted(byAccount),
    byStatus: asArraySorted(byStatus),
    byDayStatus: asArraySorted(byDayStatus),
    bySymbolStatus: asArraySorted(bySymbolStatus),
  };
}

function compareSummary(leftItems: SummaryItem[], rightItems: SummaryItem[]): DiffItem[] {
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

function mapByExternalId(items: NormalizedPosition[]): Map<string, NormalizedPosition> {
  const map = new Map<string, NormalizedPosition>();
  for (const item of items) {
    if (!item.externalId) continue;
    map.set(`${item.brokerKey}|${item.accountId}|${item.externalId}`, item);
  }
  return map;
}

async function run(): Promise<void> {
  const userId = String(
    process.env.POSITIONS_RECONCILIATION_USER_ID || process.argv[2] || ''
  ).trim();
  const startDate = readRequiredDateKey(
    process.env.POSITIONS_RECONCILIATION_START_DATE || process.argv[3],
    'POSITIONS_RECONCILIATION_START_DATE'
  );
  const endDate = readRequiredDateKey(
    process.env.POSITIONS_RECONCILIATION_END_DATE || process.argv[4],
    'POSITIONS_RECONCILIATION_END_DATE'
  );
  assert.ok(userId, 'Provide POSITIONS_RECONCILIATION_USER_ID.');
  assert.ok(startDate <= endDate, 'POSITIONS_RECONCILIATION_START_DATE cannot be after end date.');

  const brokerKeys = parseCsv(
    process.env.POSITIONS_RECONCILIATION_BROKER_KEYS || 'mudrex,delta_exchange'
  ).map((item) => item.toLowerCase());
  const accountIds = parseCsv(process.env.POSITIONS_RECONCILIATION_ACCOUNT_IDS || '');
  const startMs = Date.parse(`${startDate}T00:00:00.000Z`);
  const endMs = Date.parse(`${endDate}T23:59:59.999Z`);
  const maxFetchErrors = readPositiveNumber(
    process.env.POSITIONS_RECONCILIATION_MAX_FETCH_ERRORS || '',
    0
  );
  const maxOutsideWindowRows = readPositiveNumber(
    process.env.POSITIONS_RECONCILIATION_MAX_OUTSIDE_WINDOW_ROWS || '',
    0
  );
  const maxStatusDiffs = readPositiveNumber(
    process.env.POSITIONS_RECONCILIATION_MAX_STATUS_DIFFS || '',
    0
  );
  const maxTotalPnlDiff = readPositiveNumber(
    process.env.POSITIONS_RECONCILIATION_MAX_TOTAL_PNL_DIFF || '',
    0.01
  );
  const maxExternalMissing = readPositiveNumber(
    process.env.POSITIONS_RECONCILIATION_MAX_EXTERNAL_MISSING || '',
    0
  );

  await initializeCoreDataSource();
  try {
    const registry = Container.get(BrokerRuntimeRegistry);
    const accountFilters = [
      'user_id = ?',
      "LOWER(status) IN ('connected', 'idle')",
      `LOWER(brokerKey) IN (${brokerKeys.map(() => '?').join(', ')})`,
    ];
    const accountParams: unknown[] = [userId, ...brokerKeys];
    if (accountIds.length) {
      accountFilters.push(`id IN (${accountIds.map(() => '?').join(', ')})`);
      accountParams.push(...accountIds);
    }

    const accounts = (await coreDataSource.query(
      `SELECT id AS accountId,
              brokerKey AS brokerKey,
              accountKey AS accountKey,
              status
         FROM broker_accounts
        WHERE ${accountFilters.join(' AND ')}
        ORDER BY brokerKey ASC, id ASC`,
      accountParams
    )) as Array<{ accountId?: string; brokerKey?: string; accountKey?: string; status?: string }>;

    assert.ok(
      accounts.length > 0,
      'No connected broker accounts matched the reconciliation scope.'
    );

    const dbRows = (await coreDataSource.query(
      `SELECT account_id,
              broker_key,
              external_id,
              symbol,
              side_key,
              status_key,
              quantity,
              entry_price,
              closed_price,
              realized_pnl,
              position_created_at,
              position_updated_at,
              position_closed_at,
              first_seen_at,
              last_seen_at,
              payload_json
         FROM position_read_models
        WHERE user_id = ?
          AND account_id IN (${accounts.map(() => '?').join(', ')})`,
      [userId, ...accounts.map((account) => account.accountId)]
    )) as Array<Record<string, unknown>>;

    const dbItems = dbRows
      .map((row) => ({ ...parseJson(row.payload_json), ...row }))
      .map((row) =>
        normalizePosition(
          row,
          'db_read_model',
          String(row.broker_key || '').toLowerCase(),
          String(row.account_id || '')
        )
      )
      .filter((item) => isInWindow(item, startMs, endMs));

    const brokerRawItems: NormalizedPosition[] = [];
    const fetchErrors: Array<{
      brokerKey: string;
      accountId: string;
      source: string;
      error: string;
    }> = [];

    for (const account of accounts) {
      const brokerKey = String(account.brokerKey || '').toLowerCase();
      const accountId = String(account.accountId || '').trim();
      const adapter = registry.getPositionsAdapter(brokerKey);
      const route = { userId, accountId, brokerKey };

      try {
        for (const row of asArray(await adapter.getPositions({ limit: 50000 }, route))) {
          brokerRawItems.push(
            normalizePosition(row as Record<string, unknown>, 'broker_open', brokerKey, accountId)
          );
        }
      } catch (error) {
        fetchErrors.push({
          brokerKey,
          accountId,
          source: 'open',
          error: error instanceof Error ? error.message : String(error),
        });
      }

      try {
        for (const row of asArray(
          await adapter.getPositionHistory({ startDate, endDate, limit: '50000' }, route)
        )) {
          brokerRawItems.push(
            normalizePosition(
              row as Record<string, unknown>,
              'broker_history',
              brokerKey,
              accountId
            )
          );
        }
      } catch (error) {
        fetchErrors.push({
          brokerKey,
          accountId,
          source: 'history',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const brokerItems = brokerRawItems.filter((item) => isInWindow(item, startMs, endMs));
    const outsideWindowBrokerRows = brokerRawItems.filter(
      (item) => !isInWindow(item, startMs, endMs)
    );
    const dbSummaries = summarize(dbItems);
    const brokerSummaries = summarize(brokerItems);
    const statusDiffs = compareSummary(dbSummaries.byStatus, brokerSummaries.byStatus).sort(
      (left, right) => Math.abs(right.pnlDiff) - Math.abs(left.pnlDiff)
    );
    const dayDiffs = compareSummary(dbSummaries.byDayStatus, brokerSummaries.byDayStatus).sort(
      (left, right) => Math.abs(right.pnlDiff) - Math.abs(left.pnlDiff)
    );
    const symbolDiffs = compareSummary(
      dbSummaries.bySymbolStatus,
      brokerSummaries.bySymbolStatus
    ).sort((left, right) => Math.abs(right.pnlDiff) - Math.abs(left.pnlDiff));
    const dbById = mapByExternalId(dbItems);
    const brokerById = mapByExternalId(brokerItems);
    const brokerMissingInDb = Array.from(brokerById.keys()).filter((key) => !dbById.has(key));
    const dbMissingInBroker = Array.from(dbById.keys()).filter((key) => !brokerById.has(key));
    const dbTotalPnl = dbItems.reduce((sum, item) => sum + item.realizedPnl, 0);
    const brokerTotalPnl = brokerItems.reduce((sum, item) => sum + item.realizedPnl, 0);
    const totalPnlDiff = Number((dbTotalPnl - brokerTotalPnl).toFixed(8));

    const failedChecks = [
      {
        key: 'fetch_errors',
        observed: fetchErrors.length,
        limit: maxFetchErrors,
        passed: fetchErrors.length <= maxFetchErrors,
      },
      {
        key: 'outside_window_broker_rows',
        observed: outsideWindowBrokerRows.length,
        limit: maxOutsideWindowRows,
        passed: outsideWindowBrokerRows.length <= maxOutsideWindowRows,
      },
      {
        key: 'status_summary_diffs',
        observed: statusDiffs.length,
        limit: maxStatusDiffs,
        passed: statusDiffs.length <= maxStatusDiffs,
      },
      {
        key: 'total_pnl_diff_abs',
        observed: Math.abs(totalPnlDiff),
        limit: maxTotalPnlDiff,
        passed: Math.abs(totalPnlDiff) <= maxTotalPnlDiff,
      },
      {
        key: 'broker_external_ids_missing_in_db',
        observed: brokerMissingInDb.length,
        limit: maxExternalMissing,
        passed: brokerMissingInDb.length <= maxExternalMissing,
      },
      {
        key: 'db_external_ids_missing_in_broker',
        observed: dbMissingInBroker.length,
        limit: maxExternalMissing,
        passed: dbMissingInBroker.length <= maxExternalMissing,
      },
    ].filter((item) => !item.passed);

    const report = {
      state: failedChecks.length ? 'failed' : 'passed',
      generatedAt: new Date().toISOString(),
      window: { startDate, endDate },
      scope: {
        userId,
        brokerKeys,
        accountIds: accounts.map((account) => account.accountId),
      },
      thresholds: {
        maxFetchErrors,
        maxOutsideWindowRows,
        maxStatusDiffs,
        maxTotalPnlDiff,
        maxExternalMissing,
      },
      totals: {
        dbReadModelRowsInWindow: dbItems.length,
        brokerRowsReturnedBeforeClientFilter: brokerRawItems.length,
        brokerRowsInWindowAfterClientFilter: brokerItems.length,
        brokerRowsOutsideWindowReturnedByApi: outsideWindowBrokerRows.length,
        fetchErrors: fetchErrors.length,
        statusDiffs: statusDiffs.length,
        dayStatusDiffs: dayDiffs.length,
        symbolStatusDiffs: symbolDiffs.length,
        brokerExternalIdsMissingInDb: brokerMissingInDb.length,
        dbExternalIdsMissingInBroker: dbMissingInBroker.length,
        dbTotalPnl: Number(dbTotalPnl.toFixed(8)),
        brokerTotalPnl: Number(brokerTotalPnl.toFixed(8)),
        totalPnlDiff,
      },
      failedChecks,
      dbSummary: {
        byAccount: dbSummaries.byAccount,
        byStatus: dbSummaries.byStatus,
      },
      brokerSummary: {
        byAccount: brokerSummaries.byAccount,
        byStatus: brokerSummaries.byStatus,
      },
      largestDayStatusDiffs: dayDiffs.slice(0, 20),
      largestSymbolStatusDiffs: symbolDiffs.slice(0, 20),
      externalMismatchSamples: {
        brokerOnly: brokerMissingInDb.slice(0, 20),
        dbOnly: dbMissingInBroker.slice(0, 20),
      },
      fetchErrors,
    };

    console.log('positions-reconciliation-check:', JSON.stringify(report));
    if (failedChecks.length) {
      process.exitCode = 1;
    }
  } finally {
    if (coreDataSource.isInitialized) {
      await coreDataSource.destroy();
    }
  }
}

run().catch(async (error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  if (coreDataSource.isInitialized) {
    await coreDataSource.destroy();
  }
  process.exit(1);
});
