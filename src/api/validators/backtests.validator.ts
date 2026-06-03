import {
  BacktestRunStatus,
  BacktestTradeSetupMarker,
  CreateBacktestBody,
  PromoteBacktestBatchBody,
  PromoteBacktestBody,
  UpdateBacktestResultBody,
} from '../contracts/Backtest';
import type { AutomationStatus } from '../contracts/Automation';
import { BadRequestAppError } from '../errors/AppError';
import {
  normalizeTradeSuggestionExecutionPolicy,
  TRADE_SUGGESTION_EXECUTION_MODES,
  TRADE_SUGGESTION_ROUTE_MODES,
} from '../utils/automationType';

const VALID_STATUSES: Array<BacktestRunStatus | 'Stable' | 'Review'> = [
  'Stable',
  'Review',
  'Failed',
  'Queued',
  'Running',
  'Completed',
];
const VALID_AUTOMATION_STATUSES: AutomationStatus[] = ['Running', 'Paused', 'Failed', 'Draft'];

const VALID_INTERVALS = new Set([
  '1m',
  '3m',
  '5m',
  '15m',
  '30m',
  '1h',
  '2h',
  '4h',
  '6h',
  '12h',
  '1d',
  '1w',
]);

const parseRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

const readString = (...values: unknown[]): string | null => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
};

const validatePromoteExecutionPolicy = (
  value: unknown
): Record<string, unknown> | null | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestAppError('executionPolicy must be an object or null');
  }

  const executionPolicy = normalizeTradeSuggestionExecutionPolicy(value);
  const routing = parseRecord(executionPolicy.routing) ?? {};
  const liveConsent = parseRecord(executionPolicy.liveConsent) ?? {};
  const executionMode = readString(executionPolicy.executionMode) ?? 'suggestion_only';
  const routeMode = readString(routing.routeMode) ?? 'strategy_default';
  const brokerKey = readString(routing.brokerKey);

  if (
    !TRADE_SUGGESTION_EXECUTION_MODES.includes(
      executionMode as (typeof TRADE_SUGGESTION_EXECUTION_MODES)[number]
    )
  ) {
    throw new BadRequestAppError(
      `executionPolicy.executionMode must be one of: ${TRADE_SUGGESTION_EXECUTION_MODES.join(', ')}`
    );
  }

  if (
    !TRADE_SUGGESTION_ROUTE_MODES.includes(
      routeMode as (typeof TRADE_SUGGESTION_ROUTE_MODES)[number]
    )
  ) {
    throw new BadRequestAppError(
      `executionPolicy.routing.routeMode must be one of: ${TRADE_SUGGESTION_ROUTE_MODES.join(', ')}`
    );
  }

  if (routeMode === 'fixed' && !brokerKey) {
    throw new BadRequestAppError(
      'executionPolicy.routing.brokerKey is required when routeMode is fixed'
    );
  }

  if (executionMode === 'live_trade_auto' && liveConsent.enabled !== true) {
    throw new BadRequestAppError(
      'executionPolicy.liveConsent.enabled must be true for live_trade_auto automations'
    );
  }

  return executionPolicy;
};

export interface BacktestsQuery {
  limit?: string;
  offset?: string;
  status?: string;
  search?: string;
}

export interface ValidatedBacktestsQuery {
  limit: number;
  offset: number;
  status?: string;
  search?: string;
}

export interface BacktestTopSetupsQuery {
  limit?: string | number;
  offset?: string | number;
  search?: string;
  timeframe?: string;
  minScore?: string | number;
  minTrades?: string | number;
  eligibleOnly?: string | boolean;
}

export interface ValidatedBacktestTopSetupsQuery {
  limit: number;
  offset: number;
  allRecords: boolean;
  search?: string;
  timeframe?: string;
  minScore?: number;
  minTrades?: number;
  eligibleOnly: boolean;
}

export interface BacktestChartQuery {
  symbol?: string;
  interval?: string;
  limit?: string;
  lookbackDays?: string;
  endTime?: string;
}

export interface ValidatedCreateBacktestBody {
  universe: string;
  interval: string;
  capital: string;
  fees: string;
  slippage: string;
  spread?: string;
  latencyBars?: number;
  fillPolicy?: string;
  participationPct?: number;
  capitalUtilizationPct?: number;
  leverage?: number;
  startingCapital?: number;
  haltOnCapitalDepletion?: boolean;
  dateRange: string;
  benchmark: string;
  includeExtended: boolean;
  usePaperGate: boolean;
}

