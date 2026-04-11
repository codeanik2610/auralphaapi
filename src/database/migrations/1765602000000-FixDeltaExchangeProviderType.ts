import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class FixDeltaExchangeProviderType1765602000000 implements MigrationInterface {
  name = 'FixDeltaExchangeProviderType1765602000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('brokers'))) {
      return;
    }

    if (!(await queryRunner.hasColumn('brokers', 'provider_type'))) {
      return;
    }

    await queryRunner.query(
      `UPDATE brokers
       SET provider_type = 'exchange'
       WHERE LOWER(TRIM(broker_key)) = 'delta_exchange'
         AND LOWER(TRIM(COALESCE(provider_type, ''))) <> 'exchange'`
    );
  }

  public async down(): Promise<void> {
    // Intentionally left empty so rollback does not restore invalid broker metadata.
  }
}
