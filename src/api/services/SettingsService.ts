import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import {
  BacktestPromotionRules,
  SettingsAuditChangeType,
  SettingsAuditItem,
  SettingsAuditResponse,
  SettingsResponse,
  SettingsValue,
  SettingsValueType,
  UpdateSettingsBody,
  UpdateSettingsRequestBody
} from '../contracts/Settings';
import { successResponse } from '../utils/response';
import { ActivityLog, AppSetting, AppSettingsRepository, SettingsAuditLog, SettingsAuditRepository } from '../../database';
import { OperationalEventService } from './OperationalEventService';
import { validateSettingsAuditQuery, validateUpdateSettingsBody } from '../validators/settings.validator';
import { DEFAULT_TIMEZONE, normalizeTimeZone } from '../utils/timezone';
import { env } from '../../env';
import { coreDataSource } from '../../database/data-source';
import { BadRequestAppError, ConflictAppError } from '../errors/AppError';
import {
  createDefaultBacktestPromotionRules,
  formatBacktestPromotionRulesForDisplay,
  resolveBacktestPromotionRules,
} from '../utils/backtestPromotionRules';

type SettingsFieldKey = keyof UpdateSettingsBody;
type PromotionRuleFieldKey = keyof BacktestPromotionRules;
type PromotionRuleAuditFieldName = `backtestPromotionRules.${PromotionRuleFieldKey}`;
type SettingsAuditFieldName = SettingsFieldKey | PromotionRuleAuditFieldName;

type SettingsAuditEntry = {
  fieldName: SettingsAuditFieldName;
  oldValue: SettingsValue;
  newValue: SettingsValue;
};

type SettingsFieldMetadata = {
  label: string;
  valueType: Exclude<SettingsValueType, 'null'>;
};

type SerializedAuditValue = {
  value: SettingsValue;
  valueType: SettingsValueType;
  text: string | null;
  json: SettingsValue;
};

const SETTINGS_FIELD_KEYS: SettingsFieldKey[] = [
  'timezone',
  'notifyEmail',
  'notifyInApp',
  'confirmDestructive',
  'notificationChannel',
  'notificationSeverity',
  'escalationRoute',
  'escalationSlaMinutes',
  'backtestPromotionRules',
];

const BACKTEST_PROMOTION_RULE_FIELD_METADATA: Record<
  PromotionRuleFieldKey,
  {
    label: string;
    valueType: Exclude<SettingsValueType, 'json' | 'null'>;
  }
> = {
  minScore: { label: 'Promotion rule: Minimum score', valueType: 'number' },
  minTrades: { label: 'Promotion rule: Minimum trades', valueType: 'number' },
  requireCompleteHistory: {
    label: 'Promotion rule: Complete history gate',
    valueType: 'boolean',
  },
  requireLineage: { label: 'Promotion rule: Lineage gate', valueType: 'boolean' },
  requireTemplateAutomationReady: {
    label: 'Promotion rule: Template automation-ready gate',
    valueType: 'boolean',
  },
  requireRobustness: {
    label: 'Promotion rule: Robustness validation gate',
    valueType: 'boolean',
  },
  requiredRobustnessModel: {
    label: 'Promotion rule: Required robustness model',
    valueType: 'string',
  },
  minPortfolioPressureScore: {
    label: 'Promotion rule: Minimum portfolio pressure score',
    valueType: 'number',
  },
  minExecutedTradeRatio: {
    label: 'Promotion rule: Minimum executed trade ratio',
    valueType: 'number',
  },
  blockCapitalDepletionRisk: {
    label: 'Promotion rule: Capital depletion risk block',
    valueType: 'boolean',
  },
};

