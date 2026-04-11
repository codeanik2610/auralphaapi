import { MigrationInterface, QueryRunner } from 'typeorm';
import { Service } from 'typedi';

@Service()
export class AddStrategySearchIndexesPg1767300006000 implements MigrationInterface {
  name = 'AddStrategySearchIndexesPg1767300006000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_strategy_templates_search_document_trgm
      ON strategy_templates
      USING gin (
        LOWER(COALESCE(name, '') || ' ' || COALESCE(description, '')) gin_trgm_ops
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_strategy_library_name_trgm
      ON strategy_library
      USING gin (
        LOWER(COALESCE(name, '')) gin_trgm_ops
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS idx_strategy_library_name_trgm');
    await queryRunner.query('DROP INDEX IF EXISTS idx_strategy_templates_search_document_trgm');
  }
}
