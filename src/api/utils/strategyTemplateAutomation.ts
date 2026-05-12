import {
  CustomRLadderTrailingStopConfig,
  normalizeCustomRLadderTrailingStopConfig,
} from './trailingStopRLadder';

export type StrategyTradeSide = 'long' | 'short';

export type StrategyTemplateFirst60DecisionStatus =
  | 'candidate'
  | 'observe_only'
  | 'blocked'
  | 'disabled'
  | 'management_enabled';

export interface StrategyTemplateTradePlanLeg {
  side: StrategyTradeSide;
  enabled: boolean;
  entryRule: string | null;
  exitRule: string | null;
  stopLossPct: number;
  takeProfitTargetsPct: number[];
  stopLossMode?: string | null;
  takeProfitMode?: string | null;
  riskRewardRatio?: number | null;
  rationale: string;
  source: 'rule-based' | 'custom-python';
}

export interface StrategyTemplateFirst60ManagementLeg {
  side: StrategyTradeSide;
  enabled: boolean;
  decisionGate: StrategyTemplateFirst60DecisionGate;
  windowMinutes: number;
  evaluationTimeframe: string;
  requiredFavorableR: number;
  maxAdverseR: number;
  targetR: number;
  entryBasis: string;
  stopBasis: string;
  passAction: string;
  failAction: string;
}

export interface StrategyTemplateFirst60DecisionGate {
  status: StrategyTemplateFirst60DecisionStatus;
  observeOnlyEnabled: boolean;
  managementEnabled: boolean;
  diagnosticsEnabled: boolean;
  reason: string | null;
  evidenceRef: string | null;
  decidedAt: string | null;
}

export interface StrategyTemplateFirst60ManagementProfile {
  enabled: boolean;
  mode: string;
  dataSource: string | null;
  long: StrategyTemplateFirst60ManagementLeg | null;
  short: StrategyTemplateFirst60ManagementLeg | null;
}

export interface StrategyTemplateTradeManagementProfile {
  first60: StrategyTemplateFirst60ManagementProfile | null;
  trailingStop: CustomRLadderTrailingStopConfig | null;
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
  tradeManagement?: StrategyTemplateTradeManagementProfile;
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

const parseBoolean = (value: unknown): boolean | null => {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const normalized = value.trim().toLowerCase();
    if (['true', 'yes', 'enabled', 'on', '1'].includes(normalized)) {
      return true;
    }
    if (['false', 'no', 'disabled', 'off', '0'].includes(normalized)) {
      return false;
    }
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  return null;
};

const parsePositiveNumber = (...values: unknown[]): number | null => {
  for (const value of values) {
    const parsed = parseNumber(value);
    if (parsed !== null && parsed > 0) {
      return parsed;
    }
  }
  return null;
};

const parseNonNegativeNumber = (...values: unknown[]): number | null => {
  for (const value of values) {
    const parsed = parseNumber(value);
    if (parsed !== null && parsed >= 0) {
      return parsed;
    }
  }
  return null;
};

const normalizeCodeTarget = (value: unknown): string => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (!normalized) return '';
  if (normalized === 'py' || normalized === 'python') return 'python';
  if (normalized === 'js' || normalized === 'javascript') return 'javascript';
  if (normalized === 'dsl') return 'dsl';
  return normalized;
};

const normalizeFirst60DecisionStatus = (
  value: unknown
): StrategyTemplateFirst60DecisionStatus | null => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (!normalized) {
    return null;
  }
  if (['candidate', 'ready_candidate', 'research'].includes(normalized)) {
    return 'candidate';
  }
  if (['observe', 'observe_only', 'observe_only_ready', 'paper_observe'].includes(normalized)) {
    return 'observe_only';
  }
  if (['blocked', 'paused', 'research_only', 'diagnostics_only'].includes(normalized)) {
    return 'blocked';
  }
  if (['disabled', 'off'].includes(normalized)) {
    return 'disabled';
  }
  if (
    ['management_enabled', 'paper_management', 'live_management', 'enabled'].includes(normalized)
  ) {
    return 'management_enabled';
  }
  return null;
};

