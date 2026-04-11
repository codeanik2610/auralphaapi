import { MigrationInterface, QueryRunner } from 'typeorm';
import { Service } from 'typedi';

@Service()
export class AddBacktestSummaryIndexesPg1767300004000 implements MigrationInterface {
  name = 'AddBacktestSummaryIndexesPg1767300004000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS idx_backtests_user_status_lower_created_at ON backtests (user_id, LOWER(status), created_at DESC)'
    );
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS idx_backtest_results_user_cagr_desc ON backtest_results (user_id, cagr DESC) WHERE cagr IS NOT NULL'
    );
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS idx_backtest_results_user_sharpe_desc ON backtest_results (user_id, sharpe DESC) WHERE sharpe IS NOT NULL'
    );
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS idx_backtest_results_user_drawdown_desc ON backtest_results (user_id, drawdown DESC) WHERE drawdown IS NOT NULL'
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS idx_backtest_results_user_drawdown_desc'
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS idx_backtest_results_user_sharpe_desc'
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS idx_backtest_results_user_cagr_desc'
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS idx_backtests_user_status_lower_created_at'
    );
  }
}
