import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class UpdateSystemHealthSchedulerDescriptionForBinance1763394000000 implements MigrationInterface {
  name = 'UpdateSystemHealthSchedulerDescriptionForBinance1763394000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE scheduler_configs
      SET description = 'Checks aurAlpha API health, discovery-engine health, scheduler worker health, Binance exchange health, and broker connection health.'
      WHERE \`key\` = 'system-health-sync';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE scheduler_configs
      SET description = 'Checks aurAlpha API health, discovery-engine health, scheduler worker health, and broker connection health.'
      WHERE \`key\` = 'system-health-sync';
    `);
  }
}
