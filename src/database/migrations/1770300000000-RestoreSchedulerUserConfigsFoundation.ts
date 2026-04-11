import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class RestoreSchedulerUserConfigsFoundation1770300000000 implements MigrationInterface {
  name = 'RestoreSchedulerUserConfigsFoundation1770300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS scheduler_user_configs (
        id char(36) NOT NULL,
        scheduler_key varchar(100) NOT NULL,
        user_id char(36) NOT NULL,
        name varchar(191) NOT NULL,
        description varchar(255) DEFAULT NULL,
        enabled tinyint(1) NOT NULL DEFAULT 0,
        cron_expression varchar(64) NOT NULL,
        timezone varchar(64) NOT NULL DEFAULT 'Asia/Kolkata',
        run_at varchar(5) NOT NULL DEFAULT '01:00',
        interval_days int NOT NULL DEFAULT 1,
        batch_size int NOT NULL DEFAULT 200,
        scheduler_type varchar(16) NOT NULL DEFAULT 'user',
        config text DEFAULT NULL,
        last_started_at timestamp NULL DEFAULT NULL,
        last_finished_at timestamp NULL DEFAULT NULL,
        last_status varchar(32) DEFAULT NULL,
        last_error text DEFAULT NULL,
        running_lock_until timestamp NULL DEFAULT NULL,
        created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uidx_scheduler_user_configs_scheduler_user (scheduler_key, user_id),
        KEY idx_scheduler_user_configs_user_scheduler (user_id, scheduler_key),
        KEY idx_scheduler_user_configs_scheduler_enabled (scheduler_key, enabled),
        CONSTRAINT fk_scheduler_user_configs_scheduler_key
          FOREIGN KEY (scheduler_key) REFERENCES scheduler_configs(\`key\`) ON DELETE CASCADE,
        CONSTRAINT fk_scheduler_user_configs_user_id
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('scheduler_user_configs'))) {
      return;
    }

    const foreignKeys = await queryRunner.query(
      `SELECT DISTINCT CONSTRAINT_NAME
       FROM information_schema.KEY_COLUMN_USAGE
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'scheduler_user_configs'
         AND REFERENCED_TABLE_NAME IS NOT NULL`
    );

    if (Array.isArray(foreignKeys)) {
      for (const row of foreignKeys) {
        const fkName = String(
          (row as { CONSTRAINT_NAME?: string }).CONSTRAINT_NAME || ''
        ).trim();
        if (fkName) {
          await queryRunner.query(
            `ALTER TABLE scheduler_user_configs DROP FOREIGN KEY ${fkName}`
          );
        }
      }
    }

    await queryRunner.query('DROP TABLE IF EXISTS scheduler_user_configs');
  }
}
