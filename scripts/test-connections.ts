import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ConnectionsController } from '../src/api/controllers/ConnectionsController';
import { ConnectionsService } from '../src/api/services/ConnectionsService';
import {
  validateConnectionActionBody,
  validateConnectionId,
  validateConnectionsQuery,
  validateConnectionUpsertBody,
  validateConnectionWorkspaceQuery,
} from '../src/api/validators/connections.validator';

function createSuccess<T>(data: T) {
  return { success: true as const, data };
}

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

const authReq = { authUser: { sub: 'user-1' } } as any;
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

async function runConnectionsControllerAssertions(): Promise<void> {
  const controller: any = new ConnectionsController();

  controller.connectionsService = {
    getConnections: async (...args: unknown[]) => createSuccess({ args }),
    getConnectionsSummary: async (...args: unknown[]) => createSuccess({ args }),
    getBrokerCatalog: async (...args: unknown[]) => createSuccess({ args }),
    getConnectionWorkspace: async (...args: unknown[]) => createSuccess({ args }),
    createConnection: async (...args: unknown[]) => createSuccess({ args }),
    updateConnectionDetails: async (...args: unknown[]) => createSuccess({ args }),
    getConnectionById: async (...args: unknown[]) => createSuccess({ args }),
    reconnectConnection: async (...args: unknown[]) => createSuccess({ args }),
    testConnection: async (...args: unknown[]) => createSuccess({ args }),
    deleteConnection: async (...args: unknown[]) => createSuccess({ args }),
  };

  assert.deepEqual(
    (await controller.getConnections(authReq, undefined, undefined, 'Connected', undefined)).data.args,
    ['user-1', { limit: undefined, offset: undefined, type: 'Connected', search: undefined }]
  );
  assert.deepEqual((await controller.getConnectionsSummary(authReq)).data.args, ['user-1']);
  assert.deepEqual((await controller.getBrokerCatalog(authReq)).data.args, ['user-1']);
  assert.deepEqual(
    (
      await controller.getConnectionWorkspace(
        authReq,
        'con-1',
        '10',
        '20',
        'primary',
        '4',
        'acct-1'
      )
    ).data.args,
    [
      'user-1',
      'con-1',
      {
        accountLimit: '10',
        accountOffset: '20',
        accountSearch: 'primary',
        activityLimit: '4',
        selectedAccountId: 'acct-1',
      },
    ]
  );
  assert.deepEqual(
    (await controller.createConnection(authReq, { name: 'Delta route', brokerKey: 'delta_exchange' }))
      .data.args,
    ['user-1', { name: 'Delta route', brokerKey: 'delta_exchange' }]
  );
  assert.deepEqual(
    (
      await controller.updateConnectionDetails(authReq, 'con-1', {
        name: 'Delta backup route',
        brokerKey: 'delta_exchange',
      })
    ).data.args,
    ['user-1', 'con-1', { name: 'Delta backup route', brokerKey: 'delta_exchange' }]
  );
  assert.deepEqual((await controller.getConnectionById(authReq, 'con-1')).data.args, [
    'user-1',
    'con-1',
  ]);
  assert.deepEqual((await controller.reconnectConnection(authReq, 'con-1')).data.args, [
    'user-1',
    'con-1',
    undefined,
  ]);
  assert.deepEqual((await controller.testConnection(authReq, 'con-1', { ping: true })).data.args, [
    'user-1',
    'con-1',
    { ping: true },
  ]);
  assert.deepEqual((await controller.deleteConnection(authReq, 'con-1')).data.args, [
    'user-1',
    'con-1',
  ]);

  await assertAuthRequired(() => controller.getConnections(unauthReq));
  await assertAuthRequired(() => controller.getConnectionsSummary(unauthReq));
  await assertAuthRequired(() => controller.getBrokerCatalog(unauthReq));
  await assertAuthRequired(() => controller.getConnectionWorkspace(unauthReq, 'con-1'));
  await assertAuthRequired(() => controller.createConnection(unauthReq, {}));
  await assertAuthRequired(() => controller.updateConnectionDetails(unauthReq, 'con-1', {}));
  await assertAuthRequired(() => controller.getConnectionById(unauthReq, 'con-1'));
  await assertAuthRequired(() => controller.reconnectConnection(unauthReq, 'con-1'));
  await assertAuthRequired(() => controller.testConnection(unauthReq, 'con-1', {}));
  await assertAuthRequired(() => controller.deleteConnection(unauthReq, 'con-1'));
}

