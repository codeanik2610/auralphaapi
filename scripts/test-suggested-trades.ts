import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { SuggestedTradesController } from '../src/api/controllers/SuggestedTradesController';
import { SuggestedTradesOverviewController } from '../src/api/controllers/SuggestedTradesOverviewController';
import { BadRequestAppError } from '../src/api/errors/AppError';
import { SuggestedTradeExecutionSyncService } from '../src/api/services/SuggestedTradeExecutionSyncService';
import { SuggestedTradesHealthService } from '../src/api/services/SuggestedTradesHealthService';
import { SuggestedTradesOverviewService } from '../src/api/services/SuggestedTradesOverviewService';
import { SuggestedTradesProtectionGuardrailService } from '../src/api/services/SuggestedTradesProtectionGuardrailService';
import { SuggestedTradesService } from '../src/api/services/SuggestedTradesService';
import {
  validateSuggestedTradeOrderLinkBody,
  validateSuggestedTradesExecutionSyncBody,
  validateSuggestedTradesQuery,
} from '../src/api/validators/suggestedTrades.validator';
import { SuggestedTrade } from '../src/database/entities/SuggestedTrade';
import { SuggestedTradeExecution } from '../src/database/entities/SuggestedTradeExecution';
import { SuggestedTradeRepository } from '../src/database/repositories/SuggestedTradeRepository';
import { coreDataSource } from '../src/database/data-source';
import { AddSuggestedTradeExecutionProtectionTracking1800001700000 } from '../src/database/migrations_baseline/1800001700000-AddSuggestedTradeExecutionProtectionTracking';
import { HardenSuggestedTradeExecutionStorage1767300010000 } from './_fixtures/migrations/1767300010000-HardenSuggestedTradeExecutionStorage';
import { DeltaExchangeOrdersAdapter } from '../src/brokers/capabilities/orders/DeltaExchangeOrdersAdapter';
import { env } from '../src/env';
import { getMetadataArgsStorage } from 'typeorm';
import {
  normalizeDeltaLiveAutoOrderSizing,
  remediateDeltaLiveProtection,
} from '../src/api/services/suggested-trades/DeltaExchangeSuggestedTradeBroker';
import {
  attachMudrexLiveAutoProtectionIfNeeded,
  normalizeMudrexLiveAutoOrderSizing,
  remediateMudrexLiveProtection,
} from '../src/api/services/suggested-trades/MudrexSuggestedTradeBroker';
import {
  isSuggestedTradeLiveAutoBrokerEnabled,
  isSuggestedTradeProtectionRepairEnabledForBroker,
  resolveLiveAutoAdaptiveRoutingModeValue,
  resolveSuggestedTradeLiveAutoRuntimeConfig,
} from '../src/api/services/suggested-trades/SuggestedTradeBrokerControls';
import {
  evaluateCustomRLadderTrailingStopMove,
  normalizeCustomRLadderTrailingStopConfig,
} from '../src/api/utils/trailingStopRLadder';
import { normalizeTradeSuggestionExecutionPolicy } from '../src/api/utils/automationType';
import type { SuggestedTradeExecutionLink } from '../src/api/contracts/SuggestedTrade';
import { AddSuggestedTradeExecutionRouteAttempts1800001800000 } from '../src/database/migrations_baseline/1800001800000-AddSuggestedTradeExecutionRouteAttempts';

function createSuccess<T>(data: T) {
  return { success: true as const, data };
}

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

const authReq = { authUser: { sub: 'user-1' } } as any;

function readBooleanEnvOverride(name: string): boolean | null {
  const raw = process.env[name];
  if (raw === undefined) {
    return null;
  }
  return ['1', 'true', 'yes', 'on'].includes(String(raw).trim().toLowerCase());
}

function readStringEnvOverride(name: string): string | null {
  const raw = process.env[name];
  return raw === undefined ? null : String(raw).trim();
}

function readArrayEnvOverride(name: string): string[] | null {
  const raw = process.env[name];
  if (raw === undefined) {
    return null;
  }
  return String(raw)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function runSuggestedTradeDeltaProtectionModePolicyAssertions(): void {
  const nativeBracketPolicy = normalizeTradeSuggestionExecutionPolicy({
    executionMode: 'live_trade_auto',
    deltaProtectionMode: 'native_bracket',
    liveConsent: { enabled: true },
    orderTemplate: {
      orderType: 'limit',
      quantityMode: 'quantity',
      quantity: 1,
      leverage: 3,
    },
  });
  assert.equal(
    (nativeBracketPolicy.orderTemplate as Record<string, unknown>).deltaProtectionMode,
    'native_bracket'
  );

  const defaultPolicy = normalizeTradeSuggestionExecutionPolicy({
    executionMode: 'live_trade_auto',
    orderTemplate: {
      orderType: 'limit',
      quantityMode: 'quantity',
      quantity: 1,
      leverage: 3,
    },
  });
  assert.equal(
    (defaultPolicy.orderTemplate as Record<string, unknown>).deltaProtectionMode,
    'reduce_only'
  );
}

async function runSuggestedTradesControllerAssertions(): Promise<void> {
  const controller: any = new SuggestedTradesController();
  const originalRolloutEnabled = env.suggestedTrades.rolloutEnabled;

  controller.suggestedTradesService = {
    getSuggestedTrades: async (...args: unknown[]) => createSuccess({ args }),
    getSuggestedTradesSummary: async (...args: unknown[]) => createSuccess({ args }),
    reconcileSuggestedTradesExecution: async (...args: unknown[]) => createSuccess({ args }),
    getSuggestedTradeById: async (...args: unknown[]) => createSuccess({ args }),
    reviewSuggestedTrade: async (...args: unknown[]) => createSuccess({ args }),
    acceptSuggestedTrade: async (...args: unknown[]) => createSuccess({ args }),
    dismissSuggestedTrade: async (...args: unknown[]) => createSuccess({ args }),
    linkSuggestedTradeOrder: async (...args: unknown[]) => createSuccess({ args }),
    reconcileSuggestedTradeExecution: async (...args: unknown[]) => createSuccess({ args }),
  };

  assert.deepEqual(
    (
      await controller.getSuggestedTrades(
        authReq,
        undefined,
        undefined,
        'Accepted',
        'working',
        'BTCUSDT',
        '1h',
        'auto-1',
        'run-1',
        'SELL',
        'breakout'
      )
    ).data.args,
    [
      'user-1',
      {
        limit: undefined,
        offset: undefined,
        status: 'Accepted',
        executionState: 'working',
        symbol: 'BTCUSDT',
        timeframe: '1h',
        automationId: 'auto-1',
        automationRunId: 'run-1',
        side: 'SELL',
        search: 'breakout',
      },
    ]
  );
  assert.deepEqual(
    (
      await controller.getSuggestedTradesSummary(
        authReq,
        'Accepted',
        'working',
        'BTCUSDT',
        '1h',
        'auto-1',
        'run-1',
        'SELL',
        'breakout'
      )
    ).data.args,
    [
      'user-1',
      {
        status: 'Accepted',
        executionState: 'working',
        symbol: 'BTCUSDT',
        timeframe: '1h',
        automationId: 'auto-1',
        automationRunId: 'run-1',
        side: 'SELL',
        search: 'breakout',
      },
    ]
  );
  assert.deepEqual(
    (
      await controller.reconcileSuggestedTradesExecution(authReq, {
        staleOnly: true,
        limit: 25,
        executionState: 'working',
      })
    ).data.args,
    [
      'user-1',
      {
        staleOnly: true,
        limit: 25,
        executionState: 'working',
      },
    ]
  );
  assert.deepEqual((await controller.getSuggestedTradeById(authReq, 'st-1')).data.args, [
    'user-1',
    'st-1',
  ]);
  assert.deepEqual(
    (
      await controller.reviewSuggestedTrade(authReq, 'st-1', {
        note: 'reviewed',
      })
    ).data.args,
    ['user-1', 'st-1', { note: 'reviewed' }]
  );
  assert.deepEqual(
    (
      await controller.acceptSuggestedTrade(authReq, 'st-2', {
        note: 'accepted',
      })
    ).data.args,
    ['user-1', 'st-2', { note: 'accepted' }]
  );
  assert.deepEqual(
    (await controller.dismissSuggestedTrade(authReq, 'st-3', { note: 'skip' })).data.args,
    ['user-1', 'st-3', { note: 'skip' }]
  );
  assert.deepEqual(
    (
      await controller.linkSuggestedTradeOrder(authReq, 'st-4', {
        executionMode: 'paper',
        paperOrderId: 'paper-1',
      })
    ).data.args,
    ['user-1', 'st-4', { executionMode: 'paper', paperOrderId: 'paper-1' }]
  );
  assert.deepEqual((await controller.reconcileSuggestedTradeExecution(authReq, 'st-4')).data.args, [
    'user-1',
    'st-4',
  ]);

  env.suggestedTrades.rolloutEnabled = false;
  await assert.rejects(
    () =>
      controller.reconcileSuggestedTradesExecution(authReq, {
        staleOnly: true,
      }),
    (error: unknown) =>
      error instanceof Error && error.message === 'Suggested trades rollout controls are disabled'
  );
  env.suggestedTrades.rolloutEnabled = originalRolloutEnabled;
}

async function runSuggestedTradesOverviewControllerAssertions(): Promise<void> {
  const controller: any = new SuggestedTradesOverviewController();
  const originalRolloutEnabled = env.suggestedTrades.rolloutEnabled;

  controller.suggestedTradesOverviewService = {
    getOverview: async (...args: unknown[]) => createSuccess({ args }),
  };

  assert.deepEqual(
    (
      await controller.getOverview(
        authReq,
        '25',
        '10',
        'Accepted',
        'working',
        'BTCUSDT',
        '1h',
        'auto-1',
        'run-1',
        'SELL',
        'breakout'
      )
    ).data.args,
    [
      'user-1',
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
    ]
  );

  env.suggestedTrades.rolloutEnabled = false;
  await assert.rejects(
    () => controller.getOverview(authReq),
    (error: unknown) =>
      error instanceof Error && error.message === 'Suggested trades overview rollout is disabled'
  );
  env.suggestedTrades.rolloutEnabled = originalRolloutEnabled;
}

function runSuggestedTradeExecutionEntitySchemaAssertions(): void {
  const suggestedTradeIndexes = getMetadataArgsStorage()
    .indices.filter((entry) => entry.target === SuggestedTrade)
    .map((entry) => entry.name);

  for (const indexName of [
    'idx_suggested_trades_user_automation_status_signal_time',
    'idx_suggested_trades_user_run_signal_time',
  ]) {
    assert.ok(
      suggestedTradeIndexes.includes(indexName),
      `SuggestedTrade should define ${indexName}`
    );
  }

  const executionIndexes = getMetadataArgsStorage()
    .indices.filter((entry) => entry.target === SuggestedTradeExecution)
    .map((entry) => entry.name);

  for (const indexName of [
    'idx_suggested_trade_executions_user_order_lookup',
    'idx_suggested_trade_executions_user_paper_order_lookup',
    'idx_suggested_trade_executions_user_position_lookup',
    'idx_suggested_trade_executions_user_state_seen_at',
    'idx_suggested_trade_executions_protection_state',
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
  for (const [propertyName, columnName] of [
    ['protectionState', 'protection_state'],
    ['protectionSource', 'protection_source'],
    ['protectionPlan', 'protection_plan_json'],
    ['routeAttempts', 'route_attempts_json'],
    ['protectionAttempts', 'protection_attempts'],
    ['protectionLastError', 'protection_last_error'],
    ['protectionCheckedAt', 'protection_checked_at'],
    ['protectionAttachedAt', 'protection_attached_at'],
  ]) {
    assert.equal(
      executionColumns.find((column) => column.propertyName === propertyName)?.options.name,
      columnName
    );
  }
}

function runSuggestedTradeValidationAssertions(): void {
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

  const validatedOrderLink = validateSuggestedTradeOrderLinkBody({
    executionMode: ' paper ',
    paperOrderId: ' paper-1 ',
    brokerKey: ' mudrex ',
    accountId: ' acc-1 ',
    entryPrice: '100.5',
    note: ' linked ',
  });

  assert.equal(validatedOrderLink.executionMode, 'paper');
  assert.equal(validatedOrderLink.paperOrderId, 'paper-1');
  assert.equal(validatedOrderLink.brokerKey, 'mudrex');
  assert.equal(validatedOrderLink.accountId, 'acc-1');
  assert.equal(validatedOrderLink.entryPrice, 100.5);
  assert.equal(validatedOrderLink.note, 'linked');
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
  assert.equal(createdIndexes.includes('idx_suggested_trade_executions_user_order_lookup'), true);
  assert.equal(
    createdIndexes.includes('idx_suggested_trades_user_automation_status_signal_time'),
    true
  );
  assert.equal(createdForeignKeys.includes('fk_suggested_trade_executions_trade'), true);
  assert.equal(createdForeignKeys.includes('fk_paper_orders_suggested_trade'), true);
  assert.equal(createdForeignKeys.includes('fk_automation_run_outputs_suggested_trade'), true);
  assert.equal(
    executedQueries.some((sql) => sql.includes('INSERT INTO suggested_trade_executions')),
    true
  );
  assert.equal(
    executedQueries.some((sql) => sql.includes("JSON_REMOVE(meta_json, '$.execution')")),
    true
  );
}

async function runSuggestedTradeExecutionProtectionMigrationAssertions(): Promise<void> {
  const migration = new AddSuggestedTradeExecutionProtectionTracking1800001700000();
  const addedColumns: string[] = [];
  const createdIndexes: string[] = [];
  const executedQueries: string[] = [];
  const tableState = {
    columns: new Set<string>(),
    indices: new Set<string>(),
  };

  await migration.up({
    async hasTable(tableName: string) {
      return tableName === 'suggested_trade_executions';
    },
    async hasColumn(tableName: string, columnName: string) {
      return tableName === 'suggested_trade_executions' && tableState.columns.has(columnName);
    },
    async addColumn(tableName: string, column: { name?: string }) {
      assert.equal(tableName, 'suggested_trade_executions');
      const name = String(column.name || '');
      addedColumns.push(name);
      tableState.columns.add(name);
    },
    async getTable(tableName: string) {
      assert.equal(tableName, 'suggested_trade_executions');
      return {
        indices: [...tableState.indices].map((name) => ({ name })),
      };
    },
    async createIndex(tableName: string, index: { name?: string }) {
      assert.equal(tableName, 'suggested_trade_executions');
      const name = String(index.name || '');
      createdIndexes.push(name);
      tableState.indices.add(name);
    },
    async query(sql: string) {
      executedQueries.push(sql);
      return [];
    },
  } as any);

  assert.deepEqual(addedColumns, [
    'protection_state',
    'protection_source',
    'protection_plan_json',
    'protection_attempts',
    'protection_last_error',
    'protection_checked_at',
    'protection_attached_at',
  ]);
  assert.equal(createdIndexes.includes('idx_suggested_trade_executions_protection_state'), true);
  assert.equal(
    executedQueries.some(
      (sql) =>
        sql.includes('JSON_OBJECT') &&
        sql.includes('waiting_for_fill') &&
        sql.includes('waiting_for_position')
    ),
    true
  );
}

async function runSuggestedTradeExecutionRouteAttemptsMigrationAssertions(): Promise<void> {
  const migration = new AddSuggestedTradeExecutionRouteAttempts1800001800000();
  const addedColumns: string[] = [];
  const droppedColumns: string[] = [];
  const tableState = {
    columns: new Set<string>(),
  };

  await migration.up({
    async hasTable(tableName: string) {
      return tableName === 'suggested_trade_executions';
    },
    async hasColumn(tableName: string, columnName: string) {
      return tableName === 'suggested_trade_executions' && tableState.columns.has(columnName);
    },
    async addColumn(tableName: string, column: { name?: string }) {
      assert.equal(tableName, 'suggested_trade_executions');
      const name = String(column.name || '');
      addedColumns.push(name);
      tableState.columns.add(name);
    },
  } as any);

  assert.deepEqual(addedColumns, ['route_attempts_json']);

  await migration.down({
    async hasTable(tableName: string) {
      return tableName === 'suggested_trade_executions';
    },
    async hasColumn(tableName: string, columnName: string) {
      return tableName === 'suggested_trade_executions' && tableState.columns.has(columnName);
    },
    async dropColumn(tableName: string, columnName: string) {
      assert.equal(tableName, 'suggested_trade_executions');
      droppedColumns.push(columnName);
      tableState.columns.delete(columnName);
    },
  } as any);

  assert.deepEqual(droppedColumns, ['route_attempts_json']);
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
      routeDecision: {
        mode: 'adaptive_candidate_live',
        decision: 'selected',
        requestedSymbol: 'BTCUSDT',
        selectedBrokerKey: 'mudrex',
        selectedAccountId: 'acc-1',
        selectedAccountName: 'Mudrex Prod',
        selectedBrokerSymbol: 'BTCUSDT',
        selectionReason: 'best_viable_candidate',
        summary: 'Selected mudrex (Mudrex Prod) using broker symbol BTCUSDT.',
        decidedAt: new Date(now - 40_000).toISOString(),
        candidates: [
          {
            brokerKey: 'mudrex',
            accountId: 'acc-1',
            accountName: 'Mudrex Prod',
            requestedSymbol: 'BTCUSDT',
            brokerSymbol: 'BTCUSDT',
            candidateSymbols: ['BTCUSDT'],
            resolvedVia: 'catalog_exact',
            supported: true,
            supportMessage: null,
            allowed: true,
            blocked: false,
            summary: 'All clear',
            warningRuleCount: 0,
            blockingRuleCount: 0,
            freshnessState: 'fresh',
          },
        ],
      },
      execution: {
        executionMode: 'paper',
        paperOrderId: 'paper-1',
        executionState: 'linked',
        linkedAt: new Date(now - 30_000).toISOString(),
        routeAttempts: [
          {
            attemptNumber: 1,
            candidateRank: 1,
            brokerKey: 'delta_exchange',
            accountId: 'delta-acc-1',
            accountName: 'Delta Prod',
            requestedSymbol: 'BTCUSDT',
            brokerSymbol: 'BTCUSDT',
            status: 'failed',
            startedAt: new Date(now - 38_000).toISOString(),
            finishedAt: new Date(now - 37_000).toISOString(),
            submissionState: 'rejected',
            failureClassification: 'confirmed_no_order',
            failureCode: 'ORDER_REJECTED_INSUFFICIENT_MARGIN',
            failureMessage: 'Order rejected: insufficient margin',
          },
          {
            attemptNumber: 2,
            candidateRank: 2,
            brokerKey: 'mudrex',
            accountId: 'acc-1',
            accountName: 'Mudrex Prod',
            requestedSymbol: 'BTCUSDT',
            brokerSymbol: 'BTCUSDT',
            status: 'placed',
            startedAt: new Date(now - 36_000).toISOString(),
            finishedAt: new Date(now - 35_000).toISOString(),
            submissionState: 'accepted',
            orderId: 'paper-1',
            orderStatus: 'OPEN',
          },
        ],
        protectionState: 'attached',
        protectionCheckedAt: new Date(now - 25_000).toISOString(),
        protectionAttachedAt: new Date(now - 24_000).toISOString(),
        protectionPlan: {
          stopLossOrderId: 'sl-1',
          takeProfitOrderId: 'tp-1',
        },
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
  assert.equal(listResponse.data.items[0]?.routeDecision?.selectedBrokerKey, 'mudrex');
  assert.equal(listResponse.data.items[0]?.routeDecision?.selectedBrokerSymbol, 'BTCUSDT');
  assert.deepEqual(listResponse.data.items[0]?.allowedActions, ['reconcile_execution']);
  assert.equal(listResponse.data.items[0]?.statusDisplay, 'Order Linked');
  assert.equal(listResponse.data.items[0]?.reviewStage, 'accepted');
  assert.equal(listResponse.data.items[0]?.executionStage, 'linked');
  assert.equal(listResponse.data.items[0]?.journeyStage, 'track_execution');
  assert.equal(listResponse.data.items[0]?.syncStatus?.state, 'fresh');
  assert.equal(listResponse.data.items[0]?.lifecycle?.order?.entity, 'paper_order');
  assert.ok(
    listResponse.data.items[0]?.linkedEntities?.some(
      (entity: { entity: string }) => entity.entity === 'paper_order'
    )
  );

  const detailResponse = await service.getSuggestedTradeById('user-1', 'st-1');
  assert.equal(detailResponse.data.id, 'st-1');
  assert.equal(detailResponse.data.statusDisplay, 'Order Linked');
  assert.equal(
    detailResponse.data.routeDecision?.summary,
    'Selected mudrex (Mudrex Prod) using broker symbol BTCUSDT.'
  );
  assert.equal(detailResponse.data.syncStatus?.state, 'fresh');
  assert.ok((detailResponse.data.timeline?.length ?? 0) >= 3);
  assert.ok(
    detailResponse.data.timeline?.some(
      (event: { kind: string; label: string; status?: string | null }) =>
        event.kind === 'broker_route' &&
        event.label === 'Broker route 1 failed' &&
        event.status === 'failed'
    )
  );
  assert.ok(
    detailResponse.data.timeline?.some(
      (event: { kind: string; label: string }) =>
        event.kind === 'protection' && event.label === 'Protection attached'
    )
  );
}

async function runSuggestedTradesSummaryFilterAssertions(): Promise<void> {
  const service = new SuggestedTradesService() as any;
  let capturedUserId: string | null = null;
  let capturedQuery: Record<string, unknown> | null = null;
  let capturedAuditQuery: Record<string, unknown> | null = null;

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
    async listSuggestedTradesForFreshnessAudit(query: Record<string, unknown>) {
      capturedAuditQuery = query;
      return {
        sampled: 1,
        total: 1,
        items: [
          {
            id: 'st-audit-1',
            symbol: 'BTCUSDT',
            timeframe: '1h',
            side: 'BUY',
            signalTime: new Date('2026-04-04T10:00:00.000Z'),
            createdAt: new Date('2026-04-04T10:01:00.000Z'),
            updatedAt: new Date('2026-04-04T10:01:00.000Z'),
            meta: {
              signalSelectionMode: 'latest_closed_only',
            },
            executionRecord: {
              executionMode: 'live',
              executionState: 'filled',
              brokerKey: 'mudrex',
              accountId: 'acct-1',
              filledAt: new Date('2026-04-04T11:20:00.000Z'),
            },
          },
        ],
      };
    },
  };
  service.activityRepository = {
    async countOperationalActivities(query: Record<string, unknown>) {
      assert.equal(query.userId, 'user-1');
      assert.ok(query.createdAfter instanceof Date);
      if (query.titleLike === 'Live auto stale signal skipped') {
        return 1;
      }
      if (query.titleLike === 'Stale suggested trade blocked') {
        return 0;
      }
      return 0;
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
  assert.equal(response.data.accepted, 1);
  assert.equal(response.data.working, 1);
  assert.notEqual(capturedAuditQuery, null);
  const auditQuery = capturedAuditQuery as unknown as Record<string, unknown>;
  assert.equal(auditQuery.userId, 'user-1');
  assert.equal(auditQuery.automationId, 'auto-1');
  assert.equal(response.data.freshnessAudit?.totalSignals, 1);
  assert.equal(response.data.freshnessAudit?.averageSignalToOpenMinutes, 80);
  assert.equal(response.data.freshnessAudit?.staleOpenCount, 1);
  assert.equal(response.data.freshnessAudit?.staleBlockedCount, 1);
  assert.equal(response.data.freshnessAudit?.latestClosedOnlyCount, 1);
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
    assert.equal((savedMeta?.review as Record<string, unknown> | undefined)?.status, 'Accepted');
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
      () =>
        service.reviewSuggestedTrade('user-1', 'st-accepted', {
          note: 'back to review',
        }),
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
      () =>
        service.dismissSuggestedTrade('user-1', 'st-linked', {
          note: 'cancel it',
        }),
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
    async emitNotificationAlert() {
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
  assert.equal(savedExecutionPayload?.['protectionState'], 'not_required');
  assert.deepEqual(savedTradeMeta, { signalId: 'sig-1' });
  assert.equal(response.data.suggestedTrade.execution?.paperOrderId, 'paper-1');

  const liveProtectionPayload = service.toExecutionPersistencePayload(
    { ...trade, meta: null },
    {
      executionMode: 'live',
      orderId: 'live-order-1',
      brokerKey: 'mudrex',
      accountId: 'acc-1',
      executionState: 'linked',
      entryPrice: '100',
      stopLossPrice: '95',
      takeProfitPrice: '110',
    }
  );
  assert.equal(liveProtectionPayload.protectionState, 'waiting_for_fill');
  assert.equal(liveProtectionPayload.protectionSource, 'suggested_trade_execution');
  assert.equal(liveProtectionPayload.protectionPlan?.['stopLossPrice'], '95');

  const routeAttemptExecution: SuggestedTradeExecutionLink = {
    executionMode: 'live',
    executionState: 'failed',
    routeAttempts: [
      {
        attemptNumber: 1,
        candidateRank: 1,
        brokerKey: 'delta_exchange',
        accountId: 'delta-prod',
        accountName: 'Delta Production',
        requestedSymbol: 'RSRUSDT',
        brokerSymbol: 'RSRUSD',
        status: 'failed',
        startedAt: '2026-05-10T15:21:25.000Z',
        finishedAt: '2026-05-10T15:21:27.000Z',
        preTradeCheckId: 'pre-1',
        preTradeState: 'passed',
        submissionState: 'rejected',
        failureClassification: 'confirmed_no_order',
        failureCode: 'ORDER_REJECTED_INSUFFICIENT_MARGIN',
        failureMessage: 'Order rejected: insufficient margin for this route.',
        requestSummary: {
          orderType: 'limit',
          leverage: 15,
        },
        brokerResponseSummary: {
          availableBalance: '0.0000974975',
        },
        reconciliation: {
          status: 'not_required',
          checkedAt: '2026-05-10T15:21:27.000Z',
        },
      },
    ],
  };
  const routeAttemptPayload = service.toExecutionPersistencePayload(
    { ...trade, meta: null },
    routeAttemptExecution
  );
  assert.equal(
    (routeAttemptPayload.routeAttempts?.[0] as Record<string, unknown> | undefined)?.failureCode,
    'ORDER_REJECTED_INSUFFICIENT_MARGIN'
  );
  assert.equal(
    (routeAttemptPayload.routeAttempts?.[0] as Record<string, unknown> | undefined)?.brokerSymbol,
    'RSRUSD'
  );

  const mappedExecution = service.mapExecutionRecord({
    ...routeAttemptPayload,
    routeAttempts: JSON.stringify(routeAttemptPayload.routeAttempts),
  });
  assert.equal(mappedExecution?.routeAttempts?.[0]?.failureClassification, 'confirmed_no_order');
  assert.equal(mappedExecution?.routeAttempts?.[0]?.reconciliation?.status, 'not_required');
}

async function runSuggestedTradeBrokerControlHelperAssertions(): Promise<void> {
  const originalRolloutEnabled = env.suggestedTrades.rolloutEnabled;
  const originalEnvFlags = {
    rolloutEnabled: process.env.SUGGESTED_TRADES_ROLLOUT_ENABLED,
    enabled: process.env.SUGGESTED_TRADES_LIVE_AUTO_ENABLED,
    executionEnabled: process.env.SUGGESTED_TRADES_LIVE_AUTO_EXECUTION_ENABLED,
    mudrexEnabled: process.env.SUGGESTED_TRADES_LIVE_AUTO_MUDREX_ENABLED,
    deltaExchangeEnabled: process.env.SUGGESTED_TRADES_LIVE_AUTO_DELTA_EXCHANGE_ENABLED,
    adaptiveRoutingMode: process.env.SUGGESTED_TRADES_LIVE_AUTO_ADAPTIVE_ROUTING_MODE,
    requireFixedRouting: process.env.SUGGESTED_TRADES_LIVE_AUTO_REQUIRE_FIXED_ROUTING,
    userAllowlist: process.env.SUGGESTED_TRADES_LIVE_AUTO_USER_ALLOWLIST,
    brokerAllowlist: process.env.SUGGESTED_TRADES_LIVE_AUTO_BROKER_ALLOWLIST,
    shadowBrokerAllowlist: process.env.SUGGESTED_TRADES_LIVE_AUTO_SHADOW_BROKER_ALLOWLIST,
    mudrexRepairEnabled: process.env.SUGGESTED_TRADES_PROTECTION_REPAIR_MUDREX_ENABLED,
    deltaRepairEnabled: process.env.SUGGESTED_TRADES_PROTECTION_REPAIR_DELTA_EXCHANGE_ENABLED,
  };
  const originalLiveAuto = {
    enabled: env.suggestedTrades.liveAuto.enabled,
    executionEnabled: env.suggestedTrades.liveAuto.executionEnabled,
    mudrexEnabled: env.suggestedTrades.liveAuto.mudrexEnabled,
    deltaExchangeEnabled: env.suggestedTrades.liveAuto.deltaExchangeEnabled,
    adaptiveRoutingMode: env.suggestedTrades.liveAuto.adaptiveRoutingMode,
    requireFixedRouting: env.suggestedTrades.liveAuto.requireFixedRouting,
    userAllowlist: [...env.suggestedTrades.liveAuto.userAllowlist],
    brokerAllowlist: [...env.suggestedTrades.liveAuto.brokerAllowlist],
    shadowBrokerAllowlist: [...env.suggestedTrades.liveAuto.shadowBrokerAllowlist],
  };
  const originalProtectionRepair = {
    mudrexEnabled: env.suggestedTrades.protectionRepair.mudrexEnabled,
    deltaExchangeEnabled: env.suggestedTrades.protectionRepair.deltaExchangeEnabled,
  };

  try {
    env.suggestedTrades.rolloutEnabled = false;
    env.suggestedTrades.liveAuto.enabled = true;
    env.suggestedTrades.liveAuto.executionEnabled = false;
    env.suggestedTrades.liveAuto.mudrexEnabled = false;
    env.suggestedTrades.liveAuto.deltaExchangeEnabled = true;
    env.suggestedTrades.liveAuto.adaptiveRoutingMode = 'live';
    env.suggestedTrades.liveAuto.requireFixedRouting = true;
    env.suggestedTrades.liveAuto.userAllowlist = ['env-user'];
    env.suggestedTrades.liveAuto.brokerAllowlist = ['mudrex'];
    env.suggestedTrades.liveAuto.shadowBrokerAllowlist = [];

    process.env.SUGGESTED_TRADES_ROLLOUT_ENABLED = 'true';
    process.env.SUGGESTED_TRADES_LIVE_AUTO_ENABLED = 'false';
    process.env.SUGGESTED_TRADES_LIVE_AUTO_EXECUTION_ENABLED = 'true';
    process.env.SUGGESTED_TRADES_LIVE_AUTO_MUDREX_ENABLED = 'true';
    process.env.SUGGESTED_TRADES_LIVE_AUTO_DELTA_EXCHANGE_ENABLED = 'false';
    process.env.SUGGESTED_TRADES_LIVE_AUTO_ADAPTIVE_ROUTING_MODE = 'shadow';
    process.env.SUGGESTED_TRADES_LIVE_AUTO_REQUIRE_FIXED_ROUTING = 'false';
    process.env.SUGGESTED_TRADES_LIVE_AUTO_USER_ALLOWLIST = 'user-1, user-2';
    process.env.SUGGESTED_TRADES_LIVE_AUTO_BROKER_ALLOWLIST = ' MUDREX,delta_exchange ';
    process.env.SUGGESTED_TRADES_LIVE_AUTO_SHADOW_BROKER_ALLOWLIST =
      'mudrex, delta_exchange, mudrex';

    const config = resolveSuggestedTradeLiveAutoRuntimeConfig({
      readBooleanEnvOverride,
      readStringEnvOverride,
      readArrayEnvOverride,
    });

    assert.equal(config.rolloutEnabled, true);
    assert.equal(config.enabled, false);
    assert.equal(config.executionEnabled, true);
    assert.equal(config.mudrexEnabled, true);
    assert.equal(config.deltaExchangeEnabled, false);
    assert.equal(config.adaptiveRoutingMode, 'shadow');
    assert.equal(config.requireFixedRouting, false);
    assert.deepEqual(config.userAllowlist, ['user-1', 'user-2']);
    assert.deepEqual(config.brokerAllowlist, ['mudrex', 'delta_exchange']);
    assert.deepEqual(config.shadowBrokerAllowlist, ['mudrex', 'delta_exchange']);
    assert.equal(isSuggestedTradeLiveAutoBrokerEnabled(config, 'mudrex'), true);
    assert.equal(isSuggestedTradeLiveAutoBrokerEnabled(config, 'delta_exchange'), false);
    assert.equal(isSuggestedTradeLiveAutoBrokerEnabled(config, 'binance'), true);
    assert.equal(resolveLiveAutoAdaptiveRoutingModeValue('bad-value'), 'live');

    env.suggestedTrades.protectionRepair.mudrexEnabled = true;
    env.suggestedTrades.protectionRepair.deltaExchangeEnabled = false;
    process.env.SUGGESTED_TRADES_PROTECTION_REPAIR_MUDREX_ENABLED = 'false';
    process.env.SUGGESTED_TRADES_PROTECTION_REPAIR_DELTA_EXCHANGE_ENABLED = 'true';
    assert.equal(
      isSuggestedTradeProtectionRepairEnabledForBroker('mudrex', readBooleanEnvOverride),
      false
    );
    assert.equal(
      isSuggestedTradeProtectionRepairEnabledForBroker('delta_exchange', readBooleanEnvOverride),
      true
    );
    assert.equal(
      isSuggestedTradeProtectionRepairEnabledForBroker('unknown', readBooleanEnvOverride),
      true
    );
  } finally {
    env.suggestedTrades.rolloutEnabled = originalRolloutEnabled;
    env.suggestedTrades.liveAuto.enabled = originalLiveAuto.enabled;
    env.suggestedTrades.liveAuto.executionEnabled = originalLiveAuto.executionEnabled;
    env.suggestedTrades.liveAuto.mudrexEnabled = originalLiveAuto.mudrexEnabled;
    env.suggestedTrades.liveAuto.deltaExchangeEnabled = originalLiveAuto.deltaExchangeEnabled;
    env.suggestedTrades.liveAuto.adaptiveRoutingMode = originalLiveAuto.adaptiveRoutingMode;
    env.suggestedTrades.liveAuto.requireFixedRouting = originalLiveAuto.requireFixedRouting;
    env.suggestedTrades.liveAuto.userAllowlist = [...originalLiveAuto.userAllowlist];
    env.suggestedTrades.liveAuto.brokerAllowlist = [...originalLiveAuto.brokerAllowlist];
    env.suggestedTrades.liveAuto.shadowBrokerAllowlist = [
      ...originalLiveAuto.shadowBrokerAllowlist,
    ];
    env.suggestedTrades.protectionRepair.mudrexEnabled = originalProtectionRepair.mudrexEnabled;
    env.suggestedTrades.protectionRepair.deltaExchangeEnabled =
      originalProtectionRepair.deltaExchangeEnabled;
    restoreEnv('SUGGESTED_TRADES_ROLLOUT_ENABLED', originalEnvFlags.rolloutEnabled);
    restoreEnv('SUGGESTED_TRADES_LIVE_AUTO_ENABLED', originalEnvFlags.enabled);
    restoreEnv('SUGGESTED_TRADES_LIVE_AUTO_EXECUTION_ENABLED', originalEnvFlags.executionEnabled);
    restoreEnv('SUGGESTED_TRADES_LIVE_AUTO_MUDREX_ENABLED', originalEnvFlags.mudrexEnabled);
    restoreEnv(
      'SUGGESTED_TRADES_LIVE_AUTO_DELTA_EXCHANGE_ENABLED',
      originalEnvFlags.deltaExchangeEnabled
    );
    restoreEnv(
      'SUGGESTED_TRADES_LIVE_AUTO_ADAPTIVE_ROUTING_MODE',
      originalEnvFlags.adaptiveRoutingMode
    );
    restoreEnv(
      'SUGGESTED_TRADES_LIVE_AUTO_REQUIRE_FIXED_ROUTING',
      originalEnvFlags.requireFixedRouting
    );
    restoreEnv('SUGGESTED_TRADES_LIVE_AUTO_USER_ALLOWLIST', originalEnvFlags.userAllowlist);
    restoreEnv('SUGGESTED_TRADES_LIVE_AUTO_BROKER_ALLOWLIST', originalEnvFlags.brokerAllowlist);
    restoreEnv(
      'SUGGESTED_TRADES_LIVE_AUTO_SHADOW_BROKER_ALLOWLIST',
      originalEnvFlags.shadowBrokerAllowlist
    );
    restoreEnv(
      'SUGGESTED_TRADES_PROTECTION_REPAIR_MUDREX_ENABLED',
      originalEnvFlags.mudrexRepairEnabled
    );
    restoreEnv(
      'SUGGESTED_TRADES_PROTECTION_REPAIR_DELTA_EXCHANGE_ENABLED',
      originalEnvFlags.deltaRepairEnabled
    );
  }
}

async function runSuggestedTradeLiveAutoRolloutAssertions(): Promise<void> {
  const service = new SuggestedTradesService() as any;
  service.liveAutoLifecycleMonitorEnabled = false;
  const originalRolloutEnabled = env.suggestedTrades.rolloutEnabled;
  const originalEnvFlags = {
    rolloutEnabled: process.env.SUGGESTED_TRADES_ROLLOUT_ENABLED,
    enabled: process.env.SUGGESTED_TRADES_LIVE_AUTO_ENABLED,
    executionEnabled: process.env.SUGGESTED_TRADES_LIVE_AUTO_EXECUTION_ENABLED,
    mudrexEnabled: process.env.SUGGESTED_TRADES_LIVE_AUTO_MUDREX_ENABLED,
    deltaExchangeEnabled: process.env.SUGGESTED_TRADES_LIVE_AUTO_DELTA_EXCHANGE_ENABLED,
    adaptiveRoutingMode: process.env.SUGGESTED_TRADES_LIVE_AUTO_ADAPTIVE_ROUTING_MODE,
    requireFixedRouting: process.env.SUGGESTED_TRADES_LIVE_AUTO_REQUIRE_FIXED_ROUTING,
    userAllowlist: process.env.SUGGESTED_TRADES_LIVE_AUTO_USER_ALLOWLIST,
    brokerAllowlist: process.env.SUGGESTED_TRADES_LIVE_AUTO_BROKER_ALLOWLIST,
    shadowBrokerAllowlist: process.env.SUGGESTED_TRADES_LIVE_AUTO_SHADOW_BROKER_ALLOWLIST,
  };
  const originalLiveAuto = {
    enabled: env.suggestedTrades.liveAuto.enabled,
    executionEnabled: env.suggestedTrades.liveAuto.executionEnabled,
    mudrexEnabled: env.suggestedTrades.liveAuto.mudrexEnabled,
    deltaExchangeEnabled: env.suggestedTrades.liveAuto.deltaExchangeEnabled,
    adaptiveRoutingMode: env.suggestedTrades.liveAuto.adaptiveRoutingMode,
    requireFixedRouting: env.suggestedTrades.liveAuto.requireFixedRouting,
    userAllowlist: [...env.suggestedTrades.liveAuto.userAllowlist],
    brokerAllowlist: [...env.suggestedTrades.liveAuto.brokerAllowlist],
    shadowBrokerAllowlist: [...env.suggestedTrades.liveAuto.shadowBrokerAllowlist],
  };
  const freshOneHourSignalTime = new Date(Date.now() - 62 * 60 * 1000);

  const baseTrade = {
    id: 'st-live-auto',
    automationId: 'auto-live',
    automationRunId: 'run-live',
    userId: 'user-1',
    symbol: 'BTCUSDT',
    timeframe: '1h',
    side: 'BUY',
    signalTime: freshOneHourSignalTime,
    status: 'Open',
    confidence: 0.88,
    score: 92,
    entryPrice: '100',
    stopLossPrice: '95',
    takeProfitTargets: ['108'],
    entryRule: 'breakout',
    exitRule: 'trail',
    rationale: 'Momentum continuation',
    dedupeKey: 'dedupe-live-auto',
    meta: null,
    createdAt: new Date(freshOneHourSignalTime.getTime() + 60 * 60 * 1000 + 30 * 1000),
    updatedAt: new Date(freshOneHourSignalTime.getTime() + 60 * 60 * 1000 + 60 * 1000),
  };

  let preTradeGateCalls = 0;
  let persistedExecution: Record<string, unknown> | null = null;
  const loggedActivities: string[] = [];
  let currentBrokerKey = 'mudrex';
  let currentAccountId = 'acc-1';
  let currentAssetExternalId = 'mudrex-asset-1';
  let currentRemoteAssetId = 'mudrex-asset-remote';

  service.suggestedTradeRepository = {
    async getSuggestedTradeById() {
      return { ...baseTrade };
    },
    async countSystemAcceptedExecutionsSince() {
      return 0;
    },
    async countActiveExecutionsForAutomation() {
      return 0;
    },
    async saveSuggestedTrade(trade: Record<string, unknown>) {
      return {
        ...trade,
        updatedAt: new Date('2026-04-18T04:02:00.000Z'),
      };
    },
    async saveSuggestedTradeExecution(payload: Record<string, unknown>) {
      return {
        ...payload,
        createdAt: new Date('2026-04-18T04:02:00.000Z'),
        updatedAt: new Date('2026-04-18T04:02:00.000Z'),
      };
    },
  };
  service.exchangeAssetRepository = {
    async getSystemAssetBySourceAndSymbol() {
      return {
        externalId: currentAssetExternalId,
      };
    },
    async listSystemAssetsBySourceAndSymbols(_source: string, symbols: string[]) {
      const normalizedSymbols = symbols.map((item) => String(item).trim().toUpperCase());
      const exactSymbol = normalizedSymbols[0] || 'BTCUSDT';
      return [
        {
          symbol: exactSymbol,
          externalId: currentAssetExternalId,
        },
      ];
    },
  };
  service.brokerReferenceDataService = {
    async getFuturesAssetDetailBySymbol() {
      return {
        data: {
          id: currentRemoteAssetId,
        },
      };
    },
  };
  service.brokerRuntimeRegistry = {
    getOrdersAdapter(brokerKey: string) {
      if (brokerKey !== 'delta_exchange') {
        return {};
      }
      return {
        async preflightLiveAutoOrder(assetId: string, body: Record<string, unknown>) {
          assert.equal(assetId, currentAssetExternalId);
          assert.equal(String(body.symbol || '').toUpperCase(), 'BTCUSDT');
          return {
            quantityContracts: 1000,
            contractValue: 0.001,
            contractUnitCurrency: 'BTC',
            auditNote:
              'Delta product preflight passed for BTCUSD: product 45678 is live/operational, contract_value 0.001 BTC, requested base quantity 1 BTC routes as 1000 contracts.',
          };
        },
      };
    },
  };
  service.brokerAccountRepository = {
    async getConnectedBrokerAccounts() {
      return [];
    },
  };
  service.positionReadModelRepository = {
    async listLivePositionsForAccounts() {
      return new Map();
    },
  };
  service.ordersSnapshotSourceRepository = {
    async listOpenOrdersForAccounts() {
      return new Map();
    },
  };
  service.loadTradeSuggestionExecutionPolicy = async () => ({
    executionMode: 'live_trade_auto',
    approvalMode: 'auto_if_safe',
    routeMode: 'fixed',
    brokerKey: currentBrokerKey,
    accountId: currentAccountId,
    liveConsentEnabled: true,
    orderType: 'limit',
    timeInForce: 'GTC',
    quantityMode: 'notional',
    quantity: null,
    notional: 100,
    riskPercent: null,
    leverage: null,
    reduceOnly: false,
    maxOrdersPerRun: 2,
    maxOrdersPerDay: 3,
    maxConcurrentOpenTrades: 1,
    maxNotionalPerTrade: null,
    maxNotionalPerDay: null,
    dedupeWindowSeconds: 3600,
    freshness: {
      enabled: true,
      graceSeconds: null,
      timeframeGraceSeconds: {
        '1h': 600,
      },
    },
  });
  service.runPreTradeGate = async () => {
    preTradeGateCalls += 1;
    return {
      result: {
        checkId: 'check-live-1',
        decision: {
          summary: 'All clear',
        },
        request: {
          routing: {
            brokerKey: currentBrokerKey,
            accountId: currentAccountId,
          },
          order: {
            entryPrice: 100,
            stopLossPrice: 95,
            takeProfitTargets: [108],
            leverage: 5,
            reduceOnly: false,
            orderType: 'limit',
          },
        },
      },
      execution: {
        executionMode: 'live',
        preTradeState: 'passed',
        brokerKey: currentBrokerKey,
        accountId: currentAccountId,
        leverage: 5,
        quantity: 1,
      },
      ready: true,
    };
  };
  service.persistExecutionState = async (
    _trade: Record<string, unknown>,
    execution: Record<string, unknown>
  ) => {
    persistedExecution = { ...execution };
  };
  service.operationalEventService = {
    async logActivity(_userId: string, payload: Record<string, unknown>) {
      loggedActivities.push(String(payload.title || ''));
      return undefined;
    },
    async emitFailureAlert() {
      return undefined;
    },
    async emitNotificationAlert() {
      return undefined;
    },
  };

  try {
    env.suggestedTrades.rolloutEnabled = true;
    env.suggestedTrades.liveAuto.enabled = false;
    env.suggestedTrades.liveAuto.executionEnabled = false;
    env.suggestedTrades.liveAuto.mudrexEnabled = false;
    env.suggestedTrades.liveAuto.deltaExchangeEnabled = false;
    env.suggestedTrades.liveAuto.requireFixedRouting = true;
    env.suggestedTrades.liveAuto.userAllowlist = ['user-1'];
    env.suggestedTrades.liveAuto.brokerAllowlist = ['mudrex'];
    env.suggestedTrades.liveAuto.shadowBrokerAllowlist = [];
    process.env.SUGGESTED_TRADES_ROLLOUT_ENABLED = 'true';
    process.env.SUGGESTED_TRADES_LIVE_AUTO_ENABLED = 'false';
    process.env.SUGGESTED_TRADES_LIVE_AUTO_EXECUTION_ENABLED = 'false';
    process.env.SUGGESTED_TRADES_LIVE_AUTO_REQUIRE_FIXED_ROUTING = 'true';
    process.env.SUGGESTED_TRADES_LIVE_AUTO_USER_ALLOWLIST = 'user-1';
    process.env.SUGGESTED_TRADES_LIVE_AUTO_BROKER_ALLOWLIST = 'mudrex';
    process.env.SUGGESTED_TRADES_LIVE_AUTO_SHADOW_BROKER_ALLOWLIST = '';

    const disabled = await service.attemptAutoLiveExecutionForAutomation('user-1', 'st-live-auto', {
      async createOrder() {
        throw new Error('disabled path should not create orders');
      },
    });
    assert.equal(disabled.outcome, 'disabled');
    assert.equal(preTradeGateCalls, 0);

    env.suggestedTrades.liveAuto.enabled = true;
    env.suggestedTrades.liveAuto.userAllowlist = [];
    process.env.SUGGESTED_TRADES_LIVE_AUTO_ENABLED = 'true';
    process.env.SUGGESTED_TRADES_LIVE_AUTO_USER_ALLOWLIST = '';

    const blocked = await service.attemptAutoLiveExecutionForAutomation('user-1', 'st-live-auto', {
      async createOrder() {
        throw new Error('blocked path should not create orders');
      },
    });
    assert.equal(blocked.outcome, 'blocked');
    assert.equal(blocked.message, 'Live auto rollout is enabled but no users are allowlisted yet');
    assert.equal(preTradeGateCalls, 0);

    env.suggestedTrades.liveAuto.userAllowlist = ['user-1'];
    env.suggestedTrades.liveAuto.brokerAllowlist = ['mudrex'];
    env.suggestedTrades.liveAuto.executionEnabled = false;
    process.env.SUGGESTED_TRADES_LIVE_AUTO_USER_ALLOWLIST = 'user-1';
    process.env.SUGGESTED_TRADES_LIVE_AUTO_BROKER_ALLOWLIST = 'mudrex';
    process.env.SUGGESTED_TRADES_LIVE_AUTO_EXECUTION_ENABLED = 'false';

    env.suggestedTrades.liveAuto.mudrexEnabled = false;
    process.env.SUGGESTED_TRADES_LIVE_AUTO_MUDREX_ENABLED = 'false';
    const brokerControlBlocked = await service.attemptAutoLiveExecutionForAutomation(
      'user-1',
      'st-live-auto',
      {
        async createOrder() {
          throw new Error('broker-control path should not create orders');
        },
      }
    );
    assert.equal(brokerControlBlocked.outcome, 'blocked');
    assert.equal(
      brokerControlBlocked.message,
      'Broker mudrex live auto is disabled by broker-specific control'
    );
    assert.equal(preTradeGateCalls, 0);

    env.suggestedTrades.liveAuto.mudrexEnabled = true;
    process.env.SUGGESTED_TRADES_LIVE_AUTO_MUDREX_ENABLED = 'true';

    const ready = await service.attemptAutoLiveExecutionForAutomation('user-1', 'st-live-auto', {
      async createOrder() {
        throw new Error('ready path should not create orders when execution is disabled');
      },
    });
    assert.equal(ready.outcome, 'ready');
    assert.equal(ready.preTradeCheckId, 'check-live-1');
    assert.equal(ready.brokerKey, 'mudrex');
    assert.equal(ready.accountId, 'acc-1');
    assert.equal(preTradeGateCalls, 1);
    assert.equal(
      (persistedExecution?.['note'] as string | undefined) ?? null,
      'Live auto rollout guard passed. Broker placement remains disabled until live auto execution is explicitly enabled. Using broker policy minimum leverage 5x.'
    );

    const originalRunPreTradeGate = service.runPreTradeGate;
    service.runPreTradeGate = async (...args: unknown[]) => {
      const result = await originalRunPreTradeGate.apply(service, args);
      result.result.request.order.orderType = 'market';
      result.execution.orderType = 'market';
      return result;
    };
    const marketNormalized = await service.attemptAutoLiveExecutionForAutomation(
      'user-1',
      'st-live-auto',
      {
        async createOrder() {
          throw new Error('market-normalized path should not create orders');
        },
      }
    );
    assert.equal(marketNormalized.outcome, 'ready');
    assert.equal((persistedExecution?.['orderType'] as string | undefined) ?? null, 'limit');
    assert.equal((persistedExecution?.['triggerType'] as string | undefined) ?? null, 'GTC');
    service.runPreTradeGate = originalRunPreTradeGate;

    baseTrade.timeframe = '5m';
    baseTrade.signalTime = new Date('2026-05-11T08:20:00.000Z');
    const currentRunLatencyAllowed = await service.attemptAutoLiveExecutionForAutomation(
      'user-1',
      'st-live-auto',
      {
        async createOrder() {
          throw new Error(
            'current-run latency path should not create orders when execution is disabled'
          );
        },
      },
      {
        currentRunFreshnessFloorSeconds: 300,
        freshnessEvaluatedAt: new Date('2026-05-11T08:30:00.000Z'),
      }
    );
    assert.equal(currentRunLatencyAllowed.outcome, 'ready');
    assert.equal(currentRunLatencyAllowed.freshness?.allowed, true);
    assert.equal(currentRunLatencyAllowed.freshness?.ageAfterCloseSeconds, 300);
    assert.equal(currentRunLatencyAllowed.freshness?.maxAgeAfterCloseSeconds, 300);
    assert.equal(currentRunLatencyAllowed.freshness?.currentRunFreshnessFloorSeconds, 300);
    assert.equal(preTradeGateCalls, 3);
    baseTrade.timeframe = '1h';

    baseTrade.signalTime = new Date(Date.now() - 3 * 60 * 60 * 1000);
    const stale = await service.attemptAutoLiveExecutionForAutomation('user-1', 'st-live-auto', {
      async createOrder() {
        throw new Error('stale path should not create orders');
      },
    });
    assert.equal(stale.outcome, 'skipped');
    assert.equal(stale.freshness?.allowed, false);
    assert.match(stale.message, /Skipped live execution/);
    assert.match(stale.message, /freshness window/);
    assert.equal(preTradeGateCalls, 3);
    assert.ok(loggedActivities.includes('Live auto stale signal skipped: BTCUSDT'));
    baseTrade.signalTime = freshOneHourSignalTime;

    env.suggestedTrades.liveAuto.executionEnabled = true;
    process.env.SUGGESTED_TRADES_LIVE_AUTO_EXECUTION_ENABLED = 'true';

    const placed = await service.attemptAutoLiveExecutionForAutomation('user-1', 'st-live-auto', {
      async createOrder(
        assetId: string,
        body: Record<string, unknown>,
        context?: { suggestedTradeId?: string | null }
      ) {
        assert.equal(assetId, 'mudrex-asset-1');
        assert.equal(body.execution_mode, 'live');
        assert.equal(body.symbol, 'BTCUSDT');
        assert.equal(body.accountId, 'acc-1');
        assert.equal(body.brokerKey, 'mudrex');
        assert.equal(body.order_type, 'limit');
        assert.equal(body.trigger_type, 'GTC');
        assert.equal(context?.suggestedTradeId, 'st-live-auto');
        return {
          success: true,
          data: {
            order_id: 'live-order-1',
            status: 'OPEN',
          },
        };
      },
    });
    assert.equal(placed.outcome, 'working');
    assert.equal(placed.preTradeCheckId, 'check-live-1');
    assert.equal(placed.orderId, 'live-order-1');
    assert.equal(placed.brokerKey, 'mudrex');
    assert.equal(placed.accountId, 'acc-1');
    assert.equal((persistedExecution?.['orderId'] as string | undefined) ?? null, 'live-order-1');
    assert.equal((persistedExecution?.['executionState'] as string | undefined) ?? null, 'working');
    assert.ok(loggedActivities.includes('Live auto rollout blocked: BTCUSDT'));
    assert.ok(loggedActivities.includes('Live auto rollout ready: BTCUSDT'));
    assert.ok(loggedActivities.includes('Live auto order awaiting protection: BTCUSDT'));

    currentBrokerKey = 'delta_exchange';
    currentAccountId = 'delta-acc-1';
    currentAssetExternalId = '45678';
    currentRemoteAssetId = 'delta-remote-should-not-be-used';
    env.suggestedTrades.liveAuto.brokerAllowlist = ['mudrex', 'delta_exchange'];
    process.env.SUGGESTED_TRADES_LIVE_AUTO_BROKER_ALLOWLIST = 'mudrex,delta_exchange';

    const deltaPlaced = await service.attemptAutoLiveExecutionForAutomation(
      'user-1',
      'st-live-auto',
      {
        async createOrder(
          assetId: string,
          body: Record<string, unknown>,
          context?: { suggestedTradeId?: string | null }
        ) {
          assert.equal(assetId, '45678');
          assert.equal(body.execution_mode, 'live');
          assert.equal(body.symbol, 'BTCUSDT');
          assert.equal(body.accountId, 'delta-acc-1');
          assert.equal(body.brokerKey, 'delta_exchange');
          assert.equal(body.order_type, 'limit');
          assert.equal(body.trigger_type, 'GTC');
          assert.equal(context?.suggestedTradeId, 'st-live-auto');
          return {
            success: true,
            data: {
              order_id: 'delta-live-order-1',
              status: 'open',
              protection_status: 'attached',
              stop_loss_order_id: 'delta-live-sl-early',
              take_profit_order_id: 'delta-live-tp-early',
            },
          };
        },
      }
    );
    assert.equal(deltaPlaced.outcome, 'working');
    assert.equal(deltaPlaced.orderId, 'delta-live-order-1');
    assert.equal(deltaPlaced.brokerKey, 'delta_exchange');
    assert.equal(deltaPlaced.accountId, 'delta-acc-1');
    assert.equal((persistedExecution?.['executionState'] as string | undefined) ?? null, 'working');
    assert.equal(persistedExecution?.['protectionState'], 'waiting_for_fill');
    assert.equal(persistedExecution?.['protectionAttachedAt'] ?? null, null);
    assert.equal(
      (persistedExecution?.['protectionPlan'] as Record<string, unknown>)?.stopLossOrderId,
      'delta-live-sl-early'
    );
    assert.equal(
      (persistedExecution?.['protectionPlan'] as Record<string, unknown>)?.takeProfitOrderId,
      'delta-live-tp-early'
    );
    assert.match(
      String(persistedExecution?.['note'] || ''),
      /awaiting entry fill and active order snapshot verification/
    );

    baseTrade.symbol = 'SOLUSDC';
    currentBrokerKey = 'mudrex';
    currentAccountId = 'acc-1';
    service.brokerAccountRepository = {
      async getConnectedBrokerAccounts() {
        return [
          { id: 'delta-acc-1', brokerKey: 'delta_exchange' },
          { id: 'acc-1', brokerKey: 'mudrex' },
        ];
      },
    };
    service.positionReadModelRepository = {
      async listLivePositionsForAccounts() {
        return new Map([
          [
            'acc-1',
            [
              {
                symbol: 'SOLUSDT',
                quantity: 2,
              },
            ],
          ],
        ]);
      },
    };
    service.ordersSnapshotSourceRepository = {
      async listOpenOrdersForAccounts() {
        return new Map();
      },
    };

    const preTradeCallsBeforeDuplicatePosition = preTradeGateCalls;
    const duplicatePositionSkipped = await service.attemptAutoLiveExecutionForAutomation(
      'user-1',
      'st-live-auto',
      {
        async createOrder() {
          throw new Error('duplicate position gate should skip before broker placement');
        },
      }
    );
    assert.equal(duplicatePositionSkipped.outcome, 'skipped');
    assert.equal(
      duplicatePositionSkipped.message,
      'Active exposure already exists for asset SOL; skipping duplicate live-auto suggestion.'
    );
    assert.equal(preTradeGateCalls, preTradeCallsBeforeDuplicatePosition);

    service.positionReadModelRepository = {
      async listLivePositionsForAccounts() {
        return new Map();
      },
    };
    service.ordersSnapshotSourceRepository = {
      async listOpenOrdersForAccounts() {
        return new Map([
          [
            'delta-acc-1',
            [
              {
                payloadJson: {
                  symbol: 'SOLUSDT',
                },
              },
            ],
          ],
        ]);
      },
    };

    const preTradeCallsBeforeDuplicateOrder = preTradeGateCalls;
    const duplicateOrderSkipped = await service.attemptAutoLiveExecutionForAutomation(
      'user-1',
      'st-live-auto',
      {
        async createOrder() {
          throw new Error('duplicate order gate should skip before broker placement');
        },
      }
    );
    assert.equal(duplicateOrderSkipped.outcome, 'skipped');
    assert.equal(
      duplicateOrderSkipped.message,
      'Active exposure already exists for asset SOL; skipping duplicate live-auto suggestion.'
    );
    assert.equal(preTradeGateCalls, preTradeCallsBeforeDuplicateOrder);
    assert.ok(loggedActivities.includes('Live auto duplicate skipped: SOLUSDC'));
  } finally {
    env.suggestedTrades.rolloutEnabled = originalRolloutEnabled;
    env.suggestedTrades.liveAuto.enabled = originalLiveAuto.enabled;
    env.suggestedTrades.liveAuto.executionEnabled = originalLiveAuto.executionEnabled;
    env.suggestedTrades.liveAuto.mudrexEnabled = originalLiveAuto.mudrexEnabled;
    env.suggestedTrades.liveAuto.deltaExchangeEnabled = originalLiveAuto.deltaExchangeEnabled;
    env.suggestedTrades.liveAuto.adaptiveRoutingMode = originalLiveAuto.adaptiveRoutingMode;
    env.suggestedTrades.liveAuto.requireFixedRouting = originalLiveAuto.requireFixedRouting;
    env.suggestedTrades.liveAuto.userAllowlist = [...originalLiveAuto.userAllowlist];
    env.suggestedTrades.liveAuto.brokerAllowlist = [...originalLiveAuto.brokerAllowlist];
    env.suggestedTrades.liveAuto.shadowBrokerAllowlist = [
      ...originalLiveAuto.shadowBrokerAllowlist,
    ];
    restoreEnv('SUGGESTED_TRADES_ROLLOUT_ENABLED', originalEnvFlags.rolloutEnabled);
    restoreEnv('SUGGESTED_TRADES_LIVE_AUTO_ENABLED', originalEnvFlags.enabled);
    restoreEnv('SUGGESTED_TRADES_LIVE_AUTO_EXECUTION_ENABLED', originalEnvFlags.executionEnabled);
    restoreEnv('SUGGESTED_TRADES_LIVE_AUTO_MUDREX_ENABLED', originalEnvFlags.mudrexEnabled);
    restoreEnv(
      'SUGGESTED_TRADES_LIVE_AUTO_DELTA_EXCHANGE_ENABLED',
      originalEnvFlags.deltaExchangeEnabled
    );
    restoreEnv(
      'SUGGESTED_TRADES_LIVE_AUTO_ADAPTIVE_ROUTING_MODE',
      originalEnvFlags.adaptiveRoutingMode
    );
    restoreEnv(
      'SUGGESTED_TRADES_LIVE_AUTO_REQUIRE_FIXED_ROUTING',
      originalEnvFlags.requireFixedRouting
    );
    restoreEnv('SUGGESTED_TRADES_LIVE_AUTO_USER_ALLOWLIST', originalEnvFlags.userAllowlist);
    restoreEnv('SUGGESTED_TRADES_LIVE_AUTO_BROKER_ALLOWLIST', originalEnvFlags.brokerAllowlist);
    restoreEnv(
      'SUGGESTED_TRADES_LIVE_AUTO_SHADOW_BROKER_ALLOWLIST',
      originalEnvFlags.shadowBrokerAllowlist
    );
  }
}

async function runSuggestedTradeAdaptiveRouteSelectionAssertions(): Promise<void> {
  const service = new SuggestedTradesService() as any;
  service.liveAutoLifecycleMonitorEnabled = false;
  const originalRolloutEnabled = env.suggestedTrades.rolloutEnabled;
  const originalEnvFlags = {
    rolloutEnabled: process.env.SUGGESTED_TRADES_ROLLOUT_ENABLED,
    enabled: process.env.SUGGESTED_TRADES_LIVE_AUTO_ENABLED,
    executionEnabled: process.env.SUGGESTED_TRADES_LIVE_AUTO_EXECUTION_ENABLED,
    adaptiveRoutingMode: process.env.SUGGESTED_TRADES_LIVE_AUTO_ADAPTIVE_ROUTING_MODE,
    requireFixedRouting: process.env.SUGGESTED_TRADES_LIVE_AUTO_REQUIRE_FIXED_ROUTING,
    userAllowlist: process.env.SUGGESTED_TRADES_LIVE_AUTO_USER_ALLOWLIST,
    brokerAllowlist: process.env.SUGGESTED_TRADES_LIVE_AUTO_BROKER_ALLOWLIST,
    shadowBrokerAllowlist: process.env.SUGGESTED_TRADES_LIVE_AUTO_SHADOW_BROKER_ALLOWLIST,
  };
  const originalLiveAuto = {
    enabled: env.suggestedTrades.liveAuto.enabled,
    executionEnabled: env.suggestedTrades.liveAuto.executionEnabled,
    adaptiveRoutingMode: env.suggestedTrades.liveAuto.adaptiveRoutingMode,
    requireFixedRouting: env.suggestedTrades.liveAuto.requireFixedRouting,
    userAllowlist: [...env.suggestedTrades.liveAuto.userAllowlist],
    brokerAllowlist: [...env.suggestedTrades.liveAuto.brokerAllowlist],
    shadowBrokerAllowlist: [...env.suggestedTrades.liveAuto.shadowBrokerAllowlist],
  };
  const freshRiskSignalTime = new Date(Date.now() - 62 * 60 * 1000);

  let currentTrade = {
    id: 'st-live-auto-risk-1',
    automationId: 'auto-live-risk',
    automationRunId: 'run-live-risk',
    userId: 'user-1',
    symbol: 'BTCUSDT',
    timeframe: '1h',
    side: 'BUY',
    signalTime: freshRiskSignalTime,
    status: 'Open',
    confidence: 0.91,
    score: 95,
    entryPrice: '100',
    stopLossPrice: '95',
    takeProfitTargets: ['108'],
    entryRule: 'breakout',
    exitRule: 'trail',
    rationale: 'Adaptive route selection',
    dedupeKey: 'dedupe-live-auto-risk',
    meta: null,
    createdAt: new Date(freshRiskSignalTime.getTime() + 60 * 60 * 1000 + 30 * 1000),
    updatedAt: new Date(freshRiskSignalTime.getTime() + 60 * 60 * 1000 + 60 * 1000),
  };

  const createCheckRoutes: string[] = [];
  const createCheckSymbols: string[] = [];
  const createCheckLeverages: Array<number | null> = [];
  const createCheckNotionals: Array<number | null> = [];
  const placedRoutes: string[] = [];
  const savedRouteDecisions: Array<Record<string, unknown> | null> = [];
  const persistedExecutions: Array<Record<string, unknown>> = [];
  let deltaReconciliationMode: 'empty' | 'found_order' | 'found_position' = 'empty';
  let latestDeltaIdempotencyKey: string | null = null;
  let mudrexRiskOrderFailureMessage: string | null = null;
  const mudrexRiskOrders: Array<{
    positionId: string;
    body: Record<string, unknown>;
    context?: Record<string, unknown>;
  }> = [];
  const mudrexClosedPositions: Array<{
    positionId: string;
    context?: Record<string, unknown>;
  }> = [];

  function buildPreTradeResult(body: Record<string, any>, checkId: string) {
    const brokerKey = String(body.routing?.brokerKey || '')
      .trim()
      .toLowerCase();
    const accountId = String(body.routing?.accountId || '').trim();
    const orderSymbol =
      String(body.order?.symbol || 'BTCUSDT')
        .trim()
        .toUpperCase() || 'BTCUSDT';
    const accountMarginUsagePct = brokerKey === 'delta_exchange' ? 8 : 18;
    const brokerAllocationPct = brokerKey === 'delta_exchange' ? 20 : 32;
    const brokerAssetAllocationPct = brokerKey === 'delta_exchange' ? 6 : 11;

    return {
      checkId,
      status: 'passed',
      checkedAt: 'Apr 18, 2026, 5:02 AM',
      checkedAtIso: '2026-04-18T05:02:00.000Z',
      expiresAt: 'Apr 18, 2026, 5:32 AM',
      expiresAtIso: '2026-04-18T05:32:00.000Z',
      request: {
        suggestedTradeId: body.suggestedTradeId,
        automationId: body.automationId,
        automationRunId: body.automationRunId,
        sourceType: body.sourceType,
        executionMode: body.executionMode,
        approvalMode: body.approvalMode,
        routing: {
          routeMode: body.routing?.routeMode ?? 'fixed',
          brokerKey,
          accountId,
        },
        order: {
          ...body.order,
          leverage: body.order?.leverage ?? null,
          entryPrice: body.order?.entryPrice ?? 100,
          stopLossPrice: body.order?.stopLossPrice ?? 95,
          takeProfitTargets: body.order?.takeProfitTargets ?? [108],
        },
      },
      snapshot: {
        snapshotId: 'snapshot-1',
        freshnessState: 'fresh',
        snapshotLagMinutes: 1,
        latestRiskSnapshotAt: 'Apr 18, 2026, 5:00 AM',
        latestRiskSnapshotAtIso: '2026-04-18T05:00:00.000Z',
      },
      decision: {
        allowed: true,
        blocked: false,
        approvalRequired: false,
        blockingRuleCount: 0,
        warningRuleCount: 0,
        summary: 'All clear',
      },
      before: {
        portfolio: null,
        brokers: [],
        assets: [],
        brokerAssets: [],
      },
      delta: {
        grossExposureDelta: 100,
        netExposureDelta: 100,
        openOrderExposureDelta: 100,
        reservedOrderMarginDelta: 20,
      },
      after: {
        portfolio: null,
        brokers: [],
        assets: [],
        brokerAssets: [],
      },
      scopeImpacts: [
        {
          id: `scope-account-${accountId}`,
          checkId,
          snapshotId: 'snapshot-1',
          scopeType: 'account',
          scopeKey: accountId,
          scopeLabel: accountId,
          brokerKey,
          accountId,
          symbol: null,
          beforeGrossExposure: 1000,
          beforeNetExposure: 1000,
          beforeOpenOrderExposure: 100,
          beforeReservedOrderMargin: 100,
          beforeMarginUsagePct: 10,
          beforeAllocationPct: 10,
          beforeRiskScore: null,
          beforeRiskState: null,
          deltaGrossExposure: 100,
          deltaNetExposure: 100,
          deltaOpenOrderExposure: 100,
          deltaReservedOrderMargin: 20,
          afterGrossExposure: 1100,
          afterNetExposure: 1100,
          afterOpenOrderExposure: 200,
          afterReservedOrderMargin: 120,
          afterMarginUsagePct: accountMarginUsagePct,
          afterAllocationPct: accountMarginUsagePct,
          afterRiskScore: null,
          afterRiskState: null,
          sortOrder: 1,
          createdAt: 'Apr 18, 2026, 5:02 AM',
          createdAtIso: '2026-04-18T05:02:00.000Z',
        },
        {
          id: `scope-broker-${brokerKey}`,
          checkId,
          snapshotId: 'snapshot-1',
          scopeType: 'broker',
          scopeKey: brokerKey,
          scopeLabel: brokerKey,
          brokerKey,
          accountId: null,
          symbol: null,
          beforeGrossExposure: 1000,
          beforeNetExposure: 1000,
          beforeOpenOrderExposure: 100,
          beforeReservedOrderMargin: 100,
          beforeMarginUsagePct: 10,
          beforeAllocationPct: 10,
          beforeRiskScore: 8,
          beforeRiskState: 'ok',
          deltaGrossExposure: 100,
          deltaNetExposure: 100,
          deltaOpenOrderExposure: 100,
          deltaReservedOrderMargin: 20,
          afterGrossExposure: 1100,
          afterNetExposure: 1100,
          afterOpenOrderExposure: 200,
          afterReservedOrderMargin: 120,
          afterMarginUsagePct: accountMarginUsagePct,
          afterAllocationPct: brokerAllocationPct,
          afterRiskScore: 8,
          afterRiskState: 'ok',
          sortOrder: 2,
          createdAt: 'Apr 18, 2026, 5:02 AM',
          createdAtIso: '2026-04-18T05:02:00.000Z',
        },
        {
          id: `scope-broker-asset-${brokerKey}`,
          checkId,
          snapshotId: 'snapshot-1',
          scopeType: 'broker_asset',
          scopeKey: `${brokerKey}|${orderSymbol}`,
          scopeLabel: `${brokerKey} / ${orderSymbol}`,
          brokerKey,
          accountId: null,
          symbol: orderSymbol,
          beforeGrossExposure: 400,
          beforeNetExposure: 400,
          beforeOpenOrderExposure: 50,
          beforeReservedOrderMargin: 40,
          beforeMarginUsagePct: 4,
          beforeAllocationPct: 4,
          beforeRiskScore: 5,
          beforeRiskState: 'ok',
          deltaGrossExposure: 100,
          deltaNetExposure: 100,
          deltaOpenOrderExposure: 100,
          deltaReservedOrderMargin: 20,
          afterGrossExposure: 500,
          afterNetExposure: 500,
          afterOpenOrderExposure: 150,
          afterReservedOrderMargin: 60,
          afterMarginUsagePct: 6,
          afterAllocationPct: brokerAssetAllocationPct,
          afterRiskScore: 5,
          afterRiskState: 'ok',
          sortOrder: 3,
          createdAt: 'Apr 18, 2026, 5:02 AM',
          createdAtIso: '2026-04-18T05:02:00.000Z',
        },
      ],
      blockingRules: [],
      warningRules: [],
      evaluatedRules: [],
      appliedPolicies: [],
    };
  }

  service.suggestedTradeRepository = {
    async getSuggestedTradeById() {
      return { ...currentTrade };
    },
    async countSystemAcceptedExecutionsSince() {
      return 0;
    },
    async countActiveExecutionsForAutomation() {
      return 0;
    },
    async saveSuggestedTrade(trade: Record<string, unknown>) {
      const meta =
        trade.meta && typeof trade.meta === 'object' && !Array.isArray(trade.meta)
          ? (trade.meta as Record<string, unknown>)
          : null;
      const routeDecision =
        meta?.routeDecision &&
        typeof meta.routeDecision === 'object' &&
        !Array.isArray(meta.routeDecision)
          ? (meta.routeDecision as Record<string, unknown>)
          : null;
      savedRouteDecisions.push(routeDecision);
      return {
        ...trade,
        updatedAt: new Date('2026-04-18T05:03:00.000Z'),
      };
    },
  };
  service.persistExecutionState = async (_trade: unknown, execution: Record<string, unknown>) => {
    persistedExecutions.push({ ...execution });
  };
  service.operationalEventService = {
    async logActivity() {
      return undefined;
    },
    async emitFailureAlert() {
      return undefined;
    },
    async emitNotificationAlert() {
      return undefined;
    },
  };
  service.brokerAccountRepository = {
    async getConnectedBrokerAccounts() {
      return [
        {
          id: 'delta-acc-1',
          brokerKey: 'delta_exchange',
          accountName: 'Delta Production',
          accountKey: 'delta-primary',
          isDefault: true,
        },
        {
          id: 'acc-1',
          brokerKey: 'mudrex',
          accountName: 'Mudrex Prod',
          accountKey: 'mudrex-primary',
          isDefault: true,
        },
      ];
    },
  };
  service.riskPreTradeService = {
    async previewPreTradeCheck(_userId: string, body: Record<string, any>) {
      return createSuccess(
        buildPreTradeResult(body, `preview:${body.routing?.brokerKey}:${body.routing?.accountId}`)
      );
    },
    async createPreTradeCheck(_userId: string, body: Record<string, any>) {
      createCheckRoutes.push(
        `${String(body.routing?.brokerKey || '')
          .trim()
          .toLowerCase()}:${String(body.routing?.accountId || '').trim()}`
      );
      createCheckSymbols.push(
        String(body.order?.symbol || '')
          .trim()
          .toUpperCase()
      );
      createCheckLeverages.push(body.order?.leverage ?? null);
      createCheckNotionals.push(body.order?.notional ?? null);
      return createSuccess(
        buildPreTradeResult(body, `check:${body.routing?.brokerKey}:${body.routing?.accountId}`)
      );
    },
  };
  service.exchangeAssetRepository = {
    async getSystemAssetBySourceAndSymbol(source: string) {
      return {
        externalId: source === 'delta_exchange' ? 'delta-asset-1' : 'mudrex-asset-1',
      };
    },
    async listSystemAssetsBySourceAndSymbols(source: string, symbols: string[]) {
      const normalizedSymbols = symbols.map((item) => String(item).trim().toUpperCase());
      if (source === 'delta_exchange') {
        if (normalizedSymbols.includes('SOLUSDC')) {
          return [{ symbol: 'SOLUSDC', externalId: 'delta-sol-asset-1' }];
        }
        const exact = normalizedSymbols[0] || 'BTCUSDT';
        return [{ symbol: exact, externalId: 'delta-asset-1' }];
      }
      if (normalizedSymbols.includes('SOLUSDT')) {
        return [{ symbol: 'SOLUSDT', externalId: 'mudrex-sol-asset-1' }];
      }
      const exact = normalizedSymbols[0] || 'BTCUSDT';
      return [{ symbol: exact, externalId: 'mudrex-asset-1' }];
    },
  };
  service.brokerReferenceDataService = {
    async getFuturesAssetDetailBySymbol(_brokerKey: string, symbol: string) {
      const normalizedSymbol = String(symbol || '')
        .trim()
        .toUpperCase();
      return {
        data: {
          id: normalizedSymbol === 'SOLUSDT' ? 'remote-sol-asset-1' : 'remote-asset-1',
          min_contract: normalizedSymbol === 'AIXBTUSDT' ? '10' : '0.000001',
          max_contract: normalizedSymbol === 'AIXBTUSDT' ? '6075000' : '1000000',
          quantity_step: normalizedSymbol === 'AIXBTUSDT' ? '10' : '0.000001',
          max_market_contract: normalizedSymbol === 'AIXBTUSDT' ? '1215000' : '1000000',
          min_notional_value: '5',
          min_price: '0.000001',
          max_price: '1000000',
          price_step:
            normalizedSymbol === 'BTCUSDT'
              ? '0.01'
              : normalizedSymbol === 'AIXBTUSDT'
                ? '0.000001'
                : '0.0001',
        },
      };
    },
  };
  service.brokerRuntimeRegistry = {
    getOrdersAdapter(brokerKey: string) {
      if (brokerKey !== 'delta_exchange') {
        return {};
      }
      return {
        async listOpenOrders() {
          if (deltaReconciliationMode !== 'found_order' || !latestDeltaIdempotencyKey) {
            return [];
          }
          return [
            {
              id: 'delta-reconciled-order-1',
              symbol: 'BTCUSDT',
              status: 'open',
              side: 'buy',
              client_order_id: latestDeltaIdempotencyKey,
              created_at: '2026-04-18T05:03:30.000Z',
            },
          ];
        },
        async getOrderHistory() {
          return [];
        },
        async preflightLiveAutoOrder(assetId: string, body: Record<string, unknown>) {
          assert.match(assetId, /^delta-/);
          const symbol = String(body.symbol || '')
            .trim()
            .toUpperCase();
          if (symbol === 'JCTUSDT') {
            return {
              quantityContracts: 57300,
              contractValue: 1,
              contractUnitCurrency: 'JCT',
              auditNote:
                'Delta product preflight passed for JCTUSD: product 789 is live/operational, contract_value 1 JCT, requested base quantity 57300 JCT routes as 57300 contracts.',
            };
          }
          return {
            quantityContracts: 1000,
            contractValue: 0.001,
            contractUnitCurrency: 'BTC',
            auditNote:
              'Delta product preflight passed for BTCUSD: product 45678 is live/operational, contract_value 0.001 BTC, requested base quantity 1 BTC routes as 1000 contracts.',
          };
        },
      };
    },
  };
  service.riskPolicyRepository = {
    async getEffectivePolicy(_userId: string, brokerKey: string) {
      return {
        id: `policy-${brokerKey}`,
        scope: 'broker',
        minLeverage: 15,
        maxLeverage: 25,
        tradeSizePctOfBalance: 10,
      };
    },
  };
  service.fundsSnapshotRepository = {
    async getLatestSnapshot(_userId: string, brokerKey: string, accountId: string) {
      return {
        broker_key: brokerKey,
        account_id: accountId,
        futures_funds_json:
          brokerKey === 'delta_exchange'
            ? JSON.stringify({
                balance: 119.51,
                locked_amount: 4.86,
              })
            : JSON.stringify({
                balance: 394.99,
                locked_amount: 0,
              }),
        wallet_funds_json: null,
      };
    },
  };
  service.brokerRuntimeRegistry = {
    getOrdersAdapter(brokerKey: string) {
      if (brokerKey !== 'delta_exchange') {
        return {};
      }
      return {
        async listOpenOrders() {
          if (deltaReconciliationMode !== 'found_order' || !latestDeltaIdempotencyKey) {
            return [];
          }
          return [
            {
              id: 'delta-reconciled-order-1',
              symbol: 'BTCUSDT',
              status: 'open',
              side: 'buy',
              client_order_id: latestDeltaIdempotencyKey,
              created_at: new Date().toISOString(),
            },
          ];
        },
        async getOrderHistory() {
          return [];
        },
        async preflightLiveAutoOrder(assetId: string, body: Record<string, unknown>) {
          assert.match(assetId, /^delta-/);
          const symbol = String(body.symbol || '')
            .trim()
            .toUpperCase();
          if (symbol === 'JCTUSDT') {
            return {
              quantityContracts: 57300,
              contractValue: 1,
              contractUnitCurrency: 'JCT',
              auditNote:
                'Delta product preflight passed for JCTUSD: product 789 is live/operational, contract_value 1 JCT, requested base quantity 57300 JCT routes as 57300 contracts.',
            };
          }
          return {
            quantityContracts: 1000,
            contractValue: 0.001,
            contractUnitCurrency: 'BTC',
            auditNote:
              'Delta product preflight passed for BTCUSD: product 45678 is live/operational, contract_value 0.001 BTC, requested base quantity 1 BTC routes as 1000 contracts.',
          };
        },
      };
    },
    getPositionsAdapter(brokerKey: string) {
      if (brokerKey === 'delta_exchange') {
        return {
          async getPositions() {
            if (deltaReconciliationMode !== 'found_position') {
              return [];
            }
            return [
              {
                id: 'delta-reconciled-position-1',
                symbol: 'BTCUSDT',
                status: 'OPEN',
                side: 'long',
                size: 1000,
                entry_price: '100',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              },
            ];
          },
        };
      }
      assert.equal(brokerKey, 'mudrex');
      return {
        async getPositions() {
          const resolvedSymbol =
            String(currentTrade.symbol).trim().toUpperCase() === 'SOLUSDC'
              ? 'SOLUSDT'
              : String(currentTrade.symbol).trim().toUpperCase();
          const liveEntryPrice =
            resolvedSymbol === 'AIXBTUSDT' ? '0.0280065314685315' : String(currentTrade.entryPrice);
          return [
            {
              id: `mudrex-pos-${currentTrade.id}`,
              symbol: resolvedSymbol,
              status: 'OPEN',
              position_type:
                String(currentTrade.side).trim().toUpperCase() === 'SELL' ? 'SHORT' : 'LONG',
              entry_price: liveEntryPrice,
              created_at: '2026-04-18T05:04:00.000Z',
              updated_at: '2026-04-18T05:04:30.000Z',
              stoploss_price: 0,
              takeprofit_price: 0,
            },
          ];
        },
        async createRiskOrder(
          positionId: string,
          body: Record<string, unknown>,
          context?: Record<string, unknown>
        ) {
          if (mudrexRiskOrderFailureMessage) {
            throw new Error(mudrexRiskOrderFailureMessage);
          }
          mudrexRiskOrders.push({
            positionId,
            body: { ...body },
            context,
          });
          return {
            status: 'CREATED',
          };
        },
        async closePosition(positionId: string, context?: Record<string, unknown>) {
          mudrexClosedPositions.push({ positionId, context });
          return { success: true };
        },
      };
    },
  };
  service.detectLiveAutoDeltaNativeProtectionConflict = async () => null;
  service.loadTradeSuggestionExecutionPolicy = async () => ({
    executionMode: 'live_trade_auto',
    approvalMode: 'auto_if_safe',
    routeMode: 'strategy_default',
    brokerKey: null,
    accountId: null,
    liveConsentEnabled: true,
    orderType: 'limit',
    timeInForce: 'GTC',
    quantityMode: 'notional',
    quantity: null,
    notional: 100,
    riskPercent: null,
    leverage: null,
    reduceOnly: false,
    maxOrdersPerRun: 2,
    maxOrdersPerDay: 3,
    maxConcurrentOpenTrades: 1,
    maxNotionalPerTrade: null,
    maxNotionalPerDay: null,
    dedupeWindowSeconds: 3600,
    freshness: {
      enabled: true,
      graceSeconds: null,
      timeframeGraceSeconds: {
        '1h': 600,
      },
    },
  });

  try {
    env.suggestedTrades.rolloutEnabled = true;
    env.suggestedTrades.liveAuto.enabled = true;
    env.suggestedTrades.liveAuto.executionEnabled = true;
    env.suggestedTrades.liveAuto.adaptiveRoutingMode = 'live';
    env.suggestedTrades.liveAuto.requireFixedRouting = true;
    env.suggestedTrades.liveAuto.userAllowlist = ['user-1'];
    env.suggestedTrades.liveAuto.brokerAllowlist = ['mudrex', 'delta_exchange'];
    env.suggestedTrades.liveAuto.shadowBrokerAllowlist = [];
    process.env.SUGGESTED_TRADES_ROLLOUT_ENABLED = 'true';
    process.env.SUGGESTED_TRADES_LIVE_AUTO_ENABLED = 'true';
    process.env.SUGGESTED_TRADES_LIVE_AUTO_EXECUTION_ENABLED = 'true';
    process.env.SUGGESTED_TRADES_LIVE_AUTO_ADAPTIVE_ROUTING_MODE = 'live';
    process.env.SUGGESTED_TRADES_LIVE_AUTO_REQUIRE_FIXED_ROUTING = 'true';
    process.env.SUGGESTED_TRADES_LIVE_AUTO_USER_ALLOWLIST = 'user-1';
    process.env.SUGGESTED_TRADES_LIVE_AUTO_BROKER_ALLOWLIST = 'mudrex,delta_exchange';
    process.env.SUGGESTED_TRADES_LIVE_AUTO_SHADOW_BROKER_ALLOWLIST = '';

    const deltaPreferred = await service.attemptAutoLiveExecutionForAutomation(
      'user-1',
      'st-live-auto-risk-1',
      {
        async createOrder(assetId: string, body: Record<string, unknown>) {
          placedRoutes.push(`${String(body.brokerKey)}:${String(body.accountId)}`);
          assert.equal(assetId, 'delta-asset-1');
          assert.equal(body.brokerKey, 'delta_exchange');
          assert.equal(body.accountId, 'delta-acc-1');
          assert.equal(body.leverage, 15);
          return {
            success: true,
            data: {
              order_id: 'delta-live-order-risk-1',
              status: 'OPEN',
            },
          };
        },
      }
    );

    assert.equal(deltaPreferred.outcome, 'working', deltaPreferred.message);
    assert.equal(deltaPreferred.brokerKey, 'delta_exchange');
    assert.equal(deltaPreferred.accountId, 'delta-acc-1');
    assert.equal(createCheckRoutes[0], 'delta_exchange:delta-acc-1');
    assert.equal(createCheckLeverages[0], 15);
    assert.equal(createCheckNotionals[0], 179.27);
    assert.equal(placedRoutes[0], 'delta_exchange:delta-acc-1');
    assert.equal(
      savedRouteDecisions.some((decision) => decision?.selectedBrokerKey === 'delta_exchange'),
      true
    );

    currentTrade = {
      ...currentTrade,
      id: 'st-live-auto-risk-2',
      stopLossPrice: '101',
    };

    const mudrexFallback = await service.attemptAutoLiveExecutionForAutomation(
      'user-1',
      'st-live-auto-risk-2',
      {
        async createOrder(assetId: string, body: Record<string, unknown>) {
          placedRoutes.push(`${String(body.brokerKey)}:${String(body.accountId)}`);
          assert.equal(assetId, 'mudrex-asset-1');
          assert.equal(body.brokerKey, 'mudrex');
          assert.equal(body.accountId, 'acc-1');
          assert.equal(body.leverage, 15);
          return {
            success: true,
            data: {
              order_id: 'mudrex-live-order-risk-2',
              status: 'OPEN',
            },
          };
        },
      }
    );

    assert.equal(mudrexFallback.outcome, 'placed');
    assert.equal(mudrexFallback.brokerKey, 'mudrex');
    assert.equal(mudrexFallback.accountId, 'acc-1');
    assert.equal(createCheckRoutes[1], 'mudrex:acc-1');
    assert.equal(createCheckLeverages[1], 15);
    assert.equal(createCheckNotionals[1], 592.49);
    assert.equal(placedRoutes[1], 'mudrex:acc-1');
    assert.equal(
      savedRouteDecisions.some((decision) => decision?.selectedBrokerKey === 'mudrex'),
      true
    );

    currentTrade = {
      ...currentTrade,
      id: 'st-live-auto-risk-3',
      symbol: 'SOLUSDC',
      stopLossPrice: '101',
      takeProfitTargets: ['108'],
    };

    const mudrexEquivalent = await service.attemptAutoLiveExecutionForAutomation(
      'user-1',
      'st-live-auto-risk-3',
      {
        async createOrder(assetId: string, body: Record<string, unknown>) {
          placedRoutes.push(`${String(body.brokerKey)}:${String(body.accountId)}`);
          assert.equal(assetId, 'mudrex-sol-asset-1');
          assert.equal(body.brokerKey, 'mudrex');
          assert.equal(body.accountId, 'acc-1');
          assert.equal(body.symbol, 'SOLUSDT');
          assert.equal(body.leverage, 15);
          return {
            success: true,
            data: {
              order_id: 'mudrex-live-order-risk-3',
              status: 'OPEN',
            },
          };
        },
      }
    );

    assert.equal(mudrexEquivalent.outcome, 'placed');
    assert.equal(mudrexEquivalent.brokerKey, 'mudrex');
    assert.equal(mudrexEquivalent.accountId, 'acc-1');
    assert.equal(createCheckRoutes[2], 'mudrex:acc-1');
    assert.equal(createCheckSymbols[2], 'SOLUSDT');
    assert.equal(createCheckLeverages[2], 15);
    assert.equal(createCheckNotionals[2], 592.49);
    assert.equal(placedRoutes[2], 'mudrex:acc-1');
    const latestRouteDecision = savedRouteDecisions[savedRouteDecisions.length - 1];
    assert.equal(latestRouteDecision?.mode, 'adaptive_candidate_live');
    assert.equal(latestRouteDecision?.selectedBrokerSymbol, 'SOLUSDT');
    assert.equal(Array.isArray(latestRouteDecision?.candidates), true);
    assert.equal(
      Array.isArray(latestRouteDecision?.candidates) &&
        (latestRouteDecision?.candidates as Array<Record<string, unknown>>).some(
          (candidate) => candidate?.brokerSymbol === 'SOLUSDT' && candidate?.brokerKey === 'mudrex'
        ),
      true
    );

    service.detectLiveAutoDeltaNativeProtectionConflict = async (
      _userId: string,
      brokerKey: string,
      _accountId: string,
      symbol: string
    ) =>
      brokerKey === 'delta_exchange' && String(symbol).trim().toUpperCase() === 'BTCUSDT'
        ? 'Delta Exchange live-auto native SL/TP is not safe when the account already has an open net position on this symbol. Close or reconcile the existing Delta exposure before placing another protected live-auto order.'
        : null;
    currentTrade = {
      ...currentTrade,
      id: 'st-live-auto-risk-3b',
      symbol: 'BTCUSDT',
      stopLossPrice: '99',
      takeProfitTargets: ['108'],
    };

    const deltaNetConflictFallback = await service.attemptAutoLiveExecutionForAutomation(
      'user-1',
      'st-live-auto-risk-3b',
      {
        async createOrder(assetId: string, body: Record<string, unknown>) {
          placedRoutes.push(`${String(body.brokerKey)}:${String(body.accountId)}`);
          assert.equal(assetId, 'mudrex-asset-1');
          assert.equal(body.brokerKey, 'mudrex');
          assert.equal(body.accountId, 'acc-1');
          return {
            success: true,
            data: {
              order_id: 'mudrex-live-order-risk-3b',
              status: 'OPEN',
            },
          };
        },
      }
    );

    assert.equal(deltaNetConflictFallback.outcome, 'placed');
    assert.equal(deltaNetConflictFallback.brokerKey, 'mudrex');
    assert.equal(deltaNetConflictFallback.accountId, 'acc-1');
    assert.equal(createCheckRoutes[3], 'mudrex:acc-1');
    assert.equal(placedRoutes[3], 'mudrex:acc-1');
    const conflictRouteDecision = savedRouteDecisions[savedRouteDecisions.length - 1];
    assert.equal(conflictRouteDecision?.selectedBrokerKey, 'mudrex');
    assert.equal(
      Array.isArray(conflictRouteDecision?.candidates) &&
        (conflictRouteDecision?.candidates as Array<Record<string, unknown>>).some(
          (candidate) =>
            candidate?.brokerKey === 'delta_exchange' &&
            candidate?.supported === false &&
            String(candidate?.supportMessage || '').includes('already has an open net position')
        ),
      true
    );

    service.detectLiveAutoDeltaNativeProtectionConflict = async (
      _userId: string,
      brokerKey: string,
      _accountId: string,
      symbol: string
    ) =>
      brokerKey === 'delta_exchange' &&
      ['BTCUSDT', 'AIXBTUSDT'].includes(String(symbol).trim().toUpperCase())
        ? 'Delta Exchange live-auto native SL/TP is not safe when the account already has an open net position on this symbol. Close or reconcile the existing Delta exposure before placing another protected live-auto order.'
        : null;
    currentTrade = {
      ...currentTrade,
      id: 'st-live-auto-risk-3c',
      symbol: 'AIXBTUSDT',
      entryPrice: '0.069924',
      stopLossPrice: '0.06853',
      takeProfitTargets: ['0.072718'],
    };
    const mudrexRiskOrderCountBefore = mudrexRiskOrders.length;

    const mudrexNormalizedQuantity = await service.attemptAutoLiveExecutionForAutomation(
      'user-1',
      'st-live-auto-risk-3c',
      {
        async createOrder(assetId: string, body: Record<string, unknown>) {
          placedRoutes.push(`${String(body.brokerKey)}:${String(body.accountId)}`);
          assert.equal(assetId, 'mudrex-asset-1');
          assert.equal(body.brokerKey, 'mudrex');
          assert.equal(body.accountId, 'acc-1');
          assert.equal(body.quantity, 1430);
          return {
            success: true,
            data: {
              order_id: 'mudrex-live-order-risk-3c',
              status: 'OPEN',
            },
          };
        },
      }
    );

    assert.equal(mudrexNormalizedQuantity.outcome, 'placed');
    assert.equal(mudrexNormalizedQuantity.brokerKey, 'mudrex');
    assert.equal(mudrexNormalizedQuantity.accountId, 'acc-1');
    assert.equal(createCheckRoutes[4], 'mudrex:acc-1');
    assert.equal(placedRoutes[4], 'mudrex:acc-1');
    assert.equal(mudrexRiskOrders.length, mudrexRiskOrderCountBefore + 1);
    assert.deepEqual(mudrexRiskOrders[mudrexRiskOrders.length - 1], {
      positionId: 'mudrex-pos-st-live-auto-risk-3c',
      body: {
        stoploss_price: '0.027448',
        takeprofit_price: '0.029126',
        order_source: 'positions_desk',
        is_stoploss: true,
        is_takeprofit: true,
      },
      context: {
        userId: 'user-1',
        brokerKey: 'mudrex',
        accountId: 'acc-1',
      },
    });

    currentTrade = {
      ...currentTrade,
      id: 'st-live-auto-risk-3d',
      symbol: 'BTCUSDT',
      side: 'SELL',
      entryPrice: '100.003',
      stopLossPrice: '101.002',
      takeProfitTargets: ['98.998'],
    };

    const mudrexPriceStepNormalized = await service.attemptAutoLiveExecutionForAutomation(
      'user-1',
      'st-live-auto-risk-3d',
      {
        async createOrder(assetId: string, body: Record<string, unknown>) {
          placedRoutes.push(`${String(body.brokerKey)}:${String(body.accountId)}`);
          assert.equal(assetId, 'mudrex-asset-1');
          assert.equal(body.brokerKey, 'mudrex');
          assert.equal(body.accountId, 'acc-1');
          assert.equal(body.side, 'short');
          assert.equal(body.order_price, 100.01);
          assert.equal(body.stoploss_price, 101.01);
          assert.equal(body.takeprofit_price, 98.99);
          return {
            success: true,
            data: {
              order_id: 'mudrex-live-order-risk-3d',
              status: 'OPEN',
            },
          };
        },
      }
    );

    assert.equal(mudrexPriceStepNormalized.outcome, 'placed');
    assert.equal(mudrexPriceStepNormalized.brokerKey, 'mudrex');
    assert.equal(mudrexPriceStepNormalized.accountId, 'acc-1');
    assert.equal(createCheckRoutes[5], 'mudrex:acc-1');
    assert.equal(placedRoutes[5], 'mudrex:acc-1');

    env.suggestedTrades.liveAuto.executionEnabled = false;
    env.suggestedTrades.liveAuto.adaptiveRoutingMode = 'shadow';
    process.env.SUGGESTED_TRADES_LIVE_AUTO_EXECUTION_ENABLED = 'false';
    process.env.SUGGESTED_TRADES_LIVE_AUTO_ADAPTIVE_ROUTING_MODE = 'shadow';
    currentTrade = {
      ...currentTrade,
      id: 'st-live-auto-risk-4',
      symbol: 'SOLUSDC',
      stopLossPrice: '101',
      takeProfitTargets: ['108'],
    };

    const shadowResult = await service.attemptAutoLiveExecutionForAutomation(
      'user-1',
      'st-live-auto-risk-4',
      {
        async createOrder() {
          throw new Error('shadow route should not create orders when execution is disabled');
        },
      }
    );

    assert.equal(shadowResult.outcome, 'ready');
    const shadowRouteDecision = savedRouteDecisions[savedRouteDecisions.length - 1];
    assert.equal(shadowRouteDecision?.mode, 'adaptive_candidate_shadow');
    assert.equal(shadowRouteDecision?.selectedBrokerSymbol, 'SOLUSDT');
    assert.equal(
      typeof shadowRouteDecision?.summary === 'string' &&
        String(shadowRouteDecision.summary).includes('Shadow route would select mudrex'),
      true
    );

    env.suggestedTrades.liveAuto.executionEnabled = false;
    env.suggestedTrades.liveAuto.adaptiveRoutingMode = 'live';
    env.suggestedTrades.liveAuto.brokerAllowlist = ['mudrex'];
    env.suggestedTrades.liveAuto.shadowBrokerAllowlist = ['delta_exchange'];
    process.env.SUGGESTED_TRADES_LIVE_AUTO_EXECUTION_ENABLED = 'false';
    process.env.SUGGESTED_TRADES_LIVE_AUTO_ADAPTIVE_ROUTING_MODE = 'live';
    process.env.SUGGESTED_TRADES_LIVE_AUTO_BROKER_ALLOWLIST = 'mudrex';
    process.env.SUGGESTED_TRADES_LIVE_AUTO_SHADOW_BROKER_ALLOWLIST = 'delta_exchange';
    service.detectLiveAutoDeltaNativeProtectionConflict = async () => null;
    service.positionReadModelRepository = {
      async listLivePositionsForAccounts() {
        return new Map();
      },
    };
    service.ordersSnapshotSourceRepository = {
      async listOpenOrdersForAccounts() {
        return new Map();
      },
    };
    currentTrade = {
      ...currentTrade,
      id: 'st-live-auto-risk-5',
      symbol: 'SOLUSDC',
      side: 'BUY',
      entryPrice: '100',
      stopLossPrice: '95',
      takeProfitTargets: ['108'],
    };

    const deltaShadowOnlyResult = await service.attemptAutoLiveExecutionForAutomation(
      'user-1',
      'st-live-auto-risk-5',
      {
        async createOrder() {
          throw new Error('shadow-only Delta evaluation must not create orders');
        },
      }
    );

    assert.equal(deltaShadowOnlyResult.outcome, 'ready');
    assert.equal(deltaShadowOnlyResult.brokerKey, 'mudrex');
    assert.equal(deltaShadowOnlyResult.accountId, 'acc-1');
    const deltaShadowOnlyDecision = savedRouteDecisions[savedRouteDecisions.length - 1];
    assert.equal(deltaShadowOnlyDecision?.mode, 'adaptive_candidate_live');
    assert.equal(deltaShadowOnlyDecision?.selectedBrokerKey, 'mudrex');
    assert.equal(deltaShadowOnlyDecision?.selectedBrokerSymbol, 'SOLUSDT');
    assert.equal(
      typeof deltaShadowOnlyDecision?.summary === 'string' &&
        String(deltaShadowOnlyDecision.summary).includes('Shadow-only route verdicts'),
      true
    );
    assert.equal(
      Array.isArray(deltaShadowOnlyDecision?.candidates) &&
        (deltaShadowOnlyDecision?.candidates as Array<Record<string, unknown>>).some(
          (candidate) =>
            candidate?.brokerKey === 'delta_exchange' &&
            candidate?.shadowOnly === true &&
            candidate?.supported === true &&
            candidate?.allowed === true
        ),
      true
    );

    env.suggestedTrades.liveAuto.executionEnabled = true;
    env.suggestedTrades.liveAuto.adaptiveRoutingMode = 'live';
    env.suggestedTrades.liveAuto.brokerAllowlist = ['mudrex', 'delta_exchange'];
    env.suggestedTrades.liveAuto.shadowBrokerAllowlist = [];
    process.env.SUGGESTED_TRADES_LIVE_AUTO_EXECUTION_ENABLED = 'true';
    process.env.SUGGESTED_TRADES_LIVE_AUTO_ADAPTIVE_ROUTING_MODE = 'live';
    process.env.SUGGESTED_TRADES_LIVE_AUTO_BROKER_ALLOWLIST = 'mudrex,delta_exchange';
    process.env.SUGGESTED_TRADES_LIVE_AUTO_SHADOW_BROKER_ALLOWLIST = '';
    currentTrade = {
      ...currentTrade,
      id: 'st-live-auto-risk-6',
      symbol: 'BTCUSDT',
      side: 'BUY',
      entryPrice: '100',
      stopLossPrice: '95',
      takeProfitTargets: ['108'],
      status: 'Open',
    };
    const persistedCountBeforeFailover = persistedExecutions.length;
    const failoverPlacedRoutes: string[] = [];

    const brokerFailoverPlaced = await service.attemptAutoLiveExecutionForAutomation(
      'user-1',
      'st-live-auto-risk-6',
      {
        async createOrder(assetId: string, body: Record<string, unknown>) {
          const route = `${String(body.brokerKey)}:${String(body.accountId)}`;
          failoverPlacedRoutes.push(route);
          assert.equal(
            String(body.idempotency_key || '').includes(`st-live-auto-risk-6:${route}`),
            true
          );
          if (body.brokerKey === 'delta_exchange') {
            assert.equal(assetId, 'delta-asset-1');
            throw new BadRequestAppError(
              'Order rejected: insufficient margin',
              'ORDER_REJECTED_INSUFFICIENT_MARGIN'
            );
          }

          assert.equal(assetId, 'mudrex-asset-1');
          assert.equal(body.brokerKey, 'mudrex');
          assert.equal(body.accountId, 'acc-1');
          return {
            success: true,
            data: {
              order_id: 'mudrex-live-order-risk-6',
              status: 'OPEN',
            },
          };
        },
      }
    );

    assert.equal(brokerFailoverPlaced.outcome, 'placed', brokerFailoverPlaced.message);
    assert.equal(brokerFailoverPlaced.brokerKey, 'mudrex');
    assert.equal(brokerFailoverPlaced.accountId, 'acc-1');
    assert.equal(brokerFailoverPlaced.orderId, 'mudrex-live-order-risk-6');
    assert.deepEqual(failoverPlacedRoutes, ['delta_exchange:delta-acc-1', 'mudrex:acc-1']);
    const failoverExecutions = persistedExecutions.slice(persistedCountBeforeFailover);
    const finalFailoverExecution = [...failoverExecutions]
      .reverse()
      .find((execution) => Array.isArray(execution.routeAttempts));
    const routeAttempts =
      (finalFailoverExecution?.routeAttempts as Array<Record<string, unknown>> | undefined) ?? [];
    assert.equal(routeAttempts.length, 2);
    assert.equal(routeAttempts[0]?.brokerKey, 'delta_exchange');
    assert.equal(routeAttempts[0]?.accountId, 'delta-acc-1');
    assert.equal(routeAttempts[0]?.status, 'failed');
    assert.equal(routeAttempts[0]?.failureClassification, 'confirmed_no_order');
    assert.equal(routeAttempts[0]?.failureCode, 'ORDER_REJECTED_INSUFFICIENT_MARGIN');
    assert.match(String(routeAttempts[0]?.failureMessage || ''), /insufficient margin/i);
    assert.equal(routeAttempts[1]?.brokerKey, 'mudrex');
    assert.equal(routeAttempts[1]?.accountId, 'acc-1');
    assert.equal(routeAttempts[1]?.status, 'placed');
    assert.equal(routeAttempts[1]?.orderId, 'mudrex-live-order-risk-6');

    deltaReconciliationMode = 'empty';
    latestDeltaIdempotencyKey = null;
    currentTrade = {
      ...currentTrade,
      id: 'st-live-auto-risk-7',
      symbol: 'BTCUSDT',
      side: 'BUY',
      entryPrice: '100',
      stopLossPrice: '95',
      takeProfitTargets: ['108'],
      status: 'Open',
    };
    const persistedCountBeforeAmbiguousNoOrder = persistedExecutions.length;
    const ambiguousNoOrderRoutes: string[] = [];

    const ambiguousNoOrderFailover = await service.attemptAutoLiveExecutionForAutomation(
      'user-1',
      'st-live-auto-risk-7',
      {
        async createOrder(assetId: string, body: Record<string, unknown>) {
          const route = `${String(body.brokerKey)}:${String(body.accountId)}`;
          ambiguousNoOrderRoutes.push(route);
          if (body.brokerKey === 'delta_exchange') {
            assert.equal(assetId, 'delta-asset-1');
            latestDeltaIdempotencyKey = String(body.idempotency_key || '');
            throw new Error('Broker gateway timeout after submit');
          }

          assert.equal(assetId, 'mudrex-asset-1');
          assert.equal(body.brokerKey, 'mudrex');
          assert.equal(body.accountId, 'acc-1');
          return {
            success: true,
            data: {
              order_id: 'mudrex-live-order-risk-7',
              status: 'OPEN',
            },
          };
        },
      }
    );

    assert.equal(ambiguousNoOrderFailover.outcome, 'placed', ambiguousNoOrderFailover.message);
    assert.equal(ambiguousNoOrderFailover.brokerKey, 'mudrex');
    assert.deepEqual(ambiguousNoOrderRoutes, ['delta_exchange:delta-acc-1', 'mudrex:acc-1']);
    const ambiguousNoOrderExecution = [...persistedExecutions]
      .slice(persistedCountBeforeAmbiguousNoOrder)
      .reverse()
      .find((execution) => Array.isArray(execution.routeAttempts));
    const ambiguousNoOrderAttempts =
      (ambiguousNoOrderExecution?.routeAttempts as Array<Record<string, unknown>> | undefined) ??
      [];
    assert.equal(ambiguousNoOrderAttempts[0]?.brokerKey, 'delta_exchange');
    assert.equal(
      (ambiguousNoOrderAttempts[0]?.reconciliation as Record<string, unknown> | undefined)?.status,
      'confirmed_no_order'
    );
    assert.equal(ambiguousNoOrderAttempts[1]?.brokerKey, 'mudrex');
    assert.equal(ambiguousNoOrderAttempts[1]?.status, 'placed');

    deltaReconciliationMode = 'found_order';
    latestDeltaIdempotencyKey = null;
    currentTrade = {
      ...currentTrade,
      id: 'st-live-auto-risk-8',
      symbol: 'BTCUSDT',
      side: 'BUY',
      entryPrice: '100',
      stopLossPrice: '95',
      takeProfitTargets: ['108'],
      status: 'Open',
    };
    const persistedCountBeforeFoundOrder = persistedExecutions.length;
    const foundOrderRoutes: string[] = [];

    const foundOrderResult = await service.attemptAutoLiveExecutionForAutomation(
      'user-1',
      'st-live-auto-risk-8',
      {
        async createOrder(assetId: string, body: Record<string, unknown>) {
          foundOrderRoutes.push(`${String(body.brokerKey)}:${String(body.accountId)}`);
          assert.equal(assetId, 'delta-asset-1');
          assert.equal(body.brokerKey, 'delta_exchange');
          latestDeltaIdempotencyKey = String(body.idempotency_key || '');
          throw new Error('Broker gateway timeout after submit');
        },
      }
    );

    assert.equal(foundOrderResult.outcome, 'working', foundOrderResult.message);
    assert.equal(foundOrderResult.brokerKey, 'delta_exchange');
    assert.equal(foundOrderResult.orderId, 'delta-reconciled-order-1');
    assert.deepEqual(foundOrderRoutes, ['delta_exchange:delta-acc-1']);
    const foundOrderExecution = [...persistedExecutions]
      .slice(persistedCountBeforeFoundOrder)
      .reverse()
      .find((execution) => Array.isArray(execution.routeAttempts));
    assert.equal(foundOrderExecution?.orderId, 'delta-reconciled-order-1');
    const foundOrderAttempts =
      (foundOrderExecution?.routeAttempts as Array<Record<string, unknown>> | undefined) ?? [];
    assert.equal(foundOrderAttempts.length, 1);
    assert.equal(foundOrderAttempts[0]?.status, 'working');
    assert.equal(
      (foundOrderAttempts[0]?.reconciliation as Record<string, unknown> | undefined)?.status,
      'found_order'
    );

    deltaReconciliationMode = 'found_position';
    latestDeltaIdempotencyKey = null;
    currentTrade = {
      ...currentTrade,
      id: 'st-live-auto-risk-9',
      symbol: 'BTCUSDT',
      side: 'BUY',
      entryPrice: '100',
      stopLossPrice: '95',
      takeProfitTargets: ['108'],
      status: 'Open',
    };
    const persistedCountBeforeFoundPosition = persistedExecutions.length;
    const foundPositionRoutes: string[] = [];

    const foundPositionResult = await service.attemptAutoLiveExecutionForAutomation(
      'user-1',
      'st-live-auto-risk-9',
      {
        async createOrder(assetId: string, body: Record<string, unknown>) {
          foundPositionRoutes.push(`${String(body.brokerKey)}:${String(body.accountId)}`);
          assert.equal(assetId, 'delta-asset-1');
          assert.equal(body.brokerKey, 'delta_exchange');
          latestDeltaIdempotencyKey = String(body.idempotency_key || '');
          throw new Error('Broker gateway timeout after submit');
        },
      }
    );

    assert.equal(foundPositionResult.outcome, 'working', foundPositionResult.message);
    assert.equal(foundPositionResult.brokerKey, 'delta_exchange');
    assert.equal(foundPositionResult.orderId, null);
    assert.deepEqual(foundPositionRoutes, ['delta_exchange:delta-acc-1']);
    const foundPositionExecution = [...persistedExecutions]
      .slice(persistedCountBeforeFoundPosition)
      .reverse()
      .find((execution) => Array.isArray(execution.routeAttempts));
    assert.equal(foundPositionExecution?.positionId, 'delta-reconciled-position-1');
    assert.equal(foundPositionExecution?.executionState, 'working');
    const foundPositionAttempts =
      (foundPositionExecution?.routeAttempts as Array<Record<string, unknown>> | undefined) ?? [];
    assert.equal(foundPositionAttempts.length, 1);
    assert.equal(foundPositionAttempts[0]?.status, 'working');
    assert.equal(
      (foundPositionAttempts[0]?.reconciliation as Record<string, unknown> | undefined)?.status,
      'found_position'
    );

    deltaReconciliationMode = 'empty';
    latestDeltaIdempotencyKey = null;
    mudrexRiskOrderFailureMessage = 'protection levels already crossed';
    service.detectLiveAutoDeltaNativeProtectionConflict = async (
      _userId: string,
      brokerKey: string,
      _accountId: string,
      symbol: string
    ) =>
      brokerKey === 'delta_exchange' && String(symbol).trim().toUpperCase() === 'BTCUSDT'
        ? 'Delta Exchange live-auto native SL/TP is not safe when the account already has an open net position on this symbol. Close or reconcile the existing Delta exposure before placing another protected live-auto order.'
        : null;
    currentTrade = {
      ...currentTrade,
      id: 'st-live-auto-risk-10',
      symbol: 'BTCUSDT',
      side: 'BUY',
      entryPrice: '100',
      stopLossPrice: '95',
      takeProfitTargets: ['108'],
      status: 'Open',
    };
    const persistedCountBeforeProtectionFailure = persistedExecutions.length;
    const protectionFailureRoutes: string[] = [];

    const protectionFailureResult = await service.attemptAutoLiveExecutionForAutomation(
      'user-1',
      'st-live-auto-risk-10',
      {
        async createOrder(assetId: string, body: Record<string, unknown>) {
          protectionFailureRoutes.push(`${String(body.brokerKey)}:${String(body.accountId)}`);
          assert.equal(assetId, 'mudrex-asset-1');
          assert.equal(body.brokerKey, 'mudrex');
          assert.equal(body.accountId, 'acc-1');
          return {
            success: true,
            data: {
              order_id: 'mudrex-live-order-risk-10',
              status: 'OPEN',
            },
          };
        },
      }
    );

    assert.equal(protectionFailureResult.outcome, 'placed', protectionFailureResult.message);
    assert.equal(protectionFailureResult.brokerKey, 'mudrex');
    assert.equal(protectionFailureResult.orderId, 'mudrex-live-order-risk-10');
    assert.deepEqual(protectionFailureRoutes, ['mudrex:acc-1']);
    const protectionFailureExecution = [...persistedExecutions]
      .slice(persistedCountBeforeProtectionFailure)
      .reverse()
      .find((execution) => Array.isArray(execution.routeAttempts));
    assert.equal(protectionFailureExecution?.orderId, 'mudrex-live-order-risk-10');
    assert.equal(protectionFailureExecution?.executionState, 'closed');
    assert.equal(protectionFailureExecution?.positionStatus, 'CLOSED');
    assert.equal(protectionFailureExecution?.protectionState, 'not_required');
    assert.equal(protectionFailureExecution?.protectionLastError, null);
    assert.match(String(protectionFailureExecution?.note || ''), /closed immediately/);
    assert.equal(mudrexClosedPositions.at(-1)?.positionId, 'mudrex-pos-st-live-auto-risk-10');
    const protectionFailureAttempts =
      (protectionFailureExecution?.routeAttempts as Array<Record<string, unknown>> | undefined) ??
      [];
    assert.equal(protectionFailureAttempts.length, 1);
    assert.equal(protectionFailureAttempts[0]?.status, 'placed');
    assert.equal(protectionFailureAttempts[0]?.failureClassification, undefined);
    assert.equal(protectionFailureAttempts[0]?.failureMessage, undefined);
    mudrexRiskOrderFailureMessage = null;
  } finally {
    env.suggestedTrades.rolloutEnabled = originalRolloutEnabled;
    env.suggestedTrades.liveAuto.enabled = originalLiveAuto.enabled;
    env.suggestedTrades.liveAuto.executionEnabled = originalLiveAuto.executionEnabled;
    env.suggestedTrades.liveAuto.adaptiveRoutingMode = originalLiveAuto.adaptiveRoutingMode;
    env.suggestedTrades.liveAuto.requireFixedRouting = originalLiveAuto.requireFixedRouting;
    env.suggestedTrades.liveAuto.userAllowlist = [...originalLiveAuto.userAllowlist];
    env.suggestedTrades.liveAuto.brokerAllowlist = [...originalLiveAuto.brokerAllowlist];
    env.suggestedTrades.liveAuto.shadowBrokerAllowlist = [
      ...originalLiveAuto.shadowBrokerAllowlist,
    ];
    restoreEnv('SUGGESTED_TRADES_ROLLOUT_ENABLED', originalEnvFlags.rolloutEnabled);
    restoreEnv('SUGGESTED_TRADES_LIVE_AUTO_ENABLED', originalEnvFlags.enabled);
    restoreEnv('SUGGESTED_TRADES_LIVE_AUTO_EXECUTION_ENABLED', originalEnvFlags.executionEnabled);
    restoreEnv(
      'SUGGESTED_TRADES_LIVE_AUTO_ADAPTIVE_ROUTING_MODE',
      originalEnvFlags.adaptiveRoutingMode
    );
    restoreEnv(
      'SUGGESTED_TRADES_LIVE_AUTO_REQUIRE_FIXED_ROUTING',
      originalEnvFlags.requireFixedRouting
    );
    restoreEnv('SUGGESTED_TRADES_LIVE_AUTO_USER_ALLOWLIST', originalEnvFlags.userAllowlist);
    restoreEnv('SUGGESTED_TRADES_LIVE_AUTO_BROKER_ALLOWLIST', originalEnvFlags.brokerAllowlist);
    restoreEnv(
      'SUGGESTED_TRADES_LIVE_AUTO_SHADOW_BROKER_ALLOWLIST',
      originalEnvFlags.shadowBrokerAllowlist
    );
  }
}

async function runSuggestedTradeLiveAutoLifecycleMonitorAssertions(): Promise<void> {
  const service = new SuggestedTradesService() as any;
  const riskOrders: Array<{
    positionId: string;
    body: Record<string, unknown>;
    context?: Record<string, unknown>;
  }> = [];
  const persistedProtectionStates: Array<string | null> = [];
  let execution: SuggestedTradeExecutionLink = {
    executionMode: 'live',
    executionState: 'working',
    orderId: 'mudrex-entry-monitor-1',
    orderStatus: 'OPEN',
    brokerKey: 'mudrex',
    accountId: 'acc-1',
    orderType: 'limit',
    quantity: 180,
    entryPrice: '0.7928',
    stopLossPrice: '0.7942',
    takeProfitPrice: '0.7854',
    submittedAt: '2026-05-11T14:37:50.000Z',
    linkedAt: '2026-05-11T14:37:53.000Z',
    protectionState: 'waiting_for_position',
    protectionPlan: {
      brokerKey: 'mudrex',
      accountId: 'acc-1',
      orderId: 'mudrex-entry-monitor-1',
      entryPrice: '0.7928',
      stopLossPrice: '0.7942',
      takeProfitPrice: '0.7854',
    },
    routeAttempts: [
      {
        attemptNumber: 1,
        candidateRank: 1,
        brokerKey: 'mudrex',
        accountId: 'acc-1',
        requestedSymbol: 'PIEVERSEUSDT',
        brokerSymbol: 'PIEVERSEUSDT',
        status: 'working',
        submissionState: 'accepted',
        orderId: 'mudrex-entry-monitor-1',
      },
    ],
  };
  const trade = {
    id: 'st-live-auto-monitor',
    userId: 'user-1',
    symbol: 'PIEVERSEUSDT',
    side: 'SELL',
    timeframe: '5m',
    automationId: 'auto-1',
    signalTime: new Date('2026-05-11T14:30:00.000Z'),
    createdAt: new Date('2026-05-11T14:37:00.000Z'),
    meta: null,
    executionRecord: execution,
  } as unknown as SuggestedTrade;

  service.suggestedTradeRepository = {
    async getSuggestedTradeById() {
      return trade;
    },
    async saveSuggestedTradeExecution() {
      throw new Error('live-auto monitor assertions stub persistExecutionState directly');
    },
  };
  service.persistExecutionState = async (
    _trade: SuggestedTrade,
    nextExecution: SuggestedTradeExecutionLink
  ) => {
    persistedProtectionStates.push(nextExecution.protectionState ?? null);
    execution = nextExecution;
    (trade as any).executionRecord = nextExecution;
  };
  service.loadTradeSuggestionExecutionPolicy = async () => ({
    executionMode: 'live_trade_auto',
    approvalMode: 'auto_if_safe',
    routeMode: 'fixed',
    brokerKey: 'mudrex',
    accountId: 'acc-1',
    liveConsentEnabled: true,
    orderType: 'limit',
    timeInForce: 'GTC',
    quantityMode: 'quantity',
    quantity: 180,
    notional: null,
    riskPercent: null,
    leverage: 5,
    reduceOnly: false,
    maxOrdersPerRun: 1,
    maxOrdersPerDay: 1,
    maxConcurrentOpenTrades: 1,
    maxNotionalPerTrade: null,
    maxNotionalPerDay: null,
    dedupeWindowSeconds: 3600,
    freshness: { enabled: true, graceSeconds: 300, timeframeGraceSeconds: {} },
    limitOrderExpiry: { enabled: true, expirySeconds: 300, timeframeExpirySeconds: {} },
  });
  service.brokerRuntimeRegistry = {
    supportsOrdersAdapter: () => true,
    supportsPositionsAdapter: () => true,
    getOrdersAdapter: () => ({
      async getOrder() {
        return {
          data: {
            order_id: 'mudrex-entry-monitor-1',
            status: 'FILLED',
            filled_price: '0.7928',
            filled_quantity: 180,
            remaining_quantity: 0,
            updated_at: '2026-05-11T14:37:54.000Z',
          },
        };
      },
      async cancelOrder() {
        throw new Error('filled monitor must not cancel entry order');
      },
    }),
    getPositionsAdapter: () => ({
      async getPositions() {
        return {
          data: [
            {
              id: 'mudrex-position-monitor-1',
              symbol: 'PIEVERSEUSDT',
              status: 'OPEN',
              position_type: 'SHORT',
              quantity: 180,
              entry_price: '0.7928',
              current_price: '0.7930',
              created_at: '2026-05-11T14:37:54.000Z',
              stoploss_price: 0,
              takeprofit_price: 0,
            },
          ],
        };
      },
      async createRiskOrder(
        positionId: string,
        body: Record<string, unknown>,
        context?: Record<string, unknown>
      ) {
        riskOrders.push({ positionId, body, context });
        return { status: 'CREATED' };
      },
    }),
  };

  const settled = await service.runLiveAutoOrderLifecycleMonitorOnce({
    userId: 'user-1',
    suggestedTradeId: 'st-live-auto-monitor',
    brokerKey: 'mudrex',
    accountId: 'acc-1',
    orderId: 'mudrex-entry-monitor-1',
  });
  assert.equal(settled, true);
  assert.equal(execution.executionState, 'filled');
  assert.equal(execution.orderStatus, 'FILLED');
  assert.equal(execution.positionId, 'mudrex-position-monitor-1');
  assert.equal(execution.protectionState, 'attached');
  assert.equal(riskOrders.length, 1);
  assert.equal(riskOrders[0]?.positionId, 'mudrex-position-monitor-1');
  assert.equal(riskOrders[0]?.body.stoploss_price, '0.794200');
  assert.equal(riskOrders[0]?.body.takeprofit_price, '0.785400');
  assert.deepEqual(persistedProtectionStates, ['attaching', 'attached']);
  assert.equal(
    service.isLiveAutoLifecycleMonitorSettled({
      executionMode: 'live',
      executionState: 'working',
      protectionState: 'failed',
      protectionAttempts: 1,
      protectionLastError: 'position not found',
    }),
    false
  );
  assert.equal(
    service.isLiveAutoLifecycleMonitorSettled({
      executionMode: 'live',
      executionState: 'working',
      protectionState: 'failed',
      protectionAttempts: 3,
      protectionLastError: 'position not found',
    }),
    true
  );

  let cancelledOrderId: string | null = null;
  execution = {
    executionMode: 'live',
    executionState: 'working',
    orderId: 'mudrex-entry-monitor-expired',
    orderStatus: 'OPEN',
    brokerKey: 'mudrex',
    accountId: 'acc-1',
    orderType: 'limit',
    quantity: 180,
    entryPrice: '0.7928',
    stopLossPrice: '0.7942',
    takeProfitPrice: '0.7854',
    submittedAt: '2026-05-11T14:00:00.000Z',
    linkedAt: '2026-05-11T14:00:00.000Z',
    protectionState: 'waiting_for_fill',
  };
  (trade as any).executionRecord = execution;
  service.loadTradeSuggestionExecutionPolicy = async () => ({
    executionMode: 'live_trade_auto',
    approvalMode: 'auto_if_safe',
    routeMode: 'fixed',
    brokerKey: 'mudrex',
    accountId: 'acc-1',
    liveConsentEnabled: true,
    orderType: 'limit',
    timeInForce: 'GTC',
    quantityMode: 'quantity',
    quantity: 180,
    notional: null,
    riskPercent: null,
    leverage: 5,
    reduceOnly: false,
    maxOrdersPerRun: 1,
    maxOrdersPerDay: 1,
    maxConcurrentOpenTrades: 1,
    maxNotionalPerTrade: null,
    maxNotionalPerDay: null,
    dedupeWindowSeconds: 3600,
    freshness: { enabled: true, graceSeconds: 300, timeframeGraceSeconds: {} },
    limitOrderExpiry: { enabled: true, expirySeconds: 1, timeframeExpirySeconds: {} },
  });
  service.brokerRuntimeRegistry = {
    supportsOrdersAdapter: () => true,
    supportsPositionsAdapter: () => true,
    getOrdersAdapter: () => ({
      async getOrder() {
        return {
          data: {
            order_id: 'mudrex-entry-monitor-expired',
            status: 'OPEN',
            created_at: '2026-05-11T14:00:00.000Z',
            updated_at: '2026-05-11T14:00:01.000Z',
          },
        };
      },
      async cancelOrder(orderId: string) {
        cancelledOrderId = orderId;
        return { status: 'CANCELLED' };
      },
    }),
    getPositionsAdapter: () => ({
      async getPositions() {
        return [];
      },
    }),
  };

  const expiredSettled = await service.runLiveAutoOrderLifecycleMonitorOnce({
    userId: 'user-1',
    suggestedTradeId: 'st-live-auto-monitor',
    brokerKey: 'mudrex',
    accountId: 'acc-1',
    orderId: 'mudrex-entry-monitor-expired',
  });
  assert.equal(expiredSettled, true);
  assert.equal(cancelledOrderId, 'mudrex-entry-monitor-expired');
  assert.equal(execution.executionState, 'expired');
  assert.equal(execution.orderStatus, 'EXPIRED');
  assert.equal(execution.protectionState, 'not_required');

  const resumedMonitors: Array<Record<string, unknown>> = [];
  service.startLiveAutoOrderLifecycleMonitor = (input: Record<string, unknown>) => {
    resumedMonitors.push({ ...input });
  };
  execution = {
    executionMode: 'live',
    executionState: 'working',
    orderId: 'mudrex-entry-monitor-retry',
    orderStatus: 'FILLED',
    brokerKey: 'mudrex',
    accountId: 'acc-1',
    orderType: 'limit',
    quantity: 180,
    entryPrice: '0.7928',
    stopLossPrice: '0.7942',
    takeProfitPrice: '0.7854',
    submittedAt: '2026-05-11T14:37:50.000Z',
    linkedAt: '2026-05-11T14:37:53.000Z',
    protectionState: 'failed',
    protectionAttempts: 1,
    protectionLastError: 'Mudrex protection remediation failed: position not found',
  };
  (trade as any).executionRecord = execution;
  service.suggestedTradeRepository = {
    async getLinkedOrderSnapshot() {
      return null;
    },
    async saveSuggestedTradeExecution(payload: Record<string, unknown>) {
      return {
        ...payload,
        createdAt: new Date('2026-05-11T14:39:00.000Z'),
        updatedAt: new Date('2026-05-11T14:39:00.000Z'),
      };
    },
  };

  const recoveryRefreshCount = await service.refreshExecutionOutcomes('user-1', [trade], {
    resolveStaleGaps: true,
  });
  assert.equal(recoveryRefreshCount, 1);
  assert.deepEqual(resumedMonitors, [
    {
      userId: 'user-1',
      suggestedTradeId: 'st-live-auto-monitor',
      brokerKey: 'mudrex',
      accountId: 'acc-1',
      orderId: 'mudrex-entry-monitor-retry',
    },
  ]);
}

async function runSuggestedTradeDeltaProductPreflightAssertions(): Promise<void> {
  const adapter = new DeltaExchangeOrdersAdapter() as any;
  const deltaProduct = {
    id: '139',
    symbol: 'BTCUSD',
    state: 'live',
    trading_status: 'operational',
    contract_type: 'perpetual_futures',
    contract_value: '0.001',
    contract_unit_currency: 'BTC',
    notional_type: 'vanilla',
  };

  assert.equal(
    adapter.resolveOrderSize(
      1,
      deltaProduct,
      {
        idempotency_key: 'live-auto:test:btc',
        symbol: 'BTCUSDT',
      },
      139
    ),
    1000
  );
  assert.equal(
    adapter.resolveOrderSize(
      0.002,
      deltaProduct,
      {
        idempotency_key: 'live-auto:test:btcusd',
        symbol: 'BTCUSD',
      },
      139
    ),
    2
  );
  assert.throws(
    () =>
      adapter.resolveOrderSize(
        0.0005,
        deltaProduct,
        {
          idempotency_key: 'live-auto:test:tiny',
          symbol: 'BTCUSDT',
        },
        139
      ),
    /smaller than one whole BTCUSD contract/
  );

  const service = new SuggestedTradesService() as any;
  const preflightCalls: Array<{ assetId: string; symbol: string; quantity: number }> = [];
  service.brokerRuntimeRegistry = {
    getOrdersAdapter() {
      return {
        async preflightLiveAutoOrder(assetId: string, body: Record<string, unknown>) {
          const symbol = String(body.symbol || '')
            .trim()
            .toUpperCase();
          const quantity = Number(body.quantity);
          preflightCalls.push({ assetId, symbol, quantity });
          if (symbol === 'TINYUSDT') {
            throw new Error(
              'Delta Exchange live-auto base quantity 0.0005 is smaller than one whole TINYUSD contract (contract_value 0.001)'
            );
          }
          if (symbol === 'JCTUSDT') {
            return {
              quantityContracts: 57300,
              contractValue: 1,
              contractUnitCurrency: 'JCT',
              auditNote:
                'Delta product preflight passed for JCTUSD: product 789 is live/operational, contract_value 1 JCT, requested base quantity 57300 JCT routes as 57300 contracts.',
            };
          }
          return {
            quantityContracts: symbol === 'BTCUSD' ? 2 : 1000,
            contractValue: 0.001,
            contractUnitCurrency: 'BTC',
            auditNote: `Delta product preflight passed for ${symbol === 'BTCUSD' ? 'BTCUSD' : 'BTCUSD'}: product 139 is live/operational, contract_value 0.001 BTC, requested base quantity ${quantity} BTC routes as ${symbol === 'BTCUSD' ? 2 : 1000} contracts.`,
          };
        },
      };
    },
  };

  const btcUsdt = await service.normalizeLiveAutoOrderSizing(
    'delta_exchange',
    '139',
    'BTCUSDT',
    1,
    100,
    95,
    108,
    'long',
    'limit'
  );
  assert.equal(btcUsdt.quantity, 1);
  assert.match(String(btcUsdt.auditNote), /1000 contracts/);

  const btcUsd = await service.normalizeLiveAutoOrderSizing(
    'delta_exchange',
    '139',
    'BTCUSD',
    0.002,
    100,
    95,
    108,
    'long',
    'limit'
  );
  assert.equal(btcUsd.quantity, 0.002);
  assert.match(String(btcUsd.auditNote), /2 contracts/);

  const jct = await service.normalizeLiveAutoOrderSizing(
    'delta_exchange',
    '789',
    'JCTUSDT',
    57300,
    0.01,
    0.009,
    0.012,
    'long',
    'limit'
  );
  assert.equal(jct.quantity, 57300);
  assert.match(String(jct.auditNote), /57300 contracts/);

  await assert.rejects(
    () =>
      service.normalizeLiveAutoOrderSizing(
        'delta_exchange',
        'tiny-1',
        'TINYUSDT',
        0.0005,
        100,
        95,
        108,
        'long',
        'limit'
      ),
    /smaller than one whole TINYUSD contract/
  );
  assert.deepEqual(
    preflightCalls.map((call) => `${call.assetId}:${call.symbol}`),
    ['139:BTCUSDT', '139:BTCUSD', '789:JCTUSDT', 'tiny-1:TINYUSDT']
  );

  const mudrexPreflightService = new SuggestedTradesService() as any;
  mudrexPreflightService.brokerReferenceDataService = {
    async getFuturesAssetDetailBySymbol(_brokerKey: string, symbol: string) {
      assert.equal(symbol, 'PUMPBTCUSDT');
      return {
        data: {
          quantity_step: '10',
          min_contract: '10',
          max_contract: '330000',
          max_market_contract: '330000',
          min_notional_value: '5',
          price_step: '0.000001',
          min_price: '0.000001',
          max_price: '1000000',
          min_leverage: '1',
          max_leverage: '5',
          leverage_step: '0.01',
        },
      };
    },
  };
  const mudrexSized = await mudrexPreflightService.normalizeLiveAutoOrderSizing(
    'mudrex',
    'mudrex-pump',
    'PUMPBTCUSDT',
    11370,
    0.01588,
    0.015,
    0.017,
    'short',
    'limit',
    5
  );
  assert.equal(mudrexSized.quantity, 11370);
  await assert.rejects(
    () =>
      mudrexPreflightService.normalizeLiveAutoOrderSizing(
        'mudrex',
        'mudrex-pump',
        'PUMPBTCUSDT',
        11370,
        0.01588,
        0.015,
        0.017,
        'short',
        'limit',
        15
      ),
    /Mudrex requested leverage 15x exceeds the broker maximum leverage 5x for PUMPBTCUSDT/
  );

  const unsupportedRouteService = new SuggestedTradesService() as any;
  unsupportedRouteService.exchangeAssetRepository = {
    async listSystemAssetsBySourceAndSymbols(source: string, symbols: string[]) {
      assert.equal(source, 'delta_exchange');
      assert.deepEqual(symbols, ['SKRUSDT', 'SKRUSD', 'SKRUSDC']);
      return [];
    },
  };
  await assert.rejects(
    () => unsupportedRouteService.resolveLiveAutoAssetRoute('delta_exchange', 'SKRUSDT'),
    (error: Error) => {
      assert.match(error.message, /Delta product unsupported for SKRUSDT/);
      assert.match(error.message, /SKRUSDT, SKRUSD, SKRUSDC/);
      assert.doesNotMatch(error.message, /Run exchange-assets-sync before live auto placement/);
      return true;
    }
  );

  const originalRolloutEnabled = env.suggestedTrades.rolloutEnabled;
  const originalLiveAuto = {
    enabled: env.suggestedTrades.liveAuto.enabled,
    executionEnabled: env.suggestedTrades.liveAuto.executionEnabled,
    requireFixedRouting: env.suggestedTrades.liveAuto.requireFixedRouting,
    userAllowlist: [...env.suggestedTrades.liveAuto.userAllowlist],
    brokerAllowlist: [...env.suggestedTrades.liveAuto.brokerAllowlist],
    shadowBrokerAllowlist: [...env.suggestedTrades.liveAuto.shadowBrokerAllowlist],
  };
  const originalEnvFlags = {
    rolloutEnabled: process.env.SUGGESTED_TRADES_ROLLOUT_ENABLED,
    enabled: process.env.SUGGESTED_TRADES_LIVE_AUTO_ENABLED,
    executionEnabled: process.env.SUGGESTED_TRADES_LIVE_AUTO_EXECUTION_ENABLED,
    requireFixedRouting: process.env.SUGGESTED_TRADES_LIVE_AUTO_REQUIRE_FIXED_ROUTING,
    userAllowlist: process.env.SUGGESTED_TRADES_LIVE_AUTO_USER_ALLOWLIST,
    brokerAllowlist: process.env.SUGGESTED_TRADES_LIVE_AUTO_BROKER_ALLOWLIST,
    shadowBrokerAllowlist: process.env.SUGGESTED_TRADES_LIVE_AUTO_SHADOW_BROKER_ALLOWLIST,
  };
  const blockedService = new SuggestedTradesService() as any;
  let persistedExecution: Record<string, unknown> | null = null;

  blockedService.suggestedTradeRepository = {
    async getSuggestedTradeById() {
      return {
        id: 'st-delta-tiny-preflight',
        automationId: 'auto-delta',
        automationRunId: 'run-delta',
        userId: 'user-1',
        symbol: 'TINYUSDT',
        timeframe: '5m',
        side: 'BUY',
        signalTime: new Date(),
        status: 'Open',
        entryPrice: '100',
        stopLossPrice: '95',
        takeProfitTargets: ['108'],
        dedupeKey: 'dedupe-delta-tiny',
        meta: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    },
    async countSystemAcceptedExecutionsSince() {
      return 0;
    },
    async countActiveExecutionsForAutomation() {
      return 0;
    },
  };
  blockedService.loadTradeSuggestionExecutionPolicy = async () => ({
    executionMode: 'live_trade_auto',
    approvalMode: 'auto_if_safe',
    routeMode: 'fixed',
    brokerKey: 'delta_exchange',
    accountId: 'delta-acc-1',
    liveConsentEnabled: true,
    orderType: 'limit',
    timeInForce: 'GTC',
    quantityMode: 'quantity',
    quantity: 0.0005,
    notional: null,
    riskPercent: null,
    leverage: 15,
    reduceOnly: false,
    maxOrdersPerRun: 2,
    maxOrdersPerDay: 3,
    maxConcurrentOpenTrades: 1,
    maxNotionalPerTrade: null,
    maxNotionalPerDay: null,
    dedupeWindowSeconds: 3600,
    freshness: { enabled: false, graceSeconds: null, timeframeGraceSeconds: {} },
  });
  blockedService.detectLiveAutoDuplicateAssetConflict = async () => null;
  blockedService.runPreTradeGate = async () => ({
    result: {
      checkId: 'check-delta-tiny',
      status: 'passed',
      decision: {
        allowed: true,
        blocked: false,
        approvalRequired: false,
        blockingRuleCount: 0,
        warningRuleCount: 0,
        summary: 'All clear',
      },
      request: {
        routing: { brokerKey: 'delta_exchange', accountId: 'delta-acc-1' },
        order: {
          symbol: 'TINYUSDT',
          entryPrice: 100,
          stopLossPrice: 95,
          takeProfitTargets: [108],
          leverage: 15,
          quantity: 0.0005,
          orderType: 'limit',
          reduceOnly: false,
        },
      },
      delta: { grossExposureDelta: 0.05 },
    },
    execution: {
      executionMode: 'live',
      preTradeState: 'passed',
      preTradeCheckId: 'check-delta-tiny',
      brokerKey: 'delta_exchange',
      accountId: 'delta-acc-1',
      leverage: 15,
      quantity: 0.0005,
    },
    ready: true,
  });
  blockedService.resolveLiveAutoAssetRoute = async () => ({
    assetId: 'tiny-1',
    requestedSymbol: 'TINYUSDT',
    brokerSymbol: 'TINYUSDT',
    candidateSymbols: ['TINYUSDT'],
    resolvedVia: 'catalog_exact',
  });
  blockedService.brokerRuntimeRegistry = service.brokerRuntimeRegistry;
  blockedService.brokerAccountRepository = {
    async getConnectedBrokerAccounts() {
      return [];
    },
  };
  blockedService.positionReadModelRepository = {
    async listLivePositionsForAccounts() {
      return new Map();
    },
  };
  blockedService.ordersSnapshotSourceRepository = {
    async listOpenOrdersForAccounts() {
      return new Map();
    },
  };
  blockedService.riskKillSwitchService = {
    async findActiveLiveTradingBlock() {
      return null;
    },
  };
  blockedService.operationalEventService = {
    async logActivity() {
      return undefined;
    },
    async emitFailureAlert() {
      return undefined;
    },
  };
  blockedService.persistExecutionState = async (
    _trade: Record<string, unknown>,
    execution: Record<string, unknown>
  ) => {
    persistedExecution = { ...execution };
  };

  try {
    env.suggestedTrades.rolloutEnabled = true;
    env.suggestedTrades.liveAuto.enabled = true;
    env.suggestedTrades.liveAuto.executionEnabled = true;
    env.suggestedTrades.liveAuto.requireFixedRouting = true;
    env.suggestedTrades.liveAuto.userAllowlist = ['user-1'];
    env.suggestedTrades.liveAuto.brokerAllowlist = ['delta_exchange'];
    env.suggestedTrades.liveAuto.shadowBrokerAllowlist = [];
    process.env.SUGGESTED_TRADES_ROLLOUT_ENABLED = 'true';
    process.env.SUGGESTED_TRADES_LIVE_AUTO_ENABLED = 'true';
    process.env.SUGGESTED_TRADES_LIVE_AUTO_EXECUTION_ENABLED = 'true';
    process.env.SUGGESTED_TRADES_LIVE_AUTO_REQUIRE_FIXED_ROUTING = 'true';
    process.env.SUGGESTED_TRADES_LIVE_AUTO_USER_ALLOWLIST = 'user-1';
    process.env.SUGGESTED_TRADES_LIVE_AUTO_BROKER_ALLOWLIST = 'delta_exchange';
    process.env.SUGGESTED_TRADES_LIVE_AUTO_SHADOW_BROKER_ALLOWLIST = '';

    const blocked = await blockedService.attemptAutoLiveExecutionForAutomation(
      'user-1',
      'st-delta-tiny-preflight',
      {
        async createOrder() {
          throw new Error('Delta product preflight should block before createOrder');
        },
      }
    );
    assert.equal(blocked.outcome, 'blocked');
    assert.match(blocked.message, /smaller than one whole TINYUSD contract/);
    assert.equal(persistedExecution?.['executionState'], 'rejected');
    assert.equal(persistedExecution?.['preTradeState'], 'blocked');
    assert.match(
      String(persistedExecution?.['preTradeBlockedReason'] || ''),
      /smaller than one whole TINYUSD contract/
    );
  } finally {
    env.suggestedTrades.rolloutEnabled = originalRolloutEnabled;
    env.suggestedTrades.liveAuto.enabled = originalLiveAuto.enabled;
    env.suggestedTrades.liveAuto.executionEnabled = originalLiveAuto.executionEnabled;
    env.suggestedTrades.liveAuto.requireFixedRouting = originalLiveAuto.requireFixedRouting;
    env.suggestedTrades.liveAuto.userAllowlist = [...originalLiveAuto.userAllowlist];
    env.suggestedTrades.liveAuto.brokerAllowlist = [...originalLiveAuto.brokerAllowlist];
    env.suggestedTrades.liveAuto.shadowBrokerAllowlist = [
      ...originalLiveAuto.shadowBrokerAllowlist,
    ];
    restoreEnv('SUGGESTED_TRADES_ROLLOUT_ENABLED', originalEnvFlags.rolloutEnabled);
    restoreEnv('SUGGESTED_TRADES_LIVE_AUTO_ENABLED', originalEnvFlags.enabled);
    restoreEnv('SUGGESTED_TRADES_LIVE_AUTO_EXECUTION_ENABLED', originalEnvFlags.executionEnabled);
    restoreEnv(
      'SUGGESTED_TRADES_LIVE_AUTO_REQUIRE_FIXED_ROUTING',
      originalEnvFlags.requireFixedRouting
    );
    restoreEnv('SUGGESTED_TRADES_LIVE_AUTO_USER_ALLOWLIST', originalEnvFlags.userAllowlist);
    restoreEnv('SUGGESTED_TRADES_LIVE_AUTO_BROKER_ALLOWLIST', originalEnvFlags.brokerAllowlist);
    restoreEnv(
      'SUGGESTED_TRADES_LIVE_AUTO_SHADOW_BROKER_ALLOWLIST',
      originalEnvFlags.shadowBrokerAllowlist
    );
  }
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

async function runSuggestedTradeDeltaSymbolEquivalenceRepositoryAssertions(): Promise<void> {
  const repository = new SuggestedTradeRepository() as any;
  const originalQuery = coreDataSource.query;
  const calls: Array<{ sql: string; params: unknown[] }> = [];

  repository.loadSuggestedTradesByIds = async (_userId: string, ids: string[]) =>
    ids.map((id) => ({ id }));

  (coreDataSource as any).query = async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (sql.includes('FROM scheduler_positions_snapshots')) {
      return [
        {
          externalId: 'delta-position-1',
          status: 'OPEN',
          statusRank: 1,
          firstSeenAt: '2026-04-04T10:02:00.000Z',
          lastSeenAt: '2026-04-04T10:03:00.000Z',
          payload: JSON.stringify({
            symbol: 'BTCUSD',
            side: 'long',
            status: 'open',
          }),
        },
      ];
    }

    return [{ id: 'st-delta-1' }];
  };

  try {
    const linkedTrades = await repository.findLinkedTradesBySymbols(
      'user-1',
      'delta_exchange',
      'acc-1',
      ['BTCUSD']
    );
    assert.deepEqual(
      linkedTrades.map((item: { id: string }) => item.id),
      ['st-delta-1']
    );
    assert.deepEqual(calls[0]?.params.slice(0, 3), ['user-1', 'delta_exchange', 'acc-1']);
    assert.deepEqual(new Set(calls[0]?.params.slice(3)), new Set(['btcusd', 'btcusdt', 'btcusdc']));
    assert.match(calls[0]?.sql || '', /COALESCE\(execution_row\.position_id, ''\) <> ''/);
    assert.match(calls[0]?.sql || '', /execution_row\.protection_state/);
    assert.doesNotMatch(
      calls[0]?.sql || '',
      /LOWER\(COALESCE\(execution_row\.execution_state, ''\)\) <> 'closed'/
    );

    calls.length = 0;
    const snapshots = await repository.getLinkedPositionSnapshots(
      'user-1',
      'delta_exchange',
      'acc-1',
      'BTCUSDT',
      new Date('2026-04-04T10:00:00.000Z')
    );
    assert.equal(snapshots[0]?.externalId, 'delta-position-1');
    assert.equal(snapshots[0]?.payload?.symbol, 'BTCUSD');
    assert.deepEqual(calls[0]?.params.slice(0, 3), ['user-1', 'acc-1', 'delta_exchange']);
    assert.deepEqual(
      new Set(calls[0]?.params.slice(3, -2)),
      new Set(['btcusdt', 'btcusdc', 'btcusd'])
    );

    calls.length = 0;
    await repository.findRecentTradesBySymbol('user-1', 'delta_exchange', 'acc-1', 'ETHUSDC', 6);
    assert.deepEqual(
      new Set(calls[0]?.params.slice(3, -1)),
      new Set(['ethusdc', 'ethusdt', 'ethusd'])
    );

    calls.length = 0;
    await repository.findLinkedTradesBySymbols('user-1', 'mudrex', 'acc-1', ['BTCUSD']);
    assert.deepEqual(calls[0]?.params.slice(0, 3), ['user-1', 'mudrex', 'acc-1']);
    assert.deepEqual(calls[0]?.params.slice(3), ['btcusd']);
  } finally {
    (coreDataSource as any).query = originalQuery;
  }
}

async function runSuggestedTradeExecutionLinkPreservationAssertions(): Promise<void> {
  const repository = new SuggestedTradeRepository() as any;
  const savedEntities: Array<Record<string, unknown>> = [];
  const existingLiveExecution = {
    suggestedTradeId: 'st-link-preserve',
    userId: 'user-1',
    executionMode: 'live',
    orderId: 'live-order-1',
    brokerKey: 'delta_exchange',
    accountId: 'acc-1',
    linkedAt: new Date('2026-05-14T04:42:34.000Z'),
    protectionSource: 'suggested_trade_execution',
    protectionPlan: {
      source: 'suggested_trade_execution',
      orderId: 'live-order-1',
      stopLossOrderId: 'sl-1',
      takeProfitOrderId: 'tp-1',
    },
  };

  Object.defineProperty(repository, 'executionRepository', {
    value: {
      async findOne({ where }: { where: { suggestedTradeId: string } }) {
        return where.suggestedTradeId === 'st-link-preserve' ? existingLiveExecution : null;
      },
      create(entity: Record<string, unknown>) {
        return entity;
      },
      async save(entity: Record<string, unknown>) {
        savedEntities.push(entity);
        return entity;
      },
    },
  });

  await repository.saveSuggestedTradeExecution({
    suggestedTradeId: 'st-link-preserve',
    userId: 'user-1',
    executionMode: 'live',
    orderId: null,
    brokerKey: null,
    accountId: null,
    orderStatus: 'OPEN',
    executionState: 'working',
    protectionPlan: {
      source: 'suggested_trade_execution',
      orderId: null,
      stopLossOrderId: null,
      takeProfitOrderId: null,
    },
  });

  assert.equal(savedEntities[0]?.orderId, 'live-order-1');
  assert.equal(savedEntities[0]?.brokerKey, 'delta_exchange');
  assert.equal(savedEntities[0]?.accountId, 'acc-1');
  assert.deepEqual(savedEntities[0]?.linkedAt, existingLiveExecution.linkedAt);
  assert.deepEqual(savedEntities[0]?.protectionPlan, {
    source: 'suggested_trade_execution',
    orderId: 'live-order-1',
    stopLossOrderId: 'sl-1',
    takeProfitOrderId: 'tp-1',
  });

  await repository.saveSuggestedTradeExecution({
    suggestedTradeId: 'st-link-preserve',
    userId: 'user-1',
    executionMode: 'paper',
    orderId: null,
    paperOrderId: 'paper-1',
  });

  assert.equal(savedEntities[1]?.orderId, null);
  assert.equal(savedEntities[1]?.paperOrderId, 'paper-1');
}

function runSuggestedTradeDeltaClosedFilledTimestampAssertions(): void {
  const service = new SuggestedTradesService() as any;

  const mergedOrder = service.mergeExecutionOutcome(
    {
      brokerKey: 'delta_exchange',
      orderStatus: 'OPEN',
      executionState: 'working',
      submittedAt: '2026-05-05T12:51:57.000Z',
      filledAt: null,
    },
    {
      orderStatus: 'CLOSED',
      statusRank: 3,
      lastSeenAt: '2026-05-05T12:58:31.000Z',
      payload: {
        status: 'closed',
        created_at: '2026-05-05T12:51:56.967470Z',
        updated_at: '2026-05-05T12:54:07.297083Z',
        filled_price: 0.3577,
        filled_quantity: 2,
      },
    }
  );

  assert.equal(mergedOrder.orderStatus, 'CLOSED');
  assert.equal(mergedOrder.executionState, 'filled');
  assert.equal(mergedOrder.filledAt, '2026-05-05T12:54:07.297Z');
  assert.equal(mergedOrder.filledQuantity, 2);

  const closedUnfilledOrder = service.mergeExecutionOutcome(
    {
      brokerKey: 'delta_exchange',
      orderStatus: 'OPEN',
      executionState: 'working',
      filledAt: null,
    },
    {
      orderStatus: 'CLOSED',
      statusRank: 3,
      lastSeenAt: '2026-05-05T12:58:31.000Z',
      payload: {
        status: 'closed',
        updated_at: '2026-05-05T12:54:07.297083Z',
        filled_quantity: 0,
      },
    }
  );

  assert.equal(closedUnfilledOrder.executionState, 'closed');
  assert.equal(closedUnfilledOrder.filledAt, null);

  const positionMerged = service.mergePositionOutcome(
    {
      symbol: 'BUSDT',
      side: 'BUY',
      signalTime: new Date('2026-05-05T12:45:00.000Z'),
    },
    {
      brokerKey: 'delta_exchange',
      orderStatus: 'CLOSED',
      executionState: 'closed',
      submittedAt: '2026-05-05T12:51:57.000Z',
      filledAt: null,
      filledQuantity: 2,
      quantity: 2,
      entryPrice: '0.3577',
    },
    [
      {
        externalId: '133436',
        status: 'OPEN',
        statusRank: 1,
        firstSeenAt: '2026-05-05T12:55:28.000Z',
        lastSeenAt: '2026-05-05T12:58:28.000Z',
        payload: {
          symbol: 'BUSD',
          side: 'long',
          status: 'open',
          quantity: 2,
          entry_price: '0.3577',
          created_at: '2026-05-05T12:54:07.000Z',
        },
      },
    ]
  );

  assert.equal(positionMerged.positionId, '133436');
  assert.equal(positionMerged.positionOpenedAt, '2026-05-05T12:54:07.000Z');
  assert.equal(positionMerged.filledAt, '2026-05-05T12:54:07.000Z');
  assert.equal(positionMerged.executionState, 'filled');
}

async function runSuggestedTradeSiblingProtectionAutoCancelAssertions(): Promise<void> {
  const service = new SuggestedTradesService() as any;
  let savedExecutionPayload: Record<string, unknown> | null = null;
  const cancelledOrders: Array<{ orderId: string; context: Record<string, unknown> | undefined }> =
    [];

  const trade = {
    id: 'st-protection-close',
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
    dedupeKey: 'dedupe-protection-close',
    meta: {
      execution: {
        executionMode: 'live',
        orderId: 'ord-entry-1',
        brokerKey: 'delta_exchange',
        accountId: 'acc-1',
        executionState: 'working',
        linkedAt: '2026-04-04T10:01:00.000Z',
        submittedAt: '2026-04-04T10:01:00.000Z',
        entryPrice: '100',
        quantity: 1,
        note: 'Live order linked.',
      },
    },
    createdAt: new Date('2026-04-04T10:00:30.000Z'),
    updatedAt: new Date('2026-04-04T10:02:00.000Z'),
  };

  service.suggestedTradeRepository = {
    async getLinkedOrderSnapshot() {
      return {
        orderStatus: 'FILLED',
        statusRank: 3,
        lastSeenAt: '2026-04-04T10:05:00.000Z',
        payload: {
          created_at: '2026-04-04T10:01:00.000Z',
          updated_at: '2026-04-04T10:05:00.000Z',
          filled_at: '2026-04-04T10:03:00.000Z',
        },
      };
    },
    async getLinkedPositionSnapshots() {
      return [
        {
          externalId: 'pos-1',
          status: 'CLOSED',
          statusRank: 3,
          firstSeenAt: '2026-04-04T10:02:00.000Z',
          lastSeenAt: '2026-04-04T10:06:00.000Z',
          payload: {
            status: 'CLOSED',
            side: 'long',
            created_at: '2026-04-04T10:02:00.000Z',
            updated_at: '2026-04-04T10:06:00.000Z',
            closed_at: '2026-04-04T10:06:00.000Z',
            entry_price: '100',
            quantity: '1',
            closed_price: '96',
            realized_pnl: '-4',
          },
        },
      ];
    },
    async saveSuggestedTrade(item: Record<string, unknown>) {
      return {
        ...item,
        updatedAt: new Date('2026-04-04T10:06:00.000Z'),
      };
    },
    async saveSuggestedTradeExecution(payload: Record<string, unknown>) {
      savedExecutionPayload = { ...payload };
      return {
        ...payload,
        createdAt: new Date('2026-04-04T10:06:00.000Z'),
        updatedAt: new Date('2026-04-04T10:06:00.000Z'),
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
  service.resolveLiveProtectionOrderContext = async () => ({
    stopLossOrderId: 'sl-1',
    takeProfitOrderId: 'tp-1',
    stopLossStatus: 'FILLED',
    takeProfitStatus: 'PENDING',
    activeOrderIds: ['tp-1'],
  });
  service.brokerRuntimeRegistry = {
    supportsOrdersAdapter() {
      return true;
    },
    getOrdersAdapter() {
      return {
        async cancelOrder(orderId: string, context?: Record<string, unknown>) {
          cancelledOrders.push({ orderId, context });
          return { success: true };
        },
      };
    },
  };

  const refreshed = await service.refreshExecutionOutcomes('user-1', [trade]);

  assert.equal(refreshed, 1);
  assert.deepEqual(cancelledOrders, [
    {
      orderId: 'tp-1',
      context: {
        userId: 'user-1',
        brokerKey: 'delta_exchange',
        accountId: 'acc-1',
      },
    },
  ]);
  assert.equal(savedExecutionPayload?.['executionState'], 'closed');
  assert.equal(savedExecutionPayload?.['positionStatus'], 'CLOSED');
  assert.match(
    String(savedExecutionPayload?.['note'] || ''),
    /Sibling protection cancel requested after position close: tp-1/
  );

  {
    const liveDeltaService = new SuggestedTradesService() as any;
    const liveCancelledOrders: Array<{
      orderId: string;
      context: Record<string, unknown> | undefined;
    }> = [];
    liveDeltaService.resolveLiveProtectionOrderContext = async () => ({
      stopLossOrderId: 'stale-sl-1',
      takeProfitOrderId: 'stale-tp-1',
      stopLossStatus: 'CLOSED',
      takeProfitStatus: null,
      activeOrderIds: [],
    });
    liveDeltaService.brokerRuntimeRegistry = {
      supportsOrdersAdapter() {
        return true;
      },
      getOrdersAdapter() {
        return {
          async listOpenOrders() {
            return [
              {
                id: 'live-tp-1',
                symbol: 'BTCUSD',
                status: 'open',
                side: 'sell',
                reduce_only: true,
                stop_order_type: 'take_profit_order',
              },
            ];
          },
          async cancelOrder(orderId: string, context?: Record<string, unknown>) {
            liveCancelledOrders.push({ orderId, context });
            return { success: true };
          },
        };
      },
    };

    const nextExecution = await liveDeltaService.maybeAutoCancelSiblingProtectionOrders(
      'user-1',
      trade,
      {
        executionMode: 'live',
        brokerKey: 'delta_exchange',
        accountId: 'acc-1',
        orderId: 'ord-entry-1',
        positionId: 'pos-1',
        positionStatus: 'CLOSED',
        executionState: 'closed',
        protectionState: 'attached',
      },
      [
        {
          externalId: 'pos-1',
          status: 'CLOSED',
          statusRank: 3,
          firstSeenAt: '2026-04-04T10:02:00.000Z',
          lastSeenAt: '2026-04-04T10:06:00.000Z',
          payload: {
            status: 'closed',
            side: 'long',
            created_at: '2026-04-04T10:02:00.000Z',
            closed_at: '2026-04-04T10:06:00.000Z',
          },
        },
      ]
    );

    assert.deepEqual(liveCancelledOrders, [
      {
        orderId: 'live-tp-1',
        context: {
          userId: 'user-1',
          brokerKey: 'delta_exchange',
          accountId: 'acc-1',
        },
      },
    ]);
    assert.match(
      String(nextExecution.note || ''),
      /Sibling protection cancel requested after position close: live-tp-1/
    );
  }

  {
    const mudrexService = new SuggestedTradesService() as any;
    let mudrexLiveListCalled = false;
    let mudrexCancelCalled = false;
    mudrexService.resolveLiveProtectionOrderContext = async () => ({
      stopLossOrderId: null,
      takeProfitOrderId: null,
      stopLossStatus: null,
      takeProfitStatus: null,
      activeOrderIds: [],
    });
    mudrexService.brokerRuntimeRegistry = {
      supportsOrdersAdapter() {
        return true;
      },
      getOrdersAdapter() {
        return {
          async listOpenOrders() {
            mudrexLiveListCalled = true;
            throw new Error('Mudrex should not use the Delta live sibling sweep');
          },
          async cancelOrder() {
            mudrexCancelCalled = true;
            return { success: true };
          },
        };
      },
    };

    await mudrexService.maybeAutoCancelSiblingProtectionOrders(
      'user-1',
      trade,
      {
        executionMode: 'live',
        brokerKey: 'mudrex',
        accountId: 'acc-1',
        orderId: 'mudrex-entry-1',
        positionId: 'mudrex-pos-1',
        positionStatus: 'CLOSED',
        executionState: 'closed',
        protectionState: 'not_required',
      },
      [
        {
          externalId: 'mudrex-pos-1',
          status: 'CLOSED',
          statusRank: 3,
          firstSeenAt: '2026-04-04T10:02:00.000Z',
          lastSeenAt: '2026-04-04T10:06:00.000Z',
          payload: {
            status: 'closed',
            side: 'long',
            created_at: '2026-04-04T10:02:00.000Z',
            closed_at: '2026-04-04T10:06:00.000Z',
          },
        },
      ]
    );

    assert.equal(mudrexLiveListCalled, false);
    assert.equal(mudrexCancelCalled, false);
  }

  {
    const guardedService = new SuggestedTradesService() as any;
    let cancelCalled = false;
    guardedService.resolveLiveProtectionOrderContext = async () => ({
      stopLossOrderId: 'current-sl',
      takeProfitOrderId: 'current-tp',
      stopLossStatus: 'PENDING',
      takeProfitStatus: 'PENDING',
      activeOrderIds: ['current-sl', 'current-tp'],
    });
    guardedService.brokerRuntimeRegistry = {
      supportsOrdersAdapter() {
        return true;
      },
      getOrdersAdapter() {
        return {
          async cancelOrder() {
            cancelCalled = true;
            throw new Error('closed historical execution must not cancel current protection');
          },
        };
      },
    };

    const nextExecution = await guardedService.maybeAutoCancelSiblingProtectionOrders(
      'user-1',
      trade,
      {
        executionMode: 'live',
        brokerKey: 'delta_exchange',
        accountId: 'acc-1',
        orderId: 'old-entry',
        positionId: 'old-closed-position',
        positionStatus: 'CLOSED',
        executionState: 'closed',
        protectionState: 'attached',
      },
      [
        {
          externalId: 'old-closed-position',
          status: 'CLOSED',
          statusRank: 3,
          firstSeenAt: '2026-04-04T10:02:00.000Z',
          lastSeenAt: '2026-04-04T10:06:00.000Z',
          payload: {
            status: 'closed',
            side: 'long',
            created_at: '2026-04-04T10:02:00.000Z',
            closed_at: '2026-04-04T10:06:00.000Z',
          },
        },
        {
          externalId: 'new-open-position',
          status: 'OPEN',
          statusRank: 1,
          firstSeenAt: '2026-04-04T10:30:00.000Z',
          lastSeenAt: '2026-04-04T10:31:00.000Z',
          payload: {
            status: 'open',
            side: 'long',
            created_at: '2026-04-04T10:30:00.000Z',
          },
        },
      ]
    );

    assert.equal(cancelCalled, false);
    assert.equal(nextExecution.protectionState, 'attached');
    assert.equal(nextExecution.note, undefined);
  }

  {
    const staleDeltaService = new SuggestedTradesService() as any;
    let cancelCalled = false;
    staleDeltaService.resolveLiveProtectionOrderContext = async () => ({
      stopLossOrderId: 'current-sl',
      takeProfitOrderId: 'current-tp',
      stopLossStatus: 'PENDING',
      takeProfitStatus: 'PENDING',
      activeOrderIds: ['current-sl', 'current-tp'],
    });
    staleDeltaService.brokerRuntimeRegistry = {
      supportsOrdersAdapter() {
        return true;
      },
      getOrdersAdapter() {
        return {
          async cancelOrder() {
            cancelCalled = true;
            throw new Error('stale closed Delta product row must not cancel current protection');
          },
        };
      },
    };

    const nextExecution = await staleDeltaService.maybeAutoCancelSiblingProtectionOrders(
      'user-1',
      trade,
      {
        executionMode: 'live',
        brokerKey: 'delta_exchange',
        accountId: 'acc-1',
        orderId: 'new-entry',
        orderStatus: 'CLOSED',
        executionState: 'filled',
        filledAt: '2026-04-04T10:30:00.000Z',
        filledQuantity: 90,
        positionId: '78842',
        positionStatus: 'CLOSED',
        positionClosedAt: '2026-04-04T07:49:19.000Z',
        protectionState: 'attached',
      },
      [
        {
          externalId: '78842',
          status: 'CLOSED',
          statusRank: 3,
          firstSeenAt: '2026-04-04T07:47:00.000Z',
          lastSeenAt: '2026-04-04T10:31:00.000Z',
          payload: {
            status: 'closed',
            side: 'long',
            created_at: '2026-04-04T07:47:00.000Z',
            closed_at: '2026-04-04T07:49:19.000Z',
            updated_at: '2026-04-04T07:49:19.000Z',
          },
        },
      ]
    );

    assert.equal(cancelCalled, false);
    assert.equal(nextExecution.protectionState, 'attached');
    assert.equal(nextExecution.positionStatus, 'CLOSED');
  }

  {
    const retryService = new SuggestedTradesService() as any;
    assert.equal(
      retryService.isDeltaReplacementProtectionFailure({
        brokerKey: 'delta_exchange',
        protectionAttempts: 1,
        protectionLastError:
          'Delta Exchange replacement protection is inactive after submission (SL 1 CANCELLED, TP 2 CANCELLED); replacement protection still needs operator review.',
      }),
      true
    );
  }

  {
    const sizeGuardService = new SuggestedTradesService() as any;
    const execution = {
      brokerKey: 'delta_exchange',
      orderId: 'delta-partial-entry',
      quantity: 118,
      filledQuantity: 25,
    };
    const position = {
      payload: {
        quantity_contracts: '25',
      },
    };
    assert.equal(
      sizeGuardService.hasUsableDeltaProtectionContext(
        {
          stopLossOrderId: 'delta-sl-full-size',
          takeProfitOrderId: 'delta-tp-full-size',
          stopLossStatus: 'PENDING',
          takeProfitStatus: 'PENDING',
          activeOrderIds: ['delta-sl-full-size', 'delta-tp-full-size'],
          orderDetails: {
            'delta-sl-full-size': {
              status: 'PENDING',
              quantity: 118,
              filledQuantity: 0,
              remainingQuantity: 118,
            },
            'delta-tp-full-size': {
              status: 'PENDING',
              quantity: 118,
              filledQuantity: 0,
              remainingQuantity: 118,
            },
          },
        },
        execution,
        position
      ),
      false
    );
    assert.equal(
      sizeGuardService.hasUsableDeltaProtectionContext(
        {
          stopLossOrderId: 'delta-sl-current-size',
          takeProfitOrderId: 'delta-tp-current-size',
          stopLossStatus: 'PENDING',
          takeProfitStatus: 'PENDING',
          activeOrderIds: ['delta-sl-current-size', 'delta-tp-current-size'],
          orderDetails: {
            'delta-sl-current-size': {
              status: 'PENDING',
              quantity: 25,
              filledQuantity: 0,
              remainingQuantity: 25,
            },
            'delta-tp-current-size': {
              status: 'PENDING',
              quantity: 25,
              filledQuantity: 0,
              remainingQuantity: 25,
            },
          },
        },
        execution,
        position
      ),
      true
    );
  }
}

async function runSuggestedTradeLimitOrderExpiryAssertions(): Promise<void> {
  const service = new SuggestedTradesService() as any;
  let savedExecutionPayload: Record<string, unknown> | null = null;
  const cancelledOrders: Array<{ orderId: string; context: Record<string, unknown> | undefined }> =
    [];
  const lifecycleEvents: Array<{
    requestId: string;
    query: Record<string, unknown>;
    event: Record<string, unknown>;
  }> = [];

  const trade = {
    id: 'st-limit-expiry',
    automationId: 'auto-1',
    automationRunId: 'run-1',
    userId: 'user-1',
    sourceBacktestId: null,
    sourceTemplateId: null,
    sourceSetupKey: null,
    symbol: 'BTCUSDT',
    timeframe: '5m',
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
    dedupeKey: 'dedupe-limit-expiry',
    meta: {
      execution: {
        executionMode: 'live',
        orderId: 'ord-limit-1',
        brokerKey: 'mudrex',
        accountId: 'acc-1',
        executionState: 'working',
        orderStatus: 'OPEN',
        orderType: 'limit',
        linkedAt: '2026-04-04T10:01:00.000Z',
        submittedAt: '2026-04-04T10:01:00.000Z',
        entryPrice: '100',
        quantity: 1,
        protectionPlan: {
          brokerKey: 'mudrex',
          accountId: 'acc-1',
          orderId: 'ord-limit-1',
          stopLossOrderId: 'mudrex-sl-1',
          takeProfitOrderId: 'mudrex-tp-1',
        },
        note: 'Live limit order linked.',
      },
    },
    createdAt: new Date('2026-04-04T10:00:30.000Z'),
    updatedAt: new Date('2026-04-04T10:02:00.000Z'),
  };

  service.loadTradeSuggestionExecutionPolicy = async () => ({
    limitOrderExpiry: {
      enabled: true,
      expirySeconds: null,
      timeframeExpirySeconds: {
        '5m': 900,
      },
    },
  });
  service.suggestedTradeRepository = {
    async getLinkedOrderSnapshot() {
      return {
        orderStatus: 'OPEN',
        statusRank: 1,
        lastSeenAt: '2026-04-04T10:04:00.000Z',
        payload: {
          created_at: '2026-04-04T10:01:00.000Z',
          updated_at: '2026-04-04T10:04:00.000Z',
        },
      };
    },
    async getLinkedPositionSnapshots() {
      return [];
    },
    async saveSuggestedTrade(item: Record<string, unknown>) {
      return {
        ...item,
        updatedAt: new Date('2026-04-04T10:04:00.000Z'),
      };
    },
    async saveSuggestedTradeExecution(payload: Record<string, unknown>) {
      savedExecutionPayload = { ...payload };
      return {
        ...payload,
        createdAt: new Date('2026-04-04T10:04:00.000Z'),
        updatedAt: new Date('2026-04-04T10:04:00.000Z'),
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
  service.brokerRuntimeRegistry = {
    supportsOrdersAdapter() {
      return true;
    },
    getOrdersAdapter() {
      return {
        async cancelOrder(orderId: string, context?: Record<string, unknown>) {
          cancelledOrders.push({ orderId, context });
          return { success: true };
        },
      };
    },
  };
  service.orderSubmissionRequestRepository = {
    async findLatestBySuggestedTradeAndBrokerOrder(query: Record<string, unknown>) {
      return {
        id: `submission-${String(query.brokerOrderId || '')}`,
        query,
      };
    },
    async recordLifecycleEvent(
      request: { id: string; query: Record<string, unknown> },
      event: Record<string, unknown>
    ) {
      lifecycleEvents.push({ requestId: request.id, query: request.query, event });
      return request;
    },
  };

  const refreshed = await service.refreshExecutionOutcomes('user-1', [trade]);

  assert.equal(refreshed, 1);
  assert.deepEqual(cancelledOrders, [
    {
      orderId: 'ord-limit-1',
      context: {
        userId: 'user-1',
        brokerKey: 'mudrex',
        accountId: 'acc-1',
      },
    },
  ]);
  assert.equal(savedExecutionPayload?.['executionState'], 'expired');
  assert.equal(savedExecutionPayload?.['orderStatus'], 'EXPIRED');
  assert.match(
    String(savedExecutionPayload?.['note'] || ''),
    /Limit entry order expired after 15m for 5m/
  );
  assert.equal(lifecycleEvents.length, 1);
  assert.equal(
    lifecycleEvents[0]?.event.type,
    'live_auto_limit_entry_expiry_cancel_requested'
  );
  assert.equal(lifecycleEvents[0]?.query.brokerOrderId, 'ord-limit-1');

  savedExecutionPayload = null;
  cancelledOrders.length = 0;
  lifecycleEvents.length = 0;

  const deltaLimitTrade = {
    ...trade,
    id: 'st-delta-limit-expiry',
    symbol: 'SPXUSDT',
    side: 'SELL',
    dedupeKey: 'dedupe-delta-limit-expiry',
    executionRecord: null,
    meta: {
      execution: {
        executionMode: 'live',
        orderId: 'delta-entry-1',
        brokerKey: 'delta_exchange',
        accountId: 'acc-1',
        executionState: 'working',
        orderStatus: 'OPEN',
        orderType: 'limit',
        linkedAt: '2026-04-04T10:01:00.000Z',
        submittedAt: '2026-04-04T10:01:00.000Z',
        entryPrice: '100',
        quantity: 1,
        protectionPlan: {
          brokerKey: 'delta_exchange',
          accountId: 'acc-1',
          orderId: 'delta-entry-1',
          stopLossOrderId: 'delta-sl-1',
          takeProfitOrderId: 'delta-tp-1',
        },
        note: 'Delta live limit order linked with native protection.',
      },
    },
  };

  const refreshedDeltaLimitTrade = await service.refreshExecutionOutcomes('user-1', [
    deltaLimitTrade,
  ]);

  assert.equal(refreshedDeltaLimitTrade, 1);
  assert.deepEqual(cancelledOrders, [
    {
      orderId: 'delta-entry-1',
      context: {
        userId: 'user-1',
        brokerKey: 'delta_exchange',
        accountId: 'acc-1',
      },
    },
    {
      orderId: 'delta-sl-1',
      context: {
        userId: 'user-1',
        brokerKey: 'delta_exchange',
        accountId: 'acc-1',
      },
    },
    {
      orderId: 'delta-tp-1',
      context: {
        userId: 'user-1',
        brokerKey: 'delta_exchange',
        accountId: 'acc-1',
      },
    },
  ]);
  assert.equal(savedExecutionPayload?.['executionState'], 'expired');
  assert.equal(savedExecutionPayload?.['orderStatus'], 'EXPIRED');
  assert.match(
    String(savedExecutionPayload?.['note'] || ''),
    /Delta native protection cancel requested after unfilled entry expiry: delta-sl-1, delta-tp-1/
  );
  assert.deepEqual(
    (savedExecutionPayload?.['protectionPlan'] as Record<string, unknown>)
      ?.siblingProtectionCancelledOrderIds,
    ['delta-sl-1', 'delta-tp-1']
  );
  assert.equal(lifecycleEvents.length, 1);
  assert.equal(
    lifecycleEvents[0]?.event.type,
    'live_auto_limit_entry_expiry_cancel_requested'
  );
  assert.equal(lifecycleEvents[0]?.requestId, 'submission-delta-entry-1');
  assert.deepEqual(
    (lifecycleEvents[0]?.event.details as Record<string, unknown>)
      ?.siblingProtectionCancelOrderIds,
    ['delta-sl-1', 'delta-tp-1']
  );
  assert.deepEqual(
    (lifecycleEvents[0]?.event.details as Record<string, unknown>)
      ?.siblingProtectionCancelledOrderIds,
    ['delta-sl-1', 'delta-tp-1']
  );

  savedExecutionPayload = null;
  cancelledOrders.length = 0;
  lifecycleEvents.length = 0;

  const terminalDeltaLimitTrade = {
    ...trade,
    id: 'st-delta-terminal-limit-cleanup',
    symbol: 'SPXUSDT',
    side: 'SELL',
    dedupeKey: 'dedupe-delta-terminal-limit-cleanup',
    executionRecord: null,
    meta: {
      execution: {
        executionMode: 'live',
        orderId: 'delta-entry-terminal',
        brokerKey: 'delta_exchange',
        accountId: 'acc-1',
        executionState: 'expired',
        orderStatus: 'CANCELLED',
        orderType: 'limit',
        linkedAt: '2026-04-04T10:01:00.000Z',
        submittedAt: '2026-04-04T10:01:00.000Z',
        entryPrice: '100',
        quantity: 1,
        filledQuantity: 0,
        remainingQuantity: 0,
        protectionPlan: {
          brokerKey: 'delta_exchange',
          accountId: 'acc-1',
          orderId: 'delta-entry-terminal',
          stopLossOrderId: 'delta-terminal-sl-1',
          takeProfitOrderId: 'delta-terminal-tp-1',
        },
        note: 'Delta entry was already terminal before reconciliation.',
      },
    },
  };
  service.suggestedTradeRepository = {
    ...service.suggestedTradeRepository,
    async getLinkedOrderSnapshot() {
      return {
        orderStatus: 'CANCELLED',
        statusRank: 4,
        lastSeenAt: '2026-04-04T10:20:00.000Z',
        payload: {
          created_at: '2026-04-04T10:01:00.000Z',
          updated_at: '2026-04-04T10:20:00.000Z',
          filled_quantity: 0,
        },
      };
    },
    async getLinkedPositionSnapshots() {
      return [];
    },
  };

  const refreshedTerminalDeltaLimitTrade = await service.refreshExecutionOutcomes('user-1', [
    terminalDeltaLimitTrade,
  ]);

  assert.equal(refreshedTerminalDeltaLimitTrade, 1);
  assert.deepEqual(cancelledOrders, [
    {
      orderId: 'delta-terminal-sl-1',
      context: {
        userId: 'user-1',
        brokerKey: 'delta_exchange',
        accountId: 'acc-1',
      },
    },
    {
      orderId: 'delta-terminal-tp-1',
      context: {
        userId: 'user-1',
        brokerKey: 'delta_exchange',
        accountId: 'acc-1',
      },
    },
  ]);
  assert.match(
    String(savedExecutionPayload?.['note'] || ''),
    /Delta native protection cancel requested after unfilled entry expiry: delta-terminal-sl-1, delta-terminal-tp-1/
  );

  savedExecutionPayload = null;
  cancelledOrders.length = 0;

  const activeLinkedAt = new Date().toISOString();
  const activeOpenOrderTrade = {
    id: 'st-limit-active-stale-position',
    automationId: 'auto-1',
    automationRunId: 'run-1',
    userId: 'user-1',
    sourceBacktestId: null,
    sourceTemplateId: null,
    sourceSetupKey: null,
    symbol: 'BTCUSDT',
    timeframe: '5m',
    side: 'BUY',
    signalTime: new Date(activeLinkedAt),
    status: 'Accepted',
    confidence: 0.88,
    score: 90,
    entryPrice: '100',
    stopLossPrice: '95',
    takeProfitTargets: ['108'],
    entryRule: 'breakout',
    exitRule: 'trail',
    rationale: 'Momentum continuation',
    dedupeKey: 'dedupe-limit-active-stale-position',
    meta: {
      execution: {
        executionMode: 'live',
        orderId: 'ord-limit-active-stale-position',
        brokerKey: 'mudrex',
        accountId: 'acc-1',
        executionState: 'closed',
        orderStatus: 'OPEN',
        orderType: 'limit',
        linkedAt: activeLinkedAt,
        submittedAt: activeLinkedAt,
        entryPrice: '100',
        quantity: 1,
        filledQuantity: 0,
        positionId: 'older-active-closed-position',
        positionStatus: 'CLOSED',
        positionOpenedAt: '2026-04-04T08:00:00.000Z',
        positionClosedAt: '2026-04-04T08:15:00.000Z',
        exitPrice: '99',
        realizedPnl: '-1',
        outcome: 'loss',
        note: 'Open limit order carried stale closed position metadata.',
      },
    },
    createdAt: new Date(activeLinkedAt),
    updatedAt: new Date(activeLinkedAt),
  };

  service.suggestedTradeRepository = {
    async getLinkedOrderSnapshot() {
      return {
        orderStatus: 'OPEN',
        statusRank: 1,
        lastSeenAt: activeLinkedAt,
        payload: {
          created_at: activeLinkedAt,
          updated_at: activeLinkedAt,
          filled_quantity: 0,
        },
      };
    },
    async getLinkedPositionSnapshots() {
      return [
        {
          externalId: 'older-active-closed-position',
          status: 'CLOSED',
          statusRank: 3,
          firstSeenAt: '2026-04-04T08:00:00.000Z',
          lastSeenAt: '2026-04-04T08:15:00.000Z',
          payload: {
            status: 'closed',
            side: 'long',
            created_at: '2026-04-04T08:00:00.000Z',
            closed_at: '2026-04-04T08:15:00.000Z',
            entry_price: 100,
            quantity: 1,
          },
        },
      ];
    },
    async saveSuggestedTrade(item: Record<string, unknown>) {
      return {
        ...item,
        updatedAt: new Date(activeLinkedAt),
      };
    },
    async saveSuggestedTradeExecution(payload: Record<string, unknown>) {
      savedExecutionPayload = { ...payload };
      return {
        ...payload,
        createdAt: new Date(activeLinkedAt),
        updatedAt: new Date(activeLinkedAt),
      };
    },
  };

  const refreshedActiveOpenOrderTrade = await service.refreshExecutionOutcomes('user-1', [
    activeOpenOrderTrade,
  ]);

  assert.equal(refreshedActiveOpenOrderTrade, 1);
  assert.deepEqual(cancelledOrders, []);
  assert.equal(savedExecutionPayload?.['executionState'], 'working');
  assert.equal(savedExecutionPayload?.['orderStatus'], 'OPEN');
  assert.equal(savedExecutionPayload?.['positionId'], null);
  assert.equal(savedExecutionPayload?.['positionStatus'], null);
  assert.equal(savedExecutionPayload?.['positionOpenedAt'], null);
  assert.equal(savedExecutionPayload?.['positionClosedAt'], null);
  assert.equal(savedExecutionPayload?.['outcome'], null);

  savedExecutionPayload = null;
  cancelledOrders.length = 0;

  const staleClosedPositionTrade = {
    id: 'st-limit-expiry-stale-position',
    automationId: 'auto-1',
    automationRunId: 'run-1',
    userId: 'user-1',
    sourceBacktestId: null,
    sourceTemplateId: null,
    sourceSetupKey: null,
    symbol: 'BTCUSDT',
    timeframe: '5m',
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
    dedupeKey: 'dedupe-limit-expiry-stale-position',
    meta: {
      execution: {
        executionMode: 'live',
        orderId: 'ord-limit-stale-position',
        brokerKey: 'mudrex',
        accountId: 'acc-1',
        executionState: 'closed',
        orderStatus: 'OPEN',
        orderType: 'limit',
        linkedAt: '2026-04-04T10:01:00.000Z',
        submittedAt: '2026-04-04T10:01:00.000Z',
        entryPrice: '100',
        quantity: 1,
        filledQuantity: 0,
        positionId: 'older-closed-position',
        positionStatus: 'CLOSED',
        positionOpenedAt: '2026-04-04T08:00:00.000Z',
        positionClosedAt: '2026-04-04T08:15:00.000Z',
        exitPrice: '99',
        realizedPnl: '-1',
        outcome: 'loss',
        note: 'Open limit order was incorrectly linked to an older closed position.',
      },
    },
    createdAt: new Date('2026-04-04T10:00:30.000Z'),
    updatedAt: new Date('2026-04-04T10:02:00.000Z'),
  };

  service.suggestedTradeRepository = {
    async getLinkedOrderSnapshot() {
      return {
        orderStatus: 'OPEN',
        statusRank: 1,
        lastSeenAt: '2026-04-04T10:20:00.000Z',
        payload: {
          created_at: '2026-04-04T10:01:00.000Z',
          updated_at: '2026-04-04T10:20:00.000Z',
          filled_quantity: 0,
        },
      };
    },
    async getLinkedPositionSnapshots() {
      return [
        {
          externalId: 'older-closed-position',
          status: 'CLOSED',
          statusRank: 3,
          firstSeenAt: '2026-04-04T08:00:00.000Z',
          lastSeenAt: '2026-04-04T08:15:00.000Z',
          payload: {
            status: 'closed',
            side: 'long',
            created_at: '2026-04-04T08:00:00.000Z',
            closed_at: '2026-04-04T08:15:00.000Z',
            entry_price: 100,
            quantity: 1,
          },
        },
      ];
    },
    async saveSuggestedTrade(item: Record<string, unknown>) {
      return {
        ...item,
        updatedAt: new Date('2026-04-04T10:20:00.000Z'),
      };
    },
    async saveSuggestedTradeExecution(payload: Record<string, unknown>) {
      savedExecutionPayload = { ...payload };
      return {
        ...payload,
        createdAt: new Date('2026-04-04T10:20:00.000Z'),
        updatedAt: new Date('2026-04-04T10:20:00.000Z'),
      };
    },
  };

  const refreshedStalePositionTrade = await service.refreshExecutionOutcomes('user-1', [
    staleClosedPositionTrade,
  ]);

  assert.equal(refreshedStalePositionTrade, 1);
  assert.deepEqual(cancelledOrders, [
    {
      orderId: 'ord-limit-stale-position',
      context: {
        userId: 'user-1',
        brokerKey: 'mudrex',
        accountId: 'acc-1',
      },
    },
  ]);
  assert.equal(savedExecutionPayload?.['executionState'], 'expired');
  assert.equal(savedExecutionPayload?.['orderStatus'], 'EXPIRED');
  assert.equal(savedExecutionPayload?.['positionId'], null);
  assert.equal(savedExecutionPayload?.['positionStatus'], null);
  assert.equal(savedExecutionPayload?.['positionOpenedAt'], null);
  assert.equal(savedExecutionPayload?.['positionClosedAt'], null);

  savedExecutionPayload = null;
  cancelledOrders.length = 0;

  const partialFillRemainderTrade = {
    ...staleClosedPositionTrade,
    id: 'st-limit-expiry-partial-fill-remainder',
    dedupeKey: 'dedupe-limit-expiry-partial-fill-remainder',
    executionRecord: null,
    meta: {
      execution: {
        executionMode: 'live',
        orderId: 'ord-limit-partial-fill-remainder',
        brokerKey: 'mudrex',
        accountId: 'acc-1',
        executionState: 'filled',
        orderStatus: 'PARTIAL_FILLED',
        orderType: 'limit',
        linkedAt: '2026-04-04T10:01:00.000Z',
        submittedAt: '2026-04-04T10:01:00.000Z',
        filledAt: '2026-04-04T10:04:00.000Z',
        entryPrice: '100',
        quantity: 3237,
        filledQuantity: 300,
        remainingQuantity: 2937,
        positionId: 'partial-fill-position',
        positionStatus: 'OPEN',
        positionOpenedAt: '2026-04-04T10:04:00.000Z',
        protectionState: 'attached',
        note: 'Mudrex partial fill created a protected position while the entry remainder stayed open.',
      },
    },
  };

  service.suggestedTradeRepository = {
    async getLinkedOrderSnapshot() {
      return {
        orderStatus: 'PARTIAL_FILLED',
        statusRank: 2,
        lastSeenAt: '2026-04-04T10:20:00.000Z',
        payload: {
          created_at: '2026-04-04T10:01:00.000Z',
          updated_at: '2026-04-04T10:20:00.000Z',
          filled_quantity: 300,
          remaining_quantity: 2937,
        },
      };
    },
    async getLinkedPositionSnapshots() {
      return [
        {
          externalId: 'partial-fill-position',
          status: 'OPEN',
          statusRank: 1,
          firstSeenAt: '2026-04-04T10:04:00.000Z',
          lastSeenAt: '2026-04-04T10:20:00.000Z',
          payload: {
            status: 'open',
            side: 'long',
            created_at: '2026-04-04T10:04:00.000Z',
            entry_price: 100,
            quantity: 300,
          },
        },
      ];
    },
    async saveSuggestedTrade(item: Record<string, unknown>) {
      return {
        ...item,
        updatedAt: new Date('2026-04-04T10:20:00.000Z'),
      };
    },
    async saveSuggestedTradeExecution(payload: Record<string, unknown>) {
      savedExecutionPayload = { ...payload };
      return {
        ...payload,
        createdAt: new Date('2026-04-04T10:20:00.000Z'),
        updatedAt: new Date('2026-04-04T10:20:00.000Z'),
      };
    },
  };

  const refreshedPartialFillRemainderTrade = await service.refreshExecutionOutcomes('user-1', [
    partialFillRemainderTrade,
  ]);

  assert.equal(refreshedPartialFillRemainderTrade, 1);
  assert.deepEqual(cancelledOrders, [
    {
      orderId: 'ord-limit-partial-fill-remainder',
      context: {
        userId: 'user-1',
        brokerKey: 'mudrex',
        accountId: 'acc-1',
      },
    },
  ]);
  assert.equal(savedExecutionPayload?.['executionState'], 'filled');
  assert.equal(savedExecutionPayload?.['orderStatus'], 'PARTIALLY_FILLED');
  assert.equal(savedExecutionPayload?.['remainingQuantity'], 0);
  assert.equal(savedExecutionPayload?.['positionId'], 'partial-fill-position');
  assert.equal(savedExecutionPayload?.['positionStatus'], 'OPEN');
  assert.match(
    String(savedExecutionPayload?.['note'] || ''),
    /Partially filled limit entry order exceeded 15m for 5m/
  );

  const firstPartialFillPayload: Record<string, unknown> = {
    ...((savedExecutionPayload as Record<string, unknown> | null) ?? {}),
  };
  const partialFillExecution: Record<string, unknown> = {
    ...firstPartialFillPayload,
    orderStatus: 'PARTIALLY_FILLED',
    remainingQuantity: 0,
    canceledAt: '2026-04-04T10:20:00.000Z',
  };
  savedExecutionPayload = null;
  cancelledOrders.length = 0;
  const clearedPartialFillRemainderTrade = {
    ...partialFillRemainderTrade,
    id: 'st-limit-expiry-partial-fill-remainder-cleared',
    dedupeKey: 'dedupe-limit-expiry-partial-fill-remainder-cleared',
    executionRecord: null,
    meta: {
      execution: partialFillExecution,
    },
  };
  const partialFillRepository = service.suggestedTradeRepository;
  service.suggestedTradeRepository = {
    ...partialFillRepository,
    async getLinkedOrderSnapshot() {
      return {
        orderStatus: 'PARTIAL_FILLED',
        statusRank: 2,
        lastSeenAt: '2026-04-04T10:30:00.000Z',
        payload: {
          created_at: '2026-04-04T10:01:00.000Z',
          updated_at: '2026-04-04T10:30:00.000Z',
          filled_quantity: 300,
          remaining_quantity: 2937,
        },
      };
    },
  };

  const refreshedClearedPartialFillRemainderTrade = await service.refreshExecutionOutcomes(
    'user-1',
    [clearedPartialFillRemainderTrade]
  );

  assert.ok([0, 1].includes(refreshedClearedPartialFillRemainderTrade));
  assert.deepEqual(cancelledOrders, []);
  const clearedPayload = savedExecutionPayload ?? partialFillExecution;
  assert.equal(clearedPayload['remainingQuantity'], 0);
  assert.equal(clearedPayload['canceledAt'], '2026-04-04T10:20:00.000Z');
  assert.equal(
    (
      String(clearedPayload['note'] || '').match(/Partially filled limit entry order exceeded/g) ||
      []
    ).length,
    1
  );

  savedExecutionPayload = null;
  cancelledOrders.length = 0;
  lifecycleEvents.length = 0;
  const deltaPartialCancelledOrders: Array<{
    orderId: string;
    context: Record<string, unknown> | undefined;
  }> = [];
  const deltaPartialReplacementOrders: Array<{
    assetId: string;
    body: Record<string, unknown>;
    context: Record<string, unknown> | undefined;
  }> = [];
  const deltaPartialFillTrade = {
    ...staleClosedPositionTrade,
    id: 'st-delta-limit-expiry-partial-fill-replacement',
    symbol: 'BTCUSDT',
    side: 'BUY',
    dedupeKey: 'dedupe-delta-limit-expiry-partial-fill-replacement',
    executionRecord: null,
    meta: {
      execution: {
        executionMode: 'live',
        orderId: 'delta-partial-entry-remainder',
        brokerKey: 'delta_exchange',
        accountId: 'acc-1',
        executionState: 'filled',
        orderStatus: 'PARTIAL_FILLED',
        orderType: 'limit',
        linkedAt: '2026-04-04T10:01:00.000Z',
        submittedAt: '2026-04-04T10:01:00.000Z',
        filledAt: '2026-04-04T10:04:00.000Z',
        entryPrice: '100',
        stopLossPrice: '95',
        takeProfitPrice: '108',
        quantity: 118,
        filledQuantity: 25,
        remainingQuantity: 93,
        positionId: 'delta-partial-position',
        positionStatus: 'OPEN',
        positionOpenedAt: '2026-04-04T10:04:00.000Z',
        protectionState: 'attached',
        protectionPlan: {
          brokerKey: 'delta_exchange',
          accountId: 'acc-1',
          orderId: 'delta-partial-entry-remainder',
          stopLossOrderId: 'delta-old-sl',
          takeProfitOrderId: 'delta-old-tp',
        },
        note: 'Delta partial fill has full-size native protection before remainder cancel.',
      },
    },
  };

  service.suggestedTradeRepository = {
    async getLinkedOrderSnapshot() {
      return {
        orderStatus: 'PARTIAL_FILLED',
        statusRank: 2,
        lastSeenAt: '2026-04-04T10:20:00.000Z',
        payload: {
          created_at: '2026-04-04T10:01:00.000Z',
          updated_at: '2026-04-04T10:20:00.000Z',
          filled_quantity: 25,
          remaining_quantity: 93,
        },
      };
    },
    async getLinkedPositionSnapshots() {
      return [
        {
          externalId: 'delta-partial-position',
          status: 'OPEN',
          statusRank: 1,
          firstSeenAt: '2026-04-04T10:04:00.000Z',
          lastSeenAt: '2026-04-04T10:20:00.000Z',
          payload: {
            status: 'open',
            side: 'long',
            product_symbol: 'BTCUSD',
            created_at: '2026-04-04T10:04:00.000Z',
            entry_price: 100,
            mark_price: 100,
            quantity_contracts: 25,
          },
        },
      ];
    },
    async saveSuggestedTrade(item: Record<string, unknown>) {
      return {
        ...item,
        updatedAt: new Date('2026-04-04T10:20:00.000Z'),
      };
    },
    async saveSuggestedTradeExecution(payload: Record<string, unknown>) {
      savedExecutionPayload = { ...payload };
      return {
        ...payload,
        createdAt: new Date('2026-04-04T10:20:00.000Z'),
        updatedAt: new Date('2026-04-04T10:20:00.000Z'),
      };
    },
  };
  service.resolveLiveProtectionOrderContext = async () => ({
    stopLossOrderId: 'delta-old-sl',
    takeProfitOrderId: 'delta-old-tp',
    stopLossStatus: 'PENDING',
    takeProfitStatus: 'PENDING',
    activeOrderIds: ['delta-old-sl', 'delta-old-tp'],
    orderDetails: {
      'delta-old-sl': {
        status: 'PENDING',
        quantity: 118,
        filledQuantity: 0,
        remainingQuantity: 118,
      },
      'delta-old-tp': {
        status: 'PENDING',
        quantity: 118,
        filledQuantity: 0,
        remainingQuantity: 118,
      },
    },
  });
  service.resolveLiveAutoAssetRoute = async () => ({
    assetId: 'delta-btc-asset',
    requestedSymbol: 'BTCUSDT',
    brokerSymbol: 'BTCUSD',
    candidateSymbols: ['BTCUSDT', 'BTCUSD'],
    resolvedVia: 'catalog_equivalent',
  });
  service.resolveActiveDeltaProtectionOrdersForSymbol = async () => ({
    stopLossOrderIds: ['delta-old-sl'],
    takeProfitOrderIds: ['delta-old-tp'],
    unclassifiedOrderIds: [],
    activeOrderIds: ['delta-old-sl', 'delta-old-tp'],
    orderDetails: {
      'delta-old-sl': { status: 'PENDING', quantity: 118 },
      'delta-old-tp': { status: 'PENDING', quantity: 118 },
    },
  });
  service.brokerRuntimeRegistry = {
    supportsOrdersAdapter() {
      return true;
    },
    getOrdersAdapter() {
      return {
        async cancelOrder(orderId: string, context?: Record<string, unknown>) {
          deltaPartialCancelledOrders.push({ orderId, context });
          return { success: true };
        },
        async createLiveAutoProtectiveOrdersForPosition(
          assetId: string,
          body: Record<string, unknown>,
          context?: Record<string, unknown>
        ) {
          deltaPartialReplacementOrders.push({ assetId, body, context });
          return {
            stop_loss_order_id: 'delta-new-sl',
            take_profit_order_id: 'delta-new-tp',
          };
        },
      };
    },
  };

  const refreshedDeltaPartialFillTrade = await service.refreshExecutionOutcomes('user-1', [
    deltaPartialFillTrade,
  ]);

  assert.equal(refreshedDeltaPartialFillTrade, 1);
  assert.deepEqual(
    deltaPartialCancelledOrders.map((item) => item.orderId),
    ['delta-partial-entry-remainder', 'delta-old-sl', 'delta-old-tp']
  );
  assert.equal(deltaPartialReplacementOrders.length, 1);
  assert.equal(deltaPartialReplacementOrders[0]?.body.size, 25);
  assert.equal(savedExecutionPayload?.['executionState'], 'working');
  assert.equal(savedExecutionPayload?.['orderStatus'], 'PARTIALLY_FILLED');
  assert.equal(savedExecutionPayload?.['remainingQuantity'], 0);
  assert.equal(savedExecutionPayload?.['positionId'], 'delta-partial-position');
  assert.equal(savedExecutionPayload?.['protectionState'], 'attaching');
  assert.equal(
    (savedExecutionPayload?.['protectionPlan'] as Record<string, unknown>)?.stopLossOrderId,
    'delta-new-sl'
  );
  assert.deepEqual(
    (savedExecutionPayload?.['protectionPlan'] as Record<string, unknown>)
      ?.replacedProtectionCancelledOrderIds,
    ['delta-old-sl', 'delta-old-tp']
  );
  assert.equal(
    lifecycleEvents[lifecycleEvents.length - 1]?.event.type,
    'live_auto_limit_entry_remainder_cancel_requested'
  );
  assert.equal(
    (lifecycleEvents[lifecycleEvents.length - 1]?.event.details as Record<string, unknown>)
      ?.partialFill,
    true
  );

  service.resolveLiveProtectionOrderContext = undefined;
  service.resolveLiveAutoAssetRoute = undefined;
  service.resolveActiveDeltaProtectionOrdersForSymbol = undefined;
  savedExecutionPayload = null;
  cancelledOrders.length = 0;
  lifecycleEvents.length = 0;

  const terminalCancelTrade = {
    ...staleClosedPositionTrade,
    id: 'st-limit-expiry-terminal-cancel',
    dedupeKey: 'dedupe-limit-expiry-terminal-cancel',
    executionRecord: null,
    meta: {
      execution: {
        executionMode: 'live',
        orderId: 'ord-limit-terminal-cancel',
        brokerKey: 'mudrex',
        accountId: 'acc-1',
        executionState: 'closed',
        orderStatus: 'OPEN',
        orderType: 'limit',
        linkedAt: '2026-04-04T10:01:00.000Z',
        submittedAt: '2026-04-04T10:01:00.000Z',
        entryPrice: '100',
        quantity: 1,
        filledQuantity: 0,
        positionId: 'older-closed-position',
        positionStatus: 'CLOSED',
        positionOpenedAt: '2026-04-04T08:00:00.000Z',
        positionClosedAt: '2026-04-04T08:15:00.000Z',
        exitPrice: '99',
        realizedPnl: '-1',
        outcome: 'loss',
        note: 'Broker cancel should be idempotent when the broker already considers it terminal.',
      },
    },
  };

  service.suggestedTradeRepository = {
    async getLinkedOrderSnapshot() {
      return {
        orderStatus: 'OPEN',
        statusRank: 1,
        lastSeenAt: '2026-04-04T10:20:00.000Z',
        payload: {
          created_at: '2026-04-04T10:01:00.000Z',
          updated_at: '2026-04-04T10:20:00.000Z',
          filled_quantity: 0,
        },
      };
    },
    async getLinkedPositionSnapshots() {
      return [
        {
          externalId: 'older-closed-position',
          status: 'CLOSED',
          statusRank: 3,
          firstSeenAt: '2026-04-04T08:00:00.000Z',
          lastSeenAt: '2026-04-04T08:15:00.000Z',
          payload: {
            status: 'closed',
            side: 'long',
            created_at: '2026-04-04T08:00:00.000Z',
            closed_at: '2026-04-04T08:15:00.000Z',
            entry_price: 100,
            quantity: 1,
          },
        },
      ];
    },
    async saveSuggestedTrade(item: Record<string, unknown>) {
      return {
        ...item,
        updatedAt: new Date('2026-04-04T10:20:00.000Z'),
      };
    },
    async saveSuggestedTradeExecution(payload: Record<string, unknown>) {
      savedExecutionPayload = { ...payload };
      return {
        ...payload,
        createdAt: new Date('2026-04-04T10:20:00.000Z'),
        updatedAt: new Date('2026-04-04T10:20:00.000Z'),
      };
    },
  };

  service.brokerRuntimeRegistry = {
    supportsOrdersAdapter() {
      return true;
    },
    getOrdersAdapter() {
      return {
        async cancelOrder() {
          throw new Error('order not found or too late to cancel');
        },
      };
    },
  };

  const refreshedTerminalCancelTrade = await service.refreshExecutionOutcomes('user-1', [
    terminalCancelTrade,
  ]);

  assert.equal(refreshedTerminalCancelTrade, 1);
  assert.deepEqual(cancelledOrders, []);
  assert.equal(savedExecutionPayload?.['executionState'], 'expired');
  assert.equal(savedExecutionPayload?.['orderStatus'], 'EXPIRED');
  assert.equal(savedExecutionPayload?.['positionId'], null);
  assert.match(
    String(savedExecutionPayload?.['note'] || ''),
    /Broker reported order already terminal during expiry cancel/
  );
}

async function runSuggestedTradeBrokerLiveAutoSizingHandlerAssertions(): Promise<void> {
  {
    const calls: Array<{ assetId: string; symbol: string; side: string }> = [];
    const sized = await normalizeDeltaLiveAutoOrderSizing({
      assetId: 'delta-btc',
      brokerSymbol: 'BTCUSD',
      quantity: 0.002,
      entryPrice: 100,
      stopLossPrice: 105,
      takeProfitPrice: 90,
      side: 'short',
      adapter: {
        async preflightLiveAutoOrder(assetId, body) {
          calls.push({
            assetId,
            symbol: String(body.symbol || ''),
            side: body.side,
          });
          return {
            quantityContracts: 2,
          };
        },
      },
    });

    assert.deepEqual(calls, [{ assetId: 'delta-btc', symbol: 'BTCUSD', side: 'short' }]);
    assert.equal(sized.quantity, 0.002);
    assert.equal(sized.entryPrice, 100);
    assert.match(String(sized.auditNote), /2 contracts/);

    await assert.rejects(
      () =>
        normalizeDeltaLiveAutoOrderSizing({
          assetId: 'delta-btc',
          brokerSymbol: 'BTCUSD',
          quantity: 0.002,
          entryPrice: 100,
          stopLossPrice: 105,
          takeProfitPrice: 90,
          side: 'short',
          adapter: null,
        }),
      /Delta Exchange product-rule preflight is unavailable/
    );
  }

  {
    const assetDetail = {
      quantity_step: '10',
      min_contract: '10',
      max_contract: '330000',
      max_market_contract: '330000',
      min_notional_value: '5',
      price_step: '0.000001',
      min_price: '0.000001',
      max_price: '1000000',
      min_leverage: '1',
      max_leverage: '5',
    };

    const sized = normalizeMudrexLiveAutoOrderSizing({
      brokerSymbol: 'PUMPBTCUSDT',
      quantity: 11375,
      entryPrice: 0.0158804,
      stopLossPrice: 0.0170004,
      takeProfitPrice: 0.0150004,
      side: 'short',
      orderType: 'limit',
      leverage: 5,
      assetDetail,
    });

    assert.equal(sized.quantity, 11370);
    assert.equal(sized.entryPrice, 0.015881);
    assert.equal(sized.stopLossPrice, 0.017001);
    assert.equal(sized.takeProfitPrice, 0.015);
    assert.match(String(sized.auditNote), /Normalized Mudrex quantity/);
    assert.match(String(sized.auditNote), /Normalized Mudrex prices/);

    assert.throws(
      () =>
        normalizeMudrexLiveAutoOrderSizing({
          brokerSymbol: 'PUMPBTCUSDT',
          quantity: 11370,
          entryPrice: 0.01588,
          stopLossPrice: 0.015,
          takeProfitPrice: 0.017,
          side: 'short',
          orderType: 'limit',
          leverage: 15,
          assetDetail,
        }),
      /Mudrex requested leverage 15x exceeds the broker maximum leverage 5x for PUMPBTCUSDT/
    );
  }
}

async function runSuggestedTradeBrokerLiveAutoProtectionAttachHandlerAssertions(): Promise<void> {
  const riskOrders: Array<{
    positionId: string;
    body: Record<string, unknown>;
    context: Record<string, unknown> | undefined;
  }> = [];
  const positionQueries: Array<{
    query: Record<string, unknown>;
    context: Record<string, unknown> | undefined;
  }> = [];

  const result = await attachMudrexLiveAutoProtectionIfNeeded({
    userId: 'user-1',
    brokerKey: 'mudrex',
    accountId: 'acc-1',
    brokerSymbol: 'BTCUSDT',
    side: 'buy',
    orderId: 'mudrex-live-order-1',
    requestedEntryPrice: 100,
    requestedStopLossPrice: 95,
    requestedTakeProfitPrice: 110,
    waitForPoll: async () => undefined,
    positionsAdapter: {
      async getPositions(query, context) {
        positionQueries.push({ query, context });
        return {
          data: {
            positions: [
              {
                id: 'closed-position',
                symbol: 'BTCUSDT',
                side: 'Long',
                status: 'closed',
                entry_price: '99',
                updated_at: '2026-05-10T00:00:00.000Z',
              },
              {
                id: 'wrong-side-position',
                symbol: 'BTCUSDT',
                side: 'Short',
                status: 'open',
                entry_price: '101',
                updated_at: '2026-05-10T00:01:00.000Z',
              },
              {
                id: 'mudrex-live-position-1',
                symbol: 'BTCUSDT',
                side: 'Long',
                status: 'open',
                entry_price: '102',
                updated_at: '2026-05-10T00:02:00.000Z',
              },
            ],
          },
        };
      },
      async createRiskOrder(positionId, body, context) {
        riskOrders.push({ positionId, body, context });
        return { success: true };
      },
    },
  });

  assert.equal(result.attached, true);
  assert.match(String(result.note), /Derived Mudrex SL\/TP attached/);
  assert.equal(positionQueries.length, 1);
  assert.equal(positionQueries[0]?.context?.brokerKey, 'mudrex');
  assert.equal(riskOrders.length, 1);
  assert.equal(riskOrders[0]?.positionId, 'mudrex-live-position-1');
  assert.equal(riskOrders[0]?.body.stoploss_price, '96.900000');
  assert.equal(riskOrders[0]?.body.takeprofit_price, '112.200000');
  assert.equal(riskOrders[0]?.context?.accountId, 'acc-1');

  class ClassBackedMudrexPositionsAdapter {
    public readonly positionCalls: Array<Record<string, unknown>> = [];
    public readonly riskOrderCalls: Array<Record<string, unknown>> = [];

    async getPositions(query: Record<string, unknown>, context?: Record<string, unknown>) {
      this.positionCalls.push({ query, context });
      return {
        data: {
          positions: [
            {
              id: 'class-backed-position-1',
              symbol: 'ETHUSDT',
              side: 'Long',
              status: 'open',
              entry_price: '202',
              updated_at: '2026-05-10T00:02:00.000Z',
            },
          ],
        },
      };
    }

    async createRiskOrder(
      positionId: string,
      body: Record<string, unknown>,
      context?: Record<string, unknown>
    ) {
      this.riskOrderCalls.push({ positionId, body, context });
      return { success: true };
    }
  }

  const classBackedAdapter = new ClassBackedMudrexPositionsAdapter();
  const classBackedResult = await attachMudrexLiveAutoProtectionIfNeeded({
    userId: 'user-1',
    brokerKey: 'mudrex',
    accountId: 'acc-1',
    brokerSymbol: 'ETHUSDT',
    side: 'buy',
    orderId: 'mudrex-live-order-2',
    requestedEntryPrice: 200,
    requestedStopLossPrice: 190,
    requestedTakeProfitPrice: 220,
    waitForPoll: async () => undefined,
    positionsAdapter: classBackedAdapter,
  });

  assert.equal(classBackedResult.attached, true);
  assert.equal(classBackedAdapter.positionCalls.length, 1);
  assert.equal(classBackedAdapter.riskOrderCalls.length, 1);
  assert.equal(classBackedAdapter.riskOrderCalls[0]?.positionId, 'class-backed-position-1');

  const closedPositions: Array<{ positionId: string; context?: Record<string, unknown> }> = [];
  const crossedTargetResult = await attachMudrexLiveAutoProtectionIfNeeded({
    userId: 'user-1',
    brokerKey: 'mudrex',
    accountId: 'acc-1',
    brokerSymbol: 'JSTUSDT',
    side: 'buy',
    orderId: 'mudrex-live-order-crossed-target',
    requestedEntryPrice: 0.08836,
    requestedStopLossPrice: 0.08831,
    requestedTakeProfitPrice: 0.08859,
    waitForPoll: async () => undefined,
    positionsAdapter: {
      async getPositions() {
        return [
          {
            id: 'mudrex-live-position-crossed-target',
            symbol: 'JSTUSDT',
            side: 'Long',
            status: 'open',
            entry_price: '0.08836',
            current_price: '0.08871',
            updated_at: '2026-05-12T04:18:51.000Z',
          },
        ];
      },
      async createRiskOrder() {
        throw new Error('risk order must not be created after target is crossed');
      },
      async closePosition(positionId, context) {
        closedPositions.push({ positionId, context });
        return { success: true };
      },
    },
  });

  assert.equal(crossedTargetResult.attached, false);
  assert.equal(crossedTargetResult.closedPosition, true);
  assert.match(String(crossedTargetResult.note || ''), /take-profit 0.088590 is already crossed/);
  assert.equal(closedPositions.length, 1);
  assert.equal(closedPositions[0]?.positionId, 'mudrex-live-position-crossed-target');
  assert.equal(closedPositions[0]?.context?.accountId, 'acc-1');
}

async function runSuggestedTradeBrokerProtectionRepairHandlerAssertions(): Promise<void> {
  {
    const riskOrders: Array<{
      positionId: string;
      body: Record<string, unknown>;
      context: Record<string, unknown> | undefined;
    }> = [];

    const nextExecution = await remediateMudrexLiveProtection({
      userId: 'user-1',
      trade: {
        symbol: 'BTCUSDT',
        side: 'BUY',
        timeframe: '5m',
      },
      execution: {
        orderId: 'mudrex-order-1',
        entryPrice: '100',
        protectionAttempts: 0,
      } as any,
      position: {
        externalId: 'mudrex-snapshot-position-1',
        payload: {
          id: 'mudrex-native-position-1',
          side: 'Long',
          entry_price: '102',
          current_price: '102',
        },
      },
      prices: {
        requestedEntryPrice: 100,
        stopLossPrice: 95,
        takeProfitPrice: 110,
      },
      nowIso: '2026-05-10T00:00:00.000Z',
      brokerKey: 'mudrex',
      accountId: 'acc-1',
      positionsAdapter: {
        async createRiskOrder(
          positionId: string,
          body: Record<string, unknown>,
          context?: Record<string, unknown>
        ) {
          riskOrders.push({ positionId, body, context });
          return { success: true };
        },
      },
      protectionRepairEnabled: true,
      resolvePositionEntryPrice: (payload) => Number(payload.entry_price),
      deriveScaledProtectionPrice: (actualEntryPrice, requestedEntryPrice, requestedTargetPrice) =>
        Number(
          ((actualEntryPrice * requestedTargetPrice) / requestedEntryPrice).toFixed(6)
        ).toFixed(6),
      formatNumericString: (value) =>
        value === null || value === undefined ? null : String(value),
      markProtectionAttached: (trade, execution, nowIso, note, planUpdate, attempted) =>
        ({
          ...execution,
          protectionState: 'attached',
          protectionCheckedAt: nowIso,
          protectionAttachedAt: nowIso,
          protectionAttempts: Number(execution.protectionAttempts ?? 0) + (attempted ? 1 : 0),
          protectionLastError: null,
          note,
          protectionPlan: planUpdate,
        }) as any,
      markProtectionManualUnlinked: () => {
        throw new Error('Mudrex handler should attach protection in this scenario');
      },
      markProtectionFailed: () => {
        throw new Error('Mudrex handler should not fail protection in this scenario');
      },
    });

    assert.equal(riskOrders.length, 1);
    assert.equal(riskOrders[0]?.positionId, 'mudrex-native-position-1');
    assert.equal(riskOrders[0]?.body.stoploss_price, '96.900000');
    assert.equal(riskOrders[0]?.body.takeprofit_price, '112.200000');
    assert.equal(riskOrders[0]?.context?.brokerKey, 'mudrex');
    assert.equal(nextExecution.protectionState, 'attached');
    assert.equal(nextExecution.protectionAttempts, 1);
  }

  {
    const closedPositions: Array<{ positionId: string; context?: Record<string, unknown> }> = [];

    const nextExecution = await remediateMudrexLiveProtection({
      userId: 'user-1',
      trade: {
        symbol: 'JSTUSDT',
        side: 'BUY',
        timeframe: '5m',
      },
      execution: {
        orderId: 'mudrex-order-crossed-target',
        entryPrice: '0.08836',
        protectionAttempts: 1,
        protectionState: 'attaching',
      } as any,
      position: {
        externalId: 'mudrex-snapshot-crossed-target',
        payload: {
          id: 'mudrex-native-position-crossed-target',
          side: 'Long',
          entry_price: '0.08836',
          current_price: '0.08871',
        },
      },
      prices: {
        requestedEntryPrice: 0.08836,
        stopLossPrice: 0.08831,
        takeProfitPrice: 0.08859,
      },
      nowIso: '2026-05-12T04:18:51.000Z',
      brokerKey: 'mudrex',
      accountId: 'acc-1',
      positionsAdapter: {
        async createRiskOrder() {
          throw new Error('risk order must not be created after target is crossed');
        },
        async closePosition(positionId: string, context?: Record<string, unknown>) {
          closedPositions.push({ positionId, context });
          return { success: true };
        },
      },
      protectionRepairEnabled: true,
      resolvePositionEntryPrice: (payload) => Number(payload.entry_price),
      deriveScaledProtectionPrice: (
        _actualEntryPrice,
        _requestedEntryPrice,
        requestedTargetPrice
      ) => String(requestedTargetPrice),
      formatNumericString: (value) =>
        value === null || value === undefined ? null : String(value),
      markProtectionAttached: () => {
        throw new Error('Mudrex handler should close instead of attaching after target is crossed');
      },
      markProtectionManualUnlinked: () => {
        throw new Error('Mudrex handler should close instead of marking manual');
      },
      markProtectionFailed: () => {
        throw new Error('Mudrex handler should not fail when immediate close succeeds');
      },
    });

    assert.equal(nextExecution.executionState, 'closed');
    assert.equal(nextExecution.positionStatus, 'CLOSED');
    assert.equal(nextExecution.protectionState, 'not_required');
    assert.equal(nextExecution.protectionLastError, null);
    assert.match(String(nextExecution.note || ''), /closed immediately/);
    assert.equal(closedPositions.length, 1);
    assert.equal(closedPositions[0]?.positionId, 'mudrex-native-position-crossed-target');
  }

  {
    const protectiveOrders: Array<{
      assetId: string;
      body: Record<string, unknown>;
      context: Record<string, unknown> | undefined;
    }> = [];

    const nextExecution = await remediateDeltaLiveProtection({
      userId: 'user-1',
      trade: {
        id: 'st-delta-handler',
        symbol: 'BTCUSDT',
        side: 'SELL',
        timeframe: '5m',
      },
      execution: {
        orderId: 'delta-order-1',
        entryPrice: '100',
        quantity: '2',
        protectionState: 'pending',
        protectionAttempts: 0,
      } as any,
      position: {
        externalId: 'delta-position-1',
        payload: {
          entry_price: '100',
          size: '2',
          mark_price: '99',
        },
      },
      prices: {
        requestedEntryPrice: 100,
        stopLossPrice: 105,
        takeProfitPrice: 90,
      },
      nowIso: '2026-05-10T00:01:00.000Z',
      brokerKey: 'delta_exchange',
      accountId: 'acc-delta-1',
      ordersAdapter: {
        async createLiveAutoProtectiveOrdersForPosition(
          assetId: string,
          body: {
            size: number;
            entrySide: 'buy' | 'sell';
            stopLossPrice: number;
            takeProfitPrice: number;
            idempotencyKey?: string;
          },
          context?: Record<string, unknown>
        ) {
          protectiveOrders.push({ assetId, body, context });
          return {
            stop_loss_order_id: 'delta-sl-1',
            take_profit_order_id: 'delta-tp-1',
          };
        },
      },
      protectionRepairEnabled: true,
      resolveLiveProtectionOrderContext: async () => ({
        stopLossOrderId: null,
        takeProfitOrderId: null,
        stopLossStatus: null,
        takeProfitStatus: null,
        activeOrderIds: [],
      }),
      hasUsableProtectionContext: () => false,
      resolvePositionEntryPrice: (payload) => Number(payload.entry_price),
      resolvePositionCurrentPrice: (payload) => Number(payload.mark_price),
      deriveScaledProtectionPrice: (actualEntryPrice, requestedEntryPrice, requestedTargetPrice) =>
        Number(
          ((actualEntryPrice * requestedTargetPrice) / requestedEntryPrice).toFixed(6)
        ).toFixed(6),
      resolveLiveAutoAssetRoute: async () => ({
        assetId: 'delta-asset-1',
        brokerSymbol: 'BTCUSD',
        candidateSymbols: ['BTCUSDT'],
      }),
      resolveActiveProtectionOrdersForSymbol: async () => ({
        stopLossOrderIds: [],
        takeProfitOrderIds: [],
        unclassifiedOrderIds: [],
        activeOrderIds: [],
      }),
      unwrapOrderPlacementResponse: (response) => response as Record<string, unknown>,
      markProtectionAttached: () => {
        throw new Error('Delta handler should create replacement protection in this scenario');
      },
      markProtectionAttaching: (trade, execution, nowIso, note, planUpdate, attempted) =>
        ({
          ...execution,
          protectionState: 'attaching',
          protectionCheckedAt: nowIso,
          protectionAttempts: Number(execution.protectionAttempts ?? 0) + (attempted ? 1 : 0),
          note,
          protectionPlan: planUpdate,
        }) as any,
      markProtectionManualUnlinked: () => {
        throw new Error('Delta handler should not require manual action in this scenario');
      },
      markProtectionFailed: () => {
        throw new Error('Delta handler should not fail protection in this scenario');
      },
    });

    assert.equal(protectiveOrders.length, 1);
    assert.equal(protectiveOrders[0]?.assetId, 'delta-asset-1');
    assert.equal(protectiveOrders[0]?.body.entrySide, 'sell');
    assert.equal(protectiveOrders[0]?.body.size, 2);
    assert.equal(
      protectiveOrders[0]?.body.idempotencyKey,
      'live-auto-protection:st-delta-handler:delta-order-1'
    );
    assert.equal(protectiveOrders[0]?.context?.brokerKey, 'delta_exchange');
    assert.equal(nextExecution.protectionState, 'attaching');
    assert.equal(nextExecution.protectionAttempts, 1);
    assert.equal(
      (nextExecution.protectionPlan as Record<string, unknown>).stopLossOrderId,
      'delta-sl-1'
    );
    assert.equal(
      (nextExecution.protectionPlan as Record<string, unknown>).takeProfitOrderId,
      'delta-tp-1'
    );
  }

  {
    const partialProtectionOrders: Array<{
      assetId: string;
      body: Record<string, unknown>;
      context: Record<string, unknown> | undefined;
    }> = [];

    const partialFillExecution = await remediateDeltaLiveProtection({
      userId: 'user-1',
      trade: {
        id: 'st-delta-partial-entry-handler',
        symbol: 'GALAUSDT',
        side: 'BUY',
        timeframe: '5m',
      },
      execution: {
        orderId: 'delta-partial-entry',
        orderStatus: 'PARTIALLY_FILLED',
        entryPrice: '0.0036',
        quantity: 118,
        filledQuantity: 25,
        remainingQuantity: 0,
        protectionState: 'pending',
        protectionAttempts: 0,
      } as any,
      position: {
        externalId: 'delta-partial-position',
        payload: {
          entry_price: '0.0036',
          quantity_contracts: '25',
          mark_price: '0.00361',
        },
      },
      prices: {
        requestedEntryPrice: 0.0036,
        stopLossPrice: 0.0035,
        takeProfitPrice: 0.0038,
      },
      nowIso: '2026-05-10T00:02:00.000Z',
      brokerKey: 'delta_exchange',
      accountId: 'acc-delta-1',
      ordersAdapter: {
        async createLiveAutoProtectiveOrdersForPosition(
          assetId: string,
          body: Record<string, unknown>,
          context?: Record<string, unknown>
        ) {
          partialProtectionOrders.push({ assetId, body, context });
          return {
            stop_loss_order_id: 'delta-partial-sl',
            take_profit_order_id: 'delta-partial-tp',
          };
        },
      },
      protectionRepairEnabled: true,
      resolveLiveProtectionOrderContext: async () => ({
        stopLossOrderId: null,
        takeProfitOrderId: null,
        stopLossStatus: null,
        takeProfitStatus: null,
        activeOrderIds: [],
      }),
      hasUsableProtectionContext: () => false,
      resolvePositionEntryPrice: (payload) => Number(payload.entry_price),
      resolvePositionCurrentPrice: (payload) => Number(payload.mark_price),
      deriveScaledProtectionPrice: (
        _actualEntryPrice,
        _requestedEntryPrice,
        requestedTargetPrice
      ) => String(requestedTargetPrice),
      resolveLiveAutoAssetRoute: async () => ({
        assetId: 'delta-gala-asset',
        brokerSymbol: 'GALAUSD',
        candidateSymbols: ['GALAUSDT'],
      }),
      resolveActiveProtectionOrdersForSymbol: async () => ({
        stopLossOrderIds: [],
        takeProfitOrderIds: [],
        unclassifiedOrderIds: [],
        activeOrderIds: [],
        orderDetails: {},
      }),
      unwrapOrderPlacementResponse: (response) => response as Record<string, unknown>,
      markProtectionAttached: () => {
        throw new Error('Delta partial entry should create protection for filled size');
      },
      markProtectionAttaching: (trade, execution, nowIso, note, planUpdate, attempted) =>
        ({
          ...execution,
          protectionState: 'attaching',
          protectionCheckedAt: nowIso,
          protectionAttempts: Number(execution.protectionAttempts ?? 0) + (attempted ? 1 : 0),
          note,
          protectionPlan: planUpdate,
        }) as any,
      markProtectionManualUnlinked: () => {
        throw new Error(
          'Delta partial entry should not require manual action when prices are safe'
        );
      },
      markProtectionFailed: () => {
        throw new Error('Delta partial entry should not fail when position size is usable');
      },
    });

    assert.equal(partialProtectionOrders.length, 1);
    assert.equal(partialProtectionOrders[0]?.body.size, 25);
    assert.equal(partialFillExecution.protectionState, 'attaching');
    assert.equal(
      (partialFillExecution.protectionPlan as Record<string, unknown>).stopLossOrderId,
      'delta-partial-sl'
    );
  }

  {
    const cancelledProtectionOrders: Array<{ orderId: string; context?: Record<string, unknown> }> =
      [];
    const replacementOrders: Array<{
      assetId: string;
      body: Record<string, unknown>;
      context: Record<string, unknown> | undefined;
    }> = [];

    const partialReplacementExecution = await remediateDeltaLiveProtection({
      userId: 'user-1',
      trade: {
        id: 'st-delta-partial-replace-oversized',
        symbol: 'GALAUSDT',
        side: 'BUY',
        timeframe: '5m',
      },
      execution: {
        orderId: 'delta-partial-entry-replace',
        orderStatus: 'PARTIALLY_FILLED',
        entryPrice: '0.0036',
        quantity: 118,
        filledQuantity: 25,
        remainingQuantity: 0,
        canceledAt: '2026-05-10T00:01:00.000Z',
        protectionState: 'attaching',
        protectionAttempts: 1,
        protectionPlan: {
          stopLossOrderId: 'delta-old-sl',
          takeProfitOrderId: 'delta-old-tp',
        },
      } as any,
      position: {
        externalId: 'delta-partial-position-replace',
        payload: {
          entry_price: '0.0036',
          quantity_contracts: '25',
          mark_price: '0.00361',
        },
      },
      prices: {
        requestedEntryPrice: 0.0036,
        stopLossPrice: 0.0035,
        takeProfitPrice: 0.0038,
      },
      nowIso: '2026-05-10T00:02:00.000Z',
      brokerKey: 'delta_exchange',
      accountId: 'acc-delta-1',
      ordersAdapter: {
        async cancelOrder(orderId: string, context?: Record<string, unknown>) {
          cancelledProtectionOrders.push({ orderId, context });
          return { status: 'cancelled' };
        },
        async createLiveAutoProtectiveOrdersForPosition(
          assetId: string,
          body: Record<string, unknown>,
          context?: Record<string, unknown>
        ) {
          replacementOrders.push({ assetId, body, context });
          return {
            stop_loss_order_id: 'delta-new-sl',
            take_profit_order_id: 'delta-new-tp',
          };
        },
      },
      protectionRepairEnabled: true,
      resolveLiveProtectionOrderContext: async () => ({
        stopLossOrderId: 'delta-old-sl',
        takeProfitOrderId: 'delta-old-tp',
        stopLossStatus: 'PENDING',
        takeProfitStatus: 'PENDING',
        activeOrderIds: ['delta-old-sl', 'delta-old-tp'],
        orderDetails: {
          'delta-old-sl': {
            status: 'PENDING',
            quantity: 118,
            filledQuantity: 0,
            remainingQuantity: 118,
          },
          'delta-old-tp': {
            status: 'PENDING',
            quantity: 118,
            filledQuantity: 0,
            remainingQuantity: 118,
          },
        },
      }),
      hasUsableProtectionContext: (context) => {
        const slSize = context.orderDetails?.[String(context.stopLossOrderId)]?.quantity;
        const tpSize = context.orderDetails?.[String(context.takeProfitOrderId)]?.quantity;
        return slSize === 25 && tpSize === 25;
      },
      resolvePositionEntryPrice: (payload) => Number(payload.entry_price),
      resolvePositionCurrentPrice: (payload) => Number(payload.mark_price),
      deriveScaledProtectionPrice: (
        _actualEntryPrice,
        _requestedEntryPrice,
        requestedTargetPrice
      ) => String(requestedTargetPrice),
      resolveLiveAutoAssetRoute: async () => ({
        assetId: 'delta-gala-asset',
        brokerSymbol: 'GALAUSD',
        candidateSymbols: ['GALAUSDT'],
      }),
      resolveActiveProtectionOrdersForSymbol: async () => ({
        stopLossOrderIds: ['delta-old-sl'],
        takeProfitOrderIds: ['delta-old-tp'],
        unclassifiedOrderIds: [],
        activeOrderIds: ['delta-old-sl', 'delta-old-tp'],
        orderDetails: {
          'delta-old-sl': { status: 'PENDING', quantity: 118 },
          'delta-old-tp': { status: 'PENDING', quantity: 118 },
        },
      }),
      unwrapOrderPlacementResponse: (response) => response as Record<string, unknown>,
      markProtectionAttached: () => {
        throw new Error('Oversized Delta partial-fill protection should be replaced');
      },
      markProtectionAttaching: (trade, execution, nowIso, note, planUpdate, attempted) =>
        ({
          ...execution,
          protectionState: 'attaching',
          protectionCheckedAt: nowIso,
          protectionAttempts: Number(execution.protectionAttempts ?? 0) + (attempted ? 1 : 0),
          note,
          protectionPlan: {
            ...(execution.protectionPlan ?? {}),
            ...planUpdate,
          },
        }) as any,
      markProtectionManualUnlinked: () => {
        throw new Error('Oversized Delta partial-fill protection should not stay manual');
      },
      markProtectionFailed: () => {
        throw new Error('Oversized Delta partial-fill protection should be replaceable');
      },
    });

    assert.deepEqual(
      cancelledProtectionOrders.map((item) => item.orderId),
      ['delta-old-sl', 'delta-old-tp']
    );
    assert.equal(replacementOrders.length, 1);
    assert.equal(replacementOrders[0]?.body.size, 25);
    assert.equal(partialReplacementExecution.protectionState, 'attaching');
    assert.equal(partialReplacementExecution.protectionAttempts, 2);
    assert.equal(
      (partialReplacementExecution.protectionPlan as Record<string, unknown>).stopLossOrderId,
      'delta-new-sl'
    );
    assert.deepEqual(
      (partialReplacementExecution.protectionPlan as Record<string, unknown>)
        .replacedProtectionCancelledOrderIds,
      ['delta-old-sl', 'delta-old-tp']
    );
  }

  {
    const closedPositions: Array<{ positionId: string; context?: Record<string, unknown> }> = [];

    const profitLockedProtectionOrders: Array<{
      assetId: string;
      body: Record<string, unknown>;
    }> = [];
    const profitLockedExecution = await remediateDeltaLiveProtection({
      userId: 'user-1',
      trade: {
        id: 'st-delta-profit-lock-repair',
        symbol: 'VVVUSDT',
        side: 'BUY',
        timeframe: '5m',
      },
      execution: {
        orderId: 'delta-entry-profit-lock',
        entryPrice: '13.862',
        quantity: '2',
        protectionState: 'attached',
        protectionAttempts: 0,
      } as any,
      position: {
        externalId: '59172',
        payload: {
          entry_price: '13.862',
          quantity_contracts: '2',
          mark_price: '13.975',
        },
      },
      prices: {
        requestedEntryPrice: 13.862,
        stopLossPrice: 13.871568928571,
        takeProfitPrice: 14.452378571429,
      },
      nowIso: '2026-05-17T09:05:00.000Z',
      brokerKey: 'delta_exchange',
      accountId: 'acc-delta-1',
      ordersAdapter: {
        async createLiveAutoProtectiveOrdersForPosition(
          assetId: string,
          body: Record<string, unknown>
        ) {
          profitLockedProtectionOrders.push({ assetId, body });
          return {
            stop_loss_order_id: 'delta-profit-lock-sl',
            take_profit_order_id: 'delta-profit-lock-tp',
          };
        },
      },
      protectionRepairEnabled: true,
      resolveLiveProtectionOrderContext: async () => ({
        stopLossOrderId: 'old-cancelled-sl',
        takeProfitOrderId: 'old-pending-tp',
        stopLossStatus: 'CANCELLED',
        takeProfitStatus: 'PENDING',
        activeOrderIds: ['old-pending-tp'],
      }),
      hasUsableProtectionContext: () => false,
      resolvePositionEntryPrice: (payload) => Number(payload.entry_price),
      resolvePositionCurrentPrice: (payload) => Number(payload.mark_price),
      deriveScaledProtectionPrice: (
        _actualEntryPrice,
        _requestedEntryPrice,
        requestedTargetPrice
      ) => String(requestedTargetPrice),
      resolveLiveAutoAssetRoute: async () => ({
        assetId: 'delta-vvv-asset',
        brokerSymbol: 'VVVUSD',
        candidateSymbols: ['VVVUSDT'],
      }),
      resolveActiveProtectionOrdersForSymbol: async () => ({
        stopLossOrderIds: [],
        takeProfitOrderIds: [],
        unclassifiedOrderIds: [],
        activeOrderIds: [],
      }),
      unwrapOrderPlacementResponse: (response) => response as Record<string, unknown>,
      markProtectionAttached: () => {
        throw new Error('Delta handler should create replacement profit-lock protection');
      },
      markProtectionAttaching: (trade, execution, nowIso, note, planUpdate, attempted) =>
        ({
          ...execution,
          protectionState: 'attaching',
          protectionCheckedAt: nowIso,
          protectionAttempts: Number(execution.protectionAttempts ?? 0) + (attempted ? 1 : 0),
          note,
          protectionPlan: planUpdate,
        }) as any,
      markProtectionManualUnlinked: () => {
        throw new Error('Delta profit-lock protection should not require manual action');
      },
      markProtectionFailed: () => {
        throw new Error('Delta profit-lock protection should not fail direction validation');
      },
    });
    assert.equal(profitLockedProtectionOrders.length, 1);
    assert.equal(profitLockedProtectionOrders[0]?.body.stopLossPrice, 13.871568928571);
    assert.equal(profitLockedExecution.protectionState, 'attaching');

    const nextExecution = await remediateDeltaLiveProtection({
      userId: 'user-1',
      trade: {
        id: 'st-delta-crossed-protection',
        symbol: 'GALAUSDT',
        side: 'SELL',
        timeframe: '5m',
      },
      execution: {
        orderId: 'delta-entry-crossed',
        entryPrice: '0.003604',
        quantity: '118',
        filledQuantity: 25,
        protectionState: 'pending',
        protectionAttempts: 0,
      } as any,
      position: {
        externalId: '27912',
        payload: {
          product_id: '27912',
          entry_price: '0.00361',
          quantity_contracts: '25',
          mark_price: '0.00362174',
        },
      },
      prices: {
        requestedEntryPrice: 0.003604,
        stopLossPrice: 0.003612,
        takeProfitPrice: 0.00354,
      },
      nowIso: '2026-05-15T08:06:01.000Z',
      brokerKey: 'delta_exchange',
      accountId: 'acc-delta-1',
      ordersAdapter: {
        async createLiveAutoProtectiveOrdersForPosition() {
          throw new Error('Delta handler should close instead of creating crossed protection');
        },
      },
      positionsAdapter: {
        async closePosition(positionId: string, context?: Record<string, unknown>) {
          closedPositions.push({ positionId, context });
          return { order_id: 'delta-close-1', status: 'open' };
        },
      },
      protectionRepairEnabled: true,
      resolveLiveProtectionOrderContext: async () => ({
        stopLossOrderId: null,
        takeProfitOrderId: null,
        stopLossStatus: null,
        takeProfitStatus: null,
        activeOrderIds: [],
      }),
      hasUsableProtectionContext: () => false,
      resolvePositionEntryPrice: (payload) => Number(payload.entry_price),
      resolvePositionCurrentPrice: (payload) => Number(payload.mark_price),
      deriveScaledProtectionPrice: (actualEntryPrice, requestedEntryPrice, requestedTargetPrice) =>
        Number(
          ((actualEntryPrice * requestedTargetPrice) / requestedEntryPrice).toFixed(6)
        ).toFixed(6),
      resolveLiveAutoAssetRoute: async () => {
        throw new Error('Delta handler should not resolve route after crossed protection');
      },
      resolveActiveProtectionOrdersForSymbol: async () => {
        throw new Error(
          'Delta handler should not inspect symbol protection after crossed protection'
        );
      },
      unwrapOrderPlacementResponse: (response) => response as Record<string, unknown>,
      markProtectionAttached: () => {
        throw new Error('Delta handler should close instead of attaching crossed protection');
      },
      markProtectionAttaching: () => {
        throw new Error('Delta handler should close instead of marking attaching');
      },
      markProtectionManualUnlinked: () => {
        throw new Error('Delta handler should auto-close crossed protection when possible');
      },
      markProtectionFailed: () => {
        throw new Error('Delta handler should not fail when immediate close succeeds');
      },
    });

    assert.equal(closedPositions.length, 1);
    assert.equal(closedPositions[0]?.positionId, '27912');
    assert.equal(closedPositions[0]?.context?.brokerKey, 'delta_exchange');
    assert.equal(nextExecution.executionState, 'closed');
    assert.equal(nextExecution.positionStatus, 'CLOSED');
    assert.equal(nextExecution.protectionState, 'not_required');
    assert.equal(nextExecution.protectionLastError, null);
    assert.match(String(nextExecution.note || ''), /closed immediately/);
    assert.equal(
      (nextExecution.protectionPlan as Record<string, unknown>).autoCloseReason,
      'unsafe_protection_already_crossed'
    );
  }

  {
    const closedPositions: Array<{ positionId: string; context?: Record<string, unknown> }> = [];

    const partialProtectionExecution = await remediateDeltaLiveProtection({
      userId: 'user-1',
      trade: {
        id: 'st-delta-partial-protection',
        symbol: 'ORDERUSDT',
        side: 'BUY',
        timeframe: '5m',
      },
      execution: {
        orderId: 'delta-entry-partial-protection',
        entryPrice: '0.0534',
        quantity: 78,
        filledQuantity: 78,
        protectionState: 'attached',
        protectionAttempts: 0,
      } as any,
      position: {
        externalId: '97415',
        payload: {
          entry_price: '0.0534',
          quantity_contracts: '40',
          mark_price: '0.0536',
        },
      },
      prices: {
        requestedEntryPrice: 0.0534,
        stopLossPrice: 0.0531,
        takeProfitPrice: 0.054,
      },
      nowIso: '2026-05-17T13:54:00.000Z',
      brokerKey: 'delta_exchange',
      accountId: 'acc-delta-1',
      ordersAdapter: {
        async createLiveAutoProtectiveOrdersForPosition() {
          throw new Error('Delta partial protection should close instead of replacing orders');
        },
      },
      positionsAdapter: {
        async closePosition(positionId: string, context?: Record<string, unknown>) {
          closedPositions.push({ positionId, context });
          return { order_id: 'delta-close-partial-protection', status: 'open' };
        },
      },
      protectionRepairEnabled: true,
      resolveLiveProtectionOrderContext: async () => ({
        stopLossOrderId: 'delta-sl-partial',
        takeProfitOrderId: 'delta-tp-active',
        stopLossStatus: 'PARTIALLY_FILLED',
        takeProfitStatus: 'PENDING',
        activeOrderIds: ['delta-sl-partial', 'delta-tp-active'],
        orderDetails: {
          'delta-sl-partial': {
            status: 'PARTIALLY_FILLED',
            quantity: 78,
            filledQuantity: 38,
            remainingQuantity: 40,
          },
          'delta-tp-active': {
            status: 'PENDING',
            quantity: 78,
            filledQuantity: 0,
            remainingQuantity: 78,
          },
        },
      }),
      hasUsableProtectionContext: () => {
        throw new Error('Delta partial protection should be detected before usability check');
      },
      resolvePositionEntryPrice: (payload) => Number(payload.entry_price),
      resolvePositionCurrentPrice: (payload) => Number(payload.mark_price),
      deriveScaledProtectionPrice: (
        _actualEntryPrice,
        _requestedEntryPrice,
        requestedTargetPrice
      ) => String(requestedTargetPrice),
      resolveLiveAutoAssetRoute: async () => {
        throw new Error('Delta partial protection should not resolve route before closing');
      },
      resolveActiveProtectionOrdersForSymbol: async () => {
        throw new Error('Delta partial protection should not inspect symbol protection');
      },
      unwrapOrderPlacementResponse: (response) => response as Record<string, unknown>,
      markProtectionAttached: () => {
        throw new Error('Delta partial protection should not be trusted as attached');
      },
      markProtectionAttaching: () => {
        throw new Error('Delta partial protection should not attach replacement orders');
      },
      markProtectionManualUnlinked: () => {
        throw new Error('Delta partial protection should auto-close remaining position');
      },
      markProtectionFailed: () => {
        throw new Error('Delta partial protection should not fail when immediate close succeeds');
      },
    });

    assert.equal(closedPositions.length, 1);
    assert.equal(closedPositions[0]?.positionId, '97415');
    assert.equal(partialProtectionExecution.executionState, 'closed');
    assert.equal(partialProtectionExecution.protectionState, 'not_required');
    assert.equal(
      (partialProtectionExecution.protectionPlan as Record<string, unknown>).autoCloseReason,
      'partial_protection_execution'
    );
  }
}

async function runSuggestedTradeProtectionRemediationAssertions(): Promise<void> {
  {
    const service = new SuggestedTradesService() as any;
    let savedExecutionPayload: Record<string, unknown> | null = null;
    const riskOrders: Array<{
      positionId: string;
      body: Record<string, unknown>;
      context: Record<string, unknown> | undefined;
    }> = [];
    const trade = {
      id: 'st-mudrex-protection-remediate',
      automationId: 'auto-1',
      automationRunId: 'run-1',
      userId: 'user-1',
      symbol: 'BTCUSDT',
      timeframe: '5m',
      side: 'BUY',
      signalTime: new Date('2026-04-04T10:00:00.000Z'),
      status: 'Accepted',
      confidence: 0.88,
      score: 90,
      entryPrice: '100',
      stopLossPrice: '95',
      takeProfitTargets: ['110'],
      entryRule: 'breakout',
      exitRule: 'trail',
      rationale: null,
      dedupeKey: 'dedupe-mudrex-protection-remediate',
      meta: null,
      executionRecord: {
        executionMode: 'live',
        brokerKey: 'mudrex',
        accountId: 'acc-1',
        orderId: 'mudrex-order-1',
        orderStatus: 'OPEN',
        executionState: 'linked',
        orderType: 'limit',
        linkedAt: '2026-04-04T10:01:00.000Z',
        entryPrice: '100',
        stopLossPrice: '95',
        takeProfitPrice: '110',
        quantity: 1,
        protectionState: 'pending',
        protectionAttempts: 0,
        createdAt: new Date('2026-04-04T10:01:00.000Z'),
        updatedAt: new Date('2026-04-04T10:01:00.000Z'),
      },
      createdAt: new Date('2026-04-04T10:00:30.000Z'),
      updatedAt: new Date('2026-04-04T10:01:00.000Z'),
    };

    service.suggestedTradeRepository = {
      async getLinkedOrderSnapshot() {
        return {
          orderStatus: 'FILLED',
          statusRank: 3,
          lastSeenAt: '2026-04-04T10:03:00.000Z',
          payload: {
            status: 'FILLED',
            average_fill_price: '102',
            filled_quantity: '1',
            remaining_quantity: '0',
            updated_at: '2026-04-04T10:03:00.000Z',
          },
        };
      },
      async getLinkedPositionSnapshots() {
        return [
          {
            externalId: 'mudrex:asset-1:2026-04-04T10:03:05Z:LONG',
            status: 'OPEN',
            statusRank: 2,
            firstSeenAt: '2026-04-04T10:03:05.000Z',
            lastSeenAt: '2026-04-04T10:03:05.000Z',
            payload: {
              id: 'mudrex-native-position-1',
              status: 'open',
              side: 'Long',
              entry_price: '102',
              quantity: '1',
              created_at: '2026-04-04T10:03:05.000Z',
              updated_at: '2026-04-04T10:03:05.000Z',
            },
          },
        ];
      },
      async saveSuggestedTradeExecution(payload: Record<string, unknown>) {
        savedExecutionPayload = { ...payload };
        return {
          ...payload,
          createdAt: new Date('2026-04-04T10:04:00.000Z'),
          updatedAt: new Date('2026-04-04T10:04:00.000Z'),
        };
      },
    };
    service.brokerRuntimeRegistry = {
      getPositionsAdapter() {
        return {
          async createRiskOrder(
            positionId: string,
            body: Record<string, unknown>,
            context?: Record<string, unknown>
          ) {
            riskOrders.push({ positionId, body, context });
            return { success: true };
          },
        };
      },
      supportsOrdersAdapter() {
        return false;
      },
    };

    const refreshed = await service.refreshExecutionOutcomes('user-1', [trade]);

    assert.equal(refreshed, 1);
    assert.equal(riskOrders[0]?.positionId, 'mudrex-native-position-1');
    assert.equal(riskOrders[0]?.body.stoploss_price, '96.900000');
    assert.equal(riskOrders[0]?.body.takeprofit_price, '112.200000');
    assert.equal(savedExecutionPayload?.['protectionState'], 'attached');
    assert.equal(savedExecutionPayload?.['protectionAttempts'], 1);
    assert.equal(
      (savedExecutionPayload?.['protectionPlan'] as Record<string, unknown> | undefined)
        ?.attachedStopLossPrice,
      '96.900000'
    );
    assert.equal(
      (savedExecutionPayload?.['protectionPlan'] as Record<string, unknown> | undefined)
        ?.snapshotPositionId,
      'mudrex:asset-1:2026-04-04T10:03:05Z:LONG'
    );
  }

  {
    const service = new SuggestedTradesService() as any;
    let savedExecutionPayload: Record<string, unknown> | null = null;
    const riskOrders: Array<{
      positionId: string;
      body: Record<string, unknown>;
      context: Record<string, unknown> | undefined;
    }> = [];
    const trade = {
      id: 'st-mudrex-position-sync-delayed-fill',
      automationId: 'auto-1',
      automationRunId: 'run-1',
      userId: 'user-1',
      symbol: 'AXLUSDT',
      timeframe: '5m',
      side: 'SELL',
      signalTime: new Date('2026-05-10T00:05:00.000Z'),
      status: 'Accepted',
      confidence: 0.88,
      score: 90,
      entryPrice: '0.07443',
      stopLossPrice: '0.07449',
      takeProfitTargets: ['0.07412'],
      entryRule: 'breakdown',
      exitRule: 'fixed-risk',
      rationale: null,
      dedupeKey: 'dedupe-mudrex-position-sync-delayed-fill',
      meta: null,
      executionRecord: {
        executionMode: 'live',
        brokerKey: 'mudrex',
        accountId: 'acc-1',
        orderId: 'mudrex-order-delayed-fill',
        orderStatus: 'OPEN',
        executionState: 'linked',
        orderType: 'limit',
        linkedAt: '2026-05-10T00:06:34.000Z',
        entryPrice: '0.07443',
        stopLossPrice: '0.07449',
        takeProfitPrice: '0.07412',
        quantity: 1887,
        protectionState: 'waiting_for_fill',
        protectionCheckedAt: '2026-05-10T00:06:34.000Z',
        protectionAttempts: 0,
        createdAt: new Date('2026-05-10T00:06:34.000Z'),
        updatedAt: new Date('2026-05-10T00:06:34.000Z'),
      },
      createdAt: new Date('2026-05-10T00:05:30.000Z'),
      updatedAt: new Date('2026-05-10T00:06:34.000Z'),
    };

    service.suggestedTradeRepository = {
      async findLinkedTradesBySymbols(
        userId: string,
        brokerKey: string,
        accountId: string,
        symbols: string[]
      ) {
        assert.equal(userId, 'user-1');
        assert.equal(brokerKey, 'mudrex');
        assert.equal(accountId, 'acc-1');
        assert.deepEqual(symbols, ['AXLUSDT']);
        return [trade];
      },
      async getLinkedOrderSnapshot() {
        return {
          orderStatus: 'OPEN',
          statusRank: 1,
          lastSeenAt: '2026-05-10T00:20:24.000Z',
          payload: {
            status: 'OPEN',
            price: '0.07443',
            quantity: '1887',
            updated_at: '2026-05-10T00:20:24.000Z',
          },
        };
      },
      async getLinkedPositionSnapshots() {
        return [
          {
            externalId: 'mudrex:asset-1:2026-05-10T00:06:34Z:SHORT',
            status: 'OPEN',
            statusRank: 1,
            firstSeenAt: '2026-05-10T00:20:25.000Z',
            lastSeenAt: '2026-05-10T00:20:25.000Z',
            payload: {
              id: 'mudrex-native-position-delayed-fill',
              status: 'open',
              symbol: 'AXLUSDT',
              entry_price: '0.07443',
              current_price: '0.07430',
              liquidation_price: '0.07783',
              quantity: '1887',
              created_at: '2026-05-10T00:06:34.000Z',
              updated_at: '2026-05-10T00:20:25.000Z',
            },
          },
        ];
      },
      async saveSuggestedTradeExecution(payload: Record<string, unknown>) {
        savedExecutionPayload = { ...payload };
        return {
          ...payload,
          createdAt: new Date('2026-05-10T00:20:26.000Z'),
          updatedAt: new Date('2026-05-10T00:20:26.000Z'),
        };
      },
    };
    service.brokerRuntimeRegistry = {
      getPositionsAdapter() {
        return {
          async createRiskOrder(
            positionId: string,
            body: Record<string, unknown>,
            context?: Record<string, unknown>
          ) {
            riskOrders.push({ positionId, body, context });
            return { success: true };
          },
        };
      },
      supportsOrdersAdapter() {
        return false;
      },
    };

    const refreshed = await service.syncExecutionForPositionUpdates('user-1', 'mudrex', 'acc-1', [
      'AXLUSDT',
    ]);

    assert.equal(refreshed, 1);
    assert.equal(riskOrders.length, 1);
    assert.equal(riskOrders[0]?.positionId, 'mudrex-native-position-delayed-fill');
    assert.equal(riskOrders[0]?.body.stoploss_price, '0.074490');
    assert.equal(riskOrders[0]?.body.takeprofit_price, '0.074120');
    assert.equal(savedExecutionPayload?.['orderStatus'], 'FILLED');
    assert.equal(savedExecutionPayload?.['executionState'], 'filled');
    assert.equal(
      savedExecutionPayload?.['positionId'],
      'mudrex:asset-1:2026-05-10T00:06:34Z:SHORT'
    );
    assert.equal(savedExecutionPayload?.['positionOpenedAt'], '2026-05-10T00:06:34.000Z');
    assert.equal(savedExecutionPayload?.['filledAt'], '2026-05-10T00:20:25.000Z');
    assert.equal(savedExecutionPayload?.['protectionState'], 'attached');
    assert.equal(savedExecutionPayload?.['protectionAttempts'], 1);
    assert.ok(Number.isFinite(Date.parse(String(savedExecutionPayload?.['protectionCheckedAt']))));
    assert.equal(
      savedExecutionPayload?.['protectionAttachedAt'],
      savedExecutionPayload?.['protectionCheckedAt']
    );
    const mudrexProtectionPlan = savedExecutionPayload?.['protectionPlan'] as
      | Record<string, unknown>
      | undefined;
    assert.equal(
      mudrexProtectionPlan?.snapshotPositionId,
      'mudrex:asset-1:2026-05-10T00:06:34Z:SHORT'
    );
    assert.equal(mudrexProtectionPlan?.attachedAt, savedExecutionPayload?.['protectionCheckedAt']);
    assert.equal(mudrexProtectionPlan?.attachedStopLossPrice, '0.074490');
    assert.equal(mudrexProtectionPlan?.attachedTakeProfitPrice, '0.074120');
  }

  {
    const service = new SuggestedTradesService() as any;
    let riskOrderPositionId: string | null = null;
    service.brokerRuntimeRegistry = {
      getPositionsAdapter() {
        return {
          async createRiskOrder(positionId: string) {
            riskOrderPositionId = positionId;
            return { success: true };
          },
        };
      },
    };

    const nextExecution = await service.maybeRemediateLiveProtection(
      'user-1',
      {
        id: 'st-mudrex-protection-retry',
        automationId: 'auto-1',
        automationRunId: 'run-1',
        userId: 'user-1',
        symbol: 'GOATUSDT',
        timeframe: '5m',
        side: 'SELL',
        signalTime: new Date('2026-04-04T10:00:00.000Z'),
        status: 'Accepted',
        entryPrice: '0.018',
        stopLossPrice: '0.019',
        takeProfitTargets: ['0.016'],
        dedupeKey: 'dedupe-mudrex-protection-retry',
        meta: null,
        createdAt: new Date('2026-04-04T10:00:00.000Z'),
        updatedAt: new Date('2026-04-04T10:00:00.000Z'),
      },
      {
        executionMode: 'live',
        brokerKey: 'mudrex',
        accountId: 'acc-1',
        orderId: 'mudrex-order-retry',
        executionState: 'filled',
        orderStatus: 'FILLED',
        entryPrice: '0.018',
        stopLossPrice: '0.019',
        takeProfitPrice: '0.016',
        protectionState: 'failed',
        protectionAttempts: 1,
        protectionLastError: 'Mudrex protection remediation failed: position not found',
      },
      [
        {
          externalId: 'mudrex:asset-1:2026-04-04T10:03:05Z:SHORT',
          status: 'OPEN',
          statusRank: 2,
          firstSeenAt: '2026-04-04T10:03:05.000Z',
          lastSeenAt: '2026-04-04T10:03:05.000Z',
          payload: {
            id: 'mudrex-native-position-retry',
            status: 'open',
            order_type: 'SHORT',
            entry_price: '0.0182',
            quantity: '100',
            created_at: '2026-04-04T10:03:05.000Z',
            updated_at: '2026-04-04T10:03:05.000Z',
          },
        },
      ]
    );

    assert.equal(riskOrderPositionId, 'mudrex-native-position-retry');
    assert.equal(nextExecution.protectionState, 'attached');
    assert.equal(nextExecution.protectionAttempts, 2);
  }

  {
    const service = new SuggestedTradesService() as any;
    let riskOrderCalled = false;
    service.brokerRuntimeRegistry = {
      getPositionsAdapter() {
        return {
          async createRiskOrder() {
            riskOrderCalled = true;
            throw new Error('invalid manual protection should not call broker');
          },
        };
      },
    };

    const nextExecution = await service.maybeRemediateLiveProtection(
      'user-1',
      {
        id: 'st-mudrex-protection-manual',
        automationId: 'auto-1',
        automationRunId: 'run-1',
        userId: 'user-1',
        symbol: 'GOATUSDT',
        timeframe: '5m',
        side: 'SELL',
        signalTime: new Date('2026-04-04T10:00:00.000Z'),
        status: 'Accepted',
        entryPrice: '0.018',
        stopLossPrice: '0.019',
        takeProfitTargets: ['0.016'],
        dedupeKey: 'dedupe-mudrex-protection-manual',
        meta: null,
        createdAt: new Date('2026-04-04T10:00:00.000Z'),
        updatedAt: new Date('2026-04-04T10:00:00.000Z'),
      },
      {
        executionMode: 'live',
        brokerKey: 'mudrex',
        accountId: 'acc-1',
        orderId: 'mudrex-order-manual',
        executionState: 'filled',
        orderStatus: 'FILLED',
        entryPrice: '0.018',
        stopLossPrice: '0.019',
        takeProfitPrice: '0.016',
        protectionState: 'failed',
        protectionAttempts: 2,
        protectionLastError: 'Mudrex protection remediation failed: bad request',
      },
      [
        {
          externalId: 'mudrex:asset-1:2026-04-04T10:03:05Z:SHORT',
          status: 'OPEN',
          statusRank: 2,
          firstSeenAt: '2026-04-04T10:03:05.000Z',
          lastSeenAt: '2026-04-04T10:03:05.000Z',
          payload: {
            id: 'mudrex-native-position-manual',
            status: 'open',
            order_type: 'SHORT',
            entry_price: '0.0182',
            current_price: '0.0195',
            liquidation_price: '0.021',
            quantity: '100',
            created_at: '2026-04-04T10:03:05.000Z',
            updated_at: '2026-04-04T10:03:05.000Z',
          },
        },
      ]
    );

    assert.equal(riskOrderCalled, false);
    assert.equal(nextExecution.protectionState, 'failed');
    assert.match(
      String(nextExecution.protectionLastError || ''),
      /close-position adapter is unavailable/
    );
  }

  {
    const service = new SuggestedTradesService() as any;
    let riskOrderCalled = false;
    service.brokerRuntimeRegistry = {
      getPositionsAdapter() {
        return {
          async createRiskOrder() {
            riskOrderCalled = true;
            throw new Error('manual recovery must not create a new Mudrex risk order');
          },
        };
      },
    };

    const nextExecution = await service.maybeRemediateLiveProtection(
      'user-1',
      {
        id: 'st-mudrex-manual-recovered',
        automationId: 'auto-1',
        automationRunId: 'run-1',
        userId: 'user-1',
        symbol: 'GOATUSDT',
        timeframe: '5m',
        side: 'SELL',
        signalTime: new Date('2026-04-04T10:00:00.000Z'),
        status: 'Accepted',
        entryPrice: '0.018',
        stopLossPrice: '0.019',
        takeProfitTargets: ['0.016'],
        dedupeKey: 'dedupe-mudrex-manual-recovered',
        meta: null,
        createdAt: new Date('2026-04-04T10:00:00.000Z'),
        updatedAt: new Date('2026-04-04T10:00:00.000Z'),
      },
      {
        executionMode: 'live',
        brokerKey: 'mudrex',
        accountId: 'acc-1',
        orderId: 'mudrex-order-manual-recovered',
        executionState: 'filled',
        orderStatus: 'FILLED',
        entryPrice: '0.018',
        stopLossPrice: '0.019',
        takeProfitPrice: '0.016',
        protectionState: 'manual_unlinked',
        protectionAttempts: 2,
        protectionLastError: 'Mudrex protection needs manual action.',
      },
      [
        {
          externalId: 'mudrex:asset-1:2026-04-04T10:03:05Z:SHORT',
          status: 'OPEN',
          statusRank: 2,
          firstSeenAt: '2026-04-04T10:03:05.000Z',
          lastSeenAt: '2026-04-04T10:03:05.000Z',
          payload: {
            id: 'mudrex-native-position-manual-recovered',
            status: 'open',
            order_type: 'SHORT',
            entry_price: '0.0182',
            stoploss_order_id: 'mudrex-sl-1',
            takeprofit_order_id: 'mudrex-tp-1',
            created_at: '2026-04-04T10:03:05.000Z',
            updated_at: '2026-04-04T10:03:05.000Z',
          },
        },
      ]
    );

    assert.equal(riskOrderCalled, false);
    assert.equal(nextExecution.protectionState, 'attached');
    assert.equal(nextExecution.protectionAttempts, 2);
    assert.equal(nextExecution.protectionLastError, null);
    assert.match(String(nextExecution.note || ''), /manual SL\/TP protection/);
  }

  {
    const service = new SuggestedTradesService() as any;
    let riskOrderCalled = false;
    service.brokerRuntimeRegistry = {
      getPositionsAdapter() {
        return {
          async createRiskOrder() {
            riskOrderCalled = true;
            throw new Error('manual recheck must not create a new Mudrex risk order');
          },
        };
      },
    };

    const nextExecution = await service.maybeRemediateLiveProtection(
      'user-1',
      {
        id: 'st-mudrex-manual-still-open',
        automationId: 'auto-1',
        automationRunId: 'run-1',
        userId: 'user-1',
        symbol: 'GOATUSDT',
        timeframe: '5m',
        side: 'SELL',
        signalTime: new Date('2026-04-04T10:00:00.000Z'),
        status: 'Accepted',
        entryPrice: '0.018',
        stopLossPrice: '0.019',
        takeProfitTargets: ['0.016'],
        dedupeKey: 'dedupe-mudrex-manual-still-open',
        meta: null,
        createdAt: new Date('2026-04-04T10:00:00.000Z'),
        updatedAt: new Date('2026-04-04T10:00:00.000Z'),
      },
      {
        executionMode: 'live',
        brokerKey: 'mudrex',
        accountId: 'acc-1',
        orderId: 'mudrex-order-manual-still-open',
        executionState: 'filled',
        orderStatus: 'FILLED',
        entryPrice: '0.018',
        stopLossPrice: '0.019',
        takeProfitPrice: '0.016',
        protectionState: 'manual_unlinked',
        protectionAttempts: 2,
        protectionLastError: 'Mudrex protection needs manual action.',
      },
      [
        {
          externalId: 'mudrex:asset-1:2026-04-04T10:03:05Z:SHORT',
          status: 'OPEN',
          statusRank: 2,
          firstSeenAt: '2026-04-04T10:03:05.000Z',
          lastSeenAt: '2026-04-04T10:03:05.000Z',
          payload: {
            id: 'mudrex-native-position-manual-still-open',
            status: 'open',
            order_type: 'SHORT',
            entry_price: '0.0182',
            created_at: '2026-04-04T10:03:05.000Z',
            updated_at: '2026-04-04T10:03:05.000Z',
          },
        },
      ]
    );

    assert.equal(riskOrderCalled, false);
    assert.equal(nextExecution.protectionState, 'manual_unlinked');
    assert.equal(nextExecution.protectionAttempts, 2);
    assert.equal(nextExecution.protectionLastError, 'Mudrex protection needs manual action.');
    assert.match(String(nextExecution.note || ''), /manual action remains required/);
    assert.ok(nextExecution.protectionCheckedAt);
  }

  {
    const service = new SuggestedTradesService() as any;
    let riskOrderCalled = false;
    let riskOrderPositionId: string | null = null;
    service.brokerRuntimeRegistry = {
      getPositionsAdapter() {
        return {
          async createRiskOrder(positionId: string) {
            riskOrderCalled = true;
            riskOrderPositionId = positionId;
            return {};
          },
        };
      },
    };

    const nextExecution = await service.maybeRemediateLiveProtection(
      'user-1',
      {
        id: 'st-mudrex-not-required-open-position',
        automationId: 'auto-1',
        automationRunId: 'run-1',
        userId: 'user-1',
        symbol: 'GOATUSDT',
        timeframe: '5m',
        side: 'SELL',
        signalTime: new Date('2026-04-04T10:00:00.000Z'),
        status: 'Accepted',
        entryPrice: '0.018',
        stopLossPrice: '0.019',
        takeProfitTargets: ['0.016'],
        dedupeKey: 'dedupe-mudrex-not-required-open-position',
        meta: null,
        createdAt: new Date('2026-04-04T10:00:00.000Z'),
        updatedAt: new Date('2026-04-04T10:00:00.000Z'),
      },
      {
        executionMode: 'live',
        brokerKey: 'mudrex',
        accountId: 'acc-1',
        orderId: 'mudrex-order-not-required-open-position',
        executionState: 'filled',
        orderStatus: 'FILLED',
        entryPrice: '0.018',
        stopLossPrice: '0.019',
        takeProfitPrice: '0.016',
        protectionState: 'not_required',
        protectionAttempts: 0,
        protectionCheckedAt: '2026-04-04T10:02:00.000Z',
      },
      [
        {
          externalId: 'mudrex:asset-1:2026-04-04T10:03:05Z:SHORT',
          status: 'OPEN',
          statusRank: 2,
          firstSeenAt: '2026-04-04T10:03:05.000Z',
          lastSeenAt: '2026-04-04T10:03:05.000Z',
          payload: {
            id: 'mudrex-native-position-not-required-open',
            status: 'open',
            order_type: 'SHORT',
            entry_price: '0.0182',
            current_price: '0.0182',
            liquidation_price: '0.021',
            quantity: '100',
            created_at: '2026-04-04T10:03:05.000Z',
            updated_at: '2026-04-04T10:03:05.000Z',
          },
        },
      ]
    );

    assert.equal(riskOrderCalled, true);
    assert.equal(riskOrderPositionId, 'mudrex-native-position-not-required-open');
    assert.equal(nextExecution.protectionState, 'attached');
    assert.equal(nextExecution.protectionAttempts, 1);
    assert.equal(nextExecution.protectionLastError, null);
    assert.match(String(nextExecution.note || ''), /Derived Mudrex SL\/TP attached/);
  }

  {
    const originalMudrexRepairEnabled = env.suggestedTrades.protectionRepair.mudrexEnabled;
    const originalMudrexRepairEnv = process.env.SUGGESTED_TRADES_PROTECTION_REPAIR_MUDREX_ENABLED;
    const service = new SuggestedTradesService() as any;
    let riskOrderCalled = false;
    service.brokerRuntimeRegistry = {
      getPositionsAdapter() {
        return {
          async createRiskOrder() {
            riskOrderCalled = true;
            throw new Error('disabled Mudrex protection repair must not create a risk order');
          },
        };
      },
    };

    try {
      env.suggestedTrades.protectionRepair.mudrexEnabled = false;
      process.env.SUGGESTED_TRADES_PROTECTION_REPAIR_MUDREX_ENABLED = 'false';
      const nextExecution = await service.maybeRemediateLiveProtection(
        'user-1',
        {
          id: 'st-mudrex-repair-control-disabled',
          automationId: 'auto-1',
          automationRunId: 'run-1',
          userId: 'user-1',
          symbol: 'GOATUSDT',
          timeframe: '5m',
          side: 'SELL',
          signalTime: new Date('2026-04-04T10:00:00.000Z'),
          status: 'Accepted',
          entryPrice: '0.018',
          stopLossPrice: '0.019',
          takeProfitTargets: ['0.016'],
          dedupeKey: 'dedupe-mudrex-repair-control-disabled',
          meta: null,
          createdAt: new Date('2026-04-04T10:00:00.000Z'),
          updatedAt: new Date('2026-04-04T10:00:00.000Z'),
        },
        {
          executionMode: 'live',
          brokerKey: 'mudrex',
          accountId: 'acc-1',
          orderId: 'mudrex-order-repair-control-disabled',
          executionState: 'filled',
          orderStatus: 'FILLED',
          entryPrice: '0.018',
          stopLossPrice: '0.019',
          takeProfitPrice: '0.016',
          protectionState: 'waiting_for_position',
          protectionAttempts: 0,
        },
        [
          {
            externalId: 'mudrex:asset-1:2026-04-04T10:03:05Z:SHORT',
            status: 'OPEN',
            statusRank: 2,
            firstSeenAt: '2026-04-04T10:03:05.000Z',
            lastSeenAt: '2026-04-04T10:03:05.000Z',
            payload: {
              id: 'mudrex-native-position-repair-control-disabled',
              status: 'open',
              order_type: 'SHORT',
              entry_price: '0.0182',
              current_price: '0.0182',
              quantity: '100',
              created_at: '2026-04-04T10:03:05.000Z',
              updated_at: '2026-04-04T10:03:05.000Z',
            },
          },
        ]
      );

      assert.equal(riskOrderCalled, false);
      assert.equal(nextExecution.protectionState, 'manual_unlinked');
      assert.match(
        String(nextExecution.protectionLastError || ''),
        /Mudrex automatic SL\/TP protection repair is disabled/
      );
    } finally {
      env.suggestedTrades.protectionRepair.mudrexEnabled = originalMudrexRepairEnabled;
      restoreEnv('SUGGESTED_TRADES_PROTECTION_REPAIR_MUDREX_ENABLED', originalMudrexRepairEnv);
    }
  }

  {
    const service = new SuggestedTradesService() as any;
    let riskOrderCalled = false;
    service.brokerRuntimeRegistry = {
      getPositionsAdapter() {
        return {
          async createRiskOrder() {
            riskOrderCalled = true;
            throw new Error('position-less retry must not attach protection');
          },
        };
      },
    };

    const nextExecution = await service.maybeRemediateLiveProtection(
      'user-1',
      {
        id: 'st-mudrex-not-required-waiting-for-position',
        automationId: 'auto-1',
        automationRunId: 'run-1',
        userId: 'user-1',
        symbol: 'GOATUSDT',
        timeframe: '5m',
        side: 'SELL',
        signalTime: new Date('2026-04-04T10:00:00.000Z'),
        status: 'Accepted',
        entryPrice: '0.018',
        stopLossPrice: '0.019',
        takeProfitTargets: ['0.016'],
        dedupeKey: 'dedupe-mudrex-not-required-waiting-for-position',
        meta: null,
        createdAt: new Date('2026-04-04T10:00:00.000Z'),
        updatedAt: new Date('2026-04-04T10:00:00.000Z'),
      },
      {
        executionMode: 'live',
        brokerKey: 'mudrex',
        accountId: 'acc-1',
        orderId: 'mudrex-order-not-required-waiting-for-position',
        executionState: 'filled',
        orderStatus: 'FILLED',
        entryPrice: '0.018',
        stopLossPrice: '0.019',
        takeProfitPrice: '0.016',
        protectionState: 'not_required',
        protectionAttempts: 0,
      },
      []
    );

    assert.equal(riskOrderCalled, false);
    assert.equal(nextExecution.protectionState, 'waiting_for_position');
    assert.equal(nextExecution.protectionLastError, null);
    assert.ok(nextExecution.protectionCheckedAt);
  }

  {
    const service = new SuggestedTradesService() as any;
    let riskOrderPositionId: string | null = null;
    service.brokerRuntimeRegistry = {
      getPositionsAdapter() {
        return {
          async createRiskOrder(positionId: string) {
            riskOrderPositionId = positionId;
            return {};
          },
        };
      },
    };

    const nextExecution = await service.maybeRemediateLiveProtection(
      'user-1',
      {
        id: 'st-mudrex-stale-closed-position-link',
        automationId: 'auto-1',
        automationRunId: 'run-1',
        userId: 'user-1',
        symbol: 'GOATUSDT',
        timeframe: '5m',
        side: 'SELL',
        signalTime: new Date('2026-04-04T10:00:00.000Z'),
        status: 'Accepted',
        entryPrice: '0.018',
        stopLossPrice: '0.019',
        takeProfitTargets: ['0.016'],
        dedupeKey: 'dedupe-mudrex-stale-closed-position-link',
        meta: null,
        createdAt: new Date('2026-04-04T10:00:00.000Z'),
        updatedAt: new Date('2026-04-04T10:00:00.000Z'),
      },
      {
        executionMode: 'live',
        brokerKey: 'mudrex',
        accountId: 'acc-1',
        orderId: 'mudrex-order-stale-closed-position-link',
        executionState: 'closed',
        orderStatus: 'FILLED',
        submittedAt: '2026-04-04T10:00:00.000Z',
        positionId: 'mudrex:asset-1:2026-04-03T06:00:00Z:SHORT',
        positionStatus: 'CLOSED',
        positionClosedAt: '2026-04-03T06:30:00.000Z',
        outcome: 'loss',
        entryPrice: '0.018',
        stopLossPrice: '0.019',
        takeProfitPrice: '0.016',
        protectionState: 'not_required',
        protectionAttempts: 0,
      },
      [
        {
          externalId: 'mudrex:asset-1:2026-04-03T06:00:00Z:SHORT',
          status: 'CLOSED',
          statusRank: 9,
          firstSeenAt: '2026-04-03T06:00:00.000Z',
          lastSeenAt: '2026-04-04T10:01:00.000Z',
          payload: {
            id: 'mudrex-native-position-stale-closed',
            status: 'closed',
            order_type: 'SHORT',
            entry_price: '0.018',
            quantity: '100',
            created_at: '2026-04-03T06:00:00.000Z',
            closed_at: '2026-04-03T06:30:00.000Z',
            updated_at: '2026-04-04T10:01:00.000Z',
          },
        },
        {
          externalId: 'mudrex:asset-1:2026-04-04T10:03:05Z:SHORT',
          status: 'OPEN',
          statusRank: 2,
          firstSeenAt: '2026-04-04T10:03:05.000Z',
          lastSeenAt: '2026-04-04T10:03:05.000Z',
          payload: {
            id: 'mudrex-native-position-current-open',
            status: 'open',
            order_type: 'SHORT',
            entry_price: '0.0182',
            current_price: '0.0182',
            liquidation_price: '0.021',
            quantity: '100',
            created_at: '2026-04-04T10:03:05.000Z',
            updated_at: '2026-04-04T10:03:05.000Z',
          },
        },
      ]
    );

    assert.equal(riskOrderPositionId, 'mudrex-native-position-current-open');
    assert.equal(nextExecution.protectionState, 'attached');
    assert.equal(nextExecution.protectionLastError, null);
  }

  {
    const service = new SuggestedTradesService() as any;
    const closedPositions: string[] = [];
    service.brokerRuntimeRegistry = {
      getPositionsAdapter() {
        return {
          async createRiskOrder() {
            throw new Error('breached SL must not create Mudrex protection');
          },
          async closePosition(positionId: string) {
            closedPositions.push(positionId);
            return { success: true };
          },
        };
      },
    };

    const nextExecution = await service.maybeRemediateLiveProtection(
      'user-1',
      {
        id: 'st-mudrex-not-required-open-position-breached',
        automationId: 'auto-1',
        automationRunId: 'run-1',
        userId: 'user-1',
        symbol: 'GOATUSDT',
        timeframe: '5m',
        side: 'SELL',
        signalTime: new Date('2026-04-04T10:00:00.000Z'),
        status: 'Accepted',
        entryPrice: '0.018',
        stopLossPrice: '0.019',
        takeProfitTargets: ['0.016'],
        dedupeKey: 'dedupe-mudrex-not-required-open-position-breached',
        meta: null,
        createdAt: new Date('2026-04-04T10:00:00.000Z'),
        updatedAt: new Date('2026-04-04T10:00:00.000Z'),
      },
      {
        executionMode: 'live',
        brokerKey: 'mudrex',
        accountId: 'acc-1',
        orderId: 'mudrex-order-not-required-open-position-breached',
        executionState: 'filled',
        orderStatus: 'FILLED',
        positionStatus: 'OPEN',
        positionClosedAt: '2026-04-03T06:30:00.000Z',
        entryPrice: '0.018',
        stopLossPrice: '0.019',
        takeProfitPrice: '0.016',
        protectionState: 'not_required',
        protectionAttempts: 0,
      },
      [
        {
          externalId: 'mudrex:asset-1:2026-04-04T10:03:05Z:SHORT',
          status: 'OPEN',
          statusRank: 2,
          firstSeenAt: '2026-04-04T10:03:05.000Z',
          lastSeenAt: '2026-04-04T10:03:05.000Z',
          payload: {
            id: 'mudrex-native-position-current-open-breached',
            status: 'open',
            order_type: 'SHORT',
            entry_price: '0.0182',
            current_price: '0.0195',
            liquidation_price: '0.021',
            quantity: '100',
            created_at: '2026-04-04T10:03:05.000Z',
            updated_at: '2026-04-04T10:03:05.000Z',
          },
        },
      ]
    );

    assert.equal(nextExecution.executionState, 'closed');
    assert.equal(nextExecution.positionStatus, 'CLOSED');
    assert.equal(nextExecution.protectionState, 'not_required');
    assert.equal(nextExecution.protectionLastError, null);
    assert.match(String(nextExecution.note || ''), /already breached/);
    assert.match(String(nextExecution.note || ''), /closed immediately/);
    assert.deepEqual(closedPositions, ['mudrex-native-position-current-open-breached']);

    const persisted = service.toExecutionPersistencePayload(
      {
        id: 'st-mudrex-not-required-open-position-breached',
        automationId: 'auto-1',
        automationRunId: 'run-1',
        userId: 'user-1',
        symbol: 'GOATUSDT',
        timeframe: '5m',
        side: 'SELL',
        signalTime: new Date('2026-04-04T10:00:00.000Z'),
        status: 'Accepted',
        confidence: null,
        score: null,
        entryPrice: '0.018',
        stopLossPrice: '0.019',
        takeProfitTargets: ['0.016'],
        entryRule: null,
        exitRule: null,
        rationale: null,
        dedupeKey: 'dedupe-mudrex-not-required-open-position-breached',
        meta: null,
        createdAt: new Date('2026-04-04T10:00:00.000Z'),
        updatedAt: new Date('2026-04-04T10:00:00.000Z'),
      },
      {
        executionMode: 'live',
        brokerKey: 'mudrex',
        accountId: 'acc-1',
        orderId: 'mudrex-order-not-required-open-position-breached',
        executionState: 'filled',
        orderStatus: 'FILLED',
        positionStatus: 'OPEN',
        positionClosedAt: '2026-04-03T06:30:00.000Z',
        entryPrice: '0.018',
        stopLossPrice: '0.019',
        takeProfitPrice: '0.016',
        protectionState: 'manual_unlinked',
        protectionLastError: 'Mudrex protection needs manual action.',
      }
    );
    assert.equal(persisted.protectionState, 'manual_unlinked');
    assert.equal(persisted.protectionLastError, 'Mudrex protection needs manual action.');
  }

  {
    const service = new SuggestedTradesService() as any;
    const closedPositions: string[] = [];
    service.brokerRuntimeRegistry = {
      getPositionsAdapter() {
        return {
          async createRiskOrder() {
            throw new Error('exhausted breached Mudrex protection must not retry broker order');
          },
          async closePosition(positionId: string) {
            closedPositions.push(positionId);
            return { success: true };
          },
        };
      },
    };

    const nextExecution = await service.maybeRemediateLiveProtection(
      'user-1',
      {
        id: 'st-mudrex-failed-open-position-breached',
        automationId: 'auto-1',
        automationRunId: 'run-1',
        userId: 'user-1',
        symbol: 'GOATUSDT',
        timeframe: '5m',
        side: 'SELL',
        signalTime: new Date('2026-04-04T10:00:00.000Z'),
        status: 'Accepted',
        entryPrice: '0.018',
        stopLossPrice: '0.019',
        takeProfitTargets: ['0.016'],
        dedupeKey: 'dedupe-mudrex-failed-open-position-breached',
        meta: null,
        createdAt: new Date('2026-04-04T10:00:00.000Z'),
        updatedAt: new Date('2026-04-04T10:00:00.000Z'),
      },
      {
        executionMode: 'live',
        brokerKey: 'mudrex',
        accountId: 'acc-1',
        orderId: 'mudrex-order-failed-open-position-breached',
        executionState: 'filled',
        orderStatus: 'FILLED',
        positionStatus: 'OPEN',
        entryPrice: '0.018',
        stopLossPrice: '0.019',
        takeProfitPrice: '0.016',
        protectionState: 'failed',
        protectionAttempts: 8,
        protectionLastError: 'Mudrex protection remediation failed: bad request',
      },
      [
        {
          externalId: 'mudrex:asset-1:2026-04-04T10:03:05Z:SHORT',
          status: 'OPEN',
          statusRank: 2,
          firstSeenAt: '2026-04-04T10:03:05.000Z',
          lastSeenAt: '2026-04-04T10:03:05.000Z',
          payload: {
            id: 'mudrex-native-position-failed-breached',
            status: 'open',
            order_type: 'SHORT',
            entry_price: '0.0182',
            current_price: '0.0195',
            liquidation_price: '0.021',
            quantity: '100',
            created_at: '2026-04-04T10:03:05.000Z',
            updated_at: '2026-04-04T10:03:05.000Z',
          },
        },
      ]
    );

    assert.equal(nextExecution.executionState, 'closed');
    assert.equal(nextExecution.positionStatus, 'CLOSED');
    assert.equal(nextExecution.protectionState, 'not_required');
    assert.equal(nextExecution.protectionLastError, null);
    assert.match(String(nextExecution.note || ''), /already breached/);
    assert.match(String(nextExecution.note || ''), /closed immediately/);
    assert.deepEqual(closedPositions, ['mudrex-native-position-failed-breached']);
  }

  {
    const service = new SuggestedTradesService() as any;
    service.resolveLiveProtectionOrderContext = async () => ({
      stopLossOrderId: 'delta-sl-manual-1',
      takeProfitOrderId: 'delta-tp-manual-1',
      stopLossStatus: 'OPEN',
      takeProfitStatus: 'OPEN',
      activeOrderIds: ['delta-sl-manual-1', 'delta-tp-manual-1'],
    });
    service.resolveActiveDeltaProtectionOrdersForSymbol = async () => ({
      stopLossOrderIds: ['delta-sl-manual-1'],
      takeProfitOrderIds: ['delta-tp-manual-1'],
      unclassifiedOrderIds: [],
      activeOrderIds: ['delta-sl-manual-1', 'delta-tp-manual-1'],
    });
    service.brokerRuntimeRegistry = {
      getOrdersAdapter() {
        return {
          async createLiveAutoProtectiveOrdersForPosition() {
            throw new Error('manual Delta recovery must not create new protection orders');
          },
        };
      },
    };

    const nextExecution = await service.maybeRemediateLiveProtection(
      'user-1',
      {
        id: 'st-delta-manual-recovered',
        automationId: 'auto-1',
        automationRunId: 'run-1',
        userId: 'user-1',
        symbol: 'BTCUSDT',
        timeframe: '5m',
        side: 'BUY',
        signalTime: new Date('2026-04-04T10:00:00.000Z'),
        status: 'Accepted',
        entryPrice: '100',
        stopLossPrice: '95',
        takeProfitTargets: ['110'],
        dedupeKey: 'dedupe-delta-manual-recovered',
        meta: null,
        createdAt: new Date('2026-04-04T10:00:00.000Z'),
        updatedAt: new Date('2026-04-04T10:00:00.000Z'),
      },
      {
        executionMode: 'live',
        brokerKey: 'delta_exchange',
        accountId: 'acc-1',
        orderId: 'delta-entry-manual-recovered',
        executionState: 'filled',
        orderStatus: 'CLOSED',
        entryPrice: '100',
        stopLossPrice: '95',
        takeProfitPrice: '110',
        protectionState: 'manual_unlinked',
        protectionAttempts: 1,
        protectionLastError: 'Delta Exchange protection is still not linked.',
      },
      [
        {
          externalId: 'delta:btc-position-1',
          status: 'OPEN',
          statusRank: 2,
          firstSeenAt: '2026-04-04T10:03:05.000Z',
          lastSeenAt: '2026-04-04T10:03:05.000Z',
          payload: {
            product_symbol: 'BTCUSDT',
            side: 'long',
            entry_price: '100',
            size: '1',
            created_at: '2026-04-04T10:03:05.000Z',
            updated_at: '2026-04-04T10:03:05.000Z',
          },
        },
      ]
    );

    assert.equal(nextExecution.protectionState, 'attached');
    assert.equal(nextExecution.protectionAttempts, 1);
    assert.equal(nextExecution.protectionLastError, null);
    assert.equal(
      (nextExecution.protectionPlan as Record<string, unknown> | undefined)?.stopLossOrderId,
      'delta-sl-manual-1'
    );
  }

  {
    const originalDeltaRepairEnabled = env.suggestedTrades.protectionRepair.deltaExchangeEnabled;
    const originalDeltaRepairEnv =
      process.env.SUGGESTED_TRADES_PROTECTION_REPAIR_DELTA_EXCHANGE_ENABLED;
    const service = new SuggestedTradesService() as any;
    let createProtectionCalled = false;
    service.resolveLiveProtectionOrderContext = async () => ({
      stopLossOrderId: null,
      takeProfitOrderId: null,
      stopLossStatus: null,
      takeProfitStatus: null,
      activeOrderIds: [],
    });
    service.resolveLiveAutoAssetRoute = async () => ({
      assetId: 'delta-asset-1',
      requestedSymbol: 'BTCUSDT',
      brokerSymbol: 'BTCUSDT',
      candidateSymbols: ['BTCUSDT'],
      resolvedVia: 'catalog_exact',
    });
    service.resolveActiveDeltaProtectionOrdersForSymbol = async () => ({
      stopLossOrderIds: [],
      takeProfitOrderIds: [],
      unclassifiedOrderIds: [],
      activeOrderIds: [],
    });
    service.brokerRuntimeRegistry = {
      getOrdersAdapter() {
        return {
          async createLiveAutoProtectiveOrdersForPosition() {
            createProtectionCalled = true;
            throw new Error('disabled Delta protection repair must not place replacement orders');
          },
        };
      },
    };

    try {
      env.suggestedTrades.protectionRepair.deltaExchangeEnabled = false;
      process.env.SUGGESTED_TRADES_PROTECTION_REPAIR_DELTA_EXCHANGE_ENABLED = 'false';
      const nextExecution = await service.maybeRemediateLiveProtection(
        'user-1',
        {
          id: 'st-delta-repair-control-disabled',
          automationId: 'auto-1',
          automationRunId: 'run-1',
          userId: 'user-1',
          symbol: 'BTCUSDT',
          timeframe: '5m',
          side: 'BUY',
          signalTime: new Date('2026-04-04T10:00:00.000Z'),
          status: 'Accepted',
          entryPrice: '100',
          stopLossPrice: '95',
          takeProfitTargets: ['110'],
          dedupeKey: 'dedupe-delta-repair-control-disabled',
          meta: null,
          createdAt: new Date('2026-04-04T10:00:00.000Z'),
          updatedAt: new Date('2026-04-04T10:00:00.000Z'),
        },
        {
          executionMode: 'live',
          brokerKey: 'delta_exchange',
          accountId: 'delta-acc-1',
          orderId: 'delta-entry-repair-control-disabled',
          executionState: 'filled',
          orderStatus: 'CLOSED',
          entryPrice: '100',
          stopLossPrice: '95',
          takeProfitPrice: '110',
          protectionState: 'waiting_for_position',
          protectionAttempts: 0,
        },
        [
          {
            externalId: 'delta:btc-position-repair-disabled',
            status: 'OPEN',
            statusRank: 2,
            firstSeenAt: '2026-04-04T10:03:05.000Z',
            lastSeenAt: '2026-04-04T10:03:05.000Z',
            payload: {
              product_symbol: 'BTCUSDT',
              side: 'long',
              entry_price: '100',
              current_price: '100',
              size: '1',
              created_at: '2026-04-04T10:03:05.000Z',
              updated_at: '2026-04-04T10:03:05.000Z',
            },
          },
        ]
      );

      assert.equal(createProtectionCalled, false);
      assert.equal(nextExecution.protectionState, 'manual_unlinked');
      assert.match(
        String(nextExecution.protectionLastError || ''),
        /Delta Exchange automatic SL\/TP protection repair is disabled/
      );
    } finally {
      env.suggestedTrades.protectionRepair.deltaExchangeEnabled = originalDeltaRepairEnabled;
      restoreEnv(
        'SUGGESTED_TRADES_PROTECTION_REPAIR_DELTA_EXCHANGE_ENABLED',
        originalDeltaRepairEnv
      );
    }
  }

  {
    const service = new SuggestedTradesService() as any;
    let createProtectionCalled = false;
    service.resolveLiveProtectionOrderContext = async () => ({
      stopLossOrderId: 'delta-sl-active',
      takeProfitOrderId: 'delta-tp-active',
      stopLossStatus: 'PENDING',
      takeProfitStatus: 'OPEN',
      activeOrderIds: ['delta-sl-active', 'delta-tp-active'],
    });
    service.resolveActiveDeltaProtectionOrdersForSymbol = async () => ({
      stopLossOrderIds: ['delta-sl-active'],
      takeProfitOrderIds: ['delta-tp-active'],
      unclassifiedOrderIds: [],
      activeOrderIds: ['delta-sl-active', 'delta-tp-active'],
    });
    service.brokerRuntimeRegistry = {
      getOrdersAdapter() {
        return {
          async createLiveAutoProtectiveOrdersForPosition() {
            createProtectionCalled = true;
            throw new Error('attached active validation must not place replacement orders');
          },
        };
      },
    };

    const execution = {
      executionMode: 'live',
      brokerKey: 'delta_exchange',
      accountId: 'delta-acc-1',
      orderId: 'delta-attached-active-entry',
      executionState: 'filled',
      orderStatus: 'CLOSED',
      entryPrice: '100',
      stopLossPrice: '95',
      takeProfitPrice: '110',
      protectionState: 'attached',
      protectionAttempts: 0,
      protectionCheckedAt: '2026-04-04T10:04:00.000Z',
    };
    const nextExecution = await service.maybeRemediateLiveProtection(
      'user-1',
      {
        id: 'st-delta-attached-active',
        automationId: 'auto-1',
        automationRunId: 'run-1',
        userId: 'user-1',
        symbol: 'BTCUSDT',
        timeframe: '5m',
        side: 'BUY',
        signalTime: new Date('2026-04-04T10:00:00.000Z'),
        status: 'Accepted',
        entryPrice: '100',
        stopLossPrice: '95',
        takeProfitTargets: ['110'],
        dedupeKey: 'dedupe-delta-attached-active',
        meta: null,
        createdAt: new Date('2026-04-04T10:00:00.000Z'),
        updatedAt: new Date('2026-04-04T10:00:00.000Z'),
      },
      execution,
      [
        {
          externalId: 'delta:btc-attached-active',
          status: 'OPEN',
          statusRank: 2,
          firstSeenAt: '2026-04-04T10:03:05.000Z',
          lastSeenAt: '2026-04-04T10:03:05.000Z',
          payload: {
            status: 'open',
            side: 'Long',
            entry_price: '100',
            mark_price: '101',
            quantity_contracts: '1',
          },
        },
      ]
    );

    assert.equal(createProtectionCalled, false);
    assert.deepEqual(nextExecution, execution);
  }

  {
    const service = new SuggestedTradesService() as any;
    let createProtectionCalled = false;
    service.resolveLiveProtectionOrderContext = async () => ({
      stopLossOrderId: 'delta-sl-linked',
      takeProfitOrderId: 'delta-tp-linked',
      stopLossStatus: 'PENDING',
      takeProfitStatus: 'OPEN',
      activeOrderIds: ['delta-sl-linked', 'delta-tp-linked'],
    });
    service.resolveActiveDeltaProtectionOrdersForSymbol = async () => ({
      stopLossOrderIds: ['delta-sl-linked', 'delta-sl-extra'],
      takeProfitOrderIds: ['delta-tp-linked', 'delta-tp-extra'],
      unclassifiedOrderIds: [],
      activeOrderIds: ['delta-sl-linked', 'delta-tp-linked', 'delta-sl-extra', 'delta-tp-extra'],
    });
    service.brokerRuntimeRegistry = {
      getOrdersAdapter() {
        return {
          async createLiveAutoProtectiveOrdersForPosition() {
            createProtectionCalled = true;
            throw new Error('attached duplicate validation must not place replacement orders');
          },
        };
      },
    };

    const nextExecution = await service.maybeRemediateLiveProtection(
      'user-1',
      {
        id: 'st-delta-attached-duplicate-active',
        automationId: 'auto-1',
        automationRunId: 'run-1',
        userId: 'user-1',
        symbol: 'CROSSUSDT',
        timeframe: '5m',
        side: 'SELL',
        signalTime: new Date('2026-04-04T10:00:00.000Z'),
        status: 'Accepted',
        entryPrice: '0.105765',
        stopLossPrice: '0.107121129922',
        takeProfitTargets: ['0.101696610234'],
        dedupeKey: 'dedupe-delta-attached-duplicate-active',
        meta: null,
        createdAt: new Date('2026-04-04T10:00:00.000Z'),
        updatedAt: new Date('2026-04-04T10:00:00.000Z'),
      },
      {
        executionMode: 'live',
        brokerKey: 'delta_exchange',
        accountId: 'delta-acc-1',
        orderId: 'delta-attached-duplicate-entry',
        executionState: 'filled',
        orderStatus: 'CLOSED',
        entryPrice: '0.105765',
        stopLossPrice: '0.107121129922',
        takeProfitPrice: '0.101696610234',
        protectionState: 'attached',
        protectionAttempts: 0,
      },
      [
        {
          externalId: '84924',
          status: 'OPEN',
          statusRank: 2,
          firstSeenAt: '2026-04-04T10:03:05.000Z',
          lastSeenAt: '2026-04-04T10:03:05.000Z',
          payload: {
            id: '84924',
            product_symbol: 'CROSSUSD',
            status: 'open',
            side: 'Short',
            entry_price: '0.10485',
            mark_price: '0.1045',
            quantity_contracts: '100',
          },
        },
      ]
    );

    assert.equal(createProtectionCalled, false);
    assert.equal(nextExecution.protectionState, 'manual_unlinked');
    assert.match(String(nextExecution.protectionLastError || ''), /extra or unclassified/);
    assert.match(String(nextExecution.protectionLastError || ''), /manual cleanup is required/);
  }

  {
    const service = new SuggestedTradesService() as any;
    let createProtectionCalled = false;
    service.resolveLiveProtectionOrderContext = async () => ({
      stopLossOrderId: 'delta-sl-linked',
      takeProfitOrderId: 'delta-tp-linked',
      stopLossStatus: 'PENDING',
      takeProfitStatus: 'OPEN',
      activeOrderIds: ['delta-sl-linked', 'delta-tp-linked'],
    });
    service.resolveActiveDeltaProtectionOrdersForSymbol = async () => ({
      stopLossOrderIds: ['delta-sl-linked', 'delta-sl-extra'],
      takeProfitOrderIds: ['delta-tp-linked', 'delta-tp-extra'],
      unclassifiedOrderIds: [],
      activeOrderIds: ['delta-sl-linked', 'delta-tp-linked', 'delta-sl-extra', 'delta-tp-extra'],
    });
    service.brokerRuntimeRegistry = {
      getOrdersAdapter() {
        return {
          async createLiveAutoProtectiveOrdersForPosition() {
            createProtectionCalled = true;
            throw new Error('manual duplicate recovery must not place replacement orders');
          },
        };
      },
    };

    const nextExecution = await service.maybeRemediateLiveProtection(
      'user-1',
      {
        id: 'st-delta-manual-duplicate-active',
        automationId: 'auto-1',
        automationRunId: 'run-1',
        userId: 'user-1',
        symbol: 'CROSSUSDT',
        timeframe: '5m',
        side: 'SELL',
        signalTime: new Date('2026-04-04T10:00:00.000Z'),
        status: 'Accepted',
        entryPrice: '0.105765',
        stopLossPrice: '0.107121129922',
        takeProfitTargets: ['0.101696610234'],
        dedupeKey: 'dedupe-delta-manual-duplicate-active',
        meta: null,
        createdAt: new Date('2026-04-04T10:00:00.000Z'),
        updatedAt: new Date('2026-04-04T10:00:00.000Z'),
      },
      {
        executionMode: 'live',
        brokerKey: 'delta_exchange',
        accountId: 'delta-acc-1',
        orderId: 'delta-manual-duplicate-entry',
        executionState: 'filled',
        orderStatus: 'CLOSED',
        entryPrice: '0.105765',
        stopLossPrice: '0.107121129922',
        takeProfitPrice: '0.101696610234',
        protectionState: 'manual_unlinked',
        protectionAttempts: 0,
        protectionLastError:
          'Delta Exchange linked SL/TP pair is active, but extra reduce-only protection also exists.',
      },
      [
        {
          externalId: '84924',
          status: 'OPEN',
          statusRank: 2,
          firstSeenAt: '2026-04-04T10:03:05.000Z',
          lastSeenAt: '2026-04-04T10:03:05.000Z',
          payload: {
            id: '84924',
            product_symbol: 'CROSSUSD',
            status: 'open',
            side: 'Short',
            entry_price: '0.10485',
            mark_price: '0.1045',
            quantity_contracts: '100',
          },
        },
      ]
    );

    assert.equal(createProtectionCalled, false);
    assert.equal(nextExecution.protectionState, 'manual_unlinked');
    assert.match(String(nextExecution.protectionLastError || ''), /extra or unclassified/);
    assert.match(String(nextExecution.protectionLastError || ''), /manual cleanup is required/);
  }

  {
    const service = new SuggestedTradesService() as any;
    let createProtectionCalled = false;
    service.resolveLiveProtectionOrderContext = async () => ({
      stopLossOrderId: 'delta-sl-cancelled',
      takeProfitOrderId: 'delta-tp-cancelled',
      stopLossStatus: 'CANCELLED',
      takeProfitStatus: 'CANCELLED',
      activeOrderIds: [],
    });
    service.brokerRuntimeRegistry = {
      getOrdersAdapter() {
        return {
          async createLiveAutoProtectiveOrdersForPosition() {
            createProtectionCalled = true;
            throw new Error('phase 3 validation must not place replacement orders');
          },
        };
      },
    };

    const nextExecution = await service.maybeRemediateLiveProtection(
      'user-1',
      {
        id: 'st-delta-attached-cancelled-safe',
        automationId: 'auto-1',
        automationRunId: 'run-1',
        userId: 'user-1',
        symbol: 'EVAAUSDT',
        timeframe: '5m',
        side: 'SELL',
        signalTime: new Date('2026-04-04T10:00:00.000Z'),
        status: 'Accepted',
        entryPrice: '0.60595',
        stopLossPrice: '0.623769828915',
        takeProfitTargets: ['0.552490513254'],
        dedupeKey: 'dedupe-delta-attached-cancelled-safe',
        meta: null,
        createdAt: new Date('2026-04-04T10:00:00.000Z'),
        updatedAt: new Date('2026-04-04T10:00:00.000Z'),
      },
      {
        executionMode: 'live',
        brokerKey: 'delta_exchange',
        accountId: 'delta-acc-1',
        orderId: 'delta-attached-cancelled-safe-entry',
        executionState: 'filled',
        orderStatus: 'CLOSED',
        entryPrice: '0.60595',
        stopLossPrice: '0.623769828915',
        takeProfitPrice: '0.552490513254',
        protectionState: 'attached',
        protectionAttempts: 0,
      },
      [
        {
          externalId: 'delta:evaa-open',
          status: 'OPEN',
          statusRank: 2,
          firstSeenAt: '2026-04-04T10:03:05.000Z',
          lastSeenAt: '2026-04-04T10:03:05.000Z',
          payload: {
            status: 'open',
            side: 'Short',
            entry_price: '0.606',
            mark_price: '0.6111',
            quantity_contracts: '156',
          },
        },
      ]
    );

    assert.equal(createProtectionCalled, false);
    assert.equal(nextExecution.protectionState, 'failed');
    assert.equal(nextExecution.protectionAttempts, 1);
    assert.match(String(nextExecution.protectionLastError || ''), /inactive or missing/);
    assert.match(String(nextExecution.protectionLastError || ''), /replacement protection/);
  }

  {
    const service = new SuggestedTradesService() as any;
    let createProtectionCalled = false;
    const closedPositions: Array<{ positionId: string; context?: Record<string, unknown> }> = [];
    service.resolveLiveProtectionOrderContext = async () => ({
      stopLossOrderId: 'delta-sl-crossed',
      takeProfitOrderId: 'delta-tp-crossed',
      stopLossStatus: 'CANCELLED',
      takeProfitStatus: 'CANCELLED',
      activeOrderIds: [],
    });
    service.brokerRuntimeRegistry = {
      getOrdersAdapter() {
        return {
          async createLiveAutoProtectiveOrdersForPosition() {
            createProtectionCalled = true;
            throw new Error('crossed stop validation must not place replacement orders');
          },
        };
      },
      getPositionsAdapter() {
        return {
          async closePosition(positionId: string, context?: Record<string, unknown>) {
            closedPositions.push({ positionId, context });
            return { order_id: 'delta-auto-close-crossed', status: 'open' };
          },
        };
      },
    };

    const nextExecution = await service.maybeRemediateLiveProtection(
      'user-1',
      {
        id: 'st-delta-attached-cancelled-crossed',
        automationId: 'auto-1',
        automationRunId: 'run-1',
        userId: 'user-1',
        symbol: 'SUSDT',
        timeframe: '5m',
        side: 'BUY',
        signalTime: new Date('2026-04-04T10:00:00.000Z'),
        status: 'Accepted',
        entryPrice: '0.0453',
        stopLossPrice: '0.044913490607',
        takeProfitTargets: ['0.046459528178'],
        dedupeKey: 'dedupe-delta-attached-cancelled-crossed',
        meta: null,
        createdAt: new Date('2026-04-04T10:00:00.000Z'),
        updatedAt: new Date('2026-04-04T10:00:00.000Z'),
      },
      {
        executionMode: 'live',
        brokerKey: 'delta_exchange',
        accountId: 'delta-acc-1',
        orderId: 'delta-attached-cancelled-crossed-entry',
        executionState: 'filled',
        orderStatus: 'CLOSED',
        entryPrice: '0.0453',
        stopLossPrice: '0.044913490607',
        takeProfitPrice: '0.046459528178',
        protectionState: 'attached',
        protectionAttempts: 0,
      },
      [
        {
          externalId: 'delta:s-open',
          status: 'OPEN',
          statusRank: 2,
          firstSeenAt: '2026-04-04T10:03:05.000Z',
          lastSeenAt: '2026-04-04T10:03:05.000Z',
          payload: {
            status: 'open',
            side: 'Long',
            entry_price: '0.0453',
            mark_price: '0.0448',
            quantity_contracts: '209',
          },
        },
      ]
    );

    assert.equal(createProtectionCalled, false);
    assert.equal(closedPositions.length, 1);
    assert.equal(closedPositions[0]?.positionId, 'delta:s-open');
    assert.equal(nextExecution.executionState, 'closed');
    assert.equal(nextExecution.positionStatus, 'CLOSED');
    assert.equal(nextExecution.protectionState, 'not_required');
    assert.equal(nextExecution.protectionAttempts, 0);
    assert.equal(nextExecution.protectionLastError, null);
    assert.equal(
      ((nextExecution.protectionPlan ?? {}) as Record<string, unknown>).autoCloseReason,
      'unsafe_protection_already_crossed'
    );
  }

  {
    const service = new SuggestedTradesService() as any;
    const nextExecution = await service.maybeRemediateLiveProtection(
      'user-1',
      {
        id: 'st-terminal-manual-protection',
        automationId: 'auto-1',
        automationRunId: 'run-1',
        userId: 'user-1',
        symbol: 'GOATUSDT',
        timeframe: '5m',
        side: 'SELL',
        signalTime: new Date('2026-04-04T10:00:00.000Z'),
        status: 'Accepted',
        entryPrice: '0.018',
        stopLossPrice: '0.019',
        takeProfitTargets: ['0.016'],
        dedupeKey: 'dedupe-terminal-manual-protection',
        meta: null,
        createdAt: new Date('2026-04-04T10:00:00.000Z'),
        updatedAt: new Date('2026-04-04T10:00:00.000Z'),
      },
      {
        executionMode: 'live',
        brokerKey: 'mudrex',
        accountId: 'acc-1',
        orderId: 'mudrex-order-terminal',
        executionState: 'closed',
        positionStatus: 'LIQUIDATED',
        positionClosedAt: '2026-04-04T10:10:00.000Z',
        entryPrice: '0.018',
        stopLossPrice: '0.019',
        takeProfitPrice: '0.016',
        protectionState: 'manual_unlinked',
        protectionAttempts: 2,
        protectionLastError: 'Mudrex protection needs manual action.',
      },
      []
    );

    assert.equal(nextExecution.protectionState, 'not_required');
    assert.equal(nextExecution.protectionLastError, null);
    assert.match(String(nextExecution.note || ''), /Terminal execution no longer requires/);

    const persisted = service.toExecutionPersistencePayload(
      {
        id: 'st-terminal-manual-protection',
        automationId: 'auto-1',
        automationRunId: 'run-1',
        userId: 'user-1',
        symbol: 'GOATUSDT',
        timeframe: '5m',
        side: 'SELL',
        signalTime: new Date('2026-04-04T10:00:00.000Z'),
        status: 'Accepted',
        confidence: null,
        score: null,
        entryPrice: '0.018',
        stopLossPrice: '0.019',
        takeProfitTargets: ['0.016'],
        entryRule: null,
        exitRule: null,
        rationale: null,
        dedupeKey: 'dedupe-terminal-manual-protection',
        meta: null,
        createdAt: new Date('2026-04-04T10:00:00.000Z'),
        updatedAt: new Date('2026-04-04T10:00:00.000Z'),
      },
      {
        executionMode: 'live',
        executionState: 'closed',
        positionStatus: 'LIQUIDATED',
        stopLossPrice: '0.019',
        takeProfitPrice: '0.016',
        protectionState: 'manual_unlinked',
        protectionLastError: 'stale manual action',
      }
    );
    assert.equal(persisted.protectionState, 'not_required');
    assert.equal(persisted.protectionLastError, null);
  }

  {
    const service = new SuggestedTradesService() as any;
    let deltaAttachBody: Record<string, unknown> | null = null;
    service.resolveLiveProtectionOrderContext = async () => ({
      stopLossOrderId: null,
      takeProfitOrderId: null,
      stopLossStatus: null,
      takeProfitStatus: null,
      activeOrderIds: [],
    });
    service.resolveLiveAutoAssetRoute = async () => ({
      assetId: '45678',
      requestedSymbol: 'BTCUSDT',
      brokerSymbol: 'BTCUSDT',
      candidateSymbols: ['BTCUSDT'],
      resolvedVia: 'catalog_exact',
    });
    service.resolveActiveDeltaProtectionOrdersForSymbol = async () => ({
      stopLossOrderIds: [],
      takeProfitOrderIds: [],
      unclassifiedOrderIds: [],
      activeOrderIds: [],
    });
    service.brokerRuntimeRegistry = {
      getOrdersAdapter() {
        return {
          async createLiveAutoProtectiveOrdersForPosition(
            assetId: string,
            body: Record<string, unknown>,
            context?: Record<string, unknown>
          ) {
            assert.equal(assetId, '45678');
            assert.equal(context?.brokerKey, 'delta_exchange');
            deltaAttachBody = { ...body };
            return {
              protection_status: 'attached',
              stop_loss_order_id: 'delta-sl-1',
              take_profit_order_id: 'delta-tp-1',
            };
          },
        };
      },
    };

    const nextExecution = await service.maybeRemediateLiveProtection(
      'user-1',
      {
        id: 'st-delta-protection-remediate',
        automationId: 'auto-1',
        automationRunId: 'run-1',
        userId: 'user-1',
        symbol: 'BTCUSDT',
        timeframe: '5m',
        side: 'BUY',
        signalTime: new Date('2026-04-04T10:00:00.000Z'),
        status: 'Accepted',
        entryPrice: '100',
        stopLossPrice: '95',
        takeProfitTargets: ['110'],
        dedupeKey: 'dedupe-delta-protection-remediate',
        meta: null,
        createdAt: new Date('2026-04-04T10:00:00.000Z'),
        updatedAt: new Date('2026-04-04T10:00:00.000Z'),
      },
      {
        executionMode: 'live',
        brokerKey: 'delta_exchange',
        accountId: 'delta-acc-1',
        orderId: 'delta-order-1',
        executionState: 'filled',
        orderStatus: 'FILLED',
        entryPrice: '100',
        stopLossPrice: '95',
        takeProfitPrice: '110',
        filledPrice: '102',
        protectionState: 'failed',
        protectionAttempts: 1,
        protectionLastError:
          'Delta Exchange attached protection is inactive or missing for an open position (SL old-sl CANCELLED, TP old-tp CANCELLED); replacement protection is required before this execution can be marked attached.',
      },
      [
        {
          externalId: '45678',
          status: 'OPEN',
          statusRank: 2,
          firstSeenAt: '2026-04-04T10:03:05.000Z',
          lastSeenAt: '2026-04-04T10:03:05.000Z',
          payload: {
            id: '45678',
            status: 'open',
            side: 'Long',
            entry_price: '102',
            quantity_contracts: '3',
            created_at: '2026-04-04T10:03:05.000Z',
            updated_at: '2026-04-04T10:03:05.000Z',
          },
        },
      ]
    );

    assert.equal(nextExecution.protectionState, 'attaching');
    assert.equal(nextExecution.protectionAttempts, 2);
    assert.equal(nextExecution.protectionAttachedAt, null);
    assert.equal(nextExecution.protectionLastError, null);
    const attachedBody = deltaAttachBody as unknown as Record<string, unknown>;
    assert.equal(attachedBody.size, 3);
    assert.equal(attachedBody.entrySide, 'buy');
    assert.equal(attachedBody.stopLossPrice, 96.9);
    assert.equal(attachedBody.takeProfitPrice, 112.2);
    assert.equal(
      attachedBody.idempotencyKey,
      'live-auto-protection:st-delta-protection-remediate:delta-order-1'
    );
    assert.ok(Number.isFinite(Date.parse(String(nextExecution.protectionCheckedAt))));
    const deltaProtectionPlan = nextExecution.protectionPlan as Record<string, unknown>;
    assert.equal(deltaProtectionPlan.positionId, '45678');
    assert.equal(deltaProtectionPlan.stopLossOrderId, 'delta-sl-1');
    assert.equal(deltaProtectionPlan.takeProfitOrderId, 'delta-tp-1');
    assert.equal(deltaProtectionPlan.replacementSubmittedAt, nextExecution.protectionCheckedAt);
  }

  {
    const service = new SuggestedTradesService() as any;
    let createProtectionCalled = false;
    service.brokerRuntimeRegistry = {
      getOrdersAdapter() {
        return {
          async createLiveAutoProtectiveOrdersForPosition() {
            createProtectionCalled = true;
            throw new Error('stale Delta execution must not protect a newer same-symbol position');
          },
        };
      },
    };

    const trade = {
      id: 'st-delta-stale-position-owner',
      automationId: 'auto-1',
      automationRunId: 'run-1',
      userId: 'user-1',
      symbol: 'TRXUSDT',
      timeframe: '5m',
      side: 'SELL',
      signalTime: new Date('2026-05-05T20:10:00.000Z'),
      status: 'Accepted',
      entryPrice: '0.34395',
      stopLossPrice: '0.34513562002',
      takeProfitTargets: ['0.34037313994'],
      dedupeKey: 'dedupe-delta-stale-position-owner',
      meta: null,
      createdAt: new Date('2026-05-05T20:15:31.000Z'),
      updatedAt: new Date('2026-05-05T20:15:31.000Z'),
    };
    const staleExecution = {
      executionMode: 'live',
      brokerKey: 'delta_exchange',
      accountId: 'delta-acc-1',
      orderId: '1304070143',
      executionState: 'filled',
      orderStatus: 'CLOSED',
      positionId: '20193',
      positionStatus: 'OPEN',
      submittedAt: '2026-05-05T20:15:39.000Z',
      filledAt: '2026-05-05T20:22:58.000Z',
      entryPrice: '0.34395',
      stopLossPrice: '0.34513562002',
      takeProfitPrice: '0.34037313994',
      quantity: 298,
      protectionState: 'failed',
      protectionAttempts: 1,
      protectionLastError:
        'Delta Exchange attached protection is inactive or missing for an open position; replacement protection is required before this execution can be marked attached.',
    };
    const snapshots = [
      {
        externalId: '20193',
        status: 'OPEN',
        statusRank: 1,
        firstSeenAt: '2026-05-06T05:40:58.000Z',
        lastSeenAt: '2026-05-06T05:46:29.000Z',
        payload: {
          id: '20193',
          product_symbol: 'TRXUSD',
          status: 'open',
          side: 'Short',
          entry_price: '0.3442',
          mark_price: '0.3432',
          quantity: '282',
          quantity_contracts: '282',
          created_at: '2026-05-06T05:40:58.000Z',
          updated_at: '2026-05-06T05:46:29.000Z',
        },
      },
      {
        externalId: 'trx-closed-old-position',
        status: 'CLOSED',
        statusRank: 9,
        firstSeenAt: '2026-05-05T20:22:58.000Z',
        lastSeenAt: '2026-05-05T21:44:47.000Z',
        payload: {
          id: 'trx-closed-old-position',
          product_symbol: 'TRXUSD',
          status: 'closed',
          side: 'Short',
          entry_price: '0.34395',
          quantity: '298',
          quantity_contracts: '298',
          created_at: '2026-05-05T20:22:58.000Z',
          closed_at: '2026-05-05T21:44:47.000Z',
          updated_at: '2026-05-05T21:44:47.000Z',
        },
      },
    ];

    const mergedExecution = service.mergePositionOutcome(trade, staleExecution, snapshots);
    assert.equal(mergedExecution.positionId, 'trx-closed-old-position');
    assert.equal(mergedExecution.positionStatus, 'CLOSED');

    const nextExecution = await service.maybeRemediateLiveProtection(
      'user-1',
      trade,
      mergedExecution,
      snapshots
    );

    assert.equal(createProtectionCalled, false);
    assert.equal(nextExecution.protectionState, 'not_required');
    assert.match(String(nextExecution.note || ''), /Terminal execution no longer requires/);
  }

  {
    const service = new SuggestedTradesService() as any;
    const originalQuery = coreDataSource.query;
    let listOpenOrdersCalled = false;
    let createProtectionCalled = false;
    service.resolveLiveProtectionOrderContext = async () => ({
      stopLossOrderId: null,
      takeProfitOrderId: null,
      stopLossStatus: null,
      takeProfitStatus: null,
      activeOrderIds: [],
    });
    service.resolveLiveAutoAssetRoute = async () => ({
      assetId: 'xrp-asset-1',
      requestedSymbol: 'XRPUSDT',
      brokerSymbol: 'XRPUSD',
      candidateSymbols: ['XRPUSDT', 'XRPUSD'],
      resolvedVia: 'catalog_equivalent',
    });
    service.brokerRuntimeRegistry = {
      getOrdersAdapter() {
        return {
          async listOpenOrders() {
            listOpenOrdersCalled = true;
            return [
              {
                id: 'delta-live-sl',
                symbol: 'XRPUSD',
                status: 'pending',
                side: 'sell',
                reduce_only: true,
                stop_order_type: 'stop_loss_order',
                order_type: 'market_order',
              },
              {
                id: 'delta-live-tp',
                symbol: 'XRPUSD',
                status: 'pending',
                side: 'sell',
                reduce_only: true,
                stop_order_type: 'take_profit_order',
                order_type: 'market_order',
              },
            ];
          },
          async createLiveAutoProtectiveOrdersForPosition() {
            createProtectionCalled = true;
            throw new Error('live Delta protection lookup must block duplicate replacement');
          },
        };
      },
    };
    (coreDataSource as any).query = async (sql: string) => {
      if (sql.includes('FROM scheduler_orders_snapshots')) {
        return [];
      }
      throw new Error(`Unexpected query: ${sql}`);
    };

    try {
      const nextExecution = await service.maybeRemediateLiveProtection(
        'user-1',
        {
          id: 'st-delta-live-open-protection-check',
          automationId: 'auto-1',
          automationRunId: 'run-1',
          userId: 'user-1',
          symbol: 'XRPUSDT',
          timeframe: '5m',
          side: 'BUY',
          signalTime: new Date('2026-04-04T10:00:00.000Z'),
          status: 'Accepted',
          entryPrice: '1',
          stopLossPrice: '0.95',
          takeProfitTargets: ['1.1'],
          dedupeKey: 'dedupe-delta-live-open-protection-check',
          meta: null,
          createdAt: new Date('2026-04-04T10:00:00.000Z'),
          updatedAt: new Date('2026-04-04T10:00:00.000Z'),
        },
        {
          executionMode: 'live',
          brokerKey: 'delta_exchange',
          accountId: 'delta-acc-1',
          orderId: 'delta-live-check-entry',
          executionState: 'filled',
          orderStatus: 'CLOSED',
          entryPrice: '1',
          stopLossPrice: '0.95',
          takeProfitPrice: '1.1',
          filledPrice: '1',
          protectionState: 'failed',
          protectionAttempts: 1,
          protectionLastError:
            'Delta Exchange attached protection is inactive or missing for an open position (SL old-sl CANCELLED, TP old-tp CANCELLED); replacement protection is required before this execution can be marked attached.',
        },
        [
          {
            externalId: 'xrp-position-1',
            status: 'OPEN',
            statusRank: 2,
            firstSeenAt: '2026-04-04T10:03:05.000Z',
            lastSeenAt: '2026-04-04T10:03:05.000Z',
            payload: {
              id: 'xrp-position-1',
              product_symbol: 'XRPUSD',
              status: 'open',
              side: 'Long',
              entry_price: '1',
              quantity_contracts: '10',
              created_at: '2026-04-04T10:03:05.000Z',
              updated_at: '2026-04-04T10:03:05.000Z',
            },
          },
        ]
      );

      assert.equal(listOpenOrdersCalled, true);
      assert.equal(createProtectionCalled, false);
      assert.equal(nextExecution.protectionState, 'attached');
      assert.equal(
        (nextExecution.protectionPlan as Record<string, unknown>)?.stopLossOrderId,
        'delta-live-sl'
      );
      assert.equal(
        (nextExecution.protectionPlan as Record<string, unknown>)?.takeProfitOrderId,
        'delta-live-tp'
      );
    } finally {
      (coreDataSource as any).query = originalQuery;
    }
  }

  {
    const service = new SuggestedTradesService() as any;
    let createProtectionCalled = false;
    service.resolveLiveProtectionOrderContext = async () => {
      throw new Error('terminal unfilled Delta entry should not inspect protection snapshots');
    };
    service.brokerRuntimeRegistry = {
      getOrdersAdapter() {
        return {
          async createLiveAutoProtectiveOrdersForPosition() {
            createProtectionCalled = true;
            throw new Error('terminal unfilled Delta entry must not create protection orders');
          },
        };
      },
    };

    const nextExecution = await service.maybeRemediateLiveProtection(
      'user-1',
      {
        id: 'st-delta-terminal-unfilled',
        automationId: 'auto-1',
        automationRunId: 'run-1',
        userId: 'user-1',
        symbol: 'CROSSUSDT',
        timeframe: '5m',
        side: 'SELL',
        signalTime: new Date('2026-04-04T10:00:00.000Z'),
        status: 'Accepted',
        entryPrice: '0.105765',
        stopLossPrice: '0.107121129922',
        takeProfitTargets: ['0.101696610234'],
        dedupeKey: 'dedupe-delta-terminal-unfilled',
        meta: null,
        createdAt: new Date('2026-04-04T10:00:00.000Z'),
        updatedAt: new Date('2026-04-04T10:00:00.000Z'),
      },
      {
        executionMode: 'live',
        brokerKey: 'delta_exchange',
        accountId: 'delta-acc-1',
        orderId: 'delta-cancelled-entry',
        executionState: 'cancelled',
        orderStatus: 'CANCELLED',
        positionId: '84924',
        positionStatus: 'OPEN',
        entryPrice: '0.105765',
        stopLossPrice: '0.107121129922',
        takeProfitPrice: '0.101696610234',
        protectionState: 'attached',
        protectionAttempts: 3,
      },
      [
        {
          externalId: '84924',
          status: 'OPEN',
          statusRank: 2,
          firstSeenAt: '2026-04-04T10:03:05.000Z',
          lastSeenAt: '2026-04-04T10:03:05.000Z',
          payload: {
            id: '84924',
            product_symbol: 'CROSSUSD',
            side: 'Short',
            entry_price: '0.10485',
            mark_price: '0.1045',
            quantity_contracts: '100',
          },
        },
      ]
    );

    assert.equal(createProtectionCalled, false);
    assert.equal(nextExecution.protectionState, 'not_required');
    assert.equal(nextExecution.positionId, null);
    assert.equal(nextExecution.positionStatus, null);
    assert.match(String(nextExecution.note || ''), /Terminal unfilled entry order/);
  }

  {
    const service = new SuggestedTradesService() as any;
    let createProtectionCalled = false;
    service.resolveLiveProtectionOrderContext = async () => ({
      stopLossOrderId: null,
      takeProfitOrderId: null,
      stopLossStatus: null,
      takeProfitStatus: null,
      activeOrderIds: [],
    });
    service.resolveLiveAutoAssetRoute = async () => ({
      assetId: '84924',
      requestedSymbol: 'CROSSUSDT',
      brokerSymbol: 'CROSSUSD',
      candidateSymbols: ['CROSSUSDT', 'CROSSUSD'],
      resolvedVia: 'catalog_equivalent',
    });
    service.resolveActiveDeltaProtectionOrdersForSymbol = async () => ({
      stopLossOrderIds: ['delta-sl-existing-1', 'delta-sl-existing-2'],
      takeProfitOrderIds: ['delta-tp-existing-1', 'delta-tp-existing-2'],
      unclassifiedOrderIds: [],
      activeOrderIds: [
        'delta-sl-existing-1',
        'delta-tp-existing-1',
        'delta-sl-existing-2',
        'delta-tp-existing-2',
      ],
    });
    service.brokerRuntimeRegistry = {
      getOrdersAdapter() {
        return {
          async createLiveAutoProtectiveOrdersForPosition() {
            createProtectionCalled = true;
            throw new Error('duplicate active Delta protection must not create another pair');
          },
        };
      },
    };

    const nextExecution = await service.maybeRemediateLiveProtection(
      'user-1',
      {
        id: 'st-delta-duplicate-active-protection',
        automationId: 'auto-1',
        automationRunId: 'run-1',
        userId: 'user-1',
        symbol: 'CROSSUSDT',
        timeframe: '5m',
        side: 'SELL',
        signalTime: new Date('2026-04-04T10:00:00.000Z'),
        status: 'Accepted',
        entryPrice: '0.105765',
        stopLossPrice: '0.107121129922',
        takeProfitTargets: ['0.101696610234'],
        dedupeKey: 'dedupe-delta-duplicate-active-protection',
        meta: null,
        createdAt: new Date('2026-04-04T10:00:00.000Z'),
        updatedAt: new Date('2026-04-04T10:00:00.000Z'),
      },
      {
        executionMode: 'live',
        brokerKey: 'delta_exchange',
        accountId: 'delta-acc-1',
        orderId: 'delta-order-duplicate-active',
        executionState: 'filled',
        orderStatus: 'CLOSED',
        entryPrice: '0.105765',
        stopLossPrice: '0.107121129922',
        takeProfitPrice: '0.101696610234',
        filledPrice: '0.10485',
        protectionState: 'failed',
        protectionAttempts: 1,
        protectionLastError:
          'Delta Exchange attached protection is inactive or missing for an open position (SL old-sl CANCELLED, TP old-tp CANCELLED); replacement protection is required before this execution can be marked attached.',
      },
      [
        {
          externalId: '84924',
          status: 'OPEN',
          statusRank: 2,
          firstSeenAt: '2026-04-04T10:03:05.000Z',
          lastSeenAt: '2026-04-04T10:03:05.000Z',
          payload: {
            id: '84924',
            product_symbol: 'CROSSUSD',
            side: 'Short',
            entry_price: '0.10485',
            mark_price: '0.1045',
            quantity_contracts: '100',
          },
        },
      ]
    );

    assert.equal(createProtectionCalled, false);
    assert.equal(nextExecution.protectionState, 'manual_unlinked');
    assert.match(
      String(nextExecution.protectionLastError || ''),
      /active reduce-only protection orders already exist/
    );
    assert.match(String(nextExecution.protectionLastError || ''), /manual cleanup is required/);
  }

  {
    const service = new SuggestedTradesService() as any;
    let createProtectionCalled = false;
    service.resolveLiveProtectionOrderContext = async () => ({
      stopLossOrderId: null,
      takeProfitOrderId: null,
      stopLossStatus: null,
      takeProfitStatus: null,
      activeOrderIds: [],
    });
    service.resolveLiveAutoAssetRoute = async () => ({
      assetId: '84924',
      requestedSymbol: 'CROSSUSDT',
      brokerSymbol: 'CROSSUSD',
      candidateSymbols: ['CROSSUSDT', 'CROSSUSD'],
      resolvedVia: 'catalog_equivalent',
    });
    service.resolveActiveDeltaProtectionOrdersForSymbol = async () => ({
      stopLossOrderIds: ['delta-sl-existing'],
      takeProfitOrderIds: ['delta-tp-existing'],
      unclassifiedOrderIds: [],
      activeOrderIds: ['delta-sl-existing', 'delta-tp-existing'],
    });
    service.brokerRuntimeRegistry = {
      getOrdersAdapter() {
        return {
          async createLiveAutoProtectiveOrdersForPosition() {
            createProtectionCalled = true;
            throw new Error('existing Delta protection pair must be linked without replacement');
          },
        };
      },
    };

    const nextExecution = await service.maybeRemediateLiveProtection(
      'user-1',
      {
        id: 'st-delta-single-active-protection',
        automationId: 'auto-1',
        automationRunId: 'run-1',
        userId: 'user-1',
        symbol: 'CROSSUSDT',
        timeframe: '5m',
        side: 'SELL',
        signalTime: new Date('2026-04-04T10:00:00.000Z'),
        status: 'Accepted',
        entryPrice: '0.105765',
        stopLossPrice: '0.107121129922',
        takeProfitTargets: ['0.101696610234'],
        dedupeKey: 'dedupe-delta-single-active-protection',
        meta: null,
        createdAt: new Date('2026-04-04T10:00:00.000Z'),
        updatedAt: new Date('2026-04-04T10:00:00.000Z'),
      },
      {
        executionMode: 'live',
        brokerKey: 'delta_exchange',
        accountId: 'delta-acc-1',
        orderId: 'delta-order-single-active',
        executionState: 'filled',
        orderStatus: 'CLOSED',
        entryPrice: '0.105765',
        stopLossPrice: '0.107121129922',
        takeProfitPrice: '0.101696610234',
        filledPrice: '0.10485',
        protectionState: 'failed',
        protectionAttempts: 1,
        protectionLastError:
          'Delta Exchange attached protection is inactive or missing for an open position (SL old-sl CANCELLED, TP old-tp CANCELLED); replacement protection is required before this execution can be marked attached.',
      },
      [
        {
          externalId: '84924',
          status: 'OPEN',
          statusRank: 2,
          firstSeenAt: '2026-04-04T10:03:05.000Z',
          lastSeenAt: '2026-04-04T10:03:05.000Z',
          payload: {
            id: '84924',
            product_symbol: 'CROSSUSD',
            side: 'Short',
            entry_price: '0.10485',
            mark_price: '0.1045',
            quantity_contracts: '100',
          },
        },
      ]
    );

    assert.equal(createProtectionCalled, false);
    assert.equal(nextExecution.protectionState, 'attached');
    assert.equal(nextExecution.protectionLastError, null);
    assert.equal(
      (nextExecution.protectionPlan as Record<string, unknown>)?.stopLossOrderId,
      'delta-sl-existing'
    );
    assert.equal(
      (nextExecution.protectionPlan as Record<string, unknown>)?.takeProfitOrderId,
      'delta-tp-existing'
    );
  }

  {
    const service = new SuggestedTradesService() as any;
    let createProtectionCalled = false;
    service.resolveLiveProtectionOrderContext = async () => ({
      stopLossOrderId: 'delta-replacement-sl-1',
      takeProfitOrderId: 'delta-replacement-tp-1',
      stopLossStatus: 'PENDING',
      takeProfitStatus: 'OPEN',
      activeOrderIds: ['delta-replacement-sl-1', 'delta-replacement-tp-1'],
    });
    service.brokerRuntimeRegistry = {
      getOrdersAdapter() {
        return {
          async createLiveAutoProtectiveOrdersForPosition() {
            createProtectionCalled = true;
            throw new Error('snapshot verification must not place another replacement order');
          },
        };
      },
    };

    const nextExecution = await service.maybeRemediateLiveProtection(
      'user-1',
      {
        id: 'st-delta-protection-replacement-verified',
        automationId: 'auto-1',
        automationRunId: 'run-1',
        userId: 'user-1',
        symbol: 'BTCUSDT',
        timeframe: '5m',
        side: 'BUY',
        signalTime: new Date('2026-04-04T10:00:00.000Z'),
        status: 'Accepted',
        entryPrice: '100',
        stopLossPrice: '95',
        takeProfitTargets: ['110'],
        dedupeKey: 'dedupe-delta-protection-replacement-verified',
        meta: null,
        createdAt: new Date('2026-04-04T10:00:00.000Z'),
        updatedAt: new Date('2026-04-04T10:00:00.000Z'),
      },
      {
        executionMode: 'live',
        brokerKey: 'delta_exchange',
        accountId: 'delta-acc-1',
        orderId: 'delta-order-verified',
        executionState: 'filled',
        orderStatus: 'FILLED',
        entryPrice: '100',
        stopLossPrice: '95',
        takeProfitPrice: '110',
        filledPrice: '102',
        protectionState: 'attaching',
        protectionAttempts: 2,
        protectionPlan: {
          stopLossOrderId: 'delta-replacement-sl-1',
          takeProfitOrderId: 'delta-replacement-tp-1',
        },
      },
      [
        {
          externalId: '45678',
          status: 'OPEN',
          statusRank: 2,
          firstSeenAt: '2026-04-04T10:03:05.000Z',
          lastSeenAt: '2026-04-04T10:03:05.000Z',
          payload: {
            id: '45678',
            status: 'open',
            side: 'Long',
            entry_price: '102',
            quantity_contracts: '3',
          },
        },
      ]
    );

    assert.equal(createProtectionCalled, false);
    assert.equal(nextExecution.protectionState, 'attached');
    assert.equal(nextExecution.protectionAttempts, 2);
    assert.equal(
      (nextExecution.protectionPlan as Record<string, unknown>)?.stopLossOrderId,
      'delta-replacement-sl-1'
    );
  }

  {
    const service = new SuggestedTradesService() as any;
    let createProtectionCalled = false;
    service.resolveLiveProtectionOrderContext = async () => ({
      stopLossOrderId: 'delta-replacement-sl-2',
      takeProfitOrderId: 'delta-replacement-tp-2',
      stopLossStatus: 'PENDING',
      takeProfitStatus: 'PENDING',
      activeOrderIds: ['delta-replacement-sl-2', 'delta-replacement-tp-2'],
    });
    service.brokerRuntimeRegistry = {
      getOrdersAdapter() {
        return {
          async createLiveAutoProtectiveOrdersForPosition() {
            createProtectionCalled = true;
            throw new Error('already-active failed protection must not place another order');
          },
        };
      },
    };

    const nextExecution = await service.maybeRemediateLiveProtection(
      'user-1',
      {
        id: 'st-delta-failed-protection-now-active',
        automationId: 'auto-1',
        automationRunId: 'run-1',
        userId: 'user-1',
        symbol: 'BTCUSDT',
        timeframe: '5m',
        side: 'BUY',
        signalTime: new Date('2026-04-04T10:00:00.000Z'),
        status: 'Accepted',
        entryPrice: '100',
        stopLossPrice: '95',
        takeProfitTargets: ['110'],
        dedupeKey: 'dedupe-delta-failed-protection-now-active',
        meta: null,
        createdAt: new Date('2026-04-04T10:00:00.000Z'),
        updatedAt: new Date('2026-04-04T10:00:00.000Z'),
      },
      {
        executionMode: 'live',
        brokerKey: 'delta_exchange',
        accountId: 'delta-acc-1',
        orderId: 'delta-order-active-after-failure',
        executionState: 'filled',
        orderStatus: 'FILLED',
        entryPrice: '100',
        stopLossPrice: '95',
        takeProfitPrice: '110',
        filledPrice: '102',
        protectionState: 'failed',
        protectionAttempts: 3,
        protectionLastError:
          'Delta Exchange attached protection is inactive or missing for an open position (SL old-sl missing_snapshot, TP old-tp missing_snapshot); replacement protection is required before this execution can be marked attached.',
      },
      [
        {
          externalId: '45678',
          status: 'OPEN',
          statusRank: 2,
          firstSeenAt: '2026-04-04T10:03:05.000Z',
          lastSeenAt: '2026-04-04T10:03:05.000Z',
          payload: {
            id: '45678',
            status: 'open',
            side: 'Long',
            entry_price: '102',
            quantity_contracts: '3',
          },
        },
      ]
    );

    assert.equal(createProtectionCalled, false);
    assert.equal(nextExecution.protectionState, 'attached');
    assert.equal(nextExecution.protectionAttempts, 3);
    assert.equal(nextExecution.protectionLastError, null);
    assert.equal(
      (nextExecution.protectionPlan as Record<string, unknown>)?.takeProfitOrderId,
      'delta-replacement-tp-2'
    );
  }

  {
    const service = new SuggestedTradesService() as any;
    let savedExecutionPayload: Record<string, unknown> | null = null;
    const trade = {
      id: 'st-live-blocked-no-order-protection',
      automationId: 'auto-1',
      automationRunId: 'run-1',
      userId: 'user-1',
      symbol: 'ETHUSDT',
      timeframe: '15m',
      side: 'BUY',
      signalTime: new Date('2026-04-04T10:00:00.000Z'),
      status: 'Open',
      entryPrice: '100',
      stopLossPrice: '95',
      takeProfitTargets: ['110'],
      dedupeKey: 'dedupe-live-blocked-no-order-protection',
      meta: null,
      executionRecord: {
        executionMode: 'live',
        preTradeState: 'blocked',
        brokerKey: 'mudrex',
        accountId: 'acc-1',
        entryPrice: '100',
        stopLossPrice: '95',
        takeProfitPrice: '110',
        protectionState: 'pending',
        protectionAttempts: 0,
        createdAt: new Date('2026-04-04T10:00:00.000Z'),
        updatedAt: new Date('2026-04-04T10:00:00.000Z'),
      },
      createdAt: new Date('2026-04-04T10:00:00.000Z'),
      updatedAt: new Date('2026-04-04T10:00:00.000Z'),
    };

    service.suggestedTradeRepository = {
      async saveSuggestedTradeExecution(payload: Record<string, unknown>) {
        savedExecutionPayload = { ...payload };
        return {
          ...payload,
          createdAt: new Date('2026-04-04T10:01:00.000Z'),
          updatedAt: new Date('2026-04-04T10:01:00.000Z'),
        };
      },
    };

    const refreshed = await service.refreshExecutionOutcomes('user-1', [trade], {
      resolveStaleGaps: true,
    });

    assert.equal(refreshed, 1);
    assert.equal(savedExecutionPayload?.['protectionState'], 'not_required');
    assert.ok(savedExecutionPayload?.['protectionCheckedAt']);
    assert.match(String(savedExecutionPayload?.['note'] || ''), /No broker order was created/);
  }
}

async function runSuggestedTradeMudrexLeverageReconciliationAssertions(): Promise<void> {
  const service = new SuggestedTradesService() as any;
  let savedExecutionPayload: Record<string, unknown> | null = null;

  const trade = {
    id: 'st-mudrex-leverage-drift',
    automationId: 'auto-1',
    automationRunId: 'run-1',
    userId: 'user-1',
    sourceBacktestId: null,
    sourceTemplateId: null,
    sourceSetupKey: null,
    symbol: 'ETHUSDT',
    timeframe: '15m',
    side: 'BUY',
    signalTime: new Date('2026-04-04T10:00:00.000Z'),
    status: 'Accepted',
    confidence: 0.88,
    score: 90,
    entryPrice: '2500',
    stopLossPrice: '2450',
    takeProfitTargets: ['2600'],
    entryRule: 'breakout',
    exitRule: 'trail',
    rationale: 'Momentum continuation',
    dedupeKey: 'dedupe-mudrex-leverage-drift',
    meta: {
      execution: {
        executionMode: 'live',
        orderId: 'ord-mudrex-1',
        brokerKey: 'mudrex',
        accountId: 'acc-1',
        executionState: 'working',
        linkedAt: '2026-04-04T10:01:00.000Z',
        submittedAt: '2026-04-04T10:01:00.000Z',
        entryPrice: '2500',
        quantity: 1,
        leverage: 5,
        note: 'Live order linked.',
      },
    },
    createdAt: new Date('2026-04-04T10:00:30.000Z'),
    updatedAt: new Date('2026-04-04T10:02:00.000Z'),
  };

  service.suggestedTradeRepository = {
    async getLinkedOrderSnapshot() {
      return {
        orderStatus: 'FILLED',
        statusRank: 3,
        lastSeenAt: '2026-04-04T10:05:00.000Z',
        payload: {
          created_at: '2026-04-04T10:01:00.000Z',
          updated_at: '2026-04-04T10:05:00.000Z',
          filled_at: '2026-04-04T10:03:00.000Z',
        },
      };
    },
    async getLinkedPositionSnapshots() {
      return [
        {
          externalId: 'mudrex-pos-1',
          status: 'OPEN',
          statusRank: 1,
          firstSeenAt: '2026-04-04T10:03:30.000Z',
          lastSeenAt: '2026-04-04T10:06:00.000Z',
          payload: {
            status: 'OPEN',
            position_type: 'LONG',
            created_at: '2026-04-04T10:03:30.000Z',
            updated_at: '2026-04-04T10:06:00.000Z',
            entry_price: '2500',
            quantity: '1',
            leverage: '12',
          },
        },
      ];
    },
    async saveSuggestedTrade(item: Record<string, unknown>) {
      return {
        ...item,
        updatedAt: new Date('2026-04-04T10:06:00.000Z'),
      };
    },
    async saveSuggestedTradeExecution(payload: Record<string, unknown>) {
      savedExecutionPayload = { ...payload };
      return {
        ...payload,
        createdAt: new Date('2026-04-04T10:06:00.000Z'),
        updatedAt: new Date('2026-04-04T10:06:00.000Z'),
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

  const refreshed = await service.refreshExecutionOutcomes('user-1', [trade]);

  assert.equal(refreshed, 1);
  assert.equal(savedExecutionPayload?.['leverage'], 12);
  assert.equal(savedExecutionPayload?.['positionStatus'], 'OPEN');
  assert.match(
    String(savedExecutionPayload?.['note'] || ''),
    /Broker observed leverage 12 differs from requested leverage 5/
  );
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

async function runSuggestedTradeProtectionRecoverySyncAssertions(): Promise<void> {
  const service = new SuggestedTradesService() as any;
  const staleBefore = new Date('2026-05-11T14:00:00.000Z');
  const staleTrade = {
    id: 'st-stale-sync',
    userId: 'user-1',
    symbol: 'BTCUSDT',
    timeframe: '5m',
    side: 'BUY',
    signalTime: new Date('2026-05-11T13:55:00.000Z'),
    executionRecord: {
      executionMode: 'live',
      executionState: 'working',
      brokerKey: 'mudrex',
      accountId: 'acc-1',
      orderId: 'mudrex-stale-order',
      protectionState: 'waiting_for_fill',
    },
  } as unknown as SuggestedTrade;
  const protectionTrade = {
    id: 'st-protection-sync',
    userId: 'user-1',
    symbol: 'ETHUSDT',
    timeframe: '5m',
    side: 'SELL',
    signalTime: new Date('2026-05-11T13:56:00.000Z'),
    executionRecord: {
      executionMode: 'live',
      executionState: 'working',
      brokerKey: 'mudrex',
      accountId: 'acc-1',
      orderId: 'mudrex-protection-order',
      protectionState: 'attaching',
      protectionCheckedAt: '2026-05-11T14:01:30.000Z',
    },
  } as unknown as SuggestedTrade;
  let automaticStaleBefore: Date | null = null;
  let manualStaleBefore: Date | null = null;
  let refreshedIds: string[] = [];

  service.suggestedTradeRepository = {
    async listStaleTrackedTradesGlobal(limit: number, receivedStaleBefore: Date) {
      assert.equal(limit, 5);
      assert.equal(receivedStaleBefore, staleBefore);
      return [staleTrade];
    },
    async listProtectionRemediationCandidates(
      limit: number,
      receivedStaleBefore: Date,
      options?: { automaticStaleBefore?: Date }
    ) {
      assert.equal(limit, 5);
      manualStaleBefore = receivedStaleBefore;
      automaticStaleBefore = options?.automaticStaleBefore ?? null;
      return [protectionTrade, staleTrade];
    },
  };
  service.refreshExecutionOutcomes = async (
    userId: string,
    trades: SuggestedTrade[],
    options: Record<string, unknown>
  ) => {
    assert.equal(userId, 'user-1');
    assert.equal(options.resolveStaleGaps, true);
    refreshedIds = trades.map((trade) => trade.id);
    return trades.length;
  };

  const result = await service.syncStaleTrackedExecutionTrades({
    limit: 5,
    staleBefore,
  });

  assert.equal(manualStaleBefore, staleBefore);
  const capturedAutomaticStaleBefore = automaticStaleBefore as Date | null;
  assert.ok(capturedAutomaticStaleBefore instanceof Date);
  assert.equal(capturedAutomaticStaleBefore.getTime() >= staleBefore.getTime(), true);
  assert.deepEqual(refreshedIds, ['st-protection-sync', 'st-stale-sync']);
  assert.equal(result.processed, 2);
  assert.equal(result.refreshed, 2);
  assert.deepEqual(result.suggestedTradeIds, ['st-protection-sync', 'st-stale-sync']);
}

async function runSuggestedTradesProtectionGuardrailAssertions(): Promise<void> {
  const service = new SuggestedTradesProtectionGuardrailService() as any;
  const originalEnabled = env.suggestedTradesProtectionGuardrails.enabled;
  env.suggestedTradesProtectionGuardrails.enabled = true;

  const createdAlerts: Array<Record<string, unknown>> = [];
  const recoveryCalls: Array<{
    userId: string;
    brokerKey: string;
    accountId: string;
    symbols: string[];
  }> = [];

  service.listExecutionCandidates = async () => [
    {
      suggestedTradeId: 'st-open-unprotected',
      userId: 'user-1',
      brokerKey: 'mudrex',
      accountId: 'acc-1',
      symbol: 'ETHUSDT',
      side: 'BUY',
      timeframe: '5m',
      orderId: 'mudrex-entry-open-unprotected',
      orderStatus: 'FILLED',
      executionState: 'working',
      positionId: 'mudrex-position-open-unprotected',
      positionStatus: 'OPEN',
      filledAt: '2026-05-11T14:00:10.000Z',
      protectionState: 'waiting_for_position',
      protectionCheckedAt: '2026-05-11T14:00:15.000Z',
      updatedAt: '2026-05-11T14:00:15.000Z',
    },
  ];
  service.listOrderSnapshots = async () => new Map();
  service.listOpenPositionSnapshots = async () => [
    {
      externalId: 'mudrex-position-open-unprotected',
      symbol: 'ETHUSDT',
      status: 'OPEN',
      statusRank: 1,
      stopLossOrderId: null,
      stopLossPrice: null,
      takeProfitOrderId: null,
      takeProfitPrice: null,
      lastSeenAt: '2026-05-11T14:01:45.000Z',
    },
  ];
  service.alertRepository = {
    async findOpenAlertBySource() {
      return null;
    },
    async findOpenAlertBySignature() {
      return null;
    },
    async updateOpenAlertDetails() {
      throw new Error('new guardrail alert should not update an existing alert');
    },
    async createAlert(payload: Record<string, unknown>) {
      createdAlerts.push({ ...payload });
      return payload;
    },
  };
  service.suggestedTradesService = {
    async syncExecutionForPositionUpdates(
      userId: string,
      brokerKey: string,
      accountId: string,
      symbols: string[]
    ) {
      recoveryCalls.push({ userId, brokerKey, accountId, symbols: [...symbols] });
      return 1;
    },
  };

  try {
    const response = await service.runAudit({
      emitAlerts: true,
      now: new Date('2026-05-11T14:02:30.000Z'),
      staleAfterMs: 60_000,
    });

    assert.equal(response.status, 'degraded');
    assert.equal(response.issueTrades, 1);
    assert.equal(response.criticalIssues, 1);
    assert.equal(response.alertsEmitted, 1);
    assert.equal(response.recoveriesTriggered, 1);
    assert.equal(response.recoveryFailures, 0);
    assert.equal(response.items[0]?.issues[0]?.code, 'open_position_unprotected');
    assert.equal(response.items[0]?.recoveryTriggered, true);
    assert.equal(response.items[0]?.recoveryRefreshed, 1);
    assert.match(
      String(createdAlerts[0]?.message || ''),
      /mudrex ETHUSDT protection guardrail open_position_unprotected/
    );
    assert.deepEqual(recoveryCalls, [
      {
        userId: 'user-1',
        brokerKey: 'mudrex',
        accountId: 'acc-1',
        symbols: ['ETHUSDT'],
      },
    ]);
  } finally {
    env.suggestedTradesProtectionGuardrails.enabled = originalEnabled;
  }
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
      async getProtectionOperationalSnapshot() {
        return {
          tracked: 9,
          pending: 1,
          waitingForFill: 0,
          waitingForPosition: 1,
          attaching: 1,
          attached: 4,
          failed: 1,
          manualUnlinked: 2,
          staleManualUnlinked: 1,
          staleAttaching: 1,
          notRequired: 1,
          unknown: 0,
          actionable: 3,
          unresolved: 4,
          retriableFailed: 1,
          lastCheckedAt: new Date('2026-04-08T00:02:00.000Z'),
          lastAttachedAt: new Date('2026-04-08T00:01:00.000Z'),
          lastManualActionAt: new Date('2026-04-08T00:02:00.000Z'),
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
      async getSuggestedTradesFreshnessAudit(options: Record<string, unknown>) {
        assert.equal(options.lookbackDays, 7);
        return {
          lookbackDays: 7,
          windowStart: '2026-04-01T00:00:00.000Z',
          generatedAt: '2026-04-08T00:00:00.000Z',
          sampledSignals: 3,
          totalSignals: 3,
          openedSignals: 2,
          staleOpenCount: 1,
          staleBlockedCount: 1,
          latestClosedOnlyCount: 3,
          cursorGapCount: 0,
          unknownSignalSelectionModeCount: 0,
          averageSignalToSuggestionMinutes: 1,
          averageSignalToOpenMinutes: 49,
          maxSignalToOpenMinutes: 80,
          byTimeframe: [],
          worstDelays: [],
        };
      },
    };

    const response = await service.getOperationalSnapshot({
      probeUserId: 'user-1',
    });
    assert.equal(response.status, 'degraded');
    assert.equal(response.rolloutEnabled, env.suggestedTrades.rolloutEnabled);
    assert.equal(response.totalSuggestedTrades, 12);
    assert.equal(response.convertedToOrderCount, 3);
    assert.equal(response.protectionTrackedTrades, 9);
    assert.equal(response.protectionAttachedTrades, 4);
    assert.equal(response.protectionFailedTrades, 1);
    assert.equal(response.protectionManualActionTrades, 2);
    assert.equal(response.protectionStaleManualActionTrades, 1);
    assert.equal(response.protectionManualRecoveryStaleAfterMs, 600000);
    assert.equal(response.protectionStaleAttachingTrades, 1);
    assert.equal(response.protectionAttachingStaleAfterMs, 600000);
    assert.equal(response.protectionActionableTrades, 3);
    assert.equal(response.protectionUnresolvedTrades, 4);
    assert.equal(response.protectionRetriableFailedTrades, 1);
    assert.equal(response.protectionAttachmentRate, 0.4);
    assert.equal(response.protectionLastCheckedAt, '2026-04-08T00:02:00.000Z');
    assert.equal(response.protectionLastAttachedAt, '2026-04-08T00:01:00.000Z');
    assert.equal(response.queueToOrderSuccess24h, 2);
    assert.equal(response.duplicateSuggestions24h, 1);
    assert.equal(response.openAlerts, 1);
    assert.equal(response.freshnessAudit?.averageSignalToOpenMinutes, 49);
    assert.equal(response.freshnessAudit?.staleBlockedCount, 1);
    assert.equal(response.probeUserId, 'user-1');
    assert.notEqual(response.overviewLatencyMs, null);
    assert.notEqual(response.listLatencyMs, null);
    assert.notEqual(response.summaryLatencyMs, null);
    assert.notEqual(response.syncStatusLatencyMs, null);
  } finally {
    env.suggestedTrades.rolloutEnabled = originalRolloutEnabled;
  }
}

function runSuggestedTradesScriptWiringAssertions(): void {
  const packageSource = read('package.json');
  const packageJson = JSON.parse(packageSource) as {
    scripts?: Record<string, string>;
  };
  const packageScripts = packageJson.scripts || {};
  const runPackageSuiteSource = read('scripts/_support/run-package-suite.ts');
  const proofSource = read('scripts/proofs/proof-suggested-trades-live.ts');
  const smokeSource = read('scripts/smokes/smoke-suggested-trades-lifecycle.ts');
  const checkSource = read('scripts/checks/check-suggested-trades-health.ts');
  const protectionDryRunSource = read(
    'scripts/checks/check-suggested-trades-protection-dry-run.ts'
  );
  const protectionActionsSource = read(
    'scripts/checks/check-suggested-trades-protection-actions.ts'
  );
  const protectionRecoverySource = read(
    'scripts/checks/check-suggested-trades-protection-recovery.ts'
  );
  const protectionGuardrailsSource = read(
    'scripts/checks/check-suggested-trades-protection-guardrails.ts'
  );
  const terminalProtectionRepairSource = read(
    'scripts/maintenance/repair-suggested-trade-terminal-protection.ts'
  );
  const releaseGateSource = read('scripts/release-gates/release-gate-suggested-trades.ts');
  const signoffSource = read('scripts/signoffs/signoff-suggested-trades.ts');
  const canaryReadinessSource = read('scripts/checks/check-broker-auto-canary-readiness.ts');
  const coverageManifestSource = read('scripts/_support/system-coverage-manifest.ts');
  const envSource = read('src/env.ts');
  const serviceSource = read('src/api/services/SuggestedTradesService.ts');

  assert.equal(
    packageScripts['test:suggested-trades'],
    'node --import tsx scripts/_support/run-doc-aware-test.ts scripts/test-suggested-trades.ts'
  );
  assert.equal(
    packageScripts['proof:suggested-trades-live'],
    'node --import tsx scripts/proofs/proof-suggested-trades-live.ts'
  );
  assert.equal(
    packageScripts['check:broker-auto-canary-readiness'],
    'node --import tsx scripts/checks/check-broker-auto-canary-readiness.ts'
  );
  assert.equal(
    packageScripts['check:suggested-trades-protection-dry-run'],
    'node --import tsx scripts/checks/check-suggested-trades-protection-dry-run.ts'
  );
  assert.equal(
    packageScripts['check:suggested-trades-protection-actions'],
    'node --import tsx scripts/checks/check-suggested-trades-protection-actions.ts'
  );
  assert.equal(
    packageScripts['check:suggested-trades-protection-recovery'],
    'node --import tsx scripts/checks/check-suggested-trades-protection-recovery.ts'
  );
  assert.equal(
    packageScripts['check:suggested-trades-protection-guardrails'],
    'node --import tsx scripts/checks/check-suggested-trades-protection-guardrails.ts'
  );
  assert.equal(
    packageScripts['repair:suggested-trades-terminal-protection'],
    'node --import tsx scripts/maintenance/repair-suggested-trade-terminal-protection.ts'
  );
  assert.equal(
    runPackageSuiteSource.includes("'suggested-trades': ['test:suggested-trades']"),
    true
  );
  assert.equal(runPackageSuiteSource.includes("'test:suggested-trades'"), true);
  assert.equal(
    coverageManifestSource.includes('check:broker-auto-canary-readiness'),
    true,
    'system coverage manifest must include the broker-auto canary readiness check'
  );
  assert.equal(
    coverageManifestSource.includes('check:suggested-trades-protection-dry-run'),
    true,
    'system coverage manifest must include the suggested-trades protection dry-run check'
  );
  assert.equal(
    coverageManifestSource.includes('check:suggested-trades-protection-actions'),
    true,
    'system coverage manifest must include the suggested-trades protection action check'
  );
  assert.equal(
    coverageManifestSource.includes('check:suggested-trades-protection-recovery'),
    true,
    'system coverage manifest must include the suggested-trades protection recovery check'
  );

  assert.equal(
    proofSource.includes('scripts/smokes/smoke-suggested-trades-lifecycle.ts'),
    true,
    'suggested trades live proof must run lifecycle smoke'
  );
  assert.equal(
    proofSource.includes('scripts/checks/check-suggested-trades-health.ts'),
    true,
    'suggested trades live proof must run health check'
  );
  assert.equal(
    proofSource.includes('scripts/checks/check-suggested-trades-protection-dry-run.ts'),
    true,
    'suggested trades live proof must run protection dry-run audit'
  );
  assert.equal(
    proofSource.includes('scripts/checks/check-suggested-trades-protection-actions.ts'),
    true,
    'suggested trades live proof must run protection action report'
  );
  assert.equal(
    proofSource.includes('scripts/checks/check-suggested-trades-protection-recovery.ts'),
    true,
    'suggested trades live proof must run protection recovery freshness check'
  );
  assert.equal(
    proofSource.includes('scripts/checks/check-suggested-trades-protection-guardrails.ts'),
    true,
    'suggested trades live proof must run protection guardrail gate'
  );
  assert.equal(
    smokeSource.includes('/suggested-trades/overview') &&
      smokeSource.includes('/suggested-trades/reconcile-execution') &&
      smokeSource.includes('/health/suggested-trades'),
    true,
    'suggested trades smoke must exercise overview, reconcile, and health flows'
  );
  assert.equal(
    checkSource.includes('/health/suggested-trades'),
    true,
    'suggested trades health check must read suggested trades health endpoint'
  );
  assert.equal(
    releaseGateSource.includes('/health/suggested-trades'),
    true,
    'suggested trades release gate must read suggested trades health endpoint'
  );
  for (const marker of [
    'suggested-trades-protection-dry-run',
    'WOULD_REPLACE_INACTIVE_PROTECTION',
    'MANUAL_STOP_ALREADY_CROSSED',
    'MANUAL_UNLINKED',
    'WAITING_FOR_FILL',
    'WAITING_FOR_POSITION',
    'replacementPreview',
    'dryRun: true',
    'scheduler_positions_snapshots',
    'scheduler_orders_snapshots',
  ]) {
    assert.equal(
      protectionDryRunSource.includes(marker),
      true,
      `suggested trades protection dry-run check must retain ${marker}`
    );
  }
  for (const marker of [
    'suggested-trades-protection-actions',
    'SUGGESTED_TRADES_MAX_PROTECTION_ACTION_ITEMS',
    'manual_unlinked',
    'staleAttaching',
    'SUGGESTED_TRADES_PROTECTION_ATTACHING_STALE_MINUTES',
    'position_status',
    'recommendedAction',
    'recoveryFreshness',
    'staleManualRecoveryItems',
    'protectionCheckedAgeSeconds',
    'SUGGESTED_TRADES_PROTECTION_RECOVERY_STALE_MINUTES',
    'protection action items',
  ]) {
    assert.equal(
      protectionActionsSource.includes(marker),
      true,
      `suggested trades protection action check must retain ${marker}`
    );
  }
  for (const marker of [
    'suggested-trades-protection-recovery',
    'SUGGESTED_TRADES_PROTECTION_RECOVERY_STALE_MINUTES',
    'SUGGESTED_TRADES_MAX_STALE_MANUAL_PROTECTION_TRADES',
    'manual_unlinked',
    'staleManualProtectionTrades',
    'protection recovery stale manual trades',
  ]) {
    assert.equal(
      protectionRecoverySource.includes(marker),
      true,
      `suggested trades protection recovery check must retain ${marker}`
    );
  }
  for (const marker of [
    'suggested-trades-protection-guardrails',
    'SUGGESTED_TRADES_MAX_PROTECTION_GUARDRAIL_ISSUE_TRADES',
    'SUGGESTED_TRADES_MAX_PROTECTION_GUARDRAIL_RECOVERY_FAILURES',
    'issueTrades',
    'recoveryFailures',
    'protection guardrail recovery failures',
  ]) {
    assert.equal(
      protectionGuardrailsSource.includes(marker),
      true,
      `suggested trades protection guardrail check must retain ${marker}`
    );
  }
  for (const marker of [
    'suggested-trades-terminal-protection-repair',
    'SUGGESTED_TRADES_TERMINAL_PROTECTION_REPAIR_APPLY',
    'dry_run',
    'not_required',
    'position_status',
  ]) {
    assert.equal(
      terminalProtectionRepairSource.includes(marker),
      true,
      `suggested trades terminal protection repair must retain ${marker}`
    );
  }
  assert.equal(
    releaseGateSource.includes('smoke-suggested-trades-lifecycle.ts'),
    true,
    'suggested trades release gate must execute lifecycle smoke'
  );
  assert.equal(
    releaseGateSource.includes('/health/suggested-trades-protection-guardrails?emitAlerts=false'),
    true,
    'suggested trades release gate must query protection guardrails without side effects'
  );
  for (const marker of [
    'SUGGESTED_TRADES_MAX_PROTECTION_GUARDRAIL_ISSUE_TRADES',
    'SUGGESTED_TRADES_MAX_PROTECTION_GUARDRAIL_RECOVERY_FAILURES',
    'SUGGESTED_TRADES_REQUIRE_PROTECTION_GUARDRAILS_ENABLED',
    'finalProtectionGuardrails',
    'protectionGuardrailIssueTrades',
    'protectionGuardrailRecoveryFailures',
  ]) {
    assert.equal(
      releaseGateSource.includes(marker),
      true,
      `suggested trades release gate must retain ${marker}`
    );
  }
  assert.equal(
    releaseGateSource.includes('APP_API_KEY') && releaseGateSource.includes('API_KEY'),
    true,
    'suggested trades release gate must support API-key auth for production health polling'
  );
  for (const marker of [
    'SUGGESTED_TRADES_MAX_PROTECTION_FAILED_TRADES',
    'SUGGESTED_TRADES_MAX_PROTECTION_MANUAL_ACTION_TRADES',
    'SUGGESTED_TRADES_MAX_STALE_MANUAL_PROTECTION_TRADES',
    'SUGGESTED_TRADES_MAX_STALE_ATTACHING_PROTECTION_TRADES',
    'SUGGESTED_TRADES_MAX_PROTECTION_ACTIONABLE_TRADES',
    'SUGGESTED_TRADES_MAX_PROTECTION_UNRESOLVED_TRADES',
    'SUGGESTED_TRADES_MAX_PROTECTION_RETRIABLE_FAILED_TRADES',
    'SUGGESTED_TRADES_MIN_PROTECTION_ATTACHMENT_RATE',
  ]) {
    assert.equal(
      checkSource.includes(marker) && releaseGateSource.includes(marker),
      true,
      `suggested trades health gates must retain protection threshold ${marker}`
    );
  }
  for (const marker of [
    'protectionFailedTrades',
    'protectionManualActionTrades',
    'protectionStaleManualActionTrades',
    'protectionManualRecoveryStaleAfterMs',
    'protectionStaleAttachingTrades',
    'protectionAttachingStaleAfterMs',
    'protectionActionableTrades',
    'protectionUnresolvedTrades',
    'protectionRetriableFailedTrades',
    'protectionAttachmentRate',
  ]) {
    assert.equal(
      releaseGateSource.includes(marker) && signoffSource.includes(marker),
      true,
      `suggested trades release gate and signoff must retain protection metric ${marker}`
    );
  }
  assert.equal(
    signoffSource.includes('SUGGESTED_TRADES_SIGNOFF_OPERATOR_FLOW_VERIFIED'),
    true,
    'suggested trades signoff must require operator flow verification'
  );
  assert.equal(
    signoffSource.includes('SUGGESTED_TRADES_SIGNOFF_ROLLOUT_TOGGLE_VERIFIED'),
    true,
    'suggested trades signoff must require rollout toggle verification'
  );
  assert.equal(
    signoffSource.includes('SUGGESTED_TRADES_SIGNOFF_EXTERNAL_DASHBOARDS_VERIFIED'),
    true,
    'suggested trades signoff must require dashboard verification'
  );
  for (const marker of [
    'SUGGESTED_TRADES_LIVE_AUTO_ENABLED',
    'SUGGESTED_TRADES_LIVE_AUTO_EXECUTION_ENABLED',
    'SUGGESTED_TRADES_LIVE_AUTO_MUDREX_ENABLED',
    'SUGGESTED_TRADES_LIVE_AUTO_DELTA_EXCHANGE_ENABLED',
    'SUGGESTED_TRADES_LIVE_AUTO_ADAPTIVE_ROUTING_MODE',
    'SUGGESTED_TRADES_LIVE_AUTO_REQUIRE_FIXED_ROUTING',
    'SUGGESTED_TRADES_LIVE_AUTO_USER_ALLOWLIST',
    'SUGGESTED_TRADES_LIVE_AUTO_BROKER_ALLOWLIST',
    'SUGGESTED_TRADES_LIVE_AUTO_SHADOW_BROKER_ALLOWLIST',
    'SUGGESTED_TRADES_PROTECTION_REPAIR_MUDREX_ENABLED',
    'SUGGESTED_TRADES_PROTECTION_REPAIR_DELTA_EXCHANGE_ENABLED',
  ]) {
    assert.equal(
      envSource.includes(marker),
      true,
      `env.ts must expose ${marker} for live-auto rollout control`
    );
  }
  for (const marker of [
    'Live auto rollout guard passed. Broker placement remains disabled until live auto execution is explicitly enabled.',
    'Accepted automatically by live automation execution policy',
    'Live auto execution currently supports only mudrex and delta_exchange routes',
    'Native SL/TP protection attached',
    'awaiting entry fill and active order snapshot verification',
    'using equivalent broker symbol',
    'Shadow route would select',
    'pre_trade_check',
    'resolveTrailingRiskOrderPositionId',
    'resolveTrailingRiskOrderIds',
    'clearTrailingStopErrorWhenNoMoveNeeded',
    'positionsAdapter.updateRiskOrder',
    'resolveMudrexRiskOrderPositionId(position, positionPayload)',
  ]) {
    assert.equal(
      serviceSource.includes(marker),
      true,
      `SuggestedTradesService must retain ${marker} for live-auto auditability`
    );
  }
  for (const marker of [
    'BROKER_AUTO_CANARY_USER_EMAIL',
    'BROKER_AUTO_CANARY_BROKER',
    'BROKER_AUTO_CANARY_READINESS_STRICT',
    'SUPPORTED_DRY_RUN_CANARY_BROKERS',
    'SUPPORTED_LIVE_AUTO_BROKERS',
    'delta_exchange',
    'live_auto_execution_enabled',
    'canary_live_automation',
    'order_submission_reconciliation_clean',
  ]) {
    assert.equal(
      canaryReadinessSource.includes(marker),
      true,
      `broker-auto canary readiness check must retain ${marker}`
    );
  }
}

async function runCustomRLadderTrailingStopAssertions(): Promise<void> {
  const config = normalizeCustomRLadderTrailingStopConfig({
    enabled: true,
    mode: 'custom_r_ladder',
    rules: [
      { whenProfitR: 2, moveStopToR: 1 },
      { whenProfitR: 1, moveStopToR: 0 },
      { whenProfitR: 3, moveStopToR: 2 },
      { whenProfitR: 3, moveStopToR: 3 },
    ],
  });
  assert.ok(config);
  assert.deepEqual(config.rules, [
    { whenProfitR: 1, moveStopToR: 0 },
    { whenProfitR: 2, moveStopToR: 1 },
    { whenProfitR: 3, moveStopToR: 2 },
  ]);

  const longMove = evaluateCustomRLadderTrailingStopMove({
    side: 'long',
    config,
    entryPrice: 100,
    originalStopLossPrice: 95,
    currentStopLossPrice: 100,
    currentPrice: 110.5,
  });
  assert.equal(longMove.action, 'move');
  if (longMove.action === 'move') {
    assert.equal(longMove.rule.whenProfitR, 2);
    assert.equal(longMove.targetStopLossPrice, 105);
  }

  const shortMove = evaluateCustomRLadderTrailingStopMove({
    side: 'short',
    config,
    entryPrice: 100,
    originalStopLossPrice: 105,
    currentStopLossPrice: 100,
    currentPrice: 89.5,
  });
  assert.equal(shortMove.action, 'move');
  if (shortMove.action === 'move') {
    assert.equal(shortMove.rule.whenProfitR, 2);
    assert.equal(shortMove.targetStopLossPrice, 95);
  }

  const noBackwardMove = evaluateCustomRLadderTrailingStopMove({
    side: 'long',
    config,
    entryPrice: 100,
    originalStopLossPrice: 95,
    currentStopLossPrice: 106,
    currentPrice: 110.5,
  });
  assert.deepEqual(noBackwardMove, {
    action: 'none',
    reason: 'would_move_backward',
    profitR: 2.1,
  });

  const alreadyApplied = evaluateCustomRLadderTrailingStopMove({
    side: 'long',
    config,
    entryPrice: 100,
    originalStopLossPrice: 95,
    currentStopLossPrice: 105,
    currentPrice: 110.5,
    lastAppliedWhenProfitR: 2,
  });
  assert.equal(alreadyApplied.action, 'none');
  if (alreadyApplied.action === 'none') {
    assert.equal(alreadyApplied.reason, 'already_applied');
  }

  const riskRewardConfig = normalizeCustomRLadderTrailingStopConfig({
    enabled: true,
    mode: 'custom_r_ladder',
    rules: [
      { whenProfitR: 0.4, moveStopToR: 0 },
      { whenProfitR: 1.5, moveStopToR: 0.5 },
      { whenProfitR: 2, moveStopToR: 1.3 },
      { whenProfitR: 3, moveStopToR: 2.4 },
      { whenProfitR: 4, trailDistanceR: 0.6 },
    ],
  });
  assert.ok(riskRewardConfig);
  assert.deepEqual(riskRewardConfig.rules, [
    { whenProfitR: 0.4, moveStopToR: 0 },
    { whenProfitR: 1.5, moveStopToR: 0.5 },
    { whenProfitR: 2, moveStopToR: 1.3 },
    { whenProfitR: 3, moveStopToR: 2.4 },
    { whenProfitR: 4, moveStopToR: 3.4, trailDistanceR: 0.6 },
  ]);

  const peakTrailingMove = evaluateCustomRLadderTrailingStopMove({
    side: 'long',
    config: riskRewardConfig,
    entryPrice: 100,
    originalStopLossPrice: 95,
    currentStopLossPrice: 117,
    currentPrice: 123,
    peakProfitR: 5,
    lastAppliedWhenProfitR: 4,
    lastAppliedMoveStopToR: 3.4,
  });
  assert.equal(peakTrailingMove.action, 'move');
  if (peakTrailingMove.action === 'move') {
    assert.equal(peakTrailingMove.rule.whenProfitR, 4);
    assert.equal(peakTrailingMove.rule.trailDistanceR, 0.6);
    assert.equal(Number(peakTrailingMove.profitR.toFixed(6)), 4.6);
    assert.equal(peakTrailingMove.peakProfitR, 5);
    assert.equal(Number(peakTrailingMove.lockedProfitR.toFixed(6)), 4.4);
    assert.equal(Number(peakTrailingMove.targetStopLossPrice.toFixed(6)), 122);
  }

  const shortPeakTrailingMove = evaluateCustomRLadderTrailingStopMove({
    side: 'short',
    config: riskRewardConfig,
    entryPrice: 100,
    originalStopLossPrice: 105,
    currentStopLossPrice: 83,
    currentPrice: 75,
  });
  assert.equal(shortPeakTrailingMove.action, 'move');
  if (shortPeakTrailingMove.action === 'move') {
    assert.equal(shortPeakTrailingMove.rule.whenProfitR, 4);
    assert.equal(Number(shortPeakTrailingMove.lockedProfitR.toFixed(6)), 4.4);
    assert.equal(Number(shortPeakTrailingMove.targetStopLossPrice.toFixed(6)), 78);
  }

  const trailingAlreadyApplied = evaluateCustomRLadderTrailingStopMove({
    side: 'long',
    config: riskRewardConfig,
    entryPrice: 100,
    originalStopLossPrice: 95,
    currentStopLossPrice: 122,
    currentPrice: 125,
    peakProfitR: 5,
    lastAppliedWhenProfitR: 4,
    lastAppliedMoveStopToR: 4.4,
  });
  assert.equal(trailingAlreadyApplied.action, 'none');
  if (trailingAlreadyApplied.action === 'none') {
    assert.equal(trailingAlreadyApplied.reason, 'already_applied');
  }

  const ema5PullbackConfig = normalizeCustomRLadderTrailingStopConfig({
    enabled: true,
    mode: 'custom_r_ladder',
    basis: 'actual_fill',
    updateOnlyInProfitDirection: true,
    rules: [
      { whenProfitR: 0.5, moveStopToR: 0.1 },
      { whenProfitR: 1, moveStopToR: 0.3 },
      { whenProfitR: 2, moveStopToR: 1.2 },
      { whenProfitR: 3, moveStopToR: 2.2 },
      { whenProfitR: 4, moveStopToR: 3.2 },
      { whenProfitR: 5, moveStopToR: 4.2 },
    ],
  });
  assert.ok(ema5PullbackConfig);
  assert.deepEqual(ema5PullbackConfig.rules, [
    { whenProfitR: 0.5, moveStopToR: 0.1 },
    { whenProfitR: 1, moveStopToR: 0.3 },
    { whenProfitR: 2, moveStopToR: 1.2 },
    { whenProfitR: 3, moveStopToR: 2.2 },
    { whenProfitR: 4, moveStopToR: 3.2 },
    { whenProfitR: 5, moveStopToR: 4.2 },
  ]);
  const ema5PullbackMove = evaluateCustomRLadderTrailingStopMove({
    side: 'long',
    config: ema5PullbackConfig,
    entryPrice: 100,
    originalStopLossPrice: 95,
    currentStopLossPrice: 116,
    currentPrice: 125.5,
  });
  assert.equal(ema5PullbackMove.action, 'move');
  if (ema5PullbackMove.action === 'move') {
    assert.equal(ema5PullbackMove.rule.whenProfitR, 5);
    assert.equal(ema5PullbackMove.lockedProfitR, 4.2);
    assert.equal(ema5PullbackMove.targetStopLossPrice, 121);
  }

  const service = new SuggestedTradesService() as any;
  const actualFillOriginalStop = service.resolveTrailingOriginalStopLossPrice(
    { stopLossPrice: '86.91' },
    {
      stopLossPrice: '86.91',
      protectionPlan: {
        stopLossPrice: '86.91',
      },
    },
    {
      entry_price: '86.91',
      stoploss_price: '86.960029',
    },
    {
      basis: 'actual_fill',
      entryPrice: 86.91,
      side: 'short',
    }
  );
  assert.equal(actualFillOriginalStop, 86.960029);

  const attachedWithTrailing = service.markProtectionAttached(
    {
      symbol: 'ICPUSDT',
      side: 'BUY',
      timeframe: '5m',
      meta: {
        tradeManagementSnapshot: {
          trailingStop: ema5PullbackConfig,
        },
      },
    },
    {
      executionMode: 'live',
      protectionPlan: {
        stopLossPrice: '2.62',
      },
    },
    '2026-05-17T08:30:00.000Z',
    'attached',
    {
      positionId: 'position-1',
    }
  );
  assert.deepEqual(
    attachedWithTrailing.protectionPlan.trailingStop.rules,
    ema5PullbackConfig.rules
  );

  const livePositionRiskOrderIds = service.resolveTrailingRiskOrderIds(
    {
      protectionPlan: {
        stopLossOrderId: 'old-sl-order',
        takeProfitOrderId: 'old-tp-order',
      },
    },
    {
      stoploss_order_id: 'current-sl-order',
      takeprofit_order_id: 'current-tp-order',
    }
  );
  assert.equal(livePositionRiskOrderIds.stopLossOrderId, 'old-sl-order');
  assert.equal(livePositionRiskOrderIds.takeProfitOrderId, 'old-tp-order');

  const positionProtectionOrderIds = service.resolveProtectionOrderIdsFromPositionPayload({
    stoploss_order_id: 'current-sl-order',
    takeprofit_order_id: 'current-tp-order',
  });
  assert.equal(positionProtectionOrderIds.stopLossOrderId, 'current-sl-order');
  assert.equal(positionProtectionOrderIds.takeProfitOrderId, 'current-tp-order');

  const repository = new SuggestedTradeRepository() as any;
  const mergedPositionPayload = repository.mergeReadModelProtectionIntoPositionPayload({
    payload: {
      id: '59172',
      status: 'open',
      symbol: 'VVVUSD',
      entry_price: '13.862',
      current_price: '14.209',
      stoploss: null,
      takeprofit: null,
    },
    readModelStopLossPrice: '13.932172142856',
    readModelTakeProfitPrice: '14.395378571429',
    readModelStopLossOrderId: '1320080639',
    readModelTakeProfitOrderId: '1320075078',
  });
  assert.equal(mergedPositionPayload.stoploss_order_id, '1320080639');
  assert.equal(mergedPositionPayload.takeprofit_order_id, '1320075078');
  assert.equal(mergedPositionPayload.stoploss_price, '13.932172142856');
  assert.equal(mergedPositionPayload.takeprofit_price, '14.395378571429');

  const staleTrailingPlan = repository.mergeProtectionPlanLinkFields(
    {
      stopLossOrderId: '1320080639',
      takeProfitOrderId: '1320075078',
      attachedStopLossPrice: '13.8715689285713',
      attachedTakeProfitPrice: '14.395378571429',
      trailingStop: {
        lastUpdatedAt: '2026-05-17T08:57:30.641Z',
        lastAppliedWhenProfitR: 1,
        lastMoveStopToR: 0.3,
        lastStopLossPrice: '13.8715689285713',
        lastError: 'Trailing SL update failed: Delta position not found',
      },
    },
    {
      stopLossOrderId: 'delta-new-sl-5r',
      takeProfitOrderId: '1320075078',
      attachedStopLossPrice: '13.995964999998202',
      attachedTakeProfitPrice: '14.395378571429',
      trailingStop: {
        lastUpdatedAt: '2026-05-17T10:34:34.564Z',
        lastAppliedWhenProfitR: 5,
        lastMoveStopToR: 4.2,
        lastStopLossPrice: '13.995964999998202',
        lastError: null,
      },
    }
  );
  assert.equal(staleTrailingPlan.stopLossOrderId, 'delta-new-sl-5r');
  assert.equal(staleTrailingPlan.attachedStopLossPrice, '13.995964999998202');
  assert.equal(staleTrailingPlan.trailingStop.lastAppliedWhenProfitR, 5);
  assert.equal(staleTrailingPlan.trailingStop.lastError, null);

  Object.defineProperty(repository, 'executionRepository', {
    value: {
      async findOne() {
        return {
          executionMode: 'live',
          orderId: 'delta-entry-1',
          brokerKey: 'delta_exchange',
          accountId: 'delta-account-1',
          stopLossPrice: '13.995964999998202',
          takeProfitPrice: '14.395378571429',
          protectionLastError: null,
          protectionCheckedAt: new Date('2026-05-17T10:34:34.564Z'),
          protectionPlan: {
            stopLossOrderId: 'delta-new-sl-5r',
            takeProfitOrderId: '1320075078',
            attachedStopLossPrice: '13.995964999998202',
            attachedTakeProfitPrice: '14.395378571429',
            trailingStop: {
              lastUpdatedAt: '2026-05-17T10:34:34.564Z',
              lastAppliedWhenProfitR: 5,
              lastMoveStopToR: 4.2,
              lastStopLossPrice: '13.995964999998202',
              lastError: null,
            },
          },
        };
      },
    },
  });
  const preservedLiveExecution = await repository.preserveExistingLiveExecutionLink({
    suggestedTradeId: 'st-vvv',
    userId: 'user-1',
    executionMode: 'live',
    orderId: 'delta-entry-1',
    brokerKey: 'delta_exchange',
    accountId: 'delta-account-1',
    stopLossPrice: '13.8715689285713',
    takeProfitPrice: '14.395378571429',
    protectionLastError: 'Trailing SL update failed: Delta position not found',
    protectionCheckedAt: '2026-05-17T10:36:00.000Z',
    protectionPlan: {
      stopLossOrderId: '1320080639',
      takeProfitOrderId: '1320075078',
      attachedStopLossPrice: '13.8715689285713',
      attachedTakeProfitPrice: '14.395378571429',
      trailingStop: {
        lastUpdatedAt: '2026-05-17T08:57:30.641Z',
        lastAppliedWhenProfitR: 1,
        lastMoveStopToR: 0.3,
        lastStopLossPrice: '13.8715689285713',
        lastError: 'Trailing SL update failed: Delta position not found',
      },
    },
  });
  assert.equal(preservedLiveExecution.stopLossPrice, '13.995964999998202');
  assert.equal(preservedLiveExecution.protectionLastError, null);
  assert.equal(
    (preservedLiveExecution.protectionPlan as Record<string, any>).trailingStop
      .lastAppliedWhenProfitR,
    5
  );

  const missingPositionTrailing = service.clearTrailingStopErrorWhenPositionGone(
    {
      protectionPlan: {
        trailingStop: {
          lastUpdatedAt: '2026-05-17T10:34:34.564Z',
          lastAppliedWhenProfitR: 5,
          lastMoveStopToR: 4.2,
          lastStopLossPrice: '13.995964999998202',
          lastError: null,
        },
      },
      protectionLastError: 'Trailing SL update failed: Delta position not found',
    },
    ema5PullbackConfig,
    '2026-05-17T10:36:00.000Z',
    9.4,
    14.25,
    13.995964999998202
  );
  assert.equal(missingPositionTrailing.protectionLastError, null);
  assert.equal(
    (missingPositionTrailing.protectionPlan as Record<string, any>).trailingStop.lastError,
    null
  );
  assert.equal(
    (missingPositionTrailing.protectionPlan as Record<string, any>).trailingStop.lastNoopReason,
    'position_not_open'
  );

  const staleMissingPositionTrailing = service.clearTrailingStopErrorWhenPositionGone(
    {
      protectionPlan: {
        stopLossOrderId: '1320080639',
        takeProfitOrderId: '1320075078',
        attachedStopLossPrice: '13.8715689285713',
        attachedTakeProfitPrice: '14.395378571429',
        trailingStop: {
          lastUpdatedAt: '2026-05-17T08:57:30.641Z',
          lastAppliedWhenProfitR: 1,
          lastMoveStopToR: 0.3,
          lastStopLossPrice: '13.8715689285713',
          lastError: 'Trailing SL update failed: Delta position not found',
        },
      },
      protectionLastError: 'Trailing SL update failed: Delta position not found',
    },
    ema5PullbackConfig,
    '2026-05-17T10:36:00.000Z',
    5.3,
    14.25,
    13.8715689285713
  );
  const preservedAfterStalePositionGone = await repository.preserveExistingLiveExecutionLink({
    suggestedTradeId: 'st-vvv',
    userId: 'user-1',
    executionMode: 'live',
    orderId: 'delta-entry-1',
    brokerKey: 'delta_exchange',
    accountId: 'delta-account-1',
    stopLossPrice: '13.8715689285713',
    takeProfitPrice: '14.395378571429',
    protectionLastError: staleMissingPositionTrailing.protectionLastError,
    protectionCheckedAt: staleMissingPositionTrailing.protectionCheckedAt,
    protectionPlan: staleMissingPositionTrailing.protectionPlan as Record<string, unknown>,
  });
  assert.equal(preservedAfterStalePositionGone.stopLossPrice, '13.995964999998202');
  assert.equal(
    (preservedAfterStalePositionGone.protectionPlan as Record<string, any>).trailingStop
      .lastAppliedWhenProfitR,
    5
  );

  const replacementOrderIds = service.resolveTrailingRiskOrderIdsFromMutationResult({
    protective_orders: [
      {
        kind: 'stop_loss',
        order_id: 'delta-new-sl-1',
      },
      {
        kind: 'take_profit',
        order_id: 'delta-tp-1',
      },
    ],
  });
  assert.deepEqual(replacementOrderIds, {
    stopLossOrderId: 'delta-new-sl-1',
    takeProfitOrderId: 'delta-tp-1',
  });
}

async function main(): Promise<void> {
  await runCustomRLadderTrailingStopAssertions();
  runSuggestedTradeDeltaProtectionModePolicyAssertions();
  await runSuggestedTradesControllerAssertions();
  await runSuggestedTradesOverviewControllerAssertions();
  runSuggestedTradeExecutionEntitySchemaAssertions();
  runSuggestedTradeValidationAssertions();
  await runSuggestedTradeExecutionStorageMigrationAssertions();
  await runSuggestedTradeExecutionProtectionMigrationAssertions();
  await runSuggestedTradeExecutionRouteAttemptsMigrationAssertions();
  await runSuggestedTradesReadPathAssertions();
  await runSuggestedTradesSummaryFilterAssertions();
  await runSuggestedTradeTransitionAssertions();
  await runSuggestedTradeExecutionPersistenceAssertions();
  await runSuggestedTradeBrokerControlHelperAssertions();
  await runSuggestedTradeLiveAutoRolloutAssertions();
  await runSuggestedTradeAdaptiveRouteSelectionAssertions();
  await runSuggestedTradeLiveAutoLifecycleMonitorAssertions();
  await runSuggestedTradeDeltaProductPreflightAssertions();
  await runSuggestedTradeReconcileAssertions();
  await runSuggestedTradeDeltaSymbolEquivalenceRepositoryAssertions();
  await runSuggestedTradeExecutionLinkPreservationAssertions();
  runSuggestedTradeDeltaClosedFilledTimestampAssertions();
  await runSuggestedTradeLimitOrderExpiryAssertions();
  await runSuggestedTradeBrokerLiveAutoSizingHandlerAssertions();
  await runSuggestedTradeBrokerLiveAutoProtectionAttachHandlerAssertions();
  await runSuggestedTradeBrokerProtectionRepairHandlerAssertions();
  await runSuggestedTradeProtectionRemediationAssertions();
  await runSuggestedTradeSiblingProtectionAutoCancelAssertions();
  await runSuggestedTradeMudrexLeverageReconciliationAssertions();
  await runSuggestedTradesBulkReconcileAssertions();
  await runSuggestedTradeProtectionRecoverySyncAssertions();
  await runSuggestedTradesProtectionGuardrailAssertions();
  await runSuggestedTradeExecutionSyncServiceAssertions();
  await runSuggestedTradesOverviewServiceAssertions();
  await runSuggestedTradesHealthServiceAssertions();
  runSuggestedTradesScriptWiringAssertions();
  console.log('Suggested trades module assertions passed.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
