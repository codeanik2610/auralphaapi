import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class AddRuntimeRecoveryMetadata1770800000000 implements MigrationInterface {
  name = 'AddRuntimeRecoveryMetadata1770800000000';

  private async hasIndex(queryRunner: QueryRunner, table: string, indexName: string): Promise<boolean> {
    const rows = await queryRunner.query(`SHOW INDEX FROM ${table} WHERE Key_name = ?`, [indexName]);
    return rows.length > 0;
  }

  private async hasForeignKey(
    queryRunner: QueryRunner,
    table: string,
    constraintName: string
  ): Promise<boolean> {
    const rows = await queryRunner.query(
      `
        SELECT COUNT(*) AS count
        FROM information_schema.TABLE_CONSTRAINTS
        WHERE CONSTRAINT_SCHEMA = DATABASE()
          AND TABLE_NAME = ?
          AND CONSTRAINT_NAME = ?
          AND CONSTRAINT_TYPE = 'FOREIGN KEY'
      `,
      [table, constraintName]
    );
    return Number(rows?.[0]?.count || 0) > 0;
  }

  private async addColumnIfMissing(
    queryRunner: QueryRunner,
    table: string,
    columnName: string,
    columnSql: string
  ): Promise<void> {
    if (!(await queryRunner.hasColumn(table, columnName))) {
      await queryRunner.query(`ALTER TABLE ${table} ADD COLUMN ${columnSql}`);
    }
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.addColumnIfMissing(
      queryRunner,
      'scheduler_commands',
      'worker_id',
      'worker_id varchar(191) NULL'
    );
    await this.addColumnIfMissing(
      queryRunner,
      'scheduler_commands',
      'claimed_at',
      'claimed_at timestamp NULL DEFAULT NULL'
    );
    await this.addColumnIfMissing(
      queryRunner,
      'scheduler_commands',
      'repaired_at',
      'repaired_at timestamp NULL DEFAULT NULL'
    );
    await this.addColumnIfMissing(
      queryRunner,
      'scheduler_commands',
      'repair_reason',
      'repair_reason text NULL'
    );

    if (!(await this.hasIndex(queryRunner, 'scheduler_commands', 'idx_scheduler_commands_status_claimed_at'))) {
      await queryRunner.query(
        'CREATE INDEX idx_scheduler_commands_status_claimed_at ON scheduler_commands (status, claimed_at)'
      );
    }
    if (!(await this.hasIndex(queryRunner, 'scheduler_commands', 'idx_scheduler_commands_worker_status_claimed_at'))) {
      await queryRunner.query(
        'CREATE INDEX idx_scheduler_commands_worker_status_claimed_at ON scheduler_commands (worker_id, status, claimed_at)'
      );
    }

    await queryRunner.query(`
      UPDATE scheduler_commands
      SET claimed_at = COALESCE(claimed_at, updated_at, created_at)
      WHERE status = 'Processing'
        AND claimed_at IS NULL
    `);

    await this.addColumnIfMissing(
      queryRunner,
      'scheduler_run_logs',
      'command_id',
      'command_id char(36) NULL'
    );
    await this.addColumnIfMissing(
      queryRunner,
      'scheduler_run_logs',
      'worker_id',
      'worker_id varchar(191) NULL'
    );
    await this.addColumnIfMissing(
      queryRunner,
      'scheduler_run_logs',
      'last_progress_at',
      'last_progress_at timestamp NULL DEFAULT NULL'
    );
    await this.addColumnIfMissing(
      queryRunner,
      'scheduler_run_logs',
      'repaired_at',
      'repaired_at timestamp NULL DEFAULT NULL'
    );
    await this.addColumnIfMissing(
      queryRunner,
      'scheduler_run_logs',
      'repair_reason',
      'repair_reason text NULL'
    );

    if (!(await this.hasIndex(queryRunner, 'scheduler_run_logs', 'idx_scheduler_run_logs_command_id'))) {
      await queryRunner.query(
        'CREATE INDEX idx_scheduler_run_logs_command_id ON scheduler_run_logs (command_id)'
      );
    }
    if (!(await this.hasIndex(queryRunner, 'scheduler_run_logs', 'idx_scheduler_run_logs_status_last_progress_at'))) {
      await queryRunner.query(
        'CREATE INDEX idx_scheduler_run_logs_status_last_progress_at ON scheduler_run_logs (status, last_progress_at)'
      );
    }
    if (!(await this.hasIndex(queryRunner, 'scheduler_run_logs', 'idx_scheduler_run_logs_worker_status_started_at'))) {
      await queryRunner.query(
        'CREATE INDEX idx_scheduler_run_logs_worker_status_started_at ON scheduler_run_logs (worker_id, status, started_at)'
      );
    }
    if (!(await this.hasForeignKey(queryRunner, 'scheduler_run_logs', 'fk_scheduler_run_logs_command_id'))) {
      await queryRunner.query(`
        ALTER TABLE scheduler_run_logs
        ADD CONSTRAINT fk_scheduler_run_logs_command_id
          FOREIGN KEY (command_id) REFERENCES scheduler_commands(id) ON DELETE SET NULL
      `);
    }

    await queryRunner.query(`
      UPDATE scheduler_run_logs
      SET last_progress_at = COALESCE(last_progress_at, finished_at, started_at)
      WHERE status = 'Running'
        AND last_progress_at IS NULL
    `);

    await this.addColumnIfMissing(
      queryRunner,
      'automation_runs',
      'worker_id',
      'worker_id varchar(191) NULL'
    );
    await this.addColumnIfMissing(
      queryRunner,
      'automation_runs',
      'last_progress_at',
      'last_progress_at timestamp NULL DEFAULT NULL'
    );
    await this.addColumnIfMissing(
      queryRunner,
      'automation_runs',
      'repaired_at',
      'repaired_at timestamp NULL DEFAULT NULL'
    );
    await this.addColumnIfMissing(
      queryRunner,
      'automation_runs',
      'repair_reason',
      'repair_reason text NULL'
    );

    if (!(await this.hasIndex(queryRunner, 'automation_runs', 'idx_automation_runs_status_last_progress_at'))) {
      await queryRunner.query(
        'CREATE INDEX idx_automation_runs_status_last_progress_at ON automation_runs (status, last_progress_at)'
      );
    }
    if (!(await this.hasIndex(queryRunner, 'automation_runs', 'idx_automation_runs_worker_status_started_at'))) {
      await queryRunner.query(
        'CREATE INDEX idx_automation_runs_worker_status_started_at ON automation_runs (worker_id, status, started_at)'
      );
    }

    await queryRunner.query(`
      UPDATE automation_runs
      SET last_progress_at = COALESCE(last_progress_at, finished_at, started_at)
      WHERE status IN ('Queued', 'Running')
        AND last_progress_at IS NULL
    `);

    await this.addColumnIfMissing(
      queryRunner,
      'activity_exports',
      'worker_id',
      'worker_id varchar(191) NULL'
    );
    await this.addColumnIfMissing(
      queryRunner,
      'activity_exports',
      'processing_started_at',
      'processing_started_at timestamp NULL DEFAULT NULL'
    );
    await this.addColumnIfMissing(
      queryRunner,
      'activity_exports',
      'repaired_at',
      'repaired_at timestamp NULL DEFAULT NULL'
    );
    await this.addColumnIfMissing(
      queryRunner,
      'activity_exports',
      'repair_reason',
      'repair_reason text NULL'
    );

    if (!(await this.hasIndex(queryRunner, 'activity_exports', 'idx_activity_exports_status_processing_started_at'))) {
      await queryRunner.query(
        'CREATE INDEX idx_activity_exports_status_processing_started_at ON activity_exports (status, processing_started_at)'
      );
    }
    if (!(await this.hasIndex(queryRunner, 'activity_exports', 'idx_activity_exports_worker_status_updated_at'))) {
      await queryRunner.query(
        'CREATE INDEX idx_activity_exports_worker_status_updated_at ON activity_exports (worker_id, status, updatedAt)'
      );
    }

    await queryRunner.query(`
      UPDATE activity_exports
      SET processing_started_at = COALESCE(processing_started_at, updatedAt, createdAt)
      WHERE status = 'Processing'
        AND processing_started_at IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await this.hasIndex(queryRunner, 'activity_exports', 'idx_activity_exports_worker_status_updated_at')) {
      await queryRunner.query(
        'DROP INDEX idx_activity_exports_worker_status_updated_at ON activity_exports'
      );
    }
    if (await this.hasIndex(queryRunner, 'activity_exports', 'idx_activity_exports_status_processing_started_at')) {
      await queryRunner.query(
        'DROP INDEX idx_activity_exports_status_processing_started_at ON activity_exports'
      );
    }
    if (await queryRunner.hasColumn('activity_exports', 'repair_reason')) {
      await queryRunner.query('ALTER TABLE activity_exports DROP COLUMN repair_reason');
    }
    if (await queryRunner.hasColumn('activity_exports', 'repaired_at')) {
      await queryRunner.query('ALTER TABLE activity_exports DROP COLUMN repaired_at');
    }
    if (await queryRunner.hasColumn('activity_exports', 'processing_started_at')) {
      await queryRunner.query('ALTER TABLE activity_exports DROP COLUMN processing_started_at');
    }
    if (await queryRunner.hasColumn('activity_exports', 'worker_id')) {
      await queryRunner.query('ALTER TABLE activity_exports DROP COLUMN worker_id');
    }

    if (await this.hasIndex(queryRunner, 'automation_runs', 'idx_automation_runs_worker_status_started_at')) {
      await queryRunner.query(
        'DROP INDEX idx_automation_runs_worker_status_started_at ON automation_runs'
      );
    }
    if (await this.hasIndex(queryRunner, 'automation_runs', 'idx_automation_runs_status_last_progress_at')) {
      await queryRunner.query(
        'DROP INDEX idx_automation_runs_status_last_progress_at ON automation_runs'
      );
    }
    if (await queryRunner.hasColumn('automation_runs', 'repair_reason')) {
      await queryRunner.query('ALTER TABLE automation_runs DROP COLUMN repair_reason');
    }
    if (await queryRunner.hasColumn('automation_runs', 'repaired_at')) {
      await queryRunner.query('ALTER TABLE automation_runs DROP COLUMN repaired_at');
    }
    if (await queryRunner.hasColumn('automation_runs', 'last_progress_at')) {
      await queryRunner.query('ALTER TABLE automation_runs DROP COLUMN last_progress_at');
    }
    if (await queryRunner.hasColumn('automation_runs', 'worker_id')) {
      await queryRunner.query('ALTER TABLE automation_runs DROP COLUMN worker_id');
    }

    if (await this.hasForeignKey(queryRunner, 'scheduler_run_logs', 'fk_scheduler_run_logs_command_id')) {
      await queryRunner.query(
        'ALTER TABLE scheduler_run_logs DROP FOREIGN KEY fk_scheduler_run_logs_command_id'
      );
    }
    if (await this.hasIndex(queryRunner, 'scheduler_run_logs', 'idx_scheduler_run_logs_worker_status_started_at')) {
      await queryRunner.query(
        'DROP INDEX idx_scheduler_run_logs_worker_status_started_at ON scheduler_run_logs'
      );
    }
    if (await this.hasIndex(queryRunner, 'scheduler_run_logs', 'idx_scheduler_run_logs_status_last_progress_at')) {
      await queryRunner.query(
        'DROP INDEX idx_scheduler_run_logs_status_last_progress_at ON scheduler_run_logs'
      );
    }
    if (await this.hasIndex(queryRunner, 'scheduler_run_logs', 'idx_scheduler_run_logs_command_id')) {
      await queryRunner.query('DROP INDEX idx_scheduler_run_logs_command_id ON scheduler_run_logs');
    }
    if (await queryRunner.hasColumn('scheduler_run_logs', 'repair_reason')) {
      await queryRunner.query('ALTER TABLE scheduler_run_logs DROP COLUMN repair_reason');
    }
    if (await queryRunner.hasColumn('scheduler_run_logs', 'repaired_at')) {
      await queryRunner.query('ALTER TABLE scheduler_run_logs DROP COLUMN repaired_at');
    }
    if (await queryRunner.hasColumn('scheduler_run_logs', 'last_progress_at')) {
      await queryRunner.query('ALTER TABLE scheduler_run_logs DROP COLUMN last_progress_at');
    }
    if (await queryRunner.hasColumn('scheduler_run_logs', 'worker_id')) {
      await queryRunner.query('ALTER TABLE scheduler_run_logs DROP COLUMN worker_id');
    }
    if (await queryRunner.hasColumn('scheduler_run_logs', 'command_id')) {
      await queryRunner.query('ALTER TABLE scheduler_run_logs DROP COLUMN command_id');
    }

    if (await this.hasIndex(queryRunner, 'scheduler_commands', 'idx_scheduler_commands_worker_status_claimed_at')) {
      await queryRunner.query(
        'DROP INDEX idx_scheduler_commands_worker_status_claimed_at ON scheduler_commands'
      );
    }
    if (await this.hasIndex(queryRunner, 'scheduler_commands', 'idx_scheduler_commands_status_claimed_at')) {
      await queryRunner.query(
        'DROP INDEX idx_scheduler_commands_status_claimed_at ON scheduler_commands'
      );
    }
    if (await queryRunner.hasColumn('scheduler_commands', 'repair_reason')) {
      await queryRunner.query('ALTER TABLE scheduler_commands DROP COLUMN repair_reason');
    }
    if (await queryRunner.hasColumn('scheduler_commands', 'repaired_at')) {
      await queryRunner.query('ALTER TABLE scheduler_commands DROP COLUMN repaired_at');
    }
    if (await queryRunner.hasColumn('scheduler_commands', 'claimed_at')) {
      await queryRunner.query('ALTER TABLE scheduler_commands DROP COLUMN claimed_at');
    }
    if (await queryRunner.hasColumn('scheduler_commands', 'worker_id')) {
      await queryRunner.query('ALTER TABLE scheduler_commands DROP COLUMN worker_id');
    }
  }
}
