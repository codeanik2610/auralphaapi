import { createHash } from 'node:crypto';
import { Service } from 'typedi';
import { MigrationInterface, QueryRunner, TableColumn, TableIndex } from 'typeorm';

@Service()
export class AddActivityExportFilterSignature1765809000000 implements MigrationInterface {
  name = 'AddActivityExportFilterSignature1765809000000';

  private readonly signatureIndex = new TableIndex({
    name: 'idx_activity_exports_user_status_signature',
    columnNames: ['user_id', 'status', 'filter_signature', 'expires_at'],
  });

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('activity_exports'))) {
      return;
    }

    const table = await queryRunner.getTable('activity_exports');
    if (!table) {
      return;
    }

    if (!table.findColumnByName('filter_signature')) {
      await queryRunner.addColumn(
        'activity_exports',
        new TableColumn({
          name: 'filter_signature',
          type: 'varchar',
          length: '64',
          isNullable: true,
        })
      );
    }

    const refreshedTable = await queryRunner.getTable('activity_exports');
    if (!refreshedTable) {
      return;
    }

    if (!refreshedTable.indices.some((entry) => entry.name === this.signatureIndex.name)) {
      await queryRunner.createIndex('activity_exports', this.signatureIndex);
    }

    const rows = await queryRunner.query(
      'SELECT id, filters_json AS filtersJson, filter_signature AS filterSignature FROM activity_exports WHERE filter_signature IS NULL'
    );

    for (const row of rows) {
      const signature = this.buildFilterSignature(row?.filtersJson);
      if (!signature) {
        continue;
      }

      await queryRunner.query(
        'UPDATE activity_exports SET filter_signature = ? WHERE id = ?',
        [signature, row.id]
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('activity_exports'))) {
      return;
    }

    const table = await queryRunner.getTable('activity_exports');
    if (!table) {
      return;
    }

    if (this.signatureIndex.name && table.indices.some((entry) => entry.name === this.signatureIndex.name)) {
      await queryRunner.dropIndex('activity_exports', this.signatureIndex.name);
    }

    const refreshedTable = await queryRunner.getTable('activity_exports');
    if (refreshedTable?.findColumnByName('filter_signature')) {
      await queryRunner.dropColumn('activity_exports', 'filter_signature');
    }
  }

  private buildFilterSignature(rawFilters: unknown): string | null {
    const filters = this.normalizeFilters(this.parseFilters(rawFilters));
    const entries = Object.entries(filters).sort(([left], [right]) => left.localeCompare(right));
    if (!entries.length) {
      return null;
    }

    return createHash('sha256').update(JSON.stringify(entries)).digest('hex');
  }

  private parseFilters(rawFilters: unknown): Record<string, unknown> | null {
    if (!rawFilters) {
      return null;
    }

    if (typeof rawFilters === 'string') {
      try {
        const parsed = JSON.parse(rawFilters);
        return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
      } catch {
        return null;
      }
    }

    return typeof rawFilters === 'object' ? (rawFilters as Record<string, unknown>) : null;
  }

  private normalizeFilters(filters?: Record<string, unknown> | null): Record<string, string> {
    if (!filters) {
      return {};
    }

    return Object.entries(filters).reduce<Record<string, string>>((acc, [key, value]) => {
      const normalizedKey = String(key || '').trim();
      const normalizedValue = String(value || '').trim();
      if (!normalizedKey || !normalizedValue) {
        return acc;
      }
      acc[normalizedKey] = normalizedValue;
      return acc;
    }, {});
  }
}
