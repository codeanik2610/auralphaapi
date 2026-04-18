import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

const GLOBAL_SYSTEM_SCHEDULER_KEYS = [
  'broker-assets-sync',
  'exchange-assets-sync',
  'binance-candles-3m-1m-sync',
  'system-health-sync',
  'asset-price-sync',
];

@Service()
export class AddGlobalSystemSchedulerInitiatorAudit1770712000000
  implements MigrationInterface
{
  name = 'AddGlobalSystemSchedulerInitiatorAudit1770712000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.addSchedulerRunLogColumns(queryRunner);
    await this.addSchedulerCommandColumns(queryRunner);
    await this.addExchangeAssetUpdateLogColumns(queryRunner);
    await this.backfillSchedulerRunLogs(queryRunner);
    await this.backfillSchedulerCommands(queryRunner);
    await this.backfillExchangeAssetUpdateLogs(queryRunner);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (
      (await queryRunner.hasTable('exchange_asset_update_logs')) &&
      (await queryRunner.hasColumn('exchange_asset_update_logs', 'execution_context'))
    ) {
      await queryRunner.query(
        'ALTER TABLE exchange_asset_update_logs DROP COLUMN execution_context'
      );
    }
    if (
      (await queryRunner.hasTable('exchange_asset_update_logs')) &&
      (await queryRunner.hasColumn('exchange_asset_update_logs', 'initiated_by_label'))
    ) {
      await queryRunner.query(
        'ALTER TABLE exchange_asset_update_logs DROP COLUMN initiated_by_label'
      );
    }
    if (
      (await queryRunner.hasTable('exchange_asset_update_logs')) &&
      (await queryRunner.hasColumn('exchange_asset_update_logs', 'initiated_by_user_id'))
    ) {
      await queryRunner.query(
        'ALTER TABLE exchange_asset_update_logs DROP COLUMN initiated_by_user_id'
      );
    }
    if (
      (await queryRunner.hasTable('exchange_asset_update_logs')) &&
      (await queryRunner.hasColumn('exchange_asset_update_logs', 'initiated_by_type'))
    ) {
      await queryRunner.query(
        'ALTER TABLE exchange_asset_update_logs DROP COLUMN initiated_by_type'
      );
    }

    if (
      (await queryRunner.hasTable('scheduler_commands')) &&
      (await queryRunner.hasColumn('scheduler_commands', 'execution_context'))
    ) {
      await queryRunner.query('ALTER TABLE scheduler_commands DROP COLUMN execution_context');
    }
    if (
      (await queryRunner.hasTable('scheduler_commands')) &&
      (await queryRunner.hasColumn('scheduler_commands', 'initiated_by_label'))
    ) {
      await queryRunner.query('ALTER TABLE scheduler_commands DROP COLUMN initiated_by_label');
    }
    if (
      (await queryRunner.hasTable('scheduler_commands')) &&
      (await queryRunner.hasColumn('scheduler_commands', 'initiated_by_user_id'))
    ) {
      await queryRunner.query(
        'ALTER TABLE scheduler_commands DROP COLUMN initiated_by_user_id'
      );
    }
    if (
      (await queryRunner.hasTable('scheduler_commands')) &&
      (await queryRunner.hasColumn('scheduler_commands', 'initiated_by_type'))
    ) {
      await queryRunner.query('ALTER TABLE scheduler_commands DROP COLUMN initiated_by_type');
    }

    if (
      (await queryRunner.hasTable('scheduler_run_logs')) &&
      (await queryRunner.hasColumn('scheduler_run_logs', 'execution_context'))
    ) {
      await queryRunner.query('ALTER TABLE scheduler_run_logs DROP COLUMN execution_context');
    }
    if (
      (await queryRunner.hasTable('scheduler_run_logs')) &&
      (await queryRunner.hasColumn('scheduler_run_logs', 'initiated_by_label'))
    ) {
      await queryRunner.query('ALTER TABLE scheduler_run_logs DROP COLUMN initiated_by_label');
    }
    if (
      (await queryRunner.hasTable('scheduler_run_logs')) &&
      (await queryRunner.hasColumn('scheduler_run_logs', 'initiated_by_user_id'))
    ) {
      await queryRunner.query(
        'ALTER TABLE scheduler_run_logs DROP COLUMN initiated_by_user_id'
      );
    }
    if (
      (await queryRunner.hasTable('scheduler_run_logs')) &&
      (await queryRunner.hasColumn('scheduler_run_logs', 'initiated_by_type'))
    ) {
      await queryRunner.query('ALTER TABLE scheduler_run_logs DROP COLUMN initiated_by_type');
    }
  }

  private async addSchedulerRunLogColumns(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('scheduler_run_logs'))) {
      return;
    }

    if (!(await queryRunner.hasColumn('scheduler_run_logs', 'initiated_by_type'))) {
      await queryRunner.query(
        'ALTER TABLE scheduler_run_logs ADD COLUMN initiated_by_type varchar(32) NULL AFTER actor_user_id'
      );
    }
    if (!(await queryRunner.hasColumn('scheduler_run_logs', 'initiated_by_user_id'))) {
      await queryRunner.query(
        'ALTER TABLE scheduler_run_logs ADD COLUMN initiated_by_user_id varchar(191) NULL AFTER initiated_by_type'
      );
    }
    if (!(await queryRunner.hasColumn('scheduler_run_logs', 'initiated_by_label'))) {
      await queryRunner.query(
        'ALTER TABLE scheduler_run_logs ADD COLUMN initiated_by_label varchar(191) NULL AFTER initiated_by_user_id'
      );
    }
    if (!(await queryRunner.hasColumn('scheduler_run_logs', 'execution_context'))) {
      await queryRunner.query(
        'ALTER TABLE scheduler_run_logs ADD COLUMN execution_context varchar(32) NULL AFTER initiated_by_label'
      );
    }
  }

  private async addSchedulerCommandColumns(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('scheduler_commands'))) {
      return;
    }

    if (!(await queryRunner.hasColumn('scheduler_commands', 'initiated_by_type'))) {
      await queryRunner.query(
        'ALTER TABLE scheduler_commands ADD COLUMN initiated_by_type varchar(32) NULL AFTER actor_user_id'
      );
    }
    if (!(await queryRunner.hasColumn('scheduler_commands', 'initiated_by_user_id'))) {
      await queryRunner.query(
        'ALTER TABLE scheduler_commands ADD COLUMN initiated_by_user_id varchar(191) NULL AFTER initiated_by_type'
      );
    }
    if (!(await queryRunner.hasColumn('scheduler_commands', 'initiated_by_label'))) {
      await queryRunner.query(
        'ALTER TABLE scheduler_commands ADD COLUMN initiated_by_label varchar(191) NULL AFTER initiated_by_user_id'
      );
    }
    if (!(await queryRunner.hasColumn('scheduler_commands', 'execution_context'))) {
      await queryRunner.query(
        'ALTER TABLE scheduler_commands ADD COLUMN execution_context varchar(32) NULL AFTER initiated_by_label'
      );
    }
  }

  private async addExchangeAssetUpdateLogColumns(
    queryRunner: QueryRunner
  ): Promise<void> {
    if (!(await queryRunner.hasTable('exchange_asset_update_logs'))) {
      return;
    }

    if (!(await queryRunner.hasColumn('exchange_asset_update_logs', 'initiated_by_type'))) {
      await queryRunner.query(
        'ALTER TABLE exchange_asset_update_logs ADD COLUMN initiated_by_type varchar(32) NULL AFTER run_log_id'
      );
    }
    if (!(await queryRunner.hasColumn('exchange_asset_update_logs', 'initiated_by_user_id'))) {
      await queryRunner.query(
        'ALTER TABLE exchange_asset_update_logs ADD COLUMN initiated_by_user_id varchar(191) NULL AFTER initiated_by_type'
      );
    }
    if (!(await queryRunner.hasColumn('exchange_asset_update_logs', 'initiated_by_label'))) {
      await queryRunner.query(
        'ALTER TABLE exchange_asset_update_logs ADD COLUMN initiated_by_label varchar(191) NULL AFTER initiated_by_user_id'
      );
    }
    if (!(await queryRunner.hasColumn('exchange_asset_update_logs', 'execution_context'))) {
      await queryRunner.query(
        'ALTER TABLE exchange_asset_update_logs ADD COLUMN execution_context varchar(32) NULL AFTER initiated_by_label'
      );
    }
  }

  private async backfillSchedulerRunLogs(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('scheduler_run_logs'))) {
      return;
    }

    await queryRunner.query(
      `
        UPDATE scheduler_run_logs
        SET initiated_by_type = COALESCE(
              NULLIF(initiated_by_type, ''),
              CASE
                WHEN actor_user_id IS NOT NULL AND TRIM(actor_user_id) <> '' THEN 'manual'
                WHEN meta_json IS NOT NULL
                  AND JSON_VALID(CAST(meta_json AS CHAR)) = 1
                  AND LOWER(JSON_UNQUOTE(JSON_EXTRACT(CAST(meta_json AS JSON), '$.initiatedByType'))) IN ('manual', 'cron', 'system')
                  THEN LOWER(JSON_UNQUOTE(JSON_EXTRACT(CAST(meta_json AS JSON), '$.initiatedByType')))
                WHEN meta_json IS NOT NULL
                  AND JSON_VALID(CAST(meta_json AS CHAR)) = 1
                  AND LOWER(JSON_UNQUOTE(JSON_EXTRACT(CAST(meta_json AS JSON), '$.trigger'))) = 'manual'
                  THEN 'manual'
                WHEN meta_json IS NOT NULL
                  AND JSON_VALID(CAST(meta_json AS CHAR)) = 1
                  AND LOWER(JSON_UNQUOTE(JSON_EXTRACT(CAST(meta_json AS JSON), '$.trigger'))) IN ('scheduled', 'cron')
                  THEN 'cron'
                ELSE 'system'
              END
            ),
            initiated_by_user_id = COALESCE(
              NULLIF(initiated_by_user_id, ''),
              NULLIF(actor_user_id, ''),
              CASE
                WHEN meta_json IS NOT NULL
                  AND JSON_VALID(CAST(meta_json AS CHAR)) = 1
                  THEN NULLIF(JSON_UNQUOTE(JSON_EXTRACT(CAST(meta_json AS JSON), '$.initiatedByUserId')), '')
                ELSE NULL
              END
            ),
            initiated_by_label = COALESCE(
              NULLIF(initiated_by_label, ''),
              CASE
                WHEN meta_json IS NOT NULL
                  AND JSON_VALID(CAST(meta_json AS CHAR)) = 1
                  THEN NULLIF(JSON_UNQUOTE(JSON_EXTRACT(CAST(meta_json AS JSON), '$.initiatedByLabel')), '')
                ELSE NULL
              END,
              NULLIF(actor_user_id, ''),
              CASE
                WHEN meta_json IS NOT NULL
                  AND JSON_VALID(CAST(meta_json AS CHAR)) = 1
                  AND LOWER(JSON_UNQUOTE(JSON_EXTRACT(CAST(meta_json AS JSON), '$.trigger'))) IN ('scheduled', 'cron')
                  THEN 'System cron'
                ELSE 'System'
              END
            ),
            execution_context = COALESCE(NULLIF(execution_context, ''), 'system')
        WHERE scheduler_key IN (${GLOBAL_SYSTEM_SCHEDULER_KEYS.map(() => '?').join(', ')})
      `,
      GLOBAL_SYSTEM_SCHEDULER_KEYS
    );
  }

  private async backfillSchedulerCommands(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('scheduler_commands'))) {
      return;
    }

    await queryRunner.query(
      `
        UPDATE scheduler_commands
        SET initiated_by_type = COALESCE(
              NULLIF(initiated_by_type, ''),
              CASE
                WHEN actor_user_id IS NOT NULL AND TRIM(actor_user_id) <> '' THEN 'manual'
                WHEN payload_json IS NOT NULL
                  AND JSON_VALID(CAST(payload_json AS CHAR)) = 1
                  AND LOWER(JSON_UNQUOTE(JSON_EXTRACT(CAST(payload_json AS JSON), '$.initiatedByType'))) IN ('manual', 'cron', 'system')
                  THEN LOWER(JSON_UNQUOTE(JSON_EXTRACT(CAST(payload_json AS JSON), '$.initiatedByType')))
                WHEN payload_json IS NOT NULL
                  AND JSON_VALID(CAST(payload_json AS CHAR)) = 1
                  AND LOWER(JSON_UNQUOTE(JSON_EXTRACT(CAST(payload_json AS JSON), '$.trigger'))) = 'manual'
                  THEN 'manual'
                WHEN payload_json IS NOT NULL
                  AND JSON_VALID(CAST(payload_json AS CHAR)) = 1
                  AND LOWER(JSON_UNQUOTE(JSON_EXTRACT(CAST(payload_json AS JSON), '$.trigger'))) IN ('scheduled', 'cron')
                  THEN 'cron'
                ELSE 'system'
              END
            ),
            initiated_by_user_id = COALESCE(
              NULLIF(initiated_by_user_id, ''),
              NULLIF(actor_user_id, ''),
              CASE
                WHEN payload_json IS NOT NULL
                  AND JSON_VALID(CAST(payload_json AS CHAR)) = 1
                  THEN NULLIF(JSON_UNQUOTE(JSON_EXTRACT(CAST(payload_json AS JSON), '$.initiatedByUserId')), '')
                ELSE NULL
              END
            ),
            initiated_by_label = COALESCE(
              NULLIF(initiated_by_label, ''),
              CASE
                WHEN payload_json IS NOT NULL
                  AND JSON_VALID(CAST(payload_json AS CHAR)) = 1
                  THEN NULLIF(JSON_UNQUOTE(JSON_EXTRACT(CAST(payload_json AS JSON), '$.initiatedByLabel')), '')
                ELSE NULL
              END,
              NULLIF(actor_user_id, ''),
              CASE
                WHEN payload_json IS NOT NULL
                  AND JSON_VALID(CAST(payload_json AS CHAR)) = 1
                  AND LOWER(JSON_UNQUOTE(JSON_EXTRACT(CAST(payload_json AS JSON), '$.trigger'))) IN ('scheduled', 'cron')
                  THEN 'System cron'
                ELSE 'System'
              END
            ),
            execution_context = COALESCE(NULLIF(execution_context, ''), 'system')
        WHERE scheduler_key IN (${GLOBAL_SYSTEM_SCHEDULER_KEYS.map(() => '?').join(', ')})
      `,
      GLOBAL_SYSTEM_SCHEDULER_KEYS
    );
  }

  private async backfillExchangeAssetUpdateLogs(
    queryRunner: QueryRunner
  ): Promise<void> {
    if (!(await queryRunner.hasTable('exchange_asset_update_logs'))) {
      return;
    }

    await queryRunner.query(
      `
        UPDATE exchange_asset_update_logs log
        INNER JOIN scheduler_run_logs run
          ON run.id = log.run_log_id
        SET log.initiated_by_type = COALESCE(NULLIF(log.initiated_by_type, ''), NULLIF(run.initiated_by_type, ''), 'system'),
            log.initiated_by_user_id = COALESCE(NULLIF(log.initiated_by_user_id, ''), NULLIF(run.initiated_by_user_id, ''), NULLIF(run.actor_user_id, '')),
            log.initiated_by_label = COALESCE(NULLIF(log.initiated_by_label, ''), NULLIF(run.initiated_by_label, ''), 'System'),
            log.execution_context = COALESCE(NULLIF(log.execution_context, ''), NULLIF(run.execution_context, ''), 'system')
        WHERE run.scheduler_key IN (${GLOBAL_SYSTEM_SCHEDULER_KEYS.map(() => '?').join(', ')})
      `,
      GLOBAL_SYSTEM_SCHEDULER_KEYS
    );
  }
}