export interface ValidatedBacktestChartQuery {
  symbol: string;
  interval: string;
  limit?: number;
  lookbackDays: number;
  endTime: Date | null;
}

export const validateBacktestsQuery = (query: BacktestsQuery): ValidatedBacktestsQuery => {
  const limit = query.limit !== undefined ? Number(query.limit) : 20;
  const offset = query.offset !== undefined ? Number(query.offset) : 0;

  if (!Number.isInteger(limit) || limit <= 0 || limit > 100) {
    throw new BadRequestAppError('limit must be an integer between 1 and 100');
  }

  if (!Number.isInteger(offset) || offset < 0) {
    throw new BadRequestAppError('offset must be an integer greater than or equal to 0');
  }

  const status = query.status?.trim();
  if (status && !VALID_STATUSES.includes(status as BacktestRunStatus | 'Stable' | 'Review')) {
    throw new BadRequestAppError(`status must be one of: ${VALID_STATUSES.join(', ')}`);
  }

  return {
    limit,
    offset,
    status: status || undefined,
    search: query.search?.trim() || undefined,
  };
};

export const validateBacktestTopSetupsQuery = (
  query: BacktestTopSetupsQuery | ValidatedBacktestTopSetupsQuery
): ValidatedBacktestTopSetupsQuery => {
  const rawLimit = query.limit !== undefined ? String(query.limit).trim() : '';
  const allRecords =
    (query as ValidatedBacktestTopSetupsQuery).allRecords === true ||
    rawLimit.toLowerCase() === 'all';
  const limit = allRecords ? Number.MAX_SAFE_INTEGER : rawLimit ? Number(rawLimit) : 24;
  const offset = query.offset !== undefined ? Number(query.offset) : 0;

  if (!Number.isInteger(limit) || limit <= 0) {
    throw new BadRequestAppError('limit must be a positive integer or all');
  }

  if (!Number.isInteger(offset) || offset < 0) {
    throw new BadRequestAppError('offset must be an integer greater than or equal to 0');
  }

  const timeframe = query.timeframe?.trim();
  if (timeframe && !VALID_INTERVALS.has(timeframe)) {
    throw new BadRequestAppError(
      'timeframe must be one of: 1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 6h, 12h, 1d, 1w'
    );
  }

  const minScore =
    query.minScore !== undefined && query.minScore !== '' ? Number(query.minScore) : undefined;
  if (minScore !== undefined && (!Number.isFinite(minScore) || minScore < 0)) {
    throw new BadRequestAppError('minScore must be a non-negative number');
  }

  const minTrades =
    query.minTrades !== undefined && query.minTrades !== '' ? Number(query.minTrades) : undefined;
  if (minTrades !== undefined && (!Number.isInteger(minTrades) || minTrades < 0)) {
    throw new BadRequestAppError('minTrades must be a non-negative integer');
  }

  const eligibleOnlyRaw = String(query.eligibleOnly || '')
    .trim()
    .toLowerCase();
  const eligibleOnly =
    eligibleOnlyRaw === 'true' || eligibleOnlyRaw === '1' || eligibleOnlyRaw === 'yes';

  return {
    limit,
    offset,
    allRecords,
    search: query.search?.trim() || undefined,
    timeframe: timeframe || undefined,
    minScore,
    minTrades,
    eligibleOnly,
  };
};

export const validateBacktestChartQuery = (
  query: BacktestChartQuery
): ValidatedBacktestChartQuery => {
  const symbol = query.symbol?.trim().toUpperCase();
  const interval = query.interval?.trim();
  const limitRaw = query.limit !== undefined ? String(query.limit).trim() : '';
  const limit = limitRaw ? Number(limitRaw) : undefined;
  const lookbackDays = query.lookbackDays !== undefined ? Number(query.lookbackDays) : 90;
  const endTimeRaw = query.endTime?.trim();
  let endTime: Date | null = null;
  if (endTimeRaw) {
    const numeric = Number(endTimeRaw);
    if (Number.isFinite(numeric)) {
      const ms = numeric > 1e12 ? numeric : numeric * 1000;
      endTime = new Date(ms);
    } else {
      endTime = new Date(endTimeRaw);
    }
  }

  if (!symbol) {
    throw new BadRequestAppError('symbol is required');
  }

  if (!/^[A-Z0-9_:-]+$/.test(symbol)) {
    throw new BadRequestAppError('symbol contains invalid characters');
  }

  if (!interval) {
    throw new BadRequestAppError('interval is required');
  }

  if (!VALID_INTERVALS.has(interval)) {
    throw new BadRequestAppError(
      'interval must be one of: 1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 6h, 12h, 1d, 1w'
    );
  }

  if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0 || limit > 1000)) {
    throw new BadRequestAppError('limit must be an integer between 1 and 1000');
  }

  if (!Number.isFinite(lookbackDays) || lookbackDays <= 0 || lookbackDays > 365) {
    throw new BadRequestAppError('lookbackDays must be between 1 and 365');
  }

  if (endTime && Number.isNaN(endTime.getTime())) {
    throw new BadRequestAppError('endTime must be a valid datetime');
  }

  return {
    symbol,
    interval,
    limit,
    lookbackDays,
    endTime,
  };
};

