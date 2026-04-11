import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class ConsolidateSchedulerUserConfigsIntoSchedulerConfigs1770200000000
  implements MigrationInterface
{
  name = 'ConsolidateSchedulerUserConfigsIntoSchedulerConfigs1770200000000';

  private readonly schedulerKeys = [
    'signals-scan-sync',
    'discovery-self-identify-sync',
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('scheduler_user_configs'))) {
      await this.ensureSchedulerType(queryRunner);
      return;
    }

    for (const schedulerKey of this.schedulerKeys) {
      await this.mergeUserConfigIntoBase(queryRunner, schedulerKey);
    }

    await this.ensureSchedulerType(queryRunner);

    await this.dropUserConfigsTable(queryRunner);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('scheduler_user_configs')) {
      return;
    }

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS scheduler_user_configs (
        id char(36) NOT NULL,
        scheduler_key varchar(100) NOT NULL,
        user_id char(36) NOT NULL,
        name varchar(255) NOT NULL DEFAULT '',
        description text NULL,
        enabled tinyint(1) NOT NULL DEFAULT 0,
        cron_expression varchar(100) NULL,
        timezone varchar(100) NULL,
        run_at varchar(20) NULL,
        interval_days int NULL DEFAULT 1,
        batch_size int NULL DEFAULT 200,
        scheduler_type varchar(50) NOT NULL DEFAULT 'user',
        config json NULL,
        last_started_at datetime NULL,
        last_finished_at datetime NULL,
        last_status varchar(50) NULL,
        last_error text NULL,
        running_lock_until datetime NULL,
        created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uidx_scheduler_user_configs_scheduler_user (scheduler_key, user_id),
        KEY idx_scheduler_user_configs_user_scheduler (user_id, scheduler_key),
        KEY idx_scheduler_user_configs_scheduler_enabled (scheduler_key, enabled)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    for (const schedulerKey of this.schedulerKeys) {
      await queryRunner.query(
        `UPDATE scheduler_configs SET scheduler_type = 'user' WHERE \`key\` = ?`,
        [schedulerKey]
      );
    }
  }

  private async mergeUserConfigIntoBase(
    queryRunner: QueryRunner,
    schedulerKey: string
  ): Promise<void> {
    const userRows = await queryRunner.query(
      `SELECT config, enabled, last_started_at, last_finished_at, last_status, last_error,
              cron_expression, timezone, run_at, interval_days, batch_size, name, description
       FROM scheduler_user_configs
       WHERE scheduler_key = ?
       ORDER BY updated_at DESC
       LIMIT 1`,
      [schedulerKey]
    );

    if (!Array.isArray(userRows) || !userRows.length) {
      return;
    }

    const userRow = userRows[0] as Record<string, unknown>;

    const baseRows = await queryRunner.query(
      'SELECT `key` FROM scheduler_configs WHERE `key` = ? LIMIT 1',
      [schedulerKey]
    );

    if (!Array.isArray(baseRows) || !baseRows.length) {
      return;
    }

    await queryRunner.query(
      `UPDATE scheduler_configs
       SET config = COALESCE(?, config),
           enabled = COALESCE(?, enabled),
           last_started_at = COALESCE(?, last_started_at),
           last_finished_at = COALESCE(?, last_finished_at),
           last_status = COALESCE(?, last_status),
           last_error = COALESCE(?, last_error),
           cron_expression = COALESCE(?, cron_expression),
           timezone = COALESCE(?, timezone),
           run_at = COALESCE(?, run_at),
           interval_days = COALESCE(?, interval_days),
           batch_size = COALESCE(?, batch_size),
           name = COALESCE(?, name),
           description = COALESCE(?, description)
       WHERE \`key\` = ?`,
      [
        userRow.config !== undefined && userRow.config !== null
          ? typeof userRow.config === 'string'
            ? userRow.config
            : JSON.stringify(userRow.config)
          : null,
        userRow.enabled !== undefined ? userRow.enabled : null,
        userRow.last_started_at ?? null,
        userRow.last_finished_at ?? null,
        userRow.last_status ?? null,
        userRow.last_error ?? null,
        userRow.cron_expression ?? null,
        userRow.timezone ?? null,
        userRow.run_at ?? null,
        userRow.interval_days ?? null,
        userRow.batch_size ?? null,
        userRow.name ?? null,
        userRow.description ?? null,
        schedulerKey,
      ]
    );
  }

  private async ensureSchedulerType(queryRunner: QueryRunner): Promise<void> {
    for (const schedulerKey of this.schedulerKeys) {
      await queryRunner.query(
        `UPDATE scheduler_configs SET scheduler_type = 'global' WHERE \`key\` = ?`,
        [schedulerKey]
      );
    }
  }

  private async dropUserConfigsTable(queryRunner: QueryRunner): Promise<void> {
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
