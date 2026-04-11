import { BrokerDefinitionUpsertBody } from '../contracts/BrokerDefinition';
import { BadRequestAppError } from '../errors/AppError';

export interface ValidatedBrokerDefinitionFieldOption {
  value: string;
  label: string;
}

export interface ValidatedBrokerDefinitionField {
  key: string;
  label: string;
  type: string;
  required: boolean;
  secret: boolean;
  placeholder?: string;
  helpText?: string;
  options?: ValidatedBrokerDefinitionFieldOption[];
}

export interface ValidatedBrokerDefinitionGuideStep {
  title: string;
  description: string;
}

export interface ValidatedBrokerDefinitionGuide {
  summary?: string;
  steps?: ValidatedBrokerDefinitionGuideStep[];
  notes?: string[];
  docsUrl?: string;
}

export interface ValidatedBrokerDefinitionDiagnostics {
  requiresAccount: boolean;
  executorKey?: string;
  successStatus: string;
  failureStatus: string;
  resetStatus: string;
}

export interface ValidatedBrokerDefinitionUpsertBody {
  brokerKey: string;
  name: string;
  category: string;
  status: string;
  providerType: string;
  linkedExchangeKey?: string;
  baseUrl?: string;
  capabilities: string[];
  accountFields: ValidatedBrokerDefinitionField[];
  integrationGuide?: ValidatedBrokerDefinitionGuide;
  diagnostics?: ValidatedBrokerDefinitionDiagnostics;
  expectedUpdatedAt?: string | null;
}

const SUPPORTED_ACCOUNT_FIELD_TYPES = new Set(['text', 'secret', 'url', 'select']);
const BROKER_KEY_PATTERN = /^[a-z0-9_][a-z0-9_-]{1,79}$/i;
const FIELD_KEY_PATTERN = /^[a-z0-9_]{2,80}$/i;

const normalizeRequired = (value: string | undefined, field: string): string => {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw new BadRequestAppError(`${field} is required`);
  }
  return normalized;
};

const normalizeOptional = (value?: string): string | undefined => {
  const normalized = String(value || '').trim();
  return normalized || undefined;
};

const normalizeExpectedUpdatedAt = (value?: string | null): string | null | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    throw new BadRequestAppError('expectedUpdatedAt must be an ISO timestamp or null');
  }

  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new BadRequestAppError('expectedUpdatedAt must be an ISO timestamp or null');
  }

  return parsed.toISOString();
};

const normalizeOptionalUrl = (value?: string, field = 'baseUrl'): string | undefined => {
  const normalized = normalizeOptional(value);
  if (!normalized) {
    return undefined;
  }

  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new BadRequestAppError(`${field} must be a valid URL`);
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new BadRequestAppError(`${field} must use http or https`);
  }

  return normalized.replace(/\/+$/, '');
};

const normalizeBrokerKey = (value: string | undefined, field: string): string => {
  const normalized = normalizeRequired(value, field);
  if (!BROKER_KEY_PATTERN.test(normalized)) {
    throw new BadRequestAppError(
      `${field} must use letters, numbers, underscores, or hyphens`
    );
  }
  return normalized.toLowerCase();
};

const normalizeFieldKey = (value: string | undefined, field: string): string => {
  const normalized = normalizeRequired(value, field);
  if (!FIELD_KEY_PATTERN.test(normalized)) {
    throw new BadRequestAppError(
      `${field} must use letters, numbers, or underscores`
    );
  }
  return normalized.toLowerCase();
};

