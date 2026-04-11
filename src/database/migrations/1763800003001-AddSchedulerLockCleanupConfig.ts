import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class AddSchedulerLockCleanupConfig1763800003001 implements MigrationInterface {
  name = 'AddSchedulerLockCleanupConfig1763800003001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO scheduler_configs (
        id, \`key\`, name, description, enabled, cron_expression, timezone, run_at, interval_days, batch_size, config
      )
      SELECT
        UUID(),
        'scheduler-locks-cleanup',
        'Scheduler Locks Cleanup',
        'Removes stale scheduler run locks to prevent stuck jobs.',
        1,
        '*/5 * * * *',
        'UTC',
        '00:00',
        1,
        1,
        JSON_OBJECT('staleMinutes', 30)
      FROM DUAL
      WHERE NOT EXISTS (
        SELECT 1 FROM scheduler_configs WHERE \`key\` = 'scheduler-locks-cleanup'
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DELETE FROM scheduler_configs WHERE `key` = 'scheduler-locks-cleanup'");
  }
}
