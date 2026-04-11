import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class RemoveConcentrationWindowFromRiskCapacity1763700000001 implements MigrationInterface {
  name = 'RemoveConcentrationWindowFromRiskCapacity1763700000001';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE risk_capacity_snapshots
        DROP COLUMN concentration_daily_pct,
        DROP COLUMN concentration_weekly_pct,
        DROP COLUMN concentration_monthly_pct,
        DROP COLUMN concentration_daily_status,
        DROP COLUMN concentration_weekly_status,
        DROP COLUMN concentration_monthly_status
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE risk_capacity_snapshots
        ADD COLUMN concentration_daily_pct double NOT NULL DEFAULT 0,
        ADD COLUMN concentration_weekly_pct double NOT NULL DEFAULT 0,
        ADD COLUMN concentration_monthly_pct double NOT NULL DEFAULT 0,
        ADD COLUMN concentration_daily_status varchar(32) NOT NULL DEFAULT 'Normal',
        ADD COLUMN concentration_weekly_status varchar(32) NOT NULL DEFAULT 'Normal',
        ADD COLUMN concentration_monthly_status varchar(32) NOT NULL DEFAULT 'Normal'
    `);
  }
}
