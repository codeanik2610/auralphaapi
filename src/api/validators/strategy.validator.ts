import { BadRequestAppError } from '../errors/AppError';
import { MarketCandlesQuery, validateMarketCandlesQuery } from './market.validator';

const maxSymbolsPerRequest = 10;

export interface StrategyRunRequest extends Omit<MarketCandlesQuery, 'symbol'> {
  strategyId?: string;
  symbol?: string;
  symbols?: string;
  maxWaitBars?: string;
  params?: Record<string, string | number | boolean | undefined>;
}

export interface ValidatedStrategyRunQuery {
  strategyId: string;
  symbols: string[];
  interval: string;
  limit: number;
  params: Record<string, string | number | boolean | undefined>;
  maxWaitBars?: number;
}

const getSymbols = (query: Pick<StrategyRunRequest, 'symbol' | 'symbols'>): string[] => {
  const parsedSymbols = query.symbols
    ?.split(',')
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean);
  const fallbackSymbol = query.symbol?.trim().toUpperCase();
  return [
    ...new Set(parsedSymbols?.length ? parsedSymbols : fallbackSymbol ? [fallbackSymbol] : []),
  ];
};

export const validateStrategyRunRequest = (
  query: StrategyRunRequest
): ValidatedStrategyRunQuery => {
  const strategyId = query.strategyId?.trim();
  const symbols = getSymbols(query);

  if (!strategyId) {
    throw new BadRequestAppError('strategyId is required');
  }
  if (symbols.length === 0) {
    throw new BadRequestAppError('symbols is required');
  }

  if (symbols.length > maxSymbolsPerRequest) {
    throw new BadRequestAppError(
      `symbols must contain between 1 and ${maxSymbolsPerRequest} items`
    );
  }

  const marketParams = validateMarketCandlesQuery({
    symbol: symbols[0],
    interval: query.interval,
    limit: query.limit,
  });

  for (const symbol of symbols) {
    validateMarketCandlesQuery({
      symbol,
      interval: marketParams.interval,
      limit: String(marketParams.limit),
    });
  }

  return {
    strategyId,
    symbols,
    interval: marketParams.interval,
    limit: marketParams.limit,
    params: query.params ?? {},
    maxWaitBars: query.maxWaitBars !== undefined ? Number(query.maxWaitBars) : undefined,
  };
};
