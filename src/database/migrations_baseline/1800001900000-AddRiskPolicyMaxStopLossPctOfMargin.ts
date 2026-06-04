import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';
import { Service } from 'typedi';

async function addColumnIfMissing(
  queryRunner: QueryRunner,
  tableName: string,
  column: TableColumn
): Promise<void> {
  if (!(await queryRunner.hasTable(tableName))) {
    return;
  }
  const table = await queryRunner.getTable(tableName);
  const hasColumn = table?.columns.some((item) => item.name === column.name) ?? false;
  if (!hasColumn) {
    await queryRunner.addColumn(tableName, column);
  }
}

async function dropColumnIfPresent(
  queryRunner: QueryRunner,
  tableName: string,
  columnName: string
): Promise<void> {
  if (!(await queryRunner.hasTable(tableName))) {
    return;
  }
  const table = await queryRunner.getTable(tableName);
  const column = table?.columns.find((item) => item.name === columnName);
  if (column) {
    await queryRunner.dropColumn(tableName, column);
  }
}

@Service()
export class AddRiskPolicyMaxStopLossPctOfMargin1800001900000
  implements MigrationInterface
{
  name = 'AddRiskPolicyMaxStopLossPctOfMargin1800001900000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await addColumnIfMissing(
      queryRunner,
      'risk_policies',
      new TableColumn({
        name: 'max_stop_loss_pct_of_margin',
        type: 'double',
        isNullable: true,
      })
    );
    await addColumnIfMissing(
      queryRunner,
      'risk_snapshot_policy_contexts',
      new TableColumn({
        name: 'max_stop_loss_pct_of_margin',
        type: 'double',
        isNullable: true,
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await dropColumnIfPresent(
      queryRunner,
      'risk_snapshot_policy_contexts',
      'max_stop_loss_pct_of_margin'
    );
    await dropColumnIfPresent(
      queryRunner,
      'risk_policies',
      'max_stop_loss_pct_of_margin'
    );
  }
}
