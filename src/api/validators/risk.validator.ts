import { BadRequestAppError } from '../errors/AppError';
import {
  RiskPreTradeApprovalMode,
  RiskPreTradeCheckBody,
  RiskPreTradeExecutionMode,
  RiskPreTradeOrderType,
  RiskPreTradeQuantityMode,
  RiskPreTradeRouteMode,
  ReviewRiskPolicyVersionBody,
  RiskKillSwitchBody,
  RollbackRiskPolicyBody,
  UpsertRiskPolicyBody,
} from '../contracts/Risk';

export interface RiskAlertsQuery {
  limit?: string;
  offset?: string;
  status?: string;
  scope?: string;
}

export interface ValidatedRiskAlertsQuery {
  limit: number;
  offset: number;
  status?: string;
  scope?: string;
}

export interface RiskControlsQuery {
  limit?: string;
  offset?: string;
  status?: string;
  scope?: string;
}

export interface ValidatedRiskControlsQuery {
  limit: number;
  offset: number;
  status?: string;
  scope?: string;
}

export interface RiskScenariosQuery {
  limit?: string;
  offset?: string;
  status?: string;
  scope?: string;
}

export interface ValidatedRiskScenariosQuery {
  limit: number;
  offset: number;
  status?: string;
  scope?: string;
}

export interface ValidatedRiskPreTradeCheckBody {
  snapshotId?: string;
  suggestedTradeId?: string;
  automationId?: string;
  automationRunId?: string;
  sourceType: string;
  executionMode: RiskPreTradeExecutionMode;
  approvalMode: RiskPreTradeApprovalMode;
  routing: {
    routeMode: RiskPreTradeRouteMode;
    brokerKey?: string | null;
    accountId?: string | null;
  };
  order: {
    symbol?: string;
    timeframe?: string | null;
    side?: 'BUY' | 'SELL';
    orderType: RiskPreTradeOrderType;
    timeInForce?: 'GTC' | 'IOC' | 'FOK' | null;
    quantityMode: RiskPreTradeQuantityMode;
    quantity?: number | null;
    notional?: number | null;
    riskPercent?: number | null;
    entryPrice?: number | null;
    stopLossPrice?: number | null;
    takeProfitTargets?: number[] | null;
    leverage?: number | null;
    reduceOnly: boolean;
  };
}

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

const readBoolean = (value: unknown, fallback = false): boolean => {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes'].includes(normalized)) {
      return true;
    }
    if (['false', '0', 'no'].includes(normalized)) {
      return false;
    }
  }
  return fallback;
};

const readNumber = (value: unknown, field: string): number => {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    throw new BadRequestAppError(`${field} must be a number`);
  }
  return numeric;
};

const readOptionalNumber = (value: unknown, field: string): number | null => {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  return readNumber(value, field);
};

export const validateRiskKillSwitchBody = (
  body: RiskKillSwitchBody = {}
): Required<RiskKillSwitchBody> => {
  const scope = normalizeKillSwitchScope(body.scope);
  const brokerKey = normalizeOptionalString(body.brokerKey);
  const accountId = normalizeOptionalString(body.accountId);
  if (scope === 'broker' && !brokerKey) {
    throw new BadRequestAppError('brokerKey is required for broker kill switch scope');
  }
  const reason = body.reason?.trim() || 'Operator initiated emergency stop';
  return {
    scope,
    brokerKey,
    accountId,
    reason,
  };
};

export const validateRiskKillSwitchClearBody = (
  body: RiskKillSwitchBody = {}
): Required<RiskKillSwitchBody> => {
  const validated = validateRiskKillSwitchBody({
    ...body,
    reason: body.reason?.trim() || 'Operator cleared emergency stop',
  });
  return validated;
};

const normalizeKillSwitchScope = (scopeValue?: string): string => {
  const scope = String(scopeValue || 'workspace')
    .trim()
    .toLowerCase();
  if (!['workspace', 'user', 'global', 'broker'].includes(scope)) {
    throw new BadRequestAppError('scope must be workspace, user, global, or broker');
  }
  return scope;
};

const normalizeOptionalString = (value: unknown): string | null => {
  const normalized = String(value || '').trim();
  return normalized || null;
};

export const validateRiskAlertsQuery = (query: RiskAlertsQuery = {}): ValidatedRiskAlertsQuery => {
  const limit = query.limit !== undefined ? Number(query.limit) : 10;
  const offset = query.offset !== undefined ? Number(query.offset) : 0;

  if (!Number.isInteger(limit) || limit <= 0 || limit > 200) {
    throw new BadRequestAppError('limit must be an integer between 1 and 200');
  }

  if (!Number.isInteger(offset) || offset < 0) {
    throw new BadRequestAppError('offset must be an integer greater than or equal to 0');
  }

  return {
    limit,
    offset,
    status: query.status?.trim() || undefined,
    scope: query.scope?.trim() || undefined,
  };
};

