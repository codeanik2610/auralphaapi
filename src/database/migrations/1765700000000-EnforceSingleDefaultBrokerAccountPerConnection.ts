import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class EnforceSingleDefaultBrokerAccountPerConnection1765700000000
  implements MigrationInterface
{
  name = 'EnforceSingleDefaultBrokerAccountPerConnection1765700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('broker_accounts'))) {
      return;
    }

    await this.normalizeDefaults(queryRunner);

    if (!(await queryRunner.hasColumn('broker_accounts', 'default_owner_connection_key'))) {
      const ownerExpression = (await queryRunner.hasColumn('broker_accounts', 'user_id'))
        ? "COALESCE(`user_id`, '__system__')"
        : "'__system__'";

      await queryRunner.query(
        `ALTER TABLE broker_accounts
         ADD COLUMN default_owner_connection_key varchar(120)
         GENERATED ALWAYS AS (
           CASE
             WHEN isDefault = 1 THEN CONCAT(${ownerExpression}, '::', connectionId)
             ELSE NULL
           END
         ) STORED`
      );
    }

    if (
      !(await this.hasIndex(
        queryRunner,
        'broker_accounts',
        'uidx_broker_accounts_default_owner_connection'
      ))
    ) {
      await queryRunner.query(
        `CREATE UNIQUE INDEX uidx_broker_accounts_default_owner_connection
         ON broker_accounts (default_owner_connection_key)`
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('broker_accounts'))) {
      return;
    }

    if (
      await this.hasIndex(
        queryRunner,
        'broker_accounts',
        'uidx_broker_accounts_default_owner_connection'
      )
    ) {
      await queryRunner.query(
        'DROP INDEX uidx_broker_accounts_default_owner_connection ON broker_accounts'
      );
    }

    if (await queryRunner.hasColumn('broker_accounts', 'default_owner_connection_key')) {
      await queryRunner.query(
        'ALTER TABLE broker_accounts DROP COLUMN default_owner_connection_key'
      );
    }
  }

  private async normalizeDefaults(queryRunner: QueryRunner): Promise<void> {
    const hasUserId = await queryRunner.hasColumn('broker_accounts', 'user_id');
    const ownerExpression = hasUserId
      ? "COALESCE(`user_id`, '__system__')"
      : "'__system__'";

    await queryRunner.query('DROP TEMPORARY TABLE IF EXISTS tmp_broker_account_default_rank');
    await queryRunner.query(
      `CREATE TEMPORARY TABLE tmp_broker_account_default_rank AS
       SELECT
         id,
         ROW_NUMBER() OVER (
           PARTITION BY ${ownerExpression}, connectionId
           ORDER BY isDefault DESC, updatedAt DESC, createdAt DESC, id DESC
         ) AS row_num
       FROM broker_accounts`
    );

    await queryRunner.query(
      `UPDATE broker_accounts account
       JOIN tmp_broker_account_default_rank ranked ON ranked.id = account.id
       SET account.isDefault = CASE WHEN ranked.row_num = 1 THEN 1 ELSE 0 END`
    );

    await queryRunner.query('DROP TEMPORARY TABLE IF EXISTS tmp_broker_account_default_rank');
  }

  private async hasIndex(
    queryRunner: QueryRunner,
    tableName: string,
    indexName: string
  ): Promise<boolean> {
    const result = await queryRunner.query(`SHOW INDEX FROM ${tableName} WHERE Key_name = ?`, [
      indexName,
    ]);

    return Array.isArray(result) && result.length > 0;
  }
}
