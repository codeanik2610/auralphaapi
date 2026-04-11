import { Service } from 'typedi';
import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

@Service()
export class CreateRiskPolicyTables1763303600000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('risk_policies'))) {
      await queryRunner.createTable(
        new Table({
          name: 'risk_policies',
          columns: [
            { name: 'id', type: 'char', length: '36', isPrimary: true },
            { name: 'user_id', type: 'varchar', length: '191' },
            { name: 'scope', type: 'varchar', length: '20' },
            { name: 'broker_key', type: 'varchar', length: '100', isNullable: true },
            { name: 'account_id', type: 'varchar', length: '191', isNullable: true },
            { name: 'enabled', type: 'boolean', default: '1' },
            { name: 'monitor_only', type: 'boolean', default: '1' },
            { name: 'enforce_hard_block', type: 'boolean', default: '0' },
            { name: 'margin_usage_warn_pct', type: 'double', default: '70' },
            { name: 'margin_usage_critical_pct', type: 'double', default: '85' },
            { name: 'liquidation_buffer_warn_pct', type: 'double', default: '8' },
            { name: 'liquidation_buffer_critical_pct', type: 'double', default: '5' },
            { name: 'concentration_warn_pct', type: 'double', default: '30' },
            { name: 'concentration_critical_pct', type: 'double', default: '45' },
            { name: 'drawdown_warn_pct', type: 'double', default: '3' },
            { name: 'drawdown_critical_pct', type: 'double', default: '5' },
            { name: 'max_leverage', type: 'double', isNullable: true },
            { name: 'max_order_notional', type: 'double', isNullable: true },
            { name: 'created_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
            {
              name: 'updated_at',
              type: 'timestamp',
              default: 'CURRENT_TIMESTAMP',
              onUpdate: 'CURRENT_TIMESTAMP'
            }
          ]
        })
      );
      await queryRunner.createIndex(
        'risk_policies',
        new TableIndex({
          name: 'idx_risk_policies_user_scope',
          columnNames: ['user_id', 'scope']
        })
      );
      await queryRunner.createIndex(
        'risk_policies',
        new TableIndex({
          name: 'idx_risk_policies_user_broker',
          columnNames: ['user_id', 'broker_key']
        })
      );
      await queryRunner.createIndex(
        'risk_policies',
        new TableIndex({
          name: 'idx_risk_policies_user_account',
          columnNames: ['user_id', 'account_id']
        })
      );
    }

    if (!(await queryRunner.hasTable('risk_policy_versions'))) {
      await queryRunner.createTable(
        new Table({
          name: 'risk_policy_versions',
          columns: [
            { name: 'id', type: 'char', length: '36', isPrimary: true },
            { name: 'policy_id', type: 'char', length: '36' },
            { name: 'user_id', type: 'varchar', length: '191' },
            { name: 'actor_user_id', type: 'varchar', length: '191' },
            { name: 'version_payload', type: 'text' },
            { name: 'created_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP' }
          ]
        })
      );
      await queryRunner.createIndex(
        'risk_policy_versions',
        new TableIndex({
          name: 'idx_risk_policy_versions_policy_created',
          columnNames: ['policy_id', 'created_at']
        })
      );
      await queryRunner.createIndex(
        'risk_policy_versions',
        new TableIndex({
          name: 'idx_risk_policy_versions_user_created',
          columnNames: ['user_id', 'created_at']
        })
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('risk_policy_versions')) {
      const versionsTable = await queryRunner.getTable('risk_policy_versions');
      if (versionsTable?.indices.some((item) => item.name === 'idx_risk_policy_versions_policy_created')) {
        await queryRunner.dropIndex(
          'risk_policy_versions',
          'idx_risk_policy_versions_policy_created'
        );
      }
      if (versionsTable?.indices.some((item) => item.name === 'idx_risk_policy_versions_user_created')) {
        await queryRunner.dropIndex(
          'risk_policy_versions',
          'idx_risk_policy_versions_user_created'
        );
      }
      await queryRunner.dropTable('risk_policy_versions');
    }

    if (await queryRunner.hasTable('risk_policies')) {
      const policiesTable = await queryRunner.getTable('risk_policies');
      if (policiesTable?.indices.some((item) => item.name === 'idx_risk_policies_user_scope')) {
        await queryRunner.dropIndex('risk_policies', 'idx_risk_policies_user_scope');
      }
      if (policiesTable?.indices.some((item) => item.name === 'idx_risk_policies_user_broker')) {
        await queryRunner.dropIndex('risk_policies', 'idx_risk_policies_user_broker');
      }
      if (policiesTable?.indices.some((item) => item.name === 'idx_risk_policies_user_account')) {
        await queryRunner.dropIndex('risk_policies', 'idx_risk_policies_user_account');
      }
      await queryRunner.dropTable('risk_policies');
    }
  }
}
