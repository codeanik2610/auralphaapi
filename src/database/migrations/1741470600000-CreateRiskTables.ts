import { Service } from 'typedi';
import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
  TableIndex,
} from 'typeorm';

@Service()
export class CreateRiskTables1741470600000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'risk_snapshots',
        columns: [
          { name: 'id', type: 'char', length: '36', isPrimary: true },
          { name: 'portfolioRisk', type: 'varchar', length: '50', isNullable: true },
          { name: 'breachedRules', type: 'int', unsigned: true, default: '0' },
          { name: 'liquidationWatch', type: 'int', unsigned: true, default: '0' },
          { name: 'capitalAtRisk', type: 'double', default: '0' },
          { name: 'marginUsage', type: 'varchar', length: '50', isNullable: true },
          { name: 'drawdownBudgetUsed', type: 'varchar', length: '50', isNullable: true },
          { name: 'atRiskPositions', type: 'int', unsigned: true, default: '0' },
          { name: 'ruleViolations', type: 'int', unsigned: true, default: '0' },
          { name: 'portfolioRiskScore', type: 'varchar', length: '50', isNullable: true },
          { name: 'primaryConcern', type: 'varchar', length: '255', isNullable: true },
          { name: 'riskByPosition', type: 'varchar', length: '255', isNullable: true },
          { name: 'riskByStrategy', type: 'varchar', length: '255', isNullable: true },
          { name: 'riskByGuardrail', type: 'varchar', length: '255', isNullable: true },
          { name: 'guardrailOne', type: 'varchar', length: '255', isNullable: true },
          { name: 'guardrailTwo', type: 'varchar', length: '255', isNullable: true },
          { name: 'guardrailThree', type: 'varchar', length: '255', isNullable: true },
          { name: 'actionOne', type: 'varchar', length: '255', isNullable: true },
          { name: 'actionTwo', type: 'varchar', length: '255', isNullable: true },
          { name: 'actionThree', type: 'varchar', length: '255', isNullable: true },
          { name: 'createdAt', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
          { name: 'updatedAt', type: 'timestamp', default: 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' },
        ],
      })
    );

    await queryRunner.createIndex(
      'risk_snapshots',
      new TableIndex({ name: 'idx_risk_snapshots_created_at', columnNames: ['createdAt'] })
    );

    await queryRunner.createTable(
      new Table({
        name: 'risk_controls',
        columns: [
          { name: 'id', type: 'char', length: '36', isPrimary: true },
          { name: 'snapshotId', type: 'char', length: '36' },
          { name: 'bucket', type: 'varchar', length: '255' },
          { name: 'exposure', type: 'varchar', length: '100' },
          { name: 'threshold', type: 'varchar', length: '100' },
          { name: 'status', type: 'varchar', length: '30' },
          { name: 'action', type: 'varchar', length: '255' },
          { name: 'createdAt', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
          { name: 'updatedAt', type: 'timestamp', default: 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' },
        ],
      })
    );

    await queryRunner.createIndex(
      'risk_controls',
      new TableIndex({ name: 'idx_risk_controls_snapshot_status', columnNames: ['snapshotId', 'status'] })
    );

    await queryRunner.createForeignKey(
      'risk_controls',
      new TableForeignKey({
        name: 'fk_risk_controls_snapshot_id',
        columnNames: ['snapshotId'],
        referencedTableName: 'risk_snapshots',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      })
    );

    await queryRunner.createTable(
      new Table({
        name: 'risk_alerts',
        columns: [
          { name: 'id', type: 'char', length: '36', isPrimary: true },
          { name: 'snapshotId', type: 'char', length: '36' },
          { name: 'severity', type: 'varchar', length: '20' },
          { name: 'message', type: 'varchar', length: '255' },
          { name: 'symbol', type: 'varchar', length: '50' },
          { name: 'channel', type: 'varchar', length: '50', isNullable: true },
          { name: 'status', type: 'varchar', length: '30', isNullable: true },
          { name: 'createdAt', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
          { name: 'updatedAt', type: 'timestamp', default: 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' },
        ],
      })
    );

    await queryRunner.createIndex(
      'risk_alerts',
      new TableIndex({ name: 'idx_risk_alerts_snapshot_created_at', columnNames: ['snapshotId', 'createdAt'] })
    );

    await queryRunner.createForeignKey(
      'risk_alerts',
      new TableForeignKey({
        name: 'fk_risk_alerts_snapshot_id',
        columnNames: ['snapshotId'],
        referencedTableName: 'risk_snapshots',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropForeignKey('risk_alerts', 'fk_risk_alerts_snapshot_id');
    await queryRunner.dropIndex('risk_alerts', 'idx_risk_alerts_snapshot_created_at');
    await queryRunner.dropTable('risk_alerts');
    await queryRunner.dropForeignKey('risk_controls', 'fk_risk_controls_snapshot_id');
    await queryRunner.dropIndex('risk_controls', 'idx_risk_controls_snapshot_status');
    await queryRunner.dropTable('risk_controls');
    await queryRunner.dropIndex('risk_snapshots', 'idx_risk_snapshots_created_at');
    await queryRunner.dropTable('risk_snapshots');
  }
}
