import { Service } from 'typedi';
import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

@Service()
export class AddSettingsToBrokerAccounts1741478700000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasSettings = await queryRunner.hasColumn('broker_accounts', 'settings');
    if (!hasSettings) {
      await queryRunner.addColumn(
        'broker_accounts',
        new TableColumn({
          name: 'settings',
          type: 'text',
          isNullable: true,
        })
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const hasSettings = await queryRunner.hasColumn('broker_accounts', 'settings');
    if (hasSettings) {
      await queryRunner.dropColumn('broker_accounts', 'settings');
    }
  }
}
