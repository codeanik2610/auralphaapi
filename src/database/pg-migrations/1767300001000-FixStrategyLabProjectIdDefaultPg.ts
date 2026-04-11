import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class FixStrategyLabProjectIdDefaultPg1767300001000 implements MigrationInterface {
  name = 'FixStrategyLabProjectIdDefaultPg1767300001000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
    await queryRunner.query(
      'ALTER TABLE strategy_lab_projects ALTER COLUMN id SET DEFAULT gen_random_uuid()'
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE strategy_lab_projects ALTER COLUMN id DROP DEFAULT'
    );
  }
}
