import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class RenameStrategiesToStrategyTemplates1763800012000 implements MigrationInterface {
  name = 'RenameStrategiesToStrategyTemplates1763800012000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name = 'strategy_templates'
        )
        AND EXISTS (
          SELECT 1
          FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name = 'strategies'
        ) THEN
          EXECUTE 'ALTER TABLE strategies RENAME TO strategy_templates';
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_strategies_user_updated_at')
           AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_strategy_templates_user_updated_at') THEN
          EXECUTE 'ALTER INDEX idx_strategies_user_updated_at RENAME TO idx_strategy_templates_user_updated_at';
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_strategies_user_status')
           AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_strategy_templates_user_status') THEN
          EXECUTE 'ALTER INDEX idx_strategies_user_status RENAME TO idx_strategy_templates_user_status';
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name = 'strategies'
        )
        AND EXISTS (
          SELECT 1
          FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name = 'strategy_templates'
        ) THEN
          EXECUTE 'ALTER TABLE strategy_templates RENAME TO strategies';
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_strategy_templates_user_updated_at')
           AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_strategies_user_updated_at') THEN
          EXECUTE 'ALTER INDEX idx_strategy_templates_user_updated_at RENAME TO idx_strategies_user_updated_at';
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_strategy_templates_user_status')
           AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_strategies_user_status') THEN
          EXECUTE 'ALTER INDEX idx_strategy_templates_user_status RENAME TO idx_strategies_user_status';
        END IF;
      END $$;
    `);
  }
}
