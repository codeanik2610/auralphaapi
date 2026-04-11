import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class AlignStrategyLabProjectsPg1767300000000 implements MigrationInterface {
  name = 'AlignStrategyLabProjectsPg1767300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'CREATE TABLE IF NOT EXISTS strategy_lab_projects ('
        + ' id uuid NOT NULL DEFAULT gen_random_uuid(),'
        + ' user_id varchar(36) NOT NULL,'
        + ' name varchar(255) NOT NULL,'
        + ' description text NULL,'
        + ' status varchar(30) NOT NULL DEFAULT \'Draft\','
        + ' project_version integer NOT NULL DEFAULT 1,'
        + ' source_template_id varchar(100) NULL,'
        + ' source_template_version integer NULL,'
        + ' config jsonb NULL,'
        + ' objective varchar(100) NULL,'
        + ' market varchar(100) NULL,'
        + ' timeframe varchar(50) NULL,'
        + ' universe varchar(100) NULL,'
        + ' created_at timestamptz NOT NULL DEFAULT now(),'
        + ' updated_at timestamptz NOT NULL DEFAULT now(),'
        + ' authoring_mode varchar(20) NOT NULL DEFAULT \'no_code\','
        + ' code_target varchar(30) NULL,'
        + ' visual_definition jsonb NULL,'
        + ' code_definition text NULL,'
        + ' parameters jsonb NULL,'
        + ' risk_config jsonb NULL,'
        + ' validation_state varchar(20) NULL DEFAULT \'idle\','
        + ' validation_errors jsonb NULL,'
        + ' validation_warnings jsonb NULL,'
        + ' last_validated_at timestamptz NULL,'
        + ' PRIMARY KEY (id)'
        + ');'
    );

    await queryRunner.query(
      'ALTER TABLE strategy_lab_projects ADD COLUMN IF NOT EXISTS description text NULL'
    );
    await queryRunner.query(
      'ALTER TABLE strategy_lab_projects ADD COLUMN IF NOT EXISTS project_version integer NOT NULL DEFAULT 1'
    );
    await queryRunner.query(
      'ALTER TABLE strategy_lab_projects ADD COLUMN IF NOT EXISTS source_template_id varchar(100) NULL'
    );
    await queryRunner.query(
      'ALTER TABLE strategy_lab_projects ADD COLUMN IF NOT EXISTS source_template_version integer NULL'
    );
    await queryRunner.query(
      'ALTER TABLE strategy_lab_projects ADD COLUMN IF NOT EXISTS validation_warnings jsonb NULL'
    );

    await queryRunner.query(
      "UPDATE strategy_lab_projects SET description = COALESCE(description, NULLIF(config->>'description', '')) WHERE config IS NOT NULL"
    );
    await queryRunner.query(
      "UPDATE strategy_lab_projects SET project_version = COALESCE(NULLIF(config->>'projectVersion', '')::integer, project_version, 1) WHERE config IS NOT NULL"
    );
    await queryRunner.query(
      "UPDATE strategy_lab_projects SET source_template_id = COALESCE(source_template_id, NULLIF(config->>'sourceTemplateId', '')) WHERE config IS NOT NULL"
    );
    await queryRunner.query(
      "UPDATE strategy_lab_projects SET source_template_version = COALESCE(source_template_version, NULLIF(config->>'sourceTemplateVersion', '')::integer) WHERE config IS NOT NULL"
    );
    await queryRunner.query(
      "UPDATE strategy_lab_projects SET validation_warnings = COALESCE(validation_warnings, '[]'::jsonb) WHERE validation_warnings IS NULL"
    );

    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS idx_strategy_lab_projects_user_updated_at ON strategy_lab_projects (user_id, updated_at)'
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE strategy_lab_projects DROP COLUMN IF EXISTS validation_warnings'
    );
    await queryRunner.query(
      'ALTER TABLE strategy_lab_projects DROP COLUMN IF EXISTS source_template_version'
    );
    await queryRunner.query(
      'ALTER TABLE strategy_lab_projects DROP COLUMN IF EXISTS source_template_id'
    );
    await queryRunner.query(
      'ALTER TABLE strategy_lab_projects DROP COLUMN IF EXISTS project_version'
    );
    await queryRunner.query(
      'ALTER TABLE strategy_lab_projects DROP COLUMN IF EXISTS description'
    );
  }
}
