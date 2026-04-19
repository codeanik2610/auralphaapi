import { Service } from 'typedi';
import { MigrationInterface, QueryRunner, TableColumn, TableIndex } from 'typeorm';

@Service()
export class AddOrderSubmissionExecutionSafety1800001000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('order_submission_requests'))) {
      return;
    }

    await this.addColumnIfMissing(
      queryRunner,
      new TableColumn({
        name: 'suggested_trade_id',
        type: 'char',
        length: '36',
        isNullable: true,
      })
    );
    await this.addColumnIfMissing(
      queryRunner,
      new TableColumn({
        name: 'request_json',
        type: 'json',
        isNullable: true,
      })
    );
    await this.addColumnIfMissing(
      queryRunner,
      new TableColumn({
        name: 'placement_state',
        type: 'varchar',
        length: '32',
        default: "'registered'",
      })
    );
    await this.addColumnIfMissing(
      queryRunner,
      new TableColumn({
        name: 'broker_order_id',
        type: 'varchar',
        length: '191',
        isNullable: true,
      })
    );
    await this.addColumnIfMissing(
      queryRunner,
      new TableColumn({
        name: 'broker_order_status',
        type: 'varchar',
        length: '64',
        isNullable: true,
      })
    );
    await this.addColumnIfMissing(
      queryRunner,
      new TableColumn({
        name: 'reconciliation_state',
        type: 'varchar',
        length: '32',
        default: "'not_required'",
      })
    );
    await this.addColumnIfMissing(
      queryRunner,
      new TableColumn({
        name: 'lifecycle_json',
        type: 'json',
        isNullable: true,
      })
    );

    const table = await queryRunner.getTable('order_submission_requests');
    const hasIndex = table?.indices.some(
      (index) => index.name === 'idx_order_submission_requests_suggested_trade'
    );
    if (!hasIndex) {
      await queryRunner.createIndex(
        'order_submission_requests',
        new TableIndex({
          name: 'idx_order_submission_requests_suggested_trade',
          columnNames: ['user_id', 'suggested_trade_id', 'created_at'],
        })
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('order_submission_requests'))) {
      return;
    }

    const table = await queryRunner.getTable('order_submission_requests');
    const index = table?.indices.find(
      (candidate) => candidate.name === 'idx_order_submission_requests_suggested_trade'
    );
    if (index) {
      await queryRunner.dropIndex('order_submission_requests', index);
    }

    for (const columnName of [
      'lifecycle_json',
      'reconciliation_state',
      'broker_order_status',
      'broker_order_id',
      'placement_state',
      'request_json',
      'suggested_trade_id',
    ]) {
      if (await queryRunner.hasColumn('order_submission_requests', columnName)) {
        await queryRunner.dropColumn('order_submission_requests', columnName);
      }
    }
  }

  private async addColumnIfMissing(
    queryRunner: QueryRunner,
    column: TableColumn
  ): Promise<void> {
    if (!(await queryRunner.hasColumn('order_submission_requests', column.name))) {
      await queryRunner.addColumn('order_submission_requests', column);
    }
  }
}
