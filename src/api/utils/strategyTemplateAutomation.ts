export type StrategyTradeSide = 'long' | 'short';

export interface StrategyTemplateTradePlanLeg {
  side: StrategyTradeSide;
  enabled: boolean;
  entryRule: string | null;
  exitRule: string | null;
  stopLossPct: number;
  takeProfitTargetsPct: number[];
  rationale: string;
  source: 'rule-based' | 'custom-python';
}

export interface StrategyTemplateAutomationProfile {
  contractVersion: 'trade-suggestion.v1';
  automationReady: boolean;
  readinessReasons: string[];
  market: string;
  signalThreshold: number | null;
  supports: {
    long: boolean;
    short: boolean;
    customPython: boolean;
    ruleBased: boolean;
  };
  tradePlan: {
    long: StrategyTemplateTradePlanLeg | null;
    short: StrategyTemplateTradePlanLeg | null;
  };
}

const DEFAULT_MARKET = 'crypto-futures';
const DEFAULT_STOP_LOSS_PCT = 2;
const DEFAULT_TAKE_PROFIT_PCT = 4;

const readText = (...values: unknown[]): string => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
};

const parseNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
};

const normalizePercent = (value: unknown): number | null => {
  const parsed = parseNumber(value);
  if (parsed === null) {
    return null;
  }
  const normalized = parsed <= 1 ? parsed * 100 : parsed;
  return normalized > 0 ? normalized : null;
};

const normalizePercentList = (value: unknown): number[] => {
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizePercent(item))
      .filter((item): item is number => item !== null);
  }

  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>)
      .map((item) => normalizePercent(item))
      .filter((item): item is number => item !== null);
  }

  if (typeof value === 'string' && value.includes(',')) {
    return value
      .split(',')
      .map((item) => normalizePercent(item))
      .filter((item): item is number => item !== null);
  }

  const single = normalizePercent(value);
  return single === null ? [] : [single];
};

const parseRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

const normalizeCodeTarget = (value: unknown): string => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return '';
  if (normalized === 'py' || normalized === 'python') return 'python';
  if (normalized === 'js' || normalized === 'javascript') return 'javascript';
  if (normalized === 'dsl') return 'dsl';
  return normalized;
};

const hasPythonMethod = (code: string, names: string[]): boolean =>
  names.some((name) => new RegExp(`def\\s+${name}\\s*\\(`, 'i').test(code));

const buildLegRationale = ({
  side,
  entryRule,
  exitRule,
  stopLossPct,
  targets,
  source,
}: {
  side: StrategyTradeSide;
  entryRule: string | null;
  exitRule: string | null;
  stopLossPct: number;
  targets: number[];
  source: 'rule-based' | 'custom-python';
}): string => {
  const sideLabel = side === 'long' ? 'Long' : 'Short';
  const entrySummary =
    entryRule ||
    (source === 'custom-python'
      ? `${sideLabel.toLowerCase()} entry is defined in the custom Python template`
      : `${sideLabel.toLowerCase()} entry follows the template rules`);
  const exitSummary =
    exitRule ||
    (source === 'custom-python'
      ? `${sideLabel.toLowerCase()} exit is defined in the custom Python template`
      : `${sideLabel.toLowerCase()} exit follows the template rules`);
  const targetSummary = targets.length
    ? `${targets.map((value) => `${value}%`).join(', ')} take-profit target${targets.length === 1 ? '' : 's'}`
    : 'configured take-profit targets';
  return `${sideLabel} setup: enter when ${entrySummary}. Exit when ${exitSummary}. Use a ${stopLossPct}% stop loss and ${targetSummary}.`;
};

const buildTemplateSearchSpace = (
  config: Record<string, unknown>
): Array<Record<string, unknown>> => {
  const search = [config];
  const rootConfig = parseRecord(config.config);
  if (rootConfig) {
    search.push(rootConfig);
  }
  ['strategy', 'template', 'definition'].forEach((key) => {
    const nested = parseRecord(config[key]);
    if (nested) {
      search.push(nested);
      const nestedConfig = parseRecord(nested.config);
      if (nestedConfig) {
        search.push(nestedConfig);
      }
    }
  });
  return search;
};

const extractRiskConfig = (searchSpace: Array<Record<string, unknown>>): Record<string, unknown> => {
  for (const scope of searchSpace) {
    const risk =
      parseRecord(scope.risk) ||
      parseRecord(scope.riskConfig) ||
      parseRecord(scope.risk_config);
    if (risk) {
      return risk;
    }
  }
  return {};
};

const extractParameters = (searchSpace: Array<Record<string, unknown>>): Record<string, unknown> => {
  for (const scope of searchSpace) {
    const parameters = parseRecord(scope.parameters) || parseRecord(scope.params);
    if (parameters) {
      return parameters;
    }
  }
  return {};
};

