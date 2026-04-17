import { Service } from 'typedi';
import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

@Service()
export class AddRiskSnapshotLossWindowColumns1770801000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('risk_snapshots'))) {
      return;
    }

    if (!(await queryRunner.hasColumn('risk_snapshots', 'weeklyDrawdownBudgetUsed'))) {
      await queryRunner.addColumn(
        'risk_snapshots',
        new TableColumn({
          name: 'weeklyDrawdownBudgetUsed',
          type: 'varchar',
          length: '50',
          isNullable: true,
        })
      );
    }

    if (!(await queryRunner.hasColumn('risk_snapshots', 'monthlyDrawdownBudgetUsed'))) {
      await queryRunner.addColumn(
        'risk_snapshots',
        new TableColumn({
          name: 'monthlyDrawdownBudgetUsed',
          type: 'varchar',
          length: '50',
          isNullable: true,
        })
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('risk_snapshots'))) {
      return;
    }

    if (await queryRunner.hasColumn('risk_snapshots', 'monthlyDrawdownBudgetUsed')) {
      await queryRunner.dropColumn('risk_snapshots', 'monthlyDrawdownBudgetUsed');
    }

    if (await queryRunner.hasColumn('risk_snapshots', 'weeklyDrawdownBudgetUsed')) {
      await queryRunner.dropColumn('risk_snapshots', 'weeklyDrawdownBudgetUsed');
    }
  }
}