function runConnectionsValidationAssertions(): void {
  assert.deepEqual(
    validateConnectionsQuery({
      limit: '25',
      offset: '5',
      type: ' Connected ',
      search: ' delta route ',
    }),
    {
      limit: 25,
      offset: 5,
      type: 'Connected',
      search: 'delta route',
    }
  );

  assert.deepEqual(
    validateConnectionWorkspaceQuery({
      accountLimit: '8',
      accountOffset: '2',
      accountSearch: ' primary ',
      activityLimit: '6',
      selectedAccountId: ' acct-1 ',
    }),
    {
      accountLimit: 8,
      accountOffset: 2,
      accountSearch: 'primary',
      activityLimit: 6,
      selectedAccountId: 'acct-1',
    }
  );

  assert.deepEqual(validateConnectionActionBody({}), {
    reason: 'Operator initiated action',
    mode: 'diagnostic',
    accountId: '',
  });
  assert.deepEqual(
    validateConnectionActionBody({
      reason: '  reconnect now  ',
      mode: ' manual ',
      accountId: ' acct-9 ',
    }),
    {
      reason: 'reconnect now',
      mode: 'manual',
      accountId: 'acct-9',
    }
  );

  assert.equal(validateConnectionId('  conn-1  '), 'conn-1');
  assert.deepEqual(
    validateConnectionUpsertBody({
      name: ' Delta Route ',
      brokerKey: ' Delta Exchange ',
      mode: ' Backup ',
      route: ' Ops backup ',
      scope: ' Orders ',
    }),
    {
      name: 'Delta Route',
      brokerKey: 'delta_exchange',
      mode: 'Backup',
      route: 'Ops backup',
      scope: 'Orders',
    }
  );
}

async function runConnectionsCatalogAssertions(): Promise<void> {
  const service = new ConnectionsService() as any;

  service.brokerDefinitionService = {
    async listPersistedDefinitions() {
      return [
        {
          id: 'broker-delta',
          brokerKey: 'delta_exchange',
          name: 'Delta Exchange',
          category: 'broker',
          providerType: 'broker',
          linkedExchangeKey: undefined,
          baseUrl: 'https://api.delta.exchange',
          capabilities: ['assets', 'orders', 'diagnostics'],
          accountFields: [{ key: 'apiKey', label: 'API key', required: true }],
          integrationGuide: {
            summary: 'Orders, positions, balances',
          },
          diagnostics: {
            requiresAccount: true,
            successStatus: 'Connected',
            failureStatus: 'Disconnected',
            resetStatus: 'Idle',
          },
        },
      ];
    },
  };
  service.exchangeRepository = {
    async listActiveExchanges() {
      return [
        {
          id: 'exchange-binance',
          exchangeKey: 'binance',
          name: 'Binance',
          baseUrl: 'https://fapi.binance.com',
        },
        {
          id: 'exchange-delta',
          exchangeKey: 'delta_exchange',
          name: 'Delta Exchange',
          baseUrl: 'https://api.delta.exchange',
        },
      ];
    },
  };

  const response = await service.getBrokerCatalog('user-1');
  assert.equal(response.data.total, 2);
  assert.equal(response.data.providersTotal, 1);
  assert.equal(response.data.exchangesTotal, 1);
  assert.equal(response.data.providerItems[0]?.entityType, 'provider');
  assert.equal(response.data.providerItems[0]?.brokerKey, 'delta_exchange');
  assert.equal(response.data.exchangeItems[0]?.entityType, 'exchange');
  assert.equal(response.data.exchangeItems[0]?.brokerKey, 'binance');
  assert.equal(response.data.exchangeItems[0]?.name, 'Binance market data');
}

