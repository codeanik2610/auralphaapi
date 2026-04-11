export type SettingsNotificationChannel = 'both' | 'in-app' | 'email' | 'disabled';
export type SettingsNotificationSeverity = 'all' | 'medium' | 'high' | 'critical';
export type SettingsEscalationRoute = 'risk-review' | 'on-call' | 'manual';
export type SettingsValue = string | boolean | number | null;
export type SettingsValueType = 'string' | 'boolean' | 'number' | 'null';
export type SettingsAuditChangeType = 'created' | 'updated' | 'cleared';

export interface SettingsResponse {
  executionMode: string;
  scope: 'user';
  ownerUserId: string;
  hasSavedSettings: boolean;
  timezone: string;
  notifyEmail: boolean;
  notifyInApp: boolean;
  confirmDestructive: boolean;
  notificationChannel: SettingsNotificationChannel;
  notificationSeverity: SettingsNotificationSeverity;
  escalationRoute: SettingsEscalationRoute;
  escalationSlaMinutes: number;
  updatedAt?: string;
  versionToken?: string;
}

export interface UpdateSettingsBody {
  timezone: string;
  notifyEmail: boolean;
  notifyInApp: boolean;
  confirmDestructive: boolean;
  notificationChannel: SettingsNotificationChannel;
  notificationSeverity: SettingsNotificationSeverity;
  escalationRoute: SettingsEscalationRoute;
  escalationSlaMinutes: number;
}

export interface UpdateSettingsRequestBody extends Partial<UpdateSettingsBody> {
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
