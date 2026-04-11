import { Inject, Service } from 'typedi';
import { BadRequestAppError, NotFoundAppError, ServiceUnavailableAppError } from '../../api';
import { Broker, BrokerRepository, Exchange, ExchangeRepository } from '../../database';
import { BrokerRegistry } from './BrokerRegistry';

export interface BrokerDefinitionFieldOption {
  value: string;
  label: string;
}

export interface BrokerDefinitionField {
  key: string;
  label: string;
  type?: string;
  required?: boolean;
  secret?: boolean;
  placeholder?: string;
  helpText?: string;
  options?: BrokerDefinitionFieldOption[];
}

export interface BrokerDefinitionStep {
  title: string;
  description: string;
}

export interface BrokerDefinitionGuide {
  summary?: string;
  steps?: BrokerDefinitionStep[];
  notes?: string[];
  docsUrl?: string;
}

export interface BrokerDefinitionDiagnostics {
  requiresAccount?: boolean;
  executorKey?: string;
  successStatus?: string;
  failureStatus?: string;
  resetStatus?: string;
}

export interface BrokerDefinition {
  id: string;
  brokerId?: string;
  brokerKey: string;
  name: string;
  category: string;
  status: string;
  providerType: string;
  linkedExchangeKey?: string;
  baseUrl?: string;
  capabilities: string[];
  accountFields: BrokerDefinitionField[];
  integrationGuide?: BrokerDefinitionGuide;
  diagnostics?: BrokerDefinitionDiagnostics;
  updatedAt?: string;
  versionToken?: string;
}

type DefinitionLookupOptions = {
  includeInactive?: boolean;
};

const PRIMARY_SYSTEM_BROKER_KEYS = ['binance'] as const;
const SYSTEM_MANAGED_BROKER_KEYS = new Set(['binance', 'binance_market_data']);

@Service()
export class BrokerDefinitionService {
  @Inject(() => BrokerRepository)
  private brokerRepository!: BrokerRepository;

  @Inject(() => ExchangeRepository)
  private exchangeRepository!: ExchangeRepository;

  @Inject(() => BrokerRegistry)
  private brokerRegistry!: BrokerRegistry;

  async getRequiredDefinition(brokerKey: string): Promise<BrokerDefinition> {
    return this.getDefinition(brokerKey, { includeInactive: false });
  }

  async getDefinition(
    brokerKey: string,
    options: DefinitionLookupOptions = {}
  ): Promise<BrokerDefinition> {
    const normalizedBrokerKey = this.normalizeBrokerKey(brokerKey);

    if (!normalizedBrokerKey) {
      throw new BadRequestAppError('brokerKey is required');
    }

    const definition =
      (await this.loadPersistedRuntimeDefinition(normalizedBrokerKey, options)) ||
      (await this.loadSystemDefinition(normalizedBrokerKey, options));

    if (!definition) {
      throw new NotFoundAppError(
        `${options.includeInactive ? 'Broker' : 'Active broker'} definition not found for key: ${normalizedBrokerKey}`
      );
    }

    return definition;
  }

  async getPersistedDefinition(
    brokerKey: string,
    options: DefinitionLookupOptions = {}
  ): Promise<BrokerDefinition> {
    const normalizedBrokerKey = this.normalizeBrokerKey(brokerKey);

    if (!normalizedBrokerKey) {
      throw new BadRequestAppError('brokerKey is required');
    }

    const broker = await this.loadPersistedBroker(normalizedBrokerKey, options);

    if (!broker) {
      throw new NotFoundAppError(
        `${options.includeInactive ? 'Broker' : 'Active broker'} definition not found for key: ${normalizedBrokerKey}`
      );
    }

    return this.validateDefinition(this.mapBrokerDefinition(broker));
  }

  async listActiveDefinitions(): Promise<BrokerDefinition[]> {
    return this.listRuntimeDefinitions({ includeInactive: false });
  }

  async listDefinitions(options: DefinitionLookupOptions = {}): Promise<BrokerDefinition[]> {
    return this.listRuntimeDefinitions(options);
  }

  async listPersistedDefinitions(options: DefinitionLookupOptions = {}): Promise<BrokerDefinition[]> {
    const brokers = options.includeInactive
      ? await this.brokerRepository.listBrokers()
      : await this.brokerRepository.listActiveBrokers();

    return brokers
      .filter((broker) => !this.isSystemManagedBrokerKey(broker.brokerKey))
      .map((broker) => this.validateDefinition(this.mapBrokerDefinition(broker)));
  }

