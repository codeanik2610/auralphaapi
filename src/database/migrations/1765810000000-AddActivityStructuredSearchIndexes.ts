import { Service } from 'typedi';
import { MigrationInterface, QueryRunner, TableIndex } from 'typeorm';

@Service()
export class AddActivityStructuredSearchIndexes1765810000000 implements MigrationInterface {
  name = 'AddActivityStructuredSearchIndexes1765810000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('activity_logs'))) {
      return;
    }

    const activityTable = await queryRunner.getTable('activity_logs');
    if (!activityTable) {
      return;
    }

    if (!activityTable.indices.some((index) => index.name === 'idx_activity_logs_user_type_created_at')) {
      await queryRunner.createIndex(
        'activity_logs',
        new TableIndex({
          name: 'idx_activity_logs_user_type_created_at',
          columnNames: ['user_id', 'type', 'createdAt'],
        })
      );
    }

    if (!activityTable.indices.some((index) => index.name === 'idx_activity_logs_user_symbol_created_at')) {
      await queryRunner.createIndex(
        'activity_logs',
        new TableIndex({
          name: 'idx_activity_logs_user_symbol_created_at',
          columnNames: ['user_id', 'symbol', 'createdAt'],
        })
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('activity_logs'))) {
      return;
    }

    const activityTable = await queryRunner.getTable('activity_logs');
    if (!activityTable) {
      return;
    }

    if (activityTable.indices.some((index) => index.name === 'idx_activity_logs_user_symbol_created_at')) {
      await queryRunner.dropIndex('activity_logs', 'idx_activity_logs_user_symbol_created_at');
    }

    if (activityTable.indices.some((index) => index.name === 'idx_activity_logs_user_type_created_at')) {
      await queryRunner.dropIndex('activity_logs', 'idx_activity_logs_user_type_created_at');
    }
  }
}
