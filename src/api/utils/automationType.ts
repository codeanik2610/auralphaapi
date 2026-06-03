import type { AutomationType, LegacyAutomationType } from '../contracts/Automation';
import { normalizeTradeSuggestionFreshnessPolicy } from './signalFreshness';
import { normalizeTradeSuggestionLimitOrderExpiryPolicy } from './tradeSuggestionOrderExpiry';

const LEGACY_AUTOMATION_TYPE_MAP: Record<LegacyAutomationType, AutomationType> = {
  strategy: 'trade-suggestion',
  'strategy-library': 'backtest-runner',
};

export const CANONICAL_AUTOMATION_TYPES: AutomationType[] = ['trade-suggestion', 'backtest-runner'];

export const ACCEPTED_AUTOMATION_TYPE_INPUTS = [
  ...CANONICAL_AUTOMATION_TYPES,
  ...Object.keys(LEGACY_AUTOMATION_TYPE_MAP),
];

const parseRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

const readNestedRecord = (
  root: Record<string, unknown> | null,
  ...keys: string[]
): Record<string, unknown> | null => {
  let current = root;
  for (const key of keys) {
    current = parseRecord(current?.[key]);
    if (!current) {
      return null;
    }
  }
  return current;
};

const readString = (...values: unknown[]): string | null => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
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

const normalizeNumeric = (
  value: number | null,
  fallback: number,
  {
    min = Number.NEGATIVE_INFINITY,
    max = Number.POSITIVE_INFINITY,
    integer = false,
  }: {
    min?: number;
    max?: number;
    integer?: boolean;
  } = {}
): number => {
  if (value === null || !Number.isFinite(value)) {
    return fallback;
  }

  const normalized = integer ? Math.trunc(value) : value;
  if (normalized < min || normalized > max) {
    return fallback;
  }

  return normalized;
};

const normalizeNullableNumeric = (
  value: number | null,
  {
    min = Number.NEGATIVE_INFINITY,
    max = Number.POSITIVE_INFINITY,
    integer = false,
  }: {
    min?: number;
    max?: number;
    integer?: boolean;
  } = {}
): number | null => {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }

  const normalized = integer ? Math.trunc(value) : value;
  if (normalized < min || normalized > max) {
    return null;
  }

  return normalized;
};

const normalizeClampedNumeric = (
  value: number | null,
  fallback: number,
  {
    min = Number.NEGATIVE_INFINITY,
    max = Number.POSITIVE_INFINITY,
    integer = false,
  }: {
    min?: number;
    max?: number;
    integer?: boolean;
  } = {}
): number => {
  if (value === null || !Number.isFinite(value)) {
    return fallback;
  }

  const normalized = integer ? Math.trunc(value) : value;
  return Math.min(max, Math.max(min, normalized));
};

const normalizeEnum = <T extends readonly string[]>(
  value: string | null,
  allowed: T,
  fallback: T[number]
): T[number] => {
  const normalized = value?.trim().toLowerCase() ?? null;
  return normalized && allowed.includes(normalized as T[number])
    ? (normalized as T[number])
    : fallback;
};

export const TRADE_SUGGESTION_EXECUTION_MODES = [
  'suggestion_only',
  'paper_trade_auto',
  'live_trade_auto',
] as const;
export const TRADE_SUGGESTION_APPROVAL_MODES = ['manual_review', 'auto_if_safe'] as const;
export const TRADE_SUGGESTION_ROUTE_MODES = ['strategy_default', 'user_default', 'fixed'] as const;
export const TRADE_SUGGESTION_ORDER_TYPES = ['market', 'limit'] as const;
export const TRADE_SUGGESTION_QUANTITY_MODES = ['quantity', 'notional', 'risk_percent'] as const;
export const TRADE_SUGGESTION_DELTA_PROTECTION_MODES = ['reduce_only', 'native_bracket'] as const;
export const TRADE_SUGGESTION_TIME_IN_FORCE = ['GTC', 'IOC', 'FOK'] as const;
export const TRADE_SUGGESTION_PRE_ENTRY_MIN_DISTANCE_BASIS = [
  'expected_fill',
  'order_entry',
  'market_price',
] as const;
export const TRADE_SUGGESTION_OPPOSITE_SIGNAL_MODES = [
  'skip',
  'allow',
  'close_then_open',
  'reverse',
  'hedge',
] as const;

