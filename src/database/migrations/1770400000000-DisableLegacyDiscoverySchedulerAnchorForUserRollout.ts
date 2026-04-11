import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class DisableLegacyDiscoverySchedulerAnchorForUserRollout1770400000000
  implements MigrationInterface
{
  name = 'DisableLegacyDiscoverySchedulerAnchorForUserRollout1770400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('scheduler_configs')) {
      await queryRunner.query(`
        UPDATE scheduler_configs
        SET enabled = 0,
            scheduler_type = 'global'
        WHERE \`key\` = 'discovery-self-identify-sync'
      `);
    }

    if (await queryRunner.hasTable('scheduler_user_configs')) {
      await queryRunner.query(`
        UPDATE scheduler_user_configs
        SET enabled = 0,
            scheduler_type = 'user'
        WHERE scheduler_key = 'discovery-self-identify-sync'
      `);
    }
  }

  public async down(): Promise<void> {
    // Irreversible rollout safety normalization.
  }
}
