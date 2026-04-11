import assert from 'node:assert/strict';
import { InternalOrdersSyncService } from '../src/api/services/InternalOrdersSyncService';
import { OrdersSchedulerService } from '../src/api/services/OrdersSchedulerService';
import { SchedulerRuntimeSchemaService } from '../src/api/services/SchedulerRuntimeSchemaService';
import { coreDataSource } from '../src/database/data-source';
import { CreateOrdersSchedulerRuntimeTables1770706000000 } from '../src/database/migrations/1770706000000-CreateOrdersSchedulerRuntimeTables';

function createOrdersConfig(overrides: Record<string, unknown> = {}) {
  return {
    key: 'orders-sync',
    name: 'Orders Sync',
    description:
      'System reconciliation scheduler for broker order snapshots, checkpoints, and repair replay tooling.',
    enabled: true,
    cronExpression: '0 1 * * *',
    timezone: 'UTC',
    runAt: '01:00',
    intervalDays: 1,
    batchSize: 200,
    schedulerType: 'global',
    config: {
      sources: ['orders'],
      retentionDays: 30,
      lookbackDays: 45,
    },
    lastStartedAt: null,
    lastFinishedAt: null,
    lastStatus: null,
    lastError: null,
    createdAt: new Date('2026-04-10T00:00:00.000Z'),
    updatedAt: new Date('2026-04-10T00:00:00.000Z'),
    ...overrides,
  };
}

function createMigrationQueryRunner(options: {
  hasTable?: Record<string, boolean>;
  hasColumn?: Record<string, boolean>;
  existingIndexes?: Record<string, string[]>;
}) {
  const queries: Array<{ sql: string; params?: unknown[] }> = [];

  const queryRunner = {
    async hasTable(tableName: string) {
      return options.hasTable?.[tableName] ?? false;
    },
    async hasColumn(tableName: string, columnName: string) {
      return options.hasColumn?.[`${tableName}.${columnName}`] ?? false;
    },
    async query(sql: string, params?: unknown[]) {
      queries.push({ sql, params });

      if (sql.startsWith('SHOW INDEX FROM ')) {
        const tableName = sql.includes('scheduler_orders_snapshots')
          ? 'scheduler_orders_snapshots'
          : 'scheduler_sync_checkpoints';
        const indexName = String(params?.[0] || '');
        const indexes = options.existingIndexes?.[tableName] || [];
        return indexes.includes(indexName) ? [{ Key_name: indexName }] : [];
      }

      return [];
    },
  };

  return { queryRunner, queries };
}

async function testOrdersRuntimeMigrationCreatesTablesAndNormalizesOwnership(): Promise<void> {
  const migration = new CreateOrdersSchedulerRuntimeTables1770706000000();
  const { queryRunner, queries } = createMigrationQueryRunner({
    hasTable: {
      scheduler_configs: true,
      scheduler_user_configs: true,
      scheduler_sync_checkpoints: false,
      scheduler_orders_snapshots: false,
    },
    hasColumn: {
      'scheduler_configs.scheduler_type': true,
    },
  });

  await migration.up(queryRunner as any);

  assert.ok(
    queries.some(
      (entry) =>
        entry.sql.includes('UPDATE scheduler_configs') &&
        entry.sql.includes("scheduler_type = 'global'") &&
        entry.sql.includes('repair replay tooling')
    ),
    'Phase 5 migration should normalize orders scheduler ownership in scheduler_configs'
  );
  assert.ok(
    queries.some(
      (entry) =>
        entry.sql.includes('DELETE FROM scheduler_user_configs') &&
        entry.sql.includes("scheduler_key = 'orders-sync'")
    ),
    'Phase 5 migration should retire any user-scoped orders scheduler config rows'
  );
  assert.ok(
    queries.some((entry) =>
      entry.sql.includes('CREATE TABLE IF NOT EXISTS scheduler_sync_checkpoints')
    ),
    'Phase 5 migration should create the shared checkpoint table when missing'
  );
  assert.ok(
    queries.some((entry) =>
      entry.sql.includes('CREATE TABLE IF NOT EXISTS scheduler_orders_snapshots')
    ),
    'Phase 5 migration should create the orders snapshot table when missing'
  );
  assert.ok(
    queries.some((entry) =>
      entry.sql.includes('idx_scheduler_orders_user_account_status_seen')
    ),
    'Phase 5 migration should create the orders read-path status/seen index'
  );
}