export const validateRiskControlsQuery = (
  query: RiskControlsQuery = {}
): ValidatedRiskControlsQuery => {
  return validateRiskAlertsQuery(query);
};

export const validateRiskScenariosQuery = (
  query: RiskScenariosQuery = {}
): ValidatedRiskScenariosQuery => {
  return validateRiskAlertsQuery(query);
};

export const validateRiskPreTradeCheckBody = (
  body: RiskPreTradeCheckBody = {}
): ValidatedRiskPreTradeCheckBody => {
  const routing = parseRecord(body.routing) ?? {};
  const order = parseRecord(body.order) ?? {};

  const executionMode = (
    readString(body.executionMode) || 'paper'
  ).toLowerCase() as RiskPreTradeExecutionMode;
  if (executionMode !== 'paper' && executionMode !== 'live') {
    throw new BadRequestAppError('executionMode must be one of: paper, live');
  }

  const approvalMode = (
    readString(body.approvalMode) || 'manual_review'
  ).toLowerCase() as RiskPreTradeApprovalMode;
  if (approvalMode !== 'manual_review' && approvalMode !== 'auto_if_safe') {
    throw new BadRequestAppError('approvalMode must be one of: manual_review, auto_if_safe');
  }

  const routeMode = (
    readString(routing.routeMode) || 'strategy_default'
  ).toLowerCase() as RiskPreTradeRouteMode;
  if (routeMode !== 'strategy_default' && routeMode !== 'user_default' && routeMode !== 'fixed') {
    throw new BadRequestAppError(
      'routing.routeMode must be one of: strategy_default, user_default, fixed'
    );
  }

  const brokerKey = readString(routing.brokerKey)?.toLowerCase() || null;
  const accountId = readString(routing.accountId) || null;
  if (routeMode === 'fixed' && !brokerKey) {
    throw new BadRequestAppError('routing.brokerKey is required when routing.routeMode is fixed');
  }

  const orderType = (
    readString(order.orderType) || 'market'
  ).toLowerCase() as RiskPreTradeOrderType;
  if (orderType !== 'market' && orderType !== 'limit') {
    throw new BadRequestAppError('order.orderType must be one of: market, limit');
  }

  const quantityMode = (
    readString(order.quantityMode) || 'notional'
  ).toLowerCase() as RiskPreTradeQuantityMode;
  if (
    quantityMode !== 'quantity' &&
    quantityMode !== 'notional' &&
    quantityMode !== 'risk_percent'
  ) {
    throw new BadRequestAppError(
      'order.quantityMode must be one of: quantity, notional, risk_percent'
    );
  }

  const timeInForce = readString(order.timeInForce)?.toUpperCase() || null;
  if (timeInForce && !['GTC', 'IOC', 'FOK'].includes(timeInForce)) {
    throw new BadRequestAppError('order.timeInForce must be one of: GTC, IOC, FOK');
  }

  const symbol = readString(order.symbol)?.toUpperCase();
  const timeframe = readString(order.timeframe) || null;
  const side = readString(order.side)?.toUpperCase() as 'BUY' | 'SELL' | undefined;
  if (side && side !== 'BUY' && side !== 'SELL') {
    throw new BadRequestAppError('order.side must be one of: BUY, SELL');
  }

  const entryPrice = readOptionalNumber(order.entryPrice, 'order.entryPrice');
  const quantity = readOptionalNumber(order.quantity, 'order.quantity');
  const notional = readOptionalNumber(order.notional, 'order.notional');
  const riskPercent = readOptionalNumber(order.riskPercent, 'order.riskPercent');
  const stopLossPrice = readOptionalNumber(order.stopLossPrice, 'order.stopLossPrice');
  const leverage = readOptionalNumber(order.leverage, 'order.leverage');

  if (orderType === 'limit' && !(entryPrice && entryPrice > 0)) {
    throw new BadRequestAppError('order.entryPrice is required for limit orders');
  }
  if (quantityMode === 'quantity') {
    if (!(quantity && quantity > 0)) {
      throw new BadRequestAppError(
        'order.quantity must be greater than 0 when quantityMode is quantity'
      );
    }
    if (!(entryPrice && entryPrice > 0)) {
      throw new BadRequestAppError(
        'order.entryPrice must be greater than 0 when quantityMode is quantity'
      );
    }
  }
  if (quantityMode === 'notional' && !(notional && notional > 0)) {
    throw new BadRequestAppError(
      'order.notional must be greater than 0 when quantityMode is notional'
    );
  }
  if (quantityMode === 'risk_percent' && !(riskPercent && riskPercent > 0)) {
    throw new BadRequestAppError(
      'order.riskPercent must be greater than 0 when quantityMode is risk_percent'
    );
  }
  if (leverage !== null && leverage <= 0) {
    throw new BadRequestAppError('order.leverage must be greater than 0 when provided');
  }
  if (stopLossPrice !== null && stopLossPrice <= 0) {
    throw new BadRequestAppError('order.stopLossPrice must be greater than 0 when provided');
  }

  const takeProfitTargets = Array.isArray(order.takeProfitTargets)
    ? order.takeProfitTargets.map((value, index) => {
        const numeric = readNumber(value, `order.takeProfitTargets[${index}]`);
        if (numeric <= 0) {
          throw new BadRequestAppError(`order.takeProfitTargets[${index}] must be greater than 0`);
        }
        return numeric;
      })
    : null;

  return {
    snapshotId: readString(body.snapshotId) || undefined,
    suggestedTradeId: readString(body.suggestedTradeId) || undefined,
    automationId: readString(body.automationId) || undefined,
    automationRunId: readString(body.automationRunId) || undefined,
    sourceType: readString(body.sourceType) || 'suggested_trade',
    executionMode,
    approvalMode,
    routing: {
      routeMode,
      brokerKey,
      accountId,
    },
    order: {
      symbol,
      timeframe,
      side,
      orderType,
      timeInForce: timeInForce as 'GTC' | 'IOC' | 'FOK' | null,
      quantityMode,
      quantity,
      notional,
      riskPercent,
      entryPrice,
      stopLossPrice,
      takeProfitTargets,
      leverage,
      reduceOnly: readBoolean(order.reduceOnly, false),
    },
  };
};

