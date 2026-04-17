import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class AddRiskOrderSnapshotsPhase31770804000000 implements MigrationInterface {
  name = 'AddRiskOrderSnapshotsPhase31770804000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS risk_order_snapshots (
        id char(36) NOT NULL,
        snapshot_id char(36) NOT NULL,
        user_id varchar(191) NOT NULL,
        broker_key varchar(100) NOT NULL,
        account_id varchar(191) NOT NULL,
        account_name varchar(255) NOT NULL,
        external_id varchar(191) NOT NULL,
        order_id varchar(191) DEFAULT NULL,
        symbol varchar(100) DEFAULT NULL,
        side varchar(50) DEFAULT NULL,
        status varchar(50) DEFAULT NULL,
        order_type varchar(50) DEFAULT NULL,
        trigger_type varchar(50) DEFAULT NULL,
        quantity double DEFAULT NULL,
        filled_quantity double DEFAULT NULL,
        remaining_quantity double DEFAULT NULL,
        price double DEFAULT NULL,
        order_price double DEFAULT NULL,
        trigger_price double DEFAULT NULL,
        filled_price double DEFAULT NULL,
        last_price double DEFAULT NULL,
        stoploss_price double DEFAULT NULL,
        takeprofit_price double DEFAULT NULL,
        leverage double DEFAULT NULL,
        reduce_only tinyint(1) DEFAULT NULL,
        snapshot_status_rank int NOT NULL DEFAULT 0,
        notional double DEFAULT NULL,
        order_created_at timestamp NULL DEFAULT NULL,
        order_updated_at timestamp NULL DEFAULT NULL,
        order_canceled_at timestamp NULL DEFAULT NULL,
        first_seen_at timestamp NULL DEFAULT NULL,
        last_seen_at timestamp NULL DEFAULT NULL,
        created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_risk_order_snapshots_snapshot_id (snapshot_id),
        KEY idx_risk_order_snapshots_user_created_at (user_id, created_at),
        KEY idx_risk_order_snapshots_user_account_created_at (user_id, account_id, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS risk_order_snapshots');
  }
}
