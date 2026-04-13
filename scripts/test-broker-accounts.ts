import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { BrokerAccountsController } from '../src/api/controllers/BrokerAccountsController';
import { BrokerDefinitionsController } from '../src/api/controllers/BrokerDefinitionsController';
import { InternalBrokerAccountsController } from '../src/api/controllers/InternalBrokerAccountsController';
import { BrokerAccountsService } from '../src/api/services/BrokerAccountsService';
import { BrokerDefinitionsService } from '../src/api/services/BrokerDefinitionsService';
import {
  validateBrokerAccountId,
  validateBrokerAccountsQuery,
  validateBrokerAccountUpsertBody,
} from '../src/api/validators/brokerAccounts.validator';
import { validateBrokerDefinitionUpsertBody } from '../src/api/validators/brokerDefinitions.validator';
import { Broker } from '../src/database/entities/Broker';
import { decryptBrokerAccountSettings } from '../src/lib/brokerAccountSecrets';
import { BrokerDefinitionRuntimeSupportService } from '../src/brokers/core/BrokerDefinitionRuntimeSupportService';
import { BrokerDefinitionService as CoreBrokerDefinitionService } from '../src/brokers/core/BrokerDefinitionService';
import { BrokerDefinitionStartupValidator } from '../src/brokers/core/BrokerDefinitionStartupValidator';
import { getMetadataArgsStorage } from 'typeorm';

function createSuccess<T>(data: T) {
  return { success: true as const, data };
}

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

const authReq = { authUser: { sub: 'user-1' } } as any;
const adminAuthReq = { authUser: { sub: 'user-1', role: 'admin' } } as any;
const unauthReq = {} as any;

async function assertAuthRequired(
  run: () => Promise<unknown>,
  message = 'Authentication required'
): Promise<void> {
  await assert.rejects(
    run,
    (error: unknown) =>
      error instanceof Error &&
      error.message === message &&
      (error as { httpCode?: number }).httpCode === 401
  );
}

async function runBrokerAccountsControllerAssertions(): Promise<void> {
  const controller: any = new BrokerAccountsController();

  controller.brokerAccountsService = {
    getBrokerAccounts: async (...args: unknown[]) => createSuccess({ args }),
    createBrokerAccount: async (...args: unknown[]) => createSuccess({ args }),
    testBrokerAccountConfiguration: async (...args: unknown[]) => createSuccess({ args }),
    updateBrokerAccount: async (...args: unknown[]) => createSuccess({ args }),
    deleteBrokerAccount: async (...args: unknown[]) => createSuccess({ args }),
  };

  assert.deepEqual(
    (
      await controller.getBrokerAccounts(
        authReq,
        '25',
        '5',
        'conn-1',
        'mudrex',
        'Connected',
        'primary'
      )
    ).data.args,
    [
      'user-1',
      {
        limit: '25',
        offset: '5',
        connectionId: 'conn-1',
        brokerKey: 'mudrex',
        status: 'Connected',
        search: 'primary',
      },
    ]
  );

  const body = {
    connectionId: 'conn-1',
    brokerKey: 'mudrex',
    accountKey: 'primary',
    accountName: 'Primary account',
    settings: { apiKey: 'abc' },
    isDefault: true,
  };

  assert.deepEqual((await controller.createBrokerAccount(authReq, body)).data.args, [
    'user-1',
    body,
  ]);
  assert.deepEqual((await controller.testBrokerAccountConfiguration(authReq, body)).data.args, [
    'user-1',
    body,
  ]);
  assert.deepEqual(
    (await controller.updateBrokerAccount(authReq, 'acct-1', body)).data.args,
    ['user-1', 'acct-1', body]
  );
  assert.deepEqual((await controller.deleteBrokerAccount(authReq, 'acct-1')).data.args, [
    'user-1',
    'acct-1',
  ]);

  await assertAuthRequired(() => controller.getBrokerAccounts(unauthReq));
  await assertAuthRequired(() => controller.createBrokerAccount(unauthReq, body));
}

async function runInternalBrokerAccountsControllerAssertions(): Promise<void> {
  const controller: any = new InternalBrokerAccountsController();
  const calls: unknown[][] = [];

  controller.brokerAccountsService = {
    runSystemBrokerConnectionHealthCheck: async (...args: unknown[]) => {
      calls.push(args);
      return createSuccess({ ok: true });
    },
  };

  const response = await controller.runHealthCheck();
  assert.deepEqual(response.data, { ok: true });
  assert.deepEqual(calls, [[]]);
}

