import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class ExpandBrokerMasterConfig1762813800000 implements MigrationInterface {
  name = 'ExpandBrokerMasterConfig1762813800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasColumn('brokers', 'category'))) {
      await queryRunner.query("ALTER TABLE brokers ADD COLUMN category varchar(32) NOT NULL DEFAULT 'broker' AFTER name");
    }

    if (!(await queryRunner.hasColumn('brokers', 'provider_type'))) {
      await queryRunner.query("ALTER TABLE brokers ADD COLUMN provider_type varchar(32) NOT NULL DEFAULT 'broker' AFTER status");
    }

    if (!(await queryRunner.hasColumn('brokers', 'linked_exchange_key'))) {
      await queryRunner.query('ALTER TABLE brokers ADD COLUMN linked_exchange_key varchar(100) NULL AFTER provider_type');
    }

    if (!(await queryRunner.hasColumn('brokers', 'capabilities'))) {
      await queryRunner.query('ALTER TABLE brokers ADD COLUMN capabilities text NULL AFTER status');
    }

    if (!(await queryRunner.hasColumn('brokers', 'account_config'))) {
      await queryRunner.query('ALTER TABLE brokers ADD COLUMN account_config text NULL AFTER capabilities');
    }

    if (!(await queryRunner.hasColumn('brokers', 'integration_guide'))) {
      await queryRunner.query('ALTER TABLE brokers ADD COLUMN integration_guide text NULL AFTER account_config');
    }

    if (!(await queryRunner.hasColumn('brokers', 'diagnostics_config'))) {
      await queryRunner.query('ALTER TABLE brokers ADD COLUMN diagnostics_config text NULL AFTER integration_guide');
    }

    await queryRunner.query(
      `UPDATE brokers
       SET category = 'broker',
           provider_type = 'broker',
           linked_exchange_key = NULL,
           capabilities = ?,
           account_config = ?,
           integration_guide = ?,
           diagnostics_config = ?
       WHERE broker_key = 'mudrex'`,
      [
        JSON.stringify(['assets', 'orders', 'positions', 'wallet', 'diagnostics', 'leverage', 'market']),
        JSON.stringify({
          fields: [
            {
              key: 'apiKey',
              label: 'API key',
              type: 'text',
              required: true,
              secret: true,
              helpText: 'Paste the API key generated in the Mudrex broker account.',
            },
            {
              key: 'apiSecret',
              label: 'API secret',
              type: 'secret',
              required: true,
              secret: true,
              helpText: 'Paste the API secret generated in the Mudrex broker account.',
            },
            {
              key: 'baseUrl',
              label: 'Base URL',
              type: 'url',
              required: true,
              placeholder: 'https://trade.mudrex.com',
              helpText: 'Use the broker API base URL for the selected Mudrex environment.',
            },
          ],
        }),
        JSON.stringify({
          summary: 'Create a Mudrex API key, copy the key and secret, and save them against the broker account.',
          steps: [
            {
              title: 'Create credentials',
              description: 'Generate a Mudrex API key with the permissions required for your trading workflow.',
            },
            {
              title: 'Save broker account',
              description: 'Paste the key, secret, and base URL into the broker account form.',
            },
          ],
        }),
        JSON.stringify({
          requiresAccount: true,
          executorKey: 'mudrex-public',
          successStatus: 'Connected',
          failureStatus: 'Disconnected',
          resetStatus: 'Idle',
        }),
      ]
    );

    await queryRunner.query(
      `UPDATE brokers
       SET category = 'exchange',
           provider_type = 'exchange',
           linked_exchange_key = 'delta_exchange',
           capabilities = ?,
           account_config = ?,
           integration_guide = ?,
           diagnostics_config = ?
       WHERE broker_key = 'delta_exchange'`,
      [
        JSON.stringify(['assets', 'orders', 'positions', 'wallet', 'diagnostics', 'market']),
        JSON.stringify({
          fields: [
            {
              key: 'apiKey',
              label: 'API key',
              type: 'text',
              required: true,
              secret: true,
              helpText: 'Paste the Delta Exchange API key.',
            },
            {
              key: 'apiSecret',
              label: 'API secret',
              type: 'secret',
              required: true,
              secret: true,
              helpText: 'Paste the Delta Exchange API secret.',
            },
            {
              key: 'baseUrl',
              label: 'Base URL',
              type: 'url',
              required: true,
              placeholder: 'https://api.india.delta.exchange',
              helpText: 'Use the correct production or testnet URL for this account.',
            },
          ],
        }),
        JSON.stringify({
          summary: 'Create signed Delta Exchange credentials and save them at account level.',
          steps: [
            {
              title: 'Create credentials',
              description: 'Generate a Delta Exchange API key and secret with trading permissions.',
            },
            {
              title: 'Choose environment',
              description: 'Save the production or testnet base URL together with the credentials.',
            },
          ],
        }),
        JSON.stringify({
          requiresAccount: true,
          executorKey: 'delta-exchange',
          successStatus: 'Connected',
          failureStatus: 'Disconnected',
          resetStatus: 'Idle',
        }),
      ]
    );

    await queryRunner.query(
      `INSERT INTO brokers (
        id,
        broker_key,
        name,
        category,
        status,
        provider_type,
        linked_exchange_key,
        capabilities,
        account_config,
        integration_guide,
        diagnostics_config,
        created_at,
        updated_at
      )
      SELECT
        UUID(),
        'binance_market_data',
        'Binance market data',
        'feed',
        'active',
        'exchange',
        'binance',
        ?,
        ?,
        ?,
        ?,
        NOW(),
        NOW()
      FROM DUAL
      WHERE NOT EXISTS (
        SELECT 1 FROM brokers WHERE broker_key = 'binance_market_data'
      )`,
      [
        JSON.stringify(['market', 'diagnostics']),
        JSON.stringify({ fields: [] }),
        JSON.stringify({
          summary: 'Public market data feed for Binance futures market candles.',
          steps: [
            {
              title: 'Select market feed',
              description: 'Use this provider when you need public futures candles without account credentials.',
            },
          ],
        }),
        JSON.stringify({
          requiresAccount: false,
          executorKey: 'binance-market',
          successStatus: 'Connected',
          failureStatus: 'Disconnected',
          resetStatus: 'Idle',
        }),
      ]
    );

    await queryRunner.query(
      `UPDATE brokers
       SET category = COALESCE(category, 'feed'),
           provider_type = CASE WHEN broker_key = 'binance_market_data' THEN 'exchange' ELSE provider_type END,
           linked_exchange_key = CASE WHEN broker_key = 'binance_market_data' THEN 'binance' ELSE linked_exchange_key END
       WHERE broker_key = 'binance_market_data'`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasColumn('brokers', 'diagnostics_config')) {
      await queryRunner.query('ALTER TABLE brokers DROP COLUMN diagnostics_config');
    }
    if (await queryRunner.hasColumn('brokers', 'linked_exchange_key')) {
      await queryRunner.query('ALTER TABLE brokers DROP COLUMN linked_exchange_key');
    }
    if (await queryRunner.hasColumn('brokers', 'provider_type')) {
      await queryRunner.query('ALTER TABLE brokers DROP COLUMN provider_type');
    }
    if (await queryRunner.hasColumn('brokers', 'integration_guide')) {
      await queryRunner.query('ALTER TABLE brokers DROP COLUMN integration_guide');
    }
    if (await queryRunner.hasColumn('brokers', 'account_config')) {
      await queryRunner.query('ALTER TABLE brokers DROP COLUMN account_config');
    }
    if (await queryRunner.hasColumn('brokers', 'capabilities')) {
      await queryRunner.query('ALTER TABLE brokers DROP COLUMN capabilities');
    }
    if (await queryRunner.hasColumn('brokers', 'category')) {
      await queryRunner.query('ALTER TABLE brokers DROP COLUMN category');
    }
  }
}
