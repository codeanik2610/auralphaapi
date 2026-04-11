import { MicroframeworkLoader } from 'microframework-w3tec';
import { Container } from 'typedi';
import { env } from '../env';
import { coreDataSource } from '../database/data-source';
import { initializeCoreDataSource } from '../database/initializeCoreDataSource';
import { strategyDataSource } from '../database/pg-data-source';
import { Logger } from '../lib/logger';
import { BrokerDefinitionStartupValidator } from '../brokers';

const log = new Logger(__filename);

export const typeormLoader: MicroframeworkLoader = async () => {
  if (coreDataSource.isInitialized && (!env.pg.enabled || strategyDataSource.isInitialized)) {
    return;
  }

  await initializeCoreDataSource();
  if (env.pg.enabled && !strategyDataSource.isInitialized) {
    await strategyDataSource.initialize();
    log.info(
      'Database connected: postgres://' +
        env.pg.host +
        ':' +
        env.pg.port +
        '/' +
        env.pg.database
    );
  }
  await Container.get(BrokerDefinitionStartupValidator).validate();
  log.info(
    'Database connected: mysql://' +
      env.db.host +
      ':' +
      env.db.port +
      '/' +
      env.db.database
  );
};
