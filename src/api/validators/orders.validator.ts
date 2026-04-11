import { BadRequestAppError } from '../errors/AppError';

export interface OrdersQuery {
  limit?: string;
  brokerKey?: string;
  accountId?: string;
  startDate?: string;
  endDate?: string;
}

export interface OrdersRefreshBody {
  brokerKey?: string;
  accountId?: string;
}

export interface OrdersSyncStatusQuery {
  brokerKey?: string;
  accountId?: string;
}

export interface CreateOrderBody {
  brokerKey?: string;
  accountId?: string;
  idempotency_key?: string;
  symbol?: string;
  side?: string;
  execution_mode?: string;
  suggested_trade_id?: string;
  leverage?: number;
  quantity?: number;
  order_price?: number;
  order_type?: string;
  trigger_type?: string;
  is_takeprofit?: boolean;
  is_stoploss?: boolean;
  stoploss_price?: number;
  takeprofit_price?: number;
  reduce_only?: boolean;
}

export interface ValidatedCreateOrderBody {
  brokerKey?: string;
  accountId?: string;
  idempotency_key?: string;
  symbol?: string;
  side?: 'long' | 'short';
  execution_mode: 'live' | 'paper';
  suggested_trade_id?: string;
  leverage: number;
  quantity: number;
  order_price: number;
  order_type: string;
  trigger_type: string;
  is_takeprofit: boolean;
  is_stoploss: boolean;
  stoploss_price: number;
  takeprofit_price: number;
  reduce_only: boolean;
}

const normalizeOptional = (value?: string): string | undefined => {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
};

export const validateOrdersQuery = (
  query: OrdersQuery
): { limit: number; brokerKey?: string; accountId?: string; startDate?: string; endDate?: string } => {
  const limit = query.limit !== undefined ? Number(query.limit) : 100;

  // Some brokers support large page sizes; internal sync paths rely on this.
  // Keep a reasonable upper bound to prevent accidental unbounded reads.
  if (!Number.isInteger(limit) || limit <= 0 || limit > 50000) {
    throw new BadRequestAppError('limit must be an integer between 1 and 50000');
  }

  const startDate = normalizeOptional(query.startDate);
  const endDate = normalizeOptional(query.endDate);

  if (startDate && Number.isNaN(new Date(startDate).getTime())) {
    throw new BadRequestAppError('startDate must be a valid date');
  }

  if (endDate && Number.isNaN(new Date(endDate).getTime())) {
    throw new BadRequestAppError('endDate must be a valid date');
  }

  if (startDate && endDate && new Date(startDate).getTime() > new Date(endDate).getTime()) {
    throw new BadRequestAppError('startDate must be earlier than or equal to endDate');
  }

  return {
    limit,
    brokerKey: normalizeOptional(query.brokerKey),
    accountId: normalizeOptional(query.accountId),
    startDate,
    endDate,
  };
};

export const validateOrderId = (orderId: string): string => {
  const normalizedOrderId = orderId.trim();

  if (!normalizedOrderId) {
    throw new BadRequestAppError('orderId is required');
  }

  return normalizedOrderId;
};

export const validateOrdersRefreshBody = (
  body: OrdersRefreshBody = {}
): { brokerKey?: string; accountId?: string } => ({
  brokerKey: normalizeOptional(body.brokerKey),
  accountId: normalizeOptional(body.accountId),
});

export const validateOrdersSyncStatusQuery = (
  query: OrdersSyncStatusQuery = {}
): { brokerKey?: string; accountId?: string } => ({
  brokerKey: normalizeOptional(query.brokerKey),
  accountId: normalizeOptional(query.accountId),
});

export const validateCreateOrderBody = (body: CreateOrderBody): ValidatedCreateOrderBody => {
  const idempotencyKey = normalizeOptional(body.idempotency_key);
  if (idempotencyKey && (idempotencyKey.length < 8 || idempotencyKey.length > 191)) {
    throw new BadRequestAppError(
      'idempotency_key must be between 8 and 191 characters when provided'
    );
  }

  if (!Number.isFinite(body.leverage) || (body.leverage as number) <= 0) {
    throw new BadRequestAppError('leverage must be a positive number');
  }

  if (!Number.isFinite(body.quantity) || (body.quantity as number) <= 0) {
    throw new BadRequestAppError('quantity must be a positive number');
  }

  if (!Number.isFinite(body.order_price) || (body.order_price as number) <= 0) {
    throw new BadRequestAppError('order_price must be a positive number');
  }

  if (!body.order_type?.trim()) {
    throw new BadRequestAppError('order_type is required');
  }

  if (!body.trigger_type?.trim()) {
    throw new BadRequestAppError('trigger_type is required');
  }

  const sideRaw = normalizeOptional(body.side)?.toLowerCase();
  const side =
    sideRaw === 'short' || sideRaw === 'sell'
      ? 'short'
      : sideRaw === 'long' || sideRaw === 'buy' || !sideRaw
        ? 'long'
        : null;
  if (!side) {
    throw new BadRequestAppError('side must be either long or short');
  }

  if (typeof body.is_takeprofit !== 'boolean') {
    throw new BadRequestAppError('is_takeprofit must be a boolean');
  }

  if (typeof body.is_stoploss !== 'boolean') {
    throw new BadRequestAppError('is_stoploss must be a boolean');
  }

  if (!Number.isFinite(body.stoploss_price) || (body.stoploss_price as number) <= 0) {
    throw new BadRequestAppError('stoploss_price must be a positive number');
  }

  if (!Number.isFinite(body.takeprofit_price) || (body.takeprofit_price as number) <= 0) {
    throw new BadRequestAppError('takeprofit_price must be a positive number');
  }

  if (typeof body.reduce_only !== 'boolean') {
    throw new BadRequestAppError('reduce_only must be a boolean');
  }

  const executionModeRaw = normalizeOptional(body.execution_mode)?.toLowerCase();
  const executionMode =
    executionModeRaw === 'paper' ? 'paper' : executionModeRaw === 'live' || !executionModeRaw ? 'live' : null;
  if (!executionMode) {
    throw new BadRequestAppError('execution_mode must be either live or paper');
  }

  return {
    brokerKey: normalizeOptional(body.brokerKey),
    accountId: normalizeOptional(body.accountId),
    idempotency_key: idempotencyKey,
    symbol: normalizeOptional(body.symbol)?.toUpperCase(),
    side,
    execution_mode: executionMode,
    suggested_trade_id: normalizeOptional(body.suggested_trade_id),
    leverage: body.leverage as number,
    quantity: body.quantity as number,
    order_price: body.order_price as number,
    order_type: body.order_type.trim(),
    trigger_type: body.trigger_type.trim(),
    is_takeprofit: body.is_takeprofit,
    is_stoploss: body.is_stoploss,
    stoploss_price: body.stoploss_price as number,
    takeprofit_price: body.takeprofit_price as number,
    reduce_only: body.reduce_only,
  };
};
