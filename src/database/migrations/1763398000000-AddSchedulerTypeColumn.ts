import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class AddSchedulerTypeColumn1763398000000 implements MigrationInterface {
  name = 'AddSchedulerTypeColumn1763398000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasColumn('scheduler_configs', 'scheduler_type')) {
      return;
    }
    await queryRunner.query(`
      ALTER TABLE scheduler_configs
        ADD COLUMN scheduler_type VARCHAR(16) NOT NULL DEFAULT 'global' AFTER batch_size
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE scheduler_configs
        DROP COLUMN scheduler_type
    `);
  }
}
