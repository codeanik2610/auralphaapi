import { Service } from 'typedi';
import { coreDataSource } from '../../database/data-source';
import { SchedulerRuntimeFoundationStatus } from '../contracts/Scheduler';
import { ServiceUnavailableAppError } from '../errors/AppError';

const ORDERS_RUNTIME_SCHEMA_MIGRATION =
  '1770706000000-CreateOrdersSchedulerRuntimeTables';
const ORDERS_RUNTIME_TABLES = [
  'scheduler_sync_checkpoints',
  'scheduler_orders_snapshots',
] as const;
const ORDERS_RUNTIME_REQUIRED_COLUMNS = ['payload_hash'] as const;
const FUNDS_RUNTIME_SCHEMA_MIGRATION = '1770707000000-HardenFundsSnapshotsRuntime';
const FUNDS_RUNTIME_TABLES = ['funds_snapshots'] as const;
const FUNDS_RUNTIME_REQUIRED_COLUMNS = [
  'snapshot_date',
  'observed_at',
  'last_attempt_at',
  'fetch_status',
  'error_message',
  'source',
] as const;
const FUNDS_RUNTIME_REQUIRED_INDEXES = [
  'uidx_funds_snapshots_user_account_day',
  'idx_funds_snapshots_user_status_attempt',
  'idx_funds_snapshots_user_broker_account_attempt',
] as const;

@Service()
export class SchedulerRuntimeSchemaService {
  private ordersRuntimeSchemaReady = false;

  private ordersRuntimeSchemaStatus: SchedulerRuntimeFoundationStatus | null = null;

  private ordersRuntimeSchemaPromise: Promise<void> | null = null;

  private fundsRuntimeSchemaReady = false;

  private fundsRuntimeSchemaStatus: SchedulerRuntimeFoundationStatus | null = null;

  private fundsRuntimeSchemaPromise: Promise<void> | null = null;

  async inspectOrdersRuntimeSchema(): Promise<SchedulerRuntimeFoundationStatus> {
    if (this.ordersRuntimeSchemaReady && this.ordersRuntimeSchemaStatus) {
      return this.cloneOrdersRuntimeSchemaStatus(this.ordersRuntimeSchemaStatus);
    }

    const status = await this.loadOrdersRuntimeSchemaStatus();
    if (status.status === 'ready') {
      this.ordersRuntimeSchemaReady = true;
      this.ordersRuntimeSchemaStatus = status;
    } else {
      this.ordersRuntimeSchemaReady = false;
      this.ordersRuntimeSchemaStatus = null;
    }

    return this.cloneOrdersRuntimeSchemaStatus(status);
  }

  async assertOrdersRuntimeSchemaReady(): Promise<void> {
    if (this.ordersRuntimeSchemaReady) {
      return;
    }

    if (!this.ordersRuntimeSchemaPromise) {
      this.ordersRuntimeSchemaPromise = this.inspectOrdersRuntimeSchema()
        .then(() => {
          if (!this.ordersRuntimeSchemaReady || !this.ordersRuntimeSchemaStatus) {
            throw new ServiceUnavailableAppError(
              this.buildMissingOrdersRuntimeSchemaMessage([]),
              'ORDERS_SCHEDULER_SCHEMA_MISSING'
            );
          }
        })
        .catch((error) => {
          this.ordersRuntimeSchemaPromise = null;
          throw error;
        });
    }

    await this.ordersRuntimeSchemaPromise;
  }

  async inspectFundsRuntimeSchema(): Promise<SchedulerRuntimeFoundationStatus> {
    if (this.fundsRuntimeSchemaReady && this.fundsRuntimeSchemaStatus) {
      return this.cloneFundsRuntimeSchemaStatus(this.fundsRuntimeSchemaStatus);
    }

    const status = await this.loadFundsRuntimeSchemaStatus();
    if (status.status === 'ready') {
      this.fundsRuntimeSchemaReady = true;
      this.fundsRuntimeSchemaStatus = status;
    } else {
      this.fundsRuntimeSchemaReady = false;
      this.fundsRuntimeSchemaStatus = null;
    }

    return this.cloneFundsRuntimeSchemaStatus(status);
  }

