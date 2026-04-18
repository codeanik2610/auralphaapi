import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { SuggestedTradesController } from '../src/api/controllers/SuggestedTradesController';
import { SuggestedTradesOverviewController } from '../src/api/controllers/SuggestedTradesOverviewController';
import { SuggestedTradeExecutionSyncService } from '../src/api/services/SuggestedTradeExecutionSyncService';
import { SuggestedTradesHealthService } from '../src/api/services/SuggestedTradesHealthService';
import { SuggestedTradesOverviewService } from '../src/api/services/SuggestedTradesOverviewService';
import { SuggestedTradesService } from '../src/api/services/SuggestedTradesService';
import {
  validateSuggestedTradeOrderLinkBody,
  validateSuggestedTradesExecutionSyncBody,
  validateSuggestedTradesQuery,
} from '../src/api/validators/suggestedTrades.validator';
import { SuggestedTrade } from '../src/database/entities/SuggestedTrade';
import { SuggestedTradeExecution } from '../src/database/entities/SuggestedTradeExecution';
import { HardenSuggestedTradeExecutionStorage1767300010000 } from '../src/database/migrations/1767300010000-HardenSuggestedTradeExecutionStorage';
import { env } from '../src/env';
import { getMetadataArgsStorage } from 'typeorm';

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
    (await controller.reviewSuggestedTrade(authReq, 'st-1', { note: 'reviewed' })).data.args,
    ['user-1', 'st-1', { note: 'reviewed' }]
  );
  assert.deepEqual(
    (await controller.acceptSuggestedTrade(authReq, 'st-2', { note: 'accepted' })).data.args,
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
  assert.deepEqual(
    (await controller.reconcileSuggestedTradeExecution(authReq, 'st-4')).data.args,
    ['user-1', 'st-4']
  );

  env.suggestedTrades.rolloutEnabled = false;
  await assert.rejects(
    () => controller.reconcileSuggestedTradesExecution(authReq, { staleOnly: true }),
    (error: unknown) =>
      error instanceof Error &&
      error.message === 'Suggested trades rollout controls are disabled'
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
      error instanceof Error &&
      error.message === 'Suggested trades overview rollout is disabled'
  );
  env.suggestedTrades.rolloutEnabled = originalRolloutEnabled;
}

function runSuggestedTradeExecutionEntitySchemaAssertions(): void {
  const suggestedTradeIndexes = getMetadataArgsStorage().indices
    .filter((entry) => entry.target === SuggestedTrade)
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
  assert.equal(
    createdIndexes.includes('idx_suggested_trade_executions_user_order_lookup'),
    true
  );
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
  assert.equal(detailResponse.data.syncStatus?.state, 'fresh');
  assert.ok((detailResponse.data.timeline?.length ?? 0) >= 3);
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
  assert.equal(response.data.accepted, 1);
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
  assert.deepEqual(savedTradeMeta, { signalId: 'sig-1' });
  assert.equal(response.data.suggestedTrade.execution?.paperOrderId, 'paper-1');
}

