import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class DropLegacyMarketPricesBinanceTable1770714000000 implements MigrationInterface {
  name = 'DropLegacyMarketPricesBinanceTable1770714000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('market_prices_binance'))) {
      return;
    }

    if (!(await queryRunner.hasTable('asset_price'))) {
      throw new Error('asset_price must exist before dropping market_prices_binance');
    }

    if (await queryRunner.hasTable('broker_assets')) {
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

    await queryRunner.query('DROP TABLE IF EXISTS market_prices_binance');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('market_prices_binance'))) {
      await queryRunner.query(`
        CREATE TABLE IF NOT EXISTS market_prices_binance (
          symbol varchar(50) NOT NULL,
          source_symbol varchar(50) NULL,
          price decimal(30, 12) NOT NULL,
          source varchar(30) NOT NULL DEFAULT 'binance',
          retrieved_at datetime NOT NULL,
          updated_at datetime NOT NULL,
          exchange_asset_id varchar(64) NULL,
          PRIMARY KEY (symbol)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
      `);
    }

    if (
      !(await queryRunner.hasTable('asset_price')) ||
      !(await queryRunner.hasTable('broker_assets'))
    ) {
      return;
    }

    await queryRunner.query(`
      INSERT INTO market_prices_binance (
        symbol,
        source_symbol,
        price,
        source,
        retrieved_at,
        updated_at,
        exchange_asset_id
      )
      SELECT
        ranked.symbol,
        ranked.source_symbol,
        ranked.price,
        ranked.source,
        ranked.retrieved_at,
        ranked.updated_at,
        ranked.exchange_asset_id
      FROM (
        SELECT
          UPPER(TRIM(ap.symbol)) AS symbol,
          COALESCE(NULLIF(TRIM(ap.source_symbol), ''), UPPER(TRIM(ap.symbol))) AS source_symbol,
          ap.price AS price,
          LOWER(TRIM(ap.source)) AS source,
          ap.retrieved_at AS retrieved_at,
          ap.updated_at AS updated_at,
          ba.id AS exchange_asset_id,
          ROW_NUMBER() OVER (
            PARTITION BY UPPER(TRIM(ap.symbol))
            ORDER BY ap.updated_at DESC, ap.retrieved_at DESC, ba.id ASC
          ) AS row_number
        FROM asset_price ap
        INNER JOIN broker_assets ba
          ON ba.id = ap.broker_asset_id
      ) ranked
      WHERE ranked.row_number = 1
      ON DUPLICATE KEY UPDATE
        source_symbol = VALUES(source_symbol),
        price = VALUES(price),
        source = VALUES(source),
        retrieved_at = VALUES(retrieved_at),
        updated_at = VALUES(updated_at),
        exchange_asset_id = VALUES(exchange_asset_id)
    `);
  }
}
