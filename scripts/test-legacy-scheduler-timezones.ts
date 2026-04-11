import assert from 'node:assert/strict';
import { NormalizeRetiredLegacySchedulerTimezones1770708000000 } from '../src/database/migrations/1770708000000-NormalizeRetiredLegacySchedulerTimezones';

function createMigrationQueryRunner(options: { hasTable?: Record<string, boolean> }) {
  const queries: Array<{ sql: string; params?: unknown[] }> = [];

  const queryRunner = {
    async hasTable(tableName: string) {
      return options.hasTable?.[tableName] ?? false;
    },
    async query(sql: string, params?: unknown[]) {
      queries.push({ sql, params });
      return [];
    },
  };

  return { queryRunner, queries };
}

async function testMigrationNormalizesRetiredSchedulerRowsToUtc(): Promise<void> {
  const migration = new NormalizeRetiredLegacySchedulerTimezones1770708000000();
  const { queryRunner, queries } = createMigrationQueryRunner({
    hasTable: {
      scheduler_configs: true,
      scheduler_user_configs: true,
    },
  });

  await migration.up(queryRunner as any);

  const configUpdate = queries.find((entry) => entry.sql.includes('UPDATE scheduler_configs'));
  assert.ok(configUpdate, 'migration should normalize retired scheduler rows in scheduler_configs');
  assert.ok(
    configUpdate?.sql.includes("SET timezone = 'UTC'"),
    'scheduler_configs normalization should explicitly set UTC'
  );
  assert.deepEqual(configUpdate?.params, ['signals-scan-sync', 'discovery-self-identify-sync']);

  const userConfigUpdate = queries.find((entry) =>
    entry.sql.includes('UPDATE scheduler_user_configs')
  );
  assert.ok(
    userConfigUpdate,
    'migration should normalize retired scheduler rows in scheduler_user_configs'
  );
  assert.ok(
    userConfigUpdate?.sql.includes("SET timezone = 'UTC'"),
    'scheduler_user_configs normalization should explicitly set UTC'
  );
  assert.deepEqual(userConfigUpdate?.params, ['signals-scan-sync', 'discovery-self-identify-sync']);
}

async function testMigrationSkipsMissingTables(): Promise<void> {
  const migration = new NormalizeRetiredLegacySchedulerTimezones1770708000000();
  const { queryRunner, queries } = createMigrationQueryRunner({
    hasTable: {
      scheduler_configs: false,
      scheduler_user_configs: false,
    },
  });

  await migration.up(queryRunner as any);

  assert.equal(queries.length, 0, 'migration should skip updates when legacy scheduler tables are absent');
}

async function run(): Promise<void> {
  await testMigrationNormalizesRetiredSchedulerRowsToUtc();
  await testMigrationSkipsMissingTables();
  console.log('Legacy scheduler timezone cleanup assertions passed.');
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
