import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class RemoveBacktestsTables1763800007000 implements MigrationInterface {
  name = 'RemoveBacktestsTables1763800007000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS backtest_results');
    await queryRunner.query('DROP TABLE IF EXISTS backtests');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'CREATE TABLE IF NOT EXISTS backtests ('
        + ' id char(36) NOT NULL,'
        + ' name varchar(255) NOT NULL,'
        + ' strategy varchar(255) NOT NULL,'
        + ' symbol varchar(50) NOT NULL,'
        + ' parameter varchar(255) NOT NULL,'
        + ' status varchar(30) NOT NULL,'
        + ' stability varchar(100) NULL,'
        + ' trades int unsigned NOT NULL DEFAULT 0,'
        + ' user_id varchar(191) NOT NULL,'
        + ' createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,'
        + ' updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,'
        + ' PRIMARY KEY (id),'
        + ' KEY idx_backtests_status_created_at (status, createdAt),'
        + ' KEY idx_backtests_symbol_created_at (symbol, createdAt)'
        + ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;'
    );

    await queryRunner.query(
      'CREATE TABLE IF NOT EXISTS backtest_results ('
        + ' id char(36) NOT NULL,'
        + ' backtestId char(36) NOT NULL UNIQUE,'
        + ' cagr double NULL,'
        + ' sharpe double NULL,'
        + ' drawdown double NULL,'
        + ' winRate double NULL,'
        + ' profitFactor double NULL,'
        + ' config json NULL,'
        + ' user_id varchar(191) NOT NULL,'
        + ' createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,'
        + ' updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,'
        + ' PRIMARY KEY (id),'
        + ' CONSTRAINT fk_backtest_results_backtest_id FOREIGN KEY (backtestId)'
        + ' REFERENCES backtests(id) ON DELETE CASCADE'
        + ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;'
    );
  }
}
