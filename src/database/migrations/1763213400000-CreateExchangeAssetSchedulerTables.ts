import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class CreateExchangeAssetSchedulerTables1763213400000 implements MigrationInterface {
  name = 'CreateExchangeAssetSchedulerTables1763213400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS scheduler_configs (
        id char(36) NOT NULL,
        \`key\` varchar(100) NOT NULL,
        name varchar(191) NOT NULL,
        description varchar(255) DEFAULT NULL,
        enabled tinyint(1) NOT NULL DEFAULT 0,
        cron_expression varchar(64) NOT NULL,
        timezone varchar(64) NOT NULL DEFAULT 'Asia/Kolkata',
        run_at varchar(5) NOT NULL DEFAULT '01:00',
        interval_days int NOT NULL DEFAULT 1,
        batch_size int NOT NULL DEFAULT 200,
        config text DEFAULT NULL,
        last_started_at timestamp NULL DEFAULT NULL,
        last_finished_at timestamp NULL DEFAULT NULL,
        last_status varchar(32) DEFAULT NULL,
        last_error text DEFAULT NULL,
        running_lock_until timestamp NULL DEFAULT NULL,
        created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uidx_scheduler_configs_key (\`key\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS scheduler_run_logs (
        id char(36) NOT NULL,
        scheduler_key varchar(100) NOT NULL,
        status varchar(32) NOT NULL,
        started_at timestamp NOT NULL,
        finished_at timestamp NULL DEFAULT NULL,
        duration_ms int DEFAULT NULL,
        processed_accounts int NOT NULL DEFAULT 0,
        inserted_assets int NOT NULL DEFAULT 0,
        updated_assets int NOT NULL DEFAULT 0,
        skipped_assets int NOT NULL DEFAULT 0,
        error_message text DEFAULT NULL,
        meta_json text DEFAULT NULL,
        created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_scheduler_run_logs_key_started (scheduler_key, started_at),
        CONSTRAINT fk_scheduler_run_logs_scheduler_key
          FOREIGN KEY (scheduler_key) REFERENCES scheduler_configs(\`key\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS exchange_asset_update_logs (
        id char(36) NOT NULL,
        run_log_id char(36) NOT NULL,
        source varchar(64) NOT NULL,
        account_id char(36) DEFAULT NULL,
        connection_id char(36) DEFAULT NULL,
        action_type varchar(32) NOT NULL,
        symbol varchar(100) DEFAULT NULL,
        external_id varchar(255) DEFAULT NULL,
        asset_id varchar(36) DEFAULT NULL,
        message varchar(255) DEFAULT NULL,
        detail_json text DEFAULT NULL,
        created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_exchange_asset_update_logs_run_created (run_log_id, created_at),
        KEY idx_exchange_asset_update_logs_source_symbol (source, symbol),
        CONSTRAINT fk_exchange_asset_update_logs_run_log
          FOREIGN KEY (run_log_id) REFERENCES scheduler_run_logs(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    `);

    await queryRunner.query('ALTER TABLE connections MODIFY COLUMN user_id char(36) NULL');
    await queryRunner.query('ALTER TABLE broker_accounts MODIFY COLUMN user_id char(36) NULL');
    await queryRunner.query('ALTER TABLE broker_assets MODIFY COLUMN user_id char(36) NULL');

    await queryRunner.query(`
      INSERT INTO scheduler_configs (
        id, \`key\`, name, description, enabled, cron_expression, timezone, run_at, interval_days, batch_size, config
      )
      SELECT
        UUID(),
        'broker-assets-sync',
        'Broker Assets Daily Sync',
        'Fetches provider assets for system broker accounts and updates broker assets table',
        0,
        '0 1 * * *',
        'Asia/Kolkata',
        '01:00',
        1,
        200,
        JSON_OBJECT('sources', JSON_ARRAY('mudrex', 'delta_exchange'), 'useSystemAccountsOnly', true)
        
      FROM DUAL
      WHERE NOT EXISTS (
        SELECT 1 FROM scheduler_configs WHERE \`key\` = 'broker-assets-sync'
      );
    `);

    await queryRunner.query(`
      UPDATE scheduler_configs
      SET config = JSON_SET(COALESCE(config, JSON_OBJECT()), '$.retentionDays', 30)
      WHERE \`key\` = 'broker-assets-sync'
        AND (
          config IS NULL
          OR JSON_EXTRACT(config, '$.retentionDays') IS NULL
        );
    `);

    const columnRows = (await queryRunner.query(`
      SELECT COUNT(*) as count
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'scheduler_configs'
        AND column_name = 'running_lock_until'
    `)) as Array<{ count: number | string }>;

    const hasRunningLockUntil = Number(columnRows?.[0]?.count || 0) > 0;
    if (!hasRunningLockUntil) {
      await queryRunner.query(`
        ALTER TABLE scheduler_configs
        ADD COLUMN running_lock_until timestamp NULL DEFAULT NULL
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS exchange_asset_update_logs');
    await queryRunner.query('DROP TABLE IF EXISTS scheduler_run_logs');
    await queryRunner.query('DELETE FROM scheduler_configs WHERE `key` = \'broker-assets-sync\'');
    await queryRunner.query('DROP TABLE IF EXISTS scheduler_configs');
  }
}
