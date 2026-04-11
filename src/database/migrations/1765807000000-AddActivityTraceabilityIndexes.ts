import { Service } from 'typedi';
import { MigrationInterface, QueryRunner, TableColumn, TableIndex } from 'typeorm';

@Service()
export class AddActivityTraceabilityIndexes1765807000000 implements MigrationInterface {
  name = 'AddActivityTraceabilityIndexes1765807000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('activity_logs'))) {
      return;
    }

    const table = await queryRunner.getTable('activity_logs');
    if (!table) {
      return;
    }

    if (!table.findColumnByName('correlation_id')) {
      await queryRunner.addColumn(
        'activity_logs',
        new TableColumn({
          name: 'correlation_id',
          type: 'varchar',
          length: '191',
          isNullable: true,
        })
      );
    }

    const refreshedTable = await queryRunner.getTable('activity_logs');
    if (!refreshedTable) {
      return;
    }

    const requiredIndexes = [
      new TableIndex({
        name: 'idx_activity_logs_user_read_created_at',
        columnNames: ['user_id', 'read_at', 'createdAt'],
      }),
      new TableIndex({
        name: 'idx_activity_logs_user_correlation_created_at',
        columnNames: ['user_id', 'correlation_id', 'createdAt'],
      }),
    ];

    for (const index of requiredIndexes) {
      if (!refreshedTable.indices.some((entry) => entry.name === index.name)) {
        await queryRunner.createIndex('activity_logs', index);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('activity_logs'))) {
      return;
    }

    const table = await queryRunner.getTable('activity_logs');
    if (!table) {
      return;
    }

    for (const indexName of [
      'idx_activity_logs_user_correlation_created_at',
      'idx_activity_logs_user_read_created_at',
    ]) {
      if (table.indices.some((entry) => entry.name === indexName)) {
        await queryRunner.dropIndex('activity_logs', indexName);
      }
    }

    const refreshedTable = await queryRunner.getTable('activity_logs');
    if (refreshedTable?.findColumnByName('correlation_id')) {
      await queryRunner.dropColumn('activity_logs', 'correlation_id');
    }
  }
}