export const validateBacktestId = (backtestId: string): string => {
  const normalizedBacktestId = backtestId.trim();

  if (!normalizedBacktestId) {
    throw new BadRequestAppError('backtestId is required');
  }

  return normalizedBacktestId;
};

export const validateCreateBacktestBody = (
  body: CreateBacktestBody
): ValidatedCreateBacktestBody => {
  const requiredStringFields: Array<
    keyof Pick<
      CreateBacktestBody,
      'universe' | 'interval' | 'capital' | 'fees' | 'slippage' | 'dateRange' | 'benchmark'
    >
  > = ['universe', 'interval', 'capital', 'fees', 'slippage', 'dateRange', 'benchmark'];

  requiredStringFields.forEach((field) => {
    if (!body[field] || typeof body[field] !== 'string' || !body[field]?.trim()) {
      throw new BadRequestAppError(`${field} is required`);
    }
  });

  if (typeof body.includeExtended !== 'boolean') {
    throw new BadRequestAppError('includeExtended must be a boolean');
  }

  if (typeof body.usePaperGate !== 'boolean') {
    throw new BadRequestAppError('usePaperGate must be a boolean');
  }

  const spread =
    body.spread === undefined || body.spread === null || body.spread === ''
      ? undefined
      : String(body.spread).trim();
  if (body.spread !== undefined && !spread) {
    throw new BadRequestAppError('spread must be a non-empty string when provided');
  }

  const latencyBars = parseOptionalNumber(body.latencyBars, 'latencyBars');
  if (latencyBars !== undefined) {
    if (!Number.isInteger(latencyBars) || latencyBars < 0 || latencyBars > 50) {
      throw new BadRequestAppError('latencyBars must be an integer between 0 and 50');
    }
  }

  const fillPolicy =
    body.fillPolicy === undefined || body.fillPolicy === null || body.fillPolicy === ''
      ? undefined
      : String(body.fillPolicy).trim();
  if (fillPolicy && !['conservative-stop-first', 'optimistic-target-first'].includes(fillPolicy)) {
    throw new BadRequestAppError(
      'fillPolicy must be conservative-stop-first or optimistic-target-first'
    );
  }

  const participationPct = parseOptionalNumber(body.participationPct, 'participationPct');
  if (participationPct !== undefined && (participationPct <= 0 || participationPct > 100)) {
    throw new BadRequestAppError('participationPct must be greater than 0 and at most 100');
  }

  const capitalUtilizationPct = parseOptionalNumber(
    body.capitalUtilizationPct,
    'capitalUtilizationPct'
  );
  if (
    capitalUtilizationPct !== undefined &&
    (capitalUtilizationPct <= 0 || capitalUtilizationPct > 100)
  ) {
    throw new BadRequestAppError('capitalUtilizationPct must be greater than 0 and at most 100');
  }

  const leverage = parseOptionalNumber(body.leverage, 'leverage');
  if (leverage !== undefined && (leverage <= 0 || leverage > 100)) {
    throw new BadRequestAppError('leverage must be greater than 0 and at most 100');
  }

  const startingCapital = parseOptionalNumber(body.startingCapital, 'startingCapital');
  if (startingCapital !== undefined && startingCapital <= 0) {
    throw new BadRequestAppError('startingCapital must be greater than 0');
  }

  const haltOnCapitalDepletion =
    body.haltOnCapitalDepletion === undefined || body.haltOnCapitalDepletion === null
      ? undefined
      : Boolean(body.haltOnCapitalDepletion);

  return {
    universe: body.universe!.trim(),
    interval: body.interval!.trim(),
    capital: body.capital!.trim(),
    fees: body.fees!.trim(),
    slippage: body.slippage!.trim(),
    ...(spread ? { spread } : {}),
    ...(latencyBars !== undefined ? { latencyBars } : {}),
    ...(fillPolicy ? { fillPolicy } : {}),
    ...(participationPct !== undefined ? { participationPct } : {}),
    ...(capitalUtilizationPct !== undefined ? { capitalUtilizationPct } : {}),
    ...(leverage !== undefined ? { leverage } : {}),
    ...(startingCapital !== undefined ? { startingCapital } : {}),
    ...(haltOnCapitalDepletion !== undefined ? { haltOnCapitalDepletion } : {}),
    dateRange: body.dateRange!.trim(),
    benchmark: body.benchmark!.trim(),
    includeExtended: body.includeExtended,
    usePaperGate: body.usePaperGate,
  };
};

