import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class ReviseRiskCapacityNowFields1763700000003 implements MigrationInterface {
  name = 'ReviseRiskCapacityNowFields1763700000003';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE risk_capacity_snapshots
        DROP COLUMN margin_daily_pct,
        DROP COLUMN margin_weekly_pct,
        DROP COLUMN margin_monthly_pct,
        DROP COLUMN drawdown_daily_pct,
        DROP COLUMN drawdown_weekly_pct,
        DROP COLUMN drawdown_monthly_pct,
        DROP COLUMN liquidation_daily_pct,
        DROP COLUMN liquidation_weekly_pct,
        DROP COLUMN liquidation_monthly_pct,
        DROP COLUMN margin_daily_status,
        DROP COLUMN margin_weekly_status,
        DROP COLUMN margin_monthly_status,
        DROP COLUMN drawdown_daily_status,
        DROP COLUMN drawdown_weekly_status,
        DROP COLUMN drawdown_monthly_status,
        DROP COLUMN liquidation_daily_status,
        DROP COLUMN liquidation_weekly_status,
        DROP COLUMN liquidation_monthly_status
    `);

    await queryRunner.query(`
      ALTER TABLE risk_capacity_snapshots
        ADD COLUMN margin_used double NOT NULL DEFAULT 0,
        ADD COLUMN margin_usage_pct double NOT NULL DEFAULT 0,
        ADD COLUMN margin_status varchar(32) NOT NULL DEFAULT 'Normal',
        ADD COLUMN loss_now double NOT NULL DEFAULT 0,
        ADD COLUMN loss_now_pct double NOT NULL DEFAULT 0,
        ADD COLUMN loss_status varchar(32) NOT NULL DEFAULT 'Normal',
        ADD COLUMN concentration_top_symbol varchar(64) NULL,
        ADD COLUMN concentration_top_pct double NOT NULL DEFAULT 0,
        ADD COLUMN concentration_status varchar(32) NOT NULL DEFAULT 'Normal',
        ADD COLUMN concentration_breakdown_json text NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE risk_capacity_snapshots
        DROP COLUMN margin_used,
        DROP COLUMN margin_usage_pct,
        DROP COLUMN margin_status,
        DROP COLUMN loss_now,
        DROP COLUMN loss_now_pct,
        DROP COLUMN loss_status,
        DROP COLUMN concentration_top_symbol,
        DROP COLUMN concentration_top_pct,
        DROP COLUMN concentration_status,
        DROP COLUMN concentration_breakdown_json
    `);

    await queryRunner.query(`
      ALTER TABLE risk_capacity_snapshots
        ADD COLUMN margin_daily_pct double NOT NULL DEFAULT 0,
        ADD COLUMN margin_weekly_pct double NOT NULL DEFAULT 0,
        ADD COLUMN margin_monthly_pct double NOT NULL DEFAULT 0,
        ADD COLUMN drawdown_daily_pct double NOT NULL DEFAULT 0,
        ADD COLUMN drawdown_weekly_pct double NOT NULL DEFAULT 0,
        ADD COLUMN drawdown_monthly_pct double NOT NULL DEFAULT 0,
        ADD COLUMN liquidation_daily_pct double NULL,
        ADD COLUMN liquidation_weekly_pct double NULL,
        ADD COLUMN liquidation_monthly_pct double NULL,
        ADD COLUMN margin_daily_status varchar(32) NOT NULL DEFAULT 'Normal',
        ADD COLUMN margin_weekly_status varchar(32) NOT NULL DEFAULT 'Normal',
        ADD COLUMN margin_monthly_status varchar(32) NOT NULL DEFAULT 'Normal',
        ADD COLUMN drawdown_daily_status varchar(32) NOT NULL DEFAULT 'Normal',
        ADD COLUMN drawdown_weekly_status varchar(32) NOT NULL DEFAULT 'Normal',
        ADD COLUMN drawdown_monthly_status varchar(32) NOT NULL DEFAULT 'Normal',
        ADD COLUMN liquidation_daily_status varchar(32) NOT NULL DEFAULT 'Normal',
        ADD COLUMN liquidation_weekly_status varchar(32) NOT NULL DEFAULT 'Normal',
        ADD COLUMN liquidation_monthly_status varchar(32) NOT NULL DEFAULT 'Normal'
    `);
  }
}
