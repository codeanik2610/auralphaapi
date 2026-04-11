import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class AddBaseUrlToBrokerAndExchangeMasters1762902000000 implements MigrationInterface {
  name = 'AddBaseUrlToBrokerAndExchangeMasters1762902000000';

  private async updateBrokerAccountConfigBaseUrlRequirement(
    queryRunner: QueryRunner,
    brokerKey: string
  ): Promise<void> {
    const rows = await queryRunner.query(
      'SELECT id, account_config FROM brokers WHERE broker_key = ? LIMIT 1',
      [brokerKey]
    );

    if (!rows.length || !rows[0]?.account_config) {
      return;
    }

    let parsedConfig: Record<string, unknown> | null = null;
    try {
      parsedConfig = JSON.parse(String(rows[0].account_config));
    } catch {
      parsedConfig = null;
    }

    if (!parsedConfig || !Array.isArray(parsedConfig.fields)) {
      return;
    }

    const updatedFields = parsedConfig.fields.map((field) => {
      if (!field || typeof field !== 'object') {
        return field;
      }

      const record = field as Record<string, unknown>;
      const key = String(record.key ?? '').trim().toLowerCase();
      if (key !== 'baseurl') {
        return record;
      }

      return {
        ...record,
        required: false,
        helpText:
          String(record.helpText || '').trim() ||
          'Optional override. If left blank, master base URL will be used.',
      };
    });

    await queryRunner.query(
      'UPDATE brokers SET account_config = ?, updated_at = NOW() WHERE id = ?',
      [JSON.stringify({ ...parsedConfig, fields: updatedFields }), rows[0].id]
    );
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasColumn('brokers', 'base_url'))) {
      await queryRunner.query(
        'ALTER TABLE brokers ADD COLUMN base_url varchar(255) NULL AFTER linked_exchange_key'
      );
    }

    if (!(await queryRunner.hasColumn('exchanges', 'base_url'))) {
      await queryRunner.query(
        'ALTER TABLE exchanges ADD COLUMN base_url varchar(255) NULL AFTER status'
      );
    }

    await queryRunner.query(
      "UPDATE brokers SET base_url = 'https://trade.mudrex.com', updated_at = NOW() WHERE broker_key = 'mudrex' AND (base_url IS NULL OR base_url = '')"
    );
    await queryRunner.query(
      "UPDATE brokers SET base_url = 'https://api.india.delta.exchange', updated_at = NOW() WHERE broker_key = 'delta_exchange' AND (base_url IS NULL OR base_url = '')"
    );
    await queryRunner.query(
      "UPDATE exchanges SET base_url = 'https://fapi.binance.com', updated_at = NOW() WHERE exchange_key = 'binance' AND (base_url IS NULL OR base_url = '')"
    );
    await queryRunner.query(
      "UPDATE exchanges SET base_url = 'https://api.india.delta.exchange', updated_at = NOW() WHERE exchange_key = 'delta_exchange' AND (base_url IS NULL OR base_url = '')"
    );

    await this.updateBrokerAccountConfigBaseUrlRequirement(queryRunner, 'mudrex');
    await this.updateBrokerAccountConfigBaseUrlRequirement(queryRunner, 'delta_exchange');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasColumn('exchanges', 'base_url')) {
      await queryRunner.query('ALTER TABLE exchanges DROP COLUMN base_url');
    }

    if (await queryRunner.hasColumn('brokers', 'base_url')) {
      await queryRunner.query('ALTER TABLE brokers DROP COLUMN base_url');
    }
  }
}
