import { Service } from 'typedi';
import { MigrationInterface, QueryRunner, TableIndex } from 'typeorm';

@Service()
export class AddExchangeAssetUpdateLogCreatedAtIndex1770717000000
  implements MigrationInterface
{
  name = 'AddExchangeAssetUpdateLogCreatedAtIndex1770717000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('exchange_asset_update_logs'))) {
      return;
    }

    const table = await queryRunner.getTable('exchange_asset_update_logs');
    if (!table) {
      return;
    }

    if (!table.indices.some((index) => index.name === 'idx_exchange_asset_update_logs_created_at')) {
      await queryRunner.createIndex(
        'exchange_asset_update_logs',
        new TableIndex({
          name: 'idx_exchange_asset_update_logs_created_at',
          columnNames: ['created_at'],
        })
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('exchange_asset_update_logs'))) {
      return;
    }

    const table = await queryRunner.getTable('exchange_asset_update_logs');
    if (!table) {
      return;
    }

    if (table.indices.some((index) => index.name === 'idx_exchange_asset_update_logs_created_at')) {
      await queryRunner.dropIndex(
        'exchange_asset_update_logs',
        'idx_exchange_asset_update_logs_created_at'
      );
    }
  }
}
