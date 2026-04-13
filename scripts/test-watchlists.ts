import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { WatchlistsController } from '../src/api/controllers/WatchlistsController';
import { WatchlistsService } from '../src/api/services/WatchlistsService';
import {
  validateAddWatchlistItemsPayload,
  validateCreateWatchlistPayload,
  validateRemoveWatchlistItemsPayload,
  validateUpdateWatchlistPayload,
  validateWatchlistId,
  validateWatchlistItemsQuery,
} from '../src/api/validators/watchlists.validator';

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

async function runWatchlistsControllerAssertions(): Promise<void> {
  const controller: any = new WatchlistsController();

  controller.watchlistsService = {
    getWatchlists: async (...args: unknown[]) => createSuccess({ args }),
    getWatchlistsSummary: async (...args: unknown[]) => createSuccess({ args }),
    getWatchlistsOverview: async (...args: unknown[]) => createSuccess({ args }),
    createWatchlist: async (...args: unknown[]) => createSuccess({ args }),
    updateWatchlist: async (...args: unknown[]) => createSuccess({ args }),
    getWatchlistById: async (...args: unknown[]) => createSuccess({ args }),
    deleteWatchlist: async (...args: unknown[]) => createSuccess({ args }),
    getWatchlistItems: async (...args: unknown[]) => createSuccess({ args }),
    addWatchlistItems: async (...args: unknown[]) => createSuccess({ args }),
    removeWatchlistItems: async (...args: unknown[]) => createSuccess({ args }),
  };

  assert.deepEqual((await controller.getWatchlists(authReq)).data.args, ['user-1']);
  assert.deepEqual((await controller.getWatchlistsSummary(authReq)).data.args, ['user-1']);
  assert.deepEqual(
    (await controller.getWatchlistsOverview(authReq, 'wl-1', '5', '10', 'btc')).data.args,
    ['user-1', { watchlistId: 'wl-1', limit: '5', offset: '10', search: 'btc' }]
  );
  assert.deepEqual(
    (
      await controller.createWatchlist(authReq, {
        name: 'Priority majors',
        description: 'Core symbols for daily review',
      })
    ).data.args,
    [
      'user-1',
      {
        name: 'Priority majors',
        description: 'Core symbols for daily review',
      },
    ]
  );
  assert.deepEqual(
    (await controller.updateWatchlist(authReq, 'wl-1', { name: 'Updated majors' })).data.args,
    ['user-1', 'wl-1', { name: 'Updated majors' }]
  );
  assert.deepEqual((await controller.getWatchlistById(authReq, 'wl-1')).data.args, [
    'user-1',
    'wl-1',
  ]);
  assert.deepEqual((await controller.deleteWatchlist(authReq, 'wl-1')).data.args, [
    'user-1',
    'wl-1',
  ]);
  assert.deepEqual((await controller.getWatchlistItems(authReq, 'wl-1', '5', '10', 'btc')).data.args, [
    'user-1',
    'wl-1',
    { limit: '5', offset: '10', search: 'btc' },
  ]);
  assert.deepEqual(
    (await controller.addWatchlistItems(authReq, 'wl-1', { symbols: ['BTCUSDT'] })).data.args,
    ['user-1', 'wl-1', { symbols: ['BTCUSDT'] }]
  );
  assert.deepEqual(
    (await controller.removeWatchlistItems(authReq, 'wl-1', { symbol: 'ETHUSDT' })).data.args,
    ['user-1', 'wl-1', { symbol: 'ETHUSDT' }]
  );

  await assertAuthRequired(() => controller.getWatchlists(unauthReq));
  await assertAuthRequired(() => controller.getWatchlistsSummary(unauthReq));
  await assertAuthRequired(() => controller.getWatchlistsOverview(unauthReq));
  await assertAuthRequired(() => controller.createWatchlist(unauthReq, {}));
  await assertAuthRequired(() => controller.updateWatchlist(unauthReq, 'wl-1', {}));
  await assertAuthRequired(() => controller.getWatchlistById(unauthReq, 'wl-1'));
  await assertAuthRequired(() => controller.deleteWatchlist(unauthReq, 'wl-1'));
  await assertAuthRequired(() => controller.getWatchlistItems(unauthReq, 'wl-1'));
  await assertAuthRequired(() => controller.addWatchlistItems(unauthReq, 'wl-1', {}));
  await assertAuthRequired(() => controller.removeWatchlistItems(unauthReq, 'wl-1', {}));
}

