import { Service } from 'typedi';
import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

@Service()
export class AddNotificationPolicyToAppSettings1763300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('app_settings');
    if (!hasTable) {
      return;
    }

    if (!(await queryRunner.hasColumn('app_settings', 'notificationChannel'))) {
      await queryRunner.addColumn(
        'app_settings',
        new TableColumn({
          name: 'notificationChannel',
          type: 'varchar',
          length: '16',
          default: "'both'",
        })
      );
    }

    if (!(await queryRunner.hasColumn('app_settings', 'notificationSeverity'))) {
      await queryRunner.addColumn(
        'app_settings',
        new TableColumn({
          name: 'notificationSeverity',
          type: 'varchar',
          length: '16',
          default: "'all'",
        })
      );
    }

    if (!(await queryRunner.hasColumn('app_settings', 'escalationRoute'))) {
      await queryRunner.addColumn(
        'app_settings',
        new TableColumn({
          name: 'escalationRoute',
          type: 'varchar',
          length: '24',
          default: "'risk-review'",
        })
      );
    }

    if (!(await queryRunner.hasColumn('app_settings', 'escalationSlaMinutes'))) {
      await queryRunner.addColumn(
        'app_settings',
        new TableColumn({
          name: 'escalationSlaMinutes',
          type: 'int',
          default: 15,
        })
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('app_settings');
    if (!hasTable) {
      return;
    }

    if (await queryRunner.hasColumn('app_settings', 'escalationSlaMinutes')) {
      await queryRunner.dropColumn('app_settings', 'escalationSlaMinutes');
    }
    if (await queryRunner.hasColumn('app_settings', 'escalationRoute')) {
      await queryRunner.dropColumn('app_settings', 'escalationRoute');
    }
    if (await queryRunner.hasColumn('app_settings', 'notificationSeverity')) {
      await queryRunner.dropColumn('app_settings', 'notificationSeverity');
    }
    if (await queryRunner.hasColumn('app_settings', 'notificationChannel')) {
      await queryRunner.dropColumn('app_settings', 'notificationChannel');
    }
  }
}

