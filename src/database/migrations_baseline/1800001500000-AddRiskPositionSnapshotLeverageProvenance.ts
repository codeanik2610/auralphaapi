import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';
import { Service } from 'typedi';

async function addColumnIfMissing(
  queryRunner: QueryRunner,
  tableName: string,
  column: TableColumn
): Promise<void> {
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
  const table = await queryRunner.getTable(tableName);
  const column = table?.columns.find((item) => item.name === columnName);
  if (column) {
    await queryRunner.dropColumn(tableName, column);
  }
}

@Service()
export class AddRiskPositionSnapshotLeverageProvenance1800001500000
  implements MigrationInterface
{
  name = 'AddRiskPositionSnapshotLeverageProvenance1800001500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('risk_position_snapshots'))) {
      return;
    }

    await addColumnIfMissing(
      queryRunner,
      'risk_position_snapshots',
      new TableColumn({
        name: 'requested_leverage',
        type: 'double',
        isNullable: true,
      })
    );
    await addColumnIfMissing(
      queryRunner,
      'risk_position_snapshots',
      new TableColumn({
        name: 'confirmed_order_leverage',
        type: 'double',
        isNullable: true,
      })
    );
    await addColumnIfMissing(
      queryRunner,
      'risk_position_snapshots',
      new TableColumn({
        name: 'observed_position_leverage',
        type: 'double',
        isNullable: true,
      })
    );
    await addColumnIfMissing(
      queryRunner,
      'risk_position_snapshots',
      new TableColumn({
        name: 'leverage_source',
        type: 'varchar',
        length: '64',
        isNullable: true,
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('risk_position_snapshots'))) {
      return;
    }

    await dropColumnIfPresent(queryRunner, 'risk_position_snapshots', 'leverage_source');
    await dropColumnIfPresent(
      queryRunner,
      'risk_position_snapshots',
      'observed_position_leverage'
    );
    await dropColumnIfPresent(
      queryRunner,
      'risk_position_snapshots',
      'confirmed_order_leverage'
    );
    await dropColumnIfPresent(queryRunner, 'risk_position_snapshots', 'requested_leverage');
  }
}