export const TRADE_SUGGESTION_EXECUTION_LIMIT_RULES = {
  maxOrdersPerRun: {
    fallback: 1,
    min: 1,
    max: 1000,
    integer: true,
  },
  maxOrdersPerDay: {
    fallback: 3,
    min: 1,
    max: 3000,
    integer: true,
  },
  maxConcurrentOpenTrades: {
    fallback: 1,
    min: 1,
    max: 1000,
    integer: true,
  },
  dedupeWindowSeconds: {
    fallback: 3600,
    min: 0,
    max: 604800,
    integer: true,
  },
} as const;

export const normalizeTradeSuggestionExecutionLimits = (
  value: unknown
): Record<string, unknown> => {
  const limits = parseRecord(value) ?? {};

  return {
    maxOrdersPerRun: normalizeClampedNumeric(
      readNumber(limits.maxOrdersPerRun),
      TRADE_SUGGESTION_EXECUTION_LIMIT_RULES.maxOrdersPerRun.fallback,
      TRADE_SUGGESTION_EXECUTION_LIMIT_RULES.maxOrdersPerRun
    ),
    maxOrdersPerDay: normalizeClampedNumeric(
      readNumber(limits.maxOrdersPerDay),
      TRADE_SUGGESTION_EXECUTION_LIMIT_RULES.maxOrdersPerDay.fallback,
      TRADE_SUGGESTION_EXECUTION_LIMIT_RULES.maxOrdersPerDay
    ),
    maxConcurrentOpenTrades: normalizeClampedNumeric(
      readNumber(limits.maxConcurrentOpenTrades),
      TRADE_SUGGESTION_EXECUTION_LIMIT_RULES.maxConcurrentOpenTrades.fallback,
      TRADE_SUGGESTION_EXECUTION_LIMIT_RULES.maxConcurrentOpenTrades
    ),
    maxNotionalPerTrade: normalizeNullableNumeric(readNumber(limits.maxNotionalPerTrade), {
      min: 0,
    }),
    maxNotionalPerDay: normalizeNullableNumeric(readNumber(limits.maxNotionalPerDay), {
      min: 0,
    }),
    dedupeWindowSeconds: normalizeClampedNumeric(
      readNumber(limits.dedupeWindowSeconds),
      TRADE_SUGGESTION_EXECUTION_LIMIT_RULES.dedupeWindowSeconds.fallback,
      TRADE_SUGGESTION_EXECUTION_LIMIT_RULES.dedupeWindowSeconds
    ),
  };
};

export const normalizeTradeSuggestionPreEntryGuards = (value: unknown): Record<string, unknown> => {
  const guards = parseRecord(value) ?? {};
  const minDistanceFromStopR =
    parseRecord(guards.minDistanceFromStopR) ??
    parseRecord(guards.minDistanceFromStop) ??
    parseRecord(guards.stopDistanceR) ??
    {};

  return {
    minDistanceFromStopR: {
      enabled: readBoolean(minDistanceFromStopR.enabled) ?? false,
      minR: normalizeClampedNumeric(
        readNumber(
          minDistanceFromStopR.minR,
          minDistanceFromStopR.minimumR,
          minDistanceFromStopR.requiredR
        ),
        0.5,
        {
          min: 0,
          max: 10,
        }
      ),
      basis: normalizeEnum(
        readString(minDistanceFromStopR.basis),
        TRADE_SUGGESTION_PRE_ENTRY_MIN_DISTANCE_BASIS,
        'expected_fill'
      ),
      blockOnMissingMarketPrice:
        readBoolean(
          minDistanceFromStopR.blockOnMissingMarketPrice,
          minDistanceFromStopR.blockOnMissingPrice
        ) ?? false,
    },
  };
};

export const normalizeTradeSuggestionOppositeSignalPolicy = (
  value: unknown
): Record<string, unknown> => {
  const policy = parseRecord(value) ?? {};
  const mode = normalizeEnum(
    readString(policy.mode, policy.action),
    TRADE_SUGGESTION_OPPOSITE_SIGNAL_MODES,
    'skip'
  );
  const enabled = readBoolean(policy.enabled) ?? mode !== 'skip';

  return {
    enabled,
    mode: enabled ? mode : 'skip',
    allowSameAssetOppositeSide:
      readBoolean(policy.allowSameAssetOppositeSide, policy.allowOppositeSide) ??
      (enabled && mode !== 'skip'),
    blockSameSideDuplicate: readBoolean(policy.blockSameSideDuplicate) ?? true,
    requireFreshSignal: readBoolean(policy.requireFreshSignal) ?? true,
  };
};

