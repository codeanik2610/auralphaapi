import { Service } from 'typedi';
import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

@Service()
export class AddStructuredSettingsAuditFields1765400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('settings_audit_logs');
    if (!hasTable) {
      return;
    }

    const columns = [
      new TableColumn({
        name: 'oldValueType',
        type: 'varchar',
        length: '16',
        isNullable: true,
      }),
      new TableColumn({
        name: 'oldValueJson',
        type: 'json',
        isNullable: true,
      }),
      new TableColumn({
        name: 'newValueType',
        type: 'varchar',
        length: '16',
        isNullable: true,
      }),
      new TableColumn({
        name: 'newValueJson',
        type: 'json',
        isNullable: true,
      }),
      new TableColumn({
        name: 'changeType',
        type: 'varchar',
        length: '16',
        isNullable: true,
      }),
    ];

    for (const column of columns) {
      if (!(await queryRunner.hasColumn('settings_audit_logs', column.name))) {
        await queryRunner.addColumn('settings_audit_logs', column);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('settings_audit_logs');
    if (!hasTable) {
      return;
    }

    for (const columnName of [
      'changeType',
      'newValueJson',
      'newValueType',
      'oldValueJson',
      'oldValueType',
    ]) {
      if (await queryRunner.hasColumn('settings_audit_logs', columnName)) {
        await queryRunner.dropColumn('settings_audit_logs', columnName);
      }
    }
  }
}
