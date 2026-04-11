import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import {
  BrokerCatalogItem,
  BrokerCatalogResponse,
  ConnectionActionBody,
  ConnectionDefinitionSummary,
  ConnectionDeleteResult,
  ConnectionItem,
  ConnectionWorkspaceResponse,
  ConnectionsListResponse,
  ConnectionsSummary,
  ConnectionReconnectResult,
  ConnectionTestResult,
  ConnectionUpsertBody,
} from '../contracts/Connection';
import { BrokerAccountItem } from '../contracts/BrokerAccount';
import { IntegrityCheckItem, IntegritySummary } from '../contracts/Integrity';
import { BadRequestAppError, NotFoundAppError } from '../errors/AppError';
import { successResponse } from '../utils/response';
import {
  ConnectionWorkspaceQuery,
  ConnectionsQuery,
  validateConnectionActionBody,
  validateConnectionId,
  validateConnectionWorkspaceQuery,
  validateConnectionsQuery,
  validateConnectionUpsertBody,
} from '../validators/connections.validator';
import { Connection, Exchange } from '../../database';
import { ConnectionRepository } from '../../database';
import { BrokerAccountRepository } from '../../database';
import { ExchangeAssetRepository } from '../../database';
import { ExchangeRepository } from '../../database';
import { BrokerDefinitionService } from '../../brokers';
import { BrokerDiagnosticsService } from '../../brokers';
import { ActivityService } from './ActivityService';
import { BrokerAccountsService } from './BrokerAccountsService';
import { OperationalEventService } from './OperationalEventService';

@Service()
export class ConnectionsService {
  @Inject(() => ConnectionRepository)
  private connectionRepository!: ConnectionRepository;

  @Inject(() => BrokerAccountRepository)
  private brokerAccountRepository!: BrokerAccountRepository;

  @Inject(() => ExchangeRepository)
  private exchangeRepository!: ExchangeRepository;

  @Inject(() => ExchangeAssetRepository)
  private exchangeAssetRepository!: ExchangeAssetRepository;

  @Inject(() => BrokerDefinitionService)
  private brokerDefinitionService!: BrokerDefinitionService;

  @Inject(() => BrokerDiagnosticsService)
  private brokerDiagnosticsService!: BrokerDiagnosticsService;

  @Inject(() => BrokerAccountsService)
  private brokerAccountsService!: BrokerAccountsService;

  @Inject(() => ActivityService)
  private activityService!: ActivityService;

  @Inject(() => OperationalEventService)
  private operationalEventService!: OperationalEventService;

  async getConnections(
    userId: string,
    query: ConnectionsQuery
  ): Promise<ApiSuccessResponse<ConnectionsListResponse>> {
    const params = validateConnectionsQuery(query);
    const { items, total } = await this.connectionRepository.listConnections(userId, params);
    const definitions = await this.brokerDefinitionService.listActiveDefinitions();
    const definitionsByKey = new Map(definitions.map((definition) => [definition.brokerKey, definition]));
    const accountCounts = await this.brokerAccountRepository.getBrokerAccountCountsByConnectionIds(
      userId,
      items.map((item) => item.id)
    );

    return successResponse({
      items: items.map((item) =>
        this.mapConnection(
          item,
          definitionsByKey.get(item.brokerKey),
          accountCounts.get(item.id) ?? 0
        )
      ),
      total,
      limit: params.limit,
      offset: params.offset,
    });
  }

  async getConnectionsSummary(userId: string): Promise<ApiSuccessResponse<ConnectionsSummary>> {
    return successResponse(await this.connectionRepository.getConnectionsSummary(userId));
  }

  async getBrokerCatalog(userId: string): Promise<ApiSuccessResponse<BrokerCatalogResponse>> {
    void userId;
    const [definitions, exchanges] = await Promise.all([
      this.brokerDefinitionService.listPersistedDefinitions({ includeInactive: false }),
      this.exchangeRepository.listActiveExchanges(),
    ]);
    const providerItems = definitions.map((definition) => this.mapBrokerCatalogDefinition(definition));
    const exchangeItems = this.mapExchangeCatalogItems(exchanges);
    const items = [...providerItems, ...exchangeItems];

    return successResponse({
      items,
      providerItems,
      exchangeItems,
      total: items.length,
      providersTotal: providerItems.length,
      exchangesTotal: exchangeItems.length,
    });
  }

  private mapBrokerCatalogDefinition(definition: {
    id: string;
    brokerKey: string;
    name: string;
    category: string;
    providerType?: string;
    linkedExchangeKey?: string;
    baseUrl?: string;
    capabilities: string[];
    accountFields: BrokerCatalogItem['accountFields'];
    integrationGuide?: BrokerCatalogItem['integrationGuide'];
    diagnostics?: BrokerCatalogItem['diagnostics'];
  }): BrokerCatalogItem {
    return {
      id: definition.id,
      brokerKey: definition.brokerKey,
      entityType: 'provider',
      name: definition.name,
      category: definition.category,
      providerType: definition.providerType,
      linkedExchangeKey: definition.linkedExchangeKey,
      baseUrl: definition.baseUrl,
      capabilities: definition.capabilities,
      accountFields: definition.accountFields,
      integrationGuide: definition.integrationGuide,
      diagnostics: definition.diagnostics,
    };
  }

