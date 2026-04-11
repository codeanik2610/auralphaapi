import { Service } from 'typedi';
import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableColumn,
  TableIndex,
} from 'typeorm';

@Service()
export class AddActivityProductFeatures1765805000000 implements MigrationInterface {
  name = 'AddActivityProductFeatures1765805000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('activity_logs')) {
      const activityTable = await queryRunner.getTable('activity_logs');
      if (activityTable && !activityTable.findColumnByName('read_at')) {
        await queryRunner.addColumn(
          'activity_logs',
          new TableColumn({
            name: 'read_at',
            type: 'timestamp',
            isNullable: true,
          })
        );
      }

      const refreshedActivityTable = await queryRunner.getTable('activity_logs');
      const hasFullTextIndex = refreshedActivityTable?.indices.some(
        (index) => index.name === 'ft_activity_logs_search'
      );
      if (!hasFullTextIndex) {
        await queryRunner.query(
          'ALTER TABLE activity_logs ADD FULLTEXT INDEX ft_activity_logs_search (`type`, `title`, `status`, `actor`, `symbol`, `route`, `referenceId`, `stream`, `related`, `description`)'
        );
      }
    }

    if (await queryRunner.hasTable('activity_exports')) {
      const exportTable = await queryRunner.getTable('activity_exports');
      if (exportTable && !exportTable.findColumnByName('storage_path')) {
        await queryRunner.addColumn(
          'activity_exports',
          new TableColumn({
            name: 'storage_path',
            type: 'varchar',
            length: '512',
            isNullable: true,
          })
        );
      }
      if (exportTable && !exportTable.findColumnByName('error_message')) {
        await queryRunner.addColumn(
          'activity_exports',
          new TableColumn({
            name: 'error_message',
            type: 'varchar',
            length: '255',
            isNullable: true,
          })
        );
      }

      const refreshedExportTable = await queryRunner.getTable('activity_exports');
      const contentColumn = refreshedExportTable?.findColumnByName('content');
      if (contentColumn && !contentColumn.isNullable) {
        await queryRunner.changeColumn(
          'activity_exports',
          'content',
          new TableColumn({
            name: 'content',
            type: 'longtext',
            isNullable: true,
          })
        );
      }
    }

    if (!(await queryRunner.hasTable('activity_saved_views'))) {
      await queryRunner.createTable(
        new Table({
          name: 'activity_saved_views',
          columns: [
            { name: 'id', type: 'char', length: '36', isPrimary: true },
            { name: 'user_id', type: 'varchar', length: '191' },
            { name: 'name', type: 'varchar', length: '100' },
            { name: 'description', type: 'text', isNullable: true },
            { name: 'is_default', type: 'boolean', default: false },
            { name: 'view', type: 'varchar', length: '16', default: "'feed'" },
            { name: 'group_by', type: 'varchar', length: '16', isNullable: true },
            { name: 'sort_by', type: 'varchar', length: '16', default: "'time'" },
            { name: 'sort_order', type: 'varchar', length: '8', default: "'desc'" },
            { name: 'read_state', type: 'varchar', length: '16', default: "'all'" },
            { name: 'filters_json', type: 'json', isNullable: true },
            { name: 'createdAt', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
            {
              name: 'updatedAt',
              type: 'timestamp',
              default: 'CURRENT_TIMESTAMP',
              onUpdate: 'CURRENT_TIMESTAMP',
            },
          ],
        })
      );

      await queryRunner.createIndex(
        'activity_saved_views',
        new TableIndex({
          name: 'idx_activity_saved_views_user_created_at',
          columnNames: ['user_id', 'createdAt'],
        })
      );

      await queryRunner.createIndex(
        'activity_saved_views',
        new TableIndex({
          name: 'idx_activity_saved_views_user_default_updated_at',
          columnNames: ['user_id', 'is_default', 'updatedAt'],
        })
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('activity_saved_views')) {
      await queryRunner.dropIndex(
        'activity_saved_views',
        'idx_activity_saved_views_user_default_updated_at'
      );
      await queryRunner.dropIndex(
        'activity_saved_views',
        'idx_activity_saved_views_user_created_at'
      );
      await queryRunner.dropTable('activity_saved_views');
    }

    if (await queryRunner.hasTable('activity_exports')) {
      const exportTable = await queryRunner.getTable('activity_exports');
      if (exportTable?.findColumnByName('error_message')) {
        await queryRunner.dropColumn('activity_exports', 'error_message');
      }
      if (exportTable?.findColumnByName('storage_path')) {
        await queryRunner.dropColumn('activity_exports', 'storage_path');
      }
    }

    if (await queryRunner.hasTable('activity_logs')) {
      const activityTable = await queryRunner.getTable('activity_logs');
      if (activityTable?.indices.some((index) => index.name === 'ft_activity_logs_search')) {
        await queryRunner.query('ALTER TABLE activity_logs DROP INDEX ft_activity_logs_search');
      }
      if (activityTable?.findColumnByName('read_at')) {
        await queryRunner.dropColumn('activity_logs', 'read_at');
      }
    }
  }
}
