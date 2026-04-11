import { Service } from 'typedi';
import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
  TableIndex,
} from 'typeorm';

@Service()
export class CreateWatchlistsTables1741467000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'watchlists',
        columns: [
          { name: 'id', type: 'char', length: '36', isPrimary: true },
          { name: 'name', type: 'varchar', length: '255' },
          { name: 'type', type: 'varchar', length: '30' },
          { name: 'description', type: 'text', isNullable: true },
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
      'watchlists',
      new TableIndex({
        name: 'idx_watchlists_type_updated_at',
        columnNames: ['type', 'updatedAt'],
      })
    );

    await queryRunner.createTable(
      new Table({
        name: 'watchlist_items',
        columns: [
          { name: 'id', type: 'char', length: '36', isPrimary: true },
          { name: 'watchlistId', type: 'char', length: '36' },
          { name: 'symbol', type: 'varchar', length: '50' },
          { name: 'regime', type: 'varchar', length: '50', isNullable: true },
          { name: 'signal', type: 'varchar', length: '100', isNullable: true },
          { name: 'aiScore', type: 'int', unsigned: true, isNullable: true },
          { name: 'change24h', type: 'double', isNullable: true },
          { name: 'volume24h', type: 'double', isNullable: true },
          { name: 'setup', type: 'varchar', length: '100', isNullable: true },
          { name: 'status', type: 'varchar', length: '30', isNullable: true },
          { name: 'alerts', type: 'int', unsigned: true, default: '0' },
          { name: 'liquidity', type: 'varchar', length: '30', isNullable: true },
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
      'watchlist_items',
      new TableIndex({
        name: 'idx_watchlist_items_watchlist_symbol',
        columnNames: ['watchlistId', 'symbol'],
      })
    );

    await queryRunner.createIndex(
      'watchlist_items',
      new TableIndex({
        name: 'idx_watchlist_items_status_updated_at',
        columnNames: ['status', 'updatedAt'],
      })
    );

    await queryRunner.createForeignKey(
      'watchlist_items',
      new TableForeignKey({
        name: 'fk_watchlist_items_watchlist_id',
        columnNames: ['watchlistId'],
        referencedTableName: 'watchlists',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropForeignKey('watchlist_items', 'fk_watchlist_items_watchlist_id');
    await queryRunner.dropIndex('watchlist_items', 'idx_watchlist_items_status_updated_at');
    await queryRunner.dropIndex('watchlist_items', 'idx_watchlist_items_watchlist_symbol');
    await queryRunner.dropTable('watchlist_items');
    await queryRunner.dropIndex('watchlists', 'idx_watchlists_type_updated_at');
    await queryRunner.dropTable('watchlists');
  }
}
