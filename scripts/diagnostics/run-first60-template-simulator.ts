import * as dotenv from 'dotenv';
import * as path from 'node:path';
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise';
import { Client } from 'pg';
import {
  First60TemplateSimulationCandle,
  First60TemplateSimulationReport,
  First60TemplateSimulationSideSummary,
  First60TemplateSimulationSignal,
  simulateFirst60TemplateProfile,
} from '../../src/api/utils/first60TemplateSimulator';
import {
  buildStrategyTemplateAutomationProfile,
  StrategyTemplateAutomationProfile,
} from '../../src/api/utils/strategyTemplateAutomation';

dotenv.config({
  path: path.join(process.cwd(), '.env'),
});

type OutputMode = 'summary' | 'json';
type SignalSource = 'suggested_trades';

interface RunnerOptions {
  templateId: string;
  sourceBacktestId: string;
  signalSource: SignalSource;
  timeframe: string;
  start: Date;
  end: Date;
  lookbackDays: number;
  limit: number;
  maxHoldMinutes: number;
  topSymbolsLimit: number;
  candleSource: string;
  output: OutputMode;
  dryRun: boolean;
}

interface MysqlConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

interface PostgresConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl: boolean;
}

interface StrategyTemplateRow extends RowDataPacket {
  id: string;
  userId: string | null;
  name: string;
  status: string;
  templateVersion: number;
  config: Record<string, unknown> | string | null;
}

interface SuggestedTradeSignalRow extends RowDataPacket {
  id: string;
  symbol: string;
  timeframe: string;
  side: string;
  signalTime: Date | string;
  entryPrice: string | number | null;
  stopLossPrice: string | number | null;
  sourceTemplateId: string | null;
  sourceBacktestId: string | null;
}

interface CandleRow {
  symbol: string;
  openTime: Date | string;
  open: number | string;
  high: number | string;
  low: number | string;
  close: number | string;
  volume: number | string | null;
}

interface ResolvedProfile {
  profile: StrategyTemplateAutomationProfile;
  profileSource: 'template' | 'template+default-first60';
}

interface RunnerReport {
  generatedAt: string;
  source: {
    signalSource: SignalSource;
    templateId: string;
    sourceBacktestId: string | null;
    timeframe: string | null;
    start: string;
    end: string;
    limit: number;
    candleSource: string | null;
    maxHoldMinutes: number;
  };
  template: {
    id: string;
    userId: string | null;
    name: string;
    status: string;
    templateVersion: number;
    profileSource: ResolvedProfile['profileSource'];
  };
  counts: {
    signals: number;
    symbols: number;
    candles: number;
  };
  simulation: First60TemplateSimulationReport;
}

const DEFAULT_TEMPLATE_ID = '34b6eb3c-6269-4760-9d7c-1f05794073af';
const DEFAULT_SOURCE_BACKTEST_ID = '9faa221e-a30e-4d2b-89cb-a7c0a99b89be';
const DEFAULT_LOOKBACK_DAYS = 2;
const DEFAULT_SIGNAL_LIMIT = 1000;
const DEFAULT_MAX_HOLD_MINUTES = 24 * 60;
const DEFAULT_TOP_SYMBOLS_LIMIT = 5;

const DEFAULT_FIRST60_CONFIG: Record<string, unknown> = {
  enabled: true,
  mode: 'post_entry_hold_or_exit',
  dataSource: 'market_candles_1m',
  windowMinutes: 60,
  evaluationTimeframe: '1m',
  buy: {
    enabled: true,
    observeOnlyEnabled: true,
    managementEnabled: false,
    diagnosticsEnabled: true,
    decisionGate: {
      status: 'observe_only',
      reason: 'Phase 3c real-data evidence supports BUY observe-only monitoring.',
      evidenceRef: 'storage/first60-evidence/phase3c-summary-2026-05-07.md',
      decidedAt: '2026-05-07',
    },
    requiredFavorableR: 1,
    maxAdverseR: 0.75,
    targetR: 5,
    entryBasis: 'signal_5m_close',
    stopBasis: 'signal_candle_low',
    passAction: 'hold_for_target',
    failAction: 'paper_tighten_or_exit',
  },
  sell: {
    enabled: true,
    observeOnlyEnabled: false,
    managementEnabled: false,
    diagnosticsEnabled: true,
    decisionGate: {
      status: 'blocked',
      reason: 'Phase 3c real-data evidence showed weak SELL target conversion and negative R.',
      evidenceRef: 'storage/first60-evidence/phase3c-summary-2026-05-07.md',
      decidedAt: '2026-05-07',
    },
    requiredFavorableR: 1,
    maxAdverseR: 0.75,
    targetR: 4.5,
    entryBasis: 'signal_5m_close',
    stopBasis: 'signal_candle_high',
    passAction: 'hold_for_target',
    failAction: 'paper_tighten_or_exit',
  },
};