  private mapExchangeCatalogItems(exchanges: Exchange[]): BrokerCatalogItem[] {
    return exchanges
      .map((exchange) => this.mapExchangeCatalogItem(exchange))
      .filter((item): item is BrokerCatalogItem => Boolean(item));
  }

  private mapExchangeCatalogItem(exchange: Exchange): BrokerCatalogItem | null {
    const exchangeKey = String(exchange.exchangeKey || '').trim().toLowerCase();

    if (exchangeKey !== 'binance') {
      return null;
    }

    const exchangeName = String(exchange.name || 'Binance').trim() || 'Binance';

    return {
      id: exchange.id,
      brokerKey: exchangeKey,
      exchangeKey,
      entityType: 'exchange',
      name: `${exchangeName} market data`,
      category: 'feed',
      providerType: 'feed',
      linkedExchangeKey: exchangeKey,
      baseUrl: exchange.baseUrl ?? undefined,
      capabilities: ['diagnostics', 'market'],
      accountFields: [],
      integrationGuide: {
        summary: 'Public futures candles and market-data reachability checks',
      },
      diagnostics: {
        requiresAccount: false,
        successStatus: 'Connected',
        failureStatus: 'Disconnected',
        resetStatus: 'Idle',
      },
    };
  }

  async createConnection(
    userId: string,
    body: ConnectionUpsertBody
  ): Promise<ApiSuccessResponse<ConnectionItem>> {
    try {
      const payload = validateConnectionUpsertBody(body);
      const definition = await this.brokerDefinitionService.getRequiredDefinition(payload.brokerKey);
      const providerIds = await this.resolveProviderIds(definition);
      const created = await this.connectionRepository.createConnection({
        userId,
        ...this.buildConnectionRecordPayload(payload, definition, providerIds),
      });

      await this.operationalEventService.logActivity(userId, {
        type: 'Connection',
        title: `Connection created: ${created.brokerKey}`,
        status: 'Success',
        route: 'Brokers data',
        stream: 'Controls',
        related: created.brokerKey,
        referenceId: created.id,
        description: `Created connection ${created.name}`,
      });

      return successResponse(this.mapConnection(created, definition, 0));
    } catch (error) {
      await this.operationalEventService.logActivity(userId, {
        type: 'Connection',
        title: 'Connection create failed',
        status: 'Failed',
        route: 'Brokers data',
        stream: 'Controls',
        related: String(body?.brokerKey || 'connection'),
        description: error instanceof Error ? error.message : String(error),
      });
      await this.operationalEventService.emitFailureAlert(userId, {
        channel: 'Brokers',
        source: String(body?.brokerKey || 'connections'),
        message: `Connection create failed: ${error instanceof Error ? error.message : String(error)}`,
        route: 'Risk review',
      });
      throw error;
    }
  }

  async updateConnectionDetails(
    userId: string,
    connectionId: string,
    body: ConnectionUpsertBody
  ): Promise<ApiSuccessResponse<ConnectionItem>> {
    try {
      const validatedConnectionId = validateConnectionId(connectionId);
      const payload = validateConnectionUpsertBody(body);
      const definition = await this.brokerDefinitionService.getRequiredDefinition(payload.brokerKey);
      const item = await this.connectionRepository.getConnectionById(userId, validatedConnectionId);

      if (!item) {
        throw new NotFoundAppError('Connection not found');
      }

      const providerIds = await this.resolveProviderIds(definition);

      await this.connectionRepository.replaceConnection(
        userId,
        validatedConnectionId,
        this.buildConnectionRecordPayload(payload, definition, providerIds, item)
      );

      const updated = await this.connectionRepository.getConnectionById(userId, validatedConnectionId);

      if (!updated) {
        throw new NotFoundAppError('Connection not found');
      }

      await this.operationalEventService.logActivity(userId, {
        type: 'Connection',
        title: `Connection updated: ${updated.brokerKey}`,
        status: 'Success',
        route: 'Brokers data',
        stream: 'Controls',
        related: updated.brokerKey,
        referenceId: updated.id,
        description: `Updated connection ${updated.name}`,
      });

      const accountCount = await this.brokerAccountRepository.getBrokerAccountCountByConnectionId(
        userId,
        updated.id
      );

      return successResponse(this.mapConnection(updated, definition, accountCount));
    } catch (error) {
      await this.operationalEventService.logActivity(userId, {
        type: 'Connection',
        title: 'Connection update failed',
        status: 'Failed',
        route: 'Brokers data',
        stream: 'Controls',
        related: String(body?.brokerKey || 'connection'),
        referenceId: connectionId,
        description: error instanceof Error ? error.message : String(error),
      });
      await this.operationalEventService.emitFailureAlert(userId, {
        channel: 'Brokers',
        source: String(body?.brokerKey || 'connections'),
        message: `Connection update failed (${connectionId}): ${
          error instanceof Error ? error.message : String(error)
        }`,
        route: 'Risk review',
      });
      throw error;
    }
  }

