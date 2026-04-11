import { Service } from 'typedi';
import { MigrationInterface, QueryRunner, TableIndex } from 'typeorm';

@Service()
export class AddMarketSnapshotOverviewIndexes1765309000000 implements MigrationInterface {
  private readonly indexes = [
    new TableIndex({
      name: 'idx_market_symbol_snapshots_volume_24h',
      columnNames: ['volume_24h'],
    }),
    new TableIndex({
      name: 'idx_market_symbol_snapshots_change_24h',
      columnNames: ['change_24h'],
    }),
    new TableIndex({
      name: 'idx_market_symbol_snapshots_last_price',
      columnNames: ['last_price'],
    }),
    new TableIndex({
      name: 'idx_market_symbol_snapshots_liquidity_volume_24h',
      columnNames: ['liquidity_tier', 'volume_24h'],
    }),
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('market_symbol_snapshots');
    if (!hasTable) {
      return;
    }

    const table = await queryRunner.getTable('market_symbol_snapshots');
    if (!table) {
      return;
    }

    for (const index of this.indexes) {
      const exists = table.indices.some((current) => current.name === index.name);
      if (!exists) {
        await queryRunner.createIndex('market_symbol_snapshots', index);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('market_symbol_snapshots');
    if (!hasTable) {
      return;
    }

    for (const index of [...this.indexes].reverse()) {
      if (index.name) {
        await queryRunner.dropIndex('market_symbol_snapshots', index.name);
      }
    }
  }
}