const parseOptionalNumber = (value: unknown, field: string): number | undefined => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const parsed = typeof value === 'string' ? Number(value) : value;
  if (typeof parsed !== 'number' || Number.isNaN(parsed) || !Number.isFinite(parsed)) {
    throw new BadRequestAppError(`${field} must be a valid number`);
  }
  return parsed;
};

const parseRequiredNumber = (value: unknown, field: string): number => {
  const parsed = typeof value === 'string' ? Number(value) : value;
  if (typeof parsed !== 'number' || Number.isNaN(parsed) || !Number.isFinite(parsed)) {
    throw new BadRequestAppError(`${field} must be a valid number`);
  }
  return parsed;
};

const validateTradeEventSetupMarkers = (
  value: unknown,
  field: string
): BacktestTradeSetupMarker[] | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new BadRequestAppError(`${field} must be an array`);
  }

  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new BadRequestAppError(`${field}[${index}] must be an object`);
    }
    const marker = item as Record<string, unknown>;
    const label = String(marker.label ?? marker.name ?? '').trim();
    if (!label) {
      throw new BadRequestAppError(`${field}[${index}].label is required`);
    }
    if (label.length > 32) {
      throw new BadRequestAppError(`${field}[${index}].label must be 32 characters or fewer`);
    }

    const role =
      marker.role === undefined || marker.role === null
        ? undefined
        : String(marker.role).trim().slice(0, 64) || undefined;
    const time = parseOptionalNumber(
      marker.time ?? marker.openTime ?? marker.timestamp,
      `${field}[${index}].time`
    );
    const price = parseOptionalNumber(marker.price, `${field}[${index}].price`);
    const candleIndex = parseOptionalNumber(
      marker.candleIndex ?? marker.candle_index ?? marker.index,
      `${field}[${index}].candleIndex`
    );

    if (candleIndex !== undefined && !Number.isInteger(candleIndex)) {
      throw new BadRequestAppError(`${field}[${index}].candleIndex must be an integer`);
    }

    return {
      label,
      ...(role ? { role } : {}),
      ...(time !== undefined ? { time } : {}),
      ...(price !== undefined ? { price } : {}),
      ...(candleIndex !== undefined ? { candleIndex } : {}),
    };
  });
};

