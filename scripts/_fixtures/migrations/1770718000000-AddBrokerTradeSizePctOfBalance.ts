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
export class AddBrokerTradeSizePctOfBalance1770718000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('risk_policies')) {
      await addColumnIfMissing(
        queryRunner,
        'risk_policies',
        new TableColumn({
          name: 'trade_size_pct_of_balance',
          type: 'double',
          isNullable: true,
        })
      );
      await queryRunner.query(`
        UPDATE risk_policies
        SET
          trade_size_pct_of_balance = CASE
            WHEN trade_size_pct_of_balance IS NOT NULL THEN trade_size_pct_of_balance
            WHEN LOWER(COALESCE(broker_key, '')) = 'delta_exchange' THEN 25
            WHEN LOWER(COALESCE(broker_key, '')) = 'mudrex' THEN 10
            ELSE max_order_allocation
          END,
          min_notional_per_trade = NULL,
          max_order_allocation = NULL
        WHERE scope = 'broker'
      `);
    }

    if (await queryRunner.hasTable('risk_snapshot_policy_contexts')) {
      await addColumnIfMissing(
        queryRunner,
        'risk_snapshot_policy_contexts',
        new TableColumn({
          name: 'trade_size_pct_of_balance',
          type: 'double',
          isNullable: true,
        })
      );
      await queryRunner.query(`
        UPDATE risk_snapshot_policy_contexts
        SET
          trade_size_pct_of_balance = CASE
            WHEN trade_size_pct_of_balance IS NOT NULL THEN trade_size_pct_of_balance
            WHEN LOWER(COALESCE(policy_target_key, '')) = 'delta_exchange' THEN 25
            WHEN LOWER(COALESCE(policy_target_key, '')) LIKE 'broker::delta_exchange%' THEN 25
            WHEN LOWER(COALESCE(policy_target_key, '')) = 'mudrex' THEN 10
            WHEN LOWER(COALESCE(policy_target_key, '')) LIKE 'broker::mudrex%' THEN 10
            ELSE max_order_allocation
          END,
          min_notional_per_trade = NULL,
          max_order_allocation = NULL
        WHERE policy_scope = 'broker'
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('risk_snapshot_policy_contexts')) {
      await dropColumnIfPresent(
        queryRunner,
        'risk_snapshot_policy_contexts',
        'trade_size_pct_of_balance'
      );
    }

    if (await queryRunner.hasTable('risk_policies')) {
      await dropColumnIfPresent(queryRunner, 'risk_policies', 'trade_size_pct_of_balance');
    }
  }
}
