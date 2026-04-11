import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class RemoveSplitConcentrationFromRiskCapacity1763700000000 implements MigrationInterface {
  name = 'RemoveSplitConcentrationFromRiskCapacity1763700000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE risk_capacity_snapshots
        DROP COLUMN position_concentration_daily_pct,
        DROP COLUMN position_concentration_weekly_pct,
        DROP COLUMN position_concentration_monthly_pct,
        DROP COLUMN order_concentration_daily_pct,
        DROP COLUMN order_concentration_weekly_pct,
        DROP COLUMN order_concentration_monthly_pct,
        DROP COLUMN position_concentration_daily_status,
        DROP COLUMN position_concentration_weekly_status,
        DROP COLUMN position_concentration_monthly_status,
        DROP COLUMN order_concentration_daily_status,
        DROP COLUMN order_concentration_weekly_status,
        DROP COLUMN order_concentration_monthly_status
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE risk_capacity_snapshots
        ADD COLUMN position_concentration_daily_pct double NOT NULL DEFAULT 0,
        ADD COLUMN position_concentration_weekly_pct double NOT NULL DEFAULT 0,
        ADD COLUMN position_concentration_monthly_pct double NOT NULL DEFAULT 0,
        ADD COLUMN order_concentration_daily_pct double NOT NULL DEFAULT 0,
        ADD COLUMN order_concentration_weekly_pct double NOT NULL DEFAULT 0,
        ADD COLUMN order_concentration_monthly_pct double NOT NULL DEFAULT 0,
        ADD COLUMN position_concentration_daily_status varchar(32) NOT NULL DEFAULT 'Normal',
        ADD COLUMN position_concentration_weekly_status varchar(32) NOT NULL DEFAULT 'Normal',
        ADD COLUMN position_concentration_monthly_status varchar(32) NOT NULL DEFAULT 'Normal',
        ADD COLUMN order_concentration_daily_status varchar(32) NOT NULL DEFAULT 'Normal',
        ADD COLUMN order_concentration_weekly_status varchar(32) NOT NULL DEFAULT 'Normal',
        ADD COLUMN order_concentration_monthly_status varchar(32) NOT NULL DEFAULT 'Normal'
    `);
  }
}
