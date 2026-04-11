import { Service } from 'typedi';
import { MigrationInterface, QueryRunner, TableColumn, TableIndex } from 'typeorm';

@Service()
export class AddBrokerKeyToConnections1741476900000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'connections',
      new TableColumn({
        name: 'brokerKey',
        type: 'varchar',
        length: '100',
        isNullable: true,
      })
    );

    await queryRunner.query(
      "UPDATE connections SET brokerKey = LOWER(REPLACE(REPLACE(REPLACE(COALESCE(broker, name), ' ', '_'), '-', '_'), '.', '_')) WHERE brokerKey IS NULL"
    );

    await queryRunner.changeColumn(
      'connections',
      'brokerKey',
      new TableColumn({
        name: 'brokerKey',
        type: 'varchar',
        length: '100',
        isNullable: false,
      })
    );

    await queryRunner.createIndex(
      'connections',
      new TableIndex({
        name: 'uidx_connections_broker_key',
        columnNames: ['brokerKey'],
        isUnique: true,
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex('connections', 'uidx_connections_broker_key');
    await queryRunner.dropColumn('connections', 'brokerKey');
  }
}
