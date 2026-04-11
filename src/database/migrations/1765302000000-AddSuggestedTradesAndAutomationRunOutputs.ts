import { Service } from 'typedi';
import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

@Service()
export class AddSuggestedTradesAndAutomationRunOutputs1765302000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasSuggestedTrades = await queryRunner.hasTable('suggested_trades');
    if (!hasSuggestedTrades) {
      await queryRunner.createTable(
        new Table({
          name: 'suggested_trades',
          columns: [
            { name: 'id', type: 'char', length: '36', isPrimary: true },
            { name: 'automation_id', type: 'char', length: '36' },
            { name: 'automation_run_id', type: 'char', length: '36' },
            { name: 'user_id', type: 'char', length: '36' },
            { name: 'source_backtest_id', type: 'char', length: '36', isNullable: true },
            { name: 'source_template_id', type: 'char', length: '36', isNullable: true },
            { name: 'source_setup_key', type: 'varchar', length: '191', isNullable: true },
            { name: 'symbol', type: 'varchar', length: '64' },
            { name: 'timeframe', type: 'varchar', length: '16' },
            { name: 'side', type: 'varchar', length: '10' },
            { name: 'signal_time', type: 'timestamp' },
            { name: 'status', type: 'varchar', length: '32', default: "'Open'" },
            { name: 'confidence', type: 'double', isNullable: true },
            { name: 'score', type: 'double', isNullable: true },
            {
              name: 'entry_price',
              type: 'decimal',
              precision: 30,
              scale: 12,
              isNullable: true,
            },
            {
              name: 'stop_loss_price',
              type: 'decimal',
              precision: 30,
              scale: 12,
              isNullable: true,
            },
            { name: 'take_profit_targets', type: 'json', isNullable: true },
            { name: 'entry_rule', type: 'text', isNullable: true },
            { name: 'exit_rule', type: 'text', isNullable: true },
            { name: 'rationale', type: 'text', isNullable: true },
            { name: 'dedupe_key', type: 'varchar', length: '191' },
            { name: 'meta_json', type: 'json', isNullable: true },
            { name: 'created_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
            {
              name: 'updated_at',
              type: 'timestamp',
              default: 'CURRENT_TIMESTAMP',
              onUpdate: 'CURRENT_TIMESTAMP',
            },
          ],
        })
      );
    }

    const hasRunOutputs = await queryRunner.hasTable('automation_run_outputs');
    if (!hasRunOutputs) {
      await queryRunner.createTable(
        new Table({
          name: 'automation_run_outputs',
          columns: [
            { name: 'id', type: 'char', length: '36', isPrimary: true },
            { name: 'automation_id', type: 'char', length: '36' },
            { name: 'automation_run_id', type: 'char', length: '36' },
            { name: 'user_id', type: 'char', length: '36' },
            { name: 'suggested_trade_id', type: 'char', length: '36', isNullable: true },
            { name: 'output_type', type: 'varchar', length: '64' },
            { name: 'status', type: 'varchar', length: '32', default: "'Created'" },
            { name: 'title', type: 'varchar', length: '255', isNullable: true },
            { name: 'dedupe_key', type: 'varchar', length: '191', isNullable: true },
            { name: 'payload_json', type: 'json', isNullable: true },
            { name: 'created_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
            {
              name: 'updated_at',
              type: 'timestamp',
              default: 'CURRENT_TIMESTAMP',
              onUpdate: 'CURRENT_TIMESTAMP',
            },
          ],
        })
      );
    }

    await this.createIndexIfMissing(
      queryRunner,
      'suggested_trades',
      new TableIndex({
        name: 'idx_suggested_trades_automation_signal_time',
        columnNames: ['automation_id', 'signal_time'],
      })
    );
    await this.createIndexIfMissing(
      queryRunner,
      'suggested_trades',
      new TableIndex({
        name: 'idx_suggested_trades_user_status_signal_time',
        columnNames: ['user_id', 'status', 'signal_time'],
      })
    );
    await this.createIndexIfMissing(
      queryRunner,
      'suggested_trades',
      new TableIndex({
        name: 'idx_suggested_trades_symbol_timeframe_status',
        columnNames: ['symbol', 'timeframe', 'status'],
      })
    );
    await this.createIndexIfMissing(
      queryRunner,
      'suggested_trades',
      new TableIndex({
        name: 'uidx_suggested_trades_automation_dedupe_key',
        columnNames: ['automation_id', 'dedupe_key'],
        isUnique: true,
      })
    );

    await this.createIndexIfMissing(
      queryRunner,
      'automation_run_outputs',
      new TableIndex({
        name: 'idx_automation_run_outputs_run_created_at',
        columnNames: ['automation_run_id', 'created_at'],
      })
    );
    await this.createIndexIfMissing(
      queryRunner,
      'automation_run_outputs',
      new TableIndex({
        name: 'idx_automation_run_outputs_type_status',
        columnNames: ['output_type', 'status'],
      })
    );
    await this.createIndexIfMissing(
      queryRunner,
      'automation_run_outputs',
      new TableIndex({
        name: 'idx_automation_run_outputs_user_created_at',
        columnNames: ['user_id', 'created_at'],
      })
    );
    await this.createIndexIfMissing(
      queryRunner,
      'automation_run_outputs',
      new TableIndex({
        name: 'uidx_automation_run_outputs_run_type_dedupe',
        columnNames: ['automation_run_id', 'output_type', 'dedupe_key'],
        isUnique: true,
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await this.dropIndexIfPresent(
      queryRunner,
      'automation_run_outputs',
      'uidx_automation_run_outputs_run_type_dedupe'
    );
    await this.dropIndexIfPresent(
      queryRunner,
      'automation_run_outputs',
      'idx_automation_run_outputs_user_created_at'
    );
    await this.dropIndexIfPresent(
      queryRunner,
      'automation_run_outputs',
      'idx_automation_run_outputs_type_status'
    );
    await this.dropIndexIfPresent(
      queryRunner,
      'automation_run_outputs',
      'idx_automation_run_outputs_run_created_at'
    );

    await this.dropIndexIfPresent(
      queryRunner,
      'suggested_trades',
      'uidx_suggested_trades_automation_dedupe_key'
    );
    await this.dropIndexIfPresent(
      queryRunner,
      'suggested_trades',
      'idx_suggested_trades_symbol_timeframe_status'
    );
    await this.dropIndexIfPresent(
      queryRunner,
      'suggested_trades',
      'idx_suggested_trades_user_status_signal_time'
    );
    await this.dropIndexIfPresent(
      queryRunner,
      'suggested_trades',
      'idx_suggested_trades_automation_signal_time'
    );

    if (await queryRunner.hasTable('automation_run_outputs')) {
      await queryRunner.dropTable('automation_run_outputs');
    }
    if (await queryRunner.hasTable('suggested_trades')) {
      await queryRunner.dropTable('suggested_trades');
    }
  }

  private async createIndexIfMissing(
    queryRunner: QueryRunner,
    tableName: string,
    index: TableIndex
  ): Promise<void> {
    const table = await queryRunner.getTable(tableName);
    const exists = table?.indices.some((item) => item.name === index.name);
    if (!exists) {
      await queryRunner.createIndex(tableName, index);
    }
  }

  private async dropIndexIfPresent(
    queryRunner: QueryRunner,
    tableName: string,
    indexName: string
  ): Promise<void> {
    const table = await queryRunner.getTable(tableName);
    const exists = table?.indices.some((item) => item.name === indexName);
    if (exists) {
      await queryRunner.dropIndex(tableName, indexName);
    }
  }
}
