import { Service } from 'typedi';
import {
  MigrationInterface,
  QueryRunner,
  TableColumn,
  TableIndex,
} from 'typeorm';

@Service()
export class ExpandSignalsForScanPipeline1765305000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('signals'))) {
      return;
    }

    const columns: Array<{ name: string; column: TableColumn }> = [
      {
        name: 'dedupeKey',
        column: new TableColumn({
          name: 'dedupeKey',
          type: 'varchar',
          length: '191',
          isNullable: true,
        }),
      },
      {
        name: 'market',
        column: new TableColumn({
          name: 'market',
          type: 'varchar',
          length: '30',
          isNullable: true,
        }),
      },
      {
        name: 'signalTime',
        column: new TableColumn({
          name: 'signalTime',
          type: 'datetime',
          isNullable: true,
        }),
      },
      {
        name: 'entryPrice',
        column: new TableColumn({
          name: 'entryPrice',
          type: 'decimal',
          precision: 30,
          scale: 12,
          isNullable: true,
        }),
      },
      {
        name: 'sourceRefType',
        column: new TableColumn({
          name: 'sourceRefType',
          type: 'varchar',
          length: '40',
          isNullable: true,
        }),
      },
      {
        name: 'sourceRefId',
        column: new TableColumn({
          name: 'sourceRefId',
          type: 'varchar',
          length: '191',
          isNullable: true,
        }),
      },
      {
        name: 'expiresAt',
        column: new TableColumn({
          name: 'expiresAt',
          type: 'datetime',
          isNullable: true,
        }),
      },
      {
        name: 'metadata',
        column: new TableColumn({
          name: 'metadata',
          type: 'json',
          isNullable: true,
        }),
      },
    ];

    for (const item of columns) {
      if (!(await queryRunner.hasColumn('signals', item.name))) {
        await queryRunner.addColumn('signals', item.column);
      }
    }

    await queryRunner.query(
      "UPDATE signals SET dedupeKey = CONCAT('legacy:', id) WHERE dedupeKey IS NULL OR dedupeKey = ''"
    );
    await queryRunner.query(
      'UPDATE signals SET signalTime = createdAt WHERE signalTime IS NULL'
    );

    const table = await queryRunner.getTable('signals');
    if (!table) {
      return;
    }

    if (!table.indices.some((index) => index.name === 'ux_signals_dedupe_key')) {
      await queryRunner.createIndex(
        'signals',
        new TableIndex({
          name: 'ux_signals_dedupe_key',
          columnNames: ['dedupeKey'],
          isUnique: true,
        })
      );
    }

    if (!table.indices.some((index) => index.name === 'idx_signals_source_ref_signal_time')) {
      await queryRunner.createIndex(
        'signals',
        new TableIndex({
          name: 'idx_signals_source_ref_signal_time',
          columnNames: ['sourceRefType', 'sourceRefId', 'signalTime'],
        })
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('signals'))) {
      return;
    }

    const table = await queryRunner.getTable('signals');
    if (table?.indices.some((index) => index.name === 'idx_signals_source_ref_signal_time')) {
      await queryRunner.dropIndex('signals', 'idx_signals_source_ref_signal_time');
    }
    if (table?.indices.some((index) => index.name === 'ux_signals_dedupe_key')) {
      await queryRunner.dropIndex('signals', 'ux_signals_dedupe_key');
    }

    const columns = [
      'metadata',
      'expiresAt',
      'sourceRefId',
      'sourceRefType',
      'entryPrice',
      'signalTime',
      'market',
      'dedupeKey',
    ];
    for (const column of columns) {
      if (await queryRunner.hasColumn('signals', column)) {
        await queryRunner.dropColumn('signals', column);
      }
    }
  }
}
