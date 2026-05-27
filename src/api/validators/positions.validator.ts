import { BadRequestAppError } from '../errors/AppError';

const normalizeOptional = (value?: string): string | undefined => {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
};

export interface PositionsHistoryQuery {
  limit?: string;
  brokerKey?: string;
  accountId?: string;
  symbol?: string;
  startDate?: string;
  endDate?: string;
}

export interface PositionsQuery {
  limit?: string;
  brokerKey?: string;
  accountId?: string;
}

export interface PositionsRefreshBody {
  brokerKey?: string;
  accountId?: string;
}

export interface PositionLiqPriceQuery {
  ext_margin?: string;
  brokerKey?: string;
  accountId?: string;
}

export interface AddMarginBody {
  margin?: number;
}

export interface CreateRiskOrderBody {
  stoploss_price?: string;
  takeprofit_price?: string;
  order_source?: string;
  is_stoploss?: boolean;
  is_takeprofit?: boolean;
}

export interface UpdateRiskOrderBody {
  order_price?: number;
  stoploss_price?: number;
  takeprofit_price?: number;
  stoploss_order_id?: string;
  takeprofit_order_id?: string;
  trigger_type?: string;
  is_takeprofit?: boolean;
  is_stoploss?: boolean;
}

export interface ClosePartialPositionBody {
  order_type?: string;
  quantity?: string;
  limit_price?: string;
}

export const validatePositionId = (positionId: string): string => {
  const normalizedPositionId = positionId.trim();

  if (!normalizedPositionId) {
    throw new BadRequestAppError('positionId is required');
  }

  return normalizedPositionId;
};

export const validatePositionsHistoryQuery = (
  query: PositionsHistoryQuery
): {
  limit: number;
  brokerKey?: string;
  accountId?: string;
  symbol?: string;
  startDate?: string;
  endDate?: string;
} => {
  const limit = query.limit !== undefined ? Number(query.limit) : 20;

  if (!Number.isInteger(limit) || limit <= 0 || limit > 1000000) {
    throw new BadRequestAppError('limit must be an integer between 1 and 1000000');
  }

  const startDate = normalizeOptional(query.startDate);
  const endDate = normalizeOptional(query.endDate);
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;

  if (startDate && !datePattern.test(startDate)) {
    throw new BadRequestAppError('startDate must be in YYYY-MM-DD format');
  }

  if (endDate && !datePattern.test(endDate)) {
    throw new BadRequestAppError('endDate must be in YYYY-MM-DD format');
  }

  if (startDate && endDate && startDate > endDate) {
    throw new BadRequestAppError('startDate cannot be greater than endDate');
  }

  return {
    limit,
    brokerKey: normalizeOptional(query.brokerKey),
    accountId: normalizeOptional(query.accountId),
    symbol: normalizeOptional(query.symbol)?.toUpperCase(),
    startDate,
    endDate,
  };
};

export const validatePositionsQuery = (
  query: PositionsQuery
): {
  limit?: number;
  brokerKey?: string;
  accountId?: string;
} => {
  const rawLimit = query.limit !== undefined ? String(query.limit).trim() : '';
  const limit = rawLimit ? Number(rawLimit) : undefined;

  // If limit isn't provided, preserve existing behavior (return all open positions).
  if (limit !== undefined) {
    if (!Number.isInteger(limit) || limit <= 0 || limit > 50000) {
      throw new BadRequestAppError('limit must be an integer between 1 and 50000');
    }
  }

  return {
    limit,
    brokerKey: normalizeOptional(query.brokerKey),
    accountId: normalizeOptional(query.accountId),
  };
};

export const validatePositionsRefreshBody = (
  body: PositionsRefreshBody = {}
): {
  brokerKey?: string;
  accountId?: string;
} => ({
  brokerKey: normalizeOptional(body.brokerKey),
  accountId: normalizeOptional(body.accountId),
});

