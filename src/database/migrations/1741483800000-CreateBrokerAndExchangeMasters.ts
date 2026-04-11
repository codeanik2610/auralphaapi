import { randomUUID } from 'crypto';
import { Service } from 'typedi';
import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

@Service()
export class CreateBrokerAndExchangeMasters1741483800000 implements MigrationInterface {
  name = 'CreateBrokerAndExchangeMasters1741483800000';

  private async hasIndex(queryRunner: QueryRunner, table: string, indexName: string): Promise<boolean> {
    const rows = await queryRunner.query(`SHOW INDEX FROM ${table} WHERE Key_name = ?`, [indexName]);
    return rows.length > 0;
  }

  private async hasForeignKey(queryRunner: QueryRunner, table: string, fkName: string): Promise<boolean> {
    const rows = await queryRunner.query(
      `SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_TYPE = 'FOREIGN KEY' AND CONSTRAINT_NAME = ?`,
      [table, fkName]
    );
    return rows.length > 0;
  }

  private async ensureMasterRow(queryRunner: QueryRunner, table: 'brokers' | 'exchanges', keyColumn: string, key: string, name: string): Promise<void> {
    const rows = await queryRunner.query(`SELECT id FROM ${table} WHERE ${keyColumn} = ? LIMIT 1`, [key]);
    if (!rows.length) {
      await queryRunner.query(
        `INSERT INTO ${table} (id, ${keyColumn}, name, status, created_at, updated_at) VALUES (?, ?, ?, 'active', NOW(), NOW())`,
        [randomUUID(), key, name]
      );
    }
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('brokers'))) {
      await queryRunner.createTable(new Table({
        name: 'brokers',
        columns: [
          { name: 'id', type: 'char', length: '36', isPrimary: true },
          { name: 'broker_key', type: 'varchar', length: '100', isUnique: true },
          { name: 'name', type: 'varchar', length: '191' },
          { name: 'status', type: 'varchar', length: '32', default: "'active'" },
          { name: 'created_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
          { name: 'updated_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' },
        ],
      }));
      await queryRunner.createIndex('brokers', new TableIndex({ name: 'uidx_brokers_broker_key', columnNames: ['broker_key'], isUnique: true }));
    }

    if (!(await queryRunner.hasTable('exchanges'))) {
      await queryRunner.createTable(new Table({
        name: 'exchanges',
        columns: [
          { name: 'id', type: 'char', length: '36', isPrimary: true },
          { name: 'exchange_key', type: 'varchar', length: '100', isUnique: true },
          { name: 'name', type: 'varchar', length: '191' },
          { name: 'status', type: 'varchar', length: '32', default: "'active'" },
          { name: 'created_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
          { name: 'updated_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' },
        ],
      }));
      await queryRunner.createIndex('exchanges', new TableIndex({ name: 'uidx_exchanges_exchange_key', columnNames: ['exchange_key'], isUnique: true }));
    }

    await this.ensureMasterRow(queryRunner, 'brokers', 'broker_key', 'mudrex', 'Mudrex');
    await this.ensureMasterRow(queryRunner, 'brokers', 'broker_key', 'delta_exchange', 'Delta Exchange');
    await this.ensureMasterRow(queryRunner, 'exchanges', 'exchange_key', 'binance', 'Binance');
    await this.ensureMasterRow(queryRunner, 'exchanges', 'exchange_key', 'delta_exchange', 'Delta Exchange');

    if (!(await queryRunner.hasColumn('connections', 'broker_id'))) {
      await queryRunner.query('ALTER TABLE connections ADD COLUMN broker_id char(36) NULL');
    }
    if (!(await queryRunner.hasColumn('connections', 'exchange_id'))) {
      await queryRunner.query('ALTER TABLE connections ADD COLUMN exchange_id char(36) NULL');
    }
    if (!(await queryRunner.hasColumn('broker_accounts', 'broker_id'))) {
      await queryRunner.query('ALTER TABLE broker_accounts ADD COLUMN broker_id char(36) NULL');
    }
    if (!(await queryRunner.hasColumn('broker_assets', 'broker_id'))) {
      await queryRunner.query('ALTER TABLE broker_assets ADD COLUMN broker_id char(36) NULL');
    }
    if (!(await queryRunner.hasColumn('broker_assets', 'exchange_id'))) {
      await queryRunner.query('ALTER TABLE broker_assets ADD COLUMN exchange_id char(36) NULL');
    }

    await queryRunner.query("UPDATE connections c JOIN brokers b ON b.broker_key = c.brokerKey SET c.broker_id = b.id WHERE c.brokerKey IN ('mudrex', 'delta_exchange') AND c.broker_id IS NULL");
    await queryRunner.query("UPDATE connections c JOIN exchanges e ON e.exchange_key = 'binance' SET c.exchange_id = e.id WHERE c.brokerKey IN ('binance_market_data', 'binance') AND c.exchange_id IS NULL");
    await queryRunner.query("UPDATE connections c JOIN exchanges e ON e.exchange_key = 'delta_exchange' SET c.exchange_id = e.id WHERE c.brokerKey = 'delta_exchange' AND c.exchange_id IS NULL");
    await queryRunner.query('UPDATE broker_accounts ba JOIN connections c ON ba.connectionId = c.id SET ba.broker_id = c.broker_id WHERE ba.broker_id IS NULL AND c.broker_id IS NOT NULL');
    await queryRunner.query("UPDATE broker_accounts ba JOIN brokers b ON b.broker_key = ba.brokerKey SET ba.broker_id = b.id WHERE ba.broker_id IS NULL");
    await queryRunner.query("UPDATE broker_assets ea JOIN brokers b ON b.broker_key = ea.source SET ea.broker_id = b.id WHERE ea.source IN ('mudrex', 'delta_exchange') AND ea.broker_id IS NULL");
    await queryRunner.query("UPDATE broker_assets ea JOIN exchanges e ON e.exchange_key = 'binance' SET ea.exchange_id = e.id WHERE ea.source IN ('binance_market_data', 'binance') AND ea.exchange_id IS NULL");
    await queryRunner.query("UPDATE broker_assets ea JOIN exchanges e ON e.exchange_key = 'delta_exchange' SET ea.exchange_id = e.id WHERE ea.source = 'delta_exchange' AND ea.exchange_id IS NULL");

    if (!(await this.hasIndex(queryRunner, 'connections', 'idx_connections_user_broker_id'))) {
      await queryRunner.query('CREATE INDEX idx_connections_user_broker_id ON connections (user_id, broker_id)');
    }
    if (!(await this.hasIndex(queryRunner, 'connections', 'idx_connections_user_exchange_id'))) {
      await queryRunner.query('CREATE INDEX idx_connections_user_exchange_id ON connections (user_id, exchange_id)');
    }
    if (!(await this.hasIndex(queryRunner, 'broker_accounts', 'idx_broker_accounts_user_broker_id'))) {
      await queryRunner.query('CREATE INDEX idx_broker_accounts_user_broker_id ON broker_accounts (user_id, broker_id)');
    }
    if (!(await this.hasIndex(queryRunner, 'broker_assets', 'idx_broker_assets_user_broker_id'))) {
      await queryRunner.query('CREATE INDEX idx_broker_assets_user_broker_id ON broker_assets (user_id, broker_id)');
    }
    if (!(await this.hasIndex(queryRunner, 'broker_assets', 'idx_broker_assets_user_exchange_id'))) {
      await queryRunner.query('CREATE INDEX idx_broker_assets_user_exchange_id ON broker_assets (user_id, exchange_id)');
    }

    if (!(await this.hasForeignKey(queryRunner, 'connections', 'FK_connections_broker_id'))) {
      await queryRunner.query('ALTER TABLE connections ADD CONSTRAINT FK_connections_broker_id FOREIGN KEY (broker_id) REFERENCES brokers(id) ON DELETE SET NULL');
    }
    if (!(await this.hasForeignKey(queryRunner, 'connections', 'FK_connections_exchange_id'))) {
      await queryRunner.query('ALTER TABLE connections ADD CONSTRAINT FK_connections_exchange_id FOREIGN KEY (exchange_id) REFERENCES exchanges(id) ON DELETE SET NULL');
    }
    if (!(await this.hasForeignKey(queryRunner, 'broker_accounts', 'FK_broker_accounts_broker_id'))) {
      await queryRunner.query('ALTER TABLE broker_accounts ADD CONSTRAINT FK_broker_accounts_broker_id FOREIGN KEY (broker_id) REFERENCES brokers(id) ON DELETE SET NULL');
    }
    if (!(await this.hasForeignKey(queryRunner, 'broker_assets', 'FK_broker_assets_broker_id'))) {
      await queryRunner.query('ALTER TABLE broker_assets ADD CONSTRAINT FK_broker_assets_broker_id FOREIGN KEY (broker_id) REFERENCES brokers(id) ON DELETE SET NULL');
    }
    if (!(await this.hasForeignKey(queryRunner, 'broker_assets', 'FK_broker_assets_exchange_id'))) {
      await queryRunner.query('ALTER TABLE broker_assets ADD CONSTRAINT FK_broker_assets_exchange_id FOREIGN KEY (exchange_id) REFERENCES exchanges(id) ON DELETE SET NULL');
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const fkPairs = [
      ['broker_assets', 'FK_broker_assets_exchange_id'],
      ['broker_assets', 'FK_broker_assets_broker_id'],
      ['broker_accounts', 'FK_broker_accounts_broker_id'],
      ['connections', 'FK_connections_exchange_id'],
      ['connections', 'FK_connections_broker_id'],
    ];
    for (const [table, fk] of fkPairs) {
      if (await this.hasForeignKey(queryRunner, table, fk)) {
        await queryRunner.query(`ALTER TABLE ${table} DROP FOREIGN KEY ${fk}`);
      }
    }
    const indexPairs = [
      ['broker_assets', 'idx_broker_assets_user_exchange_id'],
      ['broker_assets', 'idx_broker_assets_user_broker_id'],
      ['broker_accounts', 'idx_broker_accounts_user_broker_id'],
      ['connections', 'idx_connections_user_exchange_id'],
      ['connections', 'idx_connections_user_broker_id'],
    ];
    for (const [table, idx] of indexPairs) {
      if (await this.hasIndex(queryRunner, table, idx)) {
        await queryRunner.query(`ALTER TABLE ${table} DROP INDEX ${idx}`);
      }
    }
    if (await queryRunner.hasColumn('broker_assets', 'exchange_id')) await queryRunner.query('ALTER TABLE broker_assets DROP COLUMN exchange_id');
    if (await queryRunner.hasColumn('broker_assets', 'broker_id')) await queryRunner.query('ALTER TABLE broker_assets DROP COLUMN broker_id');
    if (await queryRunner.hasColumn('broker_accounts', 'broker_id')) await queryRunner.query('ALTER TABLE broker_accounts DROP COLUMN broker_id');
    if (await queryRunner.hasColumn('connections', 'exchange_id')) await queryRunner.query('ALTER TABLE connections DROP COLUMN exchange_id');
    if (await queryRunner.hasColumn('connections', 'broker_id')) await queryRunner.query('ALTER TABLE connections DROP COLUMN broker_id');
    if (await queryRunner.hasTable('exchanges')) await queryRunner.dropTable('exchanges');
    if (await queryRunner.hasTable('brokers')) await queryRunner.dropTable('brokers');
  }
}
