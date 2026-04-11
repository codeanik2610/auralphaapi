import { Service } from 'typedi';
import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

@Service()
export class AddAutomationConfig1764300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasColumn = await queryRunner.hasColumn('automations', 'config');
    if (!hasColumn) {
      await queryRunner.addColumn(
        'automations',
        new TableColumn({ name: 'config', type: 'json', isNullable: true })
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const hasColumn = await queryRunner.hasColumn('automations', 'config');
    if (hasColumn) {
      await queryRunner.dropColumn('automations', 'config');
    }
  }
}
