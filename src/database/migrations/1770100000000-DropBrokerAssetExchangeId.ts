import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class DropBrokerAssetExchangeId1770100000000 implements MigrationInterface {
  name = 'DropBrokerAssetExchangeId1770100000000';

  private readonly tableName = 'broker_assets';

  private readonly columnName = 'exchange_id';

  private readonly indexName = 'idx_broker_assets_user_exchange_id';

  private readonly foreignKeyName = 'FK_broker_assets_exchange_id';

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

    const foreignKeys = await this.listForeignKeysForColumn(
      queryRunner,
      this.tableName,
      this.columnName
    );
    for (const foreignKeyName of foreignKeys) {
      await queryRunner.query(`ALTER TABLE ${this.tableName} DROP FOREIGN KEY ${foreignKeyName}`);
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
      (await this.listForeignKeysForColumn(queryRunner, this.tableName, this.columnName)).length === 0
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

  private async listForeignKeysForColumn(
    queryRunner: QueryRunner,
    tableName: string,
    columnName: string
  ): Promise<string[]> {
    const rows = await queryRunner.query(
      `SELECT DISTINCT CONSTRAINT_NAME
       FROM information_schema.KEY_COLUMN_USAGE
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = ?
         AND COLUMN_NAME = ?
         AND REFERENCED_TABLE_NAME IS NOT NULL`,
      [tableName, columnName]
    );

    if (!Array.isArray(rows)) {
      return [];
    }

    return rows
      .map((row) => String((row as { CONSTRAINT_NAME?: string }).CONSTRAINT_NAME || '').trim())
      .filter(Boolean);
  }
}
