export interface TradeSuggestionFreshnessPolicy {
  enabled: boolean;
  graceSeconds: number | null;
  timeframeGraceSeconds: Record<string, number>;
}

export interface SignalFreshnessEvaluation {
  allowed: boolean;
  enabled: boolean;
  reason: string;
  timeframe: string;
  timeframeSeconds: number | null;
  signalTime: string | null;
  candleCloseAt: string | null;
  evaluatedAt: string;
  ageAfterCloseSeconds: number | null;
  maxAgeAfterCloseSeconds: number | null;
}

export const DEFAULT_TRADE_SUGGESTION_FRESHNESS_GRACE_SECONDS: Record<string, number> = {
  '1m': 60,
  '3m': 120,
  '5m': 300,
  '15m': 600,
  '30m': 900,
  '1h': 900,
  '2h': 1200,
  '4h': 1800,
  '6h': 2700,
  '12h': 3600,
  '1d': 7200,
  '1w': 21600,
};

const MAX_CONFIGURABLE_FRESHNESS_SECONDS = 7 * 24 * 60 * 60;

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

const normalizeFreshnessSeconds = (value: number | null): number | null => {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }
  const normalized = Math.trunc(value);
  if (normalized < 0 || normalized > MAX_CONFIGURABLE_FRESHNESS_SECONDS) {
    return null;
  }
  return normalized;
};

const normalizeTimeframe = (value: string): string => value.trim().toLowerCase();

export const parseTimeframeSeconds = (value: string): number | null => {
  const normalized = normalizeTimeframe(value);
  const match = normalized.match(/^(\d+)([mhdw])$/);
  if (!match) {
    return null;
  }

  const amount = Number(match[1]);
  if (!Number.isInteger(amount) || amount <= 0) {
    return null;
  }

  const unit = match[2];
  const multiplier =
    unit === 'm'
      ? 60
      : unit === 'h'
        ? 60 * 60
        : unit === 'd'
          ? 24 * 60 * 60
          : 7 * 24 * 60 * 60;

  return amount * multiplier;
};

const deriveDefaultGraceSeconds = (timeframeSeconds: number): number =>
  Math.min(
    MAX_CONFIGURABLE_FRESHNESS_SECONDS,
    Math.max(120, Math.round(timeframeSeconds * 0.15))
  );

export const resolveDefaultFreshnessGraceSeconds = (timeframe: string): number | null => {
  const normalizedTimeframe = normalizeTimeframe(timeframe);
  const timeframeSeconds = parseTimeframeSeconds(normalizedTimeframe);
  if (!timeframeSeconds) {
    return null;
  }

  return (
    DEFAULT_TRADE_SUGGESTION_FRESHNESS_GRACE_SECONDS[normalizedTimeframe] ??
    deriveDefaultGraceSeconds(timeframeSeconds)
  );
};

export const normalizeTradeSuggestionFreshnessPolicy = (
  value: unknown
): TradeSuggestionFreshnessPolicy => {
  const root = parseRecord(value) ?? {};
  const timeframeGraceInput =
    parseRecord(root.timeframeGraceSeconds) ??
    parseRecord(root.timeframeMaxAgeSeconds) ??
    parseRecord(root.timeframeOverrides) ??
    {};
  const timeframeGraceSeconds: Record<string, number> = {
    ...DEFAULT_TRADE_SUGGESTION_FRESHNESS_GRACE_SECONDS,
  };

  for (const [rawTimeframe, rawValue] of Object.entries(timeframeGraceInput)) {
    const timeframe = normalizeTimeframe(rawTimeframe);
    if (!parseTimeframeSeconds(timeframe)) {
      continue;
    }
    const normalizedSeconds = normalizeFreshnessSeconds(readNumber(rawValue));
    if (normalizedSeconds !== null) {
      timeframeGraceSeconds[timeframe] = normalizedSeconds;
    }
  }

  return {
    enabled: readBoolean(root.enabled) ?? true,
    graceSeconds: normalizeFreshnessSeconds(
      readNumber(
        root.graceSeconds,
        root.maxSignalAgeSeconds,
        root.maxSignalAgeAfterCloseSeconds,
        root.maxAgeSeconds
      )
    ),
    timeframeGraceSeconds,
  };
};

export const resolveFreshnessGraceSeconds = (
  timeframe: string,
  policy: TradeSuggestionFreshnessPolicy
): number | null => {
  const timeframeSeconds = parseTimeframeSeconds(timeframe);
  if (!timeframeSeconds) {
    return policy.graceSeconds;
  }

  if (policy.graceSeconds !== null) {
    return policy.graceSeconds;
  }

  const normalizedTimeframe = normalizeTimeframe(timeframe);
  return (
    policy.timeframeGraceSeconds[normalizedTimeframe] ??
    deriveDefaultGraceSeconds(timeframeSeconds)
  );
};

