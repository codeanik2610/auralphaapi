import { Service } from 'typedi';
import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

@Service()
export class AddRiskAccountSnapshotsPhase11770802000000 implements MigrationInterface {
  name = 'AddRiskAccountSnapshotsPhase11770802000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('risk_snapshots')) {
      const snapshotColumns: TableColumn[] = [
        new TableColumn({
          name: 'denominator_basis',
          type: 'varchar',
          length: '50',
          isNullable: true,
        }),
        new TableColumn({
          name: 'portfolio_equity',
          type: 'double',
          default: '0',
        }),
        new TableColumn({
          name: 'gross_exposure',
          type: 'double',
          default: '0',
        }),
        new TableColumn({
          name: 'net_exposure',
          type: 'double',
          default: '0',
        }),
        new TableColumn({
          name: 'long_exposure',
          type: 'double',
          default: '0',
        }),
        new TableColumn({
          name: 'short_exposure',
          type: 'double',
          default: '0',
        }),
        new TableColumn({
          name: 'funds_observed_at',
          type: 'timestamp',
          isNullable: true,
        }),
        new TableColumn({
          name: 'positions_observed_at',
          type: 'timestamp',
          isNullable: true,
        }),
        new TableColumn({
          name: 'orders_observed_at',
          type: 'timestamp',
          isNullable: true,
        }),
      ];

      for (const column of snapshotColumns) {
        if (!(await queryRunner.hasColumn('risk_snapshots', column.name))) {
          await queryRunner.addColumn('risk_snapshots', column);
        }
      }
    }

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS risk_account_snapshots (
        id char(36) NOT NULL,
        snapshot_id char(36) NOT NULL,
        user_id varchar(191) NOT NULL,
        broker_key varchar(100) NOT NULL,
        account_id varchar(191) NOT NULL,
        account_name varchar(255) NOT NULL,
        denominator_basis varchar(50) DEFAULT NULL,
        wallet_balance double DEFAULT NULL,
        futures_balance double DEFAULT NULL,
        tracked_balance double DEFAULT NULL,
        gross_exposure double NOT NULL DEFAULT 0,
        net_exposure double NOT NULL DEFAULT 0,
        long_exposure double NOT NULL DEFAULT 0,
        short_exposure double NOT NULL DEFAULT 0,
        margin_usage_pct double NOT NULL DEFAULT 0,
        portfolio_concentration_pct double NOT NULL DEFAULT 0,
        daily_loss_usage_pct double NOT NULL DEFAULT 0,
        unrealized_pnl double NOT NULL DEFAULT 0,
        open_positions int unsigned NOT NULL DEFAULT 0,
        max_position_leverage double DEFAULT NULL,
        closest_liquidation_distance_pct double DEFAULT NULL,
        margin_usage_warn_pct double NOT NULL DEFAULT 0,
        margin_usage_critical_pct double NOT NULL DEFAULT 0,
        concentration_warn_pct double NOT NULL DEFAULT 0,
        concentration_critical_pct double NOT NULL DEFAULT 0,
        daily_loss_limit_pct double NOT NULL DEFAULT 0,
        weekly_loss_limit_pct double NOT NULL DEFAULT 0,
        monthly_loss_limit_pct double NOT NULL DEFAULT 0,
        max_leverage double NOT NULL DEFAULT 0,
        max_total_allocation double NOT NULL DEFAULT 0,
        max_avg_leverage double NOT NULL DEFAULT 0,
        funds_observed_at timestamp NULL DEFAULT NULL,
        positions_observed_at timestamp NULL DEFAULT NULL,
        orders_observed_at timestamp NULL DEFAULT NULL,
        created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_risk_account_snapshots_snapshot_id (snapshot_id),
        KEY idx_risk_account_snapshots_user_created_at (user_id, created_at),
        KEY idx_risk_account_snapshots_user_account_created_at (user_id, account_id, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS risk_account_snapshots');

    if (!(await queryRunner.hasTable('risk_snapshots'))) {
      return;
    }

    const snapshotColumns = [
      'orders_observed_at',
      'positions_observed_at',
      'funds_observed_at',
      'short_exposure',
      'long_exposure',
      'net_exposure',
      'gross_exposure',
      'portfolio_equity',
      'denominator_basis',
    ];

    for (const columnName of snapshotColumns) {
      if (await queryRunner.hasColumn('risk_snapshots', columnName)) {
        await queryRunner.dropColumn('risk_snapshots', columnName);
      }
    }
  }
}
