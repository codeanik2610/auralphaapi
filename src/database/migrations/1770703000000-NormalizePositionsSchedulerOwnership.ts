import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class NormalizePositionsSchedulerOwnership1770703000000
  implements MigrationInterface
{
  name = 'NormalizePositionsSchedulerOwnership1770703000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('scheduler_configs')) {
      await queryRunner.query(`
        UPDATE scheduler_configs
        SET scheduler_type = 'global',
            description = 'System reconciliation scheduler for broker position snapshots, checkpoints, and read-model hydration.'
        WHERE \`key\` = 'positions-sync'
      `);
    }

    if (await queryRunner.hasTable('scheduler_user_configs')) {
      await queryRunner.query(`
        DELETE FROM scheduler_user_configs
        WHERE scheduler_key = 'positions-sync'
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('scheduler_configs')) {
      await queryRunner.query(`
        UPDATE scheduler_configs
        SET description = 'Reconciles positions in monitor mode with pending-first checkpoints and data-loss guards.'
        WHERE \`key\` = 'positions-sync'
      `);
    }
  }
}
