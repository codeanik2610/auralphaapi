import { MigrationInterface, QueryRunner } from 'typeorm';
import { Service } from 'typedi';

@Service()
export class AddBacktestSearchIndexPg1767300002000 implements MigrationInterface {
  name = 'AddBacktestSearchIndexPg1767300002000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_backtests_search_document_trgm
      ON backtests
      USING gin (
        LOWER(
          COALESCE(name, '')
          || ' ' || COALESCE(strategy, '')
          || ' ' || COALESCE(symbol, '')
          || ' ' || COALESCE(parameter, '')
          || ' ' || COALESCE(status, '')
          || ' ' || COALESCE(stability, '')
        ) gin_trgm_ops
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS idx_backtests_search_document_trgm');
  }
}
