import assert from 'node:assert/strict';
import { InternalPositionsSyncService } from '../src/api/services/InternalPositionsSyncService';
import { coreDataSource } from '../src/database/data-source';
import { env } from '../src/env';

async function runSystemInfraCoverageAssertions(): Promise<void> {
  const service = new InternalPositionsSyncService();
  const routingCalls: Array<{ userId: string; brokerKey: string; accountId: string }> = [];
  const upsertCalls: Array<{ userId: string; accountId: string; brokerKey: string; items: unknown[] }> = [];
  let getAllActiveCalls = 0;
  let getActiveSystemCalls = 0;

  (service as any).brokerAccountRepository = {
    async getAllActiveBrokerAccounts() {
      getAllActiveCalls += 1;
      return [
        {
          id: 'account-1',
          userId: 'user-1',
          brokerKey: 'binance',
          createdAt: new Date('2026-04-01T00:00:00.000Z'),
        },
        {
          id: 'account-2',
          userId: 'user-2',
          brokerKey: 'binance',
          createdAt: new Date('2026-04-02T00:00:00.000Z'),
        },
        {
          id: 'account-system',
          userId: null,
          brokerKey: 'delta_exchange',
          createdAt: new Date('2026-04-03T00:00:00.000Z'),
        },
      ];
    },
    async getActiveSystemBrokerAccounts() {
      getActiveSystemCalls += 1;
      return [];
    },
    async getActiveBrokerAccounts() {
      throw new Error('runBatch should group infra-wide positions sync from getAllActiveBrokerAccounts');
    },
  };
  (service as any).brokerAccountRoutingService = {
    async resolve(userId: string, brokerKey: string, accountId: string) {
      routingCalls.push({ userId, brokerKey, accountId });
      return { userId, brokerKey, accountId };
    },
  };
  (service as any).brokerRuntimeRegistry = {
    getPositionsAdapter() {
      return {
        async getPositions() {
          return {
            data: [
              {
                id: 'position-1',
                symbol: 'BTCUSDT',
                status: 'open',
                quantity: '1',
                entry_price: '100',
              },
            ],
          };
        },
        async getPositionHistory() {
          return { data: [] };
        },
      };
    },
  };
  (service as any).exchangeAssetUpdateLogRepository = {
    async createMany() {},
  };
  (service as any).positionReadModelRepository = {
    async upsertReadModels() {},
    async markPositionsClosed() {},
  };
  (service as any).marketPriceBinanceRepository = {
    async getBySymbols() {
      return [];
    },
  };
  (service as any).operationalEventService = {
    async logActivity() {},
    async emitFailureAlert() {},
  };
  (service as any).suggestedTradesService = {
    async syncExecutionForPositionUpdates() {},
  };
  (service as any).ensureSyncPositionsSnapshotTable = async () => {};
  (service as any).ensureCheckpointTable = async () => {};
  (service as any).getCheckpoint = async () => null;
  (service as any).saveCheckpoint = async () => {};
  (service as any).upsertPositionSnapshotsFromItems = async (
    userId: string,
    accountId: string,
    brokerKey: string,
    items: unknown[]
  ) => {
    upsertCalls.push({ userId, accountId, brokerKey, items });
    return {
      inserted: items.length,
      updated: 0,
      skipped: 0,
      symbols: ['BTCUSDT'],
    };
  };

  const originalQuery = (coreDataSource as any).query;
  (coreDataSource as any).query = async (sql: string) => {
    const statement = String(sql || '');
    if (statement.includes('SELECT NOW() AS now')) {
      return [{ now: new Date('2026-04-09T00:00:00.000Z') }];
    }
    if (statement.includes('SELECT id, external_id, symbol, status, payload_json')) {
      return [];
    }
    if (statement.includes('UPDATE scheduler_positions_snapshots')) {
      return [{ affectedRows: 0 }];
    }
    throw new Error(`Unexpected SQL in positions scheduler phase 2 test: ${statement}`);
  };

  try {
    const result = await service.runBatch({
      targetUserIds: [env.scheduler.systemUserId],
      lookbackDays: 7,
      historyWindowDays: 1,
    });

    assert.equal(getAllActiveCalls, 1);
    assert.equal(getActiveSystemCalls, 0);
    assert.deepEqual(
      routingCalls.map((call) => call.userId),
      ['user-1', 'user-2']
    );
    assert.deepEqual(
      upsertCalls.map((call) => call.userId),
      ['user-1', 'user-2']
    );
    assert.equal(result.processedUsers, 2);
    assert.equal(result.succeededUsers, 2);
    assert.equal(result.failedUsers, 0);
    assert.equal(result.processedAccounts, 2);
    assert.equal(result.insertedRecords, 2);
    assert.equal(result.failures.length, 0);
  } finally {
    (coreDataSource as any).query = originalQuery;
  }
}

async function run(): Promise<void> {
  await runSystemInfraCoverageAssertions();
  console.log('Positions scheduler phase 2 assertions passed.');
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