async function runBrokerDefinitionsControllerAssertions(): Promise<void> {
  const controller: any = new BrokerDefinitionsController();

  controller.brokerDefinitionsService = {
    listDefinitions: async (...args: unknown[]) => createSuccess({ args }),
    getDefinition: async (...args: unknown[]) => createSuccess({ args }),
    upsertDefinition: async (...args: unknown[]) => createSuccess({ args }),
  };

  assert.deepEqual((await controller.listDefinitions(adminAuthReq)).data.args, [
    {
      userId: 'user-1',
      role: 'admin',
    },
  ]);
  assert.deepEqual((await controller.getDefinition(adminAuthReq, 'mudrex')).data.args, [
    {
      userId: 'user-1',
      role: 'admin',
    },
    'mudrex',
  ]);
  assert.deepEqual(
    (
      await controller.upsertDefinition(adminAuthReq, 'mudrex', {
        brokerKey: 'ignored-key',
        name: 'Mudrex',
        category: 'broker',
        status: 'active',
        providerType: 'broker',
        capabilities: ['market'],
        accountFields: [],
        expectedUpdatedAt: '2026-04-04T00:05:00.000Z',
      })
    ).data.args,
    [
      {
        userId: 'user-1',
        role: 'admin',
      },
      {
        brokerKey: 'mudrex',
        name: 'Mudrex',
        category: 'broker',
        status: 'active',
        providerType: 'broker',
        capabilities: ['market'],
        accountFields: [],
        expectedUpdatedAt: '2026-04-04T00:05:00.000Z',
      },
    ]
  );

  await assertAuthRequired(() => controller.listDefinitions(unauthReq));
  await assertAuthRequired(() => controller.getDefinition(unauthReq, 'mudrex'));
}

function runBrokerAccountsValidationAssertions(): void {
  assert.deepEqual(validateBrokerAccountsQuery({}), {
    limit: 50,
    offset: 0,
    connectionId: undefined,
    brokerKey: undefined,
    status: undefined,
    search: undefined,
  });
  assert.deepEqual(
    validateBrokerAccountsQuery({
      limit: '25',
      offset: '5',
      connectionId: ' conn-1 ',
      brokerKey: ' mudrex ',
      status: ' Connected ',
      search: ' primary ',
    }),
    {
      limit: 25,
      offset: 5,
      connectionId: 'conn-1',
      brokerKey: 'mudrex',
      status: 'Connected',
      search: 'primary',
    }
  );
  assert.throws(() => validateBrokerAccountsQuery({ limit: '0' }), /limit must be between 1 and 200/);
  assert.equal(validateBrokerAccountId(' acct-1 '), 'acct-1');
  assert.throws(() => validateBrokerAccountId(' '), /accountId is required/);

  assert.deepEqual(
    validateBrokerAccountUpsertBody({
      connectionId: ' conn-1 ',
      brokerKey: ' Mudrex ',
      accountName: ' Primary Account ',
      settings: { apiKey: ' key-1 ' },
      isDefault: true,
    }),
    {
      connectionId: 'conn-1',
      brokerKey: 'mudrex',
      accountKey: 'primary_account',
      accountName: 'Primary Account',
      mode: undefined,
      purpose: undefined,
      capabilities: undefined,
      settings: { apiKey: 'key-1' },
      isDefault: true,
    }
  );
  assert.throws(
    () =>
      validateBrokerAccountUpsertBody({
        connectionId: 'conn-1',
        brokerKey: 'mudrex',
        accountKey: 'primary_account',
      } as any),
    /accountName is required/
  );
}

