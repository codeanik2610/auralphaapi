import { BadRequestAppError } from '../errors/AppError';

export interface MarketCandlesQuery {
  symbol?: string;
  interval?: string;
  limit?: string;
  endTime?: string;
  brokerKey?: string;
  accountId?: string;
}

export interface ValidatedMarketCandlesQuery {
  symbol: string;
  interval: string;
  limit: number;
  endTime?: Date;
  brokerKey?: string;
  accountId?: string;
}

const allowedIntervals = new Set([
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

const normalizeOptional = (value?: string): string | undefined => {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
};

export const validateMarketCandlesQuery = (
  query: MarketCandlesQuery
): ValidatedMarketCandlesQuery => {
  const symbol = query.symbol?.trim().toUpperCase();
  const interval = query.interval?.trim();
  const limit = query.limit !== undefined ? Number(query.limit) : 100;
  const rawEndTime = normalizeOptional(query.endTime);
  const endTime = rawEndTime ? new Date(rawEndTime) : undefined;

  if (!symbol) {
    throw new BadRequestAppError('symbol is required');
  }

  if (!/^[A-Z0-9_:-]+$/.test(symbol)) {
    throw new BadRequestAppError('symbol contains invalid characters');
  }

  if (!interval) {
    throw new BadRequestAppError('interval is required');
  }

  if (!allowedIntervals.has(interval)) {
    throw new BadRequestAppError(
      'interval must be one of: 1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 6h, 12h, 1d, 1w'
    );
  }

  if (!Number.isInteger(limit) || limit <= 0 || limit > 1000) {
    throw new BadRequestAppError('limit must be an integer between 1 and 1000');
  }

  if (rawEndTime && (!endTime || Number.isNaN(endTime.getTime()))) {
    throw new BadRequestAppError('endTime must be a valid date');
  }

  return {
    symbol,
    interval,
    limit,
    ...(endTime ? { endTime } : {}),
    brokerKey: normalizeOptional(query.brokerKey),
    accountId: normalizeOptional(query.accountId),
  };
};
