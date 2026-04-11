import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class RenameCandlesSchedulerToOhlcvDataSync1763393000000 implements MigrationInterface {
  name = 'RenameCandlesSchedulerToOhlcvDataSync1763393000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE scheduler_configs
      SET name = 'OHLCV Data Sync'
      WHERE \`key\` = 'binance-candles-3m-1m-sync';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE scheduler_configs
      SET name = 'Binance Candles 3-Month 1m Sync'
      WHERE \`key\` = 'binance-candles-3m-1m-sync';
    `);
  }
}