async function runSuggestedTradeLiveAutoRolloutAssertions(): Promise<void> {
  const service = new SuggestedTradesService() as any;
  const originalRolloutEnabled = env.suggestedTrades.rolloutEnabled;
  const originalEnvFlags = {
    rolloutEnabled: process.env.SUGGESTED_TRADES_ROLLOUT_ENABLED,
    enabled: process.env.SUGGESTED_TRADES_LIVE_AUTO_ENABLED,
    executionEnabled: process.env.SUGGESTED_TRADES_LIVE_AUTO_EXECUTION_ENABLED,
    requireFixedRouting: process.env.SUGGESTED_TRADES_LIVE_AUTO_REQUIRE_FIXED_ROUTING,
    userAllowlist: process.env.SUGGESTED_TRADES_LIVE_AUTO_USER_ALLOWLIST,
    brokerAllowlist: process.env.SUGGESTED_TRADES_LIVE_AUTO_BROKER_ALLOWLIST,
  };
  const originalLiveAuto = {
    enabled: env.suggestedTrades.liveAuto.enabled,
    executionEnabled: env.suggestedTrades.liveAuto.executionEnabled,
    requireFixedRouting: env.suggestedTrades.liveAuto.requireFixedRouting,
    userAllowlist: [...env.suggestedTrades.liveAuto.userAllowlist],
    brokerAllowlist: [...env.suggestedTrades.liveAuto.brokerAllowlist],
  };

  const baseTrade = {
    id: 'st-live-auto',
    automationId: 'auto-live',
    automationRunId: 'run-live',
    userId: 'user-1',
    symbol: 'BTCUSDT',
    timeframe: '1h',
    side: 'BUY',
    signalTime: new Date('2026-04-18T04:00:00.000Z'),
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
    createdAt: new Date('2026-04-18T04:00:30.000Z'),
    updatedAt: new Date('2026-04-18T04:01:00.000Z'),
  };

  let preTradeGateCalls = 0;
  let persistedExecution: Record<string, unknown> | null = null;
  const loggedActivities: string[] = [];

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
        externalId: 'mudrex-asset-1',
      };
    },
  };
  service.brokerReferenceDataService = {
    async getFuturesAssetDetailBySymbol() {
      return {
        data: {
          id: 'mudrex-asset-remote',
        },
      };
    },
  };
  service.loadTradeSuggestionExecutionPolicy = async () => ({
    executionMode: 'live_trade_auto',
    approvalMode: 'auto_if_safe',
    routeMode: 'fixed',
    brokerKey: 'mudrex',
    accountId: 'acc-1',
    liveConsentEnabled: true,
    orderType: 'market',
    timeInForce: null,
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
            brokerKey: 'mudrex',
            accountId: 'acc-1',
          },
          order: {
            entryPrice: 100,
            stopLossPrice: 95,
            takeProfitTargets: [108],
            leverage: 5,
            reduceOnly: false,
            orderType: 'market',
          },
        },
      },
      execution: {
        executionMode: 'live',
        preTradeState: 'passed',
        brokerKey: 'mudrex',
        accountId: 'acc-1',
        leverage: 5,
        quantity: 1,
      },
      ready: true,
    };
  };
  service.persistExecutionState = async (_trade: Record<string, unknown>, execution: Record<string, unknown>) => {
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
  };

  try {
    env.suggestedTrades.rolloutEnabled = true;
    env.suggestedTrades.liveAuto.enabled = false;
    env.suggestedTrades.liveAuto.executionEnabled = false;
    env.suggestedTrades.liveAuto.requireFixedRouting = true;
    env.suggestedTrades.liveAuto.userAllowlist = ['user-1'];
    env.suggestedTrades.liveAuto.brokerAllowlist = ['mudrex'];
    process.env.SUGGESTED_TRADES_ROLLOUT_ENABLED = 'true';
    process.env.SUGGESTED_TRADES_LIVE_AUTO_ENABLED = 'false';
    process.env.SUGGESTED_TRADES_LIVE_AUTO_EXECUTION_ENABLED = 'false';
    process.env.SUGGESTED_TRADES_LIVE_AUTO_REQUIRE_FIXED_ROUTING = 'true';
    process.env.SUGGESTED_TRADES_LIVE_AUTO_USER_ALLOWLIST = 'user-1';
    process.env.SUGGESTED_TRADES_LIVE_AUTO_BROKER_ALLOWLIST = 'mudrex';

    const disabled = await service.attemptAutoLiveExecutionForAutomation(
      'user-1',
      'st-live-auto',
      {
        async createOrder() {
          throw new Error('disabled path should not create orders');
        },
      }
    );
    assert.equal(disabled.outcome, 'disabled');
    assert.equal(preTradeGateCalls, 0);

    env.suggestedTrades.liveAuto.enabled = true;
    env.suggestedTrades.liveAuto.userAllowlist = [];
    process.env.SUGGESTED_TRADES_LIVE_AUTO_ENABLED = 'true';
    process.env.SUGGESTED_TRADES_LIVE_AUTO_USER_ALLOWLIST = '';

    const blocked = await service.attemptAutoLiveExecutionForAutomation(
      'user-1',
      'st-live-auto',
      {
        async createOrder() {
          throw new Error('blocked path should not create orders');
        },
      }
    );
    assert.equal(blocked.outcome, 'blocked');
    assert.equal(blocked.message, 'Live auto rollout is enabled but no users are allowlisted yet');
    assert.equal(preTradeGateCalls, 0);

    env.suggestedTrades.liveAuto.userAllowlist = ['user-1'];
    env.suggestedTrades.liveAuto.brokerAllowlist = ['mudrex'];
    env.suggestedTrades.liveAuto.executionEnabled = false;
    process.env.SUGGESTED_TRADES_LIVE_AUTO_USER_ALLOWLIST = 'user-1';
    process.env.SUGGESTED_TRADES_LIVE_AUTO_BROKER_ALLOWLIST = 'mudrex';
    process.env.SUGGESTED_TRADES_LIVE_AUTO_EXECUTION_ENABLED = 'false';

    const ready = await service.attemptAutoLiveExecutionForAutomation(
      'user-1',
      'st-live-auto',
      {
        async createOrder() {
          throw new Error('ready path should not create orders when execution is disabled');
        },
      }
    );
    assert.equal(ready.outcome, 'ready');
    assert.equal(ready.preTradeCheckId, 'check-live-1');
    assert.equal(ready.brokerKey, 'mudrex');
    assert.equal(ready.accountId, 'acc-1');
    assert.equal(preTradeGateCalls, 1);
    assert.equal(
      (persistedExecution?.['note'] as string | undefined) ?? null,
      'Live auto rollout guard passed. Broker placement remains disabled until live auto execution is explicitly enabled.'
    );

    env.suggestedTrades.liveAuto.executionEnabled = true;
    process.env.SUGGESTED_TRADES_LIVE_AUTO_EXECUTION_ENABLED = 'true';

    const placed = await service.attemptAutoLiveExecutionForAutomation(
      'user-1',
      'st-live-auto',
      {
        async createOrder(assetId: string, body: Record<string, unknown>) {
          assert.equal(assetId, 'mudrex-asset-1');
          assert.equal(body.execution_mode, 'live');
          assert.equal(body.symbol, 'BTCUSDT');
          assert.equal(body.accountId, 'acc-1');
          assert.equal(body.brokerKey, 'mudrex');
          return {
            success: true,
            data: {
              order_id: 'live-order-1',
              status: 'OPEN',
            },
          };
        },
      }
    );
    assert.equal(placed.outcome, 'placed');
    assert.equal(placed.preTradeCheckId, 'check-live-1');
    assert.equal(placed.orderId, 'live-order-1');
    assert.equal(placed.brokerKey, 'mudrex');
    assert.equal(placed.accountId, 'acc-1');
    assert.equal(
      (persistedExecution?.['orderId'] as string | undefined) ?? null,
      'live-order-1'
    );
    assert.equal(
      (persistedExecution?.['executionState'] as string | undefined) ?? null,
      'linked'
    );
    assert.ok(loggedActivities.includes('Live auto rollout blocked: BTCUSDT'));
    assert.ok(loggedActivities.includes('Live auto rollout ready: BTCUSDT'));
    assert.ok(loggedActivities.includes('Live auto order created: BTCUSDT'));
  } finally {
    env.suggestedTrades.rolloutEnabled = originalRolloutEnabled;
    env.suggestedTrades.liveAuto.enabled = originalLiveAuto.enabled;
    env.suggestedTrades.liveAuto.executionEnabled = originalLiveAuto.executionEnabled;
    env.suggestedTrades.liveAuto.requireFixedRouting = originalLiveAuto.requireFixedRouting;
    env.suggestedTrades.liveAuto.userAllowlist = [...originalLiveAuto.userAllowlist];
    env.suggestedTrades.liveAuto.brokerAllowlist = [...originalLiveAuto.brokerAllowlist];
    restoreEnv('SUGGESTED_TRADES_ROLLOUT_ENABLED', originalEnvFlags.rolloutEnabled);
    restoreEnv('SUGGESTED_TRADES_LIVE_AUTO_ENABLED', originalEnvFlags.enabled);
    restoreEnv(
      'SUGGESTED_TRADES_LIVE_AUTO_EXECUTION_ENABLED',
      originalEnvFlags.executionEnabled
    );
    restoreEnv(
      'SUGGESTED_TRADES_LIVE_AUTO_REQUIRE_FIXED_ROUTING',
      originalEnvFlags.requireFixedRouting
    );
    restoreEnv('SUGGESTED_TRADES_LIVE_AUTO_USER_ALLOWLIST', originalEnvFlags.userAllowlist);
    restoreEnv(
      'SUGGESTED_TRADES_LIVE_AUTO_BROKER_ALLOWLIST',
      originalEnvFlags.brokerAllowlist
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

function runSuggestedTradesScriptWiringAssertions(): void {
  const packageSource = read('package.json');
  const packageJson = JSON.parse(packageSource) as { scripts?: Record<string, string> };
  const packageScripts = packageJson.scripts || {};
  const runPackageSuiteSource = read('scripts/_support/run-package-suite.ts');
  const proofSource = read('scripts/proofs/proof-suggested-trades-live.ts');
  const smokeSource = read('scripts/smokes/smoke-suggested-trades-lifecycle.ts');
  const checkSource = read('scripts/checks/check-suggested-trades-health.ts');
  const releaseGateSource = read('scripts/release-gates/release-gate-suggested-trades.ts');
  const signoffSource = read('scripts/signoffs/signoff-suggested-trades.ts');
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
    runPackageSuiteSource.includes("'suggested-trades': ['test:suggested-trades']"),
    true
  );
  assert.equal(runPackageSuiteSource.includes("'test:suggested-trades'"), true);

  assert.equal(
    proofSource.includes("scripts/smokes/smoke-suggested-trades-lifecycle.ts"),
    true,
    'suggested trades live proof must run lifecycle smoke'
  );
  assert.equal(
    proofSource.includes("scripts/checks/check-suggested-trades-health.ts"),
    true,
    'suggested trades live proof must run health check'
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
  assert.equal(
    releaseGateSource.includes('smoke-suggested-trades-lifecycle.ts'),
    true,
    'suggested trades release gate must execute lifecycle smoke'
  );
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
    'SUGGESTED_TRADES_LIVE_AUTO_REQUIRE_FIXED_ROUTING',
    'SUGGESTED_TRADES_LIVE_AUTO_USER_ALLOWLIST',
    'SUGGESTED_TRADES_LIVE_AUTO_BROKER_ALLOWLIST',
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
    'pre_trade_check',
  ]) {
    assert.equal(
      serviceSource.includes(marker),
      true,
      `SuggestedTradesService must retain ${marker} for live-auto auditability`
    );
  }
}

async function main(): Promise<void> {
  await runSuggestedTradesControllerAssertions();
  await runSuggestedTradesOverviewControllerAssertions();
  runSuggestedTradeExecutionEntitySchemaAssertions();
  runSuggestedTradeValidationAssertions();
  await runSuggestedTradeExecutionStorageMigrationAssertions();
  await runSuggestedTradesReadPathAssertions();
  await runSuggestedTradesSummaryFilterAssertions();
  await runSuggestedTradeTransitionAssertions();
  await runSuggestedTradeExecutionPersistenceAssertions();
  await runSuggestedTradeLiveAutoRolloutAssertions();
  await runSuggestedTradeReconcileAssertions();
  await runSuggestedTradesBulkReconcileAssertions();
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
