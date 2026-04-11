import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class CreateSchedulerRunLocksTable1763396000000 implements MigrationInterface {
  name = 'CreateSchedulerRunLocksTable1763396000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS scheduler_run_locks (
        scope_key varchar(255) NOT NULL,
        lock_until timestamp NULL DEFAULT NULL,
        run_id char(36) DEFAULT NULL,
        created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (scope_key),
        KEY idx_scheduler_run_locks_lock_until (lock_until)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS scheduler_run_locks');
  }
}
