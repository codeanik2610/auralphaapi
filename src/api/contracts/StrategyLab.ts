export interface StrategyValidationMessage {
  field?: string;
  message: string;
}

export interface StrategyLabProjectItem {
  id: string;
  name: string;
  description?: string | null;
  status: string;
  projectVersion: number;
  sourceTemplateId?: string | null;
  sourceTemplateVersion?: number | null;
  sourceTemplateName?: string | null;
  authoringMode: string;
  codeTarget?: string | null;
  visualDefinition?: Record<string, unknown> | null;
  codeDefinition?: string | null;
  parameters?: Record<string, unknown> | null;
  riskConfig?: Record<string, unknown> | null;
  config?: Record<string, unknown> | null;
  assets?: Array<Record<string, unknown>> | null;
  timeframes?: string[] | null;
  start?: string | null;
  end?: string | null;
  validationState?: string | null;
  validationErrors?: StrategyValidationMessage[] | null;
  validationWarnings?: StrategyValidationMessage[] | null;
  objective?: string | null;
  market?: string | null;
  timeframe?: string | null;
  universe?: string | null;
  createdAt: string;
  updatedAt: string;
  lastValidatedAt?: string | null;
}

export interface StrategyLabDraftBody {
  projectId?: string;
  name?: string;
  description?: string | null;
  sourceTemplateId?: string | null;
  sourceTemplateVersion?: number | null;
  sourceTemplateName?: string | null;
  authoringMode?: string;
  codeTarget?: string | null;
  objective?: string;
  market?: string;
  timeframe?: string;
  timeframes?: string[];
  assets?: Array<Record<string, unknown>>;
  start?: string;
  end?: string;
  universe?: string;
  modelType?: string;
  maxRisk?: string;
  signalThreshold?: string;
  entryLogic?: string;
  exitLogic?: string;
  shortEnabled?: boolean;
  entryShortLogic?: string;
  exitShortLogic?: string;
  sizingNotes?: string;
  notes?: string;
  useAiFilter?: boolean;
  useRegimeFilter?: boolean;
  paperTradeFirst?: boolean;
  visualDefinition?: Record<string, unknown> | null;
  codeDefinition?: string | null;
  parameters?: Record<string, unknown> | null;
  riskConfig?: Record<string, unknown> | null;
}

export interface StrategyLabDraftResult {
  message: string;
  project: StrategyLabProjectItem;
}

export interface StrategyLabProjectsListResult {
  items: StrategyLabProjectItem[];
  total: number;
}

export interface StrategyLabBacktestHandoffBody {
  projectId?: string;
}

export interface StrategyLabBacktestHandoffResult {
  message: string;
  projectId: string;
  backtestId: string;
}

export interface StrategyLabValidationResult {
  message: string;
  validationState: string;
  errors: StrategyValidationMessage[];
  warnings: StrategyValidationMessage[];
  validatedAt: string;
}
