import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class AddSuggestedTradeExecutionPreTradeFieldsPhase81770808400000
  implements MigrationInterface
{
  name = 'AddSuggestedTradeExecutionPreTradeFieldsPhase81770808400000';

  private async hasIndex(
    queryRunner: QueryRunner,
    tableName: string,
    indexName: string
  ): Promise<boolean> {
    const rows = (await queryRunner.query(
      `SHOW INDEX FROM \`${tableName}\` WHERE Key_name = ?`,
      [indexName]
    )) as Array<Record<string, unknown>>;
    return rows.length > 0;
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasColumn('suggested_trade_executions', 'pre_trade_check_id'))) {
      await queryRunner.query(`
        ALTER TABLE suggested_trade_executions
          ADD COLUMN pre_trade_check_id char(36) DEFAULT NULL AFTER execution_mode
      `);
    }
    if (!(await queryRunner.hasColumn('suggested_trade_executions', 'pre_trade_state'))) {
      await queryRunner.query(`
        ALTER TABLE suggested_trade_executions
          ADD COLUMN pre_trade_state varchar(20) DEFAULT NULL AFTER pre_trade_check_id
      `);
    }
    if (!(await queryRunner.hasColumn('suggested_trade_executions', 'pre_trade_checked_at'))) {
      await queryRunner.query(`
        ALTER TABLE suggested_trade_executions
          ADD COLUMN pre_trade_checked_at timestamp NULL DEFAULT NULL AFTER pre_trade_state
      `);
    }
    if (
      !(await queryRunner.hasColumn('suggested_trade_executions', 'pre_trade_blocked_reason'))
    ) {
      await queryRunner.query(`
        ALTER TABLE suggested_trade_executions
          ADD COLUMN pre_trade_blocked_reason text DEFAULT NULL AFTER pre_trade_checked_at
      `);
    }
    if (!(await queryRunner.hasColumn('suggested_trade_executions', 'accepted_by'))) {
      await queryRunner.query(`
        ALTER TABLE suggested_trade_executions
          ADD COLUMN accepted_by varchar(16) DEFAULT NULL AFTER pre_trade_blocked_reason
      `);
    }
    if (!(await queryRunner.hasColumn('suggested_trade_executions', 'accepted_at'))) {
      await queryRunner.query(`
        ALTER TABLE suggested_trade_executions
          ADD COLUMN accepted_at timestamp NULL DEFAULT NULL AFTER accepted_by
      `);
    }
    if (
      !(await this.hasIndex(
        queryRunner,
        'suggested_trade_executions',
        'idx_suggested_trade_executions_pre_trade_state'
      ))
    ) {
      await queryRunner.query(`
        ALTER TABLE suggested_trade_executions
          ADD KEY idx_suggested_trade_executions_pre_trade_state (user_id, pre_trade_state, updated_at)
      `);
    }
    if (
      !(await this.hasIndex(
        queryRunner,
        'suggested_trade_executions',
        'idx_suggested_trade_executions_pre_trade_check'
      ))
    ) {
      await queryRunner.query(`
        ALTER TABLE suggested_trade_executions
          ADD KEY idx_suggested_trade_executions_pre_trade_check (pre_trade_check_id)
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (
      await this.hasIndex(
        queryRunner,
        'suggested_trade_executions',
        'idx_suggested_trade_executions_pre_trade_state'
      )
    ) {
      await queryRunner.query(`
        ALTER TABLE suggested_trade_executions
          DROP INDEX idx_suggested_trade_executions_pre_trade_state
      `);
    }
    if (
      await this.hasIndex(
        queryRunner,
        'suggested_trade_executions',
        'idx_suggested_trade_executions_pre_trade_check'
      )
    ) {
      await queryRunner.query(`
        ALTER TABLE suggested_trade_executions
          DROP INDEX idx_suggested_trade_executions_pre_trade_check
      `);
    }
    if (await queryRunner.hasColumn('suggested_trade_executions', 'accepted_at')) {
      await queryRunner.query(`
        ALTER TABLE suggested_trade_executions
          DROP COLUMN accepted_at
      `);
    }
    if (await queryRunner.hasColumn('suggested_trade_executions', 'accepted_by')) {
      await queryRunner.query(`
        ALTER TABLE suggested_trade_executions
          DROP COLUMN accepted_by
      `);
    }
    if (
      await queryRunner.hasColumn('suggested_trade_executions', 'pre_trade_blocked_reason')
    ) {
      await queryRunner.query(`
        ALTER TABLE suggested_trade_executions
          DROP COLUMN pre_trade_blocked_reason
      `);
    }
    if (await queryRunner.hasColumn('suggested_trade_executions', 'pre_trade_checked_at')) {
      await queryRunner.query(`
        ALTER TABLE suggested_trade_executions
          DROP COLUMN pre_trade_checked_at
      `);
    }
    if (await queryRunner.hasColumn('suggested_trade_executions', 'pre_trade_state')) {
      await queryRunner.query(`
        ALTER TABLE suggested_trade_executions
          DROP COLUMN pre_trade_state
      `);
    }
    if (await queryRunner.hasColumn('suggested_trade_executions', 'pre_trade_check_id')) {
      await queryRunner.query(`
        ALTER TABLE suggested_trade_executions
          DROP COLUMN pre_trade_check_id
      `);
    }
  }
}
