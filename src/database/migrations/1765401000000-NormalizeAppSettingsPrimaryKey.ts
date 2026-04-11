import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

type ColumnExtraRow = {
  extra?: string | null;
  EXTRA?: string | null;
  extraValue?: string | null;
};

@Service()
export class NormalizeAppSettingsPrimaryKey1765401000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('app_settings'))) {
      return;
    }

    const column = await this.readIdColumnExtra(queryRunner);
    const extra = String(column?.extraValue ?? column?.EXTRA ?? column?.extra ?? '').toLowerCase();

    if (!column || extra.includes('auto_increment')) {
      return;
    }

    await queryRunner.query('ALTER TABLE app_settings MODIFY id int NOT NULL AUTO_INCREMENT');
  }

  public async down(): Promise<void> {
    // Historical migration 1741474200000 now creates app_settings.id correctly.
    // This normalization only repairs older drifted databases, so rollback is a no-op.
    return;
  }

  private async readIdColumnExtra(queryRunner: QueryRunner): Promise<ColumnExtraRow | null> {
    const rows = (await queryRunner.query(
      `
        SELECT EXTRA AS extraValue
        FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND table_name = ?
          AND column_name = ?
        LIMIT 1
      `,
      ['app_settings', 'id']
    )) as ColumnExtraRow[];

    if (!Array.isArray(rows) || rows.length === 0) {
      return null;
    }

    return rows[0] ?? null;
  }
}
