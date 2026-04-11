import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class AddAlertsThrottleLookupIndex1763317000000 implements MigrationInterface {
  name = 'AddAlertsThrottleLookupIndex1763317000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE alerts
      ADD INDEX idx_alerts_user_status_channel_source_created_at
      (user_id, status, channel, source, createdAt)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE alerts
      DROP INDEX idx_alerts_user_status_channel_source_created_at
    `);
  }
}