async function runBrokerAccountSecretHandlingAssertions(): Promise<void> {
  const service = new BrokerAccountsService() as any;
  const activities: Array<Record<string, unknown>> = [];
  const alerts: Array<Record<string, unknown>> = [];
  const configurationChecks: Array<Record<string, unknown> | undefined> = [];
  const createdRecords: Array<Record<string, unknown>> = [];
  const updatedRecords: Array<Record<string, unknown>> = [];

  const definition = {
    id: 'broker-1',
    brokerKey: 'custom_broker',
    name: 'Custom Broker',
    category: 'broker',
    status: 'active',
    providerType: 'broker',
    capabilities: [],
    accountFields: [
      { key: 'apiKey', label: 'API key', required: true },
      { key: 'clientSecret', label: 'Client secret', secret: true, required: true },
      { key: 'username', label: 'Username', required: true },
    ],
  };

  const persistedAccount = {
    id: 'acct-1',
    userId: 'user-1',
    connectionId: 'conn-1',
    brokerKey: 'custom_broker',
    brokerId: 'broker-route-1',
    accountKey: 'primary_account',
    accountName: 'Primary account',
    status: 'Connected',
    mode: 'Primary',
    lastSyncAt: new Date('2026-04-04T06:00:00.000Z'),
    purpose: null,
    capabilities: null,
    settings: null,
    isDefault: true,
  } as Record<string, unknown>;

  Object.defineProperty(service, 'connectionRepository', {
    get: () => ({
      async getConnectionById() {
        return {
          id: 'conn-1',
          brokerKey: 'custom_broker',
          brokerId: 'broker-route-1',
        };
      },
    }),
  });

  Object.defineProperty(service, 'brokerDefinitionService', {
    get: () => ({
      async getRequiredDefinition() {
        return definition;
      },
      async listPersistedDefinitions() {
        return [definition];
      },
      validateAccountSettingsForDefinition(
        _definition: Record<string, unknown>,
        settings?: Record<string, unknown>
      ) {
        return settings;
      },
    }),
  });

  Object.defineProperty(service, 'brokerAccountRepository', {
    get: () => ({
      async listBrokerAccounts() {
        return { items: [persistedAccount], total: 1 };
      },
      async getBrokerAccountByKey(_userId: string, accountKey: string) {
        if (accountKey !== String(persistedAccount.accountKey) || !persistedAccount.settings) {
          return null;
        }
        return persistedAccount;
      },
      async getBrokerAccountById() {
        return persistedAccount;
      },
      async createBrokerAccount(payload: Record<string, unknown>) {
        createdRecords.push(payload);
        persistedAccount.settings = payload.settings ?? null;
        persistedAccount.lastSyncAt = payload.lastSyncAt as Date;
        return persistedAccount;
      },
      async updateBrokerAccount(
        _userId: string,
        _accountId: string,
        payload: Record<string, unknown>
      ) {
        updatedRecords.push(payload);
        persistedAccount.settings = payload.settings ?? null;
        persistedAccount.lastSyncAt = payload.lastSyncAt as Date;
      },
      async clearDefaultForConnection() {
        return;
      },
      async ensureSingleDefaultForConnection() {
        return;
      },
    }),
  });

  Object.defineProperty(service, 'operationalEventService', {
    get: () => ({
      async logActivity(userId: string, payload: Record<string, unknown>) {
        activities.push({ userId, ...payload });
      },
      async emitFailureAlert(userId: string, payload: Record<string, unknown>) {
        alerts.push({ userId, ...payload });
      },
    }),
  });

  service.testProviderConfiguration = async (
    _definition: Record<string, unknown>,
    settings?: Record<string, unknown>
  ) => {
    configurationChecks.push(settings);
    return 'Configuration test passed';
  };

  const createResult = await service.createBrokerAccount('user-1', {
    connectionId: 'conn-1',
    brokerKey: 'custom_broker',
    accountKey: 'primary_account',
    accountName: 'Primary account',
    settings: {
      apiKey: 'api-key-1234',
      clientSecret: 'client-secret-5678',
      username: 'auralpha',
    },
    isDefault: true,
  });

  assert.equal(createdRecords.length, 1);
  const createdSettings = (createdRecords[0].settings as Record<string, unknown>) ?? {};
  assert.ok(String(createdSettings.apiKey || '').startsWith('enc:v1:'));
  assert.ok(String(createdSettings.clientSecret || '').startsWith('enc:v1:'));
  assert.equal(createResult.data.settings?.apiKey, '****1234');
  assert.equal(createResult.data.settings?.clientSecret, '****5678');
  assert.equal(createResult.data.settings?.username, 'auralpha');

  const testResult = await service.testBrokerAccountConfiguration('user-1', {
    connectionId: 'conn-1',
    brokerKey: 'custom_broker',
    accountKey: 'primary_account',
    accountName: 'Primary account',
    settings: {
      apiKey: '****1234',
      clientSecret: '****5678',
      username: 'auralpha',
    },
    isDefault: true,
  });
  assert.equal(testResult.data.passed, true);
  assert.equal(configurationChecks.length, 2);
  assert.equal(configurationChecks[1]?.apiKey, 'api-key-1234');
  assert.equal(configurationChecks[1]?.clientSecret, 'client-secret-5678');

  const updateResult = await service.updateBrokerAccount('user-1', 'acct-1', {
    connectionId: 'conn-1',
    brokerKey: 'custom_broker',
    accountKey: 'primary_account',
    accountName: 'Primary account',
    settings: {
      apiKey: '****1234',
      clientSecret: '****5678',
      username: 'auralpha-updated',
    },
    isDefault: true,
  });
  assert.equal(updatedRecords.length, 1);
  const decryptedUpdatedSettings: Record<string, unknown> =
    decryptBrokerAccountSettings(
      (updatedRecords[0].settings as Record<string, unknown>) ?? undefined
    ) ?? {};
  assert.equal(decryptedUpdatedSettings.apiKey, 'api-key-1234');
  assert.equal(decryptedUpdatedSettings.clientSecret, 'client-secret-5678');
  assert.equal(decryptedUpdatedSettings.username, 'auralpha-updated');
  assert.equal(updateResult.data.settings?.clientSecret, '****5678');

  const listResult = await service.getBrokerAccounts('user-1', {
    limit: '25',
    offset: '0',
  });
  assert.equal(listResult.data.items.length, 1);
  assert.equal(listResult.data.items[0].settings?.clientSecret, '****5678');
  assert.equal(alerts.length, 0);
  assert.equal(activities.length >= 3, true);
}

