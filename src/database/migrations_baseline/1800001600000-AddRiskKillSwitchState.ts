import { Service } from 'typedi';
import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

@Service()
export class AddRiskKillSwitchState1800001600000 implements MigrationInterface {
  name = 'AddRiskKillSwitchState1800001600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('risk_kill_switch_states'))) {
      await queryRunner.createTable(
        new Table({
          name: 'risk_kill_switch_states',
          columns: [
            {
              name: 'id',
              type: 'varchar',
              length: '36',
              isPrimary: true,
              isGenerated: true,
              generationStrategy: 'uuid',
            },
            { name: 'user_id', type: 'varchar', length: '191' },
            { name: 'scope', type: 'varchar', length: '32' },
            { name: 'broker_key', type: 'varchar', length: '100', isNullable: true },
            { name: 'account_id', type: 'varchar', length: '191', isNullable: true },
            { name: 'active', type: 'boolean', default: true },
            { name: 'reason', type: 'varchar', length: '500' },
            { name: 'triggered_by', type: 'varchar', length: '191' },
            { name: 'triggered_at', type: 'timestamp' },
            { name: 'cleared_by', type: 'varchar', length: '191', isNullable: true },
            { name: 'cleared_at', type: 'timestamp', isNullable: true },
            {
              name: 'created_at',
              type: 'timestamp',
              default: 'CURRENT_TIMESTAMP',
            },
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

    await this.createIndexIfMissing(
      queryRunner,
      new TableIndex({
        name: 'idx_risk_kill_switch_states_user_active',
        columnNames: ['user_id', 'active'],
      })
    );
    await this.createIndexIfMissing(
      queryRunner,
      new TableIndex({
        name: 'idx_risk_kill_switch_states_user_scope',
        columnNames: ['user_id', 'scope'],
      })
    );
    await this.createIndexIfMissing(
      queryRunner,
      new TableIndex({
        name: 'idx_risk_kill_switch_states_user_broker',
        columnNames: ['user_id', 'broker_key'],
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('risk_kill_switch_states')) {
      await queryRunner.dropTable('risk_kill_switch_states');
    }
  }

  private async createIndexIfMissing(queryRunner: QueryRunner, index: TableIndex): Promise<void> {
    const table = await queryRunner.getTable('risk_kill_switch_states');
    const exists = table?.indices.some((candidate) => candidate.name === index.name);
    if (!exists) {
      await queryRunner.createIndex('risk_kill_switch_states', index);
    }
  }
}