  async getConnectionById(userId: string, connectionId: string): Promise<ApiSuccessResponse<ConnectionItem>> {
    const validatedConnectionId = validateConnectionId(connectionId);
    const item = await this.connectionRepository.getConnectionById(userId, validatedConnectionId);

    if (!item) {
      throw new NotFoundAppError('Connection not found');
    }

    let definition = null;
    try {
      definition = await this.brokerDefinitionService.getRequiredDefinition(item.brokerKey);
    } catch {
      definition = null;
    }

    const accountCount = await this.brokerAccountRepository.getBrokerAccountCountByConnectionId(
      userId,
      item.id
    );

    return successResponse(this.mapConnection(item, definition, accountCount));
  }

  async getConnectionWorkspace(
    userId: string,
    connectionId: string,
    query: ConnectionWorkspaceQuery = {}
  ): Promise<ApiSuccessResponse<ConnectionWorkspaceResponse>> {
    const validatedConnectionId = validateConnectionId(connectionId);
    const params = validateConnectionWorkspaceQuery(query);
    const item = await this.connectionRepository.getConnectionById(userId, validatedConnectionId);

    if (!item) {
      throw new NotFoundAppError('Connection not found');
    }

    let definition = null;
    try {
      definition = await this.brokerDefinitionService.getRequiredDefinition(item.brokerKey);
    } catch {
      definition = null;
    }

    const [accountsResponse, activityResponse, selectedAccount, productMap, allAccounts] =
      await Promise.all([
        this.brokerAccountsService.getBrokerAccounts(userId, {
          limit: String(params.accountLimit),
          offset: String(params.accountOffset),
          connectionId: validatedConnectionId,
          search: params.accountSearch,
        }),
        this.activityService.getActivity(userId, {
          limit: String(params.activityLimit),
          offset: '0',
          stream: 'controls',
          route: 'Brokers data',
          referenceId: validatedConnectionId,
        }),
        this.resolveWorkspaceSelectedAccount(userId, validatedConnectionId, params.selectedAccountId),
        this.resolveConnectionProductMapSummary(userId, item, definition),
        this.brokerAccountRepository.getBrokerAccountsByConnectionId(
          userId,
          validatedConnectionId
        ),
      ]);

    const connectionIntegrity = this.buildConnectionIntegrity(item, definition, allAccounts);
    const selectedAccountWithIntegrity = selectedAccount
      ? {
          ...selectedAccount,
          integrity: this.buildAccountIntegrity(
            selectedAccount,
            item,
            definition,
            allAccounts
          ),
        }
      : null;

    return successResponse({
      connection: this.mapConnection(
        item,
        definition,
        accountsResponse.data.total,
        connectionIntegrity
      ),
      definition: this.buildConnectionDefinitionSummary(definition),
      selectedAccount: selectedAccountWithIntegrity,
      accounts: accountsResponse.data,
      activity: activityResponse.data,
      productMap,
    });
  }

  async reconnectConnection(
    userId: string,
    connectionId: string,
    body: ConnectionActionBody = {}
  ): Promise<ApiSuccessResponse<ConnectionReconnectResult>> {
    const action = validateConnectionActionBody(body);
    const validatedConnectionId = validateConnectionId(connectionId);
    try {
      const item = await this.connectionRepository.getConnectionById(userId, validatedConnectionId);

      if (!item) {
        throw new NotFoundAppError('Connection not found');
      }

      const targetAccount = await this.resolveDiagnosticAccount(
        userId,
        item,
        action.accountId
      );
      const statusConfig = await this.brokerDiagnosticsService.getStatusConfig(item.brokerKey);
      const requestedReason = String(action.reason || '').trim().toLowerCase();
      const nextAccountStatus =
        requestedReason.includes('disconnect') || requestedReason.includes('idle')
          ? 'Idle'
          : statusConfig.resetStatus;

      if (targetAccount) {
        await this.brokerAccountRepository.updateBrokerAccount(userId, targetAccount.id, {
          status: nextAccountStatus,
          lastSyncAt: new Date(),
        });
      }

      await this.connectionRepository.updateConnection(userId, validatedConnectionId, {
        status: 'Idle',
      });

      const updated = await this.connectionRepository.getConnectionById(userId, validatedConnectionId);
      const updatedAccount = targetAccount
        ? await this.brokerAccountRepository.getBrokerAccountById(userId, targetAccount.id)
        : null;

      await this.operationalEventService.logActivity(userId, {
        type: 'Connection',
        title: `Connection reconnect initiated: ${item.brokerKey}`,
        status: 'Success',
        route: 'Brokers data',
        stream: 'Controls',
        related: item.brokerKey,
        referenceId: validatedConnectionId,
        description: action.reason || 'Reconnect action executed',
      });

      return successResponse({
        message: 'Reconnect initiated',
        connection: {
          id: validatedConnectionId,
          updatedAt: (updated?.lastSyncAt ?? new Date()).toISOString(),
        },
        account: updatedAccount
          ? {
              id: updatedAccount.id,
              status: updatedAccount.status,
              updatedAt: (updatedAccount.updatedAt ?? new Date()).toISOString(),
            }
          : undefined,
      });
    } catch (error) {
      await this.operationalEventService.logActivity(userId, {
        type: 'Connection',
        title: 'Connection reconnect failed',
        status: 'Failed',
        route: 'Brokers data',
        stream: 'Controls',
        referenceId: validatedConnectionId,
        description: error instanceof Error ? error.message : String(error),
      });
      await this.operationalEventService.emitFailureAlert(userId, {
        channel: 'Brokers',
        source: 'connections',
        message: `Connection reconnect failed (${validatedConnectionId}): ${
          error instanceof Error ? error.message : String(error)
        }`,
        route: 'Risk review',
      });
      throw error;
    }
  }