  isSystemManagedBrokerKey(brokerKey?: string | null): boolean {
    return SYSTEM_MANAGED_BROKER_KEYS.has(this.normalizeBrokerKey(brokerKey));
  }

  async validateAccountSettings(
    brokerKey: string,
    settings?: Record<string, unknown> | null
  ): Promise<Record<string, unknown> | undefined> {
    const definition = await this.getRequiredDefinition(brokerKey);
    return this.validateAccountSettingsForDefinition(definition, settings);
  }

  async validateAccountSettingsWithDefinition(
    brokerKey: string,
    settings?: Record<string, unknown> | null
  ): Promise<{ definition: BrokerDefinition; settings?: Record<string, unknown> }> {
    const definition = await this.getRequiredDefinition(brokerKey);
    return {
      definition,
      settings: this.validateAccountSettingsForDefinition(definition, settings),
    };
  }

  validateAccountSettingsForDefinition(
    definition: BrokerDefinition,
    settings?: Record<string, unknown> | null
  ): Record<string, unknown> | undefined {
    const normalizedSettings = this.normalizeSettings(settings);

    for (const field of definition.accountFields) {
      const rawValue = normalizedSettings[field.key];
      const stringValue = typeof rawValue === 'string' ? rawValue.trim() : '';
      const isBaseUrlField = field.key.trim().toLowerCase() === 'baseurl';
      const normalizedFieldType = String(field.type || 'text').trim().toLowerCase();
      const selectOptions = Array.isArray(field.options) ? field.options : [];

      if (
        field.required &&
        !stringValue &&
        !(isBaseUrlField && String(definition.baseUrl || '').trim())
      ) {
        throw new BadRequestAppError(
          `${field.label || field.key} is required for ${definition.name}`
        );
      }

      if (
        stringValue &&
        ['replace-me', 'replace-with-value', 'replace-with-your-value'].includes(
          stringValue.toLowerCase()
        )
      ) {
        throw new BadRequestAppError(
          `${field.label || field.key} contains a placeholder value for ${definition.name}`
        );
      }

      if (
        normalizedFieldType === 'select' &&
        stringValue &&
        selectOptions.length &&
        !selectOptions.some((option) => option.value === stringValue)
      ) {
        throw new BadRequestAppError(
          `${field.label || field.key} must be one of: ${selectOptions
            .map((option) => option.label || option.value)
            .join(', ')}`
        );
      }
    }

    return Object.keys(normalizedSettings).length ? normalizedSettings : undefined;
  }

  private mapBrokerDefinition(broker: Broker): BrokerDefinition {
    const rawAccountConfig = (broker.accountConfig ?? {}) as Record<string, unknown>;
    const rawFields = Array.isArray(rawAccountConfig.fields) ? rawAccountConfig.fields : [];

    return {
      id: broker.id,
      brokerId: broker.id,
      brokerKey: broker.brokerKey,
      name: broker.name,
      category: broker.category,
      status: broker.status,
      providerType: broker.providerType,
      linkedExchangeKey: broker.linkedExchangeKey ?? undefined,
      baseUrl: broker.baseUrl ?? undefined,
      capabilities: Array.isArray(broker.capabilities)
        ? broker.capabilities.map((item) => String(item).trim()).filter(Boolean)
        : [],
      accountFields: rawFields
        .filter((field): field is Record<string, unknown> => Boolean(field) && typeof field === 'object')
        .map((field) => ({
          key: String(field.key ?? '').trim(),
          label: String(field.label ?? field.key ?? '').trim(),
          type: String(field.type ?? 'text').trim(),
          required: Boolean(field.required),
          secret: Boolean(field.secret),
          placeholder: field.placeholder ? String(field.placeholder) : undefined,
          helpText: field.helpText ? String(field.helpText) : undefined,
          options: Array.isArray(field.options)
            ? field.options
                .filter((option): option is Record<string, unknown> => Boolean(option) && typeof option === 'object')
                .map((option) => ({
                  value: String(option.value ?? '').trim(),
                  label: String(option.label ?? option.value ?? '').trim(),
                }))
                .filter((option) => option.value && option.label)
            : undefined,
        }))
        .filter((field) => field.key && field.label),
      integrationGuide:
        broker.integrationGuide && typeof broker.integrationGuide === 'object'
          ? (broker.integrationGuide as BrokerDefinitionGuide)
          : undefined,
      diagnostics:
        broker.diagnosticsConfig && typeof broker.diagnosticsConfig === 'object'
          ? (broker.diagnosticsConfig as BrokerDefinitionDiagnostics)
          : undefined,
      updatedAt: broker.updatedAt?.toISOString(),
      versionToken: broker.updatedAt?.toISOString(),
    };
  }