const readArg = (name: string): string | null => {
  const flag = `--${name}`;
  const inlinePrefix = `${flag}=`;
  const inline = process.argv.find((arg) => arg.startsWith(inlinePrefix));
  if (inline) {
    return inline.slice(inlinePrefix.length);
  }

  const index = process.argv.indexOf(flag);
  if (index >= 0 && process.argv[index + 1] && !process.argv[index + 1].startsWith('--')) {
    return process.argv[index + 1];
  }

  return null;
};

const hasArg = (name: string): boolean => process.argv.includes(`--${name}`);

const readStringOption = (
  envKey: string,
  argName: string,
  fallback = ''
): string => {
  const value = readArg(argName) ?? process.env[envKey] ?? fallback;
  return String(value || '').trim();
};

const readNumberOption = (
  envKey: string,
  argName: string,
  fallback: number,
  minimum: number
): number => {
  const raw = readArg(argName) ?? process.env[envKey];
  const parsed = raw === undefined || raw === null || raw === '' ? fallback : Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${envKey} must be a number`);
  }
  return Math.max(minimum, Math.trunc(parsed));
};

const readBooleanOption = (envKey: string, argName: string, fallback = false): boolean => {
  if (hasArg(argName)) {
    return true;
  }
  const raw = process.env[envKey];
  if (raw === undefined) {
    return fallback;
  }
  return ['1', 'true', 'yes', 'on'].includes(String(raw).trim().toLowerCase());
};

const readDateOption = (envKey: string, argName: string): Date | null => {
  const raw = readArg(argName) ?? process.env[envKey];
  if (!raw) {
    return null;
  }
  const parsed = new Date(raw);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error(`${envKey} must be a valid date or ISO timestamp`);
  }
  return parsed;
};

const resolveRunnerOptions = (): RunnerOptions => {
  const lookbackDays = readNumberOption(
    'FIRST60_LOOKBACK_DAYS',
    'lookback-days',
    DEFAULT_LOOKBACK_DAYS,
    1
  );
  const end = readDateOption('FIRST60_END', 'end') ?? new Date();
  const start =
    readDateOption('FIRST60_START', 'start') ??
    new Date(end.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
  if (start.getTime() >= end.getTime()) {
    throw new Error('FIRST60_START must be earlier than FIRST60_END');
  }

  const signalSource = readStringOption(
    'FIRST60_SIGNAL_SOURCE',
    'signal-source',
    'suggested_trades'
  ) as SignalSource;
  if (signalSource !== 'suggested_trades') {
    throw new Error('Only FIRST60_SIGNAL_SOURCE=suggested_trades is supported in Phase 3b');
  }

  const output = readStringOption('FIRST60_OUTPUT', 'output', 'summary') as OutputMode;
  if (output !== 'summary' && output !== 'json') {
    throw new Error('FIRST60_OUTPUT must be "summary" or "json"');
  }

  return {
    templateId: readStringOption('FIRST60_TEMPLATE_ID', 'template-id', DEFAULT_TEMPLATE_ID),
    sourceBacktestId: readStringOption(
      'FIRST60_SOURCE_BACKTEST_ID',
      'source-backtest-id',
      DEFAULT_SOURCE_BACKTEST_ID
    ),
    signalSource,
    timeframe: readStringOption('FIRST60_TIMEFRAME', 'timeframe', '5m'),
    start,
    end,
    lookbackDays,
    limit: readNumberOption('FIRST60_LIMIT', 'limit', DEFAULT_SIGNAL_LIMIT, 1),
    maxHoldMinutes: readNumberOption(
      'FIRST60_MAX_HOLD_MINUTES',
      'max-hold-minutes',
      DEFAULT_MAX_HOLD_MINUTES,
      1
    ),
    topSymbolsLimit: readNumberOption(
      'FIRST60_TOP_SYMBOLS_LIMIT',
      'top-symbols-limit',
      DEFAULT_TOP_SYMBOLS_LIMIT,
      1
    ),
    candleSource: readStringOption('FIRST60_CANDLE_SOURCE', 'candle-source', ''),
    output,
    dryRun: readBooleanOption('FIRST60_DRY_RUN', 'dry-run'),
  };
};

const resolveMysqlConfig = (): MysqlConfig => ({
  host: readStringOption('FIRST60_MYSQL_HOST', 'mysql-host', process.env.DB_HOST || '127.0.0.1'),
  port: readNumberOption(
    'FIRST60_MYSQL_PORT',
    'mysql-port',
    Number(process.env.DB_PORT || 3306),
    1
  ),
  user: readStringOption('FIRST60_MYSQL_USER', 'mysql-user', process.env.DB_USERNAME || 'root'),
  password: readStringOption(
    'FIRST60_MYSQL_PASSWORD',
    'mysql-password',
    process.env.DB_PASSWORD || ''
  ),
  database: readStringOption(
    'FIRST60_MYSQL_DATABASE',
    'mysql-database',
    process.env.DB_NAME || 'auralpha'
  ),
});

const resolvePostgresConfig = (): PostgresConfig => ({
  host: readStringOption('FIRST60_PG_HOST', 'pg-host', process.env.PG_DB_HOST || '127.0.0.1'),
  port: readNumberOption(
    'FIRST60_PG_PORT',
    'pg-port',
    Number(process.env.PG_DB_PORT || 5432),
    1
  ),
  user: readStringOption('FIRST60_PG_USER', 'pg-user', process.env.PG_DB_USERNAME || 'postgres'),
  password: readStringOption(
    'FIRST60_PG_PASSWORD',
    'pg-password',
    process.env.PG_DB_PASSWORD || ''
  ),
  database: readStringOption(
    'FIRST60_PG_DATABASE',
    'pg-database',
    process.env.PG_DB_NAME || 'auralpha'
  ),
  ssl: readBooleanOption('FIRST60_PG_SSL', 'pg-ssl', process.env.PG_DB_SSL === 'true'),
});

const loadTemplate = async (
  client: Client,
  templateId: string
): Promise<StrategyTemplateRow> => {
  const result = await client.query(
    `
      SELECT
        id,
        user_id AS "userId",
        name,
        status,
        template_version AS "templateVersion",
        config
      FROM strategy_templates
      WHERE id = $1
      LIMIT 1
    `,
    [templateId]
  );

  const row = result.rows[0] as StrategyTemplateRow | undefined;
  if (!row) {
    throw new Error(`Strategy template ${templateId} was not found in Postgres`);
  }
  return row;
};

const loadSuggestedTradeSignals = async (
  connection: Connection,
  options: RunnerOptions
): Promise<SuggestedTradeSignalRow[]> => {
  const timeframeClause = options.timeframe ? 'AND st.timeframe = ?' : '';
  const timeframeParams = options.timeframe ? [options.timeframe] : [];
  const lineageClause =
    options.templateId || options.sourceBacktestId
      ? 'AND (st.source_template_id = ? OR st.source_backtest_id = ?)'
      : '';
  const lineageParams =
    options.templateId || options.sourceBacktestId
      ? [options.templateId || null, options.sourceBacktestId || null]
      : [];
  const [rows] = await connection.execute<SuggestedTradeSignalRow[]>(
    `
      SELECT
        st.id,
        st.symbol,
        st.timeframe,
        st.side,
        st.signal_time AS signalTime,
        st.entry_price AS entryPrice,
        st.stop_loss_price AS stopLossPrice,
        st.source_template_id AS sourceTemplateId,
        st.source_backtest_id AS sourceBacktestId
      FROM suggested_trades st
      WHERE st.signal_time >= ?
        AND st.signal_time <= ?
        ${timeframeClause}
        ${lineageClause}
        AND st.entry_price IS NOT NULL
        AND st.stop_loss_price IS NOT NULL
        AND UPPER(st.side) IN ('BUY', 'SELL', 'LONG', 'SHORT')
      ORDER BY st.signal_time DESC
      LIMIT ?
    `,
    [
      toMysqlTimestamp(options.start),
      toMysqlTimestamp(options.end),
      ...timeframeParams,
      ...lineageParams,
      options.limit,
    ]
  );

  return [...rows].reverse();
};

const loadCandles = async (
  client: Client,
  signals: First60TemplateSimulationSignal[],
  options: RunnerOptions
): Promise<{ candlesBySymbol: Record<string, First60TemplateSimulationCandle[]>; rows: number }> => {
  const symbols = Array.from(new Set(signals.map((signal) => normalizeSymbol(signal.symbol)))).filter(
    Boolean
  );
  if (!symbols.length) {
    return { candlesBySymbol: {}, rows: 0 };
  }

  const signalTimes = signals
    .map((signal) => toDate(signal.signalTime))
    .filter((value): value is Date => value !== null);
  if (!signalTimes.length) {
    return { candlesBySymbol: {}, rows: 0 };
  }

  const candleStart = new Date(Math.min(...signalTimes.map((date) => date.getTime())));
  const candleEnd = new Date(
    Math.max(...signalTimes.map((date) => date.getTime())) +
      options.maxHoldMinutes * 60 * 1000
  );
  const sourceClause = options.candleSource ? 'AND source = $4' : '';
  const params: unknown[] = [symbols, candleStart, candleEnd];
  if (options.candleSource) {
    params.push(options.candleSource);
  }

  const result = await client.query(
    `
      SELECT DISTINCT ON (symbol, open_time)
        symbol,
        open_time AS "openTime",
        open::float8 AS open,
        high::float8 AS high,
        low::float8 AS low,
        close::float8 AS close,
        volume::float8 AS volume
      FROM market_candles_1m
      WHERE symbol = ANY($1)
        AND interval = '1m'
        AND open_time BETWEEN $2 AND $3
        ${sourceClause}
      ORDER BY symbol, open_time, source
    `,
    params
  );

  const candlesBySymbol: Record<string, First60TemplateSimulationCandle[]> = {};
  for (const row of result.rows as unknown as CandleRow[]) {
    const symbol = normalizeSymbol(row.symbol);
    if (!symbol) {
      continue;
    }
    const candles = candlesBySymbol[symbol] || [];
    candles.push({
      openTime: row.openTime,
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      volume: row.volume,
    });
    candlesBySymbol[symbol] = candles;
  }

  return { candlesBySymbol, rows: result.rows.length };
};

const resolveProfile = (templateConfig: Record<string, unknown> | null): ResolvedProfile => {
  const config = templateConfig || {};
  const templateProfile = buildStrategyTemplateAutomationProfile(config);
  if (templateProfile.tradeManagement?.first60?.enabled) {
    return {
      profile: templateProfile,
      profileSource: 'template',
    };
  }

  const existingTradeManagement =
    parseRecord(config.tradeManagement) || parseRecord(config.trade_management) || {};
  const injectedProfile = buildStrategyTemplateAutomationProfile({
    ...config,
    tradeManagement: {
      ...existingTradeManagement,
      first60: DEFAULT_FIRST60_CONFIG,
    },
  });

  return {
    profile: injectedProfile,
    profileSource: 'template+default-first60',
  };
};

const mapSignals = (rows: SuggestedTradeSignalRow[]): First60TemplateSimulationSignal[] =>
  rows.map((row) => ({
    symbol: row.symbol,
    side: row.side,
    signalTime: row.signalTime,
    entryPrice: row.entryPrice ?? 0,
    stopLossPrice: row.stopLossPrice,
  }));

const buildRunnerReport = (
  options: RunnerOptions,
  template: StrategyTemplateRow,
  resolvedProfile: ResolvedProfile,
  signals: First60TemplateSimulationSignal[],
  candleRows: number,
  simulation: First60TemplateSimulationReport
): RunnerReport => ({
  generatedAt: new Date().toISOString(),
  source: {
    signalSource: options.signalSource,
    templateId: options.templateId,
    sourceBacktestId: options.sourceBacktestId || null,
    timeframe: options.timeframe || null,
    start: options.start.toISOString(),
    end: options.end.toISOString(),
    limit: options.limit,
    candleSource: options.candleSource || null,
    maxHoldMinutes: options.maxHoldMinutes,
  },
  template: {
    id: template.id,
    userId: template.userId,
    name: template.name,
    status: template.status,
    templateVersion: Number(template.templateVersion || 0),
    profileSource: resolvedProfile.profileSource,
  },
  counts: {
    signals: signals.length,
    symbols: new Set(signals.map((signal) => normalizeSymbol(signal.symbol))).size,
    candles: candleRows,
  },
  simulation,
});

const renderSummary = (report: RunnerReport): string => {
  const lines: string[] = [];
  lines.push('FIRST60 REAL DATA SIMULATION');
  lines.push(
    `template: ${report.template.name} (${report.template.id}), profile=${report.template.profileSource}`
  );
  lines.push(
    `source: ${report.source.signalSource}, timeframe=${report.source.timeframe || 'all'}, window=${report.source.start} -> ${report.source.end}`
  );
  lines.push(
    `loaded: signals=${report.counts.signals}, symbols=${report.counts.symbols}, candles=${report.counts.candles}, maxHold=${report.source.maxHoldMinutes}m`
  );
  lines.push('');
  lines.push(renderSideSummary('BUY', report.simulation.sides.long));
  lines.push(renderSideSummary('SELL', report.simulation.sides.short));

  const warnings = report.simulation.warnings;
  if (warnings.length) {
    lines.push('');
    lines.push('warnings:');
    for (const warning of warnings) {
      lines.push(`- ${warning}`);
    }
  }

  return `${lines.join('\n')}\n`;
};

const renderSideSummary = (
  label: string,
  summary: First60TemplateSimulationSideSummary
): string => {
  const best = summary.bestSymbols
    .slice(0, 3)
    .map((item) => `${item.symbol} ${formatNumber(item.totalR)}R/${item.trades}`)
    .join(', ');
  const worst = summary.worstSymbols
    .slice(0, 3)
    .map((item) => `${item.symbol} ${formatNumber(item.totalR)}R/${item.trades}`)
    .join(', ');

  return [
    `${label}: trades=${summary.simulatedTrades}/${summary.totalTrades}`,
    `pass=${formatPercent(summary.passRate)}`,
    `target=${formatPercent(summary.targetHitRate)}`,
    `targetAfterPass=${formatPercent(summary.targetHitRateAfterPass)}`,
    `totalR=${formatNumber(summary.totalR)}`,
    `avgR=${formatNullableNumber(summary.avgR)}`,
    `maxAdverseR=${formatNullableNumber(summary.maxAdverseR)}`,
    `best=${best || 'n/a'}`,
    `worst=${worst || 'n/a'}`,
  ].join(' | ');
};

const buildHelp = (): string => `
Run the First60 template simulator against real droplet-style database data.

Default source:
  suggested_trades from MySQL + market_candles_1m from Postgres.

Examples:
  node --import tsx scripts/diagnostics/run-first60-template-simulator.ts --dry-run
  FIRST60_LOOKBACK_DAYS=2 node --import tsx scripts/diagnostics/run-first60-template-simulator.ts
  FIRST60_OUTPUT=json FIRST60_LIMIT=250 node --import tsx scripts/diagnostics/run-first60-template-simulator.ts

Key options:
  --template-id <uuid>          Defaults to ${DEFAULT_TEMPLATE_ID}
  --source-backtest-id <uuid>   Defaults to ${DEFAULT_SOURCE_BACKTEST_ID}
  --start <iso>                 Overrides lookback start
  --end <iso>                   Overrides lookback end
  --lookback-days <days>        Defaults to ${DEFAULT_LOOKBACK_DAYS}
  --limit <n>                   Suggested-trade row limit, defaults to ${DEFAULT_SIGNAL_LIMIT}
  --timeframe <tf>              Defaults to 5m
  --max-hold-minutes <n>        Defaults to ${DEFAULT_MAX_HOLD_MINUTES}
  --candle-source <source>      Optional Postgres candle source filter
  --output summary|json         Defaults to summary
  --dry-run                     Print resolved config without connecting

Connection env overrides:
  FIRST60_MYSQL_HOST, FIRST60_MYSQL_PORT, FIRST60_MYSQL_USER, FIRST60_MYSQL_PASSWORD, FIRST60_MYSQL_DATABASE
  FIRST60_PG_HOST, FIRST60_PG_PORT, FIRST60_PG_USER, FIRST60_PG_PASSWORD, FIRST60_PG_DATABASE, FIRST60_PG_SSL
`;

const parseTemplateConfig = (value: StrategyTemplateRow['config']): Record<string, unknown> => {
  if (!value) {
    return {};
  }
  if (typeof value === 'string') {
    const parsed = JSON.parse(value) as unknown;
    return parseRecord(parsed) || {};
  }
  return value;
};

const parseRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

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

const formatPercent = (value: number | null): string =>
  value === null ? 'n/a' : `${formatNumber(value * 100)}%`;

const formatNullableNumber = (value: number | null): string =>
  value === null ? 'n/a' : formatNumber(value);

const formatNumber = (value: number): string =>
  Number.isFinite(value) ? Number(value.toFixed(2)).toString() : 'n/a';

const sanitizeMysqlConfig = (config: MysqlConfig): Record<string, unknown> => ({
  host: config.host,
  port: config.port,
  user: config.user,
  database: config.database,
  passwordSet: Boolean(config.password),
});

const sanitizePostgresConfig = (config: PostgresConfig): Record<string, unknown> => ({
  host: config.host,
  port: config.port,
  user: config.user,
  database: config.database,
  ssl: config.ssl,
  passwordSet: Boolean(config.password),
});

async function run(): Promise<void> {
  if (hasArg('help') || hasArg('h')) {
    process.stdout.write(buildHelp());
    return;
  }

  const options = resolveRunnerOptions();
  const mysqlConfig = resolveMysqlConfig();
  const postgresConfig = resolvePostgresConfig();

  if (options.dryRun) {
    process.stdout.write(
      `${JSON.stringify(
        {
          dryRun: true,
          options: {
            ...options,
            start: options.start.toISOString(),
            end: options.end.toISOString(),
          },
          mysql: sanitizeMysqlConfig(mysqlConfig),
          postgres: sanitizePostgresConfig(postgresConfig),
        },
        null,
        2
      )}\n`
    );
    return;
  }

  const pgClient = new Client({
    host: postgresConfig.host,
    port: postgresConfig.port,
    user: postgresConfig.user,
    password: postgresConfig.password,
    database: postgresConfig.database,
    ssl: postgresConfig.ssl ? { rejectUnauthorized: false } : false,
  });
  const mysqlConnection = await mysql.createConnection({
    host: mysqlConfig.host,
    port: mysqlConfig.port,
    user: mysqlConfig.user,
    password: mysqlConfig.password,
    database: mysqlConfig.database,
    timezone: 'Z',
  });

  try {
    await pgClient.connect();
    const template = await loadTemplate(pgClient, options.templateId);
    const resolvedProfile = resolveProfile(parseTemplateConfig(template.config));
    const signalRows = await loadSuggestedTradeSignals(mysqlConnection, options);
    const signals = mapSignals(signalRows);
    const candleLoad = await loadCandles(pgClient, signals, options);
    const simulation = simulateFirst60TemplateProfile(
      resolvedProfile.profile,
      signals,
      candleLoad.candlesBySymbol,
      {
        maxHoldMinutes: options.maxHoldMinutes,
        topSymbolsLimit: options.topSymbolsLimit,
      }
    );
    const report = buildRunnerReport(
      options,
      template,
      resolvedProfile,
      signals,
      candleLoad.rows,
      simulation
    );

    process.stdout.write(
      options.output === 'json' ? `${JSON.stringify(report, null, 2)}\n` : renderSummary(report)
    );
  } finally {
    await mysqlConnection.end();
    await pgClient.end().catch(() => undefined);
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
