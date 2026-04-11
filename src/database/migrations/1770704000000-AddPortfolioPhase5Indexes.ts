import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class AddPortfolioPhase5Indexes1770704000000 implements MigrationInterface {
  name = 'AddPortfolioPhase5Indexes1770704000000';

  private async hasIndex(
    queryRunner: QueryRunner,
    table: string,
    indexName: string
  ): Promise<boolean> {
    const rows = await queryRunner.query(`SHOW INDEX FROM ${table} WHERE Key_name = ?`, [
      indexName,
    ]);
    return Array.isArray(rows) && rows.length > 0;
  }

  private async addIndexIfMissing(
    queryRunner: QueryRunner,
    table: string,
    indexName: string,
    columns: string
  ): Promise<void> {
    if (!(await queryRunner.hasTable(table))) {
      return;
    }
    if (await this.hasIndex(queryRunner, table, indexName)) {
      return;
    }

    await queryRunner.query(`ALTER TABLE ${table} ADD INDEX ${indexName} (${columns})`);
  }

  private async dropIndexIfExists(
    queryRunner: QueryRunner,
    table: string,
    indexName: string
  ): Promise<void> {
    if (!(await queryRunner.hasTable(table))) {
      return;
    }
    if (!(await this.hasIndex(queryRunner, table, indexName))) {
      return;
    }

    await queryRunner.query(`ALTER TABLE ${table} DROP INDEX ${indexName}`);
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('position_read_models')) {
      await queryRunner.query(
        `UPDATE position_read_models
            SET position_closed_at = COALESCE(
              position_closed_at,
              position_updated_at,
              position_created_at,
              last_seen_at
            )
          WHERE status_rank >= 3
            AND position_closed_at IS NULL`
      );
    }

    await this.addIndexIfMissing(
      queryRunner,
      'portfolio_snapshots',
      'idx_portfolio_snapshots_user_created_at',
      'user_id, createdAt'
    );
    await this.addIndexIfMissing(
      queryRunner,
      'portfolio_holdings',
      'idx_portfolio_holdings_snapshot_user_value',
      'snapshotId, user_id, marketValue'
    );
    await this.addIndexIfMissing(
      queryRunner,
      'position_read_models',
      'idx_position_read_models_user_account_status_closed_at',
      'user_id, account_id, status_rank, position_closed_at'
    );
    await this.addIndexIfMissing(
      queryRunner,
      'position_read_models',
      'idx_position_read_models_user_broker_account_status_closed_at',
      'user_id, broker_key, account_id, status_rank, position_closed_at'
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await this.dropIndexIfExists(
      queryRunner,
      'position_read_models',
      'idx_position_read_models_user_broker_account_status_closed_at'
    );
    await this.dropIndexIfExists(
      queryRunner,
      'position_read_models',
      'idx_position_read_models_user_account_status_closed_at'
    );
    await this.dropIndexIfExists(
      queryRunner,
      'portfolio_holdings',
      'idx_portfolio_holdings_snapshot_user_value'
    );
    await this.dropIndexIfExists(
      queryRunner,
      'portfolio_snapshots',
      'idx_portfolio_snapshots_user_created_at'
    );
  }
}
