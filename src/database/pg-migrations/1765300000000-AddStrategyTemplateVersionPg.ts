import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class AddStrategyTemplateVersionPg1765300000000 implements MigrationInterface {
  name = 'AddStrategyTemplateVersionPg1765300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE IF EXISTS strategy_templates
      ADD COLUMN IF NOT EXISTS template_version integer NOT NULL DEFAULT 1
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE IF EXISTS strategy_templates
      DROP COLUMN IF EXISTS template_version
    `);
  }
}
