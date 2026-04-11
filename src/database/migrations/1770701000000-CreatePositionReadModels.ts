import { Service } from 'typedi';
import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

@Service()
export class CreatePositionReadModels1770701000000 implements MigrationInterface {
  name = 'CreatePositionReadModels1770701000000';

  private readonly indexes = [
    new TableIndex({
      name: 'idx_position_read_models_user_account_status_seen',
      columnNames: ['user_id', 'account_id', 'status_rank', 'last_seen_at'],
    }),
    new TableIndex({
      name: 'idx_position_read_models_user_broker_account_status_seen',
      columnNames: ['user_id', 'broker_key', 'account_id', 'status_rank', 'last_seen_at'],
    }),
    new TableIndex({
      name: 'idx_position_read_models_user_account_activity_at',
      columnNames: ['user_id', 'account_id', 'position_updated_at'],
    }),
    new TableIndex({
      name: 'idx_position_read_models_user_status_symbol',
      columnNames: ['user_id', 'status_key', 'symbol'],
    }),
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('position_read_models'))) {
      await queryRunner.createTable(
        new Table({
          name: 'position_read_models',
          columns: [
            { name: 'user_id', type: 'char', length: '36', isPrimary: true },
            { name: 'account_id', type: 'char', length: '36', isPrimary: true },
            { name: 'external_id', type: 'varchar', length: '191', isPrimary: true },
            { name: 'broker_key', type: 'varchar', length: '100' },
            { name: 'symbol', type: 'varchar', length: '100', isNullable: true },
            { name: 'side', type: 'varchar', length: '32', isNullable: true },
            { name: 'side_key', type: 'varchar', length: '32', isNullable: true },
            { name: 'side_raw', type: 'varchar', length: '64', isNullable: true },
            { name: 'status', type: 'varchar', length: '64', isNullable: true },
            { name: 'status_key', type: 'varchar', length: '32', isNullable: true },
            { name: 'status_raw', type: 'varchar', length: '64', isNullable: true },
            { name: 'status_rank', type: 'int', default: '0' },
            {
              name: 'quantity',
              type: 'decimal',
              precision: 30,
              scale: 12,
              isNullable: true,
            },
            {
              name: 'entry_price',
              type: 'decimal',
              precision: 30,
              scale: 12,
              isNullable: true,
            },
            {
              name: 'current_price',
              type: 'decimal',
              precision: 30,
              scale: 12,
              isNullable: true,
            },
            {
              name: 'closed_price',
              type: 'decimal',
              precision: 30,
              scale: 12,
              isNullable: true,
            },
            {
              name: 'unrealized_pnl',
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
            {
              name: 'leverage',
              type: 'decimal',
              precision: 20,
              scale: 8,
              isNullable: true,
            },
            {
              name: 'liquidation_price',
              type: 'decimal',
              precision: 30,
              scale: 12,
              isNullable: true,
            },
            {
              name: 'exposure',
              type: 'decimal',
              precision: 30,
              scale: 12,
              isNullable: true,
            },
            {
              name: 'order_price',
              type: 'decimal',
              precision: 30,
              scale: 12,
              isNullable: true,
            },
            {
              name: 'stoploss_price',
              type: 'decimal',
              precision: 30,
              scale: 12,
              isNullable: true,
            },
            {
              name: 'takeprofit_price',
              type: 'decimal',
              precision: 30,
              scale: 12,
              isNullable: true,
            },
            { name: 'stoploss_order_id', type: 'varchar', length: '191', isNullable: true },
            { name: 'takeprofit_order_id', type: 'varchar', length: '191', isNullable: true },
            { name: 'trigger_type', type: 'varchar', length: '64', isNullable: true },
            { name: 'position_created_at', type: 'timestamp', isNullable: true },
            { name: 'position_updated_at', type: 'timestamp', isNullable: true },
            { name: 'position_closed_at', type: 'timestamp', isNullable: true },
            { name: 'first_seen_at', type: 'timestamp', isNullable: true },
            { name: 'last_seen_at', type: 'timestamp', isNullable: true },
            { name: 'payload_json', type: 'json', isNullable: true },
            { name: 'payload_hash', type: 'char', length: '64', isNullable: true },
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

    for (const index of this.indexes) {
      const table = await queryRunner.getTable('position_read_models');
      if (table && !table.indices.some((current) => current.name === index.name)) {
        await queryRunner.createIndex('position_read_models', index);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('position_read_models'))) {
      return;
    }

    for (const index of [...this.indexes].reverse()) {
      if (index.name) {
        await queryRunner.dropIndex('position_read_models', index.name);
      }
    }

    await queryRunner.dropTable('position_read_models');
  }
}
