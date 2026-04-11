import { Service } from 'typedi';
import { MigrationInterface, QueryRunner, TableIndex } from 'typeorm';

@Service()
export class AddEmailDeliveryOperationalIndexes1765805000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createIndex(
      'email_deliveries',
      new TableIndex({
        name: 'idx_email_deliveries_status_updated_at',
        columnNames: ['status', 'updated_at'],
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex('email_deliveries', 'idx_email_deliveries_status_updated_at');
  }
}
