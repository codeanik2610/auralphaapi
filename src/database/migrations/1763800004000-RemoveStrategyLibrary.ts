import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class RemoveStrategyLibrary1763800004000 implements MigrationInterface {
  name = 'RemoveStrategyLibrary1763800004000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await this.hasIndex(queryRunner, 'strategy_lab_projects', 'idx_strategy_lab_projects_user_template_updated_at')) {
      await queryRunner.query('DROP INDEX idx_strategy_lab_projects_user_template_updated_at ON strategy_lab_projects');
    }

    if (await this.hasIndex(queryRunner, 'strategy_lab_projects', 'idx_strategy_lab_projects_template_updated_at')) {
      await queryRunner.query('DROP INDEX idx_strategy_lab_projects_template_updated_at ON strategy_lab_projects');
    }

    if (await queryRunner.hasColumn('strategy_lab_projects', 'sourceTemplateId')) {
      await queryRunner.query('ALTER TABLE strategy_lab_projects DROP COLUMN sourceTemplateId');
    }

    if (await queryRunner.hasColumn('strategy_lab_projects', 'templateId')) {
      await queryRunner.query('ALTER TABLE strategy_lab_projects DROP COLUMN templateId');
    }

    if (!(await this.hasIndex(queryRunner, 'strategy_lab_projects', 'idx_strategy_lab_projects_user_updated_at'))) {
      await queryRunner.query('CREATE INDEX idx_strategy_lab_projects_user_updated_at ON strategy_lab_projects (user_id, updatedAt)');
    }

    await queryRunner.query('DROP TABLE IF EXISTS strategy_templates');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'CREATE TABLE IF NOT EXISTS strategy_templates ('
        + ' id char(36) NOT NULL,'
        + ' user_id char(36) NOT NULL,'
        + ' name varchar(255) NOT NULL,'
        + ' category varchar(100) NOT NULL,'
        + ' market varchar(100) NOT NULL,'
        + ' complexity varchar(50) NOT NULL,'
        + ' description text NOT NULL,'
        + ' author varchar(100) NOT NULL,'
        + ' score varchar(20) NULL,'
        + ' useCase varchar(255) NULL,'
        + ' deployability varchar(100) NULL,'
        + ' popularity varchar(50) NULL,'
        + ' summary text NULL,'
        + ' createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,'
        + ' updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,'
        + ' PRIMARY KEY (id),'
        + ' KEY idx_strategy_templates_user_category_updated_at (user_id, category, updatedAt),'
        + ' KEY idx_strategy_templates_user_market_updated_at (user_id, market, updatedAt)'
        + ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;'
    );

    if (!(await queryRunner.hasColumn('strategy_lab_projects', 'templateId'))) {
      await queryRunner.query("ALTER TABLE strategy_lab_projects ADD COLUMN templateId varchar(100) NOT NULL DEFAULT ''");
    }

    if (!(await queryRunner.hasColumn('strategy_lab_projects', 'sourceTemplateId'))) {
      await queryRunner.query('ALTER TABLE strategy_lab_projects ADD COLUMN sourceTemplateId varchar(100) NULL');
    }

    if (!(await this.hasIndex(queryRunner, 'strategy_lab_projects', 'idx_strategy_lab_projects_template_updated_at'))) {
      await queryRunner.query('CREATE INDEX idx_strategy_lab_projects_template_updated_at ON strategy_lab_projects (templateId, updatedAt)');
    }

    if (!(await this.hasIndex(queryRunner, 'strategy_lab_projects', 'idx_strategy_lab_projects_user_template_updated_at'))) {
      await queryRunner.query('CREATE INDEX idx_strategy_lab_projects_user_template_updated_at ON strategy_lab_projects (user_id, templateId, updatedAt)');
    }

    if (await this.hasIndex(queryRunner, 'strategy_lab_projects', 'idx_strategy_lab_projects_user_updated_at')) {
      await queryRunner.query('DROP INDEX idx_strategy_lab_projects_user_updated_at ON strategy_lab_projects');
    }
  }

  private async hasIndex(queryRunner: QueryRunner, table: string, index: string): Promise<boolean> {
    const tableInfo = await queryRunner.getTable(table);
    return Boolean(tableInfo?.indices.some((idx) => idx.name === index));
  }
}
