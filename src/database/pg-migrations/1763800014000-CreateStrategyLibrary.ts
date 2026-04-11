import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class CreateStrategyLibrary1763800014000 implements MigrationInterface {
  name = 'CreateStrategyLibrary1763800014000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'CREATE TABLE IF NOT EXISTS strategy_library ('
        + ' id uuid NOT NULL DEFAULT gen_random_uuid(),'
        + ' user_id varchar(191) NOT NULL,'
        + ' template_id uuid NOT NULL,'
        + ' name varchar(255) NOT NULL,'
        + ' status varchar(40) NOT NULL DEFAULT \'Draft\','
        + ' assets jsonb NULL,'
        + ' timeframes jsonb NULL,'
        + ' overrides jsonb NULL,'
        + ' created_at timestamptz NOT NULL DEFAULT now(),'
        + ' updated_at timestamptz NOT NULL DEFAULT now(),'
        + ' PRIMARY KEY (id),'
        + ' CONSTRAINT fk_strategy_library_template_id FOREIGN KEY (template_id)'
        + ' REFERENCES strategy_templates(id) ON DELETE CASCADE'
        + ');'
    );

    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS idx_strategy_library_user_updated_at ON strategy_library (user_id, updated_at)'
    );
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS idx_strategy_library_user_status ON strategy_library (user_id, status)'
    );
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS idx_strategy_library_user_template ON strategy_library (user_id, template_id)'
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS strategy_library');
  }
}
