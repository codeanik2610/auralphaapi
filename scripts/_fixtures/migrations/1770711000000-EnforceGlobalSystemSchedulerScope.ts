import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

const GLOBAL_SYSTEM_SCHEDULERS: Array<{
  key: string;
  description: string;
  sourcesSql: string;
  useSystemConnectionsOnly?: boolean;
  useSystemAccountsOnly?: boolean;
}> = [
  {
    key: 'broker-assets-sync',
    description:
      'Fetches provider assets for system broker accounts and updates the global broker assets catalog.',
    sourcesSql: "JSON_ARRAY('mudrex', 'delta_exchange')",
    useSystemConnectionsOnly: true,
    useSystemAccountsOnly: true,
  },
  {
    key: 'exchange-assets-sync',
    description:
      'Syncs the global exchange assets catalog from Binance exchangeInfo using Binance base URL configured in system exchange metadata.',
    sourcesSql: "JSON_ARRAY('binance-futures')",
    useSystemConnectionsOnly: true,
  },
  {
    key: 'binance-candles-3m-1m-sync',
    description:
      'Fetches 3 months of 1m candles from Binance for global system exchange assets and stores them in Postgres.',
    sourcesSql: "JSON_ARRAY('binance')",
    useSystemConnectionsOnly: true,
    useSystemAccountsOnly: true,
  },
  {
    key: 'system-health-sync',
    description:
      'Checks aurAlpha API health, discovery-engine health, scheduler worker health, Binance exchange health, and system broker connection health.',
    sourcesSql: "JSON_ARRAY('health')",
    useSystemConnectionsOnly: true,
  },
  {
    key: 'asset-price-sync',
    description:
      'Fetches latest prices for system broker assets from system market sources (Mudrex, Delta Exchange).',
    sourcesSql: "JSON_ARRAY('mudrex', 'delta_exchange')",
    useSystemConnectionsOnly: true,
  },
];

const GLOBAL_SYSTEM_SCHEDULER_KEYS = GLOBAL_SYSTEM_SCHEDULERS.map((item) => item.key);

@Service()
export class EnforceGlobalSystemSchedulerScope1770711000000
  implements MigrationInterface
{
  name = 'EnforceGlobalSystemSchedulerScope1770711000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('scheduler_configs')) {
      for (const scheduler of GLOBAL_SYSTEM_SCHEDULERS) {
        await queryRunner.query(
          `
            UPDATE scheduler_configs
            SET scheduler_type = 'global',
                description = ?,
                config = CAST(
                  JSON_SET(
                    CASE
                      WHEN config IS NULL
                        OR TRIM(CAST(config AS CHAR)) = ''
                        OR JSON_VALID(CAST(config AS CHAR)) = 0
                        THEN JSON_OBJECT()
                      ELSE CAST(config AS JSON)
                    END,
                    '$.sources', ${scheduler.sourcesSql}
                    ${scheduler.useSystemConnectionsOnly ? ", '$.useSystemConnectionsOnly', CAST('true' AS JSON)" : ''}
                    ${scheduler.useSystemAccountsOnly ? ", '$.useSystemAccountsOnly', CAST('true' AS JSON)" : ''}
                  ) AS CHAR
                )
            WHERE \`key\` = ?
          `,
          [scheduler.description, scheduler.key]
        );
      }
    }

    if (await queryRunner.hasTable('scheduler_user_configs')) {
      await queryRunner.query(
        `
          DELETE FROM scheduler_user_configs
          WHERE scheduler_key IN (${GLOBAL_SYSTEM_SCHEDULER_KEYS.map(() => '?').join(', ')})
        `,
        GLOBAL_SYSTEM_SCHEDULER_KEYS
      );
    }

    if (
      (await queryRunner.hasTable('scheduler_commands')) &&
      (await queryRunner.hasColumn('scheduler_commands', 'actor_user_id'))
    ) {
      await queryRunner.query(
        `
          UPDATE scheduler_commands
          SET actor_user_id = NULL
          WHERE scheduler_key IN (${GLOBAL_SYSTEM_SCHEDULER_KEYS.map(() => '?').join(', ')})
        `,
        GLOBAL_SYSTEM_SCHEDULER_KEYS
      );
    }

    if (
      (await queryRunner.hasTable('scheduler_commands')) &&
      (await queryRunner.hasColumn('scheduler_commands', 'payload_json'))
    ) {
      await queryRunner.query(
        `
          UPDATE scheduler_commands
          SET payload_json = CAST(
            JSON_REMOVE(CAST(payload_json AS JSON), '$.actorUserId')
            AS CHAR
          )
          WHERE scheduler_key IN (${GLOBAL_SYSTEM_SCHEDULER_KEYS.map(() => '?').join(', ')})
            AND payload_json IS NOT NULL
            AND JSON_VALID(CAST(payload_json AS CHAR)) = 1
            AND JSON_EXTRACT(CAST(payload_json AS JSON), '$.actorUserId') IS NOT NULL
        `,
        GLOBAL_SYSTEM_SCHEDULER_KEYS
      );
    }

    if (
      (await queryRunner.hasTable('scheduler_run_logs')) &&
      (await queryRunner.hasColumn('scheduler_run_logs', 'actor_user_id'))
    ) {
      await queryRunner.query(
        `
          UPDATE scheduler_run_logs
          SET actor_user_id = NULL
          WHERE scheduler_key IN (${GLOBAL_SYSTEM_SCHEDULER_KEYS.map(() => '?').join(', ')})
        `,
        GLOBAL_SYSTEM_SCHEDULER_KEYS
      );
    }

    if (
      (await queryRunner.hasTable('scheduler_run_logs')) &&
      (await queryRunner.hasColumn('scheduler_run_logs', 'meta_json'))
    ) {
      await queryRunner.query(
        `
          UPDATE scheduler_run_logs
          SET meta_json = CAST(
            JSON_REMOVE(CAST(meta_json AS JSON), '$.actorUserId')
            AS CHAR
          )
          WHERE scheduler_key IN (${GLOBAL_SYSTEM_SCHEDULER_KEYS.map(() => '?').join(', ')})
            AND meta_json IS NOT NULL
            AND JSON_VALID(CAST(meta_json AS CHAR)) = 1
            AND JSON_EXTRACT(CAST(meta_json AS JSON), '$.actorUserId') IS NOT NULL
        `,
        GLOBAL_SYSTEM_SCHEDULER_KEYS
      );
    }
  }

  public async down(): Promise<void> {
    // Intentional no-op. This migration enforces the final system-owned scheduler contract.
  }
}