export const validateBrokerDefinitionUpsertBody = (
  body: BrokerDefinitionUpsertBody = {}
): ValidatedBrokerDefinitionUpsertBody => {
  const expectedUpdatedAt = normalizeExpectedUpdatedAt(body.expectedUpdatedAt);
  const brokerKey = normalizeBrokerKey(body.brokerKey, 'brokerKey');
  const name = normalizeRequired(body.name, 'name');
  const category = normalizeRequired(body.category, 'category').toLowerCase();
  const status = normalizeRequired(body.status, 'status').toLowerCase();
  const providerType = normalizeRequired(body.providerType, 'providerType').toLowerCase();
  const linkedExchangeKey = normalizeOptional(body.linkedExchangeKey)?.toLowerCase();
  const baseUrl = normalizeOptionalUrl(body.baseUrl, 'baseUrl');

  if (!['broker', 'exchange', 'feed'].includes(category)) {
    throw new BadRequestAppError('category must be broker, exchange, or feed');
  }

  if (!['active', 'inactive'].includes(status)) {
    throw new BadRequestAppError('status must be active or inactive');
  }

  if (!['broker', 'exchange', 'feed'].includes(providerType)) {
    throw new BadRequestAppError('providerType must be broker, exchange, or feed');
  }

  if (providerType === 'exchange' && !linkedExchangeKey) {
    throw new BadRequestAppError('linkedExchangeKey is required when providerType is exchange');
  }

  const capabilities = Array.isArray(body.capabilities)
    ? body.capabilities
        .map((item) => String(item || '').trim().toLowerCase())
        .filter(Boolean)
    : [];

  const dedupedCapabilities = Array.from(new Set(capabilities));

  if (!dedupedCapabilities.length) {
    throw new BadRequestAppError('capabilities must include at least one capability');
  }

  const accountFields = Array.isArray(body.accountFields)
    ? body.accountFields.map((field, index) => {
        const key = normalizeFieldKey(field?.key, `accountFields[${index}].key`);
        const label = normalizeRequired(field?.label, `accountFields[${index}].label`);
        const type = (normalizeOptional(field?.type) || 'text').toLowerCase();
        const options = Array.isArray(field?.options)
          ? field.options.map((option, optionIndex) => ({
              value: normalizeRequired(option?.value, `accountFields[${index}].options[${optionIndex}].value`),
              label: normalizeRequired(option?.label, `accountFields[${index}].options[${optionIndex}].label`),
            }))
          : undefined;
        const dedupedOptionValues = new Set<string>();

        if (!SUPPORTED_ACCOUNT_FIELD_TYPES.has(type)) {
          throw new BadRequestAppError(
            `accountFields[${index}].type must be text, secret, url, or select`
          );
        }

        if (type === 'select' && !options?.length) {
          throw new BadRequestAppError(
            `accountFields[${index}].options must include at least one option when type is select`
          );
        }

        if (type !== 'select' && options?.length) {
          throw new BadRequestAppError(
            `accountFields[${index}].options are only supported when type is select`
          );
        }

        if (type === 'select' && Boolean(field?.secret)) {
          throw new BadRequestAppError(
            `accountFields[${index}].secret is not supported when type is select`
          );
        }

        for (const option of options ?? []) {
          if (dedupedOptionValues.has(option.value)) {
            throw new BadRequestAppError(
              `Duplicate option value "${option.value}" for accountFields[${index}]`
            );
          }
          dedupedOptionValues.add(option.value);
        }

        return {
          key,
          label,
          type,
          required: Boolean(field?.required),
          secret: type === 'secret' || Boolean(field?.secret),
          placeholder: normalizeOptional(field?.placeholder),
          helpText: normalizeOptional(field?.helpText),
          options: type === 'select' && options?.length ? options : undefined,
        };
      })
    : [];

  const fieldKeys = new Set<string>();
  for (const field of accountFields) {
    if (fieldKeys.has(field.key)) {
      throw new BadRequestAppError(`Duplicate account field key: ${field.key}`);
    }
    fieldKeys.add(field.key);
  }

  const integrationGuide =
    body.integrationGuide && typeof body.integrationGuide === 'object'
      ? {
          summary: normalizeOptional(body.integrationGuide.summary),
          steps: Array.isArray(body.integrationGuide.steps)
            ? body.integrationGuide.steps.map((step, index) => ({
                title: normalizeRequired(step?.title, `integrationGuide.steps[${index}].title`),
                description: normalizeRequired(
                  step?.description,
                  `integrationGuide.steps[${index}].description`
                ),
              }))
            : undefined,
          notes: Array.isArray(body.integrationGuide.notes)
            ? body.integrationGuide.notes
                .map((note) => String(note || '').trim())
                .filter(Boolean)
            : undefined,
          docsUrl: normalizeOptionalUrl(body.integrationGuide.docsUrl, 'integrationGuide.docsUrl'),
        }
      : undefined;

  const diagnostics =
    body.diagnostics && typeof body.diagnostics === 'object'
      ? {
          requiresAccount: Boolean(body.diagnostics.requiresAccount),
          executorKey: normalizeOptional(body.diagnostics.executorKey),
          successStatus: normalizeOptional(body.diagnostics.successStatus) || 'Connected',
          failureStatus: normalizeOptional(body.diagnostics.failureStatus) || 'Disconnected',
          resetStatus: normalizeOptional(body.diagnostics.resetStatus) || 'Idle',
        }
      : undefined;

  return {
    brokerKey,
    name,
    category,
    status,
    providerType,
    linkedExchangeKey,
    baseUrl,
    capabilities: dedupedCapabilities,
    accountFields,
    integrationGuide,
    diagnostics,
    expectedUpdatedAt,
  };
};
