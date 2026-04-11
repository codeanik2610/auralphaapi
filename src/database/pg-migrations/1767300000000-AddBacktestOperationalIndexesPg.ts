import { MigrationInterface, QueryRunner } from 'typeorm';
import { Service } from 'typedi';

@Service()
export class AddBacktestOperationalIndexesPg1767300000000 implements MigrationInterface {
  name = 'AddBacktestOperationalIndexesPg1767300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS idx_backtests_user_created_at ON backtests (user_id, created_at DESC)'
    );
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS idx_backtests_user_status_created_at ON backtests (user_id, status, created_at DESC)'
    );
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS idx_backtest_results_user_backtest_id ON backtest_results (user_id, backtest_id)'
    );
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS idx_backtest_results_user_updated_at ON backtest_results (user_id, updated_at DESC)'
    );
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS idx_backtest_trades_user_backtest_entry_time ON backtest_trades (user_id, backtest_id, entry_time DESC)'
    );
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'fk_backtest_trades_backtest_id'
        ) THEN
          ALTER TABLE backtest_trades
          ADD CONSTRAINT fk_backtest_trades_backtest_id
          FOREIGN KEY (backtest_id)
          REFERENCES backtests(id)
          ON DELETE CASCADE
          NOT VALID;
        END IF;
      END
      $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'fk_backtest_trades_backtest_id'
        ) THEN
          ALTER TABLE backtest_trades
          DROP CONSTRAINT fk_backtest_trades_backtest_id;
        END IF;
      END
      $$;
    `);
    await queryRunner.query(
      'DROP INDEX IF EXISTS idx_backtest_trades_user_backtest_entry_time'
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS idx_backtest_results_user_updated_at'
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS idx_backtest_results_user_backtest_id'
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS idx_backtests_user_status_created_at'
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS idx_backtests_user_created_at'
    );
  }
}
