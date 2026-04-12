import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class ExpandSchedulerLockCleanupConfig1770716000000 implements MigrationInterface {
  name = 'ExpandSchedulerLockCleanupConfig1770716000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE scheduler_configs
      SET
        name = 'Scheduler Maintenance Cleanup',
        description = 'Removes stale scheduler locks and aged scheduler update logs.',
        cron_expression = '*/5 * * * *',
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
