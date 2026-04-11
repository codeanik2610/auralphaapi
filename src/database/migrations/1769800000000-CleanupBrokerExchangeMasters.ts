import { randomUUID } from 'crypto';
import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class CleanupBrokerExchangeMasters1769800000000 implements MigrationInterface {
  name = 'CleanupBrokerExchangeMasters1769800000000';

  private async ensureBinanceExchangeMaster(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('exchanges'))) {
      return;
    }

    const rows = await queryRunner.query(
      'SELECT id FROM exchanges WHERE LOWER(TRIM(exchange_key)) = ? LIMIT 1',
      ['binance']
    );

    if (rows.length) {
      return;
    }

    if (await queryRunner.hasColumn('exchanges', 'base_url')) {
      await queryRunner.query(
        `INSERT INTO exchanges (id, exchange_key, name, status, base_url, created_at, updated_at)
         VALUES (?, 'binance', 'Binance', 'active', 'https://fapi.binance.com', NOW(), NOW())`,
        [randomUUID()]
      );
      return;
    }

    await queryRunner.query(
      `INSERT INTO exchanges (id, exchange_key, name, status, created_at, updated_at)
       VALUES (?, 'binance', 'Binance', 'active', NOW(), NOW())`,
      [randomUUID()]
    );
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasBrokers = await queryRunner.hasTable('brokers');
    const hasExchanges = await queryRunner.hasTable('exchanges');
    const hasConnections = await queryRunner.hasTable('connections');
    const hasBrokerAccounts = await queryRunner.hasTable('broker_accounts');
    const hasBrokerAssets = await queryRunner.hasTable('broker_assets');

    if (hasExchanges) {
      await this.ensureBinanceExchangeMaster(queryRunner);

      if (await queryRunner.hasColumn('exchanges', 'base_url')) {
        await queryRunner.query(
          `UPDATE exchanges
           SET name = 'Binance',
               status = 'active',
               base_url = COALESCE(NULLIF(base_url, ''), 'https://fapi.binance.com'),
               updated_at = NOW()
           WHERE LOWER(TRIM(exchange_key)) = 'binance'`
        );
      } else {
        await queryRunner.query(
          `UPDATE exchanges
           SET name = 'Binance',
               status = 'active',
               updated_at = NOW()
           WHERE LOWER(TRIM(exchange_key)) = 'binance'`
        );
      }
    }

    if (hasBrokers) {
      const hasCategory = await queryRunner.hasColumn('brokers', 'category');
      const hasProviderType = await queryRunner.hasColumn('brokers', 'provider_type');
      const hasLinkedExchangeKey = await queryRunner.hasColumn('brokers', 'linked_exchange_key');
      const brokerAssignments: string[] = [];

      if (hasCategory) {
        brokerAssignments.push(`category = 'broker'`);
      }
      if (hasProviderType) {
        brokerAssignments.push(`provider_type = 'broker'`);
      }
      if (hasLinkedExchangeKey) {
        brokerAssignments.push('linked_exchange_key = NULL');
      }
      brokerAssignments.push('updated_at = NOW()');

      await queryRunner.query(
        `UPDATE brokers
         SET ${brokerAssignments.join(', ')}
         WHERE LOWER(TRIM(broker_key)) = 'delta_exchange'`
      );
    }

    if (hasConnections) {
      const hasBrokerKey = await queryRunner.hasColumn('connections', 'brokerKey');
      const hasBrokerId = await queryRunner.hasColumn('connections', 'broker_id');
      const hasExchangeId = await queryRunner.hasColumn('connections', 'exchange_id');

      if (hasBrokerKey) {
        await queryRunner.query(
          `UPDATE connections
           SET brokerKey = 'binance'
           WHERE LOWER(TRIM(brokerKey)) = 'binance_market_data'`
        );
      }

      if (hasBrokerId && hasBrokerKey && hasBrokers) {
        await queryRunner.query(
          `UPDATE connections c
           JOIN brokers b ON LOWER(TRIM(b.broker_key)) = 'delta_exchange'
           SET c.broker_id = b.id
           WHERE LOWER(TRIM(c.brokerKey)) = 'delta_exchange'
             AND (c.broker_id IS NULL OR c.broker_id <> b.id)`
        );
      }

      if (hasBrokerId && hasBrokerKey) {
        await queryRunner.query(
          `UPDATE connections
           SET broker_id = NULL
           WHERE LOWER(TRIM(brokerKey)) IN ('binance_market_data', 'binance')`
        );
      }

      if (hasExchangeId && hasBrokerKey && hasExchanges) {
        await queryRunner.query(
          `UPDATE connections c
           JOIN exchanges e ON LOWER(TRIM(e.exchange_key)) = 'binance'
           SET c.exchange_id = e.id
           WHERE LOWER(TRIM(c.brokerKey)) IN ('binance_market_data', 'binance')
             AND (c.exchange_id IS NULL OR c.exchange_id <> e.id)`
        );
      }

      if (hasExchangeId && hasBrokerKey) {
        await queryRunner.query(
          `UPDATE connections
           SET exchange_id = NULL
           WHERE LOWER(TRIM(brokerKey)) = 'delta_exchange'
             AND exchange_id IS NOT NULL`
        );
      }
    }

    if (hasBrokerAccounts) {
      const hasBrokerKey = await queryRunner.hasColumn('broker_accounts', 'brokerKey');
      const hasBrokerId = await queryRunner.hasColumn('broker_accounts', 'broker_id');

      if (hasBrokerKey) {
        await queryRunner.query(
          `UPDATE broker_accounts
           SET brokerKey = 'binance'
           WHERE LOWER(TRIM(brokerKey)) = 'binance_market_data'`
        );
      }

      if (hasBrokerId && hasBrokerKey && hasBrokers) {
        await queryRunner.query(
          `UPDATE broker_accounts ba
           JOIN brokers b ON LOWER(TRIM(b.broker_key)) = 'delta_exchange'
           SET ba.broker_id = b.id
           WHERE LOWER(TRIM(ba.brokerKey)) = 'delta_exchange'
             AND (ba.broker_id IS NULL OR ba.broker_id <> b.id)`
        );
      }

      if (hasBrokerId && hasBrokerKey) {
        await queryRunner.query(
          `UPDATE broker_accounts
           SET broker_id = NULL
           WHERE LOWER(TRIM(brokerKey)) IN ('binance_market_data', 'binance')`
        );
      }
    }

    if (hasBrokerAssets) {
      const hasSource = await queryRunner.hasColumn('broker_assets', 'source');
      const hasBrokerId = await queryRunner.hasColumn('broker_assets', 'broker_id');
      const hasExchangeId = await queryRunner.hasColumn('broker_assets', 'exchange_id');

      if (hasSource) {
        await queryRunner.query(
          `UPDATE broker_assets
           SET source = 'binance'
           WHERE LOWER(TRIM(source)) = 'binance_market_data'`
        );
      }

      if (hasBrokerId && hasSource && hasBrokers) {
        await queryRunner.query(
          `UPDATE broker_assets ea
           JOIN brokers b ON LOWER(TRIM(b.broker_key)) = 'delta_exchange'
           SET ea.broker_id = b.id
           WHERE LOWER(TRIM(ea.source)) = 'delta_exchange'
             AND (ea.broker_id IS NULL OR ea.broker_id <> b.id)`
        );
      }

      if (hasBrokerId && hasSource) {
        await queryRunner.query(
          `UPDATE broker_assets
           SET broker_id = NULL
           WHERE LOWER(TRIM(source)) IN ('binance_market_data', 'binance')`
        );
      }

      if (hasExchangeId && hasSource && hasExchanges) {
        await queryRunner.query(
          `UPDATE broker_assets ea
           JOIN exchanges e ON LOWER(TRIM(e.exchange_key)) = 'binance'
           SET ea.exchange_id = e.id
           WHERE LOWER(TRIM(ea.source)) IN ('binance_market_data', 'binance')
             AND (ea.exchange_id IS NULL OR ea.exchange_id <> e.id)`
        );
      }

      if (hasExchangeId && hasSource) {
        await queryRunner.query(
          `UPDATE broker_assets
           SET exchange_id = NULL
           WHERE LOWER(TRIM(source)) = 'delta_exchange'
             AND exchange_id IS NOT NULL`
        );
      }
    }

    if (hasBrokers) {
      await queryRunner.query(
        `DELETE FROM brokers
         WHERE LOWER(TRIM(broker_key)) = 'binance_market_data'`
      );
    }

    if (hasExchanges) {
      await queryRunner.query(
        `DELETE FROM exchanges
         WHERE LOWER(TRIM(exchange_key)) = 'delta_exchange'`
      );
    }
  }

  public async down(): Promise<void> {
    // Intentionally left empty so rollback does not restore the legacy mixed broker/exchange model.
  }
}
