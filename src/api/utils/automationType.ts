import type { AutomationType, LegacyAutomationType } from '../contracts/Automation';

const LEGACY_AUTOMATION_TYPE_MAP: Record<LegacyAutomationType, AutomationType> = {
  strategy: 'trade-suggestion',
  'strategy-library': 'backtest-runner',
};

export const CANONICAL_AUTOMATION_TYPES: AutomationType[] = [
  'trade-suggestion',
  'backtest-runner',
];

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

const readString = (...values: unknown[]): string | null => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
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

  const runnerSources = [
    root,
    backtestRunner,
    nestedConfig,
    inputSnapshot,
    runnerBody,
  ];
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

  const suggestionSources = [
    root,
    tradeSuggestion,
    nestedConfig,
    inputSnapshot,
    tradeExecution,
  ];
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

export const normalizeAutomationType = (
  value: unknown,
  config?: unknown
): AutomationType => {
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
    const runBody =
      parseRecord(runner.runBody) ??
      parseRecord(root.config) ??
      null;
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
      ) ??
      (libraryId ? 'strategy-library' : 'manual');

    // Extract template IDs (backtest-runner typically doesn't use templates, but handle for consistency)
    const sourceTemplateId = readString(
      root.sourceTemplateId,
      runBody?.sourceTemplateId,
      runner.sourceTemplateId
    ) ?? null;

    const templateId = readString(
      root.templateId,
      runBody?.templateId,
      runner.templateId
    ) ?? null;

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
  const execution =
    parseRecord(suggestion.execution) ??
    parseRecord(root.config) ??
    null;
  const setupScope = parseRecord(suggestion.setupScope) ?? parseRecord(root.setupScope) ?? null;
  const source =
    readString(suggestion.source, root.source, root.sourceType) ?? 'manual';
  const backtestId = readString(suggestion.backtestId, root.backtestId) ?? null;
  const strategy = readString(suggestion.strategy, root.strategy) ?? null;
  const symbol = readString(suggestion.symbol, root.symbol, setupScope?.symbol) ?? null;
  const timeframe = readString(
    suggestion.timeframe,
    root.timeframe,
    setupScope?.timeframe
  ) ?? null;
  const market = readString(suggestion.market, root.market, execution?.market) ?? null;

  // Extract template IDs with clear precedence:
  // Priority: explicit top-level > nested config > tradeSuggestion > execution
  const executionTemplate = parseRecord(execution?.template);
  const sourceTemplateId = readString(
    root.sourceTemplateId,              // 1. Explicit top-level (highest priority)
    execution?.sourceTemplateId,         // 2. Nested in execution/config
    suggestion.sourceTemplateId,         // 3. Nested in tradeSuggestion
    executionTemplate?.id                // 4. Nested template object
  ) ?? null;

  const templateId = readString(
    root.templateId,                     // 1. Explicit top-level (highest priority)
    execution?.templateId,               // 2. Nested in execution/config
    suggestion.templateId,               // 3. Nested in tradeSuggestion
    executionTemplate?.id,               // 4. Nested template object
    executionTemplate?.templateId        // 5. Template object's templateId field
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
    ...(execution ? { config: execution } : {}),
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
      execution,
    },
  };
};