  async assertFundsRuntimeSchemaReady(): Promise<void> {
    if (this.fundsRuntimeSchemaReady) {
      return;
    }

    if (!this.fundsRuntimeSchemaPromise) {
      this.fundsRuntimeSchemaPromise = this.inspectFundsRuntimeSchema()
        .then(() => {
          if (!this.fundsRuntimeSchemaReady || !this.fundsRuntimeSchemaStatus) {
            throw new ServiceUnavailableAppError(
              this.buildMissingFundsRuntimeSchemaMessage([]),
              'FUNDS_SCHEDULER_SCHEMA_MISSING'
            );
          }
        })
        .catch((error) => {
          this.fundsRuntimeSchemaPromise = null;
          throw error;
        });
    }

    await this.fundsRuntimeSchemaPromise;
  }

  private async loadOrdersRuntimeSchemaStatus(): Promise<SchedulerRuntimeFoundationStatus> {
    const tableRows = (await coreDataSource.query(
      `SELECT table_name AS tableName
         FROM information_schema.tables
        WHERE table_schema = DATABASE()
          AND table_name IN (?, ?)`,
      [...ORDERS_RUNTIME_TABLES]
    )) as Array<{ tableName?: string }>;

    const existingTables = new Set(
      tableRows.map((row) => String(row.tableName || '').trim()).filter(Boolean)
    );
    const missingParts: string[] = ORDERS_RUNTIME_TABLES.filter(
      (tableName) => !existingTables.has(tableName)
    );

    if (!missingParts.length) {
      const columnRows = (await coreDataSource.query(
        `SELECT column_name AS columnName
           FROM information_schema.columns
          WHERE table_schema = DATABASE()
            AND table_name = ?
            AND column_name = ?`,
        ['scheduler_orders_snapshots', ORDERS_RUNTIME_REQUIRED_COLUMNS[0]]
      )) as Array<{ columnName?: string }>;

      const existingColumns = new Set(
        columnRows.map((row) => String(row.columnName || '').trim()).filter(Boolean)
      );
      for (const columnName of ORDERS_RUNTIME_REQUIRED_COLUMNS) {
        if (!existingColumns.has(columnName)) {
          missingParts.push(`scheduler_orders_snapshots.${columnName}`);
        }
      }
    }

    if (!missingParts.length) {
      return {
        status: 'ready',
        migrationName: ORDERS_RUNTIME_SCHEMA_MIGRATION,
        requiredTables: [...ORDERS_RUNTIME_TABLES],
        requiredColumns: [...ORDERS_RUNTIME_REQUIRED_COLUMNS].map(
          (columnName) => `scheduler_orders_snapshots.${columnName}`
        ),
        note:
          'Orders checkpoint and snapshot tables are present, so replay reset and runtime reconciliation can use the Phase 5 migration-owned schema safely.',
      };
    }

    return {
      status: 'missing',
      migrationName: ORDERS_RUNTIME_SCHEMA_MIGRATION,
      requiredTables: [...ORDERS_RUNTIME_TABLES],
      requiredColumns: [...ORDERS_RUNTIME_REQUIRED_COLUMNS].map(
        (columnName) => `scheduler_orders_snapshots.${columnName}`
      ),
      missingParts,
      note: this.buildMissingOrdersRuntimeSchemaMessage(missingParts),
    };
  }

