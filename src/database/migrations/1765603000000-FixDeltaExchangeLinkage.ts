import { randomUUID } from 'crypto';
import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class FixDeltaExchangeLinkage1765603000000 implements MigrationInterface {
  name = 'FixDeltaExchangeLinkage1765603000000';

  private async ensureDeltaExchangeMaster(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('exchanges'))) {
      return;
    }

    const rows = await queryRunner.query(
      'SELECT id FROM exchanges WHERE LOWER(TRIM(exchange_key)) = ? LIMIT 1',
      ['delta_exchange']
    );

    if (!rows.length) {
      await queryRunner.query(
        `INSERT INTO exchanges (id, exchange_key, name, status, created_at, updated_at)
         VALUES (?, 'delta_exchange', 'Delta Exchange', 'active', NOW(), NOW())`,
        [randomUUID()]
      );
    }
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.ensureDeltaExchangeMaster(queryRunner);

    if (await queryRunner.hasTable('exchanges')) {
      if (await queryRunner.hasColumn('exchanges', 'base_url')) {
        await queryRunner.query(
          `UPDATE exchanges
           SET name = 'Delta Exchange',
               status = 'active',
               base_url = COALESCE(NULLIF(base_url, ''), 'https://api.india.delta.exchange'),
               updated_at = NOW()
           WHERE LOWER(TRIM(exchange_key)) = 'delta_exchange'`
        );
      } else {
        await queryRunner.query(
          `UPDATE exchanges
           SET name = 'Delta Exchange',
               status = 'active',
               updated_at = NOW()
           WHERE LOWER(TRIM(exchange_key)) = 'delta_exchange'`
        );
      }
    }

    if (await queryRunner.hasTable('brokers')) {
      const hasProviderType = await queryRunner.hasColumn('brokers', 'provider_type');
      const hasLinkedExchangeKey = await queryRunner.hasColumn('brokers', 'linked_exchange_key');

      if (hasProviderType && hasLinkedExchangeKey) {
        await queryRunner.query(
          `UPDATE brokers
           SET provider_type = 'exchange',
               linked_exchange_key = 'delta_exchange',
               updated_at = NOW()
           WHERE LOWER(TRIM(broker_key)) = 'delta_exchange'`
        );
      }
    }

    if (
      (await queryRunner.hasTable('connections')) &&
      (await queryRunner.hasColumn('connections', 'exchange_id'))
    ) {
      await queryRunner.query(
        `UPDATE connections c
         JOIN exchanges e ON LOWER(TRIM(e.exchange_key)) = 'delta_exchange'
         SET c.exchange_id = e.id
         WHERE LOWER(TRIM(c.brokerKey)) = 'delta_exchange'
           AND (c.exchange_id IS NULL OR c.exchange_id <> e.id)`
      );
    }

    if (
      (await queryRunner.hasTable('broker_assets')) &&
      (await queryRunner.hasColumn('broker_assets', 'exchange_id'))
    ) {
      await queryRunner.query(
        `UPDATE broker_assets ea
         JOIN exchanges e ON LOWER(TRIM(e.exchange_key)) = 'delta_exchange'
         SET ea.exchange_id = e.id
         WHERE LOWER(TRIM(ea.source)) = 'delta_exchange'
           AND (ea.exchange_id IS NULL OR ea.exchange_id <> e.id)`
      );
    }
  }

  public async down(): Promise<void> {
    // Intentionally left empty so rollback does not restore invalid broker metadata.
  }
}
