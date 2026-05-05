import { parseTimeframeSeconds } from './signalFreshness';

export interface TradeSuggestionLimitOrderExpiryPolicy {
  enabled: boolean;
  expirySeconds: number | null;
  timeframeExpirySeconds: Record<string, number>;
}

export const DEFAULT_TRADE_SUGGESTION_LIMIT_ORDER_EXPIRY_SECONDS: Record<string, number> = {
  '1m': 30,
  '3m': 45,
  '5m': 900,
  '15m': 2700,
  '30m': 300,
  '1h': 10800,
  '2h': 900,
  '4h': 1200,
  '6h': 1800,
  '12h': 2700,
  '1d': 3600,
  '1w': 7200,
};

const MAX_CONFIGURABLE_LIMIT_ORDER_EXPIRY_SECONDS = 24 * 60 * 60;

const parseRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

const readBoolean = (...values: unknown[]): boolean | null => {
  for (const value of values) {
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === 'true') {
        return true;
      }
      if (normalized === 'false') {
        return false;
      }
    }
  }
  return null;
};

const readNumber = (...values: unknown[]): number | null => {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return null;
};

const normalizeTimeframe = (value: string): string => value.trim().toLowerCase();

const normalizeExpirySeconds = (value: number | null): number | null => {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }
  const normalized = Math.trunc(value);
  if (normalized < 0 || normalized > MAX_CONFIGURABLE_LIMIT_ORDER_EXPIRY_SECONDS) {
    return null;
  }
  return normalized;
};

const deriveDefaultExpirySeconds = (timeframeSeconds: number): number =>
  Math.min(
    MAX_CONFIGURABLE_LIMIT_ORDER_EXPIRY_SECONDS,
    Math.max(30, Math.round(timeframeSeconds * 0.2))
  );

export const normalizeTradeSuggestionLimitOrderExpiryPolicy = (
  value: unknown
): TradeSuggestionLimitOrderExpiryPolicy => {
  const root = parseRecord(value) ?? {};
  const timeframeExpiryInput =
    parseRecord(root.timeframeExpirySeconds) ??
    parseRecord(root.timeframeTtlSeconds) ??
    parseRecord(root.timeframeOverrides) ??
    {};
  const timeframeExpirySeconds: Record<string, number> = {
    ...DEFAULT_TRADE_SUGGESTION_LIMIT_ORDER_EXPIRY_SECONDS,
  };

  for (const [rawTimeframe, rawValue] of Object.entries(timeframeExpiryInput)) {
    const timeframe = normalizeTimeframe(rawTimeframe);
    if (!parseTimeframeSeconds(timeframe)) {
      continue;
    }
    const normalizedSeconds = normalizeExpirySeconds(readNumber(rawValue));
    if (normalizedSeconds !== null) {
      timeframeExpirySeconds[timeframe] = normalizedSeconds;
    }
  }

  return {
    enabled: readBoolean(root.enabled) ?? true,
    expirySeconds: normalizeExpirySeconds(
      readNumber(root.expirySeconds, root.ttlSeconds, root.maxOpenSeconds)
    ),
    timeframeExpirySeconds,
  };
};

export const resolveLimitOrderExpirySeconds = (
  timeframe: string,
  policy: TradeSuggestionLimitOrderExpiryPolicy | null | undefined
): number | null => {
  if (!policy || !policy.enabled) {
    return null;
  }

  if (policy.expirySeconds !== null) {
    return policy.expirySeconds;
  }

  const timeframeSeconds = parseTimeframeSeconds(timeframe);
  if (!timeframeSeconds) {
    return null;
  }

  const normalizedTimeframe = normalizeTimeframe(timeframe);
  return (
    policy.timeframeExpirySeconds[normalizedTimeframe] ??
    deriveDefaultExpirySeconds(timeframeSeconds)
  );
};
