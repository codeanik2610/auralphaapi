import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class AddUserIdOwnershipWave21741482900000 implements MigrationInterface {
  name = 'AddUserIdOwnershipWave21741482900000';

  private async addUserIdColumn(queryRunner: QueryRunner, table: string): Promise<void> {
    if (!(await queryRunner.hasTable(table))) {
      return;
    }
    if (!(await queryRunner.hasColumn(table, 'user_id'))) {
      await queryRunner.query(`ALTER TABLE ${table} ADD COLUMN user_id varchar(191) NULL`);
    }
  }

  private async runIfTable(
    queryRunner: QueryRunner,
    table: string,
    query: string,
    params: unknown[] = []
  ): Promise<void> {
    if (!(await queryRunner.hasTable(table))) {
      return;
    }
    await queryRunner.query(query, params);
  }

  private async hasIndex(queryRunner: QueryRunner, table: string, indexName: string): Promise<boolean> {
    const rows = await queryRunner.query(`SHOW INDEX FROM ${table} WHERE Key_name = ?`, [indexName]);
    return rows.length > 0;
  }

  private async hasForeignKey(queryRunner: QueryRunner, table: string, fkName: string): Promise<boolean> {
    const rows = await queryRunner.query(
      `SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_TYPE = 'FOREIGN KEY' AND CONSTRAINT_NAME = ?`,
      [table, fkName]
    );
    return rows.length > 0;
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    const tables = ['alerts','alert_actions','watchlists','watchlist_items','backtests','backtest_results','activity_logs','portfolio_snapshots','portfolio_holdings','risk_snapshots','risk_controls','risk_alerts'];
    for (const table of tables) {
      await this.addUserIdColumn(queryRunner, table);
    }

    await this.runIfTable(
      queryRunner,
      'alerts',
      "UPDATE alerts a JOIN users u ON u.email = 'admin@auralpha.com' SET a.user_id = u.id WHERE a.user_id IS NULL"
    );
    await this.runIfTable(
      queryRunner,
      'alert_actions',
      "UPDATE alert_actions aa JOIN alerts a ON aa.alertId = a.id SET aa.user_id = a.user_id WHERE aa.user_id IS NULL"
    );
    await this.runIfTable(
      queryRunner,
      'watchlists',
      "UPDATE watchlists w JOIN users u ON u.email = 'admin@auralpha.com' SET w.user_id = u.id WHERE w.user_id IS NULL"
    );
    await this.runIfTable(
      queryRunner,
      'watchlist_items',
      "UPDATE watchlist_items wi JOIN watchlists w ON wi.watchlistId = w.id SET wi.user_id = w.user_id WHERE wi.user_id IS NULL"
    );
    await this.runIfTable(
      queryRunner,
      'backtests',
      "UPDATE backtests b JOIN users u ON u.email = 'admin@auralpha.com' SET b.user_id = u.id WHERE b.user_id IS NULL"
    );
    await this.runIfTable(
      queryRunner,
      'backtest_results',
      "UPDATE backtest_results br JOIN backtests b ON br.backtestId = b.id SET br.user_id = b.user_id WHERE br.user_id IS NULL"
    );
    await this.runIfTable(
      queryRunner,
      'activity_logs',
      "UPDATE activity_logs al JOIN users u ON u.email = 'admin@auralpha.com' SET al.user_id = u.id WHERE al.user_id IS NULL"
    );
    await this.runIfTable(
      queryRunner,
      'portfolio_snapshots',
      "UPDATE portfolio_snapshots ps JOIN users u ON u.email = 'admin@auralpha.com' SET ps.user_id = u.id WHERE ps.user_id IS NULL"
    );
    await this.runIfTable(
      queryRunner,
      'portfolio_holdings',
      "UPDATE portfolio_holdings ph JOIN users u ON u.email = 'admin@auralpha.com' SET ph.user_id = u.id WHERE ph.user_id IS NULL"
    );
    await this.runIfTable(
      queryRunner,
      'risk_snapshots',
      "UPDATE risk_snapshots rs JOIN users u ON u.email = 'admin@auralpha.com' SET rs.user_id = u.id WHERE rs.user_id IS NULL"
    );
    await this.runIfTable(
      queryRunner,
      'risk_controls',
      "UPDATE risk_controls rc JOIN users u ON u.email = 'admin@auralpha.com' SET rc.user_id = u.id WHERE rc.user_id IS NULL"
    );
    await this.runIfTable(
      queryRunner,
      'risk_alerts',
      "UPDATE risk_alerts ra JOIN users u ON u.email = 'admin@auralpha.com' SET ra.user_id = u.id WHERE ra.user_id IS NULL"
    );

    for (const table of tables) {
      if (!(await queryRunner.hasTable(table))) {
        continue;
      }
      await queryRunner.query(`ALTER TABLE ${table} MODIFY COLUMN user_id varchar(191) NOT NULL`);
      const indexName = `IDX_${table}_USER_ID`;
      const fkName = `FK_${table}_USER_ID`;
      if (!(await this.hasIndex(queryRunner, table, indexName))) {
        await queryRunner.query(`ALTER TABLE ${table} ADD INDEX ${indexName} (user_id)`);
      }
      if (!(await this.hasForeignKey(queryRunner, table, fkName))) {
        await queryRunner.query(`ALTER TABLE ${table} ADD CONSTRAINT ${fkName} FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const tables = ['alerts','alert_actions','watchlists','watchlist_items','backtests','backtest_results','activity_logs','portfolio_snapshots','portfolio_holdings','risk_snapshots','risk_controls','risk_alerts'];
    for (const table of tables) {
      if (!(await queryRunner.hasTable(table))) {
        continue;
      }
      const indexName = `IDX_${table}_USER_ID`;
      const fkName = `FK_${table}_USER_ID`;
      if (await this.hasForeignKey(queryRunner, table, fkName)) {
        await queryRunner.query(`ALTER TABLE ${table} DROP FOREIGN KEY ${fkName}`);
      }
      if (await this.hasIndex(queryRunner, table, indexName)) {
        await queryRunner.query(`ALTER TABLE ${table} DROP INDEX ${indexName}`);
      }
      if (await queryRunner.hasColumn(table, 'user_id')) {
        await queryRunner.query(`ALTER TABLE ${table} DROP COLUMN user_id`);
      }
    }
  }
}