export const validatePositionLiqPriceQuery = (
  query: PositionLiqPriceQuery
): { ext_margin: number; brokerKey?: string; accountId?: string } => {
  const extMargin = query.ext_margin !== undefined ? Number(query.ext_margin) : NaN;

  if (!Number.isFinite(extMargin) || extMargin < 0) {
    throw new BadRequestAppError('ext_margin must be a non-negative number');
  }

  return {
    ext_margin: extMargin,
    brokerKey: normalizeOptional(query.brokerKey),
    accountId: normalizeOptional(query.accountId),
  };
};

export const validateAddMarginBody = (body: AddMarginBody): { margin: number } => {
  if (!Number.isFinite(body.margin) || (body.margin as number) <= 0) {
    throw new BadRequestAppError('margin must be a positive number');
  }

  return { margin: body.margin as number };
};

export const validateCreateRiskOrderBody = (
  body: CreateRiskOrderBody
): Required<CreateRiskOrderBody> => {
  if (!body.stoploss_price?.trim()) {
    throw new BadRequestAppError('stoploss_price is required');
  }

  if (!body.takeprofit_price?.trim()) {
    throw new BadRequestAppError('takeprofit_price is required');
  }

  if (!body.order_source?.trim()) {
    throw new BadRequestAppError('order_source is required');
  }

  if (typeof body.is_stoploss !== 'boolean') {
    throw new BadRequestAppError('is_stoploss must be a boolean');
  }

  if (typeof body.is_takeprofit !== 'boolean') {
    throw new BadRequestAppError('is_takeprofit must be a boolean');
  }

  return {
    stoploss_price: body.stoploss_price.trim(),
    takeprofit_price: body.takeprofit_price.trim(),
    order_source: body.order_source.trim(),
    is_stoploss: body.is_stoploss,
    is_takeprofit: body.is_takeprofit,
  };
};

export const validateUpdateRiskOrderBody = (
  body: UpdateRiskOrderBody
): Required<UpdateRiskOrderBody> => {
  if (!Number.isFinite(body.order_price)) {
    throw new BadRequestAppError('order_price must be a number');
  }

  if (!Number.isFinite(body.stoploss_price)) {
    throw new BadRequestAppError('stoploss_price must be a number');
  }

  if (!Number.isFinite(body.takeprofit_price)) {
    throw new BadRequestAppError('takeprofit_price must be a number');
  }

  if (!body.stoploss_order_id?.trim()) {
    throw new BadRequestAppError('stoploss_order_id is required');
  }

  if (!body.takeprofit_order_id?.trim()) {
    throw new BadRequestAppError('takeprofit_order_id is required');
  }

  if (!body.trigger_type?.trim()) {
    throw new BadRequestAppError('trigger_type is required');
  }

  if (typeof body.is_takeprofit !== 'boolean') {
    throw new BadRequestAppError('is_takeprofit must be a boolean');
  }

  if (typeof body.is_stoploss !== 'boolean') {
    throw new BadRequestAppError('is_stoploss must be a boolean');
  }

  return {
    order_price: body.order_price as number,
    stoploss_price: body.stoploss_price as number,
    takeprofit_price: body.takeprofit_price as number,
    stoploss_order_id: body.stoploss_order_id.trim(),
    takeprofit_order_id: body.takeprofit_order_id.trim(),
    trigger_type: body.trigger_type.trim(),
    is_takeprofit: body.is_takeprofit,
    is_stoploss: body.is_stoploss,
  };
};

export const validateClosePartialPositionBody = (
  body: ClosePartialPositionBody
): Required<ClosePartialPositionBody> => {
  if (!body.order_type?.trim()) {
    throw new BadRequestAppError('order_type is required');
  }

  if (!body.quantity?.trim()) {
    throw new BadRequestAppError('quantity is required');
  }

  if (!body.limit_price?.trim()) {
    throw new BadRequestAppError('limit_price is required');
  }

  return {
    order_type: body.order_type.trim(),
    quantity: body.quantity.trim(),
    limit_price: body.limit_price.trim(),
  };
};