async function testOrdersRuntimeMigrationRepairsDriftedTables(): Promise<void> {
  const migration = new CreateOrdersSchedulerRuntimeTables1770706000000();
  const { queryRunner, queries } = createMigrationQueryRunner({
    hasTable: {
      scheduler_sync_checkpoints: true,
      scheduler_orders_snapshots: true,
    },
    hasColumn: {
      'scheduler_orders_snapshots.payload_hash': false,
    },
    existingIndexes: {
      scheduler_sync_checkpoints: [],
      scheduler_orders_snapshots: ['uidx_scheduler_orders_snapshot'],
    },
  });

  await migration.up(queryRunner as any);

  assert.ok(
    queries.some((entry) =>
      entry.sql.includes('ADD UNIQUE KEY uidx_sync_checkpoint')
    ),
    'Phase 5 migration should restore the shared checkpoint uniqueness guard'
  );
  assert.ok(
    queries.some((entry) =>
      entry.sql.includes('ADD COLUMN payload_hash char(64) NULL AFTER payload_json')
    ),
    'Phase 5 migration should repair payload_hash drift on orders snapshots'
  );
  assert.ok(
    queries.some((entry) =>
      entry.sql.includes('ADD KEY idx_scheduler_orders_user_account_status_updated')
    ),
    'Phase 5 migration should add the orders updated-at read-path index when missing'
  );
}

async function testOrdersRuntimeMigrationDownKeepsSharedCheckpointFoundation(): Promise<void> {
  const migration = new CreateOrdersSchedulerRuntimeTables1770706000000();
  const { queryRunner, queries } = createMigrationQueryRunner({
    hasTable: {
      scheduler_configs: true,
      scheduler_orders_snapshots: true,
      scheduler_sync_checkpoints: true,
    },
  });

  await migration.down(queryRunner as any);

  assert.ok(
    queries.some(
      (entry) =>
        entry.sql.includes('UPDATE scheduler_configs') &&
        entry.sql.includes('pending-first checkpoints and data-loss guards')
    ),
    'Phase 5 migration down should restore the legacy orders scheduler description'
  );
  assert.ok(
    queries.some((entry) =>
      entry.sql.includes('DROP TABLE IF EXISTS scheduler_orders_snapshots')
    ),
    'Phase 5 migration down should retire the orders snapshot table'
  );
  assert.equal(
    queries.some((entry) =>
      entry.sql.includes('DROP TABLE IF EXISTS scheduler_sync_checkpoints')
    ),
    false,
    'Phase 5 migration down should keep the shared checkpoint foundation in place'
  );
}

async function testOrdersRuntimeSchemaServiceCachesReadyState(): Promise<void> {
  const service = new SchedulerRuntimeSchemaService();
  const originalQuery = (coreDataSource as any).query;
  const capturedQueries: Array<{ sql: string; params: unknown[] }> = [];

  (coreDataSource as any).query = async (sql: string, params: unknown[] = []) => {
    capturedQueries.push({ sql, params });
    if (sql.includes('FROM information_schema.tables')) {
      return [
        { tableName: 'scheduler_sync_checkpoints' },
        { tableName: 'scheduler_orders_snapshots' },
      ];
    }
    if (sql.includes('FROM information_schema.columns')) {
      return [{ columnName: 'payload_hash' }];
    }
    throw new Error(`Unexpected SQL in schedulers phase 5 schema-ready test: ${sql}`);
  };

  try {
    await service.assertOrdersRuntimeSchemaReady();
    await service.assertOrdersRuntimeSchemaReady();

    assert.equal(capturedQueries.length, 2);
  } finally {
    (coreDataSource as any).query = originalQuery;
  }
}

async function testOrdersRuntimeSchemaServiceFailsFastWithMigrationHint(): Promise<void> {
  const service = new SchedulerRuntimeSchemaService();
  const originalQuery = (coreDataSource as any).query;

  (coreDataSource as any).query = async (sql: string) => {
    if (sql.includes('FROM information_schema.tables')) {
      return [{ tableName: 'scheduler_sync_checkpoints' }];
    }
    if (sql.includes('FROM information_schema.columns')) {
      return [];
    }
    throw new Error(`Unexpected SQL in schedulers phase 5 schema-missing test: ${sql}`);
  };

  try {
    await assert.rejects(
      () => service.assertOrdersRuntimeSchemaReady(),
      (error: unknown) => {
        assert.equal(
          String((error as { code?: string }).code || ''),
          'ORDERS_SCHEDULER_SCHEMA_MISSING'
        );
        return true;
      }
    );
  } finally {
    (coreDataSource as any).query = originalQuery;
  }
}

