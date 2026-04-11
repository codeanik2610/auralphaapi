import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class ConvertBrokerAccountSettingsToJson1765801000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasColumn('broker_accounts', 'settings')) {
      await queryRunner.query(
        'ALTER TABLE broker_accounts MODIFY COLUMN settings JSON NULL'
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasColumn('broker_accounts', 'settings')) {
      await queryRunner.query(
        'ALTER TABLE broker_accounts MODIFY COLUMN settings TEXT NULL'
      );
    }
  }
}
