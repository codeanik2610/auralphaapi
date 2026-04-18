import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class AddRiskNormalizedScopeStoragePhase51770806000000 implements MigrationInterface {
  name = 'AddRiskNormalizedScopeStoragePhase51770806000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS risk_snapshot_policy_contexts (
        id char(36) NOT NULL,
        snapshot_id char(36) NOT NULL,
        user_id varchar(191) NOT NULL,
        context_key varchar(191) NOT NULL,
        policy_id char(36) DEFAULT NULL,
        policy_scope varchar(20) NOT NULL,
        policy_target_key varchar(191) NOT NULL,
        enabled tinyint(1) NOT NULL DEFAULT 1,
        monitor_only tinyint(1) NOT NULL DEFAULT 1,
        enforce_hard_block tinyint(1) NOT NULL DEFAULT 0,
        margin_usage_warn_pct double NOT NULL DEFAULT 70,
        margin_usage_critical_pct double NOT NULL DEFAULT 85,
        concentration_warn_pct double NOT NULL DEFAULT 30,
        concentration_critical_pct double NOT NULL DEFAULT 45,
        daily_loss_limit_pct double NOT NULL DEFAULT 5,
        weekly_loss_limit_pct double NOT NULL DEFAULT 12,
        monthly_loss_limit_pct double NOT NULL DEFAULT 20,
        max_leverage double DEFAULT NULL,
        max_order_allocation double DEFAULT NULL,
        max_total_allocation double DEFAULT NULL,
        max_avg_leverage double DEFAULT NULL,
        created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uidx_risk_snapshot_policy_contexts_snapshot_context_key (snapshot_id, context_key),
        KEY idx_risk_snapshot_policy_contexts_snapshot_id (snapshot_id),
        KEY idx_risk_snapshot_policy_contexts_user_scope_created_at (user_id, policy_scope, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS risk_snapshot_source_coverage (
        id char(36) NOT NULL,
        snapshot_id char(36) NOT NULL,
        user_id varchar(191) NOT NULL,
        broker_key varchar(100) NOT NULL,
        account_id varchar(191) NOT NULL,
        account_name varchar(255) NOT NULL,
        latest_funds_snapshot_id char(36) DEFAULT NULL,
        latest_funds_snapshot_date varchar(64) DEFAULT NULL,
        latest_funds_observed_at timestamp NULL DEFAULT NULL,
        latest_funds_computed_at timestamp NULL DEFAULT NULL,
        latest_funds_last_attempt_at timestamp NULL DEFAULT NULL,
        latest_funds_fetch_status varchar(20) DEFAULT NULL,
        latest_funds_error_message text DEFAULT NULL,
        latest_funds_source varchar(50) DEFAULT NULL,
        latest_wallet_available tinyint(1) NOT NULL DEFAULT 0,
        latest_futures_available tinyint(1) NOT NULL DEFAULT 0,
        latest_success_funds_snapshot_id char(36) DEFAULT NULL,
        latest_success_funds_snapshot_date varchar(64) DEFAULT NULL,
        latest_success_funds_observed_at timestamp NULL DEFAULT NULL,
        latest_success_funds_computed_at timestamp NULL DEFAULT NULL,
        latest_success_funds_source varchar(50) DEFAULT NULL,
        latest_success_wallet_available tinyint(1) NOT NULL DEFAULT 0,
        latest_success_futures_available tinyint(1) NOT NULL DEFAULT 0,
        positions_observed_at timestamp NULL DEFAULT NULL,
        positions_checkpoint_at timestamp NULL DEFAULT NULL,
        open_positions int unsigned NOT NULL DEFAULT 0,
        position_total_rows int unsigned NOT NULL DEFAULT 0,
        position_snapshot_rows int unsigned NOT NULL DEFAULT 0,
        position_read_model_rows int unsigned NOT NULL DEFAULT 0,
        rows_missing_from_read_model int unsigned NOT NULL DEFAULT 0,
        rows_behind_snapshot int unsigned NOT NULL DEFAULT 0,
        orphan_read_model_rows int unsigned NOT NULL DEFAULT 0,
        latest_position_snapshot_seen_at timestamp NULL DEFAULT NULL,
        latest_position_read_model_seen_at timestamp NULL DEFAULT NULL,
        open_order_rows int unsigned NOT NULL DEFAULT 0,
        latest_order_seen_at timestamp NULL DEFAULT NULL,
        created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uidx_risk_snapshot_source_coverage_snapshot_account (snapshot_id, account_id),
        KEY idx_risk_snapshot_source_coverage_snapshot_id (snapshot_id),
        KEY idx_risk_snapshot_source_coverage_user_account_created_at (user_id, account_id, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS risk_broker_snapshots (
        id char(36) NOT NULL,
        snapshot_id char(36) NOT NULL,
        user_id varchar(191) NOT NULL,
        broker_key varchar(100) NOT NULL,
        policy_context_id char(36) DEFAULT NULL,
        account_count int unsigned NOT NULL DEFAULT 0,
        tracked_balance double NOT NULL DEFAULT 0,
        wallet_balance double NOT NULL DEFAULT 0,
        futures_balance double NOT NULL DEFAULT 0,
        gross_exposure double NOT NULL DEFAULT 0,
        net_exposure double NOT NULL DEFAULT 0,
        long_exposure double NOT NULL DEFAULT 0,
        short_exposure double NOT NULL DEFAULT 0,
        open_positions int unsigned NOT NULL DEFAULT 0,
        open_orders int unsigned NOT NULL DEFAULT 0,
        open_order_exposure double NOT NULL DEFAULT 0,
        reserved_order_margin double NOT NULL DEFAULT 0,
        unrealized_pnl double NOT NULL DEFAULT 0,
        realized_pnl double NOT NULL DEFAULT 0,
        weighted_avg_leverage double DEFAULT NULL,
        max_leverage double DEFAULT NULL,
        worst_liquidation_distance_pct double DEFAULT NULL,
        risk_score int unsigned NOT NULL DEFAULT 0,
        risk_state varchar(20) NOT NULL DEFAULT 'ok',
        primary_concern varchar(255) DEFAULT NULL,
        created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uidx_risk_broker_snapshots_snapshot_broker (snapshot_id, broker_key),
        KEY idx_risk_broker_snapshots_snapshot_id (snapshot_id),
        KEY idx_risk_broker_snapshots_snapshot_risk_state_score (snapshot_id, risk_state, risk_score)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS risk_asset_snapshots (
        id char(36) NOT NULL,
        snapshot_id char(36) NOT NULL,
        user_id varchar(191) NOT NULL,
        symbol varchar(100) NOT NULL,
        account_count int unsigned NOT NULL DEFAULT 0,
        broker_count int unsigned NOT NULL DEFAULT 0,
        position_count int unsigned NOT NULL DEFAULT 0,
        open_orders int unsigned NOT NULL DEFAULT 0,
        open_order_exposure double NOT NULL DEFAULT 0,
        reserved_order_margin double NOT NULL DEFAULT 0,
        gross_exposure double NOT NULL DEFAULT 0,
        net_exposure double NOT NULL DEFAULT 0,
        long_exposure double NOT NULL DEFAULT 0,
        short_exposure double NOT NULL DEFAULT 0,
        unrealized_pnl double NOT NULL DEFAULT 0,
        realized_pnl double NOT NULL DEFAULT 0,
        weighted_avg_leverage double DEFAULT NULL,
        max_leverage double DEFAULT NULL,
        worst_liquidation_distance_pct double DEFAULT NULL,
        risk_score int unsigned NOT NULL DEFAULT 0,
        risk_state varchar(20) NOT NULL DEFAULT 'ok',
        primary_concern varchar(255) DEFAULT NULL,
        created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uidx_risk_asset_snapshots_snapshot_symbol (snapshot_id, symbol),
        KEY idx_risk_asset_snapshots_snapshot_id (snapshot_id),
        KEY idx_risk_asset_snapshots_snapshot_risk_state_score (snapshot_id, risk_state, risk_score)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS risk_broker_asset_snapshots (
        id char(36) NOT NULL,
        snapshot_id char(36) NOT NULL,
        user_id varchar(191) NOT NULL,
        broker_key varchar(100) NOT NULL,
        symbol varchar(100) NOT NULL,
        policy_context_id char(36) DEFAULT NULL,
        account_count int unsigned NOT NULL DEFAULT 0,
        position_count int unsigned NOT NULL DEFAULT 0,
        open_orders int unsigned NOT NULL DEFAULT 0,
        open_order_exposure double NOT NULL DEFAULT 0,
        reserved_order_margin double NOT NULL DEFAULT 0,
        gross_exposure double NOT NULL DEFAULT 0,
        net_exposure double NOT NULL DEFAULT 0,
        long_exposure double NOT NULL DEFAULT 0,
        short_exposure double NOT NULL DEFAULT 0,
        unrealized_pnl double NOT NULL DEFAULT 0,
        realized_pnl double NOT NULL DEFAULT 0,
        weighted_avg_leverage double DEFAULT NULL,
        max_leverage double DEFAULT NULL,
        worst_liquidation_distance_pct double DEFAULT NULL,
        risk_score int unsigned NOT NULL DEFAULT 0,
        risk_state varchar(20) NOT NULL DEFAULT 'ok',
        primary_concern varchar(255) DEFAULT NULL,
        created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uidx_risk_broker_asset_snapshots_snapshot_broker_symbol (snapshot_id, broker_key, symbol),
        KEY idx_risk_broker_asset_snapshots_snapshot_id (snapshot_id),
        KEY idx_risk_broker_asset_snapshots_snapshot_risk_state_score (snapshot_id, risk_state, risk_score)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS risk_broker_asset_snapshots');
    await queryRunner.query('DROP TABLE IF EXISTS risk_asset_snapshots');
    await queryRunner.query('DROP TABLE IF EXISTS risk_broker_snapshots');
    await queryRunner.query('DROP TABLE IF EXISTS risk_snapshot_source_coverage');
    await queryRunner.query('DROP TABLE IF EXISTS risk_snapshot_policy_contexts');
  }
}