  async testConnection(
    userId: string,
    connectionId: string,
    body: ConnectionActionBody = {}
  ): Promise<ApiSuccessResponse<ConnectionTestResult>> {
    const action = validateConnectionActionBody(body);
    const validatedConnectionId = validateConnectionId(connectionId);
    const item = await this.connectionRepository.getConnectionById(userId, validatedConnectionId);

    if (!item) {
      throw new NotFoundAppError('Connection not found');
    }

    const startedAt = Date.now();
    const targetAccount = await this.resolveDiagnosticAccount(
      userId,
      item,
      action.accountId
    );

    try {
      const diagnostics = await this.brokerDiagnosticsService.testConnection(
        userId,
        item,
        targetAccount?.id
      );
      const detail = diagnostics.detail;
      const latency = this.formatLatency(Date.now() - startedAt);
      const checkedAt = new Date();
      const statusConfig = await this.brokerDiagnosticsService.getStatusConfig(item.brokerKey);

      await this.connectionRepository.updateConnection(userId, validatedConnectionId, {
        status: 'Connected',
        latency,
        diagnosticSummary: this.toSyncSummary(detail),
        lastSyncAt: checkedAt,
      });

      if (targetAccount) {
        await this.brokerAccountRepository.updateBrokerAccount(userId, targetAccount.id, {
          status: statusConfig.successStatus,
          lastSyncAt: checkedAt,
        });
      }

      await this.operationalEventService.logActivity(userId, {
        type: 'Connection diagnostics',
        title: `Connection test passed: ${item.brokerKey}`,
        status: 'Success',
        route: 'Brokers data',
        stream: 'Controls',
        related: item.brokerKey,
        referenceId: validatedConnectionId,
        description: detail,
        flags: [
          {
            id: 'connection-status-synced',
            message: `Connection status updated to Connected (${statusConfig.successStatus}).`,
            channel: 'Brokers',
            time: checkedAt.toISOString(),
            status: 'Ready',
          },
          ...(targetAccount
            ? [
                {
                  id: 'diagnostic-account-synced',
                  message: `Diagnostic account ${targetAccount.id} was refreshed.`,
                  channel: 'Broker account',
                  time: checkedAt.toISOString(),
                  status: 'Ready',
                },
              ]
            : []),
        ],
      });

      return successResponse({
        message: `Diagnostics passed: ${detail}`,
        connectionId: item.id,
        accountId: targetAccount?.id,
        status: statusConfig.successStatus,
        latency,
        checkedAt: checkedAt.toISOString(),
        detail,
      });
    } catch (error) {
      const latency = this.formatLatency(Date.now() - startedAt);
      const checkedAt = new Date();
      const detail = error instanceof Error ? error.message : 'Unknown diagnostics error';
      const statusConfig = await this.brokerDiagnosticsService.getStatusConfig(item.brokerKey);
      const status = statusConfig.failureStatus;

      await this.connectionRepository.updateConnection(userId, validatedConnectionId, {
        status: 'Disconnected',
        latency,
        diagnosticSummary: this.toSyncSummary(detail),
        lastSyncAt: checkedAt,
      });

      if (targetAccount) {
        await this.brokerAccountRepository.updateBrokerAccount(userId, targetAccount.id, {
          status,
          lastSyncAt: checkedAt,
        });
      }

      await this.operationalEventService.logActivity(userId, {
        type: 'Connection diagnostics',
        title: `Connection test failed: ${item.brokerKey}`,
        status: 'Failed',
        route: 'Brokers data',
        stream: 'Controls',
        related: item.brokerKey,
        referenceId: validatedConnectionId,
        description: detail,
        flags: [
          {
            id: 'connection-review-required',
            message: `Connection was marked Disconnected after diagnostics failed (${status}).`,
            channel: 'Brokers',
            time: checkedAt.toISOString(),
            status: 'Needs review',
          },
          ...(targetAccount
            ? [
                {
                  id: 'diagnostic-account-review',
                  message: `Review broker account ${targetAccount.id} after the failed test.`,
                  channel: 'Broker account',
                  time: checkedAt.toISOString(),
                  status: 'Needs review',
                },
              ]
            : []),
        ],
      });
      await this.operationalEventService.emitFailureAlert(userId, {
        channel: 'Brokers',
        source: item.brokerKey,
        message: `Connection test failed (${item.brokerKey}): ${detail}`,
        route: 'Risk review',
      });

      return successResponse({
        message: `Diagnostics failed: ${detail}`,
        connectionId: item.id,
        accountId: targetAccount?.id,
        status,
        latency,
        checkedAt: checkedAt.toISOString(),
        detail,
      });
    }
  }

