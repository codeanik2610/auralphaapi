import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class CreateFundsSnapshotsTables1763800002000 implements MigrationInterface {
  name = 'CreateFundsSnapshotsTables1763800002000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS funds_snapshots (
        id char(36) NOT NULL,
        user_id varchar(191) NOT NULL,
        broker_key varchar(100) NOT NULL,
        account_id char(36) NOT NULL,
        wallet_funds_json json NULL,
        futures_funds_json json NULL,
        computed_at timestamp NOT NULL,
        created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_funds_snapshots_user_computed (user_id, computed_at),
        KEY idx_funds_snapshots_user_broker_account (user_id, broker_key, account_id),
        CONSTRAINT fk_funds_snapshots_user_id FOREIGN KEY (user_id)
          REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS funds_scheduler_runs (
        id char(36) NOT NULL,
        user_id varchar(191) NOT NULL,
        status varchar(30) NOT NULL,
        started_at timestamp NOT NULL,
        finished_at timestamp NULL,
        total_accounts int NOT NULL DEFAULT 0,
        success_count int NOT NULL DEFAULT 0,
        failure_count int NOT NULL DEFAULT 0,
        error text NULL,
        created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_funds_scheduler_runs_user_started (user_id, started_at),
        CONSTRAINT fk_funds_scheduler_runs_user_id FOREIGN KEY (user_id)
          REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS funds_scheduler_runs');
    await queryRunner.query('DROP TABLE IF EXISTS funds_snapshots');
  }
}
