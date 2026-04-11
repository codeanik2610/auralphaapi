import { Service } from 'typedi';
import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

@Service()
export class CreateConnectionsTable1741472400000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'connections',
        columns: [
          { name: 'id', type: 'char', length: '36', isPrimary: true },
          { name: 'name', type: 'varchar', length: '255' },
          { name: 'broker', type: 'varchar', length: '255', isNullable: true },
          { name: 'type', type: 'varchar', length: '30' },
          { name: 'status', type: 'varchar', length: '30' },
          { name: 'latency', type: 'varchar', length: '50', isNullable: true },
          { name: 'mode', type: 'varchar', length: '50', isNullable: true },
          { name: 'lastSyncAt', type: 'timestamp', isNullable: true },
          { name: 'markets', type: 'varchar', length: '255', isNullable: true },
          { name: 'capabilities', type: 'varchar', length: '255', isNullable: true },
          { name: 'auth', type: 'varchar', length: '100', isNullable: true },
          { name: 'authMode', type: 'varchar', length: '100', isNullable: true },
          { name: 'sync', type: 'varchar', length: '100', isNullable: true },
          { name: 'limitation', type: 'varchar', length: '255', isNullable: true },
          { name: 'route', type: 'varchar', length: '100', isNullable: true },
          { name: 'scope', type: 'varchar', length: '100', isNullable: true },
          { name: 'createdAt', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
          { name: 'updatedAt', type: 'timestamp', default: 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' },
        ],
      })
    );

    await queryRunner.createIndex(
      'connections',
      new TableIndex({ name: 'idx_connections_type_updated_at', columnNames: ['type', 'updatedAt'] })
    );

    await queryRunner.createIndex(
      'connections',
      new TableIndex({ name: 'idx_connections_status_updated_at', columnNames: ['status', 'updatedAt'] })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex('connections', 'idx_connections_status_updated_at');
    await queryRunner.dropIndex('connections', 'idx_connections_type_updated_at');
    await queryRunner.dropTable('connections');
  }
}
