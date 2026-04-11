import { Service } from 'typedi';
import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

@Service()
export class CreateStrategyTables1741473300000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'strategy_templates',
        columns: [
          { name: 'id', type: 'char', length: '36', isPrimary: true },
          { name: 'name', type: 'varchar', length: '255' },
          { name: 'category', type: 'varchar', length: '100' },
          { name: 'market', type: 'varchar', length: '100' },
          { name: 'complexity', type: 'varchar', length: '50' },
          { name: 'description', type: 'text' },
          { name: 'author', type: 'varchar', length: '100' },
          { name: 'score', type: 'varchar', length: '20', isNullable: true },
          { name: 'useCase', type: 'varchar', length: '255', isNullable: true },
          { name: 'deployability', type: 'varchar', length: '100', isNullable: true },
          { name: 'popularity', type: 'varchar', length: '50', isNullable: true },
          { name: 'summary', type: 'text', isNullable: true },
          { name: 'createdAt', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
          { name: 'updatedAt', type: 'timestamp', default: 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' },
        ],
      })
    );

    await queryRunner.createIndex(
      'strategy_templates',
      new TableIndex({ name: 'idx_strategy_templates_category_updated_at', columnNames: ['category', 'updatedAt'] })
    );

    await queryRunner.createIndex(
      'strategy_templates',
      new TableIndex({ name: 'idx_strategy_templates_market_updated_at', columnNames: ['market', 'updatedAt'] })
    );

    await queryRunner.createTable(
      new Table({
        name: 'strategy_lab_projects',
        columns: [
          { name: 'id', type: 'char', length: '36', isPrimary: true },
          { name: 'templateId', type: 'varchar', length: '100' },
          { name: 'name', type: 'varchar', length: '255' },
          { name: 'status', type: 'varchar', length: '30', default: "'Draft'" },
          { name: 'config', type: 'json', isNullable: true },
          { name: 'objective', type: 'varchar', length: '100', isNullable: true },
          { name: 'market', type: 'varchar', length: '100', isNullable: true },
          { name: 'timeframe', type: 'varchar', length: '50', isNullable: true },
          { name: 'universe', type: 'varchar', length: '100', isNullable: true },
          { name: 'createdAt', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
          { name: 'updatedAt', type: 'timestamp', default: 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' },
        ],
      })
    );

    await queryRunner.createIndex(
      'strategy_lab_projects',
      new TableIndex({ name: 'idx_strategy_lab_projects_template_updated_at', columnNames: ['templateId', 'updatedAt'] })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex('strategy_lab_projects', 'idx_strategy_lab_projects_template_updated_at');
    await queryRunner.dropTable('strategy_lab_projects');
    await queryRunner.dropIndex('strategy_templates', 'idx_strategy_templates_market_updated_at');
    await queryRunner.dropIndex('strategy_templates', 'idx_strategy_templates_category_updated_at');
    await queryRunner.dropTable('strategy_templates');
  }
}
