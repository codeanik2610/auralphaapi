import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class ExpandSettingsAuditValueColumns1765200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('settings_audit_logs');
    if (!hasTable) {
      return;
    }

    if (await queryRunner.hasColumn('settings_audit_logs', 'oldValue')) {
      await queryRunner.query(
        'ALTER TABLE settings_audit_logs MODIFY oldValue text NULL'
      );
    }

    if (await queryRunner.hasColumn('settings_audit_logs', 'newValue')) {
      await queryRunner.query(
        'ALTER TABLE settings_audit_logs MODIFY newValue text NULL'
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('settings_audit_logs');
    if (!hasTable) {
      return;
    }

    if (await queryRunner.hasColumn('settings_audit_logs', 'oldValue')) {
      await queryRunner.query(
        'ALTER TABLE settings_audit_logs MODIFY oldValue varchar(20) NULL'
      );
    }

    if (await queryRunner.hasColumn('settings_audit_logs', 'newValue')) {
      await queryRunner.query(
        'ALTER TABLE settings_audit_logs MODIFY newValue varchar(20) NULL'
      );
    }
  }
}
