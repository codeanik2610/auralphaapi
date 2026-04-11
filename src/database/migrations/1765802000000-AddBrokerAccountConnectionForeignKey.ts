import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class AddBrokerAccountConnectionForeignKey1765802000000
  implements MigrationInterface
{
  private readonly foreignKeyName = 'FK_broker_accounts_connection_id';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE broker_accounts
      MODIFY COLUMN connectionId varchar(36) NOT NULL
    `);

    await queryRunner.query(`
      DELETE ba
      FROM broker_accounts ba
      LEFT JOIN connections c ON c.id = ba.connectionId
      WHERE c.id IS NULL
    `);

    if (
      !(await this.hasForeignKey(queryRunner, 'broker_accounts', this.foreignKeyName))
    ) {
      // MySQL rejects CASCADE actions here because connectionId participates in the
      // stored generated default_owner_connection_key column used for uniqueness.
      // Connection deletion already removes broker accounts first at the service layer,
      // so a restrictive FK still gives us relational integrity without breaking DDL.
      await queryRunner.query(`
        ALTER TABLE broker_accounts
        ADD CONSTRAINT ${this.foreignKeyName}
        FOREIGN KEY (connectionId)
        REFERENCES connections(id)
        ON DELETE RESTRICT
        ON UPDATE RESTRICT
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await this.hasForeignKey(queryRunner, 'broker_accounts', this.foreignKeyName)) {
      await queryRunner.query(`
        ALTER TABLE broker_accounts
        DROP FOREIGN KEY ${this.foreignKeyName}
      `);
    }

    await queryRunner.query(`
      ALTER TABLE broker_accounts
      MODIFY COLUMN connectionId char(36) NOT NULL
    `);
  }

  private async hasForeignKey(
    queryRunner: QueryRunner,
    tableName: string,
    foreignKeyName: string
  ): Promise<boolean> {
    const rows = await queryRunner.query(
      `
        SELECT 1
        FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = ?
          AND CONSTRAINT_NAME = ?
          AND CONSTRAINT_TYPE = 'FOREIGN KEY'
        LIMIT 1
      `,
      [tableName, foreignKeyName]
    );

    return Array.isArray(rows) && rows.length > 0;
  }
}