  async deleteConnection(
    userId: string,
    connectionId: string
  ): Promise<ApiSuccessResponse<ConnectionDeleteResult>> {
    const validatedConnectionId = validateConnectionId(connectionId);
    const item = await this.connectionRepository.getConnectionById(userId, validatedConnectionId);

    if (!item) {
      throw new NotFoundAppError('Connection not found');
    }

    const accountsDeleted = await this.brokerAccountRepository.deleteBrokerAccountsByConnectionId(
      userId,
      validatedConnectionId
    );
    const deleted = await this.connectionRepository.deleteConnection(userId, validatedConnectionId);

    if (!deleted) {
      throw new NotFoundAppError('Connection not found');
    }

    await this.operationalEventService.logActivity(userId, {
      type: 'Connection',
      title: `Connection removed: ${item.brokerKey}`,
      status: 'Success',
      route: 'Brokers data',
      stream: 'Controls',
      related: item.brokerKey,
      referenceId: validatedConnectionId,
      description: `Deleted connection ${item.name} (${accountsDeleted} account${accountsDeleted === 1 ? '' : 's'} removed)`,
    });

    return successResponse({
      message: 'Connection deleted',
      connectionId: validatedConnectionId,
      accountsDeleted,
    });
  }

  private async resolveDiagnosticAccount(
    userId: string,
    item: Connection,
    requestedAccountId?: string
  ) {
    if (!item.brokerId) {
      return null;
    }

    if (requestedAccountId) {
      const account = await this.brokerAccountRepository.getBrokerAccountById(
        userId,
        requestedAccountId
      );

      if (!account || account.connectionId !== item.id) {
        throw new BadRequestAppError('Selected account does not belong to this connection');
      }

      return account;
    }

    const preferredAccount =
      await this.brokerAccountRepository.getPreferredBrokerAccountByConnectionId(
        userId,
        item.id
      );

    if (!preferredAccount) {
      throw new BadRequestAppError('A broker account is required before testing this route');
    }

    return preferredAccount;
  }

  private async resolveProviderIds(
    definition: {
      id: string;
      brokerId?: string;
      brokerKey: string;
      providerType: string;
      linkedExchangeKey?: string;
    }
  ): Promise<{ brokerId: string | null }> {
    const linkedExchangeKey = definition.linkedExchangeKey?.trim();
    if (linkedExchangeKey) {
      const exchange = await this.exchangeRepository.getExchangeByKey(linkedExchangeKey);
      if (!exchange) {
        throw new BadRequestAppError(
          `Exchange master record not found for key: ${linkedExchangeKey}`
        );
      }
      return { brokerId: definition.brokerId ?? null };
    }

    return { brokerId: definition.brokerId ?? definition.id };
  }

  private formatLatency(durationMs: number): string {
    return `${Math.max(1, durationMs)}ms`;
  }

  private toSyncSummary(detail: string): string {
    return detail.length > 100 ? `${detail.slice(0, 97)}...` : detail;
  }

  private buildConnectionRecordPayload(
    payload: ConnectionUpsertBody,
    definition: {
      id?: string;
      name: string;
      brokerKey: string;
      category: string;
      capabilities: string[];
      accountFields: Array<{ label: string; required?: boolean }>;
      linkedExchangeKey?: string;
      integrationGuide?: {
        summary?: string;
        notes?: string[];
      };
    },
    providerIds: { brokerId: string | null },
    current?: Partial<Connection> | null
  ): Partial<Connection> {
    return {
      name: payload.name?.trim() || definition.name,
      broker: definition.name,
      brokerKey: definition.brokerKey,
      brokerId: providerIds.brokerId,
      type: this.getDefinitionCategory(definition.category),
      status: this.normalizeRouteStatus(current?.status),
      latency: current?.latency ?? null,
      mode: payload.mode?.trim() || current?.mode || null,
      lastSyncAt: current?.lastSyncAt ?? null,
      diagnosticSummary: current?.diagnosticSummary ?? null,
      route:
        payload.route?.trim() ||
        current?.route ||
        this.getDefaultRouteLabel(definition),
      scope: payload.scope?.trim() || current?.scope || null,
    };
  }

