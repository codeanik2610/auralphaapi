import assert from 'node:assert/strict';

import { OrdersSchedulerService } from '../src/api/services/OrdersSchedulerService';
import { SchedulerRuntimeSchemaService } from '../src/api/services/SchedulerRuntimeSchemaService';
import { coreDataSource } from '../src/database/data-source';

async function testRuntimeSchemaServiceReportsReadyFoundation(): Promise<void> {
  const service = new SchedulerRuntimeSchemaService();
  const originalQuery = (coreDataSource as any).query;

  (coreDataSource as any).query = async (sql: string) => {
    if (sql.includes('FROM information_schema.tables')) {
      return [
        { tableName: 'scheduler_sync_checkpoints' },
        { tableName: 'scheduler_orders_snapshots' },
      ];
    }
    if (sql.includes('FROM information_schema.columns')) {
      return [{ columnName: 'payload_hash' }];
    }
    throw new Error(`Unexpected SQL in schedulers phase 7 runtime-ready test: ${sql}`);
  };

  try {
    const status = await service.inspectOrdersRuntimeSchema();

    assert.equal(status.status, 'ready');
    assert.equal(
      status.migrationName,
      '1770706000000-CreateOrdersSchedulerRuntimeTables'
    );
    assert.deepEqual(status.requiredTables, [
      'scheduler_sync_checkpoints',
      'scheduler_orders_snapshots',
    ]);
    assert.deepEqual(status.requiredColumns, ['scheduler_orders_snapshots.payload_hash']);
    assert.equal(status.missingParts, undefined);
  } finally {
    (coreDataSource as any).query = originalQuery;
  }
}

async function testRuntimeSchemaServiceReportsMissingFoundation(): Promise<void> {
  const service = new SchedulerRuntimeSchemaService();
  const originalQuery = (coreDataSource as any).query;

  (coreDataSource as any).query = async (sql: string) => {
    if (sql.includes('FROM information_schema.tables')) {
      return [{ tableName: 'scheduler_sync_checkpoints' }];
    }
    if (sql.includes('FROM information_schema.columns')) {
      return [];
    }
    throw new Error(`Unexpected SQL in schedulers phase 7 runtime-missing test: ${sql}`);
  };

  try {
    const status = await service.inspectOrdersRuntimeSchema();

    assert.equal(status.status, 'missing');
    assert.deepEqual(status.missingParts, ['scheduler_orders_snapshots']);
    assert.match(
      String(status.note || ''),
      /Run migration 1770706000000-CreateOrdersSchedulerRuntimeTables/
    );
  } finally {
    (coreDataSource as any).query = originalQuery;
  }
}

async function testOrdersSyncSummaryIncludesRuntimeFoundationStatus(): Promise<void> {
  const service = new OrdersSchedulerService() as any;
  const originalQuery = (coreDataSource as any).query;

  service.userTimeZoneService = {
    async resolveUserTimeZone() {
      return 'UTC';
    },
  };
  service.schedulerRuntimeSchemaService = {
    async inspectOrdersRuntimeSchema() {
      return {
        status: 'ready',
        migrationName: '1770706000000-CreateOrdersSchedulerRuntimeTables',
        requiredTables: ['scheduler_sync_checkpoints', 'scheduler_orders_snapshots'],
        requiredColumns: ['scheduler_orders_snapshots.payload_hash'],
        note: 'Orders runtime foundation is ready.',
      };
    },
  };

  (coreDataSource as any).query = async (sql: string) => {
    if (sql.includes('COUNT(*) AS totalAccounts') && sql.includes('pendingAgg')) {
      return [
        {
          totalAccounts: 3,
          accountsWithCheckpoint: 2,
          accountsWithoutCheckpoint: 1,
          accountsWithPending: 1,
          accountsWithFailed: 0,
          accountsWithRetryScheduled: 1,
          pendingRecords: 2,
          failedRecords: 0,
          resolvedRecords: 5,
          oldestCheckpointAt: '2026-04-10T01:00:00.000Z',
          latestCheckpointAt: '2026-04-10T03:00:00.000Z',
          latestPendingUpdateAt: '2026-04-10T03:05:00.000Z',
          nextRetryAt: '2026-04-10T03:10:00.000Z',
        },
      ];
    }
    throw new Error(`Unexpected SQL in schedulers phase 7 summary-foundation test: ${sql}`);
  };

  try {
    const response = await service.getSchedulerSyncStateSummary('admin-user-1');

    assert.equal(response.data.schedulerKey, 'orders-sync');
    assert.equal(response.data.totalAccounts, 3);
    assert.equal(response.data.runtimeFoundation?.status, 'ready');
    assert.equal(
      response.data.runtimeFoundation?.migrationName,
      '1770706000000-CreateOrdersSchedulerRuntimeTables'
    );
  } finally {
    (coreDataSource as any).query = originalQuery;
  }
}

async function testOrdersSyncSummaryFallsBackCleanlyWhenRuntimeFoundationMissing(): Promise<void> {
  const service = new OrdersSchedulerService() as any;
  const originalQuery = (coreDataSource as any).query;
  const capturedQueries: string[] = [];

  service.userTimeZoneService = {
    async resolveUserTimeZone() {
      return 'UTC';
    },
  };
  service.schedulerRuntimeSchemaService = {
    async inspectOrdersRuntimeSchema() {
      return {
        status: 'missing',
        migrationName: '1770706000000-CreateOrdersSchedulerRuntimeTables',
        requiredTables: ['scheduler_sync_checkpoints', 'scheduler_orders_snapshots'],
        requiredColumns: ['scheduler_orders_snapshots.payload_hash'],
        missingParts: ['scheduler_orders_snapshots'],
        note: 'Run migration first.',
      };
    },
  };

  (coreDataSource as any).query = async (sql: string) => {
    capturedQueries.push(sql);
    if (sql.includes('SELECT COUNT(*) AS totalAccounts') && !sql.includes('pendingAgg')) {
      return [{ totalAccounts: 2 }];
    }
    throw new Error(`Unexpected SQL in schedulers phase 7 summary-fallback test: ${sql}`);
  };

  try {
    const response = await service.getSchedulerSyncStateSummary('admin-user-1');

    assert.equal(response.data.totalAccounts, 2);
    assert.equal(response.data.runtimeFoundation?.status, 'missing');
    assert.deepEqual(response.data.runtimeFoundation?.missingParts, [
      'scheduler_orders_snapshots',
    ]);
    assert.equal(
      capturedQueries.some((sql) => sql.includes('pendingAgg')),
      false,
      'orders summary should avoid querying missing runtime tables once runtime foundation is known missing'
    );
  } finally {
    (coreDataSource as any).query = originalQuery;
  }
}

async function run(): Promise<void> {
  await testRuntimeSchemaServiceReportsReadyFoundation();
  await testRuntimeSchemaServiceReportsMissingFoundation();
  await testOrdersSyncSummaryIncludesRuntimeFoundationStatus();
  await testOrdersSyncSummaryFallsBackCleanlyWhenRuntimeFoundationMissing();
  console.log('Schedulers Phase 7 assertions passed.');
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
