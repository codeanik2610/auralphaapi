import { Service } from 'typedi';
import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
  TableIndex,
} from 'typeorm';

@Service()
export class CreateAutomationsTables1741466100000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'automations',
        columns: [
          { name: 'id', type: 'char', length: '36', isPrimary: true },
          { name: 'name', type: 'varchar', length: '255' },
          { name: 'strategy', type: 'varchar', length: '255' },
          { name: 'broker', type: 'varchar', length: '255' },
          { name: 'market', type: 'varchar', length: '50' },
          { name: 'trigger', type: 'varchar', length: '255' },
          { name: 'status', type: 'varchar', length: '30' },
          { name: 'lastRun', type: 'timestamp', isNullable: true },
          { name: 'nextRun', type: 'timestamp', isNullable: true },
          { name: 'accounts', type: 'int', unsigned: true, default: '0' },
          { name: 'riskMode', type: 'varchar', length: '100', isNullable: true },
          { name: 'createdAt', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
          {
            name: 'updatedAt',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
            onUpdate: 'CURRENT_TIMESTAMP',
          },
        ],
      })
    );

    await queryRunner.createIndex(
      'automations',
      new TableIndex({
        name: 'idx_automations_status_updated_at',
        columnNames: ['status', 'updatedAt'],
      })
    );

    await queryRunner.createIndex(
      'automations',
      new TableIndex({
        name: 'idx_automations_market_updated_at',
        columnNames: ['market', 'updatedAt'],
      })
    );

    await queryRunner.createTable(
      new Table({
        name: 'automation_events',
        columns: [
          { name: 'id', type: 'char', length: '36', isPrimary: true },
          { name: 'automationId', type: 'char', length: '36' },
          { name: 'type', type: 'varchar', length: '100' },
          { name: 'entity', type: 'varchar', length: '255', isNullable: true },
          { name: 'outcome', type: 'varchar', length: '100', isNullable: true },
          { name: 'createdAt', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
        ],
      })
    );

    await queryRunner.createIndex(
      'automation_events',
      new TableIndex({
        name: 'idx_automation_events_automation_created_at',
        columnNames: ['automationId', 'createdAt'],
      })
    );

    await queryRunner.createForeignKey(
      'automation_events',
      new TableForeignKey({
        name: 'fk_automation_events_automation_id',
        columnNames: ['automationId'],
        referencedTableName: 'automations',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      })
    );

    await queryRunner.createTable(
      new Table({
        name: 'automation_alerts',
        columns: [
          { name: 'id', type: 'char', length: '36', isPrimary: true },
          { name: 'automationId', type: 'char', length: '36' },
          { name: 'message', type: 'varchar', length: '255' },
          { name: 'severity', type: 'varchar', length: '20' },
          { name: 'status', type: 'varchar', length: '20' },
          { name: 'createdAt', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
          {
            name: 'updatedAt',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
            onUpdate: 'CURRENT_TIMESTAMP',
          },
        ],
      })
    );

    await queryRunner.createIndex(
      'automation_alerts',
      new TableIndex({
        name: 'idx_automation_alerts_automation_created_at',
        columnNames: ['automationId', 'createdAt'],
      })
    );

    await queryRunner.createForeignKey(
      'automation_alerts',
      new TableForeignKey({
        name: 'fk_automation_alerts_automation_id',
        columnNames: ['automationId'],
        referencedTableName: 'automations',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropForeignKey('automation_alerts', 'fk_automation_alerts_automation_id');
    await queryRunner.dropIndex('automation_alerts', 'idx_automation_alerts_automation_created_at');
    await queryRunner.dropTable('automation_alerts');
    await queryRunner.dropForeignKey('automation_events', 'fk_automation_events_automation_id');
    await queryRunner.dropIndex('automation_events', 'idx_automation_events_automation_created_at');
    await queryRunner.dropTable('automation_events');
    await queryRunner.dropIndex('automations', 'idx_automations_market_updated_at');
    await queryRunner.dropIndex('automations', 'idx_automations_status_updated_at');
    await queryRunner.dropTable('automations');
  }
}
