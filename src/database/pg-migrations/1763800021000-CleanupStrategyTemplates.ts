import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class CleanupStrategyTemplates1763800021000 implements MigrationInterface {
  name = 'CleanupStrategyTemplates1763800021000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "UPDATE strategy_templates SET config = (config - 'assets' - 'timeframes' - 'timeframe') WHERE config IS NOT NULL"
    );

    await queryRunner.query('ALTER TABLE strategy_templates DROP COLUMN IF EXISTS tags');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE strategy_templates ADD COLUMN IF NOT EXISTS tags jsonb NULL');
  }
}
