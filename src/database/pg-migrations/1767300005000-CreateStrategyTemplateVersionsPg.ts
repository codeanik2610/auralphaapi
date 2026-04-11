import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class CreateStrategyTemplateVersionsPg1767300005000 implements MigrationInterface {
  name = 'CreateStrategyTemplateVersionsPg1767300005000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'CREATE TABLE IF NOT EXISTS strategy_template_versions ('
        + ' id uuid NOT NULL DEFAULT gen_random_uuid(),'
        + ' strategy_template_id uuid NOT NULL,'
        + ' user_id varchar(191) NOT NULL,'
        + ' actor_user_id varchar(191) NOT NULL,'
        + ' template_version integer NOT NULL,'
        + ' change_type varchar(40) NOT NULL DEFAULT \'updated\','
        + ' name varchar(255) NOT NULL,'
        + ' description text NULL,'
        + ' status varchar(40) NOT NULL,'
        + ' config jsonb NULL,'
        + ' created_at timestamptz NOT NULL DEFAULT now(),'
        + ' PRIMARY KEY (id),'
        + ' CONSTRAINT fk_strategy_template_versions_template_id FOREIGN KEY (strategy_template_id)'
        + ' REFERENCES strategy_templates(id) ON DELETE CASCADE'
        + ');'
    );

    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS idx_strategy_template_versions_template_created'
        + ' ON strategy_template_versions (strategy_template_id, created_at)'
    );
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS idx_strategy_template_versions_template_version'
        + ' ON strategy_template_versions (strategy_template_id, template_version)'
    );
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS idx_strategy_template_versions_user_created'
        + ' ON strategy_template_versions (user_id, created_at)'
    );

    await queryRunner.query(`
      INSERT INTO strategy_template_versions (
        strategy_template_id,
        user_id,
        actor_user_id,
        template_version,
        change_type,
        name,
        description,
        status,
        config,
        created_at
      )
      SELECT
        strategy.id,
        strategy.user_id,
        strategy.user_id,
        COALESCE(strategy.template_version, 1),
        'created',
        strategy.name,
        strategy.description,
        strategy.status,
        strategy.config,
        COALESCE(strategy.updated_at, strategy.created_at, now())
      FROM strategy_templates strategy
      WHERE NOT EXISTS (
        SELECT 1
        FROM strategy_template_versions version
        WHERE version.strategy_template_id = strategy.id
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS strategy_template_versions');
  }
}
