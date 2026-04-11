import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class RemoveRiskCenterTables1763800000000 implements MigrationInterface {
  name = 'RemoveRiskCenterTables1763800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('risk_policies')) {
      const columnsToDrop = [
        'liquidation_buffer_warn_pct',
        'liquidation_buffer_critical_pct',
        'drawdown_warn_pct',
        'drawdown_critical_pct',
      ];
      for (const column of columnsToDrop) {
        if (await queryRunner.hasColumn('risk_policies', column)) {
          await queryRunner.query(`ALTER TABLE risk_policies DROP COLUMN ${column}`);
        }
      }
    }

    await queryRunner.query('DROP TABLE IF EXISTS risk_controls');
    await queryRunner.query('DROP TABLE IF EXISTS risk_alerts');
    await queryRunner.query('DROP TABLE IF EXISTS risk_scenarios');
    await queryRunner.query('DROP TABLE IF EXISTS risk_capacity_snapshots');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('risk_policies')) {
      const columnsToAdd: Array<[string, string]> = [
        ['liquidation_buffer_warn_pct', "double NOT NULL DEFAULT 8"],
        ['liquidation_buffer_critical_pct', "double NOT NULL DEFAULT 5"],
        ['drawdown_warn_pct', "double NOT NULL DEFAULT 3"],
        ['drawdown_critical_pct', "double NOT NULL DEFAULT 5"],
      ];
      for (const [column, definition] of columnsToAdd) {
        if (!(await queryRunner.hasColumn('risk_policies', column))) {
          await queryRunner.query(`ALTER TABLE risk_policies ADD COLUMN ${column} ${definition}`);
        }
      }
    }

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS risk_controls (
        id char(36) NOT NULL,
        snapshotId char(36) NOT NULL,
        bucket varchar(255) NOT NULL,
        exposure varchar(100) NOT NULL,
        threshold varchar(100) NOT NULL,
        status varchar(30) NOT NULL,
        action varchar(255) NOT NULL,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_risk_controls_snapshot_status (snapshotId, status),
        CONSTRAINT fk_risk_controls_snapshot_id FOREIGN KEY (snapshotId)
          REFERENCES risk_snapshots (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS risk_alerts (
        id char(36) NOT NULL,
        snapshotId char(36) NOT NULL,
        severity varchar(20) NOT NULL,
        message varchar(255) NOT NULL,
        symbol varchar(50) NOT NULL,
        channel varchar(50) NULL,
        status varchar(30) NULL,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_risk_alerts_snapshot_created_at (snapshotId, createdAt),
        CONSTRAINT fk_risk_alerts_snapshot_id FOREIGN KEY (snapshotId)
          REFERENCES risk_snapshots (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS risk_scenarios (
        id char(36) NOT NULL,
        snapshotId char(36) NOT NULL,
        user_id varchar(191) NOT NULL,
        scenario varchar(120) NOT NULL,
        impact varchar(60) NOT NULL,
        commentary varchar(255) NOT NULL,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_risk_scenarios_snapshot_created (snapshotId, createdAt),
        KEY idx_risk_scenarios_user_created (user_id, createdAt),
        CONSTRAINT fk_risk_scenarios_snapshot_id FOREIGN KEY (snapshotId)
          REFERENCES risk_snapshots (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS risk_capacity_snapshots (
        id char(36) NOT NULL,
        user_id char(36) NOT NULL,
        broker_key varchar(100) NOT NULL,
        account_id char(36) NOT NULL,
        account_name varchar(191) NOT NULL,
        equity double NOT NULL DEFAULT 0,
        margin_used double NOT NULL DEFAULT 0,
        margin_usage_pct double NOT NULL DEFAULT 0,
        margin_status varchar(32) NOT NULL DEFAULT 'Normal',
        loss_now double NOT NULL DEFAULT 0,
        loss_now_pct double NOT NULL DEFAULT 0,
        loss_status varchar(32) NOT NULL DEFAULT 'Normal',
        concentration_top_symbol varchar(64) NULL,
        concentration_top_pct double NOT NULL DEFAULT 0,
        concentration_status varchar(32) NOT NULL DEFAULT 'Normal',
        concentration_breakdown_json text NULL,
        timezone varchar(64) NOT NULL DEFAULT 'Asia/Kolkata',
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
}
