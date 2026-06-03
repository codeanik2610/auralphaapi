import { MigrationInterface, QueryRunner } from 'typeorm';
import { Service } from 'typedi';

@Service()
export class AddBacktestTradeMetadata1800000300000 implements MigrationInterface {
  name = 'AddBacktestTradeMetadata1800000300000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
ALTER TABLE public.backtest_trades
  ADD COLUMN IF NOT EXISTS metadata jsonb;
`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
ALTER TABLE public.backtest_trades
  DROP COLUMN IF EXISTS metadata;
`);
  }
}
