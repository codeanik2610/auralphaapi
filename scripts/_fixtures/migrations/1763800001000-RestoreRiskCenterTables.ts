import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class RestoreRiskCenterTables1763800001000 implements MigrationInterface {
  name = 'RestoreRiskCenterTables1763800001000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('risk_controls'))) {
      await queryRunner.query(`
        CREATE TABLE IF NOT EXISTS risk_controls (
          id char(36) NOT NULL,
          snapshotId char(36) NOT NULL,
          user_id varchar(191) NOT NULL,
          bucket varchar(255) NOT NULL,
          exposure varchar(100) NOT NULL,
          threshold varchar(100) NOT NULL,
          status varchar(30) NOT NULL,
          action varchar(255) NOT NULL,
          createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          KEY idx_risk_controls_snapshot_status (snapshotId, status),
          KEY IDX_risk_controls_USER_ID (user_id),
          CONSTRAINT fk_risk_controls_snapshot_id FOREIGN KEY (snapshotId)
            REFERENCES risk_snapshots (id) ON DELETE CASCADE,
          CONSTRAINT FK_risk_controls_USER_ID FOREIGN KEY (user_id)
            REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
      `);
    }

    if (!(await queryRunner.hasTable('risk_alerts'))) {
      await queryRunner.query(`
        CREATE TABLE IF NOT EXISTS risk_alerts (
          id char(36) NOT NULL,
          snapshotId char(36) NOT NULL,
          user_id varchar(191) NOT NULL,
          severity varchar(20) NOT NULL,
          message varchar(255) NOT NULL,
          symbol varchar(50) NOT NULL,
          channel varchar(50) NULL,
          status varchar(30) NULL,
          createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          KEY idx_risk_alerts_snapshot_created_at (snapshotId, createdAt),
          KEY IDX_risk_alerts_USER_ID (user_id),
          CONSTRAINT fk_risk_alerts_snapshot_id FOREIGN KEY (snapshotId)
            REFERENCES risk_snapshots (id) ON DELETE CASCADE,
          CONSTRAINT FK_risk_alerts_USER_ID FOREIGN KEY (user_id)
            REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
      `);
    }

    if (!(await queryRunner.hasTable('risk_scenarios'))) {
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
            REFERENCES risk_snapshots (id) ON DELETE CASCADE,
          CONSTRAINT FK_risk_scenarios_USER_ID FOREIGN KEY (user_id)
            REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('risk_scenarios')) {
      await queryRunner.query('DROP TABLE IF EXISTS risk_scenarios');
    }
    if (await queryRunner.hasTable('risk_alerts')) {
      await queryRunner.query('DROP TABLE IF EXISTS risk_alerts');
    }
    if (await queryRunner.hasTable('risk_controls')) {
      await queryRunner.query('DROP TABLE IF EXISTS risk_controls');
    }
  }
}