const extractPythonRiskBlock = (codeDefinition: string): string => {
  const match = /\brisk\s*[:=]\s*\{/.exec(codeDefinition);
  if (!match) {
    return '';
  }

  const openingBraceIndex = codeDefinition.indexOf('{', match.index);
  if (openingBraceIndex < 0) {
    return '';
  }

  let depth = 0;
  let quote: string | null = null;
  let escaped = false;

  for (let index = openingBraceIndex; index < codeDefinition.length; index += 1) {
    const char = codeDefinition[index];

    if (quote !== null) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === '{') {
      depth += 1;
      continue;
    }

    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return codeDefinition.slice(openingBraceIndex + 1, index);
      }
    }
  }

  return '';
};

const extractPythonRiskLiteralValue = (
  block: string,
  keys: string[]
): number | string | boolean | null => {
  for (const key of keys) {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
      new RegExp(`["']${escapedKey}["']\\s*:\\s*([^,\\n}]+)`, 'm'),
      new RegExp(`\\b${escapedKey}\\b\\s*:\\s*([^,\\n}]+)`, 'm'),
    ];

    for (const pattern of patterns) {
      const match = pattern.exec(block);
      if (!match) {
        continue;
      }
      const raw = String(match[1] || '')
        .trim()
        .replace(/,$/, '');
      if (!raw) {
        continue;
      }
      const quoted = /^['"]([\s\S]*)['"]$/.exec(raw);
      if (quoted) {
        return quoted[1];
      }
      if (/^(true|false)$/i.test(raw)) {
        return raw.toLowerCase() === 'true';
      }
      if (/^-?\d+(\.\d+)?$/.test(raw)) {
        return raw.includes('.') ? Number(raw) : parseInt(raw, 10);
      }
    }
  }

  return null;
};

const mergeExecutionRiskConfig = (
  riskConfig: Record<string, unknown>,
  codeDefinition: string
): Record<string, unknown> => {
  const resolved = { ...riskConfig };
  const riskBlock = extractPythonRiskBlock(codeDefinition);
  if (!riskBlock) {
    return resolved;
  }

  const stopLoss = extractPythonRiskLiteralValue(riskBlock, [
    'stop_loss_pct',
    'stopLossPct',
    'stop_loss',
    'stopLoss',
  ]);
  const takeProfit = extractPythonRiskLiteralValue(riskBlock, [
    'take_profit_pct',
    'takeProfitPct',
    'take_profit',
    'takeProfit',
  ]);

  if (
    stopLoss !== null &&
    !['stop_loss_pct', 'stopLossPct', 'stop_loss', 'stopLoss'].some(
      (key) => resolved[key] !== undefined && resolved[key] !== null
    )
  ) {
    resolved.stop_loss_pct = stopLoss;
  }

  if (
    takeProfit !== null &&
    !['take_profit_pct', 'takeProfitPct', 'take_profit', 'takeProfit'].some(
      (key) => resolved[key] !== undefined && resolved[key] !== null
    )
  ) {
    resolved.take_profit_pct = takeProfit;
  }

  return resolved;
};

const hasPythonMethod = (code: string, names: string[]): boolean =>
  names.some((name) => new RegExp(`def\\s+${name}\\s*\\(`, 'i').test(code));

