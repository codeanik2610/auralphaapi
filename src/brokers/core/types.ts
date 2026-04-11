export interface BrokerFeatureFlags {
  marketData: boolean;
  orders: boolean;
  positions: boolean;
  balances: boolean;
  leverage: boolean;
  risk: boolean;
  streaming: boolean;
}

export interface BrokerCapabilityProfile {
  purpose: string;
  capabilities: string;
  authMode: string;
  limitations: string;
  environment: string;
}

export interface BrokerModule {
  brokerKey: string;
  displayName: string;
  category: 'broker' | 'exchange' | 'feed';
  providerType: 'broker' | 'exchange' | 'feed';
  profile: BrokerCapabilityProfile;
  features: BrokerFeatureFlags;
}