const SETTINGS_FIELD_METADATA: Record<SettingsAuditFieldName, SettingsFieldMetadata> = {
  timezone: { label: 'Time zone', valueType: 'string' },
  notifyEmail: { label: 'Email notifications', valueType: 'boolean' },
  notifyInApp: { label: 'In-app notifications', valueType: 'boolean' },
  confirmDestructive: { label: 'Confirm destructive actions', valueType: 'boolean' },
  notificationChannel: { label: 'Default channel', valueType: 'string' },
  notificationSeverity: { label: 'Minimum severity', valueType: 'string' },
  escalationRoute: { label: 'Escalation route', valueType: 'string' },
  escalationSlaMinutes: { label: 'Escalation SLA (minutes)', valueType: 'number' },
  backtestPromotionRules: { label: 'Backtests promotion rules', valueType: 'json' },
  'backtestPromotionRules.minScore': BACKTEST_PROMOTION_RULE_FIELD_METADATA.minScore,
  'backtestPromotionRules.minTrades': BACKTEST_PROMOTION_RULE_FIELD_METADATA.minTrades,
  'backtestPromotionRules.requireCompleteHistory':
    BACKTEST_PROMOTION_RULE_FIELD_METADATA.requireCompleteHistory,
  'backtestPromotionRules.requireLineage':
    BACKTEST_PROMOTION_RULE_FIELD_METADATA.requireLineage,
  'backtestPromotionRules.requireTemplateAutomationReady':
    BACKTEST_PROMOTION_RULE_FIELD_METADATA.requireTemplateAutomationReady,
  'backtestPromotionRules.requireRobustness':
    BACKTEST_PROMOTION_RULE_FIELD_METADATA.requireRobustness,
  'backtestPromotionRules.requiredRobustnessModel':
    BACKTEST_PROMOTION_RULE_FIELD_METADATA.requiredRobustnessModel,
  'backtestPromotionRules.minPortfolioPressureScore':
    BACKTEST_PROMOTION_RULE_FIELD_METADATA.minPortfolioPressureScore,
  'backtestPromotionRules.minExecutedTradeRatio':
    BACKTEST_PROMOTION_RULE_FIELD_METADATA.minExecutedTradeRatio,
  'backtestPromotionRules.blockCapitalDepletionRisk':
    BACKTEST_PROMOTION_RULE_FIELD_METADATA.blockCapitalDepletionRisk,
};

const SETTINGS_OPTION_DISPLAY: Partial<Record<SettingsAuditFieldName, Record<string, string>>> = {
  notificationChannel: {
    both: 'In-app + Email',
    'in-app': 'In-app only',
    email: 'Email only',
    disabled: 'Disabled',
  },
  notificationSeverity: {
    all: 'All',
    medium: 'Medium and above',
    high: 'High and above',
    critical: 'Critical only',
  },
  escalationRoute: {
    'risk-review': 'Risk review',
    'on-call': 'On-call engineer',
    manual: 'Manual triage',
  },
  'backtestPromotionRules.requireCompleteHistory': {
    true: 'Required',
    false: 'Optional',
  },
  'backtestPromotionRules.requireLineage': {
    true: 'Required',
    false: 'Optional',
  },
  'backtestPromotionRules.requireTemplateAutomationReady': {
    true: 'Required',
    false: 'Optional',
  },
  'backtestPromotionRules.requireRobustness': {
    true: 'Required',
    false: 'Optional',
  },
  'backtestPromotionRules.blockCapitalDepletionRisk': {
    true: 'Blocked',
    false: 'Allowed',
  },
};

function isSettingsFieldKey(fieldName: string): fieldName is SettingsFieldKey {
  return SETTINGS_FIELD_KEYS.includes(fieldName as SettingsFieldKey);
}

function isPromotionRuleFieldKey(fieldName: string): fieldName is PromotionRuleFieldKey {
  return Object.prototype.hasOwnProperty.call(BACKTEST_PROMOTION_RULE_FIELD_METADATA, fieldName);
}

function getPromotionRuleAuditFieldName(
  fieldName: PromotionRuleFieldKey
): PromotionRuleAuditFieldName {
  return `backtestPromotionRules.${fieldName}`;
}

function buildSettingsDefaults(existing: AppSetting | null): UpdateSettingsBody {
  return {
    timezone: existing ? existing.timezone : DEFAULT_TIMEZONE,
    notifyEmail: existing ? existing.notifyEmail : true,
    notifyInApp: existing ? existing.notifyInApp : true,
    confirmDestructive: existing ? existing.confirmDestructive : true,
    notificationChannel: existing ? existing.notificationChannel : 'both',
    notificationSeverity: existing ? existing.notificationSeverity : 'all',
    escalationRoute: existing ? existing.escalationRoute : 'risk-review',
    escalationSlaMinutes: existing ? existing.escalationSlaMinutes : 15,
    backtestPromotionRules: resolveBacktestPromotionRules(existing?.backtestPromotionRules),
  };
}

