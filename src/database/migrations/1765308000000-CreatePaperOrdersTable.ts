import { Service } from 'typedi';
import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

@Service()
export class CreatePaperOrdersTable1765308000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('paper_orders');
    if (!hasTable) {
      await queryRunner.createTable(
        new Table({
          name: 'paper_orders',
          columns: [
            { name: 'id', type: 'char', length: '36', isPrimary: true },
            { name: 'user_id', type: 'char', length: '36' },
            { name: 'suggested_trade_id', type: 'char', length: '36', isNullable: true },
            { name: 'asset_id', type: 'varchar', length: '191' },
            { name: 'broker_key', type: 'varchar', length: '100' },
            { name: 'account_id', type: 'char', length: '36' },
            { name: 'symbol', type: 'varchar', length: '64', isNullable: true },
            { name: 'side', type: 'varchar', length: '10', isNullable: true },
            { name: 'order_type', type: 'varchar', length: '64', isNullable: true },
            { name: 'trigger_type', type: 'varchar', length: '64', isNullable: true },
            { name: 'status', type: 'varchar', length: '32', default: "'OPEN'" },
            { name: 'leverage', type: 'double', isNullable: true },
            {
              name: 'quantity',
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
            { name: 'reduce_only', type: 'boolean', default: false },
            { name: 'payload_json', type: 'json', isNullable: true },
            { name: 'canceled_at', type: 'timestamp', isNullable: true },
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
      'paper_orders',
      new TableIndex({
        name: 'idx_paper_orders_user_status_created_at',
        columnNames: ['user_id', 'status', 'created_at'],
      })
    );

    await this.createIndexIfMissing(
      queryRunner,
      'paper_orders',
      new TableIndex({
        name: 'idx_paper_orders_account_created_at',
        columnNames: ['account_id', 'created_at'],
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await this.dropIndexIfPresent(
      queryRunner,
      'paper_orders',
      'idx_paper_orders_account_created_at'
    );
    await this.dropIndexIfPresent(
      queryRunner,
      'paper_orders',
      'idx_paper_orders_user_status_created_at'
    );

    if (await queryRunner.hasTable('paper_orders')) {
      await queryRunner.dropTable('paper_orders');
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