async function runConnectionsCanonicalizationAssertions(): Promise<void> {
  const service = new ConnectionsService() as any;
  const createdPayloads: Array<Record<string, unknown>> = [];
  const replacedPayloads: Array<{
    userId: string;
    connectionId: string;
    payload: Record<string, unknown>;
  }> = [];
  const connectionUpdates: Array<{
    userId: string;
    connectionId: string;
    payload: Record<string, unknown>;
  }> = [];
  const accountUpdates: Array<{
    userId: string;
    accountId: string;
    payload: Record<string, unknown>;
  }> = [];
  const productMapRequests: Array<{ userId: string; source?: string }> = [];

  const definition = {
    id: 'broker-def-1',
    brokerId: 'broker-def-1',
    brokerKey: 'delta_exchange',
    name: 'Delta Exchange',
    category: 'broker',
    providerType: 'broker',
    linkedExchangeKey: undefined,
    capabilities: ['assets', 'market', 'orders', 'diagnostics'],
    accountFields: [
      {
        key: 'apiKey',
        label: 'API key',
        required: true,
      },
      {
        key: 'apiSecret',
        label: 'API secret',
        required: true,
        secret: true,
      },
    ],
    integrationGuide: {
      summary: 'Orders, positions, balances',
      notes: ['No batch order support'],
    },
    diagnostics: {
      successStatus: 'Stable',
      failureStatus: 'Broken',
      resetStatus: 'Idle',
    },
  };
  const binanceDefinition = {
    id: 'exchange-binance',
    brokerKey: 'binance',
    name: 'Binance market data',
    category: 'feed',
    providerType: 'feed',
    linkedExchangeKey: 'binance',
    capabilities: ['market', 'diagnostics'],
    accountFields: [],
    integrationGuide: {
      summary: 'Public futures candles and market-data reachability checks',
    },
    diagnostics: {
      successStatus: 'Connected',
      failureStatus: 'Disconnected',
      resetStatus: 'Idle',
    },
  };

  let persistedConnection: Record<string, any> = {
    id: 'conn-1',
    userId: 'user-1',
    name: 'Delta route',
    broker: 'Legacy Delta',
    brokerKey: 'delta_exchange',
    brokerId: 'broker-def-1',
    type: 'broker',
    status: 'failed',
    latency: '24ms',
    mode: 'Primary',
    lastSyncAt: new Date('2026-04-04T08:00:00.000Z'),
    diagnosticSummary: 'Legacy sync note',
    route: 'Primary execution',
    scope: 'Orders',
    createdAt: new Date('2026-04-04T07:00:00.000Z'),
    updatedAt: new Date('2026-04-04T08:00:00.000Z'),
  };

  service.connectionRepository = {
    async listConnections() {
      return { items: [persistedConnection], total: 1 };
    },
    async getConnectionsSummary() {
      return {
        healthyConnections: 1,
        watchingConnections: 0,
        disconnected: 0,
        syncHealth: 'Routes stable',
        connected: 1,
        feeds: 0,
        brokerRoutes: 1,
      };
    },
    async createConnection(payload: Record<string, unknown>) {
      createdPayloads.push(payload);
      return {
        id: 'conn-created',
        createdAt: new Date('2026-04-04T09:00:00.000Z'),
        updatedAt: new Date('2026-04-04T09:00:00.000Z'),
        ...payload,
      };
    },
    async getConnectionById() {
      return persistedConnection;
    },
    async updateConnection(userId: string, connectionId: string, payload: Record<string, unknown>) {
      connectionUpdates.push({ userId, connectionId, payload });
    },
    async replaceConnection(userId: string, connectionId: string, payload: Record<string, unknown>) {
      replacedPayloads.push({ userId, connectionId, payload });
      persistedConnection = {
        ...persistedConnection,
        ...payload,
        updatedAt: new Date('2026-04-04T09:05:00.000Z'),
      };
    },
  };

  service.brokerAccountRepository = {
    async getBrokerAccountCountsByConnectionIds() {
      return new Map([['conn-1', 2]]);
    },
    async getBrokerAccountCountByConnectionId() {
      return 2;
    },
    async getPreferredBrokerAccountByConnectionId() {
      return {
        id: 'acct-1',
        connectionId: 'conn-1',
        brokerKey: 'delta_exchange',
        status: 'Idle',
      };
    },
    async getBrokerAccountById() {
      return {
        id: 'acct-1',
        connectionId: 'conn-1',
        brokerKey: 'delta_exchange',
        status: 'Stable',
        updatedAt: new Date('2026-04-04T09:10:00.000Z'),
      };
    },
    async getBrokerAccountsByConnectionId() {
      return [
        {
          id: 'acct-1',
          connectionId: 'conn-1',
          brokerKey: 'delta_exchange',
          accountName: 'Delta Primary',
          accountKey: 'delta_primary',
          isDefault: true,
        },
        {
          id: 'acct-2',
          connectionId: 'conn-1',
          brokerKey: 'delta_exchange',
          accountName: 'Delta Backup',
          accountKey: 'delta_backup',
          isDefault: false,
        },
      ];
    },
    async updateBrokerAccount(userId: string, accountId: string, payload: Record<string, unknown>) {
      accountUpdates.push({ userId, accountId, payload });
    },
    async deleteBrokerAccountsByConnectionId() {
      return 0;
    },
  };

  service.brokerAccountsService = {
    async getBrokerAccounts() {
      return {
        data: {
          items: [
            {
              id: 'acct-1',
              connectionId: 'conn-1',
              brokerKey: 'delta_exchange',
              accountKey: 'delta_primary',
              accountName: 'Delta Primary',
              status: 'Connected',
              isDefault: true,
              lastSyncAt: '2026-04-04T09:00:00.000Z',
              hasApiKey: true,
              hasApiSecret: true,
            },
          ],
          total: 2,
          limit: 10,
          offset: 0,
        },
      };
    },
    async getBrokerAccountItemById(_userId: string, accountId: string) {
      if (accountId !== 'acct-1') {
        return null;
      }

      return {
        id: 'acct-1',
        connectionId: 'conn-1',
        brokerKey: 'delta_exchange',
        accountKey: 'delta_primary',
        accountName: 'Delta Primary',
        status: 'Connected',
        isDefault: true,
        lastSyncAt: '2026-04-04T09:00:00.000Z',
        hasApiKey: true,
        hasApiSecret: true,
      };
    },
  };

  service.brokerDefinitionService = {
    async listActiveDefinitions() {
      return [definition, binanceDefinition];
    },
    async getRequiredDefinition(brokerKey: string) {
      if (String(brokerKey || '').trim().toLowerCase() === 'binance') {
        return binanceDefinition;
      }
      return definition;
    },
  };

  service.exchangeRepository = {
    async getExchangeByKey() {
      return { id: 'exchange-1' };
    },
  };

  service.brokerDiagnosticsService = {
    async testConnection() {
      return { detail: 'Signed wallet reachable' };
    },
    async getStatusConfig() {
      return definition.diagnostics;
    },
  };

  service.operationalEventService = {
    async logActivity() {
      return;
    },
    async emitFailureAlert() {
      return;
    },
  };

  service.activityService = {
    async getActivity() {
      return {
        data: {
          items: [
            {
              id: 'activity-1',
              type: 'Connection diagnostics',
              title: 'Connection test passed: delta_exchange',
              status: 'Success',
              actor: 'user-1',
              time: '2026-04-04T09:00:00.000Z',
              symbol: '',
              route: 'Brokers data',
              description: 'Signed wallet reachable',
              referenceId: 'conn-1',
              stream: 'Controls',
              related: 'delta_exchange',
            },
          ],
          total: 1,
          limit: 4,
          offset: 0,
        },
      };
    },
  };

  service.exchangeAssetRepository = {
    async countVisibleAssetsForUser(userId: string, source?: string) {
      productMapRequests.push({ userId, source });
      return 7;
    },
  };

  const createResponse = await service.createConnection('user-1', {
    name: 'Delta execution',
    brokerKey: 'delta_exchange',
  });

  assert.equal(createdPayloads.length, 1);
  assert.equal(createdPayloads[0].type, 'broker');
  assert.equal(Object.prototype.hasOwnProperty.call(createdPayloads[0], 'exchangeId'), false);
  assert.equal(createdPayloads[0].status, 'Idle');
  assert.equal(createdPayloads[0].lastSyncAt, null);
  assert.equal(createdPayloads[0].route, 'Delta Exchange route');
  assert.equal(createResponse.data.status, 'Idle');
  assert.equal(createResponse.data.diagnosticSummary, undefined);
  assert.equal(createResponse.data.accountCount, 0);
  assert.equal(Object.prototype.hasOwnProperty.call(createResponse.data, 'exchangeId'), false);

  const listResponse = await service.getConnections('user-1', {
    limit: '20',
    offset: '0',
    search: 'delta',
  });

  assert.equal(listResponse.data.items.length, 1);
  assert.equal(listResponse.data.items[0].broker, 'Delta Exchange');
  assert.equal(listResponse.data.items[0].status, 'Disconnected');
  assert.equal(listResponse.data.items[0].diagnosticSummary, 'Legacy sync note');
  assert.equal(listResponse.data.items[0].accountCount, 2);
  assert.equal(Object.prototype.hasOwnProperty.call(listResponse.data.items[0], 'exchangeId'), false);

  const detailResponse = await service.getConnectionById('user-1', 'conn-1');
  assert.equal(detailResponse.data.id, 'conn-1');
  assert.equal(detailResponse.data.brokerId, 'broker-def-1');
  assert.equal(Object.prototype.hasOwnProperty.call(detailResponse.data, 'exchangeId'), false);

  const workspaceResponse = await service.getConnectionWorkspace('user-1', 'conn-1', {
    accountLimit: '10',
    accountOffset: '0',
    activityLimit: '4',
    selectedAccountId: 'acct-1',
  });

  assert.equal(workspaceResponse.data.connection.id, 'conn-1');
  assert.equal(workspaceResponse.data.definition?.purpose, 'Orders, positions, balances');
  assert.deepEqual(workspaceResponse.data.definition?.capabilities, [
    'assets',
    'market',
    'orders',
    'diagnostics',
  ]);
  assert.equal(workspaceResponse.data.definition?.requiredAuth, 'API key, API secret');
  assert.deepEqual(workspaceResponse.data.definition?.limitations, ['No batch order support']);
  assert.equal(workspaceResponse.data.accounts.total, 2);
  assert.equal(workspaceResponse.data.selectedAccount?.id, 'acct-1');
  assert.equal(
    Object.prototype.hasOwnProperty.call(workspaceResponse.data.connection, 'exchangeId'),
    false
  );
  assert.equal(workspaceResponse.data.connection.integrity?.status, 'ok');
  assert.equal(
    workspaceResponse.data.connection.integrity?.checks.some(
      (item: { id: string; status: string }) =>
        item.id === 'account-routing' && item.status === 'ok'
    ),
    true
  );
  assert.equal(
    workspaceResponse.data.connection.integrity?.checks.some(
      (item: { id: string }) => item.id === 'exchange-link'
    ),
    false
  );
  assert.equal(workspaceResponse.data.selectedAccount?.integrity?.status, 'ok');
  assert.equal(
    workspaceResponse.data.selectedAccount?.integrity?.checks.some(
      (item: { id: string; status: string }) =>
        item.id === 'credential-coverage' && item.status === 'ok'
    ),
    true
  );
  assert.equal(workspaceResponse.data.activity.total, 1);
  assert.equal(workspaceResponse.data.productMap.supported, true);
  assert.equal(workspaceResponse.data.productMap.total, 7);
  assert.deepEqual(productMapRequests, [{ userId: 'user-1', source: 'delta_exchange' }]);

  const updateResponse = await service.updateConnectionDetails('user-1', 'conn-1', {
    name: 'Delta backup route',
    brokerKey: 'delta_exchange',
    mode: 'Backup',
    route: 'Backup execution',
    scope: 'Orders',
  });
  assert.equal(replacedPayloads.length, 1);
  assert.equal(replacedPayloads[0].connectionId, 'conn-1');
  assert.equal(replacedPayloads[0].payload.brokerId, 'broker-def-1');
  assert.equal(
    Object.prototype.hasOwnProperty.call(replacedPayloads[0].payload, 'exchangeId'),
    false
  );
  assert.equal(updateResponse.data.name, 'Delta backup route');
  assert.equal(updateResponse.data.mode, 'Backup');
  assert.equal(updateResponse.data.route, 'Backup execution');
  assert.equal(updateResponse.data.scope, 'Orders');
  assert.equal(updateResponse.data.status, 'Disconnected');
  assert.equal(Object.prototype.hasOwnProperty.call(updateResponse.data, 'exchangeId'), false);

  const binanceCreateResponse = await service.createConnection('user-1', {
    name: 'Binance feed',
    brokerKey: 'binance',
  });
  assert.equal(createdPayloads.length, 2);
  assert.equal(createdPayloads[1].type, 'feed');
  assert.equal(createdPayloads[1].brokerId, null);
  assert.equal(createdPayloads[1].route, 'Binance market data feed');
  assert.equal(Object.prototype.hasOwnProperty.call(createdPayloads[1], 'exchangeId'), false);
  assert.equal(binanceCreateResponse.data.brokerKey, 'binance');
  assert.equal(binanceCreateResponse.data.category, 'feed');
  assert.equal(binanceCreateResponse.data.providerType, 'feed');
  assert.equal(binanceCreateResponse.data.brokerId, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(binanceCreateResponse.data, 'exchangeId'), false);

  const binanceProviderIds = await service.resolveProviderIds({
    id: 'exchange-binance',
    brokerKey: 'binance',
    providerType: 'feed',
    linkedExchangeKey: 'binance',
  });
  assert.deepEqual(binanceProviderIds, {
    brokerId: null,
  });

  const binancePayload = service.buildConnectionRecordPayload(
    {
      name: 'Binance feed',
      brokerKey: 'binance',
    },
    {
      id: 'exchange-binance',
      name: 'Binance market data',
      brokerKey: 'binance',
      category: 'feed',
      capabilities: ['market', 'diagnostics'],
      accountFields: [],
      linkedExchangeKey: 'binance',
      integrationGuide: {
        summary: 'Public futures candles and market-data reachability checks',
      },
    },
    binanceProviderIds
  );
  assert.equal(binancePayload.brokerId, null);
  assert.equal(Object.prototype.hasOwnProperty.call(binancePayload, 'exchangeId'), false);

  const binanceIntegrity = service.buildConnectionIntegrity(
    {
      id: 'conn-feed-1',
      brokerKey: 'binance',
      brokerId: null,
      type: 'feed',
      status: 'idle',
    },
    {
      name: 'Binance market data',
      brokerKey: 'binance',
      category: 'feed',
      providerType: 'feed',
      linkedExchangeKey: 'binance',
    },
    []
  );
  assert.equal(binanceIntegrity.status, 'ok');
  assert.equal(
    binanceIntegrity.checks.some(
      (item: { id: string; status: string }) =>
        item.id === 'provider-link' && item.status === 'ok'
    ),
    true
  );
  assert.equal(
    binanceIntegrity.checks.some(
      (item: { id: string; status: string }) =>
        item.id === 'exchange-link' && item.status === 'ok'
    ),
    true
  );
  assert.equal(
    service.supportsProductMap({
      category: 'feed',
      providerType: 'feed',
      capabilities: ['market'],
      linkedExchangeKey: 'binance',
    }),
    true
  );

  const summaryResponse = await service.getConnectionsSummary('user-1');
  assert.equal(summaryResponse.data.healthyConnections, 1);
  assert.equal(summaryResponse.data.brokerRoutes, 1);

  const diagnosticsResponse = await service.testConnection('user-1', 'conn-1');
  assert.equal(diagnosticsResponse.data.status, 'Stable');
  assert.equal(connectionUpdates.length, 1);
  assert.equal(connectionUpdates[0].payload.status, 'Connected');
  assert.equal(connectionUpdates[0].payload.diagnosticSummary, 'Signed wallet reachable');
  assert.equal(accountUpdates.length, 1);
  assert.equal(accountUpdates[0].payload.status, 'Stable');
}

