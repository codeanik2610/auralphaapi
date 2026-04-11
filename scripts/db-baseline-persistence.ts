import 'reflect-metadata';
import { coreDataSource } from '../src/database/data-source';
import { initializeCoreDataSource } from '../src/database/initializeCoreDataSource';

const persistenceMigrations = [
  { timestamp: 1741465200000, name: 'CreateSignalsTables1741465200000', table: 'signals' },
  {
    timestamp: 1741466100000,
    name: 'CreateAutomationsTables1741466100000',
    table: 'automations',
  },
  {
    timestamp: 1741467000000,
    name: 'CreateWatchlistsTables1741467000000',
    table: 'watchlists',
  },
  { timestamp: 1741467900000, name: 'CreateBacktestsTables1741467900000', table: 'backtests' },
  { timestamp: 1741468800000, name: 'CreateAlertsTables1741468800000', table: 'alerts' },
  {
    timestamp: 1741469700000,
    name: 'CreatePortfolioTables1741469700000',
    table: 'portfolio_snapshots',
  },
  { timestamp: 1741470600000, name: 'CreateRiskTables1741470600000', table: 'risk_snapshots' },
  {
    timestamp: 1741471500000,
    name: 'CreateActivityLogsTable1741471500000',
    table: 'activity_logs',
  },
  { timestamp: 1741472400000, name: 'CreateConnectionsTable1741472400000', table: 'connections' },
  {
    timestamp: 1741473300000,
    name: 'CreateStrategyTables1741473300000',
    table: 'strategy_templates',
  },
  {
    timestamp: 1741474200000,
    name: 'CreateAppSettingsTable1741474200000',
    table: 'app_settings',
  },
  {
    timestamp: 1741475100000,
    name: 'CreateSettingsAuditLogsTable1741475100000',
    table: 'settings_audit_logs',
  },
] as const;

const run = async (): Promise<void> => {
  await initializeCoreDataSource();

  try {
    for (const migration of persistenceMigrations) {
      const tableExists = await coreDataSource.query(
        'SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ? LIMIT 1',
        [migration.table]
      );

      if (!Array.isArray(tableExists) || tableExists.length === 0) {
        console.log(`Skipping ${migration.name}: table ${migration.table} not found.`);
        continue;
      }

      const existing = await coreDataSource.query(
        'SELECT 1 FROM migrations WHERE timestamp = ? AND name = ? LIMIT 1',
        [migration.timestamp, migration.name]
      );

      if (Array.isArray(existing) && existing.length > 0) {
        console.log(`Already recorded: ${migration.name}`);
        continue;
      }

      await coreDataSource.query('INSERT INTO migrations (`timestamp`, `name`) VALUES (?, ?)', [
        migration.timestamp,
        migration.name,
      ]);
      console.log(`Recorded baseline migration: ${migration.name}`);
    }
  } finally {
    await coreDataSource.destroy();
  }
};

run().catch(async (error) => {
  console.error('Failed to baseline persistence migrations.');
  console.error(error);

  if (coreDataSource.isInitialized) {
    await coreDataSource.destroy();
  }

  process.exit(1);
});
