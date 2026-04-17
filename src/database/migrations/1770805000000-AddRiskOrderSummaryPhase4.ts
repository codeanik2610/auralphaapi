import { Service } from 'typedi';
import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

@Service()
export class AddRiskOrderSummaryPhase41770805000000 implements MigrationInterface {
  name = 'AddRiskOrderSummaryPhase41770805000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('risk_snapshots')) {
      const snapshotColumns: TableColumn[] = [
        new TableColumn({
          name: 'open_orders',
          type: 'int',
          unsigned: true,
          default: '0',
        }),
        new TableColumn({
          name: 'open_order_exposure',
          type: 'double',
          default: '0',
        }),
        new TableColumn({
          name: 'reserved_order_margin',
          type: 'double',
          default: '0',
        }),
      ];

      for (const column of snapshotColumns) {
        if (!(await queryRunner.hasColumn('risk_snapshots', column.name))) {
          await queryRunner.addColumn('risk_snapshots', column);
        }
      }
    }

    if (await queryRunner.hasTable('risk_account_snapshots')) {
      const accountColumns: TableColumn[] = [
        new TableColumn({
          name: 'open_orders',
          type: 'int',
          unsigned: true,
          default: '0',
        }),
        new TableColumn({
          name: 'open_order_exposure',
          type: 'double',
          default: '0',
        }),
        new TableColumn({
          name: 'reserved_order_margin',
          type: 'double',
          default: '0',
        }),
      ];

      for (const column of accountColumns) {
        if (!(await queryRunner.hasColumn('risk_account_snapshots', column.name))) {
          await queryRunner.addColumn('risk_account_snapshots', column);
        }
      }
    }

    if (await queryRunner.hasTable('risk_order_snapshots')) {
      const column = new TableColumn({
        name: 'reserved_margin',
        type: 'double',
        isNullable: true,
      });

      if (!(await queryRunner.hasColumn('risk_order_snapshots', column.name))) {
        await queryRunner.addColumn('risk_order_snapshots', column);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const rollbackPlan: Array<{ table: string; columns: string[] }> = [
      {
        table: 'risk_order_snapshots',
        columns: ['reserved_margin'],
      },
      {
        table: 'risk_account_snapshots',
        columns: ['reserved_order_margin', 'open_order_exposure', 'open_orders'],
      },
      {
        table: 'risk_snapshots',
        columns: ['reserved_order_margin', 'open_order_exposure', 'open_orders'],
      },
    ];

    for (const entry of rollbackPlan) {
      if (!(await queryRunner.hasTable(entry.table))) {
        continue;
      }

      for (const columnName of entry.columns) {
        if (await queryRunner.hasColumn(entry.table, columnName)) {
          await queryRunner.dropColumn(entry.table, columnName);
        }
      }
    }
  }
}
