import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class BackfillDiscoverySchedulerPolicySnapshot1767300009000
  implements MigrationInterface
{
  name = 'BackfillDiscoverySchedulerPolicySnapshot1767300009000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('scheduler_user_configs'))) {
      return;
    }

    await queryRunner.query(`
      UPDATE scheduler_user_configs
      SET config = JSON_OBJECT()
      WHERE scheduler_key = 'discovery-self-identify-sync'
        AND (config IS NULL OR TRIM(config) = '' OR JSON_VALID(config) = 0)
    `);

    await queryRunner.query(`
      UPDATE scheduler_user_configs
      SET config = JSON_SET(CAST(config AS JSON), '$.discoveryPolicy', JSON_OBJECT())
      WHERE scheduler_key = 'discovery-self-identify-sync'
        AND JSON_EXTRACT(CAST(config AS JSON), '$.discoveryPolicy') IS NULL
    `);

    await queryRunner.query(`
      UPDATE scheduler_user_configs
      SET config = JSON_SET(
        CAST(config AS JSON),
        '$.discoveryPolicy.templateImprovementWindowDays',
        CAST(60 AS JSON)
      )
      WHERE scheduler_key = 'discovery-self-identify-sync'
        AND JSON_EXTRACT(CAST(config AS JSON), '$.discoveryPolicy.templateImprovementWindowDays') IS NULL
    `);

    await queryRunner.query(`
      UPDATE scheduler_user_configs
      SET config = JSON_SET(
        CAST(config AS JSON),
        '$.discoveryPolicy.templateImprovementMaxAssets',
        CAST(20 AS JSON)
      )
      WHERE scheduler_key = 'discovery-self-identify-sync'
        AND JSON_EXTRACT(CAST(config AS JSON), '$.discoveryPolicy.templateImprovementMaxAssets') IS NULL
    `);

    await queryRunner.query(`
      UPDATE scheduler_user_configs
      SET config = JSON_SET(
        CAST(config AS JSON),
        '$.discoveryPolicy.templateImprovementMaxTimeframes',
        CAST(5 AS JSON)
      )
      WHERE scheduler_key = 'discovery-self-identify-sync'
        AND JSON_EXTRACT(CAST(config AS JSON), '$.discoveryPolicy.templateImprovementMaxTimeframes') IS NULL
    `);

    await queryRunner.query(`
      UPDATE scheduler_user_configs
      SET config = JSON_SET(
        CAST(config AS JSON),
        '$.discoveryPolicy.templateImprovementMinimumTimeframes',
        CAST(3 AS JSON)
      )
      WHERE scheduler_key = 'discovery-self-identify-sync'
        AND JSON_EXTRACT(CAST(config AS JSON), '$.discoveryPolicy.templateImprovementMinimumTimeframes') IS NULL
    `);

    await queryRunner.query(`
      UPDATE scheduler_user_configs
      SET config = JSON_SET(
        CAST(config AS JSON),
        '$.discoveryPolicy.templateImprovementFillTimeframes',
        JSON_ARRAY('5m', '15m', '1h')
      )
      WHERE scheduler_key = 'discovery-self-identify-sync'
        AND (
          JSON_EXTRACT(CAST(config AS JSON), '$.discoveryPolicy.templateImprovementFillTimeframes') IS NULL
          OR JSON_TYPE(
            JSON_EXTRACT(CAST(config AS JSON), '$.discoveryPolicy.templateImprovementFillTimeframes')
          ) <> 'ARRAY'
          OR JSON_LENGTH(
            JSON_EXTRACT(CAST(config AS JSON), '$.discoveryPolicy.templateImprovementFillTimeframes')
          ) = 0
        )
    `);

    await queryRunner.query(`
      UPDATE scheduler_user_configs
      SET config = JSON_SET(
        CAST(config AS JSON),
        '$.discoveryPolicy.templateImprovementMinimumTimeframes',
        JSON_EXTRACT(CAST(config AS JSON), '$.discoveryPolicy.templateImprovementMaxTimeframes')
      )
      WHERE scheduler_key = 'discovery-self-identify-sync'
        AND CAST(
              JSON_UNQUOTE(
                JSON_EXTRACT(CAST(config AS JSON), '$.discoveryPolicy.templateImprovementMinimumTimeframes')
              ) AS UNSIGNED
            ) > CAST(
              JSON_UNQUOTE(
                JSON_EXTRACT(CAST(config AS JSON), '$.discoveryPolicy.templateImprovementMaxTimeframes')
              ) AS UNSIGNED
            )
    `);
  }

  public async down(): Promise<void> {
    // Irreversible data backfill.
  }
}