export const buildStrategyTemplateAutomationProfile = (
  config: Record<string, unknown> | null | undefined
): StrategyTemplateAutomationProfile => {
  const root = parseRecord(config) || {};
  const searchSpace = buildTemplateSearchSpace(root);
  const riskConfig = extractRiskConfig(searchSpace);
  const parameters = extractParameters(searchSpace);

  const entryLogic = readText(...searchSpace.map((scope) => scope.entryLogic ?? scope.entry_logic));
  const exitLogic = readText(...searchSpace.map((scope) => scope.exitLogic ?? scope.exit_logic));
  const entryShortLogic = readText(
    ...searchSpace.map((scope) => scope.entryShortLogic ?? scope.entry_short_logic)
  );
  const exitShortLogic = readText(
    ...searchSpace.map((scope) => scope.exitShortLogic ?? scope.exit_short_logic)
  );
  const codeDefinition = readText(
    ...searchSpace.map(
      (scope) =>
        scope.authoredCodeDefinition ??
        scope.codeDefinition ??
        scope.code_definition ??
        scope.compiledCodeDefinition
    )
  );
  const codeTarget = normalizeCodeTarget(
    readText(
      ...searchSpace.map(
        (scope) =>
          scope.authoredCodeTarget ??
          scope.codeTarget ??
          scope.code_target ??
          scope.compiledCodeTarget
      )
    )
  );

  const ruleBasedLong = Boolean(entryLogic && exitLogic);
  const ruleBasedShort = Boolean(entryShortLogic && exitShortLogic);
  const pythonLong =
    codeTarget === 'python' &&
    hasPythonMethod(codeDefinition, ['entry', 'entry_long']) &&
    hasPythonMethod(codeDefinition, ['exit', 'exit_long']);
  const pythonShort =
    codeTarget === 'python' &&
    hasPythonMethod(codeDefinition, ['entry_short']) &&
    hasPythonMethod(codeDefinition, ['exit_short']);

  const supportsLong = ruleBasedLong || pythonLong;
  const supportsShort = ruleBasedShort || pythonShort;
  const stopLossPct =
    normalizePercent(
      riskConfig.stopLossPct ??
        riskConfig.stop_loss_pct ??
        riskConfig.stopLoss ??
        riskConfig.stop_loss
    ) ?? DEFAULT_STOP_LOSS_PCT;
  const takeProfitTargetsPct = normalizePercentList(
    riskConfig.takeProfitTargetsPct ??
      riskConfig.take_profit_targets_pct ??
      riskConfig.takeProfitTargets ??
      riskConfig.take_profit_targets ??
      riskConfig.targetsPct ??
      riskConfig.targets
  );
  const fallbackTakeProfitPct =
    normalizePercent(
      riskConfig.takeProfitPct ??
        riskConfig.take_profit_pct ??
        riskConfig.takeProfit ??
        riskConfig.take_profit
    ) ?? DEFAULT_TAKE_PROFIT_PCT;
  const resolvedTargets = takeProfitTargetsPct.length
    ? takeProfitTargetsPct
    : [fallbackTakeProfitPct];
  const signalThreshold =
    parseNumber(parameters.signalThreshold ?? parameters.signal_threshold) ?? null;
  const market =
    readText(...searchSpace.map((scope) => scope.market), root.market) || DEFAULT_MARKET;

  const longSource: 'rule-based' | 'custom-python' = ruleBasedLong
    ? 'rule-based'
    : 'custom-python';
  const shortSource: 'rule-based' | 'custom-python' = ruleBasedShort
    ? 'rule-based'
    : 'custom-python';

  const longPlan = supportsLong
    ? {
        side: 'long' as const,
        enabled: true,
        entryRule: entryLogic || (pythonLong ? 'Defined in custom Python strategy' : null),
        exitRule: exitLogic || (pythonLong ? 'Defined in custom Python strategy' : null),
        stopLossPct,
        takeProfitTargetsPct: resolvedTargets,
        rationale: buildLegRationale({
          side: 'long',
          entryRule: entryLogic || null,
          exitRule: exitLogic || null,
          stopLossPct,
          targets: resolvedTargets,
          source: longSource,
        }),
        source: longSource,
      }
    : null;

  const shortPlan = supportsShort
    ? {
        side: 'short' as const,
        enabled: true,
        entryRule: entryShortLogic || (pythonShort ? 'Defined in custom Python strategy' : null),
        exitRule: exitShortLogic || (pythonShort ? 'Defined in custom Python strategy' : null),
        stopLossPct,
        takeProfitTargetsPct: resolvedTargets,
        rationale: buildLegRationale({
          side: 'short',
          entryRule: entryShortLogic || null,
          exitRule: exitShortLogic || null,
          stopLossPct,
          targets: resolvedTargets,
          source: shortSource,
        }),
        source: shortSource,
      }
    : null;

  const readinessReasons: string[] = [];
  if (!supportsLong && !supportsShort) {
    readinessReasons.push('missing-entry-exit-contract');
  }

  return {
    contractVersion: 'trade-suggestion.v1',
    automationReady: readinessReasons.length === 0,
    readinessReasons,
    market,
    signalThreshold,
    supports: {
      long: supportsLong,
      short: supportsShort,
      customPython: codeTarget === 'python',
      ruleBased: ruleBasedLong || ruleBasedShort,
    },
    tradePlan: {
      long: longPlan,
      short: shortPlan,
    },
  };
};
