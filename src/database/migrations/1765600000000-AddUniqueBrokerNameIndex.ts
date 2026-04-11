import { Service } from 'typedi';
import { MigrationInterface, QueryRunner, TableIndex } from 'typeorm';

@Service()
export class AddUniqueBrokerNameIndex1765600000000 implements MigrationInterface {
  name = 'AddUniqueBrokerNameIndex1765600000000';

  private async hasIndex(
    queryRunner: QueryRunner,
    table: string,
    indexName: string
  ): Promise<boolean> {
    const rows = await queryRunner.query(`SHOW INDEX FROM ${table} WHERE Key_name = ?`, [
      indexName,
    ]);
    return rows.length > 0;
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    const duplicateRows = await queryRunner.query(
      `
        SELECT LOWER(TRIM(name)) AS normalized_name, COUNT(*) AS duplicate_count
        FROM brokers
        GROUP BY LOWER(TRIM(name))
        HAVING normalized_name <> '' AND COUNT(*) > 1
        LIMIT 5
      `
    );

    if (duplicateRows.length) {
      const names = duplicateRows
        .map((row: { normalized_name?: string }) => row.normalized_name || '<blank>')
        .join(', ');
      throw new Error(
        `Cannot add unique broker name index because duplicate broker names already exist: ${names}`
      );
    }

    if (!(await this.hasIndex(queryRunner, 'brokers', 'uidx_brokers_name'))) {
      await queryRunner.createIndex(
        'brokers',
        new TableIndex({
          name: 'uidx_brokers_name',
          columnNames: ['name'],
          isUnique: true,
        })
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await this.hasIndex(queryRunner, 'brokers', 'uidx_brokers_name')) {
      await queryRunner.query('ALTER TABLE brokers DROP INDEX uidx_brokers_name');
    }
  }
}
