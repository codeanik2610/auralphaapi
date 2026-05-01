import { MigrationInterface, QueryRunner, TableIndex } from 'typeorm';
import { Service } from 'typedi';

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
export class AddAutomationSummaryIndexes1800001200000 implements MigrationInterface {
  name = 'AddAutomationSummaryIndexes1800001200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('automation_events')) {
      await addIndexIfMissing(
        queryRunner,
        'automation_events',
        new TableIndex({
          name: 'idx_automation_events_type_created_at',
          columnNames: ['type', 'createdAt'],
        })
      );
      await addIndexIfMissing(
        queryRunner,
        'automation_events',
        new TableIndex({
          name: 'idx_automation_events_automation_type_created_at',
          columnNames: ['automationId', 'type', 'createdAt'],
        })
      );
    }

    if (await queryRunner.hasTable('automation_runs')) {
      await addIndexIfMissing(
        queryRunner,
        'automation_runs',
        new TableIndex({
          name: 'idx_automation_runs_status_started_at',
          columnNames: ['status', 'started_at'],
        })
      );
      await addIndexIfMissing(
        queryRunner,
        'automation_runs',
        new TableIndex({
          name: 'idx_automation_runs_user_status_started_at',
          columnNames: ['user_id', 'status', 'started_at'],
        })
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('automation_events')) {
      const eventsTable = await queryRunner.getTable('automation_events');
      const typeCreatedIndex = eventsTable?.indices.find(
        (item) => item.name === 'idx_automation_events_type_created_at'
      );
      if (typeCreatedIndex) {
        await queryRunner.dropIndex('automation_events', typeCreatedIndex);
      }
      const automationTypeCreatedIndex = eventsTable?.indices.find(
        (item) => item.name === 'idx_automation_events_automation_type_created_at'
      );
      if (automationTypeCreatedIndex) {
        await queryRunner.dropIndex('automation_events', automationTypeCreatedIndex);
      }
    }

    if (await queryRunner.hasTable('automation_runs')) {
      const runsTable = await queryRunner.getTable('automation_runs');
      const statusStartedIndex = runsTable?.indices.find(
        (item) => item.name === 'idx_automation_runs_status_started_at'
      );
      if (statusStartedIndex) {
        await queryRunner.dropIndex('automation_runs', statusStartedIndex);
      }
      const userStatusStartedIndex = runsTable?.indices.find(
        (item) => item.name === 'idx_automation_runs_user_status_started_at'
      );
      if (userStatusStartedIndex) {
        await queryRunner.dropIndex('automation_runs', userStatusStartedIndex);
      }
    }
  }
}