function runBrokerDefinitionEntitySchemaAssertions(): void {
  const brokerColumns = getMetadataArgsStorage().columns.filter((column) => column.target === Broker);

  for (const propertyName of [
    'capabilities',
    'accountConfig',
    'integrationGuide',
    'diagnosticsConfig',
  ]) {
    const column = brokerColumns.find((entry) => entry.propertyName === propertyName);
    assert.equal(
      column?.options.type,
      'json',
      `Broker.${propertyName} should use a native json column`
    );
  }
}

async function runBrokerDefinitionServicePhase2Assertions(): Promise<void> {
  const service = new CoreBrokerDefinitionService() as any;
  const legacyDeltaDefinition = {
    id: 'broker-delta',
    brokerKey: 'delta_exchange',
    name: 'Delta Exchange',
    category: 'exchange',
    status: 'active',
    providerType: 'exchange',
    linkedExchangeKey: 'delta_exchange',
    baseUrl: 'https://api.india.delta.exchange',
    capabilities: ['assets', 'market', 'orders', 'positions', 'wallet'],
    accountConfig: { fields: [] },
    integrationGuide: { summary: 'Delta route' },
    diagnosticsConfig: { executorKey: 'delta-exchange' },
    updatedAt: new Date('2026-04-06T12:00:00.000Z'),
  };
  const mudrexDefinition = {
    id: 'broker-mudrex',
    brokerKey: 'mudrex',
    name: 'Mudrex',
    category: 'broker',
    status: 'active',
    providerType: 'broker',
    linkedExchangeKey: null,
    baseUrl: 'https://api.mudrex.com',
    capabilities: ['assets', 'market', 'orders', 'positions', 'wallet'],
    accountConfig: { fields: [] },
    integrationGuide: { summary: 'Mudrex route' },
    diagnosticsConfig: { executorKey: 'mudrex-public' },
    updatedAt: new Date('2026-04-06T12:00:00.000Z'),
  };
  const rogueBinanceBrokerDefinition = {
    id: 'broker-binance',
    brokerKey: 'binance',
    name: 'Binance Broker Shadow',
    category: 'feed',
    status: 'active',
    providerType: 'feed',
    linkedExchangeKey: 'binance',
    baseUrl: 'https://persisted.binance.invalid',
    capabilities: ['market'],
    accountConfig: { fields: [] },
    integrationGuide: { summary: 'Persisted shadow definition that runtime should ignore' },
    diagnosticsConfig: { executorKey: 'binance-market' },
    updatedAt: new Date('2026-04-06T12:05:00.000Z'),
  };

  Object.defineProperty(service, 'brokerRepository', {
    get: () => ({
      async getActiveBrokerByKey(brokerKey: string) {
        const normalizedKey = String(brokerKey || '').trim().toLowerCase();
        if (normalizedKey === 'delta_exchange') {
          return legacyDeltaDefinition;
        }
        if (normalizedKey === 'mudrex') {
          return mudrexDefinition;
        }
        if (normalizedKey === 'binance') {
          return rogueBinanceBrokerDefinition;
        }
        return null;
      },
      async getBrokerByKey(brokerKey: string) {
        const normalizedKey = String(brokerKey || '').trim().toLowerCase();
        if (normalizedKey === 'delta_exchange') {
          return legacyDeltaDefinition;
        }
        if (normalizedKey === 'mudrex') {
          return mudrexDefinition;
        }
        if (normalizedKey === 'binance') {
          return rogueBinanceBrokerDefinition;
        }
        return null;
      },
      async listActiveBrokers() {
        return [legacyDeltaDefinition, mudrexDefinition, rogueBinanceBrokerDefinition];
      },
      async listBrokers() {
        return [legacyDeltaDefinition, mudrexDefinition, rogueBinanceBrokerDefinition];
      },
    }),
  });
  Object.defineProperty(service, 'exchangeRepository', {
    get: () => ({
      async getExchangeByKey(exchangeKey: string) {
        if (String(exchangeKey || '').trim().toLowerCase() !== 'binance') {
          return null;
        }
        return {
          id: 'exchange-binance',
          exchangeKey: 'binance',
          name: 'Binance',
          status: 'active',
          baseUrl: 'https://fapi.binance.com',
          updatedAt: new Date('2026-04-06T13:00:00.000Z'),
        };
      },
    }),
  });
  Object.defineProperty(service, 'brokerRegistry', {
    get: () => ({
      getOptional(brokerKey: string) {
        const normalizedKey = String(brokerKey || '').trim().toLowerCase();
        if (normalizedKey === 'mudrex') {
          return { brokerKey: 'mudrex', category: 'broker', providerType: 'broker' };
        }
        if (normalizedKey === 'delta_exchange') {
          return { brokerKey: 'delta_exchange', category: 'broker', providerType: 'broker' };
        }
        if (normalizedKey === 'binance') {
          return { brokerKey: 'binance', category: 'feed', providerType: 'feed' };
        }
        return null;
      },
    }),
  });

  const runtimeDeltaDefinition = await service.getRequiredDefinition('delta_exchange');
  assert.equal(runtimeDeltaDefinition.category, 'broker');
  assert.equal(runtimeDeltaDefinition.providerType, 'broker');

  const persistedDeltaDefinition = await service.getPersistedDefinition('delta_exchange', {
    includeInactive: true,
  });
  assert.equal(persistedDeltaDefinition.category, 'exchange');
  assert.equal(persistedDeltaDefinition.providerType, 'exchange');

  const runtimeDefinitions = await service.listActiveDefinitions();
  assert.deepEqual(
    runtimeDefinitions.map((definition: { brokerKey: string }) => definition.brokerKey).sort(),
    ['binance', 'delta_exchange', 'mudrex']
  );

  const runtimeBinanceDefinition = await service.getRequiredDefinition('binance');
  assert.equal(runtimeBinanceDefinition.providerType, 'feed');
  assert.equal(runtimeBinanceDefinition.linkedExchangeKey, 'binance');
}

