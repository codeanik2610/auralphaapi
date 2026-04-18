import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class DropConnectionExchangeId1770000000000 implements MigrationInterface {
  name = 'DropConnectionExchangeId1770000000000';

  private readonly tableName = 'connections';

  private readonly columnName = 'exchange_id';

  private readonly indexName = 'idx_connections_user_exchange_id';

  private readonly foreignKeyName = 'FK_connections_exchange_id';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable(this.tableName))) {
      return;
    }

    if (!(await queryRunner.hasColumn(this.tableName, this.columnName))) {
      return;
    }

    await queryRunner.query(
      `UPDATE ${this.tableName} SET ${this.columnName} = NULL WHERE ${this.columnName} IS NOT NULL`
    );

    if (await this.hasForeignKey(queryRunner, this.tableName, this.foreignKeyName)) {
      await queryRunner.query(
        `ALTER TABLE ${this.tableName} DROP FOREIGN KEY ${this.foreignKeyName}`
      );
    }

    if (await this.hasIndex(queryRunner, this.tableName, this.indexName)) {
      await queryRunner.query(`ALTER TABLE ${this.tableName} DROP INDEX ${this.indexName}`);
    }

    await queryRunner.query(`ALTER TABLE ${this.tableName} DROP COLUMN ${this.columnName}`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable(this.tableName))) {
      return;
    }

    if (!(await queryRunner.hasColumn(this.tableName, this.columnName))) {
      await queryRunner.query(
        `ALTER TABLE ${this.tableName} ADD COLUMN ${this.columnName} char(36) NULL`
      );
    }

    if (!(await this.hasIndex(queryRunner, this.tableName, this.indexName))) {
      await queryRunner.query(
        `CREATE INDEX ${this.indexName} ON ${this.tableName} (user_id, ${this.columnName})`
      );
    }

    if (
      (await queryRunner.hasTable('exchanges')) &&
      !(await this.hasForeignKey(queryRunner, this.tableName, this.foreignKeyName))
    ) {
      await queryRunner.query(
        `ALTER TABLE ${this.tableName}
         ADD CONSTRAINT ${this.foreignKeyName}
         FOREIGN KEY (${this.columnName})
         REFERENCES exchanges(id)
         ON DELETE SET NULL`
      );
    }
  }

  private async hasIndex(
    queryRunner: QueryRunner,
    tableName: string,
    indexName: string
  ): Promise<boolean> {
    const rows = await queryRunner.query(`SHOW INDEX FROM ${tableName} WHERE Key_name = ?`, [
      indexName,
    ]);
    return Array.isArray(rows) && rows.length > 0;
  }

  private async hasForeignKey(
    queryRunner: QueryRunner,
    tableName: string,
    foreignKeyName: string
  ): Promise<boolean> {
    const rows = await queryRunner.query(
      `SELECT CONSTRAINT_NAME
       FROM information_schema.TABLE_CONSTRAINTS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = ?
         AND CONSTRAINT_TYPE = 'FOREIGN KEY'
         AND CONSTRAINT_NAME = ?`,
      [tableName, foreignKeyName]
    );
    return Array.isArray(rows) && rows.length > 0;
  }
}
