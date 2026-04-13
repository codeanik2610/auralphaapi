import 'reflect-metadata';
import { env } from '../../src/env';
import { coreDataSource } from '../../src/database/data-source';
import { initializeCoreDataSource } from '../../src/database/initializeCoreDataSource';
import { strategyDataSource } from '../../src/database/pg-data-source';

const run = async (): Promise<void> => {
  await initializeCoreDataSource();

  try {
    const migrations = await coreDataSource.runMigrations();
    console.log('Applied ' + migrations.length + ' migration(s) (mysql).');
    migrations.forEach((migration) => console.log('- ' + migration.name));

    if (env.pg.enabled) {
      await strategyDataSource.initialize();
      try {
        const pgMigrations = await strategyDataSource.runMigrations();
        console.log('Applied ' + pgMigrations.length + ' migration(s) (postgres).');
        pgMigrations.forEach((migration) => console.log('- ' + migration.name));
      } finally {
        await strategyDataSource.destroy();
      }
    }
  } finally {
    await coreDataSource.destroy();
  }
};

run().catch(async (error) => {
  console.error('Failed to run migrations.');
  console.error(error);

  if (coreDataSource.isInitialized) {
    await coreDataSource.destroy();
  }
  if (strategyDataSource.isInitialized) {
    await strategyDataSource.destroy();
  }

  process.exit(1);
});
