import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class AddRiskPositionSnapshotsPhase21770803000000 implements MigrationInterface {
  name = 'AddRiskPositionSnapshotsPhase21770803000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS risk_position_snapshots (
        id char(36) NOT NULL,
        snapshot_id char(36) NOT NULL,
        user_id varchar(191) NOT NULL,
        broker_key varchar(100) NOT NULL,
        account_id varchar(191) NOT NULL,
        account_name varchar(255) NOT NULL,
        position_id varchar(191) NOT NULL,
        symbol varchar(100) NOT NULL,
        side varchar(50) DEFAULT NULL,
        side_key varchar(20) DEFAULT NULL,
        status varchar(50) DEFAULT NULL,
        status_key varchar(20) DEFAULT NULL,
        quantity double DEFAULT NULL,
        entry_price double DEFAULT NULL,
        current_price double DEFAULT NULL,
        exposure double NOT NULL DEFAULT 0,
        unrealized_pnl double DEFAULT NULL,
        realized_pnl double DEFAULT NULL,
        leverage double DEFAULT NULL,
        liquidation_price double DEFAULT NULL,
        liquidation_distance_pct double DEFAULT NULL,
        concentration_pct double DEFAULT NULL,
        risk_state varchar(20) NOT NULL DEFAULT 'ok',
        risk_notes_json json DEFAULT NULL,
        position_opened_at timestamp NULL DEFAULT NULL,
        source_updated_at timestamp NULL DEFAULT NULL,
        created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_risk_position_snapshots_snapshot_id (snapshot_id),
        KEY idx_risk_position_snapshots_user_created_at (user_id, created_at),
        KEY idx_risk_position_snapshots_user_account_created_at (user_id, account_id, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS risk_position_snapshots');
  }
}