  private async listRuntimeDefinitions(
    options: DefinitionLookupOptions = {}
  ): Promise<BrokerDefinition[]> {
    const brokers = await this.listPersistedDefinitions(options);
    const definitionsByKey = new Map<string, BrokerDefinition>();

    for (const broker of brokers) {
      const definition = this.toRuntimeDefinition(broker);
      definitionsByKey.set(this.normalizeBrokerKey(definition.brokerKey), definition);
    }

    for (const brokerKey of PRIMARY_SYSTEM_BROKER_KEYS) {
      if (definitionsByKey.has(brokerKey)) {
        continue;
      }

      const definition = await this.loadSystemDefinition(brokerKey, options);
      if (definition) {
        definitionsByKey.set(brokerKey, definition);
      }
    }

    return Array.from(definitionsByKey.values()).sort((left, right) =>
      left.name.localeCompare(right.name)
    );
  }

  private async loadPersistedRuntimeDefinition(
    brokerKey: string,
    options: DefinitionLookupOptions = {}
  ): Promise<BrokerDefinition | null> {
    const broker = await this.loadPersistedBroker(brokerKey, options);

    if (!broker) {
      return null;
    }

    return this.toRuntimeDefinition(this.mapBrokerDefinition(broker));
  }

  private async loadPersistedBroker(
    brokerKey: string,
    options: DefinitionLookupOptions = {}
  ): Promise<Broker | null> {
    if (this.isSystemManagedBrokerKey(brokerKey)) {
      return null;
    }

    return options.includeInactive
      ? this.brokerRepository.getBrokerByKey(brokerKey)
      : this.brokerRepository.getActiveBrokerByKey(brokerKey);
  }

  private async loadSystemDefinition(
    brokerKey: string,
    options: DefinitionLookupOptions = {}
  ): Promise<BrokerDefinition | null> {
    const normalizedBrokerKey = this.normalizeBrokerKey(brokerKey);

    if (normalizedBrokerKey !== 'binance') {
      return null;
    }

    const exchange = await this.exchangeRepository.getExchangeByKey('binance');

    if (!exchange) {
      return null;
    }

    const exchangeStatus = this.normalizeBrokerKey(exchange.status || 'active') || 'active';

    if (!options.includeInactive && exchangeStatus !== 'active') {
      return null;
    }

    return this.validateDefinition(this.buildBinanceMarketDefinition(exchange));
  }

  private buildBinanceMarketDefinition(exchange: Exchange): BrokerDefinition {
    const exchangeName = String(exchange.name || 'Binance').trim() || 'Binance';

    return {
      id: exchange.id,
      brokerKey: 'binance',
      name: `${exchangeName} market data`,
      category: 'feed',
      status: this.normalizeBrokerKey(exchange.status || 'active') || 'active',
      providerType: 'feed',
      linkedExchangeKey: 'binance',
      baseUrl: exchange.baseUrl ?? undefined,
      capabilities: ['diagnostics', 'market'],
      accountFields: [],
      integrationGuide: {
        summary: 'Public futures candles and market-data reachability checks',
      },
      diagnostics: {
        requiresAccount: false,
        executorKey: 'binance-market',
        successStatus: 'Connected',
        failureStatus: 'Disconnected',
        resetStatus: 'Idle',
      },
      updatedAt: exchange.updatedAt?.toISOString(),
      versionToken: exchange.updatedAt?.toISOString(),
    };
  }

  private toRuntimeDefinition(definition: BrokerDefinition): BrokerDefinition {
    const module = this.brokerRegistry.getOptional(definition.brokerKey);

    if (!module) {
      return this.validateDefinition(definition);
    }

    return this.validateDefinition({
      ...definition,
      category: module.category,
      providerType: module.providerType,
      linkedExchangeKey:
        definition.brokerKey === 'delta_exchange' && module.providerType === 'broker'
          ? undefined
          : definition.linkedExchangeKey,
    });
  }

