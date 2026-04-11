import { Service } from 'typedi';
import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

@Service()
export class CreateActivityLogsTable1741471500000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'activity_logs',
        columns: [
          { name: 'id', type: 'char', length: '36', isPrimary: true },
          { name: 'type', type: 'varchar', length: '50' },
          { name: 'title', type: 'varchar', length: '255' },
          { name: 'status', type: 'varchar', length: '30' },
          { name: 'actor', type: 'varchar', length: '100', isNullable: true },
          { name: 'symbol', type: 'varchar', length: '50', isNullable: true },
          { name: 'route', type: 'varchar', length: '100', isNullable: true },
          { name: 'description', type: 'text', isNullable: true },
          { name: 'referenceId', type: 'varchar', length: '100', isNullable: true },
          { name: 'stream', type: 'varchar', length: '50', isNullable: true },
          { name: 'related', type: 'varchar', length: '100', isNullable: true },
          { name: 'flags', type: 'json', isNullable: true },
          { name: 'createdAt', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
          { name: 'updatedAt', type: 'timestamp', default: 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' },
        ],
      })
    );

    await queryRunner.createIndex(
      'activity_logs',
      new TableIndex({ name: 'idx_activity_logs_stream_created_at', columnNames: ['stream', 'createdAt'] })
    );

    await queryRunner.createIndex(
      'activity_logs',
      new TableIndex({ name: 'idx_activity_logs_status_created_at', columnNames: ['status', 'createdAt'] })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex('activity_logs', 'idx_activity_logs_status_created_at');
    await queryRunner.dropIndex('activity_logs', 'idx_activity_logs_stream_created_at');
    await queryRunner.dropTable('activity_logs');
  }
}