  private getDefinitionCategory(category?: string, fallbackType?: string): string {
    const normalizedCategory = String(category || '')
      .trim()
      .toLowerCase();

    if (normalizedCategory) {
      return normalizedCategory;
    }

    return String(fallbackType || 'broker')
      .trim()
      .toLowerCase() || 'broker';
  }

  private getDefinitionAuthMode(definition?: {
    accountFields?: Array<{ label: string; required?: boolean }>;
  } | null): string | undefined {
    const labels = Array.isArray(definition?.accountFields)
      ? definition.accountFields
          .filter((field) => Boolean(field?.required))
          .map((field) => String(field?.label || '').trim())
          .filter(Boolean)
      : [];

    return labels.length ? labels.join(', ') : undefined;
  }

  private getDefinitionSummary(definition?: {
    integrationGuide?: { summary?: string };
  } | null): string | undefined {
    const summary = String(definition?.integrationGuide?.summary || '').trim();
    return summary || undefined;
  }

  private mapConnection(
    item: Connection,
    definition?: {
      name: string;
      brokerKey?: string;
      category?: string;
      providerType?: string;
      accountFields?: Array<{ key?: string; label?: string; required?: boolean }>;
      linkedExchangeKey?: string;
      integrationGuide?: { summary?: string; notes?: string[] };
      capabilities: string[];
    } | null,
    accountCount = 0,
    integrity?: IntegritySummary
  ): ConnectionItem {
    const category = this.getDefinitionCategory(definition?.category, item.type);

    return {
      id: item.id,
      name: item.name,
      broker: definition?.name ?? item.broker ?? item.brokerKey,
      brokerKey: item.brokerKey,
      brokerId: item.brokerId ?? undefined,
      type: category,
      category,
      providerType: definition?.providerType ?? undefined,
      status: this.normalizeRouteStatus(item.status),
      latency: item.latency ?? '--',
      mode: item.mode ?? '--',
      lastSyncAt: item.lastSyncAt?.toISOString() ?? '',
      diagnosticSummary: item.diagnosticSummary ?? undefined,
      route: item.route ?? this.getDefaultRouteLabel(definition) ?? undefined,
      scope: item.scope ?? undefined,
      accountCount,
      integrity,
    };
  }

  private buildConnectionIntegrity(
    item: Connection,
    definition:
      | {
          name?: string;
          brokerKey?: string;
          category?: string;
          providerType?: string;
          linkedExchangeKey?: string;
        }
      | null
      | undefined,
    accounts: Array<{
      id: string;
      connectionId: string;
      brokerKey: string;
      accountName: string;
      accountKey: string;
      isDefault: boolean;
    }>
  ): IntegritySummary {
    const checks: IntegrityCheckItem[] = [];

    if (!definition) {
      checks.push({
        id: 'definition-link',
        status: 'warning',
        message: 'Broker definition could not be loaded, so route ownership could not be fully verified.',
      });
    } else if (
      this.normalizeIntegrityToken(definition.brokerKey) ===
      this.normalizeIntegrityToken(item.brokerKey)
    ) {
      checks.push({
        id: 'definition-link',
        status: 'ok',
        message: `Route is aligned to the ${definition.name || item.brokerKey} broker definition.`,
      });
    } else {
      checks.push({
        id: 'definition-link',
        status: 'error',
        message: `Route broker key ${item.brokerKey} does not match the loaded definition ${definition.brokerKey || 'unknown'}.`,
      });
    }

    if (item.brokerId) {
      checks.push({
        id: 'provider-link',
        status: 'ok',
        message: 'Broker route linkage is persisted for this connection.',
      });
    } else if (this.isExchangeManagedRoute(definition, item)) {
      checks.push({
        id: 'provider-link',
        status: 'ok',
        message: 'Exchange-backed feed routes are resolved from the exchange profile and do not persist a broker master row.',
      });
    } else {
      checks.push({
        id: 'provider-link',
        status: 'error',
        message: 'Broker route linkage is missing and should be repaired before using this connection.',
      });
    }

    if (String(definition?.linkedExchangeKey || '').trim()) {
      checks.push({
        id: 'exchange-link',
        status: 'ok',
        message: `Exchange linkage is defined by the ${definition?.linkedExchangeKey?.trim()} route profile.`,
      });
    }

    const routeSupportsAccounts =
      this.getDefinitionCategory(definition?.category, item.type).toLowerCase() !== 'feed';
    const defaultAccounts = accounts.filter((account) => account.isDefault);
    const mismatchedAccounts = accounts.filter(
      (account) =>
        account.connectionId !== item.id ||
        this.normalizeIntegrityToken(account.brokerKey) !==
          this.normalizeIntegrityToken(item.brokerKey)
    );

    if (!routeSupportsAccounts) {
      checks.push({
        id: 'account-routing',
        status: 'ok',
        message: 'Feed/data routes do not require execution accounts.',
      });
    } else if (!accounts.length) {
      checks.push({
        id: 'account-routing',
        status: 'warning',
        message: 'No execution accounts are attached to this trading route yet.',
      });
    } else if (defaultAccounts.length !== 1) {
      checks.push({
        id: 'account-routing',
        status: 'error',
        message:
          defaultAccounts.length === 0
            ? 'Execution accounts exist, but no default routed account is marked.'
            : `Execution accounts exist, but ${defaultAccounts.length} accounts are marked as default.`,
      });
    } else {
      checks.push({
        id: 'account-routing',
        status: 'ok',
        message: `Default routing points to ${defaultAccounts[0].accountName || defaultAccounts[0].accountKey}.`,
      });
    }

    if (mismatchedAccounts.length > 0) {
      checks.push({
        id: 'account-alignment',
        status: 'error',
        message: `${mismatchedAccounts.length} execution account record(s) do not match this route binding.`,
      });
    } else if (accounts.length > 0) {
      checks.push({
        id: 'account-alignment',
        status: 'ok',
        message: 'Execution accounts match the selected route and broker key.',
      });
    }

    return this.summarizeIntegrityChecks(
      checks,
      'Aligned',
      'Needs review',
      'Integrity risk',
      {
        ok: 'Definition, provider link, and routing defaults are aligned for this route.',
        warning:
          'The route is usable, but one or more integrity checks need operator review before relying on it.',
        error:
          'This route has an integrity problem that can break routing or account ownership if left unresolved.',
      }
    );
  }