export const normalizeTradeSuggestionExecutionPolicy = (
  value: unknown
): Record<string, unknown> => {
  const root = parseRecord(value) ?? {};
  const preTrade = parseRecord(root.preTrade) ?? {};
  const routing = parseRecord(root.routing) ?? {};
  const orderTemplate = parseRecord(root.orderTemplate) ?? {};
  const liveConsent = parseRecord(root.liveConsent) ?? {};
  const freshness = parseRecord(root.freshness) ?? parseRecord(root.signalFreshness) ?? {};
  const limitOrderExpiry =
    parseRecord(root.limitOrderExpiry) ??
    parseRecord(root.orderExpiry) ??
    parseRecord(root.limitOrderTtl) ??
    {};
  const preEntryGuards =
    parseRecord(root.preEntryGuards) ??
    readNestedRecord(root, 'guards', 'preEntry') ??
    parseRecord(root.entryGuards) ??
    {};
  const oppositeSignalPolicy =
    parseRecord(root.oppositeSignalPolicy) ??
    parseRecord(root.oppositeSignals) ??
    parseRecord(root.sameAssetOppositeSignal) ??
    {};

  const executionMode = normalizeEnum(
    readString(root.executionMode, root.mode),
    TRADE_SUGGESTION_EXECUTION_MODES,
    'suggestion_only'
  );
  const approvalMode =
    executionMode === 'suggestion_only'
      ? 'manual_review'
      : normalizeEnum(
          readString(root.approvalMode),
          TRADE_SUGGESTION_APPROVAL_MODES,
          'manual_review'
        );
  const routeMode = normalizeEnum(
    readString(routing.routeMode, root.routeMode),
    TRADE_SUGGESTION_ROUTE_MODES,
    'strategy_default'
  );
  const orderType = normalizeEnum(
    readString(orderTemplate.orderType),
    TRADE_SUGGESTION_ORDER_TYPES,
    'market'
  );
  const deltaProtectionMode = normalizeEnum(
    readString(root.deltaProtectionMode, orderTemplate.deltaProtectionMode),
    TRADE_SUGGESTION_DELTA_PROTECTION_MODES,
    'native_bracket'
  );
  const timeInForceInput = readString(orderTemplate.timeInForce);
  const quantityMode = normalizeEnum(
    readString(orderTemplate.quantityMode),
    TRADE_SUGGESTION_QUANTITY_MODES,
    'risk_percent'
  );
  const leverage = normalizeNullableNumeric(readNumber(orderTemplate.leverage), { min: 0 });
  const liveConsentEnabled =
    executionMode === 'live_trade_auto' ? (readBoolean(liveConsent.enabled) ?? false) : false;

  return {
    executionMode,
    approvalMode,
    preTrade: {
      required: true,
      maxSnapshotAgeSeconds: normalizeNumeric(readNumber(preTrade.maxSnapshotAgeSeconds), 900, {
        min: 60,
        max: 86400,
        integer: true,
      }),
      blockOnCritical: readBoolean(preTrade.blockOnCritical) ?? true,
      blockOnWarning: readBoolean(preTrade.blockOnWarning) ?? false,
      blockOnCoverageGap: readBoolean(preTrade.blockOnCoverageGap) ?? true,
      blockOnStaleRiskSnapshot: readBoolean(preTrade.blockOnStaleRiskSnapshot) ?? true,
      blockOnUnavailableBrokerSnapshot:
        readBoolean(preTrade.blockOnUnavailableBrokerSnapshot) ?? true,
      blockOnInsufficientFunds: readBoolean(preTrade.blockOnInsufficientFunds) ?? true,
      blockOnDuplicateSignal: readBoolean(preTrade.blockOnDuplicateSignal) ?? true,
    },
    freshness: normalizeTradeSuggestionFreshnessPolicy(freshness),
    limitOrderExpiry: normalizeTradeSuggestionLimitOrderExpiryPolicy(limitOrderExpiry),
    routing: {
      routeMode,
      brokerKey: readString(routing.brokerKey, root.brokerKey),
      accountId: readString(routing.accountId, root.accountId),
    },
    orderTemplate: {
      orderType,
      timeInForce:
        timeInForceInput &&
        TRADE_SUGGESTION_TIME_IN_FORCE.includes(timeInForceInput.toUpperCase() as 'GTC')
          ? timeInForceInput.toUpperCase()
          : null,
      quantityMode,
      quantity: normalizeNullableNumeric(readNumber(orderTemplate.quantity), { min: 0 }),
      notional: normalizeNullableNumeric(readNumber(orderTemplate.notional), { min: 0 }),
      riskPercent: normalizeNullableNumeric(readNumber(orderTemplate.riskPercent), {
        min: 0,
        max: 100,
      }),
      leverage,
      reduceOnly: readBoolean(orderTemplate.reduceOnly) ?? false,
      deltaProtectionMode,
      slippageBps: normalizeNullableNumeric(readNumber(orderTemplate.slippageBps), {
        min: 0,
        integer: true,
      }),
    },
    limits: normalizeTradeSuggestionExecutionLimits(root.limits),
    preEntryGuards: normalizeTradeSuggestionPreEntryGuards(preEntryGuards),
    oppositeSignalPolicy: normalizeTradeSuggestionOppositeSignalPolicy(oppositeSignalPolicy),
    liveConsent: {
      enabled: liveConsentEnabled,
      confirmedByUserId: readString(liveConsent.confirmedByUserId),
      confirmedAt: readString(liveConsent.confirmedAt),
    },
  };
};