async function runConnectionsReconnectAndDeleteAssertions(): Promise<void> {
  const service = new ConnectionsService() as any;
  const connectionUpdates: Array<Record<string, unknown>> = [];
  const accountUpdates: Array<Record<string, unknown>> = [];
  const activityCalls: Array<Record<string, unknown>> = [];

  service.connectionRepository = {
    async getConnectionById(_userId: string, connectionId: string) {
      return {
        id: connectionId,
        userId: 'user-1',
        name: 'Delta route',
        brokerKey: 'delta_exchange',
        brokerId: 'broker-def-1',
        type: 'broker',
        status: 'Connected',
        lastSyncAt: new Date('2026-04-06T09:00:00.000Z'),
      };
    },
    async updateConnection(_userId: string, _connectionId: string, payload: Record<string, unknown>) {
      connectionUpdates.push(payload);
    },
    async deleteConnection() {
      return true;
    },
  };
  service.brokerAccountRepository = {
    async getBrokerAccountById(_userId: string, accountId: string) {
      return {
        id: accountId,
        connectionId: 'conn-1',
        brokerKey: 'delta_exchange',
        status: 'Retrying',
        updatedAt: new Date('2026-04-06T09:05:00.000Z'),
      };
    },
    async getPreferredBrokerAccountByConnectionId() {
      return {
        id: 'acct-1',
        connectionId: 'conn-1',
        brokerKey: 'delta_exchange',
        status: 'Connected',
        updatedAt: new Date('2026-04-06T09:05:00.000Z'),
      };
    },
    async updateBrokerAccount(_userId: string, _accountId: string, payload: Record<string, unknown>) {
      accountUpdates.push(payload);
    },
    async deleteBrokerAccountsByConnectionId() {
      return 2;
    },
  };
  service.brokerDiagnosticsService = {
    async getStatusConfig() {
      return {
        resetStatus: 'Retrying',
        successStatus: 'Stable',
        failureStatus: 'Broken',
      };
    },
  };
  service.operationalEventService = {
    async logActivity(_userId: string, payload: Record<string, unknown>) {
      activityCalls.push(payload);
    },
    async emitFailureAlert() {
      return;
    },
  };

  const reconnectResponse = await service.reconnectConnection('user-1', 'conn-1', {
    reason: 'refresh broker session',
    accountId: 'acct-1',
  });
  assert.equal(reconnectResponse.data.message, 'Reconnect initiated');
  assert.equal(reconnectResponse.data.connection.id, 'conn-1');
  assert.equal(reconnectResponse.data.account?.id, 'acct-1');
  assert.equal(connectionUpdates.length, 1);
  assert.equal(connectionUpdates[0].status, 'Idle');
  assert.equal(accountUpdates.length, 1);
  assert.equal(accountUpdates[0].status, 'Retrying');

  const deleteResponse = await service.deleteConnection('user-1', 'conn-1');
  assert.equal(deleteResponse.data.message, 'Connection deleted');
  assert.equal(deleteResponse.data.connectionId, 'conn-1');
  assert.equal(deleteResponse.data.accountsDeleted, 2);
  assert.equal(
    activityCalls.some(
      (item) => item.title === 'Connection reconnect initiated: delta_exchange'
    ),
    true
  );
  assert.equal(
    activityCalls.some((item) => item.title === 'Connection removed: delta_exchange'),
    true
  );
}

