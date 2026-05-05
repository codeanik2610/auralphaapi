import { Service } from 'typedi';
import { MigrationInterface, QueryRunner, TableColumn, TableIndex } from 'typeorm';

@Service()
export class AddSuggestedTradeExecutionProtectionTracking1800001700000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('suggested_trade_executions'))) {
      return;
    }

    await this.addColumnIfMissing(
      queryRunner,
      new TableColumn({
        name: 'protection_state',
        type: 'varchar',
        length: '32',
        isNullable: true,
      })
    );
    await this.addColumnIfMissing(
      queryRunner,
      new TableColumn({
        name: 'protection_source',
        type: 'varchar',
        length: '64',
        isNullable: true,
      })
    );
    await this.addColumnIfMissing(
      queryRunner,
      new TableColumn({
        name: 'protection_plan_json',
        type: 'json',
        isNullable: true,
      })
    );
    await this.addColumnIfMissing(
      queryRunner,
      new TableColumn({
        name: 'protection_attempts',
        type: 'int',
        unsigned: true,
        default: '0',
      })
    );
    await this.addColumnIfMissing(
      queryRunner,
      new TableColumn({
        name: 'protection_last_error',
        type: 'text',
        isNullable: true,
      })
    );
    await this.addColumnIfMissing(
      queryRunner,
      new TableColumn({
        name: 'protection_checked_at',
        type: 'timestamp',
        isNullable: true,
      })
    );
    await this.addColumnIfMissing(
      queryRunner,
      new TableColumn({
        name: 'protection_attached_at',
        type: 'timestamp',
        isNullable: true,
      })
    );

    const table = await queryRunner.getTable('suggested_trade_executions');
    const hasProtectionIndex = table?.indices.some(
      (index) => index.name === 'idx_suggested_trade_executions_protection_state'
    );
    if (!hasProtectionIndex) {
      await queryRunner.createIndex(
        'suggested_trade_executions',
        new TableIndex({
          name: 'idx_suggested_trade_executions_protection_state',
          columnNames: ['user_id', 'broker_key', 'account_id', 'protection_state', 'updated_at'],
        })
      );
    }

    await queryRunner.query(`
      UPDATE suggested_trade_executions
         SET protection_state = COALESCE(
               protection_state,
               CASE
                 WHEN LOWER(COALESCE(execution_mode, '')) <> 'live' THEN 'not_required'
                 WHEN NOT (COALESCE(stop_loss_price, 0) > 0 AND COALESCE(take_profit_price, 0) > 0)
                   THEN 'not_required'
                 WHEN position_closed_at IS NOT NULL
                   OR LOWER(COALESCE(outcome, '')) IN ('profit', 'loss', 'breakeven')
                   OR LOWER(COALESCE(execution_state, '')) IN ('closed', 'cancelled', 'rejected', 'expired', 'failed')
                   THEN 'not_required'
                 WHEN order_id IS NULL AND position_id IS NULL THEN 'pending'
                 WHEN filled_at IS NOT NULL AND position_id IS NULL THEN 'waiting_for_position'
                 WHEN position_id IS NULL THEN 'waiting_for_fill'
                 ELSE 'pending'
               END
             ),
             protection_source = CASE
               WHEN protection_source IS NULL
                 AND LOWER(COALESCE(execution_mode, '')) = 'live'
                 AND COALESCE(stop_loss_price, 0) > 0
                 AND COALESCE(take_profit_price, 0) > 0
                 THEN 'suggested_trade_execution'
               ELSE protection_source
             END,
             protection_plan_json = CASE
               WHEN protection_plan_json IS NULL
                 AND LOWER(COALESCE(execution_mode, '')) = 'live'
                 AND COALESCE(stop_loss_price, 0) > 0
                 AND COALESCE(take_profit_price, 0) > 0
                 THEN JSON_OBJECT(
                   'source', 'suggested_trade_execution',
                   'entryPrice', CAST(entry_price AS CHAR),
                   'stopLossPrice', CAST(stop_loss_price AS CHAR),
                   'takeProfitPrice', CAST(take_profit_price AS CHAR),
                   'brokerKey', broker_key,
                   'accountId', account_id,
                   'orderId', order_id,
                   'positionId', position_id
                 )
               ELSE protection_plan_json
             END
       WHERE protection_state IS NULL
          OR protection_source IS NULL
          OR protection_plan_json IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('suggested_trade_executions'))) {
      return;
    }

    const table = await queryRunner.getTable('suggested_trade_executions');
    const index = table?.indices.find(
      (candidate) => candidate.name === 'idx_suggested_trade_executions_protection_state'
    );
    if (index) {
      await queryRunner.dropIndex('suggested_trade_executions', index);
    }

    for (const columnName of [
      'protection_attached_at',
      'protection_checked_at',
      'protection_last_error',
      'protection_attempts',
      'protection_plan_json',
      'protection_source',
      'protection_state',
    ]) {
      if (await queryRunner.hasColumn('suggested_trade_executions', columnName)) {
        await queryRunner.dropColumn('suggested_trade_executions', columnName);
      }
    }
  }

  private async addColumnIfMissing(queryRunner: QueryRunner, column: TableColumn): Promise<void> {
    if (!(await queryRunner.hasColumn('suggested_trade_executions', column.name))) {
      await queryRunner.addColumn('suggested_trade_executions', column);
    }
  }
}
