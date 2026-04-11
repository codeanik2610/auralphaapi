import { Service } from 'typedi';
import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

@Service()
export class AddAutomationCursors1765304000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('automation_cursors');
    if (!hasTable) {
      await queryRunner.createTable(
        new Table({
          name: 'automation_cursors',
          columns: [
            { name: 'id', type: 'char', length: '36', isPrimary: true },
            { name: 'automation_id', type: 'char', length: '36' },
            { name: 'user_id', type: 'char', length: '36' },
            { name: 'symbol', type: 'varchar', length: '64' },
            { name: 'timeframe', type: 'varchar', length: '16' },
            { name: 'last_evaluated_signal_time', type: 'timestamp', isNullable: true },
            { name: 'last_triggered_signal_time', type: 'timestamp', isNullable: true },
            { name: 'last_run_id', type: 'char', length: '36', isNullable: true },
            { name: 'last_status', type: 'varchar', length: '32', isNullable: true },
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

    await this.createIndexIfMissing(
      queryRunner,
      'automation_cursors',
      new TableIndex({
        name: 'uidx_automation_cursors_automation_symbol_timeframe',
        columnNames: ['automation_id', 'symbol', 'timeframe'],
        isUnique: true,
      })
    );

    await this.createIndexIfMissing(
      queryRunner,
      'automation_cursors',
      new TableIndex({
        name: 'idx_automation_cursors_user_updated_at',
        columnNames: ['user_id', 'updated_at'],
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await this.dropIndexIfPresent(
      queryRunner,
      'automation_cursors',
      'idx_automation_cursors_user_updated_at'
    );
    await this.dropIndexIfPresent(
      queryRunner,
      'automation_cursors',
      'uidx_automation_cursors_automation_symbol_timeframe'
    );

    if (await queryRunner.hasTable('automation_cursors')) {
      await queryRunner.dropTable('automation_cursors');
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
    const index = table?.indices.find((item) => item.name === indexName);
    if (index) {
      await queryRunner.dropIndex(tableName, index);
    }
  }
}
