import { Service } from 'typedi';
import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

@Service()
export class AddStrategyLabLineageFields1765300000000 implements MigrationInterface {
  name = 'AddStrategyLabLineageFields1765300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('strategy_lab_projects'))) {
      return;
    }

    if (!(await queryRunner.hasColumn('strategy_lab_projects', 'projectVersion'))) {
      await queryRunner.addColumn(
        'strategy_lab_projects',
        new TableColumn({
          name: 'projectVersion',
          type: 'int',
          default: 1,
        })
      );
    }

    if (!(await queryRunner.hasColumn('strategy_lab_projects', 'sourceTemplateId'))) {
      await queryRunner.addColumn(
        'strategy_lab_projects',
        new TableColumn({
          name: 'sourceTemplateId',
          type: 'varchar',
          length: '100',
          isNullable: true,
        })
      );
    }

    if (!(await queryRunner.hasColumn('strategy_lab_projects', 'sourceTemplateVersion'))) {
      await queryRunner.addColumn(
        'strategy_lab_projects',
        new TableColumn({
          name: 'sourceTemplateVersion',
          type: 'int',
          isNullable: true,
        })
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('strategy_lab_projects'))) {
      return;
    }

    if (await queryRunner.hasColumn('strategy_lab_projects', 'sourceTemplateVersion')) {
      await queryRunner.dropColumn('strategy_lab_projects', 'sourceTemplateVersion');
    }

    if (await queryRunner.hasColumn('strategy_lab_projects', 'sourceTemplateId')) {
      await queryRunner.dropColumn('strategy_lab_projects', 'sourceTemplateId');
    }

    if (await queryRunner.hasColumn('strategy_lab_projects', 'projectVersion')) {
      await queryRunner.dropColumn('strategy_lab_projects', 'projectVersion');
    }
  }
}
