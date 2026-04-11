import { ActivityListResponse } from './Activity';
import { BrokerAccountItem, BrokerAccountsListResponse } from './BrokerAccount';
import { IntegritySummary } from './Integrity';

export interface ConnectionItem {
  id: string;
  name: string;
  broker?: string;
  brokerKey: string;
  brokerId?: string;
  type: string;
  category?: string;
  providerType?: string;
  status: string;
  latency: string;
  mode: string;
  lastSyncAt: string;
  diagnosticSummary?: string;
  route?: string;
  scope?: string;
  accountCount?: number;
  integrity?: IntegritySummary;
}

export interface ConnectionsListResponse {
  items: ConnectionItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface BrokerCatalogField {
  key: string;
  label: string;
  type?: string;
  required?: boolean;
  secret?: boolean;
  placeholder?: string;
  helpText?: string;
}

export interface BrokerCatalogGuideStep {
  title: string;
  description: string;
}

export interface BrokerCatalogItem {
  id: string;
  brokerKey: string;
  exchangeKey?: string;
  entityType?: 'provider' | 'exchange';
  name: string;
  category: string;
  providerType?: string;
  linkedExchangeKey?: string;
  baseUrl?: string;
  capabilities: string[];
  accountFields: BrokerCatalogField[];
  integrationGuide?: {
    summary?: string;
    steps?: BrokerCatalogGuideStep[];
    notes?: string[];
    docsUrl?: string;
  };
  diagnostics?: {
    requiresAccount?: boolean;
    successStatus?: string;
    failureStatus?: string;
    resetStatus?: string;
  };
}

export interface BrokerCatalogResponse {
  items: BrokerCatalogItem[];
  providerItems: BrokerCatalogItem[];
  exchangeItems: BrokerCatalogItem[];
  total: number;
  providersTotal: number;
  exchangesTotal: number;
}

export interface ConnectionDefinitionSummary {
  purpose?: string;
  capabilities: string[];
  requiredAuth?: string;
  limitations?: string[];
}

export interface ConnectionProductMapSummary {
  supported: boolean;
  source: string;
  total: number;
}

export interface ConnectionWorkspaceResponse {
  connection: ConnectionItem;
  definition?: ConnectionDefinitionSummary;
  selectedAccount?: BrokerAccountItem | null;
  accounts: BrokerAccountsListResponse;
  activity: ActivityListResponse;
  productMap: ConnectionProductMapSummary;
}

export interface ConnectionsSummary {
  healthyConnections: number;
  watchingConnections: number;
  disconnected: number;
  syncHealth: string;
  connected?: number;
  feeds?: number;
  brokerRoutes?: number;
}

export interface ConnectionActionBody {
  reason?: string;
  mode?: string;
  accountId?: string;
}

export interface ConnectionUpsertBody {
  name?: string;
  brokerKey?: string;
  mode?: string;
  route?: string;
  scope?: string;
}

export interface ConnectionReconnectResult {
  message: string;
  connection: {
    id: string;
    updatedAt: string;
  };
  account?: {
    id: string;
    status: string;
    updatedAt: string;
  };
}

export interface ConnectionDeleteResult {
  message: string;
  connectionId: string;
  accountsDeleted: number;
}

export interface ConnectionTestResult {
  message: string;
  connectionId: string;
  accountId?: string;
  status: string;
  latency?: string;
  checkedAt?: string;
  detail?: string;
}
