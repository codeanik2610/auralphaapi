import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class AddBinanceAssetsSchedulerConfig1763390000000 implements MigrationInterface {
  name = 'AddBinanceAssetsSchedulerConfig1763390000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO scheduler_configs (
        id, \`key\`, name, description, enabled, cron_expression, timezone, run_at, interval_days, batch_size, config
      )
      SELECT
        UUID(),
        'exchange-assets-sync',
        'Exchange Assets Sync',
        'Syncs assets table from Binance exchangeInfo using Binance URL from DB exchange metadata.',
        0,
        '0 1 * * *',
        'UTC',
        '01:00',
        1,
        50,
        JSON_OBJECT('sources', JSON_ARRAY('binance-futures'), 'retentionDays', 30)
      FROM DUAL
      WHERE NOT EXISTS (
        SELECT 1 FROM scheduler_configs WHERE \`key\` = 'exchange-assets-sync'
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DELETE FROM scheduler_configs WHERE `key` = 'exchange-assets-sync'");
  }
}
