import { Service } from 'typedi';
import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

@Service()
export class AddTimezoneToAppSettings1763385000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('app_settings');
    if (!hasTable) {
      return;
    }

    if (!(await queryRunner.hasColumn('app_settings', 'timezone'))) {
      await queryRunner.addColumn(
        'app_settings',
        new TableColumn({
          name: 'timezone',
          type: 'varchar',
          length: '64',
          isNullable: false,
          default: "'UTC'",
        })
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('app_settings');
    if (!hasTable) {
      return;
    }

    if (await queryRunner.hasColumn('app_settings', 'timezone')) {
      await queryRunner.dropColumn('app_settings', 'timezone');
    }
  }
}
