import { Service } from 'typedi';
import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

@Service()
export class AddStrategyLabDescriptionAndValidationWarnings1764821000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('strategy_lab_projects'))) {
      return;
    }

    if (!(await queryRunner.hasColumn('strategy_lab_projects', 'description'))) {
      await queryRunner.addColumn(
        'strategy_lab_projects',
        new TableColumn({ name: 'description', type: 'text', isNullable: true })
      );
    }

    if (!(await queryRunner.hasColumn('strategy_lab_projects', 'validationWarnings'))) {
      await queryRunner.addColumn(
        'strategy_lab_projects',
        new TableColumn({ name: 'validationWarnings', type: 'json', isNullable: true })
      );
    }

    await queryRunner.query(`
      UPDATE strategy_lab_projects
      SET description = COALESCE(
        description,
        NULLIF(JSON_UNQUOTE(JSON_EXTRACT(config, '$.description')), '')
      )
      WHERE config IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('strategy_lab_projects'))) {
      return;
    }

    if (await queryRunner.hasColumn('strategy_lab_projects', 'validationWarnings')) {
      await queryRunner.dropColumn('strategy_lab_projects', 'validationWarnings');
    }

    if (await queryRunner.hasColumn('strategy_lab_projects', 'description')) {
      await queryRunner.dropColumn('strategy_lab_projects', 'description');
    }
  }
}
