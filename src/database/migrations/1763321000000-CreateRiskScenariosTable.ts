import { Service } from 'typedi';
import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex } from 'typeorm';

@Service()
export class CreateRiskScenariosTable1763321000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('risk_scenarios')) {
      return;
    }

    await queryRunner.createTable(
      new Table({
        name: 'risk_scenarios',
        columns: [
          { name: 'id', type: 'char', length: '36', isPrimary: true },
          { name: 'snapshotId', type: 'char', length: '36' },
          { name: 'user_id', type: 'varchar', length: '191' },
          { name: 'scenario', type: 'varchar', length: '120' },
          { name: 'impact', type: 'varchar', length: '60' },
          { name: 'commentary', type: 'varchar', length: '255' },
          { name: 'createdAt', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
          {
            name: 'updatedAt',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
            onUpdate: 'CURRENT_TIMESTAMP'
          }
        ]
      })
    );

    await queryRunner.createIndex(
      'risk_scenarios',
      new TableIndex({
        name: 'idx_risk_scenarios_snapshot_created',
        columnNames: ['snapshotId', 'createdAt']
      })
    );

    await queryRunner.createIndex(
      'risk_scenarios',
      new TableIndex({
        name: 'idx_risk_scenarios_user_created',
        columnNames: ['user_id', 'createdAt']
      })
    );

    await queryRunner.createForeignKey(
      'risk_scenarios',
      new TableForeignKey({
        name: 'fk_risk_scenarios_snapshot_id',
        columnNames: ['snapshotId'],
        referencedTableName: 'risk_snapshots',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE'
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('risk_scenarios'))) {
      return;
    }

    const table = await queryRunner.getTable('risk_scenarios');
    const foreignKey = table?.foreignKeys.find((item) => item.name === 'fk_risk_scenarios_snapshot_id');
    if (foreignKey) {
      await queryRunner.dropForeignKey('risk_scenarios', foreignKey);
    }

    if (table?.indices.some((item) => item.name === 'idx_risk_scenarios_snapshot_created')) {
      await queryRunner.dropIndex('risk_scenarios', 'idx_risk_scenarios_snapshot_created');
    }
    if (table?.indices.some((item) => item.name === 'idx_risk_scenarios_user_created')) {
      await queryRunner.dropIndex('risk_scenarios', 'idx_risk_scenarios_user_created');
    }

    await queryRunner.dropTable('risk_scenarios');
  }
}