export const validateUpsertRiskPolicyBody = (
  body: Partial<UpsertRiskPolicyBody> = {}
): UpsertRiskPolicyBody => {
  const coerceBoolean = (value: unknown, field: string): boolean => {
    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === 'true' || normalized === '1') {
        return true;
      }
      if (normalized === 'false' || normalized === '0') {
        return false;
      }
    }

    if (typeof value === 'number') {
      if (value === 1) {
        return true;
      }
      if (value === 0) {
        return false;
      }
    }

    throw new BadRequestAppError(`${field} must be a boolean`);
  };

  const coerceNumber = (
    value: unknown,
    field: string,
    options: { min?: number; max?: number; allowNull?: boolean } = {}
  ): number | undefined => {
    if (value === undefined || value === null || value === '') {
      if (options.allowNull) {
        return undefined;
      }
      throw new BadRequestAppError(`${field} is required`);
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      throw new BadRequestAppError(`${field} must be a number`);
    }
    if (options.min !== undefined && numeric < options.min) {
      throw new BadRequestAppError(`${field} must be >= ${options.min}`);
    }
    if (options.max !== undefined && numeric > options.max) {
      throw new BadRequestAppError(`${field} must be <= ${options.max}`);
    }
    return numeric;
  };

  const rawScope = String(body.scope ?? 'user')
    .trim()
    .toLowerCase();
  if (rawScope !== 'user' && rawScope !== 'broker') {
    throw new BadRequestAppError('scope must be one of: user, broker');
  }

  const scope = rawScope as UpsertRiskPolicyBody['scope'];
  const brokerKey =
    scope === 'broker' && body.brokerKey ? String(body.brokerKey).trim().toLowerCase() : undefined;
  if (scope === 'broker' && !brokerKey) {
    throw new BadRequestAppError('brokerKey is required for broker scope');
  }

  const enabled = coerceBoolean(body.enabled, 'enabled');
  const monitorOnly = coerceBoolean(body.monitorOnly, 'monitorOnly');
  const enforceHardBlock = coerceBoolean(body.enforceHardBlock, 'enforceHardBlock');

  if (monitorOnly && enforceHardBlock) {
    throw new BadRequestAppError('monitorOnly and enforceHardBlock cannot both be true');
  }

  const marginUsageWarnPct =
    coerceNumber(body.marginUsageWarnPct, 'marginUsageWarnPct', { min: 0, max: 100 }) ?? 0;
  const marginUsageCriticalPct =
    coerceNumber(body.marginUsageCriticalPct, 'marginUsageCriticalPct', { min: 0, max: 100 }) ?? 0;
  if (marginUsageWarnPct > marginUsageCriticalPct) {
    throw new BadRequestAppError(
      'marginUsageWarnPct must be less than or equal to marginUsageCriticalPct'
    );
  }

  const concentrationWarnPct =
    coerceNumber(body.concentrationWarnPct, 'concentrationWarnPct', { min: 0, max: 100 }) ?? 0;
  const concentrationCriticalPct =
    coerceNumber(body.concentrationCriticalPct, 'concentrationCriticalPct', { min: 0, max: 100 }) ??
    0;
  if (concentrationWarnPct > concentrationCriticalPct) {
    throw new BadRequestAppError(
      'concentrationWarnPct must be less than or equal to concentrationCriticalPct'
    );
  }

  const dailyLossLimitPct =
    coerceNumber(body.dailyLossLimitPct ?? 5, 'dailyLossLimitPct', { min: 0, max: 100 }) ?? 5;
  const weeklyLossLimitPct =
    coerceNumber(body.weeklyLossLimitPct ?? 12, 'weeklyLossLimitPct', { min: 0, max: 100 }) ?? 12;
  const monthlyLossLimitPct =
    coerceNumber(body.monthlyLossLimitPct ?? 20, 'monthlyLossLimitPct', { min: 0, max: 100 }) ?? 20;

  if (dailyLossLimitPct > weeklyLossLimitPct) {
    throw new BadRequestAppError(
      'dailyLossLimitPct must be less than or equal to weeklyLossLimitPct'
    );
  }

  if (weeklyLossLimitPct > monthlyLossLimitPct) {
    throw new BadRequestAppError(
      'weeklyLossLimitPct must be less than or equal to monthlyLossLimitPct'
    );
  }

  const minLeverage = coerceNumber(body.minLeverage, 'minLeverage', {
    min: 0,
    allowNull: true,
  });
  const maxLeverage = coerceNumber(body.maxLeverage, 'maxLeverage', {
    min: 0,
    allowNull: true,
  });
  const tradeSizePctOfBalance = coerceNumber(body.tradeSizePctOfBalance, 'tradeSizePctOfBalance', {
    min: 0,
    max: 1000,
    allowNull: true,
  });
  const minNotionalPerTrade = coerceNumber(body.minNotionalPerTrade, 'minNotionalPerTrade', {
    min: 0,
    allowNull: true,
  });

  if (minLeverage !== undefined && minLeverage <= 0) {
    throw new BadRequestAppError('minLeverage must be greater than 0 when provided');
  }

  if (tradeSizePctOfBalance !== undefined && tradeSizePctOfBalance <= 0) {
    throw new BadRequestAppError('tradeSizePctOfBalance must be greater than 0 when provided');
  }

  if (tradeSizePctOfBalance !== undefined && tradeSizePctOfBalance !== null && scope !== 'broker') {
    throw new BadRequestAppError(
      'tradeSizePctOfBalance is only supported for broker-scoped policies'
    );
  }

  if (minNotionalPerTrade !== undefined && minNotionalPerTrade <= 0) {
    throw new BadRequestAppError('minNotionalPerTrade must be greater than 0 when provided');
  }

  if (minLeverage !== undefined && maxLeverage !== undefined && maxLeverage < minLeverage) {
    throw new BadRequestAppError('maxLeverage must be greater than or equal to minLeverage');
  }

  return {
    scope,
    brokerKey,
    enabled,
    monitorOnly,
    enforceHardBlock,
    marginUsageWarnPct,
    marginUsageCriticalPct,
    concentrationWarnPct,
    concentrationCriticalPct,
    dailyLossLimitPct,
    weeklyLossLimitPct,
    monthlyLossLimitPct,
    minLeverage,
    maxLeverage,
    tradeSizePctOfBalance,
    minNotionalPerTrade,
    maxOrderAllocation: coerceNumber(body.maxOrderAllocation, 'maxOrderAllocation', {
      min: 0,
      max: 100,
      allowNull: true,
    }),
    maxTotalAllocation: coerceNumber(body.maxTotalAllocation, 'maxTotalAllocation', {
      min: 0,
      max: 100,
      allowNull: true,
    }),
    maxAvgLeverage: coerceNumber(body.maxAvgLeverage, 'maxAvgLeverage', {
      min: 0,
      allowNull: true,
    }),
  };
};

export const validateRollbackRiskPolicyBody = (
  body: RollbackRiskPolicyBody = {}
): Required<RollbackRiskPolicyBody> => {
  const versionId = String(body.versionId || '').trim();
  if (!versionId) {
    throw new BadRequestAppError('versionId is required');
  }

  const reason = String(body.reason || '').trim() || 'Operator initiated rollback from Risk Center';

  return {
    versionId,
    reason,
  };
};

export const validateReviewRiskPolicyVersionBody = (
  body: ReviewRiskPolicyVersionBody = {}
): Required<ReviewRiskPolicyVersionBody> => {
  return {
    reason: String(body.reason || '').trim() || 'Reviewed from Risk Center governance workflow',
  };
};