function runWatchlistsValidationAssertions(): void {
  assert.equal(validateWatchlistId('  wl-1  '), 'wl-1');
  assert.throws(() => validateWatchlistId('   '), /watchlistId is required/);

  assert.deepEqual(
    validateWatchlistItemsQuery({
      limit: '25',
      offset: '5',
      search: ' btc ',
    }),
    {
      limit: 25,
      offset: 5,
      search: 'btc',
    }
  );
  assert.throws(
    () => validateWatchlistItemsQuery({ limit: '0' }),
    /limit must be an integer between 1 and 100/
  );
  assert.throws(
    () => validateWatchlistItemsQuery({ offset: '-1' }),
    /offset must be an integer greater than or equal to 0/
  );

  assert.deepEqual(
    validateCreateWatchlistPayload({
      name: ' Priority majors ',
      type: ' manual ',
      description: ' Core symbols ',
    }),
    {
      name: 'Priority majors',
      type: 'Manual',
      description: 'Core symbols',
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
      description: '',
    }),
    {
      name: 'Updated majors',
      description: null,
    }
  );
  assert.throws(
    () => validateUpdateWatchlistPayload({}),
    /At least one watchlist field must be provided/
  );

  assert.deepEqual(
    validateAddWatchlistItemsPayload({
      symbols: ['ethusdt', 'BTCUSDT', ' '],
      symbol: ' btcusdt ',
    }),
    {
      symbols: ['ETHUSDT', 'BTCUSDT'],
    }
  );
  assert.deepEqual(
    validateRemoveWatchlistItemsPayload({
      symbol: ' solusdt ',
      symbols: ['SOLUSDT', 'ethusdt'],
    }),
    {
      symbols: ['SOLUSDT', 'ETHUSDT'],
    }
  );
  assert.throws(
    () => validateAddWatchlistItemsPayload({}),
    /symbol is required/
  );
}