async function testOrdersReplayResetCheckpointSkipsRuntimeDdl(): Promise<void> {
  const service = new OrdersSchedulerService() as any;
  const originalQuery = (coreDataSource as any).query;
  const capturedQueries: Array<{ sql: string; params: unknown[] }> = [];
  let schemaReadyCalls = 0;

  service.userTimeZoneService = {
    async resolveUserTimeZone() {
      return 'UTC';
    },
  };
  service.schedulerRuntimeSchemaService = {
    async assertOrdersRuntimeSchemaReady() {
      schemaReadyCalls += 1;
    },
  };
  service.schedulerConfigRepository = {
    async createIfMissing() {
      return createOrdersConfig();
    },
  };
  service.brokerAccountRepository = {
    async getAllActiveBrokerAccounts(brokerKey?: string) {
      assert.equal(brokerKey, 'delta_exchange');
      return [
        {
          id: 'acct-1',
          userId: 'owner-1',
          brokerKey: 'delta_exchange',
          status: 'Connected',
        },
        {
          id: 'acct-system',
          userId: null,
          brokerKey: 'delta_exchange',
          status: 'Connected',
        },
      ];
    },
  };
  service.schedulerCommandRepository = {
    async createCommand(payload: Record<string, unknown>) {
      return { id: 'command-1', payload };
    },
  };
  service.schedulerRunLogRepository = {
    async createRun(payload: Record<string, unknown>) {
      return payload;
    },
  };
  service.activityRepository = {
    async createActivityLog() {
      return null;
    },
  };
  service.alertRepository = {
    async findRecentOpenAlertBySource() {
      return null;
    },
    async createAlert() {
      return null;
    },
  };

  (coreDataSource as any).query = async (sql: string, params: unknown[] = []) => {
    capturedQueries.push({ sql, params });
    return [{ affectedRows: 1 }];
  };

  try {
    const response = await service.runNow('admin-user-1', {
      accountId: 'acct-1',
      brokerKey: 'DELTA_EXCHANGE',
      resetCheckpoint: true,
    });

    assert.equal(schemaReadyCalls, 1);
    assert.equal(
      capturedQueries.some((entry) =>
        entry.sql.includes('CREATE TABLE IF NOT EXISTS scheduler_sync_checkpoints')
      ),
      false
    );
    assert.ok(
      capturedQueries.some(
        (entry) =>
          entry.sql.includes('DELETE FROM scheduler_sync_checkpoints') &&
          entry.params[0] === 'orders-sync' &&
          entry.params[1] === 'acct-1'
      ),
      'Phase 5 replay should delete the checkpoint without issuing runtime DDL'
    );
    assert.match(
      response.data.message,
      /Orders replay queued for acct-1 \(delta_exchange\)\. Checkpoint reset; next run will backfill up to 45 days\./
    );
  } finally {
    (coreDataSource as any).query = originalQuery;
  }
}

async function testInternalOrdersSyncSkipsRuntimeDdlWhenSchemaIsReady(): Promise<void> {
  const service = new InternalOrdersSyncService() as any;
  const originalQuery = (coreDataSource as any).query;
  const capturedQueries: Array<{ sql: string; params: unknown[] }> = [];
  let schemaReadyCalls = 0;
  const activityCalls: Array<{ userId: string; payload: Record<string, unknown> }> = [];

  service.schedulerRuntimeSchemaService = {
    async assertOrdersRuntimeSchemaReady() {
      schemaReadyCalls += 1;
    },
  };
  service.operationalEventService = {
    async logActivity(userId: string, payload: Record<string, unknown>) {
      activityCalls.push({ userId, payload });
    },
    async emitFailureAlert() {
      return null;
    },
  };

  (coreDataSource as any).query = async (sql: string, params: unknown[] = []) => {
    capturedQueries.push({ sql, params });
    return [];
  };

  try {
    const response = await service.runBatch({
      targetUserIds: [],
    });

    assert.equal(schemaReadyCalls, 1);
    assert.equal(response.processedUsers, 0);
    assert.equal(
      capturedQueries.some((entry) => entry.sql.includes('CREATE TABLE IF NOT EXISTS')),
      false
    );
    assert.equal(activityCalls.length, 1);
    assert.equal(activityCalls[0].payload.title, 'Orders sync completed');
  } finally {
    (coreDataSource as any).query = originalQuery;
  }
}

async function run(): Promise<void> {
  await testOrdersRuntimeMigrationCreatesTablesAndNormalizesOwnership();
  await testOrdersRuntimeMigrationRepairsDriftedTables();
  await testOrdersRuntimeMigrationDownKeepsSharedCheckpointFoundation();
  await testOrdersRuntimeSchemaServiceCachesReadyState();
  await testOrdersRuntimeSchemaServiceFailsFastWithMigrationHint();
  await testOrdersReplayResetCheckpointSkipsRuntimeDdl();
  await testInternalOrdersSyncSkipsRuntimeDdlWhenSchemaIsReady();
  console.log('Schedulers Phase 5 assertions passed.');
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