  private async loadFundsRuntimeSchemaStatus(): Promise<SchedulerRuntimeFoundationStatus> {
    const tableRows = (await coreDataSource.query(
      `SELECT table_name AS tableName
         FROM information_schema.tables
        WHERE table_schema = DATABASE()
          AND table_name IN (?)`,
      [FUNDS_RUNTIME_TABLES[0]]
    )) as Array<{ tableName?: string }>;

    const existingTables = new Set(
      tableRows.map((row) => String(row.tableName || '').trim()).filter(Boolean)
    );
    const missingParts: string[] = FUNDS_RUNTIME_TABLES.filter(
      (tableName) => !existingTables.has(tableName)
    );

    if (!missingParts.length) {
      const columnRows = (await coreDataSource.query(
        `SELECT column_name AS columnName
           FROM information_schema.columns
          WHERE table_schema = DATABASE()
            AND table_name = ?
            AND column_name IN (?, ?, ?, ?, ?, ?)`,
        ['funds_snapshots', ...FUNDS_RUNTIME_REQUIRED_COLUMNS]
      )) as Array<{ columnName?: string }>;

      const existingColumns = new Set(
        columnRows.map((row) => String(row.columnName || '').trim()).filter(Boolean)
      );
      for (const columnName of FUNDS_RUNTIME_REQUIRED_COLUMNS) {
        if (!existingColumns.has(columnName)) {
          missingParts.push(`funds_snapshots.${columnName}`);
        }
      }

      const indexRows = (await coreDataSource.query(
        `SELECT DISTINCT index_name AS indexName
           FROM information_schema.statistics
          WHERE table_schema = DATABASE()
            AND table_name = ?
            AND index_name IN (?, ?, ?)`,
        ['funds_snapshots', ...FUNDS_RUNTIME_REQUIRED_INDEXES]
      )) as Array<{ indexName?: string }>;
      const existingIndexes = new Set(
        indexRows.map((row) => String(row.indexName || '').trim()).filter(Boolean)
      );
      for (const indexName of FUNDS_RUNTIME_REQUIRED_INDEXES) {
        if (!existingIndexes.has(indexName)) {
          missingParts.push(`funds_snapshots.${indexName}`);
        }
      }
    }

    if (!missingParts.length) {
      return {
        status: 'ready',
        migrationName: FUNDS_RUNTIME_SCHEMA_MIGRATION,
        requiredTables: [...FUNDS_RUNTIME_TABLES],
        requiredColumns: [...FUNDS_RUNTIME_REQUIRED_COLUMNS].map(
          (columnName) => `funds_snapshots.${columnName}`
        ),
        note:
          'Funds snapshot runtime columns and daily uniqueness indexes are present, so diagnostics and scoped recovery runs can trust the hardened funds schema safely.',
      };
    }

    return {
      status: 'missing',
      migrationName: FUNDS_RUNTIME_SCHEMA_MIGRATION,
      requiredTables: [...FUNDS_RUNTIME_TABLES],
      requiredColumns: [...FUNDS_RUNTIME_REQUIRED_COLUMNS].map(
        (columnName) => `funds_snapshots.${columnName}`
      ),
      missingParts,
      note: this.buildMissingFundsRuntimeSchemaMessage(missingParts),
    };
  }

  private buildMissingOrdersRuntimeSchemaMessage(missingParts: string[]): string {
    const resolvedMissingParts = missingParts.length
      ? missingParts
      : [...ORDERS_RUNTIME_TABLES, ...ORDERS_RUNTIME_REQUIRED_COLUMNS];
    return `Orders scheduler runtime schema is missing ${resolvedMissingParts.join(
      ', '
    )}. Run migration ${ORDERS_RUNTIME_SCHEMA_MIGRATION} before using orders sync.`;
  }

  private buildMissingFundsRuntimeSchemaMessage(missingParts: string[]): string {
    const resolvedMissingParts = missingParts.length
      ? missingParts
      : [
          ...FUNDS_RUNTIME_TABLES,
          ...FUNDS_RUNTIME_REQUIRED_COLUMNS.map(
            (columnName) => `funds_snapshots.${columnName}`
          ),
          ...FUNDS_RUNTIME_REQUIRED_INDEXES.map(
            (indexName) => `funds_snapshots.${indexName}`
          ),
        ];
    return `Funds scheduler runtime schema is missing ${resolvedMissingParts.join(
      ', '
    )}. Run migration ${FUNDS_RUNTIME_SCHEMA_MIGRATION} before using funds sync diagnostics or scoped recovery.`;
  }

  private cloneOrdersRuntimeSchemaStatus(
    status: SchedulerRuntimeFoundationStatus
  ): SchedulerRuntimeFoundationStatus {
    return {
      ...status,
      requiredTables: [...status.requiredTables],
      requiredColumns: [...status.requiredColumns],
      ...(status.missingParts ? { missingParts: [...status.missingParts] } : {}),
    };
  }

  private cloneFundsRuntimeSchemaStatus(
    status: SchedulerRuntimeFoundationStatus
  ): SchedulerRuntimeFoundationStatus {
    return {
      ...status,
      requiredTables: [...status.requiredTables],
      requiredColumns: [...status.requiredColumns],
      ...(status.missingParts ? { missingParts: [...status.missingParts] } : {}),
    };
  }
}
