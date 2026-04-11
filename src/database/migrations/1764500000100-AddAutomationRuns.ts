import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class AddAutomationRuns1764500000100 implements MigrationInterface {
  name = 'AddAutomationRuns1764500000100';

  private async hasIndex(queryRunner: QueryRunner, table: string, indexName: string): Promise<boolean> {
    const rows = await queryRunner.query(`SHOW INDEX FROM ${table} WHERE Key_name = ?`, [indexName]);
    return rows.length > 0;
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('automation_runs');
    if (!hasTable) {
      await queryRunner.query(
        `CREATE TABLE automation_runs (
          id char(36) NOT NULL,
          automation_id char(36) NOT NULL,
          user_id char(36) NOT NULL,
          status varchar(32) NOT NULL,
          scheduled_for timestamp NULL,
          started_at timestamp NOT NULL,
          finished_at timestamp NULL,
          duration_ms int NULL,
          error_message text NULL,
          meta_json text NULL,
          created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id)
        ) ENGINE=InnoDB`
      );
    }

    if (!(await this.hasIndex(queryRunner, 'automation_runs', 'idx_automation_runs_automation_started'))) {
      await queryRunner.query(
        'CREATE INDEX idx_automation_runs_automation_started ON automation_runs (automation_id, started_at)'
      );
    }
    if (!(await this.hasIndex(queryRunner, 'automation_runs', 'idx_automation_runs_user_started'))) {
      await queryRunner.query(
        'CREATE INDEX idx_automation_runs_user_started ON automation_runs (user_id, started_at)'
      );
    }
    if (!(await this.hasIndex(queryRunner, 'automation_runs', 'idx_automation_runs_status_scheduled'))) {
      await queryRunner.query(
        'CREATE INDEX idx_automation_runs_status_scheduled ON automation_runs (status, scheduled_for)'
      );
    }
    if (!(await this.hasIndex(queryRunner, 'automation_runs', 'uidx_automation_runs_automation_scheduled'))) {
      await queryRunner.query(
        'CREATE UNIQUE INDEX uidx_automation_runs_automation_scheduled ON automation_runs (automation_id, scheduled_for)'
      );
    }

    if (!(await this.hasIndex(queryRunner, 'automations', 'idx_automations_status_next_run'))) {
      await queryRunner.query(
        'CREATE INDEX idx_automations_status_next_run ON automations (status, nextRun)'
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await this.hasIndex(queryRunner, 'automations', 'idx_automations_status_next_run')) {
      await queryRunner.query('DROP INDEX idx_automations_status_next_run ON automations');
    }

    if (await this.hasIndex(queryRunner, 'automation_runs', 'uidx_automation_runs_automation_scheduled')) {
      await queryRunner.query(
        'DROP INDEX uidx_automation_runs_automation_scheduled ON automation_runs'
      );
    }
    if (await this.hasIndex(queryRunner, 'automation_runs', 'idx_automation_runs_status_scheduled')) {
      await queryRunner.query(
        'DROP INDEX idx_automation_runs_status_scheduled ON automation_runs'
      );
    }
    if (await this.hasIndex(queryRunner, 'automation_runs', 'idx_automation_runs_user_started')) {
      await queryRunner.query('DROP INDEX idx_automation_runs_user_started ON automation_runs');
    }
    if (await this.hasIndex(queryRunner, 'automation_runs', 'idx_automation_runs_automation_started')) {
      await queryRunner.query(
        'DROP INDEX idx_automation_runs_automation_started ON automation_runs'
      );
    }

    if (await queryRunner.hasTable('automation_runs')) {
      await queryRunner.query('DROP TABLE automation_runs');
    }
  }
}
