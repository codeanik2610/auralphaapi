import {
  DiscoveryTemplateImprovementPolicy,
  DiscoveryTemplateImprovementPolicyContract,
} from '../contracts/Scheduler';
import { BadRequestAppError } from '../errors/AppError';

export const DISCOVERY_POLICY_ALLOWED_TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d'] as const;
export const DISCOVERY_POLICY_DEFAULTS = {
  templateImprovementWindowDays: 60,
  templateImprovementMaxAssets: 20,
  templateImprovementMaxTimeframes: 5,
  templateImprovementMinimumTimeframes: 3,
  templateImprovementFillTimeframes: ['5m', '15m', '1h'],
} as const;

export const DISCOVERY_POLICY_BOUNDS = {
  templateImprovementWindowDays: { min: 7, max: 180 },
  templateImprovementMaxAssets: { min: 5, max: 50 },
  templateImprovementMaxTimeframes: { min: 1, max: 6 },
  templateImprovementMinimumTimeframes: { min: 0, max: 6 },
} as const;

type NormalizeOptions = {
  requireComplete?: boolean;
};

const ALLOWED_TIMEFRAMES_SET = new Set<string>(DISCOVERY_POLICY_ALLOWED_TIMEFRAMES);

export function getDiscoveryTemplateImprovementPolicyContract(): DiscoveryTemplateImprovementPolicyContract {
  return {
    allowedTimeframes: [...DISCOVERY_POLICY_ALLOWED_TIMEFRAMES],
    defaults: {
      templateImprovementWindowDays: DISCOVERY_POLICY_DEFAULTS.templateImprovementWindowDays,
      templateImprovementMaxAssets: DISCOVERY_POLICY_DEFAULTS.templateImprovementMaxAssets,
      templateImprovementMaxTimeframes: DISCOVERY_POLICY_DEFAULTS.templateImprovementMaxTimeframes,
      templateImprovementMinimumTimeframes:
        DISCOVERY_POLICY_DEFAULTS.templateImprovementMinimumTimeframes,
      templateImprovementFillTimeframes: [
        ...DISCOVERY_POLICY_DEFAULTS.templateImprovementFillTimeframes,
      ],
    },
    bounds: {
      templateImprovementWindowDays: {
        min: DISCOVERY_POLICY_BOUNDS.templateImprovementWindowDays.min,
        max: DISCOVERY_POLICY_BOUNDS.templateImprovementWindowDays.max,
      },
      templateImprovementMaxAssets: {
        min: DISCOVERY_POLICY_BOUNDS.templateImprovementMaxAssets.min,
        max: DISCOVERY_POLICY_BOUNDS.templateImprovementMaxAssets.max,
      },
      templateImprovementMaxTimeframes: {
        min: DISCOVERY_POLICY_BOUNDS.templateImprovementMaxTimeframes.min,
        max: DISCOVERY_POLICY_BOUNDS.templateImprovementMaxTimeframes.max,
      },
      templateImprovementMinimumTimeframes: {
        min: DISCOVERY_POLICY_BOUNDS.templateImprovementMinimumTimeframes.min,
        max: DISCOVERY_POLICY_BOUNDS.templateImprovementMinimumTimeframes.max,
      },
    },
  };
}

export function normalizeDiscoveryTemplateImprovementPolicy(
  value: unknown,
  options: NormalizeOptions = {}
): DiscoveryTemplateImprovementPolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestAppError('discoveryPolicy must be an object');
  }

  const policy = value as Record<string, unknown>;
  const requireComplete = options.requireComplete !== false;

  const readInteger = (
    field: keyof typeof DISCOVERY_POLICY_DEFAULTS,
    bounds: { min: number; max: number }
  ): number | undefined => {
    const raw = policy[field];
    if (raw === undefined || raw === null || raw === '') {
      if (requireComplete) {
        throw new BadRequestAppError(`${String(field)} is required`);
      }
      return undefined;
    }

    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < bounds.min || parsed > bounds.max) {
      throw new BadRequestAppError(
        `${String(field)} must be an integer between ${bounds.min} and ${bounds.max}`
      );
    }
    return parsed;
  };

  const maxTimeframes =
    readInteger(
      'templateImprovementMaxTimeframes',
      DISCOVERY_POLICY_BOUNDS.templateImprovementMaxTimeframes
    ) ?? DISCOVERY_POLICY_DEFAULTS.templateImprovementMaxTimeframes;
  const minimumTimeframes = Math.min(
    maxTimeframes,
    readInteger(
      'templateImprovementMinimumTimeframes',
      DISCOVERY_POLICY_BOUNDS.templateImprovementMinimumTimeframes
    ) ?? DISCOVERY_POLICY_DEFAULTS.templateImprovementMinimumTimeframes
  );
  if (minimumTimeframes > maxTimeframes) {
    throw new BadRequestAppError(
      'templateImprovementMinimumTimeframes cannot exceed templateImprovementMaxTimeframes'
    );
  }

  const fillTimeframesRaw = policy.templateImprovementFillTimeframes;
  if (
    fillTimeframesRaw === undefined ||
    fillTimeframesRaw === null ||
    fillTimeframesRaw === ''
  ) {
    if (requireComplete && minimumTimeframes > 0) {
      throw new BadRequestAppError(
        'templateImprovementFillTimeframes is required when templateImprovementMinimumTimeframes is enabled'
      );
    }
  } else if (!Array.isArray(fillTimeframesRaw)) {
    throw new BadRequestAppError('templateImprovementFillTimeframes must be an array');
  }

  const normalizedFillTimeframes = Array.from(
    new Set(
      (Array.isArray(fillTimeframesRaw)
        ? fillTimeframesRaw
        : DISCOVERY_POLICY_DEFAULTS.templateImprovementFillTimeframes
      )
        .map((item) => String(item || '').trim().toLowerCase())
        .filter((item) => ALLOWED_TIMEFRAMES_SET.has(item))
    )
  );

  if (minimumTimeframes > 0 && normalizedFillTimeframes.length === 0) {
    throw new BadRequestAppError(
      'templateImprovementFillTimeframes must include at least one supported timeframe'
    );
  }

  return {
    discoveryScopeMode: 'exact_selected_scope',
    batchSizeMode: 'not_used',
    templateImprovementWindowDays:
      readInteger(
        'templateImprovementWindowDays',
        DISCOVERY_POLICY_BOUNDS.templateImprovementWindowDays
      ) ?? DISCOVERY_POLICY_DEFAULTS.templateImprovementWindowDays,
    templateImprovementMaxAssets:
      readInteger(
        'templateImprovementMaxAssets',
        DISCOVERY_POLICY_BOUNDS.templateImprovementMaxAssets
      ) ?? DISCOVERY_POLICY_DEFAULTS.templateImprovementMaxAssets,
    templateImprovementMaxTimeframes: maxTimeframes,
    templateImprovementMinimumTimeframes: minimumTimeframes,
    templateImprovementFillTimeframes: normalizedFillTimeframes.length
      ? normalizedFillTimeframes
      : [...DISCOVERY_POLICY_DEFAULTS.templateImprovementFillTimeframes],
  };
}
