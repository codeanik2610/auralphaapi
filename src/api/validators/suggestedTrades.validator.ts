import { BadRequestAppError } from '../errors/AppError';
import type { SuggestedTradeStatus } from '../contracts/SuggestedTrade';

const VALID_STATUSES: SuggestedTradeStatus[] = [
  'Open',
  'Reviewed',
  'Accepted',
  'Dismissed',
  'Expired',
];
const VALID_EXECUTION_STATES = [
  'queued',
  'submitting',
  'linked',
  'working',
  'filled',
  'cancelled',
  'rejected',
  'expired',
  'failed',
  'closed',
  'unknown',
] as const;

export interface SuggestedTradesQuery {
  limit?: string;
  offset?: string;
  status?: string;
  executionState?: string;
  symbol?: string;
  timeframe?: string;
  automationId?: string;
  automationRunId?: string;
  side?: string;
  search?: string;
}

export interface ValidatedSuggestedTradesQuery {
  limit: number;
  offset: number;
  status?: string;
  executionState?: (typeof VALID_EXECUTION_STATES)[number];
  symbol?: string;
  timeframe?: string;
  automationId?: string;
  automationRunId?: string;
  side?: 'BUY' | 'SELL';
  search?: string;
}

export interface SuggestedTradeActionBody {
  note?: string;
}

export interface ValidatedSuggestedTradeActionBody {
  note?: string;
}

export interface SuggestedTradeOrderLinkBody {
  executionMode?: string;
  orderId?: string;
  paperOrderId?: string;
  brokerKey?: string;
  accountId?: string;
  orderStatus?: string;
  paperOrderStatus?: string;
  orderType?: string;
  triggerType?: string;
  leverage?: number | string | null;
  quantity?: number | string | null;
  entryPrice?: number | string | null;
  stopLossPrice?: number | string | null;
  takeProfitPrice?: number | string | null;
  note?: string;
}

export interface ValidatedSuggestedTradeOrderLinkBody {
  executionMode?: 'live' | 'paper';
  orderId?: string;
  paperOrderId?: string;
  brokerKey?: string;
  accountId?: string;
  orderStatus?: string;
  paperOrderStatus?: string;
  orderType?: string;
  triggerType?: string;
  leverage?: number | null;
  quantity?: number | null;
  entryPrice?: number | null;
  stopLossPrice?: number | null;
  takeProfitPrice?: number | null;
  note?: string;
}

export interface SuggestedTradesExecutionSyncBody extends SuggestedTradesQuery {
  suggestedTradeIds?: string[];
  staleOnly?: boolean | string;
}

export interface ValidatedSuggestedTradesExecutionSyncBody
  extends Omit<ValidatedSuggestedTradesQuery, 'offset'> {
  suggestedTradeIds?: string[];
  staleOnly: boolean;
}

export const validateSuggestedTradesQuery = (
  query: SuggestedTradesQuery
): ValidatedSuggestedTradesQuery => {
  const limit = query.limit !== undefined ? Number(query.limit) : 20;
  const offset = query.offset !== undefined ? Number(query.offset) : 0;

  if (!Number.isInteger(limit) || limit <= 0 || limit > 100) {
    throw new BadRequestAppError('limit must be an integer between 1 and 100');
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new BadRequestAppError('offset must be an integer greater than or equal to 0');
  }

  const status = query.status?.trim();
  if (status && !VALID_STATUSES.includes(status as SuggestedTradeStatus)) {
    throw new BadRequestAppError(`status must be one of: ${VALID_STATUSES.join(', ')}`);
  }
  const executionState = query.executionState?.trim().toLowerCase();
  if (
    executionState &&
    !VALID_EXECUTION_STATES.includes(
      executionState as (typeof VALID_EXECUTION_STATES)[number]
    )
  ) {
    throw new BadRequestAppError(
      `executionState must be one of: ${VALID_EXECUTION_STATES.join(', ')}`
    );
  }

  const side = query.side?.trim().toUpperCase();
  if (side && side !== 'BUY' && side !== 'SELL') {
    throw new BadRequestAppError('side must be BUY or SELL');
  }

  return {
    limit,
    offset,
    status: status || undefined,
    executionState:
      (executionState as (typeof VALID_EXECUTION_STATES)[number] | undefined) ?? undefined,
    symbol: query.symbol?.trim().toUpperCase() || undefined,
    timeframe: query.timeframe?.trim() || undefined,
    automationId: query.automationId?.trim() || undefined,
    automationRunId: query.automationRunId?.trim() || undefined,
    side: (side as 'BUY' | 'SELL' | undefined) ?? undefined,
    search: query.search?.trim() || undefined,
  };
};

export const validateSuggestedTradeId = (tradeId: string): string => {
  const normalized = tradeId.trim();
  if (!normalized) {
    throw new BadRequestAppError('suggestedTradeId is required');
  }
  return normalized;
};

