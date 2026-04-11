import { Service } from 'typedi';
import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

@Service()
export class CreateSettingsAuditLogsTable1741475100000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('settings_audit_logs');

    if (hasTable) {
      return;
    }

    await queryRunner.createTable(
      new Table({
        name: 'settings_audit_logs',
        columns: [
          { name: 'id', type: 'char', length: '36', isPrimary: true },
          { name: 'fieldName', type: 'varchar', length: '50' },
          { name: 'oldValue', type: 'varchar', length: '20', isNullable: true },
          { name: 'newValue', type: 'varchar', length: '20', isNullable: true },
          { name: 'actor', type: 'varchar', length: '100', isNullable: true },
          { name: 'createdAt', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
        ],
      })
    );

    await queryRunner.createIndex(
      'settings_audit_logs',
      new TableIndex({
        name: 'idx_settings_audit_logs_created_at',
        columnNames: ['createdAt'],
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('settings_audit_logs');

    if (!hasTable) {
      return;
    }

    await queryRunner.dropIndex('settings_audit_logs', 'idx_settings_audit_logs_created_at');
    await queryRunner.dropTable('settings_audit_logs');
  }
}
