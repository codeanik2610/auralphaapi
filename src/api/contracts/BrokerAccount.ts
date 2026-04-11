import { IntegritySummary } from './Integrity';

export interface BrokerAccountItem {
  id: string;
  connectionId: string;
  brokerKey: string;
  brokerId?: string;
  accountKey: string;
  accountName: string;
  status: string;
  mode?: string;
  lastSyncAt: string;
  purpose?: string;
  capabilities?: string;
  settings?: Record<string, unknown> | null;
  hasApiKey?: boolean;
  hasApiSecret?: boolean;
  isDefault: boolean;
  integrity?: IntegritySummary;
}

export interface BrokerAccountsListResponse {
  items: BrokerAccountItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface BrokerAccountUpsertBody {
  connectionId?: string;
  brokerKey?: string;
  brokerId?: string;
  accountKey?: string;
  accountName?: string;
  mode?: string;
  purpose?: string;
  capabilities?: string;
  settings?: Record<string, unknown> | null;
  isDefault?: boolean;
}

export interface BrokerAccountTestConfigResult {
  passed: boolean;
  status: 'Connected' | 'Disconnected';
  detail: string;
  checkedAt: string;
}

export interface BrokerAccountDeleteResult {
  message: string;
  accountId: string;
  connectionId: string;
}

export interface BrokerAccountHealthCheckItem {
  accountId: string;
  brokerKey: string;
  accountKey: string;
  accountName: string;
  status: string;
  passed: boolean;
  detail: string;
  checkedAt: string;
}

export interface BrokerAccountHealthCheckResponse {
  totalAccounts: number;
  connectedAccounts: number;
  testedAccounts: number;
  passed: number;
  failed: number;
  items: BrokerAccountHealthCheckItem[];
}
