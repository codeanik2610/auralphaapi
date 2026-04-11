import { Service } from 'typedi';
import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

@Service()
export class AddRiskPolicyAllocationAndLeverageCaps1763400000000 implements MigrationInterface {
  private readonly tableName = 'risk_policies';

  private readonly columns = [
    { name: 'max_total_allocation', type: 'double', isNullable: true },
    { name: 'max_avg_leverage', type: 'double', isNullable: true }
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable(this.tableName))) {
      return;
    }

    for (const column of this.columns) {
      if (!(await queryRunner.hasColumn(this.tableName, column.name))) {
        await queryRunner.addColumn(this.tableName, new TableColumn(column));
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable(this.tableName))) {
      return;
    }

    for (const column of [...this.columns].reverse()) {
      if (await queryRunner.hasColumn(this.tableName, column.name)) {
        await queryRunner.dropColumn(this.tableName, column.name);
      }
    }
  }
}