async function runBrokerDefinitionLifecycleAssertions(): Promise<void> {
  const runtimeSupportService = new BrokerDefinitionRuntimeSupportService() as any;

  Object.defineProperty(runtimeSupportService, 'exchangeRepository', {
    get: () => ({
      async getExchangeByKey(exchangeKey: string) {
        const normalizedKey = String(exchangeKey || '').trim().toLowerCase();
        if (normalizedKey === 'binance') {
          return { id: 'exchange-binance', exchangeKey: 'binance' };
        }
        if (normalizedKey === 'delta_exchange') {
          return { id: 'exchange-delta', exchangeKey: 'delta_exchange' };
        }
        return null;
      },
    }),
  });
  Object.defineProperty(runtimeSupportService, 'brokerRegistry', {
    get: () => ({
      getOptional(brokerKey: string) {
        const modules = new Map([
          ['mudrex', { brokerKey: 'mudrex', category: 'broker', providerType: 'broker' }],
          [
            'delta_exchange',
            { brokerKey: 'delta_exchange', category: 'broker', providerType: 'broker' },
          ],
          ['binance', { brokerKey: 'binance', category: 'feed', providerType: 'feed' }],
        ]);
        return modules.get(String(brokerKey || '').trim().toLowerCase()) ?? null;
      },
    }),
  });
  Object.defineProperty(runtimeSupportService, 'brokerRuntimeRegistry', {
    get: () => ({
      supportsMarketAdapter(brokerKey: string) {
        return ['mudrex', 'delta_exchange', 'binance'].includes(
          String(brokerKey || '').trim().toLowerCase()
        );
      },
      supportsOrdersAdapter(brokerKey: string) {
        return ['mudrex', 'delta_exchange'].includes(
          String(brokerKey || '').trim().toLowerCase()
        );
      },
      supportsPositionsAdapter(brokerKey: string) {
        return ['mudrex', 'delta_exchange'].includes(
          String(brokerKey || '').trim().toLowerCase()
        );
      },
      supportsWalletAdapter(brokerKey: string) {
        return ['mudrex', 'delta_exchange'].includes(
          String(brokerKey || '').trim().toLowerCase()
        );
      },
    }),
  });
  Object.defineProperty(runtimeSupportService, 'brokerDiagnosticsService', {
    get: () => ({
      hasExecutorKey(executorKey: string) {
        return ['mudrex-public', 'delta-exchange', 'binance-market'].includes(
          String(executorKey || '').trim()
        );
      },
    }),
  });
  Object.defineProperty(runtimeSupportService, 'brokerExchangeAssetSyncService', {
    get: () => ({
      supportsSource(source: string) {
        return ['mudrex', 'delta_exchange'].includes(String(source || '').trim().toLowerCase());
      },
    }),
  });

  await runtimeSupportService.validateDefinition({
    brokerKey: 'binance',
    category: 'feed',
    providerType: 'feed',
    linkedExchangeKey: 'binance',
    capabilities: ['market', 'diagnostics'],
    diagnostics: { executorKey: 'binance-market' },
  });
  await assert.rejects(
    () =>
      runtimeSupportService.validateDefinition({
        brokerKey: 'custom_broker',
        category: 'broker',
        providerType: 'broker',
        capabilities: ['orders'],
      }),
    /Broker runtime module is not registered/
  );

  const validatedSelectBody = validateBrokerDefinitionUpsertBody({
    brokerKey: 'custom_broker',
    name: 'Custom Broker',
    category: 'broker',
    status: 'active',
    providerType: 'broker',
    capabilities: ['market'],
    accountFields: [
      {
        key: 'environment',
        label: 'Environment',
        type: 'select',
        required: true,
        options: [
          { value: 'demo', label: 'Demo' },
          { value: 'live', label: 'Live' },
        ],
      },
    ],
  });
  assert.equal(validatedSelectBody.accountFields[0].type, 'select');
  assert.deepEqual(validatedSelectBody.accountFields[0].options, [
    { value: 'demo', label: 'Demo' },
    { value: 'live', label: 'Live' },
  ]);
  assert.throws(
    () =>
      validateBrokerDefinitionUpsertBody({
        brokerKey: 'custom broker',
        name: 'Custom Broker',
        category: 'broker',
        status: 'active',
        providerType: 'broker',
        capabilities: ['market'],
        accountFields: [],
      }),
    /brokerKey must use letters, numbers, underscores, or hyphens/
  );

  const coreDefinitionService = new CoreBrokerDefinitionService();
  const selectDefinition = {
    id: 'definition-1',
    brokerKey: 'custom_broker',
    name: 'Custom Broker',
    category: 'broker',
    status: 'active',
    providerType: 'broker',
    capabilities: ['market'],
    accountFields: [
      {
        key: 'environment',
        label: 'Environment',
        type: 'select',
        required: true,
        options: [
          { value: 'demo', label: 'Demo' },
          { value: 'live', label: 'Live' },
        ],
      },
    ],
  };
  assert.deepEqual(
    coreDefinitionService.validateAccountSettingsForDefinition(selectDefinition as any, {
      environment: 'demo',
    }),
    { environment: 'demo' }
  );
  assert.throws(
    () =>
      coreDefinitionService.validateAccountSettingsForDefinition(selectDefinition as any, {
        environment: 'paper',
      }),
    /must be one of: Demo, Live/
  );

  const brokerDefinitionsService = new BrokerDefinitionsService() as any;
  const savedDefinitions: Array<Record<string, unknown>> = [];
  const definitionActivities: Array<Record<string, unknown>> = [];

  Object.defineProperty(brokerDefinitionsService, 'brokerDefinitionRuntimeSupportService', {
    get: () => runtimeSupportService,
  });
  Object.defineProperty(brokerDefinitionsService, 'brokerRepository', {
    get: () => ({
      async getBrokerByKey() {
        return null;
      },
      async getBrokerByName() {
        return null;
      },
      isDuplicateBrokerKeyError() {
        return false;
      },
      isDuplicateBrokerNameError() {
        return false;
      },
      async saveBrokerDefinition(payload: Record<string, unknown>) {
        savedDefinitions.push(payload);
        return {
          id: 'broker-1',
          ...payload,
          updatedAt: new Date('2026-04-04T00:05:00.000Z'),
        };
      },
    }),
  });
  Object.defineProperty(brokerDefinitionsService, 'brokerDefinitionService', {
    get: () => ({
      isSystemManagedBrokerKey(brokerKey: string) {
        return ['binance', 'binance_market_data'].includes(String(brokerKey || '').trim().toLowerCase());
      },
      async getPersistedDefinition() {
        const saved = savedDefinitions[savedDefinitions.length - 1];
        const accountConfig =
          saved.accountConfig && typeof saved.accountConfig === 'object'
            ? (saved.accountConfig as Record<string, unknown>)
            : {};
        return {
          id: 'broker-1',
          brokerKey: saved.brokerKey,
          name: saved.name,
          category: saved.category,
          status: saved.status,
          providerType: saved.providerType,
          linkedExchangeKey: saved.linkedExchangeKey ?? undefined,
          baseUrl: saved.baseUrl ?? undefined,
          capabilities: saved.capabilities ?? [],
          accountFields: Array.isArray(accountConfig.fields) ? accountConfig.fields : [],
          integrationGuide: saved.integrationGuide ?? undefined,
          diagnostics: saved.diagnosticsConfig ?? undefined,
          updatedAt: '2026-04-04T00:05:00.000Z',
          versionToken: '2026-04-04T00:05:00.000Z',
        };
      },
    }),
  });
  Object.defineProperty(brokerDefinitionsService, 'operationalEventService', {
    get: () => ({
      async logActivity(userId: string, payload: Record<string, unknown>) {
        definitionActivities.push({ userId, ...payload });
      },
      async emitFailureAlert() {
        throw new Error('runtime validation failures should not alert');
      },
    }),
  });

  await assert.rejects(
    brokerDefinitionsService.upsertDefinition(
      { userId: 'admin-1', role: 'admin' },
      {
        brokerKey: 'custom_broker',
        name: 'Custom Broker',
        category: 'broker',
        status: 'active',
        providerType: 'broker',
        capabilities: ['orders'],
        accountFields: [],
      }
    ),
    /Broker runtime module is not registered/
  );

  const successResponse = await brokerDefinitionsService.upsertDefinition(
    { userId: 'admin-1', role: 'admin' },
    {
      brokerKey: 'mudrex',
      name: 'Mudrex',
      category: 'broker',
      status: 'active',
      providerType: 'broker',
      capabilities: ['market'],
      accountFields: [],
    }
  );
  assert.equal(successResponse.data.brokerKey, 'mudrex');
  assert.equal(definitionActivities.length, 2);
  assert.equal(
    definitionActivities[definitionActivities.length - 1]?.title,
    'Broker definition updated: mudrex'
  );

  await assert.rejects(
    brokerDefinitionsService.upsertDefinition(
      { userId: 'admin-1', role: 'admin' },
      {
        brokerKey: 'binance_market_data',
        name: 'Binance market data',
        category: 'feed',
        status: 'active',
        providerType: 'feed',
        linkedExchangeKey: 'binance',
        capabilities: ['market'],
        accountFields: [],
      }
    ),
    /Exchange-managed feed definitions cannot be edited/
  );
}

