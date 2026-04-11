import { Service } from 'typedi';
import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
  TableIndex,
} from 'typeorm';

@Service()
export class CreateAlertsTables1741468800000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'alerts',
        columns: [
          { name: 'id', type: 'char', length: '36', isPrimary: true },
          { name: 'severity', type: 'varchar', length: '20' },
          { name: 'channel', type: 'varchar', length: '50' },
          { name: 'symbol', type: 'varchar', length: '50' },
          { name: 'message', type: 'varchar', length: '255' },
          { name: 'route', type: 'varchar', length: '100', isNullable: true },
          { name: 'status', type: 'varchar', length: '20' },
          { name: 'source', type: 'varchar', length: '100', isNullable: true },
          { name: 'urgency', type: 'varchar', length: '50', isNullable: true },
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
      'alerts',
      new TableIndex({
        name: 'idx_alerts_status_created_at',
        columnNames: ['status', 'createdAt'],
      })
    );

    await queryRunner.createIndex(
      'alerts',
      new TableIndex({
        name: 'idx_alerts_severity_created_at',
        columnNames: ['severity', 'createdAt'],
      })
    );

    await queryRunner.createTable(
      new Table({
        name: 'alert_actions',
        columns: [
          { name: 'id', type: 'char', length: '36', isPrimary: true },
          { name: 'alertId', type: 'char', length: '36' },
          { name: 'actionType', type: 'varchar', length: '30' },
          { name: 'target', type: 'varchar', length: '50', isNullable: true },
          { name: 'note', type: 'text', isNullable: true },
          { name: 'actor', type: 'varchar', length: '100', isNullable: true },
          { name: 'metadata', type: 'json', isNullable: true },
          { name: 'createdAt', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
        ],
      })
    );

    await queryRunner.createIndex(
      'alert_actions',
      new TableIndex({
        name: 'idx_alert_actions_alert_created_at',
        columnNames: ['alertId', 'createdAt'],
      })
    );

    await queryRunner.createForeignKey(
      'alert_actions',
      new TableForeignKey({
        name: 'fk_alert_actions_alert_id',
        columnNames: ['alertId'],
        referencedTableName: 'alerts',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropForeignKey('alert_actions', 'fk_alert_actions_alert_id');
    await queryRunner.dropIndex('alert_actions', 'idx_alert_actions_alert_created_at');
    await queryRunner.dropTable('alert_actions');
    await queryRunner.dropIndex('alerts', 'idx_alerts_severity_created_at');
    await queryRunner.dropIndex('alerts', 'idx_alerts_status_created_at');
    await queryRunner.dropTable('alerts');
  }
}
