import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class HardenWatchlistIntegrity1767300008000 implements MigrationInterface {
  name = 'HardenWatchlistIntegrity1767300008000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (
      !(await queryRunner.hasTable('watchlists')) ||
      !(await queryRunner.hasTable('watchlist_items'))
    ) {
      return;
    }

    await this.assertOwnershipColumns(queryRunner);
    await this.normalizeData(queryRunner);
    await this.ensureNormalizedNameColumn(queryRunner);
    await this.assertNoBlankNames(queryRunner);
    await this.assertNoBlankSymbols(queryRunner);
    await this.assertNoDuplicateWatchlistNames(queryRunner);
    await this.assertNoDuplicateWatchlistItems(queryRunner);

    if (!(await this.hasIndex(queryRunner, 'watchlists', 'idx_watchlists_user_updated_at'))) {
      await queryRunner.query(
        'CREATE INDEX idx_watchlists_user_updated_at ON watchlists (user_id, updatedAt)'
      );
    }

    if (!(await this.hasIndex(queryRunner, 'watchlists', 'uidx_watchlists_id_user_id'))) {
      await queryRunner.query(
        'CREATE UNIQUE INDEX uidx_watchlists_id_user_id ON watchlists (id, user_id)'
      );
    }

    if (!(await this.hasIndex(queryRunner, 'watchlists', 'uidx_watchlists_owner_name_ci'))) {
      await queryRunner.query(
        'CREATE UNIQUE INDEX uidx_watchlists_owner_name_ci ON watchlists (user_id, normalized_name)'
      );
    }

    if (
      !(await this.hasIndex(
        queryRunner,
        'watchlist_items',
        'idx_watchlist_items_user_watchlist_updated_at'
      ))
    ) {
      await queryRunner.query(
        'CREATE INDEX idx_watchlist_items_user_watchlist_updated_at ON watchlist_items (user_id, watchlistId, updatedAt)'
      );
    }

    if (
      !(await this.hasIndex(
        queryRunner,
        'watchlist_items',
        'uidx_watchlist_items_owner_watchlist_symbol'
      ))
    ) {
      await queryRunner.query(
        'CREATE UNIQUE INDEX uidx_watchlist_items_owner_watchlist_symbol ON watchlist_items (user_id, watchlistId, symbol)'
      );
    }

    if (
      !(await this.hasForeignKey(
        queryRunner,
        'watchlist_items',
        'fk_watchlist_items_watchlist_owner'
      ))
    ) {
      await queryRunner.query(
        `ALTER TABLE watchlist_items
         ADD CONSTRAINT fk_watchlist_items_watchlist_owner
         FOREIGN KEY (watchlistId, user_id)
         REFERENCES watchlists (id, user_id)
         ON DELETE CASCADE`
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('watchlist_items'))) {
      return;
    }

    if (
      await this.hasForeignKey(
        queryRunner,
        'watchlist_items',
        'fk_watchlist_items_watchlist_owner'
      )
    ) {
      await queryRunner.query(
        'ALTER TABLE watchlist_items DROP FOREIGN KEY fk_watchlist_items_watchlist_owner'
      );
    }

    if (
      await this.hasIndex(
        queryRunner,
        'watchlist_items',
        'uidx_watchlist_items_owner_watchlist_symbol'
      )
    ) {
      await queryRunner.query(
        'DROP INDEX uidx_watchlist_items_owner_watchlist_symbol ON watchlist_items'
      );
    }

    if (
      await this.hasIndex(
        queryRunner,
        'watchlist_items',
        'idx_watchlist_items_user_watchlist_updated_at'
      )
    ) {
      await queryRunner.query(
        'DROP INDEX idx_watchlist_items_user_watchlist_updated_at ON watchlist_items'
      );
    }

    if (!(await queryRunner.hasTable('watchlists'))) {
      return;
    }

    if (await this.hasIndex(queryRunner, 'watchlists', 'uidx_watchlists_owner_name_ci')) {
      await queryRunner.query('DROP INDEX uidx_watchlists_owner_name_ci ON watchlists');
    }

    if (await this.hasIndex(queryRunner, 'watchlists', 'uidx_watchlists_id_user_id')) {
      await queryRunner.query('DROP INDEX uidx_watchlists_id_user_id ON watchlists');
    }

    if (await this.hasIndex(queryRunner, 'watchlists', 'idx_watchlists_user_updated_at')) {
      await queryRunner.query('DROP INDEX idx_watchlists_user_updated_at ON watchlists');
    }

    if (await queryRunner.hasColumn('watchlists', 'normalized_name')) {
      await queryRunner.query('ALTER TABLE watchlists DROP COLUMN normalized_name');
    }
  }

  private async assertOwnershipColumns(queryRunner: QueryRunner): Promise<void> {
    const watchlistsHasUserId = await queryRunner.hasColumn('watchlists', 'user_id');
    const watchlistItemsHasUserId = await queryRunner.hasColumn('watchlist_items', 'user_id');

    if (!watchlistsHasUserId || !watchlistItemsHasUserId) {
      throw new Error(
        'Cannot harden watchlist integrity because watchlists ownership columns are missing. Run the ownership migrations first.'
      );
    }
  }

  private async normalizeData(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE watchlists
       SET name = TRIM(name)
       WHERE name IS NOT NULL AND name <> TRIM(name)`
    );

    await queryRunner.query(
      `UPDATE watchlist_items
       SET symbol = UPPER(TRIM(symbol))
       WHERE symbol IS NOT NULL AND symbol <> UPPER(TRIM(symbol))`
    );

    await queryRunner.query(
      `UPDATE watchlist_items item
       JOIN watchlists watchlist ON watchlist.id = item.watchlistId
       SET item.user_id = watchlist.user_id
       WHERE item.user_id <> watchlist.user_id OR item.user_id IS NULL`
    );
  }

  private async ensureNormalizedNameColumn(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasColumn('watchlists', 'normalized_name')) {
      return;
    }

    await queryRunner.query(
      `ALTER TABLE watchlists
       ADD COLUMN normalized_name varchar(255)
       GENERATED ALWAYS AS (NULLIF(LOWER(TRIM(name)), '')) STORED`
    );
  }

  private async assertNoBlankNames(queryRunner: QueryRunner): Promise<void> {
    const rows = await queryRunner.query(
      `
        SELECT id
        FROM watchlists
        WHERE TRIM(COALESCE(name, '')) = ''
        LIMIT 5
      `
    );

    if (rows.length) {
      const ids = rows.map((row: { id?: string }) => row.id || '<unknown>').join(', ');
      throw new Error(
        `Cannot harden watchlist integrity because blank watchlist names already exist: ${ids}`
      );
    }
  }

  private async assertNoBlankSymbols(queryRunner: QueryRunner): Promise<void> {
    const rows = await queryRunner.query(
      `
        SELECT id
        FROM watchlist_items
        WHERE TRIM(COALESCE(symbol, '')) = ''
        LIMIT 5
      `
    );

    if (rows.length) {
      const ids = rows.map((row: { id?: string }) => row.id || '<unknown>').join(', ');
      throw new Error(
        `Cannot harden watchlist integrity because blank watchlist symbols already exist: ${ids}`
      );
    }
  }

  private async assertNoDuplicateWatchlistNames(queryRunner: QueryRunner): Promise<void> {
    const duplicateRows = await queryRunner.query(
      `
        SELECT user_id, normalized_name, COUNT(*) AS duplicate_count
        FROM watchlists
        GROUP BY user_id, normalized_name
        HAVING normalized_name IS NOT NULL AND duplicate_count > 1
        LIMIT 5
      `
    );

    if (duplicateRows.length) {
      const names = duplicateRows
        .map(
          (row: { user_id?: string; normalized_name?: string }) =>
            `${row.user_id || '<unknown>'}:${row.normalized_name || '<blank>'}`
        )
        .join(', ');
      throw new Error(
        `Cannot add unique watchlist name integrity because duplicate owner-scoped names already exist: ${names}`
      );
    }
  }

  private async assertNoDuplicateWatchlistItems(queryRunner: QueryRunner): Promise<void> {
    const duplicateRows = await queryRunner.query(
      `
        SELECT user_id, watchlistId, symbol, COUNT(*) AS duplicate_count
        FROM watchlist_items
        GROUP BY user_id, watchlistId, symbol
        HAVING symbol <> '' AND duplicate_count > 1
        LIMIT 5
      `
    );

    if (duplicateRows.length) {
      const rows = duplicateRows
        .map(
          (row: { user_id?: string; watchlistId?: string; symbol?: string }) =>
            `${row.user_id || '<unknown>'}:${row.watchlistId || '<unknown>'}:${row.symbol || '<blank>'}`
        )
        .join(', ');
      throw new Error(
        `Cannot add unique watchlist symbol integrity because duplicate owner-scoped watchlist symbols already exist: ${rows}`
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

  private async hasForeignKey(
    queryRunner: QueryRunner,
    tableName: string,
    foreignKeyName: string
  ): Promise<boolean> {
    const rows = await queryRunner.query(
      `SELECT CONSTRAINT_NAME
       FROM information_schema.TABLE_CONSTRAINTS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = ?
         AND CONSTRAINT_TYPE = 'FOREIGN KEY'
         AND CONSTRAINT_NAME = ?`,
      [tableName, foreignKeyName]
    );

    return Array.isArray(rows) && rows.length > 0;
  }
}
