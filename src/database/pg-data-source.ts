import { DataSource } from 'typeorm';
import { env } from '../env';
import { Backtest } from './entities/Backtest';
import { BacktestTrade } from './entities/BacktestTrade';
import { BacktestResult } from './entities/BacktestResult';
import { StrategyLibrary } from './entities/StrategyLibrary';
import { StrategyLabProject } from './entities/StrategyLabProject';
import { StrategyTemplate } from './entities/StrategyTemplate';
import { StrategyTemplateVersion } from './entities/StrategyTemplateVersion';

export const strategyDataSource = new DataSource({
  type: 'postgres',
  host: env.pg.host,
  port: env.pg.port,
  username: env.pg.username,
  password: env.pg.password,
  database: env.pg.database,
  ssl: env.pg.ssl ? { rejectUnauthorized: false } : false,
  extra: {
    options: '-c timezone=UTC'
  },
  synchronize: false,
  logging: env.pg.logging,
  entities: [
    StrategyTemplate,
    StrategyTemplateVersion,
    StrategyLibrary,
    StrategyLabProject,
    Backtest,
    BacktestResult,
    BacktestTrade,
  ],
  migrations: [__dirname + '/pg-migrations_baseline/*.{ts,js}'],
});
