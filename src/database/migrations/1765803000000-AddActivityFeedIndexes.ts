import { Service } from 'typedi';
import { MigrationInterface, QueryRunner, TableIndex } from 'typeorm';

@Service()
export class AddActivityFeedIndexes1765803000000 implements MigrationInterface {
  name = 'AddActivityFeedIndexes1765803000000';

  private readonly indexes = [
    new TableIndex({
      name: 'idx_activity_logs_user_created_at',
      columnNames: ['user_id', 'createdAt'],
    }),
    new TableIndex({
      name: 'idx_activity_logs_user_stream_created_at',
      columnNames: ['user_id', 'stream', 'createdAt'],
    }),
    new TableIndex({
      name: 'idx_activity_logs_user_status_created_at',
      columnNames: ['user_id', 'status', 'createdAt'],
    }),
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('activity_logs'))) {
      return;
    }

    const table = await queryRunner.getTable('activity_logs');
    if (!table) {
      return;
    }

    for (const index of this.indexes) {
      const exists = table.indices.some((current) => current.name === index.name);
      if (!exists) {
        await queryRunner.createIndex('activity_logs', index);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('activity_logs'))) {
      return;
    }

    for (const index of [...this.indexes].reverse()) {
      if (index.name) {
        await queryRunner.dropIndex('activity_logs', index.name);
      }
    }
  }
}
