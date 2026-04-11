import { Service } from 'typedi';
import { MigrationInterface, QueryRunner, Table, TableIndex, TableUnique } from 'typeorm';

@Service()
export class CreateOrderSubmissionRequests1770702000000 implements MigrationInterface {
  name = 'CreateOrderSubmissionRequests1770702000000';

  private readonly unique = new TableUnique({
    name: 'uq_order_submission_requests_user_key',
    columnNames: ['user_id', 'idempotency_key'],
  });

  private readonly indexes = [
    new TableIndex({
      name: 'idx_order_submission_requests_user_status_updated_at',
      columnNames: ['user_id', 'status', 'updated_at'],
    }),
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('order_submission_requests'))) {
      await queryRunner.createTable(
        new Table({
          name: 'order_submission_requests',
          columns: [
            { name: 'id', type: 'char', length: '36', isPrimary: true },
            { name: 'user_id', type: 'char', length: '36' },
            { name: 'idempotency_key', type: 'varchar', length: '191' },
            { name: 'request_hash', type: 'char', length: '64' },
            { name: 'execution_mode', type: 'varchar', length: '32' },
            { name: 'asset_id', type: 'varchar', length: '191' },
            { name: 'broker_key', type: 'varchar', length: '100', isNullable: true },
            { name: 'account_id', type: 'char', length: '36', isNullable: true },
            { name: 'status', type: 'varchar', length: '32', default: "'in_progress'" },
            { name: 'response_json', type: 'json', isNullable: true },
            { name: 'error_json', type: 'json', isNullable: true },
            { name: 'completed_at', type: 'timestamp', isNullable: true },
            { name: 'failed_at', type: 'timestamp', isNullable: true },
            { name: 'created_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
            {
              name: 'updated_at',
              type: 'timestamp',
              default: 'CURRENT_TIMESTAMP',
              onUpdate: 'CURRENT_TIMESTAMP',
            },
          ],
          uniques: [this.unique],
        })
      );
    }

    for (const index of this.indexes) {
      const table = await queryRunner.getTable('order_submission_requests');
      if (table && !table.indices.some((current) => current.name === index.name)) {
        await queryRunner.createIndex('order_submission_requests', index);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('order_submission_requests'))) {
      return;
    }

    for (const index of [...this.indexes].reverse()) {
      if (index.name) {
        await queryRunner.dropIndex('order_submission_requests', index.name);
      }
    }

    const table = await queryRunner.getTable('order_submission_requests');
    if (table) {
      const unique = table.uniques.find(
        (current) => current.name === this.unique.name
      );
      if (unique) {
        await queryRunner.dropUniqueConstraint('order_submission_requests', unique);
      }
    }

    await queryRunner.dropTable('order_submission_requests');
  }
}