  private buildAccountIntegrity(
    account: BrokerAccountItem,
    connection: Connection,
    definition:
      | {
          accountFields?: Array<{ key?: string; label?: string; required?: boolean }>;
          category?: string;
        }
      | null
      | undefined,
    allAccounts: Array<{
      id: string;
      connectionId: string;
      brokerKey: string;
      accountName: string;
      accountKey: string;
      isDefault: boolean;
    }>
  ): IntegritySummary {
    const checks: IntegrityCheckItem[] = [];
    const defaultAccounts = allAccounts.filter((item) => item.isDefault);

    if (
      account.connectionId === connection.id &&
      this.normalizeIntegrityToken(account.brokerKey) ===
        this.normalizeIntegrityToken(connection.brokerKey)
    ) {
      checks.push({
        id: 'route-alignment',
        status: 'ok',
        message: 'Selected account matches the active route binding.',
      });
    } else {
      checks.push({
        id: 'route-alignment',
        status: 'error',
        message: 'Selected account does not match the active route binding.',
      });
    }

    if (defaultAccounts.length !== 1) {
      checks.push({
        id: 'default-role',
        status: 'warning',
        message:
          defaultAccounts.length === 0
            ? 'No default routed account is currently marked for this route.'
            : `This route has ${defaultAccounts.length} accounts marked as default.`,
      });
    } else if (account.isDefault) {
      checks.push({
        id: 'default-role',
        status: 'ok',
        message: 'This is the default routed account for the selected route.',
      });
    } else {
      const defaultAccount = defaultAccounts[0];
      checks.push({
        id: 'default-role',
        status: 'ok',
        message: `This account is secondary. Default routing currently points to ${defaultAccount.accountName || defaultAccount.accountKey}.`,
      });
    }

    const credentialRequirements = this.resolveAccountCredentialRequirements(definition);
    if (credentialRequirements.needsVerification) {
      if (credentialRequirements.requireApiKey && !account.hasApiKey) {
        checks.push({
          id: 'credential-coverage',
          status: 'error',
          message: 'Required API key is missing from the selected account.',
        });
      }
      if (credentialRequirements.requireApiSecret && !account.hasApiSecret) {
        checks.push({
          id: 'credential-coverage',
          status: 'error',
          message: 'Required API secret is missing from the selected account.',
        });
      }
      if (
        (!credentialRequirements.requireApiKey || account.hasApiKey) &&
        (!credentialRequirements.requireApiSecret || account.hasApiSecret)
      ) {
        checks.push({
          id: 'credential-coverage',
          status: 'ok',
          message: 'Required API credentials are present for this account.',
        });
      }
    } else if (this.getDefinitionCategory(definition?.category, connection.type).toLowerCase() !== 'feed') {
      checks.push({
        id: 'credential-coverage',
        status: 'warning',
        message: 'Credential requirements could not be fully derived from the broker definition.',
      });
    }

    return this.summarizeIntegrityChecks(
      checks,
      'Aligned',
      'Needs review',
      'Integrity risk',
      {
        ok: 'Account routing, defaults, and credential coverage are aligned for this execution account.',
        warning:
          'The selected account is usable, but one or more routing checks still need review.',
        error:
          'The selected account has a routing or credential integrity problem that should be fixed before execution.',
      }
    );
  }

  private summarizeIntegrityChecks(
    checks: IntegrityCheckItem[],
    okLabel: string,
    warningLabel: string,
    errorLabel: string,
    summaries: {
      ok: string;
      warning: string;
      error: string;
    }
  ): IntegritySummary {
    const status = checks.some((check) => check.status === 'error')
      ? 'error'
      : checks.some((check) => check.status === 'warning')
        ? 'warning'
        : 'ok';

    return {
      status,
      label: status === 'error' ? errorLabel : status === 'warning' ? warningLabel : okLabel,
      summary: summaries[status],
      checks,
    };
  }

