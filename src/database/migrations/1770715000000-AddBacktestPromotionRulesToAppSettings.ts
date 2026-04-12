import { Service } from 'typedi';
import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

@Service()
export class AddBacktestPromotionRulesToAppSettings1770715000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('app_settings');
    if (!hasTable) {
      return;
    }

    if (!(await queryRunner.hasColumn('app_settings', 'backtestPromotionRules'))) {
      await queryRunner.addColumn(
        'app_settings',
        new TableColumn({
          name: 'backtestPromotionRules',
          type: 'json',
          isNullable: true,
        })
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('app_settings');
    if (!hasTable) {
      return;
    }

    if (await queryRunner.hasColumn('app_settings', 'backtestPromotionRules')) {
      await queryRunner.dropColumn('app_settings', 'backtestPromotionRules');
    }
  }
}