  private normalizeBrokerKey(value?: string | null): string {
    return String(value || '').trim().toLowerCase();
  }

  private validateDefinition(definition: BrokerDefinition): BrokerDefinition {
    if (!definition.brokerKey.trim()) {
      throw new ServiceUnavailableAppError('Broker definition is missing brokerKey');
    }

    if (!definition.name.trim()) {
      throw new ServiceUnavailableAppError(
        `Broker definition is missing name for key: ${definition.brokerKey}`
      );
    }

    if (!definition.category.trim()) {
      throw new ServiceUnavailableAppError(
        `Broker definition is missing category for key: ${definition.brokerKey}`
      );
    }

    if (!definition.providerType.trim()) {
      throw new ServiceUnavailableAppError(
        `Broker definition is missing providerType for key: ${definition.brokerKey}`
      );
    }

    definition.capabilities = definition.capabilities
      .map((capability) => capability.trim())
      .filter(Boolean);

    definition.accountFields = definition.accountFields.map((field) => {
      if (!field.key.trim()) {
        throw new ServiceUnavailableAppError(
          `Broker definition contains an account field without key for broker: ${definition.brokerKey}`
        );
      }

      if (!field.label.trim()) {
        throw new ServiceUnavailableAppError(
          `Broker definition contains an account field without label for broker: ${definition.brokerKey}`
        );
      }

      if (field.options?.length) {
        field.options = field.options
          .map((option) => ({
            value: option.value.trim(),
            label: option.label.trim(),
          }))
          .filter((option) => option.value && option.label);
      }

      return {
        ...field,
        key: field.key.trim(),
        label: field.label.trim(),
        type: field.type?.trim().toLowerCase() || 'text',
        placeholder: field.placeholder?.trim() || undefined,
        helpText: field.helpText?.trim() || undefined,
        options: field.type?.trim().toLowerCase() === 'select' ? field.options : undefined,
      };
    });

    const duplicateKeys = new Set<string>();
    for (const field of definition.accountFields) {
      if (duplicateKeys.has(field.key)) {
        throw new ServiceUnavailableAppError(
          `Broker definition has duplicate account field key "${field.key}" for broker: ${definition.brokerKey}`
        );
      }
      duplicateKeys.add(field.key);
    }

    if (definition.integrationGuide?.steps) {
      definition.integrationGuide.steps = definition.integrationGuide.steps.map((step) => {
        const title = String(step.title || '').trim();
        const description = String(step.description || '').trim();

        if (!title || !description) {
          throw new ServiceUnavailableAppError(
            `Broker definition contains an invalid integration guide step for broker: ${definition.brokerKey}`
          );
        }

        return { title, description };
      });
    }

    if (definition.integrationGuide?.notes) {
      definition.integrationGuide.notes = definition.integrationGuide.notes
        .map((note) => String(note || '').trim())
        .filter(Boolean);
    }

    if (definition.diagnostics) {
      definition.diagnostics = {
        requiresAccount: Boolean(definition.diagnostics.requiresAccount),
        executorKey: definition.diagnostics.executorKey?.trim() || undefined,
        successStatus: definition.diagnostics.successStatus?.trim() || 'Connected',
        failureStatus: definition.diagnostics.failureStatus?.trim() || 'Disconnected',
        resetStatus: definition.diagnostics.resetStatus?.trim() || 'Idle',
      };
    }

    if (definition.providerType === 'exchange' && !definition.linkedExchangeKey?.trim()) {
      throw new ServiceUnavailableAppError(
        `Broker definition is missing linkedExchangeKey for exchange provider: ${definition.brokerKey}`
      );
    }

    if (definition.baseUrl?.trim()) {
      try {
        const parsed = new URL(definition.baseUrl.trim());
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          throw new ServiceUnavailableAppError(
            `Broker definition has invalid baseUrl protocol for key: ${definition.brokerKey}`
          );
        }
        definition.baseUrl = definition.baseUrl.trim().replace(/\/+$/, '');
      } catch {
        throw new ServiceUnavailableAppError(
          `Broker definition has invalid baseUrl for key: ${definition.brokerKey}`
        );
      }
    } else {
      definition.baseUrl = undefined;
    }

    return definition;
  }

  private normalizeSettings(settings?: Record<string, unknown> | null): Record<string, unknown> {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(settings)
        .map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value])
        .filter(([key]) => String(key).trim().length > 0)
    );
  }
}
