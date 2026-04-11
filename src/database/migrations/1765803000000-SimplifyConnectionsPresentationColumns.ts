import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class SimplifyConnectionsPresentationColumns1765803000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('connections'))) {
      return;
    }

    const hasDiagnosticSummary = await queryRunner.hasColumn(
      'connections',
      'diagnosticSummary'
    );
    const hasSync = await queryRunner.hasColumn('connections', 'sync');

    if (!hasDiagnosticSummary && hasSync) {
      await queryRunner.query(
        'ALTER TABLE connections CHANGE COLUMN sync diagnosticSummary varchar(255) NULL'
      );
    }

    await this.dropColumnIfExists(queryRunner, 'connections', 'markets');
    await this.dropColumnIfExists(queryRunner, 'connections', 'capabilities');
    await this.dropColumnIfExists(queryRunner, 'connections', 'auth');
    await this.dropColumnIfExists(queryRunner, 'connections', 'authMode');
    await this.dropColumnIfExists(queryRunner, 'connections', 'limitation');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('connections'))) {
      return;
    }

    await this.addColumnIfMissing(
      queryRunner,
      'connections',
      'markets',
      'ALTER TABLE connections ADD COLUMN markets varchar(255) NULL'
    );
    await this.addColumnIfMissing(
      queryRunner,
      'connections',
      'capabilities',
      'ALTER TABLE connections ADD COLUMN capabilities varchar(255) NULL'
    );
    await this.addColumnIfMissing(
      queryRunner,
      'connections',
      'auth',
      'ALTER TABLE connections ADD COLUMN auth varchar(100) NULL'
    );
    await this.addColumnIfMissing(
      queryRunner,
      'connections',
      'authMode',
      'ALTER TABLE connections ADD COLUMN authMode varchar(100) NULL'
    );
    await this.addColumnIfMissing(
      queryRunner,
      'connections',
      'limitation',
      'ALTER TABLE connections ADD COLUMN limitation varchar(255) NULL'
    );

    const hasDiagnosticSummary = await queryRunner.hasColumn(
      'connections',
      'diagnosticSummary'
    );
    const hasSync = await queryRunner.hasColumn('connections', 'sync');

    if (hasDiagnosticSummary && !hasSync) {
      await queryRunner.query(
        'ALTER TABLE connections CHANGE COLUMN diagnosticSummary sync varchar(255) NULL'
      );
    }
  }

  private async dropColumnIfExists(
    queryRunner: QueryRunner,
    tableName: string,
    columnName: string
  ): Promise<void> {
    if (await queryRunner.hasColumn(tableName, columnName)) {
      await queryRunner.query(`ALTER TABLE ${tableName} DROP COLUMN ${columnName}`);
    }
  }

  private async addColumnIfMissing(
    queryRunner: QueryRunner,
    tableName: string,
    columnName: string,
    statement: string
  ): Promise<void> {
    if (!(await queryRunner.hasColumn(tableName, columnName))) {
      await queryRunner.query(statement);
    }
  }
}