export const validateUpdateBacktestResultBody = (
  body: UpdateBacktestResultBody
): UpdateBacktestResultBody => {
  const rawStatus = body.runStatus ?? body.status;
  const status = rawStatus !== undefined ? String(rawStatus).trim() : undefined;
  if (rawStatus !== undefined && !status) {
    throw new BadRequestAppError('status must be a non-empty string');
  }

  const rawStability = body.assessmentStatus !== undefined ? body.assessmentStatus : body.stability;
  const stability =
    rawStability === null || rawStability === undefined
      ? rawStability
      : String(rawStability).trim();

  if (rawStability !== undefined && rawStability !== null && !stability) {
    throw new BadRequestAppError('stability must be a non-empty string or null');
  }

  const tradesRaw = body.trades;
  let trades: number | undefined = undefined;
  if (tradesRaw !== undefined && tradesRaw !== null) {
    const parsedTrades = typeof tradesRaw === 'string' ? Number(tradesRaw) : tradesRaw;
    if (!Number.isInteger(parsedTrades) || parsedTrades < 0) {
      throw new BadRequestAppError('trades must be a non-negative integer');
    }
    trades = parsedTrades;
  }

  const config = body.config;
  if (
    config !== undefined &&
    config !== null &&
    (typeof config !== 'object' || Array.isArray(config))
  ) {
    throw new BadRequestAppError('config must be an object or null');
  }

  let tradeEvents = undefined;
  if (body.tradeEvents !== undefined) {
    if (!Array.isArray(body.tradeEvents)) {
      throw new BadRequestAppError('tradeEvents must be an array');
    }
    tradeEvents = body.tradeEvents.map((event, index) => {
      if (!event || typeof event !== 'object') {
        throw new BadRequestAppError(`tradeEvents[${index}] must be an object`);
      }
      const symbol = String(event.symbol || '')
        .trim()
        .toUpperCase();
      const interval = String(event.interval || '').trim();
      const side = String(event.side || '')
        .trim()
        .toUpperCase();

      if (!symbol) {
        throw new BadRequestAppError(`tradeEvents[${index}].symbol is required`);
      }
      if (!/^[A-Z0-9_:-]+$/.test(symbol)) {
        throw new BadRequestAppError(`tradeEvents[${index}].symbol contains invalid characters`);
      }
      if (!interval) {
        throw new BadRequestAppError(`tradeEvents[${index}].interval is required`);
      }
      if (!VALID_INTERVALS.has(interval)) {
        throw new BadRequestAppError(`tradeEvents[${index}].interval is invalid`);
      }
      if (side !== 'BUY' && side !== 'SELL') {
        throw new BadRequestAppError(`tradeEvents[${index}].side must be BUY or SELL`);
      }

      const entryTime = parseRequiredNumber(event.entryTime, `tradeEvents[${index}].entryTime`);
      const entryPrice = parseRequiredNumber(event.entryPrice, `tradeEvents[${index}].entryPrice`);
      const exitTime = parseOptionalNumber(event.exitTime, `tradeEvents[${index}].exitTime`);
      const exitPrice = parseOptionalNumber(event.exitPrice, `tradeEvents[${index}].exitPrice`);
      const metadata = parseRecord(event.metadata);
      if (event.metadata !== undefined && event.metadata !== null && !metadata) {
        throw new BadRequestAppError(`tradeEvents[${index}].metadata must be an object or null`);
      }
      const setupMarkers = validateTradeEventSetupMarkers(
        event.setupMarkers ?? metadata?.setupMarkers ?? metadata?.setup_markers,
        `tradeEvents[${index}].setupMarkers`
      );
      const normalizedMetadata =
        metadata || setupMarkers
          ? {
              ...(metadata || {}),
              ...(setupMarkers ? { setupMarkers } : {}),
            }
          : undefined;

      return {
        symbol,
        interval,
        side: side as 'BUY' | 'SELL',
        entryTime,
        entryPrice,
        exitTime,
        exitPrice,
        ...(normalizedMetadata ? { metadata: normalizedMetadata } : {}),
        ...(setupMarkers ? { setupMarkers } : {}),
      };
    });
  }

  return {
    status: status || undefined,
    stability,
    trades,
    cagr: parseOptionalNumber(body.cagr, 'cagr'),
    sharpe: parseOptionalNumber(body.sharpe, 'sharpe'),
    drawdown: parseOptionalNumber(body.drawdown, 'drawdown'),
    winRate: parseOptionalNumber(body.winRate, 'winRate'),
    profitFactor: parseOptionalNumber(body.profitFactor, 'profitFactor'),
    performanceSurface: body.performanceSurface,
    config: config === undefined ? undefined : (config as Record<string, unknown> | null),
    tradeEvents,
  };
};

