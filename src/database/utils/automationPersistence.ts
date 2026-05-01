import { extractAutomationLineage } from '../../api/utils/automationLineage';
import { normalizeAutomationConfig, normalizeAutomationType } from '../../api/utils/automationType';

export interface AutomationPersistenceInput {
  name?: string | null;
  strategy?: string | null;
  broker?: string | null;
  market?: string | null;
  trigger?: string | null;
  status?: string | null;
  automationType?: string | null;
  timeZone?: string | null;
  config?: unknown;
}

export interface AutomationPersistenceFields {
  automationType: string | null;
  normalizedConfig: Record<string, unknown> | null;
  searchText: string | null;
  sourceBacktestId: string | null;
  scopeSymbol: string | null;
  scopeTimeframe: string | null;
  sourceTemplateId: string | null;
}

export const deriveAutomationPersistenceFields = (
  value: AutomationPersistenceInput
): AutomationPersistenceFields => {
  const root = parseRecord(value.config) ?? {};
  const rootTradeSuggestion = parseRecord(root.tradeSuggestion) ?? {};
  const automationType = normalizeAutomationType(value.automationType, root);
  const normalizedConfig = normalizeAutomationConfig(automationType, root) ?? root;
  const normalizedRoot = parseRecord(normalizedConfig) ?? {};
  const tradeSuggestion = parseRecord(normalizedRoot.tradeSuggestion) ?? {};
  const setupScope =
    parseRecord(tradeSuggestion.setupScope) ??
    parseRecord(normalizedRoot.setupScope) ??
    {};
  const lineage = extractAutomationLineage(normalizedRoot);

  const sourceBacktestId =
    readString(normalizedRoot.backtestId, tradeSuggestion.backtestId, lineage?.backtestId) ?? null;
  const scopeSymbol =
    normalizeAssetSymbol(
      readString(tradeSuggestion.symbol, normalizedRoot.symbol, setupScope.symbol)
    ) || null;
  const scopeTimeframe =
    normalizeTimeframe(
      readString(tradeSuggestion.timeframe, normalizedRoot.timeframe, setupScope.timeframe)
    ) || null;
  const sourceTemplateId =
    readString(
      root.sourceTemplateId,
      root.templateId,
      rootTradeSuggestion.sourceTemplateId,
      rootTradeSuggestion.templateId,
      normalizedRoot.sourceTemplateId,
      normalizedRoot.templateId,
      tradeSuggestion.sourceTemplateId,
      tradeSuggestion.templateId,
      lineage?.sourceTemplateId,
      lineage?.templateId
    ) ?? null;

  const searchText = buildSearchText([
    value.name,
    value.strategy,
    value.broker,
    value.market,
    value.trigger,
    value.status,
    automationType,
    value.timeZone,
    sourceBacktestId,
    sourceTemplateId,
    scopeSymbol,
    scopeTimeframe,
  ]);

  return {
    automationType,
    normalizedConfig,
    searchText,
    sourceBacktestId,
    scopeSymbol,
    scopeTimeframe,
    sourceTemplateId,
  };
};

const parseRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value) {
    return null;
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  return null;
};

const readString = (...values: unknown[]): string | null => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
};

const normalizeAssetSymbol = (value: unknown): string => {
  return String(value || '').trim().toUpperCase();
};

const normalizeTimeframe = (value: unknown): string => {
  return String(value || '').trim().toLowerCase();
};

const buildSearchText = (values: unknown[]): string | null => {
  const unique = new Set<string>();
  values.forEach((value) => {
    if (typeof value === 'string') {
      const normalized = value.trim();
      if (normalized) {
        unique.add(normalized);
      }
      return;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      unique.add(String(value));
    }
  });
  return unique.size ? Array.from(unique).join(' | ') : null;
};
