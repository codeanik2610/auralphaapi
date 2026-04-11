import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import {
  BrokerAccountHealthCheckItem,
  BrokerAccountHealthCheckResponse,
  BrokerAccountItem,
  BrokerAccountDeleteResult,
  BrokerAccountTestConfigResult,
  BrokerAccountsListResponse,
  BrokerAccountUpsertBody,
} from '../contracts/BrokerAccount';
import { BadRequestAppError, NotFoundAppError } from '../errors/AppError';
import { successResponse } from '../utils/response';
import {
  BrokerAccountsQuery,
  validateBrokerAccountId,
  validateBrokerAccountsQuery,
  validateBrokerAccountUpsertBody,
} from '../validators/brokerAccounts.validator';
import { BrokerAccountRepository } from '../../database';
import { ConnectionRepository } from '../../database';
import { BrokerAccount } from '../../database';
import { Connection } from '../../database';
import { BrokerDiagnosticsService, BrokerDefinition, BrokerDefinitionService } from '../../brokers';
import { MudrexHttpClient } from '../../brokers/providers/mudrex/MudrexHttpClient';
import { DeltaExchangeHttpClient } from '../../brokers/providers/delta_exchange/DeltaExchangeHttpClient';
import {
  createBrokerAccountSecretKeySet,
  decryptBrokerAccountSettings,
  encryptBrokerAccountSettings,
  normalizeBrokerAccountSettingKey,
} from '../../lib/brokerAccountSecrets';
import { OperationalEventService } from './OperationalEventService';

@Service()
export class BrokerAccountsService {
  @Inject(() => BrokerAccountRepository)
  private brokerAccountRepository!: BrokerAccountRepository;

  @Inject(() => ConnectionRepository)
  private connectionRepository!: ConnectionRepository;

  @Inject(() => BrokerDefinitionService)
  private brokerDefinitionService!: BrokerDefinitionService;

  @Inject(() => BrokerDiagnosticsService)
  private brokerDiagnosticsService!: BrokerDiagnosticsService;

  @Inject(() => MudrexHttpClient)
  private mudrexHttpClient!: MudrexHttpClient;

  @Inject(() => DeltaExchangeHttpClient)
  private deltaExchangeHttpClient!: DeltaExchangeHttpClient;

  @Inject(() => OperationalEventService)
  private operationalEventService!: OperationalEventService;

  async getBrokerAccounts(
    userId: string,
    query: BrokerAccountsQuery
  ): Promise<ApiSuccessResponse<BrokerAccountsListResponse>> {
    const params = validateBrokerAccountsQuery(query);
    const { items, total } = await this.brokerAccountRepository.listBrokerAccounts(userId, params);
    return successResponse({
      items: await this.mapBrokerAccounts(items),
      total,
      limit: params.limit,
      offset: params.offset,
    });
  }

  async getBrokerAccountItemById(
    userId: string,
    accountId: string
  ): Promise<BrokerAccountItem | null> {
    const normalizedAccountId = String(accountId || '').trim();

    if (!normalizedAccountId) {
      return null;
    }

    const item = await this.brokerAccountRepository.getBrokerAccountById(
      userId,
      normalizedAccountId
    );

    if (!item) {
      return null;
    }

    const sensitiveSettingKeysByBrokerKey = await this.getSensitiveSettingKeysByBrokerKey([
      item.brokerKey,
    ]);

    return this.mapBrokerAccount(
      item,
      sensitiveSettingKeysByBrokerKey.get(this.normalizeBrokerKey(item.brokerKey))
    );
  }

