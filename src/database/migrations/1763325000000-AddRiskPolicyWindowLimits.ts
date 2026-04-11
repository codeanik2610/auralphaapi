import { Service } from 'typedi';
import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

@Service()
export class AddRiskPolicyWindowLimits1763325000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('risk_policies'))) {
      return;
    }

    if (!(await queryRunner.hasColumn('risk_policies', 'daily_loss_limit_pct'))) {
      await queryRunner.addColumn(
        'risk_policies',
        new TableColumn({
          name: 'daily_loss_limit_pct',
          type: 'double',
          isNullable: false,
          default: '5'
        })
      );
    }

    if (!(await queryRunner.hasColumn('risk_policies', 'weekly_loss_limit_pct'))) {
      await queryRunner.addColumn(
        'risk_policies',
        new TableColumn({
          name: 'weekly_loss_limit_pct',
          type: 'double',
          isNullable: false,
          default: '12'
        })
      );
    }

    if (!(await queryRunner.hasColumn('risk_policies', 'monthly_loss_limit_pct'))) {
      await queryRunner.addColumn(
        'risk_policies',
        new TableColumn({
          name: 'monthly_loss_limit_pct',
          type: 'double',
          isNullable: false,
          default: '20'
        })
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('risk_policies'))) {
      return;
    }

    if (await queryRunner.hasColumn('risk_policies', 'monthly_loss_limit_pct')) {
      await queryRunner.dropColumn('risk_policies', 'monthly_loss_limit_pct');
    }

    if (await queryRunner.hasColumn('risk_policies', 'weekly_loss_limit_pct')) {
      await queryRunner.dropColumn('risk_policies', 'weekly_loss_limit_pct');
    }

    if (await queryRunner.hasColumn('risk_policies', 'daily_loss_limit_pct')) {
      await queryRunner.dropColumn('risk_policies', 'daily_loss_limit_pct');
    }
  }
}
