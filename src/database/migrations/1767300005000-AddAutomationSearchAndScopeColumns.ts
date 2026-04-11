import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class AddAutomationSearchAndScopeColumns1767300005000 implements MigrationInterface {
  name = 'AddAutomationSearchAndScopeColumns1767300005000';

  private async hasIndex(queryRunner: QueryRunner, table: string, indexName: string): Promise<boolean> {
    const rows = await queryRunner.query(`SHOW INDEX FROM ${table} WHERE Key_name = ?`, [indexName]);
    return rows.length > 0;
  }

  private async addColumnIfMissing(queryRunner: QueryRunner, table: string, columnSql: string): Promise<void> {
    const [columnName] = columnSql.split(/\s+/);
    if (!(await queryRunner.hasColumn(table, columnName))) {
      await queryRunner.query(`ALTER TABLE ${table} ADD COLUMN ${columnSql}`);
    }
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.addColumnIfMissing(queryRunner, 'automations', 'searchText varchar(512) NULL');
    await this.addColumnIfMissing(queryRunner, 'automations', 'sourceBacktestId varchar(64) NULL');
    await this.addColumnIfMissing(queryRunner, 'automations', 'scopeSymbol varchar(64) NULL');
    await this.addColumnIfMissing(queryRunner, 'automations', 'scopeTimeframe varchar(32) NULL');
    await this.addColumnIfMissing(queryRunner, 'automations', 'sourceTemplateId varchar(64) NULL');

    await queryRunner.query(`
      UPDATE automations
      SET
        sourceBacktestId = NULLIF(TRIM(COALESCE(
          JSON_UNQUOTE(JSON_EXTRACT(config, '$.backtestId')),
          JSON_UNQUOTE(JSON_EXTRACT(config, '$.tradeSuggestion.backtestId')),
          JSON_UNQUOTE(JSON_EXTRACT(config, '$.backtestRunner.backtestId')),
          ''
        )), ''),
        sourceTemplateId = NULLIF(TRIM(COALESCE(
          JSON_UNQUOTE(JSON_EXTRACT(config, '$.sourceTemplateId')),
          JSON_UNQUOTE(JSON_EXTRACT(config, '$.templateId')),
          JSON_UNQUOTE(JSON_EXTRACT(config, '$.tradeSuggestion.sourceTemplateId')),
          JSON_UNQUOTE(JSON_EXTRACT(config, '$.tradeSuggestion.templateId')),
          ''
        )), ''),
        scopeSymbol = NULLIF(UPPER(TRIM(COALESCE(
          JSON_UNQUOTE(JSON_EXTRACT(config, '$.symbol')),
          JSON_UNQUOTE(JSON_EXTRACT(config, '$.tradeSuggestion.symbol')),
          JSON_UNQUOTE(JSON_EXTRACT(config, '$.setupScope.symbol')),
          JSON_UNQUOTE(JSON_EXTRACT(config, '$.tradeSuggestion.setupScope.symbol')),
          ''
        ))), ''),
        scopeTimeframe = NULLIF(LOWER(TRIM(COALESCE(
          JSON_UNQUOTE(JSON_EXTRACT(config, '$.timeframe')),
          JSON_UNQUOTE(JSON_EXTRACT(config, '$.tradeSuggestion.timeframe')),
          JSON_UNQUOTE(JSON_EXTRACT(config, '$.setupScope.timeframe')),
          JSON_UNQUOTE(JSON_EXTRACT(config, '$.tradeSuggestion.setupScope.timeframe')),
          ''
        ))), '')
    `);

    await queryRunner.query(`
      UPDATE automations
      SET searchText = NULLIF(TRIM(CONCAT_WS(
        ' ',
        \`name\`,
        \`strategy\`,
        \`broker\`,
        \`market\`,
        \`trigger\`,
        \`status\`,
        \`automationType\`,
        \`timeZone\`,
        \`sourceBacktestId\`,
        \`sourceTemplateId\`,
        \`scopeSymbol\`,
        \`scopeTimeframe\`
      )), '')
    `);

    if (!(await this.hasIndex(queryRunner, 'automations', 'idx_automations_user_scope_lookup'))) {
      await queryRunner.query(
        'CREATE INDEX idx_automations_user_scope_lookup ON automations (user_id, automationType, sourceBacktestId, scopeSymbol, scopeTimeframe)'
      );
    }

    if (!(await this.hasIndex(queryRunner, 'automations', 'idx_automations_user_source_template_updated_at'))) {
      await queryRunner.query(
        'CREATE INDEX idx_automations_user_source_template_updated_at ON automations (user_id, sourceTemplateId, updatedAt)'
      );
    }

    if (!(await this.hasIndex(queryRunner, 'automations', 'ftx_automations_search_text'))) {
      await queryRunner.query(
        'CREATE FULLTEXT INDEX ftx_automations_search_text ON automations (searchText)'
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await this.hasIndex(queryRunner, 'automations', 'ftx_automations_search_text')) {
      await queryRunner.query('DROP INDEX ftx_automations_search_text ON automations');
    }
    if (await this.hasIndex(queryRunner, 'automations', 'idx_automations_user_source_template_updated_at')) {
      await queryRunner.query(
        'DROP INDEX idx_automations_user_source_template_updated_at ON automations'
      );
    }
    if (await this.hasIndex(queryRunner, 'automations', 'idx_automations_user_scope_lookup')) {
      await queryRunner.query('DROP INDEX idx_automations_user_scope_lookup ON automations');
    }

    if (await queryRunner.hasColumn('automations', 'sourceTemplateId')) {
      await queryRunner.query('ALTER TABLE automations DROP COLUMN sourceTemplateId');
    }
    if (await queryRunner.hasColumn('automations', 'scopeTimeframe')) {
      await queryRunner.query('ALTER TABLE automations DROP COLUMN scopeTimeframe');
    }
    if (await queryRunner.hasColumn('automations', 'scopeSymbol')) {
      await queryRunner.query('ALTER TABLE automations DROP COLUMN scopeSymbol');
    }
    if (await queryRunner.hasColumn('automations', 'sourceBacktestId')) {
      await queryRunner.query('ALTER TABLE automations DROP COLUMN sourceBacktestId');
    }
    if (await queryRunner.hasColumn('automations', 'searchText')) {
      await queryRunner.query('ALTER TABLE automations DROP COLUMN searchText');
    }
  }
}