function runConnectionsScriptWiringAssertions(): void {
  const packageSource = read('package.json');
  const packageJson = JSON.parse(packageSource) as { scripts?: Record<string, string> };
  const packageScripts = packageJson.scripts || {};
  const runPackageSuiteSource = read('scripts/_support/run-package-suite.ts');
  const smokeModulesSource = read('scripts/smokes/smoke-modules.sh');

  assert.equal(
    packageScripts['test:connections'],
    'node --import tsx scripts/_support/run-doc-aware-test.ts scripts/test-connections.ts'
  );
  assert.equal(runPackageSuiteSource.includes("connections: ['test:connections']"), true);
  assert.equal(runPackageSuiteSource.includes("'test:connections'"), true);
  assert.equal(
    smokeModulesSource.includes('/connections') &&
      smokeModulesSource.includes('/connections/summary'),
    true,
    'connections smoke should exercise the list and summary APIs'
  );
  assert.equal(
    packageScripts['check:connections-health'],
    'node --import tsx scripts/checks/check-connections-health.ts'
  );
  assert.equal(
    packageScripts['release-gate:connections'],
    'node --import tsx scripts/release-gates/release-gate-connections.ts'
  );
  assert.equal(
    packageScripts['signoff:connections'],
    'node --import tsx scripts/signoffs/signoff-connections.ts'
  );
}

async function main(): Promise<void> {
  await runConnectionsControllerAssertions();
  runConnectionsValidationAssertions();
  await runConnectionsCatalogAssertions();
  await runConnectionsCanonicalizationAssertions();
  await runConnectionsReconnectAndDeleteAssertions();
  runConnectionsScriptWiringAssertions();
  console.log('Connections module assertions passed.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
