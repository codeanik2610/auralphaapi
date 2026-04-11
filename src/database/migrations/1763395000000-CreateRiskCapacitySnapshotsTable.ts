import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class CreateRiskCapacitySnapshotsTable1763395000000 implements MigrationInterface {
  name = 'CreateRiskCapacitySnapshotsTable1763395000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS risk_capacity_snapshots (
        id char(36) NOT NULL,
        user_id char(36) NOT NULL,
        broker_key varchar(100) NOT NULL,
        account_id char(36) NOT NULL,
        account_name varchar(191) NOT NULL,

        equity double NOT NULL DEFAULT 0,

        margin_daily_pct double NOT NULL DEFAULT 0,
        margin_weekly_pct double NOT NULL DEFAULT 0,
        margin_monthly_pct double NOT NULL DEFAULT 0,

        concentration_daily_pct double NOT NULL DEFAULT 0,
        concentration_weekly_pct double NOT NULL DEFAULT 0,
        concentration_monthly_pct double NOT NULL DEFAULT 0,

        drawdown_daily_pct double NOT NULL DEFAULT 0,
        drawdown_weekly_pct double NOT NULL DEFAULT 0,
        drawdown_monthly_pct double NOT NULL DEFAULT 0,

        liquidation_daily_pct double DEFAULT NULL,
        liquidation_weekly_pct double DEFAULT NULL,
        liquidation_monthly_pct double DEFAULT NULL,

        margin_daily_status varchar(32) NOT NULL,
        margin_weekly_status varchar(32) NOT NULL,
        margin_monthly_status varchar(32) NOT NULL,

        concentration_daily_status varchar(32) NOT NULL,
        concentration_weekly_status varchar(32) NOT NULL,
        concentration_monthly_status varchar(32) NOT NULL,

        drawdown_daily_status varchar(32) NOT NULL,
        drawdown_weekly_status varchar(32) NOT NULL,
        drawdown_monthly_status varchar(32) NOT NULL,

        liquidation_daily_status varchar(32) NOT NULL,
        liquidation_weekly_status varchar(32) NOT NULL,
        liquidation_monthly_status varchar(32) NOT NULL,

        timezone varchar(64) NOT NULL DEFAULT 'Asia/Kolkata',
        window_day_start timestamp NOT NULL,
        window_week_start timestamp NOT NULL,
        window_month_start timestamp NOT NULL,
        computed_at timestamp NOT NULL,
        calc_version int NOT NULL DEFAULT 1,
        is_stale tinyint(1) NOT NULL DEFAULT 0,

        created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

        PRIMARY KEY (id),
        UNIQUE KEY uidx_risk_capacity_user_broker_account (user_id, broker_key, account_id),
        KEY idx_risk_capacity_user_computed (user_id, computed_at),
        KEY idx_risk_capacity_computed (computed_at),
        KEY idx_risk_capacity_stale (is_stale)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS risk_capacity_snapshots');
  }
}