async function runBrokerDefinitionStartupValidatorAssertions(): Promise<void> {
  const startupValidator = new BrokerDefinitionStartupValidator() as any;

  Object.defineProperty(startupValidator, 'brokerDefinitionService', {
    get: () => ({
      async listDefinitions() {
        return [
          {
            id: 'broker-1',
            brokerKey: 'mudrex',
            name: 'Mudrex',
            category: 'broker',
            status: 'active',
            providerType: 'broker',
            capabilities: ['market'],
            accountFields: [],
          },
        ];
      },
    }),
  });
  Object.defineProperty(startupValidator, 'brokerDefinitionRuntimeSupportService', {
    get: () => ({
      async validateDefinition() {
        throw new Error('providerType must match registered runtime providerType "exchange"');
      },
    }),
  });

  await assert.rejects(
    () => startupValidator.validate(),
    /Broker definition startup validation failed for mudrex: providerType must match registered runtime providerType "exchange"/
  );
}

async function runSystemBrokerConnectionHealthCheckAssertions(): Promise<void> {
  const service = new BrokerAccountsService() as any;

  Object.defineProperty(service, 'brokerAccountRepository', {
    get: () => ({
      async listSystemBrokerAccounts() {
        return [
          {
            id: 'acct-1',
            brokerKey: 'mudrex',
            accountKey: 'primary',
            accountName: 'Primary',
            status: 'Connected',
            settings: null,
          },
          {
            id: 'acct-2',
            brokerKey: 'delta_exchange',
            accountKey: 'backup',
            accountName: 'Backup',
            status: 'Connected',
            settings: null,
          },
          {
            id: 'acct-3',
            brokerKey: 'mudrex',
            accountKey: 'idle',
            accountName: 'Idle',
            status: 'Idle',
            settings: null,
          },
        ];
      },
    }),
  });
  Object.defineProperty(service, 'brokerDefinitionService', {
    get: () => ({
      async getRequiredDefinition(brokerKey: string) {
        return { brokerKey, baseUrl: undefined };
      },
    }),
  });
  service.testProviderConfiguration = async (definition: Record<string, unknown>) => {
    if (definition.brokerKey === 'delta_exchange') {
      throw new Error('Delta diagnostics failed');
    }
    return 'Configuration test passed';
  };

  const response = await service.runSystemBrokerConnectionHealthCheck();

  assert.equal(response.data.totalAccounts, 3);
  assert.equal(response.data.connectedAccounts, 2);
  assert.equal(response.data.testedAccounts, 2);
  assert.equal(response.data.passed, 1);
  assert.equal(response.data.failed, 1);
  assert.equal(response.data.items[0]?.passed, true);
  assert.equal(response.data.items[1]?.passed, false);
}

