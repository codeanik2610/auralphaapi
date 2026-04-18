import { Service } from 'typedi';
import { MigrationInterface, QueryRunner, Table } from 'typeorm';

@Service()
export class CreateAppSettingsTable1741474200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('app_settings');

    if (hasTable) {
      return;
    }

    await queryRunner.createTable(
      new Table({
        name: 'app_settings',
        columns: [
          {
            name: 'id',
            type: 'int',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          { name: 'notifyEmail', type: 'boolean', default: 1 },
          { name: 'notifyInApp', type: 'boolean', default: 1 },
          { name: 'confirmDestructive', type: 'boolean', default: 1 },
          { name: 'createdAt', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
          { name: 'updatedAt', type: 'timestamp', default: 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' },
        ],
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('app_settings');

    if (!hasTable) {
      return;
    }

    await queryRunner.dropTable('app_settings');
  }
}