function buildSettingsAuditEntries(existing: AppSetting | null, settings: AppSetting): SettingsAuditEntry[] {
  return [
    { fieldName: 'timezone', oldValue: existing ? existing.timezone : null, newValue: settings.timezone },
    { fieldName: 'notifyEmail', oldValue: existing ? existing.notifyEmail : null, newValue: settings.notifyEmail },
    { fieldName: 'notifyInApp', oldValue: existing ? existing.notifyInApp : null, newValue: settings.notifyInApp },
    { fieldName: 'confirmDestructive', oldValue: existing ? existing.confirmDestructive : null, newValue: settings.confirmDestructive },
    { fieldName: 'notificationChannel', oldValue: existing ? existing.notificationChannel : null, newValue: settings.notificationChannel },
    { fieldName: 'notificationSeverity', oldValue: existing ? existing.notificationSeverity : null, newValue: settings.notificationSeverity },
    { fieldName: 'escalationRoute', oldValue: existing ? existing.escalationRoute : null, newValue: settings.escalationRoute },
    { fieldName: 'escalationSlaMinutes', oldValue: existing ? existing.escalationSlaMinutes : null, newValue: settings.escalationSlaMinutes },
  ];
}

function buildBacktestPromotionRuleAuditEntries(
  existing: AppSetting | null,
  settings: AppSetting,
  providedPromotionRuleFields: Set<PromotionRuleFieldKey>
): SettingsAuditEntry[] {
  if (!providedPromotionRuleFields.size) {
    return [];
  }

  const previousRules = existing
    ? resolveBacktestPromotionRules(existing.backtestPromotionRules)
    : null;
  const nextRules = resolveBacktestPromotionRules(settings.backtestPromotionRules);

  return Array.from(providedPromotionRuleFields).map((fieldName) => ({
    fieldName: getPromotionRuleAuditFieldName(fieldName),
    oldValue: previousRules ? previousRules[fieldName] : null,
    newValue: nextRules[fieldName],
  }));
}

