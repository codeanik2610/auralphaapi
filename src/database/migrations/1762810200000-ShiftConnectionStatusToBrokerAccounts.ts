import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class ShiftConnectionStatusToBrokerAccounts1762810200000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "UPDATE broker_accounts SET status = 'Idle' WHERE status IS NULL OR TRIM(status) = '' OR LOWER(status) = 'watch'"
    );
    await queryRunner.query(
      "UPDATE broker_accounts SET status = 'Connected' WHERE LOWER(status) = 'active'"
    );
    await queryRunner.query(
      "UPDATE broker_accounts SET status = 'Disconnected' WHERE LOWER(status) IN ('inactive', 'failed', 'error')"
    );

    if (await this.hasIndex(queryRunner, 'connections', 'idx_connections_user_status_updated_at')) {
      await queryRunner.query(
        'DROP INDEX idx_connections_user_status_updated_at ON connections'
      );
    }

    if (await this.hasIndex(queryRunner, 'connections', 'uidx_connections_user_broker_key')) {
      await queryRunner.query(
        'DROP INDEX uidx_connections_user_broker_key ON connections'
      );
    }

    if (await queryRunner.hasColumn('connections', 'status')) {
      await queryRunner.query('ALTER TABLE connections DROP COLUMN status');
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasColumn('connections', 'status'))) {
      await queryRunner.query(
        "ALTER TABLE connections ADD COLUMN status varchar(30) NOT NULL DEFAULT 'Idle'"
      );
    }

    if (!(await this.hasIndex(queryRunner, 'connections', 'idx_connections_user_status_updated_at'))) {
      await queryRunner.query(
        'CREATE INDEX idx_connections_user_status_updated_at ON connections (user_id, status, updatedAt)'
      );
    }

    if (!(await this.hasIndex(queryRunner, 'connections', 'uidx_connections_user_broker_key'))) {
      await queryRunner.query(
        'CREATE UNIQUE INDEX uidx_connections_user_broker_key ON connections (user_id, brokerKey)'
      );
    }
  }

  private async hasIndex(
    queryRunner: QueryRunner,
    tableName: string,
    indexName: string
  ): Promise<boolean> {
    const table = await queryRunner.getTable(tableName);
    return Boolean(table?.indices.find((index) => index.name === indexName));
  }
}
