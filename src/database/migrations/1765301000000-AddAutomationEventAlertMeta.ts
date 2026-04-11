import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';
import { Service } from 'typedi';

@Service()
export class AddAutomationEventAlertMeta1765301000000 implements MigrationInterface {
  name = 'AddAutomationEventAlertMeta1765301000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('automation_events')) {
      const hasEventMeta = await queryRunner.hasColumn('automation_events', 'meta_json');
      if (!hasEventMeta) {
        await queryRunner.addColumn(
          'automation_events',
          new TableColumn({
            name: 'meta_json',
            type: 'text',
            isNullable: true,
          })
        );
      }
    }

    if (await queryRunner.hasTable('automation_alerts')) {
      const hasAlertMeta = await queryRunner.hasColumn('automation_alerts', 'meta_json');
      if (!hasAlertMeta) {
        await queryRunner.addColumn(
          'automation_alerts',
          new TableColumn({
            name: 'meta_json',
            type: 'text',
            isNullable: true,
          })
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('automation_alerts')) {
      const hasAlertMeta = await queryRunner.hasColumn('automation_alerts', 'meta_json');
      if (hasAlertMeta) {
        await queryRunner.dropColumn('automation_alerts', 'meta_json');
      }
    }

    if (await queryRunner.hasTable('automation_events')) {
      const hasEventMeta = await queryRunner.hasColumn('automation_events', 'meta_json');
      if (hasEventMeta) {
        await queryRunner.dropColumn('automation_events', 'meta_json');
      }
    }
  }
}
