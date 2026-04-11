import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class CleanupStrategyTemplateConfig1763800022000 implements MigrationInterface {
  name = 'CleanupStrategyTemplateConfig1763800022000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "UPDATE strategy_templates SET config = (config - 'assets' - 'timeframes' - 'timeframe' - 'tags' - 'name' - 'description' - 'status') WHERE config IS NOT NULL"
    );
  }

  public async down(): Promise<void> {
    // no-op: destructive cleanup
  }
}