export const validateSuggestedTradeActionBody = (
  body: SuggestedTradeActionBody | undefined | null
): ValidatedSuggestedTradeActionBody => {
  const note = body?.note?.trim();

  if (note && note.length > 500) {
    throw new BadRequestAppError('note must be 500 characters or fewer');
  }

  return {
    note: note || undefined,
  };
};

const validateOptionalText = (
  value: unknown,
  fieldName: string,
  maxLength: number
): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  const normalized = String(value).trim();
  if (!normalized) {
    return undefined;
  }
  if (normalized.length > maxLength) {
    throw new BadRequestAppError(`${fieldName} must be ${maxLength} characters or fewer`);
  }

  return normalized;
};

const validateOptionalNumber = (
  value: unknown,
  fieldName: string
): number | null | undefined => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new BadRequestAppError(`${fieldName} must be a positive number`);
  }

  return numeric;
};

export const validateSuggestedTradeOrderLinkBody = (
  body: SuggestedTradeOrderLinkBody | undefined | null
): ValidatedSuggestedTradeOrderLinkBody => {
  const note = validateOptionalText(body?.note, 'note', 500);
  const executionModeRaw = validateOptionalText(body?.executionMode, 'executionMode', 16);
  let executionMode: 'live' | 'paper' | undefined;
  if (executionModeRaw) {
    if (executionModeRaw.toLowerCase() === 'paper') {
      executionMode = 'paper';
    } else if (executionModeRaw.toLowerCase() === 'live') {
      executionMode = 'live';
    }
  }
  if (executionModeRaw && !executionMode) {
    throw new BadRequestAppError('executionMode must be either live or paper');
  }

  return {
    executionMode,
    orderId: validateOptionalText(body?.orderId, 'orderId', 120),
    paperOrderId: validateOptionalText(body?.paperOrderId, 'paperOrderId', 120),
    brokerKey: validateOptionalText(body?.brokerKey, 'brokerKey', 120),
    accountId: validateOptionalText(body?.accountId, 'accountId', 120),
    orderStatus: validateOptionalText(body?.orderStatus, 'orderStatus', 64),
    paperOrderStatus: validateOptionalText(body?.paperOrderStatus, 'paperOrderStatus', 64),
    orderType: validateOptionalText(body?.orderType, 'orderType', 64),
    triggerType: validateOptionalText(body?.triggerType, 'triggerType', 64),
    leverage: validateOptionalNumber(body?.leverage, 'leverage') ?? undefined,
    quantity: validateOptionalNumber(body?.quantity, 'quantity') ?? undefined,
    entryPrice: validateOptionalNumber(body?.entryPrice, 'entryPrice') ?? undefined,
    stopLossPrice: validateOptionalNumber(body?.stopLossPrice, 'stopLossPrice') ?? undefined,
    takeProfitPrice:
      validateOptionalNumber(body?.takeProfitPrice, 'takeProfitPrice') ?? undefined,
    note,
  };
};

export const validateSuggestedTradesExecutionSyncBody = (
  body: SuggestedTradesExecutionSyncBody | undefined | null
): ValidatedSuggestedTradesExecutionSyncBody => {
  const normalizedBody = body ?? {};
  const staleOnlyRaw = normalizedBody.staleOnly;
  const staleOnly =
    staleOnlyRaw === undefined || staleOnlyRaw === null
      ? true
      : typeof staleOnlyRaw === 'boolean'
        ? staleOnlyRaw
        : ['true', '1', 'yes'].includes(String(staleOnlyRaw).trim().toLowerCase())
          ? true
          : ['false', '0', 'no'].includes(String(staleOnlyRaw).trim().toLowerCase())
            ? false
            : null;

  if (staleOnly === null) {
    throw new BadRequestAppError('staleOnly must be true or false');
  }

  const suggestedTradeIds = Array.from(
    new Set(
      (normalizedBody.suggestedTradeIds ?? [])
        .map((value) => String(value || '').trim())
        .filter(Boolean)
    )
  );

  if (suggestedTradeIds.length > 100) {
    throw new BadRequestAppError('suggestedTradeIds must contain 100 ids or fewer');
  }

  const validatedQuery = validateSuggestedTradesQuery({
    limit:
      normalizedBody.limit === undefined || normalizedBody.limit === null
        ? '50'
        : String(normalizedBody.limit),
    status: normalizedBody.status,
    executionState: normalizedBody.executionState,
    symbol: normalizedBody.symbol,
    timeframe: normalizedBody.timeframe,
    automationId: normalizedBody.automationId,
    automationRunId: normalizedBody.automationRunId,
    side: normalizedBody.side,
    search: normalizedBody.search,
  });

  return {
    limit: validatedQuery.limit,
    status: validatedQuery.status,
    executionState: validatedQuery.executionState,
    symbol: validatedQuery.symbol,
    timeframe: validatedQuery.timeframe,
    automationId: validatedQuery.automationId,
    automationRunId: validatedQuery.automationRunId,
    side: validatedQuery.side,
    search: validatedQuery.search,
    suggestedTradeIds: suggestedTradeIds.length ? suggestedTradeIds : undefined,
    staleOnly,
  };
};
