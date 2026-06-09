import { MigrationInterface, QueryRunner } from 'typeorm';
import { Service } from 'typedi';

async function dropTableIfExists(queryRunner: QueryRunner, tableName: string): Promise<void> {
  if (await queryRunner.hasTable(tableName)) {
    await queryRunner.dropTable(tableName);
  }
}

@Service()
export class AddBrokerReconciliationStorage1800002100000 implements MigrationInterface {
  name = 'AddBrokerReconciliationStorage1800002100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS broker_fills (
        id char(36) NOT NULL,
        user_id char(36) NOT NULL,
        broker_key varchar(100) NOT NULL,
        account_id char(36) NOT NULL,
        external_id varchar(191) NOT NULL,
        order_id varchar(191) NULL,
        position_id varchar(191) NULL,
        suggested_trade_id char(36) NULL,
        symbol varchar(100) NULL,
        side varchar(32) NULL,
        liquidity_role varchar(32) NULL,
        order_type varchar(64) NULL,
        trade_currency varchar(32) NULL,
        quantity decimal(30,12) NULL,
        price decimal(30,12) NULL,
        notional decimal(30,12) NULL,
        commission_amount decimal(30,12) NULL,
        commission_currency varchar(32) NULL,
        fee_source varchar(64) NULL,
        filled_at timestamp NULL,
        raw_payload_json json NULL,
        match_state varchar(32) NOT NULL DEFAULT 'unmatched',
        match_confidence varchar(32) NOT NULL DEFAULT 'unknown',
        source varchar(64) NOT NULL DEFAULT 'broker_reconciliation',
        created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_broker_fills_user_broker_account_external (user_id, broker_key, account_id, external_id),
        KEY idx_broker_fills_user_broker_account_filled_at (user_id, broker_key, account_id, filled_at),
        KEY idx_broker_fills_order_id (user_id, broker_key, account_id, order_id),
        KEY idx_broker_fills_suggested_trade (user_id, suggested_trade_id)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS broker_fee_entries (
        id char(36) NOT NULL,
        user_id char(36) NOT NULL,
        broker_key varchar(100) NOT NULL,
        account_id char(36) NOT NULL,
        external_id varchar(191) NOT NULL,
        symbol varchar(100) NULL,
        order_id varchar(191) NULL,
        fill_id varchar(191) NULL,
        position_id varchar(191) NULL,
        suggested_trade_id char(36) NULL,
        fee_type varchar(64) NOT NULL,
        amount decimal(30,12) NOT NULL,
        currency varchar(32) NULL,
        transaction_amount decimal(30,12) NULL,
        fee_rate_pct decimal(18,8) NULL,
        occurred_at timestamp NULL,
        raw_payload_json json NULL,
        match_state varchar(32) NOT NULL DEFAULT 'unmatched',
        match_confidence varchar(32) NOT NULL DEFAULT 'unknown',
        source varchar(64) NOT NULL DEFAULT 'broker_reconciliation',
        created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_broker_fee_entries_user_broker_account_external (user_id, broker_key, account_id, external_id),
        KEY idx_broker_fee_entries_user_broker_account_occurred_at (user_id, broker_key, account_id, occurred_at),
        KEY idx_broker_fee_entries_order_id (user_id, broker_key, account_id, order_id),
        KEY idx_broker_fee_entries_suggested_trade (user_id, suggested_trade_id)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS broker_funding_entries (
        id char(36) NOT NULL,
        user_id char(36) NOT NULL,
        broker_key varchar(100) NOT NULL,
        account_id char(36) NOT NULL,
        external_id varchar(191) NOT NULL,
        symbol varchar(100) NULL,
        position_id varchar(191) NULL,
        suggested_trade_id char(36) NULL,
        side varchar(32) NULL,
        amount decimal(30,12) NOT NULL,
        currency varchar(32) NULL,
        notional decimal(30,12) NULL,
        funding_rate_pct decimal(18,8) NULL,
        occurred_at timestamp NULL,
        raw_payload_json json NULL,
        match_state varchar(32) NOT NULL DEFAULT 'unmatched',
        match_confidence varchar(32) NOT NULL DEFAULT 'unknown',
        source varchar(64) NOT NULL DEFAULT 'broker_reconciliation',
        created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_broker_funding_entries_user_broker_account_external (user_id, broker_key, account_id, external_id),
        KEY idx_broker_funding_entries_user_broker_account_occurred_at (user_id, broker_key, account_id, occurred_at),
        KEY idx_broker_funding_entries_position_id (user_id, broker_key, account_id, position_id),
        KEY idx_broker_funding_entries_suggested_trade (user_id, suggested_trade_id)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS broker_wallet_transactions (
        id char(36) NOT NULL,
        user_id char(36) NOT NULL,
        broker_key varchar(100) NOT NULL,
        account_id char(36) NOT NULL,
        external_id varchar(191) NOT NULL,
        transaction_type varchar(64) NOT NULL,
        symbol varchar(100) NULL,
        reference_id varchar(191) NULL,
        order_id varchar(191) NULL,
        position_id varchar(191) NULL,
        amount decimal(30,12) NOT NULL,
        currency varchar(32) NULL,
        balance_before decimal(30,12) NULL,
        balance_after decimal(30,12) NULL,
        occurred_at timestamp NULL,
        raw_payload_json json NULL,
        match_state varchar(32) NOT NULL DEFAULT 'unmatched',
        match_confidence varchar(32) NOT NULL DEFAULT 'unknown',
        source varchar(64) NOT NULL DEFAULT 'broker_reconciliation',
        created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_broker_wallet_transactions_user_broker_account_external (user_id, broker_key, account_id, external_id),
        KEY idx_broker_wallet_transactions_user_broker_account_occurred_at (user_id, broker_key, account_id, occurred_at),
        KEY idx_broker_wallet_transactions_reference (user_id, broker_key, account_id, reference_id)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS broker_balance_snapshots (
        id char(36) NOT NULL,
        user_id char(36) NOT NULL,
        broker_key varchar(100) NOT NULL,
        account_id char(36) NOT NULL,
        external_id varchar(191) NOT NULL,
        wallet_balance decimal(30,12) NULL,
        futures_balance decimal(30,12) NULL,
        total_balance decimal(30,12) NULL,
        available_balance decimal(30,12) NULL,
        locked_amount decimal(30,12) NULL,
        currency varchar(32) NULL,
        source_snapshot_id char(36) NULL,
        observed_at timestamp NULL,
        raw_payload_json json NULL,
        source varchar(64) NOT NULL DEFAULT 'broker_reconciliation',
        created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_broker_balance_snapshots_user_broker_account_external (user_id, broker_key, account_id, external_id),
        KEY idx_broker_balance_snapshots_user_broker_account_observed_at (user_id, broker_key, account_id, observed_at)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS broker_reconciliation_runs (
        id char(36) NOT NULL,
        user_id char(36) NOT NULL,
        broker_key varchar(100) NOT NULL,
        account_id char(36) NULL,
        run_type varchar(64) NOT NULL,
        status varchar(32) NOT NULL DEFAULT 'running',
        window_start_at timestamp NULL,
        window_end_at timestamp NULL,
        started_at timestamp NOT NULL,
        finished_at timestamp NULL,
        fills_count int NOT NULL DEFAULT 0,
        fee_entries_count int NOT NULL DEFAULT 0,
        funding_entries_count int NOT NULL DEFAULT 0,
        wallet_transactions_count int NOT NULL DEFAULT 0,
        balance_snapshots_count int NOT NULL DEFAULT 0,
        gross_pnl decimal(30,12) NULL,
        fees_total decimal(30,12) NULL,
        funding_total decimal(30,12) NULL,
        net_pnl decimal(30,12) NULL,
        balance_delta decimal(30,12) NULL,
        unmatched_delta decimal(30,12) NULL,
        summary_json json NULL,
        error_message text NULL,
        created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_broker_reconciliation_runs_user_broker_started_at (user_id, broker_key, started_at),
        KEY idx_broker_reconciliation_runs_status (status, started_at)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await dropTableIfExists(queryRunner, 'broker_reconciliation_runs');
    await dropTableIfExists(queryRunner, 'broker_balance_snapshots');
    await dropTableIfExists(queryRunner, 'broker_wallet_transactions');
    await dropTableIfExists(queryRunner, 'broker_funding_entries');
    await dropTableIfExists(queryRunner, 'broker_fee_entries');
    await dropTableIfExists(queryRunner, 'broker_fills');
  }
}
