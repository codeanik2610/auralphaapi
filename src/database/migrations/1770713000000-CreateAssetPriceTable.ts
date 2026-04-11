import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class CreateAssetPriceTable1770713000000 implements MigrationInterface {
  name = 'CreateAssetPriceTable1770713000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('asset_price'))) {
      await queryRunner.query(`
        CREATE TABLE IF NOT EXISTS asset_price (
          broker_asset_id char(36) NOT NULL,
          symbol varchar(100) NOT NULL,
          source_symbol varchar(100) NULL,
          price decimal(30, 12) NOT NULL,
          source varchar(30) NOT NULL,
          retrieved_at datetime NOT NULL,
          updated_at datetime NOT NULL,
          PRIMARY KEY (broker_asset_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
      `);
    }

    if (!(await this.hasIndex(queryRunner, 'asset_price', 'idx_asset_price_source_symbol'))) {
      await queryRunner.query(
        'CREATE INDEX idx_asset_price_source_symbol ON asset_price (source, symbol)'
      );
    }
    if (!(await this.hasIndex(queryRunner, 'asset_price', 'idx_asset_price_symbol'))) {
      await queryRunner.query('CREATE INDEX idx_asset_price_symbol ON asset_price (symbol)');
    }
    if (!(await this.hasIndex(queryRunner, 'asset_price', 'idx_asset_price_retrieved_at'))) {
      await queryRunner.query(
        'CREATE INDEX idx_asset_price_retrieved_at ON asset_price (retrieved_at)'
      );
    }
    if (!(await this.hasIndex(queryRunner, 'asset_price', 'idx_asset_price_updated_at'))) {
      await queryRunner.query('CREATE INDEX idx_asset_price_updated_at ON asset_price (updated_at)');
    }

    if (
      (await queryRunner.hasTable('market_prices_binance')) &&
      (await queryRunner.hasTable('broker_assets'))
    ) {
      await queryRunner.query(`
        INSERT INTO asset_price (
          broker_asset_id,
          symbol,
          source_symbol,
          price,
          source,
          retrieved_at,
          updated_at
        )
        SELECT
          ba.id AS broker_asset_id,
          UPPER(TRIM(ba.symbol)) AS symbol,
          COALESCE(NULLIF(TRIM(mp.source_symbol), ''), UPPER(TRIM(ba.symbol))) AS source_symbol,
          mp.price,
          LOWER(TRIM(ba.source)) AS source,
          mp.retrieved_at,
          mp.updated_at
        FROM market_prices_binance mp
        INNER JOIN broker_assets ba
          ON ba.id = mp.exchange_asset_id
        WHERE mp.exchange_asset_id IS NOT NULL
          AND TRIM(mp.exchange_asset_id) <> ''
        ON DUPLICATE KEY UPDATE
          symbol = VALUES(symbol),
          source_symbol = VALUES(source_symbol),
          price = VALUES(price),
          source = VALUES(source),
          retrieved_at = VALUES(retrieved_at),
          updated_at = VALUES(updated_at)
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS asset_price');
  }

  private async hasIndex(
    queryRunner: QueryRunner,
    tableName: string,
    indexName: string
  ): Promise<boolean> {
    const rows = (await queryRunner.query(
      `SHOW INDEX FROM ${tableName} WHERE Key_name = ?`,
      [indexName]
    )) as Array<{ Key_name?: string }>;
    return Array.isArray(rows) && rows.some((row) => String(row.Key_name || '') === indexName);
  }
}
