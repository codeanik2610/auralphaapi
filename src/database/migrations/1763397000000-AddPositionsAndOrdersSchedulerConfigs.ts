import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class AddPositionsAndOrdersSchedulerConfigs1763397000000 implements MigrationInterface {
  name = 'AddPositionsAndOrdersSchedulerConfigs1763397000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO scheduler_configs (
        id, \`key\`, name, description, enabled, cron_expression, timezone, run_at, interval_days, batch_size, config
      )
      SELECT
        UUID(),
        'positions-sync',
        'Positions Sync',
        'Reconciles positions in monitor mode with pending-first checkpoints and data-loss guards.',
        0,
        '0 1 * * *',
        'UTC',
        '01:00',
        1,
        200,
        JSON_OBJECT('sources', JSON_ARRAY('positions'), 'retentionDays', 30, 'lookbackDays', 90)
      FROM DUAL
      WHERE NOT EXISTS (
        SELECT 1 FROM scheduler_configs WHERE \`key\` = 'positions-sync'
      );
    `);

    await queryRunner.query(`
      INSERT INTO scheduler_configs (
        id, \`key\`, name, description, enabled, cron_expression, timezone, run_at, interval_days, batch_size, config
      )
      SELECT
        UUID(),
        'orders-sync',
        'Orders Sync',
        'Reconciles orders in monitor mode with pending-first checkpoints and data-loss guards.',
        0,
        '0 1 * * *',
        'UTC',
        '01:00',
        1,
        200,
        JSON_OBJECT('sources', JSON_ARRAY('orders'), 'retentionDays', 30, 'lookbackDays', 90)
      FROM DUAL
      WHERE NOT EXISTS (
        SELECT 1 FROM scheduler_configs WHERE \`key\` = 'orders-sync'
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DELETE FROM scheduler_configs WHERE `key` = 'positions-sync'");
    await queryRunner.query("DELETE FROM scheduler_configs WHERE `key` = 'orders-sync'");
  }
}

