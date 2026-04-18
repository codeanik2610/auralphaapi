import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class AddRiskRuleEvaluationsPhase61770807200000 implements MigrationInterface {
  name = 'AddRiskRuleEvaluationsPhase61770807200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS risk_rule_evaluations (
        id char(36) NOT NULL,
        snapshot_id char(36) NOT NULL,
        user_id varchar(191) NOT NULL,
        policy_context_id char(36) DEFAULT NULL,
        source_type varchar(40) NOT NULL,
        scope_type varchar(40) NOT NULL,
        scope_key varchar(191) NOT NULL,
        scope_label varchar(255) DEFAULT NULL,
        broker_key varchar(100) DEFAULT NULL,
        account_id varchar(191) DEFAULT NULL,
        position_id varchar(191) DEFAULT NULL,
        symbol varchar(100) DEFAULT NULL,
        rule_code varchar(120) NOT NULL,
        metric_name varchar(120) DEFAULT NULL,
        actual_value double DEFAULT NULL,
        basis_value double DEFAULT NULL,
        warn_threshold_value double DEFAULT NULL,
        critical_threshold_value double DEFAULT NULL,
        status varchar(20) NOT NULL,
        bucket varchar(255) DEFAULT NULL,
        exposure varchar(120) DEFAULT NULL,
        threshold varchar(255) DEFAULT NULL,
        action text DEFAULT NULL,
        alert_severity varchar(20) DEFAULT NULL,
        alert_message text DEFAULT NULL,
        alert_symbol varchar(100) DEFAULT NULL,
        alert_channel varchar(100) DEFAULT NULL,
        alert_status varchar(40) DEFAULT NULL,
        sort_order int unsigned NOT NULL DEFAULT 0,
        created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_risk_rule_evaluations_snapshot_id (snapshot_id),
        KEY idx_risk_rule_evaluations_snapshot_scope (snapshot_id, scope_type, scope_key),
        KEY idx_risk_rule_evaluations_user_source_created_at (user_id, source_type, created_at),
        KEY idx_risk_rule_evaluations_snapshot_alert_severity (snapshot_id, alert_severity, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS risk_rule_evaluations');
  }
}
