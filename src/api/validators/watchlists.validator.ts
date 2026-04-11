import { BadRequestAppError } from '../errors/AppError';

export interface WatchlistItemsQuery {
  limit?: string;
  offset?: string;
  search?: string;
}

export interface ValidatedWatchlistItemsQuery {
  limit: number;
  offset: number;
  search?: string;
}

export interface CreateWatchlistPayload {
  name?: string;
  type?: string;
  description?: string | null;
}

export interface ValidatedCreateWatchlistPayload {
  name: string;
  type: string;
  description?: string | null;
}

export interface UpdateWatchlistPayload {
  name?: string;
  description?: string | null;
}

export interface ValidatedUpdateWatchlistPayload {
  name?: string;
  description?: string | null;
}

export interface AddWatchlistItemsPayload {
  symbol?: string;
  symbols?: string[];
}

export interface ValidatedAddWatchlistItemsPayload {
  symbols: string[];
}

export interface RemoveWatchlistItemsPayload {
  symbol?: string;
  symbols?: string[];
}

export interface ValidatedRemoveWatchlistItemsPayload {
  symbols: string[];
}

export const validateWatchlistId = (watchlistId: string): string => {
  const normalizedWatchlistId = watchlistId.trim();

  if (!normalizedWatchlistId) {
    throw new BadRequestAppError('watchlistId is required');
  }

  return normalizedWatchlistId;
};

export const validateWatchlistItemsQuery = (
  query: WatchlistItemsQuery
): ValidatedWatchlistItemsQuery => {
  const limit = query.limit !== undefined ? Number(query.limit) : 50;
  const offset = query.offset !== undefined ? Number(query.offset) : 0;

  if (!Number.isInteger(limit) || limit <= 0 || limit > 100) {
    throw new BadRequestAppError('limit must be an integer between 1 and 100');
  }

  if (!Number.isInteger(offset) || offset < 0) {
    throw new BadRequestAppError('offset must be an integer greater than or equal to 0');
  }

  return {
    limit,
    offset,
    search: query.search?.trim() || undefined,
  };
};

export const validateCreateWatchlistPayload = (
  payload: CreateWatchlistPayload
): ValidatedCreateWatchlistPayload => {
  const name = payload.name?.trim();
  if (!name) {
    throw new BadRequestAppError('name is required');
  }
  if (name.length > 255) {
    throw new BadRequestAppError('name must be 255 characters or fewer');
  }

  const requestedType = payload.type?.trim();
  if (requestedType && requestedType.length > 30) {
    throw new BadRequestAppError('type must be 30 characters or fewer');
  }

  if (requestedType && requestedType.toLowerCase() !== 'manual') {
    throw new BadRequestAppError(
      'Only manual watchlists can be created from the watchlists workspace'
    );
  }

  const description = payload.description?.trim() || null;

  return {
    name,
    type: 'Manual',
    description,
  };
};

export const validateUpdateWatchlistPayload = (
  payload: UpdateWatchlistPayload
): ValidatedUpdateWatchlistPayload => {
  const output: ValidatedUpdateWatchlistPayload = {};

  if (Object.prototype.hasOwnProperty.call(payload, 'name')) {
    const name = payload.name?.trim();
    if (!name) {
      throw new BadRequestAppError('name is required');
    }
    if (name.length > 255) {
      throw new BadRequestAppError('name must be 255 characters or fewer');
    }
    output.name = name;
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'description')) {
    output.description = payload.description?.trim() || null;
  }

  if (!Object.keys(output).length) {
    throw new BadRequestAppError('At least one watchlist field must be provided');
  }

  return output;
};

export const validateAddWatchlistItemsPayload = (
  payload: AddWatchlistItemsPayload
): ValidatedAddWatchlistItemsPayload => {
  const rawSymbols = Array.isArray(payload.symbols) ? payload.symbols : [];
  if (payload.symbol) {
    rawSymbols.push(payload.symbol);
  }

  const symbols = Array.from(
    new Set(
      rawSymbols
        .map((symbol) => symbol?.trim().toUpperCase())
        .filter((symbol): symbol is string => Boolean(symbol))
    )
  );

  if (!symbols.length) {
    throw new BadRequestAppError('symbol is required');
  }

  if (symbols.some((symbol) => symbol.length > 50)) {
    throw new BadRequestAppError('symbol must be 50 characters or fewer');
  }

  return { symbols };
};

export const validateRemoveWatchlistItemsPayload = (
  payload: RemoveWatchlistItemsPayload
): ValidatedRemoveWatchlistItemsPayload => {
  const rawSymbols = Array.isArray(payload.symbols) ? payload.symbols : [];
  if (payload.symbol) {
    rawSymbols.push(payload.symbol);
  }

  const symbols = Array.from(
    new Set(
      rawSymbols
        .map((symbol) => symbol?.trim().toUpperCase())
        .filter((symbol): symbol is string => Boolean(symbol))
    )
  );

  if (!symbols.length) {
    throw new BadRequestAppError('symbol is required');
  }

  if (symbols.some((symbol) => symbol.length > 50)) {
    throw new BadRequestAppError('symbol must be 50 characters or fewer');
  }

  return { symbols };
};
