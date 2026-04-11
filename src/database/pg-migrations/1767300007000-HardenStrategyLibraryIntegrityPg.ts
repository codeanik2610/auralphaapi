import { MigrationInterface, QueryRunner } from 'typeorm';
import { Service } from 'typedi';

@Service()
export class HardenStrategyLibraryIntegrityPg1767300007000 implements MigrationInterface {
  name = 'HardenStrategyLibraryIntegrityPg1767300007000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const duplicateRows = await queryRunner.query(`
      SELECT
        user_id,
        template_id,
        LOWER(BTRIM(name)) AS normalized_name,
        COUNT(*) AS duplicate_count
      FROM strategy_library
      GROUP BY user_id, template_id, LOWER(BTRIM(name))
      HAVING LOWER(BTRIM(name)) <> '' AND COUNT(*) > 1
      LIMIT 5
    `);

    if (duplicateRows.length) {
      const duplicates = duplicateRows
        .map(
          (row: { user_id?: string; template_id?: string; normalized_name?: string }) =>
            `${row.user_id || 'unknown-user'}:${row.template_id || 'unknown-template'}:${row.normalized_name || '<blank>'}`
        )
        .join(', ');
      throw new Error(
        `Cannot harden strategy_library integrity because duplicate user/template/name entries already exist: ${duplicates}`
      );
    }

    const blankNameRows = await queryRunner.query(`
      SELECT id
      FROM strategy_library
      WHERE BTRIM(COALESCE(name, '')) = ''
      LIMIT 5
    `);

    if (blankNameRows.length) {
      const ids = blankNameRows
        .map((row: { id?: string }) => row.id || 'unknown-id')
        .join(', ');
      throw new Error(
        `Cannot harden strategy_library integrity because blank names already exist: ${ids}`
      );
    }

    const invalidStatusRows = await queryRunner.query(`
      SELECT id, status
      FROM strategy_library
      WHERE BTRIM(COALESCE(status, '')) = ''
         OR status NOT IN ('Draft', 'Active', 'Paused', 'Archived')
      LIMIT 5
    `);

    if (invalidStatusRows.length) {
      const statuses = invalidStatusRows
        .map(
          (row: { id?: string; status?: string }) =>
            `${row.id || 'unknown-id'}:${row.status || '<blank>'}`
        )
        .join(', ');
      throw new Error(
        `Cannot harden strategy_library integrity because invalid statuses already exist: ${statuses}`
      );
    }

    const invalidJsonShapeRows = await queryRunner.query(`
      SELECT id
      FROM strategy_library
      WHERE (assets IS NOT NULL AND jsonb_typeof(assets) <> 'array')
         OR (timeframes IS NOT NULL AND jsonb_typeof(timeframes) <> 'array')
         OR (overrides IS NOT NULL AND jsonb_typeof(overrides) <> 'object')
      LIMIT 5
    `);

    if (invalidJsonShapeRows.length) {
      const ids = invalidJsonShapeRows
        .map((row: { id?: string }) => row.id || 'unknown-id')
        .join(', ');
      throw new Error(
        `Cannot harden strategy_library integrity because invalid jsonb shapes already exist: ${ids}`
      );
    }

    const orphanedTemplateRows = await queryRunner.query(`
      SELECT library.id, library.template_id
      FROM strategy_library library
      LEFT JOIN strategy_templates template
        ON template.id = library.template_id
      WHERE template.id IS NULL
      LIMIT 5
    `);

    if (orphanedTemplateRows.length) {
      const orphaned = orphanedTemplateRows
        .map(
          (row: { id?: string; template_id?: string }) =>
            `${row.id || 'unknown-id'}:${row.template_id || 'unknown-template'}`
        )
        .join(', ');
      throw new Error(
        `Cannot harden strategy_library integrity because orphaned template references already exist: ${orphaned}`
      );
    }

    const ownershipMismatchRows = await queryRunner.query(`
      SELECT
        library.id,
        library.user_id,
        library.template_id,
        template.user_id AS template_user_id
      FROM strategy_library library
      INNER JOIN strategy_templates template
        ON template.id = library.template_id
      WHERE library.user_id <> template.user_id
      LIMIT 5
    `);

    if (ownershipMismatchRows.length) {
      const mismatches = ownershipMismatchRows
        .map(
          (row: {
            id?: string;
            user_id?: string;
            template_id?: string;
            template_user_id?: string;
          }) =>
            `${row.id || 'unknown-id'}:${row.user_id || 'unknown-user'}:${row.template_id || 'unknown-template'}:${row.template_user_id || 'unknown-template-user'}`
        )
        .join(', ');
      throw new Error(
        `Cannot harden strategy_library integrity because template ownership mismatches already exist: ${mismatches}`
      );
    }

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'uidx_strategy_templates_user_id_id'
        ) THEN
          ALTER TABLE strategy_templates
          ADD CONSTRAINT uidx_strategy_templates_user_id_id UNIQUE (user_id, id);
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'chk_strategy_library_name_not_blank'
        ) THEN
          ALTER TABLE strategy_library
          ADD CONSTRAINT chk_strategy_library_name_not_blank
          CHECK (BTRIM(COALESCE(name, '')) <> '');
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'chk_strategy_library_status_valid'
        ) THEN
          ALTER TABLE strategy_library
          ADD CONSTRAINT chk_strategy_library_status_valid
          CHECK (status IN ('Draft', 'Active', 'Paused', 'Archived'));
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'chk_strategy_library_assets_array'
        ) THEN
          ALTER TABLE strategy_library
          ADD CONSTRAINT chk_strategy_library_assets_array
          CHECK (assets IS NULL OR jsonb_typeof(assets) = 'array');
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'chk_strategy_library_timeframes_array'
        ) THEN
          ALTER TABLE strategy_library
          ADD CONSTRAINT chk_strategy_library_timeframes_array
          CHECK (timeframes IS NULL OR jsonb_typeof(timeframes) = 'array');
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'chk_strategy_library_overrides_object'
        ) THEN
          ALTER TABLE strategy_library
          ADD CONSTRAINT chk_strategy_library_overrides_object
          CHECK (overrides IS NULL OR jsonb_typeof(overrides) = 'object');
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uidx_strategy_library_user_template_name_ci
      ON strategy_library (user_id, template_id, LOWER(BTRIM(name)))
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'fk_strategy_library_template_id'
        ) THEN
          ALTER TABLE strategy_library
          DROP CONSTRAINT fk_strategy_library_template_id;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'fk_strategy_library_user_template_owner'
        ) THEN
          ALTER TABLE strategy_library
          ADD CONSTRAINT fk_strategy_library_user_template_owner
          FOREIGN KEY (user_id, template_id)
          REFERENCES strategy_templates(user_id, id)
          ON DELETE CASCADE;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'fk_strategy_library_user_template_owner'
        ) THEN
          ALTER TABLE strategy_library
          DROP CONSTRAINT fk_strategy_library_user_template_owner;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'fk_strategy_library_template_id'
        ) THEN
          ALTER TABLE strategy_library
          ADD CONSTRAINT fk_strategy_library_template_id
          FOREIGN KEY (template_id)
          REFERENCES strategy_templates(id)
          ON DELETE CASCADE;
        END IF;
      END $$;
    `);

    await queryRunner.query('DROP INDEX IF EXISTS uidx_strategy_library_user_template_name_ci');

    for (const constraintName of [
      'chk_strategy_library_overrides_object',
      'chk_strategy_library_timeframes_array',
      'chk_strategy_library_assets_array',
      'chk_strategy_library_status_valid',
      'chk_strategy_library_name_not_blank',
    ]) {
      await queryRunner.query(`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conname = '${constraintName}'
          ) THEN
            ALTER TABLE strategy_library
            DROP CONSTRAINT ${constraintName};
          END IF;
        END $$;
      `);
    }

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'uidx_strategy_templates_user_id_id'
        ) THEN
          ALTER TABLE strategy_templates
          DROP CONSTRAINT uidx_strategy_templates_user_id_id;
        END IF;
      END $$;
    `);
  }
}
