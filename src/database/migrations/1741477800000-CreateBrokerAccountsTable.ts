import { Service } from 'typedi';
import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

@Service()
export class CreateBrokerAccountsTable1741477800000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'broker_accounts',
        columns: [
          { name: 'id', type: 'char', length: '36', isPrimary: true },
          { name: 'connectionId', type: 'char', length: '36' },
          { name: 'brokerKey', type: 'varchar', length: '100' },
          { name: 'accountKey', type: 'varchar', length: '100' },
          { name: 'accountName', type: 'varchar', length: '255' },
          { name: 'status', type: 'varchar', length: '30' },
          { name: 'mode', type: 'varchar', length: '50', isNullable: true },
          { name: 'lastSyncAt', type: 'timestamp', isNullable: true },
          { name: 'purpose', type: 'varchar', length: '255', isNullable: true },
          { name: 'capabilities', type: 'varchar', length: '255', isNullable: true },
          { name: 'isDefault', type: 'boolean', default: false },
          { name: 'createdAt', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
          { name: 'updatedAt', type: 'timestamp', default: 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' },
        ],
      })
    );

    await queryRunner.createIndex(
      'broker_accounts',
      new TableIndex({
        name: 'idx_broker_accounts_connection_updated_at',
        columnNames: ['connectionId', 'updatedAt'],
      })
    );

    await queryRunner.createIndex(
      'broker_accounts',
      new TableIndex({
        name: 'idx_broker_accounts_status_updated_at',
        columnNames: ['status', 'updatedAt'],
      })
    );

    await queryRunner.createIndex(
      'broker_accounts',
      new TableIndex({
        name: 'uidx_broker_accounts_account_key',
        columnNames: ['accountKey'],
        isUnique: true,
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex('broker_accounts', 'uidx_broker_accounts_account_key');
    await queryRunner.dropIndex('broker_accounts', 'idx_broker_accounts_status_updated_at');
    await queryRunner.dropIndex('broker_accounts', 'idx_broker_accounts_connection_updated_at');
    await queryRunner.dropTable('broker_accounts');
  }
}
