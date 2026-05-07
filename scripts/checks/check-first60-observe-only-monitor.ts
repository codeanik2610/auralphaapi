import 'reflect-metadata';

import { writeFile } from 'node:fs/promises';
import { coreDataSource } from '../../src/database/data-source';
import { initializeCoreDataSource } from '../../src/database/initializeCoreDataSource';
import { strategyDataSource } from '../../src/database/pg-data-source';
import { env } from '../../src/env';
import {
  evaluateFirst60ObserveOnlyTrade,
  First60ObserveOnlyCandle,
  First60ObserveOnlyResult,
  First60ObserveOnlyTradeInput,
} from '../../src/api/utils/first60ObserveOnlyMonitor';

type AnyRecord = Record<string, unknown>;

interface MonitorOptions {
  now: Date;
  lookbackHours: number;
  limit: number;
  minAgeMinutes: number;
  maxOutcomeLookaheadMinutes: number;
  write: boolean;
  includeItems: boolean;
  reevaluate: boolean;
  outputPath: string | null;
}

interface SuggestedTradeCandidateRow extends AnyRecord {
  id: string;
  userId: string;
  symbol: string;
  side: string;
  signalTime: Date | string;
  entryPrice: string | number | null;
  stopLossPrice: string | number | null;
  status: string | null;
  meta: Record<string, unknown> | string | null;
}

interface CandleRow extends AnyRecord {
  symbol: string;
  openTime: Date | string;
  open: number | string;
  high: number | string;
  low: number | string;
  close: number | string;
}

interface MonitorSummary {
  generatedAt: string;
  mode: 'dry-run' | 'write';
  source: {
    lookbackHours: number;
    minAgeMinutes: number;
    limit: number;
    maxOutcomeLookaheadMinutes: number;
    reevaluate: boolean;
  };
  counts: {
    candidates: number;
    candles: number;
    evaluated: number;
    writeEligible: number;
    written: number;
  };
  sideCounts: Record<string, number>;
  actionCounts: Record<string, number>;
  outcomeCounts: Record<string, number>;
  observeOnlyBuy: {
    evaluated: number;
    passed: number;
    failed: number;
    targetHits: number;
    stopHits: number;
  };
  diagnosticsOnlySell: {
    evaluated: number;
    passed: number;
    failed: number;
    targetHits: number;
    stopHits: number;
  };
  items?: First60ObserveOnlyResult[];
}

const readString = (key: string, fallback = ''): string =>
  String(process.env[key] ?? fallback).trim();

