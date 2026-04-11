import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class DropFundsSchedulerRunsTable1763800002001 implements MigrationInterface {
  name = 'DropFundsSchedulerRunsTable1763800002001';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS funds_scheduler_runs');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS funds_scheduler_runs (
        id char(36) NOT NULL PRIMARY KEY,
        user_id char(36) NOT NULL,
        status varchar(32) NOT NULL,
        started_at timestamp NOT NULL,
        finished_at timestamp NULL,
        total_accounts int NOT NULL DEFAULT 0,
        success_count int NOT NULL DEFAULT 0,
        failure_count int NOT NULL DEFAULT 0,
        error text NULL,
        created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        KEY idx_funds_scheduler_runs_user_started (user_id, started_at),
        CONSTRAINT fk_funds_scheduler_runs_user_id FOREIGN KEY (user_id)
          REFERENCES users(id) ON DELETE CASCADE
      )
    `);
  }
}