export const validatePromoteBacktestBody = (
  body: PromoteBacktestBody = {}
): PromoteBacktestBody => {
  const name = body.name !== undefined ? String(body.name).trim() : undefined;
  const broker = body.broker !== undefined ? String(body.broker).trim() : undefined;
  const trigger = body.trigger !== undefined ? String(body.trigger).trim() : undefined;
  const riskMode = body.riskMode !== undefined ? String(body.riskMode).trim() : undefined;
  const status = body.status !== undefined ? String(body.status).trim() : undefined;
  const symbol = body.symbol !== undefined ? String(body.symbol).trim().toUpperCase() : undefined;
  const timeframe = body.timeframe !== undefined ? String(body.timeframe).trim() : undefined;
  const timeZone =
    body.timeZone === undefined
      ? undefined
      : body.timeZone === null
        ? null
        : String(body.timeZone).trim();
  const executionPolicy = validatePromoteExecutionPolicy(body.executionPolicy);

  let schedule: Record<string, unknown> | null | undefined = undefined;
  if (body.schedule !== undefined) {
    if (body.schedule === null) {
      schedule = null;
    } else if (typeof body.schedule === 'object' && !Array.isArray(body.schedule)) {
      schedule = body.schedule as Record<string, unknown>;
    } else {
      throw new BadRequestAppError('schedule must be an object or null');
    }
  }

  if (body.name !== undefined && !name) {
    throw new BadRequestAppError('name must be a non-empty string');
  }
  if (body.broker !== undefined && !broker) {
    throw new BadRequestAppError('broker must be a non-empty string');
  }
  if (body.trigger !== undefined && !trigger) {
    throw new BadRequestAppError('trigger must be a non-empty string');
  }
  if (body.riskMode !== undefined && !riskMode) {
    throw new BadRequestAppError('riskMode must be a non-empty string');
  }
  if (
    body.status !== undefined &&
    (!status || !VALID_AUTOMATION_STATUSES.includes(status as AutomationStatus))
  ) {
    throw new BadRequestAppError(`status must be one of: ${VALID_AUTOMATION_STATUSES.join(', ')}`);
  }
  if (body.symbol !== undefined && !symbol) {
    throw new BadRequestAppError('symbol must be a non-empty string');
  }
  if (body.timeframe !== undefined && !timeframe) {
    throw new BadRequestAppError('timeframe must be a non-empty string');
  }
  if (timeframe && !VALID_INTERVALS.has(timeframe)) {
    throw new BadRequestAppError(
      'timeframe must be one of: 1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 6h, 12h, 1d, 1w'
    );
  }
  if (body.timeZone !== undefined && body.timeZone !== null && !timeZone) {
    throw new BadRequestAppError('timeZone must be a non-empty string or null');
  }

  return {
    name: name || undefined,
    broker: broker || undefined,
    trigger: trigger || undefined,
    riskMode: riskMode || undefined,
    status: status as AutomationStatus | undefined,
    symbol: symbol || undefined,
    timeframe: timeframe || undefined,
    timeZone: timeZone === undefined ? undefined : timeZone || null,
    executionPolicy,
    schedule: schedule === undefined ? undefined : schedule,
  };
};

export const validatePromoteBacktestBatchBody = (
  body: PromoteBacktestBatchBody
): PromoteBacktestBatchBody => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestAppError('batch promotion body must be an object');
  }

  const shared = validatePromoteBacktestBody(body);
  const rawItems = Array.isArray(body.items) ? body.items : [];

  if (!rawItems.length) {
    throw new BadRequestAppError('items must contain at least one selected setup');
  }

  const items = rawItems.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new BadRequestAppError(`items[${index}] must be an object`);
    }

    const symbol = String(item.symbol || '')
      .trim()
      .toUpperCase();
    const timeframe = String(item.timeframe || '').trim();
    const name = item.name !== undefined ? String(item.name).trim() : undefined;
    const itemBacktestId =
      item.backtestId !== undefined ? validateBacktestId(String(item.backtestId || '')) : undefined;

    if (!symbol) {
      throw new BadRequestAppError(`items[${index}].symbol must be a non-empty string`);
    }
    if (!timeframe) {
      throw new BadRequestAppError(`items[${index}].timeframe must be a non-empty string`);
    }
    if (!VALID_INTERVALS.has(timeframe)) {
      throw new BadRequestAppError(
        `items[${index}].timeframe must be one of: 1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 6h, 12h, 1d, 1w`
      );
    }
    if (item.name !== undefined && !name) {
      throw new BadRequestAppError(`items[${index}].name must be a non-empty string`);
    }

    return {
      ...(itemBacktestId ? { backtestId: itemBacktestId } : {}),
      symbol,
      timeframe,
      name: name || undefined,
    };
  });

  const deduped = new Set<string>();
  items.forEach((item) => {
    const key = `${item.backtestId || ''}::${item.symbol}::${item.timeframe}`;
    if (deduped.has(key)) {
      throw new BadRequestAppError(
        `Duplicate setup selection is not allowed: ${item.symbol} ${item.timeframe}`
      );
    }
    deduped.add(key);
  });

  return {
    ...shared,
    items,
  };
};