const buildLegRationale = ({
  side,
  entryRule,
  exitRule,
  stopLossPct,
  targets,
  stopLossMode,
  takeProfitMode,
  riskRewardRatio,
  source,
}: {
  side: StrategyTradeSide;
  entryRule: string | null;
  exitRule: string | null;
  stopLossPct: number;
  targets: number[];
  stopLossMode?: string | null;
  takeProfitMode?: string | null;
  riskRewardRatio?: number | null;
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
  const dynamicStop =
    typeof stopLossMode === 'string' && stopLossMode.trim().toLowerCase().startsWith('dynamic');
  const dynamicTarget =
    typeof takeProfitMode === 'string' && takeProfitMode.trim().toLowerCase().startsWith('dynamic');
  if (dynamicStop || dynamicTarget) {
    const riskRewardSummary =
      riskRewardRatio && Number.isFinite(riskRewardRatio) && riskRewardRatio > 0
        ? ` and a 1:${riskRewardRatio} reward target`
        : '';
    const protectionSummary =
      dynamicStop && dynamicTarget
        ? `Use a dynamic stop loss${riskRewardSummary} defined by the custom Python strategy.`
        : dynamicStop
          ? `Use a dynamic stop loss defined by the custom Python strategy.`
          : `Use a dynamic take-profit plan${riskRewardSummary} defined by the custom Python strategy.`;
    return `${sideLabel} setup: enter when ${entrySummary}. Exit when ${exitSummary}. ${protectionSummary}`;
  }
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

const extractRiskConfig = (
  searchSpace: Array<Record<string, unknown>>
): Record<string, unknown> => {
  for (const scope of searchSpace) {
    const risk =
      parseRecord(scope.risk) || parseRecord(scope.riskConfig) || parseRecord(scope.risk_config);
    if (risk) {
      return risk;
    }
  }
  return {};
};

const extractParameters = (
  searchSpace: Array<Record<string, unknown>>
): Record<string, unknown> => {
  for (const scope of searchSpace) {
    const parameters = parseRecord(scope.parameters) || parseRecord(scope.params);
    if (parameters) {
      return parameters;
    }
  }
  return {};
};

const extractTradeManagementConfig = (
  searchSpace: Array<Record<string, unknown>>
): Record<string, unknown> | null => {
  for (const scope of searchSpace) {
    const management =
      parseRecord(scope.tradeManagement) ||
      parseRecord(scope.trade_management) ||
      parseRecord(scope.management);
    if (management) {
      return management;
    }

    const first60 = parseRecord(scope.first60) || parseRecord(scope.first_60);
    if (first60) {
      return { first60 };
    }
  }
  return null;
};

const buildFirst60Leg = (
  side: StrategyTradeSide,
  first60: Record<string, unknown>
): StrategyTemplateFirst60ManagementLeg | null => {
  const hasSideSpecificConfig = Boolean(
    parseRecord(first60.long) ||
    parseRecord(first60.buy) ||
    parseRecord(first60.short) ||
    parseRecord(first60.sell)
  );
  const sideConfig =
    side === 'long'
      ? parseRecord(first60.long) || parseRecord(first60.buy)
      : parseRecord(first60.short) || parseRecord(first60.sell);
  if (!sideConfig && (hasSideSpecificConfig || parseBoolean(first60.enabled) !== true)) {
    return null;
  }

  const config = sideConfig || {};
  const enabled =
    parseBoolean(config.enabled) ?? parseBoolean(first60.enabled) ?? Boolean(sideConfig);
  if (!enabled) {
    return null;
  }
  const decisionGate = buildFirst60DecisionGate(config, first60);

  const windowMinutes =
    parsePositiveNumber(
      config.windowMinutes,
      config.window_minutes,
      first60.windowMinutes,
      first60.window_minutes
    ) ?? 60;
  const evaluationTimeframe =
    readText(
      config.evaluationTimeframe,
      config.evaluation_timeframe,
      first60.evaluationTimeframe,
      first60.evaluation_timeframe
    ) || '1m';
  const requiredFavorableR =
    parsePositiveNumber(
      config.requiredFavorableR,
      config.required_favorable_r,
      config.favorableR,
      config.favorable_r,
      config.minFavorableR,
      config.min_favorable_r,
      first60.requiredFavorableR,
      first60.required_favorable_r
    ) ?? 1;
  const maxAdverseR =
    parseNonNegativeNumber(
      config.maxAdverseR,
      config.max_adverse_r,
      config.adverseR,
      config.adverse_r,
      config.maxHeatR,
      config.max_heat_r,
      first60.maxAdverseR,
      first60.max_adverse_r
    ) ?? 0.75;
  const targetR =
    parsePositiveNumber(
      config.targetR,
      config.target_r,
      config.takeProfitR,
      config.take_profit_r,
      config.riskRewardRatio,
      config.risk_reward_ratio,
      first60.targetR,
      first60.target_r
    ) ?? (side === 'long' ? 5 : 4.5);

  return {
    side,
    enabled,
    decisionGate,
    windowMinutes,
    evaluationTimeframe,
    requiredFavorableR,
    maxAdverseR,
    targetR,
    entryBasis:
      readText(config.entryBasis, config.entry_basis, first60.entryBasis, first60.entry_basis) ||
      'signal_5m_close',
    stopBasis:
      readText(config.stopBasis, config.stop_basis, first60.stopBasis, first60.stop_basis) ||
      (side === 'long' ? 'signal_candle_low' : 'signal_candle_high'),
    passAction:
      readText(config.passAction, config.pass_action, first60.passAction, first60.pass_action) ||
      'hold_for_target',
    failAction:
      readText(config.failAction, config.fail_action, first60.failAction, first60.fail_action) ||
      'paper_tighten_or_exit',
  };
};

const buildFirst60DecisionGate = (
  config: Record<string, unknown>,
  first60: Record<string, unknown>
): StrategyTemplateFirst60DecisionGate => {
  const gate =
    parseRecord(config.decisionGate) ||
    parseRecord(config.decision_gate) ||
    parseRecord(config.gate) ||
    {};
  const status =
    normalizeFirst60DecisionStatus(
      gate.status ??
        gate.decisionStatus ??
        gate.decision_status ??
        gate.decision ??
        config.status ??
        config.decisionStatus ??
        config.decision_status ??
        config.decision
    ) ?? null;
  const blocked = status === 'blocked' || status === 'disabled';
  const observeOnlyEnabled = blocked
    ? false
    : (parseBoolean(
        gate.observeOnlyEnabled ??
          gate.observe_only_enabled ??
          gate.observeOnly ??
          gate.observe_only ??
          config.observeOnlyEnabled ??
          config.observe_only_enabled ??
          config.observeOnly ??
          config.observe_only ??
          first60.observeOnlyEnabled ??
          first60.observe_only_enabled
      ) ?? status === 'observe_only');
  const managementEnabled = blocked
    ? false
    : (parseBoolean(
        gate.managementEnabled ??
          gate.management_enabled ??
          gate.manageEnabled ??
          gate.manage_enabled ??
          config.managementEnabled ??
          config.management_enabled ??
          config.manageEnabled ??
          config.manage_enabled ??
          first60.managementEnabled ??
          first60.management_enabled
      ) ?? status === 'management_enabled');
  const diagnosticsEnabled =
    parseBoolean(
      gate.diagnosticsEnabled ??
        gate.diagnostics_enabled ??
        gate.diagnosticEnabled ??
        gate.diagnostic_enabled ??
        config.diagnosticsEnabled ??
        config.diagnostics_enabled ??
        config.diagnosticEnabled ??
        config.diagnostic_enabled ??
        first60.diagnosticsEnabled ??
        first60.diagnostics_enabled
    ) ?? status !== 'disabled';

  return {
    status:
      status ??
      (managementEnabled
        ? 'management_enabled'
        : observeOnlyEnabled
          ? 'observe_only'
          : 'candidate'),
    observeOnlyEnabled,
    managementEnabled,
    diagnosticsEnabled,
    reason:
      readText(
        gate.reason,
        gate.decisionReason,
        gate.decision_reason,
        gate.blockedReason,
        gate.blocked_reason,
        config.reason,
        config.decisionReason,
        config.decision_reason,
        config.blockedReason,
        config.blocked_reason
      ) || null,
    evidenceRef:
      readText(
        gate.evidenceRef,
        gate.evidence_ref,
        gate.evidence,
        gate.evidenceArtifact,
        gate.evidence_artifact,
        config.evidenceRef,
        config.evidence_ref,
        config.evidence,
        config.evidenceArtifact,
        config.evidence_artifact
      ) || null,
    decidedAt:
      readText(
        gate.decidedAt,
        gate.decided_at,
        gate.updatedAt,
        gate.updated_at,
        config.decidedAt,
        config.decided_at
      ) || null,
  };
};

const buildTradeManagementProfile = (
  searchSpace: Array<Record<string, unknown>>
): StrategyTemplateTradeManagementProfile | undefined => {
  const management = extractTradeManagementConfig(searchSpace);
  const first60 = parseRecord(management?.first60) || parseRecord(management?.first_60);
  const trailingStop = normalizeCustomRLadderTrailingStopConfig(
    management?.trailingStop ?? management?.trailing_stop
  );
  if (!first60 && !trailingStop) {
    return undefined;
  }

  const long = first60 ? buildFirst60Leg('long', first60) : null;
  const short = first60 ? buildFirst60Leg('short', first60) : null;
  const enabled = first60
    ? (parseBoolean(first60.enabled) ?? true) && Boolean(long || short)
    : false;

  return {
    first60: first60
      ? {
          enabled,
          mode:
            readText(first60.mode, first60.decisionMode, first60.decision_mode) ||
            'post_entry_hold_or_exit',
          dataSource: readText(first60.dataSource, first60.data_source, first60.source) || null,
          long,
          short,
        }
      : null,
    trailingStop,
  };
};

export const buildStrategyTemplateAutomationProfile = (
  config: Record<string, unknown> | null | undefined
): StrategyTemplateAutomationProfile => {
  const root = parseRecord(config) || {};
  const searchSpace = buildTemplateSearchSpace(root);
  const baseRiskConfig = extractRiskConfig(searchSpace);
  const parameters = extractParameters(searchSpace);
  const tradeManagement = buildTradeManagementProfile(searchSpace);

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

  const riskConfig =
    codeTarget === 'python' && codeDefinition
      ? mergeExecutionRiskConfig(baseRiskConfig, codeDefinition)
      : baseRiskConfig;

  const usesCustomPython = codeTarget === 'python' && Boolean(codeDefinition);
  const ruleBasedLong = !usesCustomPython && Boolean(entryLogic && exitLogic);
  const ruleBasedShort = !usesCustomPython && Boolean(entryShortLogic && exitShortLogic);
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
  const stopLossMode = readText(riskConfig.stopLossMode, riskConfig.stop_loss_mode);
  const takeProfitMode = readText(riskConfig.takeProfitMode, riskConfig.take_profit_mode);
  const riskRewardRatio =
    parseNumber(riskConfig.riskRewardRatio ?? riskConfig.risk_reward_ratio) ?? null;
  const usesDynamicStopLoss = stopLossMode.toLowerCase().startsWith('dynamic');
  const usesDynamicTakeProfit = takeProfitMode.toLowerCase().startsWith('dynamic');
  const stopLossPct =
    normalizePercent(
      riskConfig.stopLossPct ??
        riskConfig.stop_loss_pct ??
        riskConfig.stopLoss ??
        riskConfig.stop_loss
    ) ?? (usesDynamicStopLoss ? 0 : DEFAULT_STOP_LOSS_PCT);
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
    ) ?? (usesDynamicTakeProfit ? null : DEFAULT_TAKE_PROFIT_PCT);
  const resolvedTargets = takeProfitTargetsPct.length
    ? takeProfitTargetsPct
    : fallbackTakeProfitPct === null
      ? []
      : [fallbackTakeProfitPct];
  const signalThreshold =
    parseNumber(parameters.signalThreshold ?? parameters.signal_threshold) ?? null;
  const market =
    readText(...searchSpace.map((scope) => scope.market), root.market) || DEFAULT_MARKET;

  const longSource: 'rule-based' | 'custom-python' = ruleBasedLong ? 'rule-based' : 'custom-python';
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
        stopLossMode: stopLossMode || null,
        takeProfitMode: takeProfitMode || null,
        riskRewardRatio,
        rationale: buildLegRationale({
          side: 'long',
          entryRule: entryLogic || null,
          exitRule: exitLogic || null,
          stopLossPct,
          targets: resolvedTargets,
          stopLossMode: stopLossMode || null,
          takeProfitMode: takeProfitMode || null,
          riskRewardRatio,
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
        stopLossMode: stopLossMode || null,
        takeProfitMode: takeProfitMode || null,
        riskRewardRatio,
        rationale: buildLegRationale({
          side: 'short',
          entryRule: entryShortLogic || null,
          exitRule: exitShortLogic || null,
          stopLossPct,
          targets: resolvedTargets,
          stopLossMode: stopLossMode || null,
          takeProfitMode: takeProfitMode || null,
          riskRewardRatio,
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
      customPython: usesCustomPython,
      ruleBased: ruleBasedLong || ruleBasedShort,
    },
    tradePlan: {
      long: longPlan,
      short: shortPlan,
    },
    ...(tradeManagement ? { tradeManagement } : {}),
  };
};