  async createBrokerAccount(
    userId: string,
    body: BrokerAccountUpsertBody
  ): Promise<ApiSuccessResponse<BrokerAccountItem>> {
    try {
      const payload = validateBrokerAccountUpsertBody(body);
      const connection = await this.connectionRepository.getConnectionById(
        userId,
        payload.connectionId
      );

      if (!connection) {
        throw new NotFoundAppError('Connection not found');
      }

      if (connection.brokerKey !== payload.brokerKey) {
        throw new BadRequestAppError('brokerKey does not match connection');
      }

      if (!connection.brokerId) {
        throw new BadRequestAppError('Selected connection is not a broker route');
      }

      const existing = await this.brokerAccountRepository.getBrokerAccountByKey(
        userId,
        payload.accountKey
      );

      if (Array.isArray(existing)) {
        throw new BadRequestAppError('accountKey lookup returned an invalid result');
      }

      if (existing) {
        throw new BadRequestAppError('accountKey already exists');
      }

      const definition = await this.brokerDefinitionService.getRequiredDefinition(
        payload.brokerKey
      );
      const sensitiveSettingKeys = this.getSensitiveSettingKeys(definition);
      const settings = this.brokerDefinitionService.validateAccountSettingsForDefinition(
        definition,
        payload.settings
      );
      const resolvedSettings = this.resolveSettingsWithMasterBaseUrl(
        definition.baseUrl,
        settings
      );

      try {
        await this.testProviderConfiguration(definition, resolvedSettings);
      } catch (error) {
        const detail =
          error instanceof Error ? error.message : 'Configuration test failed';
        throw new BadRequestAppError(
          `Test connection failed. Please verify credentials and try again: ${detail}`
        );
      }

      const created = await this.brokerAccountRepository.createBrokerAccount({
        userId,
        ...payload,
        settings: encryptBrokerAccountSettings(resolvedSettings, sensitiveSettingKeys),
        status: 'Connected',
        brokerId: connection.brokerId,
        lastSyncAt: new Date(),
      });

      await this.brokerAccountRepository.ensureSingleDefaultForConnection(
        userId,
        payload.connectionId,
        {
          preferredAccountId: payload.isDefault ? created.id : undefined,
        }
      );

      const finalized =
        (await this.brokerAccountRepository.getBrokerAccountById(userId, created.id)) ?? created;

      await this.operationalEventService.logActivity(userId, {
        type: 'Broker account',
        title: `Broker account created: ${finalized.accountKey}`,
        status: 'Success',
        route: 'Brokers data',
        stream: 'Controls',
        related: finalized.brokerKey,
        referenceId: finalized.id,
        description: `Created broker account ${finalized.accountName}`,
      });

      return successResponse(this.mapBrokerAccount(finalized, sensitiveSettingKeys));
    } catch (error) {
      await this.operationalEventService.logActivity(userId, {
        type: 'Broker account',
        title: 'Broker account create failed',
        status: 'Failed',
        route: 'Brokers data',
        stream: 'Controls',
        related: String(body?.brokerKey || 'broker-account'),
        description: error instanceof Error ? error.message : String(error),
      });
      await this.operationalEventService.emitFailureAlert(userId, {
        channel: 'Brokers',
        source: String(body?.brokerKey || 'broker_accounts'),
        message: `Broker account create failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        route: 'Risk review',
      });
      throw error;
    }
  }

  async testBrokerAccountConfiguration(
    userId: string,
    body: BrokerAccountUpsertBody
  ): Promise<ApiSuccessResponse<BrokerAccountTestConfigResult>> {
    const payload = validateBrokerAccountUpsertBody(body);
    const connection = await this.connectionRepository.getConnectionById(
      userId,
      payload.connectionId
    );

    if (!connection) {
      throw new NotFoundAppError('Connection not found');
    }

    if (connection.brokerKey !== payload.brokerKey) {
      throw new BadRequestAppError('brokerKey does not match connection');
    }

    if (!connection.brokerId) {
      throw new BadRequestAppError('Selected connection is not a broker route');
    }

    const existingByKey = await this.brokerAccountRepository.getBrokerAccountByKey(
      userId,
      payload.accountKey
    );
    const definition = await this.brokerDefinitionService.getRequiredDefinition(
      payload.brokerKey
    );
    const sensitiveSettingKeys = this.getSensitiveSettingKeys(definition);
    const existingSettings =
      existingByKey && existingByKey.connectionId === payload.connectionId
        ? (decryptBrokerAccountSettings(existingByKey.settings ?? undefined) ?? {})
        : undefined;
    const mergedIncomingSettings = this.mergeSensitiveSettings(
      payload.settings,
      existingSettings,
      sensitiveSettingKeys
    );

    const settings = this.brokerDefinitionService.validateAccountSettingsForDefinition(
      definition,
      mergedIncomingSettings
    );
    const resolvedSettings = this.resolveSettingsWithMasterBaseUrl(
      definition.baseUrl,
      settings
    );

    const checkedAt = new Date().toISOString();
    try {
      const detail = await this.testProviderConfiguration(definition, resolvedSettings);
      await this.operationalEventService.logActivity(userId, {
        type: 'Broker account diagnostics',
        title: `Broker account test passed: ${payload.accountKey}`,
        status: 'Success',
        route: 'Brokers data',
        stream: 'Controls',
        related: payload.brokerKey,
        referenceId: payload.connectionId,
        description: detail,
      });
      return successResponse({
        passed: true,
        status: 'Connected',
        detail,
        checkedAt,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Configuration test failed';
      await this.operationalEventService.logActivity(userId, {
        type: 'Broker account diagnostics',
        title: `Broker account test failed: ${payload.accountKey}`,
        status: 'Failed',
        route: 'Brokers data',
        stream: 'Controls',
        related: payload.brokerKey,
        referenceId: payload.connectionId,
        description: detail,
      });
      await this.operationalEventService.emitFailureAlert(userId, {
        channel: 'Brokers',
        source: payload.brokerKey,
        message: `Broker account test failed (${payload.accountKey}): ${detail}`,
        route: 'Risk review',
      });
      return successResponse({
        passed: false,
        status: 'Disconnected',
        detail,
        checkedAt,
      });
    }
  }

  async runSystemBrokerConnectionHealthCheck(): Promise<
    ApiSuccessResponse<BrokerAccountHealthCheckResponse>
  > {
    const accounts = await this.brokerAccountRepository.listSystemBrokerAccounts();
    const totalAccounts = accounts.length;
    const connectedAccounts = accounts.filter(
      (item) => String(item.status || '').trim().toLowerCase() === 'connected'
    );

    if (totalAccounts === 0 || connectedAccounts.length === 0) {
      return successResponse({
        totalAccounts,
        connectedAccounts: connectedAccounts.length,
        testedAccounts: 0,
        passed: 0,
        failed: 0,
        items: [],
      });
    }

    const items: BrokerAccountHealthCheckItem[] = [];
    let passed = 0;
    let failed = 0;
    for (const account of connectedAccounts) {
      const checkedAt = new Date().toISOString();
      try {
        const decryptedSettings =
          decryptBrokerAccountSettings(account.settings ?? undefined) ?? {};
        const definition = await this.brokerDefinitionService.getRequiredDefinition(
          account.brokerKey
        );
        const resolvedSettings = this.resolveSettingsWithMasterBaseUrl(
          definition.baseUrl,
          decryptedSettings
        );
        const detail = await this.testProviderConfiguration(definition, resolvedSettings);
        items.push({
          accountId: account.id,
          brokerKey: account.brokerKey,
          accountKey: account.accountKey,
          accountName: account.accountName,
          status: account.status,
          passed: true,
          detail,
          checkedAt,
        });
        passed += 1;
      } catch (error) {
        items.push({
          accountId: account.id,
          brokerKey: account.brokerKey,
          accountKey: account.accountKey,
          accountName: account.accountName,
          status: account.status,
          passed: false,
          detail:
            error instanceof Error
              ? error.message
              : 'Configuration test failed',
          checkedAt,
        });
        failed += 1;
      }
    }

    return successResponse({
      totalAccounts,
      connectedAccounts: connectedAccounts.length,
      testedAccounts: items.length,
      passed,
      failed,
      items,
    });
  }

  async updateBrokerAccount(
    userId: string,
    accountId: string,
    body: BrokerAccountUpsertBody
  ): Promise<ApiSuccessResponse<BrokerAccountItem>> {
    const validatedAccountId = validateBrokerAccountId(accountId);
    try {
      const payload = validateBrokerAccountUpsertBody(body);
      const existing = await this.brokerAccountRepository.getBrokerAccountById(
        userId,
        validatedAccountId
      );

      if (!existing) {
        throw new NotFoundAppError('Broker account not found');
      }

      const connection = await this.connectionRepository.getConnectionById(
        userId,
        payload.connectionId
      );

      if (!connection) {
        throw new NotFoundAppError('Connection not found');
      }

      if (connection.brokerKey !== payload.brokerKey) {
        throw new BadRequestAppError('brokerKey does not match connection');
      }

      if (!connection.brokerId) {
        throw new BadRequestAppError('Selected connection is not a broker route');
      }

      const duplicate = await this.brokerAccountRepository.getBrokerAccountByKey(
        userId,
        payload.accountKey
      );

      if (duplicate && duplicate.id !== validatedAccountId) {
        throw new BadRequestAppError('accountKey already exists');
      }

      const existingSettings =
        decryptBrokerAccountSettings(existing.settings ?? undefined) ?? undefined;
      const definition = await this.brokerDefinitionService.getRequiredDefinition(
        payload.brokerKey
      );
      const sensitiveSettingKeys = this.getSensitiveSettingKeys(definition);
      const mergedIncomingSettings = this.mergeSensitiveSettings(
        payload.settings,
        existingSettings,
        sensitiveSettingKeys
      );

      const settings = this.brokerDefinitionService.validateAccountSettingsForDefinition(
        definition,
        mergedIncomingSettings
      );
      const resolvedSettings = this.resolveSettingsWithMasterBaseUrl(
        definition.baseUrl,
        settings
      );

      try {
        await this.testProviderConfiguration(definition, resolvedSettings);
      } catch (error) {
        const detail =
          error instanceof Error ? error.message : 'Configuration test failed';
        throw new BadRequestAppError(
          `Test connection failed. Please verify credentials and try again: ${detail}`
        );
      }

      await this.brokerAccountRepository.updateBrokerAccount(userId, validatedAccountId, {
        ...payload,
        settings: encryptBrokerAccountSettings(resolvedSettings, sensitiveSettingKeys),
        status: 'Connected',
        brokerId: connection.brokerId,
        lastSyncAt: new Date(),
      });

      if (existing.connectionId !== payload.connectionId) {
        await this.brokerAccountRepository.ensureSingleDefaultForConnection(
          userId,
          existing.connectionId
        );
      }

      await this.brokerAccountRepository.ensureSingleDefaultForConnection(
        userId,
        payload.connectionId,
        {
          preferredAccountId: payload.isDefault ? validatedAccountId : undefined,
          excludedAccountId:
            existing.connectionId === payload.connectionId &&
            existing.isDefault &&
            !payload.isDefault
              ? validatedAccountId
              : undefined,
        }
      );

      const updated = await this.brokerAccountRepository.getBrokerAccountById(
        userId,
        validatedAccountId
      );

      if (!updated) {
        throw new NotFoundAppError('Broker account not found');
      }

      await this.operationalEventService.logActivity(userId, {
        type: 'Broker account',
        title: `Broker account updated: ${updated.accountKey}`,
        status: 'Success',
        route: 'Brokers data',
        stream: 'Controls',
        related: updated.brokerKey,
        referenceId: updated.id,
        description: `Updated broker account ${updated.accountName}`,
      });

      return successResponse(this.mapBrokerAccount(updated, sensitiveSettingKeys));
    } catch (error) {
      await this.operationalEventService.logActivity(userId, {
        type: 'Broker account',
        title: 'Broker account update failed',
        status: 'Failed',
        route: 'Brokers data',
        stream: 'Controls',
        related: String(body?.brokerKey || 'broker-account'),
        referenceId: validatedAccountId,
        description: error instanceof Error ? error.message : String(error),
      });
      await this.operationalEventService.emitFailureAlert(userId, {
        channel: 'Brokers',
        source: String(body?.brokerKey || 'broker_accounts'),
        message: `Broker account update failed (${validatedAccountId}): ${
          error instanceof Error ? error.message : String(error)
        }`,
        route: 'Risk review',
      });
      throw error;
    }
  }

  async deleteBrokerAccount(
    userId: string,
    accountId: string
  ): Promise<ApiSuccessResponse<BrokerAccountDeleteResult>> {
    const validatedAccountId = validateBrokerAccountId(accountId);
    const existing = await this.brokerAccountRepository.getBrokerAccountById(
      userId,
      validatedAccountId
    );

    if (!existing) {
      throw new NotFoundAppError('Broker account not found');
    }

    const deleted = await this.brokerAccountRepository.deleteBrokerAccount(
      userId,
      validatedAccountId
    );

    if (!deleted) {
      throw new NotFoundAppError('Broker account not found');
    }

    await this.brokerAccountRepository.ensureSingleDefaultForConnection(
      userId,
      existing.connectionId
    );

    await this.operationalEventService.logActivity(userId, {
      type: 'Broker account',
      title: `Broker account removed: ${existing.accountKey}`,
      status: 'Success',
      route: 'Brokers data',
      stream: 'Controls',
      related: existing.brokerKey,
      referenceId: validatedAccountId,
      description: `Deleted broker account ${existing.accountName}`,
    });

    return successResponse({
      message: 'Broker account deleted',
      accountId: validatedAccountId,
      connectionId: existing.connectionId,
    });
  }

  private mapBrokerAccount(
    item: BrokerAccount,
    sensitiveSettingKeys?: Set<string>
  ): BrokerAccountItem {
    const decryptedSettings = decryptBrokerAccountSettings(item.settings ?? undefined);
    const hasApiKey = this.hasSettingValue(decryptedSettings, 'apiKey');
    const hasApiSecret = this.hasSettingValue(decryptedSettings, 'apiSecret');
    const maskedSettings = this.maskSensitiveSettings(
      decryptedSettings,
      sensitiveSettingKeys
    );

    return {
      id: item.id,
      connectionId: item.connectionId,
      brokerKey: item.brokerKey,
      brokerId: item.brokerId ?? undefined,
      accountKey: item.accountKey,
      accountName: item.accountName,
      status: item.status,
      mode: item.mode ?? undefined,
      lastSyncAt: item.lastSyncAt?.toISOString() ?? '',
      purpose: item.purpose ?? undefined,
      capabilities: item.capabilities ?? undefined,
      settings: maskedSettings ?? undefined,
      hasApiKey,
      hasApiSecret,
      isDefault: item.isDefault,
    };
  }

  private async mapBrokerAccounts(items: BrokerAccount[]): Promise<BrokerAccountItem[]> {
    const sensitiveSettingKeysByBrokerKey =
      await this.getSensitiveSettingKeysByBrokerKey(items.map((item) => item.brokerKey));

    return items.map((item) =>
      this.mapBrokerAccount(
        item,
        sensitiveSettingKeysByBrokerKey.get(this.normalizeBrokerKey(item.brokerKey))
      )
    );
  }

  private async testProviderConfiguration(
    definition: BrokerDefinition,
    settings?: Record<string, unknown>
  ): Promise<string> {
    const normalizedKey = this.normalizeBrokerKey(definition.brokerKey);
    const normalizedSettings = settings ?? {};

    if (normalizedKey === 'mudrex') {
      await this.mudrexHttpClient.authenticatedGetWithSettings(
        normalizedSettings,
        '/fapi/v1/futures/orders',
        { limit: 1 },
        normalizedKey
      );
      return 'Mudrex authentication and orders check passed';
    }

    if (normalizedKey === 'delta_exchange') {
      await this.deltaExchangeHttpClient.signedGetWithSettings(
        normalizedSettings,
        '/v2/wallet/balances',
        undefined,
        normalizedKey
      );
      return 'Delta Exchange signed wallet check passed';
    }

    if (!this.requiresSignedAccountConfigurationTest(definition)) {
      return this.runRouteLevelConfigurationCheck(definition);
    }

    throw new BadRequestAppError(
      `Broker account configuration test is not implemented for broker: ${normalizedKey}`
    );
  }

  private requiresSignedAccountConfigurationTest(definition: BrokerDefinition): boolean {
    if (definition.diagnostics?.requiresAccount) {
      return true;
    }

    return (definition.accountFields ?? []).some(
      (field) => Boolean(field.required) || Boolean(field.secret)
    );
  }

  private async runRouteLevelConfigurationCheck(definition: BrokerDefinition): Promise<string> {
    const diagnostics = await this.brokerDiagnosticsService.testConnection(
      'configuration-check',
      this.buildConfigurationCheckConnection(definition)
    );
    return diagnostics.detail;
  }

  private buildConfigurationCheckConnection(definition: BrokerDefinition): Connection {
    return {
      id: `config-check-${definition.brokerKey}`,
      userId: null,
      name: definition.name,
      broker: definition.name,
      brokerKey: definition.brokerKey,
      brokerId: definition.brokerId ?? definition.id,
      type: definition.category,
      status: 'Idle',
      latency: null,
      mode: null,
      lastSyncAt: null,
      diagnosticSummary: null,
      route: null,
      scope: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  private resolveSettingsWithMasterBaseUrl(
    definitionBaseUrl: string | undefined,
    settings?: Record<string, unknown>
  ): Record<string, unknown> | undefined {
    const masterBaseUrl = String(definitionBaseUrl || '').trim();
    const mergedSettings = {
      ...(settings ?? {}),
    } as Record<string, unknown>;
    const accountBaseUrl = String(mergedSettings.baseUrl ?? '').trim();

    if (!accountBaseUrl && masterBaseUrl) {
      mergedSettings.baseUrl = masterBaseUrl;
    }

    return Object.keys(mergedSettings).length ? mergedSettings : undefined;
  }

  private mergeSensitiveSettings(
    incoming?: Record<string, unknown> | null,
    existing?: Record<string, unknown> | null,
    sensitiveSettingKeys?: Set<string>
  ): Record<string, unknown> | undefined {
    if (!incoming && !existing) {
      return undefined;
    }

    const merged = {
      ...(incoming ?? {}),
    } as Record<string, unknown>;
    const existingSettings = existing ?? {};
    const keysToPreserve = sensitiveSettingKeys ?? createBrokerAccountSecretKeySet();
    const existingEntriesByNormalizedKey = this.getSettingsEntryMap(existingSettings);
    const incomingEntriesByNormalizedKey = this.getSettingsEntryMap(merged);

    for (const key of keysToPreserve) {
      const incomingEntry = incomingEntriesByNormalizedKey.get(key);
      const incomingValue = String(incomingEntry?.value ?? '').trim();

      if (!incomingValue || incomingValue.startsWith('****')) {
        const existingEntry = existingEntriesByNormalizedKey.get(key);
        const existingValue = String(existingEntry?.value ?? '').trim();
        const targetKey = incomingEntry?.key ?? existingEntry?.key;

        if (!targetKey) {
          continue;
        }

        if (existingValue) {
          merged[targetKey] = existingEntry?.value;
        } else {
          delete merged[targetKey];
        }
      }
    }

    return Object.keys(merged).length ? merged : undefined;
  }

  private maskSensitiveSettings(
    settings?: Record<string, unknown>,
    sensitiveSettingKeys?: Set<string>
  ): Record<string, unknown> | undefined {
    if (!settings || typeof settings !== 'object') {
      return settings;
    }

    const masked = {
      ...settings,
    } as Record<string, unknown>;

    const mask = (value: unknown): string => {
      const text = String(value ?? '').trim();
      if (!text) {
        return '';
      }
      const suffix = text.slice(-4);
      return `****${suffix}`;
    };

    const keysToMask = sensitiveSettingKeys ?? createBrokerAccountSecretKeySet();
    for (const [key, value] of Object.entries(masked)) {
      if (keysToMask.has(normalizeBrokerAccountSettingKey(key))) {
        masked[key] = mask(value);
      }
    }

    return masked;
  }

  private async getSensitiveSettingKeysByBrokerKey(
    brokerKeys: string[]
  ): Promise<Map<string, Set<string>>> {
    const normalizedBrokerKeys = Array.from(
      new Set(brokerKeys.map((key) => this.normalizeBrokerKey(key)).filter(Boolean))
    );

    if (!normalizedBrokerKeys.length) {
      return new Map();
    }

    const definitions = await this.brokerDefinitionService.listPersistedDefinitions({
      includeInactive: true,
    });
    const definitionsByBrokerKey = new Map(
      definitions.map((definition) => [
        this.normalizeBrokerKey(definition.brokerKey),
        definition,
      ])
    );

    return new Map(
      normalizedBrokerKeys.map((brokerKey) => [
        brokerKey,
        this.getSensitiveSettingKeys(definitionsByBrokerKey.get(brokerKey)),
      ])
    );
  }

  private getSensitiveSettingKeys(definition?: BrokerDefinition | null): Set<string> {
    const definitionSecretKeys =
      definition?.accountFields
        .filter(
          (field) =>
            Boolean(field.secret) ||
            normalizeBrokerAccountSettingKey(field.type || '') === 'secret'
        )
        .map((field) => field.key) ?? [];

    return createBrokerAccountSecretKeySet(definitionSecretKeys);
  }

  private getSettingsEntryMap(
    settings?: Record<string, unknown> | null
  ): Map<string, { key: string; value: unknown }> {
    return new Map(
      Object.entries(settings ?? {}).map(([key, value]) => [
        normalizeBrokerAccountSettingKey(key),
        { key, value },
      ])
    );
  }

  private hasSettingValue(
    settings: Record<string, unknown> | undefined,
    key: string
  ): boolean {
    const normalizedTargetKey = normalizeBrokerAccountSettingKey(key);
    const match = Object.entries(settings ?? {}).find(
      ([candidateKey]) =>
        normalizeBrokerAccountSettingKey(candidateKey) === normalizedTargetKey
    );

    return Boolean(String(match?.[1] ?? '').trim());
  }

  private normalizeBrokerKey(value: string): string {
    return String(value || '').trim().toLowerCase();
  }
}