const readBacktestId = (...records: Array<Record<string, unknown> | null>): string | null =>
  readString(...records.map((record) => record?.backtestId));

const readLibraryId = (...records: Array<Record<string, unknown> | null>): string | null =>
  readString(
    ...records.flatMap((record) => [record?.libraryId, record?.strategyLibraryId, record?.library])
  );

const normalizeExplicitAutomationType = (value: string | null): AutomationType | null => {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'trade-suggestion' || normalized === 'backtest-runner') {
    return normalized as AutomationType;
  }

  if (normalized === 'strategy' || normalized === 'strategy-library') {
    return LEGACY_AUTOMATION_TYPE_MAP[normalized as LegacyAutomationType];
  }

  return null;
};

export const inferAutomationTypeFromConfig = (value: unknown): AutomationType | null => {
  const root = parseRecord(value);
  if (!root) {
    return null;
  }

  const tradeSuggestion = parseRecord(root.tradeSuggestion);
  const backtestRunner = parseRecord(root.backtestRunner);
  const nestedConfig = parseRecord(root.config);
  const inputSnapshot = parseRecord(root.inputSnapshot);
  const runnerBody = parseRecord(backtestRunner?.runBody);
  const tradeExecution = parseRecord(tradeSuggestion?.execution);

  const explicitType = normalizeExplicitAutomationType(
    readString(root.kind, tradeSuggestion?.kind, backtestRunner?.kind, root.sourceType)
  );
  if (explicitType) {
    return explicitType;
  }

  const runnerSources = [root, backtestRunner, nestedConfig, inputSnapshot, runnerBody];
  const libraryId = readLibraryId(...runnerSources);
  const runnerSource = readString(
    ...runnerSources.flatMap((record) => [record?.source, record?.sourceType])
  );
  if (
    backtestRunner ||
    libraryId ||
    runnerSource === 'strategy-library' ||
    runnerSource === 'backtest-runner'
  ) {
    return 'backtest-runner';
  }

  const suggestionSources = [root, tradeSuggestion, nestedConfig, inputSnapshot, tradeExecution];
  const tradeSource = readString(
    ...suggestionSources.flatMap((record) => [record?.source, record?.sourceType])
  );
  const backtestId = readBacktestId(...suggestionSources);
  const tradeSignal =
    readString(
      root.symbol,
      tradeSuggestion?.symbol,
      root.timeframe,
      tradeSuggestion?.timeframe,
      root.templateId,
      inputSnapshot?.templateId,
      root.sourceTemplateId,
      inputSnapshot?.sourceTemplateId
    ) ||
    tradeSource === 'backtest' ||
    tradeSource === 'top-setup' ||
    tradeSource === 'strategy-template' ||
    tradeSource === 'trade-suggestion';
  if (tradeSuggestion !== null || backtestId || tradeSignal) {
    return 'trade-suggestion';
  }

  return null;
};

export const normalizeAutomationType = (value: unknown, config?: unknown): AutomationType => {
  const explicit = normalizeExplicitAutomationType(
    typeof value === 'string' ? value : readString(value)
  );
  if (explicit) {
    return explicit;
  }

  return inferAutomationTypeFromConfig(config) ?? 'trade-suggestion';
};

