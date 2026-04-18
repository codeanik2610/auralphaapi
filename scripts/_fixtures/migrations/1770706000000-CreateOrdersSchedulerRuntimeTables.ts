import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class CreateOrdersSchedulerRuntimeTables1770706000000
  implements MigrationInterface
{
  name = 'CreateOrdersSchedulerRuntimeTables1770706000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('scheduler_configs')) {
      const hasSchedulerType = await queryRunner.hasColumn(
        'scheduler_configs',
        'scheduler_type'
      );
      await queryRunner.query(`
        UPDATE scheduler_configs
        SET description = 'System reconciliation scheduler for broker order snapshots, checkpoints, and repair replay tooling.'
            ${hasSchedulerType ? ", scheduler_type = 'global'" : ''}
        WHERE \`key\` = 'orders-sync'
      `);
    }

    if (await queryRunner.hasTable('scheduler_user_configs')) {
      await queryRunner.query(`
        DELETE FROM scheduler_user_configs
        WHERE scheduler_key = 'orders-sync'
      `);
    }

    if (!(await queryRunner.hasTable('scheduler_sync_checkpoints'))) {
      await queryRunner.query(`
        CREATE TABLE IF NOT EXISTS scheduler_sync_checkpoints (
          id char(36) NOT NULL,
          scheduler_key varchar(128) NOT NULL,
          account_id char(36) NOT NULL,
          checkpoint_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
          created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY uidx_sync_checkpoint (scheduler_key, account_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
      `);
    } else if (!(await this.hasIndex(queryRunner, 'scheduler_sync_checkpoints', 'uidx_sync_checkpoint'))) {
      await queryRunner.query(`
        ALTER TABLE scheduler_sync_checkpoints
        ADD UNIQUE KEY uidx_sync_checkpoint (scheduler_key, account_id)
      `);
    }

    if (!(await queryRunner.hasTable('scheduler_orders_snapshots'))) {
      await queryRunner.query(`
        CREATE TABLE IF NOT EXISTS scheduler_orders_snapshots (
          id char(36) NOT NULL,
          user_id char(36) NOT NULL,
          account_id char(36) NOT NULL,
          broker_key varchar(100) NOT NULL,
          external_id varchar(191) NOT NULL,
          symbol varchar(100) NULL,
          order_status varchar(64) NULL,
          status_rank int NOT NULL DEFAULT 0,
          payload_json json NULL,
          payload_hash char(64) NULL,
          first_seen_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
          last_seen_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
          created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY uidx_scheduler_orders_snapshot (user_id, account_id, external_id),
          KEY idx_scheduler_orders_last_seen (last_seen_at),
          KEY idx_scheduler_orders_user_account (user_id, account_id),
          KEY idx_scheduler_orders_user_account_status_seen (user_id, account_id, status_rank, last_seen_at),
          KEY idx_scheduler_orders_user_account_status_updated (user_id, account_id, status_rank, updated_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
      `);
    } else {
      if (!(await queryRunner.hasColumn('scheduler_orders_snapshots', 'payload_hash'))) {
        await queryRunner.query(`
          ALTER TABLE scheduler_orders_snapshots
          ADD COLUMN payload_hash char(64) NULL AFTER payload_json
        `);
      }

      if (
        !(await this.hasIndex(
          queryRunner,
          'scheduler_orders_snapshots',
          'uidx_scheduler_orders_snapshot'
        ))
      ) {
        await queryRunner.query(`
          ALTER TABLE scheduler_orders_snapshots
          ADD UNIQUE KEY uidx_scheduler_orders_snapshot (user_id, account_id, external_id)
        `);
      }

      if (
        !(await this.hasIndex(
          queryRunner,
          'scheduler_orders_snapshots',
          'idx_scheduler_orders_last_seen'
        ))
      ) {
        await queryRunner.query(`
          ALTER TABLE scheduler_orders_snapshots
          ADD KEY idx_scheduler_orders_last_seen (last_seen_at)
        `);
      }

      if (
        !(await this.hasIndex(
          queryRunner,
          'scheduler_orders_snapshots',
          'idx_scheduler_orders_user_account'
        ))
      ) {
        await queryRunner.query(`
          ALTER TABLE scheduler_orders_snapshots
          ADD KEY idx_scheduler_orders_user_account (user_id, account_id)
        `);
      }

      if (
        !(await this.hasIndex(
          queryRunner,
          'scheduler_orders_snapshots',
          'idx_scheduler_orders_user_account_status_seen'
        ))
      ) {
        await queryRunner.query(`
          ALTER TABLE scheduler_orders_snapshots
          ADD KEY idx_scheduler_orders_user_account_status_seen (user_id, account_id, status_rank, last_seen_at)
        `);
      }

      if (
        !(await this.hasIndex(
          queryRunner,
          'scheduler_orders_snapshots',
          'idx_scheduler_orders_user_account_status_updated'
        ))
      ) {
        await queryRunner.query(`
          ALTER TABLE scheduler_orders_snapshots
          ADD KEY idx_scheduler_orders_user_account_status_updated (user_id, account_id, status_rank, updated_at)
        `);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('scheduler_configs')) {
      await queryRunner.query(`
        UPDATE scheduler_configs
        SET description = 'Reconciles orders in monitor mode with pending-first checkpoints and data-loss guards.'
        WHERE \`key\` = 'orders-sync'
      `);
    }

    if (await queryRunner.hasTable('scheduler_orders_snapshots')) {
      await queryRunner.query('DROP TABLE IF EXISTS scheduler_orders_snapshots');
    }
  }

  private async hasIndex(
    queryRunner: QueryRunner,
    tableName: string,
    indexName: string
  ): Promise<boolean> {
    const rows = (await queryRunner.query(
      `SHOW INDEX FROM ${tableName} WHERE Key_name = ?`,
      [indexName]
    )) as Array<{ Key_name?: string }>;

    return rows.length > 0;
  }
}
