import { Service } from 'typedi';
import { MigrationInterface, QueryRunner } from 'typeorm';

@Service()
export class AddUserIdOwnershipWave11741482000000 implements MigrationInterface {
  name = 'AddUserIdOwnershipWave11741482000000';

  private async addUserIdColumn(queryRunner: QueryRunner, table: string, type = 'char(36)'): Promise<void> {
    if (!(await queryRunner.hasColumn(table, 'user_id'))) {
      await queryRunner.query(`ALTER TABLE ${table} ADD COLUMN user_id ${type} NULL`);
    }
  }

  private async hasIndex(queryRunner: QueryRunner, table: string, indexName: string): Promise<boolean> {
    const rows = await queryRunner.query(`SHOW INDEX FROM ${table} WHERE Key_name = ?`, [indexName]);
    return rows.length > 0;
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    const rows = await queryRunner.query("SELECT id FROM users WHERE email = 'admin@auralpha.com' LIMIT 1");
    const adminId = rows[0]?.id || (await queryRunner.query('SELECT id FROM users ORDER BY created_at ASC LIMIT 1'))[0]?.id;
    if (!adminId) throw new Error('No user found to backfill user-owned records');

    await this.addUserIdColumn(queryRunner, 'connections');
    await queryRunner.query('UPDATE connections SET user_id = ? WHERE user_id IS NULL', [adminId]);
    await queryRunner.query('ALTER TABLE connections MODIFY user_id char(36) NOT NULL');
    if (await this.hasIndex(queryRunner, 'connections', 'uidx_connections_broker_key')) {
      await queryRunner.query('ALTER TABLE connections DROP INDEX uidx_connections_broker_key');
    }
    if (!(await this.hasIndex(queryRunner, 'connections', 'uidx_connections_user_broker_key'))) {
      await queryRunner.query('CREATE UNIQUE INDEX uidx_connections_user_broker_key ON connections (user_id, brokerKey)');
    }
    if (!(await this.hasIndex(queryRunner, 'connections', 'idx_connections_user_type_updated_at'))) {
      await queryRunner.query('CREATE INDEX idx_connections_user_type_updated_at ON connections (user_id, type, updatedAt)');
    }
    if (!(await this.hasIndex(queryRunner, 'connections', 'idx_connections_user_status_updated_at'))) {
      await queryRunner.query('CREATE INDEX idx_connections_user_status_updated_at ON connections (user_id, status, updatedAt)');
    }

    await this.addUserIdColumn(queryRunner, 'broker_accounts');
    await queryRunner.query('UPDATE broker_accounts SET user_id = ? WHERE user_id IS NULL', [adminId]);
    await queryRunner.query('ALTER TABLE broker_accounts MODIFY user_id char(36) NOT NULL');
    if (await this.hasIndex(queryRunner, 'broker_accounts', 'uidx_broker_accounts_account_key')) {
      await queryRunner.query('ALTER TABLE broker_accounts DROP INDEX uidx_broker_accounts_account_key');
    }
    if (!(await this.hasIndex(queryRunner, 'broker_accounts', 'uidx_broker_accounts_user_account_key'))) {
      await queryRunner.query('CREATE UNIQUE INDEX uidx_broker_accounts_user_account_key ON broker_accounts (user_id, accountKey)');
    }
    if (!(await this.hasIndex(queryRunner, 'broker_accounts', 'idx_broker_accounts_user_connection_updated_at'))) {
      await queryRunner.query('CREATE INDEX idx_broker_accounts_user_connection_updated_at ON broker_accounts (user_id, connectionId, updatedAt)');
    }
    if (!(await this.hasIndex(queryRunner, 'broker_accounts', 'idx_broker_accounts_user_status_updated_at'))) {
      await queryRunner.query('CREATE INDEX idx_broker_accounts_user_status_updated_at ON broker_accounts (user_id, status, updatedAt)');
    }

    await this.addUserIdColumn(queryRunner, 'broker_assets');
    await queryRunner.query('UPDATE broker_assets SET user_id = ? WHERE user_id IS NULL', [adminId]);
    await queryRunner.query('ALTER TABLE broker_assets MODIFY user_id char(36) NOT NULL');
    if (await this.hasIndex(queryRunner, 'broker_assets', 'uq_broker_assets_source_symbol')) {
      await queryRunner.query('ALTER TABLE broker_assets DROP INDEX uq_broker_assets_source_symbol');
    }
    if (!(await this.hasIndex(queryRunner, 'broker_assets', 'uq_broker_assets_user_source_symbol'))) {
      await queryRunner.query('CREATE UNIQUE INDEX uq_broker_assets_user_source_symbol ON broker_assets (user_id, source, symbol)');
    }
    if (!(await this.hasIndex(queryRunner, 'broker_assets', 'idx_broker_assets_user_symbol_name'))) {
      await queryRunner.query('CREATE INDEX idx_broker_assets_user_symbol_name ON broker_assets (user_id, symbol, name)');
    }

    await this.addUserIdColumn(queryRunner, 'app_settings');
    await queryRunner.query('UPDATE app_settings SET user_id = ? WHERE user_id IS NULL', [adminId]);
    await queryRunner.query('ALTER TABLE app_settings MODIFY user_id char(36) NOT NULL');
    if (!(await this.hasIndex(queryRunner, 'app_settings', 'uidx_app_settings_user_id'))) {
      await queryRunner.query('CREATE UNIQUE INDEX uidx_app_settings_user_id ON app_settings (user_id)');
    }

    await this.addUserIdColumn(queryRunner, 'settings_audit_logs');
    await queryRunner.query('UPDATE settings_audit_logs SET user_id = ? WHERE user_id IS NULL', [adminId]);
    await queryRunner.query('ALTER TABLE settings_audit_logs MODIFY user_id char(36) NOT NULL');
    if (!(await this.hasIndex(queryRunner, 'settings_audit_logs', 'idx_settings_audit_logs_user_created_at'))) {
      await queryRunner.query('CREATE INDEX idx_settings_audit_logs_user_created_at ON settings_audit_logs (user_id, createdAt)');
    }

    await this.addUserIdColumn(queryRunner, 'strategy_templates');
    await queryRunner.query('UPDATE strategy_templates SET user_id = ? WHERE user_id IS NULL', [adminId]);
    await queryRunner.query('ALTER TABLE strategy_templates MODIFY user_id char(36) NOT NULL');
    if (!(await this.hasIndex(queryRunner, 'strategy_templates', 'idx_strategy_templates_user_category_updated_at'))) {
      await queryRunner.query('CREATE INDEX idx_strategy_templates_user_category_updated_at ON strategy_templates (user_id, category, updatedAt)');
    }
    if (!(await this.hasIndex(queryRunner, 'strategy_templates', 'idx_strategy_templates_user_market_updated_at'))) {
      await queryRunner.query('CREATE INDEX idx_strategy_templates_user_market_updated_at ON strategy_templates (user_id, market, updatedAt)');
    }

    await this.addUserIdColumn(queryRunner, 'strategy_lab_projects');
    await queryRunner.query('UPDATE strategy_lab_projects SET user_id = ? WHERE user_id IS NULL', [adminId]);
    await queryRunner.query('ALTER TABLE strategy_lab_projects MODIFY user_id char(36) NOT NULL');
    if (!(await this.hasIndex(queryRunner, 'strategy_lab_projects', 'idx_strategy_lab_projects_user_template_updated_at'))) {
      await queryRunner.query('CREATE INDEX idx_strategy_lab_projects_user_template_updated_at ON strategy_lab_projects (user_id, templateId, updatedAt)');
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await this.hasIndex(queryRunner, 'strategy_lab_projects', 'idx_strategy_lab_projects_user_template_updated_at')) {
      await queryRunner.query('DROP INDEX idx_strategy_lab_projects_user_template_updated_at ON strategy_lab_projects');
    }
    if (await queryRunner.hasColumn('strategy_lab_projects', 'user_id')) {
      await queryRunner.query('ALTER TABLE strategy_lab_projects DROP COLUMN user_id');
    }
    if (await this.hasIndex(queryRunner, 'strategy_templates', 'idx_strategy_templates_user_market_updated_at')) {
      await queryRunner.query('DROP INDEX idx_strategy_templates_user_market_updated_at ON strategy_templates');
    }
    if (await this.hasIndex(queryRunner, 'strategy_templates', 'idx_strategy_templates_user_category_updated_at')) {
      await queryRunner.query('DROP INDEX idx_strategy_templates_user_category_updated_at ON strategy_templates');
    }
    if (await queryRunner.hasColumn('strategy_templates', 'user_id')) {
      await queryRunner.query('ALTER TABLE strategy_templates DROP COLUMN user_id');
    }
    if (await this.hasIndex(queryRunner, 'settings_audit_logs', 'idx_settings_audit_logs_user_created_at')) {
      await queryRunner.query('DROP INDEX idx_settings_audit_logs_user_created_at ON settings_audit_logs');
    }
    if (await queryRunner.hasColumn('settings_audit_logs', 'user_id')) {
      await queryRunner.query('ALTER TABLE settings_audit_logs DROP COLUMN user_id');
    }
    if (await this.hasIndex(queryRunner, 'app_settings', 'uidx_app_settings_user_id')) {
      await queryRunner.query('DROP INDEX uidx_app_settings_user_id ON app_settings');
    }
    if (await queryRunner.hasColumn('app_settings', 'user_id')) {
      await queryRunner.query('ALTER TABLE app_settings DROP COLUMN user_id');
    }
    if (await this.hasIndex(queryRunner, 'broker_assets', 'idx_broker_assets_user_symbol_name')) {
      await queryRunner.query('DROP INDEX idx_broker_assets_user_symbol_name ON broker_assets');
    }
    if (await this.hasIndex(queryRunner, 'broker_assets', 'uq_broker_assets_user_source_symbol')) {
      await queryRunner.query('DROP INDEX uq_broker_assets_user_source_symbol ON broker_assets');
    }
    if (await queryRunner.hasColumn('broker_assets', 'user_id')) {
      await queryRunner.query('ALTER TABLE broker_assets DROP COLUMN user_id');
    }
    if (await this.hasIndex(queryRunner, 'broker_accounts', 'idx_broker_accounts_user_status_updated_at')) {
      await queryRunner.query('DROP INDEX idx_broker_accounts_user_status_updated_at ON broker_accounts');
    }
    if (await this.hasIndex(queryRunner, 'broker_accounts', 'idx_broker_accounts_user_connection_updated_at')) {
      await queryRunner.query('DROP INDEX idx_broker_accounts_user_connection_updated_at ON broker_accounts');
    }
    if (await this.hasIndex(queryRunner, 'broker_accounts', 'uidx_broker_accounts_user_account_key')) {
      await queryRunner.query('DROP INDEX uidx_broker_accounts_user_account_key ON broker_accounts');
    }
    if (await queryRunner.hasColumn('broker_accounts', 'user_id')) {
      await queryRunner.query('ALTER TABLE broker_accounts DROP COLUMN user_id');
    }
    if (await this.hasIndex(queryRunner, 'connections', 'idx_connections_user_status_updated_at')) {
      await queryRunner.query('DROP INDEX idx_connections_user_status_updated_at ON connections');
    }
    if (await this.hasIndex(queryRunner, 'connections', 'idx_connections_user_type_updated_at')) {
      await queryRunner.query('DROP INDEX idx_connections_user_type_updated_at ON connections');
    }
    if (await this.hasIndex(queryRunner, 'connections', 'uidx_connections_user_broker_key')) {
      await queryRunner.query('DROP INDEX uidx_connections_user_broker_key ON connections');
    }
    if (await queryRunner.hasColumn('connections', 'user_id')) {
      await queryRunner.query('ALTER TABLE connections DROP COLUMN user_id');
    }
  }
}
