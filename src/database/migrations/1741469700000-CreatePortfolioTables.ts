import { Service } from 'typedi';
import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
  TableIndex,
} from 'typeorm';

@Service()
export class CreatePortfolioTables1741469700000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'portfolio_snapshots',
        columns: [
          { name: 'id', type: 'char', length: '36', isPrimary: true },
          { name: 'equity', type: 'double', default: '0' },
          { name: 'dayPnL', type: 'double', default: '0' },
          { name: 'netExposure', type: 'varchar', length: '100', isNullable: true },
          { name: 'diversification', type: 'varchar', length: '100', isNullable: true },
          { name: 'assetAllocation', type: 'varchar', length: '255', isNullable: true },
          { name: 'strategyMix', type: 'varchar', length: '255', isNullable: true },
          { name: 'riskPosture', type: 'varchar', length: '255', isNullable: true },
          { name: 'accountCurve', type: 'varchar', length: '255', isNullable: true },
          { name: 'monthlyPace', type: 'varchar', length: '50', isNullable: true },
          { name: 'createdAt', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
          { name: 'updatedAt', type: 'timestamp', default: 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' },
        ],
      })
    );

    await queryRunner.createIndex(
      'portfolio_snapshots',
      new TableIndex({ name: 'idx_portfolio_snapshots_created_at', columnNames: ['createdAt'] })
    );

    await queryRunner.createTable(
      new Table({
        name: 'portfolio_holdings',
        columns: [
          { name: 'id', type: 'char', length: '36', isPrimary: true },
          { name: 'snapshotId', type: 'char', length: '36' },
          { name: 'symbol', type: 'varchar', length: '50' },
          { name: 'quantity', type: 'double', default: '0' },
          { name: 'marketValue', type: 'double', default: '0' },
          { name: 'allocationPct', type: 'double', default: '0' },
          { name: 'dayPnL', type: 'double', default: '0' },
          { name: 'unrealizedPnL', type: 'double', default: '0' },
          { name: 'side', type: 'varchar', length: '20' },
          { name: 'strategy', type: 'varchar', length: '255' },
          { name: 'riskState', type: 'varchar', length: '50' },
          { name: 'sleeve', type: 'varchar', length: '50' },
          { name: 'contribution', type: 'varchar', length: '255', isNullable: true },
          { name: 'lastRebalanceAt', type: 'timestamp', isNullable: true },
          { name: 'createdAt', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
          { name: 'updatedAt', type: 'timestamp', default: 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' },
        ],
      })
    );

    await queryRunner.createIndex(
      'portfolio_holdings',
      new TableIndex({ name: 'idx_portfolio_holdings_snapshot_symbol', columnNames: ['snapshotId', 'symbol'] })
    );

    await queryRunner.createIndex(
      'portfolio_holdings',
      new TableIndex({ name: 'idx_portfolio_holdings_sleeve_updated_at', columnNames: ['sleeve', 'updatedAt'] })
    );

    await queryRunner.createForeignKey(
      'portfolio_holdings',
      new TableForeignKey({
        name: 'fk_portfolio_holdings_snapshot_id',
        columnNames: ['snapshotId'],
        referencedTableName: 'portfolio_snapshots',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropForeignKey('portfolio_holdings', 'fk_portfolio_holdings_snapshot_id');
    await queryRunner.dropIndex('portfolio_holdings', 'idx_portfolio_holdings_sleeve_updated_at');
    await queryRunner.dropIndex('portfolio_holdings', 'idx_portfolio_holdings_snapshot_symbol');
    await queryRunner.dropTable('portfolio_holdings');
    await queryRunner.dropIndex('portfolio_snapshots', 'idx_portfolio_snapshots_created_at');
    await queryRunner.dropTable('portfolio_snapshots');
  }
}
