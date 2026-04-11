export interface BrokerDefinitionFieldOptionItem {
  value: string;
  label: string;
}

export interface BrokerDefinitionFieldItem {
  key: string;
  label: string;
  type?: string;
  required?: boolean;
  secret?: boolean;
  placeholder?: string;
  helpText?: string;
  options?: BrokerDefinitionFieldOptionItem[];
}

export interface BrokerDefinitionGuideStepItem {
  title: string;
  description: string;
}

export interface BrokerDefinitionGuideItem {
  summary?: string;
  steps?: BrokerDefinitionGuideStepItem[];
  notes?: string[];
  docsUrl?: string;
}

export interface BrokerDefinitionDiagnosticsItem {
  requiresAccount?: boolean;
  executorKey?: string;
  successStatus?: string;
  failureStatus?: string;
  resetStatus?: string;
}

export interface BrokerDefinitionItem {
  id: string;
  brokerKey: string;
  name: string;
  category: string;
  status: string;
  providerType: string;
  linkedExchangeKey?: string;
  baseUrl?: string;
  capabilities: string[];
  accountFields: BrokerDefinitionFieldItem[];
  integrationGuide?: BrokerDefinitionGuideItem;
  diagnostics?: BrokerDefinitionDiagnosticsItem;
  updatedAt?: string;
  versionToken?: string;
}

export interface BrokerDefinitionsResponse {
  items: BrokerDefinitionItem[];
  total: number;
}

export interface BrokerDefinitionUpsertBody {
  brokerKey?: string;
  name?: string;
  category?: string;
  status?: string;
  providerType?: string;
  linkedExchangeKey?: string;
  baseUrl?: string;
  capabilities?: string[];
  accountFields?: BrokerDefinitionFieldItem[];
  integrationGuide?: BrokerDefinitionGuideItem;
  diagnostics?: BrokerDefinitionDiagnosticsItem;
  expectedUpdatedAt?: string | null;
}
