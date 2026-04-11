import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class NormalizeRetiredLegacySchedulerTimezones1770708000000
  implements MigrationInterface
{
  name = 'NormalizeRetiredLegacySchedulerTimezones1770708000000';

  private readonly retiredSchedulerKeys = [
    'signals-scan-sync',
    'discovery-self-identify-sync',
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('scheduler_configs')) {
      await queryRunner.query(
        `
          UPDATE scheduler_configs
          SET timezone = 'UTC'
          WHERE \`key\` IN (?, ?)
            AND (
              timezone IS NULL
              OR TRIM(timezone) = ''
              OR UPPER(TRIM(timezone)) <> 'UTC'
            )
        `,
        this.retiredSchedulerKeys
      );
    }

    if (await queryRunner.hasTable('scheduler_user_configs')) {
      await queryRunner.query(
        `
          UPDATE scheduler_user_configs
          SET timezone = 'UTC'
          WHERE scheduler_key IN (?, ?)
            AND (
              timezone IS NULL
              OR TRIM(timezone) = ''
              OR UPPER(TRIM(timezone)) <> 'UTC'
            )
        `,
        this.retiredSchedulerKeys
      );
    }
  }

  public async down(): Promise<void> {
    // Irreversible data normalization for retired scheduler rows.
  }
}