async function runWatchlistsReadModelAssertions(): Promise<void> {
  const service = new WatchlistsService() as any;
  const itemsCalls: Array<Record<string, unknown>> = [];
  const summary = {
    total: 2,
    manualCount: 1,
    smartCount: 1,
    totalItems: 3,
  };

  service.watchlistRepository = {
    async listWatchlists() {
      return [
        {
          id: 'wl-1',
          name: 'Priority majors',
          type: 'Manual',
          description: 'Core symbols for daily review',
          itemsCount: 2,
          updatedAt: new Date('2026-04-06T12:00:00.000Z'),
        },
        {
          id: 'wl-smart',
          name: 'System leaders',
          type: 'Smart',
          description: 'Auto managed',
          itemsCount: 1,
          updatedAt: new Date('2026-04-06T13:00:00.000Z'),
        },
      ];
    },
    async getWatchlistsSummary() {
      return summary;
    },
    async getWatchlistById(_userId: string, watchlistId: string) {
      return {
        id: watchlistId,
        name: 'Priority majors',
        type: 'Manual',
        description: 'Core symbols for daily review',
        itemsCount: 2,
        updatedAt: new Date('2026-04-06T12:00:00.000Z'),
      };
    },
    async listWatchlistItems(
      userId: string,
      watchlistId: string,
      params: Record<string, unknown>
    ) {
      itemsCalls.push({ userId, watchlistId, params });
      return {
        items: [
          {
            id: 'item-1',
            symbol: 'BTCUSDT',
            regime: 'Trend',
            signal: 'Watching',
            aiScore: 0.91,
            setup: 'Breakout',
            status: 'Active',
            alerts: 2,
            liquidity: 'Core',
            volume24h: 120_000_000,
            change24h: 1.2,
          },
        ],
        total: 1,
      };
    },
  };
  service.marketMetricsService = {
    async getMetricsForSymbols(symbols: string[]) {
      assert.deepEqual(symbols, ['BTCUSDT']);
      return new Map([
        [
          'BTCUSDT',
          {
            lastPrice: 67_250.12,
            changePerc: 3.42,
            volume24h: 184_000_000,
            high24h: 67_500.45,
            low24h: 66_120.11,
            priceSource: 'pg.market_candles_1m',
            snapshotAt: new Date('2026-04-06T09:58:00.000Z'),
          },
        ],
      ]);
    },
  };

  const listResponse = await service.getWatchlists('user-1');
  assert.equal(listResponse.data.items.length, 2);
  assert.equal(listResponse.data.items[0]?.editable, true);
  assert.equal(listResponse.data.items[1]?.editable, false);
  assert.equal(listResponse.data.items[1]?.description, 'Auto managed');

  const itemsResponse = await service.getWatchlistItems('user-1', 'wl-1', {
    limit: '10',
    offset: '2',
    search: ' btc ',
  });
  assert.deepEqual(itemsCalls[0], {
    userId: 'user-1',
    watchlistId: 'wl-1',
    params: { limit: 10, offset: 2, search: 'btc' },
  });
  assert.equal(itemsResponse.data.items[0]?.symbol, 'BTCUSDT');
  assert.equal(itemsResponse.data.items[0]?.lastPrice, 67_250.12);
  assert.equal(itemsResponse.data.items[0]?.priceSource, 'pg.market_candles_1m');
  assert.equal(itemsResponse.data.items[0]?.snapshotAt, '2026-04-06T09:58:00.000Z');
  assert.equal(itemsResponse.data.limit, 10);
  assert.equal(itemsResponse.data.offset, 2);

  const overviewResponse = await service.getWatchlistsOverview('user-1', {
    watchlistId: 'wl-1',
    limit: '5',
    offset: '1',
    search: ' majors ',
  });
  assert.deepEqual(overviewResponse.data.summary, summary);
  assert.equal(overviewResponse.data.activeWatchlistId, 'wl-1');
  assert.equal(overviewResponse.data.activeWatchlist?.name, 'Priority majors');
  assert.equal(overviewResponse.data.activeWatchlist?.editable, true);
  assert.equal(overviewResponse.data.watchlists.items.length, 2);
  assert.equal(overviewResponse.data.items.items[0]?.symbol, 'BTCUSDT');
  assert.equal(itemsCalls[1]?.watchlistId, 'wl-1');
  assert.deepEqual(itemsCalls[1]?.params, {
    limit: 5,
    offset: 1,
    search: 'majors',
  });
}

