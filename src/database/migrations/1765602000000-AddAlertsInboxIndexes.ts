import { Service } from 'typedi';
import { MigrationInterface, QueryRunner, TableIndex } from 'typeorm';

@Service()
export class AddAlertsInboxIndexes1765602000000 implements MigrationInterface {
  name = 'AddAlertsInboxIndexes1765602000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('alerts'))) {
      return;
    }

    const indexes = [
      new TableIndex({
        name: 'idx_alerts_user_created_at',
        columnNames: ['user_id', 'createdAt'],
      }),
      new TableIndex({
        name: 'idx_alerts_user_status_created_at',
        columnNames: ['user_id', 'status', 'createdAt'],
      }),
      new TableIndex({
        name: 'idx_alerts_user_severity_created_at',
        columnNames: ['user_id', 'severity', 'createdAt'],
      }),
    ];

    for (const index of indexes) {
      await this.createIndexIfMissing(queryRunner, 'alerts', index);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('alerts'))) {
      return;
    }

    for (const indexName of [
      'idx_alerts_user_severity_created_at',
      'idx_alerts_user_status_created_at',
      'idx_alerts_user_created_at',
    ]) {
      await this.dropIndexIfPresent(queryRunner, 'alerts', indexName);
    }
  }

  private async createIndexIfMissing(
    queryRunner: QueryRunner,
    tableName: string,
    index: TableIndex
  ): Promise<void> {
    const table = await queryRunner.getTable(tableName);
    const exists = table?.indices.some((item) => item.name === index.name);
    if (!exists) {
      await queryRunner.createIndex(tableName, index);
    }
  }

  private async dropIndexIfPresent(
    queryRunner: QueryRunner,
    tableName: string,
    indexName: string
  ): Promise<void> {
    const table = await queryRunner.getTable(tableName);
    const index = table?.indices.find((item) => item.name === indexName);
    if (index) {
      await queryRunner.dropIndex(tableName, index);
    }
  }
}