export const evaluateSignalFreshness = ({
  signalTime,
  timeframe,
  policy,
  evaluatedAt = new Date(),
  minimumMaxAgeAfterCloseSeconds = null,
}: {
  signalTime: Date | string | null | undefined;
  timeframe: string;
  policy: TradeSuggestionFreshnessPolicy;
  evaluatedAt?: Date;
  minimumMaxAgeAfterCloseSeconds?: number | null;
}): SignalFreshnessEvaluation => {
  const evaluatedAtDate = Number.isFinite(evaluatedAt.getTime()) ? evaluatedAt : new Date();
  const evaluatedAtIso = evaluatedAtDate.toISOString();

  if (!policy.enabled) {
    return {
      allowed: true,
      enabled: false,
      reason: 'Signal freshness guard is disabled for this automation.',
      timeframe,
      timeframeSeconds: parseTimeframeSeconds(timeframe),
      signalTime: null,
      candleCloseAt: null,
      evaluatedAt: evaluatedAtIso,
      ageAfterCloseSeconds: null,
      maxAgeAfterCloseSeconds: null,
    };
  }

  const signalDate =
    signalTime instanceof Date
      ? signalTime
      : typeof signalTime === 'string'
        ? new Date(signalTime)
        : null;
  if (!signalDate || !Number.isFinite(signalDate.getTime())) {
    return {
      allowed: false,
      enabled: true,
      reason: 'Signal freshness guard could not read the suggestion signal time.',
      timeframe,
      timeframeSeconds: parseTimeframeSeconds(timeframe),
      signalTime: null,
      candleCloseAt: null,
      evaluatedAt: evaluatedAtIso,
      ageAfterCloseSeconds: null,
      maxAgeAfterCloseSeconds: null,
    };
  }

  const timeframeSeconds = parseTimeframeSeconds(timeframe);
  if (!timeframeSeconds) {
    return {
      allowed: false,
      enabled: true,
      reason: `Signal freshness guard does not support timeframe ${timeframe}.`,
      timeframe,
      timeframeSeconds: null,
      signalTime: signalDate.toISOString(),
      candleCloseAt: null,
      evaluatedAt: evaluatedAtIso,
      ageAfterCloseSeconds: null,
      maxAgeAfterCloseSeconds: null,
    };
  }

  const configuredMaxAgeAfterCloseSeconds = resolveFreshnessGraceSeconds(timeframe, policy);
  const normalizedMinimumMaxAgeAfterCloseSeconds = normalizeFreshnessSeconds(
    minimumMaxAgeAfterCloseSeconds
  );
  const maxAgeAfterCloseSeconds =
    configuredMaxAgeAfterCloseSeconds === null
      ? normalizedMinimumMaxAgeAfterCloseSeconds
      : Math.max(
          configuredMaxAgeAfterCloseSeconds,
          normalizedMinimumMaxAgeAfterCloseSeconds ?? configuredMaxAgeAfterCloseSeconds
        );
  if (maxAgeAfterCloseSeconds === null) {
    return {
      allowed: true,
      enabled: true,
      reason: 'Signal freshness guard has no max age configured for this timeframe.',
      timeframe,
      timeframeSeconds,
      signalTime: signalDate.toISOString(),
      candleCloseAt: new Date(signalDate.getTime() + timeframeSeconds * 1000).toISOString(),
      evaluatedAt: evaluatedAtIso,
      ageAfterCloseSeconds: null,
      maxAgeAfterCloseSeconds: null,
    };
  }

  const candleCloseAt = new Date(signalDate.getTime() + timeframeSeconds * 1000);
  const ageAfterCloseSeconds = Math.max(
    0,
    Math.floor((evaluatedAtDate.getTime() - candleCloseAt.getTime()) / 1000)
  );
  const allowed = ageAfterCloseSeconds <= maxAgeAfterCloseSeconds;
  const reason = allowed
    ? `Signal is fresh for ${timeframe}: ${ageAfterCloseSeconds}s after candle close within ${maxAgeAfterCloseSeconds}s.`
    : `Signal is stale for ${timeframe}: ${ageAfterCloseSeconds}s after candle close exceeds ${maxAgeAfterCloseSeconds}s.`;

  return {
    allowed,
    enabled: true,
    reason,
    timeframe,
    timeframeSeconds,
    signalTime: signalDate.toISOString(),
    candleCloseAt: candleCloseAt.toISOString(),
    evaluatedAt: evaluatedAtIso,
    ageAfterCloseSeconds,
    maxAgeAfterCloseSeconds,
  };
};
