import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class AddAutomationOwnershipAndSchedule1764500000000 implements MigrationInterface {
  name = 'AddAutomationOwnershipAndSchedule1764500000000';

  private async hasIndex(queryRunner: QueryRunner, table: string, indexName: string): Promise<boolean> {
    const rows = await queryRunner.query(`SHOW INDEX FROM ${table} WHERE Key_name = ?`, [indexName]);
    return rows.length > 0;
  }

  private async addColumnIfMissing(queryRunner: QueryRunner, table: string, columnSql: string): Promise<void> {
    const [columnName] = columnSql.split(/\s+/);
    if (!(await queryRunner.hasColumn(table, columnName))) {
      await queryRunner.query(`ALTER TABLE ${table} ADD COLUMN ${columnSql}`);
    }
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    const rows = await queryRunner.query("SELECT id FROM users WHERE email = 'admin@auralpha.com' LIMIT 1");
    const adminId =
      rows[0]?.id || (await queryRunner.query('SELECT id FROM users ORDER BY created_at ASC LIMIT 1'))[0]?.id;
    if (!adminId) {
      throw new Error('No user found to backfill automation ownership');
    }

    await this.addColumnIfMissing(queryRunner, 'automations', 'user_id char(36) NULL');
    await this.addColumnIfMissing(queryRunner, 'automations', 'automationType varchar(50) NULL');
    await this.addColumnIfMissing(queryRunner, 'automations', 'timeZone varchar(64) NULL');
    await this.addColumnIfMissing(queryRunner, 'automations', 'schedule json NULL');

    await queryRunner.query('UPDATE automations SET user_id = ? WHERE user_id IS NULL', [adminId]);
    await queryRunner.query(
      "UPDATE automations SET automationType = 'strategy' WHERE automationType IS NULL"
    );
    await queryRunner.query('ALTER TABLE automations MODIFY user_id char(36) NOT NULL');

    if (await this.hasIndex(queryRunner, 'automations', 'idx_automations_status_updated_at')) {
      await queryRunner.query('DROP INDEX idx_automations_status_updated_at ON automations');
    }
    if (await this.hasIndex(queryRunner, 'automations', 'idx_automations_market_updated_at')) {
      await queryRunner.query('DROP INDEX idx_automations_market_updated_at ON automations');
    }

    if (!(await this.hasIndex(queryRunner, 'automations', 'idx_automations_user_status_updated_at'))) {
      await queryRunner.query(
        'CREATE INDEX idx_automations_user_status_updated_at ON automations (user_id, status, updatedAt)'
      );
    }
    if (!(await this.hasIndex(queryRunner, 'automations', 'idx_automations_user_market_updated_at'))) {
      await queryRunner.query(
        'CREATE INDEX idx_automations_user_market_updated_at ON automations (user_id, market, updatedAt)'
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await this.hasIndex(queryRunner, 'automations', 'idx_automations_user_market_updated_at')) {
      await queryRunner.query('DROP INDEX idx_automations_user_market_updated_at ON automations');
    }
    if (await this.hasIndex(queryRunner, 'automations', 'idx_automations_user_status_updated_at')) {
      await queryRunner.query('DROP INDEX idx_automations_user_status_updated_at ON automations');
    }

    if (!(await this.hasIndex(queryRunner, 'automations', 'idx_automations_status_updated_at'))) {
      await queryRunner.query(
        'CREATE INDEX idx_automations_status_updated_at ON automations (status, updatedAt)'
      );
    }
    if (!(await this.hasIndex(queryRunner, 'automations', 'idx_automations_market_updated_at'))) {
      await queryRunner.query(
        'CREATE INDEX idx_automations_market_updated_at ON automations (market, updatedAt)'
      );
    }

    if (await queryRunner.hasColumn('automations', 'schedule')) {
      await queryRunner.query('ALTER TABLE automations DROP COLUMN schedule');
    }
    if (await queryRunner.hasColumn('automations', 'timeZone')) {
      await queryRunner.query('ALTER TABLE automations DROP COLUMN timeZone');
    }
    if (await queryRunner.hasColumn('automations', 'automationType')) {
      await queryRunner.query('ALTER TABLE automations DROP COLUMN automationType');
    }
    if (await queryRunner.hasColumn('automations', 'user_id')) {
      await queryRunner.query('ALTER TABLE automations DROP COLUMN user_id');
    }
  }
}
