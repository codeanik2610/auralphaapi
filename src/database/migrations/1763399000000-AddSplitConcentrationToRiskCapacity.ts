import { Service } from 'typedi';
import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

@Service()
export class AddSplitConcentrationToRiskCapacity1763399000000 implements MigrationInterface {
  private readonly tableName = 'risk_capacity_snapshots';

  private readonly pctColumns = [
    'position_concentration_daily_pct',
    'position_concentration_weekly_pct',
    'position_concentration_monthly_pct',
    'order_concentration_daily_pct',
    'order_concentration_weekly_pct',
    'order_concentration_monthly_pct',
  ];

  private readonly statusColumns = [
    'position_concentration_daily_status',
    'position_concentration_weekly_status',
    'position_concentration_monthly_status',
    'order_concentration_daily_status',
    'order_concentration_weekly_status',
    'order_concentration_monthly_status',
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable(this.tableName))) {
      return;
    }

    for (const col of this.pctColumns) {
      if (!(await queryRunner.hasColumn(this.tableName, col))) {
        await queryRunner.addColumn(
          this.tableName,
          new TableColumn({
            name: col,
            type: 'double',
            isNullable: false,
            default: '0',
          })
        );
      }
    }

    for (const col of this.statusColumns) {
      if (!(await queryRunner.hasColumn(this.tableName, col))) {
        await queryRunner.addColumn(
          this.tableName,
          new TableColumn({
            name: col,
            type: 'varchar',
            length: '32',
            isNullable: false,
            default: "'normal'",
          })
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable(this.tableName))) {
      return;
    }

    const allColumns = [...this.statusColumns, ...this.pctColumns].reverse();
    for (const col of allColumns) {
      if (await queryRunner.hasColumn(this.tableName, col)) {
        await queryRunner.dropColumn(this.tableName, col);
      }
    }
  }
}