const readNumber = (key: string, fallback: number, minimum: number): number => {
  const raw = process.env[key];
  const parsed = raw === undefined || raw === '' ? fallback : Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${key} must be a number`);
  }
  return Math.max(minimum, Math.trunc(parsed));
};

const readBoolean = (key: string, fallback = false): boolean => {
  const raw = process.env[key];
  if (raw === undefined) {
    return fallback;
  }
  return ['1', 'true', 'yes', 'on'].includes(String(raw).trim().toLowerCase());
};

const readDate = (key: string): Date | null => {
  const raw = process.env[key];
  if (!raw) {
    return null;
  }
  const parsed = new Date(raw);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error(`${key} must be a valid date`);
  }
  return parsed;
};

const resolveOptions = (): MonitorOptions => ({
  now: readDate('FIRST60_OBSERVE_NOW') ?? new Date(),
  lookbackHours: readNumber('FIRST60_OBSERVE_LOOKBACK_HOURS', 72, 1),
  limit: readNumber('FIRST60_OBSERVE_LIMIT', 250, 1),
  minAgeMinutes: readNumber('FIRST60_OBSERVE_MIN_AGE_MINUTES', 60, 1),
  maxOutcomeLookaheadMinutes: readNumber('FIRST60_OBSERVE_MAX_LOOKAHEAD_MINUTES', 1440, 1),
  write: readBoolean('FIRST60_OBSERVE_WRITE', false),
  includeItems: readBoolean('FIRST60_OBSERVE_INCLUDE_ITEMS', true),
  reevaluate: readBoolean('FIRST60_OBSERVE_REEVALUATE', false),
  outputPath: readString('FIRST60_OBSERVE_OUTPUT') || null,
});

const loadCandidateTrades = async (
  options: MonitorOptions
): Promise<SuggestedTradeCandidateRow[]> => {
  const latestSignalTime = new Date(options.now.getTime() - options.minAgeMinutes * 60_000);
  const earliestSignalTime = new Date(options.now.getTime() - options.lookbackHours * 60 * 60_000);
  const reevaluateClause = options.reevaluate
    ? ''
    : "AND JSON_EXTRACT(st.meta_json, '$.first60ObserveOnly.evaluatedAt') IS NULL";

  return (await coreDataSource.query(
    `
      SELECT
        st.id,
        st.user_id AS userId,
        st.symbol,
        st.side,
        st.signal_time AS signalTime,
        st.entry_price AS entryPrice,
        st.stop_loss_price AS stopLossPrice,
        st.status,
        st.meta_json AS meta
      FROM suggested_trades st
      WHERE st.signal_time >= ?
        AND st.signal_time <= ?
        AND JSON_EXTRACT(st.meta_json, '$.tradeManagementSnapshot.first60') IS NOT NULL
        ${reevaluateClause}
      ORDER BY st.signal_time ASC
      LIMIT ?
    `,
    [toMysqlTimestamp(earliestSignalTime), toMysqlTimestamp(latestSignalTime), options.limit]
  )) as SuggestedTradeCandidateRow[];
};

const loadCandles = async (
  trades: First60ObserveOnlyTradeInput[],
  options: MonitorOptions
): Promise<{ candlesBySymbol: Map<string, First60ObserveOnlyCandle[]>; count: number }> => {
  const symbols = Array.from(new Set(trades.map((trade) => normalizeSymbol(trade.symbol)))).filter(
    Boolean
  );
  const signalTimes = trades
    .map((trade) => toDate(trade.signalTime))
    .filter((value): value is Date => value !== null);
  if (!symbols.length || !signalTimes.length || !env.pg.enabled) {
    return { candlesBySymbol: new Map(), count: 0 };
  }

  if (!strategyDataSource.isInitialized) {
    await strategyDataSource.initialize();
  }

  const start = new Date(Math.min(...signalTimes.map((date) => date.getTime())));
  const latestSignalTime = Math.max(...signalTimes.map((date) => date.getTime()));
  const end = new Date(
    Math.max(options.now.getTime(), latestSignalTime + options.maxOutcomeLookaheadMinutes * 60_000)
  );
  const rows = (await strategyDataSource.query(
    `
      SELECT
        symbol,
        open_time AS "openTime",
        open::float8 AS open,
        high::float8 AS high,
        low::float8 AS low,
        close::float8 AS close
      FROM market_candles_1m
      WHERE symbol = ANY($1)
        AND interval = '1m'
        AND open_time BETWEEN $2 AND $3
      ORDER BY symbol, open_time
    `,
    [symbols, start, end]
  )) as CandleRow[];

  const candlesBySymbol = new Map<string, First60ObserveOnlyCandle[]>();
  for (const row of rows) {
    const symbol = normalizeSymbol(row.symbol);
    const candles = candlesBySymbol.get(symbol) || [];
    candles.push({
      openTime: row.openTime,
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
    });
    candlesBySymbol.set(symbol, candles);
  }

  return { candlesBySymbol, count: rows.length };
};

const persistResult = async (result: First60ObserveOnlyResult): Promise<void> => {
  await coreDataSource.query(
    `
      UPDATE suggested_trades
      SET meta_json = JSON_SET(
        COALESCE(meta_json, JSON_OBJECT()),
        '$.first60ObserveOnly',
        CAST(? AS JSON)
      )
      WHERE id = ?
    `,
    [JSON.stringify(result), result.suggestedTradeId]
  );
};

const shouldPersistResult = (result: First60ObserveOnlyResult): boolean =>
  result.action !== 'skipped' && result.outcome !== 'not_due';

const buildSummary = (
  options: MonitorOptions,
  results: First60ObserveOnlyResult[],
  candleCount: number,
  written: number
): MonitorSummary => {
  const writeEligible = results.filter(shouldPersistResult).length;
  const observeOnlyBuy = results.filter(
    (result) => result.side === 'long' && result.action === 'observe_only'
  );
  const diagnosticsOnlySell = results.filter(
    (result) => result.side === 'short' && result.action === 'diagnostics_only'
  );

  const summary: MonitorSummary = {
    generatedAt: options.now.toISOString(),
    mode: options.write ? 'write' : 'dry-run',
    source: {
      lookbackHours: options.lookbackHours,
      minAgeMinutes: options.minAgeMinutes,
      limit: options.limit,
      maxOutcomeLookaheadMinutes: options.maxOutcomeLookaheadMinutes,
      reevaluate: options.reevaluate,
    },
    counts: {
      candidates: results.length,
      candles: candleCount,
      evaluated: results.filter((result) => result.outcome !== 'not_due').length,
      writeEligible,
      written,
    },
    sideCounts: countBy(results.map((result) => result.side || 'unknown')),
    actionCounts: countBy(results.map((result) => result.action)),
    outcomeCounts: countBy(results.map((result) => result.outcome)),
    observeOnlyBuy: summarizeSet(observeOnlyBuy),
    diagnosticsOnlySell: summarizeSet(diagnosticsOnlySell),
  };

  if (options.includeItems) {
    summary.items = results;
  }

  return summary;
};

const summarizeSet = (
  results: First60ObserveOnlyResult[]
): MonitorSummary['observeOnlyBuy'] => ({
  evaluated: results.length,
  passed: results.filter((result) => result.first60Passed === true).length,
  failed: results.filter((result) => result.first60Passed === false).length,
  targetHits: results.filter((result) => result.outcome === 'target').length,
  stopHits: results.filter((result) => result.outcome === 'stop').length,
});

const countBy = (values: string[]): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const value of values) {
    counts[value] = (counts[value] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((left, right) => right[1] - left[1]));
};

const mapTrade = (row: SuggestedTradeCandidateRow): First60ObserveOnlyTradeInput => ({
  id: String(row.id || ''),
  symbol: String(row.symbol || ''),
  side: String(row.side || ''),
  signalTime: row.signalTime,
  entryPrice: row.entryPrice,
  stopLossPrice: row.stopLossPrice,
  status: typeof row.status === 'string' ? row.status : null,
  meta: parseMeta(row.meta),
});

const parseMeta = (value: unknown): Record<string, unknown> | null => {
  if (!value) {
    return null;
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
};

const normalizeSymbol = (value: unknown): string =>
  String(value || '')
    .trim()
    .toUpperCase();

const toDate = (value: unknown): Date | null => {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : null;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }
  return null;
};

const toMysqlTimestamp = (date: Date): string =>
  date.toISOString().slice(0, 19).replace('T', ' ');

const buildHelp = (): string => `
First60 observe-only monitor check.

Default mode is dry-run. Set FIRST60_OBSERVE_WRITE=true to write
meta_json.first60ObserveOnly on evaluated suggested trades.

Environment:
  FIRST60_OBSERVE_LOOKBACK_HOURS=72
  FIRST60_OBSERVE_MIN_AGE_MINUTES=60
  FIRST60_OBSERVE_LIMIT=250
  FIRST60_OBSERVE_MAX_LOOKAHEAD_MINUTES=1440
  FIRST60_OBSERVE_REEVALUATE=false
  FIRST60_OBSERVE_INCLUDE_ITEMS=true
  FIRST60_OBSERVE_OUTPUT=/path/to/evidence.json
  FIRST60_OBSERVE_WRITE=false
`;

async function run(): Promise<void> {
  if (process.argv.includes('--help')) {
    process.stdout.write(buildHelp());
    return;
  }

  const options = resolveOptions();
  await initializeCoreDataSource();

  try {
    const candidates = await loadCandidateTrades(options);
    const trades = candidates.map(mapTrade);
    const candleLoad = await loadCandles(trades, options);
    const results = trades.map((trade) =>
      evaluateFirst60ObserveOnlyTrade(trade, candleLoad.candlesBySymbol.get(normalizeSymbol(trade.symbol)) || [], {
        now: options.now,
        maxOutcomeLookaheadMinutes: options.maxOutcomeLookaheadMinutes,
      })
    );

    let written = 0;
    if (options.write) {
      for (const result of results) {
        if (!shouldPersistResult(result)) {
          continue;
        }
        await persistResult(result);
        written += 1;
      }
    }

    const summary = buildSummary(options, results, candleLoad.count, written);
    const output = `${JSON.stringify(summary, null, 2)}\n`;
    if (options.outputPath) {
      await writeFile(options.outputPath, output, 'utf8');
    }
    process.stdout.write(output);
  } finally {
    if (strategyDataSource.isInitialized) {
      await strategyDataSource.destroy();
    }
    if (coreDataSource.isInitialized) {
      await coreDataSource.destroy();
    }
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
