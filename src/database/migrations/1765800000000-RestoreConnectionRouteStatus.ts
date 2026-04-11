import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class RestoreConnectionRouteStatus1765800000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasColumn('connections', 'status'))) {
      await queryRunner.query(
        "ALTER TABLE connections ADD COLUMN status varchar(30) NOT NULL DEFAULT 'Idle' AFTER type"
      );
    }

    await queryRunner.query(`
      UPDATE connections c
      SET c.status = CASE
        WHEN EXISTS (
          SELECT 1
          FROM broker_accounts ba
          WHERE ba.connectionId = c.id
            AND (ba.user_id <=> c.user_id)
            AND LOWER(ba.status) = 'connected'
        ) THEN 'Connected'
        WHEN EXISTS (
          SELECT 1
          FROM broker_accounts ba
          WHERE ba.connectionId = c.id
            AND (ba.user_id <=> c.user_id)
            AND LOWER(ba.status) IN ('disconnected', 'failed', 'error')
        ) THEN 'Disconnected'
        ELSE 'Idle'
      END
    `);

    if (!(await this.hasIndex(queryRunner, 'connections', 'idx_connections_user_status_updated_at'))) {
      await queryRunner.query(
        'CREATE INDEX idx_connections_user_status_updated_at ON connections (user_id, status, updatedAt)'
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await this.hasIndex(queryRunner, 'connections', 'idx_connections_user_status_updated_at')) {
      await queryRunner.query(
        'DROP INDEX idx_connections_user_status_updated_at ON connections'
      );
    }

    if (await queryRunner.hasColumn('connections', 'status')) {
      await queryRunner.query('ALTER TABLE connections DROP COLUMN status');
    }
  }

  private async hasIndex(
    queryRunner: QueryRunner,
    tableName: string,
    indexName: string
  ): Promise<boolean> {
    const rows = await queryRunner.query(
      `
        SELECT 1
        FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = ?
          AND INDEX_NAME = ?
        LIMIT 1
      `,
      [tableName, indexName]
    );

    return Array.isArray(rows) && rows.length > 0;
  }
}
