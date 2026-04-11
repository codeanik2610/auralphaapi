import { Service } from 'typedi';
import {
  MigrationInterface,
  QueryRunner,
  TableColumn,
  TableIndex,
} from 'typeorm';

@Service()
export class AddSignalsUserOwnership1765306000000 implements MigrationInterface {
  name = 'AddSignalsUserOwnership1765306000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('signals'))) {
      return;
    }

    if (!(await queryRunner.hasColumn('signals', 'user_id'))) {
      await queryRunner.addColumn(
        'signals',
        new TableColumn({
          name: 'user_id',
          type: 'varchar',
          length: '191',
          isNullable: true,
        })
      );
    }

    await queryRunner.query(`
      UPDATE signals s
      INNER JOIN (
        SELECT CASE WHEN COUNT(*) = 1 THEN MIN(id) ELSE NULL END AS singleton_user_id
        FROM users
      ) singleton_user
        ON singleton_user.singleton_user_id IS NOT NULL
      SET s.user_id = singleton_user.singleton_user_id
      WHERE s.user_id IS NULL
    `);

    const table = await queryRunner.getTable('signals');
    if (!table) {
      return;
    }

    if (!table.indices.some((index) => index.name === 'idx_signals_user_status_signal_time')) {
      await queryRunner.createIndex(
        'signals',
        new TableIndex({
          name: 'idx_signals_user_status_signal_time',
          columnNames: ['user_id', 'status', 'signalTime'],
        })
      );
    }

    if (!table.indices.some((index) => index.name === 'idx_signals_user_symbol_created_at')) {
      await queryRunner.createIndex(
        'signals',
        new TableIndex({
          name: 'idx_signals_user_symbol_created_at',
          columnNames: ['user_id', 'symbol', 'createdAt'],
        })
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('signals'))) {
      return;
    }

    const table = await queryRunner.getTable('signals');
    if (table?.indices.some((index) => index.name === 'idx_signals_user_symbol_created_at')) {
      await queryRunner.dropIndex('signals', 'idx_signals_user_symbol_created_at');
    }
    if (table?.indices.some((index) => index.name === 'idx_signals_user_status_signal_time')) {
      await queryRunner.dropIndex('signals', 'idx_signals_user_status_signal_time');
    }

    if (await queryRunner.hasColumn('signals', 'user_id')) {
      await queryRunner.dropColumn('signals', 'user_id');
    }
  }
}
