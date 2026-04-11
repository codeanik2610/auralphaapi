import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class CreateStrategiesBacktestsPg1763800006000 implements MigrationInterface {
  name = 'CreateStrategiesBacktestsPg1763800006000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS pgcrypto;');

    await queryRunner.query(
      'CREATE TABLE IF NOT EXISTS strategies ('
        + ' id uuid NOT NULL DEFAULT gen_random_uuid(),'
        + ' user_id varchar(191) NOT NULL,'
        + ' name varchar(255) NOT NULL,'
        + ' description text NULL,'
        + ' status varchar(40) NOT NULL DEFAULT \'Draft\','
        + ' tags jsonb NULL,'
        + ' config jsonb NULL,'
        + ' created_at timestamptz NOT NULL DEFAULT now(),'
        + ' updated_at timestamptz NOT NULL DEFAULT now(),'
        + ' PRIMARY KEY (id)'
        + ');'
    );

    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS idx_strategies_user_updated_at ON strategies (user_id, updated_at)'
    );
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS idx_strategies_user_status ON strategies (user_id, status)'
    );

    await queryRunner.query(
      'CREATE TABLE IF NOT EXISTS backtests ('
        + ' id uuid NOT NULL DEFAULT gen_random_uuid(),'
        + ' user_id varchar(191) NOT NULL,'
        + ' name varchar(255) NOT NULL,'
        + ' strategy varchar(255) NOT NULL,'
        + ' symbol varchar(50) NOT NULL,'
        + ' parameter varchar(255) NOT NULL,'
        + ' status varchar(30) NOT NULL,'
        + ' stability varchar(100) NULL,'
        + ' trades int NOT NULL DEFAULT 0,'
        + ' created_at timestamptz NOT NULL DEFAULT now(),'
        + ' updated_at timestamptz NOT NULL DEFAULT now(),'
        + ' PRIMARY KEY (id)'
        + ');'
    );

    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS idx_backtests_status_created_at ON backtests (status, created_at)'
    );
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS idx_backtests_symbol_created_at ON backtests (symbol, created_at)'
    );

    await queryRunner.query(
      'CREATE TABLE IF NOT EXISTS backtest_results ('
        + ' id uuid NOT NULL DEFAULT gen_random_uuid(),'
        + ' backtest_id uuid NOT NULL UNIQUE,'
        + ' user_id varchar(191) NOT NULL,'
        + ' cagr double precision NULL,'
        + ' sharpe double precision NULL,'
        + ' drawdown double precision NULL,'
        + ' win_rate double precision NULL,'
        + ' profit_factor double precision NULL,'
        + ' config jsonb NULL,'
        + ' created_at timestamptz NOT NULL DEFAULT now(),'
        + ' updated_at timestamptz NOT NULL DEFAULT now(),'
        + ' PRIMARY KEY (id),'
        + ' CONSTRAINT fk_backtest_results_backtest_id FOREIGN KEY (backtest_id)'
        + ' REFERENCES backtests(id) ON DELETE CASCADE'
        + ');'
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS backtest_results');
    await queryRunner.query('DROP TABLE IF EXISTS backtests');
    await queryRunner.query('DROP TABLE IF EXISTS strategies');
  }
}
