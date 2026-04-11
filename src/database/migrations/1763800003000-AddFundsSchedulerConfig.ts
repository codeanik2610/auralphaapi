import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class AddFundsSchedulerConfig1763800003000 implements MigrationInterface {
  name = 'AddFundsSchedulerConfig1763800003000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO scheduler_configs (
        id, \`key\`, name, description, enabled, cron_expression, timezone, run_at, interval_days, batch_size, scheduler_type, config
      )
      SELECT
        UUID(),
        'funds-sync',
        'Funds Snapshot Sync',
        'Captures wallet and futures funds for connected broker accounts.',
        0,
        '0 1 * * *',
        'UTC',
        '01:00',
        1,
        200,
        'user',
        JSON_OBJECT('sources', JSON_ARRAY('funds'), 'retentionDays', 30)
      FROM DUAL
      WHERE NOT EXISTS (
        SELECT 1 FROM scheduler_configs WHERE \`key\` = 'funds-sync'
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DELETE FROM scheduler_configs WHERE `key` = 'funds-sync'");
  }
}
