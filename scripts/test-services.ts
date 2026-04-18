import assert from 'node:assert/strict';

import { ActivityExportProcessorService } from '../src/api/services/ActivityExportProcessorService';
import { ActivityMaintenanceService } from '../src/api/services/ActivityMaintenanceService';
import { ActivityService } from '../src/api/services/ActivityService';
import { EmailDeliveriesService } from '../src/api/services/EmailDeliveriesService';
import { DiscoveryDependencyService } from '../src/api/services/DiscoveryDependencyService';
import { DiscoveryFeedService } from '../src/api/services/DiscoveryFeedService';
import { DiscoverySummaryService } from '../src/api/services/DiscoverySummaryService';
import { MarketsOverviewService } from '../src/api/services/MarketsOverviewService';
import { OperationalEventService } from '../src/api/services/OperationalEventService';
import { AlertRepository } from '../src/database/repositories/AlertRepository';
import { ActivityExportRepository } from '../src/database/repositories/ActivityExportRepository';
import { ActivityRepository } from '../src/database/repositories/ActivityRepository';
import { BacktestRepository } from '../src/database/repositories/BacktestRepository';
import { StrategyLibraryRepository } from '../src/database/repositories/StrategyLibraryRepository';
import { StrategyTemplateRepository } from '../src/database/repositories/StrategyTemplateRepository';
import { AlertsService } from '../src/api/services/AlertsService';
import { AlertsOverviewService } from '../src/api/services/AlertsOverviewService';
import { AutomationsService } from '../src/api/services/AutomationsService';
import { AutomationExecutionService } from '../src/api/services/AutomationExecutionService';
import { BacktestChartService } from '../src/api/services/BacktestChartService';
import { BacktestPromotionService } from '../src/api/services/BacktestPromotionService';
import { BacktestReadModelService } from '../src/api/services/BacktestReadModelService';
import { BacktestRecoveryService } from '../src/api/services/BacktestRecoveryService';
import { BacktestSnapshotService } from '../src/api/services/BacktestSnapshotService';
import { BacktestTopSetupsService } from '../src/api/services/BacktestTopSetupsService';
import { BacktestsService } from '../src/api/services/BacktestsService';
import { AutomationRepository } from '../src/database/repositories/AutomationRepository';
import { BrokerAccountsService } from '../src/api/services/BrokerAccountsService';
import { BrokerDefinitionsService } from '../src/api/services/BrokerDefinitionsService';
import { BrokerMarketFacadeService } from '../src/api/services/BrokerMarketFacadeService';
import { BrokerReferenceDataService } from '../src/api/services/BrokerReferenceDataService';
import { ConnectionsService } from '../src/api/services/ConnectionsService';
import { ExchangeAssetsService } from '../src/api/services/ExchangeAssetsService';
import { MarketService } from '../src/brokers/providers/binance';
import { MudrexApiError } from '../src/brokers/providers/mudrex/MudrexHttpClient';
import { MudrexService } from '../src/brokers/providers/mudrex/MudrexService';
import { OrdersService } from '../src/brokers/providers/mudrex';
import { PortfolioService } from '../src/api/services/PortfolioService';
import { PositionsService } from '../src/brokers/providers/mudrex';
import { RiskService } from '../src/api/services/RiskService';
import { SchedulerOverviewService } from '../src/api/services/SchedulerOverviewService';
import { SettingsService } from '../src/api/services/SettingsService';
import { SignalsOverviewService } from '../src/api/services/SignalsOverviewService';
import { SignalsService } from '../src/api/services/SignalsService';
import { SuggestedTradeExecutionSyncService } from '../src/api/services/SuggestedTradeExecutionSyncService';
import { SuggestedTradesHealthService } from '../src/api/services/SuggestedTradesHealthService';
import { SuggestedTradesOverviewService } from '../src/api/services/SuggestedTradesOverviewService';
import { SuggestedTradesService } from '../src/api/services/SuggestedTradesService';
import { StrategyLibraryService } from '../src/api/services/StrategyLibraryService';
import { StrategyLabService } from '../src/api/services/StrategyLabService';
import { StrategyService } from '../src/api/services/StrategyService';
import { StrategyTemplatesService } from '../src/api/services/StrategyTemplatesService';
import { DeltaExchangeOrdersAdapter } from '../src/brokers/capabilities/orders';
import { EmailDeliveryWorker } from '../src/email/EmailDeliveryWorker';
import { WalletService } from '../src/brokers/providers/mudrex';
import { WatchlistsService } from '../src/api/services/WatchlistsService';
import { validateUpdateBacktestResultBody } from '../src/api/validators/backtests.validator';
import {
  validateAutomationCreateBody,
  validateAutomationUpdateBody,
} from '../src/api/validators/automations.validator';
import { validatePromoteSignalBody } from '../src/api/validators/signals.validator';
import {
  validateSettingsAuditQuery,
  validateUpdateSettingsBody,
} from '../src/api/validators/settings.validator';
import {
  validateSuggestedTradesExecutionSyncBody,
  validateSuggestedTradesQuery,
} from '../src/api/validators/suggestedTrades.validator';
import { validateBrokerDefinitionUpsertBody } from '../src/api/validators/brokerDefinitions.validator';
import { validateStrategyLabDraftBody } from '../src/api/validators/strategyLab.validator';
import {
  validateCreateWatchlistPayload,
  validateUpdateWatchlistPayload,
} from '../src/api/validators/watchlists.validator';
import {
  ActivityExport,
  ActivityLog,
  ActivitySavedView,
  AppSetting,
  EmailDelivery,
  SettingsAuditLog,
} from '../src/database';
import { env } from '../src/env';
import { coreDataSource } from '../src/database/data-source';
import { strategyDataSource } from '../src/database/pg-data-source';
import { Alert } from '../src/database/entities/Alert';
import { AlertAction } from '../src/database/entities/AlertAction';
import { AutomationRunOutput } from '../src/database/entities/AutomationRunOutput';
import { Broker } from '../src/database/entities/Broker';
import { BrokerAccount } from '../src/database/entities/BrokerAccount';
import { Connection } from '../src/database/entities/Connection';
import { PaperOrder } from '../src/database/entities/PaperOrder';
import { SuggestedTrade } from '../src/database/entities/SuggestedTrade';
import { SuggestedTradeExecution } from '../src/database/entities/SuggestedTradeExecution';
import { CreateAppSettingsTable1741474200000 } from '../src/database/migrations/1741474200000-CreateAppSettingsTable';
import { NormalizeAppSettingsPrimaryKey1765401000000 } from '../src/database/migrations/1765401000000-NormalizeAppSettingsPrimaryKey';
import { AddBacktestPromotionRulesToAppSettings1770715000000 } from '../src/database/migrations/1770715000000-AddBacktestPromotionRulesToAppSettings';
import { HardenSuggestedTradeExecutionStorage1767300010000 } from '../src/database/migrations/1767300010000-HardenSuggestedTradeExecutionStorage';
import { CleanupBrokerExchangeMasters1769800000000 } from '../src/database/migrations/1769800000000-CleanupBrokerExchangeMasters';
import { DropConnectionExchangeId1770000000000 } from '../src/database/migrations/1770000000000-DropConnectionExchangeId';
import { DropBrokerAssetExchangeId1770100000000 } from '../src/database/migrations/1770100000000-DropBrokerAssetExchangeId';
import { decryptBrokerAccountSettings } from '../src/lib/brokerAccountSecrets';
import { BrokerDefinitionRuntimeSupportService } from '../src/brokers/core/BrokerDefinitionRuntimeSupportService';
import { BrokerDefinitionService as CoreBrokerDefinitionService } from '../src/brokers/core/BrokerDefinitionService';
import { BrokerDefinitionStartupValidator } from '../src/brokers/core/BrokerDefinitionStartupValidator';
import { getMetadataArgsStorage } from 'typeorm';
import {
  computeNextRun,
  normalizeAutomationScheduleRecord,
  resolveAutomationSchedule,
} from '../src/api/utils/automationSchedule';
import { createDefaultBacktestPromotionRules } from '../src/api/utils/backtestPromotionRules';

type ServiceCtor = new (...args: never[]) => object;
type MigrationColumn = {
  name?: string;
  isGenerated?: boolean;
  generationStrategy?: string;
};

function createSuccess<T>(data: T) {
  return { success: true as const, data };
}

const serviceConstructors: Array<[string, ServiceCtor]> = [
  ['ActivityService', ActivityService],
  ['ActivityExportProcessorService', ActivityExportProcessorService],
  ['ActivityMaintenanceService', ActivityMaintenanceService],
  ['AlertsService', AlertsService],
  ['AutomationsService', AutomationsService],
  ['AutomationExecutionService', AutomationExecutionService],
  ['BacktestChartService', BacktestChartService],
  ['BacktestPromotionService', BacktestPromotionService],
  ['BacktestReadModelService', BacktestReadModelService],
  ['BacktestRecoveryService', BacktestRecoveryService],
  ['BacktestSnapshotService', BacktestSnapshotService],
  ['BacktestTopSetupsService', BacktestTopSetupsService],
  ['BacktestsService', BacktestsService],
  ['BrokerAccountsService', BrokerAccountsService],
  ['BrokerDefinitionsService', BrokerDefinitionsService],
  ['ConnectionsService', ConnectionsService],
  ['DiscoveryDependencyService', DiscoveryDependencyService],
  ['DiscoveryFeedService', DiscoveryFeedService],
  ['DiscoverySummaryService', DiscoverySummaryService],
  ['MarketsOverviewService', MarketsOverviewService],
  ['MarketService', MarketService],
  ['OrdersService', OrdersService],
  ['PortfolioService', PortfolioService],
  ['PositionsService', PositionsService],
  ['RiskService', RiskService],
  ['SettingsService', SettingsService],
  ['SignalsOverviewService', SignalsOverviewService],
  ['SignalsService', SignalsService],
  ['SuggestedTradeExecutionSyncService', SuggestedTradeExecutionSyncService],
  ['SuggestedTradesHealthService', SuggestedTradesHealthService],
  ['SuggestedTradesOverviewService', SuggestedTradesOverviewService],
  ['SuggestedTradesService', SuggestedTradesService],
  ['StrategyLibraryService', StrategyLibraryService],
  ['StrategyLabService', StrategyLabService],
  ['StrategyService', StrategyService],
  ['StrategyTemplatesService', StrategyTemplatesService],
  ['WalletService', WalletService],
  ['WatchlistsService', WatchlistsService],
  ['OperationalEventService', OperationalEventService],
  ['BrokerDefinitionRuntimeSupportService', BrokerDefinitionRuntimeSupportService],
];

function runServiceSmokeAssertions(): void {
  for (const [name, ctor] of serviceConstructors) {
    assert.equal(typeof ctor, 'function', `${name} should be exported as a class`);
    assert.ok(ctor.prototype, `${name} should expose a prototype`);
  }
}

function createBacktestsService(): any {
  const service = new BacktestsService() as any;
  service.backtestReadModelService = new BacktestReadModelService();
  service.appSettingsRepository = {
    async getSettings() {
      return null;
    },
  };
  return service;
}

async function runActivityQueryFilterAssertions(): Promise<void> {
  const service = new ActivityService() as any;
  const capturedQueries: Array<Record<string, unknown>> = [];

  service.activityRepository = {
    listActivity: async (_userId: string, query: Record<string, unknown>) => {
      capturedQueries.push({ ...query });
      return {
	        items: [
	          {
	            id: 'activity-1',
	            type: 'Connections',
	            title: 'Route test passed',
	            status: 'Success',
	            actor: 'user-1',
	            symbol: null,
	            route: 'Brokers data',
	            description: 'Diagnostics completed',
	            referenceId: 'conn-1',
	            correlationId: 'corr-1',
	            stream: 'controls',
	            related: 'delta_exchange',
	            flags: null,
	            createdAt: new Date('2026-04-04T08:00:00.000Z'),
          },
        ],
        total: 1,
      };
    },
    async countUnread(_userId: string, query: Record<string, unknown>) {
      assert.equal(query.stream, 'controls');
      return 1;
    },
  };

  const response = await service.getActivity('user-1', {
    limit: '4',
    offset: '0',
    stream: 'controls',
	    route: 'Brokers data',
	    referenceId: 'conn-1',
	    correlationId: 'corr-1',
	    related: 'delta_exchange',
	  });

  assert.deepEqual(capturedQueries, [
    {
      limit: 4,
      offset: 0,
      type: undefined,
      status: undefined,
      search: undefined,
      stream: 'controls',
	      route: 'Brokers data',
	      referenceId: 'conn-1',
	      correlationId: 'corr-1',
	      related: 'delta_exchange',
	      readState: 'all',
      view: 'feed',
      savedViewId: undefined,
      groupBy: undefined,
      sortBy: 'time',
      sortOrder: 'desc',
    },
  ]);
  assert.equal(response.data.total, 1);
  assert.equal(response.data.unreadCount, 1);
  assert.equal(response.data.items[0]?.stream, 'Controls');
  assert.equal(response.data.items[0]?.referenceId, 'conn-1');
  assert.equal(response.data.items[0]?.correlationId, 'corr-1');
  assert.equal(response.data.items[0]?.related, 'delta_exchange');
  assert.equal(response.data.meta.timeZone, 'UTC');
  assert.deepEqual(response.data.meta.savedViews, []);
  assert.equal(response.data.meta.view, 'feed');
}

async function runScopedActivitySummaryAssertions(): Promise<void> {
  const service = new ActivityService() as any;
  let capturedUserId = '';
  let capturedQuery: Record<string, unknown> | null = null;
  let capturedReadyExportFilters: Record<string, string> | undefined;

  service.userTimeZoneService = {
    async resolveUserTimeZone(userId: string) {
      assert.equal(userId, 'user-1');
      return 'Asia/Kolkata';
    },
  };
  service.activityExportRepository = {
    async countReadyExports(
      userId: string,
      options?: { filters?: Record<string, string> | null }
    ) {
      assert.equal(userId, 'user-1');
      capturedReadyExportFilters = options?.filters ?? undefined;
      return 1;
    },
  };
  service.activityRepository = {
    async getActivitySummary(userId: string, query: Record<string, unknown>) {
      capturedUserId = userId;
      capturedQuery = query;
      return {
        totalEvents: 3,
        eventsToday: 2,
        successful: 1,
        needsReview: 1,
        recentEvents: 3,
        executionEvents: 1,
        automationEvents: 1,
      };
    },
  };

  const response = await service.getScopedActivitySummary('user-1', {
    limit: '50',
    offset: '20',
    type: 'Connections',
    status: 'Success',
    search: 'delta',
    stream: 'controls',
	    route: 'Brokers data',
	    referenceId: 'conn-1',
	    correlationId: 'corr-1',
	    related: 'delta_exchange',
	  });

  assert.equal(capturedUserId, 'user-1');
  assert.ok(capturedQuery);
  const summaryQuery = capturedQuery as Record<string, unknown>;
  assert.equal(summaryQuery.type, 'Connections');
  assert.equal(summaryQuery.status, 'Success');
  assert.equal(summaryQuery.search, 'delta');
  assert.equal(summaryQuery.stream, 'controls');
  assert.equal(summaryQuery.route, 'Brokers data');
  assert.equal(summaryQuery.referenceId, 'conn-1');
  assert.equal(summaryQuery.correlationId, 'corr-1');
  assert.equal(summaryQuery.related, 'delta_exchange');
  assert.equal(summaryQuery.readState, 'all');
  assert.ok((summaryQuery.dayStart as Date | undefined) instanceof Date);
  assert.ok((summaryQuery.recentStart as Date | undefined) instanceof Date);
  assert.deepEqual(capturedReadyExportFilters, {
    type: 'Connections',
    status: 'Success',
    search: 'delta',
    stream: 'controls',
    route: 'Brokers data',
    referenceId: 'conn-1',
    correlationId: 'corr-1',
    related: 'delta_exchange',
  });
  assert.deepEqual(response.data, {
    eventsToday: 2,
    successful: 1,
    needsReview: 1,
    exportsReady: 1,
    recentEvents: 3,
    executionEvents: 1,
    automationEvents: 1,
    auditPosture: 'Review needed',
  });
}

async function runActivityGroupingWindowAssertions(): Promise<void> {
  const service = new ActivityService() as any;

  service.userTimeZoneService = {
    async resolveUserTimeZone(userId: string) {
      assert.equal(userId, 'user-1');
      return 'Asia/Kolkata';
    },
  };
  service.activitySavedViewRepository = {
    async listViews() {
      return [];
    },
  };
  service.activityRepository = {
    async listActivity(_userId: string, query: Record<string, unknown>) {
      assert.equal(query.view, 'grouped');
      return {
        items: [
          {
            id: 'activity-1',
            type: 'Connections',
            title: 'Primary connection synced',
            status: 'Success',
            actor: 'system',
            symbol: null,
            route: 'Brokers data',
            description: null,
            referenceId: 'conn-1',
            correlationId: 'corr-1',
            stream: 'controls',
            related: 'delta_exchange',
            flags: null,
            readAt: null,
            createdAt: new Date('2026-04-03T21:00:00.000Z'),
          },
        ],
        total: 2,
      };
    },
    async countUnread(_userId: string, query: Record<string, unknown>) {
      assert.equal(query.route, 'Brokers data');
      return 2;
    },
  };

  const response = await service.getActivity('user-1', {
    limit: '1',
    offset: '0',
    view: 'grouped',
    groupBy: 'day',
    route: 'Brokers data',
  });

  assert.equal(response.data.total, 2);
  assert.equal(response.data.meta.timeZone, 'Asia/Kolkata');
  assert.equal(response.data.meta.presentationWindowTruncated, undefined);
  assert.equal(response.data.groups?.length, 1);
  assert.deepEqual(response.data.groups?.[0], {
    key: 'day:2026-04-04',
    label: '2026-04-04',
    count: 1,
    unreadCount: 1,
    itemIds: ['activity-1'],
  });
}

async function runActivityRepositoryNormalizationAssertions(): Promise<void> {
  const repository = new ActivityRepository() as any;
  let createdPayload: Record<string, unknown> | null = null;
  let savedPayload: Record<string, unknown> | null = null;

  Object.defineProperty(repository, 'activityRepository', {
    get: () => ({
      create(payload: Record<string, unknown>) {
        createdPayload = { ...payload };
        return payload;
      },
      async save(payload: Record<string, unknown>) {
        savedPayload = { ...payload };
        return {
          id: 'activity-1',
          createdAt: new Date('2026-04-04T10:00:00.000Z'),
          updatedAt: new Date('2026-04-04T10:00:00.000Z'),
          ...payload,
        };
      },
    }),
  });

  const saved = await repository.createActivityLog({
    userId: 'user-1',
    type: ' strategy lab ',
    title: '  draft   saved ',
    status: 'completed',
    actor: ' user-1 ',
    symbol: ' btcusdt ',
    route: ' strategy lab ',
    description: '  Visual draft saved from editor ',
    referenceId: ' proj-1 ',
    stream: 'review',
    related: ' momentum ',
    flags: [
      {
        id: ' draft-check ',
        message: '  Review before promoting ',
        channel: ' strategy lab ',
        time: ' 2026-04-04T10:00:00.000Z ',
        status: 'watch',
      },
    ],
  });

  assert.ok(createdPayload);
  assert.ok(savedPayload);
  const normalizedCreatedPayload = createdPayload as Record<string, unknown>;
  assert.equal(normalizedCreatedPayload.type, 'Strategy Lab');
  assert.equal(normalizedCreatedPayload.title, 'draft saved');
  assert.equal(normalizedCreatedPayload.status, 'Success');
  assert.equal(normalizedCreatedPayload.route, 'Strategy Lab');
  assert.equal(normalizedCreatedPayload.stream, 'Controls');
  assert.equal(normalizedCreatedPayload.referenceId, 'proj-1');
  assert.equal(normalizedCreatedPayload.related, 'momentum');
  assert.equal(normalizedCreatedPayload.symbol, 'btcusdt');
  assert.deepEqual(normalizedCreatedPayload.flags, [
    {
      id: 'draft-check',
      message: 'Review before promoting',
      channel: 'strategy lab',
      time: '2026-04-04T10:00:00.000Z',
      status: 'Needs review',
    },
  ]);
  assert.equal(saved.type, 'Strategy Lab');
  assert.equal(saved.status, 'Success');
}

async function runActivityExportRepositorySignatureAssertions(): Promise<void> {
  const repository = new ActivityExportRepository() as any;
  let createdPayload: Record<string, unknown> | null = null;
  let capturedFilterSignature = '';

  Object.defineProperty(repository, 'exportRepository', {
    get: () => ({
      create(payload: Record<string, unknown>) {
        createdPayload = { ...payload };
        return payload;
      },
      async save(payload: Record<string, unknown>) {
        return {
          id: 'export-1',
          createdAt: new Date('2026-04-04T10:00:00.000Z'),
          updatedAt: new Date('2026-04-04T10:00:00.000Z'),
          ...payload,
        };
      },
      createQueryBuilder() {
        const params: Record<string, unknown> = {};
        return {
          where(_sql: string, nextParams?: Record<string, unknown>) {
            if (nextParams) {
              Object.assign(params, nextParams);
            }
            return this;
          },
          andWhere(_sql: unknown, nextParams?: Record<string, unknown>) {
            if (nextParams) {
              Object.assign(params, nextParams);
            }
            return this;
          },
          async getCount() {
            capturedFilterSignature = String(params.filterSignature || '');
            return 2;
          },
        };
      },
    }),
  });

  const created = await repository.createExport({
    userId: 'user-1',
    scope: 'all',
    format: 'csv',
    fileName: 'activity-all.csv',
    contentType: 'text/csv',
    exportedCount: 0,
    filters: {
      route: ' Risk ',
      readState: ' unread ',
    },
  });

  assert.ok(createdPayload);
  const normalizedCreatedPayload = createdPayload as Record<string, unknown>;
  assert.deepEqual(normalizedCreatedPayload.filters, {
    route: 'Risk',
    readState: 'unread',
  });
  assert.equal(String(normalizedCreatedPayload.filterSignature || '').length, 64);
  assert.equal(String(created.filterSignature || '').length, 64);

  const readyCount = await repository.countReadyExports(
    'user-1',
    {
      filters: {
        route: 'Risk',
      },
    },
    new Date('2026-04-04T10:00:00.000Z')
  );

  assert.equal(readyCount, 2);
  assert.equal(capturedFilterSignature.length, 64);
}

async function runLegacyActivityStreamNormalizationAssertions(): Promise<void> {
  const service = new ActivityService() as any;

  service.activityRepository = {
    async listActivity() {
      return {
        items: [
          {
            id: 'activity-legacy',
            type: 'Signal',
            title: 'Signal queued for review',
            status: 'Success',
            actor: 'user-1',
            symbol: 'BTCUSDT',
            route: 'Signals',
            description: 'Legacy review stream event',
            referenceId: 'sig-1',
            stream: 'Review',
            related: 'scanner',
            flags: null,
            createdAt: new Date('2026-04-04T08:00:00.000Z'),
          },
        ],
        total: 1,
      };
    },
  };

  const response = await service.getActivity('user-1', {
    limit: '10',
    offset: '0',
  });

  assert.equal(response.data.items[0]?.stream, 'Controls');
}

async function runActivityMaintenanceAssertions(): Promise<void> {
  const service = new ActivityMaintenanceService() as any;
  let countOlderThanDaysCalls = 0;
  let deleteOlderThanDaysCalls = 0;
  let countExpiredExportsCalls = 0;
  let listExpiredExportsCalls = 0;
  let deleteExpiredExportsCalls = 0;

  service.activityRepository = {
    async countOlderThanDays(retentionDays: number) {
      countOlderThanDaysCalls += 1;
      assert.equal(retentionDays, env.activity.retentionDays);
      return 7;
    },
    async deleteOlderThanDays(retentionDays: number) {
      deleteOlderThanDaysCalls += 1;
      assert.equal(retentionDays, env.activity.retentionDays);
      return 7;
    },
  };
  service.activityExportRepository = {
    async countExpiredExports(now: Date) {
      countExpiredExportsCalls += 1;
      assert.ok(now instanceof Date);
      return 2;
    },
    async listExpiredExports(now: Date, limit: number) {
      listExpiredExportsCalls += 1;
      assert.ok(now instanceof Date);
      assert.equal(limit, 100);
      if (listExpiredExportsCalls > 1) {
        return [];
      }
      return [
        { id: 'export-1', storagePath: null },
        { id: 'export-2', storagePath: null },
      ];
    },
    async deleteExportsByIds(ids: string[]) {
      deleteExpiredExportsCalls += 1;
      assert.deepEqual(ids, ['export-1', 'export-2']);
      return 2;
    },
  };

  const result = await service.runMaintenanceNow();

  assert.equal(countOlderThanDaysCalls, 1);
  assert.equal(deleteOlderThanDaysCalls, 1);
  assert.equal(countExpiredExportsCalls, 1);
  assert.equal(listExpiredExportsCalls, 2);
  assert.equal(deleteExpiredExportsCalls, 1);
  assert.deepEqual(result, {
    deletedActivityLogs: 7,
    deletedExpiredExports: 2,
    retentionDays: env.activity.retentionDays,
  });
}

async function runActivityDetailAssertions(): Promise<void> {
  const service = new ActivityService() as any;
  const createdAt = new Date('2026-04-04T09:00:00.000Z');
  const updatedAt = new Date('2026-04-04T09:05:00.000Z');

  service.activityRepository = {
    async getActivityById(userId: string, activityId: string) {
      assert.equal(userId, 'user-1');
      assert.equal(activityId, 'activity-1');
      return {
        id: 'activity-1',
        userId,
        type: 'Connection diagnostics',
        title: 'Connection test passed: delta_exchange',
        status: 'Success',
        actor: 'user-1',
        symbol: null,
        route: 'Brokers data',
        description: 'Signed wallet reachable',
        referenceId: 'conn-1',
        stream: 'Controls',
        related: 'delta_exchange',
        flags: [
          {
            id: 'connection-status-synced',
            message: 'Connection status updated to Connected.',
            channel: 'Brokers',
            time: createdAt.toISOString(),
            status: 'Ready',
          },
        ],
        createdAt,
        updatedAt,
      };
    },
  };
  service.connectionRepository = {
    async getConnectionById(userId: string, connectionId: string) {
      assert.equal(userId, 'user-1');
      assert.equal(connectionId, 'conn-1');
      return {
        id: 'conn-1',
        name: 'Delta route',
        status: 'Connected',
        brokerKey: 'delta_exchange',
        type: 'exchange',
        updatedAt,
      };
    },
  };

  const response = await service.getActivityById('user-1', 'activity-1');

	  assert.equal(response.data.statusTone, 'success');
	  assert.equal(response.data.streamKey, 'controls');
	  assert.equal(response.data.linkedEntity?.kind, 'connection');
	  assert.equal(response.data.linkedEntity?.path, '/brokers-data');
  assert.deepEqual(
    response.data.flags?.map((flag: { id: string }) => flag.id),
    ['connection-status-synced']
  );
  assert.deepEqual(response.data.exportContext, {
    formats: ['csv', 'json'],
    scope: 'controls',
    filters: {
      referenceId: 'conn-1',
      readState: 'unread',
      related: 'delta_exchange',
      route: 'Brokers data',
      stream: 'controls',
    },
	    historyPath: '/activity?panel=exports',
	  });
  assert.deepEqual(
    response.data.routeTargets.map((target: { path: string }) => target.path),
	    [
	      '/brokers-data',
	      '/activity?referenceId=conn-1',
	      '/activity?related=delta_exchange',
	      '/activity?panel=exports',
	    ]
	  );
  assert.ok(
    response.data.context.some(
      (item: { label: string; value: string }) =>
        item.label === 'Linked entity' && item.value === 'delta_exchange · exchange'
    )
  );
  assert.ok(
    response.data.context.some(
      (item: { label: string; value: string }) =>
        item.label === 'Description' && item.value === 'Signed wallet reachable'
    )
  );
}

async function runActivityStrategyLibraryLinkAssertions(): Promise<void> {
  const service = new ActivityService() as any;
  const createdAt = new Date('2026-04-05T10:00:00.000Z');
  const updatedAt = new Date('2026-04-05T10:05:00.000Z');

  service.activityRepository = {
    async getActivityById() {
      return {
        id: 'activity-library-1',
        userId: 'user-1',
        type: 'Strategy Library',
        title: 'Strategy library updated: Momentum Runner',
        status: 'Success',
        actor: 'user-1',
        symbol: null,
        route: 'Strategy Library',
        description: 'Strategy library entry updated',
        referenceId: 'library-1',
        stream: 'Definitions',
        related: null,
        flags: [],
        createdAt,
        updatedAt,
      };
    },
  };
  service.strategyLibraryRepository = {
    async getById(_userId: string, libraryId: string) {
      assert.equal(libraryId, 'library-1');
      return {
        id: 'library-1',
        name: 'Momentum Runner',
        templateId: 'template-1',
        status: 'Active',
        updatedAt,
      };
    },
  };
  service.strategyTemplateRepository = {
    async getStrategyTemplateById(_userId: string, templateId: string) {
      assert.equal(templateId, 'template-1');
      return {
        id: 'template-1',
        name: 'Momentum Template',
        templateVersion: 8,
      };
    },
  };

  const response = await service.getActivityById('user-1', 'activity-library-1');

  assert.equal(response.data.linkedEntity?.kind, 'strategy_library');
  assert.equal(response.data.linkedEntity?.path, '/strategy-library?selected=library-1');
  assert.equal(response.data.linkedEntity?.description, 'Imported from Momentum Template · v8');
}

async function runActivityExportAssertions(): Promise<void> {
  const { readFile } = await import('node:fs/promises');
  const service = new ActivityService() as any;
  const createdAt = new Date('2026-04-04T10:00:00.000Z');
  type CreatedExportPayload = {
    scope: string;
    format: string;
    status: string;
    fileName: string;
    contentType: string;
    exportedCount: number;
    filters: Record<string, string>;
    content: string | null;
    expiresAt: Date | null;
  };
  let createdExportPayload: CreatedExportPayload | null = null;
  let exportProcessorCalls = 0;
  let rebuiltStoragePath = '';
  let markedReadyPayload: Record<string, unknown> | null = null;

  service.operationalEventService = {
    async logActivity() {
      return;
    },
    async emitFailureAlert() {
      return;
    },
  };
  service.activityExportProcessorService = {
    async processPendingExportsOnce() {
      exportProcessorCalls += 1;
    },
    async rebuildExportFile(item: Record<string, unknown>) {
      assert.equal(item.id, 'export-2');
      const { mkdir, writeFile } = await import('node:fs/promises');
      const { tmpdir } = await import('node:os');
      const { join } = await import('node:path');
      rebuiltStoragePath = join(tmpdir(), 'activity-exports', 'export-2-rebuilt.json');
      await mkdir(join(tmpdir(), 'activity-exports'), { recursive: true });
      await writeFile(
        rebuiltStoragePath,
        JSON.stringify(
          [
            {
              id: 'activity-1',
              title: 'Connection test passed: delta_exchange',
            },
          ],
          null,
          2
        ),
        'utf8'
      );
      return {
        filePath: rebuiltStoragePath,
        exportedCount: 1,
      };
    },
  };
  service.activityExportRepository = {
    async createExport(payload: CreatedExportPayload) {
      createdExportPayload = { ...payload };
      return {
        id: 'export-1',
        userId: 'user-1',
        storagePath: null,
        errorMessage: null,
        createdAt,
        updatedAt: createdAt,
        ...payload,
      };
    },
    async listExports(userId: string, query: { limit: number; offset: number }) {
      assert.equal(userId, 'user-1');
      assert.deepEqual(query, { limit: 5, offset: 0 });
      return {
        items: [
          {
            id: 'export-2',
            userId,
            scope: 'all',
            format: 'json',
            status: 'Ready',
            fileName: 'activity-all-2026-04-04.json',
            contentType: 'application/json',
            exportedCount: 1,
            filters: { referenceId: 'conn-1' },
            storagePath: '/tmp/missing-activity-export-export-2.json',
            content: null,
            errorMessage: null,
            createdAt,
            updatedAt: createdAt,
            expiresAt: new Date('2026-04-11T10:00:00.000Z'),
          },
        ],
        total: 1,
      };
    },
    async getExportById(userId: string, exportId: string) {
      assert.equal(userId, 'user-1');
      assert.equal(exportId, 'export-2');
      return {
        id: 'export-2',
        userId,
        scope: 'all',
        format: 'json',
        status: 'Ready',
        fileName: 'activity-all-2026-04-04.json',
        contentType: 'application/json',
        exportedCount: 1,
        filters: { referenceId: 'conn-1' },
        storagePath: '/tmp/missing-activity-export-export-2.json',
        content: null,
        errorMessage: null,
        createdAt,
        updatedAt: createdAt,
        expiresAt: new Date('2026-04-11T10:00:00.000Z'),
      };
    },
    async markExportReady(exportId: string, payload: Record<string, unknown>) {
      assert.equal(exportId, 'export-2');
      markedReadyPayload = payload;
      return null;
    },
  };

  const exportResponse = await service.exportActivity('user-1', {
    scope: 'controls',
    format: 'csv',
    status: 'Success',
    route: 'Brokers data',
  });

  assert.equal(exportProcessorCalls, 1);
  assert.ok(createdExportPayload);
  const exportPayload = createdExportPayload as CreatedExportPayload;
  assert.equal(exportPayload.scope, 'controls');
  assert.equal(exportPayload.format, 'csv');
  assert.equal(exportPayload.status, 'Queued');
  assert.equal(exportPayload.contentType, 'text/csv');
  assert.equal(exportPayload.exportedCount, 0);
  assert.deepEqual(exportPayload.filters, {
    status: 'Success',
    stream: 'controls',
    route: 'Brokers data',
    scope: 'controls',
  });
  assert.ok(exportPayload.fileName);
  assert.match(String(exportPayload.fileName), /^activity-controls-.*\.csv$/);
  assert.equal(exportPayload.expiresAt, null);
  assert.equal(exportPayload.content, null);
  assert.equal(exportResponse.data.format, 'csv');
  assert.equal(exportResponse.data.contentType, 'text/csv');
  assert.equal(exportResponse.data.status, 'Queued');
  assert.equal(exportResponse.data.exportedCount, 0);
  assert.equal(exportResponse.data.message, 'Activity export queued');
  assert.equal(exportResponse.data.downloadPath, undefined);

  const historyResponse = await service.listActivityExports('user-1', {
    limit: '5',
    offset: '0',
  });

  assert.equal(historyResponse.data.total, 1);
  assert.equal(historyResponse.data.items[0]?.exportId, 'export-2');
  assert.equal(historyResponse.data.items[0]?.format, 'json');
  assert.deepEqual(historyResponse.data.items[0]?.filters, { referenceId: 'conn-1' });
  assert.equal(
    historyResponse.data.items[0]?.downloadPath,
    '/activity/exports/export-2/download'
  );

  const exportByIdResponse = await service.getActivityExportById('user-1', 'export-2');

  assert.equal(exportByIdResponse.data.exportId, 'export-2');
  assert.equal(exportByIdResponse.data.format, 'json');
  assert.equal(exportByIdResponse.data.message, 'Activity export ready');
  assert.equal(exportByIdResponse.data.downloadPath, '/activity/exports/export-2/download');
  assert.equal(exportByIdResponse.data.errorMessage, undefined);

  const download = await service.getActivityExportDownload('user-1', 'export-2');
  assert.equal(download.fileName, 'activity-all-2026-04-04.json');
  assert.equal(download.contentType, 'application/json');
  assert.equal(download.filePath, rebuiltStoragePath);
  assert.match(download.filePath, /activity-exports/);
  assert.deepEqual(markedReadyPayload, {
    exportedCount: 1,
    storagePath: rebuiltStoragePath,
    expiresAt: new Date('2026-04-11T10:00:00.000Z'),
  });
  const materialized = await readFile(download.filePath, 'utf8');
  assert.match(materialized, /"id": "activity-1"/);
}

async function runActivitySavedViewAssertions(): Promise<void> {
  const service = new ActivityService() as any;
  const createdAt = new Date('2026-04-04T11:00:00.000Z');
  const updatedAt = new Date('2026-04-04T11:05:00.000Z');

  service.activitySavedViewRepository = {
    async listViews(userId: string) {
      assert.equal(userId, 'user-1');
      return [
        {
          id: 'view-1',
          userId,
          name: 'Risk review',
          description: 'Unread risk items',
          isDefault: true,
          view: 'grouped',
          groupBy: 'status',
          sortBy: 'status',
          sortOrder: 'asc',
          readState: 'unread',
          filters: { route: 'Risk' },
          createdAt,
          updatedAt,
        },
      ];
    },
    async createView(payload: Record<string, unknown>) {
      return {
        id: 'view-2',
        userId: payload.userId,
        name: payload.name,
        description: payload.description ?? null,
        isDefault: payload.isDefault,
        view: payload.view,
        groupBy: payload.groupBy ?? null,
        sortBy: payload.sortBy,
        sortOrder: payload.sortOrder,
        readState: payload.readState,
        filters: payload.filters ?? null,
        createdAt,
        updatedAt,
      };
    },
    async getViewById(userId: string, viewId: string) {
      assert.equal(userId, 'user-1');
      assert.equal(viewId, 'view-1');
      return {
        id: 'view-1',
        userId,
        name: 'Risk review',
        description: 'Unread risk items',
        isDefault: true,
        view: 'grouped',
        groupBy: 'status',
        sortBy: 'status',
        sortOrder: 'asc',
        readState: 'unread',
        filters: { route: 'Risk' },
        createdAt,
        updatedAt,
      };
    },
    async updateView(_userId: string, _viewId: string, payload: Record<string, unknown>) {
      return {
        id: 'view-1',
        userId: 'user-1',
        name: payload.name,
        description: payload.description ?? null,
        isDefault: payload.isDefault,
        view: payload.view,
        groupBy: payload.groupBy ?? null,
        sortBy: payload.sortBy,
        sortOrder: payload.sortOrder,
        readState: payload.readState,
        filters: payload.filters ?? null,
        createdAt,
        updatedAt,
      };
    },
    async deleteView(userId: string, viewId: string) {
      assert.equal(userId, 'user-1');
      assert.equal(viewId, 'view-1');
      return true;
    },
  };

  const listResponse = await service.listActivitySavedViews('user-1');
  assert.equal(listResponse.data.total, 1);
  assert.equal(listResponse.data.items[0]?.view, 'grouped');
  assert.equal(listResponse.data.items[0]?.readState, 'unread');

  const createResponse = await service.createActivitySavedView('user-1', {
    name: 'Execution focus',
    view: 'clustered',
    groupBy: 'route',
    sortBy: 'time',
    sortOrder: 'desc',
    readState: 'all',
    stream: 'execution',
  });
  assert.equal(createResponse.data.name, 'Execution focus');
  assert.equal(createResponse.data.view, 'clustered');
  assert.deepEqual(createResponse.data.filters, { stream: 'execution' });

  const updateResponse = await service.updateActivitySavedView('user-1', 'view-1', {
    name: 'Risk follow-up',
    sortOrder: 'desc',
    route: 'Risk review',
  });
  assert.equal(updateResponse.data.name, 'Risk follow-up');
  assert.equal(updateResponse.data.sortOrder, 'desc');
  assert.deepEqual(updateResponse.data.filters, { route: 'Risk review' });

  const deleteResponse = await service.deleteActivitySavedView('user-1', 'view-1');
  assert.equal(deleteResponse.data.message, 'Activity saved view deleted');
}

async function runActivityReadStateAssertions(): Promise<void> {
  const service = new ActivityService() as any;
  let capturedMarkAllQuery: Record<string, unknown> | null = null;

  service.activitySavedViewRepository = {
    async listViews() {
      return [];
    },
  };
  service.activityRepository = {
    async markActivityRead(userId: string, activityId: string) {
      assert.equal(userId, 'user-1');
      assert.equal(activityId, 'activity-1');
      return true;
    },
    async markActivityUnread(userId: string, activityId: string) {
      assert.equal(userId, 'user-1');
      assert.equal(activityId, 'activity-1');
      return true;
    },
    async markAllActivityRead(userId: string, query: Record<string, unknown>) {
      assert.equal(userId, 'user-1');
      capturedMarkAllQuery = { ...query };
      return 3;
    },
    async countUnread(userId: string) {
      assert.equal(userId, 'user-1');
      return 4;
    },
  };

  const readResponse = await service.markActivityRead('user-1', 'activity-1');
  assert.equal(readResponse.data.updatedCount, 1);
  assert.equal(readResponse.data.unreadCount, 4);
  assert.ok(readResponse.data.readAt);

  const unreadResponse = await service.markActivityUnread('user-1', 'activity-1');
  assert.equal(unreadResponse.data.updatedCount, 1);
  assert.equal(unreadResponse.data.unreadCount, 4);

	  const markAllResponse = await service.markAllActivityRead('user-1', {
	    stream: 'controls',
	    route: 'Risk',
	    correlationId: 'corr-1',
	    view: 'grouped',
	  });
  assert.equal(markAllResponse.data.updatedCount, 3);
  assert.equal(markAllResponse.data.unreadCount, 4);
  assert.deepEqual(capturedMarkAllQuery, {
    type: undefined,
    status: undefined,
    search: undefined,
	    stream: 'controls',
	    route: 'Risk',
	    referenceId: undefined,
	    correlationId: 'corr-1',
	    related: undefined,
	    readState: 'all',
	  });
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

function runAlertEntitySchemaAssertions(): void {
  const alertIndexes = getMetadataArgsStorage().indices
    .filter((entry) => entry.target === Alert)
    .map((entry) => entry.name);

  for (const indexName of [
    'idx_alerts_user_created_at',
    'idx_alerts_user_status_created_at',
    'idx_alerts_user_severity_created_at',
  ]) {
    assert.ok(alertIndexes.includes(indexName), `Alert should define ${indexName}`);
  }
}

function runActivityEntitySchemaAssertions(): void {
  const activityIndexes = getMetadataArgsStorage().indices
    .filter((entry) => entry.target === ActivityLog)
    .map((entry) => entry.name);

  for (const indexName of [
    'idx_activity_logs_user_created_at',
    'idx_activity_logs_user_stream_created_at',
    'idx_activity_logs_user_status_created_at',
    'idx_activity_logs_user_read_created_at',
    'idx_activity_logs_user_type_created_at',
    'idx_activity_logs_user_symbol_created_at',
    'idx_activity_logs_user_correlation_created_at',
    'idx_activity_logs_user_route_created_at',
    'idx_activity_logs_user_reference_created_at',
    'idx_activity_logs_user_related_created_at',
  ]) {
    assert.ok(activityIndexes.includes(indexName), `ActivityLog should define ${indexName}`);
  }

  const activityColumns = getMetadataArgsStorage().columns.filter(
    (column) => column.target === ActivityLog
  );
	  const readAtColumn = activityColumns.find((column) => column.propertyName === 'readAt');
	  assert.equal(readAtColumn?.options.name, 'read_at');
	  const correlationIdColumn = activityColumns.find(
	    (column) => column.propertyName === 'correlationId'
	  );
	  assert.equal(correlationIdColumn?.options.name, 'correlation_id');
	}

function runActivityExportEntitySchemaAssertions(): void {
  const exportIndexes = getMetadataArgsStorage().indices
    .filter((entry) => entry.target === ActivityExport)
    .map((entry) => entry.name);

  for (const indexName of [
    'idx_activity_exports_user_created_at',
    'idx_activity_exports_user_status_created_at',
    'idx_activity_exports_status_created_at',
    'idx_activity_exports_expires_at',
    'idx_activity_exports_user_status_signature',
  ]) {
    assert.ok(exportIndexes.includes(indexName), `ActivityExport should define ${indexName}`);
  }

  const exportColumns = getMetadataArgsStorage().columns.filter(
    (column) => column.target === ActivityExport
  );
  const filtersColumn = exportColumns.find((column) => column.propertyName === 'filters');
  const filterSignatureColumn = exportColumns.find(
    (column) => column.propertyName === 'filterSignature'
  );
  const storagePathColumn = exportColumns.find((column) => column.propertyName === 'storagePath');
  const errorMessageColumn = exportColumns.find((column) => column.propertyName === 'errorMessage');
  const contentColumn = exportColumns.find((column) => column.propertyName === 'content');
  assert.equal(filtersColumn?.options.type, 'json');
  assert.equal(filtersColumn?.options.name, 'filters_json');
  assert.equal(filterSignatureColumn?.options.name, 'filter_signature');
  assert.equal(storagePathColumn?.options.name, 'storage_path');
  assert.equal(errorMessageColumn?.options.name, 'error_message');
  assert.equal(contentColumn?.options.nullable, true);
}

function runActivitySavedViewEntitySchemaAssertions(): void {
  const savedViewIndexes = getMetadataArgsStorage().indices
    .filter((entry) => entry.target === ActivitySavedView)
    .map((entry) => entry.name);

  for (const indexName of [
    'idx_activity_saved_views_user_created_at',
    'idx_activity_saved_views_user_default_updated_at',
  ]) {
    assert.ok(savedViewIndexes.includes(indexName), `ActivitySavedView should define ${indexName}`);
  }
}

function runEmailDeliveryEntitySchemaAssertions(): void {
  const emailDeliveryIndexes = getMetadataArgsStorage().indices
    .filter((entry) => entry.target === EmailDelivery)
    .map((entry) => entry.name);

  for (const indexName of [
    'idx_email_deliveries_status_created_at',
    'idx_email_deliveries_status_updated_at',
    'idx_email_deliveries_user_created_at',
  ]) {
    assert.ok(emailDeliveryIndexes.includes(indexName), `EmailDelivery should define ${indexName}`);
  }
}

function runSuggestedTradeExecutionEntitySchemaAssertions(): void {
  const suggestedTradeIndexes = getMetadataArgsStorage().indices
    .filter((entry) => entry.target === SuggestedTrade)
    .map((entry) => entry.name);

  for (const indexName of [
    'idx_suggested_trades_user_automation_status_signal_time',
    'idx_suggested_trades_user_run_signal_time',
  ]) {
    assert.ok(suggestedTradeIndexes.includes(indexName), `SuggestedTrade should define ${indexName}`);
  }

  const executionIndexes = getMetadataArgsStorage().indices
    .filter((entry) => entry.target === SuggestedTradeExecution)
    .map((entry) => entry.name);

  for (const indexName of [
    'idx_suggested_trade_executions_user_order_lookup',
    'idx_suggested_trade_executions_user_paper_order_lookup',
    'idx_suggested_trade_executions_user_position_lookup',
    'idx_suggested_trade_executions_user_state_seen_at',
  ]) {
    assert.ok(
      executionIndexes.includes(indexName),
      `SuggestedTradeExecution should define ${indexName}`
    );
  }

  const executionColumns = getMetadataArgsStorage().columns.filter(
    (column) => column.target === SuggestedTradeExecution
  );
  assert.equal(
    executionColumns.find((column) => column.propertyName === 'suggestedTradeId')?.options.name,
    'suggested_trade_id'
  );
  assert.equal(
    executionColumns.find((column) => column.propertyName === 'userId')?.options.name,
    'user_id'
  );
  assert.equal(
    executionColumns.find((column) => column.propertyName === 'paperOrderId')?.options.name,
    'paper_order_id'
  );
  assert.equal(
    executionColumns.find((column) => column.propertyName === 'executionState')?.options.name,
    'execution_state'
  );

  const paperOrderIndexes = getMetadataArgsStorage().indices
    .filter((entry) => entry.target === PaperOrder)
    .map((entry) => entry.name);
  assert.ok(
    paperOrderIndexes.includes('idx_paper_orders_suggested_trade_id'),
    'PaperOrder should define idx_paper_orders_suggested_trade_id'
  );

  const outputIndexes = getMetadataArgsStorage().indices
    .filter((entry) => entry.target === AutomationRunOutput)
    .map((entry) => entry.name);
  assert.ok(
    outputIndexes.includes('idx_automation_run_outputs_suggested_trade_id'),
    'AutomationRunOutput should define idx_automation_run_outputs_suggested_trade_id'
  );
}

async function runAlertDeliveryPolicyAssertions(): Promise<void> {
  const emailOnlyRepo = new AlertRepository() as any;
  const emailOnlyAlerts: Array<Record<string, unknown>> = [];
  const emailOnlyDeliveries: Array<Record<string, unknown>> = [];

  Object.defineProperty(emailOnlyRepo, 'appSettingsRepository', {
    get: () => ({
      async findOne() {
        return {
          notifyEmail: true,
          notifyInApp: true,
          notificationChannel: 'email',
          notificationSeverity: 'all',
          escalationRoute: 'manual',
          escalationSlaMinutes: 30,
        };
      },
    }),
  });
  Object.defineProperty(emailOnlyRepo, 'userEntityRepository', {
    get: () => ({
      async findOne() {
        return { email: 'alerts@auralpha.com' };
      },
    }),
  });
  Object.defineProperty(emailOnlyRepo, 'alertRepository', {
    get: () => ({
      create(payload: Record<string, unknown>) {
        return payload;
      },
      async save(payload: Record<string, unknown>) {
        emailOnlyAlerts.push(payload);
        return { id: 'alert-1', ...payload };
      },
    }),
  });
  Object.defineProperty(emailOnlyRepo, 'emailDeliveryRepository', {
    get: () => ({
      create(payload: Record<string, unknown>) {
        return payload;
      },
      async save(payload: Record<string, unknown>) {
        emailOnlyDeliveries.push(payload);
        return payload;
      },
    }),
  });
  emailOnlyRepo.findRecentEmailDeliveryBySignature = async () => null;

  const emailOnlyResult = await emailOnlyRepo.createAlert({
    userId: 'user-1',
    severity: 'High',
    channel: 'Scheduler',
    symbol: 'SYSTEM',
    message: 'Worker heartbeat missing',
    route: 'Risk review',
    status: 'Open',
    source: 'scheduler-health',
    applyEscalationPolicy: true,
  });

  assert.equal(emailOnlyResult, null);
  assert.equal(emailOnlyAlerts.length, 0);
  assert.equal(emailOnlyDeliveries.length, 1);
  assert.equal(emailOnlyDeliveries[0].route, 'Manual triage');
  assert.match(String(emailOnlyDeliveries[0].body || ''), /Due in 30 min/);

  const bothRepo = new AlertRepository() as any;
  const bothAlerts: Array<Record<string, unknown>> = [];
  const bothDeliveries: Array<Record<string, unknown>> = [];

  Object.defineProperty(bothRepo, 'appSettingsRepository', {
    get: () => ({
      async findOne() {
        return {
          notifyEmail: false,
          notifyInApp: true,
          notificationChannel: 'both',
          notificationSeverity: 'all',
          escalationRoute: 'risk-review',
          escalationSlaMinutes: 15,
        };
      },
    }),
  });
  Object.defineProperty(bothRepo, 'userEntityRepository', {
    get: () => ({
      async findOne() {
        return { email: 'alerts@auralpha.com' };
      },
    }),
  });
  Object.defineProperty(bothRepo, 'alertRepository', {
    get: () => ({
      create(payload: Record<string, unknown>) {
        return payload;
      },
      async save(payload: Record<string, unknown>) {
        bothAlerts.push(payload);
        return { id: 'alert-2', ...payload };
      },
    }),
  });
  Object.defineProperty(bothRepo, 'emailDeliveryRepository', {
    get: () => ({
      create(payload: Record<string, unknown>) {
        return payload;
      },
      async save(payload: Record<string, unknown>) {
        bothDeliveries.push(payload);
        return payload;
      },
    }),
  });
  bothRepo.findRecentEmailDeliveryBySignature = async () => null;

  const bothResult = await bothRepo.createAlert({
    userId: 'user-2',
    severity: 'High',
    channel: 'Alerts',
    symbol: 'SYSTEM',
    message: 'Alert action failed',
    route: 'Risk review',
    status: 'Open',
    source: 'alerts-api',
    applyEscalationPolicy: true,
  });

  assert.equal(bothAlerts.length, 1);
  assert.equal(bothDeliveries.length, 0);
  assert.equal(bothResult?.id, 'alert-2');
}

async function runAlertsAtomicActionAssertions(): Promise<void> {
  const service = new AlertsService() as any;
  const originalTransaction = (coreDataSource as any).transaction;
  const activityLogs: Array<Record<string, unknown>> = [];
  const failureAlerts: Array<Record<string, unknown>> = [];
  const committedAlerts = new Map<string, Record<string, unknown>>([
    [
      'alert-1',
      {
        id: 'alert-1',
        userId: 'user-1',
        severity: 'High',
        channel: 'Watchlist',
        symbol: 'BTCUSDT',
        message: 'Breakout threshold triggered',
        route: 'Signal review',
        status: 'Open',
        source: 'Momentum Core',
        urgency: 'Immediate',
        createdAt: new Date('2026-04-04T00:00:00.000Z'),
        updatedAt: new Date('2026-04-04T00:00:00.000Z'),
      },
    ],
    [
      'alert-2',
      {
        id: 'alert-2',
        userId: 'user-1',
        severity: 'Medium',
        channel: 'Risk',
        symbol: 'ETHUSDT',
        message: 'Margin utilization elevated',
        route: 'Risk review',
        status: 'Open',
        source: 'Portfolio Guard',
        urgency: 'Monitor',
        createdAt: new Date('2026-04-04T00:01:00.000Z'),
        updatedAt: new Date('2026-04-04T00:01:00.000Z'),
      },
    ],
  ]);
  const committedActions: Array<Record<string, unknown>> = [];
  let failingActionType: string | null = null;

  service.activityRepository = {
    async createActivityLog(payload: Record<string, unknown>) {
      activityLogs.push({ ...payload });
      return payload;
    },
  };

  service.alertRepository = {
    async findOpenAlertBySignature() {
      return null;
    },
    async createAlert(payload: Record<string, unknown>) {
      const created = {
        id: `failure-alert-${failureAlerts.length + 1}`,
        ...payload,
      };
      failureAlerts.push(created);
      return created;
    },
  };

  (coreDataSource as any).transaction = async (callback: (manager: any) => Promise<unknown>) => {
    const pendingAlerts = new Map<string, Record<string, unknown>>(
      Array.from(committedAlerts.entries()).map(([alertId, value]) => [alertId, { ...value }])
    );
    const pendingActions = committedActions.map((item) => ({ ...item }));

    const manager = {
      getRepository(entity: unknown) {
        if (entity === Alert) {
          return {
            async findOne({
              where: { id, userId },
            }: {
              where: { id: string; userId: string };
            }) {
              const alert = pendingAlerts.get(id);
              if (!alert || alert.userId !== userId) {
                return null;
              }
              return { ...alert };
            },
            async update(
              criteria: { id: string; userId: string },
              payload: Record<string, unknown>
            ) {
              const existing = pendingAlerts.get(criteria.id);
              if (!existing || existing.userId !== criteria.userId) {
                return { affected: 0 };
              }

              pendingAlerts.set(criteria.id, {
                ...existing,
                ...payload,
                updatedAt: new Date('2026-04-04T00:05:00.000Z'),
              });
              return { affected: 1 };
            },
          };
        }

        if (entity === AlertAction) {
          return {
            create(payload: Record<string, unknown>) {
              return { ...payload };
            },
            async save(payload: Record<string, unknown>) {
              if (payload.actionType === failingActionType) {
                throw new Error(`${String(payload.actionType)} action write failed`);
              }

              const saved = {
                id: `action-${pendingActions.length + 1}`,
                createdAt: new Date('2026-04-04T00:06:00.000Z'),
                ...payload,
              };
              pendingActions.push(saved);
              return saved;
            },
          };
        }

        throw new Error('Unexpected repository request');
      },
    };

    const result = await callback(manager);
    committedAlerts.clear();
    for (const [alertId, value] of pendingAlerts.entries()) {
      committedAlerts.set(alertId, value);
    }
    committedActions.splice(0, committedActions.length, ...pendingActions);
    return result;
  };

  try {
    const acknowledged = await service.acknowledgeAlert('user-1', 'alert-1', {
      note: 'Reviewed by ops',
    });

    assert.equal(acknowledged.data.message, 'Alert acknowledged');
    assert.equal(acknowledged.data.alert.id, 'alert-1');
    assert.equal(acknowledged.data.alert.status, 'Acknowledged');
    assert.equal(acknowledged.data.alert.updatedAt, '2026-04-04T00:05:00.000Z');
    assert.equal(committedAlerts.get('alert-1')?.status, 'Acknowledged');
    assert.equal(committedActions.length, 1);
    assert.equal(committedActions[0].actionType, 'acknowledge');
    assert.equal(committedActions[0].note, 'Reviewed by ops');
    assert.equal(
      activityLogs.filter((item) => item.title === 'Alert acknowledged').length,
      1
    );
    assert.equal(failureAlerts.length, 0);

    const muted = await service.muteAlert('user-1', 'alert-2', {
      reason: 'Duplicate alert',
    });

    assert.equal(muted.data.message, 'Alert muted');
    assert.equal(muted.data.alert.id, 'alert-2');
    assert.equal(muted.data.alert.status, 'Muted');
    assert.equal(muted.data.alert.updatedAt, '2026-04-04T00:05:00.000Z');
    assert.equal(committedAlerts.get('alert-2')?.status, 'Muted');
    assert.equal(committedActions.length, 2);
    assert.equal(committedActions[1].actionType, 'mute');
    assert.equal(committedActions[1].note, 'Duplicate alert');
    assert.equal(activityLogs.filter((item) => item.title === 'Alert muted').length, 1);
    assert.equal(failureAlerts.length, 0);

    const routed = await service.routeAlert('user-1', 'alert-2', {
      target: 'automations',
      note: 'Queue with automation desk',
    });

    assert.equal(routed.data.message, 'Alert triage updated');
    assert.equal(routed.data.alert.id, 'alert-2');
    assert.equal(routed.data.alert.route, 'Automation desk');
    assert.equal(routed.data.alert.updatedAt, '2026-04-04T00:05:00.000Z');
    assert.equal(routed.data.target, 'automations');
    assert.equal(routed.data.targetLabel, 'Automation desk');
    assert.equal(routed.data.note, 'Queue with automation desk');
    assert.equal(committedAlerts.get('alert-2')?.route, 'Automation desk');
    assert.equal(committedActions.length, 3);
    assert.equal(committedActions[2].actionType, 'route');
    assert.equal(committedActions[2].target, 'automations');
    assert.equal(committedActions[2].note, 'Queue with automation desk');
    assert.deepEqual(committedActions[2].metadata, {
      target: 'automations',
      targetLabel: 'Automation desk',
    });
    assert.equal(
      activityLogs.filter((item) => item.title === 'Alert triage updated to Automation desk').length,
      1
    );
    assert.equal(failureAlerts.length, 0);

    failingActionType = 'route';

    await assert.rejects(
      service.routeAlert('user-1', 'alert-1', { target: 'orders' }),
      /route action write failed/
    );

    assert.equal(committedAlerts.get('alert-1')?.route, 'Signal review');
    assert.equal(committedAlerts.get('alert-1')?.status, 'Acknowledged');
    assert.equal(committedActions.length, 3);
    assert.equal(
      activityLogs.filter((item) => item.title === 'Alert triage update failed').length,
      1
    );
    assert.equal(failureAlerts.length, 1);
    assert.equal(failureAlerts[0].userId, 'user-1');
    assert.equal(failureAlerts[0].channel, 'Alerts');
    assert.equal(failureAlerts[0].status, 'Open');
    assert.match(
      String(failureAlerts[0].message || ''),
      /Alert action failed \(route, alert-1\): route action write failed/
    );
  } finally {
    (coreDataSource as any).transaction = originalTransaction;
  }
}

async function runAlertDetailMappingAssertions(): Promise<void> {
  const service = new AlertsService() as any;

  service.alertRepository = {
    async getAlertById(userId: string, alertId: string) {
      assert.equal(userId, 'user-1');
      assert.equal(alertId, 'alert-1');
      return {
        id: 'alert-1',
        userId: 'user-1',
        severity: 'High',
        channel: 'Signals',
        symbol: 'BTCUSDT',
        message: 'Breakout threshold triggered',
        route: 'Automation desk',
        status: 'Acknowledged',
        source: 'signals-promotion',
        urgency: 'Immediate',
        createdAt: new Date('2026-04-04T00:00:00.000Z'),
        updatedAt: new Date('2026-04-04T00:09:00.000Z'),
        actions: [
          {
            id: 'action-2',
            actionType: 'route',
            target: 'automations',
            note: 'Queue with automation desk',
            actor: 'user-1',
            metadata: {
              target: 'automations',
              targetLabel: 'Automation desk',
            },
            createdAt: new Date('2026-04-04T00:08:00.000Z'),
          },
          {
            id: 'action-1',
            actionType: 'acknowledge',
            target: null,
            note: 'Reviewed by ops',
            actor: 'user-1',
            metadata: null,
            createdAt: new Date('2026-04-04T00:05:00.000Z'),
          },
        ],
      };
    },
  };

  const response = await service.getAlertById('user-1', 'alert-1');

  assert.equal(response.data.id, 'alert-1');
  assert.equal(response.data.status, 'Acknowledged');
  assert.equal(response.data.createdAt, '2026-04-04T00:00:00.000Z');
  assert.equal(response.data.updatedAt, '2026-04-04T00:09:00.000Z');
  assert.equal(response.data.history.length, 3);
  assert.deepEqual(
    response.data.history.map((item: { title: string }) => item.title),
    ['Assigned to Automation desk', 'Alert acknowledged', 'Alert created']
  );
  assert.equal(response.data.history[0].target, 'automations');
  assert.equal(response.data.history[0].targetLabel, 'Automation desk');
  assert.equal(response.data.history[0].note, 'Queue with automation desk');
  assert.equal(response.data.history[1].note, 'Reviewed by ops');
  assert.equal(response.data.history[2].actor, 'signals-promotion');
  assert.equal('targetLabel' in response.data.history[2], false);
}

async function runScopedAlertsSummaryAssertions(): Promise<void> {
  const service = new AlertsService() as any;
  let capturedUserId = '';
  let capturedQuery: Record<string, unknown> | null = null;

  service.alertRepository = {
    async getAlertsSummary(userId: string, query: Record<string, unknown>) {
      capturedUserId = userId;
      capturedQuery = query;
      return {
        openAlerts: 4,
        acknowledged: 1,
        highSeverityAlerts: 2,
      };
    },
  };

  const response = await service.getScopedAlertsSummary('user-1', {
    limit: '50',
    offset: '20',
    status: 'Open',
    search: 'BTC',
    severity: 'High',
    channel: 'Signals',
  });

  assert.equal(capturedUserId, 'user-1');
  assert.deepEqual(capturedQuery, {
    status: 'Open',
    search: 'BTC',
    severity: 'High',
    channel: 'Signals',
  });
  assert.deepEqual(response.data, {
    openAlerts: 4,
    acknowledged: 1,
    highSeverityAlerts: 2,
    criticalSeverity: 2,
    watchlistCapable: 'Yes',
  });
}

async function runAlertsOverviewScopeAssertions(): Promise<void> {
  const service = new AlertsOverviewService() as any;
  const capturedCalls: Array<{ method: string; args: unknown[] }> = [];

  service.alertsService = {
    async getAlerts(...args: unknown[]) {
      capturedCalls.push({ method: 'getAlerts', args });
      return {
        data: {
          items: [],
          total: 0,
          limit: 20,
          offset: 0,
        },
      };
    },
    async getScopedAlertsSummary(...args: unknown[]) {
      capturedCalls.push({ method: 'getScopedAlertsSummary', args });
      return {
        data: {
          openAlerts: 2,
          acknowledged: 0,
          highSeverityAlerts: 1,
          criticalSeverity: 1,
          watchlistCapable: 'Yes',
        },
      };
    },
  };

  const query = {
    limit: '20',
    offset: '0',
    status: 'Open',
    search: 'BTC',
    severity: 'High',
    channel: 'Signals',
  };
  const response = await service.getOverview('user-1', query);

  assert.deepEqual(capturedCalls, [
    { method: 'getAlerts', args: ['user-1', query] },
    { method: 'getScopedAlertsSummary', args: ['user-1', query] },
  ]);
  assert.deepEqual(response.data.summary, {
    openAlerts: 2,
    acknowledged: 0,
    highSeverityAlerts: 1,
    criticalSeverity: 1,
    watchlistCapable: 'Yes',
  });
}

async function runDiscoveryDependencyServiceAssertions(): Promise<void> {
  const service = new DiscoveryDependencyService();
  const originalFetch = globalThis.fetch;
  const originalDiscoveryApiBaseUrl = env.discovery.apiBaseUrl;

  env.discovery.apiBaseUrl = 'http://localhost:8000/api/v1/discovery';

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);

    const jsonResponse = (status: number, payload: unknown) =>
      new Response(JSON.stringify(payload), {
        status,
        headers: {
          'content-type': 'application/json',
        },
      });

    if (url === 'http://localhost:8000/health') {
      return jsonResponse(200, {
        status: 'ok',
        service: 'discovery-engine',
      });
    }

    if (url === 'http://localhost:8000/health/ready') {
      return jsonResponse(200, {
        status: 'ok',
        service: 'discovery-engine',
        dependencies: {
          postgres: { status: 'ok' },
          mysql: { status: 'ok' },
          redis: { status: 'ok' },
        },
      });
    }

    if (url === 'http://localhost:8000/api/v1/discovery/bots?limit=1&offset=0') {
      return jsonResponse(200, {
        items: [
          {
            id: 'bot-1',
            name: 'Discovery Bot 1',
            status: 'running',
          },
        ],
        total: 1,
      });
    }

    if (url === 'http://localhost:8000/api/v1/discovery/runs?limit=1&offset=0') {
      return jsonResponse(200, {
        items: [
          {
            id: 'run-1',
            status: 'completed',
          },
        ],
        total: 1,
      });
    }

    if (url === 'http://localhost:8000/api/v1/discovery/strategies?limit=1&offset=0') {
      return jsonResponse(200, {
        items: [
          {
            id: 'strategy-1',
            name: 'Discovery Strategy 1',
            status: 'approved',
          },
        ],
        total: 1,
      });
    }

    if (url === 'http://localhost:8000/api/v1/discovery/template-suggestions?limit=1&offset=0') {
      return jsonResponse(200, {
        items: [],
        total: 0,
      });
    }

    if (url === 'http://localhost:8000/api/v1/discovery/preferences') {
      return jsonResponse(200, {
        id: 'pref-1',
        user_id: 'user-1',
        preferred_segments: [],
        preferred_assets: [],
        preferred_timeframes: ['1h', '4h'],
        preferred_strategy_types: [],
        preferred_ai_approach: 'algorithmic',
        risk_tolerance: 'medium',
        auto_backtest_approved: false,
        notification_settings: {},
      });
    }

    if (url === 'http://localhost:8000/api/v1/discovery/bots/bot-1') {
      return jsonResponse(200, {
        id: 'bot-1',
        name: 'Discovery Bot 1',
        status: 'running',
      });
    }

    if (url === 'http://localhost:8000/api/v1/discovery/runs/run-1') {
      return jsonResponse(200, {
        id: 'run-1',
        status: 'completed',
      });
    }

    if (url === 'http://localhost:8000/api/v1/discovery/strategies/strategy-1') {
      return jsonResponse(200, {
        id: 'strategy-1',
        name: 'Discovery Strategy 1',
        status: 'approved',
      });
    }

    throw new Error(`Unexpected discovery dependency fetch: ${url}`);
  }) as typeof globalThis.fetch;

  try {
    const response = await service.getDependencyHealth('Bearer token-1');

    assert.equal(response.status, 'ok');
    assert.equal(response.baseUrl, 'http://localhost:8000/api/v1/discovery');
    assert.equal(response.service.status, 'ok');
    assert.equal(response.readiness.status, 'ok');
    assert.equal(response.auth.status, 'ok');
    assert.equal(response.contract.status, 'ok');
    assert.deepEqual(response.contract.checkedEndpoints, [
      'bots',
      'runs',
      'strategies',
      'template-suggestions',
      'preferences',
      'bot-detail',
      'run-detail',
      'strategy-detail',
    ]);
    assert.equal(response.endpoints.length, 8);
    assert.equal(response.endpoints.every((item) => item.status === 'ok'), true);
    assert.equal(response.readiness.dependencies?.postgres?.status, 'ok');
    assert.equal(response.readiness.dependencies?.mysql?.status, 'ok');
    assert.equal(response.readiness.dependencies?.redis?.status, 'ok');
    assert.equal(response.endpoints.find((item) => item.key === 'bot-detail')?.probeMode, 'sampled');
    assert.equal(response.endpoints.find((item) => item.key === 'bot-detail')?.sampledId, 'bot-1');
    assert.equal(response.endpoints.find((item) => item.key === 'run-detail')?.probeMode, 'sampled');
    assert.equal(response.endpoints.find((item) => item.key === 'run-detail')?.sampledId, 'run-1');
    assert.equal(
      response.endpoints.find((item) => item.key === 'strategy-detail')?.probeMode,
      'sampled'
    );
    assert.equal(
      response.endpoints.find((item) => item.key === 'strategy-detail')?.sampledId,
      'strategy-1'
    );
  } finally {
    globalThis.fetch = originalFetch;
    env.discovery.apiBaseUrl = originalDiscoveryApiBaseUrl;
  }
}

async function runDiscoverySummaryServiceAssertions(): Promise<void> {
  const service = new DiscoverySummaryService();
  const originalFetch = globalThis.fetch;
  const originalDiscoveryApiBaseUrl = env.discovery.apiBaseUrl;

  env.discovery.apiBaseUrl = 'http://localhost:8000/api/v1/discovery';

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);

    const jsonResponse = (status: number, payload: unknown) =>
      new Response(JSON.stringify(payload), {
        status,
        headers: {
          'content-type': 'application/json',
        },
      });

    if (url === 'http://localhost:8000/api/v1/discovery/bots?limit=1&offset=0') {
      return jsonResponse(200, {
        items: [{ id: 'bot-3', status: 'running' }],
        total: 3,
      });
    }

    if (url === 'http://localhost:8000/api/v1/discovery/bots?limit=200&offset=0') {
      return jsonResponse(200, {
        items: [
          { id: 'bot-3', status: 'running' },
          { id: 'bot-2', status: 'stopped' },
          { id: 'bot-1', status: 'running' },
        ],
        total: 3,
      });
    }

    if (url === 'http://localhost:8000/api/v1/discovery/strategies?limit=1&offset=0&status=pending_review') {
      return jsonResponse(200, {
        items: [{ id: 'strat-2', score: 0.82 }],
        total: 2,
      });
    }

    if (url === 'http://localhost:8000/api/v1/discovery/strategies?limit=1&offset=0') {
      return jsonResponse(200, {
        items: [{ id: 'strat-9', score: 0.91 }],
        total: 9,
      });
    }

    if (url === 'http://localhost:8000/api/v1/discovery/template-suggestions?limit=1&offset=0') {
      return jsonResponse(200, {
        items: [{ id: 'suggestion-1' }],
        total: 4,
      });
    }

    if (url === 'http://localhost:8000/api/v1/discovery/runs?limit=1&offset=0') {
      return jsonResponse(200, {
        items: [{ id: 'run-1' }],
        total: 7,
      });
    }

    throw new Error(`Unexpected discovery summary fetch: ${url}`);
  }) as typeof globalThis.fetch;

  try {
    const response = await service.getSummary('Bearer token-1');

    assert.equal(response.bots.total, 3);
    assert.equal(response.bots.active, 2);
    assert.equal(response.strategies.total, 9);
    assert.equal(response.strategies.pendingReview, 2);
    assert.equal(response.strategies.bestScore, 0.91);
    assert.equal(response.suggestions.total, 4);
    assert.equal(response.runs.total, 7);
    assert.ok(response.checkedAt);
  } finally {
    globalThis.fetch = originalFetch;
    env.discovery.apiBaseUrl = originalDiscoveryApiBaseUrl;
  }
}

async function runDiscoveryFeedServiceAssertions(): Promise<void> {
  const service = new DiscoveryFeedService();
  const originalFetch = globalThis.fetch;
  const originalDiscoveryApiBaseUrl = env.discovery.apiBaseUrl;

  env.discovery.apiBaseUrl = 'http://localhost:8000/api/v1/discovery';

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);

    const jsonResponse = (status: number, payload: unknown) =>
      new Response(JSON.stringify(payload), {
        status,
        headers: {
          'content-type': 'application/json',
        },
      });

    if (url === 'http://localhost:8000/api/v1/discovery/runs?limit=5&offset=0&bot_id=bot-1') {
      return jsonResponse(200, {
        items: [
          {
            id: 'run-2',
            bot_id: 'bot-1',
            status: 'running',
            started_at: '2026-04-06T05:00:00.000Z',
            completed_at: null,
            duration_seconds: null,
            assets_scanned: 8,
            strategies_discovered: 0,
            run_config: {
              assets: ['BTCUSDT', 'ETHUSDT'],
              timeframes: ['1h', '4h'],
            },
            error_message: null,
          },
          {
            id: 'run-1',
            bot_id: 'bot-1',
            status: 'completed',
            started_at: '2026-04-06T04:00:00.000Z',
            completed_at: '2026-04-06T04:10:00.000Z',
            duration_seconds: 600,
            assets_scanned: 12,
            strategies_discovered: 3,
            run_config: {
              assets: ['BTCUSDT'],
              timeframes: ['1h'],
            },
            error_message: null,
          },
        ],
        total: 2,
      });
    }

    throw new Error(`Unexpected discovery feed fetch: ${url}`);
  }) as typeof globalThis.fetch;

  try {
    const response = await service.getFeed('Bearer token-2', {
      limit: '5',
      botId: 'bot-1',
    });

    assert.equal(response.items.length, 2);
    assert.equal(response.items[0]?.type, 'run_progress');
    assert.equal(response.items[0]?.runId, 'run-2');
    assert.equal(response.items[0]?.botId, 'bot-1');
    assert.equal(response.items[0]?.status, 'running');
    assert.equal(response.items[0]?.assetsScanned, 8);
    assert.deepEqual(response.items[0]?.assets, ['BTCUSDT', 'ETHUSDT']);
    assert.deepEqual(response.items[0]?.timeframes, ['1h', '4h']);
    assert.equal(response.items[1]?.type, 'run_completed');
    assert.equal(response.items[1]?.runId, 'run-1');
    assert.equal(response.items[1]?.strategiesFound, 3);
    assert.equal(response.items[1]?.durationSeconds, 600);
    assert.ok(response.checkedAt);
  } finally {
    globalThis.fetch = originalFetch;
    env.discovery.apiBaseUrl = originalDiscoveryApiBaseUrl;
  }
}

async function runEmailDeliveryWorkerAssertions(): Promise<void> {
  const processedIds: string[] = [];
  const failedIds: string[] = [];

  const worker = new EmailDeliveryWorker(
    {
      async claimPendingDeliveries() {
        return [
          {
            id: 'delivery-1',
            recipientEmail: 'alerts@auralpha.com',
            subject: 'Alert one',
            body: 'Body one',
            alertId: 'alert-1',
          },
          {
            id: 'delivery-2',
            recipientEmail: 'alerts@auralpha.com',
            subject: 'Alert two',
            body: 'Body two',
            alertId: 'alert-2',
          },
        ];
      },
      async markSent(id: string) {
        processedIds.push(id);
      },
      async markFailed(id: string) {
        failedIds.push(id);
      },
    } as any,
    {
      async validateConfiguration() {
        return;
      },
      async verify() {
        return;
      },
      async send(delivery: { id: string }) {
        if (delivery.id === 'delivery-2') {
          throw new Error('smtp send failed');
        }
      },
    } as any
  );
  (worker as any).log = {
    info() {
      return;
    },
    error() {
      return;
    },
    warn() {
      return;
    },
  };

  await worker.processBatch();

  assert.deepEqual(processedIds, ['delivery-1']);
  assert.deepEqual(failedIds, ['delivery-2']);
}

async function runSchedulerOverviewUserScopeAssertions(): Promise<void> {
  const service = new SchedulerOverviewService() as any;
  const originalQuery = coreDataSource.query.bind(coreDataSource);
  const capturedQueries: Array<{ sql: string; params: unknown[] }> = [];

  service.userTimeZoneService = {
    async resolveUserTimeZone(userId: string) {
      assert.equal(userId, 'user-7');
      return 'UTC';
    },
  };

  (coreDataSource as any).query = async (sql: string, params: unknown[] = []) => {
    capturedQueries.push({ sql, params });

    if (sql.includes('FROM scheduler_configs')) {
      return [
        {
          key: 'broker-assets-sync',
          name: 'Broker Assets Sync',
          enabled: 1,
          last_finished_at: '2026-04-04T18:00:00.000Z',
          last_status: 'Completed',
          last_error: null,
          scheduler_type: 'global',
        },
        {
          key: 'discovery-self-identify-sync',
          name: 'Discovery Scheduler',
          enabled: 0,
          last_finished_at: '2026-04-04T17:00:00.000Z',
          last_status: 'Failed',
          last_error: 'Global discovery stale',
          scheduler_type: 'global',
        },
        {
          key: 'signals-scan-sync',
          name: 'Signals Scan',
          enabled: 0,
          last_finished_at: '2026-04-05T02:30:00.000Z',
          last_status: 'Failed',
          last_error: 'Inbox sync failed',
          scheduler_type: 'global',
        },
      ];
    }

    if (sql.includes('FROM scheduler_user_configs')) {
      assert.deepEqual(params, ['user-7']);
      return [
        {
          key: 'signals-scan-sync',
          name: 'Signals Scan',
          enabled: 0,
          last_finished_at: '2026-04-05T02:30:00.000Z',
          last_status: 'Failed',
          last_error: 'Inbox sync failed',
          scheduler_type: 'user',
        },
      ];
    }

    if (
      sql.includes('FROM scheduler_run_logs') &&
      sql.includes('actor_user_id = ?') &&
      sql.includes('WHERE status = ?')
    ) {
      assert.deepEqual(params, ['Running', 'user-7']);
      return [];
    }

    if (
      sql.includes('FROM scheduler_run_logs') &&
      sql.includes('actor_user_id IS NULL') &&
      sql.includes('WHERE status = ?')
    ) {
      assert.deepEqual(params, ['Running']);
      return [
        {
          id: 'run-broker-1',
          schedulerKey: 'broker-assets-sync',
          status: 'Running',
          startedAt: '2026-04-05T01:00:00.000Z',
          finishedAt: null,
          errorMessage: null,
          meta: { progress: { total: 10, processed: 3, percent: 30 } },
        },
        {
          id: 'run-signals-global-1',
          schedulerKey: 'signals-scan-sync',
          status: 'Running',
          startedAt: '2026-04-05T02:00:00.000Z',
          finishedAt: null,
          errorMessage: null,
          meta: { progress: { total: 4, processed: 1, percent: 25 } },
        },
      ];
    }

    if (sql.includes('FROM scheduler_run_logs') && sql.includes('actor_user_id = ?')) {
      assert.deepEqual(params, ['user-7']);
      return [
        {
          id: 'run-signals-user-1',
          schedulerKey: 'signals-scan-sync',
          status: 'Failed',
          startedAt: '2026-04-05T02:25:00.000Z',
          finishedAt: '2026-04-05T02:30:00.000Z',
          errorMessage: 'Inbox sync failed',
          meta: { progress: { total: 4, processed: 4, percent: 100 } },
        },
      ];
    }

    if (sql.includes('FROM scheduler_run_logs') && sql.includes('actor_user_id IS NULL')) {
      assert.deepEqual(params, []);
      return [
        {
          id: 'run-broker-last-1',
          schedulerKey: 'broker-assets-sync',
          status: 'Completed',
          startedAt: '2026-04-04T17:45:00.000Z',
          finishedAt: '2026-04-04T18:00:00.000Z',
          errorMessage: null,
          meta: { progress: { total: 10, processed: 10, percent: 100 } },
        },
        {
          id: 'run-discovery-global-1',
          schedulerKey: 'discovery-self-identify-sync',
          status: 'Failed',
          startedAt: '2026-04-04T16:45:00.000Z',
          finishedAt: '2026-04-04T17:00:00.000Z',
          errorMessage: 'Global discovery stale',
          meta: { progress: { total: 2, processed: 2, percent: 100 } },
        },
      ];
    }

    if (sql.includes('FROM scheduler_commands') && sql.includes('actor_user_id = ?')) {
      assert.deepEqual(params, ['user-7']);
      return [
        {
          id: 'command-signals-1',
          schedulerKey: 'signals-scan-sync',
          createdAt: '2026-04-05T05:00:00.000Z',
        },
      ];
    }

    if (sql.includes('FROM scheduler_commands') && sql.includes('actor_user_id IS NULL')) {
      assert.deepEqual(params, []);
      return [
        {
          id: 'command-discovery-global-1',
          schedulerKey: 'discovery-self-identify-sync',
          createdAt: '2026-04-05T03:00:00.000Z',
        },
      ];
    }

    throw new Error(`Unexpected scheduler overview query: ${sql}`);
  };

  try {
    const response = await service.getOverview('user-7');

    assert.equal(capturedQueries.length, 8);
    assert.deepEqual(
      response.data.items.map((item: any) => item.key),
      ['broker-assets-sync']
    );

    const broker = response.data.items[0];
    assert.equal(broker?.name, 'Broker Assets Sync');
    assert.equal(broker?.enabled, true);
    assert.equal(broker?.status, 'running');
    assert.equal(broker?.runId, 'run-broker-1');
    assert.equal(broker?.startedAt, '2026-04-05T01:00:00.000+00:00');
    assert.equal(broker?.lastStatus, 'Completed');

  } finally {
    (coreDataSource as any).query = originalQuery;
  }
}

async function runEmailDeliveriesServiceAssertions(): Promise<void> {
  const service = new EmailDeliveriesService() as any;
  const adminAuth = { userId: 'admin-1', role: 'admin' };
  const cleanupActivities: Array<Record<string, unknown>> = [];

  service.emailDeliveryRepository = {
    async getFilterOptions() {
      return {
        severities: ['High', 'Medium'],
        channels: ['Alerts', 'Scheduler'],
      };
    },
  };
  service.activityRepository = {
    async getLatestEmailDeliveryCleanupActivity() {
      return {
        id: 'activity-1',
        userId: 'admin-2',
        title: 'Retention email cleanup removed 4 deliveries',
        status: 'Success',
        actor: 'admin-2',
        stream: 'Controls',
        route: 'Email Deliveries',
        related: 'retention-cleanup',
        description: 'Deleted 4 terminal delivery rows.',
        createdAt: new Date('2026-04-04T09:00:00.000Z'),
      };
    },
    async createActivityLog(payload: Record<string, unknown>) {
      cleanupActivities.push(payload);
      return {
        id: `activity-${cleanupActivities.length}`,
        createdAt: new Date('2026-04-04T10:00:00.000Z'),
        ...payload,
      };
    },
  };

  const filterResponse = await service.getEmailDeliveryFilterOptions(adminAuth);
  assert.deepEqual(filterResponse.data, {
    severities: ['High', 'Medium'],
    channels: ['Alerts', 'Scheduler'],
    defaultRetentionDays: 30,
    exportMaxRows: 5000,
    bodyVisibility: 'redacted-preview',
    governance: {
      bodyVisibility: 'redacted-preview',
      cleanupEligibleStatuses: ['Sent', 'Failed'],
      cleanupProtectedStatuses: ['Queued', 'Sending'],
      retentionField: 'updatedAt',
      bodyPreviewMaxChars: 600,
      bodyPreviewMaxLines: 8,
    },
  });

  const cleanupResponse = await service.getLatestCleanupActivity(adminAuth);
  assert.deepEqual(cleanupResponse.data, {
    id: 'activity-1',
    userId: 'admin-2',
    title: 'Retention email cleanup removed 4 deliveries',
    status: 'Success',
    actor: 'admin-2',
    stream: 'Controls',
    route: 'Email Deliveries',
    related: 'retention-cleanup',
    description: 'Deleted 4 terminal delivery rows.',
    time: '2026-04-04T09:00:00.000Z',
  });

  service.emailDeliveryRepository = {
    async getDeliveryById(deliveryId: string) {
      assert.equal(deliveryId, 'delivery-1');
      return {
        id: deliveryId,
        userId: 'admin-1',
        alertId: 'alert-1',
        recipientEmail: 'ops@example.com',
        subject: 'SMTP failure',
        body: [
          'Hello ops@example.com,',
          'Reset link: https://example.com/reset/token-ABC12345678901234567890',
          'Reference 123456 should not leak.',
        ].join('\n'),
        channel: 'Alerts',
        severity: 'High',
        route: 'Email Deliveries',
        source: 'worker:alert',
        status: 'Failed',
        attempts: 2,
        lastError: 'SMTP timeout',
        createdAt: new Date('2026-04-04T09:10:00.000Z'),
        updatedAt: new Date('2026-04-04T09:11:00.000Z'),
      };
    },
  };
  service.userRepository = {
    async findByIds(userIds: string[]) {
      assert.deepEqual(userIds, ['admin-1']);
      return [
        {
          id: 'admin-1',
          email: 'admin@example.com',
          fullName: 'Admin User',
        },
      ];
    },
  };

  const detailResponse = await service.getEmailDeliveryById(adminAuth, 'delivery-1');
  assert.equal(detailResponse.data.bodyPreview?.includes('[redacted-email]'), true);
  assert.equal(detailResponse.data.bodyPreview?.includes('[redacted-link]'), true);
  assert.equal(detailResponse.data.bodyPreview?.includes('[redacted-token]'), true);
  assert.equal(detailResponse.data.bodyPreviewTruncated, undefined);

  service.emailDeliveryRepository = {
    async getDeliveryById(deliveryId: string) {
      assert.equal(deliveryId, 'delivery-2');
      return {
        id: deliveryId,
        userId: 'admin-1',
        alertId: 'alert-2',
        recipientEmail: 'ops@example.com',
        subject: 'Alert resolved',
        body: 'Resolved for ops@example.com with token 123456.',
        channel: 'Alerts',
        severity: 'Medium',
        route: 'Signals',
        source: 'worker:resolved',
        status: 'Sent',
        attempts: 1,
        lastError: null,
        createdAt: new Date('2026-04-04T11:00:00.000Z'),
        updatedAt: new Date('2026-04-04T11:01:00.000Z'),
      };
    },
    async cloneDeliveryForResend(delivery: Record<string, unknown>) {
      assert.equal(delivery.id, 'delivery-2');
      return {
        ...delivery,
        id: 'delivery-3',
        status: 'Queued',
        attempts: 0,
        lastError: null,
        createdAt: new Date('2026-04-04T11:02:00.000Z'),
        updatedAt: new Date('2026-04-04T11:02:00.000Z'),
      };
    },
  };

  const resendResponse = await service.resendEmailDelivery(adminAuth, 'delivery-2');
  assert.equal(
    resendResponse.data.message,
    'A new delivery copy has been queued. The original record remains unchanged for history.'
  );
  assert.equal(resendResponse.data.delivery.id, 'delivery-3');
  assert.equal(resendResponse.data.delivery.status, 'Queued');
  assert.equal(resendResponse.data.delivery.bodyPreview?.includes('[redacted-email]'), true);

  service.emailDeliveryRepository = {
    async getDeliveryById(deliveryId: string) {
      assert.equal(deliveryId, 'delivery-4');
      return {
        id: deliveryId,
        userId: 'admin-1',
        alertId: 'alert-4',
        recipientEmail: 'ops@example.com',
        subject: 'SMTP failed',
        body: 'Failure body',
        channel: 'Alerts',
        severity: 'High',
        route: 'Signals',
        source: 'worker:failed',
        status: 'Failed',
        attempts: 3,
        lastError: 'SMTP timeout',
        createdAt: new Date('2026-04-04T12:00:00.000Z'),
        updatedAt: new Date('2026-04-04T12:01:00.000Z'),
      };
    },
    async retryFailedDelivery() {
      return null;
    },
  };

  await assert.rejects(
    () => service.retryEmailDelivery(adminAuth, 'delivery-4'),
    (error: unknown) =>
      error instanceof Error &&
      error.message === 'This email delivery is no longer failed and cannot be retried again'
  );

  let deletedMatchingDeliveries = 0;
  service.emailDeliveryRepository = {
    async countMatchingTerminalDeliveries(filters: Record<string, unknown>) {
      assert.equal(filters.source, 'worker');
      return {
        total: 2,
        sent: 1,
        failed: 1,
      };
    },
    async deleteMatchingTerminalDeliveries(filters: Record<string, unknown>) {
      assert.equal(filters.source, 'worker');
      deletedMatchingDeliveries += 1;
      return 2;
    },
  };

  const cleanupMatchingResponse = await service.cleanupMatchingEmailDeliveries(adminAuth, {
    source: 'worker',
  });
  assert.equal(cleanupMatchingResponse.data.deletedCount, 2);
  assert.equal(cleanupMatchingResponse.data.deletedSentCount, 1);
  assert.equal(cleanupMatchingResponse.data.deletedFailedCount, 1);
  assert.equal(deletedMatchingDeliveries, 1);
  assert.equal(cleanupActivities.length, 1);
  assert.equal(cleanupActivities[0]?.route, 'Email Deliveries');
  assert.equal(cleanupActivities[0]?.related, 'filtered-cleanup');
}

async function runSettingsAtomicSaveAssertions(): Promise<void> {
  const service = new SettingsService() as any;
  const failureActivities: Array<Record<string, unknown>> = [];
  const failureAlerts: Array<Record<string, unknown>> = [];
  const committedSettings = new Map<string, Record<string, unknown>>();
  const committedAudits: Array<Record<string, unknown>> = [];
  const committedActivities: Array<Record<string, unknown>> = [];
  const originalTransaction = (coreDataSource as any).transaction;

  service.operationalEventService = {
    async logActivity(userId: string, payload: Record<string, unknown>) {
      failureActivities.push({ userId, ...payload });
    },
    async emitFailureAlert(userId: string, payload: Record<string, unknown>) {
      failureAlerts.push({ userId, ...payload });
    },
  };

  (coreDataSource as any).transaction = async (callback: (manager: any) => Promise<unknown>) => {
    const pendingSettings = new Map<string, Record<string, unknown>>(
      Array.from(committedSettings.entries()).map(([userId, value]) => [userId, { ...value }])
    );
    const pendingAudits = committedAudits.map((item) => ({ ...item }));
    const pendingActivities = committedActivities.map((item) => ({ ...item }));
    const manager = {
      getRepository(entity: unknown) {
        if (entity === AppSetting) {
          return {
            async findOne({ where: { userId } }: { where: { userId: string } }) {
              return pendingSettings.get(userId) ?? null;
            },
            create(payload: Record<string, unknown>) {
              return { ...payload };
            },
            merge(existing: Record<string, unknown>, payload: Record<string, unknown>) {
              return { ...existing, ...payload };
            },
            async save(payload: Record<string, unknown>) {
              const existing = pendingSettings.get(String(payload.userId));
              const saved = {
                id: existing?.id ?? pendingSettings.size + 1,
                createdAt: existing?.createdAt ?? new Date('2026-04-04T00:00:00.000Z'),
                updatedAt: new Date('2026-04-04T00:05:00.000Z'),
                ...payload,
              };
              pendingSettings.set(String(payload.userId), saved);
              return saved;
            },
          };
        }

        if (entity === SettingsAuditLog) {
          return {
            create(payload: Record<string, unknown>) {
              return { ...payload };
            },
            async save(payload: Array<Record<string, unknown>>) {
              if (payload.some((item) => item.userId === 'user-3')) {
                throw new Error('audit save failed');
              }

              for (const item of payload) {
                pendingAudits.push({
                  id: `audit-${pendingAudits.length + 1}`,
                  createdAt: new Date('2026-04-04T00:06:00.000Z'),
                  ...item,
                });
              }

              return payload;
            },
          };
        }

        if (entity === ActivityLog) {
          return {
            create(payload: Record<string, unknown>) {
              return { ...payload };
            },
            async save(payload: Record<string, unknown>) {
              if (payload.userId === 'user-2' && payload.title === 'User settings updated') {
                throw new Error('activity save failed');
              }

              const saved = {
                id: `activity-${pendingActivities.length + 1}`,
                createdAt: new Date('2026-04-04T00:07:00.000Z'),
                ...payload,
              };
              pendingActivities.push(saved);
              return saved;
            },
          };
        }

        throw new Error('Unexpected repository request');
      },
    };

    const result = await callback(manager);
    committedSettings.clear();
    for (const [userId, value] of pendingSettings.entries()) {
      committedSettings.set(userId, value);
    }
    committedAudits.splice(0, committedAudits.length, ...pendingAudits);
    committedActivities.splice(0, committedActivities.length, ...pendingActivities);
    return result;
  };

  try {
    const created = await service.updateSettings('user-1', {
      timezone: 'Asia/Kolkata',
      notifyEmail: false,
    });

    assert.equal(created.data.hasSavedSettings, true);
    assert.equal(created.data.versionToken, '2026-04-04T00:05:00.000Z');
    assert.equal(created.data.timezone, 'Asia/Kolkata');
    assert.equal(created.data.notifyEmail, false);
    assert.equal(created.data.notifyInApp, true);
    assert.deepEqual(
      created.data.backtestPromotionRules,
      createDefaultBacktestPromotionRules()
    );
    assert.deepEqual(
      committedSettings.get('user-1')?.backtestPromotionRules,
      createDefaultBacktestPromotionRules()
    );
    assert.deepEqual(
      committedAudits
        .filter((item) => item.userId === 'user-1')
        .map((item) => item.fieldName)
        .sort(),
      ['notifyEmail', 'timezone']
    );
    const createdTimezoneAudit = committedAudits.find((item) => item.fieldName === 'timezone');
    const createdNotifyEmailAudit = committedAudits.find((item) => item.fieldName === 'notifyEmail');
    assert.equal(createdTimezoneAudit?.oldValueType, 'null');
    assert.equal(createdTimezoneAudit?.newValueType, 'string');
    assert.equal(createdTimezoneAudit?.newValueJson, 'Asia/Kolkata');
    assert.equal(createdTimezoneAudit?.changeType, 'created');
    assert.equal(createdNotifyEmailAudit?.newValueType, 'boolean');
    assert.equal(createdNotifyEmailAudit?.newValueJson, false);
    assert.equal(createdNotifyEmailAudit?.changeType, 'created');
    assert.equal(
      committedActivities.filter(
        (item) => item.userId === 'user-1' && item.title === 'User settings updated'
      ).length,
      1
    );
    const noOpResponse = await service.updateSettings('user-1', {
      notifyEmail: false,
      expectedUpdatedAt: '2026-04-04T00:05:00.000Z',
    });
    assert.equal(noOpResponse.data.notifyEmail, false);
    assert.equal(noOpResponse.data.versionToken, '2026-04-04T00:05:00.000Z');
    assert.equal(
      committedAudits.filter((item) => item.userId === 'user-1').length,
      2
    );
    assert.equal(
      committedActivities.filter(
        (item) => item.userId === 'user-1' && item.title === 'User settings updated'
      ).length,
      1
    );
    const customizedRules = await service.updateSettings('user-5', {
      backtestPromotionRules: {
        minScore: 0.82,
        minTrades: 9,
        requireRobustness: false,
      },
    });
    assert.equal(customizedRules.data.backtestPromotionRules.minScore, 0.82);
    assert.equal(customizedRules.data.backtestPromotionRules.minTrades, 9);
    assert.equal(customizedRules.data.backtestPromotionRules.requireRobustness, false);
    const customizedRulesAudits = committedAudits.filter(
      (item) => item.userId === 'user-5'
    );
    assert.deepEqual(
      customizedRulesAudits.map((item) => item.fieldName).sort(),
      [
        'backtestPromotionRules.minScore',
        'backtestPromotionRules.minTrades',
        'backtestPromotionRules.requireRobustness',
      ]
    );
    const customizedMinScoreAudit = customizedRulesAudits.find(
      (item) => item.fieldName === 'backtestPromotionRules.minScore'
    );
    const customizedRobustnessAudit = customizedRulesAudits.find(
      (item) => item.fieldName === 'backtestPromotionRules.requireRobustness'
    );
    assert.equal(customizedMinScoreAudit?.newValueType, 'number');
    assert.equal(customizedMinScoreAudit?.newValueJson, 0.82);
    assert.equal(customizedRobustnessAudit?.newValueType, 'boolean');
    assert.equal(
      customizedRobustnessAudit?.newValueJson,
      false
    );
    await assert.rejects(
      service.updateSettings('user-1', {
        notifyInApp: false,
        expectedUpdatedAt: '2026-04-04T00:00:00.000Z',
      }),
      /Settings were updated elsewhere/
    );
    assert.equal(committedSettings.get('user-1')?.notifyInApp, true);
    assert.equal(
      committedActivities.filter(
        (item) => item.userId === 'user-1' && item.title === 'User settings updated'
      ).length,
      1
    );
    assert.equal(failureActivities.length, 1);
    assert.equal(failureActivities[0].userId, 'user-1');
    assert.equal(failureActivities[0].title, 'User settings update failed');
    assert.equal(failureAlerts.length, 0);

    await assert.rejects(
      service.updateSettings('user-2', { notificationSeverity: 'high' }),
      /activity save failed/
    );

    assert.equal(committedSettings.has('user-2'), false);
    assert.equal(committedAudits.some((item) => item.userId === 'user-2'), false);
    assert.equal(
      committedActivities.some(
        (item) => item.userId === 'user-2' && item.title === 'User settings updated'
      ),
      false
    );
    assert.equal(failureActivities.length, 2);
    assert.equal(failureActivities[1].userId, 'user-2');
    assert.equal(failureActivities[1].title, 'User settings update failed');
    assert.equal(failureAlerts.length, 1);
    assert.equal(failureAlerts[0].userId, 'user-2');

    await assert.rejects(
      service.updateSettings('user-3', { confirmDestructive: false }),
      /audit save failed/
    );

    assert.equal(committedSettings.has('user-3'), false);
    assert.equal(committedAudits.some((item) => item.userId === 'user-3'), false);
    assert.equal(
      committedActivities.some(
        (item) => item.userId === 'user-3' && item.title === 'User settings updated'
      ),
      false
    );
    assert.equal(failureActivities.length, 3);
    assert.equal(failureActivities[2].userId, 'user-3');
    assert.equal(failureActivities[2].title, 'User settings update failed');
    assert.equal(failureAlerts.length, 2);
    assert.equal(failureAlerts[1].userId, 'user-3');

    await assert.rejects(
      service.updateSettings('user-4', { expectedUpdatedAt: 'not-a-timestamp' }),
      /expectedUpdatedAt must be an ISO timestamp/
    );

    assert.equal(committedSettings.has('user-4'), false);
    assert.equal(committedAudits.some((item) => item.userId === 'user-4'), false);
    assert.equal(
      committedActivities.some(
        (item) => item.userId === 'user-4' && item.title === 'User settings updated'
      ),
      false
    );
    assert.equal(failureActivities.length, 4);
    assert.equal(failureActivities[3].userId, 'user-4');
    assert.equal(failureActivities[3].title, 'User settings update failed');
    assert.equal(failureAlerts.length, 2);
  } finally {
    (coreDataSource as any).transaction = originalTransaction;
  }
}

async function runConnectionsCanonicalizationAssertions(): Promise<void> {
  const service = new ConnectionsService() as any;
  type ConnectionUpdateCapture = {
    userId: string;
    connectionId: string;
    payload: Partial<Pick<Connection, 'lastSyncAt' | 'latency' | 'diagnosticSummary' | 'status'>>;
  };
  type BrokerAccountUpdateCapture = {
    userId: string;
    accountId: string;
    payload: Partial<BrokerAccount>;
  };
  const createdPayloads: Array<Record<string, unknown>> = [];
  const replacedPayloads: Array<{
    userId: string;
    connectionId: string;
    payload: Partial<Connection>;
  }> = [];
  const connectionUpdates: ConnectionUpdateCapture[] = [];
  const accountUpdates: BrokerAccountUpdateCapture[] = [];
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

  let persistedConnection: Connection = {
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

  Object.defineProperty(service, 'connectionRepository', {
    get: () => ({
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
        } as Connection;
      },
      async getConnectionById() {
        return persistedConnection;
      },
      async updateConnection(
        userId: string,
        connectionId: string,
        payload: ConnectionUpdateCapture['payload']
      ) {
        connectionUpdates.push({ userId, connectionId, payload });
      },
      async replaceConnection(
        userId: string,
        connectionId: string,
        payload: Partial<Connection>
      ) {
        replacedPayloads.push({ userId, connectionId, payload });
        persistedConnection = {
          ...persistedConnection,
          ...payload,
          updatedAt: new Date('2026-04-04T09:05:00.000Z'),
        };
      },
    }),
  });

  Object.defineProperty(service, 'brokerAccountRepository', {
    get: () => ({
      async getBrokerAccountCountsByConnectionIds() {
        return new Map([['conn-1', 2]]);
      },
      async getBrokerAccountCountByConnectionId() {
        return 2;
      },
      async getBrokerAccountStatusSummary() {
        throw new Error('summary should use connection route status');
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
      async updateBrokerAccount(
        userId: string,
        accountId: string,
        payload: BrokerAccountUpdateCapture['payload']
      ) {
        accountUpdates.push({ userId, accountId, payload });
      },
      async deleteBrokerAccountsByConnectionId() {
        return 0;
      },
    }),
  });

  Object.defineProperty(service, 'brokerAccountsService', {
    get: () => ({
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
    }),
  });

  Object.defineProperty(service, 'brokerDefinitionService', {
    get: () => ({
      async listActiveDefinitions() {
        return [definition, binanceDefinition];
      },
      async getRequiredDefinition(brokerKey: string) {
        if (String(brokerKey || '').trim().toLowerCase() === 'binance') {
          return binanceDefinition;
        }

        return definition;
      },
    }),
  });

  Object.defineProperty(service, 'exchangeRepository', {
    get: () => ({
      async getExchangeByKey() {
        return { id: 'exchange-1' };
      },
    }),
  });

  Object.defineProperty(service, 'brokerDiagnosticsService', {
    get: () => ({
      async testConnection() {
        return { detail: 'Signed wallet reachable' };
      },
      async getStatusConfig() {
        return definition.diagnostics;
      },
    }),
  });

  Object.defineProperty(service, 'operationalEventService', {
    get: () => ({
      async logActivity() {
        return;
      },
      async emitFailureAlert() {
        return;
      },
    }),
  });

  Object.defineProperty(service, 'activityService', {
    get: () => ({
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
    }),
  });

  Object.defineProperty(service, 'exchangeAssetRepository', {
    get: () => ({
      async countVisibleAssetsForUser(userId: string, source?: string) {
        productMapRequests.push({ userId, source });
        return 7;
      },
    }),
  });

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
      (item: { id: string; status: string }) =>
        item.id === 'exchange-link'
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
  assert.equal(Object.prototype.hasOwnProperty.call(replacedPayloads[0].payload, 'exchangeId'), false);
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

async function runExchangeAssetsProviderCompatibilityAssertions(): Promise<void> {
  const service = new ExchangeAssetsService() as any;
  const replaceCaptures: Array<{
    source: string;
    assets: Array<Record<string, unknown>>;
    attempted: number;
  }> = [];
  const syncRequests: Array<{
    source: string;
    assets: Array<{ id: string; symbol: string }>;
  }> = [];
  const mudrexFetchRequests: Array<{ pageSize: number; userId?: string }> = [];

  Object.defineProperty(service, 'brokerDefinitionService', {
    get: () => ({
      async getRequiredDefinition(source: string) {
        const normalizedSource = String(source || '').trim().toLowerCase();

        if (normalizedSource === 'delta_exchange') {
          return {
            id: 'broker-delta',
            brokerId: 'broker-delta',
            brokerKey: 'delta_exchange',
            providerType: 'broker',
          };
        }

        if (normalizedSource === 'mudrex') {
          return {
            id: 'broker-mudrex',
            brokerId: 'broker-mudrex',
            brokerKey: 'mudrex',
            providerType: 'broker',
          };
        }

        if (normalizedSource === 'binance') {
          return {
            id: 'exchange-binance',
            brokerKey: 'binance',
            providerType: 'feed',
            linkedExchangeKey: 'binance',
          };
        }

        throw new Error(`Unexpected source: ${source}`);
      },
    }),
  });

  Object.defineProperty(service, 'exchangeRepository', {
    get: () => ({
      async getExchangeByKey(exchangeKey: string) {
        const normalizedKey = String(exchangeKey || '').trim().toLowerCase();

        if (normalizedKey === 'delta_exchange') {
          return { id: 'exchange-delta', exchangeKey: 'delta_exchange' };
        }

        if (normalizedKey === 'binance') {
          return { id: 'exchange-binance', exchangeKey: 'binance' };
        }

        return null;
      },
    }),
  });

  Object.defineProperty(service, 'assetRepository', {
    get: () => ({
      async listAllSymbols() {
        return [
          { id: 'asset-btc', symbol: 'BTCUSDT' },
          { id: 'asset-eth', symbol: 'ETHUSDT' },
        ];
      },
    }),
  });

  Object.defineProperty(service, 'mudrexService', {
    get: () => ({
      async fetchAllRemoteFuturesForUserOrThrow(pageSize: number, userId?: string) {
        mudrexFetchRequests.push({ pageSize, userId });
        return [
          {
            id: 'mudrex-btc',
            symbol: 'BTCUSDT',
            name: 'Bitcoin',
          },
          {
            id: 'mudrex-eth',
            symbol: 'ETHUSDT',
            name: 'Ethereum',
          },
        ];
      },
    }),
  });

  Object.defineProperty(service, 'brokerExchangeAssetSyncService', {
    get: () => ({
      async sync(source: string, assets: Array<{ id: string; symbol: string }>) {
        syncRequests.push({ source, assets });
        return assets.map((item) => ({
          externalId: `${source}:${item.symbol}`,
          assetId: item.id,
          name: item.symbol,
          symbol: item.symbol,
        }));
      },
    }),
  });

  Object.defineProperty(service, 'exchangeAssetRepository', {
    get: () => ({
      async replaceSystemAssets(
        source: string,
        assets: Array<Record<string, unknown>>,
        attempted: number
      ) {
        replaceCaptures.push({ source, assets, attempted });
        return {
          attempted,
          matched: assets.length,
          inserted: assets.length,
          updated: 0,
          skipped: attempted - assets.length,
          totalStored: assets.length,
        };
      },
    }),
  });

  Object.defineProperty(service, 'operationalEventService', {
    get: () => ({
      async logActivity() {
        return;
      },
      async emitFailureAlert() {
        return;
      },
    }),
  });

  assert.deepEqual(await service.resolveProviderIds('delta_exchange'), {
    brokerId: 'broker-delta',
  });
  assert.deepEqual(await service.resolveProviderIds('mudrex'), {
    brokerId: 'broker-mudrex',
  });
  assert.deepEqual(await service.resolveProviderIds('binance'), {
    brokerId: null,
  });

  const binanceSync = await service.syncExchangeAssets('user-1', 'binance');
  assert.equal(binanceSync.data.source, 'binance');
  assert.equal(binanceSync.data.matchedAssets, 2);
  assert.equal(syncRequests.length, 1);
  assert.equal(syncRequests[0].source, 'binance');
  assert.deepEqual(
    syncRequests[0].assets.map((item) => item.symbol),
    ['BTCUSDT', 'ETHUSDT']
  );
  assert.equal(replaceCaptures.length, 1);
  assert.equal(replaceCaptures[0].source, 'binance');
  assert.equal(replaceCaptures[0].attempted, 2);
  assert.equal(replaceCaptures[0].assets.length, 2);
  assert.equal(replaceCaptures[0].assets[0].brokerId, null);
  assert.equal(
    Object.prototype.hasOwnProperty.call(replaceCaptures[0].assets[0], 'exchangeId'),
    false
  );

  const mudrexSync = await service.syncExchangeAssets('user-1', 'mudrex');
  assert.equal(mudrexSync.data.source, 'mudrex');
  assert.equal(mudrexSync.data.matchedAssets, 2);
  assert.equal(mudrexSync.data.deltaMappedSymbols, 2);
  assert.equal(mudrexFetchRequests.length, 1);
  assert.deepEqual(mudrexFetchRequests[0], {
    pageSize: 200,
    userId: 'user-1',
  });
  assert.equal(syncRequests.length, 2);
  assert.equal(syncRequests[1].source, 'delta_exchange');
  assert.deepEqual(
    syncRequests[1].assets.map((item) => item.symbol),
    ['BTCUSDT', 'ETHUSDT']
  );
  assert.equal(replaceCaptures.length, 2);
  assert.equal(replaceCaptures[1].source, 'mudrex');
  assert.equal(replaceCaptures[1].attempted, 2);
  assert.equal(replaceCaptures[1].assets.length, 2);
  assert.equal(replaceCaptures[1].assets[0].brokerId, 'broker-mudrex');
}

async function runExchangeAssetsVisibilityAssertions(): Promise<void> {
  const service = new ExchangeAssetsService() as any;
  const listVisibleRequests: Array<{
    userId: string;
    query: Record<string, unknown>;
  }> = [];
  const visibleDeltaRequests: Array<{
    userId: string;
    source: string;
    symbols: string[];
  }> = [];

  Object.defineProperty(service, 'exchangeAssetRepository', {
    get: () => ({
      async listVisibleAssetsForUser(userId: string, query: Record<string, unknown>) {
        listVisibleRequests.push({ userId, query });
        return {
          data: [
            {
              id: 'asset-row-1',
              source: 'mudrex',
              brokerId: 'broker-mudrex',
              externalId: 'mudrex:BTCUSDT',
              assetId: 'asset-btc',
              name: 'Bitcoin',
              symbol: 'BTCUSDT',
              createdAt: new Date('2026-04-04T09:00:00.000Z'),
              updatedAt: new Date('2026-04-04T09:00:00.000Z'),
            },
          ],
          total: 1,
        };
      },
      async listVisibleAssetsBySourceAndSymbolsForUser(
        userId: string,
        source: string,
        symbols: string[]
      ) {
        visibleDeltaRequests.push({ userId, source, symbols });
        return [
          {
            id: 'asset-row-delta-1',
            source: 'delta_exchange',
            brokerId: 'broker-delta',
            externalId: 'delta:BTCUSDT',
            assetId: 'asset-btc',
            name: 'Bitcoin',
            symbol: 'BTCUSDT',
            createdAt: new Date('2026-04-04T09:00:00.000Z'),
            updatedAt: new Date('2026-04-04T09:00:00.000Z'),
          },
        ];
      },
    }),
  });

  const response = await service.getStoredExchangeAssets('user-1', {
    limit: '25',
    offset: '5',
    search: 'btc',
    source: 'mudrex',
  });

  assert.deepEqual(listVisibleRequests, [
    {
      userId: 'user-1',
      query: {
        limit: 25,
        offset: 5,
        search: 'btc',
        source: 'mudrex',
      },
    },
  ]);
  assert.deepEqual(visibleDeltaRequests, [
    {
      userId: 'user-1',
      source: 'delta_exchange',
      symbols: ['BTCUSDT'],
    },
  ]);
  assert.equal(response.data.total, 1);
  assert.equal(response.data.limit, 25);
  assert.equal(response.data.offset, 5);
  assert.equal(response.data.assets.length, 1);
  assert.equal(response.data.assets[0].symbol, 'BTCUSDT');
  assert.equal(response.data.assets[0].deltaExternalId, 'delta:BTCUSDT');
  assert.equal(response.data.assets[0].deltaSymbol, 'BTCUSDT');
  assert.equal(response.data.assets[0].isDeltaMapped, true);
}

async function runDeltaExchangeOrdersAdapterCatalogAssertions(): Promise<void> {
  const adapter = new DeltaExchangeOrdersAdapter() as any;
  const lookupCalls: string[] = [];
  let submittedPayload: Record<string, unknown> | null = null;

  Object.defineProperty(adapter, 'exchangeAssetRepository', {
    get: () => ({
      async getSystemAssetBySourceAndExternalId(source: string, externalId: string) {
        lookupCalls.push(`external:${source}:${externalId}`);
        return null;
      },
      async getSystemAssetBySourceAndAssetId(source: string, assetId: string) {
        lookupCalls.push(`asset:${source}:${assetId}`);
        return null;
      },
      async getSystemAssetBySourceAndSymbol(source: string, symbol: string) {
        lookupCalls.push(`symbol:${source}:${symbol}`);
        return {
          externalId: '45678',
          symbol,
        };
      },
    }),
  });

  Object.defineProperty(adapter, 'deltaHttpClient', {
    get: () => ({
      async signedPost(
        accountId: string,
        path: string,
        payload: Record<string, unknown>,
        userId?: string
      ) {
        submittedPayload = { accountId, path, payload, userId };
        return {
          id: 'delta-order-1',
          state: 'open',
        };
      },
    }),
  });

  const response = await adapter.createOrder(
    'BTCUSDT',
    {
      quantity: '2',
      reduce_only: false,
      order_type: 'limit',
      order_price: '101.5',
      leverage: '3',
      trigger_type: 'gtc',
    },
    {
      userId: 'user-1',
      accountId: 'acct-1',
    }
  );

  assert.deepEqual(lookupCalls, [
    'external:delta_exchange:BTCUSDT',
    'asset:delta_exchange:BTCUSDT',
    'symbol:delta_exchange:BTCUSDT',
  ]);
  assert.deepEqual(submittedPayload, {
    accountId: 'acct-1',
    path: '/v2/orders',
    payload: {
      product_id: 45678,
      size: 2,
      side: 'buy',
      order_type: 'limit_order',
      limit_price: 101.5,
      time_in_force: 'gtc',
    },
    userId: 'user-1',
  });
  assert.equal(response.order_id, 'delta-order-1');
  assert.equal(response.status, 'open');
}

async function runMudrexServiceExchangeAssetFallbackAssertions(): Promise<void> {
  const service = new MudrexService() as any;
  const authCalls: Array<{
    settings: Record<string, unknown>;
    path: string;
    query?: Record<string, string | number>;
    brokerKey: string;
  }> = [];
  let publicCalls = 0;
  let systemAccountLookups = 0;
  const activeAccountLookups: Array<{ userId: string; brokerKey?: string }> = [];

  Object.defineProperty(service, 'mudrexHttpClient', {
    get: () => ({
      async authenticatedGetWithSettings(
        settings: Record<string, unknown>,
        path: string,
        query?: Record<string, string | number>,
        brokerKey = 'mudrex'
      ) {
        authCalls.push({ settings, path, query, brokerKey });
        return [
          {
            id: 'mudrex-btc',
            symbol: 'BTCUSDT',
            name: 'Bitcoin',
          },
        ];
      },
      async get() {
        publicCalls += 1;
        return [];
      },
    }),
  });

  Object.defineProperty(service, 'brokerAccountRepository', {
    get: () => ({
      async getActiveBrokerAccounts(userId: string, brokerKey?: string) {
        activeAccountLookups.push({ userId, brokerKey });
        return [
          {
            settings: {
              apiSecret: 'user-secret',
              baseUrl: 'https://trade.mudrex.com',
            },
          },
        ];
      },
      async listSystemBrokerAccounts() {
        systemAccountLookups += 1;
        return [];
      },
    }),
  });

  const assets = await service.fetchAllRemoteFuturesForUserOrThrow(200, 'user-1');
  assert.equal(assets.length, 1);
  assert.equal(publicCalls, 0);
  assert.equal(systemAccountLookups, 0);
  assert.deepEqual(activeAccountLookups, [{ userId: 'user-1', brokerKey: 'mudrex' }]);
  assert.equal(authCalls.length, 1);
  assert.equal(authCalls[0].path, '/fapi/v1/futures');
  assert.equal(authCalls[0].brokerKey, 'mudrex');
  assert.deepEqual(authCalls[0].query, { offset: 0, limit: 200 });

  const failingService = new MudrexService() as any;

  Object.defineProperty(failingService, 'mudrexHttpClient', {
    get: () => ({
      async authenticatedGetWithSettings() {
        throw new MudrexApiError(401, 'Mudrex authentication failed');
      },
      async get() {
        throw new Error('Expected authenticated fallback before public Mudrex access');
      },
    }),
  });

  Object.defineProperty(failingService, 'brokerAccountRepository', {
    get: () => ({
      async getActiveBrokerAccounts() {
        return [
          {
            settings: {
              apiSecret: 'user-secret',
              baseUrl: 'https://trade.mudrex.com',
            },
          },
        ];
      },
      async listSystemBrokerAccounts() {
        return [];
      },
    }),
  });

  await assert.rejects(
    () => failingService.fetchAllRemoteFuturesForUserOrThrow(200, 'user-1'),
    (error: unknown) =>
      error instanceof Error &&
      error.message === 'Mudrex authentication failed' &&
      (error as { httpCode?: number }).httpCode === 401
  );
}

async function runBrokerMarketFacadeCompatibilityAssertions(): Promise<void> {
  const service = new BrokerMarketFacadeService() as any;
  let capturedResolveArgs:
    | {
        userId: string;
        requestedBrokerKey?: string;
        requestedAccountId?: string;
        fallbackBrokerKey?: string;
      }
    | null = null;
  const adapterRequests: string[] = [];

  Object.defineProperty(service, 'brokerAccountRoutingService', {
    get: () => ({
      async resolve(
        userId: string,
        requestedBrokerKey?: string,
        requestedAccountId?: string,
        fallbackBrokerKey?: string
      ) {
        capturedResolveArgs = {
          userId,
          requestedBrokerKey,
          requestedAccountId,
          fallbackBrokerKey,
        };

        return {
          userId,
          brokerKey: requestedBrokerKey || fallbackBrokerKey,
          accountId: requestedAccountId,
        };
      },
    }),
  });

  Object.defineProperty(service, 'brokerRuntimeRegistry', {
    get: () => ({
      getMarketAdapter(brokerKey?: string) {
        adapterRequests.push(String(brokerKey || ''));
        return {
          async getCandles(query: Record<string, unknown>, route: Record<string, unknown>) {
            return {
              query,
              route,
            };
          },
        };
      },
    }),
  });

  const response = (await service.getCandles('user-1', {
    symbol: 'BTCUSDT',
    interval: '1h',
    limit: '25',
  })) as {
    query: Record<string, unknown>;
    route: Record<string, unknown>;
  };

  assert.deepEqual(capturedResolveArgs, {
    userId: 'user-1',
    requestedBrokerKey: undefined,
    requestedAccountId: undefined,
    fallbackBrokerKey: 'binance',
  });
  assert.deepEqual(adapterRequests, ['binance']);
  assert.equal(response.route.brokerKey, 'binance');
  assert.equal(response.query.brokerKey, 'binance');
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
      {
        key: 'apiKey',
        label: 'API key',
        required: true,
      },
      {
        key: 'clientSecret',
        label: 'Client secret',
        secret: true,
        required: true,
      },
      {
        key: 'username',
        label: 'Username',
        required: true,
      },
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
        if (
          accountKey !== String(persistedAccount.accountKey) ||
          !persistedAccount.settings
        ) {
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
    _brokerKey: string,
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
  assert.ok(
    String(createdSettings.clientSecret || '').startsWith('enc:v1:')
  );
  assert.equal(createdSettings.username, 'auralpha');
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
  assert.equal(listResult.data.items[0].settings?.username, 'auralpha-updated');
  assert.equal(activities.length >= 3, true);
  assert.equal(alerts.length, 0);
}

async function runPhase4CatalogAssertions(): Promise<void> {
  const connectionsService = new ConnectionsService() as any;

  Object.defineProperty(connectionsService, 'brokerDefinitionService', {
    get: () => ({
      async listPersistedDefinitions() {
        return [
          {
            id: 'broker-mudrex',
            brokerKey: 'mudrex',
            name: 'Mudrex',
            category: 'broker',
            providerType: 'broker',
            linkedExchangeKey: undefined,
            baseUrl: 'https://trade.mudrex.com',
            capabilities: ['assets', 'leverage', 'market'],
            accountFields: [],
            integrationGuide: { summary: 'Mudrex provider' },
            diagnostics: { requiresAccount: true },
          },
          {
            id: 'broker-delta',
            brokerKey: 'delta_exchange',
            name: 'Delta Exchange',
            category: 'broker',
            providerType: 'broker',
            linkedExchangeKey: undefined,
            baseUrl: 'https://api.india.delta.exchange',
            capabilities: ['assets', 'market', 'orders'],
            accountFields: [],
            integrationGuide: { summary: 'Delta provider' },
            diagnostics: { requiresAccount: true },
          },
        ];
      },
    }),
  });

  Object.defineProperty(connectionsService, 'exchangeRepository', {
    get: () => ({
      async listActiveExchanges() {
        return [
          {
            id: 'exchange-binance',
            exchangeKey: 'binance',
            name: 'Binance',
            baseUrl: 'https://fapi.binance.com',
          },
          {
            id: 'exchange-unused',
            exchangeKey: 'kraken',
            name: 'Kraken',
            baseUrl: 'https://api.kraken.com',
          },
        ];
      },
    }),
  });

  const brokerCatalog = await connectionsService.getBrokerCatalog('user-1');
  assert.deepEqual(
    brokerCatalog.data.providerItems.map((item: { brokerKey: string }) => item.brokerKey).sort(),
    ['delta_exchange', 'mudrex']
  );
  assert.deepEqual(
    brokerCatalog.data.exchangeItems.map((item: { brokerKey: string }) => item.brokerKey),
    ['binance']
  );
  assert.equal(brokerCatalog.data.exchangeItems[0]?.entityType, 'exchange');
  assert.equal(brokerCatalog.data.exchangeItems[0]?.exchangeKey, 'binance');
  assert.equal(brokerCatalog.data.providersTotal, 2);
  assert.equal(brokerCatalog.data.exchangesTotal, 1);
  assert.equal(brokerCatalog.data.total, 3);

  const referenceDataService = new BrokerReferenceDataService() as any;

  Object.defineProperty(referenceDataService, 'brokerDefinitionService', {
    get: () => ({
      async listPersistedDefinitions() {
        return [
          {
            id: 'broker-mudrex',
            brokerKey: 'mudrex',
            name: 'Mudrex',
            category: 'broker',
            providerType: 'broker',
            capabilities: ['assets', 'leverage', 'market'],
          },
          {
            id: 'broker-delta',
            brokerKey: 'delta_exchange',
            name: 'Delta Exchange',
            category: 'broker',
            providerType: 'broker',
            capabilities: ['assets', 'market', 'orders'],
          },
        ];
      },
    }),
  });

  Object.defineProperty(referenceDataService, 'exchangeRepository', {
    get: () => ({
      async listActiveExchanges() {
        return [
          {
            id: 'exchange-binance',
            exchangeKey: 'binance',
            name: 'Binance',
          },
          {
            id: 'exchange-unused',
            exchangeKey: 'kraken',
            name: 'Kraken',
          },
        ];
      },
    }),
  });

  const referenceCatalog = await referenceDataService.getReferenceCatalog('user-1');
  assert.deepEqual(
    referenceCatalog.data.providerItems.map((item: { brokerKey: string }) => item.brokerKey).sort(),
    ['delta_exchange', 'mudrex']
  );
  assert.deepEqual(
    referenceCatalog.data.exchangeItems.map((item: { brokerKey: string }) => item.brokerKey),
    ['binance']
  );
  assert.equal(referenceCatalog.data.exchangeItems[0]?.entityType, 'exchange');
  assert.equal(referenceCatalog.data.providersTotal, 2);
  assert.equal(referenceCatalog.data.exchangesTotal, 1);
  assert.equal(referenceCatalog.data.total, 3);
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
    accountConfig: {
      fields: [],
    },
    integrationGuide: {
      summary: 'Delta route',
    },
    diagnosticsConfig: {
      executorKey: 'delta-exchange',
    },
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
    accountConfig: {
      fields: [],
    },
    integrationGuide: {
      summary: 'Mudrex route',
    },
    diagnosticsConfig: {
      executorKey: 'mudrex-public',
    },
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
    accountConfig: {
      fields: [],
    },
    integrationGuide: {
      summary: 'Persisted shadow definition that runtime should ignore',
    },
    diagnosticsConfig: {
      executorKey: 'binance-market',
    },
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
        const normalizedKey = String(exchangeKey || '').trim().toLowerCase();
        if (normalizedKey !== 'binance') {
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
  assert.equal(runtimeDeltaDefinition.linkedExchangeKey, undefined);
  assert.equal(runtimeDeltaDefinition.brokerId, 'broker-delta');

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

  const persistedDefinitions = await service.listPersistedDefinitions({ includeInactive: true });
  assert.deepEqual(
    persistedDefinitions.map((definition: { brokerKey: string }) => definition.brokerKey).sort(),
    ['delta_exchange', 'mudrex']
  );

  const runtimeBinanceDefinition = await service.getRequiredDefinition('binance');
  assert.equal(runtimeBinanceDefinition.id, 'exchange-binance');
  assert.equal(runtimeBinanceDefinition.brokerId, undefined);
  assert.equal(runtimeBinanceDefinition.providerType, 'feed');
  assert.equal(runtimeBinanceDefinition.linkedExchangeKey, 'binance');
  assert.equal(runtimeBinanceDefinition.name, 'Binance market data');

  await assert.rejects(
    () => service.getRequiredDefinition('binance_market_data'),
    /definition not found/
  );
  await assert.rejects(
    () => service.getPersistedDefinition('binance', { includeInactive: true }),
    /definition not found/
  );
}

async function runBrokerDefinitionRuntimeSupportAssertions(): Promise<void> {
  const runtimeSupportService = new BrokerDefinitionRuntimeSupportService() as any;

  Object.defineProperty(runtimeSupportService, 'exchangeRepository', {
    get: () => ({
      async getExchangeByKey(exchangeKey: string) {
        const normalizedKey = String(exchangeKey || '').trim().toLowerCase();
        if (normalizedKey === 'binance') {
          return {
            id: 'exchange-binance',
            exchangeKey: 'binance',
          };
        }

        if (normalizedKey === 'delta_exchange') {
          return {
            id: 'exchange-delta',
            exchangeKey: 'delta_exchange',
          };
        }

        return null;
      },
    }),
  });

  Object.defineProperty(runtimeSupportService, 'brokerRegistry', {
    get: () => ({
      getOptional(brokerKey: string) {
        const modules = new Map([
          [
            'mudrex',
            { brokerKey: 'mudrex', category: 'broker', providerType: 'broker' },
          ],
          [
            'delta_exchange',
            {
              brokerKey: 'delta_exchange',
              category: 'broker',
              providerType: 'broker',
            },
          ],
          [
            'binance',
            {
              brokerKey: 'binance',
              category: 'feed',
              providerType: 'feed',
            },
          ],
          [
            'custom_feed',
            {
              brokerKey: 'custom_feed',
              category: 'feed',
              providerType: 'feed',
            },
          ],
        ]);
        return modules.get(String(brokerKey || '').trim().toLowerCase()) ?? null;
      },
    }),
  });

  Object.defineProperty(runtimeSupportService, 'brokerRuntimeRegistry', {
    get: () => ({
      supportsMarketAdapter(brokerKey: string) {
        return ['mudrex', 'delta_exchange', 'binance', 'custom_feed'].includes(
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
        return ['registered-route', 'mudrex-public', 'delta-exchange', 'binance-market'].includes(
          String(executorKey || '').trim()
        );
      },
    }),
  });

  Object.defineProperty(runtimeSupportService, 'brokerExchangeAssetSyncService', {
    get: () => ({
      supportsSource(source: string) {
        return ['mudrex', 'delta_exchange'].includes(
          String(source || '').trim().toLowerCase()
        );
      },
    }),
  });

  await runtimeSupportService.validateDefinition({
    brokerKey: 'binance',
    category: 'feed',
    providerType: 'feed',
    linkedExchangeKey: 'binance',
    capabilities: ['market', 'diagnostics'],
    diagnostics: {
      executorKey: 'binance-market',
    },
  });

  await runtimeSupportService.validateDefinition({
    brokerKey: 'mudrex',
    category: 'broker',
    providerType: 'broker',
    capabilities: ['assets', 'orders', 'positions', 'wallet', 'diagnostics', 'leverage', 'market'],
    diagnostics: {
      executorKey: 'mudrex-public',
    },
  });

  await runtimeSupportService.validateDefinition({
    brokerKey: 'delta_exchange',
    category: 'broker',
    providerType: 'broker',
    linkedExchangeKey: 'delta_exchange',
    capabilities: ['assets', 'orders', 'positions', 'wallet', 'diagnostics', 'market'],
    diagnostics: {
      executorKey: 'delta-exchange',
    },
  });

  await runtimeSupportService.validateDefinition({
    brokerKey: 'custom_feed',
    category: 'feed',
    providerType: 'feed',
    linkedExchangeKey: 'binance',
    capabilities: ['market'],
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

  await assert.rejects(
    () =>
      runtimeSupportService.validateDefinition({
        brokerKey: 'binance',
        category: 'feed',
        providerType: 'feed',
        linkedExchangeKey: 'binance',
        capabilities: ['orders'],
      }),
    /Capabilities not supported by runtime/
  );

  await assert.rejects(
    () =>
      runtimeSupportService.validateDefinition({
        brokerKey: 'delta_exchange',
        category: 'broker',
        providerType: 'exchange',
        linkedExchangeKey: 'delta_exchange',
        capabilities: ['market'],
      }),
    /providerType must match registered runtime providerType/
  );

  await assert.rejects(
    () =>
      runtimeSupportService.validateDefinition({
        brokerKey: 'mudrex',
        category: 'broker',
        providerType: 'broker',
        capabilities: ['diagnostics'],
        diagnostics: {
          executorKey: 'unknown-executor',
        },
      }),
    /Diagnostics executor not registered/
  );

  await assert.rejects(
    () =>
      runtimeSupportService.validateDefinition({
        brokerKey: 'binance',
        category: 'feed',
        providerType: 'feed',
        linkedExchangeKey: 'missing_exchange',
        capabilities: ['market'],
      }),
    /Exchange master record not found/
  );

  await assert.rejects(
    () =>
      runtimeSupportService.validateDefinition({
        brokerKey: 'binance_market_data',
        category: 'feed',
        providerType: 'feed',
        linkedExchangeKey: 'binance',
        capabilities: ['market'],
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

  assert.deepEqual(validatedSelectBody.accountFields[0].options, [
    { value: 'demo', label: 'Demo' },
    { value: 'live', label: 'Live' },
  ]);
  assert.equal(validatedSelectBody.accountFields[0].type, 'select');
  assert.equal(validatedSelectBody.accountFields[0].secret, false);
  assert.equal(validatedSelectBody.expectedUpdatedAt, undefined);

  const validatedGuideBody = validateBrokerDefinitionUpsertBody({
    brokerKey: 'custom_broker',
    name: 'Custom Broker',
    category: 'broker',
    status: 'active',
    providerType: 'broker',
    capabilities: ['market'],
    accountFields: [],
    integrationGuide: {
      docsUrl: 'https://docs.auralpha.test/brokers/custom',
    },
    expectedUpdatedAt: '2026-04-04T00:05:00.000Z',
  });
  assert.equal(validatedGuideBody.integrationGuide?.docsUrl, 'https://docs.auralpha.test/brokers/custom');
  assert.equal(validatedGuideBody.expectedUpdatedAt, '2026-04-04T00:05:00.000Z');

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

  assert.throws(
    () =>
      validateBrokerDefinitionUpsertBody({
        brokerKey: 'custom_broker',
        name: 'Custom Broker',
        category: 'broker',
        status: 'active',
        providerType: 'broker',
        capabilities: [],
        accountFields: [],
      }),
    /capabilities must include at least one capability/
  );

  assert.throws(
    () =>
      validateBrokerDefinitionUpsertBody({
        brokerKey: 'custom_broker',
        name: 'Custom Broker',
        category: 'broker',
        status: 'active',
        providerType: 'broker',
        capabilities: ['market'],
        accountFields: [
          {
            key: 'api-key',
            label: 'API key',
            type: 'text',
          },
        ],
      }),
    /accountFields\[0\]\.key must use letters, numbers, or underscores/
  );

  assert.throws(
    () =>
      validateBrokerDefinitionUpsertBody({
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
          },
        ],
      }),
    /must include at least one option when type is select/
  );

  assert.throws(
    () =>
      validateBrokerDefinitionUpsertBody({
        brokerKey: 'custom_broker',
        name: 'Custom Broker',
        category: 'broker',
        status: 'active',
        providerType: 'broker',
        capabilities: ['market'],
        accountFields: [
          {
            key: 'region',
            label: 'Region',
            type: 'text',
            options: [{ value: 'apac', label: 'APAC' }],
          },
        ],
      }),
    /options are only supported when type is select/
  );

  assert.throws(
    () =>
      validateBrokerDefinitionUpsertBody({
        brokerKey: 'custom_broker',
        name: 'Custom Broker',
        category: 'broker',
        status: 'active',
        providerType: 'broker',
        capabilities: ['market'],
        accountFields: [],
        integrationGuide: {
          docsUrl: 'ftp://docs.auralpha.test/brokers/custom',
        },
      }),
    /integrationGuide\.docsUrl must use http or https/
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
  const definitionAlerts: Array<Record<string, unknown>> = [];

  Object.defineProperty(brokerDefinitionsService, 'brokerDefinitionRuntimeSupportService', {
    get: () => runtimeSupportService,
  });
  Object.defineProperty(brokerDefinitionsService, 'brokerRepository', {
    get: () => ({
      async getBrokerByKey() {
        return null;
      },
      async getBrokerByName(name: string) {
        if (String(name || '').trim().toLowerCase() === 'duplicate broker') {
          return {
            id: 'broker-duplicate',
            brokerKey: 'duplicate_broker',
            name: 'Duplicate Broker',
          };
        }
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
      async emitFailureAlert(userId: string, payload: Record<string, unknown>) {
        definitionAlerts.push({ userId, ...payload });
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
  assert.equal(savedDefinitions.length, 0);

  const duplicateNameRaceService = new BrokerDefinitionsService() as any;

  Object.defineProperty(duplicateNameRaceService, 'brokerDefinitionRuntimeSupportService', {
    get: () => runtimeSupportService,
  });
  Object.defineProperty(duplicateNameRaceService, 'brokerRepository', {
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
      isDuplicateBrokerNameError(error: unknown) {
        return String((error as { message?: string })?.message || '').includes('uidx_brokers_name');
      },
      async saveBrokerDefinition() {
        const error = new Error("Duplicate entry for key 'uidx_brokers_name'") as Error & { code?: string };
        error.code = 'ER_DUP_ENTRY';
        throw error;
      },
    }),
  });
  Object.defineProperty(duplicateNameRaceService, 'brokerDefinitionService', {
    get: () => ({
      isSystemManagedBrokerKey() {
        return false;
      },
      async getPersistedDefinition() {
        throw new Error('should not reload after duplicate name conflict');
      },
    }),
  });
  Object.defineProperty(duplicateNameRaceService, 'operationalEventService', {
    get: () => ({
      async logActivity() {
        return;
      },
      async emitFailureAlert() {
        throw new Error('duplicate name client conflicts should not alert');
      },
    }),
  });

  await assert.rejects(
    duplicateNameRaceService.upsertDefinition(
      { userId: 'admin-1', role: 'admin' },
      {
        brokerKey: 'mudrex',
        name: 'Duplicate Race Broker',
        category: 'broker',
        status: 'active',
        providerType: 'broker',
        capabilities: ['market'],
        accountFields: [],
      }
    ),
    /name already exists: Duplicate Race Broker/
  );

  await assert.rejects(
    brokerDefinitionsService.upsertDefinition(
      { userId: 'admin-1', role: 'admin' },
      {
        brokerKey: 'mudrex',
        name: 'Duplicate Broker',
        category: 'broker',
        status: 'active',
        providerType: 'broker',
        capabilities: ['market'],
        accountFields: [],
      }
    ),
    /name already exists/
  );
  assert.equal(savedDefinitions.length, 0);

  await assert.rejects(
    brokerDefinitionsService.upsertDefinition(
      { userId: 'admin-1', role: 'admin' },
      {
        brokerKey: 'binance_market_data',
        name: 'Binance market data',
        category: 'feed',
        status: 'active',
        providerType: 'feed',
        linkedExchangeKey: 'missing_exchange',
        capabilities: ['market'],
        accountFields: [],
      }
    ),
    /Exchange-managed feed definitions cannot be edited/
  );
  assert.equal(savedDefinitions.length, 0);

  await assert.rejects(
    brokerDefinitionsService.upsertDefinition(
      { userId: 'admin-1', role: 'admin' },
      {
        brokerKey: 'binance',
        name: 'Binance market data',
        category: 'feed',
        status: 'active',
        providerType: 'feed',
        linkedExchangeKey: 'binance',
        capabilities: ['market', 'diagnostics'],
        accountFields: [],
        diagnostics: {
          executorKey: 'binance-market',
        },
      }
    ),
    /Exchange-managed feed definitions cannot be edited/
  );
  assert.equal(savedDefinitions.length, 0);
  assert.equal(definitionAlerts.length, 0);

  const successLogFailureService = new BrokerDefinitionsService() as any;
  const successLogFailureAlerts: Array<Record<string, unknown>> = [];
  const successLogFailureActivities: Array<Record<string, unknown>> = [];

  Object.defineProperty(successLogFailureService, 'brokerDefinitionRuntimeSupportService', {
    get: () => runtimeSupportService,
  });
  Object.defineProperty(successLogFailureService, 'brokerRepository', {
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
        return {
          id: 'broker-success-log',
          ...payload,
          updatedAt: new Date('2026-04-04T00:10:00.000Z'),
        };
      },
    }),
  });
  Object.defineProperty(successLogFailureService, 'brokerDefinitionService', {
    get: () => ({
      isSystemManagedBrokerKey() {
        return false;
      },
      async getPersistedDefinition() {
        return {
          id: 'broker-success-log',
          brokerKey: 'mudrex',
          name: 'Mudrex',
          category: 'broker',
          status: 'active',
          providerType: 'broker',
          linkedExchangeKey: undefined,
          baseUrl: undefined,
          capabilities: ['market'],
          accountFields: [],
          integrationGuide: undefined,
          diagnostics: undefined,
          updatedAt: '2026-04-04T00:10:00.000Z',
          versionToken: '2026-04-04T00:10:00.000Z',
        };
      },
    }),
  });
  Object.defineProperty(successLogFailureService, 'operationalEventService', {
    get: () => ({
      async logActivity(userId: string, payload: Record<string, unknown>) {
        successLogFailureActivities.push({ userId, ...payload });
        throw new Error('activity log unavailable');
      },
      async emitFailureAlert(userId: string, payload: Record<string, unknown>) {
        successLogFailureAlerts.push({ userId, ...payload });
      },
    }),
  });

  const successLogFailureResponse = await successLogFailureService.upsertDefinition(
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
  assert.equal(successLogFailureResponse.data.brokerKey, 'mudrex');
  assert.equal(successLogFailureActivities.length, 1);
  assert.equal(successLogFailureActivities[0].title, 'Broker definition updated: mudrex');
  assert.equal(successLogFailureAlerts.length, 0);

  const noopBrokerDefinitionsService = new BrokerDefinitionsService() as any;
  const noopActivities: Array<Record<string, unknown>> = [];
  let noopSaveCalls = 0;

  Object.defineProperty(noopBrokerDefinitionsService, 'brokerDefinitionRuntimeSupportService', {
    get: () => runtimeSupportService,
  });
  Object.defineProperty(noopBrokerDefinitionsService, 'brokerRepository', {
    get: () => ({
      async getBrokerByKey() {
        return {
          id: 'broker-existing',
          brokerKey: 'mudrex',
          name: 'Mudrex',
          category: 'broker',
          status: 'active',
          providerType: 'broker',
          linkedExchangeKey: null,
          baseUrl: null,
          capabilities: ['market'],
          accountConfig: {
            fields: [],
          },
          integrationGuide: null,
          diagnosticsConfig: null,
          updatedAt: new Date('2026-04-04T00:05:00.000Z'),
        };
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
      async saveBrokerDefinition() {
        noopSaveCalls += 1;
        throw new Error('save should not be called for unchanged definitions');
      },
    }),
  });
  Object.defineProperty(noopBrokerDefinitionsService, 'brokerDefinitionService', {
    get: () => ({
      isSystemManagedBrokerKey() {
        return false;
      },
      async getPersistedDefinition() {
        return {
          id: 'broker-existing',
          brokerKey: 'mudrex',
          name: 'Mudrex',
          category: 'broker',
          status: 'active',
          providerType: 'broker',
          linkedExchangeKey: undefined,
          baseUrl: undefined,
          capabilities: ['market'],
          accountFields: [],
          integrationGuide: undefined,
          diagnostics: undefined,
          updatedAt: '2026-04-04T00:05:00.000Z',
          versionToken: '2026-04-04T00:05:00.000Z',
        };
      },
    }),
  });
  Object.defineProperty(noopBrokerDefinitionsService, 'operationalEventService', {
    get: () => ({
      async logActivity(userId: string, payload: Record<string, unknown>) {
        noopActivities.push({ userId, ...payload });
      },
      async emitFailureAlert() {
        throw new Error('noop updates should not alert');
      },
    }),
  });

  const noopResponse = await noopBrokerDefinitionsService.upsertDefinition(
    { userId: 'admin-1', role: 'admin' },
    {
      brokerKey: 'mudrex',
      name: 'Mudrex',
      category: 'broker',
      status: 'active',
      providerType: 'broker',
      capabilities: ['market'],
      accountFields: [],
      expectedUpdatedAt: '2026-04-04T00:05:00.000Z',
    }
  );
  assert.equal(noopSaveCalls, 0);
  assert.equal(noopActivities.length, 0);
  assert.equal(noopResponse.data.versionToken, '2026-04-04T00:05:00.000Z');

  const conflictBrokerDefinitionsService = new BrokerDefinitionsService() as any;
  const conflictAlerts: Array<Record<string, unknown>> = [];

  Object.defineProperty(conflictBrokerDefinitionsService, 'brokerDefinitionRuntimeSupportService', {
    get: () => runtimeSupportService,
  });
  Object.defineProperty(conflictBrokerDefinitionsService, 'brokerRepository', {
    get: () => ({
      async getBrokerByKey() {
        return {
          id: 'broker-existing',
          brokerKey: 'mudrex',
          updatedAt: new Date('2026-04-04T00:10:00.000Z'),
        };
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
      async saveBrokerDefinition() {
        throw new Error('stale writes should not reach persistence');
      },
    }),
  });
  Object.defineProperty(conflictBrokerDefinitionsService, 'brokerDefinitionService', {
    get: () => ({
      isSystemManagedBrokerKey() {
        return false;
      },
      async getPersistedDefinition() {
        return {
          id: 'broker-existing',
          brokerKey: 'mudrex',
          name: 'Mudrex',
          category: 'broker',
          status: 'active',
          providerType: 'broker',
          capabilities: ['market'],
          accountFields: [],
        };
      },
    }),
  });
  Object.defineProperty(conflictBrokerDefinitionsService, 'operationalEventService', {
    get: () => ({
      async logActivity() {
        return;
      },
      async emitFailureAlert(userId: string, payload: Record<string, unknown>) {
        conflictAlerts.push({ userId, ...payload });
      },
    }),
  });

  await assert.rejects(
    conflictBrokerDefinitionsService.upsertDefinition(
      { userId: 'admin-1', role: 'admin' },
      {
        brokerKey: 'mudrex',
        name: 'Mudrex',
        category: 'broker',
        status: 'active',
        providerType: 'broker',
        capabilities: ['market'],
        accountFields: [],
        expectedUpdatedAt: '2026-04-04T00:05:00.000Z',
      }
    ),
    /updated elsewhere/
  );
  assert.equal(conflictAlerts.length, 0);

  const fallbackBrokerDefinitionsService = new BrokerDefinitionsService() as any;
  const fallbackActivities: Array<Record<string, unknown>> = [];
  const fallbackAlerts: Array<Record<string, unknown>> = [];

  Object.defineProperty(fallbackBrokerDefinitionsService, 'brokerDefinitionRuntimeSupportService', {
    get: () => runtimeSupportService,
  });
  Object.defineProperty(fallbackBrokerDefinitionsService, 'brokerRepository', {
    get: () => ({
      async getBrokerByKey() {
        return {
          id: 'broker-existing',
          baseUrl: 'https://api.persisted-broker.test',
          updatedAt: new Date('2026-04-04T00:05:00.000Z'),
        };
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
        return {
          id: 'broker-2',
          ...payload,
          updatedAt: new Date('2026-04-04T00:05:00.000Z'),
        };
      },
    }),
  });
  Object.defineProperty(fallbackBrokerDefinitionsService, 'brokerDefinitionService', {
    get: () => {
      let calls = 0;
      return {
        isSystemManagedBrokerKey() {
          return false;
        },
        async getPersistedDefinition() {
          calls += 1;
          if (calls === 1) {
            return {
              id: 'broker-existing',
              brokerKey: 'mudrex',
              name: 'Mudrex Legacy',
              category: 'broker',
              status: 'active',
              providerType: 'broker',
              linkedExchangeKey: undefined,
              baseUrl: 'https://api.persisted-broker.test',
              capabilities: ['market'],
              accountFields: [
                {
                  key: 'environment',
                  label: 'Environment',
                  type: 'select',
                  required: true,
                  secret: false,
                  options: [
                    { value: 'demo', label: 'Demo' },
                    { value: 'live', label: 'Live' },
                  ],
                },
              ],
              integrationGuide: undefined,
              diagnostics: undefined,
              updatedAt: '2026-04-04T00:05:00.000Z',
              versionToken: '2026-04-04T00:05:00.000Z',
            };
          }
          throw new Error('reload failed');
        },
      };
    },
  });
  Object.defineProperty(fallbackBrokerDefinitionsService, 'operationalEventService', {
    get: () => ({
      async logActivity(userId: string, payload: Record<string, unknown>) {
        fallbackActivities.push({ userId, ...payload });
      },
      async emitFailureAlert(userId: string, payload: Record<string, unknown>) {
        fallbackAlerts.push({ userId, ...payload });
      },
    }),
  });

  const fallbackDefinitionResponse = await fallbackBrokerDefinitionsService.upsertDefinition(
    { userId: 'admin-1', role: 'admin' },
    {
      brokerKey: 'mudrex',
      name: 'Mudrex',
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
    }
  );

  assert.equal(fallbackDefinitionResponse.data.id, 'broker-existing');
  assert.equal(fallbackDefinitionResponse.data.brokerKey, 'mudrex');
  assert.equal(fallbackDefinitionResponse.data.baseUrl, 'https://api.persisted-broker.test');
  assert.deepEqual(fallbackDefinitionResponse.data.accountFields, [
    {
      key: 'environment',
      label: 'Environment',
      type: 'select',
      required: true,
      secret: false,
      options: [
        { value: 'demo', label: 'Demo' },
        { value: 'live', label: 'Live' },
      ],
    },
  ]);
  assert.equal(fallbackActivities.length, 1);
  assert.equal(fallbackAlerts.length, 0);

  const brokerAccountsService = new BrokerAccountsService() as any;

  Object.defineProperty(brokerAccountsService, 'connectionRepository', {
    get: () => ({
      async getConnectionById() {
        return {
          id: 'conn-unsupported',
          brokerKey: 'binance',
          brokerId: 'broker-route-unsupported',
        };
      },
    }),
  });
  Object.defineProperty(brokerAccountsService, 'brokerAccountRepository', {
    get: () => ({
      async getBrokerAccountByKey() {
        return null;
      },
    }),
  });
  Object.defineProperty(brokerAccountsService, 'brokerDefinitionService', {
    get: () => ({
      async getRequiredDefinition() {
        return {
          brokerKey: 'binance',
          baseUrl: undefined,
          accountFields: [],
        };
      },
      validateAccountSettingsForDefinition(
        _definition: Record<string, unknown>,
        settings?: Record<string, unknown>
      ) {
        return settings;
      },
    }),
  });
  Object.defineProperty(brokerAccountsService, 'operationalEventService', {
    get: () => ({
      async logActivity() {
        return;
      },
      async emitFailureAlert() {
        return;
      },
    }),
  });
  Object.defineProperty(brokerAccountsService, 'brokerDiagnosticsService', {
    get: () => ({
      async testConnection() {
        return {
          detail: 'Binance futures candles reachable',
        };
      },
    }),
  });

  const unsupportedTestResult = await brokerAccountsService.testBrokerAccountConfiguration(
    'user-1',
    {
      connectionId: 'conn-unsupported',
      brokerKey: 'binance',
      accountKey: 'feed_config',
      accountName: 'Feed config',
      settings: {},
      isDefault: false,
    }
  );
  assert.equal(unsupportedTestResult.data.passed, true);
  assert.equal(unsupportedTestResult.data.detail, 'Binance futures candles reachable');
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

function runSettingsValidationAssertions(): void {
  const defaultPromotionRules = createDefaultBacktestPromotionRules();
  const defaultSettings = {
    timezone: 'UTC',
    notifyEmail: true,
    notifyInApp: true,
    confirmDestructive: true,
    notificationChannel: 'both' as const,
    notificationSeverity: 'all' as const,
    escalationRoute: 'risk-review' as const,
    escalationSlaMinutes: 15,
    backtestPromotionRules: defaultPromotionRules,
  };

  assert.deepEqual(validateSettingsAuditQuery(), { limit: 20, offset: 0 });
  assert.deepEqual(validateSettingsAuditQuery({ limit: '5', offset: '2' }), {
    limit: 5,
    offset: 2,
  });
  assert.throws(
    () => validateSettingsAuditQuery({ limit: '0' }),
    /limit must be an integer between 1 and 100/
  );
  assert.throws(
    () => validateSettingsAuditQuery({ limit: '101' }),
    /limit must be an integer between 1 and 100/
  );
  assert.throws(
    () => validateSettingsAuditQuery({ offset: '-1' }),
    /offset must be an integer greater than or equal to 0/
  );

  assert.throws(
    () =>
      validateUpdateSettingsBody(
        {
          timezone: 'UTC',
          unknownField: true,
        } as any,
        defaultSettings
      ),
    /Unknown settings fields: unknownField/
  );

  assert.deepEqual(
    validateUpdateSettingsBody(
      {
        backtestPromotionRules: {
          minScore: 0.82,
          minTrades: 9,
          requireRobustness: false,
        },
      },
      defaultSettings
    ).backtestPromotionRules,
    {
      ...defaultPromotionRules,
      minScore: 0.82,
      minTrades: 9,
      requireRobustness: false,
    }
  );

  assert.throws(
    () =>
      validateUpdateSettingsBody(
        {
          backtestPromotionRules: {
            minScore: 1.2,
          },
        },
        defaultSettings
      ),
    /backtestPromotionRules.minScore must be a number between 0 and 1/
  );
}

function runWatchlistsValidationAssertions(): void {
  assert.deepEqual(validateCreateWatchlistPayload({ name: 'Priority majors' }), {
    name: 'Priority majors',
    type: 'Manual',
    description: null,
  });

  assert.deepEqual(
    validateCreateWatchlistPayload({
      name: 'Momentum desk',
      type: 'Manual',
      description: '  Team-owned manual routing list  ',
    }),
    {
      name: 'Momentum desk',
      type: 'Manual',
      description: 'Team-owned manual routing list',
    }
  );

  assert.throws(
    () =>
      validateCreateWatchlistPayload({
        name: 'System generated',
        type: 'Smart',
      }),
    /Only manual watchlists can be created from the watchlists workspace/
  );

  assert.deepEqual(
    validateUpdateWatchlistPayload({
      name: '  Updated majors  ',
      description: '  Existing list copy  ',
    }),
    {
      name: 'Updated majors',
      description: 'Existing list copy',
    }
  );

  assert.deepEqual(validateUpdateWatchlistPayload({ description: '' }), {
    description: null,
  });

  assert.throws(
    () => validateUpdateWatchlistPayload({}),
    /At least one watchlist field must be provided/
  );
}

function runSignalAndSuggestedTradeValidationAssertions(): void {
  assert.deepEqual(validatePromoteSignalBody({ target: 'execution_queue' }), {
    target: 'execution_queue',
  });
  assert.deepEqual(validatePromoteSignalBody({ target: 'orders' }), {
    target: 'execution_queue',
  });

  const validatedQuery = validateSuggestedTradesQuery({
    status: 'Accepted',
    symbol: ' btcusdt ',
    side: 'sell',
    search: ' breakout setup ',
  });

  assert.equal(validatedQuery.status, 'Accepted');
  assert.equal(validatedQuery.symbol, 'BTCUSDT');
  assert.equal(validatedQuery.side, 'SELL');
  assert.equal(validatedQuery.search, 'breakout setup');

  const validatedSyncBody = validateSuggestedTradesExecutionSyncBody({
    executionState: ' Working ',
    staleOnly: 'false',
    suggestedTradeIds: [' st-1 ', 'st-1', 'st-2'],
  });

  assert.equal(validatedSyncBody.executionState, 'working');
  assert.equal(validatedSyncBody.staleOnly, false);
  assert.deepEqual(validatedSyncBody.suggestedTradeIds, ['st-1', 'st-2']);
}

async function runWatchlistsLifecycleAssertions(): Promise<void> {
  const service = new WatchlistsService() as any;
  const activityLogs: Array<Record<string, unknown>> = [];
  const failureAlerts: Array<Record<string, unknown>> = [];
  const repositoryCalls: Array<Record<string, unknown>> = [];
  const manualWatchlist = {
    id: 'wl-1',
    name: 'Priority majors',
    type: 'Manual',
    description: 'Core symbols for daily review',
    itemsCount: 1,
    updatedAt: new Date('2026-04-06T12:00:00.000Z'),
  };

  service.watchlistRepository = {
    isDuplicateWatchlistNameError() {
      return false;
    },
    async getWatchlistById(_userId: string, watchlistId: string) {
      if (watchlistId === 'wl-smart') {
        return {
          id: watchlistId,
          name: 'System watchlist',
          type: 'Smart',
          description: 'Generated automatically',
          itemsCount: 1,
          updatedAt: new Date('2026-04-06T12:00:00.000Z'),
        };
      }
      return { ...manualWatchlist, id: watchlistId };
    },
    async updateWatchlist(
      userId: string,
      watchlistId: string,
      input: Record<string, unknown>
    ) {
      repositoryCalls.push({ userId, watchlistId, input });
      return {
        ...manualWatchlist,
        id: watchlistId,
        name: String(input.name || 'Priority majors'),
        description: input.description ?? null,
      };
    },
  };
  service.operationalEventService = {
    async logActivity(_userId: string, payload: Record<string, unknown>) {
      activityLogs.push(payload);
    },
    async emitFailureAlert(_userId: string, payload: Record<string, unknown>) {
      failureAlerts.push(payload);
    },
  };

  const response = await service.updateWatchlist('user-1', 'wl-1', {
    name: 'Priority majors',
    description: 'Core symbols for daily review',
  });

  assert.equal(repositoryCalls.length, 1);
  assert.deepEqual(repositoryCalls[0], {
    userId: 'user-1',
    watchlistId: 'wl-1',
    input: {
      name: 'Priority majors',
      description: 'Core symbols for daily review',
    },
  });
  assert.equal(response.data.message, 'Watchlist updated');
  assert.equal(response.data.watchlist.name, 'Priority majors');
  assert.equal(response.data.watchlist.description, 'Core symbols for daily review');
  assert.equal(response.data.watchlist.type, 'Manual');
  assert.equal(response.data.watchlist.editable, true);
  assert.equal(response.data.watchlist.itemsCount, 1);
  assert.equal(activityLogs.length, 1);
  assert.equal(activityLogs[0].title, 'Watchlist updated: Priority majors');
  assert.equal(failureAlerts.length, 0);

  await assert.rejects(
    () =>
      service.updateWatchlist('user-1', 'wl-smart', {
        name: 'Should fail',
      }),
    /system-managed and cannot be edited from the watchlists workspace/
  );
}

async function runWatchlistsConflictAssertions(): Promise<void> {
  const duplicateError = new Error(
    "Duplicate entry for key 'uidx_watchlists_owner_name_ci'"
  ) as Error & { code?: string };
  duplicateError.code = 'ER_DUP_ENTRY';

  const service = new WatchlistsService() as any;
  const activityLogs: Array<Record<string, unknown>> = [];
  const failureAlerts: Array<Record<string, unknown>> = [];

  service.watchlistRepository = {
    isDuplicateWatchlistNameError(error: unknown) {
      return error === duplicateError;
    },
    async createWatchlist() {
      throw duplicateError;
    },
    async getWatchlistById() {
      return {
        id: 'wl-1',
        name: 'Priority majors',
        type: 'Manual',
        description: 'Core symbols for daily review',
        items: [{ id: 'item-1' }],
        updatedAt: new Date('2026-04-06T12:00:00.000Z'),
      };
    },
    async updateWatchlist() {
      throw duplicateError;
    },
  };
  service.operationalEventService = {
    async logActivity(_userId: string, payload: Record<string, unknown>) {
      activityLogs.push(payload);
    },
    async emitFailureAlert(_userId: string, payload: Record<string, unknown>) {
      failureAlerts.push(payload);
    },
  };

  await assert.rejects(
    () =>
      service.createWatchlist('user-1', {
        name: 'Priority majors',
      }),
    /A watchlist named "Priority majors" already exists for this workspace/
  );

  await assert.rejects(
    () =>
      service.updateWatchlist('user-1', 'wl-1', {
        name: 'Priority majors',
      }),
    /A watchlist named "Priority majors" already exists for this workspace/
  );

  assert.equal(activityLogs.length, 2);
  assert.equal(activityLogs[0].status, 'Failed');
  assert.equal(activityLogs[1].status, 'Failed');
  assert.equal(failureAlerts.length, 2);
  assert.match(
    String(failureAlerts[0].message || ''),
    /A watchlist named "Priority majors" already exists for this workspace/
  );
  assert.match(
    String(failureAlerts[1].message || ''),
    /A watchlist named "Priority majors" already exists for this workspace/
  );
}

async function runWatchlistsDuplicateAddRaceAssertions(): Promise<void> {
  const service = new WatchlistsService() as any;
  const activityLogs: Array<Record<string, unknown>> = [];
  const failureAlerts: Array<Record<string, unknown>> = [];
  const repositoryCalls: Array<Record<string, unknown>> = [];

  service.watchlistRepository = {
    async getWatchlistById() {
      return {
        id: 'wl-1',
        name: 'Priority majors',
        type: 'Manual',
        description: 'Core symbols for daily review',
        itemsCount: 1,
        updatedAt: new Date('2026-04-06T12:00:00.000Z'),
      };
    },
    async addWatchlistItems(userId: string, watchlistId: string, symbols: string[]) {
      repositoryCalls.push({ userId, watchlistId, symbols });
      return {
        added: [],
        skipped: ['BTCUSDT'],
      };
    },
  };
  service.operationalEventService = {
    async logActivity(_userId: string, payload: Record<string, unknown>) {
      activityLogs.push(payload);
    },
    async emitFailureAlert(_userId: string, payload: Record<string, unknown>) {
      failureAlerts.push(payload);
    },
  };

  const response = await service.addWatchlistItems('user-1', 'wl-1', {
    symbol: 'btcusdt',
  });

  assert.deepEqual(repositoryCalls, [
    {
      userId: 'user-1',
      watchlistId: 'wl-1',
      symbols: ['BTCUSDT'],
    },
  ]);
  assert.equal(response.data.message, 'No new symbols added');
  assert.deepEqual(response.data.added, []);
  assert.deepEqual(response.data.skipped, ['BTCUSDT']);
  assert.equal(activityLogs.length, 1);
  assert.equal(activityLogs[0].status, 'Success');
  assert.match(String(activityLogs[0].description || ''), /Added 0 symbols/);
  assert.equal(failureAlerts.length, 0);
}

async function runMarketsOverviewStaleSnapshotAssertions(): Promise<void> {
  const service = new MarketsOverviewService() as any;

  service.marketSymbolSnapshotRepository = {
    supportsOverviewSort(sort?: string) {
      return sort === 'volume';
    },
    async listOverviewSnapshots() {
      return {
        data: [
          {
            symbol: 'BTCUSDT',
            name: 'Bitcoin',
            lastPrice: 67250.12,
            change24h: 3.42,
            volume24h: 184000000,
            high24h: 67500.45,
            low24h: 66120.11,
            liquidityTier: 'High',
            priceSource: 'snapshot',
            snapshotAt: new Date('2026-04-05T00:00:00.000Z'),
          },
        ],
        total: 1,
        timings: {
          countMs: 3,
          dataMs: 5,
        },
      };
    },
    async getBySymbol() {
      return null;
    },
  };
  service.signalRepository = {
    async getLatestSignalsBySymbols() {
      return new Map();
    },
  };
  service.watchlistRepository = {
    async countWatchlistsBySymbols() {
      return new Map([['BTCUSDT', 2]]);
    },
  };
  service.assetRepository = {
    async listAssetBases() {
      throw new Error('snapshot fast path should not load asset bases');
    },
  };

  const response = await service.getOverview('user-1', {
    limit: '20',
    offset: '0',
    sort: 'volume',
  });

  assert.equal(response.data.meta.buildMode, 'snapshot-query');
  assert.equal(response.data.meta.cacheState, 'miss');
  assert.equal(response.data.assets.length, 1);
  assert.equal(response.data.assets[0].symbol, 'BTCUSDT');
  assert.equal(response.data.assets[0].watchlist_count, 2);
  assert.equal(response.data.assets[0].provenance?.mode, 'snapshot');
  assert.equal(response.data.assets[0].provenance?.isStale, true);
  assert.equal(response.data.selectedAsset?.symbol, 'BTCUSDT');
}

async function runMarketsSymbolOverviewEnrichmentAssertions(): Promise<void> {
  const service = new MarketsOverviewService() as any;

  service.assetRepository = {
    async getAssetBySymbol() {
      return {
        symbol: 'BTCUSDT',
        name: 'Bitcoin',
      };
    },
  };
  service.marketSymbolSnapshotRepository = {
    async getBySymbols() {
      return [
        {
          symbol: 'BTCUSDT',
          name: 'Bitcoin snapshot',
          lastPrice: 66880.11,
          change24h: 2.18,
          volume24h: 173000000,
          high24h: 67110.52,
          low24h: 65420.24,
          liquidityTier: 'High',
          priceSource: 'snapshot',
          snapshotAt: new Date('2026-04-06T09:40:00.000Z'),
        },
      ];
    },
  };
  service.marketMetricsService = {
    async getMetricsForSymbols() {
      return new Map([
        [
          'BTCUSDT',
          {
            symbol: 'BTCUSDT',
            lastPrice: 67250.12,
            changePerc: 3.42,
            volume24h: 184000000,
            high24h: 67500.45,
            low24h: 66120.11,
            snapshotAt: new Date('2026-04-06T09:58:00.000Z'),
            priceSource: 'pg.market_candles_1m',
          },
        ],
      ]);
    },
  };
  service.signalsService = {
    async getSignals() {
      return {
        data: {
          items: [
            {
              id: 'signal-1',
              symbol: 'BTCUSDT',
              source: 'Trend model',
              status: 'Triggered',
              timeframe: '1h',
              confidence: 0.91,
            },
          ],
          total: 1,
          limit: 6,
          offset: 0,
        },
      };
    },
  };
  service.watchlistRepository = {
    async listWatchlistsContainingSymbol() {
      return [
        {
          id: 'wl-1',
          name: 'Momentum Core',
          type: 'Manual',
          updatedAt: new Date('2026-04-06T10:10:00.000Z'),
        },
      ];
    },
  };

  const response = await service.getSymbolOverview('user-1', 'BTCUSDT', {
    signalsLimit: '6',
  });

  assert.equal(response.data.symbol, 'BTCUSDT');
  assert.equal(response.data.asset?.name, 'Bitcoin');
  assert.equal(response.data.asset?.price, 67250.12);
  assert.equal(response.data.asset?.provenance?.mode, 'live-candles');
  assert.equal(response.data.asset?.price_source, 'pg.market_candles_1m');
  assert.equal(response.data.signals.total, 1);
  assert.equal(response.data.signals.items[0].id, 'signal-1');
  assert.equal(response.data.watchlists.total, 1);
  assert.equal(response.data.watchlists.memberships[0].id, 'wl-1');
  assert.equal(response.data.watchlists.memberships[0].name, 'Momentum Core');
}

async function runSettingsAuditContractAssertions(): Promise<void> {
  const service = new SettingsService() as any;
  const auditQueries: Array<Record<string, unknown>> = [];

  service.appSettingsRepository = {
    async getSettings() {
      return null;
    },
  };
  service.settingsAuditRepository = {
    async listAuditLogs(_userId: string, query: Record<string, unknown>) {
      auditQueries.push(query);
      return {
        items: [
          {
            id: 'audit-1',
            fieldName: 'notifyEmail',
            oldValue: 'true',
            oldValueType: null,
            oldValueJson: null,
            newValue: 'false',
            newValueType: null,
            newValueJson: null,
            changeType: null,
            actor: 'user-1',
            createdAt: new Date('2026-04-04T00:08:00.000Z'),
          },
          {
            id: 'audit-2',
            fieldName: 'notificationChannel',
            oldValue: 'both',
            oldValueType: 'string',
            oldValueJson: 'both',
            newValue: 'disabled',
            newValueType: 'string',
            newValueJson: 'disabled',
            changeType: 'updated',
            actor: 'user-1',
            createdAt: new Date('2026-04-04T00:09:00.000Z'),
          },
          {
            id: 'audit-3',
            fieldName: 'escalationSlaMinutes',
            oldValue: null,
            oldValueType: 'null',
            oldValueJson: null,
            newValue: '30',
            newValueType: 'number',
            newValueJson: 30,
            changeType: 'created',
            actor: null,
            createdAt: new Date('2026-04-04T00:10:00.000Z'),
          },
          {
            id: 'audit-4',
            fieldName: 'backtestPromotionRules.minScore',
            oldValue: '0.6',
            oldValueType: 'number',
            oldValueJson: 0.6,
            newValue: '0.8',
            newValueType: 'number',
            newValueJson: 0.8,
            changeType: 'updated',
            actor: 'user-1',
            createdAt: new Date('2026-04-04T00:11:00.000Z'),
          },
          {
            id: 'audit-5',
            fieldName: 'backtestPromotionRules.requireRobustness',
            oldValue: 'true',
            oldValueType: 'boolean',
            oldValueJson: true,
            newValue: 'false',
            newValueType: 'boolean',
            newValueJson: false,
            changeType: 'updated',
            actor: 'user-1',
            createdAt: new Date('2026-04-04T00:12:00.000Z'),
          },
          {
            id: 'audit-6',
            fieldName: 'backtestPromotionRules',
            oldValue: JSON.stringify(createDefaultBacktestPromotionRules()),
            oldValueType: 'json',
            oldValueJson: createDefaultBacktestPromotionRules(),
            newValue: JSON.stringify({
              ...createDefaultBacktestPromotionRules(),
              minScore: 0.8,
            }),
            newValueType: 'json',
            newValueJson: {
              ...createDefaultBacktestPromotionRules(),
              minScore: 0.8,
            },
            changeType: 'updated',
            actor: 'user-1',
            createdAt: new Date('2026-04-04T00:13:00.000Z'),
          },
        ],
        total: 6,
      };
    },
  };

  const settingsResponse = await service.getSettings('user-1');
  assert.equal(settingsResponse.data.hasSavedSettings, false);
  assert.equal(settingsResponse.data.versionToken, undefined);
  assert.equal(settingsResponse.data.backtestPromotionRules.minScore, 0.6);

  const defaultAuditResponse = await service.getSettingsAudit('user-1', {});
  assert.equal(defaultAuditResponse.data.limit, 20);
  assert.equal(defaultAuditResponse.data.offset, 0);

  const auditResponse = await service.getSettingsAudit('user-1', {
    limit: '10',
    offset: '0',
  });

  assert.deepEqual(auditQueries, [{ limit: 20, offset: 0 }, { limit: 10, offset: 0 }]);
  assert.equal(auditResponse.data.total, 6);
  assert.equal(auditResponse.data.items[0]?.fieldLabel, 'Email notifications');
  assert.equal(auditResponse.data.items[0]?.fieldKey, 'notifyEmail');
  assert.equal(auditResponse.data.items[0]?.oldValue, true);
  assert.equal(auditResponse.data.items[0]?.newValue, false);
  assert.equal(auditResponse.data.items[0]?.oldValueType, 'boolean');
  assert.equal(auditResponse.data.items[0]?.newValueDisplay, 'Disabled');
  assert.equal(auditResponse.data.items[0]?.changeType, 'updated');
  assert.equal(auditResponse.data.items[1]?.oldValueDisplay, 'In-app + Email');
  assert.equal(auditResponse.data.items[1]?.newValueDisplay, 'Disabled');
  assert.equal(auditResponse.data.items[2]?.fieldLabel, 'Escalation SLA (minutes)');
  assert.equal(auditResponse.data.items[2]?.oldValue, null);
  assert.equal(auditResponse.data.items[2]?.newValue, 30);
  assert.equal(auditResponse.data.items[2]?.newValueType, 'number');
  assert.equal(auditResponse.data.items[2]?.changeType, 'created');
  assert.equal(
    auditResponse.data.items[3]?.fieldLabel,
    'Promotion rule: Minimum score'
  );
  assert.equal(auditResponse.data.items[3]?.oldValueType, 'number');
  assert.equal(auditResponse.data.items[3]?.newValueType, 'number');
  assert.equal(auditResponse.data.items[3]?.oldValueDisplay, '0.60');
  assert.equal(auditResponse.data.items[3]?.newValueDisplay, '0.80');
  assert.equal(
    auditResponse.data.items[4]?.fieldLabel,
    'Promotion rule: Robustness validation gate'
  );
  assert.equal(auditResponse.data.items[4]?.oldValueDisplay, 'Required');
  assert.equal(auditResponse.data.items[4]?.newValueDisplay, 'Optional');
  assert.equal(auditResponse.data.items[5]?.fieldLabel, 'Backtests promotion rules');
  assert.equal(auditResponse.data.items[5]?.newValueType, 'json');
  assert.equal(
    (auditResponse.data.items[5]?.newValue as Record<string, unknown>)?.minScore,
    0.8
  );
  assert.match(auditResponse.data.items[5]?.newValueDisplay || '', /score >= 0\.80/);
}

async function runSettingsSchemaNormalizationAssertions(): Promise<void> {
  const createMigration = new CreateAppSettingsTable1741474200000();
  let createdColumns: MigrationColumn[] = [];

  await createMigration.up({
    async hasTable() {
      return false;
    },
    async createTable(table: { columns?: MigrationColumn[] }) {
      createdColumns = table.columns ?? [];
    },
  } as any);

  const idColumn = createdColumns.find((column: MigrationColumn) => column.name === 'id');
  assert.equal(idColumn?.isGenerated, true);
  assert.equal(idColumn?.generationStrategy, 'increment');

  const normalizationMigration = new NormalizeAppSettingsPrimaryKey1765401000000();
  const driftRepairQueries: string[] = [];

  await normalizationMigration.up({
    async hasTable() {
      return true;
    },
    async query(sql: string) {
      driftRepairQueries.push(sql);
      if (sql.includes('FROM information_schema.columns')) {
        return [{ extraValue: '' }];
      }

      return [];
    },
  } as any);

  assert.equal(
    driftRepairQueries.some((sql) =>
      sql.includes('ALTER TABLE app_settings MODIFY id int NOT NULL AUTO_INCREMENT')
    ),
    true
  );

  const alreadyNormalizedQueries: string[] = [];
  await normalizationMigration.up({
    async hasTable() {
      return true;
    },
    async query(sql: string) {
      alreadyNormalizedQueries.push(sql);
      if (sql.includes('FROM information_schema.columns')) {
        return [{ extraValue: 'auto_increment' }];
      }

      return [];
    },
  } as any);

  assert.equal(
    alreadyNormalizedQueries.some((sql) =>
      sql.includes('ALTER TABLE app_settings MODIFY id int NOT NULL AUTO_INCREMENT')
    ),
    false
  );

  const promotionRulesMigration = new AddBacktestPromotionRulesToAppSettings1770715000000();
  const addedColumns: string[] = [];
  await promotionRulesMigration.up({
    async hasTable() {
      return true;
    },
    async hasColumn() {
      return false;
    },
    async addColumn(_tableName: string, column: { name: string }) {
      addedColumns.push(column.name);
    },
  } as any);
  assert.deepEqual(addedColumns, ['backtestPromotionRules']);

  const droppedColumns: string[] = [];
  await promotionRulesMigration.down({
    async hasTable() {
      return true;
    },
    async hasColumn() {
      return true;
    },
    async dropColumn(_tableName: string, columnName: string) {
      droppedColumns.push(columnName);
    },
  } as any);
  assert.deepEqual(droppedColumns, ['backtestPromotionRules']);
}

async function runSuggestedTradeExecutionStorageMigrationAssertions(): Promise<void> {
  const migration = new HardenSuggestedTradeExecutionStorage1767300010000();
  const executedQueries: string[] = [];
  const createdTables: string[] = [];
  const createdIndexes: string[] = [];
  const createdForeignKeys: string[] = [];
  const tableState = new Map<
    string,
    {
      indices: string[];
      foreignKeys: string[];
    }
  >([
    ['suggested_trades', { indices: [], foreignKeys: [] }],
    ['paper_orders', { indices: [], foreignKeys: [] }],
    ['automation_run_outputs', { indices: [], foreignKeys: [] }],
  ]);

  await migration.up({
    async hasTable(tableName: string) {
      return tableState.has(tableName);
    },
    async createTable(table: { name?: string }) {
      const name = String(table.name || '');
      createdTables.push(name);
      tableState.set(name, { indices: [], foreignKeys: [] });
    },
    async getTable(tableName: string) {
      const table = tableState.get(tableName);
      if (!table) {
        return undefined;
      }
      return {
        indices: table.indices.map((name) => ({ name })),
        foreignKeys: table.foreignKeys.map((name) => ({ name })),
      };
    },
    async createIndex(tableName: string, index: { name?: string }) {
      const name = String(index.name || '');
      createdIndexes.push(name);
      tableState.get(tableName)?.indices.push(name);
    },
    async createForeignKey(tableName: string, foreignKey: { name?: string }) {
      const name = String(foreignKey.name || '');
      createdForeignKeys.push(name);
      tableState.get(tableName)?.foreignKeys.push(name);
    },
    async query(sql: string) {
      executedQueries.push(sql);
      return [];
    },
  } as any);

  assert.deepEqual(createdTables, ['suggested_trade_executions']);
  assert.equal(
    createdIndexes.includes('idx_suggested_trade_executions_user_order_lookup'),
    true
  );
  assert.equal(
    createdIndexes.includes('idx_suggested_trades_user_automation_status_signal_time'),
    true
  );
  assert.equal(
    createdForeignKeys.includes('fk_suggested_trade_executions_trade'),
    true
  );
  assert.equal(
    createdForeignKeys.includes('fk_paper_orders_suggested_trade'),
    true
  );
  assert.equal(
    createdForeignKeys.includes('fk_automation_run_outputs_suggested_trade'),
    true
  );
  assert.equal(
    executedQueries.some((sql) => sql.includes('INSERT INTO suggested_trade_executions')),
    true
  );
  assert.equal(
    executedQueries.some((sql) => sql.includes('JSON_REMOVE(meta_json, \'$.execution\')')),
    true
  );
}

async function runCleanupBrokerExchangeMastersMigrationAssertions(): Promise<void> {
  const migration = new CleanupBrokerExchangeMasters1769800000000();
  const executedQueries: string[] = [];

  await migration.up({
    async hasTable(tableName: string) {
      return ['brokers', 'exchanges', 'connections', 'broker_accounts', 'broker_assets'].includes(
        String(tableName || '')
      );
    },
    async hasColumn(tableName: string, columnName: string) {
      const columnsByTable = new Map<string, string[]>([
        ['brokers', ['category', 'provider_type', 'linked_exchange_key', 'updated_at']],
        ['exchanges', ['base_url']],
        ['connections', ['brokerKey', 'broker_id', 'exchange_id']],
        ['broker_accounts', ['brokerKey', 'broker_id']],
        ['broker_assets', ['source', 'broker_id', 'exchange_id']],
      ]);

      return (
        columnsByTable
          .get(String(tableName || ''))
          ?.includes(String(columnName || '')) ?? false
      );
    },
    async query(sql: string, params?: unknown[]) {
      executedQueries.push(sql);

      if (
        sql.includes('SELECT id FROM exchanges WHERE LOWER(TRIM(exchange_key)) = ? LIMIT 1') &&
        params?.[0] === 'binance'
      ) {
        return [];
      }

      return [];
    },
  } as any);

  assert.equal(
    executedQueries.some((sql) => sql.includes("INSERT INTO exchanges") && sql.includes("'binance'")),
    true
  );
  assert.equal(
    executedQueries.some(
      (sql) =>
        sql.includes('UPDATE brokers') &&
        sql.includes("category = 'broker'") &&
        sql.includes("provider_type = 'broker'") &&
        sql.includes('linked_exchange_key = NULL') &&
        sql.includes("LOWER(TRIM(broker_key)) = 'delta_exchange'")
    ),
    true
  );
  assert.equal(
    executedQueries.some(
      (sql) =>
        sql.includes('UPDATE connections') &&
        sql.includes("SET brokerKey = 'binance'") &&
        sql.includes("LOWER(TRIM(brokerKey)) = 'binance_market_data'")
    ),
    true
  );
  assert.equal(
    executedQueries.some(
      (sql) =>
        sql.includes('UPDATE connections') &&
        sql.includes('SET broker_id = NULL') &&
        sql.includes("('binance_market_data', 'binance')")
    ),
    true
  );
  assert.equal(
    executedQueries.some(
      (sql) =>
        sql.includes('UPDATE connections') &&
        sql.includes('SET exchange_id = NULL') &&
        sql.includes("LOWER(TRIM(brokerKey)) = 'delta_exchange'")
    ),
    true
  );
  assert.equal(
    executedQueries.some(
      (sql) =>
        sql.includes('UPDATE broker_assets') &&
        sql.includes("SET source = 'binance'") &&
        sql.includes("LOWER(TRIM(source)) = 'binance_market_data'")
    ),
    true
  );
  assert.equal(
    executedQueries.some(
      (sql) =>
        sql.includes('DELETE FROM brokers') &&
        sql.includes("LOWER(TRIM(broker_key)) = 'binance_market_data'")
    ),
    true
  );
  assert.equal(
    executedQueries.some(
      (sql) =>
        sql.includes('DELETE FROM exchanges') &&
        sql.includes("LOWER(TRIM(exchange_key)) = 'delta_exchange'")
    ),
    true
  );
}

async function runDropConnectionExchangeIdMigrationAssertions(): Promise<void> {
  const migration = new DropConnectionExchangeId1770000000000();
  const executedQueries: string[] = [];

  await migration.up({
    async hasTable(tableName: string) {
      return String(tableName || '') === 'connections';
    },
    async hasColumn(tableName: string, columnName: string) {
      return String(tableName || '') === 'connections' && String(columnName || '') === 'exchange_id';
    },
    async query(sql: string, params?: unknown[]) {
      executedQueries.push(sql);

      if (
        sql.includes('SHOW INDEX FROM connections WHERE Key_name = ?') &&
        params?.[0] === 'idx_connections_user_exchange_id'
      ) {
        return [{ Key_name: 'idx_connections_user_exchange_id' }];
      }

      if (
        sql.includes('FROM information_schema.TABLE_CONSTRAINTS') &&
        params?.[0] === 'connections' &&
        params?.[1] === 'FK_connections_exchange_id'
      ) {
        return [{ CONSTRAINT_NAME: 'FK_connections_exchange_id' }];
      }

      return [];
    },
  } as any);

  assert.equal(
    executedQueries.some((sql) => sql.includes('UPDATE connections SET exchange_id = NULL')),
    true
  );
  assert.equal(
    executedQueries.some(
      (sql) => sql.includes('ALTER TABLE connections DROP FOREIGN KEY FK_connections_exchange_id')
    ),
    true
  );
  assert.equal(
    executedQueries.some(
      (sql) => sql.includes('ALTER TABLE connections DROP INDEX idx_connections_user_exchange_id')
    ),
    true
  );
  assert.equal(
    executedQueries.some((sql) => sql.includes('ALTER TABLE connections DROP COLUMN exchange_id')),
    true
  );

  const rollbackQueries: string[] = [];
  await migration.down({
    async hasTable(tableName: string) {
      return ['connections', 'exchanges'].includes(String(tableName || ''));
    },
    async hasColumn() {
      return false;
    },
    async query(sql: string, params?: unknown[]) {
      rollbackQueries.push(sql);

      if (
        sql.includes('SHOW INDEX FROM connections WHERE Key_name = ?') &&
        params?.[0] === 'idx_connections_user_exchange_id'
      ) {
        return [];
      }

      if (
        sql.includes('FROM information_schema.TABLE_CONSTRAINTS') &&
        params?.[0] === 'connections' &&
        params?.[1] === 'FK_connections_exchange_id'
      ) {
        return [];
      }

      return [];
    },
  } as any);

  assert.equal(
    rollbackQueries.some(
      (sql) => sql.includes('ALTER TABLE connections ADD COLUMN exchange_id char(36) NULL')
    ),
    true
  );
  assert.equal(
    rollbackQueries.some(
      (sql) =>
        sql.includes('CREATE INDEX idx_connections_user_exchange_id ON connections (user_id, exchange_id)')
    ),
    true
  );
  assert.equal(
    rollbackQueries.some(
      (sql) =>
        sql.includes('ALTER TABLE connections') &&
        sql.includes('ADD CONSTRAINT FK_connections_exchange_id') &&
        sql.includes('FOREIGN KEY (exchange_id)') &&
        sql.includes('REFERENCES exchanges(id)') &&
        sql.includes('ON DELETE SET NULL')
    ),
    true
  );
}

async function runDropBrokerAssetExchangeIdMigrationAssertions(): Promise<void> {
  const migration = new DropBrokerAssetExchangeId1770100000000();
  const executedQueries: string[] = [];

  await migration.up({
    async hasTable(tableName: string) {
      return String(tableName || '') === 'broker_assets';
    },
    async hasColumn(tableName: string, columnName: string) {
      return String(tableName || '') === 'broker_assets' && String(columnName || '') === 'exchange_id';
    },
    async query(sql: string, params?: unknown[]) {
      executedQueries.push(sql);

      if (
        sql.includes('SHOW INDEX FROM broker_assets WHERE Key_name = ?') &&
        params?.[0] === 'idx_broker_assets_user_exchange_id'
      ) {
        return [{ Key_name: 'idx_broker_assets_user_exchange_id' }];
      }

      if (
        sql.includes('FROM information_schema.KEY_COLUMN_USAGE') &&
        params?.[0] === 'broker_assets' &&
        params?.[1] === 'exchange_id'
      ) {
        return [{ CONSTRAINT_NAME: 'FK_exchange_assets_exchange_id' }];
      }

      return [];
    },
  } as any);

  assert.equal(
    executedQueries.some((sql) => sql.includes('UPDATE broker_assets SET exchange_id = NULL')),
    true
  );
  assert.equal(
    executedQueries.some(
      (sql) => sql.includes('ALTER TABLE broker_assets DROP FOREIGN KEY FK_exchange_assets_exchange_id')
    ),
    true
  );
  assert.equal(
    executedQueries.some(
      (sql) => sql.includes('ALTER TABLE broker_assets DROP INDEX idx_broker_assets_user_exchange_id')
    ),
    true
  );
  assert.equal(
    executedQueries.some((sql) => sql.includes('ALTER TABLE broker_assets DROP COLUMN exchange_id')),
    true
  );

  const rollbackQueries: string[] = [];
  await migration.down({
    async hasTable(tableName: string) {
      return ['broker_assets', 'exchanges'].includes(String(tableName || ''));
    },
    async hasColumn() {
      return false;
    },
    async query(sql: string, params?: unknown[]) {
      rollbackQueries.push(sql);

      if (
        sql.includes('SHOW INDEX FROM broker_assets WHERE Key_name = ?') &&
        params?.[0] === 'idx_broker_assets_user_exchange_id'
      ) {
        return [];
      }

      if (
        sql.includes('FROM information_schema.KEY_COLUMN_USAGE') &&
        params?.[0] === 'broker_assets' &&
        params?.[1] === 'exchange_id'
      ) {
        return [];
      }

      return [];
    },
  } as any);

  assert.equal(
    rollbackQueries.some(
      (sql) => sql.includes('ALTER TABLE broker_assets ADD COLUMN exchange_id char(36) NULL')
    ),
    true
  );
  assert.equal(
    rollbackQueries.some(
      (sql) =>
        sql.includes(
          'CREATE INDEX idx_broker_assets_user_exchange_id ON broker_assets (user_id, exchange_id)'
        )
    ),
    true
  );
  assert.equal(
    rollbackQueries.some(
      (sql) =>
        sql.includes('ALTER TABLE broker_assets') &&
        sql.includes('ADD CONSTRAINT FK_broker_assets_exchange_id') &&
        sql.includes('FOREIGN KEY (exchange_id)') &&
        sql.includes('REFERENCES exchanges(id)') &&
        sql.includes('ON DELETE SET NULL')
    ),
    true
  );
}

function runStrategyLabValidationAssertions(): void {
  const validated = validateStrategyLabDraftBody({
    name: 'Breakout Draft',
    description: 'Saved description',
    authoringMode: 'code',
    market: 'crypto-futures',
    timeframe: '15m',
    timeframes: ['15m', '1h'],
    codeTarget: 'python',
    codeDefinition: `from auralpha import Strategy

class StrategyDraft(Strategy):
    name = "Breakout Draft"
    market = "crypto-futures"

    def entry(self, ctx):
        return True

    def exit(self, ctx):
        return False

    risk = {
        "max_per_trade": 2.0,
        "signal_threshold": 0.9,
    }`,
    parameters: {
      signal_threshold: '0.91',
    },
    riskConfig: {
      max_per_trade: '2.25',
      sizingNotes: 'Scale in after confirmation',
    },
  });

  assert.equal(validated.description, 'Saved description');
  assert.equal(validated.maxRisk, '2.25');
  assert.equal(validated.signalThreshold, '0.91');
  assert.equal(validated.riskConfig?.maxRisk, '2.25');
  assert.equal(validated.parameters?.signalThreshold, '0.91');
  assert.equal(validated.sourceTemplateId, null);
  assert.equal(validated.sourceTemplateVersion, null);
  assert.equal(validated.sourceTemplateName, null);
  assert.equal(validated.shortEnabled, false);
  assert.equal(validated.entryShortLogic, '');
  assert.equal(validated.exitShortLogic, '');
}

function runStrategyTemplateNormalizationAssertions(): void {
  const service = new StrategyTemplatesService() as any;

  const normalizedDsl = service.coerceTemplateConfigToPython(
    {
      codeTarget: 'dsl',
      codeDefinition: `STRATEGY Mean Reversion
MARKET crypto-futures
ENTRY ema(20) > ema(50)
EXIT ema(20) < ema(50)
RISK max_per_trade=1.5 signal_threshold=0.82`,
      entryLogic: 'ema(20) > ema(50)',
      exitLogic: 'ema(20) < ema(50)',
      risk: {
        maxRisk: '1.5',
      },
      parameters: {
        signalThreshold: '0.82',
      },
    },
    'Mean Reversion'
  );

  assert.equal(normalizedDsl.codeTarget, 'python');
  assert.equal(normalizedDsl.compiledCodeTarget, 'python');
  assert.equal(normalizedDsl.authoredCodeTarget, 'dsl');
  assert.match(String(normalizedDsl.authoredCodeDefinition || ''), /^STRATEGY Mean Reversion/m);
  assert.match(String(normalizedDsl.compiledCodeDefinition || ''), /def entry\(self, ctx\):/);
  assert.match(String(normalizedDsl.compiledCodeDefinition || ''), /def entry_short\(self, ctx\):\n {8}return False/);
  assert.equal(normalizedDsl.shortEnabled, false);
  assert.equal(normalizedDsl.entryShortLogic, '');
  assert.equal(normalizedDsl.exitShortLogic, '');

  const normalizedAuthored = service.coerceTemplateConfigToPython(
    {
      authoredCodeTarget: 'javascript',
      authoredCodeDefinition: `export default defineStrategy({
  name: 'Breakout',
  market: 'crypto-futures',
  entry(ctx) { return true; },
  exit(ctx) { return false; },
  risk: { max_per_trade: 2.0, signal_threshold: 0.9 }
})`,
      compiledCodeTarget: 'python',
      compiledCodeDefinition: 'from auralpha import Strategy',
      entryLogic: 'ema(9) > ema(21)',
      exitLogic: 'ema(9) < ema(21)',
    },
    'Breakout'
  );

  assert.equal(normalizedAuthored.authoredCodeTarget, 'javascript');
  assert.match(
    String(normalizedAuthored.authoredCodeDefinition || ''),
    /export default defineStrategy/
  );
  assert.equal(normalizedAuthored.compiledCodeTarget, 'python');
  assert.match(String(normalizedAuthored.codeDefinition || ''), /class StrategyDraft\(Strategy\):/);

  const normalizedPythonRisk = service.coerceTemplateConfigToPython(
    {
      codeTarget: 'python',
      codeDefinition: `from auralpha import Strategy

class BreakoutRisk(Strategy):
    name = "Breakout Risk"
    market = "crypto-futures"

    def entry(self, ctx):
        return True

    def exit(self, ctx):
        return False

    risk = {
        "stop_loss_pct": 1.2,
        "take_profit_pct": 2.6,
    }`,
      risk: {
        maxRisk: '1.5',
        sizingNotes: 'Preserve execution risk',
      },
    },
    'Breakout Risk'
  );

  assert.equal(normalizedPythonRisk.risk.stop_loss_pct, 1.2);
  assert.equal(normalizedPythonRisk.risk.take_profit_pct, 2.6);
  assert.equal(normalizedPythonRisk.risk.maxRisk, '1.5');

  const normalizedShort = service.coerceTemplateConfigToPython(
    {
      codeTarget: 'dsl',
      codeDefinition: `STRATEGY Trend Mirror
MARKET crypto-futures
ENTRY ema(20) > ema(50)
EXIT ema(20) < ema(50)
ENTRY_SHORT ema(20) < ema(50)
EXIT_SHORT ema(20) > ema(50)
RISK max_per_trade=1.5 signal_threshold=0.82`,
      entryLogic: 'ema(20) > ema(50)',
      exitLogic: 'ema(20) < ema(50)',
      shortEnabled: true,
      entryShortLogic: 'ema(20) < ema(50)',
      exitShortLogic: 'ema(20) > ema(50)',
    },
    'Trend Mirror'
  );

  assert.equal(normalizedShort.shortEnabled, true);
  assert.equal(normalizedShort.entryShortLogic, 'ema(20) < ema(50)');
  assert.equal(normalizedShort.exitShortLogic, 'ema(20) > ema(50)');
  assert.match(
    String(normalizedShort.compiledCodeDefinition || ''),
    /def entry_short\(self, ctx\):\n {8}return ema\(ctx, 20\) < ema\(ctx, 50\)/
  );

  const mappedTemplate = service.mapTemplate({
    id: 'template-1',
    userId: 'user-1',
    name: 'Mapped Template',
    description: 'Versioned',
    status: 'Draft',
    templateVersion: 4,
    config: { market: 'crypto-futures' },
    createdAt: new Date('2026-03-01T00:00:00.000Z'),
    updatedAt: new Date('2026-03-15T00:00:00.000Z'),
  });

  assert.equal(mappedTemplate.templateVersion, 4);
}

async function runStrategyTemplateSuggestionImportAssertions(): Promise<void> {
  const service = new StrategyTemplatesService() as any;
  const createdPayloads: Array<Record<string, unknown>> = [];
  const activities: Array<Record<string, unknown>> = [];

  Object.defineProperty(service, 'strategyTemplateRepository', {
    value: {
      async createStrategyTemplate(userId: string, payload: Record<string, unknown>) {
        createdPayloads.push({ userId, ...payload });
        return {
          id: 'imported-template-1',
          userId,
          name: String(payload.name || ''),
          description: payload.description ?? null,
          status: String(payload.status || 'Draft'),
          templateVersion: 1,
          config: payload.config ?? null,
          createdAt: new Date('2026-04-03T00:00:00.000Z'),
          updatedAt: new Date('2026-04-03T00:00:00.000Z'),
        };
      },
    },
  });

  Object.defineProperty(service, 'operationalEventService', {
    value: {
      async logActivity(userId: string, payload: Record<string, unknown>) {
        activities.push({ userId, ...payload });
      },
      async emitFailureAlert() {
        throw new Error('emitFailureAlert should not run for successful imports');
      },
    },
  });

  const result = await service.importStrategyTemplateSuggestion({
    userId: 'user-42',
    suggestionId: 'suggestion-7',
    templateId: 'template-9',
    templateName: 'Momentum Core',
    suggestedName: 'Momentum Core (Improved)',
    diffSummary: 'Risk tweak: Tighter stop, higher target',
    reasoning: 'Avg score improved across multi-asset evaluation.',
    suggestedConfig: {
      codeTarget: 'dsl',
      codeDefinition: `STRATEGY Momentum Core\nENTRY ema(9) > ema(21)\nEXIT ema(9) < ema(21)`,
      entryLogic: 'ema(9) > ema(21)',
      exitLogic: 'ema(9) < ema(21)',
    },
  });

  assert.equal(createdPayloads.length, 1);
  assert.equal(createdPayloads[0].userId, 'user-42');
  assert.equal(createdPayloads[0].name, 'Momentum Core (Improved)');
  assert.equal(createdPayloads[0].status, 'Draft');
  assert.match(
    String(createdPayloads[0].description || ''),
    /Imported from AI Discovery suggestion suggestion-7/
  );
  assert.match(String(createdPayloads[0].description || ''), /Momentum Core/);
  assert.match(String(createdPayloads[0].description || ''), /Risk tweak/);
  assert.match(
    String((createdPayloads[0].config as Record<string, unknown>)?.codeDefinition || ''),
    /class StrategyDraft\(Strategy\):/
  );
  assert.equal(result.data.id, 'imported-template-1');
  assert.equal(result.data.templateVersion, 1);
  assert.equal(activities.length, 1);
}

async function runStrategyTemplateVersionLifecycleAssertions(): Promise<void> {
  const service = new StrategyTemplatesService() as any;
  const activities: Array<Record<string, unknown>> = [];
  const statusPayloads: Array<Record<string, unknown>> = [];
  const duplicatePayloads: Array<Record<string, unknown>> = [];

  Object.defineProperty(service, 'strategyTemplateRepository', {
    value: {
      async getStrategyTemplateById(userId: string, strategyId: string) {
        if (userId !== 'user-1' || strategyId !== 'template-1') {
          return null;
        }
        return {
          id: strategyId,
          userId,
          name: 'Momentum Core',
          description: 'Reusable momentum baseline',
          status: 'Active',
          templateVersion: 4,
          config: { market: 'crypto-futures' },
          createdAt: new Date('2026-04-01T00:00:00.000Z'),
          updatedAt: new Date('2026-04-03T00:00:00.000Z'),
        };
      },
      async listStrategyTemplateVersions(userId: string, strategyId: string) {
        assert.equal(userId, 'user-1');
        assert.equal(strategyId, 'template-1');
        return [
          {
            id: 'version-4',
            strategyTemplateId: strategyId,
            userId,
            actorUserId: userId,
            templateVersion: 4,
            changeType: 'status_changed',
            name: 'Momentum Core',
            description: 'Reusable momentum baseline',
            status: 'Active',
            config: { market: 'crypto-futures' },
            createdAt: new Date('2026-04-03T00:00:00.000Z'),
          },
          {
            id: 'version-1',
            strategyTemplateId: strategyId,
            userId,
            actorUserId: userId,
            templateVersion: 1,
            changeType: 'created',
            name: 'Momentum Core',
            description: 'Reusable momentum baseline',
            status: 'Draft',
            config: { market: 'crypto-futures' },
            createdAt: new Date('2026-04-01T00:00:00.000Z'),
          },
        ];
      },
      async updateStrategyTemplateStatus(
        userId: string,
        strategyId: string,
        payload: Record<string, unknown>
      ) {
        statusPayloads.push({ userId, strategyId, ...payload });
        return {
          id: strategyId,
          userId,
          name: 'Momentum Core',
          description: 'Reusable momentum baseline',
          status: String(payload.status || 'Draft'),
          templateVersion: 5,
          config: { market: 'crypto-futures' },
          createdAt: new Date('2026-04-01T00:00:00.000Z'),
          updatedAt: new Date('2026-04-04T00:00:00.000Z'),
        };
      },
      async duplicateStrategyTemplate(
        userId: string,
        strategyId: string,
        payload: Record<string, unknown>
      ) {
        duplicatePayloads.push({ userId, strategyId, ...payload });
        return {
          id: 'template-2',
          userId,
          name: String(payload.name || 'Momentum Core Copy'),
          description: 'Reusable momentum baseline',
          status: 'Draft',
          templateVersion: 1,
          config: { market: 'crypto-futures' },
          createdAt: new Date('2026-04-05T00:00:00.000Z'),
          updatedAt: new Date('2026-04-05T00:00:00.000Z'),
        };
      },
    },
  });

  Object.defineProperty(service, 'operationalEventService', {
    value: {
      async logActivity(userId: string, payload: Record<string, unknown>) {
        activities.push({ userId, ...payload });
      },
      async emitFailureAlert() {
        throw new Error('emitFailureAlert should not run for successful version actions');
      },
    },
  });

  const versionsResult = await service.listStrategyTemplateVersions('user-1', 'template-1');
  assert.equal(versionsResult.data.total, 2);
  assert.equal(versionsResult.data.items[0].changeType, 'status_changed');
  assert.equal(versionsResult.data.items[0].templateVersion, 4);
  assert.equal(versionsResult.data.items[1].changeType, 'created');

  const statusResult = await service.updateStrategyTemplateStatus('user-1', 'template-1', {
    status: 'Paused',
  });
  assert.equal(statusPayloads.length, 1);
  assert.deepEqual(statusPayloads[0], {
    userId: 'user-1',
    strategyId: 'template-1',
    status: 'Paused',
  });
  assert.equal(statusResult.data.status, 'Paused');
  assert.equal(statusResult.data.templateVersion, 5);

  const duplicateResult = await service.duplicateStrategyTemplate('user-1', 'template-1', {
    name: 'Momentum Core Copy',
  });
  assert.equal(duplicatePayloads.length, 1);
  assert.deepEqual(duplicatePayloads[0], {
    userId: 'user-1',
    strategyId: 'template-1',
    name: 'Momentum Core Copy',
    targetUserId: undefined,
  });
  assert.equal(duplicateResult.data.name, 'Momentum Core Copy');
  assert.equal(duplicateResult.data.status, 'Draft');
  assert.equal(duplicateResult.data.templateVersion, 1);

  assert.equal(activities.length, 2);
  assert.match(String(activities[0].title || ''), /paused/i);
  assert.match(String(activities[1].title || ''), /duplicated/i);
}

function runBacktestStatusMappingAssertions(): void {
  const service = new BacktestReadModelService() as any;
  const stableMapped = service.mapBacktest({
    id: 'backtest-status-1',
    name: 'Stable Run',
    strategy: 'Momentum Core',
    symbol: 'BTCUSDT',
    parameter: 'Momentum Core | BTCUSDT | 1h',
    status: 'Stable',
    stability: null,
    trades: 12,
    result: {
      cagr: 12.3,
      sharpe: 1.45,
      drawdown: 8.1,
      winRate: 57,
      profitFactor: 1.7,
      config: null,
    },
    createdAt: new Date('2026-04-02T00:00:00.000Z'),
  });

  assert.equal(stableMapped.status, 'Stable');
  assert.equal(stableMapped.runStatus, 'Completed');
  assert.equal(stableMapped.assessmentStatus, 'Stable');
  assert.equal(stableMapped.stability, 'Stable');
  assert.equal(stableMapped.lineage, null);

  const runningMapped = service.mapBacktest({
    id: 'backtest-status-2',
    name: 'Queued Run',
    strategy: 'Breakout Core',
    symbol: 'ETHUSDT',
    parameter: 'Breakout Core | ETHUSDT | 15m',
    status: 'Running',
    stability: 'Queued',
    trades: 0,
    result: {
      cagr: null,
      sharpe: null,
      drawdown: null,
      winRate: null,
      profitFactor: null,
      config: null,
    },
    createdAt: new Date('2026-04-02T00:00:00.000Z'),
  });

  assert.equal(runningMapped.runStatus, 'Running');
  assert.equal(runningMapped.assessmentStatus, '--');
  assert.equal(runningMapped.stability, '--');
  assert.equal(runningMapped.lineage, null);

  const diffMapped = service.mapBacktest({
    id: 'backtest-status-3',
    name: 'Diff Run',
    strategy: 'Momentum Core',
    symbol: 'SOLUSDT',
    parameter: 'Momentum Core | SOLUSDT | 15m',
    status: 'Completed',
    stability: 'Stable',
    trades: 5,
    result: {
      cagr: 7.2,
      sharpe: 1.2,
      drawdown: 4.5,
      winRate: 55,
      profitFactor: 1.4,
      config: {
        inputSnapshot: {
          templateDiffSummary: {
            changedCount: 3,
            inheritedCount: 9,
            changedFields: ['Long entry logic', 'Max risk', 'AI filter'],
          },
        },
      },
    },
    createdAt: new Date('2026-04-02T00:00:00.000Z'),
  });

  assert.equal(diffMapped.templateDiffSummary?.changedCount, 3);
  assert.equal(diffMapped.templateDiffSummary?.changedFields?.[1], 'Max risk');
  assert.equal(diffMapped.lineage?.templateDiffSummary?.changedCount, 3);
  assert.equal(diffMapped.lineage?.templateDiffSummary?.changedFields?.[0], 'Long entry logic');

  const validated = validateUpdateBacktestResultBody({
    runStatus: 'Completed',
    assessmentStatus: 'Review',
    trades: 10,
  });
  assert.equal(validated.status, 'Completed');
  assert.equal(validated.stability, 'Review');
}

async function runBacktestChartServiceAssertions(): Promise<void> {
  const service = new BacktestChartService() as any;
  const backtest = {
    id: 'backtest-chart-1',
    userId: 'user-1',
    name: 'Chart Coverage',
    strategy: 'Momentum Core',
    symbol: 'BTCUSDT',
    parameter: 'Momentum Core / BTCUSDT / 1h',
    status: 'Completed',
    stability: 'Stable',
    trades: 3,
    createdAt: new Date('2026-04-03T10:00:00.000Z'),
    updatedAt: new Date('2026-04-03T10:10:00.000Z'),
    result: {
      config: {
        inputSnapshot: {
          start: '2026-04-01T00:00:00.000Z',
          end: '2026-04-03T00:00:00.000Z',
        },
        performanceSurface: {
          results: [
            {
              symbol: 'BTCUSDT',
              timeframe: '1h',
              total_trades: 5,
            },
            {
              symbol: 'ETHUSDT',
              timeframe: '1h',
              total_trades: 8,
            },
          ],
        },
      },
    },
  };

  service.backtestRepository = {
    getBacktestById: async (userId: string, backtestId: string) => {
      assert.equal(userId, 'user-1');
      assert.equal(backtestId, 'backtest-chart-1');
      return backtest;
    },
  };
  service.backtestTradeRepository = {
    listTrades: async (params: Record<string, unknown>) => {
      assert.deepEqual(params, {
        userId: 'user-1',
        backtestId: 'backtest-chart-1',
        symbol: 'BTCUSDT',
        interval: '1h',
      });
      return [
        {
          id: 'trade-1',
          symbol: 'BTCUSDT',
          interval: '1h',
          side: 'BUY',
          entryTime: new Date('2026-04-01T04:00:00.000Z'),
          entryPrice: '100.5',
          exitTime: new Date('2026-04-01T06:00:00.000Z'),
          exitPrice: '105.5',
        },
        {
          id: 'trade-2',
          symbol: 'BTCUSDT',
          interval: '1h',
          side: 'SELL',
          entryTime: new Date('2026-04-02T10:00:00.000Z'),
          entryPrice: '110.25',
          exitTime: null,
          exitPrice: null,
        },
        {
          id: 'trade-3',
          symbol: 'BTCUSDT',
          interval: '1h',
          side: 'BUY',
          entryTime: new Date('2026-03-20T10:00:00.000Z'),
          entryPrice: '90',
          exitTime: new Date('2026-03-20T12:00:00.000Z'),
          exitPrice: '93',
        },
      ];
    },
  };
  service.fetchCandles = async (
    symbol: string,
    intervalSeconds: number,
    window: { startTime: Date | null; lookbackDays: number; endTime: Date },
    limit?: number
  ) => {
    assert.equal(symbol, 'BTCUSDT');
    assert.equal(intervalSeconds, 3600);
    assert.equal(window.startTime?.toISOString(), '2026-04-01T00:00:00.000Z');
    assert.equal(window.endTime.toISOString(), '2026-04-03T00:00:00.000Z');
    assert.equal(window.lookbackDays, 2);
    assert.equal(limit, 250);
    return [
      {
        openTime: Date.parse('2026-04-01T00:00:00.000Z'),
        open: '100',
        high: '110',
        low: '95',
        close: '108',
        volume: '1000',
      },
    ];
  };

  const response = await service.getBacktestChart('user-1', 'backtest-chart-1', {
    symbol: 'btcusdt',
    interval: '1h',
    limit: '250',
  });

  assert.equal(response.data.symbol, 'BTCUSDT');
  assert.equal(response.data.interval, '1h');
  assert.equal(response.data.window.startTime, '2026-04-01T00:00:00.000Z');
  assert.equal(response.data.window.endTime, '2026-04-03T00:00:00.000Z');
  assert.equal(response.data.tradeCoverage.expectedTradeEvents, 5);
  assert.equal(response.data.tradeCoverage.storedTradeEvents, 3);
  assert.equal(response.data.tradeCoverage.chartTradeEvents, 2);
  assert.equal(response.data.tradeCoverage.missingTradeEvents, 2);
  assert.equal(response.data.tradeCoverage.hasIncompleteTradeHistory, true);
  assert.equal(response.data.trades.length, 2);
  assert.equal(response.data.trades[0].entryPrice, 100.5);
  assert.equal(response.data.trades[1].exitTime, null);
}

async function runBacktestRepositorySearchAssertions(): Promise<void> {
  const repository = new BacktestRepository();
  const originalGetRepository = strategyDataSource.getRepository.bind(strategyDataSource);
  const capturedWhereClauses: Array<{ clause: string; params?: Record<string, unknown> }> = [];
  const builder = {
    leftJoinAndSelect() {
      return this;
    },
    where(clause: string, params?: Record<string, unknown>) {
      capturedWhereClauses.push({ clause, params });
      return this;
    },
    orderBy() {
      return this;
    },
    skip() {
      return this;
    },
    take() {
      return this;
    },
    andWhere(clause: string, params?: Record<string, unknown>) {
      capturedWhereClauses.push({ clause, params });
      return this;
    },
    async getManyAndCount() {
      return [[], 0] as const;
    },
  };

  (strategyDataSource as any).getRepository = () => ({
    createQueryBuilder: () => builder,
  });

  try {
    const response = await repository.listBacktests('user-1', {
      limit: 20,
      offset: 5,
      status: 'Failed',
      search: ' BTC_100% ',
    });

    assert.equal(response.total, 0);
    assert.equal(capturedWhereClauses.length, 3);
    assert.equal(capturedWhereClauses[0].clause, 'backtest.userId = :userId');
    assert.deepEqual(capturedWhereClauses[0].params, { userId: 'user-1' });
    assert.equal(capturedWhereClauses[1].clause, 'backtest.status = :status');
    assert.deepEqual(capturedWhereClauses[1].params, { status: 'Failed' });
    assert.equal(
      capturedWhereClauses[2].clause,
      "LOWER(CONCAT_WS(' ', backtest.name, backtest.strategy, backtest.symbol, backtest.parameter, backtest.status, backtest.stability)) LIKE :search ESCAPE '\\'"
    );
    assert.deepEqual(capturedWhereClauses[2].params, {
      search: '%btc\\_100\\%%',
    });
  } finally {
    (strategyDataSource as any).getRepository = originalGetRepository;
  }
}

async function runBacktestTopSetupCandidateQueryAssertions(): Promise<void> {
  const repository = new BacktestRepository();
  const originalGetRepository = strategyDataSource.getRepository.bind(strategyDataSource);
  const capturedWhereClauses: Array<{ clause: string; params?: Record<string, unknown> }> = [];
  const builder = {
    leftJoinAndSelect() {
      return this;
    },
    where(clause: string, params?: Record<string, unknown>) {
      capturedWhereClauses.push({ clause, params });
      return this;
    },
    andWhere(clause: string, params?: Record<string, unknown>) {
      capturedWhereClauses.push({ clause, params });
      return this;
    },
    orderBy() {
      return this;
    },
    async getMany() {
      return [];
    },
  };

  (strategyDataSource as any).getRepository = () => ({
    createQueryBuilder: () => builder,
  });

  try {
    const response = await repository.listTopSetupCandidateBacktests('user-99', {
      timeframe: '4h',
      minScore: 0.8,
      minTrades: 9,
      search: ' Momentum_100% ',
    });

    assert.deepEqual(response, []);
    assert.equal(capturedWhereClauses.length, 4);
    assert.equal(capturedWhereClauses[0].clause, 'backtest.userId = :userId');
    assert.deepEqual(capturedWhereClauses[0].params, { userId: 'user-99' });
    assert.equal(capturedWhereClauses[1].clause, 'result.id IS NOT NULL');
    assert.equal(
      capturedWhereClauses[2].clause,
      "LOWER(COALESCE(backtest.status, '')) IN (:...completedStatuses)"
    );
    assert.deepEqual(capturedWhereClauses[2].params, {
      completedStatuses: [
        'completed',
        'complete',
        'finished',
        'done',
        'success',
        'succeeded',
        'stable',
        'review',
      ],
    });
    assert.match(capturedWhereClauses[3].clause, /jsonb_array_length\(result\.config->'performanceSurface'->'results'\)/);
    assert.match(capturedWhereClauses[3].clause, /> 0$/);
  } finally {
    (strategyDataSource as any).getRepository = originalGetRepository;
  }
}

async function runStrategyTemplateSearchQueryAssertions(): Promise<void> {
  const repository = new StrategyTemplateRepository();
  const originalGetRepository = strategyDataSource.getRepository.bind(strategyDataSource);
  const capturedWhereClauses: Array<{ clause: string; params?: Record<string, unknown> }> = [];
  const builder = {
    where(clause: string, params?: Record<string, unknown>) {
      capturedWhereClauses.push({ clause, params });
      return this;
    },
    orderBy() {
      return this;
    },
    skip() {
      return this;
    },
    take() {
      return this;
    },
    andWhere(clause: string, params?: Record<string, unknown>) {
      capturedWhereClauses.push({ clause, params });
      return this;
    },
    async getManyAndCount() {
      return [[], 0] as const;
    },
  };

  (strategyDataSource as any).getRepository = () => ({
    createQueryBuilder: () => builder,
  });

  try {
    const response = await repository.listStrategyTemplates('user-1', {
      limit: 20,
      offset: 0,
      status: 'Active',
      search: ' Momentum_100% ',
    });

    assert.equal(response.total, 0);
    assert.equal(capturedWhereClauses.length, 3);
    assert.equal(capturedWhereClauses[0].clause, 'strategy.userId = :userId');
    assert.deepEqual(capturedWhereClauses[0].params, { userId: 'user-1' });
    assert.equal(capturedWhereClauses[1].clause, 'strategy.status = :status');
    assert.deepEqual(capturedWhereClauses[1].params, { status: 'Active' });
    assert.equal(
      capturedWhereClauses[2].clause,
      "LOWER(COALESCE(strategy.name, '') || ' ' || COALESCE(strategy.description, '')) LIKE :search ESCAPE '\\'"
    );
    assert.deepEqual(capturedWhereClauses[2].params, {
      search: '%momentum\\_100\\%%',
    });
  } finally {
    (strategyDataSource as any).getRepository = originalGetRepository;
  }
}

async function runStrategyLibrarySearchQueryAssertions(): Promise<void> {
  const repository = new StrategyLibraryRepository();
  const originalGetRepository = strategyDataSource.getRepository.bind(strategyDataSource);
  const capturedWhereClauses: Array<{ clause: string; params?: Record<string, unknown> }> = [];
  const capturedJoins: Array<{ table: string; alias: string; condition?: string }> = [];
  const builder = {
    where(clause: string, params?: Record<string, unknown>) {
      capturedWhereClauses.push({ clause, params });
      return this;
    },
    leftJoin(table: string, alias: string, condition?: string) {
      capturedJoins.push({ table, alias, condition });
      return this;
    },
    orderBy() {
      return this;
    },
    addOrderBy() {
      return this;
    },
    skip() {
      return this;
    },
    take() {
      return this;
    },
    andWhere(clause: string, params?: Record<string, unknown>) {
      capturedWhereClauses.push({ clause, params });
      return this;
    },
    async getManyAndCount() {
      return [[], 0] as const;
    },
  };

  (strategyDataSource as any).getRepository = () => ({
    createQueryBuilder: () => builder,
  });

  try {
    const response = await repository.listLibrary('user-1', {
      limit: 20,
      offset: 0,
      status: 'Draft',
      search: ' Runner_100% ',
      hasAssets: true,
      hasTimeframes: false,
    });

    assert.equal(response.total, 0);
    assert.equal(capturedJoins.length, 1);
    assert.deepEqual(capturedJoins[0], {
      table: 'strategy_templates',
      alias: 'template',
      condition: 'template.id = library.templateId AND template.userId = library.userId',
    });
    assert.equal(capturedWhereClauses.length, 5);
    assert.equal(capturedWhereClauses[0].clause, 'library.userId = :userId');
    assert.deepEqual(capturedWhereClauses[0].params, { userId: 'user-1' });
    assert.equal(capturedWhereClauses[1].clause, 'library.status = :status');
    assert.deepEqual(capturedWhereClauses[1].params, { status: 'Draft' });
    assert.equal(
      capturedWhereClauses[2].clause,
      "CASE WHEN library.assets IS NULL THEN 0 ELSE jsonb_array_length(library.assets) END > 0"
    );
    assert.equal(
      capturedWhereClauses[3].clause,
      "CASE WHEN library.timeframes IS NULL THEN 0 ELSE jsonb_array_length(library.timeframes) END = 0"
    );
    assert.equal(
      capturedWhereClauses[4].clause,
      "(LOWER(COALESCE(library.name, '')) LIKE :search ESCAPE '\\' OR LOWER(COALESCE(template.name, '') || ' ' || COALESCE(template.description, '')) LIKE :search ESCAPE '\\')"
    );
    assert.deepEqual(capturedWhereClauses[4].params, {
      search: '%runner\\_100\\%%',
    });
  } finally {
    (strategyDataSource as any).getRepository = originalGetRepository;
  }
}

async function runStrategyLibrarySignalScanStatusAssertions(): Promise<void> {
  const repository = new StrategyLibraryRepository();
  const originalGetRepository = strategyDataSource.getRepository.bind(strategyDataSource);
  const capturedWhereClauses: Array<{ clause: string; params?: Record<string, unknown> }> = [];
  const builder = {
    where(clause: string, params?: Record<string, unknown>) {
      capturedWhereClauses.push({ clause, params });
      return this;
    },
    andWhere(clause: string, params?: Record<string, unknown>) {
      capturedWhereClauses.push({ clause, params });
      return this;
    },
    orderBy() {
      return this;
    },
    take() {
      return this;
    },
    async getMany() {
      return [];
    },
  };

  (strategyDataSource as any).getRepository = () => ({
    createQueryBuilder: () => builder,
  });

  try {
    await repository.listForSignalScan('user-1', 5);

    assert.equal(capturedWhereClauses.length, 2);
    assert.equal(capturedWhereClauses[0].clause, 'library.userId = :userId');
    assert.deepEqual(capturedWhereClauses[0].params, { userId: 'user-1' });
    assert.equal(capturedWhereClauses[1].clause, 'library.status = :status');
    assert.deepEqual(capturedWhereClauses[1].params, { status: 'Active' });
  } finally {
    (strategyDataSource as any).getRepository = originalGetRepository;
  }
}

async function runAutomationScopeLookupAssertions(): Promise<void> {
  const repository = new AutomationRepository();
  const originalGetRepository = coreDataSource.getRepository.bind(coreDataSource);
  const capturedWhereClauses: Array<{ clause: string; params?: Record<string, unknown> }> = [];
  const builder = {
    where(clause: string, params?: Record<string, unknown>) {
      capturedWhereClauses.push({ clause, params });
      return this;
    },
    andWhere(clause: string, params?: Record<string, unknown>) {
      capturedWhereClauses.push({ clause, params });
      return this;
    },
    orderBy() {
      return this;
    },
    async getOne() {
      return {
        id: 'automation-match-1',
        sourceBacktestId: 'backtest-1',
        scopeSymbol: 'ETHUSDT',
        scopeTimeframe: '4h',
      };
    },
  };

  (coreDataSource as any).getRepository = () => ({
    createQueryBuilder: () => builder,
  });

  try {
    const automation = await repository.findTradeSuggestionAutomationByScope({
      userId: 'user-1',
      backtestId: 'backtest-1',
      symbol: 'ethusdt',
      timeframe: '4H',
    });

    assert.equal(automation?.id, 'automation-match-1');
    assert.deepEqual(capturedWhereClauses, [
      { clause: 'automation.userId = :userId', params: { userId: 'user-1' } },
      {
        clause: '(automation.automationType IN (:...automationTypes) OR automation.automationType IS NULL)',
        params: { automationTypes: ['trade-suggestion', 'strategy'] },
      },
      { clause: 'automation.sourceBacktestId = :backtestId', params: { backtestId: 'backtest-1' } },
      { clause: 'automation.scopeSymbol = :scopeSymbol', params: { scopeSymbol: 'ETHUSDT' } },
      { clause: 'automation.scopeTimeframe = :scopeTimeframe', params: { scopeTimeframe: '4h' } },
    ]);
  } finally {
    (coreDataSource as any).getRepository = originalGetRepository;
  }
}

async function runAutomationRepositorySearchAssertions(): Promise<void> {
  const repository = new AutomationRepository();
  const originalGetRepository = coreDataSource.getRepository.bind(coreDataSource);
  const capturedWhereClauses: Array<{ clause: string; params?: Record<string, unknown> }> = [];
  const builder = {
    where(clause: string, params?: Record<string, unknown>) {
      capturedWhereClauses.push({ clause, params });
      return this;
    },
    andWhere(clause: string, params?: Record<string, unknown>) {
      capturedWhereClauses.push({ clause, params });
      return this;
    },
    orderBy() {
      return this;
    },
    skip() {
      return this;
    },
    take() {
      return this;
    },
    async getManyAndCount() {
      return [[], 0] as const;
    },
  };

  (coreDataSource as any).getRepository = () => ({
    createQueryBuilder: () => builder,
  });

  try {
    const response = await repository.listAutomations({
      userId: 'user-1',
      limit: 20,
      offset: 5,
      status: 'Running',
      search: ' BTCUSDT_100% ',
    });

    assert.equal(response.total, 0);
    assert.equal(capturedWhereClauses.length, 3);
    assert.equal(capturedWhereClauses[0].clause, 'automation.userId = :userId');
    assert.deepEqual(capturedWhereClauses[0].params, { userId: 'user-1' });
    assert.equal(capturedWhereClauses[1].clause, 'automation.status = :status');
    assert.deepEqual(capturedWhereClauses[1].params, { status: 'Running' });
    assert.equal(
      capturedWhereClauses[2].clause,
      "(MATCH(automation.searchText) AGAINST (:search IN BOOLEAN MODE) OR LOWER(automation.searchText) LIKE :searchLike ESCAPE '\\' OR automation.scopeSymbol = :scopeSymbol OR automation.scopeTimeframe = :scopeTimeframe OR automation.sourceBacktestId = :scopeReference OR automation.sourceTemplateId = :scopeReference)"
    );
    assert.deepEqual(capturedWhereClauses[2].params, {
      search: '+btcusdt_100*',
      searchLike: '%btcusdt\\_100\\%%',
      scopeSymbol: 'BTCUSDT_100%',
      scopeTimeframe: 'btcusdt_100%',
      scopeReference: 'btcusdt_100%',
    });
  } finally {
    (coreDataSource as any).getRepository = originalGetRepository;
  }
}

async function runAutomationRepositoryIndexingAssertions(): Promise<void> {
  const repository = new AutomationRepository();
  const originalGetRepository = coreDataSource.getRepository.bind(coreDataSource);
  const createdPayloads: Array<Record<string, unknown>> = [];
  const savedPayloads: Array<Record<string, unknown>> = [];

  (coreDataSource as any).getRepository = () => ({
    create: (payload: Record<string, unknown>) => {
      createdPayloads.push({ ...payload });
      return { ...payload };
    },
    save: async (payload: Record<string, unknown>) => {
      savedPayloads.push({ ...payload });
      return payload;
    },
  });

  try {
    await repository.createAutomation({
      userId: 'user-1',
      name: 'Momentum BTC Runner',
      strategy: 'Momentum Base',
      broker: 'paper',
      market: 'crypto-futures',
      trigger: 'every 15m',
      status: 'Running',
      automationType: 'trade-suggestion',
      timeZone: 'Asia/Kolkata',
      schedule: { type: 'interval', scheduleMode: 'every_n_minutes', intervalMinutes: 15 },
      config: {
        backtestId: 'backtest-77',
        symbol: 'btcusdt',
        timeframe: '1H',
        sourceTemplateId: 'template-9',
        tradeSuggestion: {
          backtestId: 'backtest-77',
          symbol: 'BTCUSDT',
          timeframe: '1h',
          sourceTemplateId: 'template-9',
        },
      },
    });

    assert.equal(createdPayloads.length, 1);
    assert.equal(createdPayloads[0].sourceBacktestId, 'backtest-77');
    assert.equal(createdPayloads[0].scopeSymbol, 'BTCUSDT');
    assert.equal(createdPayloads[0].scopeTimeframe, '1h');
    assert.equal(createdPayloads[0].sourceTemplateId, 'template-9');
    assert.match(String(createdPayloads[0].searchText || ''), /Momentum BTC Runner/);
    assert.match(String(createdPayloads[0].searchText || ''), /BTCUSDT/);

    const automation = {
      id: 'automation-1',
      name: 'ETH Breakout Guard',
      strategy: 'Expansion Watch',
      broker: 'paper',
      market: 'crypto-futures',
      trigger: 'daily 09:30',
      status: 'Paused',
      automationType: 'trade-suggestion',
      timeZone: 'UTC',
      config: {
        tradeSuggestion: {
          backtestId: 'backtest-88',
          symbol: 'ethusdt',
          timeframe: '4H',
          sourceTemplateId: 'template-44',
        },
      },
    } as any;

    await repository.saveAutomation(automation);
    assert.equal(savedPayloads.length, 2);
    assert.equal(automation.sourceBacktestId, 'backtest-88');
    assert.equal(automation.scopeSymbol, 'ETHUSDT');
    assert.equal(automation.scopeTimeframe, '4h');
    assert.equal(automation.sourceTemplateId, 'template-44');
    assert.match(String(automation.searchText || ''), /ETHUSDT/);
  } finally {
    (coreDataSource as any).getRepository = originalGetRepository;
  }
}

async function runBacktestSummaryQueryAssertions(): Promise<void> {
  const repository = new BacktestRepository();
  const originalQuery = strategyDataSource.query.bind(strategyDataSource);
  let capturedSql = '';
  let capturedParams: unknown[] = [];

  (strategyDataSource as any).query = async (sql: string, params: unknown[]) => {
    capturedSql = sql;
    capturedParams = params;
    return [
      {
        active_runs: '3',
        best_cagr: '17.8',
        best_cagr_label: 'Momentum Core / BTCUSDT',
        best_sharpe: '1.66',
        max_drawdown: '9.4',
      },
    ];
  };

  try {
    const summary = await repository.getBacktestsSummary('user-summary-1');

    assert.equal(summary.activeRuns, 3);
    assert.equal(summary.bestCagr, 17.8);
    assert.equal(summary.bestCagrLabel, 'Momentum Core / BTCUSDT');
    assert.equal(summary.bestSharpe, 1.66);
    assert.equal(summary.maxDrawdown, 9.4);
    assert.deepEqual(capturedParams, ['user-summary-1']);
    assert.match(capturedSql, /WITH scoped_backtests AS/);
    assert.match(capturedSql, /WITH scoped_backtests AS[\s\S]*scoped_results AS/);
    assert.match(capturedSql, /status_lower IN \('queued', 'running', 'started', 'processing', 'in_progress', 'in-progress'\)/);
    assert.match(capturedSql, /best_cagr AS/);
    assert.match(capturedSql, /best_sharpe AS/);
    assert.match(capturedSql, /max_drawdown AS/);
  } finally {
    (strategyDataSource as any).query = originalQuery;
  }
}

function runBacktestOperationalColumnExtractionAssertions(): void {
  const repository = new BacktestRepository() as any;

  const populated = repository.buildOperationalResultColumns({
    tradeEventCount: '24',
    progress: {
      state: 'running',
      processed: '7',
      total: 18,
      percent: '38.9',
    },
    resumeCheckpoint: {
      state: 'failed',
    },
    performanceSurface: {
      results: [{ symbol: 'BTCUSDT' }, { symbol: 'ETHUSDT' }],
    },
  });

  assert.deepEqual(populated, {
    progressState: 'running',
    progressProcessed: 7,
    progressTotal: 18,
    progressPercent: 38.9,
    resumeCheckpointState: 'failed',
    tradeEventCount: 24,
    performanceSurfaceResultCount: 2,
  });

  const empty = repository.buildOperationalResultColumns(null);

  assert.deepEqual(empty, {
    progressState: null,
    progressProcessed: null,
    progressTotal: null,
    progressPercent: null,
    resumeCheckpointState: null,
    tradeEventCount: null,
    performanceSurfaceResultCount: null,
  });
}

async function runBacktestChartDelegationAssertions(): Promise<void> {
  const service = createBacktestsService();
  const capturedCalls: unknown[][] = [];

  service.backtestChartService = {
    getBacktestChart: async (...args: unknown[]) => {
      capturedCalls.push(args);
      return {
        success: true as const,
        data: {
          symbol: 'BTCUSDT',
          interval: '1h',
          window: {
            startTime: null,
            endTime: '2026-04-04T00:00:00.000Z',
            lookbackDays: 90,
          },
          candles: [],
          trades: [],
          tradeCoverage: {
            symbol: 'BTCUSDT',
            interval: '1h',
            expectedTradeEvents: null,
            storedTradeEvents: 0,
            chartTradeEvents: 0,
            missingTradeEvents: null,
            hasIncompleteTradeHistory: false,
          },
        },
      };
    },
  };

  const response = await service.getBacktestChart('user-1', 'backtest-1', {
    symbol: 'BTCUSDT',
    interval: '1h',
  });

  assert.deepEqual(capturedCalls, [
    ['user-1', 'backtest-1', { symbol: 'BTCUSDT', interval: '1h' }],
  ]);
  assert.equal(response.data.tradeCoverage.storedTradeEvents, 0);
}

function runBacktestTopSetupsServiceAssertions(): void {
  const service = new BacktestTopSetupsService();
  const primaryBacktest = {
    id: 'backtest-top-1',
    name: 'Momentum Winner',
    strategy: 'Momentum Core',
    symbol: 'BTCUSDT',
    parameter: 'Momentum Core / BTCUSDT / 1h',
    runStatus: 'Completed',
    sourceType: 'strategy_library',
    sourceId: 'library-1',
    libraryId: 'library-1',
    templateId: 'template-1',
    templateName: 'Momentum Template',
    templateVersion: 3,
    hasIncompleteTradeHistory: false,
    createdAt: '2026-04-05T00:00:00.000Z',
    performanceSurface: {
      generatedAt: '2026-04-05T00:15:00.000Z',
      results: [
        {
          symbol: 'BTCUSDT',
          timeframe: '1h',
          score: 0.91,
          total_trades: 12,
          win_rate: 58,
          profit_factor: 1.84,
          total_return_pct: 14.2,
          max_drawdown_pct: 5.1,
          robustness: {
            evaluationMethod: 'walk-forward-multi-split',
            robustnessScore: 0.88,
            walkForwardPassRate: 0.72,
            outOfSampleReturnPct: 9.1,
            averageOutOfSampleReturnPct: 8.4,
            worstOutOfSampleReturnPct: 2.2,
            promotionReady: true,
            reasons: [],
          },
          portfolioPressure: {
            pressureScore: 0.93,
            executedTradeRatio: 0.84,
            pressureState: 'healthy',
          },
        },
        {
          symbol: 'ETHUSDT',
          timeframe: '4h',
          score: 0.42,
          total_trades: 3,
          win_rate: 49,
          profit_factor: 1.1,
          total_return_pct: 3.8,
          max_drawdown_pct: 8.7,
        },
      ],
    },
  } as any;
  const duplicateBacktest = {
    ...primaryBacktest,
    id: 'backtest-top-2',
    name: 'Momentum Runner-Up',
    createdAt: '2026-04-04T00:00:00.000Z',
    performanceSurface: {
      generatedAt: '2026-04-04T00:15:00.000Z',
      results: [
        {
          symbol: 'BTCUSDT',
          timeframe: '1h',
          score: 0.73,
          total_trades: 9,
          win_rate: 54,
          profit_factor: 1.46,
          total_return_pct: 8.9,
          max_drawdown_pct: 6.4,
          robustness: {
            evaluationMethod: 'walk-forward-multi-split',
            robustnessScore: 0.74,
            walkForwardPassRate: 0.61,
            outOfSampleReturnPct: 5.4,
            averageOutOfSampleReturnPct: 5.1,
            worstOutOfSampleReturnPct: 1.2,
            promotionReady: true,
            reasons: [],
          },
          portfolioPressure: {
            pressureScore: 0.82,
            executedTradeRatio: 0.78,
            pressureState: 'moderate-pressure',
          },
        },
      ],
    },
  } as any;

  const ranked = service.rankBacktestTopSetups(primaryBacktest);
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].symbol, 'BTCUSDT');
  assert.equal(ranked[0].eligibleForAutomation, true);
  assert.equal(ranked[0].lineage?.sourceType, 'strategy_library');
  assert.equal(ranked[0].lineage?.libraryId, 'library-1');
  assert.equal(ranked[0].lineage?.templateId, 'template-1');
  assert.equal(ranked[1].symbol, 'ETHUSDT');
  assert.equal(ranked[1].eligibleForAutomation, false);
  assert.deepEqual(ranked[1].automationEligibilityReasons, [
    'low-score',
    'low-trade-count',
    'missing-robustness-validation',
  ]);

  const relaxedRanked = service.rankBacktestTopSetups(primaryBacktest, {
    ...createDefaultBacktestPromotionRules(),
    minScore: 0.4,
    minTrades: 3,
    requireRobustness: false,
  });
  const relaxedEthSetup = relaxedRanked.find((item) => item.symbol === 'ETHUSDT');
  assert.equal(relaxedEthSetup?.eligibleForAutomation, true);
  assert.deepEqual(relaxedEthSetup?.automationEligibilityReasons, []);

  const response = service.buildResponse([primaryBacktest, duplicateBacktest], {
    limit: '10',
    offset: '0',
    eligibleOnly: 'true',
  });

  assert.equal(response.total, 1);
  assert.equal(response.items.length, 1);
  assert.equal(response.items[0].backtestId, 'backtest-top-1');
  assert.equal(response.items[0].symbol, 'BTCUSDT');
  assert.equal(response.items[0].timeframe, '1h');
  assert.equal(response.items[0].lineage?.libraryId, 'library-1');
}

async function runBacktestTopSetupsDelegationAssertions(): Promise<void> {
  const service = createBacktestsService();
  type PromotionRulesCapture = {
    minScore?: number;
    minTrades?: number;
    requireRobustness?: boolean;
  };
  const capturedCalls: Array<{
    backtests: Record<string, unknown>[];
    query: Record<string, unknown>;
    promotionRules?: PromotionRulesCapture;
  }> = [];
  const capturedRepositoryQueries: Array<Record<string, unknown>> = [];
  service.appSettingsRepository = {
    async getSettings() {
      return {
        backtestPromotionRules: {
          minScore: 0.82,
          minTrades: 7,
          requireRobustness: false,
        },
      };
    },
  };
  const backtest = {
    id: 'backtest-delegate-1',
    name: 'Delegated Top Setup',
    strategy: 'Momentum Core',
    symbol: 'BTCUSDT',
    parameter: 'Momentum Core / BTCUSDT / 1h',
    status: 'Completed',
    stability: 'Stable',
    trades: 12,
    createdAt: new Date('2026-04-05T00:00:00.000Z'),
    result: {
      cagr: 10.5,
      sharpe: 1.3,
      drawdown: 6.1,
      winRate: 57,
      profitFactor: 1.7,
      config: {
        sourceType: 'strategy_library',
        sourceId: 'library-1',
        libraryId: 'library-1',
        inputSnapshot: {
          templateId: 'template-7',
          templateName: 'Momentum Template',
          templateVersion: 7,
        },
        performanceSurface: {
          generatedAt: '2026-04-05T00:15:00.000Z',
          results: [],
        },
        tradeEventCount: 11,
      },
    },
  };

  service.backtestRepository = {
    listTopSetupCandidateBacktests: async (_userId: string, query: Record<string, unknown>) => {
      capturedRepositoryQueries.push(query);
      return [backtest];
    },
  };
  service.backtestTradeRepository = {
    getTradeCountsByBacktest: async () => new Map([[backtest.id, 9]]),
  };
  service.backtestTopSetupsService = {
    buildResponse: (
      mappedBacktests: Record<string, unknown>[],
      query: Record<string, unknown>,
      promotionRules?: PromotionRulesCapture
    ) => {
      capturedCalls.push({ backtests: mappedBacktests, query, promotionRules });
      return {
        items: [],
        total: 0,
        limit: 5,
        offset: 0,
      };
    },
  };

  const response = await service.getTopSetups('user-1', {
    limit: 5,
    offset: 0,
    eligibleOnly: true,
  });

  assert.equal(response.data.total, 0);
  assert.equal(capturedRepositoryQueries.length, 1);
  assert.equal(capturedRepositoryQueries[0].eligibleOnly, true);
  assert.equal(capturedRepositoryQueries[0].minTrades, undefined);
  assert.equal(capturedRepositoryQueries[0].offset, 0);
  assert.equal(capturedCalls.length, 1);
  assert.equal(capturedCalls[0].query.eligibleOnly, true);
  assert.equal(capturedCalls[0].query.minTrades, undefined);
  assert.equal(capturedCalls[0].promotionRules?.minScore, 0.82);
  assert.equal(capturedCalls[0].promotionRules?.minTrades, 7);
  assert.equal(capturedCalls[0].promotionRules?.requireRobustness, false);
  assert.equal(capturedCalls[0].backtests.length, 1);
  assert.equal(capturedCalls[0].backtests[0].id, 'backtest-delegate-1');
  assert.equal(capturedCalls[0].backtests[0].runStatus, 'Completed');
  assert.equal(capturedCalls[0].backtests[0].storedTradeEvents, 9);
  assert.equal(capturedCalls[0].backtests[0].templateId, 'template-7');
  assert.equal(
    (capturedCalls[0].backtests[0].lineage as Record<string, unknown> | undefined)?.sourceType,
    'strategy_library'
  );
  assert.equal(
    (capturedCalls[0].backtests[0].lineage as Record<string, unknown> | undefined)?.templateId,
    'template-7'
  );
  assert.deepEqual(capturedCalls[0].backtests[0].performanceSurface, {
    generatedAt: '2026-04-05T00:15:00.000Z',
    results: [],
  });
}

async function runBacktestRecoveryServiceAssertions(): Promise<void> {
  const service = new BacktestRecoveryService();
  const backtest = {
    id: 'backtest-recovery-1',
    result: {
      config: {
        progress: {
          state: 'failed',
          processed: 4,
          total: 10,
          startedAt: '2026-04-02T10:00:00.000Z',
          failedCount: 1,
          resumedFromCheckpoint: 'false',
        },
        resumeCheckpoint: {
          state: 'failed',
          startedAt: '2026-04-02T10:00:00.000Z',
          lastUpdatedAt: '2026-04-02T10:10:00.000Z',
          completedCombinations: 6,
          totalCombinations: 12,
          tradeEventCount: 15,
          resumeCount: 2,
          resumedFromCheckpoint: true,
          resultsSummary: {
            okCount: 5,
            failedCount: 1,
            noDataCount: 0,
            skippedCount: 0,
          },
        },
      },
    },
  } as any;

  const plan = service.buildRecoveryPlan(
    backtest,
    'Failed',
    new Date('2026-04-05T08:00:00.000Z')
  );

  assert.equal(plan.message, 'Backtest re-queued from checkpoint');
  assert.equal(plan.status, 'Queued');
  assert.equal(plan.stability, 'Queued');
  assert.equal(plan.nextConfig.error, null);
  assert.equal((plan.nextConfig.progress as Record<string, unknown>).state, 'queued');
  assert.equal((plan.nextConfig.progress as Record<string, unknown>).processed, 6);
  assert.equal((plan.nextConfig.progress as Record<string, unknown>).total, 12);
  assert.equal((plan.nextConfig.progress as Record<string, unknown>).percent, 50);
  assert.equal((plan.nextConfig.progress as Record<string, unknown>).startedAt, '2026-04-02T10:00:00.000Z');
  assert.equal((plan.nextConfig.progress as Record<string, unknown>).updatedAt, '2026-04-05T08:00:00.000Z');
  assert.equal((plan.nextConfig.progress as Record<string, unknown>).okCount, 5);
  assert.equal((plan.nextConfig.progress as Record<string, unknown>).failedCount, 1);
  assert.equal((plan.nextConfig.progress as Record<string, unknown>).tradeEventCount, 15);
  assert.equal((plan.nextConfig.progress as Record<string, unknown>).resumeCount, 2);
  assert.equal((plan.nextConfig.progress as Record<string, unknown>).resumedFromCheckpoint, true);
  assert.equal((plan.nextConfig.resumeCheckpoint as Record<string, unknown>).state, 'queued');
  assert.equal(
    (plan.nextConfig.resumeCheckpoint as Record<string, unknown>).lastUpdatedAt,
    '2026-04-05T08:00:00.000Z'
  );

  await assert.rejects(
    async () =>
      service.buildRecoveryPlan(
        {
          id: 'backtest-recovery-2',
          result: {
            config: {
              resumeCheckpoint: {
                state: 'completed',
              },
            },
          },
        } as any,
        'Failed'
      ),
    /Completed backtests do not need checkpoint recovery/
  );
}

async function runBacktestInputSnapshotServiceAssertions(): Promise<void> {
  const service = new BacktestSnapshotService() as any;
  const backtest = {
    id: 'backtest-snapshot-1',
    name: 'Momentum Snapshot',
    strategy: 'Momentum Core',
    symbol: 'BTCUSDT',
    parameter: 'Momentum Core / BTCUSDT / 1h',
    status: 'Failed',
    stability: 'Needs review',
    trades: 14,
    createdAt: new Date('2026-04-03T10:00:00.000Z'),
    result: {
      cagr: 12.4,
      sharpe: 1.42,
      drawdown: 8.6,
      winRate: 57,
      profitFactor: 1.68,
      config: {
        sourceType: 'strategy_library',
        sourceId: 'library-1',
        libraryId: 'library-1',
        market: 'crypto-futures',
        benchmark: 'BTCUSDT',
        inputSnapshot: {
          sourceType: 'strategy_library',
          sourceId: 'library-1',
          libraryId: 'library-1',
          templateId: 'template-9',
          templateName: 'Momentum Template',
          templateVersion: 4,
          start: '2026-02-01T00:00:00.000Z',
          end: '2026-04-01T23:59:59.999Z',
        },
        templateDiffSummary: {
          changedCount: 2,
          inheritedCount: 11,
          changedFields: ['Long entry logic', 'Max risk'],
        },
        executionAssumptions: {
          spreadPct: 0.05,
          latencyBars: 1,
          fillPolicy: 'conservative-stop-first',
        },
        progress: {
          state: 'failed',
          processed: 9,
          total: 24,
        },
        resumeCheckpoint: {
          state: 'failed',
          completedCombinations: 9,
          totalCombinations: 24,
        },
        performanceSurface: {
          generatedAt: '2026-04-03T11:00:00.000Z',
        },
        portfolioSummary: {
          peakConcurrentTrades: 3,
        },
        tradeEventCount: 88,
      },
    },
  };

  const mappedBacktest = {
    id: 'backtest-snapshot-1',
    name: 'Momentum Snapshot',
    strategy: 'Momentum Core',
    symbol: 'BTCUSDT',
    parameter: 'Momentum Core / BTCUSDT / 1h',
    cagr: '12.4%',
    sharpe: '1.42',
    drawdown: '8.6%',
    trades: 14,
    status: 'Failed',
    runStatus: 'Failed',
    assessmentStatus: 'Needs review',
    winRate: '57%',
    profitFactor: '1.68',
    stability: 'Needs review',
    sourceType: 'strategy_library',
    sourceId: 'library-1',
    libraryId: 'library-1',
    templateId: 'template-9',
    templateName: 'Momentum Template',
    templateVersion: 4,
    sourceTemplateId: null,
    sourceTemplateName: null,
    sourceTemplateVersion: null,
    dateRangeStart: '2026-02-01T00:00:00.000Z',
    dateRangeEnd: '2026-04-01T23:59:59.999Z',
    templateDiffSummary: {
      changedCount: 2,
      inheritedCount: 11,
      changedFields: ['Long entry logic', 'Max risk'],
    },
    executionAssumptions: {
      spreadPct: 0.05,
      latencyBars: 1,
      fillPolicy: 'conservative-stop-first',
    },
    createdAt: '2026-04-03T10:00:00.000Z',
  } as any;
  const response = service.buildInputSnapshotResponse(
    backtest,
    mappedBacktest,
    '2026-04-05T07:30:00.000Z'
  );

  assert.equal(response.backtestId, 'backtest-snapshot-1');
  assert.equal(response.generatedAt, '2026-04-05T07:30:00.000Z');
  assert.match(response.fileName, /^backtest-input-snapshot-/);
  assert.equal(response.snapshot.schemaVersion, 1);
  assert.equal(response.snapshot.backtest.runStatus, 'Failed');
  assert.equal(response.snapshot.backtest.assessmentStatus, 'Needs review');
  assert.equal(response.snapshot.lineage.libraryId, 'library-1');
  assert.equal(response.snapshot.lineage.templateId, 'template-9');
  assert.equal(response.snapshot.lineage.templateDiffSummary?.changedCount, 2);
  assert.equal(response.snapshot.dateRange.start, '2026-02-01T00:00:00.000Z');
  assert.equal(response.snapshot.dateRange.end, '2026-04-01T23:59:59.999Z');
  assert.equal(
    response.snapshot.executionAssumptions?.fillPolicy,
    'conservative-stop-first'
  );
  assert.equal(
    (response.snapshot.inputs.inputSnapshot as Record<string, unknown>)?.templateId,
    'template-9'
  );
  assert.equal(response.snapshot.inputs.market, 'crypto-futures');
  assert.equal(response.snapshot.inputs.progress, undefined);
  assert.equal(response.snapshot.inputs.resumeCheckpoint, undefined);
  assert.equal(response.snapshot.inputs.performanceSurface, undefined);
  assert.equal(response.snapshot.inputs.portfolioSummary, undefined);
  assert.equal(response.snapshot.inputs.tradeEventCount, undefined);
}

async function runBacktestInputSnapshotDelegationAssertions(): Promise<void> {
  const service = createBacktestsService();
  const backtest = {
    id: 'backtest-snapshot-2',
    name: 'Recovery Snapshot',
    strategy: 'Trend Continuation',
    symbol: 'ETHUSDT',
    parameter: 'Trend Continuation / ETHUSDT / 4h',
    status: 'Failed',
    stability: 'Needs review',
    trades: 9,
    createdAt: new Date('2026-04-04T10:00:00.000Z'),
    result: {
      config: {
        sourceType: 'strategy_library',
        sourceId: 'library-2',
        libraryId: 'library-2',
        inputSnapshot: {
          templateId: 'template-21',
          templateName: 'Trend Continuation',
          templateVersion: 2,
          start: '2026-03-01T00:00:00.000Z',
          end: '2026-04-01T23:59:59.999Z',
        },
        executionAssumptions: {
          fillPolicy: 'best-effort',
        },
      },
    },
  };
  const capturedCalls: Array<{ backtest: unknown; mappedBacktest: any }> = [];

  service.backtestRepository = {
    getBacktestById: async () => backtest,
  };
  service.backtestSnapshotService = {
    buildInputSnapshotResponse: (capturedBacktest: unknown, mappedBacktest: Record<string, unknown>) => {
      capturedCalls.push({ backtest: capturedBacktest, mappedBacktest });
      return {
        backtestId: 'backtest-snapshot-2',
        fileName: 'delegated.json',
        generatedAt: '2026-04-05T08:00:00.000Z',
        snapshot: {
          schemaVersion: 1,
          exportedAt: '2026-04-05T08:00:00.000Z',
          backtest: {
            id: 'backtest-snapshot-2',
            name: 'Recovery Snapshot',
            parameter: 'Trend Continuation / ETHUSDT / 4h',
            strategy: 'Trend Continuation',
            symbol: 'ETHUSDT',
            status: 'Failed',
            runStatus: 'Failed',
            assessmentStatus: 'Needs review',
            createdAt: '2026-04-04T10:00:00.000Z',
          },
          lineage: {},
          dateRange: {},
          executionAssumptions: null,
          inputs: {},
        },
      };
    },
  };

  const response = await service.getBacktestInputSnapshot('user-1', 'backtest-snapshot-2');

  assert.equal(response.data.fileName, 'delegated.json');
  assert.equal(capturedCalls.length, 1);
  assert.equal(capturedCalls[0].backtest, backtest);
  assert.equal(capturedCalls[0].mappedBacktest.id, 'backtest-snapshot-2');
  assert.equal(capturedCalls[0].mappedBacktest.runStatus, 'Failed');
  assert.equal(capturedCalls[0].mappedBacktest.assessmentStatus, 'Needs review');
  assert.equal(capturedCalls[0].mappedBacktest.templateId, 'template-21');
  assert.equal(capturedCalls[0].mappedBacktest.lineage?.libraryId, 'library-2');
  assert.equal(capturedCalls[0].mappedBacktest.dateRangeStart, '2026-03-01T00:00:00.000Z');
  assert.equal(capturedCalls[0].mappedBacktest.dateRangeEnd, '2026-04-01T23:59:59.999Z');
  assert.equal(
    capturedCalls[0].mappedBacktest.executionAssumptions?.fillPolicy,
    'best-effort'
  );
}

async function runBacktestRecoveryDelegationAssertions(): Promise<void> {
  const service = createBacktestsService();
  const capturedRecoveryCalls: Array<{ backtest: unknown; runStatus: unknown }> = [];
  const backtest = {
    id: 'backtest-recovery-3',
    name: 'Recovery Runner',
    strategy: 'Trend Continuation',
    symbol: 'ETHUSDT',
    parameter: 'Trend Continuation / ETHUSDT / 4h',
    status: 'Failed',
    stability: 'Needs review',
    trades: 9,
    createdAt: new Date('2026-04-04T10:00:00.000Z'),
    result: {
      cagr: null,
      sharpe: null,
      drawdown: null,
      winRate: null,
      profitFactor: null,
      config: {
        resumeCheckpoint: {
          state: 'failed',
        },
      },
    },
  };
  const updatedBacktest = {
    ...backtest,
    status: 'Queued',
    stability: 'Queued',
    result: {
      ...backtest.result,
      config: {
        progress: {
          state: 'queued',
        },
        resumeCheckpoint: {
          state: 'queued',
        },
      },
    },
  };
  const activities: Array<Record<string, unknown>> = [];

  service.backtestRepository = {
    getBacktestById: async () => backtest,
    updateBacktestResult: async (
      userId: string,
      targetBacktestId: string,
      payload: Record<string, unknown>
    ) => {
      assert.equal(userId, 'user-1');
      assert.equal(targetBacktestId, 'backtest-recovery-3');
      assert.equal(payload.status, 'Queued');
      assert.equal(payload.stability, 'Queued');
      assert.equal((payload.config as Record<string, unknown>).progressProcessed, 4);
      return updatedBacktest;
    },
  };
  service.backtestTradeRepository = {
    getTradeCountsByBacktest: async () => new Map([['backtest-recovery-3', 3]]),
  };
  service.backtestRecoveryService = {
    buildRecoveryPlan: (capturedBacktest: unknown, runStatus: unknown) => {
      capturedRecoveryCalls.push({ backtest: capturedBacktest, runStatus });
      return {
        message: 'Backtest re-queued from checkpoint',
        status: 'Queued',
        stability: 'Queued',
        nextConfig: {
          progressProcessed: 4,
          progressTotal: 10,
          progress: {
            state: 'queued',
          },
          resumeCheckpoint: {
            state: 'queued',
          },
        },
      };
    },
  };
  service.operationalEventService = {
    logActivity: async (userId: string, payload: Record<string, unknown>) => {
      activities.push({ userId, ...payload });
    },
  };
  service.mapBacktest = (record: Record<string, unknown>) => ({
    id: record.id,
    runStatus: 'Queued',
    assessmentStatus: '--',
    status: 'Queued',
  });

  const response = await service.recoverBacktestFromCheckpoint('user-1', 'backtest-recovery-3');

  assert.equal(response.data.message, 'Backtest re-queued from checkpoint');
  assert.equal(response.data.backtest.id, 'backtest-recovery-3');
  assert.equal(response.data.backtest.runStatus, 'Queued');
  assert.equal(capturedRecoveryCalls.length, 1);
  assert.equal(capturedRecoveryCalls[0].backtest, backtest);
  assert.equal(capturedRecoveryCalls[0].runStatus, 'Failed');
  assert.equal(activities.length, 1);
  assert.equal(activities[0].referenceId, 'backtest-recovery-3');
}

async function runBacktestRecoveryFailureAlertAssertions(): Promise<void> {
  const service = createBacktestsService();
  const activities: Array<Record<string, unknown>> = [];
  const alerts: Array<Record<string, unknown>> = [];
  const backtest = {
    id: 'backtest-recovery-failure-1',
    name: 'Recovery Failure Candidate',
    status: 'Failed',
    stability: 'Failed',
    result: {
      config: {
        resumeCheckpoint: {
          state: 'failed',
        },
      },
    },
  };

  service.backtestRepository = {
    getBacktestById: async () => backtest,
  };
  service.backtestRecoveryService = {
    buildRecoveryPlan: () => {
      throw new Error('Checkpoint payload is corrupted');
    },
  };
  service.operationalEventService = {
    logActivity: async (userId: string, payload: Record<string, unknown>) => {
      activities.push({ userId, ...payload });
    },
    emitFailureAlert: async (userId: string, payload: Record<string, unknown>) => {
      alerts.push({ userId, ...payload });
    },
  };

  await assert.rejects(
    () => service.recoverBacktestFromCheckpoint('user-1', 'backtest-recovery-failure-1'),
    /Checkpoint payload is corrupted/
  );

  assert.equal(activities.length, 1);
  assert.equal(activities[0].title, 'Backtest recovery failed');
  assert.equal(activities[0].referenceId, 'backtest-recovery-failure-1');
  assert.equal(activities[0].stream, 'Runs');
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].channel, 'Backtests');
  assert.equal(alerts[0].source, 'backtests:recovery');
  assert.equal(alerts[0].route, 'Backtests');
  assert.match(String(alerts[0].message || ''), /Checkpoint payload is corrupted/);
}

async function runStrategyLabBacktestHandoffAssertions(): Promise<void> {
  const service = new StrategyLabService() as any;
  const queuedPayloads: Array<Record<string, unknown>> = [];
  const validationUpdates: Array<Record<string, unknown>> = [];
  const project = {
    id: 'proj-1',
    userId: 'user-1',
    name: 'Validated Draft',
    description: 'Ready for handoff',
    status: 'Draft',
    authoringMode: 'code',
    codeTarget: 'python',
    visualDefinition: null,
    codeDefinition: `from auralpha import Strategy

class StrategyDraft(Strategy):
    name = "Validated Draft"
    market = "crypto-futures"

    def entry(self, ctx):
        return ema(ctx, 20) > ema(ctx, 50)

    def exit(self, ctx):
        return ema(ctx, 20) < ema(ctx, 50)

    risk = {
        "max_per_trade": 1.5,
        "signal_threshold": 0.82,
        "stop_loss_pct": 1.2,
        "take_profit_pct": 2.6,
    }`,
    parameters: {
      signalThreshold: '0.88',
      signal_threshold: '0.88',
    },
    riskConfig: {
      maxRisk: '1.75',
      max_per_trade: '1.75',
      sizingNotes: 'Keep risk fixed',
    },
    validationState: 'idle',
    validationErrors: [],
    validationWarnings: [],
    lastValidatedAt: null,
    objective: 'probability-alpha',
    market: 'crypto-futures',
    timeframe: '15m',
    universe: 'top-25-liquidity',
    projectVersion: 3,
    sourceTemplateId: 'template-1',
    sourceTemplateVersion: 6,
    config: {
      codeDefinition: `from auralpha import Strategy

class StrategyDraft(Strategy):
    name = "Validated Draft"
    market = "crypto-futures"

    def entry(self, ctx):
        return ema(ctx, 20) > ema(ctx, 50)

    def exit(self, ctx):
        return ema(ctx, 20) < ema(ctx, 50)

    risk = {
        "max_per_trade": 1.5,
        "signal_threshold": 0.82,
        "stop_loss_pct": 1.2,
        "take_profit_pct": 2.6,
    }`,
      codeTarget: 'python',
      market: 'crypto-futures',
      entryLogic: 'ema(20) > ema(50)',
      exitLogic: 'ema(20) < ema(50)',
      shortEnabled: true,
      entryShortLogic: 'ema(20) < ema(50)',
      exitShortLogic: 'ema(20) > ema(50)',
      risk: {
        maxRisk: '1.75',
        max_per_trade: '1.75',
        sizingNotes: 'Keep risk fixed',
      },
      parameters: {
        signalThreshold: '0.88',
        signal_threshold: '0.88',
      },
      filters: {
        useAiFilter: true,
        useRegimeFilter: true,
        paperTradeFirst: true,
      },
      assets: [{ symbol: 'BTCUSDT', brokerKey: 'paper' }],
      timeframes: ['15m', '1h'],
      start: '2026-02-01',
      end: '2026-04-01',
      projectVersion: 3,
      sourceTemplateId: 'template-1',
      sourceTemplateVersion: 6,
      sourceTemplateName: 'Momentum Template',
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  service.strategyLabRepository = {
    getProjectById: async () => project,
    updateValidation: async (
      userId: string,
      projectId: string,
      validationState: string,
      validationErrors: unknown[],
      validationWarnings: unknown[],
      validatedAt: Date
    ) => {
      validationUpdates.push({
        userId,
        projectId,
        validationState,
        validationErrors,
        validationWarnings,
        validatedAt,
      });
      return project;
    },
  };
  service.strategyTemplateRepository = {
    getStrategyTemplateById: async () => ({
      id: 'template-1',
      userId: 'user-1',
      name: 'Momentum Template',
      description: 'Template baseline',
      status: 'Draft',
      templateVersion: 6,
      config: {
        codeTarget: 'python',
        market: 'crypto-futures',
        entryLogic: 'ema(10) > ema(30)',
        exitLogic: 'ema(10) < ema(30)',
        shortEnabled: false,
        risk: {
          maxRisk: '1.25',
          sizingNotes: 'Baseline sizing',
        },
        parameters: {
          signalThreshold: '0.75',
        },
        filters: {
          useAiFilter: false,
          useRegimeFilter: true,
          paperTradeFirst: true,
        },
        notes: 'Template notes',
      },
    }),
  };
  service.backtestRepository = {
    createQueuedBacktest: async (_userId: string, payload: Record<string, unknown>) => {
      queuedPayloads.push(payload);
      return {
        id: 'backtest-1',
        name: payload.name,
        strategy: payload.strategy,
        symbol: payload.symbol,
        parameter: payload.parameter,
        status: payload.status,
      };
    },
  };
  service.operationalEventService = {
    logActivity: async () => undefined,
    emitFailureAlert: async () => undefined,
  };

  const response = await service.sendStrategyLabToBacktests('user-1', {
    projectId: 'proj-1',
  });

  assert.equal(response.data.backtestId, 'backtest-1');
  assert.equal(validationUpdates.length, 1);
  assert.equal(validationUpdates[0]?.validationState, 'valid');
  assert.equal(queuedPayloads.length, 1);
  const config = queuedPayloads[0]?.config as Record<string, unknown>;
  assert.equal(config?.source, 'strategy_lab');
  assert.equal(config?.sourceType, 'strategy_lab');
  assert.equal(config?.sourceId, 'proj-1');
  assert.equal(config?.projectId, 'proj-1');
  assert.equal(config?.projectVersion, 3);
  assert.equal(config?.sourceTemplateId, 'template-1');
  assert.equal(config?.sourceTemplateVersion, 6);
  assert.equal(config?.sourceTemplateName, 'Momentum Template');
  assert.equal(config?.market, 'crypto-futures');
  const template = config?.template as Record<string, unknown>;
  assert.equal(template?.templateVersion, 3);
  assert.equal(template?.sourceTemplateId, 'template-1');
  assert.equal(template?.sourceTemplateVersion, 6);
  const templateConfig = template?.config as Record<string, unknown>;
  const risk = templateConfig?.risk as Record<string, unknown>;
  const parameters = templateConfig?.parameters as Record<string, unknown>;
  assert.equal(risk?.maxRisk, '1.75');
  assert.equal(risk?.stop_loss_pct, 1.2);
  assert.equal(risk?.take_profit_pct, 2.6);
  assert.equal(parameters?.signalThreshold, '0.88');
  assert.equal(templateConfig?.shortEnabled, true);
  assert.equal(templateConfig?.entryShortLogic, 'ema(20) < ema(50)');
  assert.equal(templateConfig?.exitShortLogic, 'ema(20) > ema(50)');
  const inputSnapshot = config?.inputSnapshot as Record<string, unknown>;
  assert.equal(inputSnapshot?.sourceType, 'strategy_lab');
  assert.equal(inputSnapshot?.projectId, 'proj-1');
  assert.equal(inputSnapshot?.projectVersion, 3);
  assert.equal(inputSnapshot?.templateVersion, 3);
  assert.equal(inputSnapshot?.sourceTemplateId, 'template-1');
  assert.equal(inputSnapshot?.sourceTemplateVersion, 6);
  assert.equal(inputSnapshot?.sourceTemplateName, 'Momentum Template');
  assert.equal(inputSnapshot?.market, 'crypto-futures');
  const templateDiffSummary = inputSnapshot?.templateDiffSummary as Record<string, unknown>;
  assert.equal(templateDiffSummary?.changedCount, 12);
  assert.equal(templateDiffSummary?.inheritedCount, 4);
  assert.equal(
    Array.isArray(templateDiffSummary?.changedFields) &&
      (templateDiffSummary?.changedFields as string[]).includes('Long entry logic'),
    true
  );
  assert.equal(
    Array.isArray(templateDiffSummary?.changedFields) &&
      (templateDiffSummary?.changedFields as string[]).includes('AI filter'),
    true
  );
}

async function runStrategyLibraryBacktestSnapshotAssertions(): Promise<void> {
  const service = new StrategyLibraryService() as any;
  const queuedPayloads: Array<Record<string, unknown>> = [];
  const template = {
    id: 'template-1',
    userId: 'user-1',
    name: 'Momentum Template',
    description: 'Library-ready template',
    status: 'Active',
    templateVersion: 8,
    config: {
      market: 'crypto-futures',
      codeTarget: 'python',
      codeDefinition: 'class MomentumTemplate(Strategy):\n    pass',
    },
    createdAt: new Date('2026-03-01T00:00:00.000Z'),
    updatedAt: new Date('2026-03-15T00:00:00.000Z'),
  };
  const record = {
    id: 'library-1',
    userId: 'user-1',
    templateId: 'template-1',
    name: 'Momentum Runner',
    status: 'Active',
    assets: [{ symbol: 'BTCUSDT', brokerKey: 'paper' }],
    timeframes: ['15m', '1h'],
    overrides: {
      maxPositions: 2,
      start: '2026-01-01',
      end: '2026-01-31',
    },
    createdAt: new Date('2026-03-20T00:00:00.000Z'),
    updatedAt: new Date('2026-03-21T00:00:00.000Z'),
  };

  service.strategyLibraryRepository = {
    getById: async () => record,
  };
  service.strategyTemplateRepository = {
    getStrategyTemplateById: async () => template,
  };
  service.backtestRepository = {
    createQueuedBacktest: async (_userId: string, payload: Record<string, unknown>) => {
      queuedPayloads.push(payload);
      return {
        id: 'backtest-library-1',
        name: payload.name,
        strategy: payload.strategy,
        symbol: payload.symbol,
        parameter: payload.parameter,
        status: payload.status,
      };
    },
  };
  service.operationalEventService = {
    logActivity: async () => undefined,
    emitFailureAlert: async () => undefined,
  };

  const response = await service.runLibraryStrategy('user-1', 'library-1', {
    assets: [
      { symbol: 'ETHUSDT', brokerKey: 'paper' },
      { symbol: 'SOLUSDT', brokerKey: 'paper' },
    ],
    timeframes: ['4h'],
    overrides: { maxPositions: 5, market: 'crypto-spot' },
    start: '2026-02-01',
    end: '2026-04-01',
  });

  assert.equal(response.data.backtestId, 'backtest-library-1');
  assert.equal(response.data.id, 'library-1');
  assert.equal(response.data.status, 'queued');
  assert.equal(response.data.message, 'Backtest queued with current configuration');
  assert.equal(Object.prototype.hasOwnProperty.call(response.data, 'assets'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(response.data, 'timeframes'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(response.data, 'overrides'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(response.data, 'start'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(response.data, 'end'), false);
  assert.equal(queuedPayloads.length, 1);
  const config = queuedPayloads[0]?.config as Record<string, unknown>;
  assert.equal(config?.source, 'strategy_library');
  assert.equal(config?.sourceType, 'strategy_library');
  assert.equal(config?.sourceId, 'library-1');
  assert.equal(config?.libraryId, 'library-1');
  assert.equal(config?.templateId, 'template-1');
  assert.equal(config?.templateVersion, 8);
  assert.equal(config?.market, 'crypto-spot');
  assert.deepEqual(config?.assets, [
    { symbol: 'ETHUSDT', brokerKey: 'paper' },
    { symbol: 'SOLUSDT', brokerKey: 'paper' },
  ]);
  assert.deepEqual(config?.timeframes, ['4h']);
  assert.deepEqual(config?.overrides, { maxPositions: 5, market: 'crypto-spot' });
  assert.equal(config?.start, '2026-02-01T00:00:00.000Z');
  assert.equal(config?.end, '2026-04-01T23:59:59.999Z');
  const queuedTemplate = config?.template as Record<string, unknown>;
  assert.equal(queuedTemplate?.id, 'template-1');
  assert.equal(queuedTemplate?.name, 'Momentum Template');
  assert.equal(queuedTemplate?.templateVersion, 8);
  const inputSnapshot = config?.inputSnapshot as Record<string, unknown>;
  assert.equal(inputSnapshot?.sourceType, 'strategy_library');
  assert.equal(inputSnapshot?.libraryId, 'library-1');
  assert.equal(inputSnapshot?.templateId, 'template-1');
  assert.equal(inputSnapshot?.templateVersion, 8);
  assert.equal(inputSnapshot?.libraryName, 'Momentum Runner');
  assert.equal(inputSnapshot?.templateName, 'Momentum Template');
  assert.equal(inputSnapshot?.market, 'crypto-spot');
  assert.deepEqual(inputSnapshot?.assets, [
    { symbol: 'ETHUSDT', brokerKey: 'paper' },
    { symbol: 'SOLUSDT', brokerKey: 'paper' },
  ]);
  assert.deepEqual(inputSnapshot?.timeframes, ['4h']);
  assert.deepEqual(inputSnapshot?.overrides, { maxPositions: 5, market: 'crypto-spot' });
  assert.equal(inputSnapshot?.start, '2026-02-01T00:00:00.000Z');
  assert.equal(inputSnapshot?.end, '2026-04-01T23:59:59.999Z');
  assert.deepEqual(record.assets, [{ symbol: 'BTCUSDT', brokerKey: 'paper' }]);
  assert.deepEqual(record.timeframes, ['15m', '1h']);
  assert.deepEqual(record.overrides, {
    maxPositions: 2,
    start: '2026-01-01',
    end: '2026-01-31',
  });
}

async function runStrategyLibraryLifecycleGuardAssertions(): Promise<void> {
  const service = new StrategyLibraryService() as any;
  const archivedRecord = {
    id: 'library-archived',
    userId: 'user-1',
    templateId: 'template-1',
    name: 'Archived Runner',
    status: 'Archived',
    assets: [{ symbol: 'BTCUSDT', brokerKey: 'paper' }],
    timeframes: ['1h'],
    overrides: null,
    createdAt: new Date('2026-04-01T00:00:00.000Z'),
    updatedAt: new Date('2026-04-02T00:00:00.000Z'),
  };

  service.strategyLibraryRepository = {
    getById: async () => archivedRecord,
    updateLibrary: async () => {
      throw new Error('updateLibrary should not be called for archived entries');
    },
  };
  service.operationalEventService = {
    logActivity: async () => undefined,
    emitFailureAlert: async () => undefined,
  };

  await assert.rejects(
    () =>
      service.updateLibrary('user-1', 'library-archived', {
        name: 'Archived Runner v2',
      }),
    /read-only/
  );

  await assert.rejects(
    () => service.runLibraryStrategy('user-1', 'library-archived', {}),
    /cannot be run/
  );
}

async function runStrategyLibraryStatusUpdateAssertions(): Promise<void> {
  const service = new StrategyLibraryService() as any;
  const events: Array<Record<string, unknown>> = [];
  const template = {
    id: 'template-1',
    userId: 'user-1',
    name: 'Momentum Template',
    description: 'Trend-following template',
    status: 'Active',
    templateVersion: 5,
    config: {
      editorMode: 'rule-based',
      entryLogic: 'ema(20) > ema(50)',
      exitLogic: 'ema(20) < ema(50)',
      market: 'crypto-futures',
    },
  };
  const draftRecord = {
    id: 'library-1',
    userId: 'user-1',
    templateId: 'template-1',
    name: 'Momentum Runner',
    status: 'Draft',
    assets: [{ symbol: 'BTCUSDT', brokerKey: 'paper' }],
    timeframes: ['1h'],
    overrides: null,
    createdAt: new Date('2026-04-01T00:00:00.000Z'),
    updatedAt: new Date('2026-04-02T00:00:00.000Z'),
  };

  service.strategyLibraryRepository = {
    getById: async () => draftRecord,
    updateLibraryStatus: async (_userId: string, _id: string, payload: Record<string, unknown>) => ({
      ...draftRecord,
      status: payload.status,
      updatedAt: new Date('2026-04-03T00:00:00.000Z'),
    }),
  };
  service.strategyTemplateRepository = {
    getStrategyTemplateById: async () => template,
  };
  service.backtestRepository = {
    getLatestStrategyLibraryBacktests: async () =>
      new Map([
        [
          'library-1',
          {
            libraryId: 'library-1',
            backtestId: 'backtest-9',
            status: 'Completed',
            createdAt: new Date('2026-04-02T10:00:00.000Z'),
            updatedAt: new Date('2026-04-02T10:05:00.000Z'),
          },
        ],
      ]),
  };
  service.operationalEventService = {
    logActivity: async (_userId: string, payload: Record<string, unknown>) => {
      events.push(payload);
    },
    emitFailureAlert: async () => undefined,
  };

  const response = await service.updateLibraryStatus('user-1', 'library-1', {
    status: 'Active',
  });

  assert.equal(response.data.status, 'Active');
  assert.equal(response.data.lifecycle.canEdit, true);
  assert.equal(response.data.lifecycle.canRunManually, true);
  assert.equal(response.data.lifecycle.scheduledSignalsEnabled, true);
  assert.deepEqual(response.data.lifecycle.allowedTransitions, ['Paused', 'Archived']);
  assert.equal(response.data.latestRun?.backtestId, 'backtest-9');
  assert.equal(response.data.latestRun?.status, 'Completed');
  assert.equal(events.length, 1);
  assert.equal(events[0]?.description, 'Strategy library entry moved to Active');

  await assert.rejects(
    () =>
      service.updateLibraryStatus('user-1', 'library-1', {
        status: 'Paused',
      }),
    /cannot move from Draft to Paused/
  );
}

async function runStrategyLibraryImportConflictAssertions(): Promise<void> {
  const service = new StrategyLibraryService() as any;
  const duplicateRecord = {
    id: 'library-duplicate',
    userId: 'user-1',
    templateId: 'template-1',
    name: 'Momentum Runner',
    status: 'Draft',
    assets: null,
    timeframes: null,
    overrides: null,
    createdAt: new Date('2026-04-01T00:00:00.000Z'),
    updatedAt: new Date('2026-04-02T00:00:00.000Z'),
  };
  const existingRecord = {
    id: 'library-1',
    userId: 'user-1',
    templateId: 'template-1',
    name: 'Alpha Runner',
    status: 'Draft',
    assets: [{ symbol: 'BTCUSDT', brokerKey: 'paper' }],
    timeframes: ['1h'],
    overrides: null,
    createdAt: new Date('2026-04-01T00:00:00.000Z'),
    updatedAt: new Date('2026-04-02T00:00:00.000Z'),
  };
  let createCalled = false;
  let updateCalled = false;

  service.strategyLibraryRepository = {
    getById: async () => existingRecord,
    findByTemplateAndNormalizedName: async (
      _userId: string,
      templateId: string,
      name: string,
      excludeId?: string
    ) => {
      assert.equal(templateId, 'template-1');
      assert.equal(String(name).trim().toLowerCase(), 'momentum runner');
      if (excludeId) {
        assert.equal(excludeId, 'library-1');
      }
      return duplicateRecord;
    },
    createLibrary: async () => {
      createCalled = true;
      throw new Error('createLibrary should not be called for duplicate imports');
    },
    updateLibrary: async () => {
      updateCalled = true;
      throw new Error('updateLibrary should not be called for duplicate renames');
    },
  };
  service.strategyTemplateRepository = {
    getStrategyTemplateById: async () => ({
      id: 'template-1',
      userId: 'user-1',
      name: 'Momentum Template',
      description: 'Trend-following template',
      status: 'Active',
      templateVersion: 5,
      config: {
        market: 'crypto-futures',
      },
    }),
  };
  service.operationalEventService = {
    logActivity: async () => undefined,
    emitFailureAlert: async () => undefined,
  };

  await assert.rejects(
    () =>
      service.importTemplate('user-1', {
        templateId: 'template-1',
        name: '  Momentum Runner  ',
      }),
    /already exists/
  );

  await assert.rejects(
    () =>
      service.updateLibrary('user-1', 'library-1', {
        name: ' Momentum Runner ',
      }),
    /already exists/
  );

  assert.equal(createCalled, false);
  assert.equal(updateCalled, false);
}

async function runStrategyLibraryRunDateValidationAssertions(): Promise<void> {
  const service = new StrategyLibraryService() as any;
  const recordWithInvalidSavedDate = {
    id: 'library-1',
    userId: 'user-1',
    templateId: 'template-1',
    name: 'Momentum Runner',
    status: 'Active',
    assets: [{ symbol: 'BTCUSDT', brokerKey: 'paper' }],
    timeframes: ['1h'],
    overrides: {
      start: 'not-a-real-date',
    },
    createdAt: new Date('2026-04-01T00:00:00.000Z'),
    updatedAt: new Date('2026-04-02T00:00:00.000Z'),
  };

  service.strategyLibraryRepository = {
    getById: async () => recordWithInvalidSavedDate,
  };
  service.strategyTemplateRepository = {
    getStrategyTemplateById: async () => ({
      id: 'template-1',
      userId: 'user-1',
      name: 'Momentum Template',
      description: 'Trend-following template',
      status: 'Active',
      templateVersion: 5,
      config: {
        market: 'crypto-futures',
      },
    }),
  };
  service.backtestRepository = {
    createQueuedBacktest: async () => {
      throw new Error('createQueuedBacktest should not be called for invalid dates');
    },
  };
  service.operationalEventService = {
    logActivity: async () => undefined,
    emitFailureAlert: async () => undefined,
  };

  await assert.rejects(
    () =>
      service.runLibraryStrategy('user-1', 'library-1', {
        start: 'not-a-real-date',
      }),
    /start must be a valid date or datetime string/
  );

  await assert.rejects(
    () => service.runLibraryStrategy('user-1', 'library-1', {}),
    /start must be a valid date or datetime string/
  );
}

async function runStrategyLibraryPersistenceConstraintAssertions(): Promise<void> {
  const duplicateError = new Error(
    'duplicate key value violates unique constraint "uidx_strategy_library_user_template_name_ci"'
  ) as Error & {
    code?: string;
    constraint?: string;
  };
  duplicateError.code = '23505';
  duplicateError.constraint = 'uidx_strategy_library_user_template_name_ci';

  const foreignKeyError = new Error(
    'insert or update on table "strategy_library" violates foreign key constraint "fk_strategy_library_user_template_owner"'
  ) as Error & {
    code?: string;
    constraint?: string;
  };
  foreignKeyError.code = '23503';
  foreignKeyError.constraint = 'fk_strategy_library_user_template_owner';

  const template = {
    id: 'template-1',
    userId: 'user-1',
    name: 'Momentum Template',
    description: 'Trend-following template',
    status: 'Active',
    templateVersion: 5,
    config: {
      market: 'crypto-futures',
    },
  };
  const existingRecord = {
    id: 'library-1',
    userId: 'user-1',
    templateId: 'template-1',
    name: 'Alpha Runner',
    status: 'Draft',
    assets: [{ symbol: 'BTCUSDT', brokerKey: 'paper' }],
    timeframes: ['1h'],
    overrides: null,
    createdAt: new Date('2026-04-01T00:00:00.000Z'),
    updatedAt: new Date('2026-04-02T00:00:00.000Z'),
  };

  const duplicateImportService = new StrategyLibraryService() as any;
  duplicateImportService.strategyLibraryRepository = {
    findByTemplateAndNormalizedName: async () => null,
    createLibrary: async () => {
      throw duplicateError;
    },
  };
  duplicateImportService.strategyTemplateRepository = {
    getStrategyTemplateById: async () => template,
  };
  duplicateImportService.operationalEventService = {
    logActivity: async () => undefined,
    emitFailureAlert: async () => undefined,
  };

  await assert.rejects(
    () =>
      duplicateImportService.importTemplate('user-1', {
        templateId: 'template-1',
        name: ' Momentum Runner ',
      }),
    /already exists/
  );

  const duplicateUpdateService = new StrategyLibraryService() as any;
  duplicateUpdateService.strategyLibraryRepository = {
    getById: async () => existingRecord,
    findByTemplateAndNormalizedName: async () => null,
    updateLibrary: async () => {
      throw duplicateError;
    },
  };
  duplicateUpdateService.strategyTemplateRepository = {
    getStrategyTemplateById: async () => template,
  };
  duplicateUpdateService.operationalEventService = {
    logActivity: async () => undefined,
    emitFailureAlert: async () => undefined,
  };

  await assert.rejects(
    () =>
      duplicateUpdateService.updateLibrary('user-1', 'library-1', {
        name: ' Momentum Runner ',
      }),
    /already exists/
  );

  const missingTemplateService = new StrategyLibraryService() as any;
  missingTemplateService.strategyLibraryRepository = {
    findByTemplateAndNormalizedName: async () => null,
    createLibrary: async () => {
      throw foreignKeyError;
    },
  };
  missingTemplateService.strategyTemplateRepository = {
    getStrategyTemplateById: async () => template,
  };
  missingTemplateService.operationalEventService = {
    logActivity: async () => undefined,
    emitFailureAlert: async () => undefined,
  };

  await assert.rejects(
    () =>
      missingTemplateService.importTemplate('user-1', {
        templateId: 'template-1',
        name: 'Recovered Runner',
      }),
    /Strategy template not found/
  );
}

async function runStrategyLibraryTemplateMappingAssertions(): Promise<void> {
  const service = new StrategyLibraryService() as any;
  const record = {
    id: 'library-1',
    userId: 'user-1',
    templateId: 'template-1',
    name: 'Momentum Runner',
    status: 'Active',
    assets: [{ symbol: 'BTCUSDT', brokerKey: 'paper' }],
    timeframes: ['1h'],
    overrides: { required: true, maxPositions: 2 },
    createdAt: new Date('2026-04-01T00:00:00.000Z'),
    updatedAt: new Date('2026-04-02T00:00:00.000Z'),
  };
  const template = {
    id: 'template-1',
    userId: 'user-1',
    name: 'Momentum Template',
    description: 'Trend-following template',
    status: 'Active',
    templateVersion: 5,
    config: {
      editorMode: 'rule-based',
      entryLogic: 'ema(20) > ema(50)',
      exitLogic: 'ema(20) < ema(50)',
      market: 'crypto-futures',
    },
  };

  service.strategyLibraryRepository = {
    async listLibrary() {
      return {
        data: [record],
        total: 1,
      };
    },
  };
  service.strategyTemplateRepository = {
    async listStrategyTemplatesByIds(_userId: string, templateIds: string[]) {
      assert.deepEqual(templateIds, ['template-1']);
      return [template];
    },
  };
  service.backtestRepository = {
    async getLatestStrategyLibraryBacktests(_userId: string, libraryIds: string[]) {
      assert.deepEqual(libraryIds, ['library-1']);
      return new Map([
        [
          'library-1',
          {
            libraryId: 'library-1',
            backtestId: 'backtest-42',
            status: 'Failed',
            createdAt: new Date('2026-04-03T08:00:00.000Z'),
            updatedAt: new Date('2026-04-03T08:12:00.000Z'),
          },
        ],
      ]);
    },
  };

  const response = await service.listLibrary('user-1', { limit: '10', offset: '0' });
  const item = response.data.items[0];

  assert.equal(item.templateName, 'Momentum Template');
  assert.equal(item.templateVersion, 5);
  assert.equal(item.templateType, 'Rule-based');
  assert.equal(item.templateAutomationReady, true);
  assert.equal(
    Array.isArray(item.templateAutomationReasons),
    true
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(item.overrides ?? {}, 'required'),
    false
  );
  assert.equal(item.lifecycle.canEdit, true);
  assert.equal(item.lifecycle.canRunManually, true);
  assert.equal(item.lifecycle.scheduledSignalsEnabled, true);
  assert.equal(
    item.lifecycle.summary,
    'Active entries stay editable, can be run manually, and are included in scheduled strategy-library signal scans.'
  );
  assert.equal(item.latestRun?.backtestId, 'backtest-42');
  assert.equal(item.latestRun?.status, 'Failed');
  assert.equal(item.latestRun?.createdAt, '2026-04-03T08:00:00.000Z');
  assert.equal(item.latestRun?.updatedAt, '2026-04-03T08:12:00.000Z');
  assert.equal(item.recentRuns, undefined);
}

async function runStrategyLibraryDerivedListFilteringAssertions(): Promise<void> {
  const service = new StrategyLibraryService() as any;
  const records = [
    {
      id: 'library-1',
      userId: 'user-1',
      templateId: 'template-1',
      name: 'Alpha Runner',
      status: 'Active',
      assets: [{ symbol: 'BTCUSDT', brokerKey: 'paper' }],
      timeframes: ['1h'],
      overrides: null,
      createdAt: new Date('2026-04-01T00:00:00.000Z'),
      updatedAt: new Date('2026-04-05T00:00:00.000Z'),
    },
    {
      id: 'library-2',
      userId: 'user-1',
      templateId: 'template-2',
      name: 'Breakout Runner',
      status: 'Active',
      assets: [{ symbol: 'ETHUSDT', brokerKey: 'paper' }],
      timeframes: ['4h'],
      overrides: null,
      createdAt: new Date('2026-04-01T00:00:00.000Z'),
      updatedAt: new Date('2026-04-04T00:00:00.000Z'),
    },
    {
      id: 'library-3',
      userId: 'user-1',
      templateId: 'template-3',
      name: 'Needs Scope',
      status: 'Draft',
      assets: [],
      timeframes: [],
      overrides: null,
      createdAt: new Date('2026-04-01T00:00:00.000Z'),
      updatedAt: new Date('2026-04-03T00:00:00.000Z'),
    },
  ];
  let capturedPaginate: boolean | undefined;

  service.strategyLibraryRepository = {
    async listLibrary(_userId: string, _params: Record<string, unknown>, options?: { paginate?: boolean }) {
      capturedPaginate = options?.paginate;
      return {
        data: records,
        total: records.length,
      };
    },
  };
  service.strategyTemplateRepository = {
    async listStrategyTemplatesByIds(_userId: string, templateIds: string[]) {
      assert.deepEqual(templateIds, ['template-1', 'template-2', 'template-3']);
      return [
        {
          id: 'template-1',
          userId: 'user-1',
          name: 'Alpha Template',
          description: 'Automation-ready template',
          status: 'Active',
          templateVersion: 2,
          config: {
            editorMode: 'rule-based',
            entryLogic: 'ema(20) > ema(50)',
            exitLogic: 'ema(20) < ema(50)',
          },
        },
        {
          id: 'template-2',
          userId: 'user-1',
          name: 'Breakout Template',
          description: 'Missing automation contract',
          status: 'Active',
          templateVersion: 1,
          config: {
            editorMode: 'rule-based',
            entryLogic: '',
            exitLogic: '',
          },
        },
        {
          id: 'template-3',
          userId: 'user-1',
          name: 'Scope Template',
          description: 'Needs scope',
          status: 'Draft',
          templateVersion: 1,
          config: {
            editorMode: 'rule-based',
            entryLogic: 'rsi(14) < 30',
            exitLogic: 'rsi(14) > 50',
          },
        },
      ];
    },
  };
  service.backtestRepository = {
    async getLatestStrategyLibraryBacktests(_userId: string, libraryIds: string[]) {
      assert.deepEqual(libraryIds, ['library-1', 'library-2', 'library-3']);
      return new Map([
        [
          'library-1',
          {
            libraryId: 'library-1',
            backtestId: 'backtest-11',
            status: 'Completed',
            createdAt: new Date('2026-04-04T10:00:00.000Z'),
            updatedAt: new Date('2026-04-04T10:05:00.000Z'),
          },
        ],
        [
          'library-2',
          {
            libraryId: 'library-2',
            backtestId: 'backtest-12',
            status: 'Failed',
            createdAt: new Date('2026-04-05T11:00:00.000Z'),
            updatedAt: new Date('2026-04-05T11:10:00.000Z'),
          },
        ],
      ]);
    },
  };

  const automationReadyResponse = await service.listLibrary('user-1', {
    limit: '10',
    offset: '0',
    automationReady: 'true',
    sort: 'name_asc',
  });

  assert.equal(capturedPaginate, false);
  assert.equal(automationReadyResponse.data.total, 1);
  assert.deepEqual(
    automationReadyResponse.data.items.map((item: { id: string }) => item.id),
    ['library-1']
  );

  const failedRunsResponse = await service.listLibrary('user-1', {
    limit: '10',
    offset: '0',
    lastRunFailed: 'true',
    sort: 'latest_run_desc',
  });

  assert.equal(failedRunsResponse.data.total, 1);
  assert.deepEqual(
    failedRunsResponse.data.items.map((item: { id: string }) => item.id),
    ['library-2']
  );

  const needsScopeResponse = await service.listLibrary('user-1', {
    limit: '10',
    offset: '0',
    scopeReady: 'false',
  });

  assert.equal(needsScopeResponse.data.total, 1);
  assert.deepEqual(
    needsScopeResponse.data.items.map((item: { id: string }) => item.id),
    ['library-3']
  );
}

async function runStrategyLibraryRecentRunHistoryAssertions(): Promise<void> {
  const service = new StrategyLibraryService() as any;
  const record = {
    id: 'library-1',
    userId: 'user-1',
    templateId: 'template-1',
    name: 'Momentum Runner',
    status: 'Active',
    assets: [{ symbol: 'BTCUSDT', brokerKey: 'paper' }],
    timeframes: ['1h'],
    overrides: null,
    createdAt: new Date('2026-04-01T00:00:00.000Z'),
    updatedAt: new Date('2026-04-02T00:00:00.000Z'),
  };
  const template = {
    id: 'template-1',
    userId: 'user-1',
    name: 'Momentum Template',
    description: 'Trend-following template',
    status: 'Active',
    templateVersion: 5,
    config: {
      editorMode: 'rule-based',
      entryLogic: 'ema(20) > ema(50)',
      exitLogic: 'ema(20) < ema(50)',
      market: 'crypto-futures',
    },
  };

  service.strategyLibraryRepository = {
    async getById(_userId: string, libraryId: string) {
      assert.equal(libraryId, 'library-1');
      return record;
    },
  };
  service.strategyTemplateRepository = {
    async getStrategyTemplateById(_userId: string, templateId: string) {
      assert.equal(templateId, 'template-1');
      return template;
    },
  };
  service.backtestRepository = {
    async getLatestStrategyLibraryBacktests(_userId: string, libraryIds: string[]) {
      assert.deepEqual(libraryIds, ['library-1']);
      return new Map([
        [
          'library-1',
          {
            libraryId: 'library-1',
            backtestId: 'backtest-50',
            status: 'Queued',
            createdAt: new Date('2026-04-05T09:00:00.000Z'),
            updatedAt: new Date('2026-04-05T09:00:00.000Z'),
          },
        ],
      ]);
    },
    async getRecentStrategyLibraryBacktests(_userId: string, libraryIds: string[]) {
      assert.deepEqual(libraryIds, ['library-1']);
      return new Map([
        [
          'library-1',
          [
            {
              libraryId: 'library-1',
              backtestId: 'backtest-50',
              status: 'Queued',
              parameter: 'Momentum Runner | BTCUSDT | 1h',
              createdAt: new Date('2026-04-05T09:00:00.000Z'),
              updatedAt: new Date('2026-04-05T09:00:00.000Z'),
            },
            {
              libraryId: 'library-1',
              backtestId: 'backtest-42',
              status: 'Completed',
              parameter: 'Momentum Runner | ETHUSDT | 4h',
              createdAt: new Date('2026-04-03T08:00:00.000Z'),
              updatedAt: new Date('2026-04-03T08:12:00.000Z'),
            },
          ],
        ],
      ]);
    },
  };

  const detailResponse = await service.getLibraryById('user-1', 'library-1');

  assert.equal(detailResponse.data.latestRun?.backtestId, 'backtest-50');
  assert.equal(Object.prototype.hasOwnProperty.call(detailResponse.data, 'recentRuns'), false);

  const runsResponse = await service.getLibraryRuns('user-1', 'library-1', { limit: '5' });

  assert.equal(runsResponse.data.limit, 5);
  assert.equal(runsResponse.data.items.length, 2);
  assert.equal(runsResponse.data.items[0]?.backtestId, 'backtest-50');
  assert.equal(runsResponse.data.items[0]?.status, 'Queued');
  assert.equal(runsResponse.data.items[0]?.queuedAt, '2026-04-05T09:00:00.000Z');
  assert.equal(runsResponse.data.items[0]?.completedAt, null);
  assert.equal(runsResponse.data.items[0]?.parameter, 'Momentum Runner | BTCUSDT | 1h');
  assert.equal(runsResponse.data.items[1]?.backtestId, 'backtest-42');
  assert.equal(runsResponse.data.items[1]?.status, 'Completed');
  assert.equal(runsResponse.data.items[1]?.queuedAt, '2026-04-03T08:00:00.000Z');
  assert.equal(runsResponse.data.items[1]?.completedAt, '2026-04-03T08:12:00.000Z');
  assert.equal(runsResponse.data.items[1]?.parameter, 'Momentum Runner | ETHUSDT | 4h');
}

async function runBacktestPromotionSnapshotAssertions(): Promise<void> {
  const service = new BacktestPromotionService() as any;
  const createdAutomations: Array<Record<string, unknown>> = [];
  const createdEvents: Array<Record<string, unknown>> = [];
  const backtest = {
    id: 'backtest-2',
    name: 'Snapshot Winner',
    strategy: 'Momentum Template',
    symbol: 'BTCUSDT',
    parameter: 'Momentum Runner | BTCUSDT | 15m, 1h',
    createdAt: new Date('2026-04-02T00:00:00.000Z'),
    result: {
      config: {
        inputSnapshot: {
          sourceType: 'strategy_library',
          sourceId: 'library-1',
          libraryId: 'library-1',
          templateId: 'template-1',
          templateVersion: 8,
          templateDiffSummary: {
            changedCount: 2,
            inheritedCount: 14,
            changedFields: ['Long entry logic', 'Max risk'],
          },
          market: 'crypto-futures',
          assets: [{ symbol: 'BTCUSDT', brokerKey: 'paper' }],
          timeframes: ['15m', '1h'],
          template: {
            id: 'template-1',
            name: 'Momentum Template',
            templateVersion: 8,
            config: {
              market: 'crypto-futures',
              codeTarget: 'python',
            },
          },
        },
      },
    },
  };
  const selectedTopSetup = {
    id: 'setup-1',
    dedupeKey: 'setup-1',
    backtestId: 'backtest-2',
    backtestName: 'Snapshot Winner',
    strategy: 'Momentum Template',
    parameter: 'Momentum Runner | BTCUSDT | 15m, 1h',
    symbol: 'BTCUSDT',
    timeframe: '15m',
    score: 0.91,
    trades: 10,
    winRate: 60,
    profitFactor: 1.8,
    returnPct: 12.5,
    maxDrawdownPct: 4.2,
    hasIncompleteTradeHistory: false,
    eligibleForAutomation: true,
    automationEligibilityReasons: [],
    templateAutomationReady: true,
    templateAutomationReasons: [],
    robustness: {
      robustnessScore: 0.88,
      walkForwardPassRate: 0.75,
      averageOutOfSampleReturnPct: 9.1,
      worstOutOfSampleReturnPct: 2.4,
    },
    createdAt: '2026-04-02T00:00:00.000Z',
  };
  service.automationRepository = {
    findTradeSuggestionAutomationByScope: async () => null,
    createAutomation: async (payload: Record<string, unknown>) => {
      createdAutomations.push(payload);
      return {
        id: 'automation-1',
        status: payload.status,
        createdAt: new Date('2026-04-02T00:00:00.000Z'),
      };
    },
    createAutomationEvent: async (payload: Record<string, unknown>) => {
      createdEvents.push(payload);
      return payload;
    },
  };
  service.operationalEventService = {
    logActivity: async () => undefined,
  };
  service.userTimeZoneService = {
    resolveUserTimeZone: async () => 'UTC',
  };

  const response = await service.promoteResolvedTopSetup({
    userId: 'user-1',
    backtest,
    payload: {
      status: 'Draft',
    },
    selectedTopSetup,
  });

  assert.equal(response.data.automation.id, 'automation-1');
  assert.equal(createdAutomations.length, 1);
  const automationPayload = createdAutomations[0];
  assert.equal(automationPayload?.broker, 'paper');
  assert.equal(automationPayload?.market, 'crypto-futures');
  assert.equal(automationPayload?.trigger, 'timeframe:15m');
  const automationConfig = automationPayload?.config as Record<string, unknown>;
  const normalizedConfig = automationConfig?.config as Record<string, unknown>;
  assert.equal(automationConfig?.source, 'backtest');
  assert.equal(normalizedConfig?.market, 'crypto-futures');
  assert.equal(normalizedConfig?.libraryId, 'library-1');
  assert.equal(normalizedConfig?.templateVersion, 8);
  const normalizedDiff = normalizedConfig?.templateDiffSummary as Record<string, unknown>;
  assert.equal(normalizedDiff?.changedCount, 2);
  assert.equal(normalizedDiff?.inheritedCount, 14);
  const normalizedTemplate = normalizedConfig?.template as Record<string, unknown>;
  assert.equal(normalizedTemplate?.id, 'template-1');
  assert.equal(normalizedTemplate?.templateVersion, 8);
  const normalizedSnapshot = normalizedConfig?.inputSnapshot as Record<string, unknown>;
  assert.equal(normalizedSnapshot?.sourceId, 'library-1');
  assert.equal(normalizedSnapshot?.templateVersion, 8);
  assert.equal(
    (normalizedSnapshot?.templateDiffSummary as Record<string, unknown>)?.changedCount,
    2
  );
  assert.equal(createdEvents.length, 1);
}

async function runBacktestPromotionIdempotencyAssertions(): Promise<void> {
  const service = new BacktestPromotionService() as any;
  const activities: Array<Record<string, unknown>> = [];
  const backtest = {
    id: 'backtest-3',
    name: 'Existing Automation Winner',
    strategy: 'Momentum Template',
    symbol: 'ETHUSDT',
    parameter: 'Momentum Runner | ETHUSDT | 4h',
    createdAt: new Date('2026-04-03T00:00:00.000Z'),
    result: {
      config: {
        inputSnapshot: {
          sourceType: 'strategy_library',
          sourceId: 'library-1',
          libraryId: 'library-1',
          templateId: 'template-1',
          templateVersion: 8,
          market: 'crypto-futures',
          assets: [{ symbol: 'ETHUSDT', brokerKey: 'paper' }],
          timeframes: ['4h'],
        },
      },
    },
  };
  const selectedTopSetup = {
    id: 'setup-1',
    dedupeKey: 'setup-1',
    backtestId: 'backtest-3',
    backtestName: 'Existing Automation Winner',
    strategy: 'Momentum Template',
    parameter: 'Momentum Runner | ETHUSDT | 4h',
    symbol: 'ETHUSDT',
    timeframe: '4h',
    score: 0.94,
    trades: 14,
    winRate: 62,
    profitFactor: 1.9,
    returnPct: 16.1,
    maxDrawdownPct: 4.8,
    hasIncompleteTradeHistory: false,
    eligibleForAutomation: true,
    automationEligibilityReasons: [],
    templateAutomationReady: true,
    templateAutomationReasons: [],
    robustness: {
      robustnessScore: 0.91,
      walkForwardPassRate: 0.8,
      averageOutOfSampleReturnPct: 10.4,
      worstOutOfSampleReturnPct: 3.1,
    },
    createdAt: '2026-04-03T00:00:00.000Z',
  };
  service.automationRepository = {
    findTradeSuggestionAutomationByScope: async () => ({
      id: 'automation-existing-1',
      status: 'Draft',
      createdAt: new Date('2026-04-03T09:00:00.000Z'),
      name: 'Existing ETH automation',
    }),
    createAutomation: async () => {
      throw new Error('createAutomation should not be called when an automation already exists');
    },
    createAutomationEvent: async () => {
      throw new Error('createAutomationEvent should not be called when an automation already exists');
    },
  };
  service.operationalEventService = {
    logActivity: async (userId: string, payload: Record<string, unknown>) => {
      activities.push({ userId, ...payload });
    },
  };

  const response = await service.promoteResolvedTopSetup({
    userId: 'user-1',
    backtest,
    payload: {
      status: 'Draft',
    },
    selectedTopSetup,
  });

  assert.equal(response.data.message, 'Automation already exists for top setup');
  assert.equal(response.data.automation.id, 'automation-existing-1');
  assert.equal(response.data.automation.status, 'Draft');
  assert.equal(activities.length, 1);
  assert.equal(activities[0].referenceId, 'automation-existing-1');
  assert.match(String(activities[0].description || ''), /Reused existing automation/);
}

async function runBacktestPromotionServiceFailureAlertAssertions(): Promise<void> {
  const service = new BacktestPromotionService() as any;
  const activities: Array<Record<string, unknown>> = [];
  const alerts: Array<Record<string, unknown>> = [];
  const backtest = {
    id: 'backtest-promotion-service-failure-1',
    name: 'Promotion Service Failure Candidate',
    strategy: 'Momentum Template',
    symbol: 'BTCUSDT',
    parameter: 'Momentum Runner | BTCUSDT | 1h',
    createdAt: new Date('2026-04-05T00:00:00.000Z'),
    result: {
      config: {
        inputSnapshot: {
          sourceType: 'strategy_library',
          sourceId: 'library-1',
          libraryId: 'library-1',
          templateId: 'template-1',
          templateVersion: 8,
          market: 'crypto-futures',
          assets: [{ symbol: 'BTCUSDT', brokerKey: 'paper' }],
          timeframes: ['1h'],
        },
      },
    },
  };
  const selectedTopSetup = {
    id: 'setup-promotion-service-failure-1',
    dedupeKey: 'setup-promotion-service-failure-1',
    backtestId: backtest.id,
    backtestName: backtest.name,
    strategy: backtest.strategy,
    parameter: backtest.parameter,
    symbol: 'BTCUSDT',
    timeframe: '1h',
    score: 0.9,
    trades: 12,
    winRate: 58,
    profitFactor: 1.7,
    returnPct: 10.4,
    maxDrawdownPct: 4.9,
    hasIncompleteTradeHistory: false,
    eligibleForAutomation: true,
    automationEligibilityReasons: [],
    templateAutomationReady: true,
    templateAutomationReasons: [],
    robustness: {
      robustnessScore: 0.87,
      walkForwardPassRate: 0.76,
      averageOutOfSampleReturnPct: 8.3,
      worstOutOfSampleReturnPct: 2.2,
    },
    createdAt: '2026-04-05T00:00:00.000Z',
  };

  service.automationRepository = {
    findTradeSuggestionAutomationByScope: async () => null,
    createAutomation: async () => {
      throw new Error('Automation create failed');
    },
  };
  service.operationalEventService = {
    logActivity: async (userId: string, payload: Record<string, unknown>) => {
      activities.push({ userId, ...payload });
    },
    emitFailureAlert: async (userId: string, payload: Record<string, unknown>) => {
      alerts.push({ userId, ...payload });
    },
  };
  service.userTimeZoneService = {
    resolveUserTimeZone: async () => 'UTC',
  };

  await assert.rejects(
    () =>
      service.promoteResolvedTopSetup({
        userId: 'user-1',
        backtest,
        payload: {
          status: 'Draft',
        },
        selectedTopSetup,
      }),
    /Automation create failed/
  );

  assert.equal(activities.length, 1);
  assert.equal(activities[0]?.title, 'Backtest promotion failed');
  assert.equal(activities[0]?.route, 'Automations');
  assert.equal(activities[0]?.stream, 'Deployments');
  assert.equal(activities[0]?.referenceId, backtest.id);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0]?.channel, 'Automations');
  assert.equal(alerts[0]?.source, 'backtests:promotion-service');
  assert.equal(alerts[0]?.route, 'Automations');
}

async function runBacktestPromotionDelegationAssertions(): Promise<void> {
  const service = createBacktestsService();
  const capturedCalls: Array<Record<string, unknown>> = [];
  type PromotionRulesCapture = {
    minScore?: number;
    minTrades?: number;
    requireRobustness?: boolean;
  };
  let capturedPromotionRules: PromotionRulesCapture | null = null;
  const backtest = {
    id: 'backtest-promotion-delegate-1',
    name: 'Delegated Promotion Winner',
    strategy: 'Momentum Template',
    symbol: 'BTCUSDT',
    parameter: 'Momentum Template / BTCUSDT / 1h',
    status: 'Completed',
    stability: 'Stable',
    trades: 18,
    createdAt: new Date('2026-04-05T00:00:00.000Z'),
    result: {
      cagr: 11.2,
      sharpe: 1.52,
      drawdown: 5.7,
      winRate: 59,
      profitFactor: 1.84,
      config: {
        sourceType: 'strategy_library',
        sourceId: 'library-1',
        libraryId: 'library-1',
        inputSnapshot: {
          sourceType: 'strategy_library',
          sourceId: 'library-1',
          libraryId: 'library-1',
          templateId: 'template-1',
          templateVersion: 8,
        },
        performanceSurface: {
          generatedAt: '2026-04-05T00:15:00.000Z',
          results: [],
        },
        tradeEventCount: 18,
      },
    },
  };

  service.backtestRepository = {
    getBacktestById: async () => backtest,
  };
  service.appSettingsRepository = {
    async getSettings() {
      return {
        backtestPromotionRules: {
          minScore: 0.82,
          minTrades: 7,
          requireRobustness: false,
        },
      };
    },
  };
  service.backtestTradeRepository = {
    getTradeCountsByBacktest: async () => new Map([[backtest.id, 18]]),
  };
  service.backtestTopSetupsService = {
    rankBacktestTopSetups: (
      _mappedBacktest: Record<string, unknown>,
      promotionRules?: PromotionRulesCapture
    ) => {
      capturedPromotionRules = promotionRules ?? null;
      return [
        {
          id: 'setup-delegate-1',
          dedupeKey: 'setup-delegate-1',
          backtestId: backtest.id,
          backtestName: backtest.name,
          strategy: backtest.strategy,
          parameter: backtest.parameter,
          symbol: 'BTCUSDT',
          timeframe: '1h',
          score: 0.93,
          trades: 18,
          winRate: 59,
          profitFactor: 1.84,
          returnPct: 14.6,
          maxDrawdownPct: 5.7,
          hasIncompleteTradeHistory: false,
          eligibleForAutomation: true,
          automationEligibilityReasons: [],
          templateAutomationReady: true,
          templateAutomationReasons: [],
          robustness: {
            robustnessScore: 0.9,
            walkForwardPassRate: 0.8,
            averageOutOfSampleReturnPct: 10.1,
            worstOutOfSampleReturnPct: 2.9,
          },
          createdAt: '2026-04-05T00:00:00.000Z',
        },
      ];
    },
  };
  service.backtestPromotionService = {
    promoteResolvedTopSetup: async (payload: Record<string, unknown>) => {
      capturedCalls.push(payload);
      return {
        success: true,
        data: {
          message: 'delegated',
          automation: {
            id: 'automation-delegated-1',
            status: 'Draft',
            createdAt: '2026-04-05T00:20:00.000Z',
          },
        },
      };
    },
  };

  const response = await service.promoteBacktestToAutomation('user-1', backtest.id, {
    status: 'Draft',
  });

  assert.equal(response.data.message, 'delegated');
  assert.equal(capturedCalls.length, 1);
  assert.equal(capturedCalls[0].userId, 'user-1');
  assert.equal((capturedCalls[0].backtest as Record<string, unknown>).id, backtest.id);
  assert.equal(
    ((capturedCalls[0].selectedTopSetup as Record<string, unknown>).symbol),
    'BTCUSDT'
  );
  assert.equal(
    ((capturedCalls[0].selectedTopSetup as Record<string, unknown>).timeframe),
    '1h'
  );
  const promotionRulesSnapshot = capturedPromotionRules as PromotionRulesCapture | null;
  assert.equal(promotionRulesSnapshot?.minScore, 0.82);
  assert.equal(promotionRulesSnapshot?.minTrades, 7);
  assert.equal(promotionRulesSnapshot?.requireRobustness, false);
}

async function runBacktestPromotionFailureAlertAssertions(): Promise<void> {
  const service = createBacktestsService();
  const activities: Array<Record<string, unknown>> = [];
  const alerts: Array<Record<string, unknown>> = [];
  const backtest = {
    id: 'backtest-promotion-failure-1',
    name: 'Promotion Failure Candidate',
    strategy: 'Momentum Template',
    symbol: 'BTCUSDT',
    parameter: 'Momentum Template / BTCUSDT / 1h',
    status: 'Completed',
    stability: 'Stable',
    trades: 18,
    createdAt: new Date('2026-04-05T00:00:00.000Z'),
    result: {
      cagr: 11.2,
      sharpe: 1.52,
      drawdown: 5.7,
      winRate: 59,
      profitFactor: 1.84,
      config: {
        performanceSurface: {
          generatedAt: '2026-04-05T00:15:00.000Z',
          results: [],
        },
        tradeEventCount: 18,
      },
    },
  };

  service.backtestRepository = {
    getBacktestById: async () => backtest,
  };
  service.backtestTradeRepository = {
    getTradeCountsByBacktest: async () => new Map([[backtest.id, 18]]),
  };
  service.mapBacktest = () => ({
    id: backtest.id,
    runStatus: 'Completed',
    performanceSurface: {
      generatedAt: '2026-04-05T00:15:00.000Z',
      results: [],
    },
    hasIncompleteTradeHistory: false,
  });
  service.backtestTopSetupsService = {
    rankBacktestTopSetups: () => [
      {
        id: 'setup-promotion-failure-1',
        dedupeKey: 'setup-promotion-failure-1',
        backtestId: backtest.id,
        backtestName: backtest.name,
        strategy: backtest.strategy,
        parameter: backtest.parameter,
        symbol: 'BTCUSDT',
        timeframe: '1h',
        score: 0.93,
        trades: 18,
        winRate: 59,
        profitFactor: 1.84,
        returnPct: 14.6,
        maxDrawdownPct: 5.7,
        hasIncompleteTradeHistory: false,
        eligibleForAutomation: true,
        automationEligibilityReasons: [],
        templateAutomationReady: true,
        templateAutomationReasons: [],
        robustness: {
          robustnessScore: 0.9,
          walkForwardPassRate: 0.8,
          averageOutOfSampleReturnPct: 10.1,
          worstOutOfSampleReturnPct: 2.9,
        },
        createdAt: '2026-04-05T00:00:00.000Z',
      },
    ],
  };
  service.backtestPromotionService = {
    promoteResolvedTopSetup: async () => {
      throw new Error('Automation persistence failed');
    },
  };
  service.operationalEventService = {
    logActivity: async (userId: string, payload: Record<string, unknown>) => {
      activities.push({ userId, ...payload });
    },
    emitFailureAlert: async (userId: string, payload: Record<string, unknown>) => {
      alerts.push({ userId, ...payload });
    },
  };

  await assert.rejects(
    () => service.promoteBacktestToAutomation('user-1', backtest.id, { status: 'Draft' }),
    /Automation persistence failed/
  );

  assert.equal(activities.length, 1);
  assert.equal(activities[0].title, 'Backtest promotion failed');
  assert.equal(activities[0].type, 'Automation');
  assert.equal(activities[0].stream, 'Deployments');
  assert.equal(activities[0].referenceId, backtest.id);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].channel, 'Backtests');
  assert.equal(alerts[0].source, 'backtests:promotion');
  assert.equal(alerts[0].route, 'Backtests');
  assert.match(String(alerts[0].message || ''), /Automation persistence failed/);
}

function runAutomationLineageMappingAssertions(): void {
  const service = new AutomationsService() as any;
  const mappedAutomation = service.mapAutomation({
    id: 'automation-1',
    automationType: 'strategy',
    name: 'Momentum Deployment',
    strategy: 'Momentum Template',
    broker: 'paper',
    market: 'crypto-futures',
    trigger: 'timeframe:15m,1h',
    status: 'Running',
    lastRun: new Date('2026-04-02T10:00:00.000Z'),
    nextRun: new Date('2026-04-02T10:15:00.000Z'),
    timeZone: 'UTC',
    schedule: { type: 'interval', intervalMinutes: 15 },
    accounts: 1,
    riskMode: 'Guarded',
    config: {
      source: 'backtest',
      backtestId: 'backtest-9',
      config: {
        sourceType: 'strategy_lab',
        projectId: 'lab-3',
        projectVersion: 3,
        sourceTemplateId: 'template-1',
        sourceTemplateName: 'Momentum Template',
        sourceTemplateVersion: 8,
        templateDiffSummary: {
          changedCount: 3,
          inheritedCount: 13,
          changedFields: ['Long entry logic', 'Max risk', 'AI filter'],
        },
        inputSnapshot: {
          template: {
            id: 'lab-3',
            name: 'Momentum Draft',
            templateVersion: 3,
          },
        },
      },
    },
    updatedAt: new Date('2026-04-02T10:05:00.000Z'),
    events: [
      {
        id: 'event-1',
        type: 'Run completed',
        entity: 'Backtest',
        outcome: 'Success',
        meta: {
          lineage: {
            sourceType: 'strategy_lab',
            projectId: 'lab-3',
            projectVersion: 3,
            sourceTemplateId: 'template-1',
            sourceTemplateName: 'Momentum Template',
            sourceTemplateVersion: 8,
            templateDiffSummary: {
              changedCount: 3,
              inheritedCount: 13,
              changedFields: ['Long entry logic', 'Max risk', 'AI filter'],
            },
          },
        },
        createdAt: new Date('2026-04-02T10:05:00.000Z'),
      },
    ],
    alerts: [
      {
        id: 'alert-1',
        message: 'Latency spike detected',
        severity: 'Medium',
        status: 'Open',
        meta: {
          lineage: {
            sourceType: 'strategy_library',
            libraryId: 'library-2',
            templateId: 'template-4',
            templateName: 'Breakout Template',
            templateVersion: 5,
            templateDiffSummary: {
              changedCount: 1,
              inheritedCount: 15,
              changedFields: ['Signal threshold'],
            },
          },
        },
        createdAt: new Date('2026-04-02T10:06:00.000Z'),
      },
    ],
  });

  assert.equal(mappedAutomation.lineage?.source, 'backtest');
  assert.equal(mappedAutomation.lineage?.backtestId, 'backtest-9');
  assert.equal(mappedAutomation.lineage?.sourceType, 'strategy_lab');
  assert.equal(mappedAutomation.lineage?.projectId, 'lab-3');
  assert.equal(mappedAutomation.lineage?.projectVersion, 3);
  assert.equal(mappedAutomation.lineage?.templateName, 'Momentum Draft');
  assert.equal(mappedAutomation.lineage?.templateVersion, 3);
  assert.equal(mappedAutomation.lineage?.sourceTemplateName, 'Momentum Template');
  assert.equal(mappedAutomation.lineage?.sourceTemplateVersion, 8);
  assert.equal(mappedAutomation.lineage?.templateDiffSummary?.changedCount, 3);
  assert.equal(
    mappedAutomation.lineage?.templateDiffSummary?.changedFields?.[2],
    'AI filter'
  );
  assert.equal(mappedAutomation.events?.[0]?.lineage?.projectId, 'lab-3');
  assert.equal(mappedAutomation.events?.[0]?.lineage?.sourceTemplateVersion, 8);
  assert.equal(mappedAutomation.events?.[0]?.lineage?.templateDiffSummary?.changedCount, 3);
  assert.equal(mappedAutomation.alerts?.[0]?.lineage?.libraryId, 'library-2');
  assert.equal(mappedAutomation.alerts?.[0]?.lineage?.templateVersion, 5);
  assert.equal(mappedAutomation.alerts?.[0]?.lineage?.templateDiffSummary?.changedCount, 1);

  const mappedRun = service.mapAutomationRun(
    {
      id: 'run-1',
      status: 'Success',
      scheduledFor: new Date('2026-04-02T10:00:00.000Z'),
      startedAt: new Date('2026-04-02T10:00:03.000Z'),
      finishedAt: new Date('2026-04-02T10:00:08.000Z'),
      durationMs: 5000,
      errorMessage: null,
      meta: {
        trigger: 'manual',
        lineage: {
          sourceType: 'strategy_library',
          libraryId: 'library-2',
          templateId: 'template-4',
          templateName: 'Breakout Template',
          templateVersion: 5,
          backtestId: 'backtest-7',
          templateDiffSummary: {
            changedCount: 1,
            inheritedCount: 15,
            changedFields: ['Signal threshold'],
          },
        },
      },
    },
    'UTC'
  );

  assert.equal(mappedRun.trigger, 'manual');
  assert.equal(mappedRun.backtestId, 'backtest-7');
  assert.equal(mappedRun.lineage?.sourceType, 'strategy_library');
  assert.equal(mappedRun.lineage?.libraryId, 'library-2');
  assert.equal(mappedRun.lineage?.templateId, 'template-4');
  assert.equal(mappedRun.lineage?.templateVersion, 5);
  assert.equal(mappedRun.lineage?.templateDiffSummary?.changedCount, 1);
  assert.equal(mappedRun.recovery?.canRetry, false);

  const staleRun = service.mapAutomationRun(
    {
      id: 'run-2',
      status: 'Running',
      scheduledFor: new Date('2026-04-02T05:00:00.000Z'),
      startedAt: new Date('2026-04-02T05:00:00.000Z'),
      finishedAt: null,
      durationMs: null,
      errorMessage: null,
      meta: {
        trigger: 'scheduled',
      },
    },
    'UTC'
  );

  assert.equal(staleRun.recovery?.active, true);
  assert.equal(staleRun.recovery?.canReconcile, true);
}

async function runAutomationReconcileAssertions(): Promise<void> {
  const service = new AutomationsService() as any;
  const runUpdateCalls: Array<{ runId: string; payload: Record<string, unknown> }> = [];
  const statusUpdates: Array<{ userId: string; automationId: string; status: string; nextRun: Date | null | undefined }> = [];
  const events: Array<Record<string, unknown>> = [];
  const activities: Array<Record<string, unknown>> = [];
  const automation = {
    id: 'automation-1',
    name: 'Momentum Deployment',
    strategy: 'Momentum Template',
    userId: 'user-1',
    status: 'Running',
    trigger: 'every 15m',
    schedule: { type: 'interval', scheduleMode: 'every_n_minutes', intervalMinutes: 15 },
    timeZone: 'UTC',
    updatedAt: new Date('2026-04-02T10:05:00.000Z'),
  };
  const staleRun = {
    id: 'run-stale',
    automationId: 'automation-1',
    userId: 'user-1',
    status: 'Running',
    scheduledFor: new Date('2026-04-02T05:00:00.000Z'),
    startedAt: new Date('2026-04-02T05:00:00.000Z'),
    finishedAt: null,
    durationMs: null,
    errorMessage: null,
    meta: { trigger: 'scheduled' },
  };

  service.requireAutomation = async () => automation;
  service.automationExecutionService = {
    syncBacktestRunnerLifecycle: async () => undefined,
    syncBacktestRunnerLifecycleByBacktestId: async () => ({ synced: false }),
  };
  service.automationRunRepository = {
    listRunsByAutomationStatuses: async () => [staleRun],
    updateRun: async (runId: string, payload: Record<string, unknown>) => {
      runUpdateCalls.push({ runId, payload });
    },
    findById: async () => staleRun,
  };
  service.automationRepository = {
    updateAutomationStatus: async (
      userId: string,
      automationId: string,
      status: string,
      nextRun: Date | null | undefined
    ) => {
      statusUpdates.push({ userId, automationId, status, nextRun });
    },
    createAutomationEvent: async (payload: Record<string, unknown>) => {
      events.push(payload);
      return payload;
    },
  };
  service.operationalEventService = {
    logActivity: async (_userId: string, payload: Record<string, unknown>) => {
      activities.push(payload);
    },
    emitFailureAlert: async () => undefined,
  };
  service.userTimeZoneService = {
    resolveUserTimeZone: async () => 'UTC',
  };

  const response = await service.reconcileAutomationState('user-1', 'automation-1', {
    reason: 'Operator requested stale-run recovery',
  });

  assert.match(response.data.message, /Cleared stale automation run/i);
  assert.equal(runUpdateCalls.length, 1);
  assert.equal(runUpdateCalls[0].runId, 'run-stale');
  assert.equal(runUpdateCalls[0].payload.status, 'Failed');
  assert.match(String(runUpdateCalls[0].payload.errorMessage || ''), /Operator requested stale-run recovery/);
  assert.equal(statusUpdates.length, 1);
  assert.equal(statusUpdates[0].automationId, 'automation-1');
  assert.equal(statusUpdates[0].status, 'Running');
  assert.ok(statusUpdates[0].nextRun instanceof Date);
  assert.equal(events.some((event) => event.type === 'Run reconciled'), true);
  assert.equal(events.some((event) => event.type === 'State reconciled'), true);
  assert.equal(activities.length > 0, true);
}

async function runAutomationControlHardeningAssertions(): Promise<void> {
  const service = new AutomationsService() as any;
  const statusUpdates: Array<Record<string, unknown>> = [];
  const events: Array<Record<string, unknown>> = [];
  const executePayloads: Array<Record<string, unknown>> = [];

  service.automationRepository = {
    updateAutomationStatus: async (
      userId: string,
      automationId: string,
      status: string,
      nextRun: Date | null | undefined
    ) => {
      statusUpdates.push({ userId, automationId, status, nextRun });
    },
    createAutomationEvent: async (payload: Record<string, unknown>) => {
      events.push(payload);
      return payload;
    },
  };
  service.automationExecutionService = {
    execute: async (payload: Record<string, unknown>) => {
      executePayloads.push(payload);
      return { status: 'started', runId: 'run-1', nextRun: '2026-04-02T10:15:00.000Z' };
    },
  };
  service.operationalEventService = {
    logActivity: async () => undefined,
    emitFailureAlert: async () => undefined,
  };
  service.userTimeZoneService = {
    resolveUserTimeZone: async () => 'UTC',
  };

  service.requireAutomation = async () => ({
    id: 'automation-paused',
    status: 'Paused',
    updatedAt: new Date('2026-04-02T10:05:00.000Z'),
  });

  const pausedResponse = await service.pauseAutomation('user-1', 'automation-paused', {
    reason: 'duplicate-click',
  });

  assert.equal(pausedResponse.data.message, 'Automation already paused');
  assert.equal(statusUpdates.length, 0);
  assert.equal(events.length, 0);

  await assert.rejects(
    async () => service.runAutomationNow('user-1', 'automation-paused'),
    /Automation is paused\. Resume it before running now\./
  );
  assert.equal(executePayloads.length, 0);

  service.requireAutomation = async () => ({
    id: 'automation-running',
    status: 'Running',
    updatedAt: new Date('2026-04-02T10:10:00.000Z'),
    nextRun: new Date('2026-04-02T10:30:00.000Z'),
    schedule: { type: 'interval', scheduleMode: 'every_n_minutes', intervalMinutes: 15 },
    trigger: 'every 15m',
    timeZone: 'UTC',
  });

  const resumeResponse = await service.resumeAutomation('user-1', 'automation-running', {
    reason: 'duplicate-click',
  });

  assert.equal(resumeResponse.data.message, 'Automation already running');
  assert.equal(statusUpdates.length, 0);
  assert.equal(events.length, 0);

  service.requireAutomation = async () => ({
    id: 'automation-failed',
    status: 'Failed',
    updatedAt: new Date('2026-04-02T10:12:00.000Z'),
  });

  await assert.rejects(
    async () => service.runAutomationNow('user-1', 'automation-failed'),
    /Automation must be running before manual execution\./
  );
  assert.equal(executePayloads.length, 0);
}

function runAutomationTimeZoneValidationAssertions(): void {
  const validBacktestRunner = validateAutomationCreateBody({
    name: 'Runner',
    status: 'Running',
    automationType: 'backtest-runner',
    timeZone: 'UTC',
    schedule: {
      type: 'interval',
      intervalMinutes: 60,
    },
    config: {
      backtestRunner: {
        runBody: {
          universe: 'Phase 6 Smoke',
          benchmark: 'BTCUSDT',
        },
      },
    },
  });

  assert.equal(validBacktestRunner.automationType, 'backtest-runner');

  assert.throws(
    () =>
      validateAutomationCreateBody({
        name: 'Bad TZ',
        status: 'Draft',
        automationType: 'trade-suggestion',
        timeZone: 'Mars/Olympus',
        config: {
          symbol: 'BTCUSDT',
          timeframe: '1h',
          sourceTemplateId: 'template-1',
        },
      }),
    /timeZone must be a valid IANA timezone/
  );

  assert.throws(
    () =>
      validateAutomationUpdateBody({
        timeZone: 'Moon/Base',
      }),
    /timeZone must be a valid IANA timezone/
  );
}

function runAutomationScheduleAuditAssertions(): void {
  const normalizedDaily = normalizeAutomationScheduleRecord(
    { runAt: '09:30', intervalDays: 2 },
    'daily 09:30'
  );
  assert.deepEqual(normalizedDaily, {
    type: 'daily',
    scheduleMode: 'daily',
    runAt: '09:30',
    hour: 9,
    minute: 30,
    intervalDays: 2,
  });

  const normalizedWeekly = normalizeAutomationScheduleRecord(
    { type: 'weekly', runAt: '18:45', weekdays: [1, 3, 5] },
    'weekly Mon, Wed, Fri 18:45'
  );
  assert.deepEqual(normalizedWeekly, {
    type: 'weekly',
    scheduleMode: 'weekly',
    runAt: '18:45',
    hour: 18,
    minute: 45,
    weekdays: [1, 3, 5],
  });

  const resolvedWeekly = resolveAutomationSchedule(
    { type: 'weekly', runAt: '09:30', weekdays: [1] },
    'weekly Mon 09:30'
  );
  assert.deepEqual(resolvedWeekly, {
    type: 'weekly',
    hour: 9,
    minute: 30,
    weekdays: [1],
  });

  const nextRun = computeNextRun(
    {
      type: 'weekly',
      hour: 9,
      minute: 30,
      weekdays: [1],
    },
    'Asia/Kolkata',
    new Date('2026-03-08T12:00:00.000Z')
  );
  assert.equal(nextRun?.toISOString(), '2026-03-09T04:00:00.000Z');
}

async function runAutomationSchedulePersistenceAssertions(): Promise<void> {
  const service = new AutomationsService() as any;
  const createdPayloads: Array<Record<string, unknown>> = [];
  const savedAutomations: Array<Record<string, unknown>> = [];

  service.prepareAutomationConfig = async (_userId: string, _automationType: string, config: Record<string, unknown>) =>
    config;
  service.deriveAutomationCoreFields = (_automationType: string, _config: Record<string, unknown>, fields: Record<string, unknown>) =>
    fields;
  service.resolveAutomationTimeZone = async (_userId: string, automationTimeZone?: string | null) =>
    automationTimeZone || 'UTC';
  service.mapAutomation = (automation: Record<string, unknown>) => automation;
  service.requireAutomation = async () => ({
    id: 'automation-1',
    userId: 'user-1',
    name: 'Momentum Bot',
    strategy: 'Momentum',
    broker: 'paper',
    market: 'crypto',
    trigger: 'daily 09:30',
    status: 'Paused',
    automationType: 'trade-suggestion',
    timeZone: 'UTC',
    schedule: { type: 'daily', scheduleMode: 'daily', runAt: '09:30', hour: 9, minute: 30, intervalDays: 1 },
    riskMode: null,
    config: {
      symbol: 'BTCUSDT',
      timeframe: '1h',
      sourceTemplateId: 'template-1',
    },
    updatedAt: new Date('2026-03-08T00:00:00.000Z'),
  });
  service.automationRepository = {
    createAutomation: async (payload: Record<string, unknown>) => {
      createdPayloads.push(payload);
      return {
        id: 'automation-new',
        ...payload,
        accounts: 0,
        events: [],
        alerts: [],
        lastRun: null,
        nextRun: null,
        updatedAt: new Date('2026-03-08T00:00:00.000Z'),
      };
    },
    saveAutomation: async (automation: Record<string, unknown>) => {
      savedAutomations.push({ ...automation });
      return automation;
    },
    createAutomationEvent: async () => undefined,
  };

  const createResponse = await service.createAutomation('user-1', {
    name: 'Weekly Momentum',
    status: 'Running',
    automationType: 'trade-suggestion',
    timeZone: 'Asia/Kolkata',
    schedule: {
      runAt: '09:30',
      weekdays: [1, 3, 5],
    },
    trigger: 'weekly Mon, Wed, Fri 09:30',
    config: {
      symbol: 'BTCUSDT',
      timeframe: '1h',
      sourceTemplateId: 'template-1',
    },
  });

  assert.equal(createdPayloads.length, 1);
  assert.deepEqual(createdPayloads[0].schedule, {
    type: 'weekly',
    scheduleMode: 'weekly',
    runAt: '09:30',
    hour: 9,
    minute: 30,
    weekdays: [1, 3, 5],
  });
  assert.equal(createdPayloads[0].timeZone, 'Asia/Kolkata');
  assert.equal(createResponse.data.timeZone, 'Asia/Kolkata');
  assert.equal(savedAutomations.length, 1);
  assert.ok(savedAutomations[0].nextRun instanceof Date);

  savedAutomations.length = 0;
  await service.updateAutomation('user-1', 'automation-1', {
    status: 'Running',
    timeZone: 'America/New_York',
    schedule: {
      type: 'daily',
      runAt: '16:15',
    },
    trigger: 'daily 16:15',
  });

  assert.equal(savedAutomations.length, 1);
  assert.equal(savedAutomations[0].timeZone, 'America/New_York');
  assert.deepEqual(savedAutomations[0].schedule, {
    type: 'daily',
    scheduleMode: 'daily',
    runAt: '16:15',
    hour: 16,
    minute: 15,
    intervalDays: 1,
  });
  assert.ok(savedAutomations[0].nextRun instanceof Date);
}

async function runSuggestedTradesReadPathAssertions(): Promise<void> {
  const service = new SuggestedTradesService() as any;
  const now = Date.now();
  const trade = {
    id: 'st-1',
    automationId: 'auto-1',
    automationRunId: 'run-1',
    userId: 'user-1',
    sourceBacktestId: null,
    sourceTemplateId: null,
    sourceSetupKey: null,
    symbol: 'BTCUSDT',
    timeframe: '1h',
    side: 'BUY',
    signalTime: new Date(now - 60_000),
    status: 'Accepted',
    confidence: 0.82,
    score: 82,
    entryPrice: '100.5',
    stopLossPrice: '95.5',
    takeProfitTargets: ['105.5'],
    entryRule: 'breakout',
    exitRule: 'trail',
    rationale: 'Momentum continuation',
    dedupeKey: 'dedupe-1',
    meta: {
      signalId: 'sig-1',
      execution: {
        executionMode: 'paper',
        paperOrderId: 'paper-1',
        executionState: 'linked',
        linkedAt: new Date(now - 30_000).toISOString(),
      },
    },
    createdAt: new Date(now - 50_000),
    updatedAt: new Date(now - 10_000),
  };

  service.suggestedTradeRepository = {
    async listSuggestedTrades() {
      return { items: [trade], total: 1 };
    },
    async getSuggestedTradeById() {
      return trade;
    },
  };
  service.paperOrderExecutionService = {
    async simulateUserPaperOrders() {
      throw new Error('read endpoints should not refresh paper executions');
    },
  };
  service.paperOrderRepository = {
    async getPaperOrderById() {
      throw new Error('read endpoints should not fetch paper order execution state');
    },
  };

  const listResponse = await service.getSuggestedTrades('user-1', {});
  assert.equal(listResponse.data.total, 1);
  assert.equal(listResponse.data.items[0]?.id, 'st-1');
  assert.equal(listResponse.data.items[0]?.execution?.paperOrderId, 'paper-1');
  assert.deepEqual(listResponse.data.items[0]?.allowedActions, ['reconcile_execution']);
  assert.equal(
    listResponse.data.items[0]?.statusReason,
    'Accepted and linked to a paper order'
  );
  assert.equal(listResponse.data.items[0]?.statusDisplay, 'Order Linked');
  assert.equal(listResponse.data.items[0]?.reviewStage, 'accepted');
  assert.equal(listResponse.data.items[0]?.executionStage, 'linked');
  assert.equal(listResponse.data.items[0]?.journeyStage, 'track_execution');
  assert.equal(listResponse.data.items[0]?.syncStatus?.state, 'fresh');
  assert.equal(listResponse.data.items[0]?.syncStatus?.manualReconcileAvailable, true);
  assert.equal(listResponse.data.items[0]?.lifecycle?.order?.entity, 'paper_order');
  assert.equal(listResponse.data.items[0]?.timeline?.[0]?.id, 'signal_detected');
  assert.equal(listResponse.data.items[0]?.freshness?.source, 'execution');
  assert.equal(listResponse.data.items[0]?.linkedEntities?.[0]?.entity, 'automation');
  assert.ok(
    listResponse.data.items[0]?.linkedEntities?.some(
      (entity: { entity: string }) => entity.entity === 'paper_order'
    )
  );

  const detailResponse = await service.getSuggestedTradeById('user-1', 'st-1');
  assert.equal(detailResponse.data.id, 'st-1');
  assert.equal(detailResponse.data.execution?.paperOrderId, 'paper-1');
  assert.equal(detailResponse.data.statusDisplay, 'Order Linked');
  assert.equal(detailResponse.data.syncStatus?.state, 'fresh');
  assert.ok((detailResponse.data.timeline?.length ?? 0) >= 3);
  assert.ok(
    detailResponse.data.linkedEntities?.some(
      (entity: { entity: string }) => entity.entity === 'signal'
    )
  );
}

async function runSuggestedTradesSummaryFilterAssertions(): Promise<void> {
  const service = new SuggestedTradesService() as any;
  let capturedUserId: string | null = null;
  let capturedQuery: Record<string, unknown> | null = null;

  service.suggestedTradeRepository = {
    async getSuggestedTradesSummary(userId: string, query: Record<string, unknown>) {
      capturedUserId = userId;
      capturedQuery = query;
      return {
        open: 0,
        reviewed: 0,
        accepted: 1,
        dismissed: 0,
        actionable: 1,
        buySide: 0,
        sellSide: 1,
        linked: 0,
        working: 1,
        filled: 0,
        closed: 0,
      };
    },
  };

  const response = await service.getSuggestedTradesSummary('user-1', {
    status: 'Accepted',
    executionState: ' Working ',
    symbol: ' btcusdt ',
    timeframe: '1H',
    automationId: 'auto-1',
    automationRunId: 'run-1',
    side: 'sell',
    search: ' breakout setup ',
  });

  assert.equal(capturedUserId, 'user-1');
  assert.deepEqual(capturedQuery, {
    automationId: 'auto-1',
    automationRunId: 'run-1',
    status: 'Accepted',
    executionState: 'working',
    symbol: 'BTCUSDT',
    timeframe: '1H',
    side: 'SELL',
    search: 'breakout setup',
  });
  assert.equal(response.data.actionable, 1);
  assert.equal(response.data.accepted, 1);
  assert.equal(response.data.sellSide, 1);
  assert.equal(response.data.working, 1);
}

async function runSuggestedTradeTransitionAssertions(): Promise<void> {
  {
    const service = new SuggestedTradesService() as any;
    let savedTrade: Record<string, unknown> | null = null;
    let lookupCount = 0;

    service.runPreTradeGate = async () => ({
      result: {
        decision: {
          summary: 'Pre-trade passed',
        },
      },
      execution: {
        preTradeState: 'passed',
        preTradeCheckedAt: '2026-04-04T10:02:30.000Z',
      },
      ready: true,
    });

    service.suggestedTradeRepository = {
      async getSuggestedTradeById() {
        lookupCount += 1;
        return {
          id: 'st-open',
          automationId: 'auto-1',
          automationRunId: 'run-1',
          userId: 'user-1',
          symbol: 'BTCUSDT',
          timeframe: '1h',
          side: 'BUY',
          signalTime: new Date('2026-04-04T10:00:00.000Z'),
          status: lookupCount > 1 ? 'Accepted' : 'Open',
          confidence: 0.82,
          score: 82,
          entryPrice: '100',
          stopLossPrice: null,
          takeProfitTargets: null,
          entryRule: null,
          exitRule: null,
          rationale: null,
          dedupeKey: 'dedupe-1',
          meta:
            lookupCount > 1
              ? {
                  review: {
                    status: 'Accepted',
                    note: 'ready to execute',
                    updatedAt: '2026-04-04T10:03:00.000Z',
                    actor: 'user-1',
                  },
                }
              : null,
          createdAt: new Date('2026-04-04T10:01:00.000Z'),
          updatedAt: new Date('2026-04-04T10:02:00.000Z'),
        };
      },
      async saveSuggestedTrade(trade: Record<string, unknown>) {
        savedTrade = { ...trade };
        return {
          ...trade,
          updatedAt: new Date('2026-04-04T10:03:00.000Z'),
        };
      },
      async saveSuggestedTradeExecution(payload: Record<string, unknown>) {
        return {
          ...payload,
          createdAt: new Date('2026-04-04T10:03:00.000Z'),
          updatedAt: new Date('2026-04-04T10:03:00.000Z'),
        };
      },
    };
    service.operationalEventService = {
      async logActivity() {
        return undefined;
      },
      async emitFailureAlert() {
        return undefined;
      },
    };

    const response = await service.acceptSuggestedTrade('user-1', 'st-open', {
      note: 'ready to execute',
    });

    const savedMeta = savedTrade?.['meta'] as Record<string, unknown> | undefined;
    assert.equal(savedTrade?.['status'], 'Accepted');
    assert.equal(
      (savedMeta?.review as Record<string, unknown> | undefined)?.status,
      'Accepted'
    );
    assert.equal(response.data.suggestedTrade.status, 'Accepted');
  }

  {
    const service = new SuggestedTradesService() as any;
    service.suggestedTradeRepository = {
      async getSuggestedTradeById() {
        return {
          id: 'st-accepted',
          automationId: 'auto-1',
          automationRunId: 'run-1',
          userId: 'user-1',
          symbol: 'BTCUSDT',
          timeframe: '1h',
          side: 'BUY',
          signalTime: new Date('2026-04-04T10:00:00.000Z'),
          status: 'Accepted',
          confidence: 0.82,
          score: 82,
          entryPrice: '100',
          stopLossPrice: null,
          takeProfitTargets: null,
          entryRule: null,
          exitRule: null,
          rationale: null,
          dedupeKey: 'dedupe-2',
          meta: null,
          createdAt: new Date('2026-04-04T10:01:00.000Z'),
          updatedAt: new Date('2026-04-04T10:02:00.000Z'),
        };
      },
    };
    service.operationalEventService = {
      async logActivity() {
        return undefined;
      },
      async emitFailureAlert() {
        return undefined;
      },
    };

    await assert.rejects(
      () => service.reviewSuggestedTrade('user-1', 'st-accepted', { note: 'back to review' }),
      /Only open suggested trades can be marked as reviewed/
    );
  }

  {
    const service = new SuggestedTradesService() as any;
    service.suggestedTradeRepository = {
      async getSuggestedTradeById() {
        return {
          id: 'st-linked',
          automationId: 'auto-1',
          automationRunId: 'run-1',
          userId: 'user-1',
          symbol: 'BTCUSDT',
          timeframe: '1h',
          side: 'BUY',
          signalTime: new Date('2026-04-04T10:00:00.000Z'),
          status: 'Accepted',
          confidence: 0.82,
          score: 82,
          entryPrice: '100',
          stopLossPrice: null,
          takeProfitTargets: null,
          entryRule: null,
          exitRule: null,
          rationale: null,
          dedupeKey: 'dedupe-3',
          meta: {
            execution: {
              orderId: 'ord-1',
              executionState: 'linked',
            },
          },
          createdAt: new Date('2026-04-04T10:01:00.000Z'),
          updatedAt: new Date('2026-04-04T10:02:00.000Z'),
        };
      },
    };
    service.operationalEventService = {
      async logActivity() {
        return undefined;
      },
      async emitFailureAlert() {
        return undefined;
      },
    };

    await assert.rejects(
      () => service.dismissSuggestedTrade('user-1', 'st-linked', { note: 'cancel it' }),
      /linked execution cannot be dismissed/
    );
  }
}

async function runSuggestedTradeExecutionPersistenceAssertions(): Promise<void> {
  const service = new SuggestedTradesService() as any;
  let tradeLookupCount = 0;
  let savedTradeMeta: Record<string, unknown> | null = null;
  let savedExecutionPayload: Record<string, unknown> | null = null;
  const attachedLinks: string[][] = [];

  service.runPreTradeGate = async () => ({
    result: {
      decision: {
        summary: 'Pre-trade passed',
      },
    },
    execution: {
      executionMode: 'paper',
      preTradeState: 'passed',
      preTradeCheckedAt: '2026-04-04T10:02:30.000Z',
      brokerKey: 'mudrex',
      accountId: 'acc-1',
    },
    ready: true,
  });

  const trade = {
    id: 'st-link',
    automationId: 'auto-1',
    automationRunId: 'run-1',
    userId: 'user-1',
    sourceBacktestId: null,
    sourceTemplateId: null,
    sourceSetupKey: null,
    symbol: 'BTCUSDT',
    timeframe: '1h',
    side: 'BUY',
    signalTime: new Date('2026-04-04T10:00:00.000Z'),
    status: 'Accepted',
    confidence: 0.82,
    score: 82,
    entryPrice: '100',
    stopLossPrice: '95',
    takeProfitTargets: ['110'],
    entryRule: 'breakout',
    exitRule: 'trail',
    rationale: 'Momentum continuation',
    dedupeKey: 'dedupe-link',
    meta: {
      signalId: 'sig-1',
      execution: {
        executionMode: 'paper',
      },
    },
    createdAt: new Date('2026-04-04T10:00:30.000Z'),
    updatedAt: new Date('2026-04-04T10:02:00.000Z'),
  };

  service.suggestedTradeRepository = {
    async getSuggestedTradeById() {
      tradeLookupCount += 1;
      if (tradeLookupCount === 1) {
        return {
          ...trade,
          meta: {
            ...trade.meta,
            execution: {
              executionMode: 'paper',
            },
          },
        };
      }

      return {
        ...trade,
        meta: {
          signalId: 'sig-1',
        },
        executionRecord: {
          suggestedTradeId: 'st-link',
          userId: 'user-1',
          executionMode: 'paper',
          paperOrderId: 'paper-1',
          brokerKey: 'mudrex',
          accountId: 'acc-1',
          paperOrderStatus: 'OPEN',
          executionState: 'linked',
          linkedAt: new Date('2026-04-04T10:03:00.000Z'),
          createdAt: new Date('2026-04-04T10:03:00.000Z'),
          updatedAt: new Date('2026-04-04T10:03:00.000Z'),
        },
        updatedAt: new Date('2026-04-04T10:03:00.000Z'),
      };
    },
    async saveSuggestedTrade(item: Record<string, unknown>) {
      savedTradeMeta = (item.meta as Record<string, unknown> | null) ?? null;
      return {
        ...item,
        updatedAt: new Date('2026-04-04T10:03:00.000Z'),
      };
    },
    async saveSuggestedTradeExecution(payload: Record<string, unknown>) {
      savedExecutionPayload = { ...payload };
      return {
        ...payload,
        createdAt: new Date('2026-04-04T10:03:00.000Z'),
        updatedAt: new Date('2026-04-04T10:03:00.000Z'),
      };
    },
  };
  service.paperOrderRepository = {
    async getPaperOrderById() {
      return {
        id: 'paper-1',
        suggestedTradeId: null,
      };
    },
    async attachSuggestedTrade(userId: string, paperOrderId: string, suggestedTradeId: string) {
      attachedLinks.push([userId, paperOrderId, suggestedTradeId]);
      return {
        id: paperOrderId,
        suggestedTradeId,
      };
    },
  };
  service.operationalEventService = {
    async logActivity() {
      return undefined;
    },
    async emitFailureAlert() {
      return undefined;
    },
  };

  const response = await service.linkSuggestedTradeOrder('user-1', 'st-link', {
    executionMode: 'paper',
    paperOrderId: 'paper-1',
    paperOrderStatus: 'OPEN',
    brokerKey: 'mudrex',
    accountId: 'acc-1',
    orderType: 'MARKET',
    note: 'Linked paper order',
  });

  assert.deepEqual(attachedLinks, [['user-1', 'paper-1', 'st-link']]);
  assert.equal(savedExecutionPayload?.['paperOrderId'], 'paper-1');
  assert.equal(savedExecutionPayload?.['executionState'], 'linked');
  assert.equal(savedExecutionPayload?.['brokerKey'], 'mudrex');
  assert.deepEqual(savedTradeMeta, {
    signalId: 'sig-1',
  });
  assert.equal(response.data.suggestedTrade.execution?.paperOrderId, 'paper-1');
}

async function runSuggestedTradeReconcileAssertions(): Promise<void> {
  const service = new SuggestedTradesService() as any;
  let tradeLookupCount = 0;

  const baseTrade = {
    id: 'st-reconcile',
    automationId: 'auto-1',
    automationRunId: 'run-1',
    userId: 'user-1',
    sourceBacktestId: null,
    sourceTemplateId: null,
    sourceSetupKey: null,
    symbol: 'BTCUSDT',
    timeframe: '1h',
    side: 'BUY',
    signalTime: new Date('2026-04-04T10:00:00.000Z'),
    status: 'Accepted',
    confidence: 0.88,
    score: 90,
    entryPrice: '100',
    stopLossPrice: '95',
    takeProfitTargets: ['108'],
    entryRule: 'breakout',
    exitRule: 'trail',
    rationale: 'Momentum continuation',
    dedupeKey: 'dedupe-reconcile',
    meta: {
      execution: {
        executionMode: 'live',
        orderId: 'ord-1',
        brokerKey: 'binance',
        accountId: 'acc-1',
        executionState: 'linked',
        linkedAt: '2026-04-04T10:01:00.000Z',
        entryPrice: '100',
      },
    },
    createdAt: new Date('2026-04-04T10:00:30.000Z'),
    updatedAt: new Date('2026-04-04T10:02:00.000Z'),
  };

  service.suggestedTradeRepository = {
    async getSuggestedTradeById() {
      tradeLookupCount += 1;
      if (tradeLookupCount === 1) {
        return {
          ...baseTrade,
          meta: {
            execution: {
              ...baseTrade.meta.execution,
            },
          },
        };
      }

      return {
        ...baseTrade,
        meta: {
          execution: {
            ...baseTrade.meta.execution,
            orderStatus: 'OPEN',
            executionState: 'working',
            lastSeenAt: '2026-04-04T10:05:00.000Z',
          },
        },
        updatedAt: new Date('2026-04-04T10:05:00.000Z'),
      };
    },
    async getLinkedOrderSnapshot() {
      return {
        orderStatus: 'OPEN',
        statusRank: 1,
        lastSeenAt: '2026-04-04T10:05:00.000Z',
        payload: {
          created_at: '2026-04-04T10:01:00.000Z',
          updated_at: '2026-04-04T10:05:00.000Z',
        },
      };
    },
    async getLinkedPositionSnapshots() {
      return [];
    },
    async saveSuggestedTrade(trade: Record<string, unknown>) {
      return {
        ...trade,
        updatedAt: new Date('2026-04-04T10:05:00.000Z'),
      };
    },
    async saveSuggestedTradeExecution(payload: Record<string, unknown>) {
      return {
        ...payload,
        createdAt: new Date('2026-04-04T10:05:00.000Z'),
        updatedAt: new Date('2026-04-04T10:05:00.000Z'),
      };
    },
  };
  service.paperOrderExecutionService = {
    async simulateUserPaperOrders() {
      return undefined;
    },
  };
  service.paperOrderRepository = {
    async getPaperOrderById() {
      return null;
    },
  };
  let activityCount = 0;
  let failureAlertCount = 0;
  service.operationalEventService = {
    async logActivity() {
      activityCount += 1;
      return undefined;
    },
    async emitFailureAlert() {
      failureAlertCount += 1;
      return undefined;
    },
  };

  const response = await service.reconcileSuggestedTradeExecution('user-1', 'st-reconcile');

  assert.equal(response.data.refreshed, true);
  assert.equal(response.data.suggestedTrade.execution?.executionState, 'working');
  assert.deepEqual(response.data.suggestedTrade.allowedActions, ['reconcile_execution']);
  assert.equal(activityCount, 1);
  assert.equal(failureAlertCount, 0);
}

async function runSuggestedTradesBulkReconcileAssertions(): Promise<void> {
  const service = new SuggestedTradesService() as any;
  let capturedIds: string[] | null = null;
  let refreshedTrades: string[] = [];

  service.suggestedTradeRepository = {
    async getSuggestedTradesByIds(userId: string, ids: string[]) {
      assert.equal(userId, 'user-1');
      capturedIds = [...ids];
      return [
        {
          id: 'st-stale',
          automationId: 'auto-1',
          automationRunId: 'run-1',
          userId,
          symbol: 'BTCUSDT',
          timeframe: '1h',
          side: 'BUY',
          signalTime: new Date('2024-01-01T00:00:00.000Z'),
          status: 'Accepted',
          confidence: 0.8,
          score: 80,
          entryPrice: '100',
          stopLossPrice: null,
          takeProfitTargets: null,
          entryRule: null,
          exitRule: null,
          rationale: null,
          dedupeKey: 'dedupe-stale',
          meta: {
            execution: {
              executionMode: 'paper',
              paperOrderId: 'paper-1',
              executionState: 'linked',
              linkedAt: '2024-01-01T00:01:00.000Z',
            },
          },
          createdAt: new Date('2024-01-01T00:01:00.000Z'),
          updatedAt: new Date('2024-01-01T00:02:00.000Z'),
        },
      ];
    },
  };
  service.refreshExecutionOutcomes = async (_userId: string, trades: Array<{ id: string }>) => {
    refreshedTrades = trades.map((trade) => trade.id);
    return 1;
  };
  service.operationalEventService = {
    async logActivity() {
      return undefined;
    },
    async emitFailureAlert() {
      return undefined;
    },
  };

  const response = await service.reconcileSuggestedTradesExecution('user-1', {
    suggestedTradeIds: [' st-stale '],
    staleOnly: true,
  });

  assert.deepEqual(capturedIds, ['st-stale']);
  assert.deepEqual(refreshedTrades, ['st-stale']);
  assert.equal(response.data.processed, 1);
  assert.equal(response.data.refreshed, 1);
  assert.deepEqual(response.data.suggestedTradeIds, ['st-stale']);
}

async function runSuggestedTradeExecutionSyncServiceAssertions(): Promise<void> {
  const service = new SuggestedTradeExecutionSyncService() as any;
  const createdRuns: Array<Record<string, unknown>> = [];
  const updatedConfigs: Array<Record<string, unknown>> = [];
  let releasedLocks = 0;

  const baseConfig = {
    key: 'suggested-trades-execution-sync',
    enabled: true,
    batchSize: env.suggestedTradesSync.batchSize,
    lastStartedAt: new Date('2026-04-04T10:00:00.000Z'),
    lastFinishedAt: new Date('2026-04-04T10:02:00.000Z'),
    lastStatus: 'Success',
    lastError: null,
    config: {
      pollIntervalMs: env.suggestedTradesSync.pollIntervalMs,
      staleAfterMs: env.suggestedTradesSync.staleAfterMs,
    },
  };

  service.schedulerConfigRepository = {
    async createIfMissing() {
      return { ...baseConfig };
    },
    async tryAcquireRunLock() {
      return true;
    },
    async updateByKey(_key: string, payload: Record<string, unknown>) {
      updatedConfigs.push({ ...payload });
      return {
        ...baseConfig,
        ...payload,
        config: {
          ...baseConfig.config,
          ...(payload.config as Record<string, unknown> | undefined),
        },
      };
    },
    async releaseRunLock() {
      releasedLocks += 1;
    },
  };
  service.schedulerRunLogRepository = {
    async createRun(payload: Record<string, unknown>) {
      createdRuns.push({ ...payload });
      return payload;
    },
    async findLatestBySchedulerKeyAndStatuses() {
      return {
        id: 'run-old-failed',
        status: 'Failed',
        startedAt: new Date('2026-04-04T09:00:00.000Z'),
        finishedAt: new Date('2026-04-04T09:01:00.000Z'),
      };
    },
  };
  service.suggestedTradeRepository = {
    async getExecutionSyncSummary(userId: string, query: Record<string, unknown>) {
      assert.equal(userId, 'user-1');
      assert.equal(query.executionState, 'working');
      return {
        tracked: 3,
        stale: 1,
        terminal: 1,
      };
    },
    async getGlobalExecutionSyncSummary(staleBefore: Date) {
      assert.ok(staleBefore instanceof Date);
      return {
        tracked: 5,
        stale: 0,
        terminal: 2,
      };
    },
  };
  service.suggestedTradesService = {
    async syncStaleTrackedExecutionTrades(payload: Record<string, unknown>) {
      assert.equal(payload.limit, env.suggestedTradesSync.batchSize);
      assert.ok(payload.staleBefore instanceof Date);
      return {
        processed: 2,
        refreshed: 1,
        userCount: 1,
        suggestedTradeIds: ['st-1', 'st-2'],
      };
    },
  };
  service.operationalEventService = {
    async logActivity() {
      return undefined;
    },
    async emitFailureAlert() {
      return undefined;
    },
  };

  const status = await service.getSyncStatus('user-1', {
    executionState: 'working',
  });
  assert.equal(status.state, 'attention');
  assert.equal(status.stale, 1);
  assert.equal(status.tracked, 3);

  const globalStatus = await service.getOperationalStatus();
  assert.equal(globalStatus.state, 'healthy');
  assert.equal(globalStatus.tracked, 5);
  assert.equal(globalStatus.stale, 0);

  const batch = await service.runBatchOnce();
  assert.equal(batch.processed, 2);
  assert.equal(batch.refreshed, 1);
  assert.equal(batch.skipped, false);
  assert.equal(createdRuns.length, 1);
  assert.equal(releasedLocks, 1);
  assert.equal(updatedConfigs.length >= 1, true);
}

async function runSuggestedTradesOverviewServiceAssertions(): Promise<void> {
  const service = new SuggestedTradesOverviewService() as any;
  let capturedListQuery: Record<string, unknown> | null = null;
  const capturedSummaryQueries: Array<Record<string, unknown>> = [];

  service.suggestedTradesService = {
    async getSuggestedTrades(userId: string, query: Record<string, unknown>) {
      assert.equal(userId, 'user-1');
      capturedListQuery = { ...query };
      return createSuccess({
        items: [{ id: 'st-1' }],
        total: 1,
        limit: 25,
        offset: 10,
      });
    },
    async getSuggestedTradesSummary(userId: string, query: Record<string, unknown>) {
      assert.equal(userId, 'user-1');
      capturedSummaryQueries.push({ ...query });

      if (!query.status && !query.executionState) {
        return createSuccess({
          open: 2,
          reviewed: 3,
          accepted: 4,
          dismissed: 1,
          actionable: 9,
          buySide: 6,
          sellSide: 4,
          linked: 2,
          working: 1,
          filled: 1,
          closed: 4,
        });
      }

      return createSuccess({
        open: 0,
        reviewed: 0,
        accepted: 1,
        dismissed: 0,
        actionable: 1,
        buySide: 0,
        sellSide: 1,
        linked: 0,
        working: 1,
        filled: 0,
        closed: 0,
      });
    },
  };
  service.suggestedTradeExecutionSyncService = {
    async getSyncStatus(userId: string, query: Record<string, unknown>) {
      assert.equal(userId, 'user-1');
      assert.deepEqual(query, {
        automationId: 'auto-1',
        automationRunId: 'run-1',
        status: 'Accepted',
        executionState: 'working',
        symbol: 'BTCUSDT',
        timeframe: '1h',
        side: 'SELL',
        search: 'breakout',
      });
      return {
        state: 'attention',
        label: 'Stale Trades',
        summary: '1 tracked trade needs refresh.',
        enabled: true,
        tracked: 3,
        stale: 1,
        terminal: 1,
        staleAfterMs: env.suggestedTradesSync.staleAfterMs,
      };
    },
  };

  const response = await service.getOverview('user-1', {
    limit: '25',
    offset: '10',
    status: 'Accepted',
    executionState: 'working',
    symbol: 'BTCUSDT',
    timeframe: '1h',
    automationId: 'auto-1',
    automationRunId: 'run-1',
    side: 'SELL',
    search: 'breakout',
  });

  assert.deepEqual(capturedListQuery, {
    limit: '25',
    offset: '10',
    status: 'Accepted',
    executionState: 'working',
    symbol: 'BTCUSDT',
    timeframe: '1h',
    automationId: 'auto-1',
    automationRunId: 'run-1',
    side: 'SELL',
    search: 'breakout',
  });
  assert.deepEqual(capturedSummaryQueries, [
    {
      limit: '25',
      offset: '10',
      status: 'Accepted',
      executionState: 'working',
      symbol: 'BTCUSDT',
      timeframe: '1h',
      automationId: 'auto-1',
      automationRunId: 'run-1',
      side: 'SELL',
      search: 'breakout',
    },
    {
      limit: '25',
      offset: '10',
      status: undefined,
      executionState: undefined,
      symbol: 'BTCUSDT',
      timeframe: '1h',
      automationId: 'auto-1',
      automationRunId: 'run-1',
      side: 'SELL',
      search: 'breakout',
    },
  ]);
  assert.equal(response.data.summary.working, 1);
  assert.equal(response.data.suggestedTrades.total, 1);
  assert.equal(
    response.data.cards.find((card: { id: string; value: number }) => card.id === 'open')?.value,
    2
  );
  assert.equal(
    response.data.tabs.find((tab: { id: string; selected: boolean }) => tab.id === 'working')
      ?.selected,
    true
  );
  assert.equal(response.data.quickActions[1]?.target, '/suggested-trades/reconcile-execution');
  assert.equal(response.data.quickActions[3]?.target, '/suggested-trades?executionState=working');
  assert.equal(response.data.syncStatus.state, 'attention');
  assert.equal(response.data.syncStatus.stale, 1);
  assert.equal(
    response.data.journey.steps.find(
      (step: { id: string; state: string }) => step.id === 'track_execution'
    )?.state,
    'current'
  );
}

async function runSuggestedTradesHealthServiceAssertions(): Promise<void> {
  const service = new SuggestedTradesHealthService() as any;
  const originalRolloutEnabled = env.suggestedTrades.rolloutEnabled;
  env.suggestedTrades.rolloutEnabled = true;

  try {
    service.suggestedTradeRepository = {
      async getOperationalSnapshot() {
        return {
          total: 12,
          open: 2,
          reviewed: 1,
          accepted: 5,
          dismissed: 4,
          queuedForOrder: 2,
          convertedToOrder: 3,
          linked: 1,
          working: 1,
          filled: 1,
          closed: 1,
          queueToOrderConversionRate: 0.6,
        };
      },
    };
    service.suggestedTradeExecutionSyncService = {
      async getOperationalStatus() {
        return {
          state: 'healthy',
          label: 'Healthy',
          summary: 'Tracked trades are in sync.',
          enabled: true,
          tracked: 4,
          stale: 0,
          terminal: 1,
          staleAfterMs: env.suggestedTradesSync.staleAfterMs,
        };
      },
      async getSyncStatus(userId: string) {
        assert.equal(userId, 'user-1');
        return {
          state: 'healthy',
          label: 'Healthy',
          summary: 'Tracked trades are in sync.',
          enabled: true,
          tracked: 4,
          stale: 0,
          terminal: 1,
          staleAfterMs: env.suggestedTradesSync.staleAfterMs,
        };
      },
    };
    service.automationRunOutputRepository = {
      async getSuggestedTradeGenerationMetrics(createdAfter: Date) {
        assert.ok(createdAfter instanceof Date);
        return {
          summaryRuns: 3,
          suggestedTradesCreated: 7,
          duplicateSuggestions: 1,
        };
      },
    };
    service.activityRepository = {
      async countOperationalActivities(query: Record<string, unknown>) {
        if (query.route === 'Suggested Trades' && query.stream === 'Execution') {
          return 1;
        }
        if (query.route === 'Suggested Trades' && query.stream === 'Review') {
          return 0;
        }
        if (query.route === 'Orders') {
          return 2;
        }
        return 0;
      },
    };
    service.alertRepository = {
      async getOpenChannelSnapshot(channel: string, sources: string[]) {
        assert.equal(channel, 'Suggested Trades');
        assert.deepEqual(sources, ['suggested-trades', 'suggested-trades-execution-sync']);
        return {
          openAlerts: 1,
          openAlertsBySource: {
            'suggested-trades': 1,
            'suggested-trades-execution-sync': 0,
          },
        };
      },
    };
    service.suggestedTradesOverviewService = {
      async getOverview(userId: string, query: Record<string, unknown>) {
        assert.equal(userId, 'user-1');
        assert.equal(query.limit, '20');
        assert.equal(query.offset, '0');
        return createSuccess({});
      },
    };
    service.suggestedTradesService = {
      async getSuggestedTrades(userId: string, query: Record<string, unknown>) {
        assert.equal(userId, 'user-1');
        assert.equal(query.limit, '20');
        return createSuccess({});
      },
      async getSuggestedTradesSummary(userId: string) {
        assert.equal(userId, 'user-1');
        return createSuccess({});
      },
    };

    const response = await service.getOperationalSnapshot({
      probeUserId: 'user-1',
    });
    assert.equal(response.status, 'degraded');
    assert.equal(response.rolloutEnabled, env.suggestedTrades.rolloutEnabled);
    assert.equal(response.totalSuggestedTrades, 12);
    assert.equal(response.convertedToOrderCount, 3);
    assert.equal(response.queueToOrderSuccess24h, 2);
    assert.equal(response.duplicateSuggestions24h, 1);
    assert.equal(response.openAlerts, 1);
    assert.equal(response.probeUserId, 'user-1');
    assert.notEqual(response.overviewLatencyMs, null);
    assert.notEqual(response.listLatencyMs, null);
    assert.notEqual(response.summaryLatencyMs, null);
    assert.notEqual(response.syncStatusLatencyMs, null);
  } finally {
    env.suggestedTrades.rolloutEnabled = originalRolloutEnabled;
  }
}

async function runSignalsOverviewServiceAssertions(): Promise<void> {
  const service = new SignalsOverviewService() as any;
  let capturedListQuery: Record<string, unknown> | null = null;
  const capturedSummaryQueries: Array<Record<string, unknown>> = [];
  let capturedSchedulerRunsQuery: Record<string, unknown> | null = null;

  service.signalsService = {
    async getSignals(userId: string, query: Record<string, unknown>) {
      assert.equal(userId, 'user-1');
      capturedListQuery = { ...query };
      return createSuccess({
        items: [{ id: 'sig-1' }],
        total: 1,
        limit: 25,
        offset: 0,
      });
    },
    async getSignalsSummary(userId: string, query: Record<string, unknown>) {
      assert.equal(userId, 'user-1');
      capturedSummaryQueries.push({ ...query });

      const view = String(query.view || 'inbox');
      if (view === 'clustered') {
        return createSuccess({
          liveSignals: 3,
          triggered: 2,
          watching: 1,
          queued: 1,
          muted: 0,
          highConfidence: 2,
          mutedOrQueued: 1,
        });
      }
      if (view === 'muted') {
        return createSuccess({
          liveSignals: 2,
          triggered: 0,
          watching: 0,
          queued: 0,
          muted: 2,
          highConfidence: 0,
          mutedOrQueued: 2,
        });
      }
      return createSuccess({
        liveSignals: 5,
        triggered: 3,
        watching: 1,
        queued: 1,
        muted: 0,
        highConfidence: 2,
        mutedOrQueued: 1,
      });
    },
  };
  service.signalsSchedulerService = {
    async getSchedulerConfig(userId: string) {
      assert.equal(userId, 'user-1');
      return createSuccess({
        enabled: true,
        sources: ['strategy-library'],
        lastStartedAt: '2026-04-04T09:00:00.000Z',
        lastFinishedAt: '2026-04-04T09:03:00.000Z',
        lastStatus: 'Completed',
        lastError: null,
      });
    },
    async listSchedulerRuns(userId: string, query: Record<string, unknown>) {
      assert.equal(userId, 'user-1');
      capturedSchedulerRunsQuery = { ...query };
      return createSuccess({
        items: [
          {
            id: 'run-1',
            status: 'Running',
            startedAt: '2026-04-04T10:00:00.000Z',
            finishedAt: undefined,
          },
        ],
        total: 1,
        limit: 1,
        offset: 0,
      });
    },
  };

  const response = await service.getOverview('user-1', {
    limit: '25',
    offset: '0',
    status: 'Triggered',
    symbol: 'BTCUSDT',
    source: 'Momentum Engine',
    timeframe: '1h',
    search: 'breakout',
    view: 'muted',
  });

  assert.deepEqual(capturedListQuery, {
    limit: '25',
    offset: '0',
    status: 'Triggered',
    symbol: 'BTCUSDT',
    source: 'Momentum Engine',
    timeframe: '1h',
    search: 'breakout',
    view: 'muted',
  });
  assert.deepEqual(capturedSummaryQueries, [
    {
      limit: '25',
      offset: '0',
      status: 'Triggered',
      symbol: 'BTCUSDT',
      source: 'Momentum Engine',
      timeframe: '1h',
      search: 'breakout',
      view: 'muted',
    },
    {
      limit: '25',
      offset: '0',
      status: 'Triggered',
      symbol: 'BTCUSDT',
      source: 'Momentum Engine',
      timeframe: '1h',
      search: 'breakout',
      view: 'inbox',
    },
    {
      limit: '25',
      offset: '0',
      status: 'Triggered',
      symbol: 'BTCUSDT',
      source: 'Momentum Engine',
      timeframe: '1h',
      search: 'breakout',
      view: 'clustered',
    },
    {
      limit: '25',
      offset: '0',
      status: 'Triggered',
      symbol: 'BTCUSDT',
      source: 'Momentum Engine',
      timeframe: '1h',
      search: 'breakout',
      view: 'muted',
    },
  ]);
  assert.deepEqual(capturedSchedulerRunsQuery, {
    limit: '1',
    offset: '0',
  });
  assert.equal(response.data.summary.muted, 2);
  assert.equal(
    response.data.cards.find(
      (card: { id: string; value: number }) => card.id === 'clusters'
    )?.value,
    3
  );
  assert.equal(
    response.data.tabs.find((tab: { id: string; selected: boolean }) => tab.id === 'muted')
      ?.selected,
    true
  );
  assert.equal(response.data.quickActions[2]?.id, 'pause_scan');
  assert.equal(response.data.scanStatus.state, 'running');
  assert.equal(response.data.scanStatus.schedulerKey, 'signals-scan-sync');
  assert.equal(response.data.scanStatus.activeRunId, 'run-1');
  assert.equal(
    response.data.journey.steps.find(
      (step: { id: string; state: string }) => step.id === 'signal_muted'
    )?.state,
    'current'
  );
}

async function runSignalPresentationAssertions(): Promise<void> {
  const service = new SignalsService() as any;

  const listSignal = {
    id: 'sig-1',
    symbol: 'BTCUSDT',
    source: 'Momentum Engine',
    confidence: 0.91,
    direction: 'Long',
    timeframe: '1h',
    status: 'Triggered',
    regime: 'Trending',
    aiScore: 88,
    thesis: 'Breakout continuation',
    route: 'signals',
    createdAt: new Date('2026-04-04T10:00:00.000Z'),
    updatedAt: new Date('2026-04-04T10:02:00.000Z'),
    market: 'crypto-futures',
    signalTime: new Date('2026-04-04T09:59:00.000Z'),
    entryPrice: '100',
    sourceRefType: 'strategy_library',
    sourceRefId: 'template-1',
    expiresAt: new Date('2026-05-04T11:00:00.000Z'),
    riskNote: 'Keep size controlled',
    promotionState: null,
    metadata: null,
    actions: [],
  };

  const detailSignal = {
    ...listSignal,
    status: 'Watching',
    actions: [
      {
        actionType: 'promote',
        target: 'execution_queue',
        metadata: {
          targetId: 'st-1',
          targetName: 'BTCUSDT 1h BUY',
          targetUrl: '/suggested-trades?selected=st-1',
          targetEntity: 'suggested-trade',
          promotionState: 'Execution queue item created',
        },
      },
    ],
  };

  service.signalRepository = {
    async listSignals() {
      return {
        data: [listSignal],
        total: 1,
      };
    },
    async getSignalById() {
      return detailSignal;
    },
    async getSignalSummary() {
      return {
        liveSignals: 1,
        triggered: 1,
        watching: 0,
        queued: 0,
        muted: 0,
        highConfidence: 1,
        mutedOrQueued: 0,
      };
    },
  };
  service.signalAlertLinkRepository = {
    async listLinkedAlertIds(userId: string, signalId: string, limit: number) {
      assert.equal(userId, 'user-1');
      assert.equal(signalId, 'sig-1');
      assert.equal(limit, 6);
      return ['alert-1'];
    },
  };
  service.alertRepository = {
    async getAlertsByIds(userId: string, alertIds: string[]) {
      assert.equal(userId, 'user-1');
      assert.deepEqual(alertIds, ['alert-1', 'st-1']);
      return [
        {
          id: 'alert-1',
          severity: 'High',
          channel: 'Signals',
          symbol: 'BTCUSDT',
          message: 'Review breakout',
          route: 'Signal review',
          status: 'Open',
          source: 'signals',
          urgency: 'Immediate review',
          createdAt: new Date('2026-04-04T10:03:00.000Z'),
          updatedAt: new Date('2026-04-04T10:04:00.000Z'),
        },
      ];
    },
  };

  const listResponse = await service.getSignals('user-1', {});
  assert.deepEqual(listResponse.data.items[0]?.allowedActions, [
    'acknowledge',
    'mute',
    'promote_strategy',
    'promote_execution_queue',
    'promote_alerts',
    'promote_automations',
  ]);
  assert.equal(listResponse.data.items[0]?.statusReason, 'Fresh signal awaiting review');
  assert.equal(listResponse.data.items[0]?.statusDisplay, 'Needs Review');
  assert.equal(listResponse.data.items[0]?.freshness?.source, 'signal');
  assert.equal(listResponse.data.items[0]?.queueStage, 'inbox');
  assert.equal(listResponse.data.items[0]?.journeyStage, 'signal_detected');

  const detailResponse = await service.getSignalById('user-1', 'sig-1');
  assert.equal(detailResponse.data.statusDisplay, 'Watching');
  assert.equal(detailResponse.data.journeyStage, 'signal_review');
  assert.ok(
    detailResponse.data.linkedEntities?.some(
      (entity: { entity: string }) => entity.entity === 'alert'
    )
  );
  assert.ok(
    detailResponse.data.linkedEntities?.some(
      (entity: { entity: string }) => entity.entity === 'suggested-trade'
    )
  );
}

async function runAutomationExecutionHardeningAssertions(): Promise<void> {
  const originalCreateQueryRunner = coreDataSource.createQueryRunner.bind(coreDataSource);
  const automation = {
    id: 'automation-1',
    userId: 'user-1',
    name: 'Momentum Deployment',
    status: 'Running',
    schedule: { type: 'interval', scheduleMode: 'every_n_minutes', intervalMinutes: 15 },
    trigger: 'every 15m',
    timeZone: 'UTC',
    automationType: null,
    config: null,
    strategy: 'Momentum',
  };

  const createService = () => {
    const service = new AutomationExecutionService() as any;
    const events: Array<Record<string, unknown>> = [];

    service.automationRepository = {
      createAutomationEvent: async (payload: Record<string, unknown>) => {
        events.push(payload);
        return payload;
      },
      createAutomationAlert: async () => undefined,
      updateAutomationStatus: async () => undefined,
    };
    service.automationRunRepository = {
      updateRun: async () => undefined,
      findById: async () => null,
      listRunsByAutomationStatuses: async () => [],
    };
    service.automationRunOutputRepository = {
      createOutput: async () => undefined,
    };
    service.backtestRepository = {
      getBacktestByIdAny: async () => null,
      createQueuedBacktest: async () => null,
    };
    service.suggestedTradeRepository = {};
    service.strategyTemplateRepository = {};
    service.strategyLibraryService = {};
    service.operationalEventService = {
      logActivity: async () => undefined,
      emitFailureAlert: async () => undefined,
    };
    service.userTimeZoneService = {
      resolveUserTimeZone: async () => 'UTC',
    };
    service.automationCursorRepository = {
      listByAutomationAndScope: async () => [],
      upsertCursor: async () => undefined,
    };
    service.automationSignalEvaluatorService = {
      evaluateLatestSignals: async () => ({ items: [] }),
    };

    return { service, events };
  };

  try {
    {
      const { service, events } = createService();
      let commits = 0;
      let rollbacks = 0;
      let releases = 0;

      coreDataSource.createQueryRunner = () =>
        ({
          connect: async () => undefined,
          startTransaction: async () => undefined,
          commitTransaction: async () => {
            commits += 1;
          },
          rollbackTransaction: async () => {
            rollbacks += 1;
          },
          release: async () => {
            releases += 1;
          },
          manager: {
            findOne: async () => automation,
            createQueryBuilder: () => ({
              setLock() {
                return this;
              },
              where() {
                return this;
              },
              andWhere() {
                return this;
              },
              orderBy() {
                return this;
              },
              getOne: async () => ({
                id: 'run-active',
                status: 'Running',
              }),
            }),
            insert: async () => undefined,
            save: async () => undefined,
          },
        }) as any;

      const result = await service.execute({
        automationId: automation.id,
        actorUserId: automation.userId,
        trigger: 'manual',
      });

      assert.equal(result.status, 'skipped');
      assert.match(result.message || '', /already has an active run/i);
      assert.equal(events.length, 1);
      assert.equal(events[0].type, 'Run skipped');
      assert.equal(
        ((events[0].meta as Record<string, unknown> | undefined)?.reason as string | undefined) ?? null,
        'overlap-protected'
      );
      assert.equal(commits, 1);
      assert.equal(rollbacks, 0);
      assert.equal(releases, 1);
    }

    {
      const { service, events } = createService();
      let commits = 0;
      let rollbacks = 0;
      let releases = 0;

      coreDataSource.createQueryRunner = () =>
        ({
          connect: async () => undefined,
          startTransaction: async () => undefined,
          commitTransaction: async () => {
            commits += 1;
          },
          rollbackTransaction: async () => {
            rollbacks += 1;
          },
          release: async () => {
            releases += 1;
          },
          manager: {
            findOne: async () => automation,
            createQueryBuilder: () => ({
              setLock() {
                return this;
              },
              where() {
                return this;
              },
              andWhere() {
                return this;
              },
              orderBy() {
                return this;
              },
              getOne: async () => null,
            }),
            insert: async () => {
              const error = new Error('duplicate schedule') as Error & { code?: string };
              error.code = '23505';
              throw error;
            },
            save: async () => undefined,
          },
        }) as any;

      const result = await service.execute({
        automationId: automation.id,
        actorUserId: automation.userId,
        trigger: 'scheduled',
        scheduledFor: '2026-04-02T10:00:00.000Z',
      });

      assert.equal(result.status, 'skipped');
      assert.match(result.message || '', /already queued for this schedule/i);
      assert.equal(events.length, 1);
      assert.equal(events[0].type, 'Run skipped');
      assert.equal(
        ((events[0].meta as Record<string, unknown> | undefined)?.reason as string | undefined) ?? null,
        'duplicate-schedule'
      );
      assert.equal(commits, 0);
      assert.equal(rollbacks, 1);
      assert.equal(releases, 1);
    }

    {
      const { service, events } = createService();
      const runUpdates: Array<{ id: string; payload: Record<string, unknown> }> = [];
      const outputs: Array<Record<string, unknown>> = [];
      const automationRunner = {
        ...automation,
        automationType: 'backtest-runner',
        config: {
          backtestRunner: {
            kind: 'backtest-runner',
            source: 'backtest',
            backtestId: 'source-backtest-1',
          },
        },
      };
      const childFinishedAt = new Date('2026-04-02T10:05:00.000Z');

      service.automationRepository = {
        ...service.automationRepository,
        getAutomationById: async () => automationRunner,
        createAutomationEvent: async (payload: Record<string, unknown>) => {
          events.push(payload);
          return payload;
        },
      };
      service.automationRunRepository = {
        ...service.automationRunRepository,
        findById: async () => ({
          id: 'run-backtest-1',
          automationId: automationRunner.id,
          userId: automationRunner.userId,
          status: 'Running',
          startedAt: new Date('2026-04-02T10:00:00.000Z'),
          meta: {
            backtestId: 'child-backtest-1',
            lineage: {
              backtestId: 'child-backtest-1',
            },
          },
        }),
        updateRun: async (id: string, payload: Record<string, unknown>) => {
          runUpdates.push({ id, payload });
        },
      };
      service.automationRunOutputRepository = {
        createOutput: async (payload: Record<string, unknown>) => {
          outputs.push(payload);
          return payload;
        },
      };
      service.backtestRepository = {
        ...service.backtestRepository,
        getBacktestByIdAny: async () => ({
          id: 'child-backtest-1',
          userId: automationRunner.userId,
          status: 'Review',
          stability: 'Review',
          updatedAt: childFinishedAt,
          trades: 12,
          result: {
            cagr: 5.2,
            sharpe: 1.18,
            drawdown: 2.1,
            winRate: 61,
            profitFactor: 1.44,
            config: {
              automationId: automationRunner.id,
              automationRunId: 'run-backtest-1',
              inputSnapshot: {
                automationId: automationRunner.id,
                automationRunId: 'run-backtest-1',
              },
              progress: {
                state: 'completed',
                processed: 9,
                total: 9,
                percent: 100,
              },
            },
          },
        }),
        getBacktestById: async () => ({
          id: 'child-backtest-1',
          userId: automationRunner.userId,
          status: 'Review',
          stability: 'Review',
          updatedAt: childFinishedAt,
          trades: 12,
          result: {
            cagr: 5.2,
            sharpe: 1.18,
            drawdown: 2.1,
            winRate: 61,
            profitFactor: 1.44,
            config: {
              automationId: automationRunner.id,
              automationRunId: 'run-backtest-1',
              inputSnapshot: {
                automationId: automationRunner.id,
                automationRunId: 'run-backtest-1',
              },
              progress: {
                state: 'completed',
                processed: 9,
                total: 9,
                percent: 100,
              },
            },
          },
        }),
      };

      const syncResult = await service.syncBacktestRunnerLifecycleByBacktestId(
        'child-backtest-1'
      );

      assert.equal(syncResult.synced, true);
      assert.equal(runUpdates.length, 1);
      assert.equal(runUpdates[0]?.id, 'run-backtest-1');
      assert.equal(runUpdates[0]?.payload.status, 'Success');
      assert.equal(
        (runUpdates[0]?.payload.finishedAt as Date | undefined)?.toISOString(),
        childFinishedAt.toISOString()
      );
      assert.equal(
        ((runUpdates[0]?.payload.meta as Record<string, unknown> | undefined)?.childBacktestStatus as string | undefined) ?? null,
        'Completed'
      );
      assert.equal(
        ((runUpdates[0]?.payload.meta as Record<string, unknown> | undefined)?.backtestLifecycle as string | undefined) ?? null,
        'finalized'
      );
      assert.equal(events.some((item) => item.type === 'Run completed'), true);
      assert.equal(outputs.length, 1);
      assert.equal(outputs[0]?.outputType, 'backtest-runner.summary');
      assert.equal(outputs[0]?.status, 'Created');
    }
  } finally {
    coreDataSource.createQueryRunner = originalCreateQueryRunner as typeof coreDataSource.createQueryRunner;
  }
}

async function runAutomationOperationalSnapshotAssertions(): Promise<void> {
  const service = new AutomationsService() as any;

  service.automationRepository = {
    getAutomationsSummary: async (userId?: string | null) => {
      assert.equal(userId ?? null, null);
      return {
        total: 7,
        running: 3,
        paused: 2,
        failed: 1,
        draft: 1,
        connectedAccounts: 5,
      };
    },
    getAutomationEventDiagnostics: async (userId: string | null, since: Date) => {
      assert.equal(userId, null);
      assert.ok(since instanceof Date);
      return {
        overlapSkips24h: 2,
      };
    },
  };
  service.automationRunRepository = {
    getOperationalRunDiagnostics: async (since: Date) => {
      assert.ok(since instanceof Date);
      return {
        activeRuns: 2,
        failedRuns24h: 1,
      };
    },
  };
  service.automationCursorRepository = {
    getOperationalCursorDiagnostics: async (staleBefore: Date) => {
      assert.ok(staleBefore instanceof Date);
      return {
        totalCursorCount: 4,
        staleCursorCount: 1,
        lastCursorAt: '2026-04-04T11:00:00.000Z',
        lastTriggeredSignalAt: '2026-04-04T10:45:00.000Z',
      };
    },
  };
  service.readQueueHealth = async () => ({
    status: 'ok',
    latencyMs: 12,
  });
  service.readWorkerHealth = async () => ({
    status: 'ok',
    workerHttpStatus: 'ok',
    heartbeatStatus: 'ok',
    heartbeatAgeMs: 2000,
    commandPollLagMs: 1500,
  });

  const snapshot = await service.getAutomationOperationalSnapshot();

  assert.equal(snapshot.total, 7);
  assert.equal(snapshot.running, 3);
  assert.equal(snapshot.paused, 2);
  assert.equal(snapshot.failed, 1);
  assert.equal(snapshot.draft, 1);
  assert.equal(snapshot.connectedAccounts, 5);
  assert.equal(snapshot.healthStatus, 'degraded');
  assert.equal(snapshot.health, 'Degraded');
  assert.match(String(snapshot.detail || ''), /automation run/i);
  assert.equal(snapshot.summary.activeRuns, 2);
  assert.equal(snapshot.summary.failedRuns24h, 1);
  assert.equal(snapshot.summary.overlapSkips24h, 2);
  assert.equal(snapshot.summary.staleCursorCount, 1);
  assert.equal(snapshot.summary.totalCursorCount, 4);
  assert.equal(snapshot.summary.queueStatus, 'ok');
  assert.equal(snapshot.summary.workerStatus, 'ok');
}

async function main(): Promise<void> {
  runServiceSmokeAssertions();
  await runActivityQueryFilterAssertions();
  await runScopedActivitySummaryAssertions();
  await runActivityGroupingWindowAssertions();
  await runActivityRepositoryNormalizationAssertions();
  await runActivityExportRepositorySignatureAssertions();
  await runLegacyActivityStreamNormalizationAssertions();
  await runActivityMaintenanceAssertions();
  await runActivityDetailAssertions();
  await runActivityStrategyLibraryLinkAssertions();
  await runActivityExportAssertions();
  await runActivitySavedViewAssertions();
  await runActivityReadStateAssertions();
  runBrokerDefinitionEntitySchemaAssertions();
  runAlertEntitySchemaAssertions();
  runActivityEntitySchemaAssertions();
  runActivityExportEntitySchemaAssertions();
  runActivitySavedViewEntitySchemaAssertions();
  runEmailDeliveryEntitySchemaAssertions();
  runSuggestedTradeExecutionEntitySchemaAssertions();
  await runAlertDeliveryPolicyAssertions();
  await runAlertsAtomicActionAssertions();
  await runAlertDetailMappingAssertions();
  await runScopedAlertsSummaryAssertions();
  await runAlertsOverviewScopeAssertions();
  await runDiscoveryDependencyServiceAssertions();
  await runDiscoverySummaryServiceAssertions();
  await runDiscoveryFeedServiceAssertions();
  await runSchedulerOverviewUserScopeAssertions();
  await runEmailDeliveryWorkerAssertions();
  await runEmailDeliveriesServiceAssertions();
  await runSettingsAtomicSaveAssertions();
  await runConnectionsCanonicalizationAssertions();
  await runExchangeAssetsProviderCompatibilityAssertions();
  await runExchangeAssetsVisibilityAssertions();
  await runDeltaExchangeOrdersAdapterCatalogAssertions();
  await runMudrexServiceExchangeAssetFallbackAssertions();
  await runBrokerMarketFacadeCompatibilityAssertions();
  await runBrokerAccountSecretHandlingAssertions();
  await runPhase4CatalogAssertions();
  await runBrokerDefinitionServicePhase2Assertions();
  await runBrokerDefinitionRuntimeSupportAssertions();
  await runBrokerDefinitionStartupValidatorAssertions();
  runSettingsValidationAssertions();
  runWatchlistsValidationAssertions();
  runSignalAndSuggestedTradeValidationAssertions();
  await runWatchlistsLifecycleAssertions();
  await runWatchlistsConflictAssertions();
  await runWatchlistsDuplicateAddRaceAssertions();
  await runMarketsOverviewStaleSnapshotAssertions();
  await runMarketsSymbolOverviewEnrichmentAssertions();
  await runSettingsAuditContractAssertions();
  await runSettingsSchemaNormalizationAssertions();
  await runSuggestedTradeExecutionStorageMigrationAssertions();
  runStrategyLabValidationAssertions();
  runStrategyTemplateNormalizationAssertions();
  await runStrategyTemplateSuggestionImportAssertions();
  await runStrategyTemplateVersionLifecycleAssertions();
  runBacktestStatusMappingAssertions();
  await runBacktestChartServiceAssertions();
  await runBacktestRepositorySearchAssertions();
  await runStrategyTemplateSearchQueryAssertions();
  await runStrategyLibrarySearchQueryAssertions();
  await runStrategyLibrarySignalScanStatusAssertions();
  await runBacktestTopSetupCandidateQueryAssertions();
  await runAutomationScopeLookupAssertions();
  await runAutomationRepositorySearchAssertions();
  await runAutomationRepositoryIndexingAssertions();
  await runBacktestSummaryQueryAssertions();
  runBacktestTopSetupsServiceAssertions();
  runBacktestOperationalColumnExtractionAssertions();
  await runCleanupBrokerExchangeMastersMigrationAssertions();
  await runDropConnectionExchangeIdMigrationAssertions();
  await runDropBrokerAssetExchangeIdMigrationAssertions();
  await runBacktestChartDelegationAssertions();
  await runBacktestTopSetupsDelegationAssertions();
  await runBacktestRecoveryServiceAssertions();
  await runBacktestInputSnapshotServiceAssertions();
  await runBacktestInputSnapshotDelegationAssertions();
  await runBacktestRecoveryDelegationAssertions();
  await runBacktestRecoveryFailureAlertAssertions();
  await runBacktestPromotionDelegationAssertions();
  await runBacktestPromotionFailureAlertAssertions();
  await runStrategyLabBacktestHandoffAssertions();
  await runStrategyLibraryBacktestSnapshotAssertions();
  await runStrategyLibraryLifecycleGuardAssertions();
  await runStrategyLibraryStatusUpdateAssertions();
  await runStrategyLibraryImportConflictAssertions();
  await runStrategyLibraryRunDateValidationAssertions();
  await runStrategyLibraryPersistenceConstraintAssertions();
  await runStrategyLibraryTemplateMappingAssertions();
  await runStrategyLibraryDerivedListFilteringAssertions();
  await runStrategyLibraryRecentRunHistoryAssertions();
  await runBacktestPromotionSnapshotAssertions();
  await runBacktestPromotionIdempotencyAssertions();
  await runBacktestPromotionServiceFailureAlertAssertions();
  runAutomationLineageMappingAssertions();
  await runAutomationReconcileAssertions();
  await runAutomationControlHardeningAssertions();
  runAutomationTimeZoneValidationAssertions();
  runAutomationScheduleAuditAssertions();
  await runAutomationSchedulePersistenceAssertions();
  await runSuggestedTradesReadPathAssertions();
  await runSuggestedTradesSummaryFilterAssertions();
  await runSuggestedTradeTransitionAssertions();
  await runSuggestedTradeExecutionPersistenceAssertions();
  await runSuggestedTradeReconcileAssertions();
  await runSuggestedTradesBulkReconcileAssertions();
  await runSuggestedTradeExecutionSyncServiceAssertions();
  await runSuggestedTradesOverviewServiceAssertions();
  await runSuggestedTradesHealthServiceAssertions();
  await runSignalsOverviewServiceAssertions();
  await runSignalPresentationAssertions();
  await runAutomationExecutionHardeningAssertions();
  await runAutomationOperationalSnapshotAssertions();
  console.log('Service smoke assertions passed.');
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
