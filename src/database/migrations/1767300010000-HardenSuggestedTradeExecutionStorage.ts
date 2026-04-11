import { Service } from 'typedi';
import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex } from 'typeorm';

@Service()
export class HardenSuggestedTradeExecutionStorage1767300010000
  implements MigrationInterface
{
  name = 'HardenSuggestedTradeExecutionStorage1767300010000';

  private readonly suggestedTradeIndexes = [
    new TableIndex({
      name: 'idx_suggested_trades_user_automation_status_signal_time',
      columnNames: ['user_id', 'automation_id', 'status', 'signal_time'],
    }),
    new TableIndex({
      name: 'idx_suggested_trades_user_run_signal_time',
      columnNames: ['user_id', 'automation_run_id', 'signal_time'],
    }),
  ];

  private readonly executionIndexes = [
    new TableIndex({
      name: 'idx_suggested_trade_executions_user_order_lookup',
      columnNames: ['user_id', 'broker_key', 'account_id', 'order_id'],
    }),
    new TableIndex({
      name: 'idx_suggested_trade_executions_user_paper_order_lookup',
      columnNames: ['user_id', 'paper_order_id'],
    }),
    new TableIndex({
      name: 'idx_suggested_trade_executions_user_position_lookup',
      columnNames: ['user_id', 'broker_key', 'account_id', 'position_id'],
    }),
    new TableIndex({
      name: 'idx_suggested_trade_executions_user_state_seen_at',
      columnNames: ['user_id', 'broker_key', 'account_id', 'execution_state', 'last_seen_at'],
    }),
  ];

  private readonly relationalLinkIndexes = [
    {
      tableName: 'paper_orders',
      index: new TableIndex({
        name: 'idx_paper_orders_suggested_trade_id',
        columnNames: ['suggested_trade_id'],
      }),
    },
    {
      tableName: 'automation_run_outputs',
      index: new TableIndex({
        name: 'idx_automation_run_outputs_suggested_trade_id',
        columnNames: ['suggested_trade_id'],
      }),
    },
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('suggested_trades'))) {
      return;
    }

    await this.createExecutionTable(queryRunner);
    await this.createMissingIndexes(queryRunner, 'suggested_trades', this.suggestedTradeIndexes);
    await this.createMissingIndexes(
      queryRunner,
      'suggested_trade_executions',
      this.executionIndexes
    );

    for (const { tableName, index } of this.relationalLinkIndexes) {
      await this.createMissingIndexes(queryRunner, tableName, [index]);
    }

    await this.backfillExecutionRows(queryRunner);
    await this.dropLegacyExecutionJson(queryRunner);
    await this.normalizeRelationalLinks(queryRunner);
    await this.ensureForeignKeys(queryRunner);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await this.dropForeignKeyIfPresent(
      queryRunner,
      'automation_run_outputs',
      'fk_automation_run_outputs_suggested_trade'
    );
    await this.dropForeignKeyIfPresent(
      queryRunner,
      'paper_orders',
      'fk_paper_orders_suggested_trade'
    );
    await this.dropForeignKeyIfPresent(
      queryRunner,
      'suggested_trade_executions',
      'fk_suggested_trade_executions_trade'
    );

    for (const { tableName, index } of [...this.relationalLinkIndexes].reverse()) {
      await this.dropIndexesIfPresent(queryRunner, tableName, [index]);
    }

    await this.dropIndexesIfPresent(
      queryRunner,
      'suggested_trade_executions',
      this.executionIndexes
    );
    await this.dropIndexesIfPresent(
      queryRunner,
      'suggested_trades',
      this.suggestedTradeIndexes
    );

    if (await queryRunner.hasTable('suggested_trade_executions')) {
      await queryRunner.dropTable('suggested_trade_executions');
    }
  }

  private async createExecutionTable(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('suggested_trade_executions')) {
      return;
    }

    await queryRunner.createTable(
      new Table({
        name: 'suggested_trade_executions',
        columns: [
          { name: 'suggested_trade_id', type: 'char', length: '36', isPrimary: true },
          { name: 'user_id', type: 'char', length: '36' },
          { name: 'execution_mode', type: 'varchar', length: '16', isNullable: true },
          { name: 'order_id', type: 'varchar', length: '191', isNullable: true },
          { name: 'paper_order_id', type: 'char', length: '36', isNullable: true },
          { name: 'broker_key', type: 'varchar', length: '100', isNullable: true },
          { name: 'account_id', type: 'char', length: '36', isNullable: true },
          { name: 'order_status', type: 'varchar', length: '64', isNullable: true },
          { name: 'paper_order_status', type: 'varchar', length: '64', isNullable: true },
          { name: 'execution_state', type: 'varchar', length: '32', isNullable: true },
          { name: 'order_type', type: 'varchar', length: '64', isNullable: true },
          { name: 'trigger_type', type: 'varchar', length: '64', isNullable: true },
          { name: 'leverage', type: 'double', isNullable: true },
          { name: 'quantity', type: 'double', isNullable: true },
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
          {
            name: 'take_profit_price',
            type: 'decimal',
            precision: 30,
            scale: 12,
            isNullable: true,
          },
          { name: 'submitted_at', type: 'timestamp', isNullable: true },
          { name: 'linked_at', type: 'timestamp', isNullable: true },
          { name: 'last_seen_at', type: 'timestamp', isNullable: true },
          { name: 'filled_at', type: 'timestamp', isNullable: true },
          { name: 'canceled_at', type: 'timestamp', isNullable: true },
          {
            name: 'filled_price',
            type: 'decimal',
            precision: 30,
            scale: 12,
            isNullable: true,
          },
          { name: 'filled_quantity', type: 'double', isNullable: true },
          { name: 'remaining_quantity', type: 'double', isNullable: true },
          { name: 'position_id', type: 'varchar', length: '191', isNullable: true },
          { name: 'position_status', type: 'varchar', length: '64', isNullable: true },
          { name: 'position_opened_at', type: 'timestamp', isNullable: true },
          { name: 'position_closed_at', type: 'timestamp', isNullable: true },
          {
            name: 'exit_price',
            type: 'decimal',
            precision: 30,
            scale: 12,
            isNullable: true,
          },
          {
            name: 'realized_pnl',
            type: 'decimal',
            precision: 30,
            scale: 12,
            isNullable: true,
          },
          { name: 'outcome', type: 'varchar', length: '24', isNullable: true },
          { name: 'note', type: 'text', isNullable: true },
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

  private async backfillExecutionRows(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('suggested_trade_executions'))) {
      return;
    }

    await queryRunner.query(
      `
        INSERT INTO suggested_trade_executions (
          suggested_trade_id,
          user_id,
          execution_mode,
          order_id,
          paper_order_id,
          broker_key,
          account_id,
          order_status,
          paper_order_status,
          execution_state,
          order_type,
          trigger_type,
          leverage,
          quantity,
          entry_price,
          stop_loss_price,
          take_profit_price,
          submitted_at,
          linked_at,
          last_seen_at,
          filled_at,
          canceled_at,
          filled_price,
          filled_quantity,
          remaining_quantity,
          position_id,
          position_status,
          position_opened_at,
          position_closed_at,
          exit_price,
          realized_pnl,
          outcome,
          note,
          created_at,
          updated_at
        )
        SELECT
          suggested_trade.id,
          suggested_trade.user_id,
          ${this.jsonString('executionMode')},
          ${this.jsonString('orderId')},
          ${this.jsonString('paperOrderId')},
          LOWER(${this.jsonString('brokerKey')}),
          ${this.jsonString('accountId')},
          ${this.jsonString('orderStatus')},
          ${this.jsonString('paperOrderStatus')},
          ${this.jsonString('executionState')},
          ${this.jsonString('orderType')},
          ${this.jsonString('triggerType')},
          ${this.jsonDouble('leverage')},
          ${this.jsonDouble('quantity')},
          ${this.jsonString('entryPrice')},
          ${this.jsonString('stopLossPrice')},
          ${this.jsonString('takeProfitPrice')},
          ${this.jsonTimestamp('submittedAt')},
          ${this.jsonTimestamp('linkedAt')},
          ${this.jsonTimestamp('lastSeenAt')},
          ${this.jsonTimestamp('filledAt')},
          ${this.jsonTimestamp('canceledAt')},
          ${this.jsonString('filledPrice')},
          ${this.jsonDouble('filledQuantity')},
          ${this.jsonDouble('remainingQuantity')},
          ${this.jsonString('positionId')},
          ${this.jsonString('positionStatus')},
          ${this.jsonTimestamp('positionOpenedAt')},
          ${this.jsonTimestamp('positionClosedAt')},
          ${this.jsonString('exitPrice')},
          ${this.jsonString('realizedPnl')},
          ${this.jsonString('outcome')},
          ${this.jsonString('note')},
          suggested_trade.created_at,
          suggested_trade.updated_at
        FROM suggested_trades suggested_trade
        WHERE JSON_EXTRACT(suggested_trade.meta_json, '$.execution') IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM suggested_trade_executions execution_row
            WHERE execution_row.suggested_trade_id = suggested_trade.id
          )
      `
    );
  }

  private async dropLegacyExecutionJson(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `
        UPDATE suggested_trades
        SET meta_json = CASE
          WHEN JSON_LENGTH(JSON_REMOVE(meta_json, '$.execution')) = 0 THEN NULL
          ELSE JSON_REMOVE(meta_json, '$.execution')
        END
        WHERE JSON_EXTRACT(meta_json, '$.execution') IS NOT NULL
      `
    );
  }

  private async normalizeRelationalLinks(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('paper_orders')) {
      await queryRunner.query(
        `
          UPDATE paper_orders paper_order
          LEFT JOIN suggested_trades suggested_trade
            ON suggested_trade.id = paper_order.suggested_trade_id
          SET paper_order.suggested_trade_id = NULL
          WHERE paper_order.suggested_trade_id IS NOT NULL
            AND suggested_trade.id IS NULL
        `
      );
    }

    if (await queryRunner.hasTable('automation_run_outputs')) {
      await queryRunner.query(
        `
          UPDATE automation_run_outputs output_row
          LEFT JOIN suggested_trades suggested_trade
            ON suggested_trade.id = output_row.suggested_trade_id
          SET output_row.suggested_trade_id = NULL
          WHERE output_row.suggested_trade_id IS NOT NULL
            AND suggested_trade.id IS NULL
        `
      );
    }
  }

  private async ensureForeignKeys(queryRunner: QueryRunner): Promise<void> {
    if (
      (await queryRunner.hasTable('suggested_trade_executions')) &&
      !(await this.hasForeignKey(
        queryRunner,
        'suggested_trade_executions',
        'fk_suggested_trade_executions_trade'
      ))
    ) {
      await queryRunner.createForeignKey(
        'suggested_trade_executions',
        new TableForeignKey({
          name: 'fk_suggested_trade_executions_trade',
          columnNames: ['suggested_trade_id'],
          referencedTableName: 'suggested_trades',
          referencedColumnNames: ['id'],
          onDelete: 'CASCADE',
        })
      );
    }

    if (
      (await queryRunner.hasTable('paper_orders')) &&
      !(await this.hasForeignKey(queryRunner, 'paper_orders', 'fk_paper_orders_suggested_trade'))
    ) {
      await queryRunner.createForeignKey(
        'paper_orders',
        new TableForeignKey({
          name: 'fk_paper_orders_suggested_trade',
          columnNames: ['suggested_trade_id'],
          referencedTableName: 'suggested_trades',
          referencedColumnNames: ['id'],
          onDelete: 'SET NULL',
        })
      );
    }

    if (
      (await queryRunner.hasTable('automation_run_outputs')) &&
      !(await this.hasForeignKey(
        queryRunner,
        'automation_run_outputs',
        'fk_automation_run_outputs_suggested_trade'
      ))
    ) {
      await queryRunner.createForeignKey(
        'automation_run_outputs',
        new TableForeignKey({
          name: 'fk_automation_run_outputs_suggested_trade',
          columnNames: ['suggested_trade_id'],
          referencedTableName: 'suggested_trades',
          referencedColumnNames: ['id'],
          onDelete: 'SET NULL',
        })
      );
    }
  }

  private async createMissingIndexes(
    queryRunner: QueryRunner,
    tableName: string,
    indexes: TableIndex[]
  ): Promise<void> {
    if (!(await queryRunner.hasTable(tableName))) {
      return;
    }

    const table = await queryRunner.getTable(tableName);
    if (!table) {
      return;
    }

    for (const index of indexes) {
      if (!table.indices.some((entry) => entry.name === index.name)) {
        await queryRunner.createIndex(tableName, index);
      }
    }
  }

  private async dropIndexesIfPresent(
    queryRunner: QueryRunner,
    tableName: string,
    indexes: TableIndex[]
  ): Promise<void> {
    if (!(await queryRunner.hasTable(tableName))) {
      return;
    }

    const table = await queryRunner.getTable(tableName);
    if (!table) {
      return;
    }

    for (const index of [...indexes].reverse()) {
      if (index.name && table.indices.some((entry) => entry.name === index.name)) {
        await queryRunner.dropIndex(tableName, index.name);
      }
    }
  }

  private async hasForeignKey(
    queryRunner: QueryRunner,
    tableName: string,
    foreignKeyName: string
  ): Promise<boolean> {
    if (!(await queryRunner.hasTable(tableName))) {
      return false;
    }

    const table = await queryRunner.getTable(tableName);
    return Boolean(table?.foreignKeys.some((foreignKey) => foreignKey.name === foreignKeyName));
  }

  private async dropForeignKeyIfPresent(
    queryRunner: QueryRunner,
    tableName: string,
    foreignKeyName: string
  ): Promise<void> {
    if (!(await this.hasForeignKey(queryRunner, tableName, foreignKeyName))) {
      return;
    }

    await queryRunner.dropForeignKey(tableName, foreignKeyName);
  }

  private jsonString(field: string): string {
    return `NULLIF(JSON_UNQUOTE(JSON_EXTRACT(suggested_trade.meta_json, '$.execution.${field}')), '')`;
  }

  private jsonDouble(field: string): string {
    const value = this.jsonString(field);
    return `CASE WHEN ${value} IS NULL THEN NULL ELSE CAST(${value} AS DOUBLE) END`;
  }

  private jsonTimestamp(field: string): string {
    const value = this.jsonString(field);
    return `CASE
      WHEN ${value} IS NULL THEN NULL
      ELSE CAST(REPLACE(REPLACE(${value}, 'T', ' '), 'Z', '') AS DATETIME(3))
    END`;
  }
}
