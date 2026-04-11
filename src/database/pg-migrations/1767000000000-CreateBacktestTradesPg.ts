import { MigrationInterface, QueryRunner } from 'typeorm';
import { Service } from 'typedi';

@Service()
export class CreateBacktestTradesPg1767000000000 implements MigrationInterface {
  name = 'CreateBacktestTradesPg1767000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS backtest_trades (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        backtest_id uuid NOT NULL,
        user_id varchar(191) NOT NULL,
        symbol varchar(64) NOT NULL,
        interval varchar(8) NOT NULL,
        side varchar(10) NOT NULL,
        entry_time timestamptz NOT NULL,
        entry_price numeric(30, 12) NOT NULL,
        exit_time timestamptz NULL,
        exit_price numeric(30, 12) NULL,
        created_at timestamptz NOT NULL DEFAULT NOW(),
        updated_at timestamptz NOT NULL DEFAULT NOW(),
        UNIQUE (backtest_id, symbol, interval, side, entry_time, exit_time)
      )`
    );
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS idx_backtest_trades_backtest_symbol_interval ON backtest_trades (backtest_id, symbol, interval)'
    );
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS idx_backtest_trades_user_entry_time ON backtest_trades (user_id, entry_time DESC)'
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS backtest_trades');
  }
}
