import { MigrationInterface, QueryRunner, Table, TableColumn, TableIndex } from 'typeorm';
import { Service } from 'typedi';

async function addColumnIfMissing(
  queryRunner: QueryRunner,
  tableName: string,
  column: TableColumn
): Promise<void> {
  if (!(await queryRunner.hasColumn(tableName, column.name))) {
    await queryRunner.addColumn(tableName, column);
  }
}

async function addIndexIfMissing(
  queryRunner: QueryRunner,
  tableName: string,
  index: TableIndex
): Promise<void> {
  const table = await queryRunner.getTable(tableName);
  const hasIndex = table?.indices.some((item) => item.name === index.name) ?? false;
  if (!hasIndex) {
    await queryRunner.createIndex(tableName, index);
  }
}

@Service()
export class AddWhatsappSuggestionSettingsAndQueue1800001100000 implements MigrationInterface {
  name = 'AddWhatsappSuggestionSettingsAndQueue1800001100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('app_settings')) {
      await addColumnIfMissing(
        queryRunner,
        'app_settings',
        new TableColumn({
          name: 'notifyWhatsapp',
          type: 'tinyint',
          default: 0,
        })
      );
      await addColumnIfMissing(
        queryRunner,
        'app_settings',
        new TableColumn({
          name: 'whatsappLiveTradeSuggestions',
          type: 'tinyint',
          default: 0,
        })
      );
      await addColumnIfMissing(
        queryRunner,
        'app_settings',
        new TableColumn({
          name: 'whatsappNumber',
          type: 'varchar',
          length: '32',
          isNullable: true,
        })
      );
      await addColumnIfMissing(
        queryRunner,
        'app_settings',
        new TableColumn({
          name: 'whatsappVerifiedAt',
          type: 'timestamp',
          isNullable: true,
        })
      );
    }

    if (!(await queryRunner.hasTable('whatsapp_deliveries'))) {
      await queryRunner.createTable(
        new Table({
          name: 'whatsapp_deliveries',
          columns: [
            { name: 'id', type: 'char', length: '36', isPrimary: true },
            { name: 'user_id', type: 'varchar', length: '191' },
            { name: 'suggested_trade_id', type: 'char', length: '36', isNullable: true },
            { name: 'automation_id', type: 'char', length: '36', isNullable: true },
            { name: 'automation_run_id', type: 'char', length: '36', isNullable: true },
            { name: 'recipient_phone', type: 'varchar', length: '32' },
            { name: 'template_key', type: 'varchar', length: '64' },
            { name: 'body', type: 'text' },
            { name: 'channel', type: 'varchar', length: '32', default: "'whatsapp'" },
            { name: 'severity', type: 'varchar', length: '20' },
            { name: 'route', type: 'varchar', length: '100', isNullable: true },
            { name: 'source', type: 'varchar', length: '100', isNullable: true },
            { name: 'status', type: 'varchar', length: '20', default: "'Queued'" },
            { name: 'attempts', type: 'int', default: 0 },
            { name: 'last_error', type: 'text', isNullable: true },
            { name: 'dedupe_key', type: 'varchar', length: '191', isNullable: true },
            { name: 'provider_message_id', type: 'varchar', length: '191', isNullable: true },
            { name: 'sent_at', type: 'timestamp', isNullable: true },
            { name: 'created_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
            {
              name: 'updated_at',
              type: 'timestamp',
              default: 'CURRENT_TIMESTAMP',
              onUpdate: 'CURRENT_TIMESTAMP',
            },
          ],
        })
      );
    }

    await addIndexIfMissing(
      queryRunner,
      'whatsapp_deliveries',
      new TableIndex({
        name: 'idx_whatsapp_deliveries_status_created_at',
        columnNames: ['status', 'created_at'],
      })
    );
    await addIndexIfMissing(
      queryRunner,
      'whatsapp_deliveries',
      new TableIndex({
        name: 'idx_whatsapp_deliveries_user_created_at',
        columnNames: ['user_id', 'created_at'],
      })
    );
    await addIndexIfMissing(
      queryRunner,
      'whatsapp_deliveries',
      new TableIndex({
        name: 'idx_whatsapp_deliveries_status_updated_at',
        columnNames: ['status', 'updated_at'],
      })
    );
    await addIndexIfMissing(
      queryRunner,
      'whatsapp_deliveries',
      new TableIndex({
        name: 'uidx_whatsapp_deliveries_dedupe_key',
        columnNames: ['dedupe_key'],
        isUnique: true,
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('whatsapp_deliveries')) {
      await queryRunner.dropTable('whatsapp_deliveries');
    }

    if (await queryRunner.hasTable('app_settings')) {
      if (await queryRunner.hasColumn('app_settings', 'whatsappVerifiedAt')) {
        await queryRunner.dropColumn('app_settings', 'whatsappVerifiedAt');
      }
      if (await queryRunner.hasColumn('app_settings', 'whatsappNumber')) {
        await queryRunner.dropColumn('app_settings', 'whatsappNumber');
      }
      if (await queryRunner.hasColumn('app_settings', 'whatsappLiveTradeSuggestions')) {
        await queryRunner.dropColumn('app_settings', 'whatsappLiveTradeSuggestions');
      }
      if (await queryRunner.hasColumn('app_settings', 'notifyWhatsapp')) {
        await queryRunner.dropColumn('app_settings', 'notifyWhatsapp');
      }
    }
  }
}
