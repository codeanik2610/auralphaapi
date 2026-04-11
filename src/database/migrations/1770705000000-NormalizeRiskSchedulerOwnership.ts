import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class NormalizeRiskSchedulerOwnership1770705000000
  implements MigrationInterface
{
  name = 'NormalizeRiskSchedulerOwnership1770705000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('scheduler_configs')) {
      await queryRunner.query(`
        UPDATE scheduler_configs
        SET scheduler_type = 'user',
            name = 'Risk Snapshot Refresh',
            description = 'Admin-owned scheduler for background risk snapshot refresh and risk-center diagnostics across all user-owned connections.'
        WHERE \`key\` = 'risk-recompute-sync'
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('scheduler_configs')) {
      await queryRunner.query(`
        UPDATE scheduler_configs
        SET scheduler_type = 'global',
            name = 'Risk Snapshot Refresh',
            description = 'Global admin scheduler for background risk snapshot refresh requests and risk-center diagnostics.'
        WHERE \`key\` = 'risk-recompute-sync'
      `);
    }
  }
}