export const normalizeAutomationConfig = (
  typeInput: unknown,
  value: unknown
): Record<string, unknown> | null => {
  const root = parseRecord(value) ?? {};
  const type = normalizeAutomationType(typeInput, root);

  if (type === 'backtest-runner') {
    const runner = parseRecord(root.backtestRunner) ?? {};
    const runBody = parseRecord(runner.runBody) ?? parseRecord(root.config) ?? null;
    const libraryId =
      readString(
        runner.libraryId,
        runner.strategyLibraryId,
        root.libraryId,
        root.strategyLibraryId,
        root.library
      ) ?? null;
    const backtestId = readString(runner.backtestId, root.backtestId) ?? null;
    const source =
      readString(
        runner.source,
        root.source,
        root.sourceType,
        libraryId ? 'strategy-library' : null
      ) ?? (libraryId ? 'strategy-library' : 'manual');

    // Extract template IDs (backtest-runner typically doesn't use templates, but handle for consistency)
    const sourceTemplateId =
      readString(root.sourceTemplateId, runBody?.sourceTemplateId, runner.sourceTemplateId) ?? null;

    const templateId = readString(root.templateId, runBody?.templateId, runner.templateId) ?? null;

    return {
      ...root,
      kind: type,
      source,
      ...(libraryId ? { libraryId } : {}),
      ...(backtestId ? { backtestId } : {}),
      ...(runBody ? { config: runBody } : {}),
      ...(sourceTemplateId ? { sourceTemplateId } : {}),
      ...(templateId ? { templateId } : {}),
      backtestRunner: {
        kind: type,
        source,
        libraryId,
        backtestId,
        runBody,
      },
    };
  }

  const suggestion = parseRecord(root.tradeSuggestion) ?? {};
  const rawConfig = parseRecord(root.config) ?? parseRecord(suggestion.config) ?? null;
  const rawExecution = parseRecord(suggestion.execution) ?? rawConfig ?? null;
  const nestedConfig = readNestedRecord(rawExecution, 'config');
  const configInputSnapshot = parseRecord(rawConfig?.inputSnapshot);
  const executionInputSnapshot =
    parseRecord(rawExecution?.inputSnapshot) ??
    readNestedRecord(rawExecution, 'config', 'inputSnapshot') ??
    configInputSnapshot;
  const execution = normalizeTradeSuggestionExecutionPolicy(rawExecution);
  const setupScope = parseRecord(suggestion.setupScope) ?? parseRecord(root.setupScope) ?? null;
  const source = readString(suggestion.source, root.source, root.sourceType) ?? 'manual';
  const backtestId = readString(suggestion.backtestId, root.backtestId) ?? null;
  const strategy = readString(suggestion.strategy, root.strategy) ?? null;
  const symbol = readString(suggestion.symbol, root.symbol, setupScope?.symbol) ?? null;
  const timeframe = readString(suggestion.timeframe, root.timeframe, setupScope?.timeframe) ?? null;
  const market =
    readString(suggestion.market, root.market, rawExecution?.market, rawConfig?.market) ?? null;

  // Extract template IDs with clear precedence:
  // Priority: explicit top-level > nested config > tradeSuggestion > execution
  const executionTemplate =
    parseRecord(rawExecution?.template) ??
    parseRecord(nestedConfig?.template) ??
    parseRecord(executionInputSnapshot?.template);
  const sourceTemplateId =
    readString(
      root.sourceTemplateId, // 1. Explicit top-level (highest priority)
      rawExecution?.sourceTemplateId, // 2. Nested in execution/config
      rawConfig?.sourceTemplateId,
      nestedConfig?.sourceTemplateId, // 3. Double-nested legacy execution config
      suggestion.sourceTemplateId, // 3. Nested in tradeSuggestion
      executionInputSnapshot?.sourceTemplateId,
      executionInputSnapshot?.templateId,
      executionTemplate?.id // 4. Nested template object
    ) ?? null;

  const templateId =
    readString(
      root.templateId, // 1. Explicit top-level (highest priority)
      rawExecution?.templateId, // 2. Nested in execution/config
      rawConfig?.templateId,
      nestedConfig?.templateId, // 3. Double-nested legacy execution config
      suggestion.templateId, // 3. Nested in tradeSuggestion
      executionInputSnapshot?.templateId,
      executionTemplate?.id, // 4. Nested template object
      executionTemplate?.templateId // 5. Template object's templateId field
    ) ?? null;

  return {
    ...root,
    kind: type,
    source,
    ...(backtestId ? { backtestId } : {}),
    ...(strategy ? { strategy } : {}),
    ...(symbol ? { symbol } : {}),
    ...(timeframe ? { timeframe } : {}),
    ...(market ? { market } : {}),
    ...(setupScope ? { setupScope } : {}),
    config: rawConfig ?? execution,
    ...(sourceTemplateId ? { sourceTemplateId } : {}),
    ...(templateId ? { templateId } : {}),
    tradeSuggestion: {
      kind: type,
      source,
      backtestId,
      strategy,
      symbol,
      timeframe,
      market,
      setupScope,
      ...(sourceTemplateId ? { sourceTemplateId } : {}),
      ...(templateId ? { templateId } : {}),
      execution,
    },
  };
};
