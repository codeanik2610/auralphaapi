import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class AddRiskPreTradeChecksPhase71770807800000 implements MigrationInterface {
  name = 'AddRiskPreTradeChecksPhase71770807800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS risk_request_checks (
        id char(36) NOT NULL,
        user_id varchar(191) NOT NULL,
        snapshot_id char(36) DEFAULT NULL,
        suggested_trade_id char(36) DEFAULT NULL,
        automation_id char(36) DEFAULT NULL,
        automation_run_id char(36) DEFAULT NULL,
        source_type varchar(40) NOT NULL,
        execution_mode varchar(20) NOT NULL,
        approval_mode varchar(20) NOT NULL,
        route_mode varchar(40) NOT NULL,
        broker_key varchar(100) DEFAULT NULL,
        account_id varchar(191) DEFAULT NULL,
        symbol varchar(64) NOT NULL,
        timeframe varchar(16) DEFAULT NULL,
        side varchar(10) NOT NULL,
        order_type varchar(20) NOT NULL,
        time_in_force varchar(10) DEFAULT NULL,
        quantity_mode varchar(20) NOT NULL,
        quantity double DEFAULT NULL,
        notional double DEFAULT NULL,
        risk_percent double DEFAULT NULL,
        entry_price double DEFAULT NULL,
        stop_loss_price double DEFAULT NULL,
        take_profit_targets_json json DEFAULT NULL,
        leverage double DEFAULT NULL,
        reduce_only tinyint(1) NOT NULL DEFAULT 0,
        status varchar(20) NOT NULL,
        freshness_state varchar(20) NOT NULL,
        snapshot_lag_minutes double DEFAULT NULL,
        checked_at timestamp NOT NULL,
        expires_at timestamp NULL DEFAULT NULL,
        allowed tinyint(1) NOT NULL DEFAULT 0,
        blocked tinyint(1) NOT NULL DEFAULT 0,
        approval_required tinyint(1) NOT NULL DEFAULT 0,
        blocking_rule_count int unsigned NOT NULL DEFAULT 0,
        warning_rule_count int unsigned NOT NULL DEFAULT 0,
        summary text NOT NULL,
        gross_exposure_delta double DEFAULT NULL,
        net_exposure_delta double DEFAULT NULL,
        open_order_exposure_delta double DEFAULT NULL,
        reserved_order_margin_delta double DEFAULT NULL,
        created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_risk_request_checks_user_created_at (user_id, created_at),
        KEY idx_risk_request_checks_user_snapshot_created_at (user_id, snapshot_id, created_at),
        KEY idx_risk_request_checks_user_suggested_trade_created_at (user_id, suggested_trade_id, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS risk_request_scope_impacts (
        id char(36) NOT NULL,
        check_id char(36) NOT NULL,
        user_id varchar(191) NOT NULL,
        snapshot_id char(36) DEFAULT NULL,
        scope_type varchar(40) NOT NULL,
        scope_key varchar(191) NOT NULL,
        scope_label varchar(255) DEFAULT NULL,
        broker_key varchar(100) DEFAULT NULL,
        account_id varchar(191) DEFAULT NULL,
        symbol varchar(64) DEFAULT NULL,
        before_gross_exposure double DEFAULT NULL,
        before_net_exposure double DEFAULT NULL,
        before_open_order_exposure double DEFAULT NULL,
        before_reserved_order_margin double DEFAULT NULL,
        before_margin_usage_pct double DEFAULT NULL,
        before_allocation_pct double DEFAULT NULL,
        before_risk_score double DEFAULT NULL,
        before_risk_state varchar(20) DEFAULT NULL,
        delta_gross_exposure double DEFAULT NULL,
        delta_net_exposure double DEFAULT NULL,
        delta_open_order_exposure double DEFAULT NULL,
        delta_reserved_order_margin double DEFAULT NULL,
        after_gross_exposure double DEFAULT NULL,
        after_net_exposure double DEFAULT NULL,
        after_open_order_exposure double DEFAULT NULL,
        after_reserved_order_margin double DEFAULT NULL,
        after_margin_usage_pct double DEFAULT NULL,
        after_allocation_pct double DEFAULT NULL,
        after_risk_score double DEFAULT NULL,
        after_risk_state varchar(20) DEFAULT NULL,
        sort_order int unsigned NOT NULL DEFAULT 0,
        created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_risk_request_scope_impacts_check_id (check_id),
        KEY idx_risk_request_scope_impacts_check_scope (check_id, scope_type, scope_key)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS risk_request_rule_evaluations (
        id char(36) NOT NULL,
        check_id char(36) NOT NULL,
        user_id varchar(191) NOT NULL,
        snapshot_id char(36) DEFAULT NULL,
        policy_context_id char(36) DEFAULT NULL,
        scope_type varchar(40) NOT NULL,
        scope_key varchar(191) NOT NULL,
        scope_label varchar(255) DEFAULT NULL,
        broker_key varchar(100) DEFAULT NULL,
        account_id varchar(191) DEFAULT NULL,
        symbol varchar(64) DEFAULT NULL,
        rule_code varchar(120) NOT NULL,
        metric_name varchar(120) DEFAULT NULL,
        actual_value double DEFAULT NULL,
        basis_value double DEFAULT NULL,
        warn_threshold_value double DEFAULT NULL,
        critical_threshold_value double DEFAULT NULL,
        status varchar(20) NOT NULL,
        blocking tinyint(1) NOT NULL DEFAULT 0,
        message text NOT NULL,
        sort_order int unsigned NOT NULL DEFAULT 0,
        created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_risk_request_rule_evaluations_check_id (check_id),
        KEY idx_risk_request_rule_evaluations_check_scope (check_id, scope_type, scope_key),
        KEY idx_risk_request_rule_evaluations_check_status (check_id, status, blocking)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS risk_request_rule_evaluations');
    await queryRunner.query('DROP TABLE IF EXISTS risk_request_scope_impacts');
    await queryRunner.query('DROP TABLE IF EXISTS risk_request_checks');
  }
}
