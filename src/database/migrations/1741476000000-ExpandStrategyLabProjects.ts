import { Service } from 'typedi';
import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

@Service()
export class ExpandStrategyLabProjects1741476000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumns('strategy_lab_projects', [
      new TableColumn({ name: 'sourceTemplateId', type: 'varchar', length: '100', isNullable: true }),
      new TableColumn({ name: 'authoringMode', type: 'varchar', length: '20', default: "'no_code'" }),
      new TableColumn({ name: 'codeTarget', type: 'varchar', length: '30', isNullable: true }),
      new TableColumn({ name: 'visualDefinition', type: 'json', isNullable: true }),
      new TableColumn({ name: 'codeDefinition', type: 'longtext', isNullable: true }),
      new TableColumn({ name: 'parameters', type: 'json', isNullable: true }),
      new TableColumn({ name: 'riskConfig', type: 'json', isNullable: true }),
      new TableColumn({ name: 'validationState', type: 'varchar', length: '20', isNullable: true, default: "'idle'" }),
      new TableColumn({ name: 'validationErrors', type: 'json', isNullable: true }),
      new TableColumn({ name: 'lastValidatedAt', type: 'datetime', isNullable: true }),
    ]);

    await queryRunner.query(`
      UPDATE strategy_lab_projects
      SET
        sourceTemplateId = COALESCE(sourceTemplateId, templateId),
        authoringMode = 'no_code',
        visualDefinition = COALESCE(visualDefinition, config),
        validationState = COALESCE(validationState, 'idle')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('strategy_lab_projects', 'lastValidatedAt');
    await queryRunner.dropColumn('strategy_lab_projects', 'validationErrors');
    await queryRunner.dropColumn('strategy_lab_projects', 'validationState');
    await queryRunner.dropColumn('strategy_lab_projects', 'riskConfig');
    await queryRunner.dropColumn('strategy_lab_projects', 'parameters');
    await queryRunner.dropColumn('strategy_lab_projects', 'codeDefinition');
    await queryRunner.dropColumn('strategy_lab_projects', 'visualDefinition');
    await queryRunner.dropColumn('strategy_lab_projects', 'codeTarget');
    await queryRunner.dropColumn('strategy_lab_projects', 'authoringMode');
    await queryRunner.dropColumn('strategy_lab_projects', 'sourceTemplateId');
  }
}
