import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class DisableLegacySignalsSchedulerAnchorForUserRollout1770500000000
  implements MigrationInterface
{
  name = 'DisableLegacySignalsSchedulerAnchorForUserRollout1770500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('scheduler_configs')) {
      await queryRunner.query(`
        UPDATE scheduler_configs
        SET enabled = 0,
            scheduler_type = 'global'
        WHERE \`key\` = 'signals-scan-sync'
      `);
    }

    if (await queryRunner.hasTable('scheduler_user_configs')) {
      await queryRunner.query(`
        UPDATE scheduler_user_configs
        SET enabled = 0,
            scheduler_type = 'user'
        WHERE scheduler_key = 'signals-scan-sync'
      `);
    }
  }

  public async down(): Promise<void> {
    // Irreversible rollout safety normalization.
  }
}
