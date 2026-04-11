import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class AddSystemHealthSchedulerConfig1763389000000 implements MigrationInterface {
  name = 'AddSystemHealthSchedulerConfig1763389000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO scheduler_configs (
        id, \`key\`, name, description, enabled, cron_expression, timezone, run_at, interval_days, batch_size, config
      )
      SELECT
        UUID(),
        'system-health-sync',
        'System Health Sync',
        'Checks aurAlpha API health, discovery-engine health, scheduler worker health, Binance exchange health, and broker connection health.',
        0,
        '0 1 * * *',
        'UTC',
        '01:00',
        1,
        50,
        JSON_OBJECT('sources', JSON_ARRAY('health'), 'retentionDays', 30)
      FROM DUAL
      WHERE NOT EXISTS (
        SELECT 1 FROM scheduler_configs WHERE \`key\` = 'system-health-sync'
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DELETE FROM scheduler_configs WHERE `key` = 'system-health-sync'");
  }
}
