import { BadRequestAppError } from '../errors/AppError';
import {
  ReviewRiskPolicyVersionBody,
  RiskKillSwitchBody,
  RollbackRiskPolicyBody,
  UpsertRiskPolicyBody
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

export const validateRiskKillSwitchBody = (
  body: RiskKillSwitchBody = {}
): Required<RiskKillSwitchBody> => {
  const scope = body.scope?.trim() || 'workspace';
  const reason = body.reason?.trim() || 'Operator initiated emergency stop';
  return {
    scope,
    reason,
  };
};

export const validateRiskAlertsQuery = (
  query: RiskAlertsQuery = {}
): ValidatedRiskAlertsQuery => {
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

  const rawScope = String(body.scope ?? 'user').trim().toLowerCase();
  if (rawScope !== 'user' && rawScope !== 'broker') {
    throw new BadRequestAppError('scope must be one of: user, broker');
  }

  const scope = rawScope as UpsertRiskPolicyBody['scope'];
  const brokerKey =
    scope === 'broker' && body.brokerKey
      ? String(body.brokerKey).trim().toLowerCase()
      : undefined;
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
    coerceNumber(body.monthlyLossLimitPct ?? 20, 'monthlyLossLimitPct', { min: 0, max: 100 }) ??
    20;

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
    maxLeverage: coerceNumber(body.maxLeverage, 'maxLeverage', { min: 0, allowNull: true }),
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

  const reason =
    String(body.reason || '').trim() || 'Operator initiated rollback from Risk Center';

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
