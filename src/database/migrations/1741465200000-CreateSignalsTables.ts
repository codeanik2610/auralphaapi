import { Service } from 'typedi';
import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
  TableIndex,
} from 'typeorm';

@Service()
export class CreateSignalsTables1741465200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'signals',
        columns: [
          {
            name: 'id',
            type: 'char',
            length: '36',
            isPrimary: true,
          },
          {
            name: 'symbol',
            type: 'varchar',
            length: '50',
          },
          {
            name: 'source',
            type: 'varchar',
            length: '100',
          },
          {
            name: 'confidence',
            type: 'double',
          },
          {
            name: 'direction',
            type: 'varchar',
            length: '20',
            isNullable: true,
          },
          {
            name: 'timeframe',
            type: 'varchar',
            length: '20',
            isNullable: true,
          },
          {
            name: 'status',
            type: 'varchar',
            length: '30',
          },
          {
            name: 'regime',
            type: 'varchar',
            length: '50',
            isNullable: true,
          },
          {
            name: 'aiScore',
            type: 'int',
            unsigned: true,
            isNullable: true,
          },
          {
            name: 'thesis',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'route',
            type: 'varchar',
            length: '50',
            isNullable: true,
          },
          {
            name: 'riskNote',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'promotionState',
            type: 'varchar',
            length: '30',
            isNullable: true,
          },
          {
            name: 'createdAt',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
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
      'signals',
      new TableIndex({
        name: 'idx_signals_status_created_at',
        columnNames: ['status', 'createdAt'],
      })
    );

    await queryRunner.createIndex(
      'signals',
      new TableIndex({
        name: 'idx_signals_symbol_created_at',
        columnNames: ['symbol', 'createdAt'],
      })
    );

    await queryRunner.createTable(
      new Table({
        name: 'signal_actions',
        columns: [
          {
            name: 'id',
            type: 'char',
            length: '36',
            isPrimary: true,
          },
          {
            name: 'signalId',
            type: 'char',
            length: '36',
          },
          {
            name: 'actionType',
            type: 'varchar',
            length: '30',
          },
          {
            name: 'target',
            type: 'varchar',
            length: '50',
            isNullable: true,
          },
          {
            name: 'note',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'actor',
            type: 'varchar',
            length: '100',
            isNullable: true,
          },
          {
            name: 'metadata',
            type: 'json',
            isNullable: true,
          },
          {
            name: 'createdAt',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
      })
    );

    await queryRunner.createIndex(
      'signal_actions',
      new TableIndex({
        name: 'idx_signal_actions_signal_created_at',
        columnNames: ['signalId', 'createdAt'],
      })
    );

    await queryRunner.createForeignKey(
      'signal_actions',
      new TableForeignKey({
        name: 'fk_signal_actions_signal_id',
        columnNames: ['signalId'],
        referencedTableName: 'signals',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropForeignKey('signal_actions', 'fk_signal_actions_signal_id');
    await queryRunner.dropIndex('signal_actions', 'idx_signal_actions_signal_created_at');
    await queryRunner.dropTable('signal_actions');
    await queryRunner.dropIndex('signals', 'idx_signals_symbol_created_at');
    await queryRunner.dropIndex('signals', 'idx_signals_status_created_at');
    await queryRunner.dropTable('signals');
  }
}