function runBrokerAccountsScriptWiringAssertions(): void {
  const packageSource = read('package.json');
  const packageJson = JSON.parse(packageSource) as { scripts?: Record<string, string> };
  const packageScripts = packageJson.scripts || {};
  const runPackageSuiteSource = read('scripts/_support/run-package-suite.ts');
  const smokeModulesSource = read('scripts/smokes/smoke-modules.sh');

  assert.equal(
    packageScripts['test:broker-accounts'],
    'node --import tsx scripts/_support/run-doc-aware-test.ts scripts/test-broker-accounts.ts'
  );
  assert.equal(
    packageScripts['check:broker-accounts-health'],
    'node --import tsx scripts/checks/check-broker-accounts-health.ts'
  );
  assert.equal(
    packageScripts['release-gate:broker-accounts'],
    'node --import tsx scripts/release-gates/release-gate-broker-accounts.ts'
  );
  assert.equal(
    packageScripts['signoff:broker-accounts'],
    'node --import tsx scripts/signoffs/signoff-broker-accounts.ts'
  );
  assert.match(runPackageSuiteSource, /'broker-accounts':\s*\['test:broker-accounts'\]/);
  assert.match(runPackageSuiteSource, /'release-baseline':\s*\[[\s\S]*'test:broker-accounts'/);
  assert.match(smokeModulesSource, /\/broker-accounts/);
}

async function main(): Promise<void> {
  await runBrokerAccountsControllerAssertions();
  await runInternalBrokerAccountsControllerAssertions();
  await runBrokerDefinitionsControllerAssertions();
  runBrokerAccountsValidationAssertions();
  await runBrokerAccountSecretHandlingAssertions();
  runBrokerDefinitionEntitySchemaAssertions();
  await runBrokerDefinitionServicePhase2Assertions();
  await runBrokerDefinitionLifecycleAssertions();
  await runBrokerDefinitionStartupValidatorAssertions();
  await runSystemBrokerConnectionHealthCheckAssertions();
  runBrokerAccountsScriptWiringAssertions();
  console.log('Broker accounts module assertions passed.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
