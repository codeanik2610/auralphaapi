import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class WidenRiskSourceCoverageSnapshotDateColumns1770806600000
  implements MigrationInterface
{
  name = 'WidenRiskSourceCoverageSnapshotDateColumns1770806600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE risk_snapshot_source_coverage
        MODIFY latest_funds_snapshot_date varchar(64) DEFAULT NULL,
        MODIFY latest_success_funds_snapshot_date varchar(64) DEFAULT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE risk_snapshot_source_coverage
        MODIFY latest_funds_snapshot_date varchar(10) DEFAULT NULL,
        MODIFY latest_success_funds_snapshot_date varchar(10) DEFAULT NULL;
    `);
  }
}