function settingsValuesEqual(left: SettingsValue, right: SettingsValue): boolean {
  if (left === right) {
    return true;
  }

  if (left === null || right === null) {
    return false;
  }

  if (typeof left === 'object' && typeof right === 'object') {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  return false;
}

function filterChangedSettingsAuditEntries(
  existing: AppSetting | null,
  settings: AppSetting,
  providedFields: Set<SettingsFieldKey>,
  providedPromotionRuleFields: Set<PromotionRuleFieldKey>
): SettingsAuditEntry[] {
  const entries = [
    ...buildSettingsAuditEntries(existing, settings).filter((entry) =>
      providedFields.has(entry.fieldName as SettingsFieldKey)
    ),
    ...buildBacktestPromotionRuleAuditEntries(
      existing,
      settings,
      providedPromotionRuleFields
    ),
  ];

  return entries.filter((entry) => {
    if (!existing) {
      return true;
    }

    return !settingsValuesEqual(entry.oldValue, entry.newValue);
  });
}

function getSettingsFieldLabel(fieldName: string): string {
  return SETTINGS_FIELD_METADATA[fieldName as SettingsAuditFieldName]?.label
    || fieldName
    || 'Setting';
}

function getSettingsFieldValueType(fieldName: string): Exclude<SettingsValueType, 'null'> {
  return SETTINGS_FIELD_METADATA[fieldName as SettingsAuditFieldName]?.valueType || 'string';
}

function coerceSettingsValue(fieldName: string, value: unknown): SettingsValue {
  if (value === null || value === undefined) {
    return null;
  }

  switch (getSettingsFieldValueType(fieldName)) {
    case 'boolean': {
      if (typeof value === 'boolean') {
        return value;
      }
      const normalized = String(value).trim().toLowerCase();
      if (normalized === 'true') {
        return true;
      }
      if (normalized === 'false') {
        return false;
      }
      return Boolean(value);
    }
    case 'number': {
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    case 'json': {
      return resolveBacktestPromotionRules(value);
    }
    case 'string':
    default:
      return String(value);
  }
}

function deriveSettingsValueType(fieldName: string, value: SettingsValue): SettingsValueType {
  if (value === null) {
    return 'null';
  }
  return getSettingsFieldValueType(fieldName);
}

function serializeAuditValue(fieldName: string, value: unknown): SerializedAuditValue {
  const normalizedValue = coerceSettingsValue(fieldName, value);
  const valueType = deriveSettingsValueType(fieldName, normalizedValue);
  return {
    value: normalizedValue,
    valueType,
    text:
      normalizedValue === null
        ? null
        : typeof normalizedValue === 'object'
          ? JSON.stringify(normalizedValue)
          : String(normalizedValue),
    json: normalizedValue,
  };
}

function deriveAuditChangeType(
  oldValue: SettingsValue,
  newValue: SettingsValue
): SettingsAuditChangeType {
  if (oldValue === null && newValue !== null) {
    return 'created';
  }
  if (oldValue !== null && newValue === null) {
    return 'cleared';
  }
  return 'updated';
}

function resolveStoredAuditValue(
  fieldName: string,
  legacyValue: string | null,
  jsonValue: SettingsAuditLog['oldValueJson'],
  storedType: string | null
): SettingsValue {
  if (storedType === 'null') {
    return null;
  }
  if (jsonValue !== undefined && jsonValue !== null) {
    return coerceSettingsValue(fieldName, jsonValue);
  }
  if (legacyValue !== null && legacyValue !== undefined) {
    return coerceSettingsValue(fieldName, legacyValue);
  }
  return null;
}

function resolveStoredAuditValueType(
  fieldName: string,
  value: SettingsValue,
  storedType: string | null
): SettingsValueType {
  if (
    storedType === 'string' ||
    storedType === 'boolean' ||
    storedType === 'number' ||
    storedType === 'json' ||
    storedType === 'null'
  ) {
    return storedType;
  }
  return deriveSettingsValueType(fieldName, value);
}

function resolveStoredAuditChangeType(
  changeType: string | null,
  oldValue: SettingsValue,
  newValue: SettingsValue
): SettingsAuditChangeType {
  if (changeType === 'created' || changeType === 'updated' || changeType === 'cleared') {
    return changeType;
  }
  return deriveAuditChangeType(oldValue, newValue);
}

function formatSettingsValueForDisplay(fieldName: string, value: SettingsValue): string {
  if (value === null) {
    return '—';
  }

  if (typeof value === 'object') {
    if (fieldName === 'backtestPromotionRules') {
      return formatBacktestPromotionRulesForDisplay(resolveBacktestPromotionRules(value));
    }

    return JSON.stringify(value);
  }

  if (typeof value === 'boolean') {
    const mappedDisplay =
      SETTINGS_OPTION_DISPLAY[fieldName as SettingsAuditFieldName]?.[String(value)];
    return mappedDisplay || (value ? 'Enabled' : 'Disabled');
  }

  if (typeof value === 'number') {
    if (
      fieldName === 'backtestPromotionRules.minScore' ||
      fieldName === 'backtestPromotionRules.minPortfolioPressureScore' ||
      fieldName === 'backtestPromotionRules.minExecutedTradeRatio'
    ) {
      return value.toFixed(2);
    }
    return String(value);
  }

  const mappedDisplay =
    SETTINGS_OPTION_DISPLAY[fieldName as SettingsFieldKey]?.[String(value)];
  return mappedDisplay || String(value);
}

function mapSettingsAuditItem(item: SettingsAuditLog): SettingsAuditItem {
  const fieldName = String(item.fieldName || '').trim();
  const oldValue = resolveStoredAuditValue(
    fieldName,
    item.oldValue,
    item.oldValueJson,
    item.oldValueType
  );
  const newValue = resolveStoredAuditValue(
    fieldName,
    item.newValue,
    item.newValueJson,
    item.newValueType
  );
  const oldValueType = resolveStoredAuditValueType(fieldName, oldValue, item.oldValueType);
  const newValueType = resolveStoredAuditValueType(fieldName, newValue, item.newValueType);

  return {
    id: item.id,
    fieldName,
    fieldKey: isSettingsFieldKey(fieldName) ? fieldName : undefined,
    fieldLabel: getSettingsFieldLabel(fieldName),
    changeType: resolveStoredAuditChangeType(item.changeType, oldValue, newValue),
    oldValue,
    newValue,
    oldValueType,
    newValueType,
    oldValueDisplay: formatSettingsValueForDisplay(fieldName, oldValue),
    newValueDisplay: formatSettingsValueForDisplay(fieldName, newValue),
    actor: item.actor || undefined,
    changedAt: item.createdAt.toISOString(),
  };
}

function normalizeExpectedUpdatedAt(expectedUpdatedAt?: string): string | undefined {
  if (expectedUpdatedAt === undefined) {
    return undefined;
  }

  if (typeof expectedUpdatedAt !== 'string') {
    throw new BadRequestAppError('expectedUpdatedAt must be an ISO timestamp');
  }

  const parsed = new Date(expectedUpdatedAt);
  if (!Number.isFinite(parsed.getTime())) {
    throw new BadRequestAppError('expectedUpdatedAt must be an ISO timestamp');
  }

  return parsed.toISOString();
}

function getHttpErrorCode(error: unknown): number | undefined {
  if (!error || typeof error !== 'object' || !('httpCode' in error)) {
    return undefined;
  }

  const { httpCode } = error as { httpCode?: unknown };
  return typeof httpCode === 'number' ? httpCode : undefined;
}

function mapSettingsResponse(userId: string, settings: AppSetting): SettingsResponse {
  const updatedAt = settings.updatedAt.toISOString();
  return {
    executionMode: env.app.environment,
    scope: 'user',
    ownerUserId: userId,
    hasSavedSettings: true,
    timezone: normalizeTimeZone(settings.timezone),
    notifyEmail: settings.notifyEmail,
    notifyInApp: settings.notifyInApp,
    confirmDestructive: settings.confirmDestructive,
    notificationChannel: settings.notificationChannel,
    notificationSeverity: settings.notificationSeverity,
    escalationRoute: settings.escalationRoute,
    escalationSlaMinutes: settings.escalationSlaMinutes,
    backtestPromotionRules: resolveBacktestPromotionRules(settings.backtestPromotionRules),
    updatedAt,
    versionToken: updatedAt,
  };
}

@Service()
export class SettingsService {
  @Inject(() => AppSettingsRepository)
  private appSettingsRepository!: AppSettingsRepository;

  @Inject(() => SettingsAuditRepository)
  private settingsAuditRepository!: SettingsAuditRepository;

  @Inject(() => OperationalEventService)
  private operationalEventService!: OperationalEventService;

  async getSettings(userId: string): Promise<ApiSuccessResponse<SettingsResponse>> {
    const settings = await this.appSettingsRepository.getSettings(userId);
    if (settings) {
      return successResponse(mapSettingsResponse(userId, settings));
    }

    return successResponse({
      executionMode: env.app.environment,
      scope: 'user',
      ownerUserId: userId,
      hasSavedSettings: false,
      timezone: normalizeTimeZone(DEFAULT_TIMEZONE),
      notifyEmail: true,
      notifyInApp: true,
      confirmDestructive: true,
      notificationChannel: 'both',
      notificationSeverity: 'all',
      escalationRoute: 'risk-review',
      escalationSlaMinutes: 15,
      backtestPromotionRules: createDefaultBacktestPromotionRules(),
      updatedAt: undefined,
      versionToken: undefined
    });
  }

  async getSettingsAudit(userId: string, query: { limit?: string; offset?: string }): Promise<ApiSuccessResponse<SettingsAuditResponse>> {
    const params = validateSettingsAuditQuery(query);
    const { items, total } = await this.settingsAuditRepository.listAuditLogs(userId, params);
    return successResponse({
      items: items.map((item): SettingsAuditItem => mapSettingsAuditItem(item)),
      total,
      limit: params.limit,
      offset: params.offset
    });
  }

  async updateSettings(userId: string, body: UpdateSettingsRequestBody = {}): Promise<ApiSuccessResponse<SettingsResponse>> {
    try {
      const { expectedUpdatedAt, ...settingsBody } = body || {};
      const normalizedExpectedUpdatedAt = normalizeExpectedUpdatedAt(expectedUpdatedAt);
      const providedFields = new Set<keyof UpdateSettingsBody>(Object.keys(settingsBody) as Array<keyof UpdateSettingsBody>);
      const providedPromotionRuleFields = new Set<PromotionRuleFieldKey>(
        isSettingsFieldKey('backtestPromotionRules') &&
        settingsBody.backtestPromotionRules &&
        typeof settingsBody.backtestPromotionRules === 'object' &&
        !Array.isArray(settingsBody.backtestPromotionRules)
          ? Object.keys(settingsBody.backtestPromotionRules).filter((fieldName) =>
              isPromotionRuleFieldKey(fieldName)
            ) as PromotionRuleFieldKey[]
          : []
      );
      const settings = await coreDataSource.transaction(async (manager) => {
        const appSettingsRepository = manager.getRepository(AppSetting);
        const settingsAuditRepository = manager.getRepository(SettingsAuditLog);
        const activityRepository = manager.getRepository(ActivityLog);

        const existing = await appSettingsRepository.findOne({ where: { userId } });
        if (
          normalizedExpectedUpdatedAt &&
          (!existing || existing.updatedAt.toISOString() !== normalizedExpectedUpdatedAt)
        ) {
          throw new ConflictAppError('Settings were updated elsewhere. Refresh and try again.');
        }

        const payload = validateUpdateSettingsBody(settingsBody, buildSettingsDefaults(existing));
        const candidateSettings = existing
          ? ({ ...existing, ...payload } as AppSetting)
          : appSettingsRepository.create({ userId, ...payload });
        const changedEntries = filterChangedSettingsAuditEntries(
          existing,
          candidateSettings,
          providedFields,
          providedPromotionRuleFields
        );

        if (existing && changedEntries.length === 0) {
          return existing;
        }

        const savedSettings = await appSettingsRepository.save(
          existing
            ? appSettingsRepository.merge(existing, payload)
            : appSettingsRepository.create({ userId, ...payload })
        );
        const auditLogs = changedEntries.map((entry) => {
            const oldValue = serializeAuditValue(entry.fieldName, entry.oldValue);
            const newValue = serializeAuditValue(entry.fieldName, entry.newValue);
            return settingsAuditRepository.create({
              userId,
              fieldName: entry.fieldName,
              oldValue: oldValue.text,
              oldValueType: oldValue.valueType,
              oldValueJson: oldValue.json,
              newValue: newValue.text,
              newValueType: newValue.valueType,
              newValueJson: newValue.json,
              changeType: deriveAuditChangeType(oldValue.value, newValue.value),
              actor: userId,
            })
          });

        if (auditLogs.length > 0) {
          await settingsAuditRepository.save(auditLogs);
        }

        await activityRepository.save(
          activityRepository.create({
            userId,
            type: 'Settings',
            title: 'User settings updated',
            status: 'Success',
            actor: userId,
            route: 'Settings',
            stream: 'Controls',
            related: 'app_settings',
            description: 'Updated personal preferences settings',
          })
        );

        return savedSettings;
      });

      return successResponse(mapSettingsResponse(userId, settings));
    } catch (error) {
      await this.operationalEventService.logActivity(userId, {
        type: 'Settings',
        title: 'User settings update failed',
        status: 'Failed',
        route: 'Settings',
        stream: 'Controls',
        related: 'app_settings',
        description: error instanceof Error ? error.message : String(error),
      });
      const httpCode = getHttpErrorCode(error);
      const isClientError = httpCode !== undefined && httpCode >= 400 && httpCode < 500;
      if (!isClientError) {
        await this.operationalEventService.emitFailureAlert(
          userId,
          {
            channel: 'Settings',
            source: 'app_settings',
            message: `User settings update failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
            route: 'Risk review',
          }
        );
      }
      throw error;
    }
  }
}