  private resolveAccountCredentialRequirements(
    definition?: {
      accountFields?: Array<{ key?: string; label?: string; required?: boolean }>;
    } | null
  ): {
    needsVerification: boolean;
    requireApiKey: boolean;
    requireApiSecret: boolean;
  } {
    const requiredTokens = Array.isArray(definition?.accountFields)
      ? definition.accountFields
          .filter((field) => Boolean(field?.required))
          .map((field) =>
            this.normalizeIntegrityToken(field.key || field.label)
          )
          .filter(Boolean)
      : [];

    return {
      needsVerification: requiredTokens.length > 0,
      requireApiKey: requiredTokens.includes('apikey'),
      requireApiSecret: requiredTokens.includes('apisecret'),
    };
  }

  private normalizeIntegrityToken(value?: string | null): string {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');
  }

  private buildConnectionDefinitionSummary(
    definition?: {
      accountFields?: Array<{ label: string; required?: boolean }>;
      integrationGuide?: { summary?: string; notes?: string[] };
      capabilities?: string[];
    } | null
  ): ConnectionDefinitionSummary | undefined {
    if (!definition) {
      return undefined;
    }

    const capabilities = Array.isArray(definition.capabilities)
      ? definition.capabilities
          .map((item) => String(item || '').trim())
          .filter(Boolean)
      : [];
    const limitations = Array.isArray(definition.integrationGuide?.notes)
      ? definition.integrationGuide.notes
          .map((item) => String(item || '').trim())
          .filter(Boolean)
      : [];

    return {
      purpose: this.getDefinitionSummary(definition),
      capabilities,
      requiredAuth: this.getDefinitionAuthMode(definition),
      limitations: limitations.length ? limitations : undefined,
    };
  }

  private getDefaultRouteLabel(
    definition?: {
      name?: string;
      category?: string;
    } | null
  ): string | undefined {
    const name = String(definition?.name || '').trim();
    if (!name) {
      return undefined;
    }

    const suffix =
      String(definition?.category || '').trim().toLowerCase() === 'feed' ? 'feed' : 'route';
    return `${name} ${suffix}`;
  }

  private normalizeRouteStatus(value?: string | null): string {
    const normalized = String(value || '').trim().toLowerCase();

    if (normalized === 'connected' || normalized === 'active' || normalized === 'stable') {
      return 'Connected';
    }

    if (
      normalized === 'disconnected' ||
      normalized === 'failed' ||
      normalized === 'error'
    ) {
      return 'Disconnected';
    }

    return 'Idle';
  }

  private async resolveWorkspaceSelectedAccount(
    userId: string,
    connectionId: string,
    selectedAccountId?: string
  ) {
    const requestedAccountId = String(selectedAccountId || '').trim();

    if (requestedAccountId) {
      const requestedAccount = await this.brokerAccountsService.getBrokerAccountItemById(
        userId,
        requestedAccountId
      );

      if (requestedAccount?.connectionId === connectionId) {
        return requestedAccount;
      }
    }

    const preferredAccount =
      await this.brokerAccountRepository.getPreferredBrokerAccountByConnectionId(
        userId,
        connectionId
      );

    if (!preferredAccount?.id) {
      return null;
    }

    return this.brokerAccountsService.getBrokerAccountItemById(userId, preferredAccount.id);
  }

  private async resolveConnectionProductMapSummary(
    userId: string,
    item: Connection,
    definition?: {
      providerType?: string;
      category?: string;
      capabilities?: string[];
    } | null
  ) {
    const source = item.brokerKey;
    const supported = this.supportsProductMap(definition);

    if (!supported) {
      return {
        supported: false,
        source,
        total: 0,
      };
    }

    return {
      supported: true,
      source,
      total: await this.exchangeAssetRepository.countVisibleAssetsForUser(userId, source),
    };
  }

  private supportsProductMap(
    definition?: {
      providerType?: string;
      category?: string;
      capabilities?: string[];
      linkedExchangeKey?: string;
    } | null
  ): boolean {
    const capabilities = Array.isArray(definition?.capabilities)
      ? definition.capabilities.map((capability) =>
          String(capability || '')
            .trim()
            .toLowerCase()
        )
      : [];

    if (capabilities.some((capability) => capability.includes('asset'))) {
      return true;
    }

    return (
      Boolean(String(definition?.linkedExchangeKey || '').trim())
    );
  }

  private isExchangeManagedRoute(
    definition?:
      | {
          category?: string;
          providerType?: string;
          linkedExchangeKey?: string;
        }
      | null,
    item?: Pick<Connection, 'type'>
  ): boolean {
    const category = this.getDefinitionCategory(definition?.category, item?.type).toLowerCase();
    return category === 'feed' && Boolean(String(definition?.linkedExchangeKey || '').trim());
  }
}
