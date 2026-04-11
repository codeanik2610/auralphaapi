import assert from 'node:assert/strict';
import { Client } from 'pg';
import { env } from '../src/env';

const SYMBOL = (process.env.BACKTESTS_CHART_FIXTURE_SYMBOL || 'BTCUSDT').trim() || 'BTCUSDT';
const INTERVAL = (process.env.BACKTESTS_CHART_FIXTURE_INTERVAL || '1m').trim() || '1m';
const DAYS = Math.max(8, Number(process.env.BACKTESTS_CHART_FIXTURE_DAYS || 8));
const BATCH_SIZE = Math.max(100, Number(process.env.BACKTESTS_CHART_FIXTURE_BATCH_SIZE || 500));

type CandleRow = [
  string,
  string,
  Date,
  string,
  string,
  string,
  string,
  string,
];

function buildCandleRow(openTime: Date, index: number): CandleRow {
  const basePrice = 100 + index * 0.05;
  return [
    SYMBOL,
    INTERVAL,
    openTime,
    basePrice.toFixed(4),
    (basePrice + 0.8).toFixed(4),
    (basePrice - 0.8).toFixed(4),
    (basePrice + 0.2).toFixed(4),
    (1000 + index * 3).toFixed(4),
  ];
}

async function ensureCandlesTable(client: Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS market_candles_1m (
      symbol VARCHAR(64) NOT NULL,
      interval VARCHAR(32) NOT NULL,
      open_time TIMESTAMPTZ NOT NULL,
      open NUMERIC(20, 8) NOT NULL,
      high NUMERIC(20, 8) NOT NULL,
      low NUMERIC(20, 8) NOT NULL,
      close NUMERIC(20, 8) NOT NULL,
      volume NUMERIC(28, 8) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (symbol, interval, open_time)
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_market_candles_1m_symbol_open_time
      ON market_candles_1m (symbol, open_time DESC)
  `);
}

async function insertBatch(client: Client, rows: CandleRow[]): Promise<void> {
  if (!rows.length) {
    return;
  }

  const values: unknown[] = [];
  const placeholders = rows.map((row, rowIndex) => {
    const base = rowIndex * row.length;
    values.push(...row);
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8})`;
  });

  await client.query(
    `
      INSERT INTO market_candles_1m (
        symbol,
        interval,
        open_time,
        open,
        high,
        low,
        close,
        volume
      )
      VALUES ${placeholders.join(', ')}
      ON CONFLICT (symbol, interval, open_time) DO NOTHING
    `,
    values
  );
}

async function run(): Promise<void> {
  assert.equal(env.pg.enabled, true, 'PG_DB_ENABLED=true is required to seed chart fixtures');

  const client = new Client({
    host: env.pg.host,
    port: env.pg.port,
    user: env.pg.username,
    password: env.pg.password,
    database: env.pg.database,
    ssl: env.pg.ssl ? { rejectUnauthorized: false } : false,
  });

  await client.connect();

  try {
    await ensureCandlesTable(client);

    const nowMs = Math.floor(Date.now() / 60_000) * 60_000;
    const startMs = nowMs - DAYS * 24 * 60 * 60 * 1000;
    const totalRows = Math.floor((nowMs - startMs) / 60_000) + 1;
    let inserted = 0;
    let batch: CandleRow[] = [];

    for (let index = 0; index < totalRows; index += 1) {
      const openTime = new Date(startMs + index * 60_000);
      batch.push(buildCandleRow(openTime, index));

      if (batch.length >= BATCH_SIZE) {
        await insertBatch(client, batch);
        inserted += batch.length;
        batch = [];
      }
    }

    if (batch.length) {
      await insertBatch(client, batch);
      inserted += batch.length;
    }

    const countResult = await client.query(
      `
        SELECT COUNT(*)::INT AS total
        FROM market_candles_1m
        WHERE symbol = $1
          AND interval = $2
      `,
      [SYMBOL, INTERVAL]
    );

    console.log(
      JSON.stringify({
        seededSymbol: SYMBOL,
        seededInterval: INTERVAL,
        attemptedRows: inserted,
        storedRows: Number(countResult.rows[0]?.total || 0),
        windowDays: DAYS,
      })
    );
  } finally {
    await client.end();
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