async function runWatchlistsCreateAndDeleteAssertions(): Promise<void> {
  const service = new WatchlistsService() as any;
  const activityLogs: Array<Record<string, unknown>> = [];
  const failureAlerts: Array<Record<string, unknown>> = [];
  const repositoryCalls: Array<Record<string, unknown>> = [];

  service.watchlistRepository = {
    isDuplicateWatchlistNameError() {
      return false;
    },
    async createWatchlist(userId: string, input: Record<string, unknown>) {
      repositoryCalls.push({ kind: 'create', userId, input });
      return {
        id: 'wl-1',
        name: String(input.name),
        type: 'Manual',
        description: input.description ?? null,
        itemsCount: 0,
        updatedAt: new Date('2026-04-06T12:00:00.000Z'),
      };
    },
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
    async deleteWatchlist(userId: string, watchlistId: string) {
      repositoryCalls.push({ kind: 'delete', userId, watchlistId });
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

  const createResponse = await service.createWatchlist('user-1', {
    name: ' Priority majors ',
    description: ' Core symbols for daily review ',
  });
  assert.deepEqual(repositoryCalls[0], {
    kind: 'create',
    userId: 'user-1',
    input: {
      name: 'Priority majors',
      type: 'Manual',
      description: 'Core symbols for daily review',
    },
  });
  assert.equal(createResponse.data.message, 'Watchlist created');
  assert.equal(createResponse.data.watchlist.editable, true);
  assert.equal(activityLogs[0]?.title, 'Watchlist created: Priority majors');

  const deleteResponse = await service.deleteWatchlist('user-1', ' wl-1 ');
  assert.deepEqual(repositoryCalls[1], {
    kind: 'delete',
    userId: 'user-1',
    watchlistId: 'wl-1',
  });
  assert.equal(deleteResponse.data.message, 'Watchlist deleted');
  assert.equal(deleteResponse.data.watchlistId, 'wl-1');
  assert.equal(activityLogs[1]?.title, 'Watchlist deleted');
  assert.equal(failureAlerts.length, 0);
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
    async updateWatchlist(userId: string, watchlistId: string, input: Record<string, unknown>) {
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
  assert.equal(activityLogs[0]?.title, 'Watchlist updated: Priority majors');
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
  assert.equal(activityLogs[0]?.status, 'Failed');
  assert.equal(activityLogs[1]?.status, 'Failed');
  assert.equal(failureAlerts.length, 2);
  assert.match(
    String(failureAlerts[0]?.message || ''),
    /A watchlist named "Priority majors" already exists for this workspace/
  );
  assert.match(
    String(failureAlerts[1]?.message || ''),
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
  assert.equal(activityLogs[0]?.status, 'Success');
  assert.match(String(activityLogs[0]?.description || ''), /Added 0 symbols/);
  assert.equal(failureAlerts.length, 0);
}

async function runWatchlistsRemoveItemsAssertions(): Promise<void> {
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
        itemsCount: 2,
        updatedAt: new Date('2026-04-06T12:00:00.000Z'),
      };
    },
    async removeWatchlistItems(userId: string, watchlistId: string, symbols: string[]) {
      repositoryCalls.push({ userId, watchlistId, symbols });
      return {
        removed: ['ETHUSDT'],
        skipped: ['SOLUSDT'],
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

  const response = await service.removeWatchlistItems('user-1', 'wl-1', {
    symbols: ['ethusdt', 'solusdt'],
  });

  assert.deepEqual(repositoryCalls, [
    {
      userId: 'user-1',
      watchlistId: 'wl-1',
      symbols: ['ETHUSDT', 'SOLUSDT'],
    },
  ]);
  assert.equal(response.data.message, 'Watchlist items removed');
  assert.deepEqual(response.data.removed, ['ETHUSDT']);
  assert.deepEqual(response.data.skipped, ['SOLUSDT']);
  assert.equal(activityLogs.length, 1);
  assert.equal(activityLogs[0]?.title, 'Watchlist items removed');
  assert.match(String(activityLogs[0]?.description || ''), /Removed 1 symbols/);
  assert.equal(failureAlerts.length, 0);
}

function runWatchlistsScriptWiringAssertions(): void {
  const packageSource = read('package.json');
  const packageJson = JSON.parse(packageSource) as { scripts?: Record<string, string> };
  const packageScripts = packageJson.scripts || {};
  const runPackageSuiteSource = read('scripts/_support/run-package-suite.ts');
  const smokeModulesSource = read('scripts/smokes/smoke-modules.sh');

  assert.equal(
    packageScripts['test:watchlists'],
    'node --import tsx scripts/_support/run-doc-aware-test.ts scripts/test-watchlists.ts'
  );
  assert.match(runPackageSuiteSource, /'test:watchlists'/);
  assert.match(runPackageSuiteSource, /watchlists:\s*\['test:watchlists'\]/);
  assert.match(smokeModulesSource, /\/watchlists/);
  assert.match(smokeModulesSource, /\/watchlists\/summary/);
  assert.equal(
    packageScripts['check:watchlists-health'],
    'node --import tsx scripts/checks/check-watchlists-health.ts'
  );
  assert.equal(
    packageScripts['release-gate:watchlists'],
    'node --import tsx scripts/release-gates/release-gate-watchlists.ts'
  );
  assert.equal(
    packageScripts['signoff:watchlists'],
    'node --import tsx scripts/signoffs/signoff-watchlists.ts'
  );
}

async function main(): Promise<void> {
  await runWatchlistsControllerAssertions();
  runWatchlistsValidationAssertions();
  await runWatchlistsReadModelAssertions();
  await runWatchlistsCreateAndDeleteAssertions();
  await runWatchlistsLifecycleAssertions();
  await runWatchlistsConflictAssertions();
  await runWatchlistsDuplicateAddRaceAssertions();
  await runWatchlistsRemoveItemsAssertions();
  runWatchlistsScriptWiringAssertions();
  console.log('Watchlists module assertions passed.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
