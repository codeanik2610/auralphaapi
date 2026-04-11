import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class HardenFundsSnapshotsRuntime1770707000000 implements MigrationInterface {
  name = 'HardenFundsSnapshotsRuntime1770707000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('funds_snapshots'))) {
      await queryRunner.query(`
        CREATE TABLE IF NOT EXISTS funds_snapshots (
          id char(36) NOT NULL,
          user_id varchar(191) NOT NULL,
          broker_key varchar(100) NOT NULL,
          account_id char(36) NOT NULL,
          wallet_funds_json json NULL,
          futures_funds_json json NULL,
          computed_at timestamp NOT NULL,
          snapshot_date date NOT NULL,
          observed_at timestamp NULL,
          last_attempt_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
          fetch_status varchar(20) NOT NULL DEFAULT 'success',
          error_message text NULL,
          source varchar(100) NOT NULL DEFAULT 'broker_runtime',
          created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          KEY idx_funds_snapshots_user_computed (user_id, computed_at),
          KEY idx_funds_snapshots_user_broker_account (user_id, broker_key, account_id),
          KEY idx_funds_snapshots_user_status_attempt (user_id, fetch_status, last_attempt_at),
          KEY idx_funds_snapshots_user_broker_account_attempt (user_id, broker_key, account_id, last_attempt_at),
          UNIQUE KEY uidx_funds_snapshots_user_account_day (user_id, broker_key, account_id, snapshot_date),
          CONSTRAINT fk_funds_snapshots_user_id FOREIGN KEY (user_id)
            REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
      `);
      return;
    }

    if (!(await queryRunner.hasColumn('funds_snapshots', 'snapshot_date'))) {
      await queryRunner.query(`
        ALTER TABLE funds_snapshots
        ADD COLUMN snapshot_date date NULL AFTER computed_at
      `);
    }

    if (!(await queryRunner.hasColumn('funds_snapshots', 'observed_at'))) {
      await queryRunner.query(`
        ALTER TABLE funds_snapshots
        ADD COLUMN observed_at timestamp NULL AFTER snapshot_date
      `);
    }

    if (!(await queryRunner.hasColumn('funds_snapshots', 'last_attempt_at'))) {
      await queryRunner.query(`
        ALTER TABLE funds_snapshots
        ADD COLUMN last_attempt_at timestamp NULL AFTER observed_at
      `);
    }

    if (!(await queryRunner.hasColumn('funds_snapshots', 'fetch_status'))) {
      await queryRunner.query(`
        ALTER TABLE funds_snapshots
        ADD COLUMN fetch_status varchar(20) NULL AFTER last_attempt_at
      `);
    }

    if (!(await queryRunner.hasColumn('funds_snapshots', 'error_message'))) {
      await queryRunner.query(`
        ALTER TABLE funds_snapshots
        ADD COLUMN error_message text NULL AFTER fetch_status
      `);
    }

    if (!(await queryRunner.hasColumn('funds_snapshots', 'source'))) {
      await queryRunner.query(`
        ALTER TABLE funds_snapshots
        ADD COLUMN source varchar(100) NULL AFTER error_message
      `);
    }

    await queryRunner.query(`
      UPDATE funds_snapshots
      SET
        snapshot_date = COALESCE(snapshot_date, DATE(computed_at)),
        observed_at = COALESCE(
          observed_at,
          CASE
            WHEN wallet_funds_json IS NOT NULL OR futures_funds_json IS NOT NULL THEN computed_at
            ELSE NULL
          END
        ),
        last_attempt_at = COALESCE(last_attempt_at, computed_at),
        fetch_status = COALESCE(
          NULLIF(TRIM(fetch_status), ''),
          CASE
            WHEN wallet_funds_json IS NOT NULL OR futures_funds_json IS NOT NULL THEN 'success'
            ELSE 'failed'
          END
        ),
        source = COALESCE(NULLIF(TRIM(source), ''), 'legacy_snapshot')
    `);

    await queryRunner.query(`
      DELETE older
      FROM funds_snapshots older
      INNER JOIN funds_snapshots newer
        ON older.user_id = newer.user_id
       AND older.broker_key = newer.broker_key
       AND older.account_id = newer.account_id
       AND older.snapshot_date = newer.snapshot_date
       AND (
         COALESCE(older.last_attempt_at, older.observed_at, older.computed_at)
           < COALESCE(newer.last_attempt_at, newer.observed_at, newer.computed_at)
         OR (
           COALESCE(older.last_attempt_at, older.observed_at, older.computed_at)
             = COALESCE(newer.last_attempt_at, newer.observed_at, newer.computed_at)
           AND older.created_at < newer.created_at
         )
         OR (
           COALESCE(older.last_attempt_at, older.observed_at, older.computed_at)
             = COALESCE(newer.last_attempt_at, newer.observed_at, newer.computed_at)
           AND older.created_at = newer.created_at
           AND older.id < newer.id
         )
       )
    `);

    await queryRunner.query(`
      ALTER TABLE funds_snapshots
      MODIFY COLUMN snapshot_date date NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE funds_snapshots
      MODIFY COLUMN last_attempt_at timestamp NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE funds_snapshots
      MODIFY COLUMN fetch_status varchar(20) NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE funds_snapshots
      MODIFY COLUMN source varchar(100) NOT NULL
    `);

    if (
      !(await this.hasIndex(
        queryRunner,
        'funds_snapshots',
        'uidx_funds_snapshots_user_account_day'
      ))
    ) {
      await queryRunner.query(`
        ALTER TABLE funds_snapshots
        ADD UNIQUE KEY uidx_funds_snapshots_user_account_day (user_id, broker_key, account_id, snapshot_date)
      `);
    }

    if (
      !(await this.hasIndex(
        queryRunner,
        'funds_snapshots',
        'idx_funds_snapshots_user_status_attempt'
      ))
    ) {
      await queryRunner.query(`
        ALTER TABLE funds_snapshots
        ADD KEY idx_funds_snapshots_user_status_attempt (user_id, fetch_status, last_attempt_at)
      `);
    }

    if (
      !(await this.hasIndex(
        queryRunner,
        'funds_snapshots',
        'idx_funds_snapshots_user_broker_account_attempt'
      ))
    ) {
      await queryRunner.query(`
        ALTER TABLE funds_snapshots
        ADD KEY idx_funds_snapshots_user_broker_account_attempt (user_id, broker_key, account_id, last_attempt_at)
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('funds_snapshots'))) {
      return;
    }

    if (
      await this.hasIndex(queryRunner, 'funds_snapshots', 'idx_funds_snapshots_user_broker_account_attempt')
    ) {
      await queryRunner.query(`
        DROP INDEX idx_funds_snapshots_user_broker_account_attempt ON funds_snapshots
      `);
    }

    if (await this.hasIndex(queryRunner, 'funds_snapshots', 'idx_funds_snapshots_user_status_attempt')) {
      await queryRunner.query(`
        DROP INDEX idx_funds_snapshots_user_status_attempt ON funds_snapshots
      `);
    }

    if (await this.hasIndex(queryRunner, 'funds_snapshots', 'uidx_funds_snapshots_user_account_day')) {
      await queryRunner.query(`
        DROP INDEX uidx_funds_snapshots_user_account_day ON funds_snapshots
      `);
    }

    if (await queryRunner.hasColumn('funds_snapshots', 'source')) {
      await queryRunner.query(`
        ALTER TABLE funds_snapshots
        DROP COLUMN source
      `);
    }

    if (await queryRunner.hasColumn('funds_snapshots', 'error_message')) {
      await queryRunner.query(`
        ALTER TABLE funds_snapshots
        DROP COLUMN error_message
      `);
    }

    if (await queryRunner.hasColumn('funds_snapshots', 'fetch_status')) {
      await queryRunner.query(`
        ALTER TABLE funds_snapshots
        DROP COLUMN fetch_status
      `);
    }

    if (await queryRunner.hasColumn('funds_snapshots', 'last_attempt_at')) {
      await queryRunner.query(`
        ALTER TABLE funds_snapshots
        DROP COLUMN last_attempt_at
      `);
    }

    if (await queryRunner.hasColumn('funds_snapshots', 'observed_at')) {
      await queryRunner.query(`
        ALTER TABLE funds_snapshots
        DROP COLUMN observed_at
      `);
    }

    if (await queryRunner.hasColumn('funds_snapshots', 'snapshot_date')) {
      await queryRunner.query(`
        ALTER TABLE funds_snapshots
        DROP COLUMN snapshot_date
      `);
    }
  }

  private async hasIndex(
    queryRunner: QueryRunner,
    tableName: string,
    indexName: string
  ): Promise<boolean> {
    const rows = (await queryRunner.query(`SHOW INDEX FROM ${tableName} WHERE Key_name = ?`, [
      indexName,
    ])) as Array<{ Key_name?: string }>;

    return rows.length > 0;
  }
}
