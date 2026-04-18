import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

const GLOBAL_SYSTEM_SCHEDULERS: Array<{
  key: string;
  description: string;
}> = [
  {
    key: 'broker-assets-sync',
    description:
      'Fetches provider assets for system broker accounts and updates the global broker assets catalog.',
  },
  {
    key: 'exchange-assets-sync',
    description:
      'Syncs the global exchange assets catalog from Binance exchangeInfo using Binance base URL configured in system exchange metadata.',
  },
  {
    key: 'binance-candles-3m-1m-sync',
    description:
      'Fetches 3 months of 1m candles from Binance for global system exchange assets and stores them in Postgres.',
  },
  {
    key: 'system-health-sync',
    description:
      'Checks aurAlpha API health, discovery-engine health, scheduler worker health, Binance exchange health, and system broker connection health.',
  },
  {
    key: 'asset-price-sync',
    description:
      'Fetches latest prices for system broker assets from system market sources (Mudrex, Delta Exchange).',
  },
];

const GLOBAL_SYSTEM_SCHEDULER_KEYS = GLOBAL_SYSTEM_SCHEDULERS.map((item) => item.key);

@Service()
export class NormalizeGlobalSystemSchedulerOwnership1770710000000
  implements MigrationInterface
{
  name = 'NormalizeGlobalSystemSchedulerOwnership1770710000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('scheduler_configs')) {
      for (const scheduler of GLOBAL_SYSTEM_SCHEDULERS) {
        await queryRunner.query(
          `
            UPDATE scheduler_configs
            SET scheduler_type = 'global',
                description = ?
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

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('scheduler_configs'))) {
      return;
    }

    await queryRunner.query(
      `
        UPDATE scheduler_configs
        SET description = 'Fetches provider assets and updates broker assets for system accounts'
        WHERE \`key\` = 'broker-assets-sync'
      `
    );
    await queryRunner.query(
      `
        UPDATE scheduler_configs
        SET description = 'Syncs assets table from Binance exchangeInfo using Binance base URL configured in DB.'
        WHERE \`key\` = 'exchange-assets-sync'
      `
    );
    await queryRunner.query(
      `
        UPDATE scheduler_configs
        SET description = 'Fetches 3 months of 1m candles from Binance for unique exchange assets and stores in Postgres'
        WHERE \`key\` = 'binance-candles-3m-1m-sync'
      `
    );
    await queryRunner.query(
      `
        UPDATE scheduler_configs
        SET description = 'Checks aurAlpha API health, discovery-engine health, scheduler worker health, Binance exchange health, and broker connection health.'
        WHERE \`key\` = 'system-health-sync'
      `
    );
    await queryRunner.query(
      `
        UPDATE scheduler_configs
        SET scheduler_type = 'user',
            description = 'Fetches latest asset prices from connected brokers (Mudrex, Delta Exchange) for monitored assets.'
        WHERE \`key\` = 'asset-price-sync'
      `
    );
  }
}
