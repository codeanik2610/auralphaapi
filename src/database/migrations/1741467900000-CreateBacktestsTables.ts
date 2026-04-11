import { Service } from 'typedi';
import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
  TableIndex,
} from 'typeorm';

@Service()
export class CreateBacktestsTables1741467900000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'backtests',
        columns: [
          { name: 'id', type: 'char', length: '36', isPrimary: true },
          { name: 'name', type: 'varchar', length: '255' },
          { name: 'strategy', type: 'varchar', length: '255' },
          { name: 'symbol', type: 'varchar', length: '50' },
          { name: 'parameter', type: 'varchar', length: '255' },
          { name: 'status', type: 'varchar', length: '30' },
          { name: 'stability', type: 'varchar', length: '100', isNullable: true },
          { name: 'trades', type: 'int', unsigned: true, default: '0' },
          { name: 'createdAt', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
          {
            name: 'updatedAt',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
            onUpdate: 'CURRENT_TIMESTAMP',
          },
        ],
      })
    );

    await queryRunner.createIndex(
      'backtests',
      new TableIndex({
        name: 'idx_backtests_status_created_at',
        columnNames: ['status', 'createdAt'],
      })
    );

    await queryRunner.createIndex(
      'backtests',
      new TableIndex({
        name: 'idx_backtests_symbol_created_at',
        columnNames: ['symbol', 'createdAt'],
      })
    );

    await queryRunner.createTable(
      new Table({
        name: 'backtest_results',
        columns: [
          { name: 'id', type: 'char', length: '36', isPrimary: true },
          { name: 'backtestId', type: 'char', length: '36', isUnique: true },
          { name: 'cagr', type: 'double', isNullable: true },
          { name: 'sharpe', type: 'double', isNullable: true },
          { name: 'drawdown', type: 'double', isNullable: true },
          { name: 'winRate', type: 'double', isNullable: true },
          { name: 'profitFactor', type: 'double', isNullable: true },
          { name: 'config', type: 'json', isNullable: true },
          { name: 'createdAt', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
          {
            name: 'updatedAt',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
            onUpdate: 'CURRENT_TIMESTAMP',
          },
        ],
      })
    );

    await queryRunner.createForeignKey(
      'backtest_results',
      new TableForeignKey({
        name: 'fk_backtest_results_backtest_id',
        columnNames: ['backtestId'],
        referencedTableName: 'backtests',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropForeignKey('backtest_results', 'fk_backtest_results_backtest_id');
    await queryRunner.dropTable('backtest_results');
    await queryRunner.dropIndex('backtests', 'idx_backtests_symbol_created_at');
    await queryRunner.dropIndex('backtests', 'idx_backtests_status_created_at');
    await queryRunner.dropTable('backtests');
  }
}
