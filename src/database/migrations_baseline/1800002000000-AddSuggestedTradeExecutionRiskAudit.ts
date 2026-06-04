import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';
import { Service } from 'typedi';

@Service()
export class AddSuggestedTradeExecutionRiskAudit1800002000000 implements MigrationInterface {
  name = 'AddSuggestedTradeExecutionRiskAudit1800002000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('suggested_trade_executions'))) {
      return;
    }
    if (!(await queryRunner.hasColumn('suggested_trade_executions', 'risk_audit_json'))) {
      await queryRunner.addColumn(
        'suggested_trade_executions',
        new TableColumn({
          name: 'risk_audit_json',
          type: 'json',
          isNullable: true,
        })
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('suggested_trade_executions'))) {
      return;
    }
    if (await queryRunner.hasColumn('suggested_trade_executions', 'risk_audit_json')) {
      await queryRunner.dropColumn('suggested_trade_executions', 'risk_audit_json');
    }
  }
}
