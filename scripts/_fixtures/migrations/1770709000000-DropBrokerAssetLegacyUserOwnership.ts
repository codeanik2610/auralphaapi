import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class DropBrokerAssetLegacyUserOwnership1770709000000 implements MigrationInterface {
  name = 'DropBrokerAssetLegacyUserOwnership1770709000000';

  private readonly tableName = 'broker_assets';

  private readonly legacyIndexNames = [
    'uq_broker_assets_user_source_symbol',
    'uq_exchange_assets_user_source_symbol',
    'idx_broker_assets_user_symbol_name',
    'idx_exchange_assets_user_symbol_name',
    'idx_broker_assets_user_broker_id',
    'idx_exchange_assets_user_broker_id',
    'idx_broker_assets_user_exchange_id',
    'idx_exchange_assets_user_exchange_id',
  ];

  private readonly globalIndexes = [
    {
      name: 'uq_broker_assets_source_symbol',
      sql: 'CREATE UNIQUE INDEX uq_broker_assets_source_symbol ON broker_assets (source, symbol)',
    },
    {
      name: 'idx_broker_assets_source_symbol_name',
      sql: 'CREATE INDEX idx_broker_assets_source_symbol_name ON broker_assets (source, symbol, name)',
    },
    {
      name: 'idx_broker_assets_broker_id',
      sql: 'CREATE INDEX idx_broker_assets_broker_id ON broker_assets (broker_id)',
    },
    {
      name: 'idx_broker_assets_source_external_id',
      sql: 'CREATE INDEX idx_broker_assets_source_external_id ON broker_assets (source, externalId)',
    },
    {
      name: 'idx_broker_assets_source_asset_id',
      sql: 'CREATE INDEX idx_broker_assets_source_asset_id ON broker_assets (source, assetId)',
    },
  ] as const;

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable(this.tableName))) {
      return;
    }

    const hasUserId = await queryRunner.hasColumn(this.tableName, 'user_id');

    if (hasUserId) {
      await queryRunner.query(
        `INSERT INTO ${this.tableName} (id, source, externalId, name, symbol, createdAt, updatedAt, assetId, broker_id)
         SELECT UUID(),
                ranked.source,
                ranked.externalId,
                ranked.name,
                ranked.symbol,
                ranked.createdAt,
                ranked.updatedAt,
                ranked.assetId,
                ranked.broker_id
         FROM (
           SELECT id,
                  source,
                  externalId,
                  name,
                  symbol,
                  createdAt,
                  updatedAt,
                  assetId,
                  broker_id,
                  ROW_NUMBER() OVER (
                    PARTITION BY source, symbol
                    ORDER BY updatedAt DESC, createdAt DESC, id DESC
                  ) AS row_rank
           FROM ${this.tableName}
           WHERE user_id IS NOT NULL
         ) ranked
         LEFT JOIN ${this.tableName} existing
           ON existing.source = ranked.source
          AND existing.symbol = ranked.symbol
          AND existing.user_id IS NULL
         WHERE ranked.row_rank = 1
           AND existing.id IS NULL`
      );

      await queryRunner.query(
        `DELETE asset
         FROM ${this.tableName} asset
         JOIN (
           SELECT duplicate_rows.id
           FROM (
             SELECT id,
                    ROW_NUMBER() OVER (
                      PARTITION BY source, symbol
                      ORDER BY updatedAt DESC, createdAt DESC, id DESC
                    ) AS row_rank
             FROM ${this.tableName}
             WHERE user_id IS NULL
           ) duplicate_rows
           WHERE duplicate_rows.row_rank > 1
         ) duplicates
           ON duplicates.id = asset.id`
      );

      await queryRunner.query(`DELETE FROM ${this.tableName} WHERE user_id IS NOT NULL`);
    }

    for (const indexName of this.legacyIndexNames) {
      if (await this.hasIndex(queryRunner, this.tableName, indexName)) {
        await queryRunner.query(`ALTER TABLE ${this.tableName} DROP INDEX ${indexName}`);
      }
    }

    if (hasUserId) {
      await queryRunner.query(`ALTER TABLE ${this.tableName} DROP COLUMN user_id`);
    }

    for (const index of this.globalIndexes) {
      if (!(await this.hasIndex(queryRunner, this.tableName, index.name))) {
        await queryRunner.query(index.sql);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable(this.tableName))) {
      return;
    }

    for (const index of this.globalIndexes) {
      if (await this.hasIndex(queryRunner, this.tableName, index.name)) {
        await queryRunner.query(`ALTER TABLE ${this.tableName} DROP INDEX ${index.name}`);
      }
    }

    if (!(await queryRunner.hasColumn(this.tableName, 'user_id'))) {
      await queryRunner.query(`ALTER TABLE ${this.tableName} ADD COLUMN user_id char(36) NULL`);
    }

    if (!(await this.hasIndex(queryRunner, this.tableName, 'uq_broker_assets_user_source_symbol'))) {
      await queryRunner.query(
        `CREATE UNIQUE INDEX uq_broker_assets_user_source_symbol ON ${this.tableName} (user_id, source, symbol)`
      );
    }

    if (!(await this.hasIndex(queryRunner, this.tableName, 'idx_broker_assets_user_symbol_name'))) {
      await queryRunner.query(
        `CREATE INDEX idx_broker_assets_user_symbol_name ON ${this.tableName} (user_id, symbol, name)`
      );
    }
  }

  private async hasIndex(
    queryRunner: QueryRunner,
    tableName: string,
    indexName: string
  ): Promise<boolean> {
    const rows = await queryRunner.query(`SHOW INDEX FROM ${tableName} WHERE Key_name = ?`, [
      indexName,
    ]);
    return Array.isArray(rows) && rows.length > 0;
  }
}
