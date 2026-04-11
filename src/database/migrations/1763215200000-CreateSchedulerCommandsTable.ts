import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class CreateSchedulerCommandsTable1763215200000 implements MigrationInterface {
  name = 'CreateSchedulerCommandsTable1763215200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS scheduler_commands (
        id char(36) NOT NULL,
        scheduler_key varchar(100) NOT NULL,
        command_type varchar(50) NOT NULL,
        payload_json text DEFAULT NULL,
        status varchar(30) NOT NULL DEFAULT 'Pending',
        processed_at timestamp NULL DEFAULT NULL,
        error_message text DEFAULT NULL,
        created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_scheduler_commands_status_created_at (status, created_at),
        KEY idx_scheduler_commands_scheduler_key_status (scheduler_key, status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS scheduler_commands');
  }
}

