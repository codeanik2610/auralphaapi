import { Service } from 'typedi';
import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableIndex,
} from 'typeorm';

@Service()
export class CreateMarketSymbolSnapshotsTable1765303000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('market_symbol_snapshots');
    if (hasTable) {
      return;
    }

    await queryRunner.createTable(
      new Table({
        name: 'market_symbol_snapshots',
        columns: [
          {
            name: 'symbol',
            type: 'varchar',
            length: '50',
            isPrimary: true,
          },
          {
            name: 'asset_id',
            type: 'varchar',
            length: '36',
            isNullable: true,
          },
          {
            name: 'name',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'source',
            type: 'varchar',
            length: '100',
            isNullable: true,
          },
          {
            name: 'last_price',
            type: 'decimal',
            precision: 30,
            scale: 12,
            isNullable: true,
          },
          {
            name: 'change_24h',
            type: 'double',
            isNullable: true,
          },
          {
            name: 'volume_24h',
            type: 'double',
            isNullable: true,
          },
          {
            name: 'high_24h',
            type: 'decimal',
            precision: 30,
            scale: 12,
            isNullable: true,
          },
          {
            name: 'low_24h',
            type: 'decimal',
            precision: 30,
            scale: 12,
            isNullable: true,
          },
          {
            name: 'liquidity_tier',
            type: 'varchar',
            length: '20',
            isNullable: true,
          },
          {
            name: 'price_source',
            type: 'varchar',
            length: '50',
            isNullable: true,
          },
          {
            name: 'snapshot_at',
            type: 'datetime',
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
      'market_symbol_snapshots',
      new TableIndex({
        name: 'idx_market_symbol_snapshots_snapshot_at',
        columnNames: ['snapshot_at'],
      })
    );

    await queryRunner.createIndex(
      'market_symbol_snapshots',
      new TableIndex({
        name: 'idx_market_symbol_snapshots_liquidity_updated_at',
        columnNames: ['liquidity_tier', 'updatedAt'],
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('market_symbol_snapshots');
    if (!hasTable) {
      return;
    }

    await queryRunner.dropIndex(
      'market_symbol_snapshots',
      'idx_market_symbol_snapshots_liquidity_updated_at'
    );
    await queryRunner.dropIndex(
      'market_symbol_snapshots',
      'idx_market_symbol_snapshots_snapshot_at'
    );
    await queryRunner.dropTable('market_symbol_snapshots');
  }
}
