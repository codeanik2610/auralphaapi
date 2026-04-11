import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class RenameBinanceAssetsSchedulerToExchangeAssetsSync1763392000000 implements MigrationInterface {
  name = 'RenameBinanceAssetsSchedulerToExchangeAssetsSync1763392000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE scheduler_configs
      SET
        \`key\` = 'exchange-assets-sync',
        name = 'Exchange Assets Sync',
        description = 'Syncs assets table from Binance exchangeInfo using Binance URL from DB exchange metadata.'
      WHERE \`key\` = 'binance-assets-sync';
    `);
    await queryRunner.query(`
      UPDATE scheduler_configs
      SET
        name = 'Exchange Assets Sync',
        description = 'Syncs assets table from Binance exchangeInfo using Binance URL from DB exchange metadata.'
      WHERE \`key\` = 'exchange-assets-sync';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE scheduler_configs
      SET
        \`key\` = 'binance-assets-sync',
        name = 'Binance Assets Sync',
        description = 'Syncs assets table from Binance exchangeInfo using Binance URL from DB exchange metadata.'
      WHERE \`key\` = 'exchange-assets-sync';
    `);
    await queryRunner.query(`
      UPDATE scheduler_configs
      SET
        name = 'Binance Assets Sync',
        description = 'Syncs assets table from Binance exchangeInfo using Binance URL from DB exchange metadata.'
      WHERE \`key\` = 'binance-assets-sync';
    `);
  }
}
