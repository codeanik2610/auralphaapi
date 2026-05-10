import { Service } from 'typedi';
import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

@Service()
export class AddSuggestedTradeExecutionRouteAttempts1800001800000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('suggested_trade_executions'))) {
      return;
    }

    if (!(await queryRunner.hasColumn('suggested_trade_executions', 'route_attempts_json'))) {
      await queryRunner.addColumn(
        'suggested_trade_executions',
        new TableColumn({
          name: 'route_attempts_json',
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

    if (await queryRunner.hasColumn('suggested_trade_executions', 'route_attempts_json')) {
      await queryRunner.dropColumn('suggested_trade_executions', 'route_attempts_json');
    }
  }
}
