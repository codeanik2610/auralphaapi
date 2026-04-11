import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class ConvertBrokerMetadataToJsonColumns1765601000000 implements MigrationInterface {
  name = 'ConvertBrokerMetadataToJsonColumns1765601000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.normalizeJsonColumn(queryRunner, 'capabilities', '[]');
    await this.normalizeJsonColumn(queryRunner, 'account_config', '{"fields":[]}');
    await this.normalizeJsonColumn(queryRunner, 'integration_guide', '{}');
    await this.normalizeJsonColumn(queryRunner, 'diagnostics_config', '{}');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await this.revertJsonColumn(queryRunner, 'capabilities');
    await this.revertJsonColumn(queryRunner, 'account_config');
    await this.revertJsonColumn(queryRunner, 'integration_guide');
    await this.revertJsonColumn(queryRunner, 'diagnostics_config');
  }

  private async normalizeJsonColumn(
    queryRunner: QueryRunner,
    columnName: string,
    invalidFallback: string
  ): Promise<void> {
    if (!(await queryRunner.hasColumn('brokers', columnName))) {
      return;
    }

    await queryRunner.query(
      `UPDATE brokers
       SET ${columnName} = NULL
       WHERE ${columnName} IS NOT NULL
         AND TRIM(CAST(${columnName} AS CHAR)) = ''`
    );

    await queryRunner.query(
      `UPDATE brokers
       SET ${columnName} = ?
       WHERE ${columnName} IS NOT NULL
         AND JSON_VALID(${columnName}) = 0`,
      [invalidFallback]
    );

    await queryRunner.query(`ALTER TABLE brokers MODIFY COLUMN ${columnName} JSON NULL`);
  }

  private async revertJsonColumn(queryRunner: QueryRunner, columnName: string): Promise<void> {
    if (!(await queryRunner.hasColumn('brokers', columnName))) {
      return;
    }

    await queryRunner.query(`ALTER TABLE brokers MODIFY COLUMN ${columnName} text NULL`);
  }
}
