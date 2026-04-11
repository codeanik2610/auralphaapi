import { MigrationInterface, QueryRunner } from 'typeorm';
import { Service } from 'typedi';

@Service()
export class AddBacktestOperationalStateColumnsPg1767300003000
  implements MigrationInterface
{
  name = 'AddBacktestOperationalStateColumnsPg1767300003000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE backtest_results ADD COLUMN IF NOT EXISTS progress_state varchar(32) NULL'
    );
    await queryRunner.query(
      'ALTER TABLE backtest_results ADD COLUMN IF NOT EXISTS progress_processed int NULL'
    );
    await queryRunner.query(
      'ALTER TABLE backtest_results ADD COLUMN IF NOT EXISTS progress_total int NULL'
    );
    await queryRunner.query(
      'ALTER TABLE backtest_results ADD COLUMN IF NOT EXISTS progress_percent double precision NULL'
    );
    await queryRunner.query(
      'ALTER TABLE backtest_results ADD COLUMN IF NOT EXISTS resume_checkpoint_state varchar(32) NULL'
    );
    await queryRunner.query(
      'ALTER TABLE backtest_results ADD COLUMN IF NOT EXISTS trade_event_count int NULL'
    );
    await queryRunner.query(
      'ALTER TABLE backtest_results ADD COLUMN IF NOT EXISTS performance_surface_result_count int NULL'
    );

    await queryRunner.query(`
      UPDATE backtest_results
      SET
        progress_state = CASE
          WHEN COALESCE(jsonb_typeof(config), '') = 'object'
            AND COALESCE(jsonb_typeof(config->'progress'), '') = 'object'
          THEN NULLIF(BTRIM(config #>> '{progress,state}'), '')
          ELSE NULL
        END,
        progress_processed = CASE
          WHEN COALESCE(jsonb_typeof(config), '') = 'object'
            AND COALESCE(config #>> '{progress,processed}', '') ~ '^[0-9]+$'
          THEN (config #>> '{progress,processed}')::int
          ELSE NULL
        END,
        progress_total = CASE
          WHEN COALESCE(jsonb_typeof(config), '') = 'object'
            AND COALESCE(config #>> '{progress,total}', '') ~ '^[0-9]+$'
          THEN (config #>> '{progress,total}')::int
          ELSE NULL
        END,
        progress_percent = CASE
          WHEN COALESCE(jsonb_typeof(config), '') = 'object'
            AND COALESCE(config #>> '{progress,percent}', '') ~ '^[0-9]+(\\.[0-9]+)?$'
          THEN (config #>> '{progress,percent}')::double precision
          ELSE NULL
        END,
        resume_checkpoint_state = CASE
          WHEN COALESCE(jsonb_typeof(config), '') = 'object'
            AND COALESCE(jsonb_typeof(config->'resumeCheckpoint'), '') = 'object'
          THEN NULLIF(BTRIM(config #>> '{resumeCheckpoint,state}'), '')
          ELSE NULL
        END,
        trade_event_count = CASE
          WHEN COALESCE(jsonb_typeof(config), '') = 'object'
            AND COALESCE(config->>'tradeEventCount', '') ~ '^[0-9]+$'
          THEN (config->>'tradeEventCount')::int
          ELSE NULL
        END,
        performance_surface_result_count = CASE
          WHEN COALESCE(jsonb_typeof(config), '') = 'object'
            AND COALESCE(jsonb_typeof(config->'performanceSurface'), '') = 'object'
            AND COALESCE(jsonb_typeof(config->'performanceSurface'->'results'), '') = 'array'
          THEN jsonb_array_length(config->'performanceSurface'->'results')
          ELSE NULL
        END
      WHERE config IS NOT NULL
    `);

    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS idx_backtest_results_user_resume_checkpoint_state ON backtest_results (user_id, resume_checkpoint_state)'
    );
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS idx_backtest_results_user_surface_result_count ON backtest_results (user_id, performance_surface_result_count DESC)'
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS idx_backtest_results_user_surface_result_count'
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS idx_backtest_results_user_resume_checkpoint_state'
    );
    await queryRunner.query(
      'ALTER TABLE backtest_results DROP COLUMN IF EXISTS performance_surface_result_count'
    );
    await queryRunner.query(
      'ALTER TABLE backtest_results DROP COLUMN IF EXISTS trade_event_count'
    );
    await queryRunner.query(
      'ALTER TABLE backtest_results DROP COLUMN IF EXISTS resume_checkpoint_state'
    );
    await queryRunner.query(
      'ALTER TABLE backtest_results DROP COLUMN IF EXISTS progress_percent'
    );
    await queryRunner.query(
      'ALTER TABLE backtest_results DROP COLUMN IF EXISTS progress_total'
    );
    await queryRunner.query(
      'ALTER TABLE backtest_results DROP COLUMN IF EXISTS progress_processed'
    );
    await queryRunner.query(
      'ALTER TABLE backtest_results DROP COLUMN IF EXISTS progress_state'
    );
  }
}
