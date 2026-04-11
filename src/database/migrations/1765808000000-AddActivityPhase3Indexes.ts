import { Service } from 'typedi';
import { MigrationInterface, QueryRunner, TableIndex } from 'typeorm';

@Service()
export class AddActivityPhase3Indexes1765808000000 implements MigrationInterface {
  name = 'AddActivityPhase3Indexes1765808000000';

  private readonly activityLogIndexes = [
    new TableIndex({
      name: 'idx_activity_logs_user_route_created_at',
      columnNames: ['user_id', 'route', 'createdAt'],
    }),
    new TableIndex({
      name: 'idx_activity_logs_user_reference_created_at',
      columnNames: ['user_id', 'referenceId', 'createdAt'],
    }),
    new TableIndex({
      name: 'idx_activity_logs_user_related_created_at',
      columnNames: ['user_id', 'related', 'createdAt'],
    }),
  ];

  private readonly activityExportIndexes = [
    new TableIndex({
      name: 'idx_activity_exports_status_created_at',
      columnNames: ['status', 'createdAt'],
    }),
    new TableIndex({
      name: 'idx_activity_exports_expires_at',
      columnNames: ['expires_at'],
    }),
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.createMissingIndexes(queryRunner, 'activity_logs', this.activityLogIndexes);
    await this.createMissingIndexes(queryRunner, 'activity_exports', this.activityExportIndexes);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await this.dropIndexesIfPresent(queryRunner, 'activity_exports', this.activityExportIndexes);
    await this.dropIndexesIfPresent(queryRunner, 'activity_logs', this.activityLogIndexes);
  }

  private async createMissingIndexes(
    queryRunner: QueryRunner,
    tableName: string,
    indexes: TableIndex[]
  ): Promise<void> {
    if (!(await queryRunner.hasTable(tableName))) {
      return;
    }

    const table = await queryRunner.getTable(tableName);
    if (!table) {
      return;
    }

    for (const index of indexes) {
      if (!table.indices.some((entry) => entry.name === index.name)) {
        await queryRunner.createIndex(tableName, index);
      }
    }
  }

  private async dropIndexesIfPresent(
    queryRunner: QueryRunner,
    tableName: string,
    indexes: TableIndex[]
  ): Promise<void> {
    if (!(await queryRunner.hasTable(tableName))) {
      return;
    }

    const table = await queryRunner.getTable(tableName);
    if (!table) {
      return;
    }

    for (const index of [...indexes].reverse()) {
      if (index.name && table.indices.some((entry) => entry.name === index.name)) {
        await queryRunner.dropIndex(tableName, index.name);
      }
    }
  }
}
