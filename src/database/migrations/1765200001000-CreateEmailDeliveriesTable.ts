import { Service } from 'typedi';
import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

@Service()
export class CreateEmailDeliveriesTable1765200001000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'email_deliveries',
        columns: [
          { name: 'id', type: 'char', length: '36', isPrimary: true },
          { name: 'user_id', type: 'varchar', length: '191' },
          { name: 'alert_id', type: 'char', length: '36', isNullable: true },
          { name: 'recipient_email', type: 'varchar', length: '191' },
          { name: 'subject', type: 'varchar', length: '255' },
          { name: 'body', type: 'text' },
          { name: 'channel', type: 'varchar', length: '50' },
          { name: 'severity', type: 'varchar', length: '20' },
          { name: 'route', type: 'varchar', length: '100', isNullable: true },
          { name: 'source', type: 'varchar', length: '100', isNullable: true },
          { name: 'status', type: 'varchar', length: '20', default: "'Queued'" },
          { name: 'attempts', type: 'int', default: 0 },
          { name: 'last_error', type: 'text', isNullable: true },
          { name: 'created_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
          {
            name: 'updated_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
            onUpdate: 'CURRENT_TIMESTAMP',
          },
        ],
      })
    );

    await queryRunner.createIndex(
      'email_deliveries',
      new TableIndex({
        name: 'idx_email_deliveries_status_created_at',
        columnNames: ['status', 'created_at'],
      })
    );

    await queryRunner.createIndex(
      'email_deliveries',
      new TableIndex({
        name: 'idx_email_deliveries_user_created_at',
        columnNames: ['user_id', 'created_at'],
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex('email_deliveries', 'idx_email_deliveries_user_created_at');
    await queryRunner.dropIndex('email_deliveries', 'idx_email_deliveries_status_created_at');
    await queryRunner.dropTable('email_deliveries');
  }
}
