import { BadRequestAppError } from '../errors/AppError';

export interface RemoteFuturesQuery {
  sort?: string;
  order?: string;
  offset?: string;
  limit?: string;
}

export const validateAssetId = (assetId: string): string => {
  const normalizedAssetId = assetId.trim();

  if (!normalizedAssetId) {
    throw new BadRequestAppError('assetId is required');
  }

  return normalizedAssetId;
};

export const validateAssetSymbol = (symbol: string): string => {
  const normalizedSymbol = symbol.trim().toUpperCase();

  if (!normalizedSymbol) {
    throw new BadRequestAppError('symbol is required');
  }

  if (!/^[A-Z0-9_:-]+$/.test(normalizedSymbol)) {
    throw new BadRequestAppError('symbol contains invalid characters');
  }

  return normalizedSymbol;
};

export interface ValidatedRemoteFuturesQuery {
  sort?: string;
  order?: 'asc' | 'desc';
  offset: number;
  limit: number;
}

const allowedSorts = new Set(['price', 'popularity', 'volume', 'change_perc', 'name', 'symbol']);
const allowedOrders = new Set(['asc', 'desc']);

export const validateRemoteFuturesQuery = (
  query: RemoteFuturesQuery
): ValidatedRemoteFuturesQuery => {
  const offset = query.offset !== undefined ? Number(query.offset) : 0;
  const limit = query.limit !== undefined ? Number(query.limit) : 20;

  if (!Number.isInteger(offset) || offset < 0) {
    throw new BadRequestAppError('offset must be a non-negative integer');
  }

  if (!Number.isInteger(limit) || limit <= 0 || limit > 100) {
    throw new BadRequestAppError('limit must be an integer between 1 and 100');
  }

  if (query.sort && !allowedSorts.has(query.sort)) {
    throw new BadRequestAppError(
      'sort must be one of: price, popularity, volume, change_perc, name, symbol'
    );
  }

  const normalizedOrder = query.order?.toLowerCase();
  if (normalizedOrder && !allowedOrders.has(normalizedOrder)) {
    throw new BadRequestAppError('order must be one of: asc, desc');
  }

  return {
    sort: query.sort,
    order: normalizedOrder as 'asc' | 'desc' | undefined,
    offset,
    limit,
  };
};
