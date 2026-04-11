import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class RemoveWindowStartsFromRiskCapacity1763700000002 implements MigrationInterface {
  name = 'RemoveWindowStartsFromRiskCapacity1763700000002';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE risk_capacity_snapshots
        DROP COLUMN window_day_start,
        DROP COLUMN window_week_start,
        DROP COLUMN window_month_start
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE risk_capacity_snapshots
        ADD COLUMN window_day_start timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        ADD COLUMN window_week_start timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        ADD COLUMN window_month_start timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
    `);
  }
}
