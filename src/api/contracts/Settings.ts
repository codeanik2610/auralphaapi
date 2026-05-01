export type SettingsNotificationChannel = 'both' | 'in-app' | 'email' | 'disabled';
export type SettingsNotificationSeverity = 'all' | 'medium' | 'high' | 'critical';
export type SettingsEscalationRoute = 'risk-review' | 'on-call' | 'manual';
export type SettingsWhatsappDeliveryRolloutStatus =
  | 'ready'
  | 'disabled'
  | 'misconfigured';

export interface SettingsWhatsappDeliveryRollout {
  status: SettingsWhatsappDeliveryRolloutStatus;
  allowsLiveTradeSuggestions: boolean;
  provider: string;
  providerConfigured: boolean;
  detail?: string | null;
}
export interface BacktestPromotionRules {
  minScore: number;
  minTrades: number;
  requireCompleteHistory: boolean;
  requireLineage: boolean;
  requireTemplateAutomationReady: boolean;
  requireRobustness: boolean;
  requiredRobustnessModel: string;
  minPortfolioPressureScore: number;
  minExecutedTradeRatio: number;
  blockCapitalDepletionRisk: boolean;
}

export type BacktestPromotionRulesInput = Partial<BacktestPromotionRules>;
export type SettingsValue = string | boolean | number | BacktestPromotionRules | null;
export type SettingsValueType = 'string' | 'boolean' | 'number' | 'json' | 'null';
export type SettingsAuditChangeType = 'created' | 'updated' | 'cleared';

export interface SettingsResponse {
  executionMode: string;
  scope: 'user';
  ownerUserId: string;
  hasSavedSettings: boolean;
  timezone: string;
  notifyEmail: boolean;
  notifyInApp: boolean;
  notifyWhatsapp: boolean;
  whatsappLiveTradeSuggestions: boolean;
  whatsappNumber: string | null;
  whatsappVerifiedAt: string | null;
  whatsappDeliveryRollout: SettingsWhatsappDeliveryRollout;
  confirmDestructive: boolean;
  notificationChannel: SettingsNotificationChannel;
  notificationSeverity: SettingsNotificationSeverity;
  escalationRoute: SettingsEscalationRoute;
  escalationSlaMinutes: number;
  backtestPromotionRules: BacktestPromotionRules;
  updatedAt?: string;
  versionToken?: string;
}

export interface UpdateSettingsBody {
  timezone: string;
  notifyEmail: boolean;
  notifyInApp: boolean;
  notifyWhatsapp: boolean;
  whatsappLiveTradeSuggestions: boolean;
  whatsappNumber: string | null;
  confirmDestructive: boolean;
  notificationChannel: SettingsNotificationChannel;
  notificationSeverity: SettingsNotificationSeverity;
  escalationRoute: SettingsEscalationRoute;
  escalationSlaMinutes: number;
  backtestPromotionRules: BacktestPromotionRules;
}

export interface UpdateSettingsRequestBody extends Omit<
  Partial<UpdateSettingsBody>,
  'backtestPromotionRules'
> {
  backtestPromotionRules?: BacktestPromotionRulesInput;
  expectedUpdatedAt?: string;
}

export interface SettingsAuditItem {
  id: string;
  fieldName: string;
  fieldKey?: keyof UpdateSettingsBody;
  fieldLabel: string;
  changeType: SettingsAuditChangeType;
  oldValue?: SettingsValue;
  newValue?: SettingsValue;
  oldValueType: SettingsValueType;
  newValueType: SettingsValueType;
  oldValueDisplay: string;
  newValueDisplay: string;
  actor?: string;
  changedAt: string;
}

export interface SettingsAuditResponse {
  items: SettingsAuditItem[];
  total: number;
  limit: number;
  offset: number;
}
