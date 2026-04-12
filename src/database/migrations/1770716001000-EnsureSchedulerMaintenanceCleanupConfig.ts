import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class EnsureSchedulerMaintenanceCleanupConfig1770716001000 implements MigrationInterface {
  name = 'EnsureSchedulerMaintenanceCleanupConfig1770716001000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO scheduler_configs (
        id, \`key\`, name, description, enabled, cron_expression, timezone, run_at, interval_days, batch_size, config
      )
      SELECT
        UUID(),
        'scheduler-locks-cleanup',
        'Scheduler Maintenance Cleanup',
        'Removes stale scheduler locks and aged scheduler update logs.',
        1,
        '*/5 * * * *',
        'UTC',
        '00:00',
        1,
        1,
        JSON_OBJECT(
          'staleMinutes', 30,
          'scheduleMode', 'every_n_minutes',
          'intervalMinutes', 5,
          'updateLogRetentionDays', 30
        )
      FROM DUAL
      WHERE NOT EXISTS (
        SELECT 1 FROM scheduler_configs WHERE \`key\` = 'scheduler-locks-cleanup'
      )
    `);

    await queryRunner.query(`
      UPDATE scheduler_configs
      SET
        name = 'Scheduler Maintenance Cleanup',
        description = 'Removes stale scheduler locks and aged scheduler update logs.',
        enabled = 1,
        cron_expression = '*/5 * * * *',
        timezone = 'UTC',
        run_at = '00:00',
        interval_days = 1,
        batch_size = 1,
        config = JSON_OBJECT(
          'staleMinutes', 30,
          'scheduleMode', 'every_n_minutes',
          'intervalMinutes', 5,
          'updateLogRetentionDays', 30
        )
      WHERE \`key\` = 'scheduler-locks-cleanup'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE scheduler_configs
      SET
        name = 'Scheduler Locks Cleanup',
        description = 'Removes stale scheduler run locks to prevent stuck jobs.',
        cron_expression = '*/5 * * * *',
        config = JSON_OBJECT('staleMinutes', 30)
      WHERE \`key\` = 'scheduler-locks-cleanup'
    `);
  }
}
