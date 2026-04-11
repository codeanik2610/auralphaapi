import { Service } from 'typedi';
import { MigrationInterface, QueryRunner, TableIndex } from 'typeorm';

@Service()
export class AddEmailDeliveryFilterIndexes1766400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createIndex(
      'email_deliveries',
      new TableIndex({
        name: 'idx_email_deliveries_channel_created_at',
        columnNames: ['channel', 'created_at'],
      })
    );

    await queryRunner.createIndex(
      'email_deliveries',
      new TableIndex({
        name: 'idx_email_deliveries_severity_created_at',
        columnNames: ['severity', 'created_at'],
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex('email_deliveries', 'idx_email_deliveries_severity_created_at');
    await queryRunner.dropIndex('email_deliveries', 'idx_email_deliveries_channel_created_at');
  }
}
