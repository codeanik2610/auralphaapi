import { Service } from 'typedi';
import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

@Service()
export class CreateActivityExportsTable1765804000000 implements MigrationInterface {
  name = 'CreateActivityExportsTable1765804000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('activity_exports')) {
      return;
    }

    await queryRunner.createTable(
      new Table({
        name: 'activity_exports',
        columns: [
          { name: 'id', type: 'char', length: '36', isPrimary: true },
          { name: 'user_id', type: 'varchar', length: '191' },
          { name: 'scope', type: 'varchar', length: '32' },
          { name: 'format', type: 'varchar', length: '16' },
          { name: 'status', type: 'varchar', length: '16', default: "'Ready'" },
          { name: 'file_name', type: 'varchar', length: '255' },
          { name: 'content_type', type: 'varchar', length: '100' },
          { name: 'exported_count', type: 'int', unsigned: true, default: '0' },
          { name: 'filters_json', type: 'json', isNullable: true },
          { name: 'content', type: 'longtext' },
          { name: 'expires_at', type: 'timestamp', isNullable: true },
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
      'activity_exports',
      new TableIndex({
        name: 'idx_activity_exports_user_created_at',
        columnNames: ['user_id', 'createdAt'],
      })
    );

    await queryRunner.createIndex(
      'activity_exports',
      new TableIndex({
        name: 'idx_activity_exports_user_status_created_at',
        columnNames: ['user_id', 'status', 'createdAt'],
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('activity_exports'))) {
      return;
    }

    await queryRunner.dropIndex('activity_exports', 'idx_activity_exports_user_status_created_at');
    await queryRunner.dropIndex('activity_exports', 'idx_activity_exports_user_created_at');
    await queryRunner.dropTable('activity_exports');
  }
}
