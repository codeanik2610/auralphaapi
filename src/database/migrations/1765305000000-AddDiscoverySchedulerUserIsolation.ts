import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class AddDiscoverySchedulerUserIsolation1765305000000 implements MigrationInterface {
  name = 'AddDiscoverySchedulerUserIsolation1765305000000';

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

    if (!(await queryRunner.hasColumn('scheduler_commands', 'actor_user_id'))) {
      await queryRunner.query(`
        ALTER TABLE scheduler_commands
        ADD COLUMN actor_user_id varchar(191) NULL AFTER command_type
      `);
    }

    if (!(await queryRunner.hasColumn('scheduler_run_logs', 'actor_user_id'))) {
      await queryRunner.query(`
        ALTER TABLE scheduler_run_logs
        ADD COLUMN actor_user_id varchar(191) NULL AFTER status
      `);
    }

    await queryRunner.query(`
      UPDATE scheduler_commands
      SET actor_user_id = JSON_UNQUOTE(JSON_EXTRACT(CAST(payload_json AS JSON), '$.actorUserId'))
      WHERE actor_user_id IS NULL
        AND payload_json IS NOT NULL
        AND JSON_EXTRACT(CAST(payload_json AS JSON), '$.actorUserId') IS NOT NULL
    `);

    await queryRunner.query(`
      UPDATE scheduler_run_logs
      SET actor_user_id = JSON_UNQUOTE(JSON_EXTRACT(CAST(meta_json AS JSON), '$.actorUserId'))
      WHERE actor_user_id IS NULL
        AND meta_json IS NOT NULL
        AND JSON_EXTRACT(CAST(meta_json AS JSON), '$.actorUserId') IS NOT NULL
    `);

    const commandActorIndexRows = (await queryRunner.query(`
      SELECT COUNT(*) AS count
      FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = 'scheduler_commands'
        AND index_name = 'idx_scheduler_commands_scheduler_actor_status'
    `)) as Array<{ count: number | string }>;
    if (Number(commandActorIndexRows?.[0]?.count || 0) === 0) {
      await queryRunner.query(`
        CREATE INDEX idx_scheduler_commands_scheduler_actor_status
        ON scheduler_commands (scheduler_key, actor_user_id, status, created_at)
      `);
    }

    const runActorIndexRows = (await queryRunner.query(`
      SELECT COUNT(*) AS count
      FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = 'scheduler_run_logs'
        AND index_name = 'idx_scheduler_run_logs_scheduler_actor_started'
    `)) as Array<{ count: number | string }>;
    if (Number(runActorIndexRows?.[0]?.count || 0) === 0) {
      await queryRunner.query(`
        CREATE INDEX idx_scheduler_run_logs_scheduler_actor_started
        ON scheduler_run_logs (scheduler_key, actor_user_id, started_at)
      `);
    }

    await queryRunner.query(`
      INSERT INTO scheduler_user_configs (
        id,
        scheduler_key,
        user_id,
        name,
        description,
        enabled,
        cron_expression,
        timezone,
        run_at,
        interval_days,
        batch_size,
        scheduler_type,
        config,
        last_started_at,
        last_finished_at,
        last_status,
        last_error,
        running_lock_until
      )
      SELECT
        UUID(),
        sc.\`key\`,
        u.id,
        sc.name,
        sc.description,
        sc.enabled,
        sc.cron_expression,
        sc.timezone,
        sc.run_at,
        sc.interval_days,
        sc.batch_size,
        'user',
        sc.config,
        sc.last_started_at,
        sc.last_finished_at,
        sc.last_status,
        sc.last_error,
        NULL
      FROM scheduler_configs sc
      INNER JOIN users u ON 1 = 1
      LEFT JOIN scheduler_user_configs suc
        ON suc.scheduler_key = sc.\`key\`
       AND suc.user_id = u.id
      WHERE sc.\`key\` = 'discovery-self-identify-sync'
        AND suc.id IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM scheduler_user_configs
      WHERE scheduler_key = 'discovery-self-identify-sync'
    `);

    const commandActorIndexRows = (await queryRunner.query(`
      SELECT COUNT(*) AS count
      FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = 'scheduler_commands'
        AND index_name = 'idx_scheduler_commands_scheduler_actor_status'
    `)) as Array<{ count: number | string }>;
    if (Number(commandActorIndexRows?.[0]?.count || 0) > 0) {
      await queryRunner.query('DROP INDEX idx_scheduler_commands_scheduler_actor_status ON scheduler_commands');
    }

    const runActorIndexRows = (await queryRunner.query(`
      SELECT COUNT(*) AS count
      FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = 'scheduler_run_logs'
        AND index_name = 'idx_scheduler_run_logs_scheduler_actor_started'
    `)) as Array<{ count: number | string }>;
    if (Number(runActorIndexRows?.[0]?.count || 0) > 0) {
      await queryRunner.query('DROP INDEX idx_scheduler_run_logs_scheduler_actor_started ON scheduler_run_logs');
    }

    if (await queryRunner.hasColumn('scheduler_commands', 'actor_user_id')) {
      await queryRunner.query(`
        ALTER TABLE scheduler_commands
        DROP COLUMN actor_user_id
      `);
    }

    if (await queryRunner.hasColumn('scheduler_run_logs', 'actor_user_id')) {
      await queryRunner.query(`
        ALTER TABLE scheduler_run_logs
        DROP COLUMN actor_user_id
      `);
    }

    await queryRunner.query('DROP TABLE IF EXISTS scheduler_user_configs');
  }
}
